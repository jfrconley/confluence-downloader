export interface ConfluenceConfig {
    baseUrl: string;
    apiToken: string;
    concurrency?: number;
    enableLogging?: boolean;
}

// New types for library management
export interface SpaceMetadata {
    key: string;
    name: string;
    description?: string;
    lastSynced: string;
    id: number;
    settings: {
        status: string;
    };
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

// export interface LibraryOptions {
//     baseUrl: string;
//     apiToken: string;
//     dbHandler: DatabaseHandler;
// }

export interface SpaceInfo {
    id: number;
    key: string;
    name: string;
    description?: string;
    status: string;
    homePageId: string;
}

// New interfaces for database storage
export interface SpaceRecord {
    id: string;
    key: string;
    name: string;
    description?: string;
    local_path: string;
    base_url: string;
    last_synced?: string;
    enabled: boolean;
    status: string;
}

export interface Setting {
    key: string;
    value: string;
}

// // Update DatabaseConfig to allow string path instead of ConfluenceConfig
// export interface DatabaseConfig {
//     dbPath?: string;
// }
