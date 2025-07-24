import { colors } from '@cliffy/ansi/colors';
import { logger } from '../../utils/logger.ts';
import { CommitInfo } from './types.ts';

/**
 * Run a command and return the output
 */
export async function runCommand(
  cmd: string[],
  options: Deno.CommandOptions = {},
): Promise<string> {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: 'piped',
    stderr: 'piped',
    ...options,
  });

  const { stdout, stderr, code } = await command.output();

  if (code !== 0) {
    const errorOutput = new TextDecoder().decode(stderr);
    throw new Error(`Command '${cmd.join(' ')}' failed with code ${code}: ${errorOutput}`);
  }

  return new TextDecoder().decode(stdout);
}

/**
 * Get the latest valid release tag (excluding alpha/beta/rc)
 */
export async function getLatestReleaseTag(): Promise<string> {
  try {
    // Get all tags
    const tagsOutput = await runCommand(['git', 'tag']);
    const tags = tagsOutput.trim().split('\n')
      // Filter out empty tags and alpha/beta tags
      .filter((tag) => {
        if (!tag) return false;

        // Skip any tags that start with alpha- or beta-
        if (tag.startsWith('alpha-') || tag.startsWith('beta-')) return false;

        // Skip any tags that include alpha/beta/rc in semver format
        if (tag.includes('-alpha.') || tag.includes('-beta.') || tag.includes('-rc.')) return false;

        // Accept tags that are pure semver (e.g., 0.3.3)
        if (/^\d+\.\d+\.\d+$/.test(tag)) return true;

        // Accept tags that are pure semver with v prefix (e.g., v0.3.3)
        if (/^v\d+\.\d+\.\d+$/.test(tag)) return true;

        return false;
      })
      // Sort tags by version number
      .sort((a, b) => {
        const versionA = a.replace(/^v/, '');
        const versionB = b.replace(/^v/, '');
        return versionB.localeCompare(versionA, undefined, { numeric: true });
      });

    if (!tags.length) {
      logger.passThrough('log', colors.yellow('No valid release tags found, using HEAD~100'));
      return 'HEAD~100';
    }

    const latestTag = tags[0];
    const version = latestTag.replace(/^v/, '');
    logger.passThrough('log', colors.dim(`Found latest release tag: ${version}`));
    return version;
  } catch (error) {
    logger.error(
      colors.red(
        `Error getting latest release tag: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      ),
    );
    return 'HEAD~100';
  }
}

/**
 * Check if a git tag already exists
 */
export async function checkIfTagExists(tagName: string): Promise<boolean> {
  try {
    const output = await runCommand(['git', 'tag', '-l', tagName]);
    return output.trim() === tagName;
  } catch (_error) {
    return false;
  }
}

/**
 * Check if there are uncommitted changes in the repository
 */
export async function checkIfChangesExist(): Promise<boolean> {
  try {
    const output = await runCommand(['git', 'status', '--porcelain']);
    return output.trim() !== '';
  } catch (error) {
    logger.error(
      colors.red(
        `Error checking git status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ),
    );
    return true; // Assume there are changes if we can't check
  }
}

/**
 * Get commits since the last release
 */
export async function getCommits(): Promise<CommitInfo[]> {
  try {
    // Get the last valid release tag
    const lastVersionRef = await getLatestReleaseTag();

    // Get commits since the last tag
    const output = await runCommand([
      'git',
      'log',
      `${lastVersionRef}..HEAD`,
      '--format=%H|%as|%s|%an',
    ]);

    if (!output.trim()) {
      return [];
    }

    // Parse commit info
    return output.trim().split('\n').map((line) => {
      const [hash, date, ...rest] = line.split('|');
      const author = rest.pop() || '';
      const message = rest.join('|');
      return { hash, date, message, author };
    });
  } catch (error) {
    logger.error(
      colors.red(
        `Error getting commits: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ),
    );
    return [];
  }
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(): string {
  try {
    const command = new Deno.Command('git', {
      args: ['branch', '--show-current'],
      stdout: 'piped',
    });
    const { stdout } = command.outputSync();
    return new TextDecoder().decode(stdout).trim();
  } catch (_error) {
    // Unable to determine branch
    return '';
  }
}

/**
 * Create a git tag and push changes
 */
export async function createTagAndPush(tagName: string, commitMsg: string): Promise<void> {
  // Check if tag already exists
  const tagExists = await checkIfTagExists(tagName);

  if (tagExists) {
    logger.passThrough(
      'log',
      colors.yellow(`Warning: Tag ${tagName} already exists. Skipping tag creation.`),
    );
    await runCommand(['git', 'add', '.']);
    await runCommand(['git', 'commit', '-m', commitMsg]);
    await runCommand(['git', 'push']);
  } else {
    await runCommand(['git', 'add', '.']);
    await runCommand(['git', 'commit', '-m', commitMsg]);
    await runCommand(['git', 'tag', '-a', tagName, '-m', `Release note ${tagName}`]);
    await runCommand(['git', 'push', '--follow-tags']);
  }
}

/**
 * Detect tag prefix from existing tags
 */
export async function detectTagPrefix(): Promise<string> {
  try {
    // Get all tags
    const tagsOutput = await runCommand(['git', 'tag']);
    const tags = tagsOutput.trim().split('\n').filter(Boolean);

    if (tags.length === 0) {
      return ''; // No tags, default to no prefix
    }

    // Count tags with different prefixes
    let vPrefixCount = 0;
    let noPrefixCount = 0;

    for (const tag of tags) {
      // Check if it's a valid semver tag (with or without v prefix)
      if (/^v\d+\.\d+\.\d+$/.test(tag)) {
        vPrefixCount++;
      } else if (/^\d+\.\d+\.\d+$/.test(tag)) {
        noPrefixCount++;
      }
    }

    // Return the most common prefix pattern
    if (vPrefixCount > noPrefixCount) {
      return 'v';
    }
    return '';
  } catch (_error) {
    return ''; // Default to no prefix if we can't detect
  }
}
