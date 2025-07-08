# nova
# VISON!!!

# nova-cli
## Nova

Nova is an intelligent CLI tool that enhances project management and development workflows through
AI-powered agents. It seamlessly integrates with your development process, providing automated
assistance for project management, code development, and infrastructure management. All the commands
will be wrapped inside a MCP Server.

Quick Install

tbd

Table of Contents

Features
Prerequisites
Installation
Usage
Agents
Configuration
Contributing
Shell Completions


Features


🤖 AI-powered code review and analysis

Code review for files and merge requests
Integration with GitHub Copilot
Support for multiple LLM providers (OpenAI, Azure, Ollama)



📊 Comprehensive DevOps Insights

DORA metrics integration with GitLab and Jira
Engineering metrics dashboard
Project health monitoring
Team performance analytics



🔄 Seamless Service Integration

GitLab project management
Jira issue tracking
Confluence documentation
Datadog monitoring



📝 Documentation and Knowledge Management

Confluence space management
Documentation search and navigation
API documentation support
Technical documentation generation



🔧 Robust Configuration Management

Interactive setup wizard
Environment-based configuration
Multiple authentication methods
Service connection testing




Prerequisites


Deno 2.2.11 or higher

GitHub CLI installed
GitHub account with authentication

Github Copilot CLI extension installed
GitLab/GitHub account with API access
GitLab/GitHub Personal Access Token with api scope


Installation

Install the GitHub CLI:


brew install gh

Authenticate with GitHub:


gh auth login

Install the GitHub Copilot CLI extension:


gh extension install github/gh-copilot
To Let copilot run commands on your behalf, you need to add the following to your .zshrc or
.bashrc:

echo 'eval "$(gh copilot alias -- zsh)"' >> ~/.zshrc

Install Nova:


deno install -A -f ....

Run the setup assistant:


nova setup
The setup assistant will help you configure:

GitHub authentication
GitLab authentication and API access
OpenAI API credentials
Default project settings


Development
For development, you can:

Set up the development environment:


# This will set up aliases and completions
deno task setup-dev
source ~/.zshrc

Use the development alias with completions:


nova agent eng[TAB]  # Shows available commands
nova agent eng review[TAB]  # Shows files

Or use the development task directly:


deno task dev agent eng review src/

For development with file watching:


deno task dev --watch

Snapshot Testing
Nova should use snapshot testing for commands to ensure output stability and catch UI regressions.
Snapshots capture command output for future comparison.

Creating Snapshot Tests

Create a test file with the .snapshot.test.ts extension:


import { snapshotTest } from '@cliffy/testing';

await snapshotTest({
  name: 'My Test',
  meta: import.meta,
  colors: true, // Preserve color output
  async fn() {
    // Code that produces output to snapshot
    console.log('Hello world!');
  },
});

Generate or update snapshots:


deno test -A --no-check path/to/your.snapshot.test.ts -- --update

Run tests to validate against snapshots:


deno test -A path/to/your.snapshot.test.ts
Snapshots are stored in __snapshots__ directories and should be committed to version control.

Installation
To install the production version:

# Install from source
deno task install

# Or install from release
brew install nova

Usage
Basic usage:

nova

Available Commands

Agent Commands

nova agent eng         # Engineering Agent for code review and analysis
nova agent eng review  # Review code changes in a file or directory
nova agent eng review-mr  # Review current merge request

GitLab Commands

nova gitlab projects    # List GitLab projects
nova gitlab dashboard   # Show engineering metrics dashboard

Jira Commands

nova jira projects    # List Jira projects
nova jira issues      # List issues for a project
nova jira dashboard   # Show project metrics dashboard
nova jira open        # Open issue in browser

Confluence Commands

nova confluence spaces    # List Confluence spaces
nova confluence pages    # List pages in a space
nova confluence search   # Search Confluence content
nova confluence dashboard # Show space dashboard
nova confluence page     # Show details about a specific page

Datadog Commands

nova datadog teams      # List and search Datadog teams
nova datadog dashboards # List Datadog dashboards

DORA Metrics Commands

nova dora metrics      # Show DORA metrics for linked Jira and GitLab projects

Most commands support additional options:


-f, --format: Output format (text/json)

-r, --recent: Use most recent project/space

--refresh: Force refresh cached data
For more options, use --help with any command


Agents

Project Manager Agent
The Project Manager agent helps you maintain project oversight and coordination:

Sprint status tracking and updates
Ticket management and prioritization
Team coordination and resource allocation
Project health monitoring
Integration with common project management tools


Engineering Agent
The Engineering Agent assists with technical tasks:

Code generation and review
Bug fixing and debugging
Code refactoring suggestions
Performance optimization
Technical documentation
Integration with Github Copilot


Configuration
Nova can be configured through the interactive setup, environment variables, or configuration file.

Quick Setup

# Interactive setup
nova setup

Environment Variables
Core environment variables:

# GitLab Configuration
GITLAB_TOKEN=your-gitlab-token
GITLAB_URL=your-gitlab-url

# OpenAI Configuration
OPENAI_API_KEY=your-openai-key
OPENAI_URL=your-openai-url
OPENAI_API_VERSION=2024-10-01-preview

# Create .env file with your configuration
nova config init > .env

# Load environment variables from .env
source .env

Configuration File
Alternatively, use a nova.config.json file:

{
  "github": {
    "organization": "your-org",
    "repository": "your-repo"
  },
  "gitlab": {
    "url": "your-gitlab-url",
    "token": "your-gitlab-token",
    "project_id": "your-project-id"
  },
  "openai": {
    "api_key": "your-openai-key",
    "api_url": "your-openai-url",
    "api_version": "2024-10-01-preview"
  }
}

Configuration Priority
Nova uses the following priority order for configuration:

Command line arguments
Environment variables
Configuration file (nova.config.json)
Default values


Verifying Configuration
To verify your configuration:

# Check current configuration
nova


CI/CD Integration
nova integrates with GitLab CI/CD to provide:

Automated merge request scoring
AI-powered code review assistance
Documentation generation
Quality checks
Performance analysis


AI Code Review
The AI code review feature automatically analyzes merge requests and provides detailed feedback. It
includes:

Code quality assessment
Best practices recommendations
Security vulnerability detection
Performance optimization suggestions
Clean code principles enforcement

Contributing
We welcome contributions! Please see our Contributing Guide for details.

Shell Completions
Nova supports shell completions for commands and arguments. To enable:

Zsh

deno completions zsh > ~/.zsh/_nova
# Add to ~/.zshrc:
fpath=(~/.zsh $fpath)
autoload -Uz compinit
compinit

Bash

deno completions bash > ~/.bash_completion.d/nova.bash
# Add to ~/.bashrc:
source ~/.bash_completion.d/nova.bash
