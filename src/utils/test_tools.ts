import { Config } from '../config/mod.ts';
import { MCPService } from '../services/mcp_service.ts';
import { MCPToolContext, MCPToolResult } from '../types/tool_types.ts';
import { Logger } from './logger.ts';

/**
 * ToolTester class for testing MCP tools
 *
 * Provides an easy interface to test MCP tools in isolation or together
 */
export class ToolTester {
    private mcpService: MCPService;
    private logger: Logger;
    private defaultContext: MCPToolContext;

    /**
     * Create a new ToolTester instance
     *
     * @param config Configuration
     * @param context Optional context to be used for all tests
     */
    constructor(config: Config, context: Partial<MCPToolContext> = {}) {
        this.mcpService = MCPService.getInstance(config);
        this.logger = new Logger('ToolTester');
        this.defaultContext = { ...context };
    }

    /**
     * Test a specific tool with the given parameters
     *
     * @param toolName Name of the tool to test
     * @param params Parameters to pass to the tool
     * @param context Optional context for this specific test
     * @returns Promise with the tool result
     */
    async testTool(
        toolName: string,
        params: Record<string, unknown>,
        context: Partial<MCPToolContext> = {},
    ): Promise<MCPToolResult> {
        const testContext: MCPToolContext = {
            ...this.defaultContext,
            ...context,
            mcpService: this.mcpService,
        };

        this.logger.info(
            `Testing tool "${toolName}" with params:`,
            JSON.stringify(params, null, 2),
        );

        try {
            const result = await this.mcpService.executeTool(toolName, params, testContext);
            this.logger.info(`Tool "${toolName}" test result:`, JSON.stringify(result, null, 2));
            return result;
        } catch (error) {
            this.logger.error(`Error testing tool "${toolName}":`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Test a sequence of tools in order
     *
     * @param steps Array of test steps to execute
     * @returns Array of results from each step
     */
    async testSequence(
        steps: Array<{
            toolName: string;
            params: Record<string, unknown>;
            context?: Partial<MCPToolContext>;
        }>,
    ): Promise<MCPToolResult[]> {
        const results: MCPToolResult[] = [];

        for (const [index, step] of steps.entries()) {
            this.logger.info(
                `Running test sequence step ${index + 1}/${steps.length}: ${step.toolName}`,
            );
            const result = await this.testTool(step.toolName, step.params, step.context);
            results.push(result);

            // Stop sequence if a step fails
            if (!result.success) {
                this.logger.warn(`Test sequence stopped at step ${index + 1} due to failure.`);
                break;
            }
        }

        return results;
    }

    /**
     * Get all available tools for testing
     *
     * @returns Array of available tool functions
     */
    getAvailableTools() {
        return this.mcpService.getTools();
    }
}
