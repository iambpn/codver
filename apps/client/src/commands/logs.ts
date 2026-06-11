import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient } from '../api/client';

interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  message: string;
}

export function createLogsCommand(): Command {
  return new Command('logs')
    .description('View job logs')
    .requiredOption('--job-id <id>', 'Job ID')
    .action(async (options: { jobId: string }) => {
      try {
        const client = new ApiClient();
        const res = await client.get<LogEntry[]>(`/jobs/${options.jobId}/logs`);

        if (res.success && res.data) {
          if (res.data.length === 0) {
            console.log(chalk.gray('No logs yet.'));
            return;
          }

          for (const log of res.data) {
            const ts = new Date(log.timestamp).toLocaleString();
            const levelColor =
              log.level === 'error'
                ? chalk.red
                : log.level === 'warn'
                  ? chalk.yellow
                  : chalk.blue;
            console.log(`[${ts}] ${levelColor(log.level.toUpperCase())}: ${log.message}`);
          }
        } else {
          console.error(chalk.red(`Failed to get logs: ${res.error || 'Unknown error'}`));
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`Failed to get logs: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
