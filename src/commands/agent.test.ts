import { Command } from '@cliffy/command';
import { assertEquals, assertExists } from '@std/assert';
import { agentCommand } from './agent.ts';

Deno.test('Agent command - basic structure', () => {
  assertExists(agentCommand);
  assertEquals(agentCommand instanceof Command, true);
  assertEquals(agentCommand.getName(), 'agent');
  assertEquals(agentCommand.getDescription(), 'Run an agent command');
});

Deno.test('Agent command - options', () => {
  const options = agentCommand.getOptions();

  // Test project option
  const projectOption = options.find((opt) => opt.flags.includes('--project'));
  assertExists(projectOption);
  assertEquals(projectOption.flags.includes('-p'), true);
  assertEquals(projectOption.flags.includes('--project'), true);

  // Test format option
  const formatOption = options.find((opt) => opt.flags.includes('--format'));
  assertExists(formatOption);
  assertEquals(formatOption.flags.includes('-f'), true);
  assertEquals(formatOption.flags.includes('--format'), true);
  assertEquals(formatOption.default, 'text');

  // Test recent option
  const recentOption = options.find((opt) => opt.flags.includes('--recent'));
  assertExists(recentOption);
  assertEquals(recentOption.flags.includes('-r'), true);
  assertEquals(recentOption.flags.includes('--recent'), true);
  assertEquals(recentOption.default, false);
});

Deno.test('Agent command - subcommands', () => {
  const subcommands = agentCommand.getCommands();

  // Test ENG subcommand
  const engCommand = subcommands.find((cmd) => cmd.getName() === 'eng');
  assertExists(engCommand);
  assertEquals(engCommand.getDescription(), 'Run as Software Engineer');
});
