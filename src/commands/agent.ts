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

const logger = new Logger("agent-command");

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
            console.log("✅ Response:");
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
        console.log("✅ Response:");
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
    const logger = new Logger(`agent-${agentType}`);
    
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
    nova agent review [SUBCOMMAND]

OPTIONS:
    -a, --agent <TYPE>     Agent type to use (default: example)
    -i, --interactive      Run in interactive mode
    -l, --list             List available agents
    -h, --help             Show this help message
    -v, --verbose          Enable verbose logging

EXAMPLES:
    # Ask a single question with default agent
    nova agent "How do I implement error handling in TypeScript?"
    
    # Analyze a code file with default agent
    nova agent "analyze src/components/Header.tsx"
    
    # Use specific agent with query
    nova agent example "What are React best practices?"
    
    # Enhanced code review examples
    nova agent review src/main.ts                    # Review specific file
    nova agent review src/*.ts src/*.js              # Review multiple files
    nova agent review                                # Review changed files
    nova agent review changes                        # Review changed files (explicit)
    nova agent review pr                             # Review pull request
    nova agent review pr 123                        # Review specific PR/MR
    
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
