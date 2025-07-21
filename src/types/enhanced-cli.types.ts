/**
 * Enhanced CLI Types for Sequential File Processing
 * 
 * Defines interfaces and types for enhanced CLI options and command handling
 */

/**
 * Enhanced CLI options interface with all new features
 */
export interface EnhancedCLIOptions {
    // Existing options
    files?: string[];
    agent?: string;
    interactive?: boolean;
    help?: boolean;
    list?: boolean;
    verbose?: boolean;
    
    // New enhanced options
    dryRun?: boolean;
    jsonReport?: string;
    groupByDirectory?: boolean;
    outputFormat?: 'console' | 'json' | 'both';
    
    // Processing options
    sequential?: boolean;
    showProgress?: boolean;
    showETA?: boolean;
    showThroughput?: boolean;
    
    // Configuration options
    maxErrors?: number;
    continueOnError?: boolean;
    fileOrdering?: 'alphabetical' | 'size' | 'modified' | 'natural';
}

/**
 * CLI command validation result
 */
export interface CLIValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    normalizedOptions: EnhancedCLIOptions;
}

/**
 * Output format configuration
 */
export interface OutputFormatConfig {
    format: 'console' | 'json' | 'both';
    jsonPath?: string;
    includeMetrics: boolean;
    colorOutput: boolean;
}

/**
 * CLI help section interface
 */
export interface CLIHelpSection {
    title: string;
    description: string;
    examples: string[];
    options?: Array<{
        flag: string;
        description: string;
        default?: string;
    }>;
}

/**
 * Enhanced command parsing result
 */
export interface EnhancedCommandResult {
    command: EnhancedReviewCommand | null;
    options: EnhancedCLIOptions;
    errors: string[];
    warnings: string[];
}

/**
 * Enhanced review command with additional options
 */
export interface EnhancedReviewCommand {
    mode: 'file' | 'changes' | 'pr';
    files?: string[];
    prId?: string;
    
    // Enhanced options
    dryRun: boolean;
    jsonReport?: string;
    groupByDirectory: boolean;
    outputFormat: 'console' | 'json' | 'both';
    sequential: boolean;
    showProgress: boolean;
}

/**
 * CLI argument parsing configuration
 */
export interface CLIParsingConfig {
    stringOptions: string[];
    booleanOptions: string[];
    aliases: Record<string, string>;
    defaults: Partial<EnhancedCLIOptions>;
}