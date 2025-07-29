import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { Confirm, Input, Select } from '@cliffy/prompt';
import { z } from 'zod';
import { configManager } from '../../config/mod.ts';
import { AIService } from '../../services/ai_service.ts';
import { GitFileStatus, GitService } from '../../services/git_service.ts';
import { logger } from '../../utils/logger.ts';

// Schema for the commit suggestion
export const CommitSuggestionSchema = z.object({
    message: z.string().describe('The commit message following conventional commits format'),
    description: z.string().nullable().optional().describe('A longer description of the change'),
    type: z.string().nullable().optional().describe('The type of change (feat, fix, docs, etc.)'),
    scope: z.string().nullable().optional().describe('The scope of the change'),
    breaking: z.boolean().describe('Whether this is a breaking change'),
    impact: z.enum(['major', 'minor', 'patch']).describe(
        'The semantic versioning impact level of this change',
    ),
    apiChanges: z.boolean().describe('Whether this commit includes API changes'),
    dependencyChanges: z.boolean().describe(
        'Whether this commit modifies dependencies that consumers use',
    ),
    releaseNotes: z.string().nullable().optional().describe(
        'Suggested text to be included in release notes for this change',
    ),
});

type CommitSuggestion = z.infer<typeof CommitSuggestionSchema>;

// Export the commit command
export const commitCommand = new Command()
    .name('commit')
    .description(
        colors.bold('Generate AI commit messages based on your changes') +
            '\n\n' +
            'This command will:\n' +
            '• Analyze your staged or working directory changes\n' +
            '• Use AI to generate a conventional commit message\n' +
            '• Evaluate the impact (major, minor, patch) of your changes\n' +
            '• Identify API and dependency changes\n' +
            '• Generate appropriate release notes\n' +
            '• Allow you to edit before committing\n\n' +
            'By default, only staged changes are analyzed. Use --all to include all changes.',
    )
    .option('-a, --all', 'Include all changes, not just staged ones')
    .option('-m, --message <message>', 'Use the provided message instead of AI generation')
    .option('-s, --silent', 'Skip the confirmation prompt')
    .option('-n, --no-commit', "Generate a commit message but don't commit")
    .action(
        async ({ all = false, message, silent, commit }: {
            all?: boolean;
            message?: string;
            silent?: boolean;
            commit?: boolean;
        }) => {
            try {
                const _staged = !all;
                const _noCommit = !commit;
                const _message = message;
                const _silent = silent;

                logger.passThrough(
                    'log',
                    colors.blue('\nAnalyzing git changes to suggest commit message...\n'),
                );

                // Initialize services
                const config = await configManager.loadConfig();
                const gitService = new GitService(config);

                // Check if there are any changes to commit
                const fileStatuses = await gitService.getFileStatuses(true);
                const hasChangesToCommit = fileStatuses.some((status) =>
                    (_staged && status.staged) ||
                    (all && (status.staged || status.unstaged || status.untracked))
                );

                if (!hasChangesToCommit) {
                    logger.passThrough('log', colors.yellow('No changes detected to commit.'));
                    const stageHint = !_staged && !all
                        ? 'Try using the --all flag to include unstaged changes.'
                        : 'Add files with git add before committing.';
                    logger.passThrough('log', colors.dim(stageHint));
                    Deno.exit(0);
                }

                // Show summary of changes
                showChangesSummary(fileStatuses, { _staged, all });

                // Get the diff for files to commit
                const diff = await getGitDiff(gitService, { _staged, all }, fileStatuses);

                if (!diff.trim()) {
                    logger.passThrough('log', colors.yellow('No changes detected to commit.'));
                    const stageHint = !_staged && !all
                        ? 'Try using the --all flag to include unstaged changes.'
                        : 'Add files with git add before committing.';
                    logger.passThrough('log', colors.dim(stageHint));
                    Deno.exit(0);
                }

                // Initialize AI service
                const aiService = new AIService(config);

                // Analyze changes and suggest commit message
                const suggestionResult = await generateCommitSuggestion(aiService, diff);

                if (!suggestionResult.success || !suggestionResult.suggestion) {
                    logger.passThrough(
                        'log',
                        colors.red(
                            `Error generating commit suggestions: ${
                                suggestionResult.error || 'Unknown error'
                            }`,
                        ),
                    );
                    Deno.exit(1);
                }

                const suggestion = suggestionResult.suggestion;

                // Display suggestions to the user
                logger.passThrough('log', colors.blue('\nSuggested commit message:'));
                logger.passThrough('log', colors.green(`${suggestion.message}`));

                if (suggestion.description) {
                    logger.passThrough('log', colors.blue('\nSuggested longer description:'));
                    logger.passThrough('log', colors.dim(suggestion.description));
                }

                if (suggestion.type) {
                    logger.passThrough(
                        'log',
                        colors.blue('\nCommit type: ') + colors.yellow(suggestion.type),
                    );
                }
                if (suggestion.breaking) {
                    logger.passThrough('log', colors.red('This appears to be a BREAKING CHANGE'));
                }

                // Ask user to accept, modify, or reject the suggestion
                const action = await Select.prompt({
                    message: 'What would you like to do?',
                    options: [
                        { name: 'Accept and commit', value: 'accept' },
                        { name: 'Modify message', value: 'modify' },
                        { name: 'Reject and create my own', value: 'reject' },
                        { name: 'Cancel', value: 'cancel' },
                    ],
                });

                if (action === 'cancel') {
                    logger.passThrough('log', colors.yellow('Commit cancelled.'));
                    Deno.exit(0);
                }

                let commitMessage = suggestion.message;
                let commitDesc = suggestion.description;

                if (action === 'modify' || action === 'reject') {
                    // If user wants to modify or create their own, prompt for a new message
                    commitMessage = await Input.prompt({
                        message: 'Enter commit message:',
                        default: action === 'modify' ? commitMessage : '',
                    });

                    const wantDesc = await Confirm.prompt({
                        message: 'Add detailed description?',
                        default: !!commitDesc,
                    });

                    if (wantDesc) {
                        commitDesc = await Input.prompt({
                            message: 'Enter commit description:',
                            default: action === 'modify' ? commitDesc || '' : '',
                        });
                    } else {
                        commitDesc = '';
                    }
                }

                // Create the final commit message with description
                const fullCommitMessage = commitDesc
                    ? `${commitMessage}\n\n${commitDesc}`
                    : commitMessage;

                // Confirm the commit
                const confirmCommit = await Confirm.prompt({
                    message: 'Proceed with commit?',
                    default: true,
                });

                if (!confirmCommit) {
                    logger.passThrough('log', colors.yellow('Commit cancelled.'));
                    Deno.exit(0);
                }

                // Execute the git commit command
                try {
                    const command = new Deno.Command('git', {
                        args: [
                            'commit',
                            ...(all ? ['-a'] : []),
                            '-m',
                            fullCommitMessage,
                        ],
                        stdout: 'piped',
                        stderr: 'piped',
                    });

                    const { stdout, stderr, success } = await command.output();

                    if (success) {
                        const output = new TextDecoder().decode(stdout).trim();
                        logger.passThrough('log', colors.green('\n✓ Commit created successfully'));
                        logger.passThrough('log', colors.dim(output));
                    } else {
                        const errorOutput = new TextDecoder().decode(stderr).trim();
                        throw new Error(`Git commit failed: ${errorOutput}`);
                    }
                } catch (error) {
                    logger.passThrough(
                        'log',
                        colors.red(
                            `\nError creating commit: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        ),
                    );
                    Deno.exit(1);
                }
            } catch (error) {
                logger.error(
                    colors.red(
                        `\nError generating commit suggestion: ${
                            error instanceof Error ? error.message : 'Unknown error'
                        }\n`,
                    ),
                );
                Deno.exit(1);
            }
        },
    );

// Add help for commit command
commitCommand.command('help')
    .description('Show help for commit command')
    .action(() => {
        logger.passThrough('log', '\nCommit Suggestion Command\n');
        logger.passThrough('log', 'Usage:');
        logger.passThrough('log', '  nova git commit [--staged|--all]');
        logger.passThrough('log', '\nDescription:');
        logger.passThrough(
            'log',
            '  Analyzes your git changes and suggests commit messages using AI.',
        );
        logger.passThrough(
            'log',
            '  This helps create more descriptive and conventional commits.',
        );
        logger.passThrough(
            'log',
            'The command will:',
        );
        logger.passThrough('log', '  1. Analyze your code changes using AI');
        logger.passThrough('log', '  2. Generate a conventional commit message');
        logger.passThrough('log', '  3. Evaluate the impact of changes (major, minor, patch)');
        logger.passThrough('log', '  4. Identify API and dependency changes for release notes');
        logger.passThrough('log', '  5. Let you accept, modify, or reject the suggestion');
        logger.passThrough('log', '  6. Create the git commit with your chosen message');
        logger.passThrough('log', '\nConventional Commits:');
        logger.passThrough('log', '  The suggestions follow the Conventional Commits format:');
        logger.passThrough('log', '  - type(scope): description');
        logger.passThrough(
            'log',
            '  - Examples: feat(auth): add login page, fix: resolve memory leak',
        );
        logger.passThrough('log', '\nImpact Assessment:');
        logger.passThrough('log', '  Each commit is analyzed for its semantic versioning impact:');
        logger.passThrough('log', '  - major: Breaking changes that require a major version bump');
        logger.passThrough(
            'log',
            "  - minor: New features that don't break existing functionality",
        );
        logger.passThrough(
            'log',
            "  - patch: Bug fixes and changes that don't add features or break existing functionality",
        );
        logger.passThrough('log', '\nAPI and Dependency Changes:');
        logger.passThrough('log', '  The tool identifies changes that affect:');
        logger.passThrough('log', '  - Public APIs that consumers might use');
        logger.passThrough('log', '  - Dependencies that may affect downstream consumers');
        logger.passThrough('log', '  - Changes that should be highlighted in release notes');
        logger.passThrough('log', '\nOptions:');
        logger.passThrough('log', '  --staged    Only analyze staged changes (default)');
        logger.passThrough('log', '  --all       Analyze all changes (staged and unstaged)');
        logger.passThrough('log', '\nExamples:');
        logger.passThrough('log', colors.dim('  # Suggest commit for staged changes'));
        logger.passThrough('log', colors.dim('  nova git commit'));
        logger.passThrough('log', colors.dim('  # Suggest commit for all changes'));
        logger.passThrough('log', colors.dim('  nova git commit --all'));
        logger.passThrough('log', '');
    });

// Helper function to show a summary of changes
function showChangesSummary(
    fileStatuses: GitFileStatus[],
    { _staged = true, all = false }: { _staged?: boolean; all?: boolean },
): void {
    try {
        // Show file statuses
        logger.passThrough('log', colors.blue('\nStatus of working tree:'));

        // Group files by status
        const stagedFiles = fileStatuses.filter((f) => f.staged).map((f) =>
            `${colors.green('M')} ${f.path}`
        );
        const unstagedFiles = fileStatuses.filter((f) => f.unstaged).map((f) =>
            `${colors.red('M')} ${f.path}`
        );
        const untrackedFiles = fileStatuses.filter((f) => f.untracked).map((f) =>
            `${colors.dim('?')} ${f.path}`
        );
        const deletedFiles = fileStatuses.filter((f) => f.deleted).map((f) =>
            `${colors.red('D')} ${f.path}`
        );

        if (stagedFiles.length > 0) {
            logger.passThrough('log', colors.green('\nStaged changes:'));
            stagedFiles.forEach((file) => logger.passThrough('log', colors.dim(`  ${file}`)));
        }

        if (unstagedFiles.length > 0 && all) {
            logger.passThrough('log', colors.yellow('\nUnstaged changes:'));
            unstagedFiles.forEach((file) => logger.passThrough('log', colors.dim(`  ${file}`)));
        }

        if (untrackedFiles.length > 0 && all) {
            logger.passThrough('log', colors.dim('\nUntracked files:'));
            untrackedFiles.forEach((file) => logger.passThrough('log', colors.dim(`  ${file}`)));
        }

        if (deletedFiles.length > 0) {
            logger.passThrough('log', colors.red('\nDeleted files:'));
            deletedFiles.forEach((file) => logger.passThrough('log', colors.dim(`  ${file}`)));
        }

        // Show the summary count
        let summary = '';
        if (stagedFiles.length > 0) {
            summary += `${stagedFiles.length} staged files, `;
        }
        if (unstagedFiles.length > 0) {
            summary += `${unstagedFiles.length} unstaged files, `;
        }
        if (untrackedFiles.length > 0) {
            summary += `${untrackedFiles.length} untracked files, `;
        }
        if (deletedFiles.length > 0) {
            summary += `${deletedFiles.length} deleted files, `;
        }

        if (summary) {
            summary = summary.replace(/, $/, '');
            logger.passThrough('log', colors.blue(`\nSummary: ${summary}`));
        }

        return;
    } catch (error) {
        logger.error('Error showing changes summary:', error);
        return;
    }
}

// Helper function to get the git diff
async function getGitDiff(
    gitService: GitService,
    { _staged = true, all = false }: { _staged?: boolean; all?: boolean },
    fileStatuses: GitFileStatus[],
): Promise<string> {
    try {
        let diffOutput = '';

        // Define patterns for files to exclude from analysis
        const excludePatterns = [
            // Lock files
            /package-lock\.json$/,
            /yarn\.lock$/,
            /pnpm-lock\.yaml$/,
            /Gemfile\.lock$/,
            /poetry\.lock$/,
            /Cargo\.lock$/,
            /deno\.lock$/,

            // Binary and image files
            /\.(png|jpe?g|gif|webp|ico|bmp|svg|tiff|mp4|webm|mp3|wav|pdf)$/i,

            // Generated files
            /\.min\.(js|css)$/,
            /bundle\.(js|css)$/,
            /dist\//,
            /build\//,
            /node_modules\//,

            // Large data files
            /\.(csv|tsv|xlsx|parquet)$/i,

            // Other common large files
            /\.map$/,
            /\.d\.ts$/,
        ];

        // Helper to check if file should be excluded
        const shouldExcludeFile = (filePath: string): boolean => {
            return excludePatterns.some((pattern) => pattern.test(filePath));
        };

        // Get relevant files based on status
        const relevantFiles = fileStatuses.filter((status) =>
            ((_staged && status.staged) || (all && (status.unstaged || status.untracked))) &&
            !shouldExcludeFile(status.path)
        );

        // If we excluded files, add a note about it
        const excludedFiles = fileStatuses.filter((status) =>
            ((_staged && status.staged) || (all && (status.unstaged || status.untracked))) &&
            shouldExcludeFile(status.path)
        );

        if (excludedFiles.length > 0) {
            diffOutput += '# The following files were excluded from analysis:\n';
            excludedFiles.forEach((file) => {
                diffOutput += `# - ${file.path}\n`;
            });
            diffOutput += '\n';
        }

        // Get diff for each file
        for (const fileStatus of relevantFiles) {
            if (fileStatus.untracked) {
                // For untracked files, just note the entire file as new
                try {
                    const content = await Deno.readTextFile(fileStatus.path);
                    diffOutput += `\n\n+++ b/${fileStatus.path}\n@@ -0,0 +1,${
                        content.split('\n').length
                    } @@\n`;
                    content.split('\n').forEach((line) => {
                        diffOutput += `+${line}\n`;
                    });
                } catch (error) {
                    logger.debug(`Error reading untracked file: ${fileStatus.path}`, error);
                }
            } else {
                // For tracked files, get the diff
                const result = await gitService.getFileDiff(fileStatus.path, _staged && !all);
                if (result.diff) {
                    diffOutput += `\n\n${result.diff}`;
                }
            }
        }

        return diffOutput;
    } catch (error) {
        logger.error('Error getting git diff:', error);
        return '';
    }
}

// Function to generate commit suggestions using AI
async function generateCommitSuggestion(
    aiService: AIService,
    diff: string,
): Promise<{ success: boolean; suggestion?: CommitSuggestion; error?: string }> {
    try {
        const systemPrompt =
            `You are a git commit message generator. Your task is to analyze git changes and generate a structured commit message.

Follow these rules:
1. Generate a JSON object with these fields:
   - message: A concise commit message (max 72 chars)
   - type: One of: feat, fix, docs, style, refactor, perf, test, build, ci, chore
   - scope: Optional context in parentheses
   - breaking: Boolean indicating breaking changes
   - impact: One of: major, minor, patch
   - apiChanges: Boolean indicating API modifications
   - dependencyChanges: Boolean indicating dependency changes
   - description: Optional longer description
   - releaseNotes: Optional release notes for significant changes

2. The message must follow this format: type(scope): description

3. Focus on the most significant changes in the diff.`;

        // Truncate diff if it's too large
        const maxDiffLength = 10000; // Reduced to 10KB for better focus
        const truncatedDiff = diff.length > maxDiffLength
            ? diff.substring(0, maxDiffLength) +
                `\n\n[Diff truncated, ${diff.length - maxDiffLength} more characters]`
            : diff;

        const userPrompt =
            `Analyze these changes and generate a commit message:\n\n${truncatedDiff}`;

        logger.debug('\n[DEBUG] Generating commit suggestion...');
        logger.debug('\n[DEBUG] Diff length:', diff.length);
        logger.debug('\n[DEBUG] Truncated diff length:', truncatedDiff.length);

        try {
            const suggestion = await aiService.generateObject(
                userPrompt,
                CommitSuggestionSchema,
                systemPrompt,
            );

            logger.debug('\n[DEBUG] Generated suggestion:', suggestion);

            return {
                success: true,
                suggestion,
            };
        } catch (error) {
            logger.error('Failed to generate commit suggestion:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
