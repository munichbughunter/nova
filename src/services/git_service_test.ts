import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { GitServiceImpl } from './git_service.ts';
import type { Logger } from '../utils/logger.ts';

// Mock logger for testing
const mockLogger = {
    child: () => mockLogger,
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
    success: () => {},
    passThrough: () => {},
    debugEnabled: false,
    context: {},
} as unknown as Logger;

Deno.test('GitService - parseChangeType', async (t) => {
    const gitService = new GitServiceImpl(mockLogger);
    
    await t.step('should parse added files correctly', () => {
        // Access private method for testing
        const parseChangeType = (gitService as any).parseChangeType.bind(gitService);
        
        assertEquals(parseChangeType('A '), 'added');
        assertEquals(parseChangeType(' A'), 'added');
        assertEquals(parseChangeType('??'), 'added');
    });

    await t.step('should parse modified files correctly', () => {
        const parseChangeType = (gitService as any).parseChangeType.bind(gitService);
        
        assertEquals(parseChangeType('M '), 'modified');
        assertEquals(parseChangeType(' M'), 'modified');
        assertEquals(parseChangeType('MM'), 'modified');
    });

    await t.step('should parse deleted files correctly', () => {
        const parseChangeType = (gitService as any).parseChangeType.bind(gitService);
        
        assertEquals(parseChangeType('D '), 'deleted');
        assertEquals(parseChangeType(' D'), 'deleted');
    });
});

Deno.test('GitService - parseDiff', async (t) => {
    const gitService = new GitServiceImpl(mockLogger);
    
    await t.step('should parse simple diff correctly', () => {
        const diffOutput = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line 1
-line 2
+line 2 modified
+new line 3
 line 3`;

        const parseDiff = (gitService as any).parseDiff.bind(gitService);
        const hunks = parseDiff(diffOutput);
        
        assertEquals(hunks.length, 1);
        assertEquals(hunks[0].oldStart, 1);
        assertEquals(hunks[0].oldLines, 3);
        assertEquals(hunks[0].newStart, 1);
        assertEquals(hunks[0].newLines, 4);
        assertEquals(hunks[0].lines.length, 5); // Fixed: should be 5 lines (1 context + 1 deletion + 2 additions + 1 context)
        
        // Check line types
        assertEquals(hunks[0].lines[0].type, 'context');
        assertEquals(hunks[0].lines[1].type, 'deletion');
        assertEquals(hunks[0].lines[2].type, 'addition');
        assertEquals(hunks[0].lines[3].type, 'addition');
    });

    await t.step('should handle multiple hunks', () => {
        const diffOutput = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,3 @@
 line 1
+new line 2
 line 2
@@ -10,2 +11,3 @@
 line 10
+new line 11
 line 11`;

        const parseDiff = (gitService as any).parseDiff.bind(gitService);
        const hunks = parseDiff(diffOutput);
        
        assertEquals(hunks.length, 2);
        assertEquals(hunks[0].oldStart, 1);
        assertEquals(hunks[1].oldStart, 10);
    });
});

Deno.test('GitService - error handling', async (t) => {
    const gitService = new GitServiceImpl(mockLogger, '/nonexistent/directory');
    
    await t.step('should handle git command failures gracefully', async () => {
        await assertRejects(
            () => gitService.getRemoteUrl(),
            Error,
            'Failed to get remote URL'
        );
    });

    await t.step('should handle missing git installation', async () => {
        // This test would require mocking Deno.Command, which is complex
        // In a real scenario, we'd use a mocking framework
        // For now, we'll just verify the error handling structure exists
        const runGitCommand = (gitService as any).runGitCommand.bind(gitService);
        
        await assertRejects(
            () => runGitCommand(['invalid-command']),
            Error
        );
    });
});

Deno.test('GitService - integration tests', async (t) => {
    // These tests would only run in a real Git repository
    // We'll skip them if not in a Git repo
    
    const gitService = new GitServiceImpl(mockLogger);
    
    await t.step('should detect if directory is a Git repository', async () => {
        const isRepo = await gitService.isGitRepository();
        // This will be true if running in the Nova repository
        if (isRepo) {
            console.log('Running in Git repository - integration tests enabled');
        } else {
            console.log('Not in Git repository - skipping integration tests');
        }
    });

    await t.step('should get repository root if in Git repo', async () => {
        const isRepo = await gitService.isGitRepository();
        if (isRepo) {
            const root = await gitService.getRepositoryRoot();
            assertEquals(typeof root, 'string');
            console.log(`Repository root: ${root}`);
        }
    });

    await t.step('should get current branch if in Git repo', async () => {
        const isRepo = await gitService.isGitRepository();
        if (isRepo) {
            try {
                const branch = await gitService.getCurrentBranch();
                assertEquals(typeof branch, 'string');
                console.log(`Current branch: ${branch}`);
            } catch (error) {
                // This might fail in CI or detached HEAD state
                const message = error instanceof Error ? error.message : String(error);
                console.log(`Branch detection failed (expected in some environments): ${message}`);
            }
        }
    });

    await t.step('should get remote URL if in Git repo', async () => {
        const isRepo = await gitService.isGitRepository();
        if (isRepo) {
            try {
                const remoteUrl = await gitService.getRemoteUrl();
                assertEquals(typeof remoteUrl, 'string');
                console.log(`Remote URL: ${remoteUrl}`);
            } catch (error) {
                // This might fail if no remote is configured
                const message = error instanceof Error ? error.message : String(error);
                console.log(`Remote URL detection failed: ${message}`);
            }
        }
    });
});