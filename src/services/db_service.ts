import { DB } from 'sqlite';
import { join } from '@std/path';
import { ensureDir } from '@std/fs';
import { Logger } from '../utils/logger.ts';

export class DBService {
    private static instance: DBService;
    private db: DB;
    private dbPath: string;
    private logger: Logger;

    private constructor() {
        this.logger = new Logger('DBService');
        const homeDir = Deno.env.get('HOME');
        if (!homeDir) {
            this.logger.error('HOME environment variable not set.');
            throw new Error('HOME environment variable not set.');
        }

        const novaDir = join(homeDir, '.nova');
        this.dbPath = join(novaDir, 'nova.db');

        try {
            // Ensure the directory exists
            ensureDir(novaDir);

            this.db = new DB(this.dbPath);
            this.init();
        } catch (error) {
            this.logger.error(`Failed to initialize database at ${this.dbPath}:`, error);
            throw error;
        }
    }

    public static getInstance(): DBService {
        if (!DBService.instance) {
            DBService.instance = new DBService();
        }
        return DBService.instance;
    }

    private init(): void {
        try {
            this.db.query(`
        CREATE TABLE IF NOT EXISTS key_value_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
            this.db.query(`
        CREATE TABLE IF NOT EXISTS recent_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          key TEXT NOT NULL,
          data TEXT NOT NULL,
          last_viewed DATETIME NOT NULL,
          UNIQUE(type, key)
        )
      `);
        } catch (error) {
            this.logger.error('Error initializing database tables:', error);
            throw error;
        }
    }

    public set<T>(key: string, value: T): void {
        try {
            const serializedValue = JSON.stringify(value);
            this.db.query(
                'INSERT OR REPLACE INTO key_value_store (key, value) VALUES (?, ?)',
                [key, serializedValue],
            );
        } catch (error) {
            this.logger.error(`Failed to set value for key "${key}":`, error);
            throw error;
        }
    }

    public get<T>(key: string, defaultValue: T | null = null): T | null {
        try {
            const results = this.db.query('SELECT value FROM key_value_store WHERE key = ?', [key]);

            if (results.length > 0 && results[0] && results[0][0]) {
                try {
                    return JSON.parse(results[0][0] as string) as T;
                } catch (e) {
                    this.logger.error(`Failed to parse value for key "${key}":`, e);
                    return defaultValue;
                }
            }
            return defaultValue;
        } catch (error) {
            this.logger.error(`Failed to get value for key "${key}":`, error);
            return defaultValue;
        }
    }

    public delete(key: string): void {
        try {
            this.db.query('DELETE FROM key_value_store WHERE key = ?', [key]);
        } catch (error) {
            this.logger.error(`Failed to delete key "${key}":`, error);
            throw error;
        }
    }

    public addRecentItem<T>(type: string, key: string, item: T): void {
        try {
            const serializedData = JSON.stringify(item);
            this.db.query(
                'INSERT OR REPLACE INTO recent_items (type, key, data, last_viewed) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [type, key, serializedData],
            );

            // Prune old entries
            this.db.query(
                `
        DELETE FROM recent_items
        WHERE id IN (
          SELECT id FROM recent_items
          WHERE type = ?
          ORDER BY last_viewed DESC
          LIMIT -1 OFFSET 10
        )
      `,
                [type],
            );
        } catch (error) {
            this.logger.error(
                `Failed to add recent item for type "${type}" and key "${key}":`,
                error,
            );
            throw error;
        }
    }

    public getRecentItems<T>(type: string, limit = 10): T[] {
        try {
            const results = this.db.query(
                `
        SELECT data FROM recent_items
        WHERE type = ?
        ORDER BY last_viewed DESC
        LIMIT ?
      `,
                [type, limit],
            );
            return results.map((row) => JSON.parse(row[0] as string) as T);
        } catch (error) {
            this.logger.error(`Failed to get recent items for type "${type}":`, error);
            return [];
        }
    }

    public close(): void {
        try {
            this.db.close();
        } catch (error) {
            this.logger.error('Failed to close the database:', error);
            throw error;
        }
    }
}
