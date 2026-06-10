# Phase 10: Security & Production

**Goal:** Hardened sandboxing and production deployment.

**Duration:** 3-4 days | **Complexity:** Medium

## Objectives

1. Harden Docker security
2. Implement input validation
3. Setup audit logging
4. Create production deployment guide
5. Add monitoring and observability

## Tasks

### 1. Enhanced Docker Security

**Update all Docker templates** with enhanced security:

**`apps/server/src/templates/docker/node/Dockerfile`** (hardened):
```dockerfile
FROM node:24-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install Pi SDK
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
    && npm cache clean --force

# Create non-root user with specific UID
RUN groupadd -g 1000 codver \
    && useradd -u 1000 -g 1000 -m -s /bin/bash -d /home/codver codver

# Setup workspace
WORKDIR /workspace

# Copy executor with proper ownership
COPY --chown=codver:codver executor.js /executor.js
RUN chmod 755 /executor.js

# Switch to non-root user
USER codver:codver

# Set security-related environment
ENV NODE_OPTIONS="--max-old-space-size=3072"
ENV NPM_CONFIG_LOGLEVEL=warn

ENTRYPOINT ["node", "/executor.js"]
```

**`apps/server/src/templates/docker/node/docker-compose.yml`** (hardened):
```yaml
version: '3.8'

services:
  pi-agent:
    build: .
    volumes:
      - ./:/workspace:rw
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - PI_PROMPT=${PI_PROMPT}
      - PI_MODEL=${PI_MODEL}
      - PI_PROVIDER=${PI_PROVIDER}
      - PI_THINKING_LEVEL=${PI_THINKING_LEVEL}
      - PI_LOG_FILE=/workspace/.codver-logs.jsonl
      - PI_IMAGES=${PI_IMAGES}
    working_dir: /workspace
    user: "1000:1000"
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=1g
      - /root/.pi:rw,noexec,nosuid,nodev,size=100m
    security_opt:
      - no-new-privileges:true
      - seccomp:default
      - apparmor:docker-default
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - SETGID
      - SETUID
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
          pids: 100
    restart: "no"
    network_mode: bridge
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "test", "-f", "/tmp/healthy"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 2. Input Validation

**`apps/server/src/middleware/validation.ts`**:
```typescript
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export function validateRequest(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.errors,
        },
      });
    }
  };
}

const FORBIDDEN_PATTERNS = [
  /\.\.\//,  // Path traversal
  /\$\(/,     // Command substitution
  /`/,        // Backticks
  /;/,        // Command chaining
  /\|/,       // Pipe
  /&/,        // Background
  /\brm\b/,   // Dangerous commands
  /\beval\b/,
  /\bexec\b/,
];

export function sanitizeString(input: string): string {
  let sanitized = input;
  
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(sanitized)) {
      throw new Error(`Input contains forbidden pattern: ${pattern}`);
    }
  }
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  return sanitized;
}

export function validateRepoUrl(url: string): boolean {
  const pattern = /^https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\.git)?$/;
  return pattern.test(url);
}
```

### 3. Audit Logging

**`apps/server/src/middleware/audit.ts`**:
```typescript
import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../database/connection.js';
import { logger } from './logger.js';

export function auditLog(eventType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const apiKey = (req as any).apiKey;
      
      const logEntry = {
        timestamp: Date.now(),
        event_type: eventType,
        api_key_id: apiKey?.id,
        api_key_name: apiKey?.name,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
        user_agent: req.get('user-agent'),
      };
      
      // Log to file
      logger.info(logEntry, 'Audit log');
      
      // Store in database
      try {
        const db = getDatabase();
        db.prepare(`
          INSERT INTO audit_logs (
            timestamp, event_type, api_key_id, method, path, status, duration, ip, user_agent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          logEntry.timestamp,
          logEntry.event_type,
          logEntry.api_key_id,
          logEntry.method,
          logEntry.path,
          logEntry.status,
          logEntry.duration,
          logEntry.ip,
          logEntry.user_agent
        );
      } catch (error) {
        logger.error({ error }, 'Failed to store audit log');
      }
    });
    
    next();
  };
}
```

**Add to schema**:
```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  api_key_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_api_key ON audit_logs(api_key_id);
```

### 4. Production Deployment

**`apps/server/Dockerfile`** (production):
```dockerfile
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/server/package.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm --filter @codver/shared-types build
RUN pnpm --filter @codver/server build

# Production stage
FROM node:24-bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gh \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy built application
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/server/package.json ./
COPY --from=builder /app/apps/server/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types/dist ./node_modules/@codver/shared-types

# Create data directory
RUN mkdir -p /app/data /app/certs

# Run as non-root
RUN useradd -m -u 1000 codver && chown -R codver:codver /app
USER codver

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

**`docker-compose.yml`** (production):
```yaml
version: '3.8'

services:
  server:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./certs:/app/certs
      - codver-work:/home/codver/.codver-dev
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HTTPS_PORT=3443
      - DB_PATH=/app/data/codver.db
      - WORK_DIR=/home/codver/.codver-dev
      - ADMIN_API_KEY=${ADMIN_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - WEBHOOK_SECRET=${WEBHOOK_SECRET}
    env_file:
      - .env.production
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    healthcheck:
      test: ["CMD", "curl", "-f", "-k", "https://localhost:3443/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G

  reverse-proxy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - server

volumes:
  codver-work:
  caddy-data:
  caddy-config:
```

**`Caddyfile`** (reverse proxy):
```
codver.example.com {
    reverse_proxy server:3000 {
        transport http {
            tls_insecure_skip_verify
        }
    }
    
    encode gzip
    
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "default-src 'self'"
    }
    
    log {
        output file /data/access.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
```

### 5. Monitoring

**`apps/server/src/routes/metrics.ts`**:
```typescript
import { Router } from 'express';
import { getDatabase } from '../database/connection.js';

export const metricsRouter = Router();

metricsRouter.get('/metrics', async (_req, res) => {
  const db = getDatabase();
  
  const metrics = {
    jobs: {
      total: (db.prepare('SELECT COUNT(*) as c FROM jobs').get() as any).c,
      pending: (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'`).get() as any).c,
      running: (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status IN ('cloning', 'building', 'running', 'extracting')`).get() as any).c,
      completed: (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'completed'`).get() as any).c,
      failed: (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'`).get() as any).c,
    },
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
    },
  };
  
  // Format as Prometheus metrics
  let prometheus = '';
  for (const [key, value] of Object.entries(metrics.jobs)) {
    prometheus += `codver_jobs_${key} ${value}\n`;
  }
  prometheus += `codver_uptime_seconds ${metrics.system.uptime}\n`;
  prometheus += `codver_memory_rss_bytes ${metrics.system.memory.rss}\n`;
  
  res.set('Content-Type', 'text/plain');
  res.send(prometheus);
});
```

### 6. Security Checklist

**Documentation** in `.docs/security-checklist.md`:

```markdown
# Security Checklist

## Authentication
- [ ] API keys are hashed before storage
- [ ] API keys are never logged
- [ ] Rate limiting is active
- [ ] Admin endpoints are protected
- [ ] GitHub token is stored securely

## Docker Security
- [ ] Containers run as non-root user
- [ ] Root filesystem is read-only
- [ ] Resource limits are enforced (CPU, memory, PIDs)
- [ ] Capabilities are dropped
- [ ] seccomp profile is applied
- [ ] AppArmor profile is applied
- [ ] No privileged mode
- [ ] Network is isolated

## Input Validation
- [ ] All inputs are validated with Zod
- [ ] Path traversal is prevented
- [ ] Command injection is prevented
- [ ] File uploads are validated
- [ ] URLs are validated

## Secrets Management
- [ ] API keys are in environment variables
- [ ] Secrets are not in code
- [ ] Secrets are not logged
- [ ] Secrets are rotated regularly

## Network Security
- [ ] HTTPS is enforced
- [ ] TLS 1.2+ is required
- [ ] Strong cipher suites
- [ ] Security headers are set
- [ ] CORS is configured

## Monitoring
- [ ] Audit logging is enabled
- [ ] Failed auth attempts are logged
- [ ] Resource usage is monitored
- [ ] Errors are tracked
- [ ] Metrics are exported

## Backup & Recovery
- [ ] Database is backed up daily
- [ ] Backups are encrypted
- [ ] Recovery procedure is documented
- [ ] Backups are tested
```

## Testing

### Manual Security Testing

```bash
# 1. Verify non-root execution
docker run --rm codver-pi-node:latest whoami
# Should output: codver

# 2. Verify resource limits
docker run --rm --cpus=1 --memory=2g codver-pi-node:latest
# Should be limited to 1 CPU and 2GB memory

# 3. Verify capability drops
docker run --rm --cap-drop ALL codver-pi-node:latest
# Should work with minimal capabilities

# 4. Verify read-only filesystem
docker run --rm --read-only codver-pi-node:latest touch /test
# Should fail: read-only filesystem

# 5. Test input validation
curl -X POST .../jobs -d '{"repoUrl":"../../../etc/passwd","prompt":"test"}'
# Should reject with validation error

# 6. Test rate limiting
for i in {1..200}; do curl ...; done
# Should hit rate limit

# 7. Verify audit logs
sqlite3 codver.db "SELECT * FROM audit_logs LIMIT 10"
# Should show all requests

# 8. Test HTTPS
curl -k https://localhost:3443/health
# Should work with self-signed cert

# 9. Production deployment
docker-compose -f docker-compose.yml up -d
# Should start all services
```

## Validation Checklist

- [ ] Docker security hardened
- [ ] Input validation implemented
- [ ] Audit logging active
- [ ] Production deployment works
- [ ] Reverse proxy configured
- [ ] HTTPS enforced
- [ ] Monitoring works
- [ ] Security headers set
- [ ] Backups configured
- [ ] All tests pass

## Completion

All 10 phases complete! The system is now production-ready with:
- Secure sandboxing
- Comprehensive error handling
- Scalable architecture
- Production deployment
- Monitoring and observability
- Complete documentation
