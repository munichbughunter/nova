/**
 * Backward compatibility tests for existing configurations and functionality
 * Ensures no breaking changes are introduced by the refactoring
 */

import { assertEquals, assertInstanceOf, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { EnhancedCodeReviewAgent } from './enhanced-code-review-agent.ts';
import { Logger } from '../utils/logger.ts';
import { AgentContext } from './types.ts';

// Legacy configuration formats that should still work
const legacyConfigurations = [
  // Original configuration format
  {
    llm: {
      provider: 'ollama',
      model: 'codellama',
    },
    review: {
      enableSuggestions: true,
      maxFiles: 10,
    },
  },
  
  // OpenAI configuration
  {
    llm: {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'test-key',
    },
    review: {
      enableSuggestions: true,
      enableMetrics: false,
    },
  },
  
  // Minimal configuration
  {
    llm: {
      provider: 'ollama',
    },
  },
  
  // Configuration with deprecated fields (should be ignored gracefully)
  {
    llm: {
      provider: 'ollama',
      model: 'codellama',
      deprecated_field: 'should_be_ignored',
    },
    review: {
      enableSuggestions: true,
      old_setting: 'should_be_ignored',
    },
    deprecated_section: {
      old_config: 'should_be_ignored',
    },
  },
];

describe('Backward Compatibility Tests', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
  });

  afterEach(() => {
    restore();
  });

  describe('Configuration Compatibility', () => {
    it('should handle all legacy configuration formats', () => {
      for (const [index, config] of legacyConfigurations.entries()) {
        const mockContext: AgentContext = {
          config,
          logger,
          llmProvider: {
            name: 'mock',
            generateObject: async () => ({ object: {} }),
            isAvailable: async () => true,
            listModels: async () => ['mock-model'],
            setModel: () => {},
            generateText: async () => ({ text: 'mock' }),
            generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
          },
          mcpEnabled: false,
          mcpService: {
            isEnabled: () => false,
            listTools: () => [],
            getTools: () => [],
            executeTool: async () => ({ result: 'mock' }),
          },
          workingDirectory: '/test',
          toolWrappers: {},
        };

        // Should not throw when creating agent with legacy config
        const agent = new EnhancedCodeReviewAgent(mockContext);
        assertInstanceOf(agent, EnhancedCodeReviewAgent, `Failed for config ${index}`);
      }
    });

    it('should provide default values for missing configuration fields', () => {
      const minimalConfig = {
        llm: {
          provider: 'ollama',
        },
      };

      const mockContext: AgentContext = {
        config: minimalConfig,
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({ object: {} }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);
      
      // Should have sensible defaults
      const internalConfig = (agent as any).config;
      assert(internalConfig.review);
      assertEquals(typeof internalConfig.review.enableSuggestions, 'boolean');
      assertEquals(typeof internalConfig.review.maxFiles, 'number');
    });

    it('should ignore unknown configuration fields gracefully', () => {
      const configWithUnknownFields = {
        llm: {
          provider: 'ollama',
          model: 'codellama',
          unknown_field: 'should_be_ignored',
          nested_unknown: {
            field: 'value',
          },
        },
        review: {
          enableSuggestions: true,
          unknown_review_field: 'ignored',
        },
        completely_unknown_section: {
          field1: 'value1',
          field2: 'value2',
        },
      };

      const mockContext: AgentContext = {
        config: configWithUnknownFields,
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({ object: {} }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      // Should not throw and should work normally
      const agent = new EnhancedCodeReviewAgent(mockContext);
      assertInstanceOf(agent, EnhancedCodeReviewAgent);
    });
  });

  describe('CLI Command Compatibility', () => {
    it('should maintain exact same CLI interface for file review', async () => {
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({
            object: {
              grade: 'A',
              coverage: 90,
              testsPresent: true,
              value: 'high',
              state: 'pass',
              issues: [],
              suggestions: [],
              summary: 'Good code',
            },
          }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.handleFileReview(['src/test.ts']);

      // Should maintain exact same response structure
      assertEquals(typeof result.success, 'boolean');
      assertEquals(Array.isArray(result.results), true);
      
      if (result.success) {
        const fileResult = result.results[0];
        assertEquals(typeof fileResult.file, 'string');
        assertEquals(typeof fileResult.grade, 'string');
        assertEquals(typeof fileResult.coverage, 'number');
        assertEquals(typeof fileResult.testsPresent, 'boolean');
        assertEquals(typeof fileResult.value, 'string');
        assertEquals(typeof fileResult.state, 'string');
        assertEquals(Array.isArray(fileResult.issues), true);
        assertEquals(Array.isArray(fileResult.suggestions), true);
        assertEquals(typeof fileResult.summary, 'string');
      }

      readFileStub.restore();
    });

    it('should maintain exact same CLI interface for changes review', async () => {
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({
            object: {
              grade: 'B',
              coverage: 75,
              testsPresent: true,
              value: 'medium',
              state: 'warning',
              issues: [],
              suggestions: [],
              summary: 'Good changes',
            },
          }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      // Mock git service
      (agent as any).gitService = {
        isGitRepository: async () => true,
        getChangedFiles: async () => ['src/test.ts'],
        getFileChanges: async () => [{ file: 'src/test.ts', status: 'modified' }],
        getRemoteUrl: async () => 'https://github.com/test/repo.git',
        getCurrentBranch: async () => 'main',
        getCommitHash: async () => 'abc123',
      };

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.handleChangesReview();

      // Should maintain exact same response structure
      assertEquals(typeof result.success, 'boolean');
      
      if (result.success) {
        assertEquals(Array.isArray(result.results), true);
        assert(result.gitContext);
        assertEquals(typeof result.gitContext.branch, 'string');
        assertEquals(Array.isArray(result.gitContext.changedFiles), true);
      }

      readFileStub.restore();
    });

    it('should maintain exact same CLI interface for PR review', async () => {
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({
            object: {
              grade: 'A',
              coverage: 85,
              testsPresent: true,
              value: 'high',
              state: 'pass',
              issues: [],
              suggestions: [],
              summary: 'Excellent PR',
            },
          }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      // Mock git service
      (agent as any).gitService = {
        isGitRepository: async () => true,
        getChangedFiles: async () => ['src/test1.ts', 'src/test2.ts'],
        getFileChanges: async () => [
          { file: 'src/test1.ts', status: 'modified' },
          { file: 'src/test2.ts', status: 'added' },
        ],
        getRemoteUrl: async () => 'https://github.com/test/repo.git',
        getCurrentBranch: async () => 'feature/new-feature',
        getCommitHash: async () => 'def456',
      };

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.handlePRReview();

      // Should maintain exact same response structure
      assertEquals(typeof result.success, 'boolean');
      
      if (result.success) {
        assertEquals(Array.isArray(result.results), true);
        assert(result.summary);
        assertEquals(typeof result.summary.totalFiles, 'number');
        assertEquals(typeof result.summary.totalIssues, 'number');
        assert(result.gitContext);
      }

      readFileStub.restore();
    });
  });

  describe('Output Format Compatibility', () => {
    it('should maintain exact same output format for successful reviews', async () => {
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({
            object: {
              grade: 'A',
              coverage: 90,
              testsPresent: true,
              value: 'high',
              state: 'pass',
              issues: [
                {
                  type: 'style',
                  message: 'Consider using const instead of let',
                  line: 5,
                },
              ],
              suggestions: ['Great work!', 'Consider adding tests'],
              summary: 'Excellent code quality',
            },
          }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('let x = 1;')
      );

      const result = await agent.handleFileReview(['src/test.ts']);

      // Verify exact structure matches legacy format
      assertEquals(result.success, true);
      assertEquals(result.results.length, 1);
      
      const fileResult = result.results[0];
      assertEquals(fileResult.file, 'src/test.ts');
      assertEquals(fileResult.grade, 'A');
      assertEquals(fileResult.coverage, 90);
      assertEquals(fileResult.testsPresent, true);
      assertEquals(fileResult.value, 'high');
      assertEquals(fileResult.state, 'pass');
      assertEquals(fileResult.issues.length, 1);
      assertEquals(fileResult.issues[0].type, 'style');
      assertEquals(fileResult.issues[0].message, 'Consider using const instead of let');
      assertEquals(fileResult.issues[0].line, 5);
      assertEquals(fileResult.suggestions.length, 2);
      assertEquals(fileResult.summary, 'Excellent code quality');

      readFileStub.restore();
    });

    it('should maintain exact same error format', async () => {
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => {
            throw new Error('LLM service unavailable');
          },
          isAvailable: async () => false,
          listModels: async () => [],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.handleFileReview(['src/test.ts']);

      // Should maintain error format but still succeed with fallback
      assertEquals(typeof result.success, 'boolean');
      
      if (!result.success) {
        assertEquals(typeof result.error, 'string');
      } else {
        // Should have fallback results
        assertEquals(Array.isArray(result.results), true);
      }

      readFileStub.restore();
    });
  });

  describe('Existing Test Compatibility', () => {
    it('should pass all existing test patterns', async () => {
      // Test patterns that existing tests might rely on
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({
            object: {
              grade: 'B',
              coverage: 75,
              testsPresent: false,
              value: 'medium',
              state: 'warning',
              issues: [],
              suggestions: [],
              summary: 'Needs improvement',
            },
          }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      // Test that agent has expected methods
      assertEquals(typeof agent.handleFileReview, 'function');
      assertEquals(typeof agent.handleChangesReview, 'function');
      assertEquals(typeof agent.handlePRReview, 'function');

      // Test that methods return expected structure
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.handleFileReview(['test.ts']);
      
      // Verify structure that existing tests might check
      assert('success' in result);
      assert('results' in result);
      
      if (result.success) {
        assert(Array.isArray(result.results));
        if (result.results.length > 0) {
          const firstResult = result.results[0];
          assert('file' in firstResult);
          assert('grade' in firstResult);
          assert('coverage' in firstResult);
          assert('testsPresent' in firstResult);
          assert('value' in firstResult);
          assert('state' in firstResult);
          assert('issues' in firstResult);
          assert('suggestions' in firstResult);
          assert('summary' in firstResult);
        }
      }

      readFileStub.restore();
    });

    it('should maintain agent context compatibility', () => {
      // Test that agent context structure is maintained
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({ object: {} }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      // Verify internal context is accessible (for existing tests that might access it)
      const internalContext = (agent as any).context;
      assert(internalContext);
      assertEquals(internalContext.config, mockContext.config);
      assertEquals(internalContext.logger, mockContext.logger);
      assertEquals(internalContext.llmProvider, mockContext.llmProvider);
    });
  });

  describe('Performance Compatibility', () => {
    it('should maintain similar performance characteristics', async () => {
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => {
            // Simulate some processing time
            await new Promise(resolve => setTimeout(resolve, 10));
            return {
              object: {
                grade: 'A',
                coverage: 90,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Good code',
              },
            };
          },
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const startTime = Date.now();
      const result = await agent.handleFileReview(['src/test.ts']);
      const endTime = Date.now();

      const duration = endTime - startTime;

      assertEquals(result.success, true);
      // Should complete within reasonable time (allowing for overhead from new features)
      assert(duration < 1000, 'Should maintain reasonable performance');

      readFileStub.restore();
    });

    it('should handle same file sizes as before', async () => {
      const mockContext: AgentContext = {
        config: { llm: { provider: 'ollama' } },
        logger,
        llmProvider: {
          name: 'mock',
          generateObject: async () => ({
            object: {
              grade: 'A',
              coverage: 90,
              testsPresent: true,
              value: 'high',
              state: 'pass',
              issues: [],
              suggestions: [],
              summary: 'Good code',
            },
          }),
          isAvailable: async () => true,
          listModels: async () => ['mock-model'],
          setModel: () => {},
          generateText: async () => ({ text: 'mock' }),
          generateStream: async () => ({ textStream: async function* () { yield 'mock'; } }),
        },
        mcpEnabled: false,
        mcpService: {
          isEnabled: () => false,
          listTools: () => [],
          getTools: () => [],
          executeTool: async () => ({ result: 'mock' }),
        },
        workingDirectory: '/test',
        toolWrappers: {},
      };

      const agent = new EnhancedCodeReviewAgent(mockContext);

      // Create a large file content (similar to what might have been tested before)
      const largeFileContent = 'const x = 1;\n'.repeat(10000);

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve(largeFileContent)
      );

      const result = await agent.handleFileReview(['src/large-file.ts']);

      assertEquals(result.success, true);
      assertEquals(result.results.length, 1);

      readFileStub.restore();
    });
  });
});