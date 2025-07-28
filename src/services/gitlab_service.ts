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

// Types for GitLabMergeRequest are now provided globally in types.d.ts
// Type for GraphQL responses - internal only
interface SearchProjectsResponse {
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

// Define interfaces for GitLab discussion note type
interface GitLabDiscussionNote {
  id: string;
  body: string;
  author: GitLabUser | { username: string };
  created_at: string;
  system: boolean;
}

// Use the global GitLabDiscussion interface from types.d.ts

// This interface adds discussions to GitLabMergeRequest
interface GitLabMergeRequestWithDiscussions
  extends Omit<GitLabMergeRequest, 'reviewers' | 'approvedBy' | 'assignees' | 'labels'> {
  discussions?: {
    nodes: GitLabDiscussion[];
  };
  source_branch?: string;
  reviewers?: { nodes: GitLabUser[] };
  approvedBy?: { nodes: GitLabUser[] };
  assignees?: { nodes: GitLabUser[] };
  labels?: { nodes: { title: string }[] };
  sourceBranch?: string;
  target_branch?: string;
  targetBranch?: string;
  approved?: boolean;
  diff_refs?: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
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

interface GitLabCodeQualityResponse {
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
}

interface DocumentationResponse {
  project: {
    repository: {
      tree: {
        blobs: {
          nodes: Array<{
            name: string;
            path: string;
          }>;
        };
      };
    };
    securityScanners?: {
      enabled: string[];
      available: string[];
    };
    pipelines?: {
      nodes: Array<{
        jobs: {
          nodes: Array<{
            name: string;
            duration: number;
          }>;
        };
        duration: number;
      }>;
    };
  };
}

interface GitLabEnvironmentsResponse {
  project: {
    environments: {
      nodes: GitLabEnvironment[];
    };
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
    getMergeRequests: `
      query GetMergeRequests($fullPath: ID!, $after: Time) {
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
              state
              createdAt
              updatedAt
              mergedAt
              closedAt
              webUrl
              author {
                username
              }
            }
          }
        }
      }
    `,
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
      const codeQualityQuery = this.queries.getProjectCodeQuality;
      const response = await this.graphqlRequest<GitLabGraphQLResponse<GitLabCodeQualityResponse>>(
        codeQualityQuery,
        { fullPath },
      );

      if (!response?.data?.project) {
        throw new Error('Invalid response format from GitLab API');
      }

      const project = response.data.project;

      // Get coverage from code coverage summary
      let coverage = project.codeCoverageSummary?.averageCoverage || 0;

      // If coverage is 0, try to look for coverage data in pipeline artifacts
      if (coverage === 0 && project.pipelines?.nodes) {
        const pipelineNodes = project.pipelines.nodes;
        // Look for coverage artifacts in recent pipeline jobs
        for (const pipeline of pipelineNodes) {
          if (pipeline.jobs?.nodes) {
            // Look for jobs that might contain coverage information
            const coverageJobs = pipeline.jobs.nodes.filter((job) =>
              job.name.toLowerCase().includes('test') ||
              job.name.toLowerCase().includes('coverage') ||
              job.name.toLowerCase().includes('unit') ||
              job.name.toLowerCase().includes('integration')
            );

            if (coverageJobs.length > 0) {
              // If we have coverage-related jobs, we can assume there are tests
              // even if we don't have exact coverage numbers
              coverage = Math.max(coverage, 20); // Assume at least 20% coverage if tests exist
              break;
            }
          }
        }
      }

      // Process pipeline jobs
      const jobs = project.pipelines?.nodes?.flatMap((p) => p.jobs?.nodes || []) || [];

      // Get documentation checks which includes file checks
      const docChecks = await this.checkDocumentation(fullPath, 'master');

      // Look for coverage indicators in project files
      if (coverage === 0) {
        // Check if repository has test files which indicates potential test coverage
        const hasTestDir = docChecks?.project?.repository?.tree?.trees?.nodes?.some((
          node: { name: string; path: string },
        ) =>
          node.name.toLowerCase().includes('test') ||
          node.name.toLowerCase().includes('spec')
        );

        const hasTestFiles = docChecks?.project?.repository?.tree?.blobs?.nodes?.some((
          node: { name: string; path: string },
        ) =>
          node.path.toLowerCase().includes('test') ||
          node.path.toLowerCase().includes('spec') ||
          node.name.toLowerCase().endsWith('.test.ts') ||
          node.name.toLowerCase().endsWith('.test.js') ||
          node.name.toLowerCase().endsWith('.spec.ts') ||
          node.name.toLowerCase().endsWith('.spec.js')
        );

        if (hasTestDir || hasTestFiles) {
          coverage = Math.max(coverage, 10); // Assume at least 10% coverage if test files exist
        }
      }

      const hasTests = coverage > 0; // If we have coverage, we must have tests

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
    return this.getProjectCodeQuality(fullPath).catch(async (error) => {
      this.logger.debug(
        `Error getting code quality data: ${error}. Falling back to alternative methods.`,
      );

      // Try to determine if the project has tests by checking for common test files/folders
      let hasTests = false;
      let estimatedCoverage = 0;

      try {
        // Check if project has common test directories or files
        const docChecks = await this.checkDocumentation(fullPath, 'main')
          .catch(() => this.checkDocumentation(fullPath, 'master'))
          .catch(() => ({
            project: { repository: { tree: { blobs: { nodes: [] }, trees: { nodes: [] } } } },
          }));

        const hasTestDir = docChecks?.project?.repository?.tree?.trees?.nodes?.some((
          node: { name: string; path: string },
        ) =>
          node.name.toLowerCase().includes('test') ||
          node.name.toLowerCase().includes('spec')
        );

        const hasTestFiles = docChecks?.project?.repository?.tree?.blobs?.nodes?.some((
          node: { name: string; path: string },
        ) =>
          node.path.toLowerCase().includes('test') ||
          node.path.toLowerCase().includes('spec') ||
          node.name.toLowerCase().endsWith('.test.ts') ||
          node.name.toLowerCase().endsWith('.test.js') ||
          node.name.toLowerCase().endsWith('.spec.ts') ||
          node.name.toLowerCase().endsWith('.spec.js')
        );

        if (hasTestDir || hasTestFiles) {
          hasTests = true;
          estimatedCoverage = 15; // Estimate coverage if test files exist
        }
      } catch (checkError) {
        this.logger.debug(`Error checking for test files: ${checkError}. Assuming no tests.`);
      }

      // Return default values with our estimated coverage
      return {
        grade: hasTests ? 'D' : 'E', // If we detect tests, give a slightly better grade
        coverage: estimatedCoverage,
        bugs: 0,
        vulnerabilities: 0,
        codeSmells: 0,
        securityHotspots: 0,
        hasTests,
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
      const docQuery = `
        query GetProjectFiles($fullPath: ID!) {
          project(fullPath: $fullPath) {
            repository {
              tree {
                blobs {
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

      const response = await this.graphqlRequest<GitLabGraphQLResponse<DocumentationResponse>>(
        docQuery,
        { fullPath },
      );

      if (!response?.data?.project) {
        throw new Error('Project not found');
      }

      const project = response.data.project;

      // Get documentation checks
      const hasReadme = project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
        node.name === 'README.md'
      ) || false;
      const hasContributing =
        project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
          node.name === 'CONTRIBUTING.md'
        ) || false;
      const hasChangelog = project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
        node.name === 'CHANGELOG.md'
      ) || false;
      const hasLicense = project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
        node.name === 'LICENSE'
      ) || false;
      const hasSecurityPolicy =
        project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
          node.name === 'SECURITY.md'
        ) || false;
      const hasCodeOwners = project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
        node.name === 'CODEOWNERS'
      ) || false;
      const hasCopilotInstructions =
        project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
          node.name === '.github/copilot-instructions.md'
        ) || false;

      const hasFile = (filePath: string): boolean =>
        project.repository?.tree?.blobs?.nodes?.some((node: { name: string }) =>
          node.name === filePath
        ) || false;

      const pipelineNodes = project.pipelines?.nodes || [];
      const averageJobDuration = pipelineNodes.length > 0
        ? pipelineNodes.reduce((sum: number, p: { duration: number }) =>
          sum + (p.duration || 0), 0) / pipelineNodes.length
        : 0;

      return {
        hasReadme,
        hasContributing,
        hasChangelog,
        hasLicense,
        hasSecurityPolicy,
        hasCodeOwners,
        hasCopilotInstructions,
        hasGitlabCI: project.securityScanners?.enabled?.includes('ci') || false,
        hasPackageJson: hasFile('package.json'),
        hasComposerJson: hasFile('composer.json'),
        hasRequirementsTxt: hasFile('requirements.txt'),
        hasGoMod: hasFile('go.mod'),
        hasCargoToml: hasFile('cargo.toml'),
        hasPomXml: hasFile('pom.xml'),
        hasBuildGradle: hasFile('build.gradle'),
        hasDockerfile: hasFile('Dockerfile'),
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
        hasFile,
        hasTests:
          project.pipelines?.nodes?.some((p: { jobs: { nodes: Array<{ name: string }> } }) =>
            p.jobs?.nodes?.some((job: { name: string }) =>
              job.name.toLowerCase().includes('test')
            )
          ) || false,
        hasLoadTesting: project.securityScanners?.available?.some((s: string) =>
          s.toLowerCase().includes('load-test')
        ) || false,
        hasRenovate: project.securityScanners?.available?.some((s: string) =>
          s.toLowerCase().includes('renovate')
        ) || false,
        hasSecretScanning: project.securityScanners?.enabled?.some((s: string) =>
          s.toLowerCase().includes('secret-detection')
        ) || false,
        hasAiReview: false,
        hasJobArtifacts: false,
        totalArtifacts: 0,
        averageJobDuration,
        deploymentFrequency: pipelineNodes.length > 0 ? pipelineNodes.length / 30 : 0, // Assuming 30 days
        defaultBranch: _defaultBranch,
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
      state: mr.state,
      web_url: mr.webUrl,
      created_at: mr.createdAt,
      updated_at: mr.updatedAt,
      author: { username: mr.author.username },
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
        const mrWithDiscussions = mr as GitLabMergeRequestWithDiscussions;

        // Find the first review by checking each discussion
        const firstReviewDate = mrWithDiscussions.discussions?.nodes?.find((d) => {
          // Handle both array and object with nodes property
          const notes = 'nodes' in d.notes ? d.notes.nodes : d.notes;
          return notes.some((n: GitLabNote) => !n.system);
        })?.notes;

        // Get the created_at date from the first non-system note
        const firstReview = firstReviewDate
          ? ('nodes' in firstReviewDate
            ? firstReviewDate.nodes.find((n: GitLabNote) => !n.system)?.created_at
            : firstReviewDate.find((n: GitLabNote) => !n.system)?.created_at)
          : undefined;

        if (!firstReview) return sum;
        return sum + (new Date(firstReview).getTime() - created.getTime());
      }, 0) / mergedMRs.length;

      const commentsPerMR = mergedMRs.reduce((sum, mr) => {
        const mrWithDiscussions = mr as GitLabMergeRequestWithDiscussions;

        // Calculate total comments by reducing through all discussions
        const totalComments = mrWithDiscussions.discussions?.nodes?.reduce(
          (total: number, d) => {
            // Handle both array and object with nodes property
            const notes = 'nodes' in d.notes ? d.notes.nodes : d.notes;
            return total + notes.filter((n: GitLabNote) => !n.system).length;
          },
          0,
        ) || 0;

        return sum + totalComments;
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
      const teamMetricsQuery = `query GetTeamMetrics($fullPath: ID!, $mrLimit: Int!) {
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
        teamMetricsQuery,
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
      const pipelineQuery = `
query GetProjectPipelines($fullPath: ID!, $limit: Int!) {
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
        pipelineQuery,
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
      // Only fetch deployments for production environments
      if (!this.isProductionEnvironment(environmentName)) {
        return [];
      }

      const deploymentQuery = this.queries.getEnvironmentDeployments;
      let hasNextPage = true;
      let endCursor: string | null = null;
      const allDeployments: GitLabDeployment[] = [];

      while (hasNextPage) {
        const response: GitLabGraphQLResponse<EnvironmentDeploymentsResponse> = await this
          .graphqlRequest(
            deploymentQuery,
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
      const currentMR = mrs.find((mr) =>
        mr.source_branch === branchName || mr.sourceBranch === branchName
      );

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
    const mrQuery = `
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
    }>(mrQuery, {
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
      state: mrData.state,
      created_at: mrData.createdAt,
      updated_at: mrData.updatedAt,
      web_url: mrData.webUrl,
      author: mrData.author,
      changes: [], // Changes are fetched separately
      // Add additional fields from GraphQL response
      description: mrData.description,
      source_branch: mrData.sourceBranch,
      target_branch: mrData.targetBranch,
      // For fields that can have either array or nodes structure, convert as needed
      reviewers: Array.isArray(mrData.reviewers)
        ? mrData.reviewers
        : (mrData.reviewers?.nodes ? mrData.reviewers.nodes : []),
      approved: mrData.approved,
      approvedBy: Array.isArray(mrData.approvedBy)
        ? mrData.approvedBy
        : (mrData.approvedBy?.nodes ? mrData.approvedBy.nodes : []),
      assignees: Array.isArray(mrData.assignees)
        ? mrData.assignees
        : (mrData.assignees?.nodes ? mrData.assignees.nodes : []),
      labels: Array.isArray(mrData.labels)
        ? mrData.labels
        : (mrData.labels?.nodes
          ? mrData.labels.nodes.map((label: { title: string }) => label.title)
          : []),
    };

    // Add diff_refs if available
    if (mrData.diffRefs) {
      mr.diff_refs = {
        base_sha: mrData.diffRefs.baseSha,
        head_sha: mrData.diffRefs.headSha,
        start_sha: mrData.diffRefs.startSha,
      };
    }

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
   * Get environment deployments for a project
   */
  public async getEnvironmentDeployments(projectPath: string): Promise<
    Array<{
      name: string;
      deployments: number;
      lastDeployedAt?: Date;
    }>
  > {
    try {
      const environments = await this.getEnvironments(projectPath);
      return this.processEnvironments(environments, projectPath);
    } catch (error) {
      this.logger.error('Error getting environment deployments:', error);
      return [];
    }
  }

  private async getEnvironments(projectPath: string): Promise<GitLabEnvironment[]> {
    try {
      const environmentsQuery = this.queries.getProjectEnvironments;
      const response = await this.graphqlRequest<GitLabGraphQLResponse<GitLabEnvironmentsResponse>>(
        environmentsQuery,
        { fullPath: projectPath },
      );

      if (!response?.data?.project?.environments?.nodes) {
        throw new Error('Invalid response format from GitLab API');
      }

      return response.data.project.environments.nodes;
    } catch (error) {
      this.logger.error(`Error getting environments for ${projectPath}:`, error);
      throw error;
    }
  }

  /**
   * Search projects with the given search term
   * @param search Search term to filter projects
   */
  public async searchProjects(search: string): Promise<ProjectSchema[]> {
    try {
      const searchProjectsQuery = `
        query SearchProjects($search: String!) {
          projects(search: $search, first: 20) {
            nodes {
              id
              name
              fullPath
              description
              webUrl
              visibility
              lastActivityAt
              archived
            }
          }
        }
      `;

      const response = await this.graphqlRequest<GitLabGraphQLResponse<SearchProjectsResponse>>(
        searchProjectsQuery,
        { search },
      );

      if (!response?.data?.projects?.nodes) {
        return [];
      }

      return this.convertToProjectSchemas(response.data.projects.nodes);
    } catch (error) {
      this.logger.error('Error searching projects:', error);
      throw error;
    }
  }

  /**
   * Convert a GitLab GraphQL response project to a ProjectSchema object
   * @param project Project object from GraphQL with camelCase properties
   * @returns A properly formatted ProjectSchema object with snake_case properties
   */
  public convertToProjectSchema(project: Record<string, unknown>): ProjectSchema {
    // Ensure we handle both camelCase and snake_case property names
    const pns = (project.path_with_namespace as string) ||
      (project.fullPath as string) || '';
    const webUrl = (project.web_url as string) ||
      (project.webUrl as string) || '';
    const archived = project.archived as boolean;
    const visibility = project.visibility as string;
    const lastActivity = (project.last_activity_at as string) ||
      (project.lastActivityAt as string) ||
      new Date().toISOString();

    return {
      id: project.id as string | number,
      name: project.name as string,
      description: (project.description as string) || '',
      path_with_namespace: pns,
      web_url: webUrl,
      visibility: visibility,
      last_activity_at: lastActivity,
      archived: archived,
      // ProjectSchema requires these properties, but we can provide minimal values
      // as they're typically not used in our application context
      avatar_url: null,
      created_at: lastActivity,
      default_branch: 'main',
      description_html: (project.description as string) || '',
      forks_count: 0,
      http_url_to_repo: webUrl,
      issues_enabled: true,
      jobs_enabled: true,
      lfs_enabled: false,
      merge_requests_enabled: true,
      mirror: false,
      namespace: {
        id: 0,
        name: pns.split('/')[0] || '',
        path: pns.split('/')[0] || '',
        kind: 'group',
        full_path: pns.split('/')[0] || '',
      },
      open_issues_count: 0,
      owner: null,
      public_jobs: true,
      readme_url: null,
      runners_token: '',
      shared_runners_enabled: true,
      ssh_url_to_repo: '',
      star_count: 0,
      tag_list: [],
      empty_repo: false,
      wiki_enabled: true,
      snippets_enabled: true,
      can_create_merge_request_in: true,
      resolve_outdated_diff_discussions: false,
      container_registry_access_level: 'enabled',
      container_registry_enabled: true,
      security_and_compliance_enabled: false,
      packages_enabled: true,
      service_desk_enabled: false,
      service_desk_address: null,
      issues_access_level: 'enabled',
      repository_access_level: 'enabled',
      merge_requests_access_level: 'enabled',
      forking_access_level: 'enabled',
      wiki_access_level: 'enabled',
      builds_access_level: 'enabled',
      snippets_access_level: 'enabled',
      pages_access_level: 'enabled',
      operations_access_level: 'enabled',
      analytics_access_level: 'enabled',
      container_registry_image_prefix: '',
      _links: {
        self: webUrl,
        issues: `${webUrl}/issues`,
        merge_requests: `${webUrl}/merge_requests`,
        repo_branches: `${webUrl}/branches`,
        labels: `${webUrl}/labels`,
        events: `${webUrl}/events`,
        members: `${webUrl}/members`,
        cluster_agents: `${webUrl}/cluster_agents`,
      },
      build_coverage_regex: null,
      build_git_strategy: 'fetch',
      build_timeout: 3600,
      auto_cancel_pending_pipelines: 'enabled',
      build_allow_git_fetch: true,
      pull_mirror_available_override: false,
      ci_config_path: null,
      ci_default_git_depth: 20,
      remove_source_branch_after_merge: true,
      request_access_enabled: true,
      shared_with_groups: [],
      only_allow_merge_if_pipeline_succeeds: false,
      only_allow_merge_if_all_discussions_are_resolved: false,
      allow_merge_on_skipped_pipeline: false,
      permissions: {
        project_access: null,
        group_access: null,
      },
    } as unknown as ProjectSchema;
  }

  /**
   * Convert an array of GitLab GraphQL response projects to ProjectSchema objects
   */
  public convertToProjectSchemas(projects: Array<Record<string, unknown>>): ProjectSchema[] {
    return projects.map((project) => this.convertToProjectSchema(project));
  }

  public async searchIssues(query: string, _timeRange: string): Promise<
    Array<{
      title: string;
      description?: string;
      state: string;
      author: GitLabUser;
      createdAt: string;
    }>
  > {
    const response = await this.graphqlRequest<GitlabSearchResponse>(
      `
      query($query: String!) {
        search(query: $query) {
          nodes {
            ... on Issue {
              title
              description
              state
              author {
                name
                username
              }
              createdAt
            }
          }
        }
      }
    `,
      { query },
    );

    return response.data?.search?.nodes || [];
  }

  public async getProjectIssues(projectPath: string): Promise<
    Array<{
      title: string;
      description?: string;
      state: string;
      author: GitLabUser;
      createdAt: string;
    }>
  > {
    const response = await this.graphqlRequest<GitlabProjectIssuesResponse>(
      `
      query($fullPath: ID!) {
        project(fullPath: $fullPath) {
          issues {
            nodes {
              title
              description
              state
              author {
                name
                username
              }
              createdAt
            }
          }
        }
      }
    `,
      { fullPath: projectPath },
    );

    return response.data?.project?.issues?.nodes || [];
  }

  public async searchMergeRequests(query: string): Promise<GitLabMergeRequest[]> {
    const response = await this.graphqlRequest<GitlabSearchMRResponse>(
      `
      query($query: String!) {
        search(query: $query) {
          nodes {
            ... on MergeRequest {
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
            }
          }
        }
      }
    `,
      { query },
    );

    return (response.data?.search?.nodes || []).map((mr: GitLabMergeRequestBase) =>
      this.convertMergeRequestFromAPI(mr)
    );
  }

  public async createIssue(projectPath: string, params: {
    title: string;
    description: string;
    labels?: string;
  }): Promise<{
    iid: number;
    title: string;
    web_url: string;
  }> {
    const mutation = `
      mutation($input: CreateIssueInput!) {
        createIssue(input: $input) {
          issue {
            iid
            title
            webUrl
          }
          errors
        }
      }
    `;

    const response = await this.graphqlRequest<GitlabCreateIssueResponse>(mutation, {
      input: {
        projectPath,
        title: params.title,
        description: params.description,
        labels: params.labels ? params.labels.split(',') : [],
      },
    });

    if (response.data?.createIssue?.errors?.length) {
      throw new Error(response.data.createIssue.errors[0]);
    }

    const issue = response.data?.createIssue?.issue;
    if (!issue) {
      throw new Error('Failed to create issue: No issue data returned');
    }

    return {
      iid: parseInt(issue.iid),
      title: issue.title,
      web_url: issue.webUrl,
    };
  }

  /**
   * Get raw file content from GitLab repository
   * @param projectPath Project path (namespace/project)
   * @param filePath File path within the repository
   * @param ref Branch or commit reference
   * @param maxSizeBytes Maximum file size in bytes to retrieve (default 1MB)
   * @returns Raw file content as string
   */
  public async getRawFile(
    projectPath: string,
    filePath: string,
    ref: string,
    maxSizeBytes: number = 1024 * 1024, // Default 1MB limit
  ): Promise<string> {
    await this.ensureInitialized();

    try {
      const url =
        `${this.config.gitlab?.url}/api/v4/projects/${projectPath}/repository/files/${filePath}/raw?ref=${ref}`;
      const response = await this.request<Response>(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/plain',
        },
        rawResponse: true,
      });

      if (response.ok) {
        // Check response size before processing
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > maxSizeBytes) {
          throw new Error(
            `File size (${contentLength} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`,
          );
        }

        return await response.text();
      } else {
        this.logger.error(`Error fetching raw file: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to fetch file: HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.error(`Error fetching raw file: ${error}`);
      throw error;
    }
  }

  /**
   * Get a limited set of recent projects using gitbeaker/rest
   * @param limit Maximum number of projects to return (default: 20)
   * @returns Array of ProjectSchema objects
   */
  public async getRecentProjectsRest(limit = 20): Promise<ProjectSchema[]> {
    try {
      // Get projects sorted by last activity
      const rawProjects = await this.gitlab.Projects.all({
        membership: true,
        orderBy: 'last_activity_at',
        sort: 'desc',
        perPage: limit,
        archived: false,
        statistics: true,
        simple: false,
      });

      this.logger.debug(`Retrieved ${rawProjects.length} recent projects`);

      // Convert to ProjectSchema format
      return rawProjects.map((project) => this.convertToProjectSchema(project));
    } catch (error) {
      this.logger.error('Failed to get recent projects:', error);
      return [];
    }
  }

  /**
   * Get project activity data using gitbeaker/rest
   * @param projectId Project ID
   * @returns Project activity data
   */
  public async getProjectActivityRest(projectId: number | string): Promise<{
    commits: Array<Pick<CommitSchema, 'id' | 'title' | 'author_name' | 'created_at'>>;
    issues: Array<Pick<IssueSchema, 'iid' | 'title' | 'state' | 'created_at'>>;
    mergeRequests: Array<Pick<MergeRequestSchema, 'iid' | 'title' | 'state' | 'created_at'>>;
  }> {
    try {
      // Get data in parallel
      const [rawCommits, rawIssues, rawMergeRequests] = await Promise.all([
        this.gitlab.Commits.all(projectId, { perPage: 10 }),
        this.gitlab.Issues.all({ projectId, perPage: 10 }),
        this.gitlab.MergeRequests.all({ projectId, perPage: 10 }),
      ]);

      return {
        commits: rawCommits.map((c) => ({
          id: c.id,
          title: c.title,
          author_name: String(c.author_name),
          created_at: String(c.created_at),
        })) as Array<Pick<CommitSchema, 'id' | 'title' | 'author_name' | 'created_at'>>,
        issues: rawIssues.map((i) => ({
          iid: i.iid,
          title: i.title,
          state: i.state,
          created_at: String(i.created_at),
        })) as Array<Pick<IssueSchema, 'iid' | 'title' | 'state' | 'created_at'>>,
        mergeRequests: rawMergeRequests.map((mr) => ({
          iid: mr.iid,
          title: mr.title,
          state: mr.state,
          created_at: String(mr.created_at),
        })) as Array<Pick<MergeRequestSchema, 'iid' | 'title' | 'state' | 'created_at'>>,
      };
    } catch (error) {
      this.logger.error(`Failed to get project activity for ${projectId}:`, error);
      return {
        commits: [],
        issues: [],
        mergeRequests: [],
      };
    }
  }

  private async shouldRefreshCache(
    projectId: string | number,
    cacheKey: string,
    cacheType: string,
  ): Promise<boolean> {
    try {
      // Get project from cached projects list first
      await this.ensureInitialized();
      const projects = await this.getProjects();
      const projectMatch = projects.find((p) =>
        String(p.id) === String(projectId) || p.path_with_namespace === String(projectId)
      );

      if (!projectMatch) {
        this.logger.debug(`Project not found in cache for ID/path: ${projectId}`);
        return true; // Refresh if we can't find the project
      }

      // Get cache metadata
      const cached = await this.cache.get<{ _cached_at?: string }>(cacheKey, cacheType);
      if (!cached || !cached._cached_at) {
        this.logger.debug(`No cache found for key: ${cacheKey}`);
        return true;
      }

      // Check if project was updated after our last cache
      const lastActivity = new Date(projectMatch.last_activity_at);
      const cacheTime = new Date(cached._cached_at);

      const shouldRefresh = lastActivity > cacheTime;
      this.logger.debug(
        `Cache check for ${projectId}: lastActivity=${lastActivity.toISOString()}, cacheTime=${cacheTime.toISOString()}, shouldRefresh=${shouldRefresh}`,
      );

      return shouldRefresh;
    } catch (error) {
      this.logger.error(`Error checking cache freshness: ${error}`);
      return true; // Refresh on error to be safe
    }
  }

  public async getProjectActivityLightRest(projectId: string | number): Promise<{
    lastCommit?: { id: string; created_at: string };
    openIssues: number;
    openMergeRequests: number;
    _cached_at?: string;
  }> {
    try {
      // Get project info first to get default branch
      const projects = await this.getProjects();
      const project = projects.find((p) => String(p.id) === String(projectId));

      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const [defaultBranch, issues, mergeRequests] = await Promise.all([
        this.gitlab.Branches.show(projectId, project.default_branch),
        this.gitlab.Issues.all({ projectId: String(projectId), state: 'opened' }),
        this.gitlab.MergeRequests.all({ projectId: String(projectId), state: 'opened' }),
      ]);

      const commitDate = defaultBranch?.commit?.created_at;
      const created_at = typeof commitDate === 'string' ? commitDate : new Date().toISOString();

      return {
        lastCommit: defaultBranch
          ? {
            id: defaultBranch.commit.id,
            created_at,
          }
          : undefined,
        openIssues: issues.length,
        openMergeRequests: mergeRequests.length,
        _cached_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error getting project activity for ${projectId}:`, error);
      throw error;
    }
  }

  public async getLatestTag(
    projectId: string | number,
  ): Promise<{ name: string; createdAt: string } | null> {
    try {
      const response = await this.gitlab.Tags.all(projectId);
      const tags = (response as GitLabTagResponse[])
        .filter((tag): tag is GitLabTag => {
          return tag?.name != null &&
            tag?.commit?.created_at != null &&
            typeof tag.commit.created_at === 'string';
        });

      if (!tags || tags.length === 0) {
        return null;
      }

      // Sort tags by semantic version if possible, fallback to creation date
      const sortedTags = tags.sort((a, b) => {
        try {
          // Try to parse as semantic versions first
          const versionA = a.name.replace(/^v/, '').split('.').map(Number);
          const versionB = b.name.replace(/^v/, '').split('.').map(Number);

          for (let i = 0; i < 3; i++) {
            if (versionA[i] !== versionB[i]) {
              return (versionB[i] || 0) - (versionA[i] || 0);
            }
          }
          return 0;
        } catch {
          // Fallback to creation date if semantic version parsing fails
          const dateA = new Date(a.commit.created_at);
          const dateB = new Date(b.commit.created_at);
          return dateB.getTime() - dateA.getTime();
        }
      });

      // Return the most recent tag
      return {
        name: sortedTags[0].name,
        createdAt: sortedTags[0].commit.created_at,
      };
    } catch (error) {
      this.logger.error(`Error getting latest tag for ${projectId}:`, error);
      return null;
    }
  }

  /**
   * Check if a project has a changelog file
   * @param projectId Project ID
   * @returns Boolean indicating if changelog exists
   */
  public async hasChangelog(projectId: string | number): Promise<boolean> {
    try {
      await this.getRawFile(`${projectId}`, 'CHANGELOG.md', 'main');
      return true;
    } catch {
      try {
        await this.getRawFile(`${projectId}`, 'changelog.md', 'main');
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get project summary including latest tag and changelog status
   * @param project Project to get summary for
   * @param options Optional settings for what data to fetch
   * @returns Enhanced project summary
   */
  public async getProjectSummary(project: ProjectSchema, options: {
    includeDeployments?: boolean;
    includePipelines?: boolean;
  } = {}): Promise<{
    latestTag: { name: string; createdAt: string } | null;
    hasChangelog: boolean;
    lastDeployment: { environment: string; deployedAt: string } | null;
    pipeline: { stats: { success: number; failed: number; running: number; total: number } } | null;
  }> {
    try {
      // Get data in parallel
      const [latestTag, hasChangelog] = await Promise.all([
        this.getLatestTag(project.id),
        this.hasChangelog(project.id),
      ]);

      let lastDeployment = null;
      let pipeline = null;

      if (options.includeDeployments) {
        try {
          const environments = await this.gitlab.Environments.all(project.id);

          if (environments && environments.length > 0) {
            const productionEnvs = environments
              .filter((env) => this.isProductionEnvironment(env.name))
              .filter((env) => this.isGitLabEnvironmentWithDeployment(env));

            if (productionEnvs.length > 0) {
              const mostRecentEnv = productionEnvs.reduce((latest, current) => {
                return new Date(current.last_deployment.created_at) >
                    new Date(latest.last_deployment.created_at)
                  ? current
                  : latest;
              });

              lastDeployment = {
                environment: mostRecentEnv.name,
                deployedAt: mostRecentEnv.last_deployment.created_at,
              };
            }
          }
        } catch (error) {
          this.logger.error('Error getting environments:', error);
        }
      }

      if (options.includePipelines) {
        try {
          const pipelines = await this.gitlab.Pipelines.all(project.id, { perPage: 100 });
          const stats = {
            success: pipelines.filter((p) => p.status === 'success').length,
            failed: pipelines.filter((p) => p.status === 'failed').length,
            running: pipelines.filter((p) => p.status === 'running').length,
            total: pipelines.length,
          };
          pipeline = { stats };
        } catch (error) {
          this.logger.error('Error getting pipeline stats:', error);
        }
      }

      return {
        latestTag,
        hasChangelog,
        lastDeployment,
        pipeline,
      };
    } catch (error) {
      this.logger.error('Error in getProjectSummary:', error);
      return {
        latestTag: null,
        hasChangelog: false,
        lastDeployment: null,
        pipeline: null,
      };
    }
  }

  public async getProjectPipelinesRest(projectId: number | string): Promise<{
    pipelines: Array<
      Pick<PipelineSchema, 'id' | 'status' | 'ref' | 'created_at'> & { duration?: number }
    >;
    stats: {
      success: number;
      failed: number;
      running: number;
      total: number;
    };
    _cached_at?: string;
  }> {
    type CacheType = {
      pipelines: Array<
        Pick<PipelineSchema, 'id' | 'status' | 'ref' | 'created_at'> & { duration?: number }
      >;
      stats: {
        success: number;
        failed: number;
        running: number;
        total: number;
      };
      _cached_at: string;
    };

    try {
      const cacheKey = `pipelines_${projectId}`;

      // Check if we need to refresh cache
      const shouldRefresh = await this.shouldRefreshCache(projectId, cacheKey, 'pipelines');
      if (!shouldRefresh) {
        const cached = await this.cache.get<CacheType>(cacheKey, 'pipelines');
        if (cached && 'pipelines' in cached && 'stats' in cached) {
          return cached;
        }
      }

      const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const rawPipelines = await this.gitlab.Pipelines.all(projectId, {
        perPage: 1,
        orderBy: 'updated_at',
        sort: 'desc',
        updatedAfter: since,
      });

      const pipelines = rawPipelines.map((p) => ({
        id: p.id,
        status: p.status,
        ref: p.ref,
        created_at: String(p.created_at),
        duration: typeof p.duration === 'number' ? p.duration : undefined,
      })) as Array<
        Pick<PipelineSchema, 'id' | 'status' | 'ref' | 'created_at'> & { duration?: number }
      >;

      // Calculate stats
      const stats = {
        success: pipelines.filter((p) => p.status === 'success').length,
        failed: pipelines.filter((p) => p.status === 'failed').length,
        running: pipelines.filter((p) => p.status === 'running').length,
        total: pipelines.length,
      };

      const result: CacheType = {
        pipelines,
        stats,
        _cached_at: new Date().toISOString(),
      };

      // Cache the result
      await this.cache.set(cacheKey, result, 'pipelines');

      return result;
    } catch (error) {
      this.logger.error(`Failed to get project pipelines for ${projectId}:`, error);
      return {
        pipelines: [],
        stats: {
          success: 0,
          failed: 0,
          running: 0,
          total: 0,
        },
        _cached_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Get project members data using gitbeaker/rest
   * @param projectId Project ID
   * @returns Project members data
   */
  public async getProjectMembersRest(
    projectId: number | string,
  ): Promise<Array<Pick<MemberSchema, 'id' | 'username' | 'name' | 'state' | 'access_level'>>> {
    try {
      const members = await this.gitlab.ProjectMembers.all(projectId, { perPage: 100 });
      return members.map((m) => ({
        id: m.id,
        username: m.username,
        name: m.name,
        state: m.state,
        access_level: Number(m.access_level) as typeof AccessLevel[keyof typeof AccessLevel],
      })) as Array<Pick<MemberSchema, 'id' | 'username' | 'name' | 'state' | 'access_level'>>;
    } catch (error) {
      this.logger.error(`Failed to get project members for ${projectId}:`, error);
      return [];
    }
  }

  private isGitLabEnvironmentWithDeployment(env: unknown): env is GitLabEnvironmentWithDeployment {
    if (!(typeof env === 'object' && env !== null && 'last_deployment' in env)) {
      return false;
    }

    const deployment = (env as { last_deployment: unknown }).last_deployment;
    if (!(typeof deployment === 'object' && deployment !== null && 'created_at' in deployment)) {
      return false;
    }

    return typeof (deployment as { created_at: unknown }).created_at === 'string';
  }
}
