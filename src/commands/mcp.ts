import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import http from "node:http";
import { z } from 'zod';
import { configManager } from '../config/mod.ts';
import { AIService } from '../services/ai_service.ts';
// import { ConfluenceService } from '../services/confluence_service.ts';
// import { DatadogService } from '../services/datadog_service.ts';
import { GitLabService } from '../services/gitlab_service.ts';
// import { JiraService } from '../services/jira_service.ts';
import { MCPService } from '../services/mcp_service.ts';
import { Logger } from '../utils/logger.ts';
import { mcpSetupCommand } from './mcp_setup.ts';

// Create server command
export const mcpServerCommand = new Command()
    .description('Start the Nova MCP server')
    .option('--port <port:number>', 'HTTP port for SSE transport', { default: 3020 })
    .option('--stdio', 'Enable stdio transport', { default: true })
    .option('--no-stdio', 'Disable stdio transport')
    .option('--sse', 'Enable SSE transport', { default: true })
    .option('--no-sse', 'Disable SSE transport')
    .option('--endpoint <endpoint:string>', 'Endpoint for SSE transport', { default: "/mcp" })
    .option('--inspect <address:string>', 'Enable inspector on host:port (default: 127.0.0.1:9229)')
    .option('--inspect-brk <address:string>', 'Enable inspector on host:port and break at start of script')
    .option('--allow-all', 'Allow all permissions')
    .action(async (options) => {
        const logger = new Logger('Nova MCP Server');

        // Check for debug environment variables
        const debug = Deno.env.get('NOVA_DEBUG') === 'true';

        if (debug) {
            logger.info('Debug mode enabled');
        }

        try {
            logger.info('Starting MCP server...');
            // Load configuration
            const config = await configManager.loadConfig();

            // Initialize all services
            logger.info('Initializing services...');
            
            // Initialize AI service
            const aiService = new AIService(config);
            
            // Initialize GitLab service if configured
            const gitlabService = config.gitlab?.url ? new GitLabService(config) : undefined;
            if (gitlabService) {
                logger.info('GitLab service initialized');
            }
            // ToDo: Initialize Jira service if configured
            // const jiraService = config.atlassian?.jira_url ? new JiraService(config) : undefined;
            // if (jiraService) {
            //     logger.info('Jira service initialized');
            // }

            // ToDo: Initialize Confluence service if configured
            // const confluenceService = config.atlassian?.confluence_url ? new ConfluenceService(config) : undefined;
            // if (confluenceService) {
            //     logger.info('Confluence service initialized');
            // }
            
            // ToDo: Initialize Datadog service if configured
            // const datadogService = config.datadog?.api_key ? new DatadogService(config) : undefined;
            // if (datadogService) {
            //     logger.info('Datadog service initialized');
            // }
            
            // Create MCP context with all services
            const mcpContext = {
                workingDirectory: Deno.cwd(),
                mcpService: MCPService.getInstance(config),
                ai: {
                    llmProvider: aiService.getLLMProvider()
                },
                gitlab: gitlabService,
                // jira: jiraService,
                // confluence: confluenceService,
                // datadog: datadogService,
            };
            // Create MCP server with debug mode if enabled
            const server = new McpServer({
                name: 'nova-mcp',
                version: '0.1.0',
                debug: debug,
            });
            // Add basic resources
            logger.info('Registering MCP resources...');
            registerResources(server, config, logger);
            logger.info('Registering MCP tools...');
            // Register all MCP tools from the MCP service with the context
            const tools = mcpContext.mcpService.getToolsForContext("ide");

            // Add tools to the MCP server
            for (const tool of tools) {
                const { name, description, parameters } = tool.function;
                try {
                    // Convert parameters to a ZodSchema with descriptions and examples
                    const paramProps: Record<string, z.ZodTypeAny> = {};
                    if (parameters.properties) {
                        const required = parameters.required as string[] || [];
                        for (const [key, prop] of Object.entries(parameters.properties as Record<string, Record<string, unknown>>,) ) {
                            // Create a schema based on the property type with descriptions
                            let schema: z.ZodTypeAny;
                            switch (prop.type) {
                                case 'string':
                                    schema = z.string().describe(typeof prop.description === 'string' ? prop.description : '',);
                                    // Handle enums
                                    if (prop.enum) {
                                        schema = z.enum(prop.enum as [string, ...string[]]).describe(typeof prop.description === 'string' ? prop.description : '',);
                                    }
                                    break;
                                case 'number':
                                case 'integer':
                                    schema = z.number().describe(typeof prop.description === 'string' ? prop.description : '',);
                                    break;
                                case 'boolean':
                                    schema = z.boolean().describe(typeof prop.description === 'string' ? prop.description : '',);
                                    break;
                                case 'array': {
                                    // Create array schema with item type
                                    const itemType = typeof prop.items === 'object' && prop.items
                                    ? (prop.items as Record<string, unknown>).type as string || 'string'
                                    : 'string';
                                    let itemSchema: z.ZodTypeAny;
                                    switch (itemType) {
                                        case 'string':
                                            itemSchema = z.string();
                                            break;
                                        case 'number':
                                        case 'integer':
                                            itemSchema = z.number();
                                            break;
                                        case 'boolean':
                                            itemSchema = z.boolean();
                                            break;
                                        default:
                                            itemSchema = z.unknown();
                                    }
                                    schema = z.array(itemSchema).describe(typeof prop.description === 'string' ? prop.description : '',);
                                    break;
                                }
                                default:
                                    schema = z.unknown().describe(typeof prop.description === 'string' ? prop.description : '',);
                            }
                            // Add example if available
                            if (prop.example) {
                                schema = schema.describe(`${schema.description} Example: ${JSON.stringify(prop.example)}`);
                            } 
                            // Make the parameter optional if it's not in the required array
                            if (!required.includes(key)) {
                                schema = schema.optional();
                            }
                            paramProps[key] = schema;
                        }
                    }
                    // Register the tool with enhanced schema and MCP context
                    server.tool(
                        name,
                        description,
                        // Use any to bypass strict type checking
                        // deno-lint-ignore no-explicit-any
                        paramProps as any,
                        async (args: Record<string, unknown>) => {
                            try {
                                logger.debug(`Executing tool ${name} with args:`, args);
                                // Execute the tool using MCPService with full context
                                const result = await mcpContext.mcpService.executeTool(
                                    name,
                                    args,
                                    mcpContext
                                );
                                if (result.success) {
                                    return {
                                        content: [{
                                            type: 'text' as const,
                                            text: typeof result.data === 'string'
                                            ? result.data
                                            : JSON.stringify(result.data, null, 2),
                                        }],
                                    };
                                } else {
                                    return {
                                        content: [{ type: 'text' as const, text: result.error || 'Unknown error' }],
                                        isError: true,
                                    };
                                }
                            } catch (error) {
                                logger.error(`Error executing tool ${name}:`, error);
                                return {
                                    content: [{
                                        type: 'text' as const,
                                        text: error instanceof Error ? error.message : String(error),
                                    }],
                                    isError: true,
                                };
                            }
                        },
                    );
                } catch (error) {
                    logger.error(`Failed to register tool ${name}:`, error);
                }
            }
            logger.info('Tools and resources registered, starting server...');
            // Create active servers array to track connected transports
            const activeServers = [];
            
            // Start MCP server with stdio transport if enabled
            if (options.stdio) {
                try {
                    const stdioTransport = new StdioServerTransport();
                    logger.info('Created StdioServerTransport');
                    // Hack: Add a small delay before connecting to ensure stdio is ready
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    logger.info('Connecting MCP server to stdio transport...');
                
                    // Connect stdio transport in background
                    server.connect(stdioTransport).catch((transportError) => {
                        logger.error('Error connecting to stdio transport:', transportError);
                    });
                    activeServers.push(server);
                    logger.info('Stdio transport connected');
                } catch (error) {
                    logger.error('Failed to start stdio transport:', error);
                }
            }
            // Start SSE transport if enabled
            if (options.sse) {
                try {
                    const port = options.port;
                    const endpoint = options.endpoint;
                    logger.info(`Starting SSE server on port ${port} with endpoint ${endpoint}`);
                    
                    const activeTransports: Record<string, SSEServerTransport> = {};
                    
                    const sseServer = http.createServer(async (req, res) => {
                        if (req.headers.origin) {
                            try {
                                const origin = new URL(req.headers.origin);
                                res.setHeader("Access-Control-Allow-Origin", origin.origin);
                                res.setHeader("Access-Control-Allow-Credentials", "true");
                                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                                res.setHeader("Access-Control-Allow-Headers", "*");
                            } catch (error) {
                                logger.error("Error parsing origin:", error);
                            }
                        }
                        if (req.method === "OPTIONS") {
                            res.writeHead(204);
                            res.end();
                            return;
                        }

                        if (req.method === "GET" && req.url === `/ping`) {
                            res.writeHead(200).end("pong");
                            return;
                        }
                        if (req.method === "GET" && new URL(req.url!, "http://localhost").pathname === endpoint) {
                            logger.debug('New SSE connection request received');
                            // Create new SSE transport for this connection with MCP context
                            const transport = new SSEServerTransport("joyia-mcp-sse", res);
                            activeTransports[transport.sessionId] = transport;
                            logger.debug(`Created SSE transport with session ID: ${transport.sessionId}`);
                        
                            let closed = false;
                            const cleanup = async () => {
                                if (closed) return;
                                closed = true;
                                try {
                                    logger.debug(`Cleaning up SSE transport for session: ${transport.sessionId}`);
                                    await transport.close();
                                } catch (error) {
                                    // Don't log AbortError as an error since it's expected
                                    if (!(error instanceof Error && error.name === 'AbortError')) {
                                        logger.error("Error closing SSE transport:", error);
                                    }
                                }
                                delete activeTransports[transport.sessionId];
                                logger.info(`SSE client disconnected: ${transport.sessionId}`);
                            };
                            // Handle various connection termination scenarios
                            res.on("close", () => {
                                logger.debug(`SSE connection closed for session: ${transport.sessionId}`);
                                cleanup();
                            });
                            res.on("error", (error) => {
                                // Don't log AbortError as an error since it's expected
                                if (!(error instanceof Error && error.name === 'AbortError')) {
                                    logger.error(`SSE connection error for session ${transport.sessionId}:`, error);
                                }
                                cleanup();
                            });
                            req.on("error", (error) => {
                                // Don't log AbortError as an error since it's expected
                                if (!(error instanceof Error && error.name === 'AbortError')) {
                                    logger.error(`SSE request error for session ${transport.sessionId}:`, error);
                                }
                                cleanup();
                            });
                            try {
                                logger.debug(`Connecting server to SSE transport for session: ${transport.sessionId}`);
                                await server.connect(transport);
                                logger.debug(`Sending connection established message to session: ${transport.sessionId}`);
                                await transport.send({
                                    jsonrpc: "2.0",
                                    method: "sse/connection",
                                    params: { message: "SSE Connection established" },
                                });
                                logger.info(`SSE client connected: ${transport.sessionId}`);
                            } catch (error) {
                                if (!closed) {
                                    // Don't log AbortError as an error since it's expected
                                    if (!(error instanceof Error && error.name === 'AbortError')) {
                                        logger.error("Error connecting to SSE client:", error);
                                    }
                                    res.writeHead(500).end("Error connecting to server");
                                }
                            }
                            return;
                        }
                        // Handle legacy SSE POST requests
                        if (req.method === "POST") {
                            logger.info(`POST request received at: ${req.url}`);
                            logger.info('Request headers:', req.headers);
                        
                            const url = new URL(req.url!, "http://localhost");
                            if (url.pathname === '/joyia-mcp-sse') {
                                logger.info('POST request matches SSE endpoint');
                                const sessionId = url.searchParams.get('sessionId');
                                if (!sessionId) {
                                    logger.info('No session ID in POST request');
                                    res.writeHead(400).end("No sessionId");
                                    return;
                                }
                                logger.info(`Looking up transport for session: ${sessionId}`);
                                const activeTransport = activeTransports[sessionId];
                                if (!activeTransport) {
                                    logger.info(`No active transport found for session: ${sessionId}`);
                                    res.writeHead(400).end("No active transport");
                                    return;
                                }
                                try {
                                    logger.info(`Processing POST message for session: ${sessionId}`);
                                
                                    // Create a simple interceptor for logging
                                    req.on('data', (chunk) => {
                                        try {
                                            // Try to parse the chunk as JSON
                                            const data = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
                                    
                                            // Try to parse as JSON
                                            try {
                                                const message = JSON.parse(data);
                                                // Log message info if it has a method
                                                if (message && message.method) {
                                                    logger.info(`Request: ${message.method}`);
                                        
                                                    // Log extra details for tool execution
                                                    if (message.method === 'tool/execute' && message.params) {
                                                        logger.info(`Tool: ${message.params.name || 'unknown'}`);
                                                        logger.info(`Args: ${JSON.stringify(message.params.args || {}).slice(0, 100)}...`);
                                                    }
                                                }
                                            } catch (_jsonError) {
                                                // Not valid JSON or incomplete chunk, ignore
                                            }
                                        } catch (_e) {
                                            // Silently ignore logging errors
                                        }
                                    });
                                
                                    // Process the message with the transport
                                    await activeTransport.handlePostMessage(req, res);
                                } catch (error) {
                                    logger.error(`Error handling POST message for session ${sessionId}:`, error);
                                    res.writeHead(500).end("Error processing message");
                                }
                                return;
                            }
                        }
                        // Default handler for unmatched routes
                        res.writeHead(404).end("Not found");
                    });
                    // Start HTTP server
                    await new Promise<void>((resolve, reject) => {
                        sseServer.listen(port, "::", () => {
                            logger.info(`SSE server listening on port ${port}`);
                            resolve();
                        }).on('error', (error: Error) => {
                            logger.error('Failed to start HTTP server:', error);
                            reject(error);
                        });
                    });
                } catch (error) {
                    logger.error('Failed to start SSE server:', error);
                }
            }
            // Keep the process alive
            // Display AI provider and model information, similar to agent chat
            const llmProvider = aiService.getLLMProvider();
            const providerName = llmProvider.name.toUpperCase();
            const modelName = aiService.model;
            
            logger.info('');
            logger.info('🤖 MCP Server initialized with:');
            logger.info(`Provider: ${colors.cyan(providerName)}`);
            logger.info(`Model: ${colors.cyan(modelName)}`);
            logger.info(`MCP Tools: ${colors.green('Enabled')}`);
            logger.info('');
            
            logger.info('MCP server started and running. Press Ctrl+C to exit.');
            await new Promise(() => {}); // Never resolve
            
        } catch (error) {
            logger.error('Failed to start MCP server:', error);
            // Keep the process alive for debugging purposes
            logger.info('Keeping process alive for debugging. Press Ctrl+C to exit.');
            await new Promise(() => {}); // Never resolve
        }
    });
    // Add help subcommand to server
    mcpServerCommand.command('help')
        .description('Show help for MCP server command')
        .action(() => {
            const logger = new Logger('MCP Server');
            logger.passThrough('log', '\nMCP Server Command\n');
            logger.passThrough('log', 'Usage:');
            logger.passThrough('log', '  nova mcp server [options]');
            logger.passThrough('log', '\nOptions:');
            logger.passThrough('log', '  --port <port>        HTTP port for SSE transport (default: 3020)');
            logger.passThrough('log', '  --stdio              Enable stdio transport (default: true)');
            logger.passThrough('log', '  --no-stdio           Disable stdio transport');
            logger.passThrough('log', '  --sse                Enable SSE transport (default: true)');
            logger.passThrough('log', '  --no-sse             Disable SSE transport');
            logger.passThrough('log', '  --endpoint <path>    Endpoint for SSE transport (default: /mcp)');
            logger.passThrough('log', '  --inspect <address>  Enable inspector on host:port (default: 127.0.0.1:9229)');
            logger.passThrough('log', '  --inspect-brk <address> Enable inspector on host:port and break at start of script');
            logger.passThrough('log', '  --allow-all          Allow all permissions');
            logger.passThrough('log', '\nDescription:');
            logger.passThrough('log', '  Starts the MCP server that provides AI tools and resources');
            logger.passThrough('log', '  through the Model Context Protocol.');
            logger.passThrough('log', '\nEnvironment Variables:');
            logger.passThrough('log', '  NOVA_DEBUG=true    Enable debug logging');
            logger.passThrough('log', '\nExamples:');
            logger.passThrough('log', colors.dim('  # Start the MCP server with all transports'));
            logger.passThrough('log', colors.dim('  nova mcp server'));
            logger.passThrough('log', colors.dim('  # Start with only stdio transport'));
            logger.passThrough('log', colors.dim('  nova mcp server --sse=false'));
            logger.passThrough('log', colors.dim('  # Start with only SSE transport on port 4000'));
            logger.passThrough('log', colors.dim('  nova mcp server --stdio=false --port=4000'));
            logger.passThrough('log', '');
        });
    // Main MCP command
    export const mcpCommand = new Command()
        .name('mcp')
        .description('Model Context Protocol (MCP) operations')
        .action(() => {
            const logger = new Logger('MCP');
            logger.passThrough('log', colors.blue('\nMCP Command Help\n'));
            logger.passThrough('log', 'Usage:');
            logger.passThrough('log', '  nova mcp <command>\n');
            logger.passThrough('log', 'Available Commands:');
            logger.passThrough('log', '  nova mcp setup         - Set up MCP configuration');
            logger.passThrough('log', '  nova mcp server        - Start the MCP server\n');
            logger.passThrough('log', 'Examples:');
            logger.passThrough('log', colors.dim('  # Set up MCP in current repository'));
            logger.passThrough('log', colors.dim('  nova mcp setup'));
            logger.passThrough('log', colors.dim('  # Start the MCP server'));
            logger.passThrough('log', colors.dim('  nova mcp server'));
            logger.passThrough('log', colors.dim('  # Start with debug logging'));
            logger.passThrough('log', colors.dim('  NOVA_DEBUG=true nova mcp server\n'));
        })
        .command('setup', mcpSetupCommand)
        .command('server', mcpServerCommand);

/**
 * Register resources with the MCP server
*/
function registerResources(
    server: McpServer,
    config: Record<string, unknown>,
    logger: Logger,
): void {
    // System Info resource - provides information about the system
    server.resource(
        'system-info',
        'system://info',
        (uri) => {
            const systemInfo = {
                os: Deno.build.os,
                arch: Deno.build.arch,
                version: Deno.version.deno,
                workingDir: Deno.cwd(),
                env: {
                    HOME: Deno.env.get('HOME'),
                    PATH: Deno.env.get('PATH')?.split(':').slice(0, 3).join(':') + '...', // Truncated for brevity
                },
            };
            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(systemInfo, null, 2),
                }],
            };
        },
    );
    // Config resource - provides configuration information
    server.resource(
        'config',
        'config://nova',
        (uri) => {
            // Create a sanitized version of the config without sensitive info
            const sanitizedConfig = {
                // Include only safe parts of the config
                version: config.version,
                features: config.features,
                integrations: Object.keys(config).filter((key) =>
                    typeof config[key] === 'object' && key !== 'secrets'
                ),
            };
            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(sanitizedConfig, null, 2),
                }],
            };
        },
    );
    // Register file resources with different URI templates
    // 1. file://{path*} - Standard format
    server.resource(
        'file-standard',
        new ResourceTemplate('file://{path*}', { list: undefined }),
        handleFileResource(logger),
    );
    // 2. file:///{path*} - Format with three slashes
    server.resource(
        'file-triple-slash',
        new ResourceTemplate('file:///{path*}', { list: undefined }),
        handleFileResource(logger),
    );
    // 3. file://{filename} - Simple format for files in current directory
    server.resource(
        'file-simple',
        new ResourceTemplate('file://{filename}', { list: undefined }),
        async (uri, { filename }) => {
            try {
                logger.debug(`Simple file resource accessed: ${filename}`);
                const content = await Deno.readTextFile(filename as string);
                return {
                    contents: [{
                        uri: uri.href,
                        text: content,
                    }],
                };
            } catch (error) {
                logger.error(`Failed to read file ${filename}:`, error);
                throw error;
            }
        },
    );

    // Help resource - provides help information
    server.resource(
        'help',
        'help://usage',
        (uri) => {
            const helpText = `
                # Nova MCP Server Help

                This server exposes Nova functionality through the Model Context Protocol.

                ## Available Resources
                - system://info - System information
                - config://nova - Nova configuration
                - file://{path} - Access files by path
                - help://usage - This help information

                ## Available Tools
                - File operations: file_read, list_dir, run_terminal_cmd
                - GitLab: gitlab_search, gitlab_create_issue
                - Jira: jira_search, jira_create_issue
                - Confluence: confluence_search, confluence_create_page
                - Datadog: datadog_search
            `;
            return {
                contents: [{
                    uri: uri.href,
                    text: helpText,
                }],
            };
        },
    );
}
/**
 * Creates a resource handler function for file access
*/
function handleFileResource(logger: Logger) {
    return async (uri: URL, params: Record<string, unknown>) => {
        try {
            // Extract path from params
            const path = params.path as string;

            // Log the incoming URI and extracted path for debugging
            logger.debug(`File resource accessed with URI: ${uri.href}, extracted path: ${path}`);

            // Clean up the path - remove leading slashes which might be part of the URI
            const fullPath = path.replace(/^\/+/, '');
            logger.debug(`Cleaned path: ${fullPath}`);

            const workingDir = Deno.cwd();

            // Simple security check - prevent directory traversal
            if (fullPath.includes('..')) {
                throw new Error("Path cannot contain '..' for security reasons");
            }

            try {
                // Try to read the file directly
                logger.debug(`Trying to read file: ${fullPath}`);
                const fileContent = await Deno.readTextFile(fullPath);

                return {
                    contents: [{
                        uri: uri.href,
                        text: fileContent,
                    }],
                };
            } catch (readError) {
                // If direct read fails, try a case-insensitive search for the file
                logger.debug(`Failed to read file directly: ${readError}. Trying case-insensitive search.`);

                // If it's a simple filename (not a path), check if it exists with different casing
                if (!fullPath.includes('/') && !fullPath.includes('\\')) {
                    // List the directory and find a case-insensitive match
                    for await (const entry of Deno.readDir(workingDir)) {
                        if (entry.isFile && entry.name.toLowerCase() === fullPath.toLowerCase()) {
                            // Found a match with different casing
                            const correctPath = entry.name;
                            logger.debug(`Found case-insensitive match: ${correctPath}`);
                            const content = await Deno.readTextFile(correctPath);

                            return {
                                contents: [{
                                    uri: uri.href,
                                    text: content,
                                }],
                            };
                        }
                    }
                }
                 // If we get here, we couldn't find the file
                throw new Error(`File not found: ${fullPath}`);
            }
        } catch (error) {
            logger.error(`Failed to read file:`, error);
            throw error;
        }
    };
}      