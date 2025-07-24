#!/bin/bash
# Setup and run MCP tests

# Install dependencies
echo "Installing MCP SDK dependencies..."
deno cache --reload npm:@modelcontextprotocol/sdk

# Create directories if they don't exist
mkdir -p examples

# Run the development MCP client test that launches the MCP server directly
echo "Running MCP client test (development version)..."
deno run --allow-run --allow-read --allow-env examples/mcp-client-test-dev.ts

# Note: The standard test (which requires nova with mcp-server command to be installed)
# can be run with:
# deno run --allow-run --allow-read --allow-env examples/mcp-client-test.ts

# Note: to run the AI agent integration test, you'll need to set OPENAI_API_KEY
# echo "Running AI agent integration test..."
# deno run --allow-run --allow-net --allow-env examples/ai-agent-integration.ts 