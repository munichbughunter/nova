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
        hasExistingMCPSection = currentInstructions.includes('## Using MCP Tools');
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

## Tesla Screenplay Pattern Knowledge

### Core Principles
When working with Playwright tests, always use the Tesla Screenplay Pattern approach:

1. **Actor-Centric Design**: Tests should read like user stories
2. **Separation of Concerns**: Keep WHAT separate from HOW
3. **Reusability**: Create composable, reusable components
4. **Readability**: Code should be self-documenting

### Pattern Components

#### Actors
\`\`\`typescript
import { Actor, BrowseTheWeb } from '@testla/screenplay-playwright';

const user = Actor.named('User').can(BrowseTheWeb.using(page));
\`\`\`

#### Tasks (Business Actions)
\`\`\`typescript
export const Login = {
    withCredentials: (email: string, password: string) =>
        Task.where\`#actor logs in with \${email}\`,
        Navigate.to('/login'),
        Fill.in(LoginForm.email).with(email),
        Fill.in(LoginForm.password).with(password),
        Click.on(LoginForm.submitButton)
};
\`\`\`

#### Questions (Assertions)
\`\`\`typescript
export const CurrentPage = () =>
    Page.current().url();

// Usage in tests
await expect(actor.asks(CurrentPage())).resolves.toContain('/dashboard');
\`\`\`

#### Actions (Low-level interactions)
\`\`\`typescript
import { Click, Fill, Navigate, Wait } from '@testla/screenplay-playwright';
\`\`\`

### Code Generation Guidelines

When generating Playwright test code:

1. **Always use Screenplay Pattern** - Never generate traditional Page Object Model code
2. **Start with Actors** - Every test should begin with an Actor
3. **Use Tasks for business logic** - Group related actions into Tasks
4. **Use Questions for assertions** - Don't use direct Playwright assertions
5. **Keep Actions atomic** - Each Action should do one thing
6. **Use descriptive names** - Names should reflect business intent

### Example Test Structure
\`\`\`typescript
import { test, expect } from '@playwright/test';
import { Actor, BrowseTheWeb } from '@testla/screenplay-playwright';

test('user can complete checkout process', async ({ page }) => {
    const customer = Actor.named('Customer').can(BrowseTheWeb.using(page));

    await customer.attemptsTo(
        Login.withCredentials('customer@example.com', 'password'),
        AddToCart.product('Laptop').withQuantity(1),
        ProceedToCheckout.and().fillShippingDetails({
            address: '123 Main St',
            city: 'Anytown',
            zipCode: '12345'
        }),
        CompletePayment.withCreditCard({
            number: '4111111111111111',
            expiry: '12/25',
            cvv: '123'
        })
    );

    await expect(
        customer.asks(OrderConfirmation.number())
    ).resolves.toMatch(/^ORD-\\d{6}$/);
});
\`\`\`

### Anti-Patterns to Avoid

❌ **Don't use Page Object Model**:
\`\`\`typescript
// BAD
const loginPage = new LoginPage(page);
await loginPage.login('user@example.com', 'password');
\`\`\`

✅ **Use Screenplay Tasks**:
\`\`\`typescript
// GOOD
await actor.attemptsTo(
    Login.withCredentials('user@example.com', 'password')
);
\`\`\`

❌ **Don't use direct Playwright assertions**:
\`\`\`typescript
// BAD
await expect(page.locator('#welcome')).toBeVisible();
\`\`\`

✅ **Use Screenplay Questions**:
\`\`\`typescript
// GOOD
await expect(
    actor.asks(Element.isVisible().of('#welcome'))
).resolves.toBe(true);
\`\`\`

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

/**
 * Creates the review prompt file in .github/prompts directory
 * @param {string} projectPath - The root path of the project
 * @param {boolean} force - Overwrite the file if it exists
 */
async function createReviewPrompt(projectPath: string, force = false): Promise<void> {
    const promptsDirPath = `${projectPath}/.github/prompts`;
    const reviewPromptPath = `${promptsDirPath}/review.prompt.md`;

    // Check if the .github/prompts directory exists
    if (!await exists(promptsDirPath)) {
        await Deno.mkdir(promptsDirPath, { recursive: true });
        logger.info(colors.green(`✓ Created .github/prompts directory`));
    }

    // Check if the review prompt file already exists and force is not set
    if (await exists(reviewPromptPath) && !force) {
        logger.info(colors.blue("ℹ Review prompt file already exists"));
        return;
    }

    const reviewPromptContent = `# Role
You are an expert software reviewer bot specialized in GitLab merge requests. You perform deep, high-quality reviews with inline comments directly in the code diffs. You follow best practices for maintainability, security, and clarity.

# Objective
Guide the user through selecting a GitLab project and merge request. Then, perform a detailed code review. Your comments must be inserted **inline into the diff view**, at the correct line and file.

# Workflow

1. **Projekt auswählen**
   - Frage den User: „Welches GitLab-Projekt möchtest du prüfen?"
   - Suche nach Projekten über GitLab API (v4) anhand des eingegebenen Namens oder Keywords.
   - Liste passende Projekte mit Namen, ID und kurzer Beschreibung.

2. **Merge Requests anzeigen**
   - Hole alle **offenen Merge Requests** des gewählten Projekts.
   - Liste Titel, Ersteller, Branch und kurze Beschreibung.

3. **Merge Request auswählen**
   - Frage den User: „Welcher Merge Request soll reviewed werden?"
   - Warte auf Auswahl (per ID oder Titel).

4. **Review vorbereiten**
   - Lade alle Commits, betroffene Dateien und Diffs.
   - Lies Beschreibung und Kontext des Merge Requests.

5. **Review durchführen**
   - Gehe Datei für Datei, Zeile für Zeile durch die Diffs.
   - Schreibe **direkt inline Kommentare an die betroffenen Code-Stellen**, dort wo du Verbesserungspotential siehst.
   - Fokus auf:
     - Verständlichkeit
     - Saubere Struktur & Wiederverwendbarkeit
     - Naming, Duplication, Modularisierung
     - Sicherheitsprobleme, z. B. eval(), SQL injection, Secrets
     - Code-Smells, unnötige Komplexität
     - Linter-Verstöße oder fehlende Tests

6. **Kommentare einfügen**
   - Nutze GitLab API \`POST /projects/:id/merge_requests/:iid/discussions\` um direkt Kommentare an Code-Zeilen zu posten.
   - Jeder Kommentar sollte:
     - Hilfreich, konkret und freundlich sein
     - Einen Verbesserungsvorschlag enthalten
     - Optional einen Link zu Best Practices enthalten

   Beispiel:
   \`\`\`diff
   - const password = req.body.password;
   + const password = req.body.password;
   + // 🔒 Avoid storing raw passwords. Use bcrypt or Argon2 to hash them before usage.
   \`\`\`
`;

    try {
        await Deno.writeTextFile(reviewPromptPath, reviewPromptContent);
        logger.info(colors.green(`✓ Created .github/prompts/review.prompt.md`));
    } catch (error) {
        logger.error('Failed to create review prompt file:', error);
        throw error;
    }
}

/**
 * Creates the screenplay pattern prompt file in .github/prompts directory
 * @param {string} projectPath - The root path of the project
 * @param {boolean} force - Overwrite the file if it exists
 */
async function createScreenplayPrompt(projectPath: string, force = false): Promise<void> {
    const promptsDirPath = `${projectPath}/.github/prompts`;
    const screenplayPromptPath = `${promptsDirPath}/playwright-screenplay.prompt.md`;

    // Check if the .github/prompts directory exists
    if (!await exists(promptsDirPath)) {
        await Deno.mkdir(promptsDirPath, { recursive: true });
        logger.info(colors.green(`✓ Created .github/prompts directory`));
    }

    // Check if the screenplay prompt file already exists and force is not set
    if (await exists(screenplayPromptPath) && !force) {
        logger.info(colors.blue("ℹ Screenplay prompt file already exists"));
        return;
    }

    const screenplayPromptContent = `# Role
You are an expert in the Tesla Screenplay Pattern for Playwright test automation. You help developers write clean, maintainable test automation code using the actor-centric approach.

# Tesla Screenplay Pattern Knowledge

## Core Principles
The Screenplay Pattern is an actor-centric approach to test automation that focuses on:
- **Actors**: Who perform the actions (users, systems)
- **Abilities**: What actors can do (browse web, call APIs)
- **Tasks**: Business-focused actions that actors perform
- **Actions**: Low-level interactions with the system
- **Questions**: Queries about the system state for assertions

## Architecture Benefits
1. **Separation of Concerns**: Tests focus on WHAT, not HOW
2. **Readability**: Tests read like user stories
3. **Maintainability**: Page changes don't break multiple tests
4. **Reusability**: Common actions are shared across tests

## Core Components

### 1. Actors
Actors represent users or systems that interact with the application:

\`\`\`typescript
import { Actor } from '@testla/screenplay-playwright';

// Single ability actor
const james = Actor.named('James').can(BrowseTheWeb.using(page));

// Multi-ability actor
const admin = Actor.named('Admin')
    .can(BrowseTheWeb.using(page))
    .can(UseAPI.using(request));
\`\`\`

### 2. Abilities
Abilities define what an actor can do:

\`\`\`typescript
import { BrowseTheWeb, UseAPI } from '@testla/screenplay-playwright';

// Web browsing ability
const webActor = Actor.named('User').can(BrowseTheWeb.using(page));

// API calling ability  
const apiActor = Actor.named('ApiUser').can(UseAPI.using(request));
\`\`\`

### 3. Tasks
Tasks are high-level business actions composed of multiple actions:

\`\`\`typescript
import { Task } from '@testla/screenplay-playwright';

export const Login = {
    withCredentials: (email: string, password: string) =>
        Task.where\`#actor logs in with \${email}\`,
        Navigate.to('/login'),
        Fill.in(LoginForm.email).with(email),
        Fill.in(LoginForm.password).with(password),
        Click.on(LoginForm.submitButton),
        Wait.until(Element.isVisible(Dashboard.welcomeMessage))
};

export const CreateAccount = {
    withDetails: (userDetails: UserDetails) =>
        Task.where\`#actor creates account\`,
        Navigate.to('/register'),
        Fill.in(RegisterForm.firstName).with(userDetails.firstName),
        Fill.in(RegisterForm.lastName).with(userDetails.lastName),
        Fill.in(RegisterForm.email).with(userDetails.email),
        Fill.in(RegisterForm.password).with(userDetails.password),
        Click.on(RegisterForm.submitButton)
};
\`\`\`

### 4. Actions
Actions are low-level interactions that directly interact with the UI:

\`\`\`typescript
import { Click, Fill, Navigate, Wait, Select, Check } from '@testla/screenplay-playwright';

// Basic actions
Navigate.to('/products')
Click.on(ProductPage.searchButton)
Fill.in(ProductPage.searchField).with('laptop')
Wait.until(Element.isVisible(ProductPage.searchResults))
Select.option('Large').from(ProductPage.sizeDropdown)
Check.element(ProductPage.agreeToTerms)
\`\`\`

### 5. Questions
Questions provide information about the system state for assertions:

\`\`\`typescript
import { Element, Page } from '@testla/screenplay-playwright';

export const CurrentUrl = () =>
    Page.current().url();

export const ElementText = {
    of: (locator: Locator) =>
        Element.textContent().of(locator)
};

export const IsVisible = {
    of: (locator: Locator) =>
        Element.isVisible().of(locator)
};

export const ElementCount = {
    of: (locator: Locator) =>
        Element.count().of(locator)
};
\`\`\`

## Test Structure Example

\`\`\`typescript
import { test, expect } from '@playwright/test';
import { Actor, BrowseTheWeb } from '@testla/screenplay-playwright';

test.describe('User Authentication', () => {
    test('successful login redirects to dashboard', async ({ page }) => {
        // Arrange
        const james = Actor.named('James').can(BrowseTheWeb.using(page));
        
        // Act
        await james.attemptsTo(
            Login.withCredentials('james@example.com', 'password'),
            AddToCart.product('Laptop').withQuantity(1),
            ProceedToCheckout.and().fillShippingDetails({
                address: '123 Main St',
                city: 'Anytown',
                zipCode: '12345'
            }),
            CompletePayment.withCreditCard({
                number: '4111111111111111',
                expiry: '12/25',
                cvv: '123'
            })
        );
        
        // Assert
        await expect(
            james.asks(CurrentUrl())
        ).resolves.toContain('/dashboard');
        
        await expect(
            james.asks(ElementText.of(Dashboard.welcomeMessage))
        ).resolves.toBe('Welcome, James!');
    });
    
    test('invalid credentials show error message', async ({ page }) => {
        const sarah = Actor.named('Sarah').can(BrowseTheWeb.using(page));
        
        await sarah.attemptsTo(
            Navigate.to('/login'),
            Fill.in(LoginForm.email).with('invalid@example.com'),
            Fill.in(LoginForm.password).with('wrongpassword'),
            Click.on(LoginForm.submitButton)
        );
        
        await expect(
            sarah.asks(IsVisible.of(LoginForm.errorMessage))
        ).resolves.toBe(true);
    });
});
\`\`\`

## Advanced Patterns

### Multi-Actor Scenarios
\`\`\`typescript
test('admin can manage user accounts', async ({ page, context }) => {
    const admin = Actor.named('Admin').can(BrowseTheWeb.using(page));
    const user = Actor.named('User').can(BrowseTheWeb.using(await context.newPage()));
    
    await admin.attemptsTo(
        Login.withCredentials('admin@example.com', 'admin123'),
        Navigate.to('/admin/users'),
        CreateUser.withDetails({
            name: 'New User',
            email: 'newuser@example.com',
            role: 'standard'
        })
    );
    
    await user.attemptsTo(
        Login.withCredentials('newuser@example.com', 'tempPassword'),
        Navigate.to('/profile')
    );
    
    await expect(
        user.asks(ElementText.of(ProfilePage.userName))
    ).resolves.toBe('New User');
});
\`\`\`

### API and Web Integration
\`\`\`typescript
test('create product via API and verify in UI', async ({ page, request }) => {
    const apiUser = Actor.named('ApiUser').can(UseAPI.using(request));
    const webUser = Actor.named('WebUser').can(BrowseTheWeb.using(page));
    
    // Create product via API
    await apiUser.attemptsTo(
        Post.to('/api/products').withData({
            name: 'Test Product',
            price: 29.99,
            category: 'Electronics'
        })
    );
    
    // Verify in UI
    await webUser.attemptsTo(
        Navigate.to('/products'),
        Fill.in(ProductPage.searchField).with('Test Product'),
        Click.on(ProductPage.searchButton)
    );
    
    await expect(
        webUser.asks(IsVisible.of(ProductPage.productCard('Test Product')))
    ).resolves.toBe(true);
});
\`\`\`

### Error Handling and Conditional Logic
\`\`\`typescript
export const SafeLogin = {
    withCredentials: (email: string, password: string, maxRetries = 3) =>
        Task.where\`#actor attempts safe login with retries\`,
        Navigate.to('/login'),
        Fill.in(LoginForm.email).with(email),
        Fill.in(LoginForm.password).with(password),
        Click.on(LoginForm.submitButton),
        
        // Conditional handling
        IfElse.condition(
            IsVisible.of(LoginForm.errorMessage)
        ).then([
            Wait.for(2000),
            Click.on(LoginForm.submitButton) // Retry
        ]).otherwise([
            Wait.until(Element.isVisible(Dashboard.welcomeMessage))
        ])
};
\`\`\`

## Best Practices

### 1. Task Composition
Break complex scenarios into smaller, reusable tasks:

\`\`\`typescript
export const CompleteCheckout = {
    withItems: (items: Product[]) =>
        Task.where\`#actor completes checkout with \${items.length} items\`,
        ...items.map(item => AddToCart.item(item)),
        NavigateToCheckout.now(),
        FillShippingInfo.withDefaults(),
        SelectPaymentMethod.creditCard(),
        ConfirmOrder.and().waitForConfirmation()
};
\`\`\`

### 2. Descriptive Naming
Use business-focused names that reflect user intent:

\`\`\`typescript
// Good: Business-focused
export const ApplyForLoan = { ... };
export const ScheduleMeeting = { ... };
export const SubmitExpenseReport = { ... };

// Avoid: Technical implementation details
export const ClickSubmitButton = { ... };
export const FillFormFields = { ... };
\`\`\`

### 3. Data-Driven Tests
Use screenplay with test data:

\`\`\`typescript
const testUsers = [
    { role: 'admin', email: 'admin@test.com', expectedFeatures: ['user-management', 'reports'] },
    { role: 'user', email: 'user@test.com', expectedFeatures: ['profile', 'settings'] }
];

testUsers.forEach(({ role, email, expectedFeatures }) => {
    test(\`\${role} sees appropriate features\`, async ({ page }) => {
        const actor = Actor.named(role).can(BrowseTheWeb.using(page));
        
        await actor.attemptsTo(
            Login.withCredentials(email, 'password'),
            Navigate.to('/dashboard')
        );
        
        for (const feature of expectedFeatures) {
            await expect(
                actor.asks(IsVisible.of(Navigation.link(feature)))
            ).resolves.toBe(true);
        }
    });
});
\`\`\`

## Anti-Patterns to Avoid

### ❌ Don't use Page Objects directly in tests
\`\`\`typescript
// Avoid this
const loginPage = new LoginPage(page);
await loginPage.enterEmail('test@example.com');
await loginPage.enterPassword('password');
await loginPage.clickSubmit();
\`\`\`

### ✅ Use Screenplay Tasks instead
\`\`\`typescript
// Do this
await actor.attemptsTo(
    Login.withCredentials('test@example.com', 'password')
);
\`\`\`

### ❌ Don't mix abstraction levels
\`\`\`typescript
// Avoid mixing high-level tasks with low-level actions
await actor.attemptsTo(
    Login.withCredentials('test@example.com', 'password'),
    page.click('[data-testid="dashboard-link"]') // Wrong!
);
\`\`\`

### ✅ Keep abstraction levels consistent
\`\`\`typescript
// Do this
await actor.attemptsTo(
    Login.withCredentials('test@example.com', 'password'),
    Navigate.to('/dashboard')
);
\`\`\`

## Integration with Playwright Features

### Screenshots and Tracing
\`\`\`typescript
export const TakeScreenshot = {
    named: (name: string) =>
        Action.where\`#actor takes screenshot \${name}\`,
        async actor => {
            const page = actor.abilityTo(BrowseTheWeb).page;
            await page.screenshot({ path: \`screenshots/\${name}.png\` });
        }
};
\`\`\`

### Custom Waits
\`\`\`typescript
export const WaitForAnimation = {
    toComplete: () =>
        Action.where\`#actor waits for animations to complete\`,
        async actor => {
            const page = actor.abilityTo(BrowseTheWeb).page;
            await page.waitForFunction(() => {
                return document.querySelectorAll('.animate').length === 0;
            });
        }
};
\`\`\`

## When to Use Screenplay Pattern

✅ **Use when:**
- Writing complex user journey tests
- Need high test maintainability
- Want readable, business-focused tests
- Working with multiple user roles
- Building reusable test components
- Team includes non-technical stakeholders

❌ **Consider alternatives when:**
- Writing simple unit tests
- Quick prototyping/spike testing
- Very simple UI interactions
- Performance is critical over maintainability

Remember: The Screenplay Pattern excels at creating maintainable, readable test automation that bridges the gap between business requirements and technical implementation.
`;

    try {
        await Deno.writeTextFile(screenplayPromptPath, screenplayPromptContent);
        logger.info(colors.green(`✓ Created .github/prompts/playwright-screenplay.prompt.md`));
    } catch (error) {
        logger.error('Failed to create screenplay prompt file:', error);
        throw error;
    }
}

/**
 * Creates the screenplay chat mode file in .github/chatmodes directory
 * @param {string} projectPath - The root path of the project
 * @param {boolean} force - Overwrite the file if it exists
 */
async function createScreenplayChatMode(projectPath: string, force = false): Promise<void> {
    const chatModesDirPath = `${projectPath}/.github/chatmodes`;
    const screenplayChatModePath = `${chatModesDirPath}/Testla-Screenplay.chatmode.md`;

    // Check if the .github/chatmodes directory exists
    if (!await exists(chatModesDirPath)) {
        await Deno.mkdir(chatModesDirPath, { recursive: true });
        logger.info(colors.green(`✓ Created .github/chatmodes directory`));
    }

    // Check if the screenplay chat mode file already exists and force is not set
    if (await exists(screenplayChatModePath) && !force) {
        logger.info(colors.blue("ℹ Testla Screenplay chat mode file already exists"));
        return;
    }

    const screenplayChatModeContent = `---
description: 'Expert assistant for Testla Screenplay Pattern with Playwright test automation'
tools: ['f1e_read_task_file', 'f1e_write_task_file', 'f1e_terminal']
---

# Testla Screenplay Pattern Expert

You are an expert in the Testla Screenplay Pattern for Playwright test automation. You help developers write clean, maintainable test automation code following these principles:

## Core Knowledge
- Actor-centric test design that reads like user stories
- Task composition over traditional Page Object Model
- Question-based assertions instead of direct Playwright expects
- Action primitives for low-level interactions
- Ability management for different capabilities
- Memory pattern for actor state management

## Code Style Guidelines
- Fluent, readable syntax that mirrors business language
- Separation of test intent (WHAT) from implementation details (HOW)
- Reusable, composable components
- Strong typing and clear interfaces
- Descriptive naming that reflects business intent

## Pattern Components Priority
1. **Actors** - Who performs the actions
2. **Tasks** - What business actions need to be accomplished
3. **Questions** - What information is needed about system state
4. **Actions** - How to interact with UI elements
5. **Abilities** - What capabilities actors have

## Key Libraries
- \`@testla/screenplay-playwright\` - Core Screenplay implementation
- Standard Playwright for underlying browser automation
- TypeScript for type safety

## When helping with tests, always:
- Suggest Screenplay patterns over traditional approaches
- Create readable, business-focused test scenarios
- Use proper Actor -> Task -> Action hierarchy
- Implement Questions for all assertions
- Maintain separation between business logic and implementation

## Example Response Pattern
When asked to create a test, provide:
1. Actor setup with appropriate abilities
2. Business-focused Tasks that group related actions
3. Questions for state verification
4. Clear, descriptive naming throughout
5. Proper error handling and wait strategies

Focus on maintainability, readability, and business alignment in all suggestions.

## Available Actions Reference
### Web Actions
- Navigate.to(url)
- Click.on(locator)
- Fill.in(locator).with(text)
- Wait.until(condition) / Wait.for(milliseconds)
- Select.option(value).from(locator)
- Check.element(locator)
- Hover.over(locator)
- DoubleClick.on(locator)
- Type.text(text).into(locator)
- Press.key(key)

### API Actions
- Get.from(endpoint)
- Post.to(endpoint).withData(data)
- Put.to(endpoint).withData(data)
- Delete.from(endpoint)

### Questions
- Element.isVisible().of(locator)
- Element.textContent().of(locator)
- Element.count().of(locator)
- Page.current().url()
- Page.current().title()
- Response.statusCode()
- Response.body()

Always prioritize business readability and maintainability over technical complexity.
`;

    try {
        await Deno.writeTextFile(screenplayChatModePath, screenplayChatModeContent);
        logger.info(colors.green(`✓ Created .github/chatmodes/testla-screenplay.chatmode.md`));
    } catch (error) {
        logger.error('Failed to create screenplay chat mode file:', error);
        throw error;
    }
}

/**
 * Creates the screenplay knowledge base files in knowledge-base directory
 * @param {string} projectPath - The root path of the project
 * @param {boolean} force - Overwrite files if they exist
 */
async function createScreenplayKnowledge(projectPath: string, force = false): Promise<void> {
    const knowledgeDir = `${projectPath}/knowledge-base`;
    
    // Create knowledge-base directory
    if (!await exists(knowledgeDir)) {
        await Deno.mkdir(knowledgeDir, { recursive: true });
        logger.info(colors.green(`✓ Created knowledge-base directory`));
    }
    
    const files = [
        {
            name: 'playwright-screenplay-core.md',
            content: `# Tesla Screenplay Pattern für Playwright - Core Knowledge

## Überblick

Das Tesla Screenplay Pattern ist ein actor-zentrierter Ansatz für Test-Automation, der sich auf Verständlichkeit und Wartbarkeit konzentriert.

### Installation

\`\`\`bash
npm install --save-dev @testla/screenplay-playwright
\`\`\`

### Kernkonzepte

#### 1. Actors (Akteure)
Repräsentieren Personen oder Systeme, die mit der Anwendung interagieren.

\`\`\`typescript
import { Actor } from '@testla/screenplay-playwright';

const james = Actor.named('James');
const alice = Actor.named('Alice');
\`\`\`

#### 2. Abilities (Fähigkeiten)
Definieren, was ein Akteur tun kann (z.B. Webseiten navigieren, API-Calls).

\`\`\`typescript
import { BrowseTheWeb, UseAPI } from '@testla/screenplay-playwright';

const webActor = Actor.named('User').can(BrowseTheWeb.using(page));
const apiActor = Actor.named('ApiUser').can(UseAPI.using(request));
\`\`\`

#### 3. Tasks (Aufgaben)
Geschäftsorientierte Aktionen, die ein Akteur ausführen möchte.

\`\`\`typescript
import { Task } from '@testla/screenplay-playwright';

export const Login = {
    withCredentials: (email: string, password: string) =>
        Task.where\`#actor logs in with \${email}\`,
        Navigate.to('/login'),
        Fill.in(LoginForm.email).with(email),
        Fill.in(LoginForm.password).with(password),
        Click.on(LoginForm.submitButton)
};
\`\`\`

#### 4. Actions (Aktionen)
Low-Level-Aktionen wie Klicken, Eingeben, etc.

\`\`\`typescript
import { Click, Fill, Navigate, Wait } from '@testla/screenplay-playwright';

// Grundlegende Aktionen
Navigate.to('/login')
Click.on(LoginForm.submitButton)
Fill.in(LoginForm.email).with('test@example.com')
Wait.until(Element.isVisible(Dashboard.welcomeMessage))
\`\`\`

#### 5. Questions (Fragen)
Ermöglichen es Akteuren, Informationen über den Systemzustand zu erhalten.

\`\`\`typescript
import { Element, Page } from '@testla/screenplay-playwright';

export const CurrentUrl = () => Page.current().url();

export const ElementText = {
    of: (locator: Locator) => Element.textContent().of(locator)
};

export const IsVisible = {
    of: (locator: Locator) => Element.isVisible().of(locator)
};
\`\`\`

## Architektur-Prinzipien

1. **Separation of Concerns**: Tests fokussieren auf WAS, nicht WIE
2. **Lesbarkeit**: Tests lesen sich wie User Stories
3. **Wartbarkeit**: Seitenänderungen brechen nicht mehrere Tests
4. **Wiederverwendbarkeit**: Gemeinsame Aktionen werden geteilt

## Best Practices

1. **Beschreibende Namen**: Tasks sollen Geschäftslogik widerspiegeln
2. **Komposition**: Komplexe Tasks aus einfachen Actions zusammensetzen
3. **Wiederverwendbarkeit**: Gemeinsame Tasks in separate Module
4. **Fehlerbehandlung**: Robuste Wait-Strategien verwenden
5. **Datenkapselung**: Page-spezifische Elemente in Klassen organisieren
`
        },
        {
            name: 'screenplay-advanced-patterns.md',
            content: `# Tesla Screenplay Pattern - Advanced Patterns

## Multi-Actor Scenarios

Handle complex scenarios involving multiple users:

\`\`\`typescript
test('collaborative workflow', async ({ page, context }) => {
    const admin = Actor.named('Admin').can(BrowseTheWeb.using(page));
    const user = Actor.named('User').can(BrowseTheWeb.using(await context.newPage()));
    
    await admin.attemptsTo(
        Login.withCredentials('admin@example.com', 'admin123'),
        Navigate.to('/admin/users'),
        CreateUser.withDetails({
            name: 'New User',
            email: 'newuser@example.com',
            role: 'standard'
        })
    );
    
    await user.attemptsTo(
        Login.withCredentials('newuser@example.com', 'tempPassword'),
        Navigate.to('/profile')
    );
    
    await expect(
        user.asks(ElementText.of(ProfilePage.userName))
    ).resolves.toBe('New User');
});
\`\`\`

## Memory Pattern

Store and retrieve information between actions:

\`\`\`typescript
export const RememberCurrentUrl = () =>
    Task.where\`#actor remembers current URL\`,
    async actor => {
        const url = await actor.asks(CurrentUrl());
        actor.remember('previousUrl', url);
    };

export const NavigateBack = () =>
    Task.where\`#actor navigates back to remembered URL\`,
    async actor => {
        const previousUrl = actor.recall('previousUrl');
        await actor.attemptsTo(Navigate.to(previousUrl));
    };
\`\`\`

## Conditional Logic

Handle different scenarios based on state:

\`\`\`typescript
export const SafeLogin = {
    withCredentials: (email: string, password: string) =>
        Task.where\`#actor attempts safe login\`,
        Navigate.to('/login'),
        Fill.in(LoginForm.email).with(email),
        Fill.in(LoginForm.password).with(password),
        Click.on(LoginForm.submitButton),
        
        IfElse.condition(
            IsVisible.of(LoginForm.errorMessage)
        ).then([
            Wait.for(2000),
            Click.on(LoginForm.submitButton) // Retry
        ]).otherwise([
            Wait.until(Element.isVisible(Dashboard.welcomeMessage))
        ])
};
\`\`\`

## API and Web Integration

Combine API actions with web interactions:

\`\`\`typescript
test('create product via API and verify in UI', async ({ page, request }) => {
    const apiUser = Actor.named('ApiUser').can(UseAPI.using(request));
    const webUser = Actor.named('WebUser').can(BrowseTheWeb.using(page));
    
    // Create product via API
    await apiUser.attemptsTo(
        Post.to('/api/products').withData({
            name: 'Test Product',
            price: 29.99,
            category: 'Electronics'
        })
    );
    
    // Verify in UI
    await webUser.attemptsTo(
        Navigate.to('/products'),
        Fill.in(ProductPage.searchField).with('Test Product'),
        Click.on(ProductPage.searchButton)
    );
    
    await expect(
        webUser.asks(IsVisible.of(ProductPage.productCard('Test Product')))
    ).resolves.toBe(true);
});
\`\`\`

## Custom Abilities

Create domain-specific abilities:

\`\`\`typescript
export class ManageDatabase {
    static using(connection: DatabaseConnection) {
        return new ManageDatabase(connection);
    }
    
    constructor(private connection: DatabaseConnection) {}
    
    async executeQuery(query: string) {
        return await this.connection.query(query);
    }
}

// Usage
const dataAdmin = Actor.named('DataAdmin')
    .can(BrowseTheWeb.using(page))
    .can(ManageDatabase.using(dbConnection));
\`\`\`

## Error Handling Patterns

Robust error handling strategies:

\`\`\`typescript
export const RobustFormSubmission = {
    withData: (formData: FormData) =>
        Task.where\`#actor submits form with retry logic\`,
        Fill.in(Form.fields).with(formData),
        
        // Retry mechanism
        Retry.upTo(3).times(
            Click.on(Form.submitButton),
            Wait.until(
                Either.of(
                    Element.isVisible(Form.successMessage),
                    Element.isVisible(Form.errorMessage)
                )
            )
        ),
        
        IfElse.condition(
            IsVisible.of(Form.errorMessage)
        ).then([
            TakeScreenshot.named('form-error'),
            LogMessage.warning('Form submission failed')
        ])
};
\`\`\`
`
        },
        {
            name: 'screenplay-examples.md',
            content: `# Tesla Screenplay Pattern - Practical Examples

## E-Commerce User Journey

Complete shopping workflow using Screenplay Pattern:

\`\`\`typescript
import { test, expect } from '@playwright/test';
import { Actor, BrowseTheWeb } from '@testla/screenplay-playwright';

test.describe('E-Commerce Shopping Journey', () => {
    test('complete purchase workflow', async ({ page }) => {
        const customer = Actor.named('Customer').can(BrowseTheWeb.using(page));
        
        await customer.attemptsTo(
            Navigate.to('/'),
            SearchForProduct.withTerm('laptop'),
            SelectProduct.fromResults('MacBook Pro'),
            AddToCart.withQuantity(1),
            ProceedToCheckout.now(),
            FillShippingDetails.with({
                address: '123 Main St',
                city: 'Anytown',
                zipCode: '12345'
            }),
            SelectPaymentMethod.creditCard(),
            EnterPaymentDetails.with({
                cardNumber: '4111111111111111',
                expiry: '12/25',
                cvv: '123'
            }),
            ConfirmOrder.and().waitForConfirmation()
        );
        
        await expect(
            customer.asks(OrderConfirmation.number())
        ).resolves.toMatch(/^ORD-\\d{6}$/);
        
        await expect(
            customer.asks(OrderStatus.current())
        ).resolves.toBe('Processing');
    });
});

// Task definitions
export const SearchForProduct = {
    withTerm: (searchTerm: string) =>
        Task.where\`#actor searches for "\${searchTerm}"\`,
        Fill.in(HomePage.searchField).with(searchTerm),
        Click.on(HomePage.searchButton),
        Wait.until(Element.isVisible(SearchResults.container))
};

export const SelectProduct = {
    fromResults: (productName: string) =>
        Task.where\`#actor selects "\${productName}" from results\`,
        Click.on(SearchResults.productLink(productName)),
        Wait.until(Element.isVisible(ProductPage.addToCartButton))
};

export const AddToCart = {
    withQuantity: (quantity: number) =>
        Task.where\`#actor adds \${quantity} item(s) to cart\`,
        Fill.in(ProductPage.quantityField).with(quantity.toString()),
        Click.on(ProductPage.addToCartButton),
        Wait.until(Element.isVisible(ProductPage.addedToCartMessage))
};
\`\`\`

## Form Automation

Complex form handling with validation:

\`\`\`typescript
test('user registration with validation', async ({ page }) => {
    const newUser = Actor.named('NewUser').can(BrowseTheWeb.using(page));
    
    const userData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'SecurePass123!',
        dateOfBirth: '1990-05-15',
        agreeToTerms: true
    };
    
    await newUser.attemptsTo(
        Navigate.to('/register'),
        FillRegistrationForm.withData(userData),
        SubmitForm.and().waitForValidation(),
        VerifyEmailConfirmation.sent()
    );
    
    await expect(
        newUser.asks(RegistrationStatus.message())
    ).resolves.toContain('Registration successful');
});

export const FillRegistrationForm = {
    withData: (userData: UserData) =>
        Task.where\`#actor fills registration form\`,
        Fill.in(RegistrationForm.firstName).with(userData.firstName),
        Fill.in(RegistrationForm.lastName).with(userData.lastName),
        Fill.in(RegistrationForm.email).with(userData.email),
        Fill.in(RegistrationForm.password).with(userData.password),
        Fill.in(RegistrationForm.confirmPassword).with(userData.password),
        Fill.in(RegistrationForm.dateOfBirth).with(userData.dateOfBirth),
        Check.element(RegistrationForm.agreeToTerms)
};
\`\`\`

## Dashboard and Analytics

Data-driven test scenarios:

\`\`\`typescript
test('dashboard displays correct metrics', async ({ page }) => {
    const analyst = Actor.named('Analyst').can(BrowseTheWeb.using(page));
    
    await analyst.attemptsTo(
        Login.withCredentials('analyst@company.com', 'password'),
        Navigate.to('/dashboard'),
        SelectDateRange.from('2024-01-01').to('2024-01-31'),
        RefreshMetrics.and().waitForUpdate()
    );
    
    await expect(
        analyst.asks(MetricValue.for('total-revenue'))
    ).resolves.toBeGreaterThan(10000);
    
    await expect(
        analyst.asks(ChartData.for('monthly-growth'))
    ).resolves.toHaveLength(12);
});

export const SelectDateRange = {
    from: (startDate: string) => ({
        to: (endDate: string) =>
            Task.where\`#actor selects date range from \${startDate} to \${endDate}\`,
            Click.on(Dashboard.dateRangePicker),
            Fill.in(DatePicker.startDate).with(startDate),
            Fill.in(DatePicker.endDate).with(endDate),
            Click.on(DatePicker.applyButton),
            Wait.until(Element.isVisible(Dashboard.loadingIndicator)),
            Wait.until(Element.isNotVisible(Dashboard.loadingIndicator))
    })
};

export const MetricValue = {
    for: (metricName: string) =>
        Question.where\`the value of \${metricName} metric\`,
        async actor => {
            const value = await actor.asks(
                ElementText.of(Dashboard.metric(metricName))
            );
            return parseFloat(value.replace(/[^\\d.-]/g, ''));
        }
};
\`\`\`

## API Testing Integration

Combine UI and API testing:

\`\`\`typescript
test('create user via API and verify in admin panel', async ({ page, request }) => {
    const admin = Actor.named('Admin').can(BrowseTheWeb.using(page));
    const apiClient = Actor.named('ApiClient').can(UseAPI.using(request));
    
    // Create user via API
    const newUserData = {
        name: 'API User',
        email: 'apiuser@example.com',
        role: 'standard'
    };
    
    await apiClient.attemptsTo(
        Authenticate.withToken('admin-api-token'),
        Post.to('/api/users').withData(newUserData)
    );
    
    const userId = await apiClient.asks(
        ResponseBody.jsonPath('$.id')
    );
    
    // Verify in UI
    await admin.attemptsTo(
        Login.withCredentials('admin@example.com', 'password'),
        Navigate.to('/admin/users'),
        SearchForUser.withEmail(newUserData.email)
    );
    
    await expect(
        admin.asks(UserDetails.id())
    ).resolves.toBe(userId);
    
    await expect(
        admin.asks(UserDetails.status())
    ).resolves.toBe('Active');
});

export const Authenticate = {
    withToken: (token: string) =>
        Task.where\`#actor authenticates with API token\`,
        SetHeader.name('Authorization').value(\`Bearer \${token}\`)
};

export const ResponseBody = {
    jsonPath: (path: string) =>
        Question.where\`response body at path \${path}\`,
        async actor => {
            const response = actor.recall('lastResponse');
            const body = await response.json();
            return jsonPath(body, path);
        }
};
\`\`\`

## Page Object Integration

Bridge between Screenplay and Page Objects:

\`\`\`typescript
// Page Object (for element definitions)
export class LoginPage {
    static email = page.locator('[data-testid="email"]');
    static password = page.locator('[data-testid="password"]');
    static submitButton = page.locator('[data-testid="submit"]');
    static errorMessage = page.locator('[data-testid="error"]');
}

// Screenplay Tasks using Page Object locators
export const Login = {
    withCredentials: (email: string, password: string) =>
        Task.where\`#actor logs in with \${email}\`,
        Navigate.to('/login'),
        Fill.in(LoginPage.email).with(email),
        Fill.in(LoginPage.password).with(password),
        Click.on(LoginPage.submitButton),
        Wait.until(Element.isNotVisible(LoginPage.errorMessage))
};

// Questions using Page Object locators
export const LoginError = {
    message: () =>
        Question.where\`login error message\`,
        ElementText.of(LoginPage.errorMessage)
};
\`\`\`
`
        }
    ];
    
    for (const file of files) {
        const filePath = `${knowledgeDir}/${file.name}`;
        
        if (await exists(filePath) && !force) {
            logger.info(colors.blue(`ℹ Knowledge file ${file.name} already exists`));
            continue;
        }
        
        try {
            await Deno.writeTextFile(filePath, file.content);
            logger.info(colors.green(`✓ Created knowledge-base/${file.name}`));
        } catch (error) {
            logger.error(`Failed to create knowledge file ${file.name}:`, error);
        }
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
            const mcpConfigExists = vscodeConfigExists || cursorConfigExists;
            
            if (mcpConfigExists && !force) {
                logger.error(
                    colors.yellow('\nMCP configuration files already exist. Use --force to overwrite.'),
                );
                logger.passThrough('log', colors.dim('Existing files:'));
                if (vscodeConfigExists) logger.passThrough('log', colors.dim('  - .vscode/mcp.json'));
                if (cursorConfigExists) logger.passThrough('log', colors.dim('  - .cursor/mcp.json'));
                
                // Still create review prompt file if it doesn't exist, even if MCP config exists
                try {
                    await createReviewPrompt(projectPath, false);
                } catch (error) {
                    logger.warn(colors.yellow(`Unable to create review prompt file: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
                
                // Create screenplay pattern files even if MCP config exists
                try {
                    await createScreenplayPrompt(projectPath, false);
                } catch (error) {
                    logger.warn(colors.yellow(`Unable to create screenplay prompt file: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
                
                try {
                    await createScreenplayKnowledge(projectPath, false);
                } catch (error) {
                    logger.warn(colors.yellow(`Unable to create screenplay knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
                
                try {
                    await createScreenplayChatMode(projectPath, false);
                } catch (error) {
                    logger.warn(colors.yellow(`Unable to create screenplay chat mode: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
                
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
            // Create review prompt file
            try {
                await createReviewPrompt(projectPath, force);
            } catch (error) {
                logger.warn(colors.yellow(`Unable to create review prompt file: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
            
            // Create screenplay pattern prompt file
            try {
                await createScreenplayPrompt(projectPath, force);
            } catch (error) {
                logger.warn(colors.yellow(`Unable to create screenplay prompt file: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
            
            // Create screenplay knowledge base
            try {
                await createScreenplayKnowledge(projectPath, force);
            } catch (error) {
                logger.warn(colors.yellow(`Unable to create screenplay knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
            
            // Create screenplay chat mode
            try {
                await createScreenplayChatMode(projectPath, force);
            } catch (error) {
                logger.warn(colors.yellow(`Unable to create screenplay chat mode: ${error instanceof Error ? error.message : 'Unknown error'}`));
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

