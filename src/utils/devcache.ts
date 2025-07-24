import { Logger } from './logger.ts';

export interface DevCacheOptions {
  basePath: string;
  serviceName: string;
  logger: Logger;
  cacheDuration?: number; // in milliseconds
}
/**
 * DevCache is a utility class for caching data in a directory.
 * Mostly used for
 * It provides methods for getting, setting, and clearing cached data.
 * The cache is stored in a directory under the basePath/serviceName.
 * The cache is only used in debug mode.
 * The cache duration is 6 hours.
 */
export class DevCache {
  private cacheDir: string;
  private isDebugMode: boolean;
  private cacheDuration: number;
  private logger: Logger;

  constructor(options: DevCacheOptions) {
    this.logger = options.logger;
    this.isDebugMode = Deno.env.get('nova_DEBUG') === 'true';
    this.cacheDuration = options.cacheDuration || 6 * 60 * 60 * 1000; // Default 6 hours

    // Set up cache directory under basePath/serviceName
    const homeDir = Deno.env.get('HOME');
    if (!homeDir) {
      this.logger.error('HOME environment variable not set');
      this.cacheDir = `.cache/${options.serviceName}`; // Fallback to local .cache if HOME is not set
    } else {
      this.cacheDir = `${options.basePath}/${options.serviceName}`;
    }

    // Only create cache directory in debug mode
    if (this.isDebugMode) {
      try {
        Deno.mkdirSync(this.cacheDir, { recursive: true });
        this.logger.debug(`Cache directory created at ${this.cacheDir}`);
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          this.logger.error('Failed to create cache directory:', error);
        }
      }
    }
  }

  private async getCacheFilePath(key: string, queryType: string): Promise<string> {
    const data = new TextEncoder().encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hash = Array.from(
      new Uint8Array(hashBuffer)
    ).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

    const subDir = queryType ? `${this.cacheDir}/${queryType}` : this.cacheDir;
    
    try {
      await Deno.mkdir(subDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }

    return `${subDir}/${hash}.json`;
  }

  public async get<T>(key: string, queryType: string): Promise<T | null> {
    if (!this.isDebugMode) {
      return null;
    }

    try {
      const cacheFile = await this.getCacheFilePath(key, queryType);
      const content = await Deno.readTextFile(cacheFile);
      const cached = JSON.parse(content);
      
      if (Date.now() - cached.timestamp < this.cacheDuration) {
        this.logger.debug(`Using cached data for ${queryType}_${key.slice(0, 50)}...`);
        return cached.data as T;
      }
    } catch {
      // Cache miss or expired
    }
    return null;
  }

  public async set<T>(key: string, data: T, queryType: string): Promise<void> {
    if (!this.isDebugMode) {
      return;
    }

    try {
      const cacheFile = await this.getCacheFilePath(key, queryType);
      await Deno.writeTextFile(cacheFile, JSON.stringify({
        timestamp: Date.now(),
        data
      }));
      this.logger.debug(`Cached data for ${queryType}_${key.slice(0, 50)}...`);
    } catch (error) {
      this.logger.error(`Failed to cache data for ${key}:`, error);
    }
  }

  public async clear(pattern?: string): Promise<void> {
    if (!this.isDebugMode) {
      this.logger.debug('Cache operations disabled in non-debug mode');
      return;
    }

    try {
      // Get all subdirectories in cache
      for await (const dirEntry of Deno.readDir(this.cacheDir)) {
        if (dirEntry.isDirectory) {
          const subdir = `${this.cacheDir}/${dirEntry.name}`;
          try {
            for await (const file of Deno.readDir(subdir)) {
              if (file.isFile) {
                if (!pattern || file.name.includes(pattern)) {
                  await Deno.remove(`${subdir}/${file.name}`);
                  this.logger.debug(`Cleared cache file: ${dirEntry.name}/${file.name}`);
                }
              }
            }
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to clear cache:', error);
    }
  }
} 