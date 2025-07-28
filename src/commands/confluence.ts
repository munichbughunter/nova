import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Input, Select } from '@cliffy/prompt';
import { Table } from '@cliffy/table';
import { configManager } from '../config/mod.ts';
import { ConfluenceService } from '../services/confluence_service.ts';
import { DatabaseService } from '../services/db_service.ts';
import { logger } from '../utils/logger.ts';

type OutputFormat = 'text' | 'json';

interface SpaceChoice {
  name: string;
  value: string;
}

interface ConfluenceOptions {
  space?: string;
  limit?: number;
  format: OutputFormat;
  recent: boolean;
  refresh: boolean;
}

interface SearchOptions {
  limit: number;
  format: OutputFormat;
}

function handleError(error: unknown): never {
  if (error instanceof Error && error.message.includes('Confluence API error')) {
    logger.error(
      colors.red(
        '\nFailed to connect to Confluence. Please check your configuration and try again.',
      ),
    );
    logger.passThrough('log', colors.blue('\nTo reconfigure Confluence, run:'));
    logger.passThrough('log', colors.blue('nova setup\n'));
  } else {
    logger.error(
      colors.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`),
    );
  }
  throw error;
}

async function getSpaceKey(
  confluence: ConfluenceService,
  options: { space?: string; recent?: boolean },
): Promise<string> {
  let spaceKey = options.space;

  if (!spaceKey && options.recent) {
    const recentSpaces = await confluence.getRecentSpaces();

    if (recentSpaces.length === 0) {
      logger.passThrough('log', colors.yellow('\nNo recently accessed spaces found.'));
      throw new Error('No recent spaces found');
    }

    const spaceChoice = await Select.prompt<string>({
      message: 'Select a recent space:',
      options: recentSpaces.map((space) => ({
        name: `${space.name} (${space.key})`,
        value: space.key,
      })),
      search: true,
    });

    spaceKey = spaceChoice;
  }

  if (!spaceKey) {
    logger.passThrough('log', colors.blue('\nFetching Confluence spaces...\n'));
    const spaces = await confluence.getSpaces();

    if (spaces.length === 0) {
      throw new Error('No spaces found in Confluence');
    }

    const spaceChoice = await Select.prompt<string>({
      message: 'Select a space:',
      options: spaces.map((space) => ({
        name: `${space.name} (${space.key})`,
        value: space.key,
      })),
      search: true,
    });

    spaceKey = spaceChoice;
  }

  if (!spaceKey) {
    throw new Error('No space selected');
  }

  return spaceKey;
}

export const confluenceCommand = new Command()
  .name('confluence')
  .description('Confluence operations')
  .action(() => {
    logger.passThrough('log', colors.blue('\nConfluence Command Help\n'));
    logger.passThrough('log', 'Available Commands:');
    logger.passThrough('log', '  nova confluence spaces    - List Confluence spaces');
    logger.passThrough('log', '  nova confluence pages     - List pages in a space');
    logger.passThrough('log', '  nova confluence search    - Search Confluence content');
    logger.passThrough('log', '  nova confluence dashboard - Show space dashboard');
    logger.passThrough('log', '  nova confluence page      - Show details about a specific page');
    logger.passThrough('log', '  nova confluence help      - Show this help message');
    logger.passThrough('log', '');
  })
  .command('spaces')
  .description('List Confluence spaces')
  .option('-f, --format <format:string>', 'Output format (text/json)', {
    default: 'text' as OutputFormat,
    value: (val: string): OutputFormat => {
      if (val !== 'text' && val !== 'json') {
        throw new Error('Format must be either "text" or "json"');
      }
      return val;
    },
  })
  .action(async (options: { format: OutputFormat }) => {
    try {
      const config = await configManager.loadConfig();

      // Validate Confluence configuration
      if (
        !config.atlassian?.confluence_url || !config.atlassian?.confluence_token ||
        !config.atlassian?.username
      ) {
        throw new Error('Confluence not configured. Please run nova setup');
      }

      const confluence = new ConfluenceService(config);

      logger.passThrough('log', colors.blue('\nFetching Confluence spaces...\n'));

      const spaces = await confluence.getSpaces();

      if (spaces.length === 0) {
        logger.passThrough('log', colors.yellow('No spaces found.'));
        return;
      }

      if (options.format === 'json') {
        logger.json(spaces);
      } else {
        const table = new Table()
          .header([colors.bold.white('Key'), colors.bold.white('Name'), colors.bold.white('Type')])
          .border(true)
          .padding(1);

        spaces.forEach((space) => {
          table.push([
            space.key,
            space.name,
            space.type || 'Unknown',
          ]);
        });

        logger.passThrough('log', table.toString() + '\n');
        logger.passThrough('log', colors.dim(`Total spaces: ${spaces.length}\n`));
      }
    } catch (error) {
      handleError(error);
    }
  })
  .command('pages')
  .description('List pages in a space')
  .option('-s, --space <string>', 'Space key')
  .option('-l, --limit <number:number>', 'Maximum number of pages to return', { default: 1000 })
  .option('-f, --format <format:string>', 'Output format (text/json)', {
    default: 'text' as OutputFormat,
    value: (val: string): OutputFormat => {
      if (val !== 'text' && val !== 'json') {
        throw new Error('Format must be either "text" or "json"');
      }
      return val;
    },
  })
  .option('-r, --recent', 'Show pages from recently accessed spaces', { default: false })
  .option('--refresh', 'Force refresh cached data', { default: false })
  .action(
    async (
      options: {
        space?: string;
        limit: number;
        format: OutputFormat;
        recent: boolean;
        refresh: boolean;
      },
    ) => {
      try {
        const config = await configManager.loadConfig();

        if (!config.atlassian?.confluence_url || !config.atlassian?.confluence_token) {
          throw new Error('Confluence not configured. Please run nova setup');
        }

        const confluence = new ConfluenceService(config);

        if (options.refresh) {
          const db = await DatabaseService.getInstance();
          await db.clearConfluenceSpacesCache();
          await db.clearConfluencePagesCache();
          logger.passThrough('log', colors.blue('Cache cleared, fetching fresh data...'));
        }

        const spaceKey = await getSpaceKey(confluence, options);

        logger.passThrough('log', colors.blue(`\nFetching pages for space: ${spaceKey}...\n`));

        const pages = await confluence.getPagesInSpace(spaceKey);

        if (pages.length === 0) {
          logger.passThrough('log', colors.yellow('No pages found in this space.'));
          return;
        }

        if (options.format === 'json') {
          logger.json(pages);
        } else {
          // Add interactive page selection
          logger.passThrough('log', colors.blue('\nSelect a page to view details:'));

          const pageChoices = pages.map((page) => ({
            name: `${page.title} (v${page.version.number})`,
            value: page.id,
          }));

          const selectedPageId = await Select.prompt<string>({
            message: 'Choose a page:',
            options: pageChoices,
            search: true,
          });

          if (selectedPageId) {
            logger.passThrough('log', colors.blue('\nFetching page details...\n'));
            const page = await confluence.getPage(selectedPageId);
            logger.passThrough('log', confluence.formatPageInfo(page));
          }
        }
      } catch (error) {
        handleError(error);
      }
    },
  )
  .command('search')
  .description('Search Confluence content')
  .arguments('[query:string]')
  .option('-l, --limit <number:number>', 'Maximum number of results to return', { default: 10 })
  .option('-f, --format <format:string>', 'Output format (text/json)', {
    default: 'text' as OutputFormat,
    value: (val: string): OutputFormat => {
      if (val !== 'text' && val !== 'json') {
        throw new Error('Format must be either "text" or "json"');
      }
      return val;
    },
  })
  .action(async (options: SearchOptions, query?: string) => {
    try {
      const config = await configManager.loadConfig();

      if (!config.atlassian?.confluence_url || !config.atlassian?.confluence_token) {
        throw new Error('Confluence not configured. Please run setup');
      }

      const confluence = new ConfluenceService(config);

      if (!query) {
        query = await Input.prompt({
          message: 'Enter search query:',
          minLength: 3,
        });
      }

      if (!query) {
        throw new Error('No search query provided');
      }

      logger.passThrough('log', colors.blue(`\nSearching Confluence for: "${query}"...\n`));

      const results = await confluence.advancedSearch({
        query,
        limit: options.limit,
      });

      if (results.results.length === 0) {
        logger.passThrough('log', 'No results found');
        return;
      }

      if (options.format === 'json') {
        logger.json(results);
      } else {
        logger.passThrough('log', confluence.formatSearchResults(results));
      }
    } catch (error) {
      handleError(error);
    }
  })
  .command('dashboard', 'Show space dashboard')
  .option('-s, --space <string>', 'Space key', {})
  .option('-f, --format <format:string>', 'Output format (text/json)', {
    default: 'text' as OutputFormat,
    value: (val: string): OutputFormat => {
      if (val !== 'text' && val !== 'json') {
        throw new Error('Format must be either "text" or "json"');
      }
      return val;
    },
  })
  .option('-r, --recent', 'Automatically use the most recent space', { default: false })
  .option('--refresh', 'Force refresh cached data', { default: false })
  .action(async (options: ConfluenceOptions) => {
    try {
      const config = await configManager.loadConfig();

      // Validate Confluence configuration
      if (
        !config.atlassian?.confluence_url || !config.atlassian?.confluence_token ||
        !config.atlassian?.username
      ) {
        logger.error(colors.red('\nConfluence is not configured. Please run:'));
        logger.passThrough('log', colors.blue('\nnova setup\n'));
        Deno.exit(1);
      }

      const confluence = new ConfluenceService(config);

      logger.passThrough('log', colors.blue('\nGenerating Confluence Space Dashboard...\n'));

      let spaceKey = options.space;

      // If --recent flag is used, try to use the most recent space
      if (options.recent && !spaceKey) {
        const recentSpaces = await confluence.getRecentSpaces();
        if (recentSpaces.length === 0) {
          logger.passThrough(
            'log',
            colors.yellow('\nNo recent spaces found. Falling back to selection menu.\n'),
          );
        } else {
          const mostRecent = recentSpaces[0];
          try {
            // Get statistics with optional refresh
            const stats = options.refresh
              ? await confluence.refreshSpaceStatistics(mostRecent.key)
              : await confluence.getSpaceStatistics(mostRecent.key);

            if (options.format === 'json') {
              logger.json(
                {
                  timestamp: new Date().toISOString(),
                  space: {
                    name: stats.space.name,
                    key: stats.space.key,
                    url: `${config.atlassian!.confluence_url}/wiki/spaces/${stats.space.key}`,
                    type: stats.space.type,
                    description: stats.space.description?.plain?.value,
                  },
                  statistics: stats,
                },
                null,
              );
            } else {
              logger.passThrough('log', confluence.formatSpaceStatistics(stats));
            }
            return; // Exit after successful statistics display
          } catch (error) {
            logger.error(
              colors.red(
                `\n✗ Error analyzing recent space: ${
                  error instanceof Error ? error.message : 'Unknown error'
                }\n`,
              ),
            );
            Deno.exit(1); // Exit with error code after failure
          }
        }
      }

      // If no space or --recent not used, show selection menu
      if (!spaceKey) {
        logger.passThrough('log', colors.dim('Fetching available spaces...'));
        const spaces = await confluence.getSpaces();

        if (spaces.length === 0) {
          logger.passThrough('log', colors.yellow('\nNo Confluence spaces found.\n'));
          return;
        }

        // Get recent spaces
        const recentSpaces = await confluence.getRecentSpaces();

        // Let user select a space to analyze
        const selectionOptions = [
          ...recentSpaces.map((s) => ({
            name: `${colors.blue('Recent:')} ${s.name} (${s.key})`,
            value: s.key,
          })),
          { name: colors.dim('─'.repeat(30)), value: 'separator' },
          ...spaces.map((s) => ({
            name: `${s.name} (${s.key})`,
            value: s.key,
          })),
        ].filter((option) => option.value !== 'separator');

        spaceKey = await Select.prompt<string>({
          message: 'Select a space to analyze:',
          options: selectionOptions,
          search: true,
        });
      }

      if (!spaceKey) {
        throw new Error('No space selected');
      }

      logger.passThrough('log', colors.bold.blue(`\nAnalyzing space: ${spaceKey}\n`));

      try {
        // Get statistics with optional refresh
        const stats = options.refresh
          ? await confluence.refreshSpaceStatistics(spaceKey)
          : await confluence.getSpaceStatistics(spaceKey);

        if (options.format === 'json') {
          logger.json(
            {
              timestamp: new Date().toISOString(),
              space: {
                name: stats.space.name,
                key: stats.space.key,
                url: `${config.atlassian!.confluence_url}/wiki/spaces/${stats.space.key}`,
                type: stats.space.type,
                description: stats.space.description?.plain?.value,
              },
              statistics: stats,
            },
          );
        } else {
          logger.passThrough('log', confluence.formatSpaceStatistics(stats));
        }
      } catch (error) {
        logger.error(
          colors.yellow(
            `Warning: Could not fetch statistics for ${spaceKey}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          ),
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(colors.bold.red(`\n✗ Error: ${error.message}\n`));
      } else {
        logger.error(colors.bold.red('\n✗ An unknown error occurred\n'));
      }
      Deno.exit(1);
    }
  })
  .command('page', 'Show details about a specific page')
  .arguments('<page-id:string>')
  .option('-f, --format <format:string>', 'Output format (text/json)', {
    default: 'text' as OutputFormat,
    value: (val: string): OutputFormat => {
      if (val !== 'text' && val !== 'json') {
        throw new Error('Format must be either "text" or "json"');
      }
      return val;
    },
  })
  .option('--refresh', 'Force refresh cached data', { default: false })
  .action(async (options: { format: OutputFormat; refresh: boolean }, pageId: string) => {
    try {
      const config = await configManager.loadConfig();

      // Validate Confluence configuration
      if (
        !config.atlassian?.confluence_url || !config.atlassian?.confluence_token ||
        !config.atlassian?.username
      ) {
        logger.error(colors.red('\nConfluence is not configured. Please run:'));
        logger.passThrough('log', colors.blue('\nnova setup\n'));
        Deno.exit(1);
      }

      const confluence = new ConfluenceService(config);

      if (options.refresh) {
        const db = await DatabaseService.getInstance();
        await db.clearConfluencePageCache(pageId);
        logger.passThrough('log', colors.blue('Cache cleared, fetching fresh data...'));
      }

      logger.passThrough('log', colors.blue(`\nFetching page with ID: ${pageId}...\n`));

      const page = await confluence.getPage(pageId, options.refresh);

      if (options.format === 'json') {
        logger.json(page);
      } else {
        logger.passThrough('log', confluence.formatPageInfo(page));
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Confluence API error')) {
        logger.error(
          colors.red(
            '\nFailed to connect to Confluence or page not found. Please check your configuration and try again.',
          ),
        );
      } else {
        logger.error(
          colors.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`),
        );
      }
      Deno.exit(1);
    }
  })
  .command('help', 'Show help information');
