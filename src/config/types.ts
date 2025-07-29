import { z } from 'zod';

// AI-related types
export const OpenAIModels = [
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
    'gpt-4',
    'gpt-4-32k',
    'gpt-4-turbo-preview',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4.5-preview',
    'gpt-4o',
    'gpt-4o-mini',
] as const;

export type OpenAIModel = typeof OpenAIModels[number];

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Add agent config type
export const AgentConfigSchema = z.object({
    id: z.string().optional(),
    token: z.string().optional(),
    apiUrl: z.string().url().optional(),
    wsUrl: z.string().url().optional(),
    lastAuthenticated: z.string().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Configuration schema using Zod for validation
export const ConfigSchema = z.object({
    gitlab: z.object({
        url: z.string().url(),
        token: z.string().min(1),
    }).optional(),
    github: z.object({
        url: z.string().url(),
        token: z.string().min(1),
        owner: z.string().optional(),
        repository: z.string().optional(),
    }).optional(),
    gitProvider: z.object({
        defaultProvider: z.enum(['gitlab', 'github', 'auto']).optional(),
        preferredProviders: z.array(z.enum(['gitlab', 'github'])).optional(),
    }).optional(),
    datadog: z.object({
        api_key: z.string().min(1),
        app_key: z.string().min(1),
        site: z.string().default('datadoghq.eu'),
    }).optional(),
    atlassian: z.object({
        jira_url: z.string().url(),
        jira_token: z.string().min(1),
        confluence_url: z.string().url(),
        confluence_token: z.string().min(1),
        username: z.string().min(1),
    }).optional(),
    ai: z.object({
        default_provider: z.enum(['nova', 'openai', 'azure', 'ollama', 'copilot']),
        nova: z.object({
            api_key: z.string().min(1),
            api_url: z.string().url(),
            default_model: z.string().min(1),
        }).optional(),
        openai: z.object({
            api_key: z.string().min(1),
            api_url: z.string().url().optional(),
            api_version: z.string().optional(),
            default_model: z.enum(OpenAIModels),
        }).optional(),
        azure: z.object({
            api_key: z.string().min(1),
            api_url: z.string().min(1),
            api_version: z.string().min(1),
            deployment_name: z.string().min(1),
        }).optional(),
        ollama: z.object({
            model: z.string().min(1),
            api_url: z.string().url().optional(),
        }).optional(),
        copilot: z.object({
            enabled: z.boolean(),
        }).optional(),
    }).optional(),
    // Add agent section (optional)
    agent: AgentConfigSchema.optional(),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

// AI Provider configurations
export interface OpenAIConfig {
    api_key: string;
    api_url: string;
    api_version: string;
    default_model: OpenAIModel;
}

export interface AtlassianConfig {
    jira_url: string;
    jira_token: string;
    confluence_url: string;
    confluence_token: string;
    username: string;
}

export interface AzureAIConfig {
    api_key: string;
    api_url: string;
    api_version: string;
    deployment_name: string;
}

export interface OllamaConfig {
    model: string;
    api_url?: string;
}

export interface CopilotConfig {
    enabled: boolean;
    token?: string;
}

export interface novaConfig {
    api_key: string;
    api_url: string;
    default_model: string;
}

export interface AIConfig {
    default_provider: 'nova' | 'openai' | 'azure' | 'ollama' | 'copilot';
    nova?: novaConfig;
    openai?: OpenAIConfig;
    azure?: AzureAIConfig;
    ollama?: OllamaConfig;
    copilot?: CopilotConfig;
}

// Datadog configuration
export interface DatadogConfig {
    api_key: string;
    app_key: string;
    site: string;
}

/**
 * Git provider configuration for GitLab
 */
export interface GitLabConfig {
    url: string;
    token: string;
    project_id?: string;
}

/**
 * Git provider configuration for GitHub
 */
export interface GitHubConfig {
    url: string;           // For GitHub Enterprise or github.com
    token: string;         // Personal Access Token or Fine-grained token
    owner?: string;        // Default owner/organization
    repository?: string;   // Default repository
}

/**
 * Git provider preferences
 */
export interface GitProviderConfig {
    defaultProvider?: 'gitlab' | 'github' | 'auto';  // 'auto' = automatic detection
    preferredProviders?: ('gitlab' | 'github')[];    // Priority order for auto-detection
}

/**
 * Extended configuration with all provider information
 */
export interface ExtendedConfig extends Config {
    // Add any extended properties if needed
    _configVersion?: string;
    _lastUpdated?: string;
}

/**
 * Provider-specific configuration getter
 */
export type ProviderConfig<T extends 'gitlab' | 'github'> = 
    T extends 'gitlab' ? GitLabConfig : GitHubConfig;

/**
 * Git service factory interface for provider-agnostic operations
 */
export interface GitProviderServiceConfig {
    provider: 'gitlab' | 'github';
    config: GitLabConfig | GitHubConfig;
    isEnterprise: boolean;
    host: string;
}
