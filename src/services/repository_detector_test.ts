import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { RepositoryDetector } from './repository_detector.ts';
import type { GitService } from '../agents/types.ts';
import { Logger } from '../utils/logger.ts';

// Mock GitService implementation for testing
class MockGitService implements GitService {
    private mockRemoteUrl: string;
    private shouldThrow: boolean;

    constructor(remoteUrl: string = '', shouldThrow: boolean = false) {
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

Deno.test('RepositoryDetector - detectRepositoryType - GitLab URLs', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('https://gitlab.com/user/repo.git');
    const detector = new RepositoryDetector(logger, mockGitService);
    
    const result = await detector.detectRepositoryType();
    assertEquals(result, 'gitlab');
});

Deno.test('RepositoryDetector - detectRepositoryType - GitHub URLs', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('https://github.com/user/repo.git');
    const detector = new RepositoryDetector(logger, mockGitService);
    
    const result = await detector.detectRepositoryType();
    assertEquals(result, 'github');
});

Deno.test('RepositoryDetector - detectRepositoryType - unknown URLs', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('https://bitbucket.org/user/repo.git');
    const detector = new RepositoryDetector(logger, mockGitService);
    
    const result = await detector.detectRepositoryType();
    assertEquals(result, 'unknown');
});

Deno.test('RepositoryDetector - detectRepositoryType - Git command fails', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('', true);
    const detector = new RepositoryDetector(logger, mockGitService);
    
    const result = await detector.detectRepositoryType();
    assertEquals(result, 'unknown');
});

Deno.test('RepositoryDetector - getRepositoryInfo - GitHub HTTPS', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('https://github.com/owner/repo.git');
    const detector = new RepositoryDetector(logger, mockGitService);
    
    const info = await detector.getRepositoryInfo();
    
    assertEquals(info.type, 'github');
    assertEquals(info.owner, 'owner');
    assertEquals(info.repo, 'repo');
    assertEquals(info.url, 'https://github.com/owner/repo.git');
});

Deno.test('RepositoryDetector - getRepositoryInfo - GitHub SSH', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('git@github.com:owner/repo.git');
    const detector = new RepositoryDetector(logger, mockGitService);
    
    const info = await detector.getRepositoryInfo();
    
    assertEquals(info.type, 'github');
    assertEquals(info.owner, 'owner');
    assertEquals(info.repo, 'repo');
    assertEquals(info.url, 'git@github.com:owner/repo.git');
});

Deno.test('RepositoryDetector - getRepositoryInfo - GitLab', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('https://gitlab.com/owner/repo');
    const detector = new RepositoryDetector(logger, mockGitService);
    
    const info = await detector.getRepositoryInfo();
    
    assertEquals(info.type, 'gitlab');
    assertEquals(info.owner, 'owner');
    assertEquals(info.repo, 'repo');
    assertEquals(info.url, 'https://gitlab.com/owner/repo');
});

Deno.test('RepositoryDetector - getRepositoryInfo - Git service fails', async () => {
    const logger = new Logger('test', false);
    const mockGitService = new MockGitService('', true);
    const detector = new RepositoryDetector(logger, mockGitService);
    
    await assertRejects(
        () => detector.getRepositoryInfo(),
        Error,
        'Failed to get repository info'
    );
});