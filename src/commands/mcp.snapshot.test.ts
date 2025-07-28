import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { snapshotTest } from '@cliffy/testing';
import { formatLocaleDate } from '../../src/utils.ts';

// Mock project data for MCP
const mockProjects = [
  {
    id: 'project-1',
    name: 'Frontend App',
    repository: 'git@github.com:example/frontend-app.git',
    description: 'Main frontend application',
    lastDeployed: '2023-06-20T10:15:00Z',
    branch: 'main',
    status: 'running',
  },
  {
    id: 'project-2',
    name: 'Backend API',
    repository: 'git@github.com:example/backend-api.git',
    description: 'REST API service',
    lastDeployed: '2023-06-19T15:30:00Z',
    branch: 'main',
    status: 'running',
  },
  {
    id: 'project-3',
    name: 'Database Service',
    repository: 'git@github.com:example/db-service.git',
    description: 'Database integration service',
    lastDeployed: '2023-06-15T09:45:00Z',
    branch: 'develop',
    status: 'stopped',
  },
];

// Mock environment data for MCP
const mockEnvironments = [
  {
    id: 'env-1',
    name: 'production',
    region: 'us-west-2',
    status: 'active',
    projects: ['project-1', 'project-2'],
  },
  {
    id: 'env-2',
    name: 'staging',
    region: 'us-west-2',
    status: 'active',
    projects: ['project-1', 'project-2', 'project-3'],
  },
  {
    id: 'env-3',
    name: 'development',
    region: 'us-east-1',
    status: 'active',
    projects: ['project-1', 'project-2', 'project-3'],
  },
];

// Mock deployment data for MCP
const mockDeployments = [
  {
    id: 'deploy-1',
    projectId: 'project-1',
    environment: 'production',
    version: 'v1.2.3',
    timestamp: '2023-06-20T10:15:00Z',
    status: 'success',
    duration: 180, // in seconds
    committer: 'jane.doe',
  },
  {
    id: 'deploy-2',
    projectId: 'project-2',
    environment: 'production',
    version: 'v2.1.0',
    timestamp: '2023-06-19T15:30:00Z',
    status: 'success',
    duration: 210, // in seconds
    committer: 'john.smith',
  },
  {
    id: 'deploy-3',
    projectId: 'project-3',
    environment: 'staging',
    version: 'v0.9.5',
    timestamp: '2023-06-15T09:45:00Z',
    status: 'failed',
    duration: 156, // in seconds
    committer: 'alice.johnson',
  },
];

// Test MCP Projects command with text output
await snapshotTest({
  name: 'MCP Projects Command - Text Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nProjects:\n'));

    const table = new Table()
      .header([
        colors.bold.white('Name'),
        colors.bold.white('Description'),
        colors.bold.white('Status'),
        colors.bold.white('Last Deployed'),
        colors.bold.white('Branch'),
      ])
      .border(true)
      .padding(1);

    mockProjects.forEach((project) => {
      table.push([
        project.name,
        project.description,
        project.status === 'running' ? colors.green(project.status) : colors.red(project.status),
        formatLocaleDate(project.lastDeployed),
        project.branch,
      ]);
    });

    console.log(table.toString() + '\n');
    console.log(colors.dim(`Total projects: ${mockProjects.length}\n`));
  },
});

// Test MCP Projects command with JSON output
await snapshotTest({
  name: 'MCP Projects Command - JSON Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(JSON.stringify(mockProjects, null, 2));
  },
});

// Test MCP Environments command with text output
await snapshotTest({
  name: 'MCP Environments Command - Text Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nEnvironments:\n'));

    const table = new Table()
      .header([
        colors.bold.white('Name'),
        colors.bold.white('Region'),
        colors.bold.white('Status'),
        colors.bold.white('Projects'),
      ])
      .border(true)
      .padding(1);

    mockEnvironments.forEach((env) => {
      table.push([
        env.name,
        env.region,
        env.status === 'active' ? colors.green(env.status) : colors.yellow(env.status),
        env.projects.length.toString(),
      ]);
    });

    console.log(table.toString() + '\n');
    console.log(colors.dim(`Total environments: ${mockEnvironments.length}\n`));
  },
});

// Test MCP Deployments command with text output
await snapshotTest({
  name: 'MCP Deployments Command - Text Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nRecent Deployments:\n'));

    const table = new Table()
      .header([
        colors.bold.white('Project'),
        colors.bold.white('Environment'),
        colors.bold.white('Version'),
        colors.bold.white('Status'),
        colors.bold.white('Deployed At'),
        colors.bold.white('Duration'),
        colors.bold.white('By'),
      ])
      .border(true)
      .padding(1);

    mockDeployments.forEach((deployment) => {
      // Find project name
      const project = mockProjects.find((p) => p.id === deployment.projectId);
      const projectName = project ? project.name : deployment.projectId;

      table.push([
        projectName,
        deployment.environment,
        deployment.version,
        deployment.status === 'success'
          ? colors.green(deployment.status)
          : colors.red(deployment.status),
        formatLocaleDate(deployment.timestamp),
        `${Math.floor(deployment.duration / 60)}m ${deployment.duration % 60}s`,
        deployment.committer,
      ]);
    });

    console.log(table.toString() + '\n');
    console.log(colors.dim(`Total deployments: ${mockDeployments.length}\n`));
  },
});

// Test MCP Project Detail view
await snapshotTest({
  name: 'MCP Project Detail',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    const project = mockProjects[0];
    const deployments = mockDeployments.filter((d) => d.projectId === project.id);

    console.log(colors.blue(`\nProject: ${project.name}\n`));
    console.log(colors.bold('ID:'), project.id);
    console.log(colors.bold('Description:'), project.description);
    console.log(colors.bold('Repository:'), project.repository);
    console.log(colors.bold('Branch:'), project.branch);
    console.log(
      colors.bold('Status:'),
      project.status === 'running' ? colors.green(project.status) : colors.red(project.status),
    );
    console.log(colors.bold('Last Deployed:'), formatLocaleDate(project.lastDeployed));

    console.log(colors.blue('\nDeployments:\n'));

    if (deployments.length > 0) {
      const table = new Table()
        .header([
          colors.bold.white('Environment'),
          colors.bold.white('Version'),
          colors.bold.white('Status'),
          colors.bold.white('Deployed At'),
          colors.bold.white('By'),
        ])
        .border(true)
        .padding(1);

      deployments.forEach((deployment) => {
        table.push([
          deployment.environment,
          deployment.version,
          deployment.status === 'success'
            ? colors.green(deployment.status)
            : colors.red(deployment.status),
          formatLocaleDate(deployment.timestamp),
          deployment.committer,
        ]);
      });

      console.log(table.toString() + '\n');
    } else {
      console.log(colors.yellow('No deployments found for this project.\n'));
    }
  },
});

// NEW TESTS FOR JSON OUTPUT AND PIPELINE SCENARIOS

// Test MCP Environments command with JSON output
await snapshotTest({
  name: 'MCP Environments Command - JSON Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(JSON.stringify(mockEnvironments, null, 2));
  },
});

// Test MCP Deployments command with JSON output
await snapshotTest({
  name: 'MCP Deployments Command - JSON Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(JSON.stringify(mockDeployments, null, 2));
  },
});

// Test Pipeline Scenario 1: Filter running projects
await snapshotTest({
  name: 'Pipeline: Filter Running Projects',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(
      colors.blue(
        '\nPipeline Example: nova mcp projects --format json | jq \'.[] | select(.status=="running")\'\n',
      ),
    );

    // Simulate the jq filter operation
    const runningProjects = mockProjects.filter((project) => project.status === 'running');

    console.log(JSON.stringify(runningProjects, null, 2));
    console.log(colors.dim(`\nFound ${runningProjects.length} running projects\n`));
  },
});

// Test Pipeline Scenario 2: List project names and repositories
await snapshotTest({
  name: 'Pipeline: Extract Project Names and Repositories',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(
      colors.blue(
        '\nPipeline Example: nova mcp projects --format json | jq -r \'.[] | "\\(.name) - \\(.repository)"\'\n',
      ),
    );

    // Simulate the jq string transformation
    mockProjects.forEach((project) => {
      console.log(`${project.name} - ${project.repository}`);
    });
  },
});

// Test Pipeline Scenario 3: Count projects by status
await snapshotTest({
  name: 'Pipeline: Count Projects by Status',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(
      colors.blue(
        "\nPipeline Example: nova mcp projects --format json | jq 'group_by(.status) | map({status: .[0].status, count: length})'\n",
      ),
    );

    // Simulate the jq grouping operation
    const statusCounts = Object.entries(
      mockProjects.reduce((acc, project) => {
        acc[project.status] = (acc[project.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    ).map(([status, count]) => ({ status, count }));

    console.log(JSON.stringify(statusCounts, null, 2));
  },
});

// Test Pipeline Scenario 4: Join projects with deployments
await snapshotTest({
  name: 'Pipeline: Join Projects with Deployments',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(
      colors.blue(
        '\nPipeline Example: Complex JQ transformation to join project data with deployment history\n',
      ),
    );

    // Simulate a complex jq transformation that joins projects with their deployment history
    const projectsWithDeployments = mockProjects.map((project) => {
      const projectDeployments = mockDeployments
        .filter((d) => d.projectId === project.id)
        .map((d) => ({
          environment: d.environment,
          version: d.version,
          timestamp: d.timestamp,
          status: d.status,
          committer: d.committer,
        }));

      return {
        name: project.name,
        status: project.status,
        branch: project.branch,
        deployments: projectDeployments,
        deploymentCount: projectDeployments.length,
      };
    });

    console.log(JSON.stringify(projectsWithDeployments, null, 2));
  },
});

// Test Pipeline Scenario 5: Generate deployment report
await snapshotTest({
  name: 'Pipeline: Generate Deployment Report',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nPipeline Example: Creating a deployment summary report with jq\n'));

    // Simulate creating a deployment report with jq
    const deploymentReport = {
      totalDeployments: mockDeployments.length,
      successfulDeployments: mockDeployments.filter((d) => d.status === 'success').length,
      failedDeployments: mockDeployments.filter((d) => d.status === 'failed').length,
      averageDuration: Math.round(
        mockDeployments.reduce((sum, d) => sum + d.duration, 0) / mockDeployments.length,
      ),
      environments: Object.entries(
        mockDeployments.reduce((acc, d) => {
          acc[d.environment] = (acc[d.environment] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      ).map(([env, count]) => ({ environment: env, deployments: count })),
      deployers: Object.entries(
        mockDeployments.reduce((acc, d) => {
          acc[d.committer] = (acc[d.committer] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      ).map(([committer, count]) => ({ committer, deployments: count })),
    };

    console.log(JSON.stringify(deploymentReport, null, 2));
  },
});
