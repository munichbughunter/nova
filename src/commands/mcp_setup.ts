import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { exists } from 'std/fs/exists.ts';
import { Logger } from '../utils/logger.ts';
import { NOVA_VERSION } from '../version.ts';

const logger = new Logger('MCP Setup');

/**
 * Updates or creates the GitHub Copilot instructions file with Nova MCP information
 * @param {string} projectPath - The root path of the project
 */
async function updateCopilotInstructions(projectPath: string): Promise<void> {
    const instructionsFilePath = `${projectPath}/.github/copilot-instructions.md`;
    const githubDirPath = `${projectPath}/.github`;
    // Check if the .github directory exists
    if (!await exists(githubDirPath)) {
        await Deno.mkdir(githubDirPath, { recursive: true });
        logger.info(colors.green(`✓ Created .github directory`));
    }
    let currentInstructions = '';
    let hasExistingMCPSection = false;

    // Check if the file already exists
    if (await exists(instructionsFilePath)) {
        currentInstructions = await Deno.readTextFile(instructionsFilePath);
        hasExistingMCPSection = currentInstructions.includes('## Using Nova MCP Tools');
    }

    // If MCP section already exists, don't overwrite it
    if(hasExistingMCPSection) {
        logger.info(colors.blue("ℹ Copilot instructions already have MCP section"));
        return;
    }

    // Prepare MCP instructions content to append
    const mcpInstructions = `
## Using MCP Tools

Nova CLI provides Model Context Protocol (MCP) integration for AI agent workflows. This section covers how to use the MCP tools in your development workflow.

### Setting Up MCP

To set up MCP in your project, use the built-in \`mcp_setup\` command:

\`\`\`bash
# Set up MCP configuration in the current project
nova mcp setup

# Force overwrite existing configuration
nova mcp setup --force
\`\`\`

This will create the necessary configuration files for both VS Code and Cursor:
- \`.vscode/mcp.json\`
- \`.cursor/mcp.json\`

### MCP Server Configuration

After running the setup command, the MCP server configuration will be created in \`.vscode/mcp.json\`:

\`\`\`json
{
    "servers": {
        "nova-mcp": {
            "command": "nova",
            "type": "sse",
            "args": ["mcp", "server", "--no-stdio", "--sse"],
            "name": "Nova MCP SSE Server",
            "url": "http://localhost:3020/mcp",
            "version": "1.0.0",
            "debug": true
        }
    }
}
\`\`\`

### Starting the MCP Server

You can start the MCP server using either the VS Code task or directly from the terminal:

\`\`\`bash
# Using VS Code Tasks
# Press Ctrl+Shift+P (Cmd+Shift+P on macOS) > Run Task > Start MCP Server

# Or directly from the terminal
nova mcp server
\`\`\`

**Important**: Always run the Nova CLI commands in the same folder that you're working in. The MCP server needs to access your project files and configuration to work correctly.

### Available MCP Tasks

The following MCP-related tasks are available:

1. **Start MCP Server** - Starts the Nova MCP SSE Server
2. **Run MCP Client Test** - Runs the MCP client test
3. **Setup MCP Tests** - Sets up environment for MCP tests
4. **Run AI Agent Integration** - Tests the AI agent integration with MCP

### Using MCP Tools in Copilot

When working with Copilot and MCP tools:

1. **IMPORTANT: Assume the MCP server is already running** - When an AI assistant is asked to work with an MCP task (like a Jira ticket), always assume the MCP server is already initialized and running. Do not attempt to start the server, perform connection checks, or execute server-related tasks.

2. **Use f1e_* functions directly** - Use the available MCP functions (prefixed with \`f1e_\`) directly without additional checks:
   - **Jira Functions**:
        - \`f1e_jira_search\` - Search for Jira issues using JQL
        - \`f1e_jira_create_issue\` - Create a new Jira issue
        - \`f1e_jira_list_projects\` - List all Jira projects the user has access to
        - \`f1e_jira_list_issues\` - List all issues in a Jira project
        - \`f1e_jira_get_issue\` - Get details for a specific Jira issue
        - \`f1e_jira_get_recent_changes\` - Get details of tickets that changed in the last N days
        - \`f1e_jira_get_assigned_issues\` - Get issues assigned to the current user
        - \`f1e_jira_filter_issues_by_type\` - Filter issues by type such as Bug or Change Request
   - **GitLab Functions**:
        - \`f1e_gitlab_search\` - Search through GitLab resources
        - \`f1e_gitlab_create_issue\` - Create a new GitLab issue
   - **Task Management Functions**:
        - \`f1e_init_task\` - Initialize a new task environment
        - \`f1e_write_task_file\` - Write a file in a task directory
        - \`f1e_read_task_file\` - Read a file from a task directory
        - \`f1e_get_task_info\` - Get task metadata information
   - **Confluence Functions**:
        - \`f1e_confluence_search\` - Search for content in Confluence
        - \`f1e_confluence_create_page\` - Create a new Confluence page
    - \`f1e_terminal\` - Execute terminal commands
    - And other available MCP functions

3. **Keep MCP tools simple** - Call the tools with just the required parameters, avoiding unnecessary options when possible.

4. **Handle errors gracefully** - If an MCP tool call fails, provide useful feedback about what might have gone wrong, but don't attempt to diagnose or fix MCP server connection issues.

### Common MCP Tool Usage Examples

\`\`\`typescript
// Example: Using Jira MCP tools
// Simple Jira search - always use directly without checking server status
const jiraTicket = await f1e_jira_search({ jql: "issue = 'PUB-2222'" });

// Example: Creating a Jira issue
const newIssue = await f1e_jira_create_issue({
    project: "PUB",
    issueType: "Bug",
    summary: "Fix alignment in header navigation",
    description: "The navigation items in the header are misaligned in mobile view."
});

// Example: Using GitLab MCP tools - call directly with required parameters
const gitlabIssues = await f1e_gitlab_search({ 
    query: "api feature", 
    scope: "issues"
});

// Example: Working with task files
await f1e_init_task({ 
    taskName: "bug-fix-navigation"
});

await f1e_write_task_file({ 
    taskDir: "results/task-123", 
    filename: "analysis.md", 
    content: "# Analysis Results\\n\\nFindings from code review..."
});

const taskFileContent = await f1e_read_task_file({
    taskDir: "results/task-123",
    filename: "analysis.md"
});

const taskMetadata = await f1e_get_task_info({
    taskDir: "results/task-123"
});

// Example: Working with Confluence
const searchResults = await f1e_confluence_search({
    query: "API documentation",
    space: "TEAM"
});

await f1e_confluence_create_page({
    space: "TEAM",
    title: "API Documentation",
    content: "h1. API Documentation\\n\\nThis page contains documentation for our REST API endpoints.",
    parentId: "12345"
});
\`\`\`

### MCP Workflow Best Practices

1. **Start with ticket information** - When working on a task, first use \`f1e_jira_search\` to get complete ticket details.

2. **Reference related tickets** - After getting ticket details, check if there are related tickets that provide additional context.

3. **Follow standardized development flow** - When implementing features from tickets:
    - Get ticket details
    - Plan implementation steps
    - Execute necessary code changes
    - Document changes in task files
    - Update ticket status as needed

4. **Keep documentation updated** - Document any MCP-related changes or findings in task files using \`f1e_write_task_file\`.

`;

    // Either create or append to the file
    if (currentInstructions) {
        await Deno.writeTextFile(
            instructionsFilePath, 
            currentInstructions + mcpInstructions
        );
        logger.info(colors.green(`✓ Updated .github/copilot-instructions.md with MCP tools section`));
    } else {
        // For new file, add a header before the MCP section
        const fileHeader = `# Copilot IDE Guidelines for ${getProjectName(projectPath)}
This document provides guidelines for using Copilot IDE with this project.
`;
        await Deno.writeTextFile(
            instructionsFilePath,
            fileHeader + mcpInstructions
        );
        logger.info(colors.green(`✓ Created .github/copilot-instructions.md with MCP tools section`));
    }
}

/**
 * Gets the project name from the directory path
 * @param projectPath The project directory path
 * @returns The project name
 */
function getProjectName(projectPath: string): string {
    return projectPath.split("/").pop() || "Project";
}

async function setupMCPConfig(projectPath: string) {
    const vscodeConfig = {
        servers: {
            'nova-mcp': {
                command: 'nova',
                type: 'sse',
                args: ['mcp', 'server', '--no-stdio', '--sse'],
                name: 'Nova MCP SSE Server',
                url: 'http://localhost:3020/mcp',
                version: NOVA_VERSION,
                debug: true,
            },
        },
    };
    const cursorConfig = {
        mcpServers: {
            'nova-mcp': {
                command: 'nova',
                type: 'sse',
                args: ['mcp', 'server', '--no-stdio', '--sse'],
                name: 'Nova MCP SSE Server',
                url: 'http://localhost:3020/mcp',
                version: NOVA_VERSION,
                debug: true,
            },
        },
    };
    // Create .vscode directory if it doesn't exist
    const vscodeDirPath = `${projectPath}/.vscode`;
    if (!await exists(vscodeDirPath)) {
        await Deno.mkdir(vscodeDirPath, { recursive: true });
        logger.info(colors.green(`✓ Created .vscode directory`));
    }
    // Create .cursor directory if it doesn't exist
    const cursorDirPath = `${projectPath}/.cursor`;
    if (!await exists(cursorDirPath)) {
        await Deno.mkdir(cursorDirPath, { recursive: true });
        logger.info(colors.green(`✓ Created .cursor directory`));
    }
    // Write the configuration files
    try {
        await Deno.writeTextFile(
            `${vscodeDirPath}/mcp.json`,
            JSON.stringify(vscodeConfig, null, 2)
        );
        logger.info(colors.green('✓ Created .vscode/mcp.json'));

        await Deno.writeTextFile(
            `${cursorDirPath}/mcp.json`,
            JSON.stringify(cursorConfig, null, 2),
        );
        logger.info(colors.green('✓ Created .cursor/mcp.json'));
    } catch (error) {
        logger.error('Failed to write MCP configuration files:', error);
        throw error;
    }
}

// Create setup command group
const setupCommand = new Command()
    .description('Set up MCP configuration for the project')
    .option('--force', 'Force setup even if configuration already exists', { default: false })
    .action(async ({ force }: { force: boolean }) => {
        try {
            // Check if current directory is a git repository
            const isGitRepo = await exists('.git');
            if (!isGitRepo) {
                logger.error(colors.red('Current directory is not a git repository'));
                Deno.exit(1);
            }
            // Get the current working directory
            const projectPath = await Deno.realPath('.');
            // Check if config files already exist
            const vscodeConfigExists = await exists(`${projectPath}/.vscode/mcp.json`);
            const cursorConfigExists = await exists(`${projectPath}/.cursor/mcp.json`);
            if ((vscodeConfigExists || cursorConfigExists) && !force) {
                logger.error(
                    colors.yellow('\nMCP configuration files already exist. Use --force to overwrite.'),
                );
                logger.passThrough('log', colors.dim('Existing files:'));
                if (vscodeConfigExists) logger.passThrough('log', colors.dim('  - .vscode/mcp.json'));
                if (cursorConfigExists) logger.passThrough('log', colors.dim('  - .cursor/mcp.json'));
                Deno.exit(1); 
            }
            logger.info(colors.blue('\nSetting up MCP configuration...\n'));
            await setupMCPConfig(projectPath);
            // Update copilot instructions if they exist
            try {
                await updateCopilotInstructions(projectPath);
            } catch (error) {
                logger.warn(colors.yellow(`Unable to update Copilot instructions: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
            logger.info(colors.green('\n✨ MCP setup completed successfully!\n'));
            // Show available commands
            logger.passThrough('log', colors.blue('\nAvailable MCP Commands:'));
            logger.passThrough('log', '  nova mcp setup        - Set up MCP configuration');
            logger.passThrough('log', '  nova mcp server       - Start the MCP server');
            logger.passThrough('log', '');
        } catch (error) {
            logger.error(
                colors.red(
                    `\nError setting up MCP configuration: ${
                        error instanceof Error ? error.message : 'Unknown error'
                    }\n`,
                ),
            );
            Deno.exit(1);
        }
    });

// Add help subcommand to setup
setupCommand.command('help')
    .description('Show help for MCP setup command')
    .action(() => {
        logger.passThrough('log', '\nMCP Setup Command\n');
        logger.passThrough('log', 'Usage:');
        logger.passThrough('log', '  nova mcp setup [options]');
        logger.passThrough('log', '\nOptions:');
        logger.passThrough('log', '  --force    Force setup even if configuration files already exist');
        logger.passThrough('log', '\nDescription:');
        logger.passThrough(
            'log',
            '  Sets up MCP configuration files for VS Code and Cursor in the current',
        );
        logger.passThrough('log', '  git repository. Creates the following files:');
        logger.passThrough('log', '    - .vscode/mcp.json');
        logger.passThrough('log', '    - .cursor/mcp.json');
        logger.passThrough('log', '\nExamples:');
        logger.passThrough('log', colors.dim('  # Set up MCP in current repository'));
        logger.passThrough('log', colors.dim('  nova mcp setup'));
        logger.passThrough('log', colors.dim('  # Force overwrite existing configuration'));
        logger.passThrough('log', colors.dim('  nova mcp setup --force'));
        logger.passThrough('log', '');
    });

export const mcpSetupCommand = setupCommand;

