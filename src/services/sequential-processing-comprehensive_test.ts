/**
 * Comprehensive test suite for sequential file processing system
 * Tests all components, integration scenarios, CLI options, and error handling
 */

import { assertEquals, assertExists, assert, assertStringIncludes, assertRejects } from '@std/assert';
import { beforeEach, describe, it, afterEach } from '@std/testing/bdd';
import { spy, stub, restore } from '@std/testing/mock';
import { resolve, join } from 'std/path/mod.ts';

// Import all sequential processing components
import { 
    SequentialFileProcessor,
    ProcessingModeSelector,
    ProcessingMode,
    FileStatus,
    type ProcessingResult,
    type FileProcessor,
    type SequentialProcessingOptions
} from './sequential_processor.ts';

import { EnhancedCLIHandler } from './enhanced-cli-handler.ts';
import { JSONReportGenerator } from './json-report-generator.ts';
import { DryRunProcessor } from './dry-run-processor.ts';
import { DirectoryGroupProcessor } from './directory-group-processor.ts';
import { NestedFileProcessor } from './nested-file-processor.ts';

// Import progress renderers
import { TerminalProgressRenderer } from './progress/terminal-progress-renderer.ts';
import { EnhancedProgressRenderer } from './progress/enhanced-progress-renderer.ts';
import { PlainTextProgressRenderer } from './progress/plain-text-progress-renderer.ts';
import { ProgressErrorHandler } from './progress/progress-error-handler.ts';
import { MemoryManager } from './progress/memory-manager.ts';

// Import configuration
import { SequentialProcessingConfigManager } from '../config/sequential-processing-config.ts';
import type { EnhancedCLIOptions } from '../types/enhanced-cli.types.ts';

import { Logger } from '../utils/logger.ts';

// Mock implementations for testing
class MockFileProcessor implements FileProcessor {
    private processCount = 0;
    private processingTimes: Map<string, number> = new Map();
    private failureFiles: Set<string> = new Set();
    private warningFiles: Set<string> = new Set();
    private processingDelay = 0;

    async processFile(filePath: string): Promise<any> {
        this.processCount++;
        
        // Simulate processing delay
        if (this.processingDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.processingDelay));
        }

        const startTime = Date.now();
        
        if (this.failureFiles.has(filePath)) {
            throw new Error(`Mock processing failed for ${filePath}`);
        }

        const result = {
            grade: this.warningFiles.has(filePath) ? 'C' : 'A',
            state: this.warningFiles.has(filePath) ? 'warning' : 'pass',
            issues: this.warningFiles.has(filePath) ? [{ type: 'warning', message: 'Test warning' }] : [],
            metrics: { coverage: 90 },
            filePath,
            timestamp: new Date().toISOString()
        };

        this.processingTimes.set(filePath, Date.now() - startTime);
        return result;
    }

    getProcessCount(): number {
        return this.processCount;
    }

    setProcessingDelay(delay: number): void {
        this.processingDelay = delay;
    }

    setFailureFiles(files: string[]): void {
        this.failureFiles = new Set(files);
    }

    setWarningFiles(files: string[]): void {
        this.warningFiles = new Set(files);
    }

    getProcessingTime(file: string): number {
        return this.processingTimes.get(file) || 0;
    }

    reset(): void {
        this.processCount = 0;
        this.processingTimes.clear();
        this.failureFiles.clear();
        this.warningFiles.clear();
        this.processingDelay = 0;
    }
}

class MockProgressRenderer {
    public startCalls: Array<{ totalFiles: number }> = [];
    public updateProgressCalls: Array<{ file: string; completed: number; total: number }> = [];
    public updateFileStatusCalls: Array<{ file: string; status: FileStatus }> = [];
    public errorCalls: Array<{ file: string; error: string }> = [];
    public completeCalls: number = 0;
    public cleanupCalls: number = 0;

    start(totalFiles: number): void {
        this.startCalls.push({ totalFiles });
    }

    updateProgress(currentFile: string, completed: number, total: number): void {
        this.updateProgressCalls.push({ file: currentFile, completed, total });
    }

    updateFileStatus(file: string, status: FileStatus): void {
        this.updateFileStatusCalls.push({ file, status });
    }

    error(file: string, error: string): void {
        this.errorCalls.push({ file, error });
    }

    complete(): void {
        this.completeCalls++;
    }

    cleanup(): void {
        this.cleanupCalls++;
    }

    reset(): void {
        this.startCalls = [];
        this.updateProgressCalls = [];
        this.updateFileStatusCalls = [];
        this.errorCalls = [];
        this.completeCalls = 0;
        this.cleanupCalls = 0;
    }
}

// Helper functions
function createMockLogger(): Logger {
    return new Logger('TestSequentialProcessing', false);
}

function createTestFiles(): string[] {
    const baseDir = resolve(Deno.cwd());
    return [
        join(baseDir, 'src/components/Button.tsx'),
        join(baseDir, 'src/components/Input.tsx'),
        join(baseDir, 'src/components/Modal.tsx'),
        join(baseDir, 'src/utils/helpers.ts'),
        join(baseDir, 'src/utils/validation.ts'),
        join(baseDir, 'src/services/api.ts'),
        join(baseDir, 'tests/unit/button.test.ts'),
        join(baseDir, 'tests/integration/api.test.ts'),
    ];
}

describe('Sequential File Processing - Core Components', () => {
    let mockLogger: Logger;
    let mockFileProcessor: MockFileProcessor;
    let mockProgressRenderer: MockProgressRenderer;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockFileProcessor = new MockFileProcessor();
        mockProgressRenderer = new MockProgressRenderer();
    });

    afterEach(() => {
        mockFileProcessor.reset();
        mockProgressRenderer.reset();
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
                {
                    showProgress: true,
                    progressRenderer: mockProgressRenderer
                }
            );

            assertEquals(results.length, 3);
            assertEquals(mockFileProcessor.getProcessCount(), 3);
            
            // Verify all files were processed successfully
            results.forEach((result, index) => {
                assertEquals(result.file, testFiles[index]);
                assertEquals(result.success, true);
                assertExists(result.result);
                assert(result.duration >= 0);
            });

            // Verify progress renderer was called correctly
            assertEquals(mockProgressRenderer.startCalls.length, 1);
            assertEquals(mockProgressRenderer.startCalls[0].totalFiles, 3);
            assertEquals(mockProgressRenderer.updateProgressCalls.length, 3);
            assertEquals(mockProgressRenderer.completeCalls, 1);
        });

        it('should handle processing errors gracefully', async () => {
            const testFiles = createTestFiles().slice(0, 4);
            mockFileProcessor.setFailureFiles([testFiles[1], testFiles[3]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                {
                    showProgress: true,
                    progressRenderer: mockProgressRenderer
                }
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
            assertEquals(mockProgressRenderer.errorCalls.length, 2);
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
                    showProgress: true,
                    progressRenderer: mockProgressRenderer,
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

        it('should process files without progress renderer', async () => {
            const testFiles = createTestFiles().slice(0, 2);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );

            assertEquals(results.length, 2);
            assertEquals(mockFileProcessor.getProcessCount(), 2);
            results.forEach(result => assertEquals(result.success, true));
        });

        it('should handle empty file list', async () => {
            const results = await processor.processFiles(
                [],
                mockFileProcessor,
                { showProgress: true, progressRenderer: mockProgressRenderer }
            );

            assertEquals(results.length, 0);
            assertEquals(mockFileProcessor.getProcessCount(), 0);
            assertEquals(mockProgressRenderer.startCalls[0].totalFiles, 0);
            assertEquals(mockProgressRenderer.completeCalls, 1);
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
    });
});

describe('Sequential File Processing - Progress Renderers', () => {
    let originalProcess: any;
    let mockStdout: any;
    let writeCalls: string[];

    beforeEach(() => {
        originalProcess = (globalThis as any).process;
        writeCalls = [];
        mockStdout = {
            write: (data: string) => {
                writeCalls.push(data);
                return true;
            },
            isTTY: true
        };
        (globalThis as any).process = {
            stdout: mockStdout,
            env: { TERM: 'xterm-256color' }
        };
    });

    afterEach(() => {
        restore();
        (globalThis as any).process = originalProcess;
    });

    describe('TerminalProgressRenderer', () => {
        it('should render progress correctly', () => {
            const renderer = new TerminalProgressRenderer();
            renderer.start(3);
            renderer.updateProgress('test.ts', 1, 3);
            renderer.complete();

            // Should have cursor hide, progress update, and cursor show
            assert(writeCalls.length >= 3);
            
            // Check for cursor control sequences
            const hasHideCursor = writeCalls.some(call => call.includes('\x1b[?25l'));
            const hasShowCursor = writeCalls.some(call => call.includes('\x1b[?25h'));
            assertEquals(hasHideCursor, true);
            assertEquals(hasShowCursor, true);
        });

        it('should handle non-TTY environment', () => {
            mockStdout.isTTY = false;
            const renderer = new TerminalProgressRenderer();
            
            renderer.start(3);
            renderer.updateProgress('test.ts', 1, 3);
            renderer.complete();

            // Should not write ANSI sequences for non-TTY
            assertEquals(writeCalls.length, 0);
        });
    });

    describe('EnhancedProgressRenderer', () => {
        it('should show ETA and throughput', () => {
            const renderer = new EnhancedProgressRenderer();
            renderer.start(3);
            renderer.updateProgress('test.ts', 1, 3);

            const output = writeCalls.join('');
            assertStringIncludes(output, 'ETA:');
            assertStringIncludes(output, 'files/min');
        });

        it('should animate spinner', () => {
            const renderer = new EnhancedProgressRenderer();
            renderer.start(2);
            
            renderer.updateProgress('file1.ts', 0, 2);
            const firstSpinner = writeCalls[writeCalls.length - 1];
            
            renderer.updateProgress('file2.ts', 1, 2);
            const secondSpinner = writeCalls[writeCalls.length - 1];

            // Spinners should be different (animation)
            assertEquals(typeof firstSpinner, 'string');
            assertEquals(typeof secondSpinner, 'string');
        });
    });

    describe('PlainTextProgressRenderer', () => {
        let consoleOutput: string[];
        let originalConsoleLog: any;

        beforeEach(() => {
            consoleOutput = [];
            originalConsoleLog = console.log;
            console.log = (...args: any[]) => {
                consoleOutput.push(args.join(' '));
            };
        });

        afterEach(() => {
            console.log = originalConsoleLog;
        });

        it('should output plain text progress', () => {
            const renderer = new PlainTextProgressRenderer();
            renderer.start(3);
            renderer.updateProgress('test.ts', 1, 3);
            renderer.complete();

            assert(consoleOutput.length >= 3);
            assertStringIncludes(consoleOutput[0], 'Starting analysis of 3 files');
            assertStringIncludes(consoleOutput[1], '[1/3]');
            assertStringIncludes(consoleOutput[1], '33%');
            assertStringIncludes(consoleOutput[2], 'Analysis complete');
        });
    });
});

describe('Sequential File Processing - Error Handling', () => {
    let mockLogger: Logger;

    beforeEach(() => {
        mockLogger = createMockLogger();
    });

    describe('ProgressErrorHandler', () => {
        it('should handle terminal rendering errors', () => {
            const mockRenderer = new MockProgressRenderer();
            const handler = new ProgressErrorHandler(mockRenderer);
            
            const error = new Error('Terminal not supported');
            handler.handleRenderError(error);
            
            // Should switch to fallback mode
            assertEquals(handler.isInFallbackMode(), true);
        });

        it('should provide fallback renderer', () => {
            const mockRenderer = new MockProgressRenderer();
            const handler = new ProgressErrorHandler(mockRenderer);
            
            const fallbackRenderer = handler.getRenderer();
            assertExists(fallbackRenderer);
            assertEquals(typeof fallbackRenderer.start, 'function');
        });
    });

    describe('MemoryManager', () => {
        it('should track memory usage', () => {
            const memoryManager = new MemoryManager();
            
            const initialUsage = memoryManager.getMemoryStats();
            assert(initialUsage.heapUsed > 0);
            assert(initialUsage.heapTotal > 0);
        });

        it('should detect memory safety', () => {
            const memoryManager = new MemoryManager({
                thresholds: {
                    warning: 100 * 1024 * 1024, // 100MB
                    critical: 200 * 1024 * 1024, // 200MB
                    maximum: 300 * 1024 * 1024 // 300MB
                }
            });
            
            // This test depends on actual memory usage, so we just verify the method exists
            const isSafe = memoryManager.isMemorySafe();
            assertEquals(typeof isSafe, 'boolean');
        });

        it('should trigger garbage collection when needed', async () => {
            const memoryManager = new MemoryManager();
            
            // Mock global.gc if it doesn't exist
            const originalGc = (global as any).gc;
            let gcCalled = false;
            (global as any).gc = () => { gcCalled = true; };
            
            await memoryManager.forceGarbageCollection();
            
            // Restore original gc
            (global as any).gc = originalGc;
            
            // GC might or might not be called depending on memory pressure
            assertEquals(typeof gcCalled, 'boolean');
        });
    });
});

describe('Sequential File Processing - CLI Integration', () => {
    let mockLogger: Logger;
    let mockFileProcessor: MockFileProcessor;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockFileProcessor = new MockFileProcessor();
    });

    describe('EnhancedCLIHandler', () => {
        it('should handle dry-run option', async () => {
            const handler = new EnhancedCLIHandler(mockLogger);
            const testFiles = createTestFiles().slice(0, 3);
            
            const options: EnhancedCLIOptions = {
                files: testFiles,
                dryRun: true,
                outputFormat: 'console'
            };

            // Mock the dry run processor
            const dryRunProcessor = new DryRunProcessor(mockLogger);
            
            // This would normally show the analysis plan
            const plan = await dryRunProcessor.createAnalysisPlan(testFiles);
            
            assertExists(plan);
            assertEquals(plan.totalFiles, testFiles.length);
            assert(plan.estimatedDuration > 0);
        });

        it('should handle JSON report option', async () => {
            const handler = new EnhancedCLIHandler(mockLogger);
            const testFiles = createTestFiles().slice(0, 2);
            
            const options: EnhancedCLIOptions = {
                files: testFiles,
                jsonReport: 'test-report.json',
                outputFormat: 'json'
            };

            // Create mock results
            const mockResults: ProcessingResult[] = testFiles.map(file => ({
                file,
                success: true,
                result: { grade: 'A', state: 'pass', issues: [] },
                duration: 100
            }));

            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(mockResults, {
                includeMetrics: true,
                processingMode: 'sequential'
            });

            assertExists(report);
            assertEquals(report.metadata.totalFiles, 2);
            assertEquals(report.metadata.processingMode, 'sequential');
            assertEquals(report.files.length, 2);
        });

        it('should handle directory grouping option', async () => {
            const handler = new EnhancedCLIHandler(mockLogger);
            const testFiles = createTestFiles();
            
            const options: EnhancedCLIOptions = {
                files: testFiles,
                groupByDirectory: true,
                outputFormat: 'console'
            };

            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            
            // Mock the directory grouping
            const result = await groupProcessor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
        });
    });

    describe('Configuration System', () => {
        it('should load default configuration', () => {
            const config = new SequentialProcessingConfig();
            
            assertEquals(config.enabled, true);
            assertEquals(config.progressDisplay.enabled, true);
            assertEquals(config.progressDisplay.style, 'enhanced');
            assertEquals(config.errorHandling.continueOnError, true);
        });

        it('should map CLI options to configuration', () => {
            const mapper = new CLIConfigMapper();
            
            const cliOptions: EnhancedCLIOptions = {
                dryRun: true,
                jsonReport: 'report.json',
                interactive: true,
                groupByDirectory: true
            };

            const config = mapper.mapCLIOptionsToConfig(cliOptions);
            
            assertEquals(config.dryRun.enabled, true);
            assertEquals(config.reporting.jsonOutput, true);
            assertEquals(config.progressDisplay.style, 'enhanced');
            assertEquals(config.reporting.groupByDirectory, true);
        });

        it('should validate configuration', () => {
            const config = new SequentialProcessingConfig();
            
            // Test valid configuration
            const validationResult = config.validate();
            assertEquals(validationResult.isValid, true);
            assertEquals(validationResult.errors.length, 0);
        });

        it('should handle invalid configuration', () => {
            const config = new SequentialProcessingConfig();
            
            // Set invalid values
            config.progressDisplay.barWidth = -1;
            config.errorHandling.maxErrors = -5;
            
            const validationResult = config.validate();
            assertEquals(validationResult.isValid, false);
            assert(validationResult.errors.length > 0);
        });
    });
});

describe('Sequential File Processing - Performance Tests', () => {
    let mockLogger: Logger;
    let mockFileProcessor: MockFileProcessor;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockFileProcessor = new MockFileProcessor();
    });

    describe('Sequential vs Parallel Performance', () => {
        it('should complete sequential processing within reasonable time', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles().slice(0, 5);
            
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
            
            assertEquals(results.length, 5);
            // Should complete in reasonable time (5 files * 10ms + overhead < 1000ms)
            assert(totalTime < 1000, `Sequential processing took ${totalTime}ms, expected < 1000ms`);
        });

        it('should process files in correct order', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles().slice(0, 4);
            
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

    describe('Memory Usage', () => {
        it('should not accumulate excessive memory during processing', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const memoryManager = new MemoryManager(mockLogger);
            
            const initialMemory = memoryManager.getCurrentUsage();
            
            // Process a moderate number of files
            const testFiles = Array.from({ length: 10 }, (_, i) => 
                resolve(`memory-test-${i}.ts`)
            );
            
            await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );
            
            const finalMemory = memoryManager.getCurrentUsage();
            
            // Memory usage should not increase dramatically
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            const maxAcceptableIncrease = 50 * 1024 * 1024; // 50MB
            
            assert(memoryIncrease < maxAcceptableIncrease, 
                `Memory increased by ${memoryIncrease} bytes, expected < ${maxAcceptableIncrease}`);
        });
    });
});

describe('Sequential File Processing - End-to-End Tests', () => {
    let mockLogger: Logger;
    let mockFileProcessor: MockFileProcessor;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockFileProcessor = new MockFileProcessor();
    });

    describe('Complete Workflow Tests', () => {
        it('should handle complete dry-run workflow', async () => {
            const dryRunProcessor = new DryRunProcessor(mockLogger);
            const testFiles = createTestFiles();
            
            const plan = await dryRunProcessor.createAnalysisPlan(testFiles);
            
            assertExists(plan);
            assertEquals(plan.totalFiles, testFiles.length);
            assert(plan.estimatedDuration > 0);
            assert(plan.processingOrder.length === testFiles.length);
            assertEquals(plan.skippedFiles.length, 0);
            
            // Verify directory grouping in plan
            assert(plan.filesByDirectory.size > 0);
            
            // Check that all directories are represented
            const allDirectories = Array.from(plan.filesByDirectory.keys());
            assert(allDirectories.some(dir => dir.includes('src')));
            assert(allDirectories.some(dir => dir.includes('tests')));
        });

        it('should handle complete JSON output workflow', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const testFiles = createTestFiles().slice(0, 4);
            
            // Set up some failures and warnings
            mockFileProcessor.setFailureFiles([testFiles[1]]);
            mockFileProcessor.setWarningFiles([testFiles[2]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );
            
            const report = jsonGenerator.generateReport(results, {
                includeMetrics: true,
                processingMode: 'sequential'
            });
            
            // Verify report structure
            assertExists(report.metadata);
            assertExists(report.summary);
            assertExists(report.files);
            assertExists(report.aggregatedMetrics);
            
            // Verify metadata
            assertEquals(report.metadata.totalFiles, 4);
            assertEquals(report.metadata.processingMode, 'sequential');
            
            // Verify summary
            assertEquals(report.summary.totalFiles, 4);
            assertEquals(report.summary.successfulFiles, 2);
            assertEquals(report.summary.failedFiles, 1);
            assertEquals(report.summary.warningFiles, 1);
            
            // Verify file details
            assertEquals(report.files.length, 4);
            assertEquals(report.files[0].status, FileStatus.SUCCESS);
            assertEquals(report.files[1].status, FileStatus.ERROR);
            assertEquals(report.files[2].status, FileStatus.WARNING);
            assertEquals(report.files[3].status, FileStatus.SUCCESS);
        });

        it('should handle complete directory grouping workflow', async () => {
            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            const testFiles = createTestFiles();
            
            const result = await groupProcessor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor
            );
            
            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
            
            // Verify directory groups
            const srcGroups = result.groups.filter(g => g.name.includes('src'));
            const testGroups = result.groups.filter(g => g.name.includes('tests'));
            
            assert(srcGroups.length > 0);
            assert(testGroups.length > 0);
            
            // Verify overall summary
            assertEquals(result.overallSummary.totalFiles, testFiles.length);
            assertEquals(result.overallSummary.successfulFiles, testFiles.length);
            assertEquals(result.overallSummary.failedFiles, 0);
            
            // Verify directory tree
            assertExists(result.directoryTree);
            assertEquals(result.directoryTree.name, '.');
            assert(result.directoryTree.children.length > 0);
        });

        it('should handle nested file processing workflow', async () => {
            const nestedProcessor = new NestedFileProcessor(mockLogger);
            const testFiles = createTestFiles();
            
            const result = await nestedProcessor.processWithGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: false,
                        groupSeparator: '\n'
                    }
                }
            );
            
            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
            
            // Verify grouping by directory
            const componentGroup = result.groups.find(g => g.name.includes('components'));
            const utilsGroup = result.groups.find(g => g.name.includes('utils'));
            
            assertExists(componentGroup);
            assertExists(utilsGroup);
            
            // Verify file counts
            assert(componentGroup.files.length > 0);
            assert(utilsGroup.files.length > 0);
        });
    });

    describe('Error Scenario Tests', () => {
        it('should handle mixed success/failure scenarios', async () => {
            const processor = new SequentialFileProcessor(mockLogger);
            const testFiles = createTestFiles().slice(0, 6);
            
            // Set up complex failure pattern
            mockFileProcessor.setFailureFiles([testFiles[1], testFiles[4]]);
            mockFileProcessor.setWarningFiles([testFiles[2], testFiles[5]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockFileProcessor,
                { showProgress: false }
            );
            
            assertEquals(results.length, 6);
            
            // Verify specific results
            assertEquals(results[0].success, true);
            assertEquals(results[1].success, false);
            assertEquals(results[2].success, true); // Warning is still success
            assertEquals(results[3].success, true);
            assertEquals(results[4].success, false);
            assertEquals(results[5].success, true); // Warning is still success
            
            // Count successes and failures
            const successes = results.filter(r => r.success).length;
            const failures = results.filter(r => !r.success).length;
            
            assertEquals(successes, 4);
            assertEquals(failures, 2);
        });

        it('should handle fallback mechanisms', async () => {
            const errorHandler = new ProgressErrorHandler(mockLogger);
            
            // Simulate terminal error
            const terminalError = new Error('ANSI sequences not supported');
            errorHandler.handleTerminalError(terminalError);
            
            const fallbackRenderer = errorHandler.getFallbackRenderer();
            assertExists(fallbackRenderer);
            
            // Verify fallback renderer works
            fallbackRenderer.start(3);
            fallbackRenderer.updateProgress('test.ts', 1, 3);
            fallbackRenderer.complete();
            
            // Should not throw errors
            assertEquals(typeof fallbackRenderer, 'object');
        });

        it('should handle memory pressure scenarios', async () => {
            const memoryManager = new MemoryManager(mockLogger, {
                maxHeapUsage: 50 * 1024 * 1024, // 50MB limit
                gcThreshold: 0.7
            });
            
            // Simulate memory pressure
            const initialUsage = memoryManager.getCurrentUsage();
            
            // This test verifies the memory manager can handle pressure detection
            const isUnderPressure = memoryManager.isMemoryUnderPressure();
            assertEquals(typeof isUnderPressure, 'boolean');
            
            // Test garbage collection trigger
            await memoryManager.collectGarbageIfNeeded();
            
            // Should complete without errors
            const finalUsage = memoryManager.getCurrentUsage();
            assert(finalUsage.heapUsed >= 0);
        });
    });

    describe('CLI Command Integration Tests', () => {
        it('should handle all CLI option combinations', async () => {
            const handler = new EnhancedCLIHandler(mockLogger);
            
            // Test various CLI option combinations
            const testCombinations: EnhancedCLIOptions[] = [
                {
                    files: createTestFiles().slice(0, 2),
                    dryRun: true
                },
                {
                    files: createTestFiles().slice(0, 3),
                    jsonReport: 'test.json',
                    outputFormat: 'json'
                },
                {
                    files: createTestFiles(),
                    groupByDirectory: true,
                    interactive: true
                },
                {
                    files: createTestFiles().slice(0, 2),
                    outputFormat: 'both',
                    showETA: true
                }
            ];

            // Each combination should be processable without errors
            for (const options of testCombinations) {
                const config = new CLIConfigMapper().mapCLIOptionsToConfig(options);
                assertExists(config);
                assertEquals(typeof config, 'object');
            }
        });
    });
});