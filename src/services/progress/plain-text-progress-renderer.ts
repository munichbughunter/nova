import { ProgressRenderer, FileStatus } from './types.ts';

/**
 * Plain text progress renderer for non-TTY environments and fallback scenarios
 * This renderer provides basic progress information without ANSI codes or terminal control
 */
export class PlainTextProgressRenderer implements ProgressRenderer {
  private totalFiles: number = 0;
  private completedFiles: number = 0;
  private startTime: Date = new Date();
  private lastProgressUpdate: number = 0;
  private updateThrottle: number = 1000; // 1 second minimum between progress updates

  start(totalFiles: number): void {
    this.totalFiles = totalFiles;
    this.completedFiles = 0;
    this.startTime = new Date();
    this.lastProgressUpdate = 0;
    console.log(`Starting analysis of ${totalFiles} files...`);
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    // Throttle progress updates to avoid flooding the console
    const now = Date.now();
    if (now - this.lastProgressUpdate < this.updateThrottle) {
      return;
    }
    this.lastProgressUpdate = now;

    this.completedFiles = completed;
    const percentage = Math.round((completed / total) * 100);
    const truncatedFile = this.truncateFilename(currentFile);
    
    console.log(`[${completed}/${total}] ${percentage}% - ${truncatedFile}`);
  }

  updateFileStatus(file: string, status: FileStatus): void {
    const statusText = this.getStatusText(status);
    const truncatedFile = this.truncateFilename(file);
    
    // Only show status for completed files to reduce noise
    if (status === FileStatus.SUCCESS || status === FileStatus.ERROR || status === FileStatus.WARNING) {
      console.log(`${statusText}: ${truncatedFile}`);
    }
  }

  complete(): void {
    const duration = Date.now() - this.startTime.getTime();
    const durationText = this.formatDuration(duration);
    console.log(`Analysis complete. Processed ${this.totalFiles} files in ${durationText}.`);
  }

  error(file: string, error: string): void {
    const truncatedFile = this.truncateFilename(file);
    console.error(`ERROR processing ${truncatedFile}: ${error}`);
  }

  cleanup(): void {
    // No cleanup needed for plain text output
  }

  /**
   * Get human-readable status text
   */
  private getStatusText(status: FileStatus): string {
    switch (status) {
      case FileStatus.SUCCESS:
        return 'SUCCESS';
      case FileStatus.ERROR:
        return 'ERROR';
      case FileStatus.WARNING:
        return 'WARNING';
      case FileStatus.PENDING:
        return 'PENDING';
      case FileStatus.PROCESSING:
        return 'PROCESSING';
      default:
        return 'UNKNOWN';
    }
  }

  /**
   * Truncate filename for display
   */
  private truncateFilename(filename: string, maxLength: number = 60): string {
    if (filename.length <= maxLength) {
      return filename;
    }

    // Try to keep the filename and some parent directories
    const parts = filename.split('/');
    const file = parts[parts.length - 1];
    
    if (file.length >= maxLength - 3) {
      // If filename itself is too long, truncate it
      return `...${file.slice(-(maxLength - 3))}`;
    }

    // Build path from the end, keeping as much as possible
    let result = file;
    let remainingLength = maxLength - file.length - 3; // Reserve space for "..."
    
    for (let i = parts.length - 2; i >= 0 && remainingLength > 0; i--) {
      const part = parts[i];
      if (part.length + 1 <= remainingLength) { // +1 for "/"
        result = `${part}/${result}`;
        remainingLength -= part.length + 1;
      } else {
        break;
      }
    }

    return `.../${result}`;
  }

  /**
   * Format duration in milliseconds to human-readable format
   */
  private formatDuration(milliseconds: number): string {
    const seconds = Math.round(milliseconds / 1000);
    
    if (seconds < 60) {
      return `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    
    return `${hours}h`;
  }
}

/**
 * Minimal progress renderer that only shows essential information
 * Useful for CI/CD environments or when minimal output is desired
 */
export class MinimalProgressRenderer implements ProgressRenderer {
  private totalFiles: number = 0;
  private completedFiles: number = 0;
  private errorCount: number = 0;
  private warningCount: number = 0;

  start(totalFiles: number): void {
    this.totalFiles = totalFiles;
    this.completedFiles = 0;
    this.errorCount = 0;
    this.warningCount = 0;
    console.log(`Analyzing ${totalFiles} files...`);
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    // Only show progress at 25%, 50%, 75%, and 100%
    const percentage = Math.round((completed / total) * 100);
    const previousPercentage = Math.round(((completed - 1) / total) * 100);
    
    if (percentage >= 25 && previousPercentage < 25) {
      console.log('25% complete...');
    } else if (percentage >= 50 && previousPercentage < 50) {
      console.log('50% complete...');
    } else if (percentage >= 75 && previousPercentage < 75) {
      console.log('75% complete...');
    }
  }

  updateFileStatus(file: string, status: FileStatus): void {
    if (status === FileStatus.SUCCESS) {
      this.completedFiles++;
    } else if (status === FileStatus.ERROR) {
      this.errorCount++;
    } else if (status === FileStatus.WARNING) {
      this.warningCount++;
    }
  }

  complete(): void {
    const successCount = this.totalFiles - this.errorCount - this.warningCount;
    console.log(`Analysis complete: ${successCount} successful, ${this.warningCount} warnings, ${this.errorCount} errors`);
  }

  error(file: string, error: string): void {
    console.error(`ERROR: ${file}: ${error}`);
  }

  cleanup(): void {
    // No cleanup needed
  }
}

/**
 * Silent progress renderer that produces no output
 * Useful for programmatic usage or when output should be completely suppressed
 */
export class SilentProgressRenderer implements ProgressRenderer {
  start(totalFiles: number): void {
    // Silent
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    // Silent
  }

  updateFileStatus(file: string, status: FileStatus): void {
    // Silent
  }

  complete(): void {
    // Silent
  }

  error(file: string, error: string): void {
    // Silent - errors are still tracked elsewhere
  }

  cleanup(): void {
    // Silent
  }
}

/**
 * Factory function to create appropriate fallback renderer based on environment
 */
export function createFallbackRenderer(environment?: 'ci' | 'minimal' | 'silent'): ProgressRenderer {
  switch (environment) {
    case 'ci':
    case 'minimal':
      return new MinimalProgressRenderer();
    case 'silent':
      return new SilentProgressRenderer();
    default:
      return new PlainTextProgressRenderer();
  }
}