/**
 * Agent Command Implementation
 * 
 * Provides CLI interface for interacting with Nova AI agents
 */

import { parseArgs } from "jsr:@std/cli/parse-args";
import { z } from 'zod';
import { Logger } from "../utils/logger.ts";
import { configManager } from "../config/mod.ts";
import type { AgentContext } from "../agents/types.ts";
import type { LLMProvider, ToolFunction } from "../types/tool_types.ts";
import { createExampleAgent } from "../agents/example-agent.ts";
import { createEnhancedCodeReviewAgent } from "../agents/enhanced-code-review-agent.ts";
import { MCPService } from "../services/mcp_service.ts";
import { EnhancedCLIHandler } from "../services/enhanced-cli-handler.ts";
import type { EnhancedCLIOptions } from "../types/enhanced-cli.types.ts";

const logger = new Logger("agent-command");

/**
 * Check if command line arguments contain enhanced CLI options
 */
function hasEnhancedOptions(args: string[]): boolean {
    const enhancedFlags = [
        '--dry-run', '-d',
        '--json-report', '-j',
        '--group-by-directory', '-g',
        '--output-format', '-o',
        '--sequential', '-s',
        '--show-progress', '-p',
        '--show-eta',
        '--show-throughput',
        '--max-errors',
        '--continue-on-error',
        '--file-ordering'
    ];

    return args.some(arg =>
        enhancedFlags.some(flag => arg.startsWith(flag))
    );
}

/**
 * Handle enhanced review command with new CLI options
 */
async function handleEnhancedReviewCommand(args: string[]): Promise<void> {
    const cliHandler = new EnhancedCLIHandler(logger);

    try {
        // Parse enhanced arguments
        const result = cliHandler.parseEnhancedArgs(args);

        // Handle validation errors
        if (result.errors.length > 0) {
            console.log("❌ Command validation errors:");
            result.errors.forEach(error => console.log(`  • ${error}`));

            if (result.options.help) {
                showEnhancedHelp(cliHandler);
            }
            return;
        }

        // Show warnings if any
        if (result.warnings.length > 0) {
            console.log("⚠️  Warnings:");
            result.warnings.forEach(warning => console.log(`  • ${warning}`));
            console.log();
        }

        // Handle help flag
        if (result.options.help) {
            showEnhancedHelp(cliHandler);
            return;
        }

        // Handle list flag
        if (result.options.list) {
            showAvailableAgents();
            return;
        }

        // Handle dry-run mode
        if (result.options.dryRun && result.command) {
            await handleDryRunMode(result.command, result.options);
            return;
        }

        // Execute enhanced review command
        if (result.command) {
            await executeEnhancedReviewCommand(result.command, result.options);
        } else {
            console.log("❌ No valid review command found");
            console.log("Use 'nova agent --help' for usage information");
        }

    } catch (error) {
        logger.error("Enhanced review command failed:", error);
        console.log(`❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`);
        Deno.exit(1);
    }
}

/**
 * Show enhanced help information
 */
function showEnhancedHelp(cliHandler: EnhancedCLIHandler): void {
    const baseHelp = `
🤖 Nova Agent Enhanced Review Command

USAGE:
    nova agent review [OPTIONS] [FILES...]
    nova agent review [OPTIONS] changes
    nova agent review [OPTIONS] pr [PR_ID]

BASIC OPTIONS:
    -a, --agent <TYPE>     Agent type to use (default: enhanced)
    -i, --interactive      Run in interactive mode
    -l, --list             List available agents
    -h, --help             Show this help message
    -v, --verbose          Enable verbose logging

BASIC EXAMPLES:
    # Review specific files
    nova agent review src/main.ts src/utils.ts
    
    # Review all changed files
    nova agent review changes
    
    # Review pull request
    nova agent review pr 123
`;

    console.log(baseHelp);
    console.log(cliHandler.generateEnhancedHelp());
}

/**
 * Handle dry-run mode
 */
async function handleDryRunMode(command: any, options: EnhancedCLIOptions): Promise<void> {
    console.log("🔍 Dry Run Mode - Analysis Plan");
    console.log("═".repeat(50));

    // Create agent to access dry-run functionality
    const agent = await createEnhancedAgent();

    // Convert enhanced command to query string for agent
    const query = buildQueryFromCommand(command);

    console.log(`📋 Command: ${query}`);
    console.log(`📊 Output Format: ${options.outputFormat}`);
    console.log(`📁 Group by Directory: ${options.groupByDirectory ? 'Yes' : 'No'}`);
    console.log(`🔄 Sequential Processing: ${options.sequential ? 'Yes' : 'No'}`);

    if (options.jsonReport) {
        console.log(`📄 JSON Report: ${options.jsonReport}`);
    }

    if (command.files && command.files.length > 0) {
        console.log(`\n📂 Files to analyze (${command.files.length}):`);
        command.files.forEach((file: string, index: number) => {
            console.log(`  ${index + 1}. ${file}`);
        });
    }

    console.log("\n✅ Dry run complete. Use without --dry-run to execute.");
}

/**
 * Execute enhanced review command
 */
async function executeEnhancedReviewCommand(command: any, options: EnhancedCLIOptions): Promise<void> {
    console.log(`🤖 Running enhanced review with ${options.agent || 'enhanced'} agent...\n`);

    // Create enhanced agent
    const agent = await createEnhancedAgent();

    // Convert enhanced command to query string for agent
    const query = buildQueryFromCommand(command);

    // Execute the review
    const response = await agent.execute(query);

    // Handle response based on output format
    await handleEnhancedResponse(response, options);
}

/**
 * Create enhanced agent instance
 */
async function createEnhancedAgent() {
    return await createAgent("enhanced");
}

/**
 * Build query string from enhanced command
 */
function buildQueryFromCommand(command: any): string {
    switch (command.mode) {
        case 'file':
            return `review ${command.files?.join(' ') || ''}`;
        case 'changes':
            return 'review changes';
        case 'pr':
            return command.prId ? `review pr ${command.prId}` : 'review pr';
        default:
            return 'review';
    }
}

/**
 * Handle enhanced response based on output format
 */
async function handleEnhancedResponse(response: any, options: EnhancedCLIOptions): Promise<void> {
    // Always show console output unless format is 'json' only
    if (options.outputFormat !== 'json') {
        if (response.success) {
            console.log("\n✅ Response:\n");
            console.log(response.content);

            if (response.metadata?.analysisType) {
                console.log(`\n📊 Analysis Type: ${response.metadata.analysisType}`);
            }

            if (response.data) {
                console.log("\n📋 Structured Data Available");
            }
        } else {
            console.log("❌ Error:");
            console.log(response.content);
            if (response.error) {
                console.log(`Details: ${response.error}`);
            }
        }
    }

    // Generate JSON report if requested
    if (options.jsonReport || options.outputFormat === 'json' || options.outputFormat === 'both') {
        await generateJSONReport(response, options);
    }

    // Exit with error code if response failed
    if (!response.success) {
        Deno.exit(1);
    }
}

/**
 * Generate JSON report
 */
async function generateJSONReport(response: any, options: EnhancedCLIOptions): Promise<void> {
    try {
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                version: "1.0.0",
                outputFormat: options.outputFormat,
                options: {
                    dryRun: options.dryRun,
                    groupByDirectory: options.groupByDirectory,
                    sequential: options.sequential,
                    showProgress: options.showProgress
                }
            },
            response: {
                success: response.success,
                content: response.content,
                error: response.error,
                metadata: response.metadata,
                data: response.data
            }
        };

        const jsonContent = JSON.stringify(report, null, 2);

        if (options.jsonReport) {
            // Save to file
            await Deno.writeTextFile(options.jsonReport, jsonContent);
            console.log(`📄 JSON report saved to: ${options.jsonReport}`);
        } else if (options.outputFormat === 'json') {
            // Output to console
            console.log(jsonContent);
        }

    } catch (error) {
        logger.error("Failed to generate JSON report:", error);
        console.log(`❌ Failed to generate JSON report: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

/**
 * Check if a string is a valid agent name
 */
function isValidAgentName(name: string): boolean {
    const validAgents = ['example', 'dev', 'development', 'enhanced', 'review', 'code-review'];
    return validAgents.includes(name.toLowerCase());
}

/**
 * Check if a string is a review command
 */
export function isReviewCommand(input: string): boolean {
    const reviewPatterns = [
        /^review\s/i,
        /^review$/i,
        /^code-review\s/i,
        /^code-review$/i,
    ];
    return reviewPatterns.some(pattern => pattern.test(input.trim()));
}

interface AgentCommandOptions {
    agent?: string;
    interactive?: boolean;
    help?: boolean;
    list?: boolean;
    verbose?: boolean;
}

/**
 * Main agent command handler
 */
export async function agentCommand(args: string[]): Promise<void> {
    // Check if this is an enhanced review command with new CLI options
    if (hasEnhancedOptions(args)) {
        await handleEnhancedReviewCommand(args);
        return;
    }

    const parsedArgs = parseArgs(args, {
        string: ["agent"],
        boolean: ["interactive", "help", "list", "verbose"],
        alias: {
            a: "agent",
            i: "interactive",
            h: "help",
            l: "list",
            v: "verbose"
        },
        default: {
            agent: "example",
            interactive: false,
            help: false,
            list: false,
            verbose: false
        }
    });

    // Handle special case: nova agent <agent-name> help
    if (parsedArgs._.length >= 2 && parsedArgs._[parsedArgs._.length - 1] === 'help') {
        const agentName = parsedArgs._[0] as string;
        const helpQuery = 'help';
        await runSingleQuery(helpQuery, { agent: agentName });
        return;
    }

    // Handle special case: nova agent <agent-name> <query> (when first arg is agent name)
    if (parsedArgs._.length >= 2 && isValidAgentName(parsedArgs._[0] as string)) {
        const agentName = parsedArgs._[0] as string;
        const query = parsedArgs._.slice(1).join(" ");
        await runSingleQuery(query, { agent: agentName });
        return;
    }

    // Handle special case: nova agent review <subcommand> (auto-route to enhanced agent)
    if (parsedArgs._.length >= 1 && isReviewCommand(parsedArgs._.join(" "))) {
        const query = parsedArgs._.join(" ");
        await runSingleQuery(query, { agent: "enhanced" });
        return;
    }

    const options: AgentCommandOptions = {
        agent: parsedArgs.agent,
        interactive: parsedArgs.interactive,
        help: parsedArgs.help,
        list: parsedArgs.list,
        verbose: parsedArgs.verbose
    };

    if (options.verbose) {
        // Note: Logger doesn't have setLevel method, use debug environment variable instead
        Deno.env.set('NOVA_DEBUG', 'true');
    }

    try {
        // Handle help flag
        if (options.help) {
            showAgentHelp();
            return;
        }

        // Handle list flag
        if (options.list) {
            showAvailableAgents();
            return;
        }

        // Handle interactive mode
        if (options.interactive) {
            await runInteractiveMode(options);
            return;
        }

        // Handle single query mode
        const query = parsedArgs._.join(" ");
        if (!query) {
            console.log("❌ Please provide a query or use --interactive mode");
            console.log("Use 'nova agent --help' for usage information");
            return;
        }

        await runSingleQuery(query, options);

    } catch (error) {
        logger.error("Agent command failed:", error);
        console.log(`❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`);
        Deno.exit(1);
    }
}

/**
 * Run agent in interactive mode
 */
async function runInteractiveMode(options: AgentCommandOptions): Promise<void> {
    console.log("🤖 Nova Agent Interactive Mode");
    console.log(`Agent: ${options.agent}`);
    console.log("Type 'exit' to quit, 'help' for agent help\n");

    const agent = await createAgent(options.agent!);

    while (true) {
        const input = prompt("💬 Your question: ");

        if (!input) {
            continue;
        }

        if (input.toLowerCase() === "exit") {
            console.log("👋 Goodbye!");
            break;
        }

        if (input.toLowerCase() === "help") {
            const helpText = await agent.help();
            console.log(helpText);
            continue;
        }

        console.log("🔄 Processing...\n");

        const response = await agent.execute(input);

        if (response.success) {
            console.log("\n✅ Response:\n");
            console.log(response.content);

            if (response.metadata?.analysisType) {
                console.log(`\n📊 Analysis Type: ${response.metadata.analysisType}`);
            }
        } else {
            console.log("❌ Error:");
            console.log(response.content);
            if (response.error) {
                console.log(`Details: ${response.error}`);
            }
        }

        console.log("\n" + "─".repeat(50) + "\n");
    }
}

/**
 * Run a single query and exit
 */
async function runSingleQuery(query: string, options: AgentCommandOptions): Promise<void> {
    console.log(`🤖 Running query with ${options.agent} agent...\n`);

    const agent = await createAgent(options.agent!);
    const response = await agent.execute(query);

    if (response.success) {
        console.log("\n✅ Response:\n");
        console.log(response.content);

        if (response.metadata?.analysisType) {
            console.log(`\n📊 Analysis Type: ${response.metadata.analysisType}`);
        }

        if (response.data) {
            console.log("\n📋 Structured Data Available");
        }
    } else {
        console.log("❌ Error:");
        console.log(response.content);
        if (response.error) {
            console.log(`Details: ${response.error}`);
        }
        Deno.exit(1);
    }
}

/**
 * Create an agent instance
 */
async function createAgent(agentType: string) {
    const config = await configManager.loadConfig();
    const mcpService = MCPService.getInstance(config);
    const logger = new Logger('Agent');

    // Create LLM provider from configuration
    const { createLLMProvider } = await import('../agents/llm-factory.ts');
    const agentLLMProvider = await createLLMProvider(config, logger);

    // Adapter to convert agent LLMProvider to tool_types LLMProvider interface
    const llmProvider: LLMProvider = {
        name: agentLLMProvider.name,
        isAvailable: () => agentLLMProvider.isAvailable(),
        listModels: () => agentLLMProvider.listModels(),
        setModel: (model: string) => agentLLMProvider.setModel(model),
        generate: (prompt: string) => agentLLMProvider.generate(prompt),
        generateObject: async <T>(prompt: string, schema: Record<string, unknown> | z.ZodType<T>) => {
            // Convert to the agent LLMProvider interface
            return await agentLLMProvider.generateObject({
                prompt,
                schema: schema as z.ZodType<T>,
            });
        },
        chat: (messages: Array<{ role: string; content: string }>, tools?: ToolFunction[]) =>
            agentLLMProvider.chat(messages, { tools }),
    };

    const context: AgentContext = {
        config,
        mcpService,
        logger,
        llmProvider,
        workingDirectory: Deno.cwd(),
    };

    switch (agentType.toLowerCase()) {
        case "example":
        case "dev":
        case "development":
            return createExampleAgent(context);

        case "enhanced":
        case "review":
        case "code-review":
            return createEnhancedCodeReviewAgent(context);

        default:
            throw new Error(`Unknown agent type: ${agentType}. Available agents: example, enhanced`);
    }
}

/**
 * Show help information
 */
function showAgentHelp(): void {
    console.log(`
🤖 Nova Agent Command

USAGE:
    nova agent [OPTIONS] [QUERY]
    nova agent <AGENT_NAME> [QUERY]
    nova agent <AGENT_NAME> help
    nova agent review [ENHANCED_OPTIONS] [SUBCOMMAND]

OPTIONS:
    -a, --agent <TYPE>     Agent type to use (default: example)
    -i, --interactive      Run in interactive mode
    -l, --list             List available agents
    -h, --help             Show this help message
    -v, --verbose          Enable verbose logging

ENHANCED REVIEW OPTIONS:
    -d, --dry-run          Show analysis plan without executing
    -j, --json-report <path>  Generate JSON report at specified path
    -g, --group-by-directory  Group files by directory in output
    -o, --output-format <fmt> Output format: console, json, or both
    -s, --sequential       Process files sequentially (default: true)
    -p, --show-progress    Show progress indicator (default: true)
    --show-eta             Show estimated time remaining
    --show-throughput      Show processing throughput
    --max-errors <num>     Maximum errors before stopping (default: 10)
    --continue-on-error    Continue processing after errors (default: true)
    --file-ordering <order> File processing order: alphabetical, size, modified, natural

EXAMPLES:
    # Basic usage
    nova agent "How do I implement error handling in TypeScript?"
    nova agent example "What are React best practices?"
    
    # Enhanced code review examples
    nova agent review src/main.ts                    # Review specific file
    nova agent review src/*.ts src/*.js              # Review multiple files
    nova agent review                                # Review changed files
    nova agent review changes                        # Review changed files (explicit)
    nova agent review pr                             # Review pull request
    nova agent review pr 123                        # Review specific PR/MR
    
    # Enhanced options examples
    nova agent review --dry-run src/*.ts            # Show analysis plan
    nova agent review --json-report report.json src/ # Generate JSON report
    nova agent review --group-by-directory src/**/*.ts # Group by directory
    nova agent review --output-format both --show-eta src/ # Multiple options
    
    # Alternative enhanced agent usage
    nova agent enhanced "review src/components/"
    nova agent code-review "review pr"
    
    # Get help for specific agent
    nova agent example help
    nova agent enhanced help
    
    # Run in interactive mode
    nova agent --interactive
    nova agent enhanced --interactive
    
    # List available agents
    nova agent --list

AGENTS:
    example    Development assistant for code analysis and Q&A
    enhanced   Enhanced code review agent with comprehensive analysis

For enhanced review options help, use: nova agent review --help
For agent-specific help, use: nova agent <agent-name> help
`);
}

/**
 * Show available agents
 */
function showAvailableAgents(): void {
    console.log(`
🤖 Available Nova Agents:

📋 example (aliases: dev, development)
   Development assistant that can analyze code and answer programming questions
   
   Capabilities:
   • Code file analysis with complexity assessment
   • Programming Q&A and best practices
   • Improvement suggestions and issue detection
   • Support for multiple programming languages

   Usage Examples:
   nova agent example "How do I implement error handling in TypeScript?"
   nova agent example "analyze src/components/Header.tsx"

📋 enhanced (aliases: review, code-review)
   Enhanced code review agent with comprehensive analysis capabilities
   
   Capabilities:
   • Specific file review with detailed feedback and grading (A-F)
   • Automatic change detection and review of modified files
   • Pull request/merge request review with automated comment posting
   • Security, performance, and style issue detection
   • Test coverage assessment and business value evaluation
   • CLI table formatting with color-coded results
   • Line-specific issue reporting with actionable suggestions
   • GitLab and GitHub integration

   Review Modes:
   1. File Review Mode - Analyze specific files
      nova agent review src/main.ts
      nova agent review src/*.ts src/*.js
      
   2. Changes Review Mode - Review modified files automatically
      nova agent review
      nova agent review changes
      
   3. Pull Request Review Mode - Review PRs/MRs with automated feedback
      nova agent review pr
      nova agent review pr 123

   Alternative Usage:
   nova agent enhanced "review src/components/"
   nova agent code-review "review pr"
`);
}
