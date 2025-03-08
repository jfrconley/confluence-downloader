/* eslint-disable @typescript-eslint/no-explicit-any */
import Logger from "./logger.js";
import type { ConfluenceComment, ConfluencePage, EnrichedComment } from "./types.js";

// ADF Schema Types
export interface ADFNode {
    type: string;
    attrs?: Record<string, any>;
    content?: ADFNode[];
    marks?: ADFMark[];
    text?: string;
}

export interface ADFMark {
    type: string;
    attrs?: Record<string, any>;
}

export interface ADFDocument {
    version: number;
    type: 'doc';
    content?: ADFNode[];
}

// Interface for node handlers that convert ADF nodes to Markdown
interface NodeHandler {
    type: string;
    handle(node: ADFNode, context: ConverterContext): string;
}

// Interface for mark handlers that convert ADF marks to Markdown
interface MarkHandler {
    type: string;
    handle(text: string, mark: ADFMark): string;
}

// Context object passed through the conversion process
interface ConverterContext {
    page: ConfluencePage;
    nodeHandlers: Map<string, NodeHandler>;
    markHandlers: Map<string, MarkHandler>;
    convertNode(node: ADFNode): string;
    convertNodes(nodes: ADFNode[] | undefined): string;
    applyMarks(text: string, marks: ADFMark[] | undefined, context?: ConverterContext): string;
    sanitizeText(text: string): string;
    tables: {
        cellContentsByTableId: Map<string, string[][]>;
        currentTableId: string | null;
        currentRowIndex: number;
        currentCellIndex: number;
    };
}

/**
 * ADF to Markdown converter
 * Converts Confluence pages from Atlassian Document Format to Markdown
 */
export class ADFMarkdownConverter {
    private nodeHandlers: Map<string, NodeHandler> = new Map();
    private markHandlers: Map<string, MarkHandler> = new Map();
    private tableIdCounter = 0;

    constructor() {
        this.registerNodeHandlers();
        this.registerMarkHandlers();
    }

    /**
     * Convert a Confluence page with ADF content to Markdown
     */
    convertPage(page: ConfluencePage, comments: ConfluenceComment[]): string {
        try {
            if (page?.body?.atlas_doc_format?.value === null) {
                throw new Error("No ADF content found in page body");
            }

            // Extract the ADF content from the page
            const adfContent: ADFDocument = JSON.parse(page.body?.atlas_doc_format?.value!)

            // Create the context object for conversion
            const context: ConverterContext = {
                page,
                nodeHandlers: this.nodeHandlers,
                markHandlers: this.markHandlers,
                convertNode: (node) => this.convertNode(node, context),
                convertNodes: (nodes) => this.convertNodes(nodes, context),
                applyMarks: (text, marks) => this.applyMarks(text, marks, context),
                sanitizeText: (text) => this.sanitizeText(text),
                tables: {
                    cellContentsByTableId: new Map(),
                    currentTableId: null,
                    currentRowIndex: 0,
                    currentCellIndex: 0
                }
            };

            // Convert the ADF document to markdown
            let markdown = this.convertNode(adfContent, context);
            
            // Process comments and add them to the markdown
            const enrichedComments = this.processComments(comments);
            markdown = this.addComments(markdown, enrichedComments);
            
            // Add frontmatter with page metadata
            const frontmatter = this.createFrontmatter(page);
            
            return frontmatter + markdown;
        } catch (error) {
            Logger.error("converter", `Error converting page ${page.id} (${page.title}): ${error}`);
            return `**Error converting page content:** ${error instanceof Error ? error.message : String(error)}\n\n`;
        }
    }

    /**
     * Convert an ADF node to Markdown
     */
    private convertNode(node: ADFNode, context: ConverterContext): string {
        if (!node || typeof node !== 'object') {
            return '';
        }

        if (node.type === 'text' && typeof node.text === 'string') {
            return this.applyMarks(context.sanitizeText(node.text), node.marks, context);
        }

        const handler = context.nodeHandlers.get(node.type);
        if (handler) {
            return handler.handle(node, context);
        }

        // Fallback for unknown node types
        Logger.warn("converter", `No handler for node type: ${node.type}`);
        if (node.content) {
            return context.convertNodes(node.content);
        }
        return '';
    }

    /**
     * Convert an array of ADF nodes to Markdown
     */
    private convertNodes(nodes: ADFNode[] | undefined, context: ConverterContext): string {
        if (!nodes || nodes.length === 0) {
            return '';
        }

        return nodes.map(node => this.convertNode(node, context)).join('');
    }

    /**
     * Apply marks (formatting) to a text string
     */
    private applyMarks(text: string, marks: ADFMark[] | undefined, context: ConverterContext): string {
        if (!text || !marks || marks.length === 0) {
            return text;
        }

        // Sort marks by priority
        const sortedMarks = [...marks].sort((a, b) => this.getMarkPriority(a.type) - this.getMarkPriority(b.type));

        // Apply marks in order
        return sortedMarks.reduce((result, mark) => {
            const handler = context.markHandlers.get(mark.type);
            if (handler) {
                return handler.handle(result, mark);
            }
            Logger.warn("converter", `No handler for mark type: ${mark.type}`);
            return result;
        }, text);
    }

    /**
     * Get the priority of a mark type for correct nesting order
     */
    private getMarkPriority(markType: string): number {
        const priorities: Record<string, number> = {
            'code': 1,        // Apply code formatting first (monospace)
            'link': 2,        // Then links
            'em': 3,          // Then emphasis
            'strong': 4,      // Then strong
            'strike': 5,      // Then strikethrough
            'underline': 6,   // Then underline
            'textColor': 7,   // Then text color
            'subsup': 8       // Then subscript/superscript
        };

        return priorities[markType] || 100; // Unknown marks get lowest priority
    }

    /**
     * Sanitize text content
     */
    private sanitizeText(text: string): string {
        return text
            .replace(/\\/g, '\\\\')  // Escape backslashes
            .replace(/\*/g, '\\*')   // Escape asterisks
            .replace(/\_/g, '\\_')   // Escape underscores
            .replace(/\`/g, '\\`')   // Escape backticks
            .replace(/\[/g, '\\[')   // Escape square brackets
            .replace(/\]/g, '\\]')
            .replace(/\(/g, '\\(')   // Escape parentheses
            .replace(/\)/g, '\\)')
            .replace(/\#/g, '\\#')   // Escape hash
            .replace(/\+/g, '\\+')   // Escape plus
            .replace(/\-/g, '\\-')   // Escape minus
            .replace(/\./g, '\\.')   // Escape dot
            .replace(/\!/g, '\\!');  // Escape exclamation mark
    }

    /**
     * Create frontmatter with page metadata
     */
    private createFrontmatter(page: ConfluencePage): string {
        const frontmatterData: Record<string, any> = {
            title: page.title,
            id: page.id,
            url: page._links?.webui || null,
            space: page.space?.key || null,
            spaceName: page.space?.name || null,
        };

        // Add version info
        if (page.version) {
            frontmatterData.version = {
                number: page.version.number,
                by: page.version.by?.displayName || null,
                when: page.version.when || null
            };
        }

        // Add creator info
        if (page.history?.createdBy) {
            frontmatterData.created = {
                by: page.history.createdBy.displayName || null,
                when: page.history.createdDate || null
            };
        }

        // Add labels if available
        if (page.metadata?.labels?.results && page.metadata.labels.results.length > 0) {
            frontmatterData.labels = page.metadata.labels.results.map(label => label.name);
        }

        // Add hierarchy info
        if (page.ancestors && page.ancestors.length > 0) {
            frontmatterData.ancestors = page.ancestors.map(ancestor => ({
                id: ancestor.id,
                title: ancestor.title
            }));
        }

        const yaml = Object.entries(frontmatterData)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => {
                if (typeof value === 'object') {
                    return `${key}: ${JSON.stringify(value)}`;
                }
                return `${key}: ${typeof value === 'string' ? `"${value.replace(/"/g, '\\"')}"` : value}`;
            })
            .join('\n');

        return `---\n${yaml}\n---\n\n`;
    }

    /**
     * Process comments and prepare them for inclusion in the markdown
     */
    private processComments(comments: ConfluenceComment[]): EnrichedComment[] {
        if (!comments || comments.length === 0) {
            return [];
        }

        return comments.map(comment => {
            const enrichedComment: EnrichedComment = {
                ...comment,
                commentType: comment.extensions?.location === 'inline' ? 'inline' : 'footer',
                referenceId: comment.extensions?.inlineProperties?.ref || undefined
            };
            
            return enrichedComment;
        });
    }

    /**
     * Add comments to the markdown content
     */
    private addComments(markdown: string, comments: EnrichedComment[]): string {
        if (!comments || comments.length === 0) {
            return markdown;
        }

        // Add footer comments at the end
        const footerComments = comments.filter(c => c.commentType === 'footer');
        if (footerComments.length > 0) {
            markdown += '\n\n## Comments\n\n';
            footerComments.forEach(comment => {
                markdown += this.formatComment(comment);
            });
        }

        // TODO: Add inline comments references
        // This is a complex task that requires maintaining the positions as we transform
        // from ADF to markdown. For a complete implementation, we would need to track 
        // positions of text nodes and match them with comment references.

        return markdown;
    }

    /**
     * Format a single comment
     */
    private formatComment(comment: EnrichedComment): string {
        const author = comment.author?.displayName || comment.creator?.displayName || 'Unknown';
        const date = comment.created ? new Date(comment.created).toLocaleString() : 'Unknown date';
        
        let markdown = `### ${author} - ${date}\n\n`;
        
        // Convert comment body from HTML to markdown
        // In a real implementation, you would parse the body.storage.value as ADF if it's in that format
        const commentContent = comment.body?.storage?.value || '';
        markdown += `${commentContent}\n\n`;
        
        return markdown;
    }

    /**
     * Register all node handlers
     */
    private registerNodeHandlers(): void {
        // Document node
        this.nodeHandlers.set('doc', {
            type: 'doc',
            handle: (node, context) => {
                return context.convertNodes(node.content);
            }
        });

        // Paragraph node
        this.nodeHandlers.set('paragraph', {
            type: 'paragraph',
            handle: (node, context) => {
                return context.convertNodes(node.content) + '\n\n';
            }
        });

        // Heading nodes (levels 1-6)
        this.nodeHandlers.set('heading', {
            type: 'heading',
            handle: (node, context) => {
                const level = node.attrs?.level || 1;
                const headingMarker = '#'.repeat(Math.min(level, 6));
                return `${headingMarker} ${context.convertNodes(node.content)}\n\n`;
            }
        });

        // Text node
        this.nodeHandlers.set('text', {
            type: 'text',
            handle: (node, context) => {
                if (typeof node.text !== 'string') {
                    return '';
                }
                return context.applyMarks(context.sanitizeText(node.text), node.marks, context);
            }
        });

        // Bullet list
        this.nodeHandlers.set('bulletList', {
            type: 'bulletList',
            handle: (node, context) => {
                if (!node.content) return '';
                return context.convertNodes(node.content) + '\n';
            }
        });

        // List item
        this.nodeHandlers.set('listItem', {
            type: 'listItem',
            handle: (node, context) => {
                return `- ${context.convertNodes(node.content)}`;
            }
        });

        // Ordered list
        this.nodeHandlers.set('orderedList', {
            type: 'orderedList',
            handle: (node, context) => {
                if (!node.content) return '';
                
                let result = '';
                node.content.forEach((item, index) => {
                    result += `${index + 1}. ${context.convertNode(item)}`;
                });
                
                return result + '\n';
            }
        });

        // Code block
        this.nodeHandlers.set('codeBlock', {
            type: 'codeBlock',
            handle: (node, context) => {
                const language = node.attrs?.language || '';
                const content = context.convertNodes(node.content) || '';
                return '```' + language + '\n' + content + '\n```\n\n';
            }
        });

        // Block quote
        this.nodeHandlers.set('blockquote', {
            type: 'blockquote',
            handle: (node, context) => {
                const content = context.convertNodes(node.content) || '';
                const lines = content.split('\n');
                const quotedLines = lines.map(line => line ? `> ${line}` : '>');
                return quotedLines.join('\n') + '\n\n';
            }
        });

        // Hard break
        this.nodeHandlers.set('hardBreak', {
            type: 'hardBreak',
            handle: () => '\n'
        });

        // Rule (horizontal rule)
        this.nodeHandlers.set('rule', {
            type: 'rule',
            handle: () => '---\n\n'
        });

        // Panel
        this.nodeHandlers.set('panel', {
            type: 'panel',
            handle: (node, context) => {
                const title = node.attrs?.title || '';
                
                let result = '> ';
                if (title) {
                    result += `**${title}**\n> \n`;
                }
                
                const content = context.convertNodes(node.content) || '';
                const lines = content.trim().split('\n');
                result += lines.map(line => `> ${line}`).join('\n');
                
                return result + '\n\n';
            }
        });

        // Table
        this.nodeHandlers.set('table', {
            type: 'table',
            handle: (node, context) => {
                if (!node.content) return '';
                
                // Generate a unique ID for this table
                const tableId = `table_${++this.tableIdCounter}`;
                context.tables.currentTableId = tableId;
                context.tables.currentRowIndex = 0;
                context.tables.cellContentsByTableId.set(tableId, []);
                
                // First pass: collect all cell contents
                context.convertNodes(node.content);
                
                // Second pass: format the markdown table
                const rows = context.tables.cellContentsByTableId.get(tableId) || [];
                if (rows.length === 0) return '';
                
                // Determine the number of columns based on the row with the most cells
                const columnCount = Math.max(...rows.map(row => row.length));
                
                // Create the table header
                let table = '';
                const headerRow = rows[0] || Array(columnCount).fill('');
                
                // Ensure the header row has the right number of columns
                while (headerRow.length < columnCount) {
                    headerRow.push('');
                }
                
                // Create the table header
                table += '| ' + headerRow.join(' | ') + ' |\n';
                table += '| ' + Array(columnCount).fill('---').join(' | ') + ' |\n';
                
                // Add the table rows
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i] || [];
                    while (row.length < columnCount) {
                        row.push('');
                    }
                    table += '| ' + row.join(' | ') + ' |\n';
                }
                
                return table + '\n';
            }
        });

        // Table row
        this.nodeHandlers.set('tableRow', {
            type: 'tableRow',
            handle: (node, context) => {
                if (!node.content) return '';
                
                context.tables.currentCellIndex = 0;
                const rowIndex = context.tables.currentRowIndex++;
                
                // Ensure we have an array for this row
                const tableId = context.tables.currentTableId as string;
                const rows = context.tables.cellContentsByTableId.get(tableId) || [];
                rows[rowIndex] = rows[rowIndex] || [];
                
                context.tables.cellContentsByTableId.set(tableId, rows);
                
                return context.convertNodes(node.content);
            }
        });

        // Table cell and header
        const tableCellHandler = {
            handle: (node: ADFNode, context: ConverterContext) => {
                if (!node.content) return '';
                
                const tableId = context.tables.currentTableId as string;
                const rowIndex = context.tables.currentRowIndex - 1;
                const cellIndex = context.tables.currentCellIndex++;
                
                const rows = context.tables.cellContentsByTableId.get(tableId) || [];
                rows[rowIndex] = rows[rowIndex] || [];
                
                // Convert cell content
                const cellContent = context.convertNodes(node.content).trim().replace(/\n/g, ' ');
                rows[rowIndex][cellIndex] = cellContent;
                
                context.tables.cellContentsByTableId.set(tableId, rows);
                
                return '';
            }
        };
        
        this.nodeHandlers.set('tableCell', {
            type: 'tableCell',
            ...tableCellHandler
        });
        
        this.nodeHandlers.set('tableHeader', {
            type: 'tableHeader',
            ...tableCellHandler
        });

        // Media (images)
        this.nodeHandlers.set('media', {
            type: 'media',
            handle: (node) => {
                const fileId = node.attrs?.id;
                const fileName = node.attrs?.name || 'image';
                const fileType = node.attrs?.type || 'file';
                
                if (fileType === 'file') {
                    return `[${fileName}](attachment:${fileId})`;
                } else if (fileType === 'link') {
                    return `[${fileName}](${node.attrs?.url || ''})`;
                } else if (fileType === 'external') {
                    return `![${fileName}](${node.attrs?.url || ''})`;
                }
                
                return '';
            }
        });

        // Media group
        this.nodeHandlers.set('mediaGroup', {
            type: 'mediaGroup',
            handle: (node, context) => {
                return context.convertNodes(node.content) + '\n\n';
            }
        });

        // Media single (single image with caption)
        this.nodeHandlers.set('mediaSingle', {
            type: 'mediaSingle',
            handle: (node, context) => {
                // Convert the content (usually a media node)
                const mediaContent = context.convertNodes(node.content);
                
                // Add caption if present
                const caption = node.attrs?.caption || '';
                const captionText = caption ? `*${caption}*` : '';
                
                return mediaContent + (captionText ? '\n' + captionText : '') + '\n\n';
            }
        });

        // Task list
        this.nodeHandlers.set('taskList', {
            type: 'taskList',
            handle: (node, context) => {
                return context.convertNodes(node.content) + '\n';
            }
        });

        // Task item
        this.nodeHandlers.set('taskItem', {
            type: 'taskItem',
            handle: (node, context) => {
                const isChecked = node.attrs?.state === 'DONE';
                const checkbox = isChecked ? '[x]' : '[ ]';
                return `- ${checkbox} ${context.convertNodes(node.content)}`;
            }
        });

        // Mention
        this.nodeHandlers.set('mention', {
            type: 'mention',
            handle: (node) => {
                const text = node.attrs?.text || '';
                return `@${text}`;
            }
        });

        // Emoji
        this.nodeHandlers.set('emoji', {
            type: 'emoji',
            handle: (node) => {
                return node.attrs?.shortName || '';
            }
        });

        // Date
        this.nodeHandlers.set('date', {
            type: 'date',
            handle: (node) => {
                const timestamp = node.attrs?.timestamp;
                if (!timestamp) return '';
                
                const date = new Date(timestamp);
                return date.toLocaleDateString();
            }
        });

        // Status
        this.nodeHandlers.set('status', {
            type: 'status',
            handle: (node) => {
                const text = node.attrs?.text || '';
                return `[${text}]`;
            }
        });

        // Expand
        this.nodeHandlers.set('expand', {
            type: 'expand',
            handle: (node, context) => {
                const title = node.attrs?.title || 'Click to expand';
                let result = `<details>\n<summary>${title}</summary>\n\n`;
                
                // Convert the content
                result += context.convertNodes(node.content);
                
                result += `\n</details>\n\n`;
                
                return result;
            }
        });

        // Extension and bodied extension (macros)
        const extensionHandler = {
            handle: (node: ADFNode, context: ConverterContext) => {
                const extensionType = node.attrs?.extensionType || '';
                const extensionKey = node.attrs?.extensionKey || '';
                
                // Handle some common Confluence macros
                if (extensionType === 'com.atlassian.confluence.macro.core') {
                    if (extensionKey === 'code') {
                        const language = node.attrs?.parameters?.language || '';
                        const content = node.attrs?.parameters?.text || '';
                        return '```' + language + '\n' + content + '\n```\n\n';
                    }
                    
                    if (extensionKey === 'info' || extensionKey === 'note' || extensionKey === 'warning') {
                        const title = node.attrs?.parameters?.title || '';
                        const content = node.content ? context.convertNodes(node.content) : '';
                        
                        let result = `> **${extensionKey.toUpperCase()}**`;
                        if (title) {
                            result += `: ${title}`;
                        }
                        
                        result += '\n> \n';
                        
                        const lines = content.trim().split('\n');
                        result += lines.map(line => `> ${line}`).join('\n');
                        
                        return result + '\n\n';
                    }
                }
                
                // Generic fallback for unknown extensions
                return `[${extensionType}:${extensionKey}]\n\n`;
            }
        };
        
        this.nodeHandlers.set('extension', {
            type: 'extension',
            ...extensionHandler
        });
        
        this.nodeHandlers.set('bodiedExtension', {
            type: 'bodiedExtension',
            ...extensionHandler
        });

        // Layout section and column for multi-column content
        this.nodeHandlers.set('layoutSection', {
            type: 'layoutSection',
            handle: (node, context) => {
                return context.convertNodes(node.content) + '\n';
            }
        });
        
        this.nodeHandlers.set('layoutColumn', {
            type: 'layoutColumn',
            handle: (node, context) => {
                return context.convertNodes(node.content);
            }
        });

        // Decision list and item
        this.nodeHandlers.set('decisionList', {
            type: 'decisionList',
            handle: (node, context) => {
                return context.convertNodes(node.content) + '\n';
            }
        });
        
        this.nodeHandlers.set('decisionItem', {
            type: 'decisionItem',
            handle: (node, context) => {
                const state = node.attrs?.state || '';
                const prefix = state === 'DECIDED' ? '✓' : '❓';
                return `${prefix} ${context.convertNodes(node.content)}`;
            }
        });
    }

    /**
     * Register all mark handlers
     */
    private registerMarkHandlers(): void {
        // Link mark
        this.markHandlers.set('link', {
            type: 'link',
            handle: (text, mark) => {
                const href = mark.attrs?.href || '';
                const title = mark.attrs?.title || '';
                
                if (title) {
                    return `[${text}](${href} "${title}")`;
                }
                
                return `[${text}](${href})`;
            }
        });

        // Strong (bold) mark
        this.markHandlers.set('strong', {
            type: 'strong',
            handle: (text) => `**${text}**`
        });

        // Em (emphasis/italic) mark
        this.markHandlers.set('em', {
            type: 'em',
            handle: (text) => `*${text}*`
        });

        // Strike (strikethrough) mark
        this.markHandlers.set('strike', {
            type: 'strike',
            handle: (text) => `~~${text}~~`
        });

        // Code (inline code) mark
        this.markHandlers.set('code', {
            type: 'code',
            handle: (text) => `\`${text}\``
        });

        // Underline mark
        this.markHandlers.set('underline', {
            type: 'underline',
            handle: (text) => `<u>${text}</u>`
        });

        // Subsup (subscript/superscript) mark
        this.markHandlers.set('subsup', {
            type: 'subsup',
            handle: (text, mark) => {
                const type = mark.attrs?.type || 'sub';
                
                if (type === 'sub') {
                    return `<sub>${text}</sub>`;
                } else if (type === 'sup') {
                    return `<sup>${text}</sup>`;
                }
                
                return text;
            }
        });

        // Text color mark
        this.markHandlers.set('textColor', {
            type: 'textColor',
            handle: (text, mark) => {
                const color = mark.attrs?.color || '';
                if (!color) return text;
                
                return `<span style="color: ${color}">${text}</span>`;
            }
        });

        // Background color mark
        this.markHandlers.set('backgroundColor', {
            type: 'backgroundColor',
            handle: (text, mark) => {
                const color = mark.attrs?.color || '';
                if (!color) return text;
                
                return `<span style="background-color: ${color}">${text}</span>`;
            }
        });

        // Alignment mark
        this.markHandlers.set('alignment', {
            type: 'alignment',
            handle: (text, mark) => {
                const alignment = mark.attrs?.align || 'left';
                
                // Only add HTML for non-default alignment
                if (alignment === 'left') return text;
                
                return `<div style="text-align: ${alignment}">${text}</div>`;
            }
        });

        // Indentation mark
        this.markHandlers.set('indentation', {
            type: 'indentation',
            handle: (text, mark) => {
                const level = mark.attrs?.level || 0;
                if (level <= 0) return text;
                
                // Add indentation using non-breaking spaces
                const indent = '&nbsp;'.repeat(level * 2);
                return `${indent}${text}`;
            }
        });
    }
} 