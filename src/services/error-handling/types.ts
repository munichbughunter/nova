/**
 * Type definitions for the comprehensive error handling framework
 */

/**
 * Error context information for tracking and debugging
 */
export interface ErrorContext {
    operation: string;
    filePath?: string;
    originalData?: unknown;
    attemptNumber: number;
    timestamp: Date;
    errorType?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Error resolution strategy result
 */
export interface ErrorResolution {
    strategy: 'retry' | 'fallback' | 'fail' | 'transform';
    data?: unknown;
    message: string;
    shouldLog: boolean;
    retryAfter?: number;
    metadata?: Record<string, unknown>;
}

/**
 * Error handling strategy interface
 */
export interface ErrorStrategy {
    handle(error: unknown, context: ErrorContext): Promise<ErrorResolution>;
}

/**
 * Configuration for the error handling service
 */
export interface ErrorHandlerConfig {
    enableMetrics: boolean;
    enableRetry: boolean;
    enableGracefulDegradation: boolean;
    maxRetryAttempts: number;
    baseRetryDelayMs: number;
    maxRetryDelayMs: number;
    retryBackoffMultiplier: number;
}

/**
 * Retry configuration options
 */
export interface RetryConfig {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterMs?: number;
}

/**
 * Error metrics data structure
 */
export interface ErrorMetrics {
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsByOperation: Record<string, number>;
    retryAttempts: number;
    successfulRetries: number;
    failedRetries: number;
    fallbacksUsed: number;
    fallbackSuccesses: number;
    fallbackFailures: number;
    averageRetryDelay: number;
    errorRecoveryRate: number;
    lastResetTime: Date;
}

/**
 * Error classification types
 */
export enum ErrorType {
    VALIDATION = 'validation',
    LLM_PROVIDER = 'llm_provider',
    API_REQUEST = 'api_request',
    NETWORK = 'network',
    AUTHENTICATION = 'authentication',
    PERMISSION = 'permission',
    RATE_LIMIT = 'rate_limit',
    FILE_NOT_FOUND = 'file_not_found',
    TIMEOUT = 'timeout',
    SERVICE_UNAVAILABLE = 'service_unavailable',
    GIT_OPERATION = 'git_operation',
    CONFIGURATION = 'configuration',
    UNKNOWN = 'unknown',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical',
}

/**
 * Enhanced error information
 */
export interface EnhancedError {
    type: ErrorType;
    severity: ErrorSeverity;
    message: string;
    originalError: unknown;
    context: ErrorContext;
    retryable: boolean;
    userGuidance?: string;
    timestamp: Date;
}

/**
 * Error handler registry entry
 */
export interface ErrorHandlerEntry {
    type: string;
    strategy: ErrorStrategy;
    priority: number;
    enabled: boolean;
}

/**
 * Graceful degradation options
 */
export interface GracefulDegradationOptions<T, F> {
    primaryOperation: () => Promise<T>;
    fallbackOperation: () => Promise<F>;
    context: ErrorContext;
    enableRetry?: boolean;
    maxRetryAttempts?: number;
}

/**
 * Operation execution options
 */
export interface ExecutionOptions {
    enableRetry?: boolean;
    enableFallback?: boolean;
    maxAttempts?: number;
    retryConfig?: Partial<RetryConfig>;
    context?: Partial<ErrorContext>;
}

/**
 * Error recovery result
 */
export interface RecoveryResult<T> {
    success: boolean;
    data?: T;
    errors: Error[];
    warnings: string[];
    transformationsApplied?: string[];
    fallbackUsed: boolean;
}

/**
 * Validation error details
 */
export interface ValidationErrorDetails {
    field: string;
    expectedType: string;
    actualType: string;
    value: unknown;
    message: string;
}

/**
 * LLM provider error details
 */
export interface LLMProviderErrorDetails {
    provider: string;
    model?: string;
    requestId?: string;
    statusCode?: number;
    rateLimitInfo?: {
        limit: number;
        remaining: number;
        resetTime: Date;
    };
}

/**
 * API error details
 */
export interface APIErrorDetails {
    endpoint: string;
    method: string;
    statusCode?: number;
    responseBody?: string;
    headers?: Record<string, string>;
    requestId?: string;
}

/**
 * Network error details
 */
export interface NetworkErrorDetails {
    host?: string;
    port?: number;
    protocol?: string;
    timeout?: number;
    connectionType?: 'tcp' | 'http' | 'https' | 'websocket';
}

/**
 * File operation error details
 */
export interface FileErrorDetails {
    filePath: string;
    operation: 'read' | 'write' | 'delete' | 'create' | 'access';
    permissions?: string;
    size?: number;
}

/**
 * Git operation error details
 */
export interface GitErrorDetails {
    repository: string;
    operation: string;
    branch?: string;
    commit?: string;
    remote?: string;
}

/**
 * Error event for metrics collection
 */
export interface ErrorEvent {
    id: string;
    type: ErrorType;
    severity: ErrorSeverity;
    operation: string;
    timestamp: Date;
    resolved: boolean;
    resolutionStrategy?: string;
    retryCount: number;
    totalDuration: number;
    context: ErrorContext;
}