import type { Logger } from '../utils/logger.ts';
import type { PerformanceCache } from './performance_cache.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

/**
 * Task for parallel processing
 */
export interface ParallelTask<T, R> {
    id: string;
    data: T;
    processor: (data: T) => Promise<R>;
}

/**
 * Enhanced task for file analysis with caching support
 */
export interface FileAnalysisTask {
    id: string;
    filePath: string;
    content: string;
    processor: (filePath: string, content: string) => Promise<ReviewAnalysis>;
}

/**
 * Result of parallel processing
 */
export interface ParallelResult<T, R> {
    id: string;
    data: T;
    result?: R;
    error?: Error;
    duration: number;
}

/**
 * Configuration for parallel processing
 */
export interface ParallelProcessorConfig {
    maxConcurrency: number;
    timeoutMs: number;
    retryAttempts: number;
    retryDelayMs: number;
}

/**
 * Parallel processor for handling multiple tasks concurrently
 */
export class ParallelProcessor {
    private logger: Logger;
    private config: ParallelProcessorConfig;

    constructor(logger: Logger, config: Partial<ParallelProcessorConfig> = {}) {
        this.logger = logger.child('ParallelProcessor');
        this.config = {
            maxConcurrency: config.maxConcurrency ?? 5,
            timeoutMs: config.timeoutMs ?? 30000, // 30 seconds
            retryAttempts: config.retryAttempts ?? 2,
            retryDelayMs: config.retryDelayMs ?? 1000,
        };
    }

    /**
     * Process tasks in parallel with concurrency control
     */
    async processInParallel<T, R>(
        tasks: ParallelTask<T, R>[],
        onProgress?: (completed: number, total: number) => void
    ): Promise<ParallelResult<T, R>[]> {
        if (tasks.length === 0) {
            return [];
        }

        this.logger.info(`Processing ${tasks.length} tasks with max concurrency ${this.config.maxConcurrency}`);

        const results: ParallelResult<T, R>[] = [];
        const semaphore = new Semaphore(this.config.maxConcurrency);
        let completedCount = 0;

        // Create promises for all tasks
        const taskPromises = tasks.map(async (task) => {
            await semaphore.acquire();
            
            try {
                const result = await this.processTaskWithRetry(task);
                results.push(result);
                
                completedCount++;
                if (onProgress) {
                    onProgress(completedCount, tasks.length);
                }
                
                return result;
            } finally {
                semaphore.release();
            }
        });

        // Wait for all tasks to complete
        await Promise.all(taskPromises);

        this.logger.info(`Completed processing ${results.length} tasks`);
        return results;
    }

    /**
     * Process a single task with retry logic
     */
    private async processTaskWithRetry<T, R>(task: ParallelTask<T, R>): Promise<ParallelResult<T, R>> {
        const startTime = Date.now();
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
            try {
                this.logger.debug(`Processing task ${task.id} (attempt ${attempt + 1})`);

                const result = await this.withTimeout(
                    task.processor(task.data),
                    this.config.timeoutMs
                );

                const duration = Date.now() - startTime;
                this.logger.debug(`Task ${task.id} completed in ${duration}ms`);

                return {
                    id: task.id,
                    data: task.data,
                    result,
                    duration,
                };
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger.warn(`Task ${task.id} failed (attempt ${attempt + 1}): ${lastError.message}`);

                // Wait before retry (except on last attempt)
                if (attempt < this.config.retryAttempts) {
                    await this.delay(this.config.retryDelayMs * (attempt + 1)); // Exponential backoff
                }
            }
        }

        const duration = Date.now() - startTime;
        this.logger.error(`Task ${task.id} failed after ${this.config.retryAttempts + 1} attempts`);

        return {
            id: task.id,
            data: task.data,
            error: lastError,
            duration,
        };
    }

    /**
     * Add timeout to a promise
     */
    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]);
    }

    /**
     * Delay execution
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process tasks in batches
     */
    async processInBatches<T, R>(
        tasks: ParallelTask<T, R>[],
        batchSize: number,
        onBatchComplete?: (batchIndex: number, totalBatches: number, results: ParallelResult<T, R>[]) => void
    ): Promise<ParallelResult<T, R>[]> {
        if (tasks.length === 0) {
            return [];
        }

        const batches: ParallelTask<T, R>[][] = [];
        for (let i = 0; i < tasks.length; i += batchSize) {
            batches.push(tasks.slice(i, i + batchSize));
        }

        this.logger.info(`Processing ${tasks.length} tasks in ${batches.length} batches of ${batchSize}`);

        const allResults: ParallelResult<T, R>[] = [];

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            this.logger.debug(`Processing batch ${i + 1}/${batches.length} with ${batch.length} tasks`);

            const batchResults = await this.processInParallel(batch);
            allResults.push(...batchResults);

            if (onBatchComplete) {
                onBatchComplete(i + 1, batches.length, batchResults);
            }

            // Small delay between batches to prevent overwhelming the system
            if (i < batches.length - 1) {
                await this.delay(100);
            }
        }

        return allResults;
    }

    /**
     * Process file analysis tasks with intelligent caching
     */
    async processFileAnalysisWithCache(
        tasks: FileAnalysisTask[],
        cache: PerformanceCache,
        onProgress?: (completed: number, total: number, cacheHits: number) => void
    ): Promise<Array<ParallelResult<FileAnalysisTask, ReviewAnalysis>>> {
        if (tasks.length === 0) {
            return [];
        }

        this.logger.info(`Processing ${tasks.length} file analysis tasks with caching enabled`);

        const results: Array<ParallelResult<FileAnalysisTask, ReviewAnalysis>> = [];
        const semaphore = new Semaphore(this.config.maxConcurrency);
        let completedCount = 0;
        let cacheHits = 0;

        // Create promises for all tasks
        const taskPromises = tasks.map(async (task) => {
            await semaphore.acquire();
            
            try {
                const result = await this.processFileAnalysisTaskWithCache(task, cache);
                results.push(result);
                
                completedCount++;
                // Cache hits are detected by very fast processing times (< 10ms)
                if (result.result && !result.error && result.duration < 10) {
                    cacheHits++;
                }
                
                if (onProgress) {
                    onProgress(completedCount, tasks.length, cacheHits);
                }
                
                return result;
            } finally {
                semaphore.release();
            }
        });

        // Wait for all tasks to complete
        await Promise.all(taskPromises);

        const cacheHitRate = tasks.length > 0 ? (cacheHits / tasks.length) * 100 : 0;
        this.logger.info(`Completed processing ${results.length} file analysis tasks (${cacheHits} cache hits, ${cacheHitRate.toFixed(1)}% hit rate)`);
        
        return results;
    }

    /**
     * Process a single file analysis task with caching
     */
    private async processFileAnalysisTaskWithCache(
        task: FileAnalysisTask,
        cache: PerformanceCache
    ): Promise<ParallelResult<FileAnalysisTask, ReviewAnalysis>> {
        const startTime = Date.now();

        try {
            // Check cache first
            const cachedResult = cache.get(task.filePath, task.content);
            if (cachedResult) {
                const duration = Date.now() - startTime;
                this.logger.debug(`Cache hit for ${task.filePath} (${duration}ms)`);
                
                return {
                    id: task.id,
                    data: task,
                    result: cachedResult,
                    duration,
                };
            }

            // Process with retry logic if not in cache
            let lastError: Error | undefined;

            for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
                try {
                    this.logger.debug(`Processing file analysis ${task.id} (attempt ${attempt + 1})`);

                    const result = await this.withTimeout(
                        task.processor(task.filePath, task.content),
                        this.config.timeoutMs
                    );

                    // Cache the successful result
                    cache.set(task.filePath, task.content, result);

                    const duration = Date.now() - startTime;
                    this.logger.debug(`File analysis ${task.id} completed in ${duration}ms`);

                    return {
                        id: task.id,
                        data: task,
                        result,
                        duration,
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    this.logger.warn(`File analysis ${task.id} failed (attempt ${attempt + 1}): ${lastError.message}`);

                    // Wait before retry (except on last attempt)
                    if (attempt < this.config.retryAttempts) {
                        await this.delay(this.config.retryDelayMs * (attempt + 1));
                    }
                }
            }

            const duration = Date.now() - startTime;
            this.logger.error(`File analysis ${task.id} failed after ${this.config.retryAttempts + 1} attempts`);

            return {
                id: task.id,
                data: task,
                error: lastError,
                duration,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            return {
                id: task.id,
                data: task,
                error: error instanceof Error ? error : new Error(String(error)),
                duration,
            };
        }
    }

    /**
     * Process files in batches with intelligent cache management
     */
    async processFileAnalysisInBatches(
        tasks: FileAnalysisTask[],
        cache: PerformanceCache,
        batchSize: number,
        onBatchComplete?: (batchIndex: number, totalBatches: number, results: Array<ParallelResult<FileAnalysisTask, ReviewAnalysis>>, cacheMetrics: { hits: number; misses: number; hitRate: number }) => void
    ): Promise<Array<ParallelResult<FileAnalysisTask, ReviewAnalysis>>> {
        if (tasks.length === 0) {
            return [];
        }

        const batches: FileAnalysisTask[][] = [];
        for (let i = 0; i < tasks.length; i += batchSize) {
            batches.push(tasks.slice(i, i + batchSize));
        }

        this.logger.info(`Processing ${tasks.length} file analysis tasks in ${batches.length} batches of ${batchSize}`);

        const allResults: Array<ParallelResult<FileAnalysisTask, ReviewAnalysis>> = [];
        let totalCacheHits = 0;

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            this.logger.debug(`Processing batch ${i + 1}/${batches.length} with ${batch.length} files`);

            // Clear expired cache entries before each batch
            cache.clearExpired();

            let batchCacheHits = 0;
            const batchResults = await this.processFileAnalysisWithCache(
                batch,
                cache,
                (completed, total, cacheHits) => {
                    batchCacheHits = cacheHits;
                }
            );

            allResults.push(...batchResults);
            totalCacheHits += batchCacheHits;

            if (onBatchComplete) {
                const cacheMetrics = {
                    hits: batchCacheHits,
                    misses: batch.length - batchCacheHits,
                    hitRate: batch.length > 0 ? (batchCacheHits / batch.length) * 100 : 0
                };
                onBatchComplete(i + 1, batches.length, batchResults, cacheMetrics);
            }

            // Small delay between batches and log memory usage
            if (i < batches.length - 1) {
                const metrics = cache.getMetrics();
                this.logger.debug(`Cache metrics: ${metrics.memoryUsage} bytes used, ${metrics.hitRate * 100}% hit rate`);
                await this.delay(100);
            }
        }

        const overallHitRate = tasks.length > 0 ? (totalCacheHits / tasks.length) * 100 : 0;
        this.logger.info(`Completed batch processing: ${totalCacheHits} cache hits out of ${tasks.length} tasks (${overallHitRate.toFixed(1)}% hit rate)`);

        return allResults;
    }

    /**
     * Get processing statistics
     */
    getStats(results: ParallelResult<any, any>[]): {
        total: number;
        successful: number;
        failed: number;
        averageDuration: number;
        totalDuration: number;
        successRate: number;
    } {
        const successful = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
        const averageDuration = results.length > 0 ? totalDuration / results.length : 0;

        return {
            total: results.length,
            successful,
            failed,
            averageDuration,
            totalDuration,
            successRate: results.length > 0 ? successful / results.length : 0,
        };
    }

    /**
     * Get enhanced statistics for file analysis processing
     */
    getFileAnalysisStats(results: Array<ParallelResult<FileAnalysisTask, ReviewAnalysis>>): {
        total: number;
        successful: number;
        failed: number;
        averageDuration: number;
        totalDuration: number;
        successRate: number;
        estimatedCacheHits: number;
        estimatedCacheHitRate: number;
        fastProcessingCount: number; // Tasks completed in < 100ms (likely cache hits)
    } {
        const successful = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
        const averageDuration = results.length > 0 ? totalDuration / results.length : 0;
        
        // Estimate cache hits based on very fast processing times
        const fastProcessingCount = results.filter(r => !r.error && r.duration < 100).length;
        const estimatedCacheHitRate = results.length > 0 ? (fastProcessingCount / results.length) * 100 : 0;

        return {
            total: results.length,
            successful,
            failed,
            averageDuration,
            totalDuration,
            successRate: results.length > 0 ? successful / results.length : 0,
            estimatedCacheHits: fastProcessingCount,
            estimatedCacheHitRate,
            fastProcessingCount,
        };
    }
}

/**
 * Semaphore for controlling concurrency
 */
class Semaphore {
    private permits: number;
    private waitQueue: (() => void)[] = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }

        return new Promise<void>((resolve) => {
            this.waitQueue.push(resolve);
        });
    }

    release(): void {
        if (this.waitQueue.length > 0) {
            const resolve = this.waitQueue.shift()!;
            resolve();
        } else {
            this.permits++;
        }
    }
}