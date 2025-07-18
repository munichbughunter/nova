# Enhanced Code Review Agent - API Reference

This document provides comprehensive API documentation for the Enhanced Code Review Agent interfaces, classes, and types.

## Table of Contents

- [Core Interfaces](#core-interfaces)
- [Service Classes](#service-classes)
- [Configuration Types](#configuration-types)
- [Error Handling](#error-handling)
- [Utility Types](#utility-types)
- [Usage Examples](#usage-examples)

## Core Interfaces

### ReviewResult

Represents the result of a code review analysis.

```typescript
interface ReviewResult {
  file: string;                    // File path relative to project root
  grade: 'A' | 'B' | 'C' | 'D' | 'F';  // Quality grade
  coverage: number;                // Test coverage percentage (0-100)
  testsPresent: boolean;          // Whether tests exist for this file
  value: 'high' | 'medium' | 'low'; // Business value assessment
  state: 'pass' | 'warning' | 'fail'; // Overall review state
  issues: CodeIssue[];            // Array of detected issues
  suggestions: string[];          // Improvement suggestions
}
```

**Properties:**
- `file`: The file path being reviewed
- `grade`: Overall code quality grade from A (excellent) to F (poor)
- `coverage`: Estimated test coverage percentage
- `testsPresent`: Boolean indicating if tests exist
- `value`: Business value assessment of the code
- `state`: Overall review state for quick filtering
- `issues`: Array of specific issues found in the code
- `suggestions`: General improvement recommendations

### CodeIssue

Represents a specific issue found during code analysis.

```typescript
interface CodeIssue {
  line: number;                   // Line number where issue occurs
  severity: 'low' | 'medium' | 'high'; // Issue severity level
  type: 'security' | 'performance' | 'style' | 'bug'; // Issue category
  message: string;                // Human-readable issue description
}
```

**Properties:**
- `line`: Line number in the file (1-based)
- `severity`: Impact level of the issue
- `type`: Category of the issue for filtering and prioritization
- `message`: Detailed description of the issue and potential fixes

### ReviewCommand

Represents a parsed review command with its parameters.

```typescript
interface ReviewCommand {
  mode: 'file' | 'changes' | 'pr'; // Review mode
  files?: string[];               // File paths for file mode
  prId?: string;                  // PR/MR ID for pr mode
}
```

**Properties:**
- `mode`: The type of review to perform
- `files`: Array of file paths (only for file mode)
- `prId`: Pull request or merge request ID (only for pr mode)

### DiffComment

Represents a comment to be posted on a pull request diff.

```typescript
interface DiffComment {
  filePath: string;               // File path in the repository
  line: number;                   // Line number for the comment
  message: string;                // Comment message
  severity: 'info' | 'warning' | 'error'; // Comment severity
}
```

**Properties:**
- `filePath`: Path to the file in the repository
- `line`: Line number where the comment should be posted
- `message`: The review comment content
- `severity`: Visual indicator for the comment importance

### PullRequest

Represents a pull request or merge request.

```typescript
interface PullRequest {
  id: string;                     // Unique identifier
  title: string;                  // PR/MR title
  author: string;                 // Author username
  status: 'open' | 'closed' | 'merged'; // Current status
  createdAt: Date;                // Creation timestamp
  url: string;                    // Web URL to the PR/MR
}
```

**Properties:**
- `id`: Platform-specific identifier (number for GitHub, string for GitLab)
- `title`: Human-readable title of the PR/MR
- `author`: Username of the person who created the PR/MR
- `status`: Current state of the PR/MR
- `createdAt`: When the PR/MR was created
- `url`: Direct link to view the PR/MR in the web interface

## Service Classes

### EnhancedCodeReviewAgent

Main agent class that orchestrates code review operations.

```typescript
class EnhancedCodeReviewAgent extends ExampleAgent {
  constructor(context: AgentContext);
  
  // Main execution method
  async execute(input: string, options?: AgentExecuteOptions): Promise<AgentResponse>;
  
  // Review mode handlers (private)
  private async handleFileReview(files: string[], options: AgentExecuteOptions): Promise<AgentResponse>;
  private async handleChangesReview(options: AgentExecuteOptions): Promise<AgentResponse>;
  private async handlePRReview(prId: string | undefined, options: AgentExecuteOptions): Promise<AgentResponse>;
}
```

**Methods:**
- `execute()`: Main entry point for all review operations
- `handleFileReview()`: Processes specific file review requests
- `handleChangesReview()`: Handles automatic change detection and review
- `handlePRReview()`: Manages pull request review workflow

### ValidationService

Service responsible for validating and transforming LLM responses.

```typescript
class ValidationService {
  constructor(logger: Logger);
  
  // Validate with automatic transformation
  async validateWithTransformation<T>(
    data: unknown,
    schema: z.ZodType<T>,
    transformers?: DataTransformer[]
  ): Promise<ValidationResult<T>>;
  
  // Register custom transformer
  registerTransformer(transformer: DataTransformer): void;
  
  // Get available transformers
  getAvailableTransformers(): DataTransformer[];
  
  // Get validation metrics
  getValidationMetrics(): ValidationMetrics;
}
```

**Methods:**
- `validateWithTransformation()`: Validates data with automatic type conversion
- `registerTransformer()`: Adds custom transformation rules
- `getAvailableTransformers()`: Lists available transformers
- `getValidationMetrics()`: Returns validation statistics

### ResponseProcessor

Service for processing and cleaning LLM responses.

```typescript
class ResponseProcessor {
  constructor(logger: Logger, validationService: ValidationService);
  
  // Process raw LLM response
  async processResponse<T>(
    rawResponse: string,
    schema: z.ZodType<T>
  ): Promise<ProcessingResult<T>>;
  
  // Clean JSON response
  cleanJSONResponse(response: string): string;
  
  // Apply pre-validation transforms
  applyPreValidationTransforms(data: unknown): unknown;
  
  // Get processing metrics
  getProcessingMetrics(): ProcessingMetrics;
}
```

**Methods:**
- `processResponse()`: Complete response processing pipeline
- `cleanJSONResponse()`: Removes common JSON formatting issues
- `applyPreValidationTransforms()`: Applies known transformations
- `getProcessingMetrics()`: Returns processing statistics

### ErrorHandlingService

Service for handling and recovering from errors.

```typescript
class ErrorHandlingService {
  constructor(logger: Logger);
  
  // Handle validation errors with recovery
  async handleValidationError(
    error: z.ZodError,
    context: ErrorContext
  ): Promise<ErrorResolution>;
  
  // Handle LLM provider errors
  async handleLLMError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorResolution>;
  
  // Handle API errors with retry logic
  async handleAPIError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorResolution>;
  
  // Execute with retry logic
  async withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions
  ): Promise<T>;
  
  // Get error metrics
  getErrorMetrics(): ErrorMetrics;
}
```

**Methods:**
- `handleValidationError()`: Recovers from validation failures
- `handleLLMError()`: Handles LLM provider issues
- `handleAPIError()`: Manages API failures with retry logic
- `withRetry()`: Executes operations with exponential backoff
- `getErrorMetrics()`: Returns error handling statistics

### MonitoringService

Service for collecting metrics and monitoring system performance.

```typescript
class MonitoringService {
  constructor(logger: Logger);
  
  // Record validation metrics
  recordValidationMetric(
    success: boolean,
    transformationsApplied: string[],
    processingTime: number
  ): void;
  
  // Record error recovery metrics
  recordRecoveryMetric(
    errorType: string,
    recoveryStrategy: string,
    success: boolean
  ): void;
  
  // Get comprehensive metrics
  getMetrics(): SystemMetrics;
  
  // Reset metrics
  resetMetrics(): void;
}
```

**Methods:**
- `recordValidationMetric()`: Tracks validation performance
- `recordRecoveryMetric()`: Tracks error recovery success
- `getMetrics()`: Returns comprehensive system metrics
- `resetMetrics()`: Clears collected metrics

### CodeAnalysisService

Service responsible for analyzing code and generating review results.

```typescript
class CodeAnalysisService {
  constructor(logger: Logger, context: AgentContext);
  
  // Analyze multiple files in parallel
  async analyzeMultipleFiles(
    files: FileContent[], 
    progressCallback?: ProgressCallback
  ): Promise<AnalysisResult[]>;
  
  // Analyze a single file
  async analyzeFile(filePath: string, content: string): Promise<ReviewResult>;
  
  // Get cache statistics
  getCacheStats(): CacheStats;
}
```

**Methods:**
- `analyzeMultipleFiles()`: Efficiently analyzes multiple files with progress reporting
- `analyzeFile()`: Analyzes a single file and returns detailed results
- `getCacheStats()`: Returns cache hit/miss statistics for performance monitoring

### RepositoryDetector

Service for detecting repository type and configuration.

```typescript
class RepositoryDetector {
  constructor(logger: Logger, gitService: GitService);
  
  // Detect repository type from Git remote
  async detectRepositoryType(): Promise<'gitlab' | 'github' | 'unknown'>;
}
```

**Methods:**
- `detectRepositoryType()`: Analyzes Git remote URLs to determine platform

### GitService

Service for Git repository operations.

```typescript
interface GitService {
  // Check if current directory is a Git repository
  isGitRepository(): Promise<boolean>;
  
  // Get list of changed files
  getChangedFiles(): Promise<string[]>;
  
  // Get detailed changes for a specific file
  getFileChanges(filePath: string): Promise<FileChange[]>;
  
  // Get remote repository URL
  getRemoteUrl(): Promise<string>;
  
  // Get current branch name
  getCurrentBranch(): Promise<string>;
}
```

**Methods:**
- `isGitRepository()`: Validates Git repository status
- `getChangedFiles()`: Returns list of modified, added, or deleted files
- `getFileChanges()`: Provides detailed diff information for a file
- `getRemoteUrl()`: Retrieves the remote repository URL
- `getCurrentBranch()`: Gets the current Git branch name

### RepositoryService

Abstract base class for repository platform integrations.

```typescript
interface RepositoryService {
  // Get list of pull requests
  getPullRequests(): Promise<PullRequest[]>;
  
  // Get diff data for a specific PR
  getPullRequestDiff(prId: string): Promise<DiffData>;
  
  // Post a review comment to a PR
  postDiffComment(prId: string, comment: DiffComment): Promise<void>;
}
```

**Methods:**
- `getPullRequests()`: Fetches available pull/merge requests
- `getPullRequestDiff()`: Retrieves diff data for analysis
- `postDiffComment()`: Posts review comments to the platform

### GitHubService

GitHub-specific implementation of RepositoryService.

```typescript
class GitHubService implements RepositoryService {
  constructor(logger: Logger, gitService: GitService, config: Config);
  
  // Authenticate with GitHub API
  async authenticate(): Promise<void>;
  
  // Implementation of RepositoryService methods
  async getPullRequests(): Promise<PullRequest[]>;
  async getPullRequestDiff(prId: string): Promise<DiffData>;
  async postDiffComment(prId: string, comment: DiffComment): Promise<void>;
}
```

### GitLabRepositoryService

GitLab-specific implementation of RepositoryService.

```typescript
class GitLabRepositoryService implements RepositoryService {
  constructor(logger: Logger, gitService: GitService, config: Config);
  
  // Implementation of RepositoryService methods
  async getPullRequests(): Promise<PullRequest[]>;
  async getPullRequestDiff(prId: string): Promise<DiffData>;
  async postDiffComment(prId: string, comment: DiffComment): Promise<void>;
}
```

## Configuration Types

### ReviewConfig

Configuration options for the review agent.

```typescript
interface ReviewConfig {
  autoPostComments: boolean;      // Auto-post comments to PRs
  severityThreshold: 'low' | 'medium' | 'high'; // Minimum severity to report
  maxFilesPerReview: number;      // Maximum files per review operation
}
```

**Default Values:**
```typescript
const defaultReviewConfig: ReviewConfig = {
  autoPostComments: true,
  severityThreshold: 'medium',
  maxFilesPerReview: 50
};
```

### GitHubConfig

GitHub integration configuration.

```typescript
interface GitHubConfig {
  token?: string;                 // GitHub Personal Access Token
  apiUrl: string;                 // GitHub API URL
}
```

**Default Values:**
```typescript
const defaultGitHubConfig: GitHubConfig = {
  apiUrl: 'https://api.github.com'
};
```

## Error Handling

### ReviewError

Custom error class for review operations.

```typescript
class ReviewError extends Error {
  constructor(
    public type: ReviewErrorType,
    message: string,
    public details?: Record<string, unknown>,
    public isRetryable: boolean = false,
    public userMessage?: string
  );
  
  // Convert to JSON for logging
  toJSON(): object;
  
  // Get user-friendly message
  toUserMessage(): string;
}
```

### ReviewErrorType

Enumeration of possible error types.

```typescript
enum ReviewErrorType {
  REPOSITORY_NOT_DETECTED = 'REPOSITORY_NOT_DETECTED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  ANALYSIS_FAILED = 'ANALYSIS_FAILED',
  COMMENT_POST_FAILED = 'COMMENT_POST_FAILED',
  GIT_OPERATION_FAILED = 'GIT_OPERATION_FAILED',
  INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
  NETWORK_ERROR = 'NETWORK_ERROR'
}
```

### ReviewErrorHandler

Service for handling and retrying failed operations.

```typescript
class ReviewErrorHandler {
  constructor(logger: Logger);
  
  // Handle any error and convert to ReviewError
  handleError(error: unknown, context?: Record<string, unknown>): ReviewError;
  
  // Execute operation with retry logic
  async withRetry<T>(
    operation: () => Promise<T>,
    errorType: ReviewErrorType,
    context?: Record<string, unknown>,
    maxRetries?: number
  ): Promise<T>;
}
```

## Utility Types

### FileContent

Represents file content for analysis.

```typescript
interface FileContent {
  filePath: string;               // Path to the file
  content: string;                // File content as string
}
```

### AnalysisResult

Result of file analysis operation.

```typescript
interface AnalysisResult {
  filePath: string;               // Path to analyzed file
  result?: ReviewResult;          // Analysis result (if successful)
  error?: ReviewError;            // Error (if analysis failed)
}
```

### FileChange

Represents a change in a Git file.

```typescript
interface FileChange {
  type: 'added' | 'modified' | 'deleted'; // Type of change
  filePath: string;               // Path to changed file
  hunks: DiffHunk[];             // Diff hunks for the change
}
```

### DiffHunk

Represents a section of changes in a file.

```typescript
interface DiffHunk {
  oldStart: number;               // Starting line in old version
  oldLines: number;               // Number of lines in old version
  newStart: number;               // Starting line in new version
  newLines: number;               // Number of lines in new version
  lines: string[];                // Actual diff lines
}
```

### CacheStats

Statistics about analysis cache performance.

```typescript
interface CacheStats {
  hits: number;                   // Number of cache hits
  misses: number;                 // Number of cache misses
  hitRate: number;                // Hit rate percentage
  size: number;                   // Current cache size
}
```

### ProgressCallback

Callback function for reporting analysis progress.

```typescript
type ProgressCallback = (completed: number, total: number) => void;
```

### ValidationResult

Result of validation with transformation.

```typescript
interface ValidationResult<T> {
  success: boolean;               // Whether validation succeeded
  data?: T;                       // Validated data (if successful)
  originalData: unknown;          // Original input data
  transformationsApplied: string[]; // List of transformations applied
  errors: z.ZodError[];          // Validation errors (if any)
  warnings: string[];            // Warnings about transformations
}
```

### ProcessingResult

Result of LLM response processing.

```typescript
interface ProcessingResult<T> {
  success: boolean;               // Whether processing succeeded
  data?: T;                       // Processed data (if successful)
  errors: Error[];               // Processing errors (if any)
  warnings: string[];            // Processing warnings
  fallbackUsed: boolean;         // Whether fallback analysis was used
}
```

### DataTransformer

Interface for data transformation rules.

```typescript
interface DataTransformer {
  name: string;                   // Transformer name
  transform(data: unknown): unknown; // Transformation function
  canTransform(data: unknown, targetType: string): boolean; // Applicability check
}
```

### ErrorContext

Context information for error handling.

```typescript
interface ErrorContext {
  operation: string;              // Operation being performed
  filePath?: string;             // File path (if applicable)
  originalData?: unknown;        // Original data that caused error
  attemptNumber: number;         // Retry attempt number
  timestamp: Date;               // When error occurred
}
```

### ErrorResolution

Result of error handling attempt.

```typescript
interface ErrorResolution {
  strategy: 'retry' | 'fallback' | 'fail' | 'transform'; // Resolution strategy
  data?: unknown;                // Resolved data (if successful)
  message: string;               // Resolution message
  shouldLog: boolean;            // Whether to log this resolution
  retryAfter?: number;           // Delay before retry (milliseconds)
}
```

### ValidationMetrics

Metrics for validation operations.

```typescript
interface ValidationMetrics {
  totalValidations: number;       // Total validation attempts
  successfulValidations: number;  // Successful validations
  transformationsApplied: number; // Total transformations applied
  averageProcessingTime: number;  // Average processing time (ms)
  commonTransformations: Record<string, number>; // Most common transformations
}
```

### ProcessingMetrics

Metrics for response processing operations.

```typescript
interface ProcessingMetrics {
  totalProcessed: number;         // Total responses processed
  successfulProcessing: number;   // Successful processing attempts
  jsonCleaningRequired: number;   // Responses that needed JSON cleaning
  fallbacksUsed: number;         // Times fallback analysis was used
  averageProcessingTime: number;  // Average processing time (ms)
}
```

### ErrorMetrics

Metrics for error handling operations.

```typescript
interface ErrorMetrics {
  totalErrors: number;            // Total errors encountered
  recoveredErrors: number;        // Errors successfully recovered
  retryAttempts: number;         // Total retry attempts
  fallbacksUsed: number;         // Times fallback was used
  errorsByType: Record<string, number>; // Errors grouped by type
  recoveryStrategies: Record<string, number>; // Recovery strategies used
}
```

### SystemMetrics

Comprehensive system metrics.

```typescript
interface SystemMetrics {
  validation: ValidationMetrics;   // Validation metrics
  processing: ProcessingMetrics;   // Processing metrics
  errors: ErrorMetrics;           // Error handling metrics
  cache: CacheStats;              // Cache performance metrics
  uptime: number;                 // System uptime (ms)
  memoryUsage: number;            // Memory usage (bytes)
}
```

### RetryOptions

Options for retry operations.

```typescript
interface RetryOptions {
  maxRetries: number;             // Maximum retry attempts
  baseDelay: number;              // Base delay between retries (ms)
  maxDelay: number;               // Maximum delay between retries (ms)
  backoffFactor: number;          // Exponential backoff factor
  retryableErrors: string[];      // Error types that can be retried
}
```

## Usage Examples

### Basic File Analysis

```typescript
import { EnhancedCodeReviewAgent } from './agents/enhanced-code-review-agent.ts';

// Create agent instance
const agent = new EnhancedCodeReviewAgent(context);

// Analyze specific files
const response = await agent.execute('review src/main.ts src/utils.ts');

// Access results
const results = response.data?.results as ReviewResult[];
results.forEach(result => {
  console.log(`${result.file}: Grade ${result.grade}, ${result.issues.length} issues`);
});
```

### Change Detection

```typescript
// Analyze changed files
const response = await agent.execute('review');

// Check if any changes were found
if (response.data?.changedFiles?.length === 0) {
  console.log('No changes detected');
} else {
  console.log(`Analyzed ${response.data.results.length} changed files`);
}
```

### Pull Request Review

```typescript
// Review pull requests
const response = await agent.execute('review pr');

// Access PR information
const prInfo = response.data?.pullRequest;
console.log(`Reviewed PR: ${prInfo?.title} by ${prInfo?.author}`);
```

### Custom Analysis Service

```typescript
import { CodeAnalysisService } from './services/analysis/code_analysis_service.ts';

// Create analysis service
const analysisService = new CodeAnalysisService(logger, context);

// Analyze files with progress tracking
const files = [
  { filePath: 'src/main.ts', content: 'file content...' },
  { filePath: 'src/utils.ts', content: 'file content...' }
];

const results = await analysisService.analyzeMultipleFiles(
  files,
  (completed, total) => {
    console.log(`Progress: ${completed}/${total}`);
  }
);

// Check cache performance
const stats = analysisService.getCacheStats();
console.log(`Cache hit rate: ${stats.hitRate}%`);
```

### Error Handling

```typescript
import { ReviewError, ReviewErrorType } from './agents/review-error-handler.ts';

try {
  const response = await agent.execute('review src/nonexistent.ts');
} catch (error) {
  if (error instanceof ReviewError) {
    console.error(`Review error (${error.type}): ${error.toUserMessage()}`);
    
    if (error.isRetryable) {
      console.log('This operation can be retried');
    }
  }
}
```

### Repository Detection

```typescript
import { RepositoryDetector } from './services/repository/repository_detector.ts';

const detector = new RepositoryDetector(logger, gitService);
const repoType = await detector.detectRepositoryType();

switch (repoType) {
  case 'github':
    console.log('Using GitHub integration');
    break;
  case 'gitlab':
    console.log('Using GitLab integration');
    break;
  case 'unknown':
    console.log('Repository type not detected');
    break;
}
```

### Configuration Usage

```typescript
// Access review configuration
const reviewConfig = context.config.review || {
  autoPostComments: true,
  severityThreshold: 'medium',
  maxFilesPerReview: 50
};

// Filter issues by severity threshold
const filteredIssues = issues.filter(issue => {
  const severityLevels = { low: 1, medium: 2, high: 3 };
  return severityLevels[issue.severity] >= severityLevels[reviewConfig.severityThreshold];
});
```

This API reference provides comprehensive documentation for all interfaces, classes, and types used in the Enhanced Code Review Agent, along with practical usage examples.