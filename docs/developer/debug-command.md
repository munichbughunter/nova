# Debugging Commands

This guide covers techniques for debugging nova commands during development.

## Development Mode

### Using Watch Mode

Run nova in development mode with file watching:

```bash
deno task dev --watch

# Or with specific command
deno task dev agent eng --watch
```

### Debug Logging

Enable debug output:

```bash
# Set debug level
export NOVA_DEBUG=1  # Basic debug info
export NOVA_DEBUG=2  # Verbose debug info

# Run command with debug
NOVA_DEBUG=1 nova command
```

## Debugging Tools

### 1. Deno Debugger

Start debugger:

```bash
deno run --inspect-brk main.ts
```

Connect with Chrome DevTools:

1. Open chrome://inspect
2. Click "Configure" and add localhost:9229
3. Click "Open dedicated DevTools for Node"

### 2. Console Debugging

Add debug points:

```typescript
function debugLog(level: number, ...args: unknown[]) {
  const debug = Deno.env.get('NOVA_DEBUG');
  if (debug && parseInt(debug) >= level) {
    console.debug(...args);
  }
}

// Usage in code
debugLog(1, 'Processing command:', options);
debugLog(2, 'Raw API response:', response);
```

### 3. Test Debugging

Run tests with debugging:

```bash
deno test --inspect-brk

# Or specific test
deno test --inspect-brk --filter "test name"
```

## Common Issues

### 1. Authentication Problems

Check credentials:

```typescript
debugLog(1, 'Token:', maskToken(token));
debugLog(1, 'API URL:', apiUrl);

// Verify API response
debugLog(2, 'Auth response:', response);
```

### 2. Cache Issues

Debug cache operations:

```typescript
debugLog(1, 'Cache key:', key);
debugLog(2, 'Cache contents:', await cache.get(key));

// Clear cache for testing
await cache.clear();
```

### 3. API Integration

Monitor API calls:

```typescript
debugLog(1, 'API request:', {
  method,
  url,
  headers: maskSensitive(headers),
});

debugLog(2, 'API response:', response);
```

## Testing Strategies

### 1. Mock Services

Create test doubles:

```typescript
class MockService implements Service {
  async getData(): Promise<Result> {
    debugLog(1, 'Mock service called');
    return testData;
  }
}
```

### 2. Test Environments

Set up test configuration:

```bash
export NOVA_ENV=test
export NOVA_TEST_MODE=1
```

### 3. Snapshot Testing

Create API snapshots:

```typescript
Deno.test('command output', async (t) => {
  const output = await command.execute();
  await assertSnapshot(t, output);
});
```

## Performance Debugging

### 1. Timing Analysis

Add performance markers:

```typescript
const start = performance.now();
// Operation
const duration = performance.now() - start;
debugLog(1, 'Operation took:', duration, 'ms');
```

### 2. Memory Usage

Monitor memory:

```typescript
function logMemory(label: string) {
  const used = process.memoryUsage();
  debugLog(2, `Memory (${label}):`, {
    heapUsed: used.heapUsed / 1024 / 1024,
    heapTotal: used.heapTotal / 1024 / 1024,
  });
}
```

## Error Handling

### 1. Detailed Errors

```typescript
class CommandError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    debugLog(1, 'Command error:', {
      code,
      message,
      details,
    });
  }
}
```

### 2. Error Recovery

```typescript
try {
  await operation();
} catch (error) {
  debugLog(1, 'Operation failed:', error);
  if (canRetry(error)) {
    debugLog(1, 'Retrying operation');
    await retry(operation);
  }
}
```

## Best Practices

1. **Logging Levels**
   - Level 1: Basic operation flow
   - Level 2: Detailed data and responses
   - Use appropriate masking for sensitive data

2. **Test Coverage**
   - Test error conditions
   - Verify retry logic
   - Check edge cases

3. **Performance**
   - Monitor API call durations
   - Track cache effectiveness
   - Log resource usage
