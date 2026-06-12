import express from 'express';
import cors from 'cors';
import { config } from './config';
import { initSchema } from './database';
import { runMigrations } from './database/migrations';
import { requestLogger } from './middleware/requestLogger';
import { apiRateLimiter } from './middleware/rateLimiter';
import { authenticateApiKey, authenticateAdmin } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { apiKeysRouter } from './routes/apiKeys';
import { jobsRouter } from './routes/jobs';
import { getQueueStatus } from './services/queue';
import { cleanupOldJobs } from './services/github/clone';
import { buildLatestImage, SUPPORTED_LANGUAGES } from './services/docker/builder';

const app = express();

// Trust proxy when behind nginx (1 proxy hop)
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(apiRateLimiter);

// Health endpoint requires auth
app.use('/health', authenticateApiKey, healthRouter);

// Admin routes
app.use('/api-keys', authenticateAdmin, apiKeysRouter);

// Authenticated routes
app.use('/jobs', authenticateApiKey, jobsRouter);

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

// Initialize database
initSchema();
runMigrations();

// Cleanup old job directories on startup
cleanupOldJobs(config.JOB_RETENTION_DAYS).catch((err) => {
  console.error('Failed to cleanup old jobs:', err);
});

app.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT}`);
});
