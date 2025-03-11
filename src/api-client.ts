import { ConfigManager } from "./config.js";
import Logger from "./logger.js";
import type { SpaceInfo } from "./types.js";

export class ConfluenceClient {
    public readonly baseUrl: string;
    public readonly apiToken: string;
    public readonly concurrency: number;
    private readonly configManager: ConfigManager;
    private readonly headers: HeadersInit;
    private requestCount: number = 0;

    constructor(config: ConfigManager) {
        this.configManager = config;

        // Get API configuration from the ConfigManager
        const apiConfig = this.configManager.getApiConfig();
        this.baseUrl = apiConfig.baseUrl;
        this.apiToken = apiConfig.apiToken;
        this.concurrency = apiConfig.concurrency || 1;

        // For Atlassian Cloud, the username is your email and the password is your API token
        const authString = Buffer.from(`${process.env.CONFLUENCE_EMAIL}:${this.apiToken}`).toString("base64");

        this.headers = {
            "Authorization": `Basic ${authString}`,
            "Content-Type": "application/json",
        };

        // Log initialization with new debug logger
        Logger.info("api", "Confluence client initialized", {
            baseUrl: this.baseUrl,
            concurrency: this.concurrency,
        });
    }

    public async fetchJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
        const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}/wiki${path}`);

        // Add query parameters
        Object.keys(params).forEach((key) => {
            url.searchParams.append(key, params[key].toString());
        });

        this.requestCount++;

        try {
            Logger.debug("api", `Fetching ${url.toString()}`);

            const response = await fetch(url.toString(), {
                method: "GET",
                headers: this.headers,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error ${response.status}: ${errorText}`);
            }

            const data = await response.json();

            return data as T;
        } catch (error) {
            Logger.error("api", `Failed to fetch from ${url.toString()}`, error);
            throw error;
        }
    }

    private truncateForLog(data: unknown): unknown {
        if (data === null || data === undefined) {
            return data;
        }

        if (typeof data === "object") {
            if (Array.isArray(data)) {
                if (data.length > 10) {
                    return [...data.slice(0, 10), `... (${data.length - 10} more items)`];
                }
                return data.map((item) => this.truncateForLog(item));
            }

            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
                if (key === "body" && typeof value === "object" && value !== null) {
                    // Truncate page content to avoid large log files
                    const truncatedBody: Record<string, unknown> = {};
                    for (const [bodyKey, bodyValue] of Object.entries(value)) {
                        if (typeof bodyValue === "object" && bodyValue !== null && "value" in (bodyValue as object)) {
                            const valueContent = (bodyValue as { value: string }).value;
                            truncatedBody[bodyKey] = {
                                ...bodyValue,
                                value: `${valueContent.substring(0, 100)}... (${valueContent.length} chars)`,
                            };
                        } else {
                            truncatedBody[bodyKey] = bodyValue;
                        }
                    }
                    result[key] = truncatedBody;
                } else {
                    result[key] = this.truncateForLog(value);
                }
            }
            return result;
        }

        return data;
    }

    // private async getPageDetails(pageId: string): Promise<Partial<ConfluencePage>> {
    //     // Use v2 API to get page details
    //     const page = await this.fetchJson<any>(`/api/v2/pages/${pageId}`, {
    //         "body-format": "atlas_doc_format"
    //     });

    //     return page;
    // }

    async getSpaceInfo(spaceKey: string): Promise<SpaceInfo> {
        const key = spaceKey;
        // Using v2 API for space information
        const space = await this.fetchJson<{ results: SpaceInfo[] }>(`/api/v2/spaces`, {
            limit: 1,
            start: 0,
            keys: key,
        });
        return space.results[0];
    }

    async getAllSpaces(): Promise<SpaceInfo[]> {
        const allSpaces: SpaceInfo[] = [];
        let cursor: string | null = null;

        do {
            const response: {
                results: SpaceInfo[];
                _links: { next?: string };
            } = await this.fetchJson<{ results: SpaceInfo[]; _links: { next?: string } }>(`/api/v2/spaces`, {
                limit: 250,
                ...(cursor ? { cursor } : {}),
            });

            allSpaces.push(...response.results);

            // Get the next cursor if available
            if (response._links.next) {
                const nextUrl = new URL(response._links.next, this.baseUrl);
                cursor = nextUrl.searchParams.get("cursor");
            } else {
                cursor = null;
            }
        } while (cursor);

        return allSpaces;
    }
}
