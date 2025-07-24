import { formatError, formatProgress, formatSuccess, theme } from '../../utils.ts';
import { AgentContext, AgentResponse } from '../base_agent.ts';
import { WorkflowAgent } from '../workflow_agent.ts';
import { BaseEngineeringOptions } from './types.ts';

export abstract class BaseDevAgent extends WorkflowAgent {
  protected engineeringOptions: BaseEngineeringOptions;
  abstract override name: string;
  abstract override description: string;

  constructor(context: AgentContext, options: BaseEngineeringOptions = {}) {
    super(context, options);
    this.engineeringOptions = options;
  }

  protected abstract override analyze(): Promise<AgentResponse>;
  protected abstract override implement(): Promise<AgentResponse>;
  protected abstract override validate(): Promise<AgentResponse>;

  public override async execute(command: string, args: string[]): Promise<AgentResponse> {
    try {
      // Common pre-execution validation
      if (!this.validateCommand(command, args)) {
        return {
          success: false,
          message: `Invalid command or arguments for ${this.name}`,
        };
      }

      formatProgress(`Starting ${this.name} analysis...`);

      // Run the analysis phase
      const analysisResult = await this.analyze();
      if (!analysisResult.success) {
        formatError(`Analysis failed: ${analysisResult.message}`);
        return analysisResult;
      }

      // Run the implementation phase
      const implementationResult = await this.implement();
      if (!implementationResult.success) {
        formatError(`Implementation failed: ${implementationResult.message}`);
        return implementationResult;
      }

      // Run the validation phase
      const validationResult = await this.validate();
      if (!validationResult.success) {
        formatError(`Validation failed: ${validationResult.message}`);
        return validationResult;
      }

      formatSuccess(`${this.name} completed successfully`);
      return {
        success: true,
        message: `${theme.symbols.success_celebration} ${this.name} completed successfully`,
        data: {
          analysis: analysisResult.data,
          implementation: implementationResult.data,
          validation: validationResult.data,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      formatError(`Error in ${this.name}: ${errorMessage}`);
      return {
        success: false,
        message: `Error in ${this.name}: ${errorMessage}`,
      };
    }
  }

  protected override validateCommand(_command: string, _args: string[]): boolean {
    // Base validation logic - can be overridden by sub-agents
    return true;
  }

  protected override async getFileContent(path: string): Promise<string> {
    try {
      return await Deno.readTextFile(path);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read file ${path}: ${errorMessage}`);
    }
  }

  protected override async writeFileContent(path: string, content: string): Promise<void> {
    try {
      await Deno.writeTextFile(path, content);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write file ${path}: ${errorMessage}`);
    }
  }
}
