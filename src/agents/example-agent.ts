/**
 * Example Agent Implementation
 * 
 * This demonstrates how to create a custom agent using the Nova agent infrastructure.
 * This example agent can answer questions about code and help with development tasks.
 */

import { z } from 'zod';
import { BaseAgent } from './base-agent.ts';
import type {
    AgentContext,
    AgentResponse,
    AgentExecuteOptions,
    AgentConfig,
} from './types.ts';
import { notifyUser, readFile } from './tool-wrappers.ts';

/**
 * Schema for structured code analysis responses
 */
const CodeAnalysisSchema = z.object({
    summary: z.string().describe('Brief summary of the code'),
    language: z.string().describe('Programming language detected'),
    complexity: z.enum(['low', 'medium', 'high']).describe('Code complexity level'),
    suggestions: z.array(z.string()).describe('Improvement suggestions'),
    issues: z.array(z.string()).describe('Potential issues found'),
});

type CodeAnalysis = z.infer<typeof CodeAnalysisSchema>;

/**
 * Example development assistant agent
 */
export class ExampleAgent extends BaseAgent {
    constructor(context: AgentContext) {
        const config: AgentConfig = {
            name: 'ExampleAgent',
            description: 'A development assistant that can analyze code and answer programming questions',
            version: '1.0.0',
            mcpEnabled: true,
            tools: ['f1e_read_file', 'f1e_notify_user'],
        };
        
        super(config, context);
    }

    async execute(input: string, options?: AgentExecuteOptions): Promise<AgentResponse> {
        const validatedOptions = this.validateOptions(options);
        
        // Handle case where input starts with agent name (e.g., "example analyze main.ts")
        let actualInput = input;
        const inputParts = input.trim().split(/\s+/);
        if (inputParts.length > 1 && (inputParts[0] === 'example' || inputParts[0] === 'dev' || inputParts[0] === 'development')) {
            actualInput = inputParts.slice(1).join(' ');
            this.logger.debug(`Detected agent name prefix, using: "${actualInput}"`);
        }
        
        this.logger.info(`Processing request: ${actualInput.substring(0, 100)}...`);

        try {
            // Check if this is a help request
            if (actualInput.toLowerCase().trim() === 'help' || actualInput.toLowerCase().includes('help')) {
                const helpContent = await this.help();
                return this.createResponse(
                    true,
                    helpContent,
                    undefined,
                    undefined,
                    { analysisType: 'help' }
                );
            }

            // Notify user that processing has started
            await notifyUser(this.context, {
                message: 'Processing your request...',
                type: 'info',
            });

            // Determine if this is a file analysis request
            if (actualInput.toLowerCase().includes('analyze') && actualInput.includes('.')) {
                return await this.analyzeCodeFile(actualInput, validatedOptions);
            }

            // For general questions, use LLM to provide assistance
            return await this.answerQuestion(actualInput, validatedOptions);

        } catch (error) {
            this.logger.error('Execution failed:', error);
            
            await notifyUser(this.context, {
                message: `Failed to process request: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error',
            });

            return this.createResponse(
                false,
                'Sorry, I encountered an error while processing your request.',
                undefined,
                error instanceof Error ? error.message : 'Unknown error',
            );
        }
    }

    /**
     * Analyze a code file and provide structured feedback
     */
    private async analyzeCodeFile(input: string, _options: AgentExecuteOptions): Promise<AgentResponse> {
        // Extract file path from input (simple pattern matching)
        const filePathMatch = input.match(/([^\s]+\.[a-zA-Z]+)/);
        if (!filePathMatch) {
            return this.createResponse(
                false,
                'Could not identify a file path in your request. Please specify a valid file path.',
            );
        }

        const filePath = filePathMatch[1];
        this.logger.debug(`Analyzing file: ${filePath}`);

        try {
            // Read the file content
            const fileResult = await readFile(this.context, filePath);
            if (!fileResult.success || !fileResult.data) {
                return this.createResponse(
                    false,
                    `Failed to read file: ${fileResult.error || 'Unknown error'}`,
                );
            }

            // Extract content from the file result
            let fileContent: string;
            if (typeof fileResult.data === 'string') {
                // Direct string content (from MCP tools)
                fileContent = fileResult.data;
            } else if (typeof fileResult.data === 'object' && fileResult.data && 'content' in fileResult.data) {
                // Object with content property (from Deno file operations)
                fileContent = fileResult.data.content as string;
            } else {
                return this.createResponse(
                    false,
                    `Unexpected file content format. Received: ${typeof fileResult.data}`,
                );
            }

            // Ensure content is a string
            if (typeof fileContent !== 'string') {
                return this.createResponse(
                    false,
                    `File content is not a string. Received: ${typeof fileContent}`,
                );
            }

            // Try to use LLM for analysis, fall back to basic analysis if not available
            try {
                // Use LLM to analyze the code with structured output
                const analysisPrompt = `Analyze the following code and provide detailed feedback:

File: ${filePath}
Content:
\`\`\`
${fileContent}
\`\`\`

Please analyze this code for:
1. Overall quality and complexity
2. Potential improvements
3. Possible issues or bugs
4. Code style and best practices

Provide a structured analysis.`;

                const analysis = await this.generateObject<CodeAnalysis>(
                    analysisPrompt,
                    CodeAnalysisSchema,
                    {
                        temperature: 0.3, // Lower temperature for more consistent analysis
                        systemPrompt: 'You are an expert code reviewer with deep knowledge of software engineering best practices.',
                    }
                );

                // Format the response
                const formattedResponse = this.formatCodeAnalysis(filePath, analysis);

                await notifyUser(this.context, {
                    message: `Code analysis complete for ${filePath}`,
                    type: 'success',
                });

                return this.createResponse(
                    true,
                    formattedResponse,
                    analysis,
                    undefined,
                    { 
                        analysisType: 'codeFile',
                        filePath,
                        complexity: analysis.complexity,
                    }
                );

            } catch (_llmError) {
                // LLM not available, provide basic analysis
                this.logger.info('LLM not available, providing basic file analysis');
                
                const basicAnalysis = this.performBasicFileAnalysis(filePath, fileContent);
                
                await notifyUser(this.context, {
                    message: `Basic code analysis complete for ${filePath} (LLM not available)`,
                    type: 'info',
                });

                return this.createResponse(
                    true,
                    basicAnalysis,
                    undefined,
                    undefined,
                    { 
                        analysisType: 'basicCodeFile',
                        filePath,
                        llmAvailable: false,
                    }
                );
            }

        } catch (error) {
            this.logger.error(`File analysis failed for ${filePath}:`, error);
            return this.createResponse(
                false,
                `Failed to analyze file: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    /**
     * Answer general programming questions
     */
    private async answerQuestion(input: string, _options: AgentExecuteOptions): Promise<AgentResponse> {
        this.logger.debug('Generating answer for question');

        try {
            const result = await this.generateContent(input, {
                systemPrompt: `You are a helpful programming assistant and development expert. 
                You provide clear, practical advice about coding, software engineering, and development best practices.
                Keep your responses concise but comprehensive.`,
                temperature: 0.7,
                maxTokens: 1000,
            });

            await notifyUser(this.context, {
                message: 'Question answered successfully',
                type: 'success',
            });

            return this.createResponse(
                true,
                result.content,
                undefined,
                undefined,
                { 
                    analysisType: 'question',
                    hasToolCalls: !!result.tool_calls?.length,
                }
            );

        } catch (error) {
            this.logger.error('Question answering failed:', error);
            return this.createResponse(
                false,
                'I apologize, but I encountered an error while trying to answer your question.',
                undefined,
                error instanceof Error ? error.message : 'Unknown error',
            );
        }
    }

    /**
     * Format code analysis results for display
     */
    private formatCodeAnalysis(filePath: string, analysis: CodeAnalysis): string {
        return `# Code Analysis: ${filePath}

## Summary
${analysis.summary}

## Details
- **Language:** ${analysis.language}
- **Complexity:** ${analysis.complexity}

## Suggestions for Improvement
${analysis.suggestions.map(s => `- ${s}`).join('\n')}

## Potential Issues
${analysis.issues.length > 0 
    ? analysis.issues.map(i => `- ${i}`).join('\n')
    : '- No significant issues detected'
}

---
*Analysis completed by ExampleAgent v${this.version}*`;
    }

    /**
     * Provide help specific to this agent
     */
    override help(): Promise<string> {
        return Promise.resolve(`# ExampleAgent Help

## Capabilities
- **Code Analysis**: Analyze code files for quality, complexity, and improvements
- **Programming Questions**: Answer questions about development and best practices
- **File Reading**: Read and examine source code files

## Usage Examples

### Analyze a code file:
\`\`\`
analyze src/components/Header.tsx
\`\`\`

### Ask programming questions:
\`\`\`
How do I implement error handling in TypeScript?
What are the best practices for React component composition?
\`\`\`

## Features
- Structured code analysis with complexity assessment
- Improvement suggestions and issue detection
- Support for multiple programming languages
- Interactive notifications and progress updates

## Requirements
- LLM provider (OpenAI, Ollama, or fallback mode)
- File system access for code analysis
- MCP tools for enhanced functionality

For more information about Nova agents, see the Nova CLI documentation.`);
    }

    /**
     * Perform basic file analysis without LLM
     */
    private performBasicFileAnalysis(filePath: string, content: string): string {
        // Ensure content is a string
        if (typeof content !== 'string') {
            return `# Basic Code Analysis: ${filePath}

## Error
Unable to analyze file: Content is not a string (received ${typeof content})

## Troubleshooting
- Check if the file exists and is readable
- Verify file permissions
- Try with a different file

---
*Analysis failed - ExampleAgent v${this.version}*`;
        }

        const lines = content.split('\n');
        const lineCount = lines.length;
        const nonEmptyLines = lines.filter(line => line.trim().length > 0).length;
        const commentLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#');
        }).length;

        // Detect language from file extension
        const extension = filePath.split('.').pop()?.toLowerCase() || '';
        const languageMap: Record<string, string> = {
            'ts': 'TypeScript',
            'js': 'JavaScript',
            'tsx': 'TypeScript React',
            'jsx': 'JavaScript React',
            'py': 'Python',
            'java': 'Java',
            'cpp': 'C++',
            'c': 'C',
            'cs': 'C#',
            'php': 'PHP',
            'rb': 'Ruby',
            'go': 'Go',
            'rs': 'Rust',
            'swift': 'Swift',
            'kt': 'Kotlin',
        };
        const language = languageMap[extension] || 'Unknown';

        // Basic complexity estimation
        const complexityIndicators = [
            /\bif\b/g, /\belse\b/g, /\bfor\b/g, /\bwhile\b/g, 
            /\bswitch\b/g, /\bcase\b/g, /\btry\b/g, /\bcatch\b/g,
            /\bfunction\b/g, /\bclass\b/g, /=>/g, /\?\s*:/g
        ];
        
        let complexityScore = 0;
        complexityIndicators.forEach(pattern => {
            const matches = content.match(pattern);
            complexityScore += matches ? matches.length : 0;
        });

        const complexity = complexityScore < 10 ? 'low' : 
                          complexityScore < 25 ? 'medium' : 'high';

        // Basic suggestions
        const suggestions: string[] = [];
        if (commentLines / nonEmptyLines < 0.1) {
            suggestions.push('Consider adding more comments to improve code readability');
        }
        if (lineCount > 500) {
            suggestions.push('File is quite large, consider breaking it into smaller modules');
        }
        if (complexityScore > 30) {
            suggestions.push('High complexity detected, consider refactoring for better maintainability');
        }
        if (content.includes('console.log') && language.includes('JavaScript')) {
            suggestions.push('Remove console.log statements before production');
        }
        if (content.includes('TODO') || content.includes('FIXME')) {
            suggestions.push('Address TODO and FIXME comments');
        }

        // Basic issues detection
        const issues: string[] = [];
        if (content.includes('eval(')) {
            issues.push('Use of eval() detected - security risk');
        }
        if (content.match(/var\s+/g) && language.includes('JavaScript')) {
            issues.push('Use const/let instead of var for better scoping');
        }
        if (content.includes('== ') && !content.includes('=== ')) {
            issues.push('Consider using strict equality (===) instead of loose equality (==)');
        }

        return `# Basic Code Analysis: ${filePath}

## Summary
${language} file with ${lineCount} lines (${nonEmptyLines} non-empty, ${commentLines} comments).
Basic static analysis performed without LLM assistance.

## Details
- **Language:** ${language}
- **Lines of Code:** ${lineCount}
- **Non-empty Lines:** ${nonEmptyLines}
- **Comment Lines:** ${commentLines}
- **Estimated Complexity:** ${complexity}

## Suggestions for Improvement
${suggestions.length > 0 
    ? suggestions.map(s => `- ${s}`).join('\n')
    : '- No specific suggestions from basic analysis'
}

## Potential Issues
${issues.length > 0 
    ? issues.map(i => `- ${i}`).join('\n')
    : '- No significant issues detected in basic analysis'
}

## Note
This is a basic analysis without LLM assistance. For more detailed insights, please configure an LLM provider (OpenAI API key or Ollama).

---
*Basic analysis completed by ExampleAgent v${this.version}*`;
    }
}

/**
 * Factory function to create and configure the example agent
 */
export function createExampleAgent(context: AgentContext): ExampleAgent {
    return new ExampleAgent(context);
}
