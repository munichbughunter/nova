import { createHash } from 'node:crypto';
import type { ReviewAnalysis } from '../agents/types.ts';
import type { Logger } from '../utils/logger.ts';
import type { MonitoringService } from './monitoring/monitoring.service.ts';

/**
 * Cache entry for analysis results
 */
interface CacheEntry {
    result: ReviewAnalysis;
    timestamp: number;
    fileHash: string;
    filePath: string;
    accessCount: number;
    lastAccessed: number;
    size: number; // Estimated memory size in bytes
}

/**
 * Cache entry for transformation results
 */
interface TransformationCacheEntry {
    transformedData: unknown;
    timestamp: number;
    sourceHash: string;
    transformationType: string;
    accessCount: number;
    lastAccessed: number;
    size: number;
}

/**
 * Cache metrics for monitoring
 */
export interface CacheMetrics {
    // Hit/Miss statistics
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
    hitRate: number;
    
    // Size and memory statistics
    totalEntries: number;
    maxEntries: number;
    memoryUsage: number;
    maxMemoryUsage: number;
    
    // Performance statistics
    averageAccessTime: number;
    evictionCount: number;
    transformationCacheHits: number;
    transformationCacheMisses: number;
    
    // File change statistics
    fileChangeDetections: number;
    expiredEntries: number;
    
    // Timing statistics
    oldestEntryAge: number;
    newestEntryAge: number;
}

/**
 * Performance cache for code analysis results
 */
export class PerformanceCache {
    private cache = new Map<string, CacheEntry>();
    private transformationCache = new Map<string, TransformationCacheEntry>();
    private logger: Logger;
    private maxCacheSize: number;
    private maxMemoryUsage: number; // Maximum memory usage in bytes
    private cacheExpiryMs: number;
    private monitoringService?: MonitoringService;
    
    // Metrics tracking
    private metrics: CacheMetrics = {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        hitRate: 0,
        totalEntries: 0,
        maxEntries: 0,
        memoryUsage: 0,
        maxMemoryUsage: 0,
        averageAccessTime: 0,
        evictionCount: 0,
        transformationCacheHits: 0,
        transformationCacheMisses: 0,
        fileChangeDetections: 0,
        expiredEntries: 0,
        oldestEntryAge: 0,
        newestEntryAge: 0,
    };
    
    private accessTimes: number[] = [];

    constructor(
        logger: Logger, 
        maxCacheSize = 1000, 
        cacheExpiryMs = 24 * 60 * 60 * 1000, // 24 hours default
        maxMemoryUsage = 100 * 1024 * 1024, // 100MB default
        monitoringService?: MonitoringService
    ) {
        this.logger = logger.child('PerformanceCache');
        this.maxCacheSize = maxCacheSize;
        this.cacheExpiryMs = cacheExpiryMs;
        this.maxMemoryUsage = maxMemoryUsage;
        this.monitoringService = monitoringService;
        this.metrics.maxEntries = maxCacheSize;
        this.metrics.maxMemoryUsage = maxMemoryUsage;
    }

    /**
     * Generate cache key for file
     */
    private generateCacheKey(filePath: string, content: string): string {
        const contentHash = createHash('sha256').update(content).digest('hex');
        return `${filePath}:${contentHash}`;
    }

    /**
     * Generate file hash for change detection
     */
    private generateFileHash(content: string): string {
        return createHash('sha256').update(content).digest('hex');
    }

    /**
     * Check if cache entry is valid
     */
    private isValidEntry(entry: CacheEntry): boolean {
        const now = Date.now();
        return (now - entry.timestamp) < this.cacheExpiryMs;
    }

    /**
     * Get cached analysis result
     */
    get(filePath: string, content: string): ReviewAnalysis | null {
        const startTime = Date.now();
        const cacheKey = this.generateCacheKey(filePath, content);
        const entry = this.cache.get(cacheKey);

        this.metrics.totalRequests++;

        if (!entry) {
            this.logger.debug(`Cache miss for ${filePath}`);
            this.metrics.cacheMisses++;
            this.updateMetrics(startTime);
            
            // Record cache miss in monitoring
            if (this.monitoringService) {
                this.monitoringService.recordCacheOperation('miss', 'analysis', Date.now() - startTime, { filePath });
            }
            
            return null;
        }

        if (!this.isValidEntry(entry)) {
            this.logger.debug(`Cache entry expired for ${filePath}`);
            this.cache.delete(cacheKey);
            this.metrics.cacheMisses++;
            this.metrics.expiredEntries++;
            this.updateMetrics(startTime);
            
            // Record cache miss due to expiration
            if (this.monitoringService) {
                this.monitoringService.recordCacheOperation('miss', 'analysis', Date.now() - startTime, { 
                    filePath, 
                    reason: 'expired' 
                });
            }
            
            return null;
        }

        // Verify file hasn't changed
        const currentHash = this.generateFileHash(content);
        if (entry.fileHash !== currentHash) {
            this.logger.debug(`File content changed for ${filePath}`);
            this.cache.delete(cacheKey);
            this.metrics.cacheMisses++;
            this.metrics.fileChangeDetections++;
            this.updateMetrics(startTime);
            
            // Record cache miss due to file change
            if (this.monitoringService) {
                this.monitoringService.recordCacheOperation('miss', 'analysis', Date.now() - startTime, { 
                    filePath, 
                    reason: 'file_changed' 
                });
            }
            
            return null;
        }

        // Update access tracking
        entry.accessCount++;
        entry.lastAccessed = Date.now();
        
        this.logger.debug(`Cache hit for ${filePath}`);
        this.metrics.cacheHits++;
        this.updateMetrics(startTime);
        
        // Record cache hit in monitoring
        if (this.monitoringService) {
            this.monitoringService.recordCacheOperation('hit', 'analysis', Date.now() - startTime, { 
                filePath,
                accessCount: entry.accessCount 
            });
        }
        
        return entry.result;
    }

    /**
     * Store analysis result in cache
     */
    set(filePath: string, content: string, result: ReviewAnalysis): void {
        const cacheKey = this.generateCacheKey(filePath, content);
        const fileHash = this.generateFileHash(content);

        // Check memory usage and evict if necessary
        this.checkMemoryUsageAndEvict();

        // Evict oldest entries if cache is full
        if (this.cache.size >= this.maxCacheSize) {
            this.evictOldestEntries();
        }

        const estimatedSize = this.estimateEntrySize(result, filePath, content);
        const entry: CacheEntry = {
            result,
            timestamp: Date.now(),
            fileHash,
            filePath,
            accessCount: 0,
            lastAccessed: Date.now(),
            size: estimatedSize,
        };

        this.cache.set(cacheKey, entry);
        this.updateMemoryUsage();
        this.logger.debug(`Cached analysis result for ${filePath} (${estimatedSize} bytes)`);
        
        // Record cache set operation in monitoring
        if (this.monitoringService) {
            this.monitoringService.recordCacheOperation('set', 'analysis', undefined, { 
                filePath,
                size: estimatedSize 
            });
        }
    }

    /**
     * Check if file has changed since last analysis
     */
    hasFileChanged(filePath: string, content: string): boolean {
        const cacheKey = this.generateCacheKey(filePath, content);
        const entry = this.cache.get(cacheKey);

        if (!entry) {
            return true; // No cache entry means it's new or changed
        }

        const currentHash = this.generateFileHash(content);
        return entry.fileHash !== currentHash;
    }

    /**
     * Evict oldest cache entries
     */
    private evictOldestEntries(): void {
        const entries = Array.from(this.cache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

        // Remove oldest 10% of entries
        const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
        for (let i = 0; i < toRemove; i++) {
            this.cache.delete(entries[i][0]);
        }

        this.logger.debug(`Evicted ${toRemove} cache entries`);
        
        // Record eviction operation in monitoring
        if (this.monitoringService) {
            this.monitoringService.recordCacheOperation('evict', 'analysis', undefined, { 
                evictedCount: toRemove,
                reason: 'cache_full' 
            });
        }
    }

    /**
     * Clear expired entries
     */
    clearExpired(): void {
        const now = Date.now();
        let removedCount = 0;

        for (const [key, entry] of this.cache.entries()) {
            if ((now - entry.timestamp) >= this.cacheExpiryMs) {
                this.cache.delete(key);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            this.logger.debug(`Cleared ${removedCount} expired cache entries`);
        }
    }

    /**
     * Update metrics after cache operation
     */
    private updateMetrics(startTime: number): void {
        const accessTime = Date.now() - startTime;
        this.accessTimes.push(accessTime);
        
        // Keep only last 1000 access times for average calculation
        if (this.accessTimes.length > 1000) {
            this.accessTimes = this.accessTimes.slice(-1000);
        }
        
        this.metrics.averageAccessTime = this.accessTimes.reduce((sum, time) => sum + time, 0) / this.accessTimes.length;
        this.metrics.hitRate = this.metrics.totalRequests > 0 ? this.metrics.cacheHits / this.metrics.totalRequests : 0;
        this.metrics.totalEntries = this.cache.size + this.transformationCache.size;
        
        // Update age statistics
        const now = Date.now();
        const allEntries = [...this.cache.values(), ...this.transformationCache.values()];
        if (allEntries.length > 0) {
            const ages = allEntries.map(entry => now - entry.timestamp);
            this.metrics.oldestEntryAge = Math.max(...ages);
            this.metrics.newestEntryAge = Math.min(...ages);
        }
    }

    /**
     * Estimate memory size of cache entry
     */
    private estimateEntrySize(result: ReviewAnalysis, filePath: string, content: string): number {
        // Rough estimation of memory usage
        const resultSize = JSON.stringify(result).length * 2; // UTF-16 characters
        const pathSize = filePath.length * 2;
        const contentHashSize = 64; // SHA-256 hash
        const metadataSize = 100; // Timestamps, counters, etc.
        
        return resultSize + pathSize + contentHashSize + metadataSize;
    }

    /**
     * Update memory usage metrics
     */
    private updateMemoryUsage(): void {
        let totalMemory = 0;
        for (const entry of this.cache.values()) {
            totalMemory += entry.size;
        }
        for (const entry of this.transformationCache.values()) {
            totalMemory += entry.size;
        }
        this.metrics.memoryUsage = totalMemory;
    }

    /**
     * Check memory usage and evict if necessary
     */
    private checkMemoryUsageAndEvict(): void {
        this.updateMemoryUsage();
        
        if (this.metrics.memoryUsage > this.maxMemoryUsage) {
            this.evictByMemoryPressure();
        }
    }

    /**
     * Evict entries based on memory pressure using LRU strategy
     */
    private evictByMemoryPressure(): void {
        const allEntries = [
            ...Array.from(this.cache.entries()).map(([key, entry]) => ({ key, entry, type: 'analysis' as const })),
            ...Array.from(this.transformationCache.entries()).map(([key, entry]) => ({ key, entry, type: 'transformation' as const }))
        ];

        // Sort by last accessed time (LRU)
        allEntries.sort((a, b) => a.entry.lastAccessed - b.entry.lastAccessed);

        let freedMemory = 0;
        const targetMemory = this.maxMemoryUsage * 0.8; // Free up to 80% of max memory

        for (const { key, entry, type } of allEntries) {
            if (this.metrics.memoryUsage - freedMemory <= targetMemory) {
                break;
            }

            if (type === 'analysis') {
                this.cache.delete(key);
            } else {
                this.transformationCache.delete(key);
            }

            freedMemory += entry.size;
            this.metrics.evictionCount++;
        }

        this.updateMemoryUsage();
        this.logger.debug(`Evicted entries to free ${freedMemory} bytes of memory`);
    }

    /**
     * Cache transformation results
     */
    cacheTransformation<T>(sourceData: unknown, transformationType: string, transformedData: T): void {
        const sourceHash = createHash('sha256').update(JSON.stringify(sourceData)).digest('hex');
        const cacheKey = `${transformationType}:${sourceHash}`;

        this.checkMemoryUsageAndEvict();

        const estimatedSize = JSON.stringify(transformedData).length * 2 + 200; // Rough estimate
        const entry: TransformationCacheEntry = {
            transformedData,
            timestamp: Date.now(),
            sourceHash,
            transformationType,
            accessCount: 0,
            lastAccessed: Date.now(),
            size: estimatedSize,
        };

        this.transformationCache.set(cacheKey, entry);
        this.updateMemoryUsage();
        this.logger.debug(`Cached transformation result for ${transformationType} (${estimatedSize} bytes)`);
        
        // Record transformation cache set operation in monitoring
        if (this.monitoringService) {
            this.monitoringService.recordCacheOperation('set', 'transformation', undefined, { 
                transformationType,
                size: estimatedSize 
            });
        }
    }

    /**
     * Get cached transformation result
     */
    getTransformation<T>(sourceData: unknown, transformationType: string): T | null {
        const startTime = Date.now();
        const sourceHash = createHash('sha256').update(JSON.stringify(sourceData)).digest('hex');
        const cacheKey = `${transformationType}:${sourceHash}`;
        const entry = this.transformationCache.get(cacheKey);

        if (!entry) {
            this.metrics.transformationCacheMisses++;
            this.updateMetrics(startTime);
            
            // Record transformation cache miss in monitoring
            if (this.monitoringService) {
                this.monitoringService.recordCacheOperation('miss', 'transformation', Date.now() - startTime, { 
                    transformationType 
                });
            }
            
            return null;
        }

        if ((Date.now() - entry.timestamp) >= this.cacheExpiryMs) {
            this.transformationCache.delete(cacheKey);
            this.metrics.transformationCacheMisses++;
            this.metrics.expiredEntries++;
            this.updateMetrics(startTime);
            
            // Record transformation cache miss due to expiration
            if (this.monitoringService) {
                this.monitoringService.recordCacheOperation('miss', 'transformation', Date.now() - startTime, { 
                    transformationType,
                    reason: 'expired' 
                });
            }
            
            return null;
        }

        entry.accessCount++;
        entry.lastAccessed = Date.now();
        
        this.metrics.transformationCacheHits++;
        this.updateMetrics(startTime);
        
        // Record transformation cache hit in monitoring
        if (this.monitoringService) {
            this.monitoringService.recordCacheOperation('hit', 'transformation', Date.now() - startTime, { 
                transformationType,
                accessCount: entry.accessCount 
            });
        }
        
        return entry.transformedData as T;
    }

    /**
     * Get comprehensive cache metrics
     */
    getMetrics(): CacheMetrics {
        this.updateMemoryUsage();
        return { ...this.metrics };
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        maxSize: number;
        hitRate: number;
        oldestEntry: number | null;
        newestEntry: number | null;
    } {
        const entries = Array.from(this.cache.values());
        const timestamps = entries.map(e => e.timestamp);

        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            hitRate: this.metrics.hitRate,
            oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
            newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
        };
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
        this.logger.debug('Cache cleared');
    }

    /**
     * Get cache size
     */
    size(): number {
        return this.cache.size;
    }
}