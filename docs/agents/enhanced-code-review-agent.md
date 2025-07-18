# Enhanced Code Review Agent

The Enhanced Code Review Agent is a comprehensive code analysis tool that provides automated code reviews with GitLab and GitHub integration. It offers three distinct review modes and delivers structured feedback with actionable insights.

## Table of Contents

- [Overview](#overview)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Review Modes](#review-modes)
- [Features](#features)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)

## Overview

The Enhanced Code Review Agent extends Nova's agent infrastructure to provide:

- **Automated Code Analysis**: Comprehensive review of code quality, security, and performance
- **Multi-Platform Support**: Works with both GitLab and GitHub repositories
- **Three Review Modes**: File-specific, change detection, and pull request reviews
- **Structured Output**: CLI tables with grades, coverage, and actionable feedback
- **Intelligent Caching**: Performance optimizations for large codebases
- **Advanced Error Handling**: Robust error recovery with intelligent data transformation
- **Modular Architecture**: Domain-specific service organization for better maintainability
- **Type-Safe Validation**: Runtime type validation with automatic error recovery
- **Response Processing Pipeline**: Multi-stage processing with transformation and validation

## Installation & Setup

### Prerequisites

1. **Nova CLI**: Ensure Nova CLI is installed and configured
2. **Git Repository**: Must be in a Git repository for change detection and PR reviews
3. **Platform Access**: GitLab or GitHub access tokens for PR review mode

### Installation

```bash
# Install Nova CLI (if not already installed)
deno task install

# Verify installation
nova --version

# Test the enhanced code review agent
nova agent enhanced-code-review-agent help
```

## Configuration

### Basic Configuration

Create or update your Nova configuration file:

```json
{
  "gitlab": {
    "url": "https://gitlab.com",
    "token": "glpat-your-gitlab-token",
    "project_id": "12345"
  },
  "github": {
    "token": "ghp_your-github-token",
    "apiUrl": "https://api.github.com"
  },
  "review": {
    "autoPostComments": true,
    "severityThreshold": "medium",
    "maxFilesPerReview": 50
  },
  "ai": {
    "default_provider": "openai",
    "openai": {
      "api_key": "sk-your-openai-key",
      "default_model": "gpt-4"
    }
  }
}
```

### Configuration Options

#### GitHub Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | string | - | GitHub Personal Access Token |
| `apiUrl` | string | `https://api.github.com` | GitHub API URL (for Enterprise) |

#### Review Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoPostComments` | boolean | `true` | Auto-post review comments to PRs |
| `severityThreshold` | string | `"medium"` | Minimum severity for reporting (`low`, `medium`, `high`) |
| `maxFilesPerReview` | number | `50` | Maximum files per review operation |

### Setting Up GitHub Integration

1. **Generate Personal Access Token**:
   ```bash
   # Go to: https://github.com/settings/tokens
   # Create token with these scopes:
   # - repo (full repository access)
   # - pull_requests (PR access)
   ```

2. **Add Token to Configuration**:
   ```bash
   nova config set github.token "ghp_your_token_here"
   ```

3. **Test Connection**:
   ```bash
   nova agent enhanced-code-review-agent review pr
   ```

## Usage

### Basic Commands

```bash
# Get help
nova agent enhanced-code-review-agent help

# Review specific files
nova agent enhanced-code-review-agent review src/main.ts

# Review multiple files
nova agent enhanced-code-review-agent review src/main.ts src/utils.ts

# Review changed files
nova agent enhanced-code-review-agent review

# Review pull requests
nova agent enhanced-code-review-agent review pr
```

### Command Syntax

```
nova agent enhanced-code-review-agent [review] <mode> [options]
```

- `review` - Optional keyword (implied for file paths)
- `mode` - Review mode: file paths, `changes`, or `pr`
- `options` - Additional options like PR ID

## Review Modes

### 1. File Review Mode

Review specific files with detailed analysis.

**Syntax:**
```bash
nova agent enhanced-code-review-agent review <file1> [file2] [...]
nova agent enhanced-code-review-agent <file1> [file2] [...]  # review implied
```

**Examples:**
```bash
# Single file
nova agent enhanced-code-review-agent review src/main.ts

# Multiple files
nova agent enhanced-code-review-agent review src/main.ts src/utils.ts src/config.ts

# Using glob patterns (shell expansion)
nova agent enhanced-code-review-agent review src/**/*.ts

# Review implied for file paths
nova agent enhanced-code-review-agent src/main.ts
```

**Output:**
- Detailed analysis of each file
- Code quality grade (A-F)
- Test coverage assessment
- Security and performance issues
- Improvement suggestions

### 2. Change Detection Mode

Automatically detect and review changed files in your Git repository.

**Syntax:**
```bash
nova agent enhanced-code-review-agent review
nova agent enhanced-code-review-agent review changes
```

**Examples:**
```bash
# Review all changed files
nova agent enhanced-code-review-agent review

# Explicit changes mode
nova agent enhanced-code-review-agent review changes
```

**Behavior:**
- Detects modified, added, and deleted files
- Reviews only changed portions of modified files
- Reviews entire content of new files
- Excludes non-code files (images, binaries, etc.)
- Shows summary of all changes

### 3. Pull Request Review Mode

Review pull requests from GitLab or GitHub with automated comment posting.

**Syntax:**
```bash
nova agent enhanced-code-review-agent review pr [pr-id]
```

**Examples:**
```bash
# Review PRs (shows selection menu)
nova agent enhanced-code-review-agent review pr

# Review specific PR by ID
nova agent enhanced-code-review-agent review pr 123

# Review specific MR (GitLab)
nova agent enhanced-code-review-agent review pr 456
```

**Workflow:**
1. Auto-detects repository type (GitLab/GitHub)
2. Fetches available pull/merge requests
3. Presents selection interface (if multiple PRs)
4. Analyzes PR diff and changes
5. Posts review comments to the platform
6. Displays local results summary

## Features

### Code Analysis

#### Quality Grading
- **A Grade**: Excellent code quality, comprehensive tests, no issues
- **B Grade**: Good code quality, minor improvements needed
- **C Grade**: Average code quality, several issues to address
- **D Grade**: Below average, significant improvements required
- **F Grade**: Poor code quality, major refactoring needed

#### Analysis Categories
- **Security**: Vulnerability detection, input validation, authentication issues
- **Performance**: Optimization opportunities, algorithmic complexity, resource usage
- **Best Practices**: Code style, naming conventions, design patterns
- **Testing**: Test coverage, test quality, missing test cases
- **Maintainability**: Code complexity, documentation, readability

### Repository Integration

#### Automatic Detection
```typescript
// The agent automatically detects repository type
const repoType = await repositoryDetector.detectRepositoryType();
// Returns: 'gitlab' | 'github' | 'unknown'
```

#### Comment Posting
- Posts line-specific comments on PRs
- Includes severity levels and suggestions
- Handles API rate limiting
- Graceful fallback to local display

### Advanced Error Handling & Recovery

#### Intelligent Data Transformation
The agent automatically handles common LLM response format variations:

```typescript
// Handles various coverage formats automatically
"75%" → 75        // Percentage strings
"75" → 75         // String numbers
"true" → true     // String booleans
"invalid" → 0     // Invalid values with fallback
```

#### Error Recovery Pipeline
1. **Response Cleaning**: Removes invalid JSON characters and formatting issues
2. **Type Transformation**: Converts string values to expected types
3. **Schema Validation**: Validates against strict type schemas
4. **Fallback Analysis**: Uses rule-based analysis when LLM processing fails
5. **Detailed Logging**: Provides comprehensive error information for debugging

#### Graceful Degradation
- **LLM Provider Failures**: Automatically falls back to rule-based analysis
- **API Rate Limiting**: Implements exponential backoff with configurable retry limits
- **Network Issues**: Handles timeouts and connection errors gracefully
- **Validation Errors**: Attempts data transformation before failing

### Modular Service Architecture

#### Domain-Specific Organization
```
src/services/
├── analysis/           # Code analysis and validation services
│   ├── code-analysis.service.ts
│   ├── validation.service.ts
│   └── transformation.service.ts
├── llm/               # LLM provider integrations
│   ├── response-processor.ts
│   ├── providers/
│   └── factory.ts
├── repository/        # Git and platform integrations
│   ├── git.service.ts
│   ├── github.service.ts
│   └── gitlab.service.ts
├── error-handling/    # Error recovery and retry logic
│   ├── error-handler.service.ts
│   ├── retry.service.ts
│   └── recovery.service.ts
└── monitoring/        # Metrics and observability
    ├── metrics.service.ts
    └── monitoring.service.ts
```

#### Service Responsibilities
- **Analysis Services**: Code analysis, validation, and transformation
- **LLM Services**: Provider management and response processing
- **Repository Services**: Git operations and platform integrations
- **Error Handling Services**: Error recovery, retry logic, and fallback mechanisms
- **Monitoring Services**: Metrics collection and performance tracking

### Performance Optimizations

#### Parallel Processing
```typescript
// Analyzes multiple files concurrently
const results = await codeAnalysisService.analyzeMultipleFiles(files);
```

#### Intelligent Caching
- Caches analysis results based on file content hash
- Skips unchanged files in subsequent runs
- Configurable cache TTL and size limits
- Caches successful transformations to avoid reprocessing

#### Streaming Support
- Processes large diffs in chunks
- Memory-efficient for large repositories
- Progress reporting for long operations

#### Response Processing Optimization
- **Pre-validation Transforms**: Common transformations applied before validation
- **Cached Transformations**: Successful transformations cached for reuse
- **Parallel Validation**: Multiple validation strategies attempted concurrently

## API Reference

### Core Interfaces

#### ReviewResult
```typescript
interface ReviewResult {
  file: string;                    // File path
  grade: 'A' | 'B' | 'C' | 'D' | 'F';  // Quality grade
  coverage: number;                // Test coverage percentage (0-100)
  testsPresent: boolean;          // Whether tests exist
  value: 'high' | 'medium' | 'low'; // Business value assessment
  state: 'pass' | 'warning' | 'fail'; // Overall state
  issues: CodeIssue[];            // Detected issues
  suggestions: string[];          // Improvement suggestions
}
```

#### CodeIssue
```typescript
interface CodeIssue {
  line: number;                   // Line number
  severity: 'low' | 'medium' | 'high'; // Issue severity
  type: 'security' | 'performance' | 'style' | 'bug'; // Issue category
  message: string;                // Issue description
}
```

#### ReviewCommand
```typescript
interface ReviewCommand {
  mode: 'file' | 'changes' | 'pr'; // Review mode
  files?: string[];               // File paths (file mode)
  prId?: string;                  // PR/MR ID (pr mode)
}
```

### Service Classes

#### EnhancedCodeReviewAgent
```typescript
class EnhancedCodeReviewAgent extends ExampleAgent {
  async execute(input: string, options?: AgentExecuteOptions): Promise<AgentResponse>;
  private async handleFileReview(files: string[], options: AgentExecuteOptions): Promise<AgentResponse>;
  private async handleChangesReview(options: AgentExecuteOptions): Promise<AgentResponse>;
  private async handlePRReview(prId: string | undefined, options: AgentExecuteOptions): Promise<AgentResponse>;
}
```

#### CodeAnalysisService
```typescript
class CodeAnalysisService {
  async analyzeMultipleFiles(files: FileContent[], progressCallback?: ProgressCallback): Promise<AnalysisResult[]>;
  async analyzeFile(filePath: string, content: string): Promise<ReviewResult>;
  getCacheStats(): CacheStats;
}
```

#### RepositoryDetector
```typescript
class RepositoryDetector {
  async detectRepositoryType(): Promise<'gitlab' | 'github' | 'unknown'>;
}
```

## Troubleshooting

### Common Issues

#### Authentication Problems

**GitHub Authentication Failed**
```bash
Error: Request failed with status code 401
```
**Solution:**
```bash
# Check token validity
curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user

# Update token in config
nova config set github.token "ghp_new_token"
```

**GitLab Authentication Failed**
```bash
Error: 401 Unauthorized
```
**Solution:**
```bash
# Verify GitLab token
curl --header "PRIVATE-TOKEN: YOUR_TOKEN" "https://gitlab.com/api/v4/user"

# Update configuration
nova config set gitlab.token "glpat_new_token"
```

#### Repository Detection Issues

**Repository Not Detected**
```bash
Error: Unable to detect repository type
```
**Solutions:**
```bash
# Check Git remotes
git remote -v

# Add remote if missing
git remote add origin https://github.com/user/repo.git

# Verify remote URL format
git remote set-url origin https://github.com/user/repo.git
```

#### File Access Problems

**File Not Found**
```bash
Error: ENOENT: no such file or directory
```
**Solutions:**
```bash
# Check file exists
ls -la src/main.ts

# Check current directory
pwd

# Use absolute paths if needed
nova agent enhanced-code-review-agent review /full/path/to/file.ts
```

#### API Rate Limiting

**Rate Limit Exceeded**
```bash
Error: API rate limit exceeded
```
**Solutions:**
- Wait for rate limit reset (usually 1 hour)
- Use authenticated requests (higher limits)
- The agent automatically retries with exponential backoff

#### Performance Issues

**Slow Analysis**
```bash
# Enable debug mode to see what's happening
NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/
```

**Solutions:**
- Reduce `maxFilesPerReview` in configuration
- Use file-specific reviews instead of reviewing entire directories
- Check network connectivity for API calls

### Debug Mode

Enable detailed logging:

```bash
# Full debug output
NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/main.ts

# Specific log levels
NOVA_LOG_LEVEL=debug nova agent enhanced-code-review-agent review src/main.ts
```

### Configuration Validation

```bash
# Validate configuration
nova config validate

# Show current configuration
nova config show

# Test specific services
nova agent enhanced-code-review-agent review pr --dry-run
```

## Examples

### Example 1: Basic File Review

```bash
# Review a TypeScript file
nova agent enhanced-code-review-agent review src/services/user-service.ts
```

**Output:**
```
┌─────────────────────────┬───────┬──────────┬──────────────┬────────┬─────────┐
│ File                    │ Grade │ Coverage │ Tests Present│ Value  │ State   │
├─────────────────────────┼───────┼──────────┼──────────────┼────────┼─────────┤
│ src/services/user-ser...│ B     │ 75%      │ ✅           │ high   │ pass    │
└─────────────────────────┴───────┴──────────┴──────────────┴────────┴─────────┘

## File Details

### src/services/user-service.ts

**Grade:** B (Good code quality with minor improvements needed)
**Coverage:** 75% (Good test coverage)
**Tests Present:** ✅ Yes
**Value:** High (Core business functionality)
**State:** Pass (Meets quality standards)

**Issues Found:**
- Line 45: Medium severity - Consider using async/await instead of Promise chains
- Line 78: Low severity - Variable name could be more descriptive

**Suggestions:**
- Add input validation for user email format
- Consider extracting database queries to a separate repository layer
- Add JSDoc comments for public methods
```

### Example 2: Change Detection Review

```bash
# After making changes to your code
git add .
git commit -m "Implement user authentication"

# Review the changes
nova agent enhanced-code-review-agent review
```

**Output:**
```
┌─────────────────────────┬───────┬──────────┬──────────────┬────────┬─────────┐
│ File                    │ Grade │ Coverage │ Tests Present│ Value  │ State   │
├─────────────────────────┼───────┼──────────┼──────────────┼────────┼─────────┤
│ src/auth/auth-service.ts│ A     │ 90%      │ ✅           │ high   │ pass    │
│ src/auth/middleware.ts  │ B     │ 65%      │ ✅           │ medium │ warning │
│ src/types/user.ts       │ A     │ 100%     │ ✅           │ medium │ pass    │
└─────────────────────────┴───────┴──────────┴──────────────┴────────┴─────────┘

## Summary

- **Total Changed Files**: 5
- **Reviewable Files**: 3
- **Pass**: 2, **Warning**: 1, **Fail**: 0
- **Average Coverage**: 85.0%
- **Files with Tests**: 3/3
- **Total Issues**: 2 (0 high, 1 medium, 1 low)

## All Changed Files

**Reviewed:**
- ✅ src/auth/auth-service.ts
- ✅ src/auth/middleware.ts
- ✅ src/types/user.ts

**Not Reviewed:**
- ⏭️ package.json (non-code file)
- ⏭️ README.md (non-code file)
```

### Example 3: Pull Request Review

```bash
# Review pull requests
nova agent enhanced-code-review-agent review pr
```

**Interactive Output:**
```
Detected GITHUB repository. Fetching pull requests...

Available Pull Requests:
1. #123 - Add user authentication (john-doe) - Open
2. #124 - Fix database connection issue (jane-smith) - Open
3. #125 - Update documentation (bob-wilson) - Open

Select a pull request to review (1-3): 1

Analyzing PR #123: Add user authentication...
Posting review comments to GitHub...

┌─────────────────────────┬───────┬──────────┬──────────────┬────────┬─────────┐
│ File                    │ Grade │ Coverage │ Tests Present│ Value  │ State   │
├─────────────────────────┼───────┼──────────┼──────────────┼────────┼─────────┤
│ src/auth/auth-service.ts│ A     │ 90%      │ ✅           │ high   │ pass    │
│ src/auth/middleware.ts  │ B     │ 65%      │ ✅           │ medium │ warning │
└─────────────────────────┴───────┴──────────┴──────────────┴────────┴─────────┘

✅ Review comments posted successfully to PR #123
🔗 View PR: https://github.com/user/repo/pull/123
```

### Example 4: Configuration-Driven Review

```bash
# Create a custom configuration
cat > .nova-review-config.json << EOF
{
  "review": {
    "autoPostComments": false,
    "severityThreshold": "high",
    "maxFilesPerReview": 10
  }
}
EOF

# Use custom configuration
NOVA_CONFIG=.nova-review-config.json nova agent enhanced-code-review-agent review src/
```

### Example 5: Batch File Review

```bash
# Review all TypeScript files in src directory
find src -name "*.ts" -type f | head -20 | xargs nova agent enhanced-code-review-agent review

# Review files matching a pattern
nova agent enhanced-code-review-agent review $(find src -name "*service*.ts")

# Review recently modified files
nova agent enhanced-code-review-agent review $(git diff --name-only HEAD~1)
```

### Example 6: Integration with CI/CD

```yaml
# .github/workflows/code-review.yml
name: Automated Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  code-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x
      
      - name: Install Nova CLI
        run: |
          git clone https://github.com/user/nova.git
          cd nova
          deno task install
      
      - name: Run Code Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          echo '{"github":{"token":"$GITHUB_TOKEN"}}' > config.json
          NOVA_CONFIG=config.json nova agent enhanced-code-review-agent review pr ${{ github.event.number }}
```

This comprehensive documentation covers all aspects of the Enhanced Code Review Agent, from basic usage to advanced integration scenarios. The agent provides a powerful foundation for automated code quality assessment and review workflows.