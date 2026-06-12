import simpleGit from 'simple-git';
import { logJobMessage } from '../queue/helpers';

const EXCLUDED_FILES = ['Dockerfile', 'docker-compose.yml', 'executor.js', '.env', '.codver-pi-logs.jsonl'];

export interface DiffResult {
  modifiedFiles: string[];
  hasChanges: boolean;
  diff: string;
}

export async function extractGitDiff(projectDir: string, jobId: string): Promise<DiffResult> {
  const git = simpleGit(projectDir);

  // Check status first
  const status = await git.status();
  const allModified = [
    ...status.modified,
    ...status.not_added,
    ...status.created,
    ...status.renamed.map((r) => r.to),
    ...status.deleted,
  ];

  const modifiedFiles = allModified.filter((file) => {
    const fileName = file.split('/').pop() || file;
    return !EXCLUDED_FILES.includes(fileName);
  });

  const hasChanges = modifiedFiles.length > 0;

  logJobMessage(jobId, 'info', `Extracting changes...`);
  logJobMessage(jobId, 'info', `Modified files: ${modifiedFiles.join(', ') || 'none'}`);

  if (!hasChanges) {
    return { modifiedFiles: [], hasChanges: false, diff: '' };
  }

  // Get the diff
  const diff = await git.diff(['--', ...modifiedFiles]);

  return { modifiedFiles, hasChanges, diff };
}

export async function getGitStatus(projectDir: string): Promise<{ modified: string[]; untracked: string[] }> {
  const git = simpleGit(projectDir);
  const status = await git.status();
  const modified = status.modified;
  const untracked = status.not_added;
  return { modified, untracked };
}

export function filterCodverFiles(files: string[]): string[] {
  return files.filter((file) => {
    const fileName = file.split('/').pop() || file;
    return !EXCLUDED_FILES.includes(fileName);
  });
}
