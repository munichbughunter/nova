/**
 * Tests for type-safe error handling
 */

import { assertEquals, assertExists, assert, assertInstanceOf } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { z } from 'zod';
import {
    TypedError,
    ValidationError,
    LLMProviderError,
    APIError,
    NetworkError,
    AuthenticationError,
    PermissionError,
    RateLimitError,
    FileError,
    TimeoutError,
    ServiceUnavailableError,
    GitError,
    ConfigurationError,
    UnknownError,
    TypedErrorFactory,
    isTypedError,
    isValidationError,
    isLLMProviderError,
    isAPIError,
    isNetworkError,
    isRetryableError,
    getErrorSeverity,
    getErrorType,
} from './type-safe-errors.ts';
import { ErrorType, ErrorSeverity } from './types.ts';

Deno.test('ValidationError - from Zod error', () => {
    const schema = z.object({
        name: z.string(),
        age: z.number(),
    });

    try {
        schema.parse({ name: 123, age: 'invalid' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            const validationErrors = ValidationError.fromZodError(error);
            
            assert(validationErrors.length > 0);
            assert(validationErrors.every(e => e instanceof ValidationError));
            assert(validationErrors.every(e => e.type === ErrorType.VALIDATION));
            assert(validationErrors.every(e => e.severity === ErrorSeverity.MEDIUM));
            assert(validationErrors.every(e => !e.retryable));
        }
    }
});

Deno.test('ValidationError - single field error', () => {
    const details = {
        field: 'age',
        expectedType: 'number',
        actualType: 'string',
        value: 'invalid',
        message: 'Expected number, received string',
    };

    const error = new ValidationError('Validation failed', details);
    
    assertEquals(error.type, ErrorType.VALIDATION);
    assertEquals(error.severity, ErrorSeverity.MEDIUM);
    assertEquals(error.retryable, false);
    assertEquals(error.details, details);
    assertExists(error.userGuidance);
    assert(error.userGuidance!.includes('age'));
    assert(error.userGuidance!.includes('number'));
});

Deno.test('LLMProviderError - rate limit', () => {
    const details = {
        provider: 'openai',
        statusCode: 429,
        rateLimitInfo: {
            limit: 1000,
            remaining: 0,
            resetTime: new Date(Date.now() + 60000), // 1 minute from now
        },
    };

    const error = new LLMProviderError('Rate limit exceeded', details);
    
    assertEquals(error.type, ErrorType.LLM_PROVIDER);
    assertEquals(error.severity, ErrorSeverity.MEDIUM);
    assertEquals(error.retryable, true);
    assertExists(error.userGuidance);
    assert(error.userGuidance!.includes('Rate limit exceeded'));
    
    const retryDelay = error.getRetryDelay(1);
    assert(retryDelay > 0);
    assert(retryDelay <= 60000); // Should be within the reset time
});

Deno.test('LLMProviderError - server error', () => {
    const details = {
        provider: 'ollama',
        statusCode: 500,
    };

    const error = new LLMProviderError('Internal server error', details);
    
    assertEquals(error.severity, ErrorSeverity.HIGH);
    assertEquals(error.retryable, true);
    assertExists(error.userGuidance);
    assert(error.userGuidance!.includes('temporarily unavailable'));
});

Deno.test('APIError - different status codes', () => {
    const testCases = [
        { statusCode: 401, expectedSeverity: ErrorSeverity.MEDIUM, expectedRetryable: false },
        { statusCode: 403, expectedSeverity: ErrorSeverity.MEDIUM, expectedRetryable: false },
        { statusCode: 404, expectedSeverity: ErrorSeverity.MEDIUM, expectedRetryable: false },
        { statusCode: 429, expectedSeverity: ErrorSeverity.MEDIUM, expectedRetryable: true },
        { statusCode: 500, expectedSeverity: ErrorSeverity.HIGH, expectedRetryable: true },
        { statusCode: 502, expectedSeverity: ErrorSeverity.HIGH, expectedRetryable: true },
    ];

    for (const { statusCode, expectedSeverity, expectedRetryable } of testCases) {
        const details = {
            endpoint: '/api/test',
            method: 'GET',
            statusCode,
        };

        const error = new APIError(`HTTP ${statusCode}`, details);
        
        assertEquals(error.type, ErrorType.API_REQUEST);
        assertEquals(error.severity, expectedSeverity);
        assertEquals(error.retryable, expectedRetryable);
        assertExists(error.userGuidance);
    }
});

Deno.test('NetworkError - retry delay', () => {
    const details = {
        host: 'api.example.com',
        port: 443,
        protocol: 'https',
    };

    const error = new NetworkError('Connection failed', details);
    
    assertEquals(error.type, ErrorType.NETWORK);
    assertEquals(error.severity, ErrorSeverity.HIGH);
    assertEquals(error.retryable, true);
    
    const delay1 = error.getRetryDelay(1);
    const delay2 = error.getRetryDelay(2);
    const delay3 = error.getRetryDelay(3);
    
    assert(delay2 > delay1); // Exponential backoff
    assert(delay3 > delay2);
    assert(delay3 <= 60000); // Max delay cap
});

Deno.test('AuthenticationError', () => {
    const error = new AuthenticationError('Invalid API key', 'github');
    
    assertEquals(error.type, ErrorType.AUTHENTICATION);
    assertEquals(error.severity, ErrorSeverity.HIGH);
    assertEquals(error.retryable, false);
    assertEquals(error.service, 'github');
    assertExists(error.userGuidance);
    assert(error.userGuidance!.includes('github'));
});

Deno.test('PermissionError', () => {
    const error = new PermissionError(
        'Access denied',
        '/api/admin',
        'admin:read'
    );
    
    assertEquals(error.type, ErrorType.PERMISSION);
    assertEquals(error.severity, ErrorSeverity.MEDIUM);
    assertEquals(error.retryable, false);
    assertEquals(error.resource, '/api/admin');
    assertEquals(error.requiredPermission, 'admin:read');
});

Deno.test('RateLimitError - with reset time', () => {
    const resetTime = new Date(Date.now() + 300000); // 5 minutes from now
    const error = new RateLimitError(
        'Too many requests',
        resetTime,
        1000,
        0
    );
    
    assertEquals(error.type, ErrorType.RATE_LIMIT);
    assertEquals(error.severity, ErrorSeverity.MEDIUM);
    assertEquals(error.retryable, true);
    assertEquals(error.resetTime, resetTime);
    assertEquals(error.limit, 1000);
    assertEquals(error.remaining, 0);
    
    const retryDelay = error.getRetryDelay(1);
    assert(retryDelay > 0);
    assert(retryDelay <= 300000); // Should be within reset time
});

Deno.test('FileError - different operations', () => {
    const testCases = [
        { operation: 'read', expectedRetryable: true },
        { operation: 'write', expectedRetryable: false },
        { operation: 'delete', expectedRetryable: false },
        { operation: 'create', expectedRetryable: false },
        { operation: 'access', expectedRetryable: true },
    ];

    for (const { operation, expectedRetryable } of testCases) {
        const details = {
            filePath: '/path/to/file.txt',
            operation: operation as any,
        };

        const error = new FileError(`Cannot ${operation} file`, details);
        
        assertEquals(error.type, ErrorType.FILE_NOT_FOUND);
        assertEquals(error.severity, ErrorSeverity.MEDIUM);
        assertEquals(error.retryable, expectedRetryable);
        assertExists(error.userGuidance);
        assert(error.userGuidance!.includes(operation));
    }
});

Deno.test('TimeoutError', () => {
    const error = new TimeoutError('Operation timed out', 30000, 'api_call');
    
    assertEquals(error.type, ErrorType.TIMEOUT);
    assertEquals(error.severity, ErrorSeverity.MEDIUM);
    assertEquals(error.retryable, true);
    assertEquals(error.timeoutMs, 30000);
    assertEquals(error.operation, 'api_call');
    assertExists(error.userGuidance);
    assert(error.userGuidance!.includes('30000ms'));
});

Deno.test('ServiceUnavailableError - with recovery time', () => {
    const recoveryTime = new Date(Date.now() + 600000); // 10 minutes from now
    const error = new ServiceUnavailableError(
        'Service is down',
        'database',
        recoveryTime
    );
    
    assertEquals(error.type, ErrorType.SERVICE_UNAVAILABLE);
    assertEquals(error.severity, ErrorSeverity.HIGH);
    assertEquals(error.retryable, true);
    assertEquals(error.serviceName, 'database');
    assertEquals(error.estimatedRecoveryTime, recoveryTime);
    
    const retryDelay = error.getRetryDelay(1);
    assert(retryDelay > 0);
    assert(retryDelay <= 600000); // Should be within recovery time
});

Deno.test('GitError - different operations', () => {
    const testCases = [
        { operation: 'fetch', expectedRetryable: true },
        { operation: 'pull', expectedRetryable: true },
        { operation: 'push', expectedRetryable: false },
        { operation: 'commit', expectedRetryable: false },
        { operation: 'checkout', expectedRetryable: false },
    ];

    for (const { operation, expectedRetryable } of testCases) {
        const details = {
            repository: 'https://github.com/test/repo.git',
            operation,
            branch: 'main',
        };

        const error = new GitError(`Git ${operation} failed`, details);
        
        assertEquals(error.type, ErrorType.GIT_OPERATION);
        assertEquals(error.severity, ErrorSeverity.MEDIUM);
        assertEquals(error.retryable, expectedRetryable);
        assertExists(error.userGuidance);
        assert(error.userGuidance!.includes(operation));
    }
});

Deno.test('ConfigurationError', () => {
    const error = new ConfigurationError(
        'Invalid API key',
        'llm.apiKey',
        'a valid API key starting with sk-'
    );
    
    assertEquals(error.type, ErrorType.CONFIGURATION);
    assertEquals(error.severity, ErrorSeverity.HIGH);
    assertEquals(error.retryable, false);
    assertEquals(error.configKey, 'llm.apiKey');
    assertEquals(error.expectedValue, 'a valid API key starting with sk-');
    assertExists(error.userGuidance);
    assert(error.userGuidance!.includes('llm.apiKey'));
});

Deno.test('UnknownError', () => {
    const originalError = new Error('Something went wrong');
    const error = new UnknownError('Unknown error occurred', originalError);
    
    assertEquals(error.type, ErrorType.UNKNOWN);
    assertEquals(error.severity, ErrorSeverity.MEDIUM);
    assertEquals(error.retryable, true);
    assertEquals(error.originalError, originalError);
});

Deno.test('TypedErrorFactory - createFromUnknown', () => {
    // Test with TypedError (should return as-is)
    const typedError = new ValidationError('Test', {
        field: 'test',
        expectedType: 'string',
        actualType: 'number',
        value: 123,
        message: 'Test',
    });
    const result1 = TypedErrorFactory.createFromUnknown(typedError);
    assertEquals(result1, typedError);
    
    // Test with ZodError
    const schema = z.object({ name: z.string() });
    try {
        schema.parse({ name: 123 });
    } catch (zodError) {
        const result2 = TypedErrorFactory.createFromUnknown(zodError);
        assert(isValidationError(result2));
    }
    
    // Test with standard Error
    const standardError = new Error('Network connection failed');
    const result3 = TypedErrorFactory.createFromUnknown(standardError);
    assert(isNetworkError(result3));
    
    // Test with string
    const result4 = TypedErrorFactory.createFromUnknown('Something went wrong');
    assertInstanceOf(result4, UnknownError);
    assertEquals(result4.message, 'Something went wrong');
    
    // Test with object
    const result5 = TypedErrorFactory.createFromUnknown({ message: 'Object error' });
    assertInstanceOf(result5, UnknownError);
    assertEquals(result5.message, 'Object error');
    
    // Test with null
    const result6 = TypedErrorFactory.createFromUnknown(null);
    assertInstanceOf(result6, UnknownError);
});

Deno.test('TypedErrorFactory - createFromError patterns', () => {
    const testCases = [
        { message: 'Network timeout', expectedType: NetworkError },
        { message: 'Connection refused', expectedType: NetworkError },
        { message: 'Authentication failed', expectedType: AuthenticationError },
        { message: 'Unauthorized access', expectedType: AuthenticationError },
        { message: 'Permission denied', expectedType: PermissionError },
        { message: 'Access denied', expectedType: PermissionError },
        { message: 'Rate limit exceeded', expectedType: RateLimitError },
        { message: 'Too many requests', expectedType: RateLimitError },
        { message: 'File not found', expectedType: FileError },
        { message: 'ENOENT: no such file', expectedType: FileError },
        { message: 'Request timeout', expectedType: TimeoutError },
        { message: 'Service unavailable', expectedType: ServiceUnavailableError },
        { message: 'Server error', expectedType: ServiceUnavailableError },
        { message: 'Git push failed', expectedType: GitError },
        { message: 'Configuration error', expectedType: ConfigurationError },
        { message: 'Config missing', expectedType: ConfigurationError },
        { message: 'Random error', expectedType: UnknownError },
    ];

    for (const { message, expectedType } of testCases) {
        const error = new Error(message);
        const result = TypedErrorFactory.createFromUnknown(error);
        assertInstanceOf(result, expectedType);
    }
});

Deno.test('TypedErrorFactory - createFromHttpResponse', () => {
    const response = {
        status: 404,
        statusText: 'Not Found',
        url: 'https://api.example.com/users/123',
    };

    const error = TypedErrorFactory.createFromHttpResponse(response, 'User not found');
    
    assertInstanceOf(error, APIError);
    assertEquals(error.details.statusCode, 404);
    assertEquals(error.details.endpoint, 'https://api.example.com/users/123');
    assertEquals(error.details.responseBody, 'User not found');
});

Deno.test('TypedErrorFactory - createFromFetchError', () => {
    // Test AbortError
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    
    const result1 = TypedErrorFactory.createFromFetchError(abortError, 'https://api.example.com');
    assertInstanceOf(result1, TimeoutError);
    
    // Test network error
    const networkError = new Error('fetch failed');
    const result2 = TypedErrorFactory.createFromFetchError(networkError, 'https://api.example.com');
    assertInstanceOf(result2, NetworkError);
    
    // Test generic error
    const genericError = new Error('Something went wrong');
    const result3 = TypedErrorFactory.createFromFetchError(genericError, 'https://api.example.com');
    assertInstanceOf(result3, APIError);
});

Deno.test('Type guards', () => {
    const validationError = new ValidationError('Test', {
        field: 'test',
        expectedType: 'string',
        actualType: 'number',
        value: 123,
        message: 'Test',
    });
    const networkError = new NetworkError('Test', {});
    const standardError = new Error('Test');

    // isTypedError
    assert(isTypedError(validationError));
    assert(isTypedError(networkError));
    assert(!isTypedError(standardError));
    
    // isValidationError
    assert(isValidationError(validationError));
    assert(!isValidationError(networkError));
    assert(!isValidationError(standardError));
    
    // isNetworkError
    assert(isNetworkError(networkError));
    assert(!isNetworkError(validationError));
    assert(!isNetworkError(standardError));
    
    // isRetryableError
    assert(!isRetryableError(validationError)); // Not retryable
    assert(isRetryableError(networkError)); // Retryable
    assert(!isRetryableError(standardError)); // Not a typed error
});

Deno.test('Error severity and type getters', () => {
    const validationError = new ValidationError('Test', {
        field: 'test',
        expectedType: 'string',
        actualType: 'number',
        value: 123,
        message: 'Test',
    });
    const networkError = new NetworkError('Test', {});
    const standardError = new Error('Test');

    // getErrorSeverity
    assertEquals(getErrorSeverity(validationError), ErrorSeverity.MEDIUM);
    assertEquals(getErrorSeverity(networkError), ErrorSeverity.HIGH);
    assertEquals(getErrorSeverity(standardError), ErrorSeverity.MEDIUM); // Default
    
    // getErrorType
    assertEquals(getErrorType(validationError), ErrorType.VALIDATION);
    assertEquals(getErrorType(networkError), ErrorType.NETWORK);
    assertEquals(getErrorType(standardError), ErrorType.UNKNOWN); // Default
});

Deno.test('TypedError - toEnhancedError', () => {
    const error = new ValidationError('Test validation error', {
        field: 'age',
        expectedType: 'number',
        actualType: 'string',
        value: 'invalid',
        message: 'Expected number',
    });

    const enhanced = error.toEnhancedError();
    
    assertEquals(enhanced.type, ErrorType.VALIDATION);
    assertEquals(enhanced.severity, ErrorSeverity.MEDIUM);
    assertEquals(enhanced.message, 'Test validation error');
    assertEquals(enhanced.originalError, error);
    assertEquals(enhanced.retryable, false);
    assertExists(enhanced.context);
    assertExists(enhanced.timestamp);
});

Deno.test('TypedError - shouldRetry', () => {
    const retryableError = new NetworkError('Test', {});
    const nonRetryableError = new ValidationError('Test', {
        field: 'test',
        expectedType: 'string',
        actualType: 'number',
        value: 123,
        message: 'Test',
    });

    assert(retryableError.shouldRetry(1, 3));
    assert(retryableError.shouldRetry(2, 3));
    assert(!retryableError.shouldRetry(3, 3)); // At max attempts
    assert(!retryableError.shouldRetry(4, 3)); // Exceeded max attempts
    
    assert(!nonRetryableError.shouldRetry(1, 3)); // Not retryable
});

Deno.test('TypedError - getRetryDelay', () => {
    const retryableError = new NetworkError('Test', {});
    const nonRetryableError = new ValidationError('Test', {
        field: 'test',
        expectedType: 'string',
        actualType: 'number',
        value: 123,
        message: 'Test',
    });

    const delay1 = retryableError.getRetryDelay(1);
    const delay2 = retryableError.getRetryDelay(2);
    const delay3 = retryableError.getRetryDelay(3);
    
    assert(delay1 > 0);
    assert(delay2 > delay1); // Exponential backoff
    assert(delay3 > delay2);
    
    assertEquals(nonRetryableError.getRetryDelay(1), 0); // Not retryable
});