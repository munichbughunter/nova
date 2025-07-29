// Base types and interfaces
export * from '../../utils.ts';
export * from './base_dev_agent.ts';
export * from './types.ts';

// Sub-agents
export { CodeReviewAgent } from './code-review/mod.ts';
export { QAAgent } from './qa/mod.ts';
// TODO: Implement and export other sub-agents
// export * from './documentor/mod.ts';
// export * from './architect/mod.ts';
// export * from './tester/mod.ts';
// export * from './refactor/mod.ts';
// export * from './security/mod.ts';

import { GitLabService } from '../../services/gitlab_service.ts';
import { theme } from '../../utils.ts';
import { AgentContext, AgentResponse, BaseAgent } from '../base_agent.ts';
import { CodeReviewAgent } from './code-review/code_review_agent.ts';
import { MergeRequestReviewAgent } from './code-review/merge_request_review_agent.ts';
import { ReviewAgentContext } from './code-review/types.ts';
import { QAAgent } from './qa/qa_agent.ts';
import { QAAgentContext } from './qa/types.ts';
import { BaseEngineeringOptions } from './types.ts';

export class EngineeringAgent extends BaseAgent {
    name = 'Engineering';
    description = 'Technical tasks and code quality';
    private subAgents: Map<string, BaseAgent>;
    protected override options: BaseEngineeringOptions;

    constructor(
        context: AgentContext & { gitlab: GitLabService },
        options: BaseEngineeringOptions,
    ) {
        super(context);
        this.options = options;
        this.subAgents = new Map();
        this.initializeSubAgents();
    }

    private initializeSubAgents(): void {
        const context = this.context as ReviewAgentContext;
        this.subAgents.set('review', new CodeReviewAgent(context, this.options));
        this.subAgents.set('review-mr', new MergeRequestReviewAgent(context, this.options));
        this.subAgents.set('qa-tester', new QAAgent(context as QAAgentContext, this.options));
        this.logger.debug(`Initialized subAgents: ${Array.from(this.subAgents.keys()).join(', ')}`);
    }

    override help(): string {
        return `
${theme.header('Engineering Agent Help')}

Available Commands:
  review [path]           Review code changes (file or directory)
  review-mr               Review current merge request changes
  qa-tester               Interactive browser testing with AI
  chat                    Start an interactive chat session
  documentor              Generate and manage documentation (coming soon)
  architect              Architecture analysis and suggestions (coming soon)
  tester                 Test case generation and analysis (coming soon)
  refactor              Code refactoring suggestions (coming soon)
  security              Security analysis and hardening (coming soon)
  
Common Options:
  --path <path>          Path to analyze
  --format <format>      Output format (text|json)
  --depth <level>        Analysis depth (quick|normal|deep)

Examples:
  # Review a specific file or directory
  nova agent eng review --path src/
  nova agent eng review --path file.ts --depth=quick

  # Review current merge request
  nova agent eng review-mr --depth=deep --post

  # Start a QA testing session
  nova agent eng qa-tester test --url https://example.com

  # Start a chat session
  nova agent eng chat
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

        // Map commands to sub-agents
        const subAgent = this.getSubAgentForCommand(command);
        if (subAgent) {
            return subAgent.execute(command, args);
        }

        // Handle unknown commands
        return Promise.resolve({
            success: false,
            message: `Unknown command: ${command}\n\n${this.help()}`,
        });
    }

    private getSubAgentForCommand(command: string): BaseAgent | undefined {
        // Map commands to sub-agents
        switch (command) {
            case 'review':
                return this.subAgents.get('review');
            case 'review-mr':
                return this.subAgents.get('review-mr');
            case 'qa-tester':
                return this.subAgents.get('qa-tester');
            case 'chat':
                return this.subAgents.get('chat');
            case 'documentor':
                return this.subAgents.get('documentor');
            case 'architect':
                return this.subAgents.get('architect');
            case 'tester':
                return this.subAgents.get('tester');
            case 'refactor':
                return this.subAgents.get('refactor');
            case 'security':
                return this.subAgents.get('security');
            default:
                return undefined;
        }
    }
}
