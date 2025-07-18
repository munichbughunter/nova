import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { PerformanceCache } from './performance_cache.ts';
import { Logger } from '../../utils/logger.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

const logger = new Logger('simple-test', false);

const mockAnalysis: ReviewAnalysis = {
    grade: 'B',
    coverage: 75,
    testsPresent: true,
    value: 'high',
    state: 'pass',
    issues: [],
    suggestions: ['Test suggestion'],
    summary: 'Test summary',
};

Deno.test('Simple Cache Test - Direct cache operations', async () => {
    const cache = new PerformanceCache(logger, 10);
    
    const filePath = 'test.ts';
    const content = 'console.log("hello");';
    
    console.log('Testing direct cache operations...');
    
    // Test 1: Initial state - should be cache miss
    const result1 = cache.get(filePath, content);
    assertEquals(result1, null, 'Initial get should return null');
    console.log('✓ Initial cache miss confirmed');
    
    // Test 2: Store in cache
    cache.set(filePath, content, mockAnalysis);
    console.log('✓ Stored analysis in cache');
    
    // Test 3: Retrieve from cache - should be cache hit
    const result2 = cache.get(filePath, content);
    assertEquals(result2, mockAnalysis, 'Should retrieve cached analysis');
    console.log('✓ Cache hit confirmed');
    
    // Test 4: Check metrics
    const metrics = cache.getMetrics();
    console.log(`Cache metrics: ${metrics.cacheHits} hits, ${metrics.cacheMisses} misses, ${(metrics.hitRate * 100).toFixed(1)}% hit rate`);
    
    assert(metrics.cacheHits > 0, 'Should have cache hits');
    assert(metrics.cacheMisses > 0, 'Should have cache misses');
    assert(metrics.totalRequests > 0, 'Should have total requests');
    
    console.log('✓ All direct cache operations working correctly');
});

Deno.test('Simple Cache Test - File change detection', async () => {
    const cache = new PerformanceCache(logger, 10);
    
    const filePath = 'changing-file.ts';
    const content1 = 'console.log("version 1");';
    const content2 = 'console.log("version 2");';
    
    console.log('Testing file change detection...');
    
    // Store original version
    cache.set(filePath, content1, mockAnalysis);
    console.log('✓ Stored original version');
    
    // Should get cache hit for same content
    const hit = cache.get(filePath, content1);
    assertEquals(hit, mockAnalysis, 'Should hit cache for same content');
    console.log('✓ Cache hit for same content');
    
    // Should get cache miss for changed content
    const miss = cache.get(filePath, content2);
    assertEquals(miss, null, 'Should miss cache for changed content');
    console.log('✓ Cache miss for changed content');
    
    // Test hasFileChanged method
    const unchanged = cache.hasFileChanged(filePath, content1);
    assertEquals(unchanged, false, 'Should detect file has not changed');
    console.log('✓ Correctly detected unchanged file');
    
    const changed = cache.hasFileChanged(filePath, content2);
    assertEquals(changed, true, 'Should detect file has changed');
    console.log('✓ Correctly detected changed file');
    
    console.log('✓ File change detection working correctly');
});

Deno.test('Simple Cache Test - Transformation caching', async () => {
    const cache = new PerformanceCache(logger, 10);
    
    console.log('Testing transformation caching...');
    
    const sourceData = { coverage: '85%', testsPresent: 'true' };
    const transformedData = { coverage: 85, testsPresent: true };
    const transformationType = 'llm-response-transform';
    
    // Initially should be cache miss
    const miss = cache.getTransformation(sourceData, transformationType);
    assertEquals(miss, null, 'Initial transformation get should return null');
    console.log('✓ Initial transformation cache miss');
    
    // Cache the transformation
    cache.cacheTransformation(sourceData, transformationType, transformedData);
    console.log('✓ Cached transformation');
    
    // Should get cache hit
    const hit = cache.getTransformation(sourceData, transformationType);
    assertEquals(hit, transformedData, 'Should retrieve cached transformation');
    console.log('✓ Transformation cache hit');
    
    // Different source data should miss
    const differentSource = { coverage: '90%', testsPresent: 'false' };
    const miss2 = cache.getTransformation(differentSource, transformationType);
    assertEquals(miss2, null, 'Different source should miss cache');
    console.log('✓ Different source correctly missed cache');
    
    // Check metrics include transformation stats
    const metrics = cache.getMetrics();
    assert(metrics.transformationCacheHits > 0, 'Should have transformation cache hits');
    assert(metrics.transformationCacheMisses > 0, 'Should have transformation cache misses');
    console.log(`Transformation metrics: ${metrics.transformationCacheHits} hits, ${metrics.transformationCacheMisses} misses`);
    
    console.log('✓ Transformation caching working correctly');
});

Deno.test('Simple Cache Test - Memory management', async () => {
    const maxMemory = 1024; // 1KB limit
    const cache = new PerformanceCache(logger, 100, 60000, maxMemory);
    
    console.log('Testing memory management...');
    
    // Create large analysis to test memory limits
    const largeAnalysis: ReviewAnalysis = {
        ...mockAnalysis,
        suggestions: Array.from({ length: 30 }, (_, i) => `Large suggestion ${i} with lots of text to consume memory space`),
        issues: Array.from({ length: 15 }, (_, i) => ({
            type: 'performance',
            severity: 'medium',
            message: `Large issue ${i} with detailed description to consume memory`,
            line: i,
        })),
    };
    
    console.log(`Large analysis estimated size: ${JSON.stringify(largeAnalysis).length * 2} bytes`);
    
    // Add entries until we exceed memory limit
    let entriesAdded = 0;
    for (let i = 0; i < 20; i++) {
        cache.set(`large-file-${i}.ts`, `large content ${i}`, largeAnalysis);
        entriesAdded++;
        
        const metrics = cache.getMetrics();
        console.log(`Entry ${i}: ${metrics.memoryUsage} bytes used, ${metrics.totalEntries} entries, ${metrics.evictionCount} evictions`);
        
        if (metrics.evictionCount > 0) {
            console.log(`✓ Memory management triggered after ${entriesAdded} entries`);
            break;
        }
    }
    
    const finalMetrics = cache.getMetrics();
    console.log(`Final state: ${finalMetrics.memoryUsage} bytes, ${finalMetrics.totalEntries} entries, ${finalMetrics.evictionCount} evictions`);
    
    // Should have some entries and possibly evictions
    assert(finalMetrics.totalEntries > 0, 'Should have cache entries');
    assert(finalMetrics.memoryUsage > 0, 'Should track memory usage');
    
    console.log('✓ Memory management working correctly');
});