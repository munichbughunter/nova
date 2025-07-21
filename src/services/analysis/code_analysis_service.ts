import { z } from 'zod';
import type { 
    ReviewAnalysis, 
    CodeIssue,
    AgentContext 
} from '../../agents/types.ts';
import { FlexibleReviewAnalysisSchema, type FlexibleReviewAnalysis } from './validation/schemas.ts';
import type { Logger } from '../../utils/logger.ts';
import { PerformanceCache } from '../performance_cache.ts';
import { ParallelProcessor, type ParallelTask } from '../parallel_processor.ts';
import { LLMResponseProcessor } from '../llm/llm-response-processor.ts';
import { ValidationService } from './validation/validation.service.ts';

/**
 * Enhanced code analysis service for comprehensive code review
 */
export class CodeAnalysisService {
    private logger: Logger;
    private context: AgentContext;
    private cache: PerformanceCache;
    private parallelProcessor: ParallelProcessor;
    private responseProcessor: LLMResponseProcessor;
    private validationService: ValidationService;

    constructor(logger: Logger, context: AgentContext) {
        this.logger = logger.child('CodeAnalysisService');
        this.context = context;
        this.cache = new PerformanceCache(logger);
        this.parallelProcessor = new ParallelProcessor(logger, {
            maxConcurrency: 5,
            timeoutMs: 60000, // 60 seconds for code analysis
            retryAttempts: 2,
        });
        this.responseProcessor = new LLMResponseProcessor(logger);
        this.validationService = new ValidationService(logger);
    }

    /**
     * Perform comprehensive code analysis with structured output
     */
    async analyzeCode(filePath: string, content: string): Promise<ReviewAnalysis> {
        try {
            this.logger.debug(`Analyzing code for file: ${filePath}`);

            // Check cache first
            const cachedResult = this.cache.get(filePath, content);
            if (cachedResult) {
                this.logger.debug(`Using cached analysis for ${filePath}`);
                return cachedResult;
            }

            // Perform analysis
            let result: ReviewAnalysis;
            if (this.context.llmProvider) {
                result = await this.performLLMAnalysis(filePath, content);
            } else {
                // Fallback to rule-based analysis
                this.logger.info('LLM not available, using rule-based analysis');
                result = await this.performRuleBasedAnalysis(filePath, content);
            }

            // Cache the result
            this.cache.set(filePath, content, result);
            
            return result;
        } catch (error) {
            this.logger.error('Code analysis failed', { error, filePath });
            // Return a basic analysis with error information
            return this.createErrorAnalysis(filePath, error);
        }
    }

    /**
     * Analyze multiple files in parallel with caching
     */
    async analyzeMultipleFiles(
        files: Array<{ filePath: string; content: string }>,
        onProgress?: (completed: number, total: number) => void
    ): Promise<Array<{ filePath: string; result: ReviewAnalysis; fromCache: boolean; error?: Error }>> {
        this.logger.info(`Starting parallel analysis of ${files.length} files`);

        // Create tasks for parallel processing
        const tasks: ParallelTask<{ filePath: string; content: string }, ReviewAnalysis>[] = files.map(file => ({
            id: file.filePath,
            data: file,
            processor: async (data) => {
                // Check cache first
                const cachedResult = this.cache.get(data.filePath, data.content);
                if (cachedResult) {
                    return cachedResult;
                }

                // Perform analysis
                let result: ReviewAnalysis;
                if (this.context.llmProvider) {
                    result = await this.performLLMAnalysis(data.filePath, data.content);
                } else {
                    result = await this.performRuleBasedAnalysis(data.filePath, data.content);
                }

                // Cache the result
                this.cache.set(data.filePath, data.content, result);
                return result;
            },
        }));

        // Process in parallel
        const results = await this.parallelProcessor.processInParallel(tasks, onProgress);

        // Transform results
        return results.map(result => ({
            filePath: result.data.filePath,
            result: result.result || this.createErrorAnalysis(result.data.filePath, result.error || new Error('Unknown error')),
            fromCache: this.cache.get(result.data.filePath, result.data.content) !== null,
            error: result.error,
        }));
    }

    /**
     * Check if files have changed since last analysis
     */
    checkFilesChanged(files: Array<{ filePath: string; content: string }>): Array<{ filePath: string; hasChanged: boolean }> {
        return files.map(file => ({
            filePath: file.filePath,
            hasChanged: this.cache.hasFileChanged(file.filePath, file.content),
        }));
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return this.cache.getStats();
    }

    /**
     * Clear analysis cache
     */
    clearCache(): void {
        this.cache.clear();
        this.logger.info('Analysis cache cleared');
    }

    /**
     * Clear expired cache entries
     */
    clearExpiredCache(): void {
        this.cache.clearExpired();
    }

    /**
     * Perform LLM-based comprehensive code analysis
     */
    private async performLLMAnalysis(filePath: string, content: string): Promise<ReviewAnalysis> {
        const analysisPrompt = this.buildAnalysisPrompt(filePath, content);
        
        try {
            // Get raw response from LLM provider
            const rawResponse = await this.context.llmProvider!.generate(
                `${this.getSystemPrompt()}\n\n${analysisPrompt}`
            );

            // Process the response using the new LLMResponseProcessor with ValidationService
            const processingResult = await this.responseProcessor.processResponse(
                rawResponse,
                FlexibleReviewAnalysisSchema,
                {
                    provider: this.context.llmProvider!.constructor.name,
                    model: 'unknown', // LLMProvider interface doesn't have model property
                    attemptNumber: 1,
                    timestamp: new Date(),
                    requestId: `analysis-${filePath}-${Date.now()}`
                }
            );

            if (processingResult.success && processingResult.data) {
                this.logger.debug('LLM analysis completed successfully', {
                    filePath,
                    transformationsApplied: processingResult.transformationsApplied,
                    warnings: processingResult.warnings,
                    processingTime: processingResult.processingTime
                });
                
                // Log any warnings from the processing
                if (processingResult.warnings.length > 0) {
                    this.logger.info('LLM response processing warnings', {
                        filePath,
                        warnings: processingResult.warnings
                    });
                }
                
                return this.convertToReviewAnalysis(processingResult.data as FlexibleReviewAnalysis);
            } else {
                // Processing failed, log errors and fall back
                this.logger.warn('LLM response processing failed, falling back to rule-based analysis', {
                    filePath,
                    errors: processingResult.errors.map(e => e.message),
                    fallbackUsed: processingResult.fallbackUsed
                });
                
                return await this.performRuleBasedAnalysis(filePath, content);
            }
        } catch (error) {
            this.logger.warn('LLM analysis failed, falling back to rule-based analysis', { 
                error: error instanceof Error ? error.message : 'Unknown error',
                filePath 
            });
            return await this.performRuleBasedAnalysis(filePath, content);
        }
    }

    /**
     * Convert FlexibleReviewAnalysis to ReviewAnalysis
     */
    private convertToReviewAnalysis(flexibleAnalysis: FlexibleReviewAnalysis): ReviewAnalysis {
        // Ensure grade is a valid enum value
        const validGrades = ['A', 'B', 'C', 'D', 'F'] as const;
        const grade = validGrades.includes(flexibleAnalysis.grade as any) 
            ? flexibleAnalysis.grade as 'A' | 'B' | 'C' | 'D' | 'F'
            : 'C' as const;

        // Ensure value is a valid enum value
        const validValues = ['high', 'medium', 'low'] as const;
        const value = validValues.includes(flexibleAnalysis.value as any)
            ? flexibleAnalysis.value as 'high' | 'medium' | 'low'
            : 'medium' as const;

        // Ensure state is a valid enum value
        const validStates = ['pass', 'warning', 'fail'] as const;
        const state = validStates.includes(flexibleAnalysis.state as any)
            ? flexibleAnalysis.state as 'pass' | 'warning' | 'fail'
            : 'warning' as const;

        // Convert issues to the expected format
        const issues = flexibleAnalysis.issues.map(issue => ({
            line: typeof issue.line === 'number' ? issue.line : parseInt(String(issue.line), 10) || 1,
            severity: (['low', 'medium', 'high'].includes(issue.severity) 
                ? issue.severity 
                : 'medium') as 'low' | 'medium' | 'high',
            type: (['security', 'performance', 'style', 'bug'].includes(issue.type)
                ? issue.type
                : 'style') as 'security' | 'performance' | 'style' | 'bug',
            message: issue.message || 'No message provided',
        }));

        return {
            grade,
            coverage: typeof flexibleAnalysis.coverage === 'number' 
                ? flexibleAnalysis.coverage 
                : 0,
            testsPresent: Boolean(flexibleAnalysis.testsPresent),
            value,
            state,
            issues,
            suggestions: Array.isArray(flexibleAnalysis.suggestions) 
                ? flexibleAnalysis.suggestions 
                : [],
            summary: flexibleAnalysis.summary || 'Analysis completed',
        };
    }

    /**
     * Perform rule-based code analysis as fallback
     */
    private async performRuleBasedAnalysis(filePath: string, content: string): Promise<ReviewAnalysis> {
        const language = this.detectLanguage(filePath);
        const metrics = this.calculateCodeMetrics(content);
        const issues = this.detectIssues(content, language);
        const suggestions = this.generateSuggestions(content, language, metrics);
        
        // Calculate grade based on metrics and issues
        const grade = this.calculateGrade(metrics, issues);
        
        // Estimate test coverage (basic heuristic)
        const coverage = this.estimateTestCoverage(content, language);
        
        // Determine if tests are present
        const testsPresent = this.detectTestsPresent(content, language);
        
        // Assess business value
        const value = this.assessBusinessValue(filePath, content);
        
        // Determine overall state
        const state = this.determineState(grade, issues);

        return {
            grade,
            coverage,
            testsPresent,
            value,
            state,
            issues,
            suggestions,
            summary: this.generateSummary(filePath, language, metrics, issues.length),
        };
    }

    /**
     * Build comprehensive analysis prompt for LLM
     */
    private buildAnalysisPrompt(filePath: string, content: string): string {
        return `Perform a comprehensive code review analysis of the following file:

**File:** ${filePath}
**Content:**
\`\`\`
${content}
\`\`\`

Please analyze this code and provide a structured review covering:

1. **Code Quality Grade (A-F)**: Overall assessment based on:
   - Code structure and organization
   - Readability and maintainability
   - Adherence to best practices
   - Error handling and robustness

2. **Test Coverage Percentage (0-100)**: Estimate based on:
   - Presence of test files or test code
   - Coverage of main functionality
   - Edge case handling in tests

3. **Tests Present (boolean)**: Whether tests exist for this code

4. **Business Value (high/medium/low)**: Assess based on:
   - Core functionality importance
   - User-facing features
   - Infrastructure criticality
   - Reusability and modularity

5. **Overall State (pass/warning/fail)**: Based on:
   - pass: High quality, minimal issues
   - warning: Good quality with some concerns
   - fail: Significant issues requiring attention

6. **Security Analysis**: Check for:
   - Input validation vulnerabilities
   - Authentication/authorization issues
   - Data exposure risks
   - Injection vulnerabilities

7. **Performance Analysis**: Evaluate:
   - Algorithm efficiency
   - Memory usage patterns
   - Database query optimization
   - Caching opportunities

8. **Best Practices**: Review:
   - Code style consistency
   - Naming conventions
   - Function/class design
   - Documentation quality

Provide specific, actionable feedback with line numbers where applicable.`;
    }

    /**
     * Get system prompt for LLM analysis
     */
    private getSystemPrompt(): string {
        return `You are an expert code reviewer with deep knowledge of software engineering best practices, security, and performance optimization. 

Your analysis should be:
- Thorough and comprehensive
- Specific with actionable recommendations
- Balanced between identifying issues and recognizing good practices
- Focused on maintainability, security, and performance
- Appropriate for the detected programming language and context

When assigning grades:
- A: Excellent code with best practices, comprehensive tests, no significant issues
- B: Good code with minor improvements needed, adequate testing
- C: Average code with some issues, basic testing present
- D: Below average code with multiple issues, limited testing
- F: Poor code with serious issues, no testing, security concerns

Be precise with coverage estimates and realistic about business value assessment.

CRITICAL: You MUST respond with ONLY a valid JSON object. No explanatory text, no markdown, no additional commentary.

Required JSON structure:
{
  "grade": "A",
  "coverage": 85,
  "testsPresent": true,
  "value": "high",
  "state": "pass",
  "issues": [
    {
      "line": 42,
      "severity": "medium",
      "type": "security",
      "message": "Potential vulnerability description"
    }
  ],
  "suggestions": [
    "Add unit tests for better coverage",
    "Consider refactoring for maintainability"
  ],
  "summary": "Brief analysis summary"
}

RULES:
- Start response with { and end with }
- No text before or after the JSON
- suggestions must be array of strings, not objects
- All fields are required
- Use exact field names and types shown above`;
    }

    /**
     * Detect programming language from file path
     */
    private detectLanguage(filePath: string): string {
        const extension = filePath.split('.').pop()?.toLowerCase() || '';
        const languageMap: Record<string, string> = {
            'ts': 'TypeScript',
            'js': 'JavaScript',
            'tsx': 'TypeScript React',
            'jsx': 'JavaScript React',
            'py': 'Python',
            'java': 'Java',
            'cpp': 'C++',
            'c': 'C',
            'cs': 'C#',
            'php': 'PHP',
            'rb': 'Ruby',
            'go': 'Go',
            'rs': 'Rust',
            'swift': 'Swift',
            'kt': 'Kotlin',
            'dart': 'Dart',
            'scala': 'Scala',
            'clj': 'Clojure',
            'hs': 'Haskell',
            'elm': 'Elm',
        };
        return languageMap[extension] || 'Unknown';
    }

    /**
     * Calculate basic code metrics
     */
    private calculateCodeMetrics(content: string): {
        lines: number;
        nonEmptyLines: number;
        commentLines: number;
        complexity: number;
        functions: number;
        classes: number;
    } {
        const lines = content.split('\n');
        const lineCount = lines.length;
        const nonEmptyLines = lines.filter(line => line.trim().length > 0).length;
        
        // Count comment lines (basic patterns)
        const commentLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('//') || 
                   trimmed.startsWith('/*') || 
                   trimmed.startsWith('*') || 
                   trimmed.startsWith('#') ||
                   trimmed.startsWith('"""') ||
                   trimmed.startsWith("'''");
        }).length;

        // Calculate cyclomatic complexity (basic estimation)
        const complexityPatterns = [
            /\bif\b/g, /\belse\b/g, /\belseif\b/g, /\belif\b/g,
            /\bfor\b/g, /\bwhile\b/g, /\bdo\b/g,
            /\bswitch\b/g, /\bcase\b/g,
            /\btry\b/g, /\bcatch\b/g, /\bexcept\b/g,
            /\?\s*:/g, // ternary operators
            /&&/g, /\|\|/g, // logical operators
        ];
        
        let complexity = 1; // Base complexity
        complexityPatterns.forEach(pattern => {
            const matches = content.match(pattern);
            complexity += matches ? matches.length : 0;
        });

        // Count functions and classes
        const functionPatterns = [
            /\bfunction\b/g, /\bdef\b/g, /\bfunc\b/g,
            /=>\s*{/g, // arrow functions
            /:\s*\([^)]*\)\s*=>/g, // TypeScript arrow functions
        ];
        
        let functions = 0;
        functionPatterns.forEach(pattern => {
            const matches = content.match(pattern);
            functions += matches ? matches.length : 0;
        });

        const classMatches = content.match(/\bclass\b/g);
        const classes = classMatches ? classMatches.length : 0;

        return {
            lines: lineCount,
            nonEmptyLines,
            commentLines,
            complexity,
            functions,
            classes,
        };
    }

    /**
     * Detect code issues using pattern matching
     */
    private detectIssues(content: string, language: string): CodeIssue[] {
        const issues: CodeIssue[] = [];
        const lines = content.split('\n');

        // Security issues
        this.detectSecurityIssues(content, lines, issues);
        
        // Performance issues
        this.detectPerformanceIssues(content, lines, issues, language);
        
        // Style issues
        this.detectStyleIssues(content, lines, issues, language);
        
        // Bug-prone patterns
        this.detectBugPatterns(content, lines, issues, language);

        return issues;
    }

    /**
     * Detect security-related issues
     */
    private detectSecurityIssues(content: string, lines: string[], issues: CodeIssue[]): void {
        // SQL injection risks
        if (content.includes('SELECT') && content.includes('+')) {
            const lineIndex = lines.findIndex(line => line.includes('SELECT') && line.includes('+'));
            if (lineIndex !== -1) {
                issues.push({
                    line: lineIndex + 1,
                    severity: 'high',
                    type: 'security',
                    message: 'Potential SQL injection vulnerability - use parameterized queries',
                });
            }
        }

        // eval() usage
        if (content.includes('eval(')) {
            const lineIndex = lines.findIndex(line => line.includes('eval('));
            if (lineIndex !== -1) {
                issues.push({
                    line: lineIndex + 1,
                    severity: 'high',
                    type: 'security',
                    message: 'Use of eval() is dangerous and should be avoided',
                });
            }
        }

        // Hardcoded secrets patterns
        const secretPatterns = [
            /password\s*=\s*["'][^"']+["']/i,
            /api[_-]?key\s*=\s*["'][^"']+["']/i,
            /secret\s*=\s*["'][^"']+["']/i,
            /token\s*=\s*["'][^"']+["']/i,
        ];

        secretPatterns.forEach(pattern => {
            const match = content.match(pattern);
            if (match) {
                const lineIndex = lines.findIndex(line => pattern.test(line));
                if (lineIndex !== -1) {
                    issues.push({
                        line: lineIndex + 1,
                        severity: 'high',
                        type: 'security',
                        message: 'Potential hardcoded secret - use environment variables or secure storage',
                    });
                }
            }
        });
    }

    /**
     * Detect performance-related issues
     */
    private detectPerformanceIssues(content: string, lines: string[], issues: CodeIssue[], language: string): void {
        // Nested loops - look for patterns across multiple lines
        let inForLoop = false;
        let forLoopDepth = 0;
        lines.forEach((line, index) => {
            const forMatches = (line.match(/\bfor\s*\(/g) || []).length;
            const braceOpen = (line.match(/{/g) || []).length;
            const braceClose = (line.match(/}/g) || []).length;
            
            forLoopDepth += braceOpen - braceClose;
            
            if (forMatches > 0) {
                if (inForLoop && forLoopDepth > 0) {
                    issues.push({
                        line: index + 1,
                        severity: 'medium',
                        type: 'performance',
                        message: 'Nested loops detected - consider optimization for large datasets',
                    });
                }
                inForLoop = true;
            }
            
            if (forLoopDepth <= 0) {
                inForLoop = false;
                forLoopDepth = 0;
            }
        });

        // Inefficient string concatenation (JavaScript/TypeScript)
        if ((language.includes('JavaScript') || language.includes('TypeScript')) && 
            content.includes('+=') && content.includes('string')) {
            const lineIndex = lines.findIndex(line => line.includes('+=') && line.includes('string'));
            if (lineIndex !== -1) {
                issues.push({
                    line: lineIndex + 1,
                    severity: 'low',
                    type: 'performance',
                    message: 'Consider using array.join() or template literals for string concatenation',
                });
            }
        }

        // Synchronous file operations
        if (content.includes('readFileSync') || content.includes('writeFileSync')) {
            const lineIndex = lines.findIndex(line => line.includes('readFileSync') || line.includes('writeFileSync'));
            if (lineIndex !== -1) {
                issues.push({
                    line: lineIndex + 1,
                    severity: 'medium',
                    type: 'performance',
                    message: 'Consider using asynchronous file operations to avoid blocking',
                });
            }
        }
    }

    /**
     * Detect style-related issues
     */
    private detectStyleIssues(content: string, lines: string[], issues: CodeIssue[], language: string): void {
        // Long lines
        lines.forEach((line, index) => {
            if (line.length > 120) {
                issues.push({
                    line: index + 1,
                    severity: 'low',
                    type: 'style',
                    message: 'Line too long - consider breaking into multiple lines for readability',
                });
            }
        });

        // Missing semicolons (JavaScript/TypeScript) - be more selective
        if (language.includes('JavaScript') || language.includes('TypeScript')) {
            lines.forEach((line, index) => {
                const trimmed = line.trim();
                if (trimmed.length > 0 && 
                    !trimmed.endsWith(';') && 
                    !trimmed.endsWith('{') && 
                    !trimmed.endsWith('}') &&
                    !trimmed.endsWith(',') &&
                    !trimmed.endsWith(':') &&
                    !trimmed.startsWith('//') &&
                    !trimmed.startsWith('/*') &&
                    !trimmed.startsWith('*') &&
                    !trimmed.includes('/**') &&
                    !/^(if|for|while|switch|function|class|import|export|interface|type|const|let|var)/.test(trimmed) &&
                    !/^\s*(async\s+)?(\w+\s*\(|\w+:\s*\(|\w+\s*=\s*\()/.test(trimmed) && // function definitions
                    !trimmed.includes('=>') && // arrow functions
                    trimmed.includes('=') && // only flag assignment-like statements
                    !trimmed.includes('return')) {
                    issues.push({
                        line: index + 1,
                        severity: 'low',
                        type: 'style',
                        message: 'Consider adding semicolon for consistency',
                    });
                }
            });
        }

        // TODO/FIXME comments
        lines.forEach((line, index) => {
            if (line.includes('TODO') || line.includes('FIXME')) {
                issues.push({
                    line: index + 1,
                    severity: 'low',
                    type: 'style',
                    message: 'TODO/FIXME comment found - consider addressing or creating a task',
                });
            }
        });
    }

    /**
     * Detect bug-prone patterns
     */
    private detectBugPatterns(content: string, lines: string[], issues: CodeIssue[], language: string): void {
        // Loose equality (JavaScript/TypeScript)
        if ((language.includes('JavaScript') || language.includes('TypeScript')) && 
            content.includes('==') && !content.includes('===')) {
            const lineIndex = lines.findIndex(line => line.includes('==') && !line.includes('==='));
            if (lineIndex !== -1) {
                issues.push({
                    line: lineIndex + 1,
                    severity: 'medium',
                    type: 'bug',
                    message: 'Use strict equality (===) instead of loose equality (==)',
                });
            }
        }

        // Unused variables (basic detection)
        const variableDeclarations = content.match(/(?:let|const|var)\s+(\w+)/g);
        if (variableDeclarations) {
            variableDeclarations.forEach(declaration => {
                const varName = declaration.split(/\s+/)[1];
                const usageCount = (content.match(new RegExp(`\\b${varName}\\b`, 'g')) || []).length;
                if (usageCount === 1) { // Only declared, never used
                    const lineIndex = lines.findIndex(line => line.includes(declaration));
                    if (lineIndex !== -1) {
                        issues.push({
                            line: lineIndex + 1,
                            severity: 'low',
                            type: 'bug',
                            message: `Variable '${varName}' is declared but never used`,
                        });
                    }
                }
            });
        }
    }

    /**
     * Generate improvement suggestions
     */
    private generateSuggestions(content: string, language: string, metrics: any): string[] {
        const suggestions: string[] = [];

        // Comment ratio suggestions
        const commentRatio = metrics.commentLines / metrics.nonEmptyLines;
        if (commentRatio < 0.1) {
            suggestions.push('Add more comments to improve code documentation and readability');
        }

        // Complexity suggestions
        if (metrics.complexity > 20) {
            suggestions.push('Consider refactoring to reduce cyclomatic complexity and improve maintainability');
        }

        // File size suggestions
        if (metrics.lines > 500) {
            suggestions.push('File is quite large - consider breaking it into smaller, more focused modules');
        }

        // Function count suggestions
        if (metrics.functions > 20) {
            suggestions.push('High number of functions detected - consider organizing into classes or modules');
        }

        // Language-specific suggestions
        if (language.includes('JavaScript') || language.includes('TypeScript')) {
            if (content.includes('var ')) {
                suggestions.push('Replace var declarations with const or let for better scoping');
            }
            if (content.includes('console.log')) {
                suggestions.push('Remove console.log statements before production deployment');
            }
        }

        if (language === 'Python') {
            if (!content.includes('"""') && !content.includes("'''")) {
                suggestions.push('Add docstrings to functions and classes for better documentation');
            }
        }

        // Testing suggestions
        if (!this.detectTestsPresent(content, language)) {
            suggestions.push('Add unit tests to improve code reliability and maintainability');
        }

        // Error handling suggestions
        if (!content.includes('try') && !content.includes('catch') && !content.includes('except')) {
            suggestions.push('Consider adding error handling for better robustness');
        }

        return suggestions;
    }

    /**
     * Calculate overall grade based on metrics and issues
     */
    private calculateGrade(metrics: any, issues: CodeIssue[]): 'A' | 'B' | 'C' | 'D' | 'F' {
        let score = 100;

        // Deduct points for complexity
        if (metrics.complexity > 25) score -= 25;
        else if (metrics.complexity > 15) score -= 15;
        else if (metrics.complexity > 10) score -= 10;
        else if (metrics.complexity > 5) score -= 5;

        // Deduct points for issues
        issues.forEach(issue => {
            switch (issue.severity) {
                case 'high': score -= 15; break;
                case 'medium': score -= 8; break;
                case 'low': score -= 3; break;
            }
        });

        // Deduct points for poor comment ratio
        const commentRatio = metrics.commentLines / metrics.nonEmptyLines;
        if (commentRatio < 0.05) score -= 10;
        else if (commentRatio < 0.1) score -= 5;

        // Deduct points for file size
        if (metrics.lines > 1000) score -= 15;
        else if (metrics.lines > 500) score -= 8;

        // Convert score to grade
        if (score >= 90) return 'A';
        if (score >= 80) return 'B';
        if (score >= 70) return 'C';
        if (score >= 60) return 'D';
        return 'F';
    }

    /**
     * Estimate test coverage (basic heuristic)
     */
    private estimateTestCoverage(content: string, language: string): number {
        // Basic heuristic based on test-related keywords
        const testKeywords = [
            'test', 'spec', 'describe', 'it', 'expect', 'assert',
            'should', 'mock', 'stub', 'spy', 'beforeEach', 'afterEach',
            'setUp', 'tearDown', 'TestCase', '@Test'
        ];

        let testIndicators = 0;
        testKeywords.forEach(keyword => {
            const matches = content.match(new RegExp(`\\b${keyword}\\b`, 'gi'));
            testIndicators += matches ? matches.length : 0;
        });

        // Estimate coverage based on test indicators and code size
        const lines = content.split('\n').length;
        const testDensity = testIndicators / lines;

        if (testDensity > 0.1) return Math.min(90, testDensity * 400);
        if (testDensity > 0.05) return Math.min(70, testDensity * 600);
        if (testDensity > 0.02) return Math.min(50, testDensity * 800);
        if (testDensity > 0) return Math.min(30, testDensity * 1000);

        return 0;
    }

    /**
     * Detect if tests are present
     */
    private detectTestsPresent(content: string, language: string): boolean {
        const testPatterns = [
            /\btest\b/i, /\bspec\b/i, /\bdescribe\b/i, /\bit\b\(/i,
            /\bexpect\b/i, /\bassert\b/i, /\bshould\b/i,
            /@Test\b/i, /TestCase/i, /\bmock\b/i
        ];

        return testPatterns.some(pattern => pattern.test(content));
    }

    /**
     * Assess business value of the code
     */
    private assessBusinessValue(filePath: string, content: string): 'high' | 'medium' | 'low' {
        // Check for test files first (lower business value)
        const pathLower = filePath.toLowerCase();
        if (pathLower.includes('test') || pathLower.includes('spec')) {
            return 'low';
        }

        // High value indicators
        const highValuePatterns = [
            /\bapi\b/i, /\bcontroller\b/i, /\bservice\b/i, /\bmodel\b/i,
            /\bauth\b/i, /\bpayment\b/i, /\bbilling\b/i, /\buser\b/i,
            /\bmain\b/i, /\bindex\b/i, /\bapp\b/i, /\bcore\b/i
        ];

        // Medium value indicators
        const mediumValuePatterns = [
            /\butil\b/i, /\bhelper\b/i, /\bcomponent\b/i, /\bwidget\b/i,
            /\bconfig\b/i, /\bmiddleware\b/i
        ];

        // Check file path
        if (highValuePatterns.some(pattern => pattern.test(pathLower))) {
            return 'high';
        }
        if (mediumValuePatterns.some(pattern => pattern.test(pathLower))) {
            return 'medium';
        }

        // Check content
        if (highValuePatterns.some(pattern => pattern.test(content))) {
            return 'high';
        }
        if (mediumValuePatterns.some(pattern => pattern.test(content))) {
            return 'medium';
        }

        return 'medium'; // Default
    }

    /**
     * Determine overall state based on grade and issues
     */
    private determineState(grade: string, issues: CodeIssue[]): 'pass' | 'warning' | 'fail' {
        const highSeverityIssues = issues.filter(issue => issue.severity === 'high').length;
        const mediumSeverityIssues = issues.filter(issue => issue.severity === 'medium').length;

        if (highSeverityIssues > 0 || grade === 'F') {
            return 'fail';
        }
        
        if (mediumSeverityIssues > 2 || grade === 'D' || (grade === 'C' && mediumSeverityIssues > 0)) {
            return 'warning';
        }

        return 'pass';
    }

    /**
     * Generate analysis summary
     */
    private generateSummary(filePath: string, language: string, metrics: any, issueCount: number): string {
        const complexityLevel = metrics.complexity > 20 ? 'high' : 
                              metrics.complexity > 10 ? 'medium' : 'low';
        
        return `${language} file with ${metrics.lines} lines of code. ` +
               `Complexity level: ${complexityLevel}. ` +
               `Found ${issueCount} potential issues. ` +
               `Contains ${metrics.functions} functions and ${metrics.classes} classes.`;
    }

    /**
     * Create error analysis when analysis fails
     */
    private createErrorAnalysis(filePath: string, error: unknown): ReviewAnalysis {
        return {
            grade: 'F',
            coverage: 0,
            testsPresent: false,
            value: 'low',
            state: 'fail',
            issues: [{
                line: 1,
                severity: 'high',
                type: 'bug',
                message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            }],
            suggestions: ['Fix analysis errors before proceeding with code review'],
            summary: `Analysis failed for ${filePath}. Please check the file and try again.`,
        };
    }
}