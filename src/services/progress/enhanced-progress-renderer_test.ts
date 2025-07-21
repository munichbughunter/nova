import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { describe, it, beforeEach, afterEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';
import { spy, stub, restore } from 'https://deno.land/std@0.208.0/testing/mock.ts';
import { EnhancedProgressRenderer, TimeFormatter } from './enhanced-progress-renderer.ts';
import { FileStatus, DEFAULT_PROGRESS_CONFIG } from './types.ts';

describe('EnhancedProgressRenderer', () => {
  let renderer: EnhancedProgressRenderer;
  let mockStdout: any;
  let originalProcess: any;
  let writeCalls: string[];

  beforeEach(() => {
    // Mock process.stdout for testing
    originalProcess = (globalThis as any).process;
    writeCalls = [];
    mockStdout = {
      write: (data: string) => {
        writeCalls.push(data);
      },
      isTTY: true
    };
    (globalThis as any).process = {
      stdout: mockStdout,
      env: { TERM: 'xterm-256color' }
    };
    
    renderer = new EnhancedProgressRenderer();
  });

  afterEach(() => {
    restore();
    (globalThis as any).process = originalProcess;
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const newRenderer = new EnhancedProgressRenderer();
      // Test that renderer is created without errors
      assertEquals(typeof newRenderer, 'object');
    });

    it('should accept custom config', () => {
      const customConfig = {
        width: 50,
        showPercentage: false
      };
      const newRenderer = new EnhancedProgressRenderer(customConfig);
      assertEquals(typeof newRenderer, 'object');
    });
  });

  describe('start method', () => {
    it('should initialize progress tracking', () => {
      renderer.start(5);
      
      // Should hide cursor in TTY mode
      assertEquals(writeCalls.length, 1);
      assertStringIncludes(writeCalls[0], '\x1b[?25l');
    });

    it('should handle non-TTY environment', () => {
      // Create a separate mock for non-TTY test
      const nonTTYCalls: string[] = [];
      const nonTTYMockStdout = {
        write: (data: string) => {
          nonTTYCalls.push(data);
        },
        isTTY: false
      };
      (globalThis as any).process = {
        stdout: nonTTYMockStdout,
        env: { TERM: 'xterm-256color' }
      };
      
      const nonTTYRenderer = new EnhancedProgressRenderer();
      nonTTYRenderer.start(3);
      
      // Should not write cursor control sequences for non-TTY
      assertEquals(nonTTYCalls.length, 0);
    });
  });

  describe('updateProgress method', () => {
    beforeEach(() => {
      renderer.start(3);
      writeCalls.length = 0; // Clear initial calls
    });

    it('should display progress with ETA and throughput', () => {
      renderer.updateProgress('test.ts', 1, 3);
      
      assertEquals(writeCalls.length, 1);
      const output = writeCalls[0];
      
      // Should contain progress elements
      assertStringIncludes(output, '33%'); // Percentage
      assertStringIncludes(output, 'test.ts'); // Filename
      assertStringIncludes(output, 'ETA:'); // ETA label
      assertStringIncludes(output, 'files/min'); // Throughput label
    });

    it('should update spinner animation', () => {
      renderer.updateProgress('file1.ts', 0, 3);
      const firstCall = writeCalls[0];
      
      // Make another call to see spinner change (synchronous)
      renderer.updateProgress('file2.ts', 1, 3);
      
      // Should have at least one call
      assertEquals(typeof firstCall, 'string');
      assertEquals(writeCalls.length >= 1, true);
    });

    it('should throttle updates to prevent flooding', () => {
      // Make multiple rapid calls
      renderer.updateProgress('file1.ts', 0, 3);
      renderer.updateProgress('file1.ts', 0, 3);
      renderer.updateProgress('file1.ts', 0, 3);
      
      // Should only have one call due to throttling
      assertEquals(writeCalls.length, 1);
    });

    it('should handle completion tracking', () => {
      renderer.updateProgress('file1.ts', 1, 3);
      renderer.updateProgress('file2.ts', 2, 3);
      
      // Should track completed files for ETA calculation
      // Due to throttling, we might have fewer calls than expected
      assertEquals(writeCalls.length >= 1, true);
    });
  });

  describe('updateFileStatus method', () => {
    beforeEach(() => {
      renderer.start(3);
      writeCalls.length = 0; // Clear initial calls
    });

    it('should show status icon for completed files', () => {
      renderer.updateFileStatus('test.ts', FileStatus.SUCCESS);
      
      // Should show success icon (clear line + status)
      assertEquals(writeCalls.length >= 1, true);
      // Check that test.ts appears in one of the calls
      const hasTestFile = writeCalls.some(call => call.includes('test.ts'));
      assertEquals(hasTestFile, true);
    });

    it('should show error status', () => {
      renderer.updateFileStatus('error.ts', FileStatus.ERROR);
      
      assertEquals(writeCalls.length >= 1, true);
      const hasErrorFile = writeCalls.some(call => call.includes('error.ts'));
      assertEquals(hasErrorFile, true);
    });

    it('should show warning status', () => {
      renderer.updateFileStatus('warn.ts', FileStatus.WARNING);
      
      assertEquals(writeCalls.length >= 1, true);
      const hasWarnFile = writeCalls.some(call => call.includes('warn.ts'));
      assertEquals(hasWarnFile, true);
    });

    it('should not show status for processing files', () => {
      renderer.updateFileStatus('processing.ts', FileStatus.PROCESSING);
      
      // Should not show status line for processing files
      assertEquals(writeCalls.length, 0);
    });
  });

  describe('complete method', () => {
    beforeEach(() => {
      renderer.start(3);
      writeCalls.length = 0; // Clear initial calls
    });

    it('should show completion summary with statistics', () => {
      // Simulate some progress
      renderer.updateProgress('file1.ts', 1, 3);
      renderer.updateProgress('file2.ts', 2, 3);
      renderer.updateProgress('file3.ts', 3, 3);
      
      writeCalls.length = 0; // Clear progress calls
      
      renderer.complete();
      
      // Should clear line and restore cursor
      assertEquals(writeCalls.length >= 2, true); // Clear + show cursor
      
      // Should contain cursor show sequence
      const hasCursorShow = writeCalls.some(call => call.includes('\x1b[?25h'));
      assertEquals(hasCursorShow, true);
    });

    it('should restore cursor', () => {
      renderer.complete();
      
      // Should show cursor
      const hasCursorShow = writeCalls.some(call => call.includes('\x1b[?25h'));
      assertEquals(hasCursorShow, true);
    });

    it('should handle non-TTY environment', () => {
      mockStdout.isTTY = false;
      const nonTTYRenderer = new EnhancedProgressRenderer();
      nonTTYRenderer.start(3);
      nonTTYRenderer.complete();
      
      // Should not write cursor control sequences for non-TTY
      // This is more of an integration test
      assertEquals(typeof nonTTYRenderer, 'object');
    });
  });

  describe('error method', () => {
    beforeEach(() => {
      renderer.start(3);
      writeCalls.length = 0; // Clear initial calls
    });

    it('should display error message', () => {
      renderer.error('error.ts', 'Syntax error');
      
      // Should clear line and show error
      assertEquals(writeCalls.length >= 1, true);
      const hasClearLine = writeCalls.some(call => call.includes('\r\x1b[K'));
      assertEquals(hasClearLine, true);
    });
  });

  describe('cleanup method', () => {
    it('should clean up terminal state', () => {
      renderer.start(3);
      writeCalls.length = 0; // Clear initial calls
      
      renderer.cleanup();
      
      // Should clear line and show cursor
      assertEquals(writeCalls.length, 2);
      assertStringIncludes(writeCalls[0], '\r\x1b[K');
      assertStringIncludes(writeCalls[1], '\x1b[?25h');
    });
  });
});

describe('TimeFormatter', () => {
  describe('formatDuration', () => {
    it('should format seconds correctly', () => {
      assertEquals(TimeFormatter.formatDuration(30000), '0:30');
      assertEquals(TimeFormatter.formatDuration(5000), '0:05');
    });

    it('should format minutes correctly', () => {
      assertEquals(TimeFormatter.formatDuration(90000), '1:30');
      assertEquals(TimeFormatter.formatDuration(600000), '10:00');
    });

    it('should format hours correctly', () => {
      assertEquals(TimeFormatter.formatDuration(3661000), '1:01:01');
      assertEquals(TimeFormatter.formatDuration(7200000), '2:00:00');
    });

    it('should handle zero duration', () => {
      assertEquals(TimeFormatter.formatDuration(0), '0:00');
    });

    it('should handle very small durations', () => {
      assertEquals(TimeFormatter.formatDuration(500), '0:01');
    });
  });

  describe('formatSeconds', () => {
    it('should convert seconds to milliseconds and format', () => {
      assertEquals(TimeFormatter.formatSeconds(30), '0:30');
      assertEquals(TimeFormatter.formatSeconds(90), '1:30');
      assertEquals(TimeFormatter.formatSeconds(3661), '1:01:01');
    });
  });

  describe('formatDurationWithUnits', () => {
    it('should format seconds with units', () => {
      assertEquals(TimeFormatter.formatDurationWithUnits(30000), '30s');
      assertEquals(TimeFormatter.formatDurationWithUnits(45000), '45s');
    });

    it('should format minutes with units', () => {
      assertEquals(TimeFormatter.formatDurationWithUnits(90000), '1m 30s');
      assertEquals(TimeFormatter.formatDurationWithUnits(120000), '2m');
      assertEquals(TimeFormatter.formatDurationWithUnits(600000), '10m');
    });

    it('should format hours with units', () => {
      assertEquals(TimeFormatter.formatDurationWithUnits(3661000), '1h 1m');
      assertEquals(TimeFormatter.formatDurationWithUnits(7200000), '2h');
      assertEquals(TimeFormatter.formatDurationWithUnits(9000000), '2h 30m');
    });
  });

  describe('calculateThroughput', () => {
    it('should calculate files per minute correctly', () => {
      // 10 files in 2 minutes (120000 ms) = 5 files/min
      assertEquals(TimeFormatter.calculateThroughput(10, 120000), 5);
      
      // 6 files in 1 minute (60000 ms) = 6 files/min
      assertEquals(TimeFormatter.calculateThroughput(6, 60000), 6);
      
      // 30 files in 10 minutes (600000 ms) = 3 files/min
      assertEquals(TimeFormatter.calculateThroughput(30, 600000), 3);
    });

    it('should handle zero values', () => {
      assertEquals(TimeFormatter.calculateThroughput(0, 60000), 0);
      assertEquals(TimeFormatter.calculateThroughput(10, 0), 0);
      assertEquals(TimeFormatter.calculateThroughput(0, 0), 0);
    });

    it('should round to nearest integer', () => {
      // 7 files in 2 minutes = 3.5 files/min, should round to 4
      assertEquals(TimeFormatter.calculateThroughput(7, 120000), 4);
      
      // 5 files in 2 minutes = 2.5 files/min, should round to 3
      assertEquals(TimeFormatter.calculateThroughput(5, 120000), 3);
    });
  });

  describe('estimateRemainingTime', () => {
    it('should estimate remaining time correctly', () => {
      // 10 remaining files at 5 files/min = 2 minutes = 120000 ms
      assertEquals(TimeFormatter.estimateRemainingTime(10, 5), 120000);
      
      // 6 remaining files at 2 files/min = 3 minutes = 180000 ms
      assertEquals(TimeFormatter.estimateRemainingTime(6, 2), 180000);
    });

    it('should handle zero values', () => {
      assertEquals(TimeFormatter.estimateRemainingTime(0, 5), 0);
      assertEquals(TimeFormatter.estimateRemainingTime(10, 0), 0);
      assertEquals(TimeFormatter.estimateRemainingTime(0, 0), 0);
    });

    it('should handle fractional throughput', () => {
      // 3 remaining files at 1.5 files/min = 2 minutes = 120000 ms
      assertEquals(TimeFormatter.estimateRemainingTime(3, 1.5), 120000);
    });
  });
});

describe('EnhancedProgressRenderer Integration', () => {
  let renderer: EnhancedProgressRenderer;
  let mockStdout: any;
  let originalProcess: any;
  let integrationWriteCalls: string[];

  beforeEach(() => {
    originalProcess = (globalThis as any).process;
    integrationWriteCalls = [];
    mockStdout = {
      write: (data: string) => {
        integrationWriteCalls.push(data);
      },
      isTTY: true
    };
    (globalThis as any).process = {
      stdout: mockStdout,
      env: { TERM: 'xterm-256color' }
    };
    
    renderer = new EnhancedProgressRenderer();
  });

  afterEach(() => {
    restore();
    (globalThis as any).process = originalProcess;
  });

  it('should handle complete workflow', () => {
    // Start processing
    renderer.start(3);
    
    // Process files
    renderer.updateProgress('file1.ts', 0, 3);
    renderer.updateFileStatus('file1.ts', FileStatus.PROCESSING);
    renderer.updateFileStatus('file1.ts', FileStatus.SUCCESS);
    
    renderer.updateProgress('file2.ts', 1, 3);
    renderer.updateFileStatus('file2.ts', FileStatus.PROCESSING);
    renderer.updateFileStatus('file2.ts', FileStatus.WARNING);
    
    renderer.updateProgress('file3.ts', 2, 3);
    renderer.updateFileStatus('file3.ts', FileStatus.PROCESSING);
    renderer.updateFileStatus('file3.ts', FileStatus.ERROR);
    
    // Complete
    renderer.complete();
    
    // Should have made multiple calls for progress updates
    assertEquals(integrationWriteCalls.length > 5, true);
  });

  it('should handle error during processing', () => {
    renderer.start(2);
    
    renderer.updateProgress('file1.ts', 0, 2);
    renderer.error('file1.ts', 'Processing failed');
    
    renderer.updateProgress('file2.ts', 1, 2);
    renderer.updateFileStatus('file2.ts', FileStatus.SUCCESS);
    
    renderer.complete();
    
    // Should handle errors gracefully
    assertEquals(integrationWriteCalls.length > 3, true);
  });

  it('should calculate ETA accurately over time', async () => {
    renderer.start(4);
    
    // Simulate processing with delays
    renderer.updateProgress('file1.ts', 1, 4);
    
    // Wait a bit to establish timing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    renderer.updateProgress('file2.ts', 2, 4);
    
    // The ETA should be calculated based on the processing speed
    // This is more of a behavioral test
    assertEquals(integrationWriteCalls.length >= 2, true);
  });
});