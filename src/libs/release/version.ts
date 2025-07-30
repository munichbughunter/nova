import { parseCommitMessage } from './commit.ts';
import { runCommand } from './git.ts';
import type { CommitInfo, ReleaseConfig, VersionType } from './types.ts';

/**
 * Get current version from git tags
 */
export async function getCurrentVersion(): Promise<string> {
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
                if (tag.includes('-alpha.') || tag.includes('-beta.') || tag.includes('-rc.')) {
                    return false;
                }

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

        // Get the latest tag
        const latestTag = tags[0];
        if (latestTag) {
            return latestTag.replace(/^v/, '');
        }

        // If no valid tags found, return initial version
        return '0.1.0';
    } catch (_error) {
        // If no tags exist, return initial version
        return '0.1.0';
    }
}

/**
 * Get new version based on current version and bump type
 */
export function getNewVersion(
    currentVersion: string,
    bumpType: VersionType,
    config: ReleaseConfig,
): string {
    // TODO: use data from config to correctly handle versioning
    const { _prerelease } = config;
    // Ensure we have a valid version string
    if (!currentVersion || !currentVersion.match(/^\d+\.\d+\.\d+$/)) {
        return '0.1.0';
    }

    // Split version into parts
    const [major, minor, patch] = currentVersion.split('.').map(Number);

    // Validate all parts are actual numbers
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
        return '0.1.0';
    }

    switch (bumpType) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        case 'none':
            return currentVersion;
        default:
            return `${major}.${minor}.${patch + 1}`;
    }
}

/**
 * Classify version bump type based on commits
 */
export function classifyVersion(
    commits: CommitInfo[],
    _config: ReleaseConfig,
): { type: VersionType; reason: string } {
    // Default to no version bump
    let type: VersionType = 'none';
    let reason = 'No changes detected that would trigger a version bump';

    // Skip if no commits
    if (!commits.length) {
        return { type, reason };
    }

    // Analyze each commit
    for (const commit of commits) {
        const { type: commitType } = parseCommitMessage(commit.message);

        // Skip release commits and sync commits
        if (
            commitType === 'none' ||
            commit.message.startsWith('chore(sync-back):') ||
            commit.message.includes('[skip ci]')
        ) {
            continue;
        }

        // Determine version bump type based on commit type
        switch (commitType) {
            case 'breaking':
                return {
                    type: 'major',
                    reason: `Breaking change detected in commit: ${commit.message}`,
                };
            case 'feature':
                if (type === 'none' || type === 'patch') {
                    type = 'minor';
                    reason = `New feature detected in commit: ${commit.message}`;
                }
                break;
            case 'fix':
                if (type === 'none') {
                    type = 'patch';
                    reason = `Bug fix detected in commit: ${commit.message}`;
                }
                break;
            case 'performance':
                if (type === 'none') {
                    type = 'patch';
                    reason = `Performance improvement detected in commit: ${commit.message}`;
                }
                break;
            default:
                // For other types (docs, style, refactor, etc.), only bump if no other changes
                if (type === 'none') {
                    type = 'patch';
                    reason = `Changes detected in commit: ${commit.message}`;
                }
                break;
        }
    }

    return { type, reason };
}
