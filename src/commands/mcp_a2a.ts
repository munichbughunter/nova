import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Input } from '@cliffy/prompt';
import { agentCapabilities } from '../agent/a2a/capabilities.ts';
import { executeShellCommand } from '../agent/a2a/executor.ts';
import { CommandExecuteParams, CommandResult as A2ACommandResult } from '../agent/a2a/types.ts';
import { connectAgentWebSocket } from '../agent/a2a/websocket.ts';
import { configManager } from '../config/mod.ts';
import type { AgentConfig } from '../config/types.ts';
import { ToolService } from '../services/tool_service.ts';
import { NOVA_VERSION } from '../version.ts';

export const API_BASE_URL = 'https://tbd.lambda-url.eu-west-1/'; // TODO: change to the actual URL
const MCP_SERVER_URL = 'http://localhost:3020/mcp';
const POLL_INTERVAL_MS = 7000;
const DEFAULT_WS_URL = 'wss://tobedone/$default'; // TODO: change to the actual URL

interface CommandData {
    id: string;
    command: {
        type?: string;
    };
    args?: string[];
    timeoutMs?: number;
    cwd?: string;
    env?: Record<string, string>;
}

interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

function log(msg: string, verbose = false, options?: { verbose: boolean }) {
    if (!options || options.verbose === undefined) {
        console.log(msg);
        return;
    }
    if (!options.verbose && verbose) return;
    console.log(msg);
}

// Call the MCP server via HTTP
async function _callMcp(method: string, params: Record<string, unknown>) {
    const res = await fetch(MCP_SERVER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Math.random().toString(36).slice(2),
            method,
            params,
        }),
    });
    if (!res.ok) throw new Error(`MCP call failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(`MCP error: ${data.error.message}`);
    return data.result;
}

async function _authenticateAgent(
    token: string,
    apiUrl: string,
    verbose: boolean,
): Promise<string> {
    log(colors.blue(`Authenticating with token: ${token}`), false, { verbose });
    const res = await fetch(`${apiUrl}/v1/agents/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Authentication failed: ${res.status} ${errorText}`);
    }
    const data = await res.json();
    if (!data.authenticated || !data.id) {
        throw new Error('Authentication failed: Invalid response from server');
    }
    log(colors.green(`✓ Agent authenticated successfully with ID: ${data.id}`), false, { verbose });
    return data.id;
}

async function _pollForCommands(agentId: string, apiUrl: string, verbose: boolean) {
    log(colors.blue('Polling for commands...'), false, { verbose });
    let backoff = POLL_INTERVAL_MS;
    while (true) {
        try {
            const res = await fetch(`${apiUrl}/v1/agents/commands/${agentId}`);
            if (!res.ok) {
                throw new Error(`Polling failed: ${res.status}`);
            }
            const commands = await res.json();
            if (Array.isArray(commands) && commands.length > 0) {
                for (const cmd of commands) {
                    await handleCommand(cmd as CommandData, agentId, apiUrl, !!verbose);
                }
            }
            backoff = POLL_INTERVAL_MS; // Reset backoff on success
        } catch (err) {
            log(colors.red(`Polling error: ${err}`), true, { verbose });
            backoff = Math.min(backoff * 2, 60000); // Exponential backoff, max 60s
        }
        await new Promise((r) => setTimeout(r, backoff));
    }
}

function _getSystemInfo() {
    return {
        version: NOVA_VERSION,
        platform: Deno.build.os,
        arch: Deno.build.arch,
        nodeVersion: Deno.version.deno,
        hostname: (typeof Deno.hostname === 'function' ? Deno.hostname() : 'unknown'),
        cpus: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency)
            ? navigator.hardwareConcurrency
            : 1,
        memory: {
            total:
                (typeof Deno.systemMemoryInfo === 'function' ? Deno.systemMemoryInfo().total : 0),
            free: (typeof Deno.systemMemoryInfo === 'function' ? Deno.systemMemoryInfo().free : 0),
        },
        uptime: 0,
        network: {}, // Not available in Deno
        success: true,
    };
}

function getAgentCard(agentId: string) {
    return {
        name: 'nova CLI Agent',
        description: 'A local nova agent for automation and chat.',
        url: `http://localhost:3000/agent/${agentId}`,
        provider: {
            organization: 'nova',
            url: 'https://nova.ai',
        },
        version: NOVA_VERSION,
        documentationUrl: 'https://nova.ai/docs/cli',
        capabilities: {
            streaming: true,
            pushNotifications: false,
            stateTransitionHistory: true,
        },
        authentication: {
            schemes: ['token'],
            credentials: null,
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [
            {
                id: 'shell',
                name: 'Shell Command Execution',
                description: 'Run shell commands on the host machine.',
                tags: ['shell', 'automation'],
                examples: ['ls -la', 'git status'],
            },
            {
                id: 'chat',
                name: 'Chat',
                description: 'Interact with the agent via chat.',
                tags: ['chat', 'conversation'],
            },
        ],
    };
}

async function handleCommand(cmd: CommandData, agentId: string, apiUrl: string, verbose: boolean) {
    log(colors.yellow(`Received command: ${JSON.stringify(cmd, null, 2)}`), false, { verbose });
    let execResult: CommandResult;
    if (cmd.command && cmd.command.type === 'getInfo') {
        console.log('getInfo');
        try {
            const agentCard = getAgentCard(agentId);
            console.log('AgentCard being sent:', agentCard);
            execResult = {
                exitCode: 0,
                stdout: JSON.stringify(agentCard, null, 2),
                stderr: '',
            };
        } catch (err) {
            execResult = {
                exitCode: 1,
                stdout: '',
                stderr: err instanceof Error ? err.message : String(err),
            };
        }
    } else {
        execResult = await executeShellCommand({
            command: cmd.command as unknown as string,
            args: cmd.args,
            timeoutMs: cmd.timeoutMs ?? 60000,
            cwd: cmd.cwd,
            env: cmd.env,
        });
    }
    await postCommandResult(cmd, execResult, agentId, apiUrl, !!verbose);
}

async function postCommandResult(
    cmd: CommandData,
    result: CommandResult,
    agentId: string,
    apiUrl: string,
    verbose: boolean,
) {
    const payload = {
        commandId: cmd.id,
        agentId,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
    };
    console.log('Posting result:', payload);
    const res = await fetch(`${apiUrl}/v1/agents/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (res.ok) {
        log(colors.green(`✓ Result sent for command ${cmd.id}`), false, { verbose });
    } else {
        const errorText = await res.text();
        console.error('Failed to send result:', res.status, errorText);
        log(
            colors.red(`Failed to send result for command ${cmd.id}: ${res.status} ${errorText}`),
            true,
            { verbose },
        );
    }
}

export const mcpWebCommand = new Command()
    .description(
        'Connect this CLI as an A2A to the Commander API. Requires a pairing code (token) from the web UI.',
    )
    .option('--agent-id <agentId:string>', 'Agent ID from the /pair endpoint')
    .option('--token <token:string>', 'Pairing code (token) from the web UI')
    .option('--verbose', 'Enable verbose logging')
    .option('--ws-url <url:string>', 'WebSocket URL (if not using default)')
    .action(async (options) => {
        const { agentId: cliAgentId, token: cliToken, verbose, wsUrl: cliWsUrl } = options;
        // Load config and agent section
        const config = await configManager.loadConfig();
        let agent: AgentConfig = config.agent ?? {};
        let agentId = cliAgentId || agent.id;
        let token = cliToken || agent.token;
        const wsUrl = cliWsUrl || agent.wsUrl || DEFAULT_WS_URL;

        // Prompt for agentId if missing
        if (!agentId) {
            agentId = await Input.prompt({
                message: 'Enter your Agent ID (from the web UI):',
            });
        }
        // Prompt for token if missing
        if (!token) {
            token = await Input.prompt({
                message: 'Enter your pairing code (token) from the web UI:',
            });
        }

        if (!agentId || !token) {
            console.error(
                colors.red(
                    'Both agent ID and pairing code (token) are required. Get these from the /pair endpoint in the web UI.',
                ),
            );
            Deno.exit(1);
        }
        // Save agent config for future runs
        agent = { id: agentId, token, wsUrl };
        await configManager.saveConfig({ ...config, agent });
        try {
            if (!wsUrl) {
                throw new Error('No WebSocket URL provided.');
            }
            // Initialize ToolService and pass to WebSocket
            const toolService = ToolService.getInstance(config);
            await connectAgentWebSocket({
                agentId,
                token,
                wsUrl,
                capabilities: agentCapabilities,
                onCommandExecute: async (
                    command: CommandExecuteParams,
                ): Promise<A2ACommandResult> => {
                    const { command: cmdName, options } = command;
                    // Fix options to use args properly according to CommandExecuteParams type
                    const result = await executeShellCommand({
                        command: cmdName,
                        args: [], // CommandExecuteParams doesn't have args property, so default to empty array
                        cwd: options?.cwd,
                        timeoutMs: options?.timeout,
                        env: options?.env,
                    });

                    // Transform to expected CommandResult format
                    return {
                        id: Math.random().toString(36).substring(2, 9),
                        status: result.exitCode === 0 ? 'completed' : 'error',
                        output: {
                            stdout: result.stdout,
                            stderr: result.stderr,
                            exitCode: result.exitCode,
                        },
                    };
                },
                logger: (msg, ..._args) => log(msg, false, { verbose: !!verbose }),
                toolService,
            });
        } catch (err) {
            console.error(
                colors.red(`Agent error: ${err instanceof Error ? err.message : String(err)}`),
            );
            Deno.exit(1);
        }
    });
