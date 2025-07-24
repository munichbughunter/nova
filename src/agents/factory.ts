import { AgentContext, BaseAgent } from './base_agent.ts';
import { CodeReviewAgent } from './engineering/code-review/code_review_agent.ts';
import { ReviewAgentContext } from './engineering/types.ts';

export type AgentType = 'pm' | 'eng' | 'bm' | 'code-review';

export class AgentFactory {
  private agents: Map<AgentType, BaseAgent>;
  private context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
    this.agents = new Map();
  }

  getAgent(type: AgentType): BaseAgent {
    let agent = this.agents.get(type);
    if (!agent) {
      agent = this.createAgent(type);
      this.agents.set(type, agent);
    }
    return agent;
  }

  private createAgent(type: AgentType): BaseAgent {
    switch (type) {
      case 'eng':
        return new CodeReviewAgent(this.context as ReviewAgentContext, {
          analysisDepth: 'normal',
          postToGitlab: false,
          path: '.',
          name: 'Engineering'
        });
      case 'code-review':
        return new CodeReviewAgent(this.context as ReviewAgentContext, {
          analysisDepth: 'normal',
          postToGitlab: false,
          path: '.'
        });
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }

  listAgents(): Array<{ type: AgentType; name: string; description: string }> {
    const result: Array<{ type: AgentType; name: string; description: string }> = [];
    for (const [type, agent] of this.agents) {
      result.push({
        type,
        name: agent.name,
        description: agent.description,
      });
    }
    return result;
  }
}
