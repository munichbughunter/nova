/**
 * Release library for nova CLI
 *
 * Provides functionality for semantic versioning, changelog generation,
 * and release management.
 */

// Re-export types and functions from modules
export * from './changelog.ts';
export * from './config.ts';
export * from './git.ts';
export * from './versioning.ts';

// Check if running in a CI environment
export function isRunningInCI(): boolean {
    return Boolean(
        Deno.env.get('CI') ||
            Deno.env.get('GITLAB_CI') ||
            Deno.env.get('GITHUB_ACTIONS'),
    );
}
