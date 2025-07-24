# Using Copilot MCP

This guide provides detailed information on how to effectively use GitHub Copilot with Nova's MCP integration to enhance your development workflow.

## Available MCP Tools

When the MCP server is running, Copilot has access to a variety of tools that can interact with your services and project resources. Here are the main categories of tools available:

### File Operations

- **File Reading**: Access file contents from your project
- **Directory Listing**: View directory structures and contents
- **Terminal Commands**: Execute terminal commands securely

### Jira Integration

- **Ticket Search**: Find and retrieve Jira ticket information
- **Issue Creation**: Create new Jira issues
- **Project Listing**: View available Jira projects
- **Issue Management**: Track, update, and filter issues

### GitLab Integration

- **Repository Search**: Search through GitLab repositories
- **Issue Management**: Create and search GitLab issues
- **Merge Request Support**: Work with merge requests

### Confluence Integration

- **Content Search**: Find information in Confluence
- **Page Creation**: Create new Confluence pages
- **Documentation Access**: Access and utilize documentation

### Task Management

- **Task Creation**: Initialize new tasks
- **File Management**: Read and write task-specific files
- **Progress Tracking**: Monitor development progress

## Effective Usage Patterns

Here are some ways to effectively use Copilot MCP in your workflow:

### 1. Project Context Exploration

When starting work on a new feature or bug fix, use Copilot to explore the project context:

```
User: Help me understand the authentication flow in this project.

[Copilot uses MCP tools to search files and documentation]

Copilot: Based on my search, the authentication flow in this project uses OAuth 2.0 with JWT tokens. The main files involved are:
- src/auth/AuthService.ts: Handles the authentication logic
- src/auth/JwtStrategy.ts: Implements the JWT strategy
- src/controllers/AuthController.ts: Exposes the API endpoints

The flow works as follows:
1. User submits credentials to /api/auth/login
2. AuthService validates credentials and generates a JWT token
3. Token is returned to client for subsequent API requests
...
```

### 2. Ticket-Driven Development

Use Copilot to help you work through Jira tickets:

```
User: I need to implement the FEAT-234 ticket. Can you help me plan the implementation?

[Copilot uses f1e_jira_search to get ticket details]

Copilot: I've found FEAT-234: "Implement social login with Google and Facebook".

Based on the ticket description, here's a plan for implementation:
1. Set up OAuth 2.0 configurations for Google and Facebook
2. Create new authentication strategies in src/auth/
3. Add new endpoints in AuthController for social login
4. Update the frontend login component to include social login buttons
5. Add tests for the new authentication flows

Would you like me to help with any specific part of this implementation?
```

### 3. Documentation Management

Use Copilot to help create and update documentation:

```
User: Create a Confluence page documenting our new authentication API

[Copilot uses f1e_confluence_create_page after gathering necessary information]

Copilot: I've created a new Confluence page titled "Authentication API Documentation" in the DEV space. The page includes:
- Authentication endpoints
- Request/response formats
- Error codes
- Example usage

You can view and edit it at: https://yourcompany.atlassian.net/wiki/spaces/DEV/pages/123456789
```

### 4. Code Generation with Context

Use Copilot to generate code based on your project's existing patterns and conventions:

```
User: Generate a new controller for user profile management following our project's existing patterns

[Copilot uses MCP tools to analyze existing code patterns]

Copilot: Based on the existing controller patterns in your project, here's a user profile controller:

```typescript
import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { UserProfileService } from '../services/UserProfileService';
import { UserProfileDto, UpdateProfileDto } from '../dto/UserProfile.dto';

@Controller('user-profiles')
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @Get()
  async findAll() {
    return this.userProfileService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.userProfileService.findOne(id);
  }

  @Post()
  async create(@Body() createDto: UserProfileDto) {
    return this.userProfileService.create(createDto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateDto: UpdateProfileDto) {
    return this.userProfileService.update(id, updateDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.userProfileService.remove(id);
  }
}
```

### 5. Issue Management Across Services

Use Copilot to coordinate between different services:

```
User: Create a GitLab issue based on the critical bug reported in JIRA-567

[Copilot uses f1e_jira_search to find the Jira issue, then f1e_gitlab_create_issue to create a GitLab issue]

Copilot: I've created GitLab issue #78 based on JIRA-567 "Critical: API returning 500 errors under load".

I've included all the relevant details from the Jira ticket including reproduction steps, error logs, and priority. I've also linked back to the Jira ticket in the GitLab issue description.

GitLab issue: https://gitlab.com/yourproject/issues/78
```

## Best Practices

To get the most out of Copilot MCP, follow these best practices:

1. **Keep the MCP Server Running**: Always start the MCP server before interacting with Copilot for tasks that require service integration.

2. **Be Specific in Requests**: When asking Copilot to perform tasks, be as specific as possible about what you want to achieve.

3. **Provide Context**: When asking about code or systems, provide relevant context to help Copilot understand what you're working on.

4. **Task-Based Workflow**: Organize complex work into tasks using the task management capabilities.

5. **Check Results**: Always verify the output of service integrations like Jira ticket creation or GitLab issues.

6. **Iterative Approach**: For complex tasks, work iteratively with Copilot, breaking down larger problems into smaller steps.

## Common Workflows

Here are some common workflows that work well with Copilot MCP:

### Feature Development Workflow

1. Ask Copilot to retrieve the feature ticket details from Jira
2. Request an initial implementation plan based on the ticket
3. Create a task to track implementation progress
4. Get help with specific implementation challenges
5. Update the task with progress notes
6. Create documentation for the new feature in Confluence

### Bug Fix Workflow

1. Ask Copilot to search for related issues or previous fixes
2. Request code analysis to identify potential causes
3. Get assistance with implementing and testing a fix
4. Update the ticket status and add comments via MCP tools
5. Create regression tests to prevent future occurrences

## Additional Resources

- [MCP Server Documentation](../MCP_SERVER.md) - More details on the Nova MCP server
- [Nova GitHub Repository](https://github.com/yourusername/nova) - Source code and issue tracking
- [Model Context Protocol](https://github.com/modelcontextprotocol/typescript-sdk) - Learn more about the underlying protocol
