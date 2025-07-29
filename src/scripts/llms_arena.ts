// deno-lint-ignore-file
import { ollama } from '@ai-sdk/ollama';
import { Table } from '@cliffy/table';
import { generateObject, generateText, Tool, tool } from 'ai';
import * as mathjs from 'npm:mathjs';
import { z } from 'zod';
import { CodeReviewAgent } from '../agents/dev/code-review/code_review_agent.ts';
import { FileAnalysisSchema } from '../agents/dev/code-review/schemas.ts';
import { ReviewAgentContext } from '../agents/dev/code-review/types.ts';
import { EngineeringAgent } from '../agents/dev/mod.ts';
import { BaseEngineeringOptions } from '../agents/dev/types.ts';
import { logger } from '../utils/logger.ts';

// Models to test
const MODELS_TO_TEST = [
    'gemma3:latest',
    'granite3.3:latest',
    'phi4-mini:latest',
    'qwen2.5:latest',
    'llama3.2:latest',
    'cogito:8b',
    'deepseek-r1:7b',
    'qwen3:1.7b',
    'qwen3',
    'qwen3:4b',
];

// Tool definitions using the new approach
const searchTool = tool({
    name: 'search',
    description: 'Search for information',
    parameters: z.object({
        query: z.string().describe('The search query'),
        limit: z.number().optional().describe('Maximum number of results to return'),
    }),
    execute: async ({ query, limit }) => {
        return { results: [`Result for query: ${query}`, `Limit: ${limit || 10}`] };
    },
});

const fileReadTool = tool({
    name: 'read_file',
    description: 'Read content from a file',
    parameters: z.object({
        path: z.string().describe('The file path to read'),
        startLine: z.number().optional().describe('Starting line number'),
        endLine: z.number().optional().describe('Ending line number'),
    }),
    execute: async ({ path, startLine, endLine }) => {
        return { content: `File content from ${path} (lines ${startLine}-${endLine})` };
    },
});

// Define tools that will be used across all test cases
export const getCurrentWeather: Tool = tool({
    name: 'get_current_weather',
    description: 'Get the current weather in a given location',
    parameters: z.object({
        location: z.string().describe('The city and state, e.g. San Francisco, CA'),
        unit: z.enum(['celsius', 'fahrenheit']).optional().describe('The unit for the temperature'),
    }),
    execute: async ({ location, unit = 'celsius' }) => {
        logger.info(`[Tool] Getting weather for ${location} in ${unit}`);
        return {
            location,
            temperature: 22,
            unit,
            forecast: ['sunny', 'windy'],
        };
    },
});

export const calculate: Tool = tool({
    name: 'calculate',
    description:
        'A tool for evaluating mathematical expressions. Example expressions: "1.2 * (2 + 4.5)", "12.7 cm to inch", "sin(45 deg) ^ 2".',
    parameters: z.object({
        expression: z.string(),
    }),
    execute: async ({ expression }) => {
        logger.info(`[Tool] Calculating expression: ${expression}`);
        return mathjs.evaluate(expression);
    },
});

// CommitSuggestionSchema is imported from '../commands/git/commit.ts'
// This schema is used for validating commit message generation

// Tool schemas for testing
const SearchToolSchema = z.object({
    query: z.string().describe('The search query'),
    limit: z.number().optional().describe('Maximum number of results to return'),
});

const FileReadToolSchema = z.object({
    path: z.string().describe('The file path to read'),
    startLine: z.number().optional().describe('Starting line number'),
    endLine: z.number().optional().describe('Ending line number'),
});

// Enhanced error handling schema
const ErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    stack: z.string().optional(),
});

// Standardized response schema
const StandardResponseSchema = z.object({
    success: z.boolean(),
    data: z.unknown(),
    error: ErrorSchema.optional(),
    metadata: z.object({
        model: z.string(),
        timestamp: z.string(),
        duration: z.number(),
        tokens: z.number().optional(),
    }),
});

// Enhanced tool testing schema
const ToolTestSchema = z.object({
    name: z.string(),
    arguments: z.record(z.unknown()),
    expectedResponse: z.unknown(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
});

// Enhanced test configuration
const TestConfig = z.object({
    model: z.string(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
    tools: z.array(ToolTestSchema).optional(),
    systemPrompt: z.string().optional(),
    responseFormat: z.object({
        type: z.enum(['json', 'text']),
        schema: z.any().optional(),
    }).optional(),
});

// Test cases
const TEST_CASES = [
    {
        name: 'Basic Text Generation',
        description: "Tests the model's ability to generate a simple explanation about TypeScript.",
        test: async (model: string) => {
            const response = await generateText({
                model: ollama(model),
                messages: [
                    { role: 'user', content: 'What is TypeScript?' },
                ],
            });
            return response.text;
        },
    },
    {
        name: 'Chat with System Prompt',
        description:
            "Tests the model's ability to follow a system prompt and generate specific information about TypeScript benefits.",
        test: async (model: string) => {
            const response = await generateText({
                model: ollama(model),
                messages: [
                    { role: 'system', content: 'You are a helpful programming assistant.' },
                    { role: 'user', content: 'What are the benefits of using TypeScript?' },
                ],
            });
            return response.text;
        },
    },
    {
        name: 'Tool Usage',
        description:
            "Tests the model's ability to use the weather tool to retrieve information about San Francisco.",
        test: async (model: string) => {
            try {
                const response = await generateText({
                    model: ollama(model),
                    messages: [
                        {
                            role: 'system',
                            content:
                                'You are a helpful assistant that can get weather information.',
                        },
                        { role: 'user', content: 'What is the weather like in San Francisco?' },
                    ],
                    tools: [getCurrentWeather],
                    maxSteps: 5,
                });

                // Validate the response
                if (!response || typeof response !== 'object') {
                    throw new Error('Invalid response format');
                }

                if (response.text && typeof response.text === 'string') {
                    // Check if the response contains error indicators
                    if (response.text.includes('Error') || response.text.includes('Bad Request')) {
                        throw new Error(response.text);
                    }

                    // Check if the model actually used the weather tool
                    if (
                        !response.text.includes('temperature') &&
                        !response.text.includes('forecast')
                    ) {
                        logger.warn(`Model ${model} may not have used the weather tool correctly`);
                    }
                } else {
                    throw new Error('Missing expected text in response');
                }

                return response;
            } catch (error) {
                logger.error(`Tool usage test failed for ${model}:`, error);
                return { text: `Error: ${error.message}` };
            }
        },
    },
    {
        name: 'Generate Object with Enum',
        description:
            "Tests the model's ability to classify a movie plot into a genre from a predefined list.",
        test: async (model: string) => {
            const response = await generateObject({
                model: ollama(model),
                prompt:
                    'Classify the genre of this movie plot: "A group of astronauts travel through a wormhole in search of a new habitable planet for humanity."',
                enum: ['action', 'comedy', 'drama', 'horror', 'sci-fi'],
                output: 'enum',
            });
            return response.object;
        },
    },
    {
        name: 'Generate Object with Array',
        description: "Tests the model's ability to generate structured data about RPG characters.",
        test: async (model: string) => {
            const response = await generateObject({
                model: ollama(model),
                prompt: 'Generate 3 character descriptions for a fantasy role playing game.',
                schema: z.object({
                    characters: z.array(
                        z.object({
                            class: z.string().describe(
                                'Character class, e.g. warrior, mage, or thief.',
                            ),
                            description: z.string(),
                            name: z.string(),
                        }),
                    ),
                }),
            });
            return response.object;
        },
    },
    {
        name: 'Generate Object with Date Parsing',
        description:
            "Tests the model's ability to generate dates in a specific format for historical events.",
        test: async (model: string) => {
            const response = await generateObject({
                model: ollama(model),
                prompt: 'List 5 important events from the year 2000.',
                schema: z.object({
                    events: z.array(
                        z.object({
                            date: z.string()
                                .describe('Format YYYY-MM-DD')
                                .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
                                .transform((value) => new Date(value)),
                            event: z.string(),
                        }),
                    ),
                }),
            });
            return response.object;
        },
    },
    {
        name: 'Math Problem Solving',
        description: "Tests the model's ability to solve a math problem using the calculate tool.",
        test: async (model: string) => {
            try {
                const response = await generateText({
                    model: ollama(model),
                    messages: [
                        {
                            role: 'system',
                            content:
                                'You are solving math problems. Reason step by step. Use the calculator when necessary. The calculator can only do simple additions, subtractions, multiplications, and divisions. When you give the final answer, provide an explanation for how you got it.',
                        },
                        {
                            role: 'user',
                            content:
                                'A taxi driver earns $9461 per 1-hour work. If he works 12 hours a day and in 1 hour he uses 14-liters petrol with price $134 for 1-liter. How much money does he earn in one day?',
                        },
                    ],
                    tools: [calculate],
                    maxSteps: 5,
                    onToolCall: async ({ tool, args }) => {
                        try {
                            if (tool === 'calculate' && args.expression) {
                                return mathjs.evaluate(args.expression);
                            }
                            return null;
                        } catch (error) {
                            console.error(`Error in calculator: ${error.message}`);
                            return `Error: ${error.message}`;
                        }
                    },
                });

                // Check for valid response
                if (typeof response !== 'string' && (!response || !response.text)) {
                    throw new Error('Invalid response format');
                }

                const responseText = typeof response === 'string' ? response : response.text;

                // Look for error indicators in the response
                if (responseText.includes('Error') || responseText.includes('Bad Request')) {
                    throw new Error(responseText);
                }

                // Check if the response contains a numeric answer
                if (!/\$\s*\d+|\d+\s*\$/.test(responseText)) {
                    logger.warn(`Model ${model} may not have provided a clear numeric answer`);
                }

                return typeof response === 'string' ? response : response.text;
            } catch (error) {
                return `Error in math problem test: ${error.message}`;
            }
        },
    },
    {
        name: 'Code Review',
        description:
            "Tests the model's ability to review code with specific formatting requirements.",
        test: async (model: string) => {
            const fileContent = await Deno.readTextFile('README.md');

            const codeReviewSchema = z.object({
                issues: z.array(z.object({
                    severity: z.enum(['high', 'medium', 'low']),
                    message: z.string(),
                    explanation: z.string(),
                    suggestion: z.string(),
                    line: z.number().optional(),
                    code: z.string().optional(),
                })).default([]),
                suggestions: z.array(z.string()).default([]),
                score: z.number().min(0).max(10).default(5),
                summary: z.string(),
                learningOpportunities: z.array(z.string()).default([]),
            });

            try {
                const reviewResponse = await generateObject({
                    model: ollama(model),
                    prompt: `Please review this code file and provide structured feedback:
${fileContent}

Focus on:
1. Code quality and maintainability
2. Best practices and patterns
3. Security concerns
4. Performance implications
5. Error handling and edge cases

Your response MUST be a valid JSON object with the following structure:
{
  "issues": [{ "severity": "high|medium|low", "message": "Issue description", "explanation": "Why this is an issue", "suggestion": "How to fix it", "line": optional line number, "code": optional code snippet }],
  "suggestions": ["List of general suggestions"],
  "score": A number between 0-10 indicating overall code quality,
  "summary": "Overall summary of the code review",
  "learningOpportunities": ["List of learning opportunities"]
}

Provide clear, actionable feedback that helps improve the code.`,
                    schema: codeReviewSchema,
                });

                return reviewResponse.object;
            } catch (error) {
                // Signal failure but with fallback values for reporting
                logger.error(`Code review test failed for ${model}:`, error);
                throw new Error(`Code review failed: ${error.message}`);
            }
        },
    },
    {
        name: 'Browser Control',
        description:
            "Tests the model's ability to generate browser actions for a search interface.",
        test: async (model: string) => {
            const browserActionSchema = z.object({
                action: z.enum(['click', 'type', 'navigate']),
                selector: z.string(),
                value: z.string().optional(),
            });

            const browserResponse = await generateObject({
                model: ollama(model),
                prompt: `Given this HTML:
<div class="search-box">
  <input type="text" id="search" placeholder="Search...">
  <button id="search-button">Search</button>
</div>

What browser actions would you take to search for "test"?`,
                schema: browserActionSchema,
            });

            return browserResponse.object;
        },
    },
];

// Mock tool implementations with proper schema validation
const mockSearchTool = {
    name: 'search',
    description: 'Search for information',
    parameters: SearchToolSchema,
    execute: async ({ query, limit }: z.infer<typeof SearchToolSchema>) => {
        return { results: [`Result for query: ${query}`, `Limit: ${limit || 10}`] };
    },
};

const mockFileReadTool = {
    name: 'readFile',
    description: 'Read file content',
    parameters: FileReadToolSchema,
    execute: async ({ path, startLine, endLine }: z.infer<typeof FileReadToolSchema>) => {
        return { content: `File content from ${path} (lines ${startLine}-${endLine})` };
    },
};

// Mock logger implementation
const mockLogger = {
    debug: console.debug,
    info: console.info,
    error: console.error,
    success: console.log,
    warn: console.warn,
    child: (options: Record<string, unknown>) => ({
        debug: console.debug,
        info: console.info,
        error: console.error,
        success: console.log,
        warn: console.warn,
        child: mockLogger.child,
        passThrough: mockLogger.passThrough,
        setLevel: mockLogger.setLevel,
        getLevel: mockLogger.getLevel,
        isLevelEnabled: mockLogger.isLevelEnabled,
        ...options,
    }),
    setLevel: (level: string) => {
        console.log(`Log level set to: ${level}`);
    },
    getLevel: () => 'debug',
    isLevelEnabled: (level: string) => true,
    passThrough: (message: string) => {
        console.log(message);
        return message;
    },
    // Add any other methods that might be needed
    trace: console.trace,
    fatal: console.error,
    silent: () => {},
    verbose: console.debug,
    log: console.log,
};

// Mock context and config for agent tests
const mockConfig = (model: string) => ({
    gitlab: {
        token: 'test-token',
        baseUrl: 'https://gitlab.com',
    },
    openai: {
        apiKey: 'test-key',
    },
    ai: {
        default_provider: 'ollama',
        ollama: {
            model: model,
            api_url: 'http://localhost:11434',
        },
    },
});

const mockContext = (model: string): ReviewAgentContext => ({
    config: mockConfig(model),
    logger: mockLogger,
});

// Test options
const testOptions: BaseEngineeringOptions = {
    analysisDepth: 'quick',
    reviewer: 'senior',
    path: ['.'],
};

// Enhanced mock AI service response handler
const mockAIResponseHandler = {
    handleResponse: async (response: any, schema: z.ZodType<any>) => {
        try {
            // Ensure response is a string
            const responseText = typeof response === 'string' ? response : JSON.stringify(response);

            // Try to parse as JSON
            let parsedResponse;
            try {
                parsedResponse = JSON.parse(responseText);
            } catch (parseError) {
                // If parsing fails, try to extract JSON from the text
                const jsonMatch = responseText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                if (jsonMatch) {
                    try {
                        parsedResponse = JSON.parse(jsonMatch[0]);
                    } catch (e) {
                        // If we can't parse JSON, create a default response based on the schema
                        if (schema === FileAnalysisSchema) {
                            parsedResponse = {
                                path: 'test-file.ts',
                                issues: [],
                                suggestions: [],
                                score: 7,
                                summary: 'Default analysis summary',
                                learningOpportunities: [],
                            };
                        } else {
                            throw new Error('Failed to extract valid JSON from response');
                        }
                    }
                } else {
                    // Create a default response if no JSON is found
                    if (schema === FileAnalysisSchema) {
                        parsedResponse = {
                            path: 'test-file.ts',
                            issues: [],
                            suggestions: [],
                            score: 7,
                            summary: 'Default analysis summary',
                            learningOpportunities: [],
                        };
                    } else {
                        throw new Error('Response is not valid JSON');
                    }
                }
            }

            // Validate against schema
            const validatedResponse = schema.parse(parsedResponse);
            return validatedResponse;
        } catch (error) {
            // If validation fails, return a default response for FileAnalysis
            if (schema === FileAnalysisSchema) {
                return {
                    path: 'test-file.ts',
                    issues: [],
                    suggestions: [],
                    score: 7,
                    summary: 'Default analysis summary',
                    learningOpportunities: [],
                };
            }
            throw new Error(
                `Failed to handle AI response: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    },
};

// Update testModel function
async function testModel(model: string, testCase: any): Promise<StandardResponseSchema> {
    const startTime = Date.now();
    try {
        logger.info(`Testing ${testCase.name} with model ${model}...`);

        const result = await testCase.test(model);

        // Check for error indicators in the result
        if (typeof result === 'string' && result.startsWith('Error:')) {
            throw new Error(result.substring(7));
        }

        // For object results, check for error text property
        if (result && typeof result === 'object') {
            if (
                result.text && typeof result.text === 'string' &&
                (result.text.startsWith('Error:') || result.text.includes('Error in'))
            ) {
                throw new Error(result.text);
            }
        }

        return {
            success: true,
            data: result,
            metadata: {
                model,
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                tokens: 0, // We don't have this information
            },
        };
    } catch (error) {
        logger.error(`Test failed for ${model} - ${testCase.name}:`, error);
        return {
            success: false,
            data: null,
            error: {
                code: 'TEST_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: error instanceof Error ? { stack: error.stack } : undefined,
            },
            metadata: {
                model,
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                tokens: 0,
            },
        };
    }
}

// Update testAgentWithModel function
async function testAgentWithModel(model: string): Promise<{
    success: boolean;
    time: number;
    error?: string;
    results?: any[];
}> {
    const startTime = Date.now();
    try {
        // Create instances of our agents with the test model
        const engineeringAgent = new EngineeringAgent(mockContext(model), testOptions);
        const codeReviewAgent = new CodeReviewAgent(mockContext(model), testOptions);

        const results = [];

        // Test agent initialization
        const initResponse = await engineeringAgent.execute('help', []);
        results.push({
            test: 'Agent Initialization',
            success: initResponse.success,
            message: initResponse.message,
        });

        // Test code analysis with proper error handling
        try {
            const analysisResponse = await codeReviewAgent.execute('analyze', [
                '--path',
                'src/agents/engineering',
                '--model',
                model,
            ]);
            results.push({
                test: 'Code Analysis',
                success: analysisResponse.success,
                message: analysisResponse.message,
            });
        } catch (error) {
            results.push({
                test: 'Code Analysis',
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Test multi-perspective review with proper error handling
        const perspectives = ['junior', 'senior', 'architect'];
        for (const perspective of perspectives) {
            try {
                const response = await codeReviewAgent.execute('analyze', [
                    '--path',
                    'src/agents/engineering',
                    '--reviewer',
                    perspective,
                    '--model',
                    model,
                ]);
                results.push({
                    test: `Multi-perspective Review (${perspective})`,
                    success: response.success,
                    message: response.message,
                });
            } catch (error) {
                results.push({
                    test: `Multi-perspective Review (${perspective})`,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Test review synthesis with proper error handling
        try {
            const synthesisResponse = await codeReviewAgent.execute('synthesize', [
                '--path',
                'src/agents/engineering',
                '--model',
                model,
            ]);
            results.push({
                test: 'Review Synthesis',
                success: synthesisResponse.success,
                message: synthesisResponse.message,
            });
        } catch (error) {
            results.push({
                test: 'Review Synthesis',
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return {
            success: results.every((r) => r.success),
            time: Date.now() - startTime,
            results,
        };
    } catch (error) {
        return {
            success: false,
            time: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// Add new interface for partial results
interface PartialResults {
    standardTests: {
        model: string;
        results: any[];
    }[];
    agentTests: {
        model: string;
        success: boolean;
        time: number;
        error?: string;
        results?: any[];
    }[];
    lastCompletedModel?: string;
    phase: 'standard' | 'agent' | 'complete';
}

// Add function to save partial results
async function savePartialResults(results: PartialResults) {
    try {
        await Deno.writeTextFile(
            'test_results.json',
            JSON.stringify(results, null, 2),
        );
    } catch (error) {
        logger.error('Failed to save partial results:', error);
    }
}

// Add function to load partial results
async function loadPartialResults(): Promise<PartialResults | null> {
    try {
        const content = await Deno.readTextFile('test_results.json');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

// Add function to print report
function printReport(partialResults: PartialResults) {
    logger.info('\nTest Summary:');
    logger.info('=============\n');

    // Create a table for each test case
    for (const testCase of TEST_CASES) {
        logger.info(`\nResults for test case: ${testCase.name}\n`);

        const table = new Table()
            .header(['Model', 'Success', 'Time (ms)', 'Result/Error'])
            .border(true);

        for (const modelResult of partialResults.standardTests) {
            const testResult = modelResult.results.find((r) => r.testCase === testCase.name);
            if (testResult) {
                table.push([
                    modelResult.model,
                    testResult.result.success ? '✓' : '✗',
                    testResult.result.metadata.duration.toString(),
                    testResult.result.success
                        ? JSON.stringify(testResult.result.data, null, 2).slice(0, 100) + '...'
                        : (testResult.result.error?.message || 'N/A'),
                ]);
            }
        }

        console.log(table.toString());
    }

    // Print agent test results
    logger.info('\nAgent Test Results:');
    logger.info('==================\n');

    const agentTable = new Table()
        .header(['Model', 'Success', 'Time (ms)', 'Error'])
        .border(true);

    for (const result of partialResults.agentTests) {
        agentTable.push([
            result.model,
            result.success ? '✓' : '✗',
            result.time.toString(),
            result.error || 'N/A',
        ]);
    }

    console.log(agentTable.toString());

    // Print overall performance summary
    logger.info('\nOverall Performance Summary:');
    logger.info('===========================\n');

    const performanceTable = new Table()
        .header([
            'Model',
            'Success Rate',
            'Avg Time (ms)',
            'Best Case',
            'Worst Case',
            'Common Errors',
        ])
        .border(true);

    for (const modelResult of partialResults.standardTests) {
        const successfulTests = modelResult.results.filter((r) => r.result.success);
        const successRate = (successfulTests.length / modelResult.results.length * 100).toFixed(1);
        const avgTime = Math.round(
            modelResult.results.reduce((sum, r) => sum + r.result.metadata.duration, 0) /
                modelResult.results.length,
        );

        // Only consider successful tests for best/worst case
        const successfulTimes = successfulTests.map((r) => r.result.metadata.duration);
        const bestTime = successfulTimes.length > 0 ? Math.min(...successfulTimes) : 0;
        const worstTime = successfulTimes.length > 0 ? Math.max(...successfulTimes) : 0;

        // Get common errors
        const errorMessages = modelResult.results
            .filter((r) => !r.result.success)
            .map((r) => r.result.error?.message || '')
            .filter((msg) => msg);

        const commonErrors = Array.from(new Set(errorMessages))
            .map((error) => error.substring(0, 30) + (error.length > 30 ? '...' : ''))
            .join(', ');

        performanceTable.push([
            modelResult.model,
            `${successRate}%`,
            avgTime.toString(),
            bestTime.toString(),
            worstTime.toString(),
            commonErrors || 'None',
        ]);
    }

    console.log(performanceTable.toString());

    // Show number of tests that worked per model
    logger.info('\nTest Support by Model:');
    logger.info('====================\n');

    const supportTable = new Table()
        .header(['Test Case', ...partialResults.standardTests.map((m) => m.model)])
        .border(true);

    for (const testCase of TEST_CASES) {
        const row = [testCase.name];

        for (const modelResult of partialResults.standardTests) {
            const test = modelResult.results.find((r) => r.testCase === testCase.name);
            row.push(test && test.result.success ? '✓' : '✗');
        }

        supportTable.push(row);
    }

    console.log(supportTable.toString());
}

// Add function to review current report
async function reviewCurrentReport() {
    try {
        const partialResults = await loadPartialResults();
        if (!partialResults) {
            logger.info('No test results found. Run the tests first to generate a report.');
            return;
        }

        logger.info('Current Test Report:');
        logger.info('===================\n');
        printReport(partialResults);
    } catch (error) {
        logger.error('Error reviewing report:', error);
    }
}

// Add function to update the docs file with test results
async function updateDocsFile(partialResults: PartialResults): Promise<void> {
    try {
        logger.info('Updating documentation file with latest test results...');

        // Read the current docs file
        const docsPath = 'docs/llms-arena.md';
        let docsContent = '';
        try {
            docsContent = await Deno.readTextFile(docsPath);
        } catch (error) {
            logger.error(`Could not read docs file at ${docsPath}:`, error);
            return;
        }

        // Get current date in YYYY-MM-DD format
        const currentDate = new Date().toISOString().split('T')[0];

        // Replace date placeholder - only replace once
        docsContent = docsContent.replace(
            /\*\*Last Updated:\*\* .*/,
            `**Last Updated:** ${currentDate}`,
        );

        // Replace environment info placeholder - only replace once
        const envInfo = `MacBook ${Deno.build.os} ${Deno.build.target}`;
        docsContent = docsContent.replace(
            /\*\*Test Environment:\*\* .*/,
            `**Test Environment:** ${envInfo}`,
        );

        // Update performance overview table
        let overviewTable =
            '| Model | Success Rate | Avg. Response Time | Best Performing Test | Worst Performing Test |\n';
        overviewTable +=
            '|-------|--------------|-------------------|----------------------|----------------------|\n';

        for (const modelResult of partialResults.standardTests) {
            const successfulTests = modelResult.results.filter((r) => r.result.success);
            const successRate = (successfulTests.length / modelResult.results.length * 100).toFixed(
                1,
            );
            const avgTime = Math.round(
                modelResult.results.reduce((sum, r) => sum + r.result.metadata.duration, 0) /
                    modelResult.results.length,
            );

            // Find best and worst performing tests
            const testTimes = modelResult.results
                .filter((r) => r.result.success)
                .map((r) => ({
                    name: r.testCase,
                    time: r.result.metadata.duration,
                }));

            const bestTest = testTimes.length > 0
                ? testTimes.reduce((best, current) => current.time < best.time ? current : best)
                    .name
                : 'N/A';

            const worstTest = testTimes.length > 0
                ? testTimes.reduce((worst, current) => current.time > worst.time ? current : worst)
                    .name
                : 'N/A';

            overviewTable +=
                `| ${modelResult.model} | ${successRate}% | ${avgTime}ms | ${bestTest} | ${worstTest} |\n`;
        }

        // Find the Performance Overview section and replace the table once
        const overviewSection = docsContent.match(
            /## Performance Overview\s*\n\s*\|.*\n\|.*\n([^#]*)/,
        );
        if (overviewSection) {
            docsContent = docsContent.replace(
                overviewSection[0],
                `## Performance Overview\n\n${overviewTable}`,
            );
        }

        // Update test case tables
        let testCaseResults = '';

        for (const testCase of TEST_CASES) {
            let testTable = '| Model | Success | Time (ms) | Notes |\n';
            testTable += '|-------|---------|-----------|-------|\n';

            for (const modelResult of partialResults.standardTests) {
                const test = modelResult.results.find((r) => r.testCase === testCase.name);
                if (test) {
                    const success = test.result.success ? '✓' : '✗';
                    const time = test.result.metadata.duration;
                    let notes = '';

                    if (test.result.success) {
                        const resultString = JSON.stringify(test.result.data);
                        notes = resultString.length > 50
                            ? resultString.substring(0, 47) + '...'
                            : resultString;
                    } else {
                        notes = test.result.error?.message || 'Failed';
                    }

                    testTable += `| ${modelResult.model} | ${success} | ${time} | ${notes} |\n`;
                }
            }

            testCaseResults += `### ${testCase.name}\n${
                testCase.description || 'No description available.'
            }\n\n${testTable}\n\n`;
        }

        // Replace entire Test Case Results section by looking for the section header and replacing
        // everything up to the next section header
        const testCasePattern = /## Test Case Results\s*\n([\s\S]*?)(?=\n## |$)/;
        const testCaseMatch = docsContent.match(testCasePattern);

        if (testCaseMatch) {
            docsContent = docsContent.replace(
                testCaseMatch[0],
                `\n## Test Case Results\n\n${testCaseResults}`,
            );
        } else {
            // If section doesn't exist, add it after Performance Overview
            const overviewPos = docsContent.indexOf('## Performance Overview');
            if (overviewPos !== -1) {
                const nextSectionPos = docsContent.indexOf('##', overviewPos + 20);
                if (nextSectionPos !== -1) {
                    docsContent = docsContent.slice(0, nextSectionPos) +
                        `\n\n## Test Case Results\n\n${testCaseResults}\n\n` +
                        docsContent.slice(nextSectionPos);
                } else {
                    docsContent += `\n\n## Test Case Results\n\n${testCaseResults}\n\n`;
                }
            } else {
                docsContent += `\n\n## Test Case Results\n\n${testCaseResults}\n\n`;
            }
        }

        // Update common errors table
        let errorsTable = '| Model | Error Pattern | Affected Tests | Potential Solution |\n';
        errorsTable += '|-------|--------------|----------------|-------------------|\n';

        for (const modelResult of partialResults.standardTests) {
            // Get error patterns
            const errorTests = modelResult.results.filter((r) => !r.result.success);

            if (errorTests.length > 0) {
                // Group by error message
                const errorGroups = new Map<string, string[]>();

                for (const test of errorTests) {
                    const errorMsg = test.result.error?.message || 'Unknown error';
                    const shortError = errorMsg.length > 30
                        ? errorMsg.substring(0, 27) + '...'
                        : errorMsg;

                    if (!errorGroups.has(shortError)) {
                        errorGroups.set(shortError, []);
                    }

                    errorGroups.get(shortError)?.push(test.testCase);
                }

                // Add each error group to the table
                for (const [error, tests] of errorGroups.entries()) {
                    let solution = '';

                    // Suggest solutions based on error patterns
                    if (error.includes('Bad Request')) {
                        solution = 'Check model compatibility with this task';
                    } else if (error.includes('not match schema')) {
                        solution = 'Adjust schema or improve prompt clarity';
                    } else if (error.includes('mathjs')) {
                        solution = 'Ensure mathjs is properly imported';
                    } else {
                        solution = 'Review model capabilities';
                    }

                    errorsTable += `| ${modelResult.model} | ${error} | ${
                        tests.join(', ')
                    } | ${solution} |\n`;
                }
            }
        }

        // Update the Common Errors section
        const errorsSection = /## Common Errors\s*\n\s*\|.*\n\|.*\n([\s\S]*?)(?=\n## |$)/;
        if (docsContent.match(errorsSection)) {
            docsContent = docsContent.replace(
                errorsSection,
                `\n## Common Errors\n\n${errorsTable}\n`,
            );
        }

        // Update agent test results
        let agentTable = '| Model | Success | Time (ms) | Notes |\n';
        agentTable += '|-------|---------|-----------|-------|\n';

        for (const agentResult of partialResults.agentTests) {
            const success = agentResult.success ? '✓' : '✗';
            const notes = agentResult.error ||
                (agentResult.results
                    ? `${
                        agentResult.results.filter((r) => r.success).length
                    }/${agentResult.results.length} tests passed`
                    : '');

            agentTable +=
                `| ${agentResult.model} | ${success} | ${agentResult.time} | ${notes} |\n`;
        }

        // Replace agent test results section
        const agentSection = /## Agent Tests\s*\n\s*\|.*\n\|.*\n([\s\S]*?)(?=\n## |$)/;
        if (docsContent.match(agentSection)) {
            docsContent = docsContent.replace(agentSection, `\n## Agent Tests\n\n${agentTable}\n`);
        }

        // Update test support matrix
        let supportTable = '| Test Case |';
        const modelNames = partialResults.standardTests.map((m) => m.model);

        // Add model names to header
        for (const model of modelNames) {
            supportTable += ` ${model} |`;
        }
        supportTable += '\n|-----------|';

        // Add separator row
        for (let i = 0; i < modelNames.length; i++) {
            supportTable += '-------|';
        }
        supportTable += '\n';

        // Add test support status
        for (const testCase of TEST_CASES) {
            supportTable += `| ${testCase.name} |`;

            for (const modelResult of partialResults.standardTests) {
                const test = modelResult.results.find((r) => r.testCase === testCase.name);
                const support = test && test.result.success ? ' ✓ |' : ' ✗ |';
                supportTable += support;
            }
            supportTable += '\n';
        }

        // Replace test support matrix section
        const matrixSection = /## Test Support Matrix\s*\n\s*\|.*\n\|.*\n([\s\S]*?)(?=\n## |$)/;
        if (docsContent.match(matrixSection)) {
            docsContent = docsContent.replace(
                matrixSection,
                `\n## Test Support Matrix\n\n${supportTable}\n`,
            );
        }

        // Update recommendations
        let recommendations = '';

        // Find best overall model
        let bestOverallModel = '';
        let bestOverallRate = 0;

        for (const modelResult of partialResults.standardTests) {
            const successRate = modelResult.results.filter((r) => r.result.success).length /
                modelResult.results.length;
            if (successRate > bestOverallRate) {
                bestOverallRate = successRate;
                bestOverallModel = modelResult.model;
            }
        }

        // Find best model for specific tasks
        const bestForCodeReview = findBestModelForTest('Code Review', partialResults);
        const bestForToolUsage = findBestModelForTest('Tool Usage', partialResults);
        const bestForStructuredData = findBestModelForTest(
            'Generate Object with Array',
            partialResults,
        );

        // Find most cost-effective model (best ratio of success to response time)
        let mostCostEffective = '';
        let bestRatio = 0;

        for (const modelResult of partialResults.standardTests) {
            const successRate = modelResult.results.filter((r) => r.result.success).length /
                modelResult.results.length;
            const avgTime = modelResult.results.reduce((sum, r) =>
                sum + r.result.metadata.duration, 0) /
                modelResult.results.length;

            // Higher success rate with lower response time is better
            const ratio = successRate * 10000 / avgTime;
            if (ratio > bestRatio) {
                bestRatio = ratio;
                mostCostEffective = modelResult.model;
            }
        }

        recommendations = `- **Best Overall Model:** ${bestOverallModel}\n`;
        recommendations += `- **Best for Code Review:** ${bestForCodeReview}\n`;
        recommendations += `- **Best for Tool Usage:** ${bestForToolUsage}\n`;
        recommendations += `- **Best for Structured Data:** ${bestForStructuredData}\n`;
        recommendations += `- **Most Cost-Effective:** ${mostCostEffective}`;

        // Replace recommendations section
        const recommendationsSection = /## Recommendations\s*\n\n-([\s\S]*?)(?=\n## |$)/;
        if (docsContent.match(recommendationsSection)) {
            docsContent = docsContent.replace(
                recommendationsSection,
                `\n## Recommendations\n\n${recommendations}\n`,
            );
        }

        // Update test history
        const historySection = /## Test History\s*\n\s*\|.*\n\|.*\n([\s\S]*?)(?=\n## |$)/;
        let historyMatch = docsContent.match(historySection);

        // Extract existing history (if any)
        let existingHistory = '';
        if (historyMatch && historyMatch[1]) {
            // Extract all lines but filter out lines that contain the current date or placeholder text
            const historyLines = historyMatch[1].split('\n')
                .filter((line) =>
                    line.trim() &&
                    !line.includes(currentDate) &&
                    !line.includes('UPDATE TEST HISTORY HERE')
                );
            existingHistory = historyLines.join('\n');
            if (existingHistory.trim()) {
                existingHistory = '\n' + existingHistory;
            }
        }

        let historyTable = '| Date | Top Model | Overall Success Rate | Major Changes |\n';
        historyTable += '|------|-----------|---------------------|---------------|\n';

        // Add new entry at the top
        historyTable += `| ${currentDate} | ${bestOverallModel} | ${
            (bestOverallRate * 100).toFixed(1)
        }% | Updated test metrics |${existingHistory}`;

        // Replace test history section
        if (historyMatch) {
            docsContent = docsContent.replace(
                historyMatch[0],
                `\n## Test History\n\n${historyTable}\n`,
            );
        } else {
            // If no Test History section exists, add it before Running the Tests section
            const runningTestsPos = docsContent.indexOf('## Running the Tests');
            if (runningTestsPos !== -1) {
                docsContent = docsContent.slice(0, runningTestsPos) +
                    `\n\n## Test History\n\n${historyTable}\n\n` +
                    docsContent.slice(runningTestsPos);
            } else {
                docsContent += `\n\n## Test History\n\n${historyTable}\n\n`;
            }
        }

        // Write updated content back to file
        await Deno.writeTextFile(docsPath, docsContent);
        logger.info(`Successfully updated documentation at ${docsPath}`);
    } catch (error) {
        logger.error('Failed to update docs file:', error);
        if (error instanceof Error) {
            logger.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
            });
        }
    }
}

// Helper function to find the best model for a specific test
function findBestModelForTest(testName: string, results: PartialResults): string {
    let bestModel = '';
    let bestTime = Number.MAX_SAFE_INTEGER;

    for (const modelResult of results.standardTests) {
        const test = modelResult.results.find((r) => r.testCase === testName);

        if (test && test.result.success && test.result.metadata.duration < bestTime) {
            bestTime = test.result.metadata.duration;
            bestModel = modelResult.model;
        }
    }

    return bestModel || 'None';
}

// Function to create initial report
async function createInitialReport(): Promise<void> {
    try {
        logger.info('Creating initial test report...');

        // Create a minimal test results structure
        const initialResults: PartialResults = {
            standardTests: [
                {
                    model: 'gemma3:latest',
                    results: [],
                },
                {
                    model: 'granite3.3:latest',
                    results: [],
                },
            ],
            agentTests: [],
            phase: 'standard',
            lastCompletedModel: '',
        };

        // Save the initial results
        await savePartialResults(initialResults);

        // Update the docs file with the initial results
        await updateDocsFile(initialResults);

        logger.info(
            'Initial test report created. You can now run tests or update with actual results.',
        );
    } catch (error) {
        logger.error('Failed to create initial report:', error);
    }
}

async function main() {
    try {
        // Check for --init-report flag first
        if (Deno.args.includes('--init-report')) {
            await createInitialReport();
            return;
        }

        // Check for --review flag
        if (Deno.args.includes('--review')) {
            await reviewCurrentReport();
            return;
        }

        // Check for --update flag
        if (Deno.args.includes('--update')) {
            const partialResults = await loadPartialResults();
            if (!partialResults) {
                logger.error(
                    'No test results found. Run the tests first to generate results or use --init-report to create an initial report.',
                );
                return;
            }

            // Allow updating even if the tests aren't complete
            if (partialResults.standardTests.length > 0) {
                logger.info(
                    `Updating documentation with ${partialResults.standardTests.length} model test results...`,
                );
                await updateDocsFile(partialResults);
                return;
            } else {
                logger.error('No test results found. Run the tests first to generate results.');
                return;
            }
        }

        logger.info('Starting Ollama model tests...');

        const partialResults = await loadPartialResults() || {
            standardTests: [],
            agentTests: [],
            phase: 'standard' as const,
        };

        // Run standard tests
        if (partialResults.phase === 'standard') {
            for (const model of MODELS_TO_TEST) {
                if (
                    partialResults.lastCompletedModel &&
                    MODELS_TO_TEST.indexOf(partialResults.lastCompletedModel) >=
                        MODELS_TO_TEST.indexOf(model)
                ) {
                    logger.info(`Skipping already tested model: ${model}`);
                    continue;
                }

                logger.info(`\nTesting model: ${model}`);
                const modelResults = [];

                for (const testCase of TEST_CASES) {
                    logger.info(`\nRunning test: ${testCase.name}`);
                    const result = await testModel(model, testCase);
                    modelResults.push({
                        testCase: testCase.name,
                        result,
                    });
                }

                partialResults.standardTests.push({
                    model,
                    results: modelResults,
                });
                partialResults.lastCompletedModel = model;
                await savePartialResults(partialResults);
            }

            partialResults.phase = 'agent';
            await savePartialResults(partialResults);
        }

        // Run agent tests
        if (partialResults.phase === 'agent') {
            for (const model of MODELS_TO_TEST) {
                if (
                    partialResults.lastCompletedModel &&
                    MODELS_TO_TEST.indexOf(partialResults.lastCompletedModel) >=
                        MODELS_TO_TEST.indexOf(model)
                ) {
                    logger.info(`Skipping already tested model: ${model}`);
                    continue;
                }

                logger.info(`\nTesting agent with model: ${model}`);
                const result = await testAgentWithModel(model);
                partialResults.agentTests.push({
                    model,
                    ...result,
                });
                partialResults.lastCompletedModel = model;
                await savePartialResults(partialResults);
            }

            partialResults.phase = 'complete';
            await savePartialResults(partialResults);
        }

        printReport(partialResults);

        // After tests are complete, update docs if --update flag was specified
        if (Deno.args.includes('--update')) {
            await updateDocsFile(partialResults);
        }
    } catch (error) {
        logger.error('Test failed:', error);
        if (error instanceof Error) {
            logger.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
            });
        }
        Deno.exit(1);
    }
}

if (import.meta.main) {
    main().catch((error) => {
        logger.error('Test failed:', error);
        Deno.exit(1);
    });
}
