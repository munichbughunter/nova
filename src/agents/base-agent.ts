import { z } from 'zod';
import { Logger } from '../utils/logger.ts';
import type {
    Agent,
    AgentContext,
    AgentResponse,
    AgentExecuteOptions,
    AgentConfig,
    MCPToolResult,
} from './types.ts';
import type { ToolCall, ToolFunction } from '../types/tool_types.ts';

/**
 * Abstract base class for all Nova agents
 * Provides common functionality for agent execution, tool usage, and context management
 */
export abstract class BaseAgent implements Agent {
    public readonly name: string;
    public readonly description: string;
    public readonly version: string;
    
    protected context: AgentContext;
    protected logger: Logger;
    protected config: AgentConfig;

    constructor(
        config: AgentConfig,
        context: AgentContext,
    ) {
        this.name = config.name;
        this.description = config.description;
        this.version = config.version;
        this.config = config;
        this.context = context;
        this.logger = context.logger.child(`Agent:${this.name}`);
        
        this.logger.debug(`Initialized agent: ${this.name} v${this.version}`);
    }

    /**
     * Main execution method - must be implemented by subclasses
     */
    abstract execute(input: string, options?: AgentExecuteOptions): Promise<AgentResponse>;

    /**
     * Provide help information about this agent
     */
    help(): Promise<string> {
        return Promise.resolve(`${this.name} v${this.version}\n\n${this.description}\n\nFor more information, consult the Nova CLI documentation.`);
    }

    /**
     * Execute an MCP tool with error handling and logging
     */
    protected async executeTool(
        toolName: string,
        params: Record<string, unknown>,
        context?: Record<string, unknown>,
    ): Promise<MCPToolResult> {
        if (!this.context.mcpService) {
            throw new Error('MCP service not available in context');
        }

        const startTime = Date.now();
        this.logger.debug(`Executing tool: ${toolName}`, params);

        try {
            const toolContext = {
                ...this.context,
                ...context,
            };

            const result = await this.context.mcpService.executeTool(
                toolName,
                params,
                toolContext,
            );

            const executionTime = Date.now() - startTime;
            this.logger.debug(`Tool ${toolName} completed in ${executionTime}ms`, {
                success: result.success,
                hasData: !!result.data,
            });

            return result;
        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`Tool ${toolName} failed after ${executionTime}ms:`, error);
            
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Get available MCP tools
     */
    protected getAvailableTools(): ToolFunction[] {
        if (!this.context.mcpService) {
            return [];
        }

        return this.context.mcpService.getTools().map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
        }));
    }

    /**
     * Execute multiple tool calls in sequence
     */
    protected async executeToolCalls(toolCalls: ToolCall[]): Promise<Array<{ call: ToolCall; result: MCPToolResult }>> {
        const results: Array<{ call: ToolCall; result: MCPToolResult }> = [];

        for (const call of toolCalls) {
            try {
                const params = typeof call.function.arguments === 'string'
                    ? JSON.parse(call.function.arguments)
                    : call.function.arguments;

                const result = await this.executeTool(call.function.name, params);
                results.push({ call, result });
            } catch (error) {
                this.logger.error(`Failed to execute tool call ${call.function.name}:`, error);
                results.push({
                    call,
                    result: {
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    },
                });
            }
        }

        return results;
    }

    /**
     * Generate content using the configured LLM provider
     */
    protected async generateContent(
        prompt: string,
        options: {
            temperature?: number;
            maxTokens?: number;
            systemPrompt?: string;
            tools?: ToolFunction[];
        } = {},
    ): Promise<{ content: string; tool_calls?: ToolCall[] }> {
        if (!this.context.llmProvider) {
            throw new Error('No LLM provider available in context');
        }

        const startTime = Date.now();
        this.logger.debug('Generating content with LLM', {
            provider: this.context.llmProvider.name,
            promptLength: prompt.length,
            hasTools: !!options.tools?.length,
        });

        try {
            const messages = [];
            
            if (options.systemPrompt) {
                messages.push({ role: 'system', content: options.systemPrompt });
            }
            
            messages.push({ role: 'user', content: prompt });

            const result = await this.context.llmProvider.chat(messages, options.tools);

            const executionTime = Date.now() - startTime;
            this.logger.debug(`LLM generation completed in ${executionTime}ms`, {
                contentLength: result.content.length,
                toolCallsCount: result.tool_calls?.length || 0,
            });

            return result;
        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`LLM generation failed after ${executionTime}ms:`, error);
            throw error;
        }
    }

    /**
     * Generate a structured object using the configured LLM provider
     */
    protected async generateObject<T>(
        prompt: string,
        schema: z.ZodType<T>,
        _options: {
            temperature?: number;
            maxTokens?: number;
            systemPrompt?: string;
        } = {},
    ): Promise<T> {
        if (!this.context.llmProvider) {
            throw new Error('No LLM provider available in context');
        }

        const startTime = Date.now();
        this.logger.debug('Generating structured object with LLM', {
            provider: this.context.llmProvider.name,
            promptLength: prompt.length,
        });

        try {
            const result = await this.context.llmProvider.generateObject(prompt, schema) as T;

            const executionTime = Date.now() - startTime;
            this.logger.debug(`Structured object generation completed in ${executionTime}ms`);

            return result;
        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`Structured object generation failed after ${executionTime}ms:`, error);
            throw error;
        }
    }

    /**
     * Create an agent response with metadata
     */
    protected createResponse(
        success: boolean,
        content: string,
        data?: unknown,
        error?: string,
        metadata?: Record<string, unknown>,
    ): AgentResponse {
        return {
            success,
            content,
            data,
            error,
            metadata: {
                agent: this.name,
                version: this.version,
                timestamp: new Date().toISOString(),
                llmProvider: this.context.llmProvider?.name,
                ...metadata,
            },
        };
    }

    /**
     * Execute with timeout and error handling
     */
    protected async executeWithTimeout<T>(
        operation: () => Promise<T>,
        timeout?: number,
        operationName = 'operation',
    ): Promise<T> {
        const timeoutMs = timeout || 30000; // Default 30 seconds
        
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([operation(), timeoutPromise]);
        } catch (error) {
            this.logger.error(`${operationName} failed:`, error);
            throw error;
        }
    }

    /**
     * Validate execution options
     */
    protected validateOptions(options?: AgentExecuteOptions): AgentExecuteOptions {
        const defaults: AgentExecuteOptions = {
            format: 'text',
            timeout: 30000,
            context: {},
        };

        return { ...defaults, ...options };
    }
}
