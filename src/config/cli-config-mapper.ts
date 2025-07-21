/**
 * CLI Configuration Mapper
 * 
 * Maps CLI options to sequential processing configuration overrides
 */

import { EnhancedCLIOptions } from '../types/enhanced-cli.types.ts';
import { SequentialProcessingCLIOverrides, FileOrdering, ProgressStyle } from './sequential-processing.types.ts';

/**
 * Maps CLI options to sequential processing configuration overrides
 */
export class CLIConfigMapper {
    /**
     * Convert enhanced CLI options to sequential processing configuration overrides
     */
    public static mapCLIToSequentialConfig(cliOptions: EnhancedCLIOptions): SequentialProcessingCLIOverrides {
        const overrides: SequentialProcessingCLIOverrides = {};

        // Map basic options
        if (cliOptions.sequential !== undefined) {
            overrides.enabled = cliOptions.sequential;
        }

        if (cliOptions.dryRun !== undefined) {
            overrides.dryRun = cliOptions.dryRun;
        }

        if (cliOptions.jsonReport !== undefined) {
            overrides.jsonReport = cliOptions.jsonReport;
        }

        if (cliOptions.groupByDirectory !== undefined) {
            overrides.groupByDirectory = cliOptions.groupByDirectory;
        }

        if (cliOptions.outputFormat !== undefined) {
            overrides.outputFormat = cliOptions.outputFormat;
        }

        // Map progress options
        if (cliOptions.showProgress !== undefined) {
            overrides.showProgress = cliOptions.showProgress;
        }

        if (cliOptions.showETA !== undefined) {
            overrides.showETA = cliOptions.showETA;
        }

        if (cliOptions.showThroughput !== undefined) {
            overrides.showThroughput = cliOptions.showThroughput;
        }

        // Map error handling options
        if (cliOptions.continueOnError !== undefined) {
            overrides.continueOnError = cliOptions.continueOnError;
        }

        if (cliOptions.maxErrors !== undefined) {
            overrides.maxErrors = cliOptions.maxErrors;
        }

        // Map file ordering
        if (cliOptions.fileOrdering !== undefined) {
            overrides.fileOrdering = cliOptions.fileOrdering as FileOrdering;
        }

        return overrides;
    }

    /**
     * Validate CLI options for sequential processing
     */
    public static validateCLIOptions(cliOptions: EnhancedCLIOptions): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Validate file ordering
        if (cliOptions.fileOrdering && !['alphabetical', 'size', 'modified', 'natural'].includes(cliOptions.fileOrdering)) {
            errors.push(`Invalid file ordering: ${cliOptions.fileOrdering}. Must be one of: alphabetical, size, modified, natural`);
        }

        // Validate output format
        if (cliOptions.outputFormat && !['console', 'json', 'both'].includes(cliOptions.outputFormat)) {
            errors.push(`Invalid output format: ${cliOptions.outputFormat}. Must be one of: console, json, both`);
        }

        // Validate max errors
        if (cliOptions.maxErrors !== undefined && (cliOptions.maxErrors < 0 || cliOptions.maxErrors > 1000)) {
            errors.push(`Invalid max errors: ${cliOptions.maxErrors}. Must be between 0 and 1000`);
        }

        // Validate JSON report path
        if (cliOptions.jsonReport !== undefined && typeof cliOptions.jsonReport !== 'string') {
            errors.push('JSON report path must be a string');
        }

        // Check for conflicting options
        if (cliOptions.dryRun && cliOptions.jsonReport) {
            errors.push('Cannot use --dry-run with --json-report');
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    /**
     * Get default CLI options for sequential processing
     */
    public static getDefaultCLIOptions(): Partial<EnhancedCLIOptions> {
        return {
            sequential: true,
            showProgress: true,
            showETA: true,
            showThroughput: true,
            continueOnError: true,
            maxErrors: 10,
            fileOrdering: 'alphabetical',
            outputFormat: 'console',
            dryRun: false,
            groupByDirectory: false,
        };
    }

    /**
     * Merge CLI options with defaults
     */
    public static mergeWithDefaults(cliOptions: EnhancedCLIOptions): EnhancedCLIOptions {
        const defaults = this.getDefaultCLIOptions();
        return { ...defaults, ...cliOptions };
    }

    /**
     * Extract sequential processing related options from CLI options
     */
    public static extractSequentialOptions(cliOptions: EnhancedCLIOptions): Partial<EnhancedCLIOptions> {
        const sequentialOptions: Partial<EnhancedCLIOptions> = {};

        const sequentialKeys: (keyof EnhancedCLIOptions)[] = [
            'sequential',
            'dryRun',
            'jsonReport',
            'groupByDirectory',
            'outputFormat',
            'showProgress',
            'showETA',
            'showThroughput',
            'continueOnError',
            'maxErrors',
            'fileOrdering',
        ];

        for (const key of sequentialKeys) {
            if (cliOptions[key] !== undefined) {
                (sequentialOptions as any)[key] = cliOptions[key];
            }
        }

        return sequentialOptions;
    }

    /**
     * Generate help text for sequential processing CLI options
     */
    public static getHelpText(): string {
        return `
Sequential Processing Options:
  --sequential              Enable sequential file processing (default: true)
  --dry-run                 Show analysis plan without executing
  --json-report <path>      Generate JSON report at specified path
  --group-by-directory      Group files by directory in output
  --output-format <format>  Output format: console, json, both (default: console)
  --show-progress           Show progress indicator (default: true)
  --show-eta                Show estimated time remaining (default: true)
  --show-throughput         Show processing throughput (default: true)
  --continue-on-error       Continue processing after errors (default: true)
  --max-errors <number>     Maximum errors before stopping (default: 10)
  --file-ordering <order>   File processing order: alphabetical, size, modified, natural (default: alphabetical)

Examples:
  nova agent review src/*.ts --sequential --show-progress
  nova agent review src/ --dry-run --group-by-directory
  nova agent review src/*.ts --json-report report.json --output-format both
  nova agent review src/ --file-ordering size --max-errors 5
        `.trim();
    }

    /**
     * Parse progress style from string
     */
    public static parseProgressStyle(style: string): ProgressStyle | null {
        const validStyles: ProgressStyle[] = ['ollama', 'enhanced', 'simple', 'minimal'];
        return validStyles.includes(style as ProgressStyle) ? style as ProgressStyle : null;
    }

    /**
     * Parse file ordering from string
     */
    public static parseFileOrdering(ordering: string): FileOrdering | null {
        const validOrderings: FileOrdering[] = ['alphabetical', 'size', 'modified', 'natural'];
        return validOrderings.includes(ordering as FileOrdering) ? ordering as FileOrdering : null;
    }
}