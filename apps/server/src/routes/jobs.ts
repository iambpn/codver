import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../database';
import { BadRequestError, NotFoundError } from '../utils/errors';
import crypto from 'crypto';

const router: Router = Router();

router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { repoUrl, branch, prompt, model } = req.body || {};

    if (!repoUrl || typeof repoUrl !== 'string') {
      throw new BadRequestError('repoUrl is required');
    }
    if (!prompt || typeof prompt !== 'string') {
      throw new BadRequestError('prompt is required');
    }

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const now = Date.now();

    db.prepare(
      'INSERT INTO jobs (id, repo_url, branch, prompt, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, repoUrl, branch || null, prompt, model || null, 'pending', now, now);

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
      .prepare('SELECT id, repo_url, branch, prompt, model, status, pr_url, created_at, updated_at FROM jobs ORDER BY created_at DESC')
      .all();
    res.status(200).json({ success: true, data: jobs });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = db
      .prepare(
        'SELECT id, repo_url, branch, prompt, model, status, pr_url, error_message, created_at, updated_at FROM jobs WHERE id = ?',
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

export { router as jobsRouter };
