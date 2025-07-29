import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { Config } from '../config/mod.ts';
import { DevCache } from '../utils/devcache.ts';
import { Logger } from '../utils/logger.ts';
import { UserCache } from '../utils/usercache.ts';
import { GitProviderDetector } from './git_provider_detector.ts';

// Corrected GitHub API Response Types
interface GitHubRepository {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    private: boolean;
    archived: boolean;
    default_branch: string;
    updated_at: string;
    created_at: string;
    pushed_at: string;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    topics: string[];
    visibility: 'public' | 'private';
    has_issues: boolean;
    has_projects: boolean;
    has_wiki: boolean;
    has_pages: boolean;
    license: {
        key: string;
        name: string;
        spdx_id: string;
    } | null;
    // Additional fields for metrics
    size: number;
    watchers_count: number;
    subscribers_count?: number;
}

interface GitHubPullRequest {
    id: number;
    number: number;
    title: string;
    state: 'open' | 'closed';
    html_url: string;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    merged_at: string | null;
    user: GitHubUser;
    head: {
        ref: string;
        sha: string;
        repo: {
            name: string;
            full_name: string;
        } | null;
    };
    base: {
        ref: string;
        sha: string;
        repo: {
            name: string;
            full_name: string;
        };
    };
    body: string | null;
    draft: boolean;
    merged: boolean;
    mergeable: boolean | null;
    // Correct API fields
    requested_reviewers: GitHubUser[];
    assignees: GitHubUser[];
    labels: GitHubLabel[];
    // These require separate API calls
    additions?: number;
    deletions?: number;
    changed_files?: number;
    comments?: number;
    review_comments?: number;
    commits?: number;
}

interface GitHubUser {
    id: number;
    login: string;
    avatar_url: string;
    html_url: string;
    type: 'User' | 'Bot';
}

interface GitHubLabel {
    id: number;
    name: string;
    color: string;
    description: string | null;
}

interface GitHubWorkflowRun {
    id: number;
    name: string | null;
    status: 'queued' | 'in_progress' | 'completed' | 'waiting';
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
    html_url: string;
    created_at: string;
    updated_at: string;
    run_started_at: string | null;
    head_branch: string;
    head_sha: string;
    event: string;
    run_number: number;
    run_attempt: number;
    workflow_id: number;
    // Calculate duration from timestamps
    duration_ms?: number;
}

interface GitHubWorkflow {
    id: number;
    name: string;
    path: string;
    state: 'active' | 'deleted' | 'disabled_fork' | 'disabled_inactivity' | 'disabled_manually';
    created_at: string;
    updated_at: string;
    url: string;
    html_url: string;
    badge_url: string;
}

interface GitHubCommit {
    sha: string;
    commit: {
        author: {
            name: string;
            email: string;
            date: string;
        };
        committer: {
            name: string;
            email: string;
            date: string;
        };
        message: string;
    };
    author: GitHubUser | null;
    committer: GitHubUser | null;
    html_url: string;
}

interface GitHubIssue {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
    html_url: string;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    user: GitHubUser;
    assignees: GitHubUser[];
    labels: GitHubLabel[];
    comments: number;
    // This field indicates if it's a PR
    pull_request?: {
        url: string;
        html_url: string;
        diff_url: string;
        patch_url: string;
    };
}

// Corrected Content API response - can be array or single object
interface GitHubContent {
    name: string;
    path: string;
    sha: string;
    size: number;
    url: string;
    html_url: string;
    git_url: string;
    download_url: string | null;
    type: 'file' | 'dir' | 'symlink' | 'submodule';
    content?: string;
    encoding?: 'base64';
}

interface GitHubBranch {
    name: string;
    commit: {
        sha: string;
        url: string;
    };
    protected: boolean;
}

interface GitHubRelease {
    id: number;
    tag_name: string;
    target_commitish: string;
    name: string | null;
    body: string | null;
    draft: boolean;
    prerelease: boolean;
    created_at: string;
    published_at: string | null;
    html_url: string;
    assets: Array<{
        id: number;
        name: string;
        size: number;
        download_count: number;
        created_at: string;
        updated_at: string;
        browser_download_url: string;
    }>;
}

// GitHub Metrics Types
interface GitHubProjectMetrics {
    repository: GitHubRepository;
    codeQuality?: GitHubCodeQuality;
    workflowMetrics?: GitHubWorkflowMetrics;
    teamMetrics?: GitHubTeamMetrics;
    activityMetrics?: GitHubActivityMetrics;
}

interface GitHubCodeQuality {
    hasReadme: boolean;
    hasLicense: boolean;
    hasContributing: boolean;
    hasCodeOfConduct: boolean;
    hasSecurityPolicy: boolean;
    hasIssueTemplate: boolean;
    hasPullRequestTemplate: boolean;
    hasWorkflows: boolean;
    hasDependabot: boolean;
    hasCodeOwners: boolean;
    hasCopilotInstructions: boolean;
    hasGitignore: boolean;
    hasPackageJson: boolean;
    hasDockerfile: boolean;
    hasTests: boolean;
    testCoverage?: number;
    grade: string;
    score: number;
}

interface GitHubWorkflowMetrics {
    totalWorkflows: number;
    activeWorkflows: number;
    successRate: number;
    averageDuration: number;
    recentRuns: GitHubWorkflowRun[];
    timeframe: string;
}

interface GitHubTeamMetrics {
    contributors: number;
    activeContributors: number;
    averageTimeToMerge: number;
    averageTimeToFirstReview: number;
    averageCommentsPerPR: number;
    timeframe: string;
}

interface GitHubActivityMetrics {
    totalCommits: number;
    totalPullRequests: number;
    totalIssues: number;
    openPullRequests: number;
    openIssues: number;
    lastCommit?: {
        sha: string;
        date: string;
    };
    timeframe: string;
}

/**
 * GitHubService is a service that provides a client for the GitHub API.
 * It is used to get project metrics, code quality, and other information.
 *
 * @since 0.0.1
 */
export class GitHubService {
    private config: Config;
    private logger: Logger;
    private cache: DevCache;
    private userCache!: UserCache;
    private readonly maxRecentProjects = 5;
    private initialized = false;
    private readonly baseUrl: string;

    constructor(config: Config) {
        this.config = config;
        this.logger = new Logger('GitHub', Deno.env.get('NOVA_DEBUG') === 'true');
        this.baseUrl = this.config.github?.url || 'https://api.github.com';
        
        // Initialize cache
        this.cache = new DevCache({
            basePath: `${Deno.env.get('HOME')}/.nova/cache`,
            serviceName: 'github',
            logger: this.logger,
        });
    }

    private async initialize(): Promise<void> {
        if (!this.initialized) {
            this.userCache = await UserCache.getInstance();
            this.initialized = true;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    private extractQueryType(key: string): string {
        if (key.includes('repos') || key.includes('repositories')) return 'projects';
        if (key.includes('pulls')) return 'pullrequests';
        if (key.includes('issues')) return 'issues';
        if (key.includes('actions') || key.includes('workflows')) return 'workflows';
        if (key.includes('commits')) return 'commits';
        return 'general';
    }

    private async request<T>(
        path: string,
        options: RequestInit & { rawResponse?: boolean } = {},
    ): Promise<T> {
        await this.ensureInitialized();
        try {
            // Skip cache for raw responses
            if (!options.rawResponse) {
                // Try to get from cache first
                const cacheKey = `${path}_${JSON.stringify(options)}`;
                const queryType = this.extractQueryType(path);
                const cached = await this.cache.get<T>(cacheKey, queryType);
                if (cached) {
                    return cached;
                }
            }

            const url = new URL(path, this.baseUrl);
            
            // Correct authentication header for GitHub API v3
            const headers = new Headers({
                'Authorization': `token ${this.config.github!.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Nova-CLI/1.0',
            });

            const response = await fetch(url, {
                ...options,
                headers: {
                    ...Object.fromEntries(headers.entries()),
                    ...options.headers,
                },
            });

            // Return raw response if requested
            if (options.rawResponse) {
                return response as unknown as T;
            }

            if (!response.ok) {
                const errorBody = await response.text().catch(() => 'Unknown error');
                throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const data = await response.json();

            // Cache successful response
            if (!options.rawResponse) {
                const cacheKey = `${path}_${JSON.stringify(options)}`;
                const queryType = this.extractQueryType(path);
                await this.cache.set(cacheKey, data, queryType);
            }

            return data;
        } catch (error) {
            this.logger.error('Error in request:', error);
            throw error;
        }
    }

    public async clearCache(pattern?: string): Promise<void> {
        await this.cache.clear(pattern);
    }

    /**
     * Get all repositories for the authenticated user or organization
     */
    public async getRepositories(forceRefresh = false): Promise<GitHubRepository[]> {
        await this.ensureInitialized();

        if (!forceRefresh) {
            const cached = await this.cache.get<GitHubRepository[]>('repositories', 'projects');
            if (cached) {
                return cached;
            }
        }

        try {
            // Get user repositories with correct parameters
            const userRepos = await this.request<GitHubRepository[]>('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
            
            // Get organization repositories if owner is specified
            let orgRepos: GitHubRepository[] = [];
            if (this.config.github?.owner) {
                try {
                    orgRepos = await this.request<GitHubRepository[]>(`/orgs/${this.config.github.owner}/repos?per_page=100&sort=updated&type=all`);
                } catch (error) {
                    this.logger.debug(`Could not fetch org repos for ${this.config.github.owner}:`, error);
                }
            }

            // Combine and deduplicate repositories
            const allRepos = [...userRepos, ...orgRepos];
            const uniqueRepos = allRepos.filter((repo, index, self) => 
                index === self.findIndex(r => r.id === repo.id)
            );

            await this.cache.set('repositories', uniqueRepos, 'projects');
            return uniqueRepos;
        } catch (error) {
            this.logger.error('Error fetching repositories:', error);
            throw error;
        }
    }

    /**
     * Get detailed information about a specific repository
     */
    public async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
        const path = `/repos/${owner}/${repo}`;
        return await this.request<GitHubRepository>(path);
    }

    /**
     * Get current pull request for the current repository
     */
    public async getCurrentPullRequest(): Promise<GitHubPullRequest | null> {
        try {
            const providerInfo = await GitProviderDetector.getCurrentRepositoryInfo();
            
            if (!providerInfo || providerInfo.provider !== 'github') {
                this.logger.debug('Not in a GitHub repository or could not detect provider');
                return null;
            }

            const { owner, repository } = providerInfo;

            // Get current branch
            const currentBranch = await this.getCurrentBranch();
            if (!currentBranch) {
                this.logger.debug('Could not determine current branch');
                return null;
            }

            // Search for pull requests from current branch
            const pulls = await this.request<GitHubPullRequest[]>(
                `/repos/${owner}/${repository}/pulls?head=${owner}:${currentBranch}&state=open`
            );

            return pulls.length > 0 ? pulls[0] : null;
        } catch (error) {
            this.logger.error('Error getting current pull request:', error);
            return null;
        }
    }

    private async getCurrentBranch(): Promise<string | null> {
        try {
            const command = new Deno.Command('git', {
                args: ['branch', '--show-current'],
            });
            const output = await command.output();
            
            if (output.success) {
                return new TextDecoder().decode(output.stdout).trim();
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Get pull request details with additional statistics
     */
    public async getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest> {
        const path = `/repos/${owner}/${repo}/pulls/${number}`;
        const pr = await this.request<GitHubPullRequest>(path);
        
        // Get additional statistics that require separate API calls
        try {
            const [comments, reviewComments] = await Promise.all([
                this.request<any[]>(`/repos/${owner}/${repo}/issues/${number}/comments`),
                this.request<any[]>(`/repos/${owner}/${repo}/pulls/${number}/comments`),
            ]);
            
            pr.comments = comments.length;
            pr.review_comments = reviewComments.length;
        } catch (error) {
            this.logger.debug('Could not fetch PR statistics:', error);
        }
        
        return pr;
    }

    /**
     * Get pull requests for a repository
     */
    public async getRepositoryPullRequests(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit: number = 100
    ): Promise<GitHubPullRequest[]> {
        const path = `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${Math.min(limit, 100)}&sort=updated&direction=desc`;
        return await this.request<GitHubPullRequest[]>(path);
    }

    /**
     * Create a pull request comment
     */
    public async createPullRequestComment(
        owner: string,
        repo: string,
        pullNumber: number,
        body: string
    ): Promise<void> {
        const path = `/repos/${owner}/${repo}/issues/${pullNumber}/comments`;
        await this.request(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ body }),
        });
    }

    /**
     * Get repository project metrics
     */
    public async getProjectMetrics(
        owner: string,
        repo: string,
        timeframe: string = '30 days'
    ): Promise<GitHubProjectMetrics> {
        const repository = await this.getRepository(owner, repo);
        
        const [codeQuality, workflowMetrics, teamMetrics, activityMetrics] = await Promise.all([
            this.getRepositoryCodeQuality(owner, repo),
            this.getWorkflowMetrics(owner, repo, timeframe),
            this.getTeamMetrics(owner, repo, timeframe),
            this.getActivityMetrics(owner, repo, timeframe),
        ]);

        return {
            repository,
            codeQuality,
            workflowMetrics,
            teamMetrics,
            activityMetrics,
        };
    }

    private async getRepositoryCodeQuality(owner: string, repo: string): Promise<GitHubCodeQuality> {
        try {
            const [rootContents, workflowsResponse] = await Promise.all([
                this.getRepositoryContents(owner, repo, ''),
                this.getWorkflows(owner, repo).catch(() => ({ workflows: [] })),
            ]);

            // Handle both array and single object responses correctly
            const contents = Array.isArray(rootContents) ? rootContents : [rootContents];
            const workflows = Array.isArray(workflowsResponse) ? workflowsResponse : workflowsResponse.workflows || [];

            const fileNames = contents.map(c => c.name.toLowerCase());
            const filePaths = contents.map(c => c.path.toLowerCase());
            
            const hasFile = (fileName: string) => fileNames.includes(fileName.toLowerCase());
            const hasFilePattern = (pattern: RegExp) => fileNames.some(name => pattern.test(name));
            
            // Check for .github directory contents
            let githubContents: GitHubContent[] = [];
            try {
                const githubDir = await this.getRepositoryContents(owner, repo, '.github');
                githubContents = Array.isArray(githubDir) ? githubDir : [githubDir];
            } catch {
                // .github directory doesn't exist
            }

            const hasReadme = hasFilePattern(/^readme\.(md|rst|txt)$/);
            const hasLicense = hasFile('license') || hasFile('license.md') || hasFile('license.txt') || hasFile('licence');
            const hasContributing = hasFile('contributing.md') || hasFile('contributing.rst') || hasFile('.github/contributing.md');
            const hasCodeOfConduct = hasFile('code_of_conduct.md') || hasFile('code-of-conduct.md') || hasFile('.github/code_of_conduct.md');
            const hasSecurityPolicy = hasFile('security.md') || githubContents.some(c => c.path.includes('security.md'));
            const hasIssueTemplate = githubContents.some(c => 
                c.path.includes('issue_template') || c.path.includes('ISSUE_TEMPLATE')
            );
            const hasPullRequestTemplate = githubContents.some(c => 
                c.path.includes('pull_request_template') || c.path.includes('PULL_REQUEST_TEMPLATE')
            );
            const hasWorkflows = workflows.length > 0;
            const hasDependabot = githubContents.some(c => c.name === 'dependabot.yml') || hasFile('.github/dependabot.yml');
            const hasCodeOwners = hasFile('codeowners') || githubContents.some(c => c.name.toLowerCase() === 'codeowners');
            const hasCopilotInstructions = githubContents.some(c => c.name === 'copilot-instructions.md');
            const hasGitignore = hasFile('.gitignore');
            const hasPackageJson = hasFile('package.json');
            const hasDockerfile = hasFile('dockerfile');
            const hasTests = hasFilePattern(/test|spec/) || contents.some(c => 
                c.type === 'dir' && (c.name.includes('test') || c.name.includes('spec'))
            );

            // Calculate score based on best practices
            const checks = [
                hasReadme, hasLicense, hasContributing, hasCodeOfConduct, hasSecurityPolicy,
                hasIssueTemplate, hasPullRequestTemplate, hasWorkflows, hasDependabot,
                hasCodeOwners, hasCopilotInstructions, hasGitignore, hasTests
            ];
            const score = (checks.filter(Boolean).length / checks.length) * 100;
            const grade = this.calculateGrade(score);

            return {
                hasReadme,
                hasLicense,
                hasContributing,
                hasCodeOfConduct,
                hasSecurityPolicy,
                hasIssueTemplate,
                hasPullRequestTemplate,
                hasWorkflows,
                hasDependabot,
                hasCodeOwners,
                hasCopilotInstructions,
                hasGitignore,
                hasPackageJson,
                hasDockerfile,
                hasTests,
                grade,
                score,
            };
        } catch (error) {
            this.logger.error('Error getting code quality:', error);
            throw error;
        }
    }

    private calculateGrade(score: number): string {
        if (score >= 80) return 'A';
        if (score >= 60) return 'B';
        if (score >= 40) return 'C';
        if (score >= 20) return 'D';
        return 'E';
    }

    // Corrected to handle both array and single object responses
    private async getRepositoryContents(owner: string, repo: string, path: string = ''): Promise<GitHubContent[]> {
        const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
        const response = await this.request<GitHubContent | GitHubContent[]>(apiPath);
        return Array.isArray(response) ? response : [response];
    }

    private async getWorkflows(owner: string, repo: string): Promise<{ workflows: GitHubWorkflow[] }> {
        try {
            return await this.request<{ workflows: GitHubWorkflow[] }>(`/repos/${owner}/${repo}/actions/workflows`);
        } catch {
            return { workflows: [] };
        }
    }

    private async getWorkflowMetrics(owner: string, repo: string, timeframe: string): Promise<GitHubWorkflowMetrics> {
        try {
            const workflowsResponse = await this.getWorkflows(owner, repo);
            const workflows = workflowsResponse.workflows;
            
            if (workflows.length === 0) {
                return {
                    totalWorkflows: 0,
                    activeWorkflows: 0,
                    successRate: 0,
                    averageDuration: 0,
                    recentRuns: [],
                    timeframe,
                };
            }

            // Get recent workflow runs
            const runsResponse = await this.request<{ workflow_runs: GitHubWorkflowRun[] }>(`/repos/${owner}/${repo}/actions/runs?per_page=50`);
            const recentRuns = runsResponse.workflow_runs;

            // Calculate durations for completed runs
            const runsWithDuration = recentRuns.map(run => {
                if (run.status === 'completed' && run.run_started_at && run.updated_at) {
                    const startTime = new Date(run.run_started_at).getTime();
                    const endTime = new Date(run.updated_at).getTime();
                    run.duration_ms = endTime - startTime;
                }
                return run;
            });

            const completedRuns = runsWithDuration.filter(run => run.status === 'completed');
            const successfulRuns = completedRuns.filter(run => run.conclusion === 'success');
            
            const successRate = completedRuns.length > 0 ? (successfulRuns.length / completedRuns.length) * 100 : 0;
            
            // Calculate average duration in minutes
            const runsWithValidDuration = completedRuns.filter(run => run.duration_ms && run.duration_ms > 0);
            const averageDuration = runsWithValidDuration.length > 0 
                ? runsWithValidDuration.reduce((sum, run) => sum + (run.duration_ms! / 1000 / 60), 0) / runsWithValidDuration.length
                : 0;

            return {
                totalWorkflows: workflows.length,
                activeWorkflows: workflows.filter(w => w.state === 'active').length,
                successRate,
                averageDuration,
                recentRuns: recentRuns.slice(0, 10),
                timeframe,
            };
        } catch (error) {
            this.logger.error('Error getting workflow metrics:', error);
            return {
                totalWorkflows: 0,
                activeWorkflows: 0,
                successRate: 0,
                averageDuration: 0,
                recentRuns: [],
                timeframe,
            };
        }
    }

    private async getTeamMetrics(owner: string, repo: string, timeframe: string): Promise<GitHubTeamMetrics> {
        try {
            const [pulls, commits] = await Promise.all([
                this.getRepositoryPullRequests(owner, repo, 'all', 100),
                this.getCommits(owner, repo, 100),
            ]);

            const contributors = new Set(commits.map(c => c.author?.login).filter(Boolean)).size;
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const activeContributors = new Set(
                commits.filter(c => {
                    const commitDate = new Date(c.commit.author.date);
                    return commitDate > thirtyDaysAgo;
                }).map(c => c.author?.login).filter(Boolean)
            ).size;

            // Calculate PR metrics
            const mergedPRs = pulls.filter(pr => pr.merged_at);
            const avgTimeToMerge = mergedPRs.length > 0 
                ? mergedPRs.reduce((sum, pr) => {
                    if (pr.created_at && pr.merged_at) {
                        const created = new Date(pr.created_at).getTime();
                        const merged = new Date(pr.merged_at).getTime();
                        return sum + (merged - created);
                    }
                    return sum;
                }, 0) / mergedPRs.length / (1000 * 60 * 60) // Convert to hours
                : 0;

            // Get PR comments statistics
            const avgCommentsPerPR = pulls.length > 0 
                ? pulls.reduce((sum, pr) => sum + (pr.comments || 0) + (pr.review_comments || 0), 0) / pulls.length
                : 0;

            return {
                contributors,
                activeContributors,
                averageTimeToMerge: avgTimeToMerge,
                averageTimeToFirstReview: 0, // Would need additional API calls to calculate
                averageCommentsPerPR: avgCommentsPerPR,
                timeframe,
            };
        } catch (error) {
            this.logger.error('Error getting team metrics:', error);
            return {
                contributors: 0,
                activeContributors: 0,
                averageTimeToMerge: 0,
                averageTimeToFirstReview: 0,
                averageCommentsPerPR: 0,
                timeframe,
            };
        }
    }

    private async getActivityMetrics(owner: string, repo: string, timeframe: string): Promise<GitHubActivityMetrics> {
        try {
            const [pulls, issues, commits] = await Promise.all([
                this.getRepositoryPullRequests(owner, repo, 'all', 100),
                this.getIssues(owner, repo, 100),
                this.getCommits(owner, repo, 100),
            ]);

            const openPullRequests = pulls.filter(pr => pr.state === 'open').length;
            // Filter out pull requests from issues (GitHub issues API includes PRs)
            const actualIssues = issues.filter(issue => !issue.pull_request);
            const openIssues = actualIssues.filter(issue => issue.state === 'open').length;

            const lastCommit = commits.length > 0 ? {
                sha: commits[0].sha,
                date: commits[0].commit.author.date,
            } : undefined;

            return {
                totalCommits: commits.length,
                totalPullRequests: pulls.length,
                totalIssues: actualIssues.length,
                openPullRequests,
                openIssues,
                lastCommit,
                timeframe,
            };
        } catch (error) {
            this.logger.error('Error getting activity metrics:', error);
            return {
                totalCommits: 0,
                totalPullRequests: 0,
                totalIssues: 0,
                openPullRequests: 0,
                openIssues: 0,
                timeframe,
            };
        }
    }

    private async getCommits(owner: string, repo: string, limit: number = 100): Promise<GitHubCommit[]> {
        const path = `/repos/${owner}/${repo}/commits?per_page=${Math.min(limit, 100)}`;
        return await this.request<GitHubCommit[]>(path);
    }

    private async getIssues(owner: string, repo: string, limit: number = 100): Promise<GitHubIssue[]> {
        const path = `/repos/${owner}/${repo}/issues?per_page=${Math.min(limit, 100)}&state=all`;
        return await this.request<GitHubIssue[]>(path);
    }

    /**
     * Format project metrics as a readable string
     */
    public formatProjectMetrics(metrics: GitHubProjectMetrics): string {
        const repo = metrics.repository;
        const result: string[] = [];

        // Project header
        const status = repo.archived ? '🔴 Archived' : '🟢 Active';
        result.push(colors.bold.blue(`📊 Repository Dashboard: ${repo.name} ${status}`));

        // Repository info
        result.push(this.formatRepositoryInfo(repo));

        // Code quality
        if (metrics.codeQuality) {
            result.push(this.formatCodeQuality(metrics.codeQuality));
        }

        // Workflow metrics
        if (metrics.workflowMetrics) {
            result.push(this.formatWorkflowMetrics(metrics.workflowMetrics));
        }

        // Team metrics
        if (metrics.teamMetrics) {
            result.push(this.formatTeamMetrics(metrics.teamMetrics));
        }

        // Activity metrics
        if (metrics.activityMetrics) {
            result.push(this.formatActivityMetrics(metrics.activityMetrics));
        }

        return result.join('\n');
    }

    private formatRepositoryInfo(repo: GitHubRepository): string {
        const table = new Table()
            .border(true)
            .padding(1)
            .header(['Property', 'Value'])
            .body([
                ['Name', repo.name],
                ['Description', repo.description || 'No description'],
                ['Language', repo.language || 'Not specified'],
                ['Visibility', repo.private ? 'Private' : 'Public'],
                ['Stars', repo.stargazers_count.toString()],
                ['Forks', repo.forks_count.toString()],
                ['Open Issues', repo.open_issues_count.toString()],
                ['Default Branch', repo.default_branch],
                ['Created', new Date(repo.created_at).toLocaleDateString()],
                ['Last Updated', new Date(repo.updated_at).toLocaleDateString()],
                ['URL', repo.html_url],
            ]);

        return `\n${colors.bold.blue('📋 Repository Information')}\n${table.toString()}`;
    }

    private formatCodeQuality(quality: GitHubCodeQuality): string {
        const table = new Table()
            .border(true)
            .padding(1)
            .header(['Check', 'Status'])
            .body([
                ['README', quality.hasReadme ? '✅' : '🚧'],
                ['License', quality.hasLicense ? '✅' : '🚧'],
                ['Contributing Guide', quality.hasContributing ? '✅' : '🚧'],
                ['Code of Conduct', quality.hasCodeOfConduct ? '✅' : '🚧'],
                ['Security Policy', quality.hasSecurityPolicy ? '✅' : '🚧'],
                ['Issue Templates', quality.hasIssueTemplate ? '✅' : '🚧'],
                ['PR Templates', quality.hasPullRequestTemplate ? '✅' : '🚧'],
                ['GitHub Actions', quality.hasWorkflows ? '✅' : '🚧'],
                ['Dependabot', quality.hasDependabot ? '✅' : '🚧'],
                ['CODEOWNERS', quality.hasCodeOwners ? '✅' : '🚧'],
                ['Copilot Instructions', quality.hasCopilotInstructions ? '✅' : '🚧'],
                ['Tests', quality.hasTests ? '✅' : '🚧'],
            ]);

        return `\n${colors.bold.blue(`🔍 Code Quality (Grade: ${quality.grade}, Score: ${quality.score.toFixed(1)}%)`)}\n${table.toString()}`;
    }

    private formatWorkflowMetrics(metrics: GitHubWorkflowMetrics): string {
        const table = new Table()
            .border(true)
            .padding(1)
            .header(['Metric', 'Value'])
            .body([
                ['Total Workflows', metrics.totalWorkflows.toString()],
                ['Active Workflows', metrics.activeWorkflows.toString()],
                ['Success Rate', `${metrics.successRate.toFixed(1)}%`],
                ['Avg Duration', `${metrics.averageDuration.toFixed(1)} min`],
                ['Recent Runs', metrics.recentRuns.length.toString()],
            ]);

        return `\n${colors.bold.blue(`🚀 GitHub Actions (${metrics.timeframe})`)}\n${table.toString()}`;
    }

    private formatTeamMetrics(metrics: GitHubTeamMetrics): string {
        const table = new Table()
            .border(true)
            .padding(1)
            .header(['Metric', 'Value'])
            .body([
                ['Contributors', metrics.contributors.toString()],
                ['Active Contributors', metrics.activeContributors.toString()],
                ['Avg Time to Merge', `${metrics.averageTimeToMerge.toFixed(1)} hours`],
                ['Avg Comments per PR', metrics.averageCommentsPerPR.toFixed(1)],
            ]);

        return `\n${colors.bold.blue(`👥 Team Metrics (${metrics.timeframe})`)}\n${table.toString()}`;
    }

    private formatActivityMetrics(metrics: GitHubActivityMetrics): string {
        const table = new Table()
            .border(true)
            .padding(1)
            .header(['Metric', 'Value'])
            .body([
                ['Total Commits', metrics.totalCommits.toString()],
                ['Total Pull Requests', metrics.totalPullRequests.toString()],
                ['Total Issues', metrics.totalIssues.toString()],
                ['Open Pull Requests', metrics.openPullRequests.toString()],
                ['Open Issues', metrics.openIssues.toString()],
                ['Last Commit', metrics.lastCommit ? new Date(metrics.lastCommit.date).toLocaleDateString() : 'None'],
            ]);

        return `\n${colors.bold.blue(`📈 Activity Metrics (${metrics.timeframe})`)}\n${table.toString()}`;
    }

    /**
     * Get recently viewed repositories
     */
    public async getRecentRepositories(): Promise<GitHubRepository[]> {
        try {
            const recent = await this.userCache.get<GitHubRepository[]>('github_recent_repositories') || [];
            return recent.slice(0, this.maxRecentProjects);
        } catch {
            return [];
        }
    }

    /**
     * Add a repository to recent repositories list
     */
    private async addToRecentRepositories(repo: GitHubRepository): Promise<void> {
        try {
            const recent = await this.userCache.get<GitHubRepository[]>('github_recent_repositories') || [];
            
            // Remove if already exists
            const filtered = recent.filter(r => r.id !== repo.id);
            
            // Add to beginning
            filtered.unshift(repo);
            
            // Keep only max items
            const updated = filtered.slice(0, this.maxRecentProjects);
            
            await this.userCache.set('github_recent_repositories', updated);
        } catch (error) {
            this.logger.error('Error updating recent repositories:', error);
        }
    }

    /**
     * Search repositories
     */
    public async searchRepositories(query: string, limit: number = 20): Promise<GitHubRepository[]> {
        const path = `/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.min(limit, 100)}&sort=updated&order=desc`;
        const response = await this.request<{ items: GitHubRepository[] }>(path);
        return response.items;
    }

    /**
     * Create an issue
     */
    public async createIssue(
        owner: string,
        repo: string,
        title: string,
        body?: string,
        labels?: string[],
        assignees?: string[]
    ): Promise<GitHubIssue> {
        const path = `/repos/${owner}/${repo}/issues`;
        return await this.request<GitHubIssue>(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                body,
                labels,
                assignees,
            }),
        });
    }

    /**
     * Create a pull request
     */
    public async createPullRequest(
        owner: string,
        repo: string,
        options: {
            title: string;
            head: string;
            base: string;
            body?: string;
            draft?: boolean;
        }
    ): Promise<GitHubPullRequest> {
        const path = `/repos/${owner}/${repo}/pulls`;
        return await this.request<GitHubPullRequest>(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: options.title,
                head: options.head,
                base: options.base,
                body: options.body,
                draft: options.draft || false,
            }),
        });
    }
}

