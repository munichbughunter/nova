/**
 * Type-safe error handling with proper error types and comprehensive error classification
 */

import { z } from 'zod';
import type { 
    ErrorContext, 
    ErrorResolution, 
    EnhancedError,
    ValidationErrorDetails,
    LLMProviderErrorDetails,
    APIErrorDetails,
    NetworkErrorDetails,
    FileErrorDetails,
    GitErrorDetails
} from './types.ts';
import { ErrorType, ErrorSeverity } from './types.ts';

/**
 * Base error class with type safety
 */
export abstract class TypedError extends Error {
    abstract readonly type: ErrorType;
    abstract readonly severity: ErrorSeverity;
    abstract readonly retryable: boolean;
    
    public readonly timestamp: Date;
    public readonly context?: ErrorContext;
    public readonly userGuidance?: string;

    constructor(
        message: string,
        context?: ErrorContext,
        userGuidance?: string
    ) {
        super(message);
        this.name = this.constructor.name;
        this.timestamp = new Date();
        this.context = context;
        this.userGuidance = userGuidance;
        
        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Convert to enhanced error format
     */
    toEnhancedError(): EnhancedError {
        return {
            type: this.type,
            severity: this.severity,
            message: this.message,
            originalError: this,
            context: this.context || {
                operation: 'unknown',
                attemptNumber: 1,
                timestamp: this.timestamp,
            },
            retryable: this.retryable,
            userGuidance: this.userGuidance,
            timestamp: this.timestamp,
        };
    }

    /**
     * Check if error should be retried
     */
    shouldRetry(attemptNumber: number, maxAttempts: number): boolean {
        return this.retryable && attemptNumber < maxAttempts;
    }

    /**
     * Get suggested retry delay in milliseconds
     */
    getRetryDelay(attemptNumber: number): number {
        if (!this.retryable) return 0;
        
        // Exponential backoff with jitter
        const baseDelay = 1000; // 1 second
        const maxDelay = 30000; // 30 seconds
        const delay = Math.min(baseDelay * Math.pow(2, attemptNumber - 1), maxDelay);
        const jitter = Math.random() * 0.1 * delay; // 10% jitter
        
        return Math.round(delay + jitter);
    }
}

/**
 * Validation errors
 */
export class ValidationError extends TypedError {
    readonly type = ErrorType.VALIDATION;
    readonly severity = ErrorSeverity.MEDIUM;
    readonly retryable = false;

    constructor(
        message: string,
        public readonly details: ValidationErrorDetails,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            `Please check the ${details.field} field. Expected ${details.expectedType} but got ${details.actualType}.`
        );
    }

    static fromZodError(
        error: z.ZodError,
        context?: ErrorContext
    ): ValidationError[] {
        return error.errors.map(issue => {
            const field = issue.path.join('.');
            const details: ValidationErrorDetails = {
                field: field || 'root',
                expectedType: (issue as any).expected || 'unknown',
                actualType: typeof (issue as any).received || 'unknown',
                value: (issue as any).received,
                message: issue.message,
            };

            return new ValidationError(
                `Validation failed for field '${field}': ${issue.message}`,
                details,
                context
            );
        });
    }
}

/**
 * LLM Provider errors
 */
export class LLMProviderError extends TypedError {
    readonly type = ErrorType.LLM_PROVIDER;
    readonly retryable: boolean;
    private _severity: ErrorSeverity;

    constructor(
        message: string,
        public readonly details: LLMProviderErrorDetails,
        context?: ErrorContext,
        retryable: boolean = true
    ) {
        super(message, context, LLMProviderError.getUserGuidance(details));
        this.retryable = retryable;
        this._severity = details.statusCode && details.statusCode >= 500 
            ? ErrorSeverity.HIGH 
            : ErrorSeverity.MEDIUM;
    }

    get severity(): ErrorSeverity {
        return this._severity;
    }

    private static getUserGuidance(details: LLMProviderErrorDetails): string {
        if (details.statusCode === 401) {
            return 'Please check your API key configuration.';
        }
        if (details.statusCode === 429) {
            return 'Rate limit exceeded. Please wait before retrying.';
        }
        if (details.statusCode && details.statusCode >= 500) {
            return 'The LLM service is temporarily unavailable. Please try again later.';
        }
        return 'There was an issue with the LLM provider. Please check your configuration.';
    }

    override getRetryDelay(attemptNumber: number): number {
        // Special handling for rate limits
        if (this.details.rateLimitInfo?.resetTime) {
            const resetTime = this.details.rateLimitInfo.resetTime.getTime();
            const now = Date.now();
            const waitTime = Math.max(0, resetTime - now);
            return Math.min(waitTime, 60000); // Max 1 minute wait
        }

        return super.getRetryDelay(attemptNumber);
    }
}

/**
 * API errors
 */
export class APIError extends TypedError {
    readonly type = ErrorType.API_REQUEST;
    readonly retryable: boolean;
    private _severity: ErrorSeverity;

    constructor(
        message: string,
        public readonly details: APIErrorDetails,
        context?: ErrorContext
    ) {
        super(message, context, APIError.getUserGuidance(details));
        this._severity = APIError.getSeverity(details.statusCode);
        this.retryable = APIError.isRetryable(details.statusCode);
    }

    get severity(): ErrorSeverity {
        return this._severity;
    }

    private static getSeverity(statusCode?: number): ErrorSeverity {
        if (!statusCode) return ErrorSeverity.MEDIUM;
        if (statusCode >= 500) return ErrorSeverity.HIGH;
        if (statusCode >= 400) return ErrorSeverity.MEDIUM;
        return ErrorSeverity.LOW;
    }

    private static isRetryable(statusCode?: number): boolean {
        if (!statusCode) return true;
        // Retry on server errors and rate limits, but not client errors
        return statusCode >= 500 || statusCode === 429 || statusCode === 408;
    }

    private static getUserGuidance(details: APIErrorDetails): string {
        const { statusCode, endpoint } = details;
        
        if (statusCode === 401) {
            return 'Authentication failed. Please check your credentials.';
        }
        if (statusCode === 403) {
            return 'Access denied. Please check your permissions.';
        }
        if (statusCode === 404) {
            return `The requested resource at ${endpoint} was not found.`;
        }
        if (statusCode === 429) {
            return 'Too many requests. Please wait before retrying.';
        }
        if (statusCode && statusCode >= 500) {
            return 'The server is experiencing issues. Please try again later.';
        }
        
        return 'An API error occurred. Please check your request and try again.';
    }
}

/**
 * Network errors
 */
export class NetworkError extends TypedError {
    readonly type = ErrorType.NETWORK;
    readonly severity = ErrorSeverity.HIGH;
    readonly retryable = true;

    constructor(
        message: string,
        public readonly details: NetworkErrorDetails,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            'Network connection failed. Please check your internet connection and try again.'
        );
    }

    override getRetryDelay(attemptNumber: number): number {
        // Longer delays for network errors
        const baseDelay = 2000; // 2 seconds
        const maxDelay = 60000; // 1 minute
        const delay = Math.min(baseDelay * Math.pow(2, attemptNumber - 1), maxDelay);
        const jitter = Math.random() * 0.2 * delay; // 20% jitter
        
        return Math.round(delay + jitter);
    }
}

/**
 * Authentication errors
 */
export class AuthenticationError extends TypedError {
    readonly type = ErrorType.AUTHENTICATION;
    readonly severity = ErrorSeverity.HIGH;
    readonly retryable = false;

    constructor(
        message: string,
        public readonly service: string,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            `Authentication failed for ${service}. Please check your credentials and configuration.`
        );
    }
}

/**
 * Permission errors
 */
export class PermissionError extends TypedError {
    readonly type = ErrorType.PERMISSION;
    readonly severity = ErrorSeverity.MEDIUM;
    readonly retryable = false;

    constructor(
        message: string,
        public readonly resource: string,
        public readonly requiredPermission: string,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            `Access denied to ${resource}. Required permission: ${requiredPermission}.`
        );
    }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends TypedError {
    readonly type = ErrorType.RATE_LIMIT;
    readonly severity = ErrorSeverity.MEDIUM;
    readonly retryable = true;

    constructor(
        message: string,
        public readonly resetTime?: Date,
        public readonly limit?: number,
        public readonly remaining?: number,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            RateLimitError.getUserGuidance(resetTime, remaining)
        );
    }

    private static getUserGuidance(resetTime?: Date, remaining?: number): string {
        if (resetTime) {
            const waitMinutes = Math.ceil((resetTime.getTime() - Date.now()) / 60000);
            return `Rate limit exceeded. Please wait ${waitMinutes} minutes before retrying.`;
        }
        if (remaining === 0) {
            return 'Rate limit exceeded. Please wait before making more requests.';
        }
        return 'Rate limit exceeded. Please reduce the frequency of your requests.';
    }

    override getRetryDelay(attemptNumber: number): number {
        if (this.resetTime) {
            const resetTime = this.resetTime.getTime();
            const now = Date.now();
            const waitTime = Math.max(0, resetTime - now);
            return Math.min(waitTime, 300000); // Max 5 minutes wait
        }

        return super.getRetryDelay(attemptNumber);
    }
}

/**
 * File operation errors
 */
export class FileError extends TypedError {
    readonly type = ErrorType.FILE_NOT_FOUND;
    readonly severity = ErrorSeverity.MEDIUM;
    readonly retryable: boolean;

    constructor(
        message: string,
        public readonly details: FileErrorDetails,
        context?: ErrorContext
    ) {
        const retryable = details.operation === 'read' || details.operation === 'access';
        
        super(
            message,
            context,
            FileError.getUserGuidance(details)
        );
        this.retryable = retryable;
    }

    private static getUserGuidance(details: FileErrorDetails): string {
        const { filePath, operation } = details;
        
        switch (operation) {
            case 'read':
                return `Cannot read file '${filePath}'. Please check if the file exists and you have read permissions.`;
            case 'write':
                return `Cannot write to file '${filePath}'. Please check if you have write permissions.`;
            case 'delete':
                return `Cannot delete file '${filePath}'. Please check if the file exists and you have delete permissions.`;
            case 'create':
                return `Cannot create file '${filePath}'. Please check if the directory exists and you have write permissions.`;
            case 'access':
                return `Cannot access file '${filePath}'. Please check if the file exists and you have the required permissions.`;
            default:
                return `File operation failed for '${filePath}'.`;
        }
    }
}

/**
 * Timeout errors
 */
export class TimeoutError extends TypedError {
    readonly type = ErrorType.TIMEOUT;
    readonly severity = ErrorSeverity.MEDIUM;
    readonly retryable = true;

    constructor(
        message: string,
        public readonly timeoutMs: number,
        public readonly operation: string,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            `Operation '${operation}' timed out after ${timeoutMs}ms. You may want to increase the timeout or try again.`
        );
    }
}

/**
 * Service unavailable errors
 */
export class ServiceUnavailableError extends TypedError {
    readonly type = ErrorType.SERVICE_UNAVAILABLE;
    readonly severity = ErrorSeverity.HIGH;
    readonly retryable = true;

    constructor(
        message: string,
        public readonly serviceName: string,
        public readonly estimatedRecoveryTime?: Date,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            ServiceUnavailableError.getUserGuidance(serviceName, estimatedRecoveryTime)
        );
    }

    private static getUserGuidance(serviceName: string, recoveryTime?: Date): string {
        if (recoveryTime) {
            const waitMinutes = Math.ceil((recoveryTime.getTime() - Date.now()) / 60000);
            return `${serviceName} is temporarily unavailable. Estimated recovery time: ${waitMinutes} minutes.`;
        }
        return `${serviceName} is temporarily unavailable. Please try again later.`;
    }

    override getRetryDelay(attemptNumber: number): number {
        if (this.estimatedRecoveryTime) {
            const recoveryTime = this.estimatedRecoveryTime.getTime();
            const now = Date.now();
            const waitTime = Math.max(0, recoveryTime - now);
            return Math.min(waitTime, 600000); // Max 10 minutes wait
        }

        // Longer delays for service unavailable
        const baseDelay = 5000; // 5 seconds
        const maxDelay = 300000; // 5 minutes
        const delay = Math.min(baseDelay * Math.pow(2, attemptNumber - 1), maxDelay);
        
        return delay;
    }
}

/**
 * Git operation errors
 */
export class GitError extends TypedError {
    readonly type = ErrorType.GIT_OPERATION;
    readonly severity = ErrorSeverity.MEDIUM;
    readonly retryable: boolean;

    constructor(
        message: string,
        public readonly details: GitErrorDetails,
        context?: ErrorContext
    ) {
        const retryable = GitError.isRetryable(details.operation);
        
        super(
            message,
            context,
            GitError.getUserGuidance(details)
        );
        this.retryable = retryable;
    }

    private static isRetryable(operation: string): boolean {
        // Some git operations can be retried (fetch, pull), others cannot (commit, push with conflicts)
        const retryableOperations = ['fetch', 'pull', 'clone', 'status'];
        return retryableOperations.includes(operation.toLowerCase());
    }

    private static getUserGuidance(details: GitErrorDetails): string {
        const { operation, repository, branch } = details;
        
        switch (operation.toLowerCase()) {
            case 'fetch':
            case 'pull':
                return `Failed to ${operation} from ${repository}. Please check your network connection and repository access.`;
            case 'push':
                return `Failed to push to ${repository}. Please check for conflicts and ensure you have push permissions.`;
            case 'commit':
                return 'Failed to create commit. Please check that you have changes to commit and proper git configuration.';
            case 'checkout':
                return `Failed to checkout ${branch || 'branch'}. Please check that the branch exists and there are no uncommitted changes.`;
            default:
                return `Git operation '${operation}' failed for repository ${repository}.`;
        }
    }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends TypedError {
    readonly type = ErrorType.CONFIGURATION;
    readonly severity = ErrorSeverity.HIGH;
    readonly retryable = false;

    constructor(
        message: string,
        public readonly configKey: string,
        public readonly expectedValue?: string,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            ConfigurationError.getUserGuidance(configKey, expectedValue)
        );
    }

    private static getUserGuidance(configKey: string, expectedValue?: string): string {
        if (expectedValue) {
            return `Configuration error: '${configKey}' should be ${expectedValue}. Please check your configuration file.`;
        }
        return `Configuration error: '${configKey}' is missing or invalid. Please check your configuration file.`;
    }
}

/**
 * Unknown errors (fallback)
 */
export class UnknownError extends TypedError {
    readonly type = ErrorType.UNKNOWN;
    readonly severity = ErrorSeverity.MEDIUM;
    readonly retryable = true;

    constructor(
        message: string,
        public readonly originalError: unknown,
        context?: ErrorContext
    ) {
        super(
            message,
            context,
            'An unexpected error occurred. Please try again or contact support if the issue persists.'
        );
    }
}

/**
 * Error factory for creating typed errors from unknown errors
 */
export class TypedErrorFactory {
    /**
     * Create a typed error from an unknown error
     */
    static createFromUnknown(
        error: unknown,
        context?: ErrorContext
    ): TypedError {
        if (error instanceof TypedError) {
            return error;
        }

        if (error instanceof z.ZodError) {
            const validationErrors = ValidationError.fromZodError(error, context);
            // Return the first validation error, or create a composite error
            return validationErrors[0] || new UnknownError('Validation failed', error, context);
        }

        if (error instanceof Error) {
            return TypedErrorFactory.createFromError(error, context);
        }

        // Handle string errors
        if (typeof error === 'string') {
            return new UnknownError(error, error, context);
        }

        // Handle object errors
        if (typeof error === 'object' && error !== null) {
            const message = (error as any).message || 'Unknown error occurred';
            return new UnknownError(message, error, context);
        }

        return new UnknownError('An unknown error occurred', error, context);
    }

    /**
     * Create a typed error from a standard Error
     */
    private static createFromError(
        error: Error,
        context?: ErrorContext
    ): TypedError {
        const message = error.message;
        const lowerMessage = message.toLowerCase();

        // Network errors (check before timeout to catch "network timeout")
        if (lowerMessage.includes('network') || 
            lowerMessage.includes('connection') ||
            error.name === 'NetworkError') {
            return new NetworkError(message, {}, context);
        }

        // Timeout errors
        if (lowerMessage.includes('timeout') ||
            error.name === 'TimeoutError') {
            return new TimeoutError(message, 0, 'unknown', context);
        }

        // Authentication errors
        if (lowerMessage.includes('auth') ||
            lowerMessage.includes('unauthorized') ||
            lowerMessage.includes('forbidden') ||
            error.name === 'AuthenticationError') {
            return new AuthenticationError(message, 'unknown', context);
        }

        // Permission errors
        if (lowerMessage.includes('permission') ||
            lowerMessage.includes('access denied') ||
            error.name === 'PermissionError') {
            return new PermissionError(message, 'unknown', 'unknown', context);
        }

        // Rate limit errors
        if (lowerMessage.includes('rate limit') ||
            lowerMessage.includes('too many requests') ||
            error.name === 'RateLimitError') {
            return new RateLimitError(message, undefined, undefined, undefined, context);
        }

        // File errors
        if (lowerMessage.includes('file') ||
            lowerMessage.includes('enoent') ||
            lowerMessage.includes('eacces') ||
            error.name === 'FileError') {
            return new FileError(message, {
                filePath: 'unknown',
                operation: 'access',
            }, context);
        }

        // Timeout errors
        if (lowerMessage.includes('timeout') ||
            error.name === 'TimeoutError') {
            return new TimeoutError(message, 0, 'unknown', context);
        }

        // Service unavailable errors
        if (lowerMessage.includes('service unavailable') ||
            lowerMessage.includes('server error') ||
            error.name === 'ServiceUnavailableError') {
            return new ServiceUnavailableError(message, 'unknown', undefined, context);
        }

        // Git errors
        if (lowerMessage.includes('git') ||
            error.name === 'GitError') {
            return new GitError(message, {
                repository: 'unknown',
                operation: 'unknown',
            }, context);
        }

        // Configuration errors
        if (lowerMessage.includes('config') ||
            lowerMessage.includes('configuration') ||
            error.name === 'ConfigurationError') {
            return new ConfigurationError(message, 'unknown', undefined, context);
        }

        // Default to unknown error
        return new UnknownError(message, error, context);
    }

    /**
     * Create error from HTTP response
     */
    static createFromHttpResponse(
        response: { status: number; statusText: string; url: string },
        responseBody?: string,
        context?: ErrorContext
    ): TypedError {
        const { status, statusText, url } = response;
        const message = `HTTP ${status} ${statusText}`;

        const details: APIErrorDetails = {
            endpoint: url,
            method: 'unknown',
            statusCode: status,
            responseBody,
        };

        return new APIError(message, details, context);
    }

    /**
     * Create error from fetch failure
     */
    static createFromFetchError(
        error: Error,
        url: string,
        context?: ErrorContext
    ): TypedError {
        if (error.name === 'AbortError') {
            return new TimeoutError('Request was aborted', 0, 'fetch', context);
        }

        if (error.message.includes('network') || error.message.includes('fetch')) {
            return new NetworkError(error.message, { host: url }, context);
        }

        return new APIError(error.message, {
            endpoint: url,
            method: 'unknown',
        }, context);
    }
}

/**
 * Type guards for typed errors
 */
export function isTypedError(error: unknown): error is TypedError {
    return error instanceof TypedError;
}

export function isValidationError(error: unknown): error is ValidationError {
    return error instanceof ValidationError;
}

export function isLLMProviderError(error: unknown): error is LLMProviderError {
    return error instanceof LLMProviderError;
}

export function isAPIError(error: unknown): error is APIError {
    return error instanceof APIError;
}

export function isNetworkError(error: unknown): error is NetworkError {
    return error instanceof NetworkError;
}

export function isRetryableError(error: unknown): boolean {
    return isTypedError(error) && error.retryable;
}

export function getErrorSeverity(error: unknown): ErrorSeverity {
    if (isTypedError(error)) {
        return error.severity;
    }
    return ErrorSeverity.MEDIUM;
}

export function getErrorType(error: unknown): ErrorType {
    if (isTypedError(error)) {
        return error.type;
    }
    return ErrorType.UNKNOWN;
}