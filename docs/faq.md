# Frequently Asked Questions

## General Questions

### What is Nova?

Nova is an intelligent CLI tool that enhances project management and development workflows by
integrating with common development platforms like Jira, GitLab, Confluence.

### Why should I use Nova?

Nova streamlines your development workflow by:

- Providing a unified interface for multiple platforms
- Managing credentials and profiles efficiently
- Offering intelligent project insights
- Automating common tasks

### Which platforms does Nova support?

Currently supported platforms:

- Jira for project management
- GitLab for source control
- Confluence for documentation

## Setup & Configuration

### How do I install Nova?

```bash
deno task install
```

### How do I configure integrations?

Run the setup command:

```bash
nova setup                    # Full interactive setup
```

### Where are configuration files stored?

- Main config: `~/.nova/config.json`
- Cache: `~/.nova/cache/`
- Logs: `~/.nova/logs/`

## Common Issues

### Authentication Failed

1. Check your credentials
2. Verify API tokens
3. Run `nova setup` for the specific integration

### Command Not Found

1. Ensure Nova is installed
2. Check your PATH
3. Run `deno install` again

### Cache Problems

Clear the cache:

```bash
nova cache clear
```

## Performance

### How can I improve command performance?

1. Use the `--recent` flag for frequently accessed items
2. Enable caching
3. Use specific commands instead of broad queries

### How does caching work?

- Results are cached by default
- Use `--refresh` to force fresh data
- Cache expires based on data type

## Development

### How do I contribute to Nova?

1. Fork the repository
2. Set up development environment
3. Follow contribution guidelines
4. Submit pull request

### How do I create custom commands?

See the [Command Development Guide](developer/create-command.md) for detailed instructions.

### How do I create custom agents?

See the [Agent Development Guide](developer/create-agent.md) for detailed instructions.

### What is the current status of AI agents?

The code review agent is being actively developed with focus on:

1. Automated code analysis
2. CI/CD integration
3. Best practices enforcement

Other agents (project management, redirect service) are planned for future releases.

### When will GitHub Copilot integration be available?

GitHub Copilot integration is planned for future releases. Currently, we use Ollama for local LLM
capabilities.

### How can I help test the agents?

You can test the code review agent in development using:

```bash
novad agent eng review
```

Feedback and bug reports are welcome through our issue tracker.

## Integration Specific

### Jira

#### How do I switch Jira projects?

```bash
nova jira projects  # List projects
nova jira use PROJECT_KEY
```

#### How do I search issues?

```bash
nova jira issues -q "your JQL query"
```

### GitLab

#### How do I access private repositories?

1. Generate personal access token from GitLab settings
2. Configure with interactive setup or token:
   ```bash
   nova setup
   ```
3. Use token for authentication

#### How do I view merge requests?

```bash
nova gitlab mrs --project PROJECT_ID
```

### Confluence

#### How do I search documentation?

```bash
nova confluence search "query"
```

#### How do I access specific spaces?

```bash
nova confluence spaces  # List spaces
nova confluence use SPACE_KEY
```

## Best Practices

### Security

1. Rotate access tokens regularly
2. Use environment variables for sensitive data
3. Enable minimum required permissions

### Performance

1. Use specific commands
2. Leverage caching
3. Filter results appropriately

### Organization

1. Use consistent project keys
2. Maintain documentation
3. Follow naming conventions

### Datadog

#### How do I configure Datadog integration?

1. Get your Datadog API and Application keys from your organization settings
2. Configure with interactive setup:
   ```bash
   nova setup
   ```

#### How do I view team information?

```bash
nova datadog teams              # List all teams
nova datadog teams -q "search"  # Search teams
```

#### How do I access dashboards?

```bash
nova datadog dashboards         # List all dashboards
nova datadog dashboards --format json  # Get JSON output
```

### DORA Metrics

#### What are DORA metrics?

DORA (DevOps Research and Assessment) metrics are key indicators of software delivery performance:

- Deployment Frequency
- Lead Time for Changes
- Time to Restore Service
- Change Failure Rate

#### How do I view DORA metrics?

```bash
nova dora metrics                    # Interactive selection
nova dora metrics --jira PROJECT     # Specific Jira project
nova dora metrics --gitlab GROUP/PROJ # Specific GitLab project
```

#### How do I analyze different time periods?

Use the `--time-range` flag:

```bash
nova dora metrics --time-range 7d   # Last 7 days
nova dora metrics --time-range 30d  # Last 30 days
nova dora metrics --time-range 90d  # Last 90 days
```
