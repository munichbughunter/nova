import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { BaseEngineeringOptions } from '../agents/dev/types.ts';
import { AgentFactory } from '../agents/mod.ts';
import { configManager } from '../config/mod.ts';
import { GitLabService } from '../services/gitlab_service.ts';
import { Logger, logger } from '../utils/logger.ts';

interface AgentCommandOptions extends Record<string, unknown> {
  project?: string;
  format: string;
  recent: boolean;
  path?: string;
  depth?: 'quick' | 'normal' | 'deep';
  post?: boolean;
  mcpEnabled?: boolean;
}

const agentTypes = [
  // TODO: add pm and bm
  // { type: 'pm', description: 'Project Manager' },
  { type: 'dev', description: 'Software Engineer' },
  // { type: 'design', description: 'Design Engineer' },
  { type: 'qa', description: 'Quality Assurance Engineer' },
] as const;

const toolShortcuts = [
  { name: 'claude', description: 'Launch Claude Code with nova LLM Gateway' },
  { name: 'opencode', description: 'Launch OpenCode development environment' },
  { name: 'codex', description: 'Launch OpenAI Codex with nova LLM Gateway' },
  { name: 'gemini', description: 'Launch Gemini CLI with nova LLM Gateway' },
] as const;

export const agentCommand = new Command<void, void, AgentCommandOptions>()
  .name('agent')
  .description('Run an agent command')
  .arguments('[...query:string]')
  .option('-p, --project <project:string>', 'Project path')
  .option('-f, --format <format:string>', 'Output format', { default: 'text' })
  .option('-r, --recent', 'Use recent project', { default: false })
  .option('--mcp', 'Enable MCP tools integration', { default: false })
  .action(async (options, ...query) => {
    // This command is handled in main.ts with its own --list option
    // Don't add duplicate list option here as it conflicts

    if (query.length === 0) {
      logger.passThrough('log', colors.blue('\nAI Agents Help\n'));
      logger.passThrough('log', 'Available Agents:');
      for (const { type, description } of agentTypes) {
        logger.passThrough('log', `  nova agent ${type.padEnd(12)} - ${description}`);
      }
      logger.passThrough('log', '  nova agent help        - Show this help message\n');

      logger.passThrough('log', colors.blue('Development Tools:\n'));
      for (const { name, description } of toolShortcuts) {
        logger.passThrough('log', `  nova agent ${name.padEnd(12)} - ${description}`);
      }
      logger.passThrough('log', '');
      return;
    }

    // Handle other cases
    logger.passThrough('log', `Agent command with query: ${query.join(' ')}`);
  });

for (const { type, description } of agentTypes) {
  const subCommand = new Command()
    .description(`Run as ${description}`)
    .option('-p, --project <project:string>', 'Project path')
    .option('-f, --format <format:string>', 'Output format', { default: 'text' })
    .option('-r, --recent', 'Use recent project', { default: false })
    .action(function () {
      // Show help by default
      subCommand.showHelp();
    });

  // Add subcommands for engineering agent
  if (type === 'dev') {
    subCommand
      .command('review', 'Review code changes')
      .description('Review code changes in a file or directory')
      .example('Review a specific file', 'nova agent dev review --path src/file.ts')
      .example('Review multiple files', 'nova agent dev review --path ".gitlab-ci.yml,src/file.ts"')
      .example('Review with depth', 'nova agent dev review --path file.ts --depth=quick')
      .example(
        'Review with specific perspective',
        'nova agent dev review --path file.ts --reviewer architect',
      )
      .option('--path <path:string>', 'Path to review')
      .option('--depth <depth:string>', 'Analysis depth (quick|normal|deep)', { default: 'normal' })
      .option('--reviewer <type:string>', 'Review perspective (junior|senior|architect|all)', {
        default: 'senior',
      })
      .option('--post', 'Post review comments to GitLab')
      .action(
        async function (
          options: { path?: string; depth: string; reviewer?: string; post?: boolean },
        ) {
          try {
            const config = await configManager.loadConfig();
            const gitlab = new GitLabService(config);
            const logger = new Logger('Agent', Deno.env.get('DEBUG') === 'true');
            const factory = new AgentFactory({
              config,
              gitlab,
              logger,
            });
            const engineeringOptions: BaseEngineeringOptions = {
              depth: options.depth as BaseEngineeringOptions['depth'],
              post: options.post,
              path: options.path,
              reviewer: options.reviewer,
            };
            const agent = factory.getAgent(type, engineeringOptions);
            const args: string[] = [];
            if (options.path) {
              args.push('--path', options.path);
            }
            if (options.depth) {
              args.push('--depth', options.depth);
            }
            if (options.reviewer) {
              args.push('--reviewer', options.reviewer);
            }
            if (options.post) {
              args.push('--post');
            }
            const result = await agent.execute('review', args);
            logger.passThrough('log', result.message);
          } catch (error) {
            logger.error(error instanceof Error ? error.message : String(error));
            throw error;
          }
        },
      );

    subCommand
      .command('review-mr', 'Review current merge request')
      .description('Review changes in the current merge request')
      .example('Review MR', 'nova agent dev review-mr --depth=deep --post')
      .example('Review specific MR', 'nova agent dev review-mr --project group/project --mr 123')
      .example('Interactive review', 'nova agent dev review-mr --interactive')
      .option('--depth <depth:string>', 'Analysis depth (quick|normal|deep)', { default: 'normal' })
      .option('--post', 'Post review comments to GitLab')
      .option('--project <project:string>', 'GitLab project path (e.g., group/project)')
      .option('--mr <mr:number>', 'Merge request ID')
      .option('-i, --interactive', 'Interactive mode with chat functionality', { default: false })
      .option('--draft', 'Save review as draft instead of posting', { default: false })
      .action(async function (options: {
        depth: string;
        post?: boolean;
        project?: string;
        mr?: number;
        interactive?: boolean;
        draft?: boolean;
      }) {
        try {
          const config = await configManager.loadConfig();
          const gitlab = new GitLabService(config);
          const logger = new Logger('Agent', Deno.env.get('DEBUG') === 'true');
          const factory = new AgentFactory({
            config,
            gitlab,
            logger,
          });

          // If project not specified, try to get from current git remote
          if (!options.project) {
            try {
              const remoteUrl = await new Deno.Command('git', {
                args: ['remote', 'get-url', 'origin'],
                stdout: 'piped',
              }).output();
              const remoteUrlText = new TextDecoder().decode(remoteUrl.stdout).trim();
              // Extract project path from GitLab URL
              const match = remoteUrlText.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
              if (match) {
                options.project = match[1];
                logger.passThrough(
                  'log',
                  colors.dim(`Using project from git remote: ${options.project}`),
                );
              }
            } catch {
              if (!options.interactive) {
                throw new Error('No project specified and could not determine from git remote');
              }
            }
          }

          const engineeringOptions: BaseEngineeringOptions = {
            depth: options.depth as BaseEngineeringOptions['depth'],
            post: options.post,
            project: options.project,
            mergeRequestId: options.mr,
            interactive: options.interactive,
            draft: options.draft,
          };
          const agent = factory.getAgent(type, engineeringOptions);
          const args: string[] = [];
          if (options.depth) {
            args.push('--depth', options.depth);
          }
          if (options.post) {
            args.push('--post');
          }
          if (options.project) {
            args.push('--project', options.project);
          }
          if (options.mr) {
            args.push('--mr', options.mr.toString());
          }
          if (options.interactive) {
            args.push('--interactive');
          }
          if (options.draft) {
            args.push('--draft');
          }
          const result = await agent.execute('review-mr', args);
          logger.passThrough('log', result.message);
        } catch (error) {
          logger.error(error instanceof Error ? error.message : String(error));
          throw error;
        }
      });
  }

  // Add subcommands for QA agent
  if (type === 'qa') {
    subCommand
      .command('test', 'Run QA tests')
      .description('Run quality assurance tests')
      .example('Test with URL', 'nova agent qa test --url http://localhost:3000')
      .example(
        'Test with specific depth',
        'nova agent qa test --url http://localhost:3000 --depth=deep',
      )
      .option('--url <url:string>', 'URL to test')
      .option('--depth <depth:string>', 'Test depth (quick|normal|deep)', { default: 'normal' })
      .option('--browser <browser:string>', 'Browser to use for testing', { default: 'chromium' })
      .action(async function (options: { url?: string; depth: string; browser: string }) {
        try {
          const config = await configManager.loadConfig();
          const gitlab = new GitLabService(config);
          const logger = new Logger('Agent', Deno.env.get('DEBUG') === 'true');
          const factory = new AgentFactory({
            config,
            gitlab,
            logger,
          });
          const qaOptions = {
            depth: options.depth as BaseEngineeringOptions['depth'],
            url: options.url,
            browser: options.browser,
          };
          const agent = factory.getAgent(type, qaOptions);
          const args: string[] = [];
          if (options.url) {
            args.push('--url', options.url);
          }
          if (options.depth) {
            args.push('--depth', options.depth);
          }
          if (options.browser) {
            args.push('--browser', options.browser);
          }
          const result = await agent.execute('test', args);
          logger.passThrough('log', result.message);
        } catch (error) {
          logger.error(error instanceof Error ? error.message : String(error));
          throw error;
        }
      });
  }

  agentCommand.command(type, subCommand);
}

// Add tool shortcuts
for (const { name, description } of toolShortcuts) {
  const toolCommand = new Command()
    .description(description)
    .action(async function () {
      logger.passThrough('log', `Launching ${name}...`);
      // TODO: Implement tool launching
      logger.passThrough('log', colors.yellow(`${name} integration not yet implemented`));
    });

  agentCommand.command(name, toolCommand);
}

// Add help command
agentCommand
  .command('help', 'Show detailed help and usage examples')
  .action(() => {
    logger.passThrough('log', colors.blue('\n🤖 Nova AI Agents - Detailed Help\n'));

    logger.passThrough('log', colors.bold('Available Agents:'));
    logger.passThrough(
      'log',
      `  ${colors.cyan('dev')}       - Software Engineer for code review and analysis`,
    );
    logger.passThrough(
      'log',
      `  ${colors.cyan('qa')}        - Quality Assurance Engineer for testing`,
    );

    logger.passThrough('log', colors.bold('\nEngineering Agent Commands:'));
    logger.passThrough(
      'log',
      `  ${colors.cyan('review')}    - Review code changes in files or directories`,
    );
    logger.passThrough(
      'log',
      `  ${colors.cyan('review-mr')} - Review current merge request changes`,
    );

    logger.passThrough('log', colors.bold('\nQA Agent Commands:'));
    logger.passThrough(
      'log',
      `  ${colors.cyan('test')}      - Run quality assurance tests on URLs`,
    );

    logger.passThrough('log', colors.bold('\nUsage Examples:'));
    logger.passThrough('log', colors.dim('  # Review a specific file'));
    logger.passThrough('log', colors.dim('  nova agent dev review --path src/main.ts'));
    logger.passThrough('log', colors.dim(''));
    logger.passThrough('log', colors.dim('  # Review multiple files with deep analysis'));
    logger.passThrough(
      'log',
      colors.dim('  nova agent dev review --path "src/main.ts,src/utils.ts" --depth=deep'),
    );
    logger.passThrough('log', colors.dim(''));
    logger.passThrough('log', colors.dim('  # Review current merge request and post comments'));
    logger.passThrough('log', colors.dim('  nova agent dev review-mr --depth=normal --post'));
    logger.passThrough('log', colors.dim(''));
    logger.passThrough('log', colors.dim('  # Run QA tests on a local server'));
    logger.passThrough('log', colors.dim('  nova agent qa test --url http://localhost:3000'));
    logger.passThrough('log', colors.dim(''));

    logger.passThrough('log', colors.bold('Options:'));
    logger.passThrough(
      'log',
      `  ${colors.cyan('--depth')}    - Analysis depth: quick, normal, deep`,
    );
    logger.passThrough('log', `  ${colors.cyan('--post')}     - Post review comments to GitLab`);
    logger.passThrough('log', `  ${colors.cyan('--project')}  - Specify GitLab project path`);
    logger.passThrough(
      'log',
      `  ${colors.cyan('--reviewer')} - Review perspective: junior, senior, architect, all`,
    );
    logger.passThrough('log', '');
  });
