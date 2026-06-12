export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super(404, message, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string = 'Bad request') {
    super(400, message, 'BAD_REQUEST');
  }
}

export class ConflictError extends ApiError {
  constructor(message: string = 'Conflict') {
    super(409, message, 'CONFLICT');
  }
}

// ───────────────────────────────────────────────────────────────
// Job-specific errors (Phase 8: Error Handling & Failure PRs)
// ───────────────────────────────────────────────────────────────

export type JobErrorType =
  | 'clone'
  | 'docker_build'
  | 'container_startup'
  | 'agent'
  | 'timeout'
  | 'git'
  | 'pr'
  | 'unknown';

export class JobError extends Error {
  public errorType: JobErrorType;
  public details?: Record<string, unknown>;
  public originalError?: Error;

  constructor(
    errorType: JobErrorType,
    message: string,
    options?: { details?: Record<string, unknown>; originalError?: Error },
  ) {
    super(message);
    this.name = 'JobError';
    this.errorType = errorType;
    this.details = options?.details;
    this.originalError = options?.originalError;
  }
}

export class CloneError extends JobError {
  constructor(message: string, options?: { details?: Record<string, unknown>; originalError?: Error }) {
    super('clone', message, options);
    this.name = 'CloneError';
  }
}

export class DockerBuildError extends JobError {
  constructor(message: string, options?: { details?: Record<string, unknown>; originalError?: Error }) {
    super('docker_build', message, options);
    this.name = 'DockerBuildError';
  }
}

export class ContainerStartupError extends JobError {
  constructor(message: string, options?: { details?: Record<string, unknown>; originalError?: Error }) {
    super('container_startup', message, options);
    this.name = 'ContainerStartupError';
  }
}

export class AgentError extends JobError {
  constructor(message: string, options?: { details?: Record<string, unknown>; originalError?: Error }) {
    super('agent', message, options);
    this.name = 'AgentError';
  }
}

export class TimeoutError extends JobError {
  constructor(message: string, options?: { details?: Record<string, unknown>; originalError?: Error }) {
    super('timeout', message, options);
    this.name = 'TimeoutError';
  }
}

export class GitError extends JobError {
  constructor(message: string, options?: { details?: Record<string, unknown>; originalError?: Error }) {
    super('git', message, options);
    this.name = 'GitError';
  }
}

export class PrError extends JobError {
  constructor(message: string, options?: { details?: Record<string, unknown>; originalError?: Error }) {
    super('pr', message, options);
    this.name = 'PrError';
  }
}

export function classifyError(err: unknown): JobError {
  if (err instanceof JobError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('clone') || message.includes('repository not found') || message.includes('authentication failed')) {
    return new CloneError(message, { originalError: err instanceof Error ? err : undefined });
  }
  if (message.includes('docker build') || message.includes('Dockerfile')) {
    return new DockerBuildError(message, { originalError: err instanceof Error ? err : undefined });
  }
  if (message.includes('docker-compose') || message.includes('container') || message.includes(' exited with code')) {
    return new ContainerStartupError(message, { originalError: err instanceof Error ? err : undefined });
  }
  if (message.includes('timed out') || message.includes('timeout')) {
    return new TimeoutError(message, { originalError: err instanceof Error ? err : undefined });
  }
  if (message.includes('gh pr create') || message.includes('pull request')) {
    return new PrError(message, { originalError: err instanceof Error ? err : undefined });
  }
  if (message.includes('git ') || message.includes('commit') || message.includes('push') || message.includes('branch')) {
    return new GitError(message, { originalError: err instanceof Error ? err : undefined });
  }

  return new JobError('unknown', message, { originalError: err instanceof Error ? err : undefined });
}
