import { assertEquals, assert, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { ParallelProcessor, type ParallelTask, type FileAnalysisTask } from './parallel_processor.ts';
import { PerformanceCache } from './performance_cache.ts';
import { Logger } from '../../utils/logger.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

const logger = new Logger('test', true);

Deno.test('ParallelProcessor - basic parallel processing', async () => {
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    const tasks: ParallelTask<number, number>[] = [
        { id: '1', data: 1, processor: async (n) => n * 2 },
        { id: '2', data: 2, processor: async (n) => n * 2 },
        { id: '3', data: 3, processor: async (n) => n * 2 },
    ];
    
    const results = await processor.processInParallel(tasks);
    
    assertEquals(results.length, 3);
    assertEquals(results[0].result, 2);
    assertEquals(results[1].result, 4);
    assertEquals(results[2].result, 6);
    
    // All should be successful
    assert(results.every(r => !r.error));
});

Deno.test('ParallelProcessor - error handling', async () => {
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2, retryAttempts: 1 });
    
    const tasks: ParallelTask<number, number>[] = [
        { id: '1', data: 1, processor: async (n) => n * 2 },
        { id: '2', data: 2, processor: async () => { throw new Error('Test error'); } },
        { id: '3', data: 3, processor: async (n) => n * 2 },
    ];
    
    const results = await processor.processInParallel(tasks);
    
    assertEquals(results.length, 3);
    assertEquals(results[0].result, 2);
    assert(results[1].error instanceof Error);
    assertEquals(results[1].error?.message, 'Test error');
    assertEquals(results[2].result, 6);
});

Deno.test('ParallelProcessor - timeout handling', async () => {
    const processor = new ParallelProcessor(logger, { 
        maxConcurrency: 2, 
        timeoutMs: 100,
        retryAttempts: 0 
    });
    
    const tasks: ParallelTask<number, number>[] = [
        { id: '1', data: 1, processor: async (n) => n * 2 },
        { 
            id: '2', 
            data: 2, 
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 200)); // Longer than timeout
                return 4;
            }
        },
    ];
    
    const results = await processor.processInParallel(tasks);
    
    assertEquals(results.length, 2);
    assertEquals(results[0].result, 2);
    assert(results[1].error instanceof Error);
    assert(results[1].error?.message.includes('timed out'));
});

Deno.test('ParallelProcessor - retry logic', async () => {
    const processor = new ParallelProcessor(logger, { 
        maxConcurrency: 1, 
        retryAttempts: 2,
        retryDelayMs: 10
    });
    
    let attemptCount = 0;
    const tasks: ParallelTask<number, number>[] = [
        { 
            id: '1', 
            data: 1, 
            processor: async (n) => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error('Temporary error');
                }
                return n * 2;
            }
        },
    ];
    
    const results = await processor.processInParallel(tasks);
    
    assertEquals(results.length, 1);
    assertEquals(results[0].result, 2);
    assertEquals(attemptCount, 3); // Initial attempt + 2 retries
});

Deno.test('ParallelProcessor - progress tracking', async () => {
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    const tasks: ParallelTask<number, number>[] = [
        { id: '1', data: 1, processor: async (n) => { await new Promise(r => setTimeout(r, 10)); return n * 2; } },
        { id: '2', data: 2, processor: async (n) => { await new Promise(r => setTimeout(r, 20)); return n * 2; } },
        { id: '3', data: 3, processor: async (n) => { await new Promise(r => setTimeout(r, 15)); return n * 2; } },
    ];
    
    const progressUpdates: Array<{ completed: number; total: number }> = [];
    
    const results = await processor.processInParallel(tasks, (completed, total) => {
        progressUpdates.push({ completed, total });
    });
    
    assertEquals(results.length, 3);
    assert(progressUpdates.length > 0);
    assertEquals(progressUpdates[progressUpdates.length - 1].completed, 3);
    assertEquals(progressUpdates[progressUpdates.length - 1].total, 3);
});

Deno.test('ParallelProcessor - batch processing', async () => {
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    const tasks: ParallelTask<number, number>[] = Array.from({ length: 10 }, (_, i) => ({
        id: `task-${i}`,
        data: i,
        processor: async (n) => n * 2,
    }));
    
    const batchUpdates: Array<{ batchIndex: number; totalBatches: number }> = [];
    
    const results = await processor.processInBatches(
        tasks, 
        3, // Batch size
        (batchIndex, totalBatches) => {
            batchUpdates.push({ batchIndex, totalBatches });
        }
    );
    
    assertEquals(results.length, 10);
    assert(results.every(r => !r.error));
    
    // Should have processed in 4 batches (3+3+3+1)
    assertEquals(batchUpdates.length, 4);
    assertEquals(batchUpdates[0].totalBatches, 4);
});

Deno.test('ParallelProcessor - statistics', async () => {
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    const tasks: ParallelTask<number, number>[] = [
        { id: '1', data: 1, processor: async (n) => n * 2 },
        { id: '2', data: 2, processor: async () => { throw new Error('Test error'); } },
        { id: '3', data: 3, processor: async (n) => n * 2 },
    ];
    
    const results = await processor.processInParallel(tasks);
    const stats = processor.getStats(results);
    
    assertEquals(stats.total, 3);
    assertEquals(stats.successful, 2);
    assertEquals(stats.failed, 1);
    assertEquals(stats.successRate, 2/3);
    assert(stats.averageDuration > 0);
    assert(stats.totalDuration > 0);
});

Deno.test('ParallelProcessor - empty task list', async () => {
    const processor = new ParallelProcessor(logger);
    
    const results = await processor.processInParallel([]);
    
    assertEquals(results.length, 0);
});

Deno.test('ParallelProcessor - concurrency control', async () => {
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    let concurrentCount = 0;
    let maxConcurrent = 0;
    
    const tasks: ParallelTask<number, number>[] = Array.from({ length: 5 }, (_, i) => ({
        id: `task-${i}`,
        data: i,
        processor: async (n) => {
            concurrentCount++;
            maxConcurrent = Math.max(maxConcurrent, concurrentCount);
            
            await new Promise(resolve => setTimeout(resolve, 50));
            
            concurrentCount--;
            return n * 2;
        },
    }));
    
    const results = await processor.processInParallel(tasks);
    
    assertEquals(results.length, 5);
    assert(results.every(r => !r.error));
    
    // Should never exceed max concurrency
    assert(maxConcurrent <= 2);
});

// Mock review analysis for testing
const mockAnalysis: ReviewAnalysis = {
    grade: 'B',
    coverage: 75,
    testsPresent: true,
    value: 'high',
    state: 'pass',
    issues: [],
    suggestions: ['Add more comments'],
    summary: 'Good code quality',
};

Deno.test('ParallelProcessor - file analysis with cache', async () => {
    const cache = new PerformanceCache(logger, 10);
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    const tasks: FileAnalysisTask[] = [
        {
            id: 'task1',
            filePath: 'file1.ts',
            content: 'console.log("hello");',
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                return mockAnalysis;
            }
        },
        {
            id: 'task2',
            filePath: 'file2.ts',
            content: 'console.log("world");',
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                return { ...mockAnalysis, grade: 'A' as const };
            }
        },
        {
            id: 'task3',
            filePath: 'file1.ts', // Same file as task1
            content: 'console.log("hello");', // Same content as task1
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                return mockAnalysis;
            }
        },
    ];
    
    let cacheHitCount = 0;
    const results = await processor.processFileAnalysisWithCache(
        tasks,
        cache,
        (completed, total, cacheHits) => {
            cacheHitCount = cacheHits;
        }
    );
    
    assertEquals(results.length, 3);
    assert(results.every(r => !r.error));
    
    // Should have at least one cache hit (task3 should hit cache from task1)
    assert(cacheHitCount > 0, `Expected cache hits, got ${cacheHitCount}`);
    
    // Task3 should be much faster than task1 (cache hit)
    const task1Duration = results.find(r => r.id === 'task1')?.duration || 0;
    const task3Duration = results.find(r => r.id === 'task3')?.duration || 0;
    
    assert(task3Duration < task1Duration / 2, 
        `Cache hit should be faster: task1=${task1Duration}ms, task3=${task3Duration}ms`);
});

Deno.test('ParallelProcessor - file analysis batch processing', async () => {
    const cache = new PerformanceCache(logger, 20);
    const processor = new ParallelProcessor(logger, { maxConcurrency: 3 });
    
    // Create tasks with some duplicates across batches
    const tasks: FileAnalysisTask[] = [];
    for (let batch = 0; batch < 3; batch++) {
        for (let i = 0; i < 4; i++) {
            const isDuplicate = i < 2; // First 2 files in each batch are duplicates
            const filePath = isDuplicate ? `common-file-${i}.ts` : `batch-${batch}-file-${i}.ts`;
            
            tasks.push({
                id: `batch${batch}-task${i}`,
                filePath,
                content: `console.log("batch ${batch} file ${i}");`,
                processor: async () => {
                    await new Promise(resolve => setTimeout(resolve, 30));
                    const grade = i % 2 === 0 ? 'A' : 'B';
                    return { ...mockAnalysis, grade: grade as 'A' | 'B' };
                }
            });
        }
    }
    
    const batchMetrics: Array<{ hits: number; misses: number; hitRate: number }> = [];
    
    const results = await processor.processFileAnalysisInBatches(
        tasks,
        cache,
        4, // 4 files per batch
        (batchIndex, totalBatches, batchResults, cacheMetrics) => {
            batchMetrics.push(cacheMetrics);
        }
    );
    
    assertEquals(results.length, 12); // 3 batches * 4 files
    assert(results.every(r => !r.error));
    
    // Later batches should have higher cache hit rates
    const firstBatchHitRate = batchMetrics[0].hitRate;
    const lastBatchHitRate = batchMetrics[batchMetrics.length - 1].hitRate;
    
    assert(lastBatchHitRate >= firstBatchHitRate,
        `Cache hit rate should improve: first=${firstBatchHitRate}%, last=${lastBatchHitRate}%`);
});

Deno.test('ParallelProcessor - file analysis statistics', async () => {
    const cache = new PerformanceCache(logger, 10);
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    const tasks: FileAnalysisTask[] = [
        {
            id: 'fast-task',
            filePath: 'fast.ts',
            content: 'fast content',
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 20)); // Fast
                return mockAnalysis;
            }
        },
        {
            id: 'slow-task',
            filePath: 'slow.ts',
            content: 'slow content',
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 200)); // Slow
                return { ...mockAnalysis, grade: 'C' as const };
            }
        },
        {
            id: 'error-task',
            filePath: 'error.ts',
            content: 'error content',
            processor: async () => {
                throw new Error('Processing failed');
            }
        },
        {
            id: 'fast-duplicate',
            filePath: 'fast.ts', // Same as first task
            content: 'fast content', // Same content
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 20));
                return mockAnalysis;
            }
        },
    ];
    
    const results = await processor.processFileAnalysisWithCache(tasks, cache);
    const stats = processor.getFileAnalysisStats(results);
    
    assertEquals(stats.total, 4);
    assertEquals(stats.successful, 3); // 3 successful, 1 error
    assertEquals(stats.failed, 1);
    assert(stats.successRate > 0.7);
    assert(stats.averageDuration > 0);
    
    // Should detect fast processing (likely cache hits)
    assert(stats.fastProcessingCount > 0, `Expected fast processing tasks, got ${stats.fastProcessingCount}`);
    assert(stats.estimatedCacheHits > 0, `Expected estimated cache hits, got ${stats.estimatedCacheHits}`);
    assert(stats.estimatedCacheHitRate > 0, `Expected cache hit rate > 0%, got ${stats.estimatedCacheHitRate}%`);
});