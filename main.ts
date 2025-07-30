#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
/// <reference path="./src/types.d.ts" />

import { colors } from '@cliffy/ansi/colors';
import { Command, ValidationError } from '@cliffy/command';
import { CompletionsCommand } from '@cliffy/command/completions';
import { NOVA_VERSION } from './src/version.ts';
import { Logger } from './src/utils/logger.ts';
import { configManager } from './src/config/mod.ts';
import { configCommand } from './src/commands/config.ts';
import { StatusService } from './src/services/status_service.ts';
import { setupCommand } from './src/commands/setup.ts';
import { mcpCommand } from './src/commands/mcp.ts';
import { agentCommand } from './src/commands/agent.ts';
import { profileCommand } from './src/commands/profile/profile.ts';
// import { gitlabCommand } from './src/commands/gitlab.ts';
/**
 * Initialize Nova CLI
 */
export const program = new Command()
    .name('nova')
    .description('Nova - AI-powered project management and development workflow tool')
    .version(NOVA_VERSION)
    .example('nova setup', 'Configure Nova')
    .example('nova config', 'Manage configuration')
    .example('nova mcp', 'MCP operations')
    .example('nova agent "analyze src/main.ts"', 'Analyze code with AI agent')
    .example('nova agent example help', 'Get help for specific agent')
    .example('nova agent --interactive', 'Start interactive agent session')
    .default('help');

// Register commands with subcommands directly (not lazy loaded)
program
    // .command('gitlab', gitlabCommand)
    // .command('jira', jiraCommand)
    .command('agent', agentCommand)
    .command('config', configCommand)
    // .command('dora', doraCommand)
    // .command('confluence', confluenceCommand)
    // .command('datadog', datadogCommand)
    // .command('git', gitCommand)
    // .command('update', updateCommand)
    .command('setup', setupCommand)
    .command('mcp', mcpCommand)
    .command('profile', profileCommand);

// Add custom help command
program.command(
    'help',
    new Command()
        .description('Show help information')
        .action(async () => {
            const logger = new Logger('Nova', Deno.env.get('NOVA_DEBUG') === 'true');
            try {
                const config = await configManager.loadConfig();
                const statusService = new StatusService();
                await statusService.displayStatusTableWithProgress(config);
            } catch {
                logger.passThrough('error', colors.yellow('\nUnable to load configuration\n'));
            }

            logger.passThrough('log', colors.bold('\nHelp:\n'));
            logger.passThrough('log', '  nova --help            - Show all the commands');
        }),
)
    .command('completions', new CompletionsCommand());

// Add global error handler
program.error((error, cmd) => {
    const logger = new Logger('Nova', Deno.env.get('NOVA_DEBUG') === 'true');

    if (error instanceof ValidationError) {
        // For validation errors, show command help and error message
        cmd.showHelp();
        logger.error(`${error.message}`);
    } else {
        // For all other errors
        logger.error(`${error.message}`);
        if (Deno.env.get('NOVA_DEBUG') === 'true') {
            console.error(error);
        }
    }
    Deno.exit(1);
});

// Parse arguments
if (import.meta.main) {
    await program.parse(Deno.args);
}
