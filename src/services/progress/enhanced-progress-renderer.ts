import { ProgressRenderer, FileStatus, ProgressBarConfig, DEFAULT_PROGRESS_CONFIG } from './types.ts';
import { PathTruncator } from './path-truncator.ts';
import { TerminalController } from './terminal-controller.ts';

/**
 * Enhanced interactive progress renderer with ETA and throughput calculation
 */
export class EnhancedProgressRenderer implements ProgressRenderer {
  private config: ProgressBarConfig;
  private currentLine: string = '';
  private isActive: boolean = false;
  private spinnerIndex: number = 0;
  private fileStatuses: Map<string, FileStatus> = new Map();
  private isTTY: boolean;
  private supportsColor: boolean;
  private supportsAnsi: boolean;
  private supportsUnicode: boolean;
  
  // Enhanced features
  private startTime: Date = new Date();
  private completedFiles: number = 0;
  private totalFiles: number = 0;
  private fileCompletionTimes: number[] = [];
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100; // 100ms minimum between updates

  constructor(config: Partial<ProgressBarConfig> = {}) {
    this.config = { ...DEFAULT_PROGRESS_CONFIG, ...config };
    this.isTTY = TerminalController.isTTY();
    this.supportsColor = TerminalController.supportsColor();
    this.supportsAnsi = TerminalController.supportsAnsi();
    this.supportsUnicode = TerminalController.supportsUnicode();
  }

  start(totalFiles: number): void {
    this.isActive = true;
    this.totalFiles = totalFiles;
    this.completedFiles = 0;
    this.startTime = new Date();
    this.fileCompletionTimes = [];
    
    if (this.isTTY) {
      (globalThis as any).process?.stdout?.write(TerminalController.hideCursor());
    }
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    if (!this.isActive) return;

    // Throttle updates to prevent terminal flooding
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    // Update completion tracking
    if (completed > this.completedFiles) {
      const currentTime = Date.now();
      this.fileCompletionTimes.push(currentTime);
      this.completedFiles = completed;
    }

    try {
      const percentage = Math.round((completed / total) * 100);
      const progressBar = this.createProgressBar(percentage);
      const truncatedFile = PathTruncator.truncateForTerminal(currentFile, 25); // Shorter for enhanced display
      const spinner = this.getNextSpinner();
      const eta = this.calculateETA();
      const throughput = this.calculateThroughput();
      
      let line = '';
      
      if (this.isTTY) {
        // Enhanced interactive terminal display
        const coloredSpinner = this.applyColor(spinner, this.config.colors.processing);
        const coloredBar = this.applyColor(progressBar, this.config.colors.bar);
        const coloredFile = this.applyColor(truncatedFile, this.config.colors.processing);
        
        line = `${coloredSpinner} ${coloredBar} ${percentage}% ${coloredFile} | ETA: ${eta} | ${throughput} files/min`;
      } else {
        // Non-TTY fallback with basic info
        line = `[${completed}/${total}] ${percentage}% - ${truncatedFile} | ETA: ${eta}`;
      }
      
      this.renderLine(line);
    } catch (error) {
      // Fallback to simple progress display on error
      console.log(`[${completed}/${total}] ${Math.round((completed / total) * 100)}% - ${currentFile}`);
    }
  }

  updateFileStatus(file: string, status: FileStatus): void {
    this.fileStatuses.set(file, status);
    
    if (this.isTTY && this.isActive) {
      // Show status icon briefly for completed files
      if (status === FileStatus.SUCCESS || status === FileStatus.ERROR || status === FileStatus.WARNING) {
        const icon = this.getStatusIcon(status);
        const coloredIcon = this.applyStatusColor(icon, status);
        const truncatedFile = PathTruncator.truncateForTerminal(file, 30);
        
        // Clear line and show status briefly
        (globalThis as any).process?.stdout?.write(TerminalController.clearLine());
        (globalThis as any).process?.stdout?.write(`${coloredIcon} ${truncatedFile}\n`);
      }
    }
  }

  complete(): void {
    if (this.isActive) {
      if (this.isTTY) {
        // Show final completion status
        const totalTime = this.formatDuration(Date.now() - this.startTime.getTime());
        const avgThroughput = this.calculateFinalThroughput();
        const completionLine = this.applyColor(
          `✅ Completed ${this.totalFiles} files in ${totalTime} (${avgThroughput} files/min)`,
          this.config.colors.success
        );
        
        (globalThis as any).process?.stdout?.write(TerminalController.clearLine());
        console.log(completionLine);
        (globalThis as any).process?.stdout?.write(TerminalController.showCursor());
      } else {
        console.log(`Analysis complete. Processed ${this.totalFiles} files.`);
      }
      this.isActive = false;
    }
  }

  error(file: string, error: string): void {
    this.fileStatuses.set(file, FileStatus.ERROR);
    
    if (this.isTTY) {
      const icon = TerminalController.STATUS_ICONS.error;
      const coloredIcon = this.applyColor(icon, this.config.colors.error);
      const truncatedFile = PathTruncator.truncateForTerminal(file);
      
      // Clear current line and show error
      (globalThis as any).process?.stdout?.write(TerminalController.clearLine());
      console.log(`${coloredIcon} ${truncatedFile}: ${error}`);
    } else {
      console.log(`ERROR: ${file}: ${error}`);
    }
  }

  cleanup(): void {
    if (this.isActive && this.isTTY) {
      (globalThis as any).process?.stdout?.write(TerminalController.clearLine());
      (globalThis as any).process?.stdout?.write(TerminalController.showCursor());
    }
    this.isActive = false;
  }

  /**
   * Calculate estimated time of arrival (ETA) based on processing speed
   */
  private calculateETA(): string {
    if (this.completedFiles === 0 || this.fileCompletionTimes.length === 0) {
      return '--:--';
    }
    
    const elapsed = Date.now() - this.startTime.getTime();
    const avgTimePerFile = elapsed / this.completedFiles;
    const remainingFiles = this.totalFiles - this.completedFiles;
    const remainingTime = remainingFiles * avgTimePerFile;
    
    return this.formatDuration(remainingTime);
  }

  /**
   * Calculate current throughput in files per minute
   */
  private calculateThroughput(): string {
    if (this.completedFiles === 0) {
      return '0';
    }
    
    const elapsed = (Date.now() - this.startTime.getTime()) / 1000 / 60; // minutes
    if (elapsed === 0) {
      return '0';
    }
    
    const filesPerMinute = Math.round(this.completedFiles / elapsed);
    return filesPerMinute.toString();
  }

  /**
   * Calculate final average throughput for completion message
   */
  private calculateFinalThroughput(): string {
    const elapsed = (Date.now() - this.startTime.getTime()) / 1000 / 60; // minutes
    if (elapsed === 0) {
      return '0';
    }
    
    const filesPerMinute = Math.round(this.totalFiles / elapsed);
    return filesPerMinute.toString();
  }

  /**
   * Format duration in milliseconds to human-readable format
   */
  private formatDuration(milliseconds: number): string {
    const seconds = Math.round(milliseconds / 1000);
    
    if (seconds < 60) {
      return `0:${seconds.toString().padStart(2, '0')}`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Create enhanced progress bar string with better visual styling
   */
  private createProgressBar(percentage: number): string {
    const width = this.config.width;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    
    if (this.isTTY && this.supportsUnicode) {
      // Use Unicode characters for better visual appearance
      const filledBar = TerminalController.PROGRESS_CHARS.filled.repeat(filled);
      const emptyBar = TerminalController.PROGRESS_CHARS.empty.repeat(empty);
      return `${TerminalController.PROGRESS_CHARS.leftBorder}${filledBar}${emptyBar}${TerminalController.PROGRESS_CHARS.rightBorder}`;
    } else {
      // Fallback for terminals without Unicode support
      const filledBar = TerminalController.PROGRESS_CHARS.altFilled.repeat(filled);
      const emptyBar = TerminalController.PROGRESS_CHARS.altEmpty.repeat(empty);
      return `${TerminalController.PROGRESS_CHARS.altLeftBorder}${filledBar}${emptyBar}${TerminalController.PROGRESS_CHARS.altRightBorder}`;
    }
  }

  /**
   * Get next spinner character with animation logic
   */
  private getNextSpinner(): string {
    if (!this.isTTY) return '';
    
    const spinner = TerminalController.SPINNER_CHARS[this.spinnerIndex];
    this.spinnerIndex = (this.spinnerIndex + 1) % TerminalController.SPINNER_CHARS.length;
    return spinner;
  }

  /**
   * Get status icon for file status
   */
  private getStatusIcon(status: FileStatus): string {
    switch (status) {
      case FileStatus.SUCCESS:
        return TerminalController.STATUS_ICONS.success;
      case FileStatus.ERROR:
        return TerminalController.STATUS_ICONS.error;
      case FileStatus.WARNING:
        return TerminalController.STATUS_ICONS.warning;
      case FileStatus.PENDING:
        return TerminalController.STATUS_ICONS.pending;
      case FileStatus.PROCESSING:
        return TerminalController.STATUS_ICONS.processing;
      default:
        return '';
    }
  }

  /**
   * Apply color to text if colors are supported
   */
  private applyColor(text: string, color: string): string {
    if (!this.supportsColor) return text;
    return `${color}${text}${this.config.colors.reset}`;
  }

  /**
   * Apply status-specific color to text
   */
  private applyStatusColor(text: string, status: FileStatus): string {
    if (!this.supportsColor) return text;
    
    let color: string;
    switch (status) {
      case FileStatus.SUCCESS:
        color = this.config.colors.success;
        break;
      case FileStatus.ERROR:
        color = this.config.colors.error;
        break;
      case FileStatus.WARNING:
        color = this.config.colors.warning;
        break;
      case FileStatus.PENDING:
        color = this.config.colors.pending;
        break;
      case FileStatus.PROCESSING:
        color = this.config.colors.processing;
        break;
      default:
        return text;
    }
    
    return `${color}${text}${this.config.colors.reset}`;
  }

  /**
   * Render line to terminal with proper clearing
   */
  private renderLine(line: string): void {
    if (this.isTTY) {
      if (this.currentLine) {
        // Clear current line and move cursor to beginning
        (globalThis as any).process?.stdout?.write(TerminalController.clearLine());
      }
      (globalThis as any).process?.stdout?.write(line);
      this.currentLine = line;
    } else {
      // For non-TTY, just print the line
      console.log(line);
    }
  }
}

/**
 * Time formatting utilities for duration display
 */
export class TimeFormatter {
  /**
   * Format milliseconds to human-readable duration
   * @param milliseconds Duration in milliseconds
   * @returns Formatted duration string (e.g., "1:23", "2:34:56")
   */
  static formatDuration(milliseconds: number): string {
    const seconds = Math.round(milliseconds / 1000);
    
    if (seconds < 60) {
      return `0:${seconds.toString().padStart(2, '0')}`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Format seconds to human-readable duration
   * @param seconds Duration in seconds
   * @returns Formatted duration string
   */
  static formatSeconds(seconds: number): string {
    return this.formatDuration(seconds * 1000);
  }

  /**
   * Format duration with units (e.g., "2m 30s", "1h 15m")
   * @param milliseconds Duration in milliseconds
   * @returns Formatted duration with units
   */
  static formatDurationWithUnits(milliseconds: number): string {
    const totalSeconds = Math.round(milliseconds / 1000);
    
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    if (minutes < 60) {
      return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    
    return `${hours}h`;
  }

  /**
   * Calculate throughput in files per minute
   * @param filesProcessed Number of files processed
   * @param elapsedMilliseconds Time elapsed in milliseconds
   * @returns Files per minute as a number
   */
  static calculateThroughput(filesProcessed: number, elapsedMilliseconds: number): number {
    if (filesProcessed === 0 || elapsedMilliseconds === 0) {
      return 0;
    }
    
    const elapsedMinutes = elapsedMilliseconds / 1000 / 60;
    return Math.round(filesProcessed / elapsedMinutes);
  }

  /**
   * Estimate remaining time based on current throughput
   * @param remainingFiles Number of files remaining
   * @param currentThroughput Current throughput in files per minute
   * @returns Estimated remaining time in milliseconds
   */
  static estimateRemainingTime(remainingFiles: number, currentThroughput: number): number {
    if (remainingFiles === 0 || currentThroughput === 0) {
      return 0;
    }
    
    const remainingMinutes = remainingFiles / currentThroughput;
    return remainingMinutes * 60 * 1000; // Convert to milliseconds
  }
}