# Using Agents (Work in Progress)

Nova provides intelligent agents that help automate and enhance various workflows. These agents are
currently under active development.

## Available Agents

### Engineering Agent (dev) - Active Development

```bash
nova agent dev [command]
```

Current focus:

- Code review functionality
- CI/CD integration
- Best practices enforcement

Development priorities:

1. Code review capabilities
2. Integration with CI pipelines
3. Performance analysis
4. Security checking

### Project Manager (pm) - Planned

```bash
nova agent pm [command]
```

Planned features:

- Project status tracking
- Metric analysis
- Report generation
- KPI monitoring

## Current Development Focus

### Code Review Agent

The code review agent is being actively developed with focus on:

1. **Automated Analysis**
   - Code quality checks
   - Best practice validation
   - Performance impact assessment
   - Security vulnerability detection

2. **CI/CD Integration**
   - Pipeline integration
   - Automated reviews
   - Status reporting
   - Change validation

3. **Review Standards**
   - Style guide compliance
   - Architecture patterns
   - Code organization
   - Documentation requirements

## Planned Features

### Dev Tasks

```bash
# Future capabilities
nova agent dev review        # Code review with AI assistance
nova agent dev ci review     # CI/CD integration
nova agent dev analyze       # Code analysis
```

### Project Management

```bash
# Planned features
nova agent pm status        # Project health check
nova agent pm report        # Generate insights
nova agent pm analyze       # Trend analysis
```

## Development Status

Current implementation priorities:

1. Code review agent core functionality
2. CI/CD integration points
3. Review standards implementation
4. Performance optimization

Future phases:

1. Project management features
2. Documentation automation
3. Service management
4. Extended AI capabilities

## Contributing

See the [Agent Development Guide](../developer/create-agent.md) for:

- Agent architecture
- Extension points
- Testing guidelines
- Documentation standards
