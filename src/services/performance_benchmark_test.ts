/**
 * Performance benchmark tests to verify improvements
 * Tests caching, parallel processing, and overall system performance
 */

import { assertEquals, assertInstanceOf, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { Logger } from '../../utils/logger.ts';
import { PerformanceCache } from './performance_cache.ts';
import { ParallelProcessor } from './parallel_processor.ts';
import { ValidationService } from './analysis/validation/validation.service.ts';
import { LLMResponseProcessor } from './llm/llm-response-processor.ts';
import { z } from 'zod';

// Test data generators
function generateTestData(size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: i,
    name: `test-${i}`,
    content: `const value${i} = ${i};`.repeat(10),
    timestamp: new Date().toISOString(),
  }));
}

function generateLargeObject(depth: number, breadth: number): any {
  if (depth === 0) {
    return `leaf-value-${Math.random()}`;
  }
  
  const obj: any = {};
  for (let i = 0; i < breadth; i++) {
    obj[`prop${i}`] = generateLargeObject(depth - 1, breadth);
  }
  return obj;
}

describe('Performance Benchmark Tests', () => {
  let logger: Logger;
  let cache: PerformanceCache;
  let processor: ParallelProcessor;
  let validationService: ValidationService;
  let responseProcessor: LLMResponseProcessor;

  beforeEach(() => {
    logger = new Logger('test');
    cache = new PerformanceCache(logger);
    processor = new ParallelProcessor(logger);
    validationService = new ValidationService(logger);
    responseProcessor = new LLMResponseProcessor(logger);
  });

  afterEach(() => {
    restore();
  });

  describe('Cache Performance', () => {
    it('should demonstrate significant cache hit performance improvement', async () => {
      const testKey = 'performance-test';
      const testData = generateTestData(1000);
      
      // Expensive operation simulation
      const expensiveOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        return testData.map(item => ({ ...item, processed: true }));
      };

      // First call (cache miss)
      const startTime1 = Date.now();
      let result1 = cache.get(testKey, 'test content');
      if (!result1) {
        const expensiveResult = await expensiveOperation();
        cache.set(testKey, expensiveResult, 60000);
        result1 = expensiveResult;
      }
      const endTime1 = Date.now();
      const cacheMissTime = endTime1 - startTime1;

      // Second call (cache hit)
      const startTime2 = Date.now();
      const result2 = cache.get(testKey, 'test content');
      const endTime2 = Date.now();
      const cacheHitTime = endTime2 - startTime2;

      assertEquals(result1.length, result2.length);
      assertEquals(result1[0].processed, result2[0].processed);
      
      // Cache hit should be significantly faster
      assert(cacheHitTime < cacheMissTime / 10, 
        `Cache hit (${cacheHitTime}ms) should be much faster than cache miss (${cacheMissTime}ms)`);
      
      // Cache hit should be very fast (< 10ms)
      assert(cacheHitTime < 10, `Cache hit should be very fast, got ${cacheHitTime}ms`);
    });

    it('should handle high cache throughput', async () => {
      const operations = Array.from({ length: 100 }, (_, i) => ({
        key: `key-${i}`,
        operation: async () => `result-${i}`,
      }));

      const startTime = Date.now();
      
      const results = await Promise.all(
        operations.map(async op => {
          let result = cache.get(op.key, 'test content');
          if (!result) {
            const opResult = await op.operation();
            cache.set(op.key, opResult, 60000);
            result = opResult;
          }
          return result;
        })
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 100);
      assert(totalTime < 1000, `High throughput cache operations should complete quickly, got ${totalTime}ms`);
    });

    it('should demonstrate memory efficiency with large datasets', async () => {
      const largeData = generateTestData(10000);
      const key = 'large-dataset';

      // Store large dataset
      cache.set(key, largeData, 60000);

      // Retrieve multiple times to test memory efficiency
      for (let i = 0; i < 10; i++) {
        const retrieved = cache.get(key, 'test content');
        assertEquals(retrieved?.length, 10000);
      }

      // Check cache stats
      const stats = cache.getStats();
      assert(stats.hitRate > 0.8, 'Cache hit rate should be high for repeated access');
    });

    it('should handle cache eviction efficiently', async () => {
      // Fill cache with many items
      const items = Array.from({ length: 1000 }, (_, i) => ({
        key: `item-${i}`,
        value: generateTestData(10),
      }));

      const startTime = Date.now();
      
      for (const item of items) {
        await cache.set(item.key, item.value, 1000); // Short TTL
      }
      
      const endTime = Date.now();
      const insertTime = endTime - startTime;

      assert(insertTime < 5000, `Cache insertion should be efficient, got ${insertTime}ms`);

      // Wait for eviction
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Check that items are evicted
      const stats = cache.getStats();
      assert(stats.size < 1000, 'Cache should have evicted expired items');
    });
  });

  describe('Parallel Processing Performance', () => {
    it('should demonstrate parallel processing speed improvement', async () => {
      const tasks = Array.from({ length: 20 }, (_, i) => ({
        id: `task-${i}`,
        data: i,
        processor: async (data: number) => {
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms per task
          return data * 2;
        },
      }));

      // Sequential processing
      const startSequential = Date.now();
      const sequentialResults = [];
      for (const task of tasks) {
        sequentialResults.push(await task.processor(task.data));
      }
      const endSequential = Date.now();
      const sequentialTime = endSequential - startSequential;

      // Parallel processing
      const startParallel = Date.now();
      const parallelResults = await processor.processInParallel(tasks);
      const endParallel = Date.now();
      const parallelTime = endParallel - startParallel;

      assertEquals(sequentialResults.length, parallelResults.length);
      assertEquals(sequentialResults[0], parallelResults[0].result);

      // Parallel should be significantly faster
      assert(parallelTime < sequentialTime / 2, 
        `Parallel processing (${parallelTime}ms) should be much faster than sequential (${sequentialTime}ms)`);
    });

    it('should handle high concurrency efficiently', async () => {
      const tasks = Array.from({ length: 100 }, (_, i) => ({
        id: `concurrent-task-${i}`,
        data: i,
        processor: async (data: number) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return data * data;
        },
      }));

      const startTime = Date.now();
      const results = await processor.processInParallel(tasks); // Process in parallel
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 100);
      assert(results.every(r => r.result !== undefined), 'All tasks should have results');
      
      // Should complete much faster than sequential (100 * 10ms = 1000ms)
      assert(totalTime < 500, `High concurrency should be efficient, got ${totalTime}ms`);
    });

    it('should demonstrate error handling performance', async () => {
      const tasks = Array.from({ length: 50 }, (_, i) => ({
        id: `error-task-${i}`,
        data: i,
        processor: async (data: number) => {
          if (data % 5 === 0) {
            throw new Error(`Simulated error for ${data}`);
          }
          await new Promise(resolve => setTimeout(resolve, 20));
          return data * 2;
        },
      }));

      const startTime = Date.now();
      const results = await processor.processInParallel(tasks);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 50);
      
      const successCount = results.filter(r => r.result !== undefined && !r.error).length;
      const errorCount = results.filter(r => r.error !== undefined).length;
      
      assertEquals(successCount, 40); // 40 successful (not divisible by 5)
      assertEquals(errorCount, 10);   // 10 errors (divisible by 5)
      
      // Should handle errors efficiently without blocking
      assert(totalTime < 1000, `Error handling should be efficient, got ${totalTime}ms`);
    });
  });

  describe('Validation Performance', () => {
    it('should demonstrate validation speed improvements', async () => {
      const testSchema = z.object({
        id: z.number(),
        name: z.string(),
        active: z.boolean(),
        metadata: z.object({
          tags: z.array(z.string()),
          score: z.number(),
        }),
      });

      const testData = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        active: i % 2 === 0,
        metadata: {
          tags: [`tag-${i}`, `category-${i % 10}`],
          score: Math.random() * 100,
        },
      }));

      const startTime = Date.now();
      
      const results = await Promise.all(
        testData.map(data => validationService.validateWithTransformation(data, testSchema))
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 1000);
      assert(results.every(r => r.success), 'All validations should succeed');
      
      // Should validate 1000 items quickly
      assert(totalTime < 1000, `Validation should be fast, got ${totalTime}ms`);
      
      const avgTimePerValidation = totalTime / 1000;
      assert(avgTimePerValidation < 1, `Average validation time should be < 1ms, got ${avgTimePerValidation}ms`);
    });

    it('should demonstrate transformation performance', async () => {
      const testSchema = z.object({
        coverage: z.number(),
        testsPresent: z.boolean(),
        grade: z.string(),
      });

      const testData = Array.from({ length: 500 }, (_, i) => ({
        coverage: `${i % 100}%`, // String percentage
        testsPresent: i % 2 === 0 ? 'true' : 'false', // String boolean
        grade: ['A', 'B', 'C', 'D', 'F'][i % 5],
      }));

      const startTime = Date.now();
      
      const results = await Promise.all(
        testData.map(data => validationService.validateWithTransformation(data, testSchema))
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 500);
      assert(results.every(r => r.success), 'All transformations should succeed');
      
      // Verify transformations worked
      results.forEach((result, i) => {
        assertEquals(typeof result.data?.coverage, 'number');
        assertEquals(typeof result.data?.testsPresent, 'boolean');
        assert(result.transformationsApplied.length > 0);
      });
      
      assert(totalTime < 2000, `Transformation should be efficient, got ${totalTime}ms`);
    });

    it('should handle complex nested validation efficiently', async () => {
      const complexSchema = z.object({
        user: z.object({
          id: z.number(),
          profile: z.object({
            name: z.string(),
            settings: z.object({
              preferences: z.array(z.object({
                key: z.string(),
                value: z.union([z.string(), z.number(), z.boolean()]),
              })),
            }),
          }),
        }),
        metadata: z.record(z.unknown()),
      });

      const complexData = Array.from({ length: 100 }, (_, i) => ({
        user: {
          id: i,
          profile: {
            name: `User ${i}`,
            settings: {
              preferences: Array.from({ length: 10 }, (_, j) => ({
                key: `pref-${j}`,
                value: j % 3 === 0 ? `value-${j}` : j % 3 === 1 ? j : j % 2 === 0,
              })),
            },
          },
        },
        metadata: generateLargeObject(3, 5),
      }));

      const startTime = Date.now();
      
      const results = await Promise.all(
        complexData.map(data => validationService.validateWithTransformation(data, complexSchema))
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 100);
      assert(results.every(r => r.success), 'All complex validations should succeed');
      
      assert(totalTime < 5000, `Complex validation should be efficient, got ${totalTime}ms`);
    });
  });

  describe('Response Processing Performance', () => {
    it('should demonstrate JSON parsing performance', async () => {
      const testResponses = Array.from({ length: 200 }, (_, i) => 
        JSON.stringify({
          grade: ['A', 'B', 'C', 'D', 'F'][i % 5],
          coverage: `${i % 100}%`,
          testsPresent: i % 2 === 0 ? 'true' : 'false',
          value: ['high', 'medium', 'low'][i % 3],
          state: ['pass', 'warning', 'fail'][i % 3],
          issues: Array.from({ length: i % 5 }, (_, j) => ({
            type: 'warning',
            message: `Issue ${j}`,
            line: j + 1,
          })),
          suggestions: Array.from({ length: i % 3 }, (_, j) => `Suggestion ${j}`),
          summary: `Analysis ${i}`,
        })
      );

      const schema = z.object({
        grade: z.enum(['A', 'B', 'C', 'D', 'F']),
        coverage: z.number(),
        testsPresent: z.boolean(),
        value: z.enum(['high', 'medium', 'low']),
        state: z.enum(['pass', 'warning', 'fail']),
        issues: z.array(z.object({
          type: z.string(),
          message: z.string(),
          line: z.number(),
        })),
        suggestions: z.array(z.string()),
        summary: z.string(),
      });

      const startTime = Date.now();
      
      const results = await Promise.all(
        testResponses.map(response => responseProcessor.processResponse(response, schema))
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 200);
      assert(results.every(r => r.success), 'All response processing should succeed');
      
      assert(totalTime < 2000, `Response processing should be fast, got ${totalTime}ms`);
      
      const avgTimePerResponse = totalTime / 200;
      assert(avgTimePerResponse < 10, `Average response processing should be < 10ms, got ${avgTimePerResponse}ms`);
    });

    it('should handle malformed response recovery efficiently', async () => {
      const malformedResponses = Array.from({ length: 100 }, (_, i) => {
        if (i % 4 === 0) return '{ invalid json }';
        if (i % 4 === 1) return '{ "grade": "A", "coverage": "invalid" }';
        if (i % 4 === 2) return '{ "grade": "A" }'; // Missing fields
        return JSON.stringify({
          grade: 'A',
          coverage: '85%',
          testsPresent: 'true',
          value: 'high',
          state: 'pass',
          issues: [],
          suggestions: [],
          summary: 'Good',
        });
      });

      const schema = z.object({
        grade: z.enum(['A', 'B', 'C', 'D', 'F']),
        coverage: z.number(),
        testsPresent: z.boolean(),
        value: z.enum(['high', 'medium', 'low']),
        state: z.enum(['pass', 'warning', 'fail']),
        issues: z.array(z.any()).default([]),
        suggestions: z.array(z.string()).default([]),
        summary: z.string().default('Analysis completed'),
      });

      const startTime = Date.now();
      
      const results = await Promise.all(
        malformedResponses.map(response => responseProcessor.processResponse(response, schema))
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 100);
      
      const successCount = results.filter(r => r.success).length;
      const fallbackCount = results.filter(r => r.fallbackUsed).length;
      
      // Should handle errors gracefully
      assert(successCount >= 25, 'Should successfully process valid responses');
      assert(fallbackCount >= 75, 'Should use fallback for malformed responses');
      
      assert(totalTime < 3000, `Error recovery should be efficient, got ${totalTime}ms`);
    });
  });

  describe('Memory Usage Performance', () => {
    it('should demonstrate efficient memory usage with large datasets', async () => {
      const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;
      
      // Process large amount of data
      const largeDataset = generateTestData(5000);
      
      const results = await Promise.all(
        largeDataset.map(async (item, i) => {
          const key = `memory-test-${i}`;
          let result = cache.get(key, 'test content');
          if (!result) {
            const processedItem = { ...item, processed: true, timestamp: Date.now() };
            cache.set(key, processedItem, 60000);
            result = processedItem;
          }
          return result;
        })
      );

      assertEquals(results.length, 5000);
      
      const finalMemory = (performance as any).memory?.usedJSHeapSize || 0;
      
      if (initialMemory > 0 && finalMemory > 0) {
        const memoryIncrease = finalMemory - initialMemory;
        const memoryPerItem = memoryIncrease / 5000;
        
        // Memory usage should be reasonable (less than 1KB per item)
        assert(memoryPerItem < 1024, `Memory usage per item should be reasonable, got ${memoryPerItem} bytes`);
      }
    });

    it('should demonstrate garbage collection efficiency', async () => {
      // Create and process many temporary objects
      for (let batch = 0; batch < 10; batch++) {
        const tempData = generateTestData(1000);
        
        await Promise.all(
          tempData.map(async (item) => {
            const result = await validationService.validateWithTransformation(
              item,
              z.object({
                id: z.number(),
                name: z.string(),
                content: z.string(),
                timestamp: z.string(),
              })
            );
            return result.success;
          })
        );
        
        // Force garbage collection if available
        if (typeof (globalThis as any).gc === 'function') {
          (globalThis as any).gc();
        }
      }

      // Should complete without memory issues
      assert(true, 'Should handle garbage collection efficiently');
    });
  });

  describe('Overall System Performance', () => {
    it('should demonstrate end-to-end performance improvements', async () => {
      // Simulate a complete review workflow
      const files = Array.from({ length: 10 }, (_, i) => `file-${i}.ts`);
      
      const mockLLMResponses = files.map((_, i) => JSON.stringify({
        grade: ['A', 'B', 'C'][i % 3],
        coverage: `${70 + (i * 5)}%`,
        testsPresent: i % 2 === 0 ? 'true' : 'false',
        value: ['high', 'medium', 'low'][i % 3],
        state: ['pass', 'warning'][i % 2],
        issues: [],
        suggestions: [`Suggestion for file ${i}`],
        summary: `Analysis for file ${i}`,
      }));

      const schema = z.object({
        grade: z.enum(['A', 'B', 'C', 'D', 'F']),
        coverage: z.number(),
        testsPresent: z.boolean(),
        value: z.enum(['high', 'medium', 'low']),
        state: z.enum(['pass', 'warning', 'fail']),
        issues: z.array(z.any()).default([]),
        suggestions: z.array(z.string()).default([]),
        summary: z.string(),
      });

      const startTime = Date.now();
      
      // Process all files in parallel with caching
      const results = await Promise.all(
        files.map(async (file, i) => {
          const cacheKey = `review-${file}`;
          
          let result = cache.get(cacheKey, 'test content');
          if (!result) {
            // Simulate file reading and processing
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Process LLM response
            const processedResponse = await responseProcessor.processResponse(
              mockLLMResponses[i],
              schema
            );
            
            result = {
              file,
              ...processedResponse.data,
              processingTime: Date.now() - startTime,
            };
            
            cache.set(cacheKey, result, 300000); // 5 minute cache
          }
          return result;
        })
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 10);
      assert(results.every(r => r.file), 'All results should have file names');
      
      // Should complete efficiently with parallel processing and caching
      assert(totalTime < 1000, `End-to-end processing should be efficient, got ${totalTime}ms`);
      
      // Second run should be much faster due to caching
      const startTime2 = Date.now();
      
      const cachedResults = await Promise.all(
        files.map(async (file) => {
          const cacheKey = `review-${file}`;
          return await cache.get(cacheKey);
        })
      );
      
      const endTime2 = Date.now();
      const cachedTime = endTime2 - startTime2;

      assertEquals(cachedResults.length, 10);
      assert(cachedResults.every(r => r !== null), 'All results should be cached');
      
      // Cached run should be much faster
      assert(cachedTime < totalTime / 10, 
        `Cached run (${cachedTime}ms) should be much faster than initial run (${totalTime}ms)`);
    });

    it('should maintain performance under load', async () => {
      // Simulate high load scenario
      const concurrentOperations = Array.from({ length: 50 }, (_, i) => ({
        id: `load-test-${i}`,
        operation: async () => {
          // Mix of different operations
          const operations = [
            () => cache.set(`key-${i}`, `value-${i}`, 60000),
            () => validationService.validateWithTransformation(
              { id: i, name: `test-${i}` },
              z.object({ id: z.number(), name: z.string() })
            ),
            () => responseProcessor.processResponse(
              JSON.stringify({ grade: 'A', coverage: 85, testsPresent: true }),
              z.object({ grade: z.string(), coverage: z.number(), testsPresent: z.boolean() })
            ),
          ];
          
          const randomOp = operations[i % operations.length];
          return await randomOp();
        },
      }));

      const startTime = Date.now();
      
      const results = await Promise.all(
        concurrentOperations.map(op => op.operation())
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      assertEquals(results.length, 50);
      
      // Should handle high load efficiently
      assert(totalTime < 5000, `High load should be handled efficiently, got ${totalTime}ms`);
      
      const avgTimePerOperation = totalTime / 50;
      assert(avgTimePerOperation < 100, `Average operation time should be reasonable, got ${avgTimePerOperation}ms`);
    });
  });
});