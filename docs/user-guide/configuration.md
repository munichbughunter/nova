# Configuration Commands

nova provides commands to manage and verify your configuration.

## Initial Setup

The recommended way to configure nova is through the interactive setup:

```bash
# Full interactive setup
nova setup
```

## View Configuration

Display current configuration:

```bash
nova config show
```

This shows:

- Integration settings
- Authentication tokens
- Service endpoints
- Custom configurations

## Testing Connections

Test integration connectivity:

```bash
# Test all integrations
nova config test
```

## Set Configuration Values

Set specific configuration values:

```bash
nova config set <key> <value>
```

Example:

```bash
nova config set gitlab.url https://gitlab.example.com
```

## Environment Variables

Core environment variables:

```bash
# Atlassian Configuration
export ATLASSIAN_TOKEN="your-token"
export JIRA_URL="your-jira-url"
export CONFLUENCE_URL="your-confluence-url"

# GitLab Configuration
export GITLAB_TOKEN="your-token"
export GITLAB_URL="your-gitlab-url"

# OpenAI Configuration (Optional, mainly for CI)
export OPENAI_API_KEY="your-key"
export OPENAI_URL="https://api.openai.com/v1"
export OPENAI_API_VERSION="2024-10-01-preview"
```

## Best Practices

### Security

- Use environment variables for secrets
- Rotate access tokens regularly
- Use minimal permissions
- Never commit sensitive data

### Organization

- Document custom settings
- Keep configurations versioned
- Use clear key names
- Follow the naming conventions

### Troubleshooting

1. Authentication Issues
   ```bash
   nova config test  # Check all connections
   ```

2. Configuration Issues
   ```bash
   nova config show  # Verify current settings
   ```

3. Setup Issues
   ```bash
   nova setup  # Run interactive setup
   ```

## Common Workflows

### Initial Setup

1. Configure settings
   ```bash
   nova setup
   ```
2. Test connections
   ```bash
   nova config test
   ```
3. Verify configuration
   ```bash
   nova config show
   ```
