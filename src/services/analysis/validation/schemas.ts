import { z } from 'zod';

/**
 * Flexible schema variants that handle string/number conversions
 * These schemas are more permissive and allow for data transformation
 */

/**
 * Flexible coverage field that accepts string or number
 */
const FlexibleCoverageSchema = z.union([
    z.number().min(0).max(100),
    z.string()
]).transform((val) => {
    if (typeof val === 'number') {
        return Math.min(100, Math.max(0, Math.round(val)));
    }
    
    if (typeof val === 'string') {
        // Handle percentage strings like "75%" or "75"
        const cleaned = val.replace(/[%\s]/g, '');
        const parsed = parseFloat(cleaned);
        
        if (isNaN(parsed)) {
            return 0;
        }
        
        return Math.min(100, Math.max(0, Math.round(parsed)));
    }
    
    return 0;
});

/**
 * Flexible boolean field that accepts string, number, or boolean
 */
const FlexibleBooleanSchema = z.union([
    z.boolean(),
    z.string(),
    z.number()
]).transform((val) => {
    if (typeof val === 'boolean') {
        return val;
    }
    
    if (typeof val === 'string') {
        const normalized = val.toLowerCase().trim();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    
    if (typeof val === 'number') {
        return val !== 0;
    }
    
    return false;
});

/**
 * Flexible enum schema that normalizes string values
 */
const FlexibleGradeSchema = z.union([
    z.enum(['A', 'B', 'C', 'D', 'F']),
    z.string()
]).transform((val) => {
    if (typeof val === 'string') {
        const normalized = val.toUpperCase().trim();
        if (['A', 'B', 'C', 'D', 'F'].includes(normalized)) {
            return normalized as 'A' | 'B' | 'C' | 'D' | 'F';
        }
    }
    return 'C' as const; // Default grade
});

/**
 * Flexible value enum schema
 */
const FlexibleValueSchema = z.union([
    z.enum(['high', 'medium', 'low']),
    z.string()
]).transform((val) => {
    if (typeof val === 'string') {
        const normalized = val.toLowerCase().trim();
        if (['high', 'medium', 'low'].includes(normalized)) {
            return normalized as 'high' | 'medium' | 'low';
        }
    }
    return 'medium' as const; // Default value
});

/**
 * Flexible state enum schema
 */
const FlexibleStateSchema = z.union([
    z.enum(['pass', 'warning', 'fail']),
    z.string()
]).transform((val) => {
    if (typeof val === 'string') {
        const normalized = val.toLowerCase().trim();
        if (['pass', 'warning', 'fail'].includes(normalized)) {
            return normalized as 'pass' | 'warning' | 'fail';
        }
    }
    return 'warning' as const; // Default state
});

/**
 * Code issue schema with flexible fields
 */
const FlexibleCodeIssueSchema = z.object({
    line: z.union([z.number(), z.string()]).transform((val) => {
        if (typeof val === 'number') return val;
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? 1 : parsed;
    }),
    severity: z.union([
        z.enum(['low', 'medium', 'high']),
        z.string()
    ]).transform((val) => {
        if (typeof val === 'string') {
            const normalized = val.toLowerCase().trim();
            if (['low', 'medium', 'high'].includes(normalized)) {
                return normalized as 'low' | 'medium' | 'high';
            }
        }
        return 'medium' as const;
    }),
    type: z.union([
        z.enum(['security', 'performance', 'style', 'bug']),
        z.string()
    ]).transform((val) => {
        if (typeof val === 'string') {
            const normalized = val.toLowerCase().trim();
            if (['security', 'performance', 'style', 'bug'].includes(normalized)) {
                return normalized as 'security' | 'performance' | 'style' | 'bug';
            }
        }
        return 'style' as const;
    }),
    message: z.string().default('No message provided'),
});

/**
 * Flexible array schema that provides defaults for missing arrays
 */
const FlexibleArraySchema = <T>(itemSchema: z.ZodType<T>) => 
    z.union([
        z.array(itemSchema),
        z.undefined(),
        z.null()
    ]).transform((val) => {
        if (Array.isArray(val)) return val;
        return [];
    });

/**
 * Flexible string schema that provides defaults for missing strings
 */
const FlexibleStringSchema = (defaultValue: string = '') =>
    z.union([
        z.string(),
        z.undefined(),
        z.null()
    ]).transform((val) => {
        if (typeof val === 'string') return val;
        return defaultValue;
    });

/**
 * Strict review analysis schema (original)
 * This is the target schema that expects exact types
 */
export const StrictReviewAnalysisSchema = z.object({
    grade: z.enum(['A', 'B', 'C', 'D', 'F']).describe('Overall code quality grade'),
    coverage: z.number().min(0).max(100).describe('Test coverage percentage'),
    testsPresent: z.boolean().describe('Whether tests are present for this file'),
    value: z.enum(['high', 'medium', 'low']).describe('Business value assessment'),
    state: z.enum(['pass', 'warning', 'fail']).describe('Overall review state'),
    issues: z.array(z.object({
        line: z.number(),
        severity: z.enum(['low', 'medium', 'high']),
        type: z.enum(['security', 'performance', 'style', 'bug']),
        message: z.string(),
    })),
    suggestions: z.array(z.string()).describe('Improvement suggestions'),
    summary: z.string().describe('Brief summary of the analysis'),
});

/**
 * Flexible review analysis schema for LLM responses
 * This schema is more permissive and handles type conversions automatically
 */
export const FlexibleReviewAnalysisSchema = z.object({
    grade: FlexibleGradeSchema.describe('Overall code quality grade'),
    coverage: FlexibleCoverageSchema.describe('Test coverage percentage'),
    testsPresent: FlexibleBooleanSchema.describe('Whether tests are present for this file'),
    value: FlexibleValueSchema.describe('Business value assessment'),
    state: FlexibleStateSchema.describe('Overall review state'),
    issues: FlexibleArraySchema(FlexibleCodeIssueSchema).describe('List of code issues'),
    suggestions: FlexibleArraySchema(z.string()).describe('Improvement suggestions'),
    summary: FlexibleStringSchema('Analysis completed').describe('Brief summary of the analysis'),
});

/**
 * Partial review analysis schema for recovery scenarios
 * This schema makes most fields optional with sensible defaults
 */
export const PartialReviewAnalysisSchema = z.object({
    grade: FlexibleGradeSchema.optional().default('C'),
    coverage: FlexibleCoverageSchema.optional().default(0),
    testsPresent: FlexibleBooleanSchema.optional().default(false),
    value: FlexibleValueSchema.optional().default('medium'),
    state: FlexibleStateSchema.optional().default('warning'),
    issues: FlexibleArraySchema(FlexibleCodeIssueSchema).optional().default([]),
    suggestions: FlexibleArraySchema(z.string()).optional().default([]),
    summary: FlexibleStringSchema('Analysis completed').optional().default('Analysis completed'),
});

/**
 * Schema registry for different validation scenarios
 */
export const SchemaRegistry = {
    strict: StrictReviewAnalysisSchema,
    flexible: FlexibleReviewAnalysisSchema,
    partial: PartialReviewAnalysisSchema,
} as const;

/**
 * Type inference for schemas
 */
export type StrictReviewAnalysis = z.infer<typeof StrictReviewAnalysisSchema>;
export type FlexibleReviewAnalysis = z.infer<typeof FlexibleReviewAnalysisSchema>;
export type PartialReviewAnalysis = z.infer<typeof PartialReviewAnalysisSchema>;

/**
 * Schema selection utility
 */
export function getSchemaForValidation(
    strategy: 'strict' | 'flexible' | 'partial' = 'flexible'
): z.ZodType<any> {
    return SchemaRegistry[strategy];
}

/**
 * Validation mode configuration
 */
export interface ValidationMode {
    schema: 'strict' | 'flexible' | 'partial';
    enableTransformation: boolean;
    enableErrorRecovery: boolean;
    fallbackToPartial: boolean;
}

/**
 * Default validation modes for different scenarios
 */
export const ValidationModes = {
    production: {
        schema: 'flexible' as const,
        enableTransformation: true,
        enableErrorRecovery: true,
        fallbackToPartial: true,
    },
    development: {
        schema: 'strict' as const,
        enableTransformation: false,
        enableErrorRecovery: false,
        fallbackToPartial: false,
    },
    testing: {
        schema: 'flexible' as const,
        enableTransformation: true,
        enableErrorRecovery: true,
        fallbackToPartial: false,
    },
} as const;

/**
 * Schema validation utility with automatic fallback
 */
export async function validateWithFallback<T>(
    data: unknown,
    mode: ValidationMode = ValidationModes.production
): Promise<{
    success: boolean;
    data?: T;
    schema: string;
    transformationsApplied: string[];
    warnings: string[];
    errors: z.ZodError[];
}> {
    const transformationsApplied: string[] = [];
    const warnings: string[] = [];
    const errors: z.ZodError[] = [];

    // Try primary schema
    try {
        const schema = getSchemaForValidation(mode.schema);
        const result = schema.parse(data);
        
        return {
            success: true,
            data: result,
            schema: mode.schema,
            transformationsApplied,
            warnings,
            errors,
        };
    } catch (error) {
        errors.push(error as z.ZodError);
        
        // Try fallback to partial schema if enabled
        if (mode.fallbackToPartial && mode.schema !== 'partial') {
            try {
                const partialSchema = getSchemaForValidation('partial');
                const result = partialSchema.parse(data);
                transformationsApplied.push('fallback-to-partial');
                warnings.push('Fell back to partial schema validation');
                
                return {
                    success: true,
                    data: result,
                    schema: 'partial',
                    transformationsApplied,
                    warnings,
                    errors,
                };
            } catch (partialError) {
                errors.push(partialError as z.ZodError);
            }
        }
    }

    return {
        success: false,
        schema: mode.schema,
        transformationsApplied,
        warnings,
        errors,
    };
}