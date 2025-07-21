/**
 * Enhanced CLI Handler for Sequential File Processing
 * 
 * Handles enhanced CLI options and command parsing with support for new features
 */

import { parseArgs } from "jsr:@std/cli/parse-args";
import type { Logger } from "../utils/logger.ts";
import type { 
    EnhancedCLIOptions, 
    CLIValidationResult, 
    OutputFormatConfig,
    CLIHelpSection,
    EnhancedCommandResult,
    EnhancedReviewCommand,
    CLIParsingConfig
} from "../types/enhanced-cli.types.ts";
import type { ReviewCommand } from "../agents/types.ts";

/**
 * Enhanced CLI handler with support for all new features
 */
export class EnhancedCLIHandler {
    private logger: Logger;
    private parsingConfig: CLIParsingConfig;

    constructor(logger: Logger) {
        this.logger = logger.child('EnhancedCLIHandler');
        this.parsingConfig = this.createParsingConfig();
    }

    /**
     * Parse enhanced CLI arguments
     */
    parseEnhancedArgs(args: string[]): EnhancedCommandResult {
        try {
            this.logger.debug(`Parsing enhanced CLI args: ${args.join(' ')}`);

            // Check which boolean flags were explicitly provided
            const explicitlyProvidedFlags = this.getExplicitlyProvidedBooleanFlags(args);

            const parsedArgs = parseArgs(args, {
                string: this.parsingConfig.stringOptions,
                boolean: this.parsingConfig.booleanOptions,
                alias: this.parsingConfig.aliases,
                default: this.parsingConfig.defaults
            });

            // Extract enhanced options with proper boolean defaults handling
            const options: EnhancedCLIOptions = {
                // Existing options
                files: parsedArgs._.map(arg => String(arg)),
                agent: parsedArgs.agent,
                interactive: parsedArgs.interactive,
                help: parsedArgs.help,
                list: parsedArgs.list,
                verbose: parsedArgs.verbose,
                
                // New enhanced options
                dryRun: parsedArgs['dry-run'],
                jsonReport: parsedArgs['json-report'],
                groupByDirectory: parsedArgs['group-by-directory'],
                outputFormat: (parsedArgs['output-format'] || 'console') as 'console' | 'json' | 'both',
                
                // Processing options - use defaults if not explicitly provided
                sequential: explicitlyProvidedFlags.has('sequential') ? parsedArgs.sequential : true,
                showProgress: explicitlyProvidedFlags.has('show-progress') ? parsedArgs['show-progress'] : true,
                showETA: parsedArgs['show-eta'],
                showThroughput: parsedArgs['show-throughput'],
                
                // Configuration options
                maxErrors: (() => {
                    const rawValue = parsedArgs['max-errors'];
                    if (rawValue !== undefined && rawValue !== '') {
                        const parsed = parseInt(rawValue);
                        return parsed; // Return NaN if parsing fails, let validation handle it
                    }
                    return undefined;
                })(),
                continueOnError: explicitlyProvidedFlags.has('continue-on-error') ? parsedArgs['continue-on-error'] : true,
                fileOrdering: (parsedArgs['file-ordering'] || 'alphabetical') as 'alphabetical' | 'size' | 'modified' | 'natural'
            };

            // Validate and normalize options
            const validation = this.validateOptions(options);
            if (!validation.isValid) {
                return {
                    command: null,
                    options: validation.normalizedOptions,
                    errors: validation.errors,
                    warnings: validation.warnings
                };
            }

            // Parse review command if applicable
            const command = this.parseEnhancedReviewCommand(validation.normalizedOptions);

            return {
                command,
                options: validation.normalizedOptions,
                errors: [], // No errors if validation passed
                warnings: validation.warnings
            };

        } catch (error) {
            this.logger.error('Failed to parse enhanced CLI args', { error, args });
            return {
                command: null,
                options: this.parsingConfig.defaults as EnhancedCLIOptions,
                errors: [`Failed to parse arguments: ${error instanceof Error ? error.message : 'Unknown error'}`],
                warnings: []
            };
        }
    }

    /**
     * Validate and normalize CLI options
     */
    validateOptions(options: EnhancedCLIOptions): CLIValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const normalizedOptions = { ...options };

        // Validate output format
        if (options.outputFormat && !['console', 'json', 'both'].includes(options.outputFormat)) {
            errors.push(`Invalid output format: ${options.outputFormat}. Must be 'console', 'json', or 'both'`);
            normalizedOptions.outputFormat = 'console';
        }

        // Validate file ordering
        if (options.fileOrdering && !['alphabetical', 'size', 'modified', 'natural'].includes(options.fileOrdering)) {
            errors.push(`Invalid file ordering: ${options.fileOrdering}. Must be 'alphabetical', 'size', 'modified', or 'natural'`);
            normalizedOptions.fileOrdering = 'alphabetical';
        }

        // Validate max errors
        if (options.maxErrors !== undefined) {
            if (isNaN(options.maxErrors) || options.maxErrors < 0 || !Number.isInteger(options.maxErrors)) {
                errors.push(`Invalid max errors: ${options.maxErrors}. Must be a non-negative integer`);
                normalizedOptions.maxErrors = 10;
            }
        }

        // Validate JSON report path
        if (options.jsonReport && typeof options.jsonReport !== 'string') {
            errors.push('JSON report path must be a string');
            normalizedOptions.jsonReport = undefined;
        }

        // Set defaults for undefined options
        normalizedOptions.outputFormat = normalizedOptions.outputFormat || 'console';
        normalizedOptions.fileOrdering = normalizedOptions.fileOrdering || 'alphabetical';
        normalizedOptions.maxErrors = normalizedOptions.maxErrors ?? 10;
        
        // Boolean defaults are now handled in the parsing logic

        // Add warnings for potentially problematic combinations
        if (options.dryRun && options.jsonReport) {
            warnings.push('JSON report will not be generated in dry-run mode');
        }

        if (options.groupByDirectory && (!options.files || options.files.length === 0)) {
            warnings.push('Group by directory option requires file arguments');
        }

        if (options.outputFormat === 'json' && !options.jsonReport) {
            warnings.push('JSON output format specified but no JSON report path provided');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            normalizedOptions
        };
    }

    /**
     * Parse enhanced review command from options
     */
    parseEnhancedReviewCommand(options: EnhancedCLIOptions): EnhancedReviewCommand | null {
        // Determine command mode based on options and files
        let mode: 'file' | 'changes' | 'pr' = 'changes';
        let files: string[] | undefined;
        let prId: string | undefined;

        if (options.files && options.files.length > 0) {
            // Check if any file looks like a PR command
            const firstArg = options.files[0].toLowerCase();
            if (firstArg === 'pr' || firstArg === 'pull-request' || firstArg === 'mr' || firstArg === 'merge-request') {
                mode = 'pr';
                prId = options.files[1]; // PR ID might be the second argument
            } else if (firstArg === 'changes' || firstArg === 'changed' || firstArg === 'diff') {
                mode = 'changes';
            } else {
                mode = 'file';
                files = options.files;
            }
        }

        return {
            mode,
            files,
            prId,
            dryRun: options.dryRun || false,
            jsonReport: options.jsonReport,
            groupByDirectory: options.groupByDirectory || false,
            outputFormat: options.outputFormat || 'console',
            sequential: options.sequential || true,
            showProgress: options.showProgress || true
        };
    }

    /**
     * Convert enhanced command to legacy ReviewCommand for backward compatibility
     */
    toLegacyReviewCommand(enhancedCommand: EnhancedReviewCommand): ReviewCommand {
        return {
            mode: enhancedCommand.mode,
            files: enhancedCommand.files,
            prId: enhancedCommand.prId
        };
    }

    /**
     * Create output format configuration
     */
    createOutputFormatConfig(options: EnhancedCLIOptions): OutputFormatConfig {
        return {
            format: options.outputFormat || 'console',
            jsonPath: options.jsonReport,
            includeMetrics: true,
            colorOutput: !options.jsonReport || options.outputFormat === 'both'
        };
    }

    /**
     * Generate enhanced help text
     */
    generateEnhancedHelp(): string {
        const sections: CLIHelpSection[] = [
            {
                title: "Enhanced Code Review Options",
                description: "Additional options for enhanced file processing and output",
                options: [
                    {
                        flag: "--dry-run",
                        description: "Show analysis plan without executing review",
                        default: "false"
                    },
                    {
                        flag: "--json-report <path>",
                        description: "Generate JSON report at specified path"
                    },
                    {
                        flag: "--group-by-directory",
                        description: "Group files by directory in output",
                        default: "false"
                    },
                    {
                        flag: "--output-format <format>",
                        description: "Output format: console, json, or both",
                        default: "console"
                    }
                ],
                examples: [
                    "nova agent review --dry-run src/*.ts",
                    "nova agent review --json-report report.json src/",
                    "nova agent review --group-by-directory --output-format both src/**/*.ts"
                ]
            },
            {
                title: "Processing Options",
                description: "Control how files are processed and progress is displayed",
                options: [
                    {
                        flag: "--sequential",
                        description: "Process files sequentially (recommended for local analysis)",
                        default: "true"
                    },
                    {
                        flag: "--show-progress",
                        description: "Show progress indicator during processing",
                        default: "true"
                    },
                    {
                        flag: "--show-eta",
                        description: "Show estimated time remaining",
                        default: "false"
                    },
                    {
                        flag: "--show-throughput",
                        description: "Show processing throughput (files/min)",
                        default: "false"
                    }
                ],
                examples: [
                    "nova agent review --show-eta --show-throughput src/*.ts",
                    "nova agent review --no-show-progress src/large-file.ts"
                ]
            },
            {
                title: "Error Handling Options",
                description: "Configure how errors are handled during processing",
                options: [
                    {
                        flag: "--max-errors <number>",
                        description: "Maximum number of errors before stopping",
                        default: "10"
                    },
                    {
                        flag: "--continue-on-error",
                        description: "Continue processing after errors",
                        default: "true"
                    },
                    {
                        flag: "--file-ordering <order>",
                        description: "File processing order: alphabetical, size, modified, natural",
                        default: "alphabetical"
                    }
                ],
                examples: [
                    "nova agent review --max-errors 5 --no-continue-on-error src/",
                    "nova agent review --file-ordering size src/**/*.ts"
                ]
            }
        ];

        return this.formatHelpSections(sections);
    }

    /**
     * Create CLI parsing configuration
     */
    private createParsingConfig(): CLIParsingConfig {
        return {
            stringOptions: [
                "agent", 
                "json-report", 
                "output-format", 
                "file-ordering",
                "max-errors"
            ],
            booleanOptions: [
                "interactive", 
                "help", 
                "list", 
                "verbose",
                "dry-run",
                "group-by-directory",
                "sequential",
                "show-progress",
                "show-eta",
                "show-throughput",
                "continue-on-error"
            ],
            aliases: {
                a: "agent",
                i: "interactive",
                h: "help",
                l: "list",
                v: "verbose",
                d: "dry-run",
                j: "json-report",
                g: "group-by-directory",
                o: "output-format",
                s: "sequential",
                p: "show-progress"
            },
            defaults: {
                agent: "enhanced",
                interactive: false,
                help: false,
                list: false,
                verbose: false,
                dryRun: false,
                groupByDirectory: false,
                outputFormat: 'console' as const,
                sequential: true,
                showProgress: true,
                showETA: false,
                showThroughput: false,
                maxErrors: 10,
                continueOnError: true,
                fileOrdering: 'alphabetical' as const
            }
        };
    }

    /**
     * Format help sections into readable text
     */
    private formatHelpSections(sections: CLIHelpSection[]): string {
        let helpText = "\n";

        for (const section of sections) {
            helpText += `## ${section.title}\n\n`;
            helpText += `${section.description}\n\n`;

            if (section.options) {
                helpText += "### Options:\n";
                for (const option of section.options) {
                    helpText += `  ${option.flag.padEnd(25)} ${option.description}`;
                    if (option.default) {
                        helpText += ` (default: ${option.default})`;
                    }
                    helpText += "\n";
                }
                helpText += "\n";
            }

            if (section.examples && section.examples.length > 0) {
                helpText += "### Examples:\n";
                for (const example of section.examples) {
                    helpText += `  ${example}\n`;
                }
                helpText += "\n";
            }

            helpText += "---\n\n";
        }

        return helpText;
    }

    /**
     * Validate file arguments
     */
    validateFileArguments(files: string[]): { valid: string[]; invalid: string[] } {
        const valid: string[] = [];
        const invalid: string[] = [];

        for (const file of files) {
            if (this.isValidFilePattern(file)) {
                valid.push(file);
            } else {
                invalid.push(file);
            }
        }

        return { valid, invalid };
    }

    /**
     * Check if a string is a valid file pattern
     */
    private isValidFilePattern(pattern: string): boolean {
        try {
            // Basic validation for file patterns
            if (!pattern || pattern.length === 0) {
                return false;
            }

            // Check for invalid characters (excluding wildcards and path separators)
            const invalidChars = /[<>"|?\x00-\x1f]/;
            if (invalidChars.test(pattern)) {
                return false;
            }

            // Check for reasonable length
            if (pattern.length > 260) {
                return false;
            }

            return true;

        } catch (error) {
            this.logger.debug(`File pattern validation failed for "${pattern}": ${error}`);
            return false;
        }
    }

    /**
     * Get explicitly provided boolean flags from arguments
     */
    private getExplicitlyProvidedBooleanFlags(args: string[]): Set<string> {
        const explicitFlags = new Set<string>();
        
        for (const arg of args) {
            if (arg.startsWith('--')) {
                const flagName = arg.substring(2);
                if (this.parsingConfig.booleanOptions.includes(flagName)) {
                    explicitFlags.add(flagName);
                }
            } else if (arg.startsWith('-') && arg.length === 2) {
                const shortFlag = arg.substring(1);
                const longFlag = this.parsingConfig.aliases[shortFlag];
                if (longFlag && this.parsingConfig.booleanOptions.includes(longFlag)) {
                    explicitFlags.add(longFlag);
                }
            }
        }
        
        return explicitFlags;
    }
}