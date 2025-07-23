import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GatewayConfigSchema, ProviderConfigSchema, TransportConfigSchema, FullGatewayConfigSchema, loadConfig, substituteEnvVars, validateConfig } from "./gateway-config.ts";
import { z } from "zod";

Deno.test("GatewayConfigSchema validates correct gateway configuration", () => {
    const config = {
        port: 8080,
        enableHttps: true,
    };
    const parsed = GatewayConfigSchema.parse(config);
    assertEquals(parsed.port, 8080);
    assertEquals(parsed.enableHttps, true);
});

Deno.test("GatewayConfigSchema applies default port", () => {
    const config = {
        enableHttps: false,
    };
    const parsed = GatewayConfigSchema.parse(config);
    assertEquals(parsed.port, 3000);
});

Deno.test("GatewayConfigSchema rejects invalid port", () => {
    const config = {
        port: -100,
        enableHttps: false,
    };
    assertThrows(() => GatewayConfigSchema.parse(config), z.ZodError);
});

Deno.test("ProviderConfigSchema validates correct provider configuration", () => {
    const config = {
        name: "openai-provider",
        type: "openai",
        config: { api_key: "test_key", default_model: "gpt-4" },
    };
    const parsed = ProviderConfigSchema.parse(config);
    assertEquals(parsed.name, "openai-provider");
    assertEquals(parsed.type, "openai");
    assertEquals(parsed.config.api_key, "test_key");
});

Deno.test("ProviderConfigSchema rejects invalid provider type", () => {
    const config = {
        name: "invalid-provider",
        type: "unsupported",
        config: { key: "value" },
    };
    assertThrows(() => ProviderConfigSchema.parse(config), z.ZodError);
});

Deno.test("TransportConfigSchema validates correct transport configuration", () => {
    const config = {
        type: "http",
        host: "localhost",
        port: 8080,
    };
    const parsed = TransportConfigSchema.parse(config);
    assertEquals(parsed.type, "http");
    assertEquals(parsed.host, "localhost");
    assertEquals(parsed.port, 8080);
});

Deno.test("TransportConfigSchema applies default timeout", () => {
    const config = {
        type: "grpc",
        host: "127.0.0.1",
        port: 50051,
    };
    const parsed = TransportConfigSchema.parse(config);
    assertEquals(parsed.timeout, 5000);
});

Deno.test("FullGatewayConfigSchema validates complete configuration", () => {
    const config = {
        gateway: { port: 3000, enableHttps: false },
        providers: [
            { name: "p1", type: "openai", config: { api_key: "k1", default_model: "gpt-3.5-turbo" } },
        ],
        transport: { type: "http", host: "0.0.0.0", port: 8080 },
    };
    const parsed = FullGatewayConfigSchema.parse(config);
    assertEquals(parsed.gateway.port, 3000);
    assertEquals(parsed.providers.length, 1);
});

Deno.test("loadConfig loads and parses a valid JSON file", async () => {
    const testConfigPath = "./test_config.json";
    const testConfigContent = JSON.stringify({
        gateway: { port: 9000, enableHttps: false },
        providers: [],
        transport: { type: "http", host: "localhost", port: 9001 },
    });
    await Deno.writeTextFile(testConfigPath, testConfigContent);

    const config = await loadConfig(testConfigPath);
    assertEquals(config.gateway.port, 9000);

    await Deno.remove(testConfigPath);
});

Deno.test("loadConfig throws error for invalid JSON file", async () => {
    const testConfigPath = "./invalid_test_config.json";
    await Deno.writeTextFile(testConfigPath, "{ invalid json");

    await assertThrowsAsync(async () => {
        await loadConfig(testConfigPath);
    }, Error, "Expected property name or '}' in JSON at position 2");

    await Deno.remove(testConfigPath);
});

Deno.test("substituteEnvVars replaces environment variables", () => {
    Deno.env.set("TEST_PORT", "8081");
    Deno.env.set("TEST_HOST", "test.example.com");

    const config = {
        gateway: { port: "${TEST_PORT}", enableHttps: false },
        providers: [],
        transport: { type: "http", host: "${TEST_HOST}", port: 80 },
    };

    const substitutedConfig = substituteEnvVars(config);
    assertEquals(substitutedConfig.gateway.port, "8081");
    assertEquals(substitutedConfig.transport.host, "test.example.com");

    Deno.env.delete("TEST_PORT");
    Deno.env.delete("TEST_HOST");
});

Deno.test("substituteEnvVars handles missing environment variables", () => {
    const config = {
        gateway: { port: "${NON_EXISTENT_VAR}", enableHttps: false },
        providers: [],
        transport: { type: "http", host: "localhost", port: 80 },
    };

    const substitutedConfig = substituteEnvVars(config);
    assertEquals(substitutedConfig.gateway.port, "");
});

Deno.test("validateConfig validates a correct configuration", () => {
    const config = {
        gateway: { port: 3000, enableHttps: false },
        providers: [],
        transport: { type: "http" as const, host: "localhost", port: 8080, timeout: 5000 },
    };
    // Should not throw
    validateConfig(config);
});

Deno.test("validateConfig throws error for invalid configuration", () => {
    const config = {
        gateway: { port: -100, enableHttps: false }, // Invalid port
        providers: [],
        transport: { type: "http" as const, host: "localhost", port: 8080, timeout: 5000 },
    };
    assertThrows(() => validateConfig(config), z.ZodError);
});

// Helper for async throws
async function assertThrowsAsync<T>(fn: () => Promise<T>, errorClass: new (...args: any[]) => Error, msgIncludes?: string): Promise<void> {
    let err: Error | undefined = undefined;
    try {
        await fn();
    } catch (e: unknown) {
        if (e instanceof Error) {
            err = e;
        } else {
            throw new Error(`Caught non-Error: ${e}`);
        }
    }
    if (!err) {
        throw new Error("Function did not throw an error.");
    }
    if (!(err instanceof errorClass)) {
        throw new Error(`Expected error of type ${errorClass.name}, but got ${(err as Error).constructor.name}`);
    }
    if (msgIncludes && !err.message.includes(msgIncludes)) {
        throw new Error(`Expected error message to include "${msgIncludes}", but got "${err.message}"`);
    }
}
