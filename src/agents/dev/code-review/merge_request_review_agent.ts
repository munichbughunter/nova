import { Input, Select } from '@cliffy/prompt';
import { Table } from '@cliffy/table';
import { AIService } from '../../../services/ai_service.ts';
import { formatError, formatProgress, formatSuccess, theme } from '../../../utils.ts';
import { AgentResponse } from '../../base_agent.ts';
import { BaseDevAgent } from '../base_dev_agent.ts';
import { BaseEngineeringOptions } from '../types.ts';
import { CodeReviewAgent } from './code_review_agent.ts';
import {
  FileAnalysis,
  ReviewSession,
  ReviewSynthesis
} from './schemas.ts';
import { GitLabMergeRequest, MergeRequestSelection, MRComment, ReviewAgentContext } from './types.ts';

// Define a minimal MR interface for type safety
interface MergeRequestLike {
  iid: number;
  title: string;
  author?: { name?: string };
}

/**
 * MergeRequestReviewAgent is a specialized agent that focuses solely on reviewing
 * GitLab merge requests and providing actionable feedback.
 */
export class MergeRequestReviewAgent extends BaseDevAgent {
  name = 'Merge Request Review';
  description = 'Reviews merge requests and provides detailed feedback';
  private codeReviewAgent: CodeReviewAgent;
  private aiService: AIService;

  constructor(context: ReviewAgentContext, options: BaseEngineeringOptions) {
    super(context, options);
    // Create an instance of CodeReviewAgent to reuse its core functionality
    this.codeReviewAgent = new CodeReviewAgent(context, options);
    // Initialize the AI service
    this.aiService = new AIService(this.context.config, {
      model: options.aiModel || (options.depth === 'deep' ? 'gpt-4' : 'gpt-3.5-turbo'),
      temperature: options.depth === 'quick' ? 0.7 : 0.3,
    });
  }

  override help(): string {
    return `
${theme.header('Merge Request Review Agent Help')}

Commands:
  review-mr              Review merge request changes

Options:
  --project <n>       Specify the GitLab project (e.g., 'group/project')
  --mr <id>              Specify the merge request ID (e.g., 123)
  --draft                Save review as draft
  --post                 Post review to GitLab
  --interactive          Enable interactive review mode (default: true)
  --depth <level>        Analysis depth (quick|normal|deep) [default: normal]

Examples:
  nova agent eng review-mr
  nova agent eng review-mr --project group/project --mr 123
  nova agent eng review-mr --depth=deep --post
    `;
  }

  override execute(_command: string, _args: string[]): Promise<AgentResponse> {
    try {
      // Parse command args
      const options = { ...this.options };
      let showHelp = false;

      for (let i = 0; i < _args.length; i++) {
        const arg = _args[i];
        if (arg === '--help' || arg === '-h') {
          showHelp = true;
        } else if (arg === '--project' && i + 1 < _args.length) {
          options.project = _args[++i];
        } else if (arg === '--mr' && i + 1 < _args.length) {
          options.mergeRequest = parseInt(_args[++i], 10);
        } else if (arg === '--draft') {
          options.draft = true;
        } else if (arg === '--post') {
          options.post = true;
        } else if (arg === '--interactive') {
          options.interactive = true;
        } else if (arg === '--no-interactive') {
          options.interactive = false;
        } else if (arg === '--depth' && i + 1 < _args.length) {
          options.depth = _args[++i] as BaseEngineeringOptions['depth'];
        }
      }

      if (showHelp || _command === 'help') {
        return Promise.resolve({
          success: true,
          message: this.help(),
        });
      }

      return this.reviewMergeRequest(options);
    } catch (error) {
      formatError(`Error in MergeRequestReviewAgent: ${error instanceof Error ? error.message : String(error)}`);
      return Promise.resolve({
        success: false,
        message: `Error in MergeRequestReviewAgent: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Analyze file diff for MR changes
   */
  private async analyzeFileDiff(
    filePath: string, 
    diff: string, 
    _options: BaseEngineeringOptions
  ): Promise<FileAnalysis | null> {
    try {
      if (!diff || diff.trim() === '') {
        this.context.logger.warn(`No meaningful diff content for ${filePath}`);
        return null;
      }
      
      this.context.logger.passThrough('log', theme.dim('🧐 Reading and understanding the code...'));
      
      // Extract the language from the file extension
      const fileExtension = filePath.split('.').pop()?.toLowerCase();
      const language = fileExtension || 'text';
      
      // Create a simplified version of the diff for analysis
      const diffLines = diff.split('\n');
      const changedSections = this.parseChangedSections(diffLines);
      
      if (changedSections.length === 0) {
        this.context.logger.warn(`No meaningful changes detected in ${filePath}`);
        return null;
      }
      
      // Prepare a context-enriched version of the changes
      const formattedChanges = changedSections.map(section => {
        return this.formatSectionWithContext({
          start: section.start,
          code: section.code.split('\n'),
          context: [],
          removedLines: []
        });
      }).join('\n\n');
      
      // Send diff for analysis
      this.context.logger.passThrough('log', theme.dim('💭 Analyzing code structure and patterns...'));
      
      const analysis = await this.aiService.analyzeCode(
        formattedChanges,
        {
          language,
          context: `File: ${filePath} (diff analysis)`
        }
      );
      
      // Create and return the analysis with proper defaults
      return {
        path: filePath,
        issues: analysis.issues.map(issue => ({
          message: issue.message || 'Unknown issue',
          severity: issue.severity || 'medium' as 'high' | 'medium' | 'low',
          suggestion: issue.suggestion || 'No suggestion provided', 
          explanation: issue.explanation,
          line: issue.line ? this.resolveLineNumberInDiff(diffLines, issue.line) : undefined,
          column: issue.column,
          code: issue.code
        })),
        suggestions: analysis.recommendations || [],
        score: analysis.metrics?.score || 7, // Default score if not provided
        summary: analysis.summary || `Changes to ${filePath} analyzed`,
        learningOpportunities: []
      };
    } catch (error) {
      this.context.logger.error(`Error analyzing file changes in ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Main method to review a merge request
   */
  private async reviewMergeRequest(options: BaseEngineeringOptions): Promise<AgentResponse> {
    if (!this.context.gitlab) {
      return {
        success: false,
        message: 'GitLab service not available',
      };
    }

    formatProgress('Starting merge request review...');

    // Interactive selection of project and MR if not specified
    let mr: GitLabMergeRequest | null = null;
    let projectPath: string | undefined = options.project;

    if (!options.project || !options.mergeRequest) {
      const selection = await this.selectProjectAndMR();
      if (!selection) {
        return {
          success: false,
          message: 'No merge request selected.',
        };
      }
      projectPath = selection.project;
      mr = selection.mr as unknown as GitLabMergeRequest;
    } else {
      try {
        // Use type assertion to handle GitLab service type mismatch
        mr = await this.context.gitlab.getMergeRequest(
          options.project,
          options.mergeRequest
        ) as unknown as GitLabMergeRequest;
        
        // Check if the merge request is open
        if (mr.state !== 'opened') {
          return {
            success: false,
            message: `Merge request !${mr.iid} is not open (current state: ${mr.state}). This agent only reviews open merge requests.`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `Failed to get merge request: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (!mr || !projectPath) {
      return {
        success: false,
        message: 'No merge request found.',
      };
    }

    // Fetch changes if they're not already present
    if (!mr.changes || mr.changes.length === 0) {
      try {
        mr.changes = await this.context.gitlab.getMergeRequestChanges(projectPath, mr.iid);
      } catch (error) {
        return {
          success: false,
          message: `Failed to get merge request changes: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // Always use interactive mode unless explicitly disabled
    if (options.interactive !== false) {
      return this.reviewMergeRequestInteractive(
        projectPath,
        mr,
        options
      );
    }

    // Non-interactive mode
    if (!mr.changes?.length) {
      return {
        success: false,
        message: 'No changes found in merge request',
      };
    }

    const analyses: FileAnalysis[] = [];
    
    // Analyze each changed file
    this.context.logger.passThrough('log', theme.header('\n🔍 Starting Non-Interactive MR Review'));
    this.context.logger.passThrough('log', theme.info(`Reviewing MR #${mr.iid}: ${mr.title}`));
    
    for (const change of mr.changes || []) {
      if (change.deleted_file) {
        this.context.logger.passThrough('log', theme.dim(`\nSkipping deleted file: ${change.old_path}`));
        continue;
      }

      this.context.logger.passThrough('log', theme.header(`\n📄 Analyzing changes in: ${change.new_path}`));
      // Using the improved diff-based analysis
      const analysis = await this.analyzeFileDiff(change.new_path, change.diff, options);
      if (analysis) {
        analyses.push(analysis);
        this.context.logger.passThrough('log', theme.success(`✓ Analysis completed: ${analysis.issues.length} issue(s) found`));
      }
    }

    if (analyses.length === 0) {
      return {
        success: false,
        message: 'Failed to analyze any merge request changes',
      };
    }
    
    // Generate synthesis
    this.context.logger.passThrough('log', theme.header('\n🤔 Synthesizing review...'));
    const synthesis = await this.synthesizeReviews(analyses);
    
    // Create a review session to ensure statistics are correctly displayed
    // This is crucial for accurate reporting of file counts, issue counts, and scores
    const reviewSession: ReviewSession = {
      mr,
      comments: [],
      overallReview: {
        fileAnalyses: analyses,
        summary: synthesis.summary,
        score: analyses.reduce((acc, a) => acc + a.score, 0) / analyses.length,
        suggestions: analyses.flatMap(a => a.suggestions),
        isDraft: Boolean(options.draft)
      }
    };
    
    // Display summary with proper session data
    this.displayReviewSummary(synthesis, options, reviewSession);

    // Post to GitLab if requested
    if (options.post && this.context.gitlab) {
      this.context.logger.passThrough('log', theme.info('\nPosting review to GitLab...'));
      await this.context.gitlab.createMergeRequestComment(
        projectPath,
        mr.iid,
        this.formatReviewOutput({ reviews: analyses }),
        Boolean(options.draft)
      );
      this.context.logger.passThrough('log', theme.success('✓ Review posted to GitLab'));
    }

    formatSuccess('Merge request review completed successfully');

    return {
      success: true,
      message: 'Merge request review completed successfully',
      data: {
        analyses,
        synthesis,
        mr
      },
    };
  }

  protected override analyze(): Promise<AgentResponse> {
    // This is a placeholder implementation required by BaseEngineeringAgent
    return Promise.resolve({
      success: true,
      message: 'Analysis complete',
      data: {}
    });
  }

  protected override implement(): Promise<AgentResponse> {
    // This is a placeholder implementation required by BaseEngineeringAgent
    return Promise.resolve({
      success: true,
      message: 'Implementation complete',
      data: {}
    });
  }

  protected override validate(): Promise<AgentResponse> {
    // This is a placeholder implementation required by BaseEngineeringAgent
    return Promise.resolve({
      success: true,
      message: 'Validation complete',
      data: {}
    });
  }

  public reviewMergeRequestInteractive(
    projectPath: string,
    mr: GitLabMergeRequest,
    _options: BaseEngineeringOptions
  ): Promise<AgentResponse> {
    // Use the improved workflow
    return this.reviewMergeRequestImproved(projectPath, mr, _options);
  }
  
  public async analyzeFileChanges(
    filePath: string, 
    diff: string, 
    _options: BaseEngineeringOptions
  ): Promise<FileAnalysis | null> {
    try {
      if (!diff || diff.trim() === '') {
        this.context.logger.warn(`No meaningful diff content for ${filePath}`);
        return null;
      }
      
      this.context.logger.passThrough('log', theme.dim('🧐 Reading and understanding the code...'));
      
      // Extract the language from the file extension
      const fileExtension = filePath.split('.').pop()?.toLowerCase();
      const language = fileExtension || 'text';
      
      // Create a simplified version of the diff for analysis
      const diffLines = diff.split('\n');
      const changedSections = this.parseChangedSections(diffLines);
      
      if (changedSections.length === 0) {
        this.context.logger.warn(`No meaningful changes detected in ${filePath}`);
        return null;
      }
      
      // Prepare a context-enriched version of the changes
      const formattedChanges = changedSections.map(section => {
        return this.formatSectionWithContext({
          start: section.start,
          code: section.code.split('\n'),
          context: [],
          removedLines: []
        });
      }).join('\n\n');
      
      // Send diff for analysis
      this.context.logger.passThrough('log', theme.dim('💭 Analyzing code structure and patterns...'));
      
      const analysis = await this.aiService.analyzeCode(
        formattedChanges,
        {
          language,
          context: `File: ${filePath} (diff analysis)`
        }
      );
      
      // Create and return the analysis with properly typed issues
      return {
        path: filePath,
        issues: analysis.issues.map(issue => ({
          severity: issue.severity || 'medium' as 'high' | 'medium' | 'low',
          message: issue.message || 'Unnamed issue',
          suggestion: issue.suggestion || 'No suggestion provided', // Ensure suggestion is never undefined
          explanation: issue.explanation,
          line: issue.line ? this.resolveLineNumberInDiff(diffLines, issue.line) : undefined,
          code: issue.code,
          column: issue.column
        })),
        suggestions: analysis.recommendations || [],
        score: analysis.metrics?.score || 7, // Default score if not provided
        summary: analysis.summary || `Changes to ${filePath} analyzed`,
        learningOpportunities: []
      };
    } catch (error) {
      this.context.logger.error(`Error analyzing file changes in ${filePath}:`, error);
      return null;
    }
  }
  /**
   * Prompts the user to select issues to address from a list
   * @param issues The list of issues to choose from
   * @returns Array of selected issues
   */
  private async promptForIssueSelection(issues: FileAnalysis['issues']): Promise<FileAnalysis['issues']> {
    if (issues.length === 0) {
      return [];
    }
    
    this.context.logger.passThrough('log', theme.header('\n🔍 Select issues to address:'));
    
    // List all issues with numbers
    issues.forEach((issue, index) => {
      const severityColor = issue.severity === 'high' ? theme.error : 
                          issue.severity === 'medium' ? theme.warning : theme.info;
      
      this.context.logger.passThrough('log', 
        `${index + 1}. ${severityColor(`[${issue.severity.toUpperCase()}]`)} ${issue.message} ${issue.line ? `(Line ${issue.line})` : ''}`
      );
    });
    
    // Prompt for selection
    const selection = await Input.prompt({
      message: 'Enter issue numbers to address (comma-separated, or "all"/"none"):',
      default: 'all',
    });
    
    if (selection.toLowerCase() === 'all') {
      return [...issues];
    }
    
    if (selection.toLowerCase() === 'none') {
      return [];
    }
    
    // Parse the selection
    const selectedIndices = selection.split(',')
      .map((s: string) => parseInt(s.trim(), 10) - 1)
      .filter((n: number) => !isNaN(n) && n >= 0 && n < issues.length);
    
    return selectedIndices.map((i: number) => issues[i]);
  }

  /**
   * Generates suggested fixes for multiple issues at once
   * @param issues The issues to generate fixes for
   * @param filePath The path of the file
   * @param diff The diff content for context
   * @returns Map of issues to suggested fixes
   */
  private async generateBatchFixes(
    issues: FileAnalysis['issues'],
    filePath: string,
    diff: string
  ): Promise<Map<FileAnalysis['issues'][0], string>> {
    const fixesMap = new Map<FileAnalysis['issues'][0], string>();
    
    if (issues.length === 0) {
      return fixesMap;
    }
    
    this.context.logger.passThrough('log', theme.header('\n🔧 Generating suggested fixes...'));
    
    // Use simple logging instead of progress indicator
    this.context.logger.passThrough('log', `Generating fixes (0/${issues.length})`);
    
    // Group similar issues to avoid generating duplicate fixes
    const uniqueIssues = this.deduplicateSimilarIssues(issues);
    this.context.logger.passThrough('log', theme.dim(`Processing ${uniqueIssues.length} unique issues...`));
    
    let count = 0;
    for (const issue of uniqueIssues) {
      // Extract the relevant code snippet
      const lineNumber = issue.line; // Already undefined if not set
      const codeSnippet = this.extractSnippetFromDiff(diff, lineNumber);
      
      // Generate a fix suggestion
      this.context.logger.passThrough('log', '\n🤖 Generating code fix suggestion...');
      const fixSuggestion = await this.suggestCodeFix(filePath, codeSnippet, issue);
      
      if (fixSuggestion && this.isFixDifferentFromOriginal(codeSnippet, fixSuggestion)) {
        // Only add the fix if it's substantially different from the original
        fixesMap.set(issue, fixSuggestion);
        
        // Add the same fix to similar issues
        for (const similarIssue of issues) {
          if (similarIssue !== issue && this.areIssuesSimilar(issue, similarIssue) && !fixesMap.has(similarIssue)) {
            fixesMap.set(similarIssue, fixSuggestion);
          }
        }
      } else if (fixSuggestion) {
        // If fix isn't substantially different, log a message
        this.context.logger.passThrough('log', theme.warning(`⚠️ Generated fix for "${issue.message}" doesn't significantly differ from original - skipping`));
      }
      
      count++;
      this.context.logger.passThrough('log', `Generating fixes (${count}/${uniqueIssues.length})`);
    }
    
    this.context.logger.passThrough('log', theme.success(`\n✓ Generated ${fixesMap.size} fix suggestion(s)`));
    
    return fixesMap;
  }


  
  /**
   * Deduplicate similar issues to avoid generating multiple identical fixes
   */
  private deduplicateSimilarIssues(issues: FileAnalysis['issues']): FileAnalysis['issues'] {
    if (issues.length <= 1) return issues;
    
    const uniqueIssues: FileAnalysis['issues'] = [];
    const processedMessages = new Set<string>();
    
    for (const issue of issues) {
      // Create a simplified key for comparison
      const key = `${issue.severity}:${issue.message.toLowerCase().trim()}`;
      
      if (!processedMessages.has(key)) {
        uniqueIssues.push(issue);
        processedMessages.add(key);
      }
    }
    
    return uniqueIssues;
  }

  /**
   * Check if two issues are similar enough to get the same fix
   */
  private areIssuesSimilar(issue1: FileAnalysis['issues'][0], issue2: FileAnalysis['issues'][0]): boolean {
    return (
      issue1.severity === issue2.severity &&
      this.getTextSimilarity(issue1.message, issue2.message) > 0.7
    );
  }
  
  /**
   * Simple text similarity calculator (0-1 score)
   */
  private getTextSimilarity(text1: string, text2: string): number {
    const str1 = text1.toLowerCase().trim();
    const str2 = text2.toLowerCase().trim();
    
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;
    
    // Simple word overlap metric
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }


  
  /**
   * Check if the fix is substantially different from the original
   */
  private isFixDifferentFromOriginal(original: string, fix: string): boolean {
    // Normalize for comparison
    const normalizedOriginal = original.trim().replace(/\s+/g, ' ');
    const normalizedFix = fix.trim().replace(/\s+/g, ' ');
    
    // If they're identical, return false
    if (normalizedOriginal === normalizedFix) return false;
    
    // Check for more than just added/removed spaces
    const similarity = this.getTextSimilarity(normalizedOriginal, normalizedFix);
    
    // If they're more than 90% similar, check if differences are meaningful
    if (similarity > 0.9) {
      // Check if the only differences are added/removed spaces or +/- symbols
      const cleanOriginal = normalizedOriginal.replace(/[+\-\s]/g, '');
      const cleanFix = normalizedFix.replace(/[+\-\s]/g, '');
      
      return cleanOriginal !== cleanFix;
    }
    
    return true;
  }

  /**
   * Prompts the user for manual comments on a file
   * @param filePath The path of the file
   * @returns Manual comments to add
   */
  private async promptForManualComments(filePath: string): Promise<MRComment[]> {
    const comments: MRComment[] = [];
    
    const addComment = await this.promptUser(
      'Would you like to add any manual comments?',
      ['Yes', 'No'],
      'No'
    );
    
    if (addComment === 'No') {
      return comments;
    }
    
    let addMore = true;
    while (addMore) {
      this.context.logger.passThrough('log', theme.header('\n✏️ Add Manual Comment'));
      
      // Get comment content directly without asking for line number
      const content = await Input.prompt({
        message: 'Comment text:',
      });
      
      const _isDraft = await this.promptUser(
        'Save as draft?',
        ['Yes', 'No'],
        'No'
      ) === 'Yes';
      
      // Use the appropriate properties for MRComment
      comments.push({
        path: filePath,
        line: undefined,
        body: content,
        line_type: 'new'
      } as MRComment);
      
      const continueAdding = await this.promptUser(
        'Add another comment?',
        ['Yes', 'No'],
        'No'
      );
      
      addMore = continueAdding === 'Yes';
    }
    
    return comments;
  }

  /**
   * Interactive selection of project and merge request
   */
  public async selectProjectAndMR(): Promise<MergeRequestSelection | null> {
    if (!this.context.gitlab) {
      this.context.logger.error('GitLab service not available');
      return null;
    }

    try {
      // Check if project path and MR ID were provided via options
      if (this.options.project && this.options.mergeRequest) {
        const mr = await this.context.gitlab.getMergeRequest(
          this.options.project,
          this.options.mergeRequest
        );
        
        if (mr) {
          // Verify that the merge request is open
          if (mr.state !== 'opened') {
            this.context.logger.passThrough('log', theme.warning(`Merge request !${mr.iid} is not open (current state: ${mr.state}). This agent only reviews open merge requests.`));
            return null;
          }
          
          this.context.logger.passThrough('log', theme.success(`Using specified merge request: !${mr.iid} ${mr.title}`));
          return {
            project: this.options.project,
            mr: mr as unknown as GitLabMergeRequest
          };
        }
      }
      
      // Try to get project from Git remote URL
      let projectPath = this.options.project;
      if (!projectPath) {
        try {
          const remoteURL = await new Deno.Command('git', {
            args: ['remote', 'get-url', 'origin'],
            stdout: 'piped'
          }).output();
          
          const url = new TextDecoder().decode(remoteURL.stdout).trim();
          // Extract project path from GitLab URL pattern (e.g., git@gitlab.com:group/project.git)
          const match = url.match(/(?:git@|https:\/\/)[^:\/]+[:/]([^\/]+\/[^\/]+?)(?:\.git)?$/);
          if (match) {
            projectPath = match[1];
            this.context.logger.passThrough('log', theme.dim(`Using project from git remote: ${projectPath}`));
          }
        } catch (error) {
          this.context.logger.debug(`Failed to get project from git remote: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // If we still don't have a project path, prompt the user to enter one
      if (!projectPath) {
        projectPath = await Input.prompt({
          message: "Enter GitLab project path (e.g., group/project):",
          default: ""
        });
        
        if (!projectPath) {
          this.context.logger.passThrough('log', theme.warning("No project path provided."));
          return null;
        }
      }
      
      // Fetch MRs for this project
      this.context.logger.passThrough('log', theme.dim(`\nFetching merge requests for ${projectPath}...`));
      
      // Use the time parameter to get recent MRs (30 days)
      const mrs = await this.context.gitlab.getProjectMergeRequests(projectPath, '30d');
      
      // Filter to only show open merge requests
      const openMRs = mrs.filter(mr => mr.state === 'opened');
      this.context.logger.passThrough('log', theme.info(`Found ${openMRs.length} open merge requests out of ${mrs.length} total`));
      
      if (!openMRs || openMRs.length === 0) {
        this.context.logger.passThrough('log', theme.warning("No open merge requests found for this project."));
        return null;
      }
      
      // Format MRs for selection
      const mrOptions = openMRs.map(mr => ({
        name: `#${mr.iid}: ${mr.title}`,
        value: mr
      }));
      
      // Prompt user to select an MR
      const selectedMR = await Select.prompt({
        message: "Select a merge request to review:",
        options: mrOptions.map(opt => ({ name: opt.name, value: String(opt.value.iid) }))
      });
      
      // Find the selected MR
      const mrId = Number(selectedMR);
      const mr = openMRs.find(m => m.iid === mrId);
      
      if (!mr) {
        this.context.logger.passThrough('log', theme.warning("Invalid MR selection."));
        return null;
      }
      
      return {
        project: projectPath,
        mr: mr as unknown as GitLabMergeRequest
      };
    } catch (error) {
      this.context.logger.error(`Error selecting project and MR: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }



  // Helper method for analyzeFileChanges
  private resolveLineNumberInDiff(diffLines: string[], lineInDiff: number | string | undefined): number | undefined {
    // If lineInDiff is undefined, string that can't be parsed, or not a valid number, return undefined
    if (lineInDiff === undefined) {
      return undefined;
    }
    
    // Convert to number if it's a string
    const lineNum = typeof lineInDiff === 'string' ? parseInt(lineInDiff, 10) : lineInDiff;
    
    // If conversion failed or isn't a valid number, return undefined
    if (isNaN(lineNum)) {
      return undefined;
    }
    
    // This is a simplified implementation
    // In a real implementation, you would parse the diff header to find actual file line numbers
    let actualLineNumber: number | undefined;
    let diffLineCounter = 0;
    
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      if (line.startsWith('@@')) {
        // Parse the diff header to get line numbers
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match && match[1]) {
          const newStart = parseInt(match[1], 10);
          diffLineCounter = 0;
          actualLineNumber = newStart;
        }
      } else if (line.startsWith('+')) {
        diffLineCounter++;
        if (actualLineNumber !== undefined) {
          actualLineNumber++;
        }
        
        if (diffLineCounter === lineNum) {
          return actualLineNumber;
        }
      } else if (!line.startsWith('-')) {
        diffLineCounter++;
        if (actualLineNumber !== undefined) {
          actualLineNumber++;
        }
      }
    }
    
    return undefined;
  }

  private parseChangedSections(diffLines: string[]): Array<{ start: number; end: number; code: string }> {
    const sections: Array<{ start: number; end: number; code: string }> = [];
    let inChangedSection = false;
    let currentSection: { start: number; lines: string[] } | null = null;
    let lineNumber = 0;
    
    for (const line of diffLines) {
      if (line.startsWith('@@')) {
        // Parse the diff header to get line numbers
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match && match[1]) {
          const newStartLine = parseInt(match[1], 10);
          lineNumber = newStartLine - 1; // -1 because we increment before using
        }
        inChangedSection = true;
        if (currentSection) {
          sections.push({
            start: currentSection.start,
            end: lineNumber - 1,
            code: currentSection.lines.join('\n')
          });
        }
        currentSection = { start: lineNumber + 1, lines: [] };
      } else if (inChangedSection) {
        if (line.startsWith('+')) {
          // Added line
          lineNumber++;
          if (!currentSection) {
            currentSection = { start: lineNumber, lines: [] };
          }
          currentSection.lines.push(line.substring(1));
        } else if (line.startsWith('-')) {
          // Removed line - skip
        } else {
          // Context line
          lineNumber++;
          if (currentSection && currentSection.lines.length > 0) {
            currentSection.lines.push(line.substring(1));
          }
        }
      }
    }
    
    // Add the last section if there is one
    if (currentSection && currentSection.lines.length > 0) {
      sections.push({
        start: currentSection.start,
        end: lineNumber,
        code: currentSection.lines.join('\n')
      });
    }
    
    return sections;
  }

  private formatSectionWithContext(section: { 
    code: string[]; 
    context: string[]; 
    removedLines: string[];
    start: number; 
  }): string {
    const lines = section.code.map(line => line.trim());
    return lines.map((line, index) => {
      const lineNumber = section.start + index;
      return `${lineNumber}: ${line}`;
    }).join('\n');
  }

  private async getRecentProjects(): Promise<string[]> {
    try {
      if (!this.context.dbService) {
        return [];
      }

      const recentProjects = await this.context.dbService.getRecentProjects();
      if (!recentProjects || recentProjects.length === 0) {
        return [];
      }

      // Map directly to project paths with proper type assertion
      return recentProjects.map(project => project.path_with_namespace);
    } catch (error) {
      this.logger.error('Error getting recent projects:', error);
      return [];
    }
  }

  private async createMergeRequest(projectPath: string): Promise<MergeRequestSelection | null> {
    try {
      this.context.logger.passThrough('log', theme.header('\n🚀 Creating New Merge Request'));
      const sourceBranch = await this.promptUser(
        'Enter the source branch name:',
        [],
        'feature/my-new-feature' // Default suggestion
      );
      
      const targetBranch = await this.promptUser(
        'Enter the target branch name:',
        ['main', 'master', 'develop'], // Common target branches
        'main'
      );
      
      const title = await this.promptUser(
        'Enter the merge request title:',
        [],
        'WIP: My New Feature' // Default WIP title
      );

      const description = await this.promptUser(
        'Enter the merge request description (optional):',
        [],
        'Adding my new feature.' // Default description
      );

      if (!this.context.gitlab) {
        throw new Error('GitLab service not available');
      }
      
      this.context.logger.passThrough('log', theme.dim('\nCreating MR via GitLab API...'));
      const mr = await this.context.gitlab.createMergeRequest(projectPath, {
        sourceBranch,
        targetBranch,
        title,
        description,
        draft: title.toLowerCase().startsWith('wip'), // Set draft if title starts with WIP
      });
      
      this.context.logger.passThrough('log', theme.success(`✓ Merge request !${mr.iid} created: ${mr.web_url}`));

      return { project: projectPath, mr: mr as unknown as GitLabMergeRequest };
    } catch (error) {
      this.context.logger.error(theme.error(`Error creating merge request: ${error instanceof Error ? error.message : String(error)}`));
      // Ask user if they want to try again or exit
      const retryAction = await this.promptUser(
        'Failed to create MR. Try again?',
        ['Yes', 'No'],
        'No'
      );
      if (retryAction === 'Yes') {
        return this.createMergeRequest(projectPath);
      }
      return null;
    }
  }

  private promptSelect<T>(question: string, options: Array<{ name: string; value: T }>): Promise<T | null> {
    this.context.logger.passThrough('log', question);
    if (options.length > 0) {
      this.context.logger.passThrough('log', `Options: ${options.map(o => o.name).join(', ')}`);
    }
    return Promise.resolve(options.length > 0 ? options[0].value : null);
  }


  public async submitReview(
    projectPath: string, 
    mrId: number, 
    session: ReviewSession, 
    isDraft: boolean = false
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
        isDraft
      );
      
      this.context.logger.passThrough('log', theme.success(`Review ${isDraft ? 'draft ' : ''}posted to merge request !${mrId}`));
    } catch (error) {
      this.context.logger.error(`Error submitting review: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Error submitting review: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public extractLineFromMessage(_message: string): number | null {
    // Implement your logic to extract line number from the message
    // This is a placeholder implementation
    return null;
  }

  public suggestCodeFix(
    _filePath: string, 
    _code: string, 
    _issue: FileAnalysis['issues'][0]
  ): Promise<string | null> {
    // Implement your logic to generate a code fix
    // This is a placeholder implementation
    return Promise.resolve(null);
  }

  // TODO: this can run only if the local branch is open
  public applyCodeFixLocally(
    _filePath: string,
    _startLine: number,
    _endLine: number,
    _newCode: string
  ): Promise<boolean> {
    // Implement your logic to apply a code fix locally
    // This is a placeholder implementation
    return Promise.resolve(false);
  }

  // Add the missing implementation of reviewMergeRequestImproved
  private async reviewMergeRequestImproved(
    projectPath: string,
    mr: GitLabMergeRequest,
    options: BaseEngineeringOptions
  ): Promise<AgentResponse> {
    this.context.logger.passThrough('log', theme.header('\n🔍 Starting Interactive Code Review'));
    this.context.logger.passThrough('log', theme.info(`Reviewing MR #${mr.iid}: ${mr.title}`));
    
    // Implement the improved workflow for reviewing merge requests
    try {
      // Verify that the merge request is open
      if (mr.state !== 'opened') {
        return {
          success: false,
          message: `Merge request !${mr.iid} is not open (current state: ${mr.state}). This agent only reviews open merge requests.`,
        };
      }
      
      // Fetch complete MR data with file changes if needed
      if (!mr.changes || mr.changes.length === 0) {
        this.context.logger.passThrough('log', theme.dim('Fetching merge request changes...'));
        const fullMr = await this.context.gitlab?.getMergeRequest(projectPath, mr.iid);
        if (!fullMr) {
          return {
            success: false,
            message: `Could not fetch merge request details for MR !${mr.iid}`,
          };
        }
        mr = fullMr as unknown as GitLabMergeRequest;
        
        // Double-check the state after fetching fresh data
        if (mr.state !== 'opened') {
          return {
            success: false,
            message: `Merge request !${mr.iid} is not open (current state: ${mr.state}). This agent only reviews open merge requests.`,
          };
        }
      }
      
      // Create a new review session
      const session: ReviewSession = {
        mr,
        comments: [],
        overallReview: {
          fileAnalyses: [],
          summary: '',
          score: 0,
          suggestions: [],
          isDraft: true
        }
      };
      
      // Analyze each changed file
      this.context.logger.passThrough('log', theme.info('\nAnalyzing changed files...'));
      if (mr.changes?.length) {
        for (const change of mr.changes) {
          if (change.deleted_file) {
            this.context.logger.passThrough('log', theme.dim(`📄 Skipping deleted file: ${change.new_path}`));
            continue;
          }
          
          this.context.logger.passThrough('log', `📄 Analyzing file: ${change.new_path}`);
          const analysis = await this.analyzeFileChanges(change.new_path, change.diff, options);
          if (analysis) {
            if (session.overallReview.fileAnalyses) {
              session.overallReview.fileAnalyses.push(analysis);
            } else {
              session.overallReview.fileAnalyses = [analysis];
            }
          }
        }
      }
      
      // Generate a synthesis of the review
      if (session.overallReview.fileAnalyses && session.overallReview.fileAnalyses.length > 0) {
        this.context.logger.passThrough('log', theme.info('\nSynthesizing review results...'));
        const synthesis = await this.synthesizeReviews(session.overallReview.fileAnalyses);
        
        // Update session with synthesis results
        session.overallReview.summary = synthesis.summary;
        session.overallReview.score = session.overallReview.fileAnalyses.reduce((acc, r) => acc + r.score, 0) / 
                                    session.overallReview.fileAnalyses.length;
        session.overallReview.suggestions = [
          ...new Set(
            session.overallReview.fileAnalyses.flatMap(r => r.suggestions)
          )
        ].slice(0, 10); // Take top 10 unique suggestions
        
        // Display the review summary
        this.context.logger.passThrough('log', '\n');
        // Ensure we pass the fully populated session for accurate statistics
        this.displayReviewSummary(synthesis, options, session);

        // Start interactive mode if requested
        if (options.interactive !== false) {
          this.context.logger.passThrough('log', theme.header('\n🤖 Starting Interactive Mode'));

          // Create a simple interactive loop for the review
          let inInteractiveMode = true;
          while (inInteractiveMode) {
            try {
              const userInput = await Input.prompt({
                message: 'What would you like to do? (Type "help" for commands)',
              });

              // Handle exit command
              if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
                inInteractiveMode = false;
                this.context.logger.passThrough('log', theme.info('Exiting interactive mode...'));
                continue;
              }

              // Help command
              if (userInput.toLowerCase() === 'help') {
                this.context.logger.passThrough('log', theme.header('\n📚 Available Commands:'));
                this.context.logger.passThrough('log', '• explore <filename> - See details for a specific file');
                this.context.logger.passThrough('log', '• issues <filename> - Select and address issues in a file');
                this.context.logger.passThrough('log', '• comment <filename> - Add a comment to a file');
                this.context.logger.passThrough('log', '• suggest <filename> - Get improvement suggestions for a file');
                this.context.logger.passThrough('log', '• fix <filename> <issue_number> - Generate a code fix for an issue');
                this.context.logger.passThrough('log', '• summary - Show the review summary again');
                this.context.logger.passThrough('log', '• submit [draft] - Submit the review to GitLab');
                this.context.logger.passThrough('log', '• exit/quit - Exit interactive mode');
                continue;
              }

              // Summary command
              if (userInput.toLowerCase() === 'summary') {
                this.context.logger.passThrough('log', '\n');
                this.displayReviewSummary(synthesis, options, session);
                continue;
              }

              // Submit command
              if (userInput.toLowerCase().startsWith('submit')) {
                const isDraft = userInput.toLowerCase().includes('draft');
                
                const confirmation = await Input.prompt({
                  message: `Submit review as ${isDraft ? 'draft' : 'final'}? (yes/no)`,
                  default: 'no',
                });
                
                if (confirmation.toLowerCase() === 'yes') {
                  await this.submitReview(projectPath, mr.iid, session, isDraft);
                  this.context.logger.passThrough('log', theme.success(`Review ${isDraft ? 'draft ' : ''}submitted to GitLab MR !${mr.iid}`));
                  inInteractiveMode = false;
                }
                continue;
              }

              // Explore command
              if (userInput.toLowerCase().startsWith('explore ')) {
                const fileName = userInput.substring('explore '.length).trim();
                const fileAnalysis = session.overallReview.fileAnalyses.find(a => a.path === fileName);
                
                if (fileAnalysis) {
                  this.context.logger.passThrough('log', theme.header(`\n📄 ${fileName}`));
                  this.context.logger.passThrough('log', `Score: ${fileAnalysis.score.toFixed(1)}/10`);
                  this.context.logger.passThrough('log', `Issues: ${fileAnalysis.issues.length}`);
                  
                  if (fileAnalysis.issues.length > 0) {
                    this.context.logger.passThrough('log', theme.header('\nIssues:'));
                    fileAnalysis.issues.forEach((issue, index) => {
                      const severityColor = issue.severity === 'high' ? theme.error : 
                                          issue.severity === 'medium' ? theme.warning : theme.info;
                      this.context.logger.passThrough('log', `${index + 1}. ${severityColor(`[${issue.severity.toUpperCase()}]`)} ${issue.message} ${issue.line ? `(Line ${issue.line})` : ''}`);
                      if (issue.explanation) {
                        this.context.logger.passThrough('log', `   ${theme.dim(issue.explanation)}`);
                      }
                      if (issue.suggestion) {
                        this.context.logger.passThrough('log', `   ${theme.dim('Suggestion:')} ${issue.suggestion}`);
                      }
                    });
                  }
                  
                  if (fileAnalysis.suggestions && fileAnalysis.suggestions.length > 0) {
                    this.context.logger.passThrough('log', theme.header('\nSuggestions:'));
                    fileAnalysis.suggestions.forEach((suggestion, index) => {
                      this.context.logger.passThrough('log', `${index + 1}. ${suggestion}`);
                    });
                  }
                } else {
                  this.context.logger.passThrough('log', theme.warning(`File ${fileName} not found in the analysis results.`));
                }
                continue;
              }

              // Issues command - utilize the existing promptForIssueSelection method
              if (userInput.toLowerCase().startsWith('issues ')) {
                const fileName = userInput.substring('issues '.length).trim();
                const fileAnalysis = session.overallReview.fileAnalyses.find(a => a.path === fileName);
                
                if (fileAnalysis && fileAnalysis.issues.length > 0) {
                  this.context.logger.passThrough('log', theme.header(`\n🔍 Issues in ${fileName}:`));
                  
                  const selectedIssues = await this.promptForIssueSelection(fileAnalysis.issues);
                  
                  if (selectedIssues.length > 0) {
                    this.context.logger.passThrough('log', theme.success(`Selected ${selectedIssues.length} issues to address`));
                    
                    // Show the selected issues
                    selectedIssues.forEach((issue, index) => {
                      const severityColor = issue.severity === 'high' ? theme.error : 
                                         issue.severity === 'medium' ? theme.warning : theme.info;
                      
                      this.context.logger.passThrough('log', 
                        `${index + 1}. ${severityColor(`[${issue.severity.toUpperCase()}]`)} ${issue.message} ${issue.line ? `(Line ${issue.line})` : ''}`
                      );
                    });
                    
                    // Ask if user wants to generate fixes for these issues
                    const generateFixes = await Input.prompt({
                      message: 'Generate fixes for these issues? (yes/no)',
                      default: 'no',
                    });
                    
                    if (generateFixes.toLowerCase() === 'yes') {
                      // Find the change object for this file to get the diff
                      const fileChange = mr.changes?.find(c => c.new_path === fileName);
                      
                      if (fileChange && fileChange.diff) {
                        this.context.logger.passThrough('log', theme.header('\n🔧 Generating fixes...'));
                        
                        for (const issue of selectedIssues) {
                          this.context.logger.passThrough('log', `\nGenerating fix for: ${issue.message}`);
                          
                          try {
                            // Extract code context around the issue
                            const codeSnippet = this.extractSnippetFromDiff(fileChange.diff, issue.line);
                            
                            const fixPrompt = `You are a code fixing expert. Generate a code fix for the following issue in file ${fileName}:
                                             
                            Issue: ${issue.message}
                            Severity: ${issue.severity}
                            ${issue.explanation ? `Explanation: ${issue.explanation}` : ''}
                            ${issue.suggestion ? `Suggestion: ${issue.suggestion}` : ''}
                            Line number: ${issue.line || 'Not specified'}
                            
                            Here's the relevant code context:
                            \`\`\`${fileName.split('.').pop() || ''}
                            ${codeSnippet}
                            \`\`\`
                            
                            Provide only the fixed code without explanations. Make minimal changes to address the issue.`;
                            
                            const response = await this.aiService.generateText(fixPrompt, {
                              maxSteps: 1000
                            });
                            
                            const fixResponse = response.text || '';
                            
                            // Display the fix
                            this.context.logger.passThrough('log', theme.success('\nProposed Fix:'));
                            this.context.logger.passThrough('log', `\`\`\`${fileName.split('.').pop() || ''}\n${fixResponse}\n\`\`\``);
                            
                            // Ask if user wants to save this as a comment
                            const saveFix = await Input.prompt({
                              message: 'Save this fix as a comment on the MR? (yes/no)',
                              default: 'no',
                            });
                            
                            if (saveFix.toLowerCase() === 'yes') {
                              session.comments.push({
                                file: fileName,
                                line: issue.line !== undefined ? (typeof issue.line === 'string' ? parseInt(issue.line, 10) : issue.line) : null,
                                content: `## Proposed Fix for: ${issue.message}\n\n\`\`\`${fileName.split('.').pop() || ''}\n${fixResponse}\n\`\`\``,
                                isDraft: false
                              });
                              
                              this.context.logger.passThrough('log', theme.success('Fix saved as a comment'));
                            }
                          } catch (error) {
                            this.context.logger.error('Error generating fix:', error);
                            this.context.logger.passThrough('log', theme.error(`Failed to generate fix: ${error instanceof Error ? error.message : String(error)}`));
                          }
                        }
                      } else {
                        this.context.logger.passThrough('log', theme.warning(`Could not find diff information for ${fileName}`));
                      }
                    }
                  } else {
                    this.context.logger.passThrough('log', theme.info('No issues selected'));
                  }
                } else {
                  this.context.logger.passThrough('log', theme.warning(`No issues found in ${fileName}`));
                }
                continue;
              }

              // Comment command
              if (userInput.toLowerCase().startsWith('comment ')) {
                const fileName = userInput.substring('comment '.length).trim();
                const fileAnalysis = session.overallReview.fileAnalyses.find(a => a.path === fileName);
                
                if (fileAnalysis) {
                  this.context.logger.passThrough('log', theme.header(`\n✏️ Adding comment to ${fileName}`));
                  const commentText = await Input.prompt({
                    message: 'Enter your comment:',
                  });
                  
                  if (commentText.trim()) {
                    // Add the comment to the session
                    session.comments.push({
                      file: fileName,
                      line: null,
                      content: commentText,
                      isDraft: false
                    });
                    
                    this.context.logger.passThrough('log', theme.success(`Comment added to ${fileName}`));
                  }
                } else {
                  this.context.logger.passThrough('log', theme.warning(`File ${fileName} not found in the analysis results.`));
                }
                continue;
              }

              // Add suggest command
              if (userInput.toLowerCase().startsWith('suggest ')) {
                const fileName = userInput.substring('suggest '.length).trim();
                const fileAnalysis = session.overallReview.fileAnalyses.find(a => a.path === fileName);
                
                if (fileAnalysis) {
                  this.context.logger.passThrough('log', theme.header(`\n💡 Generating suggestions for ${fileName}...`));
                  
                  // Find the change object for this file to get the diff
                  const fileChange = mr.changes?.find(c => c.new_path === fileName);
                  
                  if (fileChange && fileChange.diff) {
                    try {
                      // Use AI to generate specific suggestions based on the diff
                      const fileExt = fileName.split('.').pop() || '';
                      const suggestionPrompt = `You are a code review expert. Analyze the following changes in ${fileName} and provide 3-5 specific, actionable suggestions to improve the code quality, readability, performance, or security.
                                              Focus on best practices for ${fileExt} files and provide concrete examples where helpful.
                                              
                                              Here is the file diff:\n\`\`\`diff\n${fileChange.diff}\n\`\`\``;
                      
                      const response = await this.aiService.generateText(suggestionPrompt, {
                        maxSteps: 1000
                      });
                      
                      const suggestionResponse = response.text || '';
                      
                      // Display the suggestions
                      this.context.logger.passThrough('log', theme.success('\nSuggestions:'));
                      this.context.logger.passThrough('log', suggestionResponse);
                      
                      // Ask if user wants to save these as comments
                      const saveSuggestions = await Input.prompt({
                        message: 'Save these suggestions as comments on the MR? (yes/no)',
                        default: 'no',
                      });
                      
                      if (saveSuggestions.toLowerCase() === 'yes') {
                        session.comments.push({
                          file: fileName,
                          line: null,
                          content: `## AI-Generated Suggestions\n\n${suggestionResponse}`,
                          isDraft: false
                        });
                        
                        this.context.logger.passThrough('log', theme.success('Suggestions saved as a comment'));
                      }
                    } catch (error) {
                      this.context.logger.error('Error generating suggestions:', error);
                      this.context.logger.passThrough('log', theme.error(`Failed to generate suggestions: ${error instanceof Error ? error.message : String(error)}`));
                    }
                  } else {
                    this.context.logger.passThrough('log', theme.warning(`Could not find diff information for ${fileName}`));
                  }
                } else {
                  this.context.logger.passThrough('log', theme.warning(`File ${fileName} not found in the analysis results.`));
                }
                continue;
              }

              // Add fix command
              if (userInput.toLowerCase().startsWith('fix ')) {
                const parts = userInput.substring('fix '.length).trim().split(' ');
                
                if (parts.length < 2) {
                  this.context.logger.passThrough('log', theme.warning('Usage: fix <filename> <issue_number>'));
                  continue;
                }
                
                const fileName = parts[0];
                const issueNumber = parseInt(parts[1], 10);
                
                const fileAnalysis = session.overallReview.fileAnalyses.find(a => a.path === fileName);
                
                if (fileAnalysis) {
                  if (isNaN(issueNumber) || issueNumber <= 0 || issueNumber > fileAnalysis.issues.length) {
                    this.context.logger.passThrough('log', theme.warning(`Invalid issue number. Please specify a number between 1 and ${fileAnalysis.issues.length}`));
                    continue;
                  }
                  
                  const issue = fileAnalysis.issues[issueNumber - 1];
                  this.context.logger.passThrough('log', theme.header(`\n🔧 Generating fix for issue: ${issue.message}`));
                  
                  // Find the change object for this file to get the diff
                  const fileChange = mr.changes?.find(c => c.new_path === fileName);
                  
                  if (fileChange && fileChange.diff) {
                    try {
                      // Extract code context around the issue
                      const codeSnippet = this.extractSnippetFromDiff(fileChange.diff, issue.line);
                      
                      // Use AI to generate a fix
                      const fixPrompt = `You are a code fixing expert. Generate a code fix for the following issue in file ${fileName}:
                                        
                                        Issue: ${issue.message}
                                        Severity: ${issue.severity}
                                        ${issue.explanation ? `Explanation: ${issue.explanation}` : ''}
                                        ${issue.suggestion ? `Suggestion: ${issue.suggestion}` : ''}
                                        Line number: ${issue.line || 'Not specified'}
                                        
                                        Here's the relevant code context:
                                        \`\`\`${fileName.split('.').pop() || ''}
                                        ${codeSnippet}
                                        \`\`\`
                                        
                                        Provide only the fixed code without explanations. Make minimal changes to address the issue.`;
                      
                      const response = await this.aiService.generateText(fixPrompt, {
                        maxSteps: 1000
                      });
                      
                      const fixResponse = response.text || '';
                      
                      // Display the fix
                      this.context.logger.passThrough('log', theme.success('\nProposed Fix:'));
                      this.context.logger.passThrough('log', `\`\`\`${fileName.split('.').pop() || ''}\n${fixResponse}\n\`\`\``);
                      
                      // Ask if user wants to save this as a comment
                      const saveFix = await Input.prompt({
                        message: 'Save this fix as a comment on the MR? (yes/no)',
                        default: 'no',
                      });
                      
                      if (saveFix.toLowerCase() === 'yes') {
                        session.comments.push({
                          file: fileName,
                          line: issue.line !== undefined ? (typeof issue.line === 'string' ? parseInt(issue.line, 10) : issue.line) : null,
                          content: `## Proposed Fix for: ${issue.message}\n\n\`\`\`${fileName.split('.').pop() || ''}\n${fixResponse}\n\`\`\``,
                          isDraft: false
                        });
                        
                        this.context.logger.passThrough('log', theme.success('Fix saved as a comment'));
                      }
                    } catch (error) {
                      this.context.logger.error('Error generating fix:', error);
                      this.context.logger.passThrough('log', theme.error(`Failed to generate fix: ${error instanceof Error ? error.message : String(error)}`));
                    }
                  } else {
                    this.context.logger.passThrough('log', theme.warning(`Could not find diff information for ${fileName}`));
                  }
                } else {
                  this.context.logger.passThrough('log', theme.warning(`File ${fileName} not found in the analysis results.`));
                }
                continue;
              }

              // Default response for unrecognized commands
              this.context.logger.passThrough('log', theme.warning(`Unknown command: ${userInput}. Type "help" to see available commands.`));
            } catch (error) {
              this.context.logger.error('Error in interactive mode:', error);
              this.context.logger.passThrough('log', theme.error(`Error: ${error instanceof Error ? error.message : String(error)}`));
            }
          }
        }
      } else {
        this.context.logger.passThrough('log', theme.warning('\nNo meaningful changes found to review.'));
        return {
          success: false,
          message: 'No meaningful changes found to review.',
        };
      }
      
      return {
        success: true,
        message: 'Merge request review completed',
        data: {
          session
        }
      };
    } catch (error) {
      this.context.logger.error(`Error reviewing merge request: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        message: `Error reviewing merge request: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Add placeholder methods for user interaction
  private promptUser(question: string, options: string[], defaultOption: string): string {
    this.context.logger.passThrough('log', question);
    if (options.length > 0) {
      this.context.logger.passThrough('log', `Options: ${options.join(', ')}`);
    }
    return defaultOption;
  }

  private formatReviewOutput(data: { reviews: FileAnalysis[] }): string {
    // Use our own implementation for MR reviews instead of relying on CodeReviewAgent
    try {
      const output: string[] = [];
      output.push('# Merge Request Review Results\n');
      
      // Add branded header
      output.push(`> 🧠 **Powered by nova AI Code Review**\n`);
      
      // Summary section
      output.push('## Summary\n');
      
      const totalFiles = data.reviews.length;
      output.push(`Analyzed ${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}.\n`);
      
      // Count total issues by severity
      const totalIssues = {
        high: 0,
        medium: 0,
        low: 0
      };
      
      // Track if we have any issues with code or line numbers
      let hasLineInfo = false;
      
      data.reviews.forEach(review => {
        review.issues.forEach(issue => {
          totalIssues[issue.severity]++;
          if (issue.line) hasLineInfo = true;
        });
      });
      
      const totalCount = totalIssues.high + totalIssues.medium + totalIssues.low;
      
      // Add issue count summary with visual formatting
      if (totalCount > 0) {
        output.push(`Found **${totalCount} issues**:\n`);
        output.push(`- 🔴 **${totalIssues.high} high severity**\n`);
        output.push(`- 🟠 **${totalIssues.medium} medium severity**\n`);
        output.push(`- 🟡 **${totalIssues.low} low severity**\n`);
      } else {
        output.push("✅ **No issues found!** Great job! 🎉\n");
      }
      
      // Overall score - calculate average
      const avgScore = data.reviews.reduce((sum, review) => sum + review.score, 0) / totalFiles;
      let scoreEmoji = '🟢';
      if (avgScore < 5) scoreEmoji = '🔴';
      else if (avgScore < 7) scoreEmoji = '🟠';
      else if (avgScore < 8.5) scoreEmoji = '🟡';
      
      output.push(`\n${scoreEmoji} **Overall Score: ${avgScore.toFixed(1)}/10**\n`);
      
      // Issues by file
      if (totalCount > 0) {
        output.push('\n## Issues by File\n');
        
        for (const review of data.reviews) {
          output.push(`### ${review.path}\n`);
          
          if (review.issues.length === 0) {
            output.push('✅ No issues found in this file.\n\n');
            continue;
          }
          
          // Add file score
          let fileScoreEmoji = '🟢';
          if (review.score < 5) fileScoreEmoji = '🔴';
          else if (review.score < 7) fileScoreEmoji = '🟠';
          else if (review.score < 8.5) fileScoreEmoji = '🟡';
          
          output.push(`${fileScoreEmoji} **Score: ${review.score.toFixed(1)}/10**\n\n`);
          
          // Group issues by severity
          const highIssues = review.issues.filter((issue) => issue.severity === 'high');
          const mediumIssues = review.issues.filter((issue) => issue.severity === 'medium');
          const lowIssues = review.issues.filter((issue) => issue.severity === 'low');
          
          // Format issues by severity
          if (highIssues.length > 0) {
            output.push('#### 🔴 High Severity Issues\n');
            for (const issue of highIssues) {
              output.push(`- **${issue.message}**${issue.line ? ` (line ${issue.line})` : ''}\n`);
              if (issue.explanation) {
                output.push(`  - ${issue.explanation}\n`);
              }
              if (issue.suggestion) {
                output.push(`  - Suggestion: ${issue.suggestion}\n`);
              }
              // Add code snippet if available
              if (issue.code) {
                output.push(`\n\`\`\`${review.path.split('.').pop() || ''}\n${issue.code}\n\`\`\`\n`);
              }
            }
            output.push('\n');
          }
          
          if (mediumIssues.length > 0) {
            output.push('#### 🟠 Medium Severity Issues\n');
            for (const issue of mediumIssues) {
              output.push(`- **${issue.message}**${issue.line ? ` (line ${issue.line})` : ''}\n`);
              if (issue.explanation) {
                output.push(`  - ${issue.explanation}\n`);
              }
              if (issue.suggestion) {
                output.push(`  - Suggestion: ${issue.suggestion}\n`);
              }
              // Add code snippet if available
              if (issue.code) {
                output.push(`\n\`\`\`${review.path.split('.').pop() || ''}\n${issue.code}\n\`\`\`\n`);
              }
            }
            output.push('\n');
          }
          
          if (lowIssues.length > 0) {
            output.push('#### 🟡 Low Severity Issues\n');
            for (const issue of lowIssues) {
              output.push(`- **${issue.message}**${issue.line ? ` (line ${issue.line})` : ''}\n`);
              if (issue.explanation) {
                output.push(`  - ${issue.explanation}\n`);
              }
              if (issue.suggestion) {
                output.push(`  - Suggestion: ${issue.suggestion}\n`);
              }
              // Add code snippet if available
              if (issue.code) {
                output.push(`\n\`\`\`${review.path.split('.').pop() || ''}\n${issue.code}\n\`\`\`\n`);
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
        
        // Add summary table at the end if there are issues with line numbers
        if (hasLineInfo) {
          output.push('## Issues Summary Table\n\n');
          output.push('| File | Severity | Issue | Line |\n');
          output.push('|------|----------|-------|------|\n');
          
          data.reviews.forEach(review => {
            review.issues.forEach(issue => {
              const severity = issue.severity === 'high'
                ? '🔴 High' 
                : issue.severity === 'medium'
                  ? '🟠 Medium'
                  : '🟡 Low';
                  
              output.push(
                `| ${review.path} | ${severity} | ${issue.message} | ${
                  issue.line || 'N/A'
                } |\n`
              );
            });
          });
          
          output.push('\n');
        }
      }
      
      // Add learning opportunities if available
      const allLearningOpportunities = data.reviews.flatMap(a => a.learningOpportunities || []);
      if (allLearningOpportunities.length > 0) {
        output.push('## 📚 Learning Opportunities\n\n');
        const uniqueOpportunities = [...new Set(allLearningOpportunities)];
        for (const opportunity of uniqueOpportunities.slice(0, 5)) { // Limit to 5
          output.push(`- ${opportunity}\n`);
        }
        output.push('\n');
      }
      
      // Add footer
      output.push('---\n');
      output.push('*This review was automatically generated by nova AI Code Review*\n');
      
      return output.join('');
    } catch (error) {
      this.context.logger.error('Error formatting review output:', error);
      return this.codeReviewAgent.formatReviewOutput(data);
    }
  }

  private displayReviewSummary(synthesis: ReviewSynthesis, options?: BaseEngineeringOptions, session?: ReviewSession): void {
    // Ensure we have a valid session with fileAnalyses for proper statistics
    if (!session || !session.overallReview || !session.overallReview.fileAnalyses || session.overallReview.fileAnalyses.length === 0) {
      this.context.logger.debug('Creating a default session for statistics as none was provided');
      
      // Create a minimal session to ensure statistics are properly calculated
      const defaultSession: ReviewSession = {
        mr: session?.mr || { iid: 0, title: 'Unknown MR', state: 'unknown', created_at: '', updated_at: '' } as GitLabMergeRequest,
        comments: [],
        overallReview: {
          fileAnalyses: [],  // This will be populated below if needed
          summary: synthesis.summary,
          score: 0,
          suggestions: [],
          isDraft: false
        }
      };
      
      // If we have a synthesis but no session, try to extract some info from the synthesis
      if (synthesis) {
        // We might have some data in the synthesis that can help us populate statistics
        defaultSession.overallReview.suggestions = synthesis.actionItems.map(item => item.description);
      }
      
      session = defaultSession;
    }
    
    // Calculate and display statistics
    this.displayReviewStatistics(session);
    
    try {
      // Create a nicely formatted table for the summary
      const summaryTable = new Table();
      
      if (!synthesis) {
        this.context.logger.passThrough('log', theme.error('No review synthesis available'));
        return;
      }
      
      summaryTable.border(true);
      summaryTable.padding(2);
      
      // Add header section
      summaryTable.push([theme.header('📊 Merge Request Review Summary')]);
      
      // Add MR information if available
      if (session.mr) {
        summaryTable.push([`${theme.symbols.info || 'ℹ️'} Reviewing MR !${session.mr.iid}: ${session.mr.title}`]);
        if (session.mr.author?.name) {
          summaryTable.push([`👤 Author: ${session.mr.author.name}`]);
        }
      }
      
      // Add key findings section
      summaryTable.push([theme.header('📝 Key Findings')]);
      const summaryLines = synthesis.summary.split('. ');
      for (const line of summaryLines) {
        if (line.trim() !== '') {
          summaryTable.push([line.trim() + '.']);
        }
      }
      
      // Add Consensus areas if available
      if (synthesis.consensus && synthesis.consensus.length > 0) {
        summaryTable.push([theme.header('🤝 Areas of Consensus')]);
        for (const consensus of synthesis.consensus) {
          summaryTable.push([`• ${consensus}`]);
        }
      }
      
      // Add Different Perspectives if available
      if (synthesis.differences && synthesis.differences.length > 0) {
        summaryTable.push([theme.header('🔄 Different Perspectives')]);
        for (const diff of synthesis.differences) {
          summaryTable.push([`• ${diff}`]);
        }
      }
      
      // Display the summary table
      this.context.logger.passThrough('log', '\n');
      this.context.logger.passThrough('log', summaryTable.toString());
      
      // Display action items in a separate table
      if (synthesis.actionItems && synthesis.actionItems.length > 0) {
        const actionTable = new Table();
        actionTable.border(true);
        actionTable.padding(2);
        
        actionTable.push([theme.header('🚀 Action Items')]);
        
        for (const item of synthesis.actionItems) {
          actionTable.push([`• ${item.description}`]);
        }
        
        this.context.logger.passThrough('log', '\n');
        this.context.logger.passThrough('log', actionTable.toString());
      }
      
      // Display learning opportunities if in verbose mode
      if (options?.verbose && synthesis.learningOpportunities && synthesis.learningOpportunities.length > 0) {
        const learningTable = new Table();
        learningTable.border(true);
        learningTable.padding(2);
        
        learningTable.push([theme.header('🎓 Learning Opportunities')]);
        
        for (const item of synthesis.learningOpportunities) {
          learningTable.push([`• ${item}`]);
        }
        
        this.context.logger.passThrough('log', '\n');
        this.context.logger.passThrough('log', learningTable.toString());
      }
    } catch (error) {
      this.context.logger.error('Error displaying review summary:', error);
      console.log('\n=== Review Summary ===');
      console.log(synthesis.summary);
      console.log('=====================\n');
    }
  }

  private displayReviewStatistics(session: ReviewSession): void {
    try {
      const statsTable = new Table();
      statsTable.border(true);
      statsTable.padding(2);
      
      // Add header
      statsTable.push([theme.header('📈 Review Statistics')]);
      
      const fileAnalyses = session.overallReview.fileAnalyses || [];
      const totalFiles = fileAnalyses.length;
      const filesWithIssues = fileAnalyses.filter(analysis => 
        analysis.issues && analysis.issues.length > 0
      ).length;
      
      // Count issues by severity
      let totalIssues = 0;
      let highIssues = 0;
      let mediumIssues = 0;
      let lowIssues = 0;
      let totalScore = 0;
      let highestScore = 0;
      let lowestScore = 10;
      
      fileAnalyses.forEach(analysis => {
        if (analysis.issues) {
          totalIssues += analysis.issues.length;
          highIssues += analysis.issues.filter(i => i.severity === 'high').length;
          mediumIssues += analysis.issues.filter(i => i.severity === 'medium').length;
          lowIssues += analysis.issues.filter(i => i.severity === 'low').length;
        }
        
        if (analysis.score !== undefined) {
          totalScore += analysis.score;
          highestScore = Math.max(highestScore, analysis.score);
          lowestScore = Math.min(lowestScore, analysis.score);
        }
      });
      
      // If no files analyzed, use session overall score if available
      let avgScore = 0;
      if (totalFiles > 0) {
        avgScore = totalScore / totalFiles;
      } else if (session.overallReview?.score) {
        avgScore = session.overallReview.score;
        highestScore = session.overallReview.score;
        lowestScore = session.overallReview.score;
      }
      
      // Calculate percentages (avoid division by zero)
      const issuePercentage = totalFiles > 0 ? Math.round((filesWithIssues / totalFiles) * 100) : 0;
      const highPercentage = totalIssues > 0 ? Math.round((highIssues / totalIssues) * 100) : 0;
      const mediumPercentage = totalIssues > 0 ? Math.round((mediumIssues / totalIssues) * 100) : 0;
      const lowPercentage = totalIssues > 0 ? Math.round((lowIssues / totalIssues) * 100) : 0;
      
      // Push statistics rows
      statsTable.push([`• Files analyzed: ${totalFiles}`]);
      statsTable.push([`• Files with issues: ${filesWithIssues} (${issuePercentage}%)`]);
      statsTable.push([`• Total issues: ${totalIssues}`]);
      
      if (totalIssues > 0) {
        statsTable.push([`  - 🔴 High: ${highIssues} (${highPercentage}%)`]);
        statsTable.push([`  - 🟠 Medium: ${mediumIssues} (${mediumPercentage}%)`]);
        statsTable.push([`  - 🟡 Low: ${lowIssues} (${lowPercentage}%)`]);
      }
      
      statsTable.push([`• Code quality scores:`]);
      statsTable.push([`  - Average: ${avgScore.toFixed(1)}/10`]);
      
      if (totalFiles > 1) {
        statsTable.push([`  - Highest: ${highestScore.toFixed(1)}/10`]);
        statsTable.push([`  - Lowest: ${lowestScore.toFixed(1)}/10`]);
      }
      
      // Add merge request state if available
      if (session.mr && session.mr.state) {
        const stateColor = session.mr.state === 'opened' ? theme.success : theme.warning;
        statsTable.push([`• MR Status: ${stateColor(session.mr.state.toUpperCase())}`]);
      }
      
      // Add review type
      if (session.overallReview.isDraft) {
        statsTable.push([`• Review type: ${theme.dim('DRAFT')}`]);
      }
      
      this.context.logger.passThrough('log', '\n');
      this.context.logger.passThrough('log', statsTable.toString());
    } catch (error) {
      this.context.logger.error('Error displaying review statistics:', error);
      // Fallback to simple display
      const stats = [
        `Total files analyzed: ${session.overallReview.fileAnalyses?.length || 0}`,
        `Total issues: ${session.overallReview.fileAnalyses?.reduce((sum, a) => sum + (a.issues?.length || 0), 0) || 0}`,
        `Average score: ${session.overallReview.score?.toFixed(1) || '0.0'}/10`
      ];
      
      console.log('\n=== Review Statistics ===');
      console.log(stats.join('\n'));
      console.log('=======================\n');
    }
  }

  private synthesizeReviews(analyses: FileAnalysis[]): Promise<ReviewSynthesis> {
    // Ensure analyses is always valid
    if (!analyses || analyses.length === 0) {
      this.context.logger.warn('No analyses to synthesize');
      // Return a default synthesis to avoid errors
      return Promise.resolve({
        summary: 'No files were analyzed.',
        consensus: [],
        differences: [],
        actionItems: [],
        learningOpportunities: []
      });
    }
    
    this.context.logger.debug(`Synthesizing ${analyses.length} file analyses`);
    return this.codeReviewAgent.synthesizeReviews(analyses);
  }

  /**
   * Extracts code snippet from diff around the specified line number
   */
  private extractSnippetFromDiff(diff: string, lineNumber: number | string | undefined): string {
    if (lineNumber === undefined || lineNumber === null) {
      // If no line number is provided, return the entire diff (limited to a reasonable size)
      return diff.length > 2000 ? diff.substring(0, 2000) + '...' : diff;
    }
    
    // Convert string line number to numeric if needed
    const lineNum = typeof lineNumber === 'string' ? parseInt(lineNumber, 10) : lineNumber;
    
    // If conversion failed, return the entire diff
    if (isNaN(lineNum)) {
      return diff.length > 2000 ? diff.substring(0, 2000) + '...' : diff;
    }
    
    const lines = diff.split('\n');
    const startLine = Math.max(0, lineNum - 5); // 5 lines before
    const endLine = Math.min(lines.length, lineNum + 5); // 5 lines after
    
    const snippet = lines.slice(startLine, endLine).join('\n');
    return snippet || diff; // Fall back to full diff if extraction fails
  }
} 