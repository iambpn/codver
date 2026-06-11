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
  pr_url?: string;
  error_message?: string;
  created_at: number;
  updated_at: number;
}

export function createStatusCommand(): Command {
  const statusCmd = new Command('status')
    .description('Check server status or job status')
    .option('--job-id <id>', 'Job ID to check status for')
    .action(async (options: { jobId?: string }) => {
      if (options.jobId) {
        await checkJobStatus(options.jobId);
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

async function checkJobStatus(jobId: string): Promise<void> {
  try {
    const client = new ApiClient();
    const res = await client.get<JobData>(`/jobs/${jobId}`);
    if (res.success && res.data) {
      const job = res.data;
      console.log(`ID: ${job.id}`);
      console.log(`Status: ${job.status}`);
      console.log(`Repo: ${job.repo_url}`);
      if (job.branch) console.log(`Branch: ${job.branch}`);
      console.log(`Created: ${new Date(job.created_at).toLocaleString()}`);
      if (job.pr_url) console.log(`PR: ${job.pr_url}`);
      if (job.error_message) console.log(chalk.red(`Error: ${job.error_message}`));
    } else {
      console.error(chalk.red(`Failed to get job status: ${res.error || 'Unknown error'}`));
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(`Failed to get job status: ${(err as Error).message}`));
    process.exit(1);
  }
}
