import { Logger } from '../utils/logger.ts';
import { exists } from '@std/fs';

export type GitProvider = 'github' | 'gitlab' | 'unknown';

export interface GitProviderInfo {
    provider: GitProvider;
    host: string;
    owner: string;
    repository: string;
    isEnterprise: boolean;
    projectPath: string;
}

/**
 * Service for detecting Git providers (GitHub, GitLab) from repository URLs
 */
export class GitProviderDetector {
    private static logger = new Logger(
        'GitProviderDetector',
        Deno.env.get('NOVA_DEBUG') === 'true',
    );

    /**
     * Detect the git provider from the current repository
     * @param workingDirectory Optional working directory (defaults to current directory)
     * @returns Git provider information
     */
    static async detectProvider(workingDirectory?: string): Promise<GitProviderInfo> {
        try {
            const remoteUrl = await this.getRemoteUrlFromConfig(workingDirectory);
            return this.parseRemoteUrl(remoteUrl);
        } catch (error) {
            this.logger.debug(
                `Error detecting git provider: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return {
                provider: 'unknown',
                host: '',
                owner: '',
                repository: '',
                isEnterprise: false,
                projectPath: '',
            };
        }
    }

    /**
     * Get the remote URL from .git/config file
     */
    private static async getRemoteUrlFromConfig(workingDirectory?: string): Promise<string> {
        const basePath = workingDirectory || Deno.cwd();
        const gitConfigPath = `${basePath}/.git/config`;

        // Check if .git/config exists
        if (!await exists(gitConfigPath)) {
            throw new Error('Not a git repository (no .git/config found)');
        }

        try {
            const configContent = await Deno.readTextFile(gitConfigPath);

            // Parse the config file to find the origin remote URL
            const url = this.parseGitConfig(configContent);

            if (!url) {
                throw new Error('No origin remote URL found in git config');
            }

            return url;
        } catch (error) {
            if (error instanceof Deno.errors.PermissionDenied) {
                throw new Error('Permission denied reading .git/config');
            }
            throw error;
        }
    }

    /**
     * Parse git config content to extract origin remote URL
     */
    static parseGitConfig(configContent: string): string | null {
        const lines = configContent.split('\n');
        let inOriginSection = false;

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Check if we're entering the origin remote section
            if (trimmedLine === '[remote "origin"]') {
                inOriginSection = true;
                continue;
            }

            // Check if we're leaving the origin section (entering a new section)
            if (trimmedLine.startsWith('[') && trimmedLine !== '[remote "origin"]') {
                inOriginSection = false;
                continue;
            }

            // If we're in the origin section, look for the URL
            if (inOriginSection && trimmedLine.startsWith('url = ')) {
                return trimmedLine.substring(6); // Remove 'url = ' prefix
            }
        }

        return null;
    }

    /**
     * Parse a remote URL to extract provider information
     */
    static async parseRemoteUrl(remoteUrl: string): Promise<GitProviderInfo> {
        // Normalize the URL
        let url = remoteUrl.trim();

        // Convert SSH URL to HTTPS format for easier parsing
        if (url.startsWith('git@')) {
            // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
            const sshMatch = url.match(/^git@([^:]+):(.+)$/);
            if (sshMatch) {
                const [, host, path] = sshMatch;
                url = `https://${host}/${path}`;
            }
        }

        // Remove .git suffix
        url = url.replace(/\.git$/, '');

        // Try to parse as URL
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return {
                provider: 'unknown',
                host: '',
                owner: '',
                repository: '',
                isEnterprise: false,
                projectPath: '',
            };
        }

        const host = parsedUrl.hostname;
        const pathParts = parsedUrl.pathname.split('/').filter((part) => part.length > 0);

        if (pathParts.length < 2) {
            return {
                provider: 'unknown',
                host,
                owner: '',
                repository: '',
                isEnterprise: false,
                projectPath: '',
            };
        }

        const owner = pathParts[0];
        const repository = pathParts[1];

        // Detect provider based on hostname
        let provider: GitProvider = 'unknown';
        let isEnterprise = false;

        if (host === 'github.com') {
            provider = 'github';
            isEnterprise = false;
        } else if (host.includes('github')) {
            // GitHub Enterprise
            provider = 'github';
            isEnterprise = true;
        } else if (host === 'gitlab.com') {
            provider = 'gitlab';
            isEnterprise = false;
        } else if (host.includes('gitlab')) {
            // Self-hosted GitLab
            provider = 'gitlab';
            isEnterprise = true;
        } else {
            // Try to detect via API endpoints (as fallback)
            provider = await this.detectViaApiEndpoints(host);
            isEnterprise = provider !== 'unknown';
        }

        return {
            provider,
            host,
            owner,
            repository,
            isEnterprise,
            projectPath: `${owner}/${repository}`,
        };
    }

    /**
     * Try to detect provider by checking API endpoints (fallback method)
     */
    private static async detectViaApiEndpoints(host: string): Promise<GitProvider> {
        try {
            // Check for GitLab API
            const gitlabResponse = await fetch(`https://${host}/api/v4/version`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            });

            if (gitlabResponse.ok) {
                const data = await gitlabResponse.json();
                if (data.version) {
                    this.logger.debug(
                        `Detected GitLab instance at ${host} (version: ${data.version})`,
                    );
                    return 'gitlab';
                }
            }
        } catch {
            // Ignore GitLab API check failures
        }

        try {
            // Check for GitHub API
            const githubResponse = await fetch(`https://${host}/api/v3`, {
                method: 'GET',
                headers: { 'Accept': 'application/vnd.github.v3+json' },
            });

            if (githubResponse.ok) {
                this.logger.debug(`Detected GitHub Enterprise instance at ${host}`);
                return 'github';
            }
        } catch {
            // Ignore GitHub API check failures
        }

        return 'unknown';
    }

    /**
     * Check if the current directory is a git repository
     */
    static async isGitRepository(workingDirectory?: string): Promise<boolean> {
        const basePath = workingDirectory || Deno.cwd();
        const gitConfigPath = `${basePath}/.git/config`;

        try {
            return await exists(gitConfigPath);
        } catch {
            return false;
        }
    }

    /**
     * Get repository information for the current directory
     */
    static async getCurrentRepositoryInfo(
        workingDirectory?: string,
    ): Promise<GitProviderInfo | null> {
        const isGitRepo = await this.isGitRepository(workingDirectory);
        if (!isGitRepo) {
            return null;
        }

        return await this.detectProvider(workingDirectory);
    }
}
