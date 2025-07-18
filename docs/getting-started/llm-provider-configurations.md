# LLM Provider Configuration Examples

This document provides comprehensive configuration examples for different LLM providers supported by Nova's Enhanced Code Review Agent.

## Table of Contents

- [Overview](#overview)
- [OpenAI Configuration](#openai-configuration)
- [Azure OpenAI Configuration](#azure-openai-configuration)
- [Ollama Configuration](#ollama-configuration)
- [GitHub Copilot Configuration](#github-copilot-configuration)
- [Multi-Provider Setup](#multi-provider-setup)
- [Provider-Specific Features](#provider-specific-features)
- [Troubleshooting](#troubleshooting)

## Overview

Nova's Enhanced Code Review Agent supports multiple LLM providers, each with specific configuration requirements and capabilities. The agent automatically handles response format variations and provides intelligent error recovery across all providers.

### Supported Providers

- **OpenAI**: GPT-3.5, GPT-4, and GPT-4 Turbo models
- **Azure OpenAI**: Enterprise-grade OpenAI models hosted on Azure
- **Ollama**: Local LLM hosting with various open-source models
- **GitHub Copilot**: Integration with GitHub's AI assistant

## OpenAI Configuration

### Basic OpenAI Setup

```json
{
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "sk-your-openai-api-key-here",
      "default_model": "gpt-4"
    }
  }
}
```

### Complete OpenAI Configuration

```json
{
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "sk-your-openai-api-key-here",
      "api_url": "https://api.openai.com/v1",
      "api_version": "v1",
      "default_model": "gpt-4",
      "temperature": 0.1,
      "max_tokens": 2000,
      "timeout": 30000
    }
  }
}
```

### Available OpenAI Models

```json
{
  "ai": {
    "openai": {
      "models": {
        "fast": "gpt-3.5-turbo",
        "balanced": "gpt-4",
        "advanced": "gpt-4-turbo-preview",
        "latest": "gpt-4o"
      }
    }
  }
}
```

### Model-Specific Configurations

#### GPT-3.5 Turbo (Fast & Cost-Effective)
```json
{
  "ai": {
    "openai": {
      "api_key": "sk-your-key",
      "default_model": "gpt-3.5-turbo",
      "temperature": 0.2,
      "max_tokens": 1500
    }
  }
}
```

#### GPT-4 (Balanced Performance)
```json
{
  "ai": {
    "openai": {
      "api_key": "sk-your-key",
      "default_model": "gpt-4",
      "temperature": 0.1,
      "max_tokens": 2000
    }
  }
}
```

#### GPT-4 Turbo (Advanced Analysis)
```json
{
  "ai": {
    "openai": {
      "api_key": "sk-your-key",
      "default_model": "gpt-4-turbo-preview",
      "temperature": 0.05,
      "max_tokens": 4000
    }
  }
}
```

### Environment Variable Setup

```bash
# Set OpenAI API key
export OPENAI_API_KEY="sk-your-openai-api-key-here"

# Optional: Custom API URL
export OPENAI_API_URL="https://api.openai.com/v1"

# Configuration using environment variables
{
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "${OPENAI_API_KEY}",
      "api_url": "${OPENAI_API_URL}",
      "default_model": "gpt-4"
    }
  }
}
```

## Azure OpenAI Configuration

### Basic Azure OpenAI Setup

```json
{
  "ai": {
    "default_provider": "azure",
    "azure": {
      "api_key": "your-azure-openai-api-key",
      "api_url": "https://your-resource.openai.azure.com",
      "api_version": "2023-12-01-preview",
      "deployment_name": "gpt-4-deployment"
    }
  }
}
```

### Complete Azure OpenAI Configuration

```json
{
  "ai": {
    "default_provider": "azure",
    "azure": {
      "api_key": "your-azure-openai-api-key",
      "api_url": "https://your-resource.openai.azure.com",
      "api_version": "2023-12-01-preview",
      "deployment_name": "gpt-4-deployment",
      "temperature": 0.1,
      "max_tokens": 2000,
      "timeout": 45000,
      "retry_attempts": 3
    }
  }
}
```

### Multiple Azure Deployments

```json
{
  "ai": {
    "default_provider": "azure",
    "azure": {
      "api_key": "your-azure-openai-api-key",
      "api_url": "https://your-resource.openai.azure.com",
      "api_version": "2023-12-01-preview",
      "deployments": {
        "fast": "gpt-35-turbo-deployment",
        "balanced": "gpt-4-deployment",
        "advanced": "gpt-4-32k-deployment"
      },
      "default_deployment": "balanced"
    }
  }
}
```

### Azure Environment Variables

```bash
# Azure OpenAI credentials
export AZURE_OPENAI_API_KEY="your-azure-api-key"
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com"
export AZURE_OPENAI_DEPLOYMENT="gpt-4-deployment"

# Configuration using environment variables
{
  "ai": {
    "default_provider": "azure",
    "azure": {
      "api_key": "${AZURE_OPENAI_API_KEY}",
      "api_url": "${AZURE_OPENAI_ENDPOINT}",
      "deployment_name": "${AZURE_OPENAI_DEPLOYMENT}",
      "api_version": "2023-12-01-preview"
    }
  }
}
```

### Azure Government Cloud

```json
{
  "ai": {
    "azure": {
      "api_key": "your-gov-cloud-key",
      "api_url": "https://your-resource.openai.azure.us",
      "api_version": "2023-12-01-preview",
      "deployment_name": "gpt-4-gov-deployment",
      "cloud": "government"
    }
  }
}
```

## Ollama Configuration

### Basic Ollama Setup

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

### Complete Ollama Configuration

```json
{
  "ai": {
    "default_provider": "ollama",
    "ollama": {
      "model": "codellama:13b",
      "api_url": "http://localhost:11434",
      "temperature": 0.1,
      "num_predict": 2000,
      "timeout": 60000,
      "keep_alive": "5m"
    }
  }
}
```

### Popular Ollama Models for Code Review

#### Code Llama (Recommended for Code Analysis)
```json
{
  "ai": {
    "ollama": {
      "model": "codellama:13b",
      "temperature": 0.05,
      "num_predict": 2000
    }
  }
}
```

#### Llama 2 (General Purpose)
```json
{
  "ai": {
    "ollama": {
      "model": "llama2:13b",
      "temperature": 0.1,
      "num_predict": 1500
    }
  }
}
```

#### Mistral (Fast and Efficient)
```json
{
  "ai": {
    "ollama": {
      "model": "mistral:7b",
      "temperature": 0.2,
      "num_predict": 1000
    }
  }
}
```

#### Neural Chat (Conversational)
```json
{
  "ai": {
    "ollama": {
      "model": "neural-chat:7b",
      "temperature": 0.15,
      "num_predict": 1500
    }
  }
}
```

### Remote Ollama Server

```json
{
  "ai": {
    "ollama": {
      "model": "codellama:13b",
      "api_url": "http://ollama-server.company.com:11434",
      "timeout": 120000
    }
  }
}
```

### Ollama with Authentication

```json
{
  "ai": {
    "ollama": {
      "model": "codellama:13b",
      "api_url": "https://secure-ollama.company.com",
      "headers": {
        "Authorization": "Bearer your-token",
        "X-API-Key": "your-api-key"
      }
    }
  }
}
```

## GitHub Copilot Configuration

### Basic GitHub Copilot Setup

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

### Complete GitHub Copilot Configuration

```json
{
  "ai": {
    "default_provider": "copilot",
    "copilot": {
      "enabled": true,
      "use_cli": true,
      "timeout": 30000,
      "fallback_provider": "openai"
    }
  }
}
```

### Prerequisites for GitHub Copilot

```bash
# Install GitHub CLI
brew install gh

# Authenticate with GitHub
gh auth login

# Install GitHub Copilot CLI extension
gh extension install github/gh-copilot

# Enable Copilot aliases (optional)
echo 'eval "$(gh copilot alias -- zsh)"' >> ~/.zshrc
source ~/.zshrc
```

## Multi-Provider Setup

### Primary and Fallback Providers

```json
{
  "ai": {
    "default_provider": "openai",
    "fallback_provider": "ollama",
    "openai": {
      "api_key": "sk-your-openai-key",
      "default_model": "gpt-4"
    },
    "ollama": {
      "model": "codellama:13b",
      "api_url": "http://localhost:11434"
    }
  }
}
```

### Provider Selection by Context

```json
{
  "ai": {
    "provider_selection": {
      "small_files": "openai",
      "large_files": "ollama",
      "security_review": "azure",
      "performance_review": "copilot"
    },
    "openai": {
      "api_key": "sk-your-key",
      "default_model": "gpt-3.5-turbo"
    },
    "azure": {
      "api_key": "azure-key",
      "api_url": "https://your-resource.openai.azure.com",
      "deployment_name": "gpt-4-deployment"
    },
    "ollama": {
      "model": "codellama:13b"
    },
    "copilot": {
      "enabled": true
    }
  }
}
```

### Load Balancing Configuration

```json
{
  "ai": {
    "load_balancing": {
      "enabled": true,
      "strategy": "round_robin",
      "providers": ["openai", "azure", "ollama"],
      "health_check_interval": 60000
    },
    "openai": {
      "api_key": "sk-key-1",
      "weight": 3
    },
    "azure": {
      "api_key": "azure-key",
      "api_url": "https://resource.openai.azure.com",
      "weight": 2
    },
    "ollama": {
      "model": "codellama:13b",
      "weight": 1
    }
  }
}
```

## Provider-Specific Features

### OpenAI Features

```json
{
  "ai": {
    "openai": {
      "api_key": "sk-your-key",
      "default_model": "gpt-4",
      "features": {
        "function_calling": true,
        "json_mode": true,
        "vision": false,
        "streaming": false
      },
      "model_parameters": {
        "temperature": 0.1,
        "top_p": 0.9,
        "frequency_penalty": 0.0,
        "presence_penalty": 0.0
      }
    }
  }
}
```

### Azure OpenAI Features

```json
{
  "ai": {
    "azure": {
      "api_key": "azure-key",
      "api_url": "https://resource.openai.azure.com",
      "deployment_name": "gpt-4-deployment",
      "features": {
        "content_filtering": true,
        "private_endpoint": true,
        "managed_identity": false
      },
      "content_filter": {
        "hate": "medium",
        "self_harm": "medium",
        "sexual": "medium",
        "violence": "medium"
      }
    }
  }
}
```

### Ollama Features

```json
{
  "ai": {
    "ollama": {
      "model": "codellama:13b",
      "features": {
        "local_processing": true,
        "offline_capable": true,
        "custom_models": true
      },
      "model_parameters": {
        "temperature": 0.1,
        "top_k": 40,
        "top_p": 0.9,
        "repeat_penalty": 1.1
      },
      "system_prompt": "You are a code review expert. Focus on security, performance, and best practices."
    }
  }
}
```

## Troubleshooting

### Common Configuration Issues

#### OpenAI API Key Issues
```bash
# Test API key validity
curl -H "Authorization: Bearer sk-your-key" https://api.openai.com/v1/models

# Common error: Invalid API key
{
  "error": {
    "message": "Incorrect API key provided",
    "type": "invalid_request_error"
  }
}
```

#### Azure OpenAI Deployment Issues
```bash
# Test Azure deployment
curl -H "api-key: your-key" \
  "https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2023-12-01-preview"

# Common error: Deployment not found
{
  "error": {
    "code": "DeploymentNotFound",
    "message": "The API deployment for this resource does not exist."
  }
}
```

#### Ollama Connection Issues
```bash
# Test Ollama server
curl http://localhost:11434/api/tags

# Start Ollama if not running
ollama serve

# Pull required model
ollama pull codellama:13b
```

### Debug Configuration

```json
{
  "ai": {
    "debug": {
      "log_requests": true,
      "log_responses": false,
      "log_errors": true,
      "timeout_warnings": true
    }
  }
}
```

### Provider Health Checks

```bash
# Test all configured providers
nova debug test-providers

# Test specific provider
nova debug test-provider --provider openai

# Show provider status
nova debug provider-status
```

### Configuration Validation

```bash
# Validate AI configuration
nova config validate ai

# Test provider connectivity
nova config test-providers

# Show effective configuration
nova config show ai --resolved
```

This comprehensive guide covers all supported LLM providers and their configuration options, helping you set up the Enhanced Code Review Agent with the provider that best fits your needs and infrastructure requirements.