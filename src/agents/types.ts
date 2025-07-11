import { z } from 'zod';
import type { Config } from '../config/types.ts';
import type { 
    MCPToolContext, 
    MCPToolResult as _MCPToolResult, 
    ToolCall as _ToolCall, 
    ToolFunction, 
    LLMProvider 
} from '../types/tool_types.ts';
import type { Logger } from '../utils/logger.ts';

// Re-export common types for convenience
export type { ToolCall, ToolFunction, MCPToolResult } from '../types/tool_types.ts';

/**
 * Core agent interfaces
 */
export interface Agent {
    name: string;
    description: string;
    version: string;
    execute(input: string, options?: AgentExecuteOptions): Promise<AgentResponse>;
    help(): Promise<string>;
}

export interface AgentExecuteOptions {
    format?: 'text' | 'json';
    timeout?: number;
    context?: Record<string, unknown>;
}

export interface AgentResponse {
    success: boolean;
    content: string;
    data?: unknown;
    error?: string;
    metadata?: {
        executionTime?: number;
        toolsUsed?: string[];
        llmProvider?: string;
        [key: string]: unknown;
    };
}

/**
 * Extended agent context with service bindings
 */
export interface AgentContext extends MCPToolContext {
    config: Config;
    logger: Logger;
    llmProvider?: LLMProvider;
    mcpEnabled?: boolean;
    
    // Service bindings
    services?: {
        gitlab?: unknown;  // GitLabService
        github?: unknown;  // Future GitHub service
        jira?: unknown;    // JiraService  
        confluence?: unknown; // ConfluenceService
        datadog?: unknown; // DatadogService
        grafana?: unknown; // Future Grafana service
        dora?: unknown;    // DoraService
    };
}

/**
 * User interaction tool results
 */
export interface UserNotification {
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    title?: string;
    actions?: Array<{
        label: string;
        action: string;
    }>;
}

export interface UserQuestion {
    question: string;
    type?: 'text' | 'confirm' | 'select' | 'multiselect';
    options?: string[];
    defaultValue?: string | boolean;
}

export interface UserResponse {
    success: boolean;
    value?: string | boolean | string[];
    cancelled?: boolean;
}

/**
 * File operation interfaces
 */
export interface FileReadOptions {
    encoding?: 'utf8' | 'binary';
    maxSize?: number;
}

export interface FileWriteOptions {
    encoding?: 'utf8' | 'binary';
    mode?: number;
    createDirs?: boolean;
}

export interface FileOperation {
    path: string;
    content?: string | Uint8Array;
    options?: FileReadOptions | FileWriteOptions;
}

/**
 * Project metrics interface
 */
export interface ProjectMetrics {
    project: {
        name: string;
        url: string;
        type: 'gitlab' | 'github' | 'jira';
    };
    metrics: {
        [key: string]: number | string | boolean;
    };
    timestamp: Date;
}

/**
 * LLM generation options
 */
export interface LLMGenerateOptions {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    stream?: boolean;
    tools?: ToolFunction[];
}

/**
 * Structured object generation with schema validation
 */
export interface GenerateObjectOptions<T> extends LLMGenerateOptions {
    schema: z.ZodType<T>;
    prompt: string;
    systemPrompt?: string;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
    name: string;
    description: string;
    version: string;
    mcpEnabled?: boolean;
    llmProvider?: 'openai' | 'azure' | 'ollama' | 'copilot';
    defaultModel?: string;
    tools?: string[]; // List of enabled MCP tools
    context?: Record<string, unknown>;
}

/**
 * Agent factory options
 */
export interface CreateAgentOptions {
    config: Config;
    context?: Partial<AgentContext>;
    agentConfig?: Partial<AgentConfig>;
}
