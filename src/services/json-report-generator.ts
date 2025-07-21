import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '../utils/logger.ts';
import { type ProcessingResult, FileStatus } from './sequential_processor.ts';
import type { ReviewAnalysis, CodeIssue } from '../agents/types.ts';
import { NOVA_VERSION } from '../version.ts';

/**
 * JSON report structure for sequential processing results
 */
export interface JSONReport {
    metadata: ReportMetadata;
    summary: ReportSummary;
    files: FileReport[];
    aggregatedMetrics: AggregatedMetrics;
}

/**
 * Report metadata containing processing information
 */
export interface ReportMetadata {
    timestamp: string;
    totalFiles: number;
    processingMode: 'sequential' | 'parallel';
    duration: number;
    version: string;
    generatedBy: string;
}

/**
 * Summary statistics for the entire report
 */
export interface ReportSummary {
    totalFiles: number;
    successfulFiles: number;
    failedFiles: number;
    warningFiles: number;
    averageGrade: string;
    totalIssues: number;
    averageCoverage: number;
    averageDuration: number;
    successRate: number;
}

/**
 * Individual file report data
 */
export interface FileReport {
    path: string;
    status: FileStatus;
    analysis?: ReviewAnalysis;
    error?: string;
    duration: number;
    timestamp: string;
    startTime: string;
    endTime?: string;
}

/**
 * Aggregated metrics across all files
 */
export interface AggregatedMetrics {
    gradeDistribution: Record<string, number>;
    commonIssues: Array<{ type: string; count: number; severity: string }>;
    coverageStats: {
        min: number;
        max: number;
        average: number;
        median: number;
    };
    durationStats: {
        min: number;
        max: number;
        average: number;
        total: number;
    };
    issuesByType: Record<string, number>;
    issuesBySeverity: Record<string, number>;
}

/**
 * Options for report generation
 */
export interface ReportOptions {
    includeErrorDetails?: boolean;
    includeFileContent?: boolean;
    sortBy?: 'path' | 'grade' | 'duration' | 'issues';
    sortOrder?: 'asc' | 'desc';
    filterByStatus?: FileStatus[];
    includeMetrics?: boolean;
}

/**
 * JSON report generator for sequential processing results
 */
export class JSONReportGenerator {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child('JSONReportGenerator');
    }

    /**
     * Generate a comprehensive JSON report from processing results
     */
    generateReport(
        results: ProcessingResult[],
        options: ReportOptions = {}
    ): JSONReport {
        this.logger.debug(`Generating JSON report for ${results.length} results`);

        const startTime = results.length > 0 ? 
            Math.min(...results.map(r => r.startTime.getTime())) : Date.now();
        const endTime = results.length > 0 ? 
            Math.max(...results.map(r => r.endTime?.getTime() ?? r.startTime.getTime())) : Date.now();
        const totalDuration = endTime - startTime;

        // Filter results if requested
        const filteredResults = options.filterByStatus ? 
            results.filter(r => options.filterByStatus!.includes(r.status)) : 
            results;

        // Sort results if requested
        const sortedResults = this.sortResults(filteredResults, options);

        const metadata = this.generateMetadata(results, totalDuration);
        const summary = this.generateSummary(results);
        const files = this.generateFileReports(sortedResults, options);
        const aggregatedMetrics = options.includeMetrics !== false ? 
            this.generateAggregatedMetrics(results) : 
            this.getEmptyMetrics();

        const report: JSONReport = {
            metadata,
            summary,
            files,
            aggregatedMetrics
        };

        this.logger.debug('JSON report generation completed');
        return report;
    }

    /**
     * Save report to file system with proper error handling
     */
    async saveReport(report: JSONReport, outputPath: string): Promise<void> {
        try {
            this.logger.debug(`Saving JSON report to: ${outputPath}`);

            // Ensure directory exists
            const dir = dirname(outputPath);
            await mkdir(dir, { recursive: true });

            // Write report with pretty formatting
            const jsonContent = JSON.stringify(report, null, 2);
            await writeFile(outputPath, jsonContent, 'utf8');

            this.logger.info(`JSON report saved successfully to: ${outputPath}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to save JSON report to ${outputPath}: ${errorMessage}`);
            throw new Error(`Failed to save JSON report: ${errorMessage}`);
        }
    }

    /**
     * Generate report metadata
     */
    private generateMetadata(results: ProcessingResult[], duration: number): ReportMetadata {
        return {
            timestamp: new Date().toISOString(),
            totalFiles: results.length,
            processingMode: 'sequential',
            duration,
            version: NOVA_VERSION,
            generatedBy: 'Nova CLI Enhanced Code Review Agent'
        };
    }

    /**
     * Generate summary statistics
     */
    private generateSummary(results: ProcessingResult[]): ReportSummary {
        const successful = results.filter(r => r.success && r.status === FileStatus.SUCCESS);
        const warnings = results.filter(r => r.success && r.status === FileStatus.WARNING);
        const failed = results.filter(r => !r.success || r.status === FileStatus.ERROR);

        // Calculate average grade
        const grades = successful
            .concat(warnings)
            .map(r => r.result?.grade)
            .filter(grade => grade !== undefined) as string[];
        
        const averageGrade = this.calculateAverageGrade(grades);

        // Calculate total issues
        const totalIssues = results
            .map(r => r.result?.issues?.length ?? 0)
            .reduce((sum, count) => sum + count, 0);

        // Calculate average coverage
        const coverageValues = results
            .map(r => r.result?.coverage)
            .filter((coverage): coverage is number => typeof coverage === 'number');
        
        const averageCoverage = coverageValues.length > 0 ? 
            coverageValues.reduce((sum, coverage) => sum + coverage, 0) / coverageValues.length : 0;

        // Calculate average duration
        const averageDuration = results.length > 0 ? 
            results.reduce((sum, r) => sum + r.duration, 0) / results.length : 0;

        // Calculate success rate
        const successRate = results.length > 0 ? successful.length / results.length : 0;

        return {
            totalFiles: results.length,
            successfulFiles: successful.length,
            failedFiles: failed.length,
            warningFiles: warnings.length,
            averageGrade,
            totalIssues,
            averageCoverage: Math.round(averageCoverage * 100) / 100,
            averageDuration: Math.round(averageDuration),
            successRate: Math.round(successRate * 10000) / 100 // Percentage with 2 decimal places
        };
    }

    /**
     * Generate file reports with error handling
     */
    private generateFileReports(results: ProcessingResult[], options: ReportOptions): FileReport[] {
        return results.map(result => {
            const fileReport: FileReport = {
                path: result.file,
                status: result.status,
                duration: result.duration,
                timestamp: result.startTime.toISOString(),
                startTime: result.startTime.toISOString(),
                endTime: result.endTime?.toISOString()
            };

            // Add analysis if successful
            if (result.success && result.result) {
                fileReport.analysis = result.result;
            }

            // Add error information if failed
            if (!result.success && result.error) {
                fileReport.error = options.includeErrorDetails !== false ? 
                    result.error.message : 
                    'Processing failed';
            }

            return fileReport;
        });
    }

    /**
     * Generate aggregated metrics
     */
    private generateAggregatedMetrics(results: ProcessingResult[]): AggregatedMetrics {
        const successfulResults = results.filter(r => r.success && r.result);
        
        // Grade distribution
        const gradeDistribution = this.calculateGradeDistribution(successfulResults);
        
        // Common issues
        const commonIssues = this.calculateCommonIssues(successfulResults);
        
        // Coverage statistics
        const coverageStats = this.calculateCoverageStats(successfulResults);
        
        // Duration statistics
        const durationStats = this.calculateDurationStats(results);
        
        // Issues by type and severity
        const { issuesByType, issuesBySeverity } = this.calculateIssueBreakdown(successfulResults);

        return {
            gradeDistribution,
            commonIssues,
            coverageStats,
            durationStats,
            issuesByType,
            issuesBySeverity
        };
    }

    /**
     * Calculate grade distribution
     */
    private calculateGradeDistribution(results: ProcessingResult[]): Record<string, number> {
        const distribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        
        results.forEach(result => {
            const grade = result.result?.grade;
            if (grade && grade in distribution) {
                distribution[grade]++;
            }
        });

        return distribution;
    }

    /**
     * Calculate common issues across all files
     */
    private calculateCommonIssues(results: ProcessingResult[]): Array<{ type: string; count: number; severity: string }> {
        const issueMap = new Map<string, { count: number; severities: string[] }>();

        results.forEach(result => {
            result.result?.issues?.forEach(issue => {
                const key = `${issue.type}:${issue.message}`;
                const existing = issueMap.get(key);
                
                if (existing) {
                    existing.count++;
                    existing.severities.push(issue.severity);
                } else {
                    issueMap.set(key, { count: 1, severities: [issue.severity] });
                }
            });
        });

        // Convert to array and sort by count
        return Array.from(issueMap.entries())
            .map(([key, data]) => {
                const [type] = key.split(':');
                const mostCommonSeverity = this.getMostCommonSeverity(data.severities);
                return { type, count: data.count, severity: mostCommonSeverity };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 10); // Top 10 most common issues
    }

    /**
     * Calculate coverage statistics
     */
    private calculateCoverageStats(results: ProcessingResult[]): {
        min: number;
        max: number;
        average: number;
        median: number;
    } {
        const coverageValues = results
            .map(r => r.result?.coverage)
            .filter((coverage): coverage is number => typeof coverage === 'number')
            .sort((a, b) => a - b);

        if (coverageValues.length === 0) {
            return { min: 0, max: 0, average: 0, median: 0 };
        }

        const min = coverageValues[0];
        const max = coverageValues[coverageValues.length - 1];
        const average = coverageValues.reduce((sum, val) => sum + val, 0) / coverageValues.length;
        const median = coverageValues.length % 2 === 0 ?
            (coverageValues[coverageValues.length / 2 - 1] + coverageValues[coverageValues.length / 2]) / 2 :
            coverageValues[Math.floor(coverageValues.length / 2)];

        return {
            min: Math.round(min * 100) / 100,
            max: Math.round(max * 100) / 100,
            average: Math.round(average * 100) / 100,
            median: Math.round(median * 100) / 100
        };
    }

    /**
     * Calculate duration statistics
     */
    private calculateDurationStats(results: ProcessingResult[]): {
        min: number;
        max: number;
        average: number;
        total: number;
    } {
        if (results.length === 0) {
            return { min: 0, max: 0, average: 0, total: 0 };
        }

        const durations = results.map(r => r.duration);
        const min = Math.min(...durations);
        const max = Math.max(...durations);
        const total = durations.reduce((sum, duration) => sum + duration, 0);
        const average = total / durations.length;

        return {
            min: Math.round(min),
            max: Math.round(max),
            average: Math.round(average),
            total: Math.round(total)
        };
    }

    /**
     * Calculate issue breakdown by type and severity
     */
    private calculateIssueBreakdown(results: ProcessingResult[]): {
        issuesByType: Record<string, number>;
        issuesBySeverity: Record<string, number>;
    } {
        const issuesByType: Record<string, number> = {};
        const issuesBySeverity: Record<string, number> = {};

        results.forEach(result => {
            result.result?.issues?.forEach(issue => {
                // Count by type
                issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
                
                // Count by severity
                issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1;
            });
        });

        return { issuesByType, issuesBySeverity };
    }

    /**
     * Calculate average grade from grade array
     */
    private calculateAverageGrade(grades: string[]): string {
        if (grades.length === 0) return 'N/A';

        const gradeValues: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
        const valueToGrade: Record<number, string> = { 4: 'A', 3: 'B', 2: 'C', 1: 'D', 0: 'F' };

        const totalValue = grades.reduce((sum, grade) => sum + (gradeValues[grade] || 0), 0);
        const averageValue = totalValue / grades.length;
        const roundedValue = Math.round(averageValue);

        return valueToGrade[roundedValue] || 'N/A';
    }

    /**
     * Get most common severity from array
     */
    private getMostCommonSeverity(severities: string[]): string {
        const counts: Record<string, number> = {};
        severities.forEach(severity => {
            counts[severity] = (counts[severity] || 0) + 1;
        });

        return Object.entries(counts)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || 'medium';
    }

    /**
     * Sort results based on options
     */
    private sortResults(results: ProcessingResult[], options: ReportOptions): ProcessingResult[] {
        if (!options.sortBy) return results;

        const sortOrder = options.sortOrder === 'desc' ? -1 : 1;

        return [...results].sort((a, b) => {
            let comparison = 0;

            switch (options.sortBy) {
                case 'path':
                    comparison = a.file.localeCompare(b.file);
                    break;
                case 'grade':
                    const gradeA = a.result?.grade || 'Z';
                    const gradeB = b.result?.grade || 'Z';
                    comparison = gradeA.localeCompare(gradeB);
                    break;
                case 'duration':
                    comparison = a.duration - b.duration;
                    break;
                case 'issues':
                    const issuesA = a.result?.issues?.length || 0;
                    const issuesB = b.result?.issues?.length || 0;
                    comparison = issuesA - issuesB;
                    break;
                default:
                    return 0;
            }

            return comparison * sortOrder;
        });
    }

    /**
     * Get empty metrics structure
     */
    private getEmptyMetrics(): AggregatedMetrics {
        return {
            gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
            commonIssues: [],
            coverageStats: { min: 0, max: 0, average: 0, median: 0 },
            durationStats: { min: 0, max: 0, average: 0, total: 0 },
            issuesByType: {},
            issuesBySeverity: {}
        };
    }
}