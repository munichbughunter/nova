# Enhanced Code Review Agent - Troubleshooting Guide

This guide helps you resolve common issues when using the Enhanced Code Review Agent.

## Table of Contents

- [Authentication Issues](#authentication-issues)
- [Repository Detection Problems](#repository-detection-problems)
- [File Access Issues](#file-access-issues)
- [Validation and Transformation Issues](#validation-and-transformation-issues)
- [API Rate Limiting](#api-rate-limiting)
- [Performance Problems](#performance-problems)
- [Configuration Issues](#configuration-issues)
- [Network and Connectivity](#network-and-connectivity)
- [Debug and Logging](#debug-and-logging)

## Authentication Issues

### GitHub Authentication Failed

**Error Messages:**
```
Error: Request failed with status code 401
Error: GitHub authentication failed
Error: Bad credentials
```

**Causes:**
- Invalid or expired GitHub token
- Insufficient token permissions
- Token not configured in Nova

**Solutions:**

1. **Verify Token Validity:**
   ```bash
   # Test token manually
   curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user
   ```

2. **Check Token Permissions:**
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Ensure token has these scopes:
     - `repo` (full repository access)
     - `pull_requests` (PR access)
     - `read:org` (if using organization repos)

3. **Update Token in Configuration:**
   ```bash
   # Set token in Nova config
   nova config set github.token "ghp_your_new_token"
   
   # Verify configuration
   nova config show github
   ```

4. **Generate New Token:**
   ```bash
   # Go to: https://github.com/settings/tokens
   # Click "Generate new token (classic)"
   # Select required scopes and generate
   ```

### GitLab Authentication Failed

**Error Messages:**
```
Error: 401 Unauthorized
Error: GitLab authentication failed
Error: Invalid token
```

**Solutions:**

1. **Verify GitLab Token:**
   ```bash
   # Test token
   curl --header "PRIVATE-TOKEN: YOUR_TOKEN" "https://gitlab.com/api/v4/user"
   ```

2. **Update GitLab Configuration:**
   ```bash
   nova config set gitlab.token "glpat_your_new_token"
   nova config set gitlab.url "https://your-gitlab-instance.com"
   ```

3. **Check Token Permissions:**
   - Token needs `api` scope for full access
   - Or `read_api` + `read_repository` for read-only access

## Repository Detection Problems

### Repository Not Detected

**Error Messages:**
```
Error: Unable to detect repository type
Error: The current directory is not a Git repository
Error: Repository type is unknown
```

**Solutions:**

1. **Check Git Repository Status:**
   ```bash
   # Verify you're in a Git repository
   git status
   
   # Check remotes
   git remote -v
   ```

2. **Add Git Remote:**
   ```bash
   # For GitHub
   git remote add origin https://github.com/username/repository.git
   
   # For GitLab
   git remote add origin https://gitlab.com/username/repository.git
   ```

3. **Fix Remote URL Format:**
   ```bash
   # Update existing remote
   git remote set-url origin https://github.com/username/repository.git
   
   # Verify the change
   git remote -v
   ```

4. **Initialize Git Repository:**
   ```bash
   # If not a Git repository
   git init
   git remote add origin https://github.com/username/repository.git
   ```

### Ambiguous Repository Type

**Error Messages:**
```
Error: Could not determine if repository is GitLab or GitHub
Error: Remote URL format not recognized
```

**Solutions:**

1. **Check Remote URL Format:**
   ```bash
   git remote -v
   # Should show URLs like:
   # origin  https://github.com/user/repo.git (fetch)
   # origin  https://gitlab.com/user/repo.git (fetch)
   ```

2. **Fix Remote URL:**
   ```bash
   # For GitHub
   git remote set-url origin https://github.com/username/repository.git
   
   # For GitLab
   git remote set-url origin https://gitlab.com/username/repository.git
   ```

## File Access Issues

### File Not Found

**Error Messages:**
```
Error: ENOENT: no such file or directory
Error: File not found: src/main.ts
Error: Could not read file
```

**Solutions:**

1. **Verify File Exists:**
   ```bash
   # Check file existence
   ls -la src/main.ts
   
   # Check current directory
   pwd
   ```

2. **Use Correct File Paths:**
   ```bash
   # Relative paths from current directory
   nova agent enhanced-code-review-agent review src/main.ts
   
   # Absolute paths
   nova agent enhanced-code-review-agent review /full/path/to/file.ts
   ```

3. **Check File Permissions:**
   ```bash
   # Check permissions
   ls -la src/main.ts
   
   # Fix permissions if needed
   chmod 644 src/main.ts
   ```

### Permission Denied

**Error Messages:**
```
Error: EACCES: permission denied
Error: Access denied to file
```

**Solutions:**

1. **Fix File Permissions:**
   ```bash
   # Make file readable
   chmod 644 filename.ts
   
   # Make directory accessible
   chmod 755 src/
   ```

2. **Check Directory Permissions:**
   ```bash
   # Check directory permissions
   ls -ld src/
   
   # Fix directory permissions
   chmod -R 755 src/
   ```

## Validation and Transformation Issues

### LLM Response Validation Errors

**Error Messages:**
```
Error: Zod validation failed
Error: Expected number, received string
Error: Invalid coverage value
Error: Response transformation failed
```

**Causes:**
- LLM returns string values for numeric fields (e.g., "75%" instead of 75)
- Boolean fields returned as strings ("true" instead of true)
- Malformed JSON responses from LLM providers
- Missing required fields in LLM responses

**Solutions:**

1. **Enable Automatic Transformation:**
   ```bash
   # The agent automatically handles common transformations
   # No configuration needed - transformations are applied by default
   ```

2. **Check Transformation Logs:**
   ```bash
   # Enable debug mode to see transformation details
   NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/main.ts
   
   # Look for transformation messages in logs:
   # "Applied transformation: coverage string->number"
   # "Applied transformation: testsPresent string->boolean"
   ```

3. **Common Transformation Patterns:**
   ```typescript
   // Coverage field transformations
   "75%" → 75        // Percentage strings
   "75" → 75         // String numbers
   "invalid" → 0     // Invalid values with fallback
   
   // Boolean field transformations
   "true" → true     // String booleans
   "false" → false   // String booleans
   "1" → true        // Numeric booleans
   "0" → false       // Numeric booleans
   ```

4. **Fallback to Rule-Based Analysis:**
   ```bash
   # If transformation fails, the agent automatically falls back
   # Look for this message in logs:
   # "Falling back to rule-based analysis due to validation errors"
   ```

### JSON Parsing Errors

**Error Messages:**
```
Error: Unexpected token in JSON
Error: JSON parse error
Error: Invalid JSON response from LLM
```

**Solutions:**

1. **Automatic JSON Cleaning:**
   ```bash
   # The agent automatically cleans common JSON issues:
   # - Removes markdown code blocks
   # - Fixes trailing commas
   # - Handles escaped characters
   # - Removes comments
   ```

2. **Enable Response Debugging:**
   ```bash
   # See raw LLM responses before processing
   NOVA_LOG_LEVEL=debug nova agent enhanced-code-review-agent review src/main.ts
   ```

3. **Check LLM Provider Configuration:**
   ```bash
   # Verify LLM provider is properly configured
   nova config show ai
   
   # Test with different provider if issues persist
   nova config set ai.default_provider "ollama"  # or "openai"
   ```

### Type Conversion Failures

**Error Messages:**
```
Error: Cannot convert string to number
Error: Invalid boolean value
Error: Type conversion failed
```

**Solutions:**

1. **Review Transformation Rules:**
   ```bash
   # The agent uses these transformation rules:
   # Numbers: parseFloat() with fallback to 0
   # Booleans: checks for "true", "1", "yes" (case-insensitive)
   # Percentages: removes "%" and converts to number
   ```

2. **Check Field-Specific Issues:**
   ```bash
   # Coverage field issues
   # Valid: "75", "75%", 75, "0"
   # Invalid: "N/A", "unknown", null → defaults to 0
   
   # Grade field issues
   # Valid: "A", "B", "C", "D", "F"
   # Invalid: "A+", "Pass" → validation error
   ```

3. **Enable Detailed Error Logging:**
   ```bash
   # See specific transformation failures
   NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/main.ts 2>&1 | grep -i "transformation"
   ```

### Schema Validation Failures

**Error Messages:**
```
Error: Schema validation failed
Error: Required field missing
Error: Invalid enum value
```

**Solutions:**

1. **Check Required Fields:**
   ```typescript
   // Required fields in review response:
   {
     "grade": "A" | "B" | "C" | "D" | "F",
     "coverage": number (0-100),
     "testsPresent": boolean,
     "value": "high" | "medium" | "low",
     "state": "pass" | "warning" | "fail",
     "issues": array,
     "suggestions": array,
     "summary": string
   }
   ```

2. **Validate Enum Values:**
   ```bash
   # Check for invalid enum values in logs
   # Grade must be: A, B, C, D, or F
   # Value must be: high, medium, or low
   # State must be: pass, warning, or fail
   ```

3. **Use Flexible Schema Mode:**
   ```bash
   # The agent automatically uses flexible schemas that:
   # - Accept string or number for coverage
   # - Accept string or boolean for testsPresent
   # - Provide default values for missing fields
   ```

### Recovery Strategies

**When Validation Fails:**

1. **Automatic Recovery Pipeline:**
   ```
   1. Raw LLM Response
   2. JSON Cleaning & Parsing
   3. Pre-validation Transformation
   4. Schema Validation
   5. Error Recovery (if validation fails)
   6. Fallback to Rule-based Analysis (if recovery fails)
   ```

2. **Monitor Recovery Success:**
   ```bash
   # Check recovery statistics in logs
   NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/ | grep -i "recovery"
   
   # Look for messages like:
   # "Recovery successful: applied type coercion"
   # "Recovery failed: falling back to rule-based analysis"
   ```

3. **Configuration for Recovery:**
   ```bash
   # No configuration needed - recovery is automatic
   # But you can adjust severity threshold to reduce noise
   nova config set review.severityThreshold "high"
   ```

## API Rate Limiting

### GitHub Rate Limit Exceeded

**Error Messages:**
```
Error: API rate limit exceeded
Error: You have exceeded a secondary rate limit
Error: 403 Forbidden - Rate limit exceeded
```

**Solutions:**

1. **Wait for Rate Limit Reset:**
   ```bash
   # Check rate limit status
   curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/rate_limit
   ```

2. **Use Authenticated Requests:**
   - Authenticated requests have higher rate limits (5,000/hour vs 60/hour)
   - Ensure your GitHub token is properly configured

3. **Reduce Request Frequency:**
   ```bash
   # Review fewer files at once
   nova config set review.maxFilesPerReview 10
   
   # Use file-specific reviews instead of bulk operations
   nova agent enhanced-code-review-agent review src/main.ts
   ```

### GitLab Rate Limit Exceeded

**Solutions:**

1. **Check GitLab Rate Limits:**
   - GitLab.com: 2,000 requests per minute per user
   - Self-hosted: Configurable by administrator

2. **Implement Delays:**
   ```bash
   # The agent automatically implements exponential backoff
   # Wait and retry the operation
   ```

## Performance Problems

### Slow Analysis

**Symptoms:**
- Long wait times during analysis
- Timeouts during file processing
- High memory usage

**Solutions:**

1. **Reduce File Count:**
   ```bash
   # Limit files per review
   nova config set review.maxFilesPerReview 20
   
   # Review specific files instead of directories
   nova agent enhanced-code-review-agent review src/main.ts src/utils.ts
   ```

2. **Enable Debug Mode:**
   ```bash
   # See what's taking time
   NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/
   ```

3. **Check Network Connectivity:**
   ```bash
   # Test API connectivity
   curl -I https://api.github.com
   curl -I https://gitlab.com/api/v4
   ```

4. **Use Local Analysis:**
   ```bash
   # Disable comment posting for faster local analysis
   nova config set review.autoPostComments false
   ```

### Memory Issues

**Error Messages:**
```
Error: JavaScript heap out of memory
Error: Cannot allocate memory
```

**Solutions:**

1. **Increase Memory Limit:**
   ```bash
   # Run with more memory
   deno run --v8-flags=--max-old-space-size=4096 main.ts agent enhanced-code-review-agent review src/
   ```

2. **Process Files in Batches:**
   ```bash
   # Review files in smaller batches
   find src -name "*.ts" | head -10 | xargs nova agent enhanced-code-review-agent review
   ```

## Configuration Issues

### Invalid Configuration

**Error Messages:**
```
Error: Configuration validation failed
Error: Invalid configuration format
Error: Missing required configuration
```

**Solutions:**

1. **Validate Configuration:**
   ```bash
   # Check configuration syntax
   nova config validate
   
   # Show current configuration
   nova config show
   ```

2. **Fix Configuration Format:**
   ```json
   {
     "github": {
       "token": "ghp_your_token",
       "apiUrl": "https://api.github.com"
     },
     "review": {
       "autoPostComments": true,
       "severityThreshold": "medium",
       "maxFilesPerReview": 50
     }
   }
   ```

3. **Reset Configuration:**
   ```bash
   # Reset to defaults
   nova config reset
   
   # Reconfigure step by step
   nova config set github.token "your_token"
   ```

### Missing AI Configuration

**Error Messages:**
```
Error: No LLM provider configured
Error: AI service unavailable
Error: OpenAI API key not found
```

**Solutions:**

1. **Configure AI Provider:**
   ```bash
   # Set OpenAI configuration
   nova config set ai.default_provider "openai"
   nova config set ai.openai.api_key "sk-your-key"
   nova config set ai.openai.default_model "gpt-4"
   ```

2. **Use Alternative Providers:**
   ```bash
   # Configure Ollama (local)
   nova config set ai.default_provider "ollama"
   nova config set ai.ollama.model "llama2"
   nova config set ai.ollama.api_url "http://localhost:11434"
   ```

## Network and Connectivity

### Connection Timeouts

**Error Messages:**
```
Error: Request timeout
Error: Connection timed out
Error: Network error
```

**Solutions:**

1. **Check Internet Connection:**
   ```bash
   # Test connectivity
   ping github.com
   ping gitlab.com
   ```

2. **Check Proxy Settings:**
   ```bash
   # If behind corporate proxy
   export HTTP_PROXY=http://proxy.company.com:8080
   export HTTPS_PROXY=http://proxy.company.com:8080
   ```

3. **Verify API Endpoints:**
   ```bash
   # Test GitHub API
   curl -I https://api.github.com
   
   # Test GitLab API
   curl -I https://gitlab.com/api/v4
   ```

### SSL/TLS Issues

**Error Messages:**
```
Error: certificate verify failed
Error: SSL connection error
Error: unable to verify the first certificate
```

**Solutions:**

1. **Update Certificates:**
   ```bash
   # Update system certificates (macOS)
   brew install ca-certificates
   
   # Update system certificates (Linux)
   sudo apt-get update && sudo apt-get install ca-certificates
   ```

2. **Configure Custom CA:**
   ```bash
   # If using self-signed certificates
   export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.crt
   ```

## Debug and Logging

### Enable Debug Mode

```bash
# Full debug output
NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/main.ts

# Specific log levels
NOVA_LOG_LEVEL=debug nova agent enhanced-code-review-agent review src/main.ts

# Save debug output to file
NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/main.ts 2>&1 | tee debug.log
```

### Useful Debug Commands

```bash
# Test configuration
nova config validate

# Test repository detection
nova agent enhanced-code-review-agent review pr --dry-run

# Test file access
nova agent enhanced-code-review-agent review --help

# Check agent availability
nova agent list

# Test specific components
NOVA_DEBUG=true nova agent enhanced-code-review-agent help

# Test validation and transformation pipeline
nova debug test-validation --input '{"grade":"B","coverage":"75%"}'

# Show transformation rules
nova debug show-transformations

# Test error recovery
nova debug test-recovery --error-type validation

# Show service architecture
nova debug show-services

# Test modular services
nova debug test-service --service validation
nova debug test-service --service error-handling

# Show processing metrics
nova debug show-metrics --service all
```

### Log Analysis

Look for these patterns in debug logs:

1. **Authentication Issues:**
   ```
   ERROR: Authentication failed
   ERROR: 401 Unauthorized
   ERROR: Invalid token
   ```

2. **Network Issues:**
   ```
   ERROR: Request timeout
   ERROR: Connection refused
   ERROR: DNS resolution failed
   ```

3. **File Issues:**
   ```
   ERROR: ENOENT: no such file
   ERROR: EACCES: permission denied
   ERROR: File not found
   ```

4. **Configuration Issues:**
   ```
   ERROR: Configuration validation failed
   ERROR: Missing required field
   ERROR: Invalid configuration format
   ```

## Getting Help

If you're still experiencing issues:

1. **Check the Documentation:**
   - [Enhanced Code Review Agent Guide](../agents/enhanced-code-review-agent.md)
   - [Nova CLI Documentation](../getting-started/introduction.md)

2. **Enable Debug Mode:**
   ```bash
   NOVA_DEBUG=true nova agent enhanced-code-review-agent review src/main.ts 2>&1 | tee debug.log
   ```

3. **Gather System Information:**
   ```bash
   # System info
   uname -a
   deno --version
   git --version
   
   # Nova info
   nova --version
   nova config show
   ```

4. **Create Minimal Reproduction:**
   ```bash
   # Test with a simple file
   echo 'console.log("test");' > test.js
   nova agent enhanced-code-review-agent review test.js
   ```

5. **Check Common Solutions:**
   - Verify all tokens and credentials
   - Ensure you're in a Git repository
   - Check file permissions and paths
   - Test network connectivity
   - Validate configuration format

Remember to remove sensitive information (tokens, URLs) before sharing debug logs or seeking help.