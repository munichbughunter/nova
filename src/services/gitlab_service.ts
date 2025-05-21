// Interfaces for GitLab service
interface GitLabMergeRequest {
    id: number;
    iid: number;
    project_id: number;
    title: string;
    description: string;
    state: string;
    created_at: string;
    updated_at: string;
    merged_at?: string;
    closed_at?: string;
    target_branch: string;
    source_branch: string;
    user_notes_count?: number;
    upvotes?: number;
    downvotes?: number;
    author: {
        id: number;
        name: string;
        username: string;
        avatar_url?: string;
        email?: string;
    };
    assignees?: Array<{
        id: number;
        name: string;
        username: string;
        avatar_url?: string;
        email?: string;
    }>;
    labels?: Array<{
        id?: number;
        name: string;
        color?: string;
        description?: string;
        text_color?: string;
        default?: boolean;
    }>;
    milestone?: {
        id: number;
        title: string;
        description: string;
        state: string;
        created_at: string;
        updated_at: string;
        due_date?: string;
        start_date?: string;
        web_url: string;
    } | null;
    project?: {
        id: number;
        name: string;
        description?: string;
        web_url: string;
        avatar_url?: string;
        git_ssh_url?: string;
        git_http_url?: string;
        namespace?: any;
        visibility_level?: number;
        path_with_namespace?: string;
        default_branch?: string;
        ci_config_path?: string;
        homepage?: string;
        url?: string;
        ssh_url?: string;
        http_url?: string;
    } | null;
    diff_refs?: {
        base_sha: string;
        head_sha: string;
        start_sha: string;
    };
    web_url: string;
    discussions?: {
        nodes: Array<any>;
    };
    changes?: MergeRequestChange[];
    approved?: boolean;
    review_comments_count?: number;
    user_permissions?: any;
    diff_notes?: any[];
}

/**
 * GitLab Project interface
 */
interface GitLabProject {
    id: number;
    name: string;
    description?: string;
    fullPath: string;
    archived: boolean;
    webUrl: string;
}

/**
 * Documentation Check Query Response
 */
interface DocumentationCheckQueryResponse {
    data: {
        project: {
            repository: {
                tree: {
                    blobs: {
                        nodes: Array<{
                            name: string;
                            path: string;
                        }>;
                    };
                    trees: {
                        nodes: Array<{
                            name: string;
                            path: string;
                        }>;
                    };
                };
            };
        };
    };
}

/**
 * Documentation Check Response
 */
interface DocumentationCheckResponse {
    hasReadme: boolean;
    hasContributing: boolean;
    hasChangelog: boolean;
    hasLicense: boolean;
    hasSecurityPolicy: boolean;
    hasCodeOwners: boolean;
    hasGitlabCI: boolean;
    hasPackageJson: boolean;
    hasComposerJson: boolean;
    hasRequirementsTxt: boolean;
    hasGoMod: boolean;
    hasCargoToml: boolean;
    hasPomXml: boolean;
    hasBuildGradle: boolean;
    hasDockerfile: boolean;
    hasDockerCompose: boolean;
    hasPhpUnit: boolean;
    hasJestConfig: boolean;
    hasCypress: boolean;
    hasKarmaConfig: boolean;
    hasPytestIni: boolean;
    hasSonarProject: boolean;
    hasEditorConfig: boolean;
    hasPrettierrc: boolean;
    hasEslintrc: boolean;
    hasGitignore: boolean;
    hasEnvExample: boolean;
    hasTerraform: boolean;
    hasHelmfile: boolean;
    hasCopilotInstructions: boolean;
    hasFile: (filePath: string) => boolean;
    hasTests: boolean;
    hasAiReview: boolean;
    hasLoadTesting: boolean;
    hasRenovate: boolean;
    hasSecretScanning: boolean;
    hasJobArtifacts: boolean;
    totalArtifacts: number;
    averageJobDuration: number;
    deploymentFrequency: number;
    defaultBranch: string;
    environments: {
        nodes: any[];
    };
}

/**
 * GitLab Project Metrics interface
 */
interface GitLabProjectMetrics {
    project: ProjectSchema;
    codeQuality: GitLabCodeQuality;
    mergeRequests: {
        open: GitLabMergeRequest[];
        merged: GitLabMergeRequest[];
        closed: GitLabMergeRequest[];
    };
    pipelineMetrics: PipelineMetrics;
    teamMetrics: {
        averageTimeToMerge: number;
        averageTimeToFirstReview: number;
        averageCommentsPerMR: number;
        reviewParticipation: number;
        codeReviewTurnaround: number;
        totalCommits: number;
        activeContributors: number;
        topContributors: Array<{ name: string; commits: number; }>;
    };
}

/**
 * GitLab Code Quality interface
 */
interface GitLabCodeQuality {
    grade: string;
    coverage: number;
    bugs: number;
    vulnerabilities: number;
    codeSmells: number;
    securityHotspots: number;
    hasTests: boolean;
    hasAiReview: boolean;
    hasLoadTesting: boolean;
    hasRenovate: boolean;
    hasSecretScanning: boolean;
    hasJobArtifacts: boolean;
    totalArtifacts: number;
    averageJobDuration: number;
    deploymentFrequency: number;
    defaultBranch: string;
    environments: {
        nodes: GitLabEnvironment[];
    };
    hasReadme?: boolean;
    hasContributing?: boolean;
    hasChangelog?: boolean;
    hasLicense?: boolean;
    hasSecurityPolicy?: boolean;
    hasCodeOwners?: boolean;
    hasGitlabCI?: boolean;
    hasPackageJson?: boolean;
    hasComposerJson?: boolean;
    hasRequirementsTxt?: boolean;
    hasGoMod?: boolean;
    hasCargoToml?: boolean;
    hasPomXml?: boolean;
    hasBuildGradle?: boolean;
    hasDockerfile?: boolean;
    hasDockerCompose?: boolean;
    hasPhpUnit?: boolean;
    hasJestConfig?: boolean;
    hasCypress?: boolean;
    hasKarmaConfig?: boolean;
    hasPytestIni?: boolean;
    hasSonarProject?: boolean;
    hasEditorConfig?: boolean;
    hasPrettierrc?: boolean;
    hasEslintrc?: boolean;
    hasGitignore?: boolean;
    hasEnvExample?: boolean;
    hasTerraform?: boolean;
    hasHelmfile?: boolean;
    hasCopilotInstructions?: boolean;
}

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
    DiscussionSchema,
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

    // Argument types for the new methods
    // private GetMergeRequestCommentsArgs!: { // Removed
    // project_id: string | number; // Removed
    // merge_request_iid: number; // Removed
    // verbose?: boolean; // Removed
    // }; // Removed

    // private AddMergeRequestDiffCommentArgs!: { // Removed
    // project_id: string | number; // Removed
    // merge_request_iid: number; // Removed
    // comment: string; // Removed
    // base_sha: string; // Removed
    // start_sha: string; // Removed
    // head_sha: string; // Removed
    // file_path: string; // Removed
    // line_number: number; // Removed
    // }; // Removed

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
        getMergeRequests: `query GetMergeRequests($fullPath: ID!, $after: Time, $state: MergeRequestState, $search: String, $limit: Int) {
            project(fullPath: $fullPath) {
            mergeRequests(createdAfter: $after, state: $state, search: $search, first: $limit) {
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
                sourceBranch
                targetBranch
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
                approved
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
                    notes(first: 5) { # Limit notes to reduce payload size
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
                diffRefs {
                    baseSha
                    headSha
                    startSha
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
     * @param forceRefresh Force refresh from API instead of using cache
     * @param options Optional limits for data retrieval
     * @returns Project metrics data
     */
    public async getProjectMetrics(
        fullPath: string,
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
            const mrLimit = options.mrLimit;
            const pipelineLimit = options.pipelineLimit || 50;
            const teamLimit = options.teamLimit || 50;

            // Check cache first unless forced to refresh
            const cacheKey = `metrics_${fullPath}`;
            if (!forceRefresh) {
                const cached = await this.cache.get<GitLabProjectMetrics>(cacheKey, 'metrics');
                if (cached) {
                    this.logger.debug(`Using cached metrics for ${fullPath}`);
                    return cached;
                }
            }

            // Fetch all data in parallel
            const [project, codeQuality, openMRs, mergedMRs, closedMRs, pipelineMetrics, teamMetrics] = await Promise.all(
                [
                    this.getProjectDetails(fullPath),
                    this.getProjectCodeQualityWithFallback(fullPath),
                    this.getProjectMergeRequests(fullPath, mrLimit, 'opened'),
                    this.getProjectMergeRequests(fullPath, mrLimit, 'merged'),
                    this.getProjectMergeRequests(fullPath, mrLimit, 'closed'),
                    this.getProjectPipelineMetrics(fullPath, pipelineLimit),
                    this.getTeamMetrics(fullPath, teamLimit),
                ],
            );
            
            // Combine all fetched MRs for timeToMerge metrics if it expects all types
            // For simplicity, let's assume timeToMergeMetrics can operate on mergedMRs or needs adaptation
            const timeToMerge = this.getTimeToMergeMetrics(mergedMRs);

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
                    open: openMRs,
                    merged: mergedMRs,
                    closed: closedMRs,
                },
                pipelineMetrics: {
                    pipelines: pipelineMetrics.pipelines,
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

    /**
     * Get pipeline metrics for a specific project
     * 
     * This method fetches pipeline data from GitLab API and calculates performance metrics
     * like success rate, average duration, and counts of different pipeline statuses.
     * 
     * @param fullPath Full path of the project (namespace/project-name)
     * @param limit Maximum number of pipelines to fetch (default: 50)
     * @returns Promise with pipeline metrics
     */
    public async getProjectPipelineMetrics(fullPath: string, limit: number = 50): Promise<PipelineMetrics> {
        try {
            this.logger.debug(`Fetching pipeline metrics for ${fullPath} (limit: ${limit})`);
            
            // Get project pipelines
            const path = typeof fullPath === 'object'
                ? (fullPath as ProjectSchema).path_with_namespace
                : fullPath;
                
            // Fetch pipelines using REST API
            const pipelines = await this.gitlab.Pipelines.all(path, {
                perPage: limit,
                orderBy: 'updated_at',
                sort: 'desc'
            });
            
            // Map the pipelines to the PipelineNode format
            const pipelineNodes: PipelineNode[] = pipelines.map((pipeline: any) => ({
                id: String(pipeline.id),
                createdAt: String(pipeline.created_at || ''),
                finishedAt: String(pipeline.finished_at || ''),
                status: String(pipeline.status || '').toUpperCase(),
                duration: Number(pipeline.duration || 0),
                jobs: { nodes: [] } // We don't fetch individual jobs here for performance
            }));
            
            // Calculate metrics using the existing method
            const metrics = this.calculatePipelineMetrics(pipelineNodes);
            
            // Add timeframe information
            metrics.timeframe = {
                start: pipelineNodes.length > 0 ? pipelineNodes[pipelineNodes.length - 1].createdAt : '',
                end: pipelineNodes.length > 0 ? pipelineNodes[0].createdAt : '',
                pipelineCount: pipelineNodes.length
            };
            
            return metrics;
        } catch (error) {
            this.logger.error(`Error fetching pipeline metrics for ${fullPath}:`, error);
            // Return default metrics on error
            return {
                pipelines: { nodes: [] },
                successRate: 0,
                averageDuration: 0,
                running: 0,
                succeeded: 0,
                failed: 0,
                timeframe: {
                    start: '',
                    end: '',
                    pipelineCount: 0
                }
            };
        }
    }

    /**
     * Get deployments for a specific environment
     * 
     * @param projectPath Path or ID of the project
     * @param environmentName Name of the environment
     * @returns Promise with an array of deployments
     */
    private async getEnvironmentDeploymentsForEnv(
        projectPath: string,
        environmentName: string
    ): Promise<{ createdAt: string }[]> {
        try {
            const path = typeof projectPath === 'object'
                ? (projectPath as ProjectSchema).path_with_namespace
                : projectPath;
                
            // Use GraphQL API to fetch environment deployments
            const query = this.queries.getEnvironmentDeployments;
            const variables = { 
                fullPath: path,
                environmentName: environmentName,
                after: null
            };
            
            const response = await this.graphqlRequest<
                GitLabGraphQLResponse<{
                    project: {
                        environment: {
                            name: string;
                            deployments: {
                                pageInfo: GitLabPageInfo;
                                nodes: Array<{
                                    id: string;
                                    createdAt: string;
                                    finishedAt: string;
                                    status: string;
                                }>;
                            }
                        }
                    }
                }>
            >(query, variables);
            
            if (!response?.data?.project?.environment?.deployments?.nodes) {
                return [];
            }
            
            // Return the deployment nodes
            return response.data.project.environment.deployments.nodes;
        } catch (error) {
            this.logger.error(`Error fetching deployments for environment ${environmentName} in ${projectPath}:`, error);
            return [];
        }
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

    /**
     * Get the changes of a merge request
     * 
     * This method retrieves the changes (diff) of a specific merge request.
     * 
     * @param projectPath Path or ID of the project
     * @param mrIid The internal ID of the merge request
     * @returns Promise with an array of file changes
     */
    private async fetchMergeRequestChangesRaw(
        projectId: string | number,
        mrIid: number,
        view?: 'inline' | 'parallel'
    ): Promise<MergeRequestChange[]> {
        try {
            this.logger.debug(`Fetching raw changes for merge request #${mrIid} in project ${projectId}`);
            
            // Use the GitLab API to get the changes
            const response = await this.gitlab.MergeRequests.showChanges(projectId, mrIid);
            
            // The response should have a 'changes' property that is an array
            if (!response || !response.changes || !Array.isArray(response.changes)) {
                this.logger.warn(`Unexpected response format for MR changes: ${JSON.stringify(response)}`);
                return [];
            }
            
            // Map the raw changes to our MergeRequestChange interface
            return response.changes.map(change => ({
                id: change.id ? 
                    (typeof change.id === 'string' || typeof change.id === 'number' ? 
                        change.id : 
                        `${change.old_path || change.new_path}`) : 
                    `${change.old_path || change.new_path}`,
                title: change.new_path || change.old_path || '',
                new_file: Boolean(change.new_file),
                renamed_file: Boolean(change.renamed_file),
                deleted_file: Boolean(change.deleted_file),
                diff: change.diff || '',
                file_path: change.new_path || change.old_path || '',
                a_mode: change.a_mode,
                b_mode: change.b_mode,
                // Konvertiere line_count zu number oder undefined
                line_count: typeof change.line_count === 'number' ? change.line_count : undefined,
                // Konvertiere patch zu string oder undefined
                patch: typeof change.patch === 'string' ? change.patch : undefined
            }));
        } catch (error) {
            this.logger.error(`Error fetching raw changes for merge request #${mrIid} in project ${projectId}:`, error);
            if (error instanceof Error) {
                this.logger.error(`Full error: ${error.stack || error.message}`);
            }
            throw error;
        }
    }

    // public async getMergeRequestChanges(
    //     projectId: string | number,
    //     mrIid: number,
    //     options: {
    //         renderDiffWithHighlighting?: boolean;
    //         includeDiffStats?: boolean;
    //     } = {}
    // ): Promise<{
    //     changes: MergeRequestChange[];
    //     diffRefs: { base_sha: string; head_sha: string; start_sha: string; };
    //     stats?: { additions: number; deletions: number; total_changes: number; };
    // }>  {
    //     try {
    //         this.logger.debug(`Fetching detailed diff for merge request #${mrIid} in project ${projectId}`);
    //         // Get the changes using the helper method
    //         const changes = await this.fetchMergeRequestChangesRaw(projectId, mrIid);
    //         // Get the MR data to extract diff refs if needed
    //         const mr = await this.getMergeRequest(projectId, mrIid);

    //         // Ensure we have diffRefs
    //         if (!mr.diff_refs) {
    //             throw new Error(`Could not retrieve diff refs for merge request #${mrIid}`);
    //         }

    //          // Calculate stats if requested
    //         let stats;
    //         if (options.includeDiffStats) {
    //             let additions = 0;
    //             let deletions = 0;
            
    //             // Parse the diffs to count additions and deletions
    //             for (const change of changes) {
    //                 if (change.diff) {
    //                     const diffLines = change.diff.split('\n');
    //                     for (const line of diffLines) {
    //                         if (line.startsWith('+') && !line.startsWith('+++')) {
    //                             additions++;
    //                         } else if (line.startsWith('-') && !line.startsWith('---')) {
    //                             deletions++;
    //                         }
    //                     }
    //                 }
    //             }
            
    //             stats = {
    //                 additions,
    //                 deletions,
    //                 total_changes: additions + deletions
    //             };
    //         }
        
    //         // Apply syntax highlighting if requested
    //         if (options.renderDiffWithHighlighting) {
    //             // This would typically involve sending the diff to a syntax highlighting service
    //             // or using a library to process it. For now, we'll just note that it was requested.
    //             this.logger.debug(`Syntax highlighting for diff was requested but is not implemented yet`);
    //         }
        
    //         return {
    //             changes,
    //             diffRefs: mr.diff_refs,
    //             stats
    //         };
            
    //     } catch (error) {
    //         this.logger.error(`Error fetching changes for merge request #${mrIid} in ${projectId}:`, error);
    //         throw error;
    //     }
    // }

    /**
     * Convert REST MergeRequest schema to internal GitLabMergeRequest type
     * 
     * This method maps the properties of the REST API MergeRequest schema to the internal GitLabMergeRequest type.
     * 
     * @param mr The MergeRequestSchema object from the REST API
     * @returns GitLabMergeRequest object
     */
    private convertRestMergeRequestToGitLabMergeRequest(mr: MergeRequestSchema): GitLabMergeRequest {
        return {
            id: mr.id,
            iid: mr.iid,
            project_id: mr.project_id,
            title: mr.title,
            description: mr.description,
            state: mr.state,
            created_at: mr.created_at,
            updated_at: mr.updated_at,
            merged_at: mr.merged_at || undefined,
            closed_at: mr.closed_at || undefined,
            target_branch: mr.target_branch,
            source_branch: mr.source_branch,
            user_notes_count: mr.user_notes_count,
            upvotes: mr.upvotes,
            downvotes: mr.downvotes,
            author: {
                id: mr.author.id,
                name: mr.author.name,
                username: mr.author.username,
                avatar_url: mr.author.avatar_url,
                email: typeof mr.author.email === 'string' ? mr.author.email : undefined,
            },
            assignees: mr.assignees?.map(assignee => ({
                id: assignee.id,
                name: assignee.name,
                username: assignee.username,
                avatar_url: assignee.avatar_url,
                email: typeof assignee.email === 'string' ? assignee.email : undefined,
            })) || [],
            labels: mr.labels?.map(label => {
                if (typeof label === 'string') {
                    return { name: label };
                }
                return {
                    id: label.id,
                    name: label.name,
                    color: label.color,
                    description: (label.description === null) ? undefined : label.description,
                    text_color: label.text_color,
                    default: typeof label.default === 'boolean' ? label.default : undefined,
                };
            }) || [],
            milestone: mr.milestone ? {
                id: mr.milestone.id,
                title: mr.milestone.title,
                description: mr.milestone.description,
                state: mr.milestone.state,
                created_at: mr.milestone.created_at,
                updated_at: mr.milestone.updated_at,
                due_date: mr.milestone.due_date,
                start_date: mr.milestone.start_date,
                web_url: mr.milestone.web_url,
            } : null,
            project: mr.project ? {
                id: (mr.project as Record<string, unknown>).id as number,
                name: (mr.project as Record<string, unknown>).name as string,
                description: (mr.project as Record<string, unknown>).description as string,
                web_url: (mr.project as Record<string, unknown>).web_url as string,
                avatar_url: (mr.project as Record<string, unknown>).avatar_url as string,
                git_ssh_url: (mr.project as Record<string, unknown>).git_ssh_url as string,
                git_http_url: (mr.project as Record<string, unknown>).git_http_url as string,
                namespace: (mr.project as Record<string, unknown>).namespace,
                visibility_level: (mr.project as Record<string, unknown>).visibility_level as number,
                path_with_namespace: (mr.project as Record<string, unknown>).path_with_namespace as string,
                default_branch: (mr.project as Record<string, unknown>).default_branch as string,
                ci_config_path: (mr.project as Record<string, unknown>).ci_config_path as string,
                homepage: (mr.project as Record<string, unknown>).homepage as string,
                url: (mr.project as Record<string, unknown>).url as string,
                ssh_url: (mr.project as Record<string, unknown>).ssh_url as string,
                http_url: (mr.project as Record<string, unknown>).http_url as string,
            } : null,
            diff_refs: typeof mr.diff_refs === 'object' ? mr.diff_refs as {
                base_sha: string;
                head_sha: string;
                start_sha: string;
            } : undefined,
            web_url: mr.web_url,
            discussions: typeof mr.discussions === 'object' ? {
                nodes: Array.isArray((mr.discussions as any).nodes) 
                    ? (mr.discussions as any).nodes 
                    : []
            } : undefined,
            changes: Array.isArray(mr.changes) ? mr.changes as MergeRequestChange[] : undefined,
            approved: typeof mr.approved === 'boolean' ? mr.approved : undefined,
            review_comments_count: typeof mr.review_comments_count === 'number' ? mr.review_comments_count : undefined,
            user_permissions: mr.user_permissions,
        };
    }

    /**
     * Convert a generic GitLab project object to ProjectSchema
     * 
     * This helper converts projects from different sources to a standard ProjectSchema.
     * It handles camelCase to snake_case conversion for GraphQL responses.
     * 
     * @param project The project object to convert
     * @returns A standardized ProjectSchema
     */
    private convertToProjectSchema(project: Record<string, unknown>): ProjectSchema {
        // Check if we need to convert camelCase to snake_case
        const needsConversion = 'fullPath' in project || 'webUrl' in project;
        
        // Construct a partial ProjectSchema with the fields we know
        const result: Record<string, any> = {
            id: Number(project.id || project.ID || 0),
            name: String(project.name || ''),
            description: project.description as string || '',
            name_with_namespace: String(project.name_with_namespace || project.nameWithNamespace || ''),
            path: String(project.path || ''),
            path_with_namespace: String(project.path_with_namespace || project.pathWithNamespace || project.fullPath || ''),
            created_at: String(project.created_at || project.createdAt || ''),
            default_branch: String(project.default_branch || project.defaultBranch || 'main'),
            ssh_url_to_repo: String(project.ssh_url_to_repo || project.sshUrlToRepo || ''),
            http_url_to_repo: String(project.http_url_to_repo || project.httpUrlToRepo || ''),
            web_url: String(project.web_url || project.webUrl || ''),
            readme_url: String(project.readme_url || project.readmeUrl || ''),
            avatar_url: project.avatar_url as string || project.avatarUrl as string || null,
            forks_count: Number(project.forks_count || project.forksCount || 0),
            star_count: Number(project.star_count || project.starCount || 0),
            last_activity_at: String(project.last_activity_at || project.lastActivityAt || ''),            namespace: needsConversion && project.namespace
                ? {
                    id: Number((project.namespace as Record<string, unknown>).id || 0),
                    name: String((project.namespace as Record<string, unknown>).name || ''),
                    path: String((project.namespace as Record<string, unknown>).path || ''),
                    kind: String((project.namespace as Record<string, unknown>).kind || ''),
                    full_path: String((project.namespace as Record<string, unknown>).fullPath || 
                                (project.namespace as Record<string, unknown>).full_path || ''),
                    parent_id: Number((project.namespace as Record<string, unknown>).parent_id || 
                                (project.namespace as Record<string, unknown>).parentId || 0),
                    avatar_url: String((project.namespace as Record<string, unknown>).avatar_url || 
                                (project.namespace as Record<string, unknown>).avatarUrl || ''),
                    web_url: String((project.namespace as Record<string, unknown>).web_url || 
                                (project.namespace as Record<string, unknown>).webUrl || ''),
                }
                : {
                    id: 0,
                    name: '',
                    path: '',
                    kind: '',
                    full_path: '',
                    parent_id: 0,
                    avatar_url: '',
                    web_url: '',
                },
            container_registry_image_prefix: String(project.container_registry_image_prefix || ''),
            _links: {
                self: String((project._links as Record<string, unknown>)?.self || ''),
                issues: String((project._links as Record<string, unknown>)?.issues || ''),
                merge_requests: String((project._links as Record<string, unknown>)?.merge_requests || ''),
                repo_branches: String((project._links as Record<string, unknown>)?.repo_branches || ''),
                labels: String((project._links as Record<string, unknown>)?.labels || ''),
                events: String((project._links as Record<string, unknown>)?.events || ''),
                members: String((project._links as Record<string, unknown>)?.members || ''),
                cluster_agents: String((project._links as Record<string, unknown>)?.cluster_agents || ''),
            },
            packages_enabled: Boolean(project.packages_enabled || false),
            empty_repo: Boolean(project.empty_repo || false),
            archived: Boolean(project.archived || false),
            visibility: (project.visibility === 'public' || project.visibility === 'internal') 
                ? project.visibility as 'public' | 'internal' | 'private'
                : 'private',
            owner: {
                id: project.owner ? Number((project.owner as Record<string, unknown>).id || 0) : 0,
                name: project.owner ? String((project.owner as Record<string, unknown>).name || '') : '',
                created_at: project.owner ? String((project.owner as Record<string, unknown>).created_at || 
                            (project.owner as Record<string, unknown>).createdAt || '') : '',
            },
            resolve_outdated_diff_discussions: Boolean(project.resolve_outdated_diff_discussions || false),
            container_registry_enabled: Boolean(project.container_registry_enabled || false),
            issues_enabled: Boolean(project.issues_enabled || true),
            merge_requests_enabled: Boolean(project.merge_requests_enabled || true),
            wiki_enabled: Boolean(project.wiki_enabled || true),
            jobs_enabled: Boolean(project.jobs_enabled || true),
            snippets_enabled: Boolean(project.snippets_enabled || true),
            can_create_merge_request_in: Boolean(project.can_create_merge_request_in || true),
            issues_access_level: String(project.issues_access_level || 'enabled'),
            repository_access_level: String(project.repository_access_level || 'enabled'),
            merge_requests_access_level: String(project.merge_requests_access_level || 'enabled'),
            forking_access_level: String(project.forking_access_level || 'enabled'),
            wiki_access_level: String(project.wiki_access_level || 'enabled'),
            builds_access_level: String(project.builds_access_level || 'enabled'),
            snippets_access_level: String(project.snippets_access_level || 'enabled'),
            pages_access_level: String(project.pages_access_level || 'enabled'),
            operations_access_level: String(project.operations_access_level || 'enabled'),
            analytics_access_level: String(project.analytics_access_level || 'enabled'),
            container_registry_access_level: String(project.container_registry_access_level || 'enabled'),
            security_and_compliance_access_level: String(project.security_and_compliance_access_level || 'enabled'),
            emails_disabled: Boolean(project.emails_disabled || false),
            shared_runners_enabled: Boolean(project.shared_runners_enabled || true),
            lfs_enabled: Boolean(project.lfs_enabled || true),
            creator_id: Number(project.creator_id || 0),
            import_url: project.import_url as string || null,
            import_type: project.import_type as string || null,
            import_status: (project.import_status as string) || '',
            open_issues_count: Number(project.open_issues_count || 0),
            ci_default_git_depth: Number(project.ci_default_git_depth || 50),
            ci_forward_deployment_enabled: Boolean(project.ci_forward_deployment_enabled || true),
            ci_allow_fork_pipelines_to_run_in_parent_project: Boolean(project.ci_allow_fork_pipelines_to_run_in_parent_project || false),
            public_jobs: Boolean(project.public_jobs || true),
            build_timeout: Number(project.build_timeout || 3600),
            auto_cancel_pending_pipelines: String(project.auto_cancel_pending_pipelines || 'enabled'),
            build_coverage_regex: project.build_coverage_regex as string || null,
            ci_config_path: project.ci_config_path as string || null,
            shared_with_groups: [],
            only_allow_merge_if_pipeline_succeeds: Boolean(project.only_allow_merge_if_pipeline_succeeds || false),
            allow_merge_on_skipped_pipeline: Boolean(project.allow_merge_on_skipped_pipeline || false),
            restrict_user_defined_variables: Boolean(project.restrict_user_defined_variables || false),
            request_access_enabled: Boolean(project.request_access_enabled || true),
            only_allow_merge_if_all_discussions_are_resolved: Boolean(project.only_allow_merge_if_all_discussions_are_resolved || false),
            remove_source_branch_after_merge: Boolean(project.remove_source_branch_after_merge || true),
            printing_merge_request_link_enabled: Boolean(project.printing_merge_request_link_enabled || true),
            merge_method: String(project.merge_method || 'merge'),
            squash_option: String(project.squash_option || 'default_off'),
            suggestion_commit_message: project.suggestion_commit_message as string || null,
            auto_devops_enabled: Boolean(project.auto_devops_enabled || false),
            auto_devops_deploy_strategy: String(project.auto_devops_deploy_strategy || 'continuous'),
            autoclose_referenced_issues: Boolean(project.autoclose_referenced_issues || true),
            repository_storage: String(project.repository_storage || 'default'),
            approvals_before_merge: Number(project.approvals_before_merge || 0),
            mirror: Boolean(project.mirror || false),
            requirements_enabled: Boolean(project.requirements_enabled || false),
            security_and_compliance_enabled: Boolean(project.security_and_compliance_enabled || false),
            compliance_frameworks: project.compliance_frameworks as string[] || [],
        };
        
        // Return the result as a ProjectSchema
        return result as ProjectSchema;
    }

    /**
     * Get team metrics for a project
     * 
     * This method calculates team collaboration metrics like contribution rates,
     * review participation, and code review turnaround times.
     * 
     * @param fullPath Full path of the project
     * @param limit Maximum number of contributors to include (default: 50)
     * @returns Promise with team metrics object
     */
    public async getTeamMetrics(fullPath: string, limit: number = 50): Promise<{
        reviewParticipation: number;
        codeReviewTurnaround: number;
        topContributors: Array<{ name: string; commits: number; }>;
    }> {
        try {
            this.logger.debug(`Fetching team metrics for ${fullPath} (limit: ${limit})`);
            
            // Get project contributors using REST API
            const path = typeof fullPath === 'object'
                ? (fullPath as ProjectSchema).path_with_namespace
                : fullPath;
                
            // Fetch contributors
            const contributors = await this.gitlab.Repositories.allContributors(path);
            
            // Sort and limit contributors
            const topContributors = contributors
                .sort((a: any, b: any) => (b.commits || 0) - (a.commits || 0))
                .slice(0, limit)
                .map((contributor: any) => ({
                    name: contributor.name || 'Unknown',
                    commits: contributor.commits || 0
                }));
            
            // Calculate review participation (placeholder implementation)
            const totalContributors = contributors.length;
            const activeReviewers = Math.round(totalContributors * 0.7); // Simplified assumption
            const reviewParticipation = totalContributors > 0 ? activeReviewers / totalContributors : 0;
            
            // Calculate code review turnaround (placeholder - in hours)
            const codeReviewTurnaround = 24; // Default to 24 hours as a placeholder
            
            return {
                reviewParticipation,
                codeReviewTurnaround,
                topContributors
            };
        } catch (error) {
            this.logger.error(`Error fetching team metrics for ${fullPath}:`, error);
            // Return default metrics on error
            return {
                reviewParticipation: 0,
                codeReviewTurnaround: 0,
                topContributors: []
            };
        }
    }

    /**
     * Calculate time-to-merge metrics from merge request data
     * 
     * This method analyzes merge request data to calculate metrics like average time to merge,
     * time to first review, and average comments per MR.
     * 
     * @param mergeRequests Array of merge requests to analyze
     * @returns Object with time-to-merge metrics
     */
    public getTimeToMergeMetrics(mergeRequests: GitLabMergeRequest[]): {
        averageTimeToMerge: number;
        averageTimeToFirstReview: number;
        averageCommentsPerMR: number;
    } {
        try {
            // Filter to only merged MRs that have both created_at and merged_at timestamps
            const mergedMRs = mergeRequests.filter(mr => 
                mr.state === 'merged' && mr.created_at && mr.merged_at
            );
            
            // Calculate average time to merge (in hours)
            let totalTimeToMerge = 0;
            
            mergedMRs.forEach(mr => {
                const createdAt = new Date(mr.created_at).getTime();
                const mergedAt = new Date(mr.merged_at!).getTime();
                const timeToMergeHours = (mergedAt - createdAt) / (1000 * 60 * 60);
                totalTimeToMerge += timeToMergeHours;
            });
            
            const averageTimeToMerge = mergedMRs.length > 0 
                ? totalTimeToMerge / mergedMRs.length 
                : 0;
            
            // For simplicity, use placeholders for these metrics
            // In a real implementation, we'd need to analyze discussion timestamps
            const averageTimeToFirstReview = averageTimeToMerge * 0.3; // placeholder
            
            // Calculate average comments per MR
            let totalComments = 0;
            mergeRequests.forEach(mr => {
                totalComments += mr.user_notes_count || 0;
            });
            
            const averageCommentsPerMR = mergeRequests.length > 0 
                ? totalComments / mergeRequests.length 
                : 0;
            
            return {
                averageTimeToMerge,
                averageTimeToFirstReview,
                averageCommentsPerMR
            };
        } catch (error) {
            this.logger.error('Error calculating time-to-merge metrics:', error);
            return {
                averageTimeToMerge: 0,
                averageTimeToFirstReview: 0,
                averageCommentsPerMR: 0
            };
        }
    }

    /**
     * Search for projects across GitLab
     * 
     * This method searches for projects that match the provided query string.
     * 
     * @param query The search query string
     * @returns Promise with an array of ProjectSchema objects
     */
    public async searchProjects(query: string): Promise<ProjectSchema[]> {
        try {
            this.logger.debug(`Searching for projects with query: "${query}"`);
            
            // Use the GitLab API to search for projects
            const projects = await this.gitlab.Projects.all({
                search: query,
                orderBy: 'last_activity_at',
                sort: 'desc',
                simple: false, // Get full project details
                perPage: 20 // Reasonable limit for search results
            });
            
            this.logger.debug(`Found ${projects.length} projects matching query: "${query}"`);
            
            // Convert to ProjectSchema if needed (gitbeaker sometimes returns camelCase properties)
            return projects.map((project) => {
                if (this.isFullProjectSchema(project)) {
                    return project as ProjectSchema;
                }
                return this.convertToProjectSchema(project);
            });
        } catch (error) {
            this.logger.error(`Error searching projects with query "${query}":`, error);
            if (error instanceof Error) {
                this.logger.error(`Full error: ${error.stack || error.message}`);
            }
            return [];
        }
    }

    /**
     * Get a specific merge request by project path and merge request IID
     * 
     * This method fetches a merge request by its IID for a given project.
     * It ensures proper error handling and logging.
     * 
     * @param projectId The project path with namespace or ID
     * @param mergeRequestIid The internal ID of the merge request
     * @returns Promise with GitLabMergeRequest object
     */
    public async getMergeRequests(
        project: string | number, 
        limit: number = 50, 
        state?: 'opened' | 'closed' | 'merged' | 'locked' | 'all'
    ): Promise<GitLabMergeRequest[]> {
        try {
            this.logger.debug(`Fetching project merge requests for project with ID: ${project} and with state: ${state || 'any'}, limit: ${limit} using REST API`);
            const mrs = await this.gitlab.MergeRequests.all({ projectId: project, perPage: limit });
            
            this.logger.debug(
                `Retrieved ${mrs.length} merge requests via REST for ${project} (limit: ${limit}, state: ${state || 'any'})`,
            );
            
            // Convert to GitLabMergeRequest format
            return mrs.map(mr => this.convertRestMergeRequestToGitLabMergeRequest(mr as MergeRequestSchema));
        } catch (error) {
            this.logger.error(`Error fetching merge requests for project with ID: ${project}, (state: ${state}):`, error);
            if (error instanceof Error) {
                this.logger.error(`Full error: ${error.stack || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get merge requests for a project
     * 
     * @param projectPath Path or ID of the project
     * @param limit Maximum number of merge requests to return (default: 100)
     * @param state Filter by merge request state (opened, closed, merged, etc.)
     * @param searchString Optional search string to filter MRs by title/description
     * @returns Promise with an array of GitLabMergeRequest objects
     */
    public async getProjectMergeRequests(
        projectPath: string, 
        limit: number = 100,
        state?: 'opened' | 'closed' | 'merged' | 'locked' | 'all', 
        searchString?: string,
    ): Promise<GitLabMergeRequest[]> {
        try {
            this.logger.debug(`Fetching project merge requests for ${projectPath} using REST API with state: ${state || 'any'}, search: "${searchString || ''}", limit: ${limit}`);

            const restMrs = await this.gitlab.MergeRequests.all({
                projectId: projectPath, 
                state: state === 'all' ? undefined : state, 
                search: searchString, 
                scope: 'all', 
                perPage: limit,
                orderBy: 'updated_at',
                sort: 'desc'
            });

            this.logger.debug(
                `Retrieved ${restMrs.length} merge requests via REST for ${projectPath} (limit: ${limit}, state: ${state || 'any'}, search: "${searchString || ''}")`,
            );

            return restMrs.map(mr => this.convertRestMergeRequestToGitLabMergeRequest(mr as MergeRequestSchema));
        } catch (error) {
            this.logger.error(`Error fetching project merge requests via REST for ${projectPath} (state: ${state}, search: "${searchString}"):`, error);
            if (error instanceof Error) {
                this.logger.error(`Full error: ${error.stack || error.message}`);
            }
            throw error; 
        }
    }

    /**
     * Search for merge requests across GitLab
     * 
     * This method searches for merge requests that match the provided query string.
     * It searches across all projects the user has access to.
     * 
     * @param query The search query string
     * @returns Promise with an array of GitLabMergeRequest objects
     */
    public async searchMergeRequests(query: string): Promise<GitLabMergeRequest[]> {
        try {
            this.logger.debug(`Searching for merge requests with query: "${query}"`);
            
            // Use the GitLab API to search for merge requests
            // Note: When projectId is not specified, it searches across all projects
            const mergeRequests = await this.gitlab.MergeRequests.all({
                search: query,
                state: undefined, // Use undefined instead of 'all' to include all states
                scope: 'all',
                orderBy: 'updated_at',
                sort: 'desc',
                perPage: 20 // Reasonable limit for search results
            });
            
            this.logger.debug(`Found ${mergeRequests.length} merge requests matching query: "${query}"`);
            
            // Convert to GitLabMergeRequest format
            return mergeRequests.map(mr => this.convertRestMergeRequestToGitLabMergeRequest(mr as MergeRequestSchema));
        } catch (error) {
            this.logger.error(`Error searching merge requests with query "${query}":`, error);
            if (error instanceof Error) {
                this.logger.error(`Full error: ${error.stack || error.message}`);
            }
            return [];
        }
    }

   

    /**
     * Gets comments for a specific merge request
     * 
     * This method retrieves all comments for a given merge request.
     * 
     * @param projectId The project path with namespace or ID
     * @param mergeRequestIid The internal ID of the merge request
     * @return Promise with an array of comments
     */
    public async getMergeRequestComments(projectId: string | number, mergeRequestIid: number): Promise<GitLabDiscussion[]> {
        try {
            this.logger.debug(`Fetching comments for merge request #${mergeRequestIid} in project ${projectId}`);
            // Use the GitLab API to get discussions (comments) for the merge request
            const discussions = await this.gitlab.MergeRequestDiscussions.all(projectId, mergeRequestIid);

            return discussions.map(discussion => {
                // Determin if this is a diff note based on the presence of position information
                const isDiffNote = discussion.position !== undefined;

                return {
                    id: discussion.id,
                    notes: {
                        nodes: Array.isArray(discussion.notes) ? discussion.notes.map(note => ({
                            id: String(note.id),
                            body: note.body || '',
                            author: {
                                name: note.author?.name || 'Unknown',
                                username: note.author?.username || 'unknown',
                            },
                            created_at: note.created_at || '',
                            system: note.system || false,
                        })) : []
                    },
                    type: isDiffNote ? 'DiffNote' : 'DiscussionNote',   
                    position: isDiffNote ? discussion.position : undefined,
                    file_path: isDiffNote ? (discussion.position as any)?.new_path : undefined,
                    resolvable: discussion.resolvable || false,
                    resolved: discussion.resolved || false,
                    resolved_by: discussion.resolved_by || null
                };
            });
        } catch (error) {
            this.logger.error(`Error fetching comments for merge request #${mergeRequestIid} in project ${projectId}:`, error);
            if (error instanceof Error) {
                this.logger.error(`Full error: ${error.stack || error.message}`);
            }
            return [];
        }
    }

    /**
     * Creates a comment on a specific line in a merge request diff
     * 
     * @param projectId The project path with namespace or ID
     * @param mergeRequestIid The internal ID of the merge request
     * @param options Options for creating the comment
     * @returns Promise with the created note/comment
     */
    public async createMergeRequestDiffComment(
        projectId: string | number,
        mergeRequestIid: number,
        comment: string,
        options: {
            position: {
                baseSha: string;
                startSha: string;
                headSha: string;
                oldPath: string;
                newPath: string;
                positionType: string;
                new_line: number;
            };
        }
    ): Promise<any> {
        try {
            this.logger.debug(`Creating diff comment on merge request #${mergeRequestIid} in project ${projectId}`);

            this.logger.debug(`Creating diff comment on merge request with baseSHA: ${options.position.baseSha}`);
            this.logger.debug(`Creating diff comment on merge request with startSHA: ${options.position.startSha}`);
            this.logger.debug(`Creating diff comment on merge request with headSHA: ${options.position.headSha}`);
            this.logger.debug(`Creating diff comment on merge request with oldPath: ${options.position.oldPath}`);
            this.logger.debug(`Creating diff comment on merge request with newPath: ${options.position.newPath}`);
            this.logger.debug(`Creating diff comment on merge request with newLine: ${options.position.new_line}`);

        

            const discussion = await this.gitlab.MergeRequestDiscussions.create(
                projectId,
                mergeRequestIid,
                comment,
                {
                    position: {
                        baseSha: options.position.baseSha,
                        startSha: options.position.startSha,
                        headSha: options.position.headSha,
                        oldPath: options.position.oldPath,
                        newPath: options.position.newPath,
                        positionType: 'text',
                        newLine: String(options.position.new_line),
                    }
                }
            );

            return discussion;
        } catch (error) {
            this.logger.error("Failed to create merge request diff comment:", error);
            throw error;
        }
    }

    /**
     * Generate a line code for a diff comment
     * 
     * GitLab requires a line_code parameter when creating diff comments.
     * This is a unique identifier for the specific line in the diff.
     * 
     * @param newPath Path to the new file
     * @param newLine Line number in the new file
     * @param oldPath Path to the old file
     * @param oldLine Line number in the old file
     * @returns A line code string in the format expected by GitLab
     */
    private generateLineCode(
        newPath: string,
        newLine: number,
        oldPath: string,
        oldLine: number
    ): string {
        // GitLab expects line codes in a specific format
        // This is a simplified version - in a real implementation, you might need to generate
        // line codes that match GitLab's internal format more precisely
        const cleanPath = newPath.replace(/[^a-zA-Z0-9]/g, '_');
        return `${cleanPath}_${oldLine}_${newLine}`;
    }
}

/**
 * GitLab GraphQL response interface
 */
interface GitLabGraphQLResponse<T> {
    data: T;
    errors?: Array<{
        message: string;
        locations: Array<{
            line: number;
            column: number;
        }>;
    }>;
}

interface MergeRequestChange {
    id: string | number;
    title: string;
    a_mode?: string;
    b_mode?: string;
    new_file: boolean;
    renamed_file: boolean;
    deleted_file: boolean;
    diff: string;
    diff_refs?: {
        base_sha: string;
        head_sha: string;
        start_sha: string;
    };
    file_path: string;
    line_count?: number;
    patch?: string;
}

interface GitLabPageInfo {
    hasNextPage: boolean;
    endCursor: string;
}

interface PipelineNode {
    id: string;
    createdAt: string;
    finishedAt: string;
    status: string;
    duration: number;
    jobs?: {
        nodes: Array<{
            name: string;
            createdAt: string;
            finishedAt: string;
            status: string;
            duration: number;
        }>;
    };
}

interface EnvironmentMetrics {
    name: string;
    deployments: number;
    lastDeployedAt?: Date;
}

interface PipelineMetrics {
    pipelines: {
        nodes: PipelineNode[];
    };
    successRate: number;
    averageDuration: number;
    running: number;
    succeeded: number;
    failed: number;
    timeframe?: {
        start: string;
        end: string;
        pipelineCount: number;
    };
}

interface DeploymentFrequencyMetrics {
    deploymentsPerDay: number;
    deploymentsTotal: number;
    rating: 'elite' | 'high' | 'medium' | 'low';
    environmentBreakdown: {
        production: {
            environments: Array<{ name: string; deployments: number }>;
            total: number;
        };
        staging: {
            environments: Array<{ name: string; deployments: number }>;
            total: number;
        };
        development: {
            environments: Array<{ name: string; deployments: number }>;
            total: number;
        };
    };
    total: number;
    perDay: number;
    byEnvironment: EnvironmentMetrics[];
    performanceLevel: 'elite' | 'high' | 'medium' | 'low';
}

interface GitLabDiscussion {
    id: string;
    notes: {
        nodes: Array<{
            id: string;
            body: string;
            author: {
                name: string;
                username: string;
            };
            created_at: string;
            system: boolean;
        }>;
    };
}