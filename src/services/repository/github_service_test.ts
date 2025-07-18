import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { GitHubServiceImpl } from './github_service.ts';
import type { GitService } from '../agents/types.ts';
import type { Config } from '../config/types.ts';
import { Logger } from '../../utils/logger.ts';

// Mock GitService implementation for testing
class MockGitService implements GitService {
    private mockRemoteUrl: string;
    private shouldThrow: boolean;

    constructor(remoteUrl: string = 'https://github.com/owner/repo.git', shouldThrow: boolean = false) {
        this.mockRemoteUrl = remoteUrl;
        this.shouldThrow = shouldThrow;
    }

    async getChangedFiles(): Promise<string[]> {
        return [];
    }

    async getFileChanges(): Promise<any[]> {
        return [];
    }

    async getRemoteUrl(): Promise<string> {
        if (this.shouldThrow) {
            throw new Error('Git command failed');
        }
        return this.mockRemoteUrl;
    }

    async getCurrentBranch(): Promise<string> {
        return 'main';
    }

    setRemoteUrl(url: string) {
        this.mockRemoteUrl = url;
    }

    setShouldThrow(shouldThrow: boolean) {
        this.shouldThrow = shouldThrow;
    }
}

// Mock fetch function for testing
let mockFetchResponses: Array<{ url: string; responseFactory: () => Response }> = [];
let originalFetch: typeof globalThis.fetch;

function setupMockFetch() {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString();
        
        const mockResponse = mockFetchResponses.find(mock => url.includes(mock.url));
        if (mockResponse) {
            return mockResponse.responseFactory();
        }
        
        // Default response for unmatched URLs
        return new Response(JSON.stringify({ error: 'Not mocked' }), { 
            status: 404, 
            statusText: 'Not Found' 
        });
    };
}

function teardownMockFetch() {
    globalThis.fetch = originalFetch;
    mockFetchResponses = [];
}

function createMockResponse(data: any, status: number = 200, statusText: string = 'OK'): Response {
    return new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'Content-Type': 'application/json' }
    });
}

function createMockResponseFactory(data: any, status: number = 200, statusText: string = 'OK') {
    return () => new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'Content-Type': 'application/json' }
    });
}

// Test configuration
const mockConfig: Config = {
    gitlab: {
        url: 'https://gitlab.com',
        token: 'test-token',
    },
    github: {
        token: 'github-test-token',
        apiUrl: 'https://api.github.com',
    },
};

const mockLogger = new Logger('test', false);

Deno.test('GitHubService - authenticate - success', async () => {
    setupMockFetch();
    
    try {
        mockFetchResponses = [
            {
                url: '/user',
                responseFactory: createMockResponseFactory({ login: 'testuser', id: 12345 })
            }
        ];

        const mockGitService = new MockGitService();
        const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
        
        await githubService.authenticate();
        // If no error is thrown, authentication succeeded
    } finally {
        teardownMockFetch();
    }
});

Deno.test('GitHubService - authenticate - missing token', async () => {
    const configWithoutToken: Config = {
        gitlab: {
            url: 'https://gitlab.com',
            token: 'test-token',
        },
        // No github config
    };

    const mockGitService = new MockGitService();
    const githubService = new GitHubServiceImpl(mockLogger, mockGitService, configWithoutToken);
    
    await assertRejects(
        () => githubService.authenticate(),
        Error,
        'GitHub token not found'
    );
});

Deno.test('GitHubService - authenticate - API failure', async () => {
    setupMockFetch();
    
    try {
        mockFetchResponses = [
            {
                url: '/user',
                responseFactory: createMockResponseFactory({ message: 'Bad credentials' }, 401, 'Unauthorized')
            }
        ];

        const mockGitService = new MockGitService();
        const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
        
        await assertRejects(
            () => githubService.authenticate(),
            Error,
            'GitHub authentication failed'
        );
    } finally {
        teardownMockFetch();
    }
});

Deno.test('GitHubService - getPullRequests - success', async () => {
    setupMockFetch();
    
    try {
        const mockPRs = [
            {
                number: 1,
                title: 'Test PR 1',
                user: { login: 'testuser' },
                state: 'open',
                html_url: 'https://github.com/owner/repo/pull/1',
                created_at: '2023-01-01T00:00:00Z'
            },
            {
                number: 2,
                title: 'Test PR 2',
                user: { login: 'testuser2' },
                state: 'open',
                html_url: 'https://github.com/owner/repo/pull/2',
                created_at: '2023-01-02T00:00:00Z'
            }
        ];

        mockFetchResponses = [
            {
                url: '/user',
                responseFactory: createMockResponseFactory({ login: 'testuser', id: 12345 })
            },
            {
                url: '/repos/owner/repo/pulls',
                responseFactory: createMockResponseFactory(mockPRs)
            }
        ];

        const mockGitService = new MockGitService();
        const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
        
        const pullRequests = await githubService.getPullRequests();
        
        assertEquals(pullRequests.length, 2);
        assertEquals(pullRequests[0].id, '1');
        assertEquals(pullRequests[0].title, 'Test PR 1');
        assertEquals(pullRequests[0].author, 'testuser');
        assertEquals(pullRequests[0].status, 'open');
    } finally {
        teardownMockFetch();
    }
});

Deno.test('GitHubService - getPullRequestDiff - success', async () => {
    setupMockFetch();
    
    try {
        const mockPRDetails = {
            base: { sha: 'base-sha-123' },
            head: { sha: 'head-sha-456' }
        };

        const mockFiles = [
            {
                filename: 'src/test.ts',
                status: 'modified',
                patch: '@@ -1,3 +1,4 @@\n line1\n-line2\n+line2 modified\n+new line\n line3',
                sha: 'file-sha-789'
            }
        ];

        mockFetchResponses = [
            {
                url: '/user',
                responseFactory: createMockResponseFactory({ login: 'testuser', id: 12345 })
            },
            {
                url: '/repos/owner/repo/pulls/1/files',
                responseFactory: createMockResponseFactory(mockFiles)
            },
            {
                url: '/repos/owner/repo/pulls/1',
                responseFactory: createMockResponseFactory(mockPRDetails)
            }
        ];

        const mockGitService = new MockGitService();
        const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
        
        const diffData = await githubService.getPullRequestDiff('1');
        
        assertEquals(diffData.baseSha, 'base-sha-123');
        assertEquals(diffData.headSha, 'head-sha-456');
        assertEquals(diffData.files.length, 1);
        assertEquals(diffData.files[0].filePath, 'src/test.ts');
        assertEquals(diffData.files[0].changeType, 'modified');
    } finally {
        teardownMockFetch();
    }
});

Deno.test('GitHubService - postDiffComment - success', async () => {
    setupMockFetch();
    
    try {
        mockFetchResponses = [
            {
                url: '/user',
                responseFactory: createMockResponseFactory({ login: 'testuser', id: 12345 })
            },
            {
                url: '/repos/owner/repo/pulls/1/comments',
                responseFactory: createMockResponseFactory({ id: 123, body: 'Test comment' })
            }
        ];

        const mockGitService = new MockGitService();
        const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
        
        const comment = {
            filePath: 'src/test.ts',
            line: 10,
            message: 'This needs improvement',
            severity: 'warning' as const
        };

        await githubService.postDiffComment('1', comment);
        // If no error is thrown, comment posting succeeded
    } finally {
        teardownMockFetch();
    }
});

Deno.test('GitHubService - wrong repository type', async () => {
    const mockGitService = new MockGitService('https://gitlab.com/owner/repo.git');
    const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
    
    await assertRejects(
        () => githubService.getPullRequests(),
        Error,
        'Repository type mismatch'
    );
});

Deno.test('GitHubService - parseDiffHunks', async () => {
    const mockGitService = new MockGitService();
    const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
    
    // Access private method for testing
    const parseDiffHunks = (githubService as any).parseDiffHunks.bind(githubService);
    
    const diffString = '@@ -1,3 +1,4 @@\n line1\n-line2\n+line2 modified\n+new line\n line3';
    const hunks = parseDiffHunks(diffString);
    
    assertEquals(hunks.length, 1);
    assertEquals(hunks[0].oldStart, 1);
    assertEquals(hunks[0].oldLines, 3);
    assertEquals(hunks[0].newStart, 1);
    assertEquals(hunks[0].newLines, 4);
    assertEquals(hunks[0].lines.length, 5);
    
    // Check line types
    assertEquals(hunks[0].lines[0].type, 'context');
    assertEquals(hunks[0].lines[1].type, 'deletion');
    assertEquals(hunks[0].lines[2].type, 'addition');
    assertEquals(hunks[0].lines[3].type, 'addition');
    assertEquals(hunks[0].lines[4].type, 'context');
});

Deno.test('GitHubService - formatCommentMessage', async () => {
    const mockGitService = new MockGitService();
    const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
    
    // Access private method for testing
    const formatCommentMessage = (githubService as any).formatCommentMessage.bind(githubService);
    
    const comment = {
        filePath: 'src/test.ts',
        line: 10,
        message: 'This needs improvement',
        severity: 'warning' as const
    };
    
    const formatted = formatCommentMessage(comment);
    
    assertEquals(formatted.includes('⚠️'), true);
    assertEquals(formatted.includes('Code Review Comment'), true);
    assertEquals(formatted.includes('This needs improvement'), true);
});

Deno.test('GitHubService - API error handling', async () => {
    setupMockFetch();
    
    try {
        mockFetchResponses = [
            {
                url: '/user',
                responseFactory: createMockResponseFactory({ login: 'testuser', id: 12345 })
            },
            {
                url: '/repos/owner/repo/pulls',
                responseFactory: createMockResponseFactory({ message: 'Not Found' }, 404, 'Not Found')
            }
        ];

        const mockGitService = new MockGitService();
        const githubService = new GitHubServiceImpl(mockLogger, mockGitService, mockConfig);
        
        await assertRejects(
            () => githubService.getPullRequests(),
            Error,
            'GitHub API error: 404'
        );
    } finally {
        teardownMockFetch();
    }
});