import { z } from 'zod';
import type { Logger } from '../../utils/logger.ts';
import { ValidationService } from '../analysis/validation/validation.service.ts';
import { FlexibleReviewAnalysisSchema } from '../analysis/validation/schemas.ts';

/**
 * Result of processing an LLM response
 */
export interface ProcessingResult<T> {
    success: boolean;
    data?: T;
    errors: Error[];
    warnings: string[];
    fallbackUsed: boolean;
    transformationsApplied: string[];
    processingTime?: number;
    originalResponseLength?: number;
    cleanedResponseLength?: number;
}

/**
 * Processing context for error tracking and debugging
 */
export interface ProcessingContext {
    provider: string;
    model?: string;
    prompt?: string;
    attemptNumber: number;
    timestamp: Date;
    requestId?: string;
}

/**
 * JSON cleaning strategy interface
 */
export interface JSONCleaningStrategy {
    name: string;
    canHandle(response: string): boolean;
    clean(response: string): string;
    priority: number;
}

/**
 * Error recovery strategy for JSON parsing failures
 */
export interface JSONParsingRecoveryStrategy {
    name: string;
    canRecover(error: Error, response: string): boolean;
    recover(error: Error, response: string): string;
    priority: number;
}

/**
 * Enhanced service for processing and transforming LLM responses before validation
 */
export class LLMResponseProcessor {
    private logger: Logger;
    private validationService: ValidationService;
    private cleaningStrategies: Map<string, JSONCleaningStrategy> = new Map();
    private recoveryStrategies: Map<string, JSONParsingRecoveryStrategy> = new Map();
    private processingMetrics: Map<string, number> = new Map();

    constructor(logger: Logger) {
        this.logger = logger.child('LLMResponseProcessor');
        this.validationService = new ValidationService(logger);
        this.initializeCleaningStrategies();
        this.initializeRecoveryStrategies();
    }

    /**
     * Process LLM response with intelligent transformation and validation
     */
    async processResponse<T>(
        rawResponse: string,
        schema: z.ZodType<T>,
        context?: ProcessingContext
    ): Promise<ProcessingResult<T>> {
        const startTime = Date.now();
        const originalLength = rawResponse.length;

        try {
            this.logger.debug('Processing LLM response', {
                responseLength: originalLength,
                responsePreview: rawResponse.substring(0, 100),
                provider: context?.provider,
                model: context?.model,
                attemptNumber: context?.attemptNumber || 1
            });

            // Step 1: Clean JSON response using strategies
            const { cleanedResponse, appliedStrategies } = await this.cleanJSONResponseWithStrategies(rawResponse);
            this.logger.info('Response JSON:', {
                rawResponse,
            });
            const cleanedLength = cleanedResponse.length;

            // Step 2: Parse JSON with error recovery
            let parsedData: unknown;
            try {
                parsedData = JSON.parse(cleanedResponse);
                this.logger.debug('JSON parsing successful', {
                    originalLength,
                    cleanedLength,
                    compressionRatio: cleanedLength / originalLength
                });
            } catch (parseError) {
                this.logger.warn('Initial JSON parse failed, attempting recovery', {
                    error: parseError,
                    cleanedResponsePreview: cleanedResponse.substring(0, 200)
                });

                // Attempt JSON parsing recovery
                const recoveredResponse = await this.recoverFromJSONParsingError(
                    parseError as Error,
                    cleanedResponse
                );

                try {
                    parsedData = JSON.parse(recoveredResponse);
                    this.logger.info('JSON parsing recovery successful');
                } catch (recoveryError) {
                    this.logger.error('JSON parsing recovery failed', {
                        originalError: parseError,
                        recoveryError,
                        cleanedResponse: cleanedResponse.substring(0, 200)
                    });
                    throw new Error(`Invalid JSON response from LLM: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
                }
            }

            // Step 3: Use ValidationService for intelligent validation and transformation
            const validationResult = await this.validationService.validateWithTransformation(
                parsedData,
                schema
            );

            const processingTime = Date.now() - startTime;
            this.updateProcessingMetrics(context?.provider || 'unknown', processingTime, true);

            if (validationResult.success) {
                this.logger.debug('Validation successful', {
                    processingTime,
                    transformationsApplied: validationResult.transformationsApplied
                });

                // Combine cleaning strategy transformations with validation transformations
                const allTransformations = [
                    ...appliedStrategies,
                    ...validationResult.transformationsApplied
                ];

                return {
                    success: true,
                    data: validationResult.data!,
                    errors: [],
                    warnings: validationResult.warnings,
                    fallbackUsed: false,
                    transformationsApplied: allTransformations,
                    processingTime,
                    originalResponseLength: originalLength,
                    cleanedResponseLength: cleanedLength
                };
            } else {
                // ValidationService failed, convert errors to Error objects
                const errors = validationResult.errors.map(zodError =>
                    new Error(`Validation failed: ${zodError.message}`)
                );

                throw errors[0] || new Error('Validation failed with unknown error');
            }
        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.updateProcessingMetrics(context?.provider || 'unknown', processingTime, false);

            this.logger.error('LLM response processing failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                errorStack: error instanceof Error ? error.stack : undefined,
                rawResponsePreview: rawResponse.substring(0, 200),
                processingTime,
                provider: context?.provider,
                model: context?.model,
                attemptNumber: context?.attemptNumber || 1
            });

            return {
                success: false,
                data: undefined,
                errors: [error as Error],
                warnings: ['Falling back to rule-based analysis'],
                fallbackUsed: true,
                transformationsApplied: [],
                processingTime,
                originalResponseLength: originalLength
            };
        }
    }

    /**
     * Clean JSON response using registered strategies
     */
    private async cleanJSONResponseWithStrategies(response: string): Promise<{ cleanedResponse: string; appliedStrategies: string[] }> {
        let cleaned = response;
        const appliedStrategies: string[] = [];

        // First, check if this looks like structured text instead of JSON
        const isStructuredText = this.isStructuredTextResponse(response);
        this.logger.debug('Checking if response is structured text', {
            isStructuredText,
            responsePreview: response.substring(0, 200)
        });

        if (isStructuredText) {
            this.logger.debug('Detected structured text response, attempting to convert to JSON');
            try {
                cleaned = this.convertStructuredTextToJSON(response);
                appliedStrategies.push('structured-text-conversion');
                this.logger.debug('Successfully converted structured text to JSON');
            } catch (conversionError) {
                this.logger.warn('Failed to convert structured text to JSON', { error: conversionError });
                // Continue with original response and try other strategies
            }
        }

        // Get strategies sorted by priority
        const strategies = Array.from(this.cleaningStrategies.values())
            .sort((a, b) => b.priority - a.priority);

        for (const strategy of strategies) {
            if (strategy.canHandle(cleaned)) {
                const beforeLength = cleaned.length;
                cleaned = strategy.clean(cleaned);
                const afterLength = cleaned.length;

                appliedStrategies.push(strategy.name);
                this.logger.debug(`Applied cleaning strategy: ${strategy.name}`, {
                    beforeLength,
                    afterLength,
                    reduction: beforeLength - afterLength
                });
            }
        }

        if (appliedStrategies.length > 0) {
            this.logger.debug('JSON cleaning completed', {
                strategiesApplied: appliedStrategies,
                originalLength: response.length,
                cleanedLength: cleaned.length
            });
        }

        return { cleanedResponse: cleaned, appliedStrategies };
    }

    /**
     * Check if response looks like structured text instead of JSON
     */
    private isStructuredTextResponse(response: string): boolean {
        const trimmed = response.trim();

        // First, check if it's clearly JSON (starts with { or [ after removing markdown)
        const withoutMarkdown = trimmed.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const startsWithJSON = withoutMarkdown.startsWith('{') || withoutMarkdown.startsWith('[');

        // If it starts with JSON, it's not structured text
        if (startsWithJSON) {
            return false;
        }

        // Check for common patterns in structured text responses
        const textPatterns = [
            /^\d+\.\s*\*\*.*\*\*\s*:/m,  // "1. **Field Name**: "
            /^\d+\.\s*[A-Za-z\s]+\s*\([^)]+\)\s*\*\*\s*:/m,  // "1. Field Name (type)**: "
            /Code\s*Quality\s*Grade.*\*\*\s*:/i,    // "Code Quality Grade (A-F)**: "
            /Test\s*Coverage\s*Percentage.*\*\*\s*:/i,  // "Test Coverage Percentage**:"
            /Tests\s*Present.*\*\*\s*:/i,       // "Tests Present**:"
            /Business\s*Value.*\*\*\s*:/i,      // "Business Value**:"
            /Overall\s*State.*\*\*\s*:/i,       // "Overall State**:"
            /Security\s*Analysis.*\*\*\s*:/i,   // "Security Analysis**:"
            /Performance\s*Analysis.*\*\*\s*:/i, // "Performance Analysis**:"
            /Best\s*Practices.*\*\*\s*:/i,      // "Best Practices**:"
            // Simple patterns without markdown
            /^Grade\s*:\s*[A-F]/mi,             // "Grade: B"
            /^Coverage\s*:\s*\d+%?/mi,          // "Coverage: 85%"
            /^Tests?\s*Present\s*:\s*(Yes|No|True|False)/mi, // "Tests Present: True"
            /^(?:Business\s*)?Value\s*:\s*(high|medium|low)/mi, // "Value: medium"
            /^(?:Overall\s*)?State\s*:\s*(pass|warning|fail)/mi, // "State: pass"
        ];

        // Must have multiple text patterns to be considered structured text
        const matchingPatterns = textPatterns.filter(pattern => pattern.test(trimmed));



        return matchingPatterns.length >= 2; // Require at least 2 patterns to avoid false positives
    }

    /**
     * Convert structured text response to JSON format
     */
    private convertStructuredTextToJSON(response: string): string {
        const result: any = {
            grade: 'C',
            coverage: 0,
            testsPresent: false,
            value: 'medium',
            state: 'warning',
            issues: [],
            suggestions: [],
            summary: 'Analysis completed'
        };

        // Extract grade - look for patterns like "Grade: B" or "Code Quality Grade: B"
        const gradeMatch = response.match(/(?:Code\s*Quality\s*)?Grade\s*(?:\([A-F]\))?\s*\*?\*?\s*:\s*([A-F][+-]?)/i) ||
            response.match(/overall\s+grade\s+of\s+([A-F][+-]?)/i) ||
            response.match(/Grade\s*:\s*([A-F][+-]?)/i);

        if (gradeMatch) {
            // Extract just the letter grade, ignore + or - modifiers
            const grade = gradeMatch[1].toUpperCase().charAt(0);
            if (['A', 'B', 'C', 'D', 'F'].includes(grade)) {
                result.grade = grade;
            }
        }

        // Extract coverage - look for patterns like "Test Coverage Percentage: 60%" or "Coverage: 60%"
        const coverageMatch = response.match(/(?:Test\s*)?Coverage\s*(?:Percentage)?\s*(?:\(0-100\))?\s*\*?\*?\s*:\s*(\d+)%?/i);
        if (coverageMatch) {
            result.coverage = parseInt(coverageMatch[1], 10);
        }

        // Extract tests present - look for patterns like "Tests Present: Yes" or "Tests Present: No"
        const testsMatch = response.match(/Tests?\s*Present\s*(?:\(boolean\))?\s*\*?\*?\s*:\s*(Yes|No|True|False)/i);
        if (testsMatch) {
            const value = testsMatch[1].toLowerCase();
            result.testsPresent = value === 'yes' || value === 'true';
        }

        // Extract business value - look for patterns like "Business Value: Medium" or "Value: High"
        const valueMatch = response.match(/(?:Business\s*)?Value\s*(?:\(high\/medium\/low\))?\s*\*?\*?\s*:\s*(high|medium|low)/i);
        if (valueMatch) {
            result.value = valueMatch[1].toLowerCase();
        }

        // Extract overall state - look for patterns like "Overall State: Warning" or "State: Pass"
        const stateMatch = response.match(/(?:Overall\s*)?State\s*(?:\(pass\/warning\/fail\))?\s*\*?\*?\s*:\s*(pass|warning|fail)/i);
        if (stateMatch) {
            result.state = stateMatch[1].toLowerCase();
        }

        // Extract security analysis
        const securityMatch = response.match(/Security\s*Analysis\s*\*\*\s*:\s*(.+?)(?=\n\d+\.|$)/is);
        if (securityMatch && !securityMatch[1].toLowerCase().includes('none found')) {
            result.issues.push({
                line: 1,
                severity: 'medium',
                type: 'security',
                message: securityMatch[1].trim()
            });
        }

        // Extract performance analysis
        const performanceMatch = response.match(/Performance\s*Analysis\s*\*\*\s*:\s*(.+?)(?=\n\d+\.|$)/is);
        if (performanceMatch && !performanceMatch[1].toLowerCase().includes('none found')) {
            result.issues.push({
                line: 1,
                severity: 'medium',
                type: 'performance',
                message: performanceMatch[1].trim()
            });
        }

        // Extract best practices as suggestions
        const bestPracticesMatch = response.match(/Best\s*Practices\s*\*\*\s*:\s*([\s\S]+?)(?=Overall,|$)/i);
        if (bestPracticesMatch) {
            const practices = bestPracticesMatch[1];
            // Split by lettered items (a., b., c., etc.)
            const practiceItems = practices.split(/\n\s*[a-z]\.\s*/i).filter(item => item.trim());
            result.suggestions = practiceItems.map(item => {
                // Clean up the suggestion text
                return item.replace(/:\s*/, ': ').trim();
            }).filter(item => item.length > 10); // Filter out very short items
        }

        // Create summary from the overall assessment
        const summaryParts = [];
        if (result.grade && result.grade !== 'C') summaryParts.push(`Grade: ${result.grade}`);
        if (result.coverage > 0) summaryParts.push(`Coverage: ${result.coverage}%`);
        if (result.testsPresent) summaryParts.push('Tests present');
        if (result.value && result.value !== 'medium') summaryParts.push(`Business value: ${result.value}`);
        if (result.state && result.state !== 'warning') summaryParts.push(`State: ${result.state}`);

        if (summaryParts.length > 0) {
            result.summary = summaryParts.join(', ');
        } else {
            // Extract a summary from the overall conclusion if available
            const overallMatch = response.match(/Overall,?\s*([\s\S]+?)$/i);
            if (overallMatch) {
                result.summary = overallMatch[1].trim().substring(0, 200) + (overallMatch[1].length > 200 ? '...' : '');
            }
        }

        this.logger.debug('Converted structured text to JSON', {
            extractedFields: Object.keys(result).filter(key => {
                const value = result[key];
                if (Array.isArray(value)) return value.length > 0;
                if (typeof value === 'string') return value !== 'Analysis completed' && value.length > 0;
                if (typeof value === 'boolean') return true;
                if (typeof value === 'number') return value > 0;
                return value !== null && value !== undefined;
            }),
            grade: result.grade,
            coverage: result.coverage,
            testsPresent: result.testsPresent,
            value: result.value,
            state: result.state
        });

        return JSON.stringify(result, null, 2);
    }

    /**
     * Attempt to recover from JSON parsing errors
     */
    private async recoverFromJSONParsingError(error: Error, response: string): Promise<string> {
        const strategies = Array.from(this.recoveryStrategies.values())
            .sort((a, b) => b.priority - a.priority);

        for (const strategy of strategies) {
            if (strategy.canRecover(error, response)) {
                this.logger.debug(`Attempting JSON recovery with strategy: ${strategy.name}`);

                try {
                    const recovered = strategy.recover(error, response);
                    this.logger.debug(`JSON recovery strategy ${strategy.name} succeeded`);
                    return recovered;
                } catch (recoveryError) {
                    this.logger.debug(`JSON recovery strategy ${strategy.name} failed`, {
                        error: recoveryError
                    });
                }
            }
        }

        // If all strategies fail, return the original response
        this.logger.warn('All JSON recovery strategies failed, returning original response');
        return response;
    }

    /**
     * Update processing metrics for monitoring
     */
    private updateProcessingMetrics(provider: string, processingTime: number, success: boolean): void {
        const key = `${provider}_${success ? 'success' : 'failure'}`;
        const currentCount = this.processingMetrics.get(key) || 0;
        this.processingMetrics.set(key, currentCount + 1);

        const timeKey = `${provider}_avg_time`;
        const currentAvg = this.processingMetrics.get(timeKey) || 0;
        const currentTotal = this.processingMetrics.get(`${provider}_total_requests`) || 0;
        const newAvg = (currentAvg * currentTotal + processingTime) / (currentTotal + 1);

        this.processingMetrics.set(timeKey, newAvg);
        this.processingMetrics.set(`${provider}_total_requests`, currentTotal + 1);
    }

    /**
     * Get processing metrics for monitoring and debugging
     */
    public getProcessingMetrics(): Record<string, number> {
        return Object.fromEntries(this.processingMetrics);
    }

    /**
     * Register a custom JSON cleaning strategy
     */
    public registerCleaningStrategy(strategy: JSONCleaningStrategy): void {
        this.cleaningStrategies.set(strategy.name, strategy);
        this.logger.debug(`Registered JSON cleaning strategy: ${strategy.name}`);
    }

    /**
     * Register a custom JSON parsing recovery strategy
     */
    public registerRecoveryStrategy(strategy: JSONParsingRecoveryStrategy): void {
        this.recoveryStrategies.set(strategy.name, strategy);
        this.logger.debug(`Registered JSON recovery strategy: ${strategy.name}`);
    }

    /**
     * Initialize default JSON cleaning strategies
     */
    private initializeCleaningStrategies(): void {
        // Markdown code block removal strategy
        this.registerCleaningStrategy({
            name: 'markdown-removal',
            priority: 100,
            canHandle: (response: string) => response.includes('```'),
            clean: (response: string) => {
                let cleaned = response.trim();
                // Remove markdown code blocks
                cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
                return cleaned;
            }
        });

        // JSON extraction strategy
        this.registerCleaningStrategy({
            name: 'json-extraction',
            priority: 90,
            canHandle: (response: string) => response.includes('{') && response.includes('}'),
            clean: (response: string) => {
                // Try to find the first complete JSON object
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return jsonMatch[0];
                }
                return response;
            }
        });

        // Whitespace normalization strategy
        this.registerCleaningStrategy({
            name: 'whitespace-normalization',
            priority: 80,
            canHandle: (response: string) => /\s{2,}/.test(response),
            clean: (response: string) => {
                // Normalize excessive whitespace while preserving JSON structure
                return response
                    .replace(/\n\s*\n/g, '\n')  // Remove empty lines
                    .replace(/\s+/g, ' ')       // Normalize spaces
                    .trim();
            }
        });

        // Comment removal strategy
        this.registerCleaningStrategy({
            name: 'comment-removal',
            priority: 70,
            canHandle: (response: string) => response.includes('//') || response.includes('/*'),
            clean: (response: string) => {
                // Remove single-line comments (but preserve the line structure)
                let cleaned = response.replace(/\/\/.*$/gm, '');
                // Remove multi-line comments
                cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
                // Clean up any resulting empty lines or trailing commas
                cleaned = cleaned.replace(/,\s*\n\s*([}\]])/g, '\n$1');
                return cleaned;
            }
        });

        // Trailing comma removal strategy
        this.registerCleaningStrategy({
            name: 'trailing-comma-removal',
            priority: 60,
            canHandle: (response: string) => /,\s*[}\]]/g.test(response),
            clean: (response: string) => {
                // Remove trailing commas before closing brackets/braces
                return response.replace(/,(\s*[}\]])/g, '$1');
            }
        });
    }

    /**
     * Initialize default JSON parsing recovery strategies
     */
    private initializeRecoveryStrategies(): void {
        // Quote fixing strategy
        this.registerRecoveryStrategy({
            name: 'quote-fixing',
            priority: 100,
            canRecover: (error: Error, response: string) =>
                (error.message.includes('Unexpected token') || error.message.includes('Expected property name')) &&
                (response.includes("'") || /[{,]\s*\w+\s*:/.test(response)),
            recover: (error: Error, response: string) => {
                // Fix single quotes and unquoted keys
                let fixed = response
                    .replace(/'/g, '"')  // Replace single quotes with double quotes
                    .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');  // Quote unquoted keys
                return fixed;
            }
        });

        // Bracket balancing strategy
        this.registerRecoveryStrategy({
            name: 'bracket-balancing',
            priority: 90,
            canRecover: (error: Error, response: string) =>
                error.message.includes('Unexpected end') ||
                error.message.includes('Unexpected token'),
            recover: (error: Error, response: string) => {
                // Count and balance brackets
                const openBraces = (response.match(/\{/g) || []).length;
                const closeBraces = (response.match(/\}/g) || []).length;
                const openBrackets = (response.match(/\[/g) || []).length;
                const closeBrackets = (response.match(/\]/g) || []).length;

                let fixed = response;

                // Add missing closing braces
                for (let i = 0; i < openBraces - closeBraces; i++) {
                    fixed += '}';
                }

                // Add missing closing brackets
                for (let i = 0; i < openBrackets - closeBrackets; i++) {
                    fixed += ']';
                }

                return fixed;
            }
        });

        // Escape sequence fixing strategy
        this.registerRecoveryStrategy({
            name: 'escape-fixing',
            priority: 80,
            canRecover: (error: Error, response: string) =>
                error.message.includes('Unexpected token') &&
                response.includes('\\'),
            recover: (error: Error, response: string) => {
                // Fix common escape sequence issues
                return response
                    .replace(/\\\\/g, '\\')     // Fix double backslashes
                    .replace(/\\"/g, '"')      // Fix escaped quotes in wrong context
                    .replace(/\\n/g, '\\n')    // Ensure newlines are properly escaped
                    .replace(/\\t/g, '\\t');   // Ensure tabs are properly escaped
            }
        });

        // Partial JSON extraction strategy
        this.registerRecoveryStrategy({
            name: 'partial-extraction',
            priority: 70,
            canRecover: (error: Error, response: string) =>
                response.includes('{') && response.includes('}'),
            recover: (error: Error, response: string) => {
                // Try to extract the largest valid JSON substring
                const matches = response.match(/\{[^{}]*\}/g);
                if (matches && matches.length > 0) {
                    // Return the longest match
                    return matches.reduce((longest, current) =>
                        current.length > longest.length ? current : longest
                    );
                }

                // Fallback: try to create minimal valid JSON
                return '{"error": "Failed to parse LLM response", "fallback": true}';
            }
        });
    }

    /**
     * Legacy method for backward compatibility
     * @deprecated Use cleanJSONResponseWithStrategies instead
     */
    private cleanJSONResponse(response: string): string {
        let cleaned = response.trim();

        // Remove markdown code blocks if present
        cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');

        // Try to find JSON object in the response
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleaned = jsonMatch[0];
        }

        return cleaned;
    }
}