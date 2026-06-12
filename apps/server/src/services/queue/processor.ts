import { config } from '../../config';
import { db } from '../../database';
import { logJobMessage, updateJobStatus } from './helpers';
import { cloneRepository, cleanupJobDirectory } from '../github/clone';
import { detectLanguage } from '../language/detector';
import { copyTemplateFiles, generateDotEnv, getContainerName, getImageName } from '../docker/templates';
import { buildDockerImage } from '../docker/builder';
import { runContainer, stopContainer, removeContainer } from '../docker/runner';
import { extractGitDiff } from '../github/diff';
import { createPr } from '../github/pr';

export async function processJob(jobId: string): Promise<void> {
  logJobMessage(jobId, 'info', 'Starting job processing');

  const targetDir = `${config.CODVER_DEV_DIR}/${jobId}`;

  try {
    // Step 1: Fetch job details
    const job = db.prepare('SELECT id, repo_url, branch, prompt, model FROM jobs WHERE id = ?').get(jobId) as
      | { id: string; repo_url: string; branch: string | null; prompt: string; model: string | null }
      | undefined;

    if (!job) {
      throw new Error(`Job ${jobId} not found in database`);
    }

    // Step 2: Update status to cloning
    updateJobStatus(jobId, 'cloning');
    logJobMessage(jobId, 'info', `Cloning repository: ${job.repo_url}`);

    // Step 3: Clone repository
    await cloneRepository({
      repoUrl: job.repo_url,
      branch: job.branch || undefined,
      targetDir,
      jobId,
    });

    logJobMessage(jobId, 'info', `Cloned to ${targetDir}`);
    if (job.branch) {
      logJobMessage(jobId, 'info', `Checked out branch: ${job.branch}`);
    }

    // Step 4: Detect language
    updateJobStatus(jobId, 'detecting_language');
    logJobMessage(jobId, 'info', 'Detecting language...');
    const language = await detectLanguage(targetDir);
    logJobMessage(jobId, 'info', `Detected: ${language}`);
    db.prepare('UPDATE jobs SET language = ? WHERE id = ?').run(language, jobId);

    // Step 5: Generate Docker files
    updateJobStatus(jobId, 'generating_docker');
    logJobMessage(jobId, 'info', 'Generating Docker files...');
    await copyTemplateFiles(language, targetDir);

    const imageName = getImageName(language, jobId);
    const containerName = getContainerName(jobId);

    await generateDotEnv(targetDir, {
      imageName,
      containerName,
      projectDir: targetDir,
      piPrompt: job.prompt,
      piModel: job.model,
      cpuLimit: config.DEFAULT_CPU_LIMIT,
      memoryLimit: config.DEFAULT_MEMORY_LIMIT,
      apiKeys: config.apiKeys,
    });

    logJobMessage(jobId, 'info', 'Docker files generated');

    // Step 6: Build Docker image
    updateJobStatus(jobId, 'building_image');
    logJobMessage(jobId, 'info', `Building Docker image: ${imageName}`);
    const builtImage = await buildDockerImage(jobId, language, targetDir);
    db.prepare('UPDATE jobs SET docker_image = ? WHERE id = ?').run(builtImage, jobId);

    // Step 7: Update status to ready
    updateJobStatus(jobId, 'ready');
    logJobMessage(jobId, 'info', 'Job is ready for next phase (Pi agent execution)');

    // Step 8: Run container
    updateJobStatus(jobId, 'running');
    db.prepare('UPDATE jobs SET started_at = ? WHERE id = ?').run(Date.now(), jobId);
    logJobMessage(jobId, 'info', `Starting container: ${containerName}`);

    const runResult = await runContainer({
      jobId,
      projectDir: targetDir,
      imageName: builtImage,
      containerName,
      timeoutMs: config.DEFAULT_JOB_TIMEOUT_MS,
    });

    if (!runResult.success) {
      throw new Error(runResult.error || `Container exited with code ${runResult.exitCode}`);
    }

    logJobMessage(jobId, 'info', `Container completed successfully`);
    logJobMessage(jobId, 'info', `Modified files: ${runResult.modifiedFiles.join(', ') || 'none'}`);

    // Step 9: Extract git diff and create PR
    updateJobStatus(jobId, 'creating_pr');
    const diffResult = await extractGitDiff(targetDir, jobId);

    if (diffResult.hasChanges) {
      logJobMessage(jobId, 'info', 'Generating PR metadata...');
      const prResult = await createPr(jobId, targetDir, job.prompt, diffResult.modifiedFiles);

      const completedAt = Date.now();
      db.prepare(
        'UPDATE jobs SET completed_at = ?, pr_url = ?, pr_branch = ?, pr_title = ?, pr_description = ?, pr_author = ? WHERE id = ?',
      ).run(
        completedAt,
        prResult.prUrl,
        prResult.branchName,
        prResult.title,
        prResult.description,
        config.DEFAULT_PR_AUTHOR,
        jobId,
      );

      updateJobStatus(jobId, 'completed', { prUrl: prResult.prUrl });
      logJobMessage(jobId, 'info', `PR created: ${prResult.prUrl}`);
    } else {
      logJobMessage(jobId, 'warn', 'No changes detected, skipping PR creation');
      const completedAt = Date.now();
      db.prepare('UPDATE jobs SET completed_at = ? WHERE id = ?').run(completedAt, jobId);
      updateJobStatus(jobId, 'completed');
    }

    logJobMessage(jobId, 'info', 'Job completed');

    // Step 10: Cleanup
    await cleanupResources(jobId, targetDir, builtImage);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logJobMessage(jobId, 'error', `Job processing failed: ${errorMessage}`);
    updateJobStatus(jobId, 'failed', { errorMessage });
    // Cleanup on failure
    await cleanupResources(jobId, targetDir, undefined).catch((cleanupErr: unknown) => {
      logJobMessage(jobId, 'warn', `Cleanup failed: ${String(cleanupErr)}`);
    });
    throw err;
  }
}

async function cleanupResources(jobId: string, targetDir: string, imageName?: string): Promise<void> {
  logJobMessage(jobId, 'info', 'Cleaning up resources...');

  // Stop and remove container
  await stopContainer(targetDir).catch((err) => {
    logJobMessage(jobId, 'warn', `Container stop failed: ${String(err)}`);
  });

  await removeContainer(targetDir).catch((err) => {
    logJobMessage(jobId, 'warn', `Container remove failed: ${String(err)}`);
  });

  // Remove job directory if configured
  if (config.CLEANUP_ON_COMPLETE) {
    await cleanupJobDirectory(jobId).catch((err) => {
      logJobMessage(jobId, 'warn', `Directory cleanup failed: ${String(err)}`);
    });
  }

  // Remove Docker image if configured
  if (config.CLEANUP_IMAGES_ON_COMPLETE && imageName) {
    const { spawn } = await import('child_process');
    const proc = spawn('docker', ['rmi', '-f', imageName], { stdio: 'ignore' });
    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
    logJobMessage(jobId, 'info', `Removed image: ${imageName}`);
  }

  logJobMessage(jobId, 'info', 'Cleanup completed');
}
