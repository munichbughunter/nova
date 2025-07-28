import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Buffer } from 'node:buffer';
import http from 'node:http';
import type { ZodOptional, ZodType, ZodTypeDef } from 'zod';
import { z } from 'zod';
import { configManager } from '../config/mod.ts';
import prompts from '../mcp/prompts.ts';
import { AIService } from '../services/ai_service.ts';
import { ConfluenceService } from '../services/confluence_service.ts';
import { DatadogService } from '../services/datadog_service.ts';
import { GitLabService } from '../services/gitlab_service.ts';
import { JiraService } from '../services/jira_service.ts';
import { MCPService } from '../services/mcp_service.ts';
import { Logger } from '../utils/logger.ts';
import { NOVA_VERSION } from '../version.ts';
import { mcpWebCommand } from './mcp_a2a.ts';
import { mcpSetupCommand } from './mcp_setup.ts';

// Add this type alias near the top of the file (after imports):
type MCPPromptResponse = {
  messages: Array<
    {
      [x: string]: unknown;
      role: string;
      content: { [x: string]: unknown; type: 'text'; text: string };
    }
  >;
};

// Create server command
export const mcpServerCommand = new Command()
  .description('Start the MCP server')
  .option('--port <port:number>', 'HTTP port for transport', { default: 3020 })
  .option('--transport <transport:string>', 'Transport type to use (streamable, sse, or stdio)', {
    default: 'streamable',
  })
  .option('--endpoint <endpoint:string>', 'Endpoint for HTTP/SSE transport', { default: '/mcp' })
  .option('--inspect <address:string>', 'Enable inspector on host:port (default: 127.0.0.1:9229)')
  .option(
    '--inspect-brk <address:string>',
    'Enable inspector on host:port and break at start of script',
  )
  .option('--allow-all', 'Allow all permissions')
  .action(async (options) => {
    // Immediately disable all logging if stdio transport is specified
    if (options.transport === 'stdio') {
      // Disable all possible console methods
      console.log = () => {};
      console.error = () => {};
      console.warn = () => {};
      console.info = () => {};
      console.debug = () => {};

      try {
        // Load configuration silently
        const config = await configManager.loadConfig();

        // Initialize AI service
        const aiService = new AIService(config);

        // Initialize GitLab service if configured
        const gitlabService = config.gitlab?.url ? new GitLabService(config) : undefined;

        // Initialize Jira service if configured
        const jiraService = config.atlassian?.jira_url ? new JiraService(config) : undefined;

        // Initialize Confluence service if configured
        const confluenceService = config.atlassian?.confluence_url
          ? new ConfluenceService(config)
          : undefined;

        // Initialize Datadog service if configured
        const datadogService = config.datadog?.api_key ? new DatadogService(config) : undefined;

        // Create MCP context with all services
        const mcpContext = {
          workingDirectory: Deno.cwd(),
          mcpService: MCPService.getInstance(config),
          ai: {
            llmProvider: aiService.getLLMProvider(),
          },
          gitlab: gitlabService,
          jira: jiraService,
          confluence: confluenceService,
          datadog: datadogService,
        };

        // Create MCP server without debug mode for stdio
        const server = new McpServer({
          name: 'nova-mcp',
          version: NOVA_VERSION,
          debug: false,
          capabilities: {
            prompts: {}, // Declare the prompts capability
          },
        });

        // Create a silent logger
        const silentLogger = new Logger('silent');
        // Override all methods to be silent
        silentLogger.info = () => {};
        silentLogger.debug = () => {};
        silentLogger.error = () => {};
        silentLogger.warn = () => {};
        silentLogger.success = () => {};
        silentLogger.passThrough = () => {};

        // Register resources silently
        registerResources(server, config, silentLogger);

        // Register tools from MCP service
        const tools = mcpContext.mcpService.getToolsForContext('ide');

        // Add tools to server silently
        for (const tool of tools) {
          const { name, description, parameters } = tool.function;
          try {
            // Convert parameters to ZodSchema
            const paramProps: Record<string, z.ZodTypeAny> = {};
            if (parameters.properties) {
              const required = parameters.required as string[] || [];
              for (
                const [key, prop] of Object.entries(
                  parameters.properties as Record<string, Record<string, unknown>>,
                )
              ) {
                let schema: z.ZodTypeAny;
                switch (prop.type) {
                  case 'string':
                    schema = z.string().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                    if (prop.enum) {
                      schema = z.enum(prop.enum as [string, ...string[]]).describe(
                        typeof prop.description === 'string' ? prop.description : '',
                      );
                    }
                    break;
                  case 'number':
                  case 'integer':
                    schema = z.number().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                    break;
                  case 'boolean':
                    schema = z.boolean().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                    break;
                  case 'array': {
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
                    schema = z.array(itemSchema).describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                    break;
                  }
                  default:
                    schema = z.unknown().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                }
                if (prop.example) {
                  schema = schema.describe(
                    `${schema.description} Example: ${JSON.stringify(prop.example)}`,
                  );
                }
                if (!required.includes(key)) {
                  schema = schema.optional();
                }
                paramProps[key] = schema;
              }
            }
            // Register tool with server
            server.tool(
              name,
              description,
              // deno-lint-ignore no-explicit-any
              paramProps as any,
              async (args: Record<string, unknown>) => {
                try {
                  const result = await mcpContext.mcpService.executeTool(name, args, mcpContext);
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
          } catch (_error) {
            // Silently continue if tool registration fails
          }
        }
        // Register prompts directly on the server
        registerPrompts(server);

        // Initialize stdio transport and connect
        const stdioTransport = new StdioServerTransport();
        await server.connect(stdioTransport);

        // Keep the process alive without any logging
        await new Promise(() => {});
      } catch (_error) {
        // Exit silently
        Deno.exit(1);
      }
    } else {
      // For non-stdio transports, proceed with regular logging
      const logger = new Logger('MCP Server');

      // Check for debug environment variables
      const debug = Deno.env.get('nova_DEBUG') === 'true';

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

        // Initialize Jira service if configured
        const jiraService = config.atlassian?.jira_url ? new JiraService(config) : undefined;
        if (jiraService) {
          logger.info('Jira service initialized');
        }

        // Initialize Confluence service if configured
        const confluenceService = config.atlassian?.confluence_url
          ? new ConfluenceService(config)
          : undefined;
        if (confluenceService) {
          logger.info('Confluence service initialized');
        }

        // Initialize Datadog service if configured
        const datadogService = config.datadog?.api_key ? new DatadogService(config) : undefined;
        if (datadogService) {
          logger.info('Datadog service initialized');
        }

        // Create MCP context with all services
        const mcpContext = {
          workingDirectory: Deno.cwd(),
          mcpService: MCPService.getInstance(config),
          ai: {
            llmProvider: aiService.getLLMProvider(),
          },
          gitlab: gitlabService,
          jira: jiraService,
          confluence: confluenceService,
          datadog: datadogService,
        };

        // Create MCP server with debug mode if enabled
        const server = new McpServer({
          name: 'nova-mcp',
          version: NOVA_VERSION,
          debug: debug,
          capabilities: {
            prompts: {}, // Declare the prompts capability
            resources: {}, // Declare the resources capability
          },
        });

        // Add basic resources
        logger.info('Registering MCP resources...');
        registerResources(server, config, logger);

        logger.info('Registering MCP tools...');

        // Register all MCP tools from the MCP service with the context
        const tools = mcpContext.mcpService.getToolsForContext('ide');

        // Add tools to the MCP server
        for (const tool of tools) {
          const { name, description, parameters } = tool.function;

          try {
            // Convert parameters to a ZodSchema with descriptions and examples
            const paramProps: Record<string, z.ZodTypeAny> = {};

            if (parameters.properties) {
              const required = parameters.required as string[] || [];

              for (
                const [key, prop] of Object.entries(
                  parameters.properties as Record<string, Record<string, unknown>>,
                )
              ) {
                // Create a schema based on the property type with descriptions
                let schema: z.ZodTypeAny;

                switch (prop.type) {
                  case 'string':
                    schema = z.string().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                    // Handle enums
                    if (prop.enum) {
                      schema = z.enum(prop.enum as [string, ...string[]]).describe(
                        typeof prop.description === 'string' ? prop.description : '',
                      );
                    }
                    break;
                  case 'number':
                  case 'integer':
                    schema = z.number().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                    break;
                  case 'boolean':
                    schema = z.boolean().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
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

                    schema = z.array(itemSchema).describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                    break;
                  }
                  default:
                    schema = z.unknown().describe(
                      typeof prop.description === 'string' ? prop.description : '',
                    );
                }

                // Add example if available
                if (prop.example) {
                  schema = schema.describe(
                    `${schema.description} Example: ${JSON.stringify(prop.example)}`,
                  );
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
                    mcpContext,
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

        // Register MCP prompts
        logger.info('Registering MCP prompts...');

        // Add special tools to handle MCP prompts protocol
        setupMcpPrompts(server, false);

        // Register prompts directly on the server
        registerPrompts(server);

        // Log information about available prompts
        logger.info('MCP prompts available:');
        for (const [_key, promptDef] of Object.entries(prompts)) {
          logger.info(`  - ${promptDef.name}: ${promptDef.description}`);
        }

        logger.info('Tools, resources, and prompts registered, starting server...');

        // Log all status information before transport initialization
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

        // --- TRANSPORT SELECTION ---
        if (options.transport === 'stdio') {
          try {
            // Initialize stdio transport first
            const stdioTransport = new StdioServerTransport();

            // Connect without any logging
            await server.connect(stdioTransport);

            // Keep the process alive without any logging
            await new Promise(() => {});
          } catch (error) {
            // Only log errors to stderr
            console.error('Failed to start stdio transport:', error);
            Deno.exit(1);
          }
        } else if (options.transport === 'sse') {
          // Legacy SSE transport
          try {
            const port = options.port;
            const endpoint = options.endpoint;
            logger.info(
              `Starting SSE server on port ${port} with endpoint ${endpoint} (Legacy mode)`,
            );
            const activeTransports: Record<string, SSEServerTransport> = {};
            const sseServer = http.createServer((req, res) => {
              if (req.headers.origin) {
                try {
                  const origin = new URL(req.headers.origin);
                  res.setHeader('Access-Control-Allow-Origin', origin.origin);
                  res.setHeader('Access-Control-Allow-Credentials', 'true');
                  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                  res.setHeader('Access-Control-Allow-Headers', '*');
                } catch (error) {
                  logger.error('Error parsing origin:', error);
                }
              }
              if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
              }
              if (req.method === 'GET' && req.url === `/ping`) {
                res.writeHead(200).end('pong');
                return;
              }
              if (
                req.method === 'GET' && new URL(req.url!, 'http://localhost').pathname === endpoint
              ) {
                logger.debug('New SSE connection request received');
                const transport = new SSEServerTransport('nova-mcp-sse', res);
                activeTransports[transport.sessionId] = transport;
                logger.debug(`Created SSE transport with session ID: ${transport.sessionId}`);
                let closed = false;
                const cleanup = () => {
                  if (closed) return;
                  closed = true;
                  try {
                    logger.debug(`Cleaning up SSE transport for session: ${transport.sessionId}`);
                    transport.close();
                  } catch (error) {
                    if (!(error instanceof Error && error.name === 'AbortError')) {
                      logger.error('Error closing SSE transport:', error);
                    }
                  }
                  delete activeTransports[transport.sessionId];
                  logger.info(`SSE client disconnected: ${transport.sessionId}`);
                };
                res.on('close', () => {
                  logger.debug(`SSE connection closed for session: ${transport.sessionId}`);
                  cleanup();
                });
                res.on('error', (error) => {
                  if (!(error instanceof Error && error.name === 'AbortError')) {
                    logger.error(`SSE connection error for session ${transport.sessionId}:`, error);
                  }
                  cleanup();
                });
                req.on('error', (error) => {
                  if (!(error instanceof Error && error.name === 'AbortError')) {
                    logger.error(`SSE request error for session ${transport.sessionId}:`, error);
                  }
                  cleanup();
                });
                try {
                  logger.debug(
                    `Connecting server to SSE transport for session: ${transport.sessionId}`,
                  );
                  server.connect(transport);
                  logger.debug(
                    `Sending connection established message to session: ${transport.sessionId}`,
                  );
                  transport.send({
                    jsonrpc: '2.0',
                    method: 'sse/connection',
                    params: { message: 'SSE Connection established' },
                  });
                  logger.info(`SSE client connected: ${transport.sessionId}`);
                } catch (error) {
                  if (!closed) {
                    if (!(error instanceof Error && error.name === 'AbortError')) {
                      logger.error('Error connecting to SSE client:', error);
                    }
                    res.writeHead(500).end('Error connecting to server');
                  }
                }
                return;
              }
              // Handle legacy SSE POST requests
              if (req.method === 'POST') {
                logger.debug(`POST request received at: ${req.url}`);

                const url = new URL(req.url!, 'http://localhost');
                if (url.pathname === '/nova-mcp-sse') {
                  logger.debug('POST request matches SSE endpoint');
                  const sessionId = url.searchParams.get('sessionId');
                  if (!sessionId) {
                    logger.info('No session ID in POST request');
                    res.writeHead(400).end('No sessionId');
                    return;
                  }

                  logger.debug(`Looking up transport for session: ${sessionId}`);
                  const activeTransport = activeTransports[sessionId];
                  if (!activeTransport) {
                    logger.info(`No active transport found for session: ${sessionId}`);
                    res.writeHead(400).end('No active transport');
                    return;
                  }

                  // Get a copy of the request body for debugging without affecting the actual request
                  if (Deno.env.get('nova_DEBUG') === 'true') {
                    // Create a copy of the request to log without disturbing the original
                    const chunks: Buffer[] = [];
                    req.on('data', (chunk) => {
                      // Don't consume the data, just make a copy for logging
                      const chunkCopy = Buffer.from(chunk);
                      chunks.push(chunkCopy);
                    });

                    req.on('end', () => {
                      // Log only when debugging is enabled
                      try {
                        const bodyStr = Buffer.concat(chunks).toString();
                        try {
                          const data = JSON.parse(bodyStr);
                          if (data && data.method) {
                            logger.debug(`Request method: ${data.method}`);
                          }
                        } catch (_e) {
                          // Silently ignore JSON parse errors for debugging
                        }
                      } catch (_e) {
                        // Silently ignore for debugging
                      }
                    });
                  }

                  try {
                    // Let the SDK handle the message completely
                    activeTransport.handlePostMessage(req, res);
                  } catch (error) {
                    logger.error(
                      `Error in SSE transport while handling POST for session ${sessionId}:`,
                      error,
                    );
                    if (!res.headersSent) {
                      res.writeHead(500).end('Error processing message');
                    }
                  }
                  return;
                }
              }
              res.writeHead(404).end('Not found');
            });
            await new Promise<void>((resolve, reject) => {
              sseServer.listen(port, '::', () => {
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
        } else {
          // Default: Streamable HTTP transport (Modern protocol version)
          try {
            const port = options.port;
            const endpoint = options.endpoint;
            logger.info(
              `Starting Streamable HTTP server on port ${port} with endpoint ${endpoint}`,
            );

            // Store active transports by session ID
            const activeTransports: Record<string, StreamableHTTPServerTransport> = {};

            const httpServer = http.createServer((req, res) => {
              // Handle CORS
              if (req.headers.origin) {
                try {
                  const origin = new URL(req.headers.origin);
                  res.setHeader('Access-Control-Allow-Origin', origin.origin);
                  res.setHeader('Access-Control-Allow-Credentials', 'true');
                  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
                  res.setHeader('Access-Control-Allow-Headers', '*');
                } catch (error) {
                  logger.error('Error parsing origin:', error);
                }
              }

              // Handle preflight requests
              if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
              }

              // Health check endpoint
              if (req.method === 'GET' && req.url === `/ping`) {
                res.writeHead(200).end('pong');
                return;
              }

              // Handle Streamable HTTP protocol requests
              if (new URL(req.url!, 'http://localhost').pathname === endpoint) {
                try {
                  const sessionId = req.headers['mcp-session-id'] as string | undefined;
                  let transport: StreamableHTTPServerTransport;

                  // Check if we have an existing transport for this session
                  if (sessionId && activeTransports[sessionId]) {
                    transport = activeTransports[sessionId];
                    logger.debug(`Found existing transport for session: ${sessionId}`);
                  } else if (!sessionId && req.method === 'POST') {
                    // New session initialization
                    logger.info('Creating new Streamable HTTP transport');
                    transport = new StreamableHTTPServerTransport({
                      sessionIdGenerator: () => crypto.randomUUID(),
                      onsessioninitialized: (sid) => {
                        logger.info(`New Streamable HTTP session initialized: ${sid}`);
                        activeTransports[sid] = transport;
                      },
                    });

                    // Setup cleanup on close
                    transport.onclose = () => {
                      const sid = transport.sessionId;
                      if (sid && activeTransports[sid]) {
                        logger.info(`Streamable HTTP transport closed for session ${sid}`);
                        delete activeTransports[sid];
                      }
                    };

                    // Connect transport to server
                    server.connect(transport);
                  } else {
                    // Invalid request - missing session ID
                    logger.warn('Invalid Streamable HTTP request - missing or invalid session ID');
                    res.writeHead(400).end(JSON.stringify({
                      jsonrpc: '2.0',
                      error: {
                        code: -32000,
                        message: 'Bad Request: No valid session ID provided',
                      },
                      id: null,
                    }));
                    return;
                  }

                  // Get the request body for POST requests
                  let body = undefined;
                  if (req.method === 'POST') {
                    body = new Promise<unknown>((resolve) => {
                      const chunks: Buffer[] = [];
                      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                      req.on('end', () => {
                        const bodyStr = Buffer.concat(chunks).toString();
                        try {
                          resolve(bodyStr ? JSON.parse(bodyStr) : undefined);
                        } catch (_e) {
                          logger.error('Error parsing request body:', _e);
                          resolve(undefined);
                        }
                      });
                    });
                  }

                  // Handle DELETE requests for session cleanup
                  if (req.method === 'DELETE' && sessionId) {
                    logger.info(`Received DELETE request for session: ${sessionId}`);
                    try {
                      if (activeTransports[sessionId]) {
                        activeTransports[sessionId].close();
                        delete activeTransports[sessionId];
                        res.writeHead(200).end('Session closed');
                      } else {
                        res.writeHead(404).end('Session not found');
                      }
                    } catch (error) {
                      logger.error(`Error closing session ${sessionId}:`, error);
                      res.writeHead(500).end('Error closing session');
                    }
                    return;
                  }

                  // Handle the request with the transport
                  transport.handleRequest(req, res, body);
                } catch (error) {
                  logger.error('Error handling Streamable HTTP request:', error);
                  if (!res.headersSent) {
                    res.writeHead(500).end(JSON.stringify({
                      jsonrpc: '2.0',
                      error: {
                        code: -32603,
                        message: 'Internal server error',
                      },
                      id: null,
                    }));
                  }
                }
                return;
              }

              // Handle all other requests
              res.writeHead(404).end('Not found');
            });

            await new Promise<void>((resolve, reject) => {
              httpServer.listen(port, '::', () => {
                logger.info(`Streamable HTTP server listening on port ${port}`);
                logger.info(`Endpoint: ${endpoint}`);
                logger.info(`Protocol version: 2025-03-26`);
                resolve();
              }).on('error', (error: Error) => {
                logger.error('Failed to start HTTP server:', error);
                reject(error);
              });
            });
          } catch (error) {
            logger.error('Failed to start Streamable HTTP server:', error);
          }
        }

        // Keep the process alive
        await new Promise(() => {}); // Never resolve
      } catch (error) {
        logger.error('Failed to start MCP server:', error);

        // Keep the process alive for debugging purposes
        logger.info('Keeping process alive for debugging. Press Ctrl+C to exit.');
        await new Promise(() => {}); // Never resolve
      }
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
    logger.passThrough('log', '  --port <port>        HTTP port for transport (default: 3020)');
    logger.passThrough(
      'log',
      '  --transport <type>   Transport type to use (streamable, sse, or stdio) (default: streamable)',
    );
    logger.passThrough(
      'log',
      '  --endpoint <path>    Endpoint for HTTP/SSE transport (default: /mcp)',
    );
    logger.passThrough(
      'log',
      '  --inspect <address>  Enable inspector on host:port (default: 127.0.0.1:9229)',
    );
    logger.passThrough(
      'log',
      '  --inspect-brk <address> Enable inspector on host:port and break at start of script',
    );
    logger.passThrough('log', '  --allow-all          Allow all permissions');
    logger.passThrough('log', '\nDescription:');
    logger.passThrough('log', '  Starts the MCP server that provides AI tools and resources');
    logger.passThrough('log', '  through the Model Context Protocol.');
    logger.passThrough('log', '\nEnvironment Variables:');
    logger.passThrough('log', '  nova_DEBUG=true    Enable debug logging');
    logger.passThrough('log', '\nExamples:');
    logger.passThrough(
      'log',
      colors.dim('  # Start the MCP server with Streamable HTTP transport (default)'),
    );
    logger.passThrough('log', colors.dim('  nova mcp server'));
    logger.passThrough('log', colors.dim('  # Start with SSE transport'));
    logger.passThrough('log', colors.dim('  nova mcp server --transport=sse'));
    logger.passThrough('log', colors.dim('  # Start with stdio transport'));
    logger.passThrough('log', colors.dim('  nova mcp server --transport=stdio'));
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
    logger.passThrough(
      'log',
      colors.dim('  # Set up global MCP configuration (for all projects, Claude Desktop, etc.)'),
    );
    logger.passThrough('log', colors.dim('  nova mcp setup --global'));
    logger.passThrough(
      'log',
      colors.dim('  # Start the MCP server with default transport (Streamable HTTP)'),
    );
    logger.passThrough('log', colors.dim('  nova mcp server'));
    logger.passThrough('log', colors.dim('  # Start with legacy SSE transport'));
    logger.passThrough('log', colors.dim('  nova mcp server --transport=sse'));
    logger.passThrough(
      'log',
      colors.dim('  # Start with stdio transport (for Amazon Q, Claude Desktop, etc.)'),
    );
    logger.passThrough('log', colors.dim('  nova mcp server --transport=stdio'));
    logger.passThrough('log', colors.dim('  # Start with debug logging'));
    logger.passThrough('log', colors.dim('  nova_DEBUG=true nova mcp server\n'));
    logger.passThrough('log', 'Integrations:');
    logger.passThrough(
      'log',
      '  VS Code     - SSE transport (.vscode/mcp.json or ~/.vscode/mcp.json)',
    );
    logger.passThrough(
      'log',
      '  Cursor      - SSE transport (.cursor/mcp.json or ~/.cursor/mcp.json)',
    );
    logger.passThrough(
      'log',
      '  Amazon Q    - stdio transport (.amazonq/mcp.json or ~/.amazonq/mcp.json)',
    );
    logger.passThrough(
      'log',
      '  Claude      - stdio transport (.claude/mcp.json or ~/.claude/mcp.json)',
    );
    logger.passThrough('log', '');
  })
  .command('setup', mcpSetupCommand)
  .command('a2a', mcpWebCommand)
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
        // Always use NOVA_VERSION for version
        version: NOVA_VERSION,
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
    async (uri, { path }) => {
      try {
        logger.debug(`File resource accessed with URI: ${uri.href}, extracted path: ${path}`);
        const fullPath = (path as string).replace(/^\/+/, '');

        try {
          const fileContent = await Deno.readTextFile(fullPath);
          return {
            contents: [{
              uri: uri.href,
              text: fileContent,
            }],
          };
        } catch (readError) {
          const typedError = readError as Error;
          throw new Error(`Failed to read file ${fullPath}: ${typedError.message}`);
        }
      } catch (error) {
        const typedError = error as Error;
        logger.error(`Failed to read file:`, typedError);
        throw error;
      }
    },
  );

  // 2. file:///{path*} - Format with three slashes
  server.resource(
    'file-triple-slash',
    new ResourceTemplate('file:///{path*}', { list: undefined }),
    async (uri, { path }) => {
      try {
        logger.debug(`Triple-slash file resource accessed: ${path}`);
        const fullPath = (path as string).replace(/^\/+/, '');
        const fileContent = await Deno.readTextFile(fullPath);

        return {
          contents: [{
            uri: uri.href,
            text: fileContent,
          }],
        };
      } catch (error) {
        const typedError = error as Error;
        logger.error(`Failed to read file ${path}:`, typedError);
        throw error;
      }
    },
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
        const typedError = error as Error;
        logger.error(`Failed to read file ${filename}:`, typedError);
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
# nova MCP Server Help

This server exposes nova functionality through the Model Context Protocol.

## Available Resources
- system://info - System information
- config://nova - nova configuration
- file://{path} - Access files by path
- help://usage - This help information

## Available Tools
- File operations: file_read, list_dir, run_terminal_cmd
- GitLab: gitlab_search, gitlab_create_issue
- Jira: jira_search, jira_create_issue
- Confluence: confluence_search, confluence_create_page
- Datadog: datadog_search
- DORA: dora_metrics

## Available Prompts
- hello_world: A simple welcome message
- help: Display server help information
- git_commit: Generate a Git commit message for changes
- explain_code: Explain code in detail
- jira_ticket: Create a Jira ticket from description
- code_review: Review code changes
`;

      return {
        contents: [{
          uri: uri.href,
          text: helpText,
        }],
      };
    },
  );

  // Add a greeting resource as a simple demonstration
  server.resource(
    'greeting',
    new ResourceTemplate('greeting://{name}', { list: undefined }),
    (uri, { name }) => {
      return {
        contents: [{
          uri: uri.href,
          text: `Hello, ${name || 'User'}! Welcome to the nova MCP server.`,
        }],
      };
    },
  );

  // Log all registered resources
  logger.info('MCP Resources registered:');
  logger.info('  - system://info');
  logger.info('  - config://nova');
  logger.info('  - file://{path*}');
  logger.info('  - file:///{path*}');
  logger.info('  - file://{filename}');
  logger.info('  - help://usage');
  logger.info('  - greeting://{name}');
}

// Create an implementation that properly registers all available prompts
function setupMcpPrompts(server: McpServer, isStdio: boolean = false): void {
  try {
    const logger = isStdio
      ? {
        info: () => {},
        debug: () => {},
        error: () => {},
      }
      : new Logger('MCP Prompts');

    // Set the prompts capability directly in the server
    // deno-lint-ignore no-explicit-any
    const serverWithCapabilities = server as any;

    // Ensure capabilities object exists
    if (!serverWithCapabilities.capabilities) {
      serverWithCapabilities.capabilities = {};
    }

    // Initialize prompts capability if not exists
    if (!serverWithCapabilities.capabilities.prompts) {
      serverWithCapabilities.capabilities.prompts = {};
    }

    // Add each prompt to the capabilities directly
    for (const [id, promptDef] of Object.entries(prompts)) {
      try {
        // Convert the prompt definition to the MCP format
        serverWithCapabilities.capabilities.prompts[id] = {
          name: promptDef.name,
          description: promptDef.description,
        };

        // Add message handler for this prompt
        if ('messages' in promptDef && Array.isArray(promptDef.messages)) {
          // For static prompts, just register the messages directly
          serverWithCapabilities.capabilities.prompts[id].messages = promptDef.messages;
        }

        logger.info(`Registered prompt: ${id}`);
      } catch (err) {
        // Handle registration errors
        const error = err as Error;
        logger.error(`Failed to register prompt ${id}: ${error.message}`);
      }
    }

    // Add a tool to handle prompt execution requests
    // deno-lint-ignore no-explicit-any
    (server as any).tool(
      'mcp_execute_prompt',
      'Execute a predefined MCP prompt',
      {
        promptId: z.string().describe('ID of the prompt to execute'),
        args: z.record(z.unknown()).optional().describe('Arguments for the prompt'),
      },
      ({ promptId, args = {} }: { promptId: string; args?: Record<string, unknown> }) => {
        try {
          // Find the prompt definition
          const promptDef = prompts[promptId];
          if (!promptDef) {
            return {
              content: [{ type: 'text', text: `Prompt "${promptId}" not found` }],
              isError: true,
            };
          }

          // Generate messages based on prompt type
          let messages;
          if ('messages' in promptDef) {
            messages = promptDef.messages;
          } else if ('getMessages' in promptDef) {
            messages = promptDef.getMessages(args as Record<string, string>);
          } else {
            return {
              content: [{ type: 'text', text: `Invalid prompt definition for "${promptId}"` }],
              isError: true,
            };
          }

          // Return the messages
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(
                {
                  promptId,
                  messages,
                },
                null,
                2,
              ),
            }],
          };
        } catch (err) {
          const error = err as Error;
          return {
            content: [{ type: 'text', text: `Error executing prompt: ${error.message}` }],
            isError: true,
          };
        }
      },
    );

    if (!isStdio) {
      logger.info(`MCP prompts registered: ${Object.keys(prompts).length} available`);
    }
  } catch (err) {
    const error = err as Error;
    if (!isStdio) {
      console.error(`Failed to register prompts capability: ${error.message}`);
    }
  }
}

// Register prompts with the server for all transports
function registerPrompts(server: McpServer) {
  for (const [id, promptDef] of Object.entries(prompts)) {
    const shape = promptDef.argsSchema.shape;
    if (Object.keys(shape).length === 0) {
      // @ts-expect-error SDK type mismatch, runtime is correct
      server.prompt(
        id,
        promptDef.description,
        (_extra: unknown) => {
          if ('messages' in promptDef) {
            return { messages: promptDef.messages } as MCPPromptResponse;
          } else if ('getMessages' in promptDef) {
            return { messages: promptDef.getMessages({}) } as MCPPromptResponse;
          } else {
            return { messages: [] } as MCPPromptResponse;
          }
        },
      );
    } else {
      server.prompt(
        id,
        // @ts-expect-error SDK type mismatch, runtime is correct
        shape as unknown,
        // @ts-lint-ignore no-explicit-any
        (args: unknown) => {
          if ('messages' in promptDef) {
            return { messages: promptDef.messages } as MCPPromptResponse;
          } else if ('getMessages' in promptDef) {
            return {
              messages: promptDef.getMessages(args as Record<string, string>),
            } as MCPPromptResponse;
          } else {
            return { messages: [] } as MCPPromptResponse;
          }
        },
      );
    }
  }
}

type PromptArgsRawShape = Record<
  string,
  ZodType<string, ZodTypeDef, string> | ZodOptional<ZodType<string, ZodTypeDef, string>>
>;
