import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient } from '../api/client';

interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  message: string;
}

function getLogLevelColor(level: string): typeof chalk.red {
  switch (level) {
    case 'error':
      return chalk.red;
    case 'warn':
      return chalk.yellow;
    case 'debug':
      return chalk.gray;
    default:
      return chalk.blue;
  }
}

export function createLogsCommand(): Command {
  return new Command('logs')
    .description('View job logs')
    .requiredOption('--job-id <id>', 'Job ID')
    .option('--follow', 'Stream logs in real-time using SSE')
    .action(async (options: { jobId: string; follow?: boolean }) => {
      try {
        const client = new ApiClient();

        if (options.follow) {
          await streamLogs(client, options.jobId);
        } else {
          await fetchLogs(client, options.jobId);
        }
      } catch (err) {
        console.error(chalk.red(`Failed to get logs: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}

async function fetchLogs(client: ApiClient, jobId: string): Promise<void> {
  const res = await client.get<LogEntry[]>(`/jobs/${jobId}/logs`);

  if (res.success && res.data) {
    if (res.data.length === 0) {
      console.log(chalk.gray('No logs yet.'));
      return;
    }

    for (const log of res.data) {
      const ts = new Date(log.timestamp).toLocaleString();
      const levelColor = getLogLevelColor(log.level);
      console.log(`[${ts}] ${levelColor(log.level.toUpperCase().padEnd(5))} ${log.message}`);
    }
  } else {
    console.error(chalk.red(`Failed to get logs: ${res.error || 'Unknown error'}`));
    process.exit(1);
  }
}

async function streamLogs(client: ApiClient, jobId: string): Promise<void> {
  console.log(chalk.blue(`Streaming logs for ${jobId}... (Ctrl+C to stop)\n`));

  const apiUrl = `${client.getBaseURL()}/jobs/${jobId}/logs/stream`;
  const apiKey = client.getApiKey();

  const response = await fetch(apiUrl, {
    headers: { 'X-API-Key': apiKey },
  });

  if (!response.ok) {
    console.error(chalk.red(`Failed to connect to log stream: HTTP ${response.status}`));
    process.exit(1);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let event = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        event = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        data = line.slice(6);
        if (data) {
          try {
            const parsed = JSON.parse(data);

            if (event === 'message' || event === 'log') {
              const ts = new Date(parsed.timestamp).toLocaleTimeString();
              const levelColor = getLogLevelColor(parsed.level);
              console.log(`[${chalk.gray(ts)}] ${levelColor(parsed.level.toUpperCase().padEnd(5))} ${parsed.message}`);
            } else if (event === 'done') {
              console.log(chalk.green('\nStream ended'));
              return;
            } else if (event === 'error') {
              console.log(chalk.red(`\nStream error: ${parsed.message || 'Unknown error'}`));
              return;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  console.log(chalk.gray('\nStream closed'));
}
