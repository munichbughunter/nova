import { assertEquals, assertExists, assert } from 'jsr:@std/assert';
import { describe, it, beforeEach } from 'jsr:@std/testing/bdd';
import { JSONReportGenerator } from './json-report-generator.ts';
import { FileStatus, type ProcessingResult } from './sequential_processor.ts';
import type { ReviewAnalysis } from '../agents/types.ts';
import type { Logger } from '../utils/logger.ts';

// Mock logger
const mockLogger = {
    child: () => mockLogger,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
} as unknown as Logger;

// Helper function to create mock results
function createMockResult(
    file: string,
    success: boolean,
    status: FileStatus,
    result?: ReviewAnalysis,
    duration: number = 1000,
    error?: Error
): ProcessingResult {
    const startTime = new Date('2024-01-01T10:00:00Z');
    const endTime = new Date(startTime.getTime() + duration);

    return {
        file,
        success,
        result,
        error,
        duration,
        status,
        startTime,
        endTime
    };
}

describe('JSONReportGenerator', () => {
    const generator = new JSONReportGenerator(mockLogger);

    it('should generate a complete JSON report', () => {
        const mockResults: ProcessingResult[] = [
            createMockResult('file1.ts', true, FileStatus.SUCCESS, {
                grade: 'A',
                coverage: 85,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [
                    { line: 10, severity: 'low', type: 'style', message: 'Missing semicolon' }
                ],
                suggestions: ['Add semicolon'],
                summary: 'Good code quality'
            }, 1000),
            createMockResult('file2.ts', true, FileStatus.WARNING, {
                grade: 'B',
                coverage: 60,
                testsPresent: false,
                value: 'medium',
                state: 'warning',
                issues: [
                    { line: 5, severity: 'medium', type: 'performance', message: 'Inefficient loop' }
                ],
                suggestions: ['Optimize loop'],
                summary: 'Needs improvement'
            }, 1500),
            createMockResult('file3.ts', false, FileStatus.ERROR, undefined, 500, new Error('Parse error'))
        ];

        const report = generator.generateReport(mockResults);

        // Verify report structure
        assertExists(report.metadata);
        assertExists(report.summary);
        assertExists(report.files);
        assertExists(report.aggregatedMetrics);

        // Verify metadata
        assertEquals(report.metadata.totalFiles, 3);
        assertEquals(report.metadata.processingMode, 'sequential');
        assertEquals(report.metadata.version, '0.1.0');
        assertEquals(report.metadata.generatedBy, 'Nova CLI Enhanced Code Review Agent');

        // Verify summary
        assertEquals(report.summary.totalFiles, 3);
        assertEquals(report.summary.successfulFiles, 1);
        assertEquals(report.summary.failedFiles, 1);
        assertEquals(report.summary.warningFiles, 1);
        assertEquals(report.summary.totalIssues, 2);
        assertEquals(report.summary.averageCoverage, 72.5);

        // Verify files
        assertEquals(report.files.length, 3);
        assertEquals(report.files[0].path, 'file1.ts');
        assertEquals(report.files[0].status, FileStatus.SUCCESS);
        assertExists(report.files[0].analysis);
        assertEquals(report.files[2].error, 'Parse error');

        // Verify aggregated metrics
        assertEquals(report.aggregatedMetrics.gradeDistribution.A, 1);
        assertEquals(report.aggregatedMetrics.gradeDistribution.B, 1);
        assertEquals(report.aggregatedMetrics.issuesByType.style, 1);
        assertEquals(report.aggregatedMetrics.issuesByType.performance, 1);
    });

    it('should handle empty results', () => {
        const report = generator.generateReport([]);

        assertEquals(report.summary.totalFiles, 0);
        assertEquals(report.summary.successfulFiles, 0);
        assertEquals(report.summary.averageGrade, 'N/A');
        assertEquals(report.files.length, 0);
    });

    it('should calculate average grade correctly', () => {
        const gradeResults: ProcessingResult[] = [
            createMockResult('file1.ts', true, FileStatus.SUCCESS, {
                grade: 'A', coverage: 80, testsPresent: true, value: 'high', 
                state: 'pass', issues: [], suggestions: [], summary: 'Test'
            }),
            createMockResult('file2.ts', true, FileStatus.SUCCESS, {
                grade: 'B', coverage: 70, testsPresent: true, value: 'medium', 
                state: 'pass', issues: [], suggestions: [], summary: 'Test'
            }),
            createMockResult('file3.ts', true, FileStatus.SUCCESS, {
                grade: 'C', coverage: 60, testsPresent: true, value: 'low', 
                state: 'pass', issues: [], suggestions: [], summary: 'Test'
            })
        ];

        const report = generator.generateReport(gradeResults);

        // A=4, B=3, C=2 -> average = 9/3 = 3 -> B
        assertEquals(report.summary.averageGrade, 'B');
    });

    it('should sort results by path', () => {
        const unsortedResults: ProcessingResult[] = [
            createMockResult('zebra.ts', true, FileStatus.SUCCESS),
            createMockResult('alpha.ts', true, FileStatus.SUCCESS),
            createMockResult('beta.ts', true, FileStatus.SUCCESS)
        ];

        const report = generator.generateReport(unsortedResults, {
            sortBy: 'path',
            sortOrder: 'asc'
        });

        assertEquals(report.files[0].path, 'alpha.ts');
        assertEquals(report.files[1].path, 'beta.ts');
        assertEquals(report.files[2].path, 'zebra.ts');
    });

    it('should filter results by status', () => {
        const mixedResults: ProcessingResult[] = [
            createMockResult('success.ts', true, FileStatus.SUCCESS),
            createMockResult('warning.ts', true, FileStatus.WARNING),
            createMockResult('error.ts', false, FileStatus.ERROR)
        ];

        const report = generator.generateReport(mixedResults, {
            filterByStatus: [FileStatus.SUCCESS, FileStatus.WARNING]
        });

        assertEquals(report.files.length, 2);
        assert(report.files.every(f => f.status !== FileStatus.ERROR));
    });

    it('should exclude metrics when requested', () => {
        const results: ProcessingResult[] = [
            createMockResult('file1.ts', true, FileStatus.SUCCESS, {
                grade: 'A', coverage: 80, testsPresent: true, value: 'high', 
                state: 'pass', issues: [], suggestions: [], summary: 'Test'
            })
        ];

        const report = generator.generateReport(results, {
            includeMetrics: false
        });

        assertEquals(report.aggregatedMetrics.gradeDistribution, {
            A: 0, B: 0, C: 0, D: 0, F: 0
        });
        assertEquals(report.aggregatedMetrics.commonIssues.length, 0);
    });

    it('should handle coverage statistics correctly', () => {
        const results: ProcessingResult[] = [
            createMockResult('file1.ts', true, FileStatus.SUCCESS, {
                grade: 'A', coverage: 90, testsPresent: true, value: 'high', 
                state: 'pass', issues: [], suggestions: [], summary: 'Test'
            }),
            createMockResult('file2.ts', true, FileStatus.SUCCESS, {
                grade: 'B', coverage: 70, testsPresent: true, value: 'medium', 
                state: 'pass', issues: [], suggestions: [], summary: 'Test'
            }),
            createMockResult('file3.ts', true, FileStatus.SUCCESS, {
                grade: 'C', coverage: 50, testsPresent: true, value: 'low', 
                state: 'pass', issues: [], suggestions: [], summary: 'Test'
            })
        ];

        const report = generator.generateReport(results);

        assertEquals(report.aggregatedMetrics.coverageStats.min, 50);
        assertEquals(report.aggregatedMetrics.coverageStats.max, 90);
        assertEquals(report.aggregatedMetrics.coverageStats.average, 70);
        assertEquals(report.aggregatedMetrics.coverageStats.median, 70);
    });

    it('should handle duration statistics correctly', () => {
        const results: ProcessingResult[] = [
            createMockResult('file1.ts', true, FileStatus.SUCCESS, undefined, 1000),
            createMockResult('file2.ts', true, FileStatus.SUCCESS, undefined, 2000),
            createMockResult('file3.ts', true, FileStatus.SUCCESS, undefined, 3000)
        ];

        const report = generator.generateReport(results);

        assertEquals(report.aggregatedMetrics.durationStats.min, 1000);
        assertEquals(report.aggregatedMetrics.durationStats.max, 3000);
        assertEquals(report.aggregatedMetrics.durationStats.average, 2000);
        assertEquals(report.aggregatedMetrics.durationStats.total, 6000);
    });
});