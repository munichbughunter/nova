import { z } from 'zod';
import { Config } from '../config/mod.ts';
import { ConfluenceService } from '../services/confluence_service.ts';
import { DatadogService } from '../services/datadog_service.ts';
import { DatabaseService } from '../services/db_service.ts';
import { DoraService } from '../services/dora_service.ts';
import { GitLabService } from '../services/gitlab_service.ts';
import { JiraService } from '../services/jira_service.ts';
import { MCPService } from '../services/mcp_service.ts';
import {
    type MCPToolFunction,
    type MCPToolResult,
    type ToolCall,
    type ToolFunction,
} from '../types/tool_types.ts';
import { Logger } from '../utils/logger.ts';

// Re-export these types so other files can import them from base_agent.ts
export type { MCPToolFunction, MCPToolResult, ToolCall, ToolFunction };

// Export a compatible interface that includes all the MCPToolContext properties and index signature
export interface MCPToolContext {
    workingDirectory?: string;
    shellId?: string;
    browserActive?: boolean;
    mcpService: MCPService;
    gitlab?: GitLabService;
    jira?: JiraService;
    confluence?: ConfluenceService;
    datadog?: DatadogService;
    dora?: DoraService;
    [key: string]: unknown;
}

export interface LLMProvider {
    name: string;
    model: string;
    isAvailable: () => Promise<boolean>;
    listModels: () => Promise<string[]>;
    setModel: (model: string) => void;
    generate: (prompt: string) => Promise<string>;
    generateObject: <T>(prompt: string, schema: z.ZodType<T>) => Promise<T>;
    chat: (
        messages: Array<{ role: string; content: string }>,
        tools?: ToolFunction[],
    ) => Promise<{ content: string; tool_calls?: ToolCall[] }>;
}

// Agent interfaces
export interface AgentContext {
    logger: Logger;
    config: Config;
    mcpEnabled?: boolean;
    mcpContext?: MCPToolContext;
    mcpService?: MCPService;
    gitlab?: GitLabService;
    jira?: JiraService;
    confluence?: ConfluenceService;
    datadog?: DatadogService;
    dora?: DoraService;
    projectPath?: string;
    dbService?: DatabaseService;
}

export interface AgentResponse {
    success: boolean;
    message: string;
    data?: unknown;
}

export interface Agent {
    name: string;
    description: string;
    execute(command: string, args: string[]): Promise<AgentResponse>;
    help(): string;
}

// Base LLM Providers
export class OllamaProvider implements LLMProvider {
    name = 'Ollama';
    private _model: string;
    public get model(): string {
        return this._model || 'none';
    }
    private maxRetries = 3;
    private baseUrl = 'http://localhost:11434';

    constructor(model = 'llama3.2') {
        this._model = model;
    }

    isAvailable(): Promise<boolean> {
        return Promise.resolve(true);
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) return [];
            const data = await response.json();
            return data.models?.map((m: { name: string }) => m.name) || [];
        } catch {
            return [];
        }
    }

    setModel(model: string): void {
        this._model = model;
    }

    async generate(prompt: string): Promise<string> {
        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this._model,
                    prompt: prompt,
                    stream: false,
                }),
            });

            const data = await response.json();
            return data.response;
        } catch (error) {
            throw error;
        }
    }

    async chat(
        messages: Array<{ role: string; content: string }>,
        tools?: ToolFunction[],
    ): Promise<{ content: string; tool_calls?: ToolCall[] }> {
        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this._model,
                    messages: messages,
                    stream: false,
                    ...(tools && { tools: tools.map((t) => ({ type: 'function', function: t })) }),
                }),
            });

            const data = await response.json();
            return {
                content: data.message?.content || '',
                tool_calls: data.message?.tool_calls,
            };
        } catch (error) {
            throw error;
        }
    }

    async generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const jsonPrompt = `
          You are a JSON-only response AI. Your task is to analyze the following and respond with a valid JSON object that matches this schema:
          ${JSON.stringify(schema instanceof z.ZodObject ? schema.shape : {})}
          
          ${prompt}
          
          Respond with ONLY a valid JSON object that matches the schema. Do not include any additional text or explanations.
        `;

                const response = await this.generate(jsonPrompt);
                const parsedResponse = JSON.parse(response);
                return schema.parse(parsedResponse);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < this.maxRetries) {
                    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                throw lastError;
            }
        }

        throw lastError || new Error('Failed to generate valid JSON response');
    }
}

export class OpenAIProvider implements LLMProvider {
    name = 'OpenAI';
    private _model: string;
    public get model(): string {
        return this._model || 'gpt-4';
    }
    private apiKey: string;
    private baseUrl = 'https://api.openai.com/v1';

    constructor(apiKey: string, model = 'gpt-4') {
        this.apiKey = apiKey;
        this._model = model;
    }

    isAvailable(): Promise<boolean> {
        return Promise.resolve(Boolean(this.apiKey));
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) return [];
            const data = await response.json();
            return data.data?.map((m: { id: string }) => m.id) || [];
        } catch {
            return [];
        }
    }

    setModel(model: string): void {
        this._model = model;
    }

    async generate(prompt: string): Promise<string> {
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this._model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                }),
            });

            const data = await response.json();
            return data.choices[0]?.message?.content || '';
        } catch (error) {
            throw error;
        }
    }

    async chat(
        messages: Array<{ role: string; content: string }>,
        tools?: ToolFunction[],
    ): Promise<{ content: string; tool_calls?: ToolCall[] }> {
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this._model,
                    messages,
                    temperature: 0.7,
                    ...(tools && { tools: tools.map((t) => ({ type: 'function', function: t })) }),
                }),
            });

            const data = await response.json();
            return {
                content: data.choices[0]?.message?.content || '',
                tool_calls: data.choices[0]?.message?.tool_calls,
            };
        } catch (error) {
            throw error;
        }
    }

    async generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
        const response = await this.generate(prompt);
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : response;
            const jsonResponse = JSON.parse(jsonStr);
            return schema.parse(jsonResponse);
        } catch (error) {
            throw new Error(
                `Failed to parse JSON response: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }
}

// Factory function to create LLM provider
export async function createLLMProvider(config: {
    provider: 'ollama' | 'openai';
    apiKey?: string;
    model?: string;
}): Promise<LLMProvider> {
    let provider: LLMProvider;

    switch (config.provider) {
        case 'openai':
            if (!config.apiKey) {
                throw new Error('OpenAI API key is required');
            }
            provider = new OpenAIProvider(config.apiKey, config.model);
            break;

        case 'ollama':
        default:
            provider = new OllamaProvider(config.model);
            break;
    }

    // Check availability with gentle failure for Ollama
    if (config.provider === 'ollama') {
        try {
            const isAvailable = await provider.isAvailable();
            if (!isAvailable) {
                console.warn('Warning: Ollama is not available. Some AI features may be limited.');
                // Return a minimal provider that provides helpful error messages
                return {
                    name: 'Ollama (Unavailable)',
                    model: config.model || 'none',
                    isAvailable: () => Promise.resolve(false),
                    listModels: () => Promise.resolve([]),
                    setModel: () => {},
                    generate: () => Promise.reject(new Error('Ollama is not available')),
                    generateObject: () => Promise.reject(new Error('Ollama is not available')),
                    chat: () => Promise.reject(new Error('Ollama is not available')),
                };
            }
        } catch (error) {
            console.warn('Warning: Error checking Ollama availability:', error);
            // Return a minimal provider that provides helpful error messages
            return {
                name: 'Ollama (Error)',
                model: config.model || 'none',
                isAvailable: () => Promise.resolve(false),
                listModels: () => Promise.resolve([]),
                setModel: () => {},
                generate: () => Promise.reject(new Error('Error connecting to Ollama')),
                generateObject: () => Promise.reject(new Error('Error connecting to Ollama')),
                chat: () => Promise.reject(new Error('Error connecting to Ollama')),
            };
        }
    }

    return provider;
}

export abstract class BaseAgent implements Agent {
    protected context: AgentContext;
    protected options: Record<string, unknown>;
    protected logger: Logger;
    protected mcpTools: MCPToolFunction[] = [];
    protected mcpService?: MCPService;
    abstract name: string;
    abstract description: string;

    constructor(context: AgentContext, options: Record<string, unknown> = {}) {
        this.context = context;
        this.options = options;
        this.logger = context.logger.child(this.constructor.name);

        if (context.mcpEnabled) {
            this.mcpService = MCPService.getInstance(context.config);
            this.mcpTools = this.mcpService.getTools();
        }
    }

    protected async executeMCPTool(
        toolName: string,
        params: Record<string, unknown>,
    ): Promise<MCPToolResult> {
        if (!this.context.mcpEnabled || !this.mcpService) {
            return {
                success: false,
                error: 'MCP tools are not enabled for this agent',
            };
        }

        try {
            const context: MCPToolContext = {
                mcpService: this.mcpService,
                workingDirectory: Deno.cwd(),
                ...this.context.mcpContext,
            };

            return await this.mcpService.executeTool(toolName, params, context);
        } catch (error) {
            return {
                success: false,
                error: `Failed to execute tool ${toolName}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            };
        }
    }

    protected async withMCPContext<T>(
        callback: () => Promise<T>,
        context?: Partial<MCPToolContext>,
    ): Promise<T> {
        if (!this.context.mcpEnabled) {
            return callback();
        }

        const previousContext = this.context.mcpContext;
        const newContext: MCPToolContext = {
            mcpService: this.mcpService!,
            ...previousContext,
            ...context,
        };

        this.context.mcpContext = newContext;

        try {
            return await callback();
        } finally {
            this.context.mcpContext = previousContext;
        }
    }

    // Helper methods for common MCP tool operations
    protected notifyUser(message: string, attachments?: string | string[]): Promise<MCPToolResult> {
        return this.executeMCPTool('message_notify_user', {
            text: message,
            attachments,
        });
    }

    protected askUser(
        question: string,
        attachments?: string | string[],
        suggestTakeover?: 'none' | 'browser',
    ): Promise<MCPToolResult> {
        return this.executeMCPTool('message_ask_user', {
            text: question,
            attachments,
            suggest_user_takeover: suggestTakeover,
        });
    }

    protected readFile(
        file: string,
        options?: { startLine?: number; endLine?: number; sudo?: boolean },
    ): Promise<MCPToolResult> {
        return this.executeMCPTool('file_read', {
            file,
            ...options,
        });
    }

    protected writeFile(
        file: string,
        content: string,
        options?: {
            append?: boolean;
            leadingNewline?: boolean;
            trailingNewline?: boolean;
            sudo?: boolean;
        },
    ): Promise<MCPToolResult> {
        return this.executeMCPTool('file_write', {
            file,
            content,
            ...options,
        });
    }

    abstract execute(command: string, args: string[]): Promise<AgentResponse>;

    help(): string {
        return `${this.name}: ${this.description}`;
    }

    protected async getProjectMetrics(projectPath?: string): Promise<AgentResponse> {
        try {
            const path = projectPath || this.context.projectPath;
            if (!path) {
                return {
                    success: false,
                    message: 'No project path specified',
                };
            }

            const metrics = await this.context.gitlab?.getProjectMetrics(path, '30d');
            return {
                success: true,
                message: 'Project metrics retrieved successfully',
                data: metrics,
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to get project metrics: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            };
        }
    }
}
