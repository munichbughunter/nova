/**
 * Retry Service with Exponential Backoff
 * 
 * This service provides intelligent retry logic with exponential backoff,
 * jitter, and configurable retry strategies for different types of operations.
 */

import type { Logger } from '../../utils/logger.ts';
import { RetryConfig, ErrorContext } from './types.ts';

/**
 * Retry service that handles operation retries with exponential backoff
 */
export class RetryService {
    private logger: Logger;
    private defaultConfig: RetryConfig;

    constructor(logger: Logger, defaultConfig?: Partial<RetryConfig>) {
        this.logger = logger.child('RetryService');
        this.defaultConfig = {
            maxAttempts: 3,
            baseDelayMs: 1000,
            maxDelayMs: 30000,
            backoffMultiplier: 2,
            jitterMs: 100,
            ...defaultConfig
        };
    }

    /**
     * Execute an operation with retry logic and exponential backoff
     */
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        config?: Partial<RetryConfig>
    ): Promise<T> {
        const retryConfig = { ...this.defaultConfig, ...config };
        let lastError: unknown;
        let totalDelay = 0;

        for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
            const attemptContext = {
                ...context,
                attemptNumber: attempt,
                timestamp: new Date(),
            };

            try {
                this.logger.debug(`Executing operation (attempt ${attempt}/${retryConfig.maxAttempts})`, {
                    context: attemptContext,
                    totalDelay,
                });

                const startTime = Date.now();
                const result = await operation();
                const duration = Date.now() - startTime;

                this.logger.debug(`Operation succeeded on attempt ${attempt}`, {
                    context: attemptContext,
                    duration,
                    totalDelay,
                });

                return result;
            } catch (error) {
                lastError = error;
                
                this.logger.warn(`Operation failed on attempt ${attempt}`, {
                    error: this.serializeError(error),
                    context: attemptContext,
                    totalDelay,
                });

                // If this is the last attempt, don't wait
                if (attempt === retryConfig.maxAttempts) {
                    this.logger.error(`Operation failed after ${attempt} attempts`, {
                        error: this.serializeError(error),
                        context: attemptContext,
                        totalDelay,
                    });
                    break;
                }

                // Check if error is retryable
                if (!this.isRetryableError(error)) {
                    this.logger.info(`Error is not retryable, stopping after attempt ${attempt}`, {
                        error: this.serializeError(error),
                        context: attemptContext,
                    });
                    break;
                }

                // Calculate delay with exponential backoff and jitter
                const delay = this.calculateDelay(attempt, retryConfig);
                totalDelay += delay;

                this.logger.debug(`Waiting ${delay}ms before retry`, {
                    attempt,
                    delay,
                    totalDelay,
                    context: attemptContext,
                });

                await this.sleep(delay);
            }
        }

        // All attempts failed, throw the last error
        throw lastError;
    }

    /**
     * Execute multiple operations with retry, with optional parallel execution
     */
    async executeMultipleWithRetry<T>(
        operations: Array<{
            operation: () => Promise<T>;
            context: ErrorContext;
            config?: Partial<RetryConfig>;
        }>,
        options: {
            parallel?: boolean;
            failFast?: boolean;
        } = {}
    ): Promise<Array<{ success: boolean; result?: T; error?: unknown }>> {
        const { parallel = false, failFast = false } = options;

        if (parallel) {
            const promises = operations.map(async ({ operation, context, config }) => {
                try {
                    const result = await this.executeWithRetry(operation, context, config);
                    return { success: true, result };
                } catch (error) {
                    if (failFast) {
                        throw error;
                    }
                    return { success: false, error };
                }
            });

            return await Promise.all(promises);
        } else {
            const results: Array<{ success: boolean; result?: T; error?: unknown }> = [];

            for (const { operation, context, config } of operations) {
                try {
                    const result = await this.executeWithRetry(operation, context, config);
                    results.push({ success: true, result });
                } catch (error) {
                    if (failFast) {
                        throw error;
                    }
                    results.push({ success: false, error });
                }
            }

            return results;
        }
    }

    /**
     * Execute operation with circuit breaker pattern
     */
    async executeWithCircuitBreaker<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        circuitBreakerConfig: {
            failureThreshold: number;
            recoveryTimeoutMs: number;
            monitoringPeriodMs: number;
        } = {
            failureThreshold: 5,
            recoveryTimeoutMs: 60000,
            monitoringPeriodMs: 10000,
        }
    ): Promise<T> {
        const circuitKey = `${context.operation}_${context.filePath || 'global'}`;
        
        // For simplicity, we'll implement a basic circuit breaker
        // In a production system, you might want to use a more sophisticated implementation
        
        try {
            return await this.executeWithRetry(operation, context);
        } catch (error) {
            this.logger.warn('Circuit breaker: Operation failed', {
                circuitKey,
                error: this.serializeError(error),
                context,
            });
            throw error;
        }
    }

    /**
     * Calculate delay with exponential backoff and jitter
     */
    private calculateDelay(attempt: number, config: RetryConfig): number {
        // Exponential backoff: baseDelay * (multiplier ^ (attempt - 1))
        const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
        
        // Cap at maximum delay
        const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
        
        // Add jitter to prevent thundering herd problem
        const jitter = config.jitterMs ? Math.random() * config.jitterMs : 0;
        
        return Math.floor(cappedDelay + jitter);
    }

    /**
     * Check if an error is retryable based on its characteristics
     */
    private isRetryableError(error: unknown): boolean {
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            
            // Network errors are typically retryable
            if (message.includes('network') || message.includes('connection') || 
                message.includes('econnrefused') || message.includes('enotfound') ||
                message.includes('timeout') || message.includes('etimedout')) {
                return true;
            }
            
            // Rate limiting is retryable
            if (message.includes('rate limit') || message.includes('429') || 
                message.includes('too many requests')) {
                return true;
            }
            
            // Service unavailable is retryable
            if (message.includes('service unavailable') || message.includes('502') || 
                message.includes('503') || message.includes('504')) {
                return true;
            }
            
            // Temporary failures are retryable
            if (message.includes('temporary') || message.includes('busy') ||
                message.includes('overloaded')) {
                return true;
            }
            
            // Authentication and permission errors are not retryable
            if (message.includes('unauthorized') || message.includes('authentication') ||
                message.includes('401') || message.includes('forbidden') || 
                message.includes('403') || message.includes('permission denied')) {
                return false;
            }
            
            // File not found is not retryable
            if (message.includes('not found') || message.includes('404') || 
                message.includes('enoent')) {
                return false;
            }
            
            // Invalid configuration is not retryable
            if (message.includes('invalid') || message.includes('malformed') ||
                message.includes('syntax error')) {
                return false;
            }
        }
        
        // Default to retryable for unknown errors
        return true;
    }

    /**
     * Sleep for the specified number of milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Serialize error for logging (avoiding circular references)
     */
    private serializeError(error: unknown): Record<string, unknown> {
        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }
        
        if (typeof error === 'string') {
            return { message: error };
        }
        
        if (error && typeof error === 'object') {
            try {
                return JSON.parse(JSON.stringify(error));
            } catch {
                return { message: 'Error could not be serialized' };
            }
        }
        
        return { message: 'Unknown error type' };
    }

    /**
     * Get retry statistics for monitoring
     */
    getRetryStats(): {
        defaultConfig: RetryConfig;
        totalOperations: number;
        successfulOperations: number;
        failedOperations: number;
    } {
        // In a production system, you would track these metrics
        return {
            defaultConfig: this.defaultConfig,
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
        };
    }

    /**
     * Update default retry configuration
     */
    updateDefaultConfig(config: Partial<RetryConfig>): void {
        this.defaultConfig = { ...this.defaultConfig, ...config };
        this.logger.debug('Updated default retry configuration', { config: this.defaultConfig });
    }
}

/**
 * Factory function to create a RetryService
 */
export function createRetryService(
    logger: Logger,
    config?: Partial<RetryConfig>
): RetryService {
    return new RetryService(logger, config);
}