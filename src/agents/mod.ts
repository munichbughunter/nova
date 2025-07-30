import { Config } from '../config/mod.ts';
import { ConfluenceService } from '../services/confluence_service.ts';
import { DatadogService } from '../services/datadog_service.ts';
import { DoraService } from '../services/dora_service.ts';
import { IGitProviderService } from '../services/git_provider_factory.ts';
import { GitLabService } from '../services/gitlab_service.ts';
import { JiraService } from '../services/jira_service.ts';
import { MCPService } from '../services/mcp_service.ts';

import { Logger } from '../utils/logger.ts';
import { BaseAgent, MCPToolContext } from './base_agent.ts';
import { EngineeringAgent } from './dev/mod.ts';
import { QAAgent } from './dev/qa/qa_agent.ts';
import { BaseEngineeringOptions, QATesterOptions } from './dev/types.ts';

export type AgentType = 'pm' | 'dev' | 'bm' | 'qa';

export type AgentOptions = BaseEngineeringOptions | Record<string, unknown>;

export interface AgentContext {
    config: Config;
   gitProvider?: IGitProviderService
    jira?: JiraService;
    projectPath?: string;
    logger: Logger;
    mcpEnabled?: boolean;
    mcpContext?: MCPToolContext;
    confluence?: ConfluenceService;
    datadog?: DatadogService;
    dora?: DoraService;
    mcpService?: MCPService;
}

export class AgentFactory {
    private context: AgentContext;

    constructor(context: Partial<AgentContext>) {
        // Create a logger if not provided
        const logger = context.logger || new Logger('Agent', Deno.env.get('DEBUG') === 'true');

        // Initialize Jira service if configured
        let jira: JiraService | undefined;
        try {
            if (
                context.config?.atlassian?.jira_url &&
                context.config.atlassian.jira_token &&
                context.config.atlassian.username
            ) {
                jira = new JiraService(context.config);
                logger.debug('Initialized Jira service');
            }
        } catch (error) {
            logger.warn('Failed to initialize Jira service:', error);
        }

        this.context = {
            config: context.config!,
            gitProvider: context.gitProvider,
            gitlab: context.gitProvider instanceof GitLabService ? (context.gitProvider as GitLabService) : undefined,
            jira,
            projectPath: context.projectPath,
            logger: logger,
            mcpEnabled: context.mcpEnabled,
            mcpContext: context.mcpContext,
            confluence: context.confluence,
            datadog: context.datadog,
            dora: context.dora,
            mcpService: context.mcpService,
        };
    }

    getAgent(type: AgentType, options: AgentOptions = {}): BaseAgent {
        // Create a child logger for the specific agent type
        const agentLogger = this.context.logger.child(type);
        const agentContext = {
            ...this.context,
            logger: agentLogger,
        };

        switch (type) {
            case 'dev':
                return new EngineeringAgent(agentContext, options as BaseEngineeringOptions);
            case 'qa':
                return new QAAgent(agentContext, options as QATesterOptions);
            case 'pm':
            case 'bm':
                throw new Error(`Agent type '${type}' not implemented yet`);
            default:
                throw new Error(`Unknown agent type: ${type}`);
        }
    }
}

// Export all agents
export * from './base_agent.ts';
export * from './dev/mod.ts';
export * from './workflow_agent.ts';
