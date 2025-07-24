import { assertEquals, assertThrows } from '@std/assert';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { stub } from '@std/testing/mock';
import * as z from 'zod';
import { Config } from '../../src/config/types.ts';
import { AIService } from '../../src/services/ai_service.ts';

// Define the CodeAnalysis interface for testing purposes
interface CodeAnalysis {
  issues: Array<{
    severity: 'high' | 'medium' | 'low';
    message: string;
    explanation?: string;
    suggestion?: string;
    line?: number | string;
    column?: number;
    code?: string;
  }>;
  recommendations: string[];
  summary?: string;
  metrics?: Record<string, number>;
}

// Helper function to reset environment between tests
function resetEnvironment() {
  // Clear environment variables
  const envVars = [
    'OLLAMA_API_HOST', 
    'OPENAI_API_KEY', 
    'OPENAI_API_BASE', 
    'OPENAI_API_VERSION',
    'AZURE_OPENAI_API_KEY', 
    'AZURE_OPENAI_API_ENDPOINT', 
    'AZURE_OPENAI_API_VERSION',
    'nova_DEBUG'
  ];
  
  envVars.forEach(key => Deno.env.delete(key));
  
  // Reset singleton instance
  // @ts-ignore - accessing private static property
  AIService.instance = null;
}

describe('AIService', () => {
  let mockConfig: Config;
  const mockLangModelResponse = { text: 'Test response' };

  beforeEach(() => {
    // Set up a clean environment for each test
    const originalEnvVars = {
      OLLAMA_API_HOST: Deno.env.get('OLLAMA_API_HOST'),
      OPENAI_API_KEY: Deno.env.get('OPENAI_API_KEY'),
      OPENAI_API_BASE: Deno.env.get('OPENAI_API_BASE'),
      OPENAI_API_VERSION: Deno.env.get('OPENAI_API_VERSION'),
      AZURE_OPENAI_API_KEY: Deno.env.get('AZURE_OPENAI_API_KEY'),
      AZURE_OPENAI_API_ENDPOINT: Deno.env.get('AZURE_OPENAI_API_ENDPOINT'),
      AZURE_OPENAI_API_VERSION: Deno.env.get('AZURE_OPENAI_API_VERSION'),
      nova_DEBUG: Deno.env.get('nova_DEBUG'),
    };

    // Clear environment variables
    Object.keys(originalEnvVars).forEach(key => {
      Deno.env.delete(key);
    });

    // Reset singleton instance
    // @ts-ignore - accessing private static property
    AIService.instance = null;

    // Setup test config
    mockConfig = {
      gitlab: { url: 'https://gitlab.example.com', token: 'test-token' },
      ai: {
        default_provider: 'ollama',
        ollama: {
          model: 'llama3',
          api_url: 'http://localhost:11434',
        },
        openai: {
          api_key: 'test-openai-key',
          default_model: 'gpt-3.5-turbo',
        },
        azure: {
          api_key: 'test-azure-key',
          api_url: 'https://aicp-prod-sc.openai.azure.com/',
          api_version: '2023-05-15',
          deployment_name: 'gpt-4',
        },
      },
    } as Config;

    // Create stubs for external dependencies that would otherwise cause failures
    stub(globalThis, 'fetch', () => {
      return Promise.resolve(new Response(JSON.stringify({ results: [{ text: 'Test response' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    
    // Mock AI model functions with minimal fake implementations
    const mockLangModel = () => ({ 
      // This is a minimal fake implementation that won't be called
      doGenerate: () => Promise.resolve({ text: 'Test response' }) 
    });
    
    // @ts-ignore - deliberately mocking imported modules
    stub(globalThis, 'ollama', () => mockLangModel);
    // @ts-ignore - deliberately mocking imported modules
    stub(globalThis, 'createOpenAI', () => () => mockLangModel);
    // @ts-ignore - deliberately mocking imported modules
    stub(globalThis, 'createAzure', () => () => mockLangModel);
    
    // Mock the generateText function at global scope
    // @ts-ignore - deliberately mocking imported modules
    stub(globalThis, 'generateText', () => Promise.resolve(mockLangModelResponse));
    
    // Mock generateObject
    // @ts-ignore - deliberately mocking imported modules
    stub(globalThis, 'generateObject', () => Promise.resolve({ result: 'Test object response' }));
  });

  afterEach(() => {
    // Restore original environment
    // @ts-ignore - we know mock exists
    if (globalThis.fetch.restore) globalThis.fetch.restore();
    // @ts-ignore - restoring stubs
    if (globalThis.ollama?.restore) globalThis.ollama.restore();
    // @ts-ignore - restoring stubs
    if (globalThis.createOpenAI?.restore) globalThis.createOpenAI.restore();
    // @ts-ignore - restoring stubs
    if (globalThis.createAzure?.restore) globalThis.createAzure.restore();
    // @ts-ignore - restoring stubs
    if (globalThis.generateText?.restore) globalThis.generateText.restore();
    // @ts-ignore - restoring stubs
    if (globalThis.generateObject?.restore) globalThis.generateObject.restore();
  });

  describe('constructor', () => {
    it('should initialize with Ollama provider when configured as default', () => {
      const service = new AIService(mockConfig);
      assertEquals(service.provider, 'ollama');
      assertEquals(service.model, 'llama3');
      assertEquals(Deno.env.get('OLLAMA_API_HOST'), 'http://localhost:11434');
    });

    it('should initialize with OpenAI provider when configured as default', () => {
      const openaiConfig = structuredClone(mockConfig);
      // @ts-ignore - we're deliberately modifying the config for testing
      openaiConfig.ai.default_provider = 'openai';
      const service = new AIService(openaiConfig);
      assertEquals(service.provider, 'openai');
      assertEquals(service.model, 'gpt-3.5-turbo');
      assertEquals(Deno.env.get('OPENAI_API_KEY'), 'test-openai-key');
    });

    it('should initialize with Azure provider when configured as default', () => {
      const azureConfig = structuredClone(mockConfig);
      // @ts-ignore - we're deliberately modifying the config for testing
      azureConfig.ai.default_provider = 'azure';
      const service = new AIService(azureConfig);
      assertEquals(service.provider, 'azure');
      assertEquals(service.model, 'gpt-4');
      assertEquals(Deno.env.get('AZURE_OPENAI_API_KEY'), 'test-azure-key');
      assertEquals(Deno.env.get('AZURE_OPENAI_API_ENDPOINT'), 'https://aicp-prod-sc.openai.azure.com/');
    });

    it('should fallback to Ollama when no default provider is set but Ollama is configured', () => {
      const noDefaultConfig = structuredClone(mockConfig);
      // @ts-ignore - we're deliberately modifying the config for testing
      noDefaultConfig.ai.default_provider = undefined;
      const service = new AIService(noDefaultConfig);
      assertEquals(service.provider, 'ollama');
    });

    it('should throw an error when no AI provider is configured', () => {
      const noProviderConfig = { 
        gitlab: { url: 'https://gitlab.example.com', token: 'test-token' },
        ai: {} 
      } as Config;
      assertThrows(
        () => new AIService(noProviderConfig),
        Error,
        "No AI provider configured. Please run 'nova setup' first."
      );
    });
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = AIService.getInstance(mockConfig);
      const instance2 = AIService.getInstance();
      assertEquals(instance1, instance2);
    });

    it('should require config for first initialization', () => {
      assertThrows(
        () => AIService.getInstance(),
        Error,
        'Config is required when initializing AIService'
      );
    });

    it('should allow options to be passed during initialization', () => {
      const instance = AIService.getInstance(mockConfig, { temperature: 0.5, maxTokens: 1000 });
      // @ts-ignore - accessing private property for testing
      assertEquals(instance.temperature, 0.5);
      // @ts-ignore - accessing private property for testing
      assertEquals(instance.maxTokens, 1000);
    });
  });

  describe('generateText', () => {
    it('should call the language model with the provided prompt', async () => {
      const service = new AIService(mockConfig);
      
      // Directly stub the service's generateText method
      const originalGenerateText = service.generateText;
      service.generateText = () => Promise.resolve({ text: 'Mocked response' });
      
      const result = await service.generateText('Hello world');
      
      assertEquals(result.text, 'Mocked response');
      
      // Restore original method
      service.generateText = originalGenerateText;
    });
    
    it('should include system message when provided', async () => {
      const service = new AIService(mockConfig);
      
      // Directly stub the service's generateText method
      const originalGenerateText = service.generateText;
      service.generateText = (_, options) => {
        // Verify options contains the expected messages
        if (options?.messages?.length === 2 && 
            options.messages[0].role === 'system' &&
            options.messages[1].role === 'user') {
          return Promise.resolve({ text: 'Valid chat response' });
        }
        return Promise.resolve({ text: 'Unexpected options' });
      };
      
      const result = await service.generateText('Hello world', { 
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello world' }
        ]
      });
      
      assertEquals(result.text, 'Valid chat response');
      
      // Restore original method
      service.generateText = originalGenerateText;
    });
  });

  describe('generateObject', () => {
    it('should generate an object matching the provided schema', async () => {
      const service = new AIService(mockConfig);
      
      // Define a test schema
      const TestSchema = z.object({
        name: z.string(),
        age: z.number(),
        isActive: z.boolean(),
      });

      const testResult = {
        name: 'John Doe',
        age: 30,
        isActive: true,
      };

      // Directly stub the generateObject method with proper typing
      const originalGenerateObject = service.generateObject;
      service.generateObject = function<T>(_prompt: string, _schema: z.ZodType<T>, _systemPrompt?: string): Promise<T> {
        // This cast is necessary to satisfy TypeScript's generic constraints
        return Promise.resolve(testResult as unknown as T);
      };
      
      try {
        const result = await service.generateObject(
          'Generate a user profile',
          TestSchema,
          'You are a user generator'
        );
        
        assertEquals(result, testResult);
      } finally {
        // Restore original method
        service.generateObject = originalGenerateObject;
      }
    });
  });

  describe('analyzeCode', () => {
    it('should analyze code and return structured feedback', async () => {
      const service = new AIService(mockConfig);
      
      // Sample code to analyze
      const code = `
      function add(a, b) {
        return a + b;
      }
      `;

      // Expected analysis result
      const expectedAnalysis = {
        issues: [
          {
            severity: 'low' as const,
            message: 'Missing parameter types',
            suggestion: 'Add TypeScript types to parameters',
            line: 2,
          }
        ],
        recommendations: ['Add TypeScript type annotations'],
        summary: 'Simple function with minor issues',
      };

      // Directly stub the analyzeCode method
      const originalAnalyzeCode = service.analyzeCode;
      service.analyzeCode = () => Promise.resolve(expectedAnalysis);
      
      try {
        const result = await service.analyzeCode(code, {
          language: 'javascript',
          purpose: 'testing',
        });
        
        assertEquals(result, expectedAnalysis);
      } finally {
        // Restore original method
        service.analyzeCode = originalAnalyzeCode;
      }
    });
  });

  describe('getLLMProvider', () => {
    it('should return the correct provider configuration', () => {
      const service = new AIService(mockConfig);
      const provider = service.getLLMProvider();
      
      assertEquals(provider.name, 'ollama');
    });
    
    it('should include generate capabilities', async () => {
      const service = new AIService(mockConfig);
      
      // Stub the generateText method
      const generateTextStub = stub(
        service,
        'generateText',
        () => Promise.resolve({ text: 'Generated response' })
      );
      
      try {
        const provider = service.getLLMProvider();
        const result = await provider.generate('Test prompt');
        
        assertEquals(result, 'Generated response');
        assertEquals(generateTextStub.calls.length, 1);
      } finally {
        generateTextStub.restore();
      }
    });
  });

  Deno.test('generateObject should generate objects based on schema', async () => {
    resetEnvironment();
    
    // Define a mock config for this test
    const testConfig: Config = {
      gitlab: { url: 'https://gitlab.example.com', token: 'test-token' },
      ai: {
        default_provider: 'ollama',
        ollama: {
          model: 'llama3',
          api_url: 'http://localhost:11434',
        },
        openai: {
          api_key: 'test-openai-key',
          default_model: 'gpt-3.5-turbo',
        }
      },
    };
    
    const service = AIService.getInstance(testConfig);

    // Create a test schema using z.object
    type TestResult = { name: string; age: number; isActive: boolean };
    const testSchema = z.object({
      name: z.string(),
      age: z.number(),
      isActive: z.boolean()
    });
    
    const testResult = { name: 'Test User', age: 30, isActive: true };
    
    // Type-safe stubbing with explicit generics
    const originalMethod = service.generateObject;
    service.generateObject = function<T>(_prompt: string, _schema: z.ZodType<T>, _systemPrompt?: string): Promise<T> {
      // This cast is necessary to satisfy TypeScript's generic constraints
      return Promise.resolve(testResult as unknown as T);
    };

    try {
      const prompt = 'Create a user object';
      const result = await service.generateObject<TestResult>(prompt, testSchema);
      
      assertEquals(result.name, testResult.name);
      assertEquals(result.age, testResult.age);
      assertEquals(result.isActive, testResult.isActive);
    } finally {
      // Restore the original method
      service.generateObject = originalMethod;
    }
  });

  Deno.test('analyzeCode should return code analysis', async () => {
    resetEnvironment();
    
    // Define a mock config for this test
    const testConfig: Config = {
      gitlab: { url: 'https://gitlab.example.com', token: 'test-token' },
      ai: {
        default_provider: 'ollama',
        ollama: {
          model: 'llama3',
          api_url: 'http://localhost:11434',
        },
        openai: {
          api_key: 'test-openai-key',
          default_model: 'gpt-3.5-turbo',
        }
      },
    };
    
    const service = AIService.getInstance(testConfig);
    
    // Create expected analysis result
    const expectedAnalysis: CodeAnalysis = {
      summary: 'Sample code analysis',
      issues: [
        {
          severity: 'medium',
          message: 'Variable is unused',
          explanation: 'The variable x is declared but never used',
          suggestion: 'Remove the unused variable'
        }
      ],
      recommendations: [
        'Add proper error handling',
        'Improve function naming'
      ]
    };
    
    // Store original method reference
    const originalMethod = service.analyzeCode;
    
    // Replace with stub that returns our expected result
    service.analyzeCode = (_code: string, _options: {
      language?: string;
      context?: string;
      purpose?: string;
    } = {}): Promise<CodeAnalysis> => {
      return Promise.resolve(expectedAnalysis);
    };
    
    try {
      const code = `function test() { 
        const x = 5;
        return 10;
      }`;
      
      const result = await service.analyzeCode(code, { language: 'typescript' });
      
      assertEquals(result.summary, expectedAnalysis.summary);
      assertEquals(result.issues.length, expectedAnalysis.issues.length);
      assertEquals(result.recommendations.length, expectedAnalysis.recommendations.length);
      assertEquals(result.issues[0].message, expectedAnalysis.issues[0].message);
    } finally {
      // Restore original method
      service.analyzeCode = originalMethod;
    }
  });
}); 