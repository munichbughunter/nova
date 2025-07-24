# First Steps with Copilot MCP

This guide will walk you through the process of setting up and using Copilot MCP integration in your development environment.

## Prerequisites

Before you begin, make sure you have:

- [GitHub Copilot](https://github.com/features/copilot) subscription
- [Nova CLI](../getting-started/installation.md) installed
- [Configured Nova](../getting-started/configuration.md) with your services (Jira, GitLab, etc.)
- A project repository where you want to use Copilot MCP

## Step 1: Set Up MCP in Your Project

First, navigate to your project directory and set up MCP:

```bash
cd /path/to/your/project
nova mcp setup
```

This command will:
- Create the necessary MCP configuration files in your project
- Set up `.vscode/mcp.json` and `.cursor/mcp.json` for editor integration
- Update `.github/copilot-instructions.md` if it exists

You should see a success message when the setup is complete.

## Step 2: Verify Your Configuration

Check that the configuration files were created correctly:

```bash
ls -la .vscode/mcp.json
ls -la .cursor/mcp.json
```

The configuration files should contain the MCP server settings. If you want to review or modify them, you can open them in your editor.

## Step 3: Start the MCP Server

Start the Nova MCP server from your project directory:

```bash
nova mcp server
```

You should see output similar to:

```
[INFO] MCP Server: Starting MCP server...
[INFO] MCP Server: Loading configuration...
[INFO] MCP Server: Initializing services...
[INFO] MCP Server: GitLab service initialized
[INFO] MCP Server: Jira service initialized
[INFO] MCP Server: Confluence service initialized
[INFO] MCP Server: Registering MCP resources...
[INFO] MCP Server: Registering MCP tools...
[INFO] MCP Server: Tools and resources registered, starting server...
[INFO] MCP Server: Created StdioServerTransport
[INFO] MCP Server: Connecting MCP server to stdio transport...
[INFO] MCP Server: Stdio transport connected
[INFO] MCP Server: SSE server listening on port 3020

🤖 MCP Server initialized with:
Provider: OPENAI
Model: gpt-4-turbo
MCP Tools: Enabled

MCP server started and running. Press Ctrl+C to exit.
```

The server should remain running while you're using Copilot with MCP integrations.

## Step 4: Use Copilot with MCP Tools

Once the MCP server is running, you can start using Copilot with MCP tools in your preferred editor:

### In VS Code or Cursor:

1. Open your project in VS Code or Cursor
2. Start interacting with GitHub Copilot
3. Ask Copilot to perform tasks that require MCP tools

For example, you can ask Copilot:
- "List my assigned Jira tickets"
- "Create a GitLab issue for the bug I'm fixing"
- "Search our Confluence for documentation about the authentication API"
- "Create a task file to track my progress on this feature"

Copilot will use the MCP server to execute these tasks and provide results.

## Example Interactions

Here are some examples of how to interact with Copilot using MCP tools:

### Jira Integration

```
User: Fetch information about the JIRA-123 ticket

Copilot: I'll fetch that information for you.

[Copilot uses f1e_jira_search to retrieve the ticket]

Here's the information about JIRA-123:
Title: Implement an awesome feature
Status: In Progress
Assignee: John Doe
Description: Create an awesome feature...
```

### GitLab Integration

```
User: Create a new GitLab issue for a bug in the authentication service

Copilot: I'll help you create a GitLab issue. What should be the title and description?

User: Title: "Something is wrong" Description: "Here is my wrong description"

[Copilot uses f1e_gitlab_create_issue to create the issue]

Copilot: I've created the GitLab issue #45 titled "Something is wrong". You can view it at https://gitlab.com/yourproject/issues/45
```

### Task Management

```
User: Create a task file to track my progress on implementing the new search feature

[Copilot uses f1e_init_task and f1e_write_task_file to create a task]

Copilot: I've created a task file at tasks/search-feature/plan.md with an initial outline for implementing the search feature. You can update it as you make progress.
```

## Troubleshooting

If you encounter issues with Copilot MCP integration, see the [Troubleshooting](troubleshooting.md) guide for common issues and solutions.

## Next Steps

Now that you've set up Copilot MCP, check out the [Usage](usage.md) guide for more detailed information on what you can do with this integration. 