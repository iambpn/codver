# Phase 2: Server API Core

**Goal:** HTTPS server with API key authentication and SQLite database.

**Duration:** 2-3 days | **Complexity:** Medium

## Objectives

1. Setup HTTPS with self-signed certificates
2. Implement API key authentication
3. Setup SQLite database with schema
4. Create core API endpoints
5. Add error handling and logging

## Tasks

### 1. HTTPS Setup

Generate self-signed certificates for development:

```bash
# Create certs directory
mkdir -p apps/server/certs

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout apps/server/certs/key.pem \
  -out apps/server/certs/cert.pem -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=Codver/CN=localhost"
```

**`apps/server/src/config/index.ts`**:
```typescript
import dotenv from 'dotenv';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

dotenv.config();

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HTTPS_PORT: z.coerce.number().default(3443),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CERT_PATH: z.string().default('./certs/cert.pem'),
  KEY_PATH: z.string().default('./certs/key.pem'),
  DB_PATH: z.string().default('./data/codver.db'),
  WORK_DIR: z.string().default(path.join(process.env.HOME || '~', '.codver-dev')),
  MAX_CONCURRENT_JOBS: z.coerce.number().default(3),
  DEFAULT_TIMEOUT: z.coerce.number().default(1800), // 30 minutes
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000), // 1 minute
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  ADMIN_API_KEY: z.string().optional(),
});

export const config = ConfigSchema.parse(process.env);

// Verify certificates exist in production
if (config.NODE_ENV === 'production') {
  if (!fs.existsSync(config.CERT_PATH) || !fs.existsSync(config.KEY_PATH)) {
    throw new Error('SSL certificates not found');
  }
}
```

**`apps/server/src/index.ts`**:
```typescript
import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import { initializeDatabase } from './database/connection.js';
import { errorHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { healthRouter } from './routes/health.js';
import { jobsRouter } from './routes/jobs.js';
import { adminRouter } from './routes/admin.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(requestLogger);

// Rate limiting
app.use(rateLimiter);

// Routes
app.use('/', healthRouter);
app.use('/', jobsRouter);
app.use('/admin', adminRouter);

// Error handling (must be last)
app.use(errorHandler);

// Initialize database
initializeDatabase();

// Start server
if (config.NODE_ENV === 'production') {
  const httpsOptions = {
    cert: fs.readFileSync(config.CERT_PATH),
    key: fs.readFileSync(config.KEY_PATH),
  };
  
  https.createServer(httpsOptions, app).listen(config.HTTPS_PORT, () => {
    console.log(`HTTPS Server running on https://localhost:${config.HTTPS_PORT}`);
  });
} else {
  // Development: HTTP for simplicity
  http.createServer(app).listen(config.PORT, () => {
    console.log(`HTTP Server running on http://localhost:${config.PORT}`);
    console.log('Note: Use HTTPS in production');
  });
}
```

### 2. SQLite Database

**`apps/server/src/database/schema.sql`**:
```sql
-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  repo_url TEXT NOT NULL,
  branch TEXT,
  prompt TEXT NOT NULL,
  model TEXT,
  pr_url TEXT,
  error_message TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

-- Job logs
CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_timestamp ON job_logs(timestamp);

-- API keys
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Server configuration
CREATE TABLE IF NOT EXISTS server_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**`apps/server/src/database/connection.ts`**:
```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

let db: Database.Database;

export function initializeDatabase(): void {
  const dbDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  // Run schema
  const schema = fs.readFileSync(
    path.join(import.meta.dirname, 'schema.sql'),
    'utf-8'
  );
  db.exec(schema);
  
  console.log(`Database initialized at ${config.DB_PATH}`);
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
```

### 3. API Key Authentication

**`apps/server/src/middleware/auth.ts`**:
```typescript
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDatabase } from '../database/connection.js';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(name: string): string {
  const id = crypto.randomUUID();
  const key = `codv_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = hashApiKey(key);
  const createdAt = Date.now();
  
  const db = getDatabase();
  db.prepare(`
    INSERT INTO api_keys (id, key_hash, name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, keyHash, name, createdAt);
  
  return key;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header('X-API-Key');
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_API_KEY', message: 'X-API-Key header is required' },
    });
  }
  
  const keyHash = hashApiKey(apiKey);
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, name FROM api_keys WHERE key_hash = ?
  `).get(keyHash) as { id: string; name: string } | undefined;
  
  if (!row) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key' },
    });
  }
  
  // Update last used timestamp
  db.prepare(`
    UPDATE api_keys SET last_used_at = ? WHERE id = ?
  `).run(Date.now(), row.id);
  
  // Attach API key info to request
  (req as any).apiKey = {
    id: row.id,
    name: row.name,
  };
  
  next();
}

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header('X-API-Key');
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_API_KEY', message: 'X-API-Key header is required' },
    });
  }
  
  // Check against admin key from environment
  if (apiKey !== config.ADMIN_API_KEY) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
  }
  
  next();
}
```

### 4. Core Routes

**`apps/server/src/routes/health.ts`**:
```typescript
import { Router } from 'express';
import { getDatabase } from '../database/connection.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  try {
    // Check database connectivity
    const db = getDatabase();
    db.prepare('SELECT 1').get();
    
    res.json({
      status: 'healthy',
      version: '0.1.0',
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
    });
  }
});
```

**`apps/server/src/routes/jobs.ts`**:
```typescript
import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getDatabase } from '../database/connection.js';
import type { JobRequest, JobResponse, JobDetails, JobStatus } from '@codver/shared-types';

export const jobsRouter = Router();

const JobRequestSchema = z.object({
  repoUrl: z.string().url().regex(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/),
  branch: z.string().optional(),
  prompt: z.string().min(1).max(10000),
  promptFile: z.string().optional(),
  images: z.array(z.object({
    filename: z.string(),
    data: z.string(),
    mediaType: z.string(),
  })).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  additionalFiles: z.array(z.string()).optional(),
  webhookUrl: z.string().url().optional(),
  timeout: z.number().optional(),
  config: z.object({
    cpuLimit: z.string().optional(),
    memoryLimit: z.string().optional(),
    networkEnabled: z.boolean().optional(),
    prAuthor: z.enum(['bot', 'user']).optional(),
  }).optional(),
});

jobsRouter.post('/jobs', authMiddleware, (req, res) => {
  try {
    const validated = JobRequestSchema.parse(req.body);
    
    const jobId = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    
    const db = getDatabase();
    db.prepare(`
      INSERT INTO jobs (
        id, repo_url, branch, prompt, model, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      validated.repoUrl,
      validated.branch || null,
      validated.prompt,
      validated.model || null,
      'pending',
      now,
      now
    );
    
    const response: JobResponse = {
      jobId,
      status: 'pending',
      createdAt: now,
    };
    
    res.status(201).json({
      success: true,
      data: response,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: error.errors,
        },
      });
    }
    throw error;
  }
});

jobsRouter.get('/jobs/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const db = getDatabase();
  
  const job = db.prepare(`
    SELECT * FROM jobs WHERE id = ?
  `).get(id) as any;
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Job not found' },
    });
  }
  
  const details: JobDetails = {
    jobId: job.id,
    status: job.status as JobStatus,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
    repoUrl: job.repo_url,
    branch: job.branch,
    prompt: job.prompt,
    model: job.model,
    prUrl: job.pr_url,
    errorMessage: job.error_message,
    duration: job.completed_at ? job.completed_at - job.created_at : undefined,
  };
  
  res.json({
    success: true,
    data: details,
  });
});

jobsRouter.get('/jobs/:id/logs', authMiddleware, (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  
  const db = getDatabase();
  
  const logs = db.prepare(`
    SELECT timestamp, level, message
    FROM job_logs
    WHERE job_id = ?
    ORDER BY timestamp ASC
    LIMIT ? OFFSET ?
  `).all(id, limit, offset);
  
  res.json({
    success: true,
    data: {
      logs,
      count: logs.length,
    },
  });
});

jobsRouter.get('/jobs', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const status = req.query.status as string;
  
  const db = getDatabase();
  
  let query = `
    SELECT id, repo_url, branch, status, created_at, updated_at, completed_at, pr_url
    FROM jobs
  `;
  const params: any[] = [];
  
  if (status) {
    query += ` WHERE status = ?`;
    params.push(status);
  }
  
  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  
  const jobs = db.prepare(query).all(...params);
  
  res.json({
    success: true,
    data: { jobs },
  });
});
```

**`apps/server/src/routes/admin.ts`**:
```typescript
import { Router } from 'express';
import { adminAuthMiddleware, generateApiKey } from '../middleware/auth.js';

export const adminRouter = Router();

adminRouter.post('/api-keys', adminAuthMiddleware, (req, res) => {
  const { name } = req.body;
  
  if (!name || typeof name !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
    });
  }
  
  const key = generateApiKey(name);
  
  res.status(201).json({
    success: true,
    data: { key, name },
  });
});

adminRouter.post('/build-images', adminAuthMiddleware, (_req, res) => {
  // TODO: Implement in Phase 5
  res.json({
    success: true,
    data: { message: 'Image building not yet implemented' },
  });
});
```

### 5. Middleware

**`apps/server/src/middleware/logger.ts`**:
```typescript
import pino from 'pino';
import type { Request, Response, NextFunction } from 'express';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  
  next();
};

export { logger };
```

**`apps/server/src/middleware/rate-limit.ts`**:
```typescript
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
```

**`apps/server/src/middleware/error.ts`**:
```typescript
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }
  
  logger.error({ err }, 'Unhandled error');
  
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
    },
  });
}
```

## Testing

### Manual Testing

```bash
# 1. Generate self-signed certs
mkdir -p apps/server/certs
openssl req -x509 -newkey rsa:4096 -keyout apps/server/certs/key.pem \
  -out apps/server/certs/cert.pem -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=Codver/CN=localhost"

# 2. Set up environment
cat > apps/server/.env << EOF
NODE_ENV=development
PORT=3000
ADMIN_API_KEY=admin-secret-key-change-me
EOF

# 3. Generate an API key
curl -X POST http://localhost:3000/admin/api-keys \
  -H "X-API-Key: admin-secret-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"name":"dev-key"}'
# Save the returned key

# 4. Test health endpoint
curl http://localhost:3000/health
# Expected: {"status":"healthy","version":"0.1.0","timestamp":...}

# 5. Test auth (should fail without key)
curl http://localhost:3000/jobs
# Expected: 401 Unauthorized

# 6. Test auth (should succeed with key)
curl -H "X-API-Key: codv_..." http://localhost:3000/jobs
# Expected: {"success":true,"data":{"jobs":[]}}

# 7. Create a job
curl -X POST http://localhost:3000/jobs \
  -H "X-API-Key: codv_..." \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/test/repo",
    "branch": "main",
    "prompt": "Add tests"
  }'
# Expected: 201 Created with jobId

# 8. Get job status
curl -H "X-API-Key: codv_..." http://localhost:3000/jobs/{jobId}
# Expected: Job details

# 9. Get job logs
curl -H "X-API-Key: codv_..." http://localhost:3000/jobs/{jobId}/logs
# Expected: {"success":true,"data":{"logs":[],"count":0}}
```

### Automated Tests

**`apps/server/src/__tests__/api.test.ts`**:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { healthRouter } from '../routes/health.js';
import { jobsRouter } from '../routes/jobs.js';
import { initializeDatabase, closeDatabase } from '../database/connection.js';
import { generateApiKey } from '../middleware/auth.js';

describe('API Endpoints', () => {
  let app: express.Express;
  let apiKey: string;
  
  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    initializeDatabase();
    
    app = express();
    app.use(express.json());
    app.use('/', healthRouter);
    app.use('/', jobsRouter);
    
    apiKey = generateApiKey('test-key');
  });
  
  afterAll(() => {
    closeDatabase();
  });
  
  it('GET /health should return healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
  
  it('POST /jobs should require auth', async () => {
    const res = await request(app)
      .post('/jobs')
      .send({ repoUrl: 'https://github.com/test/repo', prompt: 'test' });
    expect(res.status).toBe(401);
  });
  
  it('POST /jobs should create job with valid auth', async () => {
    const res = await request(app)
      .post('/jobs')
      .set('X-API-Key', apiKey)
      .send({
        repoUrl: 'https://github.com/test/repo',
        branch: 'main',
        prompt: 'Add tests',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toBeDefined();
  });
  
  it('POST /jobs should validate request', async () => {
    const res = await request(app)
      .post('/jobs')
      .set('X-API-Key', apiKey)
      .send({ repoUrl: 'invalid' });
    expect(res.status).toBe(400);
  });
});
```

## Validation Checklist

- [ ] HTTPS certificates generated
- [ ] Database initializes successfully
- [ ] Health endpoint returns 200
- [ ] API key generation works
- [ ] Auth middleware validates keys
- [ ] Job creation validates input
- [ ] Job creation returns job ID
- [ ] Job status retrieval works
- [ ] Job logs retrieval works
- [ ] Rate limiting is active
- [ ] Error handling returns proper status codes
- [ ] Logs are structured and searchable
- [ ] All tests pass

## Next Phase

Proceed to [Phase 3: Client CLI](./03-client-cli.md)
