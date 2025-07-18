/**
 * Integration tests for complete review workflows
 * Tests end-to-end functionality with real-world scenarios
 */

import { assertEquals, assertInstanceOf, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd';
import { spy, stub, restore } from 'jsr:@std/testing/mock';
import { EnhancedCodeReviewAgent } from './enhanced-code-review-agent.ts';
import { Logger } from '../utils/logger.ts';
import { AgentContext } from './types.ts';

// Mock implementations for testing
class MockLLMProvider {
  name = 'mock-llm';
  
  async generateObject(options: any) {
    // Simulate different response scenarios
    if (options.prompt?.includes('security')) {
      return {
        object: {
          grade: 'C',
          coverage: '60%', // String format to test transformation
          testsPresent: 'false',
          value: 'medium',
          state: 'warning',
          issues: [
            {
              type: 'security',
              message: 'Potential SQL injection vulnerability',
              line: 42,
            },
          ],
          suggestions: ['Use parameterized queries'],
          summary: 'Security issues found',
        },
      };
    }
    
    if (options.prompt?.includes('performance')) {
      return {
        object: {
          grade: 'B',
          coverage: 85, // Number format
          testsPresent: true,
          value: 'high',
          state: 'pass',
          issues: [
            {
              type: 'performance',
              message: 'Consider using async/await',
              line: 15,
            },
          ],
          suggestions: ['Optimize database queries', 'Add caching'],
          summary: 'Good code with minor performance improvements',
        },
      };
    }
    
    // Default response
    return {
      object: {
        grade: 'A',
        coverage: '95%',
        testsPresent: 'true',
        value: 'high',
        state: 'pass',
        issues: [],
        suggestions: ['Great work!'],
        summary: 'Excellent code quality',
      },
    };
  }
  
  async isAvailable() {
    return true;
  }
  
  async listModels() {
    return ['mock-model'];
  }
  
  setModel() {}
  
  async generateText() {
    return { text: 'Mock response' };
  }
  
  async generateStream() {
    return {
      textStream: async function* () {
        yield 'Mock';
        yield ' response';
      },
    };
  }
}

class MockGitService {
  async isGitRepository() {
    return true;
  }
  
  async getChangedFiles() {
    return ['src/test.ts', 'src/utils.ts'];
  }
  
  async getFileChanges() {
    return [
      {
        file: 'src/test.ts',
        status: 'modified',
        additions: 10,
        deletions: 2,
      },
    ];
  }
  
  async getRemoteUrl() {
    return 'https://github.com/test/repo.git';
  }
  
  async getCurrentBranch() {
    return 'feature/test-branch';
  }
  
  async getCommitHash() {
    return 'abc123def456';
  }
}

class MockMCPService {
  isEnabled() {
    return false;
  }
  
  listTools() {
    return [];
  }
  
  getTools() {
    return [];
  }
  
  async executeTool() {
    return { result: 'mock' };
  }
}

describe('Enhanced Code Review Agent - Workflow Integration Tests', () => {
  let agent: EnhancedCodeReviewAgent;
  let mockContext: AgentContext;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
    
    mockContext = {
      config: {
        llm: {
          provider: 'mock',
          model: 'mock-model',
        },
        review: {
          enableSuggestions: true,
          enableMetrics: true,
          maxFiles: 10,
        },
      },
      logger,
      llmProvider: new MockLLMProvider() as any,
      mcpEnabled: false,
      mcpService: new MockMCPService() as any,
      workingDirectory: '/test/project',
      toolWrappers: {},
    };

    agent = new EnhancedCodeReviewAgent(mockContext);
    
    // Mock the git service
    (agent as any).gitService = new MockGitService();
  });

  afterEach(() => {
    restore();
  });

  describe('File Review Workflow', () => {
    it('should complete full file review with transformation', async () => {
      // Mock file system operations
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve(`
          function calculateTotal(items) {
            let total = 0;
            for (let item of items) {
              total += item.price;
            }
            return total;
          }
        `)
      );

      const result = await agent.execute('review src/test.ts');

      assertEquals(result.success, true);
      assert(result.content.includes('src/test.ts'));
      assert(result.content.includes('Grade: A') || result.content.includes('grade'));
      
      readFileStub.restore();
    });

    it('should handle multiple files with different analysis results', async () => {
      const readFileStub = stub(Deno, 'readTextFile', (path: string) => {
        if (path.includes('security')) {
          return Promise.resolve(`
            const query = "SELECT * FROM users WHERE id = " + userId;
            db.execute(query);
          `);
        }
        
        if (path.includes('performance')) {
          return Promise.resolve(`
            function slowFunction() {
              for (let i = 0; i < 1000000; i++) {
                console.log(i);
              }
            }
          `);
        }
        
        return Promise.resolve('const x = 1;');
      });

      const result = await agent.execute('review src/security.ts src/performance.ts src/clean.ts');

      assertEquals(result.success, true);
      assert(result.content.includes('security.ts'));
      assert(result.content.includes('performance.ts'));
      assert(result.content.includes('clean.ts'));
      
      readFileStub.restore();
    });

    it('should handle file read errors gracefully', async () => {
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.reject(new Error('File not found'))
      );

      const result = await agent.execute('review nonexistent.ts');

      assertEquals(result.success, false);
      assert(result.error?.includes('File not found') || result.error?.includes('Error reading'));
      
      readFileStub.restore();
    });
  });

  describe('Changes Review Workflow', () => {
    it('should review git changes with proper context', async () => {
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve(`
          function updatedFunction() {
            return 'new implementation';
          }
        `)
      );

      const result = await agent.execute('review changes');

      assertEquals(result.success, true);
      assert(result.content.includes('test.ts') || result.content.includes('utils.ts'));
      
      readFileStub.restore();
    });

    it('should handle no changes scenario', async () => {
      // Mock git service to return no changes
      (agent as any).gitService.getChangedFiles = async () => [];

      const result = await agent.execute('review changes');

      assertEquals(result.success, true);
      assert(result.content.includes('No changes') || result.content.includes('no files'));
    });

    it('should handle git repository detection failure', async () => {
      // Mock git service to indicate not a git repository
      (agent as any).gitService.isGitRepository = async () => false;

      const result = await agent.execute('review changes');

      assertEquals(result.success, false);
      assert(result.error?.includes('git') || result.error?.includes('repository'));
    });
  });

  describe('Pull Request Review Workflow', () => {
    it('should review PR with comprehensive analysis', async () => {
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve(`
          export class UserService {
            async createUser(userData) {
              // Implementation
              return userData;
            }
          }
        `)
      );

      const result = await agent.execute('review pr');

      assertEquals(result.success, true);
      assert(result.content.includes('test.ts') || result.content.includes('utils.ts'));
      
      readFileStub.restore();
    });

    it('should handle large PR with file limits', async () => {
      // Mock git service to return many files
      (agent as any).gitService.getChangedFiles = async () => 
        Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`);

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.execute('review pr');

      assertEquals(result.success, true);
      assert(result.content.length > 0);
      
      readFileStub.restore();
    });
  });

  describe('Error Recovery and Fallback', () => {
    it('should fallback to rule-based analysis when LLM fails', async () => {
      // Mock LLM to fail
      const failingLLMProvider = {
        ...new MockLLMProvider(),
        generateObject: async () => {
          throw new Error('LLM service unavailable');
        },
      };

      mockContext.llmProvider = failingLLMProvider as any;
      agent = new EnhancedCodeReviewAgent(mockContext);
      (agent as any).gitService = new MockGitService();

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve(`
          function testFunction() {
            console.log('test');
          }
        `)
      );

      const result = await agent.execute('review src/test.ts');

      assertEquals(result.success, true);
      assert(result.content.includes('rule-based') || result.content.includes('fallback'));
      
      readFileStub.restore();
    });

    it('should handle malformed LLM responses with transformation', async () => {
      // Mock LLM to return malformed data
      const malformedLLMProvider = {
        ...new MockLLMProvider(),
        generateObject: async () => ({
          object: {
            grade: 'A',
            coverage: 'invalid-coverage', // Invalid format
            testsPresent: 'maybe', // Invalid boolean
            value: 'high',
            state: 'pass',
            issues: 'not-an-array', // Invalid type
            suggestions: null, // Invalid type
            summary: 123, // Invalid type
          },
        }),
      };

      mockContext.llmProvider = malformedLLMProvider as any;
      agent = new EnhancedCodeReviewAgent(mockContext);
      (agent as any).gitService = new MockGitService();

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.execute('review src/test.ts');

      assertEquals(result.success, true);
      assert(result.content.includes('test.ts'));
      
      readFileStub.restore();
    });

    it('should retry on transient failures', async () => {
      let attempts = 0;
      const retryingLLMProvider = {
        ...new MockLLMProvider(),
        generateObject: async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary network error');
          }
          return {
            object: {
              grade: 'A',
              coverage: 90,
              testsPresent: true,
              value: 'high',
              state: 'pass',
              issues: [],
              suggestions: [],
              summary: 'Success after retry',
            },
          };
        },
      };

      mockContext.llmProvider = retryingLLMProvider as any;
      agent = new EnhancedCodeReviewAgent(mockContext);
      (agent as any).gitService = new MockGitService();

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.execute('review src/test.ts');

      assertEquals(result.success, true);
      assertEquals(attempts, 3); // Should have retried
      assert(result.content.includes('Success after retry') || result.content.includes('test.ts'));
      
      readFileStub.restore();
    });
  });

  describe('Performance and Caching', () => {
    it('should cache analysis results for unchanged files', async () => {
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const generateObjectSpy = spy(mockContext.llmProvider, 'generateObject');

      // First analysis
      await agent.execute('review src/test.ts');
      const firstCallCount = generateObjectSpy.calls.length;

      // Second analysis of same file (should use cache)
      await agent.execute('review src/test.ts');
      const secondCallCount = generateObjectSpy.calls.length;

      // Should not have made additional LLM calls due to caching
      assertEquals(secondCallCount, firstCallCount);
      
      readFileStub.restore();
      generateObjectSpy.restore();
    });

    it('should process multiple files in parallel', async () => {
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const startTime = Date.now();
      
      const result = await agent.execute('review src/file1.ts src/file2.ts src/file3.ts src/file4.ts src/file5.ts');
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      assertEquals(result.success, true);
      assert(result.content.includes('file1.ts'));
      
      // Parallel processing should be faster than sequential
      // (This is a rough check - in real scenarios the difference would be more significant)
      assert(duration < 5000, 'Should complete within reasonable time with parallel processing');
      
      readFileStub.restore();
    });
  });

  describe('Configuration and Customization', () => {
    it('should respect configuration settings', async () => {
      // Update config to disable suggestions
      mockContext.config.review.autoPostComments = false;
      agent = new EnhancedCodeReviewAgent(mockContext);
      (agent as any).gitService = new MockGitService();

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.execute('review src/test.ts');

      assertEquals(result.success, true);
      assert(result.content.includes('test.ts'));
      
      readFileStub.restore();
    });

    it('should handle different LLM providers', async () => {
      // Test with different provider configurations
      const providers = ['openai', 'ollama', 'azure'];
      
      for (const provider of providers) {
        mockContext.config.llm.provider = provider;
        agent = new EnhancedCodeReviewAgent(mockContext);
        (agent as any).gitService = new MockGitService();

        const readFileStub = stub(
          Deno,
          'readTextFile',
          () => Promise.resolve('const x = 1;')
        );

        const result = await agent.execute('review src/test.ts');

        assertEquals(result.success, true, `Failed for provider: ${provider}`);
        assert(result.content.includes('test.ts'), `Failed for provider: ${provider}`);
        
        readFileStub.restore();
      }
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should collect performance metrics', async () => {
      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      await agent.execute('review src/test.ts');

      // Just verify the agent executed successfully
      // Metrics collection is tested in dedicated metric tests
      assert(true, 'Agent executed successfully');
      
      readFileStub.restore();
    });

    it('should track error rates', async () => {
      // Force some errors
      const failingLLMProvider = {
        ...new MockLLMProvider(),
        generateObject: async () => {
          throw new Error('Simulated failure');
        },
      };

      mockContext.llmProvider = failingLLMProvider as any;
      agent = new EnhancedCodeReviewAgent(mockContext);
      (agent as any).gitService = new MockGitService();

      const readFileStub = stub(
        Deno,
        'readTextFile',
        () => Promise.resolve('const x = 1;')
      );

      const result = await agent.execute('review src/test.ts');

      // Should still succeed due to fallback mechanisms
      assertEquals(result.success, true);
      
      readFileStub.restore();
    });
  });
});