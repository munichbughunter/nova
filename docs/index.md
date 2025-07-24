# Welcome to Nova

Nova is an intelligent CLI tool that enhances project management and development workflows through seamless integration with your development platforms and tools.

## Quick Start

```bash

#2. Tap the repository:
tbd

#3. Install Nova:
   brew install nova

# To update to the latest version:

brew update
brew upgrade nova

## 

# Run setup
nova setup

# Start using commands
nova --help
```

## Command Overview

!!! note Project Management
    !!! info Jira & GitLab Integration
        ```bash
        # Jira Commands
        nova jira projects     # List Jira projects
        nova jira issues       # List issues for a project
        nova jira dashboard    # Show project metrics
        nova jira open         # Open issue in browser

        # GitLab Commands
        nova gitlab projects   # List GitLab projects
        nova gitlab dashboard  # View engineering metrics

        # DORA Metrics
        nova dora metrics     # View DORA metrics
        ```

!!! note Documentation
    !!! info Confluence Integration
        ```bash
        nova confluence spaces    # List spaces
        nova confluence pages     # List pages in space
        nova confluence search    # Search content
        nova confluence dashboard # Show space dashboard
        nova confluence page      # View page details
        ```

!!! Monitoring
    !!! info Datadog Integration
        ```bash
        nova datadog teams       # List/search teams
        nova datadog dashboards  # List dashboards
        ```

!!! note AI Features
    !!! info Code Review & Analysis
        ```bash
        # Code Review
        nova agent eng review     # Review code changes
        nova agent eng review-mr  # Review merge requests

        # Coming Soon
        nova agent eng documentor # Generate documentation
        nova agent eng architect  # Architecture analysis
        nova agent eng tester     # Test generation
        nova agent eng refactor   # Code refactoring
        nova agent eng security   # Security analysis
        ```

!!! note Configuration
    !!! info Setup & Management
        ```bash
        # Setup
        nova setup               # Interactive setup
        
        # Configuration
        nova config list         # List all values
        nova config get          # Get specific value
        nova config set          # Set specific value
        nova config test         # Test connections
        ```

## Key Features

- **AI-Powered Development**
  - Code review and analysis
  - Multiple LLM providers (OpenAI, Azure, Ollama)
  - GitHub Copilot integration

- **DevOps Insights**
  - DORA metrics integration
  - Engineering metrics dashboard
  - Project health monitoring
  - Team performance analytics

- **Service Integration**
  - GitLab project management
  - Jira issue tracking
  - Confluence documentation
  - Datadog monitoring

- **Documentation Management**
  - Confluence space management
  - Documentation search
  - API documentation
  - Technical documentation

- **Configuration Management**
  - Interactive setup wizard
  - Environment-based config
  - Multiple auth methods
  - Service connection testing

## Integration Support

Nova integrates with:

- **Project Management**
  - Jira for issue tracking
  - GitLab for source control
- **Documentation**
  - Confluence for team documentation
- **AI Features (Work in Progress)**
  - Ollama for local LLM
  - AI agents for automation (Code review in development)
  - GitHub Copilot integration (Coming soon)

## Getting Started

## Getting Help

- Use `nova <command> --help` for detailed command help
- Check our [User Guide](user-guide/commands.md) for complete documentation
- Enable shell completions for command hints
- Use `--format json` for machine-readable output

## Configuration

First-time setup:
```bash
nova setup                    # Full interactive setup
```

For detailed configuration options, see our [Configuration Guide](getting-started/configuration.md).
