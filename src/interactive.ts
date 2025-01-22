import { select as selectSingle, confirm } from '@inquirer/prompts';
import { select } from 'inquirer-select-pro';
import { ConfluenceLibrary } from './library.js';
import chalk from 'chalk';
import path from 'path';
import type { SpaceInfo } from './types.js';

type PromptAnswers = {
    action: string;
    spaceKeys: string[];
    singleSpaceKey: string;
    localPath: string;
    localPaths: Record<string, string>;
    syncNow: boolean;
    confirm: boolean;
};

export class InteractiveConfluenceCLI {
    private library: ConfluenceLibrary;

    constructor(library: ConfluenceLibrary) {
        this.library = library;
    }

    async start(): Promise<void> {
        while (true) {
            const action = await selectSingle({
                message: 'What would you like to do?',
                choices: [
                    { name: 'List spaces', value: 'list' },
                    { name: 'Add space', value: 'add' },
                    { name: 'Remove space', value: 'remove' },
                    { name: 'Sync space', value: 'sync' },
                    { name: 'Sync all spaces', value: 'sync-all' },
                    { name: 'Exit', value: 'exit' },
                ],
            });

            if (action === 'exit') {
                break;
            }

            try {
                await this.handleAction(action);
            } catch (error) {
                console.error(chalk.red(`Error: ${(error as Error).message}`));
            }

            // Add a blank line for readability
            console.log();
        }
    }

    private async handleAction(action: string): Promise<void> {
        switch (action) {
            case 'list':
                await this.listSpaces();
                break;
            case 'add':
                await this.addSpace();
                break;
            case 'remove':
                await this.removeSpace();
                break;
            case 'sync':
                await this.syncSpace();
                break;
            case 'sync-all':
                await this.syncAllSpaces();
                break;
        }
    }

    private formatSpaceChoice(space: SpaceInfo): string {
        const description = space.description?.plain?.value
            ? chalk.dim(` - ${space.description.plain.value}`)
            : '';
        return `${chalk.bold(space.name)} ${chalk.cyan(`[${space.key}]`)}${description}`;
    }

    private async listSpaces(): Promise<void> {
        const spaces = await this.library.listSpaces();
        if (spaces.length === 0) {
            console.log(chalk.yellow('No spaces in library'));
            return;
        }

        console.log(chalk.bold('\nSpaces in library:'));
        spaces.forEach(space => {
            console.log(chalk.cyan(`\n${space.spaceKey} (${space.localPath})`));
            console.log(`Last synced: ${new Date(space.lastSync).toLocaleString()}`);
        });
    }

    private async addSpace(): Promise<void> {
        console.log(chalk.cyan('Fetching available spaces from Confluence...'));
        const availableSpaces = await this.library.getAvailableSpaces();
        
        if (availableSpaces.length === 0) {
            console.log(chalk.yellow('No spaces found in Confluence'));
            return;
        }

        const spaceKeys = await select({
            message: 'Select spaces to add:',
            multiple: true,
            filter: true,
            required: true,
            clearInputWhenSelected: true,
            options: (input = '') => {
                const searchTerm = input.toLowerCase();
                return availableSpaces
                    .filter(space => 
                        space.key.toLowerCase().includes(searchTerm) ||
                        space.name.toLowerCase().includes(searchTerm) ||
                        space.description?.plain?.value?.toLowerCase().includes(searchTerm)
                    )
                    .map(space => ({
                        name: this.formatSpaceChoice(space),
                        value: space.key,
                        description: space.description?.plain?.value,
                    }));
            },
            pageSize: 15,
            placeholder: 'Type to filter spaces...',
        });

        if (spaceKeys.length === 0) {
            console.log(chalk.yellow('No spaces selected'));
            return;
        }

        // Get local paths for each selected space
        const localPaths: Record<string, string> = {};
        for (const spaceKey of spaceKeys) {
            const space = availableSpaces.find(s => s.key === spaceKey)!;
            const localPath = await selectSingle({
                message: `Enter local directory name for ${chalk.cyan(space.key)} (${space.name}):`,
                choices: [
                    { name: space.key.toLowerCase(), value: space.key.toLowerCase() },
                    { name: space.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), value: space.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
                    { name: 'Custom...', value: 'custom' },
                ],
            });

            if (localPath === 'custom') {
                // TODO: Add custom input prompt when @inquirer/prompts adds input support
                // For now, use the space key
                localPaths[spaceKey] = space.key.toLowerCase();
            } else {
                localPaths[spaceKey] = localPath;
            }
        }

        // Add each selected space
        for (const spaceKey of spaceKeys) {
            await this.library.addSpace(spaceKey, localPaths[spaceKey]);
            console.log(chalk.green(`Added space ${spaceKey}`));
        }

        // Ask if user wants to sync now
        if (spaceKeys.length > 0) {
            const syncNow = await confirm({
                message: `Would you like to sync ${spaceKeys.length > 1 ? 'these spaces' : 'this space'} now?`,
                default: true,
            });

            if (syncNow) {
                for (const spaceKey of spaceKeys) {
                    console.log(chalk.cyan(`\nSyncing space ${spaceKey}...`));
                    await this.library.syncSpace(spaceKey);
                    console.log(chalk.green(`Synced space ${spaceKey}`));
                }
            }
        }
    }

    private async removeSpace(): Promise<void> {
        const spaces = await this.library.listSpaces();
        if (spaces.length === 0) {
            console.log(chalk.yellow('No spaces in library'));
            return;
        }

        const singleSpaceKey = await selectSingle({
            message: 'Select space to remove:',
            choices: spaces.map(space => ({
                name: `${space.spaceKey} (${space.localPath})`,
                value: space.spaceKey,
            })),
        });

        const shouldRemove = await confirm({
            message: chalk.yellow(`Are you sure you want to remove ${singleSpaceKey}? This will delete all local files.`),
            default: false,
        });

        if (shouldRemove) {
            await this.library.removeSpace(singleSpaceKey);
            console.log(chalk.green(`Removed space ${singleSpaceKey}`));
        }
    }

    private async syncSpace(): Promise<void> {
        const spaces = await this.library.listSpaces();
        if (spaces.length === 0) {
            console.log(chalk.yellow('No spaces in library'));
            return;
        }

        const singleSpaceKey = await selectSingle({
            message: 'Select space to sync:',
            choices: spaces.map(space => ({
                name: `${space.spaceKey} (${space.localPath}) - Last sync: ${new Date(space.lastSync).toLocaleString()}`,
                value: space.spaceKey,
            })),
        });

        await this.library.syncSpace(singleSpaceKey);
        console.log(chalk.green(`Synced space ${singleSpaceKey}`));
    }

    private async syncAllSpaces(): Promise<void> {
        const spaces = await this.library.listSpaces();
        if (spaces.length === 0) {
            console.log(chalk.yellow('No spaces in library'));
            return;
        }

        const shouldSync = await confirm({
            message: `Sync all ${spaces.length} spaces?`,
            default: true,
        });

        if (shouldSync) {
            console.log(chalk.cyan('\nStarting sync of all spaces...'));
            await this.library.syncAll();
            console.log(chalk.green('\nCompleted sync of all spaces'));
        }
    }
} 