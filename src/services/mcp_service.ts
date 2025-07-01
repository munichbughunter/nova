import { ensureDir } from "https://deno.land/std@0.208.0/fs/ensure_dir.ts";
import { exists } from "https://deno.land/std@0.208.0/fs/exists.ts";
import { dirname } from "https://deno.land/std@0.208.0/path/mod.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport as SSEServerTransportType } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "node:http";
import type { Config } from "../config/types.ts";
import {
  // ConfluenceServiceType,
  // DatadogServiceType,
  GitLabServiceType,
  // JiraServiceType,
  LLMProvider,
  MCPTool,
  MCPToolContext,
  MCPToolFunction,
  MCPToolResult,
} from "../types/tool_types.ts";
import { Logger } from "../utils/logger.ts";
import { AIService } from "./ai_service.ts";
import { ProjectSchema } from '@gitbeaker/rest';

// Browser tool types
type AtomicMethod =
  | "GOTO"
  | "ACT"
  | "EXTRACT"
  | "OBSERVE"
  | "CLOSE"
  | "SCREENSHOT"
  | "WAIT"
  | "NAVBACK"
  | "HTML"
  | "CLOSE"
  | "AI_HANDLE";

type Step = {
  text: string;
  reasoning: string;
  method: AtomicMethod;
  instruction?: string;
  result?: unknown;
  timestamp?: string;
  url?: string;
};

// Define a type for the expected response from generateObject
type CodeResponse = {
  code: string;
};

// Add interface for changes
interface GitLabMergeRequestChanges {
    changes: Array<{
        id: string;
        title: string;
        new_file: boolean;
        renamed_file: boolean;
        deleted_file: boolean;
        file_path: string;
        line_count: number;
    }>;
    stats: unknown;
    diffRefs: {
        base_sha: string;
        head_sha: string;
        start_sha: string;
    };
}

type GitLabMergeRequest = {
  iid: number;
  title: string;
  description: string;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  author?: {
    name: string;
    username: string;
  };
};

// At the top of src/services/mcp_service.ts
type GitLabDiscussion = {
  id: string;
  notes: {
    nodes: Array<{
      id: string;
      body: string;
      author: { name: string; username: string };
      created_at: string;
      system: boolean;
    }>;
  };
};

/**
 * MCP Service
 *
 * MCP Service is a service that provides a set of tools for the MCP.
 * It is used to execute tools and get results from the MCP.
 */
export class MCPService {
  private static instance: MCPService | null = null;
  private config: Config;
  private logger: Logger;
  private tools: Map<string, MCPToolFunction>;
  private activeServers: Server[] = [];

  // Define tool categories
  private static readonly IDE_EXCLUDED_TOOLS = new Set([
    "file_read",
    "file_write",
    "list_dir",
  ]);

  // Helper function to create the JavaScript executor tool definition
  private getJavaScriptExecutorTool(): MCPToolFunction {
    return {
      type: "function",
      function: {
        name: "javascript_executor",
        description:
          "Execute JavaScript code directly or generate and execute code based on a description.",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Description of what the JavaScript code should do. Required if no code is provided.",
            },
            code: {
              type: "string",
              description: "JavaScript code to execute directly. If provided, no AI generation will be used.",
            },
            context: {
              type: "object",
              description: "Data to make available in the execution context",
            },
          },
          required: ["description"],
        },
      },
    };
  }

  private constructor(config: Config) {
    this.config = config;
    this.logger = new Logger("MCPService");
    this.tools = new Map();
    this.initializeTools();
  }

  public static getInstance(config: Config): MCPService {
    if (!MCPService.instance) {
      MCPService.instance = new MCPService(config);
    }
    return MCPService.instance;
  }

  private initializeTools(): void {
    const tools: MCPToolFunction[] = [
      // File Operations - Only available in CLI context
      {
        type: "function",
        function: {
          name: "file_read",
          description: "Read file content",
          parameters: {
            type: "object",
            properties: {
              file: {
                type: "string",
                description: "Absolute path of the file to read",
                example: "/Users/user/project/src/main.ts",
              },
              start_line: {
                type: "number",
                description: "Starting line to read from, 0-based",
                example: 10,
              },
              end_line: {
                type: "number",
                description: "Ending line number (exclusive)",
                example: 20,
              },
              encoding: {
                type: "string",
                description: "File encoding",
                example: "utf8",
              },
              sudo: {
                type: "boolean",
                description: "Whether to use sudo privileges",
              },
            },
            required: ["file"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "file_write",
          description: "Write content to a file",
          parameters: {
            type: "object",
            properties: {
              file: {
                type: "string",
                description: "Absolute path of the file to write",
                example: "/Users/user/project/src/output.txt",
              },
              content: {
                type: "string",
                description: "Content to write to the file",
                example: "Hello, World!",
              },
              encoding: {
                type: "string",
                description: "File encoding",
                default: "utf8",
                example: "utf8",
              },
              append: {
                type: "boolean",
                description: "Whether to append to the file instead of overwriting",
                default: false,
                example: false,
              },
            },
            required: ["file", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_dir",
          description: "List contents of a directory",
          parameters: {
            type: "object",
            properties: {
              relative_workspace_path: {
                type: "string",
                description: "Relative path to list contents of",
                example: "src/components",
              },
              include_stats: {
                type: "boolean",
                description: "Whether to include detailed file stats",
                default: false,
                example: false,
              },
            },
            required: ["relative_workspace_path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "init_task",
          description: "Initialize a new task environment",
          parameters: {
            type: "object",
            properties: {
              taskName: {
                type: "string",
                description: "Name of the task",
                example: "code-analysis",
              },
            },
            required: ["taskName"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_task_file",
          description: "Write a file in a task directory",
          parameters: {
            type: "object",
            properties: {
              taskDir: {
                type: "string",
                description: "Task directory path",
                example: "results/task-123",
              },
              filename: {
                type: "string",
                description: "Name of the file to write",
                example: "analysis.md",
              },
              content: {
                type: "string",
                description: "Content to write to the file",
                example: "# Analysis Results\n\nFindings go here...",
              },
              encoding: {
                type: "string",
                description: "File encoding",
                default: "utf8",
                example: "utf8",
              },
            },
            required: ["taskDir", "filename", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read_task_file",
          description: "Read a file from a task directory",
          parameters: {
            type: "object",
            properties: {
              taskDir: {
                type: "string",
                description: "Task directory path",
                example: "results/task-123",
              },
              filename: {
                type: "string",
                description: "Name of the file to read",
                example: "analysis.md",
              },
              encoding: {
                type: "string",
                description: "File encoding",
                default: "utf8",
                example: "utf8",
              },
            },
            required: ["taskDir", "filename"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_task_info",
          description: "Get task metadata information",
          parameters: {
            type: "object",
            properties: {
              taskDir: {
                type: "string",
                description: "Task directory path",
                example: "results/task-123",
              },
            },
            required: ["taskDir"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "terminal",
          description: "Execute shell commands in the system terminal",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "Shell command to execute",
                example: "ls -la",
              },
              workingDir: {
                type: "string",
                description: "Working directory for command execution",
                example: "/Users/user/project",
              },
              timeout: {
                type: "integer",
                description: "Timeout in milliseconds",
                example: 30000,
              },
              require_user_approval: {
                type: "boolean",
                description: "Whether user approval is required before execution",
                example: true,
              },
            },
            required: ["command"],
          },
        },
      },
      // JavaScript Executor Tool
      this.getJavaScriptExecutorTool(),
      // GitLab Tools
      {
        type: "function",
        function: {
          name: "gitlab_search",
          description: "Search through GitLab projects, issues, or merge requests",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query",
                example: "api feature",
              },
              scope: {
                type: "string",
                enum: ["projects", "issues", "merge_requests"],
                description: "What to search for",
                example: "issues",
              },
              project: {
                type: "string",
                description: "Optional project path (e.g., group/project)",
                example: "mygroup/myproject",
              },
            },
            required: ["query", "scope"],
          },
        },
      },
      // GitLab Merge Request Tools
      {
        type: "function",
        function: {
          name: "get_open_merge_requests",
          description: "Lists all open merge requests in the project",
          parameters: {
            type: "object",
            properties: {
              project: {
                type: "string",
                description: "The ID of the project",
                example: "4795",
              },
            },
            required: ["project"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_merge_request_details",
          description:
            "Get details about a specific merge request of a project like title, description, author, assignee, state, and more",
          parameters: {
            type: "object",
            properties: {
              project_id: {
                type: "string",
                description: "The ID or path of the project",
                example: "4795",
              },
              merge_request_iid: {
                type: "number",
                description: "The internal ID of the merge request",
                example: 123,
              },
              verbose: {
                type: "boolean",
                description: "Whether to include detailed information",
                default: true,
              },
            },
            required: ["project_id", "merge_request_iid"],
          },
        },
      },
      // {
      //   type: "function",
      //   function: {
      //     name: "get_merge_request_comments",
      //     description: "Get general and file diff comments of a certain merge request",
      //     parameters: {
      //       type: "object",
      //       properties: {
      //         project_id: {
      //           type: "string",
      //           description: "The ID or path of the project",
      //           example: "mygroup/myproject",
      //         },
      //         merge_request_iid: {
      //           type: "number",
      //           description: "The internal ID of the merge request",
      //           example: 123,
      //         },
      //         verbose: {
      //           type: "boolean",
      //           description: "Whether to include full raw discussion objects",
      //           default: false,
      //         },
      //       },
      //       required: ["project_id", "merge_request_iid"],
      //     },
      //   },
      // },
      // {
      //   type: "function",
      //   function: {
      //     name: "add_merge_request_diff_comment",
      //     description: "Add a comment of a merge request at a specific line in a file diff",
      //     parameters: {
      //       type: "object",
      //       properties: {
      //         project_id: {
      //           type: "string",
      //           description: "The ID or path of the project",
      //           example: "mygroup/myproject",
      //         },
      //         merge_request_iid: {
      //           type: "number",
      //           description: "The internal ID of the merge request",
      //           example: 123,
      //         },
      //         comment: {
      //           type: "string",
      //           description: "The content of the comment",
      //           example: "This variable name could be more descriptive",
      //         },
      //         file_path: {
      //           type: "string",
      //           description: "The path of the file to comment on",
      //           example: "src/utils/helpers.ts",
      //         },
      //         line_number: {
      //           type: "number",
      //           description: "The line number to comment on",
      //           example: 42,
      //         },
      //         base_sha: {
      //           type: "string",
      //           description: "The base SHA of the commit",
      //           example: "abc123def456",
      //         },
      //         start_sha: {
      //           type: "string",
      //           description: "The start SHA of the commit",
      //           example: "abc123def456",
      //         },
      //         head_sha: {
      //           type: "string",
      //           description: "The head SHA of the commit",
      //           example: "xyz789ghi012",
      //         },
      //       },
      //       required: ["project_id", "merge_request_iid", "comment", "file_path", "line_number"],
      //     },
      //   },
      // },
      // {
      //   type: "function",
      //   function: {
      //     name: "get_merge_request_comments",
      //     description: "Get general and file diff comments of a certain merge request",
      //     parameters: {
      //       type: "object",
      //       properties: {
      //         project_id: {
      //           type: "string",
      //           description: "The ID or path of the project",
      //           example: "mygroup/myproject",
      //         },
      //         merge_request_iid: {
      //           type: "number",
      //           description: "The internal ID of the merge request",
      //           example: 123,
      //         },
      //         verbose: {
      //           type: "boolean",
      //           description: "Whether to include full raw discussion objects",
      //           default: false,
      //         },
      //       },
      //       required: ["project_id", "merge_request_iid"],
      //     },
      //   },
      // },
      // {
      //   type: "function",
      //   function: {
      //     name: "add_merge_request_diff_comment",
      //     description: "Add a comment of a merge request at a specific line in a file diff",
      //     parameters: {
      //       type: "object",
      //       properties: {
      //         project_id: {
      //           type: "string",
      //           description: "The ID or path of the project",
      //           example: "mygroup/myproject",
      //         },
      //         merge_request_iid: {
      //           type: "number",
      //           description: "The internal ID of the merge request",
      //           example: 123,
      //         },
      //         comment: {
      //           type: "string",
      //           description: "The content of the comment",
      //           example: "This variable name could be more descriptive",
      //         },
      //         file_path: {
      //           type: "string",
      //           description: "The path of the file to comment on",
      //           example: "src/utils/helpers.ts",
      //         },
      //         line_number: {
      //           type: "number",
      //           description: "The line number to comment on",
      //           example: 42,
      //         },
      //         base_sha: {
      //           type: "string",
      //           description: "The base SHA of the commit",
      //           example: "abc123def456",
      //         },
      //         start_sha: {
      //           type: "string",
      //           description: "The start SHA of the commit",
      //           example: "abc123def456",
      //         },
      //         head_sha: {
      //           type: "string",
      //           description: "The head SHA of the commit",
      //           example: "xyz789ghi012",
      //         },
      //       },
      //       required: ["project_id", "merge_request_iid", "comment", "file_path", "line_number"],
      //     },
      //   },
      // },
      {
        type: "function",
        function: {
          name: "gitlab_create_issue",
          description: "Create a new GitLab issue",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Issue title",
                example: "Fix API endpoint for user profile",
              },
              description: {
                type: "string",
                description: "Issue description",
                example:
                  'The user profile API endpoint returns a 500 error when accessed with invalid token',
              },
              project: {
                type: "string",
                description: "Project path (e.g., group/project)",
                example: "mygroup/myproject",
              },
              labels: {
                type: "array",
                items: {
                  type: "string",
                },
                description: "Optional labels to apply",
                example: ["bug", "backend"],
              },
            },
            required: ["title", "description", "project"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "gitlab_create_mr_diff_comment",
          description: "Add a comment to a specific line in a GitLab merge request diff.",
          parameters: {
            type: "object",
            properties: {
              project: {
                type: "string",
                description: "Project path (e.g., group/project) or ID",
                example: "mygroup/myproject",
              },
              mr_iid: {
                type: "number",
                description: "Merge Request IID",
                example: 123,
              },
              comment_body: {
                type: "string",
                description: "The content of the comment",
                example: "This variable name could be more descriptive.",
              },
              file_path: {
                type: "string",
                description: "The path of the file being commented on (in the new version)",
                example: "src/utils/helpers.ts",
              },
              line_number: {
                type: "number",
                description: "The line number in the new version of the file to comment on",
                example: 42,
              },
              old_file_path: {
                type: "string",
                description: "Optional: The path of the file in the old version (if renamed/moved)",
                example: "src/old_helpers.ts",
              },
              old_line_number: {
                type: "number",
                description: "Optional: The line number in the old version of the file (for comments on deleted lines)",
                example: 40,
              },
            },
            required: ["project", "mr_iid", "comment_body", "file_path"],
          },
        },
      },
      // Jira Tools
      {
        type: "function",
        function: {
          name: "jira_list_projects",
          description: "List all Jira projects the user has access to",
          parameters: {
            type: "object",
            properties: {
              forceRefresh: {
                type: "boolean",
                description: "Force refresh the projects cache",
                default: false,
                example: false,
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira_list_issues",
          description: "List all issues in a Jira project",
          parameters: {
            type: "object",
            properties: {
              projectKey: {
                type: "string",
                description: "Jira project key",
                example: "MYPROJ",
              },
              maxResults: {
                type: "number",
                description: "Maximum number of results to return",
                default: 50,
                example: 50,
              },
            },
            required: ["projectKey"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira_get_issue",
          description: "Get details for a specific Jira issue",
          parameters: {
            type: "object",
            properties: {
              issueKey: {
                type: "string",
                description: "Jira issue key",
                example: "MYPROJ-123",
              },
            },
            required: ["issueKey"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira_get_recent_changes",
          description: "Get details of tickets that changed in the last N days",
          parameters: {
            type: "object",
            properties: {
              projectKey: {
                type: "string",
                description: "Jira project key",
                example: "MYPROJ",
              },
              days: {
                type: "number",
                description: "Number of days to look back",
                default: 7,
                example: 7,
              },
            },
            required: ["projectKey"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira_get_assigned_issues",
          description: "Get issues assigned to the current user",
          parameters: {
            type: "object",
            properties: {
              projectKey: {
                type: "string",
                description: "Optional Jira project key to filter by",
                example: "MYPROJ",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira_filter_issues_by_type",
          description: "Filter issues by type such as Bug or Change Request",
          parameters: {
            type: "object",
            properties: {
              projectKey: {
                type: "string",
                description: "Jira project key",
                example: "MYPROJ",
              },
              issueType: {
                type: "string",
                description: "Type of issue to filter by",
                example: "Bug",
              },
              maxResults: {
                type: "number",
                description: "Maximum number of results to return",
                default: 50,
                example: 50,
              },
            },
            required: ["projectKey", "issueType"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira_search",
          description: "Search for Jira issues using JQL",
          parameters: {
            type: "object",
            properties: {
              jql: {
                type: "string",
                description: "JQL query to search with",
                example: 'project = "MYPROJ" AND status = "In Progress"',
              },
            },
            required: ["jql"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira_create_issue",
          description: "Create a new Jira issue",
          parameters: {
            type: "object",
            properties: {
              project: {
                type: "string",
                description: "Jira project key",
                example: "MYPROJ",
              },
              issueType: {
                type: "string",
                description: "Type of issue",
                example: "Bug",
              },
              summary: {
                type: "string",
                description: "Issue summary",
                example: "API returns 500 error for user profile endpoint",
              },
              description: {
                type: "string",
                description: "Issue description",
                example:
                  'When accessing the /api/users/profile endpoint, the server returns a 500 error with message: "Internal server error"',
              },
              labels: {
                type: "array",
                items: {
                  type: "string",
                },
                description: "Optional labels to apply",
                example: ["backend", "critical"],
              },
            },
            required: ["project", "issueType", "summary", "description"],
          },
        },
      },
      // Confluence Tools
      {
        type: "function",
        function: {
          name: "confluence_search",
          description: "Search for content in Confluence",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query",
                example: "API documentation",
              },
              space: {
                type: "string",
                description: "Optional space key to search in",
                example: "TEAM",
              },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "confluence_create_page",
          description: "Create a new Confluence page",
          parameters: {
            type: "object",
            properties: {
              space: {
                type: "string",
                description: "Space key",
                example: "TEAM",
              },
              title: {
                type: "string",
                description: "Page title",
                example: "API Documentation",
              },
              content: {
                type: "string",
                description: "Page content in Confluence markup",
                example:
                  "h1. API Documentation\n\nThis page contains documentation for our REST API endpoints.",
              },
              parentId: {
                type: "string",
                description: "Optional parent page ID",
                example: "12345",
              },
            },
            required: ["space", "title", "content"],
          },
        },
      },
      // Datadog Tools
      {
        type: "function",
        function: {
          name: "datadog_search",
          description: "Search for metrics or logs in Datadog",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query",
                example: "service:api-backend error:500",
              },
              type: {
                type: "string",
                enum: ["metrics", "logs"],
                description: "What to search for",
                example: "logs",
              },
              timeRange: {
                type: "string",
                description: "Time range (e.g., '1h', '1d', '1w')",
                example: "24h",
              },
            },
            required: ["query", "type"],
          },
        },
      },
      // DORA Tools
      // {
      //     type: 'function',
      //     function: {
      //         name: 'dora_metrics',
      //         description: 'Get DORA metrics for a project',
      //         parameters: {
      //             type: 'object',
      //             properties: {
      //                 project: {
      //                     type: 'string',
      //                     description: 'Project path (e.g., group/project)',
      //                     example: 'mygroup/myproject',
      //                 },
      //                 timeRange: {
      //                     type: 'string',
      //                     enum: ['7d', '30d', '90d'],
      //                     description: 'Time range for metrics',
      //                     example: '30d',
      //                 },
      //             },
      //             required: ['project'],
      //         },
      //     },
      // },
    ];

    tools.forEach((tool) => {
      this.tools.set(tool.function.name, tool);
    });
  }

  /**
   * Execute an MCP tool by name
   */
  public async executeTool(
    toolNameOrTool: string | MCPTool,
    params: Record<string, unknown>,
    context: MCPToolContext,
  ): Promise<MCPToolResult> {
    try {
      // Determine the tool name
      const toolName =
        typeof toolNameOrTool === "string"
          ? toolNameOrTool
          : toolNameOrTool.name;
      // Find the tool by name in the switch statement
      switch (toolName) {
        case "file_read":
          return await this.executeFileRead(params);
        case "file_write":
          return await this.executeFileWrite(params);
        case "list_dir":
          return await this.executeListDir(params);
        case "init_task":
          return await this.initializeTaskEnvironment(params.taskName as string);
        case "write_task_file":
          return await this.writeTaskFile(params);
        case "read_task_file":
          return await this.readTaskFile(params);
        case "get_task_info":
          return await this.getTaskInfo(params.taskDir as string);
        case "terminal":
          return await this.executeTerminal(params);
        case "javascript_executor":
          return await this.executeJavaScriptExecutor(params, context);
        // GitLab Tools
        case "gitlab_search":
          return await this.executeGitLabSearch(params, context);
        case "get_open_merge_requests":
          return await this.executeListOpenMergeRequests(params, context);
        case "get_merge_request_details":
          return await this.executeGetMergeRequestDetails(params, context);
        case "get_merge_request_changes":
          return await this.executeGetMergeRequestChanges(params, context);
        //   return await this.executeGitLabCreateIssue(params, context);
        // case "gitlab_create_mr_diff_comment":
        //   return await this.executeGitLabCreateDiffComment(params, context);
        
        // case "get_merge_request_comments":
        //   return await this.executeGetMergeRequestComments(params, context);
        // case "add_merge_request_diff_comment":
        //   return await this.executeAddMergeRequestDiffComment(params, context);

        // case 'gitlab_create_merge_request':
        //     return await this.executeGitLabCreateMergeRequest(params, context);
        // Jira Tools
        // case 'jira_list_projects':
        //     return await this.executeJiraListProjects(params, context);
        // case 'jira_list_issues':
        //     return await this.executeJiraListIssues(params, context);
        // case 'jira_get_issue':
        //     return await this.executeJiraGetIssue(params, context);
        // case 'jira_get_recent_changes':
        //     return await this.executeJiraGetRecentChanges(params, context);
        // case 'jira_get_assigned_issues':
        //     return await this.executeJiraGetAssignedIssues(params, context);
        // case 'jira_filter_issues_by_type':
        //     return await this.executeJiraFilterIssuesByType(params, context);
        // case 'jira_search':
        //     return await this.executeJiraSearch(params, context);
        // case 'jira_create_issue':
        //     return await this.executeJiraCreateIssue(params, context);
        // // Confluence Tools
        // case 'confluence_search':
        //     return await this.executeConfluenceSearch(params, context);
        // case 'confluence_create_page':
        //     return await this.executeConfluenceCreatePage(params, context);
        // // Datadog Tools
        // case 'datadog_search':
        //     return await this.executeDatadogSearch(params, context);
        // // DORA Tools
        // case 'dora_metrics':
        //     return await this.executeDoraMetrics(params, context);
        default:
          return {
            success: false,
            error: `Tool ${toolName} implementation not found`,
          };
      }
    } catch (error) {
      this.logger.error(`Error executing tool:`, error);
      return {
        success: false,
        error: `Failed to execute tool: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async executeFileRead(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { file, start_line, end_line, encoding = "utf8" } = params;
    try {
      // Check if file exists and is readable
      try {
        await Deno.stat(file as string);
      } catch (_error) {
        return {
          success: false,
          error: `File does not exist or is not readable: ${file}`,
        };
      }

      const content = await Deno.readTextFile(file as string);
      const lines = content.split("\n");

      if (start_line !== undefined && end_line !== undefined) {
        const selectedLines = lines.slice(start_line as number, end_line as number);
        return {
          success: true,
          data: {
            content: selectedLines.join("\n"),
            metadata: {
              totalLines: lines.length,
              selectedRange: {
                start: start_line,
                end: end_line,
              },
            },
          },
        };
      }

      return {
        success: true,
        data: {
          content,
          metadata: {
            totalLines: lines.length,
            size: new TextEncoder().encode(content).length,
            encoding,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async executeFileWrite(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { file, content, encoding = "utf8", append = false } = params;

    if (!file || content === undefined) {
      return {
        success: false,
        error: "Both file path and content are required for write operation",
      };
    }

    try {
      // Ensure parent directory exists
      const parentDir = dirname(file as string);
      try {
        await Deno.mkdir(parentDir, { recursive: true });
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw error;
        }
      }

      // Write the file
      if (append) {
        await Deno.writeTextFile(file as string, content as string, { append: true });
      } else {
        await Deno.writeTextFile(file as string, content as string);
      }

      // Get file stats after writing
      const stats = await Deno.stat(file as string);

      return {
        success: true,
        data: {
          path: file,
          size: stats.size,
          modified: stats.mtime,
          created: stats.birthtime,
          encoding,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async writeTaskFile(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { taskDir, filename, content, encoding = "utf8" } = params;

    if (!taskDir || !filename || content === undefined) {
      return {
        success: false,
        error: "Task directory, filename, and content are required",
      };
    }

    try {
      const filePath = this.getTaskOutputPath(taskDir as string, filename as string);
      return await this.executeFileWrite({
        file: filePath,
        content,
        encoding,
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to write task file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async readTaskFile(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { taskDir, filename, encoding = "utf8" } = params;

    if (!taskDir || !filename) {
      return {
        success: false,
        error: "Task directory and filename are required",
      };
    }

    try {
      const filePath = this.getTaskOutputPath(taskDir as string, filename as string);
      return await this.executeFileRead({
        file: filePath,
        encoding,
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to read task file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async getTaskInfo(taskDir: string): Promise<MCPToolResult> {
    try {
      const infoPath = this.getTaskOutputPath(taskDir, "task-info.json");
      const result = await this.executeFileRead({
        file: infoPath,
      });

      if (!result.success || !result.data || typeof result.data !== "object") {
        return {
          success: false,
          error: "Invalid task info data",
        };
      }

      const data = result.data as { content: string };

      return {
        success: true,
        data: JSON.parse(data.content),
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get task info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async executeListDir(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { relative_workspace_path, include_stats = false } = params;
    try {
      const entries = [];
      for await (const entry of Deno.readDir(relative_workspace_path as string)) {
        if (!include_stats) {
          entries.push({
            name: entry.name,
            isDirectory: entry.isDirectory,
            isFile: entry.isFile,
            isSymlink: entry.isSymlink,
          });
          continue;
        }

        try {
          const fullPath = `${relative_workspace_path}/${entry.name}`;
          const stat = await Deno.stat(fullPath);
          entries.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory,
            isFile: entry.isFile,
            isSymlink: entry.isSymlink,
            size: stat.size,
            created: stat.birthtime,
            modified: stat.mtime,
            accessed: stat.atime,
          });
        } catch (statError: unknown) {
          // If we can't get stats for a particular entry, include it with basic info
          entries.push({
            name: entry.name,
            isDirectory: entry.isDirectory,
            isFile: entry.isFile,
            isSymlink: entry.isSymlink,
            error: `Failed to get stats: ${statError instanceof Error ? statError.message : String(statError)}`,
          });
        }
      }

      return {
        success: true,
        data: {
          entries,
          metadata: {
            path: relative_workspace_path,
            totalEntries: entries.length,
            includesStats: include_stats,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private executeCodebaseSearch(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { query } = params;
    // Implement actual codebase search logic here
    return Promise.resolve({
      success: true,
      data: [`Mock search results for query: ${query}`],
    });
  }

  private executeNotifyUser(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { text, attachments } = params;
    // ToDo: Here you would implement the actual notification mechanism
    // For now, we'll just log it
    this.logger.info(text as string);
    if (attachments) {
      this.logger.info("Attachments:", attachments);
    }
    return Promise.resolve({
      success: true,
      data: { notified: true },
    });
  }

  private executeAskUser(params: Record<string, unknown>): Promise<MCPToolResult> {
    const { text, suggest_user_takeover } = params;
    // Here you would implement the actual user interaction mechanism
    // For now, we'll just log it and return a mock response
    this.logger.info(`Question for user: ${text}`);
    if (suggest_user_takeover) {
      this.logger.info(`Suggested takeover: ${suggest_user_takeover}`);
    }
    return Promise.resolve({
      success: true,
      data: { asked: true, response: "Mock user response" },
    });
  }

  // GitLab Tool Implementations
  private async executeGitLabSearch(
    params: Record<string, unknown>,
    context: MCPToolContext,
  ): Promise<MCPToolResult> {
    try {
      const gitlabService = context.gitlab as GitLabServiceType;

      if (!gitlabService) {
        return {
          success: false,
          error: "GitLab service not available. Please configure GitLab settings.",
        };
      }

      const { query, scope, project } = params as {
        query: string;
        scope: "projects" | "issues" | "merge_requests";
        project?: string;
      };

      let results;
      switch (scope) {
        case "projects":
          results = await gitlabService.searchProjects(query);
          break;
        case "issues":
          if (project) {
            // Assuming getProjectIssues might also benefit from a search query parameter in the future
            // For now, it fetches all issues for the project if a query is also present.
            results = await gitlabService.getProjectIssues(project);
          } else {
            results = await gitlabService.searchIssues(query, "all"); // pass 'all' or a default timeframe
          }
          break;
        case "merge_requests":
          if (project) {
            const lowerQuery = query.toLowerCase();
            let determinedState: "opened" | "closed" | "merged" | "locked" | "all" = "opened"; // Default state
            let finalSearchQuery: string | undefined = query; // Default search query

            const stateMappings = [
              // Order matters: check for 'all' first if it should override specific states in some phrasings
              { key: "all", words: ["all", "alle", "any", "jede", "every", "sämtliche"] },
              { key: "opened", words: ["open", "opened", "offen", "offene"] },
              { key: "merged", words: ["merged", "gemerged", "integriert"] },
              { key: "closed", words: ["closed", "geschlossen", "erledigt"] },
            ];

            let stateKeywordFound = false;
            for (const mapping of stateMappings) {
              if (mapping.words.some((kw) => lowerQuery.includes(kw))) {
                determinedState = mapping.key as typeof determinedState;
                stateKeywordFound = true;

                let cleanedQuery = lowerQuery;
                mapping.words.forEach((kw) => {
                  cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${kw}\\b`, "ig"), "");
                });

                cleanedQuery = cleanedQuery
                  .replace(
                    /merge requests?|mrs?|pull requests?|list|show|zeige|gibt es|sind da|are there|for the project|in the project|in project/ig,
                    ""
                  )
                  .trim();
                if (project) {
                  cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${project.toLowerCase()}\\b`, "ig"), "").trim();
                }
                cleanedQuery = cleanedQuery.replace(/[?¿!.,]/g, "").trim();

                if (cleanedQuery.length < 4) {
                  finalSearchQuery = undefined;
                } else {
                  finalSearchQuery = cleanedQuery;
                }
                // Break after the first relevant keyword set is processed
                break;
              }
            }

            if (!stateKeywordFound) {
              // No explicit state keyword found. This implies a general text search.
              // Default to searching in 'all' states with the cleaned query.
              determinedState = "all";
              let cleanedForGeneralSearch = lowerQuery;
              cleanedForGeneralSearch = cleanedForGeneralSearch
                .replace(
                  /merge requests?|mrs?|pull requests?|list|show|zeige|gibt es|sind da|are there|for the project|in the project|in project/ig,
                  ""
                )
                .trim();
              if (project) {
                cleanedForGeneralSearch = cleanedForGeneralSearch.replace(new RegExp(`\\b${project.toLowerCase()}\\b`, "ig"), "").trim();
              }
              cleanedForGeneralSearch = cleanedForGeneralSearch.replace(/[?¿!.,]/g, "").trim();

              finalSearchQuery = cleanedForGeneralSearch.length > 0 ? cleanedForGeneralSearch : undefined;
              // Fallback if cleaning removed everything from a non-empty query
              if (finalSearchQuery === undefined && query.trim().length > 0) {
                finalSearchQuery = query;
              }
            }

            this.logger.debug(
              `GitLab MR Search: Project='${project}', State='${determinedState}', SearchQueryForAPI='${finalSearchQuery}' (OriginalQuery='${query}')`
            );

            // First, search for the project to get the correct ID or path with namespace
            this.logger.debug(`Searching for project with query: "${project}"`);
            const projects = await gitlabService.searchProjects(project) as ProjectSchema[]; // Added type assertion

            if (!projects || projects.length === 0) {
              return {
                success: false,
                error: `Project "${project}" not found. Please verify the project name or ID.`,
              };
            }

            // Use the first matching project's path_with_namespace
            const projectPath = projects[0].path_with_namespace;
            this.logger.debug(`Found project: ${projectPath} (ID: ${projects[0].id})`);

            // Now use the correct project path to fetch merge requests
            results = await gitlabService.getProjectMergeRequests(projectPath, 100, determinedState, finalSearchQuery);
          } else {
            results = await gitlabService.searchMergeRequests(query);
          }
          break;
        default: // Should not happen due to enum in tool definition
          return { success: false, error: `Invalid GitLab search scope: ${scope}` };
      }

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      this.logger.error("GitLab search failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeGitLabCreateIssue(
    params: Record<string, unknown>,
    context: MCPToolContext,
  ): Promise<MCPToolResult> {
    try {
      // Use existing GitLab service if available in context
      const gitlabService = context.gitlab as GitLabServiceType;

      if (!gitlabService) {
        return {
          success: false,
          error: "GitLab service not available. Please configure GitLab settings.",
        };
      }

      const { title, description, project, labels } = params as {
        title: string;
        description: string;
        project: string;
        labels?: string[];
      };

      const issue = await gitlabService.createIssue(project, {
        title,
        description,
        labels: labels?.join(","),
      });

      return {
        success: true,
        data: issue,
      };
    } catch (error) {
      this.logger.error("Failed to create GitLab issue:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

//   private async executeGitLabCreateDiffComment(
//     params: Record<string, unknown>,
//     context: MCPToolContext,
//   ): Promise<MCPToolResult> {
//     try {
//         const gitlabService = context.gitlab as GitLabServiceType;
//         if (!gitlabService) {
//             return { success: false, error: "GitLab service not available." };
//         }


//         const {
//             project,
//             mr_iid,
//             comment_body,
//             file_path,
//             line_number,
//             old_file_path,
//             old_line_number,
//         } = params as {
//             project: string | number;
//             mr_iid: number;
//             comment_body: string;
//             file_path: string;
//             line_number?: number;
//             old_file_path?: string;
//             old_line_number?: number;
//         };

//         // First, search for the project to get the correct path with namespace if a string identifier is provided
//         let projectPath = project;
//         if (typeof project === 'string' && !project.includes('/')) {
//           this.logger.debug(`Project identifier "${project}" doesn't contain namespace, attempting to find full path`);
//           const projects = await gitlabService.searchProjects(project);
//           if (projects && projects.length > 0) {
//               projectPath = projects[0].path_with_namespace;
//               this.logger.debug(`Found full project path: ${projectPath}`);
//           } else {
//               throw new Error(`Project "${project}" not found. Please provide full path with namespace (e.g., "group/project").`);
//           }
//         }

//         // Essential check: Ensure at least one line number is provided
//         if (line_number === undefined && old_line_number === undefined) {
//             return { success: false, error: "Either line_number or old_line_number must be provided." };
//         }


//         try {
//           //   const mrDetails = await gitlabService.getMergeRequests(projectPath, 'opened');
//           //   if (!mrDetails || !(mrDetails as { diff_refs?: unknown }).diff_refs) {
//           //       return { success: false, error: "Could not retrieve merge request details or diff_refs for SHAs." };
//           //   }
//           //   let diffRefs: { base_sha: string; head_sha: string; start_sha: string };
//           //   diffRefs = (mrDetails as { diff_refs: { base_sha: string; head_sha: string; start_sha: string } }).diff_refs;
//           //   const discussion = await gitlabService.createMergeRequestDiffComment(
//           //     project as string,
//           //     mr_iid,
//           //     comment_body,
//           //     {
//           //         position: {
//           //             baseSha: diffRefs.base_sha,
//           //             startSha: diffRefs.start_sha,
//           //             headSha: diffRefs.head_sha,
//           //             oldPath: old_file_path || file_path,
//           //             newPath: file_path,
//           //             positionType: 'text',
//           //             new_line: line_number || 1
//           //         }
//           //     }
//           // );
//           return { success: true, data: discussion };
//         } catch (fetchError) {
//             this.logger.error("Failed to fetch MR details for diff comment:", fetchError);
//             return { success: false, error: `Failed to fetch MR details: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}` };
//         }
        
//     } catch (error) {
//         this.logger.error("Failed to create GitLab diff comment:", error);
//         return { success: false, error: error instanceof Error ? error.message : String(error) };
//     }
// }

  /**
   * Implementation of the list_open_merge_requests tool
   */
  private async executeListOpenMergeRequests(
    params: Record<string, unknown>,
    context: MCPToolContext,
  ): Promise<MCPToolResult> {
    try {
      const gitlabService = context.gitlab as GitLabServiceType;
      if (!gitlabService) {
        return { success: false, error: "GitLab service not available." };
      }

      const { project } = params as { project: string };

      const mergeRequests = await gitlabService.getMergeRequests(Number(project), undefined, 'opened');

      // Falls immer noch keine MRs gefunden wurden
      if (!mergeRequests) {
        return {
          success: false,
          error: `Could not retrieve merge requests for project "${project}".`,
        };
      }

      this.logger.debug("list of found open merge requests:", mergeRequests);

      return {
        success: true,
        data: mergeRequests,
      };
    } catch (error) {
      this.logger.error("Failed to list open merge requests:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Implementation of the get_merge_request_details tool
   */
  private async executeGetMergeRequestDetails(
    params: Record<string, unknown>,
    context: MCPToolContext,
  ): Promise<MCPToolResult> {
    try {
      const gitlabService = context.gitlab as GitLabServiceType;
      if (!gitlabService) {
        return { success: false, error: "GitLab service not available." };
      }

      const { project_id, merge_request_iid, verbose = false } = params as {
        project_id: string;
        merge_request_iid: number;
        verbose?: boolean;
      };

      let mrDetails;
      let discussions;
      try {
        [mrDetails, discussions] = await Promise.all([
          gitlabService.getMergeRequestDetails(project_id, merge_request_iid),
          gitlabService.getMergeRequestDiscussions(project_id, merge_request_iid),
        ]) as [GitLabMergeRequest, GitLabDiscussion];
      } catch (error) {
        this.logger.error("Failed to get merge request details:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
        
        // Wenn mrDetails ein Array ist, nimm das erste Element:
      const mr = Array.isArray(mrDetails) ? mrDetails[0] : mrDetails;

      // Kategorisiere die Discussions
      const unresolvedNotes = Array.isArray(discussions) 
        ? discussions.flatMap((discussion: GitLabDiscussion) => discussion.notes?.nodes?.filter((note: any) => !note.system) || [])
        : (discussions?.notes?.nodes?.filter((note: any) => !note.system) || []);
      const discussionNotes = unresolvedNotes.filter((note: any) => note?.type === 'DiscussionNote').map((note: any) => ({
        id: note?.id,
        noteable_id: note?.noteable_id,
        body: note?.body,
        author_name: note?.author?.name,
      }));
      const diffNotes = unresolvedNotes.filter((note: any) => note?.type === 'DiffNote').map((note: any) => ({
        id: note?.id,
        noteable_id: note?.noteable_id,
        body: note?.body,
        author_name: note?.author?.name,
        position: note?.position,
      }));

      const result = verbose ? {
        ...mr,
        changes: mr.changes,
        diffStats: mr.diffStats,
        diffRefs: mr.diffRefs,
        unresolvedNotes,
        discussionNotes,
        diffNotes
      } : {
        iid: mr.iid,
        project_id: project_id,
        title: mr.title,
        description: mr.description,
        state: mr.state,
        web_url: mr.web_url,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        create_at: mr.created_at,
        updated_at: mr.updated_at,
        author: mr.author ? {
          name: mr.author.name,
          username: mr.author.username,
        } : null,
        assignees: mr.assignees?.nodes?.map((a: { name: string; username: string }) => ({ name: a.name, username: a.username })),
        reviewers: mr.reviewers?.nodes?.map((r: { name: string; username: string }) => ({ name: r.name, username: r.username })),
        approved: mr.approved,
        labels: mr.labels?.nodes?.map((l: { title: string }) => l.title),
        changes: mr.changes.map((change: { id: string; title: string; new_file: boolean; renamed_file: boolean; deleted_file: boolean; file_path: string; line_count: number }) => ({
          id: change.id,
          title: change.title,
          new_file: change.new_file,
          renamed_file: change.renamed_file,
          deleted_file: change.deleted_file,
          file_path: change.file_path,
          line_count: change.line_count
        })),
        diffStats: mr.diffStats,
        diffRefs: mr.diffRefs,
        discussionNotes,
        diffNotes
      };

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error("Failed to get merge request details:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeGetMergeRequestChanges(params: Record<string, unknown>, context: MCPToolContext): Promise<MCPToolResult> {
    try {
      const gitlabService = context.gitlab as GitLabServiceType;
      if (!gitlabService) {
        return { success: false, error: "GitLab service not available." };
      }
      const { project_id, merge_request_iid } = params as {
        project_id: string;
        merge_request_iid: number;
      };

      const mergeRequestDiffs = await gitlabService.getMergeRequestDiffs(project_id, merge_request_iid);

      return {
        success: true,
        data: mergeRequestDiffs,
      };
    } catch (error) {
      this.logger.error("Failed to get merge request diffs:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Implementation of the add_merge_request_diff_comment tool
   */
  // private async executeAddMergeRequestDiffComment(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     const gitlabService = context.gitlab as GitLabServiceType;
  //     if (!gitlabService) {
  //       return { success: false, error: "GitLab service not available." };
  //     }

  //     const {
  //       project_id,
  //       merge_request_iid,
  //       comment,
  //       file_path,
  //       line_number,
  //       base_sha,
  //       start_sha,
  //       head_sha,
  //     } = params as {
  //       project_id: string;
  //       merge_request_iid: number;
  //       comment: string;
  //       file_path: string;
  //       line_number: number;
  //       base_sha?: string;
  //       start_sha?: string;
  //       head_sha?: string;
  //     };

  //     // First, search for the project to get the correct ID or path with namespace
  //     this.logger.debug(`Searching for project with query: "${project_id}"`);
  //     const projects = await gitlabService.searchProjects(project_id) as any[];

  //     if (!projects || projects.length === 0) {
  //       return {
  //         success: false,
  //         error: `Project "${project_id}" not found. Please verify the project name or ID.`,
  //       };
  //     }

  //     // Use the first matching project's path_with_namespace
  //     const projectPath = projects[0].path_with_namespace;
  //     this.logger.debug(`Found project: ${projectPath} (ID: ${projects[0].id})`);

  //     // If SHAs are not provided, we need to fetch them from the MR
  //     let baseSha = base_sha;
  //     let startSha = start_sha;
  //     let headSha = head_sha;

  //     if (!baseSha || !startSha || !headSha) {
  //       try {
  //         // Get merge request details to extract diffs using the correct project path
  //         const mr = await gitlabService.getMergeRequest(projectPath, merge_request_iid);

  //         // Import the GitLabMergeRequest type from the project's type definitions
  //         type GitLabMergeRequest = {
  //           diff_refs?: {
  //             base_sha: string;
  //             start_sha: string;
  //             head_sha: string;
  //           };
  //           // Other properties might exist but we only need diff_refs
  //         };

  //         // Cast to the type we expect
  //         const typedMR = mr as GitLabMergeRequest;

  //         if (typedMR.diff_refs) {
  //           baseSha = baseSha || typedMR.diff_refs.base_sha;
  //           startSha = startSha || typedMR.diff_refs.start_sha;
  //           headSha = headSha || typedMR.diff_refs.head_sha;
  //         } else {
  //           return {
  //             success: false,
  //             error: "Could not retrieve diff_refs from merge request. Please provide base_sha, start_sha, and head_sha parameters.",
  //           };
  //         }
  //       } catch (error) {
  //         return {
  //           success: false,
  //           error: `Failed to fetch merge request diff refs: ${error instanceof Error ? error.message : String(error)}`,
  //         };
  //       }
  //     }
  //     this.logger.debug('CALLING CREATE MERGE REQUEST DIFF COMMENT METHOD!!!!');
  //     // Create the comment using GitLabService and the correct project path
  //     const result = await gitlabService.createMergeRequestDiffComment(
  //       projectPath,
  //       merge_request_iid,
  //       comment,
  //       {
  //           position: {
  //               baseSha: baseSha,
  //               startSha: startSha,
  //               headSha: headSha,
  //               oldPath: file_path,
  //               newPath: file_path,
  //               positionType: 'text',
  //               new_line: line_number
  //           }
  //       }
  //     );

  //     return {
  //       success: true,
  //       data: result,
  //     };
  //   } catch (error) {
  //     this.logger.error("Failed to add merge request diff comment:", error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error),
  //     };
  //   }
  // }

  // ToDo: Jira Tool Implementations
  // private async executeJiraSearch(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Jira service if available in context
  //     const jiraService = context.jira as JiraServiceType;

  //     if (!jiraService) {
  //       return {
  //         success: false,
  //         error: 'Jira service not available. Please configure Jira settings.'
  //       };
  //     }

  //     const { jql } = params as { jql: string };
  //     const results = await jiraService.searchIssues(jql);
  //     return {
  //       success: true,
  //       data: results
  //     };
  //   } catch (error) {
  //     this.logger.error('Jira search failed:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }

  // private async executeJiraCreateIssue(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Jira service if available in context
  //     const jiraService = context.jira as JiraServiceType;

  //     if (!jiraService) {
  //       return {
  //         success: false,
  //         error: 'Jira service not available. Please configure Jira settings.'
  //       };
  //     }

  //     const { project, summary, description, issueType, labels } = params as {
  //       project: string;
  //       summary: string;
  //       description: string;
  //       issueType: string;
  //       labels?: string[];
  //     };

  //     const issue = await jiraService.createIssue({
  //       fields: {
  //         project: { key: project },
  //         summary,
  //         description,
  //         issuetype: { name: issueType },
  //         labels
  //       }
  //     });

  //     return {
  //       success: true,
  //       data: issue
  //     };
  //   } catch (error) {
  //     this.logger.error('Failed to create Jira issue:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }
  
  // /**
  //  * List all Jira projects the user has access to
  //  */
  // private async executeJiraListProjects(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Jira service if available in context
  //     const jiraService = context.jira as JiraServiceType;

  //     if (!jiraService) {
  //       return {
  //         success: false,
  //         error: 'Jira service not available. Please configure Jira settings.'
  //       };
  //     }

  //     const { forceRefresh = false } = params as { forceRefresh?: boolean };
    
  //     // Type guard to handle the 'getProjects' method that's not in the interface
  //     if (typeof jiraService.getProjects !== 'function') {
  //       return {
  //         success: false,
  //         error: 'Jira service does not implement getProjects method'
  //       };
  //     }
    
  //     const projects = await jiraService.getProjects(forceRefresh);
    
  //     return {
  //       success: true,
  //       data: projects
  //     };
  //   } catch (error) {
  //     this.logger.error('Failed to list Jira projects:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }

  // /**
  //  * List all issues in a Jira project
  //  */
  // private async executeJiraListIssues(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Jira service if available in context
  //     const jiraService = context.jira as JiraServiceType;

  //     if (!jiraService) {
  //       return {
  //         success: false,
  //         error: 'Jira service not available. Please configure Jira settings.'
  //       };
  //     }

  //     const { projectKey, maxResults = 50 } = params as { 
  //       projectKey: string;
  //       maxResults?: number;
  //     };
    
  //     if (!projectKey) {
  //       return {
  //         success: false,
  //         error: 'Project key is required'
  //       };
  //     }

  //     const jql = `project = "${projectKey}" ORDER BY updated DESC`;
  //     // Remove the second parameter since the interface only expects one parameter
  //     const issues = await jiraService.searchIssues(jql);
    
  //     return {
  //       success: true,
  //       data: issues
  //     };
  //   } catch (error) {
  //     this.logger.error('Failed to list Jira issues:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }

  // /**
  //  * Get details for a specific Jira issue
  //  */
  // private async executeJiraGetIssue(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Jira service if available in context
  //     const jiraService = context.jira as JiraServiceType;

  //     if (!jiraService) {
  //       return {
  //         success: false,
  //         error: 'Jira service not available. Please configure Jira settings.'
  //       };
  //     }

  //     const { issueKey } = params as { issueKey: string };
    
  //     if (!issueKey) {
  //       return {
  //         success: false,
  //         error: 'Issue key is required'
  //       };
  //     }

  //     // Type guard to handle the 'getIssue' method that's not in the interface
  //     if (typeof jiraService.getIssue !== 'function') {
  //       return {
  //         success: false,
  //         error: 'Jira service does not implement getIssue method'
  //       };
  //     }
    
  //     const issue = await jiraService.getIssue(issueKey);
    
  //     return {
  //       success: true,
  //       data: issue
  //     };
  //   } catch (error) {
  //     this.logger.error('Failed to get Jira issue:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }

  // /**
  //  * Get details of tickets that changed in the last N days
  //  */
  // private async executeJiraGetRecentChanges(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Jira service if available in context
  //     const jiraService = context.jira as JiraServiceType;

  //     if (!jiraService) {
  //       return {
  //         success: false,
  //         error: 'Jira service not available. Please configure Jira settings.'
  //       };
  //     }

  //     const { projectKey, days = 7 } = params as { 
  //       projectKey: string;
  //       days?: number;
  //     };
    
  //     if (!projectKey) {
  //       return {
  //         success: false,
  //         error: 'Project key is required'
  //       };
  //     }

  //     const jql = `project = "${projectKey}" AND updated >= -${days}d ORDER BY updated DESC`;
  //     const issues = await jiraService.searchIssues(jql);
    
  //     return {
  //       success: true,
  //       data: issues
  //     };
  //   } catch (error) {
  //     this.logger.error('Failed to get recent Jira changes:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }

/**
 * Get issues assigned to the current user
 */
// private async executeJiraGetAssignedIssues(
//   params: Record<string, unknown>,
//   context: MCPToolContext,
// ): Promise<MCPToolResult> {
//   try {
//     // Use existing Jira service if available in context
//     const jiraService = context.jira as JiraServiceType;

    // if (!jiraService) {
    //   return {
    //     success: false,
    //     error: 'Jira service not available. Please configure Jira settings.'
    //   };
    // }

//     const { projectKey } = params as { projectKey?: string };

//     let jql = "assignee = currentUser() ORDER BY updated DESC";
//     if (projectKey) {
//       jql = `assignee = currentUser() AND project = "${projectKey}" ORDER BY updated DESC`;
//     }

//     const issues = await jiraService.searchIssues(jql);

//     return {
//       success: true,
//       data: issues,
//     };
//   } catch (error) {
//     this.logger.error("Failed to get assigned Jira issues:", error);
//     return {
//       success: false,
//       error: error instanceof Error ? error.message : String(error),
//     };
//   }
// }

/**
 * Filter issues by type such as Bug or Change Request
 */
// private async executeJiraFilterIssuesByType(
//   params: Record<string, unknown>,
//   context: MCPToolContext,
// ): Promise<MCPToolResult> {
//   try {
//     // Use existing Jira service if available in context
//     const jiraService = context.jira as JiraServiceType;

    // if (!jiraService) {
    //   return {
    //     success: false,
    //     error: 'Jira service not available. Please configure Jira settings.'
    //   };
    // }

//     const { projectKey, issueType, maxResults = 50 } = params as {
//       projectKey: string;
//       issueType: string;
//       maxResults?: number;
//     };

//     if (!projectKey || !issueType) {
//       return {
//         success: false,
//         error: "Project key and issue type are required",
//       };
//     }

//     const jql = `project = "${projectKey}" AND issuetype = "${issueType}" ORDER BY updated DESC`;
//     // Remove the second parameter since the interface only expects one parameter
//     const issues = await jiraService.searchIssues(jql);

//     return {
//       success: true,
//       data: issues,
//     };
//   } catch (error) {
//     this.logger.error("Failed to filter Jira issues by type:", error);
//     return {
//       success: false,
//       error: error instanceof Error ? error.message : String(error),
//     };
//   }
// }

// ToDo: Confluence Tool Implementations
// private async executeConfluenceSearch(
//   params: Record<string, unknown>,
//   context: MCPToolContext,
// ): Promise<MCPToolResult> {
//   try {
//     // Use existing Confluence service if available in context
//     const confluenceService = context.confluence as ConfluenceServiceType;

//     if (!confluenceService) {
//       return {
//         success: false,
//         error: 'Confluence service not available. Please configure Confluence settings.'
  //       };
  //     }

  //         let { query, space } = params as {
  //       query: string;
  //       space?: string;
  //     };

  //     // If no query provided, use a default search
  //     if (!query || query.trim().length === 0) {
  //       query = "*";
  //       this.logger.info("No search query provided, using default search (*) to find recent pages");
  //     }

  //     this.logger.debug("Executing Confluence search with query:", query, space ? `in space: ${space}` : "across all spaces");

  //     const results = await confluenceService.advancedSearch({
  //       query,
  //       spaceKey: space,
  //       limit: 10,
  //     });

  //     // Add a message if no results found
  //     if (!results?.results || results.results.length === 0) {
  //       return {
  //         success: true,
  //         data: {
  //           ...results,
  //           message: `No Confluence pages found${space ? ` in space '${space}'` : ""} matching query: '${query}'`,
  //         },
  //       };
  //     }

  //     return {
  //       success: true,
  //       data: results,
  //     };
  //   } catch (error) {
  //     this.logger.error("Confluence search failed:", error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error),
  //     };
  //   }
  // }

  // private async executeConfluenceCreatePage(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Confluence service if available in context
  //     const confluenceService = context.confluence as ConfluenceServiceType;

  //     if (!confluenceService) {
  //       return {
  //         success: false,
  //         error: 'Confluence service not available. Please configure Confluence settings.'
  //       };
  //     }

  //     const { space, title, content, parentId } = params as {
  //       space: string;
  //       title: string;
  //       content: string;
  //       parentId?: string;
  //     };

  //     const page = await confluenceService.createPage({
  //       space,
  //       title,
  //       content,
  //       parentId
  //     });

  //     return {
  //       success: true,
  //       data: page
  //     };
  //   } catch (error) {
  //     this.logger.error('Failed to create Confluence page:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }

  // ToDo: Datadog Tool Implementation
  // private async executeDatadogSearch(
  //   params: Record<string, unknown>,
  //   context: MCPToolContext,
  // ): Promise<MCPToolResult> {
  //   try {
  //     // Use existing Datadog service if available in context
  //     const datadogService = context.datadog as DatadogServiceType;

  //     if (!datadogService) {
  //       return {
  //         success: false,
  //         error: 'Datadog service not available. Please configure Datadog settings.'
  //       };
  //     }

  //     const { query, type, timeRange } = params as {
  //       query: string;
  //       type: 'metrics' | 'logs';
  //       timeRange?: string;
  //     };

  //     const results = type === 'metrics' 
  //       ? await datadogService.searchMetrics(query, timeRange)
  //       : await datadogService.searchLogs(query, timeRange);

  //     return {
  //       success: true,
  //       data: results
  //     };
  //   } catch (error) {
  //     this.logger.error('Datadog search failed:', error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : String(error)
  //     };
  //   }
  // }

private async executeTerminal(params: Record<string, unknown>): Promise<MCPToolResult> {
  const { command, workingDir, timeout, require_user_approval } = params;

  try {
    // Handle user approval if required
    if (require_user_approval) {
      this.logger.info(`Command requires user approval: ${command}`);
    }

    // Get the default shell
    const shell = Deno.env.get("SHELL") || "/bin/bash";

    // Create the command options
    const isWindows = Deno.build.os === "windows";
    const cmd = new Deno.Command(shell, {
      args: [isWindows ? "/c" : "-c", command as string],
      cwd: workingDir as string || Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    });

    // Execute with timeout if specified
    const timeoutValue = timeout as number || 30000;
    const timeoutPromise = new Promise<MCPToolResult>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          error: "Command execution timed out",
        });
      }, timeoutValue);
    });

    // Execute the command
    const execPromise = cmd.output().then((output) => {
      const decoder = new TextDecoder();
      const stdout = decoder.decode(output.stdout);
      const stderr = decoder.decode(output.stderr);

      return {
        success: output.code === 0,
        data: {
          commandOutput: stdout,
          commandExitCode: output.code,
          error: stderr.length > 0 ? stderr : undefined,
        },
      } as MCPToolResult;
    });

    // Race the execution against the timeout
    const result = await Promise.race([execPromise, timeoutPromise]);

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to execute terminal command: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

private async executeJavaScriptExecutor(
  params: Record<string, unknown>,
  context: MCPToolContext,
): Promise<MCPToolResult> {
  try {
    // Use existing AI service if available in context
    // Look for the llmProvider property in the ai context, with fallback to undefined
    let aiService: LLMProvider | undefined;

    if (context.ai && typeof context.ai === "object" && "llmProvider" in context.ai) {
      aiService = context.ai.llmProvider as LLMProvider;
    }

    // If no AI service in context, try to create one from config
    if (!aiService && context.config) {
      const config = context.config as Record<string, unknown>;
      const aiConfig = config.ai as Record<string, unknown> | undefined;

      if (aiConfig) {
        try {
          aiService = new AIService(config as Config).getLLMProvider();
        } catch (e) {
          this.logger.warn("Failed to create AI service:", e);
        }
      }
    }

    const {
      description,
      code,
      context: executionContext = {},
    } = params as {
      description: string;
      code?: string;
      context?: Record<string, unknown>;
    };

    // If code is provided, execute it directly without AI generation
    if (code) {
      try {
        this.logger.debug("Executing JavaScript code");

        // Create a safer Function execution context with provided context variables
        const contextKeys = Object.keys(executionContext);
        const contextValues = Object.values(executionContext);

        // Create a function with context variables as parameters
        // eslint-disable-next-line no-new-func
        const evalFn = new Function(
          ...contextKeys,
          `
          try {
            ${code}
            return { success: true, result: (typeof result !== 'undefined') ? result : undefined };
          } catch (error) {
            return { 
              success: false, 
              error: error.message || 'Unknown error',
              stack: error.stack || ''
            };
          }
          `
        );

        // Execute the function with context values
        const result = evalFn(...contextValues);

        if (result && typeof result === "object" && "success" in result) {
          if (!result.success) {
            return {
              success: false,
              error: result.error || "JavaScript execution failed",
              data: {
                code,
                stack: result.stack || "",
              },
            };
          }

          return {
            success: true,
            data: {
              result: result.result,
              code,
            },
          };
        }

        // Handle unexpected results
        return {
          success: true,
          data: {
            result,
            code,
          },
        };
      } catch (error: unknown) {
        this.logger.error("JavaScript execution failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          data: { code },
        };
      }
    }

    // If no code provided but AI service is unavailable, return an error
    if (!aiService) {
      return {
        success: false,
        error: "AI service not available. Please provide code directly or configure AI settings.",
      };
    }

    // Use AI to generate code based on the description
    this.logger.debug("Generating JavaScript code from description");
    const generatedCode = await aiService.generateObject<CodeResponse>(
      `Generate JavaScript code to: ${description}

      Important instructions:
      1. Do NOT use standalone return statements outside of functions
      2. Assign your final result to a variable named 'result'
      3. Make sure your code handles errors gracefully

      For example: 
      // GOOD
      function factorial(n) { 
        return n <= 1 ? 1 : n * factorial(n-1); 
      }
      const result = factorial(5);
      
      // ALSO GOOD
      const numbers = [1, 2, 3, 4, 5];
      const result = numbers.reduce((a, b) => a + b, 0);
      `,
      {
        type: "object",
        properties: {
          code: { type: "string" },
        },
        required: ["code"],
      }
    );

    // Execute the generated code
    return this.executeJavaScriptExecutor(
      {
        ...params,
        code: generatedCode.code,
      },
      context
    );
  } catch (error: unknown) {
    this.logger.error("JavaScript execution failed:", error);
  }
  // Add this line to ensure a return value in all cases
  return {
    success: false,
    error: "Unknown error in executeJavaScriptExecutor",
  };
}

/**
 * Get tools based on context
 * @param context The context to filter tools for ('ide' or 'cli')
 * @returns Filtered array of tool functions
 */
public getToolsForContext(context: "ide" | "cli"): MCPToolFunction[] {
  const allTools = Array.from(this.tools.values());

  if (context === "ide") {
    // Exclude file operation tools in IDE context
    return allTools.filter((tool) => !MCPService.IDE_EXCLUDED_TOOLS.has(tool.function.name));
  }

  // Return all tools for CLI context
  return allTools;
}

public getTools(): MCPToolFunction[] {
  return Array.from(this.tools.values());
}

/**
 * Returns a specific MCP tool function by name
 */
getToolByName(name: string): MCPToolFunction | undefined {
  return Array.from(this.tools.values()).find((tool) => tool.function.name === name);
}

private async initializeTaskEnvironment(taskName: string): Promise<MCPToolResult> {
  try {
    const resultsDir = "results";

    // Ensure results directory exists
    try {
      await Deno.mkdir(resultsDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }

    // Generate unique task ID
    const taskId = crypto.randomUUID();
    const taskDir = `${resultsDir}/task-${taskId}`;

    // Create task directory
    await Deno.mkdir(taskDir, { recursive: true });

    // Create task metadata
    const metadata = {
      taskName,
      created: new Date().toISOString(),
      id: taskId,
    };

    await Deno.writeTextFile(
      `${taskDir}/task-info.json`,
      JSON.stringify(metadata, null, 2)
    );

    return {
      success: true,
      data: {
        taskDir,
        taskId,
        metadata,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to initialize task environment: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

private getTaskOutputPath(taskDir: string, filename: string): string {
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  return `${taskDir}${separator}${filename}`;
}

public async startServer(options: { stdio: boolean; sse: boolean; port: number; endpoint: string }) {
  const { stdio, sse, port, endpoint } = options;
  const logger = this.logger;
  const server = new McpServer({
    name: "nova-mcp",
    version: "0.1.0",
    debug: Deno.env.get("NOVA_DEBUG") === "true",
  });

  // Use any[] instead of Server[] to avoid type conflicts
  // deno-lint-ignore no-explicit-any
  const activeServers: any[] = [];

  if (stdio) {
    try {
      const stdioTransport = new StdioServerTransport();
      logger.info("Created StdioServerTransport");

      // Hack: Add a small delay before connecting to ensure stdio is ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      logger.info("Connecting MCP server to stdio transport...");

      // Connect stdio transport in background
      server.connect(stdioTransport).catch((transportError) => {
        logger.error("Error connecting to stdio transport:", transportError);
      });

      activeServers.push(server);
      logger.info("Stdio transport connected");
    } catch (error) {
      logger.error("Failed to start stdio transport:", error);
    }
  }

  // Start SSE transport if enabled
  if (sse) {
    try {
      logger.info(`Starting SSE server on port ${port} with endpoint ${endpoint}`);

      const _activeTransports: Record<string, SSEServerTransportType> = {};

      const sseServer = new Server(async (_req: unknown, _res: unknown) => {
        // Implementation of SSE server connection logic
      });

      // Add SSE server to active servers
      activeServers.push(sseServer);
      logger.info("SSE server started");
    } catch (error) {
      logger.error("Failed to start SSE server:", error);
    }
  }

  return activeServers;
}
}
