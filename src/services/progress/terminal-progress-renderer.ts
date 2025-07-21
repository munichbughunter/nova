import { ProgressRenderer, FileStatus, ProgressBarConfig, DEFAULT_PROGRESS_CONFIG } from './types.ts';
import { PathTruncator } from './path-truncator.ts';
import { TerminalController } from './terminal-controller.ts';

/**
 * Terminal-based progress renderer with ANSI control sequences
 */
export class TerminalProgressRenderer implements ProgressRenderer {
  private config: ProgressBarConfig;
  private currentLine: string = '';
  private isActive: boolean = false;
  private spinnerIndex: number = 0;
  private fileStatuses: Map<string, FileStatus> = new Map();
  private isTTY: boolean;
  private supportsColor: boolean;
  private supportsAnsi: boolean;
  private supportsUnicode: boolean;
  
  // Throttling for progress updates
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100; // 100ms minimum between updates
  private pendingUpdate: boolean = false;

  constructor(config: Partial<ProgressBarConfig> = {}) {
    this.config = { ...DEFAULT_PROGRESS_CONFIG, ...config };
    this.isTTY = TerminalController.isTTY();
    this.supportsColor = TerminalController.supportsColor();
    this.supportsAnsi = TerminalController.supportsAnsi();
    this.supportsUnicode = TerminalController.supportsUnicode();
  }

  start(totalFiles: number): void {
    this.isActive = true;
    if (this.isTTY) {
      (globalThis as any).process?.stdout?.write(TerminalController.hideCursor());
    }
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    if (!this.isActive) return;

    // Throttle updates to prevent terminal flooding
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      // Schedule a delayed update if one isn't already pending
      if (!this.pendingUpdate) {
        this.pendingUpdate = true;
        setTimeout(() => {
          this.pendingUpdate = false;
          this.doUpdateProgress(currentFile, completed, total);
        }, this.updateInterval - (now - this.lastUpdateTime));
      }
      return;
    }

    this.doUpdateProgress(currentFile, completed, total);
  }

  private doUpdateProgress(currentFile: string, completed: number, total: number): void {
    this.lastUpdateTime = Date.now();

    const percentage = Math.round((completed / total) * 100);
    const progressBar = this.createProgressBar(percentage);
    const truncatedFile = PathTruncator.truncateForTerminal(currentFile);
    const spinner = this.getSpinner();
    
    let line = '';
    
    if (this.isTTY) {
      // Interactive terminal with colors and spinner
      const coloredSpinner = this.applyColor(spinner, this.config.colors.processing);
      const coloredBar = this.applyColor(progressBar, this.config.colors.bar);
      const coloredFile = this.applyColor(truncatedFile, this.config.colors.processing);
      
      line = `${coloredSpinner} ${coloredBar} ${percentage}% ${coloredFile}`;
    } else {
      // Non-TTY fallback
      line = `[${completed}/${total}] ${percentage}% - ${truncatedFile}`;
    }
    
    this.renderLine(line);
  }

  updateFileStatus(file: string, status: FileStatus): void {
    this.fileStatuses.set(file, status);
    
    if (this.isTTY && this.isActive) {
      // Show status icon briefly
      const icon = this.getStatusIcon(status);
      const coloredIcon = this.applyStatusColor(icon, status);
      const truncatedFile = PathTruncator.truncateForTerminal(file);
      
      const statusLine = `${coloredIcon} ${truncatedFile}`;
      this.renderLine(statusLine);
      
      // Brief pause to show status
      setTimeout(() => {
        // Continue with normal progress display
      }, 100);
    }
  }

  complete(): void {
    if (this.isActive) {
      if (this.isTTY) {
        (globalThis as any).process?.stdout?.write(TerminalController.clearLine());
        (globalThis as any).process?.stdout?.write(TerminalController.showCursor());
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
   * Create progress bar string
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
   * Get current spinner character
   */
  private getSpinner(): string {
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
   * Render line to terminal
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
import { PlainTextProgressRenderer } from './plain-text-progress-renderer.ts';

/**
 * Factory function to create appropriate progress renderer based on environment
 */
export function createProgressRenderer(config?: Partial<ProgressBarConfig>): ProgressRenderer {
  if (TerminalController.isTTY()) {
    return new TerminalProgressRenderer(config);
  } else {
    return new PlainTextProgressRenderer();
  }
}