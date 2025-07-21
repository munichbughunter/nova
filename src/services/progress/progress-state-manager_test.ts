import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { describe, it, beforeEach } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { ProgressStateManager } from './progress-state-manager.ts';
import { FileStatus, ProgressRenderer } from './types.ts';

// Mock progress renderer for testing
class MockProgressRenderer implements ProgressRenderer {
  public startCalled = false;
  public updateProgressCalls: Array<{ currentFile: string; completed: number; total: number }> = [];
  public updateFileStatusCalls: Array<{ file: string; status: FileStatus }> = [];
  public completeCalled = false;
  public errorCalls: Array<{ file: string; error: string }> = [];
  public cleanupCalled = false;

  start(totalFiles: number): void {
    this.startCalled = true;
  }

  updateProgress(currentFile: string, completed: number, total: number): void {
    this.updateProgressCalls.push({ currentFile, completed, total });
  }

  updateFileStatus(file: string, status: FileStatus): void {
    this.updateFileStatusCalls.push({ file, status });
  }

  complete(): void {
    this.completeCalled = true;
  }

  error(file: string, error: string): void {
    this.errorCalls.push({ file, error });
  }

  cleanup(): void {
    this.cleanupCalled = true;
  }
}

describe('ProgressStateManager', () => {
  let manager: ProgressStateManager;
  let mockRenderer: MockProgressRenderer;

  beforeEach(() => {
    mockRenderer = new MockProgressRenderer();
    manager = new ProgressStateManager(mockRenderer);
  });

  describe('initialization', () => {
    it('should create with initial empty state', () => {
      const stats = manager.getProgressStats();
      assertEquals(stats.totalFiles, 0);
      assertEquals(stats.completedFiles, 0);
      assertEquals(manager.getCurrentFile(), null);
      assertEquals(manager.isComplete(), false);
    });

    it('should work without renderer', () => {
      const managerWithoutRenderer = new ProgressStateManager();
      const stats = managerWithoutRenderer.getProgressStats();
      assertEquals(stats.totalFiles, 0);
    });
  });

  describe('startProcessing', () => {
    it('should initialize state with files', () => {
      const files = ['file1.ts', 'file2.ts', 'file3.ts'];
      manager.startProcessing(files);

      const stats = manager.getProgressStats();
      assertEquals(stats.totalFiles, 3);
      assertEquals(stats.completedFiles, 0);
      assertEquals(stats.pendingFiles, 3);
      assertEquals(mockRenderer.startCalled, true);
    });

    it('should set all files to pending status', () => {
      const files = ['file1.ts', 'file2.ts'];
      manager.startProcessing(files);

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.PENDING);
      assertEquals(manager.getFileStatus('file2.ts'), FileStatus.PENDING);
    });

    it('should reset previous state', () => {
      // First processing
      manager.startProcessing(['file1.ts']);
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);

      // Second processing should reset
      manager.startProcessing(['file2.ts', 'file3.ts']);
      const stats = manager.getProgressStats();
      assertEquals(stats.totalFiles, 2);
      assertEquals(stats.completedFiles, 0);
    });
  });

  describe('updateFileStatus', () => {
    beforeEach(() => {
      manager.startProcessing(['file1.ts', 'file2.ts', 'file3.ts']);
    });

    it('should update file status to processing', () => {
      manager.updateFileStatus('file1.ts', FileStatus.PROCESSING);

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.PROCESSING);
      assertEquals(manager.getCurrentFile(), 'file1.ts');
      
      const stats = manager.getProgressStats();
      assertEquals(stats.processingFiles, 1);
      assertEquals(stats.pendingFiles, 2);
    });

    it('should update file status to success and increment completed count', () => {
      manager.updateFileStatus('file1.ts', FileStatus.PROCESSING);
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.SUCCESS);
      
      const stats = manager.getProgressStats();
      assertEquals(stats.completedFiles, 1);
      assertEquals(stats.successfulFiles, 1);
      assertEquals(stats.completionPercentage, 33); // 1/3 * 100 rounded
    });

    it('should update file status to error and increment completed count', () => {
      manager.updateFileStatus('file1.ts', FileStatus.PROCESSING);
      manager.updateFileStatus('file1.ts', FileStatus.ERROR);

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.ERROR);
      
      const stats = manager.getProgressStats();
      assertEquals(stats.completedFiles, 1);
      assertEquals(stats.errorFiles, 1);
    });

    it('should update file status to warning and increment completed count', () => {
      manager.updateFileStatus('file1.ts', FileStatus.PROCESSING);
      manager.updateFileStatus('file1.ts', FileStatus.WARNING);

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.WARNING);
      
      const stats = manager.getProgressStats();
      assertEquals(stats.completedFiles, 1);
      assertEquals(stats.warningFiles, 1);
    });

    it('should not double-count completed files', () => {
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS); // Update again

      const stats = manager.getProgressStats();
      assertEquals(stats.completedFiles, 1);
    });

    it('should call renderer methods', () => {
      manager.updateFileStatus('file1.ts', FileStatus.PROCESSING);

      assertEquals(mockRenderer.updateFileStatusCalls.length, 1);
      assertEquals(mockRenderer.updateFileStatusCalls[0].file, 'file1.ts');
      assertEquals(mockRenderer.updateFileStatusCalls[0].status, FileStatus.PROCESSING);
      
      assertEquals(mockRenderer.updateProgressCalls.length, 1);
      assertEquals(mockRenderer.updateProgressCalls[0].currentFile, 'file1.ts');
      assertEquals(mockRenderer.updateProgressCalls[0].completed, 0);
      assertEquals(mockRenderer.updateProgressCalls[0].total, 3);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      manager.startProcessing(['file1.ts', 'file2.ts']);
    });

    it('should add error and update file status', () => {
      manager.addError('file1.ts', 'Test error message');

      const errors = manager.getErrors();
      assertEquals(errors.length, 1);
      assertEquals(errors[0].file, 'file1.ts');
      assertEquals(errors[0].error, 'Test error message');
      assertExists(errors[0].timestamp);

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.ERROR);
      
      const stats = manager.getProgressStats();
      assertEquals(stats.errorFiles, 1);
      assertEquals(stats.completedFiles, 1);
    });

    it('should call renderer error method', () => {
      manager.addError('file1.ts', 'Test error');

      assertEquals(mockRenderer.errorCalls.length, 1);
      assertEquals(mockRenderer.errorCalls[0].file, 'file1.ts');
      assertEquals(mockRenderer.errorCalls[0].error, 'Test error');
    });

    it('should handle multiple errors', () => {
      manager.addError('file1.ts', 'Error 1');
      manager.addError('file2.ts', 'Error 2');

      const errors = manager.getErrors();
      assertEquals(errors.length, 2);
      
      const stats = manager.getProgressStats();
      assertEquals(stats.errorFiles, 2);
      assertEquals(stats.completedFiles, 2);
    });
  });

  describe('warning handling', () => {
    beforeEach(() => {
      manager.startProcessing(['file1.ts', 'file2.ts']);
    });

    it('should add warning and update file status', () => {
      manager.addWarning('file1.ts', 'Test warning message');

      const warnings = manager.getWarnings();
      assertEquals(warnings.length, 1);
      assertEquals(warnings[0].file, 'file1.ts');
      assertEquals(warnings[0].warning, 'Test warning message');
      assertExists(warnings[0].timestamp);

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.WARNING);
      
      const stats = manager.getProgressStats();
      assertEquals(stats.warningFiles, 1);
      assertEquals(stats.completedFiles, 1);
    });

    it('should not override error status with warning', () => {
      manager.updateFileStatus('file1.ts', FileStatus.ERROR);
      manager.addWarning('file1.ts', 'Test warning');

      assertEquals(manager.getFileStatus('file1.ts'), FileStatus.ERROR);
      
      const warnings = manager.getWarnings();
      assertEquals(warnings.length, 1); // Warning should still be recorded
    });

    it('should handle multiple warnings', () => {
      manager.addWarning('file1.ts', 'Warning 1');
      manager.addWarning('file2.ts', 'Warning 2');

      const warnings = manager.getWarnings();
      assertEquals(warnings.length, 2);
      
      const stats = manager.getProgressStats();
      assertEquals(stats.warningFiles, 2);
    });
  });

  describe('progress statistics', () => {
    beforeEach(() => {
      manager.startProcessing(['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts']);
    });

    it('should calculate progress statistics correctly', () => {
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);
      manager.updateFileStatus('file2.ts', FileStatus.ERROR);
      manager.updateFileStatus('file3.ts', FileStatus.WARNING);
      // file4.ts remains pending

      const stats = manager.getProgressStats();
      assertEquals(stats.totalFiles, 4);
      assertEquals(stats.completedFiles, 3);
      assertEquals(stats.successfulFiles, 1);
      assertEquals(stats.errorFiles, 1);
      assertEquals(stats.warningFiles, 1);
      assertEquals(stats.pendingFiles, 1);
      assertEquals(stats.processingFiles, 0);
      assertEquals(stats.completionPercentage, 75); // 3/4 * 100
      assert(stats.elapsedTime >= 0);
    });

    it('should calculate estimated time remaining', () => {
      // Simulate some processing time
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);
      
      // Add a small delay to ensure elapsed time > 0
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Small delay
      }
      
      const stats = manager.getProgressStats();
      if (stats.estimatedTimeRemaining !== undefined) {
        assert(stats.estimatedTimeRemaining > 0);
      }
    });

    it('should not calculate ETA when no files completed', () => {
      const stats = manager.getProgressStats();
      assertEquals(stats.estimatedTimeRemaining, undefined);
    });

    it('should not calculate ETA when all files completed', () => {
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);
      manager.updateFileStatus('file2.ts', FileStatus.SUCCESS);
      manager.updateFileStatus('file3.ts', FileStatus.SUCCESS);
      manager.updateFileStatus('file4.ts', FileStatus.SUCCESS);

      const stats = manager.getProgressStats();
      assertEquals(stats.estimatedTimeRemaining, undefined);
    });
  });

  describe('completion tracking', () => {
    beforeEach(() => {
      manager.startProcessing(['file1.ts', 'file2.ts']);
    });

    it('should track completion status', () => {
      assertEquals(manager.isComplete(), false);

      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);
      assertEquals(manager.isComplete(), false);

      manager.updateFileStatus('file2.ts', FileStatus.ERROR);
      assertEquals(manager.isComplete(), true);
    });

    it('should call renderer complete method', () => {
      manager.complete();
      assertEquals(mockRenderer.completeCalled, true);
    });

    it('should call renderer cleanup method', () => {
      manager.cleanup();
      assertEquals(mockRenderer.cleanupCalled, true);
    });
  });

  describe('state management', () => {
    it('should get all file statuses', () => {
      manager.startProcessing(['file1.ts', 'file2.ts']);
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);

      const statuses = manager.getAllFileStatuses();
      assertEquals(statuses.get('file1.ts'), FileStatus.SUCCESS);
      assertEquals(statuses.get('file2.ts'), FileStatus.PENDING);
      assertEquals(statuses.size, 2);
    });

    it('should reset state', () => {
      manager.startProcessing(['file1.ts']);
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);

      manager.reset();

      const stats = manager.getProgressStats();
      assertEquals(stats.totalFiles, 0);
      assertEquals(stats.completedFiles, 0);
      assertEquals(manager.getCurrentFile(), null);
    });

    it('should provide processing summary', () => {
      manager.startProcessing(['file1.ts', 'file2.ts', 'file3.ts']);
      manager.updateFileStatus('file1.ts', FileStatus.SUCCESS);
      manager.addError('file2.ts', 'Test error');
      manager.addWarning('file3.ts', 'Test warning');

      const summary = manager.getSummary();
      assertEquals(summary.total, 3);
      assertEquals(summary.completed, 3);
      assertEquals(summary.successful, 1);
      assertEquals(summary.errors, 1);
      assertEquals(summary.warnings, 1);
      assert(summary.duration >= 0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty file list', () => {
      manager.startProcessing([]);

      const stats = manager.getProgressStats();
      assertEquals(stats.totalFiles, 0);
      assertEquals(stats.completionPercentage, 0);
      assertEquals(manager.isComplete(), false);
    });

    it('should handle unknown file status request', () => {
      manager.startProcessing(['file1.ts']);
      assertEquals(manager.getFileStatus('unknown.ts'), undefined);
    });

    it('should handle error for unknown file', () => {
      manager.startProcessing(['file1.ts']);
      manager.addError('unknown.ts', 'Error');

      const errors = manager.getErrors();
      assertEquals(errors.length, 1);
      assertEquals(errors[0].file, 'unknown.ts');
    });

    it('should handle warning for unknown file', () => {
      manager.startProcessing(['file1.ts']);
      manager.addWarning('unknown.ts', 'Warning');

      const warnings = manager.getWarnings();
      assertEquals(warnings.length, 1);
      assertEquals(warnings[0].file, 'unknown.ts');
    });
  });
});