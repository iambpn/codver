import { db } from '../database';
import { PiEvent } from './docker/runner';

export interface ErrorContext {
  jobId: string;
  repoUrl: string;
  prompt: string;
  model?: string | null;
  errorType: string;
  errorMessage: string;
  originalError?: Error;
  containerLogs?: string[];
  piEvents?: PiEvent[];
  modifiedFiles?: string[];
  stackTrace?: string;
  stage: string;
}

export interface CompiledErrorReport {
  summary: string;
  errorType: string;
  errorMessage: string;
  stage: string;
  containerLogs: string;
  serverLogs: string;
  piEvents: string;
  modifiedFiles: string;
  stackTrace: string;
  suggestions: string[];
}

export function collectErrorContext(
  jobId: string,
  error: Error,
  stage: string,
  containerResult?: {
    logs?: string[];
    piEvents?: PiEvent[];
    modifiedFiles?: string[];
  },
): ErrorContext {
  const job = db.prepare('SELECT repo_url, prompt, model FROM jobs WHERE id = ?').get(jobId) as
    | { repo_url: string; prompt: string; model: string | null }
    | undefined;

  return {
    jobId,
    repoUrl: job?.repo_url || 'unknown',
    prompt: job?.prompt || 'unknown',
    model: job?.model,
    errorType: error.name || 'UnknownError',
    errorMessage: error.message,
    originalError: error,
    containerLogs: containerResult?.logs,
    piEvents: containerResult?.piEvents,
    modifiedFiles: containerResult?.modifiedFiles,
    stackTrace: error.stack || '',
    stage,
  };
}

export function compileErrorReport(context: ErrorContext): CompiledErrorReport {
  const suggestions = generateSuggestions(context);

  // Collect server logs from database
  const serverLogs = db
    .prepare('SELECT timestamp, level, message FROM job_logs WHERE job_id = ? ORDER BY timestamp ASC')
    .all(context.jobId) as { timestamp: number; level: string; message: string }[];

  const serverLogsText = serverLogs
    .map((log) => `[${new Date(log.timestamp).toISOString()}] ${log.level.toUpperCase()}: ${log.message}`)
    .join('\n');

  const containerLogsText = (context.containerLogs || []).join('\n');

  const piEventsText = (context.piEvents || [])
    .map((ev) => `[${new Date(ev.timestamp).toISOString()}] ${ev.level}: ${ev.message}`)
    .join('\n');

  const modifiedFilesText = (context.modifiedFiles || []).join('\n') || 'None';

  const summary = `${context.errorType}: ${context.errorMessage}`;

  return {
    summary,
    errorType: context.errorType,
    errorMessage: context.errorMessage,
    stage: context.stage,
    containerLogs: containerLogsText,
    serverLogs: serverLogsText,
    piEvents: piEventsText,
    modifiedFiles: modifiedFilesText,
    stackTrace: context.stackTrace || 'No stack trace available',
    suggestions,
  };
}

function generateSuggestions(context: ErrorContext): string[] {
  const suggestions: string[] = [];
  const msg = context.errorMessage.toLowerCase();

  switch (context.errorType) {
    case 'CloneError':
      suggestions.push('Verify the repository URL is correct and accessible.');
      suggestions.push('Check that the repository is not private or that the GitHub token has access.');
      suggestions.push('Ensure the branch name exists in the repository.');
      break;
    case 'DockerBuildError':
      suggestions.push('Check the Dockerfile for syntax errors or missing base images.');
      suggestions.push('Verify Docker daemon is running and has sufficient resources.');
      suggestions.push('Try pre-building images with the admin endpoint: POST /admin/build-images');
      break;
    case 'ContainerStartupError':
      suggestions.push('Verify Docker Compose is installed and configured correctly.');
      suggestions.push('Check if the container port or resource limits are conflicting.');
      suggestions.push('Review container logs for startup errors.');
      break;
    case 'TimeoutError':
      suggestions.push('The job exceeded the timeout limit. Consider increasing the timeout for large repositories.');
      suggestions.push('Check if the Pi agent is stuck in a loop or waiting for input.');
      break;
    case 'AgentError':
      suggestions.push('Check the Pi agent SDK installation and version compatibility.');
      suggestions.push('Verify API keys are valid and have sufficient quota.');
      suggestions.push('Review the container logs for specific agent errors.');
      break;
    case 'GitError':
      suggestions.push('Ensure the git user is configured correctly.');
      suggestions.push('Check for merge conflicts or branch protection rules.');
      suggestions.push('Verify the GitHub token has write access to the repository.');
      break;
    case 'PrError':
      suggestions.push('Verify the GitHub CLI (`gh`) is installed and authenticated.');
      suggestions.push('Check that the token has permissions to create pull requests.');
      suggestions.push('Ensure the branch was successfully pushed before creating the PR.');
      break;
    default:
      suggestions.push('Review the error logs and container output for clues.');
      suggestions.push('Try running the job again with the same parameters.');
      suggestions.push('If the issue persists, check server configuration and Docker status.');
  }

  if (msg.includes('permission denied')) {
    suggestions.push('Permission denied: Verify file system permissions and Docker user configuration.');
  }
  if (msg.includes('network') || msg.includes('connection') || msg.includes('timeout')) {
    suggestions.push('Network issue detected: Verify internet connectivity and DNS resolution.');
  }
  if (msg.includes('not found') || msg.includes('does not exist')) {
    suggestions.push('Missing resource: Verify all required files and dependencies are present.');
  }
  if (msg.includes('rate limit') || msg.includes('rate_limit')) {
    suggestions.push('Rate limit hit: Wait before retrying or upgrade the API plan.');
  }

  return suggestions;
}
