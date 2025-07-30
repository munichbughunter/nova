import { Config } from '../config/mod.ts';
import { Logger } from '../utils/logger.ts';
import { GitProviderDetector, type GitProvider } from './git_provider_detector.ts';
import { GitLabService } from './gitlab_service.ts';
import { GitHubService } from './github_service.ts';
import type {
    IGitProviderService,
    UnifiedRepository,
    UnifiedPullRequest,
    UnifiedIssue,
    UnifiedProjectMetrics,
} from '../types/git_provider_types.ts';

// Re-export types for convenience
export type {
    IGitProviderService,
    UnifiedRepository,
    UnifiedPullRequest,
    UnifiedIssue,
    UnifiedProjectMetrics,
} from '../types/git_provider_types.ts';

/**
 * GitLab service adapter
 */
class GitLabServiceAdapter implements IGitProviderService {
    constructor(private gitlabService: GitLabService) {}

    getProviderType(): GitProvider {
        return 'gitlab';
    }

    getProviderHost(): string {
        return this.gitlabService['config'].gitlab?.url || 'https://gitlab.com';
    }

    async getRepositories(forceRefresh?: boolean): Promise<UnifiedRepository[]> {
        const projects = await this.gitlabService.getProjects(forceRefresh);
        return projects.map(project => this.convertProjectToRepository(project));
    }

    async getRepository(owner: string, repo: string): Promise<UnifiedRepository> {
        const projectPath = `${owner}/${repo}`;
        const project = await this.gitlabService.getProjectDetails(projectPath);
        return this.convertProjectToRepository(project);
    }

    async searchRepositories(query: string, limit: number = 20): Promise<UnifiedRepository[]> {
        const projects = await this.gitlabService.searchProjects(query);
        return projects.map(project => this.convertProjectToRepository(project)).slice(0, limit);
    }

    async getRecentRepositories(): Promise<UnifiedRepository[]> {
        const projects = await this.gitlabService.getProjects(true);
        const sortedProjects = projects
            .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
            .slice(0, 10);
        return sortedProjects.map(project => this.convertProjectToRepository(project));
    }

    async getCurrentPullRequest(): Promise<UnifiedPullRequest | null> {
        const mr = await this.gitlabService.getCurrentMergeRequest();
        return mr ? this.convertMergeRequestToPullRequest(mr) : null;
    }

    async getPullRequest(owner: string, repo: string, number: number): Promise<UnifiedPullRequest> {
        const projectPath = `${owner}/${repo}`;
        const mr = await this.gitlabService.getMergeRequest(projectPath, number);
        if (!mr) {
            throw new Error(`Merge request ${number} not found in ${projectPath}`);
        }
        return this.convertMergeRequestToPullRequest(mr);
    }

    async getRepositoryPullRequests(owner: string, repo: string): Promise<UnifiedPullRequest[]> {
        // For now, return empty array as GitLabService doesn't have this method
        return [];
    }

    async searchPullRequests(query: string): Promise<UnifiedPullRequest[]> {
        const mergeRequests = await this.gitlabService.searchMergeRequests(query);
        return mergeRequests.map(mr => this.convertMergeRequestToPullRequest(mr));
    }

    async createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[], assignees?: string[]): Promise<UnifiedIssue> {
        const projectPath = `${owner}/${repo}`;
        const issue = await this.gitlabService.createIssue(projectPath, {
            title,
            description: body || '',
            labels: labels?.join(',')
        });
        // Convert to UnifiedIssue
        return {
            id: issue.iid,
            number: issue.iid,
            title: issue.title,
            body: '',
            state: 'open',
            url: issue.web_url,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            closedAt: null,
            author: {
                username: 'unknown',
                name: 'Unknown'
            },
            labels: labels || [],
            assignees: assignees || [],
            comments: 0
        };
    }

    async getRepositoryIssues(owner: string, repo: string): Promise<UnifiedIssue[]> {
        const projectPath = `${owner}/${repo}`;
        const issues = await this.gitlabService.getProjectIssues(projectPath);
        return issues.map(issue => ({
            id: 0,
            number: 0,
            title: issue.title,
            body: issue.description || '',
            state: issue.state,
            author: {
                username: issue.author.username,
                name: issue.author.name
            },
            createdAt: issue.createdAt,
            updatedAt: issue.createdAt,
            closedAt: null,
            url: `${this.getProviderHost()}/${projectPath}/-/issues`,
            labels: [],
            assignees: [],
            comments: 0
        }));
    }

    async searchIssues(query: string, limit?: number): Promise<UnifiedIssue[]> {
        const issues = await this.gitlabService.searchIssues(query, '');
        const mappedIssues = issues.map(issue => ({
            id: issue.iid || 0,
            number: issue.iid || 0,
            title: issue.title,
            body: issue.description || '',
            state: issue.state,
            author: {
                username: issue.author.username,
                name: issue.author.name
            },
            createdAt: issue.createdAt || new Date().toISOString(),
            updatedAt: issue.updatedAt || issue.createdAt || new Date().toISOString(),
            closedAt: issue.closedAt || null,
            url: issue.webUrl || '',
            labels: [],
            assignees: [],
            comments: 0
        }));
        return limit ? mappedIssues.slice(0, limit) : mappedIssues;
    }

    async createPullRequest(owner: string, repo: string, options: {
        title: string;
        head: string;
        base: string;
        body?: string;
        draft?: boolean;
    }): Promise<UnifiedPullRequest> {
        const projectPath = `${owner}/${repo}`;
        const mr = await this.gitlabService.createMergeRequest(projectPath, {
            sourceBranch: options.head,
            targetBranch: options.base,
            title: options.title,
            description: options.body || '',
            draft: options.draft || false
        });
        return this.convertMergeRequestToPullRequest(mr);
    }

    async createPullRequestComment(owner: string, repo: string, pullRequestNumber: number, body: string): Promise<void> {
        const projectPath = `${owner}/${repo}`;
        await this.gitlabService.createMergeRequestComment(projectPath, pullRequestNumber, body);
    }

    async getProjectMetrics(owner: string, repo: string, timeframe: string = '30 days'): Promise<UnifiedProjectMetrics> {
        const projectPath = `${owner}/${repo}`;
        const timeRange = timeframe as '7d' | '30d' | '90d';
        const metrics = await this.gitlabService.getProjectMetrics(projectPath, timeRange);
        
        return {
            repository: this.convertProjectToRepository(metrics.project as any),
            codeQuality: {
                hasReadme: metrics.codeQuality.hasReadme,
                hasLicense: metrics.codeQuality.hasLicense,
                hasContributing: metrics.codeQuality.hasContributing,
                hasSecurityPolicy: metrics.codeQuality.hasSecurityPolicy,
                hasCodeOwners: metrics.codeQuality.hasCodeOwners,
                hasCopilotInstructions: metrics.codeQuality.hasCopilotInstructions,
                hasTests: metrics.codeQuality.hasTests,
                hasWorkflows: true, // GitLab uses pipelines
                grade: metrics.codeQuality.grade,
                score: 85 // Default score as GitLab doesn't provide this
            },
            workflowMetrics: metrics.pipelineMetrics ? {
                totalWorkflows: metrics.pipelineMetrics.running + metrics.pipelineMetrics.succeeded + metrics.pipelineMetrics.failed,
                activeWorkflows: metrics.pipelineMetrics.running,
                successRate: metrics.pipelineMetrics.successRate,
                averageDuration: metrics.pipelineMetrics.averageDuration,
                timeframe: timeframe
            } : undefined,
            teamMetrics: {
                totalCommits: metrics.teamMetrics.totalCommits,
                activeContributors: metrics.teamMetrics.activeContributors,
                contributors: metrics.teamMetrics.topContributors,
                averageTimeToMerge: metrics.teamMetrics.averageTimeToMerge,
                reviewParticipation: metrics.teamMetrics.reviewParticipation,
                timeframe: timeframe
            },
            issues: {
                totalIssues: 0,
                openIssues: 0,
                closedIssues: 0,
                averageCloseTime: 0
            }
        };
    }

    formatProjectMetrics(metrics: UnifiedProjectMetrics): string {
        return this.gitlabService.formatProjectMetrics(metrics as any);
    }

    async clearCache(pattern?: string): Promise<void> {
        await this.gitlabService.clearCache(pattern);
    }

    // Helper methods for conversion
    private convertProjectToRepository(project: any): UnifiedRepository {
        return {
            id: project.id,
            name: project.name,
            fullName: project.path_with_namespace,
            description: project.description,
            url: project.web_url,
            private: project.visibility === 'private',
            archived: project.archived || false,
            defaultBranch: project.default_branch,
            createdAt: project.created_at,
            updatedAt: project.last_activity_at,
            language: project.primary_language,
            starsCount: project.star_count || 0,
            forksCount: project.forks_count || 0,
            openIssuesCount: project.open_issues_count || 0,
            topics: project.topics || [],
            visibility: project.visibility
        };
    }

    private convertMergeRequestToPullRequest(mr: any): UnifiedPullRequest {
        return {
            id: mr.iid,
            number: mr.iid,
            title: mr.title,
            state: mr.state === 'merged' ? 'merged' : mr.state,
            url: mr.web_url,
            createdAt: mr.created_at,
            updatedAt: mr.updated_at,
            closedAt: mr.closed_at,
            mergedAt: mr.merged_at,
            author: {
                username: mr.author.username,
                name: mr.author.name || mr.author.username
            },
            sourceBranch: mr.source_branch,
            targetBranch: mr.target_branch,
            body: mr.description || null,
            draft: mr.draft || false,
            merged: mr.state === 'merged',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            comments: 0
        };
    }
}

/**
 * GitHub service adapter
 */
class GitHubServiceAdapter implements IGitProviderService {
    constructor(private githubService: GitHubService) {}

    getProviderType(): GitProvider {
        return 'github';
    }

    getProviderHost(): string {
        return this.githubService['config'].github?.baseUrl || 'https://github.com';
    }

    async getRepositories(forceRefresh?: boolean): Promise<UnifiedRepository[]> {
        const repos = await this.githubService.getRepositories();
        return repos.map(repo => this.convertGitHubRepository(repo));
    }

    async getRepository(owner: string, repo: string): Promise<UnifiedRepository> {
        const repository = await this.githubService.getRepository(owner, repo);
        return this.convertGitHubRepository(repository);
    }

    async searchRepositories(query: string, limit: number = 20): Promise<UnifiedRepository[]> {
        const repos = await this.githubService.searchRepositories(query);
        return repos.map(repo => this.convertGitHubRepository(repo)).slice(0, limit);
    }

    async getRecentRepositories(): Promise<UnifiedRepository[]> {
        const repos = await this.githubService.getRepositories();
        return repos
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            .slice(0, 10)
            .map(repo => this.convertGitHubRepository(repo));
    }

    async getCurrentPullRequest(): Promise<UnifiedPullRequest | null> {
        const pr = await this.githubService.getCurrentPullRequest();
        return pr ? this.convertGitHubPullRequest(pr) : null;
    }

    async getPullRequest(owner: string, repo: string, number: number): Promise<UnifiedPullRequest> {
        const pr = await this.githubService.getPullRequest(owner, repo, number);
        if (!pr) {
            throw new Error(`Pull request ${number} not found in ${owner}/${repo}`);
        }
        return this.convertGitHubPullRequest(pr);
    }

    async getRepositoryPullRequests(owner: string, repo: string): Promise<UnifiedPullRequest[]> {
        const pullRequests = await this.githubService.getRepositoryPullRequests(owner, repo);
        return pullRequests.map(pr => this.convertGitHubPullRequest(pr));
    }

    async searchPullRequests(query: string): Promise<UnifiedPullRequest[]> {
        // For now, return empty array as this might not be implemented in GitHub service
        return [];
    }

    async createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[], assignees?: string[]): Promise<UnifiedIssue> {
        const issue = await this.githubService.createIssue(owner, repo, title, body, labels, assignees);
        return this.convertGitHubIssue(issue);
    }

    async getRepositoryIssues(owner: string, repo: string): Promise<UnifiedIssue[]> {
        // For now, return empty array as this might not be implemented in GitHub service
        return [];
    }

    async searchIssues(query: string, limit?: number): Promise<UnifiedIssue[]> {
        // For now, return empty array as this might not be implemented in GitHub service
        return [];
    }

    async createPullRequest(owner: string, repo: string, options: {
        title: string;
        head: string;
        base: string;
        body?: string;
        draft?: boolean;
    }): Promise<UnifiedPullRequest> {
        const pr = await this.githubService.createPullRequest(owner, repo, options);
        return this.convertGitHubPullRequest(pr);
    }

    async createPullRequestComment(owner: string, repo: string, pullRequestNumber: number, body: string): Promise<void> {
        await this.githubService.createPullRequestComment(owner, repo, pullRequestNumber, body);
    }

    async getProjectMetrics(owner: string, repo: string, timeframe: string = '30 days'): Promise<UnifiedProjectMetrics> {
        const metrics = await this.githubService.getProjectMetrics(owner, repo, timeframe);
        
        return {
            repository: this.convertGitHubRepository(metrics.repository),
            codeQuality: metrics.codeQuality ? {
                hasReadme: metrics.codeQuality.hasReadme,
                hasLicense: metrics.codeQuality.hasLicense,
                hasContributing: metrics.codeQuality.hasContributing,
                hasSecurityPolicy: metrics.codeQuality.hasSecurityPolicy,
                hasCodeOwners: metrics.codeQuality.hasCodeOwners,
                hasCopilotInstructions: metrics.codeQuality.hasCopilotInstructions,
                hasTests: metrics.codeQuality.hasTests,
                hasWorkflows: metrics.codeQuality.hasWorkflows,
                grade: metrics.codeQuality.grade,
                score: metrics.codeQuality.score
            } : undefined,
            workflowMetrics: metrics.workflowMetrics,
            teamMetrics: metrics.teamMetrics,
            issues: metrics.issues
        };
    }

    formatProjectMetrics(metrics: UnifiedProjectMetrics): string {
        return this.githubService.formatProjectMetrics(metrics as any);
    }

    async clearCache(pattern?: string): Promise<void> {
        await this.githubService.clearCache(pattern);
    }

    // Helper methods for conversion
    private convertGitHubRepository(repo: any): UnifiedRepository {
        return {
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description,
            url: repo.html_url,
            private: repo.private,
            archived: repo.archived,
            defaultBranch: repo.default_branch,
            createdAt: repo.created_at,
            updatedAt: repo.updated_at,
            language: repo.language,
            starsCount: repo.stargazers_count,
            forksCount: repo.forks_count,
            openIssuesCount: repo.open_issues_count,
            topics: repo.topics || [],
            visibility: repo.private ? 'private' : 'public'
        };
    }

    private convertGitHubPullRequest(pr: any): UnifiedPullRequest {
        return {
            id: pr.number,
            number: pr.number,
            title: pr.title,
            state: pr.state,
            url: pr.html_url,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            closedAt: pr.closed_at,
            mergedAt: pr.merged_at,
            author: {
                username: pr.user.login,
                name: pr.user.name || pr.user.login
            },
            sourceBranch: pr.head?.ref || '',
            targetBranch: pr.base?.ref || '',
            body: pr.body || null,
            draft: pr.draft || false,
            merged: pr.merged || false,
            additions: pr.additions || 0,
            deletions: pr.deletions || 0,
            changedFiles: pr.changed_files || 0,
            comments: pr.comments || 0
        };
    }

    private convertGitHubIssue(issue: any): UnifiedIssue {
        return {
            id: issue.number,
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            state: issue.state,
            author: {
                username: issue.user.login,
                name: issue.user.name || issue.user.login
            },
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            closedAt: issue.closed_at,
            url: issue.html_url,
            labels: issue.labels?.map((label: any) => label.name) || [],
            assignees: issue.assignees?.map((assignee: any) => assignee.login) || [],
            comments: issue.comments || 0
        };
    }
}

/**
 * Factory for creating unified Git provider services
 */
export class GitProviderFactory {
    private static logger = new Logger('GitProviderFactory');

    /**
     * Create a provider service based on the configuration
     */
    static async createFromConfig(config: Config): Promise<IGitProviderService> {
        // Check if user has explicitly set a provider preference
        if (config.gitProvider) {
            this.logger.info(`Using configured provider: ${config.gitProvider}`);
            return this.createProvider(config.gitProvider, config);
        }

        // Auto-detect provider from current directory
        try {
            const detector = new GitProviderDetector();
            const providerInfo = await detector.detectProvider();
            
            if (providerInfo) {
                this.logger.info(`Auto-detected provider: ${providerInfo.provider} (${providerInfo.host})`);
                return this.createProvider(providerInfo.provider, config);
            }
        } catch (error) {
            this.logger.warn(`Failed to auto-detect provider: ${error.message}`);
        }

        // Fallback to GitLab if configured, otherwise GitHub
        if (config.gitlab?.token) {
            this.logger.info('Falling back to GitLab (token configured)');
            return this.createProvider('gitlab', config);
        }
        
        if (config.github?.token) {
            this.logger.info('Falling back to GitHub (token configured)');
            return this.createProvider('github', config);
        }

        throw new Error('No Git provider configured. Please run "nova setup" to configure GitLab or GitHub.');
    }

    /**
     * Create a specific provider service
     */
    static createProvider(provider: GitProvider, config: Config): IGitProviderService {
        switch (provider) {
            case 'gitlab':
                if (!config.gitlab?.token) {
                    throw new Error('GitLab token not configured. Please run "nova setup" to configure GitLab.');
                }
                const gitlabService = new GitLabService(config);
                return new GitLabServiceAdapter(gitlabService);

            case 'github':
                if (!config.github?.token) {
                    throw new Error('GitHub token not configured. Please run "nova setup" to configure GitHub.');
                }
                const githubService = new GitHubService(config);
                return new GitHubServiceAdapter(githubService);

            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    /**
     * Get available providers based on configuration
     */
    static getAvailableProviders(config: Config): GitProvider[] {
        const providers: GitProvider[] = [];
        
        if (config.gitlab?.token) {
            providers.push('gitlab');
        }
        
        if (config.github?.token) {
            providers.push('github');
        }
        
        return providers;
    }

    /**
     * Check if a specific provider is configured
     */
    static isProviderConfigured(provider: GitProvider, config: Config): boolean {
        switch (provider) {
            case 'gitlab':
                return !!(config.gitlab?.token);
            case 'github':
                return !!(config.github?.token);
            default:
                return false;
        }
    }
}
