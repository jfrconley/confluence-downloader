import chalk from "chalk";
import cliProgress from "cli-progress";
import fs from "fs-extra";
import path from "path";
import { ConfluenceClient } from "./api-client.js";
import { FileSystemHandler } from "./fs-handler.js";
import Logger from "./logger.js";
import { MarkdownConverter } from "./markdown-converter.js";
import type { ConfluenceLibraryConfig, LibraryOptions, SpaceConfig, SpaceInfo, SpaceMetadata } from "./types.js";

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
            barCompleteChar: "=",
            barIncompleteChar: "-",
            hideCursor: true,
            clearOnComplete: true,
            stopOnComplete: true,
        });

        this.client = new ConfluenceClient({
            baseUrl: this.baseUrl,
            apiToken: this.apiToken,
            spaceKey: "",
            outputDir: "",
        });

        Logger.info("library", `ConfluenceLibrary initialized with config path: ${this.configPath}`);
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
        const content = await fs.readFile(this.configPath, "utf8");
        return JSON.parse(content);
    }

    public async getConfig(): Promise<ConfluenceLibraryConfig> {
        return this.loadConfig();
    }

    private async saveConfig(config: ConfluenceLibraryConfig): Promise<void> {
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    }

    private async saveSpaceMetadata(spacePath: string, metadata: SpaceMetadata): Promise<void> {
        const metadataPath = path.join(spacePath, "space.json");
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
            spaceKey: "",
            outputDir: "",
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
            id: spaceInfo.id,
            settings: spaceInfo.settings,
        };
        await this.saveSpaceMetadata(spacePath, metadata);
    }

    spaceMetadaFromInfo(info: SpaceInfo): SpaceMetadata {
        return {
            key: info.key,
            name: info.name,
            description: info.description?.plain?.value,
            lastSynced: new Date(0).toISOString(),
            id: info.id,
            settings: info.settings,
        };
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
        // Open a bespoke debug file (in append mode) to capture JSON content of pages
        const debugFilePath = path.join(spacePath, "debug.log");
        const debugStream = fs.createWriteStream(debugFilePath, { flags: "a" });

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
            status: "Initializing...",
        });

        try {
            // Get space info (5%)
            this.progressBar.update(0, { status: "Fetching space info..." });
            const spaceInfo = await client.getSpaceInfo();
            const metadata: SpaceMetadata = {
                key: spaceKey,
                name: spaceInfo.name,
                description: spaceInfo.description?.plain?.value,
                lastSynced: new Date().toISOString(),
                id: spaceInfo.id,
                settings: spaceInfo.settings,
            };
            await this.saveSpaceMetadata(spacePath, metadata);
            this.progressBar.update(5);

            // Setup components (5%)
            this.progressBar.update(5, { status: "Setting up..." });
            const converter = new MarkdownConverter();
            const fsHandler = new FileSystemHandler(spacePath);
            this.progressBar.update(10);

            // Get all pages (30%)
            const pages = await client.getAllPages(spaceInfo);

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
                                    // Write JSON details of the page to the debug file instead of console.log
                                    // debugStream.write("Page: " + page.id + "\n" + JSON.stringify(page, null, 2) + "\n");
                                    const comments = await client.getComments(page.id);
                                    // debugStream.write("Comments: \n" + JSON.stringify(comments, null, 2) + "\n");

                                    try {
                                        const markdown = converter.convertPage(page, comments);

                                        if (comments.length > 0) {
                                            debugStream.write(
                                                "Page: " + page.id + "\n" + JSON.stringify(page, null, 2) + "\n"
                                                    + "Comments: \n" + JSON.stringify(comments, null, 2) + "\n"
                                                    + "Markdown: \n" + markdown + "\n",
                                            );
                                        }
                                        await fsHandler.writePage(page, markdown);
                                        return { success: true, page };
                                    } catch (conversionError) {
                                        // Specific error for conversion issues
                                        const errorMessage =
                                            `Error converting page ${page.title} (ID: ${page.id}): ${conversionError}`;
                                        console.error(errorMessage);

                                        // Write error details to debug log
                                        debugStream.write(`ERROR CONVERTING PAGE: ${page.id} (${page.title})\n`);
                                        debugStream.write(`Error: ${conversionError}\n`);
                                        debugStream.write(
                                            `Stack: ${
                                                conversionError instanceof Error
                                                    ? conversionError.stack
                                                    : "No stack trace available"
                                            }\n`,
                                        );

                                        this.errors.push(errorMessage);
                                        return { success: false, page, error: conversionError };
                                    }
                                } catch (error) {
                                    // Store errors to report after progress bar completes
                                    const errorMessage =
                                        `Error processing page ${page.title} (ID: ${page.id}): ${error}`;
                                    console.error(errorMessage);

                                    // Write error details to debug log
                                    debugStream.write(`ERROR PROCESSING PAGE: ${page.id} (${page.title})\n`);
                                    debugStream.write(`Error: ${error}\n`);
                                    debugStream.write(
                                        `Stack: ${error instanceof Error ? error.stack : "No stack trace available"}\n`,
                                    );

                                    this.errors.push(errorMessage);
                                    return { success: false, page, error };
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
            this.progressBar.update(100, { status: chalk.green("Completed") });

            // Report any errors that occurred during processing
            if (this.errors.length > 0) {
                console.log(chalk.yellow(`\nWarnings/Errors (${this.errors.length}):`));
                Logger.warn("library", `Found ${this.errors.length} warnings/errors during sync`);

                // Group errors by type to make them more readable
                const errorsByType: Record<string, string[]> = {};

                this.errors.forEach(error => {
                    // Extract error type from the message
                    let errorType = "Unknown Error";

                    if (error.includes("ReferenceError: Element is not defined")) {
                        errorType = "DOM Element Error";
                    } else if (error.includes("Error converting page")) {
                        errorType = "Conversion Error";
                    } else if (error.includes("Error processing page")) {
                        errorType = "Processing Error";
                    }

                    if (!errorsByType[errorType]) {
                        errorsByType[errorType] = [];
                    }
                    errorsByType[errorType].push(error);

                    // Log to debug logger
                    Logger.warn("library", error);
                });

                // Print errors grouped by type
                Object.entries(errorsByType).forEach(([type, errors]) => {
                    console.log(chalk.yellow(`\n${type} (${errors.length}):`));
                    Logger.warn("library", `${type} (${errors.length})`);

                    // If there are many errors of the same type, summarize
                    if (errors.length > 10) {
                        errors.slice(0, 5).forEach(error => {
                            console.log(chalk.yellow(`- ${error}`));
                            Logger.warn("library", `${type}: ${error}`);
                        });
                        console.log(chalk.yellow(`- ... and ${errors.length - 5} more similar errors`));
                        Logger.warn("library", `... and ${errors.length - 5} more similar errors`);

                        // Provide troubleshooting advice based on error type
                        if (type === "DOM Element Error") {
                            console.log(chalk.cyan("\nTroubleshooting \"Element is not defined\" errors:"));
                            console.log(
                                chalk.cyan("- This is likely due to DOM API differences between browsers and Node.js"),
                            );
                            console.log(chalk.cyan("- Check the debug.log file for more details on specific pages"));

                            Logger.info("library", "Troubleshooting advice provided for DOM Element Errors");
                        }
                    } else {
                        errors.forEach(error => {
                            console.log(chalk.yellow(`- ${error}`));
                            Logger.warn("library", `${type}: ${error}`);
                        });
                    }
                });

                // Clear errors after reporting
                this.errors = [];
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.progressBar.update(100, { status: chalk.red(`Error: ${errorMessage}`) });
            Logger.error("library", "Error syncing space", error);
            throw error;
        } finally {
            this.progressBar.stop();
            // No need to close debug stream here, we're using our new logger
        }
    }

    async syncAll(): Promise<void> {
        const spaces = await this.listSpaces();

        for (let i = 0; i < spaces.length; i++) {
            const space = spaces[i];
            await this.syncSpace(space.spaceKey);
        }
    }
}
