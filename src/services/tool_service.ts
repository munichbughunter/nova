import { tool } from 'ai';
import { z } from 'zod';
import { Config } from '../config/types.ts';
import { MCPToolContext, MCPToolResult } from '../types/tool_types.ts';
import { Logger } from '../utils/logger.ts';
import { MCPService } from './mcp_service.ts';

// Define schemas for chat responses
export const ChatResponseSchema = z.object({
  response: z.string(),
  suggestions: z.array(z.string()).optional(),
  context: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

// Create a standardized tool parameters helper
export function createToolParameters<T>(schema: z.ZodSchema<T>) {
  const zodType = schema as z.ZodType<T>;
  return Object.assign(zodType, {
    '~standard': {
      type: 'object',
      version: 1,
      vendor: 'nova',
      validate: (input: unknown) => {
        try {
          zodType.parse(input);
          return true;
        } catch {
          return false;
        }
      },
    },
    '~validate': {
      type: 'object',
      version: 1,
      vendor: 'nova',
      validate: (input: unknown) => {
        try {
          zodType.parse(input);
          return true;
        } catch {
          return false;
        }
      },
    },
  });
}

type ChatResponse = z.infer<typeof ChatResponseSchema>;

interface StepResult {
  role: 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface GenerateTextResult {
  text: string;
  steps?: Array<StepResult>;
}

// Define tool result types
type ListDirResult = MCPToolResult & {
  data?: {
    files: unknown;
  };
};

type CodebaseSearchResult = MCPToolResult & {
  data?: {
    matches: unknown;
  };
};

type RunCommandResult = MCPToolResult & {
  data?: {
    output: unknown;
  };
};

type GitLabSearchResult = MCPToolResult & {
  data?: {
    formatted: string;
  };
};

type GitLabCreateIssueResult = MCPToolResult & {
  data?: {
    issue: unknown;
  };
};

type JiraSearchResult = MCPToolResult & {
  data?: {
    total: number;
    issues: Array<{
      key: string;
      fields: {
        summary: string;
        status: { name: string };
        assignee?: { displayName: string };
        updated: string;
      };
    }>;
  };
};

type JiraCreateIssueResult = MCPToolResult & {
  data?: {
    issue: unknown;
  };
};

type ConfluenceSearchResult = MCPToolResult & {
  data?: {
    formatted: string;
  };
};

type ConfluenceCreatePageResult = MCPToolResult & {
  data?: {
    page: unknown;
  };
};

type DatadogSearchResult = MCPToolResult & {
  data?: {
    formatted: string;
  };
};

type DoraMetricsResult = MCPToolResult & {
  data?: {
    formatted: string;
  };
};

// Helper function to format MCP tool result
function _formatMCPResult(
  result: { success: boolean; error?: string; data?: unknown },
): { success: boolean; error?: string; formatted: string; data?: unknown } {
  if ('error' in result) {
    return {
      success: false,
      error: result.error,
      formatted: result.error || 'Unknown error',
    };
  }
  return {
    success: true,
    data: result.data,
    formatted: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2),
  };
}

// Define tool schemas
const listDirSchema = createToolParameters(
  z.object({
    relative_workspace_path: z.string().describe('Relative path to list contents of'),
  }),
);

const searchCodeSchema = createToolParameters(
  z.object({
    query: z.string().describe('Search query'),
  }),
);

const runCommandSchema = createToolParameters(
  z.object({
    command: z.string().describe('Command to execute'),
  }),
);

const gitlabSearchSchema = createToolParameters(
  z.object({
    query: z.string().describe('Search query'),
    scope: z.enum(['projects', 'issues', 'merge_requests']).describe('What to search for'),
    project: z.string().optional().describe('Optional project path (e.g., group/project)'),
  }),
);

const gitlabCreateIssueSchema = createToolParameters(
  z.object({
    title: z.string().describe('Issue title'),
    description: z.string().describe('Issue description'),
    project: z.string().describe('Project path (e.g., group/project)'),
    labels: z.array(z.string()).optional().describe('Issue labels'),
  }),
);

const jiraSearchSchema = createToolParameters(
  z.object({
    query: z.string().describe('Natural language query to search with'),
    project: z.string().optional().describe('Optional project key to search in'),
  }),
);

const jiraCreateIssueSchema = createToolParameters(
  z.object({
    project: z.string().describe('Jira project key'),
    issueType: z.string().describe('Type of issue'),
    summary: z.string().describe('Issue summary'),
    description: z.string().describe('Issue description'),
    labels: z.array(z.string()).optional().describe('Issue labels'),
  }),
);

const confluenceSearchSchema = createToolParameters(
  z.object({
    query: z.string().describe('Search query'),
    space: z.string().optional().describe('Optional space key to search in'),
  }),
);

const confluenceCreatePageSchema = createToolParameters(
  z.object({
    space: z.string().describe('Space key'),
    title: z.string().describe('Page title'),
    content: z.string().describe('Page content in Confluence markup'),
    parentId: z.string().optional().describe('Optional parent page ID'),
  }),
);

const datadogSearchSchema = createToolParameters(
  z.object({
    query: z.string().describe('Search query'),
    type: z.enum(['metrics', 'logs']).describe('What to search for'),
    timeRange: z.string().describe('Time range (e.g., "1h", "1d", "1w")'),
  }),
);

const doraMetricsSchema = createToolParameters(
  z.object({
    project: z.string().describe('Project path (e.g., group/project)'),
    timeRange: z.enum(['7d', '30d', '90d']).describe('Time range for metrics'),
  }),
);

// Define tool types
type ListDirParams = z.infer<typeof listDirSchema>;
type SearchCodeParams = z.infer<typeof searchCodeSchema>;
type RunCommandParams = z.infer<typeof runCommandSchema>;
type GitLabSearchParams = z.infer<typeof gitlabSearchSchema>;
type GitLabCreateIssueParams = z.infer<typeof gitlabCreateIssueSchema>;
type JiraSearchParams = z.infer<typeof jiraSearchSchema>;
type JiraCreateIssueParams = z.infer<typeof jiraCreateIssueSchema>;
type ConfluenceSearchParams = z.infer<typeof confluenceSearchSchema>;
type ConfluenceCreatePageParams = z.infer<typeof confluenceCreatePageSchema>;
type DatadogSearchParams = z.infer<typeof datadogSearchSchema>;
type DoraMetricsParams = z.infer<typeof doraMetricsSchema>;

/**
 * ToolService provides a standardized approach to create and manage AI tools
 * across different services in the nova CLI.
 */
export class ToolService {
  private static instance: ToolService | null = null;
  private logger: Logger;
  public mcpService: MCPService;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger('ToolService', Deno.env.get('nova_DEBUG') === 'true');
    this.mcpService = MCPService.getInstance(config);
  }

  /**
   * Get the singleton instance of the ToolService
   */
  public static getInstance(config: Config): ToolService {
    if (!ToolService.instance) {
      ToolService.instance = new ToolService(config);
    }
    return ToolService.instance;
  }

  /**
   * Get all available tools (MCP tools)
   */
  public getAllTools(context: MCPToolContext): Record<string, ReturnType<typeof tool>> {
    return this.createMCPTools(context);
  }

  /**
   * Create a set of tools from all available MCP tools
   */
  public createMCPTools(context: MCPToolContext): Record<string, ReturnType<typeof tool>> {
    const mcpTools = this.mcpService.getTools();
    const tools: Record<string, ReturnType<typeof tool>> = {};

    for (const mcpTool of mcpTools) {
      const { name } = mcpTool.function;
      // @ts-ignore - Ignoring type errors due to incompatibilities between zod and ai library
      tools[name] = this.createMCPToolWrapper(name, context);
    }

    return tools;
  }

  /**
   * Create a tool wrapper for an MCP tool
   */
  private createMCPToolWrapper(
    toolName: string,
    context: MCPToolContext,
  ) {
    const mcpTool = this.mcpService.getToolByName(toolName);
    if (!mcpTool) {
      throw new Error(`MCP tool '${toolName}' not found`);
    }

    const { name, description, parameters } = mcpTool.function;

    // Create Zod schema from JSON schema parameters
    const zodSchema = this.convertJsonSchemaToZod(parameters);

    // @ts-ignore - Ignoring type errors due to incompatibilities between zod and ai library
    return tool({
      name,
      description,
      // @ts-ignore - Ignoring type errors due to incompatibilities between zod and ai library
      parameters: createToolParameters(zodSchema),
      execute: async (params: Record<string, unknown>) => {
        this.logger.debug(`Executing MCP tool ${name} with params:`, params);
        const result = await this.mcpService.executeTool(name, params, context);
        this.logger.debug(`MCP tool ${name} result:`, result);
        return result as MCPToolResult;
      },
      // @ts-ignore - Ignoring type errors for tool result content format
      experimental_toToolResultContent: (result: unknown) => {
        const typedResult = result as MCPToolResult;
        let displayText = '';

        if (!typedResult.success && typedResult.error) {
          displayText = `Error: ${typedResult.error}`;
        } else if (typedResult.message) {
          displayText = typedResult.message;
        } else if (typedResult.data) {
          displayText = typeof typedResult.data === 'string'
            ? typedResult.data
            : JSON.stringify(typedResult.data, null, 2);
        } else {
          displayText = typeof result === 'object'
            ? JSON.stringify(result, null, 2)
            : String(result);
        }

        // Return array with text content for ToolResultContent
        return [{ type: 'text', text: displayText }];
      },
    });
  }

  /**
   * Get a specific subset of tools by name
   */
  public getToolsByNames(
    toolNames: string[],
    context: MCPToolContext,
  ): Record<string, ReturnType<typeof tool>> {
    const allTools = this.getAllTools(context);
    const subset: Record<string, ReturnType<typeof tool>> = {};

    for (const name of toolNames) {
      if (allTools[name]) {
        subset[name] = allTools[name];
      } else {
        this.logger.warn(`Tool "${name}" not found`);
      }
    }

    return subset;
  }

  /**
   * Convert JSON Schema parameters to Zod schema
   */
  private convertJsonSchemaToZod(parameters: Record<string, unknown>): z.ZodTypeAny {
    // Default schema for unknown parameters
    if (!parameters || parameters.type !== 'object' || !parameters.properties) {
      return z.unknown();
    }

    const schemaObj: Record<string, z.ZodTypeAny> = {};
    const required = (parameters.required as string[]) || [];
    const properties = parameters.properties as Record<string, Record<string, unknown>>;

    for (const [key, prop] of Object.entries(properties)) {
      let fieldSchema: z.ZodTypeAny;

      // Type conversion
      switch (prop.type) {
        case 'string':
          fieldSchema = z.string();
          if (prop.enum) {
            fieldSchema = z.enum(prop.enum as [string, ...string[]]);
          }
          break;
        case 'integer':
          fieldSchema = z.number().int();
          break;
        case 'number':
          fieldSchema = z.number();
          break;
        case 'boolean':
          fieldSchema = z.boolean();
          break;
        case 'array':
          fieldSchema = this.handleArraySchema(prop);
          break;
        case 'object':
          fieldSchema = this.handleObjectSchema(prop);
          break;
        default:
          fieldSchema = z.unknown();
      }

      // Add description if available
      if (prop.description) {
        fieldSchema = fieldSchema.describe(prop.description as string);
      }

      // Make optional if not in required array
      if (!required.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }

      schemaObj[key] = fieldSchema;
    }

    return z.object(schemaObj);
  }

  /**
   * Handle array schema conversion
   */
  private handleArraySchema(prop: Record<string, unknown>): z.ZodTypeAny {
    const items = prop.items as Record<string, unknown> | undefined;
    if (!items) {
      return z.array(z.unknown());
    }

    // Simple array type handling
    switch (items.type) {
      case 'string':
        return z.array(z.string());
      case 'number':
        return z.array(z.number());
      case 'boolean':
        return z.array(z.boolean());
      default:
        return z.array(z.unknown());
    }
  }

  /**
   * Handle object schema conversion
   */
  private handleObjectSchema(_prop: Record<string, unknown>): z.ZodTypeAny {
    // Simple passthrough for nested objects
    return z.record(z.unknown());
  }

  /**
   * Execute an MCP tool
   */
  public async executeMCPTool(
    toolName: string,
    params: Record<string, unknown>,
    context: MCPToolContext,
  ): Promise<MCPToolResult> {
    try {
      return await this.mcpService.executeTool(toolName, params, context);
    } catch (error) {
      this.logger.error(`Error executing MCP tool ${toolName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
