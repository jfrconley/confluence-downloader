import fs from 'fs-extra';
import path from 'path';
import { ConfluenceClient } from './api-client.js';
import { MarkdownConverter } from './markdown-converter.js';
import { FileSystemHandler } from './fs-handler.js';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import type {
    LibraryOptions,
    ConfluenceLibraryConfig,
    SpaceConfig,
    SpaceMetadata,
    SpaceInfo,
} from './types.js';

export class ConfluenceLibrary {
    public readonly configPath: string;
    private readonly configDir: string;
    private readonly baseUrl: string;
    private readonly apiToken: string;
    private progressBar: cliProgress.SingleBar;
    private errors: string[] = [];
    private client: ConfluenceClient;

    constructor(options: LibraryOptions) {
        this.configPath = options.configPath;
        this.configDir = path.dirname(options.configPath);
        this.baseUrl = options.baseUrl;
        this.apiToken = options.apiToken;
        
        this.progressBar = new cliProgress.SingleBar({
            format: `{space} [{bar}] {percentage}% | {status}`,
            barCompleteChar: '=',
            barIncompleteChar: '-',
            hideCursor: true,
            clearOnComplete: true,
            stopOnComplete: true,
        });

        this.client = new ConfluenceClient({
            baseUrl: this.baseUrl,
            apiToken: this.apiToken,
            spaceKey: '',
            outputDir: '',
        });
    }

    async initialize(): Promise<void> {
        await fs.ensureDir(this.configDir);
        if (!await fs.pathExists(this.configPath)) {
            await this.saveConfig({
                baseUrl: this.baseUrl,
                spaces: [],
            });
        }
    }

    private async loadConfig(): Promise<ConfluenceLibraryConfig> {
        const content = await fs.readFile(this.configPath, 'utf8');
        return JSON.parse(content);
    }

    public async getConfig(): Promise<ConfluenceLibraryConfig> {
        return this.loadConfig();
    }

    private async saveConfig(config: ConfluenceLibraryConfig): Promise<void> {
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    }

    private async saveSpaceMetadata(spacePath: string, metadata: SpaceMetadata): Promise<void> {
        const metadataPath = path.join(spacePath, 'space.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }

    async listSpaces(): Promise<SpaceConfig[]> {
        const config = await this.loadConfig();
        return config.spaces;
    }

    async getAvailableSpaces(): Promise<SpaceInfo[]> {
        const client = new ConfluenceClient({
            baseUrl: this.baseUrl,
            apiToken: this.apiToken,
            spaceKey: '',
            outputDir: '',
        });
        return client.getAllSpaces();
    }

    async addSpace(spaceKey: string, localPath: string): Promise<void> {
        const config = await this.loadConfig();
            
        // Check if space already exists
        if (config.spaces.some(s => s.spaceKey === spaceKey)) {
            throw new Error(`Space ${spaceKey} already exists in library`);
        }

        // Verify the space exists in Confluence
        const spaceInfo = await this.client.getSpaceInfo(spaceKey);
        if (!spaceInfo) {
            throw new Error(`Space ${spaceKey} not found in Confluence`);
        }

        // Add the space to config
        config.spaces.push({
            spaceKey,
            localPath,
            lastSync: new Date(0).toISOString(), // Set to epoch to mark as never synced
        });

        await this.saveConfig(config);

        // Create the space directory
        const spacePath = path.join(this.configDir, localPath);
        await fs.ensureDir(spacePath);

        // Save initial space metadata
        const metadata: SpaceMetadata = {
            key: spaceKey,
            name: spaceInfo.name,
            description: spaceInfo.description?.plain?.value,
            lastSynced: new Date(0).toISOString(),
        };
        await this.saveSpaceMetadata(spacePath, metadata);
    }

    async removeSpace(spaceKey: string): Promise<void> {
        const config = await this.loadConfig();
        const spaceIndex = config.spaces.findIndex(s => s.spaceKey === spaceKey);
        
        if (spaceIndex === -1) {
            throw new Error(`Space ${spaceKey} not found in library`);
        }

        const space = config.spaces[spaceIndex];
        const spacePath = path.join(this.configDir, space.localPath);

        // Remove from config
        config.spaces.splice(spaceIndex, 1);
        await this.saveConfig(config);

        // Remove space directory
        await fs.remove(spacePath);
    }

    async syncSpace(spaceKey: string): Promise<void> {
        const config = await this.loadConfig();
        const space = config.spaces.find(s => s.spaceKey === spaceKey);
        
        if (!space) {
            throw new Error(`Space ${spaceKey} not found in library`);
        }

        const spacePath = path.join(this.configDir, space.localPath);
        const client = new ConfluenceClient({
            baseUrl: this.baseUrl,
            apiToken: this.apiToken,
            spaceKey,
            outputDir: spacePath,
            concurrency: 1,
            onProgress: (status: string) => {
                // Don't update progress bar if it's not active
                if (this.progressBar.isActive) {
                    this.progressBar.update({ status });
                }
            },
        });

        // Initialize progress bar
        this.progressBar.start(100, 0, {
            space: chalk.cyan(spaceKey),
            status: 'Initializing...',
        });

        try {
            // Get space info (5%)
            this.progressBar.update(0, { status: 'Fetching space info...' });
            const spaceInfo = await client.getSpaceInfo();
            const metadata: SpaceMetadata = {
                key: spaceKey,
                name: spaceInfo.name,
                description: spaceInfo.description?.plain?.value,
                lastSynced: new Date().toISOString(),
            };
            await this.saveSpaceMetadata(spacePath, metadata);
            this.progressBar.update(5);

            // Setup components (5%)
            this.progressBar.update(5, { status: 'Setting up...' });
            const converter = new MarkdownConverter();
            const fsHandler = new FileSystemHandler(spacePath);
            this.progressBar.update(10);

            // Get all pages (30%)
            const pages = await client.getAllPages(spaceKey);

            if (pages.length > 0) {
                // Process pages (60%)
                const batchSize = 100;
                const concurrency = 8;
                let completed = 0;
                const totalPages = pages.length;

                // Process pages in concurrent batches
                for (let i = 0; i < pages.length; i += batchSize * concurrency) {
                    const batchPromises = [];
                    
                    // Create concurrent batch promises
                    for (let j = 0; j < concurrency && i + j * batchSize < pages.length; j++) {
                        const start = i + j * batchSize;
                        const end = Math.min(start + batchSize, pages.length);
                        const batch = pages.slice(start, end);
                        
                        batchPromises.push((async () => {
                            const results = await Promise.all(batch.map(async (page) => {
                                try {
                                    const comments = await client.getComments(page.id);
                                    const markdown = converter.convertPage(page, comments);
                                    await fsHandler.writePage(page, markdown);
                                    return { success: true, page };
                                } catch (error) {
                                    // Store errors to report after progress bar completes
                                    const errorMessage = `Error writing page ${page.title}: ${error}`;
                                    this.errors.push(errorMessage);
                                    return { success: false, page };
                                }
                            }));
                            
                            completed += results.length;
                            const progress = 40 + Math.round((completed / totalPages) * 60);
                            this.progressBar.update(progress, { 
                                status: `Writing pages... (${completed}/${totalPages})`,
                            });
                            
                            return results;
                        })());
                    }

                    await Promise.all(batchPromises);
                }
            }

            // Update last sync time
            space.lastSync = new Date().toISOString();
            await this.saveConfig(config);
            
            // Complete
            this.progressBar.update(100, { status: chalk.green('Completed') });
            
            // Report any errors after progress bar is done
            if (this.errors.length > 0) {
                console.log(chalk.yellow('\nWarnings/Errors:'));
                this.errors.forEach(error => console.log(chalk.yellow(`- ${error}`)));
                this.errors = [];
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.progressBar.update(100, { status: chalk.red(`Error: ${errorMessage}`) });
            throw error;
        } finally {
            this.progressBar.stop();
        }
    }

    async syncAll(): Promise<void> {
        const spaces = await this.listSpaces();
        const totalSpaces = spaces.length;
        
        for (let i = 0; i < spaces.length; i++) {
            const space = spaces[i];
            await this.syncSpace(space.spaceKey);
        }
    }
} 