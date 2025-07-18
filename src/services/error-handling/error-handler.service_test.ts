/**
 * Unit tests for the ErrorHandlingService
 */

import { assertEquals, assertInstanceOf, assertRejects, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { Logger } from '../../utils/logger.ts';
import { ErrorHandlingService, createErrorHandlingService } from './error-handler.service.ts';
import { ErrorContext, ErrorResolution, ErrorStrategy, ErrorHandlerConfig } from './types.ts';

describe('ErrorHandlingService', () => {
    let logger: Logger;
    let errorService: ErrorHandlingService;

    beforeEach(() => {
        logger = new Logger('test');
        errorService = new ErrorHandlingService(logger);
    });

    afterEach(() => {
        restore();
    });

    describe('constructor', () => {
        it('should create service with default configuration', () => {
            const service = new ErrorHandlingService(logger);
            assertInstanceOf(service, ErrorHandlingService);
        });

        it('should create service with custom configuration', () => {
            const config: Partial<ErrorHandlerConfig> = {
                enableMetrics: false,
                enableRetry: false,
                maxRetryAttempts: 5,
            };
            
            const service = new ErrorHandlingService(logger, config);
            assertInstanceOf(service, ErrorHandlingService);
        });
    });

    describe('handleValidationError', () => {
        it('should handle validation error with default strategy', async () => {
            const error = new Error('Validation failed');
            const context: ErrorContext = {
                operation: 'validate_data',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution = await errorService.handleValidationError(error, context);

            assertEquals(resolution.strategy, 'fallback');
            assertEquals(resolution.shouldLog, true);
            assert(resolution.message.includes('fallback') || resolution.message.includes('default'));
        });

        it('should handle Zod validation error with detailed information', async () => {
            const zodError = {
                issues: [
                    { path: ['coverage'], message: 'Expected number, received string' },
                    { path: ['testsPresent'], message: 'Expected boolean, received string' },
                ]
            };
            
            const context: ErrorContext = {
                operation: 'validate_schema',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution = await errorService.handleValidationError(zodError, context);

            assertEquals(resolution.strategy, 'transform');
            assertEquals(resolution.shouldLog, true);
            assert(resolution.message.includes('coverage'));
            assert(resolution.data);
            assertEquals((resolution.data as any).validationIssues.length, 2);
        });

        it('should record metrics when enabled', async () => {
            const error = new Error('Validation failed');
            const context: ErrorContext = {
                operation: 'validate_data',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await errorService.handleValidationError(error, context);
            
            const metrics = errorService.getErrorMetrics();
            assertEquals(metrics.totalErrors, 1);
            assertEquals(metrics.errorsByType['validation'], 1);
        });
    });

    describe('handleLLMError', () => {
        it('should handle retryable LLM error', async () => {
            const error = new Error('Network timeout');
            const context: ErrorContext = {
                operation: 'llm_request',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution = await errorService.handleLLMError(error, context);

            assertEquals(resolution.strategy, 'retry');
            assertEquals(resolution.shouldLog, true);
            assert(resolution.retryAfter);
            assert(resolution.retryAfter! > 0);
        });

        it('should handle non-retryable LLM error', async () => {
            const error = new Error('401 Unauthorized');
            const context: ErrorContext = {
                operation: 'llm_request',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution = await errorService.handleLLMError(error, context);

            assertEquals(resolution.strategy, 'fallback');
            assertEquals(resolution.shouldLog, true);
            assert(resolution.message.includes('rule-based'));
        });

        it('should record metrics for LLM errors', async () => {
            const error = new Error('LLM provider error');
            const context: ErrorContext = {
                operation: 'llm_request',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await errorService.handleLLMError(error, context);
            
            const metrics = errorService.getErrorMetrics();
            assertEquals(metrics.totalErrors, 1);
            assertEquals(metrics.errorsByType['llm'], 1);
        });
    });

    describe('handleAPIError', () => {
        it('should handle retryable API error', async () => {
            const error = new Error('503 Service Unavailable');
            const context: ErrorContext = {
                operation: 'api_request',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution = await errorService.handleAPIError(error, context);

            assertEquals(resolution.strategy, 'retry');
            assertEquals(resolution.shouldLog, true);
            assert(resolution.retryAfter);
        });

        it('should handle non-retryable API error', async () => {
            const error = new Error('404 Not Found');
            const context: ErrorContext = {
                operation: 'api_request',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution = await errorService.handleAPIError(error, context);

            assertEquals(resolution.strategy, 'fail');
            assertEquals(resolution.shouldLog, true);
        });
    });

    describe('executeWithErrorHandling', () => {
        it('should execute operation successfully without retry', async () => {
            const operation = spy(() => Promise.resolve('success'));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const result = await errorService.executeWithErrorHandling(
                operation,
                context,
                { enableRetry: false }
            );

            assertEquals(result, 'success');
            assertEquals(operation.calls.length, 1);
        });

        it('should retry operation on failure', async () => {
            let attempts = 0;
            const operation = spy(() => {
                attempts++;
                if (attempts < 3) {
                    return Promise.reject(new Error('Temporary failure'));
                }
                return Promise.resolve('success');
            });

            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const result = await errorService.executeWithErrorHandling(
                operation,
                context,
                { enableRetry: true, maxAttempts: 3 }
            );

            assertEquals(result, 'success');
            assertEquals(operation.calls.length, 3);
        });

        it('should use fallback operation when primary fails', async () => {
            const primaryOperation = spy(() => Promise.reject(new Error('Primary failed')));
            const fallbackOperation = spy(() => Promise.resolve('fallback_result'));
            
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const result = await errorService.executeWithErrorHandling(
                primaryOperation,
                context,
                {
                    enableRetry: false,
                    enableFallback: true,
                    fallbackOperation,
                }
            );

            assertEquals(result, 'fallback_result');
            assertEquals(primaryOperation.calls.length, 1);
            assertEquals(fallbackOperation.calls.length, 1);
        });

        it('should throw error when both primary and fallback fail', async () => {
            const primaryError = new Error('Primary failed');
            const primaryOperation = spy(() => Promise.reject(primaryError));
            const fallbackOperation = spy(() => Promise.reject(new Error('Fallback failed')));
            
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await assertRejects(
                () => errorService.executeWithErrorHandling(
                    primaryOperation,
                    context,
                    {
                        enableRetry: false,
                        enableFallback: true,
                        fallbackOperation,
                    }
                ),
                Error,
                'Primary failed'
            );
        });
    });

    describe('registerErrorHandler', () => {
        it('should register custom error strategy', async () => {
            const customStrategy: ErrorStrategy = {
                handle: async (error: unknown, context: ErrorContext): Promise<ErrorResolution> => {
                    return {
                        strategy: 'transform',
                        message: 'Custom strategy applied',
                        shouldLog: true,
                        data: { custom: true },
                    };
                }
            };

            errorService.registerErrorHandler('custom', customStrategy);

            // Test that the custom strategy is used
            const error = new Error('Test error');
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            // We need to access the strategy directly since it's private
            // In a real scenario, you would test this through the public API
            const strategies = (errorService as any).strategies;
            const registeredStrategy = strategies.get('custom');
            
            assertInstanceOf(registeredStrategy, Object);
            assertEquals(typeof registeredStrategy.handle, 'function');
        });
    });

    describe('isRetryable', () => {
        it('should identify retryable network errors', () => {
            const networkError = new Error('ECONNREFUSED connection refused');
            assertEquals(errorService.isRetryable(networkError), true);
        });

        it('should identify retryable timeout errors', () => {
            const timeoutError = new Error('Request timeout ETIMEDOUT');
            assertEquals(errorService.isRetryable(timeoutError), true);
        });

        it('should identify retryable rate limit errors', () => {
            const rateLimitError = new Error('429 Too Many Requests');
            assertEquals(errorService.isRetryable(rateLimitError), true);
        });

        it('should identify non-retryable authentication errors', () => {
            const authError = new Error('401 Unauthorized');
            assertEquals(errorService.isRetryable(authError), false);
        });

        it('should identify non-retryable permission errors', () => {
            const permError = new Error('403 Forbidden');
            assertEquals(errorService.isRetryable(permError), false);
        });

        it('should identify non-retryable file not found errors', () => {
            const fileError = new Error('ENOENT: no such file or directory');
            assertEquals(errorService.isRetryable(fileError), false);
        });

        it('should default to retryable for unknown errors', () => {
            const unknownError = new Error('Some unknown error');
            assertEquals(errorService.isRetryable(unknownError), true);
        });
    });

    describe('getErrorMetrics', () => {
        it('should return error metrics', () => {
            const metrics = errorService.getErrorMetrics();
            
            assertEquals(typeof metrics.totalErrors, 'number');
            assertEquals(typeof metrics.errorsByType, 'object');
            assertEquals(typeof metrics.errorsByOperation, 'object');
            assertEquals(typeof metrics.retryAttempts, 'number');
            assertEquals(typeof metrics.errorRecoveryRate, 'number');
            assertInstanceOf(metrics.lastResetTime, Date);
        });

        it('should track metrics across multiple errors', async () => {
            const context1: ErrorContext = {
                operation: 'operation1',
                attemptNumber: 1,
                timestamp: new Date(),
            };
            
            const context2: ErrorContext = {
                operation: 'operation2',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await errorService.handleValidationError(new Error('Error 1'), context1);
            await errorService.handleLLMError(new Error('Error 2'), context2);
            await errorService.handleAPIError(new Error('Error 3'), context1);

            const metrics = errorService.getErrorMetrics();
            assertEquals(metrics.totalErrors, 3);
            assertEquals(metrics.errorsByOperation['operation1'], 2);
            assertEquals(metrics.errorsByOperation['operation2'], 1);
        });
    });

    describe('resetMetrics', () => {
        it('should reset all metrics to initial state', async () => {
            // Generate some metrics
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await errorService.handleValidationError(new Error('Test error'), context);
            
            let metrics = errorService.getErrorMetrics();
            assertEquals(metrics.totalErrors, 1);

            // Reset metrics
            errorService.resetMetrics();
            
            metrics = errorService.getErrorMetrics();
            assertEquals(metrics.totalErrors, 0);
            assertEquals(Object.keys(metrics.errorsByType).length, 0);
            assertEquals(Object.keys(metrics.errorsByOperation).length, 0);
        });
    });

    describe('configuration handling', () => {
        it('should respect disabled metrics configuration', async () => {
            const serviceWithoutMetrics = new ErrorHandlingService(logger, {
                enableMetrics: false,
            });

            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await serviceWithoutMetrics.handleValidationError(new Error('Test error'), context);
            
            const metrics = serviceWithoutMetrics.getErrorMetrics();
            assertEquals(metrics.totalErrors, 0); // Should not track when disabled
        });

        it('should respect disabled retry configuration', async () => {
            const serviceWithoutRetry = new ErrorHandlingService(logger, {
                enableRetry: false,
            });

            const operation = spy(() => Promise.reject(new Error('Test error')));
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            await assertRejects(
                () => serviceWithoutRetry.executeWithErrorHandling(operation, context),
                Error,
                'Test error'
            );

            assertEquals(operation.calls.length, 1); // Should not retry when disabled
        });
    });
});

describe('createErrorHandlingService', () => {
    it('should create ErrorHandlingService instance', () => {
        const logger = new Logger('test');
        const service = createErrorHandlingService(logger);
        assertInstanceOf(service, ErrorHandlingService);
    });

    it('should create ErrorHandlingService with custom config', () => {
        const logger = new Logger('test');
        const config: Partial<ErrorHandlerConfig> = {
            enableMetrics: false,
            maxRetryAttempts: 5,
        };
        
        const service = createErrorHandlingService(logger, config);
        assertInstanceOf(service, ErrorHandlingService);
    });
});

describe('Error Strategy Integration', () => {
    let logger: Logger;
    let errorService: ErrorHandlingService;

    beforeEach(() => {
        logger = new Logger('test');
        errorService = new ErrorHandlingService(logger);
    });

    it('should handle complex error scenarios with multiple strategies', async () => {
        // Register a custom strategy for testing
        const customStrategy: ErrorStrategy = {
            handle: async (error: unknown, context: ErrorContext): Promise<ErrorResolution> => {
                if (error instanceof Error && error.message.includes('custom')) {
                    return {
                        strategy: 'transform',
                        message: 'Custom transformation applied',
                        shouldLog: true,
                        data: { transformed: true },
                    };
                }
                
                return {
                    strategy: 'fallback',
                    message: 'Custom fallback applied',
                    shouldLog: true,
                };
            }
        };

        errorService.registerErrorHandler('custom', customStrategy);

        // Test the integration
        const context: ErrorContext = {
            operation: 'complex_operation',
            attemptNumber: 1,
            timestamp: new Date(),
        };

        const resolution = await errorService.handleValidationError(
            new Error('custom error'),
            context
        );

        // Should use the default validation strategy, not our custom one
        // because handleValidationError uses the 'validation' strategy
        assertEquals(resolution.strategy, 'fallback');
    });
});