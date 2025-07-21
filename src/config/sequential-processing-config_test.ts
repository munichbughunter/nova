/**
 * Sequential Processing Configuration Tests
 */

import { assertEquals, assertExists, assert } from 'std/assert/mod.ts';
import { beforeEach, describe, it } from 'std/testing/bdd.ts';
import { SequentialProcessingConfigManager, DEFAULT_SEQUENTIAL_PROCESSING_CONFIG } from './sequential-processing-config.ts';
import {
    SequentialProcessingConfig,
    SequentialProcessingCLIOverrides,
    ConfigValidationResult,
    ProgressStyle,
    FileOrdering,
} from './sequential-processing.types.ts';

// Helper functions for boolean assertions
function assertTrue(value: boolean, message?: string) {
    assert(value === true, message);
}

function assertFalse(value: boolean, message?: string) {
    assert(value === false, message);
}

describe('SequentialProcessingConfigManager', () => {
    let configManager: SequentialProcessingConfigManager;

    beforeEach(() => {
        configManager = SequentialProcessingConfigManager.getInstance();
        configManager.resetToDefaults();
    });

    describe('loadConfig', () => {
        it('should load default configuration', async () => {
            const config = await configManager.loadConfig();
            
            assertEquals(config.enabled, true);
            assertEquals(config.progressDisplay.style, 'ollama');
            assertEquals(config.fileOrdering, 'alphabetical');
            assertEquals(config.errorHandling.continueOnError, true);
            assertEquals(config.errorHandling.maxErrors, 10);
        });

        it('should apply CLI overrides', async () => {
            const overrides: SequentialProcessingCLIOverrides = {
                enabled: false,
                dryRun: true,
                showProgress: false,
                maxErrors: 5,
                fileOrdering: 'size',
            };

            const config = await configManager.loadConfig(overrides);
            
            assertEquals(config.enabled, false);
            assertEquals(config.dryRun.enabled, true);
            assertEquals(config.progressDisplay.enabled, false);
            assertEquals(config.errorHandling.maxErrors, 5);
            assertEquals(config.fileOrdering, 'size');
        });

        it('should handle JSON report override', async () => {
            const overrides: SequentialProcessingCLIOverrides = {
                jsonReport: './custom-report.json',
            };

            const config = await configManager.loadConfig(overrides);
            
            assertTrue(config.reporting.jsonOutput);
            assertEquals(config.reporting.defaultJsonPath, './custom-report.json');
        });

        it('should handle output format overrides', async () => {
            const overrides: SequentialProcessingCLIOverrides = {
                outputFormat: 'json',
            };

            const config = await configManager.loadConfig(overrides);
            
            assertTrue(config.reporting.jsonOutput);
        });

        it('should handle group by directory override', async () => {
            const overrides: SequentialProcessingCLIOverrides = {
                groupByDirectory: true,
            };

            const config = await configManager.loadConfig(overrides);
            
            assertTrue(config.reporting.groupByDirectory);
        });
    });

    describe('validateConfig', () => {
        it('should validate valid configuration', () => {
            const result = configManager.validateConfig(DEFAULT_SEQUENTIAL_PROCESSING_CONFIG);
            
            assertTrue(result.isValid);
            assertEquals(result.errors.length, 0);
            assertExists(result.config);
        });

        it('should reject invalid progress bar width', () => {
            const invalidConfig: SequentialProcessingConfig = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG,
                progressDisplay: {
                    ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG.progressDisplay,
                    barWidth: 5, // Too small
                },
            };

            const result = configManager.validateConfig(invalidConfig);
            
            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors.some(e => e.field.includes('barWidth')));
        });

        it('should reject invalid max errors', () => {
            const invalidConfig: SequentialProcessingConfig = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG,
                errorHandling: {
                    ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG.errorHandling,
                    maxErrors: -1, // Invalid
                },
            };

            const result = configManager.validateConfig(invalidConfig);
            
            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors.some(e => e.field.includes('maxErrors')));
        });

        it('should reject invalid memory threshold', () => {
            const invalidConfig: SequentialProcessingConfig = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG,
                performance: {
                    ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG.performance,
                    memoryThreshold: 1000, // Too small (less than 100MB)
                },
            };

            const result = configManager.validateConfig(invalidConfig);
            
            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors.some(e => e.field.includes('memoryThreshold')));
        });

        it('should reject invalid file ordering', () => {
            const invalidConfig = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG,
                fileOrdering: 'invalid' as FileOrdering,
            };

            const result = configManager.validateConfig(invalidConfig);
            
            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
        });

        it('should reject invalid progress style', () => {
            const invalidConfig: SequentialProcessingConfig = {
                ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG,
                progressDisplay: {
                    ...DEFAULT_SEQUENTIAL_PROCESSING_CONFIG.progressDisplay,
                    style: 'invalid' as ProgressStyle,
                },
            };

            const result = configManager.validateConfig(invalidConfig);
            
            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
        });
    });

    describe('updateProgressDisplay', () => {
        it('should update progress display configuration', async () => {
            const updates = {
                enabled: false,
                style: 'simple' as ProgressStyle,
                colors: false,
                barWidth: 50,
            };

            const config = await configManager.updateProgressDisplay(updates);
            
            assertEquals(config.progressDisplay.enabled, false);
            assertEquals(config.progressDisplay.style, 'simple');
            assertEquals(config.progressDisplay.colors, false);
            assertEquals(config.progressDisplay.barWidth, 50);
        });
    });

    describe('updateErrorHandling', () => {
        it('should update error handling configuration', async () => {
            const updates = {
                continueOnError: false,
                maxErrors: 20,
                showErrorDetails: false,
            };

            const config = await configManager.updateErrorHandling(updates);
            
            assertEquals(config.errorHandling.continueOnError, false);
            assertEquals(config.errorHandling.maxErrors, 20);
            assertEquals(config.errorHandling.showErrorDetails, false);
        });
    });

    describe('updateReporting', () => {
        it('should update reporting configuration', async () => {
            const updates = {
                jsonOutput: true,
                defaultJsonPath: './test-report.json',
                groupByDirectory: true,
                includeMetrics: false,
            };

            const config = await configManager.updateReporting(updates);
            
            assertTrue(config.reporting.jsonOutput);
            assertEquals(config.reporting.defaultJsonPath, './test-report.json');
            assertTrue(config.reporting.groupByDirectory);
            assertFalse(config.reporting.includeMetrics);
        });
    });

    describe('getConfigSummary', () => {
        it('should return configuration summary', async () => {
            await configManager.loadConfig();
            const summary = configManager.getConfigSummary();
            
            assertExists(summary.enabled);
            assertExists(summary.progressStyle);
            assertExists(summary.fileOrdering);
            assertExists(summary.errorHandling);
            assertExists(summary.reporting);
            assertExists(summary.terminal);
        });

        it('should return not_loaded status when config not loaded', () => {
            const manager = SequentialProcessingConfigManager.getInstance();
            manager.resetToDefaults();
            // Clear the config
            (manager as any).config = null;
            
            const summary = manager.getConfigSummary();
            assertEquals(summary.status, 'not_loaded');
        });
    });

    describe('detectTerminalCapabilities', () => {
        it('should detect terminal capabilities and adjust config', async () => {
            // Mock environment variables
            const originalTerm = Deno.env.get('TERM');
            const originalLang = Deno.env.get('LANG');
            
            try {
                Deno.env.set('TERM', 'xterm-256color');
                Deno.env.set('LANG', 'en_US.UTF-8');
                
                const config = await configManager.loadConfig();
                
                // Should support colors and unicode with these settings
                assertTrue(config.terminal.colorSupport);
                assertTrue(config.terminal.unicodeSupport);
                assertTrue(config.progressDisplay.colors);
                assertTrue(config.progressDisplay.spinnerEnabled);
            } finally {
                // Restore original environment
                if (originalTerm) {
                    Deno.env.set('TERM', originalTerm);
                } else {
                    Deno.env.delete('TERM');
                }
                if (originalLang) {
                    Deno.env.set('LANG', originalLang);
                } else {
                    Deno.env.delete('LANG');
                }
            }
        });

        it('should disable colors when terminal does not support them', async () => {
            const originalTerm = Deno.env.get('TERM');
            
            try {
                Deno.env.set('TERM', 'dumb');
                
                // Clear cached config to force reload
                (configManager as any).config = null;
                
                const config = await configManager.loadConfig();
                
                // Debug output
                console.log('Terminal config:', config.terminal);
                console.log('Progress display config:', config.progressDisplay);
                
                // Should disable colors for dumb terminal
                assertFalse(config.terminal.colorSupport);
                assertFalse(config.progressDisplay.colors);
            } finally {
                if (originalTerm) {
                    Deno.env.set('TERM', originalTerm);
                } else {
                    Deno.env.delete('TERM');
                }
            }
        });
    });

    describe('environment variable loading', () => {
        it('should load configuration from environment variables', async () => {
            const originalVars = {
                NOVA_SEQUENTIAL_ENABLED: Deno.env.get('NOVA_SEQUENTIAL_ENABLED'),
                NOVA_PROGRESS_ENABLED: Deno.env.get('NOVA_PROGRESS_ENABLED'),
                NOVA_PROGRESS_STYLE: Deno.env.get('NOVA_PROGRESS_STYLE'),
                NOVA_CONTINUE_ON_ERROR: Deno.env.get('NOVA_CONTINUE_ON_ERROR'),
                NOVA_MAX_ERRORS: Deno.env.get('NOVA_MAX_ERRORS'),
                NOVA_FILE_ORDERING: Deno.env.get('NOVA_FILE_ORDERING'),
            };

            try {
                Deno.env.set('NOVA_SEQUENTIAL_ENABLED', 'false');
                Deno.env.set('NOVA_PROGRESS_ENABLED', 'false');
                Deno.env.set('NOVA_PROGRESS_STYLE', 'simple');
                Deno.env.set('NOVA_CONTINUE_ON_ERROR', 'false');
                Deno.env.set('NOVA_MAX_ERRORS', '5');
                Deno.env.set('NOVA_FILE_ORDERING', 'size');

                // Clear cached config to force reload
                (configManager as any).config = null;
                
                const config = await configManager.loadConfig();
                
                // Debug output
                console.log('Config enabled:', config.enabled);
                console.log('Progress enabled:', config.progressDisplay.enabled);
                console.log('Progress style:', config.progressDisplay.style);
                console.log('Continue on error:', config.errorHandling.continueOnError);
                console.log('Max errors:', config.errorHandling.maxErrors);
                console.log('File ordering:', config.fileOrdering);
                
                assertFalse(config.enabled);
                assertFalse(config.progressDisplay.enabled);
                assertEquals(config.progressDisplay.style, 'simple');
                assertFalse(config.errorHandling.continueOnError);
                assertEquals(config.errorHandling.maxErrors, 5);
                assertEquals(config.fileOrdering, 'size');
            } finally {
                // Restore original environment
                for (const [key, value] of Object.entries(originalVars)) {
                    if (value) {
                        Deno.env.set(key, value);
                    } else {
                        Deno.env.delete(key);
                    }
                }
            }
        });
    });

    describe('mergeConfigs', () => {
        it('should merge configurations correctly', async () => {
            const baseConfig = DEFAULT_SEQUENTIAL_PROCESSING_CONFIG;
            const override = {
                enabled: false,
                progressDisplay: {
                    style: 'simple' as ProgressStyle,
                    colors: false,
                },
                errorHandling: {
                    maxErrors: 5,
                },
            };

            // Access private method for testing
            const mergedConfig = (configManager as any).mergeConfigs(baseConfig, override);
            
            assertFalse(mergedConfig.enabled);
            assertEquals(mergedConfig.progressDisplay.style, 'simple');
            assertFalse(mergedConfig.progressDisplay.colors);
            assertEquals(mergedConfig.errorHandling.maxErrors, 5);
            // Should preserve other values from base config
            assertTrue(mergedConfig.progressDisplay.enabled);
            assertTrue(mergedConfig.errorHandling.continueOnError);
        });
    });
});