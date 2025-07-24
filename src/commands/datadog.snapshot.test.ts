import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { snapshotTest } from '@cliffy/testing';
import { formatLocaleDate } from '../../src/utils.ts';

// Mock Datadog team data
const mockTeams = [
  {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Platform Engineering',
    handle: 'platform-team',
    description: 'Team responsible for platform infrastructure',
    user_count: 8,
    created_at: '2023-01-15T10:00:00Z',
    updated_at: '2023-05-20T14:30:00Z',
  },
  {
    id: '234e5678-e89b-12d3-a456-426614174001',
    name: 'Frontend Development',
    handle: 'frontend-team',
    description: 'Team responsible for user interfaces',
    user_count: 12,
    created_at: '2023-02-10T09:15:00Z',
    updated_at: '2023-06-01T11:20:00Z',
  },
  {
    id: '345e6789-e89b-12d3-a456-426614174002',
    name: 'Security Operations',
    handle: 'security-team',
    description: 'Team responsible for security monitoring',
    user_count: 5,
    created_at: '2023-03-05T08:30:00Z',
    updated_at: '2023-05-25T16:45:00Z',
  },
];

// Mock Datadog dashboard data
const mockDashboards = [
  {
    id: 'abc-123',
    title: 'API Performance Dashboard',
    description: 'Tracks API latency and error rates',
    created_at: '2023-04-12T10:30:00Z',
    modified_at: '2023-06-18T15:20:00Z',
    author: {
      name: 'Jane Smith',
      handle: 'jane.smith',
    },
    url: 'https://app.datadoghq.com/dashboard/abc-123',
  },
  {
    id: 'def-456',
    title: 'Infrastructure Overview',
    description: 'System-wide infrastructure metrics',
    created_at: '2023-03-20T09:00:00Z',
    modified_at: '2023-06-15T11:10:00Z',
    author: {
      name: 'John Doe',
      handle: 'john.doe',
    },
    url: 'https://app.datadoghq.com/dashboard/def-456',
  },
  {
    id: 'ghi-789',
    title: 'User Activity',
    description: 'User login and engagement metrics',
    created_at: '2023-05-05T14:45:00Z',
    modified_at: '2023-06-10T08:30:00Z',
    author: {
      name: 'Alice Johnson',
      handle: 'alice.johnson',
    },
    url: 'https://app.datadoghq.com/dashboard/ghi-789',
  },
];

// Mock Datadog metrics data
const mockMetrics = [
  {
    name: 'api.requests.count',
    tags: ['service:api', 'environment:production'],
    values: [120, 145, 132, 156, 178, 190, 163],
    timestamp: '2023-06-20T00:00:00Z',
    interval: 3600, // hourly data
  },
  {
    name: 'api.response_time',
    tags: ['service:api', 'environment:production'],
    values: [0.12, 0.14, 0.11, 0.18, 0.21, 0.19, 0.17],
    timestamp: '2023-06-20T00:00:00Z',
    interval: 3600, // hourly data
  },
  {
    name: 'system.cpu.user',
    tags: ['host:web-01', 'environment:production'],
    values: [45, 52, 48, 56, 62, 58, 50],
    timestamp: '2023-06-20T00:00:00Z',
    interval: 3600, // hourly data
  },
];

// Test Datadog teams command with text output
await snapshotTest({
  name: 'Datadog Teams Command - Text Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nFetching Datadog teams...\n'));

    const table = new Table()
      .header([
        colors.bold.white('Name'),
        colors.bold.white('Handle'),
        colors.bold.white('Members'),
        colors.bold.white('Description'),
      ])
      .border(true)
      .padding(1);

    mockTeams.forEach((team) => {
      table.push([
        team.name,
        team.handle,
        team.user_count.toString(),
        team.description || 'No description',
      ]);
    });

    console.log(table.toString() + '\n');
    console.log(colors.dim(`Total teams: ${mockTeams.length}\n`));
  },
});

// Test Datadog teams command with JSON output
await snapshotTest({
  name: 'Datadog Teams Command - JSON Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(JSON.stringify(mockTeams, null, 2));
  },
});

// Test Datadog dashboards command with text output
await snapshotTest({
  name: 'Datadog Dashboards Command - Text Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nFetching Datadog dashboards...\n'));

    const table = new Table()
      .header([
        colors.bold.white('Title'),
        colors.bold.white('Author'),
        colors.bold.white('Last Modified'),
        colors.bold.white('Description'),
      ])
      .border(true)
      .padding(1);

    mockDashboards.forEach((dashboard) => {
      table.push([
        dashboard.title,
        dashboard.author.name,
        new Date(dashboard.modified_at).toLocaleDateString(),
        dashboard.description || 'No description',
      ]);
    });

    console.log(table.toString() + '\n');
    console.log(colors.dim(`Total dashboards: ${mockDashboards.length}\n`));
  },
});

// Test Datadog dashboards command with JSON output
await snapshotTest({
  name: 'Datadog Dashboards Command - JSON Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(JSON.stringify(mockDashboards, null, 2));
  },
});

// Test Datadog team detail (single team)
await snapshotTest({
  name: 'Datadog Team Detail',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    const team = mockTeams[0];

    console.log(colors.blue(`\nTeam Information: ${team.name}\n`));
    console.log(colors.bold('Name:'), team.name);
    console.log(colors.bold('Handle:'), team.handle);
    console.log(colors.bold('Members:'), team.user_count);
    console.log(colors.bold('Created:'), formatLocaleDate(team.created_at));
    console.log(colors.bold('Last Updated:'), formatLocaleDate(team.updated_at));
    console.log(colors.bold('Description:'), team.description || 'No description');
  },
});

// NEW TESTS FOR PIPELINE SCENARIOS

// Test for Datadog metrics data with text output
await snapshotTest({
  name: 'Datadog Metrics Command - Text Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nFetching Datadog metrics...\n'));

    const table = new Table()
      .header([
        colors.bold.white('Name'),
        colors.bold.white('Tags'),
        colors.bold.white('Latest Value'),
        colors.bold.white('Avg Value'),
      ])
      .border(true)
      .padding(1);

    mockMetrics.forEach((metric) => {
      const latestValue = metric.values[metric.values.length - 1];
      const avgValue = (metric.values.reduce((sum, val) => sum + val, 0) / metric.values.length).toFixed(2);
      
      table.push([
        metric.name,
        metric.tags.join(', '),
        latestValue.toString(),
        avgValue,
      ]);
    });

    console.log(table.toString() + '\n');
    console.log(colors.dim(`Total metrics: ${mockMetrics.length}\n`));
  },
});

// Test Datadog metrics with JSON output
await snapshotTest({
  name: 'Datadog Metrics Command - JSON Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(JSON.stringify(mockMetrics, null, 2));
  },
});

// Test Pipeline Scenario 1: Filter dashboards by author
await snapshotTest({
  name: 'Pipeline: Filter Dashboards by Author',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nPipeline Example: nova datadog dashboards --format json | jq \'.[] | select(.author.name=="Jane Smith")\'\n'));
    
    // Simulate the jq filter operation
    const janesDashboards = mockDashboards.filter(dashboard => dashboard.author.name === 'Jane Smith');
    
    console.log(JSON.stringify(janesDashboards, null, 2));
    console.log(colors.dim(`\nFound ${janesDashboards.length} dashboards by Jane Smith\n`));
  },
});

// Test Pipeline Scenario 2: Extract dashboard titles and URLs
await snapshotTest({
  name: 'Pipeline: Extract Dashboard Titles and URLs',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nPipeline Example: nova datadog dashboards --format json | jq -r \'.[] | "\\(.title) - \\(.url)"\'\n'));
    
    // Simulate the jq string transformation
    mockDashboards.forEach(dashboard => {
      console.log(`${dashboard.title} - ${dashboard.url}`);
    });
  },
});

// Test Pipeline Scenario 3: Team statistics
await snapshotTest({
  name: 'Pipeline: Team Statistics Summary',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nPipeline Example: nova datadog teams --format json | jq \'{ total_teams: length, total_members: map(.user_count) | add, teams: map({name: .name, members: .user_count}) }\'\n'));
    
    // Simulate the jq aggregation
    const teamStats = {
      total_teams: mockTeams.length,
      total_members: mockTeams.reduce((sum, team) => sum + team.user_count, 0),
      teams: mockTeams.map(team => ({
        name: team.name,
        members: team.user_count
      }))
    };
    
    console.log(JSON.stringify(teamStats, null, 2));
  },
});

// Test Pipeline Scenario 4: Create HTML dashboard list
await snapshotTest({
  name: 'Pipeline: Generate HTML Dashboard List',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nPipeline Example: nova datadog dashboards --format json | jq -r \'.[] | "<li><a href=\\"\(.url)\\">\(.title)</a> (by \(.author.name))</li>"\' > dashboards.html\n'));
    
    // Simulate HTML output generation
    console.log('<ul>');
    mockDashboards.forEach(dashboard => {
      console.log(`  <li><a href="${dashboard.url}">${dashboard.title}</a> (by ${dashboard.author.name})</li>`);
    });
    console.log('</ul>');
  },
});

// Test Pipeline Scenario 5: Calculate metric statistics
await snapshotTest({
  name: 'Pipeline: Calculate Metric Statistics',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nPipeline Example: nova datadog metrics --format json | jq \'map({name: .name, min: (.values | min), max: (.values | max), avg: (.values | add / length)})\'\n'));
    
    // Simulate calculating statistics for each metric
    const metricStats = mockMetrics.map(metric => {
      const values = metric.values;
      return {
        name: metric.name,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: parseFloat((values.reduce((sum, val) => sum + val, 0) / values.length).toFixed(2))
      };
    });
    
    console.log(JSON.stringify(metricStats, null, 2));
  },
}); 