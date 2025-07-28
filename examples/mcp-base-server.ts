#!/usr/bin/env deno run --allow-net --allow-read --allow-write --allow-run --allow-env

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Create a basic server
const server = new Server(
  {
    name: 'nova-mcp-base',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

// Define our tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'echo',
        description: 'Echo back the input',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to echo',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'list_files',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory path',
            },
          },
          required: ['path'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Handle different tools
  if (name === 'echo') {
    const message = args.message;
    return {
      content: [{ type: 'text', text: message }],
    };
  } else if (name === 'list_files') {
    try {
      const path = args.path || '.';
      const files = [];

      for await (const entry of Deno.readDir(path)) {
        files.push(entry.name);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  // Unknown tool
  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// Define resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        name: 'help',
        uri_template: 'help://info',
      },
      {
        name: 'file',
        uri_template: 'file://{path}',
      },
    ],
  };
});

// Handle resource reads
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = new URL(request.params.uri);

  if (uri.protocol === 'help:') {
    return {
      contents: [{
        uri: uri.href,
        text:
          `# nova MCP Server Help\n\nThis is a help page for the nova MCP Server.\n\nAvailable tools:\n- echo: Echo back a message\n- list_files: List files in a directory`,
      }],
    };
  } else if (uri.protocol === 'file:') {
    try {
      // Extract path from URL
      const path = uri.pathname.replace(/^\/+/, '');
      const content = await Deno.readTextFile(path);

      return {
        contents: [{
          uri: uri.href,
          text: content,
        }],
      };
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  throw new Error(`Unsupported resource URI: ${request.params.uri}`);
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
