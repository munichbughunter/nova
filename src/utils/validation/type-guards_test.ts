/**
 * Tests for type guards and user input validation
 */

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
    isString,
    isNumber,
    isBoolean,
    isObject,
    isArray,
    isDate,
    isFunction,
    isGrade,
    isValue,
    isState,
    isSeverity,
    isIssueType,
    isCodeIssue,
    isAnalysisResult,
    isValidationResult,
    isProcessingResult,
    isBaseService,
    isLLMProvider,
    isRepositoryService,
    isErrorContext,
    isChatMessage,
    isToolCall,
    isUser,
    isPullRequest,
    isMergeRequest,
    isFileChange,
    isDataTransformer,
    isRetryConfig,
    isErrorMetrics,
    isValidFilePath,
    isValidEmail,
    isValidUrl,
    isValidHttpUrl,
    isValidPort,
    isValidTimeout,
    isValidPercentage,
    isValidPositiveInteger,
    isValidNonNegativeInteger,
    isSafeString,
    isSafeFilename,
    isArrayOf,
    isNonEmptyArray,
    hasRequiredProperties,
    isObjectWithShape,
    isValidAnalysisOptions,
    isValidReviewCommand,
    createArrayGuard,
    createOptionalGuard,
    createUnionGuard,
    createObjectGuard,
} from './type-guards.ts';

Deno.test('Basic type guards', () => {
    // String
    assert(isString('hello'));
    assert(!isString(123));
    assert(!isString(null));
    
    // Number
    assert(isNumber(42));
    assert(isNumber(3.14));
    assert(!isNumber(NaN));
    assert(!isNumber(Infinity));
    assert(!isNumber('42'));
    
    // Boolean
    assert(isBoolean(true));
    assert(isBoolean(false));
    assert(!isBoolean('true'));
    assert(!isBoolean(1));
    
    // Object
    assert(isObject({}));
    assert(isObject({ key: 'value' }));
    assert(!isObject([]));
    assert(!isObject(null));
    assert(!isObject('string'));
    
    // Array
    assert(isArray([]));
    assert(isArray([1, 2, 3]));
    assert(!isArray({}));
    assert(!isArray('string'));
    
    // Date
    assert(isDate(new Date()));
    assert(!isDate(new Date('invalid')));
    assert(!isDate('2023-01-01'));
    assert(!isDate(1672531200000));
    
    // Function
    assert(isFunction(() => {}));
    assert(isFunction(function() {}));
    assert(!isFunction('function'));
    assert(!isFunction({}));
});

Deno.test('Enum type guards', () => {
    // Grade
    assert(isGrade('A'));
    assert(isGrade('B'));
    assert(isGrade('C'));
    assert(isGrade('D'));
    assert(isGrade('F'));
    assert(!isGrade('G'));
    assert(!isGrade('a'));
    assert(!isGrade(1));
    
    // Value
    assert(isValue('high'));
    assert(isValue('medium'));
    assert(isValue('low'));
    assert(!isValue('very-high'));
    assert(!isValue('HIGH'));
    
    // State
    assert(isState('pass'));
    assert(isState('warning'));
    assert(isState('fail'));
    assert(!isState('error'));
    assert(!isState('PASS'));
    
    // Severity
    assert(isSeverity('low'));
    assert(isSeverity('medium'));
    assert(isSeverity('high'));
    assert(!isSeverity('critical'));
    assert(!isSeverity('LOW'));
    
    // Issue Type
    assert(isIssueType('security'));
    assert(isIssueType('performance'));
    assert(isIssueType('style'));
    assert(isIssueType('bug'));
    assert(!isIssueType('warning'));
    assert(!isIssueType('SECURITY'));
});

Deno.test('isCodeIssue', () => {
    const validIssue = {
        line: 10,
        severity: 'high',
        type: 'security',
        message: 'Potential security vulnerability',
    };
    assert(isCodeIssue(validIssue));
    
    const invalidIssue1 = {
        line: 0, // Invalid line number
        severity: 'high',
        type: 'security',
        message: 'Test',
    };
    assert(!isCodeIssue(invalidIssue1));
    
    const invalidIssue2 = {
        line: 10,
        severity: 'invalid', // Invalid severity
        type: 'security',
        message: 'Test',
    };
    assert(!isCodeIssue(invalidIssue2));
    
    const invalidIssue3 = {
        line: 10,
        severity: 'high',
        type: 'invalid', // Invalid type
        message: 'Test',
    };
    assert(!isCodeIssue(invalidIssue3));
    
    const invalidIssue4 = {
        line: 10,
        severity: 'high',
        type: 'security',
        // Missing message
    };
    assert(!isCodeIssue(invalidIssue4));
});

Deno.test('isAnalysisResult', () => {
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
                message: 'Consider using const',
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
    assert(isAnalysisResult(validResult));
    
    const invalidResult1 = {
        ...validResult,
        coverage: 150, // Invalid coverage
    };
    assert(!isAnalysisResult(invalidResult1));
    
    const invalidResult2 = {
        ...validResult,
        issues: [
            {
                line: 10,
                severity: 'invalid', // Invalid issue
                type: 'style',
                message: 'Test',
            },
        ],
    };
    assert(!isAnalysisResult(invalidResult2));
});

Deno.test('isValidationResult', () => {
    const validResult = {
        success: true,
        data: { test: 'data' },
        originalData: { test: 'original' },
        transformationsApplied: ['type-coercion'],
        errors: [],
        warnings: ['Minor warning'],
        metadata: {
            schema: 'TestSchema',
            validationTime: 150,
            transformerCount: 1,
            fallbackUsed: false,
            timestamp: new Date(),
        },
    };
    assert(isValidationResult(validResult));
    
    const invalidResult = {
        success: true,
        // Missing required fields
    };
    assert(!isValidationResult(invalidResult));
});

Deno.test('isProcessingResult', () => {
    const validResult = {
        success: true,
        data: { test: 'data' },
        errors: [],
        warnings: ['Warning'],
        fallbackUsed: false,
        processingTime: 1500,
        metadata: {
            rawResponseLength: 100,
            cleanedResponseLength: 90,
            transformationsApplied: [],
            retryCount: 0,
            timestamp: new Date(),
        },
    };
    assert(isProcessingResult(validResult));
    
    const invalidResult = {
        success: true,
        // Missing required fields
    };
    assert(!isProcessingResult(invalidResult));
});

Deno.test('isBaseService', () => {
    const validService = {
        name: 'TestService',
        version: '1.0.0',
        isHealthy: async () => true,
    };
    assert(isBaseService(validService));
    
    const invalidService = {
        name: 'TestService',
        // Missing version and isHealthy
    };
    assert(!isBaseService(invalidService));
});

Deno.test('isErrorContext', () => {
    const validContext = {
        operation: 'file_analysis',
        attemptNumber: 1,
        timestamp: new Date(),
        filePath: 'src/test.ts',
    };
    assert(isErrorContext(validContext));
    
    const invalidContext1 = {
        operation: 'file_analysis',
        attemptNumber: -1, // Invalid attempt number
        timestamp: new Date(),
    };
    assert(!isErrorContext(invalidContext1));
    
    const invalidContext2 = {
        operation: 'file_analysis',
        attemptNumber: 1,
        timestamp: 'invalid-date', // Invalid timestamp
    };
    assert(!isErrorContext(invalidContext2));
});

Deno.test('isChatMessage', () => {
    const validMessage = {
        role: 'user',
        content: 'Hello, how are you?',
        name: 'John',
    };
    assert(isChatMessage(validMessage));
    
    const invalidMessage1 = {
        role: 'invalid_role', // Invalid role
        content: 'Hello',
    };
    assert(!isChatMessage(invalidMessage1));
    
    const invalidMessage2 = {
        role: 'user',
        // Missing content
    };
    assert(!isChatMessage(invalidMessage2));
});

Deno.test('isToolCall', () => {
    const validToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
            name: 'get_weather',
            arguments: '{"location": "New York"}',
        },
    };
    assert(isToolCall(validToolCall));
    
    const invalidToolCall1 = {
        id: 'call_123',
        type: 'invalid_type', // Invalid type
        function: {
            name: 'get_weather',
            arguments: '{}',
        },
    };
    assert(!isToolCall(invalidToolCall1));
    
    const invalidToolCall2 = {
        id: 'call_123',
        type: 'function',
        function: {
            name: 'get_weather',
            // Missing arguments
        },
    };
    assert(!isToolCall(invalidToolCall2));
});

Deno.test('isUser', () => {
    const validUser = {
        id: '123',
        username: 'johndoe',
        name: 'John Doe',
        email: 'john@example.com',
    };
    assert(isUser(validUser));
    
    const invalidUser = {
        id: '123',
        username: 'johndoe',
        // Missing name
    };
    assert(!isUser(invalidUser));
});

Deno.test('isPullRequest', () => {
    const validPR = {
        id: '123',
        number: 456,
        title: 'Test PR',
        description: 'Test description',
        author: {
            id: '789',
            username: 'testuser',
            name: 'Test User',
        },
        assignees: [],
        reviewers: [],
        state: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
        url: 'https://github.com/test/repo/pull/456',
        sourceBranch: 'feature',
        targetBranch: 'main',
        commits: 5,
        additions: 100,
        deletions: 50,
        changedFiles: 3,
    };
    assert(isPullRequest(validPR));
    
    const invalidPR = {
        ...validPR,
        state: 'invalid_state', // Invalid state
    };
    assert(!isPullRequest(invalidPR));
});

Deno.test('Validation guards for user input', () => {
    // Valid file paths
    assert(isValidFilePath('src/test.ts'));
    assert(isValidFilePath('docs/README.md'));
    assert(isValidFilePath('package.json'));
    
    // Invalid file paths
    assert(!isValidFilePath(''));
    assert(!isValidFilePath('../../../etc/passwd'));
    assert(!isValidFilePath('file<script>alert()</script>.ts'));
    assert(!isValidFilePath('file\x00.ts'));
    
    // Valid emails
    assert(isValidEmail('test@example.com'));
    assert(isValidEmail('user.name+tag@domain.co.uk'));
    
    // Invalid emails
    assert(!isValidEmail('invalid-email'));
    assert(!isValidEmail('test@'));
    assert(!isValidEmail('@example.com'));
    
    // Valid URLs
    assert(isValidUrl('https://example.com'));
    assert(isValidUrl('http://localhost:3000'));
    assert(isValidUrl('ftp://files.example.com'));
    
    // Invalid URLs
    assert(!isValidUrl('not-a-url'));
    assert(!isValidUrl('http://'));
    
    // Valid HTTP URLs
    assert(isValidHttpUrl('https://example.com'));
    assert(isValidHttpUrl('http://localhost:3000'));
    
    // Invalid HTTP URLs
    assert(!isValidHttpUrl('ftp://files.example.com'));
    assert(!isValidHttpUrl('file:///path/to/file'));
    
    // Valid ports
    assert(isValidPort(80));
    assert(isValidPort(443));
    assert(isValidPort(3000));
    assert(isValidPort(65535));
    
    // Invalid ports
    assert(!isValidPort(0));
    assert(!isValidPort(65536));
    assert(!isValidPort(3000.5));
    assert(!isValidPort(-1));
    
    // Valid timeouts
    assert(isValidTimeout(1000));
    assert(isValidTimeout(30000));
    assert(isValidTimeout(300000));
    
    // Invalid timeouts
    assert(!isValidTimeout(0));
    assert(!isValidTimeout(300001));
    assert(!isValidTimeout(-1000));
    
    // Valid percentages
    assert(isValidPercentage(0));
    assert(isValidPercentage(50));
    assert(isValidPercentage(100));
    assert(isValidPercentage(75.5));
    
    // Invalid percentages
    assert(!isValidPercentage(-1));
    assert(!isValidPercentage(101));
    assert(!isValidPercentage(NaN));
    
    // Valid positive integers
    assert(isValidPositiveInteger(1));
    assert(isValidPositiveInteger(100));
    
    // Invalid positive integers
    assert(!isValidPositiveInteger(0));
    assert(!isValidPositiveInteger(-1));
    assert(!isValidPositiveInteger(1.5));
    
    // Valid non-negative integers
    assert(isValidNonNegativeInteger(0));
    assert(isValidNonNegativeInteger(1));
    assert(isValidNonNegativeInteger(100));
    
    // Invalid non-negative integers
    assert(!isValidNonNegativeInteger(-1));
    assert(!isValidNonNegativeInteger(1.5));
});

Deno.test('Safety guards', () => {
    // Safe strings
    assert(isSafeString('Hello world'));
    assert(isSafeString('This is a normal string'));
    
    // Unsafe strings
    assert(!isSafeString('<script>alert("xss")</script>'));
    assert(!isSafeString('javascript:alert("xss")'));
    assert(!isSafeString('vbscript:msgbox("xss")'));
    assert(!isSafeString('data:text/html,<script>alert("xss")</script>'));
    assert(!isSafeString('<div onclick="alert()">Click me</div>'));
    
    // Safe filenames
    assert(isSafeFilename('document.txt'));
    assert(isSafeFilename('my-file.pdf'));
    assert(isSafeFilename('image_001.jpg'));
    
    // Unsafe filenames
    assert(!isSafeFilename('CON'));
    assert(!isSafeFilename('PRN'));
    assert(!isSafeFilename('file<script>.txt'));
    assert(!isSafeFilename('file|pipe.txt'));
    assert(!isSafeFilename('file\x00.txt'));
    assert(!isSafeFilename('a'.repeat(256))); // Too long
});

Deno.test('Array validation guards', () => {
    // isArrayOf
    assert(isArrayOf([1, 2, 3], isNumber));
    assert(isArrayOf(['a', 'b', 'c'], isString));
    assert(!isArrayOf([1, 'a', 3], isNumber));
    assert(!isArrayOf('not-array', isString));
    
    // isNonEmptyArray
    assert(isNonEmptyArray([1, 2, 3]));
    assert(isNonEmptyArray(['a'], isString));
    assert(!isNonEmptyArray([]));
    assert(!isNonEmptyArray('not-array'));
    assert(!isNonEmptyArray([1, 'a'], isNumber));
});

Deno.test('Object validation guards', () => {
    // hasRequiredProperties
    const obj = { name: 'John', age: 30, email: 'john@example.com' };
    assert(hasRequiredProperties(obj, ['name', 'age']));
    assert(!hasRequiredProperties(obj, ['name', 'phone']));
    assert(!hasRequiredProperties('not-object', ['name']));
    
    // isObjectWithShape
    const shape = {
        name: isString,
        age: isNumber,
        active: isBoolean,
    };
    
    const validObj = { name: 'John', age: 30, active: true };
    const invalidObj = { name: 'John', age: '30', active: true };
    
    assert(isObjectWithShape(validObj, shape));
    assert(!isObjectWithShape(invalidObj, shape));
});

Deno.test('Composite validation guards', () => {
    // isValidAnalysisOptions
    const validOptions1 = {
        includeTests: true,
        depth: 'normal',
        timeout: 30000,
    };
    assert(isValidAnalysisOptions(validOptions1));
    
    const validOptions2 = {}; // Empty options should be valid
    assert(isValidAnalysisOptions(validOptions2));
    
    const invalidOptions = {
        includeTests: 'yes', // Should be boolean
        depth: 'normal',
    };
    assert(!isValidAnalysisOptions(invalidOptions));
    
    // isValidReviewCommand
    const validCommand1 = {
        mode: 'file',
        files: ['src/test.ts'],
    };
    assert(isValidReviewCommand(validCommand1));
    
    const validCommand2 = {
        mode: 'pr',
        prId: '123',
    };
    assert(isValidReviewCommand(validCommand2));
    
    const invalidCommand = {
        mode: 'invalid_mode',
        files: ['test.ts'],
    };
    assert(!isValidReviewCommand(invalidCommand));
});

Deno.test('Guard composition utilities', () => {
    // createArrayGuard
    const stringArrayGuard = createArrayGuard(isString);
    assert(stringArrayGuard(['a', 'b', 'c']));
    assert(!stringArrayGuard([1, 2, 3]));
    
    // createOptionalGuard
    const optionalStringGuard = createOptionalGuard(isString);
    assert(optionalStringGuard('hello'));
    assert(optionalStringGuard(undefined));
    assert(!optionalStringGuard(123));
    
    // createUnionGuard
    const stringOrNumberGuard = createUnionGuard(isString, isNumber);
    assert(stringOrNumberGuard('hello'));
    assert(stringOrNumberGuard(123));
    assert(!stringOrNumberGuard(true));
    
    // createObjectGuard
    const personGuard = createObjectGuard({
        name: isString,
        age: isNumber,
    });
    
    assert(personGuard({ name: 'John', age: 30 }));
    assert(!personGuard({ name: 'John', age: '30' }));
    assert(!personGuard('not-object'));
});

Deno.test('Complex type guards', () => {
    // isDataTransformer
    const validTransformer = {
        name: 'test-transformer',
        description: 'Test transformer',
        transform: (data: unknown) => data,
        canTransform: (data: unknown, targetType: string) => true,
        priority: 10,
    };
    assert(isDataTransformer(validTransformer));
    
    const invalidTransformer = {
        name: 'test-transformer',
        // Missing required methods
    };
    assert(!isDataTransformer(invalidTransformer));
    
    // isRetryConfig
    const validRetryConfig = {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterMs: 100,
    };
    assert(isRetryConfig(validRetryConfig));
    
    const invalidRetryConfig = {
        maxAttempts: 0, // Invalid
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
    };
    assert(!isRetryConfig(invalidRetryConfig));
    
    // isErrorMetrics
    const validMetrics = {
        totalErrors: 10,
        errorsByType: { validation: 5, network: 3 },
        errorsByOperation: { analysis: 8, validation: 2 },
        retryAttempts: 15,
        successfulRetries: 12,
        failedRetries: 3,
        fallbacksUsed: 2,
        fallbackSuccesses: 2,
        fallbackFailures: 0,
        averageRetryDelay: 2500,
        errorRecoveryRate: 0.8,
        lastResetTime: new Date(),
    };
    assert(isErrorMetrics(validMetrics));
    
    const invalidMetrics = {
        totalErrors: 10,
        // Missing required fields
    };
    assert(!isErrorMetrics(invalidMetrics));
});