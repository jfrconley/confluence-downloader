#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ConfluenceClient } from './api-client.js';
import { MarkdownConverter } from './markdown-converter.js';
import { FileSystemHandler } from './fs-handler.js';
import type { ConfluenceConfig, ConfluencePage } from './types.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import cliProgress from 'cli-progress';
import chalk from 'chalk';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
config({ path: join(dirname(__dirname), '.env') });

// Debug environment variables
console.log('Environment variables:', {
    CONFLUENCE_BASE: process.env.CONFLUENCE_BASE,
    CONFLUENCE_SPACE: process.env.CONFLUENCE_SPACE,
    CONFLUENCE_OUTPUT_DIR: process.env.CONFLUENCE_OUTPUT_DIR,
    CONFLUENCE_EMAIL: process.env.CONFLUENCE_EMAIL,
    // Don't log the token for security
});

async function processPage(
    page: ConfluencePage,
    client: ConfluenceClient,
    converter: MarkdownConverter,
    fsHandler: FileSystemHandler
): Promise<void> {
    const comments = await client.getComments(page.id);
    const markdown = converter.convertPage(page, comments);
    await fsHandler.writePage(page, markdown);
}

async function processPagesInBatches<T extends { title?: string }>(
    items: T[],
    concurrency: number,
    processor: (item: T) => Promise<void>
): Promise<void> {
    const errors: Error[] = [];
    let processed = 0;
    const total = items.length;

    // Create a new progress bar
    const progressBar = new cliProgress.SingleBar({
        format: `Downloading pages |${chalk.cyan('{bar}')}| {percentage}% | {value}/{total} Pages | {currentPage}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
    });

    // Initialize the progress bar
    progressBar.start(total, 0, { currentPage: '' });

    // Process items in batches of size 'concurrency'
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        await Promise.all(
            batch.map(async (item) => {
                try {
                    await processor(item);
                    processed++;
                    // Update progress bar with current page title if available
                    progressBar.update(processed, { currentPage: item.title || '' });
                } catch (error) {
                    errors.push(error as Error);
                    console.error(`\nError processing item: ${error}`);
                }
            })
        );
    }

    // Stop the progress bar
    progressBar.stop();

    if (errors.length > 0) {
        console.error(`\nCompleted with ${errors.length} errors:`);
        errors.forEach((error) => console.error(error.message));
    }
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .options({
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
            sync: {
                type: 'boolean',
                description: 'Sync mode - clean output directory before downloading',
                default: false,
            },
            concurrency: {
                type: 'number',
                description: 'Number of concurrent downloads',
                default: Math.max(1, Math.min(os.cpus().length - 1, 4)),
            },
        })
        .parse();

    const baseUrl = argv.baseUrl || process.env.CONFLUENCE_BASE;
    const apiToken = argv.apiToken || process.env.CONFLUENCE_TOKEN;
    const spaceKey = argv.spaceKey || process.env.CONFLUENCE_SPACE;
    const outputDir = argv.outputDir || process.env.CONFLUENCE_OUTPUT_DIR || 'confluence-output';
    const email = argv.email || process.env.CONFLUENCE_EMAIL;
    const concurrency = argv.concurrency;

    // Validate required fields
    if (!baseUrl) {
        throw new Error('Base URL is required. Provide via --baseUrl or CONFLUENCE_BASE env var');
    }
    if (!apiToken) {
        throw new Error('API token is required. Provide via --apiToken or CONFLUENCE_TOKEN env var');
    }
    if (!spaceKey) {
        throw new Error('Space key is required. Provide via --spaceKey or CONFLUENCE_SPACE env var');
    }
    if (!email) {
        throw new Error('Email is required. Provide via --email or CONFLUENCE_EMAIL env var');
    }

    const config: ConfluenceConfig = {
        baseUrl,
        apiToken,
        spaceKey,
        outputDir,
    };

    const client = new ConfluenceClient(config);
    const converter = new MarkdownConverter();
    const fsHandler = new FileSystemHandler(config.outputDir);

    if (argv.sync) {
        await fsHandler.clean();
    }

    console.log(`Downloading Confluence space ${config.spaceKey} to ${config.outputDir}...`);
    console.log(`Using concurrency: ${concurrency}`);

    const pages = await client.getAllPages(config.spaceKey);
    
    await processPagesInBatches(
        pages,
        concurrency,
        (page) => processPage(page, client, converter, fsHandler)
    );

    console.log(`\nSuccessfully downloaded ${pages.length} pages to ${config.outputDir}`);
}

main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
}); 