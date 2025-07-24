import { Config } from '../config/mod.ts';
import { DevCache } from '../utils/devcache.ts';
import { Logger } from '../utils/logger.ts';
import { UserCache } from '../utils/usercache.ts';

/**
 * Interface for file status returned by git status
 */
export interface GitFileStatus {
  path: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  deleted: boolean;
  statusCode: string;
}

/**
 * Interface for git diff results
 */
export interface GitDiffResult {
  path: string;
  diff: string;
  isNewFile: boolean;
  isDeleted: boolean;
}

/**
 * GitService is a service that provides a client for the Git API.
 * It is used to get git diffs, commit messages, and other information.
 *
 * @since 0.0.1
 */
export class GitService {
  private config: Config;
  private logger: Logger;
  private cache: DevCache;
  private userCache!: UserCache;
  private initialized = false;
  private workingDirectory: string;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger('Git', Deno.env.get('nova_DEBUG') === 'true');
    this.workingDirectory = Deno.cwd();

    // Initialize cache
    this.cache = new DevCache({
      basePath: `${Deno.env.get('HOME')}/.nova/cache`,
      serviceName: 'git',
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

  public async clearCache(pattern?: string): Promise<void> {
    await this.ensureInitialized();
    await this.cache.clear(pattern);
  }

  /**
   * Check if the current directory is a git repository
   * @returns True if the current directory is a git repository
   */
  public async isGitRepository(): Promise<boolean> {
    try {
      const command = new Deno.Command('git', {
        args: ['rev-parse', '--is-inside-work-tree'],
        stdout: 'piped',
        stderr: 'piped',
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        this.logger.debug(`Error checking git repository: ${error}`);
        return false;
      }
      
      return output === 'true';
    } catch (error) {
      this.logger.debug(`Error checking git repository: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get the root directory of the git repository
   * @returns Path to the git repository root or null if not in a git repository
   */
  public async getRepositoryRoot(): Promise<string | null> {
    try {
      const command = new Deno.Command('git', {
        args: ['rev-parse', '--show-toplevel'],
        stdout: 'piped',
        stderr: 'piped',
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        this.logger.debug(`Error getting git repository root: ${error}`);
        return null;
      }
      
      return output;
    } catch (error) {
      this.logger.debug(`Error getting git repository root: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Set the working directory for git commands
   * @param directory Directory to use for git commands
   */
  public setWorkingDirectory(directory: string): void {
    this.workingDirectory = directory;
  }

  /**
   * Get the current git branch
   * @returns Name of the current branch
   */
  public async getCurrentBranch(): Promise<string | null> {
    try {
      const command = new Deno.Command('git', {
        args: ['rev-parse', '--abbrev-ref', 'HEAD'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        this.logger.debug(`Error getting current branch: ${error}`);
        return null;
      }
      
      return output;
    } catch (error) {
      this.logger.debug(`Error getting current branch: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get list of changed files in the git repository
   * @param includeUntracked Whether to include untracked files (defaults to true)
   * @returns Array of file paths that have changes
   */
  public async getChangedFiles(includeUntracked = true): Promise<string[]> {
    try {
      const command = new Deno.Command('git', {
        args: ['status', '--porcelain'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        throw new Error(`Git error: ${error}`);
      }
      
      if (!output) {
        return [];
      }
      
      // Parse the output and extract file paths
      // Format is: XY filename
      // where X is the status in the index, Y is the status in the working tree
      const paths = output.split('\n')
        .map((line) => {
          const statusCode = line.substring(0, 2);
          const path = line.substring(2).trim();
          
          // Skip untracked files if not requested
          if (!includeUntracked && statusCode === '??') {
            return null;
          }
          
          return path;
        })
        .filter((path): path is string => path !== null && path.length > 0);
      
      // Resolve paths that might not exist directly
      const resolvedPaths = await Promise.all(paths.map(async (path) => {
        // First check if path exists as-is
        try {
          await Deno.stat(path);
          return path; // Path exists, use it as-is
        } catch {
          // Path doesn't exist, try to resolve it
          const repoRoot = await this.getRepositoryRoot();
          if (!repoRoot) return path;
          
          // Return original path as fallback
          return path;
        }
      }));
      
      return resolvedPaths;
    } catch (error) {
      this.logger.error(`Error getting changed files: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get detailed status information for changed files
   * @param includeUntracked Whether to include untracked files (defaults to true)
   * @returns Array of GitFileStatus objects
   */
  public async getFileStatuses(includeUntracked = true): Promise<GitFileStatus[]> {
    try {
      const command = new Deno.Command('git', {
        args: ['status', '--porcelain'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        throw new Error(`Git error: ${error}`);
      }
      
      if (!output) {
        return [];
      }
      
      return output.split('\n')
        .map((line) => {
          const statusCode = line.substring(0, 2);
          const path = line.substring(2).trim();
          
          // Skip untracked files if not requested
          if (!includeUntracked && statusCode === '??') {
            return null;
          }
          
          // Parse status code
          const staged = statusCode[0] !== ' ' && statusCode[0] !== '?';
          const unstaged = statusCode[1] !== ' ' && statusCode[1] !== '?';
          const untracked = statusCode === '??';
          const deleted = statusCode[0] === 'D' || statusCode[1] === 'D';
          
          return {
            path,
            staged,
            unstaged,
            untracked,
            deleted,
            statusCode
          };
        })
        .filter((status): status is GitFileStatus => status !== null);
    } catch (error) {
      this.logger.error(`Error getting file statuses: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get Git diff for a specific file
   * @param path Path to the file
   * @param cached Whether to get staged changes (defaults to false)
   * @returns Git diff output or file content if file is new
   */
  public async getFileDiff(path: string, cached = false): Promise<GitDiffResult> {
    try {
      // Ensure the path exists
      try {
        await Deno.stat(path);
      } catch (error) {
        this.logger.error(`File not found: ${path}`);
          throw error;
      }
      
      // Check file status
      const statusCommand = new Deno.Command('git', {
        args: ['status', '--porcelain', path],
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout: statusOutput } = await statusCommand.output();
      const statusLine = new TextDecoder().decode(statusOutput).trim();
      
      // Default result
      const result: GitDiffResult = {
        path,
        diff: '',
        isNewFile: false,
        isDeleted: false
      };
      
      if (!statusLine) {
        this.logger.debug(`File ${path} does not have any changes in Git.`);
        
        // File exists but has no git changes, read its content
        result.diff = await Deno.readTextFile(path);
        return result;
      }
      
      const statusCode = statusLine.substring(0, 2);
      result.isNewFile = statusCode === '??' || statusCode === 'A ';
      result.isDeleted = statusCode === ' D' || statusCode === 'D ';
      
      // If file is untracked, just return its content
      if (statusCode === '??') {
        this.logger.debug(`New untracked file: ${path}`);
        result.diff = await Deno.readTextFile(path);
        return result;
      }
      
      // Otherwise get the diff
      const diffArgs = ['diff'];
      if (cached) {
        diffArgs.push('--cached');
      }
      diffArgs.push(path);
      
      const diffCommand = new Deno.Command('git', {
        args: diffArgs,
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout } = await diffCommand.output();
      const diff = new TextDecoder().decode(stdout).trim();
      
      if (!diff && !result.isDeleted) {
        // If no diff but file has changes according to git status,
        // it might be staged without further modifications, so try the other mode
        if (cached) {
          // If we were looking at cached changes, now look at working copy
          return await this.getFileDiff(path, false);
        } else if (statusCode[0] !== ' ' && statusCode[0] !== '?') {
          // If we were looking at working copy, but changes are staged, look at staged
          return await this.getFileDiff(path, true);
        }
        
        // No changes found in either mode, return file content
        result.diff = await Deno.readTextFile(path);
        return result;
      }
      
      result.diff = diff;
      return result;
    } catch (error) {
      this.logger.error(`Error getting git diff for ${path}: ${error instanceof Error ? error.message : String(error)}`);
      
      // If we can't get the diff but the file exists, return its content
      try {
        return {
          path,
          diff: await Deno.readTextFile(path),
          isNewFile: true,
          isDeleted: false
        };
      } catch {
        // Re-throw the original error if we can't read the file
        throw error;
      }
    }
  }

  /**
   * Get git diff for multiple files
   * @param paths Array of file paths
   * @param staged Whether to get staged changes (defaults to false)
   * @returns Array of GitDiffResult objects
   */
  public async getMultipleFileDiffs(paths: string[], staged = false): Promise<GitDiffResult[]> {
    const results: GitDiffResult[] = [];
    
    for (const path of paths) {
      try {
        const diffResult = await this.getFileDiff(path, staged);
        results.push(diffResult);
      } catch (error) {
        this.logger.error(`Error getting diff for ${path}: ${error instanceof Error ? error.message : String(error)}`);
        // Continue with other files
      }
    }
    
    return results;
  }

  /**
   * Get the diff between two commits or refs
   * @param oldRef The old reference (commit, branch, etc)
   * @param newRef The new reference (defaults to HEAD)
   * @returns Git diff output
   */
  public async getDiffBetweenRefs(oldRef: string, newRef = 'HEAD'): Promise<string> {
    try {
      const command = new Deno.Command('git', {
        args: ['diff', oldRef, newRef],
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        throw new Error(`Git error: ${error}`);
      }
      
      return output;
    } catch (error) {
      this.logger.error(`Error getting diff between refs: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get a list of files changed between two commits or refs
   * @param oldRef The old reference (commit, branch, etc)
   * @param newRef The new reference (defaults to HEAD)
   * @returns Array of changed file paths
   */
  public async getChangedFilesBetweenRefs(oldRef: string, newRef = 'HEAD'): Promise<string[]> {
    try {
      const command = new Deno.Command('git', {
        args: ['diff', '--name-only', oldRef, newRef],
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        throw new Error(`Git error: ${error}`);
      }
      
      if (!output) {
        return [];
      }
      
      return output.split('\n').filter(path => path.trim().length > 0);
    } catch (error) {
      this.logger.error(`Error getting changed files between refs: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get the commit history
   * @param maxCount Maximum number of commits to return
   * @param path Optional path to get history for a specific file
   * @returns Array of commit objects
   */
  public async getCommitHistory(maxCount = 10, path?: string): Promise<Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
  }>> {
    try {
      const args = [
        'log',
        '--pretty=format:%H|%an|%ad|%s',
        `--max-count=${maxCount}`,
        '--date=iso'
      ];
      
      if (path) {
        args.push('--', path);
      }
      
      const command = new Deno.Command('git', {
        args,
        stdout: 'piped',
        stderr: 'piped',
        cwd: this.workingDirectory,
      });
      
      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const error = new TextDecoder().decode(stderr).trim();
      
      if (error) {
        throw new Error(`Git error: ${error}`);
      }
      
      if (!output) {
        return [];
      }
      
      return output.split('\n').map(line => {
        const [hash, author, date, message] = line.split('|');
        return { hash, author, date, message };
      });
    } catch (error) {
      this.logger.error(`Error getting commit history: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

