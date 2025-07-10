# External MCP Server Management

Nova now supports dynamic integration of external MCP (Model Context Protocol) servers, allowing users to add and manage third-party MCP servers without modifying Nova's source code.

## Overview

The external MCP server system provides:

- **Dynamic Server Registration**: Add any MCP server using templates or custom configurations
- **Template System**: Pre-configured templates for popular MCP servers
- **Context-Aware Tools**: Tools automatically appear in appropriate contexts (CLI/IDE)
- **Server Management**: Start, stop, enable, and disable servers
- **Tool Namespacing**: Automatic tool prefixing to avoid conflicts

## Quick Start

### 1. View Available Templates

```bash
nova mcp servers templates
```

This shows available server templates like:
- `filesystem` - File system access tools
- `github` - GitHub API access
- `postgres` - PostgreSQL database access
- `slack` - Slack API access

### 2. Add a Server

```bash
# Interactive mode (recommended)
nova mcp servers add

# Non-interactive with template
nova mcp servers add --template github --id my-github
```

### 3. Start the Nova MCP Server

```bash
nova mcp server
```

External servers will automatically start when Nova MCP server starts.

## Command Reference

### Server Management

```bash
# Add a new server (interactive)
nova mcp servers add

# Add with specific template
nova mcp servers add --template filesystem --id fs-server

# List all servers
nova mcp servers list

# List with status and details
nova mcp servers list --status --verbose

# Remove a server
nova mcp servers remove --id server-name

# Show available templates
nova mcp servers templates
```

## Server Templates

### Filesystem Server
Provides file system access tools with `fs_` prefix.

```bash
nova mcp servers add --template filesystem --id fs-server
```

**Environment variables**: None required
**Tools**: File read/write operations

### GitHub Server
Provides GitHub API access tools with `gh_` prefix.

```bash
nova mcp servers add --template github --id github-server
```

**Environment variables**:
- `GITHUB_PERSONAL_ACCESS_TOKEN`: Your GitHub personal access token

**Tools**: Repository management, issue tracking, etc.

### PostgreSQL Server
Provides database access tools with `pg_` prefix.

```bash
nova mcp servers add --template postgres --id db-server
```

**Environment variables**:
- `POSTGRES_CONNECTION_STRING`: Database connection string

**Tools**: Database queries, schema operations

### Slack Server
Provides Slack API access tools with `slack_` prefix.

```bash
nova mcp servers add --template slack --id slack-server
```

**Environment variables**:
- `SLACK_BOT_TOKEN`: Your Slack bot token

**Tools**: Message sending, channel management

## Configuration

Server configurations are stored in `~/.nova/mcp-servers.json`:

```json
{
  "version": "1.0.0",
  "servers": {
    "my-github": {
      "id": "my-github",
      "name": "GitHub MCP Server",
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "tool_prefix": "gh_",
      "enabled": true
    }
  }
}
```

## Custom Servers

You can add custom MCP servers by providing full configuration:

```javascript
const customServer = {
  id: 'custom-server',
  name: 'My Custom Server',
  description: 'Custom MCP server',
  type: 'stdio',
  command: '/path/to/server',
  args: ['--config', 'path/to/config'],
  env: {
    'API_KEY': '${MY_API_KEY}'
  },
  tool_prefix: 'custom_',
  enabled: true
};
```

## Tool Integration

External tools automatically integrate with Nova's MCP system:

1. **Tool Discovery**: External tools are automatically discovered and registered
2. **Context Filtering**: Tools can be limited to specific contexts (CLI/IDE)
3. **Name Conflicts**: Tool prefixes prevent naming conflicts
4. **Execution Routing**: Tool calls are automatically routed to the correct server

## Environment Variables

Use `${VAR_NAME}` syntax in server configurations to reference environment variables:

```json
{
  "env": {
    "API_TOKEN": "${MY_API_TOKEN}",
    "DATABASE_URL": "${DATABASE_URL}"
  }
}
```

## Troubleshooting

### Server Won't Start

1. Check server configuration in `~/.nova/mcp-servers.json`
2. Verify environment variables are set
3. Test the server command manually
4. Check Nova logs for error messages

### Tools Not Appearing

1. Verify server is running: `nova mcp servers list --status`
2. Check tool prefix configuration
3. Ensure server is enabled for the correct context

### Permission Issues

Some servers require specific permissions or trusted status. Set `trusted: true` in server configuration for elevated privileges.

## Examples

### Setting up GitHub Integration

```bash
# Add GitHub server
nova mcp servers add --template github --id github

# Set environment variable
export GITHUB_TOKEN="your_github_token_here"

# Start Nova MCP server
nova mcp server
```

### Multiple Database Servers

```bash
# Add production database
nova mcp servers add --template postgres --id prod-db
# Configure: POSTGRES_CONNECTION_STRING=postgresql://prod-host/db

# Add staging database  
nova mcp servers add --template postgres --id staging-db
# Configure: POSTGRES_CONNECTION_STRING=postgresql://staging-host/db
```

Tools will be available as `pg_query`, etc., but each connects to different databases based on configuration.
