import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient } from '../api/client';
import { MIN_ID_WIDTH, MIN_REPO_WIDTH, MIN_STATUS_WIDTH } from '../constants';

interface JobRow {
  id: string;
  repo_url: string;
  branch?: string;
  status: string;
  pr_url?: string;
  created_at: number;
}

export function createJobsCommand(): Command {
  const jobsCmd = new Command('jobs').description('Manage and list jobs');

  jobsCmd
    .command('list')
    .description('List recent jobs')
    .action(async () => {
      try {
        const client = new ApiClient();
        const res = await client.get<JobRow[]>('/jobs');

        if (res.success && res.data) {
          if (res.data.length === 0) {
            console.log(chalk.gray('No jobs found.'));
            return;
          }

          const maxId = Math.max(...res.data.map((j) => j.id.length), MIN_ID_WIDTH);
          const maxRepo = Math.max(...res.data.map((j) => j.repo_url.length), MIN_REPO_WIDTH);
          const maxStatus = Math.max(...res.data.map((j) => j.status.length), MIN_STATUS_WIDTH);

          const header = `${'ID'.padEnd(maxId)}  ${'REPO'.padEnd(maxRepo)}  ${'STATUS'.padEnd(maxStatus)}  CREATED`;
          console.log(chalk.bold(header));
          console.log(chalk.bold('-'.repeat(header.length)));

          for (const job of res.data) {
            const statusColor =
              job.status === 'completed'
                ? chalk.green
                : job.status === 'failed'
                  ? chalk.red
                  : job.status === 'running'
                    ? chalk.blue
                    : chalk.yellow;

            console.log(
              `${job.id.padEnd(maxId)}  ${job.repo_url.padEnd(maxRepo)}  ${statusColor(job.status.padEnd(maxStatus))}  ${new Date(job.created_at).toLocaleString()}`,
            );
          }
        } else {
          console.error(chalk.red(`Failed to list jobs: ${res.error || 'Unknown error'}`));
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`Failed to list jobs: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return jobsCmd;
}
