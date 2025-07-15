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

/**
 * Enhanced Code Review Agent Types
 */

/**
 * Review command interface for parsing review commands
 */
export interface ReviewCommand {
    mode: 'file' | 'changes' | 'pr';
    files?: string[];
    prId?: string;
}

/**
 * Code issue interface for representing individual code issues
 */
export interface CodeIssue {
    line: number;
    severity: 'low' | 'medium' | 'high';
    type: 'security' | 'performance' | 'style' | 'bug';
    message: string;
}

/**
 * Review result interface for structured review output
 */
export interface ReviewResult {
    file: string;
    grade: string;
    coverage: number;
    testsPresent: boolean;
    value: string;
    state: 'pass' | 'warning' | 'fail';
    issues: CodeIssue[];
    suggestions: string[];
}

/**
 * Repository service interface for GitLab/GitHub abstraction
 */
export interface RepositoryService {
    detectRepositoryType(): Promise<'gitlab' | 'github' | 'unknown'>;
    getPullRequests(): Promise<PullRequest[]>;
    getPullRequestDiff(prId: string): Promise<DiffData>;
    postDiffComment(prId: string, comment: DiffComment): Promise<void>;
}

/**
 * Pull request interface for unified PR/MR representation
 */
export interface PullRequest {
    id: string;
    title: string;
    author: string;
    status: 'open' | 'closed' | 'merged';
    createdAt: Date;
    url: string;
}

/**
 * Diff comment interface for posting review comments
 */
export interface DiffComment {
    filePath: string;
    line: number;
    message: string;
    severity: 'info' | 'warning' | 'error';
}

/**
 * Diff data interface for representing file changes
 */
export interface DiffData {
    files: DiffFile[];
    baseSha: string;
    headSha: string;
}

/**
 * Diff file interface for individual file changes
 */
export interface DiffFile {
    filePath: string;
    oldPath?: string;
    newPath: string;
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
    hunks: DiffHunk[];
}

/**
 * Diff hunk interface for code change sections
 */
export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: DiffLine[];
}

/**
 * Diff line interface for individual line changes
 */
export interface DiffLine {
    type: 'context' | 'addition' | 'deletion';
    oldLineNumber?: number;
    newLineNumber?: number;
    content: string;
}

/**
 * Git service interface for Git operations
 */
export interface GitService {
    getChangedFiles(): Promise<string[]>;
    getFileChanges(filePath: string): Promise<FileChange[]>;
    getRemoteUrl(): Promise<string>;
    getCurrentBranch(): Promise<string>;
}

/**
 * File change interface for Git file changes
 */
export interface FileChange {
    type: 'added' | 'modified' | 'deleted';
    filePath: string;
    hunks: DiffHunk[];
}

/**
 * GitHub service interface extending RepositoryService
 */
export interface GitHubService extends RepositoryService {
    authenticate(): Promise<void>;
    getGitHubPullRequests(): Promise<GitHubPullRequest[]>;
    getPullRequestFiles(prNumber: number): Promise<GitHubFile[]>;
    createReviewComment(prNumber: number, comment: GitHubReviewComment): Promise<void>;
}

/**
 * GitHub pull request interface
 */
export interface GitHubPullRequest {
    number: number;
    title: string;
    user: { login: string };
    state: 'open' | 'closed';
    html_url: string;
    created_at: string;
}

/**
 * GitHub file interface for PR files
 */
export interface GitHubFile {
    filename: string;
    status: 'added' | 'modified' | 'removed' | 'renamed';
    patch?: string;
}

/**
 * GitHub review comment interface
 */
export interface GitHubReviewComment {
    body: string;
    path: string;
    line: number;
    side?: 'LEFT' | 'RIGHT';
}

/**
 * CLI table formatter interface
 */
export interface TableFormatter {
    formatReviewResults(results: ReviewResult[]): string;
}

/**
 * Table row interface for CLI table display
 */
export interface TableRow {
    File: string;
    Grade: string;
    Coverage: string;
    'Tests Present': string;
    Value: string;
    State: string;
}

/**
 * Zod schemas for structured LLM responses
 */

/**
 * Review analysis schema for structured code review output
 */
export const ReviewAnalysisSchema = z.object({
    grade: z.enum(['A', 'B', 'C', 'D', 'F']).describe('Overall code quality grade'),
    coverage: z.number().min(0).max(100).describe('Test coverage percentage'),
    testsPresent: z.boolean().describe('Whether tests are present for this file'),
    value: z.enum(['high', 'medium', 'low']).describe('Business value assessment'),
    state: z.enum(['pass', 'warning', 'fail']).describe('Overall review state'),
    issues: z.array(z.object({
        line: z.number(),
        severity: z.enum(['low', 'medium', 'high']),
        type: z.enum(['security', 'performance', 'style', 'bug']),
        message: z.string(),
    })),
    suggestions: z.array(z.string()).describe('Improvement suggestions'),
    summary: z.string().describe('Brief summary of the analysis'),
});

/**
 * Type inference for ReviewAnalysisSchema
 */
export type ReviewAnalysis = z.infer<typeof ReviewAnalysisSchema>;

/**
 * Review configuration schema
 */
export const ReviewConfigSchema = z.object({
    github: z.object({
        token: z.string().optional(),
        apiUrl: z.string().default('https://api.github.com'),
    }).optional(),
    review: z.object({
        autoPostComments: z.boolean().default(true),
        severityThreshold: z.enum(['low', 'medium', 'high']).default('medium'),
        maxFilesPerReview: z.number().default(50),
    }).optional(),
});

/**
 * Type inference for ReviewConfigSchema
 */
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>;
