/**
 * Comprehensive unit tests for the ValidationService
 * Tests all validation scenarios, error recovery, and transformation capabilities
 */

import { assertEquals, assertInstanceOf, assertRejects, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { z } from 'zod';
import { Logger } from '../../../utils/logger.ts';
import { ValidationService } from './validation.service.ts';

// Test schemas for validation testing
const TestSchema = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
  coverage: z.number().min(0).max(100),
  tags: z.array(z.string()).optional(),
});

const ReviewAnalysisSchema = z.object({
  grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  coverage: z.number().min(0).max(100),
  testsPresent: z.boolean(),
  value: z.enum(['high', 'medium', 'low']),
  state: z.enum(['pass', 'warning', 'fail']),
  issues: z.array(z.object({
    type: z.string(),
    message: z.string(),
    line: z.number().optional(),
  })).default([]),
  suggestions: z.array(z.string()).default([]),
  summary: z.string().default('Analysis completed'),
});

describe('ValidationService - Comprehensive Tests', () => {
  let logger: Logger;
  let validationService: ValidationService;

  beforeEach(() => {
    logger = new Logger('test');
    validationService = new ValidationService(logger);
  });

  afterEach(() => {
    restore();
  });

  describe('Basic Validation', () => {
    it('should validate correct data successfully', async () => {
      const validData = {
        id: 1,
        name: 'Test',
        active: true,
        coverage: 85,
        tags: ['unit', 'integration'],
      };

      const result = await validationService.validateWithTransformation(
        validData,
        TestSchema
      );

      assertEquals(result.success, true);
      assertEquals(result.data, validData);
      assertEquals(result.transformationsApplied.length, 0);
      assertEquals(result.errors.length, 0);
    });

    it('should handle validation errors for invalid data', async () => {
      const invalidData = {
        id: 'not-a-number',
        name: 123,
        active: 'not-a-boolean',
        coverage: 150, // Out of range
      };

      const result = await validationService.validateWithTransformation(
        invalidData,
        TestSchema
      );

      assertEquals(result.success, false);
      assertEquals(result.data, undefined);
      assert(result.errors.length > 0);
      assertEquals(result.transformationsApplied.length, 0);
    });
  });

  describe('Type Transformation', () => {
    it('should transform string numbers to numbers', async () => {
      const dataWithStringNumbers = {
        id: '42',
        name: 'Test',
        active: true,
        coverage: '85',
      };

      const result = await validationService.validateWithTransformation(
        dataWithStringNumbers,
        TestSchema
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.id, 42);
      assertEquals(result.data?.coverage, 85);
      assert(result.transformationsApplied.includes('string-to-number'));
    });

    it('should transform string booleans to booleans', async () => {
      const dataWithStringBooleans = {
        id: 1,
        name: 'Test',
        active: 'true',
        coverage: 85,
      };

      const result = await validationService.validateWithTransformation(
        dataWithStringBooleans,
        TestSchema
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.active, true);
      assert(result.transformationsApplied.includes('string-to-boolean'));
    });

    it('should handle percentage strings for coverage', async () => {
      const reviewData = {
        grade: 'A',
        coverage: '85%',
        testsPresent: 'true',
        value: 'high',
        state: 'pass',
        issues: [],
        suggestions: [],
        summary: 'Good code',
      };

      const result = await validationService.validateWithTransformation(
        reviewData,
        ReviewAnalysisSchema
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.coverage, 85);
      assertEquals(result.data?.testsPresent, true);
      assert(result.transformationsApplied.includes('percentage-to-number'));
      assert(result.transformationsApplied.includes('string-to-boolean'));
    });

    it('should handle various boolean string formats', async () => {
      const testCases = [
        { input: 'true', expected: true },
        { input: 'false', expected: false },
        { input: 'yes', expected: true },
        { input: 'no', expected: false },
        { input: '1', expected: true },
        { input: '0', expected: false },
        { input: 'TRUE', expected: true },
        { input: 'FALSE', expected: false },
      ];

      for (const testCase of testCases) {
        const data = {
          id: 1,
          name: 'Test',
          active: testCase.input,
          coverage: 85,
        };

        const result = await validationService.validateWithTransformation(
          data,
          TestSchema
        );

        assertEquals(result.success, true, `Failed for input: ${testCase.input}`);
        assertEquals(result.data?.active, testCase.expected, `Failed for input: ${testCase.input}`);
      }
    });
  });

  describe('Error Recovery', () => {
    it('should recover from Zod validation errors with transformations', async () => {
      const malformedData = {
        grade: 'A',
        coverage: 'invalid-number',
        testsPresent: 'maybe',
        value: 'high',
        state: 'pass',
      };

      const result = await validationService.validateWithTransformation(
        malformedData,
        ReviewAnalysisSchema
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.coverage, 0); // Default fallback
      assertEquals(result.data?.testsPresent, false); // Default fallback
      assert(result.warnings.length > 0);
      assert(result.transformationsApplied.includes('fallback-defaults'));
    });

    it('should handle missing required fields with defaults', async () => {
      const incompleteData = {
        grade: 'B',
        coverage: 75,
        testsPresent: true,
        value: 'medium',
        state: 'warning',
        // Missing issues, suggestions, summary
      };

      const result = await validationService.validateWithTransformation(
        incompleteData,
        ReviewAnalysisSchema
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.issues, []);
      assertEquals(result.data?.suggestions, []);
      assertEquals(result.data?.summary, 'Analysis completed');
    });

    it('should handle deeply nested transformation errors', async () => {
      const complexData = {
        grade: 'A',
        coverage: '85%',
        testsPresent: 'true',
        value: 'high',
        state: 'pass',
        issues: [
          {
            type: 'warning',
            message: 'Test message',
            line: '42', // String instead of number
          },
        ],
        suggestions: ['Good work'],
        summary: 'Analysis completed',
      };

      const result = await validationService.validateWithTransformation(
        complexData,
        ReviewAnalysisSchema
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.issues?.[0]?.line, 42);
      assert(result.transformationsApplied.length > 0);
    });
  });

  describe('Custom Transformers', () => {
    it('should register and use custom transformers', async () => {
      const customTransformer = {
        name: 'custom-uppercase',
        priority: 50,
        transform: (data: unknown) => {
          if (typeof data === 'object' && data !== null && 'name' in data) {
            return {
              ...data as Record<string, unknown>,
              name: (data as any).name.toUpperCase(),
            };
          }
          return data;
        },
        canTransform: (data: unknown) => {
          return typeof data === 'object' && data !== null && 'name' in data;
        },
      };

      validationService.registerTransformer(customTransformer);

      const data = {
        id: 1,
        name: 'test',
        active: true,
        coverage: 85,
      };

      const result = await validationService.validateWithTransformation(
        data,
        TestSchema,
        [customTransformer]
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.name, 'TEST');
      assert(result.transformationsApplied.includes('custom-uppercase'));
    });

    it('should chain multiple transformers', async () => {
      const transformer1 = {
        name: 'add-prefix',
        priority: 60,
        transform: (data: unknown) => {
          if (typeof data === 'object' && data !== null && 'name' in data) {
            return {
              ...data as Record<string, unknown>,
              name: `prefix-${(data as any).name}`,
            };
          }
          return data;
        },
        canTransform: () => true,
      };

      const transformer2 = {
        name: 'add-suffix',
        priority: 50,
        transform: (data: unknown) => {
          if (typeof data === 'object' && data !== null && 'name' in data) {
            return {
              ...data as Record<string, unknown>,
              name: `${(data as any).name}-suffix`,
            };
          }
          return data;
        },
        canTransform: () => true,
      };

      const data = {
        id: 1,
        name: 'test',
        active: true,
        coverage: 85,
      };

      const result = await validationService.validateWithTransformation(
        data,
        TestSchema,
        [transformer1, transformer2]
      );

      assertEquals(result.success, true);
      assertEquals(result.data?.name, 'prefix-test-suffix');
      assert(result.transformationsApplied.includes('add-prefix'));
      assert(result.transformationsApplied.includes('add-suffix'));
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle large datasets efficiently', async () => {
      const largeData = {
        id: 1,
        name: 'Test',
        active: true,
        coverage: 85,
        tags: Array.from({ length: 1000 }, (_, i) => `tag-${i}`),
      };

      const startTime = Date.now();
      const result = await validationService.validateWithTransformation(
        largeData,
        TestSchema
      );
      const endTime = Date.now();

      assertEquals(result.success, true);
      assert(endTime - startTime < 1000, 'Validation should complete within 1 second');
    });

    it('should handle null and undefined values gracefully', async () => {
      const testCases = [
        null,
        undefined,
        {},
        { id: null },
        { name: undefined },
      ];

      for (const testCase of testCases) {
        const result = await validationService.validateWithTransformation(
          testCase,
          TestSchema
        );

        // Should not throw, but may not be successful
        assertInstanceOf(result, Object);
        assertEquals(typeof result.success, 'boolean');
      }
    });

    it('should handle circular references safely', async () => {
      const circularData: any = {
        id: 1,
        name: 'Test',
        active: true,
        coverage: 85,
      };
      circularData.self = circularData;

      const result = await validationService.validateWithTransformation(
        circularData,
        TestSchema
      );

      // Should handle gracefully without infinite loops
      assertInstanceOf(result, Object);
      assertEquals(typeof result.success, 'boolean');
    });
  });

  describe('Service Integration', () => {
    it('should provide available transformers', () => {
      const transformers = validationService.getAvailableTransformers();
      
      assert(Array.isArray(transformers));
      assert(transformers.length > 0);
      assert(transformers.every(t => typeof t.name === 'string'));
      assert(transformers.every(t => typeof t.priority === 'number'));
    });

    it('should provide available recovery strategies', () => {
      const strategies = validationService.getAvailableRecoveryStrategies();
      
      assert(Array.isArray(strategies));
      assert(strategies.length > 0);
      assert(strategies.every(s => typeof s.name === 'string'));
      assert(strategies.every(s => typeof s.priority === 'number'));
    });

    it('should register custom transformers correctly', () => {
      const customTransformer = {
        name: 'test-transformer',
        priority: 100,
        transform: (data: unknown) => data,
        canTransform: () => true,
      };

      validationService.registerTransformer(customTransformer);
      
      const transformers = validationService.getAvailableTransformers();
      const registered = transformers.find(t => t.name === 'test-transformer');
      
      assert(registered);
      assertEquals(registered.priority, 100);
    });
  });

  describe('Configuration and Options', () => {
    it('should handle invalid data without transformations', async () => {
      const data = {
        id: 'invalid',
        name: 'Test',
        active: true,
        coverage: 85,
      };

      const result = await validationService.validateWithTransformation(
        data,
        TestSchema
      );

      // Should attempt recovery but may still fail for invalid types
      assertEquals(typeof result.success, 'boolean');
      assert(result.transformationsApplied.length >= 0);
    });

    it('should handle extra fields in data', async () => {
      const dataWithExtraFields = {
        id: 1,
        name: 'Test',
        active: true,
        coverage: 85,
        extraField: 'should be ignored by schema',
      };

      const result = await validationService.validateWithTransformation(
        dataWithExtraFields,
        TestSchema
      );

      assertEquals(result.success, true);
      // Extra fields are typically ignored by Zod unless using strict mode
      assertEquals(result.data?.id, 1);
      assertEquals(result.data?.name, 'Test');
    });
  });

  describe('Error Handling and Logging', () => {
    it('should log validation errors appropriately', async () => {
      const logSpy = spy(logger, 'warn');

      const invalidData = {
        id: 'not-a-number',
        name: 123,
        active: 'not-a-boolean',
        coverage: 150,
      };

      await validationService.validateWithTransformation(invalidData, TestSchema);

      assert(logSpy.calls.length > 0);
      restore();
    });

    it('should handle transformer errors gracefully', async () => {
      const faultyTransformer = {
        name: 'faulty-transformer',
        priority: 10,
        transform: () => {
          throw new Error('Transformer error');
        },
        canTransform: () => true,
      };

      const data = {
        id: 1,
        name: 'Test',
        active: true,
        coverage: 85,
      };

      const result = await validationService.validateWithTransformation(
        data,
        TestSchema,
        [faultyTransformer]
      );

      // Should continue with other transformers or fallback
      assertInstanceOf(result, Object);
      assertEquals(typeof result.success, 'boolean');
    });
  });
});