# Phase 3: Client CLI

**Goal:** Interactive CLI tool for configuration and job submission.

**Duration:** 2-3 days | **Complexity:** Medium

## Objectives

1. Setup CLI framework with Commander.js
2. Implement configuration management
3. Create API client for server communication
4. Build all CLI commands
5. Add interactive prompts and output formatting

## Tasks

### 1. Configuration Management

**`apps/client/src/config/store.ts`**:
```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ServerConfig } from '@codver/shared-types';

const CONFIG_DIR = path.join(os.homedir(), '.codver');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export class ConfigStore {
  private config: ServerConfig;
  
  constructor() {
    this.config = this.load();
  }
  
  private load(): ServerConfig {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }
    
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Failed to parse config file: ${CONFIG_FILE}`);
    }
  }
  
  private save(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), {
      mode: 0o600,
    });
  }
  
  get<K extends keyof ServerConfig>(key: K): ServerConfig[K] {
    return this.config[key];
  }
  
  set<K extends keyof ServerConfig>(key: K, value: ServerConfig[K]): void {
    this.config[key] = value;
    this.save();
  }
  
  getAll(): ServerConfig {
    return { ...this.config };
  }
  
  clear(): void {
    this.config = {};
    this.save();
  }
  
  isConfigured(): boolean {
    return !!(this.config.serverUrl && this.config.apiKey);
  }
}
```

### 2. API Client

**`apps/client/src/api/client.ts`**:
```typescript
import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  JobRequest,
  JobResponse,
  JobDetails,
  ApiResponse,
} from '@codver/shared-types';
import { ConfigStore } from '../config/store.js';

export class ApiClient {
  private client: AxiosInstance;
  
  constructor(private config: ConfigStore) {
    const serverUrl = this.config.get('serverUrl');
    if (!serverUrl) {
      throw new Error('Server URL not configured. Run: codver config init');
    }
    
    this.client = axios.create({
      baseURL: serverUrl,
      timeout: 30000,
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false, // For self-signed certs in dev
      }),
    });
    
    // Add auth header to all requests
    this.client.interceptors.request.use((req) => {
      const apiKey = this.config.get('apiKey');
      if (apiKey) {
        req.headers['X-API-Key'] = apiKey;
      }
      return req;
    });
    
    // Handle errors
    this.client.interceptors.response.use(
      (res) => res,
      (error: AxiosError) => {
        if (error.response?.data) {
          const data = error.response.data as any;
          if (data.error) {
            throw new ApiError(
              data.error.code,
              data.error.message,
              error.response.status
            );
          }
        }
        throw new ApiError(
          'NETWORK_ERROR',
          error.message,
          error.response?.status || 0
        );
      }
    );
  }
  
  async health(): Promise<any> {
    const res = await this.client.get('/health');
    return res.data;
  }
  
  async createJob(request: JobRequest): Promise<JobResponse> {
    const res = await this.client.post<ApiResponse<JobResponse>>('/jobs', request);
    if (!res.data.success || !res.data.data) {
      throw new Error('Invalid response from server');
    }
    return res.data.data;
  }
  
  async getJob(jobId: string): Promise<JobDetails> {
    const res = await this.client.get<ApiResponse<JobDetails>>(`/jobs/${jobId}`);
    if (!res.data.success || !res.data.data) {
      throw new Error('Invalid response from server');
    }
    return res.data.data;
  }
  
  async getJobLogs(
    jobId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ logs: any[]; count: number }> {
    const res = await this.client.get<ApiResponse<any>>(`/jobs/${jobId}/logs`, {
      params: options,
    });
    return res.data.data;
  }
  
  async listJobs(options: { limit?: number; status?: string } = {}): Promise<any[]> {
    const res = await this.client.get<ApiResponse<{ jobs: any[] }>>('/jobs', {
      params: options,
    });
    return res.data.data?.jobs || [];
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}
```

### 3. Commands

**`apps/client/src/commands/config.ts`**:
```typescript
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigStore } from '../config/store.js';
import { ApiClient } from '../api/client.js';

export async function configInit(): Promise<void> {
  const config = new ConfigStore();
  
  console.log(chalk.blue('Codver Configuration Setup\n'));
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverUrl',
      message: 'Server URL:',
      default: config.get('serverUrl') || 'https://localhost:3000',
      validate: (input) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      mask: '*',
      validate: (input) => input.length > 0 || 'API key is required',
    },
    {
      type: 'input',
      name: 'defaultModel',
      message: 'Default AI model (optional):',
      default: config.get('defaultModel') || 'claude-sonnet-4',
    },
    {
      type: 'number',
      name: 'defaultTimeout',
      message: 'Default job timeout in minutes (optional):',
      default: config.get('defaultTimeout') || 30,
    },
  ]);
  
  config.set('serverUrl', answers.serverUrl);
  config.set('apiKey', answers.apiKey);
  if (answers.defaultModel) config.set('defaultModel', answers.defaultModel);
  if (answers.defaultTimeout) config.set('defaultTimeout', answers.defaultTimeout);
  
  console.log(chalk.green('\n✅ Configuration saved to ~/.codver/config.json'));
  
  // Test connection
  try {
    const api = new ApiClient(config);
    const health = await api.health();
    console.log(chalk.green(`✅ Connected to ${answers.serverUrl} (v${health.version})`));
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️  Could not connect to server: ${error.message}`));
    console.log(chalk.gray('You can test the connection later with: codver status'));
  }
}

export function configSetServer(url: string): void {
  const config = new ConfigStore();
  config.set('serverUrl', url);
  console.log(chalk.green(`✅ Server URL set to: ${url}`));
}

export function configSetKey(key: string): void {
  const config = new ConfigStore();
  config.set('apiKey', key);
  console.log(chalk.green('✅ API key updated'));
}

export function configView(): void {
  const config = new ConfigStore();
  const all = config.getAll();
  
  console.log(chalk.blue('\nCurrent Configuration:\n'));
  console.log(`  Server URL:    ${chalk.cyan(all.serverUrl || chalk.gray('(not set)'))}`);
  console.log(`  API Key:       ${all.apiKey ? chalk.cyan('****' + all.apiKey.slice(-4)) : chalk.gray('(not set)')}`);
  console.log(`  Default Model: ${chalk.cyan(all.defaultModel || chalk.gray('(not set)'))}`);
  console.log(`  Default Timeout: ${chalk.cyan(all.defaultTimeout ? `${all.defaultTimeout}m` : chalk.gray('(not set)'))}`);
  console.log();
}

export function configClear(): void {
  const config = new ConfigStore();
  config.clear();
  console.log(chalk.green('✅ Configuration cleared'));
}
```

**`apps/client/src/commands/status.ts`**:
```typescript
import chalk from 'chalk';
import { ConfigStore } from '../config/store.js';
import { ApiClient } from '../api/client.js';

export async function statusCommand(): Promise<void> {
  const config = new ConfigStore();
  
  if (!config.isConfigured()) {
    console.log(chalk.yellow('⚠️  Not configured. Run: codver config init'));
    return;
  }
  
  const api = new ApiClient(config);
  
  try {
    const health = await api.health();
    const jobs = await api.listJobs({ limit: 10 });
    const running = jobs.filter((j: any) => 
      ['cloning', 'building', 'running', 'extracting'].includes(j.status)
    ).length;
    
    console.log(chalk.green(`✅ Connected to ${config.get('serverUrl')}`));
    console.log(`   Server: v${health.version}, healthy`);
    console.log(`   Jobs: ${running} running, ${jobs.length} recent`);
  } catch (error: any) {
    console.log(chalk.red(`❌ Cannot connect to server: ${error.message}`));
  }
}

export async function jobStatusCommand(jobId: string): Promise<void> {
  const config = new ConfigStore();
  const api = new ApiClient(config);
  
  try {
    const job = await api.getJob(jobId);
    
    console.log(chalk.blue(`\nJob: ${jobId}\n`));
    console.log(`  Status:      ${getStatusColor(job.status)(job.status)}`);
    console.log(`  Repository:  ${chalk.cyan(job.repoUrl)}`);
    console.log(`  Branch:      ${job.branch || chalk.gray('(default)')}`);
    console.log(`  Model:       ${job.model || chalk.gray('(default)')}`);
    console.log(`  Created:     ${new Date(job.createdAt).toLocaleString()}`);
    console.log(`  Updated:     ${new Date(job.updatedAt).toLocaleString()}`);
    
    if (job.completedAt) {
      console.log(`  Completed:   ${new Date(job.completedAt).toLocaleString()}`);
      if (job.duration) {
        const seconds = Math.floor(job.duration / 1000);
        console.log(`  Duration:    ${formatDuration(seconds)}`);
      }
    }
    
    if (job.prUrl) {
      console.log(`  PR:          ${chalk.cyan.underline(job.prUrl)}`);
    }
    
    if (job.errorMessage) {
      console.log(`  Error:       ${chalk.red(job.errorMessage)}`);
    }
    
    console.log();
  } catch (error: any) {
    console.log(chalk.red(`❌ Failed to get job: ${error.message}`));
    process.exit(1);
  }
}

function getStatusColor(status: string): typeof chalk {
  if (status === 'completed') return chalk.green;
  if (status === 'failed') return chalk.red;
  if (['pending', 'cloning', 'building', 'running'].includes(status)) return chalk.yellow;
  return chalk.gray;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
```

**`apps/client/src/commands/run.ts`**:
```typescript
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { ConfigStore } from '../config/store.js';
import { ApiClient } from '../api/client.js';
import type { JobRequest, ImageAttachment } from '@codver/shared-types';

export interface RunOptions {
  repo: string;
  branch?: string;
  prompt?: string;
  promptFile?: string;
  images?: string[];
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  files?: string[];
  timeout?: number;
  webhook?: string;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const config = new ConfigStore();
  
  if (!config.isConfigured()) {
    console.log(chalk.yellow('⚠️  Not configured. Run: codver config init'));
    process.exit(1);
  }
  
  // Build prompt
  let prompt = options.prompt || '';
  if (options.promptFile) {
    if (!fs.existsSync(options.promptFile)) {
      console.log(chalk.red(`❌ Prompt file not found: ${options.promptFile}`));
      process.exit(1);
    }
    prompt = fs.readFileSync(options.promptFile, 'utf-8');
  }
  
  if (!prompt) {
    console.log(chalk.red('❌ Either --prompt or --prompt-file is required'));
    process.exit(1);
  }
  
  // Process images
  const images: ImageAttachment[] = [];
  if (options.images) {
    for (const imgPath of options.images) {
      if (!fs.existsSync(imgPath)) {
        console.log(chalk.red(`❌ Image not found: ${imgPath}`));
        process.exit(1);
      }
      const data = fs.readFileSync(imgPath);
      const ext = path.extname(imgPath).slice(1).toLowerCase();
      const mediaType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      
      images.push({
        filename: path.basename(imgPath),
        data: data.toString('base64'),
        mediaType,
      });
    }
  }
  
  // Build request
  const request: JobRequest = {
    repoUrl: options.repo,
    branch: options.branch,
    prompt,
    images: images.length > 0 ? images : undefined,
    model: options.model || config.get('defaultModel'),
    provider: options.provider,
    thinkingLevel: options.thinkingLevel as any,
    additionalFiles: options.files,
    webhookUrl: options.webhook,
    timeout: options.timeout ? options.timeout * 60 : undefined,
  };
  
  // Submit job
  const api = new ApiClient(config);
  
  try {
    console.log(chalk.blue('Submitting job...'));
    const job = await api.createJob(request);
    
    console.log(chalk.green(`\n✅ Job submitted: ${chalk.cyan(job.jobId)}`));
    console.log(chalk.gray(`\nTrack with: codver status --job-id ${job.jobId}`));
    console.log(chalk.gray(`View logs: codver logs --job-id ${job.jobId}`));
  } catch (error: any) {
    console.log(chalk.red(`❌ Failed to submit job: ${error.message}`));
    process.exit(1);
  }
}
```

**`apps/client/src/commands/jobs.ts`**:
```typescript
import chalk from 'chalk';
import { ConfigStore } from '../config/store.js';
import { ApiClient } from '../api/client.js';

export async function jobsListCommand(options: { limit?: number; status?: string } = {}): Promise<void> {
  const config = new ConfigStore();
  const api = new ApiClient(config);
  
  try {
    const jobs = await api.listJobs({
      limit: options.limit || 20,
      status: options.status,
    });
    
    if (jobs.length === 0) {
      console.log(chalk.gray('\nNo jobs found\n'));
      return;
    }
    
    console.log(chalk.blue(`\nRecent Jobs (${jobs.length}):\n`));
    console.log(
      chalk.gray('ID'.padEnd(20)) +
      chalk.gray('REPO'.padEnd(35)) +
      chalk.gray('STATUS'.padEnd(15)) +
      chalk.gray('CREATED')
    );
    console.log(chalk.gray('─'.repeat(100)));
    
    for (const job of jobs) {
      const id = job.id.padEnd(20);
      const repo = job.repo_url.replace('https://github.com/', '').padEnd(35);
      const status = getStatusEmoji(job.status) + ' ' + job.status.padEnd(13);
      const created = new Date(job.created_at).toLocaleString();
      
      console.log(
        chalk.cyan(id) +
        repo +
        getStatusColor(job.status)(status) +
        chalk.gray(created)
      );
    }
    console.log();
  } catch (error: any) {
    console.log(chalk.red(`❌ Failed to list jobs: ${error.message}`));
    process.exit(1);
  }
}

function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    pending: '⏳',
    cloning: '📥',
    building: '🔨',
    running: '⚙️',
    extracting: '📦',
    completed: '✅',
    failed: '❌',
  };
  return map[status] || '❓';
}

function getStatusColor(status: string): typeof chalk {
  if (status === 'completed') return chalk.green;
  if (status === 'failed') return chalk.red;
  if (['running', 'building', 'extracting'].includes(status)) return chalk.yellow;
  return chalk.gray;
}
```

**`apps/client/src/commands/logs.ts`**:
```typescript
import chalk from 'chalk';
import { ConfigStore } from '../config/store.js';
import { ApiClient } from '../api/client.js';

export async function logsCommand(
  jobId: string,
  options: { follow?: boolean; limit?: number } = {}
): Promise<void> {
  const config = new ConfigStore();
  const api = new ApiClient(config);
  
  if (options.follow) {
    await streamLogs(api, jobId);
  } else {
    await showLogs(api, jobId, options.limit || 100);
  }
}

async function showLogs(api: ApiClient, jobId: string, limit: number): Promise<void> {
  try {
    const { logs } = await api.getJobLogs(jobId, { limit });
    
    if (logs.length === 0) {
      console.log(chalk.gray('No logs available yet\n'));
      return;
    }
    
    for (const log of logs) {
      const time = new Date(log.timestamp).toLocaleTimeString();
      const level = getLogLevelColor(log.level)(log.level.toUpperCase().padEnd(5));
      console.log(`[${chalk.gray(time)}] ${level} ${log.message}`);
    }
    console.log();
  } catch (error: any) {
    console.log(chalk.red(`❌ Failed to get logs: ${error.message}`));
    process.exit(1);
  }
}

async function streamLogs(api: ApiClient, jobId: string): Promise<void> {
  let lastTimestamp = 0;
  
  console.log(chalk.blue(`Streaming logs for ${jobId}... (Ctrl+C to stop)\n`));
  
  const interval = setInterval(async () => {
    try {
      const { logs } = await api.getJobLogs(jobId, { limit: 100, offset: 0 });
      const newLogs = logs.filter((l: any) => l.timestamp > lastTimestamp);
      
      for (const log of newLogs) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const level = getLogLevelColor(log.level)(log.level.toUpperCase().padEnd(5));
        console.log(`[${chalk.gray(time)}] ${level} ${log.message}`);
        lastTimestamp = log.timestamp;
      }
      
      // Check if job is done
      const job = await api.getJob(jobId);
      if (['completed', 'failed'].includes(job.status)) {
        console.log(chalk.green(`\n✅ Job ${job.status}`));
        if (job.prUrl) {
          console.log(chalk.cyan(`PR: ${job.prUrl}`));
        }
        clearInterval(interval);
        process.exit(0);
      }
    } catch (error: any) {
      console.log(chalk.red(`\n❌ Error: ${error.message}`));
      clearInterval(interval);
      process.exit(1);
    }
  }, 2000);
}

function getLogLevelColor(level: string): typeof chalk {
  if (level === 'error') return chalk.red;
  if (level === 'warn') return chalk.yellow;
  if (level === 'debug') return chalk.gray;
  return chalk.blue;
}
```

### 4. Main CLI

**`apps/client/src/index.ts`**:
```typescript
import { Command } from 'commander';
import { configInit, configSetServer, configSetKey, configView, configClear } from './commands/config.js';
import { statusCommand, jobStatusCommand } from './commands/status.js';
import { runCommand } from './commands/run.js';
import { jobsListCommand } from './commands/jobs.js';
import { logsCommand } from './commands/logs.js';

const program = new Command();

program
  .name('codver')
  .description('Remote AI execution server client')
  .version('0.1.0');

// Config commands
const configCmd = program
  .command('config')
  .description('Manage codver configuration');

configCmd
  .command('init')
  .description('Interactive setup wizard')
  .action(configInit);

configCmd
  .command('set-server <url>')
  .description('Set server URL')
  .action(configSetServer);

configCmd
  .command('set-key <key>')
  .description('Set API key')
  .action(configSetKey);

configCmd
  .command('view')
  .description('View current configuration')
  .action(configView);

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(configClear);

// Status command
program
  .command('status')
  .description('Check server status')
  .option('--job-id <id>', 'Get status of specific job')
  .action((options) => {
    if (options.jobId) {
      jobStatusCommand(options.jobId);
    } else {
      statusCommand();
    }
  });

// Run command
program
  .command('run')
  .description('Submit a new job')
  .requiredOption('--repo <url>', 'GitHub repository URL')
  .option('--branch <branch>', 'Git branch')
  .option('--prompt <text>', 'Inline prompt text')
  .option('--prompt-file <path>', 'Path to prompt file')
  .option('--images <files...>', 'Image files to attach')
  .option('--model <model>', 'AI model to use')
  .option('--provider <provider>', 'AI provider')
  .option('--thinking <level>', 'Thinking level (off|minimal|low|medium|high|xhigh)')
  .option('--files <files...>', 'Additional resource files')
  .option('--timeout <minutes>', 'Timeout in minutes', (v) => parseInt(v))
  .option('--webhook <url>', 'Webhook URL for completion notification')
  .action(runCommand);

// Jobs command
program
  .command('jobs')
  .description('Manage jobs')
  .option('--limit <n>', 'Number of jobs to show', (v) => parseInt(v))
  .option('--status <status>', 'Filter by status')
  .action((options) => jobsListCommand(options));

// Logs command
program
  .command('logs')
  .description('View job logs')
  .requiredOption('--job-id <id>', 'Job ID')
  .option('--follow', 'Stream logs in real-time')
  .option('--limit <n>', 'Number of log lines', (v) => parseInt(v))
  .action((jobId, options) => logsCommand(jobId, options))
  .alias('log');

program.parse(process.argv);

export function run() {
  program.parse(process.argv);
}
```

## Testing

### Manual Testing

```bash
# 1. Install CLI dependencies
cd apps/client
pnpm install
pnpm build

# 2. Link CLI globally
pnpm link --global

# 3. Test help
codver --help
# Should show all commands

# 4. Test config init
codver config init
# Interactive setup

# 5. Test status
codver status
# Should show server connection

# 6. Test job submission
codver run \
  --repo https://github.com/test/repo \
  --branch main \
  --prompt "Add tests"
# Should submit job and return job ID

# 7. Test job status
codver status --job-id <id>
# Should show job details

# 8. Test logs
codver logs --job-id <id>
# Should show logs

# 9. Test jobs list
codver jobs list
# Should show recent jobs

# 10. Test prompt file
echo "Add comprehensive tests" > /tmp/prompt.md
codver run --repo ... --prompt-file /tmp/prompt.md

# 11. Test images
codver run --repo ... --prompt "Add UI" --images ./mockup.png

# 12. Test config view
codver config view
# Should show current config
```

### Automated Tests

**`apps/client/src/__tests__/config.test.ts`**:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigStore } from '../config/store.js';

describe('ConfigStore', () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codver-test-'));
    process.env.HOME = testDir;
  });
  
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });
  
  it('should save and retrieve config', () => {
    const config = new ConfigStore();
    config.set('serverUrl', 'https://test.com');
    config.set('apiKey', 'test-key');
    
    const config2 = new ConfigStore();
    expect(config2.get('serverUrl')).toBe('https://test.com');
    expect(config2.get('apiKey')).toBe('test-key');
  });
  
  it('should check if configured', () => {
    const config = new ConfigStore();
    expect(config.isConfigured()).toBe(false);
    
    config.set('serverUrl', 'https://test.com');
    expect(config.isConfigured()).toBe(false);
    
    config.set('apiKey', 'test-key');
    expect(config.isConfigured()).toBe(true);
  });
  
  it('should clear config', () => {
    const config = new ConfigStore();
    config.set('serverUrl', 'https://test.com');
    config.clear();
    expect(config.get('serverUrl')).toBeUndefined();
  });
});
```

## Validation Checklist

- [ ] CLI shows help with `codver --help`
- [ ] `codver config init` works interactively
- [ ] `codver config set-server` and `set-key` work
- [ ] `codver config view` shows configuration
- [ ] `codver status` connects to server
- [ ] `codver run` submits jobs
- [ ] `codver status --job-id` shows job details
- [ ] `codver logs --job-id` shows logs
- [ ] `codver logs --job-id --follow` streams logs
- [ ] `codver jobs list` shows recent jobs
- [ ] Prompt files work
- [ ] Image uploads work
- [ ] Model selection works
- [ ] Timeout configuration works
- [ ] All tests pass

## Next Phase

Proceed to [Phase 4: Job Queue & GitHub Integration](./04-job-queue-github.md)
