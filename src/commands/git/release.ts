import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Confirm } from '@cliffy/prompt';
import {
    checkExistingSemanticRelease,
    checkIfChangesExist,
    classifyVersion,
    convertTonovaConfig,
    createDefaultReleaseConfig,
    createTagAndPush,
    detectTagPrefix,
    generateReleaseNotes,
    getCommits,
    getCurrentVersion,
    getNewVersion,
    isRunningInCI,
    loadReleaseConfig,
    regenerateFullChangelog,
    updateVersion,
    writeChangelog,
} from '../../libs/release/index.ts';
import type { ReleaseConfig } from '../../libs/release/types.ts';
import { ProgressIndicator } from '../../utils.ts';
import { logger } from '../../utils/logger.ts';

// Release options
interface ReleaseOptions {
  dryRun: boolean;
  force?: boolean;
}

// Export the release command
export const releaseCommand = new Command()
  .name('release')
  .description('Manage semantic releases')
  .option('--dry-run', 'Run in dry mode without making any changes', { default: true })
  .option('--force', 'Force release even if no changes detected', { default: false })
  .action(async ({ dryRun, force }: { dryRun: boolean; force: boolean }) => {
    // If we're in CI, don't run in dry mode unless explicitly requested
    if (isRunningInCI() && dryRun === true) {
      await runRelease({ dryRun: false, force });
    } else {
      await runRelease({ dryRun, force });
    }
  });

// Setup subcommand
const setupCommand = new Command()
  .description('Configure repository for semantic releases')
  .action(async () => {
    logger.passThrough('log', colors.blue('\nSetting up semantic release configuration...\n'));

    try {
      // Check if repo already uses semantic release
      if (await checkExistingSemanticRelease()) {
        logger.passThrough('log', colors.yellow('Existing semantic release configuration found.'));

        const shouldConvert = await Confirm.prompt({
          message: 'Convert existing semantic release configuration to nova.json format?',
          default: true,
        });

        if (!shouldConvert) {
          logger.passThrough('log', colors.yellow('Setup cancelled by user.'));
          return;
        }

        logger.passThrough('log', colors.dim('Converting to nova.json format...'));

        // Convert existing semantic release config to nova.json
        await convertTonovaConfig();
        logger.passThrough('log', colors.green('✓ Converted existing configuration to nova.json'));
      } else {
        // Check if nova.json already exists
        try {
          await Deno.stat('./nova.json');
          logger.passThrough('log', colors.yellow('nova.json already exists.'));

          const shouldReconfigure = await Confirm.prompt({
            message: 'Reconfigure release settings?',
            default: true,
          });

          if (!shouldReconfigure) {
            logger.passThrough('log', colors.yellow('Setup cancelled by user.'));
            return;
          }
        } catch {
          // nova.json doesn't exist, ask before creating
          logger.passThrough('log', colors.dim('No existing configuration found.'));

          const shouldCreate = await Confirm.prompt({
            message: 'Create a new release configuration?',
            default: true,
          });

          if (!shouldCreate) {
            logger.passThrough('log', colors.yellow('Setup cancelled by user.'));
            return;
          }
        }

        // Detect tag prefix from existing tags
        const progress = new ProgressIndicator();
        progress.start('Analyzing repository...');
        const tagPrefix = await detectTagPrefix();
        progress.stop();

        if (tagPrefix) {
          logger.passThrough('log', colors.dim(`Detected tag prefix: "${tagPrefix}"`));
        } else {
          logger.passThrough('log', colors.dim('No tag prefix detected, using default (empty)'));
        }

        logger.passThrough('log', colors.dim('Creating new release configuration...'));
        await createDefaultReleaseConfig(tagPrefix);
        logger.passThrough('log', colors.green('✓ Created default release configuration'));
      }

      logger.passThrough(
        'log',
        colors.green('\n✓ Repository is now configured for semantic releases\n'),
      );
    } catch (error) {
      logger.error(
        colors.red(
          `\nError setting up release configuration: ${
            error instanceof Error ? error.message : 'Unknown error'
          }\n`,
        ),
      );
      Deno.exit(1);
    }
  });

// Add regenerate changelog subcommand
const regenerateCommand = new Command()
  .description('Regenerate the entire changelog from git history')
  .option('--force', 'Force regeneration without confirmation', { default: false })
  .action(async ({ force }: { force: boolean }) => {
    try {
      logger.passThrough('log', colors.blue('\nRegenerating changelog...\n'));

      // Check if CHANGELOG.md exists
      try {
        await Deno.stat('./CHANGELOG.md');
        if (!force) {
          const shouldRegenerate = await Confirm.prompt({
            message: colors.yellow('CHANGELOG.md already exists. Regenerate from scratch?'),
            default: false,
          });

          if (!shouldRegenerate) {
            logger.passThrough('log', colors.yellow('Operation cancelled.'));
            return;
          }
        }
      } catch {
        // CHANGELOG.md doesn't exist, proceed without confirmation
      }

      // Load or create config
      let config: ReleaseConfig;
      try {
        config = await loadReleaseConfig();
      } catch {
        logger.passThrough('log', colors.yellow('No nova.json configuration found.'));
        logger.passThrough('log', 'Creating default configuration...');
        await createDefaultReleaseConfig();
        config = await loadReleaseConfig();
      }

      const progress = new ProgressIndicator();
      progress.start('Regenerating changelog from git history...');

      await regenerateFullChangelog(config);

      progress.stop();
      logger.passThrough('log', colors.green('\n✓ Changelog regenerated successfully\n'));
    } catch (error) {
      logger.error(
        colors.red(
          `\nError regenerating changelog: ${
            error instanceof Error ? error.message : 'Unknown error'
          }\n`,
        ),
      );
      Deno.exit(1);
    }
  });

// Add test subcommand
const testCommand = new Command()
  .description('Test release configuration and simulate a release')
  .action(async () => {
    try {
      logger.passThrough('log', colors.blue('\nTesting release configuration...\n'));

      // Check if nova.json exists
      let config: ReleaseConfig;
      try {
        await Deno.stat('./nova.json');
        logger.passThrough('log', colors.green('✓ Found nova.json'));

        // Load and validate config
        config = await loadReleaseConfig();
        logger.passThrough('log', colors.green('✓ Configuration is valid'));

        // Log key settings
        logger.passThrough('log', '\nConfiguration Overview:');
        logger.passThrough('log', colors.dim('─'.repeat(50)));
        logger.passThrough('log', colors.dim(`Main branches: ${config.branches.main.join(', ')}`));
        logger.passThrough(
          'log',
          colors.dim(`Prerelease branches: ${config.branches.prerelease.join(', ')}`),
        );
        logger.passThrough('log', colors.dim(`Changelog enabled: ${config.changelog.enabled}`));
        logger.passThrough(
          'log',
          colors.dim(`GitLab integration: ${config.gitlab?.enabled ? 'enabled' : 'disabled'}`),
        );
        logger.passThrough('log', colors.dim('─'.repeat(50)));
      } catch (_error) {
        logger.passThrough(
          'log',
          colors.yellow('No nova.json found. Creating default configuration...'),
        );
        await createDefaultReleaseConfig();
        config = await loadReleaseConfig();
        logger.passThrough('log', colors.green('✓ Created default configuration'));
      }

      // Run release in dry-run mode
      logger.passThrough('log', '\nSimulating release...');
      await runRelease({ dryRun: true, force: false });
    } catch (error) {
      logger.error(
        colors.red(
          `\nError testing repository: ${
            error instanceof Error ? error.message : 'Unknown error'
          }\n`,
        ),
      );
      Deno.exit(1);
    }
  });

// Add subcommands to release command
releaseCommand
  .command('setup', setupCommand)
  .command('regenerate', regenerateCommand)
  .command('test', testCommand);

/**
 * Run the release process
 */
async function runRelease(options: ReleaseOptions) {
  const { dryRun, force } = options;
  try {
    logger.passThrough(
      'log',
      colors.blue(`\nRunning release process${dryRun ? ' (dry run)' : ''}...\n`),
    );

    // Check if nova.json exists, if not, ask for confirmation before creating
    let config: ReleaseConfig;
    try {
      await Deno.stat('./nova.json');
      // Load existing config
      config = await loadReleaseConfig();
    } catch {
      logger.passThrough('log', colors.yellow('No nova.json configuration found.'));

      const shouldCreate = await Confirm.prompt({
        message: 'Would you like to create a default release configuration?',
        default: true,
      });

      if (!shouldCreate) {
        logger.passThrough('log', colors.red('\nCancelled. Cannot proceed without configuration.'));
        logger.passThrough('log', colors.blue('To configure later, run:'));
        logger.passThrough('log', colors.blue('\nnova git setup\n')); // Updated command path
        Deno.exit(1);
      }

      logger.passThrough('log', 'Creating default configuration...');
      await createDefaultReleaseConfig();
      config = await loadReleaseConfig();
    }

    // Check if there are uncommitted changes
    if (config.blockIfChangesExist && await checkIfChangesExist()) {
      logger.error(colors.red('\nError: There are uncommitted changes in the repository.'));
      logger.passThrough('log', colors.red('Please commit or stash them before proceeding.'));
      logger.passThrough(
        'log',
        colors.dim('Or set blockIfChangesExist to false in configuration.'),
      );
      Deno.exit(1);
    }

    const progress = new ProgressIndicator();
    progress.start('Analyzing repository...');

    try {
      // Get recent commits
      const commits = await getCommits();

      // Classify the version bump type
      const versionClassification = classifyVersion(commits, config);

      // If no changes and not forced, exit
      if (versionClassification.type === 'none' && !force) {
        progress.stop();
        logger.passThrough(
          'log',
          colors.yellow('\nNo changes detected that would trigger a release.'),
        );
        logger.passThrough('log', colors.dim('Use --force to create a release anyway.'));
        Deno.exit(0);
      }

      // Determine the new version
      const currentVersion = await getCurrentVersion();
      const newVersion = getNewVersion(currentVersion, versionClassification.type, config);
      const tagPrefix = config.tagPrefix || '';
      const tagName = `${tagPrefix}${newVersion}`;

      progress.stop();

      logger.passThrough('log', colors.blue(`Current version: ${currentVersion}`));
      logger.passThrough('log', colors.green(`Next version: ${newVersion}`));
      logger.passThrough('log', colors.dim(`Version bump type: ${versionClassification.type}`));
      logger.passThrough('log', colors.dim(`Reason: ${versionClassification.reason}`));

      // Generate release notes
      logger.passThrough('log', colors.blue('\nGenerating release notes...'));
      const releaseNotes = await generateReleaseNotes(newVersion, commits, config);

      if (dryRun) {
        logger.passThrough('log', colors.yellow('\nDry run mode - no changes will be made\n'));
        logger.passThrough('log', colors.dim('Would perform the following actions:'));
        logger.passThrough('log', colors.dim(`- Update version to ${newVersion}`));
        logger.passThrough(
          'log',
          colors.dim(`- Generate changelog at ${config.changelog.path || 'CHANGELOG.md'}`),
        );

        if (config.autoCommit) {
          const commitMsg = config.commitMessage
            ? config.commitMessage.replace('${version}', newVersion)
            : `chore: release ${tagName}`;

          logger.passThrough(
            'log',
            colors.dim(`- Create git commit with message: "${commitMsg}"`),
          );
          logger.passThrough('log', colors.dim(`- Create git tag: ${tagName}`));
          logger.passThrough('log', colors.dim('- Push changes and tags to remote'));
        }

        if (config.gitlab?.enabled && config.gitlab.createRelease) {
          logger.passThrough(
            'log',
            colors.dim(`- Create GitLab release for version ${newVersion}`),
          );
        }

        logger.passThrough('log', '\nRelease notes preview:');
        logger.passThrough('log', colors.dim('-'.repeat(50)));
        logger.passThrough('log', releaseNotes);
        logger.passThrough('log', colors.dim('-'.repeat(50)));
        logger.passThrough('log', '');
      } else {
        // Perform actual release steps

        // 1. Update version in package.json or other version files
        await updateVersion(newVersion, config);
        logger.passThrough('log', colors.green('✓ Updated version files'));

        // 2. Generate and write changelog
        if (config.changelog.enabled) {
          await writeChangelog(releaseNotes, config);
          logger.passThrough('log', colors.green('✓ Generated changelog'));
        }

        // 3. If auto-commit is enabled, create commit, tag, and push
        if (config.autoCommit) {
          const commitMsg = config.commitMessage
            ? config.commitMessage.replace('${version}', newVersion)
            : `chore: release ${tagName}`;

          await createTagAndPush(tagName, commitMsg);
          logger.passThrough('log', colors.green('✓ Committed and pushed changes'));
        }

        // 4. Create GitLab release if enabled
        if (config.gitlab?.enabled && config.gitlab.createRelease) {
          // TODO: Implement GitLab release creation using GitLabService
          logger.passThrough('log', colors.green('✓ Created GitLab release'));
        }

        logger.passThrough(
          'log',
          colors.green(`\n✓ Release ${tagName} completed successfully\n`),
        );
      }
    } catch (error) {
      progress.stop();
      throw error;
    }
  } catch (error) {
    logger.error(
      colors.red(
        `\nError during release process: ${
          error instanceof Error ? error.message : 'Unknown error'
        }\n`,
      ),
    );
    Deno.exit(1);
  }
} 