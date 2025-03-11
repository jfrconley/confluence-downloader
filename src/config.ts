import fs from "fs";
import path, { resolve } from "path";
import { ConfluenceStatus } from "./content-downloader.js";
import Logger from "./logger.js";

/**
 * Configuration interface for the Confluence API
 */
export interface ConfluenceApiConfig {
    baseUrl: string;
    apiToken: string;
    concurrency?: number;
}

/**
 * Space configuration interface
 */
export interface SpaceConfig {
    id: string;
    key: string;
    name: string;
    description?: string;
    localPath: string;
    lastSynced?: string;
    enabled: boolean;
    status: ConfluenceStatus;
}

/**
 * Complete configuration interface
 */
export interface ConfluenceConfig {
    api: ConfluenceApiConfig;
    spaces: SpaceConfig[];
    settings: Record<string, string>;
}

/**
 * Configuration manager for the Confluence downloader
 * Handles reading and writing configuration to a JSON file
 */
export class ConfigManager {
    private configPath: string;
    private configDir: string;
    private config: ConfluenceConfig | null = null;

    /**
     * Create a new configuration manager
     * @param configPath Optional path to the configuration file
     */
    constructor(configPath?: string) {
        if (configPath) {
            this.configPath = path.resolve(process.cwd(), configPath);
        } else {
            // Default location if not specified
            this.configPath = path.join(process.cwd(), "confluence.json");
        }
        this.configDir = path.dirname(this.configPath);
        // Load configuration automatically
        this.load();
    }

    public relativePath(path: string): string {
        return resolve(this.configDir, path);
    }

    /**
     * Load the configuration
     * Creates the config file if it doesn't exist
     */
    load(): void {
        try {
            // Create directory if it doesn't exist
            fs.mkdirSync(path.dirname(this.configPath), { recursive: true });

            // Try to load existing config
            try {
                const fileData = fs.readFileSync(this.configPath, "utf-8");
                this.config = JSON.parse(fileData);
                Logger.info("db", `Configuration loaded from ${this.configPath}`);
            } catch (error: unknown) {
                // File doesn't exist or is invalid, create a new one
                const err = error as { code?: string };
                if (err.code === "ENOENT" || error instanceof SyntaxError) {
                    this.config = {
                        api: {
                            baseUrl: "",
                            apiToken: "",
                            concurrency: 5,
                        },
                        spaces: [],
                        settings: {},
                    };
                    this.save();
                    Logger.info("db", `New configuration created at ${this.configPath}`);
                } else {
                    throw error;
                }
            }
        } catch (error) {
            Logger.error("db", "Failed to load configuration", error);
            throw error;
        }
    }

    /**
     * Reload the configuration from disk
     * Useful if the file might have been modified externally
     */
    reload(): void {
        this.load();
    }

    /**
     * Save the configuration to disk
     */
    save(): void {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }

        try {
            fs.writeFileSync(
                this.configPath,
                JSON.stringify(this.config, null, 2),
                "utf-8",
            );
            Logger.debug("db", `Configuration saved to ${this.configPath}`);
        } catch (error) {
            Logger.error("db", "Failed to save configuration", error);
            throw error;
        }
    }

    /**
     * Get the API configuration
     */
    getApiConfig(): ConfluenceApiConfig {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        return this.config.api;
    }

    /**
     * Set the API configuration
     */
    setApiConfig(baseUrl: string, apiToken: string, concurrency?: number): void {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }

        this.config.api = {
            baseUrl,
            apiToken,
            concurrency: concurrency || 5,
        };
    }

    /**
     * Get a setting value
     */
    getSetting(key: string): string | undefined {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        return this.config.settings[key];
    }

    /**
     * Set a setting value
     */
    setSetting(key: string, value: string): void {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        this.config.settings[key] = value;
    }

    /**
     * Get all settings
     */
    getAllSettings(): Record<string, string> {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        return { ...this.config.settings };
    }

    /**
     * Remove a setting
     */
    removeSetting(key: string): void {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        delete this.config.settings[key];
    }

    /**
     * Get a space configuration by key
     */
    getSpaceConfig(spaceKey: string): SpaceConfig | undefined {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        return this.config.spaces.find(space => space.key === spaceKey);
    }

    getResolvedPathToSpace(spaceKey: string) {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        const spaceConfig = this.getSpaceConfig(spaceKey);
        if (!spaceConfig?.localPath) {
            return;
        }
        return path.resolve(this.configPath, spaceConfig.localPath);
    }

    /**
     * Save a space configuration
     */
    saveSpaceConfig(spaceConfig: SpaceConfig): void {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }

        const index = this.config.spaces.findIndex(space => space.key === spaceConfig.key);

        if (index >= 0) {
            // Update existing space
            this.config.spaces[index] = spaceConfig;
        } else {
            // Add new space
            this.config.spaces.push(spaceConfig);
        }

        Logger.info("db", `Space configuration saved: ${spaceConfig.key}`);
    }

    /**
     * Get all space configurations
     */
    getAllSpaceConfigs(): SpaceConfig[] {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        return [...this.config.spaces];
    }

    /**
     * Remove a space configuration
     */
    removeSpaceConfig(spaceKey: string): void {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }

        const index = this.config.spaces.findIndex(space => space.key === spaceKey);

        if (index >= 0) {
            this.config.spaces.splice(index, 1);
            Logger.info("db", `Space configuration removed: ${spaceKey}`);
        }
    }

    /**
     * Update a space's last synced timestamp
     */
    updateSpaceLastSynced(spaceKey: string, timestamp: string = new Date().toISOString()): void {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }

        const space = this.config.spaces.find(space => space.key === spaceKey);

        if (space) {
            space.lastSynced = timestamp;
        }
    }

    /**
     * Get the base configuration
     * For API compatibility with DatabaseHandler
     */
    getBaseConfiguration(): { baseUrl?: string; apiToken?: string; concurrency?: number } {
        if (!this.config) {
            throw new Error("Configuration not loaded");
        }
        return {
            baseUrl: this.config.api.baseUrl,
            apiToken: this.config.api.apiToken,
            concurrency: this.config.api.concurrency,
        };
    }

    /**
     * Close the configuration manager
     * For API compatibility with DatabaseHandler
     */
    close(): void {
        // Save any pending changes
        if (this.config) {
            this.save();
        }
    }
}
