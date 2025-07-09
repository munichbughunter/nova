import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import {
    AccessLevel,
    CommitSchema,
    EnvironmentSchema,
    Gitlab,
    IssueSchema,
    MemberSchema,
    MergeRequestSchema,
    PipelineSchema,
    ProjectSchema,
} from '@gitbeaker/rest';
import { Config } from '../config/mod.ts';
import { DevCache } from '../utils/devcache.ts';
import { Logger } from '../utils/logger.ts';
import { UserCache } from '../utils/usercache.ts';
// Type for GraphQL responses - internal only
interface SearchProjectsResponse {
    data: {
        projects: {
            nodes: Array<{
                id: string;
                name: string;
                fullPath: string;
                description: string;
                webUrl: string;
                visibility: string;
                lastActivityAt: string;
                archived: boolean;
            }>;
        };
    };
}

interface GitLabCommit {
    created_at: string;
}

interface GitLabTag {
    name: string;
    commit: GitLabCommit;
}

interface GitLabTagResponse {
    name: string;
    commit: {
        created_at: string;
    };
}

function _isGitLabCommit(commit: unknown): commit is GitLabCommit {
    return (
        typeof commit === 'object' && 
        commit !== null && 
        'id' in commit &&
        'short_id' in commit &&
        'title' in commit
    );
}

interface GitLabEnvironmentDeployment {
    created_at: string;
}

interface GitLabEnvironment extends Omit<EnvironmentSchema, 'last_deployment'> {
    id: string;
    name: string;
    environmentType: string;
    state: string;
    last_deployment?: {
        created_at: string;
        id?: string;
        finishedAt?: string;
        status?: string;
    } | null;
}

interface GitLabEnvironmentWithDeployment extends GitLabEnvironment {
    last_deployment: {
        created_at: string;
        id?: string;
        finishedAt?: string;
        status?: string;
    };
}

/**
 * GitLabService is a service that provides a client for the GitLab API.
 * It is used to get project metrics, code quality, and other information.
 *
 * @since 0.0.1
 */
export class GitLabService {
    private config: Config;
    private logger: Logger;
    private cache: DevCache;
    private userCache!: UserCache;
    private gitlab!: InstanceType<typeof Gitlab>;
    private readonly maxRecentProjects = 5;
    private initialized = false;

    private queries = {
        getProjectCodeQuality: `
            query GetProjectCodeQuality($fullPath: ID!) {
                project(fullPath: $fullPath) {
                pipelines(first: 40) {
                    nodes {
                    id
                    createdAt
                    finishedAt
                    status
                    duration
                    jobs(first: 30, statuses: SUCCESS) {
                        nodes {
                        name
                        createdAt
                        finishedAt
                        status
                        duration
                        }
                    }
                    }
                }
                environments(first: 100) {
                    pageInfo {
                    hasNextPage
                    endCursor
                    }
                    nodes {
                    id
                    name
                    environmentType
                    state
                    lastDeployment(status: SUCCESS) {
                        id
                        createdAt
                        finishedAt
                        status
                    }
                    }
                }
                codeCoverageSummary {
                    averageCoverage
                }
                securityScanners {
                    enabled
                    available
                }
                }
            }
        `,
        getEnvironmentDeployments: `
            query GetEnvironmentDeployments($fullPath: ID!, $environmentName: String!, $after: String) {
                project(fullPath: $fullPath) {
                environment(name: $environmentName) {
                    name
                    deployments(first: 100, after: $after) {
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        id
                        createdAt
                        finishedAt
                        status
                    }
                    }
                }
                }
            }
        `,
        getMergeRequests: `query GetMergeRequests($fullPath: ID!, $after: Time) {
            project(fullPath: $fullPath) {
            mergeRequests(createdAfter: $after) {
                pageInfo {
                hasNextPage
                endCursor
                }
                nodes {
                id
                iid
                title
                description
                state
                createdAt
                updatedAt
                mergedAt
                closedAt
                webUrl
                author {
                    name
                    username
                }
                assignees {
                    nodes {
                    name
                    username
                    }
                }
                reviewers {
                    nodes {
                    name
                    username
                    }
                }
                approvedBy {
                    nodes {
                    name
                    username
                    }
                }
                labels {
                    nodes {
                    title
                    }
                }
                discussions {
                    nodes {
                    notes {
                        nodes {
                        author {
                            name
                            username
                        }
                            body
                            createdAt
                            system
                        }
                        }
                    }
                    }
                }
                }
            }
            }
        }`,
        getProjectEnvironments: `
        query GetProjectEnvironments($fullPath: ID!) {
            project(fullPath: $fullPath) {
            environments(first: 100) {
                nodes {
                id
                name
                environmentType
                state
                lastDeployment(status: SUCCESS) {
                    id
                    createdAt
                    finishedAt
                    status
                }
                }
            }
            }
        }
        `,
    };

    constructor(config: Config) {
        this.config = config;
        this.logger = new Logger('GitLab', Deno.env.get('NOVA_DEBUG') === 'true');
        this.gitlab = new Gitlab({
            host: this.config.gitlab!.url,
            token: this.config.gitlab!.token,
        });
        // Initialize cache
        this.cache = new DevCache({
            basePath: `${Deno.env.get('HOME')}/.nova/cache`,
            serviceName: 'gitlab',
            logger: this.logger,
        });
    }

    private async initialize(): Promise<void> {
        if (!this.initialized) {
            this.userCache = await UserCache.getInstance();
            this.initialized = true;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    private extractQueryType(key: string): string {
        if (key.includes('/graphql')) {
            return 'graphql';
        } else if (key.includes('/api/v4/')) {
            return 'rest';
        }
        return 'other';
    }

    private async request<T>(
        path: string,
        options: RequestInit & { rawResponse?: boolean } = {},
    ): Promise<T> {
        await this.ensureInitialized();
        try {
            // Skip cache for raw responses
            if (!options.rawResponse) {
                // Try to get from cache first
                const cacheKey = `${path}_${JSON.stringify(options)}`;
                const queryType = this.extractQueryType(path);
                const cached = await this.cache.get<T>(cacheKey, queryType);
                if (cached) {
                    return cached;
                }
            }

            const url = new URL(path, this.config.gitlab!.url);
            const headers = new Headers({
                'PRIVATE-TOKEN': this.config.gitlab!.token,
            });

            const response = await fetch(url, {
                ...options,
                headers: {
                ...Object.fromEntries(headers.entries()),
                ...options.headers,
                },
            });

            // Return raw response if requested
            if (options.rawResponse) {
                return response as unknown as T;
            }

            if (!response.ok) {
                throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Cache successful response
            if (!options.rawResponse) {
                const cacheKey = `${path}_${JSON.stringify(options)}`;
                const queryType = this.extractQueryType(path);
                await this.cache.set(cacheKey, data, queryType);
            }

            return data;
        } catch (error) {
            this.logger.error('Error in request:', error);
            throw error;
        }
    }

    public async clearCache(pattern?: string): Promise<void> {
        await this.ensureInitialized();
        await this.cache.clear(pattern);
    }

    private async graphqlRequest<T>(
        query: string,
        variables?: Record<string, unknown>,
    ): Promise<T> {
        await this.ensureInitialized();
        try {
            // Try to get from cache first
            const cacheKey = `${query}_${JSON.stringify(variables)}`;
            const queryType = this.extractQueryType(query);
            const cached = await this.cache.get<T>(cacheKey, queryType);
            if (cached) {
                return cached;
            }

            const response = await fetch(`${this.config.gitlab!.url}/api/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.gitlab!.token}`,
                },
                body: JSON.stringify({
                    query,
                    variables,
                }),
            });

            if (!response.ok) {
                throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (data.errors) {
                throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
            }

            // Cache successful response
            await this.cache.set(cacheKey, data, queryType);
            return data;
        } catch (error) {
            this.logger.error('GraphQL request failed:', error);
            throw error;
        }
    }

    /**
     * Get project metrics including code quality, MRs, pipeline metrics, and team metrics
     * @param fullPath Project full path
     * @param timeRange Time range for metrics
     * @param forceRefresh Force refresh from API instead of using cache
     * @param options Optional limits for data retrieval
     * @returns Project metrics data
     */
    public async getProjectMetrics(
        fullPath: string,
        timeRange: TimeRange,
        forceRefresh = false,
        options: {
        mrLimit?: number;
        pipelineLimit?: number;
        teamLimit?: number;
        } = {},
    ): Promise<GitLabProjectMetrics> {
        await this.ensureInitialized();
        try {
            // Set default limits
            const mrLimit = options.mrLimit || 100;
            const pipelineLimit = options.pipelineLimit || 50;
            const teamLimit = options.teamLimit || 50;

            // Check cache first unless forced to refresh
            if (!forceRefresh) {
                const cacheKey = `metrics_${fullPath}_${timeRange}`;
                const cached = await this.cache.get<GitLabProjectMetrics>(cacheKey, 'metrics');
                if (cached) {
                    this.logger.debug(`Using cached metrics for ${fullPath}`);
                    return cached;
                }
            }

            // Fetch all data in parallel except environments, time to merge
            const [project, codeQuality, mergeRequests, pipelineMetrics, teamMetrics] = await Promise.all(
                [
                    this.getProjectDetails(fullPath),
                    this.getProjectCodeQualityWithFallback(fullPath),
                    this.getProjectMergeRequests(fullPath, timeRange, mrLimit),
                    this.getProjectPipelineMetrics(fullPath, pipelineLimit),
                    this.getTeamMetrics(fullPath, teamLimit),
                ],
            );

            // reuse mergeRequests
            const timeToMerge = this.getTimeToMergeMetrics(mergeRequests);

            // Always fetch environments fresh
            const envQuery = this.queries.getProjectEnvironments;
            const envResponse = await this.graphqlRequest<
                GitLabGraphQLResponse<{
                    project: {
                        environments: {
                            nodes: GitLabEnvironment[];
                        };
                    };
                }>
            >(envQuery, { fullPath });

            const environments = envResponse?.data?.project?.environments?.nodes || [];

            // Add to recent projects
            await this.addToRecentProjects(project);

            // Calculate deployment frequency metrics first
            const deploymentFrequency = await this.calculateDeploymentFrequency(environments, fullPath);

            // Build metrics object
            const metrics: GitLabProjectMetrics = {
                project,
                codeQuality: {
                    ...codeQuality,
                    deploymentFrequency: deploymentFrequency.deploymentsPerDay,
                    hasAiReview: codeQuality.hasAiReview,
                    hasLoadTesting: codeQuality.hasLoadTesting,
                    hasRenovate: codeQuality.hasRenovate,
                    hasSecretScanning: codeQuality.hasSecretScanning,
                    coverage: codeQuality.coverage,
                    grade: codeQuality.grade,
                    hasTests: codeQuality.hasTests,
                    environments: { nodes: environments },
                },
                mergeRequests: {
                    open: mergeRequests.filter((mr) => mr.state === 'opened'),
                    merged: mergeRequests.filter((mr) => mr.state === 'merged'),
                    closed: mergeRequests.filter((mr) => mr.state === 'closed'),
                },
                pipelineMetrics: {
                    successRate: pipelineMetrics.successRate,
                    averageDuration: pipelineMetrics.averageDuration,
                    running: pipelineMetrics.running,
                    succeeded: pipelineMetrics.succeeded,
                    failed: pipelineMetrics.failed,
                    timeframe: pipelineMetrics.timeframe,
                },
                teamMetrics: {
                    averageTimeToMerge: timeToMerge.averageTimeToMerge,
                    averageTimeToFirstReview: timeToMerge.averageTimeToFirstReview,
                    averageCommentsPerMR: timeToMerge.averageCommentsPerMR,
                    reviewParticipation: teamMetrics.reviewParticipation,
                    codeReviewTurnaround: teamMetrics.codeReviewTurnaround,
                    totalCommits: teamMetrics.topContributors.reduce((sum, c) => sum + c.commits, 0),
                    activeContributors: teamMetrics.topContributors.length,
                    topContributors: teamMetrics.topContributors,
                },
            };

            // Cache the metrics if not a forced refresh
            if (!forceRefresh) {
                const cacheKey = `metrics_${fullPath}_${timeRange}`;
                await this.cache.set(cacheKey, metrics, 'metrics');
            }

            return metrics;
        } catch (error) {
            this.logger.error('Error fetching project metrics:', error);
            throw error;
        }
    }

    /**
     * Get all projects the user has access to with caching support
     */
    public async getProjects(forceRefresh = false): Promise<ProjectSchema[]> {
        try {
            // Ensure userCache is initialized
            await this.ensureInitialized();

            // Check if we have a cached project list
            const cachedData = await this.userCache.getCachedProjectsList();
            if (cachedData && !forceRefresh) {
                const { projects, timestamp } = cachedData;
                const now = new Date();
                const diff = now.getTime() - timestamp.getTime();
                const hours = diff / (1000 * 60 * 60);

                // If cached data is less than 72 hour old, use it
                if (hours < 72) {
                    this.logger.debug('Using cached projects list', projects.length);
                    return projects;
                }
            }

            // Otherwise, get fresh data
            const rawProjects = await this.gitlab.Projects.all({ membership: true });
            this.logger.debug('Got projects from GitLab API', rawProjects.length);

            // Convert to ProjectSchema if needed (gitbeaker sometimes returns camelCase properties)
            const projects = rawProjects.map((project) => {
                if (this.isFullProjectSchema(project)) {
                    return project as ProjectSchema;
                }
                return this.convertToProjectSchema(project);
            });

            // Cache the projects for future use
            await this.userCache.cacheProjectsList(projects);

            return projects;
        } catch (error) {
            this.logger.error('Failed to get projects:', error);
            return [];
        }
    }

    /**
     * Check if an object is a complete ProjectSchema
     */
    private isFullProjectSchema(project: Record<string, unknown>): boolean {
        return 'path_with_namespace' in project &&
        'web_url' in project &&
        'last_activity_at' in project &&
        'namespace' in project;
    }

    /**
     * Convert a partial project object to ProjectSchema format
     */
    private convertToProjectSchema(project: Record<string, unknown>): ProjectSchema {
        // Handle cases where gitbeaker returns camelCase properties
        // Map them to the expected snake_case format for ProjectSchema
        return {
            id: project.id as number,
            name: project.name as string,
            path: project.path as string,
            path_with_namespace: (project.path_with_namespace || project.pathWithNamespace) as string,
            description: project.description as string,
            web_url: (project.web_url || project.webUrl) as string,
            avatar_url: (project.avatar_url || project.avatarUrl) as string,
            star_count: (project.star_count || project.starCount) as number,
            forks_count: (project.forks_count || project.forksCount) as number,
            last_activity_at: (project.last_activity_at || project.lastActivityAt) as string,
            namespace: project.namespace as Record<string, unknown>,
            archived: project.archived as boolean,
            visibility: project.visibility as string,
            issues_enabled: (project.issues_enabled || project.issuesEnabled) as boolean,
            merge_requests_enabled: (project.merge_requests_enabled || project.mergeRequestsEnabled) as boolean,
            wiki_enabled: (project.wiki_enabled || project.wikiEnabled) as boolean,
            jobs_enabled: (project.jobs_enabled || project.jobsEnabled) as boolean,
            snippets_enabled: (project.snippets_enabled || project.snippetsEnabled) as boolean,
            empty_repo: (project.empty_repo || project.emptyRepo) as boolean,
            default_branch: (project.default_branch || project.defaultBranch) as string,
            open_issues_count: (project.open_issues_count || project.openIssuesCount) as number,
            // Add any other properties that might be missing
            ...project,
        } as ProjectSchema;
    }

    /**
     * Get detailed information about a specific project
     */
    async getProjectDetails(fullPath: string): Promise<ProjectSchema> {
        const projects = await this.getProjects();
        const project = projects.find((p) => p.path_with_namespace === fullPath);
        if (!project) {
            throw new Error('Project not found');
        }
        return project;
    }

    private async processEnvironments(
        envs: GitLabEnvironment[],
        projectPath: string,
    ): Promise<EnvironmentMetrics[]> {
        const metrics: EnvironmentMetrics[] = [];

        for (const env of envs) {
            try {
                const deployments = await this.getEnvironmentDeploymentsForEnv(projectPath, env.name);

                // Get the most recent deployment date
                let lastDeployedAt: Date | undefined;
                if (deployments.length > 0) {
                    const mostRecent = deployments.reduce((latest, current) => {
                        const latestDate = new Date(latest.createdAt).getTime();
                        const currentDate = new Date(current.createdAt).getTime();
                        return currentDate > latestDate ? current : latest;
                    }, deployments[0]);

                    lastDeployedAt = new Date(mostRecent.createdAt);
                }

                metrics.push({
                    name: env.name,
                    deployments: deployments.length,
                    lastDeployedAt,
                });
            } catch (error) {
                this.logger.error(`Error processing environment ${env.name}:`, error);
                metrics.push({
                    name: env.name,
                    deployments: 0,
                });
            }
        }

        return metrics;
    }

    private async getProjectCodeQuality(fullPath: string): Promise<GitLabCodeQuality> {
        try {
            const path = typeof fullPath === 'object'
                ? (fullPath as ProjectSchema).path_with_namespace
                : fullPath;

            const query = this.queries.getProjectCodeQuality;
            const variables = { fullPath: path };

            const response = await this.graphqlRequest<
                GitLabGraphQLResponse<{
                    project: {
                        pipelines: {
                            nodes: PipelineNode[];
                        };
                        environments: {
                            pageInfo: GitLabPageInfo;
                            nodes: GitLabEnvironment[];
                        };
                        codeCoverageSummary?: {
                            averageCoverage: number;
                        };
                        securityScanners?: {
                            enabled: string[];
                            available: string[];
                        };
                    };
                }>
            >(query, variables);

            if (!response?.data?.project) {
                throw new Error('Invalid response format from GitLab API');
            }

            const project = response.data.project;

            // Get coverage from code coverage summary
            const coverage = project.codeCoverageSummary?.averageCoverage || 0;
            const hasTests = coverage > 0; // If we have coverage, we must have tests

            // Process pipeline jobs
            const jobs = project.pipelines?.nodes?.flatMap((p) => p.jobs?.nodes || []) || [];

            // Get documentation checks which includes file checks
            const docChecks = await this.checkDocumentation(path, 'master');

            // Enhanced tools detection
            const hasAiReviewer = docChecks.hasGitlabCI && (
                jobs.some((job) => job.name.toLowerCase().includes('ai-review')) ||
                docChecks.hasFile('.gitlab/ai-review.yml') ||
                docChecks.hasFile('.mergequeue')
            );

            const hasLoadTesting = docChecks.hasFile('k6.js') ||
                docChecks.hasFile('artillery.yml') ||
                docChecks.hasFile('load-test/') ||
                docChecks.hasFile('loadtest/') ||
                docChecks.hasFile('performance/') ||
                (docChecks.hasGitlabCI && jobs.some((job) => job.name.toLowerCase().includes('load-test')));

            const hasRenovate = docChecks.hasFile('renovate.json') ||
                docChecks.hasFile('.renovaterc') ||
                docChecks.hasFile('.renovaterc.json') ||
                docChecks.hasFile('.gitlab/renovate.json');

            const hasSecretScanning = project.securityScanners?.enabled?.includes('secret_detection') ||
                jobs.some((job) => job.name.includes('Credentials')) ||
                docChecks.hasFile('.gitlab/secret-detection.yml');

            return {
                grade: this.calculateGrade(coverage),
                coverage,
                bugs: 0,
                vulnerabilities: 0,
                codeSmells: 0,
                securityHotspots: project.securityScanners?.available?.length || 0,
                ...docChecks,
                hasTests,
                hasAiReview: hasAiReviewer,
                hasLoadTesting,
                hasRenovate,
                hasSecretScanning,
                environments: {
                    nodes: project.environments.nodes,
                },
            };
        } catch (error) {
            this.logger.error('Error fetching project code quality:', error);
            throw error;
        }
    }

    private calculateGrade(coverage: number): string {
        if (coverage >= 80) {
            return 'A';
        } else if (coverage >= 60) {
            return 'B';
        } else if (coverage >= 40) {
            return 'C';
        } else if (coverage >= 20) {
            return 'D';
        } else {
            return 'E';
        }
    }

    private calculatePipelineMetrics(pipelineNodes: PipelineNode[]): PipelineMetrics {
        const totalPipelines = pipelineNodes.length;
        const succeededPipelines = pipelineNodes.filter((p) => p.status === 'SUCCESS').length;
        const failedPipelines = pipelineNodes.filter((p) => p.status === 'FAILED').length;
        const runningPipelines = pipelineNodes.filter((p) => p.status === 'RUNNING').length;
        const successRate = totalPipelines > 0 ? (succeededPipelines / totalPipelines) * 100 : 0;
        const averageDuration = totalPipelines > 0
        ? pipelineNodes.reduce((sum, p) => sum + p.duration, 0) / totalPipelines
        : 0;

        return {
            pipelines: {
                nodes: pipelineNodes,
            },
            successRate,
            averageDuration,
            running: runningPipelines,
            succeeded: succeededPipelines,
            failed: failedPipelines,
        };
    }

    private async calculateDeploymentFrequency(
        environments: GitLabEnvironment[],
        projectPath: string,
    ): Promise<DeploymentFrequencyMetrics> {
        // Process environments and get their deployments
        const envMetrics = await this.processEnvironments(environments, projectPath);

        // Calculate total deployments
        const totalDeployments = envMetrics.reduce((sum, env) => sum + env.deployments, 0);

        // Find the oldest and newest deployments to calculate timeframe
        const deploymentDates = envMetrics
        .map((env) => env.lastDeployedAt)
        .filter((date): date is Date => date !== undefined)
        .sort((a, b) => a.getTime() - b.getTime());

        const oldestDeployment = deploymentDates[0];
        const newestDeployment = deploymentDates[deploymentDates.length - 1];

        // Calculate deployments per day
        let deploymentsPerDay = 0;
        if (oldestDeployment && newestDeployment) {
            const daysDiff = Math.max(
                1,
                Math.ceil(
                (newestDeployment.getTime() - oldestDeployment.getTime()) / (1000 * 60 * 60 * 24),
                ),
            );
            deploymentsPerDay = totalDeployments / daysDiff;
        }

        // Determine DORA performance level
        let rating: 'elite' | 'high' | 'medium' | 'low' = 'low';
        if (deploymentsPerDay >= 1) {
            rating = 'elite';
        } else if (deploymentsPerDay >= 0.1) {
            rating = 'high';
        } else if (deploymentsPerDay >= 0.01) {
            rating = 'medium';
        }

        // Group environments by type
        const prodEnvs = envMetrics.filter((env) => this.isProductionEnvironment(env.name));
        const stagingEnvs = envMetrics.filter((env) => this.isStagingEnvironment(env.name));
        const devEnvs = envMetrics.filter((env) =>
            !this.isProductionEnvironment(env.name) && !this.isStagingEnvironment(env.name)
        );

        return {
            deploymentsPerDay,
            deploymentsTotal: totalDeployments,
            rating,
            environmentBreakdown: {
                production: {
                    environments: prodEnvs.map((env) => ({ name: env.name, deployments: env.deployments })),
                    total: prodEnvs.reduce((sum, env) => sum + env.deployments, 0),
                },
                staging: {
                    environments: stagingEnvs.map((env) => ({
                        name: env.name,
                        deployments: env.deployments,
                    })),
                    total: stagingEnvs.reduce((sum, env) => sum + env.deployments, 0),
                },
                development: {
                    environments: devEnvs.map((env) => ({ name: env.name, deployments: env.deployments })),
                    total: devEnvs.reduce((sum, env) => sum + env.deployments, 0),
                },
            },
            total: totalDeployments,
            perDay: deploymentsPerDay,
            byEnvironment: envMetrics,
            performanceLevel: rating,
        };
    }

    private getProjectCodeQualityWithFallback(fullPath: string): Promise<GitLabCodeQuality> {
        return this.getProjectCodeQuality(fullPath).catch(() => {
        // Return default values if the actual call fails
            return {
                grade: 'N/A',
                coverage: 0,
                bugs: 0,
                vulnerabilities: 0,
                codeSmells: 0,
                securityHotspots: 0,
                hasTests: false,
                hasAiReview: false,
                hasLoadTesting: false,
                hasRenovate: false,
                hasSecretScanning: false,
                hasJobArtifacts: false,
                totalArtifacts: 0,
                averageJobDuration: 0,
                deploymentFrequency: 0,
                defaultBranch: 'main',
                environments: {
                    nodes: [],
                },
                hasReadme: false,
                hasContributing: false,
                hasChangelog: false,
                hasLicense: false,
                hasSecurityPolicy: false,
                hasCodeOwners: false,
                hasGitlabCI: false,
                hasPackageJson: false,
                hasComposerJson: false,
                hasRequirementsTxt: false,
                hasGoMod: false,
                hasCargoToml: false,
                hasPomXml: false,
                hasBuildGradle: false,
                hasDockerfile: false,
                hasDockerCompose: false,
                hasPhpUnit: false,
                hasJestConfig: false,
                hasCypress: false,
                hasKarmaConfig: false,
                hasPytestIni: false,
                hasSonarProject: false,
                hasEditorConfig: false,
                hasPrettierrc: false,
                hasEslintrc: false,
                hasGitignore: false,
                hasEnvExample: false,
                hasTerraform: false,
                hasHelmfile: false,
                hasCopilotInstructions: false,
            };
        });
    }

    private async checkDocumentation(
        fullPath: string,
        _defaultBranch: string,
    ): Promise<DocumentationCheckResponse> {
        try {
            // If fullPath is an object, extract the actual path
            const path = typeof fullPath === 'object' ? (fullPath as GitLabProject).fullPath : fullPath;

            const query = `
                query GetProjectTree($fullPath: ID!, $path: String) {
                project(fullPath: $fullPath) {
                    repository {
                    tree(path: $path) {
                        blobs {
                        nodes {
                            name
                            path
                        }
                        }
                        trees {
                        nodes {
                            name
                            path
                        }
                        }
                    }
                    }
                }
                }
            `;

            // First get the root tree
            const rootResponse = await this.graphqlRequest<DocumentationCheckQueryResponse>(query, {
                fullPath: path,
                path: null,
            });

            if (!rootResponse?.data?.project) {
                throw new Error('Project not found');
            }

            // Add null/undefined checks for repository and tree properties
            if (!rootResponse.data.project.repository || !rootResponse.data.project.repository.tree) {
                return {
                    hasReadme: false,
                    hasContributing: false,
                    hasChangelog: false,
                    hasLicense: false,
                    hasSecurityPolicy: false,
                    hasCodeOwners: false,
                    hasGitlabCI: false,
                    hasPackageJson: false,
                    hasComposerJson: false,
                    hasRequirementsTxt: false,
                    hasGoMod: false,
                    hasCargoToml: false,
                    hasPomXml: false,
                    hasBuildGradle: false,
                    hasDockerfile: false,
                    hasDockerCompose: false,
                    hasPhpUnit: false,
                    hasJestConfig: false,
                    hasCypress: false,
                    hasKarmaConfig: false,
                    hasPytestIni: false,
                    hasSonarProject: false,
                    hasEditorConfig: false,
                    hasPrettierrc: false,
                    hasEslintrc: false,
                    hasGitignore: false,
                    hasEnvExample: false,
                    hasTerraform: false,
                    hasHelmfile: false,
                    hasCopilotInstructions: false,
                    hasFile: () => false,
                    hasTests: false,
                    hasAiReview: false,
                    hasLoadTesting: false,
                    hasRenovate: false,
                    hasSecretScanning: false,
                    hasJobArtifacts: false,
                    totalArtifacts: 0,
                    averageJobDuration: 0,
                    deploymentFrequency: 0,
                    defaultBranch: 'main',
                    environments: { nodes: [] },
                };
            }

            const rootBlobs = rootResponse.data.project.repository.tree.blobs?.nodes || [];
            const rootTrees = rootResponse.data.project.repository.tree.trees?.nodes || [];
            let allPaths = [...rootBlobs, ...rootTrees].map((node) => node.path);

            // If we have a .github directory, fetch its contents
            if (allPaths.includes('.github')) {
                const githubResponse = await this.graphqlRequest<DocumentationCheckQueryResponse>(query, {
                    fullPath: path,
                    path: '.github',
                });

                if (githubResponse?.data?.project?.repository?.tree) {
                    const githubBlobs = githubResponse.data.project.repository.tree.blobs?.nodes || [];
                    const githubTrees = githubResponse.data.project.repository.tree.trees?.nodes || [];
                    const githubPaths = [...githubBlobs, ...githubTrees].map((node) => node.path);
                    allPaths = [...allPaths, ...githubPaths];
                }
            }

            // Helper function to check if a file exists (case insensitive)
            const hasFile = (filePath: string): boolean => {
                const lowerFilePath = filePath.toLowerCase();
                return allPaths.some((path) => {
                    const lowerPath = path.toLowerCase();
                    return lowerPath === lowerFilePath || // Exact match
                    lowerPath.endsWith('/' + lowerFilePath) || // File in any directory
                    (filePath.endsWith('/') && lowerPath.startsWith(lowerFilePath)); // Directory check
                });
            };

            return {
                hasReadme: hasFile('readme.md'),
                hasContributing: hasFile('contributing.md'),
                hasChangelog: hasFile('changelog.md'),
                hasLicense: hasFile('license'),
                hasSecurityPolicy: hasFile('security.md'),
                hasCodeOwners: hasFile('codeowners') || hasFile('.gitlab/codeowners'),
                hasGitlabCI: hasFile('.gitlab-ci.yml'),
                hasPackageJson: hasFile('package.json'),
                hasComposerJson: hasFile('composer.json'),
                hasRequirementsTxt: hasFile('requirements.txt'),
                hasGoMod: hasFile('go.mod'),
                hasCargoToml: hasFile('cargo.toml'),
                hasPomXml: hasFile('pom.xml'),
                hasBuildGradle: hasFile('build.gradle'),
                hasDockerfile: hasFile('dockerfile'),
                hasDockerCompose: hasFile('docker-compose.yml'),
                hasPhpUnit: hasFile('phpunit.xml'),
                hasJestConfig: hasFile('jest.config.js'),
                hasCypress: hasFile('cypress.json'),
                hasKarmaConfig: hasFile('karma.conf.js'),
                hasPytestIni: hasFile('pytest.ini'),
                hasSonarProject: hasFile('sonar-project.properties'),
                hasEditorConfig: hasFile('.editorconfig'),
                hasPrettierrc: hasFile('.prettierrc'),
                hasEslintrc: hasFile('.eslintrc'),
                hasGitignore: hasFile('.gitignore'),
                hasEnvExample: hasFile('.env.example'),
                hasTerraform: hasFile('.tf'),
                hasHelmfile: hasFile('helmfile.yaml'),
                hasCopilotInstructions: hasFile('.github/copilot-instructions.md') ||
                hasFile('.github/copilot.md'),
                hasFile,
                // Add missing required properties
                hasTests: false,
                hasAiReview: false,
                hasLoadTesting: false,
                hasRenovate: false,
                hasSecretScanning: false,
                hasJobArtifacts: false,
                totalArtifacts: 0,
                averageJobDuration: 0,
                deploymentFrequency: 0,
                defaultBranch: 'main',
                environments: { nodes: [] },
            };
        } catch (error) {
            this.logger.error('Error checking documentation:', error);
            throw error;
        }
    }

    /**
     * Get recently viewed projects
     */
    async getRecentProjects(): Promise<ProjectSchema[]> {
        try {
            await this.ensureInitialized();
            const recentProjects = await this.userCache.getRecentProjects();

            // The recentProjects are already in ProjectSchema format
            return recentProjects;
        } catch (error) {
            this.logger.error('Failed to get recent projects:', error);
            return [];
        }
    }

    /**
     * Add a project to recent projects list
     */
    private async addToRecentProjects(project: ProjectSchema): Promise<void> {
        await this.ensureInitialized();
        await this.userCache.addRecentProject(project);
    }

    /**
     * Helper function to check if environment name indicates production
     */
    private isProductionEnvironment(name: string): boolean {
        const lowercaseName = name.toLowerCase();
        // Expanded production environment patterns
        const productionPatterns = [
            '^prd$', // Exact match for 'prd'
            '^prod$', // Exact match for 'prod'
            '^production$', // Exact match for 'production'
            '^prod-[a-z0-9-]+$', // prod-anything
            '^prod_[a-z0-9_]+$', // prod_anything
            '^live$', // Exact match for 'live'
            '^main$', // Exact match for 'main'
            'production', // Contains production
            'live-[a-z0-9-]+', // live-anything
        ];

        return productionPatterns.some((pattern) => new RegExp(pattern).test(lowercaseName));
    }

    /**
     * Helper function to check if environment name indicates staging
     */
    private isStagingEnvironment(name: string): boolean {
        const lowercaseName = name.toLowerCase();
        // Expanded staging environment patterns
        const stagingPatterns = [
            '^stg$', // Exact match for 'stg'
            '^stage$', // Exact match for 'stage'
            '^staging$', // Exact match for 'staging'
            '^stg-[a-z0-9-]+$', // stg-anything
            '^stage-[a-z0-9-]+$', // stage-anything
            '^uat$', // User Acceptance Testing
            '^qa$', // Quality Assurance
            '^test$', // Test environment
            'staging', // Contains staging
            'preprod', // Pre-production
        ];
        return stagingPatterns.some((pattern) => new RegExp(pattern).test(lowercaseName));
    }

    private getProjectStatusEmoji(project: GitLabProject): string {
        return project.archived ? '🔴 Archived' : '🟢 Active';
    }

    private getHealthIndicator(value: boolean): string {
        return value ? '✅' : '🚧';
    }

    private getPipelineHealthIndicator(successRate: number): string {
        if (successRate >= 80) return '🟢';
        if (successRate >= 60) return '🟡';
        return '🔴';
    }

    private getQualityIndicator(grade: string): string {
        switch (grade) {
            case 'A':
                return '🟢';
            case 'B':
                return '🟡';
            default:
                return '🔴';
        }
    }

    private getCoverageIndicator(coverage: number): string {
        if (coverage >= 80) return '🟢';
        if (coverage >= 60) return '🟡';
        return '🔴';
    }

    private getParticipationIndicator(participation: number): string {
        if (participation >= 0.8) return '🟢';
        if (participation >= 0.6) return '🟡';
        return '🔴';
    }

    private countEnabledFeatures(codeQuality: GitLabCodeQuality): number {
        return [
            codeQuality.hasAiReview,
            codeQuality.hasLoadTesting,
            codeQuality.hasRenovate,
            codeQuality.hasSecretScanning,
        ].filter(Boolean).length;
    }

    public async getProjectMergeRequests(
        projectPath: string,
        _timeRange: TimeRange,
        limit: number = 100, // Default limit of MRs to fetch
    ): Promise<GitLabMergeRequest[]> {
        try {
            // TODO: to use timerange params
            // Calculate the date for 84 days ago (6 sprints)
            const date = new Date();
            date.setDate(date.getDate() - 84);

            // Use string for the query parameter instead of assigning to TimeRange
            const dateString = date.toISOString();

            interface MergeRequestsGraphQLResponse {
                data: {
                    project: {
                        mergeRequests: {
                            nodes: GitLabMergeRequestBase[];
                            pageInfo: GitLabPageInfo;
                        };
                    };
                };
            }

            const response: GitLabGraphQLResponse<MergeRequestsGraphQLResponse> = await this
                .graphqlRequest(
                this.queries.getMergeRequests,
                { fullPath: projectPath, after: dateString, first: limit },
                );

            // @ts-ignore : TODO: fix this
            if (!response?.data?.project?.mergeRequests?.nodes) {
                throw new Error('Invalid response format from GitLab API');
            }

            // @ts-ignore : TODO: fix this
            const { nodes, _pageInfo } = response.data.project.mergeRequests;

            this.logger.debug(
                `Retrieved ${nodes.length} merge requests for ${projectPath} (limit: ${limit})`,
            );

            // Transform and return merge requests
            return nodes.map((mr: GitLabMergeRequestBase) => this.convertMergeRequestFromAPI(mr));
        } catch (error) {
            this.logger.error('Error fetching merge requests:', error);
            throw error;
        }
    }

    private convertMergeRequestFromAPI(mr: GitLabMergeRequestBase): GitLabMergeRequest {
        return {
        id: mr.id,
        iid: parseInt(mr.iid),
        title: mr.title,
        description: mr.description,
        state: mr.state,
        web_url: mr.webUrl,
        source_branch: mr.sourceBranch,
        target_branch: mr.targetBranch,
        created_at: mr.createdAt,
        updated_at: mr.updatedAt,
        author: mr.author,
        reviewers: mr.reviewers,
        approved: mr.approved,
        approvedBy: mr.approvedBy,
        assignees: mr.assignees,
        labels: mr.labels,
        discussions: mr.discussions,
        changes: [],
        };
    }

    /**
     * Get time to merge metrics for a project
     */
    private getTimeToMergeMetrics(mergeRequests: GitLabMergeRequest[]): {
        averageTimeToMerge: number;
        averageTimeToFirstReview: number;
        averageCommentsPerMR: number;
    } {
        try {
            const mergedMRs = mergeRequests.filter((mr) => mr.state === 'merged');

            if (mergedMRs.length === 0) {
                return {
                    averageTimeToMerge: 0,
                    averageTimeToFirstReview: 0,
                    averageCommentsPerMR: 0,
                };
            }

            // Calculate metrics
            const timeToMerge = mergedMRs.reduce((sum, mr) => {
                const created = new Date(mr.created_at);
                const merged = new Date(mr.updated_at);
                return sum + (merged.getTime() - created.getTime());
            }, 0) / mergedMRs.length;

            const timeToFirstReview = mergedMRs.reduce((sum, mr) => {
                const created = new Date(mr.created_at);
                const firstReview = mr.discussions?.nodes?.find((d) => d.notes.nodes.some((n) => !n.system))
                ?.notes.nodes.find((n) => !n.system)?.created_at;

                if (!firstReview) return sum;
                return sum + (new Date(firstReview).getTime() - created.getTime());
            }, 0) / mergedMRs.length;

            const commentsPerMR = mergedMRs.reduce((sum, mr) => {
                return sum +
                (mr.discussions?.nodes?.reduce(
                    (total, d) => total + (d.notes.nodes.filter((n) => !n.system).length),
                    0,
                ) || 0);
            }, 0) / mergedMRs.length;

            return {
                averageTimeToMerge: timeToMerge / (1000 * 60 * 60), // Convert to hours
                averageTimeToFirstReview: timeToFirstReview / (1000 * 60 * 60), // Convert to hours
                averageCommentsPerMR: commentsPerMR,
            };
        } catch (error) {
            this.logger.error('Error calculating time to merge metrics:', error);
            throw error;
        }
    }

    /**
     * Get team metrics for a project
     * @param fullPath Project path
     * @param limit Maximum number of merge requests to analyze (default: 50)
     */
    private async getTeamMetrics(
        fullPath: string,
        limit: number = 50,
    ): Promise<{
        reviewParticipation: number;
        codeReviewTurnaround: number;
        topContributors: Array<{
        username: string;
        commits: number;
        mergeRequests: number;
        reviews: number;
        }>;
    }> {
        try {
            const query = `query GetTeamMetrics($fullPath: ID!, $mrLimit: Int!) {
                project(fullPath: $fullPath) {
                projectMembers {
                    nodes {
                    user {
                        username
                        name
                    }
                    }
                }
                mergeRequests(last: $mrLimit) {
                    nodes {
                    author {
                        username
                    }
                    reviewers {
                        nodes {
                        username
                        }
                    }
                    discussions {
                        nodes {
                        notes {
                            nodes {
                            author {
                                username
                            }
                            system
                            }
                        }
                        }
                    }
                    }
                }
                }
            }`;

            const response = await this.graphqlRequest<GitLabGraphQLResponse<GitLabTeamMetricsResponse>>(
                query,
                { fullPath, mrLimit: limit },
            );

            if (!response?.data?.project) {
                throw new Error('Project not found');
            }

            const project = response.data.project;
            const users = project.projectMembers.nodes.map((node) => node.user);
            const mrs = project.mergeRequests.nodes;

            // Calculate contributor metrics
            const contributorStats = new Map<string, ContributorStats>();

            // Initialize stats for all team members
            users.forEach((user) => {
                contributorStats.set(user.username, {
                    username: user.username,
                    commits: 0,
                    mergeRequests: 0,
                    reviews: 0,
                });
            });

            // Process merge requests
            mrs.forEach((mr) => {
                // Count MRs authored
                const authorStats = contributorStats.get(mr.author.username) || {
                    username: mr.author.username,
                    commits: 0,
                    mergeRequests: 0,
                    reviews: 0,
                };
                authorStats.mergeRequests++;
                contributorStats.set(mr.author.username, authorStats);

                // Track unique reviewers
                const reviewers = new Set<string>();

                // Add assigned reviewers
                mr.reviewers.nodes.forEach((reviewer) => {
                    reviewers.add(reviewer.username);
                });

                // Add comment authors as reviewers
                mr.discussions.nodes.forEach((discussion) => {
                    discussion.notes.nodes
                    .filter((note) => !note.system)
                    .forEach((note) => {
                        if (note.author.username !== mr.author.username) {
                            reviewers.add(note.author.username);
                        }
                    });
                });

                // Update review counts
                reviewers.forEach((username) => {
                const reviewerStats = contributorStats.get(username) || {
                    username,
                    commits: 0,
                    mergeRequests: 0,
                    reviews: 0,
                };
                reviewerStats.reviews++;
                contributorStats.set(username, reviewerStats);
                });
            });

            // Calculate review participation
            const totalTeamMembers = users.length;
            const reviewingMembers = Array.from(contributorStats.values())
                .filter((member) => member.reviews > 0).length;

            // Calculate review participation as a percentage
            const reviewParticipation = totalTeamMembers > 0 ? (reviewingMembers / totalTeamMembers) : 0;

            // Sort contributors by total activity
            const topContributors = Array.from(contributorStats.values())
                .sort((a, b) => (b.mergeRequests + b.reviews) - (a.mergeRequests + a.reviews))
                .slice(0, 10);

            return {
                reviewParticipation,
                codeReviewTurnaround: 0, // This would require additional API calls to calculate accurately
                topContributors,
            };
        } catch (error) {
            this.logger.error('Error calculating team metrics:', error);
            throw error;
        }
    }

    /**
     * Get pipeline metrics for a project
     * @param fullPath Project path
     * @param limit Maximum number of pipelines to analyze (default: 50)
     */
    private async getProjectPipelineMetrics(
        fullPath: string,
        limit: number = 50,
    ): Promise<{
        successRate: number;
        averageDuration: number;
        running: number;
        succeeded: number;
        failed: number;
        timeframe: string;
    }> {
        try {
            const query = `query GetProjectPipelines($fullPath: ID!, $limit: Int!) {
                project(fullPath: $fullPath) {
                    pipelines(first: $limit) {
                    nodes {
                        id
                        createdAt
                        finishedAt
                        status
                        duration
                    }
                    }
                    successfulPipelines: pipelines(status: SUCCESS) {
                    count
                    }
                    failedPipelines: pipelines(status: FAILED) {
                    count
                    }
                    totalPipelines: pipelines {
                    count
                    }
                }
            }`;

            const response = await this.graphqlRequest<GitLabGraphQLResponse<GitLabPipelineResponse>>(
                query,
                { fullPath, limit },
            );

            if (!response?.data?.project) {
                throw new Error('Invalid response format from GitLab API');
            }

            const project = response.data.project;
            const pipelineNodes = project.pipelines.nodes;

            // Get total counts from the API
            const totalPipelines = project.totalPipelines.count;
            const succeededPipelines = project.successfulPipelines.count;
            const failedPipelines = project.failedPipelines.count;

            // Calculate metrics from recent pipelines
            const runningPipelines = pipelineNodes.filter((p) => p.status === 'RUNNING').length;

            // Calculate average duration only from completed pipelines with valid duration
            const completedPipelines = pipelineNodes.filter((p) =>
                p.status === 'SUCCESS' && p.duration && p.duration > 0
            );
            const averageDuration = completedPipelines.length > 0
                ? completedPipelines.reduce((sum: number, p: PipelineNode) => sum + p.duration, 0) /
                completedPipelines.length
                : 0;

            // Calculate success rate using total counts
            const successRate = totalPipelines > 0 ? (succeededPipelines / totalPipelines) * 100 : 0;

            // Calculate timeframe from oldest to newest pipeline
            const sortedPipelines = [...pipelineNodes].sort((a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
            const oldestPipeline = sortedPipelines[0];
            const newestPipeline = sortedPipelines[sortedPipelines.length - 1];
            const timeframeDays = oldestPipeline && newestPipeline
                ? Math.ceil(
                (new Date(newestPipeline.createdAt).getTime() -
                    new Date(oldestPipeline.createdAt).getTime()) / (1000 * 60 * 60 * 24),
                )
                : 0;

            return {
                successRate,
                averageDuration: averageDuration / 60, // Convert to minutes
                running: runningPipelines,
                succeeded: succeededPipelines,
                failed: failedPipelines,
                timeframe: `${timeframeDays} days`,
            };
        } catch (error) {
            this.logger.error('Error fetching pipeline metrics:', error);
            throw error;
        }
    }

    private async getEnvironmentDeploymentsForEnv(
        fullPath: string,
        environmentName: string,
    ): Promise<GitLabDeployment[]> {
        try {
            const query = this.queries.getEnvironmentDeployments;
            let hasNextPage = true;
            let endCursor: string | null = null;
            const allDeployments: GitLabDeployment[] = [];

            while (hasNextPage) {
                const response: GitLabGraphQLResponse<EnvironmentDeploymentsResponse> = await this
                .graphqlRequest(
                    query,
                    {
                        fullPath,
                        environmentName,
                        after: endCursor,
                    },
                );

                const deployments = response?.data?.project?.environment?.deployments as
                | GitLabDeployments
                | undefined;

                if (!deployments || !deployments.nodes || deployments.nodes.length === 0) {
                    break;
                }

                allDeployments.push(...deployments.nodes);

                hasNextPage = deployments.pageInfo?.hasNextPage || false;
                endCursor = deployments.pageInfo?.endCursor || null;
            }

            return allDeployments;
        } catch (error) {
            this.logger.error(`Error getting deployments for environment ${environmentName}:`, error);
            return [];
        }
    }

    /**
     * Format project information for display
     * @param project The project to format
     * @returns Formatted project information as a string
     */
    public formatProjectInfo(project: ProjectSchema): string {
        const result: string[] = [];

        // Project details table
        const detailsTable = new Table()
        .border(true)
        .padding(1);

        // Basic Information Section
        detailsTable.push([colors.bold.blue('📋 Basic Information')]);
        detailsTable.push(['Name', project.name]);
        detailsTable.push(['ID', project.id.toString()]);
        if (project.description) {
            detailsTable.push(['Description', project.description]);
        }
        detailsTable.push(['Path', project.path_with_namespace]);
        detailsTable.push(['URL', project.web_url]);
        detailsTable.push(['Visibility', project.visibility]);

        // Statistics Section
        detailsTable.push([colors.bold.blue('📊 Statistics')]);
        detailsTable.push(['Last Activity', new Date(project.last_activity_at).toLocaleString()]);

        if (project.star_count !== undefined) {
            detailsTable.push(['Stars', project.star_count.toString()]);
        }

        if (project.forks_count !== undefined) {
            detailsTable.push(['Forks', project.forks_count.toString()]);
        }

        if (project.open_issues_count !== undefined) {
            detailsTable.push(['Open Issues', project.open_issues_count.toString()]);
        }

        // Repository Information
        detailsTable.push([colors.bold.blue('📁 Repository Information')]);
        if (project.empty_repo !== undefined) {
            detailsTable.push(['Empty Repository', project.empty_repo ? 'Yes' : 'No']);
        }
        if (project.default_branch) {
            detailsTable.push(['Default Branch', project.default_branch]);
        }

        // Features Status
        detailsTable.push([colors.bold.blue('🛠️ Features')]);
        if (project.issues_enabled !== undefined) {
            detailsTable.push(['Issues', project.issues_enabled ? 'Enabled ✅' : 'Disabled ❌']);
        }
        if (project.merge_requests_enabled !== undefined) {
            detailsTable.push([
                'Merge Requests',
                project.merge_requests_enabled ? 'Enabled ✅' : 'Disabled ❌',
            ]);
        }
        if (project.wiki_enabled !== undefined) {
            detailsTable.push(['Wiki', project.wiki_enabled ? 'Enabled ✅' : 'Disabled ❌']);
        }
        if (project.snippets_enabled !== undefined) {
            detailsTable.push(['Snippets', project.snippets_enabled ? 'Enabled ✅' : 'Disabled ❌']);
        }
        if (project.jobs_enabled !== undefined) {
            detailsTable.push(['CI/CD', project.jobs_enabled ? 'Enabled ✅' : 'Disabled ❌']);
        }

        if (project.archived) {
            detailsTable.push([colors.bold.yellow('⚠️ Project Status'), 'ARCHIVED']);
        }

        result.push(detailsTable.toString());

        return result.join('\n');
    }

    public formatProjectMetrics(metrics: GitLabProjectMetrics): string {
        const project = metrics.project as ProjectSchema;
        // Calculate features score with null checks
        const featuresScore = this.countEnabledFeatures(metrics.codeQuality || {});

        // Get timeframes
        const pipelineTimeframe = metrics.pipelineMetrics?.timeframe || '30 days';
        const teamTimeframe = '90 days';
        const qualityTimeframe = 'Current';

        // Safely get environments
        const environments = metrics.codeQuality?.environments?.nodes || [];

        // Calculate documentation health score with null checks
        const docChecks = [
            metrics.codeQuality?.hasReadme,
            metrics.codeQuality?.hasContributing,
            metrics.codeQuality?.hasChangelog,
            metrics.codeQuality?.hasLicense,
            metrics.codeQuality?.hasSecurityPolicy,
            metrics.codeQuality?.hasCodeOwners,
            metrics.codeQuality?.hasCopilotInstructions,
        ];
        const docScore = docChecks.filter(Boolean).length;

        // Get project status
        const status = project?.archived ? '🔴 Archived' : '🟢 Active';
        // Create the project header
        const result: string[] = [];
        result.push(colors.bold.blue(`📊 Project Dashboard: ${project?.name || 'Unknown'} ${status}`));

        // Use the formatProjectInfo method to display project details
        result.push(this.formatProjectInfo(project));

        // Documentation health table
        result.push(
        colors.bold.blue(`\n📚 Documentation Health Score: ${colors.bold(`${docScore}/8`)}`),
        );

        const docsTable = new Table()
        .border(true)
        .padding(1)
        .header(['Item', 'Status'])
        .body([
            ['README', metrics.codeQuality?.hasReadme ? '✅' : '🚧'],
            ['Contributing Guide', metrics.codeQuality?.hasContributing ? '✅' : '🚧'],
            ['Changelog', metrics.codeQuality?.hasChangelog ? '✅' : '🚧'],
            ['License', metrics.codeQuality?.hasLicense ? '✅' : '🚧'],
            ['Security Policy', metrics.codeQuality?.hasSecurityPolicy ? '✅' : '🚧'],
            ['Code Owners', metrics.codeQuality?.hasCodeOwners ? '✅' : '🚧'],
            ['Copilot Instructions', metrics.codeQuality?.hasCopilotInstructions ? '✅' : '🚧'],
        ]);

        result.push(docsTable.toString());

        // Pipeline performance table
        result.push(colors.bold.blue(`\n🚀 Pipeline Performance (Last ${pipelineTimeframe})`));

        const pipelineTable = new Table()
        .border(true)
        .padding(1)
        .header(['Metric', 'Value', 'Status'])
        .body([
            [
            'Success Rate',
            `${metrics.pipelineMetrics?.successRate?.toFixed(1) || '0'}%`,
            this.getPipelineHealthIndicator(metrics.pipelineMetrics?.successRate || 0),
            ],
            [
            'Average Duration',
            `${metrics.pipelineMetrics?.averageDuration?.toFixed(1) || '0'} minutes`,
            '',
            ],
            [
            'Current Status',
            `${metrics.pipelineMetrics?.running || 0}⚡ ${
                metrics.pipelineMetrics?.succeeded || 0
            }✅ ${metrics.pipelineMetrics?.failed || 0}❌`,
            '',
            ],
        ]);

        result.push(pipelineTable.toString());

        // Code quality table
        result.push(colors.bold.blue(`\n🎯 Code Quality (${qualityTimeframe})`));

        const qualityTable = new Table()
        .border(true)
        .padding(1)
        .header(['Metric', 'Value', 'Status'])
        .body([
            [
            'Grade',
            metrics.codeQuality?.grade || 'N/A',
            this.getQualityIndicator(metrics.codeQuality?.grade || 'N/A'),
            ],
            [
            'Coverage',
            `${metrics.codeQuality?.coverage?.toFixed(1) || '0'}%`,
            this.getCoverageIndicator(metrics.codeQuality?.coverage || 0),
            ],
            [
            'Tests Present',
            metrics.codeQuality?.hasTests ? 'Yes' : 'No',
            this.getHealthIndicator(metrics.codeQuality?.hasTests || false),
            ],
        ]);

        result.push(qualityTable.toString());

        // Tools & features table
        result.push(colors.bold.blue(`\n🛠️ Tools & Features (${featuresScore}/4 enabled)`));

        const toolsTable = new Table()
        .border(true)
        .padding(1)
        .header(['Tool', 'Status'])
        .body([
            ['AI Code Review', metrics.codeQuality?.hasAiReview ? '✅' : '🚧'],
            ['Load Testing', metrics.codeQuality?.hasLoadTesting ? '✅' : '🚧'],
            ['Renovate', metrics.codeQuality?.hasRenovate ? '✅' : '🚧'],
            ['Secret Scanning', metrics.codeQuality?.hasSecretScanning ? '✅' : '🚧'],
        ]);

        result.push(toolsTable.toString());

        // Team performance table
        result.push(colors.bold.blue(`\n👥 Team Performance (Last ${teamTimeframe})`));

        const teamTable = new Table()
        .border(true)
        .padding(1)
        .header(['Metric', 'Value', 'Status'])
        .body([
            [
            'Review Participation',
            `${(metrics.teamMetrics?.reviewParticipation || 0).toFixed(1)}%`,
            this.getParticipationIndicator(metrics.teamMetrics?.reviewParticipation || 0),
            ],
            [
            'Time to Merge',
            `${((metrics.teamMetrics?.averageTimeToMerge || 0) / 24).toFixed(1)} days`,
            '',
            ],
            [
            'Time to First Review',
            `${((metrics.teamMetrics?.averageTimeToFirstReview || 0) / 24).toFixed(1)} days`,
            '',
            ],
            [
            'Comments per MR',
            (metrics.teamMetrics?.averageCommentsPerMR || 0).toFixed(1),
            '',
            ],
            [
            'Active Contributors',
            `${metrics.teamMetrics?.activeContributors || 0} members`,
            '',
            ],
        ]);

        result.push(teamTable.toString());

        // Top contributors
        result.push(colors.bold.blue(`\n🏆 Top Contributors`));

        const contributorsTable = new Table()
        .border(true)
        .padding(1)
        .header(['Username', 'Commits', 'MRs', 'Reviews'])
        .body(
            (metrics.teamMetrics?.topContributors || []).map((c) => [
            c.username,
            c.commits.toString(),
            c.mergeRequests.toString(),
            c.reviews.toString(),
            ]),
        );

        result.push(contributorsTable.toString());

        // Environments table
        result.push(colors.bold.blue(`\n🌐 Environments (${environments.length} total)`));

        const envTable = new Table()
        .border(true)
        .padding(1)
        .header(['Environment', 'Last Deployment']);

        if (environments.length > 0) {
        envTable.body(
            environments.map((env) => [
            env.name || 'Unknown',
            env.lastDeployment
                ? `Last: ${new Date(env.lastDeployment.createdAt).toLocaleDateString()}`
                : 'Never deployed',
            ]),
        );
        } else {
        envTable.body([['No environments', 'configured']]);
        }

        result.push(envTable.toString());

        return result.join('\n');
    }

    public async getCurrentMergeRequest(): Promise<GitLabMergeRequest | null> {
        try {
        // Get current git remote URL
        const remoteUrl = await new Deno.Command('git', {
            args: ['remote', 'get-url', 'origin'],
            stdout: 'piped',
        }).output();
        const remoteUrlText = new TextDecoder().decode(remoteUrl.stdout).trim();

        // Extract project path from GitLab URL
        const projectMatch = remoteUrlText.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (!projectMatch) {
            return null;
        }
        const projectPath = projectMatch[1];

        // Get current branch
        const currentBranch = await new Deno.Command('git', {
            args: ['branch', '--show-current'],
            stdout: 'piped',
        }).output();
        const branchName = new TextDecoder().decode(currentBranch.stdout).trim();

        // Find open MR for current branch
        const mrs = await this.getProjectMergeRequests(projectPath, '30d');
        const currentMR = mrs.find((mr) => mr.source_branch === branchName);

        if (!currentMR) {
            return null;
        }

        // Get full MR details
        return await this.getMergeRequest(projectPath, currentMR.iid);
        } catch (error) {
        console.error('Error getting current merge request:', error);
        return null;
        }
    }

    public async getMergeRequestChanges(projectPath: string, mrIid: number): Promise<GitLabChange[]> {
        // Use REST API since GraphQL doesn't provide diffs directly
        const baseUrl = this.config.gitlab!.url.endsWith('/')
        ? this.config.gitlab!.url.slice(0, -1)
        : this.config.gitlab!.url;

        const restResponse = await fetch(
            `${baseUrl}/api/v4/projects/${
                encodeURIComponent(projectPath)
            }/merge_requests/${mrIid}/changes`,
            {
                headers: {
                    'PRIVATE-TOKEN': this.config.gitlab!.token,
                },
            },
        );

        if (!restResponse.ok) {
            throw new Error(`Could not fetch changes for MR #${mrIid} in project ${projectPath}`);
        }

        interface RestChange {
            old_path: string;
            new_path: string;
            deleted_file: boolean;
            new_file: boolean;
            renamed_file: boolean;
            diff: string;
        }

        const data = await restResponse.json() as { changes: RestChange[] };
        return data.changes.map((change) => ({
            old_path: change.old_path,
            new_path: change.new_path,
            deleted_file: change.deleted_file,
            new_file: change.new_file,
            renamed_file: change.renamed_file,
            diff: change.diff,
        }));
    }

    public async createMergeRequestComment(
        _projectPath: string,
        mrIid: number,
        comment: string,
        isDraft = false,
    ): Promise<void> {
        const mutation = `
        mutation CreateMergeRequestComment($input: CreateNoteInput!) {
            createNote(input: $input) {
            note {
                id
                body
            }
            errors
            }
        }
        `;

        await this.graphqlRequest(mutation, {
            input: {
                noteableId: `gid://gitlab/MergeRequest/${mrIid}`,
                body: isDraft ? `[DRAFT] ${comment}` : comment,
            },
        });
    }

    public async getMergeRequest(projectPath: string, mrIid: number): Promise<GitLabMergeRequest> {
        const query = `
        query GetMergeRequest($fullPath: ID!, $iid: String!) {
            project(fullPath: $fullPath) {
            mergeRequest(iid: $iid) {
                id
                iid
                title
                description
                state
                createdAt
                updatedAt
                sourceBranch
                targetBranch
                webUrl
                diffRefs {
                baseSha
                headSha
                startSha
                }
                author {
                name
                username
                }
                reviewers {
                nodes {
                    name
                    username
                }
                }
                approved
                approvedBy {
                nodes {
                    name
                    username
                }
                }
                assignees {
                nodes {
                    name
                    username
                }
                }
                labels {
                nodes {
                    title
                }
                }
            }
            }
        }
        `;

        const response = await this.graphqlRequest<{
            data: {
                project: {
                    mergeRequest: GitLabMergeRequestBase & {
                        diffRefs: { baseSha: string; headSha: string; startSha: string };
                    };
                };
            };
        }>(query, {
            fullPath: projectPath,
            iid: mrIid.toString(),
        });

        const responseData = response as unknown as {
            data: {
                project: {
                    mergeRequest: GitLabMergeRequestBase & {
                        diffRefs: { baseSha: string; headSha: string; startSha: string };
                    };
                };
            };
        };

        if (!responseData?.data?.project?.mergeRequest) {
            throw new Error(`Merge request #${mrIid} not found in project ${projectPath}`);
        }

        const mrData = responseData.data.project.mergeRequest;

        // Map GraphQL response to our internal type
        const mr: GitLabMergeRequest = {
            id: mrData.id,
            iid: parseInt(mrData.iid, 10),
            title: mrData.title,
            description: mrData.description,
            state: mrData.state,
            created_at: mrData.createdAt,
            updated_at: mrData.updatedAt,
            source_branch: mrData.sourceBranch,
            target_branch: mrData.targetBranch,
            web_url: mrData.webUrl,
            author: mrData.author,
            reviewers: mrData.reviewers,
            approved: mrData.approved,
            approvedBy: mrData.approvedBy,
            assignees: mrData.assignees,
            labels: mrData.labels,
            changes: [], // Changes are fetched separately
            diff_refs: mrData.diffRefs
                ? {
                    base_sha: mrData.diffRefs.baseSha,
                    head_sha: mrData.diffRefs.headSha,
                    start_sha: mrData.diffRefs.startSha,
                }
                : undefined,
        };

        return mr;
    }

    public async createMergeRequest(
        projectPath: string,
        options: {
            sourceBranch: string;
            targetBranch: string;
            title: string;
            description: string;
            draft?: boolean;
        },
    ): Promise<GitLabMergeRequest> {
        const mutation = `
        mutation CreateMergeRequest($input: CreateMergeRequestInput!) {
            createMergeRequest(input: $input) {
            mergeRequest {
                id
                iid
                title
                description
                state
                createdAt
                updatedAt
                sourceBranch
                targetBranch
                webUrl
                author {
                name
                username
                }
                reviewers {
                nodes {
                    name
                    username
                }
                    }
                }
                }
            }
            errors
            }
        }
        `;

        const response = await this.graphqlRequest<CreateMergeRequestResponse>(mutation, {
            input: {
                projectPath,
                sourceBranch: options.sourceBranch,
                targetBranch: options.targetBranch,
                title: options.title,
                description: options.description,
                draft: options.draft,
            },
        });

        if (!response?.data?.createMergeRequest?.mergeRequest) {
            throw new Error('Failed to create merge request');
        }

        const mr = response.data.createMergeRequest.mergeRequest;
        const changes = await this.getMergeRequestChanges(projectPath, parseInt(mr.iid));
        const convertedMR = this.convertMergeRequestFromAPI(mr);
        convertedMR.changes = changes;

        return convertedMR;
    }

    /**
     * Update a merge request
     * @param projectPath Project path (namespace/project_name)
     * @param mrIid Merge request internal ID
     * @param updates Object containing fields to update
     * @returns Updated merge request details
     */
    public async updateMergeRequest(
        projectPath: string,
        mrIid: number,
        updates: {
            title?: string;
            description?: string;
            target_branch?: string;
            state_event?: 'close' | 'reopen';
            remove_source_branch?: boolean;
            allow_collaboration?: boolean;
            draft?: boolean;
            assignee_ids?: number[];
            reviewer_ids?: number[];
            labels?: string;
        },
    ): Promise<GitLabMergeRequest> {
        await this.ensureInitialized();
        try {
            this.logger.debug(
                `Updating merge request #${mrIid} in project '${projectPath}' with updates:`,
                updates,
            );

            // Use REST API for updating merge request
            const baseUrl = this.config.gitlab!.url.endsWith('/')
                ? this.config.gitlab!.url.slice(0, -1)
                : this.config.gitlab!.url;

            const updateData: Record<string, unknown> = {};
            
            // Only include fields that are provided
            if (updates.title !== undefined) updateData.title = updates.title;
            if (updates.description !== undefined) updateData.description = updates.description;
            if (updates.target_branch !== undefined) updateData.target_branch = updates.target_branch;
            if (updates.state_event !== undefined) updateData.state_event = updates.state_event;
            if (updates.remove_source_branch !== undefined) updateData.remove_source_branch = updates.remove_source_branch;
            if (updates.allow_collaboration !== undefined) updateData.allow_collaboration = updates.allow_collaboration;
            if (updates.draft !== undefined) updateData.draft = updates.draft;
            if (updates.assignee_ids !== undefined) updateData.assignee_ids = updates.assignee_ids;
            if (updates.reviewer_ids !== undefined) updateData.reviewer_ids = updates.reviewer_ids;
            if (updates.labels !== undefined) updateData.labels = updates.labels;

            const response = await fetch(
                `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}`,
                {
                    method: 'PUT',
                    headers: {
                        'PRIVATE-TOKEN': this.config.gitlab!.token,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updateData),
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to update merge request #${mrIid} in project ${projectPath}: ${response.status} ${response.statusText}`,
                );
            }

            const mrData = await response.json() as {
                id: string;
                iid: number;
                title: string;
                description: string;
                state: string;
                web_url: string;
                source_branch: string;
                target_branch: string;
                created_at: string;
                updated_at: string;
                author: GitLabUser;
                assignees: GitLabUser[];
                reviewers: GitLabUser[];
                labels: Array<{ name: string }>;
            };

            // Convert to our internal format
            const updatedMR: GitLabMergeRequest = {
                id: mrData.id,
                iid: mrData.iid,
                title: mrData.title,
                description: mrData.description,
                state: mrData.state,
                web_url: mrData.web_url,
                source_branch: mrData.source_branch,
                target_branch: mrData.target_branch,
                created_at: mrData.created_at,
                updated_at: mrData.updated_at,
                author: mrData.author,
                reviewers: { nodes: mrData.reviewers || [] },
                approved: false, // This would need additional API call to determine
                approvedBy: { nodes: [] },
                assignees: { nodes: mrData.assignees || [] },
                labels: { nodes: mrData.labels?.map(label => ({ title: label.name })) || [] },
                changes: [], // Changes are fetched separately
            };

            this.logger.debug(`Successfully updated merge request #${mrIid}`);
            return updatedMR;
        } catch (error) {
            this.logger.error(`Error updating merge request #${mrIid} in project '${projectPath}':`, error);
            throw error;
        }
    }

    /**
     * Get merge request diffs/changes with optional view format
     * @param projectPath Project path (namespace/project_name)
     * @param mrIid Merge request internal ID
     * @param view Diff view type ('inline' or 'parallel', defaults to 'inline')
     * @returns Array of merge request diff information
     */
    public async getMergeRequestDiffs(
        projectPath: string,
        mrIid: number,
        view: 'inline' | 'parallel' = 'inline',
    ): Promise<GitLabChange[]> {
        await this.ensureInitialized();
        try {
            this.logger.debug(
                `Getting diffs for merge request #${mrIid} in project '${projectPath}' with view '${view}'`,
            );

            // Use REST API for getting diffs
            const baseUrl = this.config.gitlab!.url.endsWith('/')
                ? this.config.gitlab!.url.slice(0, -1)
                : this.config.gitlab!.url;

            const params = new URLSearchParams();
            if (view) params.append('view', view);

            const response = await fetch(
                `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/changes?${params}`,
                {
                    headers: {
                        'PRIVATE-TOKEN': this.config.gitlab!.token,
                    },
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to get diffs for merge request #${mrIid} in project ${projectPath}: ${response.status} ${response.statusText}`,
                );
            }

            interface RestChange {
                old_path: string;
                new_path: string;
                deleted_file: boolean;
                new_file: boolean;
                renamed_file: boolean;
                diff: string;
            }

            const data = await response.json() as { changes: RestChange[] };
            
            this.logger.debug(`Retrieved ${data.changes.length} changes for merge request #${mrIid}`);
            
            return data.changes.map((change) => ({
                old_path: change.old_path,
                new_path: change.new_path,
                deleted_file: change.deleted_file,
                new_file: change.new_file,
                renamed_file: change.renamed_file,
                diff: change.diff,
            }));
        } catch (error) {
            this.logger.error(
                `Error getting diffs for merge request #${mrIid} in project '${projectPath}':`,
                error,
            );
            throw error;
        }
    }

    /**
     * List all discussions for a merge request
     * @param projectPath Project path (namespace/project_name)
     * @param mrIid Merge request internal ID
     * @returns Array of merge request discussions
     */
    public async listMergeRequestDiscussions(
        projectPath: string,
        mrIid: number,
    ): Promise<GitLabDiscussion[]> {
        await this.ensureInitialized();
        try {
            this.logger.debug(
                `Getting discussions for merge request #${mrIid} in project '${projectPath}'`,
            );

            // Use GraphQL API for getting discussions
            const query = `
                query GetMergeRequestDiscussions($fullPath: ID!, $iid: String!) {
                    project(fullPath: $fullPath) {
                        mergeRequest(iid: $iid) {
                            discussions {
                                nodes {
                                    id
                                    notes {
                                        nodes {
                                            id
                                            body
                                            author {
                                                name
                                               
                                                username
                                            }
                                            createdAt
                                            system
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            `;

            const response = await this.graphqlRequest<{
                data: {
                    project: {
                        mergeRequest: {
                            discussions: {
                                nodes: Array<{
                                    id: string;
                                    notes: {
                                        nodes: Array<{
                                            id: string;
                                            body: string;
                                            author: GitLabUser;
                                            createdAt: string;
                                            system: boolean;
                                        }>;
                                    };
                                }>;
                            };
                        };
                    };
                };
            }>(query, {
                fullPath: projectPath,
                iid: mrIid.toString(),
            });

            if (!response?.data?.project?.mergeRequest?.discussions) {
                throw new Error(`Merge request #${mrIid} not found in project ${projectPath}`);
            }

            const discussions = response.data.project.mergeRequest.discussions.nodes;

            // Convert to our internal format
            const convertedDiscussions: GitLabDiscussion[] = discussions.map((discussion) => ({
                id: discussion.id,
                notes: {
                    nodes: discussion.notes.nodes.map((note) => ({
                        id: note.id,
                        body: note.body,
                        author: note.author,
                        created_at: note.createdAt,
                        system: note.system,
                    })),
                },
            }));

            this.logger.debug(
                `Retrieved ${convertedDiscussions.length} discussions for merge request #${mrIid}`,
            );
            
            return convertedDiscussions;
        } catch (error) {
            this.logger.error(
                `Error getting discussions for merge request #${mrIid} in project '${projectPath}':`,
                error,
            );
            throw error;
        }
    }

    /**
     * Add a comment to a specific line in a merge request diff
     * @param projectPath Project path (namespace/project_name)
     * @param mrIid Merge request internal ID
     * @param body Comment text
     * @param position Position in the diff where to add the comment
     * @returns Created discussion/note details
     */
    public async createMergeRequestDiffComment(
        projectPath: string,
        mrIid: number,
        body: string,
        position: GitLabDiffPosition,
    ): Promise<GitLabDiscussion> {
        await this.ensureInitialized();
        try {
            this.logger.debug(
                `Creating diff comment for merge request #${mrIid} in project '${projectPath}' at position:`,
                position,
            );

            // Use REST API for creating diff comments
            const baseUrl = this.config.gitlab!.url.endsWith('/')
                ? this.config.gitlab!.url.slice(0, -1)
                : this.config.gitlab!.url;

            const noteData = {
                body: body,
                position: {
                    base_sha: position.base_sha,
                    start_sha: position.start_sha,
                    head_sha: position.head_sha,
                    position_type: 'text',
                    old_path: position.old_path,
                    new_path: position.new_path,
                    old_line: position.old_line,
                    new_line: position.new_line,
                    line_range: position.line_range,
                },
            };

            const response = await fetch(
                `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/discussions`,
                {
                    method: 'POST',
                    headers: {
                        'PRIVATE-TOKEN': this.config.gitlab!.token,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(noteData),
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to create diff comment for merge request #${mrIid} in project ${projectPath}: ${response.status} ${response.statusText}`,
                );
            }

            const discussionData = await response.json() as {
                id: string;
                notes: Array<{
                    id: string;
                    body: string;
                    author: GitLabUser;
                    created_at: string;
                    system: boolean;
                }>;
            };

            // Convert to our internal format
            const discussion: GitLabDiscussion = {
                id: discussionData.id,
                notes: {
                    nodes: discussionData.notes.map((note) => ({
                        id: note.id,
                        body: note.body,
                        author: note.author,
                        created_at: note.created_at,
                        system: note.system,
                    })),
                },
            };

            this.logger.debug(`Successfully created diff comment for merge request #${mrIid}`);
            return discussion;
        } catch (error) {
            this.logger.error(
                `Error creating diff comment for merge request #${mrIid} in project '${projectPath}':`,
                error,
            );
            throw error;
        }
    }

    /**
     * Add a comment to an existing merge request discussion thread
     * @param projectPath Project path (namespace/project_name)
     * @param mrIid Merge request internal ID
     * @param discussionId Discussion thread ID
     * @param body Comment text
     * @returns Created note details
     */
    public async addMergeRequestDiscussionReply(
        projectPath: string,
        mrIid: number,
        discussionId: string,
        body: string,
    ): Promise<GitLabNote> {
        await this.ensureInitialized();
        try {
            this.logger.debug(
                `Adding reply to discussion ${discussionId} for merge request #${mrIid} in project '${projectPath}'`,
            );

            // Use REST API for adding replies to discussions
            const baseUrl = this.config.gitlab!.url.endsWith('/')
                ? this.config.gitlab!.url.slice(0, -1)
                : this.config.gitlab!.url;

            const noteData = {
                body: body,
            };

            const response = await fetch(
                `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/discussions/${discussionId}/notes`,
                {
                    method: 'POST',
                    headers: {
                        'PRIVATE-TOKEN': this.config.gitlab!.token,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(noteData),
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to add reply to discussion ${discussionId} for merge request #${mrIid} in project ${projectPath}: ${response.status} ${response.statusText}`,
                );
            }

            const noteData_response = await response.json() as {
                id: string;
                body: string;
                author: GitLabUser;
                created_at: string;
                system: boolean;
            };

            // Convert to our internal format
            const note: GitLabNote = {
                id: noteData_response.id,
                body: noteData_response.body,
                author: noteData_response.author,
                created_at: noteData_response.created_at,
                system: noteData_response.system,
            };

            this.logger.debug(`Successfully added reply to discussion ${discussionId}`);
            return note;
        } catch (error) {
            this.logger.error(
                `Error adding reply to discussion ${discussionId} for merge request #${mrIid} in project '${projectPath}':`,
                error,
            );
            throw error;
        }
    }

    /**
     * Resolve or unresolve a merge request discussion thread
     * @param projectPath Project path (namespace/project_name)
     * @param mrIid Merge request internal ID
     * @param discussionId Discussion thread ID
     * @param resolved Whether to resolve (true) or unresolve (false) the discussion
     * @returns Updated discussion details
     */
    public async resolveMergeRequestDiscussion(
        projectPath: string,
        mrIid: number,
        discussionId: string,
        resolved: boolean,
    ): Promise<GitLabDiscussion> {
        await this.ensureInitialized();
        try {
            this.logger.debug(
                `${resolved ? 'Resolving' : 'Unresolving'} discussion ${discussionId} for merge request #${mrIid} in project '${projectPath}'`,
            );

            // Use REST API for resolving discussions
            const baseUrl = this.config.gitlab!.url.endsWith('/')
                ? this.config.gitlab!.url.slice(0, -1)
                : this.config.gitlab!.url;

            const updateData = {
                resolved: resolved,
            };

            const response = await fetch(
                `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/discussions/${discussionId}`,
                {
                    method: 'PUT',
                    headers: {
                        'PRIVATE-TOKEN': this.config.gitlab!.token,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updateData),
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to ${resolved ? 'resolve' : 'unresolve'} discussion ${discussionId} for merge request #${mrIid} in project ${projectPath}: ${response.status} ${response.statusText}`,
                );
            }

            const discussionData = await response.json() as {
                id: string;
                notes: Array<{
                    id: string;
                    body: string;
                    author: GitLabUser;
                    created_at: string;
                    system: boolean;
                }>;
            };

            // Convert to our internal format
            const discussion: GitLabDiscussion = {
                id: discussionData.id,
                notes: {
                    nodes: discussionData.notes.map((note) => ({
                        id: note.id,
                        body: note.body,
                        author: note.author,
                        created_at: note.created_at,
                        system: note.system,
                    })),
                },
            };

            this.logger.debug(`Successfully ${resolved ? 'resolved' : 'unresolved'} discussion ${discussionId}`);
            return discussion;
        } catch (error) {
            this.logger.error(
                `Error ${resolved ? 'resolving' : 'unresolving'} discussion ${discussionId} for merge request #${mrIid} in project '${projectPath}':`,
                error,
            );
            throw error;
        }
    }

    // ...existing code...
}
