import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Confirm, Select } from '@cliffy/prompt';
import { Table } from '@cliffy/table';
import { KeyService } from '../services/key_service.ts';
import { formatError, formatInfo, formatSuccess } from '../utils.ts';
import { logger } from '../utils/logger.ts';

export const keysCommand = new Command()
  .name('keys')
  .description('Manage API keys for nova LLM Gateway')
  .action(() => {
    // Show help by default
    keysCommand.showHelp();
  });

// List keys command
keysCommand
  .command('list', 'List all API keys')
  .alias('ls')
  .description('List all stored API keys')
  .action(async () => {
    try {
      const keyService = KeyService.getInstance();
      const keys = await keyService.listKeys();

      if (keys.length === 0) {
        formatInfo('No API keys found. Use `nova keys create` to create one.');
        return;
      }

      const table = new Table()
        .header(['Name', 'Key', 'Created', 'Last Used', 'Description'])
        .border(true);

      for (const key of keys) {
        table.push([
          colors.cyan(key.name),
          colors.dim(key.key), // Already masked
          new Date(key.created).toLocaleDateString(),
          key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : colors.dim('Never'),
          key.description || colors.dim('No description')
        ]);
      }

      console.log('\n📋 API Keys:\n');
      table.render();
      console.log();
    } catch (error) {
      formatError('Failed to list API keys');
      logger.error(error instanceof Error ? error.message : String(error));
    }
  });

// Create key command
keysCommand
  .command('create', 'Create a new API key')
  .alias('new')
  .description('Create a new API key for nova LLM Gateway')
  .option('-n, --name <name:string>', 'Name for the API key')
  .option('-d, --description <description:string>', 'Description for the API key')
  .option('--set-default', 'Set as default key after creation')
  .action(async (options) => {
    try {
      const keyService = KeyService.getInstance();
      
      let apiKey: string;
      if (options.name) {
        // Non-interactive mode
        apiKey = await keyService.generateKey(options.name, options.description);
      } else {
        // Interactive mode
        apiKey = await keyService.createKeyInteractive();
      }

      // Show the key to the user
      console.log(colors.yellow('\n⚠️  Save your API Key'));
      console.log(colors.dim('Please save this secret key somewhere safe and accessible. For security'));
      console.log(colors.dim('reasons, you will not be able to view it again through your nova account.'));
      console.log(colors.dim('If you lose this secret key, you will need to generate a new one.\n'));
      
      console.log(colors.bold('API Key:'));
      console.log(colors.green(apiKey));
      console.log();

      // Ask if they want to set it as default
      if (options.setDefault || await Confirm.prompt({
        message: 'Would you like to set this as your default API key?',
        default: true
      })) {
        await keyService.setDefaultKey(options.name || apiKey);
      }

      formatSuccess('✅ API key created successfully!');
      formatInfo('💡 Tip: Use `nova keys list` to view all your keys');

    } catch (error) {
      formatError('Failed to create API key');
      logger.error(error instanceof Error ? error.message : String(error));
    }
  });

// Delete key command
keysCommand
  .command('delete', 'Delete an API key')
  .alias('rm')
  .description('Delete an API key')
  .arguments('<nameOrId:string>')
  .option('-f, --force', 'Force deletion without confirmation')
  .action(async (options, nameOrId: string) => {
    try {
      const keyService = KeyService.getInstance();
      const key = await keyService.getKey(nameOrId);
      
      if (!key) {
        formatError(`Key "${nameOrId}" not found`);
        return;
      }

      // Confirm deletion unless forced
      if (!options.force) {
        const confirmed = await Confirm.prompt({
          message: `Are you sure you want to delete the key "${key.name}"?`,
          default: false
        });

        if (!confirmed) {
          formatInfo('Deletion cancelled');
          return;
        }
      }

      const deleted = await keyService.deleteKey(nameOrId);
      if (deleted) {
        formatSuccess(`✅ Deleted API key "${key.name}"`);
      } else {
        formatError(`Failed to delete API key "${nameOrId}"`);
      }
    } catch (error) {
      formatError('Failed to delete API key');
      logger.error(error instanceof Error ? error.message : String(error));
    }
  });

// Set default key command
keysCommand
  .command('default', 'Set default API key')
  .description('Set an API key as the default for nova CLI')
  .arguments('[nameOrId:string]')
  .action(async (_options, nameOrId?: string) => {
    try {
      const keyService = KeyService.getInstance();
      
      let selectedKey = nameOrId;
      
      // If no key specified, show interactive selection
      if (!selectedKey) {
        const keys = await keyService.listKeys();
        
        if (keys.length === 0) {
          formatInfo('No API keys found. Use `nova keys create` to create one.');
          return;
        }

        if (keys.length === 1) {
          selectedKey = keys[0].name;
          formatInfo(`Using only available key: ${selectedKey}`);
        } else {
          selectedKey = await Select.prompt({
            message: 'Select API key to set as default:',
            options: keys.map(key => ({
              name: `${key.name} - ${key.description || 'No description'} (${key.key})`,
              value: key.name
            }))
          });
        }
      }

      if (selectedKey) {
        await keyService.setDefaultKey(selectedKey);
      }
    } catch (error) {
      formatError('Failed to set default API key');
      logger.error(error instanceof Error ? error.message : String(error));
    }
  });

// Show key command
keysCommand
  .command('show', 'Show details of an API key')
  .description('Show details of a specific API key (key value will be masked)')
  .arguments('<nameOrId:string>')
  .action(async (_options, nameOrId: string) => {
    try {
      const keyService = KeyService.getInstance();
      const key = await keyService.getKey(nameOrId);
      
      if (!key) {
        formatError(`Key "${nameOrId}" not found`);
        return;
      }

      console.log(colors.cyan('\n📋 API Key Details:\n'));
      console.log(`${colors.bold('Name:')} ${key.name}`);
      console.log(`${colors.bold('Key:')} ${colors.dim(key.key.substring(0, 8) + '***' + key.key.substring(key.key.length - 4))}`);
      console.log(`${colors.bold('Created:')} ${new Date(key.created).toLocaleString()}`);
      console.log(`${colors.bold('Last Used:')} ${key.lastUsed ? new Date(key.lastUsed).toLocaleString() : colors.dim('Never')}`);
      console.log(`${colors.bold('Description:')} ${key.description || colors.dim('No description')}`);
      console.log();
    } catch (error) {
      formatError('Failed to show API key details');
      logger.error(error instanceof Error ? error.message : String(error));
    }
  });