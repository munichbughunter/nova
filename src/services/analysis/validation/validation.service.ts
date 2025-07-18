import { z } from 'zod';
import type { Logger } from '../../../utils/logger.ts';
import type { MonitoringService } from '../../monitoring/monitoring.service.ts';

/**
 * Result of validation with transformation
 */
export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    originalData: unknown;
    transformationsApplied: string[];
    errors: z.ZodError[];
    warnings: string[];
}

/**
 * Data transformer interface for converting data types
 */
export interface DataTransformer {
    name: string;
    transform(data: unknown): unknown;
    canTransform(data: unknown, targetType: string): boolean;
    priority: number; // Higher priority transformers run first
}

/**
 * Error recovery strategy interface
 */
export interface ErrorRecoveryStrategy {
    name: string;
    canRecover(error: z.ZodError, data: unknown): boolean;
    recover<T>(error: z.ZodError, data: unknown, schema: z.ZodType<T>): Promise<RecoveryResult<T>>;
    priority: number;
}

/**
 * Recovery result from error recovery strategies
 */
export interface RecoveryResult<T> {
    success: boolean;
    data?: T;
    errors: z.ZodError[];
    transformationsApplied: string[];
    warnings: string[];
}

/**
 * Validation service with intelligent error recovery and data transformation
 */
export class ValidationService {
    private logger: Logger;
    private transformers: Map<string, DataTransformer> = new Map();
    private recoveryStrategies: Map<string, ErrorRecoveryStrategy> = new Map();
    private monitoringService?: MonitoringService;

    constructor(logger: Logger, monitoringService?: MonitoringService) {
        this.logger = logger.child('ValidationService');
        this.monitoringService = monitoringService;
        this.initializeDefaultTransformers();
        this.initializeDefaultRecoveryStrategies();
    }

    /**
     * Validate data with transformation and error recovery
     */
    async validateWithTransformation<T>(
        data: unknown,
        schema: z.ZodType<T>,
        customTransformers?: DataTransformer[]
    ): Promise<ValidationResult<T>> {
        const startTime = Date.now();
        const warnings: string[] = [];
        const transformationsApplied: string[] = [];
        const originalData = data;
        let errorRecoveryUsed = false;
        let errorRecoverySuccess = false;
        const validationErrors: string[] = [];

        this.logger.debug('Starting validation with transformation', {
            dataType: typeof data,
            hasCustomTransformers: !!customTransformers?.length
        });

        try {
            // Step 1: Apply pre-validation transformations
            let transformedData = this.applyPreValidationTransforms(
                data,
                customTransformers
            );

            if (transformedData !== data) {
                transformationsApplied.push('pre-validation-transforms');
                this.logger.debug('Applied pre-validation transformations');
            }

            // Step 2: Attempt initial validation
            try {
                const validated = schema.parse(transformedData);
                this.logger.debug('Initial validation successful');
                
                const result = {
                    success: true,
                    data: validated,
                    originalData,
                    transformationsApplied,
                    errors: [],
                    warnings
                };

                // Record successful validation metrics
                if (this.monitoringService) {
                    const duration = Date.now() - startTime;
                    this.monitoringService.recordValidation(
                        true,
                        duration,
                        transformationsApplied,
                        errorRecoveryUsed,
                        errorRecoverySuccess,
                        validationErrors
                    );
                }

                return result;
            } catch (validationError) {
                const zodError = validationError as z.ZodError;
                
                // Extract error types for monitoring
                for (const issue of zodError.issues) {
                    validationErrors.push(issue.code);
                }

                this.logger.debug('Initial validation failed, attempting error recovery', {
                    errorCount: zodError.issues?.length || 0
                });

                // Step 3: Attempt error recovery
                errorRecoveryUsed = true;
                const recoveryResult = await this.attemptErrorRecovery(
                    zodError,
                    transformedData,
                    schema
                );

                if (recoveryResult.success) {
                    errorRecoverySuccess = true;
                    transformationsApplied.push(...recoveryResult.transformationsApplied);
                    warnings.push(...recoveryResult.warnings);
                    warnings.push(`Data transformation applied: ${recoveryResult.transformationsApplied.join(', ')}`);
                    
                    const result = {
                        success: true,
                        data: recoveryResult.data!,
                        originalData,
                        transformationsApplied,
                        errors: [],
                        warnings
                    };

                    // Record successful validation with error recovery
                    if (this.monitoringService) {
                        const duration = Date.now() - startTime;
                        this.monitoringService.recordValidation(
                            true,
                            duration,
                            transformationsApplied,
                            errorRecoveryUsed,
                            errorRecoverySuccess,
                            validationErrors
                        );
                    }

                    return result;
                }

                // Step 4: Return failure with detailed error information
                const result = {
                    success: false,
                    data: undefined,
                    originalData,
                    transformationsApplied,
                    errors: [zodError, ...recoveryResult.errors],
                    warnings: [...warnings, ...recoveryResult.warnings]
                };

                // Record failed validation
                if (this.monitoringService) {
                    const duration = Date.now() - startTime;
                    this.monitoringService.recordValidation(
                        false,
                        duration,
                        transformationsApplied,
                        errorRecoveryUsed,
                        errorRecoverySuccess,
                        validationErrors
                    );
                }

                return result;
            }
        } catch (error) {
            this.logger.error('Validation service error', { error });
            
            const result = {
                success: false,
                data: undefined,
                originalData,
                transformationsApplied,
                errors: [error as z.ZodError],
                warnings: [...warnings, 'Unexpected error during validation']
            };

            // Record failed validation due to unexpected error
            if (this.monitoringService) {
                const duration = Date.now() - startTime;
                validationErrors.push('unexpected_error');
                this.monitoringService.recordValidation(
                    false,
                    duration,
                    transformationsApplied,
                    errorRecoveryUsed,
                    errorRecoverySuccess,
                    validationErrors
                );
            }

            return result;
        }
    }

    /**
     * Register a custom data transformer
     */
    registerTransformer(transformer: DataTransformer): void {
        this.transformers.set(transformer.name, transformer);
        this.logger.debug(`Registered transformer: ${transformer.name}`);
    }

    /**
     * Register a custom error recovery strategy
     */
    registerRecoveryStrategy(strategy: ErrorRecoveryStrategy): void {
        this.recoveryStrategies.set(strategy.name, strategy);
        this.logger.debug(`Registered recovery strategy: ${strategy.name}`);
    }

    /**
     * Get available transformers sorted by priority
     */
    getAvailableTransformers(): DataTransformer[] {
        return Array.from(this.transformers.values())
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * Get available recovery strategies sorted by priority
     */
    getAvailableRecoveryStrategies(): ErrorRecoveryStrategy[] {
        return Array.from(this.recoveryStrategies.values())
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * Apply pre-validation transformations
     */
    private applyPreValidationTransforms(
        data: unknown,
        customTransformers?: DataTransformer[]
    ): unknown {
        if (typeof data !== 'object' || data === null) {
            return data;
        }

        let transformedData = { ...data as Record<string, unknown> };
        const allTransformers = [
            ...this.getAvailableTransformers(),
            ...(customTransformers || [])
        ].sort((a, b) => b.priority - a.priority);

        // Apply specific field transformations
        if ('coverage' in transformedData) {
            const coverageTransformer = this.transformers.get('coverage-transformer');
            if (coverageTransformer && coverageTransformer.canTransform(transformedData.coverage, 'number')) {
                const originalValue = transformedData.coverage;
                transformedData.coverage = coverageTransformer.transform(transformedData.coverage);
                
                if (transformedData.coverage !== originalValue) {
                    this.logger.debug(`Applied coverage transformer`, {
                        original: originalValue,
                        transformed: transformedData.coverage
                    });
                }
            }
        }

        if ('testsPresent' in transformedData) {
            const booleanTransformer = this.transformers.get('boolean-transformer');
            if (booleanTransformer && booleanTransformer.canTransform(transformedData.testsPresent, 'boolean')) {
                const originalValue = transformedData.testsPresent;
                transformedData.testsPresent = booleanTransformer.transform(transformedData.testsPresent);
                
                if (transformedData.testsPresent !== originalValue) {
                    this.logger.debug(`Applied boolean transformer`, {
                        original: originalValue,
                        transformed: transformedData.testsPresent
                    });
                }
            }
        }

        // Apply enum normalizers
        const enumTransformer = this.transformers.get('enum-normalizer');
        if (enumTransformer) {
            for (const field of ['grade', 'value', 'state']) {
                if (field in transformedData && typeof transformedData[field] === 'string') {
                    const originalValue = transformedData[field];
                    transformedData[field] = enumTransformer.transform(transformedData[field]);
                    
                    if (transformedData[field] !== originalValue) {
                        this.logger.debug(`Applied enum normalizer to ${field}`, {
                            original: originalValue,
                            transformed: transformedData[field]
                        });
                    }
                }
            }
        }

        // Apply array and string defaults
        const arrayTransformer = this.transformers.get('array-default');
        const stringTransformer = this.transformers.get('string-default');
        
        for (const field of ['issues', 'suggestions']) {
            if (arrayTransformer && arrayTransformer.canTransform(transformedData[field], 'array')) {
                transformedData[field] = arrayTransformer.transform(transformedData[field]);
            }
        }
        
        if (stringTransformer && stringTransformer.canTransform(transformedData.summary, 'string')) {
            transformedData.summary = stringTransformer.transform(transformedData.summary);
        }

        // Apply custom transformers
        if (customTransformers) {
            for (const [key, value] of Object.entries(transformedData)) {
                for (const transformer of customTransformers) {
                    if (transformer.canTransform(value, 'unknown')) {
                        const originalValue = transformedData[key];
                        transformedData[key] = transformer.transform(value);
                        
                        if (transformedData[key] !== originalValue) {
                            this.logger.debug(`Applied custom transformer ${transformer.name} to field ${key}`, {
                                original: originalValue,
                                transformed: transformedData[key]
                            });
                        }
                        break;
                    }
                }
            }
        }

        return transformedData;
    }

    /**
     * Attempt error recovery using registered strategies
     */
    private async attemptErrorRecovery<T>(
        error: z.ZodError,
        data: unknown,
        schema: z.ZodType<T>
    ): Promise<RecoveryResult<T>> {
        const strategies = this.getAvailableRecoveryStrategies();
        const allErrors: z.ZodError[] = [error];
        const allWarnings: string[] = [];
        const allTransformations: string[] = [];

        this.logger.debug(`Attempting error recovery with ${strategies.length} strategies`);

        for (const strategy of strategies) {
            if (strategy.canRecover(error, data)) {
                this.logger.debug(`Trying recovery strategy: ${strategy.name}`);
                
                try {
                    const result = await strategy.recover(error, data, schema);
                    
                    if (result.success) {
                        this.logger.debug(`Recovery successful with strategy: ${strategy.name}`);
                        return {
                            success: true,
                            data: result.data!,
                            errors: [],
                            transformationsApplied: [...allTransformations, ...result.transformationsApplied],
                            warnings: [...allWarnings, ...result.warnings]
                        };
                    } else {
                        allErrors.push(...result.errors);
                        allWarnings.push(...result.warnings);
                        allTransformations.push(...result.transformationsApplied);
                    }
                } catch (strategyError) {
                    this.logger.debug(`Recovery strategy ${strategy.name} failed`, { error: strategyError });
                    allWarnings.push(`Recovery strategy ${strategy.name} failed: ${strategyError instanceof Error ? strategyError.message : 'Unknown error'}`);
                }
            }
        }

        return {
            success: false,
            errors: allErrors,
            transformationsApplied: allTransformations,
            warnings: allWarnings
        };
    }

    /**
     * Initialize default data transformers
     */
    private initializeDefaultTransformers(): void {
        // Coverage field transformer (string to number)
        this.registerTransformer({
            name: 'coverage-transformer',
            priority: 100,
            canTransform: (data: unknown, targetType: string) => {
                return typeof data === 'string' && 
                       (targetType === 'number' || targetType === 'unknown');
            },
            transform: (data: unknown) => {
                if (typeof data === 'number') {
                    return Math.min(100, Math.max(0, Math.round(data)));
                }
                
                if (typeof data === 'string') {
                    // Handle various string formats: "75%", "75", " 75 ", etc.
                    const cleaned = data.replace(/[%\s]/g, '');
                    const parsed = parseFloat(cleaned);
                    
                    if (isNaN(parsed)) {
                        return 0;
                    }
                    
                    return Math.min(100, Math.max(0, Math.round(parsed)));
                }
                
                return 0;
            }
        });

        // Boolean field transformer (string/number to boolean)
        this.registerTransformer({
            name: 'boolean-transformer',
            priority: 90,
            canTransform: (data: unknown, targetType: string) => {
                return (typeof data === 'string' || typeof data === 'number') && 
                       (targetType === 'boolean' || targetType === 'unknown');
            },
            transform: (data: unknown) => {
                if (typeof data === 'boolean') {
                    return data;
                }
                
                if (typeof data === 'string') {
                    const normalized = data.toLowerCase().trim();
                    return normalized === 'true' || normalized === '1' || normalized === 'yes';
                }
                
                if (typeof data === 'number') {
                    return data !== 0;
                }
                
                return false;
            }
        });

        // Enum normalizer transformer
        this.registerTransformer({
            name: 'enum-normalizer',
            priority: 80,
            canTransform: (data: unknown, targetType: string) => {
                return typeof data === 'string';
            },
            transform: (data: unknown) => {
                if (typeof data !== 'string') return data;
                
                const normalized = data.toLowerCase().trim();
                
                // Grade normalization
                if (['a', 'b', 'c', 'd', 'f'].includes(normalized)) {
                    return normalized.toUpperCase();
                }
                
                // Value normalization
                if (['high', 'medium', 'low'].includes(normalized)) {
                    return normalized;
                }
                
                // State normalization
                if (['pass', 'warning', 'fail'].includes(normalized)) {
                    return normalized;
                }
                
                return data;
            }
        });

        // Array default transformer
        this.registerTransformer({
            name: 'array-default',
            priority: 70,
            canTransform: (data: unknown, targetType: string) => {
                return data === undefined || data === null;
            },
            transform: (data: unknown) => {
                if (data === undefined || data === null) {
                    return [];
                }
                return data;
            }
        });

        // String default transformer
        this.registerTransformer({
            name: 'string-default',
            priority: 60,
            canTransform: (data: unknown, targetType: string) => {
                return data === undefined || data === null;
            },
            transform: (data: unknown) => {
                if (data === undefined || data === null) {
                    return '';
                }
                return data;
            }
        });
    }

    /**
     * Initialize default error recovery strategies
     */
    private initializeDefaultRecoveryStrategies(): void {
        // Type coercion recovery strategy
        this.registerRecoveryStrategy({
            name: 'type-coercion',
            priority: 100,
            canRecover: (error: z.ZodError, data: unknown) => {
                return error.issues.some(issue => issue.code === 'invalid_type');
            },
            recover: async <T>(error: z.ZodError, data: unknown, schema: z.ZodType<T>) => {
                const transformedData = this.applyTypeCoercionTransforms(error, data);
                const transformationsApplied = ['type-coercion'];
                
                try {
                    const validated = schema.parse(transformedData);
                    return {
                        success: true,
                        data: validated,
                        errors: [],
                        transformationsApplied,
                        warnings: []
                    };
                } catch (newError) {
                    return {
                        success: false,
                        errors: [newError as z.ZodError],
                        transformationsApplied,
                        warnings: ['Type coercion failed']
                    };
                }
            }
        });

        // Missing field recovery strategy
        this.registerRecoveryStrategy({
            name: 'missing-field-defaults',
            priority: 90,
            canRecover: (error: z.ZodError, data: unknown) => {
                return error.issues.some(issue => 
                    issue.code === 'invalid_type' && issue.received === 'undefined'
                );
            },
            recover: async <T>(error: z.ZodError, data: unknown, schema: z.ZodType<T>) => {
                const transformedData = this.applyMissingFieldDefaults(error, data);
                const transformationsApplied = ['missing-field-defaults'];
                
                try {
                    const validated = schema.parse(transformedData);
                    return {
                        success: true,
                        data: validated,
                        errors: [],
                        transformationsApplied,
                        warnings: ['Applied default values for missing fields']
                    };
                } catch (newError) {
                    return {
                        success: false,
                        errors: [newError as z.ZodError],
                        transformationsApplied,
                        warnings: ['Missing field defaults failed']
                    };
                }
            }
        });

        // Partial recovery strategy (for objects with some valid fields)
        this.registerRecoveryStrategy({
            name: 'partial-recovery',
            priority: 80,
            canRecover: (error: z.ZodError, data: unknown) => {
                return typeof data === 'object' && data !== null && 
                       error.issues.length < Object.keys(data).length;
            },
            recover: async <T>(error: z.ZodError, data: unknown, schema: z.ZodType<T>) => {
                const transformedData = this.applyPartialRecovery(error, data);
                const transformationsApplied = ['partial-recovery'];
                
                try {
                    const validated = schema.parse(transformedData);
                    return {
                        success: true,
                        data: validated,
                        errors: [],
                        transformationsApplied,
                        warnings: ['Recovered partial data with defaults for invalid fields']
                    };
                } catch (newError) {
                    return {
                        success: false,
                        errors: [newError as z.ZodError],
                        transformationsApplied,
                        warnings: ['Partial recovery failed']
                    };
                }
            }
        });
    }

    /**
     * Apply type coercion transformations based on validation errors
     */
    private applyTypeCoercionTransforms(error: z.ZodError, data: unknown): unknown {
        if (typeof data !== 'object' || data === null) {
            return data;
        }

        const transformed = { ...data as Record<string, unknown> };

        for (const issue of error.issues) {
            const fieldPath = issue.path.join('.');
            
            if (issue.code === 'invalid_type') {
                if (fieldPath === 'coverage' && issue.expected === 'number') {
                    const coverageTransformer = this.transformers.get('coverage-transformer');
                    if (coverageTransformer) {
                        transformed.coverage = coverageTransformer.transform(transformed.coverage);
                    }
                } else if (fieldPath === 'testsPresent' && issue.expected === 'boolean') {
                    const booleanTransformer = this.transformers.get('boolean-transformer');
                    if (booleanTransformer) {
                        transformed.testsPresent = booleanTransformer.transform(transformed.testsPresent);
                    }
                }
            }
        }

        return transformed;
    }

    /**
     * Apply default values for missing fields
     */
    private applyMissingFieldDefaults(error: z.ZodError, data: unknown): unknown {
        if (typeof data !== 'object' || data === null) {
            return data;
        }

        const transformed = { ...data as Record<string, unknown> };

        for (const issue of error.issues) {
            const fieldPath = issue.path.join('.');
            
            if (issue.code === 'invalid_type' && issue.received === 'undefined') {
                switch (fieldPath) {
                    case 'issues':
                        transformed.issues = [];
                        break;
                    case 'suggestions':
                        transformed.suggestions = [];
                        break;
                    case 'summary':
                        transformed.summary = 'Analysis completed';
                        break;
                    case 'grade':
                        transformed.grade = 'C';
                        break;
                    case 'coverage':
                        transformed.coverage = 0;
                        break;
                    case 'testsPresent':
                        transformed.testsPresent = false;
                        break;
                    case 'value':
                        transformed.value = 'medium';
                        break;
                    case 'state':
                        transformed.state = 'warning';
                        break;
                }
            }
        }

        return transformed;
    }

    /**
     * Apply partial recovery by providing defaults for invalid fields
     */
    private applyPartialRecovery(error: z.ZodError, data: unknown): unknown {
        if (typeof data !== 'object' || data === null) {
            return data;
        }

        const transformed = { ...data as Record<string, unknown> };

        // Apply both type coercion and missing field defaults
        const typeCoerced = this.applyTypeCoercionTransforms(error, transformed);
        const withDefaults = this.applyMissingFieldDefaults(error, typeCoerced);

        return withDefaults;
    }
}