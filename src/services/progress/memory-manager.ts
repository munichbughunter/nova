/**
 * Memory management utilities for sequential file processing
 * Helps prevent memory issues when processing large file sets
 */

/**
 * Memory usage statistics
 */
export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
}

/**
 * Memory threshold configuration
 */
export interface MemoryThresholds {
  warning: number;    // Warn when memory usage exceeds this (bytes)
  critical: number;   // Force garbage collection when exceeding this (bytes)
  maximum: number;    // Abort processing if memory exceeds this (bytes)
}

/**
 * Memory management options
 */
export interface MemoryManagerOptions {
  thresholds: MemoryThresholds;
  checkInterval: number;        // How often to check memory (ms)
  enableGarbageCollection: boolean;
  onWarning?: (stats: MemoryStats) => void;
  onCritical?: (stats: MemoryStats) => void;
  onMaximum?: (stats: MemoryStats) => void;
}

/**
 * Default memory thresholds (in bytes)
 */
export const DEFAULT_MEMORY_THRESHOLDS: MemoryThresholds = {
  warning: 500 * 1024 * 1024,    // 500MB
  critical: 750 * 1024 * 1024,   // 750MB
  maximum: 1024 * 1024 * 1024    // 1GB
};

/**
 * Memory manager for sequential file processing
 */
export class MemoryManager {
  private options: MemoryManagerOptions;
  private isMonitoring: boolean = false;
  private monitoringInterval?: number;
  private lastGCTime: number = 0;
  private gcCooldown: number = 5000; // 5 seconds between forced GC
  private memoryHistory: MemoryStats[] = [];
  private maxHistorySize: number = 100;

  constructor(options: Partial<MemoryManagerOptions> = {}) {
    this.options = {
      thresholds: DEFAULT_MEMORY_THRESHOLDS,
      checkInterval: 1000, // Check every second
      enableGarbageCollection: true,
      ...options
    };
  }

  /**
   * Start memory monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, this.options.checkInterval);
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats(): MemoryStats {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers || 0
    };
  }

  /**
   * Check if memory usage is within safe limits
   */
  isMemorySafe(): boolean {
    const stats = this.getMemoryStats();
    return stats.heapUsed < this.options.thresholds.maximum;
  }

  /**
   * Force garbage collection if available and needed
   */
  async forceGarbageCollection(): Promise<boolean> {
    if (!this.options.enableGarbageCollection) {
      return false;
    }

    const now = Date.now();
    if (now - this.lastGCTime < this.gcCooldown) {
      return false; // Too soon since last GC
    }

    if ((globalThis as any).gc) {
      try {
        (globalThis as any).gc();
        this.lastGCTime = now;
        return true;
      } catch (error) {
        console.warn('Failed to force garbage collection:', error);
        return false;
      }
    }

    return false;
  }

  /**
   * Clear memory caches and temporary data
   */
  clearCaches(): void {
    // Clear memory history except for recent entries
    if (this.memoryHistory.length > 10) {
      this.memoryHistory = this.memoryHistory.slice(-10);
    }

    // Suggest garbage collection
    if (this.options.enableGarbageCollection) {
      this.forceGarbageCollection();
    }
  }

  /**
   * Get memory usage trend (increasing, decreasing, stable)
   */
  getMemoryTrend(): 'increasing' | 'decreasing' | 'stable' | 'unknown' {
    if (this.memoryHistory.length < 3) {
      return 'unknown';
    }

    const recent = this.memoryHistory.slice(-3);
    const first = recent[0].heapUsed;
    const last = recent[recent.length - 1].heapUsed;
    const diff = last - first;
    const threshold = 10 * 1024 * 1024; // 10MB threshold

    if (diff > threshold) {
      return 'increasing';
    } else if (diff < -threshold) {
      return 'decreasing';
    } else {
      return 'stable';
    }
  }

  /**
   * Get memory usage as percentage of maximum threshold
   */
  getMemoryUsagePercentage(): number {
    const stats = this.getMemoryStats();
    return (stats.heapUsed / this.options.thresholds.maximum) * 100;
  }

  /**
   * Format memory size in human-readable format
   */
  formatMemorySize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)}${units[unitIndex]}`;
  }

  /**
   * Get memory report for debugging
   */
  getMemoryReport(): {
    current: MemoryStats;
    formatted: {
      heapUsed: string;
      heapTotal: string;
      rss: string;
      external: string;
    };
    thresholds: {
      warning: string;
      critical: string;
      maximum: string;
    };
    status: 'safe' | 'warning' | 'critical' | 'maximum';
    trend: 'increasing' | 'decreasing' | 'stable' | 'unknown';
    usagePercentage: number;
  } {
    const current = this.getMemoryStats();
    const status = this.getMemoryStatus(current);
    
    return {
      current,
      formatted: {
        heapUsed: this.formatMemorySize(current.heapUsed),
        heapTotal: this.formatMemorySize(current.heapTotal),
        rss: this.formatMemorySize(current.rss),
        external: this.formatMemorySize(current.external)
      },
      thresholds: {
        warning: this.formatMemorySize(this.options.thresholds.warning),
        critical: this.formatMemorySize(this.options.thresholds.critical),
        maximum: this.formatMemorySize(this.options.thresholds.maximum)
      },
      status,
      trend: this.getMemoryTrend(),
      usagePercentage: this.getMemoryUsagePercentage()
    };
  }

  /**
   * Check memory usage and trigger appropriate actions
   */
  private checkMemoryUsage(): void {
    const stats = this.getMemoryStats();
    this.addToHistory(stats);

    const status = this.getMemoryStatus(stats);

    switch (status) {
      case 'warning':
        if (this.options.onWarning) {
          this.options.onWarning(stats);
        }
        break;

      case 'critical':
        if (this.options.onCritical) {
          this.options.onCritical(stats);
        }
        // Force garbage collection
        this.forceGarbageCollection();
        break;

      case 'maximum':
        if (this.options.onMaximum) {
          this.options.onMaximum(stats);
        }
        // Force garbage collection as last resort
        this.forceGarbageCollection();
        break;
    }
  }

  /**
   * Get memory status based on current usage
   */
  private getMemoryStatus(stats: MemoryStats): 'safe' | 'warning' | 'critical' | 'maximum' {
    const heapUsed = stats.heapUsed;
    const thresholds = this.options.thresholds;

    if (heapUsed >= thresholds.maximum) {
      return 'maximum';
    } else if (heapUsed >= thresholds.critical) {
      return 'critical';
    } else if (heapUsed >= thresholds.warning) {
      return 'warning';
    } else {
      return 'safe';
    }
  }

  /**
   * Add memory stats to history
   */
  private addToHistory(stats: MemoryStats): void {
    this.memoryHistory.push(stats);
    
    // Keep history size manageable
    if (this.memoryHistory.length > this.maxHistorySize) {
      this.memoryHistory = this.memoryHistory.slice(-this.maxHistorySize);
    }
  }
}

/**
 * Memory-aware file processor that manages memory during sequential processing
 */
export class MemoryAwareProcessor {
  private memoryManager: MemoryManager;
  private processedFiles: number = 0;
  private memoryCheckInterval: number = 10; // Check memory every N files

  constructor(memoryManager?: MemoryManager) {
    this.memoryManager = memoryManager || new MemoryManager({
      onWarning: (stats) => {
        console.warn(`Memory usage warning: ${this.memoryManager.formatMemorySize(stats.heapUsed)}`);
      },
      onCritical: (stats) => {
        console.warn(`Critical memory usage: ${this.memoryManager.formatMemorySize(stats.heapUsed)}, forcing garbage collection`);
      },
      onMaximum: (stats) => {
        console.error(`Maximum memory usage exceeded: ${this.memoryManager.formatMemorySize(stats.heapUsed)}`);
      }
    });
  }

  /**
   * Start memory monitoring for file processing
   */
  startProcessing(): void {
    this.memoryManager.startMonitoring();
    this.processedFiles = 0;
  }

  /**
   * Stop memory monitoring
   */
  stopProcessing(): void {
    this.memoryManager.stopMonitoring();
  }

  /**
   * Check memory before processing a file
   */
  async checkMemoryBeforeFile(filename: string): Promise<boolean> {
    this.processedFiles++;

    // Check memory periodically
    if (this.processedFiles % this.memoryCheckInterval === 0) {
      if (!this.memoryManager.isMemorySafe()) {
        console.error(`Memory limit exceeded before processing ${filename}`);
        return false;
      }

      // Clear caches periodically
      this.memoryManager.clearCaches();
    }

    return true;
  }

  /**
   * Clean up after processing a file
   */
  cleanupAfterFile(filename: string): void {
    // Clear any file-specific caches or temporary data
    // This is a placeholder for file-specific cleanup
  }

  /**
   * Get memory manager instance
   */
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  /**
   * Get processing statistics
   */
  getProcessingStats(): {
    processedFiles: number;
    memoryReport: ReturnType<MemoryManager['getMemoryReport']>;
  } {
    return {
      processedFiles: this.processedFiles,
      memoryReport: this.memoryManager.getMemoryReport()
    };
  }
}

/**
 * Utility function to create a memory manager with sensible defaults
 */
export function createMemoryManager(options?: {
  maxMemoryMB?: number;
  warningThresholdMB?: number;
  enableGC?: boolean;
}): MemoryManager {
  const maxMemory = (options?.maxMemoryMB || 1024) * 1024 * 1024;
  const warningThreshold = (options?.warningThresholdMB || 512) * 1024 * 1024;
  
  return new MemoryManager({
    thresholds: {
      warning: warningThreshold,
      critical: maxMemory * 0.75,
      maximum: maxMemory
    },
    enableGarbageCollection: options?.enableGC !== false,
    onWarning: (stats) => {
      console.warn(`Memory usage: ${(stats.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    },
    onCritical: (stats) => {
      console.warn(`High memory usage: ${(stats.heapUsed / 1024 / 1024).toFixed(1)}MB, cleaning up...`);
    },
    onMaximum: (stats) => {
      console.error(`Memory limit exceeded: ${(stats.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    }
  });
}