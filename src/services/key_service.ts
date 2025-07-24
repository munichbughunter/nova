import { crypto } from '@std/crypto';
import { encodeBase64 } from '@std/encoding/base64';
import { exists } from '@std/fs/exists';
import { Input } from '@cliffy/prompt';
import { ConfigManager } from '../config/mod.ts';
import { formatError, formatInfo, formatSuccess } from '../utils.ts';
import { Logger } from '../utils/logger.ts';

interface APIKey {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed?: string;
  description?: string;
}

interface KeyStore {
  keys: APIKey[];
  encrypted: boolean;
  version: string;
}

export class KeyService {
  private static instance: KeyService | null = null;
  private logger: Logger;
  private configManager: ConfigManager;
  private keyStorePath: string;

  constructor() {
    this.logger = new Logger('KeyService', Deno.env.get('nova_DEBUG') === 'true');
    this.configManager = ConfigManager.getInstance();
    this.keyStorePath = `${Deno.env.get('HOME')}/.nova/keys.json`;
  }

  public static getInstance(): KeyService {
    if (!KeyService.instance) {
      KeyService.instance = new KeyService();
    }
    return KeyService.instance;
  }

  /**
   * Generate a new API key via nova LLM Gateway
   */
  async generateKey(name: string, description?: string): Promise<string> {
    try {
      const _config = await this.configManager.loadConfig();
      // For now, we'll generate a secure random key
      // In the future, this should call the actual nova API at _config.ai?.nova?.api_url
      
      // For now, we'll generate a secure random key
      // In the future, this should call the actual nova API
      const keyBytes = new Uint8Array(32);
      crypto.getRandomValues(keyBytes);
      const keyBase64 = encodeBase64(keyBytes);
      const apiKey = `sk-${keyBase64.replace(/[+/=]/g, '').substring(0, 43)}`;

      // Store the key
      await this.storeKey({
        id: crypto.randomUUID(),
        name,
        key: apiKey,
        created: new Date().toISOString(),
        description
      });

      formatSuccess('✅ API Key generated successfully!');
      formatInfo(`Key Name: ${name}`);
      if (description) {
        formatInfo(`Description: ${description}`);
      }
      formatInfo(`Created: ${new Date().toLocaleString()}`);
      
      return apiKey;
    } catch (error) {
      formatError('Failed to generate API key');
      throw error;
    }
  }

  /**
   * List all stored API keys
   */
  async listKeys(): Promise<APIKey[]> {
    try {
      const keyStore = await this.loadKeyStore();
      return keyStore.keys.map(key => ({
        ...key,
        key: this.maskKey(key.key) // Mask the key for display
      }));
    } catch (error) {
      this.logger.debug('Error listing keys:', error);
      return [];
    }
  }

  /**
   * Get a specific API key by name or ID
   */
  async getKey(nameOrId: string): Promise<APIKey | null> {
    try {
      const keyStore = await this.loadKeyStore();
      return keyStore.keys.find(key => 
        key.name === nameOrId || key.id === nameOrId
      ) || null;
    } catch (error) {
      this.logger.debug('Error getting key:', error);
      return null;
    }
  }

  /**
   * Delete an API key by name or ID
   */
  async deleteKey(nameOrId: string): Promise<boolean> {
    try {
      const keyStore = await this.loadKeyStore();
      const initialLength = keyStore.keys.length;
      keyStore.keys = keyStore.keys.filter(key => 
        key.name !== nameOrId && key.id !== nameOrId
      );
      
      if (keyStore.keys.length < initialLength) {
        await this.saveKeyStore(keyStore);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.debug('Error deleting key:', error);
      return false;
    }
  }

  /**
   * Update the last used timestamp for a key
   */
  async markKeyUsed(nameOrId: string): Promise<void> {
    try {
      const keyStore = await this.loadKeyStore();
      const key = keyStore.keys.find(k => k.name === nameOrId || k.id === nameOrId);
      if (key) {
        key.lastUsed = new Date().toISOString();
        await this.saveKeyStore(keyStore);
      }
    } catch (error) {
      this.logger.debug('Error marking key as used:', error);
    }
  }

  /**
   * Interactive key creation wizard
   */
  async createKeyInteractive(): Promise<string> {
    formatInfo('🔑 Create New API Key');
    
    const name = await Input.prompt({
      message: 'Key name (for identification)',
      hint: 'e.g., "my-dev-key", "prod-deployment"'
    });

    if (!name) {
      throw new Error('Key name is required');
    }

    // Check if name already exists
    const existingKey = await this.getKey(name);
    if (existingKey) {
      throw new Error(`Key with name "${name}" already exists`);
    }

    const description = await Input.prompt({
      message: 'Description (optional)',
      hint: 'Brief description of what this key is used for'
    });

    return await this.generateKey(name, description || undefined);
  }

  /**
   * Set a key as the default for Nova configuration
   */
  async setDefaultKey(nameOrId: string): Promise<void> {
    const key = await this.getKey(nameOrId);
    if (!key) {
      throw new Error('Key not found');
    }

    try {
      const config = await this.configManager.loadConfig();
      
      // Update the Nova configuration with this key
      if (!config.ai) {
        config.ai = {
          default_provider: 'nova'
        };
      }
      if (!config.ai.nova) {
        config.ai.nova = {
          api_key: key.key,
          api_url: 'https://llmgw.nova.de',
          default_model: 'claude-3-5-sonnet-20241022'
        };
      } else {
        config.ai.nova.api_key = key.key;
      }

      await this.configManager.saveConfig(config);
      await this.markKeyUsed(nameOrId);
      
      formatSuccess(`✅ Set "${key.name}" as default API key`);
    } catch (error) {
      formatError('Failed to set default key');
      throw error;
    }
  }

  private async loadKeyStore(): Promise<KeyStore> {
    try {
      if (!await exists(this.keyStorePath)) {
        return {
          keys: [],
          encrypted: false,
          version: '1.0'
        };
      }

      const content = await Deno.readTextFile(this.keyStorePath);
      return JSON.parse(content) as KeyStore;
    } catch (error) {
      this.logger.debug('Error loading key store:', error);
      return {
        keys: [],
        encrypted: false,
        version: '1.0'
      };
    }
  }

  private async saveKeyStore(keyStore: KeyStore): Promise<void> {
    // Ensure the directory exists
    const dir = this.keyStorePath.substring(0, this.keyStorePath.lastIndexOf('/'));
    await Deno.mkdir(dir, { recursive: true });
    
    await Deno.writeTextFile(this.keyStorePath, JSON.stringify(keyStore, null, 2));
    
    // Set restrictive permissions on the key store
    await Deno.chmod(this.keyStorePath, 0o600);
  }

  private async storeKey(key: APIKey): Promise<void> {
    const keyStore = await this.loadKeyStore();
    keyStore.keys.push(key);
    await this.saveKeyStore(keyStore);
  }

  private maskKey(key: string): string {
    if (key.length <= 8) return '***';
    return key.substring(0, 8) + '***' + key.substring(key.length - 4);
  }
}