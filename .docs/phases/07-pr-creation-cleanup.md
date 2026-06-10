# Phase 7: PR Creation & Cleanup

**Goal:** Create clean PR with AI-generated metadata and cleanup resources.

**Duration:** 3-4 days | **Complexity:** Medium

## Objectives

1. Extract modified files from container
2. Generate PR metadata with AI
3. Create branch, commit, and push
4. Create PR via GitHub CLI
5. Cleanup all resources

## Tasks

### 1. AI Metadata Generation

**`apps/server/src/utils/ai.ts`**:
```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateBranchName(prompt: string, diff: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: `Generate a concise git branch name for this change. Use kebab-case, max 50 chars, prefix with "feat/" or "fix/".\n\nOriginal prompt: ${prompt}\n\nCode changes:\n${diff.substring(0, 1000)}\n\nRespond with ONLY the branch name, nothing else.`
    }]
  });
  
  const branchName = (message.content[0] as any).text.trim();
  return branchName.replace(/[^a-z0-9\-\/]/gi, '').toLowerCase();
}

export async function generatePRTitle(prompt: string, diff: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Generate a concise PR title (max 72 chars) for this change.\n\nOriginal prompt: ${prompt}\n\nCode changes:\n${diff.substring(0, 1000)}\n\nRespond with ONLY the title, nothing else.`
    }]
  });
  
  return (message.content[0] as any).text.trim();
}

export async function generatePRDescription(
  prompt: string,
  diff: string,
  jobId: string
): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Generate a detailed PR description in markdown format.\n\nOriginal prompt: ${prompt}\n\nCode changes:\n${diff.substring(0, 2000)}\n\nInclude:\n- Summary of changes\n- Key modifications\n- Any breaking changes\n- Testing notes\n\nJob ID: ${jobId}`
    }]
  });
  
  return (message.content[0] as any).text.trim();
}
```

### 2. Git Operations Service

**`apps/server/src/services/github/git.ts`**:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../middleware/logger.js';

const execAsync = promisify(exec);

export async function getGitDiff(repoDir: string): Promise<string> {
  const { stdout } = await execAsync(
    `cd ${repoDir} && git diff --no-color`,
    { maxBuffer: 50 * 1024 * 1024 }
  );
  return stdout;
}

export async function getModifiedFiles(repoDir: string): Promise<string[]> {
  const { stdout } = await execAsync(
    `cd ${repoDir} && git status --porcelain | awk '{print $2}'`
  );
  return stdout.split('\n').filter(f => f.trim());
}

export async function createBranch(repoDir: string, branchName: string): Promise<void> {
  await execAsync(`cd ${repoDir} && git checkout -b ${branchName}`);
  logger.info({ branchName }, 'Branch created');
}

export async function stageFiles(repoDir: string, files: string[]): Promise<void> {
  for (const file of files) {
    try {
      await execAsync(`cd ${repoDir} && git add "${file}"`);
    } catch (error: any) {
      logger.warn({ file, error: error.message }, 'Failed to stage file');
    }
  }
}

export async function commit(repoDir: string, message: string): Promise<void> {
  const escapedMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  await execAsync(`cd ${repoDir} && git commit -m "${escapedMessage}"`);
  logger.info({ message }, 'Committed changes');
}

export async function push(repoDir: string, branchName: string): Promise<void> {
  await execAsync(`cd ${repoDir} && git push origin ${branchName}`);
  logger.info({ branchName }, 'Pushed to origin');
}
```

### 3. PR Creation Service

**`apps/server/src/services/github/pr.ts`**:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../../middleware/logger.js';
import { generateBranchName, generatePRTitle, generatePRDescription } from '../../utils/ai.js';
import { getGitDiff, getModifiedFiles, createBranch, stageFiles, commit, push } from './git.js';

const execAsync = promisify(exec);

export interface PRCreationOptions {
  jobId: string;
  repoDir: string;
  prompt: string;
  defaultBranch: string;
}

export interface PRCreationResult {
  branchName: string;
  title: string;
  description: string;
  prUrl: string;
  prNumber: number;
  modifiedFiles: string[];
}

const EXCLUDED_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'executor.js',
  '.env',
  '.codver-logs.jsonl',
  '.codver-logs.jsonl.tmp',
  '.pr-body.tmp',
];

export async function createPullRequest(options: PRCreationOptions): Promise<PRCreationResult> {
  logger.info({ jobId: options.jobId }, 'Creating pull request');
  
  const allFiles = await getModifiedFiles(options.repoDir);
  const filesToCommit = allFiles.filter(f => !EXCLUDED_FILES.includes(path.basename(f)));
  
  if (filesToCommit.length === 0) {
    throw new Error('No files to commit (only Docker/excluded files modified)');
  }
  
  logger.info({ count: filesToCommit.length, files: filesToCommit }, 'Files to commit');
  
  const diff = await getGitDiff(options.repoDir);
  
  logger.info('Generating PR metadata with AI');
  const [branchName, title, description] = await Promise.all([
    generateBranchName(options.prompt, diff),
    generatePRTitle(options.prompt, diff),
    generatePRDescription(options.prompt, diff, options.jobId),
  ]);
  
  const finalBranchName = `${branchName}-${options.jobId}`;
  
  await createBranch(options.repoDir, finalBranchName);
  await stageFiles(options.repoDir, filesToCommit);
  
  const commitMessage = `${title}\n\nJob ID: ${options.jobId}\n\nGenerated by Codver`;
  await commit(options.repoDir, commitMessage);
  await push(options.repoDir, finalBranchName);
  
  const prResult = await createPRViaCLI(
    options.repoDir,
    finalBranchName,
    options.defaultBranch,
    title,
    description
  );
  
  logger.info({ prUrl: prResult.url, prNumber: prResult.number }, 'PR created');
  
  return {
    branchName: finalBranchName,
    title,
    description,
    prUrl: prResult.url,
    prNumber: prResult.number,
    modifiedFiles: filesToCommit,
  };
}

async function createPRViaCLI(
  repoDir: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string
): Promise<{ url: string; number: number }> {
  const bodyFile = path.join(repoDir, '.pr-body.tmp');
  fs.writeFileSync(bodyFile, body, 'utf-8');
  
  try {
    const escapedTitle = title.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `cd ${repoDir} && gh pr create --base ${baseBranch} --head ${branchName} --title "${escapedTitle}" --body-file "${bodyFile}"`
    );
    
    const urlMatch = stdout.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
    if (!urlMatch) {
      throw new Error(`Failed to parse PR URL from output: ${stdout}`);
    }
    
    const url = urlMatch[0];
    const prNumber = parseInt(url.split('/').pop() || '0');
    
    return { url, number: prNumber };
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch {}
  }
}
```

### 4. Error PR Service

**`apps/server/src/services/github/error-pr.ts`**:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../../middleware/logger.js';
import { getDatabase } from '../../database/connection.js';
import { createBranch, commit, push } from './git.js';

const execAsync = promisify(exec);

export async function createErrorPR(
  jobId: string,
  repoDir: string,
  errorMessage: string,
  defaultBranch: string
): Promise<string> {
  logger.info({ jobId, errorMessage }, 'Creating error PR');
  
  const db = getDatabase();
  const logs = db.prepare(`
    SELECT timestamp, level, message
    FROM job_logs
    WHERE job_id = ?
    ORDER BY timestamp ASC
  `).all(jobId) as any[];
  
  const errorReport = generateErrorReport(jobId, errorMessage, logs);
  
  const branchName = `codver-error-${jobId}`;
  await createBranch(repoDir, branchName);
  
  const reportPath = path.join(repoDir, `CODVER_ERROR_${jobId}.md`);
  fs.writeFileSync(reportPath, errorReport, 'utf-8');
  
  await execAsync(`cd ${repoDir} && git add "${reportPath}"`);
  await commit(repoDir, `Codver Error Report: Job ${jobId}`);
  await push(repoDir, branchName);
  
  const bodyFile = path.join(repoDir, '.error-body.tmp');
  fs.writeFileSync(bodyFile, errorReport, 'utf-8');
  
  try {
    const { stdout } = await execAsync(
      `cd ${repoDir} && gh pr create --base ${defaultBranch} --head ${branchName} --title "Codver Error: Job ${jobId}" --body-file "${bodyFile}"`
    );
    
    const urlMatch = stdout.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
    if (!urlMatch) {
      throw new Error(`Failed to create error PR: ${stdout}`);
    }
    
    logger.info({ prUrl: urlMatch[0] }, 'Error PR created');
    return urlMatch[0];
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch {}
  }
}

function generateErrorReport(jobId: string, error: string, logs: any[]): string {
  const logText = logs
    .map(l => `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] ${l.message}`)
    .join('\n');
  
  return [
    `# Codver Job Error Report`,
    ``,
    `**Job ID:** ${jobId}`,
    `**Status:** Failed`,
    `**Error:** ${error}`,
    ``,
    `## Error Details`,
    ``,
    '```',
    error,
    '```',
    ``,
    `## Execution Logs`,
    ``,
    '```',
    logText,
    '```',
    ``,
    `## Possible Causes`,
    ``,
    `- Invalid repository URL or permissions`,
    `- Missing dependencies in project`,
    `- API key issues`,
    `- Network connectivity problems`,
    `- Docker build failures`,
    `- Agent execution errors`,
    ``,
    `## Next Steps`,
    ``,
    `1. Review the error message above`,
    `2. Check job logs: \`codver logs --job-id ${jobId}\``,
    `3. Verify repository access and permissions`,
    `4. Retry the job if the issue is resolved`,
  ].join('\n');
}
```

### 5. Cleanup Service

**`apps/server/src/services/cleanup/index.ts`**:
```typescript
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../middleware/logger.js';
import { containerRunner } from '../docker/runner.js';

const execAsync = promisify(exec);

export interface CleanupOptions {
  jobId: string;
  workDir: string;
  removeProject: boolean;
  removeImages: boolean;
}

export async function cleanupJobResources(options: CleanupOptions): Promise<void> {
  logger.info({ jobId: options.jobId }, 'Starting cleanup');
  
  try {
    await containerRunner.stopContainer(options.jobId);
    await containerRunner.removeContainer(options.jobId);
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Container cleanup failed');
  }
  
  try {
    const dockerFiles = [
      'Dockerfile',
      'docker-compose.yml',
      'executor.js',
      '.env',
      '.codver-logs.jsonl',
      '.codver-logs.jsonl.tmp',
      '.pr-body.tmp',
      '.error-body.tmp',
    ];
    
    for (const file of dockerFiles) {
      const filePath = path.join(options.workDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    await execAsync(`cd ${options.workDir} && git checkout -- Dockerfile docker-compose.yml executor.js .env 2>/dev/null || true`);
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Docker file cleanup failed');
  }
  
  if (options.removeProject) {
    try {
      await execAsync(`rm -rf ${options.workDir}`);
      logger.info({ workDir: options.workDir }, 'Project directory removed');
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Project cleanup failed');
    }
  }
  
  if (options.removeImages) {
    try {
      const { stdout } = await execAsync(`docker images -q codver-pi-*:${options.jobId}`);
      const images = stdout.trim().split('\n').filter(i => i);
      for (const image of images) {
        await execAsync(`docker rmi ${image}`);
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Image cleanup failed');
    }
  }
}
```

### 6. Updated Job Processor

**Update `apps/server/src/services/queue/processor.ts`**:
```typescript
import { getDatabase } from '../../database/connection.js';
import { logger } from '../../middleware/logger.js';
import { cloneRepository, getDefaultBranch } from '../github/clone.js';
import { detectLanguage } from '../language/detector.js';
import { dockerTemplateEngine } from '../docker/templates.js';
import { dockerBuilder } from '../docker/builder.js';
import { containerRunner } from '../docker/runner.js';
import { createPullRequest } from '../github/pr.js';
import { createErrorPR } from '../github/error-pr.js';
import { cleanupJobResources } from '../cleanup/index.js';
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
    
    const defaultBranch = await cloneRepository(job.repo_url, workDir, job.branch);
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
    
    logToJob(jobId, 'info', `Container exited with code ${result.exitCode}`);
    
    if (!result.success) {
      throw new Error(result.error || `Container failed with exit code ${result.exitCode}`);
    }
    
    // Stage 6: Create PR
    updateJobStatus(jobId, 'extracting');
    logToJob(jobId, 'info', 'Creating pull request...');
    
    const pr = await createPullRequest({
      jobId,
      repoDir: workDir,
      prompt: job.prompt,
      defaultBranch: job.branch || defaultBranch,
    });
    
    logToJob(jobId, 'info', `PR created: ${pr.prUrl}`);
    
    // Stage 7: Cleanup
    logToJob(jobId, 'info', 'Cleaning up resources...');
    await cleanupJobResources({
      jobId,
      workDir,
      removeProject: true,
      removeImages: true,
    });
    
    updateJobStatus(jobId, 'completed', {
      pr_url: pr.prUrl,
      completed_at: Date.now(),
    });
    logToJob(jobId, 'info', 'Job completed successfully');
  } catch (error: any) {
    logToJob(jobId, 'error', `Job failed: ${error.message}`);
    
    // Try to create error PR if repo was cloned
    if (fs.existsSync(workDir) && fs.existsSync(path.join(workDir, '.git'))) {
      try {
        logToJob(jobId, 'info', 'Creating error report PR...');
        const errorPRUrl = await createErrorPR(
          jobId,
          workDir,
          error.message,
          job.branch || 'main'
        );
        logToJob(jobId, 'info', `Error PR created: ${errorPRUrl}`);
        
        updateJobStatus(jobId, 'failed', {
          pr_url: errorPRUrl,
          error_message: error.message,
          completed_at: Date.now(),
        });
      } catch (prError: any) {
        logToJob(jobId, 'error', `Failed to create error PR: ${prError.message}`);
        updateJobStatus(jobId, 'failed', {
          error_message: error.message,
          completed_at: Date.now(),
        });
      }
    } else {
      updateJobStatus(jobId, 'failed', {
        error_message: error.message,
        completed_at: Date.now(),
      });
    }
    
    // Always cleanup
    try {
      await cleanupJobResources({
        jobId,
        workDir,
        removeProject: true,
        removeImages: true,
      });
    } catch (cleanupError: any) {
      logger.warn({ error: cleanupError.message }, 'Cleanup failed');
    }
    
    throw error;
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

### 7. Update Clone to Return Default Branch

**Update `apps/server/src/services/github/clone.ts`**:
```typescript
export async function cloneRepository(
  repoUrl: string,
  targetDir: string,
  branch?: string
): Promise<string> {
  // ... existing clone logic
  
  // Get default branch
  const { stdout } = await execAsync(
    `cd ${targetDir} && git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'`
  );
  
  return stdout.trim() || branch || 'main';
}
```

## Testing

### Manual Testing

```bash
# 1. Ensure ANTHROPIC_API_KEY is set on server
export ANTHROPIC_API_KEY=sk-...

# 2. Submit a job
codver run --repo https://github.com/octocat/Hello-World --prompt "Add a hello world script"

# 3. Watch server logs
codver logs --job-id <id> --follow
# Should show:
# [Job-abc] Cloning repository...
# [Job-abc] Repository cloned
# [Job-abc] Detecting language...
# [Job-abc] Language: generic
# [Job-abc] Generating Docker files...
# [Job-abc] Building Docker image...
# [Job-abc] Image built
# [Job-abc] Starting container...
# [pi] Agent started
# [pi] Tool: bash
# [pi] Tool: write
# [pi] Agent completed
# [Job-abc] Container exited with code 0
# [Job-abc] Creating pull request...
# [Job-abc] PR created: https://github.com/octocat/Hello-World/pull/1
# [Job-abc] Cleaning up resources...
# [Job-abc] Job completed

# 4. Check GitHub
# Visit the PR URL
# Verify:
# - Branch name follows pattern: feat/xxx-{jobId}
# - Title is AI-generated
# - Description is detailed and AI-generated
# - Files exclude: Dockerfile, docker-compose.yml, executor.js
# - Email notification sent to watchers

# 5. Verify cleanup
ls ~/.codver-dev/abc/
# Should not exist (removed)

docker images | grep abc
# Should be empty (image removed)

# 6. Test failure case
codver run --repo https://github.com/invalid/repo --prompt "test"
# Should create error PR with logs

# 7. Test with non-existent branch
codver run --repo ... --branch nonexistent --prompt "test"
# Should fail with clear error

# 8. Test multiple concurrent jobs
codver run --repo ... --prompt "test1"
codver run --repo ... --prompt "test2"
codver run --repo ... --prompt "test3"
# All should process concurrently (up to limit)
```

## Validation Checklist

- [ ] AI generates branch name, title, and description
- [ ] PR is created with correct files (excludes Docker files)
- [ ] PR author is bot account
- [ ] GitHub email notification is triggered
- [ ] Resources are cleaned up after success
- [ ] Resources are cleaned up after failure
- [ ] Error PR is created on failure
- [ ] Multiple concurrent jobs work
- [ ] PR URL is stored in database
- [ ] All tests pass

## Next Phase

Proceed to [Phase 8: Error Handling & Failure PRs](./08-error-handling.md)
```
