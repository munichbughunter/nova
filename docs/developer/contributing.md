# Contributing Guide

Thank you for considering contributing to Nova! This guide will help you understand our development
process and standards.

## Getting Started

1. Set up development environment:
   ```bash
   # Clone repository
   git clone 
   cd nova

   ```

## Development Workflow

### 1. Branch Strategy

- `main`: Primary development branch
- `feature/*`: New features
- `fix/*`: Bug fixes
- `docs/*`: Documentation updates

### 2. Code Style

We follow the official Deno style guide:

```typescript
// Use explicit type imports
import type { Command } from '@cliffy/command';

// Use double quotes for strings
const message = 'Hello';

// Use semicolons
const value = 42;

// Use types for function parameters
function process(input: string): void {
  // ...
}
```

### 3. Testing

Run tests:

```bash
# Run all tests
deno test --allow-net --allow-read --allow-write --allow-env

# Run specific test
deno test --filter "test name"

# Run with coverage
deno test --coverage
```

### 4. Snapshot Testing

Nova uses snapshot testing for commands to ensure output stability and catch UI regressions:

1. Create a test file with the `.snapshot.test.ts` extension:
   ```typescript
   import { snapshotTest } from '@cliffy/testing';
   
   await snapshotTest({
     name: 'My Test',
     meta: import.meta,
     colors: true, // Preserve color output
     async fn() {
       // Code that produces output to snapshot
       console.log('Hello world!');
     },
   });
   ```

2. Generate or update snapshots:
   ```bash
   deno test -A --no-check path/to/your.snapshot.test.ts -- --update
   ```

3. Run tests to validate against snapshots:
   ```bash
   deno test -A path/to/your.snapshot.test.ts
   ```

Snapshots are stored in `__snapshots__` directories and should be committed to version control.

## Development Focus

### Current Priorities

1. **Code Review Agent**
   - CI/CD integration
   - Review automation
   - Performance analysis
   - Test coverage

2. **Agent Framework**
   - Core architecture
   - Service interfaces
   - Error handling
   - Testing utilities
   
3. **MCP Server Integration**
   - Model Context Protocol implementation
   - Service integrations via MCP
   - GitHub Copilot integration
   - Tool development

### Upcoming Features

1. **AI Integration**
   - GitHub Copilot (planned)
   - Review suggestions
   - Code analysis
   - Documentation help

2. **Additional Agents**
   - Project management
   - Service management
   - Cloud infrastructure management

## Adding Features

### 1. Commands

New commands should:

- Use the Command pattern
- Include help text
- Support both text and JSON output
- Include tests

Example:

```typescript
export const newCommand = new Command()
  .name('new-feature')
  .description('Description of new feature')
  .option('-f, --format <format:string>', 'Output format')
  .action(async (options) => {
    // Implementation
  });
```

### 2. Services

Service classes should:

- Be single responsibility
- Include interface definitions
- Support caching where appropriate
- Include error handling

Example:

```typescript
export interface NewService {
  getData(): Promise<Result>;
}

export class NewServiceImpl implements NewService {
  // Implementation
}
```

### 3. Integration Tests

Integration tests should:

- Mock external services
- Test error conditions
- Verify cache behavior
- Check all output formats

## Documentation

### 1. Code Documentation

- Use JSDoc for public APIs
- Include examples in docs
- Document error conditions
- Explain complex logic

### 2. User Documentation

- Update relevant .md files
- Include command examples
- Document configuration
- Add troubleshooting tips

## Pull Request Process

1. Create feature branch
2. Implement changes
3. Add tests
4. Update documentation
5. Create pull request

### PR Requirements

- [ ] Tests pass
- [ ] Documentation updated
- [ ] Code follows style guide
- [ ] Includes integration tests
- [ ] Error handling complete

## Release Process

1. Version update:
   ```bash
   deno task version
   ```

2. Update changelog:
   ```bash
   deno task changelog
   ```

3. Create release:
   ```bash
   deno task release
   ```

## Prerequisites

To contribute effectively to Nova, you'll need:

- [Deno](https://deno.land/) 2.3.6 or higher
- [GitHub CLI](https://cli.github.com/) installed and configured
- GitHub account with authentication

For testing optional features, you may also need:
- [Github Copilot CLI extension](https://github.com/apps/gh-copilot) installed

## Shell Completions

For development, it's helpful to set up shell completions:

### Zsh

```bash
deno completions zsh > ~/.zsh/_nova
# Add to ~/.zshrc:
fpath=(~/.zsh $fpath)
autoload -Uz compinit
compinit
```

### Bash

```bash
deno completions bash > ~/.bash_completion.d/nova.bash
# Add to ~/.bashrc:
source ~/.bash_completion.d/nova.bash
```

### Fish

```bash
deno completions fish > ~/.config/fish/completions/nova.fish
```

This will give you:
1. Completion for agent types (eng, pm, bm, rs)
2. Command completion based on agent type
3. File/directory completion for the review command
4. Help text and option completion

## Community

- Join our Discord server
- Check GitHub issues
- Review pull requests
- Share feedback

## Best Practices

### Code Quality

- Write clear, concise code
- Use meaningful names
- Keep functions small
- Add proper error handling

### Testing

- Test edge cases
- Mock external services
- Use descriptive test names
- Include integration tests

### Documentation

- Keep docs current
- Include examples
- Document breaking changes
- Add troubleshooting tips
