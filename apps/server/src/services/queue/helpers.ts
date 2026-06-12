import { db } from '../../database';

export function logJobMessage(jobId: string, level: 'info' | 'error' | 'warn' | 'debug', message: string): void {
  try {
    const timestamp = Date.now();
    db.prepare('INSERT INTO job_logs (job_id, timestamp, level, message) VALUES (?, ?, ?, ?)').run(
      jobId,
      timestamp,
      level,
      message,
    );
  } catch (err) {
    console.error(`[Job-${jobId}] Failed to log message:`, err);
  }
}

export function updateJobStatus(
  jobId: string,
  status: string,
  updates?: { prUrl?: string; errorMessage?: string; errorType?: string; retryCount?: number; errorPrUrl?: string },
): void {
  try {
    const now = Date.now();
    const fields: string[] = ['status = ?, updated_at = ?'];
    const values: (string | number | null)[] = [status, now];

    if (updates?.prUrl !== undefined) {
      fields.push('pr_url = ?');
      values.push(updates.prUrl || null);
    }
    if (updates?.errorMessage !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.errorMessage || null);
    }
    if (updates?.errorType !== undefined) {
      fields.push('error_type = ?');
      values.push(updates.errorType || null);
    }
    if (updates?.retryCount !== undefined) {
      fields.push('retry_count = ?');
      values.push(updates.retryCount);
    }
    if (updates?.errorPrUrl !== undefined) {
      fields.push('error_pr_url = ?');
      values.push(updates.errorPrUrl || null);
    }

    values.push(jobId);
    db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error(`[Job-${jobId}] Failed to update status:`, err);
  }
}

export function incrementRetryCount(jobId: string): number {
  try {
    db.prepare('UPDATE jobs SET retry_count = retry_count + 1 WHERE id = ?').run(jobId);
    const job = db.prepare('SELECT retry_count FROM jobs WHERE id = ?').get(jobId) as { retry_count: number } | undefined;
    return job?.retry_count || 0;
  } catch (err) {
    console.error(`[Job-${jobId}] Failed to increment retry count:`, err);
    return 0;
  }
}

export function getRetryCount(jobId: string): number {
  try {
    const job = db.prepare('SELECT retry_count FROM jobs WHERE id = ?').get(jobId) as { retry_count: number } | undefined;
    return job?.retry_count || 0;
  } catch (err) {
    console.error(`[Job-${jobId}] Failed to get retry count:`, err);
    return 0;
  }
}
