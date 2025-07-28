# Testing Guide

This guide covers testing practices and patterns for nova development.

## Test Structure

### Unit Tests

Tests should be organized by feature and placed alongside the code being tested:

```
src/
  commands/
    jira/
      projects.ts
      projects.test.ts
  services/
    jira/
      service.ts
      service.test.ts
```

## Writing Tests

### Test File Structure

```typescript
import { assertEquals, assertRejects } from 'testing/asserts.ts';
import { stub } from 'testing/mock.ts';
import { beforeEach, describe, it } from 'testing/bdd.ts';

describe('feature', () => {
  beforeEach(() => {
    // Setup
  });

  it('should handle success case', async () => {
    // Test implementation
  });

  it('should handle error case', async () => {
    // Test implementation
  });
});
```

### Mocking Services

```typescript
// Create service mock
const mockService = {
  getData: stub((arg: string) => Promise.resolve({ data: arg })),
};

// Verify calls
assertEquals(mockService.getData.calls.length, 1);
assertEquals(mockService.getData.calls[0].args, ['expected arg']);
```

## Test Categories

### 1. Unit Tests

Test individual components:

- Commands
- Services
- Utilities
- Agents

### 2. Integration Tests

Test component interactions:

- Command → Service
- Service → API
- Agent → Services

### 3. End-to-End Tests

Test complete workflows:

- Full command execution
- Data flow through system
- Error handling paths

## Test Patterns

### 1. Command Testing

```typescript
Deno.test('command execution', async () => {
  const command = new TestCommand();
  const result = await command.execute(['--option', 'value']);
  assertEquals(result.code, 0);
});
```

### 2. Service Testing

```typescript
Deno.test('service operations', async () => {
  const service = new TestService();
  const result = await service.operation();
  assertEquals(result.status, 'success');
});
```

### 3. Agent Testing

```typescript
Deno.test('agent processing', async () => {
  const agent = new TestAgent();
  const context = createTestContext();
  await agent.process(context);
  // Verify expected outcomes
});
```

### 4. Snapshot Testing

Snapshot testing is an effective way to test UI output and command behavior. It captures the output
of a command or function and stores it as a reference for future comparisons.

#### Creating Snapshot Tests

```typescript
import { snapshotTest } from '@cliffy/testing';

// Basic snapshot test
await snapshotTest({
  name: 'Command output',
  meta: import.meta,
  colors: true, // Preserve ANSI color codes
  async fn() {
    // Code that produces console output
    console.log('Hello world!');
  },
});

// Testing multiple scenarios
await snapshotTest({
  name: 'Command with different options',
  meta: import.meta,
  colors: true,
  steps: {
    'should show help': {
      async fn() {
        console.log('Help text');
      },
    },
    'should show version': {
      async fn() {
        console.log('v1.0.0');
      },
    },
  },
});
```

#### Running Snapshot Tests

To generate or update snapshots:

```bash
deno test -A --no-check path/to/your.snapshot.test.ts -- --update
```

To run tests against existing snapshots:

```bash
deno test -A path/to/your.snapshot.test.ts
```

Snapshots are stored in `__snapshots__` directories adjacent to the test files and should be
committed to version control.

When to use snapshot testing:

- Command UI output testing
- Complex formatted output
- Text-based reports or tables
- JSON structure validation

#### Example: Testing a Command with Table Output

```typescript
await snapshotTest({
  name: 'Table Output',
  meta: import.meta,
  colors: true,
  async fn() {
    const table = new Table()
      .header(['Name', 'Value'])
      .body([
        ['Item 1', '100'],
        ['Item 2', '200'],
      ])
      .border(true);

    console.log(table.toString());
  },
});
```

## Test Utilities

### 1. Test Context

```typescript
function createTestContext(): TestContext {
  return {
    command: 'test',
    args: [],
    options: {},
    config: createTestConfig(),
    services: createMockServices(),
  };
}
```

### 2. Mock Services

```typescript
function createMockServices(): ServiceContainer {
  return {
    jira: createMockJiraService(),
    gitlab: createMockGitLabService(),
    confluence: createMockConfluenceService(),
  };
}
```

### 3. Test Data

```typescript
const testData = {
  projects: [
    { id: '1', name: 'Test Project' },
    { id: '2', name: 'Another Project' },
  ],
  issues: [
    { key: 'TEST-1', summary: 'Test Issue' },
    { key: 'TEST-2', summary: 'Another Issue' },
  ],
};
```

## Running Tests

### Basic Test Run

```bash
deno test
```

### With Options

```bash
# Run with coverage
deno test --coverage

# Run specific tests
deno test --filter "test name"

# Run with permissions
deno test --allow-net --allow-read
```

### Watch Mode

```bash
deno test --watch
```

## Coverage

### Generating Coverage

```bash
# Generate coverage
deno test --coverage=coverage

# View coverage report
deno coverage coverage
```

### Coverage Requirements

Minimum coverage requirements:

- Commands: 90%
- Services: 85%
- Utilities: 95%
- Agents: 85%

## Best Practices

### 1. Test Organization

- Group related tests
- Use descriptive names
- Follow consistent patterns
- Include setup/teardown

### 2. Mock Usage

- Mock external dependencies
- Verify mock calls
- Reset mocks between tests
- Use realistic test data

### 3. Assertions

- Use specific assertions
- Check error conditions
- Verify state changes
- Test edge cases

## Common Patterns

### 1. Error Testing

```typescript
Deno.test('should handle errors', async () => {
  const service = new TestService();
  await assertRejects(
    () => service.operation(),
    Error,
    'Expected error message',
  );
});
```

### 2. Async Testing

```typescript
Deno.test('should handle async operations', async () => {
  const result = await asyncOperation();
  assertEquals(result.status, 'success');
});
```

### 3. State Testing

```typescript
Deno.test('should maintain state', async () => {
  const component = new TestComponent();
  await component.setState('new');
  assertEquals(await component.getState(), 'new');
});
```

## Troubleshooting

### Common Issues

1. **Flaky Tests**
   - Check async operations
   - Verify mock resets
   - Ensure proper cleanup

2. **Slow Tests**
   - Use appropriate mocks
   - Minimize external calls
   - Optimize setup/teardown

3. **Coverage Issues**
   - Check uncovered paths
   - Add edge case tests
   - Verify error handling
