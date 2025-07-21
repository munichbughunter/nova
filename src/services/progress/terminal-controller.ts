/**
 * Terminal control utilities for ANSI escape sequences
 */
export class TerminalController {
  static readonly ESCAPE = '\x1b[';
  
  /**
   * Hide cursor
   */
  static hideCursor(): string {
    return `${this.ESCAPE}?25l`;
  }
  
  /**
   * Show cursor
   */
  static showCursor(): string {
    return `${this.ESCAPE}?25h`;
  }
  
  /**
   * Clear current line and move cursor to beginning
   */
  static clearLine(): string {
    return '\r\x1b[K';
  }
  
  /**
   * Move cursor to specific column
   */
  static moveCursorToColumn(column: number): string {
    return `${this.ESCAPE}${column}G`;
  }

  /**
   * Apply color code
   */
  static color(code: number): string {
    return `${this.ESCAPE}${code}m`;
  }
  
  /**
   * Reset all formatting
   */
  static reset(): string {
    return `${this.ESCAPE}0m`;
  }

  /**
   * Check if current environment supports TTY (interactive terminal)
   */
  static isTTY(): boolean {
    return (globalThis as any).process?.stdout?.isTTY === true;
  }

  /**
   * Check if terminal supports colors
   */
  static supportsColor(): boolean {
    const process = (globalThis as any).process;
    
    // Check for explicit color support
    if (process?.env?.FORCE_COLOR === '1' || process?.env?.FORCE_COLOR === 'true') {
      return true;
    }
    
    // Check for explicit color disable
    if (process?.env?.FORCE_COLOR === '0' || process?.env?.NO_COLOR !== undefined) {
      return false;
    }
    
    // Must have TTY for color support
    if (!this.isTTY()) {
      return false;
    }
    
    // Check common color-supporting terminals
    const term = process?.env?.TERM?.toLowerCase() || '';
    const colorterm = process?.env?.COLORTERM?.toLowerCase() || '';
    
    return (
      colorterm !== '' ||
      term.includes('color') ||
      term.includes('xterm') ||
      term.includes('screen') ||
      term.includes('tmux') ||
      term === 'cygwin' ||
      process?.platform === 'win32'
    );
  }

  /**
   * Check if terminal supports ANSI escape sequences
   */
  static supportsAnsi(): boolean {
    const process = (globalThis as any).process;
    
    // Windows Command Prompt traditionally doesn't support ANSI
    if (process?.platform === 'win32') {
      // Windows 10 and later support ANSI in newer versions
      const version = process?.env?.OS_VERSION;
      if (version && parseInt(version) >= 10) {
        return true;
      }
      // Check for Windows Terminal or other modern terminals
      return process?.env?.WT_SESSION !== undefined ||
             process?.env?.TERM_PROGRAM === 'vscode' ||
             process?.env?.TERM_PROGRAM === 'Windows Terminal';
    }
    
    // Unix-like systems generally support ANSI
    return this.isTTY() && process?.env?.TERM !== 'dumb';
  }

  /**
   * Check if terminal supports Unicode characters
   */
  static supportsUnicode(): boolean {
    const process = (globalThis as any).process;
    
    // Check locale settings
    const locale = process?.env?.LC_ALL || process?.env?.LC_CTYPE || process?.env?.LANG || '';
    if (locale.toLowerCase().includes('utf-8') || locale.toLowerCase().includes('utf8')) {
      return true;
    }
    
    // Modern terminals generally support Unicode
    const term = process?.env?.TERM_PROGRAM?.toLowerCase() || '';
    return term.includes('iterm') ||
           term.includes('terminal') ||
           term.includes('vscode') ||
           process?.env?.WT_SESSION !== undefined;
  }

  /**
   * Progress bar characters for different styles
   */
  static readonly PROGRESS_CHARS = {
    filled: '█',
    empty: '░',
    leftBorder: '▕',
    rightBorder: '▏',
    // Alternative style
    altFilled: '=',
    altEmpty: '-',
    altLeftBorder: '[',
    altRightBorder: ']'
  };

  /**
   * Spinner characters for animation
   */
  static readonly SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  /**
   * Status icons with Unicode support
   */
  static readonly STATUS_ICONS = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    pending: '⏳',
    processing: '🔄'
  };
}