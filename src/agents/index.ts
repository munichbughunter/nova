/**
 * Nova CLI Agent Infrastructure
 * 
 * This module provides a comprehensive foundation for building AI-powered agents
 * that can interact with various services, execute tools, and leverage LLMs.
 */

// Core Types and Interfaces
export type {
    Agent,
    AgentContext,
    AgentResponse,
    AgentExecuteOptions,
    AgentConfig,
    CreateAgentOptions,
    UserNotification,
    UserQuestion,
    UserResponse,
    FileReadOptions,
    FileWriteOptions,
    FileOperation,
    ProjectMetrics,
    LLMGenerateOptions,
    GenerateObjectOptions,
} from './types.ts';

// Base Agent Class
export { BaseAgent } from './base-agent.ts';

// LLM Provider Infrastructure
export type {
    LLMProvider,
    LLMChatOptions,
} from './llm-providers.ts';

export {
    OllamaProvider,
    OpenAIProvider,
    FallbackProvider,
} from './llm-providers.ts';

// LLM Factory and Management
export {
    createLLMProvider,
    getProviderRecommendations,
    validateLLMConfig,
    testLLMProvider,
} from './llm-factory.ts';

// Tool Wrappers
export {
    notifyUser,
    askUser,
    readFile,
    writeFile,
    performFileOperation,
} from './tool-wrappers.ts';

// Agent Utilities
export {
    getAgentHelp,
    getProjectMetrics,
    formatProjectMetrics,
} from './utils.ts';

// Example Agent Implementation
export { ExampleAgent, createExampleAgent } from './example-agent.ts';

/**
 * Quick Start Examples:
 * 
 * **Creating a Custom Agent:**
 * ```typescript
 * import { BaseAgent, createLLMProvider, notifyUser } from '@nova/agents';
 * 
 * class MyAgent extends BaseAgent {
 *   async execute(input: string): Promise<AgentResponse> {
 *     // Use LLM to process input
 *     const result = await this.generateContent(input, {
 *       systemPrompt: "You are a helpful assistant",
 *       temperature: 0.7
 *     });
 * 
 *     // Notify user of progress
 *     await notifyUser(this.context, {
 *       message: "Processing complete",
 *       type: "success"
 *     });
 * 
 *     return this.createResponse(true, result.content);
 *   }
 * }
 * 
 * // Create agent with auto-detected LLM provider
 * const llmProvider = await createLLMProvider(config);
 * const agent = new MyAgent(agentConfig, { 
 *   ...context, 
 *   llmProvider 
 * });
 * ```
 * 
 * **Using the Example Agent:**
 * ```typescript
 * import { createExampleAgent, createLLMProvider } from '@nova/agents';
 * 
 * // Set up context with LLM provider
 * const llmProvider = await createLLMProvider(config);
 * const context = { 
 *   config, 
 *   logger, 
 *   mcpService, 
 *   llmProvider 
 * };
 * 
 * // Create and use the example agent
 * const agent = createExampleAgent(context);
 * 
 * // Analyze code
 * const response = await agent.execute('analyze src/main.ts');
 * 
 * // Ask questions
 * const response2 = await agent.execute('How do I handle errors in TypeScript?');
 * ```
 */

/**
 * Agent Development Guidelines:
 * 
 * 1. **Extend BaseAgent**: Always inherit from BaseAgent for consistent functionality
 * 2. **Use Tool Wrappers**: Leverage provided tool wrappers for user interaction and file operations
 * 3. **LLM Integration**: Use generateContent() and generateObject() for AI capabilities
 * 4. **Error Handling**: Wrap operations in try-catch and use createResponse() for consistent outputs
 * 5. **Logging**: Use the inherited logger for debugging and monitoring
 * 6. **MCP Tools**: Use executeTool() for Model Context Protocol integrations
 * 
 * Key Features:
 * - Automatic LLM provider detection and fallback
 * - Structured object generation with Zod schemas
 * - Built-in tool execution with error handling
 * - User interaction helpers (notifications, prompts)
 * - File system operations with safety checks
 * - Project metrics and context gathering
 * - Service integration support (GitLab, Jira, etc.)
 */
