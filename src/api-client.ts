import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { pipeline, Readable, Transform, Writable } from "stream";
import { promisify } from "util";
import Logger from "./logger.js";
import type { ConfluenceComment, ConfluenceConfig, ConfluencePage, SpaceInfo } from "./types.js";
// import type { MarkdownConverter } from "./markdown-converter.js";
import { ADFMarkdownConverter } from "./adf-markdown-converter.js";
import type { FileSystemHandler } from "./fs-handler.js";


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
        this.concurrency = config.concurrency || 1;
        this.config = config;

        // For Atlassian Cloud, the username is your email and the password is your API token
        const authString = Buffer.from(`${process.env.CONFLUENCE_EMAIL}:${this.apiToken}`).toString("base64");

        this.headers = {
            "Authorization": `Basic ${authString}`,
            "Content-Type": "application/json",
        };

        // Only set up legacy logging if explicitly enabled and we have an output directory
        if (this.config.debugOptions?.logToFile && this.config.outputDir) {
            const logDir = this.config.debugOptions.logDir || path.join(this.config.outputDir, "logs");
            const logFile = this.config.debugOptions.logFilePath || `${new Date().toISOString().replace(/:/g, "-")}.log`;
            this.logFile = path.join(logDir, logFile);

            // Ensure log directory exists
            mkdir(logDir, { recursive: true }).catch((err) => {
                Logger.error("api", "Failed to create log directory", err);
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
        if (!this.logFile) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n${data ? JSON.stringify(this.truncateForLog(data), null, 2) + "\n" : ""}`;

        try {
            await appendFile(this.logFile, logEntry);
        } catch (error) {
            Logger.error("api", `Failed to write to log file: ${this.logFile}`, error);
        }
    }

    private async fetchJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
        let url = new URL(path.startsWith("http") ? path : `${this.baseUrl}/wiki${path}`);
        
        // Add query parameters
        Object.keys(params).forEach((key) => {
            url.searchParams.append(key, params[key].toString());
        });

        this.requestCount++;
        const reqId = this.requestCount;
        const startTime = Date.now();

        try {
            if (this.config.enableLogging) {
                await this.log(`Request #${reqId} - ${url.toString()}`, { params });
            }

            const response = await fetch(url.toString(), {
                method: "GET",
                headers: this.headers,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            
            if (this.config.enableLogging) {
                const endTime = Date.now();
                await this.log(
                    `Response #${reqId} - ${endTime - startTime}ms`, 
                    this.truncateForLog(data) as Record<string, unknown>
                );
            }

            return data as T;
        } catch (error) {
            Logger.error("api", `Failed to fetch from ${url.toString()}`, error);
            if (this.config.enableLogging) {
                await this.log(`Error #${reqId}`, { error: String(error) });
            }
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

    private async getPageDetails(pageId: string): Promise<Partial<ConfluencePage>> {
        // Use v2 API to get page details
        const page = await this.fetchJson<any>(`/api/v2/pages/${pageId}`, {
            "body-format": "atlas_doc_format"
        });

        return page;
    }

    async getSpaceInfo(spaceKey?: string): Promise<SpaceInfo> {
        const key = spaceKey || this.spaceKey;
        // Using v2 API for space information
        const space = await this.fetchJson<{results: SpaceInfo[]}>(`/api/v2/spaces`, {
            limit: 1,
            start: 0,
            keys: key
        });
        return space.results[0];
    }

    async getPageCount(spaceKey: string): Promise<number> {
        try {
            // get page count using CQL
            const response = await this.fetchJson<{
                results: {
                    count: number;
                }[];
            }>(`/rest/api/content/search`, {
                cql: `space='${spaceKey}' and (type=page or type=comment or type=folder)`,
                expand: 'container,children,descendants,ancestors,body.atlas_doc_format,metadata,extensions.inlineProperties,extensions.resolution,metadata.labels,metadata.properties,history,metadata.comments'
            });
            return response.results[0].count;
        } catch (error) {
            Logger.error("api", `Failed to get page count for space: ${spaceKey}`, error);
            return 0;
        }
    }

    async getAllSpaces(): Promise<SpaceInfo[]> {
        const allSpaces: SpaceInfo[] = [];
        let cursor: string | null = null;
        
        do {
            const response: {
                results: SpaceInfo[], 
                _links: {next?: string}
            } = await this.fetchJson<{results: SpaceInfo[], _links: {next?: string}}>(`/api/v2/spaces`, {
                limit: 250,
                ...(cursor ? { cursor } : {})
            });
            
            allSpaces.push(...response.results);
            
            // Get the next cursor if available
            if (response._links.next) {
                const nextUrl = new URL(response._links.next, this.baseUrl);
                cursor = nextUrl.searchParams.get('cursor');
            } else {
                cursor = null;
            }
        } while (cursor);
        
        return allSpaces;
    }

    async createUnifiedPagePipeline(
        space: SpaceInfo, 
        converter: ADFMarkdownConverter, 
        fsHandler: FileSystemHandler, 
        debugStream: NodeJS.WritableStream | null = null
    ): Promise<{ totalPages: number; processedPages: number; errors: Array<{ page: ConfluencePage, error: unknown }> }> {
        // First, get the total page count
        this.config.onProgress?.("Counting pages in space...");
        const totalPages = await this.getPageCount(space.key);
        if (totalPages === 0) {
            this.config.onProgress?.("No pages found");
            return { totalPages: 0, processedPages: 0, errors: [] };
        }

        let processedPages = 0;
        const errors: Array<{ page: ConfluencePage, error: unknown }> = [];

        // Create the pipeline
        const pipelineAsync = promisify(pipeline);
        
        // Create a transform that fetches comments, converts to markdown, and writes to filesystem
        const processingTransform = new Writable({
            objectMode: true,
            write: async (page: ConfluencePage, encoding, callback) => {
                try {
                    // Fetch both inline and footer comments for the page using v2 API
                    const [inlineComments, footerComments] = await Promise.all([
                        this.getInlineComments(page.id),
                        this.getFooterComments(page.id)
                    ]);
                    
                    // Combine all comments
                    const comments = [...inlineComments, ...footerComments];
                    
                    if (debugStream && comments.length > 0) {
                        debugStream.write(
                            "Page: " + page.id + "\n" + JSON.stringify(page, null, 2) + "\n"
                                + "Comments: \n" + JSON.stringify(comments, null, 2) + "\n"
                        );
                    }

                    // Convert the page to markdown
                    const markdown = converter.convertPage(page, comments);
                    
                    if (debugStream && comments.length > 0) {
                        debugStream.write("Markdown: \n" + markdown + "\n");
                    }

                    // Write the page to the filesystem
                    await fsHandler.writePage(page, markdown);
                    
                    processedPages++;
                    const progress = Math.round((processedPages / totalPages) * 100);
                    this.config.onProgress?.(`Processing pages... ${progress}% (${processedPages}/${totalPages})`);
                    
                    callback();
                } catch (error) {
                    errors.push({ page, error });
                    Logger.error("api", `Error processing page ${page.title} (ID: ${page.id})`, error);
                    
                    if (debugStream) {
                        debugStream.write(`ERROR PROCESSING PAGE: ${page.id} (${page.title})\n`);
                        debugStream.write(`Error: ${error}\n`);
                        debugStream.write(
                            `Stack: ${error instanceof Error ? error.stack : "No stack trace available"}\n`
                        );
                    }
                    
                    callback();
                }
            }
        });

        // Create a pipeline with all transforms
        // We'll use both hierarchy and metadata transforms 
        await pipelineAsync(
            this.createPageStream(space.id.toString(), totalPages),
            this.createHierarchyTransform(),
            this.createMetadataTransform(),
            processingTransform
        );

        return { totalPages, processedPages, errors };
    }

    private createPageStream(spaceId: string, totalPages: number): Readable {
        let cursor: string | undefined;
        let downloadedPages = 0;
        const limit = 250; // Maximum allowed by v2 API

        const stream = new Readable({
            objectMode: true,
            read: async () => {
                try {
                    if (downloadedPages >= totalPages) {
                        stream.push(null);
                        return;
                    }

                    // Use v2 API to get pages
                    const response = await this.fetchJson<{
                        results: any[]; 
                        _links: { next?: string };
                    }>(`/api/v2/spaces/${spaceId}/pages`, {
                        limit,
                        ...(cursor ? { cursor } : {}),
                        "body-format": "atlas_doc_format",
                    });

                    // Process pages in batches for efficiency
                    const pageIds = response.results.map(page => page.id);
                    
                    // Fetch detailed page info for each page in batches
                    const detailBatches = [];
                    const batchSize = 10; // Process 10 pages at a time
                    
                    for (let i = 0; i < pageIds.length; i += batchSize) {
                        const batch = pageIds.slice(i, i + batchSize);
                        detailBatches.push(batch);
                    }
                    
                    // Process each batch
                    for (const batch of detailBatches) {
                        // Get detailed info for each page in the batch in parallel
                        const detailedPages = await Promise.all(
                            batch.map(id => this.fetchJson<any>(`/api/v2/pages/${id}`, {
                                "body-format": "atlas_doc_format"
                            }))
                        );
                        
                        // Convert and push each detailed page
                        for (const page of detailedPages) {
                            // Convert v2 API format to the expected ConfluencePage format
                            const convertedPage: ConfluencePage = {
                                id: page.id,
                                title: page.title,
                                body: {
                                    storage: {
                                        value: page.body?.storage?.value || "",
                                        representation: "storage",
                                        embeddedContent: []
                                    },
                                    atlas_doc_format: {
                                        value: page.body?.atlas_doc_format?.value || "",
                                    },
                                },
                                _links: {
                                    webui: page._links?.webui || "",
                                    self: page._links?.self || "",
                                },
                                ancestors: [], // Will be populated by the hierarchy transform
                                space: {
                                    key: this.spaceKey,
                                    id: parseInt(spaceId),
                                },
                                children: {
                                    page: {
                                        results: [],
                                    },
                                },
                                _v2: {
                                    parentId: page.parentId,
                                    parentType: page.parentType || "page",
                                },
                            };
                            
                            stream.push(convertedPage);
                            downloadedPages++;
                        }
                    }

                    // Get next cursor from response
                    if (response._links.next) {
                        const nextUrl = new URL(response._links.next, this.baseUrl);
                        cursor = nextUrl.searchParams.get('cursor') || undefined;
                    } else {
                        cursor = undefined;
                        stream.push(null); // No more pages
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
        const fetchJson = this.fetchJson.bind(this);

        return new Transform({
            objectMode: true,
            transform(page: ConfluencePage, encoding, callback) {
                pages.push(page);
                pageMap.set(page.id, page);
                callback();
            },
            async flush(callback) {
                try {
                    // Improved hierarchy building using v2 API ancestor data
                    // Process pages in small batches to avoid overwhelming the API
                    const batchSize = 10;
                    const batches = [];
                    
                    for (let i = 0; i < pages.length; i += batchSize) {
                        batches.push(pages.slice(i, i + batchSize));
                    }
                    
                    for (const batch of batches) {
                        await Promise.all(batch.map(async (page) => {
                            try {
                                // Skip pages with no parentId
                                if (!page._v2?.parentId) return;
                                
                                // Get ancestors for this page
                                const ancestorsUrl = `/api/v2/pages/${page.id}/ancestors`;
                                
                                // Use any here since 'this' is dynamically bound within the transform
                                const ancestorsResponse = await fetchJson(ancestorsUrl) as {
                                    results: Array<{ id: string, type: string }>;
                                };
                                
                                // Store ancestor information
                                page.ancestors = ancestorsResponse.results.map((ancestor: { id: string, type: string }) => ({
                                    id: ancestor.id,
                                    title: pageMap.get(ancestor.id)?.title || "Unknown",
                                }));
                                
                                // Also update parent-child relationships if parentId is available
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
                                        
                                        // Add this page as a child of the parent
                                        (parentPage.children!.page!.results).push({
                                            id: page.id,
                                            title: page.title,
                                        });
                                    }
                                }
                            } catch (error) {
                                console.error(`Error getting ancestors for page ${page.id}:`, error);
                            }
                        }));
                    }
                    
                    // Push all processed pages to the stream
                    for (const page of pages) {
                        this.push(page);
                    }
                    
                    callback();
                } catch (error: any) {
                    callback(error);
                }
            },
        });
    }

    private createMetadataTransform(): Transform {
        const batchSize = 25;
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
        // Process the pages in batches efficiently
        const enrichedPages = await Promise.all(
            batch.map(async (page) => {
                try {
                    // Fetch children for pages in parallel
                    const childrenUrl = `/api/v2/pages/${page.id}/children`;
                    const childrenResponse = await this.fetchJson<{
                        results: Array<{
                            id: string;
                            title: string;
                            status: string;
                            spaceId: string;
                        }>;
                    }>(childrenUrl);
                    
                    // Only update children if we have results
                    if (childrenResponse.results && childrenResponse.results.length > 0) {
                        if (!page.children) {
                            page.children = {
                                page: { results: [] }
                            };
                        }
                        
                        // Map the v2 API response to the expected format
                        page.children.page!.results = childrenResponse.results.map(child => ({
                            id: child.id,
                            title: child.title
                        }));
                    }
                    
                    return page;
                } catch (error) {
                    // Log the error but return the original page to avoid breaking the pipeline
                    Logger.error("api", `Error enriching page ${page.id}:`, error);
                    return page;
                }
            })
        );

        // Push all enriched pages to the stream
        for (const page of enrichedPages) {
            stream.push(page);
        }
    }

    // Get both inline and footer comments
    async getComments(pageId: string): Promise<ConfluenceComment[]> {
        try {
            // Get both inline and footer comments in parallel
            
            const [inlineComments, footerComments] = await Promise.all([
                this.getInlineComments(pageId),
                this.getFooterComments(pageId)
            ]);
            
            // Combine all comments
            const allComments = [...inlineComments, ...footerComments];

            if (allComments.length > 0) {
                console.log("All comments: ", allComments);
            }
            
            if (this.config.enableLogging) {
                await this.log(`Retrieved ${allComments.length} total comments for page ${pageId}`);
                
                // Log a sample comment to debug
                if (allComments.length > 0) {
                    await this.log(
                        `Sample comment structure:`,
                        this.truncateForLog(allComments[0]) as Record<string, unknown>,
                    );
                }
            }
            
            return allComments;
        } catch (error) {
            Logger.error("api", `Failed to get comments for page ${pageId}`, error);
            return [];
        }
    }
    
    // Get inline comments using v2 API
    async getInlineComments(pageId: string): Promise<ConfluenceComment[]> {
        try {
            const inlineCommentsUrl = `/api/v2/pages/${pageId}/inline-comments`;
            let allComments: ConfluenceComment[] = [];
            let cursor: string | null = null;
            
            do {
                const response: {
                    results: any[];
                    _links: { next?: string };
                } = await this.fetchJson<{
                    results: any[];
                    _links: { next?: string };
                }>(inlineCommentsUrl, {
                    limit: 100,
                    "body-format": "atlas_doc_format",
                    ...(cursor ? { cursor } : {})
                });
                
                // Convert v2 API inline comments to the expected format
                const comments = response.results.map((comment: any) => this.convertV2CommentToV1Format(comment, true));
                allComments = [...allComments, ...comments];
                
                // Check if there are more comments to fetch
                if (response._links.next) {
                    const nextUrl = new URL(response._links.next, this.baseUrl);
                    cursor = nextUrl.searchParams.get('cursor');
                } else {
                    cursor = null;
                }
            } while (cursor);
            
            return allComments;
        } catch (error) {
            Logger.error("api", `Failed to get inline comments for page ${pageId}`, error);
            return [];
        }
    }
    
    // Get footer comments using v2 API
    async getFooterComments(pageId: string): Promise<ConfluenceComment[]> {
        try {
            const footerCommentsUrl = `/api/v2/pages/${pageId}/footer-comments`;
            let allComments: ConfluenceComment[] = [];
            let cursor: string | null = null;
            
            do {
                const response: {
                    results: any[];
                    _links: { next?: string };
                } = await this.fetchJson<{
                    results: any[];
                    _links: { next?: string };
                }>(footerCommentsUrl, {
                    limit: 100,
                    "body-format": "atlas_doc_format",
                    ...(cursor ? { cursor } : {})
                });
                
                // Convert v2 API footer comments to the expected format
                const comments = response.results.map((comment: any) => this.convertV2CommentToV1Format(comment, false));
                allComments = [...allComments, ...comments];
                
                // Check if there are more comments to fetch
                if (response._links.next) {
                    const nextUrl = new URL(response._links.next, this.baseUrl);
                    cursor = nextUrl.searchParams.get('cursor');
                } else {
                    cursor = null;
                }
            } while (cursor);
            
            return allComments;
        } catch (error) {
            Logger.error("api", `Failed to get footer comments for page ${pageId}`, error);
            return [];
        }
    }
    
    // Helper method to convert v2 API comment format to v1 format expected by the rest of the code
    private convertV2CommentToV1Format(comment: any, isInline: boolean): ConfluenceComment {
        return {
            id: comment.id,
            type: "comment",
            status: comment.status,
            title: comment.title || "",
            body: {
                storage: {
                    value: comment.body?.storage?.value || "",
                    representation: "storage",
                }
            },
            extensions: {
                location: isInline ? "inline" : "footer",
                inlineProperties: isInline ? {
                    ref: comment.properties?.inlineMarkerRef || comment.properties?.["inline-marker-ref"] || "",
                    originalText: comment.properties?.inlineOriginalSelection || comment.properties?.["inline-original-selection"] || "",
                } : undefined
            },
            container: {
                id: comment.pageId || comment.blogPostId || "",
                type: comment.pageId ? "page" : "blogpost",
            },
            author: {
                displayName: "",  // Will be filled from version info if available
            },
            creator: {
                displayName: "",  // Will be filled from version info if available
            },
            created: comment.version?.createdAt || "",
            version: {
                number: comment.version?.number || 1,
                by: {
                    displayName: "", // Not available directly in v2 API
                },
                when: comment.version?.createdAt || "",
            },
            _links: {
                webui: comment._links?.webui || "",
                self: "",
            }
        };
    }
}
