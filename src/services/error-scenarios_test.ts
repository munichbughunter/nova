/**
 * Comprehensive error scenario testing for all failure modes
 * Tests system resilience and error recovery capabilities
 */

import { assertEquals, assertInstanceOf, assertRejects, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { z } from 'zod';
import { Logger } from '../../utils/logger.ts';
import { ErrorHandlingService } from './error-handling/error-handler.service.ts';
import { ValidationService } from './analysis/validation/validation.service.ts';
import { LLMResponseProcessor } from './llm/llm-response-processor.ts';

describe('Error Scenario Testing', () => {
  let logger: Logger;
  let errorService: ErrorHandlingService;
  let validationService: ValidationService;
  let responseProcessor: LLMResponseProcessor;

  beforeEach(() => {
    logger = new Logger('test');
    errorService = new ErrorHandlingService(logger);
    validationService = new ValidationService(logger);
    responseProcessor = new LLMResponseProcessor(logger);
  });

  afterEach(() => {
    restore();
  });

  describe('Network and API Failures', () => {
    it('should handle connection timeout errors', async () => {
      const timeoutError = new Error('ETIMEDOUT: connection timed out');
      
      const context = {
        operation: 'llm_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleLLMError(timeoutError, context);

      assertEquals(resolution.strategy, 'retry');
      assert(resolution.retryAfter && resolution.retryAfter > 0);
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle connection refused errors', async () => {
      const connectionError = new Error('ECONNREFUSED: connection refused');
      
      const context = {
        operation: 'api_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleAPIError(connectionError, context);

      assertEquals(resolution.strategy, 'retry');
      assert(resolution.retryAfter && resolution.retryAfter > 0);
    });

    it('should handle DNS resolution failures', async () => {
      const dnsError = new Error('ENOTFOUND: getaddrinfo failed');
      
      const context = {
        operation: 'api_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleAPIError(dnsError, context);

      assertEquals(resolution.strategy, 'retry');
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle rate limiting (429) errors', async () => {
      const rateLimitError = new Error('429 Too Many Requests');
      
      const context = {
        operation: 'llm_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleLLMError(rateLimitError, context);

      assertEquals(resolution.strategy, 'retry');
      assert(resolution.retryAfter && resolution.retryAfter >= 1000); // Should have longer delay
    });

    it('should handle service unavailable (503) errors', async () => {
      const serviceError = new Error('503 Service Unavailable');
      
      const context = {
        operation: 'api_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleAPIError(serviceError, context);

      assertEquals(resolution.strategy, 'retry');
      assert(resolution.retryAfter && resolution.retryAfter > 0);
    });

    it('should not retry authentication errors (401)', async () => {
      const authError = new Error('401 Unauthorized');
      
      const context = {
        operation: 'api_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleAPIError(authError, context);

      assertEquals(resolution.strategy, 'fail');
      assertEquals(resolution.retryAfter, undefined);
    });

    it('should not retry permission errors (403)', async () => {
      const permError = new Error('403 Forbidden');
      
      const context = {
        operation: 'api_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleAPIError(permError, context);

      assertEquals(resolution.strategy, 'fail');
      assertEquals(resolution.retryAfter, undefined);
    });

    it('should not retry client errors (400)', async () => {
      const clientError = new Error('400 Bad Request');
      
      const context = {
        operation: 'api_request',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleAPIError(clientError, context);

      assertEquals(resolution.strategy, 'fail');
      assertEquals(resolution.retryAfter, undefined);
    });
  });

  describe('LLM Response Failures', () => {
    it('should handle malformed JSON responses', async () => {
      const malformedJson = '{ "grade": "A", "coverage": 85, "testsPresent": true, invalid json }';
      
      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
      });

      const result = await responseProcessor.processResponse(malformedJson, schema);

      assertEquals(result.success, false);
      assertEquals(result.fallbackUsed, true);
      assert(result.errors.length > 0);
    });

    it('should handle incomplete JSON responses', async () => {
      const incompleteJson = '{ "grade": "A", "coverage": 85';
      
      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
      });

      const result = await responseProcessor.processResponse(incompleteJson, schema);

      assertEquals(result.success, false);
      assertEquals(result.fallbackUsed, true);
    });

    it('should handle empty responses', async () => {
      const emptyResponse = '';
      
      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
      });

      const result = await responseProcessor.processResponse(emptyResponse, schema);

      assertEquals(result.success, false);
      assertEquals(result.fallbackUsed, true);
    });

    it('should handle non-JSON responses', async () => {
      const textResponse = 'This is just plain text, not JSON';
      
      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
      });

      const result = await responseProcessor.processResponse(textResponse, schema);

      assertEquals(result.success, false);
      assertEquals(result.fallbackUsed, true);
    });

    it('should handle responses with wrong structure', async () => {
      const wrongStructure = JSON.stringify({
        completely: 'different',
        structure: 'than expected',
        data: [1, 2, 3],
      });
      
      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
      });

      const result = await responseProcessor.processResponse(wrongStructure, schema);

      assertEquals(result.success, false);
      assertEquals(result.fallbackUsed, true);
    });

    it('should handle responses with null values', async () => {
      const nullResponse = JSON.stringify({
        grade: null,
        coverage: null,
        testsPresent: null,
      });
      
      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
      });

      const result = await responseProcessor.processResponse(nullResponse, schema);

      // Should attempt transformation and fallback
      assertEquals(result.success, false);
      assertEquals(result.fallbackUsed, true);
    });
  });

  describe('Validation Failures', () => {
    it('should handle type mismatch errors', async () => {
      const invalidData = {
        grade: 123, // Should be string
        coverage: 'not-a-number', // Should be number
        testsPresent: 'maybe', // Should be boolean
      };

      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
      });

      const result = await validationService.validateWithTransformation(invalidData, schema);

      assertEquals(result.success, false);
      assert(result.errors.length > 0);
      assert(result.transformationsApplied.length > 0); // Should attempt transformations
    });

    it('should handle missing required fields', async () => {
      const incompleteData = {
        grade: 'A',
        // Missing coverage and testsPresent
      };

      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
      });

      const result = await validationService.validateWithTransformation(incompleteData, schema);

      assertEquals(result.success, false);
      assert(result.errors.length > 0);
    });

    it('should handle array validation failures', async () => {
      const invalidArrayData = {
        grade: 'A',
        coverage: 85,
        testsPresent: true,
        issues: 'not-an-array', // Should be array
      };

      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
        issues: z.array(z.string()),
      });

      const result = await validationService.validateWithTransformation(invalidArrayData, schema);

      assertEquals(result.success, false);
      assert(result.errors.length > 0);
    });

    it('should handle nested object validation failures', async () => {
      const invalidNestedData = {
        grade: 'A',
        coverage: 85,
        testsPresent: true,
        details: {
          author: 123, // Should be string
          timestamp: 'invalid-date', // Should be valid date
        },
      };

      const schema = z.object({
        grade: z.string(),
        coverage: z.number(),
        testsPresent: z.boolean(),
        details: z.object({
          author: z.string(),
          timestamp: z.string().datetime(),
        }),
      });

      const result = await validationService.validateWithTransformation(invalidNestedData, schema);

      assertEquals(result.success, false);
      assert(result.errors.length > 0);
    });

    it('should handle enum validation failures', async () => {
      const invalidEnumData = {
        grade: 'Z', // Invalid grade
        coverage: 85,
        testsPresent: true,
        state: 'unknown', // Invalid state
      };

      const schema = z.object({
        grade: z.enum(['A', 'B', 'C', 'D', 'F']),
        coverage: z.number(),
        testsPresent: z.boolean(),
        state: z.enum(['pass', 'warning', 'fail']),
      });

      const result = await validationService.validateWithTransformation(invalidEnumData, schema);

      assertEquals(result.success, false);
      assert(result.errors.length > 0);
    });
  });

  describe('File System Failures', () => {
    it('should handle file not found errors', async () => {
      const fileError = new Error('ENOENT: no such file or directory');
      
      const context = {
        operation: 'read_file',
        filePath: '/nonexistent/file.ts',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(fileError, context);

      assertEquals(resolution.strategy, 'fallback');
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle permission denied errors', async () => {
      const permError = new Error('EACCES: permission denied');
      
      const context = {
        operation: 'read_file',
        filePath: '/restricted/file.ts',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(permError, context);

      assertEquals(resolution.strategy, 'fail');
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle disk space errors', async () => {
      const diskError = new Error('ENOSPC: no space left on device');
      
      const context = {
        operation: 'write_cache',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(diskError, context);

      assertEquals(resolution.strategy, 'fail');
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle file too large errors', async () => {
      const sizeError = new Error('File too large');
      
      const context = {
        operation: 'read_file',
        filePath: '/huge/file.ts',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(sizeError, context);

      assertEquals(resolution.strategy, 'fallback');
      assertEquals(resolution.shouldLog, true);
    });
  });

  describe('Memory and Resource Failures', () => {
    it('should handle out of memory errors', async () => {
      const memoryError = new Error('JavaScript heap out of memory');
      
      const context = {
        operation: 'process_large_file',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(memoryError, context);

      assertEquals(resolution.strategy, 'fallback');
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle stack overflow errors', async () => {
      const stackError = new Error('Maximum call stack size exceeded');
      
      const context = {
        operation: 'recursive_analysis',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(stackError, context);

      assertEquals(resolution.strategy, 'fallback');
      assertEquals(resolution.shouldLog, true);
    });
  });

  describe('Concurrent Access Failures', () => {
    it('should handle file lock errors', async () => {
      const lockError = new Error('EBUSY: resource busy or locked');
      
      const context = {
        operation: 'write_cache',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(lockError, context);

      assertEquals(resolution.strategy, 'retry');
      assert(resolution.retryAfter && resolution.retryAfter > 0);
    });

    it('should handle concurrent modification errors', async () => {
      const concurrentError = new Error('File modified during processing');
      
      const context = {
        operation: 'analyze_file',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(concurrentError, context);

      assertEquals(resolution.strategy, 'retry');
      assertEquals(resolution.shouldLog, true);
    });
  });

  describe('Configuration and Setup Failures', () => {
    it('should handle missing configuration errors', async () => {
      const configError = new Error('Configuration file not found');
      
      const context = {
        operation: 'load_config',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(configError, context);

      assertEquals(resolution.strategy, 'fallback');
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle invalid configuration errors', async () => {
      const invalidConfigError = new Error('Invalid configuration format');
      
      const context = {
        operation: 'parse_config',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(invalidConfigError, context);

      assertEquals(resolution.strategy, 'fallback');
      assertEquals(resolution.shouldLog, true);
    });

    it('should handle missing dependencies errors', async () => {
      const depError = new Error('Module not found: missing-dependency');
      
      const context = {
        operation: 'load_module',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const resolution = await errorService.handleValidationError(depError, context);

      assertEquals(resolution.strategy, 'fail');
      assertEquals(resolution.shouldLog, true);
    });
  });

  describe('Complex Error Scenarios', () => {
    it('should handle cascading failures', async () => {
      // Simulate a scenario where multiple systems fail in sequence
      const errors = [
        new Error('Primary LLM service failed'),
        new Error('Backup LLM service failed'),
        new Error('Cache service failed'),
        new Error('File system error'),
      ];

      const context = {
        operation: 'complex_analysis',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      let finalResolution;
      for (const error of errors) {
        finalResolution = await errorService.handleLLMError(error, {
          ...context,
          attemptNumber: context.attemptNumber++,
        });
      }

      // Should eventually fall back to a working solution
      assert(finalResolution);
      assert(['fallback', 'fail'].includes(finalResolution.strategy));
    });

    it('should handle intermittent failures with retry logic', async () => {
      let attempts = 0;
      const intermittentError = () => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve('Success');
      };

      const context = {
        operation: 'intermittent_operation',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const result = await errorService.executeWithErrorHandling(
        intermittentError,
        context,
        { enableRetry: true, maxAttempts: 5 }
      );

      assertEquals(result, 'Success');
      assertEquals(attempts, 3);
    });

    it('should handle timeout scenarios', async () => {
      const slowOperation = () => new Promise((resolve) => {
        setTimeout(() => resolve('Too slow'), 10000); // 10 seconds
      });

      const context = {
        operation: 'slow_operation',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      const startTime = Date.now();
      
      await assertRejects(
        () => errorService.executeWithErrorHandling(
          slowOperation,
          context,
          { maxAttempts: 1 } // Single attempt to simulate timeout
        ),
        Error
      );

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should timeout within reasonable time
      assert(duration < 2000, 'Should timeout quickly');
    });
  });

  describe('Error Recovery Metrics', () => {
    it('should track error recovery success rates', async () => {
      // Generate various types of errors
      const errors = [
        new Error('Network timeout'),
        new Error('Validation failed'),
        new Error('File not found'),
        new Error('Service unavailable'),
      ];

      const context = {
        operation: 'test_operation',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      for (const error of errors) {
        await errorService.handleValidationError(error, context);
      }

      const metrics = errorService.getErrorMetrics();

      assertEquals(metrics.totalErrors, 4);
      assert(metrics.errorRecoveryRate >= 0);
      assert(metrics.errorRecoveryRate <= 1);
      assert(metrics.errorsByType);
    });

    it('should track retry attempt statistics', async () => {
      const retryableError = new Error('ETIMEDOUT');
      
      const context = {
        operation: 'retryable_operation',
        attemptNumber: 1,
        timestamp: new Date(),
      };

      await errorService.handleLLMError(retryableError, context);
      await errorService.handleLLMError(retryableError, { ...context, attemptNumber: 2 });
      await errorService.handleLLMError(retryableError, { ...context, attemptNumber: 3 });

      const metrics = errorService.getErrorMetrics();

      assert(metrics.retryAttempts >= 3);
      assert(metrics.retryAttempts > 0);
    });
  });
});