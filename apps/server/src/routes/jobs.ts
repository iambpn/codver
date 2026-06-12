import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../database';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { enqueueJob } from '../services/queue';
import crypto from 'crypto';

const router: Router = Router();

const ImageSchema = z.object({
  filename: z.string(),
  data: z.string(),
  mediaType: z.string().regex(/^image\/(png|jpeg|jpg|gif|webp)$/),
});

const JobRequestSchema = z.object({
  repoUrl: z.string().min(1, 'repoUrl is required'),
  branch: z.string().optional(),
  prompt: z.string().min(1, 'prompt is required'),
  model: z.string().optional(),
  provider: z.string().optional(),
  thinkingLevel: z.string().optional(),
  images: z.array(ImageSchema).max(10).optional(),
  additionalFiles: z.array(z.string()).optional(),
  webhookUrl: z.string().url().optional(),
  timeoutMs: z.number().int().min(60000).max(3600000 * 4).optional(),
  memoryLimit: z.string().optional(),
  cpuLimit: z.string().optional(),
  networkAccess: z.string().optional(),
  envVars: z.record(z.string()).optional(),
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = JobRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new BadRequestError(`Invalid request: ${issues}`);
    }

    const data = parseResult.data;

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const now = Date.now();

    db.prepare(
      `INSERT INTO jobs (
        id, repo_url, branch, prompt, model, provider, thinking_level,
        images, additional_files, webhook_url, timeout_ms, memory_limit,
        cpu_limit, network_access, env_vars, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      data.repoUrl,
      data.branch || null,
      data.prompt,
      data.model || null,
      data.provider || null,
      data.thinkingLevel || null,
      data.images ? JSON.stringify(data.images) : null,
      data.additionalFiles ? JSON.stringify(data.additionalFiles) : null,
      data.webhookUrl || null,
      data.timeoutMs || null,
      data.memoryLimit || null,
      data.cpuLimit || null,
      data.networkAccess || null,
      data.envVars ? JSON.stringify(data.envVars) : null,
      'pending',
      now,
      now,
    );

    // Enqueue the job for background processing
    enqueueJob(id).catch((err) => {
      console.error(`[Job-${id}] Enqueue/Processing failed:`, err);
    });

    res.status(201).json({
      success: true,
      data: { jobId: id, status: 'pending' },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = db
      .prepare(
        `SELECT id, repo_url, branch, prompt, model, status, language, docker_image,
          pr_url, pr_branch, pr_title, pr_description, pr_author,
          error_message, error_type, retry_count, error_pr_url,
          started_at, completed_at, created_at, updated_at
        FROM jobs ORDER BY created_at DESC`,
      )
      .all();
    res.status(200).json({ success: true, data: jobs });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const total = (db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number }).count;

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `).all() as { status: string; count: number }[];

    const avgResult = db.prepare(`
      SELECT AVG(completed_at - created_at) as avg
      FROM jobs
      WHERE completed_at IS NOT NULL
    `).get() as { avg: number | null };

    const totalCompleted = (db.prepare(`
      SELECT COUNT(*) as count FROM jobs WHERE completed_at IS NOT NULL
    `).get() as { count: number }).count;

    const completedCount = (db.prepare(`
      SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'
    `).get() as { count: number }).count;

    const successRate = totalCompleted > 0 ? (completedCount / totalCompleted) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        total,
        byStatus,
        avgDuration: avgResult.avg,
        successRate,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = db
      .prepare(
        `SELECT id, repo_url, branch, prompt, model, provider, thinking_level,
          status, language, docker_image,
          pr_url, pr_branch, pr_title, pr_description, pr_author,
          error_message, error_type, retry_count, error_pr_url,
          started_at, completed_at, created_at, updated_at
        FROM jobs WHERE id = ?`,
      )
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!job) {
      throw new NotFoundError('Job not found');
    }

    res.status(200).json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/logs', (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id) as { id: string } | undefined;
    if (!job) {
      throw new NotFoundError('Job not found');
    }

    const logs = db
      .prepare('SELECT id, timestamp, level, message FROM job_logs WHERE job_id = ? ORDER BY timestamp ASC')
      .all(req.params.id);

    res.status(200).json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/logs/stream', (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = db.prepare('SELECT id, status FROM jobs WHERE id = ?').get(req.params.id) as
      | { id: string; status: string }
      | undefined;
    if (!job) {
      throw new NotFoundError('Job not found');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send all existing logs immediately
    const logs = db
      .prepare('SELECT id, timestamp, level, message FROM job_logs WHERE job_id = ? ORDER BY timestamp ASC')
      .all(req.params.id) as { id: number; timestamp: number; level: string; message: string }[];

    for (const log of logs) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }

    // If job is still active, poll for new logs
    const runningStatuses = ['pending', 'cloning', 'detecting_language', 'generating_docker', 'building_image', 'ready', 'running', 'creating_pr'];
    if (runningStatuses.includes(job.status)) {
      let lastId = logs.length > 0 ? logs[logs.length - 1].id : 0;
      const interval = setInterval(() => {
        const newLogs = db
          .prepare('SELECT id, timestamp, level, message FROM job_logs WHERE job_id = ? AND id > ? ORDER BY timestamp ASC')
          .all(req.params.id, lastId) as { id: number; timestamp: number; level: string; message: string }[];

        for (const log of newLogs) {
          res.write(`data: ${JSON.stringify(log)}\n\n`);
          lastId = log.id;
        }

        // Check if job is still running
        const current = db.prepare('SELECT status FROM jobs WHERE id = ?').get(req.params.id) as { status: string } | undefined;
        if (!current || !runningStatuses.includes(current.status)) {
          clearInterval(interval);
          res.write('event: done\ndata: {}\n\n');
          res.end();
        }
      }, 2000);

      req.on('close', () => {
        clearInterval(interval);
      });
    } else {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  } catch (err) {
    next(err);
  }
});

export { router as jobsRouter };
