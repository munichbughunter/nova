import type { Logger } from '../utils/logger.ts';
import type { ReviewAnalysis } from '../agents/types.ts';

/**
 * Processing modes for file analysis
 */
export enum ProcessingMode {
    SEQUENTIAL = 'sequential',
    PARALLEL = 'parallel'
}

/**
 * File processing status
 */
export enum FileStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    SUCCESS = 'success',
    WARNING = 'warning',
    ERROR = 'error'
}

/**
 * Result of processing a single file
 */
export interface ProcessingResult {
    file: string;
    success: boolean;
    result?: ReviewAnalysis;
    error?: Error;
    duration: number;
    status: FileStatus;
    startTime: Date;
    endTime?: Date;
}

/**
 * File processor function interface
 */
export interface FileProcessor {
    processFile(filePath: string, content?: string): Promise<ReviewAnalysis>;
}

/**
 * Options for sequential processing
 */
export interface SequentialProcessingOptions {
    showProgress?: boolean;
    onFileStart?: (file: string, index: number, total: number) => void;
    onFileComplete?: (file: string, result: ProcessingResult) => void;
    onError?: (file: string, error: Error) => void;
    continueOnError?: boolean;
    maxErrors?: number;
}

/**
 * Review command types for processing mode selection
 */
export interface ReviewCommand {
    type: 'files' | 'directory' | 'pr' | 'changes';
    targets: string[];
    options?: Record<string, unknown>;
}

/**
 * Queued file for processing
 */
export interface QueuedFile {
    path: string;
    status: FileStatus;
    result?: ProcessingResult;
    startTime?: Date;
    endTime?: Date;
    index: number;
}

/**
 * Sequential file processor for handling files one by one
 */
export class SequentialFileProcessor {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child('SequentialFileProcessor');
    }

    /**
     * Process files sequentially with progress tracking
     */
    async processFiles(
        files: string[],
        processor: FileProcessor,
        options: SequentialProcessingOptions = {}
    ): Promise<ProcessingResult[]> {
        if (files.length === 0) {
            this.logger.info('No files to process');
            return [];
        }

        this.logger.info(`Starting sequential processing of ${files.length} files`);
        
        const results: ProcessingResult[] = [];
        const queue = new FileProcessingQueue(files, this.logger);
        let errorCount = 0;
        const maxErrors = options.maxErrors ?? Infinity;
        const continueOnError = options.continueOnError ?? true;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            // Check if we should stop due to too many errors
            if (errorCount >= maxErrors) {
                this.logger.error(`Stopping processing due to ${errorCount} errors (max: ${maxErrors})`);
                break;
            }

            try {
                // Notify start of file processing
                if (options.onFileStart) {
                    options.onFileStart(file, i, files.length);
                }

                queue.updateFileStatus(file, FileStatus.PROCESSING);
                
                const startTime = new Date();
                this.logger.debug(`Processing file ${i + 1}/${files.length}: ${file}`);

                // Process the file
                const result = await processor.processFile(file);
                const endTime = new Date();
                const duration = endTime.getTime() - startTime.getTime();

                const processResult: ProcessingResult = {
                    file,
                    success: true,
                    result,
                    duration,
                    status: result.state === 'fail' ? FileStatus.ERROR : 
                           result.state === 'warning' ? FileStatus.WARNING : FileStatus.SUCCESS,
                    startTime,
                    endTime
                };

                queue.updateFileStatus(file, processResult.status);
                results.push(processResult);

                // Notify completion
                if (options.onFileComplete) {
                    options.onFileComplete(file, processResult);
                }

                this.logger.debug(`Completed processing ${file} in ${duration}ms`);

            } catch (error) {
                const endTime = new Date();
                const duration = endTime.getTime() - (queue.getFile(file)?.startTime?.getTime() ?? Date.now());
                const processError = error instanceof Error ? error : new Error(String(error));

                const processResult: ProcessingResult = {
                    file,
                    success: false,
                    error: processError,
                    duration,
                    status: FileStatus.ERROR,
                    startTime: queue.getFile(file)?.startTime ?? new Date(),
                    endTime
                };

                queue.updateFileStatus(file, FileStatus.ERROR);
                results.push(processResult);
                errorCount++;

                // Notify error
                if (options.onError) {
                    options.onError(file, processError);
                }

                this.logger.error(`Failed to process ${file}: ${processError.message}`);

                // Stop processing if continueOnError is false
                if (!continueOnError) {
                    this.logger.error('Stopping processing due to error (continueOnError=false)');
                    break;
                }
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        
        this.logger.info(`Sequential processing completed: ${successCount} successful, ${failureCount} failed`);
        
        return results;
    }

    /**
     * Get processing statistics
     */
    getStats(results: ProcessingResult[]): {
        total: number;
        successful: number;
        failed: number;
        warnings: number;
        averageDuration: number;
        totalDuration: number;
        successRate: number;
    } {
        const successful = results.filter(r => r.success && r.status === FileStatus.SUCCESS).length;
        const warnings = results.filter(r => r.success && r.status === FileStatus.WARNING).length;
        const failed = results.filter(r => !r.success).length;
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
        const averageDuration = results.length > 0 ? totalDuration / results.length : 0;

        return {
            total: results.length,
            successful,
            failed,
            warnings,
            averageDuration,
            totalDuration,
            successRate: results.length > 0 ? successful / results.length : 0,
        };
    }
}

/**
 * Processing mode selector to determine sequential vs parallel processing
 */
export class ProcessingModeSelector {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child('ProcessingModeSelector');
    }

    /**
     * Determine the appropriate processing mode based on the command
     */
    determineProcessingMode(command: ReviewCommand): ProcessingMode {
        this.logger.debug(`Determining processing mode for command type: ${command.type}`);

        // Sequential processing for local file analysis and changes analysis
        if (command.type === 'files' || command.type === 'directory' || command.type === 'changes') {
            this.logger.debug('Selected sequential processing for file/directory/changes analysis');
            return ProcessingMode.SEQUENTIAL;
        }

        // Parallel processing for PR analysis only
        if (command.type === 'pr') {
            this.logger.debug('Selected parallel processing for PR analysis');
            return ProcessingMode.PARALLEL;
        }

        // Default to sequential
        this.logger.debug('Defaulting to sequential processing');
        return ProcessingMode.SEQUENTIAL;
    }

    /**
     * Determine processing mode based on file count and other factors
     */
    determineProcessingModeAdvanced(
        command: ReviewCommand,
        fileCount: number,
        options?: {
            forceSequential?: boolean;
            forceParallel?: boolean;
            sequentialThreshold?: number;
        }
    ): ProcessingMode {
        // Handle forced modes
        if (options?.forceSequential) {
            this.logger.debug('Forced sequential processing mode');
            return ProcessingMode.SEQUENTIAL;
        }

        if (options?.forceParallel) {
            this.logger.debug('Forced parallel processing mode');
            return ProcessingMode.PARALLEL;
        }

        // Always use sequential processing for file analysis and changes analysis
        if (command.type === 'files' || command.type === 'directory' || command.type === 'changes') {
            this.logger.debug(`Using sequential processing for ${fileCount} files (always sequential)`);
            return ProcessingMode.SEQUENTIAL;
        }

        // Default behavior for other command types (PR analysis)
        return this.determineProcessingMode(command);
    }
}

/**
 * File processing queue for managing ordered file processing
 */
export class FileProcessingQueue {
    private files: Map<string, QueuedFile>;
    private processingOrder: string[];
    private logger: Logger;

    constructor(filePaths: string[], logger: Logger) {
        this.logger = logger.child('FileProcessingQueue');
        this.processingOrder = [...filePaths];
        this.files = new Map();

        // Initialize queue with pending files
        filePaths.forEach((path, index) => {
            this.files.set(path, {
                path,
                status: FileStatus.PENDING,
                index
            });
        });

        this.logger.debug(`Initialized processing queue with ${filePaths.length} files`);
    }

    /**
     * Update the status of a file in the queue
     */
    updateFileStatus(filePath: string, status: FileStatus): void {
        const file = this.files.get(filePath);
        if (!file) {
            this.logger.warn(`File not found in queue: ${filePath}`);
            return;
        }

        const now = new Date();
        file.status = status;

        if (status === FileStatus.PROCESSING && !file.startTime) {
            file.startTime = now;
        } else if (status === FileStatus.SUCCESS || status === FileStatus.ERROR || status === FileStatus.WARNING) {
            file.endTime = now;
        }

        this.files.set(filePath, file);
        this.logger.debug(`Updated file status: ${filePath} -> ${status}`);
    }

    /**
     * Get file information from the queue
     */
    getFile(filePath: string): QueuedFile | undefined {
        return this.files.get(filePath);
    }

    /**
     * Get all files in the queue
     */
    getAllFiles(): QueuedFile[] {
        return this.processingOrder.map(path => this.files.get(path)!);
    }

    /**
     * Get files by status
     */
    getFilesByStatus(status: FileStatus): QueuedFile[] {
        return Array.from(this.files.values()).filter(file => file.status === status);
    }

    /**
     * Get processing statistics
     */
    getQueueStats(): {
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
        warnings: number;
    } {
        const all = Array.from(this.files.values());
        
        return {
            total: all.length,
            pending: all.filter(f => f.status === FileStatus.PENDING).length,
            processing: all.filter(f => f.status === FileStatus.PROCESSING).length,
            completed: all.filter(f => f.status === FileStatus.SUCCESS).length,
            failed: all.filter(f => f.status === FileStatus.ERROR).length,
            warnings: all.filter(f => f.status === FileStatus.WARNING).length,
        };
    }

    /**
     * Get the next file to process
     */
    getNextFile(): QueuedFile | undefined {
        return this.processingOrder
            .map(path => this.files.get(path)!)
            .find(file => file.status === FileStatus.PENDING);
    }

    /**
     * Check if all files are processed
     */
    isComplete(): boolean {
        return this.getFilesByStatus(FileStatus.PENDING).length === 0 &&
               this.getFilesByStatus(FileStatus.PROCESSING).length === 0;
    }

    /**
     * Get processing order
     */
    getProcessingOrder(): string[] {
        return [...this.processingOrder];
    }

    /**
     * Reset the queue to initial state
     */
    reset(): void {
        this.files.forEach((file, path) => {
            this.files.set(path, {
                path: file.path,
                status: FileStatus.PENDING,
                index: file.index
            });
        });
        this.logger.debug('Reset processing queue');
    }
}