import {
  ProgressState,
  ProgressStats,
  ProgressError,
  ProgressWarning,
  FileStatus,
  ProgressRenderer
} from './types.ts';

/**
 * Progress state manager for tracking file processing progress
 */
export class ProgressStateManager {
  private state: ProgressState;
  private renderer: ProgressRenderer | null;

  constructor(renderer?: ProgressRenderer) {
    this.renderer = renderer || null;
    this.state = this.createInitialState();
  }

  /**
   * Initialize progress tracking for a set of files
   * @param files Array of file paths to process
   */
  startProcessing(files: string[]): void {
    this.state = {
      totalFiles: files.length,
      completedFiles: 0,
      currentFile: null,
      fileStatuses: new Map(files.map(f => [f, FileStatus.PENDING])),
      startTime: new Date(),
      errors: [],
      warnings: []
    };

    if (this.renderer) {
      this.renderer.start(files.length);
    }
  }

  /**
   * Update the status of a specific file
   * @param file File path
   * @param status New file status
   */
  updateFileStatus(file: string, status: FileStatus): void {
    const previousStatus = this.state.fileStatuses.get(file);
    this.state.fileStatuses.set(file, status);

    // Update current file if processing
    if (status === FileStatus.PROCESSING) {
      this.state.currentFile = file;
    }

    // Update completed count when file finishes processing
    if (status === FileStatus.SUCCESS || status === FileStatus.ERROR || status === FileStatus.WARNING) {
      // Only increment if this file wasn't already completed
      if (previousStatus === FileStatus.PROCESSING || previousStatus === FileStatus.PENDING) {
        this.state.completedFiles++;
      }
    }

    // Update renderer if available
    if (this.renderer) {
      this.renderer.updateFileStatus(file, status);
      this.renderer.updateProgress(
        this.state.currentFile || file,
        this.state.completedFiles,
        this.state.totalFiles
      );
    }
  }

  /**
   * Add an error for a specific file
   * @param file File path
   * @param error Error message
   */
  addError(file: string, error: string): void {
    const errorInfo = { file, error };
    this.state.errors.push(errorInfo);
    
    // Update file status to error
    this.updateFileStatus(file, FileStatus.ERROR);

    if (this.renderer) {
      this.renderer.error(file, error);
    }
  }

  /**
   * Add a warning for a specific file
   * @param file File path
   * @param warning Warning message
   */
  addWarning(file: string, warning: string): void {
    const warningInfo = { file, warning };
    this.state.warnings.push(warningInfo);
    
    // Update file status to warning if not already error
    const currentStatus = this.state.fileStatuses.get(file);
    if (currentStatus !== FileStatus.ERROR) {
      this.updateFileStatus(file, FileStatus.WARNING);
    }
  }

  /**
   * Get current progress statistics
   * @returns Progress statistics object
   */
  getProgressStats(): ProgressStats {
    const statusCounts = this.getStatusCounts();
    const elapsedTime = Date.now() - this.state.startTime.getTime();
    const completionPercentage = this.state.totalFiles > 0 
      ? Math.round((this.state.completedFiles / this.state.totalFiles) * 100)
      : 0;

    // Calculate estimated time remaining
    let estimatedTimeRemaining: number | undefined;
    if (this.state.completedFiles > 0 && this.state.completedFiles < this.state.totalFiles) {
      const avgTimePerFile = elapsedTime / this.state.completedFiles;
      const remainingFiles = this.state.totalFiles - this.state.completedFiles;
      estimatedTimeRemaining = remainingFiles * avgTimePerFile;
    }

    return {
      totalFiles: this.state.totalFiles,
      completedFiles: this.state.completedFiles,
      successfulFiles: statusCounts.success,
      errorFiles: statusCounts.error,
      warningFiles: statusCounts.warning,
      pendingFiles: statusCounts.pending,
      processingFiles: statusCounts.processing,
      completionPercentage,
      elapsedTime,
      estimatedTimeRemaining
    };
  }

  /**
   * Get all errors that occurred during processing
   * @returns Array of error information
   */
  getErrors(): ProgressError[] {
    return this.state.errors.map(error => ({
      ...error,
      timestamp: this.state.startTime
    }));
  }

  /**
   * Get all warnings that occurred during processing
   * @returns Array of warning information
   */
  getWarnings(): ProgressWarning[] {
    return this.state.warnings.map(warning => ({
      ...warning,
      timestamp: this.state.startTime
    }));
  }

  /**
   * Get the current file being processed
   * @returns Current file path or null
   */
  getCurrentFile(): string | null {
    return this.state.currentFile;
  }

  /**
   * Get the status of a specific file
   * @param file File path
   * @returns File status
   */
  getFileStatus(file: string): FileStatus | undefined {
    return this.state.fileStatuses.get(file);
  }

  /**
   * Get all file statuses
   * @returns Map of file paths to their statuses
   */
  getAllFileStatuses(): Map<string, FileStatus> {
    return new Map(this.state.fileStatuses);
  }

  /**
   * Check if processing is complete
   * @returns True if all files have been processed
   */
  isComplete(): boolean {
    return this.state.totalFiles > 0 && this.state.completedFiles >= this.state.totalFiles;
  }

  /**
   * Complete progress tracking and clean up
   */
  complete(): void {
    if (this.renderer) {
      this.renderer.complete();
    }
  }

  /**
   * Clean up progress display and restore terminal
   */
  cleanup(): void {
    if (this.renderer) {
      this.renderer.cleanup();
    }
  }

  /**
   * Reset progress state to initial state
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Get a summary of processing results
   * @returns Processing summary
   */
  getSummary(): {
    total: number;
    completed: number;
    successful: number;
    errors: number;
    warnings: number;
    duration: number;
  } {
    const stats = this.getProgressStats();
    return {
      total: stats.totalFiles,
      completed: stats.completedFiles,
      successful: stats.successfulFiles,
      errors: stats.errorFiles,
      warnings: stats.warningFiles,
      duration: stats.elapsedTime
    };
  }

  /**
   * Create initial empty progress state
   * @returns Initial progress state
   */
  private createInitialState(): ProgressState {
    return {
      totalFiles: 0,
      completedFiles: 0,
      currentFile: null,
      fileStatuses: new Map(),
      startTime: new Date(),
      errors: [],
      warnings: []
    };
  }

  /**
   * Count files by status
   * @returns Object with counts for each status
   */
  private getStatusCounts(): Record<string, number> {
    const counts = {
      pending: 0,
      processing: 0,
      success: 0,
      warning: 0,
      error: 0
    };

    for (const status of this.state.fileStatuses.values()) {
      counts[status]++;
    }

    return counts;
  }
}