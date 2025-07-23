/**
 * This file contains shared type definitions used across the application.
 * Placing these types in a separate file helps avoid circular dependencies.
 */

import { z } from 'zod';

// Forward declarations of service classes to avoid circular imports
declare class MCPService {
    executeTool(toolName: string, params: Record<string, unknown>, context: MCPToolContext): Promise<MCPToolResult>;
    getTools(): MCPToolFunction[];
    static getInstance(config: unknown): MCPService;
}

declare class GitLabService {}
declare class JiraService {}
declare class ConfluenceService {}
declare class DatadogService {}
declare class GatewayService {}

/**
 * Context passed to MCP tools during execution
 */
export interface MCPToolContext {
    workingDirectory?: string;
    shellId?: string;
    browserActive?: boolean;
    mcpService?: MCPService;
    gitlab?: GitLabService;
    jira?: JiraService;
    confluence?: ConfluenceService;
    datadog?: DatadogService;
    gateway?: GatewayService;
    [key: string]: unknown;
}

export interface MCPTool {
    name: string;
    [key: string]: unknown;
}
/**
 * Result returned from MCP tool execution
 */
export interface MCPToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
    message?: string;
}

/**
 * Definition of an MCP tool function
 */
export interface MCPToolFunction {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, unknown>;
            required?: string[];
        };
    };
}

/**
 * Interface for tool call by AI services
 */
export interface ToolCall {
    id?: string;
    function: {
        name: string;
        arguments: string | Record<string, unknown>;
    };
}

/**
 * Interface for function definitions used by AI services
 */
export interface ToolFunction {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/**
 * Interface for LLM providers used across the application
 */
export interface LLMProvider {
    name: string;
    isAvailable: () => Promise<boolean>;
    listModels: () => Promise<string[]>;
    setModel: (model: string) => void;
    generate: (prompt: string) => Promise<string>;
    generateObject: <T>(prompt: string, schema: Record<string, unknown> | z.ZodType<T>) => Promise<T>;
    chat: (
        messages: Array<{ role: string; content: string }>,
        tools?: ToolFunction[],
    ) => Promise<{ content: string; tool_calls?: ToolCall[] }>;
}

/**
 * Common interfaces for all services to avoid circular dependencies.
 * All service implementations should implement these interfaces.
 */

/**
 * GitLab service interface
 */
export interface GitLabServiceType {
    searchProjects(query: string): Promise<unknown>;
    getProjectIssues(project: string): Promise<unknown>;
    searchIssues(query: string, timeframe?: string): Promise<unknown>;
    getProjectMergeRequests(project: string, timeframe?: string): Promise<unknown>;
    searchMergeRequests(query: string): Promise<unknown>;
    createIssue(project: string, options: Record<string, unknown>): Promise<unknown>;
    getProjectMetrics(path: string, timeframe: string): Promise<unknown>;
    [key: string]: unknown;
}

/**
 * Jira service interface
 */
export interface JiraServiceType {
    baseUrl: string;
    searchIssues(jql: string): Promise<{
        issues: Array<{
            key: string;
            fields: {
                summary: string;
                status: { name: string };
                assignee?: { displayName: string };
                updated: string;
            };
        }>;
    }>;
    createIssue(options: Record<string, unknown>): Promise<{
        key: string;
        fields: { summary: string };
    }>;
    [key: string]: unknown;
}

/**
 * Confluence service interface
 */
export interface ConfluenceServiceType {
    advancedSearch(options: { query: string; spaceKey?: string; limit?: number }): Promise<{ 
        results: Array<{
            title: string;
            space: { name: string };
            _links: { webui: string };
            lastModified?: { when: string };
            excerpt?: string;
        }>;
    }>;
    createPage(options: { 
        space: string; 
        title: string; 
        content: string; 
        parentId?: string 
    }): Promise<{
        id: string;
        title: string;
        links?: { webui: string };
        url?: string;
    }>;
    [key: string]: unknown;
}

/**
 * Datadog service interface
 */
export interface DatadogServiceType {
    searchMetrics(query: string, timeRange?: string): Promise<unknown>;
    searchLogs(query: string, timeRange?: string): Promise<unknown>;
    [key: string]: unknown;
}

/**
 * DORA service interface
 */
export interface DoraServiceType {
    getDoraMetrics(jiraProjectKey: string, gitlabProjectPath: string, timeRange: string): Promise<unknown>;
    [key: string]: unknown;
}

/**
 * Gateway service interface
 */
export interface GatewayServiceType {
    getTools(): MCPToolFunction[];
    executeTool(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult>;
    [key: string]: unknown;
}

/**
 * MCP service interface
 */
export interface MCPServiceType {
    executeTool(toolName: string, params: Record<string, unknown>, context: MCPToolContext): Promise<MCPToolResult>;
    getTools(): MCPToolFunction[];
    [key: string]: unknown;
}

/**
 * Complete context with all services
 */
export interface ExtendedToolContext extends MCPToolContext {
    mcpService?: MCPServiceType;
    gitlab?: GitLabServiceType;
    jira?: JiraServiceType;
    confluence?: ConfluenceServiceType;
    datadog?: DatadogServiceType;
    dora?: DoraServiceType;
    gateway?: GatewayServiceType;
}