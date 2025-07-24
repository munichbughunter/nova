// Agent capability definition for Nova A2A agent

export const agentCapabilities = {
  name: 'Nova CLI Agent',
  version: '2.0.0',
  description: 'CLI agent for executing commands',
  capabilities: [
    {
      name: 'shell',
      version: '1.0.0',
      description: 'Execute shell commands',
    },
    {
      name: 'file',
      version: '1.0.0',
      description: 'File operations',
    },
  ],
  supportedCommands: [
    {
      name: 'exec',
      description: 'Execute a shell command',
      syntax: 'exec <command>',
    },
    {
      name: 'cat',
      description: 'Read file contents',
      syntax: 'cat <file>',
    },
  ],
  systemInfo: {
    platform: Deno.build.os,
    architecture: Deno.build.arch,
  },
}; 