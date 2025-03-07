/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// Disable linting for parameters prefixed with underscore as they are required by interface but not used
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import type { ConfluenceComment, ConfluencePage, EnrichedComment } from "./types.js";

// Define a base interface for DOM-like nodes
interface DOMNode {
    nodeName: string;
    textContent: string | null;
}

// Interface for DOM elements with methods we need
// Not extending Node to avoid type conflicts
interface DOMElement {
    nodeName: string;
    textContent: string | null;
    innerHTML?: string;
    getAttribute(name: string): string | null;
    querySelector(selector: string): any;
    querySelectorAll(selector: string): any;
}

// Type guard to check if a node is a DOMElement
function isDOMElement(node: unknown): node is DOMElement {
    if (!node) return false;

    const obj = node as any;
    return typeof obj.nodeName === "string"
        && typeof obj.getAttribute === "function"
        && typeof obj.querySelector === "function"
        && typeof obj.querySelectorAll === "function";
}

// Type for TurndownService nodes
interface TurndownNode extends DOMNode {
    getAttribute?(name: string): string | null;
}

// Safe accessor functions to handle both DOM elements and TurndownNodes
function getNodeName(node: DOMElement | TurndownNode): string {
    return node.nodeName;
}

function getAttribute(node: DOMElement | TurndownNode | null, name: string): string | null {
    if (!node) return null;

    if (isDOMElement(node)) {
        return node.getAttribute(name);
    } else if (node.getAttribute) {
        return node.getAttribute(name);
    }
    return null;
}

function querySelector(node: DOMElement | TurndownNode | null, selector: string): DOMElement | null {
    if (!node) return null;

    if (isDOMElement(node)) {
        return node.querySelector(selector);
    }
    return null;
}

function querySelectorAll(node: DOMElement | TurndownNode | null, selector: string): DOMElement[] {
    if (!node) return [];

    if (isDOMElement(node)) {
        return Array.from(node.querySelectorAll(selector));
    }
    return [];
}

// Interface for Confluence macro handlers
interface MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean;
    handle(node: DOMElement | TurndownNode, page: ConfluencePage, turndownService: TurndownService): string;
}

// Registry to manage macro handlers
class MacroHandlerRegistry {
    private handlers: MacroHandler[] = [];

    register(handler: MacroHandler): void {
        this.handlers.push(handler);
    }

    findHandler(node: DOMElement | TurndownNode): MacroHandler | undefined {
        return this.handlers.find(handler => handler.canHandle(node));
    }

    // Process a node using appropriate handler or return null if no handler found
    process(node: DOMElement | TurndownNode, page: ConfluencePage, turndownService: TurndownService): string | null {
        try {
            const handler = this.findHandler(node);
            if (handler) {
                return handler.handle(node, page, turndownService);
            }
            return null;
        } catch (error) {
            // console.error(`Error processing node with macro registry:`, error);
            return `[Error processing Confluence content: ${error instanceof Error ? error.message : String(error)}]`;
        }
    }
}

// TOC Macro Handler - Generates table of contents
class TocMacroHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:STRUCTURED-MACRO"
            && getAttribute(node, "ac:name") === "toc";
    }

    handle(node: DOMElement | TurndownNode, page: ConfluencePage, _turndownService: TurndownService): string {
        // Extract heading elements from HTML content
        const dom = new JSDOM(page.body.storage.value, {
            contentType: "text/html",
        });
        const doc = dom.window.document;
        const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"));

        // Generate TOC markdown
        let toc = "## Table of Contents\n\n";

        headings.forEach(heading => {
            // Get the heading level from the tag name (h1, h2, etc.)
            const tagName = heading.nodeName.toLowerCase();
            const level = parseInt(tagName.substring(1), 10);
            const title = heading.textContent?.trim() || "";
            const indent = "  ".repeat(level - 1);
            // Create anchor link from title (simplified version)
            const anchor = title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");

            toc += `${indent}- [${title}](#${anchor})\n`;
        });

        return toc;
    }
}

// Status Macro Handler - Colored status labels
class StatusMacroHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:STRUCTURED-MACRO"
            && getAttribute(node, "ac:name") === "status";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, _turndownService: TurndownService): string {
        // Extract parameters
        const titleParam = querySelector(node, "ac\\:parameter[ac\\:name=\"title\"]");
        const colorParam = querySelector(node, "ac\\:parameter[ac\\:name=\"colour\"]");

        const title = getAttribute(titleParam, "textContent") || "STATUS";
        const color = getAttribute(colorParam, "textContent")?.toLowerCase() || "grey";

        // Map Confluence colors to LaTeX colors
        const colorMap: Record<string, string> = {
            "grey": "gray",
            "red": "red",
            "yellow": "yellow",
            "green": "green",
            "blue": "blue",
            "purple": "purple",
            "brown": "brown",
            "orange": "orange",
            "black": "black",
        };

        const latexColor = colorMap[color] || "gray";

        // Create colored text using LaTeX syntax supported by GitHub
        return `$${"{"}\\color{${latexColor}}\\textsf{${title}}${"}"}$`;
    }
}

// Inline Comment Marker Handler
class InlineCommentMarkerHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:INLINE-COMMENT-MARKER";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, _turndownService: TurndownService): string {
        const ref = getAttribute(node, "ac:ref");
        // Get the text content of the node, which is the text being commented on
        const content = node.textContent || "";

        if (ref) {
            // Return a marker with the content and ref to be processed later
            return `%%INLINE_COMMENT_MARKER_START:${ref}%%${content}%%INLINE_COMMENT_MARKER_END:${ref}%%`;
        }

        return content;
    }
}

// HTML Table Handler
class HtmlTableHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "TABLE";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, turndownService: TurndownService): string {
        // console.log('Processing table:', node.nodeName);

        // Check if this is a Confluence table
        const isConfluenceTable = getAttribute(node, "class")?.includes("confluenceTable") || false;
        // console.log('Is Confluence table:', isConfluenceTable);

        // For Confluence tables, we need to look for tbody first
        let rowsContainer = node;
        if (isConfluenceTable) {
            const tbody = querySelector(node, "tbody");
            if (tbody) {
                rowsContainer = tbody;
                // console.log('Found tbody in Confluence table');
            }
        }

        // Extract rows from table
        const rows = Array.from(querySelectorAll(rowsContainer, "tr"));
        // console.log(`Found ${rows.length} rows in table`);

        if (rows.length === 0) {
            // console.log('No rows found in table, returning empty string');
            return "";
        }

        let markdownTable = "";

        // Process table rows
        rows.forEach((row, rowIndex) => {
            const cells = Array.from(querySelectorAll(row, "th, td"));
            // console.log(`Row ${rowIndex}: Found ${cells.length} cells`);

            let rowContent = "|";

            // Process cells
            cells.forEach((cell, cellIndex) => {
                // We use the isHeader info to apply special styling if needed in the future
                const isHeader = cell.nodeName === "TH";

                // Get cell content - prefer innerHTML for rich content, fall back to textContent
                let cellContent = "";

                // For Confluence tables, we need to look for the content inside p tags
                if (isConfluenceTable && isDOMElement(cell)) {
                    const pTags = querySelectorAll(cell, "p");
                    if (pTags.length > 0) {
                        // Combine content from all p tags
                        cellContent = Array.from(pTags)
                            .map(p => p.innerHTML?.trim() || p.textContent?.trim() || "")
                            .join("<br>");
                        // console.log(`Cell ${rowIndex}:${cellIndex} - Found ${pTags.length} p tags with combined content length: ${cellContent.length}`);
                    }
                }

                // If we didn't get content from p tags, use the cell's content directly
                if (!cellContent && isDOMElement(cell) && cell.innerHTML) {
                    cellContent = cell.innerHTML.trim();
                } else if (!cellContent) {
                    cellContent = cell.textContent?.trim() || "";
                }

                // Ensure we have at least a space for empty cells
                if (!cellContent) {
                    cellContent = " ";
                    // console.log(`Cell ${rowIndex}:${cellIndex} - Empty cell, using space character`);
                }

                // console.log(`Cell ${rowIndex}:${cellIndex} (${isHeader ? 'TH' : 'TD'}): Content length: ${cellContent.length}`);

                // Use turndown to convert any HTML within the cell
                const markdownContent = turndownService.turndown(cellContent).replace(/\n/g, "<br>");
                rowContent += ` ${markdownContent} |`;
            });

            markdownTable += rowContent + "\n";

            // Add separator row after headers
            if (rowIndex === 0) {
                let separatorRow = "|";
                cells.forEach(() => {
                    separatorRow += " --- |";
                });
                markdownTable += separatorRow + "\n";
            }
        });

        // console.log('Generated markdown table:', markdownTable);
        return markdownTable;
    }
}

// Panel Macro Handler
class PanelMacroHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:STRUCTURED-MACRO"
            && getAttribute(node, "ac:name") === "panel";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, turndownService: TurndownService): string {
        const richTextContent = querySelector(node, "ac\\:rich-text-body");
        const content = getAttribute(richTextContent, "innerHTML") || "";

        // Use turndown to convert the rich text content
        const markdownContent = turndownService.turndown(content);

        // Format as blockquote for panel
        return `> ${markdownContent.replace(/\n/g, "\n> ")}`;
    }
}

// Code Block Macro Handler
class CodeBlockMacroHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:STRUCTURED-MACRO"
                && getAttribute(node, "ac:name") === "code"
            || getAttribute(node, "ac:name") === "codeblock";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, _turndownService: TurndownService): string {
        const codeParam = querySelector(node, "ac\\:plain-text-body");
        const languageParam = querySelector(node, "ac\\:parameter[ac\\:name=\"language\"]");

        const code = getAttribute(codeParam, "textContent") || "";
        const language = getAttribute(languageParam, "textContent") || "";

        // Format as markdown code block
        return `\`\`\`${language}\n${code}\n\`\`\``;
    }
}

// Info/Note/Warning Macro Handler
class InfoMacroHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:STRUCTURED-MACRO"
                && getAttribute(node, "ac:name") === "info"
            || getAttribute(node, "ac:name") === "note"
            || getAttribute(node, "ac:name") === "warning"
            || getAttribute(node, "ac:name") === "tip";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, turndownService: TurndownService): string {
        const macroName = getAttribute(node, "ac:name") || "info";
        const richTextContent = querySelector(node, "ac\\:rich-text-body");
        const content = getAttribute(richTextContent, "innerHTML") || "";

        // Use turndown to convert the rich text content
        const markdownContent = turndownService.turndown(content);

        // Map macro names to emoji for visual distinction
        const emojiMap: Record<string, string> = {
            "info": "ℹ️",
            "note": "📝",
            "warning": "⚠️",
            "tip": "💡",
        };

        const emoji = emojiMap[macroName] || "ℹ️";

        // Format as blockquote with emoji
        return `> ${emoji} **${macroName.toUpperCase()}**\n> \n> ${markdownContent.replace(/\n/g, "\n> ")}`;
    }
}

// Task List Macro Handler
class TaskListMacroHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:TASK-LIST";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, turndownService: TurndownService): string {
        const tasks = Array.from(querySelectorAll(node, "ac\\:task"));
        if (tasks.length === 0) return "";

        let taskListMarkdown = "";

        tasks.forEach(task => {
            const status = getAttribute(querySelector(task, "ac\\:task-status"), "textContent") || "";
            const body = getAttribute(querySelector(task, "ac\\:task-body"), "innerHTML") || "";

            // Convert task body to markdown
            const bodyMarkdown = turndownService.turndown(body);

            // Check if task is complete
            const isComplete = status.toLowerCase() === "complete";
            const checkbox = isComplete ? "[x]" : "[ ]";

            taskListMarkdown += `- ${checkbox} ${bodyMarkdown}\n`;
        });

        return taskListMarkdown;
    }
}

// Default handler for unsupported macros
class DefaultMacroHandler implements MacroHandler {
    canHandle(node: DOMElement | TurndownNode): boolean {
        return node.nodeName === "AC:STRUCTURED-MACRO" || node.nodeName === "AC:MACRO";
    }

    handle(node: DOMElement | TurndownNode, _page: ConfluencePage, _turndownService: TurndownService): string {
        const macroName = getAttribute(node, "ac:name");
        return `> [Confluence Macro: ${
            macroName || "Unknown"
        }] - *This macro is not fully supported in markdown conversion*`;
    }
}

export class MarkdownConverter {
    private turndownService: TurndownService;
    private macroRegistry: MacroHandlerRegistry;

    constructor() {
        this.turndownService = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
        });

        // Initialize macro registry
        this.macroRegistry = new MacroHandlerRegistry();
        this.registerMacroHandlers();

        // Add rules for Confluence-specific elements
        this.setupCustomRules();
    }

    private registerMacroHandlers(): void {
        // Register specific handlers
        this.macroRegistry.register(new TocMacroHandler());
        this.macroRegistry.register(new StatusMacroHandler());
        this.macroRegistry.register(new InlineCommentMarkerHandler());
        this.macroRegistry.register(new HtmlTableHandler());
        this.macroRegistry.register(new PanelMacroHandler());
        this.macroRegistry.register(new CodeBlockMacroHandler());
        this.macroRegistry.register(new InfoMacroHandler());
        this.macroRegistry.register(new TaskListMacroHandler());

        // Register default handler (should be last)
        this.macroRegistry.register(new DefaultMacroHandler());
    }

    private setupCustomRules() {
        // Handle Confluence macros better
        this.turndownService.addRule("confluenceMacros", {
            filter: (node: TurndownNode): boolean => {
                return node.nodeName === "AC:STRUCTURED-MACRO"
                    || node.nodeName === "AC:MACRO"
                    || getAttribute(node, "ac:name") !== null;
            },
            replacement: (content: string, node: TurndownNode): string => {
                // Use the macro registry to handle this node
                if (isDOMElement(node)) {
                    const macroResult = this.macroRegistry.process(
                        node,
                        this.currentPage as ConfluencePage,
                        this.turndownService,
                    );
                    if (macroResult !== null) {
                        return macroResult;
                    }
                }

                // Extract macro name if possible (fallback)
                const macroName = getAttribute(node, "ac:name");
                if (macroName) {
                    return `[Confluence Macro: ${macroName}]`;
                }
                return "[Confluence Macro]";
            },
        });

        // Handle standard HTML tables
        this.turndownService.addRule("htmlTables", {
            filter: (node: TurndownNode): boolean => {
                return node.nodeName === "TABLE";
            },
            replacement: (content: string, node: TurndownNode): string => {
                if (isDOMElement(node)) {
                    const tableResult = this.macroRegistry.process(
                        node,
                        this.currentPage as ConfluencePage,
                        this.turndownService,
                    );
                    if (tableResult !== null) {
                        return tableResult;
                    }
                }
                // Don't fall back to default handling, as it might not work correctly
                // Instead, use our HtmlTableHandler directly
                if (isDOMElement(node)) {
                    const tableHandler = new HtmlTableHandler();
                    return tableHandler.handle(node, this.currentPage as ConfluencePage, this.turndownService);
                }
                return content;
            },
        });

        // Handle Confluence specific table structures
        this.turndownService.addRule("confluenceTables", {
            filter: (node: TurndownNode): boolean => {
                // Check for Confluence table structure
                return node.nodeName === "TABLE"
                    && (getAttribute(node, "class")?.includes("confluenceTable") || false);
            },
            replacement: (content: string, node: TurndownNode): string => {
                // console.log('Found Confluence table with class:', getAttribute(node, 'class'));
                if (isDOMElement(node)) {
                    const tableHandler = new HtmlTableHandler();
                    return tableHandler.handle(node, this.currentPage as ConfluencePage, this.turndownService);
                }
                return content;
            },
        });

        // Handle inline comment markers
        this.turndownService.addRule("inlineCommentMarker", {
            filter: (node: TurndownNode): boolean => {
                return node.nodeName === "AC:INLINE-COMMENT-MARKER"
                    || getAttribute(node, "ac:ref") !== null;
            },
            replacement: (content: string, node: TurndownNode): string => {
                if (isDOMElement(node)) {
                    const commentResult = this.macroRegistry.process(
                        node,
                        this.currentPage as ConfluencePage,
                        this.turndownService,
                    );
                    if (commentResult !== null) {
                        return commentResult;
                    }
                }

                // Fallback for inline comment markers
                const ref = getAttribute(node, "ac:ref");
                if (ref) {
                    // Return the content wrapped in a special marker that we can replace later
                    return `%%INLINE_COMMENT_MARKER_START:${ref}%%${content}%%INLINE_COMMENT_MARKER_END:${ref}%%`;
                }
                return content;
            },
        });
    }

    // Store the current page being processed for access by handlers
    private currentPage: ConfluencePage | null = null;

    private createFrontmatter(page: ConfluencePage): string {
        const frontmatter = {
            title: page.title,
            id: page.id,
            url: `${page._links.webui}`,
            space: page.space?.key || "",
            spaceName: page.space?.name || "",
            labels: page.metadata?.labels?.results?.map(label => label.name) || [],
            author: page.history?.createdBy?.displayName || "Unknown",
            created: page.history?.createdDate || "",
            lastUpdated: page.history?.lastUpdated?.when || new Date().toISOString(),
            version: page.version?.number || 1,
            ancestors: page.ancestors.map(ancestor => ({ id: ancestor.id, title: ancestor.title })),
        };

        return [
            "---",
            ...Object.entries(frontmatter).map(([key, value]) => {
                if (Array.isArray(value)) {
                    if (value.length === 0) return `${key}: []`;

                    if (typeof value[0] === "object") {
                        return `${key}:\n${
                            value.map(v =>
                                Object.entries(v).map(([k, val]) => `  - ${k}: "${String(val).replace(/"/g, "\\\"")}"`)
                                    .join("\n")
                            ).join("\n")
                        }`;
                    }

                    return `${key}:\n${value.map(v => `  - "${String(v).replace(/"/g, "\\\"")}"`).join("\n")}`;
                } else if (typeof value === "object") {
                    return `${key}:\n${
                        Object.entries(value)
                            .map(([k, v]) => `  ${k}: "${String(v).replace(/"/g, "\\\"")}"`)
                            .join("\n")
                    }`;
                }

                // Escape strings to ensure valid YAML
                if (typeof value === "string") {
                    return `${key}: "${value.replace(/"/g, "\\\"")}"`;
                }

                return `${key}: ${value}`;
            }),
            "---",
            "",
        ].join("\n");
    }

    private extractInlineCommentRefs(htmlContent: string): Map<string, string> {
        const refMap = new Map<string, string>();

        // Use regex to find all inline comment markers
        // Match the entire marker including the content between opening and closing tags
        const markerRegex = /<ac:inline-comment-marker\s+ac:ref="([^"]+)"[^>]*>(.*?)<\/ac:inline-comment-marker>/gs;
        let match;

        while ((match = markerRegex.exec(htmlContent)) !== null) {
            const [, ref, content] = match;
            // Store the reference ID and the exact content being commented on
            refMap.set(ref, content);
        }

        return refMap;
    }

    private processComments(comments: ConfluenceComment[], inlineRefMap: Map<string, string>): EnrichedComment[] {
        // Debug log for inline references
        if (process.env.DEBUG) {
            console.log(`Found ${inlineRefMap.size} inline comment references`);
            if (inlineRefMap.size > 0) {
                console.log("Reference IDs:", Array.from(inlineRefMap.keys()));
            }
        }

        return comments.map(comment => {
            const enriched: EnrichedComment = {
                ...comment,
                commentType: "footer",
            };

            // Extract author information from various possible locations
            if (!enriched.author?.displayName) {
                // Try to get author from history.createdBy if available
                if (comment.history?.createdBy?.displayName) {
                    enriched.author = comment.history.createdBy;
                } // Or from creator field
                else if (comment.creator?.displayName) {
                    enriched.author = comment.creator;
                }
            }

            // Extract created date from various possible locations
            if (!enriched.created) {
                // From history.createdDate
                if (comment.history?.createdDate) {
                    enriched.created = comment.history.createdDate;
                } // Or from version.when
                else if (comment.version?.when) {
                    enriched.created = comment.version.when;
                }
            }

            // Detect if it's an inline comment and extract info
            if (comment.extensions?.location === "inline") {
                enriched.commentType = "inline";
                if (process.env.DEBUG) console.log(`Processing inline comment: ${comment.id}`);

                // First check if we have inlineProperties directly
                if (comment.extensions.inlineProperties) {
                    if (process.env.DEBUG) {
                        console.log("Inline properties:", JSON.stringify(comment.extensions.inlineProperties));
                    }
                    // Check for either ref or markerRef property
                    const refId = comment.extensions.inlineProperties.ref
                        || comment.extensions.inlineProperties.markerRef;
                    if (refId) {
                        if (process.env.DEBUG) console.log(`Found reference ID: ${refId}`);
                        enriched.referenceId = refId;

                        // First try to use originalSelection if available
                        if (comment.extensions.inlineProperties.originalSelection) {
                            if (process.env.DEBUG) {
                                console.log(
                                    `Using originalSelection: ${comment.extensions.inlineProperties.originalSelection}`,
                                );
                            }
                            enriched.contextText = comment.extensions.inlineProperties.originalSelection;
                        } // Then try to get text from the reference map
                        else {
                            enriched.contextText = inlineRefMap.get(refId) || "";
                            if (process.env.DEBUG) console.log(`Context text from map: ${enriched.contextText}`);
                        }
                    } // Even if we don't have a refId, we might have originalSelection
                    else if (comment.extensions.inlineProperties.originalSelection) {
                        if (process.env.DEBUG) {
                            console.log(
                                `Using originalSelection without refId: ${comment.extensions.inlineProperties.originalSelection}`,
                            );
                        }
                        enriched.contextText = comment.extensions.inlineProperties.originalSelection;
                    }
                } // If not, try to extract from expandable path
                else if (comment.extensions?._expandable?.inlineProperties) {
                    if (process.env.DEBUG) console.log("Extracting from expandable path");
                    const inlinePropertiesPath = comment.extensions._expandable.inlineProperties;
                    if (inlinePropertiesPath) {
                        if (process.env.DEBUG) console.log(`Expandable path: ${inlinePropertiesPath}`);
                        // Try to extract ref ID
                        const refMatch = /ac:ref=([^&]+)/.exec(inlinePropertiesPath);
                        if (refMatch && refMatch[1]) {
                            const refId = refMatch[1];
                            if (process.env.DEBUG) console.log(`Found reference ID from expandable: ${refId}`);
                            enriched.referenceId = refId;
                            // Find the referenced text
                            enriched.contextText = inlineRefMap.get(refId) || "";
                            if (process.env.DEBUG) console.log(`Context text from map: ${enriched.contextText}`);
                        }

                        // Try to extract originalSelection
                        const selectionMatch = /originalSelection=([^&]+)/.exec(inlinePropertiesPath);
                        if (selectionMatch && selectionMatch[1]) {
                            const originalSelection = decodeURIComponent(selectionMatch[1]);
                            if (process.env.DEBUG) {
                                console.log(`Found originalSelection from expandable: ${originalSelection}`);
                            }
                            // Only use if we don't already have context text
                            if (!enriched.contextText) {
                                enriched.contextText = originalSelection;
                            }
                        }
                    }
                }
            }

            return enriched;
        });
    }

    private formatCommentSection(comment: EnrichedComment): string {
        const authorName = comment.author?.displayName || "Unknown Author";

        // Format the date consistently, or show unknown
        let formattedDate = "Unknown date";
        if (comment.created) {
            try {
                const date = new Date(comment.created);
                formattedDate = date.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                });
            } catch (e) {
                // console.error(`Error formatting date: ${comment.created}`, e);
            }
        }

        let markdown = `#### Comment by ${authorName} (${formattedDate})\n\n`;

        // Show the text that was commented on for inline comments
        if (comment.commentType === "inline" && comment.contextText) {
            // Clean up the referenced text - remove HTML tags if present
            let cleanText = comment.contextText;
            try {
                // Try to convert HTML to plain text if needed
                if (cleanText.includes("<") && cleanText.includes(">")) {
                    cleanText = this.turndownService.turndown(cleanText);
                }
            } catch (e) {
                // If conversion fails, use the original text
            }

            markdown += `**Referenced text:** \n> ${cleanText}\n\n`;
        }

        // Show the comment text
        markdown += `**Comment:** \n\`\`\`\n`;
        try {
            markdown += this.turndownService.turndown(
                comment.body.storage.value,
            );
        } catch (error) {
            // console.error(`Error converting comment to markdown:`, error);
            markdown += `**Error converting comment:** ${error instanceof Error ? error.message : String(error)}`;
        }
        markdown += `\n\`\`\`\n\n`;

        return markdown;
    }

    private formatInlineComments(markdown: string, comments: EnrichedComment[]): string {
        let result = markdown;

        // Collect all inline comments by reference ID
        const inlineComments = comments.filter(c => c.commentType === "inline" && c.referenceId);

        // Replace each marker with highlighted text and hidden comment ID
        for (const comment of inlineComments) {
            if (comment.referenceId) {
                const startMarker = `%%INLINE_COMMENT_MARKER_START:${comment.referenceId}%%`;
                const endMarker = `%%INLINE_COMMENT_MARKER_END:${comment.referenceId}%%`;

                // Regular expression to find the markers and text between them
                const markerRegex = new RegExp(
                    `${startMarker}(.*?)${endMarker}`,
                    "gs",
                );

                result = result.replace(markerRegex, (match, content) => {
                    // Add a highlighted text notation that indicates this has an inline comment
                    return `[${content}]{: .inline-comment data-comment-id="${comment.id}"}`;
                });
            }
        }

        // Remove any remaining markers that didn't get matched (fallback)
        result = result.replace(
            /%%INLINE_COMMENT_MARKER_START:[^%]+%%(.*?)%%INLINE_COMMENT_MARKER_END:[^%]+%%/gs,
            "$1",
        );

        return result;
    }

    convertPage(page: ConfluencePage, comments: ConfluenceComment[]): string {
        try {
            // Store current page for access by handlers
            this.currentPage = page;

            const frontmatter = this.createFrontmatter(page);
            let htmlContent = page.body.storage.value;

            // Pre-process HTML content to handle tables better
            try {
                // console.log('Pre-processing HTML content for tables');
                // Create a temporary DOM element to manipulate the HTML
                const tempDiv = new JSDOM(`<div>${htmlContent}</div>`).window.document.querySelector("div");

                if (tempDiv) {
                    // Find all Confluence tables
                    const tables = tempDiv.querySelectorAll("table.confluenceTable");
                    // console.log(`Found ${tables.length} Confluence tables for pre-processing`);

                    // Process each table to ensure it has proper structure
                    tables.forEach((table, index) => {
                        // console.log(`Pre-processing Confluence table ${index + 1}`);

                        // Ensure all cells have proper content
                        const cells = table.querySelectorAll("td, th");
                        cells.forEach(cell => {
                            // If a cell has empty content but has child elements, make sure they're properly formatted
                            if (!cell.textContent?.trim() && cell.children.length > 0) {
                                // console.log('Found empty cell with child elements, fixing');
                                // Add a non-breaking space to ensure the cell isn't completely empty
                                cell.innerHTML = cell.innerHTML + "&nbsp;";
                            }
                        });
                    });

                    // Update the HTML content with our processed version
                    htmlContent = tempDiv.innerHTML;
                }
            } catch (error) {
                // console.error('Error pre-processing tables:', error);
                // Continue with original HTML if pre-processing fails
            }

            // Extract inline comment references
            const inlineRefMap = this.extractInlineCommentRefs(htmlContent);

            // Process and enrich comments
            const enrichedComments = this.processComments(comments, inlineRefMap);

            // Convert HTML to markdown
            let markdown: string;
            try {
                markdown = this.turndownService.turndown(htmlContent);
            } catch (error) {
                // console.error(`Error converting HTML to markdown for page ${page.id} (${page.title}):`, error);
                markdown =
                    `**Error converting page content:** ${error instanceof Error ? error.message : String(error)}\n\n`
                    + `Original HTML content is preserved below:\n\n`
                    + "```html\n" + htmlContent + "\n```";
            }

            // Format the markdown to show inline comments nicely
            try {
                markdown = this.formatInlineComments(markdown, enrichedComments);
            } catch (error) {
                // console.error(`Error formatting inline comments for page ${page.id} (${page.title}):`, error);
                // Keep the markdown as is if there's an error formatting inline comments
            }

            // Append comments section if there are any comments
            if (comments.length > 0) {
                markdown += "\n\n---\n\n## Comments\n\n";

                // Group comments by type (inline vs footer)
                const inlineComments = enrichedComments.filter(c => c.commentType === "inline");
                const footerComments = enrichedComments.filter(c => c.commentType === "footer");

                // Show inline comments first, with their context
                if (inlineComments.length > 0) {
                    markdown += "### Inline Comments\n\n";

                    inlineComments.forEach((comment) => {
                        markdown += this.formatCommentSection(comment);
                    });
                }

                // Show footer comments
                if (footerComments.length > 0) {
                    markdown += "### Page Comments\n\n";

                    footerComments.forEach((comment) => {
                        markdown += this.formatCommentSection(comment);
                    });
                }
            }

            // Clear the current page reference
            this.currentPage = null;

            return `${frontmatter}\n${markdown}`;
        } catch (error) {
            // console.error(`Critical error converting page ${page.id} (${page.title}) to markdown:`, error);

            // Create a minimal frontmatter
            const minimalFrontmatter = [
                "---",
                `title: "${page.title.replace(/"/g, "\\\"")}"`,
                `id: "${page.id}"`,
                `url: "${page._links.webui}"`,
                "---",
                "",
            ].join("\n");

            // Return a markdown document with error information
            return `${minimalFrontmatter}\n# ${page.title}\n\n**ERROR CONVERTING PAGE**\n\n`
                + `There was an error converting this page to markdown: ${
                    error instanceof Error ? error.message : String(error)
                }\n\n`
                + `Please report this issue with the page ID: ${page.id}\n\n`
                + `## Original HTML Content\n\n`
                + "```html\n" + page.body.storage.value.substring(0, 1000)
                + (page.body.storage.value.length > 1000 ? "...(truncated)" : "") + "\n```";
        }
    }
}
