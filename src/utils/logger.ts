import { colors } from '@cliffy/ansi/colors';

/**
 * Logger is a utility class for logging messages to the console.
 * It provides methods for logging debug, info, warning, error, and success messages.
 * It also provides a method for passing through any other method call to the console object.
 * It also provides a method for getting the current debug state.
 */
export class Logger {
  private debugEnabled: boolean;
  private context: string;

  constructor(context: string, debug = false) {
    this.context = context;
    this.debugEnabled = debug;
  }

  /**
   * Log debug information when debug mode is enabled
   */
  public debug(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.log(colors.dim(`[DEBUG ${this.context}]`), ...args);
    }
  }

  /**
   * Log general information
   */
  public info(...args: unknown[]): void {
    console.log(colors.blue(`[INFO ${this.context}]`), ...args);
  }

  /**
   * Log warning messages
   */
  public warn(...args: unknown[]): void {
    console.warn(colors.yellow(`[WARN ${this.context}]`), ...args);
  }

  /**
   * Log error messages
   */
  public error(...args: unknown[]): void {
    console.error(colors.red(`[ERROR ${this.context}]`), ...args);
  }

  /**
   * Log success messages
   */
  public success(...args: unknown[]): void {
    console.log(colors.green(`[SUCCESS ${this.context}]`), ...args);
  }

  /**
   * Create a child logger with a sub-context
   */
  public child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`, this.debugEnabled);
  }

  /**
   * Pass through any other method calls to the console object
   */
  public passThrough(method: keyof Console, ...args: unknown[]): void {
    // @ts-ignore: This is a workaround to allow passing through any method call to the console object
    console[method](...args);
  }

  public json(...args: unknown[]): void {
    this.passThrough('log', JSON.stringify(args, null, 2));
  }

  /**
   * Enable or disable debug mode
   */
  public setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Get current debug state
   */
  public isDebugEnabled(): boolean {
    return this.debugEnabled;
  }
}

// Create default logger instance
export const logger = new Logger('App', (() => {
  try {
    return Deno.env.get('nova_DEBUG') === 'true';
  } catch {
    return false;
  }
})()); 