import { createAzure } from '@ai-sdk/azure';
import { ollama } from '@ai-sdk/ollama';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject as generateObjectAi, generateText, type LanguageModel, tool } from 'ai';
import { z } from 'zod';
import { Config } from '../config/types.ts';
import { MCPService } from '../services/mcp_service.ts';
import { LLMProvider, MCPToolContext, MCPToolResult } from '../types/tool_types.ts';
import { theme } from '../utils.ts';
import { Logger } from '../utils/logger.ts';
import { ToolService } from './tool_service.ts';

// Custom type for AI messages
type AIMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export interface AIServiceOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface AIResponse {
  issues?: Array<{
    severity: string;
    message: string;
    explanation?: string;
    suggestion: string;
    line?: number | string;
    column?: number;
    code?: string;
    perspective?: string;
  }>;
  recommendations?: Array<
    string | {
      title: string;
      description: string;
      perspective?: string;
    }
  >;
  [key: string]: unknown;
}

interface CodeAnalysis {
  issues: Array<{
    severity: 'high' | 'medium' | 'low';
    message: string;
    explanation?: string;
    suggestion?: string;
    line?: number | string;
    column?: number;
    code?: string;
  }>;
  recommendations: string[];
  summary?: string;
  metrics?: Record<string, number>;
}

interface StepResult {
  role: 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface GenerateTextResult {
  text: string;
  steps?: Array<StepResult>;
}

export class AIService {
  private static instance: AIService | null = null;
  private temperature: number;
  private maxTokens: number;
  private config: Config;
  private logger: Logger;
  public provider: 'nova' | 'openai' | 'azure' | 'ollama';
  public languageModel: LanguageModel;
  public model: string;
  private mcpContext: MCPToolContext | null;

  /**
   * Sanitize a JSON string by removing JavaScript comments and other invalid JSON syntax
   * @param jsonString The JSON string to sanitize
   * @returns A sanitized JSON string ready for parsing
   */
  private sanitizeJsonString(jsonString: string): string {
    try {
      // Remove single-line comments (// ...)
      jsonString = jsonString.replace(/\/\/.*$/gm, '');

      // Remove multi-line comments (/* ... */)
      jsonString = jsonString.replace(/\/\*[\s\S]*?\*\//gm, '');

      // Replace trailing commas in objects and arrays
      jsonString = jsonString.replace(/,(\s*[\]}])/g, '$1');

      return jsonString;
    } catch (error) {
      this.logger.debug('Error sanitizing JSON string:', error);
      return jsonString; // Return original if sanitization fails
    }
  }

  constructor(
    config: Config,
    options: AIServiceOptions = {},
    mcpContext: MCPToolContext | null = null,
  ) {
    this.config = config;
    this.temperature = options.temperature || 0.7;
    this.maxTokens = options.maxTokens || 2000;
    this.logger = new Logger('AI', Deno.env.get('nova_DEBUG') === 'true');
    this.mcpContext = mcpContext;
    // Determine which AI provider to use based on config and default_provider
    const defaultProvider = this.config.ai?.default_provider;

    if (defaultProvider === 'nova' && this.config.ai?.nova?.api_key) {
      this.provider = 'nova';
      this.model = this.config.ai.nova.default_model;
      const novaConfig = this.config.ai.nova;

      // Create OpenAI-compatible client pointing to nova LLM Gateway
      const novaClient = createOpenAI({
        apiKey: novaConfig.api_key,
        baseURL: novaConfig.api_url,
      });

      this.languageModel = novaClient(this.model);
    } else if (defaultProvider === 'openai' && this.config.ai?.openai?.api_key) {
      this.provider = 'openai';
      this.model = options.model || this.config.ai.openai.default_model;
      const openaiConfig = this.config.ai.openai;

      // Set environment variables for OpenAI (maintain compatibility)
      Deno.env.set('OPENAI_API_KEY', openaiConfig.api_key);
      if (openaiConfig.api_url) {
        Deno.env.set('OPENAI_API_BASE', openaiConfig.api_url);
      }
      if (openaiConfig.api_version) {
        Deno.env.set('OPENAI_API_VERSION', openaiConfig.api_version);
      }

      // Create OpenAI client with direct configuration
      const openaiClient = createOpenAI({
        apiKey: openaiConfig.api_key,
        baseURL: openaiConfig.api_url,
      });

      this.languageModel = openaiClient(this.model);
    } else if (defaultProvider === 'azure' && this.config.ai?.azure?.api_key) {
      this.provider = 'azure';
      const azureConfig = this.config.ai.azure;
      this.model = azureConfig.deployment_name;

      // Extract resource name from the API URL
      const resourceName = azureConfig.api_url.match(/https:\/\/([^.]+)\./)?.[1] || 'aicp-prod-sc';

      // Set environment variables for Azure
      Deno.env.set('AZURE_OPENAI_API_KEY', azureConfig.api_key);
      Deno.env.set('AZURE_OPENAI_API_ENDPOINT', azureConfig.api_url);
      Deno.env.set('AZURE_OPENAI_API_VERSION', azureConfig.api_version);

      // Initialize Azure OpenAI language model
      const azureClient = createAzure({
        resourceName,
        apiKey: azureConfig.api_key,
      });
      this.languageModel = azureClient(azureConfig.deployment_name);
    } else if (defaultProvider === 'ollama' && this.config.ai?.ollama?.model) {
      this.provider = 'ollama';
      const ollamaConfig = this.config.ai.ollama;
      this.model = ollamaConfig.model;
      // Set environment variable for Ollama
      if (ollamaConfig.api_url) {
        Deno.env.set('OLLAMA_API_HOST', ollamaConfig.api_url);
      }
      this.languageModel = ollama(this.model);
    } else if (this.config.ai?.nova?.api_key) {
      // Fallback to Nova if available
      this.provider = 'nova';
      this.model = this.config.ai.nova.default_model;
      const novaConfig = this.config.ai.nova;

      // Create OpenAI-compatible client pointing to Nova LLM Gateway
      const novaClient = createOpenAI({
        apiKey: novaConfig.api_key,
        baseURL: novaConfig.api_url,
      });

      this.languageModel = novaClient(this.model);
    } else if (this.config.ai?.ollama?.model) {
      // Fallback to Ollama if available
      this.provider = 'ollama';
      const ollamaConfig = this.config.ai.ollama;
      this.model = ollamaConfig.model;
      // Set environment variable for Ollama
      if (ollamaConfig.api_url) {
        Deno.env.set('OLLAMA_API_HOST', ollamaConfig.api_url);
      }
      this.languageModel = ollama(this.model);
    } else {
      throw new Error("No AI provider configured. Please run 'nova setup' first.");
    }
  }

  public static getInstance(config?: Config, options?: AIServiceOptions): AIService {
    if (!AIService.instance) {
      if (!config) {
        throw new Error('Config is required when initializing AIService');
      }
      AIService.instance = new AIService(config, options);
    }
    return AIService.instance;
  }

  async generateText(
    prompt: string,
    options: {
      tools?: Record<string, ReturnType<typeof tool>>;
      maxSteps?: number;
      toolChoice?: 'none' | 'auto' | 'required';
      messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    } = {},
  ): Promise<GenerateTextResult> {
    this.logger.debug('\nGenerating text with options:', {
      hasTools: !!options.tools,
      toolNames: options.tools ? Object.keys(options.tools) : [],
      maxSteps: options.maxSteps,
      toolChoice: options.toolChoice,
      messageCount: options.messages?.length,
    });

    // If messages are provided, use them instead of prompt
    const params = options.messages
      ? {
        model: this.languageModel,
        messages: options.messages,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        tools: options.tools,
        toolChoice: options.toolChoice,
        maxSteps: options.maxSteps,
      }
      : {
        model: this.languageModel,
        prompt,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        tools: options.tools,
        toolChoice: options.toolChoice,
        maxSteps: options.maxSteps,
      };

    try {
      this.logger.debug('Calling generateText with params:', {
        model: this.model,
        messageCount: params.messages?.length,
        hasTools: !!params.tools,
        toolChoice: params.toolChoice,
        maxSteps: params.maxSteps,
      });

      const result = await generateText(params);

      if (typeof result === 'string') {
        this.logger.debug('Received string result');
        return { text: result };
      }

      this.logger.debug('Received structured result:', {
        hasText: !!result.text,
        stepCount: result.steps?.length,
        firstStep: result.steps?.[0],
      });

      return {
        text: result.text,
        steps: result.steps?.map((step) => ({
          // @ts-ignore - TODO: fix this
          role: step.role || 'assistant',
          // @ts-ignore - TODO: fix this
          content: step.content || '',
          // @ts-ignore - TODO: fix this
          tool_calls: step.toolCalls?.map((call: ToolCallResult) => ({
            id: call.toolCallId,
            type: 'function',
            function: {
              name: call.toolName,
              arguments: JSON.stringify(call.args),
            },
          })),
        })),
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Error in generateText:', error.message);
        throw error;
      }
      throw new Error('Unknown error in generateText');
    }
  }

  formatToolResponse(data: Record<string, unknown>): string {
    // Format tool response for display
    const { result, error } = data as { result?: unknown; error?: string };
    if (error) {
      return `Error: ${error}`;
    }

    if (typeof result === 'string') {
      return result;
    }

    return JSON.stringify(result, null, 2);
  }

  async generateWithTools<T>(
    options: {
      model: LanguageModel;
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
      schema: z.ZodType<T>;
      maxSteps?: number;
      tools?: Record<string, ReturnType<typeof tool>>;
      toolChoice?: 'none' | 'auto' | 'required';
    },
  ): Promise<{ result: T; steps?: Array<StepResult> }> {
    this.logger.passThrough('log', theme.header('\n🤖 Processing with Tools'));
    this.logger.passThrough(
      'log',
      theme.dim('💭 Analyzing request and selecting appropriate tools...'),
    );

    try {
      this.logger.passThrough('log', theme.dim('🔄 Executing tool operations...'));

      // Use the default languageModel instead of passing it as an option
      const { text, steps } = await this.generateText('', {
        tools: options.tools || {},
        maxSteps: options.maxSteps || 3,
        toolChoice: options.toolChoice || 'auto',
        messages: options.messages,
      });

      this.logger.passThrough('log', theme.dim('📝 Processing tool response...'));

      // Extract the first valid JSON object from the response
      const jsonMatch = text.match(/\{(?:[^{}]|(\{[^{}]*\}))*\}/);
      if (!jsonMatch) {
        this.logger.passThrough('log', theme.warning('⚠️ No structured data found in response'));
        throw new Error('No structured data found in response');
      }

      try {
        // Sanitize the JSON string to remove comments and fix common issues
        const sanitizedJson = this.sanitizeJsonString(jsonMatch[0]);

        // Parse the sanitized JSON from the response
        const jsonData = JSON.parse(sanitizedJson);

        // Validate against the schema
        const validatedData = options.schema.parse(jsonData);

        return {
          result: validatedData,
          steps,
        };
      } catch (parseError) {
        this.logger.passThrough('log', theme.error('❌ Failed to parse response'));
        this.logger.error('Parse error:', parseError);
        throw new Error(
          `Failed to parse response: ${
            parseError instanceof Error ? parseError.message : String(parseError)
          }`,
        );
      }
    } catch (error) {
      this.logger.error('\nError generating response with tools:', error);
      throw new Error(
        `Failed to generate response with tools: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Helper method to create a default response based on schema
  private createDefaultResponse<T>(
    schema: z.ZodType<T>,
    existingData: Record<string, unknown> = {},
  ): Record<string, unknown> {
    // @ts-ignore - We need to access the shape
    const schemaShape = schema.shape || {};
    const defaultResponse: Record<string, unknown> = {};

    for (const [key, fieldSchema] of Object.entries(schemaShape)) {
      // Use existing value if present and valid
      if (existingData[key] !== undefined && existingData[key] !== null) {
        defaultResponse[key] = existingData[key];
        continue;
      }

      // Determine default value based on schema type
      if (fieldSchema instanceof z.ZodString) {
        defaultResponse[key] = '';
      } else if (fieldSchema instanceof z.ZodNumber) {
        defaultResponse[key] = 0;
      } else if (fieldSchema instanceof z.ZodBoolean) {
        defaultResponse[key] = false;
      } else if (fieldSchema instanceof z.ZodArray) {
        defaultResponse[key] = [];
      } else if (fieldSchema instanceof z.ZodObject) {
        defaultResponse[key] = {};
      } else if (fieldSchema instanceof z.ZodEnum) {
        const options = fieldSchema.options;
        defaultResponse[key] = options[0];
      } else if (fieldSchema instanceof z.ZodNullable) {
        defaultResponse[key] = null;
      } else if (fieldSchema instanceof z.ZodOptional) {
        defaultResponse[key] = undefined;
      } else {
        // For unknown types, use null as a safe default
        defaultResponse[key] = null;
      }
    }

    return defaultResponse;
  }

  // Helper method to create a complete response with default values
  private createCompleteResponse<T>(
    schema: z.ZodType<T>,
    partialData: Record<string, unknown>,
  ): Record<string, unknown> {
    // @ts-ignore - We need to access the shape
    const schemaShape = schema.shape || {};
    const completeResponse: Record<string, unknown> = { ...partialData };

    // Add default values for missing required fields
    for (const [key, fieldSchema] of Object.entries(schemaShape)) {
      if (completeResponse[key] === undefined) {
        if (fieldSchema instanceof z.ZodString) {
          completeResponse[key] = '';
        } else if (fieldSchema instanceof z.ZodBoolean) {
          completeResponse[key] = false;
        } else if (fieldSchema instanceof z.ZodEnum) {
          completeResponse[key] = fieldSchema.options[0];
        } else if (fieldSchema instanceof z.ZodArray) {
          completeResponse[key] = [];
        } else if (fieldSchema instanceof z.ZodObject) {
          completeResponse[key] = {};
        } else if (fieldSchema instanceof z.ZodNumber) {
          completeResponse[key] = 0;
        }
      }
    }

    return completeResponse;
  }

  async generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    systemPrompt?: string,
  ): Promise<T> {
    const messages: AIMessage[] = [];
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content:
          `${systemPrompt}\n\nYou must respond with a valid JSON object that conforms to the required schema.`,
      });
    } else {
      messages.push({
        role: 'system',
        content:
          'You are a JSON-only response AI. Your task is to analyze the following and respond with a valid JSON object.',
      });
    }
    messages.push({ role: 'user', content: prompt });

    this.logger.passThrough('log', theme.dim('\n🤖 Generating structured response...'));
    this.logger.debug('\nGenerating structured response');
    this.logger.debug('Using schema type:', schema.description || 'No description available');
    this.logger.debug('\n[DEBUG] Messages:', JSON.stringify(messages, null, 2));

    try {
      // Create options with default required properties
      const options = {
        model: this.languageModel,
        messages,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        // deno-lint-ignore no-explicit-any
        schema: schema as any, // Fix type recursion with 'any'
      };

      // Add experimental_repairToolCall only if using a provider that supports it
      if (this.provider === 'openai' || this.provider === 'azure' || this.provider === 'ollama') {
        // deno-lint-ignore no-explicit-any
        (options as any).experimental_repairToolCall = async ({
          toolCall,
          _tools,
          parameterSchema,
          error,
        }: {
          toolCall: { args: string };
          _tools: Record<string, unknown>;
          parameterSchema: z.ZodType<unknown>;
          error: Error;
        }) => {
          this.logger.debug('Tool repair triggered:', toolCall, error);

          // Try to repair the tool call
          try {
            const repairedArgs = await this.repairInvalidResponse(
              JSON.parse(toolCall.args),
              parameterSchema,
              { type: 'tool' },
            );

            return { ...toolCall, args: JSON.stringify(repairedArgs) };
          } catch (repairError) {
            this.logger.error('Failed to repair tool call:', repairError);
            throw error; // Re-throw the original error if repair fails
          }
        };
      }

      // deno-lint-ignore no-explicit-any
      const result = await generateObjectAi(options as any);

      this.logger.passThrough('log', theme.success('✓ Response generated successfully'));
      this.logger.debug('\n[DEBUG] Generated response:');
      this.logger.debug(JSON.stringify(result, null, 2));
      return result.object as unknown as T;
    } catch (error) {
      this.logger.error('Error generating object:', error);
      throw error;
    }
  }

  private transformResponse(response: AIResponse): AIResponse {
    const transformed: AIResponse = { ...response };

    // Transform issues if they exist
    if (transformed.issues && response.issues) {
      transformed.issues = response.issues.map((issue) => ({
        severity: issue.severity,
        message: issue.message,
        explanation: issue.explanation,
        suggestion: issue.suggestion,
        line: issue.line,
        column: issue.column,
        code: issue.code,
        perspective: issue.perspective,
      }));
    }

    // Transform recommendations if they exist
    if (transformed.recommendations && response.recommendations) {
      transformed.recommendations = response.recommendations.map((rec) => {
        if (typeof rec === 'string') {
          return rec;
        }
        return {
          title: rec.title,
          description: rec.description,
          perspective: rec.perspective,
        };
      });
    }

    return transformed;
  }

  private parseMarkdownResponse(text: string): AIResponse | Record<string, unknown> | null {
    try {
      // First try parsing as AIResponse
      const aiResponse = this.parseAIResponse(text);
      if (aiResponse) {
        return aiResponse;
      }

      // If that fails, try parsing as key-value pairs
      const lines = text.split('\n');
      const result: Record<string, unknown> = {};

      for (const line of lines) {
        // Look for markdown-style key-value pairs (e.g., "- key: value" or "* key: value")
        const match = line.match(/^[-*]\s*([^:]+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          result[key.trim()] = value.trim();
        }
      }

      return Object.keys(result).length > 0 ? result : null;
    } catch (error) {
      this.logger.debug('\nFailed to parse markdown response:');
      this.logger.debug(error);
      return null;
    }
  }

  private parseAIResponse(text: string): AIResponse | null {
    try {
      const result: AIResponse = {
        issues: [],
        recommendations: [],
      };

      // Extract summary
      const summaryMatch = text.match(/\*\*Summary\*\*(.*?)(?=\*\*|$)/s);
      if (summaryMatch) {
        result.summary = summaryMatch[1].trim();
      }

      // Extract issues
      const issuesMatch = text.match(/\*\*Issues Found\*\*(.*?)(?=\*\*|$)/s);
      if (issuesMatch) {
        const issuesText = issuesMatch[1];
        const issues = issuesText.match(
          /\d+\.\s+\*\*(.*?)\*\*\s*\*\s*Severity:\s*(.*?)\s*\*\s*Explanation:\s*(.*?)\s*\*\s*Suggestion:\s*(.*?)(?=\d+\.|$)/gs,
        );
        if (issues) {
          result.issues = issues.map((issue) => {
            const [, message, severity, explanation, suggestion] = issue.match(
              /\d+\.\s+\*\*(.*?)\*\*\s*\*\s*Severity:\s*(.*?)\s*\*\s*Explanation:\s*(.*?)\s*\*\s*Suggestion:\s*(.*?)$/s,
            ) || [];
            return {
              severity: severity?.toLowerCase().includes('high')
                ? 'high'
                : severity?.toLowerCase().includes('medium')
                ? 'medium'
                : 'low',
              message: message?.trim() || '',
              explanation: explanation?.trim() || '',
              suggestion: suggestion?.trim() || '',
            };
          });
        }
      }

      // Extract recommendations
      const recommendationsMatch = text.match(/\*\*Recommendations.*?\*\*(.*?)(?=\*\*|$)/s);
      if (recommendationsMatch) {
        const recommendations = recommendationsMatch[1].match(/\d+\.\s+(.*?)(?=\d+\.|$)/gs);
        if (recommendations) {
          result.recommendations = recommendations.map((rec) =>
            rec.replace(/^\d+\.\s+/, '').trim()
          );
        }
      }

      return result;
    } catch (error) {
      this.logger.debug('\n[DEBUG] Failed to parse markdown response:');
      this.logger.debug(error);
      return null;
    }
  }

  async generateStructuredAnalysis<T>(
    content: string,
    schema: z.ZodType<T>,
    systemPrompt: string,
    analysisPrompt: string,
  ): Promise<T> {
    this.logger.debug('\nStarting structured analysis');
    this.logger.debug('System prompt length:', systemPrompt.length);
    this.logger.debug('Analysis prompt length:', analysisPrompt.length);
    this.logger.debug('Content length:', content.length);

    const prompt = `
Content to analyze:
\`\`\`
${content}
\`\`\`

${analysisPrompt}
`;

    this.logger.debug('\nCombined prompt length:', prompt.length);
    this.logger.debug('Sending to AI service...');

    return await this.generateObject(prompt, schema, systemPrompt);
  }

  async analyzeCode(
    code: string,
    options: {
      language?: string;
      context?: string;
      purpose?: string;
    } = {},
  ): Promise<CodeAnalysis> {
    const analysis = await this.analyze(code, {
      language: options.language,
      context: options.context,
      purpose: options.purpose,
    });

    return analysis as CodeAnalysis;
  }

  async analyze(
    code: string,
    options: {
      language?: string;
      context?: string;
      purpose?: string;
    } = {},
  ): Promise<CodeAnalysis> {
    const language = options.language || 'typescript';
    const context = options.context || '';
    const purpose = options.purpose || 'code review';

    const prompt = `
    Analyze the following ${language} code${context ? ` (${context})` : ''}:
    
    \`\`\`${language}
    ${code}
    \`\`\`
    
    Purpose: ${purpose}
    
    Provide a structured analysis with:
    1. Issues (severity, message, line number if applicable, and suggested fix)
    2. Recommendations for improvement
    3. Brief summary of the code
    `;

    const schema = z.object({
      issues: z.array(z.object({
        severity: z.enum(['high', 'medium', 'low']),
        message: z.string(),
        explanation: z.string().optional(),
        suggestion: z.string().optional(),
        line: z.union([z.number(), z.string()]).optional(),
        column: z.number().optional(),
        code: z.string().optional(),
      })),
      recommendations: z.array(z.string()),
      summary: z.string().optional(),
      metrics: z.record(z.string(), z.number()).optional(),
    });

    try {
      return await this.generateObject(prompt, schema);
    } catch (error) {
      this.logger.error('Error analyzing code:', error);
      return {
        issues: [],
        recommendations: [],
        summary: 'Error analyzing code',
      };
    }
  }

  async generateChatResponse<T>(
    message: string,
    schema: z.ZodType<T>,
    context?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      tools?: Record<string, ReturnType<typeof tool>>;
      maxSteps?: number;
      toolChoice?: 'none' | 'auto' | 'required';
    },
  ): Promise<T> {
    this.logger.debug('\nGenerating chat response');
    this.logger.debug('Message:', message);
    this.logger.debug('Context length:', context?.length || 0);

    const defaultSystemPrompt =
      `You are a helpful AI assistant that generates structured chat responses.
      Your response must be a valid JSON object that matches the expected schema.
      Always respond in a clear, concise, and helpful manner.
      If you don't know something, admit it rather than making things up.
      Format your response as a single JSON object without any additional text.`;

    // Construct messages array with proper types
    const messages: AIMessage[] = [];

    // Add system prompt
    messages.push({
      role: 'system',
      content: options?.systemPrompt || defaultSystemPrompt,
    });

    // Add context if available
    if (context) {
      messages.push(...context.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      })));
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // If tools are provided, use generateWithTools
    if (options?.tools) {
      try {
        const { result } = await this.generateWithTools({
          model: this.languageModel, // Use the actual language model instance
          messages,
          schema,
          maxSteps: options.maxSteps,
          tools: options.tools,
          toolChoice: options.toolChoice,
        });
        return result;
      } catch (error) {
        this.logger.error('Error generating with tools:', error);
        // Fall back to standard generateObject if tools approach fails
        this.logger.passThrough(
          'log',
          theme.warning('⚠️ Falling back to standard object generation'),
        );
        return this.generateObject(
          message,
          schema,
          options?.systemPrompt || defaultSystemPrompt,
        );
      }
    }

    // Otherwise, use regular generateObject
    return this.generateObject(
      message,
      schema,
      options?.systemPrompt || defaultSystemPrompt,
    );
  }

  /**
   * Get MCP tools as AI SDK tools using the ToolService
   */
  public getMCPTools(context: MCPToolContext): Record<string, ReturnType<typeof tool>> {
    const toolService = ToolService.getInstance(this.config);
    return toolService.createMCPTools(context);
  }

  /**
   * Get all tools (standard and MCP) using ToolService
   */
  public getAllTools(context: MCPToolContext): Record<string, ReturnType<typeof tool>> {
    const toolService = ToolService.getInstance(this.config);
    return toolService.getAllTools(context);
  }

  /**
   * Get a specific subset of tools by name
   */
  public getToolsByNames(
    toolNames: string[],
    context: MCPToolContext,
  ): Record<string, ReturnType<typeof tool>> {
    const toolService = ToolService.getInstance(this.config);
    return toolService.getToolsByNames(toolNames, context);
  }

  /**
   * Get the current LLM provider for use with tools that need LLM integration
   */
  public getLLMProvider(): LLMProvider {
    // Create and return a provider that matches the LLMProvider interface
    return {
      name: this.provider,
      model: this.model || 'none',
      isAvailable: () => Promise.resolve(true),
      listModels: () => Promise.resolve([this.model || 'none']),
      setModel: (model: string) => {
        this.model = model;
      },
      generate: async (prompt: string) => {
        const result = await this.generateText(prompt);
        return result.text;
      },
      generateObject: async <T>(prompt: string, schema: Record<string, unknown> | z.ZodType<T>) => {
        const response = await this.generateObject(prompt, schema as z.ZodType);
        return response as T;
      },
      chat: async (
        messages: Array<{ role: string; content: string }>,
        tools?: ToolFunction[],
      ) => {
        // Convert tools to a record if provided
        let toolsRecord: Record<string, ReturnType<typeof tool>> | undefined;
        if (tools && tools.length > 0 && this.mcpContext) {
          const toolService = ToolService.getInstance(this.config);
          toolsRecord = {};
          for (const toolFn of tools) {
            try {
              // Use getToolsByNames instead of private method
              const toolsByName = toolService.getToolsByNames([toolFn.name], this.mcpContext);
              if (toolsByName[toolFn.name]) {
                toolsRecord[toolFn.name] = toolsByName[toolFn.name];
              }
            } catch (error) {
              this.logger.warn(`Failed to get tool for ${toolFn.name}:`, error);
            }
          }
        }

        // Convert the messages to the expected format with proper typing
        const typedMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> =
          messages.map((msg) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
          }));

        // Use generateText with the tools
        const result = await this.generateText('', {
          messages: typedMessages,
          tools: toolsRecord,
          maxSteps: 3,
          toolChoice: 'auto',
        });

        // Format the response according to the LLMProvider interface
        return {
          content: result.text,
          tool_calls: result.steps?.[0]?.tool_calls?.map((call) => ({
            id: call.id,
            function: {
              name: call.function.name,
              arguments: call.function.arguments,
            },
          })),
        };
      },
    };
  }

  async mcpTool(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      const toolService = ToolService.getInstance(this.config);
      return await toolService.executeMCPTool(
        toolName,
        params,
        this.mcpContext || {
          mcpService: MCPService.getInstance(this.config),
          workingDirectory: Deno.cwd(),
        },
      );
    } catch (error) {
      this.logger.error(`Error executing MCP tool ${toolName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  chat(
    message: string,
    tools: Record<string, ReturnType<typeof tool>>,
    options: {
      maxSteps?: number;
      toolChoice?: 'none' | 'auto' | 'required';
      messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    } = {},
  ): Promise<GenerateTextResult> {
    return this.generateText(message, {
      tools,
      maxSteps: options.maxSteps,
      toolChoice: options.toolChoice,
      messages: options.messages,
    });
  }

  // @ts-ignore - This method has TypeScript issues with the AI library
  private async repairInvalidResponse<T>(
    invalidResponse: unknown,
    schema: z.ZodType<T>,
    context: {
      type: 'tool' | 'schema';
      originalPrompt?: string;
      error?: Error;
    },
  ): Promise<T> {
    this.logger.passThrough('log', theme.dim('\n🔄 Attempting to repair invalid response...'));
    this.logger.debug('\n[DEBUG] Attempting to repair invalid response:', invalidResponse);

    try {
      // Get the schema shape for validation feedback
      // @ts-ignore - We need to access the shape property
      const schemaShape = schema.shape || {};

      // Pre-process the response to handle common issues
      const processedResponse = this.preprocessResponse(invalidResponse, schemaShape);

      // Get validation errors if available
      const validationErrors = context.error instanceof z.ZodError
        ? context.error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          ...('expected' in err ? { expected: err.expected } : {}),
          ...('received' in err ? { received: err.received } : {}),
        }))
        : [];

      // Create repair prompt based on context type
      const systemPrompt = context.type === 'tool'
        ? 'You are a JSON repair assistant. Your task is to fix invalid JSON responses to match the required schema.'
        : `You are a JSON repair assistant. Your task is to fix invalid JSON responses to match the required schema.
When in doubt about a value, use a sensible default based on the field type.
For enum fields, use the first option if unsure.
For required fields, always provide a value.
For string fields, never use null - use an empty string instead.`;

      const userPrompt = context.type === 'tool'
        ? `The model tried to generate a response with the following content:
${JSON.stringify(processedResponse)}

The expected schema is:
${JSON.stringify(schemaShape)}

Please fix the response to match the schema.`
        : `The model generated an invalid response:
${JSON.stringify(processedResponse)}

The expected schema is:
${JSON.stringify(schemaShape)}

Validation errors:
${JSON.stringify(validationErrors, null, 2)}

Please fix the response to match the schema. For any fields you're unsure about:
1. Use empty string for strings (never null)
2. Use false for booleans
3. Use the first option for enums
4. Use empty array for arrays
5. Use empty object for objects
6. Use 0 for numbers

Most importantly, ensure all required fields are present and have valid values.`;

      // Attempt repair using AI
      // @ts-ignore - Ignore TS errors for AI library compatibility
      const result = await generateObjectAi({
        model: this.languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        schema,
      });

      this.logger.passThrough('log', theme.success('✓ Response repaired with AI assistance'));
      this.logger.debug('\n[DEBUG] Repaired response:');
      const repairedResponse = result.object;
      this.logger.debug(JSON.stringify(repairedResponse, null, 2));

      // Post-process the response to ensure all required fields are present
      const finalResponse = this.postprocessResponse(repairedResponse, schemaShape);

      // Validate the final response
      try {
        schema.parse(finalResponse);
        return finalResponse as T;
      } catch (validationError) {
        this.logger.error('Final validation failed:', validationError);
        // If validation still fails, try one more time with a simpler repair
        return this.simpleRepair(finalResponse, schemaShape) as T;
      }
    } catch (repairError) {
      this.logger.error('Failed to repair response:', repairError);
      this.logger.debug(
        `\n[DEBUG] Repair error: ${
          context.error instanceof Error ? context.error.message : String(context.error)
        }`,
      );
      throw new Error(`Failed to repair response: ${repairError}`);
    }
  }

  private preprocessResponse(
    response: unknown,
    schemaShape: Record<string, unknown>,
  ): Record<string, unknown> {
    const processed: Record<string, unknown> = {};

    // Handle null values and missing fields
    for (const [key, fieldSchema] of Object.entries(schemaShape)) {
      const value = (response as Record<string, unknown>)?.[key];

      // Skip optional fields that are null
      if (value === null && fieldSchema instanceof z.ZodOptional) {
        continue;
      }

      if (value === null || value === undefined) {
        if (fieldSchema instanceof z.ZodString) {
          processed[key] = '';
        } else if (fieldSchema instanceof z.ZodBoolean) {
          processed[key] = false;
        } else if (fieldSchema instanceof z.ZodNumber) {
          processed[key] = 0;
        } else if (fieldSchema instanceof z.ZodArray) {
          processed[key] = [];
        } else if (fieldSchema instanceof z.ZodObject) {
          processed[key] = {};
        } else if (fieldSchema instanceof z.ZodEnum) {
          processed[key] = fieldSchema.options[0];
        }
      } else {
        // Handle nested objects
        if (fieldSchema instanceof z.ZodObject && typeof value === 'object' && value !== null) {
          processed[key] = this.preprocessResponse(value, fieldSchema.shape);
        } else {
          processed[key] = value;
        }
      }
    }

    return processed;
  }

  private postprocessResponse(
    response: unknown,
    schemaShape: Record<string, unknown>,
  ): Record<string, unknown> {
    const processed: Record<string, unknown> = { ...(response as Record<string, unknown>) };

    // Ensure all required fields are present with valid values
    for (const [key, fieldSchema] of Object.entries(schemaShape)) {
      // Skip optional fields that are null
      if (processed[key] === null && fieldSchema instanceof z.ZodOptional) {
        delete processed[key];
        continue;
      }

      if (!(key in processed) || processed[key] === null || processed[key] === undefined) {
        if (fieldSchema instanceof z.ZodString) {
          processed[key] = '';
        } else if (fieldSchema instanceof z.ZodBoolean) {
          processed[key] = false;
        } else if (fieldSchema instanceof z.ZodNumber) {
          processed[key] = 0;
        } else if (fieldSchema instanceof z.ZodArray) {
          processed[key] = [];
        } else if (fieldSchema instanceof z.ZodObject) {
          processed[key] = {};
        } else if (fieldSchema instanceof z.ZodEnum) {
          processed[key] = fieldSchema.options[0];
        }
      } else if (
        fieldSchema instanceof z.ZodObject && typeof processed[key] === 'object' &&
        processed[key] !== null
      ) {
        // Handle nested objects
        processed[key] = this.postprocessResponse(processed[key], fieldSchema.shape);
      }
    }

    return processed;
  }

  private simpleRepair(
    response: unknown,
    schemaShape: Record<string, unknown>,
  ): Record<string, unknown> {
    const repaired: Record<string, unknown> = {};

    for (const [key, fieldSchema] of Object.entries(schemaShape)) {
      const value = (response as Record<string, unknown>)?.[key];

      if (fieldSchema instanceof z.ZodString) {
        repaired[key] = typeof value === 'string' ? value : '';
      } else if (fieldSchema instanceof z.ZodBoolean) {
        repaired[key] = typeof value === 'boolean' ? value : false;
      } else if (fieldSchema instanceof z.ZodNumber) {
        repaired[key] = typeof value === 'number' ? value : 0;
      } else if (fieldSchema instanceof z.ZodArray) {
        repaired[key] = Array.isArray(value) ? value : [];
      } else if (fieldSchema instanceof z.ZodObject) {
        repaired[key] = typeof value === 'object' && value !== null
          ? this.simpleRepair(value, fieldSchema.shape)
          : {};
      } else if (fieldSchema instanceof z.ZodEnum) {
        repaired[key] = fieldSchema.options.includes(value) ? value : fieldSchema.options[0];
      }
    }

    return repaired;
  }
}
