import TurndownService from "turndown";
import type { ConfluenceComment, ConfluencePage } from "./types.js";

export class MarkdownConverter {
    private turndownService: TurndownService;

    constructor() {
        this.turndownService = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
        });
    }

    private createFrontmatter(page: ConfluencePage): string {
        const frontmatter = {
            title: page.title,
            labels: page.metadata?.labels?.results?.map(label => label.name) || [],
            author: page.history?.createdBy?.displayName || "Unknown",
            lastUpdated: page.history?.lastUpdated || new Date().toISOString(),
            confluence: {
                id: page.id,
                version: page.version?.number || 1,
                space: page.space?.key || "",
            },
        };

        return [
            "---",
            ...Object.entries(frontmatter).map(([key, value]) => {
                if (Array.isArray(value)) {
                    return `${key}:\n${value.map(v => `  - ${v}`).join("\n")}`;
                } else if (typeof value === "object") {
                    return `${key}:\n${
                        Object.entries(value)
                            .map(([k, v]) => `  ${k}: ${v}`)
                            .join("\n")
                    }`;
                }
                return `${key}: ${value}`;
            }),
            "---",
            "",
        ].join("\n");
    }

    convertPage(page: ConfluencePage, comments: ConfluenceComment[]): string {
        const frontmatter = this.createFrontmatter(page);
        const htmlContent = page.body.storage.value;
        let markdown = this.turndownService.turndown(htmlContent);

        if (comments.length > 0) {
            markdown += "\n\n---\n\n## Comments\n\n";
            comments.forEach((comment) => {
                const authorName = comment.author?.displayName || "Unknown Author";
                markdown += `### ${authorName} (${
                    new Date(
                        comment.created,
                    ).toLocaleDateString()
                })\n\n`;
                markdown += this.turndownService.turndown(
                    comment.body.storage.value,
                );
                markdown += "\n\n";
            });
        }

        return `${frontmatter}\n${markdown}`;
    }
}
