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

// Configuration schema using Zod for validation
export const ConfigSchema = z.object({
    gitlab: z.object({
        url: z.string().url(),
        token: z.string().min(1),
        project_id: z.string().min(1).optional().nullable(),
    }),
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
        default_provider: z.enum(['openai', 'azure', 'ollama', 'copilot']),
        openai: z.object({
        api_key: z.string().min(1),
        api_url: z.string().url().optional(),
        api_version: z.string().optional(),
        default_model: z.enum(OpenAIModels)
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
        enabled: z.boolean()
    }).optional(),
    }).optional(),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

// AI Provider configurations
export interface OpenAIConfig {
    api_key: string;
    api_url: string;
    api_version: string;
    default_model: OpenAIModel;
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

export interface AIConfig {
    default_provider: 'openai' | 'azure' | 'ollama' | 'copilot';
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
