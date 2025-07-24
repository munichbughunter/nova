import { Command } from '@cliffy/command';
import { assert, assertEquals, assertExists } from '@std/assert';
import { assertSpyCalls, stub } from '@std/testing/mock';
import { Config, configManager } from '../config/mod.ts';
import {
    JiraService,
} from '../services/jira_service.ts';
import { jiraCommand } from './jira.ts';

// Mock data
const mockProject = {
  id: 'test-id',
  key: 'TEST',
  name: 'Test Project',
  projectTypeKey: 'software',
  simplified: false,
  style: 'classic',
  isPrivate: false,
  url: 'https://test.atlassian.net/browse/TEST',
  lead: {
    accountId: 'test-account',
    displayName: 'Test Lead',
    emailAddress: 'test@example.com',
  },
  description: 'Test Description',
};

const mockProjectMetrics: JiraProjectMetrics = {
  project: mockProject,
  issues: {
    total: 10,
    open: 5,
    inProgress: 3,
    done: 2,
    backlog: 0,
    bugs: 5,
    features: 5,
    technicalDebt: 25,
    byStatus: {},
    byType: {},
    byMember: {}
  },
  members: [
    {
      displayName: 'Test Lead',
      emailAddress: 'test@example.com',
      accountId: 'test-account-1',
      active: true
    },
    {
      displayName: 'Member 1',
      emailAddress: 'member1@example.com',
      accountId: 'test-account-2',
      active: true
    },
    {
      displayName: 'Member 2',
      emailAddress: 'member2@example.com',
      accountId: 'test-account-3',
      active: true
    }
  ],
  timeline: {
    created: [{ count: 5 }, { count: 5 }],
    resolved: [{ count: 2 }, { count: 0 }],
    updated: [{ count: 150 }],
    comments: [{ count: 20 }]
  },
  bottlenecks: [],
  healthScore: {
    current: 7,
    historical: 8,
    combined: 7.5,
    trends: {
      velocity: 'stable',
      completion: 'improving',
      scope: 'stable'
    }
  }
};

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

const mockIssue = {
  id: 'TEST-1',
  key: 'TEST-1',
  fields: {
    summary: 'Test Issue',
    description: 'Test Description',
    created: '2024-01-01',
    resolutiondate: '2024-01-02',
    updated: '2024-01-02',
    status: {
      name: 'In Progress',
      statusCategory: {
        key: 'indeterminate',
        name: 'In Progress',
      },
    },
    issuetype: {
      name: 'Task',
      iconUrl: 'test-url',
    },
    priority: {
      name: 'High',
      iconUrl: 'test-url',
    },
    assignee: {
      displayName: 'Test Assignee',
      emailAddress: 'test.assignee@example.com',
    },
    reporter: {
      displayName: 'Test Reporter',
      emailAddress: 'test.reporter@example.com',
    },
    project: {
      key: 'TEST',
      name: 'Test Project'
    }
  },
};

const mockMetrics: JiraProjectMetrics = {
  project: {
    id: '1',
    key: 'TEST',
    name: 'Test Project',
    projectTypeKey: 'software',
    simplified: false,
    style: 'classic',
    isPrivate: false,
    url: 'https://jira.example.com/projects/TEST',
    lead: {
      accountId: '123',
      displayName: 'Test User',
      emailAddress: 'test@example.com'
    },
    description: 'Test project description'
  },
  issues: {
    total: 100,
    open: 20,
    inProgress: 30,
    done: 40,
    backlog: 10,
    bugs: 15,
    features: 60,
    technicalDebt: 25,
    byStatus: {},
    byType: {},
    byMember: {}
  },
  members: [
    {
      displayName: 'John Doe',
      emailAddress: 'john@example.com',
      accountId: 'user123',
      active: true
    },
    {
      displayName: 'Jane Smith',
      emailAddress: 'jane@example.com',
      accountId: 'user456',
      active: true
    },
    {
      displayName: 'Bob Wilson',
      emailAddress: 'bob@example.com',
      accountId: 'user789',
      active: true
    }
  ],
  timeline: {
    created: [{ count: 10 }],
    resolved: [{ count: 8 }],
    updated: [{ count: 15 }],
    comments: [{ count: 25 }]
  },
  bottlenecks: [],
  healthScore: {
    current: 7,
    historical: 8,
    combined: 7.5,
    trends: {
      velocity: 'stable',
      completion: 'improving',
      scope: 'stable'
    }
  }
};

Deno.test('Jira command - basic structure', () => {
  assertExists(jiraCommand);
  assertEquals(jiraCommand instanceof Command, true);
  assertEquals(jiraCommand.getName(), 'jira');
  assertEquals(jiraCommand.getDescription(), 'Jira operations');
});

Deno.test('Jira command - subcommands', () => {
  const subcommands = jiraCommand.getCommands();

  // Test projects subcommand
  const projectsCmd = subcommands.find((cmd: Command) => cmd.getName() === 'projects');
  assertExists(projectsCmd);
  assertEquals(projectsCmd.getName(), 'projects');

  const projectsOptions = projectsCmd.getOptions();
  const formatOption = projectsOptions.find((opt) => opt.flags.includes('--format'));
  assertExists(formatOption);
  assertEquals(formatOption.flags.includes('--format'), true);

  // Test issues subcommand
  const issuesCmd = subcommands.find((cmd: Command) => cmd.getName() === 'issues');
  assertExists(issuesCmd);
  assertEquals(issuesCmd.getName(), 'issues');

  const issuesOptions = issuesCmd.getOptions();
  const projectOption = issuesOptions.find((opt) => opt.flags.includes('--project'));
  const queryOption = issuesOptions.find((opt) => opt.flags.includes('--query'));
  const limitOption = issuesOptions.find((opt) => opt.flags.includes('--limit'));

  assertExists(projectOption);
  assertExists(queryOption);
  assertExists(limitOption);

  // Test dashboard subcommand
  const dashboardCmd = subcommands.find((cmd: Command) => cmd.getName() === 'dashboard');
  assertExists(dashboardCmd);
  assertEquals(dashboardCmd.getName(), 'dashboard');

  const dashboardOptions = dashboardCmd.getOptions();
  const dashboardFormatOption = dashboardOptions.find((opt) => opt.flags.includes('--format'));
  const daysOption = dashboardOptions.find((opt) => opt.flags.includes('--days'));
  const recentOption = dashboardOptions.find((opt) => opt.flags.includes('--recent'));
  const refreshOption = dashboardOptions.find((opt) => opt.flags.includes('--refresh'));

  assertExists(dashboardFormatOption);
  assertExists(daysOption);
  assertExists(recentOption);
  assertExists(refreshOption);
});

// Mock test for projects functionality
Deno.test({
  name: 'Jira command - projects execution',
  fn: async () => {
    // Create stubs for external dependencies
    const configStub = stub(configManager, 'loadConfig', () =>
      Promise.resolve({
        gitlab: {
          url: 'https://gitlab.example.com',
          token: 'test-token',
        },
        atlassian: {
          jira_url: 'https://test.atlassian.net',
          jira_token: 'test-token',
          confluence_url: 'https://test.atlassian.net',
          confluence_token: 'test-token',
          username: 'test@example.com',
        },
      }));

    const mockProjects: JiraProject[] = [mockProject];

    const jiraServiceStub = stub(
      JiraService.prototype,
      'getProjects',
      () => Promise.resolve(mockProjects),
    );

    try {
      // Execute projects command with JSON format to avoid table output
      await jiraCommand.parse(['projects', '--format', 'json']);

      // Verify stubs were called
      assertEquals(configStub.calls.length, 1);
      assertEquals(jiraServiceStub.calls.length, 1);

      // Verify the arguments passed to getProjects
      assertEquals(jiraServiceStub.calls[0].args.length, 0);
    } finally {
      // Clean up stubs
      configStub.restore();
      jiraServiceStub.restore();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Mock test for dashboard functionality with project key
Deno.test({
  name: 'Jira command - dashboard execution with project key',
  fn: async () => {
    // Create stubs for external dependencies
    const configStub = stub(configManager, 'loadConfig', () =>
      Promise.resolve({
        gitlab: {
          url: 'https://gitlab.example.com',
          token: 'test-token',
        },
        atlassian: {
          jira_url: 'https://test.atlassian.net',
          jira_token: 'test-token',
          confluence_url: 'https://test.atlassian.net',
          confluence_token: 'test-token',
          username: 'test@example.com',
        },
      }));

    const mockProjects: JiraProject[] = [mockProject];

    const getProjectsStub = stub(
      JiraService.prototype,
      'getProjects',
      () => Promise.resolve(mockProjects),
    );
    const getProjectMetricsStub = stub(
      JiraService.prototype,
      'getProjectMetrics',
      () => Promise.resolve(mockProjectMetrics),
    );

    try {
      // Execute dashboard command with project key and JSON format
      await jiraCommand.parse(['dashboard', 'TEST', '--format', 'json']);

      // Verify stubs were called
      assertEquals(configStub.calls.length, 1);
      assertEquals(getProjectMetricsStub.calls.length, 1);
      assertEquals(getProjectMetricsStub.calls[0].args[0], 'TEST');
    } finally {
      // Clean up stubs
      configStub.restore();
      getProjectsStub.restore();
      getProjectMetricsStub.restore();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Mock test for dashboard functionality with recent flag
Deno.test({
  name: 'Jira command - dashboard execution with recent flag',
  fn: async () => {
    // Create stubs for external dependencies
    const configStub = stub(configManager, 'loadConfig', () =>
      Promise.resolve({
        gitlab: {
          url: 'https://gitlab.example.com',
          token: 'test-token',
        },
        atlassian: {
          jira_url: 'https://test.atlassian.net',
          jira_token: 'test-token',
          confluence_url: 'https://test.atlassian.net',
          confluence_token: 'test-token',
          username: 'test@example.com',
        },
      }));

    const mockProjects: JiraProject[] = [mockProject];

    // Mock database service
    const getRecentProjectsStub = stub(
      JiraService.prototype,
      'getRecentProjects',
      () =>
        Promise.resolve([{
          key: 'TEST',
          name: 'Test Project',
          lastViewed: new Date(),
        }] as RecentProject[]),
    );

    const getProjectsStub = stub(
      JiraService.prototype,
      'getProjects',
      () => Promise.resolve(mockProjects),
    );
    const getProjectMetricsStub = stub(
      JiraService.prototype,
      'getProjectMetrics',
      () => Promise.resolve(mockProjectMetrics),
    );

    try {
      // Execute dashboard command with recent flag and JSON format
      await jiraCommand.parse(['dashboard', '--recent', '--format', 'json']);

      // Verify stubs were called
      assertEquals(configStub.calls.length, 1);
      assertEquals(getRecentProjectsStub.calls.length, 1);
      assertEquals(getProjectMetricsStub.calls.length, 1);
      assertEquals(getProjectMetricsStub.calls[0].args[0], 'TEST');
    } finally {
      // Clean up stubs
      configStub.restore();
      getRecentProjectsStub.restore();
      getProjectsStub.restore();
      getProjectMetricsStub.restore();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test('Jira Command Tests', async (t) => {
  await t.step('projects command - successful case', async () => {
    const configStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
    const consoleLogStub = stub(console, 'log');
    const getProjectsStub = stub(
      JiraService.prototype,
      'getProjects',
      () => Promise.resolve([mockProject]),
    );

    try {
      await jiraCommand.parse(['projects']);

      assertSpyCalls(configStub, 1);
      assertSpyCalls(getProjectsStub, 1);

      const output = consoleLogStub.calls.map((call) => call.args.join(' ')).join('\\n');
      assert(output.includes('Test Project'));
      assert(output.includes('TEST'));
      assert(output.includes('Test Lead'));
    } finally {
      configStub.restore();
      consoleLogStub.restore();
      getProjectsStub.restore();
    }
  });

  await t.step('projects command - JSON output', async () => {
    const configStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
    const consoleLogStub = stub(console, 'log');
    const getProjectsStub = stub(
      JiraService.prototype,
      'getProjects',
      () => Promise.resolve([mockProject]),
    );

    try {
      await jiraCommand.parse(['projects', '--format', 'json']);

      assertSpyCalls(configStub, 1);
      assertSpyCalls(getProjectsStub, 1);

      // Get the last console.log call which should contain the JSON
      const lastOutput = consoleLogStub.calls[consoleLogStub.calls.length - 1].args[0];
      const jsonOutput = JSON.parse(lastOutput);
      
      // Handle potentially nested array structure
      const projectData = Array.isArray(jsonOutput[0]) ? jsonOutput[0][0] : jsonOutput[0];
      assertEquals(projectData.key, mockProject.key);
    } finally {
      configStub.restore();
      consoleLogStub.restore();
      getProjectsStub.restore();
    }
  });

  await t.step('projects command - no projects found', async () => {
    const configStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
    const consoleLogStub = stub(console, 'log');
    const getProjectsStub = stub(JiraService.prototype, 'getProjects', () => Promise.resolve([]));

    try {
      await jiraCommand.parse(['projects']);

      assertSpyCalls(configStub, 1);
      assertSpyCalls(getProjectsStub, 1);

      const output = consoleLogStub.calls.map((call) => call.args.join(' ')).join('\\n');
      assert(output.includes('No projects found'));
    } finally {
      configStub.restore();
      consoleLogStub.restore();
      getProjectsStub.restore();
    }
  });

  await t.step('projects command - unconfigured Jira', async () => {
    const configStub = stub(configManager, 'loadConfig', () =>
      Promise.resolve({
        gitlab: {
          url: 'https://gitlab.com',
          token: 'test-token',
        },
      } as Config));
    const consoleErrorStub = stub(console, 'error');
    let exitCode = 0;
    const exitStub = stub(Deno, 'exit', (code?: number) => {
      exitCode = code || 0;
      throw new Error('Test exit');
    });

    try {
      try {
        await jiraCommand.parse(['projects']);
      } catch (error: unknown) {
        if (!(error instanceof Error) || error.message !== 'Test exit') throw error;
      }

      assertEquals(exitCode, 1);
      assertEquals(consoleErrorStub.calls.length, 2);
    } finally {
      configStub.restore();
      consoleErrorStub.restore();
      exitStub.restore();
    }
  });

  await t.step('issues command - with project key', async () => {
    const configStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
    const consoleLogStub = stub(console, 'log');
    const searchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ issues: [mockIssue] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    );

    try {
      await jiraCommand.parse(['issues', '--project', 'TEST']);

      assertSpyCalls(configStub, 1);

      const output = consoleLogStub.calls.map((call) => call.args.join(' ')).join('\\n');
      assert(output.includes('TEST-1'));
      assert(output.includes('Test Issue'));
    } finally {
      configStub.restore();
      consoleLogStub.restore();
      searchStub.restore();
    }
  });

  await t.step('issues command - with custom query', async () => {
    const configStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
    const consoleLogStub = stub(console, 'log');
    const searchStub = stub(
      JiraService.prototype,
      'searchIssues',
      (jql: string) => {
        assertEquals(jql, 'project = TEST AND status = "In Progress"');
        return Promise.resolve({ issues: [mockIssue] });
      },
    );

    try {
      await jiraCommand.parse(['issues', '--query', 'project = TEST AND status = "In Progress"']);
      assertSpyCalls(configStub, 1);
      assertSpyCalls(searchStub, 1);
    } finally {
      configStub.restore();
      consoleLogStub.restore();
      searchStub.restore();
    }
  });

  await t.step('dashboard command - with project key', async () => {
    const configStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
    const consoleLogStub = stub(console, 'log');
    const getProjectMetricsStub = stub(
      JiraService.prototype,
      'getProjectMetrics',
      () => Promise.resolve(mockMetrics),
    );

    try {
      await jiraCommand.parse(['dashboard', 'TEST']);

      assertSpyCalls(configStub, 1);
      assertSpyCalls(getProjectMetricsStub, 1);

      const output = consoleLogStub.calls.map((call) => call.args.join(' ')).join('\\n');
      assert(output.includes('Test Project'));
      assert(output.includes('Total Issues'));
    } finally {
      configStub.restore();
      consoleLogStub.restore();
      getProjectMetricsStub.restore();
    }
  });

  await t.step('dashboard command - with recent flag', async () => {
    const configStub = stub(configManager, 'loadConfig', () => Promise.resolve(mockConfig));
    const consoleLogStub = stub(console, 'log');
    const getRecentProjectsStub = stub(
      JiraService.prototype,
      'getRecentProjects',
      () =>
        Promise.resolve([{
          key: 'TEST',
          name: 'Test Project',
          lastViewed: new Date(),
        }] as RecentProject[]),
    );

    const getProjectsStub = stub(
      JiraService.prototype,
      'getProjects',
      () => Promise.resolve([mockProject]),
    );
    const getProjectMetricsStub = stub(
      JiraService.prototype,
      'getProjectMetrics',
      () => Promise.resolve(mockProjectMetrics),
    );

    try {
      await jiraCommand.parse(['dashboard', '--recent', '--format', 'json']);
      assertSpyCalls(configStub, 1);
      assertSpyCalls(getRecentProjectsStub, 1);
      assertSpyCalls(getProjectMetricsStub, 1);
      assertEquals(getProjectMetricsStub.calls[0].args[0], 'TEST');
    } finally {
      configStub.restore();
      consoleLogStub.restore();
      getRecentProjectsStub.restore();
      getProjectsStub.restore();
      getProjectMetricsStub.restore();
    }
  });
});
