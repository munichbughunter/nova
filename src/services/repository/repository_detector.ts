import type { GitService } from '../../agents/types.ts';
import type { Logger } from '../../utils/logger.ts';

/**
 * Repository detection utility for determining GitLab vs GitHub
 */
export class RepositoryDetector {
    private logger: Logger;
    private gitService: GitService;

    constructor(logger: Logger, gitService: GitService) {
        this.logger = logger.child('RepositoryDetector');
        this.gitService = gitService;
    }

    /**
     * Detect repository type based on Git remote URL
     */
    async detectRepositoryType(): Promise<'gitlab' | 'github' | 'unknown'> {
        try {
            this.logger.debug('Detecting repository type from Git remote URL');
            
            const remoteUrl = await this.gitService.getRemoteUrl();
            this.logger.debug(`Remote URL: ${remoteUrl}`);

            // Normalize URL for comparison
            const normalizedUrl = remoteUrl.toLowerCase();

            // Check for GitLab patterns
            if (this.isGitLabUrl(normalizedUrl)) {
                this.logger.debug('Detected GitLab repository');
                return 'gitlab';
            }

            // Check for GitHub patterns
            if (this.isGitHubUrl(normalizedUrl)) {
                this.logger.debug('Detected GitHub repository');
                return 'github';
            }

            this.logger.warn(`Unknown repository type for URL: ${remoteUrl}`);
            return 'unknown';
        } catch (error) {
            this.logger.error('Failed to detect repository type', { error });
            return 'unknown';
        }
    }

    /**
     * Check if URL is a GitLab repository
     */
    private isGitLabUrl(url: string): boolean {
        const gitlabPatterns = [
            'gitlab.com',
            'gitlab.',
            '/gitlab/',
            'git.gitlab',
        ];

        return gitlabPatterns.some(pattern => url.includes(pattern));
    }

    /**
     * Check if URL is a GitHub repository
     */
    private isGitHubUrl(url: string): boolean {
        const githubPatterns = [
            'github.com',
            'github.',
            '/github/',
            'git.github',
        ];

        return githubPatterns.some(pattern => url.includes(pattern));
    }

    /**
     * Extract repository information from URL
     */
    async getRepositoryInfo(): Promise<{
        type: 'gitlab' | 'github' | 'unknown';
        owner: string;
        repo: string;
        url: string;
    }> {
        try {
            const remoteUrl = await this.gitService.getRemoteUrl();
            const type = await this.detectRepositoryType();
            
            const { owner, repo } = this.parseRepositoryPath(remoteUrl);

            return {
                type,
                owner,
                repo,
                url: remoteUrl,
            };
        } catch (error) {
            this.logger.error('Failed to get repository info', { error });
            throw new Error(`Failed to get repository info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Parse owner and repository name from URL
     */
    private parseRepositoryPath(url: string): { owner: string; repo: string } {
        try {
            // Handle different URL formats:
            // - https://github.com/owner/repo.git
            // - git@github.com:owner/repo.git
            // - https://gitlab.com/owner/repo
            
            let path: string;
            
            if (url.startsWith('git@')) {
                // SSH format: git@github.com:owner/repo.git
                const parts = url.split(':');
                if (parts.length >= 2) {
                    path = parts[1];
                } else {
                    throw new Error('Invalid SSH URL format');
                }
            } else {
                // HTTPS format: https://github.com/owner/repo.git
                const urlObj = new URL(url);
                path = urlObj.pathname;
            }

            // Remove leading slash and .git suffix
            path = path.replace(/^\//, '').replace(/\.git$/, '');
            
            const pathParts = path.split('/');
            if (pathParts.length < 2) {
                throw new Error('Invalid repository path format');
            }

            return {
                owner: pathParts[0],
                repo: pathParts[1],
            };
        } catch (error) {
            this.logger.error(`Failed to parse repository path from URL: ${url}`, { error });
            return {
                owner: 'unknown',
                repo: 'unknown',
            };
        }
    }
}