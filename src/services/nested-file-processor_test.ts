import { assertEquals, assertExists, assert } from '@std/assert';
import { beforeEach, describe, it } from '@std/testing/bdd';
import { resolve, join, basename } from 'std/path/mod.ts';
import { Logger } from '../utils/logger.ts';
import { 
    NestedFileProcessor,
    type GroupedResults,
    type GroupingOptions,
    type NestedProcessingOptions,
    DEFAULT_GROUPING_OPTIONS 
} from './nested-file-processor.ts';
import type { FileProcessor, ProcessingResult } from './sequential_processor.ts';
import { FileStatus } from './sequential_processor.ts';

// Mock file processor for testing
class MockFileProcessor implements FileProcessor {
    private processCount = 0;
    private shouldFail = false;
    private failureFiles: Set<string> = new Set();

    async processFile(filePath: string): Promise<any> {
        this.processCount++;
        
        if (this.shouldFail || this.failureFiles.has(filePath)) {
            throw new Error(`Mock processing failed for ${filePath}`);
        }

        return {
            grade: 'A',
            state: 'pass',
            issues: [],
            metrics: { coverage: 90 }
        };
    }

    getProcessCount(): number {
        return this.processCount;
    }

    setShouldFail(shouldFail: boolean): void {
        this.shouldFail = shouldFail;
    }

    setFailureFiles(files: string[]): void {
        this.failureFiles = new Set(files);
    }

    reset(): void {
        this.processCount = 0;
        this.shouldFail = false;
        this.failureFiles.clear();
    }
}

// Helper to create mock logger
function createMockLogger(): Logger {
    return new Logger('TestNestedFileProcessor', false);
}

// Helper to create test files structure
function createTestFiles(): string[] {
    const baseDir = resolve(Deno.cwd());
    return [
        join(baseDir, 'src/components/Button.tsx'),
        join(baseDir, 'src/components/Input.tsx'),
        join(baseDir, 'src/utils/helpers.ts'),
        join(baseDir, 'src/utils/validation.ts'),
        join(baseDir, 'tests/unit/button.test.ts'),
        join(baseDir, 'tests/integration/api.test.ts'),
        join(baseDir, 'docs/README.md'),
    ];
}

// Mock NestedFileProcessor for testing without actual file system operations
class TestableNestedFileProcessor extends NestedFileProcessor {
    private mockFiles: string[] = [];

    setMockFiles(files: string[]): void {
        this.mockFiles = files;
    }

    override async expandGlobPattern(pattern: string): Promise<string[]> {
        // Return mock files that match the pattern
        return this.mockFiles.filter(file => {
            if (pattern.includes('**/*.ts')) {
                return file.endsWith('.ts');
            }
            if (pattern.includes('**/*.tsx')) {
                return file.endsWith('.tsx');
            }
            if (pattern.includes('src/')) {
                return file.includes('src/');
            }
            return true;
        }).sort();
    }
}

describe('NestedFileProcessor', () => {
    let processor: TestableNestedFileProcessor;
    let mockFileProcessor: MockFileProcessor;
    let mockLogger: Logger;

    beforeEach(() => {
        mockLogger = createMockLogger();
        processor = new TestableNestedFileProcessor(mockLogger);
        mockFileProcessor = new MockFileProcessor();
    });

    describe('processWithGrouping', () => {
        it('should process files grouped by directory', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const result = await processor.processWithGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: false,
                        groupSeparator: '\n',
                    }
                }
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
            
            // Check that files are grouped by directory
            const srcComponentsGroup = result.groups.find(g => g.name.includes('src/components'));
            assertExists(srcComponentsGroup);
            assertEquals(srcComponentsGroup.files.length, 2); // Button.tsx, Input.tsx
            
            // Verify all files were processed
            const totalProcessedFiles = result.groups.reduce((sum, group) => sum + group.files.length, 0);
            assertEquals(totalProcessedFiles, testFiles.length);
            assertEquals(mockFileProcessor.getProcessCount(), testFiles.length);
        });

        it('should process files grouped by file type', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const result = await processor.processWithGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'fileType',
                        showGroupProgress: false,
                        groupSeparator: '\n',
                    }
                }
            );

            assertExists(result);
            
            // Check that files are grouped by extension
            const tsGroup = result.groups.find(g => g.name === 'ts');
            const tsxGroup = result.groups.find(g => g.name === 'tsx');
            const mdGroup = result.groups.find(g => g.name === 'md');
            
            assertExists(tsGroup);
            assertExists(tsxGroup);
            assertExists(mdGroup);
            
            assertEquals(tsGroup.files.length, 4); // helpers.ts, validation.ts, test files
            assertEquals(tsxGroup.files.length, 2); // Button.tsx, Input.tsx
            assertEquals(mdGroup.files.length, 1); // README.md
        });

        it('should handle processing errors gracefully', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            mockFileProcessor.setFailureFiles([testFiles[0], testFiles[2]]);
            
            const result = await processor.processWithGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: false,
                        groupSeparator: '\n',
                    }
                }
            );

            assertExists(result);
            
            // Check overall summary includes failures
            assertEquals(result.overallSummary.totalFiles, testFiles.length);
            assertEquals(result.overallSummary.failedFiles, 2);
            assertEquals(result.overallSummary.successfulFiles, testFiles.length - 2);
        });

        it('should call progress callbacks', async () => {
            const testFiles = createTestFiles().slice(0, 3); // Use fewer files for simpler test
            processor.setMockFiles(testFiles);
            let groupStartCalls = 0;
            let groupCompleteCalls = 0;
            let fileStartCalls = 0;
            
            await processor.processWithGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: true,
                        groupSeparator: '\n',
                    },
                    onGroupStart: (groupName, fileCount) => {
                        groupStartCalls++;
                        assert(typeof groupName === 'string');
                        assert(typeof fileCount === 'number');
                        assert(fileCount > 0);
                    },
                    onGroupComplete: (groupName, summary) => {
                        groupCompleteCalls++;
                        assertExists(summary);
                        assert(summary.totalFiles > 0);
                    },
                    onFileStart: (file, index, total) => {
                        fileStartCalls++;
                        assert(typeof file === 'string');
                        assert(typeof index === 'number');
                        assert(typeof total === 'number');
                    }
                }
            );

            assert(groupStartCalls > 0);
            assert(groupCompleteCalls > 0);
            assert(fileStartCalls > 0);
            assertEquals(groupStartCalls, groupCompleteCalls);
        });
    });

    describe('processNestedPattern', () => {
        it('should process nested patterns with glob expansion', async () => {
            const mockFiles = createTestFiles().filter(f => f.includes('src') && f.endsWith('.ts'));
            processor.setMockFiles(mockFiles);

            const result = await processor.processNestedPattern(
                'src/**/*.ts',
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: false,
                        groupSeparator: '\n',
                    }
                }
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
            assertEquals(mockFileProcessor.getProcessCount(), mockFiles.length);
        });

        it('should handle empty pattern results', async () => {
            processor.setMockFiles([]);

            const result = await processor.processNestedPattern(
                'nonexistent/**/*.ts',
                mockFileProcessor
            );

            assertExists(result);
            assertEquals(result.groups.length, 0);
            assertEquals(result.overallSummary.totalFiles, 0);
            assertEquals(mockFileProcessor.getProcessCount(), 0);
        });
    });

    describe('processMultiplePatterns', () => {
        it('should process multiple patterns and deduplicate files', async () => {
            const allFiles = createTestFiles();
            processor.setMockFiles(allFiles);

            const result = await processor.processMultiplePatterns(
                ['src/**/*.ts', 'src/**/*.tsx'],
                mockFileProcessor
            );

            assertExists(result);
            // Should have TypeScript and TSX files from src directory
            const expectedFiles = allFiles.filter(f => 
                f.includes('src/') && (f.endsWith('.ts') || f.endsWith('.tsx'))
            );
            assertEquals(result.overallSummary.totalFiles, expectedFiles.length);
            assertEquals(mockFileProcessor.getProcessCount(), expectedFiles.length);
        });
    });

    describe('getGroupedStats', () => {
        it('should calculate correct statistics', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            mockFileProcessor.setFailureFiles([testFiles[0]]); // Make one file fail
            
            const result = await processor.processWithGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        groupBy: 'directory',
                        showGroupProgress: false,
                        groupSeparator: '\n',
                    }
                }
            );

            const stats = processor.getGroupedStats(result);
            
            assertExists(stats);
            assertEquals(stats.totalFiles, testFiles.length);
            assertEquals(stats.totalGroups, result.groups.length);
            assert(stats.averageFilesPerGroup > 0);
            assertEquals(stats.overallSummary.failedFiles, 1);
            assertEquals(stats.overallSummary.successfulFiles, testFiles.length - 1);
        });
    });

    describe('grouping options', () => {
        it('should use default grouping options', async () => {
            const testFiles = createTestFiles().slice(0, 2);
            processor.setMockFiles(testFiles);
            
            const result = await processor.processWithGrouping(
                testFiles,
                mockFileProcessor
            );

            assertExists(result);
            // Default should be directory grouping
            assert(result.groups.length > 0);
        });

        it('should respect custom grouping options', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const customOptions: GroupingOptions = {
                groupBy: 'fileType',
                showGroupProgress: false,
                groupSeparator: '---',
                includeEmptyGroups: true,
            };
            
            const result = await processor.processWithGrouping(
                testFiles,
                mockFileProcessor,
                { groupingOptions: customOptions }
            );

            assertExists(result);
            // Should be grouped by file type
            const extensions = result.groups.map(g => g.name);
            assert(extensions.includes('ts'));
            assert(extensions.includes('tsx'));
            assert(extensions.includes('md'));
        });
    });
});