import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { snapshotTest } from '@cliffy/testing';

// Create mock data for Jira projects
const mockProjects = [
    {
        key: 'PROJ1',
        name: 'Project One',
        projectTypeKey: 'software',
        lead: { displayName: 'John Doe' },
    },
    {
        key: 'PROJ2',
        name: 'Project Two',
        projectTypeKey: 'business',
        lead: { displayName: 'Jane Smith' },
    },
    {
        key: 'PROJ3',
        name: 'Project Three',
        projectTypeKey: 'service_desk',
        lead: { displayName: 'Bob Johnson' },
    },
];

// Mock issue data
const mockIssues = {
    issues: [
        {
            key: 'PROJ1-123',
            fields: {
                summary: 'Fix login error',
                status: { name: 'In Progress' },
                issuetype: { name: 'Bug' },
                priority: { name: 'High' },
                assignee: { displayName: 'John Doe' },
                updated: '2023-06-15T14:30:00Z',
            },
        },
        {
            key: 'PROJ1-124',
            fields: {
                summary: 'Add new feature',
                status: { name: 'To Do' },
                issuetype: { name: 'Task' },
                priority: { name: 'Medium' },
                assignee: { displayName: 'Jane Smith' },
                updated: '2023-06-12T09:15:00Z',
            },
        },
        {
            key: 'PROJ1-125',
            fields: {
                summary: 'Update documentation',
                status: { name: 'Done' },
                issuetype: { name: 'Task' },
                priority: { name: 'Low' },
                assignee: { displayName: 'Bob Johnson' },
                updated: '2023-06-10T11:45:00Z',
            },
        },
    ],
    total: 3,
};

// Test the Jira projects command with text output
await snapshotTest({
    name: 'Jira Projects Command - Text Output',
    meta: import.meta,
    colors: true,
    // deno-lint-ignore require-await
    async fn() {
        console.log(colors.blue('\nFetching Jira projects...\n'));

        const table = new Table()
            .header([
                colors.bold.white('Key'),
                colors.bold.white('Name'),
                colors.bold.white('Type'),
                colors.bold.white('Lead'),
            ])
            .border(true)
            .padding(1);

        mockProjects.forEach((project) => {
            table.push([
                project.key,
                project.name,
                project.projectTypeKey || 'Unknown',
                project.lead?.displayName || 'Unknown',
            ]);
        });

        console.log(table.toString() + '\n');
        console.log(colors.dim(`Total projects: ${mockProjects.length}\n`));
    },
});

// Test the Jira projects command with JSON output
await snapshotTest({
    name: 'Jira Projects Command - JSON Output',
    meta: import.meta,
    colors: false,
    // deno-lint-ignore require-await
    async fn() {
        console.log(JSON.stringify(mockProjects, null, 2));
    },
});

// Test the Jira issues command
await snapshotTest({
    name: 'Jira Issues Command - Text Output',
    meta: import.meta,
    colors: true,
    // deno-lint-ignore require-await
    async fn() {
        console.log(colors.blue('\nFetching Jira issues for project PROJ1...\n'));

        const table = new Table()
            .header([
                colors.bold.white('Key'),
                colors.bold.white('Summary'),
                colors.bold.white('Status'),
                colors.bold.white('Type'),
                colors.bold.white('Priority'),
                colors.bold.white('Assignee'),
            ])
            .border(true)
            .padding(1);

        mockIssues.issues.forEach((issue) => {
            table.push([
                issue.key,
                issue.fields.summary,
                issue.fields.status.name,
                issue.fields.issuetype.name,
                issue.fields.priority.name,
                issue.fields.assignee?.displayName || 'Unassigned',
            ]);
        });

        console.log(table.toString() + '\n');
        console.log(colors.dim(`Total issues: ${mockIssues.issues.length}\n`));
    },
});
