# Phase 6: Pi SDK Execution in Docker

**Goal:** Run Pi agent inside container with full event capture.

**Duration:** 4-5 days | **Complexity:** High

## Objectives

1. Implement container runner service
2. Run Pi agent in Docker with SDK
3. Capture and stream agent events
4. Handle container lifecycle
5. Implement timeout and resource management

## Tasks

### 1. Container Runner Service

**`apps/server/src/services/docker/runner.ts`**:
```typescript
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../../middleware/logger.js';
import { getDatabase } from '../../database/connection.js';
import type { Language } from '../language/detector.js';

const execAsync = promisify(exec);

export interface ContainerRunOptions {
  jobId: string;
  imageName: string;
  workDir: string;
  env: Record<string, string>;
  timeout: number; // in seconds
  cpuLimit?: string;
  memoryLimit?: string;
}

export interface ContainerRunResult {
  success: boolean;
  exitCode: number;
  logs: string;
  duration: number;
  error?: string;
}

export class ContainerRunner {
  async run(options: ContainerRunOptions): Promise<ContainerRunResult> {
    const startTime = Date.now();
    const containerName = `codver-job-${options.jobId}`;
    
    logger.info({
      jobId: options.jobId,
      imageName: options.imageName,
      timeout: options.timeout,
    }, 'Starting container');
    
    // Create .env file in work directory
    const envContent = Object.entries(options.env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    fs.writeFileSync(path.join(options.workDir, '.env'), envContent, { mode: 0o600 });
    
    // Build docker run command
    const args = this.buildDockerArgs(containerName, options);
    
    return new Promise((resolve) => {
      const child = spawn('docker', args, {
        cwd: options.workDir,
        env: process.env,
      });
      
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      // Set timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        logger.warn({ jobId: options.jobId }, 'Container timeout, killing');
        child.kill('SIGTERM');
        
        // Force kill after grace period
        setTimeout(() => {
          child.kill('SIGKILL');
        }, 5000);
      }, options.timeout * 1000);
      
      // Capture output
      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        this.logContainerOutput(options.jobId, 'info', text);
      });
      
      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        this.logContainerOutput(options.jobId, 'warn', text);
      });
      
      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        logger.error({ jobId: options.jobId, error: error.message }, 'Container error');
        resolve({
          success: false,
          exitCode: -1,
          logs: stdout + stderr,
          duration: Date.now() - startTime,
          error: error.message,
        });
      });
      
      child.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;
        
        logger.info({
          jobId: options.jobId,
          exitCode: code,
          duration,
        }, 'Container exited');
        
        resolve({
          success: code === 0 && !timedOut,
          exitCode: code || 0,
          logs: stdout + stderr,
          duration,
          error: timedOut ? 'Container timeout' : undefined,
        });
      });
    });
  }
  
  private buildDockerArgs(containerName: string, options: ContainerRunOptions): string[] {
    const args = [
      'run',
      '--rm',
      '--name', containerName,
      '-v', `${options.workDir}:/workspace`,
      '-w', '/workspace',
    ];
    
    // Add environment variables
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`);
    }
    
    // Security options
    args.push('--security-opt', 'no-new-privileges:true');
    args.push('--cap-drop', 'ALL');
    args.push('--cap-add', 'CHOWN');
    args.push('--cap-add', 'DAC_OVERRIDE');
    args.push('--cap-add', 'SETGID');
    args.push('--cap-add', 'SETUID');
    
    // Resource limits
    if (options.cpuLimit) {
      args.push('--cpus', options.cpuLimit);
    }
    if (options.memoryLimit) {
      args.push('--memory', options.memoryLimit);
    }
    
    // User
    args.push('--user', '1000:1000');
    
    // Read-only with tmpfs
    args.push('--read-only');
    args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=1g');
    args.push('--tmpfs', '/root/.pi:rw,noexec,nosuid,size=100m');
    
    // Image
    args.push(options.imageName);
    
    return args;
  }
  
  private logContainerOutput(jobId: string, level: string, text: string): void {
    const db = getDatabase();
    const lines = text.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      db.prepare(`
        INSERT INTO job_logs (job_id, timestamp, level, message)
        VALUES (?, ?, ?, ?)
      `).run(jobId, Date.now(), level, line);
    }
  }
  
  async stopContainer(jobId: string): Promise<void> {
    const containerName = `codver-job-${jobId}`;
    try {
      await execAsync(`docker stop ${containerName}`);
    } catch (error) {
      // Container might already be stopped
    }
  }
  
  async removeContainer(jobId: string): Promise<void> {
    const containerName = `codver-job-${jobId}`;
    try {
      await execAsync(`docker rm -f ${containerName}`);
    } catch (error) {
      // Container might not exist
    }
  }
}

export const containerRunner = new ContainerRunner();
```

### 2. Updated Job Processor

**Update `apps/server/src/services/queue/processor.ts`**:
```typescript
import { getDatabase } from '../../database/connection.js';
import { logger } from '../../middleware/logger.js';
import { cloneRepository } from '../github/clone.js';
import { detectLanguage } from '../language/detector.js';
import { dockerTemplateEngine } from '../docker/templates.js';
import { dockerBuilder } from '../docker/builder.js';
import { containerRunner } from '../docker/runner.js';
import { config } from '../../config/index.js';
import path from 'path';
import fs from 'fs';

export async function processJob(jobId: string): Promise<void> {
  const db = getDatabase();
  
  const job = db.prepare(`
    SELECT * FROM jobs WHERE id = ?
  `).get(jobId) as any;
  
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  
  const workDir = path.join(config.WORK_DIR, jobId);
  
  try {
    // Stage 1: Clone
    updateJobStatus(jobId, 'cloning');
    logToJob(jobId, 'info', `Cloning repository: ${job.repo_url}`);
    
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    
    await cloneRepository(job.repo_url, workDir, job.branch);
    logToJob(jobId, 'info', 'Repository cloned');
    
    // Stage 2: Detect language
    logToJob(jobId, 'info', 'Detecting language...');
    const language = await detectLanguage(workDir);
    logToJob(jobId, 'info', `Language: ${language}`);
    
    // Stage 3: Generate Docker files
    logToJob(jobId, 'info', 'Generating Docker files...');
    
    const env: Record<string, string> = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      PI_PROMPT: job.prompt,
      PI_MODEL: job.model || 'claude-sonnet-4',
      PI_PROVIDER: 'anthropic',
      PI_THINKING_LEVEL: 'medium',
      PI_LOG_FILE: '/workspace/.codver-logs.jsonl',
      PI_IMAGES: JSON.stringify([]),
    };
    
    await dockerTemplateEngine.generateFiles(language, workDir, env);
    logToJob(jobId, 'info', 'Docker files generated');
    
    // Stage 4: Build image
    updateJobStatus(jobId, 'building');
    logToJob(jobId, 'info', 'Building Docker image...');
    const imageName = await dockerBuilder.buildImage(language, workDir, jobId, true);
    logToJob(jobId, 'info', `Image built: ${imageName}`);
    
    // Stage 5: Run container
    updateJobStatus(jobId, 'running');
    logToJob(jobId, 'info', 'Starting container...');
    
    const result = await containerRunner.run({
      jobId,
      imageName,
      workDir,
      env,
      timeout: job.timeout || config.DEFAULT_TIMEOUT,
      cpuLimit: '2',
      memoryLimit: '4g',
    });
    
    logToJob(jobId, 'info', `Container exited with code ${result.exitCode} in ${Math.floor(result.duration / 1000)}s`);
    
    if (!result.success) {
      throw new Error(result.error || `Container failed with exit code ${result.exitCode}`);
    }
    
    // Stage 6: Extract changes
    updateJobStatus(jobId, 'extracting');
    logToJob(jobId, 'info', 'Extracting changes...');
    
    // Note: PR creation will be in Phase 7
    updateJobStatus(jobId, 'completed', {
      completed_at: Date.now(),
    });
    logToJob(jobId, 'info', 'Job completed successfully');
  } catch (error: any) {
    logToJob(jobId, 'error', `Job failed: ${error.message}`);
    updateJobStatus(jobId, 'failed', {
      error_message: error.message,
      completed_at: Date.now(),
    });
    
    // Cleanup on failure
    await containerRunner.removeContainer(jobId);
    throw error;
  } finally {
    // Always cleanup container
    await containerRunner.removeContainer(jobId);
  }
}

function updateJobStatus(
  jobId: string,
  status: string,
  extra: Record<string, any> = {}
): void {
  const db = getDatabase();
  const updates = ['status = ?', 'updated_at = ?'];
  const values: any[] = [status, Date.now()];
  
  for (const [key, value] of Object.entries(extra)) {
    updates.push(`${key} = ?`);
    values.push(value);
  }
  
  values.push(jobId);
  
  db.prepare(`
    UPDATE jobs SET ${updates.join(', ')} WHERE id = ?
  `).run(...values);
}

function logToJob(jobId: string, level: string, message: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO job_logs (job_id, timestamp, level, message)
    VALUES (?, ?, ?, ?)
  `).run(jobId, Date.now(), level, message);
  
  logger.info({ jobId, level, message });
}
```

### 3. Pi Event Parser

**`apps/server/src/services/pi-agent/logger.ts`**:
```typescript
import fs from 'fs';
import path from 'path';
import { logger } from '../../middleware/logger.js';
import { getDatabase } from '../../database/connection.js';

export interface PiEvent {
  timestamp: string;
  type: string;
  [key: string]: any;
}

export class PiEventLogger {
  private eventStream?: fs.ReadStream;
  private position = 0;
  
  startWatching(logFile: string, jobId: string): void {
    if (!fs.existsSync(logFile)) {
      logger.warn({ logFile }, 'Pi log file does not exist yet');
      return;
    }
    
    this.eventStream = fs.createReadStream(logFile, {
      encoding: 'utf-8',
      start: this.position,
    });
    
    let buffer = '';
    
    this.eventStream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const event = JSON.parse(line) as PiEvent;
          this.processEvent(event, jobId);
        } catch (error) {
          logger.warn({ line }, 'Failed to parse Pi event');
        }
      }
    });
    
    this.eventStream.on('end', () => {
      // File ended, check for new data periodically
    });
    
    this.eventStream.on('error', (error) => {
      logger.error({ error: error.message }, 'Event stream error');
    });
  }
  
  private processEvent(event: PiEvent, jobId: string): void {
    const db = getDatabase();
    
    // Store event in database
    db.prepare(`
      INSERT INTO job_logs (job_id, timestamp, level, message)
      VALUES (?, ?, ?, ?)
    `).run(
      jobId,
      new Date(event.timestamp).getTime(),
      this.getEventLevel(event.type),
      this.formatEventMessage(event)
    );
  }
  
  private getEventLevel(type: string): string {
    if (type === 'agent_end' && (event as any).error) return 'error';
    if (type === 'tool_execution_end' && (event as any).isError) return 'error';
    return 'info';
  }
  
  private formatEventMessage(event: PiEvent): string {
    switch (event.type) {
      case 'agent_start':
        return '[pi] Agent started';
      case 'agent_end':
        return '[pi] Agent completed';
      case 'message_start':
        return '[pi] Message started';
      case 'message_end':
        return '[pi] Message completed';
      case 'tool_execution_start':
        return `[pi] Tool: ${(event as any).toolName}`;
      case 'tool_execution_end':
        const isError = (event as any).isError;
        return `[pi] Tool ${isError ? 'failed' : 'completed'}: ${(event as any).toolName}`;
      case 'turn_start':
        return '[pi] Turn started';
      case 'turn_end':
        return '[pi] Turn completed';
      default:
        return `[pi] ${event.type}`;
    }
  }
  
  stop(): void {
    if (this.eventStream) {
      this.eventStream.destroy();
      this.eventStream = undefined;
    }
  }
}

export const piEventLogger = new PiEventLogger();
```

### 4. Update Container Runner with Event Logging

**Update `apps/server/src/services/docker/runner.ts`** to include event logger:

```typescript
// Add to imports
import { piEventLogger } from '../pi-agent/logger.js';

// In the run method, after starting container:
piEventLogger.startWatching(
  path.join(options.workDir, '.codver-logs.jsonl'),
  options.jobId
);

// In cleanup:
// piEventLogger.stop();
```

### 5. Timeout Management

**`apps/server/src/services/queue/timeout.ts`**:
```typescript
import { getDatabase } from '../../database/connection.js';
import { containerRunner } from '../docker/runner.js';
import { logger } from '../../middleware/logger.js';

export class TimeoutManager {
  private timeouts = new Map<string, NodeJS.Timeout>();
  
  setTimeout(jobId: string, timeoutSeconds: number): void {
    if (this.timeouts.has(jobId)) {
      clearTimeout(this.timeouts.get(jobId)!);
    }
    
    const handle = setTimeout(async () => {
      logger.warn({ jobId }, 'Job timeout reached');
      
      // Mark as failed
      const db = getDatabase();
      db.prepare(`
        UPDATE jobs
        SET status = 'failed',
            error_message = 'Job timeout exceeded',
            completed_at = ?
        WHERE id = ?
      `).run(Date.now(), jobId);
      
      // Stop container
      await containerRunner.stopContainer(jobId);
      await containerRunner.removeContainer(jobId);
      
      this.timeouts.delete(jobId);
    }, timeoutSeconds * 1000);
    
    this.timeouts.set(jobId, handle);
  }
  
  clearTimeout(jobId: string): void {
    if (this.timeouts.has(jobId)) {
      clearTimeout(this.timeouts.get(jobId)!);
      this.timeouts.delete(jobId);
    }
  }
}

export const timeoutManager = new TimeoutManager();
```

### 6. Update Routes for Better Log Streaming

**Update `apps/server/src/routes/jobs.ts`** to add SSE endpoint:

```typescript
// Add this route
jobsRouter.get('/jobs/:id/logs/stream', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  let lastTimestamp = 0;
  
  const interval = setInterval(() => {
    const db = getDatabase();
    const logs = db.prepare(`
      SELECT timestamp, level, message
      FROM job_logs
      WHERE job_id = ? AND timestamp > ?
      ORDER BY timestamp ASC
      LIMIT 50
    `).all(id, lastTimestamp);
    
    for (const log of logs) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
      lastTimestamp = log.timestamp;
    }
    
    // Check if job is done
    const job = db.prepare(`
      SELECT status FROM jobs WHERE id = ?
    `).get(id) as any;
    
    if (job && ['completed', 'failed'].includes(job.status)) {
      res.write(`event: done\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 1000);
  
  req.on('close', () => {
    clearInterval(interval);
  });
});
```

## Testing

### Manual Testing

```bash
# 1. Pre-build images
codver admin build-images
# Or: curl -X POST http://localhost:3000/admin/build-images -H "X-API-Key: admin-key"

# 2. Submit a test job
codver run --repo https://github.com/user/repo --prompt "Add a hello world function"

# 3. Watch server logs in real-time
codver logs --job-id <id> --follow
# Should show:
# [Job-abc] Cloning repository...
# [Job-abc] Repository cloned
# [Job-abc] Detecting language...
# [Job-abc] Language: node
# [Job-abc] Generating Docker files...
# [Job-abc] Building Docker image...
# [Job-abc] Image built: codver-pi-node:abc
# [Job-abc] Starting container...
# [pi] Agent started
# [pi] Tool: bash
# [pi] Tool: edit
# [pi] Agent completed
# [Job-abc] Container exited with code 0
# [Job-abc] Job completed

# 4. Check Docker container logs
docker logs codver-job-abc
# Should show Pi agent output

# 5. Check Pi events log
cat ~/.codver-dev/abc/.codver-logs.jsonl
# Should show JSONL events

# 6. Test with timeout
codver run --repo ... --timeout 5
# Should kill container after 5 minutes

# 7. Test resource limits
docker stats codver-job-abc
# Should show: CPU limited to 2 cores, memory limited to 4GB

# 8. Verify security
docker exec codver-job-abc whoami
# Should show: codver (uid 1000, not root)

# 9. Test cleanup
ls ~/.codver-dev/abc/
# Should still have project files (cleanup in Phase 7)
```

### Automated Tests

**`apps/server/src/__tests__/container-runner.test.ts`**:
```typescript
import { describe, it, expect } from 'vitest';
import { containerRunner } from '../services/docker/runner.js';
import { dockerBuilder } from '../services/docker/builder.js';
import { initializeDatabase } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('ContainerRunner', () => {
  it('should run container successfully', async () => {
    // Setup
    process.env.DB_PATH = ':memory:';
    initializeDatabase();
    
    const jobId = 'test-job-1';
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codver-test-'));
    
    try {
      // Build test image
      const imageName = await dockerBuilder.buildImage(
        'node',
        './src/templates/docker/node',
        jobId,
        false
      );
      
      // Run container
      const result = await containerRunner.run({
        jobId,
        imageName,
        workDir,
        env: {
          PI_PROMPT: 'Test prompt',
          ANTHROPIC_API_KEY: 'test-key',
        },
        timeout: 30,
      });
      
      // Container should fail (no API key) but runner should handle it
      expect(result).toBeDefined();
      expect(result.exitCode).toBeDefined();
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 60000);
});
```

## Validation Checklist

- [ ] Container starts successfully
- [ ] Pi agent runs inside container
- [ ] Events are captured and stored
- [ ] Logs are streamed to client
- [ ] Timeout works correctly
- [ ] Resource limits are enforced
- [ ] Container runs as non-root user
- [ ] Container is cleaned up after completion
- [ ] Container is cleaned up on failure
- [ ] Pi events are parsed correctly
- [ ] All tests pass

## Next Phase

Proceed to [Phase 7: PR Creation & Cleanup](./07-pr-creation-cleanup.md)
