import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Confirm, Input, Secret, Select } from '@cliffy/prompt';
import { exists } from '@std/fs/exists';
import { ConfigManager } from '../config/mod.ts';
import {
    AIConfig,
    AzureAIConfig,
    Config,
    CopilotConfig,
    novaConfig,
    OllamaConfig,
    OpenAIConfig,
    OpenAIModel,
} from '../config/types.ts';
import { StatusService } from '../services/status_service.ts';
import { formatDim, formatError, formatInfo, formatList, formatSuccess, theme } from '../utils.ts';
import { logger } from '../utils/logger.ts';

const defaultFallbackModel = 'qwen3:1.7b';

// Add formatWarning function
function formatWarning(text: string): void {
    logger.passThrough('log', colors.yellow(text));
}

const configManager = ConfigManager.getInstance();

async function checkGitHubCopilot(): Promise<boolean> {
    try {
        const process = new Deno.Command('gh', {
            args: ['extension', 'list'],
        });
        const { stdout } = await process.output();
        const output = new TextDecoder().decode(stdout);
        return output.includes('github/gh-copilot');
    } catch {
        return false;
    }
}

async function setupGitHubCopilot() {
    // Check if Copilot is already installed
    if (await checkGitHubCopilot()) {
        const shouldReconfigure = await Confirm.prompt({
            message: 'GitHub Copilot CLI is already configured. Would you like to reconfigure it?',
            default: false,
        });

        if (!shouldReconfigure) {
            formatInfo('\nKeeping existing GitHub Copilot configuration.');
            return;
        }
    }

    formatInfo('\nSetting up GitHub Copilot CLI...');

    // Check if gh CLI is installed
    try {
        const process = new Deno.Command('gh', { args: ['--version'] });
        await process.output();
    } catch {
        formatError('GitHub CLI (gh) is not installed');
        logger.passThrough('log', 'Please install it from: https://cli.github.com/');
        return;
    }

    // Check if already authenticated
    try {
        const authProcess = new Deno.Command('gh', { args: ['auth', 'status'] });
        await authProcess.output();
        formatSuccess('Already authenticated with GitHub');
    } catch {
        logger.passThrough('log', 'Running GitHub authentication...');
        const loginProcess = new Deno.Command('gh', { args: ['auth', 'login'] });
        await loginProcess.output();
    }

    // Install Copilot extension if needed
    if (!await checkGitHubCopilot()) {
        formatInfo('Installing GitHub Copilot CLI extension...');
        const installProcess = new Deno.Command('gh', {
            args: ['extension', 'install', 'github/gh-copilot'],
        });
        await installProcess.output();
        formatSuccess(`${theme.symbols.success} GitHub Copilot CLI installed successfully!`);
    }
}

async function setupGitLab(existingConfig: Partial<Config>, emoji: string = '') {
    // Check if GitLab is actually configured with valid values
    const isGitlabConfigured = Boolean(
        existingConfig.gitlab?.url &&
            existingConfig.gitlab.url.length > 0 &&
            existingConfig.gitlab.token &&
            existingConfig.gitlab.token.length > 0,
    );

    if (isGitlabConfigured) {
        const shouldReconfigure = await Confirm.prompt({
            message:
                `${emoji} GitLab configuration already exists. Would you like to reconfigure it?`,
            default: false,
        });

        if (!shouldReconfigure) {
            return existingConfig.gitlab;
        }
    }

    formatInfo('\nSetting up GitLab integration...');

    const gitlabUrl = await Input.prompt({
        message: 'GitLab URL',
        default: existingConfig.gitlab?.url || 'https://gitlab.com',
    });

    formatInfo('\nTo create a new access token:');
    logger.passThrough(
        'log',
        formatList([
            `Go to ${gitlabUrl}/-/user_settings/personal_access_tokens`,
            'Create a token with the following scopes:',
            'api',
            'read_repository',
            'write_repository',
        ]),
    );

    const token = await Input.prompt({
        message: 'GitLab Personal Access Token',
        minLength: 20,
    });

    return {
        url: gitlabUrl,
        token: token,
    };
}

// Add to existing interfaces or create new ones
interface AtlassianConfig {
    jira_url: string;
    jira_token: string;
    confluence_url: string;
    confluence_token: string;
    username: string;
}

async function setupnova(existingConfig: Partial<ExtendedConfig>, emoji: string = '') {
    if (existingConfig.ai?.nova) {
        const shouldReconfigure = await Confirm.prompt({
            message:
                `${emoji} nova LLM Gateway configuration already exists. Would you like to reconfigure it?`,
            default: false,
        });

        if (!shouldReconfigure) {
            return existingConfig.ai.nova;
        }
    }

    formatInfo(`${theme.symbols.setup} Setting up nova LLM Gateway integration...`);

    const apiKey = await Input.prompt({
        message: 'nova LLM Gateway API Key',
        hint: 'Your API key for accessing the nova LLM Gateway',
        default: existingConfig.ai?.nova?.api_key || '',
    });

    const apiUrl = await Input.prompt({
        message: 'nova LLM Gateway URL',
        default: existingConfig.ai?.nova?.api_url || 'https://llmgw.nova.de',
    });

    const defaultModel = await Input.prompt({
        message: 'Default Model',
        hint: 'The default model to use (e.g., claude-3-5-sonnet-20241022)',
        default: existingConfig.ai?.nova?.default_model || 'claude-3-5-sonnet-20241022',
    });

    return { api_key: apiKey, api_url: apiUrl, default_model: defaultModel };
}

async function setupOpenAI(existingConfig: Partial<ExtendedConfig>, emoji: string = '') {
    if (existingConfig.ai?.openai) {
        const shouldReconfigure = await Confirm.prompt({
            message:
                `${emoji} OpenAI configuration already exists. Would you like to reconfigure it?`,
            default: false,
        });

        if (!shouldReconfigure) {
            return existingConfig.ai.openai;
        }
    }

    formatInfo(`${theme.symbols.setup} Setting up OpenAI integration...`);

    const apiKey = await Input.prompt({
        message: 'OpenAI API Key',
        hint: 'Get it from: https://platform.openai.com/api-keys',
        default: existingConfig.ai?.openai?.api_key || '',
    });

    const apiUrl = await Input.prompt({
        message: 'OpenAI API URL',
        default: existingConfig.ai?.openai?.api_url || 'https://api.openai.com/v1',
    });

    const apiVersion = await Input.prompt({
        message: 'OpenAI API Version',
        default: existingConfig.ai?.openai?.api_version || '2025-01-01-preview',
    });

    return { api_key: apiKey, api_url: apiUrl, api_version: apiVersion };
}

// Add interfaces for config types
interface AtlassianConfig {
    username: string;
    jira_token: string;
    jira_url: string;
    confluence_token: string;
    confluence_url: string;
}

interface ExtendedConfig {
    gitlab: Config['gitlab'];
    atlassian?: AtlassianConfig;
    datadog?: {
        api_key: string;
        app_key: string;
        site: string;
    };
    ai?: AIConfig;
    nova?: novaConfig;
    openai?: OpenAIConfig;
    azure?: AzureAIConfig;
    ollama?: OllamaConfig;
    copilot?: CopilotConfig;
}

async function checkOllama(): Promise<boolean> {
    logger.debug('Checking Ollama service...');
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const isRunning = response.ok;
        logger.debug(`Ollama service running: ${isRunning}`);
        if (isRunning) {
            const data = await response.json();
            logger.debug(
                `Available models: ${
                    JSON.stringify(data.models?.map((m: { name: string }) => m.name) || [])
                }`,
            );
        }
        return isRunning;
    } catch (error) {
        logger.debug(
            `Ollama service check failed: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        );
        return false;
    }
}

async function pullOllamaModel(model: string): Promise<boolean> {
    formatInfo(`\n${theme.symbols.download} Pulling Ollama model: ${model}...`);
    try {
        const response = await fetch('http://localhost:11434/api/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model }),
        });

        if (!response.ok) {
            formatError(`Failed to pull model: ${model}`);
            return false;
        }

        formatSuccess(`${theme.symbols.success} Model ${model} pulled successfully!`);
        return true;
    } catch (error) {
        formatError(
            `Failed to pull model: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        return false;
    }
}

interface OllamaModel {
    name: string;
}

interface SelectOption {
    name: string;
    value: string;
}

async function setupOllama(
    existingConfig: Partial<ExtendedConfig>,
): Promise<OllamaConfig | undefined> {
    // Check for existing configuration
    if (existingConfig.ollama) {
        const shouldReconfigure = await Confirm.prompt({
            message: 'Ollama configuration already exists. Would you like to reconfigure it?',
            default: false,
        });

        if (!shouldReconfigure) {
            formatInfo('\nKeeping existing Ollama configuration.');
            return existingConfig.ollama;
        }
    }

    formatInfo(`\n${theme.symbols.setup} Setting up Ollama...\n`);

    // Check if Ollama is already installed and running
    formatDim(`${theme.symbols.check} Checking if Ollama is already running...`);

    let ollamaAvailable = await checkOllama();

    if (!ollamaAvailable) {
        // Installation process
        const os = Deno.build.os;

        // macOS and Windows require manual download from the website
        if (os === 'darwin' || os === 'windows') {
            const platformName = os === 'darwin' ? 'macOS' : 'Windows';
            const downloadUrl = os === 'darwin'
                ? 'https://ollama.com/download/mac'
                : 'https://ollama.com/download/windows';

            formatInfo(
                `${theme.symbols.info} ${platformName} requires manual installation of Ollama.`,
            );
            formatInfo(`Please visit ${downloadUrl} to download and install Ollama.`);

            const shouldContinue = await Confirm.prompt({
                message: 'Would you like to continue configuration without installing Ollama now?',
                default: true,
            });

            if (!shouldContinue) {
                formatInfo('\nSetup canceled. Please run setup again after installing Ollama.');
                return undefined;
            }

            formatInfo('\nProceeding with configuration without Ollama.');
            return {
                model: defaultFallbackModel,
                api_url: 'http://localhost:11434',
            };
        }

        // Linux installation
        let installCommand = '';
        let startCommand = '';

        if (os === 'linux') {
            installCommand = 'curl -fsSL https://ollama.com/install.sh | sh';
            startCommand = 'ollama serve';

            const shouldInstall = await Confirm.prompt({
                message: 'Would you like to install Ollama?',
                default: true,
            });

            if (!shouldInstall) {
                formatInfo('\nSkipping Ollama installation.');
                return {
                    model: defaultFallbackModel,
                    api_url: 'http://localhost:11434',
                };
            }

            // Install Ollama
            formatInfo(`\n${theme.symbols.download} Installing Ollama...`);
            try {
                const installProcess = new Deno.Command('sh', {
                    args: ['-c', installCommand],
                });

                const installOutput = await installProcess.output();
                if (!installOutput.success) {
                    formatError(
                        `${theme.symbols.error} Failed to install Ollama: ${
                            new TextDecoder().decode(installOutput.stderr)
                        }`,
                    );
                    formatInfo('\nProceeding with configuration without Ollama.');
                    return {
                        model: defaultFallbackModel,
                        api_url: 'http://localhost:11434',
                    };
                }

                formatSuccess(`${theme.symbols.success} Ollama installed successfully!`);

                // Start Ollama service
                formatInfo(`\n${theme.symbols.run} Starting Ollama service...`);
                try {
                    const startProcess = new Deno.Command('sh', {
                        args: ['-c', startCommand],
                    });

                    // Run in background
                    startProcess.spawn();

                    // Wait for service to start
                    formatDim('Waiting for Ollama service to start...');
                    let attempts = 0;
                    const maxAttempts = 10;

                    while (attempts < maxAttempts) {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        ollamaAvailable = await checkOllama();
                        if (ollamaAvailable) {
                            formatSuccess(`${theme.symbols.success} Ollama service is running!`);
                            break;
                        }
                        attempts++;
                    }

                    if (!ollamaAvailable) {
                        formatError(
                            `${theme.symbols.error} Ollama service failed to start after ${maxAttempts} attempts.`,
                        );
                        formatInfo('\nProceeding with configuration without Ollama.');
                        return {
                            model: defaultFallbackModel,
                            api_url: 'http://localhost:11434',
                        };
                    }
                } catch (error) {
                    formatError(
                        `${theme.symbols.error} Failed to start Ollama service: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                    formatInfo('\nProceeding with configuration without Ollama.');
                    return {
                        model: defaultFallbackModel,
                        api_url: 'http://localhost:11434',
                    };
                }
            } catch (error) {
                formatError(
                    `${theme.symbols.error} Failed to install Ollama: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
                formatInfo('\nProceeding with configuration without Ollama.');
                return {
                    model: defaultFallbackModel,
                    api_url: 'http://localhost:11434',
                };
            }
        }
    } else {
        formatSuccess(`${theme.symbols.success} Ollama is already installed and running!`);
    }

    if (!ollamaAvailable) {
        formatInfo('\nOllama is not available. Configuring with default settings.');
        return {
            model: defaultFallbackModel, // Default model name as placeholder
            api_url: 'http://localhost:11434',
        };
    }

    // Model selection and installation
    formatInfo(`\n${theme.symbols.config} Configuring Ollama model...`);

    try {
        // Check for existing models
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        const availableModels = (data.models || []).map((m: OllamaModel) => m.name);

        // Recommended models with display names
        const recommendedModels: SelectOption[] = [
            { name: 'Qwen 3.2 (Recommended)', value: 'qwen3:1.7b' },
            { name: 'CodeLlama', value: 'codellama' },
            { name: 'Mistral', value: 'mistral' },
        ];

        let selectedModel: string;

        if (availableModels.length > 0) {
            // If models are available, let user choose from existing or pull new
            const useExisting = await Confirm.prompt({
                message: 'Would you like to use an existing model?',
                default: true,
            });

            if (useExisting) {
                const selection = await Select.prompt<string>({
                    message: 'Select a model to use:',
                    options: availableModels.map((m: string) => ({ name: m, value: m })),
                });
                selectedModel = selection;
            } else {
                const selection = await Select.prompt<string>({
                    message: 'Select a model to pull:',
                    options: recommendedModels,
                });
                selectedModel = selection;
                const pullSuccess = await pullOllamaModel(selectedModel);
                if (!pullSuccess) {
                    formatWarning(
                        `${theme.symbols.warning} Failed to pull model. Using model name as placeholder.`,
                    );
                }
            }
        } else {
            // If no models available, suggest pulling default model
            formatInfo(
                `${theme.symbols.info} No models found. We recommend starting with default model.`,
            );
            const selection = await Select.prompt<string>({
                message: 'Select a model to pull:',
                options: recommendedModels,
                default: defaultFallbackModel,
            });
            selectedModel = selection;
            const pullSuccess = await pullOllamaModel(selectedModel);
            if (!pullSuccess) {
                formatWarning(
                    `${theme.symbols.warning} Failed to pull model. Using model name as placeholder.`,
                );
            }
        }

        // Return the configuration instead of saving it directly
        return {
            model: selectedModel,
            api_url: 'http://localhost:11434',
        };
    } catch (error) {
        formatError(
            `${theme.symbols.error} Error configuring Ollama model: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        formatInfo('\nProceeding with default Ollama model.');
        return {
            model: defaultFallbackModel, // Default model name as placeholder
            api_url: 'http://localhost:11434',
        };
    }
}

async function checkAtlassianAuth(domain: string, email: string, token: string): Promise<boolean> {
    try {
        const auth = btoa(`${email}:${token}`);
        const response = await fetch(`${domain}/rest/api/3/myself`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
        });

        if (response.ok) {
            const data = await response.json();
            formatSuccess(`✅ Successfully authenticated as: ${data.displayName || email}`);
            return true;
        } else {
            formatError(`❌ Authentication failed: ${response.status} ${response.statusText}`);
            return false;
        }
    } catch (error) {
        formatError(
            `❌ Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        return false;
    }
}

async function setupAtlassian(existingConfig: Partial<ExtendedConfig>, emoji: string = '') {
    if (existingConfig.atlassian) {
        const shouldReconfigure = await Confirm.prompt({
            message:
                `${emoji} Atlassian configuration already exists. Would you like to reconfigure it?`,
            default: false,
        });

        if (!shouldReconfigure) {
            return existingConfig.atlassian;
        }
    }

    formatInfo('\nSetting up Atlassian (Jira & Confluence) integration...');

    const atlassian_url = await Input.prompt({
        message: 'Atlassian URL',
        hint: 'Your Atlassian instance URL (shared for both Jira & Confluence)',
        default: existingConfig.atlassian?.jira_url || 'https://atlassian.net',
    });

    const username = await Input.prompt({
        message: 'Atlassian Username (email)',
        hint: 'Your Atlassian account email',
        default: existingConfig.atlassian?.username || '',
    });

    formatInfo('\nTo create an Atlassian API token:');
    logger.passThrough(
        'log',
        formatList([
            '1. Go to https://id.atlassian.com/manage-profile/security/api-tokens',
            '2. Click "Create API token"',
            '3. Provide a label like "nova CLI" and click "Create"',
            '4. Copy the token value (it will only be shown once)',
        ]),
    );

    const api_token = await Secret.prompt({
        message: 'Atlassian API Token',
    });

    // Test the connection
    formatInfo('\nTesting Atlassian connection...');
    const authSuccessful = await checkAtlassianAuth(atlassian_url, username, api_token);

    if (!authSuccessful) {
        const shouldContinue = await Confirm.prompt({
            message:
                'Authentication failed. Would you like to continue with these credentials anyway?',
            default: false,
        });

        if (!shouldContinue) {
            formatInfo('Please try again with correct credentials.');
            return await setupAtlassian(existingConfig);
        }
    }

    return {
        jira_url: atlassian_url,
        jira_token: api_token,
        confluence_url: atlassian_url,
        confluence_token: api_token,
        username,
    };
}

// Helper functions to check if services are configured
function isServiceConfigured(config: Partial<Config>, service: keyof Config): boolean {
    if (!config || !config[service]) return false;

    logger.debug(`Checking ${service} configuration:`, config[service]);

    switch (service) {
        case 'gitlab': {
            const gitlab = config.gitlab as Config['gitlab'];
            const isConfigured = Boolean(gitlab?.url && gitlab?.token);
            logger.debug(`GitLab configured: ${isConfigured}`);
            return isConfigured;
        }
        case 'ai': {
            const ai = config.ai as Config['ai'];
            const isConfigured = Boolean(ai?.default_provider);
            logger.debug(`AI configured: ${isConfigured}`);
            return isConfigured;
        }
        case 'atlassian': {
            const atlassian = config.atlassian as Config['atlassian'];
            const isConfigured = Boolean(
                atlassian?.jira_url && atlassian?.jira_token &&
                    atlassian?.confluence_url && atlassian?.confluence_token &&
                    atlassian?.username,
            );
            logger.debug(`Atlassian configured: ${isConfigured}`);
            return isConfigured;
        }
        case 'datadog': {
            const datadog = config.datadog as Config['datadog'];
            const isConfigured = Boolean(datadog?.api_key && datadog?.app_key);
            logger.debug(`Datadog configured: ${isConfigured}`);
            return isConfigured;
        }
        default:
            return false;
    }
}

// Add to setup command
async function _setupShellCompletions(): Promise<void> {
    formatInfo('\n🔄 Setting up shell completions...');

    try {
        // Create completions directory
        await Deno.mkdir('~/.zsh/completions', { recursive: true });

        // Generate completions
        const process = new Deno.Command(Deno.execPath(), {
            args: ['task', 'completions', 'zsh'],
            stdout: 'piped',
        });
        const { stdout } = await process.output();

        // Save completions
        await Deno.writeTextFile('~/.zsh/completions/_nova', new TextDecoder().decode(stdout));

        formatSuccess('✓ Shell completions installed');
        formatDim('Add this to your ~/.zshrc:');
        formatDim('fpath=(~/.zsh/completions $fpath)');
        formatDim('autoload -U compinit');
        formatDim('compinit');
    } catch (error) {
        formatError('Failed to install shell completions:');
        console.error(String(error));
    }
}

interface DatadogConfig {
    api_key: string;
    app_key: string;
    site: string;
}

async function setupDatadog(
    existingConfig: Partial<ExtendedConfig>,
    emoji: string = '',
): Promise<DatadogConfig | undefined> {
    const datadogConfigured = Boolean(
        existingConfig.datadog?.api_key && existingConfig.datadog?.app_key,
    );

    if (datadogConfigured) {
        const shouldReconfigure = await Confirm.prompt({
            message:
                `${emoji} Datadog configuration already exists. Would you like to reconfigure it?`,
            default: false,
        });

        if (!shouldReconfigure) {
            return existingConfig.datadog;
        }
    }

    formatInfo('\nSetting up Datadog integration...');

    const apiKey = await Secret.prompt({
        message: 'Datadog API Key',
        hint: 'Get it from Datadog > Organization Settings > API Keys',
    });

    const appKey = await Secret.prompt({
        message: 'Datadog Application Key',
        hint: 'Get it from Datadog > Organization Settings > Application Keys',
    });

    const site = await Input.prompt({
        message: 'Datadog Site (Optional)',
        hint: 'e.g., datadoghq.eu as default',
        default: existingConfig.datadog?.site || 'datadoghq.eu',
    });

    return {
        api_key: apiKey,
        app_key: appKey,
        site,
    };
}

async function setupAI(existingConfig: Partial<ExtendedConfig>): Promise<AIConfig> {
    formatInfo('\n🤖 Setting up AI Integration');

    // Determine which providers are already configured
    const hasnova = Boolean(existingConfig.ai?.nova?.api_key);
    const hasOpenAI = Boolean(existingConfig.ai?.openai?.api_key);
    const hasAzure = Boolean(existingConfig.ai?.azure?.api_key);
    const hasOllama = Boolean(existingConfig.ai?.ollama?.model);
    const hasCopilot = await checkGitHubCopilot();

    // Show current status
    formatInfo('\nCurrent AI Providers:');
    // logger.passThrough('log', `${hasnova ? '✅' : '❌'} Nova LLM Gateway (Recommended)`);
    logger.passThrough('log', `${hasOpenAI ? '✅' : '❌'} OpenAI`);
    logger.passThrough('log', `${hasAzure ? '✅' : '❌'} Azure OpenAI`);
    logger.passThrough('log', `${hasOllama ? '✅' : '❌'} Ollama`);
    logger.passThrough('log', `${hasCopilot ? '✅' : '❌'} GitHub Copilot`);

    const aiConfig: AIConfig = {
        default_provider: existingConfig.ai?.default_provider || 'nova',
        nova: existingConfig.ai?.nova,
        openai: existingConfig.ai?.openai,
        azure: existingConfig.ai?.azure,
        ollama: existingConfig.ai?.ollama,
        copilot: existingConfig.ai?.copilot,
    };

    // Setup Nova LLM Gateway first (recommended)
    // Todo: Implement Nova LLM Gateway setup
    // const setupnovaProvider = await Confirm.prompt({
    //   message: hasnova
    //     ? 'Would you like to reconfigure Nova LLM Gateway?'
    //     : 'Would you like to configure Nova LLM Gateway? (Recommended)',
    //   default: !hasnova,
    // });

    // if (setupnovaProvider) {
    //   const nova = await setupnova(existingConfig);
    //   if (nova) {
    //     aiConfig.nova = nova;
    //   }
    // }

    // Setup OpenAI (optional)
    const setupOpenAIProvider = await Confirm.prompt({
        message: hasOpenAI
            ? 'Would you like to reconfigure OpenAI?'
            : 'Would you like to configure OpenAI? (Optional)',
        default: false,
    });

    if (setupOpenAIProvider) {
        const openai = await setupOpenAI(existingConfig);
        if (openai) {
            const defaultModel = await Select.prompt({
                message: 'Default OpenAI model',
                options: [
                    { name: 'GPT-4', value: 'gpt-4' as const },
                    { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' as const },
                    { name: 'GPT-4.1', value: 'gpt-4.1' as const },
                    { name: 'GPT-4.1-Mini', value: 'gpt-4.1-mini' as const },
                    { name: 'GPT-4.1-Nano', value: 'gpt-4.1-nano' as const },
                    { name: 'GPT-4.5-Preview', value: 'gpt-4.5-preview' as const },
                    { name: 'GPT-4o', value: 'gpt-4o' as const },
                    { name: 'GPT-4o-Mini', value: 'gpt-4o-mini' as const },
                ],
                default: 'gpt-4',
            });

            aiConfig.openai = {
                ...openai,
                default_model: defaultModel as OpenAIModel,
            };
        }
    }

    // Setup Azure OpenAI (optional)
    const setupAzure = await Confirm.prompt({
        message: hasAzure
            ? 'Would you like to reconfigure Azure OpenAI?'
            : 'Would you like to configure Azure OpenAI? (Optional)',
        default: false,
    });

    if (setupAzure) {
        const azure = {
            api_key: await Secret.prompt({
                message: 'Azure OpenAI API Key',
                default: existingConfig.ai?.azure?.api_key || '',
            }),
            api_url: await Input.prompt({
                message: 'Azure OpenAI API URL',
                default: existingConfig.ai?.azure?.api_url || '',
            }),
            api_version: await Input.prompt({
                message: 'Azure OpenAI API Version',
                default: existingConfig.ai?.azure?.api_version || '2024-02-15-preview',
            }),
            deployment_name: await Input.prompt({
                message: 'Azure OpenAI Deployment Name',
                default: existingConfig.ai?.azure?.deployment_name || '',
            }),
        };
        aiConfig.azure = azure;
    }

    // Setup Ollama (optional)
    const setupOllamaProvider = await Confirm.prompt({
        message: hasOllama
            ? 'Would you like to reconfigure Ollama?'
            : 'Would you like to configure Ollama? (Optional)',
        default: false,
    });

    if (setupOllamaProvider) {
        const ollama = await setupOllama(existingConfig);
        if (ollama) {
            aiConfig.ollama = {
                model: ollama.model,
                api_url: ollama.api_url,
            };
        }
    }

    // Setup GitHub Copilot (optional)
    const setupCopilotProvider = await Confirm.prompt({
        message: hasCopilot
            ? 'Would you like to reconfigure GitHub Copilot?'
            : 'Would you like to configure GitHub Copilot? (Optional)',
        default: false,
    });

    if (setupCopilotProvider) {
        await setupGitHubCopilot();
        aiConfig.copilot = {
            enabled: true,
        };
    }

    // Set default provider - prioritize nova
    const availableProviders = Object.entries({
        nova: Boolean(aiConfig.nova),
        openai: Boolean(aiConfig.openai),
        azure: Boolean(aiConfig.azure),
        ollama: Boolean(aiConfig.ollama),
        // Exclude copilot from default provider options as it doesn't support enough features
    })
        .filter(([_, isConfigured]) => isConfigured)
        .map(([provider]) => provider);

    if (availableProviders.length > 0) {
        // If nova is available, use it as default, otherwise keep existing preference
        const defaultProvider = aiConfig.nova
            ? 'nova'
            : (aiConfig.default_provider || availableProviders[0]);

        if (availableProviders.length > 1) {
            aiConfig.default_provider = await Select.prompt({
                message: 'Select default AI provider',
                options: availableProviders.map((provider) => ({
                    name: provider === 'nova' ? 'nova LLM Gateway (Recommended)' : provider,
                    value: provider,
                })),
                default: defaultProvider,
            }) as AIConfig['default_provider'];
        } else {
            aiConfig.default_provider = availableProviders[0] as AIConfig['default_provider'];
        }
    } else {
        // If no providers are configured, default to nova
        aiConfig.default_provider = 'nova';
    }

    return aiConfig;
}

export const setupCommand = new Command()
    .name('setup')
    .description('Interactive setup for nova configuration')
    .option('--skip-tests', 'Skip testing connections after setup', { default: false })
    .action(async (options) => {
        formatInfo('\n🛠 Setting up nova...\n');

        // Load existing configuration if available
        let existingConfig: Partial<ExtendedConfig> = {};
        let isFirstTimeSetup = false;

        try {
            // Check if config file exists
            if (await exists(`${Deno.env.get('HOME')}/.nova/config.json`)) {
                existingConfig = await configManager.loadConfig() as Partial<ExtendedConfig>;

                // Show initial configuration status
                formatInfo('Current Configuration:');
                const statusService = new StatusService();
                const initialStatuses = await statusService.getAllStatuses(
                    existingConfig as Config,
                );
                statusService.displayStatusTable(initialStatuses);
            } else {
                isFirstTimeSetup = true;
                formatInfo('No existing configuration found. Starting first-time setup...');
            }
        } catch {
            // Ignore errors, treat as no existing config
            isFirstTimeSetup = true;
            formatInfo('No existing configuration found. Starting first-time setup...');
        }

        formatInfo('Setting up Authentication Services:');

        // Create a config object to store all settings
        const config: ExtendedConfig = {
            gitlab: existingConfig.gitlab || { url: '', token: '' },
        };

        // GitLab setup (required)
        const gitlabConfigured = isServiceConfigured(existingConfig, 'gitlab');
        const gitlabEmoji = gitlabConfigured ? theme.symbols.update : theme.symbols.new;
        const gitlab = await setupGitLab(existingConfig, gitlabEmoji);
        if (gitlab) {
            config.gitlab = gitlab; // Save GitLab config immediately
        }

        // Atlassian setup (optional)
        const atlassianConfigured = isServiceConfigured(existingConfig, 'atlassian');
        const atlassianEmoji = atlassianConfigured ? theme.symbols.update : theme.symbols.new;

        const shouldSetupAtlassian = await Confirm.prompt({
            message: `${atlassianEmoji} ${
                atlassianConfigured
                    ? 'Atlassian is configured. Would you like to reconfigure it?'
                    : 'Would you like to set up Atlassian (Jira & Confluence) integration? (Optional)'
            }`,
            default: false,
        });

        if (shouldSetupAtlassian) {
            const atlassian = await setupAtlassian(existingConfig, atlassianEmoji);
            if (atlassian) {
                config.atlassian = atlassian; // Save Atlassian config immediately
            }
        } else if (atlassianConfigured) {
            config.atlassian = existingConfig.atlassian;
        }

        // Datadog setup (optional)
        let datadog = undefined;
        const datadogConfigured = isServiceConfigured(existingConfig, 'datadog');
        const datadogEmoji = datadogConfigured ? theme.symbols.update : theme.symbols.new;
        const shouldSetupDatadog = await Confirm.prompt({
            message: `${datadogEmoji} ${
                datadogConfigured
                    ? 'Datadog is configured. Would you like to reconfigure it?'
                    : 'Would you like to set up Datadog integration? (Optional)'
            }`,
            default: false,
        });

        if (shouldSetupDatadog) {
            datadog = await setupDatadog(existingConfig, datadogEmoji);
            if (datadog) {
                config.datadog = datadog;
            }
        } else if (existingConfig.datadog) {
            datadog = existingConfig.datadog;
        }

        // --------------------------------
        // LLM Integration Section
        // --------------------------------
        formatInfo('\nSetting up AI Integration:');
        const ai = await setupAI(existingConfig);
        if (ai) config.ai = ai;

        // Remove old OpenAI and Ollama sections since they're now part of AI config
        delete config.openai;
        delete config.ollama;

        try {
            // Save the configuration
            logger.debug('Configuration being saved:', JSON.stringify(config, null, 2));
            await configManager.saveConfig(config as Config);
            formatSuccess('\n✨ Setup completed successfully!\n');

            // After saving configuration, show updated status
            formatInfo('\nConfiguration Status:');
            if (!options.skipTests && !isFirstTimeSetup) {
                const statusService = new StatusService();
                const finalStatuses = await statusService.getAllStatuses(config as Config);
                statusService.displayStatusTable(finalStatuses);
            }

            // Show available commands
            formatInfo('\nPrimary Commands:');
            logger.passThrough(
                'log',
                '  nova setup             - Interactive setup for nova configuration',
            );
            logger.passThrough('log', '  nova gitlab            - GitLab operations');
            logger.passThrough(
                'log',
                '  nova agent eng         - Engineering Agent (uses OpenAI, Azure, Ollama)',
            );
            logger.passThrough('log', '  nova agent pm          - Project Manager');

            formatInfo('\nUtility Commands:');
            logger.passThrough('log', '  nova config            - Manage nova configuration');
            logger.passThrough('log', '  nova config list       - List all configuration values');
            logger.passThrough(
                'log',
                '  nova config get        - Get specific configuration value',
            );
            logger.passThrough(
                'log',
                '  nova config set        - Set specific configuration value',
            );
            logger.passThrough('log', '');
        } catch (error) {
            if (error instanceof Error) {
                logger.error('Error saving config:', error.message);
            } else {
                logger.error('An unknown error occurred while saving config');
            }
            throw error;
        }
    });
