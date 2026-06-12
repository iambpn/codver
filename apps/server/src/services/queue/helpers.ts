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
  updates?: { prUrl?: string; errorMessage?: string },
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

    values.push(jobId);
    db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error(`[Job-${jobId}] Failed to update status:`, err);
  }
}
