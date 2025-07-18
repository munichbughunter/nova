/**
 * Integration tests for the Enhanced Code Review Agent with new architecture
 */

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { EnhancedCodeReviewAgent } from './enhanced-code-review-agent.ts';
import type { AgentContext } from './types.ts';
import { Logger } from '../utils/logger.ts';

// Mock LLM Provider for testing
class MockLLMProvider {
    constructor(public name: string = 'MockLLM') {}

    async generate(prompt: string): Promise<string> {
        // Return a mock response that should be processed by the new architecture
        return JSON.stringify({
            grade: 'B',
            coverage: '75%', // String value that should be transformed to number
            testsPresent: 'true', // String value that should be transformed to boolean
            value: 'high',
            state: 'pass',
            issues: [],
            suggestions: ['Add more comprehensive tests'],
            summary: 'Good code with room for improvement'
        });
    }

    async generateObject<T>(prompt: string, schema: any): Promise<T> {
        const response = await this.generate(prompt);
        return JSON.parse(response) as T;
    }

    async isAvailable(): Promise<boolean> {
        return true;
    }

    async listModels(): Promise<string[]> {
        return ['mock-model'];
    }

    async setModel(model: string): Promise<void> {
        // Mock implementation
    }

    async chat(messages: any[]): Promise<{ content: string; tool_calls?: any[] }> {
        const content = await this.generate(messages.map(m => m.content).join('\n'));
        return { content };
    }
}

// Mock file reading function
function createMockReadFile(fileContent: string) {
    return async (_context: AgentContext, _filePath: string) => {
        return {
            success: true,
            data: fileContent
        };
    };
}

// Helper function to create mock context
function createMockContext(mockLLMProvider?: MockLLMProvider): AgentContext {
    const logger = new Logger('test');
    return {
        workingDirectory: '/test',
        llmProvider: mockLLMProvider || new MockLLMProvider(),
        config: {
            gitlab: { url: 'https://gitlab.com', token: 'test-token' },
            github: { apiUrl: 'https://api.github.com', token: 'test-token' },
            review: { autoPostComments: true, severityThreshold: 'medium', maxFilesPerReview: 50 }
        } as any,
        logger
    };
}

Deno.test('EnhancedCodeReviewAgent - Integration with new architecture', async () => {
    const mockContext = createMockContext();
    const agent = new EnhancedCodeReviewAgent(mockContext);
    assertExists(agent);
});

Deno.test('EnhancedCodeReviewAgent - File review with LLM response transformation', async () => {
    const mockLLMProvider = new MockLLMProvider();
    const mockContext = createMockContext(mockLLMProvider);
    const agent = new EnhancedCodeReviewAgent(mockContext);
    
    // Mock the readFile function to return test content
    const originalReadFile = (globalThis as any).readFile;
    (globalThis as any).readFile = createMockReadFile(`
        function testFunction() {
            console.log('Hello, World!');
        }
    `);

    try {
        const response = await agent.execute('review src/test.ts');
        
        // Verify the response is successful
        assertEquals(response.success, true);
        
        // Verify the response contains review results
        assertStringIncludes(response.content, 'Code Review Results');
        assertStringIncludes(response.content, 'src/test.ts');
        
        // Verify that the new architecture processed the response correctly
        // The LLM returned "75%" as a string, but it should be converted to 75 as a number
        assertStringIncludes(response.content, '75%');
        
        // Verify that boolean transformation worked
        // The LLM returned "true" as a string, but it should be converted to boolean
        assertStringIncludes(response.content, '✅'); // Tests present indicator
        
    } finally {
        // Restore original readFile function
        (globalThis as any).readFile = originalReadFile;
    }
});

Deno.test('EnhancedCodeReviewAgent - Error handling with new architecture', async () => {
    const mockLLMProvider = new MockLLMProvider();
    
    // Override the generate method to return invalid JSON
    mockLLMProvider.generate = async (_prompt: string): Promise<string> => {
        return 'Invalid JSON response that should trigger error handling';
    };
    
    const mockContext = createMockContext(mockLLMProvider);
    const agent = new EnhancedCodeReviewAgent(mockContext);
    
    // Mock the readFile function to return test content
    const originalReadFile = (globalThis as any).readFile;
    (globalThis as any).readFile = createMockReadFile(`
        function testFunction() {
            console.log('Hello, World!');
        }
    `);

    try {
        const response = await agent.execute('review src/test.ts');
        
        // Verify the response is still successful (should fall back to rule-based analysis)
        assertEquals(response.success, true);
        
        // Verify the response contains review results (from fallback)
        assertStringIncludes(response.content, 'Code Review Results');
        assertStringIncludes(response.content, 'src/test.ts');
        
    } finally {
        // Restore original readFile function
        (globalThis as any).readFile = originalReadFile;
    }
});

Deno.test('EnhancedCodeReviewAgent - Validation service integration', async () => {
    const mockLLMProvider = new MockLLMProvider();
    
    // Override the generate method to return response with various string values that need transformation
    mockLLMProvider.generate = async (_prompt: string): Promise<string> => {
        return JSON.stringify({
            grade: 'a', // lowercase that should be normalized to 'A'
            coverage: '85.5%', // percentage string that should be converted to number
            testsPresent: '1', // string '1' that should be converted to boolean true
            value: 'HIGH', // uppercase that should be normalized to 'high'
            state: 'PASS', // uppercase that should be normalized to 'pass'
            issues: null, // null that should be converted to empty array
            suggestions: undefined, // undefined that should be converted to empty array
            summary: null // null that should be converted to default string
        });
    };
    
    const mockContext = createMockContext(mockLLMProvider);
    const agent = new EnhancedCodeReviewAgent(mockContext);
    
    // Mock the readFile function to return test content
    const originalReadFile = (globalThis as any).readFile;
    (globalThis as any).readFile = createMockReadFile(`
        function testFunction() {
            console.log('Hello, World!');
        }
    `);

    try {
        const response = await agent.execute('review src/test.ts');
        
        // Verify the response is successful
        assertEquals(response.success, true);
        
        // Verify the response contains review results
        assertStringIncludes(response.content, 'Code Review Results');
        
        // Verify that transformations worked correctly
        assertStringIncludes(response.content, 'A'); // Grade should be normalized to uppercase
        assertStringIncludes(response.content, '86%'); // Coverage should be rounded to 86%
        assertStringIncludes(response.content, '✅'); // Tests present should be true
        
    } finally {
        // Restore original readFile function
        (globalThis as any).readFile = originalReadFile;
    }
});