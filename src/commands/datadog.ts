import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Select } from '@cliffy/prompt';
import { configManager } from '../config/mod.ts';
import { DatadogService } from '../services/datadog_service.ts';
import { commonJsonExamples, formatJsonExamples } from '../utils/help.ts';
import { logger } from '../utils/logger.ts';
type OutputFormat = 'text' | 'json';

interface DashboardOptions {
  format: OutputFormat;
}

interface TeamOptions {
  format: OutputFormat;
  query?: string;
}

export const datadogCommand = new Command()
  .name('datadog')
  .description('Datadog operations')
  .action(() => {
    logger.passThrough('log', colors.blue('\nDatadog Command Help\n'));
    logger.passThrough('log', 'Available Commands:');
    logger.passThrough('log', '  nova datadog teams      - List and search Datadog teams');
    logger.passThrough('log', '  nova datadog dashboards - List Datadog dashboards');
    logger.passThrough('log', '');
    logger.passThrough('log', 'Examples:');
    logger.passThrough('log', colors.dim('  # List all teams'));
    logger.passThrough('log', '  nova datadog teams');
    logger.passThrough('log', '  # Search for a team');
    logger.passThrough('log', '  nova datadog teams -q "engineering"');
    logger.passThrough('log', '  # List all dashboards');
    logger.passThrough('log', '  nova datadog dashboards');
    logger.passThrough('log', '');
  });

// Create teams command group
const teamsCommand = new Command()
  .description('List and search Datadog teams')
  .option('-f, --format <format:string>', 'Output format (text/json)', {
    default: 'text' as OutputFormat,
    value: (val: string): OutputFormat => {
      if (val !== 'text' && val !== 'json') {
        throw new Error('Format must be either "text" or "json"');
      }
      return val;
    },
  })
  .option('-q, --query <string>', 'Search for a team by name')
  .action(async ({ format, query }: TeamOptions) => {
    try {
      const config = await configManager.loadConfig();

      // Validate Datadog configuration
      if (!config.datadog?.api_key || !config.datadog?.app_key) {
        logger.error(colors.red('\nDatadog is not configured. Please run:'));
        logger.passThrough('log', colors.blue('\nnova setup\n'));
        Deno.exit(1);
      }

      const datadog = new DatadogService(config);

      logger.passThrough('log', colors.blue('\nFetching Datadog teams...\n'));

      const teams = await datadog.getTeams();

      if (teams.length === 0) {
        logger.passThrough('log', colors.yellow('No teams found.'));
        return;
      }

      // Filter teams if query is provided
      let filteredTeams = teams;
      if (query) {
        const searchQuery = query.toLowerCase();
        filteredTeams = teams.filter((team) =>
          team.name.toLowerCase().includes(searchQuery) ||
          team.handle.toLowerCase().includes(searchQuery) ||
          (team.description && team.description.toLowerCase().includes(searchQuery))
        );

        if (filteredTeams.length === 0) {
          logger.passThrough('log', colors.yellow(`No teams found matching "${query}"`));
          return;
        }
      }

      // If no format specified and multiple teams found, show interactive selection
      if (format === 'text' && !query && teams.length > 1) {
        const selectedTeamId = await Select.prompt<string>({
          message: 'Select a team:',
          options: teams.map((team) => ({
            name: `${team.name} (${team.handle})`,
            value: team.id,
          })),
          search: true,
        });

        filteredTeams = teams.filter((team) => team.id === selectedTeamId);
      }

      if (format === 'json') {
        logger.json(filteredTeams);
      } else {
        logger.passThrough('log', datadog.formatTeamList(filteredTeams));
        logger.passThrough('log', colors.dim(`Total teams: ${filteredTeams.length}\n`));
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Datadog API error')) {
        logger.error(
          colors.red(
            '\nFailed to connect to Datadog. Please check your configuration and try again.',
          ),
        );
        logger.passThrough('log', colors.blue('\nTo reconfigure Datadog, run:'));
        logger.passThrough('log', colors.blue('nova setup\n'));
      } else {
        logger.error(
          colors.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`),
        );
      }
      Deno.exit(1);
    }
  });

// Add help subcommand to teams
teamsCommand.command('help')
  .description('Show help for teams command')
  .action(() => {
    logger.passThrough('log', '\nDatadog Teams Command\n');
    logger.passThrough('log', 'Usage:');
    logger.passThrough('log', '  nova datadog teams [options]');
    logger.passThrough('log', '\nOptions:');
    logger.passThrough('log', '  -f, --format            Output format (text/json) [default: text]');
    logger.passThrough('log', '  -q, --query <string>    Search for a team by name');
    logger.passThrough('log', formatJsonExamples([
      commonJsonExamples.copyToClipboard('nova datadog teams'),
      {
        description: 'Search for engineering teams',
        command: 'nova datadog teams -q "engineering"'
      },
      {
        description: 'Get team details in JSON',
        command:
          'nova datadog teams --format json | jq -r \'.[] | {name, handle, members: .user_count}\'',
      },
    ]));
    logger.passThrough('log', '');
  });

// Create dashboards command group
const dashboardsCommand = new Command()
  .description('List Datadog dashboards')
  .option('-f, --format <format:string>', 'Output format (text/json)', {
    default: 'text' as OutputFormat,
    value: (val: string): OutputFormat => {
      if (val !== 'text' && val !== 'json') {
        throw new Error('Format must be either "text" or "json"');
      }
      return val;
    },
  })
  .action(async ({ format }: DashboardOptions) => {
    try {
      const config = await configManager.loadConfig();

      // Validate Datadog configuration
      if (!config.datadog?.api_key || !config.datadog?.app_key) {
        logger.error(colors.red('\nDatadog is not configured. Please run:'));
        logger.passThrough('log', colors.blue('\nnova setup\n'));
        Deno.exit(1);
      }

      const datadog = new DatadogService(config);

      logger.passThrough('log', colors.blue('\nFetching Datadog dashboards...\n'));

      const dashboards = await datadog.getDashboards();

      if (dashboards.length === 0) {
        logger.passThrough('log', colors.yellow('No dashboards found.'));
        return;
      }

      if (format === 'json') {
        logger.json(dashboards);
      } else {
        logger.passThrough('log', datadog.formatDashboardList(dashboards));
        logger.passThrough('log', colors.dim(`Total dashboards: ${dashboards.length}\n`));
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Datadog API error')) {
        logger.error(
          colors.red(
            '\nFailed to connect to Datadog. Please check your configuration and try again.',
          ),
        );
        logger.passThrough('log', colors.blue('\nTo reconfigure Datadog, run:'));
        logger.passThrough('log', colors.blue('nova setup\n'));
      } else {
        logger.error(
          colors.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`),
        );
      }
      Deno.exit(1);
    }
  });

// Add help subcommand to dashboards
dashboardsCommand.command('help')
  .description('Show help for dashboards command')
  .action(() => {
    logger.passThrough('log', '\nDatadog Dashboards Command\n');
    logger.passThrough('log', 'Usage:');
    logger.passThrough('log', '  nova datadog dashboards [options]');
    logger.passThrough('log', '\nOptions:');
    logger.passThrough('log', '  -f, --format            Output format (text/json) [default: text]');
    logger.passThrough('log', formatJsonExamples([
      commonJsonExamples.copyToClipboard('nova datadog dashboards'),
      {
        description: 'Get dashboard details',
        command:
          'nova datadog dashboards --format json | jq -r \'.[] | {title, description, url}\'',
      },
      {
        description: 'List dashboard titles and IDs',
        command:
          'nova datadog dashboards --format json | jq -r \'.[] | "\\(.title) (\\(.id))"\'',
      },
    ]));
    logger.passThrough('log', '');
  });

// Add commands to main Datadog command
datadogCommand
  .command('teams', teamsCommand)
  .command('dashboards', dashboardsCommand);
