import { confirm, input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import { select as selectPro } from "inquirer-select-pro";
import path, { resolve } from "path";
import { pipeline } from "stream/promises";
import { ConfluenceClient } from "./api-client.js";
import { ConfigManager, SpaceConfig } from "./config.js";
import { ContentStream, ContentWriter } from "./content-downloader.js";
import { toLowerKebabCase } from "./library.js";

export class InteractiveConfluenceCLI {
    private configManager: ConfigManager;
    private client: ConfluenceClient | null = null;
    private configPath: string | undefined;

    constructor(configPath?: string) {
        this.configPath = configPath;
        this.configManager = new ConfigManager(configPath);
    }

    async start(): Promise<void> {
        try {
            console.log(chalk.bold.blue("Confluence Downloader - Interactive Mode"));

            // Check if basic settings exist
            const apiConfig = this.configManager.getApiConfig();

            if (!apiConfig.baseUrl || !apiConfig.apiToken) {
                console.log(chalk.yellow("Initial setup required"));
                await this.setupInitialConfig();
            }

            // Main menu loop
            let exit = false;
            while (!exit) {
                const action = await select({
                    message: "Select an action:",
                    choices: [
                        { value: "list", name: "List configured spaces" },
                        { value: "add", name: "Add a new space" },
                        { value: "remove", name: "Remove a space" },
                        { value: "sync", name: "Download a space" },
                        { value: "syncAll", name: "Download all spaces" },
                        { value: "settings", name: "Configure global settings" },
                        { value: "exit", name: "Exit" },
                    ],
                });

                if (action === "exit") {
                    exit = true;
                } else {
                    await this.handleAction(action);
                }
            }

            console.log(chalk.green("Goodbye!"));
        } catch (error) {
            console.error(chalk.red("Error:"), error);
            process.exit(1);
        }
    }

    private formatSpaceChoice(space: SpaceConfig): string {
        const status = space.enabled ? chalk.green("✓ Enabled") : chalk.gray("✗ Disabled");
        const lastSynced = space.lastSynced
            ? new Date(space.lastSynced).toLocaleString()
            : "Never";

        return `${space.key} - ${space.name} [${status}]\n  Path: ${space.localPath}\n  Last synced: ${lastSynced}`;
    }

    private async setupInitialConfig(): Promise<void> {
        console.log(chalk.blue("Setting up initial configuration..."));

        // Get base URL
        const baseUrl = await input({
            message: "Enter your Confluence base URL (e.g., https://your-domain.atlassian.net):",
            validate: (value) => {
                if (!value) return "Base URL is required";
                if (!value.startsWith("http")) return "Base URL must start with http:// or https://";
                return true;
            },
        });

        // Get API token
        const apiToken = await password({
            message: "Enter your Confluence API token:",
            mask: "*",
            validate: (value) => value ? true : "API token is required",
        });

        // Set concurrency
        const concurrencyStr = await input({
            message: "Enter maximum concurrent requests (default: 5):",
            default: "5",
            validate: (value) => {
                const num = parseInt(value);
                if (isNaN(num) || num < 1) return "Must be a positive number";
                return true;
            },
        });

        const concurrency = parseInt(concurrencyStr);

        // Save configuration
        this.configManager.setApiConfig(baseUrl, apiToken, concurrency);
        this.configManager.save();

        console.log(chalk.green("✓ Configuration saved"));

        // Create API client
        this.client = new ConfluenceClient(this.configManager);
    }

    private async getOrCreateClient(): Promise<ConfluenceClient> {
        if (this.client) {
            return this.client;
        }

        // Get API configuration
        const apiConfig = this.configManager.getApiConfig();
        const baseUrl = apiConfig.baseUrl;
        const apiToken = apiConfig.apiToken;

        if (!baseUrl || !apiToken) {
            throw new Error("Base URL and API token must be configured. Use \"settings\" to configure them.");
        }

        this.client = new ConfluenceClient(this.configManager);

        return this.client;
    }

    private async listSpaces(): Promise<void> {
        const spaces = this.configManager.getAllSpaceConfigs();

        if (spaces.length === 0) {
            console.log(chalk.yellow("No spaces configured. Use \"add\" to add a space."));
            return;
        }

        console.log(chalk.bold("\nConfigured Spaces:"));
        for (const space of spaces) {
            console.log(`\n${this.formatSpaceChoice(space)}`);
        }
    }

    private async addSpace(): Promise<void> {
        const client = await this.getOrCreateClient();

        // Fetch available spaces from Confluence
        console.log(chalk.blue("Fetching available spaces from Confluence..."));
        const spaces = await client.getAllSpaces();

        if (spaces.length === 0) {
            console.log(chalk.yellow("No spaces found in your Confluence instance."));
            return;
        }

        // Get existing space configs
        const existingSpaces = this.configManager.getAllSpaceConfigs();
        const existingKeys = new Set(existingSpaces.map(s => s.key));

        // Filter out already configured spaces
        const availableSpaces = spaces.filter(s => !existingKeys.has(s.key));

        if (availableSpaces.length === 0) {
            console.log(chalk.yellow("All spaces from your Confluence instance are already configured."));
            return;
        }

        // Format choices for selection
        const choices = availableSpaces.map(space => ({
            value: space.key,
            name: `${space.key} - ${space.name}`,
        }));

        // Allow selecting multiple spaces
        const selectedSpaces = await selectPro({
            message: "Select spaces to add (use arrow keys to navigate, space to select, enter to confirm):",
            options: (input = "") => {
                return choices.filter(choice => choice.name.toLowerCase().includes(input.toLowerCase())) || [];
            },
            filter: true,
            multiple: true,
            required: true,
            clearInputWhenSelected: false,
        });

        const spaceKeys = Array.isArray(selectedSpaces) ? selectedSpaces : [selectedSpaces];

        if (spaceKeys.length === 0) {
            console.log(chalk.yellow("No spaces selected."));
            return;
        }

        // Get output directory for each space
        const spaceConfigs: SpaceConfig[] = [];

        for (const spaceKey of spaceKeys) {
            const spaceInfo = spaces.find(s => s.key === spaceKey)!;

            // Get output directory
            const defaultPath = path.join(this.configManager.relativePath(toLowerKebabCase(spaceInfo.name)));
            const outputDir = await input({
                message: `Enter local path for space ${spaceKey}:`,
                default: defaultPath,
            });

            // Create space config
            spaceConfigs.push({
                id: spaceInfo.id.toString(),
                key: spaceInfo.key,
                name: spaceInfo.name,
                description: spaceInfo.description,
                localPath: resolve(outputDir),
                lastSynced: new Date().toISOString(),
                enabled: true,
                status: "current",
            });
        }

        // Save space configs
        for (const config of spaceConfigs) {
            this.configManager.saveSpaceConfig(config);
        }
        this.configManager.save();

        console.log(chalk.green(`✓ Added ${spaceConfigs.length} space(s)`));

        // Ask if user wants to sync now
        const syncNow = await confirm({
            message: "Do you want to download these spaces now?",
            default: true,
        });

        if (syncNow) {
            for (const spaceKey of spaceKeys) {
                console.log(chalk.cyan(`\nSyncing space ${spaceKey}...`));
                const client = await this.getOrCreateClient();
                const downloader = new ContentStream(client, [spaceKey]);
                await pipeline(downloader, new ContentWriter(this.configManager));

                // Update last synced timestamp
                this.configManager.updateSpaceLastSynced(spaceKey);
                this.configManager.save();

                console.log(chalk.green(`✓ Space ${spaceKey} successfully downloaded`));
            }
        }
    }

    private async removeSpace(): Promise<void> {
        const spaces = this.configManager.getAllSpaceConfigs();

        if (spaces.length === 0) {
            console.log(chalk.yellow("No spaces configured."));
            return;
        }

        // Format choices for selection
        const choices = spaces.map(space => ({
            value: space.key,
            label: `${space.key} - ${space.name}`,
        }));

        // Select space to remove
        const spaceKey = await select({
            message: "Select a space to remove:",
            choices,
        });

        // Confirm removal
        const confirmed = await confirm({
            message: `Are you sure you want to remove ${spaceKey}? This will not delete downloaded content.`,
            default: false,
        });

        if (confirmed) {
            this.configManager.removeSpaceConfig(spaceKey);
            this.configManager.save();
            console.log(chalk.green(`✓ Space ${spaceKey} removed`));
        } else {
            console.log("Operation cancelled");
        }
    }

    private async downloadSpace(): Promise<void> {
        const spaces = this.configManager.getAllSpaceConfigs();

        if (spaces.length === 0) {
            console.log(chalk.yellow("No spaces configured. Use \"add space\" to add a space."));
            return;
        }

        // Choose a space to download
        const result = await select({
            message: "Select a space to download:",
            choices: spaces.map((space) => ({
                value: space.key,
                name: this.formatSpaceChoice(space),
            })),
        });
        const spaceKey = result as string;

        // Get space configuration
        const spaceConfig = this.configManager.getSpaceConfig(spaceKey);
        if (!spaceConfig) {
            console.log(chalk.red(`Space configuration not found for key: ${spaceKey}`));
            return;
        }

        // Confirm download
        const confirmed = await confirm({
            message: `Download space ${spaceConfig.name || spaceConfig.key}?`,
            default: true,
        });

        if (!confirmed) {
            console.log("Operation cancelled");
            return;
        }

        // Get client
        const client = await this.getOrCreateClient();

        console.log(
            chalk.cyan(`\nDownloading space ${spaceConfig.name || spaceConfig.key} to ${spaceConfig.localPath}...`),
        );

        try {
            // Create downloader and writer
            const downloader = new ContentStream(client, [spaceKey]);
            const writer = new ContentWriter(this.configManager);

            // Set up event listeners for tracking progress
            writer.on("pageWritten", (data: { count: number; pageTitle: string }) => {
                // Clear the current line
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
                // Display the current tally
                process.stdout.write(`Downloading: ${data.count} pages written (last: ${data.pageTitle})...`);
            });

            writer.on("finish", (data: { totalPages: number }) => {
                // Clear the current line
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
                // Display the final tally
                console.log(chalk.green(`✓ Downloaded ${data.totalPages} pages`));
            });

            // Download content
            await pipeline(downloader, writer);

            // Update last synced timestamp and save configuration
            this.configManager.updateSpaceLastSynced(spaceKey);
            this.configManager.save();

            console.log(chalk.green(`\n✓ Space ${spaceConfig.name || spaceConfig.key} successfully downloaded`));
        } catch (error) {
            console.error(chalk.red("Error downloading space:"), error);
        }
    }

    private async downloadAllSpaces(): Promise<void> {
        const spaces = this.configManager.getAllSpaceConfigs();
        const enabledSpaces = spaces.filter((space) => space.enabled);

        if (enabledSpaces.length === 0) {
            console.log(chalk.yellow("No enabled spaces found. Enable spaces using \"settings\"."));
            return;
        }

        // Confirm download
        const confirmed = await confirm({
            message: `Download all ${enabledSpaces.length} enabled spaces?`,
            default: true,
        });

        if (!confirmed) {
            console.log("Operation cancelled");
            return;
        }

        // Get client
        const client = await this.getOrCreateClient();

        console.log(chalk.cyan(`\nDownloading ${enabledSpaces.length} spaces...`));

        try {
            // Create downloader and writer
            const downloader = new ContentStream(client, enabledSpaces.map(s => s.key));
            const writer = new ContentWriter(this.configManager);

            // Set up event listeners for tracking progress
            let pagesCount = 0;

            writer.on("pageWritten", (data: { count: number; spaceKey: string; pageTitle: string }) => {
                // Clear the current line
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
                // Increment total count
                pagesCount = data.count;
                // Display the current tally
                process.stdout.write(
                    `Downloading all spaces: ${pagesCount} total pages written (last: ${data.spaceKey}/${data.pageTitle})...`,
                );
            });

            writer.on("finish", () => {
                // Clear the current line
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
                // Display the final tally
                console.log(chalk.green(`✓ Downloaded all spaces: ${pagesCount} total pages written`));
            });

            // Download content
            await pipeline(downloader, writer);

            // Update last synced for all spaces
            for (const space of enabledSpaces) {
                this.configManager.updateSpaceLastSynced(space.key);
                this.configManager.save();
            }

            console.log(chalk.green(`\n✓ All ${enabledSpaces.length} spaces successfully downloaded`));
        } catch (error) {
            console.error(chalk.red("Error downloading spaces:"), error);
        }
    }

    private async configureSettings(): Promise<void> {
        const settingsMenu = async (): Promise<boolean> => {
            const action = await select({
                message: "Settings:",
                choices: [
                    { value: "api", name: "Configure API settings" },
                    { value: "spaces", name: "Configure spaces" },
                    { value: "back", name: "Back to main menu" },
                ],
            });

            switch (action) {
                case "api":
                    await this.setupInitialConfig();
                    return true;

                case "spaces":
                    await this.configureSpaces();
                    return true;

                case "back":
                    return false;
            }

            return true;
        };

        let continueSettings = true;
        while (continueSettings) {
            continueSettings = await settingsMenu();
        }
    }

    private async configureSpaces(): Promise<void> {
        const spaces = this.configManager.getAllSpaceConfigs();

        if (spaces.length === 0) {
            console.log(chalk.yellow("No spaces configured. Use \"add\" to add a space."));
            return;
        }

        // Format choices for selection
        const choices = spaces.map(space => ({
            value: space.key,
            label: `${space.key} - ${space.name} [${space.enabled ? "Enabled" : "Disabled"}]`,
        }));

        // Select space to configure
        const spaceKey = await select({
            message: "Select a space to configure:",
            choices,
        });

        const space = this.configManager.getSpaceConfig(spaceKey);
        if (!space) {
            console.log(chalk.red(`Space configuration not found for ${spaceKey}`));
            return;
        }

        // Toggle enabled status
        const newStatus = !space.enabled;
        const confirmed = await confirm({
            message: `${newStatus ? "Enable" : "Disable"} space ${spaceKey}?`,
            default: true,
        });

        if (confirmed) {
            space.enabled = newStatus;
            this.configManager.saveSpaceConfig(space);
            this.configManager.save();
            console.log(chalk.green(`✓ Space ${spaceKey} ${newStatus ? "enabled" : "disabled"}`));
        } else {
            console.log("Operation cancelled");
        }
    }

    private async handleAction(action: string): Promise<void> {
        switch (action) {
            case "list":
                await this.listSpaces();
                break;

            case "add":
                await this.addSpace();
                break;

            case "remove":
                await this.removeSpace();
                break;

            case "sync":
                await this.downloadSpace();
                break;

            case "syncAll":
                await this.downloadAllSpaces();
                break;

            case "settings":
                await this.configureSettings();
                break;
        }
    }
}
