/**
 * Strict type definitions for all service interfaces
 * This file provides comprehensive type safety for the entire system
 */

import { z } from 'zod';
import type { 
    ErrorContext as _ErrorContext, 
    ErrorResolution as _ErrorResolution, 
    ErrorMetrics as _ErrorMetrics, 
    RetryConfig as _RetryConfig 
} from '../services/error-handling/types.ts';

export type ErrorContext = _ErrorContext;
export type ErrorResolution = _ErrorResolution;
export type ErrorMetrics = _ErrorMetrics;
export type RetryConfig = _RetryConfig;

/**
 * Base service interface that all services must implement
 */
export interface BaseService {
    readonly name: string;
    readonly version: string;
    isHealthy(): Promise<boolean>;
    initialize?(): Promise<void>;
    cleanup?(): Promise<void>;
}

/**
 * Service registry interface for dependency injection
 */
export interface ServiceRegistry {
    register<T extends BaseService>(name: string, service: T): void;
    get<T extends BaseService>(name: string): T | undefined;
    has(name: string): boolean;
    list(): string[];
}

/**
 * Analysis service interfaces
 */
export interface CodeAnalysisService extends BaseService {
    analyzeFile(filePath: string, options?: AnalysisOptions): Promise<AnalysisResult>;
    analyzeFiles(filePaths: string[], options?: AnalysisOptions): Promise<AnalysisResult[]>;
    analyzeChanges(changes: FileChange[], options?: AnalysisOptions): Promise<AnalysisResult[]>;
}

export interface ValidationService extends BaseService {
    validate<T>(data: unknown, schema: z.ZodType<T>): Promise<ValidationResult<T>>;
    validateWithTransformation<T>(
        data: unknown,
        schema: z.ZodType<T>,
        transformers?: DataTransformer[]
    ): Promise<ValidationResult<T>>;
    registerTransformer(transformer: DataTransformer): void;
    getAvailableTransformers(): DataTransformer[];
}

export interface TransformationService extends BaseService {
    transform(data: unknown, transformers: DataTransformer[]): Promise<TransformationResult>;
    registerTransformer(transformer: DataTransformer): void;
    getTransformer(name: string): DataTransformer | undefined;
    listTransformers(): string[];
}

/**
 * LLM service interfaces
 */
export interface LLMProvider extends BaseService {
    readonly providerName: string;
    readonly supportedModels: string[];
    isAvailable(): Promise<boolean>;
    listModels(): Promise<string[]>;
    setModel(model: string): void;
    getCurrentModel(): string;
    generate(prompt: string, options?: GenerationOptions): Promise<string>;
    generateObject<T>(
        prompt: string,
        schema: z.ZodType<T>,
        options?: GenerationOptions
    ): Promise<T>;
    chat(
        messages: ChatMessage[],
        options?: ChatOptions
    ): Promise<ChatResponse>;
}

export interface LLMFactory extends BaseService {
    createProvider(type: LLMProviderType, config: LLMProviderConfig): Promise<LLMProvider>;
    getProvider(name: string): LLMProvider | undefined;
    listProviders(): string[];
    getDefaultProvider(): LLMProvider | undefined;
}

export interface ResponseProcessor extends BaseService {
    processResponse<T>(
        rawResponse: string,
        schema: z.ZodType<T>,
        options?: ProcessingOptions
    ): Promise<ProcessingResult<T>>;
    cleanJSON(jsonString: string): string;
    parseJSON(jsonString: string): unknown;
}

/**
 * Repository service interfaces
 */
export interface RepositoryService extends BaseService {
    readonly repositoryType: RepositoryType;
    detectRepositoryType(): Promise<RepositoryType>;
    isAuthenticated(): Promise<boolean>;
    authenticate(): Promise<void>;
}

export interface GitService extends RepositoryService {
    getChangedFiles(options?: GitOptions): Promise<string[]>;
    getFileChanges(filePath: string, options?: GitOptions): Promise<FileChange[]>;
    getRemoteUrl(): Promise<string>;
    getCurrentBranch(): Promise<string>;
    getBranchInfo(): Promise<BranchInfo>;
    getCommitInfo(sha?: string): Promise<CommitInfo>;
}

export interface GitHubService extends RepositoryService {
    getPullRequests(options?: PullRequestOptions): Promise<PullRequest[]>;
    getPullRequest(id: string): Promise<PullRequest>;
    getPullRequestDiff(id: string): Promise<DiffData>;
    createReviewComment(prId: string, comment: ReviewComment): Promise<void>;
    updateReviewComment(commentId: string, comment: ReviewComment): Promise<void>;
    deleteReviewComment(commentId: string): Promise<void>;
}

export interface GitLabService extends RepositoryService {
    getMergeRequests(options?: MergeRequestOptions): Promise<MergeRequest[]>;
    getMergeRequest(id: string): Promise<MergeRequest>;
    getMergeRequestDiff(id: string): Promise<DiffData>;
    createMergeRequestNote(mrId: string, note: MergeRequestNote): Promise<void>;
    updateMergeRequestNote(noteId: string, note: MergeRequestNote): Promise<void>;
    deleteMergeRequestNote(noteId: string): Promise<void>;
}

/**
 * Error handling service interfaces
 */
export interface ErrorHandlingService extends BaseService {
    handleError(error: unknown, context: ErrorContext): Promise<ErrorResolution>;
    registerErrorHandler(type: string, handler: ErrorHandler): void;
    getErrorMetrics(): ErrorMetrics;
    resetMetrics(): void;
    executeWithErrorHandling<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        options?: ExecutionOptions
    ): Promise<T>;
}

export interface RetryService extends BaseService {
    executeWithRetry<T>(
        operation: () => Promise<T>,
        config: RetryConfig,
        context: ErrorContext
    ): Promise<T>;
    calculateDelay(attempt: number, config: RetryConfig): number;
    shouldRetry(error: unknown, attempt: number, config: RetryConfig): boolean;
}

export interface MetricsService extends BaseService {
    recordError(error: unknown, context: ErrorContext): void;
    recordSuccess(operation: string, duration: number): void;
    recordRetry(operation: string, attempt: number): void;
    recordFallback(operation: string, reason: string): void;
    getMetrics(): ErrorMetrics;
    exportMetrics(): Promise<string>;
}

/**
 * Cache service interfaces
 */
export interface CacheService extends BaseService {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<void>;
    has(key: string): Promise<boolean>;
    keys(pattern?: string): Promise<string[]>;
    size(): Promise<number>;
}

export interface AnalysisCacheService extends CacheService {
    cacheAnalysisResult(filePath: string, result: AnalysisResult): Promise<void>;
    getCachedAnalysisResult(filePath: string): Promise<AnalysisResult | undefined>;
    invalidateFileCache(filePath: string): Promise<void>;
    invalidateAllCache(): Promise<void>;
}

/**
 * Type definitions for service data structures
 */

/**
 * Analysis types
 */
export interface AnalysisOptions {
    includeTests?: boolean;
    includeCoverage?: boolean;
    includeMetrics?: boolean;
    depth?: 'shallow' | 'normal' | 'deep';
    timeout?: number;
}

export interface AnalysisResult {
    filePath: string;
    grade: Grade;
    coverage: number;
    testsPresent: boolean;
    value: Value;
    state: State;
    issues: CodeIssue[];
    suggestions: string[];
    summary: string;
    metadata: AnalysisMetadata;
}

export interface AnalysisMetadata {
    analysisTime: number;
    llmProvider?: string;
    model?: string;
    transformationsApplied: string[];
    warnings: string[];
    cacheHit: boolean;
    timestamp: Date;
}

/**
 * Validation types
 */
export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    originalData: unknown;
    transformationsApplied: string[];
    errors: z.ZodError[];
    warnings: string[];
    metadata: ValidationMetadata;
}

export interface ValidationMetadata {
    schema: string;
    validationTime: number;
    transformerCount: number;
    fallbackUsed: boolean;
    timestamp: Date;
}

export interface DataTransformer {
    name: string;
    description: string;
    transform(data: unknown): unknown;
    canTransform(data: unknown, targetType: string): boolean;
    priority: number;
}

export interface TransformationResult {
    success: boolean;
    data: unknown;
    originalData: unknown;
    transformersApplied: string[];
    errors: Error[];
    warnings: string[];
}

/**
 * LLM types
 */
export type LLMProviderType = 'openai' | 'azure' | 'ollama' | 'anthropic' | 'copilot';

export interface LLMProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    timeout?: number;
    maxRetries?: number;
    [key: string]: unknown;
}

export interface GenerationOptions {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string[];
    stream?: boolean;
    timeout?: number;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCallId?: string;
}

export interface ChatOptions extends GenerationOptions {
    tools?: ToolFunction[];
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface ChatResponse {
    content: string;
    toolCalls?: ToolCall[];
    finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface ToolFunction {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ProcessingOptions {
    enableTransformation?: boolean;
    enableErrorRecovery?: boolean;
    maxRetries?: number;
    timeout?: number;
}

export interface ProcessingResult<T> {
    success: boolean;
    data?: T;
    errors: Error[];
    warnings: string[];
    fallbackUsed: boolean;
    processingTime: number;
    metadata: ProcessingMetadata;
}

export interface ProcessingMetadata {
    rawResponseLength: number;
    cleanedResponseLength: number;
    transformationsApplied: string[];
    retryCount: number;
    timestamp: Date;
}

/**
 * Repository types
 */
export type RepositoryType = 'git' | 'github' | 'gitlab' | 'unknown';

export interface GitOptions {
    branch?: string;
    since?: Date;
    until?: Date;
    author?: string;
    includeUntracked?: boolean;
}

export interface BranchInfo {
    name: string;
    sha: string;
    isDefault: boolean;
    upstream?: string;
    ahead: number;
    behind: number;
}

export interface CommitInfo {
    sha: string;
    message: string;
    author: {
        name: string;
        email: string;
        date: Date;
    };
    committer: {
        name: string;
        email: string;
        date: Date;
    };
    parents: string[];
    stats?: {
        additions: number;
        deletions: number;
        total: number;
    };
}

export interface FileChange {
    type: 'added' | 'modified' | 'deleted' | 'renamed';
    filePath: string;
    oldPath?: string;
    hunks: DiffHunk[];
    stats: {
        additions: number;
        deletions: number;
        total: number;
    };
}

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: DiffLine[];
}

export interface DiffLine {
    type: 'context' | 'addition' | 'deletion';
    oldLineNumber?: number;
    newLineNumber?: number;
    content: string;
}

export interface DiffData {
    files: FileChange[];
    baseSha: string;
    headSha: string;
    stats: {
        additions: number;
        deletions: number;
        total: number;
        filesChanged: number;
    };
}

export interface PullRequestOptions {
    state?: 'open' | 'closed' | 'merged' | 'all';
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
}

export interface PullRequest {
    id: string;
    number: number;
    title: string;
    description: string;
    author: User;
    assignees: User[];
    reviewers: User[];
    state: 'open' | 'closed' | 'merged';
    createdAt: Date;
    updatedAt: Date;
    mergedAt?: Date;
    closedAt?: Date;
    url: string;
    sourceBranch: string;
    targetBranch: string;
    commits: number;
    additions: number;
    deletions: number;
    changedFiles: number;
}

export interface MergeRequestOptions extends PullRequestOptions {
    scope?: 'created_by_me' | 'assigned_to_me' | 'all';
}

export interface MergeRequest extends PullRequest {
    iid: number;
    webUrl: string;
    approved: boolean;
    approvedBy: User[];
    conflicts: boolean;
    workInProgress: boolean;
}

export interface ReviewComment {
    body: string;
    path: string;
    line: number;
    side?: 'LEFT' | 'RIGHT';
    startLine?: number;
    startSide?: 'LEFT' | 'RIGHT';
}

export interface MergeRequestNote {
    body: string;
    position?: {
        baseSha: string;
        headSha: string;
        startSha: string;
        newPath: string;
        oldPath?: string;
        newLine: number;
        oldLine?: number;
    };
}

export interface User {
    id: string;
    username: string;
    name: string;
    email?: string;
    avatarUrl?: string;
}

/**
 * Error handling types
 */
export interface ErrorHandler {
    canHandle(error: unknown): boolean;
    handle(error: unknown, context: ErrorContext): Promise<ErrorResolution>;
    priority: number;
}

export interface ExecutionOptions {
    enableRetry?: boolean;
    enableFallback?: boolean;
    maxAttempts?: number;
    retryConfig?: Partial<RetryConfig>;
    context?: Partial<ErrorContext>;
}

/**
 * Code analysis types
 */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Value = 'high' | 'medium' | 'low';
export type State = 'pass' | 'warning' | 'fail';
export type Severity = 'low' | 'medium' | 'high';
export type IssueType = 'security' | 'performance' | 'style' | 'bug';

export interface CodeIssue {
    line: number;
    severity: Severity;
    type: IssueType;
    message: string;
    rule?: string;
    suggestion?: string;
}

/**
 * Type guards and utilities
 */
export function isBaseService(obj: unknown): obj is BaseService {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'name' in obj &&
        'version' in obj &&
        'isHealthy' in obj &&
        typeof (obj as any).name === 'string' &&
        typeof (obj as any).version === 'string' &&
        typeof (obj as any).isHealthy === 'function'
    );
}

export function isAnalysisResult(obj: unknown): obj is AnalysisResult {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'filePath' in obj &&
        'grade' in obj &&
        'coverage' in obj &&
        'testsPresent' in obj &&
        'value' in obj &&
        'state' in obj &&
        'issues' in obj &&
        'suggestions' in obj &&
        'summary' in obj &&
        'metadata' in obj
    );
}

export function isValidationResult<T>(obj: unknown): obj is ValidationResult<T> {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'success' in obj &&
        'originalData' in obj &&
        'transformationsApplied' in obj &&
        'errors' in obj &&
        'warnings' in obj &&
        'metadata' in obj &&
        typeof (obj as any).success === 'boolean' &&
        Array.isArray((obj as any).transformationsApplied) &&
        Array.isArray((obj as any).errors) &&
        Array.isArray((obj as any).warnings)
    );
}

export function isLLMProvider(obj: unknown): obj is LLMProvider {
    return (
        isBaseService(obj) &&
        'providerName' in obj &&
        'supportedModels' in obj &&
        'isAvailable' in obj &&
        'listModels' in obj &&
        'setModel' in obj &&
        'getCurrentModel' in obj &&
        'generate' in obj &&
        'generateObject' in obj &&
        'chat' in obj
    );
}

export function isRepositoryService(obj: unknown): obj is RepositoryService {
    return (
        isBaseService(obj) &&
        'repositoryType' in obj &&
        'detectRepositoryType' in obj &&
        'isAuthenticated' in obj &&
        'authenticate' in obj
    );
}

/**
 * Schema definitions for runtime validation
 */
export const AnalysisResultSchema = z.object({
    filePath: z.string(),
    grade: z.enum(['A', 'B', 'C', 'D', 'F']),
    coverage: z.number().min(0).max(100),
    testsPresent: z.boolean(),
    value: z.enum(['high', 'medium', 'low']),
    state: z.enum(['pass', 'warning', 'fail']),
    issues: z.array(z.object({
        line: z.number(),
        severity: z.enum(['low', 'medium', 'high']),
        type: z.enum(['security', 'performance', 'style', 'bug']),
        message: z.string(),
        rule: z.string().optional(),
        suggestion: z.string().optional(),
    })),
    suggestions: z.array(z.string()),
    summary: z.string(),
    metadata: z.object({
        analysisTime: z.number(),
        llmProvider: z.string().optional(),
        model: z.string().optional(),
        transformationsApplied: z.array(z.string()),
        warnings: z.array(z.string()),
        cacheHit: z.boolean(),
        timestamp: z.date(),
    }),
});

export const ValidationResultSchema = <T>(dataSchema: z.ZodType<T>) => z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    originalData: z.unknown(),
    transformationsApplied: z.array(z.string()),
    errors: z.array(z.unknown()),
    warnings: z.array(z.string()),
    metadata: z.object({
        schema: z.string(),
        validationTime: z.number(),
        transformerCount: z.number(),
        fallbackUsed: z.boolean(),
        timestamp: z.date(),
    }),
});

export const ProcessingResultSchema = <T>(dataSchema: z.ZodType<T>) => z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    errors: z.array(z.unknown()),
    warnings: z.array(z.string()),
    fallbackUsed: z.boolean(),
    processingTime: z.number(),
    metadata: z.object({
        rawResponseLength: z.number(),
        cleanedResponseLength: z.number(),
        transformationsApplied: z.array(z.string()),
        retryCount: z.number(),
        timestamp: z.date(),
    }),
});