/**
 * CLI Configuration Mapper Tests
 */

import { assertEquals, assert } from 'std/assert/mod.ts';

// Helper functions for boolean assertions
function assertTrue(value: boolean, message?: string) {
    assert(value === true, message);
}

function assertFalse(value: boolean, message?: string) {
    assert(value === false, message);
}
import { describe, it } from 'std/testing/bdd.ts';
import { CLIConfigMapper } from './cli-config-mapper.ts';
import { EnhancedCLIOptions } from '../types/enhanced-cli.types.ts';
import { SequentialProcessingCLIOverrides } from './sequential-processing.types.ts';

describe('CLIConfigMapper', () => {
    describe('mapCLIToSequentialConfig', () => {
        it('should map basic CLI options to sequential config overrides', () => {
            const cliOptions: EnhancedCLIOptions = {
                sequential: true,
                dryRun: true,
                jsonReport: './report.json',
                groupByDirectory: true,
                outputFormat: 'both',
            };

            const overrides = CLIConfigMapper.mapCLIToSequentialConfig(cliOptions);

            assertEquals(overrides.enabled, true);
            assertEquals(overrides.dryRun, true);
            assertEquals(overrides.jsonReport, './report.json');
            assertEquals(overrides.groupByDirectory, true);
            assertEquals(overrides.outputFormat, 'both');
        });

        it('should map progress options', () => {
            const cliOptions: EnhancedCLIOptions = {
                showProgress: false,
                showETA: false,
                showThroughput: true,
            };

            const overrides = CLIConfigMapper.mapCLIToSequentialConfig(cliOptions);

            assertEquals(overrides.showProgress, false);
            assertEquals(overrides.showETA, false);
            assertEquals(overrides.showThroughput, true);
        });

        it('should map error handling options', () => {
            const cliOptions: EnhancedCLIOptions = {
                continueOnError: false,
                maxErrors: 5,
            };

            const overrides = CLIConfigMapper.mapCLIToSequentialConfig(cliOptions);

            assertEquals(overrides.continueOnError, false);
            assertEquals(overrides.maxErrors, 5);
        });

        it('should map file ordering option', () => {
            const cliOptions: EnhancedCLIOptions = {
                fileOrdering: 'size',
            };

            const overrides = CLIConfigMapper.mapCLIToSequentialConfig(cliOptions);

            assertEquals(overrides.fileOrdering, 'size');
        });

        it('should handle undefined options', () => {
            const cliOptions: EnhancedCLIOptions = {};

            const overrides = CLIConfigMapper.mapCLIToSequentialConfig(cliOptions);

            assertEquals(Object.keys(overrides).length, 0);
        });
    });

    describe('validateCLIOptions', () => {
        it('should validate valid CLI options', () => {
            const cliOptions: EnhancedCLIOptions = {
                sequential: true,
                fileOrdering: 'alphabetical',
                outputFormat: 'console',
                maxErrors: 10,
                jsonReport: './report.json',
            };

            const result = CLIConfigMapper.validateCLIOptions(cliOptions);

            assertTrue(result.isValid);
            assertEquals(result.errors.length, 0);
        });

        it('should reject invalid file ordering', () => {
            const cliOptions: EnhancedCLIOptions = {
                fileOrdering: 'invalid' as any,
            };

            const result = CLIConfigMapper.validateCLIOptions(cliOptions);

            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors[0].includes('Invalid file ordering'));
        });

        it('should reject invalid output format', () => {
            const cliOptions: EnhancedCLIOptions = {
                outputFormat: 'invalid' as any,
            };

            const result = CLIConfigMapper.validateCLIOptions(cliOptions);

            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors[0].includes('Invalid output format'));
        });

        it('should reject invalid max errors', () => {
            const cliOptions: EnhancedCLIOptions = {
                maxErrors: -1,
            };

            const result = CLIConfigMapper.validateCLIOptions(cliOptions);

            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors[0].includes('Invalid max errors'));
        });

        it('should reject max errors above limit', () => {
            const cliOptions: EnhancedCLIOptions = {
                maxErrors: 1001,
            };

            const result = CLIConfigMapper.validateCLIOptions(cliOptions);

            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors[0].includes('Invalid max errors'));
        });

        it('should reject invalid JSON report path type', () => {
            const cliOptions: EnhancedCLIOptions = {
                jsonReport: 123 as any,
            };

            const result = CLIConfigMapper.validateCLIOptions(cliOptions);

            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors[0].includes('JSON report path must be a string'));
        });

        it('should reject conflicting dry-run and json-report options', () => {
            const cliOptions: EnhancedCLIOptions = {
                dryRun: true,
                jsonReport: './report.json',
            };

            const result = CLIConfigMapper.validateCLIOptions(cliOptions);

            assertFalse(result.isValid);
            assertTrue(result.errors.length > 0);
            assertTrue(result.errors[0].includes('Cannot use --dry-run with --json-report'));
        });
    });

    describe('getDefaultCLIOptions', () => {
        it('should return default CLI options', () => {
            const defaults = CLIConfigMapper.getDefaultCLIOptions();

            assertEquals(defaults.sequential, true);
            assertEquals(defaults.showProgress, true);
            assertEquals(defaults.showETA, true);
            assertEquals(defaults.showThroughput, true);
            assertEquals(defaults.continueOnError, true);
            assertEquals(defaults.maxErrors, 10);
            assertEquals(defaults.fileOrdering, 'alphabetical');
            assertEquals(defaults.outputFormat, 'console');
            assertEquals(defaults.dryRun, false);
            assertEquals(defaults.groupByDirectory, false);
        });
    });

    describe('mergeWithDefaults', () => {
        it('should merge CLI options with defaults', () => {
            const cliOptions: EnhancedCLIOptions = {
                sequential: false,
                maxErrors: 5,
            };

            const merged = CLIConfigMapper.mergeWithDefaults(cliOptions);

            assertEquals(merged.sequential, false); // Overridden
            assertEquals(merged.maxErrors, 5); // Overridden
            assertEquals(merged.showProgress, true); // From defaults
            assertEquals(merged.fileOrdering, 'alphabetical'); // From defaults
        });
    });

    describe('extractSequentialOptions', () => {
        it('should extract only sequential processing related options', () => {
            const cliOptions: EnhancedCLIOptions = {
                files: ['file1.ts', 'file2.ts'],
                agent: 'review',
                verbose: true,
                sequential: true,
                dryRun: true,
                showProgress: false,
                maxErrors: 5,
            };

            const extracted = CLIConfigMapper.extractSequentialOptions(cliOptions);

            assertEquals(extracted.sequential, true);
            assertEquals(extracted.dryRun, true);
            assertEquals(extracted.showProgress, false);
            assertEquals(extracted.maxErrors, 5);
            
            // Should not include non-sequential options
            assertEquals(extracted.files, undefined);
            assertEquals(extracted.agent, undefined);
            assertEquals(extracted.verbose, undefined);
        });
    });

    describe('getHelpText', () => {
        it('should return help text for sequential processing options', () => {
            const helpText = CLIConfigMapper.getHelpText();

            assertTrue(helpText.includes('Sequential Processing Options'));
            assertTrue(helpText.includes('--sequential'));
            assertTrue(helpText.includes('--dry-run'));
            assertTrue(helpText.includes('--json-report'));
            assertTrue(helpText.includes('--show-progress'));
            assertTrue(helpText.includes('Examples:'));
        });
    });

    describe('parseProgressStyle', () => {
        it('should parse valid progress styles', () => {
            assertEquals(CLIConfigMapper.parseProgressStyle('ollama'), 'ollama');
            assertEquals(CLIConfigMapper.parseProgressStyle('enhanced'), 'enhanced');
            assertEquals(CLIConfigMapper.parseProgressStyle('simple'), 'simple');
            assertEquals(CLIConfigMapper.parseProgressStyle('minimal'), 'minimal');
        });

        it('should return null for invalid progress styles', () => {
            assertEquals(CLIConfigMapper.parseProgressStyle('invalid'), null);
            assertEquals(CLIConfigMapper.parseProgressStyle(''), null);
        });
    });

    describe('parseFileOrdering', () => {
        it('should parse valid file orderings', () => {
            assertEquals(CLIConfigMapper.parseFileOrdering('alphabetical'), 'alphabetical');
            assertEquals(CLIConfigMapper.parseFileOrdering('size'), 'size');
            assertEquals(CLIConfigMapper.parseFileOrdering('modified'), 'modified');
            assertEquals(CLIConfigMapper.parseFileOrdering('natural'), 'natural');
        });

        it('should return null for invalid file orderings', () => {
            assertEquals(CLIConfigMapper.parseFileOrdering('invalid'), null);
            assertEquals(CLIConfigMapper.parseFileOrdering(''), null);
        });
    });
});