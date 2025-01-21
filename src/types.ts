export interface ConfluenceConfig {
    baseUrl: string;
    apiToken: string;
    spaceKey: string;
    outputDir: string;
}

export interface ConfluenceLabel {
    name: string;
}

export interface ConfluenceUser {
    displayName: string;
}

export interface ConfluenceHistory {
    createdBy: ConfluenceUser;
    lastUpdated: string;
}

export interface ConfluenceMetadata {
    labels: {
        results: ConfluenceLabel[];
    };
}

export interface ConfluencePage {
    id: string;
    title: string;
    body: {
        storage: {
            value: string;
            representation: string;
        };
    };
    _links: {
        webui: string;
    };
    ancestors: Array<{
        id: string;
        title: string;
    }>;
    metadata?: ConfluenceMetadata;
    history?: ConfluenceHistory;
    version?: {
        number: number;
    };
    space?: {
        key: string;
    };
    children?: {
        page?: {
            results: Array<{
                id: string;
                title: string;
            }>;
        };
    };
}

export interface ConfluenceComment {
    id: string;
    body: {
        storage: {
            value: string;
            representation: string;
        };
    };
    author?: {
        displayName: string;
    };
    created: string;
} 