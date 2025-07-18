/**
 * Comprehensive error handling and retry logic for the Enhanced Code Review Agent
 * 
 * This module provides structured error handling, retry mechanisms with exponential backoff,
 * and graceful degradation for various failure scenarios.
 */

import type { Logger } from '../utils/logger.ts';

/**
 * Enumeration of specific error types for the review system
 */
export enum ReviewErrorType {
    REPOSITORY_NOT_DETECTED = 'REPOSITORY_NOT_DETECTED',
    AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
    API_RATE_LIMITED = 'API_RATE_LIMITED',
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    ANALYSIS_FAILED = 'ANALYSIS_FAILED',
    COMMENT_POST_FAILED = 'COMMENT_POST_FAILED',
    NETWORK_ERROR = 'NETWORK_ERROR',
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    TIMEOUT_ERROR = 'TIMEOUT_ERROR',
    INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
    GIT_OPERATION_FAILED = 'GIT_OPERATION_FAILED',
    LLM_PROVIDER_ERROR = 'LLM_PROVIDER_ERROR',
}

/**
 * Custom error class for review operations with specific error types and context
 */
export class ReviewError extends Error {
    public readonly type: ReviewErrorType;
    public readonly details: Record<string, unknown>;
    public readonly timestamp: Date;
    public readonly retryable: boolean;
    public readonly userGuidance?: string;

    constructor(
        type: ReviewErrorType,
        message: string,
        details: Record<string, unknown> = {},
        retryable: boolean = false,
        userGuidance?: string
    ) {
        super(message);
        this.name = 'ReviewError';
        this.type = type;
        this.details = details;
        this.timestamp = new Date();
        this.retryable = retryable;
        this.userGuidance = userGuidance;

        // Maintain proper stack trace for V8
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ReviewError);
        }
    }

    /**
     * Create a user-friendly error message with guidance
     */
    toUserMessage(): string {
        const baseMessage = this.message;
        const guidance = this.userGuidance ? `\n\n💡 ${this.userGuidance}` : '';
        return `${baseMessage}${guidance}`;
    }

    /**
     * Convert error to JSON for logging
     */
    toJSON(): Record<string, unknown> {
        return {
            type: this.type,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp.toISOString(),
            retryable: this.retryable,
            userGuidance: this.userGuidance,
            stack: this.stack,
        };
    }
}

/**
 * Configuration for retry operations
 */
export interface RetryConfig {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterMs?: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterMs: 100,
};

/**
 * Retry configuration for different error types
 */
export const RETRY_CONFIGS: Record<ReviewErrorType, RetryConfig | null> = {
    [ReviewErrorType.REPOSITORY_NOT_DETECTED]: null, // Not retryable
    [ReviewErrorType.AUTHENTICATION_FAILED]: null, // Not retryable
    [ReviewErrorType.API_RATE_LIMITED]: {
        maxAttempts: 5,
        baseDelayMs: 5000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterMs: 1000,
    },
    [ReviewErrorType.FILE_NOT_FOUND]: null, // Not retryable
    [ReviewErrorType.ANALYSIS_FAILED]: {
        maxAttempts: 2,
        baseDelayMs: 2000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterMs: 500,
    },
    [ReviewErrorType.COMMENT_POST_FAILED]: {
        maxAttempts: 3,
        baseDelayMs: 2000,
        maxDelayMs: 15000,
        backoffMultiplier: 2,
        jitterMs: 500,
    },
    [ReviewErrorType.NETWORK_ERROR]: {
        maxAttempts: 4,
        baseDelayMs: 1000,
        maxDelayMs: 20000,
        backoffMultiplier: 2,
        jitterMs: 200,
    },
    [ReviewErrorType.PERMISSION_DENIED]: null, // Not retryable
    [ReviewErrorType.SERVICE_UNAVAILABLE]: {
        maxAttempts: 3,
        baseDelayMs: 5000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterMs: 1000,
    },
    [ReviewErrorType.TIMEOUT_ERROR]: {
        maxAttempts: 2,
        baseDelayMs: 3000,
        maxDelayMs: 15000,
        backoffMultiplier: 2,
        jitterMs: 500,
    },
    [ReviewErrorType.INVALID_CONFIGURATION]: null, // Not retryable
    [ReviewErrorType.GIT_OPERATION_FAILED]: {
        maxAttempts: 2,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterMs: 200,
    },
    [ReviewErrorType.LLM_PROVIDER_ERROR]: {
        maxAttempts: 3,
        baseDelayMs: 2000,
        maxDelayMs: 15000,
        backoffMultiplier: 2,
        jitterMs: 500,
    },
};

/**
 * User guidance messages for different error types
 */
export const ERROR_GUIDANCE: Record<ReviewErrorType, string> = {
    [ReviewErrorType.REPOSITORY_NOT_DETECTED]: 
        'Ensure you are in a Git repository with a configured remote (GitLab or GitHub). Run `git remote -v` to check your remotes.',
    [ReviewErrorType.AUTHENTICATION_FAILED]: 
        'Check your authentication credentials. For GitLab, verify your access token. For GitHub, ensure your token has the required permissions.',
    [ReviewErrorType.API_RATE_LIMITED]: 
        'API rate limit exceeded. Please wait a few minutes before trying again. Consider using a personal access token for higher rate limits.',
    [ReviewErrorType.FILE_NOT_FOUND]: 
        'The specified file could not be found. Check the file path and ensure the file exists in the repository.',
    [ReviewErrorType.ANALYSIS_FAILED]: 
        'Code analysis failed. This might be due to unsupported file format or LLM provider issues. Try again or check the file content.',
    [ReviewErrorType.COMMENT_POST_FAILED]: 
        'Failed to post review comments. Check your permissions and network connection. Comments will be displayed locally instead.',
    [ReviewErrorType.NETWORK_ERROR]: 
        'Network connection failed. Check your internet connection and try again.',
    [ReviewErrorType.PERMISSION_DENIED]: 
        'Insufficient permissions to access the repository or perform the operation. Check your access token permissions.',
    [ReviewErrorType.SERVICE_UNAVAILABLE]: 
        'The service is temporarily unavailable. Please try again later.',
    [ReviewErrorType.TIMEOUT_ERROR]: 
        'Operation timed out. Try again with a smaller scope or check your network connection.',
    [ReviewErrorType.INVALID_CONFIGURATION]: 
        'Configuration is invalid or missing. Check your Nova configuration file and ensure all required settings are present.',
    [ReviewErrorType.GIT_OPERATION_FAILED]: 
        'Git operation failed. Ensure you are in a valid Git repository and have the necessary permissions.',
    [ReviewErrorType.LLM_PROVIDER_ERROR]: 
        'LLM provider error. Check your API configuration and try again. The service might be temporarily unavailable.',
};

/**
 * Comprehensive error handler for review operations
 */
export class ReviewErrorHandler {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child('ReviewErrorHandler');
    }

    /**
     * Create a ReviewError from a generic error
     */
    createReviewError(
        error: unknown,
        type: ReviewErrorType,
        context: Record<string, unknown> = {}
    ): ReviewError {
        let message: string;
        let details: Record<string, unknown> = { ...context };

        if (error instanceof Error) {
            message = error.message;
            details.originalError = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        } else if (typeof error === 'string') {
            message = error;
        } else {
            message = 'Unknown error occurred';
            details.originalError = error;
        }

        const retryable = RETRY_CONFIGS[type] !== null;
        const userGuidance = ERROR_GUIDANCE[type];

        return new ReviewError(type, message, details, retryable, userGuidance);
    }

    /**
     * Handle and classify errors based on their characteristics
     */
    handleError(error: unknown, context: Record<string, unknown> = {}): ReviewError {
        // If it's already a ReviewError, return it
        if (error instanceof ReviewError) {
            return error;
        }

        // Classify error based on message and type
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            
            // Network-related errors
            if (message.includes('network') || message.includes('connection') || 
                message.includes('econnrefused') || message.includes('enotfound')) {
                return this.createReviewError(error, ReviewErrorType.NETWORK_ERROR, context);
            }
            
            // Authentication errors
            if (message.includes('unauthorized') || message.includes('authentication') ||
                message.includes('401') || message.includes('forbidden') || message.includes('403')) {
                const type = message.includes('403') || message.includes('forbidden') 
                    ? ReviewErrorType.PERMISSION_DENIED 
                    : ReviewErrorType.AUTHENTICATION_FAILED;
                return this.createReviewError(error, type, context);
            }
            
            // Rate limiting
            if (message.includes('rate limit') || message.includes('429') || 
                message.includes('too many requests')) {
                return this.createReviewError(error, ReviewErrorType.API_RATE_LIMITED, context);
            }
            
            // File not found
            if (message.includes('not found') || message.includes('404') || 
                message.includes('enoent')) {
                return this.createReviewError(error, ReviewErrorType.FILE_NOT_FOUND, context);
            }
            
            // Timeout errors
            if (message.includes('timeout') || message.includes('etimedout')) {
                return this.createReviewError(error, ReviewErrorType.TIMEOUT_ERROR, context);
            }
            
            // Service unavailable
            if (message.includes('service unavailable') || message.includes('502') || 
                message.includes('503') || message.includes('504')) {
                return this.createReviewError(error, ReviewErrorType.SERVICE_UNAVAILABLE, context);
            }
            
            // Git-related errors
            if (message.includes('git') || message.includes('repository') || 
                message.includes('not a git repository')) {
                return this.createReviewError(error, ReviewErrorType.GIT_OPERATION_FAILED, context);
            }
        }

        // Default to analysis failed for unclassified errors
        return this.createReviewError(error, ReviewErrorType.ANALYSIS_FAILED, context);
    }

    /**
     * Execute an operation with retry logic and exponential backoff
     */
    async withRetry<T>(
        operation: () => Promise<T>,
        errorType: ReviewErrorType,
        context: Record<string, unknown> = {},
        customConfig?: Partial<RetryConfig>
    ): Promise<T> {
        const retryConfig = RETRY_CONFIGS[errorType];
        
        if (!retryConfig) {
            // Not retryable, execute once
            try {
                return await operation();
            } catch (error) {
                throw this.handleError(error, context);
            }
        }

        const config = { ...retryConfig, ...customConfig };
        let lastError: unknown;

        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                this.logger.debug(`Executing operation (attempt ${attempt}/${config.maxAttempts})`, context);
                return await operation();
            } catch (error) {
                lastError = error;
                const reviewError = this.handleError(error, { ...context, attempt });
                
                this.logger.warn(`Operation failed on attempt ${attempt}`, {
                    error: reviewError.toJSON(),
                    context,
                });

                // If this is the last attempt, throw the error
                if (attempt === config.maxAttempts) {
                    throw reviewError;
                }

                // Calculate delay with exponential backoff and jitter
                const baseDelay = Math.min(
                    config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
                    config.maxDelayMs
                );
                
                const jitter = config.jitterMs ? Math.random() * config.jitterMs : 0;
                const delay = baseDelay + jitter;

                this.logger.debug(`Waiting ${delay}ms before retry`, { attempt, delay });
                await this.sleep(delay);
            }
        }

        // This should never be reached, but just in case
        throw this.handleError(lastError, context);
    }

    /**
     * Execute an operation with graceful degradation
     */
    async withGracefulDegradation<T, F>(
        primaryOperation: () => Promise<T>,
        fallbackOperation: () => Promise<F>,
        errorType: ReviewErrorType,
        context: Record<string, unknown> = {}
    ): Promise<T | F> {
        try {
            return await this.withRetry(primaryOperation, errorType, context);
        } catch (error) {
            this.logger.warn('Primary operation failed, falling back to degraded mode', {
                error: error instanceof ReviewError ? error.toJSON() : error,
                context,
            });

            try {
                return await fallbackOperation();
            } catch (fallbackError) {
                this.logger.error('Fallback operation also failed', {
                    primaryError: error instanceof ReviewError ? error.toJSON() : error,
                    fallbackError: fallbackError instanceof ReviewError ? fallbackError.toJSON() : fallbackError,
                    context,
                });
                
                // Throw the original error since fallback also failed
                throw error;
            }
        }
    }

    /**
     * Sleep for the specified number of milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if an error is retryable
     */
    isRetryable(error: ReviewError): boolean {
        return error.retryable && RETRY_CONFIGS[error.type] !== null;
    }

    /**
     * Get retry configuration for an error type
     */
    getRetryConfig(errorType: ReviewErrorType): RetryConfig | null {
        return RETRY_CONFIGS[errorType];
    }

    /**
     * Get user guidance for an error type
     */
    getUserGuidance(errorType: ReviewErrorType): string {
        return ERROR_GUIDANCE[errorType];
    }
}

/**
 * Factory function to create a ReviewErrorHandler
 */
export function createReviewErrorHandler(logger: Logger): ReviewErrorHandler {
    return new ReviewErrorHandler(logger);
}

/**
 * Utility function to check if an error is a specific ReviewError type
 */
export function isReviewError(error: unknown, type?: ReviewErrorType): error is ReviewError {
    if (!(error instanceof ReviewError)) {
        return false;
    }
    
    return type ? error.type === type : true;
}

/**
 * Utility function to extract user-friendly message from any error
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof ReviewError) {
        return error.toUserMessage();
    }
    
    if (error instanceof Error) {
        return error.message;
    }
    
    if (typeof error === 'string') {
        return error;
    }
    
    return 'An unknown error occurred';
}