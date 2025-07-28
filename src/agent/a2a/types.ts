// Types for nova A2A agent

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: string | number;
}

export interface CommandExecuteParams {
  command: string;
  options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  };
}

export interface CommandResult {
  id: string;
  status: 'completed' | 'pending' | 'canceled' | 'error';
  output: {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}

export interface WebSocketAgentOptions {
  agentId: string;
  token: string;
  wsUrl: string;
  capabilities: unknown;
  onCommandExecute: (command: CommandExecuteParams) => Promise<CommandResult>;
  onCommandCancel?: (commandId: string) => Promise<void>;
  logger?: (msg: string, ...args: unknown[]) => void;
}
