import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { keypress } from '@cliffy/keypress';
import { Table } from '@cliffy/table';
import type { ProjectSchema } from '@gitbeaker/rest';
import { configManager } from '../../config/mod.ts';
import { GitProviderFactory } from '../services/git_provider_factory.ts';
import { ProgressIndicator } from '../../utils.ts';
import { DevCache } from '../../utils/devcache.ts';
import { logger } from '../../utils/logger.ts';
import { UserCache } from '../../utils/usercache.ts';

interface DashboardOptions {
    format: 'text' | 'json';
    refresh: boolean;
    query?: string;
    limit?: number;
    sort: 'updated' | 'name' | 'activity';
    order: 'asc' | 'desc';
    days: number;
    pipeline: boolean;
}

interface ProjectData {
    project: ProjectSchema;
    activity: {
        openIssues: number;
        openMergeRequests: number;
        lastCommit: { id: string; created_at: string } | null;
        _cached_at?: string;
    };
    summary: {
        latestTag: { name: string; createdAt: string } | null;
        hasChangelog: boolean;
        lastDeployment: { environment: string; deployedAt: string } | null;
        pipeline:
            | { stats: { success: number; failed: number; running: number; total: number } }
            | null;
    };
    lastCommitDate: Date;
    hasFullAccess: boolean;
    isLoading: boolean;
}

// Default to 20 projects in debug mode, 10 in normal mode
const DEFAULT_LIMIT = 20;
const DEFAULT_DAYS = 30;

// Add these constants at the top with other constants
const ITEMS_PER_PAGE = 15;
const MAX_DESC_LENGTH = 30;
const MAX_URL_LENGTH = 60;

// Add cache configuration
const CACHE_CONFIG = {
    basePath: `${Deno.env.get('HOME')}/.cache/nova`,
    serviceName: 'ops-dashboard',
    logger,
    cacheDuration: 24 * 60 * 60 * 1000, // 24 hours for dev cache
};

// Add at the top with other constants
const BATCH_SIZE = 5;

// Add these constants at the top with other constants
const REFRESH_CHECK_INTERVAL = 60000; // Check every 60 seconds
const DATA_STALENESS_THRESHOLD = 5 * 60 * 1000; // Consider data stale after 5 minutes

// Add this interface for the memory cache
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    lastChecked: number;
    lastActivityAt: string;
}

// Update the MEMORY_CACHE type
const MEMORY_CACHE = new Map<string, CacheEntry<ProjectData>>();

// Add cache sync interval
const CACHE_SYNC_INTERVAL = 60000; // Sync to UserCache every minute

async function updateData(
    gitlab: GitLabService,
    options: DashboardOptions,
    _progress: ProgressIndicator,
    projectsWithActivity: ProjectData[],
    _renderDashboard: (projects: ProjectData[]) => void,
    cleanup: () => void,
): Promise<ProjectData[]> {
    const userCache = await UserCache.getInstance();
    const devCache = new DevCache(CACHE_CONFIG);

    // Try to get projects from UserCache first
    let allProjects: ProjectSchema[] = [];
    if (!options.refresh) {
        const userCachedData = await userCache.getCachedProjectsList();
        if (userCachedData) {
            allProjects = userCachedData.projects;
        }
    }

    // If no cached data or refresh requested, fetch from GitLab
    if (allProjects.length === 0 || options.refresh) {
        allProjects = await gitlab.getProjects(options.refresh);

        // Cache the results in UserCache
        if (allProjects.length > 0) {
            await userCache.cacheProjectsList(allProjects);
        }
    }

    if (allProjects.length === 0) {
        return projectsWithActivity; // Return existing list if no new data
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.days);

    // First filter by date and query
    const filteredProjects = allProjects
        .filter((p) => new Date(p.last_activity_at) >= cutoffDate)
        .filter((p) =>
            !options.query ||
            p.name.toLowerCase().includes(options.query.toLowerCase()) ||
            p.path_with_namespace.toLowerCase().includes(options.query.toLowerCase())
        );

    // Sort projects
    const sortedProjects = [...filteredProjects].sort((a, b) => {
        if (options.sort === 'name') {
            return options.order === 'desc'
                ? b.path_with_namespace.localeCompare(a.path_with_namespace)
                : a.path_with_namespace.localeCompare(b.path_with_namespace);
        }
        const aValue = new Date(a.last_activity_at).getTime();
        const bValue = new Date(b.last_activity_at).getTime();
        return options.order === 'desc' ? bValue - aValue : aValue - bValue;
    });

    // Initialize or update projects array with basic data
    const updatedProjects = await Promise.all(sortedProjects.map(async (project) => {
        // Check memory cache first
        const cacheKey = `project_${project.id}`;
        const memCached = MEMORY_CACHE.get(cacheKey);

        if (memCached && !options.refresh) {
            const now = Date.now();
            // Use memory cache if it's fresh (less than 5 minutes old)
            if (now - memCached.timestamp < 5 * 60 * 1000) {
                return memCached.data;
            }
        }

        // Try to get cached activity data from DevCache
        const devCacheKey = `project_activity_${project.id}`;
        const cachedActivity = await devCache.get<ProjectData>(devCacheKey, 'activity');

        if (cachedActivity && !cachedActivity.isLoading && !options.refresh) {
            // Update memory cache
            MEMORY_CACHE.set(cacheKey, {
                data: cachedActivity,
                timestamp: Date.now(),
                lastChecked: Date.now(),
                lastActivityAt: project.last_activity_at,
            });
            return cachedActivity;
        }

        // Create new loading state for this project
        const newProjectData: ProjectData = {
            project,
            activity: {
                openIssues: 0,
                openMergeRequests: 0,
                lastCommit: null,
                _cached_at: undefined,
            },
            summary: {
                latestTag: null,
                hasChangelog: false,
                lastDeployment: null,
                pipeline: null,
            },
            lastCommitDate: new Date(project.last_activity_at),
            hasFullAccess: true,
            isLoading: true,
        };

        // Update memory cache
        MEMORY_CACHE.set(cacheKey, {
            data: newProjectData,
            timestamp: Date.now(),
            lastChecked: Date.now(),
            lastActivityAt: project.last_activity_at,
        });

        return newProjectData;
    }));

    // Set up periodic sync of memory cache to UserCache
    let syncInterval: number | undefined;
    if (!syncInterval) {
        syncInterval = setInterval(async () => {
            try {
                const cacheEntries = Array.from(MEMORY_CACHE.entries());
                const projectsToCache = cacheEntries
                    .filter(([_, entry]) => !entry.data.isLoading)
                    .map(([_, entry]) => entry.data.project);

                if (projectsToCache.length > 0) {
                    await userCache.cacheProjectsList(projectsToCache);
                }
            } catch (error) {
                logger.error('Error syncing memory cache to UserCache:', error);
            }
        }, CACHE_SYNC_INTERVAL);

        // Clean up interval when dashboard is closed
        const originalCleanup = cleanup;
        cleanup = () => {
            clearInterval(syncInterval);
            originalCleanup();
        };
    }

    return updatedProjects;
}

function truncateString(str: string, maxLength: number): string {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
}

function _wrapText(text: string, maxLength: number): string {
    if (!text) return '';

    // Split into words while preserving URLs
    const words = text.split(' ').map((word) => {
        if (word.startsWith('http://') || word.startsWith('https://')) {
            // For URLs, try to break at logical points
            return word.replace(/([\/.])/g, '$1\n').split('\n').filter(Boolean);
        }
        return word;
    }).flat();

    const lines: string[] = [];
    let currentLine = '';

    words.forEach((word) => {
        // If this word would make the line too long, start a new line
        if ((currentLine + ' ' + word).length > maxLength && currentLine) {
            lines.push(currentLine.trim());
            currentLine = word;
        } else {
            currentLine += (currentLine ? ' ' : '') + word;
        }
    });

    if (currentLine) {
        lines.push(currentLine.trim());
    }

    return lines.join('\n');
}

function formatProjectUrl(url: string): string {
    if (!url) return '';

    // Remove protocol and trailing slash
    let formatted = url.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // If still too long, truncate middle
    if (formatted.length > MAX_URL_LENGTH) {
        const start = formatted.substring(0, Math.floor(MAX_URL_LENGTH / 2) - 2);
        const end = formatted.substring(formatted.length - Math.floor(MAX_URL_LENGTH / 2) + 2);
        formatted = `${start}...${end}`;
    }

    return formatted;
}

function formatDescription(desc: string): string {
    if (!desc) return '';

    // Replace emojis with shorter text representation
    const withEmojis = desc.replace(/[\u{1F300}-\u{1F9FF}]/gu, (match) => {
        const emojiMap: Record<string, string> = {
            '📚': '[doc]',
            '👾': '[api]',
            '🔍': '[src]',
            '📦': '[pkg]',
            // Add more emoji mappings as needed
        };
        return emojiMap[match] || ''; // Remove unmapped emojis
    });

    // Truncate and remove newlines
    return truncateString(withEmojis.replace(/\s+/g, ' ').trim(), MAX_DESC_LENGTH);
}

function _renderDashboard(
    projects: ProjectData[],
    options: DashboardOptions,
    selectedIndex: number,
) {
    console.log('\x1b[2J\x1b[H'); // Clear screen

    // Calculate pagination
    const totalItems = projects.length;
    const _totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const currentPage = Math.floor(selectedIndex / ITEMS_PER_PAGE);
    const startIndex = currentPage * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);

    // Create table
    const headers = [
        'Access',
        'Project',
        'Last Updated',
        'Last Deploy',
        'Latest Tag',
        'Activity',
        ...(options.pipeline ? ['Pipeline'] : []),
        'Changelog',
        'Description',
    ];

    const table = new Table()
        .border(true)
        .header(headers)
        .padding(1);

    // Get visible projects for current page
    const visibleProjects = projects.slice(startIndex, endIndex);

    // Process visible projects
    visibleProjects.forEach((projectData, index) => {
        const isSelected = startIndex + index === selectedIndex;
        const rowStyle = isSelected
            ? colors.bgBlue
            : (index % 2 === 0 ? colors.bgBlack : colors.dim);

        const lastUpdated = new Date(projectData.project.last_activity_at);
        const timeAgo = getTimeAgo(lastUpdated);

        // Show loading indicator if data is still loading
        const loadingIndicator = projectData.isLoading ? colors.dim(' (loading...)') : '';

        const formattedUrl = formatProjectUrl(projectData.project.web_url);
        const projectPath = projectData.project.path_with_namespace;
        const projectInfo = colors.blue(formattedUrl) + '\n' +
            colors.green(projectPath) +
            loadingIndicator;

        const lastDeploy = projectData.isLoading
            ? 'Loading...'
            : (projectData.summary.lastDeployment
                ? `${projectData.summary.lastDeployment.environment}\n${
                    getTimeAgo(new Date(projectData.summary.lastDeployment.deployedAt))
                }`
                : projectData.hasFullAccess
                ? 'No deployments'
                : '-');

        let latestTagDisplay;
        if (projectData.isLoading) {
            latestTagDisplay = 'Loading...';
        } else if (projectData.summary.latestTag && projectData.summary.latestTag.name) {
            const tagDate = new Date(projectData.summary.latestTag.createdAt);
            const daysSinceTag = Math.floor(
                (Date.now() - tagDate.getTime()) / (1000 * 60 * 60 * 24),
            );
            const daysSinceUpdate = Math.floor(
                (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24),
            );
            const shouldHighlight = daysSinceTag > 90 && daysSinceUpdate < 30;
            latestTagDisplay = shouldHighlight
                ? colors.yellow(`${projectData.summary.latestTag.name} ⚠️`)
                : projectData.summary.latestTag.name;
        } else {
            latestTagDisplay = projectData.hasFullAccess ? colors.yellow('No tags ⚠️') : '-';
        }

        const activityInfo = projectData.isLoading ? 'Loading...' : (projectData.hasFullAccess
            ? [
                projectData.activity.lastCommit
                    ? `Last: ${projectData.activity.lastCommit.id.substring(0, 8)}`
                    : 'No commits',
                `MRs: ${projectData.activity.openMergeRequests}`,
                `Issues: ${projectData.activity.openIssues}`,
            ].join('\n')
            : 'Limited access');

        const pipelineInfo = projectData.isLoading
            ? 'Loading...'
            : (projectData.hasFullAccess
                ? (projectData.summary.pipeline?.stats
                    ? [
                        colors.green(`${projectData.summary.pipeline.stats.success}✓`),
                        colors.yellow(`${projectData.summary.pipeline.stats.failed}!`),
                        projectData.summary.pipeline.stats.running > 0
                            ? colors.blue(`${projectData.summary.pipeline.stats.running}○`)
                            : '',
                        `${
                            Math.round(
                                (projectData.summary.pipeline.stats.success /
                                    Math.max(projectData.summary.pipeline.stats.total, 1)) * 100,
                            )
                        }%`,
                    ].filter(Boolean).join(' ')
                    : 'No pipelines')
                : '-');

        const changelog = projectData.isLoading
            ? 'Loading...'
            : (projectData.hasFullAccess
                ? (projectData.summary.hasChangelog ? colors.green('✓') : colors.red('✗'))
                : '-');

        const description = formatDescription(projectData.project.description || '');

        const rowData = [
            projectData.hasFullAccess ? colors.green('●') : colors.yellow('◐'),
            projectInfo,
            colors.yellow(timeAgo),
            lastDeploy,
            latestTagDisplay,
            activityInfo,
            ...(options.pipeline ? [pipelineInfo] : []),
            changelog,
            description,
        ];

        // Apply row styling
        const styledRow = rowData.map((cell) => rowStyle(cell));
        table.push(styledRow);
    });

    // Print help and navigation
    console.log(
        colors.blue(
            `\nProjects Dashboard (${totalItems} projects) - Page ${
                currentPage + 1
            }/${_totalPages}`,
        ),
    );
    console.log(
        colors.dim(
            "Navigation: ↑/↓ move cursor, ←/→ or PgUp/PgDn change pages, 'r' refresh, 'q' quit\n",
        ),
    );
    console.log(table.toString());

    // Print status line with more detailed information
    const now = new Date();
    const loadingCount = projects.filter((p) => p.isLoading).length;
    const statusLine = loadingCount > 0
        ? colors.dim(
            `Last updated: ${now.toLocaleTimeString()} (Loading data for ${loadingCount} projects... Page ${
                currentPage + 1
            }/${_totalPages}, showing ${startIndex + 1}-${endIndex} of ${totalItems})`,
        )
        : colors.dim(
            `Last updated: ${now.toLocaleTimeString()} (Page ${
                currentPage + 1
            }/${_totalPages}, showing ${startIndex + 1}-${endIndex} of ${totalItems})`,
        );
    console.log(statusLine);
}

export const dashboardCommand = new Command()
    .name('dashboard')
    .description('Interactive projects dashboard with real-time updates')
    .option('-f, --format <format:string>', 'Output format (text/json)', {
        default: 'text' as const,
        value: (val: string): 'text' | 'json' => {
            if (val !== 'text' && val !== 'json') {
                throw new Error('Format must be either "text" or "json"');
            }
            return val;
        },
    })
    .option('--refresh', 'Force refresh cached data', { default: false })
    .option('-q, --query <string>', 'Filter projects by name or path')
    .option('-l, --limit <number:number>', 'Limit number of projects to show', {
        default: DEFAULT_LIMIT,
    })
    .option('--sort <field:string>', 'Sort by field (updated, name, activity)', {
        default: 'activity' as const,
        value: (val: string): 'updated' | 'name' | 'activity' => {
            if (val !== 'updated' && val !== 'name' && val !== 'activity') {
                throw new Error('Sort must be either "updated", "name", or "activity"');
            }
            return val;
        },
    })
    .option('--order <order:string>', 'Sort order (asc, desc)', {
        default: 'desc' as const,
        value: (val: string): 'asc' | 'desc' => {
            if (val !== 'asc' && val !== 'desc') {
                throw new Error('Order must be either "asc" or "desc"');
            }
            return val;
        },
    })
    .option('-d, --days <number:number>', 'Number of days to look back', { default: DEFAULT_DAYS })
    .option('--pipeline', 'Include pipeline statistics (slower)', { default: false })
    .action(async (options: DashboardOptions) => {
        const _progress = new ProgressIndicator();
        let selectedIndex = 0;
        let isRunning = true;
        let isLoading = false;
        let projectsWithActivity: ProjectData[] = [];

        // Initialize GitLab service
        const config = await configManager.loadConfig();
        const gitProvider = await GitProviderFactory.createFromConfig(config);

        // Initialize cleanup function
        let cleanupFn = () => {
            isRunning = false;
            _progress.stop();
            console.log('\x1b[?25h'); // Show cursor
            console.log('\x1b[2J\x1b[H'); // Clear screen
        };

        // Handle cleanup and exit
        Deno.addSignalListener('SIGINT', () => {
            cleanupFn();
            Deno.exit(0);
        });

        function getVisibleRange(): { startIndex: number; endIndex: number } {
            const currentPage = Math.floor(selectedIndex / ITEMS_PER_PAGE);
            const startIndex = currentPage * ITEMS_PER_PAGE;
            const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, projectsWithActivity.length);
            return { startIndex, endIndex };
        }

        function needsRefresh(projectData: ProjectData): boolean {
            if (projectData.isLoading) return false;

            const now = Date.now();
            const lastUpdated = new Date(projectData.project.last_activity_at).getTime();
            const lastCached = projectData.activity._cached_at
                ? new Date(projectData.activity._cached_at).getTime()
                : 0;

            // If we have no cache, definitely need refresh
            if (!lastCached) {
                return true;
            }

            // If project was recently active (within staleness threshold)
            if (now - lastUpdated < DATA_STALENESS_THRESHOLD) {
                // Only refresh if our cache is older than the refresh interval
                return now - lastCached > REFRESH_CHECK_INTERVAL;
            }

            // For inactive projects, use a longer refresh interval
            return now - lastCached > REFRESH_CHECK_INTERVAL * 2;
        }

        const MAX_CONCURRENT_REQUESTS = 3; // Maximum number of concurrent requests

        async function updateProjectBatch(
            projects: ProjectData[],
            gitlab: GitLabService,
        ): Promise<void> {
            // Filter out projects that don't need updates
            const projectsToUpdate = projects.filter(needsRefresh);

            // Process projects in concurrent batches
            for (let i = 0; i < projectsToUpdate.length; i += MAX_CONCURRENT_REQUESTS) {
                const batch = projectsToUpdate.slice(i, i + MAX_CONCURRENT_REQUESTS);

                await Promise.all(batch.map(async (project) => {
                    try {
                        const [activity, summary] = await Promise.all([
                            gitlab.getProjectActivityLightRest(project.project.id),
                            gitlab.getProjectSummary(project.project, {
                                includeDeployments: true,
                                includePipelines: options.pipeline,
                            }),
                        ]);

                        const index = projectsWithActivity.findIndex((p) =>
                            p.project.id === project.project.id
                        );
                        if (index !== -1) {
                            projectsWithActivity[index] = {
                                ...project,
                                activity: {
                                    openIssues: activity.openIssues,
                                    openMergeRequests: activity.openMergeRequests,
                                    lastCommit: activity.lastCommit ?? null,
                                    _cached_at: new Date().toISOString(),
                                },
                                summary,
                                isLoading: false,
                            };
                        }
                    } catch (error) {
                        logger.error(
                            `Error updating project ${project.project.path_with_namespace}:`,
                            error,
                        );
                        // On error, just mark as not loading but keep existing data
                        const index = projectsWithActivity.findIndex((p) =>
                            p.project.id === project.project.id
                        );
                        if (index !== -1) {
                            projectsWithActivity[index] = {
                                ...projectsWithActivity[index],
                                isLoading: false,
                            };
                        }
                    }
                }));

                // Small delay between batches to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 1000));

                // Re-render after each batch
                _renderDashboard(projectsWithActivity, options, selectedIndex);
            }
        }

        // Create an update controller to manage the update function
        const updateController = {
            updateFn: async (gitlab: GitLabService) => {
                if (isLoading || projectsWithActivity.length === 0) return;

                // Get visible range
                const { startIndex, endIndex } = getVisibleRange();

                // Split projects into visible and non-visible
                const visibleProjects = projectsWithActivity.slice(startIndex, endIndex);
                const nonVisibleProjects = [
                    ...projectsWithActivity.slice(0, startIndex),
                    ...projectsWithActivity.slice(endIndex),
                ];

                // Update visible projects first
                if (visibleProjects.length > 0) {
                    _progress.start('Checking visible projects for updates...');
                    await updateProjectBatch(visibleProjects, gitlab);
                    _progress.stop();
                }

                // Then update non-visible projects that need refresh
                const staleBackgroundProjects = nonVisibleProjects.filter(needsRefresh);
                if (staleBackgroundProjects.length > 0) {
                    for (let i = 0; i < staleBackgroundProjects.length; i += BATCH_SIZE) {
                        const batch = staleBackgroundProjects.slice(i, i + BATCH_SIZE);
                        _progress.start(
                            `Updating background projects (${i + 1}-${
                                Math.min(i + BATCH_SIZE, staleBackgroundProjects.length)
                            } of ${staleBackgroundProjects.length})...`,
                        );
                        await updateProjectBatch(batch, gitlab);
                        _progress.stop();
                    }
                }

                // Always re-render after updates
                _renderDashboard(projectsWithActivity, options, selectedIndex);
            },
        };

        try {
            // Hide cursor and clear screen
            console.log('\x1b[?25l');
            console.log('\x1b[2J\x1b[H');

            // Set up keyboard handling
            const keypressHandler = keypress();

            // Initial render with empty state
            _renderDashboard(projectsWithActivity, options, selectedIndex);

            // Start initial data fetch in background
            (async () => {
                isLoading = true;
                _progress.start('Loading initial project list...');

                const initialProjects = await updateData(
                    gitlab,
                    options,
                    _progress,
                    projectsWithActivity,
                    (projects) => _renderDashboard(projects, options, selectedIndex),
                    () => cleanupFn(),
                );

                if (initialProjects.length > 0) {
                    projectsWithActivity = initialProjects;

                    // Load initial data for visible projects first
                    const { startIndex, endIndex } = getVisibleRange();
                    const visibleProjects = projectsWithActivity.slice(startIndex, endIndex);

                    _progress.start('Loading data for visible projects...');
                    await Promise.all(visibleProjects.map(async (project) => {
                        try {
                            const [activity, summary] = await Promise.all([
                                gitlab.getProjectActivityLightRest(project.project.id),
                                gitlab.getProjectSummary(project.project, {
                                    includeDeployments: true,
                                    includePipelines: options.pipeline,
                                }),
                            ]);

                            const index = projectsWithActivity.findIndex((p) =>
                                p.project.id === project.project.id
                            );
                            if (index !== -1) {
                                projectsWithActivity[index] = {
                                    ...project,
                                    activity: {
                                        openIssues: activity.openIssues,
                                        openMergeRequests: activity.openMergeRequests,
                                        lastCommit: activity.lastCommit ?? null,
                                        _cached_at: new Date().toISOString(),
                                    },
                                    summary,
                                    isLoading: false,
                                };
                            }
                            _renderDashboard(projectsWithActivity, options, selectedIndex);
                        } catch (error) {
                            logger.error(
                                `Error loading initial data for ${project.project.path_with_namespace}:`,
                                error,
                            );
                        }
                    }));
                }

                isLoading = false;
                _progress.stop();

                // Initial update of projects
                await updateController.updateFn(gitlab);

                // Set up interval to periodically check for updates
                const updateInterval = setInterval(async () => {
                    if (!isLoading) {
                        await updateController.updateFn(gitlab);
                    }
                }, REFRESH_CHECK_INTERVAL);

                // Clean up interval on exit
                const originalCleanup = cleanupFn;
                cleanupFn = () => {
                    clearInterval(updateInterval);
                    originalCleanup();
                };
            })();

            // Process keyboard input in the main thread
            while (isRunning) {
                try {
                    const event = await keypressHandler.next();
                    if (!event || !event.value || !isRunning) break;

                    const totalItems = projectsWithActivity.length;
                    const _totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
                    const currentPage = Math.floor(selectedIndex / ITEMS_PER_PAGE);
                    const _oldPage = currentPage;

                    // Handle navigation
                    switch (event.value.sequence) {
                        case '\x1b[A': { // Up arrow
                            selectedIndex = Math.max(0, selectedIndex - 1);
                            break;
                        }

                        case '\x1b[B': { // Down arrow
                            selectedIndex = Math.min(totalItems - 1, selectedIndex + 1);
                            break;
                        }

                        case '\x1b[D': { // Left arrow
                            selectedIndex = Math.max(0, selectedIndex - ITEMS_PER_PAGE);
                            break;
                        }

                        case '\x1b[C': { // Right arrow
                            selectedIndex = Math.min(
                                totalItems - 1,
                                selectedIndex + ITEMS_PER_PAGE,
                            );
                            break;
                        }

                        case 'g': {
                            selectedIndex = 0;
                            break;
                        }

                        case 'G': {
                            selectedIndex = totalItems - 1;
                            break;
                        }

                        case 'q': {
                            cleanupFn();
                            Deno.exit(0);
                            break;
                        }

                        case 'r': {
                            const selectedProject = projectsWithActivity[selectedIndex];
                            if (selectedProject) {
                                // Set loading state immediately
                                projectsWithActivity[selectedIndex] = {
                                    ...selectedProject,
                                    isLoading: true,
                                };
                                _renderDashboard(projectsWithActivity, options, selectedIndex);

                                _progress.start(`Refreshing ${selectedProject.project.name}...`);

                                try {
                                    // Get fresh activity data
                                    const [activity, summary] = await Promise.all([
                                        gitlab.getProjectActivityLightRest(
                                            selectedProject.project.id,
                                        ),
                                        gitlab.getProjectSummary(selectedProject.project, {
                                            includeDeployments: true,
                                            includePipelines: options.pipeline,
                                        }),
                                    ]);

                                    projectsWithActivity[selectedIndex] = {
                                        ...selectedProject,
                                        activity: {
                                            openIssues: activity.openIssues,
                                            openMergeRequests: activity.openMergeRequests,
                                            lastCommit: activity.lastCommit ?? null,
                                            _cached_at: new Date().toISOString(),
                                        },
                                        summary,
                                        isLoading: false,
                                    };

                                    // Update memory cache
                                    const cacheKey = `project_${selectedProject.project.id}`;
                                    MEMORY_CACHE.set(cacheKey, {
                                        data: projectsWithActivity[selectedIndex],
                                        timestamp: Date.now(),
                                        lastChecked: Date.now(),
                                        lastActivityAt: selectedProject.project.last_activity_at,
                                    });

                                    _renderDashboard(projectsWithActivity, options, selectedIndex);
                                } catch (error) {
                                    logger.error(`Error refreshing project: ${error}`);
                                    // On error, revert loading state but keep existing data
                                    projectsWithActivity[selectedIndex] = {
                                        ...selectedProject,
                                        isLoading: false,
                                    };
                                    _renderDashboard(projectsWithActivity, options, selectedIndex);
                                } finally {
                                    _progress.stop();
                                }
                            }
                            break;
                        }
                    }

                    // Ensure selectedIndex stays within bounds
                    selectedIndex = Math.max(0, Math.min(selectedIndex, totalItems - 1));

                    // Always render after any key press
                    _renderDashboard(projectsWithActivity, options, selectedIndex);

                    // Debug output at the bottom
                    logger.debug(
                        colors.bgBlue(
                            `Key pressed: sequence="${event.value.sequence}" key="${event.value.key}"`,
                        ),
                    );
                } catch (error) {
                    logger.error('Error in keyboard handler:', error);
                }
            }
        } catch (error) {
            cleanupFn();
            logger.error(
                'Error in dashboard:',
                error instanceof Error ? error.message : String(error),
            );
            Deno.exit(1);
        }
    });

function getTimeAgo(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `${diffInDays}d ago`;

    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) return `${diffInMonths}mo ago`;

    const diffInYears = Math.floor(diffInMonths / 12);
    return `${diffInYears}y ago`;
}

function _formatPipelineStatus(
    stats: { success: number; failed: number; running: number; total: number },
): string {
    const parts = [];

    if (stats.running > 0) {
        parts.push(colors.blue(`${stats.running}○`));
    }
    if (stats.success > 0) {
        parts.push(colors.green(`${stats.success}✓`));
    }
    if (stats.failed > 0) {
        parts.push(colors.yellow(`${stats.failed}!`));
    }

    if (parts.length === 0) {
        return colors.dim('No pipelines');
    }

    return parts.join(' ') + `\n${Math.round((stats.success / stats.total) * 100)}% success`;
}
