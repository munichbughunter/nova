import { ensureFile } from '@std/fs/ensure-file';
import { novaConfig, ReleaseConfig } from './types.ts';
/**
 * Convert novaConfig to ReleaseConfig
 */
export function toReleaseConfig(config: novaConfig): ReleaseConfig {
    const defaultConfig = {
        branches: {
            main: ['main', 'master'],
            prerelease: ['next', 'beta', 'alpha'],
        },
        prerelease: {
            enabled: false,
            tag: 'next',
        },
        tagPrefix: '',
        blockIfChangesExist: false,
        autoCommit: true,
        commitMessage: 'chore: release ${version} [CI SKIP]',
        changelog: {
            enabled: true,
            path: 'CHANGELOG.md',
            badges: {
                enabled: false,
                style: 'flat-square',
                type: 'md',
                includeStatBadges: true,
                includeTypeBadges: true,
                includeImpactBadges: true,
            },
            includeContributors: false,
        },
        gitlab: {
            enabled: false,
            createRelease: false,
        },
    };

    const release = config.release || {};

    return {
        ...defaultConfig,
        ...release,
        changelog: {
            ...defaultConfig.changelog,
            ...release.changelog,
            badges: {
                ...defaultConfig.changelog.badges,
                ...release.changelog?.badges,
            },
        },
    };
}

/**
 * Create default release configuration
 */
export async function createDefaultReleaseConfig(tagPrefix = ''): Promise<void> {
    const config: novaConfig = {
        release: {
            branches: {
                main: ['main', 'master'],
                prerelease: ['next', 'beta', 'alpha'],
            },
            prerelease: {
                enabled: false,
                tag: 'next',
            },
            tagPrefix,
            blockIfChangesExist: true,
            autoCommit: true,
            commitMessage: 'chore: release ${version} [CI SKIP]',
            changelog: {
                enabled: true,
                path: 'CHANGELOG.md',
                badges: {
                    enabled: false,
                    style: 'flat-square',
                    type: 'md',
                    includeStatBadges: true,
                    includeTypeBadges: true,
                    includeImpactBadges: true,
                },
                includeContributors: false,
            },
            gitlab: {
                enabled: false,
                createRelease: false,
            },
        },
    };

    await ensureFile('./nova.json');
    await Deno.writeTextFile('./nova.json', JSON.stringify(config, null, 2));
}

/**
 * Load release configuration
 */
export async function loadReleaseConfig(): Promise<ReleaseConfig> {
    try {
        const configText = await Deno.readTextFile('./nova.json');
        const novaConfig = JSON.parse(configText) as novaConfig;
        return toReleaseConfig(novaConfig);
    } catch (error) {
        throw new Error(
            `Failed to load release config: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        );
    }
}

/**
 * Check if the repository already uses semantic release
 */
export async function checkExistingSemanticRelease(): Promise<boolean> {
    // Check for common semantic release config files
    for (
        const configFile of [
            './.releaserc',
            './.releaserc.json',
            './.releaserc.js',
            './release.config.js',
        ]
    ) {
        try {
            await Deno.stat(configFile);
            return true;
        } catch {
            // File doesn't exist, continue checking
        }
    }

    // Check package.json for semantic-release config
    try {
        await Deno.stat('./package.json');
        const packageJson = JSON.parse(await Deno.readTextFile('./package.json'));
        return (
            packageJson.release !== undefined ||
            packageJson['semantic-release'] !== undefined ||
            (packageJson.devDependencies &&
                packageJson.devDependencies['semantic-release'] !== undefined)
        );
    } catch {
        // package.json doesn't exist or is invalid
    }

    return false;
}

/**
 * Convert existing semantic release config to nova.json
 */
export async function convertTonovaConfig(): Promise<void> {
    // TODO: Implement conversion from various semantic-release formats to nova.json
    // This will require parsing different config formats and mapping them to our schema

    // For now, create a default config
    await createDefaultReleaseConfig();
}
