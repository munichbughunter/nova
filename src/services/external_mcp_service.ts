import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
    DEFAULT_MCP_SERVERS_CONFIG,
    ExternalMCPServer,
    MCP_SERVER_TEMPLATES,
    MCPServersConfig,
    MCPServersConfigSchema,
    MCPServerTemplate,
} from '../config/mcp_servers.ts';
import { MCPToolFunction, MCPToolResult } from '../types/tool_types.ts';
import { Logger } from '../utils/logger.ts';

/**
 * Service for managing external MCP servers
 */
export class ExternalMCPService {
    private static instance: ExternalMCPService | null = null;
    private logger: Logger;
    private config: MCPServersConfig;
    private configPath: string;
    private activeClients: Map<string, Client> = new Map();
    private serverProcesses: Map<string, ChildProcessWithoutNullStreams> = new Map();

    private constructor() {
        this.logger = new Logger('ExternalMCPService');
        this.configPath = this.getConfigPath();
        this.config = this.loadConfig();
    }

    public static getInstance(): ExternalMCPService {
        if (!ExternalMCPService.instance) {
            ExternalMCPService.instance = new ExternalMCPService();
        }
        return ExternalMCPService.instance;
    }

    private getConfigPath(): string {
        const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '';
        return join(homeDir, '.nova', 'mcp-servers.json');
    }

    private loadConfig(): MCPServersConfig {
        try {
            if (existsSync(this.configPath)) {
                const configText = readFileSync(this.configPath, 'utf-8');
                const parsed = JSON.parse(configText);
                return MCPServersConfigSchema.parse(parsed);
            }
        } catch (error) {
            this.logger.warn(`Failed to load MCP servers config: ${error}`);
        }
        
        // Return default config if file doesn't exist or is invalid
        return { ...DEFAULT_MCP_SERVERS_CONFIG };
    }

    private saveConfig(): void {
        try {
            const configDir = dirname(this.configPath);
            if (!existsSync(configDir)) {
                mkdirSync(configDir, { recursive: true });
            }
            
            writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
            this.logger.info('MCP servers configuration saved');
        } catch (error) {
            this.logger.error(`Failed to save MCP servers config: ${error}`);
            throw error;
        }
    }

    /**
     * Add a new MCP server from template
     */
    public addServerFromTemplate(
        id: string,
        template: MCPServerTemplate,
        customization: Partial<ExternalMCPServer> = {}
    ): void {
        if (this.config.servers[id]) {
            throw new Error(`Server with ID '${id}' already exists`);
        }

        const templateConfig = MCP_SERVER_TEMPLATES[template];
        const serverConfig: ExternalMCPServer = {
            id,
            enabled: true,
            installed_at: new Date().toISOString(),
            context_filters: ['cli', 'ide'],
            timeout: 30000,
            headers: {},
            ...templateConfig,
            args: [...templateConfig.args], // Make a mutable copy
            ...customization,
        };

        // Validate the configuration
        try {
            const validated = MCPServersConfigSchema.shape.servers.element.parse(serverConfig);
            this.config.servers[id] = validated;
            this.saveConfig();
            this.logger.info(`Added MCP server '${id}' from template '${template}'`);
        } catch (error) {
            throw new Error(`Invalid server configuration: ${error}`);
        }
    }

    /**
     * Add a custom MCP server
     */
    public addCustomServer(serverConfig: ExternalMCPServer): void {
        if (this.config.servers[serverConfig.id]) {
            throw new Error(`Server with ID '${serverConfig.id}' already exists`);
        }

        try {
            const validated = MCPServersConfigSchema.shape.servers.element.parse({
                ...serverConfig,
                installed_at: new Date().toISOString(),
            });
            this.config.servers[serverConfig.id] = validated;
            this.saveConfig();
            this.logger.info(`Added custom MCP server '${serverConfig.id}'`);
        } catch (error) {
            throw new Error(`Invalid server configuration: ${error}`);
        }
    }

    /**
     * Remove an MCP server
     */
    public async removeServer(id: string): Promise<void> {
        if (!this.config.servers[id]) {
            throw new Error(`Server with ID '${id}' not found`);
        }

        // Stop the server if it's running
        await this.stopServer(id);
        
        delete this.config.servers[id];
        this.saveConfig();
        this.logger.info(`Removed MCP server '${id}'`);
    }

    /**
     * Enable or disable a server
     */
    public async toggleServer(id: string, enabled: boolean): Promise<void> {
        if (!this.config.servers[id]) {
            throw new Error(`Server with ID '${id}' not found`);
        }

        if (!enabled) {
            await this.stopServer(id);
        }

        this.config.servers[id].enabled = enabled;
        this.saveConfig();
        this.logger.info(`${enabled ? 'Enabled' : 'Disabled'} MCP server '${id}'`);
    }

    /**
     * List all configured servers
     */
    public listServers(): Record<string, ExternalMCPServer> {
        return { ...this.config.servers };
    }

    /**
     * Get server configuration
     */
    public getServer(id: string): ExternalMCPServer | undefined {
        return this.config.servers[id];
    }

    /**
     * Start a specific server
     */
    public async startServer(id: string): Promise<void> {
        const serverConfig = this.config.servers[id];
        if (!serverConfig) {
            throw new Error(`Server with ID '${id}' not found`);
        }

        if (!serverConfig.enabled) {
            throw new Error(`Server '${id}' is disabled`);
        }

        if (this.activeClients.has(id)) {
            this.logger.info(`Server '${id}' is already running`);
            return;
        }

        try {
            let client: Client;
            
            switch (serverConfig.type) {
                case 'stdio': {
                    if (!serverConfig.command) {
                        throw new Error(`No command specified for stdio server '${id}'`);
                    }

                    // Resolve environment variables
                    const env: Record<string, string> = { ...Deno.env.toObject() };
                    for (const [key, value] of Object.entries(serverConfig.env)) {
                        env[key] = this.resolveEnvVariable(value);
                    }

                    // Create stdio transport with command and args
                    const transport = new StdioClientTransport({
                        command: serverConfig.command,
                        args: serverConfig.args,
                        env,
                    });

                    client = new Client(
                        {
                            name: `nova-external-${id}`,
                            version: '1.0.0',
                        },
                        {
                            capabilities: {},
                        }
                    );

                    await client.connect(transport);
                    break;
                }

                case 'sse':
                case 'http': {
                    if (!serverConfig.url) {
                        throw new Error(`No URL specified for ${serverConfig.type} server '${id}'`);
                    }

                    const transport = new SSEClientTransport(new URL(serverConfig.url));
                    client = new Client(
                        {
                            name: `nova-external-${id}`,
                            version: '1.0.0',
                        },
                        {
                            capabilities: {},
                        }
                    );

                    await client.connect(transport);
                    break;
                }

                default:
                    throw new Error(`Unsupported server type: ${serverConfig.type}`);
            }

            this.activeClients.set(id, client);
            this.logger.info(`Started MCP server '${id}'`);

        } catch (error) {
            this.logger.error(`Failed to start server '${id}': ${error}`);
            throw error;
        }
    }

    /**
     * Stop a specific server
     */
    public async stopServer(id: string): Promise<void> {
        const client = this.activeClients.get(id);
        if (client) {
            try {
                await client.close();
                this.activeClients.delete(id);
            } catch (error) {
                this.logger.warn(`Error closing client for server '${id}': ${error}`);
            }
        }

        const process = this.serverProcesses.get(id);
        if (process) {
            try {
                process.kill();
                this.serverProcesses.delete(id);
            } catch (error) {
                this.logger.warn(`Error killing process for server '${id}': ${error}`);
            }
        }

        this.logger.info(`Stopped MCP server '${id}'`);
    }

    /**
     * Start all enabled servers
     */
    public async startAllServers(): Promise<void> {
        const enabledServers = Object.entries(this.config.servers)
            .filter(([_, config]) => config.enabled);

        for (const [id, _] of enabledServers) {
            try {
                await this.startServer(id);
            } catch (error) {
                this.logger.error(`Failed to start server '${id}': ${error}`);
            }
        }
    }

    /**
     * Stop all running servers
     */
    public async stopAllServers(): Promise<void> {
        const runningServerIds = Array.from(this.activeClients.keys());
        
        for (const id of runningServerIds) {
            try {
                await this.stopServer(id);
            } catch (error) {
                this.logger.error(`Failed to stop server '${id}': ${error}`);
            }
        }
    }

    /**
     * Get all available tools from external servers
     */
    public async getExternalTools(context: string = 'cli'): Promise<MCPToolFunction[]> {
        const tools: MCPToolFunction[] = [];

        for (const [serverId, client] of this.activeClients.entries()) {
            const serverConfig = this.config.servers[serverId];
            
            // Check if this server's tools should be available in the current context
            if (!serverConfig.context_filters.includes(context)) {
                continue;
            }

            try {
                const result = await client.listTools();
                
                for (const tool of result.tools) {
                    // Apply tool prefix if configured
                    const toolName = serverConfig.tool_prefix 
                        ? `${serverConfig.tool_prefix}${tool.name}`
                        : tool.name;

                    tools.push({
                        type: 'function',
                        function: {
                            name: toolName,
                            description: `[${serverId}] ${tool.description}`,
                            parameters: {
                                type: 'object',
                                properties: tool.inputSchema.properties || {},
                                required: Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [],
                            },
                        },
                        // Store metadata for routing
                        metadata: {
                            serverId,
                            originalName: tool.name,
                        },
                    });
                }
            } catch (error) {
                this.logger.error(`Failed to list tools from server '${serverId}': ${error}`);
            }
        }

        return tools;
    }

    /**
     * Execute a tool on an external server
     */
    public async executeExternalTool(
        toolName: string,
        args: Record<string, unknown>,
        metadata?: { serverId: string; originalName: string }
    ): Promise<MCPToolResult> {
        if (!metadata) {
            throw new Error('Tool metadata is required for external tool execution');
        }

        const client = this.activeClients.get(metadata.serverId);
        if (!client) {
            throw new Error(`Server '${metadata.serverId}' is not running`);
        }

        try {
            const result = await client.callTool({
                name: metadata.originalName,
                arguments: args,
            });

            return {
                success: true,
                data: result.content,
            };
        } catch (error) {
            this.logger.error(`Failed to execute tool '${toolName}' on server '${metadata.serverId}': ${error}`);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Resolve environment variables in configuration
     */
    private resolveEnvVariable(value: string): string {
        // Simple variable substitution: ${VAR_NAME} -> process.env.VAR_NAME
        return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
            return Deno.env.get(varName) || '';
        });
    }

    /**
     * Get available server templates
     */
    public getAvailableTemplates(): typeof MCP_SERVER_TEMPLATES {
        return MCP_SERVER_TEMPLATES;
    }

    /**
     * Validate server configuration
     */
    public validateServerConfig(config: Partial<ExternalMCPServer>): boolean {
        try {
            MCPServersConfigSchema.shape.servers.element.parse(config);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get server status
     */
    public getServerStatus(id: string): 'running' | 'stopped' | 'disabled' | 'not_found' {
        const serverConfig = this.config.servers[id];
        if (!serverConfig) {
            return 'not_found';
        }
        
        if (!serverConfig.enabled) {
            return 'disabled';
        }
        
        return this.activeClients.has(id) ? 'running' : 'stopped';
    }
}
