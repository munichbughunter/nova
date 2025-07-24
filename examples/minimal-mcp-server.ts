#!/usr/bin/env deno run --allow-net --allow-read --allow-write --allow-run --allow-env

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create a simple MCP server
const server = new McpServer({
  name: "Minimal MCP Server",
  version: "1.0.0"
});

// Add a simple echo tool
server.tool(
  "echo",
  "Echo back the input",
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: "text", text: message }]
  })
);

// Add a simple greeting resource
server.resource(
  "greeting",
  new ResourceTemplate("greeting://{name}", { list: undefined }),
  async (uri, { name }) => ({
    contents: [{
      uri: uri.href,
      text: `Hello, ${name}!`
    }]
  })
);

// Connect to stdio
const transport = new StdioServerTransport();
await server.connect(transport); 