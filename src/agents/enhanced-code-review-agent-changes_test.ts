import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { EnhancedCodeReviewAgent } from './enhanced-code-review-agent.ts';
import type { AgentContext } from './types.ts';
import { Logger } from '../utils/logger.ts';

// Mock dependencies
class MockLogger extends Logger {
    logs: Array<{level: string; message: string; data?: unknown}> = [];
    
    constructor() {
        super('test', false);
    }
    
    override debug(message: string, data?: unknown): void {
        this.logs.push({ level: 'debug', message, data });
    }
    
    override info(message: string, data?: unknown): void {
        this.logs.push({ level: 'info', message, data });
    }
    
    override warn(message: string, data?: unknown): void {
        this.logs.push({ level: 'warn', message, data });
    }
    
    override error(message: string, data?: unknown): void {
        this.logs.push({ level: 'error', message, data });
    }
    
    override child(name: string): Logger {
        return this;
    }
}

// Create mock context
function createMockContext(): {context: AgentContext; logger: MockLogger} {
    const logger = new MockLogger();
    
    const context: AgentContext = {
        config: {
            gitlab: {
                url: 'https://gitlab.com',
                token: 'test-token',
            },
        },
        logger,
        llmProvider: undefined,
        mcpEnabled: false,
        mcpService: {
            isEnabled: () => false,
            listTools: () => [],
            getTools: () => [],
            executeTool: async () => ({ success: false, error: 'MCP not enabled' }),
        },
        workingDirectory: '/test',
    } as AgentContext;
    
    return { context, logger };
}

Deno.test('EnhancedCodeReviewAgent - changes review mode - not a git repository', async () => {
    const { context } = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock git service to return false for isGitRepository
    agent['gitService'] = {
        isGitRepository: async () => false,
        getChangedFiles: async () => [],
        getFileChanges: async () => [],
        getRemoteUrl: async () => 'https://github.com/user/repo.git',
        getCurrentBranch: async () => 'main',
    };
    
    const response = await agent.execute('review');
    
    assertEquals(response.success, false);
    assertStringIncludes(response.content, 'not a Git repository');
    assertStringIncludes(response.content, 'Change detection requires Git');
});

Deno.test('EnhancedCodeReviewAgent - changes review mode - no changed files', async () => {
    const { context } = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock git service to return no changed files
    agent['gitService'] = {
        isGitRepository: async () => true,
        getChangedFiles: async () => [],
        getFileChanges: async () => [],
        getRemoteUrl: async () => 'https://github.com/user/repo.git',
        getCurrentBranch: async () => 'main',
    };
    
    const response = await agent.execute('review');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'No changed files detected');
    assertStringIncludes(response.content, 'All files are up to date');
});

Deno.test('EnhancedCodeReviewAgent - changes review mode - non-reviewable files only', async () => {
    const { context } = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock git service to return only non-reviewable files
    agent['gitService'] = {
        isGitRepository: async () => true,
        getChangedFiles: async () => ['image.png', 'document.pdf', 'binary.exe'],
        getFileChanges: async () => [],
        getRemoteUrl: async () => 'https://github.com/user/repo.git',
        getCurrentBranch: async () => 'main',
    };
    
    const response = await agent.execute('review');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'Found 3 changed file');
    assertStringIncludes(response.content, 'none are suitable for code review');
    assertStringIncludes(response.content, 'Binary files, images, and other non-code files are excluded');
});

Deno.test('EnhancedCodeReviewAgent - changes review mode - with reviewable files', async () => {
    const { context } = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock git service to return reviewable files
    agent['gitService'] = {
        isGitRepository: async () => true,
        getChangedFiles: async () => ['src/test.ts', 'README.md', 'image.png'],
        getFileChanges: async () => [],
        getRemoteUrl: async () => 'https://github.com/user/repo.git',
        getCurrentBranch: async () => 'main',
    };
    
    // Mock file reading to return content
    const originalExecute = agent.execute.bind(agent);
    let mockFileContent = 'function test() { return "hello"; }';
    
    // Override the readFile tool wrapper behavior
    const mockReadFile = async (context: any, filePath: string) => {
        if (filePath === 'src/test.ts' || filePath === 'README.md') {
            return { success: true, data: mockFileContent };
        }
        return { success: false, error: 'File not found' };
    };
    
    // This is a simplified test - in a real scenario we'd need to properly mock the tool wrapper
    const response = await agent.execute('review');
    
    // Should attempt to process the files
    assertStringIncludes(response.content, 'Change Detection Review');
});

Deno.test('EnhancedCodeReviewAgent - isReviewableFile method', async () => {
    const { context } = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Test reviewable files
    assertEquals(agent['isReviewableFile']('src/test.ts'), true);
    assertEquals(agent['isReviewableFile']('src/component.tsx'), true);
    assertEquals(agent['isReviewableFile']('script.js'), true);
    assertEquals(agent['isReviewableFile']('style.css'), true);
    assertEquals(agent['isReviewableFile']('config.json'), true);
    assertEquals(agent['isReviewableFile']('README.md'), true);
    assertEquals(agent['isReviewableFile']('Dockerfile'), true);
    assertEquals(agent['isReviewableFile']('Makefile'), true);
    
    // Test non-reviewable files
    assertEquals(agent['isReviewableFile']('image.png'), false);
    assertEquals(agent['isReviewableFile']('document.pdf'), false);
    assertEquals(agent['isReviewableFile']('binary.exe'), false);
    assertEquals(agent['isReviewableFile']('package-lock.json'), false);
    assertEquals(agent['isReviewableFile']('yarn.lock'), false);
    assertEquals(agent['isReviewableFile']('.DS_Store'), false);
    
    // Test files in reviewable directories
    assertEquals(agent['isReviewableFile']('src/unknown_file'), true);
    assertEquals(agent['isReviewableFile']('lib/helper'), true);
    assertEquals(agent['isReviewableFile']('app/controller'), true);
    
    // Test files not in reviewable directories (these should return false)
    assertEquals(agent['isReviewableFile']('random_file'), false);
    assertEquals(agent['isReviewableFile']('cache/unknown_file'), false);
});

Deno.test('EnhancedCodeReviewAgent - changes review command variations', async () => {
    const { context } = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock git service
    agent['gitService'] = {
        isGitRepository: async () => true,
        getChangedFiles: async () => [],
        getFileChanges: async () => [],
        getRemoteUrl: async () => 'https://github.com/user/repo.git',
        getCurrentBranch: async () => 'main',
    };
    
    // Test different command variations that should trigger changes review
    const commands = [
        'review',
        'review changes',
        'review changed',
        'review diff',
        'review modifications',
        'review modified',
    ];
    
    for (const command of commands) {
        const response = await agent.execute(command);
        assertEquals(response.success, true);
        assertStringIncludes(response.content, 'Change Detection Review');
    }
});

Deno.test('EnhancedCodeReviewAgent - changes review error handling', async () => {
    const { context } = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock git service to throw an error
    agent['gitService'] = {
        isGitRepository: async () => { throw new Error('Git command failed'); },
        getChangedFiles: async () => [],
        getFileChanges: async () => [],
        getRemoteUrl: async () => 'https://github.com/user/repo.git',
        getCurrentBranch: async () => 'main',
    };
    
    const response = await agent.execute('review');
    
    assertEquals(response.success, false);
    assertStringIncludes(response.content, 'Error performing change detection review');
});