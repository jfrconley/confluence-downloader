import fs from 'fs-extra';
import path from 'path';
import type { ConfluencePage } from './types.js';

export class FileSystemHandler {
    constructor(private readonly outputDir: string) {}

    async writePage(page: ConfluencePage, content: string): Promise<void> {
        const filePath = this.getFilePath(page);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, 'utf8');
    }

    private getFilePath(page: ConfluencePage): string {
        // Get the directory path from ancestors
        const pathParts = page.ancestors.map((ancestor: { title: string }) => this.sanitizePathComponent(ancestor.title));
        
        // Create the directory path
        const dirPath = path.join(this.outputDir, ...pathParts);
        
        // If this page has child pages, place it as description.md inside its directory
        const hasChildren = Boolean(page.children?.page?.results?.length);
        if (hasChildren) {
            const pageDir = path.join(dirPath, this.sanitizePathComponent(page.title));
            return path.join(pageDir, 'description.md');
        }
        
        // Otherwise, create it as a regular file
        return path.join(dirPath, `${this.sanitizePathComponent(page.title)}.md`);
    }

    private sanitizePathComponent(part: string): string {
        // Replace characters that are invalid in file paths
        return part.replace(/[<>:"/\\|?*]/g, '_');
    }

    async clean(): Promise<void> {
        await fs.emptyDir(this.outputDir);
    }
} 