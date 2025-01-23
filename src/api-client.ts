import type { ConfluenceConfig, ConfluencePage, ConfluenceComment } from './types.js';
import fs from 'fs-extra';
import path from 'path';
import { Transform, Readable, pipeline } from 'stream';
import { promisify } from 'util';

interface SpaceInfo {
    key: string;
    name: string;
    description?: {
        plain: {
            value: string;
        };
    };
}

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
        const authString = Buffer.from(`${process.env.CONFLUENCE_EMAIL}:${this.apiToken}`).toString('base64');
        
        this.headers = {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json',
        };

        // Only set up logging if explicitly enabled and we have an output directory
        if (config.enableLogging && config.outputDir) {
            // Set up logging
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.logFile = path.join(config.outputDir, `confluence-fetch-${timestamp}.log`);
            
            // Ensure output directory exists before trying to create log file
            fs.ensureDirSync(config.outputDir);

            // Initialize log file
            this.log('Confluence client initialized', {
                baseUrl: this.baseUrl,
                spaceKey: this.spaceKey,
                concurrency: this.concurrency,
            }).catch(error => {
                console.error('Failed to write to log file:', error);
            });
        } else {
            this.logFile = '';
        }
    }

    private async log(message: string, data?: any): Promise<void> {
        // Skip logging if no log file or logging is disabled
        if (!this.logFile || !this.config.enableLogging) {
            return;
        }
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, 2) + '\n' : ''}`;
        await fs.appendFile(this.logFile, logEntry);
    }

    private async fetchJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
        this.requestCount++;
        const queryString = new URLSearchParams(
            Object.entries(params).map(([k, v]) => [k, v.toString()])
        ).toString();
        
        const url = `${this.baseUrl}/wiki${path}${queryString ? '?' + queryString : ''}`;
        
        // Log request
        await this.log(`Request #${this.requestCount}: ${url}`, {
            method: 'GET',
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

    private truncateForLog(data: any): any {
        if (typeof data !== 'object' || data === null) {
            return data;
        }

        const truncated: any = Array.isArray(data) ? [] : {};
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string' && value.length > 500) {
                truncated[key] = value.substring(0, 500) + '... [truncated]';
            } else if (Array.isArray(value)) {
                truncated[key] = `Array(${value.length}) [${value.slice(0, 3).map(v => typeof v).join(', ')}...]`;
            } else if (typeof value === 'object' && value !== null) {
                truncated[key] = this.truncateForLog(value);
            } else {
                truncated[key] = value;
            }
        }
        return truncated;
    }

    private async getPageDetails(pageId: string): Promise<Partial<ConfluencePage>> {
        const response = await this.fetchJson<ConfluencePage>(`/rest/api/content/${pageId}`, {
            expand: 'metadata.labels,history.lastUpdated,history.createdBy,version,space,children.page',
        });
        return response;
    }

    async getSpaceInfo(spaceKey?: string): Promise<SpaceInfo> {
        const key = spaceKey || this.spaceKey;
        const response = await this.fetchJson<SpaceInfo>(`/rest/api/space/${key}`, {
            expand: 'description.plain',
        });
        return response;
    }

    async getPageCount(spaceKey: string): Promise<number> {
        this.config.onProgress?.('Counting total pages...');
        const response = await this.fetchJson<{
            results: any[];
            _links: {
                next?: string;
            };
        }>('/api/v2/spaces', {
            keys: spaceKey,
        });

        if (response.results.length === 0) {
            return 0;
        }

        const spaceId = response.results[0].id;
        let totalPages = 0;
        let cursor: string | undefined;

        do {
            const pagesResponse = await this.fetchJson<{
                results: any[];
                _links: {
                    next?: string;
                };
            }>(`/api/v2/spaces/${spaceId}/pages`, {
                limit: 250,
                ...(cursor ? { cursor } : {}),
            });

            totalPages += pagesResponse.results.length;
            
            // Get cursor from next link if it exists
            const nextLink = pagesResponse._links.next;
            cursor = nextLink ? new URLSearchParams(nextLink.split('?')[1]).get('cursor') || undefined : undefined;
        } while (cursor);

        return totalPages;
    }

    async getAllSpaces(): Promise<SpaceInfo[]> {
        const spaces: SpaceInfo[] = [];
        let start = 0;
        const limit = 100;

        while (true) {
            const response = await this.fetchJson<{
                results: SpaceInfo[];
            }>('/rest/api/space', {
                expand: 'description.plain',
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

    async getAllPages(spaceKey: string): Promise<ConfluencePage[]> {
        // First, get the total page count
        this.config.onProgress?.('Counting pages in space...');
        const totalPages = await this.getPageCount(spaceKey);
        if (totalPages === 0) {
            this.config.onProgress?.('No pages found');
            return [];
        }

        // Get space ID first
        const spaceResponse = await this.fetchJson<{
            results: Array<{ id: string }>;
        }>('/api/v2/spaces', {
            keys: spaceKey,
        });

        if (spaceResponse.results.length === 0) {
            throw new Error(`Space ${spaceKey} not found`);
        }

        const spaceId = spaceResponse.results[0].id;
        const pages: ConfluencePage[] = [];
        let completedPages = 0;
        
        // Create the pipeline
        const pipelineAsync = promisify(pipeline);
        await pipelineAsync(
            this.createPageStream(spaceId, totalPages),
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
                }
            })
        );

        return pages;
    }

    private createPageStream(spaceId: string, totalPages: number): Readable {
        let cursor: string | undefined;
        let downloadedPages = 0;
        const limit = 100;
        const self = this;

        return new Readable({
            objectMode: true,
            async read() {
                try {
                    if (downloadedPages >= totalPages) {
                        this.push(null);
                        return;
                    }

                    const response = await self.fetchJson<{
                        results: any[];
                        _links: { next?: string };
                    }>(`/api/v2/spaces/${spaceId}/pages`, {
                        limit,
                        ...(cursor ? { cursor } : {}),
                        'body-format': 'storage',
                    });

                    // Convert and push each page individually
                    for (const page of response.results) {
                        const convertedPage = {
                            id: page.id,
                            title: page.title,
                            body: {
                                storage: {
                                    value: page.body.storage.value,
                                    representation: 'storage',
                                }
                            },
                            _links: {
                                webui: page._links.webui,
                            },
                            ancestors: [],
                            space: {
                                key: self.spaceKey,
                            },
                            children: {
                                page: {
                                    results: [],
                                }
                            },
                            _v2: {
                                parentId: page.parentId,
                                parentType: page.parentType,
                            }
                        };
                        this.push(convertedPage);
                        downloadedPages++;
                    }

                    // Get next cursor
                    const nextLink = response._links.next;
                    cursor = nextLink ? new URLSearchParams(nextLink.split('?')[1]).get('cursor') || undefined : undefined;
                    
                    if (!cursor) {
                        this.push(null);
                    }
                } catch (error) {
                    this.emit('error', error);
                }
            }
        });
    }

    private createHierarchyTransform(): Transform {
        const pageMap = new Map<string, ConfluencePage>();
        const pages: ConfluencePage[] = [];
        const self = this;

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
                    if (page._v2?.parentId && page._v2.parentType === 'page') {
                        const parentPage = pageMap.get(page._v2.parentId);
                        if (parentPage) {
                            if (!parentPage.children?.page?.results) {
                                const children = {
                                    page: {
                                        results: []
                                    }
                                } as NonNullable<ConfluencePage['children']>;
                                parentPage.children = children;
                            }
                            
                            (parentPage.children!.page!.results).push({
                                id: page.id,
                                title: page.title
                            });
                        }
                    }
                }

                // Second pass: Build ancestors and push pages
                for (const page of pages) {
                    const ancestors: Array<{ id: string; title: string }> = [];
                    let currentPage = page;
                    
                    while (currentPage._v2?.parentId && currentPage._v2.parentType === 'page') {
                        const parentPage = pageMap.get(currentPage._v2.parentId);
                        if (!parentPage) break;
                        
                        ancestors.unshift({
                            id: parentPage.id,
                            title: parentPage.title
                        });
                        currentPage = parentPage;
                    }
                    
                    page.ancestors = ancestors;
                    delete page._v2;
                    this.push(page);
                }
                
                callback();
            }
        });
    }

    private createMetadataTransform(): Transform {
        let processedPages = 0;
        let totalPages = 0;
        const batchSize = 100;
        let currentBatch: ConfluencePage[] = [];
        const self = this;
        const transform = new Transform({
            objectMode: true,
            transform(page: ConfluencePage, encoding, callback) {
                currentBatch.push(page);
                totalPages++;

                if (currentBatch.length >= batchSize) {
                    processBatch(currentBatch, transform)
                        .then(() => {
                            processedPages += currentBatch.length;
                            currentBatch = [];
                            callback();
                        })
                        .catch(callback);
                } else {
                    callback();
                }
            },
            flush(callback) {
                if (currentBatch.length > 0) {
                    processBatch(currentBatch, transform)
                        .then(() => callback())
                        .catch(callback);
                } else {
                    callback();
                }
            }
        });

        async function processBatch(batch: ConfluencePage[], stream: Transform) {
            const enrichedPages = await Promise.all(
                batch.map(async (page) => {
                    try {
                        const details = await self.getPageDetails(page.id);
                        return {
                            ...page,
                            metadata: details.metadata,
                            history: details.history,
                            version: details.version,
                            space: details.space,
                            children: details.children,
                        };
                    } catch (error) {
                        return page;
                    }
                })
            );

            for (const page of enrichedPages) {
                stream.push(page);
            }
        }

        return transform;
    }

    async getComments(pageId: string): Promise<ConfluenceComment[]> {
        const response = await this.fetchJson<{
            results: ConfluenceComment[];
        }>(`/rest/api/content/${pageId}/child/comment`, {
            expand: 'body.storage,author',
        });
        
        return response.results;
    }
}