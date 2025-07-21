import { dirname, relative, basename } from 'std/path/mod.ts';
import type { Logger } from '../utils/logger.ts';
import type { 
    ProcessingResult, 
    FileProcessor, 
    SequentialProcessingOptions 
} from './sequential_processor.ts';
import { 
    NestedFileProcessor, 
    type GroupedResults, 
    type GroupingOptions, 
    type GroupSummary,
    type NestedProcessingOptions,
    DEFAULT_GROUPING_OPTIONS 
} from './nested-file-processor.ts';

/**
 * Directory-specific grouping options
 */
export interface DirectoryGroupingOptions extends GroupingOptions {
    groupBy: 'directory';
    flattenSingleFileDirectories?: boolean;
    showDirectoryTree?: boolean;
    sortDirectories?: 'alphabetical' | 'fileCount' | 'depth';
    excludeDirectories?: string[];
    includeOnlyDirectories?: string[];
}

/**
 * Default directory grouping options
 */
export const DEFAULT_DIRECTORY_GROUPING_OPTIONS: DirectoryGroupingOptions = {
    ...DEFAULT_GROUPING_OPTIONS,
    groupBy: 'directory',
    flattenSingleFileDirectories: false,
    showDirectoryTree: true,
    sortDirectories: 'alphabetical',
    excludeDirectories: [],
    includeOnlyDirectories: [],
};

/**
 * Directory group information
 */
export interface DirectoryGroup {
    path: string;
    relativePath: string;
    files: string[];
    depth: number;
    parentPath?: string;
    childDirectories: string[];
    fileCount: number;
}

/**
 * Directory tree structure for visualization
 */
export interface DirectoryTree {
    name: string;
    path: string;
    files: string[];
    children: DirectoryTree[];
    depth: number;
    totalFiles: number;
}

/**
 * Enhanced results with directory-specific information
 */
export interface DirectoryGroupedResults extends GroupedResults {
    directoryTree: DirectoryTree;
    directoryGroups: DirectoryGroup[];
    processingOrder: string[];
    excludedDirectories: string[];
}

/**
 * Processor specialized for directory-based grouping and processing
 */
export class DirectoryGroupProcessor {
    private logger: Logger;
    private nestedProcessor: NestedFileProcessor;

    constructor(logger: Logger) {
        this.logger = logger.child('DirectoryGroupProcessor');
        this.nestedProcessor = new NestedFileProcessor(logger);
    }

    /**
     * Process files with directory grouping
     */
    async processWithGrouping(
        filePattern: string,
        processor: FileProcessor,
        options: NestedProcessingOptions & { groupingOptions?: DirectoryGroupingOptions } = {}
    ): Promise<DirectoryGroupedResults> {
        const groupingOptions = { 
            ...DEFAULT_DIRECTORY_GROUPING_OPTIONS, 
            ...options.groupingOptions 
        };

        this.logger.info(`Processing files with directory grouping: ${filePattern}`);

        // Get files from pattern
        const files = await this.nestedProcessor.expandGlobPattern(filePattern);
        
        if (files.length === 0) {
            this.logger.warn(`No files found for pattern: ${filePattern}`);
            return this.createEmptyDirectoryResults();
        }

        // Filter directories if specified
        const filteredFiles = this.filterFilesByDirectory(files, groupingOptions);
        
        if (filteredFiles.length === 0) {
            this.logger.warn('All files filtered out by directory restrictions');
            return this.createEmptyDirectoryResults();
        }

        // Create directory groups
        const directoryGroups = this.createDirectoryGroups(filteredFiles, groupingOptions);
        
        // Build directory tree
        const directoryTree = this.buildDirectoryTree(filteredFiles);
        
        // Show directory tree if requested
        if (groupingOptions.showDirectoryTree) {
            this.displayDirectoryTree(directoryTree);
        }

        // Sort directory groups
        const sortedGroups = this.sortDirectoryGroups(directoryGroups, groupingOptions);
        
        // Process files with enhanced directory-aware options
        const enhancedOptions: NestedProcessingOptions = {
            ...options,
            groupingOptions,
            onGroupStart: (groupName, fileCount) => {
                this.logger.info(`\n📁 Processing directory: ${groupName} (${fileCount} files)`);
                if (options.onGroupStart) {
                    options.onGroupStart(groupName, fileCount);
                }
            },
            onGroupComplete: (groupName, summary) => {
                this.logDirectoryGroupSummary(groupName, summary);
                if (options.onGroupComplete) {
                    options.onGroupComplete(groupName, summary);
                }
            },
        };

        // Process with nested processor
        const baseResults = await this.nestedProcessor.processWithGrouping(
            filteredFiles,
            processor,
            enhancedOptions
        );

        // Create enhanced directory results
        const directoryResults: DirectoryGroupedResults = {
            ...baseResults,
            directoryTree,
            directoryGroups: sortedGroups,
            processingOrder: this.getProcessingOrder(sortedGroups),
            excludedDirectories: this.getExcludedDirectories(files, filteredFiles),
        };

        // Log final directory summary
        this.logDirectoryProcessingSummary(directoryResults);

        return directoryResults;
    }

    /**
     * Process multiple directory patterns
     */
    async processMultipleDirectoryPatterns(
        patterns: string[],
        processor: FileProcessor,
        options: NestedProcessingOptions & { groupingOptions?: DirectoryGroupingOptions } = {}
    ): Promise<DirectoryGroupedResults> {
        this.logger.info(`Processing ${patterns.length} directory patterns`);

        // Expand all patterns
        const allFiles = new Set<string>();
        for (const pattern of patterns) {
            const files = await this.nestedProcessor.expandGlobPattern(pattern);
            files.forEach(file => allFiles.add(file));
        }

        const uniqueFiles = Array.from(allFiles).sort();
        
        if (uniqueFiles.length === 0) {
            this.logger.warn(`No files found for patterns: ${patterns.join(', ')}`);
            return this.createEmptyDirectoryResults();
        }

        // Use single pattern processing with combined files
        return await this.processFilesWithDirectoryGrouping(uniqueFiles, processor, options);
    }

    /**
     * Process a list of files with directory grouping
     */
    async processFilesWithDirectoryGrouping(
        files: string[],
        processor: FileProcessor,
        options: NestedProcessingOptions & { groupingOptions?: DirectoryGroupingOptions } = {}
    ): Promise<DirectoryGroupedResults> {
        const groupingOptions = { 
            ...DEFAULT_DIRECTORY_GROUPING_OPTIONS, 
            ...options.groupingOptions 
        };

        // Filter and process files
        const filteredFiles = this.filterFilesByDirectory(files, groupingOptions);
        const directoryGroups = this.createDirectoryGroups(filteredFiles, groupingOptions);
        const directoryTree = this.buildDirectoryTree(filteredFiles);

        if (groupingOptions.showDirectoryTree) {
            this.displayDirectoryTree(directoryTree);
        }

        const sortedGroups = this.sortDirectoryGroups(directoryGroups, groupingOptions);

        // Process with nested processor
        const baseResults = await this.nestedProcessor.processWithGrouping(
            filteredFiles,
            processor,
            {
                ...options,
                groupingOptions,
            }
        );

        return {
            ...baseResults,
            directoryTree,
            directoryGroups: sortedGroups,
            processingOrder: this.getProcessingOrder(sortedGroups),
            excludedDirectories: this.getExcludedDirectories(files, filteredFiles),
        };
    }

    /**
     * Filter files by directory inclusion/exclusion rules
     */
    private filterFilesByDirectory(
        files: string[],
        options: DirectoryGroupingOptions
    ): string[] {
        return files.filter(file => {
            const relativePath = relative(Deno.cwd(), file);
            const dirPath = dirname(relativePath);

            // Check exclusions
            if (options.excludeDirectories && options.excludeDirectories.length > 0) {
                const isExcluded = options.excludeDirectories.some(excludeDir => 
                    dirPath.startsWith(excludeDir) || dirPath === excludeDir
                );
                if (isExcluded) {
                    return false;
                }
            }

            // Check inclusions (if specified, only include these)
            if (options.includeOnlyDirectories && options.includeOnlyDirectories.length > 0) {
                const isIncluded = options.includeOnlyDirectories.some(includeDir => 
                    dirPath.startsWith(includeDir) || dirPath === includeDir
                );
                return isIncluded;
            }

            return true;
        });
    }

    /**
     * Create directory groups from files
     */
    private createDirectoryGroups(
        files: string[],
        options: DirectoryGroupingOptions
    ): DirectoryGroup[] {
        const groupMap = new Map<string, DirectoryGroup>();

        for (const file of files) {
            const relativePath = relative(Deno.cwd(), file);
            const dirPath = dirname(relativePath) || '.';
            
            if (!groupMap.has(dirPath)) {
                const depth = dirPath === '.' ? 0 : dirPath.split('/').length;
                const parentPath = depth > 0 ? dirname(dirPath) : undefined;
                
                groupMap.set(dirPath, {
                    path: dirPath,
                    relativePath: dirPath,
                    files: [],
                    depth,
                    parentPath,
                    childDirectories: [],
                    fileCount: 0,
                });
            }

            const group = groupMap.get(dirPath)!;
            group.files.push(file);
            group.fileCount++;
        }

        // Build child directory relationships
        for (const [dirPath, group] of groupMap) {
            for (const [otherDirPath] of groupMap) {
                if (otherDirPath !== dirPath && otherDirPath.startsWith(dirPath + '/')) {
                    const relativeParts = otherDirPath.substring(dirPath.length + 1).split('/');
                    if (relativeParts.length === 1) {
                        group.childDirectories.push(otherDirPath);
                    }
                }
            }
        }

        return Array.from(groupMap.values());
    }

    /**
     * Build directory tree structure
     */
    private buildDirectoryTree(files: string[]): DirectoryTree {
        const root: DirectoryTree = {
            name: '.',
            path: '.',
            files: [],
            children: [],
            depth: 0,
            totalFiles: 0,
        };

        const nodeMap = new Map<string, DirectoryTree>();
        nodeMap.set('.', root);

        // Create all directory nodes
        for (const file of files) {
            const relativePath = relative(Deno.cwd(), file);
            const dirPath = dirname(relativePath) || '.';
            
            if (!nodeMap.has(dirPath)) {
                const parts = dirPath.split('/');
                let currentPath = '';
                
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    const parentPath = currentPath || '.';
                    currentPath = currentPath ? `${currentPath}/${part}` : part;
                    
                    if (!nodeMap.has(currentPath)) {
                        const node: DirectoryTree = {
                            name: part,
                            path: currentPath,
                            files: [],
                            children: [],
                            depth: i + 1,
                            totalFiles: 0,
                        };
                        
                        nodeMap.set(currentPath, node);
                        
                        const parent = nodeMap.get(parentPath);
                        if (parent) {
                            parent.children.push(node);
                        }
                    }
                }
            }

            // Add file to its directory
            const dirNode = nodeMap.get(dirPath);
            if (dirNode) {
                dirNode.files.push(file);
            }
        }

        // Calculate total files for each node
        this.calculateTotalFiles(root);

        return root;
    }

    /**
     * Calculate total files recursively
     */
    private calculateTotalFiles(node: DirectoryTree): number {
        node.totalFiles = node.files.length;
        for (const child of node.children) {
            node.totalFiles += this.calculateTotalFiles(child);
        }
        return node.totalFiles;
    }

    /**
     * Display directory tree
     */
    private displayDirectoryTree(tree: DirectoryTree, prefix = '', isLast = true): void {
        const connector = isLast ? '└── ' : '├── ';
        const name = tree.depth === 0 ? '.' : tree.name;
        const fileInfo = tree.files.length > 0 ? ` (${tree.files.length} files)` : '';
        
        this.logger.info(`${prefix}${connector}📁 ${name}${fileInfo}`);

        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        
        // Show files in this directory
        for (let i = 0; i < tree.files.length; i++) {
            const file = tree.files[i];
            const fileName = basename(file);
            const isLastFile = i === tree.files.length - 1 && tree.children.length === 0;
            const fileConnector = isLastFile ? '└── ' : '├── ';
            this.logger.info(`${childPrefix}${fileConnector}📄 ${fileName}`);
        }

        // Show child directories
        for (let i = 0; i < tree.children.length; i++) {
            const child = tree.children[i];
            const isLastChild = i === tree.children.length - 1;
            this.displayDirectoryTree(child, childPrefix, isLastChild);
        }
    }

    /**
     * Sort directory groups according to options
     */
    private sortDirectoryGroups(
        groups: DirectoryGroup[],
        options: DirectoryGroupingOptions
    ): DirectoryGroup[] {
        const sorted = [...groups];

        switch (options.sortDirectories) {
            case 'alphabetical':
                sorted.sort((a, b) => a.path.localeCompare(b.path));
                break;
            case 'fileCount':
                sorted.sort((a, b) => b.fileCount - a.fileCount);
                break;
            case 'depth':
                sorted.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
                break;
        }

        return sorted;
    }

    /**
     * Get processing order from sorted groups
     */
    private getProcessingOrder(groups: DirectoryGroup[]): string[] {
        return groups.flatMap(group => group.files);
    }

    /**
     * Get excluded directories
     */
    private getExcludedDirectories(allFiles: string[], filteredFiles: string[]): string[] {
        const allDirs = new Set(allFiles.map(f => dirname(relative(Deno.cwd(), f))));
        const includedDirs = new Set(filteredFiles.map(f => dirname(relative(Deno.cwd(), f))));
        
        return Array.from(allDirs).filter(dir => !includedDirs.has(dir));
    }

    /**
     * Log directory group summary
     */
    private logDirectoryGroupSummary(groupName: string, summary: GroupSummary): void {
        const successRate = (summary.successRate * 100).toFixed(1);
        const avgDuration = summary.averageDuration.toFixed(0);
        
        this.logger.info(
            `  📊 ${groupName}: ` +
            `✅ ${summary.successfulFiles} success, ` +
            `⚠️ ${summary.warningFiles} warnings, ` +
            `❌ ${summary.failedFiles} failed ` +
            `(${successRate}% success, ${avgDuration}ms avg)`
        );
    }

    /**
     * Log final directory processing summary
     */
    private logDirectoryProcessingSummary(results: DirectoryGroupedResults): void {
        this.logger.info(`\n📈 Directory Processing Summary:`);
        this.logger.info(`   Total directories: ${results.totalGroups}`);
        this.logger.info(`   Total files: ${results.overallSummary.totalFiles}`);
        this.logger.info(`   Average files per directory: ${(results.overallSummary.totalFiles / results.totalGroups).toFixed(1)}`);
        
        if (results.excludedDirectories.length > 0) {
            this.logger.info(`   Excluded directories: ${results.excludedDirectories.join(', ')}`);
        }
    }

    /**
     * Create empty directory results
     */
    private createEmptyDirectoryResults(): DirectoryGroupedResults {
        return {
            groups: [],
            overallSummary: {
                totalFiles: 0,
                successfulFiles: 0,
                failedFiles: 0,
                warningFiles: 0,
                totalDuration: 0,
                averageDuration: 0,
                successRate: 0,
                errorRate: 0,
                warningRate: 0,
            },
            processingMode: 'grouped',
            totalGroups: 0,
            directoryTree: {
                name: '.',
                path: '.',
                files: [],
                children: [],
                depth: 0,
                totalFiles: 0,
            },
            directoryGroups: [],
            processingOrder: [],
            excludedDirectories: [],
        };
    }

    /**
     * Get directory processing statistics
     */
    getDirectoryStats(results: DirectoryGroupedResults): {
        totalDirectories: number;
        averageFilesPerDirectory: number;
        deepestDirectory: number;
        directoryDistribution: Array<{ directory: string; fileCount: number; successRate: number }>;
        excludedDirectoryCount: number;
    } {
        const directoryDistribution = results.groups.map(group => ({
            directory: group.name,
            fileCount: group.summary.totalFiles,
            successRate: group.summary.successRate,
        }));

        const deepestDirectory = Math.max(
            ...results.directoryGroups.map(g => g.depth),
            0
        );

        return {
            totalDirectories: results.totalGroups,
            averageFilesPerDirectory: results.totalGroups > 0 
                ? results.overallSummary.totalFiles / results.totalGroups 
                : 0,
            deepestDirectory,
            directoryDistribution,
            excludedDirectoryCount: results.excludedDirectories.length,
        };
    }
}