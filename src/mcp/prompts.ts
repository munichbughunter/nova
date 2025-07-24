/**
 * MCP Prompts
 * 
 * This file defines the prompts available in the MCP server based on
 * the Model Context Protocol specification.
 */

import { z } from "zod";

// Define types for MCP prompts
export interface MCPStaticPrompt {
  name: string;
  description: string;
  argsSchema: z.ZodObject<Record<string, z.ZodString>>;
  messages: Array<{
    role: "user" | "assistant";
    content: {
      type: string;
      text: string;
    };
  }>;
}

export interface MCPDynamicPrompt {
  name: string;
  description: string;
  argsSchema: z.ZodObject<Record<string, z.ZodString | z.ZodOptional<z.ZodString>>>;
  getMessages: (args: Record<string, string>) => Array<{
    role: "user" | "assistant";
    content: {
      type: string;
      text: string;
    };
  }>;
}

export type MCPPrompt = MCPStaticPrompt | MCPDynamicPrompt;

const helpArgs = z.object({});
const gitCommitArgs = z.object({
  diff: z.string(),
});
const explainCodeArgs = z.object({
  code: z.string(),
  language: z.string().optional(),
});
const jiraTicketArgs = z.object({
  description: z.string(),
  type: z.string().optional(),
  project: z.string().optional(),
});
const codeReviewArgs = z.object({
  diff: z.string(),
  context: z.string().optional(),
});

// Define the prompts
const promptsMap: Record<string, MCPPrompt> = {
  help: {
    name: 'help',
    description: 'Get help for nova CLI commands.',
    argsSchema: helpArgs,
    messages: [
      {
        role: 'assistant',
        content: { type: 'text', text: 'Here is the help information for nova CLI.' },
      },
    ],
  },
  git_commit: {
    name: 'git_commit',
    description: 'Generate a commit message from a diff.',
    argsSchema: gitCommitArgs,
    getMessages: (args) => [
      {
        role: 'user',
        content: { type: 'text', text: `Generate a commit message for this diff:\n${args["diff"]}` },
      },
    ],
  },
  explain_code: {
    name: 'explain_code',
    description: 'Explain a code snippet.',
    argsSchema: explainCodeArgs,
    getMessages: (args) => [
      {
        role: 'user',
        content: { type: 'text', text: `Explain this code:\n${args["code"]}${args["language"] ? `\nLanguage: ${args["language"]}` : ''}` },
      },
    ],
  },
  jira_ticket: {
    name: 'jira_ticket',
    description: 'Create a JIRA ticket from a description.',
    argsSchema: jiraTicketArgs,
    getMessages: (args) => [
      {
        role: 'user',
        content: { type: 'text', text: `Create a JIRA ticket:\nDescription: ${args["description"]}${args["type"] ? `\nType: ${args["type"]}` : ''}${args["project"] ? `\nProject: ${args["project"]}` : ''}` },
      },
    ],
  },
  code_review: {
    name: 'code_review',
    description: 'Review a code diff.',
    argsSchema: codeReviewArgs,
    getMessages: (args) => [
      {
        role: 'user',
        content: { type: 'text', text: `Review this code diff:\n${args["diff"]}${args["context"] ? `\nContext: ${args["context"]}` : ''}` },
      },
    ],
  }
};

export const prompts = promptsMap;
export default prompts; 