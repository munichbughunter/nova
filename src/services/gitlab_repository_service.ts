import type { 
    PullRequest, 
    DiffData, 
    DiffComment,
    DiffFile,
    DiffHunk,
    DiffLine,
    GitService 
} from '../agents/types.ts';
import type { Logger } from '../utils/logger.ts';
import type { Config } from '../config/types.ts';
import { RepositoryServiceBase } from './repository_service_base.ts';
import { GitLabService } from './gitlab_service.ts';
import { MergeRequestSchema } from '@gitbeaker/rest';

/**
 * GitLab implementation of RepositoryService
 */
export class GitLabRepositoryService extends RepositoryServiceBase {
    private gitlabService: GitLabService;
    private config: Config;

    constructor(logger: Logger, gitService: GitService, config: Config) {
        super(logger, gitService);
        this.config = config;
        this.gitlabService = new GitLabService(config);
        this.logger = logger.child('GitLabRepositoryService');
    }

    /**
     * Get all open merge requests for the current project
     */
    async getPullRequests(): Promise<PullRequest[]> {
        try {
            await this.validateRepositoryType('gitlab');
            
            const repoInfo = await this.getRepositoryInfo();
            const projectPath = `${repoInfo.owner}/${repoInfo.repo}`;
            
            this.logger.debug(`Fetching merge requests for project: ${projectPath}`);

            // Get project details to get the project ID
            const project = await this.gitlabService.getProjectDetails(projectPath);
            
            // Use the GitLab REST API to get merge requests
            const mergeRequests = await this.gitlabService['gitlab'].MergeRequests.all({
                projectId: project.id,
                state: 'opened',
                orderBy: 'created_at',
                sort: 'desc',
            }) as MergeRequestSchema[];

            this.logger.debug(`Found ${mergeRequests.length} open merge requests`);

            return mergeRequests.map(mr => this.convertMergeRequestToPullRequest(mr));
        } catch (error) {
            this.logger.error('Failed to get merge requests', { error });
            throw new Error(`Failed to get merge requests: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get diff data for a specific merge request
     */
    async getPullRequestDiff(prId: string): Promise<DiffData> {
        try {
            await this.validateRepositoryType('gitlab');
            
            const repoInfo = await this.getRepositoryInfo();
            const projectPath = `${repoInfo.owner}/${repoInfo.repo}`;
            
            this.logger.debug(`Fetching diff for MR ${prId} in project: ${projectPath}`);

            // Get project details
            const project = await this.gitlabService.getProjectDetails(projectPath);
            
            // Get merge request details
            const mergeRequest = await this.gitlabService['gitlab'].MergeRequests.show(
                project.id, 
                parseInt(prId)
            ) as MergeRequestSchema;

            // Get merge request changes (diff)
            const changes = await this.gitlabService['gitlab'].MergeRequests.changes(
                project.id, 
                parseInt(prId)
            );

            this.logger.debug(`Processing ${changes.changes?.length || 0} file changes`);

            const diffFiles: DiffFile[] = (changes.changes || []).map(change => 
                this.convertGitLabChangeToDiffFile(change)
            );

            return {
                files: diffFiles,
                baseSha: mergeRequest.diff_refs?.base_sha || '',
                headSha: mergeRequest.diff_refs?.head_sha || '',
            };
        } catch (error) {
            this.logger.error(`Failed to get diff for MR ${prId}`, { error });
            throw new Error(`Failed to get merge request diff: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Post a diff comment on a merge request
     */
    async postDiffComment(prId: string, comment: DiffComment): Promise<void> {
        try {
            await this.validateRepositoryType('gitlab');
            
            const repoInfo = await this.getRepositoryInfo();
            const projectPath = `${repoInfo.owner}/${repoInfo.repo}`;
            
            this.logger.debug(`Posting comment on MR ${prId} in project: ${projectPath}`);

            // Get project details
            const project = await this.gitlabService.getProjectDetails(projectPath);

            // Create a discussion note on the merge request
            await this.gitlabService['gitlab'].MergeRequestDiscussions.create(
                project.id,
                parseInt(prId),
                {
                    body: this.formatCommentMessage(comment),
                    position: {
                        position_type: 'text',
                        new_path: comment.filePath,
                        new_line: comment.line,
                    },
                }
            );

            this.logger.debug(`Successfully posted comment on MR ${prId}`);
        } catch (error) {
            this.logger.error(`Failed to post comment on MR ${prId}`, { error });
            throw new Error(`Failed to post diff comment: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Convert GitLab MergeRequestSchema to PullRequest interface
     */
    private convertMergeRequestToPullRequest(mr: MergeRequestSchema): PullRequest {
        return {
            id: mr.iid?.toString() || mr.id?.toString() || '',
            title: mr.title || '',
            author: mr.author?.name || mr.author?.username || 'Unknown',
            status: this.normalizeStatus(mr.state || 'closed'),
            createdAt: this.formatDate(mr.created_at || new Date().toISOString()),
            url: mr.web_url || '',
        };
    }

    /**
     * Convert GitLab change object to DiffFile interface
     */
    private convertGitLabChangeToDiffFile(change: any): DiffFile {
        const changeType = this.determineChangeType(change);
        
        return {
            filePath: change.new_path || change.old_path || '',
            oldPath: change.old_path,
            newPath: change.new_path || change.old_path || '',
            changeType,
            hunks: this.parseDiffHunks(change.diff || ''),
        };
    }

    /**
     * Determine the type of change from GitLab change object
     */
    private determineChangeType(change: any): 'added' | 'modified' | 'deleted' | 'renamed' {
        if (change.new_file) return 'added';
        if (change.deleted_file) return 'deleted';
        if (change.renamed_file) return 'renamed';
        return 'modified';
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