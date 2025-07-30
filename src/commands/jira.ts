import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Select } from '@cliffy/prompt';
import { Table } from '@cliffy/table';
import { configManager } from '../config/mod.ts';
import { JiraService } from '../services/jira_service.ts';
import { sendIngestPayload } from '../utils/ingest.ts';
import { logger } from '../utils/logger.ts';

export const jiraCommand = new Command()
    .name('jira')
    .description('Jira operations')
    .action(() => {
        logger.passThrough('log', colors.blue('\nJira Command Help\n'));
        logger.passThrough('log', '  nova jira --help        - Show help message');
        logger.passThrough('log', 'Available Commands:');
        logger.passThrough('log', '  nova jira projects    - List Jira projects');
        logger.passThrough('log', '  nova jira issues      - List issues for a project');
        logger.passThrough('log', '  nova jira dashboard   - Show project metrics dashboard');
        logger.passThrough('log', '  nova jira open        - Open issue in browser');
        logger.passThrough('log', '');
        logger.passThrough('log', 'Examples:');
        logger.passThrough('log', colors.dim('  # List all projects'));
        logger.passThrough('log', colors.dim('  nova jira projects'));
        logger.passThrough('log', colors.dim('  # Show dashboard for recent project'));
        logger.passThrough('log', colors.dim('  nova jira dashboard --recent'));
        logger.passThrough('log', colors.dim('  # List issues for a specific project'));
        logger.passThrough('log', colors.dim('  nova jira issues -p PROJECT-KEY'));
        logger.passThrough('log', colors.dim('  # Show details for a specific issue'));
        logger.passThrough('log', colors.dim('  nova jira issue ISSUE-KEY'));
        logger.passThrough('log', colors.dim('  # Open issue in browser'));
        logger.passThrough('log', colors.dim('  nova jira open ISSUE-KEY'));
        logger.passThrough('log', '');
    })
    .command('projects', 'List Jira projects')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as OutputFormat,
        value: (val: string): OutputFormat => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .action(async (options: { format: OutputFormat }) => {
        try {
            const config = await configManager.loadConfig();

            // Validate Jira configuration
            if (
                !config.atlassian?.jira_url || !config.atlassian?.jira_token ||
                !config.atlassian?.username
            ) {
                logger.error(colors.red('\nJira is not configured. Please run:'));
                logger.passThrough('log', colors.blue('\nnova setup\n'));
                Deno.exit(1);
            }

            const jira = new JiraService(config);

            logger.passThrough('log', colors.blue('\nFetching Jira projects...\n'));

            const projects = await jira.getProjects();

            if (projects.length === 0) {
                logger.passThrough('log', colors.yellow('No projects found.'));
                return;
            }

            if (options.format === 'json') {
                logger.json(projects);
            } else {
                const table = new Table()
                    .header([
                        colors.bold.white('Key'),
                        colors.bold.white('Name'),
                        colors.bold.white('Type'),
                        colors.bold.white('Lead'),
                    ])
                    .border(true)
                    .padding(1);

                projects.forEach((project) => {
                    table.push([
                        project.key,
                        project.name,
                        project.projectTypeKey || 'Unknown',
                        project.lead?.displayName || 'Unknown',
                    ]);
                });

                logger.passThrough('log', table.toString() + '\n');
                logger.passThrough('log', colors.dim(`Total projects: ${projects.length}\n`));
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('Jira API error')) {
                logger.error(
                    colors.red(
                        '\nFailed to connect to Jira. Please check your configuration and try again.',
                    ),
                );
                logger.passThrough('log', colors.blue('\nTo reconfigure Jira, run:'));
                logger.passThrough('log', colors.blue('nova setup\n'));
            } else {
                logger.error(
                    colors.red(
                        `\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
                    ),
                );
            }
            Deno.exit(1);
        }
    })
    .command('issues', 'List Jira issues')
    .option('-p, --project <string>', 'Project key', {})
    .option('-q, --query <string>', 'JQL query', {})
    .option('-l, --limit <number:number>', 'Maximum number of issues to return', { default: 20 })
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as OutputFormat,
        value: (val: string): OutputFormat => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .option('--show-completed', 'Show completed issues', { default: false })
    .action(
        async (options: {
            project?: string;
            query?: string;
            limit: number;
            format: OutputFormat;
            showCompleted: boolean;
        }) => {
            try {
                const config = await configManager.loadConfig();

                // Validate Jira configuration
                if (
                    !config.atlassian?.jira_url || !config.atlassian?.jira_token ||
                    !config.atlassian?.username
                ) {
                    logger.error(colors.red('\nJira is not configured. Please run:'));
                    logger.passThrough('log', colors.blue('\nnova setup\n'));
                    Deno.exit(1);
                }

                const jira = new JiraService(config);

                // If no project or query provided, prompt for project
                let projectKey = options.project;
                let jql = options.query;

                if (!projectKey && !jql) {
                    logger.passThrough('log', colors.blue('\nFetching Jira projects...\n'));
                    const projects = await jira.getProjects();

                    if (projects.length === 0) {
                        logger.passThrough('log', colors.yellow('No projects found.'));
                        return;
                    }

                    // Get recent projects
                    const recentProjects = await jira.getRecentProjects();

                    // Let user select a project
                    const selectionOptions = [
                        ...recentProjects.map((p) => ({
                            name: `${colors.blue('Recent:')} ${p.name} (${p.key})`,
                            value: p.key,
                        })),
                        { name: colors.dim('─'.repeat(30)), value: 'separator' },
                        ...projects.map((p) => ({
                            name: `${p.name} (${p.key})`,
                            value: p.key,
                        })),
                    ].filter((option) => option.value !== 'separator');

                    projectKey = await Select.prompt<string>({
                        message: 'Select a Jira project:',
                        options: selectionOptions,
                        search: true,
                    });
                }

                logger.passThrough(
                    'log',
                    colors.blue(
                        `\nFetching Jira issues${
                            projectKey ? ` for project ${projectKey}` : ''
                        }...\n`,
                    ),
                );

                // Build JQL query if not provided
                if (!jql && projectKey) {
                    jql = `project = ${projectKey} ORDER BY updated DESC`;
                } else if (!jql) {
                    jql = 'ORDER BY updated DESC';
                }

                // Fetch issues
                const issues = await jira.searchIssues(jql);

                if (issues.issues.length === 0) {
                    logger.passThrough('log', colors.yellow('\nNo issues found.\n'));
                    return;
                }

                const formattedIssues = jira.formatIssueList(issues.issues);
                logger.passThrough('log', formattedIssues);
                logger.passThrough('log', colors.dim(`\nTotal issues: ${issues.issues.length}\n`));
            } catch (error) {
                if (error instanceof Error && error.message.includes('Jira API error')) {
                    logger.error(
                        colors.red(
                            '\nFailed to connect to Jira. Please check your configuration and try again.',
                        ),
                    );
                } else {
                    logger.error(
                        colors.red(
                            `\nError: ${
                                error instanceof Error ? error.message : 'Unknown error'
                            }\n`,
                        ),
                    );
                }
                Deno.exit(1);
            }
        },
    )
    .command('dashboard')
    .description('Show project dashboard')
    .arguments('[project:string]')
    .option('-f, --format [format:string]', 'Output format (table or json)', { default: 'table' })
    .option('-d, --days [days:number]', 'Number of days to analyze', { default: 84 })
    .option('-r, --recent', 'Show dashboard for most recently viewed project')
    .option('--refresh', 'Force refresh cached data')
    .option('-b, --board [boardId:number]', 'Board ID to analyze')
    .option('--ingest', 'Send metrics to Commander4', { default: false })
    .option('--api-url <url:string>', 'Commander4 API base URL')
    .option('--token <token:string>', 'Commander4 API token')
    .action(async (options, projectKey) => {
        try {
            const config = await configManager.loadConfig();
            if (!config.atlassian?.jira_url || !config.atlassian?.jira_token) {
                console.error(colors.red('Jira is not configured.'));
                console.error('Please run: nova setup');
                Deno.exit(1);
            }

            const jiraService = new JiraService(config);

            // Get project key from arguments, recent projects, or prompt user
            let selectedProjectKey = projectKey;
            if (!selectedProjectKey && options.recent) {
                const recentProjects = await jiraService.getRecentProjects();
                if (recentProjects.length > 0) {
                    selectedProjectKey = recentProjects[0].key;
                }
            }

            if (!selectedProjectKey) {
                const projects = await jiraService.getProjects();
                if (projects.length === 0) {
                    console.error(colors.red('No projects found.'));
                    Deno.exit(1);
                }

                const { Select } = await import('@cliffy/prompt');
                selectedProjectKey = await Select.prompt({
                    message: 'Select a project to analyze:',
                    search: true,
                    options: projects.map((p) => ({
                        name: `${p.name} (${p.key})`,
                        value: p.key,
                    })),
                });
            }

            // Get project metrics with board ID if specified
            const boardId = typeof options.board === 'number' ? options.board : undefined;
            const metrics = await jiraService.getProjectMetrics(selectedProjectKey, boardId);

            // Format and display output
            if (options.format === 'json') {
                console.log(JSON.stringify(metrics, null, 2));
            } else {
                console.log(jiraService.formatProjectDashboard(metrics));
            }

            // Fetch the project object for the selectedProjectKey
            const project = await jiraService.getProject(selectedProjectKey);

            // After metrics are generated and before ingest:
            if (
                options.ingest && options.apiUrl && options.token && selectedProjectKey &&
                metrics &&
                project
            ) {
                const payload = {
                    eventType: 'project_metrics',
                    timestamp: new Date().toISOString(),
                    period: `${options.days}d`,
                    project: {
                        id: project.id,
                        key: project.key,
                        name: project.name,
                        description: project.description || '',
                        projectTypeKey: project.projectTypeKey,
                        url: project.url,
                        isPrivate: project.isPrivate,
                        lead: {
                            accountId: project.lead?.accountId,
                            displayName: project.lead?.displayName,
                            emailAddress: project.lead?.emailAddress,
                            active: true,
                        },
                    },
                    issues: {
                        total: metrics.issues.total || 0,
                        open: metrics.issues.open || 0,
                        inProgress: metrics.issues.inProgress || 0,
                        done: metrics.issues.done || 0,
                        backlog: metrics.issues.backlog || 0,
                        bugs: metrics.issues.bugs || 0,
                        features: metrics.issues.features || 0,
                        technicalDebt: metrics.issues.technicalDebt || 0,
                        byStatus: metrics.issues.byStatus || {},
                        byType: metrics.issues.byType || {},
                        byMember: metrics.issues.byMember || {},
                    },
                    metrics,
                    department: 'engineering',
                    lastActivity: new Date().toISOString(),
                };
                try {
                    await sendIngestPayload({
                        apiUrl: options.apiUrl,
                        token: options.token,
                        platform: 'jira',
                        payload,
                    });
                    logger.passThrough('log', colors.green('✓ Metrics ingested to Commander4!'));
                } catch (err) {
                    logger.error(
                        colors.red(
                            `✗ Failed to ingest metrics: ${
                                err instanceof Error ? err.message : String(err)
                            }`,
                        ),
                    );
                }
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(colors.red('Error:'), error.message);
            } else {
                console.error(colors.red('An unknown error occurred'));
            }
            Deno.exit(1);
        }
    })
    .command('issue', 'Show details about a specific issue')
    .arguments('<issue-key:string>')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as OutputFormat,
        value: (val: string): OutputFormat => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .action(async (options: { format: OutputFormat }, issueKey: string) => {
        try {
            const config = await configManager.loadConfig();

            // Validate Jira configuration
            if (
                !config.atlassian?.jira_url || !config.atlassian?.jira_token ||
                !config.atlassian?.username
            ) {
                logger.error(colors.red('\nJira is not configured. Please run:'));
                logger.passThrough('log', colors.blue('\nnova setup\n'));

                Deno.exit(1);
            }

            const jira = new JiraService(config);

            logger.passThrough('log', colors.blue(`\nFetching issue ${issueKey}...\n`));

            const issue = await jira.getIssue(issueKey);

            if (options.format === 'json') {
                logger.json(issue);
            } else {
                logger.passThrough('log', jira.formatIssueInfo(issue));
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('Jira API error')) {
                logger.error(
                    colors.red(
                        '\nFailed to connect to Jira or issue not found. Please check your configuration and try again.',
                    ),
                );
            } else {
                logger.error(
                    colors.red(
                        `\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
                    ),
                );
            }
            Deno.exit(1);
        }
    })
    .command('open', 'Open a Jira issue in the browser')
    .arguments('<issue-key:string>')
    .action(async (_options: unknown, issueKey: string) => {
        try {
            const config = await configManager.loadConfig();

            // Validate Jira configuration
            if (!config.atlassian?.jira_url) {
                logger.error(colors.red('\nJira is not configured. Please run:'));
                logger.passThrough('log', colors.blue('\nnova setup\n'));
                Deno.exit(1);
            }

            const url = `${config.atlassian.jira_url}/browse/${issueKey}`;
            logger.passThrough('log', colors.blue(`\nOpening ${url} in your browser...\n`));

            const process = new Deno.Command('open', {
                args: [url],
            });
            await process.output();
        } catch (error) {
            logger.error(
                colors.red(
                    `\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
                ),
            );
            Deno.exit(1);
        }
    });
