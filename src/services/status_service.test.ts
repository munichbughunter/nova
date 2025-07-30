import { assertEquals } from '@std/assert';
import { stub } from '@std/testing/mock';
import { Config } from '../config/types.ts';
import { DevCache } from '../utils/devcache.ts';
import { Logger } from '../utils/logger.ts';
import { ServiceStatus, StatusService } from './status_service.ts';

Deno.test('StatusService', async (t) => {
    const statusService = new StatusService();

    await t.step('checkOllama', async () => {
        // Mock DevCache constructor
        const mockDevCache = {
            get: () => Promise.resolve(null),
            set: () => Promise.resolve(),
            clear: () => Promise.resolve(),
        };
        const devCacheStub = stub(DevCache.prototype, 'get', mockDevCache.get);
        const devCacheSetStub = stub(DevCache.prototype, 'set', mockDevCache.set);
        const devCacheClearStub = stub(DevCache.prototype, 'clear', mockDevCache.clear);

        // Mock Logger constructor
        const mockLogger = {
            debug: () => {},
            error: () => {},
            info: () => {},
            passThrough: () => {},
        };
        const loggerDebugStub = stub(Logger.prototype, 'debug', mockLogger.debug);
        const loggerErrorStub = stub(Logger.prototype, 'error', mockLogger.error);
        const loggerInfoStub = stub(Logger.prototype, 'info', mockLogger.info);
        const loggerPassThroughStub = stub(Logger.prototype, 'passThrough', mockLogger.passThrough);

        // Mock fetch for Ollama check
        const originalFetch = globalThis.fetch;

        // deno-lint-ignore require-await
        globalThis.fetch = async () => {
            // Create a new Response object each time
            return new Response('{}', { status: 200 });
        };

        try {
            const result = await statusService.checkOllama();
            assertEquals(typeof result, 'boolean');
        } finally {
            globalThis.fetch = originalFetch;
            devCacheStub.restore();
            devCacheSetStub.restore();
            devCacheClearStub.restore();
            loggerDebugStub.restore();
            loggerErrorStub.restore();
            loggerInfoStub.restore();
            loggerPassThroughStub.restore();
        }
    });

    await t.step('getAllStatuses', async () => {
        const mockConfig: Config = {
            gitlab: {
                url: 'https://gitlab.com',
                token: 'test-token',
            },
            ai: {
                default_provider: 'openai',
                openai: {
                    api_key: 'test-key',
                    api_url: 'https://api.openai.com',
                    api_version: '2024-02-15',
                    default_model: 'gpt-4',
                },
            },
        };

        // Mock fetch for service checks
        const originalFetch = globalThis.fetch;

        // deno-lint-ignore require-await
        globalThis.fetch = async () => {
            // Create a new Response object each time
            return new Response('{}', { status: 200 });
        };

        try {
            const statuses = await statusService.getAllStatuses(mockConfig);
            assertEquals(Array.isArray(statuses), true);
            assertEquals(statuses.length > 0, true);

            // Check that each status has the required properties
            statuses.forEach((status: ServiceStatus) => {
                assertEquals(typeof status.name, 'string');
                assertEquals(typeof status.status, 'string');
                if (status.details) assertEquals(typeof status.details, 'string');
                if (status.source) assertEquals(typeof status.source, 'string');
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await t.step('displayStatusTable', () => {
        const mockStatuses: ServiceStatus[] = [
            { name: 'Test Service', status: '✅ Working', source: '-' },
            { name: 'Another Service', status: '❌ Failed', source: '-' },
        ];

        // This should not throw an error
        statusService.displayStatusTable(mockStatuses);
    });
});
