# Phase 4: Job Queue & GitHub Integration

**Goal:** Server processes jobs, clones repositories, and tracks status.

**Duration:** 3-4 days | **Complexity:** Medium

## Objectives

1. Implement job queue with worker pool
2. Setup GitHub CLI authentication
3. Clone repositories to job directories
4. Track job status in database
5. Handle errors gracefully

## Tasks

### 1. Job Queue Service

**`apps/server/src/services/queue/index.ts`**:
```typescript
import { EventEmitter } from 'events';
import { getDatabase } from '../../database/connection.js';
import { logger } from '../../middleware/logger.js';
import { config } from '../../config/index.js';
import { processJob } from './processor.js';

export class JobQueue extends EventEmitter {
  private activeJobs = new Set<string>();
  private processing = false;
  
  async add(jobId: string): Promise<void> {
    logger.info({ jobId }, 'Job added to queue');
    this.emit('job:added', jobId);
    
    if (!this.processing) {
      this.processNext();
    }
  }
  
  private async processNext(): Promise<void> {
    this.processing = true;
    
    while (this.activeJobs.size < config.MAX_CONCURRENT_JOBS) {
      const jobId = this.getNextPendingJob();
      if (!jobId) {
        break;
      }
      
      this.activeJobs.add(jobId);
      this.processJob(jobId).finally(() => {
        this.activeJobs.delete(jobId);
        this.processNext(); // Process next job
      });
    }
    
    if (this.activeJobs.size === 0) {
      this.processing = false;
    }
  }
  
  private getNextPendingJob(): string | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT id FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get() as { id: string } | undefined;
    
    return row?.id || null;
  }
  
  private async processJob(jobId: string): Promise<void> {
    try {
      logger.info({ jobId }, 'Processing job');
      await processJob(jobId);
      logger.info({ jobId }, 'Job completed');
    } catch (error: any) {
      logger.error({ jobId, error: error.message }, 'Job failed');
    }
  }
  
  getActiveCount(): number {
    return this.activeJobs.size;
  }
}

export const jobQueue = new JobQueue();
```

### 2. Job Processor

**`apps/server/src/services/queue/processor.ts`**:
```typescript
import { getDatabase } from '../../database/connection.js';
import { logger } from '../../middleware/logger.js';
import { cloneRepository } from '../github/clone.js';
import { detectLanguage } from '../language/detector.js';
import { config } from '../../config/index.js';
import path from 'path';
import fs from 'fs';

export async function processJob(jobId: string): Promise<void> {
  const db = getDatabase();
  
  // Load job
  const job = db.prepare(`
    SELECT * FROM jobs WHERE id = ?
  `).get(jobId) as any;
  
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  
  const workDir = path.join(config.WORK_DIR, jobId);
  
  try {
    // Stage 1: Clone repository
    updateJobStatus(jobId, 'cloning');
    logToJob(jobId, 'info', `Cloning repository: ${job.repo_url}`);
    
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    
    await cloneRepository(job.repo_url, workDir, job.branch);
    logToJob(jobId, 'info', `Repository cloned to ${workDir}`);
    
    // Stage 2: Detect language
    logToJob(jobId, 'info', 'Detecting project language...');
    const language = await detectLanguage(workDir);
    logToJob(jobId, 'info', `Detected language: ${language}`);
    
    // Store language in job (add column if needed)
    db.prepare(`
      UPDATE jobs SET updated_at = ? WHERE id = ?
    `).run(Date.now(), jobId);
    
    updateJobStatus(jobId, 'ready');
    logToJob(jobId, 'info', 'Job ready for execution');
    
    // Note: Docker build and execution will be in Phase 5/6
    // For now, mark as completed to test the flow
    updateJobStatus(jobId, 'completed', {
      completed_at: Date.now(),
    });
    logToJob(jobId, 'info', 'Job completed (Phase 4 - basic flow)');
  } catch (error: any) {
    logToJob(jobId, 'error', `Job failed: ${error.message}`);
    updateJobStatus(jobId, 'failed', {
      error_message: error.message,
      completed_at: Date.now(),
    });
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

### 3. GitHub Repository Cloning

**`apps/server/src/services/github/clone.ts`**:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { logger } from '../../middleware/logger.js';

const execAsync = promisify(exec);

export async function cloneRepository(
  repoUrl: string,
  targetDir: string,
  branch?: string
): Promise<void> {
  logger.info({ repoUrl, targetDir, branch }, 'Cloning repository');
  
  // Validate repo URL
  if (!isValidGitHubUrl(repoUrl)) {
    throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  }
  
  // Clone with depth 1 for speed
  const branchFlag = branch ? `-b ${branch}` : '';
  const command = `git clone --depth 1 ${branchFlag} ${repoUrl} ${targetDir}`;
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });
    
    logger.info({ stdout, stderr }, 'Clone completed');
  } catch (error: any) {
    if (error.message.includes('not found')) {
      throw new Error(`Repository not found: ${repoUrl}`);
    }
    if (error.message.includes('Permission denied')) {
      throw new Error(`Permission denied for ${repoUrl}`);
    }
    throw new Error(`Failed to clone repository: ${error.message}`);
  }
}

export async function checkoutBranch(
  repoDir: string,
  branch: string
): Promise<void> {
  logger.info({ repoDir, branch }, 'Checking out branch');
  
  try {
    await execAsync(`cd ${repoDir} && git checkout ${branch}`);
  } catch (error: any) {
    throw new Error(`Failed to checkout branch ${branch}: ${error.message}`);
  }
}

export async function getGitStatus(repoDir: string): Promise<string> {
  const { stdout } = await execAsync(`cd ${repoDir} && git status --porcelain`);
  return stdout;
}

export async function getGitDiff(repoDir: string): Promise<string> {
  const { stdout } = await execAsync(`cd ${repoDir} && git diff`);
  return stdout;
}

function isValidGitHubUrl(url: string): boolean {
  const pattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/;
  return pattern.test(url) || /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url);
}
```

### 4. GitHub CLI Authentication

**`apps/server/src/services/github/auth.ts`**:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../../middleware/logger.js';

const execAsync = promisify(exec);

export async function checkGitHubAuth(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('gh auth status');
    return stdout.includes('Logged in');
  } catch {
    return false;
  }
}

export async function setupGitHubAuth(token: string): Promise<void> {
  logger.info('Setting up GitHub CLI authentication');
  
  // Authenticate using token
  await execAsync(`echo "${token}" | gh auth login --with-token`);
  
  // Verify
  const isAuthed = await checkGitHubAuth();
  if (!isAuthed) {
    throw new Error('GitHub authentication failed');
  }
  
  // Configure git user (for commits)
  await execAsync('gh config set user.name "Codver Bot"');
  await execAsync('gh config set user.email "bot@codver.example.com"');
  
  logger.info('GitHub CLI authenticated successfully');
}

export async function getGitHubToken(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('gh auth token');
    return stdout.trim();
  } catch {
    return null;
  }
}
```

### 5. Language Detection

**`apps/server/src/services/language/detector.ts`**:
```typescript
import fs from 'fs';
import path from 'path';

export type Language = 'node' | 'python' | 'rust' | 'go' | 'java' | 'ruby' | 'php' | 'generic';

const LANGUAGE_MARKERS: Record<Language, string[]> = {
  node: ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
  python: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  go: ['go.mod', 'go.sum'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  ruby: ['Gemfile', 'Gemfile.lock', '.ruby-version'],
  php: ['composer.json', 'composer.lock'],
  generic: [],
};

export async function detectLanguage(projectDir: string): Promise<Language> {
  const files = fs.readdirSync(projectDir);
  
  // Check markers in priority order
  for (const [language, markers] of Object.entries(LANGUAGE_MARKERS) as [Language, string[]][]) {
    if (language === 'generic') continue;
    
    for (const marker of markers) {
      if (files.includes(marker)) {
        return language;
      }
    }
  }
  
  // Fallback: check file extensions
  const extensions = countExtensions(projectDir);
  const topExt = Object.entries(extensions).sort((a, b) => b[1] - a[1])[0];
  
  if (topExt) {
    const [ext, _] = topExt;
    return mapExtensionToLanguage(ext);
  }
  
  return 'generic';
}

function countExtensions(projectDir: string, maxDepth = 3): Record<string, number> {
  const counts: Record<string, number> = {};
  
  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          const ext = path.extname(entry.name).slice(1).toLowerCase();
          if (ext) {
            counts[ext] = (counts[ext] || 0) + 1;
          }
        }
      }
    } catch (error) {
      // Ignore directories we can't read
    }
  }
  
  walk(projectDir, 0);
  return counts;
}

function mapExtensionToLanguage(ext: string): Language {
  const map: Record<string, Language> = {
    js: 'node',
    jsx: 'node',
    ts: 'node',
    tsx: 'node',
    mjs: 'node',
    cjs: 'node',
    py: 'python',
    pyi: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
  };
  
  return map[ext] || 'generic';
}
```

### 6. Update Routes to Use Queue

**Update `apps/server/src/routes/jobs.ts`**:
```typescript
// Add this import at the top
import { jobQueue } from '../services/queue/index.js';

// In the POST /jobs handler, after creating the job:
jobQueue.add(jobId);

const response: JobResponse = {
  jobId,
  status: 'pending',
  createdAt: now,
};

res.status(201).json({
  success: true,
  data: response,
});
```

### 7. Database Migration for Language

**`apps/server/src/database/migrations/001-add-language.sql`**:
```sql
ALTER TABLE jobs ADD COLUMN language TEXT;
ALTER TABLE jobs ADD COLUMN detected_language TEXT;
```

**`apps/server/src/database/migrations.ts`**:
```typescript
import { getDatabase } from './connection.js';
import fs from 'fs';
import path from 'path';

const MIGRATIONS = [
  {
    version: 1,
    name: 'add-language',
    up: `ALTER TABLE jobs ADD COLUMN language TEXT;`,
  },
];

export function runMigrations(): void {
  const db = getDatabase();
  
  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  
  // Get applied migrations
  const applied = new Set(
    (db.prepare('SELECT version FROM migrations').all() as any[]).map(r => r.version)
  );
  
  // Apply pending migrations
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    
    console.log(`Applying migration ${migration.version}: ${migration.name}`);
    db.exec(migration.up);
    db.prepare(`
      INSERT INTO migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `).run(migration.version, migration.name, Date.now());
  }
}
```

## Testing

### Manual Testing

```bash
# 1. Setup GitHub CLI on server
# Follow: https://cli.github.com/manual/
gh auth login
# Follow interactive prompts

# 2. Verify auth
gh auth status
# Should show: Logged in to github.com as <username>

# 3. Start server
pnpm dev:server

# 4. Submit a test job
codver run --repo https://github.com/octocat/Hello-World --branch master --prompt "Add tests"

# 5. Watch server logs
# [Job-abc123] Cloning repository: https://github.com/octocat/Hello-World
# [Job-abc123] Repository cloned to /home/user/.codver-dev/abc123/
# [Job-abc123] Detecting project language...
# [Job-abc123] Detected language: generic
# [Job-abc123] Status: ready
# [Job-abc123] Job completed (Phase 4 - basic flow)

# 6. Check filesystem
ls ~/.codver-dev/abc123/
# Should see: README, LICENSE, etc.

# 7. Check job status
codver status --job-id abc123
# Should show: completed

# 8. Test with different repos
codver run --repo https://github.com/user/node-app --prompt "Add tests"
# Should detect: node

codver run --repo https://github.com/user/python-app --prompt "Add tests"
# Should detect: python

# 9. Test error handling
codver run --repo https://github.com/invalid/repo --prompt "test"
# Should fail gracefully with error message

# 10. Check logs
codver logs --job-id abc123
# Should show all job steps
```

### Automated Tests

**`apps/server/src/__tests__/clone.test.ts`**:
```typescript
import { describe, it, expect } from 'vitest';
import { cloneRepository } from '../services/github/clone.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('GitHub Clone', () => {
  it('should clone valid repository', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codver-test-'));
    
    try {
      await cloneRepository(
        'https://github.com/octocat/Hello-World',
        tmpDir,
        'master'
      );
      
      expect(fs.existsSync(path.join(tmpDir, 'README'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
  
  it('should fail on invalid repository', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codver-test-'));
    
    try {
      await expect(
        cloneRepository('https://github.com/invalid/nonexistent', tmpDir)
      ).rejects.toThrow('Repository not found');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});
```

**`apps/server/src/__tests__/language.test.ts`**:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectLanguage } from '../services/language/detector.js';

describe('Language Detection', () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-test-'));
  });
  
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });
  
  it('should detect Node.js', async () => {
    fs.writeFileSync(path.join(testDir, 'package.json'), '{}');
    const lang = await detectLanguage(testDir);
    expect(lang).toBe('node');
  });
  
  it('should detect Python', async () => {
    fs.writeFileSync(path.join(testDir, 'requirements.txt'), 'flask');
    const lang = await detectLanguage(testDir);
    expect(lang).toBe('python');
  });
  
  it('should detect Rust', async () => {
    fs.writeFileSync(path.join(testDir, 'Cargo.toml'), '[package]');
    const lang = await detectLanguage(testDir);
    expect(lang).toBe('rust');
  });
  
  it('should fallback to generic', async () => {
    fs.writeFileSync(path.join(testDir, 'random.txt'), 'hello');
    const lang = await detectLanguage(testDir);
    expect(lang).toBe('generic');
  });
});
```

## Validation Checklist

- [ ] Job queue processes jobs sequentially
- [ ] Concurrent job limit enforced
- [ ] Repository cloning works
- [ ] Branch checkout works
- [ ] Language detection works for all languages
- [ ] Job status updates correctly
- [ ] Logs are stored in database
- [ ] Error handling works for invalid repos
- [ ] Job directories are created in `~/.codver-dev/{jobId}/`
- [ ] Failed jobs are marked as `failed`
- [ ] GitHub CLI is authenticated on server
- [ ] All tests pass

## Next Phase

Proceed to [Phase 5: Language Detection & Docker Image Builder](./05-language-detection-docker.md)
