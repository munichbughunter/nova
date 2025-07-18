/**
 * Runtime type validation utilities for external API responses and user input
 */

import { z } from 'zod';
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
    User
} from '../../types/service.types.ts';

/**
 * External API response validators
 */

/**
 * GitHub API response schemas
 */
export const GitHubUserSchema = z.object({
    id: z.number(),
    login: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    avatar_url: z.string().url(),
});

export const GitHubPullRequestSchema = z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    user: GitHubUserSchema,
    assignees: z.array(GitHubUserSchema),
    requested_reviewers: z.array(GitHubUserSchema),
    state: z.enum(['open', 'closed']),
    merged: z.boolean().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    merged_at: z.string().datetime().nullable(),
    closed_at: z.string().datetime().nullable(),
    html_url: z.string().url(),
    head: z.object({
        ref: z.string(),
        sha: z.string(),
    }),
    base: z.object({
        ref: z.string(),
        sha: z.string(),
    }),
    additions: z.number().optional(),
    deletions: z.number().optional(),
    changed_files: z.number().optional(),
    commits: z.number().optional(),
});

export const GitHubFileSchema = z.object({
    filename: z.string(),
    status: z.enum(['added', 'modified', 'removed', 'renamed']),
    additions: z.number(),
    deletions: z.number(),
    changes: z.number(),
    patch: z.string().optional(),
    previous_filename: z.string().optional(),
});

/**
 * GitLab API response schemas
 */
export const GitLabUserSchema = z.object({
    id: z.number(),
    username: z.string(),
    name: z.string(),
    email: z.string().email().optional(),
    avatar_url: z.string().url().optional(),
});

export const GitLabMergeRequestSchema = z.object({
    id: z.number(),
    iid: z.number(),
    title: z.string(),
    description: z.string().nullable(),
    author: GitLabUserSchema,
    assignees: z.array(GitLabUserSchema),
    reviewers: z.array(GitLabUserSchema),
    state: z.enum(['opened', 'closed', 'merged']),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    merged_at: z.string().datetime().nullable(),
    closed_at: z.string().datetime().nullable(),
    web_url: z.string().url(),
    source_branch: z.string(),
    target_branch: z.string(),
    user_notes_count: z.number().optional(),
    upvotes: z.number().optional(),
    downvotes: z.number().optional(),
    work_in_progress: z.boolean().optional(),
    has_conflicts: z.boolean().optional(),
});

/**
 * LLM provider response schemas
 */
export const OpenAIMessageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().nullable(),
    name: z.string().optional(),
    tool_calls: z.array(z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({
            name: z.string(),
            arguments: z.string(),
        }),
    })).optional(),
    tool_call_id: z.string().optional(),
});

export const OpenAIResponseSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(z.object({
        index: z.number(),
        message: OpenAIMessageSchema,
        finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']).nullable(),
    })),
    usage: z.object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
        total_tokens: z.number(),
    }).optional(),
});

export const OllamaResponseSchema = z.object({
    model: z.string(),
    created_at: z.string().datetime(),
    response: z.string().optional(),
    message: z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
    }).optional(),
    done: z.boolean(),
    context: z.array(z.number()).optional(),
    total_duration: z.number().optional(),
    load_duration: z.number().optional(),
    prompt_eval_count: z.number().optional(),
    prompt_eval_duration: z.number().optional(),
    eval_count: z.number().optional(),
    eval_duration: z.number().optional(),
});

/**
 * User input validation schemas
 */
export const FilePathSchema = z.string()
    .min(1, 'File path cannot be empty')
    .refine(
        (path) => !path.includes('..'),
        'File path cannot contain parent directory references'
    )
    .refine(
        (path) => !/[<>:"|?*]/.test(path),
        'File path contains invalid characters'
    );

export const ReviewCommandSchema = z.object({
    mode: z.enum(['file', 'changes', 'pr']),
    files: z.array(FilePathSchema).optional(),
    prId: z.string().optional(),
    options: z.object({
        includeTests: z.boolean().optional(),
        includeCoverage: z.boolean().optional(),
        depth: z.enum(['shallow', 'normal', 'deep']).optional(),
        format: z.enum(['text', 'json']).optional(),
    }).optional(),
});

export const AnalysisOptionsSchema = z.object({
    includeTests: z.boolean().optional(),
    includeCoverage: z.boolean().optional(),
    includeMetrics: z.boolean().optional(),
    depth: z.enum(['shallow', 'normal', 'deep']).optional(),
    timeout: z.number().min(1000).max(300000).optional(), // 1s to 5min
});

export const LLMProviderConfigSchema = z.object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().min(1).optional(),
    timeout: z.number().min(1000).max(300000).optional(),
    maxRetries: z.number().min(0).max(10).optional(),
});

/**
 * Runtime validation functions
 */

/**
 * Validates external API responses with detailed error reporting
 */
export async function validateExternalAPIResponse<T>(
    data: unknown,
    schema: z.ZodType<T>,
    apiName: string
): Promise<ValidationResult<T>> {
    const startTime = Date.now();
    const transformationsApplied: string[] = [];
    const warnings: string[] = [];
    const errors: z.ZodError[] = [];

    try {
        const result = schema.parse(data);
        
        return {
            success: true,
            data: result,
            originalData: data,
            transformationsApplied,
            errors,
            warnings,
            metadata: {
                schema: schema.constructor.name,
                validationTime: Date.now() - startTime,
                transformerCount: 0,
                fallbackUsed: false,
                timestamp: new Date(),
            },
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            errors.push(error);
            
            // Log detailed validation errors for debugging
            console.warn(`${apiName} API response validation failed:`, {
                errors: error.errors,
                data: typeof data === 'object' ? JSON.stringify(data, null, 2) : data,
            });
        }

        return {
            success: false,
            originalData: data,
            transformationsApplied,
            errors,
            warnings: [...warnings, `${apiName} API response validation failed`],
            metadata: {
                schema: schema.constructor.name,
                validationTime: Date.now() - startTime,
                transformerCount: 0,
                fallbackUsed: false,
                timestamp: new Date(),
            },
        };
    }
}

/**
 * Validates user input with sanitization
 */
export async function validateUserInput<T>(
    data: unknown,
    schema: z.ZodType<T>,
    inputName: string
): Promise<ValidationResult<T>> {
    const startTime = Date.now();
    const transformationsApplied: string[] = [];
    const warnings: string[] = [];
    const errors: z.ZodError[] = [];

    // Sanitize string inputs
    let sanitizedData = data;
    if (typeof data === 'string') {
        sanitizedData = sanitizeString(data);
        if (sanitizedData !== data) {
            transformationsApplied.push('string-sanitization');
            warnings.push('Input was sanitized for security');
        }
    } else if (typeof data === 'object' && data !== null) {
        sanitizedData = sanitizeObject(data as Record<string, unknown>);
        if (sanitizedData !== data) {
            transformationsApplied.push('object-sanitization');
            warnings.push('Object properties were sanitized for security');
        }
    }

    try {
        const result = schema.parse(sanitizedData);
        
        return {
            success: true,
            data: result,
            originalData: data,
            transformationsApplied,
            errors,
            warnings,
            metadata: {
                schema: schema.constructor.name,
                validationTime: Date.now() - startTime,
                transformerCount: transformationsApplied.length,
                fallbackUsed: false,
                timestamp: new Date(),
            },
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            errors.push(error);
            
            console.warn(`User input validation failed for ${inputName}:`, {
                errors: error.errors,
                originalData: data,
                sanitizedData,
            });
        }

        return {
            success: false,
            originalData: data,
            transformationsApplied,
            errors,
            warnings: [...warnings, `Invalid ${inputName} provided`],
            metadata: {
                schema: schema.constructor.name,
                validationTime: Date.now() - startTime,
                transformerCount: transformationsApplied.length,
                fallbackUsed: false,
                timestamp: new Date(),
            },
        };
    }
}

/**
 * Type guards for runtime type checking
 */
export function isValidAnalysisResult(obj: unknown): obj is AnalysisResult {
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
        'metadata' in obj &&
        typeof (obj as any).filePath === 'string' &&
        typeof (obj as any).grade === 'string' &&
        ['A', 'B', 'C', 'D', 'F'].includes((obj as any).grade) &&
        typeof (obj as any).coverage === 'number' &&
        (obj as any).coverage >= 0 &&
        (obj as any).coverage <= 100 &&
        typeof (obj as any).testsPresent === 'boolean' &&
        typeof (obj as any).value === 'string' &&
        ['high', 'medium', 'low'].includes((obj as any).value) &&
        typeof (obj as any).state === 'string' &&
        ['pass', 'warning', 'fail'].includes((obj as any).state) &&
        Array.isArray((obj as any).issues) &&
        Array.isArray((obj as any).suggestions) &&
        typeof (obj as any).summary === 'string' &&
        typeof (obj as any).metadata === 'object'
    );
}

export function isValidChatMessage(obj: unknown): obj is ChatMessage {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'role' in obj &&
        'content' in obj &&
        typeof (obj as any).role === 'string' &&
        ['system', 'user', 'assistant', 'tool'].includes((obj as any).role) &&
        typeof (obj as any).content === 'string'
    );
}

export function isValidToolCall(obj: unknown): obj is ToolCall {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'id' in obj &&
        'type' in obj &&
        'function' in obj &&
        typeof (obj as any).id === 'string' &&
        (obj as any).type === 'function' &&
        typeof (obj as any).function === 'object' &&
        (obj as any).function !== null &&
        'name' in (obj as any).function &&
        'arguments' in (obj as any).function &&
        typeof (obj as any).function.name === 'string' &&
        typeof (obj as any).function.arguments === 'string'
    );
}

export function isValidErrorContext(obj: unknown): obj is ErrorContext {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'operation' in obj &&
        'attemptNumber' in obj &&
        'timestamp' in obj &&
        typeof (obj as any).operation === 'string' &&
        typeof (obj as any).attemptNumber === 'number' &&
        (obj as any).timestamp instanceof Date
    );
}

/**
 * Safe type conversion utilities
 */
export function safeParseInt(value: unknown, defaultValue: number = 0): number {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : Math.round(value);
    }
    
    if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    }
    
    return defaultValue;
}

export function safeParseFloat(value: unknown, defaultValue: number = 0): number {
    if (typeof value === 'number') {
        return isNaN(value) ? defaultValue : value;
    }
    
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
    }
    
    return defaultValue;
}

export function safeParseBoolean(value: unknown, defaultValue: boolean = false): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    
    if (typeof value === 'string') {
        const normalized = value.toLowerCase().trim();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    
    if (typeof value === 'number') {
        return value !== 0;
    }
    
    return defaultValue;
}

export function safeParseString(value: unknown, defaultValue: string = ''): string {
    if (typeof value === 'string') {
        return value;
    }
    
    if (value === null || value === undefined) {
        return defaultValue;
    }
    
    try {
        return String(value);
    } catch {
        return defaultValue;
    }
}

export function safeParseArray<T>(
    value: unknown,
    itemParser: (item: unknown) => T,
    defaultValue: T[] = []
): T[] {
    if (!Array.isArray(value)) {
        return defaultValue;
    }
    
    try {
        return value.map(itemParser);
    } catch {
        return defaultValue;
    }
}

export function safeParseObject<T>(
    value: unknown,
    parser: (obj: Record<string, unknown>) => T,
    defaultValue: T
): T {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return defaultValue;
    }
    
    try {
        return parser(value as Record<string, unknown>);
    } catch {
        return defaultValue;
    }
}

/**
 * String sanitization utilities
 */
function sanitizeString(input: string): string {
    return input
        .replace(/[<>]/g, '') // Remove potential HTML tags
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/data:/gi, '') // Remove data: protocol
        .replace(/vbscript:/gi, '') // Remove vbscript: protocol
        .trim();
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
        const sanitizedKey = sanitizeString(key);
        
        if (typeof value === 'string') {
            sanitized[sanitizedKey] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            sanitized[sanitizedKey] = sanitizeObject(value as Record<string, unknown>);
        } else if (Array.isArray(value)) {
            sanitized[sanitizedKey] = value.map(item => 
                typeof item === 'string' ? sanitizeString(item) :
                typeof item === 'object' && item !== null ? sanitizeObject(item as Record<string, unknown>) :
                item
            );
        } else {
            sanitized[sanitizedKey] = value;
        }
    }
    
    return sanitized;
}

/**
 * Validation error formatting utilities
 */
export function formatValidationErrors(errors: z.ZodError[]): string[] {
    return errors.flatMap(error => 
        error.errors.map(issue => {
            const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
            return `${issue.message}${path}`;
        })
    );
}

export function createValidationSummary(result: ValidationResult<unknown>): string {
    const { success, errors, warnings, transformationsApplied, metadata } = result;
    
    const parts = [
        `Validation ${success ? 'succeeded' : 'failed'}`,
        `in ${metadata.validationTime}ms`,
    ];
    
    if (transformationsApplied.length > 0) {
        parts.push(`with ${transformationsApplied.length} transformations`);
    }
    
    if (warnings.length > 0) {
        parts.push(`${warnings.length} warnings`);
    }
    
    if (errors.length > 0) {
        parts.push(`${errors.length} errors`);
    }
    
    return parts.join(', ');
}

/**
 * Batch validation utilities
 */
export async function validateBatch<T>(
    items: unknown[],
    schema: z.ZodType<T>,
    options: {
        continueOnError?: boolean;
        maxConcurrency?: number;
    } = {}
): Promise<{
    results: Array<ValidationResult<T>>;
    successCount: number;
    errorCount: number;
    totalTime: number;
}> {
    const startTime = Date.now();
    const { continueOnError = true, maxConcurrency = 10 } = options;
    
    const results: Array<ValidationResult<T>> = [];
    let successCount = 0;
    let errorCount = 0;
    
    // Process items in batches to avoid overwhelming the system
    for (let i = 0; i < items.length; i += maxConcurrency) {
        const batch = items.slice(i, i + maxConcurrency);
        const batchPromises = batch.map(async (item, index) => {
            try {
                const result = await validateUserInput(item, schema, `item-${i + index}`);
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                    if (!continueOnError) {
                        throw new Error(`Validation failed for item ${i + index}`);
                    }
                }
                return result;
            } catch (error) {
                errorCount++;
                const failedResult: ValidationResult<T> = {
                    success: false,
                    originalData: item,
                    transformationsApplied: [],
                    errors: [error as z.ZodError],
                    warnings: [],
                    metadata: {
                        schema: schema.constructor.name,
                        validationTime: 0,
                        transformerCount: 0,
                        fallbackUsed: false,
                        timestamp: new Date(),
                    },
                };
                return failedResult;
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
    }
    
    return {
        results,
        successCount,
        errorCount,
        totalTime: Date.now() - startTime,
    };
}