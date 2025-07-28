import { exists } from '@std/fs/exists';
import { Logger } from '../utils/logger.ts';
import { Config, ConfigSchema } from './types.ts';

export type { Config } from './types.ts';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: Config | null = null;
  private configDir = `${Deno.env.get('HOME')}/.nova`;
  private configPath = `${this.configDir}/config.json`;
  private debug = Deno.env.get('nova_DEBUG') === 'true';
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('Config', this.debug);
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Ensure config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await Deno.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
  }

  /**
   * Load configuration from all sources in priority order
   */
  public async loadConfig(): Promise<Config> {
    // Reset cache if AI-related env vars are present
    const aiEnvVars = [
      'OPENAI_API_KEY',
      'OPENAI_URL',
      'OPENAI_API_VERSION',
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_API_ENDPOINT',
      'AZURE_OPENAI_API_VERSION',
      'AZURE_OPENAI_DEPLOYMENT_NAME',
    ];

    const hasAiEnvVars = aiEnvVars.some((key) => Deno.env.get(key) !== undefined);
    if (hasAiEnvVars) {
      this.config = null;
    }

    if (this.config) return this.config;

    await this.ensureConfigDir();

    // 1. Load environment variables
    const envConfig = this.loadEnvConfig();
    // INFO: debug remove envConfig AI for now
    // envConfig.ai = undefined;

    // 2. Load config file if it exists
    const fileConfig = await this.loadFileConfig();
    // 3. Merge configurations with environment variables taking precedence
    const mergedConfig = this.mergeConfigs(fileConfig, envConfig); // fileConfig first, then envConfig to override

    // 4. Validate the configuration
    const validatedConfig = this.validateConfig(mergedConfig);

    // 5. Ensure AI configuration is properly structured
    if (validatedConfig.ai) {
      // Set default provider if not set
      if (!validatedConfig.ai.default_provider) {
        validatedConfig.ai.default_provider = validatedConfig.ai.azure ? 'azure' : 'openai';
      }
      // Ensure copilot is always present
      validatedConfig.ai.copilot = validatedConfig.ai.copilot || { enabled: true };
    }

    this.config = validatedConfig;
    return validatedConfig;
  }

  /**
   * Load configuration from environment variables
   */
  private loadEnvConfig(): Partial<Config> {
    const envConfig: Partial<Config> = {};

    // GitLab config
    const gitlabUrl = Deno.env.get('GITLAB_URL');
    const gitlabToken = Deno.env.get('GITLAB_TOKEN');
    if (gitlabUrl || gitlabToken) {
      envConfig.gitlab = {
        url: gitlabUrl ?? '',
        token: gitlabToken ?? '',
      };
    }

    // AI config
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const openaiUrl = Deno.env.get('OPENAI_URL');
    const openaiVersion = Deno.env.get('OPENAI_API_VERSION');
    const azureKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_API_ENDPOINT');
    const azureVersion = Deno.env.get('AZURE_OPENAI_API_VERSION');
    const azureDeployment = Deno.env.get('AZURE_OPENAI_DEPLOYMENT_NAME');

    if (
      openaiKey || openaiUrl || openaiVersion || azureKey || azureEndpoint || azureVersion ||
      azureDeployment
    ) {
      envConfig.ai = {
        default_provider: azureKey ? 'azure' : 'openai',
        ...(openaiKey && {
          openai: {
            api_key: openaiKey,
            api_url: openaiUrl ?? 'https://api.openai.com/v1',
            api_version: openaiVersion ?? '2024-02-15',
            default_model: 'gpt-4',
          },
        }),
        ...(azureKey && {
          azure: {
            api_key: azureKey,
            api_url: azureEndpoint ?? '',
            api_version: azureVersion ?? '2024-02-15',
            deployment_name: azureDeployment ?? 'gpt-4',
          },
        }),
        copilot: {
          enabled: true,
        },
      };
    }

    // Create a display version for logging
    const displayConfig = JSON.parse(JSON.stringify(envConfig));
    if (displayConfig.gitlab?.token) displayConfig.gitlab.token = '***';
    if (displayConfig.atlassian?.jira_token) displayConfig.atlassian.jira_token = '***';
    if (displayConfig.atlassian?.confluence_token) displayConfig.atlassian.confluence_token = '***';
    if (displayConfig.ai?.openai?.api_key) displayConfig.ai.openai.api_key = '***';
    if (displayConfig.ai?.azure?.api_key) displayConfig.ai.azure.api_key = '***';
    if (displayConfig.datadog?.api_key) displayConfig.datadog.api_key = '***';
    if (displayConfig.datadog?.app_key) displayConfig.datadog.app_key = '***';

    this.logger.debug('Loaded env config:', displayConfig);
    return envConfig; // Return the original config, not the display version
  }

  /**
   * Load configuration from file
   */
  private async loadFileConfig(): Promise<Partial<Config>> {
    try {
      if (await exists(this.configPath)) {
        const fileContent = await Deno.readTextFile(this.configPath);
        // Parse the original config
        const originalConfig = JSON.parse(fileContent);

        // Create a completely separate copy for display
        const displayConfig = JSON.parse(JSON.stringify(originalConfig));
        if (displayConfig.gitlab?.token) displayConfig.gitlab.token = '***';
        if (displayConfig.atlassian?.jira_token) displayConfig.atlassian.jira_token = '***';
        if (displayConfig.atlassian?.confluence_token) {
          displayConfig.atlassian.confluence_token = '***';
        }
        if (displayConfig.ai?.openai?.api_key) displayConfig.ai.openai.api_key = '***';
        if (displayConfig.ai?.azure?.api_key) displayConfig.ai.azure.api_key = '***';
        if (displayConfig.datadog?.api_key) displayConfig.datadog.api_key = '***';
        if (displayConfig.datadog?.app_key) displayConfig.datadog.app_key = '***';

        this.logger.debug('Loaded config from file:', displayConfig);
        return originalConfig; // Return the untouched original
      }
      // Return empty default config when no file exists
      return {
        gitlab: { url: '', token: '' },
      };
    } catch (error) {
      this.logger.debug('Error loading config file:', error);
      throw new Error(`Failed to load config file: ${error}`);
    }
  }

  /**
   * Merge configurations from different sources
   */
  private mergeConfigs(
    ...configs: Partial<Config>[]
  ): Partial<Config> {
    // Start with empty config as the accumulator (not default values)
    const defaultConfig: Config = {
      gitlab: { url: '', token: '' },
    };

    return configs.reduce((acc, curr) => {
      // Create a deep copy to avoid modifying the original objects
      const merged = JSON.parse(JSON.stringify(acc));

      // Type-safe merging of each config section
      if (curr.gitlab) {
        const { url, token } = curr.gitlab;
        merged.gitlab = {
          ...merged.gitlab,
          ...(url ? { url } : {}),
          ...(token ? { token } : {}),
        };
      }
      if (curr.ai) {
        merged.ai = { ...merged.ai, ...curr.ai };
      }
      if (curr.atlassian) {
        merged.atlassian = { ...curr.atlassian };
      }
      if (curr.datadog) {
        merged.datadog = { ...curr.datadog };
      }

      return merged;
    }, defaultConfig);
  }

  /**
   * Validate configuration against schema
   */
  private validateConfig(
    config: Partial<Config>,
  ): Config {
    try {
      // Validate with schema
      const validConfig = ConfigSchema.parse(config);
      return validConfig;
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.debug('Validation error:', error.message);
      }
      // Instead of returning empty config, return the original config
      return config as Config;
    }
  }

  /**
   * Save configuration to file
   */
  public async saveConfig(config: Config): Promise<void> {
    await this.ensureConfigDir();

    try {
      // Create a separate copy for display/logging
      const displayConfig = JSON.parse(JSON.stringify(config));
      if (displayConfig.gitlab?.token) displayConfig.gitlab.token = '***';
      if (displayConfig.atlassian?.jira_token) displayConfig.atlassian.jira_token = '***';
      if (displayConfig.atlassian?.confluence_token) {
        displayConfig.atlassian.confluence_token = '***';
      }
      if (displayConfig.ai?.openai?.api_key) displayConfig.ai.openai.api_key = '***';
      if (displayConfig.ai?.azure?.api_key) displayConfig.ai.azure.api_key = '***';
      if (displayConfig.datadog?.api_key) displayConfig.datadog.api_key = '***';
      if (displayConfig.datadog?.app_key) displayConfig.datadog.app_key = '***';

      this.logger.debug('Saving config:', displayConfig);

      // Save the original validated config
      await Deno.writeTextFile(this.configPath, JSON.stringify(config, null, 2));
      this.config = null; // Reset cached config
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Error saving config:', error.message);
      } else {
        this.logger.error('An unknown error occurred while saving config');
      }
      throw error;
    }
  }

  /**
   * Test all connections
   */
  public async testConnections(): Promise<Record<string, boolean>> {
    const config = await this.loadConfig();
    const results: Record<string, boolean> = {};

    // Skip tests if config is empty or has no values set
    if (!config || (!config.gitlab?.url && !config.ai)) {
      return results;
    }

    // Test GitLab connection
    if (config.gitlab?.url && config.gitlab?.token) {
      try {
        const url = `${config.gitlab.url}/api/v4/user`;
        const gitlabResponse = await fetch(url, {
          headers: { 'PRIVATE-TOKEN': config.gitlab.token },
        });

        if (!gitlabResponse.ok) {
          const _errorText = await gitlabResponse.text();
          results.gitlab = false;
        } else {
          const userData = await gitlabResponse.json();
          results.gitlab = true;
          results.gitlab_username = userData.username;
        }
      } catch (_error) {
        results.gitlab = false;
      }
    }

    return results;
  }
}

export const configManager = ConfigManager.getInstance();
