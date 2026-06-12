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
import { classifyError } from '../../utils/errors';
import { collectErrorContext, compileErrorReport } from '../errorCollector';
import { createErrorPr } from '../github/error-pr';
import { sendWebhook } from '../webhook';

interface JobRow {
  id: string;
  repo_url: string;
  branch: string | null;
  prompt: string;
  model: string | null;
  provider: string | null;
  thinking_level: string | null;
  images: string | null;
  additional_files: string | null;
  webhook_url: string | null;
  timeout_ms: number | null;
  memory_limit: string | null;
  cpu_limit: string | null;
  network_access: string | null;
  env_vars: string | null;
}

export async function processJob(jobId: string): Promise<void> {
  logJobMessage(jobId, 'info', 'Starting job processing');

  const targetDir = `${config.CODVER_DEV_DIR}/${jobId}`;
  let builtImage: string | undefined;
  let containerResult: { logs?: string[]; piEvents?: { timestamp: number; level: string; message: string }[]; modifiedFiles?: string[] } | undefined;
  let stage = 'init';

  try {
    // Step 1: Fetch job details
    const job = db.prepare(
      `SELECT id, repo_url, branch, prompt, model, provider, thinking_level,
        images, additional_files, webhook_url, timeout_ms, memory_limit,
        cpu_limit, network_access, env_vars
      FROM jobs WHERE id = ?`,
    ).get(jobId) as JobRow | undefined;

    if (!job) {
      throw new Error(`Job ${jobId} not found in database`);
    }

    const jobTimeoutMs = job.timeout_ms || config.DEFAULT_JOB_TIMEOUT_MS;
    const jobMemoryLimit = job.memory_limit || config.DEFAULT_MEMORY_LIMIT;
    const jobCpuLimit = job.cpu_limit || config.DEFAULT_CPU_LIMIT;
    const jobModel = job.model || config.DEFAULT_MODEL;
    const jobProvider = job.provider || config.DEFAULT_PROVIDER;
    const jobThinkingLevel = job.thinking_level || config.DEFAULT_THINKING_LEVEL;

    // Step 2: Update status to cloning
    stage = 'cloning';
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
    stage = 'detecting_language';
    updateJobStatus(jobId, 'detecting_language');
    logJobMessage(jobId, 'info', 'Detecting language...');
    const language = await detectLanguage(targetDir);
    logJobMessage(jobId, 'info', `Detected: ${language}`);
    db.prepare('UPDATE jobs SET language = ? WHERE id = ?').run(language, jobId);

    // Step 5: Generate Docker files
    stage = 'generating_docker';
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
      piModel: jobModel || undefined,
      piProvider: jobProvider || undefined,
      piThinkingLevel: jobThinkingLevel || undefined,
      piImages: job.images || undefined,
      cpuLimit: jobCpuLimit,
      memoryLimit: jobMemoryLimit,
      networkAccess: job.network_access || undefined,
      envVars: job.env_vars || undefined,
      apiKeys: config.apiKeys,
    });

    logJobMessage(jobId, 'info', 'Docker files generated');

    // Step 6: Build Docker image
    stage = 'building_image';
    updateJobStatus(jobId, 'building_image');
    logJobMessage(jobId, 'info', `Building Docker image: ${imageName}`);
    builtImage = await buildDockerImage(jobId, language, targetDir);
    db.prepare('UPDATE jobs SET docker_image = ? WHERE id = ?').run(builtImage, jobId);

    // Step 7: Update status to ready
    updateJobStatus(jobId, 'ready');
    logJobMessage(jobId, 'info', 'Job is ready for next phase (Pi agent execution)');

    // Step 8: Run container
    stage = 'running';
    updateJobStatus(jobId, 'running');
    db.prepare('UPDATE jobs SET started_at = ? WHERE id = ?').run(Date.now(), jobId);
    logJobMessage(jobId, 'info', `Starting container: ${containerName}`);

    const runResult = await runContainer({
      jobId,
      projectDir: targetDir,
      imageName: builtImage,
      containerName,
      timeoutMs: jobTimeoutMs,
    });

    containerResult = {
      logs: runResult.logs,
      piEvents: runResult.piEvents,
      modifiedFiles: runResult.modifiedFiles,
    };

    if (!runResult.success) {
      throw new Error(runResult.error || `Container exited with code ${runResult.exitCode}`);
    }

    logJobMessage(jobId, 'info', `Container completed successfully`);
    logJobMessage(jobId, 'info', `Modified files: ${runResult.modifiedFiles.join(', ') || 'none'}`);

    // Step 9: Extract git diff and create PR
    stage = 'creating_pr';
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

    // Step 10: Send webhook if configured
    if (job.webhook_url) {
      logJobMessage(jobId, 'info', `Sending webhook to ${job.webhook_url}`);
      const jobRow = db.prepare(
        'SELECT status, pr_url, error_message, started_at, completed_at, created_at FROM jobs WHERE id = ?',
      ).get(jobId) as { status: string; pr_url: string | null; error_message: string | null; started_at: number | null; completed_at: number | null; created_at: number };
      await sendWebhook(job.webhook_url, jobId, {
        status: jobRow.status,
        prUrl: jobRow.pr_url || undefined,
        error: jobRow.error_message || undefined,
        startedAt: jobRow.started_at || undefined,
        completedAt: jobRow.completed_at || undefined,
        created_at: jobRow.created_at,
      });
    }

    // Step 11: Cleanup
    await cleanupResources(jobId, targetDir, builtImage);
  } catch (err) {
    const classifiedError = classifyError(err);
    const errorMessage = classifiedError.message;
    const errorType = classifiedError.errorType;

    logJobMessage(jobId, 'error', `Job processing failed at stage '${stage}': ${errorMessage}`);
    logJobMessage(jobId, 'error', `Error type: ${errorType}`);

    // Collect error context and compile report
    const errorContext = collectErrorContext(jobId, classifiedError, stage, containerResult);
    const errorReport = compileErrorReport(errorContext);

    // Store error details in database
    db.prepare('UPDATE jobs SET error_type = ? WHERE id = ?').run(errorType, jobId);

    updateJobStatus(jobId, 'failed', { errorMessage });

    // Attempt to create an error PR (only if repo was cloned)
    if (stage !== 'cloning') {
      try {
        logJobMessage(jobId, 'info', 'Generating error report PR...');
        const partialFiles = containerResult?.modifiedFiles || [];
        const errorPrResult = await createErrorPr(jobId, targetDir, errorReport, partialFiles);

        if (errorPrResult) {
          db.prepare('UPDATE jobs SET error_pr_url = ? WHERE id = ?').run(errorPrResult.prUrl, jobId);
          updateJobStatus(jobId, 'failed', { errorMessage, errorPrUrl: errorPrResult.prUrl });
          logJobMessage(jobId, 'info', `Error PR created: ${errorPrResult.prUrl}`);
        } else {
          logJobMessage(jobId, 'warn', 'Could not create error PR (repo may not be accessible)');
        }
      } catch (prErr) {
        const prErrMsg = prErr instanceof Error ? prErr.message : String(prErr);
        logJobMessage(jobId, 'warn', `Error PR creation failed: ${prErrMsg}`);
      }
    }

    // Send webhook on failure if configured
    const failedJob = db.prepare('SELECT webhook_url FROM jobs WHERE id = ?').get(jobId) as { webhook_url: string | null } | undefined;
    if (failedJob?.webhook_url) {
      const jobRow = db.prepare(
        'SELECT status, pr_url, error_message, error_pr_url, started_at, completed_at, created_at FROM jobs WHERE id = ?',
      ).get(jobId) as { status: string; pr_url: string | null; error_message: string | null; error_pr_url: string | null; started_at: number | null; completed_at: number | null; created_at: number };
      await sendWebhook(failedJob.webhook_url, jobId, {
        status: jobRow.status,
        prUrl: jobRow.error_pr_url || jobRow.pr_url || undefined,
        error: jobRow.error_message || undefined,
        startedAt: jobRow.started_at || undefined,
        completedAt: jobRow.completed_at || undefined,
        created_at: jobRow.created_at,
      });
    }

    // Cleanup on failure (always)
    await cleanupResources(jobId, targetDir, builtImage).catch((cleanupErr: unknown) => {
      logJobMessage(jobId, 'warn', `Cleanup failed: ${String(cleanupErr)}`);
    });

    throw classifiedError;
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
