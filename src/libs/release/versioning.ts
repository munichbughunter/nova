import { colors } from '@cliffy/ansi/colors';
import { logger } from '../../utils/logger.ts';
import { getCurrentBranch, getLatestReleaseTag } from './git.ts';
import { CommitInfo, ReleaseConfig, VersionClassification, VersionType } from './types.ts';

/**
 * Get the current version from package.json or git tags
 */
export async function getCurrentVersion(): Promise<string> {
    try {
        // Try to get the most recent tag
        const version = await getLatestReleaseTag();
        return version;
    } catch (error) {
        logger.error(
            colors.red(
                `Error getting current version: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            ),
        );
        return '0.0.0'; // Default version if not found
    }
}

/**
 * Classify what type of version bump is needed based on commits
 */
export function classifyVersion(
    commits: CommitInfo[],
    config: ReleaseConfig,
): VersionClassification {
    if (commits.length === 0) {
        return { type: 'none', reason: 'No new commits since last release' };
    }

    // Check for breaking changes - major version bump
    const breakingChangeCommit = commits.find((commit) =>
        commit.message.includes('BREAKING CHANGE') ||
        commit.message.toLowerCase().includes('breaking:') ||
        commit.message.startsWith('feat!:') ||
        commit.message.startsWith('fix!:') ||
        commit.message.startsWith('!:')
    );

    if (breakingChangeCommit) {
        return {
            type: 'major',
            reason: `Contains breaking change: "${breakingChangeCommit.message}"`,
        };
    }

    // Check for new features - minor version bump
    const featureCommit = commits.find((commit) =>
        commit.message.startsWith('feat:') ||
        commit.message.startsWith('feat(')
    );

    if (featureCommit) {
        return {
            type: 'minor',
            reason: `Contains new feature: "${featureCommit.message}"`,
        };
    }

    // Check for fixes or other commits that would trigger a patch
    const fixCommit = commits.find((commit) =>
        commit.message.startsWith('fix:') ||
        commit.message.startsWith('fix(') ||
        commit.message.startsWith('perf:') ||
        commit.message.startsWith('perf(')
    );

    if (fixCommit) {
        return {
            type: 'patch',
            reason: `Contains bug fix: "${fixCommit.message}"`,
        };
    }

    // Check current branch to see if it's a prerelease branch
    const currentBranch = getCurrentBranch();
    if (
        currentBranch && config.prerelease.enabled &&
        config.branches.prerelease.includes(currentBranch)
    ) {
        return {
            type: 'prerelease',
            reason: `Current branch "${currentBranch}" is configured as a prerelease branch`,
        };
    }

    // Default to patch if there are any commits but none matched our patterns
    return {
        type: 'patch',
        reason: 'Contains changes that do not explicitly specify version bump',
    };
}

/**
 * Calculate the new version based on the current version and bump type
 */
export function getNewVersion(
    currentVersion: string,
    versionType: VersionType,
    config: ReleaseConfig,
): string {
    if (versionType === 'none') {
        return currentVersion;
    }

    const [major, minor, patch] = currentVersion.split('.').map(Number);

    switch (versionType) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        case 'prerelease': {
            // Get current branch to determine prerelease identifier
            const _currentBranch = getCurrentBranch();
            const prereleaseId = config.prerelease.tag || 'next';

            // Check if current version already has a prerelease component
            if (currentVersion.includes('-')) {
                const [baseVersion, prerelease] = currentVersion.split('-');
                const [prereleaseType, prereleaseNum] = prerelease.split('.');

                // If same type, increment number
                if (prereleaseType === prereleaseId) {
                    const nextNum = parseInt(prereleaseNum || '0', 10) + 1;
                    return `${baseVersion}-${prereleaseId}.${nextNum}`;
                }
            }

            // Start new prerelease
            return `${major}.${minor}.${patch}-${prereleaseId}.1`;
        }
        default:
            return currentVersion;
    }
}

/**
 * Update version in package.json or other version files
 */
export async function updateVersion(newVersion: string, _config: ReleaseConfig) {
    // Update package.json if it exists
    try {
        await Deno.stat('./package.json');
        const packageJson = JSON.parse(await Deno.readTextFile('./package.json'));
        packageJson.version = newVersion;
        await Deno.writeTextFile('./package.json', JSON.stringify(packageJson, null, 2) + '\n');
    } catch {
        // package.json doesn't exist, skip this step
    }

    // TODO: Handle other version files based on config
}
