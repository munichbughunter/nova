# VISON!!!
--- 

# Nova

Nova is an intelligent CLI tool that enhances project management and development workflows through AI-powered agents.
It integrates seamlessly with your development process, providing automated assistance for project management,
code development. All commands are wrapped inside an MCP Server.

## Quick Install

tbd

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Agents](#agents)
- [Configuration](#configuration)
- [Shell Completions](#shell-completions)
- [Contributing](#contributing)

### Features

🤖 AI-powered code review and analysis

- Code review for files and merge requests
- Integration with GitHub Copilot
- Support for multiple LLM providers (OpenAI, Azure, Ollama)

📊 Comprehensive DevOps Insights

- DORA metrics integration with GitLab and Jira
- Engineering metrics dashboard
- Project health monitoring
- Team performance analytics

🔄 Seamless Service Integration

- GitLab project management
- Jira issue tracking
- Confluence documentation
- Datadog monitoring

📝 Documentation and Knowledge Management

- Confluence space management
- Documentation search and navigation
- API documentation support
- Technical documentation generation

🔧 Robust Configuration Management

- Interactive setup wizard
- Environment-based configuration
- Service connection testing

### Prerequisites

- Deno 2.2.11 or newer (https://docs.deno.com/runtime/getting_started/installation/)
- GitHub CLI (https://github.com/cli/cli?tab=readme-ov-file#installation)
- GitHub account with authentication (https://github.com/signup)
- GitHub Copilot CLI extension (https://github.com/github/gh-copilot?tab=readme-ov-file#quickstart)
- GitLab/GitHub Personal Access Token with API scope:
    - GitHub
      guide: [Creating fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens?apiVersion=2022-11-28&versionId=free-pro-team%40latest#creating-a-fine-grained-personal-access-token)
    - GitLab
      guide: [Create a personal access token](https://docs.gitlab.com/user/profile/personal_access_tokens/#create-a-personal-access-token)

## Installation

Install the GitHub CLI and authenticate:
On macOS, using [Homebrew](https://brew.sh/):

```shell
$ brew install gh
# follow the CLI instructions to login
$ gh auth login
```

Install the GitHub Copilot CLI extension:

```shell
$ gh extension install github/gh-copilot
```

To let GitHub Copilot run commands on your behalf, add the following line to your .zshrc or .bashrc:

```shell
# for Zsh
echo 'eval "$(gh copilot alias -- zsh)"' >> ~/.zshrc
# for bash
echo 'eval "$(gh copilot alias -- bash)"' >> ~/.bashrc
```

Install Nova:

```shell
deno install -A -f ....
```

Run the setup assistant:

```shell
nova setup
```

The setup assistant will help you configure:

GitHub authentication
GitLab authentication and API access
OpenAI API credentials
Default project settings

## Development

To set up the development environment, you can set aliases and shell completions:

```shell
deno task setup-dev
source ~/.zshrc
```

Or use the development task directly:

```shell
deno task dev agent eng review src/
```

For development with file watching:

```shell
deno task dev --watch
```

### Snapshot Testing

Nova uses snapshot testing for commands to ensure output stability and catch UI bugs caused by regressions.
Snapshots capture command output for future comparison.

Creating Snapshot Tests

Create a test file with a `.snapshot.test.ts` extension:

```typescript
import {snapshotTest} from '@cliffy/testing';

await snapshotTest({
  name: 'My Test',
  meta: import.meta,
  colors: true, // Preserve color output
  async fn() {
    // Code that produces output to snapshot
    console.log('Hello world!');
  },
});

```

Generate or update snapshots:

```shell
deno test -A --no-check path/to/your.snapshot.test.ts -- --update
```

Run tests to validate against snapshots:

```shell
deno test -A path/to/your.snapshot.test.ts
```

Snapshots are stored in __snapshots__ directories and should be committed to version control.

## Installation

Install the production version:

### directly from source

```shell
deno task install
```

### or from a release

```shell
brew install tbd
```

## Usage

Basic usage:

```shell
USAGE
  nova <command> <subcommand> [options]

COMMANDS
  agent                # Agent-related commands
  gitlab               # GitLab-related commands
  jira                 # Jira-related commands
  confluence           # Confluence-related commands
  datadog              # Datadog-related commands
  dora                 # Dora-related commands

AGENT COMMANDS
  agent dev            # Engineering Agent for code review and analysis
  agent dev review     # Review code changes in a file or directory
  agent dev review-mr  # Review current merge request
  
GITLAB COMMANDS
  gitlab projects      # List GitLab projects
  gitlab dashboard     # Show engineering metrics dashboard
  
JIRA COMMANDS
  jira projects        # List Jira projects
  jira issues          # List issues for a project
  jira dashboard       # Show project metrics dashboard
  jira open            # Open issue in browser

CONFLUENCE COMMANDS
  confluence spaces    # List Confluence spaces
  confluence pages     # List pages in a space
  confluence search    # Search Confluence content
  confluence dashboard # Show space dashboard
  confluence page      # Show details about a specific page
  
DATADOG COMMANDS
  datadog teams        # List and search Datadog teams
  datadog dashboards   # List Datadog dashboards

DORA COMMANDS
  dora metrics         # Show DORA metrics for linked Jira and GitLab projects
```

Most commands support additional options. Use `--help` with any command to see more information

```shell
-f, --format: Output format (text/json)

-r, --recent: Use most recent project/space

--refresh: Force refresh cached data
```

## Agents

Project Manager Agent
The Project Manager agent helps you maintain project oversight and coordination:

- Sprint status tracking and updates
- Ticket management and prioritization
- Team coordination and resource allocation
- Project health monitoring
- Integration with common project management tools

Engineering Agent
The Engineering Agent assists with technical tasks:

- Code generation and review
- Bug fixing and debugging
- Code refactoring suggestions
- Performance optimization
- Technical documentation
- Integration with GitHub Copilot

## Configuration

Nova can be configured through the interactive setup, environment variables, or configuration file.

## Quick Setup

### Interactive setup

```shell
nova setup
```

### Environment Variables

Core environment variables:

#### GitLab Configuration

```shell
GITLAB_TOKEN=your-gitlab-token
GITLAB_URL=your-gitlab-url
```

#### OpenAI Configuration

```shell
OPENAI_API_KEY=your-openai-key
OPENAI_URL=your-openai-url
OPENAI_API_VERSION=2024-10-01-preview
```

#### Create .env file with your configuration

```shell
nova config init > .env

# load environment variables
source .env
```

### Configuration File

Alternatively, use a nova.config.json file:

```json
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
```

### Configuration Priority

Nova uses the following priority order for configuration:

1. Command line arguments
2. Environment variables
3. Configuration file (nova.config.json)
4. Default values

### Verifying Configuration

To verify your configuration:

#### Check current configuration

```shell
nova
```

## CI/CD Integration

nova integrates with GitLab CI/CD to provide:

- Automated merge request scoring
- AI-powered code review assistance
- Documentation generation
- Quality checks
- Performance analysis

### AI Code Review

The AI code review feature automatically analyzes merge requests and provides detailed feedback. It
includes:

- Code quality assessment
- Best practices recommendations
- Security vulnerability detection
- Performance optimization suggestions
- Clean code principles enforcement

### Shell Completions

Use the development alias with shell completions. Nova supports shell completions for commands and arguments. Once
configured, you can enter a nova command followed by the TAB key. To enable them:

```shell
# for Zsh
deno completions zsh > ~/.zsh/_nova
# Add to ~/.zshrc:
fpath=(~/.zsh $fpath)
autoload -Uz compinit
compinit

# for Bash
deno completions bash > ~/.bash_completion.d/nova.bash
# Add to ~/.bashrc:
source ~/.bash_completion.d/nova.bash
```

Use shell completion:

```shell
nova agent dev[TAB]         # Shows available commands
nova agent dev review[TAB]  # Shows files
```

## Contributing

We welcome contributions! Please see our [Contributing Guide]() for details.
