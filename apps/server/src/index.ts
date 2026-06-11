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

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
});

app.use(errorHandler);

// Initialize database
initSchema();
runMigrations();

app.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT}`);
});
