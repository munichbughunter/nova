import { z } from 'zod';

// Common option types for all engineering sub-agents
export interface BaseEngineeringOptions extends Record<string, unknown> {
    path?: string | string[];
    paths?: string[];
    depth?: 'quick' | 'normal' | 'deep';
    analysisDepth?: 'quick' | 'normal' | 'deep';
    post?: boolean;
    project?: string;
    mergeRequest?: number;
    interactive?: boolean;
    draft?: boolean;
    json?: boolean;
    model?: string;
    aiModel?: string;
    fileList?: string[];
    totalFiles?: number;
    processedFiles?: number;
    diffPath?: string;
    reviewer?: string;
}

export interface ChangeReviewOptions extends BaseEngineeringOptions {
    systemPrompt?: string;
    summaryPrompt?: string;
    json?: boolean;
}

export interface DocumentorOptions extends BaseEngineeringOptions {
    type?: 'readme' | 'api' | 'architecture' | 'setup' | 'contributing';
    format?: 'markdown' | 'confluence' | 'docusaurus';
}

export interface ArchitectOptions extends BaseEngineeringOptions {
    scope?: 'component' | 'service' | 'system';
    focus?: 'performance' | 'scalability' | 'maintainability' | 'security';
    output?: 'text' | 'diagram' | 'both';
}

export interface TesterOptions extends BaseEngineeringOptions {
    type?: 'unit' | 'integration' | 'e2e';
    framework?: 'jest' | 'cypress' | 'playwright';
    coverage?: boolean;
}

export interface QATesterOptions extends BaseEngineeringOptions {
    url?: string;
    browser?: 'chromium' | 'firefox' | 'webkit';
    headless?: boolean;
    recordVideo?: boolean;
    exportScript?: boolean;
    browserActive?: boolean;
    generateAssertions?: boolean;
    mode?: 'interactive' | 'automate';
    saveTestPath?: string;
    stagehandModel?: string;
}

export interface RefactorOptions extends BaseEngineeringOptions {
    goal?: 'performance' | 'readability' | 'maintainability';
    scope?: 'function' | 'class' | 'module' | 'service';
}

export interface SecurityOptions extends BaseEngineeringOptions {
    level?: 'basic' | 'deep';
    focus?: 'dependencies' | 'code' | 'configuration' | 'all';
}

export type { ReviewAgentContext } from './code-review/types.ts';

// Analysis schemas
export const ProjectAnalysisSchema = z.object({
    overallHealth: z.number().min(1).max(10),
    codeQualityScore: z.number().min(1).max(10),
    reviewProcessScore: z.number().min(1).max(10),
    performanceScore: z.number().min(1).max(10),
    securityScore: z.number().min(1).max(10),
    criticalIssues: z.array(z.string()),
    recommendations: z.array(z.string()),
    priorityAreas: z.array(z.string()),
});

export const MetricsAnalysisSchema = z.object({
    score: z.number().min(1).max(10),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    recommendations: z.array(z.string()),
    actionItems: z.array(z.object({
        priority: z.enum(['high', 'medium', 'low']),
        description: z.string(),
        impact: z.string(),
    })),
});

// QA agent schemas
export const TestStepSchema = z.object({
    type: z.enum(['navigation', 'click', 'input', 'assertion', 'wait', 'screenshot', 'custom']),
    description: z.string(),
    selector: z.string().optional(),
    value: z.string().optional(),
    timeout: z.number().optional(),
    playwrightCode: z.string().optional(),
});

export const QATestPlanSchema = z.object({
    name: z.string(),
    description: z.string(),
    steps: z.array(TestStepSchema),
    assertions: z.array(z.string()).optional(),
    expectedResults: z.array(z.string()).optional(),
});

export const QATestResultSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    steps: z.array(z.object({
        step: TestStepSchema,
        success: z.boolean(),
        screenshot: z.string().optional(),
        error: z.string().optional(),
        observation: z.string().optional(),
    })),
    playwrightCode: z.string().optional(),
});

export type ProjectAnalysis = z.infer<typeof ProjectAnalysisSchema>;
export type MetricsAnalysis = z.infer<typeof MetricsAnalysisSchema>;
export type TestStep = z.infer<typeof TestStepSchema>;
export type QATestPlan = z.infer<typeof QATestPlanSchema>;
export type QATestResult = z.infer<typeof QATestResultSchema>;

// Command types
export type CommandType =
    | 'change-review'
    | 'documentor'
    | 'architect'
    | 'tester'
    | 'qa-tester'
    | 'refactor'
    | 'security'
    | 'chat'
    | 'exit';

export interface CommandOption {
    name: string;
    value: string;
}

export type SubAgentType =
    | 'code-review'
    | 'chat'
    | 'documentor'
    | 'architect'
    | 'tester'
    | 'qa-tester'
    | 'refactor'
    | 'security';
