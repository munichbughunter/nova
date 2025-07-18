# Nova CLI Agent Infrastructure

A comprehensive foundation for building AI-powered agents that can interact with various services, execute tools, and leverage LLMs in the Nova CLI ecosystem.

## Overview

This module provides a modular, extensible architecture for creating intelligent agents that can:

- **Use Local or Remote LLMs**: Support for Ollama, OpenAI, and fallback modes
- **Execute Structured Tools**: Integration with Model Context Protocol (MCP) tools
- **Operate with Context**: Consistent runtime context across GitLab, GitHub, Jira, Confluence, etc.
- **Abstract Boilerplate**: Simplified agent development with common patterns
- **Provide Tool Wrappers**: Ready-to-use helpers for file operations and user interaction
- **Support Fallbacks**: Graceful degradation when LLMs are unavailable
- **Log Interactions**: Comprehensive logging and service injection support
- **Code Review Capabilities**: Enhanced code review with GitLab/GitHub integration

## Architecture

### Core Components

```
src/agents/
├── types.ts           # Core interfaces and types
├── base-agent.ts      # Abstract base class for all agents
├── llm-providers.ts   # LLM provider implementations
├── llm-factory.ts     # LLM provider factory and management
├── tool-wrappers.ts   # Tool wrappers for common operations
├── utils.ts           # Agent utilities and metrics
├── example-agent.ts   # Example implementation
└── index.ts           # Main exports
```

### Key Interfaces

- **`Agent`**: Core agent interface with execute() method
- **`AgentContext`**: Runtime context with services and configuration
- **`LLMProvider`**: Abstraction for different LLM services
- **`AgentResponse`**: Standardized response format with metadata

## Quick Start

### 1. Using the Example Agent

```typescript
import { createExampleAgent, createLLMProvider } from './agents/index.ts';

// Set up context with LLM provider
const llmProvider = await createLLMProvider(config);
const context = { 
  config, 
  logger, 
  mcpService, 
  llmProvider 
};

// Create and use the example agent
const agent = createExampleAgent(context);

// Analyze code
const response = await agent.execute('analyze src/main.ts');

// Ask questions
const response2 = await agent.execute('How do I handle errors in TypeScript?');
```

### 2. Creating a Custom Agent

```typescript
import { BaseAgent, notifyUser } from './agents/index.ts';
import type { AgentContext, AgentResponse, AgentConfig } from './agents/index.ts';

class CustomAgent extends BaseAgent {
  constructor(context: AgentContext) {
    const config: AgentConfig = {
      name: 'CustomAgent',
      description: 'My custom agent implementation',
      version: '1.0.0',
      mcpEnabled: true,
    };
    
    super(config, context);
  }

  async execute(input: string): Promise<AgentResponse> {
    try {
      // Use LLM for processing
      const result = await this.generateContent(input, {
        systemPrompt: "You are a helpful assistant",
        temperature: 0.7
      });

      // Notify user
      await notifyUser(this.context, {
        message: "Task completed successfully",
        type: "success"
      });

      return this.createResponse(true, result.content);
    } catch (error) {
      return this.createResponse(
        false, 
        "Failed to process request", 
        undefined, 
        error.message
      );
    }
  }
}
```

## Features

### LLM Provider Support

The infrastructure automatically detects and configures LLM providers:

```typescript
import { createLLMProvider } from './agents/index.ts';

// Auto-detects available providers (OpenAI, Ollama, or fallback)
const provider = await createLLMProvider(config);

// Use provider for content generation
const result = await provider.generate("Explain TypeScript generics");

// Use provider for structured output
const structured = await provider.generateObject({
  prompt: "Analyze this code",
  schema: MySchema
});
```

### Tool Wrappers

Ready-to-use wrappers for common operations:

```typescript
import { notifyUser, askUser, readFile, writeFile } from './agents/index.ts';

// User notifications
await notifyUser(context, {
  message: "Processing complete",
  type: "success"
});

// User prompts
const response = await askUser(context, {
  question: "Should I proceed with the changes?",
  type: "confirm"
});

// File operations
const content = await readFile(context, "/path/to/file.ts");
await writeFile(context, "/path/to/output.md", "# Results\n\nAnalysis complete");
```

### Project Metrics

Built-in project context gathering:

```typescript
import { getProjectMetrics, formatProjectMetrics } from './agents/index.ts';

const metrics = await getProjectMetrics(context, ['gitlab', 'jira']);
const formatted = formatProjectMetrics(metrics);

console.log(formatted);
// Output: GitLab: 5 open MRs, 12 issues | Jira: 3 in progress, 8 backlog
```

## Advanced Usage

### Structured Object Generation

Use Zod schemas for type-safe LLM responses:

```typescript
import { z } from 'zod';

const TaskAnalysisSchema = z.object({
  priority: z.enum(['low', 'medium', 'high']),
  estimatedHours: z.number(),
  dependencies: z.array(z.string()),
  risks: z.array(z.string())
});

class TaskAgent extends BaseAgent {
  async analyzeTask(description: string) {
    return await this.generateObject(
      `Analyze this task: ${description}`,
      TaskAnalysisSchema,
      { temperature: 0.3 }
    );
  }
}
```

### MCP Tool Integration

Execute MCP tools with error handling:

```typescript
class IntegrationAgent extends BaseAgent {
  async getJiraTicket(ticketId: string) {
    const result = await this.executeTool('f1e_jira_get_issue', {
      issueKey: ticketId
    });
    
    if (!result.success) {
      throw new Error(`Failed to fetch ticket: ${result.error}`);
    }
    
    return result.data;
  }
}
```

### Error Handling and Timeouts

Built-in patterns for robust execution:

```typescript
class RobustAgent extends BaseAgent {
  async execute(input: string): Promise<AgentResponse> {
    return await this.executeWithTimeout(
      async () => {
        // Long-running operation
        const result = await this.processComplexTask(input);
        return this.createResponse(true, result);
      },
      60000, // 60 second timeout
      'complex task processing'
    );
  }
}
```

## Configuration

### LLM Provider Setup

Configure providers in your Nova config:

```typescript
// For OpenAI
const config = {
  llm: {
    provider: 'openai',
    apiKey: 'your-api-key',
    model: 'gpt-4'
  }
};

// For Ollama
const config = {
  llm: {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama2'
  }
};
```

### Agent Configuration

Customize agent behavior:

```typescript
const agentConfig: AgentConfig = {
  name: 'MyAgent',
  description: 'Custom development assistant',
  version: '1.0.0',
  mcpEnabled: true,
  llmProvider: 'openai',
  defaultModel: 'gpt-4',
  tools: ['f1e_jira_search', 'f1e_gitlab_search'],
  context: {
    maxFileSize: 100000,
    supportedLanguages: ['typescript', 'javascript', 'python']
  }
};
```

## Best Practices

### 1. Agent Design
- **Single Responsibility**: Each agent should have a focused purpose
- **Composability**: Use tool wrappers and utilities for common tasks
- **Error Handling**: Always wrap operations in try-catch blocks
- **Logging**: Use the provided logger for debugging and monitoring

### 2. LLM Usage
- **Appropriate Temperature**: Use lower values (0.1-0.3) for analytical tasks, higher (0.7-0.9) for creative tasks
- **System Prompts**: Provide clear context and role definition
- **Structured Output**: Use Zod schemas for consistent, type-safe responses
- **Token Management**: Be mindful of token limits for large inputs

### 3. Tool Integration
- **Graceful Degradation**: Handle cases where MCP tools are unavailable
- **Parameter Validation**: Validate tool parameters before execution
- **Result Checking**: Always check tool execution results for success
- **Context Passing**: Include relevant context when executing tools

### 4. User Experience
- **Progress Notifications**: Keep users informed of long-running operations
- **Clear Error Messages**: Provide actionable error information
- **Helpful Responses**: Structure responses for easy reading and understanding
- **Interactive Prompts**: Use askUser for confirmations and choices

## Testing

The agent infrastructure includes comprehensive error handling and fallback mechanisms. Test your agents with:

```typescript
// Test with fallback provider (no LLM required)
const mockContext: AgentContext = {
  config,
  logger,
  mcpService,
  llmProvider: new FallbackProvider()
};

const agent = new MyAgent(mockContext);
const response = await agent.execute("test input");
```

## Enhanced Code Review Agent

The Enhanced Code Review Agent extends the base agent infrastructure to provide comprehensive code review capabilities with three distinct modes:

### Review Modes

#### 1. File Review Mode
Review specific files with detailed analysis:

```bash
# Review a single file
nova agent enhanced-code-review-agent review src/main.ts

# Review multiple files
nova agent enhanced-code-review-agent review src/main.ts src/utils.ts

# Alternative syntax (review is implied for file paths)
nova agent enhanced-code-review-agent src/main.ts
```

#### 2. Change Detection Mode
Automatically detect and review changed files in your Git repository:

```bash
# Review all changed files
nova agent enhanced-code-review-agent review

# Alternative syntax
nova agent enhanced-code-review-agent review changes
```

#### 3. Pull Request Review Mode
Review pull requests from GitLab or GitHub with automated comment posting:

```bash
# Review pull requests (auto-detects GitLab/GitHub)
nova agent enhanced-code-review-agent review pr

# Review specific PR by ID
nova agent enhanced-code-review-agent review pr 123
```

### Review Output

The agent provides structured review results in a CLI table format:

```
┌─────────────────────┬───────┬──────────┬──────────────┬────────┬─────────┐
│ File                │ Grade │ Coverage │ Tests Present│ Value  │ State   │
├─────────────────────┼───────┼──────────┼──────────────┼────────┼─────────┤
│ src/main.ts         │ A     │ 85%      │ ✅           │ high   │ pass    │
│ src/utils.ts        │ B     │ 70%      │ ✅           │ medium │ warning │
│ src/config.ts       │ C     │ 45%      │ ❌           │ low    │ fail    │
└─────────────────────┴───────┴──────────┴──────────────┴────────┴─────────┘
```

### Configuration

Configure the Enhanced Code Review Agent in your Nova config:

```typescript
// config.json
{
  "github": {
    "token": "ghp_your_github_token",
    "apiUrl": "https://api.github.com"
  },
  "review": {
    "autoPostComments": true,
    "severityThreshold": "medium",
    "maxFilesPerReview": 50
  }
}
```

#### GitHub Integration Setup

1. **Generate a GitHub Personal Access Token**:
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Generate a new token with `repo` and `pull_requests` scopes
   - Add the token to your Nova configuration

2. **Configure API URL** (optional):
   - For GitHub Enterprise, set a custom `apiUrl`
   - Default is `https://api.github.com` for GitHub.com

#### Review Configuration Options

- **`autoPostComments`** (boolean, default: `true`): Automatically post review comments to PRs
- **`severityThreshold`** (string, default: `"medium"`): Minimum severity level for issues to report
- **`maxFilesPerReview`** (number, default: `50`): Maximum number of files to review in a single operation

### Features

#### Comprehensive Analysis
- **Code Quality Grading**: A-F grading system based on code quality metrics
- **Test Coverage Assessment**: Estimates test coverage and identifies untested code
- **Security Analysis**: Detects potential security vulnerabilities
- **Performance Review**: Identifies performance optimization opportunities
- **Best Practices**: Checks adherence to coding standards and clean code principles

#### Repository Integration
- **Automatic Detection**: Detects GitLab vs GitHub repositories automatically
- **Pull Request Integration**: Fetches PRs and posts review comments directly
- **Git Integration**: Analyzes only changed files for efficient reviews
- **Comment Posting**: Posts structured review comments with line-specific feedback

#### Performance Optimizations
- **Parallel Processing**: Analyzes multiple files concurrently
- **Intelligent Caching**: Caches analysis results for unchanged files
- **Streaming Support**: Handles large diffs efficiently
- **Rate Limiting**: Respects API rate limits with exponential backoff

### Error Handling

The agent includes comprehensive error handling:

```typescript
// Automatic retry with exponential backoff
// Graceful degradation when services are unavailable
// Clear error messages with actionable solutions
// Fallback to local analysis when API calls fail
```

### Usage Examples

#### Basic File Review
```bash
# Review TypeScript files
nova agent enhanced-code-review-agent review src/**/*.ts

# Review with help
nova agent enhanced-code-review-agent help
```

#### Change Detection Workflow
```bash
# Make changes to your code
git add .
git commit -m "Add new feature"

# Review the changes
nova agent enhanced-code-review-agent review
```

#### Pull Request Workflow
```bash
# Create a pull request on GitHub/GitLab
# Then review it locally
nova agent enhanced-code-review-agent review pr

# The agent will:
# 1. Detect your repository type (GitHub/GitLab)
# 2. Fetch available pull requests
# 3. Let you select which PR to review
# 4. Analyze the PR diff
# 5. Post review comments automatically
# 6. Display results locally
```

### Troubleshooting

#### Common Issues

**Authentication Errors**:
```bash
# Error: GitHub authentication failed
# Solution: Check your GitHub token in the config
nova config set github.token "your_token_here"
```

**Repository Not Detected**:
```bash
# Error: Unable to detect repository type
# Solution: Ensure you're in a Git repository with a remote
git remote -v
git remote add origin https://github.com/user/repo.git
```

**API Rate Limits**:
```bash
# Error: API rate limit exceeded
# Solution: The agent will automatically retry with backoff
# Or wait for the rate limit to reset
```

**File Not Found**:
```bash
# Error: File not found
# Solution: Check file paths and permissions
ls -la src/main.ts
```

#### Debug Mode

Enable debug logging for troubleshooting:

```bash
NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/main.ts
```

## Integration with Nova CLI

Agents integrate seamlessly with Nova's MCP infrastructure:

```bash
# Start MCP server
nova mcp server

# Your agent can now use MCP tools like:
# - f1e_jira_search
# - f1e_gitlab_search  
# - f1e_confluence_search
# - f1e_read_file
# - f1e_write_file
```

## Contributing

When extending the agent infrastructure:

1. **Add New Tool Wrappers**: Follow the pattern in `tool-wrappers.ts`
2. **Extend LLM Providers**: Implement the `LLMProvider` interface
3. **Add Utilities**: Place common functionality in `utils.ts`
4. **Update Types**: Extend interfaces in `types.ts` as needed
5. **Document Changes**: Update this README and add example usage

## License

This agent infrastructure is part of the Nova CLI project and follows the same licensing terms.
