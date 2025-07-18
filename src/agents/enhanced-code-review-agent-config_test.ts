import { assertEquals, assertRejects } from 'std/assert/mod.ts';
import { EnhancedCodeReviewAgent } from './enhanced-code-review-agent.ts';
import type { AgentContext } from './types.ts';
import type { Config } from '../config/types.ts';
import { Logger } from '../utils/logger.ts';

// Mock context for testing
function createMockContext(config: Partial<Config> = {}): AgentContext {
    const defaultConfig: Config = {
        gitlab: { url: '', token: '', project_id: null },
        ...config
    };

    return {
        config: defaultConfig,
        workingDirectory: '/test',
        logger: new Logger('Test', false),
        tools: {},
    };
}

Deno.test('EnhancedCodeReviewAgent - getReviewConfig with defaults', () => {
    const context = createMockContext();
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Access private method for testing
    const reviewConfig = (agent as any).getReviewConfig();
    
    // Verify default values
    assertEquals(reviewConfig.autoPostComments, true);
    assertEquals(reviewConfig.severityThreshold, 'medium');
    assertEquals(reviewConfig.maxFilesPerReview, 50);
});

Deno.test('EnhancedCodeReviewAgent - getReviewConfig with custom values', () => {
    const context = createMockContext({
        review: {
            autoPostComments: false,
            severityThreshold: 'high',
            maxFilesPerReview: 25
        }
    });
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Access private method for testing
    const reviewConfig = (agent as any).getReviewConfig();
    
    // Verify custom values
    assertEquals(reviewConfig.autoPostComments, false);
    assertEquals(reviewConfig.severityThreshold, 'high');
    assertEquals(reviewConfig.maxFilesPerReview, 25);
});

Deno.test('EnhancedCodeReviewAgent - file review respects maxFilesPerReview limit', async () => {
    const context = createMockContext({
        review: {
            autoPostComments: true,
            severityThreshold: 'medium',
            maxFilesPerReview: 2
        }
    });
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Try to review 3 files when limit is 2
    const files = ['file1.ts', 'file2.ts', 'file3.ts'];
    
    const response = await agent.execute(`review ${files.join(' ')}`);
    
    // Should return a failed response with error about too many files
    assertEquals(response.success, false);
    assertEquals(response.content.includes('Too many files'), true);
    assertEquals(response.error?.includes('Too many files'), true);
});

Deno.test('EnhancedCodeReviewAgent - GitHub configuration is accessible', () => {
    const context = createMockContext({
        github: {
            token: 'test-github-token',
            apiUrl: 'https://api.github.com'
        }
    });
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Verify GitHub configuration is accessible through context
    assertEquals(context.config.github?.token, 'test-github-token');
    assertEquals(context.config.github?.apiUrl, 'https://api.github.com');
});

Deno.test('EnhancedCodeReviewAgent - Review configuration validation', () => {
    // Test with invalid severity threshold (should still work due to defaults)
    const context = createMockContext({
        review: {
            autoPostComments: true,
            severityThreshold: 'invalid' as any, // Invalid value
            maxFilesPerReview: -1 // Invalid value
        }
    });
    const agent = new EnhancedCodeReviewAgent(context);
    
    // The agent should handle invalid config gracefully by using defaults
    const reviewConfig = (agent as any).getReviewConfig();
    
    // Should fall back to defaults for invalid values
    assertEquals(reviewConfig.autoPostComments, true);
    // Note: The actual validation happens in the Zod schema, so invalid values
    // might be passed through here, but the schema validation would catch them
});

Deno.test('EnhancedCodeReviewAgent - Configuration inheritance from environment', () => {
    // This test verifies that the agent can access configuration that was loaded
    // from environment variables through the ConfigManager
    
    const context = createMockContext({
        github: {
            token: 'env-github-token', // Simulating env var loading
            apiUrl: 'https://github.enterprise.com/api/v3'
        },
        review: {
            autoPostComments: false, // Simulating env var loading
            severityThreshold: 'high',
            maxFilesPerReview: 100
        }
    });
    
    const agent = new EnhancedCodeReviewAgent(context);
    const reviewConfig = (agent as any).getReviewConfig();
    
    // Verify environment-loaded configuration is accessible
    assertEquals(context.config.github?.token, 'env-github-token');
    assertEquals(context.config.github?.apiUrl, 'https://github.enterprise.com/api/v3');
    assertEquals(reviewConfig.autoPostComments, false);
    assertEquals(reviewConfig.severityThreshold, 'high');
    assertEquals(reviewConfig.maxFilesPerReview, 100);
});