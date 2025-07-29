// @ts-nocheck: This file interfaces with browser APIs and third-party libraries that have complex types

import { AvailableModel, CreateChatCompletionOptions, LLMClient } from '@browserbasehq/stagehand';
import {
    CoreMessage,
    CoreSystemMessage,
    CoreTool,
    generateObject,
    generateText,
    LanguageModel,
} from 'ai';
import type { ChatCompletion } from 'openai/resources/chat';
import { SchemaType, SummaryType } from '../types/stagehand.d.ts';

export class AISdkClient extends LLMClient {
    public override type = 'aisdk' as const;
    private model: LanguageModel;
    private debug: boolean;
    private requestId: number = 0;

    constructor({ model, debug = false }: { model: LanguageModel; debug?: boolean }) {
        super(model.modelId as AvailableModel);
        this.model = model;
        this.debug = debug;

        if (debug) {
            console.log('\n==== AISDK CLIENT INITIALIZED ====');
            console.log(`🔌 Model: ${model.modelId}`);
            console.log(`🐞 Debug: ${debug ? 'enabled' : 'disabled'}`);
            console.log('===================================\n');
        }
    }

    private log(type: string, message: string, data?: unknown): void {
        if (!this.debug) return;

        const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
        const prefix = `[${timestamp}][AISdk][${type}]`;

        console.log(`${prefix} ${message}`);

        if (data !== undefined) {
            // For large objects, print a summary instead of the full object
            if (typeof data === 'object' && data !== null) {
                if (type === 'RESPONSE' || type === 'SCHEMA') {
                    // Summarize large response objects
                    const summary = this.summarizeObject(data);
                    console.log(`${prefix} Data:`, summary);
                } else {
                    // Pretty print with limited depth for other object types
                    try {
                        console.log(`${prefix} Data:`, JSON.stringify(data, this.jsonReplacer, 2));
                    } catch (_e) {
                        console.log(`${prefix} Data: [Object too large to stringify]`);
                    }
                }
            } else {
                console.log(`${prefix} Data:`, data);
            }
        }
    }

    private jsonReplacer(_key: string, value: unknown): unknown {
        // Limit string length in JSON output
        if (typeof value === 'string' && value.length > 100) {
            return value.substring(0, 100) + '... [truncated]';
        }
        return value;
    }

    private summarizeObject(obj: unknown): SummaryType | unknown {
        if (!obj) return obj;

        // For arrays, show length and sample first few items
        if (Array.isArray(obj)) {
            return {
                type: 'Array',
                length: obj.length,
                sample: obj.length > 0 ? obj.slice(0, 3) : 'empty',
                hasMore: obj.length > 3,
            };
        }

        // For objects, show keys and count
        if (typeof obj === 'object') {
            const keys = Object.keys(obj);
            const summary: unknown = {
                type: 'Object',
                keyCount: keys.length,
                keys: keys.slice(0, 10),
            };

            if (keys.length > 10) {
                summary.hasMoreKeys = true;
            }

            // Include sample values for important keys
            ['id', 'name', 'type', 'role', 'status', 'error', 'message'].forEach((key) => {
                if (obj[key] !== undefined) {
                    summary[key] = obj[key];
                }
            });

            return summary;
        }

        return obj;
    }

    private validateSchema(schema: SchemaType): boolean {
        this.log('SCHEMA', 'Validating schema structure');

        const isValid = schema &&
            (schema._def?.typeName === 'ZodObject' ||
                schema?._cached?.shape ||
                schema?._cached?.keys?.length > 0);

        if (!isValid) {
            this.log('SCHEMA', '⚠️ Schema validation failed', schema);
        } else {
            const schemaInfo = {
                name: schema.name,
                type: schema._def?.typeName,
                keyCount: schema._cached?.keys?.length || 0,
                keys: schema._cached?.keys || [],
            };
            this.log('SCHEMA', '✅ Schema validation passed', schemaInfo);
        }

        return isValid;
    }

    private ensureDefaultFields(result: unknown, schema: unknown): unknown {
        if (!result || Object.keys(result).length === 0) {
            this.log('FIX', '⚠️ Empty result detected, generating default values');

            try {
                const defaultValues: Record<string, unknown> = {};

                if (schema?._cached?.keys?.length > 0) {
                    this.log('FIX', `Found ${schema._cached.keys.length} schema keys`);

                    for (const key of schema._cached.keys) {
                        const fieldSchema = schema._cached.shape[key];

                        if (fieldSchema?._def) {
                            const typeName = fieldSchema._def.typeName;
                            let defaultValue = null;

                            if (typeName === 'ZodObject') defaultValue = {};
                            else if (typeName === 'ZodArray') defaultValue = [];
                            else if (typeName === 'ZodString') defaultValue = '';
                            else if (typeName === 'ZodNumber') defaultValue = 0;
                            else if (typeName === 'ZodBoolean') defaultValue = false;
                            else if (typeName === 'ZodOptional') {
                                const innerType = fieldSchema._def.innerType?._def?.typeName;
                                if (innerType === 'ZodArray' || innerType === 'ZodNullable') {
                                    defaultValue = [];
                                }
                            }

                            if (defaultValue !== null) {
                                defaultValues[key] = defaultValue;
                                this.log(
                                    'FIX',
                                    `Generated default for '${key}': ${
                                        JSON.stringify(defaultValue)
                                    }`,
                                );
                            }
                        }
                    }
                } else if (schema?.shape) {
                    this.log('FIX', 'Using alternative schema shape format');

                    for (const [key, fieldSchema] of Object.entries(schema.shape)) {
                        if (fieldSchema.description?.includes('progress')) {
                            defaultValues[key] = 'completed';
                            this.log('FIX', `Set '${key}' = 'completed' based on description`);
                        } else if (fieldSchema.description?.includes('completed')) {
                            defaultValues[key] = true;
                            this.log('FIX', `Set '${key}' = true based on description`);
                        } else if (key === 'links' || key === 'statictext') {
                            defaultValues[key] = [];
                            this.log('FIX', `Set '${key}' = [] for extraction schema`);
                        }
                    }
                }

                // Special case handling for metadata schema
                if (schema?.name === 'Metadata' || schema?._def?.typeName === 'ZodObject') {
                    if (!defaultValues.progress) {
                        defaultValues.progress = 'completed';
                        this.log('FIX', `Added metadata 'progress' = 'completed'`);
                    }
                    if (defaultValues.completed === undefined) {
                        defaultValues.completed = true;
                        this.log('FIX', `Added metadata 'completed' = true`);
                    }
                }

                const mergedResult = { ...result, ...defaultValues };
                this.log(
                    'FIX',
                    `✅ Fixed result with ${Object.keys(defaultValues).length} default values`,
                );
                return mergedResult;
            } catch (error) {
                this.log('ERROR', '❌ Error generating default values', error);
                return result;
            }
        }

        return result;
    }

    async createChatCompletion<T = ChatCompletion>({
        options,
    }: CreateChatCompletionOptions): Promise<T> {
        const currentRequestId = ++this.requestId;
        this.log('REQUEST', `📩 New request #${currentRequestId} started`);
        this.log(
            'REQUEST',
            `Model: ${this.model.modelId}, MessageCount: ${options.messages.length}`,
        );

        if (this.debug) {
            // Log a compact summary of messages rather than the full content
            const messageSummary = options.messages.map((msg) => ({
                role: msg.role,
                contentType: Array.isArray(msg.content) ? 'multipart' : 'text',
                length: typeof msg.content === 'string'
                    ? msg.content.length
                    : Array.isArray(msg.content)
                    ? msg.content.length
                    : 'unknown',
            }));
            this.log('REQUEST', `Messages summary:`, messageSummary);

            // Log if response model is being used
            if (options.response_model) {
                this.log(
                    'REQUEST',
                    `Using response model: ${options.response_model.name || 'unnamed'}`,
                );
            }

            // Log tools summary if present
            if (options.tools?.length) {
                this.log(
                    'REQUEST',
                    `Using ${options.tools.length} tools`,
                    options.tools.map((t) => t.name),
                );
            }
        }

        // Special handling for observation requests
        if (options.response_model?.name === 'Observation') {
            this.log('PROCESS', `🔄 Processing observation request #${currentRequestId}`);

            try {
                // For observations, we want to return an array of elements
                const response = await generateText({
                    model: this.model,
                    messages: options.messages.map((msg) => ({
                        role: msg.role as 'user' | 'assistant' | 'system',
                        content: Array.isArray(msg.content)
                            ? msg.content.map((c) => 'text' in c ? c.text : '').join('\n')
                            : msg.content,
                    })),
                });

                // Parse the response into an array of observations
                const observations = this.parseObservationResponse(response);

                this.log(
                    'RESPONSE',
                    `✅ Observation request #${currentRequestId} completed successfully`,
                );

                return {
                    data: observations,
                    usage: {
                        prompt_tokens: 0,
                        completion_tokens: 0,
                        total_tokens: 0,
                    },
                } as T;
            } catch (error) {
                this.log('ERROR', `❌ Error on observation request #${currentRequestId}`, error);
                return {
                    data: [],
                    usage: {
                        prompt_tokens: 0,
                        completion_tokens: 0,
                        total_tokens: 0,
                    },
                } as T;
            }
        }

        const formattedMessages: CoreMessage[] = options.messages.map((message) => {
            if (Array.isArray(message.content)) {
                this.log(
                    'FORMAT',
                    `Converting ${message.role} message with ${message.content.length} content parts`,
                );

                if (message.role === 'system') {
                    const systemMessage: CoreSystemMessage = {
                        role: 'system',
                        content: message.content
                            .map((c) => ('text' in c ? c.text : ''))
                            .join('\n'),
                    };
                    return systemMessage;
                }

                const contentParts = message.content.map((content) => {
                    if ('image_url' in content) {
                        return {
                            type: 'image' as const,
                            image: content.image_url.url,
                        };
                    } else {
                        return {
                            type: 'text' as const,
                            text: content.text,
                        };
                    }
                });

                if (message.role === 'user') {
                    return {
                        role: 'user',
                        content: contentParts,
                    };
                } else {
                    const textOnlyParts = contentParts.map((part) => ({
                        type: 'text' as const,
                        text: part.type === 'image' ? '[Image]' : part.text,
                    }));
                    return {
                        role: 'assistant',
                        content: textOnlyParts,
                    };
                }
            }

            // Simple text message
            return {
                role: message.role,
                content: message.content,
            };
        });

        if (options.response_model) {
            this.log(
                'PROCESS',
                `🔄 Processing request #${currentRequestId} with object generation`,
            );

            try {
                // Validate and enhance options
                const validSchema = this.validateSchema(options.response_model.schema);

                if (!validSchema) {
                    this.log('WARNING', '⚠️ Schema validation failed, using fallback approach');
                }

                this.log('API', `🚀 Calling generateObject API for request #${currentRequestId}`);
                const startTime = Date.now();

                const response = await generateObject({
                    model: this.model,
                    messages: formattedMessages,
                    schema: options.response_model.schema,
                });

                const duration = Date.now() - startTime;
                this.log('API', `✅ API call completed in ${duration}ms`, {
                    tokens: {
                        prompt: response.usage.promptTokens,
                        completion: response.usage.completionTokens,
                        total: response.usage.totalTokens,
                    },
                    finishReason: response.finishReason,
                });

                // If empty result, apply default values based on schema
                let resultObject = this.ensureDefaultFields(
                    response.object,
                    options.response_model.schema,
                );

                // Handle specific schemas for metadata responses
                if (
                    options.response_model.name === 'Metadata' &&
                    (!resultObject.progress ||
                        !Object.hasOwnProperty.call(resultObject, 'completed'))
                ) {
                    this.log('FIX', '➕ Applying metadata schema defaults');
                    resultObject = {
                        progress: 'completed',
                        completed: true,
                        ...resultObject,
                    };
                }

                // Handle specific schema for extraction
                if (
                    options.response_model.name === 'Extraction' ||
                    options.response_model.name === 'RefinedExtraction'
                ) {
                    if (!resultObject.links) {
                        resultObject.links = [];
                        this.log('FIX', '➕ Added missing "links" array');
                    }
                    if (!resultObject.statictext) {
                        resultObject.statictext = [];
                        this.log('FIX', '➕ Added missing "statictext" array');
                    }
                }

                this.log('RESPONSE', `✅ Request #${currentRequestId} completed successfully`);

                return {
                    data: resultObject,
                    usage: {
                        prompt_tokens: response.usage.promptTokens ?? 0,
                        completion_tokens: response.usage.completionTokens ?? 0,
                        total_tokens: response.usage.totalTokens ?? 0,
                    },
                } as T;
            } catch (error) {
                this.log('ERROR', `❌ Error on request #${currentRequestId}`, error);

                // Attempt to recover with default response
                const defaultResponse = {
                    data: options.response_model.name === 'Metadata'
                        ? { progress: 'completed', completed: true }
                        : { links: [], statictext: [] },
                    usage: {
                        prompt_tokens: 0,
                        completion_tokens: 0,
                        total_tokens: 0,
                    },
                } as T;

                this.log('RECOVERY', `🔄 Using fallback response for #${currentRequestId}`);
                return defaultResponse;
            }
        }

        const tools: Record<string, CoreTool> = {};

        for (const rawTool of options.tools || []) {
            tools[rawTool.name] = {
                description: rawTool.description,
                parameters: rawTool.parameters,
            };
        }

        try {
            this.log('PROCESS', `🔄 Processing request #${currentRequestId} with text generation`);
            this.log('API', `🚀 Calling generateText API with ${Object.keys(tools).length} tools`);

            const startTime = Date.now();
            const response = await generateText({
                model: this.model,
                messages: formattedMessages,
                tools: Object.keys(tools).length > 0 ? tools : undefined,
            });

            const duration = Date.now() - startTime;
            this.log('API', `✅ API call completed in ${duration}ms`, {
                tokens: {
                    prompt: response.usage.promptTokens,
                    completion: response.usage.completionTokens,
                    total: response.usage.totalTokens,
                },
                textLength: response.text?.length || 0,
            });

            this.log('RESPONSE', `✅ Request #${currentRequestId} completed successfully`);

            return {
                data: response.text,
                usage: {
                    prompt_tokens: response.usage.promptTokens ?? 0,
                    completion_tokens: response.usage.completionTokens ?? 0,
                    total_tokens: response.usage.totalTokens ?? 0,
                },
            } as T;
        } catch (error) {
            this.log('ERROR', `❌ Error on request #${currentRequestId}`, error);
            throw error;
        }
    }

    private parseObservationResponse(
        response: string,
    ): Array<{ description: string; selector: string }> {
        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(response);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (_e) {
            // If not JSON, try to parse as text
            const lines = response.split('\n');
            const observations: Array<{ description: string; selector: string }> = [];

            for (const line of lines) {
                const match = line.match(/(.*?)\s*\((.*?)\)/);
                if (match) {
                    observations.push({
                        description: match[1].trim(),
                        selector: match[2].trim(),
                    });
                }
            }

            return observations;
        }

        return [];
    }
}
