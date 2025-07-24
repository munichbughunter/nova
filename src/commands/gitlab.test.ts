import { Select } from '@cliffy/prompt';
import { ProjectSchema } from '@gitbeaker/rest';
import { assertEquals, assertMatch } from '@std/assert';
import { assertSpyCalls, stub } from '@std/testing/mock';
import { Config, configManager } from '../config/mod.ts';
import { DatabaseService } from '../services/db_service.ts';
import { GitLabService } from '../services/gitlab_service.ts';
import { gitlabCommand } from './gitlab.ts';

// Define interfaces used in tests
interface RecentProject {
  path_with_namespace?: string; 
  name: string;
  lastViewed: Date;
  key: string;
}

// Create a minimal ProjectSchema for testing purposes
type MinimalProjectSchema = Pick<
  ProjectSchema, 
  'id' | 'name' | 'path_with_namespace' | 'description' | 'web_url' | 
  'visibility' | 'last_activity_at' | 'archived'
>;

// Create a full ProjectSchema from a minimal one
function createMockProjectSchema(partial: MinimalProjectSchema): ProjectSchema {
  return {
    ...partial,
    // Add required fields with default values
    avatar_url: null,
    created_at: partial.last_activity_at || new Date().toISOString(),
    default_branch: 'main',
    description_html: partial.description || '',
    empty_repo: false,
    forks_count: 0,
    http_url_to_repo: partial.web_url || '',
    issues_enabled: true,
    jobs_enabled: true,
    lfs_enabled: false,
    merge_requests_enabled: true,
    mirror: false,
    namespace: {
      id: 0,
      name: partial.path_with_namespace.split('/')[0] || '',
      path: partial.path_with_namespace.split('/')[0] || '',
      kind: 'group',
      full_path: partial.path_with_namespace.split('/')[0] || '',
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
      self: partial.web_url,
      issues: `${partial.web_url}/issues`,
      merge_requests: `${partial.web_url}/merge_requests`,
      repo_branches: `${partial.web_url}/branches`,
      labels: `${partial.web_url}/labels`,
      events: `${partial.web_url}/events`,
      members: `${partial.web_url}/members`,
      cluster_agents: `${partial.web_url}/cluster_agents`,
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
  author: { name: string; username: string };
  reviewers: { nodes: Array<{ name: string; username: string }> };
  approved: boolean;
  approvedBy: { nodes: Array<{ name: string; username: string }> };
  assignees?: { nodes: Array<{ name: string; username: string }> };
  labels?: { nodes: Array<{ title: string }> };
  discussions?: { 
    nodes: Array<{
      id: string;
      notes: {
        nodes: Array<{
          id: string;
          body: string;
          author: { name: string; username: string };
          created_at: string;
          system: boolean;
        }>;
      };
    }>;
  };
  changes: Array<{
    old_path: string;
    new_path: string;
    deleted_file: boolean;
    new_file: boolean;
    renamed_file: boolean;
    diff: string;
  }>;
}

interface ContributorStats {
  username: string;
  commits: number;
  mergeRequests: number;
  reviews: number;
}

interface GitLabProjectMetrics {
  project: ProjectSchema;
  codeQuality: {
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
  };
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
    timeframe: string;
  };
  teamMetrics: {
    reviewParticipation: number;
    codeReviewTurnaround: number;
    averageTimeToMerge: number;
    averageTimeToFirstReview: number;
    averageCommentsPerMR: number;
    activeContributors: number;
    totalCommits: number;
    topContributors: ContributorStats[];
  };
}

// Define GitLabEnvironment interface
interface GitLabEnvironment {
  id: string;
  name: string;
  state: string;
  environmentType: string;
  lastDeployment?: {
    id: string;
    createdAt: string;
    finishedAt: string;
    status: string;
  };
}

// Mock data
const mockProjects: ProjectSchema[] = [
  createMockProjectSchema({
    id: 1,
    name: 'Test Project',
    path_with_namespace: 'test/project1',
    description: 'Test project',
    web_url: 'https://gitlab.com/test/project1',
    visibility: 'private',
    last_activity_at: '2024-01-01T00:00:00Z',
    archived: false,
  })
];

const mockConfig: Config = {
  gitlab: {
    url: 'https://gitlab.com',
    token: 'test-token',
  },
  atlassian: {
    jira_url: 'https://test.atlassian.net',
    jira_token: 'test-token',
    username: 'test-user',
    confluence_url: 'https://test.atlassian.net/wiki',
    confluence_token: 'test-token',
  },
};

// Convert RecentProject to ProjectSchema for type compatibility
function convertRecentToProjectSchema(recent: RecentProject): ProjectSchema {
  return createMockProjectSchema({
    id: 1, // Default ID
    name: recent.name,
    path_with_namespace: recent.path_with_namespace || '',
    description: '',
    web_url: `https://gitlab.com/${recent.path_with_namespace || ''}`,
    visibility: 'private',
    last_activity_at: recent.lastViewed.toISOString(),
    archived: false,
  });
}

const mockRecentProjects: RecentProject[] = [{
  path_with_namespace: 'test/project',
  name: 'Test Project',
  lastViewed: new Date(),
  key: 'test/project'
}];

// For GitLabService.getRecentProjects, convert to ProjectSchema array
const mockRecentProjectSchemas: ProjectSchema[] = 
  mockRecentProjects.map(convertRecentToProjectSchema);

const mockProjectMetrics: GitLabProjectMetrics = {
  project: createMockProjectSchema({
    id: 1,
    name: 'Test Project',
    path_with_namespace: 'test/project1',
    description: 'Test description',
    web_url: 'https://gitlab.com/test/project1',
    visibility: 'private',
    last_activity_at: new Date().toISOString(),
    archived: false
  }),
  codeQuality: {
    grade: 'A',
    coverage: 80,
    bugs: 0,
    vulnerabilities: 0,
    codeSmells: 0,
    securityHotspots: 0,
    hasTests: true,
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
      nodes: []
    },
    hasReadme: true,
    hasContributing: true,
    hasChangelog: true,
    hasLicense: true,
    hasSecurityPolicy: true,
    hasCodeOwners: true,
    hasGitlabCI: true,
    hasPackageJson: true,
    hasComposerJson: false,
    hasRequirementsTxt: false,
    hasGoMod: false,
    hasCargoToml: false,
    hasPomXml: false,
    hasBuildGradle: false,
    hasDockerfile: true,
    hasDockerCompose: true,
    hasPhpUnit: false,
    hasJestConfig: true,
    hasCypress: true,
    hasKarmaConfig: false,
    hasPytestIni: false,
    hasSonarProject: true,
    hasEditorConfig: true,
    hasPrettierrc: true,
    hasEslintrc: true,
    hasGitignore: true,
    hasEnvExample: true,
    hasTerraform: false,
    hasHelmfile: false,
    hasCopilotInstructions: false
  },
  mergeRequests: {
    open: [] as GitLabMergeRequest[],
    merged: [] as GitLabMergeRequest[],
    closed: [] as GitLabMergeRequest[]
  },
  pipelineMetrics: {
    successRate: 100,
    averageDuration: 300,
    running: 0,
    succeeded: 10,
    failed: 0,
    timeframe: '30 days'
  },
  teamMetrics: {
    reviewParticipation: 0.8,
    codeReviewTurnaround: 24,
    averageTimeToMerge: 48,
    averageTimeToFirstReview: 24,
    averageCommentsPerMR: 5,
    activeContributors: 5,
    totalCommits: 100,
    topContributors: [] as ContributorStats[]
  }
};

// Mock DatabaseService
const mockDb = {
  getCachedDashboard: () => Promise.resolve(null),
  getCachedProjectsList: () =>
    Promise.resolve({
      projects: mockProjects,
      timestamp: new Date(),
    }),
  clearDashboardCache: () => Promise.resolve(),
  getRecentProjects: () =>
    Promise.resolve([{
      path_with_namespace: mockProjects[0].path_with_namespace,
      name: mockProjects[0].name,
      lastViewed: new Date(),
    }]),
};

// Helper to capture console output
async function captureConsoleOutput(fn: () => void | Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return logs;
}

// Test setup and cleanup
async function setupTest() {
  // Mock HOME environment variable
  const originalHome = Deno.env.get('HOME');
  await Deno.env.set('HOME', '/tmp/test-home');

  // Create test config directory
  try {
    await Deno.mkdir('/tmp/test-home/.nova', { recursive: true });
  } catch {
    // Directory might already exist
  }

  // Mock Deno.exit to prevent actual exit
  const originalExit = Deno.exit;
  Deno.exit = () => {
    throw new Error('Command attempted to exit');
  };

  // Track fetch requests
  const originalFetch = globalThis.fetch;
  const pendingFetches: Promise<Response>[] = [];
  globalThis.fetch = (...args) => {
    // Mock GraphQL responses
    if (args[1]?.body && typeof args[1].body === 'string' && args[1].body.includes('query')) {
      const mockResponse = new Response(JSON.stringify({
        data: {
          project: {
            pipelineAnalytics: {
              weekPipelinesTotals: [10],
              weekPipelinesSuccessful: [9],
              pipelineTimesValues: [300]
            },
            mergeRequests: { nodes: [] },
            teamMetrics: {
              reviewParticipation: 0.8,
              codeReviewTurnaround: 24
            }
          }
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
      return Promise.resolve(mockResponse);
    }

    const fetchPromise = originalFetch(...args);
    pendingFetches.push(fetchPromise);
    return fetchPromise;
  };

  return {
    cleanup: async () => {
      // Wait for all pending fetches to complete
      await Promise.all(pendingFetches).catch(() => {});
      globalThis.fetch = originalFetch;

      // Restore original HOME
      if (originalHome) {
        await Deno.env.set('HOME', originalHome);
      } else {
        await Deno.env.delete('HOME');
      }

      // Clean up test directory
      try {
        await Deno.remove('/tmp/test-home/.nova', { recursive: true });
      } catch {
        // Directory might not exist
      }

      // Restore original exit
      Deno.exit = originalExit;
    },
  };
}

function teardownTest() {
  // Restore original Deno.exit
  const originalExit = Deno.exit;
  Deno.exit = originalExit;
  
  // Clear any remaining intervals that might be leaking
  const intervalIds = new Array(100).fill(0).map((_, i) => i + 1);
  intervalIds.forEach(clearInterval);
}

Deno.test('GitLab Command Tests', async (t) => {
  const { cleanup } = await setupTest();

  try {
    await t.step('should register all subcommands', () => {
      const commands = gitlabCommand.getCommands();
      assertEquals(commands.length, 3);
      assertEquals(commands.map((cmd) => cmd.getName()).sort(), ['dashboard', 'project', 'projects']);
    });

    await t.step('should show help when no subcommand is provided', async () => {
      const logs = await captureConsoleOutput(async () => {
        await gitlabCommand.parse([]);
      });

      const output = logs.join('\\n');
      assertMatch(output, /GitLab Command/);
      assertMatch(output, /Available Commands/);
    });

    await t.step('projects subcommand - successful case', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectsStub = stub(
        GitLabService.prototype,
        'getProjects',
        () => Promise.resolve(mockProjects),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          await gitlabCommand.parse(['projects']);
        });

        const output = logs.join('\\n');
        assertMatch(output, /Test Project/);
        assertMatch(output, /test\/project1/);

        assertSpyCalls(loadConfigStub, 1);
        assertSpyCalls(getProjectsStub, 1);
      } finally {
        loadConfigStub.restore();
        getProjectsStub.restore();
      }
    });

    await t.step('projects subcommand - JSON output', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectsStub = stub(
        GitLabService.prototype,
        'getProjects',
        () => Promise.resolve(mockProjects),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['projects', '--format', 'json']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        // Find the JSON output in the logs
        const jsonString = logs
          .join('\\n')
          .split('\\n')
          .filter((line) => line.trim().startsWith('{') || line.trim().startsWith('['))
          .join('\\n');

        const jsonOutput = JSON.parse(jsonString);
        
        // Check that the output is an array
        assertEquals(Array.isArray(jsonOutput), true, "Output should be an array");
        
        // Handle the case where the output is a nested array
        const projectData = Array.isArray(jsonOutput[0]) ? jsonOutput[0][0] : jsonOutput[0];
        
        // Check only specific fields that we care about
        assertEquals(projectData.name, mockProjects[0].name);
        assertEquals(projectData.path_with_namespace, mockProjects[0].path_with_namespace);
        assertEquals(projectData.web_url, mockProjects[0].web_url);
        assertEquals(projectData.description, mockProjects[0].description);

        assertSpyCalls(loadConfigStub, 1);
        assertSpyCalls(getProjectsStub, 1);
      } finally {
        loadConfigStub.restore();
        getProjectsStub.restore();
      }
    });

    await t.step('projects subcommand - no projects found', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectsStub = stub(
        GitLabService.prototype,
        'getProjects',
        () => Promise.resolve([]),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['projects']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /No projects found/);

        assertSpyCalls(loadConfigStub, 1);
        assertSpyCalls(getProjectsStub, 1);
      } finally {
        loadConfigStub.restore();
        getProjectsStub.restore();
      }
    });

    await t.step('projects subcommand - unconfigured GitLab', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () =>
        Promise.resolve({
          ...mockConfig,
          gitlab: {
            url: '',
            token: '',
          },
        }));

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['projects']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /GitLab is not configured/);
      } finally {
        loadConfigStub.restore();
      }
    });

    await t.step('projects subcommand - GitLab API error', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectsStub = stub(
        GitLabService.prototype,
        'getProjects',
        () => Promise.reject(new Error('GitLab API error: 401 Unauthorized')),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['projects']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Failed to connect to GitLab/);
      } finally {
        loadConfigStub.restore();
        getProjectsStub.restore();
      }
    });

    await t.step('dashboard command - with recent flag', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getRecentProjectsStub = stub(
        GitLabService.prototype,
        'getRecentProjects',
        () => Promise.resolve(mockRecentProjectSchemas),
      );
      const getProjectDetailsStub = stub(
        GitLabService.prototype,
        'getProjectDetails',
        () => Promise.resolve(mockProjects[0]),
      );
      const getProjectMetricsStub = stub(
        GitLabService.prototype,
        'getProjectMetrics',
        () => Promise.resolve(mockProjectMetrics as GitLabProjectMetrics),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['dashboard', '--recent']);
          } catch (error: unknown) {
            if (error instanceof Error && !error.message.includes('Test attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, new RegExp(mockProjects[0].name));
        assertMatch(output, /Pipeline Performance/);

        assertSpyCalls(loadConfigStub, 1);
        assertSpyCalls(getRecentProjectsStub, 1);
        assertSpyCalls(getProjectDetailsStub, 1);
        assertSpyCalls(getProjectMetricsStub, 1);
      } finally {
        loadConfigStub.restore();
        getRecentProjectsStub.restore();
        getProjectDetailsStub.restore();
        getProjectMetricsStub.restore();
      }
    });

    await t.step('dashboard command - with project key', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectDetailsStub = stub(
        GitLabService.prototype,
        'getProjectDetails',
        () => Promise.resolve(mockProjects[0]),
      );
      const getProjectMetricsStub = stub(
        GitLabService.prototype,
        'getProjectMetrics',
        () => Promise.resolve(mockProjectMetrics as GitLabProjectMetrics),
      );
      const getRecentProjectsStub = stub(
        GitLabService.prototype,
        'getRecentProjects',
        () => Promise.resolve(mockRecentProjectSchemas),
      );
      const selectStub = stub(Select, 'prompt', () => Promise.resolve('test/project1'));
      const dbInstanceStub = stub(
        DatabaseService,
        'getInstance',
        () => Promise.resolve(mockDb as unknown as DatabaseService),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['dashboard', 'test/project1']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Test Project/);
        assertMatch(output, /test\/project1/);
        assertMatch(output, /Pipeline Performance/);
        assertMatch(output, /Project metrics generated successfully/);
      } finally {
        loadConfigStub.restore();
        getProjectDetailsStub.restore();
        getProjectMetricsStub.restore();
        getRecentProjectsStub.restore();
        selectStub.restore();
        dbInstanceStub.restore();
      }
    });

    await t.step('dashboard command - with refresh flag', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getRecentProjectsStub = stub(
        GitLabService.prototype,
        'getRecentProjects',
        () => Promise.resolve(mockRecentProjectSchemas)
      );
      const getProjectDetailsStub = stub(
        GitLabService.prototype,
        'getProjectDetails',
        () => Promise.resolve(mockProjects[0]),
      );
      const getProjectMetricsStub = stub(
        GitLabService.prototype,
        'getProjectMetrics',
        () => Promise.resolve(mockProjectMetrics as GitLabProjectMetrics)
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['dashboard', '--recent', '--refresh']);
          } catch (error: unknown) {
            if (error instanceof Error && !error.message.includes('Test attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, new RegExp(mockProjects[0].name));

        assertSpyCalls(loadConfigStub, 1);
        assertSpyCalls(getRecentProjectsStub, 1);
        assertSpyCalls(getProjectDetailsStub, 1);
        assertSpyCalls(getProjectMetricsStub, 1);
      } finally {
        loadConfigStub.restore();
        getRecentProjectsStub.restore();
        getProjectDetailsStub.restore();
        getProjectMetricsStub.restore();
      }
    });

    await t.step('dashboard command - JSON output', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getRecentProjectsStub = stub(
        GitLabService.prototype,
        'getRecentProjects',
        () => Promise.resolve(mockRecentProjectSchemas)
      );
      const getProjectDetailsStub = stub(
        GitLabService.prototype,
        'getProjectDetails',
        () => Promise.resolve(mockProjects[0]),
      );
      const getProjectMetricsStub = stub(
        GitLabService.prototype,
        'getProjectMetrics',
        () => Promise.resolve(mockProjectMetrics)
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['dashboard', '--recent', '--format', 'json']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        // Find the JSON output in the logs
        const jsonString = logs
          .join('\\n')
          .split('\\n')
          .filter((line) => line.trim().startsWith('{') || line.trim().startsWith('['))
          .join('');

        const jsonOutput = JSON.parse(jsonString);
        assertEquals(typeof jsonOutput.timestamp, 'string');
        assertEquals(jsonOutput.project.name, mockProjects[0].name);
        assertEquals(
          jsonOutput.metrics.teamMetrics.totalCommits,
          mockProjectMetrics.teamMetrics.totalCommits,
        );

        assertSpyCalls(loadConfigStub, 1);
        assertSpyCalls(getRecentProjectsStub, 1);
        assertSpyCalls(getProjectDetailsStub, 1);
        assertSpyCalls(getProjectMetricsStub, 1);
      } finally {
        loadConfigStub.restore();
        getRecentProjectsStub.restore();
        getProjectDetailsStub.restore();
        getProjectMetricsStub.restore();
      }
    });

    await t.step('dashboard command - error handling', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectDetailsStub = stub(
        GitLabService.prototype,
        'getProjectDetails',
        () => Promise.reject(new Error('GitLab API error: 401 Unauthorized')),
      );
      const getRecentProjectsStub = stub(
        GitLabService.prototype,
        'getRecentProjects',
        () => Promise.resolve(mockRecentProjectSchemas)
      );
      const selectStub = stub(Select, 'prompt', () => Promise.resolve('test/project1'));
      const dbInstanceStub = stub(
        DatabaseService,
        'getInstance',
        () => Promise.resolve(mockDb as unknown as DatabaseService),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['dashboard', 'test/project1']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Error fetching metrics: GitLab API error: 401 Unauthorized/);
      } finally {
        loadConfigStub.restore();
        getProjectDetailsStub.restore();
        getRecentProjectsStub.restore();
        selectStub.restore();
        dbInstanceStub.restore();
      }
    });

    await t.step('invalid format option', async () => {
      try {
        await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['projects', '--format', 'invalid']);
          } catch (error: unknown) {
            if (error instanceof Error && !error.message.includes('Test attempted to exit')) {
              throw error;
            }
          }
        });
      } catch (error) {
        assertMatch(String(error), /Format must be either "text" or "json"/);
      }
    });

    await t.step('dashboard command - with namespace', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectsStub = stub(
        GitLabService.prototype,
        'getProjects',
        () => Promise.resolve(mockProjects),
      );
      const selectStub = stub(Select, 'prompt', () => Promise.resolve('test/project1'));
      const getProjectDetailsStub = stub(
        GitLabService.prototype,
        'getProjectDetails',
        () => Promise.resolve(mockProjects[0]),
      );
      const getProjectMetricsStub = stub(
        GitLabService.prototype,
        'getProjectMetrics',
        () => Promise.resolve(mockProjectMetrics)
      );
      const getRecentProjectsStub = stub(
        GitLabService.prototype,
        'getRecentProjects',
        () => Promise.resolve(mockRecentProjectSchemas)
      );
      const dbInstanceStub = stub(
        DatabaseService,
        'getInstance',
        () => Promise.resolve(mockDb as unknown as DatabaseService),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['dashboard', 'test']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Test Project/);
        assertMatch(output, /Pipeline Performance/);
        assertMatch(output, /Project metrics generated successfully/);
      } finally {
        loadConfigStub.restore();
        getProjectsStub.restore();
        selectStub.restore();
        getProjectDetailsStub.restore();
        getProjectMetricsStub.restore();
        getRecentProjectsStub.restore();
        dbInstanceStub.restore();
      }
    });

    await t.step('dashboard command - with custom query', async () => {
      const loadConfigStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
      const getProjectsStub = stub(
        GitLabService.prototype,
        'getProjects',
        () => Promise.resolve(mockProjects),
      );
      const selectStub = stub(Select, 'prompt', () => Promise.resolve('test/project1'));
      const getProjectDetailsStub = stub(
        GitLabService.prototype,
        'getProjectDetails',
        () => Promise.resolve(mockProjects[0]),
      );
      const getProjectMetricsStub = stub(
        GitLabService.prototype,
        'getProjectMetrics',
        () => Promise.resolve(mockProjectMetrics)
      );
      const getRecentProjectsStub = stub(
        GitLabService.prototype,
        'getRecentProjects',
        () => Promise.resolve(mockRecentProjectSchemas)
      );
      const dbInstanceStub = stub(
        DatabaseService,
        'getInstance',
        () => Promise.resolve(mockDb as unknown as DatabaseService),
      );

      try {
        const logs = await captureConsoleOutput(async () => {
          try {
            await gitlabCommand.parse(['dashboard', '--query', 'Test Project']);
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Command attempted to exit')) {
              throw error;
            }
          }
        });

        const output = logs.join('\\n');
        assertMatch(output, /Test Project/);
        assertMatch(output, /Found matching project/);
        assertMatch(output, /Pipeline Performance/);
        assertMatch(output, /Project metrics generated successfully/);
      } finally {
        loadConfigStub.restore();
        getProjectsStub.restore();
        selectStub.restore();
        getProjectDetailsStub.restore();
        getProjectMetricsStub.restore();
        getRecentProjectsStub.restore();
        dbInstanceStub.restore();
      }
    });
  } finally {
    teardownTest();
    await cleanup();
  }
});
