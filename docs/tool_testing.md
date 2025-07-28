# MCP Tool Testing Guide

This guide explains how to test MCP tools using the provided testing utilities.

## Available Testing Methods

There are three ways to test MCP tools:

1. **CLI Tool**: Run tools directly from the command line
2. **Test Scripts**: Write custom test scripts
3. **ToolTester API**: Use the ToolTester class in your own code

## Using the CLI Tool

The CLI tool provides a simple interface to test tools from the command line:

```bash
# List all available tools
deno run --allow-all src/cli/test_tools.ts --list

# Test the 'list_dir' tool
deno run --allow-all src/cli/test_tools.ts --tool list_dir --param relative_workspace_path=.

# Test the 'terminal' tool
deno run --allow-all src/cli/test_tools.ts --tool terminal --param command="ls -la"

# Test the 'javascript_executor' tool with mock LLM
deno run --allow-all src/cli/test_tools.ts --tool javascript_executor --param description="Calculate the factorial of 5" --mock-llm
```

### CLI Options

- `-h, --help`: Show help message
- `-l, --list`: List all available tools
- `-v, --verbose`: Enable verbose logging
- `-c, --config <file>`: Path to config file (default: ./config.json)
- `-t, --tool <name>`: Tool to test
- `-p, --param <key=value>`: Parameter for tool (can be used multiple times)
- `-m, --mock-llm`: Use mock LLM provider for testing JavaScript executor

## Using the Example Test Script

A sample test script is provided in `examples/test_tools_example.ts`. Run it with:

```bash
deno run --allow-all examples/test_tools_example.ts
```

For JavaScript executor specific tests, run:

```bash
# Test with a mock LLM provider
deno run --allow-all examples/js_executor_example.ts
```

These scripts demonstrate:

- Getting a list of available tools
- Testing individual tools
- Running a sequence of tool tests
- Testing JavaScript code generation and execution

## Using the ToolTester API

The `ToolTester` class provides a programmatic API for testing tools:

```typescript
import { ToolTester } from '../src/utils/test_tools.ts';

// Create a tester
const tester = new ToolTester({
  baseDir: Deno.cwd(),
  debug: true,
});

// Get available tools
const tools = tester.getAvailableTools();

// Test a single tool
const result = await tester.testTool('terminal', {
  command: 'echo "Hello from terminal tool"',
  timeout: 5000,
});

// Test a sequence of tools
const sequenceResults = await tester.testSequence([
  {
    toolName: 'list_dir',
    params: { relative_workspace_path: '.' },
  },
  {
    toolName: 'terminal',
    params: { command: 'ls -la' },
  },
]);
```

## JavaScript Executor Tool

The JavaScript Executor tool allows you to:

1. Generate JavaScript code using an LLM based on a description
2. Execute JavaScript code in a sandboxed environment
3. Use provided code or generate code on the fly

### Using the JavaScript Executor Tool

```typescript
// With LLM code generation
const result = await tester.testTool('javascript_executor', {
  description: 'Calculate the factorial of 5',
});

// With custom code
const result = await tester.testTool('javascript_executor', {
  description: 'Run custom JavaScript',
  code: `
    const numbers = [1, 2, 3, 4, 5];
    return numbers.reduce((a, b) => a + b, 0);
  `,
});

// With context data
const result = await tester.testTool('javascript_executor', {
  description: 'Sort an array of numbers',
  context: {
    inputData: [5, 3, 8, 1, 2],
  },
});
```

### JavaScript Executor Tool Parameters

- `description`: Description of what the code should do (required)
- `code`: JavaScript code to execute (optional, will be generated if not provided)
- `timeout`: Execution timeout in milliseconds (default: 5000)
- `context`: Context data available to the code (optional)

## Adding New Tools

To add a new tool to the MCP service:

1. Add the tool definition to the `initializeTools` method in `src/services/mcp_service.ts`
2. Implement the tool execution logic in a new method (e.g., `executeYourTool`)
3. Add the new tool to the switch statement in the `executeTool` method

## Testing Best Practices

1. **Test individual tools first**: Make sure each tool works independently
2. **Test with minimal parameters**: Start with required parameters only
3. **Test error cases**: Try invalid parameters to ensure proper error handling
4. **Test tool sequences**: Test how tools work together
5. **Test timeouts**: Ensure long-running tools can be terminated properly
