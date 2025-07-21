import { assertEquals, assertExists, assertThrows } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { describe, it, beforeEach, afterEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';
import { spy, stub, restore, Spy, Stub } from 'https://deno.land/std@0.208.0/testing/mock.ts';

import { 
  ProgressErrorHandler, 
  SafeProgressRenderer, 
  ProgressErrorType,
  createSafeProgressRenderer 
} from './progress-error-handler.ts';
import { ProgressRenderer, FileStatus } from './types.ts';
import { PlainTextProgressRenderer } from './plain-text-progress-renderer.ts';

// Mock progress renderer for testing
class MockProgressRenderer implements ProgressRenderer {
  public startCalled = false;
  public updateProgressCalled = false;
  public completeCalled = false;
  public errorCalled = false;
  public cleanupCalled = false;
  public shouldThrowError = false;
  public errorToThrow: Error | null = null;

  start(totalFiles: number): void {
    this.startCalled = true;
    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    this.updateProgressCalled = true;
    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }
  }

  updateFileStatus(file: string, status: FileStatus): void {
    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }
  }

  complete(): void {
    this.completeCalled = true;
    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }
  }

  error(file: string, error: string): void {
    this.errorCalled = true;
    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }
  }

  cleanup(): void {
    this.cleanupCalled = true;
    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }
  }

  reset(): void {
    this.startCalled = false;
    this.updateProgressCalled = false;
    this.completeCalled = false;
    this.errorCalled = false;
    this.cleanupCalled = false;
    this.shouldThrowError = false;
    this.errorToThrow = null;
  }
}

describe('ProgressErrorHandler', () => {
  let mainRenderer: MockProgressRenderer;
  let fallbackRenderer: MockProgressRenderer;
  let errorHandler: ProgressErrorHandler;
  let errorCallback: Spy<any>;

  beforeEach(() => {
    mainRenderer = new MockProgressRenderer();
    fallbackRenderer = new MockProgressRenderer();
    errorCallback = spy();
    
    errorHandler = new ProgressErrorHandler(
      mainRenderer,
      fallbackRenderer,
      {
        maxErrors: 3,
        onError: errorCallback
      }
    );
  });

  afterEach(() => {
    restore();
  });

  describe('constructor', () => {
    it('should initialize with main renderer', () => {
      assertEquals(errorHandler.getRenderer(), mainRenderer);
      assertEquals(errorHandler.isInFallbackMode(), false);
    });

    it('should use PlainTextProgressRenderer as default fallback', () => {
      const handler = new ProgressErrorHandler(mainRenderer);
      assertExists(handler.getRenderer());
    });
  });

  describe('error handling', () => {
    it('should record errors when handleError is called', () => {
      const error = new Error('Test error');
      errorHandler.handleError(error, ProgressErrorType.RENDER_FAILURE);

      const errors = errorHandler.getErrors();
      assertEquals(errors.length, 1);
      assertEquals(errors[0].type, ProgressErrorType.RENDER_FAILURE);
      assertEquals(errors[0].message, 'Test error');
      assertEquals(errors[0].originalError, error);
    });

    it('should call error callback when provided', () => {
      const error = new Error('Test error');
      errorHandler.handleError(error, ProgressErrorType.RENDER_FAILURE);

      assertEquals(errorCallback.calls.length, 1);
      assertEquals((errorCallback.calls[0].args[0] as any).type, ProgressErrorType.RENDER_FAILURE);
    });

    it('should switch to fallback mode after max errors', () => {
      const error = new Error('Test error');
      
      // Trigger errors up to the threshold
      for (let i = 0; i < 3; i++) {
        errorHandler.handleError(error, ProgressErrorType.RENDER_FAILURE);
      }

      assertEquals(errorHandler.isInFallbackMode(), true);
      assertEquals(errorHandler.getRenderer(), fallbackRenderer);
    });

    it('should not switch to fallback mode before max errors', () => {
      const error = new Error('Test error');
      
      // Trigger errors below the threshold
      for (let i = 0; i < 2; i++) {
        errorHandler.handleError(error, ProgressErrorType.RENDER_FAILURE);
      }

      assertEquals(errorHandler.isInFallbackMode(), false);
      assertEquals(errorHandler.getRenderer(), mainRenderer);
    });
  });

  describe('terminal error detection', () => {
    it('should detect terminal not supported errors', () => {
      const error = new Error('not a terminal');
      errorHandler.handleTerminalError(error);

      const errors = errorHandler.getErrors();
      assertEquals(errors[0].type, ProgressErrorType.TERMINAL_NOT_SUPPORTED);
    });

    it('should detect ANSI not supported errors', () => {
      const error = new Error('ANSI escape codes not supported');
      errorHandler.handleTerminalError(error);

      const errors = errorHandler.getErrors();
      assertEquals(errors[0].type, ProgressErrorType.ANSI_NOT_SUPPORTED);
    });

    it('should classify other terminal errors as IO errors', () => {
      const error = new Error('Some random IO error');
      errorHandler.handleTerminalError(error);

      const errors = errorHandler.getErrors();
      assertEquals(errors[0].type, ProgressErrorType.IO_ERROR);
    });
  });

  describe('safe execution', () => {
    it('should execute operation successfully when no error occurs', async () => {
      const result = await errorHandler.safeExecute(
        () => 'success',
        ProgressErrorType.RENDER_FAILURE
      );

      assertEquals(result, 'success');
      assertEquals(errorHandler.getErrors().length, 0);
    });

    it('should handle errors in safe execution', async () => {
      const error = new Error('Operation failed');
      const result = await errorHandler.safeExecute(
        () => { throw error; },
        ProgressErrorType.RENDER_FAILURE
      );

      assertEquals(result, null);
      assertEquals(errorHandler.getErrors().length, 1);
      assertEquals(errorHandler.getErrors()[0].originalError, error);
    });

    it('should handle async operations', async () => {
      const result = await errorHandler.safeExecute(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'async success';
        },
        ProgressErrorType.RENDER_FAILURE
      );

      assertEquals(result, 'async success');
    });
  });

  describe('safe renderer calls', () => {
    it('should call renderer method successfully', () => {
      errorHandler.safeRendererCall('start', [5]);
      assertEquals(mainRenderer.startCalled, true);
    });

    it('should handle renderer method errors', () => {
      mainRenderer.shouldThrowError = true;
      mainRenderer.errorToThrow = new Error('Renderer error');

      errorHandler.safeRendererCall('start', [5]);

      assertEquals(errorHandler.getErrors().length, 1);
      assertEquals(errorHandler.getErrors()[0].type, ProgressErrorType.RENDER_FAILURE);
    });

    it('should switch to fallback renderer after errors', () => {
      mainRenderer.shouldThrowError = true;
      mainRenderer.errorToThrow = new Error('Renderer error');

      // Trigger enough errors to switch to fallback
      for (let i = 0; i < 3; i++) {
        errorHandler.safeRendererCall('start', [5]);
      }

      assertEquals(errorHandler.isInFallbackMode(), true);
      
      // Next call should use fallback renderer
      fallbackRenderer.reset();
      errorHandler.safeRendererCall('start', [5]);
      assertEquals(fallbackRenderer.startCalled, true);
    });
  });

  describe('reset functionality', () => {
    it('should reset error state', () => {
      const error = new Error('Test error');
      errorHandler.handleError(error, ProgressErrorType.RENDER_FAILURE);
      errorHandler.forceFallbackMode();

      assertEquals(errorHandler.getErrors().length, 1);
      assertEquals(errorHandler.isInFallbackMode(), true);

      errorHandler.reset();

      assertEquals(errorHandler.getErrors().length, 0);
      assertEquals(errorHandler.isInFallbackMode(), false);
      assertEquals(errorHandler.getRenderer(), mainRenderer);
    });
  });

  describe('force fallback mode', () => {
    it('should force switch to fallback mode', () => {
      assertEquals(errorHandler.isInFallbackMode(), false);
      
      errorHandler.forceFallbackMode();
      
      assertEquals(errorHandler.isInFallbackMode(), true);
      assertEquals(errorHandler.getRenderer(), fallbackRenderer);
    });

    it('should not switch if already in fallback mode', () => {
      errorHandler.forceFallbackMode();
      const firstFallbackRenderer = errorHandler.getRenderer();
      
      errorHandler.forceFallbackMode();
      const secondFallbackRenderer = errorHandler.getRenderer();
      
      assertEquals(firstFallbackRenderer, secondFallbackRenderer);
    });
  });
});

describe('SafeProgressRenderer', () => {
  let mainRenderer: MockProgressRenderer;
  let fallbackRenderer: MockProgressRenderer;
  let safeRenderer: SafeProgressRenderer;

  beforeEach(() => {
    mainRenderer = new MockProgressRenderer();
    fallbackRenderer = new MockProgressRenderer();
    safeRenderer = new SafeProgressRenderer(mainRenderer, fallbackRenderer);
  });

  afterEach(() => {
    restore();
  });

  describe('normal operation', () => {
    it('should delegate start to main renderer', () => {
      safeRenderer.start(5);
      assertEquals(mainRenderer.startCalled, true);
    });

    it('should delegate updateProgress to main renderer', () => {
      safeRenderer.updateProgress('test.ts', 1, 5);
      assertEquals(mainRenderer.updateProgressCalled, true);
    });

    it('should delegate complete to main renderer', () => {
      safeRenderer.complete();
      assertEquals(mainRenderer.completeCalled, true);
    });

    it('should delegate error to main renderer', () => {
      safeRenderer.error('test.ts', 'error message');
      assertEquals(mainRenderer.errorCalled, true);
    });

    it('should delegate cleanup to main renderer', () => {
      safeRenderer.cleanup();
      assertEquals(mainRenderer.cleanupCalled, true);
    });
  });

  describe('error handling', () => {
    it('should switch to fallback renderer after errors', () => {
      mainRenderer.shouldThrowError = true;
      mainRenderer.errorToThrow = new Error('Renderer error');

      // Trigger enough errors to switch to fallback
      for (let i = 0; i < 3; i++) {
        safeRenderer.start(5);
        mainRenderer.reset();
        mainRenderer.shouldThrowError = true;
        mainRenderer.errorToThrow = new Error('Renderer error');
      }

      assertEquals(safeRenderer.isInFallbackMode(), true);
      
      // Next call should use fallback renderer
      fallbackRenderer.reset();
      safeRenderer.start(5);
      assertEquals(fallbackRenderer.startCalled, true);
    });

    it('should provide access to error information', () => {
      mainRenderer.shouldThrowError = true;
      mainRenderer.errorToThrow = new Error('Renderer error');

      safeRenderer.start(5);

      const errors = safeRenderer.getErrors();
      assertEquals(errors.length, 1);
      assertEquals(errors[0].type, ProgressErrorType.RENDER_FAILURE);
    });
  });
});

describe('createSafeProgressRenderer', () => {
  it('should create SafeProgressRenderer with default fallback', () => {
    const mainRenderer = new MockProgressRenderer();
    const safeRenderer = createSafeProgressRenderer(mainRenderer);

    assertExists(safeRenderer);
    assertEquals(safeRenderer.isInFallbackMode(), false);
  });

  it('should create SafeProgressRenderer with custom fallback', () => {
    const mainRenderer = new MockProgressRenderer();
    const fallbackRenderer = new MockProgressRenderer();
    
    const safeRenderer = createSafeProgressRenderer(mainRenderer, {
      fallbackRenderer
    });

    assertExists(safeRenderer);
    assertEquals(safeRenderer.isInFallbackMode(), false);
  });

  it('should create SafeProgressRenderer with custom options', () => {
    const mainRenderer = new MockProgressRenderer();
    const onError = spy();
    
    const safeRenderer = createSafeProgressRenderer(mainRenderer, {
      maxErrors: 5,
      onError
    });

    assertExists(safeRenderer);
    
    // Trigger an error to test callback
    mainRenderer.shouldThrowError = true;
    mainRenderer.errorToThrow = new Error('Test error');
    safeRenderer.start(5);

    assertEquals(onError.calls.length, 1);
  });
});

describe('Error type detection', () => {
  let errorHandler: ProgressErrorHandler;

  beforeEach(() => {
    errorHandler = new ProgressErrorHandler(new MockProgressRenderer());
  });

  it('should detect terminal errors correctly', () => {
    const terminalErrors = [
      'not a terminal',
      'TTY not supported',
      'stdout is not a terminal',
      'Terminal not available'
    ];

    terminalErrors.forEach(message => {
      const error = new Error(message);
      errorHandler.handleTerminalError(error);
    });

    const errors = errorHandler.getErrors();
    assertEquals(errors.length, 4);
    errors.forEach(error => {
      assertEquals(error.type, ProgressErrorType.TERMINAL_NOT_SUPPORTED);
    });
  });

  it('should detect ANSI errors correctly', () => {
    const ansiErrors = [
      'ANSI escape codes not supported',
      'Color not supported',
      'Cursor control not available',
      'Escape sequences not supported'
    ];

    ansiErrors.forEach(message => {
      const error = new Error(message);
      errorHandler.handleTerminalError(error);
    });

    const errors = errorHandler.getErrors();
    assertEquals(errors.length, 4);
    errors.forEach(error => {
      assertEquals(error.type, ProgressErrorType.ANSI_NOT_SUPPORTED);
    });
  });
});

describe('Error context and logging', () => {
  let errorHandler: ProgressErrorHandler;
  let consoleWarnStub: Stub<Console>;

  beforeEach(() => {
    errorHandler = new ProgressErrorHandler(new MockProgressRenderer());
    consoleWarnStub = stub(console, 'warn');
  });

  afterEach(() => {
    restore();
  });

  it('should include context in error records', () => {
    const error = new Error('Test error');
    const context = { file: 'test.ts', line: 42 };
    
    errorHandler.handleError(error, ProgressErrorType.RENDER_FAILURE, context);

    const errors = errorHandler.getErrors();
    assertEquals(errors[0].context, context);
  });

  it('should log fallback mode switch', () => {
    const error = new Error('Test error');
    
    // Trigger enough errors to switch to fallback mode
    for (let i = 0; i < 3; i++) {
      errorHandler.handleError(error, ProgressErrorType.RENDER_FAILURE);
    }

    assertEquals(consoleWarnStub.calls.length, 1);
    assertEquals(
      (consoleWarnStub.calls[0].args[0] as string).includes('switching to fallback mode'),
      true
    );
  });
});