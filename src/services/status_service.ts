import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import process from "node:process";
import { Config } from '../config/mod.ts';
import { formatServiceStatus, formatTimestamp, ProgressIndicator, theme } from '../utils.ts';
import { Logger } from '../utils/logger.ts';

export interface ServiceStatus {
    name: string;
    status: string;
    details?: string;
    source?: string;
    description?: string;
    message?: string;
    lastChecked?: Date;
    lastIncident?: Date;
}

export class StatusService {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('Status', Deno.env.get('NOVA_DEBUG') === 'true');
    }



    async checkOllama(): Promise<boolean> {
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            return response.ok;
        } catch {
            return false;
        }
    }

    async checkGitHubCopilot(): Promise<boolean> {
        try {
            const process = new Deno.Command('gh', {
                args: ['extension', 'list'],
            });
            const { stdout } = await process.output();
            const output = new TextDecoder().decode(stdout);
            return output.includes('github/gh-copilot');
        } catch {
            return false;
        }
    }

    async checkAtlassianAuth(domain: string, email: string, token: string): Promise<boolean> {
        try {
            const auth = btoa(`${email}:${token}`);
            const response = await fetch(`${domain}/rest/api/3/myself`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json',
                },
            });

            if (response.ok) {
                const data = await response.json();
                this.logger.success(`Successfully authenticated as: ${data.displayName || email}`);
                return true;
            } else {
                this.logger.error(`Authentication failed: ${response.status} ${response.statusText}`);
                return false;
            }
        } catch (error) {
            this.logger.error(`Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    // Helper functions to check if services are configured
    isServiceConfigured(config: Partial<Config>, service: keyof Config): boolean {
        if (!config || !config[service]) return false;

        this.logger.debug(`Checking ${service} configuration:`, config[service]);

        switch (service) {
        case 'gitlab': {
            const gitlab = config.gitlab as Config['gitlab'];
            const isConfigured = Boolean(gitlab?.url && gitlab?.token);
            this.logger.debug(`GitLab configured: ${isConfigured}`);
            return isConfigured;
        }
        case 'ai': {
            const ai = config.ai as Config['ai'];
            const isConfigured = Boolean(ai?.default_provider);
            this.logger.debug(`AI configured: ${isConfigured}`);
            return isConfigured;
        }
        case 'atlassian': {
            const atlassian = config.atlassian as Config['atlassian'];
            const isConfigured = Boolean(
            atlassian?.jira_url && atlassian?.jira_token &&
                atlassian?.confluence_url && atlassian?.confluence_token &&
                atlassian?.username,
            );
            this.logger.debug(`Atlassian configured: ${isConfigured}`);
            return isConfigured;
        }
        default:
            return false;
        }
    }

    async getAllStatuses(config: Config): Promise<ServiceStatus[]> {
        // If config is empty or has no values set, return empty status list
        if (!config || (!config.gitlab?.url && !config.ai)) {
            return [];
        }

        const results = await this.testConnections(config);
        const statuses: ServiceStatus[] = [];

        // Core Services
        if (results.gitlab !== undefined) {
            statuses.push({
                name: 'GitLab',
                status: results.gitlab 
                ? `Connected${results.gitlab_username ? ` as ${results.gitlab_username}` : ''} ${theme.symbols.success}` 
                : `Not Connected ${theme.symbols.error}`,
                source: process.env.GITLAB_TOKEN ? 'env' : 'config',
            });
        }

        if (config.atlassian) {
            statuses.push({
                name: 'Jira',
                status: `Configured ${theme.symbols.configured}`,
                source: 'config',
            });
            statuses.push({
                name: 'Confluence',
                status: `Configured ${theme.symbols.configured}`,
                source: 'config',
            });
        }



        if (config.datadog) {
            statuses.push({
                name: 'Datadog',
                status: `Configured (${config.datadog.site}) ${theme.symbols.configured}`,
                source: 'config',
            });
        }

        // AI Services
        if (config.ai?.openai) {
            statuses.push({
                name: 'OpenAI',
                status: `Configured (${config.ai.openai.default_model}) ${theme.symbols.configured}`,
                source: 'config',
            });
        }

        if (config.ai?.azure) {
            statuses.push({
                name: 'Azure OpenAI',
                status: `Configured (${config.ai.azure.deployment_name}) ${theme.symbols.configured}`,
                source: 'config',
            });
        }

        const ollamaStatus = await this.checkOllama();
        statuses.push({
            name: 'Ollama',
            status: ollamaStatus 
                ? `Connected${config.ai?.ollama?.model ? ` (${config.ai.ollama.model})` : ''} ${theme.symbols.success}`
                : `Not Connected ${theme.symbols.error}`,
            source: 'config',
        });

        const copilotStatus = await this.checkGitHubCopilot();
        statuses.push({
            name: 'GitHub Copilot',
            status: copilotStatus ? `Connected ${theme.symbols.success}` : `Not Connected ${theme.symbols.error}`,
            source: 'gh cli',
        });

        return statuses;
    }

    async testConnections(config: Config): Promise<Record<string, boolean | string>> {
        const results: Record<string, boolean | string> = {};

        // Test GitLab connection
        if (config.gitlab?.url && config.gitlab?.token) {
            try {
                const url = `${config.gitlab.url}/api/v4/user`;
                const gitlabResponse = await fetch(url, {
                    headers: { 'PRIVATE-TOKEN': config.gitlab.token },
                });

                if (!gitlabResponse.ok) {
                    const errorText = await gitlabResponse.text();
                    this.logger.error('GitLab auth failed:', gitlabResponse.status, errorText);
                    results.gitlab = false;
                } else {
                    const userData = await gitlabResponse.json();
                    results.gitlab = true;
                    results.gitlab_username = userData.username;
                }
            } catch (error) {
                this.logger.error('GitLab connection error:', error);
                results.gitlab = false;
            }
        }

        return results;
    }

    displayStatusTable(statuses: ServiceStatus[]): void {
        const table = new Table()
        .header([
            colors.bold.white('Service'),
            colors.bold.white('Status'),
            colors.bold.white('Source'),
        ])
        .border(true)
        .padding(1);

        // First add non-AI services
        const regularServices = statuses.filter(s => 
        !['OpenAI', 'Azure OpenAI', 'Ollama', 'GitHub Copilot'].includes(s.name)
        );

        // Get AI services
        const aiServices = statuses.filter(s => 
        ['OpenAI', 'Azure OpenAI', 'Ollama', 'GitHub Copilot'].includes(s.name)
        );

        for (const status of regularServices) {
        const statusText = status.details 
            ? `${status.status} ${status.details}`
            : status.status;

        let coloredStatus = statusText;
        if (statusText.includes('Configured')) {
            coloredStatus = theme.success(statusText);
        } else if (statusText.includes('Connected')) {
            coloredStatus = theme.success(statusText);
        } else if (statusText.includes('No Session')) {
            coloredStatus = theme.warning(statusText);
        } else if (statusText.includes('Not Connected')) {
            coloredStatus = theme.error(statusText);
        }

        table.push([
            status.name,
            coloredStatus,
            theme.dim(status.source || '-'),
        ]);
        }

        // Add a separator before AI services
        if (regularServices.length > 0 && aiServices.length > 0) {
        table.push(['', '', '']);
        }

        // Then add AI services
        for (const status of aiServices) {
        const statusText = status.details 
            ? `${status.status} ${status.details}`
            : status.status;

        let coloredStatus = statusText;
        if (statusText.includes('Configured')) {
            coloredStatus = theme.success(statusText);
        } else if (statusText.includes('Connected')) {
            coloredStatus = theme.success(statusText);
        } else if (statusText.includes('Not Connected')) {
            coloredStatus = theme.error(statusText);
        }

        table.push([
            status.name,
            coloredStatus,
            theme.dim(status.source || '-'),
        ]);
        }

        this.logger.passThrough('log', table.toString());
    }

    async displayStatusTableWithProgress(config: Config): Promise<void> {
        // Display header with nice formatting
        this.logger.passThrough('log', colors.bold.blue('\n' + '═'.repeat(20)));
        this.logger.passThrough('log', colors.bold.blue('  Nova CLI'));
        this.logger.passThrough('log', colors.dim('  AI-powered project assistant'));
        this.logger.passThrough('log', colors.bold.blue('═'.repeat(20) + '\n'));

        // Show initial empty table
        const table = new Table()
        .header([
            colors.bold.white('Service'),
            colors.bold.white('Status'),
            colors.bold.white('Source'),
        ])
        .border(true)
        .padding(1);

        this.logger.passThrough('log', table.toString());

        // Start progress indicator
        const progress = new ProgressIndicator();
        progress.start('Testing connections');

        // Get statuses
        const statuses = await this.getAllStatuses(config);

        // Stop progress indicator
        progress.stop();

        // Clear previous table (move cursor up)
        this.logger.passThrough('log', '\x1b[2A\x1b[J');  // Move up 2 lines and clear to end

        // Display final table with results
        this.displayStatusTable(statuses);
    }

    formatServiceStatus(services: ServiceStatus[]): string {
        if (services.length === 0) {
        return 'No services found.';
        }

        const sections: string[] = [];
        
        for (const service of services) {
        sections.push(theme.emphasis(`${formatServiceStatus(service.status)} ${service.name}`));
        
        const serviceTable = new Table()
            .border(true)
            .padding(1);
        
        serviceTable.push([`${theme.symbols.metrics} Status`, formatServiceStatus(service.status)]);
        
        if (service.description) {
            serviceTable.push([`${theme.symbols.documentation} Description`, service.description]);
        }
        
        if (service.message) {
            serviceTable.push([`${theme.symbols.documentation} Message`, service.message]);
        }
        
        if (service.lastChecked) {
            serviceTable.push([`${theme.symbols.time} Last Checked`, formatTimestamp(service.lastChecked)]);
        }
        
        if (service.lastIncident) {
            serviceTable.push([`${theme.symbols.time} Last Incident`, formatTimestamp(service.lastIncident)]);
        }
        
        sections.push(serviceTable.toString());
        sections.push('');
        }

        return sections.join('\n');
    }

    formatHealthMetrics(metrics: {
        total: number;
        healthy: number;
        degraded: number;
        unhealthy: number;
        uptime: number;
        meanTimeBetweenFailures: number;
        meanTimeToRecover: number;
    }): string {
        const sections: string[] = [];
        
        sections.push(theme.emphasis(`${theme.symbols.metrics} Health Metrics`));
        
        const healthTable = new Table()
        .border(true)
        .padding(1)
        .header(['Metric', 'Value']);
        
        healthTable.push(['Total Services', metrics.total.toString()]);
        healthTable.push(['Healthy', metrics.healthy.toString()]);
        healthTable.push(['Degraded', metrics.degraded.toString()]);
        healthTable.push(['Unhealthy', metrics.unhealthy.toString()]);
        healthTable.push(['Uptime', `${(metrics.uptime * 100).toFixed(2)}%`]);
        healthTable.push(['Mean Time Between Failures', `${(metrics.meanTimeBetweenFailures / 60).toFixed(2)} hours`]);
        healthTable.push(['Mean Time To Recover', `${(metrics.meanTimeToRecover / 60).toFixed(2)} hours`]);
        
        sections.push(healthTable.toString());
        
        return sections.join('\n');
    }
}
