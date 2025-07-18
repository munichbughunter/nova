/**
 * Type guards for user input validation and runtime type checking
 */

import type {
    AnalysisResult,
    ValidationResult,
    ProcessingResult,
    LLMProvider,
    RepositoryService,
    ErrorContext,
    ChatMessage,
    ToolCall,
    FileChange,
    PullRequest,
    MergeRequest,
    User,
    CodeIssue,
    Grade,
    Value,
    State,
    Severity,
    IssueType,
    BaseService,
    DataTransformer,
    RetryConfig,
    ErrorMetrics,
} from '../../types/service.types.ts';

/**
 * Basic type guards
 */
export function isString(value: unknown): value is string {
    return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export function isDate(value: unknown): value is Date {
    return value instanceof Date && !isNaN(value.getTime());
}

export function isFunction(value: unknown): value is Function {
    return typeof value === 'function';
}

/**
 * Enum type guards
 */
export function isGrade(value: unknown): value is Grade {
    return isString(value) && ['A', 'B', 'C', 'D', 'F'].includes(value);
}

export function isValue(value: unknown): value is Value {
    return isString(value) && ['high', 'medium', 'low'].includes(value);
}

export function isState(value: unknown): value is State {
    return isString(value) && ['pass', 'warning', 'fail'].includes(value);
}

export function isSeverity(value: unknown): value is Severity {
    return isString(value) && ['low', 'medium', 'high'].includes(value);
}

export function isIssueType(value: unknown): value is IssueType {
    return isString(value) && ['security', 'performance', 'style', 'bug'].includes(value);
}

/**
 * Complex type guards
 */
export function isCodeIssue(value: unknown): value is CodeIssue {
    return (
        isObject(value) &&
        'line' in value &&
        'severity' in value &&
        'type' in value &&
        'message' in value &&
        isNumber(value.line) &&
        value.line > 0 &&
        isSeverity(value.severity) &&
        isIssueType(value.type) &&
        isString(value.message)
    );
}

export function isAnalysisResult(value: unknown): value is AnalysisResult {
    return (
        isObject(value) &&
        'filePath' in value &&
        'grade' in value &&
        'coverage' in value &&
        'testsPresent' in value &&
        'value' in value &&
        'state' in value &&
        'issues' in value &&
        'suggestions' in value &&
        'summary' in value &&
        'metadata' in value &&
        isString(value.filePath) &&
        isGrade(value.grade) &&
        isNumber(value.coverage) &&
        value.coverage >= 0 &&
        value.coverage <= 100 &&
        isBoolean(value.testsPresent) &&
        isValue(value.value) &&
        isState(value.state) &&
        isArray(value.issues) &&
        value.issues.every(isCodeIssue) &&
        isArray(value.suggestions) &&
        value.suggestions.every(isString) &&
        isString(value.summary) &&
        isObject(value.metadata)
    );
}

export function isValidationResult<T>(value: unknown): value is ValidationResult<T> {
    return (
        isObject(value) &&
        'success' in value &&
        'originalData' in value &&
        'transformationsApplied' in value &&
        'errors' in value &&
        'warnings' in value &&
        'metadata' in value &&
        isBoolean(value.success) &&
        isArray(value.transformationsApplied) &&
        value.transformationsApplied.every(isString) &&
        isArray(value.errors) &&
        isArray(value.warnings) &&
        value.warnings.every(isString) &&
        isObject(value.metadata)
    );
}

export function isProcessingResult<T>(value: unknown): value is ProcessingResult<T> {
    return (
        isObject(value) &&
        'success' in value &&
        'errors' in value &&
        'warnings' in value &&
        'fallbackUsed' in value &&
        'processingTime' in value &&
        'metadata' in value &&
        isBoolean(value.success) &&
        isArray(value.errors) &&
        isArray(value.warnings) &&
        value.warnings.every(isString) &&
        isBoolean(value.fallbackUsed) &&
        isNumber(value.processingTime) &&
        isObject(value.metadata)
    );
}

export function isBaseService(value: unknown): value is BaseService {
    return (
        isObject(value) &&
        'name' in value &&
        'version' in value &&
        'isHealthy' in value &&
        isString(value.name) &&
        isString(value.version) &&
        isFunction(value.isHealthy)
    );
}

export function isLLMProvider(value: unknown): value is LLMProvider {
    return (
        isBaseService(value) &&
        'providerName' in value &&
        'supportedModels' in value &&
        'isAvailable' in value &&
        'listModels' in value &&
        'setModel' in value &&
        'getCurrentModel' in value &&
        'generate' in value &&
        'generateObject' in value &&
        'chat' in value &&
        isString((value as any).providerName) &&
        isArray((value as any).supportedModels) &&
        isFunction((value as any).isAvailable) &&
        isFunction((value as any).listModels) &&
        isFunction((value as any).setModel) &&
        isFunction((value as any).getCurrentModel) &&
        isFunction((value as any).generate) &&
        isFunction((value as any).generateObject) &&
        isFunction((value as any).chat)
    );
}

export function isRepositoryService(value: unknown): value is RepositoryService {
    return (
        isBaseService(value) &&
        'repositoryType' in value &&
        'detectRepositoryType' in value &&
        'isAuthenticated' in value &&
        'authenticate' in value &&
        isString((value as any).repositoryType) &&
        isFunction((value as any).detectRepositoryType) &&
        isFunction((value as any).isAuthenticated) &&
        isFunction((value as any).authenticate)
    );
}

export function isErrorContext(value: unknown): value is ErrorContext {
    return (
        isObject(value) &&
        'operation' in value &&
        'attemptNumber' in value &&
        'timestamp' in value &&
        isString(value.operation) &&
        isNumber(value.attemptNumber) &&
        value.attemptNumber >= 0 &&
        isDate(value.timestamp)
    );
}

export function isChatMessage(value: unknown): value is ChatMessage {
    return (
        isObject(value) &&
        'role' in value &&
        'content' in value &&
        isString(value.role) &&
        ['system', 'user', 'assistant', 'tool'].includes(value.role) &&
        isString(value.content)
    );
}

export function isToolCall(value: unknown): value is ToolCall {
    return (
        isObject(value) &&
        'id' in value &&
        'type' in value &&
        'function' in value &&
        isString(value.id) &&
        value.type === 'function' &&
        isObject(value.function) &&
        'name' in value.function &&
        'arguments' in value.function &&
        isString((value.function as any).name) &&
        isString((value.function as any).arguments)
    );
}

export function isUser(value: unknown): value is User {
    return (
        isObject(value) &&
        'id' in value &&
        'username' in value &&
        'name' in value &&
        isString(value.id) &&
        isString(value.username) &&
        isString(value.name)
    );
}

export function isPullRequest(value: unknown): value is PullRequest {
    return (
        isObject(value) &&
        'id' in value &&
        'number' in value &&
        'title' in value &&
        'description' in value &&
        'author' in value &&
        'state' in value &&
        'createdAt' in value &&
        'updatedAt' in value &&
        'url' in value &&
        'sourceBranch' in value &&
        'targetBranch' in value &&
        isString(value.id) &&
        isNumber(value.number) &&
        isString(value.title) &&
        isString(value.description) &&
        isUser(value.author) &&
        isString(value.state) &&
        ['open', 'closed', 'merged'].includes(value.state) &&
        isDate(value.createdAt) &&
        isDate(value.updatedAt) &&
        isString(value.url) &&
        isString(value.sourceBranch) &&
        isString(value.targetBranch)
    );
}

export function isMergeRequest(value: unknown): value is MergeRequest {
    return (
        isPullRequest(value) &&
        'iid' in value &&
        'webUrl' in value &&
        'approved' in value &&
        'approvedBy' in value &&
        'conflicts' in value &&
        'workInProgress' in value &&
        isNumber((value as any).iid) &&
        isString((value as any).webUrl) &&
        isBoolean((value as any).approved) &&
        isArray((value as any).approvedBy) &&
        isBoolean((value as any).conflicts) &&
        isBoolean((value as any).workInProgress)
    );
}

export function isFileChange(value: unknown): value is FileChange {
    return (
        isObject(value) &&
        'type' in value &&
        'filePath' in value &&
        'hunks' in value &&
        'stats' in value &&
        isString(value.type) &&
        ['added', 'modified', 'deleted', 'renamed'].includes(value.type) &&
        isString(value.filePath) &&
        isArray(value.hunks) &&
        isObject(value.stats)
    );
}

export function isDataTransformer(value: unknown): value is DataTransformer {
    return (
        isObject(value) &&
        'name' in value &&
        'description' in value &&
        'transform' in value &&
        'canTransform' in value &&
        'priority' in value &&
        isString(value.name) &&
        isString(value.description) &&
        isFunction(value.transform) &&
        isFunction(value.canTransform) &&
        isNumber(value.priority)
    );
}

export function isRetryConfig(value: unknown): value is RetryConfig {
    return (
        isObject(value) &&
        'maxAttempts' in value &&
        'baseDelayMs' in value &&
        'maxDelayMs' in value &&
        'backoffMultiplier' in value &&
        isNumber(value.maxAttempts) &&
        value.maxAttempts > 0 &&
        isNumber(value.baseDelayMs) &&
        value.baseDelayMs > 0 &&
        isNumber(value.maxDelayMs) &&
        value.maxDelayMs > 0 &&
        isNumber(value.backoffMultiplier) &&
        value.backoffMultiplier > 0
    );
}

export function isErrorMetrics(value: unknown): value is ErrorMetrics {
    return (
        isObject(value) &&
        'totalErrors' in value &&
        'errorsByType' in value &&
        'errorsByOperation' in value &&
        'retryAttempts' in value &&
        'successfulRetries' in value &&
        'failedRetries' in value &&
        'fallbacksUsed' in value &&
        'fallbackSuccesses' in value &&
        'fallbackFailures' in value &&
        'averageRetryDelay' in value &&
        'errorRecoveryRate' in value &&
        'lastResetTime' in value &&
        isNumber(value.totalErrors) &&
        isObject(value.errorsByType) &&
        isObject(value.errorsByOperation) &&
        isNumber(value.retryAttempts) &&
        isNumber(value.successfulRetries) &&
        isNumber(value.failedRetries) &&
        isNumber(value.fallbacksUsed) &&
        isNumber(value.fallbackSuccesses) &&
        isNumber(value.fallbackFailures) &&
        isNumber(value.averageRetryDelay) &&
        isNumber(value.errorRecoveryRate) &&
        isDate(value.lastResetTime)
    );
}

/**
 * User input validation guards
 */
export function isValidFilePath(value: unknown): value is string {
    if (!isString(value)) return false;
    
    // Check for empty path
    if (value.trim().length === 0) return false;
    
    // Check for parent directory traversal
    if (value.includes('..')) return false;
    
    // Check for invalid characters (Windows/Unix)
    if (/[<>:"|?*]/.test(value)) return false;
    
    // Check for control characters
    if (/[\x00-\x1f\x7f]/.test(value)) return false;
    
    return true;
}

export function isValidEmail(value: unknown): value is string {
    if (!isString(value)) return false;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
}

export function isValidUrl(value: unknown): value is string {
    if (!isString(value)) return false;
    
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

export function isValidHttpUrl(value: unknown): value is string {
    if (!isValidUrl(value)) return false;
    
    const url = new URL(value as string);
    return url.protocol === 'http:' || url.protocol === 'https:';
}

export function isValidPort(value: unknown): value is number {
    return isNumber(value) && value >= 1 && value <= 65535 && Number.isInteger(value);
}

export function isValidTimeout(value: unknown): value is number {
    return isNumber(value) && value > 0 && value <= 300000; // Max 5 minutes
}

export function isValidPercentage(value: unknown): value is number {
    return isNumber(value) && value >= 0 && value <= 100;
}

export function isValidPositiveInteger(value: unknown): value is number {
    return isNumber(value) && value > 0 && Number.isInteger(value);
}

export function isValidNonNegativeInteger(value: unknown): value is number {
    return isNumber(value) && value >= 0 && Number.isInteger(value);
}

/**
 * Sanitization guards
 */
export function isSafeString(value: unknown): value is string {
    if (!isString(value)) return false;
    
    // Check for potential XSS patterns
    const xssPatterns = [
        /<script/i,
        /javascript:/i,
        /vbscript:/i,
        /data:/i,
        /on\w+\s*=/i,
    ];
    
    return !xssPatterns.some(pattern => pattern.test(value));
}

export function isSafeFilename(value: unknown): value is string {
    if (!isString(value)) return false;
    
    // Check for reserved names (Windows)
    const reservedNames = [
        'CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ];
    
    const upperName = value.toUpperCase();
    if (reservedNames.includes(upperName)) return false;
    
    // Check for invalid characters
    if (/[<>:"|?*\\\/]/.test(value)) return false;
    
    // Check for control characters
    if (/[\x00-\x1f\x7f]/.test(value)) return false;
    
    // Check length
    if (value.length > 255) return false;
    
    return true;
}

/**
 * Array validation guards
 */
export function isArrayOf<T>(
    value: unknown,
    itemGuard: (item: unknown) => item is T
): value is T[] {
    return isArray(value) && value.every(itemGuard);
}

export function isNonEmptyArray<T>(
    value: unknown,
    itemGuard?: (item: unknown) => item is T
): value is T[] {
    if (!isArray(value) || value.length === 0) return false;
    if (itemGuard) return value.every(itemGuard);
    return true;
}

/**
 * Object validation guards
 */
export function hasRequiredProperties<T extends Record<string, unknown>>(
    value: unknown,
    requiredProps: (keyof T)[]
): value is T {
    if (!isObject(value)) return false;
    
    return requiredProps.every(prop => prop in value);
}

export function isObjectWithShape<T extends Record<string, unknown>>(
    value: unknown,
    shape: { [K in keyof T]: (value: unknown) => value is T[K] }
): value is T {
    if (!isObject(value)) return false;
    
    return Object.entries(shape).every(([key, guard]) => {
        const propValue = (value as any)[key];
        return guard(propValue);
    });
}

/**
 * Composite validation guards
 */
export function isValidAnalysisOptions(value: unknown): value is {
    includeTests?: boolean;
    includeCoverage?: boolean;
    includeMetrics?: boolean;
    depth?: 'shallow' | 'normal' | 'deep';
    timeout?: number;
} {
    if (!isObject(value)) return true; // Options are optional
    
    const checks = [
        !('includeTests' in value) || isBoolean(value.includeTests),
        !('includeCoverage' in value) || isBoolean(value.includeCoverage),
        !('includeMetrics' in value) || isBoolean(value.includeMetrics),
        !('depth' in value) || (isString(value.depth) && ['shallow', 'normal', 'deep'].includes(value.depth)),
        !('timeout' in value) || isValidTimeout(value.timeout),
    ];
    
    return checks.every(Boolean);
}

export function isValidReviewCommand(value: unknown): value is {
    mode: 'file' | 'changes' | 'pr';
    files?: string[];
    prId?: string;
} {
    return (
        isObject(value) &&
        'mode' in value &&
        isString(value.mode) &&
        ['file', 'changes', 'pr'].includes(value.mode) &&
        (!('files' in value) || isArrayOf(value.files, isValidFilePath)) &&
        (!('prId' in value) || isString(value.prId))
    );
}

/**
 * Utility functions for type guard composition
 */
export function createArrayGuard<T>(
    itemGuard: (item: unknown) => item is T
): (value: unknown) => value is T[] {
    return (value: unknown): value is T[] => isArrayOf(value, itemGuard);
}

export function createOptionalGuard<T>(
    guard: (value: unknown) => value is T
): (value: unknown) => value is T | undefined {
    return (value: unknown): value is T | undefined => {
        return value === undefined || guard(value);
    };
}

export function createUnionGuard<T, U>(
    guardA: (value: unknown) => value is T,
    guardB: (value: unknown) => value is U
): (value: unknown) => value is T | U {
    return (value: unknown): value is T | U => {
        return guardA(value) || guardB(value);
    };
}

export function createObjectGuard<T extends Record<string, unknown>>(
    propertyGuards: { [K in keyof T]: (value: unknown) => value is T[K] }
): (value: unknown) => value is T {
    return (value: unknown): value is T => {
        return isObjectWithShape(value, propertyGuards);
    };
}