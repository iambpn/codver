# System Architecture

## Overview

The Remote Pi Agent Execution Server is a distributed system that enables clients to submit coding tasks to a remote server, which executes them inside isolated Docker containers using the Pi agent SDK, and automatically creates GitHub pull requests with the results.

## High-Level Architecture

```
┌─────────────────┐         HTTPS          ┌──────────────────┐
│   Client CLI    │ ◄────────────────────► │   Server API     │
│   (codver)      │    X-API-Key Header    │  (Node.js/Express)│
└─────────────────┘                        └──────────────────┘
                                                     │
                                                     │ Job Queue
                                                     ▼
┌──────────────────────────────────────────────────────────────┐
│                    Job Processor                             │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Clone    │→ │ Detect   │→ │ Build    │→ │ Run      │    │
│  │ Repo     │  │ Language │  │ Docker   │  │ Container│    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Extract  │→ │ Create   │→ │ Cleanup  │                  │
│  │ Changes  │  │ PR       │  │ Resources│                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
└──────────────────────────────────────────────────────────────┘
                                                     │
                                                     ▼
                                            ┌──────────────────┐
                                            │  Docker Sandbox  │
                                            │                  │
                                            │  ┌────────────┐  │
                                            │  │ Pi Agent   │  │
                                            │  │ SDK        │  │
                                            │  └────────────┘  │
                                            │                  │
                                            │  ┌────────────┐  │
                                            │  │ Project    │  │
                                            │  │ Files      │  │
                                            │  └────────────┘  │
                                            └──────────────────┘
```

## Component Architecture

### 1. Client CLI (`codver`)

**Technology**: Node.js + TypeScript + `commander.js`

**Responsibilities**:
- Configure server connection (URL, API key)
- Submit jobs with prompts, repos, and resources
- Monitor job status and logs
- Manage configuration locally

**Key Files**:
- `bin/codver.js` - Executable entry point
- `src/commands/` - Command implementations
- `src/api/client.ts` - HTTP client for server API
- `src/config/store.ts` - Local config management

**Data Flow**:
1. User runs command (e.g., `codver run ...`)
2. CLI reads config from `~/.codver/config.json`
3. CLI makes HTTPS request to server with `X-API-Key` header
4. Server returns job ID
5. CLI can poll for status and logs

### 2. Server API

**Technology**: Node.js + Express + TypeScript

**Responsibilities**:
- Authenticate clients via API keys
- Accept and queue job requests
- Coordinate job processing
- Store job state in SQLite
- Stream logs to clients
- Expose admin endpoints

**Key Modules**:
- `src/routes/` - HTTP route handlers
- `src/middleware/` - Auth, error handling, rate limiting
- `src/services/queue/` - Job queue management
- `src/services/github/` - GitHub CLI integration
- `src/services/docker/` - Docker orchestration
- `src/services/pi-agent/` - Pi agent coordination
- `src/services/language/` - Language detection
- `src/database/` - SQLite connection and schema
- `src/utils/ai.ts` - AI API calls for PR generation

**API Endpoints**:

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/health` | Server health check | No |
| POST | `/api-keys` | Generate API key | Admin |
| POST | `/jobs` | Create new job | Yes |
| GET | `/jobs/:id` | Get job status | Yes |
| GET | `/jobs/:id/logs` | Get job logs | Yes |
| GET | `/jobs` | List jobs | Yes |
| POST | `/admin/build-images` | Pre-build Docker images | Admin |

**Database Schema**:

```sql
-- Jobs table
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  repo_url TEXT NOT NULL,
  branch TEXT,
  prompt TEXT NOT NULL,
  model TEXT,
  pr_url TEXT,
  error_message TEXT,
  status TEXT NOT NULL,  -- pending, cloning, building, running, completed, failed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Job logs
CREATE TABLE job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,  -- info, warn, error, debug
  message TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- API keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Server configuration
CREATE TABLE server_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 3. Job Processing Pipeline

**Stages**:

1. **Validation** (immediate)
   - Validate request payload
   - Check API key permissions
   - Insert job into database with status `pending`

2. **Cloning** (async)
   - Clone repository to `~/.codver-dev/{jobId}/`
   - Checkout to specified branch
   - Update status to `cloning` → `ready`

3. **Language Detection** (async)
   - Analyze project structure
   - Heuristic detection first
   - AI fallback if ambiguous
   - Update database with detected language

4. **Docker Build** (async)
   - Generate Docker files from template
   - Check for cached image
   - Build image or use cached
   - Update status to `building` → `ready_to_run`

5. **Execution** (async)
   - Start container with `docker-compose up`
   - Container runs Pi agent with prompt
   - Pi agent modifies files in mounted volume
   - Server monitors container
   - Update status to `running`

6. **Result Extraction** (async)
   - Stop container: `docker-compose down`
   - Run `git diff` to extract changes
   - Filter out Docker files
   - Update status to `extracting`

7. **PR Creation** (async)
   - Generate PR metadata with AI
   - Create branch and commit
   - Push to origin
   - Create PR via `gh pr create`
   - Store PR URL
   - Update status to `completed`

8. **Cleanup** (async)
   - Remove container and volumes
   - Optionally remove project directory
   - Update final status

**Error Handling**:
- Any stage can fail
- Errors are caught and logged
- Error PR is created with failure details
- Resources are always cleaned up
- Job status set to `failed` with error message

### 4. Docker Sandbox

**Base Image Structure**:

```dockerfile
FROM node:24-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates

# Install Pi SDK
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Setup workspace
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js
RUN chmod +x /executor.js

# Entry point
ENTRYPOINT ["node", "/executor.js"]
```

**Docker Compose Configuration**:

```yaml
services:
  pi-agent:
    build: .
    volumes:
      - ./:/workspace
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - PI_PROMPT=${PI_PROMPT}
      - PI_MODEL=${PI_MODEL}
      - PI_THINKING_LEVEL=${PI_THINKING_LEVEL}
      - PI_LOG_FILE=/workspace/.codver-logs.jsonl
    working_dir: /workspace
    user: "1000:1000"  # Non-root user
    read_only: true
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

**Pi SDK Executor Script** (`executor.js`):

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
  const prompt = process.env.PI_PROMPT;
  const modelId = process.env.PI_MODEL || 'claude-sonnet-4';
  const thinkingLevel = process.env.PI_THINKING_LEVEL || 'medium';
  const logFile = process.env.PI_LOG_FILE || '/workspace/.codver-logs.jsonl';
  
  // Parse model (e.g., "anthropic/claude-sonnet-4" or "claude-sonnet-4")
  let model;
  if (modelId.includes('/')) {
    const [provider, id] = modelId.split('/');
    model = getModel(provider, id);
  } else {
    model = getModel('anthropic', modelId);
  }
  
  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }
  
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
      ...event
    };
    logStream.write(JSON.stringify(logEntry) + '\n');
  });
  
  // Run the prompt
  await session.prompt(prompt);
  
  logStream.end();
  console.log('Agent completed successfully');
}

main().catch((err) => {
  console.error('Executor failed:', err);
  process.exit(1);
});
```

**Security Features**:
- Non-root user (UID 1000)
- Read-only root filesystem
- Resource limits (CPU, memory)
- Dropped capabilities
- No new privileges
- Tmpfs for temporary files
- Network isolation (configurable)

### 5. GitHub Integration

**Authentication**:
- Server uses `gh auth login` with bot account
- Bot account has repository access
- Alternative: User can provide personal token

**PR Creation Flow**:
1. Extract modified files from project directory
2. Filter out: `Dockerfile`, `docker-compose.yml`, `executor.js`, `.env`, `.codver-logs.jsonl`
3. Generate PR metadata with AI:
   - Branch name: `feat/{description}-{jobId}`
   - Title: Concise description
   - Body: Summary of changes + context
4. Git operations:
   ```bash
   git checkout -b {branch-name}
   git add {filtered-files}
   git commit -m "{message}"
   git push origin {branch-name}
   gh pr create --title "{title}" --body "{body}"
   ```
5. Store PR URL in database

**Error PR Flow**:
- Same as success flow, but:
  - Branch: `codver-error-{jobId}`
  - Title: "Failed: {reason}"
  - Body: Error logs + AI analysis

## Data Flow

### Job Submission Flow

```
User → CLI → Server → Database
                ↓
            Job Queue
                ↓
            Worker
                ↓
        Process Job (8 stages)
                ↓
        Database (status updates)
                ↓
        Client (polling/SSE)
```

### File System Layout

```
~/.codver-dev/
├── {jobId-1}/
│   ├── (project files)
│   ├── Dockerfile (generated)
│   ├── docker-compose.yml (generated)
│   └── .codver-logs.jsonl (Pi events)
├── {jobId-2}/
│   └── ...
```

### Database Storage

```
~/.codver-server/
├── codver.db          # SQLite database
├── codver.db-wal      # Write-ahead log
└── codver.db-shm      # Shared memory file
```

## Security Considerations

### 1. Sandboxing

**Docker Isolation**:
- Container-level isolation
- Resource limits prevent resource exhaustion
- Non-root user prevents privilege escalation
- Read-only filesystem prevents system modifications
- Capability drops limit kernel access

**Enhanced Sandboxing** (Optional):
- **gVisor**: Intercepts syscalls for additional isolation
- **Podman**: Rootless containers for host-level security
- **Kata Containers**: VM-based isolation for strongest security

### 2. Authentication

**API Key Security**:
- Keys are hashed (bcrypt) before storage
- Keys are never logged
- Rate limiting prevents brute force
- Configurable key rotation

**GitHub Authentication**:
- Bot account with limited permissions
- Token stored securely on server
- Option for user-provided tokens

### 3. Input Validation

- Repo URLs validated to prevent path traversal
- Prompts sanitized to prevent injection
- File uploads validated for type and size
- Docker commands parameterized

### 4. Secrets Management

- API keys passed via environment variables
- Never written to logs
- Separate secrets per job
- Configurable secret rotation

### 5. Network Security

- HTTPS only (no HTTP)
- Strong cipher suites
- Security headers (HSTS, CSP, etc.)
- Optional network isolation for containers

## Scalability

### Current Limitations (Single Machine)

- Sequential job processing (configurable concurrency)
- Local file storage
- In-memory queue
- SQLite database

### Future Enhancements

- **Job Queue**: Migrate to BullMQ + Redis
- **Storage**: Migrate to PostgreSQL
- **Orchestration**: Kubernetes for multiple machines
- **Caching**: Redis for image cache and metadata
- **Load Balancing**: Multiple server instances

## Monitoring & Observability

### Logging

- Structured logging with `pino`
- Log levels: info, warn, error, debug
- Log rotation and retention
- Centralized log aggregation (optional)

### Metrics

- Job count (pending, running, completed, failed)
- Job duration (average, p50, p95, p99)
- Success rate
- Resource usage (CPU, memory, disk)
- API request rate and latency

### Health Checks

- `/health` endpoint
- Database connectivity check
- Docker daemon connectivity check
- Disk space check

## Deployment

### Development

```bash
# Install dependencies
pnpm install

# Start server (with self-signed certs)
pnpm dev:server

# Start client
pnpm dev:client
```

### Production

```bash
# Build server Docker image
docker build -t codver-server -f apps/server/Dockerfile .

# Run with Docker Compose
docker-compose up -d

# Or with systemd
systemctl start codver-server
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name codver.example.com;
    
    ssl_certificate /etc/letsencrypt/live/codver.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/codver.example.com/privkey.pem;
    
    location / {
        proxy_pass https://localhost:3000;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Technology Stack

### Server
- **Runtime**: Node.js 24
- **Framework**: Express
- **Database**: SQLite (better-sqlite3)
- **Language**: TypeScript
- **Logging**: Pino
- **Validation**: Zod
- **GitHub**: GitHub CLI (gh)
- **Docker**: Dockerode or child_process

### Client
- **Runtime**: Node.js 24
- **Framework**: Commander.js
- **Language**: TypeScript
- **HTTP Client**: Axios
- **Prompts**: Inquirer
- **Output**: Chalk

### Sandbox
- **Base Image**: Node.js 24 (language-specific variants)
- **Pi Agent**: @earendil-works/pi-coding-agent
- **Tools**: Git, GitHub CLI, ripgrep

### Infrastructure
- **Container Runtime**: Docker
- **Reverse Proxy**: Nginx or Caddy
- **SSL/TLS**: Let's Encrypt
- **Process Manager**: systemd or Docker Compose
- **Monitoring**: Prometheus + Grafana (optional)

## Design Principles

1. **Security First**: Sandbox untrusted code, validate inputs, limit permissions
2. **Reliability**: Comprehensive error handling, automatic cleanup, retry logic
3. **Observability**: Detailed logging, job tracking, metrics
4. **Modularity**: Clear separation of concerns, testable components
5. **Simplicity**: Start simple, add complexity only when needed
6. **Standards**: Follow REST conventions, use established libraries
7. **Documentation**: Code comments, API docs, setup guides
