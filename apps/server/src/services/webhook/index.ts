import crypto from 'crypto';
import { config } from '../../config';
import { logJobMessage } from '../queue/helpers';

export interface WebhookPayload {
  event: 'job.completed' | 'job.failed';
  jobId: string;
  status: string;
  prUrl?: string;
  error?: string;
  duration?: number;
  timestamp: number;
}

export async function sendWebhook(
  url: string,
  jobId: string,
  job: {
    status: string;
    prUrl?: string;
    error?: string;
    completedAt?: number;
    startedAt?: number;
    created_at: number;
  },
): Promise<void> {
  try {
    const duration = job.completedAt && job.startedAt ? job.completedAt - job.startedAt : undefined;

    const payload: WebhookPayload = {
      event: job.status === 'completed' ? 'job.completed' : 'job.failed',
      jobId,
      status: job.status,
      prUrl: job.prUrl,
      error: job.error,
      duration,
      timestamp: Date.now(),
    };

    const body = JSON.stringify(payload);

    const signature = config.WEBHOOK_SECRET
      ? crypto.createHmac('sha256', config.WEBHOOK_SECRET).update(body).digest('hex')
      : '';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Codver-Webhook/1.0',
        ...(signature && { 'X-Codver-Signature': signature }),
      },
      body,
    });

    if (!response.ok) {
      logJobMessage(jobId, 'warn', `Webhook returned non-200: ${response.status}`);
    } else {
      logJobMessage(jobId, 'info', `Webhook delivered to ${url}`);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logJobMessage(jobId, 'warn', `Webhook delivery failed: ${errMsg}`);
  }
}
