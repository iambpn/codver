# Phase 8: Error Handling & Failure PRs

**Goal:** Comprehensive error handling with failure PRs.

**Duration:** 2-3 days | **Complexity:** Medium

## Objectives

1. Detect errors at all stages
2. Collect detailed error logs
3. Create failure PRs with AI analysis
4. Ensure resource cleanup on all error paths
5. Implement retry logic for transient errors

## Tasks

### 1. Error Classification

**`apps/server/src/utils/errors.ts`**:
```typescript
export enum ErrorType {
  CLONE_FAILED = 'clone_failed',
  BUILD_FAILED = 'build_failed',
  CONTAINER_FAILED = 'container_failed',
  AGENT_TIMEOUT = 'agent_timeout',
  AGENT_CRASH = 'agent_crash',
  GIT_OPERATION_FAILED = 'git_operation_failed',
  PR_CREATION_FAILED = 'pr_creation_failed',
  AUTH_FAILED = 'auth_failed',
  VALIDATION_FAILED = 'validation_failed',
  UNKNOWN = 'unknown',
}

export class CodverError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public details?: any,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'CodverError';
  }
}

export function classifyError(error: any): CodverError {
  const message = error.message || String(error);
  
  if (message.includes('not found') && message.includes('repository')) {
    return new CodverError(
      ErrorType.CLONE_FAILED,
      `Repository not found: ${message}`,
      error,
      false
    );
  }
  
  if (message.includes('Permission denied')) {
    return new CodverError(
      ErrorType.AUTH_FAILED,
      `Permission denied: ${message}`,
      error,
      false
    );
  }
  
  if (message.includes('Failed to build image')) {
    return new CodverError(
      ErrorType.BUILD_FAILED,
      `Docker build failed: ${message}`,
      error,
      false
    );
  }
  
  if (message.includes('timeout') || message.includes('timed out')) {
    return new CodverError(
      ErrorType.AGENT_TIMEOUT,
      `Operation timed out: ${message}`,
      error,
      true
    );
  }
  
  if (message.includes('agent') && message.includes('crash')) {
    return new CodverError(
      ErrorType.AGENT_CRASH,
      `Agent crashed: ${message}`,
      error,
      true
    );
  }
  
  if (message.includes('git') && (message.includes('push') || message.includes('commit'))) {
    return new CodverError(
      ErrorType.GIT_OPERATION_FAILED,
      `Git operation failed: ${message}`,
      error,
      true
    );
  }
  
  if (message.includes('gh pr create') || message.includes('PR creation')) {
    return new CodverError(
      ErrorType.PR_CREATION_FAILED,
      `PR creation failed: ${message}`,
      error,
      true
    );
  }
  
  return new CodverError(
    ErrorType.UNKNOWN,
    message,
    error,
    false
  );
}
```

### 2. Retry Logic

**`apps/server/src/services/queue/retry.ts`**:
```typescript
import { logger } from '../../middleware/logger.js';
import { CodverError, ErrorType } from '../../utils/errors.js';

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number; // milliseconds
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 5000,
  maxDelay: 60000,
  backoffMultiplier: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.initialDelay;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      const codverError = error instanceof CodverError ? error : null;
      
      // Don't retry non-retryable errors
      if (codverError && !codverError.retryable) {
        throw error;
      }
      
      if (attempt === opts.maxAttempts) {
        logger.warn({ attempt, error: error.message }, 'Max retry attempts reached');
        throw error;
      }
      
      logger.info({
        attempt,
        maxAttempts: opts.maxAttempts,
        delay,
        error: error.message,
      }, 'Retrying after error');
      
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }
  
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 3. Enhanced Error Reporting

**`apps/server/src/services/github/error-pr.ts`** (enhanced):
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../../middleware/logger.js';
import { getDatabase } from '../../database/connection.js';
import { createBranch, commit, push } from './git.js';
import { CodverError, ErrorType } from '../../utils/errors.js';
import { generateErrorAnalysis } from '../../utils/ai.js';

const execAsync = promisify(exec);

export async function createErrorPR(
  jobId: string,
  repoDir: string,
  error: CodverError | Error,
  defaultBranch: string
): Promise<string> {
  logger.info({ jobId, errorType: (error as any).type }, 'Creating error PR');
  
  const db = getDatabase();
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as any;
  const logs = db.prepare(`
    SELECT timestamp, level, message
    FROM job_logs
    WHERE job_id = ?
    ORDER BY timestamp ASC
  `).all(jobId) as any[];
  
  // Generate AI analysis
  let aiAnalysis = '';
  try {
    aiAnalysis = await generateErrorAnalysis(
      job.prompt,
      error.message,
      logs.map(l => l.message)
    );
  } catch (e) {
    logger.warn({ error: e }, 'AI analysis failed, using template');
  }
  
  const errorReport = generateErrorReport(jobId, error, logs, aiAnalysis);
  
  const branchName = `codver-error-${jobId}`;
  
  try {
    await createBranch(repoDir, branchName);
  } catch (e) {
    // Branch might already exist, try to use it
    await execAsync(`cd ${repoDir} && git checkout ${branchName}`);
  }
  
  const reportPath = path.join(repoDir, `CODVER_ERROR_${jobId}.md`);
  fs.writeFileSync(reportPath, errorReport, 'utf-8');
  
  await execAsync(`cd ${repoDir} && git add "${reportPath}"`);
  await commit(repoDir, `Codver Error Report: Job ${jobId}`);
  await push(repoDir, branchName);
  
  const bodyFile = path.join(repoDir, '.error-body.tmp');
  fs.writeFileSync(bodyFile, errorReport, 'utf-8');
  
  try {
    const { stdout } = await execAsync(
      `cd ${repoDir} && gh pr create --base ${defaultBranch} --head ${branchName} --title "Codver Error: ${getShortError(error)}" --body-file "${bodyFile}"`
    );
    
    const urlMatch = stdout.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
    if (!urlMatch) {
      throw new Error(`Failed to create error PR: ${stdout}`);
    }
    
    return urlMatch[0];
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch {}
  }
}

function getShortError(error: CodverError | Error): string {
  const message = error.message;
  return message.length > 50 ? message.substring(0, 47) + '...' : message;
}

function generateErrorReport(
  jobId: string,
  error: CodverError | Error,
  logs: any[],
  aiAnalysis: string
): string {
  const errorType = (error as CodverError).type || 'unknown';
  const isRetryable = (error as CodverError).retryable || false;
  
  const logText = logs
    .map(l => `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] ${l.message}`)
    .join('\n');
  
  return [
    `# Codver Job Error Report`,
    ``,
    `**Job ID:** ${jobId}`,
    `**Error Type:** ${errorType}`,
    `**Retryable:** ${isRetryable ? 'Yes' : 'No'}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    ``,
    `## Error Message`,
    ``,
    '```',
    error.message,
    '```',
    ``,
    aiAnalysis ? `## AI Analysis\n\n${aiAnalysis}\n` : '',
    `## Execution Logs`,
    ``,
    '```',
    logText,
    '```',
    ``,
    `## Possible Causes`,
    ``,
    ...getPossibleCauses(errorType),
    ``,
    `## Next Steps`,
    ``,
    `1. Review the error message and logs above`,
    `2. Check job status: \`codver status --job-id ${jobId}\``,
    `3. View detailed logs: \`codver logs --job-id ${jobId}\``,
    isRetryable ? `4. Retry the job: \`codver run ...\` (this error is retryable)` : `4. Fix the underlying issue before retrying`,
  ].filter(Boolean).join('\n');
}

function getPossibleCauses(errorType: string): string[] {
  const causes: Record<string, string[]> = {
    clone_failed: [
      '- Repository URL is incorrect',
      '- Repository is private and bot has no access',
      '- Network connectivity issues',
    ],
    build_failed: [
      '- Dockerfile template issues',
      '- Missing system dependencies',
      '- Pi SDK installation failed',
    ],
    container_failed: [
      '- Container exited with non-zero code',
      '- Resource limits exceeded',
      '- API key issues',
    ],
    agent_timeout: [
      '- Task is too complex for timeout',
      '- Network issues with AI provider',
      '- Rate limiting from AI provider',
    ],
    agent_crash: [
      '- Invalid prompt syntax',
      '- API key invalid or expired',
      '- Pi SDK version incompatibility',
    ],
    git_operation_failed: [
      '- Git conflicts',
      '- Network issues',
      '- Authentication problems',
    ],
    pr_creation_failed: [
      '- Bot has no permission to create PRs',
      '- Branch already exists',
      '- GitHub CLI not authenticated',
    ],
  };
  
  return causes[errorType] || ['- Unknown cause, see logs for details'];
}
```

### 4. AI Error Analysis

**Update `apps/server/src/utils/ai.ts`**:
```typescript
export async function generateErrorAnalysis(
  prompt: string,
  error: string,
  logs: string[]
): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Analyze this error and provide insights:\n\nOriginal prompt: ${prompt}\n\nError: ${error}\n\nRecent logs:\n${logs.slice(-20).join('\n')}\n\nProvide:\n1. Root cause analysis\n2. Likely fix\n3. Whether this is a transient or persistent error\n\nBe concise.`
    }]
  });
  
  return (message.content[0] as any).text.trim();
}
```

### 5. Webhook Notifications on Failure

**`apps/server/src/services/webhook/index.ts`**:
```typescript
import { logger } from '../../middleware/logger.js';
import type { JobDetails } from '@codver/shared-types';

export async function sendWebhook(
  url: string,
  job: JobDetails
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: job.status === 'completed' ? 'job.completed' : 'job.failed',
        job,
        timestamp: Date.now(),
      }),
    });
    
    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Webhook returned non-200');
    }
  } catch (error: any) {
    logger.error({ url, error: error.message }, 'Webhook delivery failed');
  }
}
```

## Testing

### Manual Testing

```bash
# 1. Test clone failure
codver run --repo https://github.com/invalid/nonexistent --prompt "test"
# Should create error PR with type: clone_failed

# 2. Test Docker build failure
# Corrupt the Dockerfile template temporarily
codver run --repo ... --prompt "test"
# Should create error PR with type: build_failed

# 3. Test agent timeout
codver run --repo ... --prompt "test" --timeout 1
# Should create error PR with type: agent_timeout

# 4. Test GitHub auth failure
# Remove GitHub auth temporarily
codver run --repo ... --prompt "test"
# Should create error PR with type: auth_failed

# 5. Test retryable vs non-retryable
# Network errors should be marked retryable
# Auth errors should not be retryable

# 6. Verify error PR content
# Check that error PR includes:
# - Error type
# - Retryable status
# - AI analysis
# - Full logs
# - Possible causes
# - Next steps

# 7. Test webhook
codver run --repo ... --prompt "test" --webhook https://httpbin.org/post
# Should POST to webhook on completion/failure

# 8. Test resource cleanup on all error paths
ls ~/.codver-dev/
# Should be empty after error

docker images | grep codver
# Should be empty after error
```

## Validation Checklist

- [ ] All error types are classified correctly
- [ ] Error PRs are created for all failure cases
- [ ] AI analysis is included in error PRs
- [ ] Resources are cleaned up on all error paths
- [ ] Retryable errors are marked correctly
- [ ] Webhooks are sent on completion/failure
- [ ] Error logs include all relevant information
- [ ] All tests pass

## Next Phase

Proceed to [Phase 9: Advanced Features](./09-advanced-features.md)
