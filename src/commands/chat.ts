import { colors } from '@cliffy/ansi/colors';
import { Command } from '@cliffy/command';
import { logger } from '../utils/logger.ts';

export const chatCommand = new Command()
  .name('chat')
  .description('Open nova Chat in your browser')
  .action(async () => {
    try {
      const chatUrl = 'http://chat.nova.de';
      
      logger.passThrough('log', colors.blue('🚀 Opening nova Chat...'));
      logger.passThrough('log', colors.dim(`URL: ${chatUrl}`));

      // Determine the command to open browser based on OS
      let openCommand: string[];
      
      switch (Deno.build.os) {
        case 'darwin': // macOS
          openCommand = ['open', chatUrl];
          break;
        case 'windows':
          openCommand = ['start', chatUrl];
          break;
        case 'linux':
          openCommand = ['xdg-open', chatUrl];
          break;
        default:
          logger.passThrough('log', colors.yellow('⚠️  Unable to detect OS. Please open manually:'));
          logger.passThrough('log', colors.cyan(chatUrl));
          return;
      }

      // Open the browser
      const process = new Deno.Command(openCommand[0], {
        args: openCommand.slice(1),
        stdout: 'null',
        stderr: 'null',
      });

      const result = await process.output();
      
      if (result.success) {
        logger.passThrough('log', colors.green('✅ nova Chat opened in your browser'));
      } else {
        logger.passThrough('log', colors.yellow('⚠️  Failed to open browser automatically. Please visit:'));
        logger.passThrough('log', colors.cyan(chatUrl));
      }

    } catch (error) {
      logger.passThrough('log', colors.yellow('⚠️  Failed to open browser automatically. Please visit:'));
      logger.passThrough('log', colors.cyan('http://chat.nova.de'));
      logger.error(error instanceof Error ? error.message : String(error));
    }
  });