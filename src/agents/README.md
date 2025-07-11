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
