import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Confirm, Input, Select } from '@cliffy/prompt';
import { ProfileManager } from '../../config/profile_manager.ts';
import { ConfigManager } from '../../config/mod.ts';
import { formatInfo, formatSuccess, formatError, theme } from '../../utils.ts';
import { logger } from '../../utils/logger.ts';

const profileManager = ProfileManager.getInstance();
const configManager = ConfigManager.getInstance();

// List all profiles
const listCmd = new Command()
    .name('list')
    .alias('ls')
    .description('List all configuration profiles')
    .option('-v, --verbose', 'Show detailed profile information')
    .action(async ({ verbose }) => {
        try {
            const profiles = await profileManager.listProfiles();
            
            if (profiles.length === 0) {
                formatInfo('No profiles found. Create one with: nova profile create <name>');
                return;
            }

            formatInfo('\n📋 Configuration Profiles:\n');
            
            for (const { name, active, profile } of profiles) {
                const activeIndicator = active ? colors.green('●') : colors.dim('○');
                const nameDisplay = active ? colors.bold(colors.green(name)) : name;
                
                logger.passThrough('log', `${activeIndicator} ${nameDisplay}`);
                
                if (verbose) {
                    logger.passThrough('log', colors.dim(`    Description: ${profile.description || 'No description'}`));
                    logger.passThrough('log', colors.dim(`    Created: ${profile.created_at || 'Unknown'}`));
                    logger.passThrough('log', colors.dim(`    Updated: ${profile.updated_at || 'Unknown'}`));
                    
                    // Show configured services
                    const services = [];
                    if (profile.config.gitlab?.url) services.push('GitLab');
                    if (profile.config.github?.url) services.push('GitHub');
                    if (profile.config.atlassian?.jira_url) services.push('Atlassian');
                    if (profile.config.ai?.default_provider) services.push('AI');
                    if (profile.config.datadog?.api_key) services.push('Datadog');
                    
                    logger.passThrough('log', colors.dim(`    Services: ${services.join(', ') || 'None'}`));
                    logger.passThrough('log', '');
                }
            }
            
            if (!verbose) {
                logger.passThrough('log', colors.dim('\nUse --verbose for detailed information'));
            }
        } catch (error) {
            formatError(`Failed to list profiles: ${error instanceof Error ? error.message : String(error)}`);
            Deno.exit(1);
        }
    });

// Create new profile
const createCmd = new Command()
    .name('create')
    .description('Create a new configuration profile')
    .arguments('<name:string>')
    .option('-d, --description <description:string>', 'Profile description')
    .option('--from-current', 'Create profile from current configuration')
    .option('--clone <source:string>', 'Clone from existing profile')
    .action(async ({ description, fromCurrent, clone }, name) => {
        try {
            let config;
            
            if (clone) {
                const sourceProfile = await profileManager.getProfile(clone);
                if (!sourceProfile) {
                    formatError(`Source profile '${clone}' does not exist`);
                    Deno.exit(1);
                }
                config = sourceProfile.config;
                formatInfo(`Cloning profile from '${clone}'...`);
            } else if (fromCurrent) {
                config = await configManager.loadConfig();
                formatInfo('Creating profile from current configuration...');
            } else {
                // Interactive profile creation - create minimal valid config
                logger.passThrough('log', theme.info(`🛠 Creating new profile '${name}'...`));
                logger.passThrough('log', theme.info('You can configure this profile later with: nova profile use <name> && nova setup'));
                config = {
                    ai: {
                        default_provider: 'openai' as const,
                    },
                };
            }
            
            const updatedProfiles = await profileManager.createProfile(name, config, description);
            
            const shouldActivate = await Confirm.prompt({
                message: `Would you like to activate profile '${name}' now?`,
                default: true,
            });
            
            if (shouldActivate) {
                // Use the updated profiles object directly to avoid race condition
                await profileManager.setActiveProfileWithProfiles(name, updatedProfiles);
                formatSuccess(`Profile '${name}' created and activated!`);
            } else {
                formatSuccess(`Profile '${name}' created! Activate with: nova profile use ${name}`);
            }
        } catch (error) {
            formatError(`Failed to create profile: ${error instanceof Error ? error.message : String(error)}`);
            Deno.exit(1);
        }
    });

// Switch to profile
const useCmd = new Command()
    .name('use')
    .alias('switch')
    .description('Switch to a different configuration profile')
    .arguments('[name:string]')
    .action(async (_, name) => {
        try {
            if (!name) {
                // Interactive profile selection
                const profiles = await profileManager.getProfileNames();
                
                if (profiles.length === 0) {
                    formatInfo('No profiles found. Create one with: nova profile create <name>');
                    return;
                }
                
                name = await Select.prompt({
                    message: 'Select profile to activate:',
                    options: profiles.map(p => ({ name: p, value: p })),
                });
            }
            
            await profileManager.setActiveProfile(name);
        } catch (error) {
            formatError(`Failed to switch profile: ${error instanceof Error ? error.message : String(error)}`);
            Deno.exit(1);
        }
    });

// Show current profile
const currentCmd = new Command()
    .name('current')
    .description('Show current active profile')
    .option('-v, --verbose', 'Show detailed profile information')
    .action(async ({ verbose }) => {
        try {
            const activeProfile = await profileManager.getActiveProfile();
            
            if (!activeProfile) {
                formatInfo('No active profile');
                return;
            }
            
            formatInfo(`\n📍 Current Profile: ${colors.bold(colors.green(activeProfile.name))}\n`);
            
            if (verbose) {
                logger.passThrough('log', `Description: ${activeProfile.description || 'No description'}`);
                logger.passThrough('log', `Created: ${activeProfile.created_at || 'Unknown'}`);
                logger.passThrough('log', `Updated: ${activeProfile.updated_at || 'Unknown'}`);
                
                // Show configured services summary
                const config = activeProfile.config;
                logger.passThrough('log', '\nConfigured Services:');
                
                if (config.gitlab?.url) {
                    logger.passThrough('log', `  ${theme.symbols.success} GitLab: ${config.gitlab.url}`);
                }
                if (config.github?.url) {
                    logger.passThrough('log', `  ${theme.symbols.success} GitHub: ${config.github.url}`);
                }
                if (config.atlassian?.jira_url) {
                    logger.passThrough('log', `  ${theme.symbols.success} Atlassian: ${config.atlassian.jira_url}`);
                }
                if (config.ai?.default_provider) {
                    logger.passThrough('log', `  ${theme.symbols.success} AI: ${config.ai.default_provider}`);
                }
                if (config.datadog?.api_key) {
                    logger.passThrough('log', `  ${theme.symbols.success} Datadog: Configured`);
                }
            }
        } catch (error) {
            formatError(`Failed to show current profile: ${error instanceof Error ? error.message : String(error)}`);
            Deno.exit(1);
        }
    });

// Delete profile
const deleteCmd = new Command()
    .name('delete')
    .alias('rm')
    .description('Delete a configuration profile')
    .arguments('<name:string>')
    .option('-f, --force', 'Force deletion without confirmation')
    .action(async ({ force }, name) => {
        try {
            if (name === 'default') {
                formatError('Cannot delete the default profile');
                Deno.exit(1);
            }
            
            const profile = await profileManager.getProfile(name);
            if (!profile) {
                formatError(`Profile '${name}' does not exist`);
                Deno.exit(1);
            }
            
            if (!force) {
                const confirmed = await Confirm.prompt({
                    message: `Are you sure you want to delete profile '${name}'?`,
                    default: false,
                });
                
                if (!confirmed) {
                    formatInfo('Deletion cancelled');
                    return;
                }
            }
            
            await profileManager.deleteProfile(name);
        } catch (error) {
            formatError(`Failed to delete profile: ${error instanceof Error ? error.message : String(error)}`);
            Deno.exit(1);
        }
    });

export const profileCommand = new Command()
    .name('profile')
    .description('Manage configuration profiles')
    .action(() => {
        profileCommand.showHelp();
    })
    .command('list', listCmd)
    .command('create', createCmd)
    .command('use', useCmd)
    .command('current', currentCmd)
    .command('delete', deleteCmd);