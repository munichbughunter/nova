import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { CodeAnalysisService } from './code_analysis_service.ts';
import type { AgentContext } from '../../agents/types.ts';
import { Logger } from '../../utils/logger.ts';

// Mock AgentContext for testing
const mockContext: AgentContext = {
    config: {
        gitlab: {
            url: 'https://gitlab.com',
            token: 'test-token',
        },
    },
    logger: new Logger('test', false),
    llmProvider: undefined, // No LLM for rule-based testing
    mcpEnabled: false,
} as AgentContext;

const mockLogger = new Logger('test', false);

Deno.test('CodeAnalysisService - analyzeCode - TypeScript file', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/components/Button.tsx';
    const content = `import React from 'react';

interface ButtonProps {
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ onClick, children, disabled = false }) => {
    return (
        <button 
            onClick={onClick} 
            disabled={disabled}
            className="btn btn-primary"
        >
            {children}
        </button>
    );
};`;

    const result = await service.analyzeCode(filePath, content);
    
    assertEquals(typeof result.grade, 'string');
    assertEquals(typeof result.coverage, 'number');
    assertEquals(typeof result.testsPresent, 'boolean');
    assertEquals(typeof result.value, 'string');
    assertEquals(typeof result.state, 'string');
    assertExists(result.issues);
    assertExists(result.suggestions);
    assertExists(result.summary);
    
    // Should detect TypeScript
    assertEquals(result.summary.includes('TypeScript'), true);
});

Deno.test('CodeAnalysisService - analyzeCode - JavaScript with issues', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/utils/helper.js';
    const content = `function processData(data) {
    if (data == null) { // loose equality issue
        return null;
    }
    
    var result = ""; // var usage issue
    for (var i = 0; i < data.length; i++) {
        result += data[i]; // string concatenation issue
    }
    
    console.log(result); // console.log issue
    eval("var x = 1;"); // security issue
    
    return result;
}`;

    const result = await service.analyzeCode(filePath, content);
    
    // Should detect multiple issues
    assertEquals(result.issues.length > 0, true);
    
    // Should find security issue
    const securityIssues = result.issues.filter(issue => issue.type === 'security');
    assertEquals(securityIssues.length > 0, true);
    
    // Should find style issues
    const styleIssues = result.issues.filter(issue => issue.type === 'style');
    assertEquals(styleIssues.length > 0, true);
    
    // Should have suggestions
    assertEquals(result.suggestions.length > 0, true);
    
    // Grade should reflect issues
    assertEquals(['C', 'D', 'F'].includes(result.grade), true);
});

Deno.test('CodeAnalysisService - analyzeCode - Python file', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/models/user.py';
    const content = `class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
    
    def get_display_name(self):
        """Return formatted display name"""
        return f"{self.name} <{self.email}>"
    
    def validate_email(self):
        # TODO: Add proper email validation
        return "@" in self.email`;

    const result = await service.analyzeCode(filePath, content);
    
    // Should detect Python
    assertEquals(result.summary.includes('Python'), true);
    
    // Should find TODO comment
    const todoIssues = result.issues.filter(issue => 
        issue.message.includes('TODO') && issue.type === 'style'
    );
    assertEquals(todoIssues.length > 0, true);
    
    // Should assess business value as high (user model)
    assertEquals(result.value, 'high');
});

Deno.test('CodeAnalysisService - analyzeCode - test file detection', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/components/Button.test.tsx';
    const content = `import { render, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button component', () => {
    it('should render correctly', () => {
        const mockClick = jest.fn();
        const { getByText } = render(
            <Button onClick={mockClick}>Click me</Button>
        );
        
        expect(getByText('Click me')).toBeInTheDocument();
    });
    
    it('should call onClick when clicked', () => {
        const mockClick = jest.fn();
        const { getByText } = render(
            <Button onClick={mockClick}>Click me</Button>
        );
        
        fireEvent.click(getByText('Click me'));
        expect(mockClick).toHaveBeenCalled();
    });
});`;

    const result = await service.analyzeCode(filePath, content);
    
    // Should detect tests are present
    assertEquals(result.testsPresent, true);
    
    // Should have higher coverage estimate
    assertEquals(result.coverage > 50, true);
    
    // Should assess as low business value (test file)
    assertEquals(result.value, 'low');
});

Deno.test('CodeAnalysisService - analyzeCode - security issues detection', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/auth/login.js';
    const content = `const password = "hardcoded123"; // hardcoded secret
const api_key = "sk-1234567890abcdef"; // API key
const secret = "my-secret-key"; // secret

function authenticate(user, pass) {
    const query = "SELECT * FROM users WHERE username = '" + user + "'"; // SQL injection
    eval("console.log('User: " + user + "')"); // eval usage
    
    return query;
}`;

    const result = await service.analyzeCode(filePath, content);
    
    // Should detect multiple security issues
    const securityIssues = result.issues.filter(issue => issue.type === 'security');
    assertEquals(securityIssues.length >= 3, true); // hardcoded secrets + eval
    
    // Should have high severity issues
    const highSeverityIssues = result.issues.filter(issue => issue.severity === 'high');
    assertEquals(highSeverityIssues.length > 0, true);
    
    // Should result in fail state
    assertEquals(result.state, 'fail');
});

Deno.test('CodeAnalysisService - analyzeCode - performance issues detection', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/utils/processor.js';
    const content = `const fs = require('fs');

function processData(data) {
    // Nested loops - performance issue
    for (let i = 0; i < data.length; i++) {
        for (let j = 0; j < data[i].length; j++) {
            console.log(data[i][j]);
        }
    }
    
    // Synchronous file operation - performance issue
    const content = fs.readFileSync('large-file.txt', 'utf8');
    
    // String concatenation in loop - performance issue
    let result = "";
    for (let i = 0; i < 1000; i++) {
        result += "item " + i;
    }
    
    return result;
}`;

    const result = await service.analyzeCode(filePath, content);
    
    // Should detect performance issues
    const performanceIssues = result.issues.filter(issue => issue.type === 'performance');
    assertEquals(performanceIssues.length > 0, true);
    
    // Should have performance-related issues detected
    assertEquals(performanceIssues.length >= 2, true); // At least nested loops + sync file ops
});

Deno.test('CodeAnalysisService - analyzeCode - high quality code', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/services/UserService.ts';
    const content = `/**
 * User service for managing user operations
 */
export class UserService {
    private readonly repository: UserRepository;
    
    constructor(repository: UserRepository) {
        this.repository = repository;
    }
    
    /**
     * Get user by ID with error handling
     */
    async getUserById(id: string): Promise<User | null> {
        try {
            if (!id) {
                throw new Error('User ID is required');
            }
            
            const user = await this.repository.findById(id);
            return user;
        } catch (error) {
            this.logger.error('Failed to get user', { id, error });
            throw error;
        }
    }
    
    /**
     * Create new user with validation
     */
    async createUser(userData: CreateUserRequest): Promise<User> {
        try {
            this.validateUserData(userData);
            const user = await this.repository.create(userData);
            return user;
        } catch (error) {
            this.logger.error('Failed to create user', { userData, error });
            throw error;
        }
    }
    
    private validateUserData(userData: CreateUserRequest): void {
        if (!userData.email || !userData.name) {
            throw new Error('Email and name are required');
        }
    }
}`;

    const result = await service.analyzeCode(filePath, content);
    
    // Should get a good grade for well-structured code
    assertEquals(['A', 'B'].includes(result.grade), true);
    
    // Should have fewer issues
    assertEquals(result.issues.length < 3, true);
    
    // Should assess as high business value (service)
    assertEquals(result.value, 'high');
    
    // Should be in pass state
    assertEquals(result.state, 'pass');
});

Deno.test('CodeAnalysisService - analyzeCode - empty file', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/empty.ts';
    const content = '';

    const result = await service.analyzeCode(filePath, content);
    
    // Should handle empty file gracefully
    assertExists(result);
    assertEquals(typeof result.grade, 'string');
    assertEquals(result.coverage, 0);
    assertEquals(result.testsPresent, false);
});

Deno.test('CodeAnalysisService - analyzeCode - complex file metrics', async () => {
    const service = new CodeAnalysisService(mockLogger, mockContext);
    
    const filePath = 'src/complex.js';
    // Create a complex file with high cyclomatic complexity
    const content = `function complexFunction(data) {
    if (data.type === 'A') {
        if (data.subtype === '1') {
            if (data.value > 10) {
                return processA1High(data);
            } else if (data.value > 5) {
                return processA1Medium(data);
            } else {
                return processA1Low(data);
            }
        } else if (data.subtype === '2') {
            return processA2(data);
        }
    } else if (data.type === 'B') {
        for (let i = 0; i < data.items.length; i++) {
            if (data.items[i].active) {
                try {
                    processItem(data.items[i]);
                } catch (error) {
                    handleError(error);
                }
            }
        }
    } else if (data.type === 'C') {
        switch (data.category) {
            case 'cat1':
                return handleCat1(data);
            case 'cat2':
                return handleCat2(data);
            case 'cat3':
                return handleCat3(data);
            default:
                return handleDefault(data);
        }
    }
    
    return null;
}`;

    const result = await service.analyzeCode(filePath, content);
    
    // Should detect high complexity
    const complexitySuggestions = result.suggestions.filter(suggestion => 
        suggestion.includes('complexity') || suggestion.includes('refactor')
    );
    assertEquals(complexitySuggestions.length > 0, true);
    
    // Should not get the highest grade due to complexity
    assertEquals(['C', 'D', 'F'].includes(result.grade), true);
});