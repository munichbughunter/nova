# Nova CLI Configuration Guide

This guide covers how to configure Nova CLI for optimal use with all agents and services, including the Enhanced Code Review Agent.

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [Configuration File Location](#configuration-file-location)
- [Basic Configuration](#basic-configuration)
- [Service-Specific Configuration](#service-specific-configuration)
- [Advanced Configuration](#advanced-configuration)
- [Environment Variables](#environment-variables)
- [Configuration Validation](#configuration-validation)

## Configuration Overview

Nova CLI uses a JSON configuration file to store settings for various services and agents. The configuration supports:

- **GitLab Integration**: For merge request reviews and project management
- **GitHub Integration**: For pull request reviews and repository operations
- **AI Providers**: OpenAI, Azure OpenAI, Ollama, and GitHub Copilot
- **Review Settings**: Code review agent configuration
- **Service Integrations**: Datadog, Atlassian (Jira/Confluence)

## Configuration File Location

Nova looks for configuration files in the following order:

1. `NOVA_CONFIG` environment variable path
2. `.nova-config.json` in current directory
3. `~/.nova/config.json` in home directory
4. Default configuration (minimal settings)

### Creating Configuration File

```bash
# Create global configuration
mkdir -p ~/.nova
touch ~/.nova/config.json

# Create project-specific configuration
touch .nova-config.json

# Set custom configuration path
export NOVA_CONFIG=/path/to/custom-config.json
```

## Basic Configuration

### Minimal Configuration

```json
{
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "sk-your-openai-api-key",
      "default_model": "gpt-4"
    }
  }
}
```

### Complete Basic Configuration

```json
{
  "gitlab": {
    "url": "https://gitlab.com",
    "token": "glpat-your-gitlab-token",
    "project_id": "12345"
  },
  "github": {
    "token": "ghp_your-github-token",
    "apiUrl": "https://api.github.com"
  },
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "sk-your-openai-api-key",
      "default_model": "gpt-4"
    }
  },
  "review": {
    "autoPostComments": true,
    "severityThreshold": "medium",
    "maxFilesPerReview": 50
  }
}
```

## Service-Specific Configuration

### GitLab Configuration

```json
{
  "gitlab": {
    "url": "https://gitlab.com",
    "token": "glpat-your-gitlab-token",
    "project_id": "12345"
  }
}
```

**Configuration Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `url` | string | Yes | GitLab instance URL |
| `token` | string | Yes | GitLab Personal Access Token |
| `project_id` | string | No | Default project ID for operations |

**Setting up GitLab Token:**

1. Go to GitLab → User Settings → Access Tokens
2. Create token with these scopes:
   - `api` (full API access)
   - `read_repository` (repository read access)
   - `write_repository` (for posting comments)
3. Copy token and add to configuration

```bash
# Set GitLab configuration via CLI
nova config set gitlab.url "https://gitlab.com"
nova config set gitlab.token "glpat-your-token"
nova config set gitlab.project_id "12345"
```

### GitHub Configuration

```json
{
  "github": {
    "token": "ghp_your-github-token",
    "apiUrl": "https://api.github.com"
  }
}
```

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | string | - | GitHub Personal Access Token |
| `apiUrl` | string | `https://api.github.com` | GitHub API URL (for Enterprise) |

**Setting up GitHub Token:**

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic) with scopes:
   - `repo` (full repository access)
   - `pull_requests` (PR access)
   - `read:org` (organization access, if needed)
3. Copy token and add to configuration

```bash
# Set GitHub configuration via CLI
nova config set github.token "ghp_your-token"
nova config set github.apiUrl "https://api.github.com"

# For GitHub Enterprise
nova config set github.apiUrl "https://github.enterprise.com/api/v3"
```

### AI Provider Configuration

#### OpenAI Configuration

```json
{
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "sk-your-openai-api-key",
      "api_url": "https://api.openai.com/v1",
      "api_version": "v1",
      "default_model": "gpt-4"
    }
  }
}
```

**Available Models:**
- `gpt-3.5-turbo`
- `gpt-3.5-turbo-16k`
- `gpt-4`
- `gpt-4-32k`
- `gpt-4-turbo-preview`
- `gpt-4o`
- `gpt-4o-mini`

#### Azure OpenAI Configuration

```json
{
  "ai": {
    "default_provider": "azure",
    "azure": {
      "api_key": "your-azure-api-key",
      "api_url": "https://your-resource.openai.azure.com",
      "api_version": "2023-12-01-preview",
      "deployment_name": "gpt-4-deployment"
    }
  }
}
```

#### Ollama Configuration (Local)

```json
{
  "ai": {
    "default_provider": "ollama",
    "ollama": {
      "model": "llama2",
      "api_url": "http://localhost:11434"
    }
  }
}
```

**Popular Ollama Models:**
- `llama2`
- `codellama`
- `mistral`
- `neural-chat`

#### GitHub Copilot Configuration

```json
{
  "ai": {
    "default_provider": "copilot",
    "copilot": {
      "enabled": true
    }
  }
}
```

For comprehensive LLM provider configuration examples and troubleshooting, see the [LLM Provider Configuration Guide](llm-provider-configurations.md).

### Review Configuration

```json
{
  "review": {
    "autoPostComments": true,
    "severityThreshold": "medium",
    "maxFilesPerReview": 50,
    "validation": {
      "enableTransformation": true,
      "enableRecovery": true,
      "maxRecoveryAttempts": 4,
      "fallbackToRuleAnalysis": true
    },
    "errorHandling": {
      "retryAttempts": 3,
      "retryDelay": 1000,
      "enableFallback": true
    }
  }
}
```

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoPostComments` | boolean | `true` | Auto-post review comments to PRs |
| `severityThreshold` | string | `"medium"` | Minimum severity for reporting |
| `maxFilesPerReview` | number | `50` | Maximum files per review operation |

**Validation Configuration:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableTransformation` | boolean | `true` | Enable automatic data transformation |
| `enableRecovery` | boolean | `true` | Enable error recovery strategies |
| `maxRecoveryAttempts` | number | `4` | Maximum recovery attempts per validation |
| `fallbackToRuleAnalysis` | boolean | `true` | Fall back to rule-based analysis |

**Error Handling Configuration:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retryAttempts` | number | `3` | Maximum retry attempts for API calls |
| `retryDelay` | number | `1000` | Base delay between retries (ms) |
| `enableFallback` | boolean | `true` | Enable fallback mechanisms |

**Severity Threshold Options:**
- `"low"` - Report all issues
- `"medium"` - Report medium and high severity issues
- `"high"` - Report only high severity issues

### Datadog Configuration

```json
{
  "datadog": {
    "api_key": "your-datadog-api-key",
    "app_key": "your-datadog-app-key",
    "site": "datadoghq.eu"
  }
}
```

### Atlassian Configuration

```json
{
  "atlassian": {
    "jira_url": "https://your-company.atlassian.net",
    "jira_token": "your-jira-api-token",
    "confluence_url": "https://your-company.atlassian.net/wiki",
    "confluence_token": "your-confluence-api-token",
    "username": "your-email@company.com"
  }
}
```

## Advanced Configuration

### Complete Configuration Example

```json
{
  "gitlab": {
    "url": "https://gitlab.company.com",
    "token": "glpat-xxxxxxxxxxxxxxxxxxxx",
    "project_id": "12345"
  },
  "github": {
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx",
    "apiUrl": "https://github.enterprise.com/api/v3"
  },
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "sk-xxxxxxxxxxxxxxxxxxxx",
      "api_url": "https://api.openai.com/v1",
      "api_version": "v1",
      "default_model": "gpt-4"
    },
    "azure": {
      "api_key": "azure-api-key",
      "api_url": "https://company.openai.azure.com",
      "api_version": "2023-12-01-preview",
      "deployment_name": "gpt-4-deployment"
    },
    "ollama": {
      "model": "codellama",
      "api_url": "http://localhost:11434"
    },
    "copilot": {
      "enabled": true
    }
  },
  "review": {
    "autoPostComments": true,
    "severityThreshold": "medium",
    "maxFilesPerReview": 100
  },
  "datadog": {
    "api_key": "datadog-api-key",
    "app_key": "datadog-app-key",
    "site": "datadoghq.com"
  },
  "atlassian": {
    "jira_url": "https://company.atlassian.net",
    "jira_token": "jira-api-token",
    "confluence_url": "https://company.atlassian.net/wiki",
    "confluence_token": "confluence-api-token",
    "username": "user@company.com"
  }
}
```

### Environment-Specific Configurations

#### Development Configuration

```json
{
  "ai": {
    "default_provider": "ollama",
    "ollama": {
      "model": "codellama",
      "api_url": "http://localhost:11434"
    }
  },
  "review": {
    "autoPostComments": false,
    "severityThreshold": "low",
    "maxFilesPerReview": 10
  }
}
```

#### Production Configuration

```json
{
  "ai": {
    "default_provider": "azure",
    "azure": {
      "api_key": "${AZURE_OPENAI_API_KEY}",
      "api_url": "${AZURE_OPENAI_ENDPOINT}",
      "api_version": "2023-12-01-preview",
      "deployment_name": "gpt-4-production"
    }
  },
  "review": {
    "autoPostComments": true,
    "severityThreshold": "medium",
    "maxFilesPerReview": 50
  }
}
```

## Environment Variables

Nova supports environment variable substitution in configuration files:

### Supported Variables

```bash
# AI Configuration
export OPENAI_API_KEY="sk-your-key"
export AZURE_OPENAI_API_KEY="your-azure-key"
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com"

# Repository Configuration
export GITHUB_TOKEN="ghp_your-token"
export GITLAB_TOKEN="glpat-your-token"

# Service Configuration
export DATADOG_API_KEY="your-datadog-key"
export JIRA_API_TOKEN="your-jira-token"
```

### Using Environment Variables in Configuration

```json
{
  "github": {
    "token": "${GITHUB_TOKEN}"
  },
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "${OPENAI_API_KEY}",
      "default_model": "gpt-4"
    }
  }
}
```

### Setting Environment Variables

```bash
# Temporary (current session)
export GITHUB_TOKEN="ghp_your-token"

# Permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export GITHUB_TOKEN="ghp_your-token"' >> ~/.bashrc

# Using .env file (if supported)
echo 'GITHUB_TOKEN=ghp_your-token' >> .env
```

## Configuration Management

### Using Nova CLI Commands

```bash
# View current configuration
nova config show

# View specific section
nova config show github

# Set configuration values
nova config set github.token "ghp_new-token"
nova config set ai.default_provider "openai"

# Remove configuration values
nova config unset github.token

# Validate configuration
nova config validate

# Reset to defaults
nova config reset
```

### Configuration File Management

```bash
# Backup current configuration
cp ~/.nova/config.json ~/.nova/config.json.backup

# Restore configuration
cp ~/.nova/config.json.backup ~/.nova/config.json

# Edit configuration manually
nano ~/.nova/config.json

# Validate JSON syntax
cat ~/.nova/config.json | jq '.'
```

## Configuration Validation

### Automatic Validation

Nova automatically validates configuration when:
- Loading configuration at startup
- Setting values via CLI commands
- Running `nova config validate`

### Manual Validation

```bash
# Validate current configuration
nova config validate

# Validate specific file
nova config validate --file /path/to/config.json

# Show validation errors
nova config validate --verbose
```

### Common Validation Errors

1. **Invalid JSON Syntax:**
   ```
   Error: Invalid JSON syntax at line 5, column 12
   ```

2. **Missing Required Fields:**
   ```
   Error: Missing required field 'api_key' in ai.openai configuration
   ```

3. **Invalid Field Values:**
   ```
   Error: Invalid value 'invalid-model' for ai.openai.default_model
   ```

4. **URL Format Errors:**
   ```
   Error: Invalid URL format for gitlab.url
   ```

### Configuration Schema

Nova uses a strict schema for validation. Here's the complete schema:

```typescript
interface Config {
  gitlab?: {
    url: string;           // Valid URL
    token: string;         // Non-empty string
    project_id?: string;   // Optional project ID
  };
  github?: {
    token?: string;        // GitHub token
    apiUrl: string;        // Default: https://api.github.com
  };
  ai?: {
    default_provider: 'openai' | 'azure' | 'ollama' | 'copilot';
    openai?: {
      api_key: string;     // OpenAI API key
      api_url?: string;    // Default: https://api.openai.com/v1
      api_version?: string; // Default: v1
      default_model: OpenAIModel; // Valid OpenAI model
    };
    azure?: {
      api_key: string;     // Azure API key
      api_url: string;     // Azure endpoint URL
      api_version: string; // Azure API version
      deployment_name: string; // Deployment name
    };
    ollama?: {
      model: string;       // Ollama model name
      api_url?: string;    // Default: http://localhost:11434
    };
    copilot?: {
      enabled: boolean;    // Enable Copilot
    };
  };
  review?: {
    autoPostComments: boolean;    // Default: true
    severityThreshold: 'low' | 'medium' | 'high'; // Default: medium
    maxFilesPerReview: number;    // Default: 50, Range: 1-1000
    validation?: {
      enableTransformation: boolean;  // Default: true
      enableRecovery: boolean;        // Default: true
      maxRecoveryAttempts: number;    // Default: 4, Range: 1-10
      fallbackToRuleAnalysis: boolean; // Default: true
    };
    errorHandling?: {
      retryAttempts: number;          // Default: 3, Range: 0-10
      retryDelay: number;             // Default: 1000, Range: 100-10000
      enableFallback: boolean;        // Default: true
    };
  };
  datadog?: {
    api_key: string;     // Datadog API key
    app_key: string;     // Datadog app key
    site: string;        // Default: datadoghq.eu
  };
  atlassian?: {
    jira_url: string;    // Jira instance URL
    jira_token: string;  // Jira API token
    confluence_url: string; // Confluence URL
    confluence_token: string; // Confluence token
    username: string;    // Atlassian username
  };
}
```

## Best Practices

### Security

1. **Use Environment Variables for Secrets:**
   ```json
   {
     "github": {
       "token": "${GITHUB_TOKEN}"
     }
   }
   ```

2. **Set Proper File Permissions:**
   ```bash
   chmod 600 ~/.nova/config.json
   ```

3. **Don't Commit Secrets:**
   ```bash
   # Add to .gitignore
   echo '.nova-config.json' >> .gitignore
   echo 'config.json' >> .gitignore
   ```

### Organization

1. **Use Project-Specific Configurations:**
   ```bash
   # Different config per project
   cd project1 && echo '{"review":{"maxFilesPerReview":10}}' > .nova-config.json
   cd project2 && echo '{"review":{"maxFilesPerReview":100}}' > .nova-config.json
   ```

2. **Layer Configurations:**
   ```bash
   # Global defaults in ~/.nova/config.json
   # Project overrides in .nova-config.json
   ```

3. **Document Configuration:**
   ```bash
   # Add README section about Nova configuration
   # Include example configuration files
   ```

### Performance

1. **Optimize Review Settings:**
   ```json
   {
     "review": {
       "maxFilesPerReview": 20,
       "severityThreshold": "medium"
     }
   }
   ```

2. **Use Local AI When Possible:**
   ```json
   {
     "ai": {
       "default_provider": "ollama",
       "ollama": {
         "model": "codellama"
       }
     }
   }
   ```

This configuration guide provides comprehensive coverage of all Nova CLI configuration options, with special attention to the Enhanced Code Review Agent settings.