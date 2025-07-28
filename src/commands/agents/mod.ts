import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { AgentFactory, AgentType } from '../../agents/mod.ts';
import { configManager } from '../../config/mod.ts';
import { GitLabService } from '../../services/gitlab_service.ts';
import { logger } from '../../utils/logger.ts';
// Helper function to create agent commands
function createAgentCommand(type: AgentType, description: string) {
  return new Command()
    .description(description)
    .arguments('[command:string] [...args:string]')
    .action(async (_options: unknown, command?: string, ...args: string[]) => {
      try {
        const config = await configManager.loadConfig();
        const gitlab = new GitLabService(config);
        const parent = agentsCommand;

        // Get options with proper type assertions
        const projectOpt = parent.getOption('project');
        const formatOpt = parent.getOption('format');
        const recentOpt = parent.getOption('recent');

        const projectPath = projectOpt?.value ? String(projectOpt.value) : undefined;
        const format = formatOpt?.value ? String(formatOpt.value) : 'text';
        const recent = Boolean(recentOpt?.value);

        let finalProjectPath = projectPath;

        // If --recent flag is used, try to use most recent project
        if (recent && !finalProjectPath) {
          const recentProjects = await gitlab.getRecentProjects();
          if (recentProjects.length > 0) {
            finalProjectPath = recentProjects[0].fullPath;
            logger.passThrough(
              'log',
              colors.dim(`Using most recent project: ${recentProjects[0].name}`),
            );
          } else {
            logger.passThrough(
              'error',
              colors.red('No recent projects found. Please specify a project path.'),
            );
            Deno.exit(1);
          }
        }

        // Create agent context
        const context = {
          config,
          gitlab,
          projectPath: finalProjectPath,
        };

        // Create agent factory and get agent
        const factory = new AgentFactory(context);
        const agent = factory.getAgent(type);

        // Execute command or start interactive mode
        const result = await agent.execute(command || '', args);

        // Output result based on format
        if (format === 'json') {
          logger.json(result);
        } else {
          if (!result.success) {
            logger.passThrough('error', colors.red(`Error: ${result.message}`));
            Deno.exit(1);
          }
          if (result.message) {
            logger.passThrough('log', result.message);
          }
          if (result.data) {
            logger.json(result.data);
          }
        }
      } catch (error) {
        logger.passThrough(
          'error',
          colors.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`),
        );
        Deno.exit(1);
      }
    });
}

// Create parent command that groups all agents
export const agentsCommand = new Command()
  .name('agent')
  .description('Agent commands')
  .option('-p, --project <path:string>', 'Project path to analyze')
  .option('-f, --format <format:string>', 'Output format (text/json)', { default: 'text' })
  .option('-r, --recent', 'Use most recent project', { default: false })
  .default('help')
  .command('pm', createAgentCommand('pm', 'Project Manager - Project oversight and coordination'))
  .command('dev', createAgentCommand('dev', 'Dev - Technical tasks and code quality'))
  .command(
    'help',
    new Command()
      .description('Show help information')
      .action(() => {
        logger.passThrough('log', colors.blue('\nAgent Commands\n'));
        logger.passThrough('log', 'Available Agents:');
        logger.passThrough(
          'log',
          '  nova agent pm    - Project Manager (Project oversight and coordination)',
        );
        logger.passThrough('log', '  nova agent dev   - Dev (Technical tasks and code quality)');
        logger.passThrough('log', '\nOptions:');
        logger.passThrough('log', '  -p, --project     - Project path to analyze');
        logger.passThrough('log', '  -f, --format      - Output format (text/json)');
        logger.passThrough('log', '  -r, --recent      - Use most recent project');
        logger.passThrough('log', '\nUse --help with any agent for more information.\n');
      }),
  );
