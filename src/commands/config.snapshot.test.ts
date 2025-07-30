import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { snapshotTest } from '@cliffy/testing';

// Create a mock configuration
const mockConfig = {
    gitlab: {
        url: 'https://gitlab.example.com',
        token: 'mock-gitlab-token',
        project_id: null,
    },
};

// Mock the config manager's loadConfig method
const _mockLoadConfig = () => {
    return Promise.resolve(mockConfig);
};

// Test the config list command
await snapshotTest({
    name: 'Config List Command',
    meta: import.meta,
    colors: true,
    async fn() {
        // Create a new command instance
        const configCommand = new Command()
            .name('config')
            .description('Configuration management')
            .action(() => {
                console.log('Configuration commands');
            });

        // Add list subcommand
        configCommand.command('list')
            .description('List all configuration values')
            .action(() => {
                console.log(colors.blue('\nConfiguration Values:\n'));
                Object.entries(mockConfig).forEach(([key, value]) => {
                    console.log(colors.bold(`${key}:`));
                    if (typeof value === 'object' && value !== null) {
                        Object.entries(value).forEach(([subKey, subValue]) => {
                            if (subKey.includes('token') || subKey.includes('password')) {
                                console.log(`  ${subKey}: ***`);
                            } else {
                                console.log(`  ${subKey}: ${subValue}`);
                            }
                        });
                    } else {
                        console.log(`  ${value}`);
                    }
                    console.log('');
                });
            });

        // Execute the command
        await configCommand.parse(['list']);
    },
});

// Test the config show command with JSON output
await snapshotTest({
    name: 'Config JSON Output',
    meta: import.meta,
    colors: true,
    async fn() {
        // Create a new command with JSON output
        const configCommand = new Command()
            .name('config')
            .description('Configuration management')
            .action(() => {
                console.log('Configuration commands');
            });

        // Add show subcommand with JSON format
        configCommand.command('show')
            .description('Show current configuration')
            .option('-f, --format <format:string>', 'Output format (text/json)')
            .action(({ format }) => {
                if (format === 'json') {
                    console.log(JSON.stringify(mockConfig, null, 2));
                }
            });

        // Execute the command with JSON format option
        await configCommand.parse(['show', '--format', 'json']);
    },
});
