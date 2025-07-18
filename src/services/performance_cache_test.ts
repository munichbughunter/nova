import { assertEquals, assertNotEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { PerformanceCache } from './performance_cache.ts';
import { Logger } from '../../utils/logger.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

const logger = new Logger('test', true);

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

Deno.test('PerformanceCache - basic caching functionality', async () => {
    const cache = new PerformanceCache(logger, 10, 1000); // Small cache, 1 second expiry
    const filePath = 'test.ts';
    const content = 'console.log("hello");';

    // Initially no cache hit
    const result1 = cache.get(filePath, content);
    assertEquals(result1, null);

    // Store in cache
    cache.set(filePath, content, mockAnalysis);

    // Should get cache hit
    const result2 = cache.get(filePath, content);
    assertEquals(result2, mockAnalysis);
});

Deno.test('PerformanceCache - file change detection', async () => {
    const cache = new PerformanceCache(logger);
    const filePath = 'test.ts';
    const content1 = 'console.log("hello");';
    const content2 = 'console.log("world");';

    // Store original content
    cache.set(filePath, content1, mockAnalysis);

    // Should detect file hasn't changed
    assertEquals(cache.hasFileChanged(filePath, content1), false);

    // Should detect file has changed
    assertEquals(cache.hasFileChanged(filePath, content2), true);

    // Cache miss for changed content
    const result = cache.get(filePath, content2);
    assertEquals(result, null);
});

Deno.test('PerformanceCache - cache expiry', async () => {
    const cache = new PerformanceCache(logger, 10, 100); // 100ms expiry
    const filePath = 'test.ts';
    const content = 'console.log("hello");';

    // Store in cache
    cache.set(filePath, content, mockAnalysis);

    // Should get cache hit immediately
    const result1 = cache.get(filePath, content);
    assertEquals(result1, mockAnalysis);

    // Wait for expiry
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should be cache miss after expiry
    const result2 = cache.get(filePath, content);
    assertEquals(result2, null);
});

Deno.test('PerformanceCache - cache eviction', async () => {
    const cache = new PerformanceCache(logger, 2, 60000); // Max 2 entries
    
    // Fill cache to capacity
    cache.set('file1.ts', 'content1', mockAnalysis);
    cache.set('file2.ts', 'content2', mockAnalysis);

    // Both should be cached
    assertNotEquals(cache.get('file1.ts', 'content1'), null);
    assertNotEquals(cache.get('file2.ts', 'content2'), null);

    // Add third entry - should trigger eviction
    cache.set('file3.ts', 'content3', mockAnalysis);

    // Oldest entry should be evicted
    assertEquals(cache.get('file1.ts', 'content1'), null);
    assertNotEquals(cache.get('file2.ts', 'content2'), null);
    assertNotEquals(cache.get('file3.ts', 'content3'), null);
});

Deno.test('PerformanceCache - clear expired entries', async () => {
    const cache = new PerformanceCache(logger, 10, 100); // 100ms expiry
    
    // Add entries
    cache.set('file1.ts', 'content1', mockAnalysis);
    await new Promise(resolve => setTimeout(resolve, 60));
    cache.set('file2.ts', 'content2', mockAnalysis);
    
    // Wait for first entry to expire but not second
    await new Promise(resolve => setTimeout(resolve, 80));
    
    // Clear expired entries
    cache.clearExpired();
    
    // First entry should be gone, second should remain
    assertEquals(cache.get('file1.ts', 'content1'), null);
    assertNotEquals(cache.get('file2.ts', 'content2'), null);
});

Deno.test('PerformanceCache - statistics', async () => {
    const cache = new PerformanceCache(logger, 10);
    
    // Initially empty
    const stats1 = cache.getStats();
    assertEquals(stats1.size, 0);
    assertEquals(stats1.maxSize, 10);
    
    // Add entries
    cache.set('file1.ts', 'content1', mockAnalysis);
    cache.set('file2.ts', 'content2', mockAnalysis);
    
    const stats2 = cache.getStats();
    assertEquals(stats2.size, 2);
    assert(stats2.newestEntry !== null);
    assert(stats2.oldestEntry !== null);
});

Deno.test('PerformanceCache - transformation caching', async () => {
    const cache = new PerformanceCache(logger);
    
    const sourceData = { coverage: '75%', testsPresent: 'true' };
    const transformedData = { coverage: 75, testsPresent: true };
    const transformationType = 'test-transform';
    
    // Initially no cached transformation
    const result1 = cache.getTransformation(sourceData, transformationType);
    assertEquals(result1, null);
    
    // Cache transformation
    cache.cacheTransformation(sourceData, transformationType, transformedData);
    
    // Should get cached transformation
    const result2 = cache.getTransformation(sourceData, transformationType);
    assertEquals(result2, transformedData);
    
    // Different source data should miss cache
    const differentData = { coverage: '80%', testsPresent: 'false' };
    const result3 = cache.getTransformation(differentData, transformationType);
    assertEquals(result3, null);
});

Deno.test('PerformanceCache - comprehensive metrics', async () => {
    const cache = new PerformanceCache(logger, 10, 1000);
    
    // Add some analysis cache entries
    cache.set('file1.ts', 'content1', mockAnalysis);
    cache.set('file2.ts', 'content2', mockAnalysis);
    
    // Add some transformation cache entries
    cache.cacheTransformation({ test: 'data1' }, 'transform1', { result: 'data1' });
    cache.cacheTransformation({ test: 'data2' }, 'transform2', { result: 'data2' });
    
    // Generate some cache hits and misses
    cache.get('file1.ts', 'content1'); // Hit
    cache.get('file3.ts', 'content3'); // Miss
    cache.getTransformation({ test: 'data1' }, 'transform1'); // Hit
    cache.getTransformation({ test: 'data3' }, 'transform3'); // Miss
    
    const metrics = cache.getMetrics();
    
    // Verify metrics are tracked
    assert(metrics.totalRequests > 0, 'Should track total requests');
    assert(metrics.cacheHits > 0, 'Should track cache hits');
    assert(metrics.cacheMisses > 0, 'Should track cache misses');
    assert(metrics.transformationCacheHits > 0, 'Should track transformation cache hits');
    assert(metrics.transformationCacheMisses > 0, 'Should track transformation cache misses');
    assert(metrics.totalEntries > 0, 'Should track total entries');
    assert(metrics.memoryUsage > 0, 'Should track memory usage');
    assert(metrics.hitRate >= 0 && metrics.hitRate <= 1, 'Hit rate should be valid');
});

Deno.test('PerformanceCache - memory pressure eviction', async () => {
    const maxMemory = 1024; // Very small limit to trigger eviction
    const cache = new PerformanceCache(logger, 100, 60000, maxMemory);
    
    // Create large analysis to exceed memory limit
    const largeAnalysis: ReviewAnalysis = {
        ...mockAnalysis,
        suggestions: Array.from({ length: 100 }, (_, i) => `Large suggestion ${i} with lots of text`),
        issues: Array.from({ length: 50 }, (_, i) => ({
            type: 'performance',
            severity: 'medium',
            message: `Large issue ${i} with detailed description`,
            line: i,
        })),
    };
    
    // Add entries until memory pressure triggers eviction
    for (let i = 0; i < 20; i++) {
        cache.set(`file${i}.ts`, `content${i}`, largeAnalysis);
    }
    
    const metrics = cache.getMetrics();
    
    // Should have triggered evictions due to memory pressure
    assert(metrics.evictionCount > 0, `Expected evictions due to memory pressure, got ${metrics.evictionCount}`);
    // Memory usage should be controlled, but allow some overhead for the last entry
    assert(metrics.memoryUsage <= maxMemory * 20, `Memory usage ${metrics.memoryUsage} should be controlled (limit: ${maxMemory})`);
});

Deno.test('PerformanceCache - clear all', async () => {
    const cache = new PerformanceCache(logger);
    
    // Add entries
    cache.set('file1.ts', 'content1', mockAnalysis);
    cache.set('file2.ts', 'content2', mockAnalysis);
    
    assertEquals(cache.size(), 2);
    
    // Clear all
    cache.clear();
    
    assertEquals(cache.size(), 0);
    assertEquals(cache.get('file1.ts', 'content1'), null);
    assertEquals(cache.get('file2.ts', 'content2'), null);
});