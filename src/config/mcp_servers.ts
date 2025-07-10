import { z } from 'zod';

// Schema for external MCP server configuration
export const ExternalMCPServerSchema = z.object({
    id: z.string().min(1).describe('Unique identifier for the server'),
    name: z.string().min(1).describe('Human-readable name'),
    description: z.string().optional().describe('Optional description'),
    type: z.enum(['stdio', 'http', 'sse']).describe('Communication protocol'),
    enabled: z.boolean().default(true).describe('Whether the server is enabled'),
    
    // Command-based configuration (for stdio)
    command: z.string().optional().describe('Command to execute for stdio servers'),
    args: z.array(z.string()).default([]).describe('Arguments for the command'),
    env: z.record(z.string()).default({}).describe('Environment variables'),
    
    // HTTP/SSE configuration
    url: z.string().url().optional().describe('URL for HTTP/SSE servers'),
    headers: z.record(z.string()).default({}).describe('HTTP headers'),
    
    // Tool configuration
    tool_prefix: z.string().optional().describe('Prefix for tool names (e.g., "myserver_")'),
    context_filters: z.array(z.string()).default(['cli', 'ide']).describe('Contexts where tools are available'),
    
    // Security and validation
    trusted: z.boolean().default(false).describe('Whether the server is trusted (affects permissions)'),
    timeout: z.number().default(30000).describe('Request timeout in milliseconds'),
    
    // Installation metadata
    installed_at: z.string().datetime().optional().describe('Installation timestamp'),
    version: z.string().optional().describe('Server version'),
    author: z.string().optional().describe('Server author/source'),
});

export type ExternalMCPServer = z.infer<typeof ExternalMCPServerSchema>;

// Schema for the complete MCP servers configuration file
export const MCPServersConfigSchema = z.object({
    version: z.string().default('1.0.0'),
    servers: z.record(ExternalMCPServerSchema).describe('Map of server ID to configuration'),
    global_settings: z.object({
        auto_discover: z.boolean().default(false).describe('Auto-discover servers in common locations'),
        max_concurrent_servers: z.number().default(10).describe('Maximum number of concurrent servers'),
        default_timeout: z.number().default(30000).describe('Default timeout for all servers'),
        tool_name_conflicts: z.enum(['prefix', 'error', 'override']).default('prefix').describe('How to handle tool name conflicts'),
    }).default({}),
});

export type MCPServersConfig = z.infer<typeof MCPServersConfigSchema>;

// Default configuration
export const DEFAULT_MCP_SERVERS_CONFIG: MCPServersConfig = {
    version: '1.0.0',
    servers: {},
    global_settings: {
        auto_discover: false,
        max_concurrent_servers: 10,
        default_timeout: 30000,
        tool_name_conflicts: 'prefix',
    },
};

// Server template for common server types
export const MCP_SERVER_TEMPLATES = {
    'filesystem': {
        name: 'Filesystem MCP Server',
        description: 'Provides file system access tools',
        type: 'stdio' as const,
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory'],
        trusted: false,
        tool_prefix: 'fs_',
        env: {},
    },
    'github': {
        name: 'GitHub MCP Server',
        description: 'Provides GitHub API access',
        type: 'stdio' as const,
        command: 'npx',
        args: ['@modelcontextprotocol/server-github'],
        trusted: false,
        tool_prefix: 'gh_',
        env: {
            'GITHUB_PERSONAL_ACCESS_TOKEN': '${GITHUB_TOKEN}',
        },
    },
    'postgres': {
        name: 'PostgreSQL MCP Server',
        description: 'Provides PostgreSQL database access',
        type: 'stdio' as const,
        command: 'npx',
        args: ['@modelcontextprotocol/server-postgres'],
        trusted: true,
        tool_prefix: 'pg_',
        env: {
            'POSTGRES_CONNECTION_STRING': '${DATABASE_URL}',
        },
    },
    'slack': {
        name: 'Slack MCP Server',
        description: 'Provides Slack API access',
        type: 'stdio' as const,
        command: 'npx',
        args: ['@modelcontextprotocol/server-slack'],
        trusted: false,
        tool_prefix: 'slack_',
        env: {
            'SLACK_BOT_TOKEN': '${SLACK_BOT_TOKEN}',
        },
    },
} as const;

export type MCPServerTemplate = keyof typeof MCP_SERVER_TEMPLATES;
