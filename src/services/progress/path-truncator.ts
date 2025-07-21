/**
 * Utility class for truncating file paths to fit terminal width constraints
 */
export class PathTruncator {
  /**
   * Truncate a file path to fit within the specified maximum length
   * @param path File path to truncate
   * @param maxLength Maximum allowed length
   * @returns Truncated path
   */
  static truncate(path: string, maxLength: number = 40): string {
    if (path.length <= maxLength) {
      return path;
    }

    // Try to keep the filename and some parent directories
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    
    if (filename.length >= maxLength - 3) {
      // If filename itself is too long, truncate it
      return `...${filename.slice(-(maxLength - 3))}`;
    }

    // Build path from the end, keeping as much as possible
    let result = filename;
    let remainingLength = maxLength - filename.length - 4; // Reserve space for ".../"
    
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
   * Truncate path intelligently based on terminal width
   * @param path File path to truncate
   * @param terminalWidth Current terminal width
   * @param reservedSpace Space reserved for other display elements
   * @returns Truncated path
   */
  static truncateForTerminal(
    path: string, 
    terminalWidth: number = 80, 
    reservedSpace: number = 40
  ): string {
    const availableSpace = Math.max(20, terminalWidth - reservedSpace);
    return this.truncate(path, availableSpace);
  }

  /**
   * Get the terminal width, with fallback to default
   * @returns Terminal width in columns
   */
  static getTerminalWidth(): number {
    return (globalThis as any).process?.stdout?.columns || 80;
  }
}