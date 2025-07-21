/**
 * Core tests for sequential file processing system
 * Tests the main components and integration scenarios
 */

import { assertEquals, assertExists, assert } from '@std/assert';
import { beforeEach, describe, it } from '@std/testing/bdd';
import { resolve } from 'std/path/mod.ts';

import { 
    SequentialFileProcessor,
    ProcessingModeSelector,
    ProcessingMode,
    FileStatus,
    type ProcessingResult,
    type FileProcessor
} from './sequential_processor.ts';

import { Logger } from '../utils/logger.ts';

// Mock file processor for testing
class MockFileProcessor implements FileProcessor {
    private processCount = 0;
    private failureFiles: Set<string> = new Set();
    private processingDelay = 0;

    async processFile(filePath: string): Promise<any> {
        this.processCount++;
        
        if (this.processingDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.processingDelay));
        }

        if (this.failureFiles.has(filePath)) {
            throw new Error(`Mock processing failed for ${filePath}`);
        }

        return {
            grade: 'A',
            state: 'pass',
            issues: [],
            metrics: { coverage: 90 },
            filePath,
            timestamp: new Date().toISOString()
        };
    }

    getProcessCount(): number {
        return this.processCount;
    }

    setFailureFiles(files: string[]): void {
        this.failureFiles = new Set(files);
    }

    setProcessingDelay(delay: number): void {
        this.processingDelay = delay;
    }

    reset(): void {
        this.processCount = 0;
        this.failureFiles.clear();
        this.processingDelay = 0;
    }
}

// Helper functions
function createMockLogger(): Logger {
    return new Logger('TestSequentialProcessing', false);
}

function createTestFiles(): string[] {
    const baseDir = resolve(Deno.cwd());
    return [
        resolve(baseDir, 'src/components/Button.tsx'),
        resolve(baseDir, 'src/components/Input.tsx'),
        resolve(baseDir, 'src/utils/helpers.ts'),
        resolve(baseDir, 'src/utils/validation.ts'),
        resolve(baseDir, 'tests/unit/button.test.ts'),
    ];
}

describe('Sequential File Processing - Core Components', () => {
    let mockLogger: Logger;
    let mockFileProcessor: MockFileProcessor;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockFileProcessor = new MockFileProcessor();
    });

    describe('SequentialFileProcessor', () => {
        let processor: SequentialFileProcessor;

        beforeEach(() => {
            processor = new SequentialFileProcessor(mockLogger);
        });

        it('should process files sequentially', async () => {
            const testFiles = createTestFiles().slice(0, 3);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );

            assertEquals(results.length, 3);
            assertEquals(mockFileProcessor.getProcessCount(), 3);
            
            // Verify all files were processed successfully
            results.forEach((result, index) => {
                assertEquals(result.file, testFiles[index]);
                assertEquals(result.success, true);
                assertExists(result.result);
                assert(result.duration >= 0);
                assertEquals(result.status, FileStatus.SUCCESS);
                assertExists(result.startTime);
            });
        });

        it('should handle processing errors gracefully', async () => {
            const testFiles = createTestFiles().slice(0, 4);
            mockFileProcessor.setFailureFiles([testFiles[1], testFiles[3]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );

            assertEquals(results.length, 4);
            assertEquals(mockFileProcessor.getProcessCount(), 4);
            
            // Check success/failure distribution
            assertEquals(results[0].success, true);
            assertEquals(results[1].success, false);
            assertEquals(results[2].success, true);
            assertEquals(results[3].success, false);
            
            // Verify error handling
            assertExists(results[1].error);
            assertExists(results[3].error);
            assertEquals(results[1].status, FileStatus.ERROR);
            assertEquals(results[3].status, FileStatus.ERROR);
        });

        it('should call progress callbacks correctly', async () => {
            const testFiles = createTestFiles().slice(0, 2);
            let fileStartCalls = 0;
            let fileCompleteCalls = 0;
            let errorCalls = 0;

            await processor.processFiles(
                testFiles,
                mockFileProcessor,
                {
                    showProgress: false,
                    onFileStart: (file, index, total) => {
                        fileStartCalls++;
                        assertEquals(typeof file, 'string');
                        assertEquals(typeof index, 'number');
                        assertEquals(typeof total, 'number');
                        assertEquals(total, 2);
                    },
                    onFileComplete: (file, result) => {
                        fileCompleteCalls++;
                        assertEquals(typeof file, 'string');
                        assertExists(result);
                    },
                    onError: (file, error) => {
                        errorCalls++;
                        assertEquals(typeof file, 'string');
                        assertExists(error);
                    }
                }
            );

            assertEquals(fileStartCalls, 2);
            assertEquals(fileCompleteCalls, 2);
            assertEquals(errorCalls, 0);
        });

        it('should handle empty file list', async () => {
            const results = await processor.processFiles(
                [],
                mockFileProcessor,
                { showProgress: false }
            );

            assertEquals(results.length, 0);
            assertEquals(mockFileProcessor.getProcessCount(), 0);
        });

        it('should respect maxErrors option', async () => {
            const testFiles = createTestFiles();
            mockFileProcessor.setFailureFiles(testFiles); // All files fail
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { 
                    showProgress: false,
                    maxErrors: 2,
                    continueOnError: true
                }
            );

            // Should stop after 2 errors
            assertEquals(results.length, 2);
            assertEquals(mockFileProcessor.getProcessCount(), 2);
            assertEquals(results.filter(r => !r.success).length, 2);
        });

        it('should stop on first error when continueOnError is false', async () => {
            const testFiles = createTestFiles().slice(0, 4);
            mockFileProcessor.setFailureFiles([testFiles[1]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { 
                    showProgress: false,
                    continueOnError: false
                }
            );

            // Should stop after first error
            assertEquals(results.length, 2); // First successful, then error
            assertEquals(mockFileProcessor.getProcessCount(), 2);
            assertEquals(results[0].success, true);
            assertEquals(results[1].success, false);
        });

        it('should calculate processing statistics', async () => {
            const testFiles = createTestFiles().slice(0, 5);
            mockFileProcessor.setFailureFiles([testFiles[1], testFiles[3]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );

            const stats = processor.getStats(results);
            
            assertEquals(stats.total, 5);
            assertEquals(stats.successful, 3);
            assertEquals(stats.failed, 2);
            assertEquals(stats.warnings, 0);
            assert(stats.averageDuration >= 0);
            assert(stats.totalDuration >= 0);
            assertEquals(stats.successRate, 0.6); // 3/5
        });
    });

    describe('ProcessingModeSelector', () => {
        let selector: ProcessingModeSelector;

        beforeEach(() => {
            selector = new ProcessingModeSelector(mockLogger);
        });

        it('should select sequential mode for file commands', () => {
            const command = {
                type: 'files' as const,
                targets: ['file1.ts', 'file2.ts'],
                options: {}
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.SEQUENTIAL);
        });

        it('should select sequential mode for directory commands', () => {
            const command = {
                type: 'directory' as const,
                targets: ['src/'],
                options: {}
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.SEQUENTIAL);
        });

        it('should select parallel mode for PR commands', () => {
            const command = {
                type: 'pr' as const,
                targets: ['123'],
                options: {}
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.PARALLEL);
        });

        it('should select parallel mode for changes commands', () => {
            const command = {
                type: 'changes' as const,
                targets: [],
                options: {}
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.PARALLEL);
        });

        it('should respect force sequential option', () => {
            const command = {
                type: 'pr' as const,
                targets: ['123'],
                options: {}
            };

            const mode = selector.determineProcessingModeAdvanced(command, 5, {
                forceSequential: true
            });
            assertEquals(mode, ProcessingMode.SEQUENTIAL);
        });

        it('should use sequential threshold', () => {
            const command = {
                type: 'files' as const,
                targets: ['file1.ts', 'file2.ts'],
                options: {}
            };

            // Below threshold - should use sequential
            const sequentialMode = selector.determineProcessingModeAdvanced(command, 2, {
                sequentialThreshold: 5
            });
            assertEquals(sequentialMode, ProcessingMode.SEQUENTIAL);

            // Above threshold - should use parallel
            const parallelMode = selector.determineProcessingModeAdvanced(command, 2, {
                sequentialThreshold: 1
            });
            assertEquals(parallelMode, ProcessingMode.PARALLEL);
        });

        it('should default to sequential for unknown command types', () => {
            const command = {
                type: 'files' as const,
                targets: ['file1.ts'],
                options: {}
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.SEQUENTIAL);
        });
    });

    describe('Performance Tests', () => {
        it('should process files in reasonable time', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles();
            
            // Set a small processing delay to simulate real work
            mockFileProcessor.setProcessingDelay(10);
            
            const startTime = Date.now();
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            
            assertEquals(results.length, testFiles.length);
            // Should complete in reasonable time (5 files * 10ms + overhead < 1000ms)
            assert(totalTime < 1000, `Sequential processing took ${totalTime}ms, expected < 1000ms`);
        });

        it('should process files in correct order', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles();
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );

            // Verify files were processed in the same order
            results.forEach((result, index) => {
                assertEquals(result.file, testFiles[index]);
            });
        });

        it('should handle large file sets efficiently', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            
            // Create a larger set of test files
            const largeFileSet = Array.from({ length: 20 }, (_, i) => 
                resolve(`test-file-${i}.ts`)
            );
            
            const startTime = Date.now();
            const results = await processor.processFiles(
                largeFileSet,
                mockFileProcessor,
                { showProgress: false }
            );
            const endTime = Date.now();
            
            assertEquals(results.length, 20);
            assertEquals(mockFileProcessor.getProcessCount(), 20);
            
            // Should complete efficiently
            const totalTime = endTime - startTime;
            assert(totalTime < 2000, `Large file set processing took ${totalTime}ms`);
        });
    });

    describe('Error Scenarios', () => {
        it('should handle mixed success/failure scenarios', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles();
            
            // Set up complex failure pattern
            mockFileProcessor.setFailureFiles([testFiles[1], testFiles[3]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );
            
            assertEquals(results.length, testFiles.length);
            
            // Verify specific results
            assertEquals(results[0].success, true);
            assertEquals(results[1].success, false);
            assertEquals(results[2].success, true);
            assertEquals(results[3].success, false);
            assertEquals(results[4].success, true);
            
            // Count successes and failures
            const successes = results.filter(r => r.success).length;
            const failures = results.filter(r => !r.success).length;
            
            assertEquals(successes, 3);
            assertEquals(failures, 2);
        });

        it('should handle processing timeout scenarios', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles().slice(0, 2);
            
            // Set a longer delay to test timeout handling
            mockFileProcessor.setProcessingDelay(100);
            
            const startTime = Date.now();
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );
            const endTime = Date.now();
            
            assertEquals(results.length, 2);
            assertEquals(mockFileProcessor.getProcessCount(), 2);
            
            // Should take at least the processing delay time
            const totalTime = endTime - startTime;
            assert(totalTime >= 200, `Processing should take at least 200ms, took ${totalTime}ms`);
        });
    });

    describe('Integration Tests', () => {
        it('should integrate with different file processors', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles().slice(0, 3);
            
            // Test with different mock processors
            const processors = [
                new MockFileProcessor(),
                new MockFileProcessor(),
                new MockFileProcessor()
            ];
            
            // Set different behaviors
            processors[1].setFailureFiles([testFiles[1]]);
            processors[2].setProcessingDelay(50);
            
            for (let i = 0; i < processors.length; i++) {
                const results = await processor.processFiles(
                    testFiles,
                    processors[i],
                    { showProgress: false }
                );
                
                assertEquals(results.length, testFiles.length);
                assertEquals(processors[i].getProcessCount(), testFiles.length);
            }
        });

        it('should work with processing mode selector', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const selector = new ProcessingModeSelector(mockLogger);
            const testFiles = createTestFiles().slice(0, 3);
            
            const command = {
                type: 'files' as const,
                targets: testFiles,
                options: {}
            };
            
            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.SEQUENTIAL);
            
            // Process files based on selected mode
            if (mode === ProcessingMode.SEQUENTIAL) {
                const results = await processor.processFiles(
                    testFiles,
                    mockFileProcessor,
                    { showProgress: false }
                );
                
                assertEquals(results.length, testFiles.length);
                assertEquals(mockFileProcessor.getProcessCount(), testFiles.length);
            }
        });
    });
});