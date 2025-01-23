export interface ConfluenceConfig {
    baseUrl: string;
    apiToken: string;
    spaceKey: string;
    outputDir: string;
    concurrency?: number;
    onProgress?: (status: string) => void;
    enableLogging?: boolean;
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
    // Temporary v2 fields for hierarchy building
    _v2?: {
        parentId?: string;
        parentType?: string;
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

// New types for library management
export interface SpaceMetadata {
    key: string;
    name: string;
    description?: string;
    lastSynced: string;
}

export interface SpaceConfig {
    spaceKey: string;
    localPath: string;
    lastSync: string;
}

export interface ConfluenceLibraryConfig {
    baseUrl: string;
    spaces: SpaceConfig[];
}

export interface LibraryOptions {
    baseUrl: string;
    apiToken: string;
    configPath: string;
}

export interface SpaceInfo {
    key: string;
    name: string;
    description?: {
        plain: {
            value: string;
        };
    };
} 