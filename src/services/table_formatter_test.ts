import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { TableFormatterImpl } from './table_formatter.ts';
import type { ReviewResult } from '../agents/types.ts';
import { Logger } from '../../utils/logger.ts';

const mockLogger = new Logger('test', false);

// Mock review results for testing
const mockReviewResults: ReviewResult[] = [
    {
        file: 'src/components/Header.tsx',
        grade: 'A',
        coverage: 85,
        testsPresent: true,
        value: 'high',
        state: 'pass',
        issues: [],
        suggestions: ['Consider adding PropTypes validation'],
    },
    {
        file: 'src/utils/helper.js',
        grade: 'C',
        coverage: 45,
        testsPresent: false,
        value: 'medium',
        state: 'warning',
        issues: [
            {
                line: 10,
                severity: 'medium',
                type: 'style',
                message: 'Use const instead of var',
            },
            {
                line: 15,
                severity: 'low',
                type: 'style',
                message: 'Add semicolon',
            },
        ],
        suggestions: ['Add unit tests', 'Use modern JavaScript syntax'],
    },
    {
        file: 'src/auth/login.js',
        grade: 'F',
        coverage: 0,
        testsPresent: false,
        value: 'high',
        state: 'fail',
        issues: [
            {
                line: 5,
                severity: 'high',
                type: 'security',
                message: 'Hardcoded password detected',
            },
            {
                line: 12,
                severity: 'high',
                type: 'security',
                message: 'SQL injection vulnerability',
            },
        ],
        suggestions: ['Remove hardcoded credentials', 'Use parameterized queries'],
    },
];

Deno.test('TableFormatter - formatReviewResults - basic functionality', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    const result = formatter.formatReviewResults(mockReviewResults);
    
    // Should contain table headers
    assertStringIncludes(result, 'File');
    assertStringIncludes(result, 'Grade');
    assertStringIncludes(result, 'Coverage');
    assertStringIncludes(result, 'Tests Present');
    assertStringIncludes(result, 'Value');
    assertStringIncludes(result, 'State');
    
    // Should contain file names
    assertStringIncludes(result, 'Header.tsx');
    assertStringIncludes(result, 'helper.js');
    assertStringIncludes(result, 'login.js');
    
    // Should contain grades
    assertStringIncludes(result, 'A');
    assertStringIncludes(result, 'C');
    assertStringIncludes(result, 'F');
    
    // Should contain coverage percentages
    assertStringIncludes(result, '85%');
    assertStringIncludes(result, '45%');
    assertStringIncludes(result, '0%');
    
    // Should contain test indicators
    assertStringIncludes(result, '✅');
    assertStringIncludes(result, '❌');
    
    // Should contain states
    assertStringIncludes(result, 'PASS');
    assertStringIncludes(result, 'WARN');
    assertStringIncludes(result, 'FAIL');
});

Deno.test('TableFormatter - formatReviewResults - empty results', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    const result = formatter.formatReviewResults([]);
    
    assertStringIncludes(result, 'No files to review');
});

Deno.test('TableFormatter - formatReviewResults - single file', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    const singleResult = [mockReviewResults[0]];
    const result = formatter.formatReviewResults(singleResult);
    
    // Should contain the file data
    assertStringIncludes(result, 'Header.tsx');
    assertStringIncludes(result, 'A');
    assertStringIncludes(result, '85%');
    
    // Should not contain summary row for single file
    const lines = result.split('\n');
    const summaryLines = lines.filter(line => line.includes('Summary'));
    assertEquals(summaryLines.length, 0);
});

Deno.test('TableFormatter - formatReviewResults - multiple files with summary', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    const result = formatter.formatReviewResults(mockReviewResults);
    
    // Should contain summary row for multiple files
    assertStringIncludes(result, 'Summary');
});

Deno.test('TableFormatter - formatFilteredResults - state filter', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Filter for only failing files
    const failResult = formatter.formatFilteredResults(mockReviewResults, { state: 'fail' });
    assertStringIncludes(failResult, 'login.js');
    assertEquals(failResult.includes('Header.tsx'), false);
    assertEquals(failResult.includes('helper.js'), false);
    
    // Filter for only passing files
    const passResult = formatter.formatFilteredResults(mockReviewResults, { state: 'pass' });
    assertStringIncludes(passResult, 'Header.tsx');
    assertEquals(passResult.includes('login.js'), false);
    assertEquals(passResult.includes('helper.js'), false);
});

Deno.test('TableFormatter - formatFilteredResults - grade filter', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Filter for minimum grade B
    const minGradeResult = formatter.formatFilteredResults(mockReviewResults, { minGrade: 'B' });
    assertStringIncludes(minGradeResult, 'Header.tsx'); // Grade A
    assertEquals(minGradeResult.includes('helper.js'), false); // Grade C
    assertEquals(minGradeResult.includes('login.js'), false); // Grade F
    
    // Filter for maximum grade C
    const maxGradeResult = formatter.formatFilteredResults(mockReviewResults, { maxGrade: 'C' });
    assertStringIncludes(maxGradeResult, 'helper.js'); // Grade C
    assertStringIncludes(maxGradeResult, 'login.js'); // Grade F
    assertEquals(maxGradeResult.includes('Header.tsx'), false); // Grade A
});

Deno.test('TableFormatter - formatFilteredResults - tests filter', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Filter for files with tests
    const withTestsResult = formatter.formatFilteredResults(mockReviewResults, { hasTests: true });
    assertStringIncludes(withTestsResult, 'Header.tsx');
    assertEquals(withTestsResult.includes('helper.js'), false);
    assertEquals(withTestsResult.includes('login.js'), false);
    
    // Filter for files without tests
    const withoutTestsResult = formatter.formatFilteredResults(mockReviewResults, { hasTests: false });
    assertStringIncludes(withoutTestsResult, 'helper.js');
    assertStringIncludes(withoutTestsResult, 'login.js');
    assertEquals(withoutTestsResult.includes('Header.tsx'), false);
});

Deno.test('TableFormatter - formatFilteredResults - coverage filter', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Filter for minimum 50% coverage
    const minCoverageResult = formatter.formatFilteredResults(mockReviewResults, { minCoverage: 50 });
    assertStringIncludes(minCoverageResult, 'Header.tsx'); // 85% coverage
    assertEquals(minCoverageResult.includes('helper.js'), false); // 45% coverage
    assertEquals(minCoverageResult.includes('login.js'), false); // 0% coverage
});

Deno.test('TableFormatter - formatFilteredResults - no matches', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Filter that matches no files
    const noMatchResult = formatter.formatFilteredResults(mockReviewResults, { 
        state: 'pass', 
        minGrade: 'A',
        hasTests: false 
    });
    
    assertStringIncludes(noMatchResult, 'No files match the specified filters');
});

Deno.test('TableFormatter - formatSummaryTable - comprehensive stats', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    const result = formatter.formatSummaryTable(mockReviewResults);
    
    // Should contain summary metrics
    assertStringIncludes(result, 'Total Files');
    assertStringIncludes(result, 'Average Grade');
    assertStringIncludes(result, 'Test Coverage');
    assertStringIncludes(result, 'Issues Found');
    
    // Should contain specific values
    assertStringIncludes(result, '3'); // Total files
    assertStringIncludes(result, '1 pass, 1 warning, 1 fail');
    
    // Should show issue breakdown
    assertStringIncludes(result, 'high'); // High severity issues
    assertStringIncludes(result, 'medium'); // Medium severity issues
    assertStringIncludes(result, 'low'); // Low severity issues
});

Deno.test('TableFormatter - formatSummaryTable - empty results', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    const result = formatter.formatSummaryTable([]);
    
    assertStringIncludes(result, 'No files to summarize');
});

Deno.test('TableFormatter - grade comparison and sorting', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Test with mixed grades to verify sorting
    const mixedResults: ReviewResult[] = [
        { ...mockReviewResults[0], grade: 'B', state: 'pass' },
        { ...mockReviewResults[1], grade: 'A', state: 'warning' },
        { ...mockReviewResults[2], grade: 'F', state: 'fail' },
    ];
    
    const result = formatter.formatReviewResults(mixedResults);
    
    // Should be sorted by state first (fail, warning, pass), then by grade
    const lines = result.split('\n').filter(line => line.includes('.js') || line.includes('.tsx'));
    
    // First should be the failing file (F grade)
    assertStringIncludes(lines[0], 'login.js');
    
    // Second should be the warning file (A grade)
    assertStringIncludes(lines[1], 'helper.js');
    
    // Third should be the passing file (B grade)
    assertStringIncludes(lines[2], 'Header.tsx');
});

Deno.test('TableFormatter - long file name truncation', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    const longPathResult: ReviewResult = {
        ...mockReviewResults[0],
        file: 'src/very/long/path/to/some/deeply/nested/component/VeryLongComponentName.tsx',
    };
    
    const result = formatter.formatReviewResults([longPathResult]);
    
    // Should truncate long paths
    assertStringIncludes(result, '...');
    assertStringIncludes(result, 'VeryLongComponentName.tsx');
});

Deno.test('TableFormatter - color coding verification', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    const result = formatter.formatReviewResults(mockReviewResults);
    
    // Should contain ANSI color codes for different elements
    // Note: We can't easily test the exact colors, but we can verify the structure
    assertEquals(typeof result, 'string');
    assertEquals(result.length > 0, true);
    
    // Should contain various state indicators
    assertStringIncludes(result, '✅');
    assertStringIncludes(result, '❌');
    assertStringIncludes(result, 'PASS');
    assertStringIncludes(result, 'WARN');
    assertStringIncludes(result, 'FAIL');
});

Deno.test('TableFormatter - edge cases', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Test with extreme values
    const extremeResult: ReviewResult = {
        file: 'test.js',
        grade: 'A',
        coverage: 100,
        testsPresent: true,
        value: 'high',
        state: 'pass',
        issues: [],
        suggestions: [],
    };
    
    const result = formatter.formatReviewResults([extremeResult]);
    
    assertStringIncludes(result, '100%');
    assertStringIncludes(result, 'A');
    assertStringIncludes(result, 'PASS');
});

Deno.test('TableFormatter - multiple filtering combinations', () => {
    const formatter = new TableFormatterImpl(mockLogger);
    
    // Complex filter combination
    const complexFilter = formatter.formatFilteredResults(mockReviewResults, {
        minGrade: 'C',
        hasTests: false,
        minCoverage: 0,
    });
    
    // Should match helper.js (grade C, no tests, 45% coverage >= 0)
    // Should NOT match login.js (grade F < C) or Header.tsx (has tests)
    assertStringIncludes(complexFilter, 'helper.js');
    assertEquals(complexFilter.includes('login.js'), false); // Grade F is below minimum C
    assertEquals(complexFilter.includes('Header.tsx'), false); // Has tests
});