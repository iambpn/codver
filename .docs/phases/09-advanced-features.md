# Phase 9: Advanced Features

**Goal:** Rich prompt support, monitoring, and caching.

**Duration:** 3-4 days | **Complexity:** Medium

## Objectives

1. Support prompt files and images
2. Add custom model selection
3. Implement webhooks
4. Add job log streaming
5. Enhance monitoring and analytics

## Tasks

### 1. Prompt File Support

**Update Client `apps/client/src/commands/run.ts`** to handle prompt files:

```typescript
// Already implemented in Phase 3
// Verify it works with:
codver run --repo ... --prompt-file ./feature.md
```

### 2. Image Support in Server

**Update `apps/server/src/services/queue/processor.ts`** to handle images:

```typescript
// In the env setup:
const images = job.images ? JSON.parse(job.images) : [];
const env: Record<string, string> = {
  // ... other env vars
  PI_IMAGES: JSON.stringify(images),
};
```

**Update `apps/server/src/templates/docker/node/executor.js`** to handle images:

```javascript
// Already handles images via PI_IMAGES env var
// Images are passed to session.prompt() as ImageContent
```

**Update validation in `apps/server/src/routes/jobs.ts`**:

```typescript
const JobRequestSchema = z.object({
  // ... existing fields
  images: z.array(z.object({
    filename: z.string(),
    data: z.string(), // base64
    mediaType: z.string().regex(/^image\/(png|jpeg|jpg|gif|webp)$/),
  })).max(10).optional(), // Max 10 images
});
```

### 3. Custom Model Selection

**Update `apps/server/src/templates/docker/node/executor.js`**:

```javascript
// Already supports custom models via PI_MODEL env var
// Can be: "claude-sonnet-4", "openai/gpt-4o", etc.
```

**Update Server `apps/server/src/services/queue/processor.ts`**:

```typescript
const env: Record<string, string> = {
  PI_PROMPT: job.prompt,
  PI_MODEL: job.model || config.DEFAULT_MODEL || 'claude-sonnet-4',
  PI_PROVIDER: job.provider || 'anthropic',
  PI_THINKING_LEVEL: job.thinkingLevel || 'medium',
  // ... other env
};
```

### 4. Webhook Implementation

**`apps/server/src/services/webhook/index.ts`**:
```typescript
import crypto from 'crypto';
import { logger } from '../../middleware/logger.js';
import type { JobDetails } from '@codver/shared-types';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function sendWebhook(
  url: string,
  job: JobDetails
): Promise<void> {
  try {
    const payload = {
      event: job.status === 'completed' ? 'job.completed' : 'job.failed',
      job,
      timestamp: Date.now(),
    };
    
    const body = JSON.stringify(payload);
    
    // Sign webhook
    const signature = WEBHOOK_SECRET
      ? crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
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
      logger.warn({ url, status: response.status }, 'Webhook returned non-200');
    } else {
      logger.info({ url, jobId: job.jobId }, 'Webhook delivered');
    }
  } catch (error: any) {
    logger.error({ url, error: error.message }, 'Webhook delivery failed');
  }
}
```

**Update `apps/server/src/services/queue/processor.ts`** to send webhooks:

```typescript
// After job completion or failure:
if (job.webhookUrl) {
  const jobDetails = await getJobDetails(jobId);
  await sendWebhook(job.webhookUrl, jobDetails);
}
```

### 5. Job Log Streaming (SSE)

**Update `apps/server/src/routes/jobs.ts`**:

```typescript
jobsRouter.get('/jobs/:id/logs/stream', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  let lastTimestamp = 0;
  let isClosed = false;
  
  const sendEvent = (event: string, data: any) => {
    if (isClosed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  
  const interval = setInterval(async () => {
    try {
      const db = getDatabase();
      const logs = db.prepare(`
        SELECT timestamp, level, message
        FROM job_logs
        WHERE job_id = ? AND timestamp > ?
        ORDER BY timestamp ASC
        LIMIT 50
      `).all(id, lastTimestamp) as any[];
      
      for (const log of logs) {
        sendEvent('log', log);
        lastTimestamp = log.timestamp;
      }
      
      const job = db.prepare(`
        SELECT status, pr_url, error_message FROM jobs WHERE id = ?
      `).get(id) as any;
      
      if (job && ['completed', 'failed'].includes(job.status)) {
        sendEvent('done', {
          status: job.status,
          prUrl: job.pr_url,
          error: job.error_message,
        });
        clearInterval(interval);
        res.end();
      }
    } catch (error: any) {
      sendEvent('error', { message: error.message });
      clearInterval(interval);
      res.end();
    }
  }, 1000);
  
  req.on('close', () => {
    isClosed = true;
    clearInterval(interval);
  });
});
```

**Update Client `apps/client/src/commands/logs.ts`** to use SSE:

```typescript
async function streamLogs(api: ApiClient, jobId: string): Promise<void> {
  console.log(chalk.blue(`Streaming logs for ${jobId}... (Ctrl+C to stop)\n`));
  
  const apiUrl = `${api.getBaseURL()}/jobs/${jobId}/logs/stream`;
  const apiKey = api.getApiKey();
  
  const response = await fetch(apiUrl, {
    headers: { 'X-API-Key': apiKey! },
  });
  
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = decoder.decode(value);
    const lines = text.split('\n');
    
    let event = 'message';
    let data = '';
    
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        event = line.slice(7);
      } else if (line.startsWith('data: ')) {
        data = line.slice(6);
        if (data) {
          try {
            const parsed = JSON.parse(data);
            
            if (event === 'log') {
              const time = new Date(parsed.timestamp).toLocaleTimeString();
              const level = parsed.level.toUpperCase().padEnd(5);
              console.log(`[${chalk.gray(time)}] ${getLogLevelColor(parsed.level)(level)} ${parsed.message}`);
            } else if (event === 'done') {
              console.log(chalk.green(`\n✅ Job ${parsed.status}`));
              if (parsed.prUrl) {
                console.log(chalk.cyan(`PR: ${parsed.prUrl}`));
              }
              if (parsed.error) {
                console.log(chalk.red(`Error: ${parsed.error}`));
              }
              return;
            } else if (event === 'error') {
              console.log(chalk.red(`\n❌ Error: ${parsed.message}`));
              return;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  }
}
```

### 6. Job Statistics

**`apps/server/src/routes/jobs.ts`** (add stats endpoint):

```typescript
jobsRouter.get('/stats', authMiddleware, (_req, res) => {
  const db = getDatabase();
  
  const stats = {
    total: (db.prepare('SELECT COUNT(*) as count FROM jobs').get() as any).count,
    byStatus: db.prepare(`
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `).all(),
    avgDuration: (db.prepare(`
      SELECT AVG(completed_at - created_at) as avg
      FROM jobs
      WHERE completed_at IS NOT NULL
    `).get() as any).avg,
    successRate: (() => {
      const total = (db.prepare('SELECT COUNT(*) as count FROM jobs WHERE completed_at IS NOT NULL').get() as any).count;
      const completed = (db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'`).get() as any).count;
      return total > 0 ? (completed / total) * 100 : 0;
    })(),
  };
  
  res.json({ success: true, data: stats });
});
```

### 7. Additional Resource Files

**Update `apps/server/src/services/queue/processor.ts`** to copy additional files:

```typescript
// After language detection, before Docker build:
if (job.additionalFiles) {
  const files = JSON.parse(job.additionalFiles);
  for (const file of files) {
    // Files are already in the work directory
    logToJob(jobId, 'info', `Including additional file: ${file}`);
  }
}
```

## Testing

### Manual Testing

```bash
# 1. Test prompt file
echo "Add comprehensive tests with Jest" > /tmp/prompt.md
codver run --repo ... --prompt-file /tmp/prompt.md

# 2. Test images
codver run --repo ... --prompt "Add this UI" --images ./mockup.png ./screenshot.jpg

# 3. Test custom model
codver run --repo ... --model openai/gpt-4o --prompt "Add tests"

# 4. Test thinking level
codver run --repo ... --thinking high --prompt "Complex refactoring"

# 5. Test webhook
# Start a simple webhook receiver:
node -e "require('http').createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { console.log(body); res.end(); }); }).listen(3001)"

codver run --repo ... --webhook http://localhost:3001
# Should see webhook POST in receiver

# 6. Test log streaming
codver logs --job-id <id> --follow
# Should stream in real-time

# 7. Test stats
curl -H "X-API-Key: ..." http://localhost:3000/stats
# Should return job statistics

# 8. Test multiple images
codver run --repo ... --images img1.png img2.jpg img3.webp --prompt "Analyze these"

# 9. Test large prompt file
dd if=/dev/zero bs=1M count=5 of=/tmp/large.md
codver run --repo ... --prompt-file /tmp/large.md
# Should handle large files

# 10. Test all features together
codver run \
  --repo https://github.com/user/repo \
  --branch main \
  --prompt-file ./feature.md \
  --images ./mockup.png \
  --model claude-sonnet-4 \
  --thinking high \
  --timeout 60 \
  --webhook https://my-app.com/webhook \
  --files ./config.json
```

## Validation Checklist

- [ ] Prompt files work with various formats
- [ ] Images are passed to agent correctly
- [ ] Custom models work (Anthropic, OpenAI, etc.)
- [ ] Thinking levels work
- [ ] Webhooks are sent on completion/failure
- [ ] Webhook signatures are valid
- [ ] Log streaming works in real-time
- [ ] Statistics endpoint returns accurate data
- [ ] Additional files are included in container
- [ ] All tests pass

## Next Phase

Proceed to [Phase 10: Security & Production](./10-security-production.md)
