/**
 * Safe type conversion utilities with comprehensive error handling
 */

import { z } from 'zod';
import type { DataTransformer, TransformationResult } from '../../types/service.types.ts';

/**
 * Type conversion error class
 */
export class TypeConversionError extends Error {
    constructor(
        message: string,
        public readonly sourceValue: unknown,
        public readonly targetType: string,
        public readonly sourceType: string
    ) {
        super(message);
        this.name = 'TypeConversionError';
    }
}

/**
 * Type conversion options
 */
export interface ConversionOptions {
    strict?: boolean;
    allowPartial?: boolean;
    defaultValue?: unknown;
    customTransformers?: DataTransformer[];
}

/**
 * Type conversion result
 */
export interface ConversionResult<T> {
    success: boolean;
    value?: T;
    originalValue: unknown;
    targetType: string;
    sourceType: string;
    transformationsApplied: string[];
    warnings: string[];
    errors: Error[];
}

/**
 * Safe type converters
 */
export class SafeTypeConverter {
    private transformers: Map<string, DataTransformer> = new Map();

    constructor() {
        this.registerDefaultTransformers();
    }

    /**
     * Register a custom transformer
     */
    registerTransformer(transformer: DataTransformer): void {
        this.transformers.set(transformer.name, transformer);
    }

    /**
     * Get all registered transformers
     */
    getTransformers(): DataTransformer[] {
        return Array.from(this.transformers.values()).sort((a, b) => b.priority - a.priority);
    }

    /**
     * Convert value to target type safely
     */
    async convert<T>(
        value: unknown,
        targetType: string,
        options: ConversionOptions = {}
    ): Promise<ConversionResult<T>> {
        const sourceType = this.getValueType(value);
        const transformationsApplied: string[] = [];
        const warnings: string[] = [];
        const errors: Error[] = [];

        try {
            // Try direct conversion first
            const directResult = this.tryDirectConversion<T>(value, targetType);
            if (directResult.success) {
                return {
                    success: true,
                    value: directResult.value,
                    originalValue: value,
                    targetType,
                    sourceType,
                    transformationsApplied,
                    warnings,
                    errors,
                };
            }

            // Try registered transformers
            const transformers = options.customTransformers || this.getTransformers();
            for (const transformer of transformers) {
                if (transformer.canTransform(value, targetType)) {
                    try {
                        const transformed = transformer.transform(value);
                        const convertedResult = this.tryDirectConversion<T>(transformed, targetType);
                        
                        if (convertedResult.success) {
                            transformationsApplied.push(transformer.name);
                            return {
                                success: true,
                                value: convertedResult.value,
                                originalValue: value,
                                targetType,
                                sourceType,
                                transformationsApplied,
                                warnings,
                                errors,
                            };
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        warnings.push(`Transformer ${transformer.name} failed: ${errorMessage}`);
                    }
                }
            }

            // Use default value if provided
            if (options.defaultValue !== undefined) {
                const defaultResult = this.tryDirectConversion<T>(options.defaultValue, targetType);
                if (defaultResult.success) {
                    transformationsApplied.push('default-value');
                    warnings.push('Used default value due to conversion failure');
                    return {
                        success: true,
                        value: defaultResult.value,
                        originalValue: value,
                        targetType,
                        sourceType,
                        transformationsApplied,
                        warnings,
                        errors,
                    };
                }
            }

            // Conversion failed
            const error = new TypeConversionError(
                `Cannot convert ${sourceType} to ${targetType}`,
                value,
                targetType,
                sourceType
            );
            errors.push(error);

            return {
                success: false,
                originalValue: value,
                targetType,
                sourceType,
                transformationsApplied,
                warnings,
                errors,
            };

        } catch (error) {
            errors.push(error as Error);
            return {
                success: false,
                originalValue: value,
                targetType,
                sourceType,
                transformationsApplied,
                warnings,
                errors,
            };
        }
    }

    /**
     * Convert object properties safely
     */
    async convertObject<T extends Record<string, unknown>>(
        obj: Record<string, unknown>,
        typeMap: Record<keyof T, string>,
        options: ConversionOptions = {}
    ): Promise<TransformationResult> {
        const transformersApplied: string[] = [];
        const warnings: string[] = [];
        const errors: Error[] = [];
        const converted: Record<string, unknown> = {};

        for (const [key, targetType] of Object.entries(typeMap)) {
            const value = obj[key];
            const result = await this.convert(value, targetType, options);

            if (result.success) {
                converted[key] = result.value;
                transformersApplied.push(...result.transformationsApplied);
                warnings.push(...result.warnings);
            } else {
                errors.push(...result.errors);
                if (!options.allowPartial) {
                    return {
                        success: false,
                        data: obj,
                        originalData: obj,
                        transformersApplied,
                        errors,
                        warnings,
                    };
                }
                // Use original value for partial conversion
                converted[key] = value;
                warnings.push(`Failed to convert ${key}, using original value`);
            }
        }

        return {
            success: errors.length === 0 || (options.allowPartial ?? false),
            data: converted,
            originalData: obj,
            transformersApplied,
            errors,
            warnings,
        };
    }

    /**
     * Try direct type conversion without transformers
     */
    private tryDirectConversion<T>(value: unknown, targetType: string): { success: boolean; value?: T } {
        try {
            switch (targetType.toLowerCase()) {
                case 'string':
                    return { success: true, value: this.toString(value) as T };
                case 'number':
                    return { success: true, value: this.toNumber(value) as T };
                case 'boolean':
                    return { success: true, value: this.toBoolean(value) as T };
                case 'array':
                    return { success: true, value: this.toArray(value) as T };
                case 'object':
                    return { success: true, value: this.toObject(value) as T };
                case 'date':
                    return { success: true, value: this.toDate(value) as T };
                default:
                    return { success: false };
            }
        } catch {
            return { success: false };
        }
    }

    /**
     * Get the type of a value
     */
    private getValueType(value: unknown): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (Array.isArray(value)) return 'array';
        if (value instanceof Date) return 'date';
        return typeof value;
    }

    /**
     * Convert to string safely
     */
    private toString(value: unknown): string {
        if (typeof value === 'string') return value;
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch {
                return '[object Object]';
            }
        }
        return String(value);
    }

    /**
     * Convert to number safely
     */
    private toNumber(value: unknown): number {
        if (typeof value === 'number') {
            if (isNaN(value) || !isFinite(value)) {
                throw new Error('Invalid number value');
            }
            return value;
        }
        
        if (typeof value === 'string') {
            // Handle percentage strings
            if (value.includes('%')) {
                const numStr = value.replace('%', '').trim();
                const parsed = parseFloat(numStr);
                if (isNaN(parsed)) throw new Error('Invalid percentage string');
                return parsed;
            }
            
            // Handle regular number strings
            const parsed = parseFloat(value);
            if (isNaN(parsed)) throw new Error('Invalid number string');
            return parsed;
        }
        
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        
        throw new Error('Cannot convert to number');
    }

    /**
     * Convert to boolean safely
     */
    private toBoolean(value: unknown): boolean {
        if (typeof value === 'boolean') return value;
        
        if (typeof value === 'string') {
            const normalized = value.toLowerCase().trim();
            if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
            if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
            throw new Error('Invalid boolean string');
        }
        
        if (typeof value === 'number') {
            return value !== 0;
        }
        
        if (value === null || value === undefined) {
            return false;
        }
        
        throw new Error('Cannot convert to boolean');
    }

    /**
     * Convert to array safely
     */
    private toArray(value: unknown): unknown[] {
        if (Array.isArray(value)) return value;
        if (value === null || value === undefined) return [];
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) return parsed;
            } catch {
                // Treat as single-item array
                return [value];
            }
        }
        return [value];
    }

    /**
     * Convert to object safely
     */
    private toObject(value: unknown): Record<string, unknown> {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
        
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    return parsed;
                }
            } catch {
                // Return object with string value
                return { value };
            }
        }
        
        if (value === null || value === undefined) {
            return {};
        }
        
        return { value };
    }

    /**
     * Convert to date safely
     */
    private toDate(value: unknown): Date {
        if (value instanceof Date) {
            if (isNaN(value.getTime())) {
                throw new Error('Invalid date object');
            }
            return value;
        }
        
        if (typeof value === 'string' || typeof value === 'number') {
            const date = new Date(value);
            if (isNaN(date.getTime())) {
                throw new Error('Invalid date string/number');
            }
            return date;
        }
        
        throw new Error('Cannot convert to date');
    }

    /**
     * Register default transformers
     */
    private registerDefaultTransformers(): void {
        // Coverage field transformer
        this.registerTransformer({
            name: 'coverage-transformer',
            description: 'Transforms coverage strings to numbers',
            priority: 10,
            canTransform: (data: unknown, targetType: string) => {
                return targetType === 'number' && 
                       typeof data === 'string' && 
                       (data.includes('%') || /^\d+(\.\d+)?$/.test(data.trim()));
            },
            transform: (data: unknown) => {
                if (typeof data !== 'string') return data;
                const cleaned = data.replace(/[%\s]/g, '');
                const parsed = parseFloat(cleaned);
                if (isNaN(parsed)) return 0;
                return Math.min(100, Math.max(0, Math.round(parsed)));
            },
        });

        // Boolean string transformer
        this.registerTransformer({
            name: 'boolean-string-transformer',
            description: 'Transforms boolean strings to booleans',
            priority: 10,
            canTransform: (data: unknown, targetType: string) => {
                return targetType === 'boolean' && typeof data === 'string';
            },
            transform: (data: unknown) => {
                if (typeof data !== 'string') return data;
                const normalized = data.toLowerCase().trim();
                return ['true', '1', 'yes', 'on'].includes(normalized);
            },
        });

        // Enum normalizer
        this.registerTransformer({
            name: 'enum-normalizer',
            description: 'Normalizes string values for enums',
            priority: 5,
            canTransform: (data: unknown, targetType: string) => {
                return typeof data === 'string' && targetType.includes('enum');
            },
            transform: (data: unknown) => {
                if (typeof data !== 'string') return data;
                return data.toLowerCase().trim();
            },
        });

        // Array normalizer
        this.registerTransformer({
            name: 'array-normalizer',
            description: 'Ensures arrays are properly formatted',
            priority: 5,
            canTransform: (data: unknown, targetType: string) => {
                return targetType === 'array' && !Array.isArray(data);
            },
            transform: (data: unknown) => {
                if (data === null || data === undefined) return [];
                if (Array.isArray(data)) return data;
                return [data];
            },
        });

        // String cleaner
        this.registerTransformer({
            name: 'string-cleaner',
            description: 'Cleans and normalizes strings',
            priority: 1,
            canTransform: (data: unknown, targetType: string) => {
                return targetType === 'string' && typeof data === 'string';
            },
            transform: (data: unknown) => {
                if (typeof data !== 'string') return data;
                return data.trim().replace(/\s+/g, ' ');
            },
        });
    }
}

/**
 * Global converter instance
 */
export const typeConverter = new SafeTypeConverter();

/**
 * Convenience functions using the global converter
 */
export async function safeConvert<T>(
    value: unknown,
    targetType: string,
    options?: ConversionOptions
): Promise<ConversionResult<T>> {
    return typeConverter.convert<T>(value, targetType, options);
}

export async function safeConvertObject<T extends Record<string, unknown>>(
    obj: Record<string, unknown>,
    typeMap: Record<keyof T, string>,
    options?: ConversionOptions
): Promise<TransformationResult> {
    return typeConverter.convertObject<T>(obj, typeMap, options);
}

/**
 * Zod schema with safe conversion
 */
export function createSafeSchema<T>(
    baseSchema: z.ZodType<T>,
    conversions?: Record<string, string>
): z.ZodType<T> {
    return baseSchema.transform(async (data) => {
        if (!conversions) return data;
        
        const result = await safeConvertObject(
            data as Record<string, unknown>,
            conversions,
            { allowPartial: true }
        );
        
        return result.success ? result.data as T : data;
    });
}

/**
 * Batch conversion utility
 */
export async function batchConvert<T>(
    values: unknown[],
    targetType: string,
    options: ConversionOptions & { maxConcurrency?: number } = {}
): Promise<{
    results: Array<ConversionResult<T>>;
    successCount: number;
    errorCount: number;
    totalTime: number;
}> {
    const startTime = Date.now();
    const { maxConcurrency = 10, ...conversionOptions } = options;
    
    const results: Array<ConversionResult<T>> = [];
    let successCount = 0;
    let errorCount = 0;
    
    // Process in batches
    for (let i = 0; i < values.length; i += maxConcurrency) {
        const batch = values.slice(i, i + maxConcurrency);
        const batchPromises = batch.map(value => 
            typeConverter.convert<T>(value, targetType, conversionOptions)
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        for (const result of batchResults) {
            if (result.success) {
                successCount++;
            } else {
                errorCount++;
            }
        }
    }
    
    return {
        results,
        successCount,
        errorCount,
        totalTime: Date.now() - startTime,
    };
}

/**
 * Type conversion middleware for API responses
 */
export function createConversionMiddleware<T>(
    schema: z.ZodType<T>,
    conversions: Record<string, string>
) {
    return async (data: unknown): Promise<T> => {
        // First apply conversions
        const conversionResult = await safeConvertObject(
            data as Record<string, unknown>,
            conversions,
            { allowPartial: true }
        );
        
        // Then validate with schema
        const validationData = conversionResult.success ? conversionResult.data : data;
        return schema.parse(validationData);
    };
}