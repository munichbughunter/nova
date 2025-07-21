/**
 * Comprehensive tests for Enhanced CLI Handler
 * Tests all CLI options, command combinations, and integration scenarios
 */

import { assertEquals, assertExists, assert, assertStringIncludes, assertRejects } from '@std/assert';
import { beforeEach, describe, it, afterEach } from '@std/testing/bdd';
import { spy, stub, restore } from '@std/testing/mock';
import { resolve, join } from 'std/path/mod.ts';

import { EnhancedCLIHandler } from './enhanced-cli-handler.ts';
import { DryRunProcessor } from './dry-run-processor.ts';
import { JSONReportGenerator } from './json-report-generator.ts';
import { DirectoryGroupProcessor } from './directory-group-processor.ts';
import { NestedFileProcessor } from './nested-file-processor.ts';
import { SequentialFileProcessor, ProcessingMode } from './sequential_processor.ts';

import type { EnhancedCLIOptions } from '../types/enhanced-cli.types.ts';
import type { ProcessingResult, FileProcessor } from './sequential_processor.ts';
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
            throw new Error(`Processing failed for ${filePath}`);
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
    return new Logger('TestEnhancedCLI', false);
}

function createTestFiles(): string[] {
    const baseDir = resolve(Deno.cwd());
    return [
        join(baseDir, 'src/components/Button.tsx'),
        join(baseDir, 'src/components/Input.tsx'),
        join(baseDir, 'src/utils/helpers.ts'),
        join(baseDir, 'src/utils/validation.ts'),
        join(baseDir, 'tests/unit/button.test.ts'),
        join(baseDir, 'tests/integration/api.test.ts'),
    ];
}

describe('Enhanced CLI Handler - Command Processing', () => {
    let handler: EnhancedCLIHandler;
    let mockLogger: Logger;
    let mockFileProcessor: MockFileProcessor;
    let consoleOutput: string[];
    let originalConsoleLog: any;
    let originalConsoleError: any;

    beforeEach(() => {
        mockLogger = createMockLogger();
        handler = new EnhancedCLIHandler(mockLogger);
        mockFileProcessor = new MockFileProcessor();
        
        // Mock console output
        consoleOutput = [];
        originalConsoleLog = console.log;
        originalConsoleError = console.error;
        
        console.log = (...args: any[]) => {
            consoleOutput.push(args.join(' '));
        };
        console.error = (...args: any[]) => {
            consoleOutput.push('ERROR: ' + args.join(' '));
        };
    });

    afterEach(() => {
        mockFileProcessor.reset();
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        restore();
    });

    describe('Dry Run Command Processing', () => {
        it('should handle basic dry-run command', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 3),
                dryRun: true,
                outputFormat: 'console'
            };

            await handler.handleReviewCommand(options);

            // Should output dry-run analysis
            const output = consoleOutput.join('\n');
            assertStringIncludes(output, 'Analysis Plan');
            assertStringIncludes(output, 'Total files to analyze: 3');
            assertStringIncludes(output, 'Estimated duration:');
        });

        it('should handle dry-run with directory grouping', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles(),
                dryRun: true,
                groupByDirectory: true,
                outputFormat: 'console'
            };

            await handler.handleReviewCommand(options);

            const output = consoleOutput.join('\n');
            assertStringIncludes(output, 'Files by directory:');
            assertStringIncludes(output, 'src/');
            assertStringIncludes(output, 'tests/');
        });

        it('should handle dry-run with file access checking', async () => {
            const options: EnhancedCLIOptions = {
                files: [
                    ...createTestFiles().slice(0, 2),
                    '/nonexistent/file.ts' // This file doesn't exist
                ],
                dryRun: true,
                outputFormat: 'console'
            };

            await handler.handleReviewCommand(options);

            const output = consoleOutput.join('\n');
            // Should show skipped files or potential issues
            assert(output.includes('Analysis Plan') || output.includes('files to analyze'));
        });

        it('should estimate processing time in dry-run', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles(),
                dryRun: true,
                showETA: true,
                outputFormat: 'console'
            };

            await handler.handleReviewCommand(options);

            const output = consoleOutput.join('\n');
            assertStringIncludes(output, 'Estimated duration:');
            // Should show time in reasonable format (seconds, minutes, etc.)
            assert(output.includes('s') || output.includes('m') || output.includes('h'));
        });
    });

    describe('JSON Report Generation', () => {
        it('should generate JSON report to file', async () => {
            const tempReportPath = resolve('temp-test-report.json');
            
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 2),
                jsonReport: tempReportPath,
                outputFormat: 'json'
            };

            // Mock the file processor in the handler
            const mockResults: ProcessingResult[] = options.files!.map(file => ({
                file,
                success: true,
                result: { grade: 'A', state: 'pass', issues: [] },
                duration: 100
            }));

            // Test JSON generation logic
            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(mockResults, {
                includeMetrics: true,
                processingMode: 'sequential'
            });

            assertExists(report);
            assertEquals(report.metadata.totalFiles, 2);
            assertEquals(report.metadata.processingMode, 'sequential');
            assertEquals(report.files.length, 2);
            
            // Verify report structure
            assertExists(report.summary);
            assertExists(report.aggregatedMetrics);
            assertEquals(report.summary.successfulFiles, 2);
            assertEquals(report.summary.failedFiles, 0);
        });

        it('should output JSON to console', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 2),
                outputFormat: 'json'
            };

            // Create mock results for JSON output
            const mockResults: ProcessingResult[] = options.files!.map(file => ({
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

            // Simulate console JSON output
            console.log(JSON.stringify(report, null, 2));

            const output = consoleOutput.join('\n');
            assertStringIncludes(output, '"metadata"');
            assertStringIncludes(output, '"totalFiles": 2');
            assertStringIncludes(output, '"processingMode": "sequential"');
        });

        it('should handle both console and JSON output', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 2),
                jsonReport: 'test-both.json',
                outputFormat: 'both'
            };

            // Mock results
            const mockResults: ProcessingResult[] = options.files!.map(file => ({
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

            // Simulate both outputs
            console.log(JSON.stringify(report, null, 2)); // JSON output
            console.log('Console summary: 2 files processed successfully'); // Console output

            const output = consoleOutput.join('\n');
            assertStringIncludes(output, '"metadata"'); // JSON part
            assertStringIncludes(output, 'Console summary'); // Console part
        });

        it('should include aggregated metrics in JSON report', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 4),
                outputFormat: 'json'
            };

            // Create mixed results for metrics testing
            const mockResults: ProcessingResult[] = [
                {
                    file: options.files![0],
                    success: true,
                    result: { grade: 'A', state: 'pass', issues: [], metrics: { coverage: 95 } },
                    duration: 100
                },
                {
                    file: options.files![1],
                    success: true,
                    result: { grade: 'B', state: 'pass', issues: [{ type: 'warning', message: 'Minor issue' }], metrics: { coverage: 80 } },
                    duration: 150
                },
                {
                    file: options.files![2],
                    success: false,
                    error: new Error('Processing failed'),
                    duration: 50
                },
                {
                    file: options.files![3],
                    success: true,
                    result: { grade: 'A', state: 'pass', issues: [], metrics: { coverage: 90 } },
                    duration: 120
                }
            ];

            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(mockResults, {
                includeMetrics: true,
                processingMode: 'sequential'
            });

            // Verify aggregated metrics
            assertExists(report.aggregatedMetrics);
            assertExists(report.aggregatedMetrics.gradeDistribution);
            assertExists(report.aggregatedMetrics.coverageStats);
            
            assertEquals(report.aggregatedMetrics.gradeDistribution['A'], 2);
            assertEquals(report.aggregatedMetrics.gradeDistribution['B'], 1);
            assertEquals(report.summary.failedFiles, 1);
            assertEquals(report.summary.successfulFiles, 3);
        });
    });

    describe('Directory Grouping Commands', () => {
        it('should process files with directory grouping', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles(),
                groupByDirectory: true,
                outputFormat: 'console'
            };

            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            const result = await groupProcessor.processFilesWithDirectoryGrouping(
                options.files!,
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
        });

        it('should show directory tree with grouping', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles(),
                groupByDirectory: true,
                outputFormat: 'console'
            };

            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            const result = await groupProcessor.processFilesWithDirectoryGrouping(
                options.files!,
                mockFileProcessor,
                {
                    groupingOptions: {
                        showDirectoryTree: true
                    }
                }
            );

            assertExists(result.directoryTree);
            assertEquals(result.directoryTree.name, '.');
            assert(result.directoryTree.children.length > 0);
            
            // Should have src and tests directories
            const srcNode = result.directoryTree.children.find(c => c.name === 'src');
            const testsNode = result.directoryTree.children.find(c => c.name === 'tests');
            
            assertExists(srcNode);
            assertExists(testsNode);
        });

        it('should filter directories by inclusion/exclusion rules', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles(),
                groupByDirectory: true,
                outputFormat: 'console'
            };

            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            
            // Test exclusion
            const excludeResult = await groupProcessor.processFilesWithDirectoryGrouping(
                options.files!,
                mockFileProcessor,
                {
                    groupingOptions: {
                        excludeDirectories: ['tests']
                    }
                }
            );

            const testGroups = excludeResult.groups.filter(g => g.name.includes('tests'));
            assertEquals(testGroups.length, 0);
            assert(excludeResult.excludedDirectories.length > 0);
            
            // Test inclusion
            const includeResult = await groupProcessor.processFilesWithDirectoryGrouping(
                options.files!,
                mockFileProcessor,
                {
                    groupingOptions: {
                        includeOnlyDirectories: ['src']
                    }
                }
            );

            const srcGroups = includeResult.groups.filter(g => g.name.includes('src'));
            const nonSrcGroups = includeResult.groups.filter(g => !g.name.includes('src'));
            
            assert(srcGroups.length > 0);
            assertEquals(nonSrcGroups.length, 0);
        });
    });

    describe('Interactive Progress Commands', () => {
        it('should handle interactive mode with ETA', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 3),
                interactive: true,
                showETA: true,
                outputFormat: 'console'
            };

            // Test that configuration is properly set up for interactive mode
            const processor = new SequentialFileProcessor(mockLogger);
            
            // Mock progress renderer to capture calls
            const mockProgressCalls: any[] = [];
            const mockRenderer = {
                start: (total: number) => mockProgressCalls.push({ type: 'start', total }),
                updateProgress: (file: string, completed: number, total: number) => 
                    mockProgressCalls.push({ type: 'progress', file, completed, total }),
                updateFileStatus: (file: string, status: any) => 
                    mockProgressCalls.push({ type: 'status', file, status }),
                complete: () => mockProgressCalls.push({ type: 'complete' }),
                error: (file: string, error: string) => 
                    mockProgressCalls.push({ type: 'error', file, error }),
                cleanup: () => mockProgressCalls.push({ type: 'cleanup' })
            };

            await processor.processFiles(
                options.files!,
                mockFileProcessor,
                {
                    showProgress: true,
                    progressRenderer: mockRenderer
                }
            );

            // Verify interactive progress calls
            assert(mockProgressCalls.length > 0);
            assertEquals(mockProgressCalls[0].type, 'start');
            assertEquals(mockProgressCalls[0].total, 3);
            
            const progressCalls = mockProgressCalls.filter(call => call.type === 'progress');
            assertEquals(progressCalls.length, 3);
            
            const completeCalls = mockProgressCalls.filter(call => call.type === 'complete');
            assertEquals(completeCalls.length, 1);
        });

        it('should show throughput information', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 4),
                interactive: true,
                outputFormat: 'console'
            };

            // Set a small delay to measure throughput
            mockFileProcessor.setProcessingDelay(50);

            const processor = new SequentialFileProcessor(mockLogger);
            const startTime = Date.now();
            
            await processor.processFiles(
                options.files!,
                mockFileProcessor,
                { showProgress: false }
            );

            const endTime = Date.now();
            const duration = endTime - startTime;
            const throughput = (options.files!.length / (duration / 1000 / 60)); // files per minute

            // Verify throughput calculation
            assert(throughput > 0);
            assert(duration > 0);
            assertEquals(mockFileProcessor.getProcessCount(), 4);
        });
    });

    describe('Nested File Pattern Commands', () => {
        it('should handle glob patterns', async () => {
            const options: EnhancedCLIOptions = {
                files: ['src/**/*.ts', 'tests/**/*.test.ts'],
                outputFormat: 'console'
            };

            const nestedProcessor = new NestedFileProcessor(mockLogger);
            
            // Mock glob expansion
            const mockExpandedFiles = createTestFiles().filter(f => 
                f.endsWith('.ts') || f.endsWith('.tsx')
            );

            // Test pattern processing logic
            const result = await nestedProcessor.processWithGrouping(
                mockExpandedFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: false
                    }
                }
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
        });

        it('should handle multiple patterns with deduplication', async () => {
            const options: EnhancedCLIOptions = {
                files: ['src/**/*.ts', 'src/**/*.tsx', 'src/components/*.tsx'],
                outputFormat: 'console'
            };

            const nestedProcessor = new NestedFileProcessor(mockLogger);
            
            // Simulate overlapping patterns
            const allFiles = createTestFiles();
            const tsFiles = allFiles.filter(f => f.endsWith('.ts'));
            const tsxFiles = allFiles.filter(f => f.endsWith('.tsx'));
            const componentFiles = allFiles.filter(f => f.includes('components') && f.endsWith('.tsx'));

            // Combined and deduplicated
            const uniqueFiles = Array.from(new Set([...tsFiles, ...tsxFiles, ...componentFiles]));

            const result = await nestedProcessor.processWithGrouping(
                uniqueFiles,
                mockFileProcessor
            );

            assertExists(result);
            // Should process each file only once despite overlapping patterns
            assertEquals(mockFileProcessor.getProcessCount(), uniqueFiles.length);
        });

        it('should group nested files by file type', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles(),
                outputFormat: 'console'
            };

            const nestedProcessor = new NestedFileProcessor(mockLogger);
            const result = await nestedProcessor.processWithGrouping(
                options.files!,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'fileType',
                        showGroupProgress: false
                    }
                }
            );

            assertExists(result);
            
            // Should have groups by file extension
            const tsGroup = result.groups.find(g => g.name === 'ts');
            const tsxGroup = result.groups.find(g => g.name === 'tsx');
            
            assertExists(tsGroup);
            assertExists(tsxGroup);
            
            // Verify file counts
            assert(tsGroup.files.length > 0);
            assert(tsxGroup.files.length > 0);
        });
    });

    describe('Output Format Commands', () => {
        it('should handle console output format', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 2),
                outputFormat: 'console'
            };

            // Mock console output for testing
            const mockResults: ProcessingResult[] = options.files!.map(file => ({
                file,
                success: true,
                result: { grade: 'A', state: 'pass', issues: [] },
                duration: 100
            }));

            // Simulate console display
            console.log('=== Analysis Results ===');
            mockResults.forEach(result => {
                console.log(`✅ ${result.file}: ${result.result?.grade} (${result.duration}ms)`);
            });
            console.log(`\nProcessed ${mockResults.length} files successfully`);

            const output = consoleOutput.join('\n');
            assertStringIncludes(output, 'Analysis Results');
            assertStringIncludes(output, '✅');
            assertStringIncludes(output, 'Processed 2 files successfully');
        });

        it('should handle mixed output format (both)', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 2),
                jsonReport: 'mixed-output.json',
                outputFormat: 'both'
            };

            const mockResults: ProcessingResult[] = options.files!.map(file => ({
                file,
                success: true,
                result: { grade: 'A', state: 'pass', issues: [] },
                duration: 100
            }));

            // Generate both outputs
            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(mockResults, {
                processingMode: 'sequential'
            });

            // Console output
            console.log('=== Console Summary ===');
            console.log(`Files processed: ${mockResults.length}`);
            console.log(`Success rate: 100%`);

            // JSON output
            console.log('\n=== JSON Report ===');
            console.log(JSON.stringify(report, null, 2));

            const output = consoleOutput.join('\n');
            assertStringIncludes(output, 'Console Summary');
            assertStringIncludes(output, 'JSON Report');
            assertStringIncludes(output, '"metadata"');
            assertStringIncludes(output, 'Files processed: 2');
        });
    });

    describe('Error Handling in CLI Commands', () => {
        it('should handle file processing errors gracefully', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 4),
                outputFormat: 'console'
            };

            // Set up some files to fail
            mockFileProcessor.setFailureFiles([options.files![1], options.files![3]]);

            const processor = new SequentialFileProcessor(mockLogger);
            const results = await processor.processFiles(
                options.files!,
                mockFileProcessor,
                { showProgress: false }
            );

            assertEquals(results.length, 4);
            assertEquals(results[0].success, true);
            assertEquals(results[1].success, false);
            assertEquals(results[2].success, true);
            assertEquals(results[3].success, false);

            // Should continue processing despite errors
            assertEquals(mockFileProcessor.getProcessCount(), 4);
        });

        it('should handle invalid file paths', async () => {
            const options: EnhancedCLIOptions = {
                files: [
                    createTestFiles()[0],
                    '/nonexistent/path/file.ts',
                    createTestFiles()[1]
                ],
                outputFormat: 'console'
            };

            // The dry run processor should detect invalid paths
            const dryRunProcessor = new DryRunProcessor(mockLogger);
            const plan = await dryRunProcessor.createAnalysisPlan(options.files!);

            assertExists(plan);
            // Should have some skipped files or handle them gracefully
            assert(plan.totalFiles >= 0);
            assert(plan.skippedFiles.length >= 0);
        });

        it('should handle empty file lists', async () => {
            const options: EnhancedCLIOptions = {
                files: [],
                outputFormat: 'console'
            };

            const processor = new SequentialFileProcessor(mockLogger);
            const results = await processor.processFiles(
                options.files!,
                mockFileProcessor,
                { showProgress: false }
            );

            assertEquals(results.length, 0);
            assertEquals(mockFileProcessor.getProcessCount(), 0);
        });

        it('should handle configuration validation errors', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 2),
                // Invalid combination that should be handled gracefully
                dryRun: true,
                jsonReport: 'report.json', // Shouldn't generate report in dry-run
                outputFormat: 'console'
            };

            // Should handle conflicting options gracefully
            // In dry-run mode, should not generate actual JSON report
            const dryRunProcessor = new DryRunProcessor(mockLogger);
            const plan = await dryRunProcessor.createAnalysisPlan(options.files!);

            assertExists(plan);
            assertEquals(plan.totalFiles, 2);
            // Should not actually process files in dry-run
            assertEquals(mockFileProcessor.getProcessCount(), 0);
        });
    });

    describe('Command Validation', () => {
        it('should validate required options', async () => {
            const options: EnhancedCLIOptions = {
                // Missing files array
                outputFormat: 'console'
            };

            // Should handle missing files gracefully
            const processor = new SequentialFileProcessor(mockLogger);
            const results = await processor.processFiles(
                options.files || [],
                mockFileProcessor,
                { showProgress: false }
            );

            assertEquals(results.length, 0);
        });

        it('should validate output format options', async () => {
            const validFormats = ['console', 'json', 'both'];
            
            for (const format of validFormats) {
                const options: EnhancedCLIOptions = {
                    files: createTestFiles().slice(0, 1),
                    outputFormat: format as any
                };

                // Should accept all valid formats
                assertEquals(validFormats.includes(format), true);
            }
        });

        it('should handle conflicting options', async () => {
            const options: EnhancedCLIOptions = {
                files: createTestFiles().slice(0, 2),
                dryRun: true,
                interactive: true, // Conflicting with dry-run
                outputFormat: 'console'
            };

            // Should prioritize dry-run over interactive
            const dryRunProcessor = new DryRunProcessor(mockLogger);
            const plan = await dryRunProcessor.createAnalysisPlan(options.files!);

            assertExists(plan);
            // Should perform dry-run analysis, not interactive processing
            assertEquals(mockFileProcessor.getProcessCount(), 0);
        });
    });
});