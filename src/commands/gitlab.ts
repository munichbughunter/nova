import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Select } from '@cliffy/prompt';
import { Table } from '@cliffy/table';
import { ProjectSchema } from '@gitbeaker/rest';
import process from 'node:process';
import { configManager } from '../config/mod.ts';
import { DatabaseService } from '../services/db_service.ts';
import { GitLabService } from '../services/gitlab_service.ts';
import { ProgressIndicator } from '../utils.ts';
import { commonJsonExamples, formatJsonExamples } from '../utils/help.ts';
import { sendIngestPayload } from '../utils/ingest.ts';
import { logger } from '../utils/logger.ts';
import { API_BASE_URL } from './mcp_a2a.ts';
type OutputFormat = 'text' | 'json';

interface DashboardOptions {
    format: OutputFormat;
    days: number;
    mrLimit?: number;
    pipelineLimit?: number;
    teamLimit?: number;
}

export const gitlabCommand = new Command()
    .name('gitlab')
    .description('GitLab operations')
    .action(() => {
        logger.passThrough('log', colors.blue('\nGitLab Command Help\n'));
        logger.passThrough('log', 'Available Commands:');
        logger.passThrough('log', '  nova gitlab projects    - List GitLab projects');
        logger.passThrough('log', '  nova gitlab project     - Show detailed project information');
        logger.passThrough('log', '  nova gitlab dashboard   - Show engineering metrics dashboard');
        logger.passThrough('log', '');
        logger.passThrough('log', 'Examples:');
        logger.passThrough('log', colors.dim('  # List all projects'));
        logger.passThrough('log', colors.dim('  nova gitlab projects'));
        logger.passThrough('log', colors.dim('  # Show detailed project information'));
        logger.passThrough('log', colors.dim('  nova gitlab project group/project-name'));
        logger.passThrough('log', colors.dim('  # Show dashboard for recent project'));
        logger.passThrough('log', colors.dim('  nova gitlab dashboard --recent'));
        logger.passThrough('log', colors.dim('  # Search for a specific project'));
        logger.passThrough('log', colors.dim('  nova gitlab dashboard -q "my-project"'));
        logger.passThrough('log', '');
    });

// Create projects command group
const projectsCommand = new Command()
    .description('List GitLab projects')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as OutputFormat,
        value: (val: string): OutputFormat => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .action(async ({ format }: { format: OutputFormat }) => {
        try {
            const progress = new ProgressIndicator();
            const config = await configManager.loadConfig();

            // Validate GitLab configuration
            if (!config.gitlab?.url || !config.gitlab?.token) {
                logger.error(colors.red('\nGitLab is not configured. Please run:'));
                logger.passThrough(
                    'log',
                    colors.blue(
                        '\nnova setup\n',
                    ),
                );
                Deno.exit(1);
            }

            const gitlab = new GitLabService(config);

            if (format !== 'json') {
                logger.passThrough('log', colors.blue('\nFetching GitLab projects...\n'));
                progress.start('Fetching projects...');
            }

            const projects = await gitlab.getProjects();

            if (projects.length === 0 && format !== 'json') {
                progress.stop();
                logger.passThrough('log', colors.yellow('No projects found.'));
                return;
            }

            if (format === 'json') {
                logger.json(projects);
            } else {
                progress.stop();
                const table = new Table()
                    .header([
                        colors.bold.white('Name'),
                        colors.bold.white('Path'),
                        colors.bold.white('Last Activity'),
                    ])
                    .border(true)
                    .padding(1);

                projects.forEach((project) => {
                    table.push([
                        project.name,
                        project.path_with_namespace,
                        new Date(project.last_activity_at).toLocaleDateString(),
                    ]);
                });

                logger.passThrough('log', table.toString() + '\n');
                logger.passThrough('log', colors.dim(`Total projects: ${projects.length}\n`));
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('GitLab API error')) {
                logger.error(
                    colors.red(
                        '\nFailed to connect to GitLab. Please check your configuration and try again.',
                    ),
                );
                logger.passThrough('log', colors.blue('\nTo reconfigure GitLab, run:'));
                logger.passThrough(
                    'log',
                    colors.blue(
                        '\nnova setup\n',
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
    });

// Add help subcommand to projects
projectsCommand.command('help')
    .description('Show help for projects command')
    .action(() => {
        logger.passThrough('log', '\nGitLab Projects Command\n');
        logger.passThrough('log', 'Usage:');
        logger.passThrough('log', '  nova gitlab projects [options]');
        logger.passThrough('log', '\nOptions:');
        logger.passThrough(
            'log',
            '  -f, --format            Output format (text/json) [default: text]',
        );
        logger.passThrough(
            'log',
            formatJsonExamples([
                commonJsonExamples.copyToClipboard('nova gitlab projects'),
                {
                    description: 'Get private projects only',
                    command:
                        'nova gitlab projects --format json | jq -r \'.[] | select(.visibility=="private")\'',
                },
                {
                    description: 'List project names and paths',
                    command:
                        'nova gitlab projects --format json | jq -r \'.[] | "\\(.name) (\\(.fullPath))"\'',
                },
            ]),
        );
        logger.passThrough('log', '');
    });

// Create project command for displaying detailed project information
const projectCommand = new Command()
    .description('Show detailed information about a GitLab project')
    .arguments('<project_path:string>')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as OutputFormat,
        value: (val: string): OutputFormat => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .action(async (options: { format: OutputFormat }, projectPath: string) => {
        try {
            const config = await configManager.loadConfig();

            // Validate GitLab configuration
            if (!config.gitlab?.url || !config.gitlab?.token) {
                logger.error(colors.red('\nGitLab is not configured. Please run:'));
                logger.passThrough(
                    'log',
                    colors.blue(
                        '\nnova setup\n',
                    ),
                );
                Deno.exit(1);
            }

            const gitlab = new GitLabService(config);

            logger.passThrough(
                'log',
                colors.blue(`\nFetching project information for ${projectPath}...\n`),
            );

            try {
                const project = await gitlab.getProjectDetails(projectPath);

                if (options.format === 'json') {
                    logger.json(project);
                } else {
                    logger.passThrough('log', gitlab.formatProjectInfo(project));
                }
            } catch (error) {
                logger.error(
                    colors.red(
                        `\nError retrieving project: ${
                            error instanceof Error ? error.message : 'Unknown error'
                        }`,
                    ),
                );
                Deno.exit(1);
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('GitLab API error')) {
                logger.error(
                    colors.red(
                        '\nFailed to connect to GitLab. Please check your configuration and try again.',
                    ),
                );
                logger.passThrough('log', colors.blue('\nTo reconfigure GitLab, run:'));
                logger.passThrough(
                    'log',
                    colors.blue(
                        '\nnova setup\n',
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
    });

// Add help subcommand to project
projectCommand.command('help')
    .description('Show help for project command')
    .action(() => {
        logger.passThrough('log', '\nGitLab Project Command\n');
        logger.passThrough('log', 'Usage:');
        logger.passThrough('log', '  nova gitlab project <project_path> [options]');
        logger.passThrough('log', '\nArguments:');
        logger.passThrough(
            'log',
            '  project_path           Full path of the project (e.g., group/project)',
        );
        logger.passThrough('log', '\nOptions:');
        logger.passThrough(
            'log',
            '  -f, --format           Output format (text/json) [default: text]',
        );
        logger.passThrough('log', '\nExamples:');
        logger.passThrough('log', colors.dim('  nova gitlab project my-group/my-project'));
        logger.passThrough(
            'log',
            colors.dim('  nova gitlab project my-group/my-project --format json'),
        );
        logger.passThrough('log', '');
    });

// Create dashboard command group
const dashboardCommand = new Command()
    .description('Show engineering metrics dashboard')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as OutputFormat,
        value: (val: string): OutputFormat => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .option('-d, --days <number:number>', 'Number of days to analyze', { default: 30 })
    .option('-r, --recent', 'Automatically use the most recent project', { default: false })
    .option('--refresh', 'Force refresh cached data', { default: false })
    .option('-q, --query <string>', 'Search for a project by name', {})
    .option('--mr-limit <number:number>', 'Limit number of merge requests to analyze', {
        default: 100,
    })
    .option('--pipeline-limit <number:number>', 'Limit number of pipelines to analyze', {
        default: 50,
    })
    .option('--team-limit <number:number>', 'Limit number of merge requests for team analysis', {
        default: 50,
    })
    .option('--ingest', 'Send metrics to Commander4', { default: false })
    .option('--api-url <url:string>', 'Commander4 API base URL', { default: API_BASE_URL })
    .option('--token <token:string>', 'Commander4 API token')
    .arguments('[project_key:string]')
    .action(async (
        options: DashboardOptions & {
            recent: boolean;
            refresh: boolean;
            project_key?: string;
            query?: string;
            mrLimit: number;
            pipelineLimit: number;
            teamLimit: number;
            ingest?: boolean;
            apiUrl?: string;
            token?: string;
        },
    ) => {
        try {
            const config = await configManager.loadConfig();
            const gitlab = new GitLabService(config);

            logger.passThrough(
                'log',
                colors.blue('\nGenerating Engineering Metrics Dashboard...\n'),
            );

            let selectedProject: ProjectSchema | undefined;

            // If project key is provided, use it directly
            if (options.project_key) {
                try {
                    selectedProject = await gitlab.getProjectDetails(options.project_key);
                    logger.passThrough(
                        'log',
                        colors.dim(
                            `Using specified project: ${selectedProject?.name} (${selectedProject?.path_with_namespace})`,
                        ),
                    );
                } catch (error) {
                    logger.error(
                        colors.red(
                            `\n✗ Error analyzing project ${options.project_key}: ${
                                error instanceof Error ? error.message : 'Unknown error'
                            }\n`,
                        ),
                    );
                    Deno.exit(1);
                }
            } // If --recent flag is used, try to use the most recent project
            else if (options.recent) {
                try {
                    const recentProjects = await gitlab.getRecentProjects();
                    if (recentProjects.length === 0) {
                        logger.passThrough('log', colors.yellow('\nNo recent projects found.\n'));
                        Deno.exit(1);
                    }
                    const mostRecent = recentProjects[0];
                    selectedProject = await gitlab.getProjectDetails(
                        mostRecent.path_with_namespace,
                    );
                    logger.passThrough(
                        'log',
                        colors.dim(
                            `Using most recent project: ${mostRecent.name} (${mostRecent.path_with_namespace})`,
                        ),
                    );
                } catch (error) {
                    logger.error(
                        colors.red(
                            `\n✗ Error analyzing recent project: ${
                                error instanceof Error ? error.message : 'Unknown error'
                            }\n`,
                        ),
                    );
                    Deno.exit(1);
                }
            } // If query is provided, search for matching projects
            else if (options.query) {
                logger.passThrough('log', colors.dim('Fetching available projects...'));

                try {
                    // First check if we have cached data before showing loading indicator
                    const db = await DatabaseService.getInstance();
                    const cachedData = await db.getCachedProjectsList();

                    // Show loading indicator only if we need to fetch fresh data
                    let loadingInterval: number | undefined;
                    const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

                    if (!cachedData || (Date.now() - cachedData.timestamp.getTime() > oneDay)) {
                        logger.passThrough(
                            'log',
                            colors.dim('No recent cache found. Fetching from GitLab API...'),
                        );
                        loadingInterval = setInterval(() => {
                            Deno.stdout.writeSync(new TextEncoder().encode('.'));
                        }, 500);
                    } else {
                        logger.passThrough(
                            'log',
                            colors.dim(
                                `Using cached project list from ${cachedData.timestamp.toLocaleString()}`,
                            ),
                        );
                    }

                    // Fetch all projects with cached data for better performance
                    const allProjects = await gitlab.getProjects(false); // use cached data if available

                    // Clear loading indicator if it was started
                    if (loadingInterval) {
                        clearInterval(loadingInterval);
                        Deno.stdout.writeSync(new TextEncoder().encode('\n'));
                    }

                    if (allProjects.length === 0) {
                        logger.passThrough('log', colors.yellow('\nNo GitLab projects found.\n'));
                        return;
                    }

                    // Filter projects by query
                    const query = options.query.toLowerCase();
                    const matchingProjects = allProjects.filter((p) =>
                        p.name.toLowerCase().includes(query) ||
                        p.path_with_namespace.toLowerCase().includes(query)
                    );

                    if (matchingProjects.length === 0) {
                        logger.passThrough(
                            'log',
                            colors.yellow(`\nNo projects found matching "${options.query}"\n`),
                        );
                        return;
                    }

                    if (matchingProjects.length === 1) {
                        selectedProject = matchingProjects[0];
                        logger.passThrough(
                            'log',
                            colors.dim(
                                `Found matching project: ${selectedProject?.name} (${selectedProject?.path_with_namespace})`,
                            ),
                        );
                    } else {
                        logger.passThrough(
                            'log',
                            colors.dim(
                                `Found ${matchingProjects.length} matching projects. Select one to analyze:`,
                            ),
                        );

                        // Let user select a project from matches
                        const selectedPath = await Select.prompt<string>({
                            message: 'Select a project to analyze:',
                            options: matchingProjects.map((p) => ({
                                name: `${p.name} (${p.path_with_namespace})`,
                                value: p.path_with_namespace,
                            })),
                            search: true,
                        });

                        selectedProject = matchingProjects.find((p) =>
                            p.path_with_namespace === selectedPath
                        );
                    }
                } catch (error) {
                    process.stdout.write('\n'); // Make sure we're on a new line in case of error
                    throw error;
                }
            } // If no parameters provided, show interactive selection
            else {
                // Get all namespaces with tree structure
                logger.passThrough('log', colors.dim('Fetching available projects...'));

                try {
                    // First check if we have cached data before showing loading indicator
                    const db = await DatabaseService.getInstance();
                    const cachedData = await db.getCachedProjectsList();

                    // Show loading indicator only if we need to fetch fresh data
                    let loadingInterval: number | undefined;
                    const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

                    if (!cachedData || (Date.now() - cachedData.timestamp.getTime() > oneDay)) {
                        logger.passThrough(
                            'log',
                            colors.dim('No recent cache found. Fetching from GitLab API...'),
                        );
                        loadingInterval = setInterval(() => {
                            Deno.stdout.writeSync(new TextEncoder().encode('.'));
                        }, 500);
                    } else {
                        logger.passThrough(
                            'log',
                            colors.dim(
                                `Using cached project list from ${cachedData.timestamp.toLocaleString()}`,
                            ),
                        );
                    }

                    // Fetch all projects with cached data for better performance
                    const allProjects: ProjectSchema[] = await gitlab.getProjects(false); // use cached data if available

                    // Clear loading indicator if it was started
                    if (loadingInterval) {
                        clearInterval(loadingInterval);
                        Deno.stdout.writeSync(new TextEncoder().encode('\n'));
                    }

                    if (allProjects.length === 0) {
                        logger.passThrough('log', colors.yellow('\nNo GitLab projects found.\n'));
                        return;
                    }

                    // Get recent projects for quick access
                    const recentProjects = await gitlab.getRecentProjects();

                    // Sort projects by name for easier navigation
                    allProjects.sort((a, b) => a.name.localeCompare(b.name));

                    logger.passThrough(
                        'log',
                        colors.dim(`Found ${allProjects.length} projects. Select one to analyze:`),
                    );

                    // Let user select a project directly
                    const selectedPath = await Select.prompt<string>({
                        message: 'Select a project to analyze:',
                        options: [
                            ...recentProjects.map((p) => ({
                                name: `${
                                    colors.blue('Recent:')
                                } ${p.name} (${p.path_with_namespace})`,
                                value: p.path_with_namespace,
                            })),
                            { name: colors.dim('─'.repeat(30)), value: 'separator' },
                            ...allProjects.map((p: ProjectSchema) => ({
                                name: `${p.name} (${p.path_with_namespace})`,
                                value: p.path_with_namespace,
                            })),
                        ].filter((option) => option.value !== 'separator'),
                        search: true,
                    });

                    selectedProject = allProjects.find((p: ProjectSchema) =>
                        p.path_with_namespace === selectedPath
                    );
                    if (!selectedProject && selectedPath) {
                        // If not found in allProjects but path is selected, try to get it directly
                        selectedProject = await gitlab.getProjectDetails(selectedPath);
                    }
                } catch (error) {
                    process.stdout.write('\n'); // Make sure we're on a new line in case of error
                    throw error;
                }
            }

            if (!selectedProject) {
                throw new Error('No project selected');
            }

            try {
                // Check if we have cached metrics
                const db = await DatabaseService.getInstance();
                const cachedDashboard = await db.getCachedDashboard(
                    selectedProject.path_with_namespace,
                );

                let metrics;

                if (cachedDashboard && !options.refresh) {
                    logger.passThrough(
                        'log',
                        colors.dim(
                            `Using cached metrics from ${cachedDashboard.timestamp.toLocaleString()}`,
                        ),
                    );
                    metrics = cachedDashboard.metrics;
                } else {
                    // Show progress indicator for metric generation
                    const progress = new ProgressIndicator();
                    progress.start('Generating project metrics...');

                    try {
                        // Get metrics with optional refresh
                        if (options.refresh) {
                            await gitlab.clearCache();
                        }
                        metrics = await gitlab.getProjectMetrics(
                            selectedProject.path_with_namespace,
                            '30d',
                            options.refresh,
                            {
                                mrLimit: options.mrLimit,
                                pipelineLimit: options.pipelineLimit,
                                teamLimit: options.teamLimit,
                            },
                        );
                        // Clear progress indicator
                        progress.stop();
                        logger.passThrough(
                            'log',
                            colors.green('✓ Project metrics generated successfully'),
                        );
                    } catch (error) {
                        // Clear progress indicator in case of error
                        progress.stop();
                        throw error;
                    }
                }

                if (options.format === 'json') {
                    logger.json(
                        {
                            timestamp: new Date().toISOString(),
                            period: `${options.days}d`,
                            project: {
                                id: selectedProject.id,
                                name: selectedProject.name,
                                path: selectedProject.path_with_namespace,
                                description: selectedProject.description,
                                visibility: selectedProject.visibility,
                                url: selectedProject.web_url,
                                status: selectedProject.archived ? 'archived' : 'active',
                                lastActivity: new Date(selectedProject.last_activity_at)
                                    .toISOString(),
                            },
                            metrics,
                            department: 'engineering',
                            qualityMetricsSource: 'project',
                        },
                    );
                } else {
                    logger.passThrough('log', gitlab.formatProjectMetrics(metrics));
                }

                // After metrics are generated:
                if (options.ingest && options.apiUrl && options.token && selectedProject) {
                    const payload = {
                        eventType: 'project_metrics',
                        timestamp: new Date().toISOString(),
                        period: `${options.days}d`,
                        project: {
                            id: selectedProject.id,
                            name: selectedProject.name,
                            path: selectedProject.path_with_namespace,
                            description: selectedProject.description,
                            visibility: selectedProject.visibility,
                            url: selectedProject.web_url,
                            status: selectedProject.archived ? 'archived' : 'active',
                            lastActivity: new Date(selectedProject.last_activity_at).toISOString(),
                        },
                        metrics,
                        department: 'engineering',
                        qualityMetricsSource: 'project',
                    };
                    try {
                        logger.debug('[ingest] About to send', {
                            apiUrl: options.apiUrl,
                            token: options.token,
                            platform: 'gitlab',
                            payload,
                        });
                        await sendIngestPayload({
                            apiUrl: options.apiUrl,
                            token: options.token,
                            platform: 'gitlab',
                            payload,
                        });
                        logger.passThrough(
                            'log',
                            colors.green('✓ Metrics ingested to Commander4!'),
                        );
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
            } catch (error) {
                logger.error(
                    colors.red(
                        `\n✗ Error fetching metrics: ${
                            error instanceof Error ? error.message : 'Unknown error'
                        }\n`,
                    ),
                );
                Deno.exit(1);
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

// Add help subcommand to dashboard
dashboardCommand.command('help')
    .description('Show help for dashboard command')
    .action(() => {
        logger.passThrough('log', '\nGitLab Dashboard Command\n');
        logger.passThrough('log', 'Usage:');
        logger.passThrough('log', '  nova gitlab dashboard [project_key] [options]');
        logger.passThrough('log', '\nOptions:');
        logger.passThrough(
            'log',
            '  -f, --format            Output format (text/json) [default: text]',
        );
        logger.passThrough(
            'log',
            '  -d, --days <number>     Number of days to analyze [default: 30]',
        );
        logger.passThrough('log', '  -r, --recent            Use most recent project');
        logger.passThrough('log', '  --refresh               Force refresh cached data');
        logger.passThrough('log', '  -q, --query <string>    Search for a project by name');
        logger.passThrough(
            'log',
            '  --mr-limit <number>     Limit number of merge requests to analyze',
        );
        logger.passThrough(
            'log',
            '  --pipeline-limit <number> Limit number of pipelines to analyze',
        );
        logger.passThrough(
            'log',
            '  --team-limit <number>    Limit number of merge requests for team analysis',
        );
        logger.passThrough(
            'log',
            '  --ingest                Send metrics to Commander4',
        );
        logger.passThrough(
            'log',
            '  --api-url <url>         Commander4 API base URL',
        );
        logger.passThrough(
            'log',
            '  --token <token>         Commander4 API token',
        );
        const jsonExamplesString = formatJsonExamples([
            commonJsonExamples.saveToFile('nova gitlab dashboard', 'metrics.json'),
            {
                description: 'Get pipeline metrics',
                command: 'nova gitlab dashboard --format json | jq -r ".metrics.pipelineMetrics"',
            },
            {
                description: 'Get code quality stats',
                command: 'nova gitlab dashboard --format json | jq -r ".metrics.codeQuality"',
            },
            {
                description: 'Export team metrics for analysis',
                command:
                    'nova gitlab dashboard --format json | jq -r ".metrics.teamMetrics" > team-metrics.json',
            },
        ]);
        logger.passThrough('log', jsonExamplesString);
        logger.passThrough('log', '');
    });

// Add commands to main GitLab command
gitlabCommand
    .command('projects', projectsCommand)
    .command('project', projectCommand)
    .command('dashboard', dashboardCommand);
