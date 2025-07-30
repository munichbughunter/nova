import { formatError, formatProgress, formatSuccess } from '../utils.ts';
import { AgentContext, AgentResponse, BaseAgent } from './base_agent.ts';
import { BaseEngineeringOptions } from './dev/types.ts';

export interface WorkflowOptions extends BaseEngineeringOptions {
    depth?: 'quick' | 'normal' | 'deep';
    path?: string | string[];
}

export abstract class WorkflowAgent extends BaseAgent {
    protected override options: WorkflowOptions;

    constructor(context: AgentContext, options: WorkflowOptions = {}) {
        super(context);
        this.options = {
            depth: 'normal',
            ...options,
        };
    }

    protected abstract analyze(): Promise<AgentResponse>;
    protected abstract implement(): Promise<AgentResponse>;
    protected abstract validate(): Promise<AgentResponse>;

    async execute(command: string, args: string[]): Promise<AgentResponse> {
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
                message: `${this.name} completed successfully`,
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

    protected validateCommand(_command: string, _args: string[]): boolean {
        // Base validation logic - can be overridden by sub-agents
        return true;
    }

    protected async getFileContent(path: string): Promise<string> {
        try {
            return await Deno.readTextFile(path);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to read file ${path}: ${errorMessage}`);
        }
    }

    protected async writeFileContent(path: string, content: string): Promise<void> {
        try {
            await Deno.writeTextFile(path, content);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to write file ${path}: ${errorMessage}`);
        }
    }
}
