// AI Agent Integration Example
// Shows how to integrate nova MCP server with an AI model
// Run with: deno run --allow-run --allow-net examples/ai-agent-integration.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Replace these with your actual API keys
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || 'your-openai-api-key';

// Simple prompt to demonstrate tool use
const USER_PROMPT = 'Show me the files in the current directory and tell me what they are for.';

async function runAiAgentWithMcp() {
  console.log('Starting AI agent with MCP integration...');

  // Create stdio transport for MCP
  const transport = new StdioClientTransport({
    command: 'nova',
    args: ['mcp', 'server'],
  });

  // Create MCP client
  const client = new Client(
    {
      name: 'ai-agent-integration',
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
    // Connect to the MCP server
    console.log('Connecting to nova MCP server...');
    await client.connect(transport);
    console.log('Connected!');

    // Get available tools
    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || { type: 'object', properties: {} },
      },
    }));

    console.log(`Loaded ${tools.length} tools from MCP server`);

    // Call OpenAI API with the tools
    console.log('\nCalling AI model with tools...');
    console.log(`User prompt: "${USER_PROMPT}"`);

    // This would normally call the OpenAI API
    // We're mocking it here for demonstration purposes
    console.log('\nAI would process this request using these tools:');

    // Simulate the AI deciding to use the list_dir tool
    console.log('AI is using list_dir tool...');
    const listDirResult = await client.callTool({
      name: 'list_dir',
      arguments: {
        relative_workspace_path: '.',
      },
    });

    // The AI would receive this result and generate a response
    console.log('\nTool result:', listDirResult);

    // Define a type for the tool result content
    interface ToolResultContent {
      content?: Array<{ type: string; text: string }>;
    }

    // Generate mock AI response
    let aiResponse = "Based on the directory listing, here's what I found:\n\n";
    const typedResult = listDirResult as ToolResultContent;
    if (typedResult.content?.[0]?.text) {
      const dirContents = JSON.parse(typedResult.content[0].text);
      aiResponse += 'Files in the current directory:\n';

      for (const item of dirContents) {
        aiResponse += `- ${item}\n`;
      }

      aiResponse +=
        '\nThese files appear to be part of a Deno project, with the main entry point in main.ts. ';
      aiResponse +=
        'There are several directories like src/ which contain the source code, and examples/ which contain example code.';
    } else {
      aiResponse += "I couldn't get the directory listing.";
    }

    console.log('\nAI Response:');
    console.log(aiResponse);
  } catch (error) {
    console.error('Error during AI+MCP integration:', error);
  } finally {
    // Close the connection
    await transport.close();
    console.log('\nExample complete!');
  }
}

// Run the example
runAiAgentWithMcp();
