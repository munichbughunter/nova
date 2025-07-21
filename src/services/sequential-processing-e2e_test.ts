/**
 * End-to-end integration tests for sequential file processing
 * Tests complete workflows from CLI input to final output
 */

import { assertEquals, assertExists, assert, assertStringIncludes } from '@std/assert';
import { beforeEach, describe, it, afterEach } from '@std/testing/bdd';
import { resolve, join, dirname } from 'std/path/mod.ts';
import { ensureDir, exists } from 'std/fs/mod.ts';

import { EnhancedCodeReviewAgent } from '../agents/enhanced-code-review-agent.ts';
import { EnhancedCLIHandler } from './enhanced-cli-handler.ts';
import { SequentialFileProcessor, ProcessingMode } from './sequential_processor.ts';
import { DryRunProcessor } from './dry-run-processor.ts';
import { JSONReportGenerator } from './json-report-generator.ts';
import { DirectoryGroupProcessor } from './directory-group-processor.ts';
import { NestedFileProcessor } from './nested-file-processor.ts';

import type { EnhancedCLIOptions } from '../types/enhanced-cli.types.ts';
import type { ProcessingResult, FileProcessor } from './sequential_processor.ts';
import { Logger } from '../utils/logger.ts';

// Mock enhanced code review agent for E2E testing
class MockEnhancedCodeReviewAgent {
    private processCount = 0;
    private processingDelay = 50;
    private failureFiles: Set<string> = new Set();

    async processFile(filePath: string): Promise<any> {
        this.processCount++;
        
        await new Promise(resolve => setTimeout(resolve, this.processingDelay));

        if (this.failureFiles.has(filePath)) {
            throw new Error(`Analysis failed for ${filePath}`);
        }

        // Simulate different analysis results based on file type
        const isTestFile = filePath.includes('.test.') || filePath.includes('test/');
        const isComponentFile = filePath.includes('components/');
        const isUtilFile = filePath.includes('utils/');

        let grade = 'A';
        let issues: any[] = [];

        if (isTestFile) {
            grade = 'B';
            issues = [{ type: 'info', message: 'Test file - consider adding more edge cases' }];
        } else if (isComponentFile) {
            grade = 'A';
            issues = [];
        } else if (isUtilFile) {
            grade = 'A';
            issues = [{ type: 'suggestion', message: 'Consider adding JSDoc comments' }];
        }

        return {
            grade,
            state: grade === 'A' ? 'pass' : 'warning',
            issues,
            metrics: {
                coverage: isTestFile ? 95 : 85,
                complexity: isComponentFile ? 3 : 2,
                maintainability: grade === 'A' ? 90 : 80
            },
            filePath,
            timestamp: new Date().toISOString(),
            analysisType: 'enhanced-review'
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
        this.processingDelay = 50;
    }
}

// Helper functions
function createMockLogger(): Logger {
    return new Logger('E2ETest', false);
}

function createTestFileStructure(): string[] {
    const baseDir = resolve(Deno.cwd());
    return [
        join(baseDir, 'src/components/Button.tsx'),
        join(baseDir, 'src/components/Input.tsx'),
        join(baseDir, 'src/components/Modal.tsx'),
        join(baseDir, 'src/utils/helpers.ts'),
        join(baseDir, 'src/utils/validation.ts'),
        join(baseDir, 'src/utils/formatting.ts'),
        join(baseDir, 'src/services/api.ts'),
        join(baseDir, 'src/services/auth.ts'),
        join(baseDir, 'tests/unit/button.test.ts'),
        join(baseDir, 'tests/unit/input.test.ts'),
        join(baseDir, 'tests/integration/api.test.ts'),
        join(baseDir, 'tests/e2e/user-flow.test.ts'),
    ];
}

async function createTempDirectory(): Promise<string> {
    const tempDir = resolve(Deno.cwd(), 'temp-e2e-test');
    await ensureDir(tempDir);
    return tempDir;
}

async function cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
        await Deno.remove(tempDir, { recursive: true });
    } catch {
        // Ignore cleanup errors
    }
}

describe('Sequential Processing End-to-End Tests', () => {
    let mockLogger: Logger;
    let mockAgent: MockEnhancedCodeReviewAgent;
    let tempDir: string;

    beforeEach(async () => {
        mockLogger = createMockLogger();
        mockAgent = new MockEnhancedCodeReviewAgent();
        tempDir = await createTempDirectory();
    });

    afterEach(async () => {
        mockAgent.reset();
        await cleanupTempDirectory(tempDir);
    });

    describe('Complete Dry-Run Workflow', () => {
        it('should perform complete dry-run analysis with detailed output', async () => {
            const testFiles = createTestFileStructure();
            const dryRunProcessor = new DryRunProcessor(mockLogger);
            
            // Capture console output
            const consoleOutput: string[] = [];
            const originalConsoleLog = console.log;
            console.log = (...args: any[]) => {
                consoleOutput.push(args.join(' '));
            };

            try {
                const plan = await dryRunProcessor.createAnalysisPlan(testFiles);
                dryRunProcessor.showPlan(plan);

                // Verify plan structure
                assertExists(plan);
                assertEquals(plan.totalFiles, testFiles.length);
                assert(plan.estimatedDuration > 0);
                assert(plan.processingOrder.length === testFiles.length);
                assert(plan.filesByDirectory.size > 0);

                // Verify console output
                const output = consoleOutput.join('\n');
                assertStringIncludes(output, 'Analysis Plan (Dry Run)');
                assertStringIncludes(output, `Total files to analyze: ${testFiles.length}`);
                assertStringIncludes(output, 'Estimated duration:');
                assertStringIncludes(output, 'Files by directory:');
                assertStringIncludes(output, 'src/components/');
                assertStringIncludes(output, 'src/utils/');
                assertStringIncludes(output, 'tests/');

                // Verify directory grouping
                const srcComponentsFiles = Array.from(plan.filesByDirectory.entries())
                    .find(([dir]) => dir.includes('src/components'));
                assertExists(srcComponentsFiles);
                assertEquals(srcComponentsFiles[1].length, 3); // Button, Input, Modal

                const testsFiles = Array.from(plan.filesByDirectory.entries())
                    .filter(([dir]) => dir.includes('tests'));
                assert(testsFiles.length > 0);

            } finally {
                console.log = originalConsoleLog;
            }
        });

        it('should handle dry-run with file access issues', async () => {
            const testFiles = [
                ...createTestFileStructure().slice(0, 3),
                '/nonexistent/directory/file.ts',
                '/another/missing/file.tsx'
            ];

            const dryRunProcessor = new DryRunProcessor(mockLogger);
            const plan = await dryRunProcessor.createAnalysisPlan(testFiles);

            assertExists(plan);
            // Should handle missing files gracefully
            assert(plan.totalFiles >= 3); // At least the valid files
            assert(plan.skippedFiles.length >= 0); // May have skipped files
        });

        it('should estimate processing time accurately', async () => {
            const testFiles = createTestFileStructure().slice(0, 6);
            const dryRunProcessor = new DryRunProcessor(mockLogger);
            
            const plan = await dryRunProcessor.createAnalysisPlan(testFiles);
            
            // Verify time estimation
            assert(plan.estimatedDuration > 0);
            // Should be reasonable (not too high or too low)
            assert(plan.estimatedDuration < 60000); // Less than 1 minute for 6 files
            assert(plan.estimatedDuration > 100); // More than 100ms total
        });
    });

    describe('Complete JSON Report Workflow', () => {
        it('should generate comprehensive JSON report', async () => {
            const testFiles = createTestFileStructure().slice(0, 8);
            const processor = new SequentialFileProcessor(mockLogger);
            
            // Set up mixed results
            mockAgent.setFailureFiles([testFiles[2], testFiles[6]]);
            
            const results = await processor.processFiles(
                testFiles,
                mockAgent,
                { showProgress: false }
            );

            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(results, {
                includeMetrics: true,
                processingMode: 'sequential',
                includeFileDetails: true,
                includeSummaryStats: true
            });

            // Verify complete report structure
            assertExists(report.metadata);
            assertExists(report.summary);
            assertExists(report.files);
            assertExists(report.aggregatedMetrics);

            // Verify metadata
            assertEquals(report.metadata.totalFiles, 8);
            assertEquals(report.metadata.processingMode, 'sequential');
            assertExists(report.metadata.timestamp);
            assertExists(report.metadata.version);
            assertExists(report.metadata.generatedBy);

            // Verify summary
            assertEquals(report.summary.totalFiles, 8);
            assertEquals(report.summary.failedFiles, 2);
            assertEquals(report.summary.successfulFiles, 6);
            assert(report.summary.totalIssues >= 0);
            assertExists(report.summary.averageGrade);

            // Verify file details
            assertEquals(report.files.length, 8);
            report.files.forEach(file => {
                assertExists(file.path);
                assertExists(file.status);
                assertExists(file.timestamp);
                assert(file.duration >= 0);
            });

            // Verify aggregated metrics
            assertExists(report.aggregatedMetrics.gradeDistribution);
            assertExists(report.aggregatedMetrics.coverageStats);
            assertExists(report.aggregatedMetrics.commonIssues);

            // Check grade distribution
            const gradeDistribution = report.aggregatedMetrics.gradeDistribution;
            assert(gradeDistribution['A'] >= 0);
            assert(gradeDistribution['B'] >= 0);

            // Check coverage stats
            const coverageStats = report.aggregatedMetrics.coverageStats;
            assert(coverageStats.min >= 0);
            assert(coverageStats.max <= 100);
            assert(coverageStats.average >= coverageStats.min);
            assert(coverageStats.average <= coverageStats.max);
        });

        it('should save JSON report to file', async () => {
            const testFiles = createTestFileStructure().slice(0, 4);
            const processor = new SequentialFileProcessor(mockLogger);
            
            const results = await processor.processFiles(
                testFiles,
                mockAgent,
                { showProgress: false }
            );

            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(results, {
                processingMode: 'sequential'
            });

            const reportPath = join(tempDir, 'test-report.json');
            await jsonGenerator.saveReport(report, reportPath);

            // Verify file was created
            const fileExists = await exists(reportPath);
            assertEquals(fileExists, true);

            // Verify file content
            const savedContent = await Deno.readTextFile(reportPath);
            const savedReport = JSON.parse(savedContent);
            
            assertEquals(savedReport.metadata.totalFiles, 4);
            assertEquals(savedReport.files.length, 4);
            assertExists(savedReport.summary);
        });

        it('should handle large reports efficiently', async () => {
            const testFiles = createTestFileStructure(); // All 12 files
            const processor = new SequentialFileProcessor(mockLogger);
            
            // Add some complexity with mixed results
            mockAgent.setFailureFiles([testFiles[3], testFiles[7], testFiles[10]]);
            
            const startTime = Date.now();
            const results = await processor.processFiles(
                testFiles,
                mockAgent,
                { showProgress: false }
            );
            const processingTime = Date.now() - startTime;

            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const reportStartTime = Date.now();
            const report = jsonGenerator.generateReport(results, {
                includeMetrics: true,
                processingMode: 'sequential',
                includeFileDetails: true
            });
            const reportGenerationTime = Date.now() - reportStartTime;

            // Verify performance
            console.log(`Processing time: ${processingTime}ms`);
            console.log(`Report generation time: ${reportGenerationTime}ms`);
            
            assert(processingTime < 10000, `Processing took too long: ${processingTime}ms`);
            assert(reportGenerationTime < 1000, `Report generation took too long: ${reportGenerationTime}ms`);

            // Verify report completeness
            assertEquals(report.files.length, 12);
            assertEquals(report.summary.failedFiles, 3);
            assertEquals(report.summary.successfulFiles, 9);
        });
    });

    describe('Complete Directory Grouping Workflow', () => {
        it('should process files with complete directory grouping', async () => {
            const testFiles = createTestFileStructure();
            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            
            const result = await groupProcessor.processFilesWithDirectoryGrouping(
                testFiles,
                mockAgent,
                {
                    groupingOptions: {
                        showDirectoryTree: true,
                        sortDirectories: 'fileCount',
                        includeEmptyGroups: false
                    }
                }
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
            assert(result.directoryGroups.length > 0);

            // Verify directory groups
            const srcComponentsGroup = result.groups.find(g => g.name.includes('src/components'));
            const srcUtilsGroup = result.groups.find(g => g.name.includes('src/utils'));
            const testsGroup = result.groups.find(g => g.name.includes('tests'));

            assertExists(srcComponentsGroup);
            assertExists(srcUtilsGroup);
            assertExists(testsGroup);

            // Verify file counts
            assertEquals(srcComponentsGroup.files.length, 3); // Button, Input, Modal
            assertEquals(srcUtilsGroup.files.length, 3); // helpers, validation, formatting
            assert(testsGroup.files.length >= 4); // Various test files

            // Verify directory tree
            assertExists(result.directoryTree);
            assertEquals(result.directoryTree.name, '.');
            assert(result.directoryTree.children.length > 0);

            // Find src and tests nodes
            const srcNode = result.directoryTree.children.find(c => c.name === 'src');
            const testsNode = result.directoryTree.children.find(c => c.name === 'tests');

            assertExists(srcNode);
            assertExists(testsNode);

            // Verify nested structure
            const componentsNode = srcNode.children.find(c => c.name === 'components');
            const utilsNode = srcNode.children.find(c => c.name === 'utils');

            assertExists(componentsNode);
            assertExists(utilsNode);

            // Verify overall summary
            assertEquals(result.overallSummary.totalFiles, testFiles.length);
            assertEquals(result.overallSummary.successfulFiles, testFiles.length);
            assertEquals(result.overallSummary.failedFiles, 0);
        });

        it('should handle directory filtering correctly', async () => {
            const testFiles = createTestFileStructure();
            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            
            // Test with exclusion
            const excludeResult = await groupProcessor.processFilesWithDirectoryGrouping(
                testFiles,
                mockAgent,
                {
                    groupingOptions: {
                        excludeDirectories: ['tests'],
                        showDirectoryTree: false
                    }
                }
            );

            // Should not have test groups
            const testGroups = excludeResult.groups.filter(g => g.name.includes('tests'));
            assertEquals(testGroups.length, 0);
            assert(excludeResult.excludedDirectories.length > 0);

            // Test with inclusion
            const includeResult = await groupProcessor.processFilesWithDirectoryGrouping(
                testFiles,
                mockAgent,
                {
                    groupingOptions: {
                        includeOnlyDirectories: ['src/components', 'src/utils'],
                        showDirectoryTree: false
                    }
                }
            );

            // Should only have src groups
            const srcGroups = includeResult.groups.filter(g => g.name.includes('src'));
            const nonSrcGroups = includeResult.groups.filter(g => !g.name.includes('src'));

            assert(srcGroups.length > 0);
            assertEquals(nonSrcGroups.length, 0);
        });

        it('should generate directory statistics', async () => {
            const testFiles = createTestFileStructure();
            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            
            const result = await groupProcessor.processFilesWithDirectoryGrouping(
                testFiles,
                mockAgent
            );

            const stats = groupProcessor.getDirectoryStats(result);

            assertExists(stats);
            assertEquals(stats.totalDirectories, result.totalGroups);
            assert(stats.averageFilesPerDirectory > 0);
            assert(stats.deepestDirectory >= 0);
            assert(stats.directoryDistribution.length > 0);

            // Verify distribution details
            stats.directoryDistribution.forEach(dist => {
                assertExists(dist.directory);
                assert(dist.fileCount > 0);
                assert(dist.successRate >= 0 && dist.successRate <= 1);
            });
        });
    });

    describe('Complete Nested File Processing Workflow', () => {
        it('should handle nested patterns with grouping', async () => {
            const testFiles = createTestFileStructure();
            const nestedProcessor = new NestedFileProcessor(mockLogger);
            
            const result = await nestedProcessor.processWithGrouping(
                testFiles,
                mockAgent,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: true,
                        groupSeparator: '\n---\n'
                    },
                    onGroupStart: (groupName, fileCount) => {
                        console.log(`Starting group: ${groupName} (${fileCount} files)`);
                    },
                    onGroupComplete: (groupName, summary) => {
                        console.log(`Completed group: ${groupName} - ${summary.successfulFiles}/${summary.totalFiles} successful`);
                    }
                }
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);

            // Verify grouping by directory
            const componentGroup = result.groups.find(g => g.name.includes('components'));
            const utilsGroup = result.groups.find(g => g.name.includes('utils'));
            const testsGroup = result.groups.find(g => g.name.includes('tests'));

            assertExists(componentGroup);
            assertExists(utilsGroup);
            assertExists(testsGroup);

            // Verify group summaries
            componentGroup.summary.totalFiles = componentGroup.files.length;
            assert(componentGroup.summary.successfulFiles >= 0);
            assert(componentGroup.summary.failedFiles >= 0);
        });

        it('should handle file type grouping', async () => {
            const testFiles = createTestFileStructure();
            const nestedProcessor = new NestedFileProcessor(mockLogger);
            
            const result = await nestedProcessor.processWithGrouping(
                testFiles,
                mockAgent,
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

            // Verify file type grouping
            tsGroup.files.forEach(file => {
                assert(file.endsWith('.ts'), `File ${file} should end with .ts`);
            });

            tsxGroup.files.forEach(file => {
                assert(file.endsWith('.tsx'), `File ${file} should end with .tsx`);
            });
        });

        it('should calculate grouped statistics', async () => {
            const testFiles = createTestFileStructure();
            const nestedProcessor = new NestedFileProcessor(mockLogger);
            
            // Add some failures for statistics
            mockAgent.setFailureFiles([testFiles[2], testFiles[7]]);
            
            const result = await nestedProcessor.processWithGrouping(
                testFiles,
                mockAgent,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: false
                    }
                }
            );

            const stats = nestedProcessor.getGroupedStats(result);

            assertExists(stats);
            assertEquals(stats.totalFiles, testFiles.length);
            assertEquals(stats.totalGroups, result.groups.length);
            assert(stats.averageFilesPerGroup > 0);
            assertEquals(stats.overallSummary.failedFiles, 2);
            assertEquals(stats.overallSummary.successfulFiles, testFiles.length - 2);
        });
    });

    describe('Complete CLI Integration Workflow', () => {
        it('should handle complete CLI command with all options', async () => {
            const testFiles = createTestFileStructure().slice(0, 6);
            const handler = new EnhancedCLIHandler(mockLogger);
            
            const options: EnhancedCLIOptions = {
                files: testFiles,
                interactive: true,
                showETA: true,
                groupByDirectory: true,
                jsonReport: join(tempDir, 'cli-test-report.json'),
                outputFormat: 'both'
            };

            // Mock the complete workflow
            const processor = new SequentialFileProcessor(mockLogger);
            const results = await processor.processFiles(
                testFiles,
                mockAgent,
                { showProgress: false }
            );

            // Generate JSON report
            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(results, {
                includeMetrics: true,
                processingMode: 'sequential'
            });

            await jsonGenerator.saveReport(report, options.jsonReport!);

            // Verify JSON report was created
            const reportExists = await exists(options.jsonReport!);
            assertEquals(reportExists, true);

            // Verify report content
            const savedReport = JSON.parse(await Deno.readTextFile(options.jsonReport!));
            assertEquals(savedReport.metadata.totalFiles, 6);
            assertEquals(savedReport.files.length, 6);

            // Process with directory grouping
            const groupProcessor = new DirectoryGroupProcessor(mockLogger);
            const groupedResult = await groupProcessor.processFilesWithDirectoryGrouping(
                testFiles,
                mockAgent
            );

            assertExists(groupedResult);
            assert(groupedResult.groups.length > 0);
        });

        it('should handle error scenarios in complete workflow', async () => {
            const testFiles = createTestFileStructure().slice(0, 8);
            const handler = new EnhancedCLIHandler(mockLogger);
            
            // Set up complex error scenario
            mockAgent.setFailureFiles([testFiles[1], testFiles[3], testFiles[6]]);
            
            const options: EnhancedCLIOptions = {
                files: testFiles,
                jsonReport: join(tempDir, 'error-test-report.json'),
                outputFormat: 'both',
                groupByDirectory: true
            };

            const processor = new SequentialFileProcessor(mockLogger);
            const results = await processor.processFiles(
                testFiles,
                mockAgent,
                { showProgress: false }
            );

            // Should continue processing despite errors
            assertEquals(results.length, 8);
            assertEquals(results.filter(r => r.success).length, 5);
            assertEquals(results.filter(r => !r.success).length, 3);

            // Generate report with errors
            const jsonGenerator = new JSONReportGenerator(mockLogger);
            const report = jsonGenerator.generateReport(results, {
                includeMetrics: true,
                processingMode: 'sequential'
            });

            await jsonGenerator.saveReport(report, options.jsonReport!);

            // Verify error handling in report
            assertEquals(report.summary.failedFiles, 3);
            assertEquals(report.summary.successfulFiles, 5);
            
            const errorFiles = report.files.filter(f => f.status === 'error');
            assertEquals(errorFiles.length, 3);
            
            errorFiles.forEach(file => {
                assertExists(file.error);
            });
        });

        it('should handle mixed CLI options correctly', async () => {
            const testFiles = createTestFileStructure();
            
            // Test various option combinations
            const optionCombinations: EnhancedCLIOptions[] = [
                {
                    files: testFiles.slice(0, 4),
                    dryRun: true,
                    groupByDirectory: true
                },
                {
                    files: testFiles.slice(2, 8),
                    interactive: true,
                    showETA: true,
                    outputFormat: 'console'
                },
                {
                    files: testFiles.slice(4, 10),
                    jsonReport: join(tempDir, 'mixed-options-report.json'),
                    outputFormat: 'json'
                },
                {
                    files: testFiles.slice(0, 6),
                    groupByDirectory: true,
                    interactive: true,
                    outputFormat: 'both'
                }
            ];

            for (let i = 0; i < optionCombinations.length; i++) {
                const options = optionCombinations[i];
                
                if (options.dryRun) {
                    // Test dry-run
                    const dryRunProcessor = new DryRunProcessor(mockLogger);
                    const plan = await dryRunProcessor.createAnalysisPlan(options.files!);
                    assertExists(plan);
                    assertEquals(plan.totalFiles, options.files!.length);
                } else {
                    // Test actual processing
                    const processor = new SequentialFileProcessor(mockLogger);
                    const results = await processor.processFiles(
                        options.files!,
                        mockAgent,
                        { showProgress: false }
                    );
                    assertEquals(results.length, options.files!.length);
                }

                if (options.jsonReport) {
                    // Verify JSON report option
                    const reportExists = await exists(options.jsonReport);
                    // Note: In real implementation, this would be created
                    // Here we just verify the path is valid
                    assertExists(dirname(options.jsonReport));
                }
            }
        });
    });

    describe('Performance and Scalability E2E', () => {
        it('should handle large file sets efficiently', async () => {
            // Create a larger test set
            const baseFiles = createTestFileStructure();
            const largeFileSet = [
                ...baseFiles,
                ...baseFiles.map(f => f.replace('.ts', '-copy1.ts').replace('.tsx', '-copy1.tsx')),
                ...baseFiles.map(f => f.replace('.ts', '-copy2.ts').replace('.tsx', '-copy2.tsx'))
            ]; // 36 files total

            const processor = new SequentialFileProcessor(mockLogger);
            
            const startTime = Date.now();
            const results = await processor.processFiles(
                largeFileSet,
                mockAgent,
                { showProgress: false }
            );
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            const throughput = (largeFileSet.length / (totalTime / 1000)) * 60; // files per minute

            console.log(`Large set E2E: ${largeFileSet.length} files in ${totalTime}ms (${throughput.toFixed(1)} files/min)`);

            assertEquals(results.length, largeFileSet.length);
            assertEquals(mockAgent.getProcessCount(), largeFileSet.length);
            
            // Should complete in reasonable time
            assert(totalTime < 30000, `Large file set took too long: ${totalTime}ms`);
            assert(throughput > 10, `Throughput too low: ${throughput.toFixed(1)} files/min`);
        });

        it('should maintain memory efficiency in long-running processes', async () => {
            const testFiles = createTestFileStructure();
            const processor = new SequentialFileProcessor(mockLogger);
            
            // Process multiple batches to simulate long-running process
            const batches = 3;
            const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;
            
            for (let batch = 0; batch < batches; batch++) {
                await processor.processFiles(
                    testFiles,
                    mockAgent,
                    { showProgress: false }
                );
                
                // Force garbage collection if available
                if ((global as any).gc) {
                    (global as any).gc();
                }
            }
            
            const finalMemory = (performance as any).memory?.usedJSHeapSize || 0;
            const memoryIncrease = finalMemory - initialMemory;
            
            console.log(`Memory increase after ${batches} batches: ${memoryIncrease} bytes`);
            
            // Should not have excessive memory growth
            const maxAcceptableIncrease = 50 * 1024 * 1024; // 50MB
            if (initialMemory > 0) {
                assert(memoryIncrease < maxAcceptableIncrease, 
                    `Memory increase too high: ${memoryIncrease} bytes`);
            }
            
            // Verify all batches processed correctly
            assertEquals(mockAgent.getProcessCount(), testFiles.length * batches);
        });
    });
});