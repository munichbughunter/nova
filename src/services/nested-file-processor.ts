import { expandGlob } from 'std/fs/expand_glob.ts';
import { dirname, relative, resolve } from 'std/path/mod.ts';
import type { Logger } from '../utils/logger.ts';
import type { 
    ProcessingResult, 
    FileProcessor, 
    SequentialProcessingOptions
} from './sequential_processor.ts';
import { FileStatus } from './sequential_processor.ts';
import { SequentialFileProcessor } from './sequential_processor.ts';

/**
 * Options for directory grouping
 */
export interface GroupingOptions {
    groupBy: 'directory' | 'fileType' | 'none';
    showGroupProgress: boolean;
    groupSeparator: string;
    maxDepth?: number;
    includeEmptyGroups?: boolean;
}

/**
 * Default grouping options
 */
export const DEFAULT_GROUPING_OPTIONS: GroupingOptions = {
    groupBy: 'directory',
    showGroupProgress: true,
    groupSeparator: '\n',
    maxDepth: undefined,
    includeEmptyGroups: false,
};

/**
 * Summary statistics for a group of files
 */
export interface GroupSummary {
    totalFiles: number;
    successfulFiles: number;
    failedFiles: number;
    warningFiles: number;
    totalDuration: number;
    averageDuration: number;
    successRate: number;
    errorRate: number;
    warningRate: number;
}

/**
 * Results grouped by directory or other criteria
 */
export interface GroupedResults {
    groups: Array<{
        name: string;
        files: string[];
        results: ProcessingResult[];
        summary: GroupSummary;
    }>;
    overallSummary: GroupSummary;
    processingMode: 'grouped' | 'flat';
    totalGroups: number;
}

/**
 * Options for nested file processing
 */
export interface NestedProcessingOptions extends SequentialProcessingOptions {
    groupingOptions?: GroupingOptions;
    onGroupStart?: (groupName: string, fileCount: number) => void;
    onGroupComplete?: (groupName: string, summary: GroupSummary) => void;
    expandGlobs?: boolean;
    followSymlinks?: boolean;
}

/**
 * Processor for handling nested file patterns and directory grouping
 */
export class NestedFileProcessor {
    private logger: Logger;
    private sequentialProcessor: SequentialFileProcessor;

    constructor(logger: Logger) {
        this.logger = logger.child('NestedFileProcessor');
        this.sequentialProcessor = new SequentialFileProcessor(logger);
    }

    /**
     * Process files with nested patterns (e.g., src slash-star-star slash-star.ts)
     */
    async processNestedPattern(
        pattern: string,
        processor: FileProcessor,
        options: NestedProcessingOptions = {}
    ): Promise<GroupedResults> {
        this.logger.info(`Processing nested pattern: ${pattern}`);

        // Expand glob patterns to get actual file paths
        const files = await this.expandGlobPattern(pattern, {
            followSymlinks: options.followSymlinks ?? false,
            maxDepth: options.groupingOptions?.maxDepth,
        });

        if (files.length === 0) {
            this.logger.warn(`No files found matching pattern: ${pattern}`);
            return this.createEmptyGroupedResults();
        }

        this.logger.info(`Found ${files.length} files matching pattern`);

        // Group files and process
        return await this.processWithGrouping(files, processor, options);
    }

    /**
     * Process multiple nested patterns
     */
    async processMultiplePatterns(
        patterns: string[],
        processor: FileProcessor,
        options: NestedProcessingOptions = {}
    ): Promise<GroupedResults> {
        this.logger.info(`Processing ${patterns.length} nested patterns`);

        // Expand all patterns and collect unique files
        const allFiles = new Set<string>();
        
        for (const pattern of patterns) {
            const files = await this.expandGlobPattern(pattern, {
                followSymlinks: options.followSymlinks ?? false,
                maxDepth: options.groupingOptions?.maxDepth,
            });
            files.forEach(file => allFiles.add(file));
        }

        const uniqueFiles = Array.from(allFiles).sort();
        
        if (uniqueFiles.length === 0) {
            this.logger.warn(`No files found matching patterns: ${patterns.join(', ')}`);
            return this.createEmptyGroupedResults();
        }

        this.logger.info(`Found ${uniqueFiles.length} unique files across all patterns`);

        return await this.processWithGrouping(uniqueFiles, processor, options);
    }

    /**
     * Process files with directory grouping
     */
    async processWithGrouping(
        files: string[],
        processor: FileProcessor,
        options: NestedProcessingOptions = {}
    ): Promise<GroupedResults> {
        const groupingOptions = { ...DEFAULT_GROUPING_OPTIONS, ...options.groupingOptions };
        
        this.logger.info(`Processing ${files.length} files with grouping by ${groupingOptions.groupBy}`);

        // Group files according to the specified criteria
        const grouped = this.groupFiles(files, groupingOptions);
        
        const results: GroupedResults = {
            groups: [],
            overallSummary: this.createEmptyGroupSummary(),
            processingMode: 'grouped',
            totalGroups: grouped.size,
        };

        let allResults: ProcessingResult[] = [];

        // Process each group
        for (const [groupName, groupFiles] of grouped) {
            if (groupFiles.length === 0 && !groupingOptions.includeEmptyGroups) {
                continue;
            }

            this.logger.info(`${groupingOptions.groupSeparator}📁 Processing group: ${groupName} (${groupFiles.length} files)`);

            // Notify group start
            if (options.onGroupStart) {
                options.onGroupStart(groupName, groupFiles.length);
            }

            // Process files in this group sequentially
            const groupResults = await this.sequentialProcessor.processFiles(
                groupFiles,
                processor,
                {
                    ...options,
                    onFileStart: (file, index, total) => {
                        if (options.showProgress) {
                            this.logger.info(`  [${index + 1}/${total}] ${relative(Deno.cwd(), file)}`);
                        }
                        if (options.onFileStart) {
                            options.onFileStart(file, index, total);
                        }
                    },
                }
            );

            // Calculate group summary
            const groupSummary = this.calculateGroupSummary(groupResults);
            
            // Add to results
            results.groups.push({
                name: groupName,
                files: groupFiles,
                results: groupResults,
                summary: groupSummary,
            });

            allResults = allResults.concat(groupResults);

            // Notify group completion
            if (options.onGroupComplete) {
                options.onGroupComplete(groupName, groupSummary);
            }

            // Log group summary
            this.logGroupSummary(groupName, groupSummary);
        }

        // Calculate overall summary
        results.overallSummary = this.calculateGroupSummary(allResults);

        this.logger.info(`\n📊 Overall Summary:`);
        this.logGroupSummary('All Groups', results.overallSummary);

        return results;
    }

    /**
     * Expand glob patterns to get actual file paths
     */
    async expandGlobPattern(
        pattern: string,
        options: {
            followSymlinks?: boolean;
            maxDepth?: number;
        } = {}
    ): Promise<string[]> {
        const files: string[] = [];

        try {
            // Use Deno's expandGlob to handle glob patterns
            for await (const entry of expandGlob(pattern, {
                root: Deno.cwd(),
                followSymlinks: options.followSymlinks ?? false,
                includeDirs: false,
                globstar: true,
            })) {
                if (entry.isFile) {
                    const filePath = resolve(entry.path);
                    
                    // Apply max depth filter if specified
                    if (options.maxDepth !== undefined) {
                        const relativePath = relative(Deno.cwd(), filePath);
                        const depth = relativePath.split('/').length - 1;
                        if (depth > options.maxDepth) {
                            continue;
                        }
                    }
                    
                    files.push(filePath);
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to expand glob pattern "${pattern}": ${errorMessage}`);
            throw new Error(`Glob expansion failed: ${errorMessage}`);
        }

        // Sort files for consistent ordering
        return files.sort();
    }

    /**
     * Group files by the specified criteria
     */
    private groupFiles(files: string[], options: GroupingOptions): Map<string, string[]> {
        const groups = new Map<string, string[]>();

        for (const file of files) {
            let groupKey: string;

            switch (options.groupBy) {
                case 'directory':
                    groupKey = dirname(relative(Deno.cwd(), file)) || '.';
                    break;
                case 'fileType':
                    const ext = file.split('.').pop()?.toLowerCase() || 'no-extension';
                    groupKey = ext;
                    break;
                case 'none':
                default:
                    groupKey = 'all-files';
                    break;
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(file);
        }

        // Sort files within each group
        for (const [key, groupFiles] of groups) {
            groups.set(key, groupFiles.sort());
        }

        return groups;
    }

    /**
     * Calculate summary statistics for a group of processing results
     */
    private calculateGroupSummary(results: ProcessingResult[]): GroupSummary {
        if (results.length === 0) {
            return this.createEmptyGroupSummary();
        }

        const successful = results.filter(r => r.success && r.status === FileStatus.SUCCESS).length;
        const warnings = results.filter(r => r.success && r.status === FileStatus.WARNING).length;
        const failed = results.filter(r => !r.success || r.status === FileStatus.ERROR).length;
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

        return {
            totalFiles: results.length,
            successfulFiles: successful,
            failedFiles: failed,
            warningFiles: warnings,
            totalDuration,
            averageDuration: totalDuration / results.length,
            successRate: successful / results.length,
            errorRate: failed / results.length,
            warningRate: warnings / results.length,
        };
    }

    /**
     * Create an empty group summary
     */
    private createEmptyGroupSummary(): GroupSummary {
        return {
            totalFiles: 0,
            successfulFiles: 0,
            failedFiles: 0,
            warningFiles: 0,
            totalDuration: 0,
            averageDuration: 0,
            successRate: 0,
            errorRate: 0,
            warningRate: 0,
        };
    }

    /**
     * Create empty grouped results
     */
    private createEmptyGroupedResults(): GroupedResults {
        return {
            groups: [],
            overallSummary: this.createEmptyGroupSummary(),
            processingMode: 'grouped',
            totalGroups: 0,
        };
    }

    /**
     * Log group summary in a formatted way
     */
    private logGroupSummary(groupName: string, summary: GroupSummary): void {
        const successRate = (summary.successRate * 100).toFixed(1);
        const avgDuration = summary.averageDuration.toFixed(0);
        
        this.logger.info(
            `  ✅ ${summary.successfulFiles} success, ` +
            `⚠️ ${summary.warningFiles} warnings, ` +
            `❌ ${summary.failedFiles} failed ` +
            `(${successRate}% success rate, ${avgDuration}ms avg)`
        );
    }

    /**
     * Get processing statistics for grouped results
     */
    getGroupedStats(results: GroupedResults): {
        totalGroups: number;
        totalFiles: number;
        averageFilesPerGroup: number;
        groupSummaries: Array<{ name: string; summary: GroupSummary }>;
        overallSummary: GroupSummary;
    } {
        const groupSummaries = results.groups.map(group => ({
            name: group.name,
            summary: group.summary,
        }));

        return {
            totalGroups: results.totalGroups,
            totalFiles: results.overallSummary.totalFiles,
            averageFilesPerGroup: results.totalGroups > 0 
                ? results.overallSummary.totalFiles / results.totalGroups 
                : 0,
            groupSummaries,
            overallSummary: results.overallSummary,
        };
    }
}