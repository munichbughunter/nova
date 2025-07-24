// @ts-nocheck: This file uses browser APIs that are not available in the Deno context but will run correctly at runtime
// but will run correctly at runtime

import { Stagehand } from '@browserbasehq/stagehand';
import { colors } from '@cliffy/ansi/colors';
import { Confirm, Input, Select } from '@cliffy/prompt';
import { z } from 'zod';
import { AIService } from '../../../services/ai_service.ts';
import { theme } from '../../../utils.ts';
import { AISdkClient } from '../../../utils/stagehand-aisdk.ts';
import { AgentResponse, MCPToolResult } from '../../base_agent.ts';
import { BaseDevAgent } from '../base_dev_agent.ts';
import { QATesterOptions, QATestPlanSchema } from '../types.ts';
import { QAAgentContext, StagehandOptions, StagehandStep, TestSession } from './types.ts';

// Define the QATestPlan type locally if not exported from types.ts
type QATestPlan = z.infer<typeof QATestPlanSchema>;

// Update the interface definitions
interface StagehandOptions {
  browserType?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  slowMo?: number;
  modelId?: string;
  debug?: boolean;
}

interface TestSession {
  name: string;
  description: string;
  startUrl: string;
  steps: StagehandStep[];
  observations: string[];
  playwrightCode: string[];
  completed: boolean;
  success: boolean;
  startTime: Date;
  endTime?: Date;
  actions?: Array<{
    type: string;
    description: string;
    selector: string;
    action: string;
    playwrightCode: string;
  }>;
}

export class QAAgent extends BaseDevAgent {
  name = 'QA Tester';
  description = 'Interactive QA testing using Stagehand for browser automation';
  private aiService: AIService;
  protected override options: QATesterOptions;
  private stagehand?: Stagehand;
  private currentSession?: TestSession;
  private modelId: string;
  private actionTypeCache?: Map<string, string>;

  constructor(context: QAAgentContext, options: QATesterOptions = {}) {
    super(context);
    this.options = options;

    // Initialize AI service
    this.aiService = new AIService(this.context.config);
    this.logger.debug('QA Agent initialized with options:', options);
    
    // Set model ID from options, or use config model, or fall back to default
    if (this.options.stagehandModel) {
      this.modelId = this.options.stagehandModel;
    } else if (this.context.config.ai?.default_provider === 'ollama' && this.context.config.ai.ollama?.model) {
      this.modelId = this.context.config.ai.ollama.model;
    } else if (this.context.config.ai?.default_provider === 'openai' && this.context.config.ai.openai?.default_model) {
      this.modelId = this.context.config.ai.openai.default_model;
    } else {
      this.modelId = "qwen3:1.7b"; // Default model if no config available
    }
    
    this.logger.debug('QA Agent using model:', this.modelId);
  }

  override help(): string {
    return `
${theme.header('QA Tester Agent Help')}

Interactive QA testing agent that uses AI-powered browser automation.

Available Commands:
  test                  Start an interactive testing session
  generate-test         Generate a test plan without executing
  run-test              Run a previously generated test
  help                  Show this help message

Options:
  --url <url>           URL to test
  --browser <browser>   Browser to use (chromium|firefox|webkit)
  --headless            Run in headless mode
  --record-video        Record video of the test
  --export-script       Export Playwright script
  --generate-assertions Include automatic assertions
  --mode                Mode (interactive|automate)
  --save-test <path>    Save the generated test
  --model <model>       LLM model to use

Examples:
  # Start interactive testing
  nova agent eng qa-tester test --url https://example.com

  # Generate a test plan
  nova agent eng qa-tester generate-test --url https://example.com
    `;
  }

  override execute(command: string, args: string[]): Promise<AgentResponse> {
    // Show help by default or when help command is used
    if (!command || command === 'help') {
      return Promise.resolve({
        success: true,
        message: this.help(),
      });
    }

    try {
      this.parseArgs(args);

      // Execute the appropriate command and transform the result
      let result: Promise<MCPToolResult>;
      
      switch (command) {
        case 'test':
          result = this.runInteractiveTest();
          break;
        case 'generate-test':
          result = this.generateTestPlan();
          break;
        case 'run-test':
          result = this.runSavedTest();
          break;
        default:
          return Promise.resolve({
            success: false,
            message: `Unknown command: ${command}\n\n${this.help()}`,
          });
      }
      
      // Transform MCPToolResult to AgentResponse
      return result.then(mcpResult => ({
        success: mcpResult.success,
        message: mcpResult.data?.message || mcpResult.error || '',
        data: mcpResult.data
      }));
    } catch (error) {
      this.logger.error('Error executing QA agent command:', error);
      return Promise.resolve({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private parseArgs(args: string[]): void {
    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--url' && i + 1 < args.length) {
        this.options.url = args[++i];
      } else if (arg === '--browser' && i + 1 < args.length) {
        this.options.browser = args[++i] as QATesterOptions['browser'];
      } else if (arg === '--headless') {
        this.options.headless = true;
      } else if (arg === '--record-video') {
        this.options.recordVideo = true;
      } else if (arg === '--export-script') {
        this.options.exportScript = true;
      } else if (arg === '--generate-assertions') {
        this.options.generateAssertions = true;
      } else if (arg === '--mode' && i + 1 < args.length) {
        this.options.mode = args[++i] as QATesterOptions['mode'];
      } else if (arg === '--save-test' && i + 1 < args.length) {
        this.options.saveTestPath = args[++i];
      } else if (arg === '--model' && i + 1 < args.length) {
        this.options.stagehandModel = args[++i];
        this.modelId = args[i];
      }
    }
  }

  /* 
   * Main Testing Methods 
   */

  private async runInteractiveTest(): Promise<MCPToolResult> {
    try {
      // Initialize test session
      await this.initializeTestSession();

      // Initialize Stagehand
      await this.initializeStagehand();

      if (!this.stagehand) {
        throw new Error("Failed to initialize Stagehand");
      }

      // Begin interactive testing
      this.logger.passThrough('log', theme.header('\n🧪 Interactive QA Testing Session\n'));
      this.logger.passThrough('log', `Testing URL: ${colors.yellow(this.currentSession?.startUrl || '')}`);
      this.logger.passThrough('log', `Browser: ${this.options.browser || 'chromium'}\n`);

      // Navigate to the starting URL
      await this.performInitialNavigation();
      
      // Interactive test loop - this is the main conversation flow
      let continueLoop = true;
      while (continueLoop && this.stagehand && this.currentSession) {
        // Get page observations 
        const observations = await this.observePage();
        
        // Show page state to the user
        await this.displayPageState(observations);
        
        // Get next test step from user
        const nextStep = await this.getNextTestStepFromUser();
        
        // Check if user wants to exit
        if (nextStep.toLowerCase() === 'exit' || nextStep.toLowerCase() === 'quit') {
          continueLoop = false;
          break;
        }
        
        // Process the instruction
        const stepResult = await this.processTestStep(nextStep);
        
        // Record step
        this.recordTestStep({
          instruction: nextStep,
          observation: stepResult.observation,
          elementSelector: stepResult.selector,
          success: stepResult.success,
          error: stepResult.error,
          playwrightCode: stepResult.playwrightCode
        });
        
        // If generate script is enabled, show the code for this step
        if (this.options.exportScript && stepResult.playwrightCode) {
          this.logger.passThrough('log', `\n${colors.dim('Playwright code:')}`);
          this.logger.passThrough('log', colors.dim(stepResult.playwrightCode));
        }
      }

      // Complete the test session
      await this.completeTestSession();

      return {
        success: true,
        data: {
          message: 'Test session completed successfully',
          session: this.currentSession,
        }
      };
    } catch (error) {
      this.logger.error('Error in interactive test:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Clean up
      await this.cleanup();
    }
  }

  private async generateTestPlan(): Promise<MCPToolResult> {
    try {
      // Get URL if not provided
      if (!this.options.url) {
        this.options.url = await Input.prompt({
          message: 'Enter the URL to test:',
          default: 'https://example.com',
        });
      }

      // Get test name and description
      const testName = await Input.prompt({
        message: 'Enter a name for this test:',
        default: 'Website Functionality Test',
      });

      const testDescription = await Input.prompt({
        message: 'Enter a description for this test:',
        default: 'Test basic functionality of the website',
      });

      // Generate test plan
      this.logger.passThrough('log', `\n${colors.blue('Generating test plan...')}`);

      const testPlan = await this.aiService.generateObject(
        `Generate a QA test plan for the website at ${this.options.url}. 
        The test should be named "${testName}" and is described as "${testDescription}".
        Include steps for testing key functionality such as navigation, forms, and error states.
        Each step should be specific, actionable, and include appropriate selectors or values when needed.
        Focus on creating a comprehensive plan that would uncover common issues.`,
        QATestPlanSchema,
      );

      // Display the generated test plan
      this.logger.passThrough('log', `\n${theme.header('📋 Generated Test Plan')}`);
      this.logger.passThrough('log', `Name: ${colors.bold(testPlan.name)}`);
      this.logger.passThrough('log', `Description: ${testPlan.description}\n`);
      this.logger.passThrough('log', `${theme.subheader('Test Steps:')}`);

      testPlan.steps.forEach((step, index) => {
        this.logger.passThrough(
          'log',
          `${colors.dim(`${index + 1}.`)} ${step.description} ${
            step.selector ? colors.dim(`(Selector: ${step.selector})`) : ''
          } ${step.value ? colors.dim(`(Value: ${step.value})`) : ''}`,
        );
      });

      if (testPlan.assertions && testPlan.assertions.length > 0) {
        this.logger.passThrough('log', `\n${theme.subheader('Assertions:')}`);
        testPlan.assertions.forEach((assertion, index) => {
          this.logger.passThrough('log', `${colors.dim(`${index + 1}.`)} ${assertion}`);
        });
      }

      if (this.options.saveTestPath) {
        await Deno.writeTextFile(
          this.options.saveTestPath,
          JSON.stringify(testPlan, null, 2),
        );
        this.logger.passThrough('log', `\nTest plan saved to ${colors.yellow(this.options.saveTestPath)}`);
      }

      // Ask if user wants to run this test
      const shouldRun = await Confirm.prompt({
        message: 'Would you like to run this test now?',
        default: true,
      });

      if (shouldRun) {
        return this.runTestPlan(testPlan);
      }

      return {
        success: true,
        data: {
          message: 'Test plan generated successfully',
          testPlan,
        },
      };
    } catch (error) {
      this.logger.error('Error generating test plan:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async runSavedTest(): Promise<MCPToolResult> {
    try {
      // Get the saved test path
      const testPath = this.options.saveTestPath || await Input.prompt({
        message: 'Enter the path to the saved test:',
      });

      const testFileContent = await Deno.readTextFile(testPath);
      const testPlan = JSON.parse(testFileContent) as QATestPlan;

      this.logger.passThrough('log', `\n${theme.header('Running Saved Test Plan')}`);
      this.logger.passThrough('log', `Name: ${colors.bold(testPlan.name)}`);
      this.logger.passThrough('log', `Description: ${testPlan.description}\n`);

      return this.runTestPlan(testPlan);
    } catch (error) {
      this.logger.error('Error running saved test:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async runTestPlan(testPlan: QATestPlan): Promise<MCPToolResult> {
    try {
      // Initialize test session
      await this.initializeTestSession(testPlan.name, testPlan.description);

      // Initialize Stagehand
      await this.initializeStagehand();

      if (!this.stagehand) {
        throw new Error("Failed to initialize Stagehand");
      }

      // Begin automated testing
      this.logger.passThrough('log', theme.header('\n🤖 Automated Test Execution\n'));
      this.logger.passThrough('log', `Testing URL: ${colors.yellow(this.currentSession?.startUrl || '')}`);
      this.logger.passThrough('log', `Browser: ${this.options.browser || 'chromium'}\n`);
      this.logger.passThrough('log', `${theme.subheader('Executing Test Steps:')}`);

      // Navigate to the starting URL
      await this.performInitialNavigation();

      // Execute each step
      for (const [index, step] of testPlan.steps.entries()) {
        this.logger.passThrough('log', `\n${colors.blue(`Step ${index + 1}/${testPlan.steps.length}:`)} ${step.description}`);
        
        // Process the test step
        const stepResult = await this.processTestStep(step.description, step.selector, step.value);
        
        // Record the step
        this.recordTestStep({
          instruction: step.description,
          observation: stepResult.observation,
          elementSelector: stepResult.selector || step.selector,
          success: stepResult.success,
          error: stepResult.error,
          playwrightCode: stepResult.playwrightCode
        });

        // Show result
        if (stepResult.success) {
          this.logger.passThrough('log', colors.green('✓ Step completed successfully'));
        } else {
          this.logger.passThrough('log', colors.red(`✗ Step failed: ${stepResult.error || 'Unknown error'}`));
        }
        
        // If generate script is enabled, show the code for this step
        if (this.options.exportScript && stepResult.playwrightCode) {
          this.logger.passThrough('log', `${colors.dim('Playwright code:')}`);
          this.logger.passThrough('log', colors.dim(stepResult.playwrightCode));
        }

        // Break execution if step failed
        if (!stepResult.success) {
          break;
        }
      }

      // Complete the test session
      await this.completeTestSession();

      return {
        success: this.currentSession?.success || false,
        data: {
          message: this.currentSession?.success 
            ? 'Test completed successfully'
            : 'Test completed with failures',
          session: this.currentSession,
        }
      };
    } catch (error) {
      this.logger.error('Error running test plan:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Clean up
      await this.cleanup();
    }
  }

  /* 
   * Stagehand & Session Management 
   */

  private async initializeTestSession(
    name?: string, 
    description?: string
  ): Promise<void> {
    // Get URL if not provided
    if (!this.options.url) {
      this.options.url = await Input.prompt({
        message: 'Enter the URL to test:',
        default: 'https://example.com',
      });
    }

    // Get test name and description if not provided
    const testName = name || await Input.prompt({
      message: 'Enter a name for this test:',
      default: 'Website Functionality Test',
    });

    const testDescription = description || await Input.prompt({
      message: 'Enter a description for this test:',
      default: 'Test basic functionality of the website',
    });

    // Initialize test session
    this.currentSession = {
      name: testName,
      description: testDescription,
      startUrl: this.options.url,
      steps: [],
      observations: [],
      playwrightCode: [],
      completed: false,
      success: true,
      startTime: new Date(),
    };
  }

  private async initializeStagehand(): Promise<void> {
    try {
      const options: StagehandOptions = {
        browserType: this.options.browser || 'chromium',
        headless: this.options.headless || false,
        slowMo: 100,
        modelId: this.modelId,
        debug: true,
      };

      this.logger.debug('Initializing Stagehand with options:', options);

      // Try to get the model from options or fall back to the default model
      let modelClient = null;
      
      try {
        // Access the languageModel property directly from aiService
        modelClient = this.aiService.languageModel;
        
        if (!modelClient) {
          console.warn(`Failed to get model client. Falling back to default provider.`);
        }
      } catch (error: unknown) {
        console.warn(`Error initializing model: ${error?.message || 'Unknown error'}`);
      }
      
      if (!modelClient) {
        console.error('Could not initialize any model. Aborting interactive test.');
        return;
      }

      // Initialize Stagehand with our model using AISdkClient
      this.stagehand = new Stagehand({
        llmClient: new AISdkClient({
          model: modelClient,
          debug: options.debug
        }),
        env: "LOCAL",
        // @ts-ignore - Type definitions may differ from actual implementation
        browser: {
          type: "playwright",
          headless: options.headless,
          slowMo: options.slowMo
        },
        debug: options.debug
      });

      // Initialize Stagehand
      await this.stagehand.init();
      this.logger.debug('Stagehand initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Stagehand:', error);
      throw error;
    }
  }

  private async performInitialNavigation(): Promise<void> {
    if (!this.stagehand || !this.currentSession) {
      throw new Error("Stagehand or test session not initialized");
    }

    try {
      const page = this.stagehand.page;
      this.logger.passThrough('log', `Navigating to ${colors.yellow(this.currentSession.startUrl)}...`);
      
      await page.goto(this.currentSession.startUrl);
      
      // Wait for DOM to settle
      this.logger.debug('Waiting for DOM to settle...');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000); // Additional delay to ensure everything is loaded
      
      const title = await page.title();
      this.logger.passThrough('log', `Loaded page: ${colors.green(title)}`);
      
      // Record initial navigation step
      this.recordTestStep({
        instruction: `Navigate to ${this.currentSession.startUrl}`,
        observation: `Page loaded with title: ${title}`,
        success: true,
        playwrightCode: `await page.goto('${this.currentSession.startUrl}');`
      });
      
      // Add the initial navigation code to the playwright script
      this.currentSession.playwrightCode.push(
        `// Test name: ${this.currentSession.name}`,
        `// Description: ${this.currentSession.description}`,
        `// Generated on: ${new Date().toISOString()}`,
        ``,
        `const { test, expect } = require('@playwright/test');`,
        ``,
        `test('${this.currentSession.name}', async ({ page }) => {`,
        `  // Navigate to the starting URL`,
        `  await page.goto('${this.currentSession.startUrl}');`,
        `  await page.waitForLoadState('networkidle');`,
        `  await page.waitForTimeout(1000);`,
        `  console.log('Page loaded:', await page.title());`,
        ``
      );
    } catch (error) {
      this.logger.error('Error performing initial navigation:', error);
      throw error;
    }
  }

  private async cleanup(): Promise<void> {
    if (this.stagehand) {
      this.logger.debug('Closing Stagehand...');
      try {
        await this.stagehand.close();
        this.stagehand = undefined;
      } catch (error) {
        this.logger.error('Error closing Stagehand:', error);
      }
    }
  }

  private async completeTestSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.completed = true;
    this.currentSession.endTime = new Date();

    // Close the Playwright script
    this.currentSession.playwrightCode.push('});');

    // Generate final report
    const duration = Math.round(
      (this.currentSession.endTime.getTime() - this.currentSession.startTime.getTime()) / 1000
    );

    this.logger.passThrough('log', `\n${theme.header('📊 Test Session Summary')}`);
    this.logger.passThrough('log', `Name: ${colors.bold(this.currentSession.name)}`);
    this.logger.passThrough('log', `URL: ${this.currentSession.startUrl}`);
    this.logger.passThrough('log', `Duration: ${duration} seconds`);
    this.logger.passThrough('log', `Steps: ${this.currentSession.steps.length}`);
    this.logger.passThrough('log', `Status: ${this.currentSession.success ? colors.green('Passed') : colors.red('Failed')}`);

    // If export script option is enabled, save the Playwright script
    if (this.options.exportScript) {
      const filename = `qa_test_${this.currentSession.name.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.js`;
      await Deno.writeTextFile(filename, this.currentSession.playwrightCode.join('\n'));
      this.logger.passThrough('log', `\nPlaywright script saved to ${colors.yellow(filename)}`);
    }
  }

  private recordTestStep(step: StagehandStep): void {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.steps.push(step);

    // If step wasn't successful, mark the test as failed
    if (!step.success) {
      this.currentSession.success = false;
    }

    // If this step has valid playwright code, add it to the script
    if (step.playwrightCode) {
      this.currentSession.playwrightCode.push(
        `  // Step ${this.currentSession.steps.length}: ${step.instruction}`,
        `  ${step.playwrightCode}`,
        ``
      );
    }
  }

  /* 
   * Page Interaction Methods 
   */

  private async observePage(): Promise<string> {
    if (!this.stagehand) {
      throw new Error("Stagehand not initialized");
    }
    
    try {
      this.logger.debug('Attempting to observe page:', {
        pageUrl: this.stagehand.page.url()
      });

      // Wait for DOM to settle
      await this.stagehand.page.waitForLoadState('networkidle');
      await this.stagehand.page.waitForTimeout(1000);
      
      // Get detailed element information
      // @ts-ignore - Browser context evaluation doesn't match TypeScript context
      const observations = await this.stagehand.page.evaluate(() => {
        // Get all visible text content, including nested elements
        const getVisibleText = (element: unknown): string => {
          // @ts-ignore - DOM API is available in browser context
          const style = globalThis.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return '';
          }

          // For elements with aria-label, use that as the text
          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) {
            return ariaLabel;
          }

          // For elements with data-testid, include it in the text
          const testId = element.getAttribute('data-testid');
          const testIdText = testId ? `[${testId}]` : '';

          // Get text from all child elements, filtering out hidden ones
          // @ts-ignore - DOM API is available in browser context
          const childTexts = Array.from(element.children)
            .map((child: unknown) => getVisibleText(child))
            .filter((text: string) => text.trim());

          // If we have child text, use that
          if (childTexts.length > 0) {
            return childTexts.join(' ') + testIdText;
          }

          // Otherwise use the element's own text content
          const text = element.textContent?.trim() || '';
          return text ? text + testIdText : '';
        };

        // Get all interactive elements
        // @ts-ignore - DOM API is available in browser context
        const interactiveElements = Array.from(document.querySelectorAll(
          'a, button, input, select, textarea, [role="button"], [role="link"], [data-testid]'
        ));

        // Get all text elements
        // @ts-ignore - DOM API is available in browser context
        const textElements = Array.from(document.querySelectorAll(
          'h1, h2, h3, h4, h5, h6, p, span, div'
        ));

        // Combine and filter elements
        const elements = [...interactiveElements, ...textElements];
        const results = elements.map((el: unknown) => {
          try {
            const text = getVisibleText(el);
            if (!text.trim()) return null;

            // @ts-ignore - DOM API is available in browser context
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;

            // Get the best selector for this element
            let selector = '';
            if (el.id) {
              selector = `#${el.id}`;
            } else if (el.getAttribute('data-testid')) {
              selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
            } else if (el.className) {
              // @ts-ignore - Element type is unknown in this context
              const classes = typeof el.className === 'string' ? el.className.split(' ').filter((c: string) => c) : [];
              if (classes.length > 0) {
                selector = `.${classes[0]}`;
              }
            }
            if (!selector) {
              selector = el.tagName.toLowerCase();
            }

            return {
              description: text.trim(),
              selector: selector,
              type: el.tagName.toLowerCase(),
              isInteractive: interactiveElements.includes(el),
              testId: el.getAttribute('data-testid') || undefined
            };
          } catch (e) {
            console.warn('Error processing element:', e);
            return null;
          }
        }).filter(Boolean);

        return {
          success: true,
          data: results,
          error: null
        };
      });

      // Handle the response
      if (!observations || !observations.success) {
        this.logger.error('Failed to get observations:', observations?.error);
        return "Failed to observe page content - error occurred";
      }

      const elements = observations.data;
      this.logger.debug(`Found ${elements.length} elements on the page`);

      // Format the observations for display
      const formattedObservation = [
        `Title: ${await this.stagehand.page.title()}`,
        `URL: ${this.stagehand.page.url()}`,
        `\nPage loaded successfully. Use the selection menu below to interact with elements.`,
        `The menu includes utility commands and ${elements.filter((e: unknown) => e.isInteractive).length} interactive elements.`
      ].join('\n');
      
      return formattedObservation;
    } catch (error) {
      this.logger.error('Error observing page:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return "Failed to observe page content - error occurred";
    }
  }

  private async extractFromPage(query: string): Promise<string> {
    if (!this.stagehand) {
      throw new Error("Stagehand not initialized");
    }
    
    try {
      // @ts-ignore - Method signature might differ from type definitions
      const result = await this.stagehand.extract(query);
      
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      this.logger.error('Error extracting from page:', error);
      return `Failed to extract information for query: ${query}`;
    }
  }

  private displayPageState(observations: string): Promise<void> {
    if (!this.stagehand) {
      return Promise.resolve();
    }

    try {
      // Display page info
      this.logger.passThrough('log', `\n${theme.subheader('Current Page')}`);
      
      // Make sure observations is a string and not undefined
      const safeObservations = typeof observations === 'string' ? observations : 'No observations available';
      this.logger.passThrough('log', `Observations: ${colors.dim(safeObservations)}`);
      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error displaying page state:', error);
      return Promise.resolve();
    }
  }

  private async getNextTestStepFromUser(): Promise<string> {
    // Get instruction from user
    const input = await Input.prompt({
      message: 'Enter your next test step (or type "exit" to end test):',
    });

    return input;
  }

  private async processTestStep(
    instruction: string, 
    _selector?: string, 
    value?: string
  ): Promise<{
    success: boolean;
    observation?: string;
    selector?: string;
    error?: string;
    playwrightCode?: string;
  }> {
    if (!this.stagehand) {
      return { success: false, error: "Stagehand not initialized" };
    }

    try {
      // Get interactive elements directly from the page
      const elements = await this.stagehand.page.evaluate(() => {
        const getElementInfo = (el: Element) => {
          const text = el.textContent?.trim() || el.getAttribute('aria-label') || '';
          const testId = el.getAttribute('data-testid');
          const id = el.id;
          const classes = typeof el.className === 'string' ? el.className.split(' ').filter(c => c) : [];
          const type = el.tagName.toLowerCase();
          
          // Get the best selector for this element
          let selector = '';
          if (testId) {
            selector = `[data-testid="${testId}"]`;
          } else if (id) {
            selector = `#${id}`;
          } else if (classes.length > 0) {
            selector = `.${classes[0]}`;
          } else {
            selector = type;
          }

          return {
            text,
            selector,
            type,
            testId,
            id,
            classes: classes.join(' '),
            fullText: `${text}${testId ? ` [${testId}]` : ''}${id ? ` [${id}]` : ''}${classes.length > 0 ? ` [${classes.join(' ')}]` : ''}`
          };
        };

        // Get all interactive elements
        const interactiveElements = Array.from(document.querySelectorAll(
          'a, button, input, select, textarea, [role="button"], [role="link"], [data-testid]'
        )).map(getElementInfo).filter(el => el.text.trim());

        return interactiveElements;
      });

      // Create options for Select with both elements and utility commands
      const actionOptions = [
        { name: '📋 Help: Show available commands', value: 'help' },
        { name: '🚪 Exit: End the test session', value: 'exit' },
        { name: '🔄 Refresh: Reload the current page', value: 'refresh' },
        { name: '📸 Screenshot: Take a screenshot', value: 'screenshot' },
        { name: '◀️ Back: Navigate back', value: 'back' },
        { name: '▶️ Forward: Navigate forward', value: 'forward' },
        { name: '───────────────────────────', value: 'divider', disabled: true },
        ...elements.map((el, index) => ({
          name: `${index + 1}. ${el.fullText} (${el.selector})`,
          value: `element:${index}`
        }))
      ] as Array<{
        name: string;
        value: string;
        disabled?: boolean;
      }>;

      // Use Select component with compatible options
      const selectedAction = await Select.prompt({
        message: 'Select an action or element:',
        options: actionOptions,
        search: true,
        maxRows: 15,
        info: true,
        indent: '  ',
        listPointer: '→'
      });

      if (selectedAction === undefined) {
        return {
          success: false,
          error: "No action selected"
        };
      }

      // Handle utility commands
      if (selectedAction === 'exit' || selectedAction === 'quit') {
        return { 
          success: true, 
          observation: "Test session ended" 
        };
      } else if (selectedAction === 'refresh') {
        await this.stagehand.page.reload();
        await this.stagehand.page.waitForLoadState('networkidle');
        return { 
          success: true, 
          observation: "Page refreshed successfully" 
        };
      } else if (selectedAction === 'screenshot') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot-${timestamp}.png`;
        await this.stagehand.page.screenshot({ path: filename });
        return { 
          success: true, 
          observation: `Screenshot saved as ${filename}` 
        };
      } else if (selectedAction === 'back') {
        await this.stagehand.page.goBack();
        await this.stagehand.page.waitForLoadState('networkidle');
        return { 
          success: true, 
          observation: "Navigated back" 
        };
      } else if (selectedAction === 'forward') {
        await this.stagehand.page.goForward();
        await this.stagehand.page.waitForLoadState('networkidle');
        return { 
          success: true, 
          observation: "Navigated forward" 
        };
      } else if (selectedAction === 'help') {
        return {
          success: true,
          observation: `
Available commands:
- Help: Show available commands
- Exit: End the test session
- Refresh: Reload the current page
- Screenshot: Take a screenshot
- Back: Navigate back
- Forward: Navigate forward
- <number>: Select element by number
`
        };
      } else if (selectedAction === 'divider') {
        return {
          success: false,
          error: "Please select a valid action or element"
        };
      }

      // Handle element selection (format is "element:index")
      const elementMatch = selectedAction.match(/^element:(\d+)$/);
      if (elementMatch) {
        const elementIndex = parseInt(elementMatch[1]);
        const element = elements[elementIndex];
        const previewAction = {
          description: element.text,
          action: 'click',
          selector: element.selector
        };

        // Log the preview
        this.logger.passThrough('log', `\n${colors.blue('Preview Action:')}`);
        this.logger.passThrough('log', `Description: ${previewAction.description}`);
        this.logger.passThrough('log', `Action: ${previewAction.action}`);
        this.logger.passThrough('log', `Selector: ${previewAction.selector}`);

        // Get confirmation from user
        const confirm = await Confirm.prompt({
          message: 'Would you like to execute this action?',
          default: true,
        });

        if (!confirm) {
          return {
            success: false,
            error: "Action cancelled by user"
          };
        }

        // Try to execute with Playwright first
        let result;
        try {
          // Convert the action to Playwright format
          const playwrightAction = this.convertToPlaywrightAction(previewAction);
          result = await this.stagehand.page.act(playwrightAction);
        } catch (playwrightError) {
          this.logger.debug('Playwright action failed, falling back to Stagehand AI:', playwrightError);
          // If Playwright fails, fall back to Stagehand AI
          result = await this.stagehand.page.act(previewAction);
        }

        // Generate playwright code
        const playwrightCode = await this.generatePlaywrightCode(
          instruction,
          previewAction.selector,
          value
        );

        // Record the action for replay
        this.recordAction({
          type: "act",
          description: previewAction.description,
          selector: previewAction.selector,
          action: previewAction.action,
          playwrightCode
        });

        return {
          success: result.success !== false,
          // @ts-ignore - ActResult may have observation property in runtime
          observation: result.observation || "Action completed",
          selector: previewAction.selector,
          playwrightCode
        };
      }

      // If we get here, something unexpected happened
      return {
        success: false,
        error: "Invalid selection"
      };
    } catch (error) {
      this.logger.error('Error processing test step:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        playwrightCode: `// Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private convertToPlaywrightAction(action: unknown): unknown {
    switch (action.action) {
      case 'click':
        return {
          description: action.description,
          method: 'click',
          selector: action.selector
        };
      case 'type':
        return {
          description: action.description,
          method: 'fill',
          selector: action.selector,
          arguments: [action.arguments?.[0] || '']
        };
      case 'select':
        return {
          description: action.description,
          method: 'selectOption',
          selector: action.selector,
          arguments: [action.arguments?.[0] || '']
        };
      default:
        return action;
    }
  }

  private recordAction(action: {
    type: string;
    description: string;
    selector: string;
    action: string;
    playwrightCode: string;
  }): void {
    if (!this.currentSession) return;
    
    if (!this.currentSession.actions) {
      this.currentSession.actions = [];
    }
    
    this.currentSession.actions.push(action);
  }

  private generateReplayScript(): Promise<string> {
    if (!this.currentSession?.actions) {
      return Promise.resolve('');
    }

    const replay = this.currentSession.actions
      .map((action: unknown) => {
        switch (action.type) {
          case "act":
            return action.playwrightCode;
          case "extract":
            return `await page.extract("${action.description}")`;
          case "goto":
            return `await page.goto("${action.selector}")`;
          case "wait":
            return `await page.waitForTimeout(${parseInt(action.selector)})`;
          case "navback":
            return `await page.goBack()`;
          case "refresh":
            return `await page.reload()`;
          case "close":
            return `await stagehand.close()`;
          default:
            return `// Unknown action: ${action.type}`;
        }
      })
      .join("\n");

    return Promise.resolve(`
import { Page, BrowserContext, Stagehand } from "@browserbasehq/stagehand";

export async function main(stagehand: Stagehand) {
    const page = stagehand.page;
    ${replay}
}
    `);
  }

  private async saveReplayScript(): Promise<void> {
    if (!this.currentSession) return;

    const script = await this.generateReplayScript();
    const filename = `qa_test_${this.currentSession.name.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.ts`;
    
    try {
      await Deno.writeTextFile(filename, script);
      this.logger.passThrough('log', `\nReplay script saved to ${colors.yellow(filename)}`);
    } catch (error) {
      this.logger.error('Failed to save replay script:', error);
    }
  }

  private async generatePlaywrightCode(
    instruction: string,
    selector?: string,
    value?: string
  ): Promise<string> {
    // Basic playwright code generation based on instruction type
    if (!this.stagehand) {
      return "// Stagehand not initialized";
    }
    
    try {
      // First try to get Stagehand's recommendation for the code
      if (this.stagehand.generateCode) {
        try {
          const generatedCode = await this.stagehand.generateCode(instruction, {
            selector,
            value,
            framework: "playwright"
          });
          
          if (generatedCode && generatedCode.length > 0) {
            return generatedCode;
          }
        } catch (codeGenError) {
          this.logger.debug('Stagehand code generation failed, falling back to AI:', codeGenError);
        }
      }
      
      // If we can't use the AI service's chat.completions method, fall back to a simple approach
      // Generate basic playwright code based on instruction type
      if (instruction.toLowerCase().includes('navigate')) {
        const urlMatch = instruction.match(/https?:\/\/[^\s"']+/);
        const url = urlMatch ? urlMatch[0] : '';
        return url ? `await page.goto('${url}');` : `// Navigation: ${instruction}`;
      } else if (instruction.toLowerCase().includes('click') && selector) {
        return `await page.click('${selector}');`;
      } else if ((instruction.toLowerCase().includes('type') || 
                  instruction.toLowerCase().includes('input') || 
                  instruction.toLowerCase().includes('fill')) && selector) {
        return `await page.fill('${selector}', '${value || ''}');`;
      } else if (instruction.toLowerCase().includes('wait')) {
        const waitTime = instruction.match(/\d+/)?.[0] || '1000';
        return `await page.waitForTimeout(${waitTime});`;
      } else if (instruction.toLowerCase().includes('assert') || instruction.toLowerCase().includes('check')) {
        if (selector) {
          return `await expect(page.locator('${selector}')).toBeVisible();`;
        } else {
          return `// Assertion: ${instruction}`;
        }
      } else if (instruction.toLowerCase().includes('select') && selector) {
        return `await page.selectOption('${selector}', '${value || ''}');`;
      } else if (instruction.toLowerCase().includes('hover') && selector) {
        return `await page.hover('${selector}');`;
      } else if (instruction.toLowerCase().includes('press') || instruction.toLowerCase().includes('key')) {
        const key = instruction.match(/press\s+(\w+)/i)?.[1] || 'Enter';
        return `await page.keyboard.press('${key}');`;
      } else if (instruction.toLowerCase().includes('screenshot')) {
        return `await page.screenshot({ path: 'screenshot.png' });`;
      } else {
        return `// Action: ${instruction}`;
      }
    } catch (error) {
      this.logger.error('Error generating Playwright code:', error);
      return `// Failed to generate code: ${instruction}`;
    }
  }

  override analyze(): Promise<AgentResponse> {
    return Promise.resolve({
      success: true,
      message: "QA Agent does not implement analyze method",
    });
  }

  override implement(): Promise<AgentResponse> {
    return Promise.resolve({
      success: true,
      message: "QA Agent does not implement implement method",
    });
  }

  override validate(): Promise<AgentResponse> {
    return Promise.resolve({
      success: true,
      message: "QA Agent does not implement validate method",
    });
  }
}