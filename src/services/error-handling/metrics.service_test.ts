/**
 * Unit tests for the ErrorMetricsCollector
 */

import { assertEquals, assertInstanceOf, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach } from 'jsr:@std/testing/bdd';
import { Logger } from '../../utils/logger.ts';
import { ErrorMetricsCollector, createErrorMetricsCollector } from './metrics.service.ts';
import { ErrorContext, ErrorResolution, ErrorType, ErrorSeverity } from './types.ts';

describe('ErrorMetricsCollector', () => {
    let logger: Logger;
    let metricsCollector: ErrorMetricsCollector;

    beforeEach(() => {
        logger = new Logger('test');
        metricsCollector = new ErrorMetricsCollector(logger);
    });

    describe('constructor', () => {
        it('should create collector with default configuration', () => {
            const collector = new ErrorMetricsCollector(logger);
            assertInstanceOf(collector, ErrorMetricsCollector);
        });

        it('should create collector with custom max events', () => {
            const collector = new ErrorMetricsCollector(logger, 500);
            assertInstanceOf(collector, ErrorMetricsCollector);
        });
    });

    describe('recordError', () => {
        it('should record error and update metrics', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            metricsCollector.recordError('validation', context);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.totalErrors, 1);
            assertEquals(metrics.errorsByType['validation'], 1);
            assertEquals(metrics.errorsByOperation['test_operation'], 1);
        });

        it('should track multiple errors by type', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            metricsCollector.recordError('validation', context);
            metricsCollector.recordError('validation', context);
            metricsCollector.recordError('llm', context);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.totalErrors, 3);
            assertEquals(metrics.errorsByType['validation'], 2);
            assertEquals(metrics.errorsByType['llm'], 1);
        });

        it('should track multiple errors by operation', () => {
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

            metricsCollector.recordError('validation', context1);
            metricsCollector.recordError('validation', context1);
            metricsCollector.recordError('llm', context2);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.totalErrors, 3);
            assertEquals(metrics.errorsByOperation['operation1'], 2);
            assertEquals(metrics.errorsByOperation['operation2'], 1);
        });
    });

    describe('recordResolution', () => {
        it('should record resolution and update retry metrics', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution: ErrorResolution = {
                strategy: 'retry',
                message: 'Retrying operation',
                shouldLog: true,
                retryAfter: 1000,
            };

            metricsCollector.recordError('api', context);
            metricsCollector.recordResolution('api', resolution);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.retryAttempts, 1);
            assertEquals(metrics.averageRetryDelay, 1000);
        });

        it('should update average retry delay correctly', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution1: ErrorResolution = {
                strategy: 'retry',
                message: 'Retrying operation',
                shouldLog: true,
                retryAfter: 1000,
            };

            const resolution2: ErrorResolution = {
                strategy: 'retry',
                message: 'Retrying operation',
                shouldLog: true,
                retryAfter: 2000,
            };

            metricsCollector.recordError('api', context);
            metricsCollector.recordResolution('api', resolution1);
            metricsCollector.recordError('api', context);
            metricsCollector.recordResolution('api', resolution2);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.retryAttempts, 2);
            assertEquals(metrics.averageRetryDelay, 1500); // (1000 + 2000) / 2
        });

        it('should track transform and fallback strategies', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const transformResolution: ErrorResolution = {
                strategy: 'transform',
                message: 'Data transformed',
                shouldLog: true,
            };

            const fallbackResolution: ErrorResolution = {
                strategy: 'fallback',
                message: 'Using fallback',
                shouldLog: true,
            };

            metricsCollector.recordError('validation', context);
            metricsCollector.recordResolution('validation', transformResolution);
            metricsCollector.recordError('llm', context);
            metricsCollector.recordResolution('llm', fallbackResolution);

            const metrics = metricsCollector.getMetrics();
            // The error recovery rate should be calculated based on successful retries and fallbacks
            // Since we haven't recorded any successful retries or fallbacks explicitly,
            // we just check that the metrics are being tracked
            assertEquals(typeof metrics.errorRecoveryRate, 'number');
        });
    });

    describe('recordSuccessfulRetry', () => {
        it('should record successful retry and update recovery rate', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 2,
                timestamp: new Date(),
            };

            metricsCollector.recordSuccessfulRetry(context);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.successfulRetries, 1);
            assertEquals(metrics.errorRecoveryRate, 100); // 1 success out of 1 attempt
        });
    });

    describe('recordFailedRetry', () => {
        it('should record failed retry and update recovery rate', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 3,
                timestamp: new Date(),
            };

            metricsCollector.recordFailedRetry(context);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.failedRetries, 1);
            assertEquals(metrics.errorRecoveryRate, 0); // 0 successes out of 1 attempt
        });
    });

    describe('recordFallbackSuccess', () => {
        it('should record successful fallback', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            metricsCollector.recordFallbackSuccess(context);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.fallbacksUsed, 1);
            assertEquals(metrics.fallbackSuccesses, 1);
            assertEquals(metrics.fallbackFailures, 0);
            assertEquals(metrics.errorRecoveryRate, 100);
        });
    });

    describe('recordFallbackFailure', () => {
        it('should record failed fallback', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            metricsCollector.recordFallbackFailure(context);

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.fallbacksUsed, 1);
            assertEquals(metrics.fallbackSuccesses, 0);
            assertEquals(metrics.fallbackFailures, 1);
            assertEquals(metrics.errorRecoveryRate, 0);
        });
    });

    describe('getMetrics', () => {
        it('should return current metrics', () => {
            const metrics = metricsCollector.getMetrics();

            assertEquals(typeof metrics.totalErrors, 'number');
            assertEquals(typeof metrics.errorsByType, 'object');
            assertEquals(typeof metrics.errorsByOperation, 'object');
            assertEquals(typeof metrics.retryAttempts, 'number');
            assertEquals(typeof metrics.successfulRetries, 'number');
            assertEquals(typeof metrics.failedRetries, 'number');
            assertEquals(typeof metrics.fallbacksUsed, 'number');
            assertEquals(typeof metrics.fallbackSuccesses, 'number');
            assertEquals(typeof metrics.fallbackFailures, 'number');
            assertEquals(typeof metrics.averageRetryDelay, 'number');
            assertEquals(typeof metrics.errorRecoveryRate, 'number');
            assertInstanceOf(metrics.lastResetTime, Date);
        });

        it('should return a copy of metrics (not reference)', () => {
            const metrics1 = metricsCollector.getMetrics();
            const metrics2 = metricsCollector.getMetrics();

            // Modify one copy
            metrics1.totalErrors = 999;

            // Other copy should be unchanged
            assertEquals(metrics2.totalErrors, 0);
        });
    });

    describe('getDetailedStats', () => {
        it('should return detailed statistics', () => {
            // Add some test data
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

            metricsCollector.recordError('validation', context1);
            metricsCollector.recordError('validation', context1);
            metricsCollector.recordError('llm', context2);

            const stats = metricsCollector.getDetailedStats();

            assertEquals(typeof stats.metrics, 'object');
            assertEquals(Array.isArray(stats.topErrorTypes), true);
            assertEquals(Array.isArray(stats.topOperations), true);
            assertEquals(Array.isArray(stats.recentEvents), true);
            assertEquals(typeof stats.recoveryRateByType, 'object');

            // Check top error types
            assertEquals(stats.topErrorTypes.length, 2);
            assertEquals(stats.topErrorTypes[0].type, 'validation');
            assertEquals(stats.topErrorTypes[0].count, 2);
            assertEquals(stats.topErrorTypes[0].percentage, (2/3) * 100);

            // Check top operations
            assertEquals(stats.topOperations.length, 2);
            assertEquals(stats.topOperations[0].operation, 'operation1');
            assertEquals(stats.topOperations[0].count, 2);
        });
    });

    describe('reset', () => {
        it('should reset all metrics to initial state', () => {
            // Add some data
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            metricsCollector.recordError('validation', context);
            metricsCollector.recordSuccessfulRetry(context);

            let metrics = metricsCollector.getMetrics();
            assertEquals(metrics.totalErrors, 1);
            assertEquals(metrics.successfulRetries, 1);

            // Reset
            metricsCollector.reset();

            metrics = metricsCollector.getMetrics();
            assertEquals(metrics.totalErrors, 0);
            assertEquals(metrics.successfulRetries, 0);
            assertEquals(Object.keys(metrics.errorsByType).length, 0);
            assertEquals(Object.keys(metrics.errorsByOperation).length, 0);
        });
    });

    describe('exportMetrics', () => {
        it('should export metrics as JSON string', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            metricsCollector.recordError('validation', context);

            const exported = metricsCollector.exportMetrics();
            const parsed = JSON.parse(exported);

            assertEquals(typeof exported, 'string');
            assertEquals(typeof parsed.metrics, 'object');
            assertEquals(Array.isArray(parsed.events), true);
            assertEquals(typeof parsed.exportTime, 'string');
            assertEquals(parsed.metrics.totalErrors, 1);
        });
    });

    describe('importMetrics', () => {
        it('should import metrics from JSON string', () => {
            const testData = {
                metrics: {
                    totalErrors: 5,
                    errorsByType: { validation: 3, llm: 2 },
                    errorsByOperation: { op1: 3, op2: 2 },
                    retryAttempts: 2,
                    successfulRetries: 1,
                    failedRetries: 1,
                },
                events: [
                    {
                        id: 'test_event_1',
                        type: 'VALIDATION',
                        severity: 'MEDIUM',
                        operation: 'test_op',
                        timestamp: new Date().toISOString(),
                        resolved: true,
                        retryCount: 0,
                        totalDuration: 100,
                        context: {
                            operation: 'test_op',
                            attemptNumber: 1,
                            timestamp: new Date().toISOString(),
                        },
                    },
                ],
                exportTime: new Date().toISOString(),
            };

            metricsCollector.importMetrics(JSON.stringify(testData));

            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.totalErrors, 5);
            assertEquals(metrics.errorsByType['validation'], 3);
            assertEquals(metrics.errorsByType['llm'], 2);
            assertEquals(metrics.retryAttempts, 2);

            const stats = metricsCollector.getDetailedStats();
            assertEquals(stats.recentEvents.length, 1);
            assertEquals(stats.recentEvents[0].id, 'test_event_1');
        });

        it('should handle invalid JSON gracefully', () => {
            let errorThrown = false;
            try {
                metricsCollector.importMetrics('invalid json');
            } catch (error) {
                errorThrown = true;
                assertInstanceOf(error, Error);
                assert(error.message.includes('Invalid metrics data format'));
            }
            assertEquals(errorThrown, true);
        });
    });

    describe('error recovery rate calculation', () => {
        it('should calculate recovery rate correctly with mixed results', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            // Record some successes and failures
            metricsCollector.recordSuccessfulRetry(context);
            metricsCollector.recordSuccessfulRetry(context);
            metricsCollector.recordFailedRetry(context);
            metricsCollector.recordFallbackSuccess(context);

            const metrics = metricsCollector.getMetrics();
            // 3 successes out of 4 total attempts = 75%
            assertEquals(metrics.errorRecoveryRate, 75);
        });

        it('should handle zero attempts correctly', () => {
            const metrics = metricsCollector.getMetrics();
            assertEquals(metrics.errorRecoveryRate, 0);
        });
    });

    describe('event management', () => {
        it('should limit number of stored events', () => {
            const smallCollector = new ErrorMetricsCollector(logger, 5);
            
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            // Record more events than the limit
            for (let i = 0; i < 10; i++) {
                smallCollector.recordError('validation', {
                    ...context,
                    operation: `operation_${i}`,
                });
            }

            const stats = smallCollector.getDetailedStats();
            assertEquals(stats.recentEvents.length, 5); // Should be limited to 5
        });

        it('should mark events as resolved when resolution is recorded', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const resolution: ErrorResolution = {
                strategy: 'retry',
                message: 'Retrying',
                shouldLog: true,
            };

            metricsCollector.recordError('api', context);
            metricsCollector.recordResolution('api', resolution);

            const stats = metricsCollector.getDetailedStats();
            assertEquals(stats.recentEvents.length, 1);
            assertEquals(stats.recentEvents[0].resolved, true);
            assertEquals(stats.recentEvents[0].resolutionStrategy, 'retry');
        });
    });

    describe('error type mapping', () => {
        it('should map string error types to ErrorType enum', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            metricsCollector.recordError('validation', context);
            metricsCollector.recordError('llm', context);
            metricsCollector.recordError('api', context);
            metricsCollector.recordError('unknown_type', context);

            const stats = metricsCollector.getDetailedStats();
            const eventTypes = stats.recentEvents.map(e => e.type);
            
            assert(eventTypes.includes(ErrorType.VALIDATION));
            assert(eventTypes.includes(ErrorType.LLM_PROVIDER));
            assert(eventTypes.includes(ErrorType.API_REQUEST));
            assert(eventTypes.includes(ErrorType.UNKNOWN));
        });
    });

    describe('severity determination', () => {
        it('should assign appropriate severity levels', () => {
            const context: ErrorContext = {
                operation: 'test_operation',
                attemptNumber: 1,
                timestamp: new Date(),
            };

            const highSeverityContext: ErrorContext = {
                ...context,
                attemptNumber: 5, // High attempt number should increase severity
            };

            metricsCollector.recordError('authentication', context);
            metricsCollector.recordError('network', context);
            metricsCollector.recordError('validation', highSeverityContext);

            const stats = metricsCollector.getDetailedStats();
            const severities = stats.recentEvents.map(e => e.severity);
            
            // Should have different severity levels
            assert(severities.includes(ErrorSeverity.HIGH));
            assert(severities.includes(ErrorSeverity.MEDIUM));
        });
    });
});

describe('createErrorMetricsCollector', () => {
    it('should create ErrorMetricsCollector instance', () => {
        const logger = new Logger('test');
        const collector = createErrorMetricsCollector(logger);
        assertInstanceOf(collector, ErrorMetricsCollector);
    });

    it('should create ErrorMetricsCollector with custom max events', () => {
        const logger = new Logger('test');
        const collector = createErrorMetricsCollector(logger, 500);
        assertInstanceOf(collector, ErrorMetricsCollector);
    });
});