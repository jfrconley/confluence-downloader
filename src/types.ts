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
    type?: string;
    accountId?: string;
    accountType?: string;
    email?: string;
    publicName?: string;
    displayName: string;
    profilePicture?: {
        path?: string;
        width?: number;
        height?: number;
        isDefault?: boolean;
    };
    accountStatus?: string;
}

export interface ConfluenceHistory {
    createdBy: ConfluenceUser;
    createdDate?: string;
    lastUpdated?: {
        by: ConfluenceUser;
        when: string;
        friendlyWhen?: string;
        message?: string;
        number?: number;
    };
    latest?: boolean;
}

export interface ConfluenceMetadata {
    labels: {
        results: ConfluenceLabel[];
        start?: number;
        limit?: number;
        size?: number;
        _links?: {
            next?: string;
            self?: string;
        };
    };
}

export interface ConfluencePage {
    id: string;
    title: string;
    body: {
        storage: {
            value: string;
            representation: string;
            embeddedContent?: unknown[];
        };
        _expandable?: Record<string, string>;
    };
    _links: {
        webui: string;
        self?: string;
    };
    ancestors: Array<{
        id: string;
        title: string;
        _links?: {
            webui?: string;
        };
    }>;
    space?: {
        id?: number;
        key: string;
        name?: string;
        type?: string;
        status?: string;
        _expandable?: Record<string, string>;
        _links?: {
            webui?: string;
            self?: string;
        };
    };
    metadata?: ConfluenceMetadata;
    history?: ConfluenceHistory;
    version?: {
        by?: ConfluenceUser;
        when?: string;
        friendlyWhen?: string;
        message?: string;
        number: number;
        minorEdit?: boolean;
        confRev?: string;
        contentTypeModified?: boolean;
        _expandable?: Record<string, string>;
        _links?: {
            self?: string;
        };
    };
    children?: {
        page?: {
            results: Array<{
                id: string;
                title: string;
                _links?: {
                    webui?: string;
                };
            }>;
            start?: number;
            limit?: number;
            size?: number;
            _links?: {
                self?: string;
            };
        };
        _expandable?: Record<string, string>;
        _links?: {
            self?: string;
        };
    };
    // Temporary v2 fields for hierarchy building
    _v2?: {
        parentId?: string;
        parentType?: string;
    };
}

export interface CommentLocation {
    location: 'inline' | 'footer';
    inlineProperties?: {
        originalText?: string;
        ref?: string;
    };
    _expandable?: Record<string, string>;
}

export interface ConfluenceComment {
    id: string;
    type?: string;
    status?: string;
    title?: string;
    macroRenderedOutput?: Record<string, unknown>;
    body: {
        storage: {
            value: string;
            representation: string;
            embeddedContent?: unknown[];
            _expandable?: Record<string, string>;
        };
        _expandable?: Record<string, string>;
    };
    extensions?: {
        location?: string;
        inlineProperties?: {
            ref?: string;
            originalText?: string;
            markerRef?: string;
            originalSelection?: string;
        };
        _expandable?: {
            resolution?: string;
            inlineProperties?: string;
        };
    };
    container?: {
        id?: string;
        type?: string;
        status?: string;
        title?: string;
    };
    author?: ConfluenceUser;
    creator?: ConfluenceUser;
    created?: string;
    // Comment history, similar to page history
    history?: {
        createdBy?: ConfluenceUser;
        createdDate?: string;
        lastUpdated?: {
            by?: ConfluenceUser;
            when?: string;
        };
    };
    // Version information
    version?: {
        by?: ConfluenceUser;
        when?: string;
        number?: number;
        minorEdit?: boolean;
    };
    _expandable?: Record<string, string>;
    _links?: {
        webui?: string;
        self?: string;
    };
}

// Expanded type to represent inline comments with their referenced text
export interface EnrichedComment extends ConfluenceComment {
    contextText?: string;  // The text snippet that the comment refers to
    commentType: 'inline' | 'footer';
    referenceId?: string;  // For inline comments, the ref ID to the original text
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
