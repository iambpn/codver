import express from 'express';
import cors from 'cors';
import { config } from './config';
import { db, initSchema } from './database';
import { runMigrations } from './database/migrations';
import { requestLogger } from './middleware/requestLogger';
import { apiRateLimiter } from './middleware/rateLimiter';
import { authenticateApiKey, authenticateAdmin } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { auditLog } from './middleware/audit';
import { apiKeysRouter } from './routes/apiKeys';
import { jobsRouter } from './routes/jobs';
import { metricsRouter } from './routes/metrics';
import { getQueueStatus } from './services/queue';
import { cleanupOldJobs } from './services/github/clone';
import { buildLatestImage, SUPPORTED_LANGUAGES } from './services/docker/builder';

const app = express();

app.set('trust proxy', 1);

const corsOrigins = config.CORS_ORIGINS ? config.CORS_ORIGINS.split(',').map((o) => o.trim()) : [];
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(apiRateLimiter);
app.use(auditLog('request'));

// Health endpoint (no auth required for load balancers)
app.get('/health', (_req, res) => {
  const queueStatus = getQueueStatus();
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      version: '0.1.0',
      uptime: process.uptime(),
      queue: queueStatus,
    },
  });
});

// Metrics endpoint (no auth for Prometheus scraping)
app.use('/', metricsRouter);

// Admin routes
app.use('/api-keys', authenticateAdmin, apiKeysRouter);

// Authenticated routes
app.use('/jobs', authenticateApiKey, jobsRouter);

// Stats endpoint (authenticated)
app.get('/stats', authenticateApiKey, (_req, res, next) => {
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

// Queue status endpoint (admin)
app.get('/admin/queue', authenticateAdmin, (_req, res) => {
  res.status(200).json({ success: true, data: getQueueStatus() });
});

// Pre-build all language images (admin)
app.post('/admin/build-images', authenticateAdmin, async (_req, res, next) => {
  try {
    const results: { language: string; image: string; status: string; error?: string }[] = [];

    for (const language of SUPPORTED_LANGUAGES) {
      try {
        const image = await buildLatestImage(language);
        results.push({ language, image, status: 'built' });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        results.push({ language, image: `codver-pi-${language}:latest`, status: 'failed', error: errorMessage });
      }
    }

    const allSucceeded = results.every((r) => r.status === 'built');
    res.status(allSucceeded ? 200 : 207).json({
      success: allSucceeded,
      data: results,
    });
  } catch (err) {
    next(err);
  }
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
});

app.use(errorHandler);

initSchema();
runMigrations();

cleanupOldJobs(config.JOB_RETENTION_DAYS).catch((err) => {
  console.error('Failed to cleanup old jobs:', err);
});

app.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT}`);
});
