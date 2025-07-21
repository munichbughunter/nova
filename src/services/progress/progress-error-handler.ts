import { ProgressRenderer, FileStatus } from './types.ts';
import { PlainTextProgressRenderer } from './plain-text-progress-renderer.ts';
import { TerminalController } from './terminal-controller.ts';

/**
 * Error types that can occur during progress rendering
 */
export enum ProgressErrorType {
  TERMINAL_NOT_SUPPORTED = 'terminal_not_supported',
  ANSI_NOT_SUPPORTED = 'ansi_not_supported',
  RENDER_FAILURE = 'render_failure',
  MEMORY_ERROR = 'memory_error',
  IO_ERROR = 'io_error'
}

/**
 * Progress rendering error with context
 */
export interface ProgressError {
  type: ProgressErrorType;
  message: string;
  originalError?: Error;
  context?: Record<string, any>;
  timestamp: Date;
}

/**
 * Error handler for progress rendering failures with automatic fallback
 */
export class ProgressErrorHandler {
  private renderer: ProgressRenderer;
  private fallbackRenderer: ProgressRenderer;
  private fallbackMode: boolean = false;
  private errorCount: number = 0;
  private maxErrors: number = 3;
  private errors: ProgressError[] = [];
  private onErrorCallback?: (error: ProgressError) => void;

  constructor(
    renderer: ProgressRenderer,
    fallbackRenderer?: ProgressRenderer,
    options: {
      maxErrors?: number;
      onError?: (error: ProgressError) => void;
    } = {}
  ) {
    this.renderer = renderer;
    this.fallbackRenderer = fallbackRenderer || new PlainTextProgressRenderer();
    this.maxErrors = options.maxErrors || 3;
    this.onErrorCallback = options.onError;
  }

  /**
   * Get the current active renderer (main or fallback)
   */
  getRenderer(): ProgressRenderer {
    return this.fallbackMode ? this.fallbackRenderer : this.renderer;
  }

  /**
   * Check if currently in fallback mode
   */
  isInFallbackMode(): boolean {
    return this.fallbackMode;
  }

  /**
   * Get all recorded errors
   */
  getErrors(): ProgressError[] {
    return [...this.errors];
  }

  /**
   * Handle a progress rendering error
   */
  handleError(error: Error, type: ProgressErrorType, context?: Record<string, any>): void {
    const progressError: ProgressError = {
      type,
      message: error.message,
      originalError: error,
      context,
      timestamp: new Date()
    };

    this.errors.push(progressError);
    this.errorCount++;

    // Call error callback if provided
    if (this.onErrorCallback) {
      try {
        this.onErrorCallback(progressError);
      } catch (callbackError) {
        // Ignore callback errors to prevent infinite loops
        console.warn('Error in progress error callback:', callbackError);
      }
    }

    // Switch to fallback mode if error threshold reached
    if (!this.fallbackMode && this.errorCount >= this.maxErrors) {
      this.switchToFallbackMode(progressError);
    }

    // Log error for debugging
    this.logError(progressError);
  }

  /**
   * Handle terminal-specific errors
   */
  handleTerminalError(error: Error, context?: Record<string, any>): void {
    if (this.isTerminalNotSupportedError(error)) {
      this.handleError(error, ProgressErrorType.TERMINAL_NOT_SUPPORTED, context);
    } else if (this.isAnsiNotSupportedError(error)) {
      this.handleError(error, ProgressErrorType.ANSI_NOT_SUPPORTED, context);
    } else {
      this.handleError(error, ProgressErrorType.IO_ERROR, context);
    }
  }

  /**
   * Handle rendering errors
   */
  handleRenderError(error: Error, context?: Record<string, any>): void {
    this.handleError(error, ProgressErrorType.RENDER_FAILURE, context);
  }

  /**
   * Handle memory-related errors
   */
  handleMemoryError(error: Error, context?: Record<string, any>): void {
    this.handleError(error, ProgressErrorType.MEMORY_ERROR, context);
  }

  /**
   * Safely execute a progress operation with error handling
   */
  async safeExecute<T>(
    operation: () => T | Promise<T>,
    errorType: ProgressErrorType,
    context?: Record<string, any>
  ): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      this.handleError(error as Error, errorType, context);
      return null;
    }
  }

  /**
   * Safely call a renderer method with error handling
   */
  safeRendererCall(
    method: keyof ProgressRenderer,
    args: any[],
    context?: Record<string, any>
  ): void {
    try {
      const renderer = this.getRenderer();
      (renderer[method] as any)(...args);
    } catch (error) {
      this.handleRenderError(error as Error, {
        method,
        args,
        ...context
      });
    }
  }

  /**
   * Reset error state
   */
  reset(): void {
    this.errorCount = 0;
    this.errors = [];
    this.fallbackMode = false;
  }

  /**
   * Force switch to fallback mode
   */
  forceFallbackMode(): void {
    if (!this.fallbackMode) {
      this.switchToFallbackMode({
        type: ProgressErrorType.RENDER_FAILURE,
        message: 'Forced fallback mode',
        timestamp: new Date()
      });
    }
  }

  /**
   * Check if error indicates terminal is not supported
   */
  private isTerminalNotSupportedError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('tty') || 
           message.includes('terminal') || 
           message.includes('stdout') ||
           message.includes('not a terminal');
  }

  /**
   * Check if error indicates ANSI codes are not supported
   */
  private isAnsiNotSupportedError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('ansi') || 
           message.includes('escape') || 
           message.includes('color') ||
           message.includes('cursor');
  }

  /**
   * Switch to fallback mode
   */
  private switchToFallbackMode(triggeringError: ProgressError): void {
    this.fallbackMode = true;
    
    // Clean up main renderer
    try {
      this.renderer.cleanup();
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    // Log fallback switch
    console.warn(
      `Progress display error (${triggeringError.type}), switching to fallback mode: ${triggeringError.message}`
    );
  }

  /**
   * Log error for debugging
   */
  private logError(error: ProgressError): void {
    const process = (globalThis as any).process;
    if (process?.env?.DEBUG || process?.env?.NODE_ENV === 'development') {
      console.error('Progress Error:', {
        type: error.type,
        message: error.message,
        context: error.context,
        timestamp: error.timestamp.toISOString()
      });
    }
  }
}

/**
 * Wrapper renderer that automatically handles errors and falls back
 */
export class SafeProgressRenderer implements ProgressRenderer {
  private errorHandler: ProgressErrorHandler;

  constructor(
    mainRenderer: ProgressRenderer,
    fallbackRenderer?: ProgressRenderer,
    options?: {
      maxErrors?: number;
      onError?: (error: ProgressError) => void;
    }
  ) {
    this.errorHandler = new ProgressErrorHandler(mainRenderer, fallbackRenderer, options);
  }

  start(totalFiles: number): void {
    this.errorHandler.safeRendererCall('start', [totalFiles], { totalFiles });
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    this.errorHandler.safeRendererCall('updateProgress', [currentFile, completed, total], {
      currentFile,
      completed,
      total
    });
  }

  updateFileStatus(file: string, status: FileStatus): void {
    this.errorHandler.safeRendererCall('updateFileStatus', [file, status], {
      file,
      status
    });
  }

  complete(): void {
    this.errorHandler.safeRendererCall('complete', []);
  }

  error(file: string, error: string): void {
    this.errorHandler.safeRendererCall('error', [file, error], {
      file,
      error
    });
  }

  cleanup(): void {
    this.errorHandler.safeRendererCall('cleanup', []);
  }

  /**
   * Get the error handler for additional error information
   */
  getErrorHandler(): ProgressErrorHandler {
    return this.errorHandler;
  }

  /**
   * Check if currently in fallback mode
   */
  isInFallbackMode(): boolean {
    return this.errorHandler.isInFallbackMode();
  }

  /**
   * Get all recorded errors
   */
  getErrors(): ProgressError[] {
    return this.errorHandler.getErrors();
  }
}

/**
 * Factory function to create a safe progress renderer with error handling
 */
export function createSafeProgressRenderer(
  mainRenderer: ProgressRenderer,
  options?: {
    fallbackRenderer?: ProgressRenderer;
    maxErrors?: number;
    onError?: (error: ProgressError) => void;
  }
): SafeProgressRenderer {
  return new SafeProgressRenderer(
    mainRenderer,
    options?.fallbackRenderer,
    {
      maxErrors: options?.maxErrors,
      onError: options?.onError
    }
  );
}