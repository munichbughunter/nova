import { z } from 'zod';
import { GatewayConfig, ProviderConfig, TransportConfig } from './types.ts';

export const GatewayConfigSchema = z.object({
    port: z.number().int().positive().default(3000),
    hostname: z.string().optional(),
    enableHttps: z.boolean().default(false),
    tlsCertPath: z.string().optional(),
    tlsKeyPath: z.string().optional(),
});

export const ProviderConfigSchema = z.object({
    name: z.string(),
    type: z.enum(['openai', 'azure', 'ollama', 'copilot']),
    config: z.any(), // This will be refined based on the 'type' field
});

export const TransportConfigSchema = z.object({
    type: z.enum(['http', 'grpc']),
    host: z.string(),
    port: z.number().int().positive(),
    timeout: z.number().int().positive().default(5000),
});

export const FullGatewayConfigSchema = z.object({
    gateway: GatewayConfigSchema,
    providers: z.array(ProviderConfigSchema),
    transport: TransportConfigSchema,
});

export type FullGatewayConfig = z.infer<typeof FullGatewayConfigSchema>;

// Function to load configuration from a file (e.g., JSON, YAML)
export async function loadConfig(filePath: string): Promise<FullGatewayConfig> {
    // For simplicity, let's assume it's a JSON file for now.
    // In a real scenario, you'd use a library like 'js-yaml' for YAML or 'deno.jsonc' for JSONC.
    const fileContent = await Deno.readTextFile(filePath);
    const config = JSON.parse(fileContent);
    return FullGatewayConfigSchema.parse(config);
}

// Function to substitute environment variables
export function substituteEnvVars<T extends object>(config: T): T {
    let configString = JSON.stringify(config);
    configString = configString.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, envVarName) => {
        return Deno.env.get(envVarName) || '';
    });
    return JSON.parse(configString);
}

// Basic validation function (more complex validation would be part of the Zod schema)
export function validateConfig(config: FullGatewayConfig): void {
    FullGatewayConfigSchema.parse(config);
}

// Placeholder for hot-reloading logic (requires file watcher and re-loading)
export function watchConfig(filePath: string, callback: (config: FullGatewayConfig) => void): void {
    console.log(`Watching config file for changes: ${filePath}`);
    (async () => {
        for await (const event of Deno.watchFs(filePath)) {
            if (event.kind === "modify") {
                console.log("Config file modified, reloading...");
                try {
                    const newConfig = await loadConfig(filePath);
                    callback(newConfig);
                } catch (error) {
                    console.error("Error reloading config:", error);
                }
            }
        }
    })();
}
