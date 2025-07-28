// Command execution logic for Nova A2A agent

export interface CommandExecutionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export async function executeShellCommand(
  options: CommandExecutionOptions,
): Promise<CommandExecutionResult> {
  const { command, args = [], cwd, timeoutMs = 60000, env } = options;
  try {
    const cmd = new Deno.Command(command, {
      args,
      cwd,
      env,
      stdout: 'piped',
      stderr: 'piped',
    });
    const child = cmd.spawn();
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch (error) {
        // Ignore errors when killing the process
        console.debug('Failed to kill process:', error);
      }
    }, timeoutMs);
    const { code, stdout, stderr } = await child.output();
    clearTimeout(timeout);
    return {
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      exitCode: code,
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
