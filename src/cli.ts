#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { ConfluenceConfig } from './types.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { ConfluenceLibrary } from './library.js';
import { InteractiveConfluenceCLI } from './interactive.js';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
config({ path: join(dirname(__dirname), '.env') });

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .command('interactive', 'Start interactive mode', {
            rootDir: {
                type: 'string',
                description: 'Root directory for the library',
                default: './confluence-library',
            },
        })
        .command('init', 'Initialize a new Confluence library', {
            rootDir: {
                type: 'string',
                description: 'Root directory for the library',
                default: './confluence-library',
            },
            baseUrl: {
                type: 'string',
                description: 'Confluence base URL',
                default: process.env.CONFLUENCE_BASE,
            },
            apiToken: {
                type: 'string',
                description: 'Confluence API token',
                default: process.env.CONFLUENCE_TOKEN,
            },
        })
        .command('add-space', 'Add a space to the library', {
            spaceKey: {
                type: 'string',
                description: 'Confluence space key',
                demandOption: true,
            },
            localPath: {
                type: 'string',
                description: 'Local directory name for the space',
            },
        })
        .command('remove-space', 'Remove a space from the library', {
            spaceKey: {
                type: 'string',
                description: 'Confluence space key',
                demandOption: true,
            },
        })
        .command('list-spaces', 'List all spaces in the library')
        .command('sync', 'Sync one or all spaces', {
            spaceKey: {
                type: 'string',
                description: 'Confluence space key (sync all if not provided)',
            },
        })
        .command('sync-space', 'Sync a single space (legacy mode)', {
            baseUrl: {
                type: 'string',
                description: 'Confluence base URL',
                default: process.env.CONFLUENCE_BASE,
            },
            apiToken: {
                type: 'string',
                description: 'Confluence API token',
                default: process.env.CONFLUENCE_TOKEN,
            },
            spaceKey: {
                type: 'string',
                description: 'Confluence space key',
                default: process.env.CONFLUENCE_SPACE,
            },
            outputDir: {
                type: 'string',
                description: 'Output directory for markdown files',
                default: process.env.CONFLUENCE_OUTPUT_DIR || 'confluence-output',
            },
            email: {
                type: 'string',
                description: 'Confluence account email',
                default: process.env.CONFLUENCE_EMAIL,
            },
            concurrency: {
                type: 'number',
                description: 'Number of concurrent downloads',
                default: Math.max(1, Math.min(os.cpus().length - 1, 4)),
            },
        })
        .demandCommand(1, 'You must provide a command')
        .help()
        .parse();

    const command = argv._[0];

    switch (command) {
        case 'interactive': {
            const library = new ConfluenceLibrary({
                rootDir: argv.rootDir as string,
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
            });
            await library.initialize();
            const cli = new InteractiveConfluenceCLI(library);
            await cli.start();
            break;
        }

        case 'init': {
            const library = new ConfluenceLibrary({
                rootDir: argv.rootDir as string,
                baseUrl: argv.baseUrl as string,
                apiToken: argv.apiToken as string,
            });
            await library.initialize();
            console.log(`Initialized Confluence library in ${argv.rootDir}`);
            break;
        }

        case 'add-space': {
            const library = new ConfluenceLibrary({
                rootDir: argv.rootDir as string,
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
            });
            const localPath = argv.localPath || argv.spaceKey;
            await library.addSpace(argv.spaceKey as string, localPath as string);
            console.log(`Added space ${argv.spaceKey} to library`);
            break;
        }

        case 'remove-space': {
            const library = new ConfluenceLibrary({
                rootDir: argv.rootDir as string,
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
            });
            await library.removeSpace(argv.spaceKey as string);
            console.log(`Removed space ${argv.spaceKey} from library`);
            break;
        }

        case 'list-spaces': {
            const library = new ConfluenceLibrary({
                rootDir: argv.rootDir as string,
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
            });
            const spaces = await library.listSpaces();
            console.log('Spaces in library:');
            spaces.forEach(space => {
                console.log(`- ${space.spaceKey} (${space.localPath})`);
                console.log(`  Last synced: ${new Date(space.lastSync).toLocaleString()}`);
            });
            break;
        }

        case 'sync': {
            const library = new ConfluenceLibrary({
                rootDir: argv.rootDir as string,
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
            });
            if (argv.spaceKey) {
                await library.syncSpace(argv.spaceKey as string);
                console.log(`Synced space ${argv.spaceKey}`);
            } else {
                await library.syncAll();
                console.log('Synced all spaces');
            }
            break;
        }

        case 'sync-space': {
            // Legacy single space sync
            const config: ConfluenceConfig = {
                baseUrl: argv.baseUrl as string,
                apiToken: argv.apiToken as string,
                spaceKey: argv.spaceKey as string,
                outputDir: argv.outputDir as string,
            };

            if (!config.baseUrl) {
                throw new Error('Base URL is required');
            }
            if (!config.apiToken) {
                throw new Error('API token is required');
            }
            if (!config.spaceKey) {
                throw new Error('Space key is required');
            }
            if (!argv.email) {
                throw new Error('Email is required');
            }

            process.env.CONFLUENCE_EMAIL = argv.email as string;
            const library = new ConfluenceLibrary({
                rootDir: config.outputDir,
                baseUrl: config.baseUrl,
                apiToken: config.apiToken,
            });
            await library.initialize();
            await library.addSpace(config.spaceKey, '.');
            await library.syncSpace(config.spaceKey);
            break;
        }
    }
}

main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
}); 