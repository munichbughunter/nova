import type { Config } from '../config/types.ts';
import type { Logger } from '../utils/logger.ts';
import {
    LLMProvider,
    OllamaProvider,
    OpenAIProvider,
    FallbackProvider,
} from './llm-providers.ts';

/**
 * Configuration for LLM provider creation
 */
export interface LLMProviderConfig {
    provider: 'openai' | 'azure' | 'ollama' | 'copilot' | 'auto';
    model?: string;
    fallbackToConsole?: boolean;
}

/**
 * Factory function to create LLM providers with automatic fallback
 */
export async function createLLMProvider(
    config: Config,
    logger: Logger,
    providerConfig?: LLMProviderConfig,
): Promise<LLMProvider> {
    const childLogger = logger.child('LLMFactory');
    const requestedProvider = providerConfig?.provider || config.ai?.default_provider || 'auto';
    
    childLogger.debug(`Creating LLM provider: ${requestedProvider}`);

    // If a specific provider is requested, try it first
    if (requestedProvider !== 'auto') {
        const provider = await createSpecificProvider(requestedProvider, config, childLogger);
        if (provider && await provider.isAvailable()) {
            childLogger.info(`LLM provider ${provider.name} is ready`);
            
            // Set model if specified
            if (providerConfig?.model) {
                provider.setModel(providerConfig.model);
                childLogger.debug(`Set model to: ${providerConfig.model}`);
            }
            
            return provider;
        }
        
        childLogger.warn(`Requested provider ${requestedProvider} is not available`);
    }

    // Auto-detection: try providers in order of preference
    const providerOrder: Array<'openai' | 'ollama'> = ['openai', 'ollama'];
    
    for (const providerName of providerOrder) {
        try {
            const provider = await createSpecificProvider(providerName, config, childLogger);
            if (provider && await provider.isAvailable()) {
                childLogger.info(`Auto-detected LLM provider: ${provider.name}`);
                
                // Set model if specified
                if (providerConfig?.model) {
                    provider.setModel(providerConfig.model);
                    childLogger.debug(`Set model to: ${providerConfig.model}`);
                }
                
                return provider;
            }
        } catch (error) {
            childLogger.debug(`Provider ${providerName} unavailable:`, error);
        }
    }

    // Fallback to console provider
    childLogger.warn('No LLM providers available, using fallback');
    return new FallbackProvider(childLogger);
}

/**
 * Create a specific LLM provider instance
 */
function createSpecificProvider(
    providerName: string,
    config: Config,
    logger: Logger,
): Promise<LLMProvider | null> {
    try {
        switch (providerName) {
            case 'openai':
            case 'azure':
                if (!config.ai?.openai?.api_key) {
                    logger.debug('OpenAI provider requires API key');
                    return Promise.resolve(null);
                }
                return Promise.resolve(new OpenAIProvider(config.ai, logger));

            case 'ollama':
                return Promise.resolve(new OllamaProvider(config.ai, logger));

            case 'copilot':
                // TODO: Implement GitHub Copilot provider
                logger.debug('GitHub Copilot provider not yet implemented');
                return Promise.resolve(null);

            default:
                logger.warn(`Unknown provider: ${providerName}`);
                return Promise.resolve(null);
        }
    } catch (error) {
        logger.error(`Failed to create ${providerName} provider:`, error);
        return Promise.resolve(null);
    }
}

/**
 * Get provider recommendations based on current configuration
 */
export function getProviderRecommendations(config: Config): {
    available: string[];
    recommended: string;
    missing: Array<{ provider: string; requirement: string }>;
} {
    const available: string[] = [];
    const missing: Array<{ provider: string; requirement: string }> = [];

    // Check OpenAI
    if (config.ai?.openai?.api_key) {
        available.push('openai');
    } else {
        missing.push({
            provider: 'openai',
            requirement: 'API key in config.ai.openai.api_key',
        });
    }

    // Ollama is always potentially available (depends on local installation)
    available.push('ollama');

    // Determine recommended provider
    let recommended = 'ollama'; // Default to local
    if (available.includes('openai')) {
        recommended = 'openai'; // Prefer cloud if available
    }

    return { available, recommended, missing };
}

/**
 * Validate LLM provider configuration
 */
export function validateLLMConfig(config: Config): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
} {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if AI config exists
    if (!config.ai) {
        warnings.push('No AI configuration found - only fallback provider will be available');
        return { isValid: true, errors, warnings };
    }

    // Validate OpenAI config if present
    if (config.ai.openai) {
        if (!config.ai.openai.api_key) {
            warnings.push('OpenAI API key not configured');
        }
        
        if (config.ai.openai.api_url && !config.ai.openai.api_url.startsWith('https://')) {
            warnings.push('OpenAI API URL should use HTTPS');
        }
    }

    // Validate Ollama config if present
    if (config.ai.ollama) {
        if (config.ai.ollama.api_url && !config.ai.ollama.api_url.startsWith('http')) {
            errors.push('Invalid Ollama API URL format');
        }
    }

    // Check default provider
    if (config.ai.default_provider) {
        const validProviders = ['openai', 'azure', 'ollama', 'copilot', 'auto'];
        if (!validProviders.includes(config.ai.default_provider)) {
            errors.push(`Invalid default provider: ${config.ai.default_provider}`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Test LLM provider connectivity and basic functionality
 */
export async function testLLMProvider(
    provider: LLMProvider,
    logger: Logger,
): Promise<{
    success: boolean;
    results: {
        availability: boolean;
        models: string[];
        basicGeneration: boolean;
        errors: string[];
    };
}> {
    const testLogger = logger.child('LLMTest');
    const results = {
        availability: false,
        models: [] as string[],
        basicGeneration: false,
        errors: [] as string[],
    };

    try {
        // Test availability
        testLogger.debug('Testing provider availability...');
        results.availability = await provider.isAvailable();
        
        if (!results.availability) {
            results.errors.push('Provider is not available');
            return { success: false, results };
        }

        // Test model listing
        testLogger.debug('Testing model listing...');
        try {
            results.models = await provider.listModels();
            testLogger.debug(`Found ${results.models.length} models`);
        } catch (error) {
            results.errors.push(`Model listing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Test basic generation
        testLogger.debug('Testing basic generation...');
        try {
            const testPrompt = 'Respond with exactly: "test successful"';
            const response = await provider.generate(testPrompt, {
                maxTokens: 50,
                temperature: 0,
            });
            
            results.basicGeneration = response.toLowerCase().includes('test successful');
            if (!results.basicGeneration) {
                results.errors.push('Basic generation test failed - unexpected response');
            }
        } catch (error) {
            results.errors.push(`Generation test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const success = results.availability && results.basicGeneration && results.errors.length === 0;
        testLogger.info(`Provider test ${success ? 'passed' : 'failed'}`);
        
        return { success, results };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        testLogger.error('Provider test failed:', error);
        results.errors.push(`Test execution failed: ${errorMsg}`);
        
        return { success: false, results };
    }
}
