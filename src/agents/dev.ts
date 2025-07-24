import { GitLabService } from '../services/gitlab_service.ts';
import { theme } from '../utils.ts';
import { AgentContext, AgentResponse, BaseAgent } from './base_agent.ts';
import { CodeReviewAgent } from './engineering/code-review/code_review_agent.ts';
import { MergeRequestReviewAgent } from './engineering/code-review/merge_request_review_agent.ts';
import { ReviewAgentContext } from './engineering/code-review/types.ts';
import { BaseEngineeringOptions, CommandOption } from './engineering/types.ts';

const _commands: CommandOption[] = [
  { name: 'Change Review', value: 'change-review' },
  { name: 'Documentation Helper', value: 'documentor' },
  { name: 'Architecture Analysis', value: 'architect' },
  { name: 'Test Generator', value: 'tester' },
  { name: 'Refactoring Assistant', value: 'refactor' },
  { name: 'Security Analyzer', value: 'security' },
  { name: 'Exit', value: 'exit' },
] as const;

export class EngineeringAgent extends BaseAgent {
  name = 'Engineering';
  description = 'Technical tasks and code quality';
  private subAgents: Map<string, BaseAgent>;
  protected override options: BaseEngineeringOptions;

  constructor(context: AgentContext & { gitlab: GitLabService }, options: BaseEngineeringOptions) {
    super(context);
    this.options = options;
    this.subAgents = new Map();
    this.initializeSubAgents();
  }

  private initializeSubAgents(): void {
    // Initialize sub-agents with the same context and options
    const context = this.context as ReviewAgentContext;
    if (!context.gitlab) {
      this.logger.error('GitLab service is required for code review agent');
      return;
    }
    
    // Initialize the subagents with proper keys that match the command names
    this.subAgents.set('review', new CodeReviewAgent(context, this.options));
    
    this.subAgents.set('review-mr', new MergeRequestReviewAgent(context, this.options));
    
    // Log initialization for debugging
    this.logger.debug(`Initialized subagents: ${Array.from(this.subAgents.keys()).join(', ')}`);
  }

  override help(): string {
    return `
${theme.header('Engineering Agent Help')}

Available Commands:
  review [path]          Review code in files or directories
  review-mr              Review current merge request changes
  chat                   Start an interactive chat session
  documentor             Generate and manage documentation (coming soon)
  architect              Architecture analysis and suggestions (coming soon)
  tester                 Test case generation and analysis (coming soon)
  refactor               Code refactoring suggestions (coming soon)
  security               Security analysis and hardening (coming soon)
  
Common Options:
  --path <path>          Path to analyze
  --format <format>      Output format (text|json)
  --depth <level>        Analysis depth (quick|normal|deep)
  --reviewer <type>      Review perspective (junior|senior|architect|all)

Examples:
  # Review a specific file or directory
  nova agent eng review --path src/
  nova agent eng review --path file.ts --depth=quick
  nova agent eng review --path file.ts --reviewer architect

  # Review current merge request
  nova agent eng review-mr --depth=deep --post

  # Start a chat session
  nova agent eng chat
`;
  }

  override execute(command: string, args: string[]): Promise<AgentResponse> {
    // Enhanced debugging 
    this.logger.debug(`EngineeringAgent.execute called with command: ${command}, args: ${args.join(' ')}`);
    this.logger.debug(`Available subAgents: ${Array.from(this.subAgents.keys()).join(', ')}`);
    
    // Show help by default or when help command is used
    if (!command || command === 'help') {
      this.logger.debug('Showing help message due to empty command or explicit help command');
      return Promise.resolve({
        success: true,
        message: this.help(),
      });
    }

    // Map commands to sub-agents
    const subAgent = this.getSubAgentForCommand(command);
    if (subAgent) {
      this.logger.debug(`Found subAgent for command '${command}': ${subAgent.name}`);
      return subAgent.execute(command, args);
    }

    // Handle unknown commands
    this.logger.debug(`No subAgent found for command: ${command}`);
    return Promise.resolve({
      success: false,
      message: `Unknown command: ${command}\n\n${this.help()}`,
    });
  }

  private getSubAgentForCommand(command: string): BaseAgent | undefined {
    this.logger.debug(`getSubAgentForCommand called with command: "${command}"`);
    
    // Map commands to sub-agents
    switch (command) {
      case 'review':
        return this.subAgents.get('review');
      case 'review-mr':
        return this.subAgents.get('review-mr');
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
        this.logger.debug(`No matching case for command: "${command}"`);
        return undefined;
    }
  }
}