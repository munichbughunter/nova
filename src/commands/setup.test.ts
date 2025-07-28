// deno-lint-ignore-file no-explicit-any

import { Confirm, Input, Secret, Select } from '@cliffy/prompt';
import { assertMatch } from '@std/assert';
import { stub } from '@std/testing/mock';
import { Config, configManager } from '../config/mod.ts';
import { StatusService } from '../services/status_service.ts';
import { setupCommand } from './setup.ts';

// Mock data
const _mockConfig: Config = {
  gitlab: {
    url: 'https://gitlab.com',
    token: 'test-token',
  },
  atlassian: {
    jira_url: 'https://test.atlassian.net',
    jira_token: 'test-token',
    username: 'test-user',
    confluence_url: 'https://test.atlassian.net/wiki',
    confluence_token: 'test-token',
  },
  ai: {
    default_provider: 'openai',
    openai: {
      api_key: 'test-key',
      api_url: 'https://api.openai.com',
      api_version: '2024-02-15',
      default_model: 'gpt-4',
    },
  },
};

// Mock for Deno.Command to avoid actual command execution
function mockDenoCommand() {
  const originalCommand = Deno.Command;

  // Create a mock Command with output method
  const mockCmd = function (_cmd: string, _options?: Deno.CommandOptions) {
    return {
      output: () =>
        Promise.resolve({
          stdout: new TextEncoder().encode('success'),
          stderr: new TextEncoder().encode(''),
          success: true,
          code: 0,
        }),
      outputSync: () => ({
        stdout: new TextEncoder().encode('success'),
        stderr: new TextEncoder().encode(''),
        success: true,
        code: 0,
      }),
      spawn: () => ({
        pid: 1234,
        status: Promise.resolve({ success: true, code: 0 }),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
        stdin: new WritableStream(),
        kill: () => {},
      }),
    };
  };

  // Replace Deno.Command with our mock
  (Deno as any).Command = mockCmd;

  // Return a cleanup function
  return () => {
    (Deno as any).Command = originalCommand;
  };
}

// Helper to capture console output
async function captureConsoleOutput(fn: () => void | Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return logs;
}

// Test setup and cleanup
async function setupTest() {
  // Mock HOME environment variable
  const originalHome = Deno.env.get('HOME');
  await Deno.env.set('HOME', '/tmp/test-home');

  // Create test config directory
  try {
    await Deno.mkdir('/tmp/test-home/.nova', { recursive: true });
  } catch {
    // Directory might already exist
  }

  // Mock Deno.exit to prevent actual process exit
  const originalExit = Deno.exit;
  Deno.exit = ((code?: number) => {
    throw new Error(`Test attempted to exit with code: ${code}`);
  }) as typeof Deno.exit;

  // Add timer to prevent hanging tests
  const timeoutId = setTimeout(() => {
    console.error('Test timeout reached - force exiting');
    Deno.exit(1);
  }, 60000); // 60 second timeout

  return {
    cleanup: async () => {
      // Clear the timeout
      clearTimeout(timeoutId);

      // Restore original HOME
      if (originalHome) {
        await Deno.env.set('HOME', originalHome);
      } else {
        await Deno.env.delete('HOME');
      }

      // Clean up test directory
      try {
        await Deno.remove('/tmp/test-home/.nova', { recursive: true });
      } catch {
        // Directory might not exist
      }

      // Restore original exit
      Deno.exit = originalExit;
    },
  };
}

// Add a stub for the fetch function to handle Ollama health check
function mockFetch() {
  const originalFetch = globalThis.fetch;

  // Replace fetch with a mock that returns different responses based on URL
  globalThis.fetch = ((url: string | URL | Request, _options?: RequestInit) => {
    const urlString = url.toString();

    // If it's an Ollama health check
    if (urlString.includes('ollama') || urlString.includes('localhost:11434')) {
      return Promise.resolve(
        new Response(JSON.stringify({ version: '0.0.0' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    // Default response for any other URL
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
  }) as typeof fetch;

  // Return cleanup function
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// Create a type for the Select.prompt options
type SelectPromptOptions = {
  message?: string;
  options?: Array<unknown>;
  default?: string | number;
};

Deno.test('Setup Command Tests', async (t) => {
  const { cleanup } = await setupTest();

  try {
    await t.step('should show first-time setup message when no configuration exists', async () => {
      const loadConfigStub = stub(
        configManager,
        'loadConfig',
        () => Promise.reject(new Error('No config found')),
      );
      const statusServiceStub = stub(
        StatusService.prototype,
        'getAllStatuses',
        () => Promise.resolve([]),
      );
      const displayStatusTableStub = stub(
        StatusService.prototype,
        'displayStatusTable',
        () => undefined,
      );
      const confirmStub = stub(Confirm, 'prompt', () => Promise.resolve(false));
      const inputStub = stub(Input, 'prompt', () => Promise.resolve('test-value'));
      const secretStub = stub(Secret, 'prompt', () => Promise.resolve('test-pass'));
      const selectStub = stub(Select, 'prompt', (options: any) => {
        if (options?.message?.includes('authentication method')) {
          return Promise.resolve('direct');
        }
        return Promise.resolve('password');
      });

      // Mock Deno.Command
      const cleanupCommandMock = mockDenoCommand();

      // Mock fetch
      const cleanupFetchMock = mockFetch();

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await setupCommand.parse(['--skip-tests']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Test attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /No existing configuration found/);
        assertMatch(output, /Starting first-time setup/);
      } finally {
        loadConfigStub.restore();
        statusServiceStub.restore();
        displayStatusTableStub.restore();
        confirmStub.restore();
        inputStub.restore();
        secretStub.restore();
        selectStub.restore();
        cleanupCommandMock(); // Restore original Deno.Command
        cleanupFetchMock(); // Restore original fetch
      }
    });

    await t.step('should show setup completion message', async () => {
      const mockConfig = {
        gitlab: { url: 'https://gitlab.com', token: 'test-token' },
      };

      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const statusServiceStub = stub(
        StatusService.prototype,
        'getAllStatuses',
        () => Promise.resolve([]),
      );
      const displayStatusTableStub = stub(
        StatusService.prototype,
        'displayStatusTable',
        () => undefined,
      );
      const confirmStub = stub(Confirm, 'prompt', () => Promise.resolve(false));
      const inputStub = stub(Input, 'prompt', () => Promise.resolve('test-value'));
      const secretStub = stub(Secret, 'prompt', () => Promise.resolve('test-pass'));
      const selectStub = stub(Select, 'prompt', (options: any) => {
        if (options?.message?.includes('authentication method')) {
          return Promise.resolve('direct');
        }
        return Promise.resolve('password');
      });

      // Mock Deno.Command
      const cleanupCommandMock = mockDenoCommand();

      // Mock fetch
      const cleanupFetchMock = mockFetch();

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await setupCommand.parse(['--skip-tests']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Test attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Setup completed successfully/);
        assertMatch(output, /Primary Commands/);
      } finally {
        loadConfigStub.restore();
        statusServiceStub.restore();
        displayStatusTableStub.restore();
        confirmStub.restore();
        inputStub.restore();
        secretStub.restore();
        selectStub.restore();
        cleanupCommandMock(); // Restore original Deno.Command
        cleanupFetchMock(); // Restore original fetch
      }
    });

    await t.step('should show GitLab setup messages', async () => {
      const loadConfigStub = stub(
        configManager,
        'loadConfig',
        () => Promise.reject(new Error('No config found')),
      );
      const saveConfigStub = stub(configManager, 'saveConfig', () => Promise.resolve());
      const statusServiceStub = stub(
        StatusService.prototype,
        'getAllStatuses',
        () => Promise.resolve([]),
      );
      const displayStatusTableStub = stub(
        StatusService.prototype,
        'displayStatusTable',
        () => undefined,
      );
      const confirmStub = stub(Confirm, 'prompt', () => Promise.resolve(true));
      const inputStub = stub(Input, 'prompt', () => Promise.resolve('test-value'));
      const secretStub = stub(Secret, 'prompt', () => Promise.resolve('test-pass'));
      const selectStub = stub(Select, 'prompt', (options: any) => {
        if (options?.message?.includes('authentication method')) {
          return Promise.resolve('direct');
        }
        return Promise.resolve('password');
      });

      // Mock Deno.Command
      const cleanupCommandMock = mockDenoCommand();

      // Mock fetch
      const cleanupFetchMock = mockFetch();

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await setupCommand.parse(['--skip-tests']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Test attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Setting up GitLab integration/);
        assertMatch(output, /Setup completed successfully/);
      } finally {
        loadConfigStub.restore();
        saveConfigStub.restore();
        statusServiceStub.restore();
        displayStatusTableStub.restore();
        confirmStub.restore();
        inputStub.restore();
        secretStub.restore();
        selectStub.restore();
        cleanupCommandMock(); // Restore original Deno.Command
        cleanupFetchMock(); // Restore original fetch
      }
    });

    await t.step('should handle configuration save error', async () => {
      const loadConfigStub = stub(
        configManager,
        'loadConfig',
        () => Promise.reject(new Error('No config found')),
      );
      const saveConfigStub = stub(
        configManager,
        'saveConfig',
        () => Promise.reject(new Error('Failed to save')),
      );
      const statusServiceStub = stub(
        StatusService.prototype,
        'getAllStatuses',
        () => Promise.resolve([]),
      );
      const displayStatusTableStub = stub(
        StatusService.prototype,
        'displayStatusTable',
        () => undefined,
      );
      const confirmStub = stub(Confirm, 'prompt', () => Promise.resolve(false));
      const inputStub = stub(Input, 'prompt', () => Promise.resolve('test-value'));
      const secretStub = stub(Secret, 'prompt', () => Promise.resolve('test-pass'));
      const selectStub = stub(Select, 'prompt', (options: any) => {
        if (options?.message?.includes('authentication method')) {
          return Promise.resolve('direct');
        }
        return Promise.resolve('password');
      });

      // Mock Deno.Command
      const cleanupCommandMock = mockDenoCommand();

      // Mock fetch
      const cleanupFetchMock = mockFetch();

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await setupCommand.parse(['--skip-tests']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Test attempted to exit')) {
              assertMatch(error.message, /Failed to save/);
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Error saving config/);
      } finally {
        loadConfigStub.restore();
        saveConfigStub.restore();
        statusServiceStub.restore();
        displayStatusTableStub.restore();
        confirmStub.restore();
        inputStub.restore();
        secretStub.restore();
        selectStub.restore();
        cleanupCommandMock(); // Restore original Deno.Command
        cleanupFetchMock(); // Restore original fetch
      }
    });
  } finally {
    await cleanup();
  }
});
