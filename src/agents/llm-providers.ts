import { z } from 'zod';
import type { ToolCall, ToolFunction } from '../types/tool_types.ts';
import type { Logger } from '../utils/logger.ts';
import type { Config } from '../config/types.ts';
import { LLMResponseProcessor } from '../services/llm/llm-response-processor.ts';

/**
 * Base LLM Provider interface
 */
export interface LLMProvider {
    name: string;
    isAvailable(): Promise<boolean>;
    listModels(): Promise<string[]>;
    setModel(model: string): void;
    generate(prompt: string, options?: LLMGenerateOptions): Promise<string>;
    generateObject<T>(options: GenerateObjectOptions<T>): Promise<T>;
    chat(
        messages: Array<{ role: string; content: string }>,
        options?: LLMChatOptions,
    ): Promise<{ content: string; tool_calls?: ToolCall[] }>;
}

export interface LLMGenerateOptions {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    systemPrompt?: string;
}

export interface LLMChatOptions extends LLMGenerateOptions {
    tools?: ToolFunction[];
}

export interface GenerateObjectOptions<T> extends LLMGenerateOptions {
    schema: z.ZodType<T>;
    prompt: string;
    systemPrompt?: string;
}

/**
 * Ollama Provider Implementation
 */
export class OllamaProvider implements LLMProvider {
    public readonly name = 'ollama';
    private model: string;
    private baseUrl: string;
    private logger: Logger;
    private responseProcessor: LLMResponseProcessor;

    constructor(config: Config['ai'], logger: Logger) {
        this.model = config?.ollama?.model || 'llama3';
        this.baseUrl = config?.ollama?.api_url || 'http://localhost:11434';
        this.logger = logger.child('OllamaProvider');
        this.responseProcessor = new LLMResponseProcessor(logger);
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch (error) {
            this.logger.debug('Ollama not available:', error);
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            return data.models?.map((m: { name: string }) => m.name) || [];
        } catch (error) {
            this.logger.error('Failed to list Ollama models:', error);
            return [];
        }
    }

    setModel(model: string): void {
        this.model = model;
    }

    async generate(prompt: string, options: LLMGenerateOptions = {}): Promise<string> {
        const requestBody = {
            model: this.model,
            prompt,
            stream: false,
            options: {
                temperature: options.temperature || 0.7,
                num_predict: options.maxTokens || 2000,
            },
        };

        if (options.systemPrompt) {
            requestBody.prompt = `${options.systemPrompt}\n\n${prompt}`;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.response || '';
        } catch (error) {
            this.logger.error('Ollama generation failed:', error);
            throw new Error(`Failed to generate with Ollama: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async generateObject<T>(options: GenerateObjectOptions<T>): Promise<T> {
        const systemPrompt = options.systemPrompt || 
            'You are a helpful assistant that responds only with valid JSON. Do not include any explanations, formatting, or additional text.';
        
        // Create a more detailed prompt with schema example
        const schemaDescription = this.getSchemaDescription(options.schema);
        const fullPrompt = `${options.prompt}

Please respond with valid JSON that matches this exact structure:
${schemaDescription}

Important:
- Respond ONLY with valid JSON
- Do not include markdown code blocks
- Do not include any explanations
- Make sure all required fields are included
- For coverage field, provide a number between 0-100 (not a string like "75%")
- For testsPresent field, provide true or false (not a string)

JSON Response:`;
        
        try {
            const response = await this.generate(fullPrompt, {
                ...options,
                systemPrompt,
                temperature: options.temperature || 0.1, // Lower temperature for more consistent JSON
            });

            this.logger.debug('Raw LLM response:', response.substring(0, 200));

            // Create processing context for enhanced error tracking
            const context = {
                provider: this.name,
                model: this.model,
                prompt: options.prompt,
                attemptNumber: 1,
                timestamp: new Date()
            };

            // Use the enhanced response processor with context
            const processingResult = await this.responseProcessor.processResponse(
                response, 
                options.schema, 
                context
            );
            
            if (processingResult.success && processingResult.data) {
                // Log processing metrics
                this.logger.debug('Response processing completed', {
                    processingTime: processingResult.processingTime,
                    originalLength: processingResult.originalResponseLength,
                    cleanedLength: processingResult.cleanedResponseLength,
                    transformationsApplied: processingResult.transformationsApplied
                });
                
                // Log any warnings from the processing
                if (processingResult.warnings.length > 0) {
                    this.logger.info('Response processing warnings:', processingResult.warnings);
                }
                
                return processingResult.data;
            } else {
                // Processing failed, log detailed error information
                this.logger.error('Response processing failed', {
                    errors: processingResult.errors.map(e => e.message),
                    warnings: processingResult.warnings,
                    fallbackUsed: processingResult.fallbackUsed,
                    processingTime: processingResult.processingTime
                });
                
                const error = processingResult.errors[0] || new Error('Unknown processing error');
                throw error;
            }
            
        } catch (error) {
            this.logger.error('Failed to generate structured object:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                model: this.model,
                promptLength: options.prompt.length
            });
            
            // Enhanced error context for debugging
            if (error instanceof Error && error.message.includes('Validation failed')) {
                this.logger.warn('Structured output validation failed - LLM response format was incorrect', {
                    provider: this.name,
                    model: this.model
                });
            }
            
            throw new Error(`Failed to generate structured object with ${this.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generate a human-readable description of the Zod schema for the LLM
     */
    private getSchemaDescription(schema: z.ZodType<unknown>): string {
        try {
            // For now, provide a simple JSON structure example
            // This could be enhanced to parse the Zod schema more deeply
            if (schema instanceof z.ZodObject) {
                const shape = schema.shape;
                const example: Record<string, unknown> = {};
                
                for (const [key, value] of Object.entries(shape)) {
                    if (value instanceof z.ZodString) {
                        example[key] = `"example ${key}"`;
                    } else if (value instanceof z.ZodEnum) {
                        example[key] = `"${value.options[0]}"`;
                    } else if (value instanceof z.ZodArray) {
                        example[key] = [`"example item"`];
                    } else {
                        example[key] = `"value"`;
                    }
                }
                
                return JSON.stringify(example, null, 2);
            }
        } catch (error) {
            this.logger.debug('Failed to generate schema description:', error);
        }
        
        // Fallback description
        return `{
  "summary": "Brief description",
  "language": "Programming language",
  "complexity": "low|medium|high",
  "suggestions": ["suggestion 1", "suggestion 2"],
  "issues": ["issue 1", "issue 2"]
}`;
    }

    /**
     * Normalize enum values that LLMs might capitalize or format incorrectly
     */
    private normalizeEnumValues(obj: unknown): unknown {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.normalizeEnumValues(item));
        }
        
        const normalized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            if (typeof value === 'string') {
                // Normalize known enum fields
                if (key === 'complexity') {
                    normalized[key] = value.toLowerCase();
                } else {
                    normalized[key] = value;
                }
            } else if (typeof value === 'object') {
                normalized[key] = this.normalizeEnumValues(value);
            } else {
                normalized[key] = value;
            }
        }
        
        return normalized;
    }

    async chat(
        messages: Array<{ role: string; content: string }>,
        options: LLMChatOptions = {},
    ): Promise<{ content: string; tool_calls?: ToolCall[] }> {
        // Convert messages to a single prompt for Ollama
        const prompt = messages
            .map(m => `${m.role}: ${m.content}`)
            .join('\n\n');

        const content = await this.generate(prompt, options);
        
        // For now, Ollama doesn't support structured tool calls
        // This could be extended to parse tool calls from response
        return { content };
    }
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements LLMProvider {
    public readonly name = 'openai';
    private model: string;
    private apiKey: string;
    private baseUrl: string;
    private logger: Logger;
    private responseProcessor: LLMResponseProcessor;

    constructor(config: Config['ai'], logger: Logger) {
        const openaiConfig = config?.openai;
        if (!openaiConfig?.api_key) {
            throw new Error('OpenAI API key is required');
        }
        
        this.model = openaiConfig.default_model || 'gpt-4';
        this.apiKey = openaiConfig.api_key;
        this.baseUrl = openaiConfig.api_url || 'https://api.openai.com/v1';
        this.logger = logger.child('OpenAIProvider');
        this.responseProcessor = new LLMResponseProcessor(logger);
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch (error) {
            this.logger.debug('OpenAI not available:', error);
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            return data.data?.map((m: { id: string }) => m.id) || [];
        } catch (error) {
            this.logger.error('Failed to list OpenAI models:', error);
            return [];
        }
    }

    setModel(model: string): void {
        this.model = model;
    }

    async generate(prompt: string, options: LLMGenerateOptions = {}): Promise<string> {
        const messages = [];
        
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        
        messages.push({ role: 'user', content: prompt });

        const response = await this.chat(messages, options);
        return response.content;
    }

    async generateObject<T>(options: GenerateObjectOptions<T>): Promise<T> {
        const systemPrompt = options.systemPrompt || 
            'You must respond with valid JSON that matches the required schema. Do not include any other text or formatting. For coverage field, provide a number between 0-100 (not a string like "75%"). For testsPresent field, provide true or false (not a string).';
        
        try {
            const response = await this.generate(options.prompt, {
                ...options,
                systemPrompt,
            });

            this.logger.debug('Raw LLM response:', response.substring(0, 200));

            // Create processing context for enhanced error tracking
            const context = {
                provider: this.name,
                model: this.model,
                prompt: options.prompt,
                attemptNumber: 1,
                timestamp: new Date()
            };

            // Use the enhanced response processor with context
            const processingResult = await this.responseProcessor.processResponse(
                response, 
                options.schema, 
                context
            );
            
            if (processingResult.success && processingResult.data) {
                // Log processing metrics
                this.logger.debug('Response processing completed', {
                    processingTime: processingResult.processingTime,
                    originalLength: processingResult.originalResponseLength,
                    cleanedLength: processingResult.cleanedResponseLength,
                    transformationsApplied: processingResult.transformationsApplied
                });
                
                // Log any warnings from the processing
                if (processingResult.warnings.length > 0) {
                    this.logger.info('Response processing warnings:', processingResult.warnings);
                }
                
                return processingResult.data;
            } else {
                // Processing failed, log detailed error information
                this.logger.error('Response processing failed', {
                    errors: processingResult.errors.map(e => e.message),
                    warnings: processingResult.warnings,
                    fallbackUsed: processingResult.fallbackUsed,
                    processingTime: processingResult.processingTime
                });
                
                const error = processingResult.errors[0] || new Error('Unknown processing error');
                throw error;
            }
        } catch (error) {
            this.logger.error('Failed to generate structured object:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                model: this.model,
                promptLength: options.prompt.length
            });
            
            // Enhanced error context for debugging
            if (error instanceof Error && error.message.includes('Validation failed')) {
                this.logger.warn('Structured output validation failed - LLM response format was incorrect', {
                    provider: this.name,
                    model: this.model
                });
            }
            
            throw new Error(`Failed to generate structured object with ${this.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async chat(
        messages: Array<{ role: string; content: string }>,
        options: LLMChatOptions = {},
    ): Promise<{ content: string; tool_calls?: ToolCall[] }> {
        const requestBody = {
            model: this.model,
            messages,
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || 2000,
            tools: options.tools?.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            })),
        };

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const choice = data.choices?.[0];
            
            if (!choice) {
                throw new Error('No response from OpenAI');
            }

            const content = choice.message?.content || '';
            const tool_calls = choice.message?.tool_calls?.map((tc: { id: string; type: string; function: { name: string; arguments: string } }) => ({
                id: tc.id,
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                },
            }));

            return { content, tool_calls };
        } catch (error) {
            this.logger.error('OpenAI chat failed:', error);
            throw new Error(`Failed to chat with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

/**
 * Fallback provider when no LLM is available
 */
export class FallbackProvider implements LLMProvider {
    public readonly name = 'fallback';
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child('FallbackProvider');
    }

    isAvailable(): Promise<boolean> {
        return Promise.resolve(true);
    }

    listModels(): Promise<string[]> {
        return Promise.resolve(['fallback']);
    }

    setModel(_model: string): void {
        // No-op
    }

    generate(prompt: string, _options?: LLMGenerateOptions): Promise<string> {
        this.logger.warn('Using fallback provider - no LLM processing available');
        return Promise.resolve(`[Fallback Response] Unable to process prompt: "${prompt.slice(0, 100)}..."\n\nPlease configure an LLM provider (OpenAI or Ollama) to enable AI features.`);
    }

    generateObject<T>(_options: GenerateObjectOptions<T>): Promise<T> {
        this.logger.warn('Using fallback provider - cannot generate structured objects');
        return Promise.reject(new Error('LLM not available - cannot generate structured objects. Please configure OpenAI or Ollama.'));
    }

    async chat(
        messages: Array<{ role: string; content: string }>,
        _options?: LLMChatOptions,
    ): Promise<{ content: string; tool_calls?: ToolCall[] }> {
        const lastMessage = messages[messages.length - 1]?.content || '';
        return {
            content: await this.generate(lastMessage),
        };
    }
}
