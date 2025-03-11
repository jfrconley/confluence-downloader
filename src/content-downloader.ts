import fs from "fs";
import path from "path";
import { Readable, Writable } from "stream";
import { ADFMarkdownConverter } from "./adf-markdown-converter.js";
import type { ConfluenceClient } from "./api-client.js";
import { ConfigManager } from "./config.js";
import { toLowerKebabCase } from "./library.js";
import Logger from "./logger.js";
/**
 * Valid Confluence content statuses
 * @see https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content/#api-content-get
 */
export type ConfluenceStatus =
    | "current" // The content is the latest version
    | "trashed" // The content is in the trash
    | "historical" // The content is a previous version
    | "draft" // The content is a draft
    | "deleted"; // The content has been permanently deleted

// Types for Confluence Content Search Response
export type RawConfluenceUser = {
    type: string;
    accountId: string;
    accountType: string;
    email: string;
    publicName: string;
    profilePicture?: {
        path: string;
        width: number;
        height: number;
        isDefault: boolean;
    };
    displayName: string;
    isExternalCollaborator: boolean;
    isGuest: boolean;
    locale: string;
    accountStatus: string;
    _links: {
        self: string;
    };
};

export interface RawConfluenceLabel {
    name: string;
}

export type RawConfluenceVersion = {
    by: RawConfluenceUser;
    when: string;
    friendlyWhen: string;
    message: string;
    number: number;
    minorEdit: boolean;
    contentTypeModified: boolean;
    _links: {
        self: string;
    };
};

export type RawConfluenceResultsList<T> = {
    results: T[];
    start: number;
    limit: number;
    size: number;
    _links: {
        self: string;
        next?: string;
    };
};

export type RawConfluenceBody = {
    atlas_doc_format?: {
        value: string;
        representation: string;
    };
};

// Base content item with common properties
export type RawConfluenceContentBase = {
    id: string;
    status: ConfluenceStatus;
    title: string;
    body?: RawConfluenceBody;
    _links: {
        self: string;
        tinyui?: string;
        editui?: string;
        webui?: string;
        edituiv2?: string;
    };
    metadata?: {
        likes?: {
            count: number;
            users?: RawConfluenceResultsList<RawConfluenceUser>;
        };
    };
};

// Page-specific properties
export type RawConfluencePage = RawConfluenceContentBase & {
    type: "page";
    children?: {
        pages?: RawConfluenceResultsList<RawConfluencePage>;
    };
    space: {
        key: string;
        name: string;
        type: string;
        alias: string;
        status: ConfluenceStatus;
        _links: {
            self: string;
        };
    };
    extensions?: {
        position?: number;
    };
    metadata?: {
        labels?: RawConfluenceResultsList<RawConfluenceLabel>;
    };
    descendants?: {
        comment?: RawConfluenceResultsList<RawConfluenceComment>;
        _links: {
            self: string;
        };
    };
    ancestors?: RawConfluencePage[];
    version?: RawConfluenceVersion;
};

// Comment-specific properties
export type RawConfluenceComment = RawConfluenceContentBase & {
    type: "comment";
    version: RawConfluenceVersion;
    extensions: {
        location?: "footer" | "inline";
        resolution?: {
            status: string;
            lastModifiedDate: string;
        };
        inlineProperties?: {
            originalText: string;
        };
    };
    children?: {
        comment?: RawConfluenceResultsList<RawConfluenceComment>;
        _links: {
            self: string;
        };
    };
};

// Union type for all content items
export type RawConfluenceContentItem = RawConfluencePage | RawConfluenceComment;

export type RawConfluenceSearchResponse = {
    results: RawConfluencePage[];
    start: number;
    limit: number;
    size: number;
    _links: {
        self: string;
        next?: string;
        prev?: string;
    };
};

export type ConfluenceComment = ConfluenceInlineComment | ConfluenceFooterComment;
export interface BaseConfluenceComment extends RawConfluenceComment {
    replies: ConfluenceComment[];
}

export interface ConfluenceInlineComment extends BaseConfluenceComment {
    location: "inline";
    originalText: string;
}

export interface ConfluenceFooterComment extends BaseConfluenceComment {
    location: "footer";
}

export interface ConfluencePage extends RawConfluencePage {
    comments: ConfluenceComment[];
    path: string[];
}

export class ContentStream extends Readable {
    // realistically
    private batchSize = 250;
    private next: string | null = null;
    private expand = [
        "ancestors",
        "descendants.comment.body.atlas_doc_format",
        "descendants.comment.extensions.inlineProperties",
        "descendants.comment.version",
        "descendants.comment.children.comment",
        "body.atlas_doc_format",
        "version",
        "metadata.labels",
        "space",
        "children.pages",
        "metadata.likes",
        "descendants.comment.metadata.likes",
    ].join(",");

    private cql: string;

    constructor(private client: ConfluenceClient, public spaces: string[]) {
        super({ objectMode: true });
        this.cql = `(type=page) and space in (${this.spaces.map((s) => `'${s}'`).join(",")})`;
    }

    async _read() {
        let results: RawConfluenceSearchResponse;
        if (this.next == null) {
            results = await this.client.fetchJson<RawConfluenceSearchResponse>("/rest/api/content/search", {
                cql: this.cql,
                start: 0,
                limit: this.batchSize,
                expand: this.expand,
                includeArchived: "true",
            });
            this.next = results._links.next ?? null;
        } else {
            results = await this.client.fetchJson<RawConfluenceSearchResponse>(this.next);
            this.next = results._links.next ?? null;
        }
        for (const result of results.results) {
            this.push(this.convertRawPage(result));
        }
        if (this.next == null) {
            this.push(null);
        }
    }

    private convertRawPage(page: RawConfluencePage): ConfluencePage {
        // Follow ancestors up to build path. yougest to oldest
        const path: string[] = page.ancestors?.map((a) => a.title) ?? [];

        // comment descendants on a raw page is the flat list of all comments
        // to display effectively, we must rebuild the tree
        // The children of comments will be references to their replies
        // Build a tree of comments from the flat list
        const commentMap = new Map<string, ConfluenceComment>();
        const rootComments: ConfluenceComment[] = [];
        const childCommentIds = new Set<string>();

        // Single pass: create comment map, identify child comments, and build the tree structure
        if (page.descendants?.comment) {
            // First create all comment objects and identify which are children
            for (const comment of page.descendants.comment.results) {
                // Create and store the processed comment
                commentMap.set(comment.id, {
                    ...comment,
                    replies: [],
                    location: comment.extensions.location as ("inline" | "footer"),
                    originalText: comment.extensions.inlineProperties?.originalText as string,
                });

                // Mark any child comments
                if (comment.children?.comment?.results) {
                    for (const childComment of comment.children.comment.results) {
                        childCommentIds.add(childComment.id);
                    }
                }
            }

            // Now build the tree structure and identify root comments in one loop
            for (const comment of page.descendants.comment.results) {
                const processedComment = commentMap.get(comment.id)!;

                // Set up replies
                processedComment.replies = comment.children?.comment?.results.map((c) => commentMap.get(c.id)!) ?? [];

                // If not a child comment, it's a root comment
                if (!childCommentIds.has(comment.id)) {
                    rootComments.push(processedComment);
                }
            }
        }

        return {
            ...page,
            path,
            comments: rootComments,
        };
    }
}

export class ContentWriter extends Writable {
    private converter = new ADFMarkdownConverter();
    private pagesWritten = 0;

    constructor(private configManager: ConfigManager) {
        super({ objectMode: true });

        // Reset counter when stream is piped
        this.on("pipe", () => {
            this.pagesWritten = 0;
        });
    }

    _write(chunk: ConfluencePage, _encoding: string, callback: (error?: Error | null) => void): void {
        const spaceConfig = this.configManager.getSpaceConfig(chunk.space.key);
        if (!spaceConfig) {
            callback(new Error(`Space configuration not found for key: ${chunk.space.key}`));
            return;
        }

        const spacePath = this.configManager.getResolvedPathToSpace(chunk.space.key);
        if (!spacePath) {
            callback(new Error(`Space path not found for key: ${chunk.space.key}`));
            return;
        }

        // pages with children are directories
        const filename = (chunk.children?.pages?.size ?? 0) > 0 ? "index.md" : `${toLowerKebabCase(chunk.title)}.md`;

        const dirPath = path.join(spacePath, ...chunk.path.map(toLowerKebabCase));
        const filePath = path.join(dirPath, filename);

        // create the directory if it doesn't exist
        fs.mkdirSync(dirPath, { recursive: true });

        Logger.debug("contentWriter", `Writing page to ${filePath}`);

        const convertedPage = this.converter.convertPage(chunk);
        fs.writeFileSync(filePath, convertedPage);

        // Increment the counter and emit the event
        this.pagesWritten++;
        this.emit("pageWritten", {
            page: chunk,
            count: this.pagesWritten,
            spaceName: chunk.space.name,
            spaceKey: chunk.space.key,
            pageTitle: chunk.title,
        });

        callback();
    }

    _final(callback: (error?: Error | null) => void): void {
        this.emit("finish", { totalPages: this.pagesWritten });
        callback();
    }
}
