import { Config } from '../../../config/types.ts';
import { ConfluenceService } from '../../../services/confluence_service.ts';
import { DatadogService } from '../../../services/datadog_service.ts';
import { DatabaseService } from '../../../services/db_service.ts';
import { DoraService } from '../../../services/dora_service.ts';
import { GitLabService } from '../../../services/gitlab_service.ts';
import { JiraService } from '../../../services/jira_service.ts';
import { Logger } from '../../../utils/logger.ts';
import { MCPService } from '../../../services/mcp_service.ts';
import { MCPToolContext } from '../../../types/tool_types.ts';

export interface ReviewAgentContext {
  config: Config;
  gitlab: GitLabService;
  jira?: JiraService;
  projectPath?: string;
  logger: Logger;
  mcpEnabled?: boolean;
  mcpContext?: MCPToolContext;
  confluence?: ConfluenceService;
  datadog?: DatadogService;
  dora?: DoraService;
  mcpService?: MCPService;
  dbService?: DatabaseService;
}

export interface FileAnalysis {
  path: string;
  issues: Array<{
    severity: 'high' | 'medium' | 'low';
    message: string;
    explanation?: string;
    suggestion: string;
    line?: number;
    column?: number;
    code?: string;
    perspective?: 'junior' | 'senior' | 'architect';
  }>;
  suggestions: string[];
  score: number;
  summary: string;
  learningOpportunities: string[];
}

export interface ReviewSynthesis {
  summary: string;
  consensus: string[];
  differences: string[];
  actionItems: Array<{
    priority: 'high' | 'medium' | 'low';
    description: string;
    rationale: string;
  }>;
  learningOpportunities: string[];
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description?: string;
  state: string;
  created_at: string;
  updated_at: string;
  author: {
    id: number;
    name: string;
    username: string;
  };
  web_url: string;
  changes?: Array<{
    old_path: string;
    new_path: string;
    diff: string;
    deleted_file?: boolean;
  }>;
  diff_refs?: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
}

export interface MRComment {
  path: string;
  line?: number;
  line_type?: 'new' | 'old';
  body: string;
  position?: {
    base_sha: string;
    start_sha: string;
    head_sha: string;
    position_type: 'text';
    new_line?: number;
    old_line?: number;
    new_path: string;
    old_path: string;
  };
}

export interface ReviewSession {
  mr: GitLabMergeRequest;
  comments: MRComment[];
  overallReview: {
    reviews?: FileAnalysis[];
    fileAnalyses?: FileAnalysis[];
    summary: string;
    score: number;
    suggestions: string[];
    isDraft: boolean;
  };
  fixDecisions?: Array<{
    issue: FileAnalysis['issues'][0];
    action: string;
    wasApplied: boolean;
  }>;
}

export interface MergeRequestSelection {
  project: string;
  mr: GitLabMergeRequest;
}
