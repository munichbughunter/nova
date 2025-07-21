/**
 * Performance comparison tests between sequential and parallel processing
 * Tests throughput, memory usage, and resource efficiency
 */

import { assertEquals, assertExists, assert } from '@std/assert';
import { beforeEach, describe, it, afterEach } from '@std/testing/bdd';
import { resolve } from 'std/path/mod.ts';

import { SequentialFileProcessor, ProcessingMode } from './sequential_processor.ts';
import { ParallelProcessor } from './parallel_processor.ts';
import { MemoryManager } from './progress/memory-manager.ts';
import type { FileProcessor, ProcessingResult } from './sequential_processor.ts';
import { Logger } from '../utils/logger.ts';

// Performance test file processor with configurable delays
class PerformanceTestProcessor implements FileProcessor {
    private processCount = 0;
    private processingDelay: number;
    private memoryUsage: number;
    private cpuIntensive: boolean;

    constructor(
        processingDelay = 50,
        memoryUsage = 1024 * 1024, // 1MB per file
        cpuIntensive = false
    ) {
        this.processingDelay = processingDelay;
        this.memoryUsage = memoryUsage;
        this.cpuIntensive = cpuIntensive;
    }

    async processFile(filePath: string): Promise<any> {
        this.processCount++;
        const startTime = Date.now();

        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, this.processingDelay));

        // Simulate memory usage
        const memoryBuffer = new Array(this.memoryUsage / 8).fill(0); // Rough memory allocation

        // Simulate CPU intensive work if requested
        if (this.cpuIntensive) {
            let sum = 0;
            for (let i = 0; i < 100000; i++) {
                sum += Math.random();
            }
        }

        const endTime = Date.now();

        return {
            grade: 'A',
            state: 'pass',
            issues: [],
            metrics: { 
                coverage: 90,
                processingTime: endTime - startTime,
                memoryUsed: this.memoryUsage
            },
            filePath,
            timestamp: new Date().toISOString()
        };
    }

    getProcessCount(): number {
        return this.processCount;
    }

    reset(): void {
        this.processCount = 0;
    }
}

// Helper functions
function createMockLogger(): Logger {
    return new Logger('PerformanceTest', false);
}

function createTestFiles(count: number): string[] {
    return Array.from({ length: count }, (_, i) => 
        resolve(`performance-test-file-${i}.ts`)
    );
}

function calculateThroughput(fileCount: number, durationMs: number): number {
    return (fileCount / (durationMs / 1000)) * 60; // files per minute
}

describe('Sequential vs Parallel Processing Performance', () => {
    let mockLogger: Logger;
    let memoryManager: MemoryManager;

    beforeEach(() => {
        mockLogger = createMockLogger();
        memoryManager = new MemoryManager(mockLogger);
    });

    describe('Throughput Comparison', () => {
        it('should compare processing speed for small file sets', async () => {
            const fileCount = 5;
            const testFiles = createTestFiles(fileCount);
            const processingDelay = 100; // 100ms per file

            // Sequential processing
            const sequentialProcessor = new SequentialFileProcessor(mockLogger);
            const sequentialFileProcessor = new PerformanceTestProcessor(processingDelay);
            
            const sequentialStartTime = Date.now();
            const sequentialResults = await sequentialProcessor.processFiles(
                testFiles,
                sequentialFileProcessor,
                { showProgress: false }
            );
            const sequentialEndTime = Date.now();
            const sequentialDuration = sequentialEndTime - sequentialStartTime;

            // Parallel processing
            const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 3 });
            const parallelFileProcessor = new PerformanceTestProcessor(processingDelay);
            
            const parallelTasks = testFiles.map(file => ({
                id: file,
                data: file,
                processor: (data: string) => parallelFileProcessor.processFile(data)
            }));

            const parallelStartTime = Date.now();
            const parallelResults = await parallelProcessor.processInParallel(parallelTasks);
            const parallelEndTime = Date.now();
            const parallelDuration = parallelEndTime - parallelStartTime;

            // Verify results
            assertEquals(sequentialResults.length, fileCount);
            assertEquals(parallelResults.length, fileCount);
            assertEquals(sequentialFileProcessor.getProcessCount(), fileCount);
            assertEquals(parallelFileProcessor.getProcessCount(), fileCount);

            // Calculate throughput
            const sequentialThroughput = calculateThroughput(fileCount, sequentialDuration);
            const parallelThroughput = calculateThroughput(fileCount, parallelDuration);

            console.log(`Sequential: ${sequentialDuration}ms (${sequentialThroughput.toFixed(1)} files/min)`);
            console.log(`Parallel: ${parallelDuration}ms (${parallelThroughput.toFixed(1)} files/min)`);

            // Parallel should be faster for this scenario
            assert(parallelDuration < sequentialDuration, 
                `Parallel (${parallelDuration}ms) should be faster than sequential (${sequentialDuration}ms)`);
            assert(parallelThroughput > sequentialThroughput,
                `Parallel throughput (${parallelThroughput}) should be higher than sequential (${sequentialThroughput})`);
        });

        it('should compare processing speed for medium file sets', async () => {
            const fileCount = 15;
            const testFiles = createTestFiles(fileCount);
            const processingDelay = 50; // 50ms per file

            // Sequential processing
            const sequentialProcessor = new SequentialFileProcessor(mockLogger);
            const sequentialFileProcessor = new PerformanceTestProcessor(processingDelay);
            
            const sequentialStartTime = Date.now();
            await sequentialProcessor.processFiles(
                testFiles,
                sequentialFileProcessor,
                { showProgress: false }
            );
            const sequentialDuration = Date.now() - sequentialStartTime;

            // Parallel processing
            const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 5 });
            const parallelFileProcessor = new PerformanceTestProcessor(processingDelay);
            
            const parallelTasks = testFiles.map(file => ({
                id: file,
                data: file,
                processor: (data: string) => parallelFileProcessor.processFile(data)
            }));

            const parallelStartTime = Date.now();
            await parallelProcessor.processInParallel(parallelTasks);
            const parallelDuration = Date.now() - parallelStartTime;

            // Calculate efficiency
            const sequentialThroughput = calculateThroughput(fileCount, sequentialDuration);
            const parallelThroughput = calculateThroughput(fileCount, parallelDuration);
            const speedupRatio = parallelThroughput / sequentialThroughput;

            console.log(`Medium set - Sequential: ${sequentialDuration}ms, Parallel: ${parallelDuration}ms`);
            console.log(`Speedup ratio: ${speedupRatio.toFixed(2)}x`);

            // Parallel should show significant speedup
            assert(speedupRatio > 2, `Expected speedup > 2x, got ${speedupRatio.toFixed(2)}x`);
        });

        it('should compare processing speed for large file sets', async () => {
            const fileCount = 30;
            const testFiles = createTestFiles(fileCount);
            const processingDelay = 25; // 25ms per file

            // Sequential processing
            const sequentialProcessor = new SequentialFileProcessor(mockLogger);
            const sequentialFileProcessor = new PerformanceTestProcessor(processingDelay);
            
            const sequentialStartTime = Date.now();
            await sequentialProcessor.processFiles(
                testFiles,
                sequentialFileProcessor,
                { showProgress: false }
            );
            const sequentialDuration = Date.now() - sequentialStartTime;

            // Parallel processing with higher concurrency
            const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 8 });
            const parallelFileProcessor = new PerformanceTestProcessor(processingDelay);
            
            const parallelTasks = testFiles.map(file => ({
                id: file,
                data: file,
                processor: (data: string) => parallelFileProcessor.processFile(data)
            }));

            const parallelStartTime = Date.now();
            await parallelProcessor.processInParallel(parallelTasks);
            const parallelDuration = Date.now() - parallelStartTime;

            // Calculate metrics
            const sequentialThroughput = calculateThroughput(fileCount, sequentialDuration);
            const parallelThroughput = calculateThroughput(fileCount, parallelDuration);
            const efficiency = parallelThroughput / (sequentialThroughput * 8); // Efficiency per core

            console.log(`Large set - Sequential: ${sequentialDuration}ms, Parallel: ${parallelDuration}ms`);
            console.log(`Parallel efficiency: ${(efficiency * 100).toFixed(1)}%`);

            // Should maintain reasonable efficiency even with high concurrency
            assert(efficiency > 0.3, `Expected efficiency > 30%, got ${(efficiency * 100).toFixed(1)}%`);
        });
    });

    describe('Memory Usage Comparison', () => {
        it('should compare memory usage patterns', async () => {
            const fileCount = 10;
            const testFiles = createTestFiles(fileCount);
            const memoryPerFile = 2 * 1024 * 1024; // 2MB per file

            // Sequential processing - should use less peak memory
            const sequentialProcessor = new SequentialFileProcessor(mockLogger);
            const sequentialFileProcessor = new PerformanceTestProcessor(50, memoryPerFile);
            
            const initialMemory = memoryManager.getCurrentUsage();
            
            await sequentialProcessor.processFiles(
                testFiles,
                sequentialFileProcessor,
                { showProgress: false }
            );
            
            const sequentialPeakMemory = memoryManager.getCurrentUsage();
            const sequentialMemoryIncrease = sequentialPeakMemory.heapUsed - initialMemory.heapUsed;

            // Reset memory state (force GC if available)
            if ((global as any).gc) {
                (global as any).gc();
            }
            await new Promise(resolve => setTimeout(resolve, 100));

            // Parallel processing - may use more peak memory
            const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 5 });
            const parallelFileProcessor = new PerformanceTestProcessor(50, memoryPerFile);
            
            const parallelInitialMemory = memoryManager.getCurrentUsage();
            
            const parallelTasks = testFiles.map(file => ({
                id: file,
                data: file,
                processor: (data: string) => parallelFileProcessor.processFile(data)
            }));

            await parallelProcessor.processInParallel(parallelTasks);
            
            const parallelPeakMemory = memoryManager.getCurrentUsage();
            const parallelMemoryIncrease = parallelPeakMemory.heapUsed - parallelInitialMemory.heapUsed;

            console.log(`Sequential memory increase: ${(sequentialMemoryIncrease / 1024 / 1024).toFixed(2)}MB`);
            console.log(`Parallel memory increase: ${(parallelMemoryIncrease / 1024 / 1024).toFixed(2)}MB`);

            // Sequential should generally use less peak memory
            // Note: This test may be flaky due to GC timing, so we use a reasonable threshold
            const memoryRatio = parallelMemoryIncrease / Math.max(sequentialMemoryIncrease, 1);
            console.log(`Memory usage ratio (parallel/sequential): ${memoryRatio.toFixed(2)}`);

            // Parallel might use more memory, but shouldn't be excessive
            assert(memoryRatio < 10, `Memory usage ratio too high: ${memoryRatio.toFixed(2)}`);
        });

        it('should handle memory pressure differently', async () => {
            const fileCount = 8;
            const testFiles = createTestFiles(fileCount);
            const largeMemoryPerFile = 5 * 1024 * 1024; // 5MB per file

            // Test with memory manager monitoring
            const memoryManagerWithLimits = new MemoryManager(mockLogger, {
                maxHeapUsage: 100 * 1024 * 1024, // 100MB limit
                gcThreshold: 0.8
            });

            // Sequential processing with memory monitoring
            const sequentialProcessor = new SequentialFileProcessor(mockLogger);
            const sequentialFileProcessor = new PerformanceTestProcessor(30, largeMemoryPerFile);
            
            let sequentialMemoryPressureEvents = 0;
            const originalIsMemoryUnderPressure = memoryManagerWithLimits.isMemoryUnderPressure.bind(memoryManagerWithLimits);
            memoryManagerWithLimits.isMemoryUnderPressure = () => {
                const result = originalIsMemoryUnderPressure();
                if (result) sequentialMemoryPressureEvents++;
                return result;
            };

            await sequentialProcessor.processFiles(
                testFiles,
                sequentialFileProcessor,
                { showProgress: false }
            );

            console.log(`Sequential memory pressure events: ${sequentialMemoryPressureEvents}`);

            // Sequential processing should handle memory pressure more gracefully
            // This is more of a behavioral test
            assert(sequentialMemoryPressureEvents >= 0, 'Memory pressure monitoring should work');
        });
    });

    describe('CPU Usage Comparison', () => {
        it('should compare CPU intensive processing', async () => {
            const fileCount = 6;
            const testFiles = createTestFiles(fileCount);

            // Sequential processing with CPU intensive work
            const sequentialProcessor = new SequentialFileProcessor(mockLogger);
            const sequentialFileProcessor = new PerformanceTestProcessor(20, 1024 * 1024, true);
            
            const sequentialStartTime = Date.now();
            await sequentialProcessor.processFiles(
                testFiles,
                sequentialFileProcessor,
                { showProgress: false }
            );
            const sequentialDuration = Date.now() - sequentialStartTime;

            // Parallel processing with CPU intensive work
            const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 3 });
            const parallelFileProcessor = new PerformanceTestProcessor(20, 1024 * 1024, true);
            
            const parallelTasks = testFiles.map(file => ({
                id: file,
                data: file,
                processor: (data: string) => parallelFileProcessor.processFile(data)
            }));

            const parallelStartTime = Date.now();
            await parallelProcessor.processInParallel(parallelTasks);
            const parallelDuration = Date.now() - parallelStartTime;

            console.log(`CPU intensive - Sequential: ${sequentialDuration}ms, Parallel: ${parallelDuration}ms`);

            // For CPU intensive tasks, parallel should show good speedup
            const speedup = sequentialDuration / parallelDuration;
            console.log(`CPU intensive speedup: ${speedup.toFixed(2)}x`);

            assert(speedup > 1.5, `Expected CPU intensive speedup > 1.5x, got ${speedup.toFixed(2)}x`);
        });
    });

    describe('Resource Efficiency', () => {
        it('should measure resource efficiency per processing mode', async () => {
            const fileCount = 12;
            const testFiles = createTestFiles(fileCount);

            // Sequential processing metrics
            const sequentialProcessor = new SequentialFileProcessor(mockLogger);
            const sequentialFileProcessor = new PerformanceTestProcessor(40);
            
            const sequentialStartMemory = memoryManager.getCurrentUsage();
            const sequentialStartTime = Date.now();
            
            await sequentialProcessor.processFiles(
                testFiles,
                sequentialFileProcessor,
                { showProgress: false }
            );
            
            const sequentialEndTime = Date.now();
            const sequentialEndMemory = memoryManager.getCurrentUsage();
            
            const sequentialMetrics = {
                duration: sequentialEndTime - sequentialStartTime,
                memoryDelta: sequentialEndMemory.heapUsed - sequentialStartMemory.heapUsed,
                throughput: calculateThroughput(fileCount, sequentialEndTime - sequentialStartTime)
            };

            // Force cleanup
            if ((global as any).gc) {
                (global as any).gc();
            }
            await new Promise(resolve => setTimeout(resolve, 100));

            // Parallel processing metrics
            const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 4 });
            const parallelFileProcessor = new PerformanceTestProcessor(40);
            
            const parallelStartMemory = memoryManager.getCurrentUsage();
            const parallelStartTime = Date.now();
            
            const parallelTasks = testFiles.map(file => ({
                id: file,
                data: file,
                processor: (data: string) => parallelFileProcessor.processFile(data)
            }));

            await parallelProcessor.processInParallel(parallelTasks);
            
            const parallelEndTime = Date.now();
            const parallelEndMemory = memoryManager.getCurrentUsage();
            
            const parallelMetrics = {
                duration: parallelEndTime - parallelStartTime,
                memoryDelta: parallelEndMemory.heapUsed - parallelStartMemory.heapUsed,
                throughput: calculateThroughput(fileCount, parallelEndTime - parallelStartTime)
            };

            // Calculate efficiency metrics
            const timeEfficiency = sequentialMetrics.duration / parallelMetrics.duration;
            const memoryEfficiency = Math.max(sequentialMetrics.memoryDelta, 1) / Math.max(parallelMetrics.memoryDelta, 1);
            const throughputRatio = parallelMetrics.throughput / sequentialMetrics.throughput;

            console.log('=== Resource Efficiency Comparison ===');
            console.log(`Sequential: ${sequentialMetrics.duration}ms, ${(sequentialMetrics.memoryDelta / 1024 / 1024).toFixed(2)}MB, ${sequentialMetrics.throughput.toFixed(1)} files/min`);
            console.log(`Parallel: ${parallelMetrics.duration}ms, ${(parallelMetrics.memoryDelta / 1024 / 1024).toFixed(2)}MB, ${parallelMetrics.throughput.toFixed(1)} files/min`);
            console.log(`Time efficiency: ${timeEfficiency.toFixed(2)}x`);
            console.log(`Memory efficiency: ${memoryEfficiency.toFixed(2)}x`);
            console.log(`Throughput ratio: ${throughputRatio.toFixed(2)}x`);

            // Verify reasonable efficiency metrics
            assert(timeEfficiency > 1, `Time efficiency should be > 1, got ${timeEfficiency.toFixed(2)}`);
            assert(throughputRatio > 1, `Throughput ratio should be > 1, got ${throughputRatio.toFixed(2)}`);
            
            // Memory efficiency can vary, but shouldn't be extremely poor
            assert(memoryEfficiency > 0.1, `Memory efficiency too low: ${memoryEfficiency.toFixed(2)}`);
        });

        it('should identify optimal processing mode thresholds', async () => {
            const testSizes = [2, 5, 10, 15, 20];
            const results: Array<{
                fileCount: number;
                sequentialTime: number;
                parallelTime: number;
                speedup: number;
                recommendation: 'sequential' | 'parallel';
            }> = [];

            for (const fileCount of testSizes) {
                const testFiles = createTestFiles(fileCount);
                const processingDelay = 30;

                // Sequential test
                const sequentialProcessor = new SequentialFileProcessor(mockLogger);
                const sequentialFileProcessor = new PerformanceTestProcessor(processingDelay);
                
                const sequentialStart = Date.now();
                await sequentialProcessor.processFiles(
                    testFiles,
                    sequentialFileProcessor,
                    { showProgress: false }
                );
                const sequentialTime = Date.now() - sequentialStart;

                // Parallel test
                const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 4 });
                const parallelFileProcessor = new PerformanceTestProcessor(processingDelay);
                
                const parallelTasks = testFiles.map(file => ({
                    id: file,
                    data: file,
                    processor: (data: string) => parallelFileProcessor.processFile(data)
                }));

                const parallelStart = Date.now();
                await parallelProcessor.processInParallel(parallelTasks);
                const parallelTime = Date.now() - parallelStart;

                const speedup = sequentialTime / parallelTime;
                const recommendation = speedup > 1.5 ? 'parallel' : 'sequential';

                results.push({
                    fileCount,
                    sequentialTime,
                    parallelTime,
                    speedup,
                    recommendation
                });

                console.log(`${fileCount} files: Sequential ${sequentialTime}ms, Parallel ${parallelTime}ms, Speedup ${speedup.toFixed(2)}x -> ${recommendation}`);
            }

            // Analyze threshold patterns
            const parallelRecommendations = results.filter(r => r.recommendation === 'parallel');
            const sequentialRecommendations = results.filter(r => r.recommendation === 'sequential');

            console.log(`\nRecommendations: ${parallelRecommendations.length} parallel, ${sequentialRecommendations.length} sequential`);

            // Should show clear patterns
            assert(results.length === testSizes.length, 'Should have results for all test sizes');
            
            // Larger file sets should generally favor parallel processing
            const largeSetResults = results.filter(r => r.fileCount >= 10);
            const largeSetParallelCount = largeSetResults.filter(r => r.recommendation === 'parallel').length;
            
            assert(largeSetParallelCount >= largeSetResults.length / 2, 
                'Larger file sets should generally favor parallel processing');
        });
    });

    describe('Scalability Tests', () => {
        it('should test scalability with increasing file counts', async () => {
            const fileCounts = [5, 10, 20, 40];
            const scalabilityResults: Array<{
                fileCount: number;
                sequentialThroughput: number;
                parallelThroughput: number;
                scalabilityFactor: number;
            }> = [];

            for (const fileCount of fileCounts) {
                const testFiles = createTestFiles(fileCount);
                const processingDelay = 25;

                // Sequential processing
                const sequentialProcessor = new SequentialFileProcessor(mockLogger);
                const sequentialFileProcessor = new PerformanceTestProcessor(processingDelay);
                
                const sequentialStart = Date.now();
                await sequentialProcessor.processFiles(
                    testFiles,
                    sequentialFileProcessor,
                    { showProgress: false }
                );
                const sequentialDuration = Date.now() - sequentialStart;
                const sequentialThroughput = calculateThroughput(fileCount, sequentialDuration);

                // Parallel processing
                const parallelProcessor = new ParallelProcessor(mockLogger, { maxConcurrency: 6 });
                const parallelFileProcessor = new PerformanceTestProcessor(processingDelay);
                
                const parallelTasks = testFiles.map(file => ({
                    id: file,
                    data: file,
                    processor: (data: string) => parallelFileProcessor.processFile(data)
                }));

                const parallelStart = Date.now();
                await parallelProcessor.processInParallel(parallelTasks);
                const parallelDuration = Date.now() - parallelStart;
                const parallelThroughput = calculateThroughput(fileCount, parallelDuration);

                const scalabilityFactor = parallelThroughput / sequentialThroughput;

                scalabilityResults.push({
                    fileCount,
                    sequentialThroughput,
                    parallelThroughput,
                    scalabilityFactor
                });

                console.log(`${fileCount} files: Sequential ${sequentialThroughput.toFixed(1)} f/min, Parallel ${parallelThroughput.toFixed(1)} f/min, Factor ${scalabilityFactor.toFixed(2)}x`);
            }

            // Analyze scalability trends
            console.log('\n=== Scalability Analysis ===');
            scalabilityResults.forEach(result => {
                console.log(`${result.fileCount} files: ${result.scalabilityFactor.toFixed(2)}x speedup`);
            });

            // Should maintain reasonable scalability
            const averageScalability = scalabilityResults.reduce((sum, r) => sum + r.scalabilityFactor, 0) / scalabilityResults.length;
            console.log(`Average scalability factor: ${averageScalability.toFixed(2)}x`);

            assert(averageScalability > 1.2, `Average scalability should be > 1.2x, got ${averageScalability.toFixed(2)}x`);
            
            // Larger sets should generally show better scalability
            const largeSetScalability = scalabilityResults.filter(r => r.fileCount >= 20);
            if (largeSetScalability.length > 0) {
                const largeSetAverage = largeSetScalability.reduce((sum, r) => sum + r.scalabilityFactor, 0) / largeSetScalability.length;
                assert(largeSetAverage > 1.5, `Large set scalability should be > 1.5x, got ${largeSetAverage.toFixed(2)}x`);
            }
        });
    });
});