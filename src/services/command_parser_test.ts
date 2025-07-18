import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { ReviewCommandParser } from './command_parser.ts';
import { Logger } from '../../utils/logger.ts';

const mockLogger = new Logger('test', false);

Deno.test('ReviewCommandParser - parseReviewCommand - file mode single file', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const result = parser.parseReviewCommand('review src/components/Header.tsx');
    
    assertExists(result);
    assertEquals(result.mode, 'file');
    assertEquals(result.files?.length, 1);
    assertEquals(result.files?.[0], 'src/components/Header.tsx');
});

Deno.test('ReviewCommandParser - parseReviewCommand - file mode multiple files', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const result = parser.parseReviewCommand('review src/utils/helper.js src/services/api.ts');
    
    assertExists(result);
    assertEquals(result.mode, 'file');
    assertEquals(result.files?.length, 2);
    assertEquals(result.files?.[0], 'src/utils/helper.js');
    assertEquals(result.files?.[1], 'src/services/api.ts');
});

Deno.test('ReviewCommandParser - parseReviewCommand - changes mode default', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const result = parser.parseReviewCommand('review');
    
    assertExists(result);
    assertEquals(result.mode, 'changes');
    assertEquals(result.files, undefined);
});

Deno.test('ReviewCommandParser - parseReviewCommand - changes mode explicit', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        'review changes',
        'review changed',
        'review diff',
        'review modifications',
        'review modified',
    ];

    for (const testCase of testCases) {
        const result = parser.parseReviewCommand(testCase);
        assertExists(result);
        assertEquals(result.mode, 'changes');
    }
});

Deno.test('ReviewCommandParser - parseReviewCommand - PR mode without ID', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        'review pr',
        'review pull-request',
        'review pull request',
        'review mr',
        'review merge-request',
        'review merge request',
    ];

    for (const testCase of testCases) {
        const result = parser.parseReviewCommand(testCase);
        assertExists(result);
        assertEquals(result.mode, 'pr');
        assertEquals(result.prId, undefined);
    }
});

Deno.test('ReviewCommandParser - parseReviewCommand - PR mode with ID', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        { input: 'review pr 123', expectedId: '123' },
        { input: 'review pull-request 456', expectedId: '456' },
        { input: 'review mr 789', expectedId: '789' },
        { input: 'review merge-request 42', expectedId: '42' },
    ];

    for (const testCase of testCases) {
        const result = parser.parseReviewCommand(testCase.input);
        assertExists(result);
        assertEquals(result.mode, 'pr');
        assertEquals(result.prId, testCase.expectedId);
    }
});

Deno.test('ReviewCommandParser - parseReviewCommand - with agent prefix', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        'example review src/test.ts',
        'ExampleAgent review src/test.ts',
        'agent review src/test.ts',
        'nova review src/test.ts',
        'dev review src/test.ts',
    ];

    for (const testCase of testCases) {
        const result = parser.parseReviewCommand(testCase);
        assertExists(result);
        assertEquals(result.mode, 'file');
        assertEquals(result.files?.length, 1);
        assertEquals(result.files?.[0], 'src/test.ts');
    }
});

Deno.test('ReviewCommandParser - parseReviewCommand - non-review commands', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        'analyze src/test.ts',
        'help',
        'what is TypeScript?',
        'explain functions',
        'debug this code',
    ];

    for (const testCase of testCases) {
        const result = parser.parseReviewCommand(testCase);
        assertEquals(result, null);
    }
});

Deno.test('ReviewCommandParser - parseReviewCommand - file paths with wildcards', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const result = parser.parseReviewCommand('review src/*.ts src/**/*.js');
    
    assertExists(result);
    assertEquals(result.mode, 'file');
    assertEquals(result.files?.length, 2);
    assertEquals(result.files?.[0], 'src/*.ts');
    assertEquals(result.files?.[1], 'src/**/*.js');
});

Deno.test('ReviewCommandParser - parseReviewCommand - quoted file paths', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        { input: 'review "src/file with spaces.ts"', expected: 'src/file with spaces.ts' },
        { input: "review 'src/another file.js'", expected: 'src/another file.js' },
    ];

    for (const testCase of testCases) {
        const result = parser.parseReviewCommand(testCase.input);
        assertExists(result);
        assertEquals(result.mode, 'file');
        assertEquals(result.files?.length, 1);
        assertEquals(result.files?.[0], testCase.expected);
    }
});

Deno.test('ReviewCommandParser - validateFilePaths - valid paths', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const validPaths = [
        'src/components/Header.tsx',
        'utils/helper.js',
        './relative/path.ts',
        '../parent/file.py',
        'src/*.ts',
        'test/**/*.spec.js',
        '~/home/file.txt',
    ];

    const result = parser.validateFilePaths(validPaths);
    
    assertEquals(result.valid.length, validPaths.length);
    assertEquals(result.invalid.length, 0);
});

Deno.test('ReviewCommandParser - validateFilePaths - invalid paths', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const invalidPaths = [
        '', // Empty
        'file<with>invalid:chars',
        'file|with|pipes',
        'file"with"quotes',
        'a'.repeat(300), // Too long
    ];

    const result = parser.validateFilePaths(invalidPaths);
    
    assertEquals(result.valid.length, 0);
    assertEquals(result.invalid.length, invalidPaths.length);
});

Deno.test('ReviewCommandParser - validateFilePaths - mixed valid and invalid', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const mixedPaths = [
        'src/valid.ts', // Valid
        'invalid<file>', // Invalid
        'another/valid.js', // Valid
        '', // Invalid
        'third/valid.py', // Valid
    ];

    const result = parser.validateFilePaths(mixedPaths);
    
    assertEquals(result.valid.length, 3);
    assertEquals(result.invalid.length, 2);
    assertEquals(result.valid.includes('src/valid.ts'), true);
    assertEquals(result.valid.includes('another/valid.js'), true);
    assertEquals(result.valid.includes('third/valid.py'), true);
});

Deno.test('ReviewCommandParser - parseCommandArguments - valid file command', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const result = parser.parseCommandArguments('review src/test.ts src/utils.js');
    
    assertExists(result.command);
    assertEquals(result.command.mode, 'file');
    assertEquals(result.command.files?.length, 2);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 0);
});

Deno.test('ReviewCommandParser - parseCommandArguments - invalid file paths', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    // Use file-like strings that will be parsed but are invalid
    const result = parser.parseCommandArguments('review invalid<file>.ts valid.ts');
    
    assertExists(result.command);
    assertEquals(result.command.mode, 'file');
    assertEquals(result.command.files?.length, 1); // Only valid file
    assertEquals(result.command.files?.[0], 'valid.ts');
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].includes('Invalid file paths'), true);
});

Deno.test('ReviewCommandParser - parseCommandArguments - no valid files', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    // Use file-like strings that will be parsed but are all invalid
    const result = parser.parseCommandArguments('review invalid<file>.ts another|invalid.js');
    
    assertEquals(result.command, null);
    assertEquals(result.errors.length, 2); // Both "Invalid file paths" and "No valid file paths" errors
    assertEquals(result.errors[0].includes('Invalid file paths'), true);
    assertEquals(result.errors[1], 'No valid file paths specified');
});

Deno.test('ReviewCommandParser - parseCommandArguments - too many files warning', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    // Create a command with many files
    const manyFiles = Array.from({ length: 60 }, (_, i) => `file${i}.ts`).join(' ');
    const result = parser.parseCommandArguments(`review ${manyFiles}`);
    
    assertExists(result.command);
    assertEquals(result.warnings.length, 1);
    assertEquals(result.warnings[0].includes('Large number of files'), true);
});

Deno.test('ReviewCommandParser - parseCommandArguments - invalid PR ID', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        'review pr abc',
        'review pr -1',
        'review pr 0',
        'review mr invalid',
    ];

    for (const testCase of testCases) {
        const result = parser.parseCommandArguments(testCase);
        assertEquals(result.errors.length, 1);
        assertEquals(result.errors[0].includes('Invalid PR/MR ID'), true);
    }
});

Deno.test('ReviewCommandParser - parseCommandArguments - valid PR commands', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        { input: 'review pr', expectedId: undefined },
        { input: 'review pr 123', expectedId: '123' },
        { input: 'review mr 456', expectedId: '456' },
    ];

    for (const testCase of testCases) {
        const result = parser.parseCommandArguments(testCase.input);
        assertExists(result.command);
        assertEquals(result.command.mode, 'pr');
        assertEquals(result.command.prId, testCase.expectedId);
        assertEquals(result.errors.length, 0);
    }
});

Deno.test('ReviewCommandParser - parseCommandArguments - changes mode', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const testCases = [
        'review',
        'review changes',
        'review diff',
    ];

    for (const testCase of testCases) {
        const result = parser.parseCommandArguments(testCase);
        assertExists(result.command);
        assertEquals(result.command.mode, 'changes');
        assertEquals(result.errors.length, 0);
        assertEquals(result.warnings.length, 0);
    }
});

Deno.test('ReviewCommandParser - parseCommandArguments - invalid command', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const result = parser.parseCommandArguments('not a review command');
    
    assertEquals(result.command, null);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0], 'Invalid or unrecognized review command format');
});

Deno.test('ReviewCommandParser - getReviewCommandHelp - returns help text', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    const help = parser.getReviewCommandHelp();
    
    assertEquals(typeof help, 'string');
    assertEquals(help.length > 0, true);
    assertEquals(help.includes('File Review Mode'), true);
    assertEquals(help.includes('Changes Review Mode'), true);
    assertEquals(help.includes('Pull Request Review Mode'), true);
    assertEquals(help.includes('Examples'), true);
});

Deno.test('ReviewCommandParser - edge cases and complex inputs', () => {
    const parser = new ReviewCommandParser(mockLogger);
    
    // Test case sensitivity
    const caseResult = parser.parseReviewCommand('REVIEW SRC/TEST.TS');
    assertExists(caseResult);
    assertEquals(caseResult.mode, 'file');
    
    // Test with extra whitespace
    const whitespaceResult = parser.parseReviewCommand('  review   src/test.ts   src/utils.js  ');
    assertExists(whitespaceResult);
    assertEquals(whitespaceResult.mode, 'file');
    assertEquals(whitespaceResult.files?.length, 2);
    
    // Test mixed separators
    const mixedResult = parser.parseReviewCommand('review src\\windows\\path.ts src/unix/path.js');
    assertExists(mixedResult);
    assertEquals(mixedResult.mode, 'file');
    assertEquals(mixedResult.files?.length, 2);
});