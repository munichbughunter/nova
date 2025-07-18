import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import type { ReviewResult, TableFormatter } from '../agents/types.ts';
import type { Logger } from '../utils/logger.ts';

/**
 * CLI table formatter for code review results
 */
export class TableFormatterImpl implements TableFormatter {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child('TableFormatter');
    }

    /**
     * Format review results into a CLI table
     */
    formatReviewResults(results: ReviewResult[]): string {
        if (results.length === 0) {
            return colors.yellow('No files to review.');
        }

        this.logger.debug(`Formatting ${results.length} review results`);

        const table = new Table()
            .header([
                colors.bold.white('File'),
                colors.bold.white('Grade'),
                colors.bold.white('Coverage'),
                colors.bold.white('Tests Present'),
                colors.bold.white('Value'),
                colors.bold.white('State'),
            ])
            .border(true)
            .padding(1);

        // Sort results by state (fail, warning, pass) then by grade
        const sortedResults = this.sortResults(results);

        for (const result of sortedResults) {
            table.push([
                this.formatFileName(result.file),
                this.formatGrade(result.grade),
                this.formatCoverage(result.coverage),
                this.formatTestsPresent(result.testsPresent),
                this.formatValue(result.value),
                this.formatState(result.state),
            ]);
        }

        // Add summary row if multiple files
        if (results.length > 1) {
            table.push(['', '', '', '', '', '']); // Separator
            table.push([
                colors.bold.white('Summary'),
                this.formatSummaryGrade(results),
                this.formatSummaryCoverage(results),
                this.formatSummaryTests(results),
                this.formatSummaryValue(results),
                this.formatSummaryState(results),
            ]);
        }

        return table.toString();
    }

    /**
     * Format review results with filtering options
     */
    formatFilteredResults(
        results: ReviewResult[], 
        options: {
            minGrade?: string;
            maxGrade?: string;
            state?: 'pass' | 'warning' | 'fail';
            hasTests?: boolean;
            minCoverage?: number;
        } = {}
    ): string {
        let filteredResults = [...results];

        // Apply filters
        if (options.minGrade) {
            filteredResults = filteredResults.filter(r => 
                this.compareGrades(r.grade, options.minGrade!) >= 0
            );
        }

        if (options.maxGrade) {
            filteredResults = filteredResults.filter(r => 
                this.compareGrades(r.grade, options.maxGrade!) <= 0
            );
        }

        if (options.state) {
            filteredResults = filteredResults.filter(r => r.state === options.state);
        }

        if (options.hasTests !== undefined) {
            filteredResults = filteredResults.filter(r => r.testsPresent === options.hasTests);
        }

        if (options.minCoverage !== undefined) {
            filteredResults = filteredResults.filter(r => r.coverage >= options.minCoverage!);
        }

        if (filteredResults.length === 0) {
            return colors.yellow('No files match the specified filters.');
        }

        return this.formatReviewResults(filteredResults);
    }

    /**
     * Format a compact summary table
     */
    formatSummaryTable(results: ReviewResult[]): string {
        if (results.length === 0) {
            return colors.yellow('No files to summarize.');
        }

        const summary = this.calculateSummaryStats(results);

        const table = new Table()
            .header([
                colors.bold.white('Metric'),
                colors.bold.white('Value'),
                colors.bold.white('Details'),
            ])
            .border(true)
            .padding(1);

        table.push([
            'Total Files',
            colors.bold.white(summary.totalFiles.toString()),
            `${summary.passCount} pass, ${summary.warningCount} warning, ${summary.failCount} fail`
        ]);

        table.push([
            'Average Grade',
            this.formatGrade(summary.averageGrade),
            `Range: ${summary.minGrade} - ${summary.maxGrade}`
        ]);

        table.push([
            'Test Coverage',
            this.formatCoverage(summary.averageCoverage),
            `${summary.testedFiles}/${summary.totalFiles} files have tests`
        ]);

        table.push([
            'Issues Found',
            colors.bold.white(summary.totalIssues.toString()),
            `${summary.highSeverityIssues} high, ${summary.mediumSeverityIssues} medium, ${summary.lowSeverityIssues} low`
        ]);

        return table.toString();
    }

    /**
     * Sort results by priority (fail > warning > pass, then by grade)
     */
    private sortResults(results: ReviewResult[]): ReviewResult[] {
        return [...results].sort((a, b) => {
            // First sort by state priority
            const stateOrder = { 'fail': 0, 'warning': 1, 'pass': 2 };
            const stateDiff = stateOrder[a.state] - stateOrder[b.state];
            if (stateDiff !== 0) return stateDiff;

            // Then sort by grade (F to A)
            const gradeDiff = this.compareGrades(a.grade, b.grade);
            if (gradeDiff !== 0) return gradeDiff;

            // Finally sort by filename
            return a.file.localeCompare(b.file);
        });
    }

    /**
     * Compare grades (returns negative if a < b, positive if a > b, 0 if equal)
     */
    private compareGrades(gradeA: string, gradeB: string): number {
        const gradeOrder = { 'F': 0, 'D': 1, 'C': 2, 'B': 3, 'A': 4 };
        return (gradeOrder[gradeA as keyof typeof gradeOrder] || 0) - 
               (gradeOrder[gradeB as keyof typeof gradeOrder] || 0);
    }

    /**
     * Format file name with path truncation if needed
     */
    private formatFileName(fileName: string): string {
        // Truncate long file paths for better table display
        if (fileName.length > 40) {
            const parts = fileName.split('/');
            if (parts.length > 2) {
                return `.../${parts.slice(-2).join('/')}`;
            }
        }
        return fileName;
    }

    /**
     * Format grade with color coding
     */
    private formatGrade(grade: string): string {
        switch (grade.toUpperCase()) {
            case 'A': return colors.bold.green(grade);
            case 'B': return colors.green(grade);
            case 'C': return colors.yellow(grade);
            case 'D': return colors.red(grade);
            case 'F': return colors.bold.red(grade);
            default: return colors.gray(grade);
        }
    }

    /**
     * Format coverage percentage with color coding
     */
    private formatCoverage(coverage: number): string {
        const percentage = `${coverage.toFixed(0)}%`;
        
        if (coverage >= 80) return colors.bold.green(percentage);
        if (coverage >= 60) return colors.green(percentage);
        if (coverage >= 40) return colors.yellow(percentage);
        if (coverage >= 20) return colors.red(percentage);
        return colors.bold.red(percentage);
    }

    /**
     * Format tests present indicator
     */
    private formatTestsPresent(testsPresent: boolean): string {
        return testsPresent 
            ? colors.bold.green('✅') 
            : colors.bold.red('❌');
    }

    /**
     * Format business value with color coding
     */
    private formatValue(value: string): string {
        switch (value.toLowerCase()) {
            case 'high': return colors.bold.green(value);
            case 'medium': return colors.yellow(value);
            case 'low': return colors.gray(value);
            default: return value;
        }
    }

    /**
     * Format state with color coding and icons
     */
    private formatState(state: string): string {
        switch (state.toLowerCase()) {
            case 'pass': return colors.bold.green('✅ PASS');
            case 'warning': return colors.bold.yellow('⚠️  WARN');
            case 'fail': return colors.bold.red('❌ FAIL');
            default: return colors.gray(state);
        }
    }

    /**
     * Calculate and format summary grade
     */
    private formatSummaryGrade(results: ReviewResult[]): string {
        const grades = results.map(r => r.grade);
        const gradePoints = grades.map(g => {
            const gradeMap = { 'A': 4, 'B': 3, 'C': 2, 'D': 1, 'F': 0 };
            return gradeMap[g as keyof typeof gradeMap] || 0;
        });
        
        const avgPoints = gradePoints.reduce((sum, p) => sum + p, 0) / gradePoints.length;
        const avgGrade = ['F', 'D', 'C', 'B', 'A'][Math.round(avgPoints)] || 'F';
        
        return this.formatGrade(avgGrade);
    }

    /**
     * Calculate and format summary coverage
     */
    private formatSummaryCoverage(results: ReviewResult[]): string {
        const avgCoverage = results.reduce((sum, r) => sum + r.coverage, 0) / results.length;
        return this.formatCoverage(avgCoverage);
    }

    /**
     * Calculate and format summary tests
     */
    private formatSummaryTests(results: ReviewResult[]): string {
        const testedCount = results.filter(r => r.testsPresent).length;
        const percentage = (testedCount / results.length) * 100;
        
        return percentage >= 50 
            ? colors.bold.green(`${testedCount}/${results.length}`)
            : colors.bold.red(`${testedCount}/${results.length}`);
    }

    /**
     * Calculate and format summary value
     */
    private formatSummaryValue(results: ReviewResult[]): string {
        const highCount = results.filter(r => r.value === 'high').length;
        const mediumCount = results.filter(r => r.value === 'medium').length;
        const lowCount = results.filter(r => r.value === 'low').length;
        
        if (highCount > mediumCount && highCount > lowCount) {
            return this.formatValue('high');
        } else if (mediumCount > lowCount) {
            return this.formatValue('medium');
        } else {
            return this.formatValue('low');
        }
    }

    /**
     * Calculate and format summary state
     */
    private formatSummaryState(results: ReviewResult[]): string {
        const failCount = results.filter(r => r.state === 'fail').length;
        const warningCount = results.filter(r => r.state === 'warning').length;
        
        if (failCount > 0) {
            return this.formatState('fail');
        } else if (warningCount > 0) {
            return this.formatState('warning');
        } else {
            return this.formatState('pass');
        }
    }

    /**
     * Calculate comprehensive summary statistics
     */
    private calculateSummaryStats(results: ReviewResult[]) {
        const totalFiles = results.length;
        const passCount = results.filter(r => r.state === 'pass').length;
        const warningCount = results.filter(r => r.state === 'warning').length;
        const failCount = results.filter(r => r.state === 'fail').length;
        
        const grades = results.map(r => r.grade);
        const gradePoints = grades.map(g => {
            const gradeMap = { 'A': 4, 'B': 3, 'C': 2, 'D': 1, 'F': 0 };
            return gradeMap[g as keyof typeof gradeMap] || 0;
        });
        const avgPoints = gradePoints.reduce((sum, p) => sum + p, 0) / gradePoints.length;
        const averageGrade = ['F', 'D', 'C', 'B', 'A'][Math.round(avgPoints)] || 'F';
        
        const minGrade = grades.reduce((min, g) => 
            this.compareGrades(g, min) < 0 ? g : min, 'A'
        );
        const maxGrade = grades.reduce((max, g) => 
            this.compareGrades(g, max) > 0 ? g : max, 'F'
        );
        
        const averageCoverage = results.reduce((sum, r) => sum + r.coverage, 0) / totalFiles;
        const testedFiles = results.filter(r => r.testsPresent).length;
        
        const allIssues = results.flatMap(r => r.issues);
        const totalIssues = allIssues.length;
        const highSeverityIssues = allIssues.filter(i => i.severity === 'high').length;
        const mediumSeverityIssues = allIssues.filter(i => i.severity === 'medium').length;
        const lowSeverityIssues = allIssues.filter(i => i.severity === 'low').length;
        
        return {
            totalFiles,
            passCount,
            warningCount,
            failCount,
            averageGrade,
            minGrade,
            maxGrade,
            averageCoverage,
            testedFiles,
            totalIssues,
            highSeverityIssues,
            mediumSeverityIssues,
            lowSeverityIssues,
        };
    }
}

/**
 * Factory function to create table formatter
 */
export function createTableFormatter(logger: Logger): TableFormatter {
    return new TableFormatterImpl(logger);
}