// MCP client test script
// Run with: deno run --allow-run --allow-read examples/mcp-client-test.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testMcpServer() {
  console.log('Connecting to nova MCP server...');

  // Create stdio transport that launches nova mcp-server as a subprocess
  const transport = new StdioClientTransport({
    command: 'nova',
    args: ['mcp', 'server'],
  });

  // Create MCP client
  const client = new Client(
    {
      name: 'mcp-test-client',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  try {
    // Connect to the server
    console.log('Establishing connection...');
    await client.connect(transport);
    console.log('Connected!');

    // Test resources first
    console.log('\n--- Testing Resources ---');

    // List available resources
    console.log('\nListing available resources:');
    const resources = await client.listResources();
    console.log(`Found ${resources.resources.length} resources:`);
    for (const resource of resources.resources) {
      console.log(`- ${resource.name}: ${resource.uri_template}`);
    }

    // Read help resource
    console.log('\nReading help resource:');
    const helpResource = await client.readResource({ uri: 'help://usage' });
    if (helpResource.contents && helpResource.contents.length > 0) {
      console.log(
        'Help resource content:',
        (helpResource.contents[0] as { text: string }).text.substring(0, 100) + '...',
      );
    }

    // Read system info resource
    console.log('\nReading system info resource:');
    const systemInfo = await client.readResource({ uri: 'system://info' });
    if (systemInfo.contents && systemInfo.contents.length > 0) {
      console.log('System info:', (systemInfo.contents[0] as { text: string }).text);
    }

    // Test tools
    console.log('\n--- Testing Tools ---');

    // Get available tools
    console.log('\nListing available tools:');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    for (const tool of tools.tools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }

    // Test list_dir tool
    console.log('\nTesting list_dir tool:');
    const listResult = await client.callTool({
      name: 'list_dir',
      arguments: {
        relative_workspace_path: '.',
      },
    });
    console.log('Directory contents:', listResult);

    // Test another tool based on what's available
    if (tools.tools.some((t) => t.name === 'file_read')) {
      console.log('\nTesting file_read tool:');
      const readResult = await client.callTool({
        name: 'file_read',
        arguments: {
          file: 'README.md',
          start_line: 0,
          end_line: 5,
        },
      });
      console.log('File content:', readResult);
    }

    // Compare resource-based file access vs tool-based file access
    console.log('\n--- Comparing Resource vs Tool File Access ---');
    try {
      console.log('\nAccessing file via resource:');
      const fileResource = await client.readResource({ uri: 'file://README.md' });
      if (fileResource.contents && fileResource.contents.length > 0) {
        console.log(
          'File content via resource (first 100 chars):',
          (fileResource.contents[0] as { text: string }).text.substring(0, 100) + '...',
        );
      }
    } catch (error: any) {
      console.error('Error accessing file via resource:', error.message);
    }
  } catch (error) {
    console.error('Error testing MCP server:', error);
  } finally {
    // Close the connection
    await transport.close();
    console.log('\nTest complete!');
  }
}

// Run the test
testMcpServer();
