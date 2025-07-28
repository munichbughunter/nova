import { Table } from '@cliffy/table';
import { z } from 'zod';
import { AIService } from '../../../services/ai_service.ts';
import { GitService } from '../../../services/git_service.ts';
import { theme } from '../../../utils.ts';
import { AgentResponse } from '../../base_agent.ts';
import { BaseDevAgent } from '../base_dev_agent.ts';
import { BaseEngineeringOptions } from '../types.ts';
import {
  FileAnalysis,
  FileAnalysisSchema,
  ReviewSession,
  ReviewSynthesis,
  ReviewSynthesisSchema,
} from './schemas.ts';
import { ReviewAgentContext } from './types.ts';

// Add Deno types
interface FileInfo {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

interface AnalysisResponse extends AgentResponse {
  data?: {
    analyses: FileAnalysis[];
    synthesis?: ReviewSynthesis;
  };
}

interface ImplementationResponse extends AgentResponse {
  data?: {
    criticalIssues: Array<FileAnalysis['issues'][0] & { file: string }>;
    autoFixed: string[];
  };
}

interface ValidationResponse extends AgentResponse {
  data?: {
    validatedFiles: string[];
    testResults: unknown;
  };
}

const analyzeParamsSchema = z.object({
  perspective: z.enum(['junior', 'senior', 'architect']),
  reason: z.string().min(1),
});

const evaluateParamsSchema = z.object({
  qualityScore: z.number().int().min(1).max(10),
  issues: z.array(z.string().min(1)),
  suggestions: z.array(z.string().min(1)),
  isComprehensive: z.boolean(),
  hasActionableItems: z.boolean(),
  improvementSuggestions: z.array(z.string().min(1)).default([]),
});

const improveParamsSchema = z.object({
  perspective: z.enum(['junior', 'senior', 'architect']),
  focusAreas: z.array(z.string().min(1)).min(1),
});

type AnalyzeParams = z.infer<typeof analyzeParamsSchema>;
type EvaluateParams = z.infer<typeof evaluateParamsSchema>;
type ImproveParams = z.infer<typeof improveParamsSchema>;

type Tools = {
  analyze: {
    description: string;
    parameters: typeof analyzeParamsSchema;
    execute: (params: AnalyzeParams) => Promise<{ type: 'success'; result: FileAnalysis }>;
  };
  evaluate: {
    description: string;
    parameters: typeof evaluateParamsSchema;
    execute: (params: EvaluateParams) => Promise<{ type: 'success'; result: EvaluateParams }>;
  };
  improve: {
    description: string;
    parameters: typeof improveParamsSchema;
    execute: (params: ImproveParams) => Promise<{ type: 'success'; result: FileAnalysis }>;
  };
};

type ToolResult = {
  type: 'success';
  result: FileAnalysis | EvaluateParams;
};

interface StepResult {
  text: string;
  toolCalls: unknown[];
  toolResults: Record<string, ToolResult>;
}

interface MergeRequestSelection {
  project: string;
  mr: GitLabMergeRequest;
  success: boolean;
}

export class CodeReviewAgent extends BaseDevAgent {
  name = 'Code Review';
  description = 'Reviews code changes and provides feedback';
  private reviewOptions: BaseEngineeringOptions;
  private aiService: AIService;
  private gitService: GitService;

  // Add perspective emoji constants at the top of the class definition near other constants
  private perspectiveEmojis = {
    junior: '👶',
    senior: '👨‍💻',
    architect: '🏛️',
    default: '🔍',
  };

  constructor(context: ReviewAgentContext, options: BaseEngineeringOptions) {
    super(context, options);
    this.reviewOptions = options;
    this.aiService = new AIService(this.context.config, {
      model: options.aiModel || (options.analysisDepth === 'deep' ? 'gpt-4' : 'gpt-3.5-turbo'),
      temperature: options.analysisDepth === 'quick' ? 0.7 : 0.3,
    });

    // Initialize the GitService
    this.gitService = new GitService(this.context.config);
  }

  override async execute(_command: string, _args: string[]): Promise<AgentResponse> {
    try {
      // Parse command args
      let showHelp = false;

      // Check if we need to show help
      for (const arg of _args) {
        if (arg === '--help' || arg === '-h') {
          showHelp = true;
          break;
        }
      }

      if (showHelp) {
        return {
          success: true,
          message: this.help(),
        };
      }

      // Initialize aiService as needed
      if (!this.aiService) {
        // If the user has specified a model, use it
        if (this.options.aiModel) {
          this.context.logger.passThrough(
            'log',
            theme.info(`Using AI Model: ${this.options.aiModel}`),
          );
          this.aiService = new AIService(this.context.config, {
            model: this.options.aiModel as string,
            temperature: 0.3,
          });
        } else {
          // Otherwise use default
          this.aiService = new AIService(this.context.config, {
            temperature: 0.3,
          });
        }
      }

      // Parse command arguments
      const options = { ...this.options };
      const pathArgs: string[] = [];

      // Parse command line arguments
      for (let i = 0; i < _args.length; i++) {
        const arg = _args[i];
        if (arg === '--path' && i + 1 < _args.length) {
          // Handle multiple paths separated by commas
          const paths = _args[++i].split(',').map((p) => p.trim());
          options.path = paths;
        } else if (arg === '--depth' && i + 1 < _args.length) {
          options.analysisDepth = _args[++i] as BaseEngineeringOptions['analysisDepth'];
        } else if (arg === '--model' && i + 1 < _args.length) {
          options.aiModel = _args[++i];
        } else if (arg === '--reviewer' && i + 1 < _args.length) {
          // Add support for reviewer option
          const reviewer = _args[++i].toLowerCase();
          // Map shorthand to full perspective names
          options.reviewer = reviewer === 'all' ? 'all' : reviewer;

          // Validate the reviewer value
          if (!['junior', 'senior', 'architect', 'all'].includes(options.reviewer as string)) {
            throw new Error(
              `Invalid reviewer perspective: ${reviewer}. Valid options are junior, senior, architect, or all.`,
            );
          }
        } else if (!arg.startsWith('--')) {
          pathArgs.push(arg);
        }
      }

      // Set default reviewer if not specified
      if (!options.reviewer) {
        options.reviewer = 'senior';
      }

      // If a positional path argument was provided, use it
      if (pathArgs.length > 0) {
        options.path = pathArgs;
      }

      // If no path was provided, check for local git changes
      if (!options.path) {
        this.context.logger.passThrough(
          'log',
          theme.info('No path specified, checking for git changes...'),
        );
        try {
          const changedFiles = await this.getChangedFiles();
          if (changedFiles.length > 0) {
            this.context.logger.passThrough(
              'log',
              theme.success(`Found ${changedFiles.length} changed files in local Git repository`),
            );
            return await this.reviewGitChanges(changedFiles, options);
          } else {
            // If no git changes found, default to current directory
            this.context.logger.passThrough(
              'log',
              theme.warning('No git changes found, defaulting to current directory.'),
            );
            options.path = ['.'];
          }
        } catch (error) {
          this.context.logger.passThrough(
            'log',
            theme.warning(
              `Could not get Git changes: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
          this.context.logger.passThrough('log', theme.info('Defaulting to current directory.'));
          options.path = ['.'];
        }
      }

      // Support both string and array paths
      const paths = Array.isArray(options.path) ? options.path : [options.path];

      // Call function to review multiple paths
      return await this.reviewPaths(paths, options);
    } catch (error) {
      this.context.logger.error(
        `Error in CodeReviewAgent: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        message: `Error in CodeReviewAgent: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * Get list of changed files from Git
   */
  private async getChangedFiles(): Promise<string[]> {
    return await this.gitService.getChangedFiles();
  }

  /**
   * Get Git diff for a specific file
   */
  private async getGitDiff(path: string): Promise<string> {
    try {
      const diffResult = await this.gitService.getFileDiff(path);
      return diffResult.diff;
    } catch (error) {
      this.context.logger.error(
        theme.error(
          `Error getting git diff for ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      // Fall back to reading the entire file
      return await Deno.readTextFile(path);
    }
  }

  /**
   * Review Git changes in the current directory
   */
  private async reviewGitChanges(
    changedFiles: string[],
    options: BaseEngineeringOptions,
  ): Promise<AgentResponse> {
    this.context.logger.passThrough('log', '\n🤖 Starting Git Changes Review');

    // Process all paths
    const analyses: FileAnalysis[] = [];
    let totalFiles = changedFiles.length;
    let processedFiles = 0;

    for (const path of changedFiles) {
      this.context.logger.passThrough('log', theme.info(`\n📂 Processing changes in: ${path}`));

      try {
        // Get the diff for this file
        const diff = await this.getGitDiff(path);

        // Display formatted diff with highlighting
        this.displayFormattedDiff(diff, path);

        // Process as a file with changes
        totalFiles++;
        this.context.logger.passThrough('log', theme.dim(`\n📄 Analyzing changes in: ${path}`));

        // Use the analyzeFileChanges method to analyze the diff
        const analysis = await this.analyzeFileChanges(path, diff, options);
        if (analysis) {
          analyses.push(analysis);
          processedFiles++;
          this.context.logger.passThrough('log', theme.success(`✓ Analysis complete for ${path}`));
        }
      } catch (error) {
        this.context.logger.error(`Error processing path ${path}:`, error);
        this.context.logger.passThrough(
          'log',
          theme.error(
            `❌ Error processing ${path}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    }

    if (analyses.length === 0) {
      return {
        success: false,
        message: 'No files were analyzed. Check file paths and extensions.',
      };
    }

    // Generate synthesis
    this.context.logger.passThrough(
      'log',
      '\n🤔 Phase 2: Synthesizing insights from ' + analyses.length + ' files...',
    );
    this.context.logger.passThrough(
      'log',
      theme.dim('💭 Analyzing patterns across files (attempt 1/3)...'),
    );

    const synthesis = await this.synthesizeReviews(analyses);

    // Create a session object with the file analyses
    const reviewSession: ReviewSession = {
      mr: {
        iid: 0,
        title: 'Local Git Changes Review',
        changes: analyses.map((a) => ({ new_path: a.path, diff: '' })),
      },
      overallReview: {
        fileAnalyses: analyses,
        summary: synthesis.summary,
        score: analyses.reduce((acc, a) => acc + a.score, 0) / analyses.length,
        suggestions: analyses.flatMap((a) => a.suggestions),
        isDraft: false,
      },
      comments: [],
    };

    // Display results
    this.context.logger.passThrough('log', '\n📝 Phase 3: Generating comprehensive review...');
    this.displayReviewSummary(synthesis, {
      ...options,
      fileList: analyses.map((a) => a.path),
      totalFiles: totalFiles,
      processedFiles: processedFiles,
    }, reviewSession);

    return {
      success: true,
      message: 'Analysis of Git changes completed successfully',
      data: {
        analyses,
        synthesis,
      },
    };
  }

  /**
   * Review multiple paths
   */
  private async reviewPaths(
    paths: string[],
    options: BaseEngineeringOptions,
  ): Promise<AgentResponse> {
    try {
      this.context.logger.passThrough('log', '\n🤖 Starting Code Review');

      // Process all paths
      const analyses: FileAnalysis[] = [];
      let totalFiles = 0;
      let processedFiles = 0;

      for (const path of paths) {
        this.context.logger.passThrough('log', theme.info(`\n📂 Processing path: ${path}`));

        try {
          const pathStats = await Deno.stat(path);

          if (pathStats.isFile) {
            // Process single file
            totalFiles++;
            this.context.logger.passThrough('log', theme.dim(`\n📄 Analyzing file: ${path}`));
            const analysis = await this.analyzeFileWithTools(path);
            if (analysis) {
              analyses.push(analysis);
              processedFiles++;
            }
          } else if (pathStats.isDirectory) {
            // Process directory
            const dirAnalyses = await this.processDirectory(path);
            analyses.push(...dirAnalyses.analyses);
            totalFiles += dirAnalyses.totalFiles;
            processedFiles += dirAnalyses.processedFiles;
          } else {
            this.context.logger.passThrough(
              'log',
              theme.warning(`⚠️ Skipping ${path} (not a file or directory)`),
            );
          }
        } catch (error) {
          this.context.logger.error(`Error processing path ${path}:`, error);
          this.context.logger.passThrough(
            'log',
            theme.error(
              `❌ Error processing ${path}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      }

      if (analyses.length === 0) {
        return {
          success: false,
          message: 'No files were analyzed. Check file paths and extensions.',
        };
      }

      // Generate synthesis
      this.context.logger.passThrough(
        'log',
        '\n🤔 Phase 2: Synthesizing insights from ' + analyses.length + ' files...',
      );
      this.context.logger.passThrough(
        'log',
        theme.dim('💭 Analyzing patterns across files (attempt 1/3)...'),
      );

      const synthesis = await this.synthesizeReviews(analyses);

      // Set fileList in options for displayReviewSummary
      options.fileList = analyses.map((a) => a.path);

      // Display results
      this.context.logger.passThrough('log', '\n📝 Phase 3: Generating comprehensive review...');

      // Create a session object with the file analyses
      const reviewSession: ReviewSession = {
        mr: {
          iid: 0,
          title: 'Local Code Review',
          changes: analyses.map((a) => ({ new_path: a.path, diff: '' })),
        },
        overallReview: {
          fileAnalyses: analyses,
          summary: synthesis.summary,
          score: analyses.reduce((acc, a) => acc + a.score, 0) / analyses.length,
          suggestions: analyses.flatMap((a) => a.suggestions),
          isDraft: false,
        },
        comments: [],
      };

      this.displayReviewSummary(synthesis, {
        ...options,
        fileList: analyses.map((a) => a.path),
        totalFiles: totalFiles,
        processedFiles: processedFiles,
      }, reviewSession);

      return {
        success: true,
        message: 'Analysis completed successfully',
        data: {
          analyses,
          synthesis,
        },
      };
    } catch (error) {
      this.context.logger.error('Error reviewing paths:', error);
      return {
        success: false,
        message: `Error reviewing paths: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Process a directory and analyze all valid files
   */
  private async processDirectory(directory: string): Promise<{
    analyses: FileAnalysis[];
    totalFiles: number;
    processedFiles: number;
  }> {
    const analyses: FileAnalysis[] = [];
    let totalFiles = 0;
    let processedFiles = 0;

    // Skip patterns for directories and files
    const skipDirPatterns = [/node_modules/, /\.git/, /dist/, /build/, /\.cache/];
    const validExtensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.vue',
      '.svelte',
      '.py',
      '.rb',
      '.java',
      '.go',
      '.rs',
      '.c',
      '.cpp',
      '.h',
      '.hpp',
      '.cs',
      '.php',
      '.html',
      '.css',
      '.scss',
      '.yaml',
      '.yml',
      '.json',
    ];

    try {
      this.context.logger.passThrough(
        'log',
        theme.dim(`\n📂 Scanning directory ${directory} for reviewable files...`),
      );

      // Recursively walk the directory
      for await (const entry of Deno.readDir(directory)) {
        const entryPath = `${directory}/${entry.name}`;

        if (entry.isDirectory) {
          // Skip directories matching patterns
          if (skipDirPatterns.some((pattern) => pattern.test(entry.name))) {
            continue;
          }

          // Recursively process subdirectory
          const subDirResults = await this.processDirectory(entryPath);
          analyses.push(...subDirResults.analyses);
          totalFiles += subDirResults.totalFiles;
          processedFiles += subDirResults.processedFiles;
        } else if (entry.isFile) {
          // Check file extension
          const ext = entryPath.substring(entryPath.lastIndexOf('.'));
          if (validExtensions.includes(ext)) {
            totalFiles++;
            this.context.logger.passThrough('log', theme.dim(`📄 Analyzing file ${entryPath}...`));

            try {
              const analysis = await this.analyzeFileWithTools(entryPath);
              if (analysis) {
                analyses.push(analysis);
                processedFiles++;
                this.context.logger.passThrough(
                  'log',
                  theme.success(`✓ Analysis complete for ${entryPath}`),
                );
              }
            } catch (error) {
              this.context.logger.error(`Error analyzing file ${entryPath}:`, error);
              this.context.logger.passThrough(
                'log',
                theme.error(
                  `❌ Error analyzing ${entryPath}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                ),
              );
            }
          } else {
            this.context.logger.passThrough(
              'log',
              theme.dim(`Skipping ${entryPath} (unsupported extension)`),
            );
          }
        }
      }

      return { analyses, totalFiles, processedFiles };
    } catch (error) {
      this.context.logger.error(`Error processing directory ${directory}:`, error);
      throw error;
    }
  }

  protected override async analyze(): Promise<AnalysisResponse> {
    try {
      const paths = Array.isArray(this.options.path)
        ? this.options.path
        : (this.options.path ? [this.options.path] : ['.']);

      const analyses: FileAnalysis[] = [];

      for (const path of paths) {
        try {
          const fileInfo = await Deno.stat(path);

          if (fileInfo.isFile) {
            const analysis = await this.analyzeFileWithTools(path);
            if (analysis) {
              analyses.push(analysis);
            }
          } else if (fileInfo.isDirectory) {
            const dirResults = await this.processDirectory(path);
            analyses.push(...dirResults.analyses);
          }
        } catch (error) {
          this.context.logger.error(`Error analyzing path ${path}:`, error);
        }
      }

      if (analyses.length === 0) {
        return {
          success: false,
          message: 'No files were analyzed',
        };
      }

      this.context.logger.passThrough(
        'log',
        theme.dim('\nGenerating synthesis of all analyses...'),
      );
      const synthesis = await this.synthesizeReviews(analyses);

      return {
        success: true,
        message: 'Analysis completed successfully',
        data: {
          analyses,
          synthesis,
        },
      };
    } catch (error) {
      this.context.logger.error('Error during analysis:', error);
      return {
        success: false,
        message: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  protected override async implement(): Promise<ImplementationResponse> {
    try {
      // Don't re-analyze, use the cached analyses if available
      if (!this._lastAnalysis) {
        this._lastAnalysis = await this.analyze();
      }

      const analyses = this._lastAnalysis.data?.analyses;
      if (!analyses?.length) {
        return {
          success: false,
          message: 'No analyses available to implement',
        };
      }

      this.context.logger.passThrough('log', `\n${theme.header('🔍 Implementing Suggestions')}`);

      // Group critical issues by file
      const criticalIssues = analyses.flatMap((analysis) =>
        analysis.issues
          .filter((issue) => issue.severity === 'high')
          .map((issue) => ({
            file: analysis.path,
            ...issue,
          }))
      );

      if (criticalIssues.length > 0) {
        return {
          success: true,
          message: 'Critical issues identified',
          data: {
            criticalIssues,
            autoFixed: [],
          },
        };
      }

      return {
        success: true,
        message: 'No critical issues to implement',
        data: {
          criticalIssues: [],
          autoFixed: [],
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to implement suggestions: ${errorMessage}`,
      };
    }
  }

  protected override async validate(): Promise<ValidationResponse> {
    try {
      // Don't re-implement, use the cached implementation if available
      if (!this._lastImplementation) {
        this._lastImplementation = await this.implement();
      }

      const implementation = this._lastImplementation.data;
      if (!implementation) {
        return {
          success: false,
          message: 'No implementation data to validate',
        };
      }

      this.context.logger.passThrough('log', `\n${theme.header('✓ Validating Changes')}`);

      // If we auto-fixed any issues, validate the changes
      if (implementation.autoFixed?.length > 0) {
        return {
          success: true,
          message: 'Changes validated',
          data: {
            validatedFiles: implementation.autoFixed,
            testResults: null,
          },
        };
      }

      return {
        success: true,
        message: 'No changes to validate',
        data: {
          validatedFiles: [],
          testResults: null,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to validate changes: ${errorMessage}`,
      };
    }
  }

  // Add properties to cache results
  private _lastAnalysis?: AnalysisResponse;
  private _lastImplementation?: ImplementationResponse;

  override help(): string {
    return `
${theme.header('Code Review Agent Help')}

Commands:
  review [path]                 Review code in files or directories

Options:
  --path <path>                 Path to analyze (file or directory)
  --depth <level>               Analysis depth (quick|normal|deep) [default: normal]
  --reviewer <perspective>      Perspective to review from (junior|senior|architect|all) [default: senior]
  --model <model>               Specify AI model to use (default depends on depth)

Examples:
  # Review a specific file or directory with default settings
  nova agent eng review --path src/
  
  # Review specific files with different perspectives
  nova agent eng review --path file.ts --reviewer junior
  nova agent eng review --path file.ts --reviewer architect
  
  # Get comprehensive review from all perspectives
  nova agent eng review --path file.ts --reviewer all --depth=deep
  
  # Review Git changes in current directory
  nova agent eng review
`;
  }

  private defaultSystemPrompt =
    `You are a code review assistant. Your task is to analyze code and provide structured feedback.

Your response must be a single valid JSON object with EXACTLY this structure:
{
  "path": "string (path to the file being analyzed)",
  "issues": [{
    "severity": "high|medium|low",
    "message": "concise description of the issue",
    "explanation": "detailed explanation of why this is an issue",
    "suggestion": "specific suggestion for how to fix the issue"
  }],
  "suggestions": ["string", "string", ...],
  "score": number (1-10),
  "summary": "brief summary of the analysis",
  "learningOpportunities": ["string", "string", ...]
}

Focus on:
1. Code quality and maintainability
2. Best practices and patterns
3. Security concerns
4. Performance implications
5. Error handling and edge cases

Provide clear, actionable feedback that helps improve the code.
Your response must be ONLY the JSON object, with no additional text before or after.`;

  private async analyzeFileWithTools(filePath: string): Promise<FileAnalysis | null> {
    try {
      // Show thinking process
      this.context.logger.passThrough('log', theme.dim('🧐 Reading and understanding the code...'));
      await new Promise((resolve) => setTimeout(resolve, 500));

      this.context.logger.passThrough(
        'log',
        theme.dim('💭 Analyzing code structure and patterns...'),
      );

      // Get the reviewer perspective from options
      const perspective = this.options.reviewer || 'senior';

      try {
        let analysis: FileAnalysis;

        // If "all" is specified, analyze with all perspectives and merge results
        if (perspective === 'all') {
          this.context.logger.passThrough(
            'log',
            theme.info('Analyzing from multiple perspectives...'),
          );

          // Analyze from each perspective
          const juniorAnalysis = await this.analyzeFileWithPerspective(filePath, 'junior');
          this.context.logger.passThrough(
            'log',
            theme.success('✓ Junior engineer perspective complete'),
          );

          const seniorAnalysis = await this.analyzeFileWithPerspective(filePath, 'senior');
          this.context.logger.passThrough(
            'log',
            theme.success('✓ Senior engineer perspective complete'),
          );

          const architectAnalysis = await this.analyzeFileWithPerspective(filePath, 'architect');
          this.context.logger.passThrough('log', theme.success('✓ Architect perspective complete'));

          // Combine the issues, suggestions and learning opportunities
          // but add perspective markers to distinguish the source
          const allIssues = [
            ...juniorAnalysis.issues.map((issue) => ({ ...issue, perspective: 'junior' as const })),
            ...seniorAnalysis.issues.map((issue) => ({ ...issue, perspective: 'senior' as const })),
            ...architectAnalysis.issues.map((issue) => ({
              ...issue,
              perspective: 'architect' as const,
            })),
          ];

          // Combine unique suggestions and learning opportunities
          const uniqueSuggestions = [
            ...new Set([
              ...juniorAnalysis.suggestions,
              ...seniorAnalysis.suggestions,
              ...architectAnalysis.suggestions,
            ]),
          ];

          const uniqueLearningOpps = [
            ...new Set([
              ...juniorAnalysis.learningOpportunities,
              ...seniorAnalysis.learningOpportunities,
              ...architectAnalysis.learningOpportunities,
            ]),
          ];

          // Average the scores
          const avgScore = Math.round(
            (juniorAnalysis.score + seniorAnalysis.score + architectAnalysis.score) / 3 * 10,
          ) / 10;

          // Create a combined analysis
          analysis = {
            path: filePath,
            issues: allIssues,
            suggestions: uniqueSuggestions,
            score: avgScore,
            summary: `Multi-perspective analysis of ${filePath}`,
            learningOpportunities: uniqueLearningOpps,
          };

          this.context.logger.passThrough('log', theme.success('✓ Combined analysis complete\n'));
        } else {
          // Analyze with a single perspective
          this.context.logger.passThrough(
            'log',
            theme.info(`Analyzing from ${perspective} perspective...`),
          );
          analysis = await this.analyzeFileWithPerspective(filePath, perspective as string);
          this.context.logger.passThrough('log', theme.success('✓ Analysis complete\n'));
        }

        // Ensure the file path is correctly set and all properties are present
        return {
          path: filePath,
          issues: analysis.issues || [],
          suggestions: analysis.suggestions || [],
          score: analysis.score,
          summary: analysis.summary || `Analysis of ${filePath}`,
          learningOpportunities: analysis.learningOpportunities || [],
        };
      } catch (error) {
        this.context.logger.error(
          `Error generating analysis: ${error instanceof Error ? error.message : String(error)}`,
        );

        // Return a basic analysis on error to avoid null
        return {
          path: filePath,
          issues: [],
          suggestions: [`Could not fully analyze ${filePath}`],
          score: 5,
          summary: `Error analyzing ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          learningOpportunities: [],
        };
      }
    } catch (error) {
      this.context.logger.error(
        theme.error(
          `Failed to analyze ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      return null;
    }
  }

  private async analyzeFileWithPerspective(
    filePath: string,
    perspective: string,
    focusAreas: string[] = [],
  ): Promise<FileAnalysis> {
    const content = await this.getFileContent(filePath);
    const systemPrompt = this.getPerspectiveSystemPrompt(perspective);
    const analysisPrompt = this.getPerspectiveAnalysisPrompt(perspective, focusAreas);

    // Build a more structured and explicit prompt to guide the response format
    const messageContent = `
Content to analyze:
\`\`\`
${content}
\`\`\`

${analysisPrompt}

IMPORTANT: Your response MUST be a valid JSON object with these fields:
- path: string - "${filePath}"
- issues: array of objects, each with:
  - severity: must be one of exactly "high", "medium", or "low" (lowercase)
  - message: string - clear description of the issue
  - explanation: string - detailed explanation
  - suggestion: string - specific suggestion to fix
  - line: number or string - line number if applicable (use a number when possible, or descriptive text like "various" if it applies to multiple lines)
  - code: string (optional) - relevant code snippet
- suggestions: array of strings with actionable suggestions
- score: number between 1-10
- summary: string with overall assessment
- learningOpportunities: array of strings with learning insights

CRITICAL: All severity values MUST be lowercase "high", "medium", or "low" - not "High", "Medium", or "Low".
For line numbers, prefer using numeric values (e.g., 42) when referring to a specific line. 
Only use descriptive text for line numbers (e.g., "multiple", "various") when an issue spans multiple non-contiguous lines.
`;

    try {
      let analysis: FileAnalysis;

      // Check if provider supports structured outputs
      if (this.aiService.provider === 'ollama') {
        // For Ollama: Use plain text generation + manual parsing
        analysis = await this.analyzeWithOllama(
          filePath,
          perspective,
          content,
          systemPrompt,
          analysisPrompt,
        );
      } else {
        // For providers with structured output support (OpenAI, Azure, Nova)
        const { result } = await this.aiService.generateWithTools({
          model: this.aiService.languageModel, // Use the actual language model instance
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: messageContent },
          ],
          schema: FileAnalysisSchema,
          maxSteps: 5,
        });
        analysis = result as FileAnalysis;
      }

      return analysis;
    } catch (error) {
      this.context.logger.error(
        `Error generating analysis: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Provide a fallback minimal analysis on error
      return {
        path: filePath,
        issues: [],
        suggestions: [
          `Could not fully analyze ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        score: 5,
        summary: `Error analyzing ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        learningOpportunities: [],
      };
    }
  }

  /**
   * Analyze file with Ollama provider using text generation and manual JSON parsing
   */
  private async analyzeWithOllama(
    filePath: string,
    perspective: string,
    content: string,
    systemPrompt: string,
    analysisPrompt: string,
  ): Promise<FileAnalysis> {
    const ollamaPrompt = `${systemPrompt}

${analysisPrompt}

Content to analyze:
\`\`\`
${content}
\`\`\`

CRITICAL: You MUST respond with a valid JSON object that has EXACTLY these fields:
{
  "path": "${filePath}",
  "issues": [
    {
      "severity": "high|medium|low",
      "message": "clear description",
      "explanation": "detailed explanation", 
      "suggestion": "specific fix suggestion",
      "line": 42
    }
  ],
  "suggestions": ["suggestion 1", "suggestion 2"],
  "score": 7,
  "summary": "brief summary text",
  "learningOpportunities": ["learning point 1", "learning point 2"]
}

Respond ONLY with valid JSON - no other text before or after. All severity values must be lowercase ("high", "medium", or "low").`;

    try {
      this.context.logger.passThrough(
        'log',
        theme.dim(`Analyzing with Ollama (${perspective} perspective)...`),
      );

      const result = await this.aiService.generateText('', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: ollamaPrompt },
        ],
      });

      // Try to extract and parse JSON from response
      const responseText = result.text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      // Clean up the JSON string
      let jsonStr = jsonMatch[0];

      // Remove any trailing content after the closing brace
      const lastBraceIndex = jsonStr.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        jsonStr = jsonStr.substring(0, lastBraceIndex + 1);
      }

      const parsed = JSON.parse(jsonStr);

      // Validate and repair the parsed data
      const repairedAnalysis = this.validateAndRepairAnalysis(parsed, filePath);

      // Validate against schema for final check
      const validatedAnalysis = FileAnalysisSchema.parse(repairedAnalysis);

      return validatedAnalysis;
    } catch (parseError) {
      this.context.logger.error(`Ollama analysis parsing failed: ${parseError}`);

      // Return fallback if parsing fails
      return {
        path: filePath,
        issues: [],
        suggestions: [
          `Analysis failed for ${filePath}: ${
            parseError instanceof Error ? parseError.message : String(parseError)
          }`,
        ],
        score: 5,
        summary: `Could not parse analysis for ${filePath}`,
        learningOpportunities: [`Consider reviewing the file manually due to parsing issues`],
      };
    }
  }

  /**
   * Validate and repair analysis data from Ollama to ensure it matches the schema
   */
  private validateAndRepairAnalysis(data: any, filePath: string): FileAnalysis {
    const repairedData: FileAnalysis = {
      path: typeof data.path === 'string' ? data.path : filePath,
      issues: Array.isArray(data.issues)
        ? data.issues.map((issue: any) => ({
          severity: ['high', 'medium', 'low'].includes(issue.severity?.toLowerCase())
            ? issue.severity.toLowerCase()
            : 'medium',
          message: typeof issue.message === 'string' ? issue.message : 'Issue found',
          explanation: typeof issue.explanation === 'string'
            ? issue.explanation
            : issue.message || 'No explanation provided',
          suggestion: typeof issue.suggestion === 'string'
            ? issue.suggestion
            : 'Review and fix as needed',
          line: issue.line !== undefined ? issue.line : undefined,
          column: issue.column !== undefined ? issue.column : undefined,
          code: typeof issue.code === 'string' ? issue.code : undefined,
          perspective: issue.perspective || undefined,
        }))
        : [],
      suggestions: Array.isArray(data.suggestions)
        ? data.suggestions.filter((s: any) => typeof s === 'string')
        : ['Review the code for potential improvements'],
      score: typeof data.score === 'number' && data.score >= 1 && data.score <= 10 ? data.score : 5,
      summary: typeof data.summary === 'string' ? data.summary : `Analysis of ${filePath}`,
      learningOpportunities: Array.isArray(data.learningOpportunities)
        ? data.learningOpportunities.filter((lo: any) => typeof lo === 'string')
        : [],
    };

    return repairedData;
  }

  private getPerspectiveSystemPrompt(perspective: string): string {
    const basePrompt = this.defaultSystemPrompt;

    switch (perspective) {
      case 'junior':
        return `${basePrompt}\n\nYou are a junior engineer focusing on:
1. Code readability and documentation
2. Basic coding patterns and practices
3. Learning opportunities
4. Questions to ask senior engineers`;

      case 'senior':
        return `${basePrompt}\n\nYou are a senior engineer focusing on:
1. Code architecture and design patterns
2. Performance implications
3. Error handling and edge cases
4. Security considerations
5. Scalability concerns`;

      case 'architect':
        return `${basePrompt}\n\nYou are a software architect focusing on:
1. System design and architecture
2. Integration patterns
3. Technical debt
4. Long-term maintainability
5. Cross-cutting concerns`;

      default:
        return basePrompt;
    }
  }

  private getPerspectiveAnalysisPrompt(perspective: string, focusAreas: string[] = []): string {
    const basePrompt = `Please analyze this code file and provide:
1. A list of issues found (with severity, explanation, and suggestions)
2. Code quality metrics
3. A brief summary of the file
4. Specific recommendations for improvement`;

    const focusPrompt = focusAreas.length > 0
      ? `\n\nPay special attention to:\n${focusAreas.map((area) => `- ${area}`).join('\n')}`
      : '';

    switch (perspective) {
      case 'junior':
        return `${basePrompt}\n\nAs a junior engineer, focus on:
- Code clarity and readability
- Documentation completeness
- Basic coding patterns
- Learning opportunities
- Questions you would ask senior engineers`;

      case 'senior':
        return `${basePrompt}\n\nAs a senior engineer, focus on:
- Architecture and design patterns
- Performance optimization opportunities
- Error handling completeness
- Security considerations
- Scalability concerns`;

      case 'architect':
        return `${basePrompt}\n\nAs a software architect, focus on:
- System design implications
- Integration patterns
- Technical debt indicators
- Long-term maintainability
- Cross-cutting concerns`;

      default:
        return basePrompt + focusPrompt;
    }
  }

  // Make synthesizeReviews public for MergeRequestReviewAgent to use
  public async synthesizeReviews(analyses: FileAnalysis[]): Promise<ReviewSynthesis> {
    try {
      // Implementation moved from private method
      this.context.logger.passThrough('log', theme.dim('💭 Generating comprehensive review...'));

      // Skip AI synthesis if there are no analyses
      if (!analyses || analyses.length === 0) {
        return {
          summary: 'No files were analyzed.',
          consensus: [],
          differences: [],
          actionItems: [],
          learningOpportunities: [],
        };
      }

      // Basic data extraction from analyses for fallback
      const totalIssues = analyses.reduce(
        (sum, analysis) => sum + (analysis.issues?.length || 0),
        0,
      );
      const highIssuesCount = analyses.reduce(
        (sum, analysis) =>
          sum + (analysis.issues?.filter((i) => i.severity === 'high')?.length || 0),
        0,
      );
      const mediumIssuesCount = analyses.reduce(
        (sum, analysis) =>
          sum + (analysis.issues?.filter((i) => i.severity === 'medium')?.length || 0),
        0,
      );
      const lowIssuesCount = analyses.reduce(
        (sum, analysis) =>
          sum + (analysis.issues?.filter((i) => i.severity === 'low')?.length || 0),
        0,
      );

      const _allSuggestions = analyses.flatMap((a) => a.suggestions || []);
      const allLearningOpportunities = analyses.flatMap((a) => a.learningOpportunities || []);

      // Create basic fallback summary
      const fallbackSummary = totalIssues > 0
        ? `Analysis found ${totalIssues} issues (${highIssuesCount} high, ${mediumIssuesCount} medium, ${lowIssuesCount} low) across ${analyses.length} files. Average score: ${
          (analyses.reduce((sum, a) => sum + (a.score || 0), 0) / analyses.length).toFixed(1)
        }.`
        : `Analyzed ${analyses.length} files with no issues detected.`;

      const systemPrompt = `You are a technical lead reviewing code changes. 
      Based on the provided file analyses, create a comprehensive synthesis of the review.
      Your synthesis should include:
      1. A concise summary of the key findings across all files
      2. Areas of consensus between different perspectives
      3. Noteworthy differences in perspectives
      4. Prioritized action items with rationales
      5. Learning opportunities for the team`;

      // Make sure we include all necessary data for synthesis
      const analysesJson = analyses.map((a) => ({
        path: a.path,
        summary: a.summary,
        issues: a.issues || [],
        score: a.score,
        suggestions: a.suggestions || [],
        learningOpportunities: a.learningOpportunities || [],
      }));

      this.context.logger.passThrough(
        'log',
        theme.dim(`Processing ${analyses.length} file analyses for synthesis`),
      );

      // Generate the synthesis using the AI service
      const finalPrompt = `Review these file analyses and provide a comprehensive synthesis:\n${
        JSON.stringify(analysesJson, null, 2)
      }`;

      // Generate the synthesis using the AI service
      let synthesis: ReviewSynthesis;
      try {
        synthesis = await this.aiService.generateStructuredAnalysis(
          finalPrompt,
          ReviewSynthesisSchema,
          systemPrompt,
          'Synthesize these file analyses into a comprehensive review, highlighting patterns, consensus, differences, and prioritized recommendations.',
        );
        this.context.logger.passThrough('log', theme.success('✓ Review synthesis complete'));
      } catch (aiError) {
        this.context.logger.error(
          `Error in AI synthesis: ${aiError instanceof Error ? aiError.message : String(aiError)}`,
        );
        // Create fallback synthesis
        synthesis = {
          summary: fallbackSummary,
          consensus: [],
          differences: [],
          actionItems: [],
          learningOpportunities: allLearningOpportunities.slice(0, 5), // Take top 5
        };
      }

      // Make sure synthesis has all required fields with valid data
      synthesis.summary = synthesis.summary || fallbackSummary;
      synthesis.consensus = synthesis.consensus || [];
      synthesis.differences = synthesis.differences || [];
      synthesis.actionItems = synthesis.actionItems || [];
      synthesis.learningOpportunities = synthesis.learningOpportunities || [];

      // If AI didn't generate learning opportunities but we have some from the analyses, use those
      if (synthesis.learningOpportunities.length === 0 && allLearningOpportunities.length > 0) {
        synthesis.learningOpportunities = [...new Set(allLearningOpportunities)].slice(0, 5);
      }

      // If synthesis is incomplete, generate basic action items based on highest severity issues
      if (!synthesis.actionItems || synthesis.actionItems.length === 0) {
        this.context.logger.passThrough('log', theme.dim('Generating action items from issues...'));

        // Collect all high and medium severity issues
        const highIssues = analyses.flatMap((a) =>
          (a.issues || []).filter((i) => i.severity === 'high')
            .map((i) => ({ file: a.path, ...i }))
        );

        const mediumIssues = analyses.flatMap((a) =>
          (a.issues || []).filter((i) => i.severity === 'medium')
            .map((i) => ({ file: a.path, ...i }))
        );

        // Create action items from high and medium issues
        const actionItems = [
          ...highIssues.map((issue) => ({
            priority: 'high' as const,
            description: `Fix ${issue.message} in ${issue.file}`,
            rationale: issue.explanation ||
              `This is a high severity issue that needs immediate attention`,
          })),
          ...mediumIssues.map((issue) => ({
            priority: 'medium' as const,
            description: `Address ${issue.message} in ${issue.file}`,
            rationale: issue.explanation ||
              `This is a medium severity issue that should be fixed soon`,
          })),
        ];

        if (actionItems.length > 0) {
          synthesis.actionItems = actionItems;
        }
      }

      return synthesis;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`Error synthesizing reviews: ${errorMessage}`);

      // Return a basic synthesis on error - extract data directly from analyses
      const fallbackSummary = analyses && analyses.length > 0
        ? `Analysis found ${
          analyses.reduce((sum, a) => sum + (a.issues?.length || 0), 0)
        } issues across ${analyses.length} files.`
        : 'Error generating review summary.';

      const actionItems = analyses?.flatMap((a) =>
        (a.issues || [])
          .filter((i) => i.severity === 'high' || i.severity === 'medium')
          .map((i) => ({
            priority: i.severity === 'high' ? 'high' as const : 'medium' as const,
            description: `Fix ${i.message} in ${a.path}`,
            rationale: i.explanation || `This is a ${i.severity} severity issue.`,
          }))
      ) || [];

      return {
        summary: fallbackSummary,
        consensus: [],
        differences: [],
        actionItems: actionItems,
        learningOpportunities: analyses?.flatMap((a) =>
          a.learningOpportunities || []
        ).slice(0, 5) || [],
      };
    }
  }

  public displayReviewSummary(
    synthesis: ReviewSynthesis,
    options?: BaseEngineeringOptions,
    session?: ReviewSession,
  ): void {
    try {
      // Create a nicely formatted table for output
      const table = new Table();

      // Debug info
      this.context.logger.debug(`Debug info for Review Summary:
Has synthesis: ${!!synthesis}
Has options: ${!!options}
Has session: ${!!session}
Has fileAnalyses: ${!!(session?.overallReview?.fileAnalyses)}
FileAnalyses length: ${session?.overallReview?.fileAnalyses?.length || 0}`);

      if (!synthesis) {
        this.context.logger.passThrough('log', theme.error('No review synthesis available'));
        return;
      }

      table.border(true);
      table.padding(2);

      // Add header section
      table.push([theme.header('📊 Code Review Summary')]);

      // Add key findings section
      table.push([theme.header('📝 Key Findings')]);
      const summaryLines = synthesis.summary.split('. ');
      for (const line of summaryLines) {
        if (line.trim() !== '') {
          table.push([line.trim() + '.']);
        }
      }

      // Add Areas of Consensus
      if (synthesis.consensus && synthesis.consensus.length > 0) {
        table.push([theme.header('🤝 Areas of Consensus')]);
        for (const consensus of synthesis.consensus) {
          table.push([`• ${consensus}`]);
        }
      }

      // Add Different Perspectives section
      if (synthesis.differences && synthesis.differences.length > 0) {
        table.push([theme.header('🔄 Different Perspectives')]);
        for (const diff of synthesis.differences) {
          table.push([`• ${diff}`]);
        }
      }

      // Add Action Items section
      if (synthesis.actionItems && synthesis.actionItems.length > 0) {
        table.push([theme.header('📋 Action Items')]);

        // Group action items by priority
        const highPriority = synthesis.actionItems.filter((item) => item.priority === 'high');
        const mediumPriority = synthesis.actionItems.filter((item) => item.priority === 'medium');
        const lowPriority = synthesis.actionItems.filter((item) => item.priority === 'low');

        // Display high priority action items
        if (highPriority.length > 0) {
          table.push([theme.error(`🔴 High Priority (${highPriority.length})`)]);
          for (const item of highPriority) {
            table.push([`• ${item.description}`]);
            table.push([`  Rationale: ${item.rationale}`]);
          }
        }

        // Display medium priority action items
        if (mediumPriority.length > 0) {
          table.push([theme.warning(`🟠 Medium Priority (${mediumPriority.length})`)]);
          for (const item of mediumPriority) {
            table.push([`• ${item.description}`]);
            table.push([`  Rationale: ${item.rationale}`]);
          }
        }

        // Display low priority action items
        if (lowPriority.length > 0) {
          table.push([theme.info(`🟡 Low Priority (${lowPriority.length})`)]);
          for (const item of lowPriority) {
            table.push([`• ${item.description}`]);
            table.push([`  Rationale: ${item.rationale}`]);
          }
        }
      }

      // Add Learning Opportunities section
      if (synthesis.learningOpportunities && synthesis.learningOpportunities.length > 0) {
        table.push([theme.header('📚 Learning Opportunities')]);
        for (const opportunity of synthesis.learningOpportunities) {
          table.push([`• ${opportunity}`]);
        }
      }

      // Add Recommended Next Steps section
      if (synthesis.actionItems && synthesis.actionItems.length > 0) {
        table.push([theme.header('🔜 Recommended Next Steps')]);
        synthesis.actionItems
          .sort((a, b) => {
            const priorityMap = { high: 0, medium: 1, low: 2 };
            return priorityMap[a.priority] - priorityMap[b.priority];
          })
          .forEach((item, index) => {
            table.push([`${index + 1}. ${item.description}`]);
          });
      }

      // Add statistics section
      table.push([theme.header('📊 Review Statistics')]);

      // Check if we have file analyses
      const fileAnalyses = session?.overallReview?.fileAnalyses || [];

      // Debug statistics section info
      this.context.logger.debug(`Debug info for statistics section:
options.paths: ${options?.paths}
options.path: ${options?.path}
options.analysisDepth: ${options?.analysisDepth}
session.mr.changes length: ${session?.mr?.changes?.length}`);

      // Add general statistics
      const totalFiles = fileAnalyses.length;
      const filesWithIssues = fileAnalyses.filter((file) => file.issues.length > 0).length;
      const totalIssues = fileAnalyses.reduce((sum, file) => sum + file.issues.length, 0);

      // Count issues by severity
      const highIssues = fileAnalyses.reduce(
        (sum, file) => sum + file.issues.filter((i) => i.severity === 'high').length,
        0,
      );
      const mediumIssues = fileAnalyses.reduce(
        (sum, file) => sum + file.issues.filter((i) => i.severity === 'medium').length,
        0,
      );
      const lowIssues = fileAnalyses.reduce(
        (sum, file) => sum + file.issues.filter((i) => i.severity === 'low').length,
        0,
      );

      // Calculate average, highest, and lowest scores
      let avgScore = 0;
      let highestScore = 0;
      let lowestScore = 10;

      if (totalFiles > 0) {
        avgScore = fileAnalyses.reduce((sum, file) => sum + file.score, 0) / totalFiles;
        highestScore = Math.max(...fileAnalyses.map((file) => file.score));
        lowestScore = Math.min(...fileAnalyses.map((file) => file.score));
      } else if (session?.overallReview?.score) {
        avgScore = session.overallReview.score;
        highestScore = session.overallReview.score;
        lowestScore = session.overallReview.score;
      }

      table.push([`• Total files analyzed: ${totalFiles}`]);
      table.push([
        `• Files with issues: ${filesWithIssues} (${
          Math.round(filesWithIssues / totalFiles * 100)
        }%)`,
      ]);
      table.push([`• Total issues: ${totalIssues}`]);

      if (totalIssues > 0) {
        table.push([`  - 🔴 High: ${highIssues} (${Math.round(highIssues / totalIssues * 100)}%)`]);
        table.push([
          `  - 🟠 Medium: ${mediumIssues} (${Math.round(mediumIssues / totalIssues * 100)}%)`,
        ]);
        table.push([`  - 🟡 Low: ${lowIssues} (${Math.round(lowIssues / totalIssues * 100)}%)`]);
      }

      table.push([`• Code quality scores:`]);
      table.push([`  - Average: ${avgScore.toFixed(1)}/10`]);
      table.push([`  - Highest: ${highestScore.toFixed(1)}/10`]);
      table.push([`  - Lowest: ${lowestScore.toFixed(1)}/10`]);

      // Add paths or query info
      if (options?.path) {
        if (Array.isArray(options.path)) {
          if (options.path.length === 1) {
            table.push([`• Path: ${options.path[0]}`]);
          } else {
            table.push([`• Paths: ${options.path.join(', ')}`]);
          }
        } else {
          table.push([`• Path: ${options.path}`]);
        }
      }

      // Add analysis depth
      if (options?.analysisDepth) {
        table.push([`• Analysis depth: ${options.analysisDepth}`]);
      }

      // Add reviewer perspective if available
      if (options?.reviewer) {
        const showAllPerspectives = options.reviewer === 'all';

        if (showAllPerspectives) {
          table.push([theme.header('👀 Reviewer Perspectives')]);
          table.push([
            `${this.perspectiveEmojis.junior} Junior Engineer: Readability, documentation, learning opportunities`,
          ]);
          table.push([
            `${this.perspectiveEmojis.senior} Senior Engineer: Architecture, performance, security, error handling`,
          ]);
          table.push([
            `${this.perspectiveEmojis.architect} Architect: System design, technical debt, maintainability`,
          ]);
        } else {
          const displayName = options.reviewer === 'junior'
            ? 'Junior Engineer'
            : options.reviewer === 'senior'
            ? 'Senior Engineer'
            : options.reviewer === 'architect'
            ? 'Architect'
            : options.reviewer;

          const perspectiveEmojis = this.perspectiveEmojis;
          const emoji = perspectiveEmojis[options.reviewer as keyof typeof perspectiveEmojis] || '';
          table.push([`• Reviewer: ${emoji} ${displayName}`]);
        }
      }

      // Display the table
      this.context.logger.passThrough('log', table.toString());

      // Display files with issues
      if (filesWithIssues > 0) {
        this.context.logger.passThrough('log', theme.info('\nℹ️ Files with issues:'));
        for (const file of fileAnalyses) {
          if (file.issues.length > 0) {
            const highCount = file.issues.filter((i) => i.severity === 'high').length;
            const mediumCount = file.issues.filter((i) => i.severity === 'medium').length;
            const lowCount = file.issues.filter((i) => i.severity === 'low').length;

            this.context.logger.passThrough(
              'log',
              `• ${file.path} - ${file.issues.length} issues (🔴 ${highCount} | 🟠 ${mediumCount} | 🟡 ${lowCount}) - Score: ${
                file.score.toFixed(1)
              }/10`,
            );
          }
        }
      }

      // Confirmation message
      this.context.logger.passThrough(
        'log',
        theme.success('\n✅ Enhanced review summary with detailed statistics and file information'),
      );
    } catch (error) {
      this.context.logger.error(
        `Error displaying review summary: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Fetches the content of a file from the local filesystem or GitLab repository
   * @param filePath The path of the file to fetch
   * @param ref The branch or commit reference to fetch from (defaults to the current MR head)
   * @returns The content of the file as a string
   */
  protected override async getFileContent(filePath: string, ref?: string): Promise<string> {
    try {
      // First try to read file from the local filesystem
      try {
        return await Deno.readTextFile(filePath);
      } catch (localError) {
        // If local read fails, try GitLab
        this.context.logger.debug(
          `Could not read local file ${filePath}, trying GitLab: ${localError}`,
        );
      }

      // Try to extract project path and MR from context
      const projectPath = this.context.projectPath;

      if (!projectPath) {
        throw new Error('Project path not available for remote file access');
      }

      // Fetch the file content from GitLab
      if (!this.context.gitlab) {
        throw new Error('GitLab service not available');
      }

      // Get it from the GitLab API
      const rawFilePath = encodeURIComponent(filePath);
      const rawProjectPath = encodeURIComponent(projectPath);
      const rawRef = encodeURIComponent(ref || 'HEAD');

      const content = await this.context.gitlab.getRawFile(
        rawProjectPath,
        rawFilePath,
        rawRef,
      );

      if (content) {
        return content;
      } else {
        throw new Error(`Failed to fetch file content from GitLab repository`);
      }
    } catch (error) {
      this.context.logger.error(theme.error(`Error fetching file content: ${error}`));
      throw new Error(`Could not fetch file content for ${filePath}: ${error}`);
    }
  }

  /**
   * Formats and displays a file diff in a readable way with syntax highlighting
   * @param diff The diff content to display
   * @param filePath The path of the file for context
   */
  private displayFormattedDiff(diff: string, filePath: string): void {
    this.context.logger.passThrough('log', theme.header(`\n📄 Changes in: ${filePath}`));

    const diffLines = diff.split('\n');
    const table = new Table();

    // Set up table styling
    table.border(true);
    table.header(['Old', 'New', 'Change']);
    table.align('left');
    table.padding(1);

    let inHunk = false;
    let lineNumberOld = 0;
    let lineNumberNew = 0;

    // Process the diff for display
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];

      // Handle hunk headers (e.g., @@ -10,7 +10,6 @@)
      if (line.startsWith('@@')) {
        inHunk = true;
        const match = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
        if (match) {
          lineNumberOld = parseInt(match[1], 10);
          lineNumberNew = parseInt(match[2], 10);
        }

        // Display the section header
        table.push(['', '', theme.dim(line)]);
        continue;
      }

      if (!inHunk) continue;

      // Process other lines in the diff
      if (line.startsWith('+')) {
        // Added line
        table.push(['', lineNumberNew.toString(), theme.success(line)]);
        lineNumberNew++;
      } else if (line.startsWith('-')) {
        // Removed line
        table.push([lineNumberOld.toString(), '', theme.error(line)]);
        lineNumberOld++;
      } else if (line.startsWith(' ')) {
        // Context line
        table.push([lineNumberOld.toString(), lineNumberNew.toString(), theme.dim(line)]);
        lineNumberOld++;
        lineNumberNew++;
      }
    }

    // Display the formatted diff
    this.context.logger.passThrough('log', '\n' + table.toString());
  }

  /**
   * Format the review output for display or for GitLab comment
   */
  public formatReviewOutput(data: { reviews: FileAnalysis[] }): string {
    return this._formatReviewOutput(data);
  }

  private _formatReviewOutput(data: { reviews: FileAnalysis[] }): string {
    try {
      const output: string[] = [];
      output.push('# Code Review Results\n');

      // Summary section
      output.push('## Summary\n');
      output.push(`Analyzed ${data.reviews.length} files.\n`);

      // Count total issues by severity
      const totalIssues = {
        high: 0,
        medium: 0,
        low: 0,
      };

      // Track if we have any perspective information
      let hasPerspectives = false;

      data.reviews.forEach((review) => {
        review.issues.forEach((issue) => {
          totalIssues[issue.severity]++;
          if (issue.perspective) hasPerspectives = true;
        });
      });

      const totalCount = totalIssues.high + totalIssues.medium + totalIssues.low;

      // Add issue count summary
      if (totalCount > 0) {
        output.push(
          `Found ${totalCount} issues (🔴 ${totalIssues.high} high, 🟠 ${totalIssues.medium} medium, 🟡 ${totalIssues.low} low)\n`,
        );
      } else {
        output.push('No issues found! 🎉\n');
      }

      // Add perspective legend if needed
      if (hasPerspectives) {
        output.push('### Reviewer Perspectives\n');
        output.push(
          `- ${this.perspectiveEmojis.junior} **Junior Engineer**: Focuses on readability, documentation, and learning opportunities\n`,
        );
        output.push(
          `- ${this.perspectiveEmojis.senior} **Senior Engineer**: Focuses on architecture, performance, security, and error handling\n`,
        );
        output.push(
          `- ${this.perspectiveEmojis.architect} **Architect**: Focuses on system design, technical debt, and long-term maintainability\n\n`,
        );
      }

      // Issues by file
      output.push('## Issues by File\n');

      // Collect all issues for summary table
      const allIssues: Array<{
        file: string;
        severity: string;
        message: string;
        line?: number | string;
        suggestion?: string;
        explanation?: string;
        code?: string;
        perspective?: string;
      }> = [];

      for (const review of data.reviews) {
        output.push(`### ${review.path}\n`);

        if (review.issues.length === 0) {
          output.push('✅ No issues found in this file.\n');
          continue;
        }

        // Collect issues for the summary table
        review.issues.forEach((issue) => {
          allIssues.push({
            file: review.path,
            severity: issue.severity,
            message: issue.message,
            line: issue.line,
            suggestion: issue.suggestion,
            explanation: issue.explanation,
            code: issue.code,
            perspective: issue.perspective,
          });
        });

        // Group issues by severity
        const highIssues = review.issues.filter((issue) => issue.severity === 'high');
        const mediumIssues = review.issues.filter((issue) => issue.severity === 'medium');
        const lowIssues = review.issues.filter((issue) => issue.severity === 'low');

        // Format issues by severity
        if (highIssues.length > 0) {
          output.push('#### 🔴 High Severity Issues\n');
          for (const issue of highIssues) {
            // Add perspective emoji if available
            const perspEmoji = issue.perspective
              ? this.perspectiveEmojis[issue.perspective as keyof typeof this.perspectiveEmojis] ||
                ''
              : '';

            output.push(
              `- ${perspEmoji} **${issue.message}**${issue.line ? ` (line ${issue.line})` : ''}\n`,
            );
            if (issue.explanation) {
              output.push(`  - ${issue.explanation}\n`);
            }
            if (issue.suggestion) {
              output.push(`  - Suggestion: ${issue.suggestion}\n`);
            }
            // Add code snippet if available
            if (issue.code) {
              output.push(`\n\`\`\`${review.path.split('.').pop()}\n${issue.code}\n\`\`\`\n`);
            }
          }
          output.push('\n');
        }

        if (mediumIssues.length > 0) {
          output.push('#### 🟠 Medium Severity Issues\n');
          for (const issue of mediumIssues) {
            // Add perspective emoji if available
            const perspEmoji = issue.perspective
              ? this.perspectiveEmojis[issue.perspective as keyof typeof this.perspectiveEmojis] ||
                ''
              : '';

            output.push(
              `- ${perspEmoji} **${issue.message}**${issue.line ? ` (line ${issue.line})` : ''}\n`,
            );
            if (issue.explanation) {
              output.push(`  - ${issue.explanation}\n`);
            }
            if (issue.suggestion) {
              output.push(`  - Suggestion: ${issue.suggestion}\n`);
            }
            // Add code snippet if available
            if (issue.code) {
              output.push(`\n\`\`\`${review.path.split('.').pop()}\n${issue.code}\n\`\`\`\n`);
            }
          }
          output.push('\n');
        }

        if (lowIssues.length > 0) {
          output.push('#### 🟡 Low Severity Issues\n');
          for (const issue of lowIssues) {
            // Add perspective emoji if available
            const perspEmoji = issue.perspective
              ? this.perspectiveEmojis[issue.perspective as keyof typeof this.perspectiveEmojis] ||
                ''
              : '';

            output.push(
              `- ${perspEmoji} **${issue.message}**${issue.line ? ` (line ${issue.line})` : ''}\n`,
            );
            if (issue.explanation) {
              output.push(`  - ${issue.explanation}\n`);
            }
            if (issue.suggestion) {
              output.push(`  - Suggestion: ${issue.suggestion}\n`);
            }
            // Add code snippet if available
            if (issue.code) {
              output.push(`\n\`\`\`${review.path.split('.').pop()}\n${issue.code}\n\`\`\`\n`);
            }
          }
          output.push('\n');
        }

        // Recommendations section
        if (review.suggestions && review.suggestions.length > 0) {
          output.push('#### 💡 Recommendations\n');
          for (const rec of review.suggestions) {
            output.push(`- ${rec}\n`);
          }
          output.push('\n');
        }
      }

      // Add detailed summary table at the end
      if (allIssues.length > 0) {
        output.push('## Issues Summary Table\n\n');
        output.push('| File | Severity | Issue | Line | Explanation |\n');
        output.push('|------|----------|-------|------|-------------|\n');

        allIssues.forEach((issue) => {
          const severity = issue.severity === 'high'
            ? '🔴 High'
            : issue.severity === 'medium'
            ? '🟠 Medium'
            : '🟡 Low';

          // Use explanation if available, otherwise use suggestion
          const explanation = issue.explanation
            ? (issue.explanation.length > 50
              ? issue.explanation.substring(0, 47) + '...'
              : issue.explanation)
            : issue.suggestion
            ? (issue.suggestion.length > 50
              ? issue.suggestion.substring(0, 47) + '...'
              : issue.suggestion)
            : 'N/A';

          // Add perspective emoji if available
          const perspEmoji = issue.perspective
            ? this.perspectiveEmojis[issue.perspective as keyof typeof this.perspectiveEmojis] || ''
            : '';

          output.push(
            `| ${issue.file} | ${severity} | ${perspEmoji} ${issue.message} | ${
              issue.line || 'N/A'
            } | ${explanation} |\n`,
          );
        });

        output.push('\n');

        // Add a more detailed section with code
        output.push('## Detailed Issue Analysis\n\n');

        for (const issue of allIssues) {
          const severity = issue.severity === 'high'
            ? '🔴 High'
            : issue.severity === 'medium'
            ? '🟠 Medium'
            : '🟡 Low';

          // Add perspective emoji if available
          const perspEmoji = issue.perspective
            ? this.perspectiveEmojis[issue.perspective as keyof typeof this.perspectiveEmojis] || ''
            : '';

          output.push(`### ${severity}: ${perspEmoji} ${issue.message}\n`);
          output.push(`**File:** ${issue.file}${issue.line ? ` (line ${issue.line})` : ''}\n\n`);

          if (issue.explanation) {
            output.push(`**Explanation:** ${issue.explanation}\n\n`);
          }

          if (issue.suggestion) {
            output.push(`**Suggestion:** ${issue.suggestion}\n\n`);
          }

          if (issue.code) {
            const fileExt = issue.file.split('.').pop() || '';
            output.push(`**Code Context:**\n\`\`\`${fileExt}\n${issue.code}\n\`\`\`\n\n`);
          }

          output.push('---\n\n');
        }
      }

      return output.join('');
    } catch (error) {
      this.context.logger.error('Error formatting review output:', error);
      return 'Error formatting review output. Please check the logs.';
    }
  }

  // Analyze changed files directly from diffs
  private async analyzeFileChanges(
    filePath: string,
    diff: string,
    options: BaseEngineeringOptions,
  ): Promise<FileAnalysis | null> {
    try {
      // Parse the diff to get changed sections
      const diffLines = diff.split('\n');
      const changedSections = this.parseChangedSections(diffLines);

      if (changedSections.length === 0) {
        this.context.logger.passThrough(
          'log',
          theme.dim(`No meaningful changes detected in ${filePath}`),
        );
        return null;
      }

      // Get the file extension for language detection
      const fileExt = filePath.split('.').pop()?.toLowerCase() || '';

      // Combine all changed sections for analysis
      const combinedChanges = changedSections.map((section, index) =>
        `/* Change ${index + 1}: Lines ${section.start}-${section.end} */\n${section.code}`
      ).join('\n\n');

      // Show processing info
      this.context.logger.passThrough(
        'log',
        theme.dim(`Analyzing ${changedSections.length} changed section(s) in ${filePath}...`),
      );

      // Determine analysis depth based on options
      const perspective = options.analysisDepth === 'deep'
        ? 'architect'
        : options.analysisDepth === 'quick'
        ? 'junior'
        : 'senior';

      // Create a custom prompt based on file type and context
      let customPrompt = `Please analyze ONLY the changes in this diff from file ${filePath}.
      Focus on code quality, potential bugs, performance, and maintainability.
      Consider the context around the changes but prioritize reviewing the actual changes.
      
      Make sure to include a brief code snippet with each issue to show the problematic code.
      
      This analysis will be used for a code review, so provide actionable feedback.`;

      // Add file-type specific guidance
      if (['ts', 'tsx', 'js', 'jsx'].includes(fileExt)) {
        customPrompt += `\n\nFor this JavaScript/TypeScript file, pay special attention to:
        - Type safety
        - Potential null/undefined issues
        - Proper async/await usage
        - React component optimization (if applicable)`;
      } else if (['py'].includes(fileExt)) {
        customPrompt += `\n\nFor this Python file, pay special attention to:
        - Pythonic code style
        - Exception handling
        - Performance considerations
        - Type hints (if used)`;
      } else if (['java', 'kt'].includes(fileExt)) {
        customPrompt += `\n\nFor this Java/Kotlin file, pay special attention to:
        - Proper resource management
        - Exception handling
        - Concurrency issues
        - Object-oriented design`;
      }

      // Analyze only the changed sections
      const analysis = await this.aiService.generateStructuredAnalysis(
        combinedChanges,
        FileAnalysisSchema,
        this.getPerspectiveSystemPrompt(perspective),
        customPrompt,
      );

      // Map line numbers more accurately if possible
      if (analysis.issues) {
        analysis.issues = analysis.issues.map((issue) => {
          if (issue.line !== undefined) {
            // Ensure line is treated as a number for comparisons
            const lineNum = typeof issue.line === 'string' ? parseInt(issue.line, 10) : issue.line;

            // Skip if conversion resulted in NaN
            if (isNaN(lineNum)) {
              return issue;
            }

            // Find the actual section this line number belongs to
            for (const section of changedSections) {
              if (lineNum >= section.start && lineNum <= section.end) {
                // Keep the line number - it's already correct
                return issue;
              } else if (lineNum < section.start) {
                // Line reference is relative to the code snippet, map to actual file line
                const relativeLine = lineNum;
                const adjustedLine = section.start + relativeLine - 1;

                // Extract code context around the issue if not provided
                if (!issue.code) {
                  const codeLines = section.code.split('\n');
                  const contextStart = Math.max(0, relativeLine - 3);
                  const contextEnd = Math.min(codeLines.length, relativeLine + 2);
                  const contextLines = codeLines.slice(contextStart, contextEnd);

                  // Add line indicators to the code context
                  const codeWithIndicators = contextLines.map((line, idx) => {
                    const currentLine = contextStart + idx + 1;
                    if (currentLine === relativeLine) {
                      return `> ${line} // Issue on this line`;
                    }
                    return `  ${line}`;
                  }).join('\n');

                  return {
                    ...issue,
                    line: adjustedLine,
                    code: codeWithIndicators,
                  };
                }

                return { ...issue, line: adjustedLine };
              }
            }
          }
          return issue;
        });
      }

      return {
        ...analysis,
        path: filePath,
      };
    } catch (error) {
      this.context.logger.error(
        theme.error(
          `Error analyzing changes in ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      return null;
    }
  }

  private parseChangedSections(
    diffLines: string[],
  ): Array<{ start: number; end: number; code: string }> {
    const sections: Array<{ start: number; end: number; code: string }> = [];
    let currentSection: {
      start: number;
      end: number;
      code: string[];
      context: string[];
      removedLines: string[];
    } | null = null;
    let lineNumber = 0;

    for (const line of diffLines) {
      // Handle hunk headers (e.g., @@ -10,7 +10,6 @@)
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+,\d+ \+(\d+),\d+ @@(.*)$/);
        if (match) {
          // Finalize previous section if it exists
          if (
            currentSection &&
            (currentSection.code.length > 0 || currentSection.removedLines.length > 0)
          ) {
            sections.push({
              start: currentSection.start,
              end: currentSection.end,
              code: this.formatSectionWithContext(currentSection),
            });
          }

          // Start a new section
          lineNumber = parseInt(match[1], 10);

          // Include the section header as context if available
          const sectionHeader = match[2] ? match[2].trim() : '';

          currentSection = {
            start: lineNumber,
            end: lineNumber - 1, // Will be incremented when we process the first line
            code: [],
            context: [
              `/* Code from MR diff, starting at line ${lineNumber}${
                sectionHeader ? ` - ${sectionHeader}` : ''
              } */`,
            ],
            removedLines: [],
          };
        }
      } else if (currentSection) {
        // Process the diffed lines
        if (line.startsWith('+')) {
          // Added line - include it
          currentSection.code.push(line.substring(1));
          currentSection.end = lineNumber;
          lineNumber++;
        } else if (line.startsWith(' ')) {
          // Context line - include for better understanding
          currentSection.context.push(line.substring(1));
          currentSection.code.push(line.substring(1)); // Also add to code for proper context
          lineNumber++;
        } else if (line.startsWith('-')) {
          // Removed line - store for context but don't include in the line count
          currentSection.removedLines.push(line.substring(1));
        } else if (line === '\\ No newline at end of file') {
          // Ignore this special diff line
        }
      }
    }

    // Process the last section if it exists
    if (
      currentSection && (currentSection.code.length > 0 || currentSection.removedLines.length > 0)
    ) {
      sections.push({
        start: currentSection.start,
        end: currentSection.end,
        code: this.formatSectionWithContext(currentSection),
      });
    }

    return sections;
  }

  /**
   * Formats a code section with proper context including removed lines for better understanding
   */
  private formatSectionWithContext(section: {
    code: string[];
    context: string[];
    removedLines: string[];
    start: number;
  }): string {
    const formattedLines: string[] = [...section.context];

    // If there are removed lines, show them as comments for context
    if (section.removedLines.length > 0) {
      formattedLines.push('\n/* Removed in this change: */');
      formattedLines.push('/*');
      section.removedLines.forEach((line) => {
        formattedLines.push(` * ${line}`);
      });
      formattedLines.push(' */\n');
    }

    formattedLines.push(...section.code);

    return formattedLines.join('\n');
  }

  protected async reviewPath(
    path: string,
    options: BaseEngineeringOptions,
  ): Promise<AgentResponse> {
    try {
      const fileInfo = await Deno.stat(path);
      const analyses: FileAnalysis[] = [];

      this.context.logger.passThrough('log', theme.header('\n🤖 Starting Code Review'));
      this.context.logger.passThrough(
        'log',
        theme.info('Using AI Model:'),
        theme.emphasis(this.aiService.model),
      );

      if (fileInfo.isFile) {
        this.context.logger.passThrough(
          'log',
          theme.header('\n📄 Phase 1:'),
          'Initial code analysis',
        );
        const analysis = await this.analyzeFileWithTools(path);
        if (analysis) {
          analyses.push(analysis);
        }
      } else if (fileInfo.isDirectory) {
        const files = [];
        for await (const entry of Deno.readDir(path)) {
          if (entry.isFile && entry.name.endsWith('.ts')) {
            files.push(entry);
          }
        }

        this.context.logger.passThrough(
          'log',
          theme.header('\n📁 Found'),
          theme.emphasis(files.length.toString()),
          'TypeScript files to review\n',
        );

        for (const [index, entry] of files.entries()) {
          const filePath = `${path}/${entry.name}`;
          this.context.logger.passThrough(
            'log',
            theme.header('\n📄 Phase 1:'),
            'Analyzing',
            theme.emphasis(filePath),
            `(${index + 1}/${files.length})`,
          );
          const analysis = await this.analyzeFileWithTools(filePath);
          if (analysis) {
            analyses.push(analysis);
          }
        }
      }

      if (analyses.length > 0) {
        this.context.logger.passThrough(
          'log',
          theme.header('\n🤔 Phase 2:'),
          `Synthesizing insights from ${analyses.length} files...`,
        );
        const synthesis = await this.synthesizeReviews(analyses);

        this.context.logger.passThrough(
          'log',
          theme.header('\n📝 Phase 3:'),
          'Generating comprehensive review...',
        );

        // Create a session object with the file analyses
        const reviewSession: ReviewSession = {
          mr: {
            iid: 0,
            title: 'Local Code Review',
            changes: analyses.map((a) => ({ new_path: a.path, diff: '' })),
          },
          overallReview: {
            fileAnalyses: analyses,
            summary: synthesis.summary,
            score: analyses.reduce((acc, a) => acc + a.score, 0) / analyses.length,
            suggestions: analyses.flatMap((a) => a.suggestions),
            isDraft: false,
          },
          comments: [],
        };

        this.displayReviewSummary(synthesis, options, reviewSession);

        return {
          success: true,
          message: 'Analysis completed successfully',
          data: {
            analyses,
            synthesis,
          },
        };
      }

      return {
        success: false,
        message: 'No files were analyzed',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.error(theme.error(`Error during analysis: ${errorMessage}`));
      return {
        success: false,
        message: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  public async submitReview(
    projectPath: string,
    mrId: number,
    session: ReviewSession,
    isDraft: boolean = false,
  ): Promise<void> {
    try {
      // Create a new merge request comment
      const fileAnalyses = session.overallReview.fileAnalyses || [];
      const comment = this.formatReviewOutput({ reviews: fileAnalyses });

      // Post the comment to GitLab
      await this.context.gitlab?.createMergeRequestComment(
        projectPath,
        mrId,
        comment,
        isDraft,
      );

      this.context.logger.passThrough(
        'log',
        theme.success(`Review ${isDraft ? 'draft ' : ''}posted to merge request !${mrId}`),
      );
    } catch (error) {
      this.context.logger.error(
        `Error submitting review: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error(
        `Error submitting review: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Make this method public for MergeRequestReviewAgent to use
  public selectProjectAndMR(): Promise<MergeRequestSelection | null> {
    // This is a placeholder method for the MergeRequestReviewAgent to call
    throw new Error('Method not implemented in CodeReviewAgent');
  }
}
