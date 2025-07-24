import { z } from 'zod';

// Base schemas for reusability
export const SeverityEnum = z.enum(['high', 'medium', 'low'])
  .describe('The severity level of the issue');

export const PerspectiveEnum = z.enum(['junior', 'senior', 'architect'])
  .describe('The perspective that identified this issue');

// Core issue schema
export const CodeIssueSchema = z.object({
  severity: SeverityEnum,
  message: z.string().describe('A clear description of the issue'),
  explanation: z.string().optional().describe('Detailed explanation of the issue'),
  suggestion: z.string().describe('A specific suggestion for how to fix the issue'),
  line: z.union([
    z.number(),
    z.string()
  ]).optional().describe('The line number or description of where the issue occurs'),
  column: z.number().optional().describe('The column number where the issue occurs'),
  code: z.string().optional().describe('Example code showing the fix'),
  perspective: PerspectiveEnum.optional().describe('The perspective that identified this issue')
});

export const CodeMetricsSchema = z.object({
  complexity: z.number().min(0).max(100).describe('Code complexity score (0-100)'),
  maintainability: z.number().min(0).max(100).describe('Code maintainability score (0-100)'),
  testCoverage: z.number().min(0).max(100).optional().describe('Test coverage percentage (0-100)'),
  documentation: z.number().min(0).max(100).optional().describe('Documentation quality score (0-100)'),
  bestPractices: z.number().min(0).max(100).optional().describe('Adherence to best practices score (0-100)')
});

export const RecommendationSchema = z.union([
  z.string(),
  z.object({
    title: z.string().describe('Title of the recommendation'),
    description: z.string().describe('Detailed description of the recommendation'),
    perspective: z.enum(['junior', 'senior', 'architect']).optional().describe('The perspective making this recommendation')
  })
]).describe('A recommendation can be either a string or an object with title and description');

// File analysis schema
export const FileAnalysisSchema = z.object({
  path: z.string().describe('The path to the file being analyzed'),
  issues: z.array(CodeIssueSchema).describe('Array of issues found in the code'),
  suggestions: z.array(z.string()).describe('Additional suggestions for improvement'),
  score: z.number().min(1).max(10).describe('Overall code quality score (1-10)'),
  summary: z.string().describe('A brief summary of the analysis'),
  learningOpportunities: z.array(z.string()).describe('Learning opportunities identified during review')
});

// Review synthesis schema
export const ReviewSynthesisSchema = z.object({
  summary: z.string().describe('A unified summary of the key findings'),
  consensus: z.array(z.string()).describe('Areas of consensus across perspectives'),
  differences: z.array(z.string()).describe('Important disagreements or different emphasis points'),
  actionItems: z.array(z.object({
    priority: SeverityEnum.describe('Priority level of the action item'),
    description: z.string().describe('Description of what needs to be done'),
    rationale: z.string().describe('Why this is important and needs to be addressed')
  })).describe('Prioritized action items from the review'),
  learningOpportunities: z.array(z.string()).describe('Learning opportunities for the team')
});

// Interactive review schemas
export const CodeChangeAnalysisSchema = z.object({
  hasIssues: z.boolean().describe('Whether any issues were found'),
  severity: SeverityEnum.optional().describe('Severity of the issues if any'),
  feedback: z.string().describe('Detailed feedback about the changes'),
  suggestions: z.array(z.string()).describe('Specific suggestions for improvement'),
  score: z.number().min(1).max(10).describe('Quality score for the changes'),
  issues: z.array(CodeIssueSchema).describe('Array of issues found in the code')
});

export const MRCommentSchema = z.object({
  file: z.string().describe('File path where the comment should be added'),
  line: z.number().nullable().describe('Line number where the comment should be added, null for general comments'),
  content: z.string().describe('Content of the comment'),
  isDraft: z.boolean().describe('Whether this is a draft comment')
});

export const OverallReviewSchema = z.object({
  summary: z.string().describe('Overall summary of the review'),
  score: z.number().min(1).max(10).describe('Overall quality score'),
  suggestions: z.array(z.string()).describe('Overall suggestions for improvement'),
  isDraft: z.boolean().describe('Whether this is a draft review'),
  fileAnalyses: z.array(FileAnalysisSchema).describe('File analyses included in this review').optional()
});

export const ReviewSessionSchema = z.object({
  mr: z.any().describe('GitLab merge request object'),
  comments: z.array(MRCommentSchema).describe('Review comments'),
  overallReview: OverallReviewSchema.describe('Overall review summary'),
  fixDecisions: z.array(
    z.object({
      issue: CodeIssueSchema.describe('The issue that was addressed'),
      action: z.string().describe('The action taken (Apply Fix, Add Comment, Both, Skip)'),
      wasApplied: z.boolean().describe('Whether the fix was successfully applied')
    })
  ).optional().describe('Decisions made about fixes during the review')
});

// Export types
export type CodeIssue = z.infer<typeof CodeIssueSchema>;
export type CodeMetrics = z.infer<typeof CodeMetricsSchema>;
export type FileAnalysis = z.infer<typeof FileAnalysisSchema>;
export type ReviewSynthesis = z.infer<typeof ReviewSynthesisSchema>;

// Export additional types
export type CodeChangeAnalysis = z.infer<typeof CodeChangeAnalysisSchema>;
export type MRComment = z.infer<typeof MRCommentSchema>;
export type OverallReview = z.infer<typeof OverallReviewSchema>;
export type ReviewSession = z.infer<typeof ReviewSessionSchema>;
