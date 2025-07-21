import { assertEquals, assertExists, assertRejects } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { Logger } from '../utils/logger.ts';
import {
    SequentialFileProcessor,
    ProcessingModeSelector,
    FileProcessingQueue,
    ProcessingMode,
    FileStatus,
    type ProcessingResult,
    type FileProcessor,
    type ReviewCommand,
    type SequentialProcessingOptions
} from './sequential_processor.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

// Mock logger for testing
const createMockLogger = (): Logger => {
    return new Logger('Test', false);
};

// Mock file processor for testing
const createMockFileProcessor = (
    results: Map<string, ReviewAnalysis | Error> = new Map()
): FileProcessor => {
    return {
        async processFile(filePath: string): Promise<ReviewAnalysis> {
            const result = results.get(filePath);
            if (result instanceof Error) {
                throw result;
            }
            return result || {
                grade: 'A',
                coverage: 85,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: `Analysis for ${filePath}`
            };
        }
    };
};

describe('SequentialFileProcessor', () => {
    let processor: SequentialFileProcessor;
    let mockLogger: Logger;

    beforeEach(() => {
        mockLogger = createMockLogger();
        processor = new SequentialFileProcessor(mockLogger);
    });

    afterEach(() => {
        restore();
    });

    describe('processFiles', () => {
        it('should process files sequentially', async () => {
            const files = ['file1.ts', 'file2.ts', 'file3.ts'];
            const mockProcessor = createMockFileProcessor();
            const processFileSpy = spy(mockProcessor, 'processFile');

            const results = await processor.processFiles(files, mockProcessor);

            assertEquals(results.length, 3);
            assertEquals(processFileSpy.calls.length, 3);
            
            // Verify sequential processing order
            assertEquals(processFileSpy.calls[0].args[0], 'file1.ts');
            assertEquals(processFileSpy.calls[1].args[0], 'file2.ts');
            assertEquals(processFileSpy.calls[2].args[0], 'file3.ts');

            // Verify all results are successful
            results.forEach((result, index) => {
                assertEquals(result.success, true);
                assertEquals(result.file, files[index]);
                assertEquals(result.status, FileStatus.SUCCESS);
                assertExists(result.result);
                assertExists(result.startTime);
                assertExists(result.endTime);
            });
        });

        it('should handle empty file list', async () => {
            const mockProcessor = createMockFileProcessor();
            const results = await processor.processFiles([], mockProcessor);

            assertEquals(results.length, 0);
        });

        it('should handle file processing errors gracefully', async () => {
            const files = ['file1.ts', 'file2.ts', 'file3.ts'];
            const errorResults = new Map([
                ['file1.ts', new Error('Processing failed')],
                ['file3.ts', new Error('Another error')]
            ]);
            const mockProcessor = createMockFileProcessor(errorResults);

            const results = await processor.processFiles(files, mockProcessor);

            assertEquals(results.length, 3);
            
            // First file should fail
            assertEquals(results[0].success, false);
            assertEquals(results[0].status, FileStatus.ERROR);
            assertExists(results[0].error);
            assertEquals(results[0].error?.message, 'Processing failed');

            // Second file should succeed
            assertEquals(results[1].success, true);
            assertEquals(results[1].status, FileStatus.SUCCESS);

            // Third file should fail
            assertEquals(results[2].success, false);
            assertEquals(results[2].status, FileStatus.ERROR);
            assertEquals(results[2].error?.message, 'Another error');
        });

        it('should call progress callbacks', async () => {
            const files = ['file1.ts', 'file2.ts'];
            const mockProcessor = createMockFileProcessor();
            
            const onFileStartSpy = spy();
            const onFileCompleteSpy = spy();
            const onErrorSpy = spy();

            const options: SequentialProcessingOptions = {
                onFileStart: onFileStartSpy,
                onFileComplete: onFileCompleteSpy,
                onError: onErrorSpy
            };

            await processor.processFiles(files, mockProcessor, options);

            assertEquals(onFileStartSpy.calls.length, 2);
            assertEquals(onFileCompleteSpy.calls.length, 2);
            assertEquals(onErrorSpy.calls.length, 0);

            // Verify callback arguments
            assertEquals(onFileStartSpy.calls[0].args, ['file1.ts', 0, 2]);
            assertEquals(onFileStartSpy.calls[1].args, ['file2.ts', 1, 2]);
        });

        it('should stop processing when continueOnError is false', async () => {
            const files = ['file1.ts', 'file2.ts', 'file3.ts'];
            const errorResults = new Map([
                ['file2.ts', new Error('Processing failed')]
            ]);
            const mockProcessor = createMockFileProcessor(errorResults);

            const options: SequentialProcessingOptions = {
                continueOnError: false
            };

            const results = await processor.processFiles(files, mockProcessor, options);

            assertEquals(results.length, 2); // Should stop after error
            assertEquals(results[0].success, true);
            assertEquals(results[1].success, false);
        });

        it('should respect maxErrors limit', async () => {
            const files = ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts'];
            const errorResults = new Map([
                ['file1.ts', new Error('Error 1')],
                ['file2.ts', new Error('Error 2')],
                ['file3.ts', new Error('Error 3')]
            ]);
            const mockProcessor = createMockFileProcessor(errorResults);

            const options: SequentialProcessingOptions = {
                maxErrors: 2,
                continueOnError: true
            };

            const results = await processor.processFiles(files, mockProcessor, options);

            assertEquals(results.length, 2); // Should stop after 2 errors
            assertEquals(results[0].success, false);
            assertEquals(results[1].success, false);
        });

        it('should handle warning state correctly', async () => {
            const files = ['file1.ts'];
            const warningResult: ReviewAnalysis = {
                grade: 'C',
                coverage: 60,
                testsPresent: false,
                value: 'medium',
                state: 'warning',
                issues: [{ line: 10, severity: 'medium', type: 'style', message: 'Style issue' }],
                suggestions: ['Add tests'],
                summary: 'Warning analysis'
            };
            const mockProcessor = createMockFileProcessor(new Map([['file1.ts', warningResult]]));

            const results = await processor.processFiles(files, mockProcessor);

            assertEquals(results.length, 1);
            assertEquals(results[0].success, true);
            assertEquals(results[0].status, FileStatus.WARNING);
        });
    });

    describe('getStats', () => {
        it('should calculate statistics correctly', () => {
            const results: ProcessingResult[] = [
                {
                    file: 'file1.ts',
                    success: true,
                    status: FileStatus.SUCCESS,
                    duration: 100,
                    startTime: new Date(),
                    endTime: new Date()
                },
                {
                    file: 'file2.ts',
                    success: true,
                    status: FileStatus.WARNING,
                    duration: 200,
                    startTime: new Date(),
                    endTime: new Date()
                },
                {
                    file: 'file3.ts',
                    success: false,
                    status: FileStatus.ERROR,
                    duration: 50,
                    startTime: new Date(),
                    error: new Error('Test error')
                }
            ];

            const stats = processor.getStats(results);

            assertEquals(stats.total, 3);
            assertEquals(stats.successful, 1);
            assertEquals(stats.warnings, 1);
            assertEquals(stats.failed, 1);
            assertEquals(stats.averageDuration, (100 + 200 + 50) / 3);
            assertEquals(stats.totalDuration, 350);
            assertEquals(stats.successRate, 1 / 3);
        });

        it('should handle empty results', () => {
            const stats = processor.getStats([]);

            assertEquals(stats.total, 0);
            assertEquals(stats.successful, 0);
            assertEquals(stats.warnings, 0);
            assertEquals(stats.failed, 0);
            assertEquals(stats.averageDuration, 0);
            assertEquals(stats.totalDuration, 0);
            assertEquals(stats.successRate, 0);
        });
    });
});

describe('ProcessingModeSelector', () => {
    let selector: ProcessingModeSelector;
    let mockLogger: Logger;

    beforeEach(() => {
        mockLogger = createMockLogger();
        selector = new ProcessingModeSelector(mockLogger);
    });

    describe('determineProcessingMode', () => {
        it('should select sequential mode for file commands', () => {
            const command: ReviewCommand = {
                type: 'files',
                targets: ['file1.ts', 'file2.ts']
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.SEQUENTIAL);
        });

        it('should select sequential mode for directory commands', () => {
            const command: ReviewCommand = {
                type: 'directory',
                targets: ['src/']
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.SEQUENTIAL);
        });

        it('should select parallel mode for PR commands', () => {
            const command: ReviewCommand = {
                type: 'pr',
                targets: ['123']
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.PARALLEL);
        });

        it('should select parallel mode for changes commands', () => {
            const command: ReviewCommand = {
                type: 'changes',
                targets: []
            };

            const mode = selector.determineProcessingMode(command);
            assertEquals(mode, ProcessingMode.PARALLEL);
        });
    });

    describe('determineProcessingModeAdvanced', () => {
        it('should respect forceSequential option', () => {
            const command: ReviewCommand = {
                type: 'pr',
                targets: ['123']
            };

            const mode = selector.determineProcessingModeAdvanced(command, 5, {
                forceSequential: true
            });

            assertEquals(mode, ProcessingMode.SEQUENTIAL);
        });

        it('should respect forceParallel option', () => {
            const command: ReviewCommand = {
                type: 'files',
                targets: ['file1.ts']
            };

            const mode = selector.determineProcessingModeAdvanced(command, 1, {
                forceParallel: true
            });

            assertEquals(mode, ProcessingMode.PARALLEL);
        });

        it('should use threshold for file commands', () => {
            const command: ReviewCommand = {
                type: 'files',
                targets: Array.from({ length: 15 }, (_, i) => `file${i}.ts`)
            };

            // Below threshold - should be sequential
            let mode = selector.determineProcessingModeAdvanced(command, 5, {
                sequentialThreshold: 10
            });
            assertEquals(mode, ProcessingMode.SEQUENTIAL);

            // Above threshold - should be parallel
            mode = selector.determineProcessingModeAdvanced(command, 15, {
                sequentialThreshold: 10
            });
            assertEquals(mode, ProcessingMode.PARALLEL);
        });

        it('should use default threshold of 10', () => {
            const command: ReviewCommand = {
                type: 'files',
                targets: Array.from({ length: 15 }, (_, i) => `file${i}.ts`)
            };

            const mode = selector.determineProcessingModeAdvanced(command, 15);
            assertEquals(mode, ProcessingMode.PARALLEL);
        });
    });
});

describe('FileProcessingQueue', () => {
    let queue: FileProcessingQueue;
    let mockLogger: Logger;
    const testFiles = ['file1.ts', 'file2.ts', 'file3.ts'];

    beforeEach(() => {
        mockLogger = createMockLogger();
        queue = new FileProcessingQueue(testFiles, mockLogger);
    });

    describe('initialization', () => {
        it('should initialize with pending files', () => {
            const stats = queue.getQueueStats();
            assertEquals(stats.total, 3);
            assertEquals(stats.pending, 3);
            assertEquals(stats.processing, 0);
            assertEquals(stats.completed, 0);
            assertEquals(stats.failed, 0);
        });

        it('should maintain processing order', () => {
            const order = queue.getProcessingOrder();
            assertEquals(order, testFiles);
        });
    });

    describe('updateFileStatus', () => {
        it('should update file status correctly', () => {
            queue.updateFileStatus('file1.ts', FileStatus.PROCESSING);
            
            const file = queue.getFile('file1.ts');
            assertEquals(file?.status, FileStatus.PROCESSING);
            assertExists(file?.startTime);
        });

        it('should set end time for completed files', () => {
            queue.updateFileStatus('file1.ts', FileStatus.PROCESSING);
            queue.updateFileStatus('file1.ts', FileStatus.SUCCESS);
            
            const file = queue.getFile('file1.ts');
            assertEquals(file?.status, FileStatus.SUCCESS);
            assertExists(file?.endTime);
        });

        it('should handle unknown files gracefully', () => {
            // Should not throw
            queue.updateFileStatus('unknown.ts', FileStatus.PROCESSING);
        });
    });

    describe('getFilesByStatus', () => {
        it('should return files by status', () => {
            queue.updateFileStatus('file1.ts', FileStatus.PROCESSING);
            queue.updateFileStatus('file2.ts', FileStatus.SUCCESS);

            const processing = queue.getFilesByStatus(FileStatus.PROCESSING);
            const completed = queue.getFilesByStatus(FileStatus.SUCCESS);
            const pending = queue.getFilesByStatus(FileStatus.PENDING);

            assertEquals(processing.length, 1);
            assertEquals(processing[0].path, 'file1.ts');
            assertEquals(completed.length, 1);
            assertEquals(completed[0].path, 'file2.ts');
            assertEquals(pending.length, 1);
            assertEquals(pending[0].path, 'file3.ts');
        });
    });

    describe('getNextFile', () => {
        it('should return next pending file', () => {
            const next = queue.getNextFile();
            assertEquals(next?.path, 'file1.ts');
            assertEquals(next?.status, FileStatus.PENDING);
        });

        it('should return undefined when no pending files', () => {
            testFiles.forEach(file => {
                queue.updateFileStatus(file, FileStatus.SUCCESS);
            });

            const next = queue.getNextFile();
            assertEquals(next, undefined);
        });
    });

    describe('isComplete', () => {
        it('should return false when files are pending', () => {
            assertEquals(queue.isComplete(), false);
        });

        it('should return false when files are processing', () => {
            queue.updateFileStatus('file1.ts', FileStatus.PROCESSING);
            assertEquals(queue.isComplete(), false);
        });

        it('should return true when all files are completed', () => {
            testFiles.forEach(file => {
                queue.updateFileStatus(file, FileStatus.SUCCESS);
            });
            assertEquals(queue.isComplete(), true);
        });
    });

    describe('getQueueStats', () => {
        it('should return accurate statistics', () => {
            queue.updateFileStatus('file1.ts', FileStatus.PROCESSING);
            queue.updateFileStatus('file2.ts', FileStatus.SUCCESS);
            queue.updateFileStatus('file3.ts', FileStatus.ERROR);

            const stats = queue.getQueueStats();
            assertEquals(stats.total, 3);
            assertEquals(stats.pending, 0);
            assertEquals(stats.processing, 1);
            assertEquals(stats.completed, 1);
            assertEquals(stats.failed, 1);
            assertEquals(stats.warnings, 0);
        });
    });

    describe('reset', () => {
        it('should reset all files to pending status', () => {
            // Update some files
            queue.updateFileStatus('file1.ts', FileStatus.SUCCESS);
            queue.updateFileStatus('file2.ts', FileStatus.ERROR);

            // Reset
            queue.reset();

            // Check all files are pending
            const stats = queue.getQueueStats();
            assertEquals(stats.pending, 3);
            assertEquals(stats.completed, 0);
            assertEquals(stats.failed, 0);

            // Check individual files
            testFiles.forEach(file => {
                const queuedFile = queue.getFile(file);
                assertEquals(queuedFile?.status, FileStatus.PENDING);
                assertEquals(queuedFile?.startTime, undefined);
                assertEquals(queuedFile?.endTime, undefined);
            });
        });
    });

    describe('getAllFiles', () => {
        it('should return files in processing order', () => {
            const allFiles = queue.getAllFiles();
            assertEquals(allFiles.length, 3);
            assertEquals(allFiles.map(f => f.path), testFiles);
        });

        it('should maintain order after status updates', () => {
            queue.updateFileStatus('file2.ts', FileStatus.SUCCESS);
            queue.updateFileStatus('file1.ts', FileStatus.PROCESSING);

            const allFiles = queue.getAllFiles();
            assertEquals(allFiles.map(f => f.path), testFiles);
        });
    });
});