import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { describe, it, beforeEach, afterEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';
import { spy, stub, restore } from 'https://deno.land/std@0.208.0/testing/mock.ts';

import { 
  PlainTextProgressRenderer, 
  MinimalProgressRenderer, 
  SilentProgressRenderer,
  createFallbackRenderer 
} from './plain-text-progress-renderer.ts';
import { FileStatus } from './types.ts';

describe('PlainTextProgressRenderer', () => {
  let renderer: PlainTextProgressRenderer;
  let consoleLogStub: ReturnType<typeof stub>;
  let consoleErrorStub: ReturnType<typeof stub>;

  beforeEach(() => {
    renderer = new PlainTextProgressRenderer();
    consoleLogStub = stub(console, 'log');
    consoleErrorStub = stub(console, 'error');
  });

  afterEach(() => {
    restore();
  });

  describe('start', () => {
    it('should log start message with total files', () => {
      renderer.start(5);

      assertEquals(consoleLogStub.calls.length, 1);
      assertEquals(consoleLogStub.calls[0].args[0], 'Starting analysis of 5 files...');
    });

    it('should reset internal state', () => {
      renderer.start(10);
      
      // Verify internal state is reset by checking subsequent calls
      renderer.updateProgress('test.ts', 1, 10);
      
      assertEquals(consoleLogStub.calls.length, 2); // start + updateProgress
    });
  });

  describe('updateProgress', () => {
    it('should log progress with percentage and filename', () => {
      renderer.start(5);
      renderer.updateProgress('test.ts', 2, 5);

      assertEquals(consoleLogStub.calls.length, 2); // start + updateProgress
      assertEquals(consoleLogStub.calls[1].args[0], '[2/5] 40% - test.ts');
    });

    it('should throttle progress updates', async () => {
      // Make multiple rapid calls
      renderer.updateProgress('test1.ts', 1, 5);
      renderer.updateProgress('test2.ts', 2, 5);
      renderer.updateProgress('test3.ts', 3, 5);

      // Should only log the first call due to throttling
      assertEquals(consoleLogStub.calls.length, 1);
      assertEquals(consoleLogStub.calls[0].args[0], '[1/5] 20% - test1.ts');

      // Wait for throttle period to pass
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      renderer.updateProgress('test4.ts', 4, 5);
      assertEquals(consoleLogStub.calls.length, 2);
      assertEquals(consoleLogStub.calls[1].args[0], '[4/5] 80% - test4.ts');
    });

    it('should truncate long filenames', () => {
      const longFilename = 'very/long/path/to/some/deeply/nested/file/that/exceeds/normal/length/test.ts';
      renderer.updateProgress(longFilename, 1, 5);

      assertEquals(consoleLogStub.calls.length, 1);
      const loggedMessage = consoleLogStub.calls[0].args[0];
      assertEquals(loggedMessage.includes('...'), true);
      assertEquals(loggedMessage.length < longFilename.length + 20, true); // Account for progress prefix
    });
  });

  describe('updateFileStatus', () => {
    it('should log status for completed files', () => {
      renderer.updateFileStatus('test.ts', FileStatus.SUCCESS);
      renderer.updateFileStatus('error.ts', FileStatus.ERROR);
      renderer.updateFileStatus('warn.ts', FileStatus.WARNING);

      assertEquals(consoleLogStub.calls.length, 3);
      assertEquals(consoleLogStub.calls[0].args[0], 'SUCCESS: test.ts');
      assertEquals(consoleLogStub.calls[1].args[0], 'ERROR: error.ts');
      assertEquals(consoleLogStub.calls[2].args[0], 'WARNING: warn.ts');
    });

    it('should not log status for pending or processing files', () => {
      renderer.updateFileStatus('test.ts', FileStatus.PENDING);
      renderer.updateFileStatus('test.ts', FileStatus.PROCESSING);

      assertEquals(consoleLogStub.calls.length, 0);
    });

    it('should truncate long filenames in status', () => {
      const longFilename = 'very/long/path/to/some/deeply/nested/file/that/exceeds/normal/length/test.ts';
      renderer.updateFileStatus(longFilename, FileStatus.SUCCESS);

      assertEquals(consoleLogStub.calls.length, 1);
      const loggedMessage = consoleLogStub.calls[0].args[0];
      assertEquals(loggedMessage.includes('...'), true);
    });
  });

  describe('complete', () => {
    it('should log completion message with duration', () => {
      renderer.start(5);
      
      // Wait a bit to have some duration
      setTimeout(() => {
        renderer.complete();
        
        assertEquals(consoleLogStub.calls.length, 2); // start + complete
        const completeMessage = consoleLogStub.calls[1].args[0];
        assertEquals(completeMessage.includes('Analysis complete'), true);
        assertEquals(completeMessage.includes('5 files'), true);
        assertEquals(completeMessage.includes('in'), true);
      }, 10);
    });
  });

  describe('error', () => {
    it('should log error message', () => {
      renderer.error('test.ts', 'Something went wrong');

      assertEquals(consoleErrorStub.calls.length, 1);
      assertEquals(consoleErrorStub.calls[0].args[0], 'ERROR processing test.ts: Something went wrong');
    });

    it('should truncate long filenames in error messages', () => {
      const longFilename = 'very/long/path/to/some/deeply/nested/file/that/exceeds/normal/length/test.ts';
      renderer.error(longFilename, 'Error message');

      assertEquals(consoleErrorStub.calls.length, 1);
      const errorMessage = consoleErrorStub.calls[0].args[0];
      assertEquals(errorMessage.includes('...'), true);
    });
  });

  describe('cleanup', () => {
    it('should not throw or log anything', () => {
      renderer.cleanup();
      
      assertEquals(consoleLogStub.calls.length, 0);
      assertEquals(consoleErrorStub.calls.length, 0);
    });
  });

  describe('filename truncation', () => {
    it('should not truncate short filenames', () => {
      renderer.updateProgress('short.ts', 1, 5);
      
      const message = consoleLogStub.calls[0].args[0];
      assertEquals(message.includes('short.ts'), true);
      assertEquals(message.includes('...'), false);
    });

    it('should preserve filename when truncating path', () => {
      const filename = 'very/long/path/to/some/deeply/nested/directory/structure/important-file.ts';
      renderer.updateProgress(filename, 1, 5);
      
      const message = consoleLogStub.calls[0].args[0];
      assertEquals(message.includes('important-file.ts'), true);
      assertEquals(message.includes('...'), true);
    });

    it('should truncate very long filenames', () => {
      const veryLongFilename = 'extremely-long-filename-that-exceeds-reasonable-limits-and-should-be-truncated.ts';
      renderer.updateProgress(veryLongFilename, 1, 5);
      
      const message = consoleLogStub.calls[0].args[0];
      assertEquals(message.includes('...'), true);
      assertEquals(message.length < veryLongFilename.length + 20, true);
    });
  });

  describe('duration formatting', () => {
    it('should format seconds correctly', () => {
      // This is testing the private method indirectly through complete()
      renderer.start(1);
      
      // Mock the start time to test duration formatting
      setTimeout(() => {
        renderer.complete();
        const message = consoleLogStub.calls[1].args[0];
        assertEquals(message.includes('s') || message.includes('m'), true);
      }, 100);
    });
  });
});

describe('MinimalProgressRenderer', () => {
  let renderer: MinimalProgressRenderer;
  let consoleLogStub: ReturnType<typeof stub>;
  let consoleErrorStub: ReturnType<typeof stub>;

  beforeEach(() => {
    renderer = new MinimalProgressRenderer();
    consoleLogStub = stub(console, 'log');
    consoleErrorStub = stub(console, 'error');
  });

  afterEach(() => {
    restore();
  });

  describe('start', () => {
    it('should log minimal start message', () => {
      renderer.start(10);

      assertEquals(consoleLogStub.calls.length, 1);
      assertEquals(consoleLogStub.calls[0].args[0], 'Analyzing 10 files...');
    });
  });

  describe('updateProgress', () => {
    it('should log progress at 25% milestone', () => {
      renderer.start(100);
      renderer.updateProgress('test.ts', 25, 100);

      assertEquals(consoleLogStub.calls.length, 2); // start + milestone
      assertEquals(consoleLogStub.calls[1].args[0], '25% complete...');
    });

    it('should log progress at 50% milestone', () => {
      renderer.start(100);
      renderer.updateProgress('test.ts', 50, 100);

      assertEquals(consoleLogStub.calls.length, 2); // start + milestone
      assertEquals(consoleLogStub.calls[1].args[0], '50% complete...');
    });

    it('should log progress at 75% milestone', () => {
      renderer.start(100);
      renderer.updateProgress('test.ts', 75, 100);

      assertEquals(consoleLogStub.calls.length, 2); // start + milestone
      assertEquals(consoleLogStub.calls[1].args[0], '75% complete...');
    });

    it('should not log progress between milestones', () => {
      renderer.start(100);
      renderer.updateProgress('test.ts', 30, 100);
      renderer.updateProgress('test.ts', 40, 100);
      renderer.updateProgress('test.ts', 45, 100);

      assertEquals(consoleLogStub.calls.length, 1); // Only start call
    });

    it('should only log each milestone once', () => {
      renderer.start(100);
      renderer.updateProgress('test.ts', 25, 100);
      renderer.updateProgress('test.ts', 26, 100);
      renderer.updateProgress('test.ts', 27, 100);

      assertEquals(consoleLogStub.calls.length, 2); // start + one milestone
      assertEquals(consoleLogStub.calls[1].args[0], '25% complete...');
    });
  });

  describe('updateFileStatus', () => {
    it('should track file status counts', () => {
      renderer.updateFileStatus('test1.ts', FileStatus.SUCCESS);
      renderer.updateFileStatus('test2.ts', FileStatus.ERROR);
      renderer.updateFileStatus('test3.ts', FileStatus.WARNING);
      renderer.updateFileStatus('test4.ts', FileStatus.SUCCESS);

      // Status updates don't log anything
      assertEquals(consoleLogStub.calls.length, 0);
    });
  });

  describe('complete', () => {
    it('should log summary with counts', () => {
      renderer.start(5);
      renderer.updateFileStatus('test1.ts', FileStatus.SUCCESS);
      renderer.updateFileStatus('test2.ts', FileStatus.ERROR);
      renderer.updateFileStatus('test3.ts', FileStatus.WARNING);
      renderer.updateFileStatus('test4.ts', FileStatus.SUCCESS);
      renderer.updateFileStatus('test5.ts', FileStatus.SUCCESS);
      
      renderer.complete();

      assertEquals(consoleLogStub.calls.length, 2); // start + complete
      const completeMessage = consoleLogStub.calls[1].args[0];
      assertEquals(completeMessage.includes('2 successful'), true);
      assertEquals(completeMessage.includes('1 warnings'), true);
      assertEquals(completeMessage.includes('1 errors'), true);
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      renderer.error('test.ts', 'Error message');

      assertEquals(consoleErrorStub.calls.length, 1);
      assertEquals(consoleErrorStub.calls[0].args[0], 'ERROR: test.ts: Error message');
    });
  });
});

describe('SilentProgressRenderer', () => {
  let renderer: SilentProgressRenderer;
  let consoleLogStub: ReturnType<typeof stub>;
  let consoleErrorStub: ReturnType<typeof stub>;

  beforeEach(() => {
    renderer = new SilentProgressRenderer();
    consoleLogStub = stub(console, 'log');
    consoleErrorStub = stub(console, 'error');
  });

  afterEach(() => {
    restore();
  });

  it('should not log anything for any method', () => {
    renderer.start(10);
    renderer.updateProgress('test.ts', 5, 10);
    renderer.updateFileStatus('test.ts', FileStatus.SUCCESS);
    renderer.complete();
    renderer.error('test.ts', 'Error message');
    renderer.cleanup();

    assertEquals(consoleLogStub.calls.length, 0);
    assertEquals(consoleErrorStub.calls.length, 0);
  });
});

describe('createFallbackRenderer', () => {
  let consoleLogStub: ReturnType<typeof stub>;

  beforeEach(() => {
    consoleLogStub = stub(console, 'log');
  });

  afterEach(() => {
    restore();
  });

  it('should create PlainTextProgressRenderer by default', () => {
    const renderer = createFallbackRenderer();
    
    renderer.start(5);
    assertEquals(consoleLogStub.calls.length, 1);
    assertEquals(consoleLogStub.calls[0].args[0], 'Starting analysis of 5 files...');
  });

  it('should create MinimalProgressRenderer for ci environment', () => {
    const renderer = createFallbackRenderer('ci');
    
    renderer.start(5);
    assertEquals(consoleLogStub.calls.length, 1);
    assertEquals(consoleLogStub.calls[0].args[0], 'Analyzing 5 files...');
  });

  it('should create MinimalProgressRenderer for minimal environment', () => {
    const renderer = createFallbackRenderer('minimal');
    
    renderer.start(5);
    assertEquals(consoleLogStub.calls.length, 1);
    assertEquals(consoleLogStub.calls[0].args[0], 'Analyzing 5 files...');
  });

  it('should create SilentProgressRenderer for silent environment', () => {
    const renderer = createFallbackRenderer('silent');
    
    renderer.start(5);
    renderer.updateProgress('test.ts', 1, 5);
    renderer.complete();
    
    assertEquals(consoleLogStub.calls.length, 0);
  });

  it('should create PlainTextProgressRenderer for unknown environment', () => {
    const renderer = createFallbackRenderer('unknown' as any);
    
    renderer.start(5);
    assertEquals(consoleLogStub.calls.length, 1);
    assertEquals(consoleLogStub.calls[0].args[0], 'Starting analysis of 5 files...');
  });
});