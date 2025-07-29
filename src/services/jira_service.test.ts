import { assertEquals } from '@std/assert';
import { assertSpyCalls, stub } from '@std/testing/mock';
import type { Config } from '../config/mod.ts';
import { configManager } from '../config/mod.ts';
import { DatabaseService } from './db_service.ts';
import { JiraService } from './jira_service.ts';

// Test setup and cleanup
async function setupTest() {
    // Mock environment
    const originalHome = Deno.env.get('HOME');
    await Deno.env.set('HOME', '/tmp/test-home');

    // Create test config directory
    try {
        await Deno.mkdir('/tmp/test-home/.nova', { recursive: true });
    } catch {
        // Directory might already exist
    }

    // Mock Deno.exit
    const originalExit = Deno.exit;
    Deno.exit = () => {
        throw new Error('Test attempted to exit');
    };

    return {
        cleanup: async () => {
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

const mockConfig: Config = {
    atlassian: {
        jira_url: 'https://test.atlassian.net',
        jira_token: 'test-token',
        username: 'test@example.com',
    },
} as Config;

const mockJiraProject: JiraProject = {
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
        displayName: 'Test User',
        emailAddress: 'test@example.com',
    },
    description: 'Test project description',
};

Deno.test('JiraService Tests', async (t) => {
    const { cleanup } = await setupTest();

    try {
        await t.step('getProjects should return projects with correct URLs', async () => {
            // Stub config loading
            const loadConfigStub = stub(
                configManager,
                'loadConfig',
                () => Promise.resolve(mockConfig),
            );

            // Mock database service
            const dbStub = stub(DatabaseService, 'getInstance', () =>
                Promise.resolve({
                    getCachedJiraProjectsList: () => Promise.resolve(null),
                    cacheJiraProjectsList: () => Promise.resolve(),
                } as unknown as DatabaseService));

            const service = new JiraService(mockConfig);
            const fetchStub = stub(
                globalThis,
                'fetch',
                () =>
                    Promise.resolve(
                        new Response(JSON.stringify([mockJiraProject]), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' },
                        }),
                    ),
            );

            try {
                const projects = await service.getProjects(true); // Force refresh
                assertEquals(projects.length, 1);
                assertEquals(projects[0].key, mockJiraProject.key);
                assertEquals(projects[0].name, mockJiraProject.name);
                assertEquals(projects[0].url, mockJiraProject.url);
                assertSpyCalls(fetchStub, 1);
            } finally {
                fetchStub.restore();
                loadConfigStub.restore();
                dbStub.restore();
            }
        });
    } finally {
        await cleanup();
    }
});
