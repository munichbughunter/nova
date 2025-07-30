import { Command } from '@cliffy/command';
import { Confirm, Select } from '@cliffy/prompt';
import { configManager } from '../config/mod.ts';
import { formatError, formatInfo, formatSuccess, ProgressIndicator, theme } from '../utils.ts';
import { logger } from '../utils/logger.ts';

interface GitLabRelease {
    tag_name: string;
    name: string;
    description: string;
    created_at: string;
    assets: {
        links: Array<{
            name: string;
            url: string;
            direct_asset_url: string;
        }>;
    };
}

async function getCurrentVersion(): Promise<string> {
    const version = new Deno.Command('nova', {
        args: ['--version'],
        stdout: 'piped',
    });
    const { stdout } = await version.output();
    const output = new TextDecoder().decode(stdout).trim();
    // Extract just the version number (e.g., "0.x.x" from "nova 0.x.x")
    return output.split(' ').pop() || '0.0.0';
}

interface ReleaseChannels {
    stable: GitLabRelease | null;
    beta: GitLabRelease | null;
    alpha: GitLabRelease | null;
}

async function getLatestReleases(): Promise<ReleaseChannels> {
    const config = await configManager.loadConfig();
    if (!config.gitlab?.url || !config.gitlab?.token) {
        throw new Error('GitLab configuration not found. Please run `nova setup` first.');
    }

    try {
        const projectId = '4788'; // This is hardcoded for now
        const [stableResponse, betaResponse, alphaResponse] = await Promise.all([
            // Get latest stable release (from tags)
            fetch(
                `${config.gitlab.url}/api/v4/projects/${projectId}/releases/permalink/latest`,
                {
                    headers: {
                        'PRIVATE-TOKEN': config.gitlab.token,
                    },
                },
            ),
            // Get latest beta release (from main branch)
            fetch(
                `${config.gitlab.url}/api/v4/projects/${projectId}/releases?per_page=1&ref_name=main`,
                {
                    headers: {
                        'PRIVATE-TOKEN': config.gitlab.token,
                    },
                },
            ),
            // Get latest alpha release (from merge requests)
            fetch(
                `${config.gitlab.url}/api/v4/projects/${projectId}/releases?per_page=1&order_by=created_at&sort=desc`,
                {
                    headers: {
                        'PRIVATE-TOKEN': config.gitlab.token,
                    },
                },
            ),
        ]);

        const stable = stableResponse.ok ? await stableResponse.json() as GitLabRelease : null;
        const betaReleases = betaResponse.ok ? await betaResponse.json() as GitLabRelease[] : [];
        const alphaReleases = alphaResponse.ok ? await alphaResponse.json() as GitLabRelease[] : [];

        // Filter alpha releases to only include those from merge requests
        const alpha = alphaReleases.find((r) => r.tag_name.startsWith('alpha-mr-')) || null;
        // Filter beta releases to only include those from main branch
        const beta = betaReleases.find((r) => r.tag_name.startsWith('beta-')) || null;

        return { stable, beta, alpha };
    } catch (error) {
        logger.error('Error fetching releases:', error);
        return { stable: null, beta: null, alpha: null };
    }
}

function isHomebrewInstall(): boolean {
    const execPath = Deno.execPath();
    return execPath.startsWith('/opt/homebrew') || execPath.startsWith('/usr/local/Cellar');
}

async function downloadAndInstallUpdate(
    release: GitLabRelease,
    channel: 'stable' | 'beta' | 'alpha',
): Promise<boolean> {
    // For stable channel, recommend using Homebrew
    if (isHomebrewInstall() && channel === 'stable') {
        throw new Error(
            'nova was installed via Homebrew. For stable versions, please update using:\n' +
                'brew update && brew upgrade nova',
        );
    }

    const config = await configManager.loadConfig();
    if (!config.gitlab?.token) {
        throw new Error('GitLab token not found');
    }

    // Determine which binary to download based on OS and architecture
    const platform = Deno.build.os;
    const arch = Deno.build.arch;

    let binaryName = '';
    if (platform === 'darwin') {
        binaryName = arch === 'aarch64' ? 'nova-macos-arm64' : 'nova-macos';
    } else if (platform === 'linux') {
        binaryName = arch === 'aarch64' ? 'nova-linux-arm64' : 'nova-linux';
    } else if (platform === 'windows') {
        binaryName = 'nova.exe';
    } else {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    // Determine the package registry URL based on the channel
    const packageName = channel === 'stable' ? 'nova' : `nova-${channel}`;
    const packageVersion = channel === 'stable'
        ? release.tag_name
        : release.tag_name.split('-').pop() || '';

    // Find the correct asset link
    const asset = release.assets.links.find((link) => {
        // For stable releases, use the direct asset URL
        if (channel === 'stable') return link.name === binaryName;

        // For alpha/beta releases, construct the expected URL pattern
        const expectedUrl =
            `${config.gitlab?.url}/api/v4/projects/4788/packages/generic/${packageName}/${packageVersion}/${binaryName}`;
        return link.url === expectedUrl;
    });

    if (!asset) {
        throw new Error(`Binary not found for your platform (${platform}-${arch})`);
    }

    const progress = new ProgressIndicator();
    progress.start(`Downloading ${channel} update`);

    try {
        // Download the binary
        const response = await fetch(asset.direct_asset_url, {
            headers: {
                'PRIVATE-TOKEN': config.gitlab.token,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to download update: ${response.statusText}`);
        }

        // Read the binary data
        const data = new Uint8Array(await response.arrayBuffer());

        // Get the path to the current binary
        const currentBinaryPath = Deno.execPath();

        // For alpha/beta versions, we'll try to update even if it's a Homebrew install
        try {
            // Create a backup of the current binary with channel suffix
            const backupPath = `${currentBinaryPath}.${channel}.backup`;
            await Deno.copyFile(currentBinaryPath, backupPath);

            // Write the new binary
            await Deno.writeFile(currentBinaryPath, data);

            // Make it executable
            await Deno.chmod(currentBinaryPath, 0o755);

            progress.stop();
            return true;
        } catch (error) {
            if (error instanceof Deno.errors.PermissionDenied) {
                // If we get a permission error, try with sudo
                progress.stop();
                formatInfo(
                    '\nNeed elevated privileges to update the binary. Please enter your password when prompted.\n',
                );

                // Create temporary file for the new binary
                const tempPath = await Deno.makeTempFile();
                await Deno.writeFile(tempPath, data);
                await Deno.chmod(tempPath, 0o755);

                // Use sudo to move the file
                const moveCmd = new Deno.Command('sudo', {
                    args: ['mv', tempPath, currentBinaryPath],
                });

                const { success } = await moveCmd.output();

                // Clean up temp file if move failed
                if (!success) {
                    await Deno.remove(tempPath);
                    throw new Error('Failed to update binary with sudo');
                }

                return true;
            }
            throw error;
        }
    } catch (error) {
        progress.stop();
        logger.error('Error installing update:', error);
        return false;
    }
}

function compareVersions(v1: string, v2: string): number {
    const normalize = (v: string) => v.replace(/^v/, '');
    const v1Parts = normalize(v1).split('.').map(Number);
    const v2Parts = normalize(v2).split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;
        if (v1Part > v2Part) return 1;
        if (v1Part < v2Part) return -1;
    }
    return 0;
}

export const updateCommand = new Command()
    .name('update')
    .description('Check for updates and install if available')
    .option('--channel <channel:string>', 'Release channel to use (stable, beta, alpha)', {
        default: 'stable',
    })
    .action(async (options) => {
        try {
            const currentVersion = await getCurrentVersion();
            formatInfo(`Current version: ${currentVersion}`);

            const progress = new ProgressIndicator();
            progress.start('Checking for updates');

            const { stable, beta, alpha } = await getLatestReleases();
            progress.stop();

            if (!stable && !beta && !alpha) {
                formatInfo('No releases found.');
                return;
            }

            const updates = [];

            if (stable && compareVersions(currentVersion, stable.tag_name) < 0) {
                updates.push({
                    name: `${theme.symbols.success} Stable ${stable.tag_name}`,
                    value: { release: stable, channel: 'stable' as const },
                    description: stable.description || 'No release notes available.',
                });
            }

            if (beta && (!stable || beta.created_at > stable.created_at)) {
                updates.push({
                    name: `${theme.symbols.warning} Beta ${beta.tag_name}`,
                    value: { release: beta, channel: 'beta' as const },
                    description: beta.description || 'No release notes available.',
                });
            }

            if (alpha && (!beta || alpha.created_at > beta.created_at)) {
                updates.push({
                    name: `${theme.symbols.error} Alpha ${alpha.tag_name}`,
                    value: { release: alpha, channel: 'alpha' as const },
                    description: alpha.description || 'No release notes available.',
                });
            }

            if (updates.length === 0) {
                formatSuccess('You are using the latest version!');
                return;
            }

            // Filter updates based on selected channel
            const filteredUpdates = updates.filter((update) => {
                if (options.channel === 'stable') return update.value.channel === 'stable';
                if (options.channel === 'beta') {
                    return ['stable', 'beta'].includes(update.value.channel);
                }
                return true; // alpha channel shows all updates
            });

            if (filteredUpdates.length === 0) {
                formatSuccess(`No updates available in the ${options.channel} channel!`);
                return;
            }

            logger.passThrough('log', '\nAvailable updates:');
            const selected = await Select.prompt<
                { release: GitLabRelease; channel: 'stable' | 'beta' | 'alpha' }
            >({
                message: 'Choose a version to install:',
                options: filteredUpdates,
                info: true,
            });

            if (selected.channel !== 'stable') {
                const confirmed = await Confirm.prompt({
                    message:
                        `Warning: You are about to install a ${selected.channel} release. These releases may be unstable. Continue?`,
                    default: false,
                });

                if (!confirmed) {
                    formatInfo('Update cancelled.');
                    return;
                }
            }

            const shouldUpdate = await Confirm.prompt({
                message: 'Would you like to update now?',
                default: true,
            });

            if (!shouldUpdate) {
                formatInfo('Update cancelled.');
                return;
            }

            const success = await downloadAndInstallUpdate(selected.release, selected.channel);
            if (success) {
                formatSuccess(
                    `Successfully updated to ${selected.channel} version ${selected.release.tag_name}`,
                );
                formatInfo('Please restart nova to use the new version.');
            } else {
                formatError('Failed to install update.');
            }
        } catch (error) {
            formatError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
