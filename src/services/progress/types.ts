/**
 * File processing status enumeration
 */
export enum FileStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error'
}

/**
 * Progress renderer interface for displaying file processing progress
 */
export interface ProgressRenderer {
  /**
   * Initialize progress display
   * @param totalFiles Total number of files to process
   */
  start(totalFiles: number): void;

  /**
   * Update progress display with current file and completion status
   * @param currentFile Currently processing file path
   * @param completed Number of completed files
   * @param total Total number of files
   */
  updateProgress(currentFile: string, completed: number, total: number): void;

  /**
   * Update status of a specific file
   * @param file File path
   * @param status New status
   */
  updateFileStatus(file: string, status: FileStatus): void;

  /**
   * Mark progress as complete and clean up display
   */
  complete(): void;

  /**
   * Display error for a specific file
   * @param file File path
   * @param error Error message
   */
  error(file: string, error: string): void;

  /**
   * Clean up progress display
   */
  cleanup(): void;
}

/**
 * Configuration for progress bar display
 */
export interface ProgressBarConfig {
  width: number;
  showPercentage: boolean;
  showFileCount: boolean;
  showCurrentFile: boolean;
  colors: ProgressColors;
}

/**
 * Color configuration for different file statuses
 */
export interface ProgressColors {
  success: string;    // Green
  processing: string; // Blue/Cyan
  pending: string;    // Grey
  warning: string;    // Yellow
  error: string;      // Red
  bar: string;        // Progress bar color
  reset: string;      // Reset color
}

/**
 * Default color configuration using ANSI escape codes
 */
export const DEFAULT_COLORS: ProgressColors = {
  success: '\x1b[32m',    // Green
  processing: '\x1b[36m', // Cyan
  pending: '\x1b[90m',    // Grey
  warning: '\x1b[33m',    // Yellow
  error: '\x1b[31m',      // Red
  bar: '\x1b[34m',        // Blue
  reset: '\x1b[0m'        // Reset
};

/**
 * Default progress bar configuration
 */
export const DEFAULT_PROGRESS_CONFIG: ProgressBarConfig = {
  width: 30,
  showPercentage: true,
  showFileCount: true,
  showCurrentFile: true,
  colors: DEFAULT_COLORS
};

/**
 * Progress state interface for tracking file processing progress
 */
export interface ProgressState {
  totalFiles: number;
  completedFiles: number;
  currentFile: string | null;
  fileStatuses: Map<string, FileStatus>;
  startTime: Date;
  errors: Array<{ file: string; error: string }>;
  warnings: Array<{ file: string; warning: string }>;
}

/**
 * Error information for progress tracking
 */
export interface ProgressError {
  file: string;
  error: string;
  timestamp: Date;
}

/**
 * Warning information for progress tracking
 */
export interface ProgressWarning {
  file: string;
  warning: string;
  timestamp: Date;
}

/**
 * Progress statistics for reporting
 */
export interface ProgressStats {
  totalFiles: number;
  completedFiles: number;
  successfulFiles: number;
  errorFiles: number;
  warningFiles: number;
  pendingFiles: number;
  processingFiles: number;
  completionPercentage: number;
  elapsedTime: number;
  estimatedTimeRemaining?: number;
}