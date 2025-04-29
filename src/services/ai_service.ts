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
        explanation: string;
        suggestion: string;
        line?: number;
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

interface CodeAnalysis{
    issues: Array<{
        severity: 'high' | 'medium' | 'low';
        message: string;
        explanation?: string;
        suggestion?: string;
        line?: number;
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
    public provider: 'openai' | 'azure' | 'ollama'; // What is with antrophic?
    public languageModel: LanguageModel;
    public model: string;
    private mcpContext: MCPToolContext | null;

    constructor(config: Config, options: AIServiceOptions = {}, mcpContext: MCPToolContext | null = null) {
        this.config = config;
        this.temperature = options.temperature || 0.7;
        this.maxTokens = options.maxTokens || 2000;
        this.logger = new Logger('AI', Deno.env.get('NOVA_DEBUG') === 'true');
        this.mcpContext = mcpContext;
        // Determine which AI provider to use based on config and default_provider
        const defaultProvider = this.config.ai?.default_provider;

        if (defaultProvider === 'openai' && this.config.ai?.openai?.api_key) {
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
            throw new Error("No valid AI provider configured. Please run 'nova setup' first.");
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
        } = {}
    ): Promise<GenerateTextResult> {    
        this.logger.debug('\nGenerating text with options:', {
            hasTools: !!options.tools,
            toolNames: options.tools ? Object.keys(options.tools) : [],
            maxSteps: options.maxSteps,
            toolChoice: options.toolChoice,
            messageCount: options.messages?.length,
        });

        // If messages are provided, use them instead of the prompt
        const params = options.messages ? {
            model: this.languageModel,
            messages: options.messages,
            temperature: this.temperature,
            max_tokens: this.maxTokens,
            tools: options.tools,
            toolChoice: options.toolChoice,
            maxSteps: options.maxSteps,
        } : {
            model: this.languageModel,
            prompt,
            temperature: this.temperature,
            max_tokens: this.maxTokens,
            tools: options.tools,
            toolChoice: options.toolChoice,
            maxSteps: options.maxSteps,
        };

        try {
            this.logger.debug('Calling generate Text with params:', {
                model: this.model,
                messageCount: params.messages?.length,
                hasTools: !!params.tools,
                toolChoice: params.toolChoice,
                maxSteps: params.maxSteps
            });

            const result = await generateText(params);
            if (typeof result === 'string') {
                this.logger.debug('Received string result');
                return { text: result };
            }

            this.logger.debug('Received structured result:', {
                hasText: !!result.text,
                stepCount: result.steps?.length,
                firstStep: result.steps?.[0]
            });

            return {
                text: result.text,
                steps: result.steps?.map(step => ({
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
                            arguments: JSON.stringify(call.args)
                        }
                    }))
                }))
            };
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error('Error in generateText:', error.message);
                throw error;
            }
            throw new Error('Unknown error in generateText');
        }
    }

    async generateWithTools<T>(
        prompt: string,
        schema: z.ZodType<T>,
        tools: Record<string, ReturnType<typeof tool>>,
        options: {
            maxSteps?: number;
            systemPrompt?: string;
            toolChoice?: 'none' | 'auto' | 'required';
            context?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
        } = {}
    ): Promise<{result: T; steps?: Array<StepResult>}> {
        this.logger.passThrough('log', theme.header('\n🤖 Processing with Tools'));
        this.logger.passThrough('log', theme.dim('💭 Analyzing request and selecting appropriate tools...'));
        const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        if (options.context) {
            messages.push(...options.context);
        }
        messages.push({ role: 'user', content: prompt });

        try {
            this.logger.passThrough('log', theme.dim('🔄 Executing tool operations...'));
            const { text, steps } = await this.generateText('', {
                tools,
                maxSteps: options.maxSteps || 3,
                toolChoice: options.toolChoice || 'auto',
                messages,
            });
            this.logger.passThrough('log', theme.dim('📝 Processing tool response...'));
            // Extract the first valid JSON object from the response
            const jsonMatch = text.match(/\{(?:[^{}]|(\{[^{}]*\}))*\}/);
            if (!jsonMatch) {
                this.logger.passThrough('log', theme.warning('⚠️ No structured data found in response'));
                // Create a simple response object with the content from the text
                const fallbackResponse = {
                    response: text || "I'm sorry, I couldn't process that request properly. Please try again.",
                    suggestions: [],
                    context: {},
                    confidence: 0.5
                };
                return {
                    result: fallbackResponse as T,
                    steps
                };
            }
            try {
                // Try to parse and validate the response
                const parsed = JSON.parse(jsonMatch[0]);
                this.logger.passThrough('log', theme.dim('🔍 Validating response format...'));
                // Handle both standard message and structured response formats
                if (parsed.assistant?.message || parsed.assistant?.text || parsed.message) {
                    const response = {
                        response: parsed.assistant?.message || parsed.assistant?.text || parsed.message || '',
                        suggestions: [],
                        context: {},
                        confidence: 1.0
                    };
                    this.logger.passThrough('log', theme.success('✓ Response processed successfully'));
                    return {
                        result: response as T,
                        steps
                    };
                }
                // Parse and validate the structured response
                try {
                    const result = schema.parse(parsed);
                    this.logger.passThrough('log', theme.success('✓ Response validated successfully'));
                    return { result, steps };
                } catch (_validationError) {
                    this.logger.passThrough('log', theme.warning('⚠️ Response validation failed, creating formatted response'));
                    // Create a response from whatever we have in the parsed data
                    const fallbackFromParsed = {
                        response: this.formatToolResponse(parsed),
                        suggestions: parsed.suggestions || [],
                        context: { toolResponse: parsed },
                        confidence: 0.9
                    };
                    return { 
                        result: fallbackFromParsed as T,
                        steps 
                    };
                }
            } catch (_parsError) {
                this.logger.passThrough('log', theme.error('❌ Failed to parse response'));
                const fallbackResponse = {
                    response: text || "I'm sorry, I couldn't process that request properly. Please try again.",
                    suggestions: [],
                    context: {},
                    confidence: 0.5
                };
                return {
                    result: fallbackResponse as T,
                    steps
                };
            }
        } catch (error) {
            this.logger.error('\nError generating response with tools:', error);
            throw new Error(
                `Failed to generate response with tools: ${
                    error instanceof Error ? error.message : String(error)
                }`
            ); 
        }   
    }

    formatToolResponse(data: Record<string, unknown>): string {
        // Format the tool response into a readable message
        const entries = Object.entries(data);
        if (entries.length === 0) return "No data available from the tool.";
    
        // If there's only one field and it's a message/response/text, return it directly
        if (entries.length === 1) {
            const [key, value] = entries[0];
            if (['message', 'response', 'text', 'content'].includes(key) && typeof value === 'string') {
                return value;
            }
        }
    
        // Otherwise, format all fields into a readable message
        return entries
        .map(([key, value]) => {
            const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const formattedValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
            return `${formattedKey}: ${formattedValue}`;
        })
        .join('\n');
    }
    
    async generateObject<T>(
        prompt: string,
        schema: z.ZodType<T>,
        systemPrompt?: string,
    ): Promise<T> {
        const messages: AIMessage[] = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: `${systemPrompt}\n\nYou must respond with a valid JSON object that conforms to the required schema.` });
        } else {
            messages.push({ 
                role: 'system', 
                content: 'You are a JSON-only response AI. Your task is to analyze the following and respond with a valid JSON object.'
            });
        }
        messages.push({ role: 'user', content: prompt });
    
        this.logger.debug('\nGenerating structured response');
        this.logger.debug('Using schema type:', schema.description || 'No description available');
    
        try {
            const result = await generateObjectAi({
                model: this.languageModel,
                messages,
                temperature: this.temperature,
                maxTokens: this.maxTokens,
                // deno-lint-ignore no-explicit-any
                schema: schema as any // Fix type recursion with 'any'
            });
    
            this.logger.debug('\n[DEBUG] Generated response:');
            this.logger.debug(JSON.stringify(result, null, 2));
            return result.object as unknown as T;
        } catch (error) {
            this.logger.error('Failed to generate structured response:', error);
            throw new Error(`Failed to generate structured response: ${error instanceof Error ? error.message : String(error)}`);
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
            purpose: options.purpose
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
                line: z.number().optional(),
                column: z.number().optional(),
                code: z.string().optional()
            })),
            recommendations: z.array(z.string()),
            summary: z.string().optional(),
            metrics: z.record(z.string(), z.number()).optional()
        });
        
        try {
            return await this.generateObject(prompt, schema);
        } catch (error) {
            this.logger.error('Error analyzing code:', error);
            return {
                issues: [],
                recommendations: [],
                summary: 'Error analyzing code'
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
        }
    ): Promise<T> {
        this.logger.debug('\nGenerating chat response');
        this.logger.debug('Message:', message);
        this.logger.debug('Context length:', context?.length || 0);
    
        const defaultSystemPrompt = `You are a helpful AI assistant that generates structured chat responses.
            Your response must be a valid JSON object that matches the expected schema.
            Always respond in a clear, concise, and helpful manner.
            If you don't know something, admit it rather than making things up.
            Format your response as a single JSON object without any additional text.`;
    
        // Construct messages array with proper types
        const messages: AIMessage[] = [];
        
        // Add system prompt
        messages.push({
            role: 'system',
            content: options?.systemPrompt || defaultSystemPrompt
        });
    
        // Add context if available
        if (context) {
            messages.push(...context.map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content
            })));
        }
    
        // Add current message
        messages.push({ role: 'user', content: message });
    
        // If tools are provided, use generateWithTools
        if (options?.tools) {
            const { result } = await this.generateWithTools(
                message,
                schema,
                options.tools,
                {
                    maxSteps: options.maxSteps,
                    systemPrompt: options.systemPrompt || defaultSystemPrompt,
                    toolChoice: options.toolChoice,
                    context: messages
                }
            );
            return result;
        }
        
        // Otherwise, use regular generateObject
        return this.generateObject(
            message,
            schema,
            options?.systemPrompt || defaultSystemPrompt
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
            isAvailable: () => Promise.resolve(true),
            listModels: () => Promise.resolve([this.model]),
            setModel: (model: string) => { this.model = model; },
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
                tools?: ToolFunction[]
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
                const typedMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
                
                for (const msg of messages) {
                    let role: 'user' | 'assistant' | 'system' = 'user'; // Default role
                    // Only assign valid roles
                    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
                        role = msg.role as 'user' | 'assistant' | 'system';
                    }

                    typedMessages.push({
                        role,
                        content: msg.content
                    });
                }
        
                const result = await this.generateText('', {
                    messages: typedMessages,
                    tools: toolsRecord,
                });
        
                return {
                    content: result.text,
                    tool_calls: result.steps?.[0]?.tool_calls
                };
            }
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
        } = {}
    ): Promise<GenerateTextResult> {
        return this.generateText(message, {
            tools,
            maxSteps: options.maxSteps,
            toolChoice: options.toolChoice,
            messages: options.messages
        });
    }
}
