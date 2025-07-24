# Testing the MCP Server in IDEs

This document provides instructions for testing the MCP server in both Visual Studio Code and
Cursor.

## Prerequisites

1. Deno installed (version 1.37 or later)
2. MCP dependencies installed:
   ```bash
   deno cache --reload npm:@modelcontextprotocol/sdk
   ```

## Testing in Visual Studio Code

We've provided launch configurations and tasks to make testing easy in VS Code:

### Using Launch Configurations

1. Open the Debug view (Ctrl+Shift+D or Cmd+Shift+D)
2. Select one of the following launch configurations:
   - **Run MCP Server**: Starts the MCP server in debug mode
   - **Test MCP Client (Dev)**: Runs the client test that connects to the local server
   - **Test AI Agent Integration**: Tests the AI agent integration (requires OpenAI API key)

3. Click the green play button to run the selected configuration

### Using Tasks

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Type "Tasks: Run Task" and select it
3. Choose one of the following tasks:
   - **Start MCP Server**: Starts the MCP server in a terminal
   - **Run MCP Client Test**: Runs the client test
   - **Run AI Agent Integration**: Tests the AI agent integration
   - **Setup MCP Tests**: Runs the setup script that installs dependencies and runs tests

### Testing Server and Client Together

To test both the server and client:

1. First, run the "Start MCP Server" task or launch configuration
2. Wait for the server to start (you'll see "MCP server started and ready")
3. In a new terminal, run the "Run MCP Client Test" task or launch configuration

## Testing in Cursor

We've configured tasks for Cursor as well in the `.cursor-tasks.json` file:

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Type "Tasks: Run Task" and select it
3. Choose one of the available tasks:
   - **Start MCP Server**: Starts the MCP server
   - **Run MCP Client Test**: Runs the client test
   - **Run AI Agent Integration**: Tests the AI agent integration
   - **Setup MCP Tests**: Runs the setup script

### Testing Workflow

For the optimal testing workflow:

1. Start the MCP server task first
2. Wait for "MCP server started and ready" message
3. In a new terminal, run the client test task

## Manual Testing

You can also run the tests manually in the terminal:

```bash
# Start the MCP server
deno run --allow-net --allow-read --allow-write --allow-env main.ts mcp server

# In another terminal, run the client test
deno run --allow-run --allow-read --allow-env examples/mcp-client-test-dev.ts

# Or run the setup script that does both
./examples/setup-mcp-test.sh
```

## Troubleshooting

- If you see connection errors, make sure the MCP server is running before starting the client
- For TypeScript errors, run `deno cache --reload npm:@modelcontextprotocol/sdk` to update
  dependencies
- Enable debug mode by setting the `nova_DEBUG=true` environment variable before running the server

# Tool Testing Progress

This document tracks the testing progress of all MCP tools using `test_tools.ts` and `mcp-client-test-dev.ts`.

## How to Test

Run a tool using:
```bash
deno run --allow-all examples/mcp-client-test-dev.ts
```

List all available tools:
```bash
deno run --allow-all src/cli/test_tools.ts --list
```

## Testing Progress

### File Operations
- [x] `list_dir` - Lists contents of a directory
  - Tested with: `--param relative_workspace_path=.`
  - Status: ✅ Working
- [x] `file_read` - Read file content
  - Tested with: `--param file="src/cli/README.md"`
  - Status: ✅ Working
- [ ] `file_write` - Write content to a file
  - Status: ⚠️ Parameter parsing issues

### Task Management
- [x] `init_task` - Initialize a new task environment
  - Tested with: `--param taskName=test-task`
  - Status: ✅ Working
- [x] `write_task_file` - Write a file in a task directory
  - Status: ✅ Working
- [x] `read_task_file` - Read a file from a task directory
  - Status: ✅ Working
- [x] `get_task_info` - Get task metadata information
  - Tested with: `--param taskDir=results/task-[id]`
  - Status: ✅ Working

### System Tools
- [x] `terminal` - Execute shell commands
  - Tested with: `--param command="pwd"`
  - Status: ✅ Working
- [x] `javascript_executor` - Generate and execute JavaScript code
  - Tested with: `--param description="Calculate factorial of 5" --param code="function factorial(n) { return n <= 1 ? 1 : n * factorial(n-1); } return factorial(5);"`
  - Status: ✅ Working (when code is provided directly)
  - Note: Code generation with LLM implemented and functional when AI config is available

### Browser Tools
- [ ] `browser` - Access and interact with web pages
  - Status: ⚠️ Requires configuration

### GitLab Integration
- [x] `gitlab_search` - Search through GitLab projects, issues, or merge requests
  - Status: ✅ Working
  - Tested with: `--param query="abx" --param scope="projects"`
- [ ] `gitlab_create_issue` - Create a new GitLab issue
  - Status: ⚠️ Not tested yet

### Jira Integration
- [x] `jira_search` - Search for Jira issues using JQL
  - Status: ✅ Working
  - Tested with: `--param jql='project = "WEB" AND status = "PEER REVIEW"'`
- [ ] `jira_create_issue` - Create a new Jira issue
  - Status: ⚠️ Not tested yet

### Confluence Integration
- [x] `confluence_search` - Search for content in Confluence
  - Status: ✅ Working
  - Tested with: `--param query="project" --param space=""`
- [ ] `confluence_create_page` - Create a new Confluence page
  - Status: ⚠️ Not tested yet

### Monitoring & Alerts
- [x] `datadog_search` - Search for metrics or logs in Datadog
  - Status: ⚠️ Requires configuration
  - Tested with: `--param query="service:nova error:500" --param type="logs" --param timeRange="24h"`
- [ ] `dora_metrics` - Get DORA metrics for a project
  - Status: ⚠️ Requires configuration

## Test Results

### Successful Tests
1. `list_dir` - Successfully listed directory contents with metadata
2. `terminal` - Successfully executed shell commands
3. `javascript_executor` - Successfully executed JavaScript code (with provided code)
4. `file_read` - Successfully read file contents with metadata
5. `init_task` - Successfully initialized task environment
6. `write_task_file` - Successfully wrote files to task directory
7. `read_task_file` - Successfully read files from task directory
8. `get_task_info` - Successfully retrieved task metadata
9. `gitlab_search` - Successfully searched GitLab projects
10. `jira_search` - Successfully searched Jira issues
11. `confluence_search` - Successfully searched Confluence content

### Requires Configuration
1. `datadog_search` - Service available but requires specific configuration
2. `dora_metrics` - Requires configuration for both Jira and GitLab
3. `browser` - Requires additional headless browser configuration

### Not Tested Yet
1. `gitlab_create_issue` - Implementation available but not fully tested
2. `jira_create_issue` - Implementation available but not fully tested
3. `confluence_create_page` - Implementation available but not fully tested

### Failed Tests
1. `file_write` - Parameter parsing issues in the test tool (works in actual MCP client)

## Notes
- We've fixed issues with accessing services directly in the context, rather than through a nested 'services' property
- The Confluence search now has more robust error handling and default behavior
- All modifications are backwards compatible with existing implementations
- The MCP client test now includes testing for Confluence search functionality
- Type-safety improvements were made across the codebase
- Some tools may require specific configuration or credentials to work properly
- Integration tools (GitLab, Jira, etc.) need valid API tokens and service configuration
- Browser tool may require additional setup for headless browser operation
