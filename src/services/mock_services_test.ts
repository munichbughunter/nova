/**
 * Mock Services for Testing GitLab and GitHub Integrations
 * 
 * This file provides mock implementations of GitLab and GitHub services
 * for comprehensive testing of the enhanced code review agent.
 */

import type { 
    PullRequest, 
    DiffData, 
    DiffComment,
    GitService
} from '../agents/types.ts';
import type { Logger } from '../../utils/logger.ts';

/**
 * Mock GitLab Repository Service for testing
 */
export class MockGitLabRepositoryService {
    private mockPullRequests: PullRequest[] = [];
    private mockDiffData: Record<string, DiffData> = {};
    private mockCommentPostingEnabled: boolean = true;
    private mockApiErrors: Record<string, Error> = {};

    constructor(
        private logger: Logger,
        private gitService: GitService,
        private config: any
    ) {}

    /**
     * Set mock pull requests for testing
     */
    setMockPullRequests(prs: PullRequest[]): void {
        this.mockPullRequests = prs;
    }

    /**
     * Set mock diff data for specific PR IDs
     */
    setMockDiffData(prId: string, diffData: DiffData): void {
        this.mockDiffData[prId] = diffData;
    }

    /**
     * Enable/disable mock comment posting
     */
    setMockCommentPostingEnabled(enabled: boolean): void {
        this.mockCommentPostingEnabled = enabled;
    }

    /**
     * Set mock API errors for specific operations
     */
    setMockApiError(operation: string, error: Error): void {
        this.mockApiErrors[operation] = error;
    }

    /**
     * Get mock pull requests
     */
    async getPullRequests(): Promise<PullRequest[]> {
        if (this.mockApiErrors['getPullRequests']) {
            throw this.mockApiErrors['getPullRequests'];
        }
        
        this.logger.debug(`Mock GitLab: Returning ${this.mockPullRequests.length} pull requests`);
        return [...this.mockPullRequests];
    }

    /**
     * Get mock diff data for a pull request
     */
    async getPullRequestDiff(prId: string): Promise<DiffData> {
        if (this.mockApiErrors['getPullRequestDiff']) {
            throw this.mockApiErrors['getPullRequestDiff'];
        }

        const diffData = this.mockDiffData[prId];
        if (!diffData) {
            throw new Error(`No mock diff data found for PR ${prId}`);
        }

        this.logger.debug(`Mock GitLab: Returning diff data for PR ${prId}`);
        return diffData;
    }

    /**
     * Mock posting diff comment
     */
    async postDiffComment(prId: string, comment: DiffComment): Promise<void> {
        if (this.mockApiErrors['postDiffComment']) {
            throw this.mockApiErrors['postDiffComment'];
        }

        if (!this.mockCommentPostingEnabled) {
            throw new Error('Comment posting is disabled in mock');
        }

        this.logger.debug(`Mock GitLab: Posted comment on PR ${prId}`, { comment });
    }

    /**
     * Reset all mock data
     */
    reset(): void {
        this.mockPullRequests = [];
        this.mockDiffData = {};
        this.mockCommentPostingEnabled = true;
        this.mockApiErrors = {};
    }
}

/**
 * Mock GitHub Service for testing
 */
export class MockGitHubService {
    private mockPullRequests: PullRequest[] = [];
    private mockDiffData: Record<string, DiffData> = {};
    private mockCommentPostingEnabled: boolean = true;
    private mockApiErrors: Record<string, Error> = {};
    private mockAuthenticationEnabled: boolean = true;

    constructor(
        private logger: Logger,
        private gitService: GitService,
        private config: any
    ) {}

    /**
     * Set mock pull requests for testing
     */
    setMockPullRequests(prs: PullRequest[]): void {
        this.mockPullRequests = prs;
    }

    /**
     * Set mock diff data for specific PR IDs
     */
    setMockDiffData(prId: string, diffData: DiffData): void {
        this.mockDiffData[prId] = diffData;
    }

    /**
     * Enable/disable mock comment posting
     */
    setMockCommentPostingEnabled(enabled: boolean): void {
        this.mockCommentPostingEnabled = enabled;
    }

    /**
     * Enable/disable mock authentication
     */
    setMockAuthenticationEnabled(enabled: boolean): void {
        this.mockAuthenticationEnabled = enabled;
    }

    /**
     * Set mock API errors for specific operations
     */
    setMockApiError(operation: string, error: Error): void {
        this.mockApiErrors[operation] = error;
    }

    /**
     * Mock GitHub authentication
     */
    async authenticate(): Promise<void> {
        if (this.mockApiErrors['authenticate']) {
            throw this.mockApiErrors['authenticate'];
        }

        if (!this.mockAuthenticationEnabled) {
            throw new Error('GitHub authentication failed in mock');
        }

        this.logger.debug('Mock GitHub: Authentication successful');
    }

    /**
     * Get mock pull requests
     */
    async getPullRequests(): Promise<PullRequest[]> {
        if (this.mockApiErrors['getPullRequests']) {
            throw this.mockApiErrors['getPullRequests'];
        }
        
        this.logger.debug(`Mock GitHub: Returning ${this.mockPullRequests.length} pull requests`);
        return [...this.mockPullRequests];
    }

    /**
     * Get mock diff data for a pull request
     */
    async getPullRequestDiff(prId: string): Promise<DiffData> {
        if (this.mockApiErrors['getPullRequestDiff']) {
            throw this.mockApiErrors['getPullRequestDiff'];
        }

        const diffData = this.mockDiffData[prId];
        if (!diffData) {
            throw new Error(`No mock diff data found for PR ${prId}`);
        }

        this.logger.debug(`Mock GitHub: Returning diff data for PR ${prId}`);
        return diffData;
    }

    /**
     * Mock posting diff comment
     */
    async postDiffComment(prId: string, comment: DiffComment): Promise<void> {
        if (this.mockApiErrors['postDiffComment']) {
            throw this.mockApiErrors['postDiffComment'];
        }

        if (!this.mockCommentPostingEnabled) {
            throw new Error('Comment posting is disabled in mock');
        }

        this.logger.debug(`Mock GitHub: Posted comment on PR ${prId}`, { comment });
    }

    /**
     * Reset all mock data
     */
    reset(): void {
        this.mockPullRequests = [];
        this.mockDiffData = {};
        this.mockCommentPostingEnabled = true;
        this.mockAuthenticationEnabled = true;
        this.mockApiErrors = {};
    }
}

/**
 * Mock Repository Detector for testing
 */
export class MockRepositoryDetector {
    private mockRepositoryType: 'gitlab' | 'github' | 'unknown' = 'github';

    constructor(private logger: Logger, private gitService: GitService) {}

    /**
     * Set the mock repository type
     */
    setMockRepositoryType(type: 'gitlab' | 'github' | 'unknown'): void {
        this.mockRepositoryType = type;
    }

    /**
     * Detect mock repository type
     */
    async detectRepositoryType(): Promise<'gitlab' | 'github' | 'unknown'> {
        this.logger.debug(`Mock Repository Detector: Returning ${this.mockRepositoryType}`);
        return this.mockRepositoryType;
    }
}

/**
 * Create comprehensive test data for different scenarios
 */
export class TestDataFactory {
    /**
     * Create mock pull requests for GitLab
     */
    static createMockGitLabPullRequests(): PullRequest[] {
        return [
            {
                id: '123',
                title: 'Add new feature',
                author: 'developer1',
                status: 'open',
                createdAt: new Date('2024-01-15T10:00:00Z'),
                url: 'https://gitlab.com/test/repo/-/merge_requests/123'
            },
            {
                id: '124',
                title: 'Fix bug in authentication',
                author: 'developer2',
                status: 'open',
                createdAt: new Date('2024-01-16T14:30:00Z'),
                url: 'https://gitlab.com/test/repo/-/merge_requests/124'
            },
            {
                id: '125',
                title: 'Update documentation',
                author: 'developer1',
                status: 'merged',
                createdAt: new Date('2024-01-14T09:15:00Z'),
                url: 'https://gitlab.com/test/repo/-/merge_requests/125'
            }
        ];
    }

    /**
     * Create mock pull requests for GitHub
     */
    static createMockGitHubPullRequests(): PullRequest[] {
        return [
            {
                id: '456',
                title: 'Implement user dashboard',
                author: 'contributor1',
                status: 'open',
                createdAt: new Date('2024-01-17T11:20:00Z'),
                url: 'https://github.com/test/repo/pull/456'
            },
            {
                id: '457',
                title: 'Refactor API endpoints',
                author: 'contributor2',
                status: 'open',
                createdAt: new Date('2024-01-18T16:45:00Z'),
                url: 'https://github.com/test/repo/pull/457'
            }
        ];
    }

    /**
     * Create mock diff data with various change types
     */
    static createMockDiffData(prId: string): DiffData {
        return {
            files: [
                {
                    filePath: 'src/components/UserDashboard.tsx',
                    oldPath: 'src/components/UserDashboard.tsx',
                    newPath: 'src/components/UserDashboard.tsx',
                    changeType: 'added',
                    hunks: [
                        {
                            oldStart: 0,
                            oldLines: 0,
                            newStart: 1,
                            newLines: 25,
                            lines: [
                                {
                                    type: 'addition',
                                    content: 'import React from "react";',
                                    newLineNumber: 1
                                },
                                {
                                    type: 'addition',
                                    content: '',
                                    newLineNumber: 2
                                },
                                {
                                    type: 'addition',
                                    content: 'interface UserDashboardProps {',
                                    newLineNumber: 3
                                },
                                {
                                    type: 'addition',
                                    content: '  userId: string;',
                                    newLineNumber: 4
                                },
                                {
                                    type: 'addition',
                                    content: '}',
                                    newLineNumber: 5
                                }
                            ]
                        }
                    ]
                },
                {
                    filePath: 'src/api/auth.ts',
                    oldPath: 'src/api/auth.ts',
                    newPath: 'src/api/auth.ts',
                    changeType: 'modified',
                    hunks: [
                        {
                            oldStart: 10,
                            oldLines: 5,
                            newStart: 10,
                            newLines: 7,
                            lines: [
                                {
                                    type: 'context',
                                    content: 'export async function authenticate(token: string) {',
                                    oldLineNumber: 10,
                                    newLineNumber: 10
                                },
                                {
                                    type: 'deletion',
                                    content: '  // TODO: Implement proper validation',
                                    oldLineNumber: 11
                                },
                                {
                                    type: 'addition',
                                    content: '  if (!token) {',
                                    newLineNumber: 11
                                },
                                {
                                    type: 'addition',
                                    content: '    throw new Error("Token is required");',
                                    newLineNumber: 12
                                },
                                {
                                    type: 'addition',
                                    content: '  }',
                                    newLineNumber: 13
                                },
                                {
                                    type: 'context',
                                    content: '  return validateToken(token);',
                                    oldLineNumber: 12,
                                    newLineNumber: 14
                                }
                            ]
                        }
                    ]
                },
                {
                    filePath: 'src/utils/deprecated.ts',
                    oldPath: 'src/utils/deprecated.ts',
                    newPath: 'src/utils/deprecated.ts',
                    changeType: 'deleted',
                    hunks: [
                        {
                            oldStart: 1,
                            oldLines: 10,
                            newStart: 0,
                            newLines: 0,
                            lines: [
                                {
                                    type: 'deletion',
                                    content: '// This file is deprecated',
                                    oldLineNumber: 1
                                },
                                {
                                    type: 'deletion',
                                    content: 'export function oldFunction() {',
                                    oldLineNumber: 2
                                },
                                {
                                    type: 'deletion',
                                    content: '  return "deprecated";',
                                    oldLineNumber: 3
                                },
                                {
                                    type: 'deletion',
                                    content: '}',
                                    oldLineNumber: 4
                                }
                            ]
                        }
                    ]
                }
            ],
            baseSha: 'abc123def456',
            headSha: 'def456ghi789'
        };
    }

    /**
     * Create mock API errors for testing error scenarios
     */
    static createMockApiErrors(): Record<string, Error> {
        return {
            'rate_limit': new Error('API rate limit exceeded. Please try again later.'),
            'authentication': new Error('Authentication failed. Please check your token.'),
            'not_found': new Error('Pull request not found.'),
            'permission_denied': new Error('Insufficient permissions to access this resource.'),
            'network_error': new Error('Network error occurred. Please check your connection.'),
            'server_error': new Error('Internal server error. Please try again later.')
        };
    }

    /**
     * Create mock configuration for different scenarios
     */
    static createMockConfigurations() {
        return {
            minimal: {
                gitlab: { url: 'https://gitlab.com', token: 'test-token' }
            },
            complete: {
                gitlab: {
                    url: 'https://gitlab.com',
                    token: 'test-gitlab-token'
                },
                github: {
                    token: 'test-github-token',
                    apiUrl: 'https://api.github.com'
                },
                review: {
                    autoPostComments: true,
                    severityThreshold: 'medium',
                    maxFilesPerReview: 50
                }
            },
            restrictive: {
                gitlab: { url: 'https://gitlab.com', token: 'test-token' },
                review: {
                    autoPostComments: false,
                    severityThreshold: 'high',
                    maxFilesPerReview: 5
                }
            },
            missing_tokens: {
                gitlab: { url: 'https://gitlab.com' },
                github: { apiUrl: 'https://api.github.com' }
            }
        };
    }
}

/**
 * Test scenario builder for complex integration tests
 */
export class TestScenarioBuilder {
    private scenario: {
        repositoryType: 'gitlab' | 'github' | 'unknown';
        pullRequests: PullRequest[];
        diffData: Record<string, DiffData>;
        apiErrors: Record<string, Error>;
        config: any;
        changedFiles: string[];
        isGitRepo: boolean;
    };

    constructor() {
        this.scenario = {
            repositoryType: 'github',
            pullRequests: [],
            diffData: {},
            apiErrors: {},
            config: TestDataFactory.createMockConfigurations().complete,
            changedFiles: [],
            isGitRepo: true
        };
    }

    /**
     * Set repository type for the scenario
     */
    withRepositoryType(type: 'gitlab' | 'github' | 'unknown'): TestScenarioBuilder {
        this.scenario.repositoryType = type;
        return this;
    }

    /**
     * Add pull requests to the scenario
     */
    withPullRequests(prs: PullRequest[]): TestScenarioBuilder {
        this.scenario.pullRequests = prs;
        return this;
    }

    /**
     * Add diff data for specific PRs
     */
    withDiffData(prId: string, diffData: DiffData): TestScenarioBuilder {
        this.scenario.diffData[prId] = diffData;
        return this;
    }

    /**
     * Add API errors for specific operations
     */
    withApiError(operation: string, error: Error): TestScenarioBuilder {
        this.scenario.apiErrors[operation] = error;
        return this;
    }

    /**
     * Set configuration for the scenario
     */
    withConfig(config: any): TestScenarioBuilder {
        this.scenario.config = config;
        return this;
    }

    /**
     * Set changed files for the scenario
     */
    withChangedFiles(files: string[]): TestScenarioBuilder {
        this.scenario.changedFiles = files;
        return this;
    }

    /**
     * Set Git repository status
     */
    withGitRepository(isRepo: boolean): TestScenarioBuilder {
        this.scenario.isGitRepo = isRepo;
        return this;
    }

    /**
     * Build the complete test scenario
     */
    build() {
        return { ...this.scenario };
    }

    /**
     * Create a standard success scenario for GitLab
     */
    static gitLabSuccess(): TestScenarioBuilder {
        return new TestScenarioBuilder()
            .withRepositoryType('gitlab')
            .withPullRequests(TestDataFactory.createMockGitLabPullRequests())
            .withDiffData('123', TestDataFactory.createMockDiffData('123'))
            .withChangedFiles(['src/test.ts', 'src/utils/helper.js']);
    }

    /**
     * Create a standard success scenario for GitHub
     */
    static gitHubSuccess(): TestScenarioBuilder {
        return new TestScenarioBuilder()
            .withRepositoryType('github')
            .withPullRequests(TestDataFactory.createMockGitHubPullRequests())
            .withDiffData('456', TestDataFactory.createMockDiffData('456'))
            .withChangedFiles(['src/components/Dashboard.tsx']);
    }

    /**
     * Create an error scenario with API failures
     */
    static apiErrorScenario(): TestScenarioBuilder {
        return new TestScenarioBuilder()
            .withRepositoryType('github')
            .withApiError('getPullRequests', TestDataFactory.createMockApiErrors().rate_limit);
    }

    /**
     * Create a scenario with no Git repository
     */
    static noGitRepository(): TestScenarioBuilder {
        return new TestScenarioBuilder()
            .withGitRepository(false);
    }
}