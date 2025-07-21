/**
 * Sequential Processing Configuration Manager
 * 
 * Handles loading, validation, and management of sequential processing configuration
 */

import { exists } from 'std/fs/exists.ts';
import { Logger } from '../utils/logger.ts';
import {
    SequentialProcessingConfig,
    SequentialProcessingConfigSchema,
    SequentialProcessingCLIOverrides,
    ConfigValidationResult,
    ConfigValidationError,
    ProgressDisplayConfig,
    ErrorHandlingConfig,
    ReportingConfig,
    DryRunConfig,
    PerformanceConfig,
    TerminalConfig,
    FileOrdering,
    ProgressStyle,
    OutputFormat,
} from './sequential-processing.types.ts';

/**
 * Default configuration values for sequential processing
 */
export const DEFAULT_SEQUENTIAL_PROCESSING_CONFIG: SequentialProcessingConfig = {
    enabled: true,
    progressDisplay: {
        enabled: true,
        style: 'ollama' as ProgressStyle,
        colors: true,
        showFileNames: true,
        showPercentage: true,
        showETA: true,
        showThroughput: true,
        barWidth: 30,
        spinnerEnabled: true,
        updateInterval: 100,
    },
    fileOrdering: 'alphabetical' as FileOrdering,
    errorHandling: {
        continueOnError: true,
        maxErrors: 10,
        showErrorDetails: true,
        fallbackToPlainText: true,
    },
    reporting: {
        jsonOutput: false,
        defaultJsonPath: './nova-review-report.json',
        includeMetrics: true,
        groupByDirectory: false,
        includeTimestamps: true,
        includeDuration: true,
    },
    dryRun: {
        enabled: false,
        showEstimates: true,
        checkFileAccess: true,
        showProcessingOrder: true,
        estimateProcessingTime: true,
    },
    performance: {
        memoryThreshold: 500 * 1024 * 1024, // 500MB
        enableGarbageCollection: true,
        progressUpdateThrottle: 100,
        maxConcurrentAnalysis: 1,
    },
    terminal: {
        supportAnsiCodes: true,
        terminalWidth: 80,
        pathTruncationLength: 40,
        colorSupport: true,
        unicodeSupport: true,
    },
};

/**
 * Sequential Processing Configuration Manager
 */
export class SequentialProcessingConfigManager {
    private static instance: SequentialProcessingConfigManager;
    private config: SequentialProcessingConfig | null = null;
    private configDir = `${Deno.env.get('HOME')}/.nova`;
    private configPath = `${this.configDir}/sequential-processing.json`;
    private debug = Deno.env.get('NOVA_DEBUG') === 'true';
    private logger: Logger;

    private constructor() {
        this.logger = new Logger('SequentialProcessingConfig', this.debug);
    }

    public static getInstance(): SequentialProcessingConfigManager {
        if (!SequentialProcessingConfigManager.instance) {
            SequentialProcessingConfigManager.instance = new SequentialProcessingConfigManager();
        }
        return SequentialProcessingConfigManager.instance;
    }

    /**
     * Ensure config directory exists
     */
    private async ensureConfigDir(): Promise<void> {
        try {
            await Deno.mkdir(this.configDir, { recursive: true });
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) {
                throw error;
            }
        }
    }

    /**
     * Load configuration from all sources in priority order
     */
    public async loadConfig(cliOverrides?: SequentialProcessingCLIOverrides): Promise<SequentialProcessingConfig> {
        if (this.config && !cliOverrides) {
            return this.config;
        }

        await this.ensureConfigDir();

        // 1. Start with default configuration
        let config = { ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG };

        // 2. Load config file if it exists (lowest priority)
        const fileConfig = await this.loadFileConfig();
        if (fileConfig) {
            config = this.mergeConfigs(config, fileConfig);
        }

        // 3. Load environment variables (higher priority than file config)
        const envConfig = this.loadEnvConfig();
        this.logger.debug('Environment config loaded:', envConfig);
        config = this.mergeConfigs(config, envConfig);
        this.logger.debug('Config after env merge:', config);

        // 4. Detect terminal capabilities and adjust config (before CLI overrides)
        config = this.detectTerminalCapabilities(config);

        // 5. Apply CLI overrides (should take precedence over terminal detection)
        if (cliOverrides) {
            config = this.applyCLIOverrides(config, cliOverrides);
        }

        // 6. Validate the configuration
        const validationResult = this.validateConfig(config);
        if (!validationResult.isValid) {
            this.logger.warn('Configuration validation failed:', validationResult.errors);
            // Use default config with warnings
            config = { ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG };
        } else if (validationResult.config) {
            config = validationResult.config;
        }

        this.config = config;
        this.logger.debug('Loaded sequential processing config:', config);
        return config;
    }

    /**
     * Load configuration from environment variables
     */
    private loadEnvConfig(): Partial<SequentialProcessingConfig> {
        const envConfig: Partial<SequentialProcessingConfig> = {};

        // Sequential processing enabled
        const enabled = Deno.env.get('NOVA_SEQUENTIAL_ENABLED');
        if (enabled !== undefined) {
            envConfig.enabled = enabled === 'true';
            this.logger.debug('Loaded NOVA_SEQUENTIAL_ENABLED:', enabled, '-> enabled:', envConfig.enabled);
        } else {
            this.logger.debug('NOVA_SEQUENTIAL_ENABLED not set');
        }

        // Progress display settings
        const progressEnabled = Deno.env.get('NOVA_PROGRESS_ENABLED');
        const progressStyle = Deno.env.get('NOVA_PROGRESS_STYLE') as ProgressStyle;
        const progressColors = Deno.env.get('NOVA_PROGRESS_COLORS');
        const progressBarWidth = Deno.env.get('NOVA_PROGRESS_BAR_WIDTH');

        if (progressEnabled !== undefined || progressStyle !== undefined || progressColors !== undefined || progressBarWidth !== undefined) {
            envConfig.progressDisplay = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG.progressDisplay,
                ...(progressEnabled !== undefined && { enabled: progressEnabled === 'true' }),
                ...(progressStyle !== undefined && { style: progressStyle }),
                ...(progressColors !== undefined && { colors: progressColors === 'true' }),
                ...(progressBarWidth !== undefined && { barWidth: parseInt(progressBarWidth, 10) }),
            };
        }

        // Error handling settings
        const continueOnError = Deno.env.get('NOVA_CONTINUE_ON_ERROR');
        const maxErrors = Deno.env.get('NOVA_MAX_ERRORS');

        if (continueOnError !== undefined || maxErrors !== undefined) {
            envConfig.errorHandling = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG.errorHandling,
                ...(continueOnError !== undefined && { continueOnError: continueOnError === 'true' }),
                ...(maxErrors !== undefined && { maxErrors: parseInt(maxErrors, 10) }),
            };
        }

        // File ordering
        const fileOrdering = Deno.env.get('NOVA_FILE_ORDERING') as FileOrdering;
        if (fileOrdering) {
            envConfig.fileOrdering = fileOrdering;
        }

        // Reporting settings
        const jsonOutput = Deno.env.get('NOVA_JSON_OUTPUT');
        const jsonPath = Deno.env.get('NOVA_JSON_PATH');

        if (jsonOutput !== undefined || jsonPath !== undefined) {
            envConfig.reporting = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG.reporting,
                ...(jsonOutput !== undefined && { jsonOutput: jsonOutput === 'true' }),
                ...(jsonPath !== undefined && { defaultJsonPath: jsonPath }),
            };
        }

        this.logger.debug('Loaded env config for sequential processing:', envConfig);
        return envConfig;
    }

    /**
     * Load configuration from file
     */
    private async loadFileConfig(): Promise<Partial<SequentialProcessingConfig> | null> {
        try {
            if (await exists(this.configPath)) {
                const fileContent = await Deno.readTextFile(this.configPath);
                const config = JSON.parse(fileContent);
                this.logger.debug('Loaded sequential processing config from file:', config);
                return config;
            }
            return null;
        } catch (error) {
            this.logger.debug('Error loading sequential processing config file:', error);
            return null;
        }
    }

    /**
     * Merge configurations from different sources
     */
    private mergeConfigs(
        base: SequentialProcessingConfig,
        override: Partial<SequentialProcessingConfig>
    ): SequentialProcessingConfig {
        const merged = { ...base };

        if (override.enabled !== undefined) {
            merged.enabled = override.enabled;
        }

        if (override.fileOrdering !== undefined) {
            merged.fileOrdering = override.fileOrdering;
        }

        if (override.progressDisplay) {
            merged.progressDisplay = { ...merged.progressDisplay, ...override.progressDisplay };
        }

        if (override.errorHandling) {
            merged.errorHandling = { ...merged.errorHandling, ...override.errorHandling };
        }

        if (override.reporting) {
            merged.reporting = { ...merged.reporting, ...override.reporting };
        }

        if (override.dryRun) {
            merged.dryRun = { ...merged.dryRun, ...override.dryRun };
        }

        if (override.performance) {
            merged.performance = { ...merged.performance, ...override.performance };
        }

        if (override.terminal) {
            merged.terminal = { ...merged.terminal, ...override.terminal };
        }

        return merged;
    }

    /**
     * Apply CLI overrides to configuration
     */
    private applyCLIOverrides(
        config: SequentialProcessingConfig,
        overrides: SequentialProcessingCLIOverrides
    ): SequentialProcessingConfig {
        const updated = { ...config };

        if (overrides.enabled !== undefined) {
            updated.enabled = overrides.enabled;
        }

        if (overrides.dryRun !== undefined) {
            updated.dryRun = { ...updated.dryRun, enabled: overrides.dryRun };
        }

        if (overrides.jsonReport !== undefined) {
            updated.reporting = {
                ...updated.reporting,
                jsonOutput: true,
                defaultJsonPath: overrides.jsonReport,
            };
        }

        if (overrides.groupByDirectory !== undefined) {
            updated.reporting = {
                ...updated.reporting,
                groupByDirectory: overrides.groupByDirectory,
            };
        }

        if (overrides.outputFormat !== undefined) {
            const isJsonOutput = overrides.outputFormat === 'json' || overrides.outputFormat === 'both';
            updated.reporting = {
                ...updated.reporting,
                jsonOutput: isJsonOutput,
            };
        }

        if (overrides.showProgress !== undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                enabled: overrides.showProgress,
            };
        }

        if (overrides.showETA !== undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                showETA: overrides.showETA,
            };
        }

        if (overrides.showThroughput !== undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                showThroughput: overrides.showThroughput,
            };
        }

        if (overrides.continueOnError !== undefined) {
            updated.errorHandling = {
                ...updated.errorHandling,
                continueOnError: overrides.continueOnError,
            };
        }

        if (overrides.maxErrors !== undefined) {
            updated.errorHandling = {
                ...updated.errorHandling,
                maxErrors: overrides.maxErrors,
            };
        }

        if (overrides.fileOrdering !== undefined) {
            updated.fileOrdering = overrides.fileOrdering;
        }

        if (overrides.progressStyle !== undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                style: overrides.progressStyle,
            };
        }

        if (overrides.colors !== undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                colors: overrides.colors,
            };
        }

        return updated;
    }

    /**
     * Detect terminal capabilities and adjust configuration
     */
    private detectTerminalCapabilities(config: SequentialProcessingConfig): SequentialProcessingConfig {
        const updated = { ...config };

        // Check if running in TTY - only disable if not explicitly set via env vars
        const isTTY = Deno.stdout.isTerminal();
        const progressEnabledEnv = Deno.env.get('NOVA_PROGRESS_ENABLED');
        const progressColorsEnv = Deno.env.get('NOVA_PROGRESS_COLORS');
        
        if (!isTTY && progressEnabledEnv === undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                enabled: false,
            };
        }
        
        if (!isTTY && progressColorsEnv === undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                colors: false,
            };
        }
        
        if (!isTTY) {
            updated.terminal = {
                ...updated.terminal,
                supportAnsiCodes: false,
                colorSupport: false,
            };
        }

        // Check terminal width
        try {
            const terminalSize = Deno.consoleSize();
            updated.terminal = {
                ...updated.terminal,
                terminalWidth: terminalSize.columns,
            };
        } catch {
            // Use default terminal width if detection fails
        }

        // Check for color support - only disable if not explicitly set via env vars
        const term = Deno.env.get('TERM');
        const colorTerm = Deno.env.get('COLORTERM');
        const supportsColor = (term?.includes('color') || colorTerm === 'truecolor' || colorTerm === '24bit') && term !== 'dumb';
        
        if ((!supportsColor || term === 'dumb') && progressColorsEnv === undefined) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                colors: false,
            };
            updated.terminal = {
                ...updated.terminal,
                colorSupport: false,
            };
        }

        // Check for Unicode support
        const lang = Deno.env.get('LANG');
        const supportsUnicode = lang?.includes('UTF-8') || lang?.includes('utf8');
        
        if (!supportsUnicode) {
            updated.progressDisplay = {
                ...updated.progressDisplay,
                spinnerEnabled: false,
            };
            updated.terminal = {
                ...updated.terminal,
                unicodeSupport: false,
            };
        }

        return updated;
    }

    /**
     * Validate configuration against schema
     */
    public validateConfig(config: SequentialProcessingConfig): ConfigValidationResult {
        try {
            const validatedConfig = SequentialProcessingConfigSchema.parse(config);
            return {
                isValid: true,
                errors: [],
                warnings: [],
                config: validatedConfig,
            };
        } catch (error: unknown) {
            const errors: ConfigValidationError[] = [];
            const warnings: string[] = [];

            if (error && typeof error === 'object' && 'issues' in error) {
                const zodError = error as { issues: Array<{ path: string[]; message: string; received: unknown }> };
                for (const issue of zodError.issues) {
                    errors.push({
                        field: issue.path.join('.'),
                        message: issue.message,
                        value: issue.received,
                    });
                }
            } else {
                errors.push({
                    field: 'unknown',
                    message: error instanceof Error ? error.message : 'Unknown validation error',
                    value: config,
                });
            }

            return {
                isValid: false,
                errors,
                warnings,
            };
        }
    }

    /**
     * Save configuration to file
     */
    public async saveConfig(config: SequentialProcessingConfig): Promise<void> {
        await this.ensureConfigDir();

        try {
            const validationResult = this.validateConfig(config);
            if (!validationResult.isValid) {
                throw new Error(`Invalid configuration: ${validationResult.errors.map(e => e.message).join(', ')}`);
            }

            await Deno.writeTextFile(this.configPath, JSON.stringify(config, null, 2));
            this.config = null; // Reset cached config
            this.logger.debug('Saved sequential processing config to file');
        } catch (error) {
            this.logger.error('Error saving sequential processing config:', error);
            throw error;
        }
    }

    /**
     * Reset configuration to defaults
     */
    public resetToDefaults(): SequentialProcessingConfig {
        this.config = { ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG };
        return this.config;
    }

    /**
     * Get current configuration without loading from sources
     */
    public getCurrentConfig(): SequentialProcessingConfig | null {
        return this.config;
    }

    /**
     * Update specific configuration section
     */
    public async updateProgressDisplay(updates: Partial<ProgressDisplayConfig>): Promise<SequentialProcessingConfig> {
        const config = await this.loadConfig();
        config.progressDisplay = { ...config.progressDisplay, ...updates };
        await this.saveConfig(config);
        return config;
    }

    /**
     * Update error handling configuration
     */
    public async updateErrorHandling(updates: Partial<ErrorHandlingConfig>): Promise<SequentialProcessingConfig> {
        const config = await this.loadConfig();
        config.errorHandling = { ...config.errorHandling, ...updates };
        await this.saveConfig(config);
        return config;
    }

    /**
     * Update reporting configuration
     */
    public async updateReporting(updates: Partial<ReportingConfig>): Promise<SequentialProcessingConfig> {
        const config = await this.loadConfig();
        config.reporting = { ...config.reporting, ...updates };
        await this.saveConfig(config);
        return config;
    }

    /**
     * Get configuration summary for debugging
     */
    public getConfigSummary(): Record<string, unknown> {
        if (!this.config) {
            return { status: 'not_loaded' };
        }

        return {
            enabled: this.config.enabled,
            progressStyle: this.config.progressDisplay.style,
            fileOrdering: this.config.fileOrdering,
            errorHandling: {
                continueOnError: this.config.errorHandling.continueOnError,
                maxErrors: this.config.errorHandling.maxErrors,
            },
            reporting: {
                jsonOutput: this.config.reporting.jsonOutput,
                groupByDirectory: this.config.reporting.groupByDirectory,
            },
            terminal: {
                supportAnsiCodes: this.config.terminal.supportAnsiCodes,
                colorSupport: this.config.terminal.colorSupport,
            },
        };
    }
}

export const sequentialProcessingConfigManager = SequentialProcessingConfigManager.getInstance();