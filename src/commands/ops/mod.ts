import { Command } from '@cliffy/command';
import { dashboardCommand } from './dashboard.ts';

// Define and export the main ops command
const ops = new Command()
  .name('ops')
  .description('Operations and DevOps utilities')
  .command('dashboard', dashboardCommand);

// Export the command
export const opsCommand = ops; 