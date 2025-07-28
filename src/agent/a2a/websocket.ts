// WebSocket JSON-RPC client for nova A2A agent
import { ToolService } from '../../services/tool_service.ts';
import { Logger } from '../../utils/logger.ts';
import type { JsonRpcRequest, JsonRpcResponse, WebSocketAgentOptions } from './types.ts';

export function connectAgentWebSocket(
  options: WebSocketAgentOptions & { toolService: ToolService },
) {
  const {
    agentId,
    token,
    wsUrl,
    capabilities,
    onCommandExecute,
    logger: _customLogger,
    toolService,
  } = options;
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let authenticated = false;

  // Create a logger instance for WebSocket operations
  const logger = new Logger('WebSocket', Deno.env.get('nova_DEBUG') === 'true');

  function logMessage(direction: 'SEND' | 'RECV', message: unknown) {
    if (logger.isDebugEnabled()) {
      const timestamp = new Date().toISOString();
      logger.debug(`${timestamp} ${direction} >>`);
      logger.debug(JSON.stringify(message, null, 2));
    }
  }

  function sendAgentStatus() {
    const statusMsg: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'agent/status',
      params: {
        status: 'online',
        capabilities,
      },
      id: 'status_1',
    };
    logMessage('SEND', statusMsg);
    ws!.send(JSON.stringify(statusMsg));
  }

  function connect() {
    logger.info('Connecting to Commander...');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      logger.debug('Connection established');
      const authMsg: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'auth',
        params: {
          agentId,
          token,
        },
        id: 'auth_request_1',
      };
      logMessage('SEND', authMsg);
      ws!.send(JSON.stringify(authMsg));
    };

    ws.onmessage = async (event) => {
      try {
        logger.debug('Message received');
        const msg = JSON.parse(event.data);
        logMessage('RECV', msg);

        if (msg.jsonrpc === '2.0') {
          // Handle auth response
          if (msg.id === 'auth_request_1') {
            if (msg.result?.success) {
              authenticated = true;
              logger.success('Successfully connected to Commander');
              sendAgentStatus();
            } else if (msg.error) {
              logger.error(`Authentication failed: ${msg.error.message}`);
              ws?.close();
              Deno.exit(1);
            }
          } // Handle welcome message
          else if (msg.method === 'system/welcome') {
            logger.debug('Server info:', {
              version: msg.params.serverVersion,
              methods: msg.params.availableMethods,
              capabilities: msg.params.capabilities,
            });
          } // Handle ping request
          else if (msg.method === 'ping') {
            logger.debug('Received ping request');
            const pongMsg: JsonRpcRequest = {
              jsonrpc: '2.0',
              method: 'pong',
              params: {
                originalMessage: msg.params?.message,
                originalTimestamp: msg.params?.timestamp,
              },
              id: msg.id,
            };
            logMessage('SEND', pongMsg);
            ws!.send(JSON.stringify(pongMsg));
          } // Handle command/execute
          else if (msg.method === 'command/execute' && msg.params) {
            logger.info(`Executing command: ${msg.params.command}`);
            const reqId = msg.id;
            const params = msg.params;
            const result = await onCommandExecute(params);
            const resultMsg: JsonRpcResponse = {
              jsonrpc: '2.0',
              result: {
                id: params.id || reqId,
                status: 'completed',
                output: result,
              },
              id: reqId,
            };
            logMessage('SEND', resultMsg);
            ws!.send(JSON.stringify(resultMsg));
            logger.success('Command execution completed');
          } // --- MCP METHODS ---
          else if (msg.method === 'mcp/list') {
            logger.info('Received mcp/list request');
            // Get the real list of MCP tools
            const mcpTools = toolService.mcpService.getTools();
            const tools = mcpTools.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            }));
            const response: JsonRpcResponse = {
              jsonrpc: '2.0',
              result: { tools },
              id: msg.id,
            };
            logMessage('SEND', response);
            ws!.send(JSON.stringify(response));
          } else if (msg.method === 'mcp/install') {
            logger.info('Received mcp/install request');
            // For now, just simulate install (could be extended to actually install tools)
            const { toolName } = msg.params || {};
            // Optionally, check if tool exists
            const mcpTools = toolService.mcpService.getTools();
            const found = mcpTools.some((t) => t.function.name === toolName);
            const response: JsonRpcResponse = {
              jsonrpc: '2.0',
              result: {
                success: found,
                tool: toolName,
                message: found ? 'Tool already available.' : 'Tool not found.',
              },
              id: msg.id,
            };
            logMessage('SEND', response);
            ws!.send(JSON.stringify(response));
          } else if (msg.method === 'mcp/execute') {
            logger.info('Received mcp/execute request');
            const { toolName, method: _method, params } = msg.params || {};
            try {
              // Actually execute the tool using ToolService
              const execResult = await toolService.executeMCPTool(toolName, params || {}, {
                mcpService: toolService.mcpService,
              });
              const response: JsonRpcResponse = {
                jsonrpc: '2.0',
                result: execResult,
                id: msg.id,
              };
              logMessage('SEND', response);
              ws!.send(JSON.stringify(response));
            } catch (err) {
              const response: JsonRpcResponse = {
                jsonrpc: '2.0',
                error: { code: -32009, message: err instanceof Error ? err.message : String(err) },
                id: msg.id,
              };
              logMessage('SEND', response);
              ws!.send(JSON.stringify(response));
            }
          } // Handle error responses
          else if (msg.error) {
            logger.error(`Server error: ${msg.error.message}`);
          }
        }
      } catch (err) {
        logger.error(
          `Failed to process message: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    ws.onerror = (err) => {
      logger.error(`Connection error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    };

    ws.onclose = () => {
      if (!authenticated) {
        logger.error('Connection closed before authentication completed');
        Deno.exit(1);
      }
      logger.warn('Connection closed');
      // Reconnect with backoff if needed
      reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
      logger.info(`Attempting to reconnect in ${Math.round(delay / 1000)} seconds...`);
      setTimeout(connect, delay);
    };
  }
  connect();
}
