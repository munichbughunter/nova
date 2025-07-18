/**
 * Comprehensive Error Handling Service
 * 
 * This service provides a centralized error handling framework with strategy pattern
 * for different error types, retry logic with exponential backoff, graceful degradation,
 * error context tracking, and metrics collection.
 */

import type { Logger } from '../../utils/logger.ts';
import { RetryService } from './retry.service.ts';
import { ErrorMetricsCollector } from './metrics.service.ts';
import { ErrorContext, ErrorResolution, ErrorStrategy, ErrorHandlerConfig } from './types.ts';

/**
 * Main Error Handling Service that coordinates all error handling strategies
 */
export class ErrorHandlingService {
    private logger: Logger;
    private retryService: RetryService;
    private metricsCollector: ErrorMetricsCollector;
    private strategies: Map<string, ErrorStrategy> = new Map();
    private config: ErrorHandlerConfig;

    constructor(
        logger: Logger,
        config: Partial<ErrorHandlerConfig> = {}
    ) {
        this.logger = logger.child('ErrorHandlingService');
        this.config = {
            enableMetrics: true,
            enableRetry: true,
            enableGracefulDegradation: true,
            maxRetryAttempts: 3,
            baseRetryDelayMs: 1000,
            maxRetryDelayMs: 30000,
            retryBackoffMultiplier: 2,
            ...config
        };

        this.retryService = new RetryService(this.logger, {
            maxAttempts: this.config.maxRetryAttempts,
            baseDelayMs: this.config.baseRetryDelayMs,
            maxDelayMs: this.config.maxRetryDelayMs,
            backoffMultiplier: this.config.retryBackoffMultiplier,
        });

        this.metricsCollector = new ErrorMetricsCollector(this.logger);
        this.initializeDefaultStrategies();
    }

    /**
     * Handle validation errors with transformation and recovery strategies
     */
    async handleValidationError(
        error: unknown,
        context: ErrorContext
    ): Promise<ErrorResolution> {
        const enhancedContext = {
            ...context,
            operation: context.operation || 'validation',
            errorType: 'validation',
            timestamp: new Date(),
        };

        this.logger.debug('Handling validation error', { error, context: enhancedContext });
        
        if (this.config.enableMetrics) {
            this.metricsCollector.recordError('validation', enhancedContext);
        }

        const strategy = this.strategies.get('validation');
        if (strategy) {
            try {
                const resolution = await strategy.handle(error, enhancedContext);
                
                if (this.config.enableMetrics) {
                    this.metricsCollector.recordResolution('validation', resolution);
                }
                
                return resolution;
            } catch (strategyError) {
                this.logger.error('Validation strategy failed', { 
                    originalError: error, 
                    strategyError,
                    context: enhancedContext 
                });
            }
        }

        // Fallback resolution
        return {
            strategy: 'fallback',
            message: 'Validation failed, using fallback processing',
            shouldLog: true,
            data: null,
        };
    }

    /**
     * Handle LLM provider errors with retry and fallback strategies
     */
    async handleLLMError(
        error: unknown,
        context: ErrorContext
    ): Promise<ErrorResolution> {
        const enhancedContext = {
            ...context,
            operation: context.operation || 'llm_request',
            errorType: 'llm',
            timestamp: new Date(),
        };

        this.logger.debug('Handling LLM error', { error, context: enhancedContext });
        
        if (this.config.enableMetrics) {
            this.metricsCollector.recordError('llm', enhancedContext);
        }

        const strategy = this.strategies.get('llm');
        if (strategy) {
            try {
                const resolution = await strategy.handle(error, enhancedContext);
                
                if (this.config.enableMetrics) {
                    this.metricsCollector.recordResolution('llm', resolution);
                }
                
                return resolution;
            } catch (strategyError) {
                this.logger.error('LLM strategy failed', { 
                    originalError: error, 
                    strategyError,
                    context: enhancedContext 
                });
            }
        }

        // Fallback to rule-based analysis
        return {
            strategy: 'fallback',
            message: 'LLM provider unavailable, falling back to rule-based analysis',
            shouldLog: true,
            data: null,
        };
    }

    /**
     * Handle API errors with retry logic and exponential backoff
     */
    async handleAPIError(
        error: unknown,
        context: ErrorContext
    ): Promise<ErrorResolution> {
        const enhancedContext = {
            ...context,
            operation: context.operation || 'api_request',
            errorType: 'api',
            timestamp: new Date(),
        };

        this.logger.debug('Handling API error', { error, context: enhancedContext });
        
        if (this.config.enableMetrics) {
            this.metricsCollector.recordError('api', enhancedContext);
        }

        const strategy = this.strategies.get('api');
        if (strategy) {
            try {
                const resolution = await strategy.handle(error, enhancedContext);
                
                if (this.config.enableMetrics) {
                    this.metricsCollector.recordResolution('api', resolution);
                }
                
                return resolution;
            } catch (strategyError) {
                this.logger.error('API strategy failed', { 
                    originalError: error, 
                    strategyError,
                    context: enhancedContext 
                });
            }
        }

        // Default retry resolution for API errors
        return {
            strategy: 'retry',
            message: 'API request failed, will retry',
            shouldLog: true,
            retryAfter: this.calculateRetryDelay(context.attemptNumber || 1),
        };
    }

    /**
     * Execute operation with comprehensive error handling
     */
    async executeWithErrorHandling<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        options: {
            enableRetry?: boolean;
            enableFallback?: boolean;
            fallbackOperation?: () => Promise<T>;
            maxAttempts?: number;
        } = {}
    ): Promise<T> {
        const {
            enableRetry = this.config.enableRetry,
            enableFallback = this.config.enableGracefulDegradation,
            fallbackOperation,
            maxAttempts = this.config.maxRetryAttempts,
        } = options;

        const enhancedContext = {
            ...context,
            timestamp: new Date(),
        };

        try {
            if (enableRetry) {
                return await this.retryService.executeWithRetry(
                    operation,
                    enhancedContext,
                    { maxAttempts }
                );
            } else {
                return await operation();
            }
        } catch (error) {
            this.logger.warn('Operation failed', { 
                error, 
                context: enhancedContext,
                retriesEnabled: enableRetry
            });

            if (enableFallback && fallbackOperation) {
                this.logger.info('Attempting fallback operation', { context: enhancedContext });
                
                try {
                    const result = await fallbackOperation();
                    
                    if (this.config.enableMetrics) {
                        this.metricsCollector.recordFallbackSuccess(enhancedContext);
                    }
                    
                    return result;
                } catch (fallbackError) {
                    this.logger.error('Fallback operation also failed', { 
                        originalError: error,
                        fallbackError,
                        context: enhancedContext 
                    });
                    
                    if (this.config.enableMetrics) {
                        this.metricsCollector.recordFallbackFailure(enhancedContext);
                    }
                    
                    throw error; // Throw original error
                }
            }
            
            throw error;
        }
    }

    /**
     * Register a custom error handling strategy
     */
    registerErrorHandler(type: string, strategy: ErrorStrategy): void {
        this.logger.debug(`Registering error handler for type: ${type}`);
        this.strategies.set(type, strategy);
    }

    /**
     * Get error metrics and statistics
     */
    getErrorMetrics() {
        return this.metricsCollector.getMetrics();
    }

    /**
     * Reset error metrics
     */
    resetMetrics(): void {
        this.metricsCollector.reset();
    }

    /**
     * Check if an error is retryable based on its characteristics
     */
    isRetryable(error: unknown): boolean {
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            
            // Network errors are retryable
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
        }
        
        // Default to retryable for unknown errors
        return true;
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    private calculateRetryDelay(attemptNumber: number): number {
        const baseDelay = this.config.baseRetryDelayMs;
        const maxDelay = this.config.maxRetryDelayMs;
        const multiplier = this.config.retryBackoffMultiplier;
        
        const delay = Math.min(
            baseDelay * Math.pow(multiplier, attemptNumber - 1),
            maxDelay
        );
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.1 * delay;
        return Math.floor(delay + jitter);
    }

    /**
     * Initialize default error handling strategies
     */
    private initializeDefaultStrategies(): void {
        // Validation error strategy
        this.strategies.set('validation', {
            handle: async (error: unknown, context: ErrorContext): Promise<ErrorResolution> => {
                this.logger.debug('Applying validation error strategy', { error, context });
                
                // Try to extract useful information from validation errors
                if (error && typeof error === 'object' && 'issues' in error) {
                    const zodError = error as { issues: Array<{ path: string[]; message: string }> };
                    const issues = zodError.issues.map(issue => ({
                        path: issue.path.join('.'),
                        message: issue.message
                    }));
                    
                    return {
                        strategy: 'transform',
                        message: `Validation failed for fields: ${issues.map(i => i.path).join(', ')}`,
                        shouldLog: true,
                        data: { validationIssues: issues },
                    };
                }
                
                return {
                    strategy: 'fallback',
                    message: 'Validation failed, using default values',
                    shouldLog: true,
                    data: null,
                };
            }
        });

        // LLM error strategy
        this.strategies.set('llm', {
            handle: async (error: unknown, context: ErrorContext): Promise<ErrorResolution> => {
                this.logger.debug('Applying LLM error strategy', { error, context });
                
                if (this.isRetryable(error)) {
                    return {
                        strategy: 'retry',
                        message: 'LLM request failed, will retry',
                        shouldLog: true,
                        retryAfter: this.calculateRetryDelay(context.attemptNumber || 1),
                    };
                }
                
                return {
                    strategy: 'fallback',
                    message: 'LLM provider unavailable, using rule-based analysis',
                    shouldLog: true,
                    data: null,
                };
            }
        });

        // API error strategy
        this.strategies.set('api', {
            handle: async (error: unknown, context: ErrorContext): Promise<ErrorResolution> => {
                this.logger.debug('Applying API error strategy', { error, context });
                
                if (this.isRetryable(error)) {
                    const retryDelay = this.calculateRetryDelay(context.attemptNumber || 1);
                    
                    return {
                        strategy: 'retry',
                        message: `API request failed, retrying in ${retryDelay}ms`,
                        shouldLog: true,
                        retryAfter: retryDelay,
                    };
                }
                
                return {
                    strategy: 'fail',
                    message: 'API request failed with non-retryable error',
                    shouldLog: true,
                    data: null,
                };
            }
        });
    }
}

/**
 * Factory function to create an ErrorHandlingService
 */
export function createErrorHandlingService(
    logger: Logger,
    config?: Partial<ErrorHandlerConfig>
): ErrorHandlingService {
    return new ErrorHandlingService(logger, config);
}