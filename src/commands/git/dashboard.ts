import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { configManager } from '../../config/mod.ts';
import { GitService } from '../../services/git_service.ts';
import { logger } from '../../utils/logger.ts';

export const dashboardCommand = new Command()
  .name('dashboard')
  .description('Interactive Git repository dashboard')
  .action(async () => {
    try {
      const config = await configManager.loadConfig();
      const gitService = new GitService(config);

      // Check if we're in a git repository
      const isGitRepo = await gitService.isGitRepository();
      if (!isGitRepo) {
        logger.error('Not a git repository');
        Deno.exit(1);
      }

      // Get repository root
      const repoRoot = await gitService.getRepositoryRoot();
      if (!repoRoot) {
        logger.error('Could not determine repository root');
        Deno.exit(1);
      }

      // Get current branch
      const currentBranch = await gitService.getCurrentBranch();
      
      // Get changed files
      const changedFiles = await gitService.getChangedFiles();
      
      // Get file statuses for more detailed information
      const fileStatuses = await gitService.getFileStatuses();

      // Display repository overview
      const overviewTable = new Table()
        .border(true)
        .header(['Repository Overview'])
        .body([
          ['Repository Root', repoRoot],
          ['Current Branch', currentBranch || 'Unknown'],
          ['Changed Files', changedFiles.length.toString()],
          ['Staged Changes', fileStatuses.filter(f => f.staged).length.toString()],
          ['Unstaged Changes', fileStatuses.filter(f => f.unstaged).length.toString()],
          ['Untracked Files', fileStatuses.filter(f => f.untracked).length.toString()]
        ]);

      logger.passThrough('log', '\n' + overviewTable.toString());

      // Display changed files if any
      if (fileStatuses.length > 0) {
        const changesTable = new Table()
          .border(true)
          .header(['Status', 'File'])
          .body(
            fileStatuses.map(file => {
              let status = '';
              if (file.staged) status += colors.green('●');
              if (file.unstaged) status += colors.yellow('●');
              if (file.untracked) status += colors.red('●');
              if (file.deleted) status += colors.red('✕');
              return [status, file.path];
            })
          );

        logger.passThrough('log', '\nChanged Files:');
        logger.passThrough('log', changesTable.toString());
        
        // Add legend
        logger.passThrough('log', '\nLegend:');
        logger.passThrough('log', `${colors.green('●')} Staged changes`);
        logger.passThrough('log', `${colors.yellow('●')} Unstaged changes`);
        logger.passThrough('log', `${colors.red('●')} Untracked files`);
        logger.passThrough('log', `${colors.red('✕')} Deleted files`);
      }

    } catch (error) {
      logger.error('Error in git dashboard:', error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }
  }); 