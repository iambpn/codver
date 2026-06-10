# Phase 5: Language Detection & Docker Image Builder

**Goal:** Detect project language, generate Docker setup, and build images.

**Duration:** 4-5 days | **Complexity:** High

## Objectives

1. Create Docker templates for each language
2. Implement template engine
3. Build Docker image builder service
4. Support image caching
5. Add admin endpoint for pre-building

## Tasks

### 1. Docker Templates Structure

Create template files for each language:

```
apps/server/src/templates/docker/
├── node/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── executor.js
├── python/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── executor.js
├── rust/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── executor.js
├── go/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── executor.js
└── generic/
    ├── Dockerfile
    ├── docker-compose.yml
    └── executor.js
```

### 2. Node.js Template

**`apps/server/src/templates/docker/node/Dockerfile`**:
```dockerfile
FROM node:24-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Pi SDK globally
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash codver

# Setup workspace
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js
RUN chmod +x /executor.js && chown codver:codver /executor.js

# Switch to non-root user
USER codver

ENTRYPOINT ["node", "/executor.js"]
```

**`apps/server/src/templates/docker/node/docker-compose.yml`**:
```yaml
version: '3.8'

services:
  pi-agent:
    build: .
    volumes:
      - ./:/workspace
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
    read_only: false
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
    restart: "no"
    network_mode: bridge
```

**`apps/server/src/templates/docker/node/executor.js`**:
```javascript
const fs = require('fs');
const path = require('path');
const {
  createAgentSession,
  runPrintMode,
  SessionManager,
  getModel,
  AuthStorage,
  ModelRegistry
} = require('@earendil-works/pi-coding-agent');

async function main() {
  const prompt = process.env.PI_PROMPT || '';
  const modelId = process.env.PI_MODEL || 'claude-sonnet-4';
  const provider = process.env.PI_PROVIDER || 'anthropic';
  const thinkingLevel = process.env.PI_THINKING_LEVEL || 'medium';
  const logFile = process.env.PI_LOG_FILE || '/workspace/.codver-logs.jsonl';
  const imagesJson = process.env.PI_IMAGES || '[]';
  
  if (!prompt) {
    throw new Error('PI_PROMPT environment variable is required');
  }
  
  // Parse images
  const images = JSON.parse(imagesJson);
  const imageContent = images.map((img) => ({
    type: 'image',
    source: {
      type: 'base64',
      mediaType: img.mediaType,
      data: img.data,
    },
  }));
  
  // Get model
  let model;
  if (modelId.includes('/')) {
    const [prov, id] = modelId.split('/');
    model = getModel(prov, id);
  } else {
    model = getModel(provider, modelId);
  }
  
  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }
  
  console.log(`Starting Pi agent with model: ${model.provider}/${model.id}`);
  console.log(`Thinking level: ${thinkingLevel}`);
  
  // Setup auth and model registry
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  
  // Create agent session
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    model,
    thinkingLevel,
    authStorage,
    modelRegistry,
    tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
    sessionManager: SessionManager.inMemory(),
  });
  
  // Subscribe to events and log to file
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  
  session.subscribe((event) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: event.type,
      ...event,
    };
    logStream.write(JSON.stringify(logEntry) + '\n');
    
    // Also log key events to stdout
    if (event.type === 'agent_start') {
      console.log('Agent started');
    } else if (event.type === 'agent_end') {
      console.log('Agent completed');
    } else if (event.type === 'tool_execution_start') {
      console.log(`Tool: ${event.toolName}`);
    }
  });
  
  // Run the prompt
  await session.prompt(prompt, {
    images: imageContent.length > 0 ? imageContent : undefined,
  });
  
  logStream.end();
  console.log('Executor completed successfully');
  process.exit(0);
}

main().catch((err) => {
  console.error('Executor failed:', err);
  process.exit(1);
});
```

### 3. Python Template

**`apps/server/src/templates/docker/python/Dockerfile`**:
```dockerfile
FROM python:3.13-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Pi SDK (requires Node.js)
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash codver

# Setup workspace
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js
RUN chmod +x /executor.js && chown codver:codver /executor.js

# Switch to non-root user
USER codver

ENTRYPOINT ["node", "/executor.js"]
```

**`apps/server/src/templates/docker/python/docker-compose.yml`**:
```yaml
version: '3.8'

services:
  pi-agent:
    build: .
    volumes:
      - ./:/workspace
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
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
    restart: "no"
```

**`apps/server/src/templates/docker/python/executor.js`**:
```javascript
// Same as Node.js executor
// (Copy from node/executor.js)
```

### 4. Rust Template

**`apps/server/src/templates/docker/rust/Dockerfile`**:
```dockerfile
FROM rust:1.83-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates \
    curl \
    nodejs \
    npm \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Pi SDK
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash codver

# Setup workspace
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js
RUN chmod +x /executor.js && chown codver:codver /executor.js

# Switch to non-root user
USER codver

ENTRYPOINT ["node", "/executor.js"]
```

### 5. Go Template

**`apps/server/src/templates/docker/go/Dockerfile`**:
```dockerfile
FROM golang:1.23-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    bash \
    ca-certificates \
    nodejs \
    npm \
    ripgrep

# Install GitHub CLI
RUN apk add --no-cache github-cli

# Install Pi SDK
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Create non-root user
RUN adduser -D -u 1000 codver

# Setup workspace
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js
RUN chmod +x /executor.js && chown codver:codver /executor.js

# Switch to non-root user
USER codver

ENTRYPOINT ["node", "/executor.js"]
```

### 6. Generic Template

**`apps/server/src/templates/docker/generic/Dockerfile`**:
```dockerfile
FROM node:24-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Pi SDK
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash codver

# Setup workspace
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js
RUN chmod +x /executor.js && chown codver:codver /executor.js

# Switch to non-root user
USER codver

ENTRYPOINT ["node", "/executor.js"]
```

### 7. Docker Template Engine

**`apps/server/src/services/docker/templates.ts`**:
```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../middleware/logger.js';
import type { Language } from '../language/detector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '../../templates/docker');

export class DockerTemplateEngine {
  async generateFiles(
    language: Language,
    targetDir: string,
    env: Record<string, string>
  ): Promise<void> {
    const templateDir = path.join(TEMPLATES_DIR, language);
    
    if (!fs.existsSync(templateDir)) {
      throw new Error(`Template not found for language: ${language}`);
    }
    
    logger.info({ language, templateDir, targetDir }, 'Generating Docker files');
    
    // Copy Dockerfile
    fs.copyFileSync(
      path.join(templateDir, 'Dockerfile'),
      path.join(targetDir, 'Dockerfile')
    );
    
    // Copy docker-compose.yml
    fs.copyFileSync(
      path.join(templateDir, 'docker-compose.yml'),
      path.join(targetDir, 'docker-compose.yml')
    );
    
    // Copy executor.js
    fs.copyFileSync(
      path.join(templateDir, 'executor.js'),
      path.join(targetDir, 'executor.js')
    );
    
    // Generate .env file
    const envContent = Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    fs.writeFileSync(path.join(targetDir, '.env'), envContent);
  }
}

export const dockerTemplateEngine = new DockerTemplateEngine();
```

### 8. Docker Image Builder

**`apps/server/src/services/docker/builder.ts`**:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../../middleware/logger.js';
import type { Language } from '../language/detector.js';

const execAsync = promisify(exec);

export class DockerBuilder {
  async buildImage(
    language: Language,
    contextDir: string,
    jobId: string,
    useCache: boolean = true
  ): Promise<string> {
    const imageName = `codver-pi-${language}:${jobId}`;
    
    if (useCache) {
      const cachedImage = `codver-pi-${language}:latest`;
      const exists = await this.imageExists(cachedImage);
      
      if (exists) {
        logger.info({ cachedImage, imageName }, 'Using cached image');
        // Tag cached image for this job
        await execAsync(`docker tag ${cachedImage} ${imageName}`);
        return imageName;
      }
    }
    
    logger.info({ language, contextDir, imageName }, 'Building Docker image');
    
    try {
      const { stdout, stderr } = await execAsync(
        `docker build -t ${imageName} ${contextDir}`,
        { maxBuffer: 100 * 1024 * 1024 } // 100MB
      );
      
      logger.info({ stdout, stderr }, 'Image built successfully');
      return imageName;
    } catch (error: any) {
      throw new Error(`Failed to build image: ${error.message}`);
    }
  }
  
  async imageExists(imageName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `docker images -q ${imageName}`
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
  
  async tagImage(sourceImage: string, targetImage: string): Promise<void> {
    await execAsync(`docker tag ${sourceImage} ${targetImage}`);
  }
  
  async buildAllImages(): Promise<{ language: string; success: boolean; error?: string }[]> {
    const languages: Language[] = ['node', 'python', 'rust', 'go', 'generic'];
    const results = [];
    
    for (const language of languages) {
      const imageName = `codver-pi-${language}:latest`;
      const templateDir = path.join(
        __dirname,
        `../../templates/docker/${language}`
      );
      
      if (!fs.existsSync(templateDir)) {
        results.push({ language, success: false, error: 'Template not found' });
        continue;
      }
      
      try {
        logger.info({ language }, `Building ${imageName}`);
        await execAsync(
          `docker build -t ${imageName} ${templateDir}`,
          { maxBuffer: 100 * 1024 * 1024 }
        );
        results.push({ language, success: true });
      } catch (error: any) {
        logger.error({ language, error: error.message }, 'Build failed');
        results.push({ language, success: false, error: error.message });
      }
    }
    
    return results;
  }
}

export const dockerBuilder = new DockerBuilder();
```

### 9. Update Job Processor

**Update `apps/server/src/services/queue/processor.ts`** to include Docker build:

```typescript
// Add these imports
import { dockerTemplateEngine } from '../docker/templates.js';
import { dockerBuilder } from '../docker/builder.js';

// In the processJob function, after language detection:
updateJobStatus(jobId, 'building');
logToJob(jobId, 'info', 'Generating Docker files...');

// Prepare environment variables
const env: Record<string, string> = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  PI_PROMPT: job.prompt,
  PI_MODEL: job.model || 'claude-sonnet-4',
  PI_PROVIDER: 'anthropic',
  PI_THINKING_LEVEL: 'medium',
  PI_LOG_FILE: '/workspace/.codver-logs.jsonl',
  PI_IMAGES: JSON.stringify([]), // TODO: Pass images from job
};

await dockerTemplateEngine.generateFiles(language, workDir, env);
logToJob(jobId, 'info', 'Docker files generated');

logToJob(jobId, 'info', 'Building Docker image...');
const imageName = await dockerBuilder.buildImage(language, workDir, jobId, true);
logToJob(jobId, 'info', `Image built: ${imageName}`);

updateJobStatus(jobId, 'ready');
logToJob(jobId, 'info', 'Job ready for execution');

// Note: Container execution will be in Phase 6
```

### 10. Admin Build Endpoint

**Update `apps/server/src/routes/admin.ts`**:
```typescript
import { Router } from 'express';
import { adminAuthMiddleware } from '../middleware/auth.js';
import { dockerBuilder } from '../services/docker/builder.js';
import { logger } from '../middleware/logger.js';

export const adminRouter = Router();

adminRouter.post('/build-images', adminAuthMiddleware, async (_req, res) => {
  try {
    logger.info('Starting pre-build of all language images');
    const results = await dockerBuilder.buildAllImages();
    
    res.json({
      success: true,
      data: {
        results,
        total: results.length,
        successful: results.filter(r => r.success).length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'BUILD_FAILED', message: error.message },
    });
  }
});
```

## Testing

### Manual Testing

```bash
# 1. Pre-build all images
curl -X POST http://localhost:3000/admin/build-images \
  -H "X-API-Key: admin-key"
# Should build: node, python, rust, go, generic

# 2. Verify images exist
docker images | grep codver-pi
# Should show all language images

# 3. Test with Node.js project
codver run --repo https://github.com/user/node-app --prompt "Add tests"
# Server logs:
# [Job-abc] Generating Docker files...
# [Job-abc] Building Docker image...
# [Job-abc] Image built: codver-pi-node:abc

# 4. Test with Python project
codver run --repo https://github.com/user/python-app --prompt "Add tests"
# Should use codver-pi-python:latest (cached)

# 5. Verify files in job directory
ls ~/.codver-dev/abc/
# Should see: Dockerfile, docker-compose.yml, executor.js, .env

# 6. Test manual Docker build
cd ~/.codver-dev/abc
docker build -t test-build .
# Should build successfully

# 7. Test Docker run
docker run --rm test-build
# Should start executor (will fail without prompt, but tests the build)
```

### Automated Tests

**`apps/server/src/__tests__/docker-builder.test.ts`**:
```typescript
import { describe, it, expect } from 'vitest';
import { DockerBuilder } from '../services/docker/builder.js';

describe('DockerBuilder', () => {
  const builder = new DockerBuilder();
  
  it('should check if image exists', async () => {
    const exists = await builder.imageExists('nonexistent-image');
    expect(exists).toBe(false);
  });
  
  it('should build node image', async () => {
    const contextDir = './src/templates/docker/node';
    const imageName = await builder.buildImage('node', contextDir, 'test-build');
    expect(imageName).toBe('codver-pi-node:test-build');
    
    // Verify image exists
    const exists = await builder.imageExists(imageName);
    expect(exists).toBe(true);
  }, 120000);
});
```

## Validation Checklist

- [ ] Docker templates exist for all languages
- [ ] Templates generate correct files
- [ ] Image builder works for all languages
- [ ] Image caching works (rebuilds only when needed)
- [ ] Pre-build endpoint works
- [ ] Environment variables are injected correctly
- [ ] Docker files are excluded from PR
- [ ] Security settings are applied
- [ ] Resource limits are configured
- [ ] All tests pass

## Next Phase

Proceed to [Phase 6: Pi SDK Execution in Docker](./06-pi-sdk-execution.md)
