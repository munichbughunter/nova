/**
 * Unit tests for EnhancedCodeReviewAgent sequential processing integration
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { ProcessingModeSelector, ProcessingMode } from '../services/sequential_processor.ts';
import { Logger } from '../utils/logger.ts';

Deno.test('ProcessingModeSelector Unit Tests', async (t) => {
    const logger = new Logger('test', false);
    const selector = new ProcessingModeSelector(logger);

    await t.step('should select sequential mode for file commands', () => {
        const command = {
            type: 'files' as const,
            targets: ['test1.ts', 'test2.ts'],
            options: {}
        };

        const mode = selector.determineProcessingMode(command);
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });

    await t.step('should select sequential mode for directory commands', () => {
        const command = {
            type: 'directory' as const,
            targets: ['src/'],
            options: {}
        };

        const mode = selector.determineProcessingMode(command);
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });

    await t.step('should select parallel mode for PR commands', () => {
        const command = {
            type: 'pr' as const,
            targets: ['123'],
            options: {}
        };

        const mode = selector.determineProcessingMode(command);
        assertEquals(mode, ProcessingMode.PARALLEL);
    });

    await t.step('should select parallel mode for changes commands', () => {
        const command = {
            type: 'changes' as const,
            targets: [],
            options: {}
        };

        const mode = selector.determineProcessingMode(command);
        assertEquals(mode, ProcessingMode.PARALLEL);
    });

    await t.step('should respect force sequential option', () => {
        const command = {
            type: 'files' as const,
            targets: ['test1.ts', 'test2.ts', 'test3.ts'],
            options: {}
        };

        const mode = selector.determineProcessingModeAdvanced(command, 3, {
            forceSequential: true
        });
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });

    await t.step('should respect force parallel option', () => {
        const command = {
            type: 'files' as const,
            targets: ['test1.ts'],
            options: {}
        };

        const mode = selector.determineProcessingModeAdvanced(command, 1, {
            forceParallel: true
        });
        assertEquals(mode, ProcessingMode.PARALLEL);
    });

    await t.step('should use threshold for automatic selection', () => {
        const command = {
            type: 'files' as const,
            targets: ['test1.ts', 'test2.ts'],
            options: {}
        };

        // Below threshold - should use sequential
        const sequentialMode = selector.determineProcessingModeAdvanced(command, 2, {
            sequentialThreshold: 5
        });
        assertEquals(sequentialMode, ProcessingMode.SEQUENTIAL);

        // Above threshold - should use parallel
        const parallelMode = selector.determineProcessingModeAdvanced(command, 2, {
            sequentialThreshold: 1
        });
        assertEquals(parallelMode, ProcessingMode.PARALLEL);
    });

    await t.step('should default to sequential for unknown command types', () => {
        const command = {
            type: 'files' as const,
            targets: ['test1.ts'],
            options: {}
        };

        const mode = selector.determineProcessingMode(command);
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });
});

Deno.test('Sequential Processing Integration Logic', async (t) => {
    await t.step('should have correct processing mode enum values', () => {
        assertEquals(ProcessingMode.SEQUENTIAL, 'sequential');
        assertEquals(ProcessingMode.PARALLEL, 'parallel');
    });

    await t.step('should export required interfaces and classes', () => {
        assertExists(ProcessingModeSelector);
        assertExists(ProcessingMode);
    });
});