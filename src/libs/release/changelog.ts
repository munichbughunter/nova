import { ensureFile } from '@std/fs/ensure-file';
import { runCommand } from './git.ts';
import { BadgeStyle, BadgeType, CommitInfo, ImpactThresholds, ReleaseConfig } from './types.ts';

/**
 * Format commit message for changelog
 */
export function formatCommitMessage(message: string): string {
  // Remove the type prefix (e.g., "feat: " or "fix(core): ")
  return message.replace(
    /^(feat|fix|perf|chore|docs|style|refactor|test|ci|build)(\([^)]+\))?!?:\s*/i,
    '',
  );
}

/**
 * Create a badge with the given label, value, and color
 */
export function generateBadge(
  label: string,
  value: string,
  color: string,
  style: BadgeStyle = 'flat-square',
  type: BadgeType = 'md',
): string {
  // Encode values for URL
  const encodedLabel = encodeURIComponent(label);
  const encodedValue = encodeURIComponent(value);

  if (type === 'html') {
    return `<img src="https://img.shields.io/badge/${encodedLabel}-${encodedValue}-${color}?style=${style}" alt="${label} badge" class="rounded-[6px]"/>`;
  } else {
    return `![${label}](https://img.shields.io/badge/${encodedLabel}-${encodedValue}-${color}?style=${style})`;
  }
}

/**
 * Generate a badge based on the number of modified files
 */
export function getImpactBadge(
  modifiedFiles: number,
  thresholds?: ImpactThresholds,
  badgeStyle: BadgeStyle = 'flat-square',
  type: BadgeType = 'md',
): string {
  const defaultThresholds = thresholds || { low: 1, medium: 5, high: 10 };

  if (modifiedFiles <= defaultThresholds.low) {
    return generateBadge('impact', 'low', 'green', badgeStyle, type);
  } else if (modifiedFiles <= defaultThresholds.medium) {
    return generateBadge('impact', 'medium', 'yellow', badgeStyle, type);
  } else {
    return generateBadge('impact', 'high', 'red', badgeStyle, type);
  }
}

/**
 * Get committer information from the email and author
 */
export function getCommitterInfo(email?: string, author?: string): {
  name: string;
  image: string;
} {
  const emailParts = email?.split('@') || [''];
  const name = author || emailParts[0];
  return {
    name,
    image: getCommitterImage(name),
  };
}

/**
 * Get the committer image from the username
 */
export function getCommitterImage(username: string): string {
  // Use GitLab avatar URL
  const gitlabInstance = 'gitlab.com';
  const encodedUsername = username.toLowerCase().split(' ')[0].replace(/[^a-z0-9-]/g, '');
  return `https://${gitlabInstance}/avatar/${encodedUsername}?size=32`;
}

/**
 * Get Git repository remote URL
 */
async function getRepoUrl(): Promise<string> {
  try {
    const remoteOutput = await runCommand(['git', 'remote', 'get-url', 'origin']);
    const url = remoteOutput.trim();

    // Convert SSH URL to HTTPS URL if needed
    if (url.startsWith('git@')) {
      // Example: git@github.com:org/repo.git -> https://github.com/org/repo
      const match = url.match(/git@([^:]+):(.+)\.git$/);
      if (match) {
        const [, host, path] = match;
        return `https://${host}/${path}`;
      }
    }

    // Remove .git suffix if present
    return url.replace(/\.git$/, '');
  } catch (_error) {
    // Return a placeholder if we can't get the repo URL
    return '#';
  }
}

/**
 * Get previous version tag for comparison link
 */
async function getPreviousVersion(version: string, config: ReleaseConfig): Promise<string | null> {
  try {
    // Get all tags sorted by version
    const tagsOutput = await runCommand(['git', 'tag', '--sort=-v:refname']);
    const tags = tagsOutput.trim().split('\n')
      // Filter out alpha and beta tags
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
      });

    // If current version is alpha/beta and we have no valid previous version, return null
    if (version.includes('alpha-') || version.includes('beta-')) {
      return null;
    }

    // Find current version index using the configured prefix
    const tagPrefix = config.tagPrefix || '';
    const currentVersionTag = `${tagPrefix}${version}`;
    const currentIndex = tags.findIndex((tag) => tag === currentVersionTag);

    if (currentIndex !== -1 && currentIndex < tags.length - 1) {
      // Return next tag (which is previous version since we sorted in reverse)
      return tags[currentIndex + 1].replace(new RegExp(`^${tagPrefix}`), '');
    }

    return null;
  } catch (_error) {
    return null;
  }
}

/**
 * Get the creation date of a git tag
 */
async function getTagDate(tag: string): Promise<string> {
  try {
    const output = await runCommand(['git', 'log', '-1', '--format=%aI', tag]);
    return output.trim().split('T')[0];
  } catch (_error) {
    // If we can't get the tag date, fall back to current date
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Get all version tags sorted by version
 */
async function getAllVersionTags(config?: ReleaseConfig): Promise<string[]> {
  try {
    const tagPrefix = config?.tagPrefix || '';
    const tagsOutput = await runCommand(['git', 'tag', '--sort=v:refname']);
    return tagsOutput.trim().split('\n')
      .filter((tag) => {
        if (!tag) return false;

        // Skip any tags that start with alpha- or beta-
        if (tag.startsWith('alpha-') || tag.startsWith('beta-')) return false;

        // Skip any tags that include alpha/beta/rc in semver format
        if (tag.includes('-alpha.') || tag.includes('-beta.') || tag.includes('-rc.')) return false;

        // Accept tags that are pure semver (e.g., 0.3.3)
        if (/^\d+\.\d+\.\d+$/.test(tag)) return true;

        // Accept tags with the configured prefix (e.g., v0.3.3)
        if (new RegExp(`^${tagPrefix}\\d+\\.\\d+\\.\\d+$`).test(tag)) return true;

        return false;
      })
      .map((tag) => tag.replace(new RegExp(`^${tagPrefix}`), ''))
      .sort((a, b) => {
        const [majorA, minorA, patchA] = a.split('.').map(Number);
        const [majorB, minorB, patchB] = b.split('.').map(Number);

        // Compare major versions first
        if (majorA !== majorB) return majorA - majorB;

        // If major versions are equal, compare minor versions
        if (minorA !== minorB) return minorA - minorB;

        // If minor versions are equal, compare patch versions
        return patchA - patchB;
      });
  } catch (_error) {
    return [];
  }
}

/**
 * Get commits between two tags
 */
export async function getCommitsBetweenTags(
  fromTag: string | null,
  toTag: string,
  config?: ReleaseConfig,
): Promise<CommitInfo[]> {
  const tagPrefix = config?.tagPrefix || '';
  const fromTagWithPrefix = fromTag ? `${tagPrefix}${fromTag}` : null;
  const toTagWithPrefix = `${tagPrefix}${toTag}`;

  const range = fromTagWithPrefix ? `${fromTagWithPrefix}^..${toTagWithPrefix}` : toTagWithPrefix;
  const output = await runCommand([
    'git',
    'log',
    '--pretty=format:%H%x1f%an%x1f%ae%x1f%s%x1f%aI',
    range,
  ]);
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash, author, email, message, date] = line.split('\u001f');
      return { hash, author, email, message, date };
    });
}

/**
 * Get initial commits before first tag
 */
async function getInitialCommits(config?: ReleaseConfig): Promise<CommitInfo[]> {
  try {
    // Get the first tag
    const tags = await getAllVersionTags(config);
    if (!tags.length) return [];

    const firstTag = tags[0];
    const tagPrefix = config?.tagPrefix || '';

    // Get all commits before the first tag
    const logOutput = await runCommand([
      'git',
      'log',
      '--pretty=format:%H%x1f%an%x1f%ae%x1f%s%x1f%aI',
      `${tagPrefix}${firstTag}`,
    ]);

    if (!logOutput.trim()) {
      return [];
    }

    // Get the date of the first commit in the repository
    const firstCommitDate = await runCommand([
      'git',
      'rev-list',
      '--max-parents=0',
      'HEAD',
      '--format=%aI',
    ]);
    // The output will have the commit hash on first line and date on second line
    const firstDate = firstCommitDate.trim().split('\n')[1];

    return logOutput.trim().split('\n').map((line) => {
      const [hash, author, email, message] = line.split('\x1f');
      // Use the first commit date for all initial commits
      return { hash, author, email, message, date: firstDate };
    });
  } catch (_error) {
    return [];
  }
}

/**
 * Generate release notes for the new version
 */
export async function generateReleaseNotes(
  version: string,
  commits: CommitInfo[],
  config: ReleaseConfig,
): Promise<string> {
  const tagPrefix = config.tagPrefix || '';
  const tagName = `${tagPrefix}${version}`;

  // For initial version (0.1.0), get the date of the first commit in the repository
  let date;
  if (version === '0.1.0') {
    const firstCommitDate = await runCommand([
      'git',
      'rev-list',
      '--max-parents=0',
      'HEAD',
      '--format=%aI',
    ]);
    // The output will have the commit hash on first line and date on second line
    date = firstCommitDate.trim().split('\n')[1].split('T')[0];
  } else {
    date = await getTagDate(tagName);
  }

  const repoUrl = await getRepoUrl();
  const previousVersion = await getPreviousVersion(version, config);

  let notes = '';

  // Add version header with comparison link if previous version is available
  if (previousVersion) {
    notes +=
      `## [${version}](${repoUrl}/compare/${tagPrefix}${previousVersion}...${tagPrefix}${version}) (${date})\n\n`;
  } else {
    notes += `## [${version}](${repoUrl}/releases/tag/${tagPrefix}${version}) (${date})\n\n`;
  }

  // Add badges if explicitly enabled
  if (config.changelog.badges?.enabled === true) {
    const badgeConfig = config.changelog.badges || {
      style: 'flat-square' as BadgeStyle,
      type: 'md' as BadgeType,
      includeStatBadges: true,
      includeTypeBadges: true,
      includeImpactBadges: true,
    };

    const badgeStyle = badgeConfig.style || 'flat-square';
    const badgeType = badgeConfig.type || 'md';

    if (badgeConfig.includeStatBadges) {
      const totalCommits = commits.length;
      const uniqueAuthors = new Set(commits.map((c) => c.author)).size;

      notes += generateBadge('version', version, 'blue', badgeStyle, badgeType) + ' ';
      notes +=
        generateBadge('commits', totalCommits.toString(), 'brightgreen', badgeStyle, badgeType) +
        ' ';
      notes +=
        generateBadge('contributors', uniqueAuthors.toString(), 'orange', badgeStyle, badgeType) +
        '\n\n';
    }
  }

  if (commits.length === 0) {
    notes += '* No changes in this release\n';
    return notes;
  }

  // Group commits by type
  const breaking = commits.filter((c) =>
    c.message.includes('BREAKING CHANGE') ||
    c.message.toLowerCase().includes('breaking:') ||
    c.message.startsWith('feat!:') ||
    c.message.startsWith('fix!:') ||
    c.message.startsWith('!:')
  );

  const features = commits.filter((c) =>
    c.message.startsWith('feat:') ||
    c.message.startsWith('feat(')
  );

  const fixes = commits.filter((c) =>
    c.message.startsWith('fix:') ||
    c.message.startsWith('fix(')
  );

  const performance = commits.filter((c) =>
    c.message.startsWith('perf:') ||
    c.message.startsWith('perf(')
  );

  const other = commits.filter((c) =>
    !breaking.includes(c) &&
    !features.includes(c) &&
    !fixes.includes(c) &&
    !performance.includes(c)
  );

  // Helper function to format commit with scope and ticket
  function formatCommitWithScope(commit: CommitInfo): string {
    const message = commit.message;

    // Extract scope if present (e.g., feat(ComponentName):)
    const scopeMatch = message.match(
      /^(feat|fix|perf|chore|docs|style|refactor|test|ci|build)\(([^)]+)\):/,
    );
    const scope = scopeMatch ? `**${scopeMatch[2]}:** ` : '';

    // Extract ticket ID (e.g., PUB-1234)
    const ticketMatch = message.match(/([A-Z]+-\d+)/);
    const ticket = ticketMatch ? ticketMatch[1] : null;

    // Format the main message
    const cleanMessage = formatCommitMessage(message);

    // Create the commit link
    const commitLink = `[${commit.hash.substring(0, 7)}](${repoUrl}/commit/${commit.hash})`;

    // Create the ticket link if present
    const ticketLink = ticket
      ? `, closes [${ticket}](https://atlassian.net/browse/${ticket})`
      : '';

    return `* ${scope}${cleanMessage} (${commitLink})${ticketLink}`;
  }

  // Add breaking changes
  if (breaking.length > 0) {
    notes += '### Breaking Changes\n\n';
    breaking.forEach((commit) => {
      notes += formatCommitWithScope(commit) + '\n';
    });
    notes += '\n';
  }

  // Add features
  if (features.length > 0) {
    notes += '### Features\n\n';
    features.forEach((commit) => {
      notes += formatCommitWithScope(commit) + '\n';
    });
    notes += '\n';
  }

  // Add fixes
  if (fixes.length > 0) {
    notes += '### Bug fixes\n\n';
    fixes.forEach((commit) => {
      notes += formatCommitWithScope(commit) + '\n';
    });
    notes += '\n';
  }

  // Add performance improvements
  if (performance.length > 0) {
    notes += '### Performance Improvements\n\n';
    performance.forEach((commit) => {
      notes += formatCommitWithScope(commit) + '\n';
    });
    notes += '\n';
  }

  // Add other changes
  if (other.length > 0) {
    notes += '### Misc changes\n\n';
    other.forEach((commit) => {
      notes += formatCommitWithScope(commit) + '\n';
    });
    notes += '\n';
  }

  // Add AI Review section if enabled and there are significant changes
  const significantChanges = [...breaking, ...features, ...fixes.slice(0, 3)];
  if (significantChanges.length > 0) {
    notes += '### AI Review\n\n';
    notes += '#### Key Changes\n\n';

    significantChanges.forEach((commit) => {
      const message = formatCommitMessage(commit.message);
      notes += `- ${commit.hash.substring(0, 7)}: ${message}\n`;

      // Add AI-generated analysis (placeholder)
      if (features.includes(commit) || breaking.includes(commit)) {
        notes += '  \n  ';
        notes += `  Impact: This change affects ${message.toLowerCase()}.\n`;
        notes += '  Additional context would be generated by AI.\n\n';
      }
    });
  }

  // Add a contributor section if enabled
  if (config.changelog.includeContributors === true) {
    const contributors = new Map<string, number>();
    commits.forEach((commit) => {
      const count = contributors.get(commit.author) || 0;
      contributors.set(commit.author, count + 1);
    });

    if (contributors.size > 0) {
      notes += '### Contributors\n\n';
      for (const [author, count] of contributors.entries()) {
        notes += `* ${author} - ${count} commit${count > 1 ? 's' : ''}\n`;
      }
    }
  }

  return notes;
}

/**
 * Write changelog file
 */
export async function writeChangelog(releaseNotes: string, config: ReleaseConfig): Promise<void> {
  const changelogPath = config.changelog.path || 'CHANGELOG.md';

  // Ensure the changelog file exists (create directory structure if needed)
  await ensureFile(changelogPath);

  // Check if changelog exists
  let existingContent = '';
  try {
    existingContent = await Deno.readTextFile(changelogPath);
  } catch {
    // File doesn't exist or can't be read, continue with empty content
  }

  // Prepend new release notes
  const newContent = releaseNotes + (existingContent ? '\n\n' + existingContent : '');
  await Deno.writeTextFile(changelogPath, newContent);
}

/**
 * Regenerate the entire changelog from git history
 */
export async function regenerateFullChangelog(config: ReleaseConfig): Promise<void> {
  // Get all version tags
  const versions = await getAllVersionTags(config);

  if (versions.length === 0) {
    throw new Error('No version tags found in repository');
  }

  let fullChangelog = '';

  // Generate changelog for each version
  for (let i = versions.length - 1; i >= 0; i--) {
    const version = versions[i];
    const previousVersion = i > 0 ? versions[i - 1] : null;

    // Get commits for this version
    const commits = await getCommitsBetweenTags(
      previousVersion ? previousVersion : null,
      version,
      config,
    );

    // Generate release notes for this version
    const notes = await generateReleaseNotes(version, commits, config);
    fullChangelog += notes + (i > 0 ? '\n' : ''); // Add newline between versions except for the last one
  }

  // Add initial commits if any
  const initialCommits = await getInitialCommits(config);
  if (initialCommits.length > 0) {
    const notes = await generateReleaseNotes('0.1.0', initialCommits, config);
    fullChangelog += '\n' + notes;
  }

  // Write the complete changelog
  await Deno.writeTextFile('CHANGELOG.md', fullChangelog);
}
