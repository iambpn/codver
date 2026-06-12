import { config } from '../../config';
import { logJobMessage } from './helpers';
import { processJob } from './processor';

interface QueuedJob {
  jobId: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

const queue: QueuedJob[] = [];
let runningCount = 0;

export async function enqueueJob(jobId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.push({ jobId, resolve, reject });
    logJobMessage(jobId, 'info', 'Job queued for processing');
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
  const { jobId, resolve, reject } = next;

  try {
    await processJob(jobId);
    resolve();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    reject(error);
  } finally {
    runningCount--;
    // Process next job in queue
    setImmediate(processQueue);
  }
}

export function getQueueStatus(): { queued: number; running: number; maxConcurrent: number } {
  return {
    queued: queue.length,
    running: runningCount,
    maxConcurrent: config.MAX_CONCURRENT_JOBS,
  };
}
