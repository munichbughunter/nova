/**
 * Enhanced Code Review Agent Implementation
 * 
 * This agent extends the ExampleAgent to provide comprehensive code review capabilities
 * with three distinct modes: specific file review, automatic change detection, and pull request review.
 */

import { ExampleAgent } from './example-agent.ts';
import type { 
    AgentContext, 
    AgentResponse, 
    AgentExecuteOptions,
    ReviewCommand, 
    ReviewResult,
    ReviewAnalysis,
    DiffComment,
    PullRequest,
    DiffData 
} from './types.ts';
import { ReviewCommandParser } from '../services/command_parser.ts';
import { CodeAnalysisService } from '../services/analysis/code_analysis_service.ts';
import { createTableFormatter } from '../services/table_formatter.ts';
import { GitServiceImpl } from '../services/repository/git_service.ts';
import { notifyUser, readFile } from './tool-wrappers.ts';
import { ErrorHandlingService } from '../services/error-handling/error-handler.service.ts';
import { ValidationService } from '../services/analysis/validation/validation.service.ts';
import { LLMResponseProcessor } from '../services/llm/llm-response-processor.ts';
import { MonitoringService } from '../services/monitoring/monitoring.service.ts';
import { 
    SequentialFileProcessor, 
    ProcessingModeSelector, 
    ProcessingMode,
    type ProcessingResult,
    type FileProcessor,
    type SequentialProcessingOptions
} from '../services/sequential_processor.ts';

/**
 * Enhanced code review agent that extends the example agent with code review capabilities
 */
export class EnhancedCodeReviewAgent extends ExampleAgent {
    private commandParser: ReviewCommandParser;
    private codeAnalysisService: CodeAnalysisService;
    private tableFormatter: ReturnType<typeof createTableFormatter>;
    private gitService: GitServiceImpl;
    private errorHandler: ErrorHandlingService;
    private validationService: ValidationService;
    private responseProcessor: LLMResponseProcessor;
    private monitoringService: MonitoringService;
    private sequentialProcessor: SequentialFileProcessor;
    private processingModeSelector: ProcessingModeSelector;

    constructor(context: AgentContext) {
        super(context);
        this.logger = this.logger.child('EnhancedCodeReviewAgent');
        this.monitoringService = new MonitoringService(this.logger);
        this.commandParser = new ReviewCommandParser(this.logger);
        this.codeAnalysisService = new CodeAnalysisService(this.logger, context);
        this.tableFormatter = createTableFormatter(this.logger);
        this.gitService = new GitServiceImpl(this.logger, context.workingDirectory);
        this.errorHandler = new ErrorHandlingService(this.logger);
        this.validationService = new ValidationService(this.logger, this.monitoringService);
        this.responseProcessor = new LLMResponseProcessor(this.logger);
        this.sequentialProcessor = new SequentialFileProcessor(this.logger);
        this.processingModeSelector = new ProcessingModeSelector(this.logger);
    }

    /**
     * Resolve file path to handle moved files during refactoring
     */
    private resolveFilePath(originalPath: string): string {
        // Map of old paths to new paths for files that were moved during refactoring
        const pathMappings: Record<string, string> = {
            'src/services/git_service.ts': 'src/services/repository/git_service.ts',
            'src/services/git_service_test.ts': 'src/services/repository/git_service_test.ts',
            'src/services/github_service.ts': 'src/services/repository/github_service.ts',
            'src/services/github_service_test.ts': 'src/services/repository/github_service_test.ts',
            'src/services/repository_detector.ts': 'src/services/repository/repository_detector.ts',
            'src/services/repository_detector_test.ts': 'src/services/repository/repository_detector_test.ts',
            'src/services/repository_service_base.ts': 'src/services/repository/repository_service_base.ts',
            'src/services/gitlab_repository_service.ts': 'src/services/repository/gitlab_repository_service.ts',
            'src/services/code_analysis_service.ts': 'src/services/analysis/code_analysis_service.ts',
            'src/services/code_analysis_service_test.ts': 'src/services/analysis/code_analysis_service_test.ts',
        };

        // Check if we have a mapping for this path
        if (pathMappings[originalPath]) {
            this.logger.debug(`Mapped file path: ${originalPath} -> ${pathMappings[originalPath]}`);
            return pathMappings[originalPath];
        }

        // Return original path if no mapping found
        return originalPath;
    }

    /**
     * Helper method to execute operations with comprehensive error handling
     */
    private async executeWithErrorHandling<T>(
        operation: () => Promise<T>,
        context: { operation: string; [key: string]: unknown },
        options: {
            enableRetry?: boolean;
            enableFallback?: boolean;
            fallbackOperation?: () => Promise<T>;
            maxAttempts?: number;
        } = {}
    ): Promise<T> {
        return await this.errorHandler.executeWithErrorHandling(
            operation,
            {
                filePath: context.filePath as string,
                attemptNumber: 1,
                timestamp: new Date(),
                ...context
            },
            options
        );
    }

    /**
     * Helper method to create error responses in the old format for backward compatibility
     */
    private createErrorResponse(error: unknown, context: { [key: string]: unknown }): string {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return `Error: ${errorMessage}`;
    }

    /**
     * Get review configuration with defaults
     */
    private getReviewConfig() {
        const config = this.context.config;
        return {
            autoPostComments: config.review?.autoPostComments ?? true,
            severityThreshold: config.review?.severityThreshold ?? 'medium',
            maxFilesPerReview: config.review?.maxFilesPerReview ?? 50,
        };
    }

    /**
     * Execute agent with enhanced review capabilities
     */
    override async execute(input: string, options?: AgentExecuteOptions): Promise<AgentResponse> {
        const validatedOptions = this.validateOptions(options);
        
        // Handle case where input starts with agent name (but not review commands)
        let actualInput = input;
        const inputParts = input.trim().split(/\s+/);
        if (inputParts.length > 1 && (inputParts[0] === 'enhanced' || inputParts[0] === 'code-review')) {
            actualInput = inputParts.slice(1).join(' ');
            this.logger.debug(`Detected agent name prefix, using: "${actualInput}"`);
        }
        // Special case: if input starts with 'review' but is not a review command, treat as agent name
        else if (inputParts.length > 1 && inputParts[0] === 'review' && !input.toLowerCase().startsWith('review ')) {
            actualInput = inputParts.slice(1).join(' ');
            this.logger.debug(`Detected 'review' as agent name prefix, using: "${actualInput}"`);
        }
        
        this.logger.info(`Processing enhanced review request: ${actualInput.substring(0, 100)}...`);

        try {
            // Check if this is a help request first
            if (actualInput.toLowerCase().trim() === 'help' || actualInput.toLowerCase().includes('help')) {
                const helpContent = await this.help();
                return this.createResponse(
                    true,
                    helpContent,
                    undefined,
                    undefined,
                    { analysisType: 'help' }
                );
            }

            // If the input doesn't start with 'review' but looks like a file path, prepend 'review'
            let reviewInput = actualInput;
            if (!actualInput.toLowerCase().startsWith('review') && 
                (actualInput.includes('.') || actualInput.includes('/'))) {
                reviewInput = `review ${actualInput}`;
                this.logger.debug(`Prepending 'review' to input: "${reviewInput}"`);
            }

            // Parse the input as a potential review command
            const { command, errors, warnings } = this.commandParser.parseCommandArguments(reviewInput);

            // If there are errors, display them with help
            if (errors.length > 0) {
                const errorMessages = errors.map(e => `❌ ${e}`).join('\n');
                const helpText = this.commandParser.getReviewCommandHelp();
                
                await notifyUser(this.context, {
                    message: 'Review command has errors',
                    type: 'error',
                });

                return this.createResponse(
                    false,
                    `${errorMessages}\n\n${helpText}`,
                    undefined,
                    errors.join('; ')
                );
            }

            // Display warnings if any
            if (warnings.length > 0) {
                const warningMessages = warnings.map(w => `⚠️ ${w}`).join('\n');
                await notifyUser(this.context, {
                    message: warningMessages,
                    type: 'warning',
                });
            }

            // If this is a review command, handle it
            if (command) {
                return await this.handleReviewCommand(command, validatedOptions);
            }

            // Otherwise, fall back to the default agent behavior
            return await super.execute(actualInput, options);
        } catch (error) {
            this.logger.error('Error processing enhanced review request', { 
                error: error instanceof Error ? error.message : 'Unknown error', 
                input: actualInput 
            });
            
            await notifyUser(this.context, {
                message: `Failed to process review request: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error',
            });

            return this.createResponse(
                false,
                `Sorry, I encountered an error while processing your review request.\n\n${this.createErrorResponse(error, { input: actualInput })}`,
                undefined,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    /**
     * Handle review commands based on mode
     */
    private async handleReviewCommand(command: ReviewCommand, options: AgentExecuteOptions): Promise<AgentResponse> {
        try {
            this.logger.debug(`Handling review command: ${command.mode}`);

            switch (command.mode) {
                case 'file':
                    return await this.handleFileReview(command.files || [], options);
                case 'changes':
                    return await this.handleChangesReview(options);
                case 'pr':
                    return await this.handlePRReview(command.prId, options);
                default:
                    throw new Error(`Unsupported review mode: ${command.mode}. Use one of the supported review modes: file, changes, or pr`);
            }
        } catch (error) {
            this.logger.error('Error handling review command', { 
                error: error instanceof Error ? error.message : 'Unknown error', 
                command 
            });
            
            return this.createResponse(
                false,
                `Error handling review command.\n\n${this.createErrorResponse(error, { command })}`,
                undefined,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    /**
     * Handle specific file review mode
     */
    private async handleFileReview(files: string[], options: AgentExecuteOptions): Promise<AgentResponse> {
        const timingId = this.monitoringService.startTiming('file_review', { 
            filesCount: files.length,
            mode: 'file' 
        });
        
        try {
            const reviewConfig = this.getReviewConfig();
            
            // Check if the number of files exceeds the configured limit
            if (files.length > reviewConfig.maxFilesPerReview) {
                throw new Error(`Too many files to review: ${files.length} (limit: ${reviewConfig.maxFilesPerReview}). Reduce the number of files or increase the maxFilesPerReview setting in your configuration.`);
            }

            this.logger.info(`Reviewing ${files.length} files`);

            await notifyUser(this.context, {
                message: `Starting review of ${files.length} file${files.length === 1 ? '' : 's'}...`,
                type: 'info',
            });

            // Determine processing mode based on command type
            const reviewCommand = {
                type: 'files' as const,
                targets: files,
                options: options.context || {}
            };

            const processingMode = this.processingModeSelector.determineProcessingModeAdvanced(
                reviewCommand,
                files.length,
                {
                    forceSequential: options.context?.forceSequential as boolean,
                    forceParallel: options.context?.forceParallel as boolean,
                    sequentialThreshold: options.context?.sequentialThreshold as number
                }
            );

            this.logger.info(`Using ${processingMode} processing mode for ${files.length} files`);

            // Process files based on selected mode
            let results: ReviewResult[];
            if (processingMode === ProcessingMode.SEQUENTIAL) {
                results = await this.processFilesSequentially(files, options);
            } else {
                results = await this.processFilesInParallel(files, options);
            }

            // Log cache statistics
            const cacheStats = this.codeAnalysisService.getCacheStats();
            this.logger.info(`Analysis completed using ${processingMode} mode. Cache stats:`, cacheStats);

            // Format results as a table
            const table = this.tableFormatter.formatReviewResults(results);
            
            // Generate summary if multiple files
            let summary = '';
            if (results.length > 1) {
                // Use the table formatter's summary functionality
                const summaryStats = this.calculateSummaryStats(results);
                summary = `\n\n## Summary\n\n- **Total Files**: ${summaryStats.totalFiles}\n- **Pass**: ${summaryStats.passCount}, **Warning**: ${summaryStats.warningCount}, **Fail**: ${summaryStats.failCount}\n- **Average Coverage**: ${summaryStats.averageCoverage.toFixed(1)}%\n- **Files with Tests**: ${summaryStats.testedFiles}/${summaryStats.totalFiles}\n- **Total Issues**: ${summaryStats.totalIssues} (${summaryStats.highSeverityIssues} high, ${summaryStats.mediumSeverityIssues} medium, ${summaryStats.lowSeverityIssues} low)`;
            }

            // Generate detailed report for each file
            const details = results.map(result => this.formatFileDetails(result)).join('\n\n');

            const responseContent = `# Code Review Results\n\n${table}${summary}\n\n${details}`;

            await notifyUser(this.context, {
                message: `Code review completed for ${results.length} file${results.length === 1 ? '' : 's'} using ${processingMode} processing`,
                type: 'success',
            });

            // Record successful analysis in monitoring
            this.monitoringService.recordAnalysis(
                'file',
                true,
                this.monitoringService.endTiming(timingId, true) || 0,
                files.length,
                this.context.config.ai?.default_provider || 'unknown'
            );

            return this.createResponse(
                true,
                responseContent,
                { results, summary: this.calculateSummaryStats(results), processingMode },
                undefined,
                { 
                    analysisType: 'fileReview',
                    filesAnalyzed: results.length,
                    processingMode,
                    executionTime: Date.now(),
                }
            );
        } catch (error) {
            this.logger.error('Error in file review', { error, files });
            
            // Record failed analysis in monitoring
            this.monitoringService.recordAnalysis(
                'file',
                false,
                this.monitoringService.endTiming(timingId, false) || 0,
                files.length
            );
            
            return this.createResponse(
                false,
                `Error reviewing files: ${error instanceof Error ? error.message : 'Unknown error'}`,
                undefined,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    /**
     * Process files sequentially with progress tracking
     */
    private async processFilesSequentially(files: string[], options: AgentExecuteOptions): Promise<ReviewResult[]> {
        this.logger.info(`Processing ${files.length} files sequentially`);

        // Create a file processor that integrates with the code analysis service
        const fileProcessor: FileProcessor = {
            processFile: async (filePath: string, content?: string): Promise<ReviewAnalysis> => {
                // Read file content if not provided
                let fileContent = content;
                if (!fileContent) {
                    const fileResult = await readFile(this.context, filePath);
                    if (!fileResult.success || !fileResult.data) {
                        throw new Error(`Could not read file: ${fileResult.error || 'Unknown error'}`);
                    }

                    // Extract content from the file result
                    if (typeof fileResult.data === 'string') {
                        fileContent = fileResult.data;
                    } else if (typeof fileResult.data === 'object' && fileResult.data && 'content' in fileResult.data) {
                        fileContent = fileResult.data.content as string;
                    } else {
                        throw new Error(`Unexpected file content format for ${filePath}`);
                    }
                }

                // Use the code analysis service to analyze the file
                return await this.codeAnalysisService.analyzeCode(filePath, fileContent);
            }
        };

        // Set up sequential processing options with progress tracking
        const processingOptions: SequentialProcessingOptions = {
            showProgress: true,
            onFileStart: (file: string, index: number, total: number) => {
                this.logger.debug(`Starting analysis of file ${index + 1}/${total}: ${file}`);
                notifyUser(this.context, {
                    message: `Analyzing file ${index + 1}/${total}: ${file.split('/').pop() || file}`,
                    type: 'info',
                });
            },
            onFileComplete: (file: string, result: ProcessingResult) => {
                const status = result.success ? 'completed' : 'failed';
                this.logger.debug(`File analysis ${status}: ${file} (${result.duration}ms)`);
            },
            onError: (file: string, error: Error) => {
                this.logger.error(`Error processing file ${file}: ${error.message}`);
                notifyUser(this.context, {
                    message: `Error analyzing ${file}: ${error.message}`,
                    type: 'error',
                });
            },
            continueOnError: true,
            maxErrors: 10
        };

        // Process files sequentially
        const processingResults = await this.sequentialProcessor.processFiles(
            files,
            fileProcessor,
            processingOptions
        );

        // Transform processing results to review results
        const results: ReviewResult[] = processingResults.map(result => {
            if (result.error) {
                return this.createErrorResult(result.file, result.error.message);
            }
            
            return {
                file: result.file,
                ...result.result!,
            };
        });

        // Log processing statistics
        const stats = this.sequentialProcessor.getStats(processingResults);
        this.logger.info(`Sequential processing stats:`, stats);

        return results;
    }

    /**
     * Process files in parallel (existing behavior)
     */
    private async processFilesInParallel(files: string[], options: AgentExecuteOptions): Promise<ReviewResult[]> {
        this.logger.info(`Processing ${files.length} files in parallel`);

        // Read all files first
        const fileContents: Array<{ filePath: string; content: string }> = [];
        for (const filePath of files) {
            try {
                this.logger.debug(`Reading file: ${filePath}`);
                
                // Read the file content with error handling and retry
                const fileContent = await this.executeWithErrorHandling(
                    async () => {
                        const fileResult = await readFile(this.context, filePath);
                        if (!fileResult.success || !fileResult.data) {
                            throw new Error(`Could not read file: ${fileResult.error || 'Unknown error'}. Check that the file exists and you have read permissions: ${filePath}`);
                        }

                        // Extract content from the file result
                        let content: string;
                        if (typeof fileResult.data === 'string') {
                            content = fileResult.data;
                        } else if (typeof fileResult.data === 'object' && fileResult.data && 'content' in fileResult.data) {
                            content = fileResult.data.content as string;
                        } else {
                            throw new Error(`Unexpected file content format for ${filePath}. The file content format is not supported for analysis`);
                        }

                        // Ensure content is a string
                        if (typeof content !== 'string') {
                            throw new Error(`File content is not a string for ${filePath}. Only text files can be analyzed for code review`);
                        }

                        return content;
                    },
                    { operation: 'readFile', filePath },
                    { enableRetry: true, maxAttempts: 3 }
                );
                
                fileContents.push({ filePath, content: fileContent });
            } catch (fileError) {
                this.logger.error(`Error reading file: ${filePath}`, { 
                    error: fileError instanceof Error ? fileError.message : 'Unknown error'
                });
                // Still add to list with empty content to maintain order
                fileContents.push({ filePath, content: '' });
            }
        }

        // Analyze files in parallel with caching
        const analysisResults = await this.codeAnalysisService.analyzeMultipleFiles(
            fileContents,
            (completed, total) => {
                if (total > 1) {
                    notifyUser(this.context, {
                        message: `Analyzed ${completed}/${total} files...`,
                        type: 'info',
                    });
                }
            }
        );

        // Transform results
        const results: ReviewResult[] = analysisResults.map(result => {
            if (result.error) {
                return this.createErrorResult(result.filePath, result.error.message);
            }
            
            return {
                file: result.filePath,
                ...result.result,
            };
        });

        return results;
    }

    /**
     * Handle automatic change detection review mode
     */
    private async handleChangesReview(options: AgentExecuteOptions): Promise<AgentResponse> {
        const timingId = this.monitoringService.startTiming('changes_review', { 
            mode: 'changes' 
        });
        
        try {
            this.logger.info('Starting automatic change detection review');

            await notifyUser(this.context, {
                message: 'Detecting changed files in repository...',
                type: 'info',
            });

            // Check if we're in a Git repository with error handling
            const isGitRepo = await this.executeWithErrorHandling(
                () => this.gitService.isGitRepository(),
                { operation: 'isGitRepository' },
                { enableRetry: true, maxAttempts: 3 }
            );
            
            if (!isGitRepo) {
                throw new Error('The current directory is not a Git repository. Navigate to a Git repository directory or initialize a new Git repository with `git init`');
            }

            // Get changed files from Git with error handling and retry
            const changedFiles = await this.executeWithErrorHandling(
                () => this.gitService.getChangedFiles(),
                { operation: 'getChangedFiles' },
                { enableRetry: true, maxAttempts: 3 }
            );
            
            if (changedFiles.length === 0) {
                await notifyUser(this.context, {
                    message: 'No changed files detected',
                    type: 'info',
                });

                return this.createResponse(
                    true,
                    '# Change Detection Review\n\n✅ No changed files detected in the current repository.\n\nAll files are up to date with no modifications, additions, or deletions since the last commit.',
                    { changedFiles: [], results: [] },
                    undefined,
                    { 
                        analysisType: 'changesReview',
                        filesAnalyzed: 0,
                        changedFilesCount: 0,
                    }
                );
            }

            this.logger.info(`Found ${changedFiles.length} changed files`);

            await notifyUser(this.context, {
                message: `Found ${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}. Starting analysis...`,
                type: 'info',
            });

            // Filter out files that might not be suitable for code review
            const reviewableFiles = changedFiles.filter(file => this.isReviewableFile(file));
            
            if (reviewableFiles.length === 0) {
                return this.createResponse(
                    true,
                    `# Change Detection Review\n\n📋 Found ${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}, but none are suitable for code review.\n\n**Changed files:**\n${changedFiles.map(f => `- ${f}`).join('\n')}\n\n*Note: Only source code files are reviewed. Binary files, images, and other non-code files are excluded.*`,
                    { changedFiles, reviewableFiles: [], results: [] },
                    undefined,
                    { 
                        analysisType: 'changesReview',
                        filesAnalyzed: 0,
                        changedFilesCount: changedFiles.length,
                        reviewableFilesCount: 0,
                    }
                );
            }

            // Read all reviewable files first
            const fileContents: Array<{ filePath: string; content: string }> = [];
            for (const filePath of reviewableFiles) {
                try {
                    this.logger.debug(`Reading changed file: ${filePath}`);
                    
                    // Try to get file changes to understand what was modified (optional)
                    let changeType = 'modified';
                    try {
                        const fileChanges = await this.gitService.getFileChanges(filePath);
                        changeType = fileChanges.length > 0 ? fileChanges[0].type : 'modified';
                    } catch (gitError) {
                        // Git diff failed, but we can still analyze the file
                        this.logger.debug(`Could not get Git changes for ${filePath}, proceeding with analysis`, { error: gitError });
                    }
                    
                    // Read the current file content
                    const fileResult = await readFile(this.context, filePath);
                    if (!fileResult.success || !fileResult.data) {
                        this.logger.warn(`Failed to read changed file: ${filePath}`, { error: fileResult.error });
                        
                        // For deleted files or read errors, add empty content
                        fileContents.push({ filePath, content: '' });
                        continue;
                    }

                    // Extract content from the file result
                    let fileContent: string;
                    if (typeof fileResult.data === 'string') {
                        fileContent = fileResult.data;
                    } else if (typeof fileResult.data === 'object' && fileResult.data && 'content' in fileResult.data) {
                        fileContent = fileResult.data.content as string;
                    } else {
                        this.logger.warn(`Unexpected file content format for: ${filePath}`);
                        fileContents.push({ filePath, content: '' });
                        continue;
                    }

                    // Ensure content is a string
                    if (typeof fileContent !== 'string') {
                        this.logger.warn(`File content is not a string for: ${filePath}`);
                        fileContents.push({ filePath, content: '' });
                        continue;
                    }

                    fileContents.push({ filePath, content: fileContent });
                } catch (fileError) {
                    this.logger.error(`Error reading changed file: ${filePath}`, { error: fileError });
                    fileContents.push({ filePath, content: '' });
                }
            }

            // Determine processing mode for changes review
            const reviewCommand = {
                type: 'changes' as const,
                targets: reviewableFiles,
                options: options.context || {}
            };

            const processingMode = this.processingModeSelector.determineProcessingModeAdvanced(
                reviewCommand,
                reviewableFiles.length,
                {
                    forceSequential: options.context?.forceSequential as boolean,
                    forceParallel: options.context?.forceParallel as boolean,
                    sequentialThreshold: options.context?.sequentialThreshold as number
                }
            );

            this.logger.info(`Using ${processingMode} processing mode for ${reviewableFiles.length} changed files`);

            // Process files based on selected mode
            let results: ReviewResult[];
            if (processingMode === ProcessingMode.SEQUENTIAL) {
                results = await this.processFilesSequentially(reviewableFiles, options);
            } else {
                // Analyze files in parallel with caching (existing behavior)
                this.logger.info(`Starting parallel analysis of ${fileContents.length} changed files`);
                const analysisResults = await this.codeAnalysisService.analyzeMultipleFiles(
                    fileContents,
                    (completed, total) => {
                        if (total > 1) {
                            notifyUser(this.context, {
                                message: `Analyzed ${completed}/${total} changed files...`,
                                type: 'info',
                            });
                        }
                    }
                );

                // Transform results
                results = analysisResults.map(result => {
                    if (result.error) {
                        return this.createErrorResult(result.filePath, result.error.message);
                    }
                    
                    return {
                        file: result.filePath,
                        ...result.result,
                    };
                });
            }

            // Log cache statistics
            const cacheStats = this.codeAnalysisService.getCacheStats();
            this.logger.info(`Change analysis completed. Cache stats:`, cacheStats);

            // Format results as a table
            const table = this.tableFormatter.formatReviewResults(results);
            
            // Generate summary
            let summary = '';
            if (results.length > 1) {
                const summaryStats = this.calculateSummaryStats(results);
                summary = `\n\n## Summary\n\n- **Total Changed Files**: ${changedFiles.length}\n- **Reviewable Files**: ${reviewableFiles.length}\n- **Pass**: ${summaryStats.passCount}, **Warning**: ${summaryStats.warningCount}, **Fail**: ${summaryStats.failCount}\n- **Average Coverage**: ${summaryStats.averageCoverage.toFixed(1)}%\n- **Files with Tests**: ${summaryStats.testedFiles}/${summaryStats.totalFiles}\n- **Total Issues**: ${summaryStats.totalIssues} (${summaryStats.highSeverityIssues} high, ${summaryStats.mediumSeverityIssues} medium, ${summaryStats.lowSeverityIssues} low)`;
            }

            // Show list of all changed files (including non-reviewable ones)
            let changedFilesList = '';
            if (changedFiles.length > reviewableFiles.length) {
                const nonReviewableFiles = changedFiles.filter(f => !reviewableFiles.includes(f));
                changedFilesList = `\n\n## All Changed Files\n\n**Reviewed:**\n${reviewableFiles.map(f => `- ✅ ${f}`).join('\n')}\n\n**Not Reviewed:**\n${nonReviewableFiles.map(f => `- ⏭️ ${f} (non-code file)`).join('\n')}`;
            }

            // Generate detailed report for each reviewed file
            const details = results.map(result => this.formatFileDetails(result)).join('\n\n');

            const responseContent = `# Change Detection Review\n\n${table}${summary}${changedFilesList}\n\n${details}`;

            await notifyUser(this.context, {
                message: `Change detection review completed for ${results.length} file${results.length === 1 ? '' : 's'} using ${processingMode} processing`,
                type: 'success',
            });

            // Record successful analysis in monitoring
            this.monitoringService.recordAnalysis(
                'changes',
                true,
                this.monitoringService.endTiming(timingId, true) || 0,
                reviewableFiles.length
            );

            return this.createResponse(
                true,
                responseContent,
                { 
                    changedFiles, 
                    reviewableFiles, 
                    results, 
                    summary: this.calculateSummaryStats(results) 
                },
                undefined,
                { 
                    analysisType: 'changesReview',
                    filesAnalyzed: results.length,
                    changedFilesCount: changedFiles.length,
                    reviewableFilesCount: reviewableFiles.length,
                    processingMode,
                    executionTime: Date.now(),
                }
            );
        } catch (error) {
            this.logger.error('Error in changes review', { 
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            // Record failed analysis in monitoring
            this.monitoringService.recordAnalysis(
                'changes',
                false,
                this.monitoringService.endTiming(timingId, false) || 0,
                0
            );
            
            await notifyUser(this.context, {
                message: `Failed to perform change detection review: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error',
            });

            return this.createResponse(
                false,
                `Error performing change detection review.\n\n${this.createErrorResponse(error, { operation: 'changesReview' })}`,
                undefined,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    /**
     * Handle PR review mode
     */
    private async handlePRReview(prId: string | undefined, options: AgentExecuteOptions): Promise<AgentResponse> {
        const timingId = this.monitoringService.startTiming('pr_review', { 
            mode: 'pr',
            prId 
        });
        
        try {
            this.logger.info('Starting pull request review mode');

            await notifyUser(this.context, {
                message: 'Starting pull request review...',
                type: 'info',
            });

            // Import repository services
            const { RepositoryDetector } = await import('../services/repository/repository_detector.ts');
            const { GitLabRepositoryService } = await import('../services/repository/gitlab_repository_service.ts');
            const { GitHubServiceImpl } = await import('../services/repository/github_service.ts');

            // Detect repository type with error handling
            const repositoryDetector = new RepositoryDetector(this.logger, this.gitService);
            const repoType: 'gitlab' | 'github' | 'unknown' = await this.executeWithErrorHandling(
                () => repositoryDetector.detectRepositoryType(),
                { operation: 'detectRepositoryType' },
                { enableRetry: true, maxAttempts: 3 }
            );

            if (repoType === 'unknown') {
                throw new Error('Unable to detect repository type. Ensure you are in a Git repository with a configured remote (GitLab or GitHub). Run `git remote -v` to check your remotes.');
            }

            this.logger.debug(`Detected repository type: ${repoType}`);

            // Create appropriate repository service
            let repositoryService;
            if (repoType === 'gitlab') {
                repositoryService = new GitLabRepositoryService(this.logger, this.gitService, this.context.config);
            } else {
                repositoryService = new GitHubServiceImpl(this.logger, this.gitService, this.context.config);
            }

            await notifyUser(this.context, {
                message: `Detected ${repoType.toUpperCase()} repository. Fetching pull requests...`,
                type: 'info',
            });

            // Get available pull requests with error handling and retry
            const pullRequests = await this.executeWithErrorHandling(
                () => repositoryService.getPullRequests(),
                { operation: 'getPullRequests', repositoryType: repoType },
                { enableRetry: true, maxAttempts: 3 }
            ) as PullRequest[];

            if (pullRequests.length === 0) {
                await notifyUser(this.context, {
                    message: 'No open pull requests found',
                    type: 'info',
                });

                return this.createResponse(
                    true,
                    `# Pull Request Review\n\n✅ No open pull requests found in the ${repoType.toUpperCase()} repository.\n\nThere are currently no pull requests available for review.`,
                    { pullRequests: [], repositoryType: repoType },
                    undefined,
                    { 
                        analysisType: 'prReview',
                        repositoryType: repoType,
                        pullRequestsCount: 0,
                    }
                );
            }

            this.logger.info(`Found ${pullRequests.length} open pull requests`);

            // If a specific PR ID was provided, use it
            let selectedPR;
            if (prId) {
                selectedPR = pullRequests.find(pr => pr.id === prId);
                if (!selectedPR) {
                    return this.createResponse(
                        false,
                        `Error: Pull request with ID "${prId}" not found. Available PRs: ${pullRequests.map(pr => `#${pr.id}`).join(', ')}`,
                        undefined,
                        'PR not found'
                    );
                }
            } else {
                // For now, select the first PR (in a real implementation, we'd show a selection interface)
                selectedPR = pullRequests[0];
                
                if (pullRequests.length > 1) {
                    await notifyUser(this.context, {
                        message: `Multiple PRs found. Reviewing the first one: #${selectedPR.id} - ${selectedPR.title}`,
                        type: 'info',
                    });
                }
            }

            await notifyUser(this.context, {
                message: `Reviewing PR #${selectedPR.id}: ${selectedPR.title}`,
                type: 'info',
            });

            // Get PR diff with error handling and retry
            this.logger.debug(`Fetching diff for PR #${selectedPR.id}`);
            const diffData = await this.executeWithErrorHandling(
                () => repositoryService.getPullRequestDiff(selectedPR.id),
                { operation: 'getPullRequestDiff', prId: selectedPR.id, repositoryType: repoType },
                { enableRetry: true, maxAttempts: 3 }
            ) as DiffData;

            if (diffData.files.length === 0) {
                return this.createResponse(
                    true,
                    `# Pull Request Review\n\n## PR #${selectedPR.id}: ${selectedPR.title}\n\n✅ No file changes found in this pull request.\n\nThe pull request appears to have no file modifications to review.`,
                    { selectedPR, diffData, results: [] },
                    undefined,
                    { 
                        analysisType: 'prReview',
                        repositoryType: repoType,
                        prId: selectedPR.id,
                        filesAnalyzed: 0,
                    }
                );
            }

            this.logger.info(`Analyzing ${diffData.files.length} changed files in PR`);

            await notifyUser(this.context, {
                message: `Found ${diffData.files.length} changed files. Starting analysis...`,
                type: 'info',
            });

            // Filter reviewable files
            const reviewableFiles = diffData.files.filter(file => 
                this.isReviewableFile(file.filePath) && file.changeType !== 'deleted'
            );

            if (reviewableFiles.length === 0) {
                return this.createResponse(
                    true,
                    `# Pull Request Review\n\n## PR #${selectedPR.id}: ${selectedPR.title}\n\n📋 Found ${diffData.files.length} changed file${diffData.files.length === 1 ? '' : 's'}, but none are suitable for code review.\n\n**Changed files:**\n${diffData.files.map(f => `- ${f.filePath} (${f.changeType})`).join('\n')}\n\n*Note: Only source code files are reviewed. Binary files, images, and other non-code files are excluded.*`,
                    { selectedPR, diffData, reviewableFiles: [], results: [] },
                    undefined,
                    { 
                        analysisType: 'prReview',
                        repositoryType: repoType,
                        prId: selectedPR.id,
                        filesAnalyzed: 0,
                        changedFilesCount: diffData.files.length,
                        reviewableFilesCount: 0,
                    }
                );
            }

            // Analyze each reviewable file
            const results: ReviewResult[] = [];
            const comments: Array<{ file: string; comment: DiffComment; posted: boolean; error?: string }> = [];
            let processedCount = 0;

            for (const diffFile of reviewableFiles) {
                try {
                    this.logger.debug(`Processing PR file: ${diffFile.filePath}`);
                    
                    // Resolve the actual file path (handle moved files)
                    const resolvedPath = this.resolveFilePath(diffFile.filePath);
                    this.logger.debug(`Resolved file path: ${diffFile.filePath} -> ${resolvedPath}`);
                    
                    // Read the current file content with error handling and retry
                    const fileContent = await this.executeWithErrorHandling(
                        async () => {
                            const fileResult = await readFile(this.context, resolvedPath);
                            if (!fileResult.success || !fileResult.data) {
                                throw new Error(`Could not read file: ${fileResult.error || 'Unknown error'}. Check that the file exists and you have read permissions: ${diffFile.filePath}`);
                            }

                            // Extract content from the file result
                            let content: string;
                            if (typeof fileResult.data === 'string') {
                                content = fileResult.data;
                            } else if (typeof fileResult.data === 'object' && fileResult.data && 'content' in fileResult.data) {
                                content = fileResult.data.content as string;
                            } else {
                                throw new Error(`Unexpected file content format for ${diffFile.filePath}. The file content format is not supported for analysis`);
                            }

                            // Ensure content is a string
                            if (typeof content !== 'string') {
                                throw new Error(`File content is not a string for ${diffFile.filePath}. Only text files can be analyzed for code review`);
                            }

                            return content;
                        },
                        { operation: 'readPRFile', filePath: diffFile.filePath, changeType: diffFile.changeType },
                        { enableRetry: true, maxAttempts: 3 }
                    );

                    // Analyze the file with error handling and retry
                    this.logger.debug(`Analyzing PR file: ${diffFile.filePath} (${diffFile.changeType})`);
                    const analysis = await this.executeWithErrorHandling(
                        () => this.codeAnalysisService.analyzeCode(diffFile.filePath, fileContent),
                        { operation: 'analyzePRFile', filePath: diffFile.filePath },
                        { enableRetry: true, maxAttempts: 3 }
                    );
                    
                    const result: ReviewResult = {
                        file: diffFile.filePath,
                        ...analysis,
                    };
                    results.push(result);

                    // Try to post comments for issues found with graceful degradation
                    if (result.issues.length > 0) {
                        const reviewConfig = this.getReviewConfig();
                        
                        for (const issue of result.issues) {
                            // Filter issues based on severity threshold
                            const severityLevels = { low: 1, medium: 2, high: 3 };
                            const issueSeverityLevel = severityLevels[issue.severity];
                            const thresholdLevel = severityLevels[reviewConfig.severityThreshold];
                            
                            if (issueSeverityLevel < thresholdLevel) {
                                this.logger.debug(`Skipping issue below severity threshold: ${issue.severity} < ${reviewConfig.severityThreshold}`);
                                continue;
                            }
                            
                            const diffComment: DiffComment = {
                                filePath: diffFile.filePath,
                                line: issue.line,
                                message: `**${issue.type.toUpperCase()} (${issue.severity})**\n\n${issue.message}`,
                                severity: issue.severity === 'high' ? 'error' : 
                                         issue.severity === 'medium' ? 'warning' : 'info',
                            };

                            // Check if auto-posting is enabled
                            if (reviewConfig.autoPostComments) {
                                // Use graceful degradation for comment posting
                                let commentResult: { posted: boolean; error?: string };
                                try {
                                    await this.executeWithErrorHandling(
                                        // Primary operation: post comment to repository
                                        async () => {
                                            await repositoryService.postDiffComment(selectedPR.id, diffComment);
                                        },
                                        { 
                                            operation: 'postComment',
                                            filePath: diffFile.filePath, 
                                            line: issue.line, 
                                            prId: selectedPR.id,
                                            repositoryType: repoType 
                                        },
                                        {
                                            enableRetry: true,
                                            maxAttempts: 3
                                        }
                                    );
                                    commentResult = { posted: true };
                                } catch (error) {
                                    this.logger.debug(`Comment posting failed, storing locally for ${diffFile.filePath}:${issue.line}`);
                                    commentResult = { posted: false, error: 'Failed to post to repository' };
                                }

                                comments.push({ 
                                    file: diffFile.filePath, 
                                    comment: diffComment, 
                                    posted: commentResult.posted,
                                    error: commentResult.error
                                });
                                
                                if (commentResult.posted) {
                                    this.logger.debug(`Posted comment for ${diffFile.filePath}:${issue.line}`);
                                } else {
                                    this.logger.debug(`Comment stored locally for ${diffFile.filePath}:${issue.line}`);
                                }
                            } else {
                                // Auto-posting disabled, store comment locally only
                                this.logger.debug(`Auto-posting disabled, storing comment locally for ${diffFile.filePath}:${issue.line}`);
                                comments.push({ 
                                    file: diffFile.filePath, 
                                    comment: diffComment, 
                                    posted: false,
                                    error: 'Auto-posting disabled in configuration'
                                });
                            }
                        }
                    }

                    processedCount++;
                    
                    // Update progress for multiple files
                    if (reviewableFiles.length > 1) {
                        await notifyUser(this.context, {
                            message: `Analyzed ${processedCount}/${reviewableFiles.length} files in PR...`,
                            type: 'info',
                        });
                    }
                } catch (fileError) {
                    this.logger.error(`Error processing PR file: ${diffFile.filePath}`, { error: fileError });
                    results.push(this.createErrorResult(diffFile.filePath, fileError instanceof Error ? fileError.message : 'Unknown error'));
                }
            }

            // Format results as a table
            const table = this.tableFormatter.formatReviewResults(results);
            
            // Generate summary
            const summaryStats = this.calculateSummaryStats(results);
            const postedComments = comments.filter(c => c.posted).length;
            const failedComments = comments.filter(c => !c.posted).length;
            
            const summary = `\n\n## Summary\n\n- **PR**: #${selectedPR.id} - ${selectedPR.title}\n- **Author**: ${selectedPR.author}\n- **Repository**: ${repoType.toUpperCase()}\n- **Total Changed Files**: ${diffData.files.length}\n- **Reviewable Files**: ${reviewableFiles.length}\n- **Pass**: ${summaryStats.passCount}, **Warning**: ${summaryStats.warningCount}, **Fail**: ${summaryStats.failCount}\n- **Average Coverage**: ${summaryStats.averageCoverage.toFixed(1)}%\n- **Files with Tests**: ${summaryStats.testedFiles}/${summaryStats.totalFiles}\n- **Total Issues**: ${summaryStats.totalIssues} (${summaryStats.highSeverityIssues} high, ${summaryStats.mediumSeverityIssues} medium, ${summaryStats.lowSeverityIssues} low)\n- **Comments Posted**: ${postedComments}/${comments.length}${failedComments > 0 ? ` (${failedComments} failed)` : ''}`;

            // Show list of all changed files
            let changedFilesList = '';
            if (diffData.files.length > reviewableFiles.length) {
                const nonReviewableFiles = diffData.files.filter(f => !reviewableFiles.some(rf => rf.filePath === f.filePath));
                changedFilesList = `\n\n## All Changed Files\n\n**Reviewed:**\n${reviewableFiles.map(f => `- ✅ ${f.filePath} (${f.changeType})`).join('\n')}\n\n**Not Reviewed:**\n${nonReviewableFiles.map(f => `- ⏭️ ${f.filePath} (${f.changeType}, non-code file)`).join('\n')}`;
            }

            // Generate detailed report for each reviewed file
            const details = results.map(result => this.formatFileDetails(result)).join('\n\n');

            // Comment posting summary
            let commentSummary = '';
            if (comments.length > 0) {
                const successfulComments = comments.filter(c => c.posted);
                const failedComments = comments.filter(c => !c.posted);
                
                commentSummary = `\n\n## Comment Posting Results\n\n`;
                
                if (successfulComments.length > 0) {
                    commentSummary += `**Successfully Posted (${successfulComments.length}):**\n${successfulComments.map(c => `- ✅ ${c.file}:${c.comment.line}`).join('\n')}\n\n`;
                }
                
                if (failedComments.length > 0) {
                    commentSummary += `**Failed to Post (${failedComments.length}):**\n${failedComments.map(c => `- ❌ ${c.file}:${c.comment.line} - ${c.error}`).join('\n')}\n\n`;
                }
            }

            const responseContent = `# Pull Request Review\n\n${table}${summary}${changedFilesList}${commentSummary}\n\n${details}`;

            const successMessage = postedComments > 0 
                ? `PR review completed with ${postedComments} comment${postedComments === 1 ? '' : 's'} posted`
                : `PR review completed for ${results.length} file${results.length === 1 ? '' : 's'}`;

            await notifyUser(this.context, {
                message: successMessage,
                type: 'success',
            });

            // Record successful analysis in monitoring
            this.monitoringService.recordAnalysis(
                'pr',
                true,
                this.monitoringService.endTiming(timingId, true) || 0,
                reviewableFiles.length
            );

            return this.createResponse(
                true,
                responseContent,
                { 
                    selectedPR,
                    diffData, 
                    reviewableFiles, 
                    results, 
                    comments,
                    summary: summaryStats,
                    repositoryType: repoType,
                },
                undefined,
                { 
                    analysisType: 'prReview',
                    repositoryType: repoType,
                    prId: selectedPR.id,
                    filesAnalyzed: results.length,
                    changedFilesCount: diffData.files.length,
                    reviewableFilesCount: reviewableFiles.length,
                    commentsPosted: postedComments,
                    commentsFailed: failedComments,
                    executionTime: Date.now(),
                }
            );
        } catch (error) {
            this.logger.error('Error in PR review', { 
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            // Record failed analysis in monitoring
            this.monitoringService.recordAnalysis(
                'pr',
                false,
                this.monitoringService.endTiming(timingId, false) || 0,
                0
            );
            
            await notifyUser(this.context, {
                message: `Failed to perform PR review: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error',
            });

            return this.createResponse(
                false,
                `Error performing pull request review.\n\n${this.createErrorResponse(error, { operation: 'prReview', prId })}`,
                undefined,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    /**
     * Create an error result for a file that couldn't be processed
     */
    private createErrorResult(filePath: string, errorMessage: string): ReviewResult {
        return {
            file: filePath,
            grade: 'F',
            coverage: 0,
            testsPresent: false,
            value: 'low',
            state: 'fail',
            issues: [{
                line: 1,
                severity: 'high',
                type: 'bug',
                message: `Error: ${errorMessage}`,
            }],
            suggestions: ['Fix file access or format issues'],
        };
    }

    /**
     * Format detailed file review results
     */
    private formatFileDetails(result: ReviewResult): string {
        const { file, grade, coverage, testsPresent, value, state, issues, suggestions } = result;
        
        const issuesText = issues.length > 0
            ? issues.map(issue => `- **${issue.type.toUpperCase()} (${issue.severity})**: Line ${issue.line} - ${issue.message}`).join('\n')
            : 'No issues found.';
        
        const suggestionsText = suggestions.length > 0
            ? suggestions.map(suggestion => `- ${suggestion}`).join('\n')
            : 'No suggestions.';

        const testsText = testsPresent ? '✅ Tests present' : '❌ No tests found';
        
        return `## ${file}

**Grade**: ${grade} | **Coverage**: ${coverage}% | **Value**: ${value} | **State**: ${state}

**Summary**: Analysis completed for ${file}

### Issues

${issuesText}

### Suggestions

${suggestionsText}

### Testing

${testsText}`;
    }

    /**
     * Calculate summary statistics for multiple files
     */
    private calculateSummaryStats(results: ReviewResult[]) {
        const totalFiles = results.length;
        const passCount = results.filter(r => r.state === 'pass').length;
        const warningCount = results.filter(r => r.state === 'warning').length;
        const failCount = results.filter(r => r.state === 'fail').length;
        
        const averageCoverage = results.reduce((sum, r) => sum + r.coverage, 0) / totalFiles;
        const testedFiles = results.filter(r => r.testsPresent).length;
        
        const allIssues = results.flatMap(r => r.issues);
        const totalIssues = allIssues.length;
        const highSeverityIssues = allIssues.filter(i => i.severity === 'high').length;
        const mediumSeverityIssues = allIssues.filter(i => i.severity === 'medium').length;
        const lowSeverityIssues = allIssues.filter(i => i.severity === 'low').length;
        
        return {
            totalFiles,
            passCount,
            warningCount,
            failCount,
            averageCoverage,
            testedFiles,
            totalIssues,
            highSeverityIssues,
            mediumSeverityIssues,
            lowSeverityIssues,
        };
    }

    /**
     * Check if a file is suitable for code review
     */
    private isReviewableFile(filePath: string): boolean {
        // First, exclude common non-reviewable patterns (this takes precedence)
        const excludePatterns = [
            // Binary and media files
            /\.(exe|dll|so|dylib|a|lib|bin|obj|o)$/i,
            /\.(jpg|jpeg|png|gif|bmp|svg|ico|webp)$/i,
            /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i,
            /\.(mp3|wav|flac|aac|ogg|wma)$/i,
            /\.(zip|tar|gz|rar|7z|bz2|xz)$/i,
            /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
            // Lock files and generated files
            /\.(lock|log|tmp|temp|cache)$/i,
            /package-lock\.json$/i,
            /yarn\.lock$/i,
            /composer\.lock$/i,
            // IDE and system files
            /\.(DS_Store|thumbs\.db)$/i,
            /\.(idea|vscode|vs)$/i,
        ];

        // Check if file matches exclude patterns first
        if (excludePatterns.some(pattern => pattern.test(filePath))) {
            return false;
        }

        // Get file extension
        const extension = filePath.split('.').pop()?.toLowerCase() || '';
        
        // Define reviewable file extensions
        const reviewableExtensions = [
            // Programming languages
            'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt',
            'scala', 'clj', 'hs', 'elm', 'dart', 'vue', 'svelte',
            // Web technologies
            'html', 'htm', 'css', 'scss', 'sass', 'less',
            // Configuration and data files
            'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf',
            // Shell scripts
            'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
            // Documentation (code-related)
            'md', 'rst', 'txt',
            // Build and project files
            'dockerfile', 'makefile', 'cmake', 'gradle', 'maven', 'sbt',
        ];

        // Check if extension is reviewable
        if (reviewableExtensions.includes(extension)) {
            return true;
        }

        // Check for files without extensions that might be code
        const fileName = filePath.split('/').pop()?.toLowerCase() || '';
        const codeFileNames = [
            'dockerfile', 'makefile', 'rakefile', 'gemfile', 'podfile',
            'vagrantfile', 'jenkinsfile', 'gulpfile', 'gruntfile'
        ];

        if (codeFileNames.includes(fileName)) {
            return true;
        }

        // If file is in certain directories, it might be reviewable
        const reviewableDirs = ['src', 'lib', 'app', 'components', 'utils', 'services', 'api', 'config', 'scripts'];
        const pathParts = filePath.split('/');
        
        if (pathParts.some(part => reviewableDirs.includes(part.toLowerCase()))) {
            return true;
        }

        // Default to not reviewable for unknown file types
        return false;
    }

    /**
     * Provide help specific to the enhanced code review agent
     */
    override async help(): Promise<string> {
        const baseHelp = await super.help();
        const reviewHelp = this.commandParser.getReviewCommandHelp();
        
        return `# Enhanced Code Review Agent Help

## Enhanced Capabilities
- **Specific File Review**: Analyze individual files with comprehensive feedback
- **Change Detection**: Automatically review modified files in your Git repository
- **Pull Request Review**: Review PRs/MRs with automated feedback posting

${reviewHelp}

## Review Features
- **Structured Analysis**: Grades (A-F), coverage assessment, test presence detection
- **Security & Performance**: Identifies vulnerabilities and optimization opportunities
- **Best Practices**: Checks adherence to coding standards and clean code principles
- **Business Value**: Evaluates code impact and importance
- **CLI Table Output**: Color-coded results with clear status indicators
- **Line-Specific Issues**: Detailed reporting with exact line numbers and suggestions

## Platform Integration
- **GitLab**: Automatic MR detection and comment posting
- **GitHub**: PR analysis and review comment integration
- **Git Integration**: Smart change detection and diff analysis

## Configuration Options
- \`review.autoPostComments\`: Enable/disable automatic comment posting (default: true)
- \`review.severityThreshold\`: Minimum severity for reporting (low/medium/high, default: medium)
- \`review.maxFilesPerReview\`: Maximum files per review session (default: 50)
- \`github.token\`: GitHub API token for PR integration
- \`github.apiUrl\`: GitHub API URL (default: https://api.github.com)

## Requirements
- LLM provider (OpenAI, Ollama, or fallback mode)
- Git repository for change detection and PR modes
- GitLab/GitHub API access for PR review mode
- File system access for code analysis

---

${baseHelp}`;
    }
}

/**
 * Factory function to create and configure the enhanced code review agent
 */
export function createEnhancedCodeReviewAgent(context: AgentContext): EnhancedCodeReviewAgent {
    return new EnhancedCodeReviewAgent(context);
}