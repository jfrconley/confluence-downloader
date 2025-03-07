#!/usr/bin/env node

import chalk from "chalk";
import dotenv from "dotenv";
import os from "os";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { InteractiveConfluenceCLI } from "./interactive.js";
import { ConfluenceLibrary } from "./library.js";
import type { ConfluenceConfig } from "./types.js";

// Load environment variables
dotenv.config();

interface CliArgs {
    token: string;
    base: string;
    config: string;
    rootDir?: string;
    baseUrl?: string;
    apiToken?: string;
    spaceKey?: string;
    localPath?: string;
    outputDir?: string;
    email?: string;
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .env("CONFLUENCE")
        .options({
            token: {
                alias: "t",
                type: "string",
                description: "Confluence API token",
                demandOption: true,
            },
            base: {
                alias: "b",
                type: "string",
                description: "Confluence base URL",
                demandOption: true,
            },
            config: {
                alias: "c",
                type: "string",
                description: "Path to confluence.json config file",
                demandOption: true,
            },
        })
        .command("$0", "Start interactive mode", {}, async (argv) => {
            const args = argv as unknown as CliArgs;
            const library = new ConfluenceLibrary({
                baseUrl: args.base,
                apiToken: args.token,
                configPath: args.config,
            });

            await library.initialize();
            const cli = new InteractiveConfluenceCLI(library);
            await cli.start();
        })
        .command("init", "Initialize a new Confluence library", {
            rootDir: {
                type: "string",
                description: "Root directory for the library",
                default: "./confluence-library",
            },
            baseUrl: {
                type: "string",
                description: "Confluence base URL",
                default: process.env.CONFLUENCE_BASE,
            },
            apiToken: {
                type: "string",
                description: "Confluence API token",
                default: process.env.CONFLUENCE_TOKEN,
            },
        })
        .command("add-space", "Add a space to the library", {
            spaceKey: {
                type: "string",
                description: "Confluence space key",
                demandOption: true,
            },
            localPath: {
                type: "string",
                description: "Local directory name for the space",
            },
        })
        .command("remove-space", "Remove a space from the library", {
            spaceKey: {
                type: "string",
                description: "Confluence space key",
                demandOption: true,
            },
        })
        .command("list-spaces", "List all spaces in the library")
        .command("sync", "Sync one or all spaces", {
            spaceKey: {
                type: "string",
                description: "Confluence space key (sync all if not provided)",
            },
        })
        .command("sync-space", "Sync a single space (legacy mode)", {
            baseUrl: {
                type: "string",
                description: "Confluence base URL",
                default: process.env.CONFLUENCE_BASE,
            },
            apiToken: {
                type: "string",
                description: "Confluence API token",
                default: process.env.CONFLUENCE_TOKEN,
            },
            spaceKey: {
                type: "string",
                description: "Confluence space key",
                default: process.env.CONFLUENCE_SPACE,
            },
            outputDir: {
                type: "string",
                description: "Output directory for markdown files",
                default: process.env.CONFLUENCE_OUTPUT_DIR || "confluence-output",
            },
            email: {
                type: "string",
                description: "Confluence account email",
                default: process.env.CONFLUENCE_EMAIL,
            },
            concurrency: {
                type: "number",
                description: "Number of concurrent downloads",
                default: Math.max(1, Math.min(os.cpus().length - 1, 4)),
            },
        })
        .command("show", "Show configuration location and data")
        .demandCommand(1)
        .help()
        .parse();

    const command = argv._[0];

    switch (command) {
        case "init": {
            const rootDir = argv.rootDir as string;
            const configPath = `${rootDir}/confluence.json`;

            const library = new ConfluenceLibrary({
                baseUrl: argv.baseUrl as string,
                apiToken: argv.apiToken as string,
                configPath: configPath,
            });
            await library.initialize();
            console.log(`Initialized Confluence library in ${rootDir}`);
            break;
        }

        case "add-space": {
            const library = new ConfluenceLibrary({
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
                configPath: process.env.CONFLUENCE_CONFIG!,
            });
            const localPath = argv.localPath || argv.spaceKey;
            await library.addSpace(argv.spaceKey as string, localPath as string);
            console.log(`Added space ${argv.spaceKey} to library`);
            break;
        }

        case "remove-space": {
            const library = new ConfluenceLibrary({
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
                configPath: process.env.CONFLUENCE_CONFIG!,
            });
            await library.removeSpace(argv.spaceKey as string);
            console.log(`Removed space ${argv.spaceKey} from library`);
            break;
        }

        case "list-spaces": {
            const library = new ConfluenceLibrary({
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
                configPath: process.env.CONFLUENCE_CONFIG!,
            });
            const spaces = await library.listSpaces();
            console.log("Spaces in library:");
            spaces.forEach(space => {
                console.log(`- ${space.spaceKey} (${space.localPath})`);
                console.log(`  Last synced: ${new Date(space.lastSync).toLocaleString()}`);
            });
            break;
        }

        case "sync": {
            const library = new ConfluenceLibrary({
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
                configPath: process.env.CONFLUENCE_CONFIG!,
            });
            if (argv.spaceKey) {
                await library.syncSpace(argv.spaceKey as string);
                console.log(`Synced space ${argv.spaceKey}`);
            } else {
                await library.syncAll();
                console.log("Synced all spaces");
            }
            break;
        }

        case "sync-space": {
            // Legacy single space sync
            const config: ConfluenceConfig = {
                baseUrl: argv.baseUrl as string,
                apiToken: argv.apiToken as string,
                spaceKey: argv.spaceKey as string,
                outputDir: argv.outputDir as string,
            };

            if (!config.baseUrl) {
                throw new Error("Base URL is required");
            }
            if (!config.apiToken) {
                throw new Error("API token is required");
            }
            if (!config.spaceKey) {
                throw new Error("Space key is required");
            }
            if (!argv.email) {
                throw new Error("Email is required");
            }

            process.env.CONFLUENCE_EMAIL = argv.email as string;
            const library = new ConfluenceLibrary({
                baseUrl: config.baseUrl,
                apiToken: config.apiToken,
                configPath: config.outputDir,
            });
            await library.initialize();
            await library.addSpace(config.spaceKey, ".");
            await library.syncSpace(config.spaceKey);
            break;
        }

        case "show": {
            const library = new ConfluenceLibrary({
                baseUrl: process.env.CONFLUENCE_BASE!,
                apiToken: process.env.CONFLUENCE_TOKEN!,
                configPath: process.env.CONFLUENCE_CONFIG!,
            });
            const config = await library.getConfig();
            console.log(chalk.cyan("Configuration Location:"));
            console.log(library.configPath);
            console.log();
            console.log(chalk.cyan("Configuration Data:"));
            console.log(JSON.stringify(config, null, 2));
            break;
        }
    }
}

main().catch((error: Error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
