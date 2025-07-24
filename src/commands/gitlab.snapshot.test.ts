import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { snapshotTest } from '@cliffy/testing';
import { formatLocaleDate } from '../../src/utils.ts';

// Create mock data for GitLab projects
const mockProjects = [
  {
    name: 'Project A',
    path_with_namespace: 'group/project-a',
    last_activity_at: '2023-06-10T10:00:00Z',
    visibility: 'private',
    description: 'This is project A',
    web_url: 'https://gitlab.example.com/group/project-a',
  },
  {
    name: 'Project B',
    path_with_namespace: 'group/project-b',
    last_activity_at: '2023-06-15T14:30:00Z',
    visibility: 'internal',
    description: 'This is project B',
    web_url: 'https://gitlab.example.com/group/project-b',
  },
  {
    name: 'Project C',
    path_with_namespace: 'another-group/project-c',
    last_activity_at: '2023-06-20T09:15:00Z',
    visibility: 'public',
    description: 'This is project C',
    web_url: 'https://gitlab.example.com/another-group/project-c',
  },
];

// Test GitLab projects command with text output
await snapshotTest({
  name: 'GitLab Projects Command - Text Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    // Simulating the projects command with text output
    console.log(colors.blue('\nFetching GitLab projects...\n'));

    const table = new Table()
      .header([
        colors.bold.white('Name'),
        colors.bold.white('Path'),
        colors.bold.white('Last Activity'),
      ])
      .border(true)
      .padding(1);

    mockProjects.forEach((project) => {
      table.push([
        project.name,
        project.path_with_namespace,
        new Date(project.last_activity_at).toLocaleDateString(),
      ]);
    });

    console.log(table.toString() + '\n');
    console.log(colors.dim(`Total projects: ${mockProjects.length}\n`));
  },
});

// Test GitLab projects command with JSON output
await snapshotTest({
  name: 'GitLab Projects Command - JSON Output',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    // Simulating the projects command with JSON output
    console.log(JSON.stringify(mockProjects, null, 2));
  },
});

// Test GitLab project details (single project)
await snapshotTest({
  name: 'GitLab Project Detail',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    // Simulating the project detail command
    const project = mockProjects[0];

    console.log(colors.blue(`\nProject Information: ${project.path_with_namespace}\n`));
    console.log(colors.bold('Name:'), project.name);
    console.log(colors.bold('Path:'), project.path_with_namespace);
    console.log(colors.bold('URL:'), project.web_url);
    console.log(colors.bold('Visibility:'), project.visibility || 'private');
    console.log(colors.bold('Last Activity:'), formatLocaleDate(project.last_activity_at));
    console.log(colors.bold('Description:'), project.description || 'No description');
  },
});
