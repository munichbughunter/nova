import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { PerformanceCache } from './performance_cache.ts';
import { ParallelProcessor, type FileAnalysisTask } from './parallel_processor.ts';
import { Logger } from '../../utils/logger.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

const logger = new Logger('verification-test', false);

// Simple mock analysis
const mockAnalysis: ReviewAnalysis = {
    grade: 'B',
    coverage: 75,
    testsPresent: true,
    value: 'high',
    state: 'pass',
    issues: [],
    suggestions: ['Good work'],
    summary: 'Analysis complete',
};

Deno.test('Performance Verification - Basic cache functionality', async () => {
    const cache = new PerformanceCache(logger, 10);
    
    // Test basic cache operations
    const filePath = 'test.ts';
    const content = 'console.log("test");';
    
    // Initially no cache
    assertEquals(cache.get(filePath, content), null);
    
    // Store in cache
    cache.set(filePath, content, mockAnalysis);
    
    // Should retrieve from cache
    const cached = cache.get(filePath, content);
    assertEquals(cached, mockAnalysis);
    
    // Test transformation caching
    const sourceData = { coverage: '80%' };
    const transformedData = { coverage: 80 };
    
    cache.cacheTransformation(sourceData, 'test-transform', transformedData);
    const cachedTransform = cache.getTransformation(sourceData, 'test-transform');
    assertEquals(cachedTransform, transformedData);
    
    // Test metrics
    const metrics = cache.getMetrics();
    assert(metrics.totalRequests > 0);
    assert(metrics.cacheHits > 0);
    assert(metrics.memoryUsage > 0);
});

Deno.test('Performance Verification - File analysis with cache', async () => {
    const cache = new PerformanceCache(logger, 10);
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    let processingCount = 0;
    const mockProcessor = async (filePath: string, content: string): Promise<ReviewAnalysis> => {
        processingCount++;
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 10));
        return { ...mockAnalysis, summary: `Processed ${filePath}` };
    };
    
    const tasks: FileAnalysisTask[] = [
        {
            id: 'task1',
            filePath: 'file1.ts',
            content: 'content1',
            processor: mockProcessor,
        },
        {
            id: 'task2',
            filePath: 'file1.ts', // Same file
            content: 'content1', // Same content
            processor: mockProcessor,
        },
        {
            id: 'task3',
            filePath: 'file2.ts',
            content: 'content2',
            processor: mockProcessor,
        },
    ];
    
    const results = await processor.processFileAnalysisWithCache(tasks, cache);
    
    // All tasks should complete successfully
    assertEquals(results.length, 3);
    assert(results.every(r => !r.error));
    assert(results.every(r => r.result));
    
    // Should have processed fewer times than tasks due to caching
    // Task2 should hit cache from Task1
    assert(processingCount < tasks.length, `Expected fewer processing calls due to cache, got ${processingCount}`);
    
    // Verify cache metrics
    const metrics = cache.getMetrics();
    assert(metrics.cacheHits > 0, 'Should have cache hits');
    
    // Verify processing stats
    const stats = processor.getFileAnalysisStats(results);
    assertEquals(stats.total, 3);
    assertEquals(stats.successful, 3);
    assertEquals(stats.failed, 0);
    assert(stats.successRate === 1.0);
});

Deno.test('Performance Verification - Memory management', async () => {
    const maxMemory = 2048; // 2KB limit
    const cache = new PerformanceCache(logger, 100, 60000, maxMemory);
    
    // Create large analysis to test memory management
    const largeAnalysis: ReviewAnalysis = {
        ...mockAnalysis,
        suggestions: Array.from({ length: 20 }, (_, i) => `Large suggestion ${i} with lots of text to fill memory`),
        issues: Array.from({ length: 10 }, (_, i) => ({
            type: 'performance',
            severity: 'medium',
            message: `Large issue ${i} with detailed description`,
            line: i,
        })),
    };
    
    // Add many entries to trigger memory management
    for (let i = 0; i < 50; i++) {
        cache.set(`file${i}.ts`, `content${i}`, largeAnalysis);
    }
    
    const metrics = cache.getMetrics();
    
    // Memory should be managed
    assert(metrics.memoryUsage > 0, 'Should track memory usage');
    assert(metrics.totalEntries > 0, 'Should have cache entries');
    
    // If memory limit was exceeded, should have evictions
    if (metrics.memoryUsage > maxMemory) {
        assert(metrics.evictionCount > 0, 'Should have evictions when memory limit exceeded');
    }
});

Deno.test('Performance Verification - Batch processing', async () => {
    const cache = new PerformanceCache(logger, 20);
    const processor = new ParallelProcessor(logger, { maxConcurrency: 3 });
    
    let totalProcessingCalls = 0;
    const mockProcessor = async (filePath: string, content: string): Promise<ReviewAnalysis> => {
        totalProcessingCalls++;
        await new Promise(resolve => setTimeout(resolve, 5));
        return { ...mockAnalysis, summary: `Batch processed ${filePath}` };
    };
    
    // Create tasks with some duplicates
    const tasks: FileAnalysisTask[] = [];
    for (let batch = 0; batch < 3; batch++) {
        for (let i = 0; i < 4; i++) {
            const isDuplicate = i < 2; // First 2 in each batch are duplicates
            const filePath = isDuplicate ? `common${i}.ts` : `batch${batch}_file${i}.ts`;
            
            tasks.push({
                id: `batch${batch}_task${i}`,
                filePath,
                content: `content for ${filePath}`,
                processor: mockProcessor,
            });
        }
    }
    
    const batchMetrics: Array<{ hits: number; misses: number; hitRate: number }> = [];
    
    const results = await processor.processFileAnalysisInBatches(
        tasks,
        cache,
        4, // 4 tasks per batch
        (batchIndex, totalBatches, batchResults, cacheMetrics) => {
            batchMetrics.push(cacheMetrics);
        }
    );
    
    // All tasks should complete
    assertEquals(results.length, 12); // 3 batches * 4 tasks
    assert(results.every(r => !r.error));
    
    // Should have processed fewer times than total tasks due to caching
    assert(totalProcessingCalls < tasks.length, 
        `Expected cache benefits: ${totalProcessingCalls} calls for ${tasks.length} tasks`);
    
    // Should have batch metrics
    assertEquals(batchMetrics.length, 3);
    
    // Later batches should benefit from caching
    const firstBatchHitRate = batchMetrics[0].hitRate;
    const lastBatchHitRate = batchMetrics[batchMetrics.length - 1].hitRate;
    
    // At minimum, cache hit rate should not decrease
    assert(lastBatchHitRate >= firstBatchHitRate, 
        `Cache hit rate should improve or stay same: first=${firstBatchHitRate}%, last=${lastBatchHitRate}%`);
});

Deno.test('Performance Verification - Comprehensive metrics', async () => {
    const cache = new PerformanceCache(logger, 15);
    const processor = new ParallelProcessor(logger, { maxConcurrency: 2 });
    
    // Test various operations to generate comprehensive metrics
    
    // 1. Add some cache entries
    cache.set('metrics1.ts', 'content1', mockAnalysis);
    cache.set('metrics2.ts', 'content2', mockAnalysis);
    
    // 2. Add transformation cache entries
    cache.cacheTransformation({ test: 'data1' }, 'transform1', { result: 'transformed1' });
    cache.cacheTransformation({ test: 'data2' }, 'transform2', { result: 'transformed2' });
    
    // 3. Generate cache hits and misses
    cache.get('metrics1.ts', 'content1'); // Hit
    cache.get('metrics3.ts', 'content3'); // Miss
    cache.getTransformation({ test: 'data1' }, 'transform1'); // Hit
    cache.getTransformation({ test: 'data3' }, 'transform3'); // Miss
    
    // 4. Process some file analysis tasks
    const tasks: FileAnalysisTask[] = [
        {
            id: 'metrics-task1',
            filePath: 'metrics-file1.ts',
            content: 'metrics content 1',
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return mockAnalysis;
            }
        },
        {
            id: 'metrics-task2',
            filePath: 'metrics-file2.ts',
            content: 'metrics content 2',
            processor: async () => {
                await new Promise(resolve => setTimeout(resolve, 8));
                return { ...mockAnalysis, grade: 'A' as const };
            }
        },
    ];
    
    const results = await processor.processFileAnalysisWithCache(tasks, cache);
    
    // Verify comprehensive metrics
    const cacheMetrics = cache.getMetrics();
    const processingStats = processor.getFileAnalysisStats(results);
    
    // Cache metrics should be comprehensive
    assert(cacheMetrics.totalRequests > 0, 'Should track total requests');
    assert(cacheMetrics.cacheHits > 0, 'Should have cache hits');
    assert(cacheMetrics.cacheMisses > 0, 'Should have cache misses');
    assert(cacheMetrics.transformationCacheHits > 0, 'Should have transformation cache hits');
    assert(cacheMetrics.transformationCacheMisses > 0, 'Should have transformation cache misses');
    assert(cacheMetrics.totalEntries > 0, 'Should track total entries');
    assert(cacheMetrics.memoryUsage > 0, 'Should track memory usage');
    assert(cacheMetrics.hitRate >= 0 && cacheMetrics.hitRate <= 1, 'Hit rate should be valid');
    
    // Processing stats should be comprehensive
    assertEquals(processingStats.total, 2);
    assertEquals(processingStats.successful, 2);
    assertEquals(processingStats.failed, 0);
    assertEquals(processingStats.successRate, 1.0);
    assert(processingStats.averageDuration > 0, 'Should calculate average duration');
    assert(processingStats.totalDuration > 0, 'Should calculate total duration');
    
    logger.info('=== Verification Test Metrics ===');
    logger.info(`Cache requests: ${cacheMetrics.totalRequests}`);
    logger.info(`Cache hits: ${cacheMetrics.cacheHits}`);
    logger.info(`Cache hit rate: ${(cacheMetrics.hitRate * 100).toFixed(1)}%`);
    logger.info(`Memory usage: ${cacheMetrics.memoryUsage} bytes`);
    logger.info(`Processing success rate: ${(processingStats.successRate * 100).toFixed(1)}%`);
    logger.info(`Average processing time: ${processingStats.averageDuration.toFixed(1)}ms`);
    logger.info('================================');
});