/**
 * Sequential Processing Configuration Types
 * 
 * Defines interfaces and types for sequential file processing configuration
 */

import { z } from 'zod';

/**
 * Progress display style options
 */
export type ProgressStyle = 'ollama' | 'enhanced' | 'simple' | 'minimal';

/**
 * File ordering options
 */
export type FileOrdering = 'alphabetical' | 'size' | 'modified' | 'natural';

/**
 * Output format options
 */
export type OutputFormat = 'console' | 'json' | 'both';

/**
 * Progress display configuration
 */
export interface ProgressDisplayConfig {
    enabled: boolean;
    style: ProgressStyle;
    colors: boolean;
    showFileNames: boolean;
    showPercentage: boolean;
    showETA: boolean;
    showThroughput: boolean;
    barWidth: number;
    spinnerEnabled: boolean;
    updateInterval: number; // milliseconds
}

/**
 * Error handling configuration
 */
export interface ErrorHandlingConfig {
    continueOnError: boolean;
    maxErrors: number;
    showErrorDetails: boolean;
    fallbackToPlainText: boolean;
}

/**
 * Reporting configuration
 */
export interface ReportingConfig {
    jsonOutput: boolean;
    defaultJsonPath: string;
    includeMetrics: boolean;
    groupByDirectory: boolean;
    includeTimestamps: boolean;
    includeDuration: boolean;
}

/**
 * Dry run configuration
 */
export interface DryRunConfig {
    enabled: boolean;
    showEstimates: boolean;
    checkFileAccess: boolean;
    showProcessingOrder: boolean;
    estimateProcessingTime: boolean;
}

/**
 * Performance configuration
 */
export interface PerformanceConfig {
    memoryThreshold: number; // bytes
    enableGarbageCollection: boolean;
    progressUpdateThrottle: number; // milliseconds
    maxConcurrentAnalysis: number;
}

/**
 * Terminal configuration
 */
export interface TerminalConfig {
    supportAnsiCodes: boolean;
    terminalWidth: number;
    pathTruncationLength: number;
    colorSupport: boolean;
    unicodeSupport: boolean;
}

/**
 * Main sequential processing configuration interface
 */
export interface SequentialProcessingConfig {
    enabled: boolean;
    progressDisplay: ProgressDisplayConfig;
    fileOrdering: FileOrdering;
    errorHandling: ErrorHandlingConfig;
    reporting: ReportingConfig;
    dryRun: DryRunConfig;
    performance: PerformanceConfig;
    terminal: TerminalConfig;
}

/**
 * CLI override options for sequential processing
 */
export interface SequentialProcessingCLIOverrides {
    enabled?: boolean;
    dryRun?: boolean;
    jsonReport?: string;
    groupByDirectory?: boolean;
    outputFormat?: OutputFormat;
    showProgress?: boolean;
    showETA?: boolean;
    showThroughput?: boolean;
    continueOnError?: boolean;
    maxErrors?: number;
    fileOrdering?: FileOrdering;
    progressStyle?: ProgressStyle;
    colors?: boolean;
}

/**
 * Zod schema for progress display configuration validation
 */
export const ProgressDisplayConfigSchema = z.object({
    enabled: z.boolean(),
    style: z.enum(['ollama', 'enhanced', 'simple', 'minimal']),
    colors: z.boolean(),
    showFileNames: z.boolean(),
    showPercentage: z.boolean(),
    showETA: z.boolean(),
    showThroughput: z.boolean(),
    barWidth: z.number().min(10).max(100),
    spinnerEnabled: z.boolean(),
    updateInterval: z.number().min(50).max(1000),
});

/**
 * Zod schema for error handling configuration validation
 */
export const ErrorHandlingConfigSchema = z.object({
    continueOnError: z.boolean(),
    maxErrors: z.number().min(0).max(1000),
    showErrorDetails: z.boolean(),
    fallbackToPlainText: z.boolean(),
});

/**
 * Zod schema for reporting configuration validation
 */
export const ReportingConfigSchema = z.object({
    jsonOutput: z.boolean(),
    defaultJsonPath: z.string(),
    includeMetrics: z.boolean(),
    groupByDirectory: z.boolean(),
    includeTimestamps: z.boolean(),
    includeDuration: z.boolean(),
});

/**
 * Zod schema for dry run configuration validation
 */
export const DryRunConfigSchema = z.object({
    enabled: z.boolean(),
    showEstimates: z.boolean(),
    checkFileAccess: z.boolean(),
    showProcessingOrder: z.boolean(),
    estimateProcessingTime: z.boolean(),
});

/**
 * Zod schema for performance configuration validation
 */
export const PerformanceConfigSchema = z.object({
    memoryThreshold: z.number().min(100 * 1024 * 1024), // Minimum 100MB
    enableGarbageCollection: z.boolean(),
    progressUpdateThrottle: z.number().min(50).max(1000),
    maxConcurrentAnalysis: z.number().min(1).max(1),
});

/**
 * Zod schema for terminal configuration validation
 */
export const TerminalConfigSchema = z.object({
    supportAnsiCodes: z.boolean(),
    terminalWidth: z.number().min(40).max(200),
    pathTruncationLength: z.number().min(20).max(100),
    colorSupport: z.boolean(),
    unicodeSupport: z.boolean(),
});

/**
 * Zod schema for sequential processing configuration validation
 */
export const SequentialProcessingConfigSchema = z.object({
    enabled: z.boolean(),
    progressDisplay: ProgressDisplayConfigSchema,
    fileOrdering: z.enum(['alphabetical', 'size', 'modified', 'natural']),
    errorHandling: ErrorHandlingConfigSchema,
    reporting: ReportingConfigSchema,
    dryRun: DryRunConfigSchema,
    performance: PerformanceConfigSchema,
    terminal: TerminalConfigSchema,
});

/**
 * Configuration validation error
 */
export interface ConfigValidationError {
    field: string;
    message: string;
    value: unknown;
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
    isValid: boolean;
    errors: ConfigValidationError[];
    warnings: string[];
    config?: SequentialProcessingConfig;
}