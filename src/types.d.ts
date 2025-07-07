/// <reference no-default-lib="true"/>
/// <reference lib="deno.ns" />
/// <reference lib="deno.window" />
/// <reference lib="esnext" />

declare global {
  // DORA Metrics Types
  interface DoraMetrics {
    deploymentFrequency: {
      deploymentsPerDay: number;
      deploymentsTotal: number;
      rating: 'elite' | 'high' | 'medium' | 'low';
      trendStats: {
        min: number;
        max: number;
        avg: number;
      };
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
    };
    leadTimeForChanges: {
      averageInHours: number;
      medianInHours: number;
      rating: 'elite' | 'high' | 'medium' | 'low';
    };
    changeFailureRate: {
      percentage: number;
      failedDeployments: number;
      totalDeployments: number;
      rating: 'elite' | 'high' | 'medium' | 'low';
    };
    timeToRestore: {
      averageInHours: number;
      medianInHours: number;
      incidents: number;
      rating: 'elite' | 'high' | 'medium' | 'low';
    };
  }

  type TimeRange = '7d' | '30d' | '90d';

  type OutputFormat = 'text' | 'json';

  interface DashboardOptions {
    format: OutputFormat;
    days: number;
  }

  interface ProjectResult {
    project: {
      name: string;
      key: string;
      url: string;
      description: string | null;
      lead: string;
    };
    metrics: JiraProjectMetrics;
  }

  interface ProjectMetricsResponse {
    project: {
      name: string;
      key: string;
      description?: string | null;
      lead?: { displayName: string };
    };
    metrics: JiraProjectMetrics;
  }

  interface ProjectMetrics {
    metrics: {
      [key: string]: number;
    };
  }

  interface JiraMetrics {
    project: {
      lead?: {
        displayName: string;
      };
    };
    metrics: {
      [key: string]: number;
    };
  }

  interface DoraMetricsResult {
    jiraProject: {
      key: string;
      name: string;
      url: string;
    };
    gitlabProject: {
      path: string;
      name: string;
      url: string;
    };
    metrics: DoraMetrics;
    trends: DoraTrends;
    timestamp: Date;
  }

  interface ExtendedDoraMetricsResult extends DoraMetricsResult {
    customMetrics: CustomTeamMetrics;
  }

  // GitLab Types
  /**
   * @deprecated Use ProjectSchema from @gitbeaker/rest instead
   * Interface for the GitLab project returned from GraphQL queries
   * This is kept for backward compatibility during transition
   */
  interface GitLabProject {
    id: string;
    name: string;
    fullPath: string;
    description: string;
    webUrl: string;
    visibility: string;
    lastActivityAt: string;
    archived: boolean;
  }

  interface GitLabMergeRequest {
    id?: string;
    iid: number;
    title: string;
    description: string;
    web_url: string;
    source_branch: string;
    target_branch: string;
    state: string;
    created_at: string;
    updated_at: string;
    author: GitLabUser;
    reviewers: { nodes: GitLabUser[] };
    approved: boolean;
    approvedBy: { nodes: GitLabUser[] };
    assignees?: { nodes: GitLabUser[] };
    labels?: { nodes: Array<{ title: string }> };
    discussions?: { nodes: GitLabDiscussion[] };
    changes: GitLabChange[];
    project_id?: string;
    diff_refs?: {
      base_sha: string;
      head_sha: string;
      start_sha: string;
    };
  }

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
  }

  interface GitLabEnvironment {
    id: string;
    name: string;
    environmentType: string;
    state: string;
    lastDeployment?: {
      id: string;
      createdAt: string;
      finishedAt: string;
      status: string;
    };
  }

  interface GitLabDeployment {
    id: string;
    createdAt: string;
    finishedAt: string;
    status: string;
  }

  interface GitLabChange {
    old_path: string;
    new_path: string;
    deleted_file: boolean;
    new_file: boolean;
    renamed_file: boolean;
    diff: string;
  }

  interface GitLabProjectMetrics {
    project: unknown; // will be a ProjectSchema object
    codeQuality: GitLabCodeQuality;
    mergeRequests: {
      open: GitLabMergeRequest[];
      merged: GitLabMergeRequest[];
      closed: GitLabMergeRequest[];
    };
    pipelineMetrics: {
      successRate: number;
      averageDuration: number;
      running: number;
      succeeded: number;
      failed: number;
      timeframe?: string;
    };
    pipelines?: {
      nodes: PipelineNode[];
    };
    teamMetrics: {
      averageTimeToMerge: number;
      averageTimeToFirstReview: number;
      averageCommentsPerMR: number;
      reviewParticipation: number;
      codeReviewTurnaround: number;
      totalCommits: number;
      activeContributors: number;
      topContributors: ContributorStats[];
    };
  }

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
    hasFile: (filePath: string) => boolean;
  }

  interface DocumentationCheckQueryResponse {
    data?: {
      project?: {
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

  // GraphQL Response Types
  interface GraphQLResponse<T> {
    data: T;
    errors?: Array<{
      message: string;
      locations: Array<{
        line: number;
        column: number;
      }>;
    }>;
  }

  // Utility Types
  interface JobStats {
    hasArtifacts: boolean;
    artifactCount: number;
    averageDuration: number;
  }

  interface StageTransition {
    issueKey: string;
    fromStatus: string;
    toStatus: string;
    timeSpentHours: number;
  }

  interface StatusAnalytics {
    status: string;
    avgDuration: number;
    maxDuration: number;
    maxIssue: string;
    issueCount: number;
  }

  interface ContributorStats {
    username: string;
    commits: number;
    mergeRequests: number;
    reviews: number;
  }

  interface RecentProject {
    fullPath: string;
    key: string;
    name: string;
    lastViewed: Date;
  }

  // Engineering Types
  type CommandType =
    | 'change-review'
    | 'documentor'
    | 'architect'
    | 'tester'
    | 'refactor'
    | 'security'
    | 'exit';
  type SubAgentType =
    | 'code-review'
    | 'documentor'
    | 'architect'
    | 'tester'
    | 'refactor'
    | 'security';

  interface BaseEngineeringOptions extends Record<string, unknown> {
    path?: string;
    depth?: 'quick' | 'normal' | 'deep';
    analysisDepth: 'quick' | 'normal' | 'deep';
    post?: boolean;
    project?: string;
    mergeRequest?: number;
    interactive?: boolean;
    draft?: boolean;
  }

  interface CommandOption {
    name: string;
    value: CommandType;
  }

  interface ProjectAnalysis {
    overallHealth: number;
    codeQualityScore: number;
    reviewProcessScore: number;
    performanceScore: number;
    securityScore: number;
    criticalIssues: string[];
    recommendations: string[];
    priorityAreas: string[];
  }

  interface MetricsAnalysis {
    score: number;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    actionItems: Array<{
      priority: 'high' | 'medium' | 'low';
      description: string;
      impact: string;
    }>;
  }
  // Jira Issue interface
  interface JiraIssue {
    key: string;
    id: string;
    fields: JiraIssueFields;
    changelog?: {
      histories: Array<{
        created: string;
        items: Array<{
          field: string;
          fromString: string;
          toString: string;
        }>;
      }>;
    };
  }

  // Jira Project interface
  interface JiraProject {
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
    simplified: boolean;
    style: string;
    isPrivate: boolean;
    url: string;
    lead?: {
      accountId: string;
      displayName: string;
      emailAddress: string;
    };
    description?: string;
  }

  // Jira Board interface
  interface JiraBoard {
    id: number;
    name: string;
    type: 'scrum' | 'kanban';
    location: {
      projectId: number;
      displayName: string;
      projectName: string;
      projectKey: string;
      projectTypeKey: string;
      avatarURI: string;
      name: string;
    };
  }

  // Jira Sprint interface
  interface JiraSprint {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    state: 'active' | 'closed' | 'future';
    actualState?: 'active' | 'closed' | 'future';
    goal?: string;
    issueCount: number;
    completedIssueCount: number;
    originBoardId: number;
  }

  // Jira issue status statistics
  interface JiraIssueStats {
    total: number;
    open: number;
    inProgress: number;
    done: number;
    backlog: number;
    bugs: number;
    features: number;
    technicalDebt: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
    byMember: Record<string, number>;
    assignedToMe: number;
    createdByMe: number;
    dueToday: number;
    overdue: number;
    recent: number;
  }

  // Jira project metrics
  interface JiraProjectMetrics {
    project: JiraProject;
    issues: {
      total: number;
      open: number;
      inProgress: number;
      done: number;
      backlog: number;
      bugs: number;
      features: number;
      technicalDebt: number;
      byStatus: Record<string, number>;
      byType: Record<string, number>;
      byMember: Record<string, number>;
    };
    members: JiraTeamMember[];
    timeline: JiraTimeline;
    bottlenecks: Array<{ status: string; avgDuration: number; issueCount: number }>;
    sprints?: {
      active?: {
        name: string;
        progress: number;
        committedPoints: number;
        completedPoints: number;
        completionRate: number;
        remainingDays: number;
        startDate: string;
        endDate: string;
        estimatedCompletion: number;
        avgDailyVelocity: number;
        predictabilityScore: string;
        stabilityScore: string;
        committedIssues: number;
        completedIssues: number;
        committedCompletedPoints: number;
        addedCompletedPoints: number;
        committedAndCompleted: JiraIssue[];
        addedDuringSprintAndCompleted: JiraIssue[];
        storyPoints: number;
        issueTypes: {
          story: number;
          task: number;
          bug: number;
          improvement: number;
          spike: number;
          epic?: number;
          subtask?: number;
        };
        priorities: {
          highest: number;
          high: number;
          medium: number;
          low: number;
          lowest: number;
        };
        totalIssues: number;
        spiltOverIssues?: number;
        scopeChange?: number;
      };
      count: number;
      activeCount: number;
      closedCount: number;
      future: number;
      avgVelocity: number;
      avgCompletionRate: number;
      avgCycleTime: {
        mean: number;
        median: number;
        distribution: {
          min: number;
          max: number;
          p25: number;
          p75: number;
          p90: number;
        };
      };
      avgThroughput: number;
      closed: number;
      velocityTrend: number[];
      completionRateTrend: number[];
      predictabilityScore?: string;
      stabilityScore?: string;
      history: Array<{
        name: string;
        startDate: Date;
        endDate: Date;
        progress: number;
        committedPoints: number;
        completedPoints: number;
        completionRate: number;
        avgDailyVelocity: number;
        committedIssues: number;
        completedIssues: number;
        committedAndCompleted: JiraIssue[];
        addedDuringSprintAndCompleted: JiraIssue[];
        totalIssues: number;
        spiltOverIssues?: number;
      }>;
    };
    sprintHistory?: Array<{
      name: string;
      startDate: Date;
      endDate: Date;
      state: 'active' | 'closed' | 'future';
      progress: number;
      committedPoints: number;
      completedPoints: number;
      completionRate: number;
      avgDailyVelocity: number;
      committedIssues: JiraIssue[];
      completedIssues: JiraIssue[];
      spiltOverIssues: JiraIssue[];
      totalIssues: JiraIssue[];
      stageTransitions: {
        transitions: StageTransition[];
        statusAnalytics: StatusAnalytics[];
      };
      averageCycleTime: CycleTimeStats;
    }>;
    qualityTrend?: number[];
    deliveryTrend?: number[];
    healthScore: {
      current: number;
      historical: number;
      combined: number;
      trends: {
        velocity: string;
        completion: string;
        scope: string;
      };
    };
    boardType?: 'scrum' | 'kanban';
  }

  // Jira user interface
  interface JiraUser {
    accountId: string;
    displayName: string;
    emailAddress: string;
    active: boolean;
    avatarUrls: {
      '48x48': string;
      '24x24': string;
      '16x16': string;
      '32x32': string;
    };
  }

  interface StageTransition {
    issueKey: string;
    fromStatus: string;
    toStatus: string;
    timeSpentHours: number;
  }

  interface StatusAnalytics {
    status: string;
    avgDuration: number;
    maxDuration: number;
    maxIssue: string;
    issueCount: number;
  }

  interface CycleTimeStats {
    mean: number;
    median: number;
    distribution: {
      min: number;
      max: number;
      p25: number;
      p75: number;
      p90: number;
    };
  }

  interface SprintData {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    state: string;
    committedIssues: JiraIssue[];
    completedIssues: JiraIssue[];
    spiltOverIssues: JiraIssue[];
    totalIssues: JiraIssue[];
    stageTransitions: {
      transitions: StageTransition[];
      statusAnalytics: StatusAnalytics[];
    };
    averageCycleTime: {
      mean: number;
      median: number;
      distribution: {
        min: number;
        max: number;
        p25: number;
        p75: number;
        p90: number;
      };
    };
    completionRate: number;
    progress: number;
    velocity: number;
    committedPoints: number;
    completedPoints: number;
    committedCompletedPoints: number;
    addedCompletedPoints: number;
    remainingDays: number;
    addedDuringSprintAndCompleted: JiraIssue[];
    committedAndCompleted: JiraIssue[];
    storyPoints: number;
    issueTypes: {
      story: number;
      task: number;
      bug: number;
      improvement: number;
      spike: number;
      epic: number;
      subtask: number;
    };
    priorities: {
      highest: number;
      high: number;
      medium: number;
      low: number;
      lowest: number;
    };
    avgDailyVelocity: number;
    estimatedCompletion?: number;
    healthStatus?: string;
    scopeChange?: number;
    velocityTrendIndicator?: string;
  }

  // GitLab GraphQL Response Types
  interface GitLabPageInfo {
    hasNextPage: boolean;
    endCursor: string;
  }

  interface GitLabUser {
    name: string;
    username: string;
  }

  interface GitLabPipelineResponse {
    project: {
      pipelines: {
        nodes: PipelineNode[];
        count: number;
      };
      successfulPipelines: {
        count: number;
      };
      failedPipelines: {
        count: number;
      };
      totalPipelines: {
        count: number;
      };
    };
  }

  interface GitLabTeamMetricsResponse {
    project: {
      projectMembers: {
        nodes: Array<{
          user: GitLabUser;
        }>;
      };
      mergeRequests: {
        nodes: Array<{
          author: GitLabUser;
          reviewers: {
            nodes: GitLabUser[];
          };
          discussions: {
            nodes: Array<{
              notes: {
                nodes: Array<{
                  author: GitLabUser;
                  system: boolean;
                }>;
              };
            }>;
          };
        }>;
      };
    };
  }

  interface GitLabMergeRequestResponse {
    project: {
      mergeRequest: GitLabMergeRequestBase;
    };
  }

  interface GitLabProjectsResponse {
    projects: {
      pageInfo: GitLabPageInfo;
      nodes: GitLabProject[];
    };
  }

  interface GitLabEnvironmentResponse {
    project: {
      environments: {
        nodes: GitLabEnvironment[];
      };
    };
  }

  interface EnvironmentMetrics {
    name: string;
    deployments: number;
    lastDeployedAt?: Date;
  }

  interface PipelineNode {
    id: string;
    createdAt: string;
    finishedAt: string;
    status: string;
    duration: number;
    jobs: {
      nodes: Array<{
        name: string;
        createdAt: string;
        finishedAt: string;
        status: string;
        duration: number;
        downstreamPipeline: {
          jobs: {
            nodes: Array<{
              name: string;
              status: string;
              tags: string[];
              createdAt: string;
              finishedAt: string;
              duration: number;
            }>;
          };
        };
      }>;
    };
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
    performanceLevel: string;
  }

  interface JiraClient {
    board: {
      getSprintsForBoard: (options: {
        boardId: number;
        state: string[];
        maxResults: number;
      }) => Promise<{ values: JiraSprint[] }>;
      getIssuesForSprint: (options: {
        sprintId: string;
        maxResults: number;
        fields: string[];
      }) => Promise<{ issues: JiraIssue[] }>;
    };
  }

  interface JiraSearchResponse {
    issues: JiraIssue[];
    total: number;
  }

  interface JiraProjectListCache {
    projects: JiraProject[];
    timestamp: Date;
  }

  interface JiraDashboardCache {
    metrics: JiraProjectMetrics;
    timestamp: Date;
  }

  interface JiraRawData {
    project: JiraProject;
    issues: {
      issues: JiraIssue[];
    };
    sprintData: SprintData[];
  }

  interface JiraNote {
    id: string;
    body: string;
    author: {
      name: string;
      username: string;
    };
    created_at: string;
    system: boolean;
  }

  interface JiraDiscussion {
    id: string;
    notes: JiraNote[];
  }

  interface JiraTimeMetrics {
    average: number;
    median: number;
    distribution: {
      min: number;
      max: number;
      p25: number;
      p75: number;
      p90: number;
    };
  }

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

  interface GitLabDeployments {
    nodes: GitLabDeployment[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  }

  interface EnvironmentDeploymentsResponse {
    data: {
      project: {
        environment: {
          deployments: GitLabDeployments;
        };
      };
    };
  }

  // DORA Service Types
  interface DoraTrends {
    deploymentFrequencyTrend: number[];
    leadTimeTrend: number[];
    changeFailureRateTrend: number[];
    timeToRestoreTrend: number[];
    compareWithPrevious: {
      deploymentFrequency: number;
      leadTime: number;
      changeFailureRate: number;
      timeToRestore: number;
    };
  }

  interface DoraMetricsResult {
    jiraProject: {
      key: string;
      name: string;
      url: string;
    };
    gitlabProject: {
      path: string;
      name: string;
      url: string;
    };
    metrics: DoraMetrics;
    trends: DoraTrends;
    timestamp: Date;
  }

  interface CachedDoraMetrics {
    jiraProjectKey: string;
    gitlabProjectPath: string;
    timeRange: TimeRange;
    results: DoraMetricsResult;
    timestamp: Date;
  }

  interface CustomTeamMetrics {
    sprintCommitment: {
      doneVsCommitted: number;
      committedTickets: number;
      completedTickets: number;
      trend: number[];
      rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
      averageTotalPerSprint?: number;
      perSprintValues?: Array<{ sprint: string; done: number; committed: number; ratio: number }>;
    };
    sprintSpillover: {
      spilloverRate: number;
      spilledTickets: number;
      totalTickets: number;
      trend: number[];
      rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
    };
    sprintVelocity: {
      cycleTime: number;
      throughput: number;
      cycleTimeTrend: number[];
      cycleTimeDistribution: number[];
      throughputTrend: number[];
      bottlenecks: string[];
      rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
      perSprintValues?: Array<{ sprint: string; cycleTime: number; throughput: number }>;
    };
    workTypeBreakdown: {
      technical: number;
      operational: number;
      valueCreation: number;
      perSprintValues: Array<{
        sprint: string;
        technical: number;
        operational: number;
        valueCreation: number;
        total: number;
      }>;
      trend: {
        technical: number[];
        operational: number[];
        valueCreation: number[];
      };
    };
    addedTickets: {
      percentage: number;
      addedCount: number;
      totalCount: number;
      byType: Record<string, number>;
      byTypePercentage: Record<string, number>;
      trend: number[];
      rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
    };
    epicTracking: {
      averageParallelEpics: number;
      currentParallelEpics: number;
      perSprintValues: Array<{ sprint: string; parallelEpics: number }>;
      quarterlyAverage: number;
      trend: number[];
      rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
    };
  }

  interface ExtendedDoraMetricsResult extends DoraMetricsResult {
    customMetrics: CustomTeamMetrics;
  }

  // Confluence Types

  interface ConfluenceSpaceStats {
    space: ConfluenceSpace;
    pageCount: number;
    blogCount: number;
    commentCount: number;
    contributorCount: number;
    lastUpdated: string;
    mostViewedPages?: Array<{
      id: string;
      title: string;
      views: number;
    }>;
    topContributors?: Array<{
      displayName: string;
      contributionCount: number;
    }>;
    recentActivity?: Array<{
      type: 'create' | 'update';
      date: string;
      content: {
        id: string;
        title: string;
      };
      user: {
        displayName: string;
      };
    }>;
    tags?: Array<{
      name: string;
      count: number;
    }>;
  }

  interface RecentSpace {
    key: string;
    name: string;
    lastViewed: Date;
  }

  interface CachedJiraSprintData {
    projectKey: string;
    sprintData: SprintData[];
    timestamp: Date;
  }

  interface CachedJiraDashboard {
    projectKey: string;
    metrics: JiraProjectMetrics;
    timestamp: Date;
  }

  interface CachedDashboard {
    projectPath: string;
    metrics: GitLabProjectMetrics;
    timestamp: Date;
  }

  interface RecentProject {
    fullPath: string;
    name: string;
    lastViewed: Date;
  }

  interface RecentJiraProject {
    key: string;
    name: string;
    lastViewed: Date;
  }

  interface RecentConfluenceSpace {
    key: string;
    name: string;
    lastViewed: Date;
  }

  interface RecentAwsProfile {
    name: string;
    lastViewed: Date;
  }

  interface ConfluenceSpace {
    id: string;
    key: string;
    name: string;
    type: string;
    description?: {
      plain?: {
        value?: string;
      };
    };
    homepage?: {
      id: string;
      title: string;
    };
    metadata?: {
      label?: {
        labels?: Array<{
          name: string;
        }>;
      };
    };
  }

  interface ConfluencePage {
    id: string;
    title: string;
    type: string;
    version: {
      number: number;
      by: {
        displayName: string;
        email?: string;
      };
      createdAt: string;
    };
    body: {
      storage: {
        value: string;
      };
    };
    history: {
      createdBy: {
        displayName: string;
        email?: string;
      };
      contributors: {
        publishers: {
          users: Array<{
            displayName: string;
            email?: string;
          }>;
        };
      };
      createdDate: string;
    };
    links: {
      webui: string;
    };
    space?: {
      key: string;
      name: string;
    };
    ancestors?: Array<{
      id: string;
      title: string;
    }>;
    children?: {
      page?: {
        results: ConfluencePage[];
      };
    };
  }

  interface ConfluenceUser {
    accountId: string;
    displayName: string;
    email?: string;
    profilePicture: {
      path: string;
    };
    isExternalCollaborator?: boolean;
  }

  interface ConfluenceComment {
    id: string;
    title: string;
    body: {
      storage: {
        value: string;
      };
    };
    version: {
      number: number;
      createdAt: string;
      by: {
        displayName: string;
        email?: string;
      };
    };
  }

  interface ConfluenceSearchResult {
    results: Array<{
      id: string;
      type: string;
      title: string;
      space: {
        key: string;
        name: string;
      };
      _links: {
        webui: string;
      };
      excerpt?: string;
      lastModified?: {
        when: string;
        by: {
          displayName: string;
        };
      };
    }>;
    size: number;
  }

  interface ConfluenceSpaceStats {
    space: ConfluenceSpace;
    pageCount: number;
    blogCount: number;
    commentCount: number;
    contributorCount: number;
    lastUpdated: string;
    mostViewedPages?: Array<{
      id: string;
      title: string;
      views: number;
    }>;
    topContributors?: Array<{
      displayName: string;
      contributionCount: number;
    }>;
    recentActivity?: Array<{
      type: 'create' | 'update';
      date: string;
      content: {
        id: string;
        title: string;
      };
      user: {
        displayName: string;
      };
    }>;
    tags?: Array<{
      name: string;
      count: number;
    }>;
  }

  interface ContentResult {
    id: string;
    title: string;
    type: string;
    status: string;
  }

  // GraphQL Response Types
  interface ProjectsQueryResponse {
    projects: {
      nodes: GitLabProject[];
    };
  }

  interface ProjectQueryResponse {
    project: GitLabProject;
  }

  interface ActivityQueryResponse {
    project: {
      statistics: {
        repositorySize: number;
        storageSize: number;
        commitCount: number;
      };
      projectMembers: {
        nodes: Array<{
          user: {
            username: string;
          };
        }>;
      };
      lastActivityAt: string;
    };
  }

  interface TimeToMergeQueryResponse {
    project: {
      mergeRequests: {
        nodes: Array<{
          createdAt: string;
          mergedAt: string;
          discussions: {
            nodes: Array<{
              notes: {
                nodes: Array<{
                  createdAt: string;
                  system: boolean;
                  author: {
                    username: string;
                  };
                }>;
              };
            }>;
          };
        }>;
      };
    };
  }

  interface ProjectCodeQualityQueryResponse {
    project: {
      codeCoverageSummary?: {
        averageCoverage: number;
        coverageCount: number;
        lastUpdatedOn: string;
      };
      nameWithNamespace: string;
      namespace: {
        id: string;
        fullName: string;
        name: string;
        fullPath: string;
        path: string;
      };
      repository: {
        blobs?: {
          nodes: Array<{
            path: string;
            webPath: string;
          }>;
        };
        rootRef?: string;
        empty: boolean;
      };
      id: string;
      lastActivityAt: string;
      updatedAt: string;
      openMergeRequestsCount: number;
      statistics: {
        containerRegistrySize: number;
        pipelineArtifactsSize: number;
      };
      ciCdSettings: {
        mergePipelinesEnabled: boolean;
        mergeTrainsEnabled: boolean;
      };
      group: {
        name: string;
        fullName: string;
      };
      languages: Array<{
        name: string;
        share: number;
      }>;
      releases: {
        count: number;
      };
      inheritedCiVariables: {
        edges: Array<{
          node: {
            key: string;
          };
        }>;
      };
      totalPipelines: {
        count: number;
      };
      successfulPipelines: {
        count: number;
      };
      failedPipelines: {
        count: number;
      };
      pipelineAnalytics: {
        weekPipelinesTotals: number[];
        weekPipelinesSuccessful: number[];
        pipelineTimesValues: number[];
      };
      environments: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: Array<GitLabEnvironment>;
      };
      securityScanners: {
        enabled: string[];
        available: string[];
      };
    };
  }

  interface MergeRequestsResponse {
    project: {
      mergeRequests: {
        nodes: Array<GitLabMergeRequest>;
      };
    };
  }

  interface MergeRequestResponse {
    data: {
      project: {
        mergeRequest: GitLabMergeRequest;
      };
    };
  }

  interface MergeRequestChangesResponse {
    project: {
      mergeRequest: {
        diffRefs: {
          baseSha: string;
          headSha: string;
          startSha: string;
        };
        changes: {
          nodes: Array<{
            oldPath: string;
            newPath: string;
            deletedFile: boolean;
            newFile: boolean;
            renamedFile: boolean;
            diff: string;
          }>;
        };
      };
    };
  }

  interface GitlabProjectIssuesResponse {
    data: {
      project: {
        issues: {
          nodes: Array<{
            title: string;
            description: string;
            state: string;
            author: GitLabUser;
            createdAt: string;
          }>;
        };
      };
    };
  }

  interface GitlabCreateIssueResponse {
    data: {
      createIssue: {
        issue: {
          iid: string;
          title: string;
          webUrl: string;
        };
        errors?: string[];
      };
    };
  }

  interface GitlabSearchMRResponse {
    data: {
      search: {
        nodes: Array<GitLabMergeRequestBase>;
      };
    };
  }


  interface GitlabSearchResponse {
    data: {
      search: {
        nodes: Array<{
          title: string;
          description: string;
          state: string;
          author: GitLabUser;
          createdAt: string;
        }>;
      };
    };
  }

  interface CreateMergeRequestResponse {
    data: {
      createMergeRequest: {
        mergeRequest: GitLabMergeRequestBase;
        errors: string[];
      };
    };
  }

  interface FileCheckResponse {
    project?: {
      repository?: {
        files?: {
          nodes?: Array<{
            path: string;
          }>;
        };
      };
    };
  }

  interface PipelineMetricsResponse {
    project: {
      successfulPipelines: {
        count: number;
      };
      failedPipelines: {
        count: number;
      };
      totalPipelines: {
        count: number;
      };
      pipelineAnalytics: {
        weekPipelinesTotals: number[];
        weekPipelinesSuccessful: number[];
        pipelineTimesValues: number[];
      };
    };
  }

  interface NamespaceProjectsQueryResponse {
    namespace: {
      projects: {
        nodes: GitLabProject[];
      };
    };
  }

  interface EnvironmentDeploymentsResponse {
    project: {
      environment: {
        name: string;
        deployments: {
          nodes: GitLabDeployment[];
        };
      };
    };
  }

  interface GitLabNamespace {
    id: string;
    name: string;
    fullPath: string;
    path: string;
    description: string;
    webUrl: string;
    visibility: string;
    avatarUrl: string | null;
    parentId: string | null;
  }

  interface GitLabDiscussion {
    id: string;
    notes: {
      nodes: Array<{
        id: string;
        body: string;
        author: GitLabUser;
        created_at: string;
        system: boolean;
      }>;
    };
  }

  interface GitLabNote {
    id: string;
    body: string;
    author: GitLabUser;
    created_at: string;
    system: boolean;
  }

  interface GitLabMergeRequestBase {
    id: string;
    iid: string;
    title: string;
    description: string;
    state: string;
    createdAt: string;
    updatedAt: string;
    sourceBranch: string;
    targetBranch: string;
    webUrl: string;
    author: GitLabUser;
    reviewers: {
      nodes: GitLabUser[];
    };
    approved: boolean;
    approvedBy: {
      nodes: GitLabUser[];
    };
    assignees?: {
      nodes: GitLabUser[];
    };
    labels?: {
      nodes: Array<{
        title: string;
      }>;
    };
    discussions?: {
      nodes: GitLabDiscussion[];
    };
  }

  interface SearchProjectsResponse {
    projects: {
      nodes: GitLabProject[];
    };
  }

  interface RecentGitLabProject {
    fullPath: string;
    name: string;
    type: 'gitlab';
    lastViewed: Date;
  }

  interface JiraTeamMember {
    displayName: string;
    emailAddress: string;
    accountId: string;
    active: boolean;
  }

  interface JiraTimeline {
    created: Array<{ count: number }>;
    resolved: Array<{ count: number }>;
    updated: Array<{ count: number }>;
    comments: Array<{ count: number }>;
  }

  interface JiraFields {
    // deno-lint-ignore no-explicit-any
    [key: string]: any;
    customfield_10016?: number; // Story points field
  }

  interface JiraIssueFields {
    summary: string;
    description: string;
    created: string;
    resolutiondate: string;
    updated: string;
    dueDate?: string;
    labels?: string[];
    status: {
      name: string;
      statusCategory: {
        key: string;
        name: string;
      };
    };
    issuetype: {
      name: string;
      iconUrl: string;
    };
    priority: {
      name: string;
      iconUrl: string;
    };
    assignee: {
      displayName: string;
      emailAddress: string;
    } | null;
    reporter: {
      displayName: string;
      emailAddress: string;
    };
    components?: Array<{
      name: string;
    }>;
    project: {
      key: string;
      name: string;
    };
    comment?: {
      comments: Array<{
        id: string;
        author: {
          displayName: string;
          emailAddress: string;
        };
        created: string;
        body: string;
      }>;
    };
    // deno-lint-ignore no-explicit-any
    [key: string]: any; // Allow dynamic field access
  }

  // MCP Tool Interfaces
  export interface MCPToolFunction {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
      };
    };
  }

  export interface MCPToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
    message?: string;
  }

  // LLM Interfaces
  export interface ToolFunction {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }

  export interface ToolCall {
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }

  interface GitLabDiffPosition {
    base_sha: string;
    start_sha: string;
    head_sha: string;
    old_path?: string;
    new_path: string;
    old_line?: number;
    new_line?: number;
    line_range?: {
      start: {
        line_code: string;
        type: 'new' | 'old';
        old_line?: number;
        new_line?: number;
      };
      end: {
        line_code: string;
        type: 'new' | 'old';
        old_line?: number;
        new_line?: number;
      };
    };
  }

}

export { };

