// import { mkdir } from 'fs/promises';
// import path from 'path';
// import sqlite3 from 'better-sqlite3';
// import Logger from './logger.js';
// import type { DatabaseConfig, Setting, SpaceRecord, ConfluencePage, ConfluenceComment, ConfluenceFolder } from './types.js';

// // Define a Database type
// type Database = sqlite3.Database;

// export class DatabaseHandler {
//   private db: Database | null = null;
//   private dbPath: string;
//   private initialized = false;

//   constructor(config?: string | DatabaseConfig) {
//     if (typeof config === 'string') {
//       // If string is provided, use it directly as the path
//       this.dbPath = config;
//     } else if (config && config.dbPath) {
//       // If object with dbPath is provided, use that
//       this.dbPath = config.dbPath;
//     } else {
//       // Default location if not specified
//       const dataDir = process.env.XDG_DATA_HOME ||
//         path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'share');
//       const appDir = path.join(dataDir, 'confluence-downloader');
//       this.dbPath = path.join(appDir, 'confluence.db');
//     }
//   }

//   async initialize(): Promise<void> {
//     if (this.initialized) {
//       return;
//     }

//     // Ensure database directory exists
//     await mkdir(path.dirname(this.dbPath), { recursive: true });

//     try {
//       this.db = new sqlite3(this.dbPath);

//       // Create tables if they don't exist
//       this.createTables();
//       this.initialized = true;
//       Logger.info('db', `Database initialized at ${this.dbPath}`);
//     } catch (error) {
//       Logger.error('db', 'Failed to initialize database', error);
//       throw error;
//     }
//   }

//   /**
//    * Create all database tables
//    */
//   private createTables(): void {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     // Create settings table
//     this.db.exec(`
//       CREATE TABLE IF NOT EXISTS settings (
//         key TEXT PRIMARY KEY,
//         value TEXT NOT NULL
//       )
//     `);

//     // Create content tables
//     this.createContentTables();

//     Logger.info('db', 'Database tables created');
//   }

//   public getBaseConfiguration(): {baseUrl?: string, apiToken?: string, concurrency?: number} {
//     const baseUrl = this.getSetting('baseUrl');
//     const apiToken = this.getSetting('apiToken');
//     const concurrency = this.getSetting('concurrency');
//     return {baseUrl, apiToken, concurrency: concurrency ? parseInt(concurrency) : undefined};
//   }

//   public setBaseConfiguration(baseUrl: string, apiToken: string, concurrency?: number): void {
//     this.setSetting('baseUrl', baseUrl);
//     this.setSetting('apiToken', apiToken);
//     this.setSetting('concurrency', concurrency?.toString() || '5');
//   }

//   /**
//    * Create content tables (all tables except settings)
//    */
//   private createContentTables(): void {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     // Create spaces table
//     this.db.exec(`
//       CREATE TABLE IF NOT EXISTS spaces (
//         id TEXT PRIMARY KEY,
//         key TEXT UNIQUE NOT NULL,
//         name TEXT NOT NULL,
//         description TEXT,
//         local_path TEXT NOT NULL,
//         base_url TEXT NOT NULL,
//         last_synced TEXT,
//         enabled INTEGER NOT NULL DEFAULT 1,
//         status TEXT NOT NULL
//       )
//     `);

//     // Create pages table
//     this.db.exec(`
//       CREATE TABLE IF NOT EXISTS pages (
//         id TEXT PRIMARY KEY,
//         space_key TEXT NOT NULL,
//         title TEXT NOT NULL,
//         status TEXT,
//         body_storage TEXT,
//         body_atlas_doc_format TEXT,
//         web_ui_link TEXT,
//         self_link TEXT,
//         created_by_account_id TEXT,
//         created_by_display_name TEXT,
//         created_date TEXT,
//         last_updated_date TEXT,
//         version_number INTEGER,
//         parent_id TEXT,
//         parent_type TEXT,
//         FOREIGN KEY (space_key) REFERENCES spaces(key) ON DELETE CASCADE
//       )
//     `);

//     // Create comments table
//     this.db.exec(`
//       CREATE TABLE IF NOT EXISTS comments (
//         id TEXT PRIMARY KEY,
//         space_key TEXT,
//         title TEXT,
//         status TEXT,
//         body_storage TEXT,
//         body_atlas_doc_format TEXT,
//         web_ui_link TEXT,
//         self_link TEXT,
//         container_id TEXT,
//         container_type TEXT,
//         created_by_account_id TEXT,
//         created_by_display_name TEXT,
//         created_date TEXT,
//         comment_type TEXT,
//         reference_id TEXT,
//         inline_original_text TEXT,
//         resolution_status TEXT,
//         FOREIGN KEY (container_id) REFERENCES pages(id) ON DELETE CASCADE
//       )
//     `);

//     // Create folders table
//     this.db.exec(`
//       CREATE TABLE IF NOT EXISTS folders (
//         id TEXT PRIMARY KEY,
//         space_key TEXT NOT NULL,
//         title TEXT NOT NULL,
//         status TEXT,
//         body_storage TEXT,
//         body_atlas_doc_format TEXT,
//         web_ui_link TEXT,
//         self_link TEXT,
//         created_by_account_id TEXT,
//         created_by_display_name TEXT,
//         created_date TEXT,
//         parent_id TEXT,
//         parent_type TEXT,
//         FOREIGN KEY (space_key) REFERENCES spaces(key) ON DELETE CASCADE
//       )
//     `);

//     // Create ancestors table for hierarchical relationships
//     this.db.exec(`
//       CREATE TABLE IF NOT EXISTS ancestors (
//         id TEXT NOT NULL,
//         ancestor_id TEXT NOT NULL,
//         position INTEGER NOT NULL,
//         PRIMARY KEY (id, ancestor_id)
//       )
//     `);

//     // Create labels table
//     this.db.exec(`
//       CREATE TABLE IF NOT EXISTS labels (
//         content_id TEXT NOT NULL,
//         label_name TEXT NOT NULL,
//         PRIMARY KEY (content_id, label_name)
//       )
//     `);
//   }

//   // === SETTINGS MANAGEMENT ===

//   /**
//    * Get a setting value by key
//    */
//   getSetting(key: string): string | undefined {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
//       const result = stmt.get(key) as Setting | undefined;
//       return result?.value;
//     } catch (error) {
//       Logger.error('db', `Failed to get setting: ${key}`, error);
//       throw error;
//     }
//   }

//   /**
//    * Set a setting value
//    */
//   setSetting(key: string, value: string): void {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
//       stmt.run(key, value);
//       Logger.debug('db', `Setting saved: ${key}=${value}`);
//     } catch (error) {
//       Logger.error('db', `Failed to set setting: ${key}`, error);
//       throw error;
//     }
//   }

//   /**
//    * Get all settings as a key-value map
//    */
//   getAllSettings(): Record<string, string> {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('SELECT key, value FROM settings');
//       const results = stmt.all() as Setting[];

//       const settings: Record<string, string> = {};
//       for (const row of results) {
//         settings[row.key] = row.value;
//       }
//       return settings;
//     } catch (error) {
//       Logger.error('db', 'Failed to get all settings', error);
//       throw error;
//     }
//   }

//   /**
//    * Remove a setting
//    */
//   removeSetting(key: string): void {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
//       stmt.run(key);
//       Logger.debug('db', `Setting removed: ${key}`);
//     } catch (error) {
//       Logger.error('db', `Failed to remove setting: ${key}`, error);
//       throw error;
//     }
//   }

//   // === SPACE CONFIGURATION MANAGEMENT ===

//   /**
//    * Get a space configuration by key
//    */
//   getSpaceConfig(spaceKey: string): SpaceRecord | undefined {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('SELECT * FROM spaces WHERE key = ?');
//       return stmt.get(spaceKey) as SpaceRecord | undefined;
//     } catch (error) {
//       Logger.error('db', `Failed to get space config: ${spaceKey}`, error);
//       throw error;
//     }
//   }

//   /**
//    * Add or update a space configuration
//    */
//   saveSpaceConfig(spaceConfig: SpaceRecord): void {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare(`
//         INSERT OR REPLACE INTO spaces
//         (id, key, name, description, local_path, base_url, last_synced, enabled, status)
//         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//       `);

//       stmt.run(
//         spaceConfig.id,
//         spaceConfig.key,
//         spaceConfig.name,
//         spaceConfig.description || '',
//         spaceConfig.local_path,
//         spaceConfig.base_url,
//         spaceConfig.last_synced || new Date().toISOString(),
//         spaceConfig.enabled ? 1 : 0,
//         spaceConfig.status || 'current'
//       );

//       Logger.info('db', `Space configuration saved: ${spaceConfig.key}`);
//     } catch (error) {
//       Logger.error('db', `Failed to save space config: ${spaceConfig.key}`, error);
//       throw error;
//     }
//   }

//   /**
//    * Get all space configurations
//    */
//   getAllSpaceConfigs(): SpaceRecord[] {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('SELECT * FROM spaces ORDER BY key');
//       return stmt.all() as SpaceRecord[];
//     } catch (error) {
//       Logger.error('db', 'Failed to get all space configs', error);
//       throw error;
//     }
//   }

//   /**
//    * Remove a space configuration
//    */
//   removeSpaceConfig(spaceKey: string): void {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('DELETE FROM spaces WHERE key = ?');
//       stmt.run(spaceKey);
//       Logger.info('db', `Space configuration removed: ${spaceKey}`);
//     } catch (error) {
//       Logger.error('db', `Failed to remove space config: ${spaceKey}`, error);
//       throw error;
//     }
//   }

//   /**
//    * Update the last synced timestamp for a space
//    */
//   updateSpaceLastSynced(spaceKey: string, timestamp: string = new Date().toISOString()): void {
//     if (!this.db) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare('UPDATE spaces SET last_synced = ? WHERE key = ?');
//       stmt.run(timestamp, spaceKey);
//       Logger.debug('db', `Space last_synced updated: ${spaceKey} - ${timestamp}`);
//     } catch (error) {
//       Logger.error('db', `Failed to update space last_synced: ${spaceKey}`, error);
//       throw error;
//     }
//   }

//   // === CONTENT STORAGE METHODS ===

//   /**
//    * Insert or update a page
//    */
//   insertPage(page: ConfluencePage): void {
//     if (!this.db || !this.initialized) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare(`
//         INSERT OR REPLACE INTO pages (
//           id, space_key, title, status, body_storage, body_atlas_doc_format,
//           web_ui_link, self_link, created_by_account_id, created_by_display_name,
//           created_date, last_updated_date, version_number, parent_id, parent_type
//         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//       `);

//       stmt.run(
//         page.id,
//         page.space?.key,
//         page.title,
//         page.status,
//         page.body?.storage?.value,
//         page.body?.atlas_doc_format?.value,
//         page._links?.webui,
//         page._links?.self,
//         page.history?.createdBy?.accountId,
//         page.history?.createdBy?.displayName,
//         page.history?.createdDate,
//         page.history?.lastUpdated?.when,
//         page.version?.number,
//         page._v2?.parentId || page.ancestors?.[page.ancestors.length - 1]?.id,
//         page._v2?.parentType || 'page'
//       );

//       // Insert ancestors if present
//       if (page.ancestors && Array.isArray(page.ancestors) && page.ancestors.length > 0) {
//         const ancestorStmt = this.db.prepare(
//           'INSERT OR REPLACE INTO ancestors (id, ancestor_id, position) VALUES (?, ?, ?)'
//         );

//         for (let i = 0; i < page.ancestors.length; i++) {
//           const ancestor = page.ancestors[i];
//           ancestorStmt.run(page.id, ancestor.id, i);
//         }
//       }

//       // Insert labels
//       if (page.metadata?.labels?.results && Array.isArray(page.metadata.labels.results)) {
//         const labelStmt = this.db.prepare(
//           'INSERT OR REPLACE INTO labels (content_id, label_name) VALUES (?, ?)'
//         );

//         for (const label of page.metadata.labels.results) {
//           labelStmt.run(page.id, label.name);
//         }
//       }
//     } catch (error) {
//       console.error('Error inserting page:', error);
//       throw error;
//     }
//   }

//   /**
//    * Insert or update a comment
//    */
//   insertComment(comment: ConfluenceComment): void {
//     if (!this.db || !this.initialized) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const commentType = comment.extensions?.location === 'inline' ? 'inline' : 'footer';

//       const stmt = this.db.prepare(`
//         INSERT OR REPLACE INTO comments (
//           id, space_key, title, status, body_storage, body_atlas_doc_format,
//           web_ui_link, self_link, container_id, container_type, created_by_account_id,
//           created_by_display_name, created_date, comment_type, reference_id, inline_original_text,
//           resolution_status
//         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//       `);

//       console.log(comment);
//       stmt.run(
//         comment.id,
//         comment.space?.key,
//         comment.title,
//         comment.status,
//         comment.body?.storage?.value,
//         comment.body?.atlas_doc_format?.value,
//         comment._links?.webui,
//         comment._links?.self,
//         comment.container?.id,
//         comment.container?.type,
//         comment.history?.createdBy?.accountId || comment.author?.accountId,
//         comment.history?.createdBy?.displayName || comment.author?.displayName,
//         comment.history?.createdDate || comment.created,
//         commentType,
//         comment.extensions?.inlineProperties?.markerRef,
//         comment.extensions?.inlineProperties?.originalText,
//         comment.extensions?.resolution?.status
//       );

//       // Insert labels if present
//       if (comment.metadata?.labels?.results && Array.isArray(comment.metadata.labels.results)) {
//         const labelStmt = this.db.prepare(
//           'INSERT OR REPLACE INTO labels (content_id, label_name) VALUES (?, ?)'
//         );

//         for (const label of comment.metadata.labels.results) {
//           labelStmt.run(comment.id, label.name);
//         }
//       }
//     } catch (error) {
//       console.error('Error inserting comment:', error);
//       throw error;
//     }
//   }

//   /**
//    * Insert or update a folder
//    */
//   insertFolder(folder: ConfluenceFolder): void {
//     if (!this.db || !this.initialized) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       const stmt = this.db.prepare(`
//         INSERT OR REPLACE INTO folders (
//           id, space_key, title, status, body_storage, body_atlas_doc_format,
//           web_ui_link, self_link, created_by_account_id, created_by_display_name,
//           created_date, parent_id, parent_type
//         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//       `);

//       stmt.run(
//         folder.id,
//         folder.space?.key,
//         folder.title,
//         folder.status,
//         folder.body?.storage?.value,
//         folder.body?.atlas_doc_format?.value,
//         folder._links?.webui,
//         folder._links?.self,
//         folder.history?.createdBy?.accountId,
//         folder.history?.createdBy?.displayName,
//         folder.history?.createdDate,
//         folder.ancestors?.[folder.ancestors.length - 1]?.id,
//         folder.ancestors?.[folder.ancestors.length - 1]?.type || 'page'
//       );

//       // Insert ancestors if present
//       if (folder.ancestors && Array.isArray(folder.ancestors) && folder.ancestors.length > 0) {
//         const ancestorStmt = this.db.prepare(
//           'INSERT OR REPLACE INTO ancestors (id, ancestor_id, position) VALUES (?, ?, ?)'
//         );

//         for (let i = 0; i < folder.ancestors.length; i++) {
//           const ancestor = folder.ancestors[i];
//           ancestorStmt.run(folder.id, ancestor.id, i);
//         }
//       }

//       // Insert labels
//       if (folder.metadata?.labels?.results && Array.isArray(folder.metadata.labels.results)) {
//         const labelStmt = this.db.prepare(
//           'INSERT OR REPLACE INTO labels (content_id, label_name) VALUES (?, ?)'
//         );

//         for (const label of folder.metadata.labels.results) {
//           labelStmt.run(folder.id, label.name);
//         }
//       }
//     } catch (error) {
//       console.error('Error inserting folder:', error);
//       throw error;
//     }
//   }

//   /**
//    * Close the database connection
//    */
//   close(): void {
//     if (this.db) {
//       this.db.close();
//       this.db = null;
//       this.initialized = false;
//     }
//   }

//   /**
//    * Reset the database by dropping all content tables and recreating them
//    * This preserves the settings table
//    */
//   resetDatabase(): void {
//     if (!this.db || !this.initialized) {
//       throw new Error('Database not initialized');
//     }

//     try {
//       Logger.info('db', 'Resetting database - dropping content tables');

//       // Start a transaction
//       this.db.exec('BEGIN TRANSACTION');

//       // Drop all content tables but keep settings
//       const tablesToDrop = [
//         'spaces',
//         'pages',
//         'comments',
//         'folders',
//         'ancestors',
//         'labels'
//       ];

//       for (const table of tablesToDrop) {
//         this.db.exec(`DROP TABLE IF EXISTS ${table}`);
//         Logger.info('db', `Dropped table: ${table}`);
//       }

//       // Recreate the tables
//       this.createContentTables();

//       // Commit the transaction
//       this.db.exec('COMMIT');

//       Logger.info('db', 'Database reset complete');
//     } catch (error) {
//       // Rollback on error
//       if (this.db) {
//         this.db.exec('ROLLBACK');
//       }
//       Logger.error('db', 'Failed to reset database', error);
//       throw error;
//     }
//   }
// }
