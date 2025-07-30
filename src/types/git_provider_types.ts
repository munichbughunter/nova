/**
 * Unified Git provider types and interfaces
 * This file contains shared type definitions for Git provider services (GitLab, GitHub)
 */

import type { GitProvider } from '../services/git_provider_detector.ts';

// Unified types for both providers
export interface UnifiedRepository {
    id: string | number;
    name: string;
    fullName: string;
    description: string | null;
    url: string;
    private: boolean;
    archived: boolean;
    defaultBranch: string;
    createdAt: string;
    updatedAt: string;
    language: string | null;
    starsCount: number;
    forksCount: number;
    openIssuesCount: number;
    topics?: string[];
    visibility: string;
}

export interface UnifiedPullRequest {
    id: string | number;
    number: number;
    title: string;
    state: 'open' | 'closed' | 'merged' | 'draft';
    url: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    mergedAt: string | null;
    author: {
        username: string;
        name?: string;
    };
    sourceBranch: string;
    targetBranch: string;
    body: string | null;
    draft?: boolean;
    merged?: boolean;
    // Optional statistics
    additions?: number;
    deletions?: number;
    changedFiles?: number;
    comments?: number;
    reviewComments?: number;
}

export interface UnifiedIssue {
    id: string | number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    url: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    author: {
        username: string;
        name?: string;
    };
    assignees: Array<{ username: string; name?: string }>;
    labels: Array<{ name: string; color?: string }>;
    comments: number;
}

export interface UnifiedChange {
    oldPath: string;
    newPath: string;
    deletedFile: boolean;
    newFile: boolean;
    renamedFile: boolean;
    diff: string;
}

export interface UnifiedProjectMetrics {
    repository: UnifiedRepository;
    codeQuality?: {
        hasReadme: boolean;
        hasLicense: boolean;
        hasContributing: boolean;
        hasSecurityPolicy: boolean;
        hasCodeOwners: boolean;
        hasCopilotInstructions: boolean;
        hasTests: boolean;
        hasWorkflows: boolean;
        grade: string;
        score: number;
    };
    workflowMetrics?: {
        totalWorkflows: number;
        activeWorkflows: number;
        successRate: number;
        averageDuration: number;
        timeframe: string;
    };
    teamMetrics?: {
        contributors: number;
        activeContributors: number;
        averageTimeToMerge: number;
        averageCommentsPerPR: number;
        timeframe: string;
    };
    activityMetrics?: {
        totalCommits: number;
        totalPullRequests: number;
        totalIssues: number;
        openPullRequests: number;
        openIssues: number;
        lastCommit?: {
            sha: string;
            date: string;
        };
        timeframe: string;
    };
}

/**
 * Unified interface for Git provider services
 */
export interface IGitProviderService {
    // Repository operations
    getRepositories(forceRefresh?: boolean): Promise<UnifiedRepository[]>;
    getRepository(owner: string, repo: string): Promise<UnifiedRepository>;
    searchRepositories(query: string, limit?: number): Promise<UnifiedRepository[]>;
    getRecentRepositories(): Promise<UnifiedRepository[]>;

    // Pull Request / Merge Request operations
    getCurrentPullRequest(): Promise<UnifiedPullRequest | null>;
    getPullRequest(owner: string, repo: string, number: number): Promise<UnifiedPullRequest>;
    getRepositoryPullRequests(owner: string, repo: string, state?: 'open' | 'closed' | 'all', limit?: number): Promise<UnifiedPullRequest[]>;
    createPullRequest(owner: string, repo: string, options: {
        title: string;
        head: string;
        base: string;
        body?: string;
        draft?: boolean;
    }): Promise<UnifiedPullRequest>;
    createPullRequestComment(owner: string, repo: string, number: number, body: string): Promise<void>;
    getPullRequestChanges?(owner: string, repo: string, number: number): Promise<UnifiedChange[]>;

    // Issue operations - ENTFERNEN SIE die `?` um sie zu Pflichtmethoden zu machen:
    createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[], assignees?: string[]): Promise<UnifiedIssue>;
    getRepositoryIssues(owner: string, repo: string, state?: 'open' | 'closed' | 'all', limit?: number): Promise<UnifiedIssue[]>; // Kein ? mehr
    searchIssues(query: string, limit?: number): Promise<UnifiedIssue[]>; // Kein ? mehr
    searchPullRequests(query: string, limit?: number): Promise<UnifiedPullRequest[]>; // Kein ? mehr

    // Metrics and analytics
    getProjectMetrics(owner: string, repo: string, timeframe?: string): Promise<UnifiedProjectMetrics>;
    formatProjectMetrics(metrics: UnifiedProjectMetrics): string;

    // Cache operations
    clearCache(pattern?: string): Promise<void>;

    // Provider-specific info
    getProviderType(): GitProvider;
    getProviderHost(): string;
}