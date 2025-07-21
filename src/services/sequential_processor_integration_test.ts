import { assertEquals, assertExists } from 'jsr:@std/assert';
import { describe, it, beforeEach } from 'jsr:@std/testing/bdd';
import { Logger } from '../utils/logger.ts';
import {
    SequentialFileProcessor,
    ProcessingModeSelector,
    FileProcessingQueue,
    ProcessingMode,
    FileStatus,
    type FileProcessor,
    type ReviewCommand
} from './sequential_processor.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

describe('Sequential Processing Integration', () => {
    let logger: Logger;
    let processor: SequentialFileProcessor;
    let modeSelector: ProcessingModeSelector;

    beforeEach(() => {
        logger = new Logger('IntegrationTest', false);
        processor = new SequentialFileProcessor(logger);
        modeSelector = new ProcessingModeSelector(logger);
    });

    it('should complete full sequential processing workflow', async () => {
        // Setup test data
        const files = ['src/file1.ts', 'src/file2.ts', 'src/file3.ts'];
        const mockProcessor: FileProcessor = {
            async processFile(filePath: string): Promise<ReviewAnalysis> {
                // Simulate processing time
                await new Promise(resolve => setTimeout(resolve, 10));
                
                return {
                    grade: 'A',
                    coverage: 85,
                    testsPresent: true,
                    value: 'high',
                    state: 'pass',
                    issues: [],
                    suggestions: [`Processed ${filePath} successfully`],
                    summary: `Analysis complete for ${filePath}`
                };
            }
        };

        // Track progress
        const progressEvents: Array<{ event: string; file: string; index: number; total: number }> = [];
        const completionEvents: Array<{ file: string; success: boolean }> = [];

        // Process files with callbacks
        const results = await processor.processFiles(files, mockProcessor, {
            showProgress: true,
            onFileStart: (file, index, total) => {
                progressEvents.push({ event: 'start', file, index, total });
            },
            onFileComplete: (file, result) => {
                completionEvents.push({ file, success: result.success });
            },
            continueOnError: true
        });

        // Verify results
        assertEquals(results.length, 3);
        assertEquals(results.every(r => r.success), true);
        assertEquals(results.every(r => r.status === FileStatus.SUCCESS), true);

        // Verify sequential processing order
        assertEquals(results[0].file, 'src/file1.ts');
        assertEquals(results[1].file, 'src/file2.ts');
        assertEquals(results[2].file, 'src/file3.ts');

        // Verify progress tracking
        assertEquals(progressEvents.length, 3);
        assertEquals(completionEvents.length, 3);

        // Verify timing (sequential processing should have non-overlapping times)
        for (let i = 1; i < results.length; i++) {
            const prevEnd = results[i - 1].endTime!.getTime();
            const currentStart = results[i].startTime.getTime();
            // Current file should start after or at the same time as previous file ended
            assertEquals(currentStart >= prevEnd, true);
        }

        // Verify statistics
        const stats = processor.getStats(results);
        assertEquals(stats.total, 3);
        assertEquals(stats.successful, 3);
        assertEquals(stats.failed, 0);
        assertEquals(stats.successRate, 1);
    });

    it('should handle mixed success and failure scenarios', async () => {
        const files = ['good1.ts', 'bad.ts', 'good2.ts', 'bad2.ts'];
        const mockProcessor: FileProcessor = {
            async processFile(filePath: string): Promise<ReviewAnalysis> {
                if (filePath.includes('bad')) {
                    throw new Error(`Processing failed for ${filePath}`);
                }
                
                return {
                    grade: 'B',
                    coverage: 70,
                    testsPresent: true,
                    value: 'medium',
                    state: 'pass',
                    issues: [],
                    suggestions: [],
                    summary: `Good analysis for ${filePath}`
                };
            }
        };

        const results = await processor.processFiles(files, mockProcessor, {
            continueOnError: true,
            maxErrors: 10
        });

        assertEquals(results.length, 4);
        
        // Check individual results
        assertEquals(results[0].success, true);  // good1.ts
        assertEquals(results[1].success, false); // bad.ts
        assertEquals(results[2].success, true);  // good2.ts
        assertEquals(results[3].success, false); // bad2.ts

        // Verify error handling
        assertEquals(results[1].error?.message, 'Processing failed for bad.ts');
        assertEquals(results[3].error?.message, 'Processing failed for bad2.ts');

        const stats = processor.getStats(results);
        assertEquals(stats.successful, 2);
        assertEquals(stats.failed, 2);
        assertEquals(stats.successRate, 0.5);
    });

    it('should integrate with ProcessingModeSelector correctly', () => {
        // Test file command
        const fileCommand: ReviewCommand = {
            type: 'files',
            targets: ['file1.ts', 'file2.ts']
        };
        assertEquals(modeSelector.determineProcessingMode(fileCommand), ProcessingMode.SEQUENTIAL);

        // Test directory command
        const dirCommand: ReviewCommand = {
            type: 'directory',
            targets: ['src/']
        };
        assertEquals(modeSelector.determineProcessingMode(dirCommand), ProcessingMode.SEQUENTIAL);

        // Test PR command (should use parallel)
        const prCommand: ReviewCommand = {
            type: 'pr',
            targets: ['123']
        };
        assertEquals(modeSelector.determineProcessingMode(prCommand), ProcessingMode.PARALLEL);

        // Test advanced mode selection with thresholds
        const manyFilesCommand: ReviewCommand = {
            type: 'files',
            targets: Array.from({ length: 15 }, (_, i) => `file${i}.ts`)
        };

        // Below threshold - sequential
        assertEquals(
            modeSelector.determineProcessingModeAdvanced(manyFilesCommand, 5, { sequentialThreshold: 10 }),
            ProcessingMode.SEQUENTIAL
        );

        // Above threshold - parallel
        assertEquals(
            modeSelector.determineProcessingModeAdvanced(manyFilesCommand, 15, { sequentialThreshold: 10 }),
            ProcessingMode.PARALLEL
        );
    });

    it('should demonstrate FileProcessingQueue workflow', () => {
        const files = ['file1.ts', 'file2.ts', 'file3.ts'];
        const queue = new FileProcessingQueue(files, logger);

        // Initial state
        assertEquals(queue.isComplete(), false);
        assertEquals(queue.getQueueStats().pending, 3);

        // Process first file
        const firstFile = queue.getNextFile();
        assertExists(firstFile);
        assertEquals(firstFile.path, 'file1.ts');

        queue.updateFileStatus('file1.ts', FileStatus.PROCESSING);
        assertEquals(queue.getQueueStats().processing, 1);

        queue.updateFileStatus('file1.ts', FileStatus.SUCCESS);
        assertEquals(queue.getQueueStats().completed, 1);

        // Process remaining files
        queue.updateFileStatus('file2.ts', FileStatus.PROCESSING);
        queue.updateFileStatus('file2.ts', FileStatus.SUCCESS);
        queue.updateFileStatus('file3.ts', FileStatus.PROCESSING);
        queue.updateFileStatus('file3.ts', FileStatus.ERROR);

        // Final state
        assertEquals(queue.isComplete(), true);
        const finalStats = queue.getQueueStats();
        assertEquals(finalStats.completed, 2);
        assertEquals(finalStats.failed, 1);
        assertEquals(finalStats.pending, 0);
        assertEquals(finalStats.processing, 0);
    });
});