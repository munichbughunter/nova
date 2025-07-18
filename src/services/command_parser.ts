import type { ReviewCommand } from '../agents/types.ts';
import type { Logger } from '../utils/logger.ts';

/**
 * Command parser for review commands
 */
export class ReviewCommandParser {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child('ReviewCommandParser');
    }

    /**
     * Parse review command input and return structured command
     */
    parseReviewCommand(input: string): ReviewCommand | null {
        try {
            this.logger.debug(`Parsing review command: "${input}"`);

            // Normalize input
            const normalizedInput = input.trim().toLowerCase();
            
            // Remove common prefixes
            let cleanInput = this.removeCommonPrefixes(normalizedInput);
            
            // Check if this is a review command
            if (!this.isReviewCommand(cleanInput)) {
                this.logger.debug('Input is not a review command');
                return null;
            }

            // Remove 'review' keyword
            cleanInput = cleanInput.replace(/^review\s*/, '').trim();

            // Parse the command based on remaining input
            return this.parseReviewSubcommand(cleanInput, input);

        } catch (error) {
            this.logger.error('Failed to parse review command', { error, input });
            return null;
        }
    }

    /**
     * Validate file paths in the command
     */
    validateFilePaths(files: string[]): { valid: string[]; invalid: string[] } {
        const valid: string[] = [];
        const invalid: string[] = [];

        for (const file of files) {
            if (this.isValidFilePath(file)) {
                valid.push(file);
            } else {
                invalid.push(file);
            }
        }

        return { valid, invalid };
    }

    /**
     * Get help text for review commands
     */
    getReviewCommandHelp(): string {
        return `# Review Command Usage

## File Review Mode
Review specific files:
\`\`\`
review src/components/Header.tsx
review src/utils/helper.js src/services/api.ts
\`\`\`

## Changes Review Mode
Review all changed files in the current repository:
\`\`\`
review
review changes
\`\`\`

## Pull Request Review Mode
Review pull/merge requests:
\`\`\`
review pr
review pr 123
review pull-request
review merge-request
\`\`\`

## Examples
- \`review src/main.ts\` - Review a specific file
- \`review src/*.ts\` - Review all TypeScript files in src directory
- \`review\` - Review all changed files
- \`review pr\` - Review the current pull request
- \`review pr 42\` - Review pull request #42`;
    }

    /**
     * Remove common command prefixes
     */
    private removeCommonPrefixes(input: string): string {
        const prefixes = [
            'example', 'exampleagent', 'agent', 'nova', 'dev', 'development'
        ];

        for (const prefix of prefixes) {
            const pattern = new RegExp(`^${prefix}\\s+`, 'i');
            if (pattern.test(input)) {
                input = input.replace(pattern, '').trim();
                break;
            }
        }

        return input;
    }

    /**
     * Check if input is a review command
     */
    private isReviewCommand(input: string): boolean {
        return input.startsWith('review') || 
               input.startsWith('code-review') ||
               input.startsWith('code review');
    }

    /**
     * Parse review subcommand after 'review' keyword is removed
     */
    private parseReviewSubcommand(cleanInput: string, originalInput: string): ReviewCommand {
        // If no additional input, default to changes mode
        if (!cleanInput) {
            this.logger.debug('No subcommand specified, defaulting to changes mode');
            return { mode: 'changes' };
        }

        // Check for PR/MR mode
        if (this.isPRCommand(cleanInput)) {
            return this.parsePRCommand(cleanInput);
        }

        // Check for explicit changes mode
        if (this.isChangesCommand(cleanInput)) {
            return { mode: 'changes' };
        }

        // Otherwise, treat as file mode
        return this.parseFileCommand(cleanInput, originalInput);
    }

    /**
     * Check if command is for PR/MR review
     */
    private isPRCommand(input: string): boolean {
        const prPatterns = [
            /^pr\b/,
            /^pull-request\b/,
            /^pull\s+request\b/,
            /^mr\b/,
            /^merge-request\b/,
            /^merge\s+request\b/,
        ];

        return prPatterns.some(pattern => pattern.test(input));
    }

    /**
     * Check if command is for changes review
     */
    private isChangesCommand(input: string): boolean {
        const changesPatterns = [
            /^changes?\b/,
            /^changed?\b/,
            /^diff\b/,
            /^modifications?\b/,
            /^modified\b/,
        ];

        return changesPatterns.some(pattern => pattern.test(input));
    }

    /**
     * Parse PR command
     */
    private parsePRCommand(input: string): ReviewCommand {
        // Extract PR ID if specified (capture any text, not just digits)
        const prIdMatch = input.match(/(?:pr|pull-request|mr|merge-request)\s+(\S+)/);
        
        if (prIdMatch) {
            const prId = prIdMatch[1];
            this.logger.debug(`Parsed PR command with ID: ${prId}`);
            return { mode: 'pr', prId };
        }

        this.logger.debug('Parsed PR command without specific ID');
        return { mode: 'pr' };
    }

    /**
     * Parse file command
     */
    private parseFileCommand(cleanInput: string, originalInput: string): ReviewCommand {
        // Extract file paths from the input
        const files = this.extractFilePaths(cleanInput, originalInput);
        
        if (files.length === 0) {
            this.logger.warn('No valid file paths found in file command');
            // Fallback to changes mode if no files specified
            return { mode: 'changes' };
        }

        this.logger.debug(`Parsed file command with ${files.length} files`);
        return { mode: 'file', files };
    }

    /**
     * Extract file paths from input
     */
    private extractFilePaths(cleanInput: string, originalInput: string): string[] {
        const files: string[] = [];

        // Use original input to preserve case and exact paths
        const inputToSearch = originalInput.includes('review') 
            ? originalInput.substring(originalInput.toLowerCase().indexOf('review') + 6).trim()
            : cleanInput;

        // First, extract quoted paths
        const quotedPatterns = [
            /"([^"]+)"/g,
            /'([^']+)'/g,
        ];

        let remainingInput = inputToSearch;
        for (const pattern of quotedPatterns) {
            let match;
            while ((match = pattern.exec(inputToSearch)) !== null) {
                const filePath = match[1];
                if (filePath && !files.includes(filePath)) {
                    files.push(filePath);
                    // Remove the quoted part from remaining input
                    remainingInput = remainingInput.replace(match[0], ' ');
                }
            }
        }

        // Then extract unquoted file paths
        const unquotedPatterns = [
            // Standard file paths with extensions
            /([^\s]+\.[a-zA-Z0-9]+)/g,
            // Paths with wildcards
            /([^\s]*\*[^\s]*)/g,
        ];

        for (const pattern of unquotedPatterns) {
            let match;
            while ((match = pattern.exec(remainingInput)) !== null) {
                const filePath = match[1] || match[0];
                if (filePath && !files.includes(filePath)) {
                    files.push(filePath);
                }
            }
        }

        // If no patterns matched, split by spaces and filter for file-like strings
        if (files.length === 0) {
            const words = remainingInput.split(/\s+/);
            for (const word of words) {
                if (this.looksLikeFilePath(word)) {
                    files.push(word);
                }
            }
        }

        return files.filter(file => file.length > 0);
    }

    /**
     * Check if a string looks like a file path
     */
    private looksLikeFilePath(str: string): boolean {
        // Basic heuristics for file paths
        return (
            str.includes('.') || // Has extension
            str.includes('/') || // Has path separator
            str.includes('\\') || // Windows path separator
            str.includes('*') || // Wildcard
            str.startsWith('./') || // Relative path
            str.startsWith('../') || // Parent directory
            str.startsWith('~/') || // Home directory
            str.length > 2 // Any string longer than 2 chars could be a file
        );
    }

    /**
     * Validate if a file path is potentially valid
     */
    private isValidFilePath(filePath: string): boolean {
        try {
            // Basic validation - check for obviously invalid characters
            const invalidChars = /[<>"|?\x00-\x1f]/; // Removed : and * as they can be valid in paths
            if (invalidChars.test(filePath)) {
                return false;
            }

            // Check for reasonable length
            if (filePath.length === 0 || filePath.length > 260) {
                return false;
            }

            // Check for valid file extension or directory patterns
            const hasValidExtension = /\.[a-zA-Z0-9]+$/.test(filePath);
            const isDirectory = filePath.endsWith('/') || filePath.endsWith('\\');
            const hasWildcard = filePath.includes('*');
            const isRelativePath = filePath.startsWith('./') || filePath.startsWith('../');
            const isHomePath = filePath.startsWith('~/');
            const hasPathSeparator = filePath.includes('/') || filePath.includes('\\');

            return hasValidExtension || isDirectory || hasWildcard || isRelativePath || isHomePath || hasPathSeparator;

        } catch (error) {
            this.logger.debug(`File path validation failed for "${filePath}": ${error}`);
            return false;
        }
    }

    /**
     * Parse and validate command arguments
     */
    parseCommandArguments(input: string): {
        command: ReviewCommand | null;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Parse the command
        const command = this.parseReviewCommand(input);

        if (!command) {
            errors.push('Invalid or unrecognized review command format');
            return { command: null, errors, warnings };
        }

        // Validate file paths if in file mode
        if (command.mode === 'file' && command.files) {
            const validation = this.validateFilePaths(command.files);
            
            if (validation.invalid.length > 0) {
                errors.push(`Invalid file paths: ${validation.invalid.join(', ')}`);
            }

            if (validation.valid.length === 0) {
                errors.push('No valid file paths specified');
                return { command: null, errors, warnings };
            }

            if (validation.valid.length > 50) {
                warnings.push(`Large number of files specified (${validation.valid.length}). This may take a while.`);
            }

            // Update command with only valid files
            command.files = validation.valid;
        }

        // Validate PR ID if specified
        if (command.mode === 'pr' && command.prId) {
            const prIdNum = parseInt(command.prId);
            if (isNaN(prIdNum) || prIdNum <= 0) {
                errors.push(`Invalid PR/MR ID: ${command.prId}`);
            }
        }

        return { command, errors, warnings };
    }
}