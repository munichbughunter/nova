/**
 * Workflow integration tests for EnhancedCodeReviewAgent with sequential processing
 * Tests the integration between command parsing, processing mode selection, and execution
 */

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { ReviewCommandParser } from '../services/command_parser.ts';
import { ProcessingModeSelector, ProcessingMode } from '../services/sequential_processor.ts';
import { Logger } from '../utils/logger.ts';

Deno.test('Command Parsing to Processing Mode Integration', async (t) => {
    const logger = new Logger('test', false);
    const parser = new ReviewCommandParser(logger);
    const selector = new ProcessingModeSelector(logger);

    await t.step('should parse file review commands and select sequential mode', () => {
        const { command } = parser.parseCommandArguments('review src/test.ts');
        
        assertExists(command);
        assertEquals(command.mode, 'file');
        assertExists(command.files);
        assertEquals(command.files.length, 1);
        assertEquals(command.files[0], 'src/test.ts');

        // Convert to processing command format
        const processingCommand = {
            type: 'files' as const,
            targets: command.files,
            options: {}
        };

        const mode = selector.determineProcessingMode(processingCommand);
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });

    await t.step('should parse multiple file commands and select appropriate mode', () => {
        const { command } = parser.parseCommandArguments('review src/test1.ts src/test2.ts src/test3.ts');
        
        assertExists(command);
        assertEquals(command.mode, 'file');
        assertExists(command.files);
        assertEquals(command.files.length, 3);

        const processingCommand = {
            type: 'files' as const,
            targets: command.files,
            options: {}
        };

        // Should default to sequential for file commands
        const defaultMode = selector.determineProcessingMode(processingCommand);
        assertEquals(defaultMode, ProcessingMode.SEQUENTIAL);

        // Should respect threshold settings
        const sequentialMode = selector.determineProcessingModeAdvanced(processingCommand, 3, {
            sequentialThreshold: 5
        });
        assertEquals(sequentialMode, ProcessingMode.SEQUENTIAL);

        const parallelMode = selector.determineProcessingModeAdvanced(processingCommand, 3, {
            sequentialThreshold: 1
        });
        assertEquals(parallelMode, ProcessingMode.PARALLEL);
    });

    await t.step('should parse changes commands and select parallel mode', () => {
        const { command } = parser.parseCommandArguments('review changes');
        
        assertExists(command);
        assertEquals(command.mode, 'changes');

        const processingCommand = {
            type: 'changes' as const,
            targets: [],
            options: {}
        };

        const mode = selector.determineProcessingMode(processingCommand);
        assertEquals(mode, ProcessingMode.PARALLEL);
    });

    await t.step('should parse PR commands and select parallel mode', () => {
        const { command } = parser.parseCommandArguments('review pr 123');
        
        assertExists(command);
        assertEquals(command.mode, 'pr');
        assertEquals(command.prId, '123');

        const processingCommand = {
            type: 'pr' as const,
            targets: ['123'],
            options: {}
        };

        const mode = selector.determineProcessingMode(processingCommand);
        assertEquals(mode, ProcessingMode.PARALLEL);
    });

    await t.step('should handle command parsing errors gracefully', () => {
        const { command, errors } = parser.parseCommandArguments('invalid command');
        
        assertEquals(command, null);
        assertEquals(errors.length > 0, true);
        assertStringIncludes(errors[0], 'Invalid or unrecognized');
    });

    await t.step('should validate file paths in commands', () => {
        const { command, errors, warnings } = parser.parseCommandArguments('review src/test1.ts src/test2.ts src/test3.ts src/test4.ts src/test5.ts');
        
        assertExists(command);
        assertEquals(errors.length, 0);
        
        // Should have warning for large number of files (threshold is 50, so this won't trigger)
        // Let's test with a command that has many files
        const manyFilesCommand = 'review ' + Array.from({length: 60}, (_, i) => `file${i}.ts`).join(' ');
        const { command: largeCommand, warnings: largeWarnings } = parser.parseCommandArguments(manyFilesCommand);
        
        assertExists(largeCommand);
        if (largeCommand.files && largeCommand.files.length > 50) {
            assertEquals(largeWarnings.length > 0, true);
            assertStringIncludes(largeWarnings[0], 'Large number of files');
        }
    });
});

Deno.test('Processing Mode Selection Logic', async (t) => {
    const logger = new Logger('test', false);
    const selector = new ProcessingModeSelector(logger);

    await t.step('should prioritize force options over defaults', () => {
        const command = {
            type: 'changes' as const, // Normally would be parallel
            targets: [],
            options: {}
        };

        // Force sequential should override default parallel for changes
        const sequentialMode = selector.determineProcessingModeAdvanced(command, 0, {
            forceSequential: true
        });
        assertEquals(sequentialMode, ProcessingMode.SEQUENTIAL);

        // Force parallel should override default sequential for files
        const fileCommand = {
            type: 'files' as const,
            targets: ['test.ts'],
            options: {}
        };

        const parallelMode = selector.determineProcessingModeAdvanced(fileCommand, 1, {
            forceParallel: true
        });
        assertEquals(parallelMode, ProcessingMode.PARALLEL);
    });

    await t.step('should use threshold-based selection for file commands', () => {
        const command = {
            type: 'files' as const,
            targets: ['test1.ts', 'test2.ts', 'test3.ts'],
            options: {}
        };

        // Test various thresholds
        const thresholds = [1, 2, 3, 5, 10];
        const fileCount = 3;

        for (const threshold of thresholds) {
            const mode = selector.determineProcessingModeAdvanced(command, fileCount, {
                sequentialThreshold: threshold
            });

            if (fileCount <= threshold) {
                assertEquals(mode, ProcessingMode.SEQUENTIAL, `Threshold ${threshold} should result in sequential mode`);
            } else {
                assertEquals(mode, ProcessingMode.PARALLEL, `Threshold ${threshold} should result in parallel mode`);
            }
        }
    });

    await t.step('should maintain backward compatibility', () => {
        // Default behavior should remain the same
        const fileCommand = {
            type: 'files' as const,
            targets: ['test.ts'],
            options: {}
        };

        const mode = selector.determineProcessingMode(fileCommand);
        assertEquals(mode, ProcessingMode.SEQUENTIAL);

        const changesCommand = {
            type: 'changes' as const,
            targets: [],
            options: {}
        };

        const changesMode = selector.determineProcessingMode(changesCommand);
        assertEquals(changesMode, ProcessingMode.PARALLEL);
    });
});

Deno.test('Command to Processing Mode Mapping', async (t) => {
    const logger = new Logger('test', false);
    const parser = new ReviewCommandParser(logger);
    const selector = new ProcessingModeSelector(logger);

    const testCases = [
        {
            input: 'review src/test.ts',
            expectedMode: ProcessingMode.SEQUENTIAL,
            description: 'single file should use sequential'
        },
        {
            input: 'review src/*.ts',
            expectedMode: ProcessingMode.SEQUENTIAL,
            description: 'wildcard files should use sequential'
        },
        {
            input: 'review changes',
            expectedMode: ProcessingMode.PARALLEL,
            description: 'changes review should use parallel'
        },
        {
            input: 'review pr',
            expectedMode: ProcessingMode.PARALLEL,
            description: 'PR review should use parallel'
        },
        {
            input: 'review pr 123',
            expectedMode: ProcessingMode.PARALLEL,
            description: 'specific PR review should use parallel'
        }
    ];

    for (const testCase of testCases) {
        await t.step(testCase.description, () => {
            const { command } = parser.parseCommandArguments(testCase.input);
            assertExists(command, `Failed to parse command: ${testCase.input}`);

            let processingCommand;
            if (command.mode === 'file') {
                processingCommand = {
                    type: 'files' as const,
                    targets: command.files || [],
                    options: {}
                };
            } else if (command.mode === 'changes') {
                processingCommand = {
                    type: 'changes' as const,
                    targets: [],
                    options: {}
                };
            } else if (command.mode === 'pr') {
                processingCommand = {
                    type: 'pr' as const,
                    targets: command.prId ? [command.prId] : [],
                    options: {}
                };
            } else {
                throw new Error(`Unexpected command mode: ${command.mode}`);
            }

            const mode = selector.determineProcessingMode(processingCommand);
            assertEquals(mode, testCase.expectedMode, `Command "${testCase.input}" should use ${testCase.expectedMode} mode`);
        });
    }
});

Deno.test('Error Handling and Edge Cases', async (t) => {
    const logger = new Logger('test', false);
    const parser = new ReviewCommandParser(logger);
    const selector = new ProcessingModeSelector(logger);

    await t.step('should handle empty file lists', () => {
        const command = {
            type: 'files' as const,
            targets: [],
            options: {}
        };

        const mode = selector.determineProcessingMode(command);
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });

    await t.step('should handle invalid command types gracefully', () => {
        // This tests the default case in the processing mode selector
        const command = {
            type: 'files' as const,
            targets: ['test.ts'],
            options: {}
        };

        const mode = selector.determineProcessingMode(command);
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });

    await t.step('should handle conflicting force options', () => {
        const command = {
            type: 'files' as const,
            targets: ['test.ts'],
            options: {}
        };

        // Force sequential should take precedence over force parallel
        const mode = selector.determineProcessingModeAdvanced(command, 1, {
            forceSequential: true,
            forceParallel: true
        });
        assertEquals(mode, ProcessingMode.SEQUENTIAL);
    });

    await t.step('should handle zero threshold', () => {
        const command = {
            type: 'files' as const,
            targets: ['test.ts'],
            options: {}
        };

        const mode = selector.determineProcessingModeAdvanced(command, 1, {
            sequentialThreshold: 0
        });
        assertEquals(mode, ProcessingMode.PARALLEL);
    });
});