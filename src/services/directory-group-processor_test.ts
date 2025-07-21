import { assertEquals, assertExists, assert } from '@std/assert';
import { beforeEach, describe, it } from '@std/testing/bdd';
import { resolve, join } from 'std/path/mod.ts';
import { Logger } from '../utils/logger.ts';
import { 
    DirectoryGroupProcessor,
    type DirectoryGroupedResults,
    type DirectoryGroupingOptions,
    DEFAULT_DIRECTORY_GROUPING_OPTIONS 
} from './directory-group-processor.ts';
import type { FileProcessor } from './sequential_processor.ts';

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
    return new Logger('TestDirectoryGroupProcessor', false);
}

// Helper to create test files structure
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
        join(baseDir, 'tests/unit/input.test.ts'),
        join(baseDir, 'tests/integration/api.test.ts'),
        join(baseDir, 'docs/README.md'),
        join(baseDir, 'docs/api/endpoints.md'),
    ];
}

// Mock DirectoryGroupProcessor for testing without actual file system operations
class TestableDirectoryGroupProcessor extends DirectoryGroupProcessor {
    private mockFiles: string[] = [];

    setMockFiles(files: string[]): void {
        this.mockFiles = files;
    }

    // Override the nested processor's expandGlobPattern method
    override async processWithGrouping(
        filePattern: string,
        processor: FileProcessor,
        options: any = {}
    ): Promise<DirectoryGroupedResults> {
        // Use mock files instead of actual glob expansion
        return await this.processFilesWithDirectoryGrouping(
            this.mockFiles,
            processor,
            options
        );
    }

    override async processMultipleDirectoryPatterns(
        patterns: string[],
        processor: FileProcessor,
        options: any = {}
    ): Promise<DirectoryGroupedResults> {
        // Use mock files for all patterns
        return await this.processFilesWithDirectoryGrouping(
            this.mockFiles,
            processor,
            options
        );
    }
}

describe('DirectoryGroupProcessor', () => {
    let processor: TestableDirectoryGroupProcessor;
    let mockFileProcessor: MockFileProcessor;
    let mockLogger: Logger;

    beforeEach(() => {
        mockLogger = createMockLogger();
        processor = new TestableDirectoryGroupProcessor(mockLogger);
        mockFileProcessor = new MockFileProcessor();
    });

    describe('processWithGrouping', () => {
        it('should process files with directory grouping', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const result = await processor.processWithGrouping(
                'src/**/*',
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
            assert(result.directoryGroups.length > 0);
            assertExists(result.directoryTree);
            
            // Check that we have expected directory groups
            const componentGroup = result.groups.find(g => g.name.includes('src/components'));
            const utilsGroup = result.groups.find(g => g.name.includes('src/utils'));
            const testsGroup = result.groups.find(g => g.name.includes('tests'));
            
            assertExists(componentGroup);
            assertExists(utilsGroup);
            assertExists(testsGroup);
            
            // Verify file counts
            assertEquals(componentGroup.files.length, 3); // Button, Input, Modal
            assertEquals(utilsGroup.files.length, 2); // helpers, validation
            
            // Verify all files were processed
            assertEquals(mockFileProcessor.getProcessCount(), testFiles.length);
        });

        it('should filter directories by exclusion rules', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        excludeDirectories: ['tests', 'docs'],
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            
            // Should not have tests or docs groups
            const testsGroup = result.groups.find(g => g.name.includes('tests'));
            const docsGroup = result.groups.find(g => g.name.includes('docs'));
            
            assertEquals(testsGroup, undefined);
            assertEquals(docsGroup, undefined);
            
            // Should have excluded directories listed
            assert(result.excludedDirectories.length > 0);
            assert(result.excludedDirectories.some(dir => dir.includes('tests')));
            assert(result.excludedDirectories.some(dir => dir.includes('docs')));
            
            // Should only process src files
            const srcFileCount = testFiles.filter(f => 
                f.includes('src/') && !f.includes('tests') && !f.includes('docs')
            ).length;
            assertEquals(mockFileProcessor.getProcessCount(), srcFileCount);
        });

        it('should filter directories by inclusion rules', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        includeOnlyDirectories: ['src/components', 'src/utils'],
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            
            // Should only have components and utils groups
            const componentGroup = result.groups.find(g => g.name.includes('src/components'));
            const utilsGroup = result.groups.find(g => g.name.includes('src/utils'));
            const testsGroup = result.groups.find(g => g.name.includes('tests'));
            
            assertExists(componentGroup);
            assertExists(utilsGroup);
            assertEquals(testsGroup, undefined);
            
            // Should only process included files
            const includedFileCount = testFiles.filter(f => 
                f.includes('src/components') || f.includes('src/utils')
            ).length;
            assertEquals(mockFileProcessor.getProcessCount(), includedFileCount);
        });

        it('should sort directories according to options', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        sortDirectories: 'fileCount',
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            assert(result.directoryGroups.length > 1);
            
            // Should be sorted by file count (descending)
            for (let i = 0; i < result.directoryGroups.length - 1; i++) {
                assert(result.directoryGroups[i].fileCount >= result.directoryGroups[i + 1].fileCount);
            }
        });
    });

    describe('processMultipleDirectoryPatterns', () => {
        it('should process multiple patterns and deduplicate', async () => {
            const testFiles = createTestFiles();
            processor.setMockFiles(testFiles);
            
            const result = await processor.processMultipleDirectoryPatterns(
                ['src/**/*', 'tests/**/*'],
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            
            // Should have both src and tests groups
            const srcGroups = result.groups.filter(g => g.name.includes('src'));
            const testGroups = result.groups.filter(g => g.name.includes('tests'));
            
            assert(srcGroups.length > 0);
            assert(testGroups.length > 0);
            
            // Should process all files
            assertEquals(mockFileProcessor.getProcessCount(), testFiles.length);
        });
    });

    describe('processFilesWithDirectoryGrouping', () => {
        it('should process provided files with directory grouping', async () => {
            const testFiles = createTestFiles().slice(0, 6); // Use subset for simpler test
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
            
            // Verify all files were processed
            assertEquals(mockFileProcessor.getProcessCount(), testFiles.length);
            
            // Verify directory tree structure
            assertExists(result.directoryTree);
            assertEquals(result.directoryTree.name, '.');
            assert(result.directoryTree.children.length > 0);
        });

        it('should handle processing errors in directory groups', async () => {
            const testFiles = createTestFiles().slice(0, 4);
            mockFileProcessor.setFailureFiles([testFiles[0], testFiles[2]]);
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            
            // Check that errors are properly tracked
            assertEquals(result.overallSummary.totalFiles, testFiles.length);
            assertEquals(result.overallSummary.failedFiles, 2);
            assertEquals(result.overallSummary.successfulFiles, testFiles.length - 2);
            
            // Check that groups have correct error counts
            const groupsWithErrors = result.groups.filter(g => g.summary.failedFiles > 0);
            assert(groupsWithErrors.length > 0);
        });
    });

    describe('directory tree building', () => {
        it('should build correct directory tree structure', async () => {
            const testFiles = [
                resolve('src/components/Button.tsx'),
                resolve('src/components/forms/Input.tsx'),
                resolve('src/utils/helpers.ts'),
                resolve('tests/unit/button.test.ts'),
            ];
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result.directoryTree);
            
            // Check root
            assertEquals(result.directoryTree.name, '.');
            assertEquals(result.directoryTree.depth, 0);
            assertEquals(result.directoryTree.totalFiles, testFiles.length);
            
            // Check that src directory exists
            const srcNode = result.directoryTree.children.find(c => c.name === 'src');
            assertExists(srcNode);
            assert(srcNode.children.length > 0);
            
            // Check components directory
            const componentsNode = srcNode.children.find(c => c.name === 'components');
            assertExists(componentsNode);
            assert(componentsNode.files.length > 0);
            
            // Check nested forms directory
            const formsNode = componentsNode.children.find(c => c.name === 'forms');
            assertExists(formsNode);
            assertEquals(formsNode.files.length, 1);
        });
    });

    describe('getDirectoryStats', () => {
        it('should calculate correct directory statistics', async () => {
            const testFiles = createTestFiles();
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        showDirectoryTree: false,
                    }
                }
            );

            const stats = processor.getDirectoryStats(result);
            
            assertExists(stats);
            assertEquals(stats.totalDirectories, result.totalGroups);
            assertEquals(stats.excludedDirectoryCount, result.excludedDirectories.length);
            assert(stats.averageFilesPerDirectory > 0);
            assert(stats.deepestDirectory >= 0);
            assert(stats.directoryDistribution.length > 0);
            
            // Check directory distribution
            for (const dist of stats.directoryDistribution) {
                assert(typeof dist.directory === 'string');
                assert(typeof dist.fileCount === 'number');
                assert(typeof dist.successRate === 'number');
                assert(dist.fileCount > 0);
                assert(dist.successRate >= 0 && dist.successRate <= 1);
            }
        });
    });

    describe('directory filtering', () => {
        it('should handle empty results after filtering', async () => {
            const testFiles = createTestFiles();
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        includeOnlyDirectories: ['nonexistent'],
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            assertEquals(result.groups.length, 0);
            assertEquals(result.overallSummary.totalFiles, 0);
            assertEquals(mockFileProcessor.getProcessCount(), 0);
        });

        it('should handle complex directory filtering', async () => {
            const testFiles = createTestFiles();
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor,
                {
                    groupingOptions: {
                        ...DEFAULT_DIRECTORY_GROUPING_OPTIONS,
                        includeOnlyDirectories: ['src'],
                        excludeDirectories: ['src/services'],
                        showDirectoryTree: false,
                    }
                }
            );

            assertExists(result);
            
            // Should include src but exclude src/services
            const srcGroups = result.groups.filter(g => g.name.includes('src'));
            const serviceGroups = result.groups.filter(g => g.name.includes('src/services'));
            
            assert(srcGroups.length > 0);
            assertEquals(serviceGroups.length, 0);
        });
    });

    describe('default options', () => {
        it('should use default directory grouping options', async () => {
            const testFiles = createTestFiles().slice(0, 4);
            
            const result = await processor.processFilesWithDirectoryGrouping(
                testFiles,
                mockFileProcessor
            );

            assertExists(result);
            assertEquals(result.processingMode, 'grouped');
            assert(result.groups.length > 0);
        });
    });
});