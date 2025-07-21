import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { describe, it, beforeEach, afterEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';
import { spy, stub, restore } from 'https://deno.land/std@0.208.0/testing/mock.ts';

import { 
  MemoryManager, 
  MemoryAwareProcessor,
  createMemoryManager,
  DEFAULT_MEMORY_THRESHOLDS,
  MemoryStats,
  MemoryThresholds 
} from './memory-manager.ts';

// Mock process.memoryUsage for testing
const mockMemoryUsage = (heapUsed: number, heapTotal: number = heapUsed * 2) => {
  return stub(process, 'memoryUsage', () => ({
    rss: heapUsed * 1.5,
    heapTotal,
    heapUsed,
    external: heapUsed * 0.1,
    arrayBuffers: heapUsed * 0.05
  }));
};

describe('MemoryManager', () => {
  let memoryManager: MemoryManager;
  let memoryUsageStub: ReturnType<typeof stub>;
  let consoleWarnStub: ReturnType<typeof stub>;
  let consoleErrorStub: ReturnType<typeof stub>;

  beforeEach(() => {
    memoryManager = new MemoryManager();
    consoleWarnStub = stub(console, 'warn');
    consoleErrorStub = stub(console, 'error');
  });

  afterEach(() => {
    memoryManager.stopMonitoring();
    restore();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const manager = new MemoryManager();
      assertExists(manager);
    });

    it('should accept custom options', () => {
      const customThresholds: MemoryThresholds = {
        warning: 100 * 1024 * 1024,
        critical: 200 * 1024 * 1024,
        maximum: 300 * 1024 * 1024
      };

      const onWarning = spy();
      const manager = new MemoryManager({
        thresholds: customThresholds,
        checkInterval: 500,
        enableGarbageCollection: false,
        onWarning
      });

      assertExists(manager);
    });
  });

  describe('getMemoryStats', () => {
    it('should return current memory statistics', () => {
      memoryUsageStub = mockMemoryUsage(100 * 1024 * 1024);
      
      const stats = memoryManager.getMemoryStats();
      
      assertEquals(stats.heapUsed, 100 * 1024 * 1024);
      assertEquals(stats.heapTotal, 200 * 1024 * 1024);
      assertEquals(stats.rss, 150 * 1024 * 1024);
      assertExists(stats.external);
      assertExists(stats.arrayBuffers);
    });
  });

  describe('isMemorySafe', () => {
    it('should return true when memory usage is below maximum threshold', () => {
      memoryUsageStub = mockMemoryUsage(DEFAULT_MEMORY_THRESHOLDS.maximum - 1);
      
      assertEquals(memoryManager.isMemorySafe(), true);
    });

    it('should return false when memory usage exceeds maximum threshold', () => {
      memoryUsageStub = mockMemoryUsage(DEFAULT_MEMORY_THRESHOLDS.maximum + 1);
      
      assertEquals(memoryManager.isMemorySafe(), false);
    });
  });

  describe('forceGarbageCollection', () => {
    it('should return false when garbage collection is disabled', async () => {
      const manager = new MemoryManager({ enableGarbageCollection: false });
      
      const result = await manager.forceGarbageCollection();
      assertEquals(result, false);
    });

    it('should return false when global.gc is not available', async () => {
      const originalGc = (globalThis as any).gc;
      delete (globalThis as any).gc;
      
      const result = await memoryManager.forceGarbageCollection();
      assertEquals(result, false);
      
      // Restore global.gc
      if (originalGc) {
        (globalThis as any).gc = originalGc;
      }
    });

    it('should return true when garbage collection succeeds', async () => {
      const gcSpy = spy();
      (globalThis as any).gc = gcSpy;
      
      const result = await memoryManager.forceGarbageCollection();
      assertEquals(result, true);
      assertEquals(gcSpy.calls.length, 1);
    });

    it('should respect cooldown period', async () => {
      const gcSpy = spy();
      (globalThis as any).gc = gcSpy;
      
      await memoryManager.forceGarbageCollection();
      const secondResult = await memoryManager.forceGarbageCollection();
      
      assertEquals(gcSpy.calls.length, 1); // Should only be called once due to cooldown
      assertEquals(secondResult, false);
    });
  });

  describe('getMemoryUsagePercentage', () => {
    it('should calculate percentage correctly', () => {
      const halfMaximum = DEFAULT_MEMORY_THRESHOLDS.maximum / 2;
      memoryUsageStub = mockMemoryUsage(halfMaximum);
      
      const percentage = memoryManager.getMemoryUsagePercentage();
      assertEquals(percentage, 50);
    });

    it('should handle edge cases', () => {
      restore(); // Clear any existing stubs
      memoryUsageStub = mockMemoryUsage(0);
      assertEquals(memoryManager.getMemoryUsagePercentage(), 0);
      
      restore(); // Clear stub before creating new one
      memoryUsageStub = mockMemoryUsage(DEFAULT_MEMORY_THRESHOLDS.maximum);
      assertEquals(memoryManager.getMemoryUsagePercentage(), 100);
    });
  });

  describe('formatMemorySize', () => {
    it('should format bytes correctly', () => {
      assertEquals(memoryManager.formatMemorySize(1024), '1.0KB');
      assertEquals(memoryManager.formatMemorySize(1024 * 1024), '1.0MB');
      assertEquals(memoryManager.formatMemorySize(1024 * 1024 * 1024), '1.0GB');
      assertEquals(memoryManager.formatMemorySize(500), '500.0B');
    });

    it('should handle zero and negative values', () => {
      assertEquals(memoryManager.formatMemorySize(0), '0.0B');
      assertEquals(memoryManager.formatMemorySize(-1024), '-1024.0B');
    });
  });

  describe('getMemoryTrend', () => {
    it('should return unknown with insufficient history', () => {
      assertEquals(memoryManager.getMemoryTrend(), 'unknown');
    });

    it('should detect increasing trend', () => {
      // Simulate increasing memory usage
      memoryUsageStub = mockMemoryUsage(100 * 1024 * 1024);
      memoryManager.startMonitoring();
      
      // Wait for some history to build up
      setTimeout(() => {
        memoryUsageStub = mockMemoryUsage(120 * 1024 * 1024);
      }, 100);
      
      setTimeout(() => {
        memoryUsageStub = mockMemoryUsage(140 * 1024 * 1024);
        const trend = memoryManager.getMemoryTrend();
        assertEquals(trend, 'increasing');
        memoryManager.stopMonitoring();
      }, 200);
    });
  });

  describe('monitoring', () => {
    it('should start and stop monitoring', () => {
      assertEquals(memoryManager['isMonitoring'], false);
      
      memoryManager.startMonitoring();
      assertEquals(memoryManager['isMonitoring'], true);
      
      memoryManager.stopMonitoring();
      assertEquals(memoryManager['isMonitoring'], false);
    });

    it('should not start monitoring if already monitoring', () => {
      memoryManager.startMonitoring();
      const firstInterval = memoryManager['monitoringInterval'];
      
      memoryManager.startMonitoring();
      const secondInterval = memoryManager['monitoringInterval'];
      
      assertEquals(firstInterval, secondInterval);
      memoryManager.stopMonitoring();
    });

    it('should trigger warning callback when threshold exceeded', (done) => {
      const onWarning = spy();
      const manager = new MemoryManager({
        thresholds: {
          warning: 100 * 1024 * 1024,
          critical: 200 * 1024 * 1024,
          maximum: 300 * 1024 * 1024
        },
        checkInterval: 50,
        onWarning
      });

      memoryUsageStub = mockMemoryUsage(150 * 1024 * 1024);
      manager.startMonitoring();

      setTimeout(() => {
        manager.stopMonitoring();
        assert(onWarning.calls.length > 0);
        done();
      }, 100);
    });

    it('should trigger critical callback and force GC', (done) => {
      const onCritical = spy();
      const gcSpy = spy();
      (globalThis as any).gc = gcSpy;

      const manager = new MemoryManager({
        thresholds: {
          warning: 100 * 1024 * 1024,
          critical: 150 * 1024 * 1024,
          maximum: 300 * 1024 * 1024
        },
        checkInterval: 50,
        onCritical
      });

      memoryUsageStub = mockMemoryUsage(200 * 1024 * 1024);
      manager.startMonitoring();

      setTimeout(() => {
        manager.stopMonitoring();
        assert(onCritical.calls.length > 0);
        assert(gcSpy.calls.length > 0);
        done();
      }, 100);
    });
  });

  describe('getMemoryReport', () => {
    it('should return comprehensive memory report', () => {
      memoryUsageStub = mockMemoryUsage(500 * 1024 * 1024);
      
      const report = memoryManager.getMemoryReport();
      
      assertExists(report.current);
      assertExists(report.formatted);
      assertExists(report.thresholds);
      assertExists(report.status);
      assertExists(report.trend);
      assertExists(report.usagePercentage);
      
      assertEquals(report.current.heapUsed, 500 * 1024 * 1024);
      assertEquals(report.formatted.heapUsed, '500.0MB');
      assertEquals(report.status, 'warning'); // 500MB is above default warning threshold
    });
  });

  describe('clearCaches', () => {
    it('should clear memory history', () => {
      // Build up some history
      for (let i = 0; i < 50; i++) {
        memoryManager['addToHistory']({
          heapUsed: i * 1024 * 1024,
          heapTotal: i * 2 * 1024 * 1024,
          rss: i * 1.5 * 1024 * 1024,
          external: i * 0.1 * 1024 * 1024,
          arrayBuffers: i * 0.05 * 1024 * 1024
        });
      }

      assertEquals(memoryManager['memoryHistory'].length, 50);
      
      memoryManager.clearCaches();
      
      assertEquals(memoryManager['memoryHistory'].length, 10);
    });
  });
});

describe('MemoryAwareProcessor', () => {
  let processor: MemoryAwareProcessor;
  let memoryUsageStub: ReturnType<typeof stub>;

  beforeEach(() => {
    processor = new MemoryAwareProcessor();
  });

  afterEach(() => {
    processor.stopProcessing();
    restore();
  });

  describe('processing lifecycle', () => {
    it('should start and stop processing', () => {
      processor.startProcessing();
      assertEquals(processor['memoryManager']['isMonitoring'], true);
      
      processor.stopProcessing();
      assertEquals(processor['memoryManager']['isMonitoring'], false);
    });
  });

  describe('checkMemoryBeforeFile', () => {
    it('should return true when memory is safe', async () => {
      memoryUsageStub = mockMemoryUsage(100 * 1024 * 1024); // Well below limits
      
      const result = await processor.checkMemoryBeforeFile('test.ts');
      assertEquals(result, true);
    });

    it('should return false when memory limit exceeded', async () => {
      memoryUsageStub = mockMemoryUsage(2 * 1024 * 1024 * 1024); // 2GB, above default limit
      
      const result = await processor.checkMemoryBeforeFile('test.ts');
      assertEquals(result, false);
    });

    it('should check memory periodically based on file count', async () => {
      memoryUsageStub = mockMemoryUsage(100 * 1024 * 1024);
      
      // Process files below the check interval
      for (let i = 0; i < 5; i++) {
        await processor.checkMemoryBeforeFile(`test${i}.ts`);
      }
      
      // Should not have triggered memory check yet
      assertEquals(processor['processedFiles'], 5);
    });
  });

  describe('getProcessingStats', () => {
    it('should return processing statistics', async () => {
      memoryUsageStub = mockMemoryUsage(100 * 1024 * 1024);
      
      await processor.checkMemoryBeforeFile('test1.ts');
      await processor.checkMemoryBeforeFile('test2.ts');
      
      const stats = processor.getProcessingStats();
      assertEquals(stats.processedFiles, 2);
      assertExists(stats.memoryReport);
      assertEquals(stats.memoryReport.current.heapUsed, 100 * 1024 * 1024);
    });
  });

  describe('cleanupAfterFile', () => {
    it('should not throw errors', () => {
      processor.cleanupAfterFile('test.ts');
      // Should complete without throwing
    });
  });
});

describe('createMemoryManager', () => {
  let consoleWarnStub: ReturnType<typeof stub>;
  let consoleErrorStub: ReturnType<typeof stub>;

  beforeEach(() => {
    consoleWarnStub = stub(console, 'warn');
    consoleErrorStub = stub(console, 'error');
  });

  afterEach(() => {
    restore();
  });

  it('should create memory manager with default options', () => {
    const manager = createMemoryManager();
    assertExists(manager);
  });

  it('should create memory manager with custom options', () => {
    const manager = createMemoryManager({
      maxMemoryMB: 512,
      warningThresholdMB: 256,
      enableGC: false
    });
    
    assertExists(manager);
  });

  it('should trigger warning callback with custom thresholds', (done) => {
    const memoryUsageStub = mockMemoryUsage(300 * 1024 * 1024); // 300MB
    
    const manager = createMemoryManager({
      maxMemoryMB: 512,
      warningThresholdMB: 256
    });
    
    manager.startMonitoring();
    
    setTimeout(() => {
      manager.stopMonitoring();
      assert(consoleWarnStub.calls.length > 0);
      done();
    }, 100);
  });

  it('should trigger critical callback with high memory usage', (done) => {
    const memoryUsageStub = mockMemoryUsage(400 * 1024 * 1024); // 400MB
    
    const manager = createMemoryManager({
      maxMemoryMB: 512,
      warningThresholdMB: 256
    });
    
    manager.startMonitoring();
    
    setTimeout(() => {
      manager.stopMonitoring();
      assert(consoleWarnStub.calls.length > 0);
      done();
    }, 100);
  });

  it('should trigger maximum callback when limit exceeded', (done) => {
    const memoryUsageStub = mockMemoryUsage(600 * 1024 * 1024); // 600MB
    
    const manager = createMemoryManager({
      maxMemoryMB: 512,
      warningThresholdMB: 256
    });
    
    manager.startMonitoring();
    
    setTimeout(() => {
      manager.stopMonitoring();
      assert(consoleErrorStub.calls.length > 0);
      done();
    }, 100);
  });
});

describe('Memory thresholds and status detection', () => {
  let memoryManager: MemoryManager;
  let memoryUsageStub: ReturnType<typeof stub>;

  beforeEach(() => {
    memoryManager = new MemoryManager({
      thresholds: {
        warning: 100 * 1024 * 1024,   // 100MB
        critical: 200 * 1024 * 1024,  // 200MB
        maximum: 300 * 1024 * 1024    // 300MB
      }
    });
  });

  afterEach(() => {
    restore();
  });

  it('should detect safe memory status', () => {
    memoryUsageStub = mockMemoryUsage(50 * 1024 * 1024); // 50MB
    
    const report = memoryManager.getMemoryReport();
    assertEquals(report.status, 'safe');
  });

  it('should detect warning memory status', () => {
    memoryUsageStub = mockMemoryUsage(150 * 1024 * 1024); // 150MB
    
    const report = memoryManager.getMemoryReport();
    assertEquals(report.status, 'warning');
  });

  it('should detect critical memory status', () => {
    memoryUsageStub = mockMemoryUsage(250 * 1024 * 1024); // 250MB
    
    const report = memoryManager.getMemoryReport();
    assertEquals(report.status, 'critical');
  });

  it('should detect maximum memory status', () => {
    memoryUsageStub = mockMemoryUsage(350 * 1024 * 1024); // 350MB
    
    const report = memoryManager.getMemoryReport();
    assertEquals(report.status, 'maximum');
  });
});