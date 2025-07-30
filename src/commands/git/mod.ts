import { Command } from '@cliffy/command';
import { commitCommand } from './commit.ts';
import { dashboardCommand } from './dashboard.ts';
import { releaseCommand } from './release.ts';

// Define and export the main git command
const git = new Command()
    .name('git')
    .description('Git-related commands and utilities')
    .command('commit', commitCommand)
    .command('dashboard', dashboardCommand)
    .command('release', releaseCommand);

// Export the command
export const gitCommand = git;

// Potential future commands:
// .command('branch', branchCommand) // Smart branch creation with naming conventions
// .command('pr', prCommand)         // Create PRs with AI-generated descriptions
// .command('log', logCommand)       // Enhanced git log with additional analytics
