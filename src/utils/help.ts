import { colors } from '@cliffy/ansi/colors';

export function formatJsonExamples(examples: { description: string; command: string }[]): string {
  let output = '\nJSON Output Examples:';
  for (const example of examples) {
    output += `\n${colors.dim(`  # ${example.description}`)}`;
    output += `\n${colors.dim(`  ${example.command}`)}`;
  }
  return output;
}

// Common examples that can be reused across commands
export const commonJsonExamples = {
  copyToClipboard: (command: string) => ({
    description: 'Copy output to clipboard',
    command: `${command} --format json | jq -r '.' | pbcopy`,
  }),
  saveToFile: (command: string, filename: string) => ({
    description: 'Save output to file',
    command: `${command} --format json > ${filename}`,
  }),
  extractField: (command: string, field: string) => ({
    description: `Extract ${field} field`,
    command: `${command} --format json | jq -r '.${field}'`,
  }),
};
