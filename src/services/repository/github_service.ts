import type { 
    GitHubService,
    PullRequest, 
    DiffData, 
    DiffComment,
    DiffFile,
    DiffHunk,
    DiffLine,
    GitService,
    GitHubPullRequest,
    GitHubFile,
    GitHubReviewComment
} from '../../agents/types.ts';
import type { Logger } from '../../utils/logger.ts';
import type { Config } from '../../config/types.ts';
import { RepositoryServiceBase } from './repository_service_base.ts';

/**
 * GitHub API response interfaces
 */
interface GitHubApiPullRequest {
    number: number;
    title: string;
    user: { login: string };
    state: 'open' | 'closed';
    html_url: string;
    created_at: string;
    merged_at?: string;
}

interface GitHubApiFile {
    filename: string;
    status: 'added' | 'modified' | 'removed' | 'renamed';
    patch?: string;
    sha: string;
    previous_filename?: string;
}

interface GitHubApiPullRequestDetails {
    base: {
        sha: string;
    };
    head: {
        sha: string;
    };
}

/**
 * Batch request for API optimization
 */
interface BatchRequest {
    id: string;
    endpoint: string;
    options?: RequestInit;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
}

/**
 * GitHub implementation of RepositoryService
 */
export class GitHubServiceImpl extends RepositoryServiceBase implements GitHubService {
    private config: Config;
    private apiUrl: string;
    private token?: string;
    private authenticated: boolean = false;
    private batchQueue: BatchRequest[] = [];
    private batchTimer?: number;
    private readonly batchDelay = 50; // 50ms batch delay
    private readonly maxBatchSize = 10; // Maximum requests per batch

    constructor(logger: Logger, gitService: GitService, config: Config) {
        super(logger, gitService);
        this.config = config;
        this.logger = logger.child('GitHubService');
        
        // Get GitHub configuration
        this.apiUrl = config.github?.apiUrl || 'https://api.github.com';
        this.token = config.github?.token || Deno.env.get('GITHUB_TOKEN');
    }

    /**
     * Authenticate with GitHub API
     */
    async authenticate(): Promise<void> {
        if (!this.token) {
            throw new Error('GitHub token not found. Please set GITHUB_TOKEN environment variable or configure it in the config file.');
        }

        try {
            this.logger.debug('Authenticating with GitHub API');
            
            // Test authentication by getting user info
            const response = await this.makeApiRequest('/user');
            
            if (!response.ok) {
                throw new Error(`GitHub authentication failed: ${response.status} ${response.statusText}`);
            }

            const user = await response.json();
            this.logger.debug(`Authenticated as GitHub user: ${user.login}`);
            this.authenticated = true;
        } catch (error) {
            this.logger.error('GitHub authentication failed', { error });
            throw new Error(`GitHub authentication failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get all open pull requests for the current repository
     */
    async getPullRequests(): Promise<PullRequest[]> {
        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`;
            
            this.logger.debug(`Fetching pull requests for repository: ${repoInfo.owner}/${repoInfo.repo}`);

            const response = await this.makeApiRequest(endpoint, {
                method: 'GET',
            });

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
            }

            const pullRequests: GitHubApiPullRequest[] = await response.json();
            this.logger.debug(`Found ${pullRequests.length} pull requests`);

            return pullRequests
                .filter(pr => pr.state === 'open')
                .map(pr => this.convertGitHubPRToPullRequest(pr));
        } catch (error) {
            this.logger.error('Failed to get pull requests', { error });
            throw new Error(`Failed to get pull requests: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get GitHub pull requests (GitHub-specific method)
     */
    async getGitHubPullRequests(): Promise<GitHubPullRequest[]> {
        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`;
            
            this.logger.debug(`Fetching GitHub pull requests for repository: ${repoInfo.owner}/${repoInfo.repo}`);

            const response = await this.makeApiRequest(endpoint);

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
            }

            const pullRequests: GitHubApiPullRequest[] = await response.json();
            
            return pullRequests
                .filter(pr => pr.state === 'open')
                .map(pr => ({
                    number: pr.number,
                    title: pr.title,
                    user: pr.user,
                    state: pr.state,
                    html_url: pr.html_url,
                    created_at: pr.created_at,
                }));
        } catch (error) {
            this.logger.error('Failed to get GitHub pull requests', { error });
            throw new Error(`Failed to get GitHub pull requests: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get diff data for a specific pull request
     */
    async getPullRequestDiff(prId: string): Promise<DiffData> {
        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            const prNumber = parseInt(prId);
            
            this.logger.debug(`Fetching diff for PR ${prNumber} in repository: ${repoInfo.owner}/${repoInfo.repo}`);

            // Get PR details for base and head SHA
            const prResponse = await this.makeApiRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`);
            
            if (!prResponse.ok) {
                throw new Error(`GitHub API error: ${prResponse.status} ${prResponse.statusText}`);
            }

            const prDetails: GitHubApiPullRequestDetails = await prResponse.json();

            // Get PR files
            const filesResponse = await this.makeApiRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/files`);
            
            if (!filesResponse.ok) {
                throw new Error(`GitHub API error: ${filesResponse.status} ${filesResponse.statusText}`);
            }

            const filesData = await filesResponse.json();
            const files: GitHubApiFile[] = Array.isArray(filesData) ? filesData : [];
            this.logger.debug(`Processing ${files.length} file changes`);

            const diffFiles: DiffFile[] = files.map(file => this.convertGitHubFileToDiffFile(file));

            return {
                files: diffFiles,
                baseSha: prDetails.base.sha,
                headSha: prDetails.head.sha,
            };
        } catch (error) {
            this.logger.error(`Failed to get diff for PR ${prId}`, { error });
            throw new Error(`Failed to get pull request diff: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get files for a specific pull request (GitHub-specific method)
     */
    async getPullRequestFiles(prNumber: number): Promise<GitHubFile[]> {
        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/files`;
            
            this.logger.debug(`Fetching files for PR ${prNumber} in repository: ${repoInfo.owner}/${repoInfo.repo}`);

            const response = await this.makeApiRequest(endpoint);

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
            }

            const files: GitHubApiFile[] = await response.json();
            
            return files.map(file => ({
                filename: file.filename,
                status: file.status,
                patch: file.patch,
            }));
        } catch (error) {
            this.logger.error(`Failed to get files for PR ${prNumber}`, { error });
            throw new Error(`Failed to get pull request files: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Post a diff comment on a pull request
     */
    async postDiffComment(prId: string, comment: DiffComment): Promise<void> {
        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            const prNumber = parseInt(prId);
            
            this.logger.debug(`Posting comment on PR ${prNumber} in repository: ${repoInfo.owner}/${repoInfo.repo}`);

            // Get PR details to get the commit SHA
            const prResponse = await this.makeApiRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`);
            if (!prResponse.ok) {
                throw new Error(`Failed to get PR details: ${prResponse.status} ${prResponse.statusText}`);
            }
            const prDetails = await prResponse.json();
            const commitSha = prDetails.head.sha;

            // For GitHub API, use the correct format for review comments
            const reviewComment: GitHubReviewComment = {
                body: this.formatCommentMessage(comment),
                path: comment.filePath,
                commit_id: commitSha,
                position: comment.line, // GitHub uses 'position' not 'line'
                side: 'RIGHT',
            };

            await this.createReviewComment(prNumber, reviewComment);
            this.logger.debug(`Successfully posted comment on PR ${prNumber}`);
        } catch (error) {
            this.logger.error(`Failed to post comment on PR ${prId}`, { error });
            throw new Error(`Failed to post diff comment: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Create a review comment on a pull request (GitHub-specific method)
     */
    async createReviewComment(prNumber: number, comment: GitHubReviewComment): Promise<void> {
        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/comments`;
            
            this.logger.debug(`Creating review comment on PR ${prNumber}`);

            const response = await this.makeApiRequest(endpoint, {
                method: 'POST',
                body: JSON.stringify(comment),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            this.logger.debug(`Successfully created review comment on PR ${prNumber}`);
        } catch (error) {
            this.logger.error(`Failed to create review comment on PR ${prNumber}`, { error });
            throw new Error(`Failed to create review comment: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Make an authenticated API request to GitHub with batching support
     */
    private async makeApiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
        // For GET requests, use batching to optimize API calls
        if (!options.method || options.method === 'GET') {
            return this.makeBatchedApiRequest(endpoint, options);
        }

        // For non-GET requests, make direct API call
        return this.makeDirectApiRequest(endpoint, options);
    }

    /**
     * Make a direct API request without batching
     */
    private async makeDirectApiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const url = `${this.apiUrl}${endpoint}`;
        
        const headers = new Headers({
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Nova-Code-Review-Agent/1.0',
            ...options.headers as Record<string, string>,
        });

        if (this.token) {
            headers.set('Authorization', `Bearer ${this.token}`);
        }

        if (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH') {
            headers.set('Content-Type', 'application/json');
        }

        return await fetch(url, {
            ...options,
            headers,
        });
    }

    /**
     * Make a batched API request for GET operations
     */
    private async makeBatchedApiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
        return new Promise<Response>((resolve, reject) => {
            const requestId = `${endpoint}-${Date.now()}-${Math.random()}`;
            
            const batchRequest: BatchRequest = {
                id: requestId,
                endpoint,
                options,
                resolve,
                reject,
            };

            this.batchQueue.push(batchRequest);

            // If we've reached the batch size limit, process immediately
            if (this.batchQueue.length >= this.maxBatchSize) {
                this.processBatch();
                return;
            }

            // Otherwise, set a timer to process the batch
            if (this.batchTimer) {
                clearTimeout(this.batchTimer);
            }

            this.batchTimer = setTimeout(() => {
                this.processBatch();
            }, this.batchDelay);
        });
    }

    /**
     * Process the current batch of API requests
     */
    private async processBatch(): Promise<void> {
        if (this.batchQueue.length === 0) {
            return;
        }

        const currentBatch = this.batchQueue.splice(0, this.maxBatchSize);
        
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = undefined;
        }

        this.logger.debug(`Processing batch of ${currentBatch.length} API requests`);

        // Process requests in parallel with controlled concurrency
        const promises = currentBatch.map(async (request) => {
            try {
                const response = await this.makeDirectApiRequest(request.endpoint, request.options);
                request.resolve(response);
            } catch (error) {
                request.reject(error instanceof Error ? error : new Error(String(error)));
            }
        });

        await Promise.all(promises);
    }

    /**
     * Batch multiple comment posts for efficiency
     */
    async postMultipleDiffComments(prId: string, comments: DiffComment[]): Promise<void> {
        if (comments.length === 0) {
            return;
        }

        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            const prNumber = parseInt(prId);
            
            this.logger.debug(`Posting ${comments.length} comments on PR ${prNumber} in batch`);

            // Get PR details to get the commit SHA
            const prResponse = await this.makeApiRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`);
            if (!prResponse.ok) {
                throw new Error(`Failed to get PR details: ${prResponse.status} ${prResponse.statusText}`);
            }
            const prDetails = await prResponse.json();
            const commitSha = prDetails.head.sha;

            // Convert to GitHub review comments
            const reviewComments: GitHubReviewComment[] = comments.map(comment => ({
                body: this.formatCommentMessage(comment),
                path: comment.filePath,
                commit_id: commitSha,
                position: comment.line, // GitHub uses 'position' not 'line'
                side: 'RIGHT',
            }));

            // Process comments in batches to avoid overwhelming the API
            const batchSize = 5; // GitHub API rate limits
            for (let i = 0; i < reviewComments.length; i += batchSize) {
                const batch = reviewComments.slice(i, i + batchSize);
                
                const promises = batch.map(comment => 
                    this.createReviewComment(prNumber, comment)
                );

                await Promise.all(promises);
                
                // Small delay between batches to respect rate limits
                if (i + batchSize < reviewComments.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            this.logger.debug(`Successfully posted ${comments.length} comments on PR ${prNumber}`);
        } catch (error) {
            this.logger.error(`Failed to post batch comments on PR ${prId}`, { error });
            throw new Error(`Failed to post batch diff comments: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get multiple pull requests with optimized batching
     */
    async getMultiplePullRequestDetails(prNumbers: number[]): Promise<Array<{ prNumber: number; details: any; files: GitHubFile[] }>> {
        if (prNumbers.length === 0) {
            return [];
        }

        try {
            await this.validateRepositoryType('github');
            await this.ensureAuthenticated();
            
            const repoInfo = await this.getRepositoryInfo();
            
            this.logger.debug(`Fetching details for ${prNumbers.length} pull requests in batch`);

            // Create batched requests for PR details and files
            const detailsPromises = prNumbers.map(async (prNumber) => {
                const [detailsResponse, filesResponse] = await Promise.all([
                    this.makeApiRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`),
                    this.makeApiRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/files`),
                ]);

                if (!detailsResponse.ok || !filesResponse.ok) {
                    throw new Error(`Failed to fetch PR ${prNumber} details`);
                }

                const [details, files] = await Promise.all([
                    detailsResponse.json(),
                    filesResponse.json(),
                ]);

                return {
                    prNumber,
                    details,
                    files: files.map((file: GitHubApiFile) => ({
                        filename: file.filename,
                        status: file.status,
                        patch: file.patch,
                    })),
                };
            });

            const results = await Promise.all(detailsPromises);
            this.logger.debug(`Successfully fetched details for ${results.length} pull requests`);
            
            return results;
        } catch (error) {
            this.logger.error('Failed to get multiple PR details', { error });
            throw new Error(`Failed to get multiple pull request details: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Cleanup method to process any remaining batched requests
     */
    async flushBatch(): Promise<void> {
        if (this.batchQueue.length > 0) {
            await this.processBatch();
        }
    }

    /**
     * Ensure the service is authenticated
     */
    private async ensureAuthenticated(): Promise<void> {
        if (!this.authenticated) {
            await this.authenticate();
        }
    }

    /**
     * Convert GitHub PR to unified PullRequest interface
     */
    private convertGitHubPRToPullRequest(pr: GitHubApiPullRequest): PullRequest {
        return {
            id: pr.number.toString(),
            title: pr.title,
            author: pr.user.login,
            status: pr.merged_at ? 'merged' : this.normalizeStatus(pr.state),
            createdAt: this.formatDate(pr.created_at),
            url: pr.html_url,
        };
    }

    /**
     * Convert GitHub file to DiffFile interface
     */
    private convertGitHubFileToDiffFile(file: GitHubApiFile): DiffFile {
        const changeType = this.determineChangeType(file);
        
        return {
            filePath: file.filename,
            oldPath: file.previous_filename || (changeType === 'renamed' ? file.previous_filename : file.filename),
            newPath: file.filename,
            changeType,
            hunks: this.parseDiffHunks(file.patch || ''),
        };
    }

    /**
     * Determine the type of change from GitHub file object
     */
    private determineChangeType(file: GitHubApiFile): 'added' | 'modified' | 'deleted' | 'renamed' {
        return file.status as 'added' | 'modified' | 'deleted' | 'renamed';
    }

    /**
     * Parse diff string into structured hunks
     */
    private parseDiffHunks(diffString: string): DiffHunk[] {
        const hunks: DiffHunk[] = [];
        const lines = diffString.split('\n');
        
        let currentHunk: DiffHunk | null = null;
        let oldLineNumber = 0;
        let newLineNumber = 0;

        for (const line of lines) {
            // Parse hunk header (e.g., @@ -1,4 +1,6 @@)
            const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
            if (hunkMatch) {
                // Save previous hunk if exists
                if (currentHunk) {
                    hunks.push(currentHunk);
                }

                const oldStart = parseInt(hunkMatch[1]);
                const oldLines = parseInt(hunkMatch[2] || '1');
                const newStart = parseInt(hunkMatch[3]);
                const newLines = parseInt(hunkMatch[4] || '1');

                currentHunk = {
                    oldStart,
                    oldLines,
                    newStart,
                    newLines,
                    lines: [],
                };

                oldLineNumber = oldStart;
                newLineNumber = newStart;
                continue;
            }

            // Skip non-diff lines
            if (!currentHunk || (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-'))) {
                continue;
            }

            // Parse diff line
            const diffLine: DiffLine = {
                type: line.startsWith('+') ? 'addition' : 
                      line.startsWith('-') ? 'deletion' : 'context',
                content: line.substring(1), // Remove the +/- prefix
            };

            // Set line numbers based on type
            if (diffLine.type === 'deletion') {
                diffLine.oldLineNumber = oldLineNumber++;
            } else if (diffLine.type === 'addition') {
                diffLine.newLineNumber = newLineNumber++;
            } else {
                // Context line
                diffLine.oldLineNumber = oldLineNumber++;
                diffLine.newLineNumber = newLineNumber++;
            }

            currentHunk.lines.push(diffLine);
        }

        // Add the last hunk
        if (currentHunk) {
            hunks.push(currentHunk);
        }

        return hunks;
    }

    /**
     * Format comment message with severity indicator
     */
    private formatCommentMessage(comment: DiffComment): string {
        const severityEmoji = {
            'info': 'ℹ️',
            'warning': '⚠️',
            'error': '❌',
        };

        const emoji = severityEmoji[comment.severity] || 'ℹ️';
        
        return `${emoji} **Code Review Comment**\n\n${comment.message}`;
    }
}