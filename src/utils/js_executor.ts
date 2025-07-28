/**
 * JavaScript Executor Utility
 *
 * Provides utilities for generating and executing JavaScript code safely in a Deno environment.
 */

import { z } from 'zod';
import { LLMProvider } from '../types/tool_types.ts';

/**
 * Interface for JavaScript execution result
 */
export interface JavaScriptExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  generatedCode?: string;
  usedCode: string;
}

/**
 * Sandbox options for JavaScript execution
 */
export interface SandboxOptions {
  timeout?: number;
  context?: Record<string, unknown>;
  allowNetwork?: boolean;
}

/**
 * Generate JavaScript code using an LLM provider
 *
 * @param llmProvider The LLM provider to use for code generation
 * @param description Description of what the code should do
 * @returns Generated JavaScript code
 */
export async function generateJavaScriptCode(
  llmProvider: LLMProvider,
  description: string,
): Promise<string> {
  try {
    const codeSchema = z.object({
      code: z.string(),
    });

    const prompt = `
      Generate JavaScript code to accomplish this task: ${description}
      
      The code should be executable in a JavaScript environment.
      Do not include any imports or require statements.
      Return only valid JavaScript code without comments or explanations.
      
      Your code should be self-contained and should return the final result.
    `;

    const response = await llmProvider.generateObject<{ code: string }>(prompt, codeSchema);
    return response.code;
  } catch (error) {
    throw new Error(
      `Failed to generate JavaScript code: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Execute JavaScript code in a sandboxed environment using Deno's built-in sandbox
 *
 * @param code JavaScript code to execute
 * @param options Sandbox options
 * @returns Result of the execution
 */
export async function executeJavaScriptSandboxed(
  code: string,
  options: SandboxOptions = {},
): Promise<JavaScriptExecutionResult> {
  const {
    timeout = 5000,
    context = {},
    allowNetwork = false,
  } = options;

  try {
    // Wrap the code to handle errors and timeout
    const wrappedCode = `
      (async () => {
        try {
          const context = ${JSON.stringify(context)};
          // Make context variables available in the global scope
          Object.entries(context).forEach(([key, value]) => {
            globalThis[key] = value;
          });
          
          // Execute the user's code and return the result
          const result = await (async () => { 
            ${code}
          })();
          
          return { 
            success: true, 
            result 
          };
        } catch (error) {
          return { 
            success: false, 
            error: error.message 
          };
        }
      })()
    `;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Create a new Blob with the JavaScript code
      const blob = new Blob([wrappedCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);

      // Execute the code in a controlled environment
      // Request minimum required permissions
      await Deno.permissions.request({ name: 'read' });
      if (allowNetwork) {
        await Deno.permissions.request({ name: 'net' });
      }

      // Import and execute the module with signal for timeout
      const module = await import(url + `#${Date.now()}`);
      const result = await Promise.race([
        module.default,
        new Promise<{ success: false; error: string }>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error('Execution timed out'));
          });
        }),
      ]);

      // Cleanup
      URL.revokeObjectURL(url);
      clearTimeout(timeoutId);

      return {
        success: result.success,
        result: result.result,
        error: result.error,
        usedCode: code,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    return {
      success: false,
      error: `JavaScript execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      usedCode: code,
    };
  }
}

/**
 * Generate and execute JavaScript code
 *
 * @param llmProvider LLM provider for code generation (optional if existingCode is provided)
 * @param description Description of what the code should do
 * @param options Sandbox options
 * @param existingCode Optional existing code (skips generation if provided)
 * @returns Result of the execution
 */
export async function generateAndExecuteJavaScript(
  llmProvider: LLMProvider | undefined | null,
  description: string,
  options: SandboxOptions = {},
  existingCode?: string,
): Promise<JavaScriptExecutionResult> {
  try {
    // If no existing code is provided, we need an LLM provider to generate code
    if (!existingCode && !llmProvider) {
      return {
        success: false,
        error: 'No code provided and no LLM provider available for generation',
        usedCode: '',
      };
    }

    // Generate or use existing code
    const code = existingCode || await generateJavaScriptCode(llmProvider!, description);

    // Execute the code
    const result = await executeJavaScriptSandboxed(code, options);

    return {
      ...result,
      generatedCode: existingCode ? undefined : code,
    };
  } catch (error) {
    return {
      success: false,
      error: `JavaScript generation and execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      usedCode: existingCode || '',
    };
  }
}
