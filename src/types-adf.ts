import type { ConfluencePage } from "./types.js";

/**
 * Enhanced Confluence page interface with ADF support
 */
export interface AdfConfluencePage extends ConfluencePage {
    body: {
        // Original HTML content from the storage field
        storage: {
            value: string;
            representation: string;
            embeddedContent?: unknown[];
        };
        // ADF content field
        adf?: AdfDocument;
        // Other fields like atlas_doc_format that might be in a Confluence page body
        _expandable?: Record<string, string>;
    };
}

/**
 * Atlassian Document Format (ADF) document structure
 */
export interface AdfDocument {
    version: number;
    type: string;
    content?: AdfNode[];
}

/**
 * ADF Node - base structure for all nodes in the ADF document
 */
export interface AdfNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: AdfNode[];
    marks?: AdfMark[];
    text?: string;
}

/**
 * ADF Mark - represents formatting applied to text
 */
export interface AdfMark {
    type: string;
    attrs?: Record<string, unknown>;
}

// Split attributes by node/mark type to avoid duplicate field names
export interface HeadingAttrs {
    level: number;
}

export interface LinkAttrs {
    href: string;
    title?: string;
}

export interface MediaAttrs {
    id: string;
    mediaType: string; // Changed from "type" to avoid duplication
    url?: string;
    collection?: string;
    width?: number;
    height?: number;
}

export interface TableAttrs {
    isNumberColumnEnabled?: boolean;
    tableLayout?: string; // Changed from "layout" to avoid duplication
}

export interface MediaSingleAttrs {
    mediaSingleLayout?: string; // Changed from "layout" to avoid duplication
    width?: number;
    caption?: string;
}

export interface CodeBlockAttrs {
    language?: string;
}

export interface PanelAttrs {
    panelType: string;
    panelTitle?: string; // Changed from "title" to avoid duplication
}

export interface TaskItemAttrs {
    state: string; // "DONE" or other values
}

export interface DecisionItemAttrs {
    state: string; // "DECIDED" or other values
}

export interface StatusAttrs {
    statusText: string; // Changed from "text" to avoid duplication
    statusColor: string; // Changed from "color" to avoid duplication
}

export interface ExpandAttrs {
    expandTitle: string; // Changed from "title" to avoid duplication
}

export interface ExtensionAttrs {
    extensionType: string;
    extensionKey: string;
    parameters?: Record<string, unknown>;
}

export interface AlignmentMarkAttrs {
    align: string;
}

export interface TextColorMarkAttrs {
    textColor: string; // Changed from "color" to avoid duplication
}

export interface BackgroundColorMarkAttrs {
    backgroundColor: string;
}

export interface SubsupMarkAttrs {
    subsupType: string; // Changed from "type" to avoid duplication ("sub" or "sup")
}

export interface IndentationMarkAttrs {
    indentLevel: number; // Changed from "level" to avoid duplication
} 