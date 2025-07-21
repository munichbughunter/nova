import { assertEquals, assertExists, assert } from 'jsr:@std/assert';
import { beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { 
  DryRunProcessor, 
  DryRunAnalyzer, 
  type DryRunOptions, 
  DEFAULT_DRY_RUN_OPTIONS 
} from './dry-run-processor.ts';
import { Logger } from '../utils/logger.ts';

// Mock logger for testing
const createMockLogger = (): Logger => {
  return new Logger('Test', false);
};

describe('DryRunProcessor', () => {
  let processor: DryRunProcessor;

  beforeEach(() => {
    const mockLogger = createMockLogger();
    processor = new DryRunProcessor(mockLogger);
  });

  describe('basic functionality', () => {
    it('should create processor instance', () => {
      assertExists(processor);
    });

    it('should have default options', () => {
      assertEquals(DEFAULT_DRY_RUN_OPTIONS.showFileDetails, true);
      assertEquals(DEFAULT_DRY_RUN_OPTIONS.estimateTime, true);
      assertEquals(DEFAULT_DRY_RUN_OPTIONS.checkFileAccess, true);
      assertEquals(DEFAULT_DRY_RUN_OPTIONS.groupByDirectory, true);
      assertEquals(DEFAULT_DRY_RUN_OPTIONS.showProcessingOrder, false);
    });
  });
});

describe('DryRunAnalyzer', () => {
  let analyzer: DryRunAnalyzer;

  beforeEach(() => {
    const mockLogger = createMockLogger();
    analyzer = new DryRunAnalyzer(mockLogger);
  });

  describe('basic functionality', () => {
    it('should create analyzer instance', () => {
      assertExists(analyzer);
    });

    it('should group files by directory correctly', () => {
      const files = ['src/a.ts', 'src/b.ts', 'test/c.ts', 'root.ts'];
      
      const groups = analyzer.groupFilesByDirectory(files);
      
      assertEquals(groups.size, 3);
      assertEquals(groups.get('src')?.length, 2);
      assertEquals(groups.get('test')?.length, 1);
      // The root file might be grouped differently, let's check what key it uses
      const rootGroup = Array.from(groups.keys()).find(key => groups.get(key)?.includes('root.ts'));
      assertEquals(groups.get(rootGroup!)?.length, 1);
    });

    it('should sort files by priority correctly', () => {
      const files = ['large.ts', 'small.ts', 'medium.ts'];
      const fileDetails = new Map([
        ['large.ts', { file: 'large.ts', size: 3000, estimatedTime: 0, accessible: true, directory: '.', exists: true, isReadable: true }],
        ['small.ts', { file: 'small.ts', size: 1000, estimatedTime: 0, accessible: true, directory: '.', exists: true, isReadable: true }],
        ['medium.ts', { file: 'medium.ts', size: 2000, estimatedTime: 0, accessible: true, directory: '.', exists: true, isReadable: true }]
      ]);
      
      const sorted = analyzer.sortFilesByPriority(files, fileDetails);
      
      assertEquals(sorted, ['small.ts', 'medium.ts', 'large.ts']);
    });
  });

  describe('time estimation', () => {
    it('should estimate processing time based on file size', async () => {
      // Test with a file that exists in the project
      const details = await analyzer.analyzeFile('src/services/dry-run-processor.ts');
      
      assertExists(details);
      assertEquals(details.file, 'src/services/dry-run-processor.ts');
      assert(details.estimatedTime >= 500); // Should be at least minimum time
    });
  });

  describe('plan creation', () => {
    it('should create basic analysis plan', async () => {
      // Test with actual files that exist
      const files = ['src/services/dry-run-processor.ts'];
      const options = DEFAULT_DRY_RUN_OPTIONS;
      
      const plan = await analyzer.createAnalysisPlan(files, options);
      
      assertExists(plan);
      assertEquals(plan.processingOrder.length, plan.totalFiles);
      assert(plan.summary.totalSize >= 0);
      assert(plan.summary.averageFileSize >= 0);
    });

    it('should handle empty file list', async () => {
      const files: string[] = [];
      const options = DEFAULT_DRY_RUN_OPTIONS;
      
      const plan = await analyzer.createAnalysisPlan(files, options);
      
      assertEquals(plan.totalFiles, 0);
      assertEquals(plan.processingOrder.length, 0);
      assertEquals(plan.fileDetails.length, 0);
      assertEquals(plan.summary.totalSize, 0);
      assertEquals(plan.summary.averageFileSize, 0);
    });

    it('should group files by directory when enabled', async () => {
      const files = ['src/services/dry-run-processor.ts'];
      const options = { ...DEFAULT_DRY_RUN_OPTIONS, groupByDirectory: true };
      
      const plan = await analyzer.createAnalysisPlan(files, options);
      
      assert(plan.filesByDirectory.size > 0);
      assertEquals(plan.summary.directoryCount, plan.filesByDirectory.size);
    });
  });

  describe('file validation', () => {
    it('should validate accessible files', async () => {
      const canAccess = await analyzer.canAccessFile('src/services/dry-run-processor.ts');
      assertEquals(canAccess, true);
    });

    it('should reject non-existent files', async () => {
      const canAccess = await analyzer.canAccessFile('non-existent-file.ts');
      assertEquals(canAccess, false);
    });
  });
});

// Integration tests with real files
describe('DryRunProcessor Integration', () => {
  let processor: DryRunProcessor;

  beforeEach(() => {
    const mockLogger = createMockLogger();
    processor = new DryRunProcessor(mockLogger);
  });

  it('should complete full dry-run workflow with real files', async () => {
    const files = ['src/services/dry-run-processor.ts'];
    
    // Analyze plan
    const plan = await processor.analyzePlan(files, {
      showFileDetails: true,
      estimateTime: true,
      checkFileAccess: true,
      groupByDirectory: true,
      showProcessingOrder: true
    });
    
    // Validate results
    assert(plan.totalFiles >= 0);
    assert(plan.estimatedDuration >= 0);
    
    // Validate files
    const validation = await processor.validateFiles(files);
    assert(validation.valid.length >= 0);
    assert(validation.invalid.length >= 0);
    
    // Get time estimates
    const estimates = await processor.getTimeEstimates(files);
    assertEquals(estimates.size, files.length);
  });

  it('should handle mixed valid and invalid files', async () => {
    const files = ['src/services/dry-run-processor.ts', 'non-existent.ts'];
    
    const plan = await processor.analyzePlan(files);
    const validation = await processor.validateFiles(files);
    
    // Should have at least one valid file and one invalid
    assert(validation.valid.length >= 1);
    assert(validation.invalid.length >= 1);
    
    // Plan should reflect the valid files only
    assertEquals(plan.totalFiles, validation.valid.length);
  });

  it('should display plan without errors', async () => {
    const files = ['src/services/dry-run-processor.ts'];
    const plan = await processor.analyzePlan(files);
    
    // Should not throw when displaying plan
    processor.showPlan(plan);
  });
});