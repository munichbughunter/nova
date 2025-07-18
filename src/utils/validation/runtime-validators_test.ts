/**
 * Tests for runtime type validation utilities
 */

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { z } from 'zod';
import {
    validateExternalAPIResponse,
    validateUserInput,
    isValidAnalysisResult,
    isValidChatMessage,
    isValidToolCall,
    isValidErrorContext,
    safeParseInt,
    safeParseFloat,
    safeParseBoolean,
    safeParseString,
    safeParseArray,
    safeParseObject,
    formatValidationErrors,
    createValidationSummary,
    validateBatch,
    GitHubPullRequestSchema,
    GitLabMergeRequestSchema,
    OpenAIResponseSchema,
    OllamaResponseSchema,
    ReviewCommandSchema,
    AnalysisOptionsSchema,
    LLMProviderConfigSchema,
} from './runtime-validators.ts';

Deno.test('validateExternalAPIResponse - valid GitHub PR response', async () => {
    const validGitHubPR = {
        id: 123,
        number: 456,
        title: 'Test PR',
        body: 'Test description',
        user: {
            id: 789,
            login: 'testuser',
            name: 'Test User',
            email: 'test@example.com',
            avatar_url: 'https://example.com/avatar.jpg',
        },
        assignees: [],
        requested_reviewers: [],
        state: 'open',
        merged: false,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        merged_at: null,
        closed_at: null,
        html_url: 'https://github.com/test/repo/pull/456',
        head: {
            ref: 'feature-branch',
            sha: 'abc123',
        },
        base: {
            ref: 'main',
            sha: 'def456',
        },
    };

    const result = await validateExternalAPIResponse(
        validGitHubPR,
        GitHubPullRequestSchema,
        'GitHub'
    );

    assert(result.success);
    assertExists(result.data);
    assertEquals(result.data.number, 456);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 0);
});

Deno.test('validateExternalAPIResponse - invalid GitHub PR response', async () => {
    const invalidGitHubPR = {
        id: 'invalid', // Should be number
        number: 456,
        title: 'Test PR',
        // Missing required fields
    };

    const result = await validateExternalAPIResponse(
        invalidGitHubPR,
        GitHubPullRequestSchema,
        'GitHub'
    );

    assert(!result.success);
    assert(result.errors.length > 0);
    assert(result.warnings.length > 0);
    assert(result.warnings.some(w => w.includes('GitHub API response validation failed')));
});

Deno.test('validateUserInput - valid review command', async () => {
    const validCommand = {
        mode: 'file',
        files: ['src/test.ts', 'src/utils.ts'],
        options: {
            includeTests: true,
            depth: 'normal',
        },
    };

    const result = await validateUserInput(
        validCommand,
        ReviewCommandSchema,
        'review command'
    );

    assert(result.success);
    assertExists(result.data);
    assertEquals(result.data.mode, 'file');
    assertEquals(result.data.files?.length, 2);
});

Deno.test('validateUserInput - sanitizes malicious input', async () => {
    const maliciousInput = {
        mode: 'file',
        files: ['<script>alert("xss")</script>test.ts'],
    };

    const result = await validateUserInput(
        maliciousInput,
        ReviewCommandSchema,
        'review command'
    );

    // Should fail validation due to invalid file path
    assert(!result.success);
    assert(result.transformationsApplied.includes('object-sanitization'));
    assert(result.warnings.some(w => w.includes('sanitized for security')));
});

Deno.test('isValidAnalysisResult - valid result', () => {
    const validResult = {
        filePath: 'src/test.ts',
        grade: 'A',
        coverage: 85,
        testsPresent: true,
        value: 'high',
        state: 'pass',
        issues: [
            {
                line: 10,
                severity: 'low',
                type: 'style',
                message: 'Consider using const instead of let',
            },
        ],
        suggestions: ['Add more tests'],
        summary: 'Good code quality',
        metadata: {
            analysisTime: 1500,
            transformationsApplied: [],
            warnings: [],
            cacheHit: false,
            timestamp: new Date(),
        },
    };

    assert(isValidAnalysisResult(validResult));
});

Deno.test('isValidAnalysisResult - invalid result', () => {
    const invalidResult = {
        filePath: 'src/test.ts',
        grade: 'X', // Invalid grade
        coverage: 150, // Invalid coverage
        testsPresent: 'yes', // Should be boolean
        // Missing required fields
    };

    assert(!isValidAnalysisResult(invalidResult));
});

Deno.test('isValidChatMessage - valid message', () => {
    const validMessage = {
        role: 'user',
        content: 'Hello, how are you?',
    };

    assert(isValidChatMessage(validMessage));
});

Deno.test('isValidChatMessage - invalid message', () => {
    const invalidMessage = {
        role: 'invalid_role',
        content: 'Hello',
    };

    assert(!isValidChatMessage(invalidMessage));
});

Deno.test('isValidToolCall - valid tool call', () => {
    const validToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
            name: 'get_weather',
            arguments: '{"location": "New York"}',
        },
    };

    assert(isValidToolCall(validToolCall));
});

Deno.test('isValidToolCall - invalid tool call', () => {
    const invalidToolCall = {
        id: 'call_123',
        type: 'invalid_type',
        function: {
            name: 'get_weather',
            // Missing arguments
        },
    };

    assert(!isValidToolCall(invalidToolCall));
});

Deno.test('isValidErrorContext - valid context', () => {
    const validContext = {
        operation: 'file_analysis',
        attemptNumber: 1,
        timestamp: new Date(),
        filePath: 'src/test.ts',
    };

    assert(isValidErrorContext(validContext));
});

Deno.test('safeParseInt - various inputs', () => {
    assertEquals(safeParseInt(42), 42);
    assertEquals(safeParseInt('42'), 42);
    assertEquals(safeParseInt('42.7'), 42);
    assertEquals(safeParseInt('invalid'), 0);
    assertEquals(safeParseInt(null), 0);
    assertEquals(safeParseInt(undefined), 0);
    assertEquals(safeParseInt('invalid', 10), 10);
});

Deno.test('safeParseFloat - various inputs', () => {
    assertEquals(safeParseFloat(42.5), 42.5);
    assertEquals(safeParseFloat('42.5'), 42.5);
    assertEquals(safeParseFloat('invalid'), 0);
    assertEquals(safeParseFloat(null), 0);
    assertEquals(safeParseFloat('invalid', 1.5), 1.5);
});

Deno.test('safeParseBoolean - various inputs', () => {
    assertEquals(safeParseBoolean(true), true);
    assertEquals(safeParseBoolean(false), false);
    assertEquals(safeParseBoolean('true'), true);
    assertEquals(safeParseBoolean('false'), false);
    assertEquals(safeParseBoolean('1'), true);
    assertEquals(safeParseBoolean('0'), false);
    assertEquals(safeParseBoolean('yes'), true);
    assertEquals(safeParseBoolean(1), true);
    assertEquals(safeParseBoolean(0), false);
    assertEquals(safeParseBoolean('invalid'), false);
    assertEquals(safeParseBoolean(null), false);
});

Deno.test('safeParseString - various inputs', () => {
    assertEquals(safeParseString('hello'), 'hello');
    assertEquals(safeParseString(42), '42');
    assertEquals(safeParseString(true), 'true');
    assertEquals(safeParseString(null), '');
    assertEquals(safeParseString(undefined), '');
    assertEquals(safeParseString(null, 'default'), 'default');
});

Deno.test('safeParseArray - various inputs', () => {
    const parser = (item: unknown) => String(item);
    
    assertEquals(safeParseArray([1, 2, 3], parser), ['1', '2', '3']);
    assertEquals(safeParseArray('not_array', parser), []);
    assertEquals(safeParseArray(null, parser), []);
    assertEquals(safeParseArray(undefined, parser, ['default']), ['default']);
});

Deno.test('safeParseObject - various inputs', () => {
    const parser = (obj: Record<string, unknown>) => ({
        name: String(obj.name || 'unknown'),
        age: Number(obj.age || 0),
    });

    const result1 = safeParseObject({ name: 'John', age: 30 }, parser, { name: 'default', age: 0 });
    assertEquals(result1.name, 'John');
    assertEquals(result1.age, 30);

    const result2 = safeParseObject('not_object', parser, { name: 'default', age: 0 });
    assertEquals(result2.name, 'default');
    assertEquals(result2.age, 0);
});

Deno.test('formatValidationErrors - formats Zod errors', () => {
    const schema = z.object({
        name: z.string(),
        age: z.number(),
    });

    try {
        schema.parse({ name: 123, age: 'invalid' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            const formatted = formatValidationErrors([error]);
            assert(formatted.length > 0);
            assert(formatted.some(msg => msg.includes('name')));
            assert(formatted.some(msg => msg.includes('age')));
        }
    }
});

Deno.test('createValidationSummary - creates summary', () => {
    const result = {
        success: true,
        originalData: { test: 'data' },
        transformationsApplied: ['type-coercion'],
        errors: [],
        warnings: ['Minor issue'],
        metadata: {
            schema: 'TestSchema',
            validationTime: 150,
            transformerCount: 1,
            fallbackUsed: false,
            timestamp: new Date(),
        },
    };

    const summary = createValidationSummary(result);
    assert(summary.includes('succeeded'));
    assert(summary.includes('150ms'));
    assert(summary.includes('1 transformations'));
    assert(summary.includes('1 warnings'));
});

Deno.test('validateBatch - validates multiple items', async () => {
    const items = [
        { mode: 'file', files: ['test1.ts'] },
        { mode: 'changes' },
        { mode: 'invalid' }, // This should fail
        { mode: 'pr', prId: '123' },
    ];

    const result = await validateBatch(items, ReviewCommandSchema, {
        continueOnError: true,
        maxConcurrency: 2,
    });

    assertEquals(result.results.length, 4);
    assertEquals(result.successCount, 3);
    assertEquals(result.errorCount, 1);
    assert(result.totalTime > 0);
});

Deno.test('OpenAI response schema validation', () => {
    const validResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: 'Hello! How can I help you today?',
                },
                finish_reason: 'stop',
            },
        ],
        usage: {
            prompt_tokens: 9,
            completion_tokens: 12,
            total_tokens: 21,
        },
    };

    const result = OpenAIResponseSchema.safeParse(validResponse);
    assert(result.success);
});

Deno.test('Ollama response schema validation', () => {
    const validResponse = {
        model: 'llama2',
        created_at: '2023-08-04T19:22:45.499127Z',
        response: 'Hello! How can I assist you today?',
        done: true,
        context: [1, 2, 3],
        total_duration: 5589157167,
        load_duration: 3013701500,
        prompt_eval_count: 26,
        prompt_eval_duration: 325953000,
        eval_count: 290,
        eval_duration: 2250893000,
    };

    const result = OllamaResponseSchema.safeParse(validResponse);
    assert(result.success);
});

Deno.test('Analysis options schema validation', () => {
    const validOptions = {
        includeTests: true,
        includeCoverage: false,
        depth: 'normal',
        timeout: 30000,
    };

    const result = AnalysisOptionsSchema.safeParse(validOptions);
    assert(result.success);
    assertEquals(result.data?.depth, 'normal');
});

Deno.test('LLM provider config schema validation', () => {
    const validConfig = {
        apiKey: 'sk-test123',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo',
        timeout: 30000,
        maxRetries: 3,
    };

    const result = LLMProviderConfigSchema.safeParse(validConfig);
    assert(result.success);
    assertEquals(result.data?.model, 'gpt-3.5-turbo');
});

Deno.test('GitLab merge request schema validation', () => {
    const validMR = {
        id: 123,
        iid: 456,
        title: 'Test MR',
        description: 'Test description',
        author: {
            id: 789,
            username: 'testuser',
            name: 'Test User',
            email: 'test@example.com',
        },
        assignees: [],
        reviewers: [],
        state: 'opened',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        merged_at: null,
        closed_at: null,
        web_url: 'https://gitlab.com/test/repo/-/merge_requests/456',
        source_branch: 'feature-branch',
        target_branch: 'main',
    };

    const result = GitLabMergeRequestSchema.safeParse(validMR);
    assert(result.success);
    assertEquals(result.data?.iid, 456);
});