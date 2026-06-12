import simpleGit from 'simple-git';
import { logJobMessage } from '../queue/helpers';
import { config } from '../../config';

interface CloneOptions {
  repoUrl: string;
  branch?: string;
  targetDir: string;
  jobId: string;
}

export async function cloneRepository(options: CloneOptions): Promise<void> {
  const { repoUrl, branch, targetDir, jobId } = options;
  const git = simpleGit();

  logJobMessage(jobId, 'info', `Starting clone to ${targetDir}`);

  // Ensure parent directory exists
  const fs = await import('fs/promises');
  const path = await import('path');
  await fs.mkdir(path.dirname(targetDir), { recursive: true });

  // Clone the repository
  const cloneOptions: string[] = [];
  if (branch) {
    cloneOptions.push('--branch', branch);
    cloneOptions.push('--single-branch');
  }

  // Configure auth if GITHUB_TOKEN is present
  const authUrl = getAuthenticatedUrl(repoUrl);

  await git.clone(authUrl, targetDir, cloneOptions);

  logJobMessage(jobId, 'info', 'Clone completed successfully');

  // Configure git user if needed for future operations
  const repoGit = simpleGit(targetDir);
  const userName = config.GIT_USER_NAME || 'Codver Bot';
  const userEmail = config.GIT_USER_EMAIL || 'codver-bot@codver.dev';
  await repoGit.addConfig('user.name', userName);
  await repoGit.addConfig('user.email', userEmail);
}

function getAuthenticatedUrl(repoUrl: string): string {
  const token = config.GITHUB_TOKEN;
  if (!token) {
    return repoUrl;
  }

  try {
    const url = new URL(repoUrl);
    if (url.hostname === 'github.com') {
      url.username = token;
      url.password = 'x-oauth-basic';
      return url.toString();
    }
  } catch {
    // If URL parsing fails, return original
  }

  return repoUrl;
}

export async function cleanupJobDirectory(jobId: string): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const targetDir = path.join(config.CODVER_DEV_DIR, jobId);

  try {
    await fs.rm(targetDir, { recursive: true, force: true });
    logJobMessage(jobId, 'info', `Cleaned up directory: ${targetDir}`);
  } catch {
    // Directory might not exist, ignore errors
  }
}

export async function cleanupOldJobs(retentionDays: number): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  try {
    const entries = await fs.readdir(config.CODVER_DEV_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(config.CODVER_DEV_DIR, entry.name);
      const stat = await fs.stat(entryPath);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(entryPath, { recursive: true, force: true });
      }
    }
  } catch {
    // Directory might not exist yet
  }
}
