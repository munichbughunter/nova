import { createEnhancedCodeReviewAgent } from './enhanced-code-review-agent.ts';
import type { AgentContext } from './types.ts';

/**
 * Agent factory for the Enhanced Code Review Agent
 */
export const enhancedCodeReviewAgentFactory = {
    name: 'enhanced-code-review',
    description: 'Enhanced code review agent with comprehensive analysis capabilities',
    createAgent: (context: AgentContext) => createEnhancedCodeReviewAgent(context),
};