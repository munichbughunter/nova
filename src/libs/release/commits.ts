/**
 * Parse commit message to extract type and scope
 */
export function parseCommitMessage(message: string): { type: string; scope?: string } {
  // Default result
  const result = { type: 'misc', scope: undefined };

  // Skip release commits
  if (message.startsWith('chore(release):')) {
    return { type: 'none' };
  }

  // Try different commit message formats
  const patterns = [
    // Format: type(scope): message
    /^(\w+)(?:\(([^)]+)\))?: .+/,
    // Format: TICKET-123: type(scope) message
    /^[A-Z]+-\d+:\s*(\w+)(?:\(([^)]+)\))?.+/,
    // Format: TICKET-123: type message
    /^[A-Z]+-\d+:\s*(\w+)\s+.+/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const [, type, scope] = match;

      // Map common type variations
      const typeMap: Record<string, string> = {
        feat: 'feature',
        fix: 'fix',
        perf: 'performance',
        refactor: 'refactor',
        style: 'style',
        test: 'test',
        docs: 'docs',
        chore: 'misc',
        build: 'build',
        ci: 'ci',
      };

      return {
        type: typeMap[type.toLowerCase()] || 'misc',
        scope: scope,
      };
    }
  }

  return result;
}
