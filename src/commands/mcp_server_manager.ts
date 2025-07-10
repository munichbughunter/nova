import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Select, Input, Confirm } from '@cliffy/prompt';
import { ExternalMCPService } from '../services/external_mcp_service.ts';
import { MCPServerTemplate, MCP_SERVER_TEMPLATES } from '../config/mcp_servers.ts';
import { Logger } from '../utils/logger.ts';

const logger = new Logger('MCP Server Manager');

/**
 * Add a new MCP server from template
 */
export const addServerCommand = new Command()
    .description('Add a new MCP server')
    .option('--template <template:string>', 'Server template to use')
    .option('--id <id:string>', 'Server ID')
    .option('--interactive [interactive:boolean]', 'Interactive mode', { default: true })
    .action(async (options) => {
        const externalMCP = ExternalMCPService.getInstance();
        
        try {
            let serverId = options.id;
            let template = options.template as MCPServerTemplate;

            if (options.interactive) {
                // Interactive mode
                if (!serverId) {
                    serverId = await Input.prompt({
                        message: 'Enter server ID:',
                        validate: (value) => {
                            if (!value || value.trim().length === 0) {
                                return 'Server ID is required';
                            }
                            if (externalMCP.getServer(value)) {
                                return 'Server ID already exists';
                            }
                            return true;
                        },
                    });
                }

                if (!template) {
                    const availableTemplates = Object.keys(MCP_SERVER_TEMPLATES);
                    template = await Select.prompt({
                        message: 'Select a server template:',
                        options: availableTemplates.map(t => ({
                            name: `${t} - ${MCP_SERVER_TEMPLATES[t as MCPServerTemplate].description}`,
                            value: t,
                        })),
                    }) as MCPServerTemplate;
                }

                // Ask for customizations
                const needsCustomization = await Confirm.prompt({
                    message: 'Do you want to customize the server configuration?',
                    default: false,
                });

                const customization: Record<string, unknown> = {};

                if (needsCustomization) {
                    const templateConfig = MCP_SERVER_TEMPLATES[template];
                    
                    // Allow customizing common fields
                    customization.name = await Input.prompt({
                        message: 'Server name:',
                        default: templateConfig.name,
                    });

                    customization.description = await Input.prompt({
                        message: 'Description:',
                        default: templateConfig.description || '',
                    });

                    customization.tool_prefix = await Input.prompt({
                        message: 'Tool prefix (optional):',
                        default: templateConfig.tool_prefix || '',
                    });

                    // Ask for environment variables if the template needs them
                    if (Object.keys(templateConfig.env).length > 0) {
                        console.log(colors.yellow('\\n📝 Environment variables needed:'));
                        const env: Record<string, string> = {};
                        
                        for (const [key, defaultValue] of Object.entries(templateConfig.env)) {
                            const value = await Input.prompt({
                                message: `${key}:`,
                                default: String(defaultValue),
                            });
                            env[key] = value;
                        }
                        customization.env = env;
                    }
                }

                externalMCP.addServerFromTemplate(serverId, template, customization);
                
                console.log(colors.green(`✅ Added MCP server '${serverId}' successfully!`));
                
                // Ask if user wants to start the server
                const startNow = await Confirm.prompt({
                    message: 'Start the server now?',
                    default: true,
                });

                if (startNow) {
                    await externalMCP.startServer(serverId);
                    console.log(colors.green(`✅ Server '${serverId}' started successfully!`));
                }
            } else {
                // Non-interactive mode
                if (!serverId || !template) {
                    throw new Error('Server ID and template are required in non-interactive mode');
                }

                externalMCP.addServerFromTemplate(serverId, template);
                console.log(colors.green(`✅ Added MCP server '${serverId}' successfully!`));
            }

        } catch (error) {
            logger.error('Failed to add server:', error);
            console.log(colors.red(`❌ Failed to add server: ${error instanceof Error ? error.message : String(error)}`));
        }
    });

/**
 * List all MCP servers
 */
export const listServersCommand = new Command()
    .description('List all MCP servers')
    .option('--status', 'Include server status', { default: false })
    .option('--verbose', 'Verbose output', { default: false })
    .action((options) => {
        const externalMCP = ExternalMCPService.getInstance();
        
        try {
            const servers = externalMCP.listServers();
            const serverIds = Object.keys(servers);

            if (serverIds.length === 0) {
                console.log(colors.yellow('ℹ No MCP servers configured'));
                return;
            }

            console.log(colors.bold('\\n📋 MCP Servers:\\n'));

            for (const [id, config] of Object.entries(servers)) {
                const status = options.status ? externalMCP.getServerStatus(id) : null;
                const statusIcon = status === 'running' ? '🟢' 
                    : status === 'disabled' ? '🔴'
                    : status === 'stopped' ? '🟡'
                    : '❓';

                if (options.verbose) {
                    console.log(`${statusIcon} ${id} - ${config.name}`);
                    console.log(`   Type: ${config.type}`);
                    if (config.description) {
                        console.log(`   Description: ${config.description}`);
                    }
                    console.log(`   Enabled: ${config.enabled ? 'Yes' : 'No'}`);
                    if (config.tool_prefix) {
                        console.log(`   Tool prefix: ${config.tool_prefix}`);
                    }
                    if (config.installed_at) {
                        const date = new Date(config.installed_at);
                        console.log(`   Installed: ${date.toLocaleDateString()}`);
                    }
                    if (status) {
                        console.log(`   Status: ${status}`);
                    }
                    console.log('');
                } else {
                    console.log(`${statusIcon} ${id} - ${config.name}`);
                }
            }

        } catch (error) {
            logger.error('Failed to list servers:', error);
            console.log(colors.red(`❌ Failed to list servers: ${error instanceof Error ? error.message : String(error)}`));
        }
    });

/**
 * Remove an MCP server
 */
export const removeServerCommand = new Command()
    .description('Remove an MCP server')
    .option('--id <id:string>', 'Server ID to remove', { required: true })
    .option('--force', 'Skip confirmation prompt', { default: false })
    .action(async (options) => {
        const externalMCP = ExternalMCPService.getInstance();
        
        try {
            const serverId = options.id;
            
            if (!externalMCP.getServer(serverId)) {
                console.log(colors.red(`❌ Server '${serverId}' not found`));
                return;
            }

            if (!options.force) {
                const confirmed = await Confirm.prompt({
                    message: `Are you sure you want to remove server '${serverId}'?`,
                    default: false,
                });

                if (!confirmed) {
                    console.log(colors.yellow('Operation cancelled'));
                    return;
                }
            }

            // Stop the server first if it's running
            const status = externalMCP.getServerStatus(serverId);
            if (status === 'running') {
                await externalMCP.stopServer(serverId);
                console.log(colors.yellow(`🛑 Stopped server '${serverId}'`));
            }

            externalMCP.removeServer(serverId);
            console.log(colors.green(`✅ Removed MCP server '${serverId}' successfully!`));

        } catch (error) {
            logger.error('Failed to remove server:', error);
            console.log(colors.red(`❌ Failed to remove server: ${error instanceof Error ? error.message : String(error)}`));
        }
    });

/**
 * Show available templates
 */
export const templatesCommand = new Command()
    .description('Show available MCP server templates')
    .action(() => {
        console.log(colors.bold('\\n📋 Available MCP Server Templates:\\n'));

        for (const [key, template] of Object.entries(MCP_SERVER_TEMPLATES)) {
            console.log(`${colors.bold(key)}`);
            console.log(`   Name: ${template.name}`);
            console.log(`   Description: ${template.description}`);
            console.log(`   Type: ${template.type}`);
            console.log(`   Command: ${template.command} ${template.args.join(' ')}`);
            if (template.tool_prefix) {
                console.log(`   Tool prefix: ${template.tool_prefix}`);
            }
            if (Object.keys(template.env).length > 0) {
                console.log(`   Environment variables: ${Object.keys(template.env).join(', ')}`);
            }
            console.log('');
        }
    });

/**
 * Main server management command
 */
export const serverCommand = new Command()
    .description('Manage external MCP servers')
    .command('add', addServerCommand)
    .command('list', listServersCommand)
    .command('remove', removeServerCommand)
    .command('templates', templatesCommand);
