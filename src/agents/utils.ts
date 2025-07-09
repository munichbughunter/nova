import type { AgentContext, ProjectMetrics } from './types.ts';
import { Logger } from '../utils/logger.ts';

/**
 * Agent utility functions for common operations
 */

/**
 * Generate help information for agents and available tools
 */
export async function getAgentHelp(
    context: AgentContext,
    agentName?: string,
): Promise<string> {
    const logger = context.logger?.child('getAgentHelp') || new Logger('getAgentHelp');
    
    let helpText = '# Nova AI Agent Help\n\n';
    
    if (agentName) {
        helpText += `## Agent: ${agentName}\n\n`;
    } else {
        helpText += '## Available AI Agents\n\n';
    }

    // Add LLM provider information
    if (context.llmProvider) {
        helpText += `**LLM Provider:** ${context.llmProvider.name}\n`;
        
        try {
            const isAvailable = await context.llmProvider.isAvailable();
            helpText += `**Status:** ${isAvailable ? '✅ Available' : '❌ Unavailable'}\n`;
            
            if (isAvailable) {
                const models = await context.llmProvider.listModels();
                if (models.length > 0) {
                    helpText += `**Available Models:** ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}\n`;
                }
            }
        } catch (error) {
            logger.debug('Failed to get LLM provider status:', error);
            helpText += '**Status:** Unknown\n';
        }
        
        helpText += '\n';
    } else {
        helpText += '**LLM Provider:** None configured (using fallback)\n\n';
    }

    // Add MCP tools information
    if (context.mcpEnabled && context.mcpService) {
        helpText += '## Available MCP Tools\n\n';
        
        try {
            const tools = context.mcpService.getTools();
            
            if (tools.length > 0) {
                helpText += `Found ${tools.length} available tools:\n\n`;
                
                // Group tools by category (based on name prefix)
                const toolCategories: Record<string, typeof tools> = {};
                
                tools.forEach(tool => {
                    const prefix = tool.function.name.split('_')[0] || 'general';
                    if (!toolCategories[prefix]) {
                        toolCategories[prefix] = [];
                    }
                    toolCategories[prefix].push(tool);
                });
                
                // Display tools by category
                Object.entries(toolCategories).forEach(([category, categoryTools]) => {
                    helpText += `### ${category.toUpperCase()} Tools\n\n`;
                    
                    categoryTools.forEach(tool => {
                        helpText += `- **${tool.function.name}**: ${tool.function.description}\n`;
                    });
                    
                    helpText += '\n';
                });
            } else {
                helpText += 'No MCP tools are currently available.\n\n';
            }
        } catch (error) {
            logger.error('Failed to get MCP tools:', error);
            helpText += 'Error retrieving MCP tools information.\n\n';
        }
    } else {
        helpText += '## MCP Tools\n\nMCP tools are not enabled or configured.\n\n';
    }

    // Add service bindings information
    if (context.services) {
        helpText += '## Available Services\n\n';
        
        const serviceStatus: Array<{ name: string; available: boolean }> = [
            { name: 'GitLab', available: !!context.services.gitlab },
            { name: 'Jira', available: !!context.services.jira },
            { name: 'Confluence', available: !!context.services.confluence },
            { name: 'Datadog', available: !!context.services.datadog },
            { name: 'Grafana', available: !!context.services.grafana },
            { name: 'DORA Metrics', available: !!context.services.dora },
        ];
        
        serviceStatus.forEach(service => {
            helpText += `- **${service.name}**: ${service.available ? '✅ Available' : '❌ Not configured'}\n`;
        });
        
        helpText += '\n';
    }

    // Add usage examples
    helpText += '## Usage Examples\n\n';
    helpText += '```bash\n';
    helpText += '# General agent interaction\n';
    helpText += 'nova agent run "What are the recent issues in my project?"\n\n';
    helpText += '# Specific task execution\n';
    helpText += 'nova agent execute --task analyze --input "project-analysis"\n\n';
    helpText += '# Get agent-specific help\n';
    helpText += 'nova agent help [agent-name]\n';
    helpText += '```\n\n';

    // Add configuration tips
    helpText += '## Configuration\n\n';
    helpText += 'To enhance agent capabilities:\n\n';
    helpText += '1. **Configure LLM Provider**: Set up OpenAI or Ollama in your Nova config\n';
    helpText += '2. **Enable MCP Tools**: Run `nova mcp setup` to configure MCP integration\n';
    helpText += '3. **Service Integration**: Configure GitLab, Jira, and other services for enhanced functionality\n\n';
    
    helpText += 'For more information, see the Nova CLI documentation.\n';

    return helpText;
}

/**
 * Get project metrics from various sources
 */
export async function getProjectMetrics(
    context: AgentContext,
    projectId?: string,
    includeMetrics: string[] = ['basic', 'activity', 'quality'],
): Promise<ProjectMetrics[]> {
    const logger = context.logger?.child('getProjectMetrics') || new Logger('getProjectMetrics');
    const metrics: ProjectMetrics[] = [];

    logger.debug('Gathering project metrics', { projectId, includeMetrics });

    try {
        // Get GitLab project metrics
        if (context.services?.gitlab && includeMetrics.includes('gitlab')) {
            const gitlabMetrics = await getGitLabMetrics(context, projectId, logger);
            if (gitlabMetrics) {
                metrics.push(gitlabMetrics);
            }
        }

        // Get Jira project metrics
        if (context.services?.jira && includeMetrics.includes('jira')) {
            const jiraMetrics = await getJiraMetrics(context, projectId, logger);
            if (jiraMetrics) {
                metrics.push(jiraMetrics);
            }
        }

        // Get DORA metrics
        if (context.services?.dora && includeMetrics.includes('dora')) {
            const doraMetrics = await getDoraMetrics(context, projectId, logger);
            if (doraMetrics) {
                metrics.push(doraMetrics);
            }
        }

        // Get basic project information
        if (includeMetrics.includes('basic')) {
            const basicMetrics = await getBasicProjectMetrics(context, projectId, logger);
            if (basicMetrics) {
                metrics.push(basicMetrics);
            }
        }

        logger.info(`Collected ${metrics.length} metric sets`);
        return metrics;
    } catch (error) {
        logger.error('Failed to get project metrics:', error);
        throw new Error(`Failed to get project metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get GitLab project metrics
 */
async function getGitLabMetrics(
    context: AgentContext,
    projectId?: string,
    logger?: Logger,
): Promise<ProjectMetrics | null> {
    try {
        if (!context.mcpService) {
            return null;
        }

        const searchParams = projectId 
            ? { query: `project:${projectId}`, scope: 'projects' }
            : { query: 'starred:true', scope: 'projects' };

        const result = await context.mcpService.executeTool('f1e_gitlab_search', searchParams, context);
        
        if (!result.success || !result.data) {
            return null;
        }

        // Extract basic metrics from GitLab data
        const projectData = Array.isArray(result.data) ? result.data[0] : result.data;
        
        return {
            project: {
                name: projectData.name || 'GitLab Project',
                url: projectData.web_url || '',
                type: 'gitlab',
            },
            metrics: {
                stars: projectData.star_count || 0,
                forks: projectData.forks_count || 0,
                issues: projectData.open_issues_count || 0,
                lastActivity: projectData.last_activity_at || '',
                visibility: projectData.visibility || 'private',
            },
            timestamp: new Date(),
        };
    } catch (error) {
        logger?.error('Failed to get GitLab metrics:', error);
        return null;
    }
}

/**
 * Get Jira project metrics
 */
async function getJiraMetrics(
    context: AgentContext,
    projectId?: string,
    logger?: Logger,
): Promise<ProjectMetrics | null> {
    try {
        if (!context.mcpService) {
            return null;
        }

        const jql = projectId 
            ? `project = ${projectId}`
            : 'assignee = currentUser() AND resolution = Unresolved';

        const result = await context.mcpService.executeTool('f1e_jira_search', { jql }, context);
        
        if (!result.success || !result.data) {
            return null;
        }

        const issues = Array.isArray(result.data) ? result.data : [result.data];
        
        // Calculate basic metrics
        const totalIssues = issues.length;
        const bugCount = issues.filter((issue: unknown) => {
            const typedIssue = issue as { fields?: { issuetype?: { name?: string } } };
            return typedIssue.fields?.issuetype?.name === 'Bug';
        }).length;
        const storyCount = issues.filter((issue: unknown) => {
            const typedIssue = issue as { fields?: { issuetype?: { name?: string } } };
            return typedIssue.fields?.issuetype?.name === 'Story';
        }).length;
        
        return {
            project: {
                name: projectId || 'Jira Project',
                url: '', // Would need additional API call to get project URL
                type: 'jira',
            },
            metrics: {
                totalIssues,
                bugs: bugCount,
                stories: storyCount,
                openIssues: totalIssues, // All searched issues are open
            },
            timestamp: new Date(),
        };
    } catch (error) {
        logger?.error('Failed to get Jira metrics:', error);
        return null;
    }
}

/**
 * Get DORA metrics
 */
function getDoraMetrics(
    _context: AgentContext,
    projectId?: string,
    logger?: Logger,
): Promise<ProjectMetrics | null> {
    try {
        // This would integrate with a DORA metrics service
        // For now, return mock data structure
        logger?.debug('DORA metrics service not yet implemented');
        
        return Promise.resolve({
            project: {
                name: projectId || 'DORA Metrics',
                url: '',
                type: 'jira', // DORA metrics often come from development tracking
            },
            metrics: {
                deploymentFrequency: 0,
                leadTimeForChanges: 0,
                meanTimeToRecovery: 0,
                changeFailureRate: 0,
            },
            timestamp: new Date(),
        });
    } catch (error) {
        logger?.error('Failed to get DORA metrics:', error);
        return Promise.resolve(null);
    }
}

/**
 * Get basic project metrics from working directory
 */
async function getBasicProjectMetrics(
    context: AgentContext,
    projectId?: string,
    logger?: Logger,
): Promise<ProjectMetrics | null> {
    try {
        const workingDir = context.workingDirectory || Deno.cwd();
        
        // Basic file system metrics
        const metrics: Record<string, string | number | boolean> = {
            workingDirectory: workingDir,
            projectId: projectId || 'local',
        };

        // Try to get git information if available
        try {
            const gitDir = `${workingDir}/.git`;
            const gitStat = await Deno.stat(gitDir);
            
            if (gitStat.isDirectory) {
                metrics.hasGit = true;
                // Could add more git-specific metrics here
            }
        } catch {
            // No git directory
            metrics.hasGit = false;
        }

        return {
            project: {
                name: projectId || 'Local Project',
                url: workingDir,
                type: 'gitlab', // Default type
            },
            metrics,
            timestamp: new Date(),
        };
    } catch (error) {
        logger?.error('Failed to get basic project metrics:', error);
        return null;
    }
}

/**
 * Format project metrics for display
 */
export function formatProjectMetrics(metrics: ProjectMetrics[]): string {
    if (metrics.length === 0) {
        return 'No project metrics available.';
    }

    let output = '# Project Metrics\n\n';

    metrics.forEach((metric, index) => {
        output += `## ${metric.project.name} (${metric.project.type})\n\n`;
        
        if (metric.project.url) {
            output += `**URL:** ${metric.project.url}\n`;
        }
        
        output += `**Last Updated:** ${metric.timestamp.toLocaleString()}\n\n`;
        
        output += '### Metrics\n\n';
        
        Object.entries(metric.metrics).forEach(([key, value]) => {
            output += `- **${key}**: ${value}\n`;
        });
        
        if (index < metrics.length - 1) {
            output += '\n---\n\n';
        }
    });

    return output;
}
