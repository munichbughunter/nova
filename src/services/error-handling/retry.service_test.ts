/**
 * Unit tests for the RetryService
 */

import { assertEquals, assertInstanceOf, assertRejects, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { Logger } from '../../utils/logger.ts';
import { RetryService, createRetryService } from './retry.service.ts';
import { RetryConfig, ErrorContext } from './types.ts';

describe('RetryService', () => {
    let logger: Logger;
    let retryService: RetryService;

    beforeEach(() => {
        logger = new Logger('test');
        retryService = new RetryService(logger);
    });

    afterEach(() => {
        restore();
    });

    describe('constructor', () => {
        it('should create service with default configuration', () => {
            const service = new RetryService(logger);
            assertInstanceOf(service, RetryService);
        });

        it('should create service with custom configuration', () => {
            const config: Partial<RetryConfig> = {
                maxAttempts: 5,
                baseDelayMs: 2000,
                maxDelayMs: 60000,
            };
            
            const service = new RetryService(logger, config);
            assertInstanceOf(service, RetryService);
        });
    });

    describe('executeWithRetry', () => {
        it('should succeed on first attempt', async () => {
            const operation = spy(() => Promise.resolve('success'));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const result = await retryService.executeWithRetry(operation, context);

            assertEquals(result, 'success');
            assertEquals(operation.calls.length, 1);
        });

        it('should retry on failure and eventually succeed', async () => {
            let attempts = 0;
            const operation = spy(() => {
                attempts++;
                if (attempts < 3) {
                    return Promise.reject(new Error('Network timeout'));
                }
                return Promise.resolve('success');
            });

            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const result = await retryService.executeWithRetry(operation, context);

            assertEquals(result, 'success');
            assertEquals(operation.calls.length, 3);
        });

        it('should fail after max attempts', async () => {
            const operation = spy(() => Promise.reject(new Error('Persistent network error')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await assertRejects(
                () => retryService.executeWithRetry(operation, context),
                Error,
                'Persistent network error'
            );

            // Should try the default number of times (3)
            assertEquals(operation.calls.length, 3);
        });

        it('should not retry non-retryable errors', async () => {
            const operation = spy(() => Promise.reject(new Error('401 Unauthorized')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await assertRejects(
                () => retryService.executeWithRetry(operation, context),
                Error,
                '401 Unauthorized'
            );

            assertEquals(operation.calls.length, 1);
        });

        it('should use custom retry config', async () => {
            const operation = spy(() => Promise.reject(new Error('Network error')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const customConfig: Partial<RetryConfig> = {
                maxAttempts: 2,
                baseDelayMs: 100,
                jitterMs: 0,
            };

            await assertRejects(
                () => retryService.executeWithRetry(operation, context, customConfig),
                Error
            );

            assertEquals(operation.calls.length, 2);
        });

        it('should add delay between retries', async () => {
            const startTime = Date.now();
            const operation = spy(() => Promise.reject(new Error('Network error')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const customConfig: Partial<RetryConfig> = {
                maxAttempts: 2,
                baseDelayMs: 100,
                jitterMs: 0,
            };

            await assertRejects(
                () => retryService.executeWithRetry(operation, context, customConfig),
                Error
            );

            const endTime = Date.now();
            const elapsed = endTime - startTime;

            // Should have at least one delay of ~100ms
            assert(elapsed >= 100);
        });

        it('should calculate exponential backoff correctly', async () => {
            const delays: number[] = [];
            const originalSleep = (retryService as any).sleep;
            
            // Mock sleep to capture delays
            (retryService as any).sleep = spy((ms: number) => {
                delays.push(ms);
                return Promise.resolve();
            });

            const operation = spy(() => Promise.reject(new Error('Network error')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const customConfig: Partial<RetryConfig> = {
                maxAttempts: 3,
                baseDelayMs: 1000,
                backoffMultiplier: 2,
                jitterMs: 0,
            };

            await assertRejects(
                () => retryService.executeWithRetry(operation, context, customConfig),
                Error
            );

            // Should have 2 delays (between 3 attempts)
            assertEquals(delays.length, 2);
            assertEquals(delays[0], 1000); // First retry: 1000ms
            assertEquals(delays[1], 2000); // Second retry: 2000ms

            // Restore original sleep
            (retryService as any).sleep = originalSleep;
        });

        it('should respect max delay limit', async () => {
            const delays: number[] = [];
            const originalSleep = (retryService as any).sleep;
            
            // Mock sleep to capture delays
            (retryService as any).sleep = spy((ms: number) => {
                delays.push(ms);
                return Promise.resolve();
            });

            const operation = spy(() => Promise.reject(new Error('Network error')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const customConfig: Partial<RetryConfig> = {
                maxAttempts: 4,
                baseDelayMs: 1000,
                backoffMultiplier: 3,
                maxDelayMs: 5000,
                jitterMs: 0,
            };

            await assertRejects(
                () => retryService.executeWithRetry(operation, context, customConfig),
                Error
            );

            // Should have 3 delays
            assertEquals(delays.length, 3);
            assertEquals(delays[0], 1000); // First retry: 1000ms
            assertEquals(delays[1], 3000); // Second retry: 3000ms
            assertEquals(delays[2], 5000); // Third retry: capped at 5000ms (would be 9000ms)

            // Restore original sleep
            (retryService as any).sleep = originalSleep;
        });
    });

    describe('executeMultipleWithRetry', () => {
        it('should execute multiple operations sequentially', async () => {
            const operation1 = spy(() => Promise.resolve('result1'));
            const operation2 = spy(() => Promise.resolve('result2'));
            const operation3 = spy(() => Promise.reject(new Error('Error 3')));

            const operations = [
                {
                    operation: operation1,
                    context: { operation: 'op1', attemptNumber: 1, timestamp: new Date() },
                },
                {
                    operation: operation2,
                    context: { operation: 'op2', attemptNumber: 1, timestamp: new Date() },
                },
                {
                    operation: operation3,
                    context: { operation: 'op3', attemptNumber: 1, timestamp: new Date() },
                },
            ];

            const results = await retryService.executeMultipleWithRetry(operations, {
                parallel: false,
                failFast: false,
            });

            assertEquals(results.length, 3);
            assertEquals(results[0].success, true);
            assertEquals(results[0].result, 'result1');
            assertEquals(results[1].success, true);
            assertEquals(results[1].result, 'result2');
            assertEquals(results[2].success, false);
            assertInstanceOf(results[2].error, Error);
        });

        it('should execute multiple operations in parallel', async () => {
            const operation1 = spy(() => Promise.resolve('result1'));
            const operation2 = spy(() => Promise.resolve('result2'));

            const operations = [
                {
                    operation: operation1,
                    context: { operation: 'op1', attemptNumber: 1, timestamp: new Date() },
                },
                {
                    operation: operation2,
                    context: { operation: 'op2', attemptNumber: 1, timestamp: new Date() },
                },
            ];

            const startTime = Date.now();
            const results = await retryService.executeMultipleWithRetry(operations, {
                parallel: true,
            });
            const endTime = Date.now();

            assertEquals(results.length, 2);
            assertEquals(results[0].success, true);
            assertEquals(results[1].success, true);

            // Parallel execution should be faster than sequential
            // (This is a rough test, actual timing may vary)
            const elapsed = endTime - startTime;
            assert(elapsed < 100); // Should complete quickly in parallel
        });

        it('should fail fast when enabled', async () => {
            const operation1 = spy(() => Promise.resolve('result1'));
            const operation2 = spy(() => Promise.reject(new Error('Error 2')));
            const operation3 = spy(() => Promise.resolve('result3'));

            const operations = [
                {
                    operation: operation1,
                    context: { operation: 'op1', attemptNumber: 1, timestamp: new Date() },
                },
                {
                    operation: operation2,
                    context: { operation: 'op2', attemptNumber: 1, timestamp: new Date() },
                },
                {
                    operation: operation3,
                    context: { operation: 'op3', attemptNumber: 1, timestamp: new Date() },
                },
            ];

            await assertRejects(
                () => retryService.executeMultipleWithRetry(operations, {
                    parallel: false,
                    failFast: true,
                }),
                Error,
                'Error 2'
            );

            // Should not execute operation3 due to fail fast
            assertEquals(operation3.calls.length, 0);
        });
    });

    describe('executeWithCircuitBreaker', () => {
        it('should execute operation successfully', async () => {
            const operation = spy(() => Promise.resolve('success'));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const result = await retryService.executeWithCircuitBreaker(operation, context);

            assertEquals(result, 'success');
            assertEquals(operation.calls.length, 1);
        });

        it('should handle operation failure', async () => {
            const operation = spy(() => Promise.reject(new Error('Circuit breaker test')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await assertRejects(
                () => retryService.executeWithCircuitBreaker(operation, context),
                Error,
                'Circuit breaker test'
            );
        });
    });

    describe('error classification', () => {
        it('should identify retryable network errors', () => {
            const networkErrors = [
                new Error('ECONNREFUSED connection refused'),
                new Error('ENOTFOUND host not found'),
                new Error('Network timeout'),
                new Error('Connection error'),
                new Error('ETIMEDOUT timeout'),
            ];

            for (const error of networkErrors) {
                const isRetryable = (retryService as any).isRetryableError(error);
                assertEquals(isRetryable, true, `Should be retryable: ${error.message}`);
            }
        });

        it('should identify retryable service errors', () => {
            const serviceErrors = [
                new Error('429 Too Many Requests'),
                new Error('Rate limit exceeded'),
                new Error('503 Service Unavailable'),
                new Error('502 Bad Gateway'),
                new Error('504 Gateway Timeout'),
                new Error('Service temporarily busy'),
                new Error('Server overloaded'),
            ];

            for (const error of serviceErrors) {
                const isRetryable = (retryService as any).isRetryableError(error);
                assertEquals(isRetryable, true, `Should be retryable: ${error.message}`);
            }
        });

        it('should identify non-retryable errors', () => {
            const nonRetryableErrors = [
                new Error('401 Unauthorized'),
                new Error('403 Forbidden'),
                new Error('404 Not Found'),
                new Error('Authentication failed'),
                new Error('Permission denied'),
                new Error('ENOENT: no such file or directory'),
                new Error('Invalid configuration'),
                new Error('Malformed request'),
                new Error('Syntax error'),
            ];

            for (const error of nonRetryableErrors) {
                const isRetryable = (retryService as any).isRetryableError(error);
                assertEquals(isRetryable, false, `Should not be retryable: ${error.message}`);
            }
        });

        it('should default to retryable for unknown errors', () => {
            const unknownErrors = [
                new Error('Some unknown error'),
                new Error('Unexpected failure'),
                'String error',
                { message: 'Object error' },
            ];

            for (const error of unknownErrors) {
                const isRetryable = (retryService as any).isRetryableError(error);
                assertEquals(isRetryable, true, `Should default to retryable: ${error}`);
            }
        });
    });

    describe('delay calculation', () => {
        it('should calculate exponential backoff correctly', () => {
            const config: RetryConfig = {
                maxAttempts: 5,
                baseDelayMs: 1000,
                maxDelayMs: 30000,
                backoffMultiplier: 2,
                jitterMs: 0,
            };

            const delay1 = (retryService as any).calculateDelay(1, config);
            const delay2 = (retryService as any).calculateDelay(2, config);
            const delay3 = (retryService as any).calculateDelay(3, config);

            assertEquals(delay1, 1000);  // 1000 * 2^0 = 1000
            assertEquals(delay2, 2000);  // 1000 * 2^1 = 2000
            assertEquals(delay3, 4000);  // 1000 * 2^2 = 4000
        });

        it('should respect maximum delay', () => {
            const config: RetryConfig = {
                maxAttempts: 10,
                baseDelayMs: 1000,
                maxDelayMs: 5000,
                backoffMultiplier: 2,
                jitterMs: 0,
            };

            const delay5 = (retryService as any).calculateDelay(5, config);
            const delay10 = (retryService as any).calculateDelay(10, config);

            // 1000 * 2^4 = 16000, but should be capped at 5000
            assertEquals(delay5, 5000);
            assertEquals(delay10, 5000);
        });

        it('should add jitter when configured', () => {
            const config: RetryConfig = {
                maxAttempts: 3,
                baseDelayMs: 1000,
                maxDelayMs: 30000,
                backoffMultiplier: 2,
                jitterMs: 100,
            };

            const delay1 = (retryService as any).calculateDelay(1, config);
            const delay2 = (retryService as any).calculateDelay(1, config);

            // With jitter, delays should be different
            // Base delay is 1000, jitter is 0-100, so range is 1000-1100
            assert(delay1 >= 1000 && delay1 <= 1100);
            assert(delay2 >= 1000 && delay2 <= 1100);
        });
    });

    describe('getRetryStats', () => {
        it('should return retry statistics', () => {
            const stats = retryService.getRetryStats();

            assertEquals(typeof stats.defaultConfig, 'object');
            assertEquals(typeof stats.totalOperations, 'number');
            assertEquals(typeof stats.successfulOperations, 'number');
            assertEquals(typeof stats.failedOperations, 'number');
        });
    });

    describe('updateDefaultConfig', () => {
        it('should update default configuration', () => {
            const newConfig: Partial<RetryConfig> = {
                maxAttempts: 5,
                baseDelayMs: 2000,
            };

            retryService.updateDefaultConfig(newConfig);

            const stats = retryService.getRetryStats();
            assertEquals(stats.defaultConfig.maxAttempts, 5);
            assertEquals(stats.defaultConfig.baseDelayMs, 2000);
        });
    });

    describe('error serialization', () => {
        it('should serialize Error objects correctly', () => {
            const error = new Error('Test error');
            error.stack = 'Test stack trace';

            const serialized = (retryService as any).serializeError(error);

            assertEquals(serialized.name, 'Error');
            assertEquals(serialized.message, 'Test error');
            assertEquals(serialized.stack, 'Test stack trace');
        });

        it('should serialize string errors', () => {
            const serialized = (retryService as any).serializeError('String error');
            assertEquals(serialized.message, 'String error');
        });

        it('should serialize object errors', () => {
            const error = { code: 'ERR001', message: 'Object error' };
            const serialized = (retryService as any).serializeError(error);

            assertEquals(serialized.code, 'ERR001');
            assertEquals(serialized.message, 'Object error');
        });

        it('should handle unknown error types', () => {
            const serialized = (retryService as any).serializeError(null);
            assertEquals(serialized.message, 'Unknown error type');
        });
    });
});

describe('createRetryService', () => {
    it('should create RetryService instance', () => {
        const logger = new Logger('test');
        const service = createRetryService(logger);
        assertInstanceOf(service, RetryService);
    });

    it('should create RetryService with custom config', () => {
        const logger = new Logger('test');
        const config: Partial<RetryConfig> = {
            maxAttempts: 5,
            baseDelayMs: 2000,
        };
        
        const service = createRetryService(logger, config);
        assertInstanceOf(service, RetryService);
    });
});