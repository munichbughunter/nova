# Common Workflows

This guide demonstrates common workflows that combine multiple nova integrations.

## Project Setup Workflow

### 1. Configure Environment
```bash
# Initial setup
nova setup
```

### 2. Access Project Resources
```bash

# View project Jira dashboard
nova jira dashboard --recent

# Check GitLab metrics
nova gitlab dashboard --recent
```

## Development Workflow

### 1. Project Documentation
```bash
# Find project documentation
nova confluence search "project-name"

# View specific space
nova confluence pages -s PROJECT
```

### 2. Project Status
```bash
# Check Jira issues
nova jira issues -p PROJECT -q "status = 'In Progress'"

# View GitLab activity
nova gitlab dashboard --days 7
```

## Infrastructure Management

### 1. Documentation Access
```bash
# Find infrastructure docs
nova confluence search "infrastructure setup"

# View recent spaces
nova confluence spaces --recent
```

## Project Monitoring

### 1. Development Metrics
```bash
# GitLab project health
nova gitlab dashboard --refresh

# Jira progress tracking
nova jira dashboard --days 30
```

### 2. Documentation Health
```bash
# Space analytics
nova confluence dashboard --recent
```

## Best Practices

### 1. Regular Updates
- Check dashboards daily
- Refresh metrics before meetings
- Keep documentation current

### 2. Efficient Navigation
- Use `--recent` for frequent access
- Filter results with meaningful queries
- Cache data when appropriate

### 3. Cross-Platform Integration
- Link Jira issues to GitLab MRs
- Reference Confluence docs in tickets
- Maintain consistent project keys

## Example Scenarios

### New Feature Development
1. Check project status:
   ```bash
   nova jira dashboard
   nova gitlab dashboard
   ```

2. Access documentation:
   ```bash
   nova confluence search "feature docs"
   ```

### Production Deployment
1. Verify project health:
   ```bash
   nova gitlab dashboard --refresh
   nova jira issues -q "type = Bug AND status = Open"
   ```

2. Update documentation:
   ```bash
   nova confluence pages -s PROD
   ```

## Integration Tips

### Jira + GitLab
- Use consistent project keys
- Reference merge requests in issues
- Track development progress

### Confluence + Jira
- Link documentation to issues
- Keep technical docs updated
- Track documentation tasks

### Documentation
- Maintain environment docs
- Document profile usage