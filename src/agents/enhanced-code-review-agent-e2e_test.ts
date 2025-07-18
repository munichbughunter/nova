/**
 * End-to-End Tests for Enhanced Code Review Agent
 * 
 * This test suite provides comprehensive end-to-end testing covering:
 * - All three review modes (file, changes, PR)
 * - Error scenarios and edge cases
 * - CLI table output validation
 * - Configuration loading and validation
 * - Mock GitLab and GitHub service integration
 */

import { assertEquals, assertStringIncludes, assertRejects, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { EnhancedCodeReviewAgent } from './enhanced-code-review-agent.ts';
import type { AgentContext, ReviewResult } from './types.ts';
import { Logger } from '../utils/logger.ts';
import { 
    MockGitLabRepositoryService, 
    MockGitHubService, 
    MockRepositoryDetector,
    TestDataFactory,
    TestScenarioBuilder
} from '../services/mock_services_test.ts';

// Test utilities
class TestLogger extends Logger {
    logs: Array<{level: string; message: string; data?: unknown}> = [];
    
    constructor() {
        super('e2e-test', false);
    }
    
    override debug(message: string, data?: unknown): void {
        this.logs.push({ level: 'debug', message, data });
    }
    
    override info(message: string, data?: unknown): void {
        this.logs.push({ level: 'info', message, data });
    }
    
    override warn(message: string, data?: unknown): void {
        this.logs.push({ level: 'warn', message, data });
    }
    
    override error(message: string, data?: unknown): void {
        this.logs.push({ level: 'error', message, data });
    }
    
    override child(name: string): Logger {
        return this;
    }

    clearLogs(): void {
        this.logs = [];
    }

    getLogsByLevel(level: string): Array<{level: string; message: string; data?: unknown}> {
        return this.logs.filter(log => log.level === level);
    }
}

// Mock file system with comprehensive test files
const testFiles: Record<string, string> = {
    // TypeScript files
    'src/components/UserProfile.tsx': `
import React, { useState, useEffect } from 'react';

interface UserProfileProps {
    userId: string;
    onUpdate?: (user: User) => void;
}

interface User {
    id: string;
    name: string;
    email: string;
    avatar?: string;
}

export const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchUser(userId);
    }, [userId]);

    const fetchUser = async (id: string) => {
        try {
            setLoading(true);
            const response = await fetch(\`/api/users/\${id}\`);
            if (!response.ok) {
                throw new Error('Failed to fetch user');
            }
            const userData = await response.json();
            setUser(userData);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;
    if (!user) return <div>User not found</div>;

    return (
        <div className="user-profile">
            <img src={user.avatar || '/default-avatar.png'} alt={user.name} />
            <h2>{user.name}</h2>
            <p>{user.email}</p>
        </div>
    );
};
`,

    // JavaScript file with issues
    'src/utils/api.js': `
// API utility functions
var API_BASE = 'https://api.example.com';
var API_KEY = 'hardcoded-api-key-123'; // Security issue

function makeRequest(endpoint, options) {
    var url = API_BASE + endpoint;
    var headers = {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
    };
    
    // No error handling
    return fetch(url, {
        ...options,
        headers: headers
    }).then(function(response) {
        return response.json();
    });
}

function getUserData(userId) {
    // SQL injection vulnerability
    var query = "SELECT * FROM users WHERE id = '" + userId + "'";
    return makeRequest('/query', {
        method: 'POST',
        body: JSON.stringify({ query: query })
    });
}

// Unused function
function deprecatedFunction() {
    console.log('This function is deprecated');
}

module.exports = {
    makeRequest: makeRequest,
    getUserData: getUserData
};
`,

    // Python file with performance issues
    'src/algorithms/search.py': `
def linear_search(arr, target):
    """Linear search implementation"""
    for i in range(len(arr)):
        if arr[i] == target:
            return i
    return -1

def bubble_sort(arr):
    """Bubble sort implementation - O(n²) complexity"""
    n = len(arr)
    for i in range(n):
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

def find_duplicates(data):
    """Find duplicates with nested loops - performance issue"""
    duplicates = []
    for i in range(len(data)):
        for j in range(i + 1, len(data)):
            if data[i] == data[j] and data[i] not in duplicates:
                duplicates.append(data[i])
    return duplicates

# Global variable - code smell
GLOBAL_CACHE = {}

def cache_result(key, value):
    """Cache function using global variable"""
    GLOBAL_CACHE[key] = value

def get_cached_result(key):
    """Get cached result"""
    return GLOBAL_CACHE.get(key)
`,

    // Test file
    'src/components/UserProfile.test.tsx': `
import { render, screen, waitFor } from '@testing-library/react';
import { UserProfile } from './UserProfile';

describe('UserProfile', () => {
    it('renders loading state initially', () => {
        render(<UserProfile userId="123" />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders user data when loaded', async () => {
        // Mock fetch
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                id: '123',
                name: 'John Doe',
                email: 'john@example.com'
            })
        });

        render(<UserProfile userId="123" />);
        
        await waitFor(() => {
            expect(screen.getByText('John Doe')).toBeInTheDocument();
            expect(screen.getByText('john@example.com')).toBeInTheDocument();
        });
    });
});
`,

    // Configuration files
    'package.json': `{
    "name": "test-project",
    "version": "1.0.0",
    "dependencies": {
        "react": "^18.0.0",
        "typescript": "^5.0.0"
    },
    "scripts": {
        "test": "jest",
        "build": "tsc"
    }
}`,

    'tsconfig.json': `{
    "compilerOptions": {
        "target": "ES2020",
        "module": "commonjs",
        "strict": true,
        "esModuleInterop": true
    }
}`,

    // Non-code files
    'README.md': '# Test Project\n\nThis is a test project for code review.',
    'LICENSE': 'MIT License\n\nCopyright (c) 2024',
    'image.png': 'BINARY_IMAGE_DATA',
    '.gitignore': 'node_modules/\n*.log\n.env'
};

// Create comprehensive mock context
function createE2EContext(scenario: any): {context: AgentContext; logger: TestLogger} {
    const logger = new TestLogger();
    
    const context: AgentContext = {
        config: scenario.config,
        logger,
        llmProvider: {
            generateObject: async (options: any) => {
                // Analyze the file content to provide realistic mock responses
                const prompt = options.prompt || '';
                const fileName = extractFileNameFromPrompt(prompt);
                
                return {
                    object: generateMockAnalysis(fileName, testFiles[fileName] || '')
                };
            }
        },
        mcpEnabled: false,
        mcpService: {
            isEnabled: () => false,
            listTools: () => [],
            getTools: () => [],
            executeTool: async () => ({ success: false, error: 'MCP not enabled' }),
        },
        workingDirectory: '/test-project',
        toolWrappers: {
            readFile: async (filePath: string) => {
                if (testFiles[filePath]) {
                    return { success: true, data: testFiles[filePath] };
                }
                return { success: false, error: `File not found: ${filePath}` };
            },
            notifyUser: async (message: any) => {
                logger.info('User notification', message);
            }
        }
    } as AgentContext;
    
    return { context, logger };
}

// Helper functions
function extractFileNameFromPrompt(prompt: string): string {
    const match = prompt.match(/File:\s*([^\n]+)/);
    return match ? match[1].trim() : '';
}

function generateMockAnalysis(fileName: string, content: string): any {
    // Generate realistic analysis based on file content
    if (fileName.includes('api.js')) {
        return {
            grade: 'F',
            coverage: 0,
            testsPresent: false,
            value: 'medium',
            state: 'fail',
            issues: [
                {
                    line: 3,
                    severity: 'high',
                    type: 'security',
                    message: 'Hardcoded API key detected'
                },
                {
                    line: 25,
                    severity: 'high',
                    type: 'security',
                    message: 'SQL injection vulnerability'
                },
                {
                    line: 15,
                    severity: 'medium',
                    type: 'bug',
                    message: 'Missing error handling'
                }
            ],
            suggestions: [
                'Remove hardcoded credentials',
                'Use parameterized queries',
                'Add proper error handling',
                'Add unit tests'
            ],
            summary: 'Critical security vulnerabilities and missing error handling'
        };
    } else if (fileName.includes('search.py')) {
        return {
            grade: 'C',
            coverage: 30,
            testsPresent: false,
            value: 'low',
            state: 'warning',
            issues: [
                {
                    line: 8,
                    severity: 'medium',
                    type: 'performance',
                    message: 'Bubble sort has O(n²) complexity'
                },
                {
                    line: 15,
                    severity: 'medium',
                    type: 'performance',
                    message: 'Nested loops create O(n²) complexity'
                },
                {
                    line: 23,
                    severity: 'low',
                    type: 'style',
                    message: 'Global variable usage is discouraged'
                }
            ],
            suggestions: [
                'Use more efficient sorting algorithms',
                'Optimize duplicate detection with sets',
                'Avoid global variables',
                'Add unit tests'
            ],
            summary: 'Performance issues and code style improvements needed'
        };
    } else if (fileName.includes('UserProfile.tsx')) {
        return {
            grade: 'A',
            coverage: 85,
            testsPresent: true,
            value: 'high',
            state: 'pass',
            issues: [
                {
                    line: 35,
                    severity: 'low',
                    type: 'style',
                    message: 'Consider using a loading spinner component'
                }
            ],
            suggestions: [
                'Add PropTypes or improve TypeScript types',
                'Consider memoization for performance',
                'Add accessibility attributes'
            ],
            summary: 'Well-structured React component with good practices'
        };
    } else {
        return {
            grade: 'B',
            coverage: 60,
            testsPresent: false,
            value: 'medium',
            state: 'pass',
            issues: [],
            suggestions: ['Add unit tests', 'Improve documentation'],
            summary: 'Good code quality, needs tests'
        };
    }
}

// End-to-End Test Suite

Deno.test('E2E: File Review Mode - Single TypeScript File', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    const response = await agent.execute('review src/components/UserProfile.tsx');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'Code Review Results');
    assertStringIncludes(response.content, 'UserProfile.tsx');
    assertStringIncludes(response.content, 'Grade');
    assertStringIncludes(response.content, 'A'); // Expected grade
    assertStringIncludes(response.content, '85%'); // Expected coverage
    assertStringIncludes(response.content, '✅'); // Tests present
    
    // Verify structured data
    assert(response.data?.results);
    assertEquals(response.data.results.length, 1);
    assertEquals(response.data.results[0].grade, 'A');
    assertEquals(response.data.results[0].coverage, 85);
    assertEquals(response.data.results[0].testsPresent, true);
});

Deno.test('E2E: File Review Mode - JavaScript File with Security Issues', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    const response = await agent.execute('review src/utils/api.js');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'api.js');
    assertStringIncludes(response.content, 'F'); // Expected failing grade
    assertStringIncludes(response.content, 'fail'); // Expected state
    assertStringIncludes(response.content, 'Hardcoded API key');
    assertStringIncludes(response.content, 'SQL injection');
    
    // Verify security issues are detected
    assert(response.data?.results);
    const result = response.data.results[0];
    assertEquals(result.grade, 'F');
    assertEquals(result.state, 'fail');
    assert(result.issues.some(issue => issue.type === 'security'));
});

Deno.test('E2E: File Review Mode - Multiple Files with Summary', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    const response = await agent.execute('review src/components/UserProfile.tsx src/utils/api.js src/algorithms/search.py');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'Code Review Results');
    assertStringIncludes(response.content, 'Summary');
    assertStringIncludes(response.content, 'Total Files: 3');
    assertStringIncludes(response.content, 'Pass:');
    assertStringIncludes(response.content, 'Warning:');
    assertStringIncludes(response.content, 'Fail:');
    
    // Verify all files are processed
    assert(response.data?.results);
    assertEquals(response.data.results.length, 3);
    
    // Verify summary statistics
    assert(response.data.summary);
    assertEquals(response.data.summary.totalFiles, 3);
    assert(response.data.summary.totalIssues > 0);
});

Deno.test('E2E: Changes Review Mode - Multiple Changed Files', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess()
        .withChangedFiles([
            'src/components/UserProfile.tsx',
            'src/utils/api.js',
            'src/algorithms/search.py'
        ])
        .build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock Git service
    const mockGitService = {
        isGitRepository: async () => true,
        getChangedFiles: async () => scenario.changedFiles,
        getFileChanges: async (filePath: string) => [{
            type: 'modified' as const,
            filePath,
            hunks: []
        }]
    };
    
    // Override the git service in the agent
    (agent as any).gitService = mockGitService;
    
    const response = await agent.execute('review');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'Change Detection Review');
    assertStringIncludes(response.content, 'Total Changed Files: 3');
    assertStringIncludes(response.content, 'Reviewable Files: 3');
    
    // Verify all changed files are analyzed
    assert(response.data?.results);
    assertEquals(response.data.results.length, 3);
    assertEquals(response.data.changedFiles.length, 3);
});

Deno.test('E2E: Changes Review Mode - No Changes Detected', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess()
        .withChangedFiles([])
        .build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock Git service
    const mockGitService = {
        isGitRepository: async () => true,
        getChangedFiles: async () => [],
        getFileChanges: async () => []
    };
    
    (agent as any).gitService = mockGitService;
    
    const response = await agent.execute('review');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'No changed files detected');
    assertStringIncludes(response.content, 'All files are up to date');
    
    assert(response.data?.changedFiles);
    assertEquals(response.data.changedFiles.length, 0);
});

Deno.test('E2E: Changes Review Mode - Non-Reviewable Files Only', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess()
        .withChangedFiles(['README.md', 'package.json', 'image.png', '.gitignore'])
        .build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock Git service
    const mockGitService = {
        isGitRepository: async () => true,
        getChangedFiles: async () => scenario.changedFiles,
        getFileChanges: async () => []
    };
    
    (agent as any).gitService = mockGitService;
    
    const response = await agent.execute('review');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'none are suitable for code review');
    assertStringIncludes(response.content, 'README.md');
    assertStringIncludes(response.content, 'package.json');
    assertStringIncludes(response.content, 'non-code file');
});

Deno.test('E2E: PR Review Mode - GitLab Integration Success', async () => {
    const scenario = TestScenarioBuilder.gitLabSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock the import system for GitLab services
    const originalImport = globalThis.import;
    globalThis.import = async (specifier: string) => {
        if (specifier.includes('repository_detector')) {
            return {
                RepositoryDetector: class {
                    constructor() {}
                    async detectRepositoryType() { return 'gitlab'; }
                }
            };
        }
        if (specifier.includes('gitlab_repository_service')) {
            const mockService = new MockGitLabRepositoryService(logger, {} as any, scenario.config);
            mockService.setMockPullRequests(scenario.pullRequests);
            mockService.setMockDiffData('123', scenario.diffData['123']);
            return { GitLabRepositoryService: () => mockService };
        }
        return originalImport(specifier);
    };
    
    try {
        const response = await agent.execute('review pr');
        
        assertEquals(response.success, true);
        assertStringIncludes(response.content, 'Pull Request Review');
        assertStringIncludes(response.content, 'GITLAB');
        assertStringIncludes(response.content, 'Add new feature');
    } finally {
        globalThis.import = originalImport;
    }
});

Deno.test('E2E: PR Review Mode - GitHub Integration Success', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock the import system for GitHub services
    const originalImport = globalThis.import;
    globalThis.import = async (specifier: string) => {
        if (specifier.includes('repository_detector')) {
            return {
                RepositoryDetector: class {
                    constructor() {}
                    async detectRepositoryType() { return 'github'; }
                }
            };
        }
        if (specifier.includes('github_service')) {
            const mockService = new MockGitHubService(logger, {} as any, scenario.config);
            mockService.setMockPullRequests(scenario.pullRequests);
            mockService.setMockDiffData('456', scenario.diffData['456']);
            return { GitHubServiceImpl: () => mockService };
        }
        return originalImport(specifier);
    };
    
    try {
        const response = await agent.execute('review pr');
        
        assertEquals(response.success, true);
        assertStringIncludes(response.content, 'Pull Request Review');
        assertStringIncludes(response.content, 'GITHUB');
        assertStringIncludes(response.content, 'Implement user dashboard');
    } finally {
        globalThis.import = originalImport;
    }
});

Deno.test('E2E: Error Handling - API Rate Limiting', async () => {
    const scenario = TestScenarioBuilder.apiErrorScenario().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock the import system with API error
    const originalImport = globalThis.import;
    globalThis.import = async (specifier: string) => {
        if (specifier.includes('repository_detector')) {
            return {
                RepositoryDetector: class {
                    constructor() {}
                    async detectRepositoryType() { return 'github'; }
                }
            };
        }
        if (specifier.includes('github_service')) {
            const mockService = new MockGitHubService(logger, {} as any, scenario.config);
            mockService.setMockApiError('getPullRequests', new Error('API rate limit exceeded'));
            return { GitHubServiceImpl: () => mockService };
        }
        return originalImport(specifier);
    };
    
    try {
        const response = await agent.execute('review pr');
        
        assertEquals(response.success, false);
        assertStringIncludes(response.content, 'rate limit');
    } finally {
        globalThis.import = originalImport;
    }
});

Deno.test('E2E: Configuration Validation - Missing Tokens', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess()
        .withConfig(TestDataFactory.createMockConfigurations().missing_tokens)
        .build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Mock the import system
    const originalImport = globalThis.import;
    globalThis.import = async (specifier: string) => {
        if (specifier.includes('repository_detector')) {
            return {
                RepositoryDetector: class {
                    constructor() {}
                    async detectRepositoryType() { return 'github'; }
                }
            };
        }
        if (specifier.includes('github_service')) {
            const mockService = new MockGitHubService(logger, {} as any, scenario.config);
            mockService.setMockApiError('authenticate', new Error('GitHub token not found'));
            return { GitHubServiceImpl: () => mockService };
        }
        return originalImport(specifier);
    };
    
    try {
        const response = await agent.execute('review pr');
        
        assertEquals(response.success, false);
        assertStringIncludes(response.content, 'token not found');
    } finally {
        globalThis.import = originalImport;
    }
});

Deno.test('E2E: Configuration Validation - File Limits', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess()
        .withConfig(TestDataFactory.createMockConfigurations().restrictive)
        .build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Try to review more files than the limit allows
    const manyFiles = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`).join(' ');
    const response = await agent.execute(`review ${manyFiles}`);
    
    assertEquals(response.success, false);
    assertStringIncludes(response.content, 'Too many files');
    assertStringIncludes(response.content, 'limit: 5');
});

Deno.test('E2E: CLI Table Output Validation', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    const response = await agent.execute('review src/components/UserProfile.tsx src/utils/api.js');
    
    assertEquals(response.success, true);
    
    // Validate table structure
    assertStringIncludes(response.content, '│ File');
    assertStringIncludes(response.content, '│ Grade');
    assertStringIncludes(response.content, '│ Coverage');
    assertStringIncludes(response.content, '│ Tests Present');
    assertStringIncludes(response.content, '│ Value');
    assertStringIncludes(response.content, '│ State');
    
    // Validate table content
    assertStringIncludes(response.content, 'UserProfile.tsx');
    assertStringIncludes(response.content, 'api.js');
    assertStringIncludes(response.content, '85%');
    assertStringIncludes(response.content, '0%');
    assertStringIncludes(response.content, '✅');
    assertStringIncludes(response.content, '❌');
});

Deno.test('E2E: Help System Comprehensive', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    const response = await agent.execute('help');
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'Enhanced Code Review Agent Help');
    assertStringIncludes(response.content, 'File Review Mode');
    assertStringIncludes(response.content, 'Changes Review Mode');
    assertStringIncludes(response.content, 'Pull Request Review Mode');
    
    // Validate examples
    assertStringIncludes(response.content, 'review src/components/Header.tsx');
    assertStringIncludes(response.content, 'review changes');
    assertStringIncludes(response.content, 'review pr');
    assertStringIncludes(response.content, 'review pr 123');
    
    // Validate feature descriptions
    assertStringIncludes(response.content, 'GitLab and GitHub integration');
    assertStringIncludes(response.content, 'Line-specific issue reporting');
    assertStringIncludes(response.content, 'CLI table formatting');
});

Deno.test('E2E: Command Parsing Edge Cases', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    // Test various command formats
    const testCases = [
        { input: 'enhanced help', expectSuccess: true },
        { input: 'code-review src/test.ts', expectSuccess: true },
        { input: 'review invalid<file>', expectSuccess: false },
        { input: 'review \x00invalid', expectSuccess: false },
        { input: 'src/components/UserProfile.tsx', expectSuccess: true }, // Auto-prepend review
    ];
    
    for (const testCase of testCases) {
        const response = await agent.execute(testCase.input);
        assertEquals(response.success, testCase.expectSuccess, 
            `Command "${testCase.input}" should ${testCase.expectSuccess ? 'succeed' : 'fail'}`);
    }
});

Deno.test('E2E: Performance with Large Files', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    
    // Add a large file to test files
    testFiles['src/large-component.tsx'] = 'function Component() {\n'.repeat(2000) + 'return <div>Large Component</div>;\n' + '}\n'.repeat(2000);
    
    const agent = new EnhancedCodeReviewAgent(context);
    const startTime = Date.now();
    
    const response = await agent.execute('review src/large-component.tsx');
    
    const endTime = Date.now();
    const executionTime = endTime - startTime;
    
    assertEquals(response.success, true);
    assertStringIncludes(response.content, 'large-component.tsx');
    
    // Performance should be reasonable (less than 10 seconds for this test)
    assert(executionTime < 10000, `Execution took too long: ${executionTime}ms`);
});

Deno.test('E2E: Logging and Debugging', async () => {
    const scenario = TestScenarioBuilder.gitHubSuccess().build();
    const { context, logger } = createE2EContext(scenario);
    const agent = new EnhancedCodeReviewAgent(context);
    
    logger.clearLogs();
    
    await agent.execute('review src/components/UserProfile.tsx');
    
    // Verify logging occurred
    const debugLogs = logger.getLogsByLevel('debug');
    const infoLogs = logger.getLogsByLevel('info');
    
    assert(debugLogs.length > 0, 'Should have debug logs');
    assert(infoLogs.length > 0, 'Should have info logs');
    
    // Verify specific log messages
    assert(debugLogs.some(log => log.message.includes('Reading file')));
    assert(debugLogs.some(log => log.message.includes('Analyzing file')));
    assert(infoLogs.some(log => log.message.includes('User notification')));
});