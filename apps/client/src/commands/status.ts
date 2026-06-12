import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient } from '../api/client';
import { readConfig, validateConfig } from '../config/store';

interface HealthData {
  status: string;
  version: string;
}

interface JobData {
  id: string;
  repo_url: string;
  branch?: string;
  status: string;
  prompt: string;
  model?: string;
  provider?: string;
  thinking_level?: string;
  pr_url?: string;
  error_message?: string;
  error_type?: string;
  error_pr_url?: string;
  retry_count?: number;
  language?: string;
  docker_image?: string;
  pr_branch?: string;
  pr_title?: string;
  pr_description?: string;
  pr_author?: string;
  started_at?: number;
  completed_at?: number;
  created_at: number;
  updated_at: number;
}

export function createStatusCommand(): Command {
  const statusCmd = new Command('status')
    .description('Check server status or job status')
    .option('--job-id <id>', 'Job ID to check status for')
    .option('--verbose', 'Show detailed job information')
    .action(async (options: { jobId?: string; verbose?: boolean }) => {
      if (options.jobId) {
        await checkJobStatus(options.jobId, options.verbose);
      } else {
        await checkServerStatus();
      }
    });

  return statusCmd;
}

async function checkServerStatus(): Promise<void> {
  const config = readConfig();
  const { valid, errors } = validateConfig(config);
  if (!valid) {
    errors.forEach((e) => console.error(chalk.red(e)));
    process.exit(1);
  }

  try {
    const client = new ApiClient();
    const res = await client.get<HealthData>('/health');
    if (res.success && res.data) {
      console.log(chalk.green(`Connected to ${config.serverUrl} (v${res.data.version})`));
      console.log(`Server ${res.data.status}`);
    } else {
      console.error(chalk.red(`Failed to connect: ${res.error || 'Unknown error'}`));
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(`Failed to connect: ${(err as Error).message}`));
    process.exit(1);
  }
}

async function checkJobStatus(jobId: string, verbose?: boolean): Promise<void> {
  try {
    const client = new ApiClient();
    const res = await client.get<JobData>(`/jobs/${jobId}`);
    if (res.success && res.data) {
      const job = res.data;

      const statusColor =
        job.status === 'completed'
          ? chalk.green
          : job.status === 'failed'
            ? chalk.red
            : job.status === 'running'
              ? chalk.blue
              : chalk.yellow;

      console.log(chalk.bold('Job Status'));
      console.log(`${chalk.gray('ID:')}          ${job.id}`);
      console.log(`${chalk.gray('Status:')}      ${statusColor(job.status)}`);
      console.log(`${chalk.gray('Repo:')}        ${job.repo_url}`);
      if (job.branch) console.log(`${chalk.gray('Branch:')}      ${job.branch}`);
      console.log(`${chalk.gray('Created:')}     ${new Date(job.created_at).toLocaleString()}`);

      if (verbose) {
        console.log(chalk.bold('\nPrompt'));
        console.log(job.prompt.slice(0, 200) + (job.prompt.length > 200 ? '...' : ''));

        if (job.model) console.log(`${chalk.gray('Model:')}       ${job.model}`);
        if (job.provider) console.log(`${chalk.gray('Provider:')}    ${job.provider}`);
        if (job.thinking_level) console.log(`${chalk.gray('Thinking:')}    ${job.thinking_level}`);
        if (job.language) console.log(`${chalk.gray('Language:')}    ${job.language}`);
        if (job.docker_image) console.log(`${chalk.gray('Image:')}       ${job.docker_image}`);
        if (job.started_at) console.log(`${chalk.gray('Started:')}     ${new Date(job.started_at).toLocaleString()}`);
        if (job.completed_at) {
          console.log(`${chalk.gray('Completed:')}   ${new Date(job.completed_at).toLocaleString()}`);
          if (job.started_at) {
            const duration = job.completed_at - job.started_at;
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);
            console.log(`${chalk.gray('Duration:')}    ${minutes}m ${seconds}s`);
          }
        }
      }

      if (job.pr_url) console.log(`${chalk.gray('PR:')}          ${chalk.cyan(job.pr_url)}`);
      if (job.pr_branch) console.log(`${chalk.gray('PR Branch:')}   ${job.pr_branch}`);
      if (job.pr_title) console.log(`${chalk.gray('PR Title:')}    ${job.pr_title}`);
      if (job.pr_author) console.log(`${chalk.gray('PR Author:')}   ${job.pr_author}`);

      if (job.error_pr_url) console.log(chalk.yellow(`${chalk.gray('Error PR:')}    ${job.error_pr_url}`));
      if (job.error_type) console.log(chalk.red(`${chalk.gray('Error Type:')}  ${job.error_type}`));
      if (job.error_message) console.log(chalk.red(`${chalk.gray('Error:')}       ${job.error_message}`));
      if (job.retry_count && job.retry_count > 0) console.log(chalk.yellow(`${chalk.gray('Retries:')}     ${job.retry_count}`));
    } else {
      console.error(chalk.red(`Failed to get job status: ${res.error || 'Unknown error'}`));
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(`Failed to get job status: ${(err as Error).message}`));
    process.exit(1);
  }
}
