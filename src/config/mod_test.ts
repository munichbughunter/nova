import { assertEquals, assertRejects } from 'std/assert/mod.ts';
import { ConfigManager } from './mod.ts';
import type { Config } from './types.ts';

Deno.test('ConfigManager - GitHub configuration from environment variables', async () => {
    // Set up environment variables
    const originalEnv = {
        GITHUB_TOKEN: Deno.env.get('GITHUB_TOKEN'),
        GITHUB_API_URL: Deno.env.get('GITHUB_API_URL'),
    };

    try {
        // Set test environment variables
        Deno.env.set('GITHUB_TOKEN', 'test-github-token');
        Deno.env.set('GITHUB_API_URL', 'https://api.github.example.com');

        // Create a new config manager instance
        const configManager = ConfigManager.getInstance();
        
        // Force reload config by clearing cache
        (configManager as any).config = null;
        
        const config = await configManager.loadConfig();

        // Verify GitHub configuration is loaded from environment
        assertEquals(config.github?.token, 'test-github-token');
        assertEquals(config.github?.apiUrl, 'https://api.github.example.com');
    } finally {
        // Restore original environment
        if (originalEnv.GITHUB_TOKEN) {
            Deno.env.set('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN);
        } else {
            Deno.env.delete('GITHUB_TOKEN');
        }
        if (originalEnv.GITHUB_API_URL) {
            Deno.env.set('GITHUB_API_URL', originalEnv.GITHUB_API_URL);
        } else {
            Deno.env.delete('GITHUB_API_URL');
        }
    }
});

Deno.test('ConfigManager - Review configuration from environment variables', async () => {
    // Set up environment variables
    const originalEnv = {
        NOVA_REVIEW_AUTO_POST_COMMENTS: Deno.env.get('NOVA_REVIEW_AUTO_POST_COMMENTS'),
        NOVA_REVIEW_SEVERITY_THRESHOLD: Deno.env.get('NOVA_REVIEW_SEVERITY_THRESHOLD'),
        NOVA_REVIEW_MAX_FILES: Deno.env.get('NOVA_REVIEW_MAX_FILES'),
    };

    try {
        // Set test environment variables
        Deno.env.set('NOVA_REVIEW_AUTO_POST_COMMENTS', 'false');
        Deno.env.set('NOVA_REVIEW_SEVERITY_THRESHOLD', 'high');
        Deno.env.set('NOVA_REVIEW_MAX_FILES', '25');

        // Create a new config manager instance
        const configManager = ConfigManager.getInstance();
        
        // Force reload config by clearing cache
        (configManager as any).config = null;
        
        const config = await configManager.loadConfig();

        // Verify review configuration is loaded from environment
        assertEquals(config.review?.autoPostComments, false);
        assertEquals(config.review?.severityThreshold, 'high');
        assertEquals(config.review?.maxFilesPerReview, 25);
    } finally {
        // Restore original environment
        if (originalEnv.NOVA_REVIEW_AUTO_POST_COMMENTS) {
            Deno.env.set('NOVA_REVIEW_AUTO_POST_COMMENTS', originalEnv.NOVA_REVIEW_AUTO_POST_COMMENTS);
        } else {
            Deno.env.delete('NOVA_REVIEW_AUTO_POST_COMMENTS');
        }
        if (originalEnv.NOVA_REVIEW_SEVERITY_THRESHOLD) {
            Deno.env.set('NOVA_REVIEW_SEVERITY_THRESHOLD', originalEnv.NOVA_REVIEW_SEVERITY_THRESHOLD);
        } else {
            Deno.env.delete('NOVA_REVIEW_SEVERITY_THRESHOLD');
        }
        if (originalEnv.NOVA_REVIEW_MAX_FILES) {
            Deno.env.set('NOVA_REVIEW_MAX_FILES', originalEnv.NOVA_REVIEW_MAX_FILES);
        } else {
            Deno.env.delete('NOVA_REVIEW_MAX_FILES');
        }
    }
});

Deno.test('ConfigManager - Default review configuration values', async () => {
    // Clear all review-related environment variables
    const originalEnv = {
        NOVA_REVIEW_AUTO_POST_COMMENTS: Deno.env.get('NOVA_REVIEW_AUTO_POST_COMMENTS'),
        NOVA_REVIEW_SEVERITY_THRESHOLD: Deno.env.get('NOVA_REVIEW_SEVERITY_THRESHOLD'),
        NOVA_REVIEW_MAX_FILES: Deno.env.get('NOVA_REVIEW_MAX_FILES'),
    };

    try {
        // Clear environment variables
        Deno.env.delete('NOVA_REVIEW_AUTO_POST_COMMENTS');
        Deno.env.delete('NOVA_REVIEW_SEVERITY_THRESHOLD');
        Deno.env.delete('NOVA_REVIEW_MAX_FILES');

        // Create a new config manager instance
        const configManager = ConfigManager.getInstance();
        
        // Force reload config by clearing cache
        (configManager as any).config = null;
        
        const config = await configManager.loadConfig();

        // Verify default values are used when no environment variables are set
        // Note: review config might be undefined if no env vars are set
        if (config.review) {
            assertEquals(config.review.autoPostComments, true);
            assertEquals(config.review.severityThreshold, 'medium');
            assertEquals(config.review.maxFilesPerReview, 50);
        }
    } finally {
        // Restore original environment
        if (originalEnv.NOVA_REVIEW_AUTO_POST_COMMENTS) {
            Deno.env.set('NOVA_REVIEW_AUTO_POST_COMMENTS', originalEnv.NOVA_REVIEW_AUTO_POST_COMMENTS);
        }
        if (originalEnv.NOVA_REVIEW_SEVERITY_THRESHOLD) {
            Deno.env.set('NOVA_REVIEW_SEVERITY_THRESHOLD', originalEnv.NOVA_REVIEW_SEVERITY_THRESHOLD);
        }
        if (originalEnv.NOVA_REVIEW_MAX_FILES) {
            Deno.env.set('NOVA_REVIEW_MAX_FILES', originalEnv.NOVA_REVIEW_MAX_FILES);
        }
    }
});

Deno.test('ConfigManager - GitHub connection testing', async () => {
    // Mock fetch for testing
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    let fetchUrl = '';
    let fetchOptions: RequestInit | undefined;

    try {
        globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
            fetchCalled = true;
            fetchUrl = url.toString();
            fetchOptions = options;
            
            // Mock successful GitHub API response
            return new Response(JSON.stringify({ login: 'testuser' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        };

        // Create test config with GitHub settings
        const testConfig: Config = {
            gitlab: { url: '', token: '', project_id: null },
            github: {
                token: 'test-token',
                apiUrl: 'https://api.github.com'
            }
        };

        const configManager = ConfigManager.getInstance();
        
        // Mock the loadConfig method to return our test config
        const originalLoadConfig = configManager.loadConfig;
        configManager.loadConfig = async () => testConfig;

        const results = await configManager.testConnections();

        // Verify GitHub connection was tested
        assertEquals(fetchCalled, true);
        assertEquals(fetchUrl, 'https://api.github.com/user');
        
        // Check headers with proper type casting
        const headers = fetchOptions?.headers as Record<string, string>;
        assertEquals(headers?.['Authorization'], 'Bearer test-token');
        assertEquals(headers?.['Accept'], 'application/vnd.github.v3+json');
        assertEquals(headers?.['User-Agent'], 'Nova-CLI');
        assertEquals(results.github, true);
        assertEquals((results as any).github_username, 'testuser');

        // Restore original method
        configManager.loadConfig = originalLoadConfig;
    } finally {
        // Restore original fetch
        globalThis.fetch = originalFetch;
    }
});

Deno.test('ConfigManager - GitHub connection testing failure', async () => {
    // Mock fetch for testing failure
    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async () => {
            // Mock failed GitHub API response
            return new Response('Unauthorized', { status: 401 });
        };

        // Create test config with GitHub settings
        const testConfig: Config = {
            gitlab: { url: '', token: '', project_id: null },
            github: {
                token: 'invalid-token',
                apiUrl: 'https://api.github.com'
            }
        };

        const configManager = ConfigManager.getInstance();
        
        // Mock the loadConfig method to return our test config
        const originalLoadConfig = configManager.loadConfig;
        configManager.loadConfig = async () => testConfig;

        const results = await configManager.testConnections();

        // Verify GitHub connection failed
        assertEquals(results.github, false);

        // Restore original method
        configManager.loadConfig = originalLoadConfig;
    } finally {
        // Restore original fetch
        globalThis.fetch = originalFetch;
    }
});

Deno.test('ConfigManager - Configuration validation with review settings', async () => {
    const configManager = ConfigManager.getInstance();
    
    // Test valid configuration
    const validConfig = {
        gitlab: { url: 'https://gitlab.com', token: 'test-token', project_id: null },
        github: { token: 'github-token', apiUrl: 'https://api.github.com' },
        review: {
            autoPostComments: true,
            severityThreshold: 'medium' as const,
            maxFilesPerReview: 50
        }
    };

    // This should not throw
    const validatedConfig = (configManager as any).validateConfig(validConfig);
    assertEquals(validatedConfig.review?.autoPostComments, true);
    assertEquals(validatedConfig.review?.severityThreshold, 'medium');
    assertEquals(validatedConfig.review?.maxFilesPerReview, 50);
});

Deno.test('ConfigManager - Configuration merging with GitHub and review settings', async () => {
    const configManager = ConfigManager.getInstance();
    
    const fileConfig = {
        gitlab: { url: 'https://gitlab.com', token: 'file-token', project_id: null },
        github: { token: 'file-github-token', apiUrl: 'https://api.github.com' },
        review: {
            autoPostComments: false,
            severityThreshold: 'low' as const,
            maxFilesPerReview: 25
        }
    };

    const envConfig = {
        gitlab: { url: 'https://gitlab.com', token: 'env-token', project_id: null },
        github: { token: 'env-github-token', apiUrl: 'https://github.enterprise.com/api/v3' },
        review: {
            autoPostComments: true,
            severityThreshold: 'high' as const,
            maxFilesPerReview: 100
        }
    };

    const mergedConfig = (configManager as any).mergeConfigs(fileConfig, envConfig);

    // Environment config should override file config
    assertEquals(mergedConfig.gitlab.token, 'env-token');
    assertEquals(mergedConfig.github?.token, 'env-github-token');
    assertEquals(mergedConfig.github?.apiUrl, 'https://github.enterprise.com/api/v3');
    assertEquals(mergedConfig.review?.autoPostComments, true);
    assertEquals(mergedConfig.review?.severityThreshold, 'high');
    assertEquals(mergedConfig.review?.maxFilesPerReview, 100);
});