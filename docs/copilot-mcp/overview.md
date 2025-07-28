# GitHub Copilot MCP Integration

Nova CLI provides seamless integration between GitHub Copilot and Nova's Model Context Protocol
(MCP) server, enabling AI-powered development workflows with access to your project's resources and
tools.

## What is Copilot MCP?

Copilot MCP is an integration that allows GitHub Copilot to interact with Nova's tools and services
through the Model Context Protocol. This enables Copilot to:

- Access your project files and resources
- Interact with Jira, GitLab, Confluence, and other services
- Execute terminal commands and perform complex workflows
- Create and manage tasks within your development environment

By leveraging this integration, you can have GitHub Copilot help you with various development tasks
while having access to your project's context and connected services.

## Key Benefits

- **Context-Aware AI Assistance**: Copilot gains access to your project resources, enabling more
  relevant and accurate assistance.
- **Service Integration**: Seamlessly interact with Jira tickets, GitLab issues, Confluence pages,
  and more directly through Copilot.
- **Enhanced Productivity**: Perform complex workflows through simple natural language requests to
  Copilot.
- **Standardized Interface**: The MCP protocol provides a consistent way for AI systems to interact
  with tools and services.

## How It Works

1. The Nova MCP server runs locally, exposing resources and tools through the Model Context
   Protocol.
2. GitHub Copilot connects to the MCP server, gaining access to its capabilities.
3. When you ask Copilot to perform a task, it can leverage the MCP tools to access files, call APIs,
   and execute commands.
4. Results from these operations are incorporated into Copilot's responses, providing relevant and
   context-aware assistance.

## Getting Started

To use Copilot MCP integration:

1. Set up your project with Nova MCP:
   ```bash
   nova mcp setup
   ```

2. Start the MCP server:
   ```bash
   nova mcp server
   ```

3. Interact with Copilot normally, but now with enhanced capabilities to access your project's
   resources and services.

See the [First Steps](first-steps.md) guide for detailed instructions on getting started with
Copilot MCP integration.

## Prerequisites

- GitHub Copilot subscription
- Nova CLI installed and configured
- Relevant service integrations (Jira, GitLab, Confluence, etc.) configured in Nova
