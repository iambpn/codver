import { Command } from 'commander';
import { createConfigCommand } from './commands/config';
import { createStatusCommand } from './commands/status';
import { createRunCommand } from './commands/run';
import { createLogsCommand } from './commands/logs';
import { createJobsCommand } from './commands/jobs';
import packageJson from '../package.json';

const program = new Command();

program
  .name('codver')
  .description('CLI to submit coding tasks to a remote Codver server')
  .version(packageJson.version || '0.1.0');

program.addCommand(createConfigCommand());
program.addCommand(createStatusCommand());
program.addCommand(createRunCommand());
program.addCommand(createLogsCommand());
program.addCommand(createJobsCommand());

program.parse();
