import { config } from '../../config';
import { logJobMessage, updateJobStatus, incrementRetryCount, getRetryCount } from './helpers';
import { processJob } from './processor';
import { JobError } from '../../utils/errors';

interface QueuedJob {
  jobId: string;
  resolve: () => void;
  reject: (err: Error) => void;
  isRetry?: boolean;
}

const queue: QueuedJob[] = [];
let runningCount = 0;

export async function enqueueJob(jobId: string, isRetry = false): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.push({ jobId, resolve, reject, isRetry });
    if (isRetry) {
      logJobMessage(jobId, 'info', 'Job re-queued for retry');
    } else {
      logJobMessage(jobId, 'info', 'Job queued for processing');
    }
    processQueue();
  });
}

async function processQueue(): Promise<void> {
  if (runningCount >= config.MAX_CONCURRENT_JOBS) {
    return;
  }

  const next = queue.shift();
  if (!next) {
    return;
  }

  runningCount++;
  const { jobId, resolve, reject, isRetry } = next;

  try {
    await processJob(jobId);
    resolve();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const retryCount = getRetryCount(jobId);

    // Retry logic: only retry if we haven't exceeded max retries and it's not a permanent error
    const shouldRetry =
      !isRetry &&
      retryCount < config.MAX_RETRY_COUNT &&
      !isNonRetryableError(error);

    if (shouldRetry) {
      const newRetryCount = incrementRetryCount(jobId);
      const delayMs = config.RETRY_BASE_DELAY_MS * Math.pow(2, newRetryCount - 1);

      logJobMessage(jobId, 'warn', `Job failed, scheduling retry ${newRetryCount}/${config.MAX_RETRY_COUNT} in ${delayMs}ms`);
      logJobMessage(jobId, 'warn', `Error: ${error.message}`);
      updateJobStatus(jobId, 'pending', { errorMessage: `Retry ${newRetryCount}/${config.MAX_RETRY_COUNT} scheduled: ${error.message}` });

      setTimeout(() => {
        enqueueJob(jobId, true).catch((retryErr) => {
          console.error(`[Job-${jobId}] Retry enqueue failed:`, retryErr);
        });
      }, delayMs);

      // Resolve the original promise since retry is handled
      resolve();
    } else {
      if (isRetry) {
        logJobMessage(jobId, 'error', `Retry failed, no more retries. Final error: ${error.message}`);
      } else if (retryCount >= config.MAX_RETRY_COUNT) {
        logJobMessage(jobId, 'error', `Max retries (${config.MAX_RETRY_COUNT}) exceeded. Final error: ${error.message}`);
      }
      reject(error);
    }
  } finally {
    runningCount--;
    // Process next job in queue
    setImmediate(processQueue);
  }
}

function isNonRetryableError(error: Error): boolean {
  // Permanent errors that should not be retried
  if (error instanceof JobError) {
    const permanentTypes = ['clone', 'docker_build', 'pr'];
    if (permanentTypes.includes(error.errorType)) {
      return true;
    }
  }

  const permanentMessages = [
    'repository not found',
    'authentication failed',
    'bad credentials',
    'permission denied',
    'unauthorized',
    'invalid token',
    'not found',
  ];

  const msg = error.message.toLowerCase();
  return permanentMessages.some((pm) => msg.includes(pm));
}

export function getQueueStatus(): { queued: number; running: number; maxConcurrent: number } {
  return {
    queued: queue.length,
    running: runningCount,
    maxConcurrent: config.MAX_CONCURRENT_JOBS,
  };
}
