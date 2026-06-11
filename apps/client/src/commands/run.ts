import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient } from '../api/client';

interface JobCreateResponse {
  jobId: string;
  status: string;
}

export function createRunCommand(): Command {
  return new Command('run')
    .description('Submit a new coding job')
    .requiredOption('--repo <url>', 'Repository URL')
    .option('--branch <branch>', 'Git branch', 'main')
    .requiredOption('--prompt <prompt>', 'Task prompt')
    .option('--model <model>', 'AI model to use')
    .action(async (options: { repo: string; branch: string; prompt: string; model?: string }) => {
      try {
        const client = new ApiClient();
        const res = await client.post<JobCreateResponse>('/jobs', {
          repoUrl: options.repo,
          branch: options.branch,
          prompt: options.prompt,
          model: options.model,
        });

        if (res.success && res.data) {
          console.log(chalk.green(`Job submitted: ${res.data.jobId}`));
          console.log(`Track with: codver status --job-id ${res.data.jobId}`);
        } else {
          console.error(chalk.red(`Failed to submit job: ${res.error || 'Unknown error'}`));
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`Failed to submit job: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
