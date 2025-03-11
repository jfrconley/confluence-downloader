#!/usr/bin/env node

import { confirm, input, select } from "@inquirer/prompts";
import chalk from "chalk";
import cliProgress from "cli-progress";
import dotenv from "dotenv";
import path from "path";
import { pipeline } from "stream/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ConfluenceClient } from "./api-client.js";
import { ConfigManager } from "./config.js";
import { ContentStream, ContentWriter } from "./content-downloader.js";
import Logger from "./logger.js";

// Load environment variables
dotenv.config();

// Add these variables and function at the top of the file, after imports
let singleBar: cliProgress.SingleBar | null = null;

function createProgressBar(): cliProgress.SingleBar {
    const bar = new cliProgress.SingleBar({
        format: "{status} | {bar} | {percentage}%",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
    });
    bar.start(100, 0, { status: "Initializing..." });
    return bar;
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .env("CONFLUENCE")
        .options({
            token: {
                alias: "t",
                type: "string",
                description: "Confluence API token",
            },
            base: {
                alias: "b",
                type: "string",
                description: "Confluence base URL",
            },
            configPath: {
                alias: "c",
                type: "string",
                description:
                    "Path to configuration file (default: ~/.local/share/confluence-downloader/confluence.json)",
            },
            debug: {
                alias: "d",
                type: "boolean",
                description: "Enable debug logging to file",
                default: false,
            },
            debugLogPath: {
                type: "string",
                description: "Path for debug log file (defaults to current directory)",
            },
        })
        .command("init", "Initialize the configuration file", {}, async (argv) => {
            try {
                if (!argv.base || !argv.token) {
                    console.error("Base URL and API token are required for initialization");
                    process.exit(1);
                }

                const configManager = new ConfigManager(argv.configPath as string);

                // Set API configuration from command line arguments
                configManager.setApiConfig(
                    argv.base as string,
                    argv.token as string,
                    argv.concurrency as number,
                );
                configManager.save();

                console.log(chalk.green("Configuration initialized successfully"));
            } catch (error: unknown) {
                console.error("Error:", error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        })
        .command("reset", "Reset the configuration (removes all content, keeps API settings)", {}, async (argv) => {
            try {
                const confirmed = await confirm({
                    message: chalk.yellow(
                        "WARNING: This will delete all content data (spaces, pages, comments, etc.) but keep your API settings. Continue?",
                    ),
                    default: false,
                });

                if (!confirmed) {
                    console.log("Reset cancelled");
                    return;
                }

                const configManager = new ConfigManager(argv.configPath as string);

                // Keep API configuration, but remove spaces
                const apiConfig = configManager.getApiConfig();

                // Apply the reset configuration
                configManager.setApiConfig(
                    apiConfig.baseUrl,
                    apiConfig.apiToken,
                    apiConfig.concurrency,
                );
                // Clear spaces but keep settings
                configManager.getAllSpaceConfigs().forEach(space => {
                    configManager.removeSpaceConfig(space.key);
                });
                configManager.save();

                console.log(chalk.green("Configuration reset successfully"));
            } catch (error: unknown) {
                console.error("Error:", error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        })
        .command("show", "Show current configuration", {}, async (argv) => {
            try {
                const configManager = new ConfigManager(argv.configPath as string);

                const apiConfig = configManager.getApiConfig();
                const spaces = configManager.getAllSpaceConfigs();
                const settings = configManager.getAllSettings();

                console.log(chalk.bold("\nAPI Configuration:"));
                console.log(`  Base URL: ${apiConfig.baseUrl || "Not set"}`);
                console.log(`  API Token: ${apiConfig.apiToken ? "****" : "Not set"}`);
                console.log(`  Concurrency: ${apiConfig.concurrency || "Default"}`);

                console.log(chalk.bold("\nSpaces:"));
                if (spaces.length === 0) {
                    console.log("  No spaces configured");
                } else {
                    spaces.forEach(space => {
                        console.log(`  • ${space.key} (${space.name})`);
                        console.log(`    ID: ${space.id}`);
                        console.log(`    Local path: ${space.localPath}`);
                        console.log(`    Last synced: ${space.lastSynced || "Never"}`);
                        console.log(`    Status: ${space.status}, Enabled: ${space.enabled ? "Yes" : "No"}`);
                        console.log();
                    });
                }

                console.log(chalk.bold("\nSettings:"));
                if (Object.keys(settings).length === 0) {
                    console.log("  No custom settings");
                } else {
                    Object.entries(settings).forEach(([key, value]) => {
                        console.log(`  ${key}: ${value}`);
                    });
                }

                configManager.close();
            } catch (error: unknown) {
                console.error("Error:", error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        })
        .command("settings", "Manage application settings", (yargs) => {
            return yargs
                .command("list", "List all settings", yargs => yargs, async (argv) => {
                    try {
                        const configManager = new ConfigManager(argv.configPath as string);

                        const settings = configManager.getAllSettings();
                        console.log(chalk.bold("Application Settings:"));

                        for (const [key, value] of Object.entries(settings)) {
                            if (key === "apiToken") {
                                console.log(`${key}: ${"*".repeat(8)}`);
                            } else {
                                console.log(`${key}: ${value}`);
                            }
                        }

                        configManager.close();
                    } catch (error: unknown) {
                        console.error("Error:", error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                })
                .command("get", "Get a setting value", yargs =>
                    yargs.option("key", {
                        type: "string",
                        description: "Setting key",
                        demandOption: true,
                    }), async (argv) => {
                    try {
                        const configManager = new ConfigManager(argv.configPath as string);

                        const value = configManager.getSetting(argv.key!);

                        if (value) {
                            if (argv.key === "apiToken") {
                                console.log(`${argv.key}: ${"*".repeat(8)}`);
                            } else {
                                console.log(`${argv.key}: ${value}`);
                            }
                        } else {
                            console.log(`Setting not found: ${argv.key}`);
                        }

                        configManager.close();
                    } catch (error: unknown) {
                        console.error("Error:", error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                })
                .command("set", "Set a setting value", yargs =>
                    yargs.option("key", {
                        type: "string",
                        description: "Setting key",
                        demandOption: true,
                    }).option("value", {
                        type: "string",
                        description: "Setting value",
                        demandOption: true,
                    }), async (argv) => {
                    try {
                        const configManager = new ConfigManager(argv.configPath as string);

                        configManager.setSetting(argv.key!, argv.value!);
                        configManager.save();
                        console.log(chalk.green(`✓ Setting updated: ${argv.key}`));

                        configManager.close();
                    } catch (error: unknown) {
                        console.error("Error:", error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                })
                .command("remove", "Remove a setting", yargs =>
                    yargs.option("key", {
                        type: "string",
                        description: "Setting key",
                        demandOption: true,
                    }), async (argv) => {
                    try {
                        const configManager = new ConfigManager(argv.configPath as string);

                        configManager.removeSetting(argv.key!);
                        configManager.save();
                        console.log(chalk.green(`✓ Setting removed: ${argv.key}`));

                        configManager.close();
                    } catch (error: unknown) {
                        console.error("Error:", error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                })
                .demandCommand();
        })
        .command("spaces", "Manage Confluence spaces", (yargs) => {
            return yargs
                .command("list", "List configured spaces", yargs => yargs, async (argv) => {
                    try {
                        const configManager = new ConfigManager(argv.configPath as string);

                        const spaces = configManager.getAllSpaceConfigs();

                        if (spaces.length === 0) {
                            console.log("No spaces configured. Use \"spaces add\" to add a space.");
                            configManager.close();
                            return;
                        }

                        console.log(chalk.bold("Configured Spaces:"));
                        for (const space of spaces) {
                            const status = space.enabled ? chalk.green("✓ Enabled") : chalk.gray("✗ Disabled");
                            console.log(`${space.key} - ${space.name} [${status}]`);
                            console.log(`  Path: ${space.localPath}`);
                            console.log(`  Last synced: ${space.lastSynced || "Never"}`);
                            console.log("");
                        }

                        configManager.close();
                    } catch (error: unknown) {
                        console.error("Error:", error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                })
                .command("add", "Add a new space", yargs =>
                    yargs.option("spaceKey", {
                        type: "string",
                        description: "Confluence space key",
                        demandOption: true,
                    }).option("output", {
                        type: "string",
                        description: "Local path for space content",
                        demandOption: true,
                    }), async (argv) => {
                    try {
                        const configManager = new ConfigManager(argv.configPath as string);

                        // Get saved base URL if not provided
                        const apiConfig = configManager.getApiConfig();
                        const baseUrl = argv.base || apiConfig.baseUrl;
                        if (!baseUrl) {
                            console.error(
                                "Base URL not provided and not found in settings. Please provide --baseUrl or set it with \"settings set --key baseUrl --value URL\"",
                            );
                            process.exit(1);
                        }

                        // Get API token from settings
                        const apiToken = apiConfig.apiToken;
                        if (!apiToken) {
                            console.error(
                                "API token not found in settings. Please set it with \"settings set --key apiToken --value TOKEN\"",
                            );
                            process.exit(1);
                        }

                        // Create client to get space info
                        const client = new ConfluenceClient(configManager);

                        // Get space key - either from args or prompt
                        let spaceKey = argv.spaceKey;
                        if (!spaceKey) {
                            // Fetch available spaces
                            const spaces = await client.getAllSpaces();
                            if (spaces.length === 0) {
                                console.error("No spaces found in Confluence instance");
                                process.exit(1);
                            }

                            // Format options for selection
                            const options = spaces.map(space => ({
                                value: space.key,
                                label: `${space.key} - ${space.name}`,
                            }));

                            spaceKey = await select({
                                message: "Select a space:",
                                choices: options,
                            });
                        }

                        // Get output directory - either from args or prompt
                        let outputDir = argv.output;
                        if (!outputDir) {
                            outputDir = await input({
                                message: "Enter local path for space content:",
                                default: path.join(process.cwd(), spaceKey),
                            });
                        }

                        // Get space details
                        const spaces = await client.getAllSpaces();
                        const spaceInfo = spaces.find(s => s.key === spaceKey);

                        if (!spaceInfo) {
                            console.error(`Space not found: ${spaceKey}`);
                            process.exit(1);
                        }

                        // Save space config
                        configManager.saveSpaceConfig({
                            id: spaceInfo.id.toString(),
                            key: spaceInfo.key,
                            name: spaceInfo.name,
                            description: spaceInfo.description,
                            localPath: outputDir,
                            lastSynced: new Date().toISOString(),
                            enabled: true,
                            status: "current",
                        });
                        configManager.save();

                        console.log(chalk.green(`✓ Space added: ${spaceKey}`));
                        console.log(`Use "download --spaceKey ${spaceKey}" to download content`);

                        configManager.close();
                    } catch (error: unknown) {
                        console.error("Error:", error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                })
                .command("remove", "Remove a space", yargs =>
                    yargs.option("spaceKey", {
                        type: "string",
                        description: "Space key to remove",
                        demandOption: true,
                    }), async (argv) => {
                    try {
                        const configManager = new ConfigManager(argv.configPath as string);

                        // Check if space exists
                        const space = configManager.getSpaceConfig(argv.spaceKey!);
                        if (!space) {
                            console.error(`Space not found: ${argv.spaceKey}`);
                            process.exit(1);
                        }

                        // Confirm deletion
                        const shouldRemove = await confirm({
                            message:
                                `Are you sure you want to remove ${argv.spaceKey}? This will not delete downloaded content.`,
                            default: false,
                        });

                        if (shouldRemove) {
                            configManager.removeSpaceConfig(argv.spaceKey!);
                            configManager.save();
                            console.log(chalk.green(`✓ Space removed: ${argv.spaceKey}`));
                        } else {
                            console.log("Operation cancelled");
                        }

                        configManager.close();
                    } catch (error: unknown) {
                        console.error("Error:", error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                })
                .demandCommand();
        })
        .command("download", "Download Confluence space content", yargs =>
            yargs.option("spaceKey", {
                type: "string",
                description: "Space key to download",
                demandOption: true,
            }), async (argv) => {
            try {
                const configManager = new ConfigManager(argv.configPath as string);

                // Get space configuration
                const spaceConfig = configManager.getSpaceConfig(argv.spaceKey!);
                if (!spaceConfig) {
                    console.error(`Space not configured: ${argv.spaceKey}`);
                    console.log("Use \"spaces add\" to add the space first");
                    process.exit(1);
                }

                // Get API configuration
                const apiConfig = configManager.getApiConfig();
                if (!apiConfig.apiToken) {
                    console.error(
                        "API token not found in settings. Please set it with \"settings set --key apiToken --value TOKEN\"",
                    );
                    process.exit(1);
                }
                if (!apiConfig.baseUrl) {
                    console.error(
                        "Base URL not found in settings. Please set it with \"settings set --key baseUrl --value URL\"",
                    );
                    process.exit(1);
                }

                // Create progress bar
                singleBar = createProgressBar();

                console.log(`Downloading space ${spaceConfig.key} to ${spaceConfig.localPath}...`);

                // Create client and downloader
                const client = new ConfluenceClient(configManager);
                const downloader = new ContentStream(client, [spaceConfig.key]);

                // Download content
                await pipeline(downloader, new ContentWriter(configManager));

                // Update last synced timestamp
                configManager.updateSpaceLastSynced(spaceConfig.key);
                configManager.save();

                if (singleBar) {
                    singleBar.stop();
                    singleBar = null;
                }

                console.log(chalk.green(`✓ Space ${spaceConfig.key} successfully downloaded`));

                configManager.close();
            } catch (error: unknown) {
                console.error("Error:", error instanceof Error ? error.message : String(error));
                if (singleBar) {
                    singleBar.stop();
                    singleBar = null;
                }
                process.exit(1);
            }
        })
        .command("interactive", "Start interactive mode", yargs => yargs, async (argv) => {
            try {
                const { InteractiveConfluenceCLI } = await import("./interactive.js");
                const cli = new InteractiveConfluenceCLI(argv.configPath as string);
                await cli.start();
            } catch (error: unknown) {
                console.error("Error:", error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        })
        .command("$0", "Start interactive mode (default)", {}, async (argv) => {
            try {
                const { InteractiveConfluenceCLI } = await import("./interactive.js");
                const cli = new InteractiveConfluenceCLI(argv.configPath as string);
                await cli.start();
            } catch (error: unknown) {
                console.error("Error:", error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        })
        .help()
        .demandCommand(0, "Interactive mode will be used if no command is specified")
        .parse();

    // Initialize logger if debug flag is set
    if (argv.debug) {
        Logger.init({
            logToFile: true,
            logFilePath: argv.debugLogPath as string | undefined,
        });
        Logger.info("cli", "Debug logging enabled");
    }
}

main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
