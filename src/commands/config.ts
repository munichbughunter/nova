import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Config, configManager } from '../config/mod.ts';
import { StatusService } from '../services/status_service.ts';
import { commonJsonExamples, formatJsonExamples } from '../utils/help.ts';
import { logger } from '../utils/logger.ts';

const _showCmd = new Command()
    .description('Show current configuration')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text',
        value: (val: string): 'text' | 'json' => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .action(async ({ format }) => {
        const config = await configManager.loadConfig();
        if (format === 'json') {
            logger.json(config);
        } else {
            logger.passThrough('log', colors.blue('\nCurrent Configuration:\n'));
            Object.entries(config).forEach(([key, value]) => {
                logger.passThrough('log', colors.bold(`${key}:`));
                if (typeof value === 'object' && value !== null) {
                    Object.entries(value).forEach(([subKey, subValue]) => {
                        if (subKey.includes('token') || subKey.includes('password')) {
                            logger.passThrough('log', `  ${subKey}: ***`);
                        } else {
                            logger.passThrough('log', `  ${subKey}: ${subValue}`);
                        }
                    });
                } else {
                    logger.passThrough('log', `  ${value}`);
                }
                logger.passThrough('log', '');
            });
        }
    });


const testCmd = new Command()
    .description('Test all connections')
    .action(async () => {
        try {
            logger.passThrough('log', colors.bold('Testing connections from current configuration...\n'));
            const config = await configManager.loadConfig();
            const statusService = new StatusService();
            const statuses = await statusService.getAllStatuses(config);
            statusService.displayStatusTable(statuses);
        } catch (error) {
            if (error instanceof Error) {
                logger.error(colors.bold.red(`\n✗ Error: ${error.message}\n`));
            } else {
                logger.error(colors.bold.red('\n✗ An unknown error occurred\n'));
            }
            Deno.exit(1);
        }
    });

const setCmd = new Command()
    .arguments('<key:string> <value:string>')
    .description('Set a configuration value')
    .example('Set GitLab token', 'nova config set gitlab.token "your-token-here"')
    .example('Set AWS region', 'nova config set aws.region eu-central-1')
    .action(async (_, key, value) => {
        const parts = key.split('.');
        if (!['github', 'gitlab', 'openai', 'backstage', 'aws'].includes(parts[0])) {
            logger.error(
                'Invalid configuration section. Must be one of: github, gitlab, openai, backstage, aws',
            );
            Deno.exit(1);
        }

        const config: Partial<Config> = {};
        let current: Record<string, unknown> = config;

        // Build the nested structure
        for (let i = 0; i < parts.length - 1; i++) {
            current[parts[i]] = {};
            current = current[parts[i]] as Record<string, unknown>;
        }
        current[parts[parts.length - 1]] = value;

        try {
            // Before saving, ensure the config object is complete
            const completeConfig = {
                ...config,
                gitlab: config.gitlab ?? {
                    url: '',
                    token: '',
                    project_id: null,
                },
            } as const;

            await configManager.saveConfig(completeConfig);
            logger.passThrough('log', colors.green(`✓ Set ${key} = ${value}`));
        } catch (error) {
            if (error instanceof Error) {
                logger.error(colors.red(`✗ Error: ${error.message}`));
            } else {
                logger.error(colors.red('✗ An unknown error occurred'));
            }
            Deno.exit(1);
        }
    });

const getCmd = new Command()
    .arguments('<key:string>')
    .description('Get a configuration value')
    .example('Get GitLab URL', 'nova config get gitlab.url')
    .example('Get AWS region', 'nova config get aws.region')
    .action(async (_, key) => {
        try {
            const config = await configManager.loadConfig();
            const parts = key.split('.');

            // Validate the top-level key first
            const topLevel = parts[0];
            if (!(topLevel in config)) {
                throw new Error(
                    `Configuration section '${topLevel}' not found. Available sections: ${
                        Object.keys(config).join(', ')
                    }`,
                );
            }

            // Navigate through the object safely with type assertions
            let current: unknown = config[topLevel as keyof typeof config];
            for (let i = 1; i < parts.length; i++) {
                const part = parts[i];
                if (current && typeof current === 'object' && part in current) {
                    // We know it's an object at this point
                    current = (current as Record<string, unknown>)[part];
                } else {
                    throw new Error(`Configuration key '${key}' not found`);
                }
            }

            // Handle sensitive values
            if (
                typeof current === 'string' &&
                (parts[parts.length - 1].includes('token') || parts[parts.length - 1].includes('password'))
            ) {
                logger.passThrough('log', '***');
            } else {
                logger.passThrough('log', current);
            }
        } catch (error) {
            if (error instanceof Error) {
                logger.error(colors.red(`✗ Error: ${error.message}`));
            } else {
                logger.error(colors.red('✗ An unknown error occurred'));
            }
            Deno.exit(1);
        }
    });

const listCmd = new Command()
    .description('List all configuration values')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text',
        value: (val: string): 'text' | 'json' => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .action(async ({ format }) => {
        try {
            const config = await configManager.loadConfig();
            if (format === 'json') {
                logger.json(config);
            } else {
                logger.passThrough('log', colors.blue('\nConfiguration Values:\n'));
                Object.entries(config).forEach(([key, value]) => {
                    logger.passThrough('log', colors.bold(`${key}:`));
                    if (typeof value === 'object' && value !== null) {
                        Object.entries(value).forEach(([subKey, subValue]) => {
                            if (subKey.includes('token') || subKey.includes('password')) {
                                logger.passThrough('log', `  ${subKey}: ***`);
                            } else {
                                logger.passThrough('log', `  ${subKey}: ${subValue}`);
                            }
                        });
                    } else {
                        logger.passThrough('log', `  ${value}`);
                    }
                    logger.passThrough('log', '');
                });
            }
        } catch (error) {
            if (error instanceof Error) {
                logger.error(colors.red(`✗ Error: ${error.message}`));
            } else {
                logger.error(colors.red('✗ An unknown error occurred'));
            }
            Deno.exit(1);
        }
    });

export const configCommand = new Command()
    .name('config')
    .description('Manage Nova configuration')
    .action(() => {
        logger.passThrough('log', colors.blue('\nConfiguration Management\n'));
        logger.passThrough('log', 'Available Commands:');
        logger.passThrough('log', '  nova config list       - List all configuration values');
        logger.passThrough('log', '  nova config get        - Get a specific configuration value');
        logger.passThrough('log', '  nova config set        - Set a specific configuration value');
        logger.passThrough('log', '  nova config test       - Test all connections');
        logger.passThrough('log', '  nova config aws-region - Set AWS region (default: eu-central-1)');
        logger.passThrough('log', '');
        logger.passThrough('log', 'Examples:');
        logger.passThrough('log', colors.dim('  # List all configuration values'));
        logger.passThrough('log', colors.dim('  nova config list'));
        logger.passThrough('log', colors.dim('  # Get GitLab URL'));
        logger.passThrough('log', colors.dim('  nova config get gitlab.url'));
        logger.passThrough('log', colors.dim('  # Set GitLab token'));
        logger.passThrough('log', colors.dim('  nova config set gitlab.token "your-token-here"'));
        logger.passThrough('log', colors.dim('  # Set AWS region'));
        logger.passThrough('log', colors.dim('  nova config aws-region eu-central-1'));
        logger.passThrough('log', '');
        logger.passThrough('log', 'JSON Output Examples:');
        logger.passThrough('log', formatJsonExamples([
            commonJsonExamples.saveToFile('nova config list --format json', 'config-backup.json'),
            {
                description: 'Get GitLab configuration',
                command: 'nova config list --format json | jq -r ".gitlab"',
            },
            {
                description: 'Get all URLs',
                command: 'nova config list --format json | jq -r ".. | .url? // empty"',
            },
        ]));
        logger.passThrough('log', '');
    })
    .command('list', listCmd)
    .command('get', getCmd)
    .command('set', setCmd)
    .command('test', testCmd)
    .command('aws-region <region:string>', 'Set AWS region (default: eu-central-1)')
    .action(async (_options, region) => {
        try {
            const config = await configManager.loadConfig();
            config.aws = { region: region || 'eu-central-1' };
            await configManager.saveConfig(config);
            logger.passThrough('log', colors.green(`✓ AWS region set to: ${config.aws.region}`));
        } catch (error) {
            logger.error(colors.red('✗ Failed to set AWS region:'), error);
            Deno.exit(1);
        }
    });
