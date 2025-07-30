import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Select } from '@cliffy/prompt';
import { configManager } from '../config/mod.ts';
import { DBService } from '../services/db_service.ts';
import { DoraService, ExtendedDoraMetricsResult } from '../services/dora_service.ts';
import { GitProviderFactory } from '../services/git_provider_factory.ts';
import { JiraService } from '../services/jira_service.ts';
import { sendIngestPayload } from '../utils/ingest.ts';
import { logger } from '../utils/logger.ts';

type OutputFormat = 'text' | 'json';
type TimeRange = '7d' | '30d' | '90d';

interface DoraCommandOptions {
    format: OutputFormat;
    timeRange: TimeRange;
}

interface MetricsOptions extends Record<string, unknown> {
    format: OutputFormat;
    timeRange: TimeRange;
    jira?: string;
    gitlab?: string;
    refresh: boolean;
    clearCache: boolean;
    ingest: boolean;
    apiUrl?: string | boolean;
    token?: string | boolean;
}

const metricsCmd = new Command()
    .description('Show DORA metrics for linked Jira and GitLab projects')
    .example(
        'Show metrics for specific projects',
        'nova dora metrics --jira PROJECT --gitlab group/project',
    )
    .example('Show metrics for last 7 days', 'nova dora metrics --time-range 7d')
    .example('Interactive project selection', 'nova dora metrics')
    .example('Get metrics in JSON format', 'nova dora metrics --format json')
    .example('Force refresh cache', 'nova dora metrics --refresh')
    .option('-j, --jira <string>', 'Jira project key')
    .option('-g, --gitlab <string>', 'GitLab project path')
    .option('-t, --time-range <timeRange:string>', 'Time range (7d, 30d, 90d)', {
        default: '30d' as TimeRange,
        value: (val: string): TimeRange => {
            if (val !== '7d' && val !== '30d' && val !== '90d') {
                throw new Error('Time range must be one of: 7d, 30d, 90d');
            }
            return val as TimeRange;
        },
    })
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as OutputFormat,
        value: (val: string): OutputFormat => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .option('--refresh', 'Force refresh cached data', { default: false })
    .option('--clear-cache', 'Clear all cached data before running', { default: false })
    .option('--ingest', 'Send metrics to Commander4', { default: false })
    .option('--api-url [url:string]', 'Commander4 API base URL')
    .option('--token [token:string]', 'Commander4 API token')
    .action(async (options: MetricsOptions) => {
        try {
            const config = await configManager.loadConfig();

            // Validate configurations
            if (
                !config.atlassian?.jira_url || !config.atlassian?.jira_token ||
                !config.atlassian?.username
            ) {
                logger.error(colors.red('\nJira is not configured. Please run:'));
                logger.passThrough('log', colors.blue('\nnova setup\n'));
                Deno.exit(1);
            }

            if (!config.gitlab?.url || !config.gitlab?.token) {
                logger.error(colors.red('\nGitLab is not configured. Please run:'));
                logger.passThrough('log', colors.blue('\nnova setup\n'));
                Deno.exit(1);
            }

            const jiraService = new JiraService(config);
            const gitProvider = await GitProviderFactory.createFromConfig(config);
            const metrics = await gitProvider.getProjectMetrics(projectPath, timeRange);
            const db = await DBService.getInstance();
            const doraService = new DoraService(config, jiraService, gitProvider, logger, db);

            // Clear cache if requested
            if (options.clearCache) {
                await gitProvider.clearCache();
                logger.info(colors.blue('\nCleared all cached data\n'));
            }

            logger.passThrough('log', colors.blue('\nGenerating DORA Metrics...\n'));

            // Handle project selection logic
            let jiraProjectKey = options.jira;
            let gitlabProjectPath = options.gitlab;

            // If not provided, let user select Jira project
            if (!jiraProjectKey) {
                logger.passThrough('log', colors.dim('Fetching available Jira projects...'));
                const projects = await jiraService.getProjects();

                if (projects.length === 0) {
                    logger.passThrough('log', colors.yellow('\nNo Jira projects found.\n'));
                    return;
                }

                const recentJiraProjects = await jiraService.getRecentProjects();

                const jiraOptions = [
                    ...recentJiraProjects.map((p) => ({
                        name: `${colors.blue('Recent:')} ${p.name} (${p.key})`,
                        value: p.key,
                    })),
                    { name: colors.dim('─'.repeat(30)), value: 'separator' },
                    ...projects.map((p) => ({
                        name: `${p.name} (${p.key})`,
                        value: p.key,
                    })),
                ].filter((option) => option.value !== 'separator');

                jiraProjectKey = await Select.prompt<string>({
                    message: 'Select a Jira project:',
                    options: jiraOptions,
                    search: true,
                });
            }

            // If not provided, let user select GitLab project
            if (!gitlabProjectPath) {
                logger.passThrough('log', colors.dim('Fetching available GitLab projects...'));
                const projects = await gitlabService.getProjects();

                if (projects.length === 0) {
                    logger.passThrough('log', colors.yellow('\nNo GitLab projects found.\n'));
                    return;
                }

                const recentGitlabProjects = await gitlabService.getRecentProjects();

                const gitlabOptions = [
                    ...recentGitlabProjects.map((p) => ({
                        name: `${colors.blue('Recent:')} ${p.name} (${p.path_with_namespace})`,
                        value: p.path_with_namespace,
                    })),
                    { name: colors.dim('─'.repeat(30)), value: 'separator' },
                    ...projects.map((p) => ({
                        name: `${p.name} (${p.path_with_namespace})`,
                        value: p.path_with_namespace,
                    })),
                ].filter((option) => option.value !== 'separator');

                gitlabProjectPath = await Select.prompt<string>({
                    message: 'Select a GitLab project:',
                    options: gitlabOptions,
                    search: true,
                });
            }

            // Validate that both projects are selected
            if (!jiraProjectKey || !gitlabProjectPath) {
                logger.error(colors.red('\nBoth Jira and GitLab projects must be specified.\n'));
                Deno.exit(1);
            }

            logger.passThrough(
                'log',
                colors.bold.blue(
                    `\nAnalyzing DORA metrics for:\n- Jira: ${jiraProjectKey}\n- GitLab: ${gitlabProjectPath}\n- Time range: ${options.timeRange}\n`,
                ),
            );

            // Get DORA metrics
            const metrics = options.refresh
                ? await doraService.refreshDoraMetrics(
                    jiraProjectKey,
                    gitlabProjectPath,
                    options.timeRange,
                )
                : await doraService.getDoraMetrics(
                    jiraProjectKey,
                    gitlabProjectPath,
                    options.timeRange,
                ) as ExtendedDoraMetricsResult;

            // Display the metrics
            if (options.format === 'json') {
                logger.json(
                    {
                        timestamp: new Date().toISOString(),
                        timeRange: options.timeRange,
                        jiraProject: {
                            key: jiraProjectKey,
                            name: metrics.jiraProject.name,
                        },
                        gitlabProject: {
                            path: gitlabProjectPath,
                            name: metrics.gitlabProject.name,
                        },
                        metrics: metrics.metrics,
                        trends: metrics.trends,
                    },
                );
            } else {
                const formattedMetrics = await doraService.formatDoraMetrics(metrics);
                logger.passThrough('log', formattedMetrics);
            }

            // After metrics are generated:
            if (options.ingest && options.apiUrl && options.token && metrics) {
                const payload = [{
                    jiraProject: {
                        key: jiraProjectKey,
                        name: metrics.jiraProject.name,
                        url: metrics.jiraProject.url,
                    },
                    gitlabProject: {
                        path: gitlabProjectPath,
                        name: metrics.gitlabProject.name,
                        url: metrics.gitlabProject.url,
                    },
                    metrics: {
                        deploymentFrequency: {
                            deploymentsPerDay:
                                metrics.metrics.deploymentFrequency.deploymentsPerDay,
                            deploymentsTotal: metrics.metrics.deploymentFrequency.deploymentsTotal,
                            rating: metrics.metrics.deploymentFrequency.rating,
                            trendStats: metrics.metrics.deploymentFrequency.trendStats,
                            environmentBreakdown:
                                metrics.metrics.deploymentFrequency.environmentBreakdown,
                        },
                        leadTimeForChanges: {
                            averageInHours: metrics.metrics.leadTimeForChanges.averageInHours,
                            medianInHours: metrics.metrics.leadTimeForChanges.medianInHours,
                            rating: metrics.metrics.leadTimeForChanges.rating,
                        },
                        changeFailureRate: {
                            percentage: metrics.metrics.changeFailureRate.percentage,
                            failedDeployments: metrics.metrics.changeFailureRate.failedDeployments,
                            totalDeployments: metrics.metrics.changeFailureRate.totalDeployments,
                            rating: metrics.metrics.changeFailureRate.rating,
                        },
                        timeToRestore: {
                            averageInHours: metrics.metrics.timeToRestore.averageInHours,
                            medianInHours: metrics.metrics.timeToRestore.medianInHours,
                            incidents: metrics.metrics.timeToRestore.incidents,
                            rating: metrics.metrics.timeToRestore.rating,
                        },
                    },
                    trends: metrics.trends,
                    timestamp: new Date().toISOString(),
                    timeRange: options.timeRange,
                }];

                try {
                    // Ensure apiUrl and token are strings
                    const apiUrl = typeof options.apiUrl === 'string' ? options.apiUrl : undefined;
                    const token = typeof options.token === 'string' ? options.token : undefined;

                    if (!apiUrl || !token) {
                        throw new Error(
                            'API URL and token must be provided as strings for ingestion',
                        );
                    }

                    await sendIngestPayload({
                        apiUrl,
                        token,
                        platform: 'dora',
                        payload,
                    });
                    logger.passThrough(
                        'log',
                        colors.green('✓ DORA metrics ingested to Commander4!'),
                    );
                } catch (err) {
                    logger.error(
                        colors.red(
                            `✗ Failed to ingest DORA metrics: ${
                                err instanceof Error ? err.message : String(err)
                            }`,
                        ),
                    );
                }
            }
        } catch (error) {
            if (error instanceof Error) {
                logger.error(colors.bold.red(`\n✗ Error: ${error.message}\n`));
            } else {
                logger.error(colors.bold.red('\n✗ An unknown error occurred\n'));
            }
            Deno.exit(1);
        }
    });

export const doraCommand = new Command()
    .name('dora')
    .description('DevOps Research and Assessment (DORA) metrics')
    .example(
        'Show metrics for specific projects',
        'nova dora metrics --jira PROJECT --gitlab group/project',
    )
    .example('Show metrics for last 7 days', 'nova dora metrics --time-range 7d')
    .example('Interactive project selection', 'nova dora metrics')
    .example('Get metrics in JSON format', 'nova dora metrics --format json')
    .command('metrics', metricsCmd);
