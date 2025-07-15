import type { GitService, FileChange, DiffHunk, DiffLine } from '../agents/types.ts';
import type { Logger } from '../utils/logger.ts';

/**
 * Git service implementation for repository operations
 */
export class GitServiceImpl implements GitService {
    private logger: Logger;
    private workingDirectory: string;

    constructor(logger: Logger, workingDirectory: string = Deno.cwd()) {
        this.logger = logger.child('GitService');
        this.workingDirectory = workingDirectory;
    }

    /**
     * Get list of changed files in the current repository
     */
    async getChangedFiles(): Promise<string[]> {
        try {
            this.logger.debug('Getting changed files from Git');
            
            // Get staged and unstaged changes
            const stagedResult = await this.runGitCommand(['diff', '--cached', '--name-only']);
            const unstagedResult = await this.runGitCommand(['diff', '--name-only']);
            const untrackedResult = await this.runGitCommand(['ls-files', '--others', '--exclude-standard']);

            const stagedFiles = stagedResult.trim() ? stagedResult.split('\n') : [];
            const unstagedFiles = unstagedResult.trim() ? unstagedResult.split('\n') : [];
            const untrackedFiles = untrackedResult.trim() ? untrackedResult.split('\n') : [];

            // Combine and deduplicate files
            const allFiles = new Set([...stagedFiles, ...unstagedFiles, ...untrackedFiles]);
            const changedFiles = Array.from(allFiles).filter(file => file.trim() !== '');

            this.logger.debug(`Found ${changedFiles.length} changed files`);
            return changedFiles;
        } catch (error) {
            this.logger.error('Failed to get changed files', { error });
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get changed files: ${message}`);
        }
    }

    /**
     * Get detailed changes for a specific file
     */
    async getFileChanges(filePath: string): Promise<FileChange[]> {
        try {
            this.logger.debug(`Getting file changes for: ${filePath}`);

            // Check if file exists and get its status
            const statusResult = await this.runGitCommand(['status', '--porcelain', filePath]);
            
            if (!statusResult.trim()) {
                this.logger.debug(`No changes found for file: ${filePath}`);
                return [];
            }

            const statusLine = statusResult.trim().split('\n')[0];
            const statusCode = statusLine.substring(0, 2);
            const changeType = this.parseChangeType(statusCode);

            // Get the diff for the file
            let diffResult: string;
            if (changeType === 'added') {
                // For new files, show the entire content as additions
                diffResult = await this.runGitCommand(['diff', '--no-index', '/dev/null', filePath]);
            } else {
                // For modified files, get the regular diff
                diffResult = await this.runGitCommand(['diff', 'HEAD', filePath]);
            }

            const hunks = this.parseDiff(diffResult);

            const fileChange: FileChange = {
                type: changeType,
                filePath,
                hunks,
            };

            this.logger.debug(`Parsed ${hunks.length} hunks for file: ${filePath}`);
            return [fileChange];
        } catch (error) {
            this.logger.error(`Failed to get file changes for ${filePath}`, { error });
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get file changes for ${filePath}: ${message}`);
        }
    }

    /**
     * Get the remote URL of the repository
     */
    async getRemoteUrl(): Promise<string> {
        try {
            this.logger.debug('Getting Git remote URL');
            
            const result = await this.runGitCommand(['remote', 'get-url', 'origin']);
            const remoteUrl = result.trim();
            
            if (!remoteUrl) {
                throw new Error('No remote URL found');
            }

            this.logger.debug(`Found remote URL: ${remoteUrl}`);
            return remoteUrl;
        } catch (error) {
            this.logger.error('Failed to get remote URL', { error });
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get remote URL: ${message}`);
        }
    }

    /**
     * Get the current branch name
     */
    async getCurrentBranch(): Promise<string> {
        try {
            this.logger.debug('Getting current Git branch');
            
            const result = await this.runGitCommand(['branch', '--show-current']);
            const branch = result.trim();
            
            if (!branch) {
                // Fallback to parsing HEAD if branch --show-current fails
                const headResult = await this.runGitCommand(['symbolic-ref', '--short', 'HEAD']);
                const fallbackBranch = headResult.trim();
                
                if (!fallbackBranch) {
                    throw new Error('Unable to determine current branch');
                }
                
                this.logger.debug(`Found current branch (fallback): ${fallbackBranch}`);
                return fallbackBranch;
            }

            this.logger.debug(`Found current branch: ${branch}`);
            return branch;
        } catch (error) {
            this.logger.error('Failed to get current branch', { error });
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get current branch: ${message}`);
        }
    }

    /**
     * Run a Git command and return the output
     */
    private async runGitCommand(args: string[]): Promise<string> {
        try {
            const command = new Deno.Command('git', {
                args,
                cwd: this.workingDirectory,
                stdout: 'piped',
                stderr: 'piped',
            });

            const { code, stdout, stderr } = await command.output();

            if (code !== 0) {
                const errorMessage = new TextDecoder().decode(stderr);
                throw new Error(`Git command failed: ${errorMessage}`);
            }

            return new TextDecoder().decode(stdout);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                throw new Error('Git is not installed or not available in PATH');
            }
            throw error;
        }
    }

    /**
     * Parse Git status code to determine change type
     */
    private parseChangeType(statusCode: string): 'added' | 'modified' | 'deleted' {
        const firstChar = statusCode[0];
        const secondChar = statusCode[1];

        // Check staged changes first, then unstaged
        if (firstChar === 'A' || secondChar === 'A') return 'added';
        if (firstChar === 'D' || secondChar === 'D') return 'deleted';
        if (firstChar === 'M' || secondChar === 'M') return 'modified';
        if (firstChar === '?' || secondChar === '?') return 'added'; // Untracked files

        // Default to modified for other cases
        return 'modified';
    }

    /**
     * Parse Git diff output into structured hunks
     */
    private parseDiff(diffOutput: string): DiffHunk[] {
        const hunks: DiffHunk[] = [];
        const lines = diffOutput.split('\n');
        
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

            // Skip non-diff lines (file headers, etc.)
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
     * Check if the current directory is a Git repository
     */
    async isGitRepository(): Promise<boolean> {
        try {
            await this.runGitCommand(['rev-parse', '--git-dir']);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the repository root directory
     */
    async getRepositoryRoot(): Promise<string> {
        try {
            const result = await this.runGitCommand(['rev-parse', '--show-toplevel']);
            return result.trim();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get repository root: ${message}`);
        }
    }
}