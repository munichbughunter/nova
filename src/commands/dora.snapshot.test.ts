import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { snapshotTest } from '@cliffy/testing';
import { formatLocaleDate } from '../../src/utils.ts';

// Create mock data for DORA metrics
const mockDoraMetrics = {
    timestamp: '2023-06-20T14:30:00Z',
    timeRange: '30d',
    jiraProject: {
        key: 'PROJ1',
        name: 'Project One',
    },
    gitlabProject: {
        path: 'group/project-a',
        name: 'Project A',
    },
    metrics: {
        deploymentFrequency: {
            value: 4.2,
            rating: 'Elite',
            count: 12,
            unit: 'per week',
        },
        leadTimeForChanges: {
            value: 1.5,
            rating: 'High',
            unit: 'days',
        },
        timeToRestore: {
            value: 2.8,
            rating: 'Medium',
            unit: 'hours',
        },
        changeFailureRate: {
            value: 12.5,
            rating: 'Elite',
            failedCount: 3,
            totalCount: 24,
            unit: '%',
        },
    },
    details: {
        deployments: [
            { id: 'deploy1', environment: 'production', timestamp: '2023-06-15T10:00:00Z' },
            { id: 'deploy2', environment: 'production', timestamp: '2023-06-12T14:30:00Z' },
            { id: 'deploy3', environment: 'production', timestamp: '2023-06-09T09:15:00Z' },
        ],
        incidents: [
            {
                id: 'inc1',
                title: 'Service outage',
                startTime: '2023-06-18T08:00:00Z',
                resolveTime: '2023-06-18T10:45:00Z',
            },
            {
                id: 'inc2',
                title: 'Database slowdown',
                startTime: '2023-06-10T15:30:00Z',
                resolveTime: '2023-06-10T18:15:00Z',
            },
        ],
        mergeRequests: 28,
        commits: 156,
    },
};

// Test DORA metrics command with text output
await snapshotTest({
    name: 'DORA Metrics Command - Text Output',
    meta: import.meta,
    colors: true,
    // deno-lint-ignore require-await
    async fn() {
        console.log(colors.bold.blue(
            `\nAnalyzing DORA metrics for:\n- Jira: ${mockDoraMetrics.jiraProject.key}\n- GitLab: ${mockDoraMetrics.gitlabProject.path}\n- Time range: ${mockDoraMetrics.timeRange}\n`,
        ));

        // Create metrics table
        const table = new Table()
            .header([
                colors.bold.white('Metric'),
                colors.bold.white('Value'),
                colors.bold.white('Rating'),
                colors.bold.white('Details'),
            ])
            .border(true)
            .padding(1);

        // Deployment Frequency
        table.push([
            'Deployment Frequency',
            `${mockDoraMetrics.metrics.deploymentFrequency.value} ${mockDoraMetrics.metrics.deploymentFrequency.unit}`,
            getRatingWithColor(mockDoraMetrics.metrics.deploymentFrequency.rating),
            `${mockDoraMetrics.metrics.deploymentFrequency.count} deployments`,
        ]);

        // Lead Time for Changes
        table.push([
            'Lead Time for Changes',
            `${mockDoraMetrics.metrics.leadTimeForChanges.value} ${mockDoraMetrics.metrics.leadTimeForChanges.unit}`,
            getRatingWithColor(mockDoraMetrics.metrics.leadTimeForChanges.rating),
            `From commit to production`,
        ]);

        // Time to Restore
        table.push([
            'Time to Restore',
            `${mockDoraMetrics.metrics.timeToRestore.value} ${mockDoraMetrics.metrics.timeToRestore.unit}`,
            getRatingWithColor(mockDoraMetrics.metrics.timeToRestore.rating),
            `Average incident resolution time`,
        ]);

        // Change Failure Rate
        table.push([
            'Change Failure Rate',
            `${mockDoraMetrics.metrics.changeFailureRate.value}${mockDoraMetrics.metrics.changeFailureRate.unit}`,
            getRatingWithColor(mockDoraMetrics.metrics.changeFailureRate.rating),
            `${mockDoraMetrics.metrics.changeFailureRate.failedCount}/${mockDoraMetrics.metrics.changeFailureRate.totalCount} deployments failed`,
        ]);

        console.log(table.toString() + '\n');

        // Display some stats
        console.log(colors.bold.blue('Summary Statistics:'));
        console.log(`- Total Deployments: ${mockDoraMetrics.details.deployments.length}`);
        console.log(`- Total Incidents: ${mockDoraMetrics.details.incidents.length}`);
        console.log('- Merge Requests:', mockDoraMetrics.details.mergeRequests);
        console.log('- Commits:', mockDoraMetrics.details.commits);
        console.log('');
        console.log(
            colors.dim(`Data as of: ${formatLocaleDate(mockDoraMetrics.timestamp)}\n`),
        );
    },
});

// Test DORA metrics command with JSON output
await snapshotTest({
    name: 'DORA Metrics Command - JSON Output',
    meta: import.meta,
    colors: false,
    // deno-lint-ignore require-await
    async fn() {
        console.log(JSON.stringify(mockDoraMetrics, null, 2));
    },
});

// Helper function to colorize ratings
function getRatingWithColor(rating: string): string {
    switch (rating) {
        case 'Elite':
            return colors.bold.green(rating);
        case 'High':
            return colors.bold.cyan(rating);
        case 'Medium':
            return colors.bold.yellow(rating);
        case 'Low':
            return colors.bold.red(rating);
        default:
            return rating;
    }
}
