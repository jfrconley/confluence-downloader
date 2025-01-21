import type { ConfluenceConfig, ConfluencePage, ConfluenceComment } from './types.js';

export class ConfluenceClient {
    private readonly baseUrl: string;
    private readonly apiToken: string;
    private readonly headers: HeadersInit;

    constructor(config: ConfluenceConfig) {
        this.baseUrl = config.baseUrl;
        this.apiToken = config.apiToken;
        
        // For Atlassian Cloud, the username is your email and the password is your API token
        const authString = Buffer.from(`${process.env.CONFLUENCE_EMAIL}:${this.apiToken}`).toString('base64');
        
        this.headers = {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json',
        };
    }

    private async fetchJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
        const queryString = new URLSearchParams(
            Object.entries(params).map(([k, v]) => [k, v.toString()])
        ).toString();
        
        const url = `${this.baseUrl}/wiki${path}${queryString ? '?' + queryString : ''}`;
        const response = await fetch(url, {
            headers: this.headers,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Request failed with status code ${response.status}: ${text}`);
        }

        return response.json() as Promise<T>;
    }

    async getAllPages(spaceKey: string): Promise<ConfluencePage[]> {
        const pages: ConfluencePage[] = [];
        let start = 0;
        const limit = 100;

        while (true) {
            const response = await this.fetchJson<{
                results: ConfluencePage[];
            }>('/rest/api/content', {
                spaceKey,
                expand: 'body.storage,ancestors,metadata.labels,history.lastUpdated,history.createdBy,version,space,children.page',
                start,
                limit,
                type: 'page',
            });

            pages.push(...response.results);

            if (response.results.length < limit) {
                break;
            }
            start += limit;
        }

        return pages;
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