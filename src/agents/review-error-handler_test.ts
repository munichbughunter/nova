/**
 * Unit tests for the ReviewErrorHandler and related error handling functionality
 */

import { assertEquals, assertInstanceOf, assertRejects, assertThrows } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { Logger } from '../utils/logger.ts';
import {
    ReviewError,
    ReviewErrorType,
    ReviewErrorHandler,
    createReviewErrorHandler,
    isReviewError,
    getErrorMessage,
    DEFAULT_RETRY_CONFIG,
    RETRY_CONFIGS,
    ERROR_GUIDANCE,
} from './review-error-handler.ts';

describe('ReviewError', () => {
    it('should create a ReviewError with all properties', () => {
        const error = new ReviewError(
            ReviewErrorType.AUTHENTICATION_FAILED,
            'Authentication failed',
            { token: 'invalid' },
            false,
            'Check your token'
        );

        assertEquals(error.type, ReviewErrorType.AUTHENTICATION_FAILED);
        assertEquals(error.message, 'Authentication failed');
        assertEquals(error.details, { token: 'invalid' });
        assertEquals(error.retryable, false);
        assertEquals(error.userGuidance, 'Check your token');
        assertInstanceOf(error.timestamp, Date);
    });

    it('should create a ReviewError with minimal properties', () => {
        const error = new ReviewError(
            ReviewErrorType.FILE_NOT_FOUND,
            'File not found'
        );

        assertEquals(error.type, ReviewErrorType.FILE_NOT_FOUND);
        assertEquals(error.message, 'File not found');
        assertEquals(error.details, {});
        assertEquals(error.retryable, false);
        assertEquals(error.userGuidance, undefined);
    });

    it('should generate user-friendly message', () => {
        const error = new ReviewError(
            ReviewErrorType.NETWORK_ERROR,
            'Connection failed',
            {},
            true,
            'Check your internet connection'
        );

        const userMessage = error.toUserMessage();
        assertEquals(userMessage, 'Connection failed\n\n💡 Check your internet connection');
    });

    it('should generate user-friendly message without guidance', () => {
        const error = new ReviewError(
            ReviewErrorType.ANALYSIS_FAILED,
            'Analysis failed'
        );

        const userMessage = error.toUserMessage();
        assertEquals(userMessage, 'Analysis failed');
    });

    it('should convert to JSON', () => {
        const error = new ReviewError(
            ReviewErrorType.API_RATE_LIMITED,
            'Rate limited',
            { limit: 100 },
            true,
            'Wait before retrying'
        );

        const json = error.toJSON();
        assertEquals(json.type, ReviewErrorType.API_RATE_LIMITED);
        assertEquals(json.message, 'Rate limited');
        assertEquals(json.details, { limit: 100 });
        assertEquals(json.retryable, true);
        assertEquals(json.userGuidance, 'Wait before retrying');
        assertEquals(typeof json.timestamp, 'string');
        assertEquals(typeof json.stack, 'string');
    });
});

describe('ReviewErrorHandler', () => {
    let logger: Logger;
    let errorHandler: ReviewErrorHandler;

    beforeEach(() => {
        logger = new Logger('test');
        errorHandler = new ReviewErrorHandler(logger);
    });

    afterEach(() => {
        restore();
    });

    describe('createReviewError', () => {
        it('should create ReviewError from Error object', () => {
            const originalError = new Error('Original error message');
            const reviewError = errorHandler.createReviewError(
                originalError,
                ReviewErrorType.NETWORK_ERROR,
                { context: 'test' }
            );

            assertEquals(reviewError.type, ReviewErrorType.NETWORK_ERROR);
            assertEquals(reviewError.message, 'Original error message');
            assertEquals(reviewError.details.context, 'test');
            assertEquals(reviewError.details.originalError, {
                name: 'Error',
                message: 'Original error message',
                stack: originalError.stack,
            });
            assertEquals(reviewError.retryable, true); // NETWORK_ERROR is retryable
        });

        it('should create ReviewError from string', () => {
            const reviewError = errorHandler.createReviewError(
                'String error',
                ReviewErrorType.FILE_NOT_FOUND
            );

            assertEquals(reviewError.type, ReviewErrorType.FILE_NOT_FOUND);
            assertEquals(reviewError.message, 'String error');
            assertEquals(reviewError.retryable, false); // FILE_NOT_FOUND is not retryable
        });

        it('should create ReviewError from unknown error', () => {
            const reviewError = errorHandler.createReviewError(
                { unknown: 'error' },
                ReviewErrorType.ANALYSIS_FAILED
            );

            assertEquals(reviewError.type, ReviewErrorType.ANALYSIS_FAILED);
            assertEquals(reviewError.message, 'Unknown error occurred');
            assertEquals(reviewError.details.originalError, { unknown: 'error' });
        });
    });

    describe('handleError', () => {
        it('should return ReviewError as-is', () => {
            const originalError = new ReviewError(
                ReviewErrorType.AUTHENTICATION_FAILED,
                'Auth failed'
            );
            
            const result = errorHandler.handleError(originalError);
            assertEquals(result, originalError);
        });

        it('should classify network errors', () => {
            const networkError = new Error('Connection refused ECONNREFUSED');
            const result = errorHandler.handleError(networkError);
            
            assertEquals(result.type, ReviewErrorType.NETWORK_ERROR);
            assertEquals(result.retryable, true);
        });

        it('should classify authentication errors', () => {
            const authError = new Error('401 Unauthorized');
            const result = errorHandler.handleError(authError);
            
            assertEquals(result.type, ReviewErrorType.AUTHENTICATION_FAILED);
            assertEquals(result.retryable, false);
        });

        it('should classify permission errors', () => {
            const permError = new Error('403 Forbidden');
            const result = errorHandler.handleError(permError);
            
            assertEquals(result.type, ReviewErrorType.PERMISSION_DENIED);
            assertEquals(result.retryable, false);
        });

        it('should classify rate limit errors', () => {
            const rateLimitError = new Error('429 Too Many Requests');
            const result = errorHandler.handleError(rateLimitError);
            
            assertEquals(result.type, ReviewErrorType.API_RATE_LIMITED);
            assertEquals(result.retryable, true);
        });

        it('should classify file not found errors', () => {
            const fileError = new Error('ENOENT: no such file or directory');
            const result = errorHandler.handleError(fileError);
            
            assertEquals(result.type, ReviewErrorType.FILE_NOT_FOUND);
            assertEquals(result.retryable, false);
        });

        it('should classify timeout errors', () => {
            const timeoutError = new Error('Request timeout ETIMEDOUT');
            const result = errorHandler.handleError(timeoutError);
            
            assertEquals(result.type, ReviewErrorType.TIMEOUT_ERROR);
            assertEquals(result.retryable, true);
        });

        it('should classify service unavailable errors', () => {
            const serviceError = new Error('503 Service Unavailable');
            const result = errorHandler.handleError(serviceError);
            
            assertEquals(result.type, ReviewErrorType.SERVICE_UNAVAILABLE);
            assertEquals(result.retryable, true);
        });

        it('should classify git errors', () => {
            const gitError = new Error('not a git repository');
            const result = errorHandler.handleError(gitError);
            
            assertEquals(result.type, ReviewErrorType.GIT_OPERATION_FAILED);
            assertEquals(result.retryable, true);
        });

        it('should default to analysis failed for unclassified errors', () => {
            const unknownError = new Error('Some unknown error');
            const result = errorHandler.handleError(unknownError);
            
            assertEquals(result.type, ReviewErrorType.ANALYSIS_FAILED);
            assertEquals(result.retryable, true);
        });
    });

    describe('withRetry', () => {
        it('should succeed on first attempt', async () => {
            const operation = spy(() => Promise.resolve('success'));
            
            const result = await errorHandler.withRetry(
                operation,
                ReviewErrorType.NETWORK_ERROR
            );
            
            assertEquals(result, 'success');
            assertEquals(operation.calls.length, 1);
        });

        it('should retry on failure and eventually succeed', async () => {
            let attempts = 0;
            const operation = spy(() => {
                attempts++;
                if (attempts < 3) {
                    return Promise.reject(new Error('Network error'));
                }
                return Promise.resolve('success');
            });
            
            const result = await errorHandler.withRetry(
                operation,
                ReviewErrorType.NETWORK_ERROR
            );
            
            assertEquals(result, 'success');
            assertEquals(operation.calls.length, 3);
        });

        it('should fail after max attempts', async () => {
            const operation = spy(() => Promise.reject(new Error('Persistent error')));
            
            await assertRejects(
                () => errorHandler.withRetry(operation, ReviewErrorType.NETWORK_ERROR),
                ReviewError,
                'Persistent error'
            );
            
            // Should try the configured number of times for NETWORK_ERROR
            const config = RETRY_CONFIGS[ReviewErrorType.NETWORK_ERROR]!;
            assertEquals(operation.calls.length, config.maxAttempts);
        });

        it('should not retry non-retryable errors', async () => {
            const operation = spy(() => Promise.reject(new Error('Auth failed')));
            
            await assertRejects(
                () => errorHandler.withRetry(operation, ReviewErrorType.AUTHENTICATION_FAILED),
                ReviewError,
                'Auth failed'
            );
            
            assertEquals(operation.calls.length, 1);
        });

        it('should use custom retry config', async () => {
            const operation = spy(() => Promise.reject(new Error('Network error')));
            
            await assertRejects(
                () => errorHandler.withRetry(
                    operation,
                    ReviewErrorType.NETWORK_ERROR,
                    {},
                    { maxAttempts: 2 }
                ),
                ReviewError
            );
            
            assertEquals(operation.calls.length, 2);
        });

        it('should add delay between retries', async () => {
            const startTime = Date.now();
            const operation = spy(() => Promise.reject(new Error('Network error')));
            
            await assertRejects(
                () => errorHandler.withRetry(
                    operation,
                    ReviewErrorType.NETWORK_ERROR,
                    {},
                    { maxAttempts: 2, baseDelayMs: 100, jitterMs: 0 }
                ),
                ReviewError
            );
            
            const endTime = Date.now();
            const elapsed = endTime - startTime;
            
            // Should have at least one delay of ~100ms
            assertEquals(elapsed >= 100, true);
        });
    });

    describe('withGracefulDegradation', () => {
        it('should return primary operation result on success', async () => {
            const primaryOp = spy(() => Promise.resolve('primary'));
            const fallbackOp = spy(() => Promise.resolve('fallback'));
            
            const result = await errorHandler.withGracefulDegradation(
                primaryOp,
                fallbackOp,
                ReviewErrorType.NETWORK_ERROR
            );
            
            assertEquals(result, 'primary');
            assertEquals(primaryOp.calls.length, 1);
            assertEquals(fallbackOp.calls.length, 0);
        });

        it('should return fallback result when primary fails', async () => {
            const primaryOp = spy(() => Promise.reject(new Error('Primary failed')));
            const fallbackOp = spy(() => Promise.resolve('fallback'));
            
            const result = await errorHandler.withGracefulDegradation(
                primaryOp,
                fallbackOp,
                ReviewErrorType.AUTHENTICATION_FAILED // Non-retryable
            );
            
            assertEquals(result, 'fallback');
            assertEquals(primaryOp.calls.length, 1);
            assertEquals(fallbackOp.calls.length, 1);
        });

        it('should throw primary error when both operations fail', async () => {
            const primaryError = new Error('Primary failed');
            const primaryOp = spy(() => Promise.reject(primaryError));
            const fallbackOp = spy(() => Promise.reject(new Error('Fallback failed')));
            
            await assertRejects(
                () => errorHandler.withGracefulDegradation(
                    primaryOp,
                    fallbackOp,
                    ReviewErrorType.AUTHENTICATION_FAILED
                ),
                Error,
                'Primary failed'
            );
        });
    });

    describe('utility methods', () => {
        it('should check if error is retryable', () => {
            const retryableError = new ReviewError(
                ReviewErrorType.NETWORK_ERROR,
                'Network error',
                {},
                true
            );
            const nonRetryableError = new ReviewError(
                ReviewErrorType.FILE_NOT_FOUND,
                'File not found',
                {},
                false
            );
            
            assertEquals(errorHandler.isRetryable(retryableError), true);
            assertEquals(errorHandler.isRetryable(nonRetryableError), false);
        });

        it('should get retry config for error type', () => {
            const config = errorHandler.getRetryConfig(ReviewErrorType.NETWORK_ERROR);
            assertEquals(config, RETRY_CONFIGS[ReviewErrorType.NETWORK_ERROR]);
            
            const noConfig = errorHandler.getRetryConfig(ReviewErrorType.FILE_NOT_FOUND);
            assertEquals(noConfig, null);
        });

        it('should get user guidance for error type', () => {
            const guidance = errorHandler.getUserGuidance(ReviewErrorType.AUTHENTICATION_FAILED);
            assertEquals(guidance, ERROR_GUIDANCE[ReviewErrorType.AUTHENTICATION_FAILED]);
        });
    });
});

describe('Utility functions', () => {
    describe('createReviewErrorHandler', () => {
        it('should create a ReviewErrorHandler instance', () => {
            const logger = new Logger('test');
            const handler = createReviewErrorHandler(logger);
            assertInstanceOf(handler, ReviewErrorHandler);
        });
    });

    describe('isReviewError', () => {
        it('should identify ReviewError instances', () => {
            const reviewError = new ReviewError(ReviewErrorType.NETWORK_ERROR, 'Network error');
            const regularError = new Error('Regular error');
            
            assertEquals(isReviewError(reviewError), true);
            assertEquals(isReviewError(regularError), false);
            assertEquals(isReviewError('string'), false);
        });

        it('should check for specific error type', () => {
            const networkError = new ReviewError(ReviewErrorType.NETWORK_ERROR, 'Network error');
            const authError = new ReviewError(ReviewErrorType.AUTHENTICATION_FAILED, 'Auth error');
            
            assertEquals(isReviewError(networkError, ReviewErrorType.NETWORK_ERROR), true);
            assertEquals(isReviewError(networkError, ReviewErrorType.AUTHENTICATION_FAILED), false);
            assertEquals(isReviewError(authError, ReviewErrorType.AUTHENTICATION_FAILED), true);
        });
    });

    describe('getErrorMessage', () => {
        it('should get message from ReviewError', () => {
            const error = new ReviewError(
                ReviewErrorType.NETWORK_ERROR,
                'Network failed',
                {},
                true,
                'Check connection'
            );
            
            const message = getErrorMessage(error);
            assertEquals(message, 'Network failed\n\n💡 Check connection');
        });

        it('should get message from regular Error', () => {
            const error = new Error('Regular error');
            const message = getErrorMessage(error);
            assertEquals(message, 'Regular error');
        });

        it('should get message from string', () => {
            const message = getErrorMessage('String error');
            assertEquals(message, 'String error');
        });

        it('should handle unknown error types', () => {
            const message = getErrorMessage({ unknown: 'error' });
            assertEquals(message, 'An unknown error occurred');
        });
    });
});

describe('Configuration constants', () => {
    it('should have default retry config', () => {
        assertEquals(typeof DEFAULT_RETRY_CONFIG.maxAttempts, 'number');
        assertEquals(typeof DEFAULT_RETRY_CONFIG.baseDelayMs, 'number');
        assertEquals(typeof DEFAULT_RETRY_CONFIG.maxDelayMs, 'number');
        assertEquals(typeof DEFAULT_RETRY_CONFIG.backoffMultiplier, 'number');
    });

    it('should have retry configs for all error types', () => {
        const errorTypes = Object.values(ReviewErrorType);
        for (const errorType of errorTypes) {
            assertEquals(errorType in RETRY_CONFIGS, true);
        }
    });

    it('should have error guidance for all error types', () => {
        const errorTypes = Object.values(ReviewErrorType);
        for (const errorType of errorTypes) {
            assertEquals(errorType in ERROR_GUIDANCE, true);
            assertEquals(typeof ERROR_GUIDANCE[errorType], 'string');
            assertEquals(ERROR_GUIDANCE[errorType].length > 0, true);
        }
    });

    it('should have consistent retryable configuration', () => {
        // Errors that should not be retryable
        const nonRetryableTypes = [
            ReviewErrorType.REPOSITORY_NOT_DETECTED,
            ReviewErrorType.AUTHENTICATION_FAILED,
            ReviewErrorType.FILE_NOT_FOUND,
            ReviewErrorType.PERMISSION_DENIED,
            ReviewErrorType.INVALID_CONFIGURATION,
        ];

        for (const type of nonRetryableTypes) {
            assertEquals(RETRY_CONFIGS[type], null);
        }

        // Errors that should be retryable
        const retryableTypes = [
            ReviewErrorType.API_RATE_LIMITED,
            ReviewErrorType.NETWORK_ERROR,
            ReviewErrorType.SERVICE_UNAVAILABLE,
            ReviewErrorType.TIMEOUT_ERROR,
        ];

        for (const type of retryableTypes) {
            assertEquals(RETRY_CONFIGS[type] !== null, true);
            const config = RETRY_CONFIGS[type]!;
            assertEquals(typeof config.maxAttempts, 'number');
            assertEquals(config.maxAttempts > 1, true);
        }
    });
});