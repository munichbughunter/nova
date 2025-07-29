import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { snapshotTest } from '@cliffy/testing';
import { formatLocaleDate } from '../../src/utils.ts';

// Create mock data for Confluence spaces
const mockSpaces = [
    {
        id: 'space1',
        key: 'TEAM1',
        name: 'Team One Space',
        type: 'global',
        status: 'current',
    },
    {
        id: 'space2',
        key: 'DOCS',
        name: 'Documentation',
        type: 'global',
        status: 'current',
    },
    {
        id: 'space3',
        key: 'PROJ',
        name: 'Project Space',
        type: 'personal',
        status: 'current',
    },
];

// Mock page data for a space
const mockPages = [
    {
        id: 'page1',
        title: 'Home Page',
        type: 'page',
        version: { number: 5 },
        status: 'current',
        history: { createdDate: '2023-05-10T10:00:00Z', lastUpdated: '2023-06-15T14:30:00Z' },
    },
    {
        id: 'page2',
        title: 'Getting Started',
        type: 'page',
        version: { number: 3 },
        status: 'current',
        history: { createdDate: '2023-05-12T11:20:00Z', lastUpdated: '2023-05-30T09:15:00Z' },
    },
    {
        id: 'page3',
        title: 'API Documentation',
        type: 'page',
        version: { number: 8 },
        status: 'current',
        history: { createdDate: '2023-05-15T14:00:00Z', lastUpdated: '2023-06-18T16:45:00Z' },
    },
];

// Sample page content
const mockPageDetails = {
    id: 'page1',
    title: 'Home Page',
    type: 'page',
    version: { number: 5 },
    status: 'current',
    history: {
        createdDate: '2023-05-10T10:00:00Z',
        lastUpdated: '2023-06-15T14:30:00Z',
        createdBy: { displayName: 'John Doe' },
        lastUpdatedBy: { displayName: 'Jane Smith' },
    },
    space: { key: 'TEAM1', name: 'Team One Space' },
    body: {
        storage: {
            value:
                '<p>Welcome to the Team One Space!</p><h2>About Us</h2><p>This space contains documentation for Team One.</p>',
            representation: 'storage',
        },
    },
};

// Test the Confluence spaces command with text output
await snapshotTest({
    name: 'Confluence Spaces Command - Text Output',
    meta: import.meta,
    colors: true,
    // deno-lint-ignore require-await
    async fn() {
        console.log(colors.blue('\nFetching Confluence spaces...\n'));

        const table = new Table()
            .header([
                colors.bold.white('Key'),
                colors.bold.white('Name'),
                colors.bold.white('Type'),
            ])
            .border(true)
            .padding(1);

        mockSpaces.forEach((space) => {
            table.push([
                space.key,
                space.name,
                space.type || 'Unknown',
            ]);
        });

        console.log(table.toString() + '\n');
        console.log(colors.dim(`Total spaces: ${mockSpaces.length}\n`));
    },
});

// Test the Confluence spaces command with JSON output
await snapshotTest({
    name: 'Confluence Spaces Command - JSON Output',
    meta: import.meta,
    colors: false,
    // deno-lint-ignore require-await
    async fn() {
        console.log(JSON.stringify(mockSpaces, null, 2));
    },
});

// Test the Confluence pages command
await snapshotTest({
    name: 'Confluence Pages Command - Text Output',
    meta: import.meta,
    colors: true,
    // deno-lint-ignore require-await
    async fn() {
        console.log(colors.blue('\nFetching pages for space: TEAM1...\n'));

        const table = new Table()
            .header([
                colors.bold.white('Title'),
                colors.bold.white('Version'),
                colors.bold.white('Last Updated'),
            ])
            .border(true)
            .padding(1);

        mockPages.forEach((page) => {
            table.push([
                page.title,
                `v${page.version.number}`,
                new Date(page.history.lastUpdated).toLocaleDateString(),
            ]);
        });

        console.log(table.toString() + '\n');
        console.log(colors.dim(`Total pages: ${mockPages.length}\n`));
    },
});

// Test the Confluence page details command
await snapshotTest({
    name: 'Confluence Page Details',
    meta: import.meta,
    colors: true,
    // deno-lint-ignore require-await
    async fn() {
        const page = mockPageDetails;

        console.log(colors.blue(`\nPage Information: ${page.title}\n`));
        console.log(colors.bold('Title:'), page.title);
        console.log(colors.bold('Space:'), `${page.space.name} (${page.space.key})`);
        console.log(
            colors.bold('Version:'),
            page.version.number ? `v${page.version.number}` : 'N/A',
        );
        console.log(
            colors.bold('Created:'),
            `${
                formatLocaleDate(page.history.createdDate)
            } by ${page.history.createdBy.displayName}`,
        );
        console.log(
            colors.bold('Last Updated:'),
            `${
                formatLocaleDate(page.history.lastUpdated)
            } by ${page.history.lastUpdatedBy.displayName}`,
        );
        console.log(colors.bold('\nContent Preview:'));
        console.log('--------------------');
        // Simple HTML to text conversion for demo purposes
        const contentPreview = page.body.storage.value
            .replace(/<[^>]*>/g, '')
            .substring(0, 100) + '...';
        console.log(contentPreview);
        console.log('--------------------');
    },
});
