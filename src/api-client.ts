import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { pipeline, Readable, Transform } from "stream";
import { promisify } from "util";
import Logger from "./logger.js";
import type { ConfluenceComment, ConfluenceConfig, ConfluencePage, SpaceInfo } from "./types.js";

export class ConfluenceClient {
    private readonly baseUrl: string;
    private readonly apiToken: string;
    private readonly headers: HeadersInit;
    private readonly spaceKey: string;
    private readonly concurrency: number;
    private readonly config: ConfluenceConfig;
    private readonly logFile: string;
    private requestCount: number = 0;

    constructor(config: ConfluenceConfig) {
        this.baseUrl = config.baseUrl;
        this.apiToken = config.apiToken;
        this.spaceKey = config.spaceKey;
        this.concurrency = 1; // Disable concurrency
        this.config = config;

        // For Atlassian Cloud, the username is your email and the password is your API token
        const authString = Buffer.from(`${process.env.CONFLUENCE_EMAIL}:${this.apiToken}`).toString("base64");

        this.headers = {
            "Authorization": `Basic ${authString}`,
            "Content-Type": "application/json",
        };

        // Only set up legacy logging if explicitly enabled and we have an output directory
        if (config.enableLogging && config.outputDir) {
            // Set up legacy logging
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            this.logFile = path.join(config.outputDir, `confluence-fetch-${timestamp}.log`);

            // Ensure output directory exists before trying to create log file
            mkdir(config.outputDir, { recursive: true }).catch(error => {
                Logger.error("api", "Failed to create output directory", error);
            });

            // Initialize log file
            this.log("Confluence client initialized", {
                baseUrl: this.baseUrl,
                spaceKey: this.spaceKey,
                concurrency: this.concurrency,
            }).catch(error => {
                Logger.error("api", "Failed to write to log file", error);
            });
        } else {
            this.logFile = "";
        }

        // Log initialization with new debug logger
        Logger.info("api", "Confluence client initialized", {
            baseUrl: this.baseUrl,
            spaceKey: this.spaceKey,
            concurrency: this.concurrency,
        });
    }

    private async log(message: string, data?: Record<string, unknown>): Promise<void> {
        // Skip logging if no log file or logging is disabled
        if (!this.logFile || !this.config.enableLogging) {
            return;
        }
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, 2) + "\n" : ""}`;
        await appendFile(this.logFile, logEntry);
    }

    private async fetchJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
        this.requestCount++;
        const queryString = new URLSearchParams(
            Object.entries(params).map(([k, v]) => [k, v.toString()]),
        ).toString();

        const url = `${this.baseUrl}/wiki${path}${queryString ? "?" + queryString : ""}`;

        // Log request
        await this.log(`Request #${this.requestCount}: ${url}`, {
            method: "GET",
            headers: this.headers,
            params,
        });

        const startTime = Date.now();
        try {
            const response = await fetch(url, {
                headers: this.headers,
            });

            const endTime = Date.now();
            const duration = endTime - startTime;

            if (!response.ok) {
                const text = await response.text();
                await this.log(`Error Response #${this.requestCount} (${duration}ms)`, {
                    status: response.status,
                    statusText: response.statusText,
                    body: text,
                });
                throw new Error(`Request failed with status code ${response.status}: ${text}`);
            }

            const data = await response.json();
            await this.log(`Response #${this.requestCount} (${duration}ms)`, {
                status: response.status,
                headers: Object.fromEntries(response.headers),
                bodyPreview: this.truncateForLog(data),
            });

            return data as T;
        } catch (error) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            await this.log(`Fetch Error #${this.requestCount} (${duration}ms)`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            throw error;
        }
    }

    private truncateForLog(data: unknown): unknown {
        if (typeof data !== "object" || data === null) {
            return data;
        }

        if (Array.isArray(data)) {
            return data.map(item => this.truncateForLog(item));
        }

        const truncated: Record<string, unknown> = {};
        const record = data as Record<string, unknown>;

        for (const [key, value] of Object.entries(record)) {
            if (typeof value === "string" && value.length > 500) {
                truncated[key] = value.substring(0, 500) + "... [truncated]";
            } else if (Array.isArray(value)) {
                truncated[key] = `Array(${value.length}) [${value.slice(0, 3).map(v => typeof v).join(", ")}...]`;
            } else if (typeof value === "object" && value !== null) {
                truncated[key] = this.truncateForLog(value);
            } else {
                truncated[key] = value;
            }
        }
        return truncated;
    }

    private async getPageDetails(pageId: string): Promise<Partial<ConfluencePage>> {
        const response = await this.fetchJson<ConfluencePage>(`/rest/api/content/${pageId}`, {
            expand: "metadata.labels,history.lastUpdated,history.createdBy,version,space,children.page",
        });
        return response;
    }

    async getSpaceInfo(spaceKey?: string): Promise<SpaceInfo> {
        const key = spaceKey || this.spaceKey;
        const response = await this.fetchJson<SpaceInfo>(`/rest/api/space/${key}`, {
            expand: "description.plain,children.page,metadata,settings,homepage.descendants.page",
        });
        return response;
    }

    async getPageCount(spaceKey: string): Promise<number> {
        const cql = `type=page and space='${spaceKey}'`;
        const response = await this.fetchJson<{
            totalSize: number;
        }>(`/rest/api/search`, {
            cql,
            limit: 1,
        });
        return response.totalSize;

        // this.config.onProgress?.("Counting total pages...");
        // const response = await this.fetchJson<{
        //     results: Array<{ id: string }>;
        //     _links: {
        //         next?: string;
        //     };
        // }>("/api/v2/spaces", {
        //     keys: spaceKey,
        // });

        // if (response.results.length === 0) {
        //     return 0;
        // }

        // const spaceId = response.results[0].id;
        // let totalPages = 0;
        // let cursor: string | undefined;

        // do {
        //     const pagesResponse = await this.fetchJson<{
        //         results: Array<{ id: string }>;
        //         _links: {
        //             next?: string;
        //         };
        //     }>(`/api/v2/spaces/${spaceId}/pages`, {
        //         limit: 250,
        //         ...(cursor ? { cursor } : {}),
        //     });

        //     totalPages += pagesResponse.results.length;

        //     // Get cursor from next link if it exists
        //     const nextLink = pagesResponse._links.next;
        //     cursor = nextLink ? new URLSearchParams(nextLink.split("?")[1]).get("cursor") || undefined : undefined;
        // } while (cursor);
    }

    async getAllSpaces(): Promise<SpaceInfo[]> {
        const spaces: SpaceInfo[] = [];
        let start = 0;
        const limit = 100;

        while (true) {
            const response = await this.fetchJson<{
                results: SpaceInfo[];
            }>("/rest/api/space", {
                expand: "description.plain",
                start,
                limit,
            });

            spaces.push(...response.results);

            if (response.results.length < limit) {
                break;
            }
            start += limit;
        }

        return spaces;
    }

    async getAllPages(space: SpaceInfo): Promise<ConfluencePage[]> {
        // First, get the total page count
        this.config.onProgress?.("Counting pages in space...");
        const totalPages = await this.getPageCount(space.key);
        if (totalPages === 0) {
            this.config.onProgress?.("No pages found");
            return [];
        }

        const pages: ConfluencePage[] = [];
        let completedPages = 0;

        // Create the pipeline
        const pipelineAsync = promisify(pipeline);
        await pipelineAsync(
            this.createPageStream(space.id.toString(), totalPages),
            this.createHierarchyTransform(),
            this.createMetadataTransform(),
            new Transform({
                objectMode: true,
                transform: (page: ConfluencePage, encoding, callback) => {
                    pages.push(page);
                    completedPages++;
                    const progress = Math.round((completedPages / totalPages) * 100);
                    this.config.onProgress?.(`Processing pages... ${progress}% (${completedPages}/${totalPages})`);
                    callback();
                },
            }),
        );

        return pages;
    }

    private createPageStream(spaceId: string, totalPages: number): Readable {
        let cursor: string | undefined;
        let downloadedPages = 0;
        const limit = 100;

        const stream = new Readable({
            objectMode: true,
            read: async () => {
                try {
                    if (downloadedPages >= totalPages) {
                        stream.push(null);
                        return;
                    }

                    interface PageResponse {
                        id: string;
                        title: string;
                        body: {
                            storage: {
                                value: string;
                            };
                        };
                        _links: {
                            webui: string;
                        };
                        parentId?: string;
                        parentType?: string;
                    }

                    const response = await this.fetchJson<{
                        results: PageResponse[];
                        _links: { next?: string };
                    }>(`/api/v2/spaces/${spaceId}/pages`, {
                        limit,
                        ...(cursor ? { cursor } : {}),
                        "body-format": "storage",
                    });

                    // Convert and push each page individually
                    for (const page of response.results) {
                        const convertedPage = {
                            id: page.id,
                            title: page.title,
                            body: {
                                storage: {
                                    value: page.body.storage.value,
                                    representation: "storage",
                                },
                            },
                            _links: {
                                webui: page._links.webui,
                            },
                            ancestors: [],
                            space: {
                                key: this.spaceKey,
                            },
                            children: {
                                page: {
                                    results: [],
                                },
                            },
                            _v2: {
                                parentId: page.parentId,
                                parentType: page.parentType,
                            },
                        };
                        stream.push(convertedPage);
                        downloadedPages++;
                    }

                    // Get next cursor
                    const nextLink = response._links.next;
                    cursor = nextLink
                        ? new URLSearchParams(nextLink.split("?")[1]).get("cursor") || undefined
                        : undefined;

                    if (!cursor) {
                        stream.push(null);
                    }
                } catch (error) {
                    stream.emit("error", error);
                }
            },
        });

        return stream;
    }

    private createHierarchyTransform(): Transform {
        const pageMap = new Map<string, ConfluencePage>();
        const pages: ConfluencePage[] = [];

        return new Transform({
            objectMode: true,
            transform(page: ConfluencePage, encoding, callback) {
                pages.push(page);
                pageMap.set(page.id, page);
                callback();
            },
            flush(callback) {
                // Build hierarchy once we have all pages
                for (const page of pages) {
                    if (page._v2?.parentId && page._v2.parentType === "page") {
                        const parentPage = pageMap.get(page._v2.parentId);
                        if (parentPage) {
                            if (!parentPage.children?.page?.results) {
                                const children = {
                                    page: {
                                        results: [],
                                    },
                                } as NonNullable<ConfluencePage["children"]>;
                                parentPage.children = children;
                            }

                            (parentPage.children!.page!.results).push({
                                id: page.id,
                                title: page.title,
                            });
                        }
                    }
                }

                // Second pass: Build ancestors and push pages
                for (const page of pages) {
                    const ancestors: Array<{ id: string; title: string }> = [];
                    let currentPage = page;

                    while (currentPage._v2?.parentId && currentPage._v2.parentType === "page") {
                        const parentPage = pageMap.get(currentPage._v2.parentId);
                        if (!parentPage) break;

                        ancestors.unshift({
                            id: parentPage.id,
                            title: parentPage.title,
                        });
                        currentPage = parentPage;
                    }

                    page.ancestors = ancestors;
                    delete page._v2;
                    this.push(page);
                }

                callback();
            },
        });
    }

    private createMetadataTransform(): Transform {
        const batchSize = 100;
        let currentBatch: ConfluencePage[] = [];
        const transform = new Transform({
            objectMode: true,
            transform: (page: ConfluencePage, encoding, callback) => {
                currentBatch.push(page);

                if (currentBatch.length >= batchSize) {
                    this.processBatch(currentBatch, transform)
                        .then(() => {
                            currentBatch = [];
                            callback();
                        })
                        .catch(callback);
                } else {
                    callback();
                }
            },
            flush: (callback) => {
                if (currentBatch.length > 0) {
                    this.processBatch(currentBatch, transform)
                        .then(() => callback())
                        .catch(callback);
                } else {
                    callback();
                }
            },
        });

        return transform;
    }

    private async processBatch(batch: ConfluencePage[], stream: Transform) {
        const enrichedPages = await Promise.all(
            batch.map(async (page) => {
                try {
                    const details = await this.getPageDetails(page.id);
                    return {
                        ...page,
                        metadata: details.metadata,
                        history: details.history,
                        version: details.version,
                        space: details.space,
                        children: details.children,
                    };
                } catch {
                    return page;
                }
            }),
        );

        for (const page of enrichedPages) {
            stream.push(page);
        }
    }

    async getComments(pageId: string): Promise<ConfluenceComment[]> {
        try {
            // Get all comments related to the page, including inline comments
            const response = await this.fetchJson<{
                results: ConfluenceComment[];
            }>(`/rest/api/content/${pageId}/child/comment`, {
                expand:
                    "body.storage,extensions,version,history,history.createdBy,history.lastUpdated,creator,extensions.inlineProperties",
                limit: 100, // Increase limit to make sure we get all comments
            });

            if (this.config.enableLogging) {
                await this.log(`Retrieved ${response.results.length} comments for page ${pageId}`);

                // Log a sample comment to debug
                if (response.results.length > 0) {
                    await this.log(
                        `Sample comment structure:`,
                        this.truncateForLog(response.results[0]) as Record<string, unknown>,
                    );
                }
            }

            // Also log with the new logger
            Logger.debug("api", `Retrieved ${response.results.length} comments for page ${pageId}`);

            if (response.results.length > 0) {
                Logger.trace("api", "Sample comment structure", this.truncateForLog(response.results[0]));
            }

            return response.results;
        } catch (error) {
            Logger.error("api", `Error fetching comments for page ${pageId}`, error);
            return [];
        }
    }
}
