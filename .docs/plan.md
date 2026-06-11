# Complete Implementation Plan

## Project Description

A remote AI execution server that allows clients to submit coding tasks to a remote server, which uses the **Pi agent** to work on tasks inside **Docker sandboxes**, then automatically creates **GitHub pull requests** with the results.

## Goals

1. **Client Experience**: Easy-to-use CLI to submit coding tasks
2. **Server Reliability**: Robust job processing with error handling
3. **Security**: Sandboxed execution to contain untrusted code
4. **Automation**: Automatic PR creation with AI-generated metadata
5. **Scalability**: Support multiple concurrent jobs
6. **Observability**: Detailed logging and job tracking

## Architecture

### High-Level Flow

```
Client (CLI) → HTTP → Server (API) → Job Queue
                                          ↓
                                    Clone Repo
                                          ↓
                                  Language Detection
                                          ↓
                                Generate Docker Setup
                                          ↓
                                Build Docker Image
                                          ↓
                                Run Container
                                          ↓
                              Pi Agent Executes Task
                                          ↓
                            Collect Results & Changes
                                          ↓
                            Create GitHub PR
                                          ↓
                            Cleanup Resources
```

### Components

**Client (`codver` CLI)**
- Node.js CLI tool
- Configures server connection and API key
- Submits jobs with prompts, repos, and resources
- Monitors job status and logs

**Server (API + Job Processor)**
- Node.js + Express with HTTP (HTTPS handled by nginx reverse proxy)
- API key authentication
- SQLite database for jobs and logs
- Job queue (in-memory → BullMQ in Phase 9)
- GitHub CLI integration
- Docker orchestration
- Pi agent execution

**Sandbox (Docker Container)**
- Node.js 24 base image
- Pi SDK installed globally
- Custom `executor.js` using Pi SDK
- Mounted project directory
- API keys via environment variables
- Resource limits enforced

## Monorepo Structure

```
codver/
├── .github/
│   └── workflows/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   │   ├── docker/
│   │   │   │   ├── github/
│   │   │   │   ├── pi-agent/
│   │   │   │   ├── queue/
│   │   │   │   └── language/
│   │   │   ├── templates/
│   │   │   │   └── docker/
│   │   │   │       ├── node/
│   │   │   │       ├── python/
│   │   │   │       ├── rust/
│   │   │   │       ├── go/
│   │   │   │       └── generic/
│   │   │   ├── database/
│   │   │   ├── middleware/
│   │   │   └── utils/
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml
│   │   └── package.json
│   └── client/
│       ├── src/
│       │   ├── commands/
│       │   ├── api/
│       │   └── config/
│       ├── bin/
│       └── package.json
├── packages/
│   └── shared-types/
├── docs/                          # User-facing docs
├── .docs/                          # This plan documentation
└── README.md
```

## Phase 1: Monorepo Foundation

**Goal:** A working pnpm monorepo with TypeScript tooling and basic project structure.

### Tasks

1. **Initialize Monorepo**
   - `pnpm init` at root
   - Create `pnpm-workspace.yaml` defining `apps/*` and `packages/*`
   - Setup `.gitignore` (Node, Docker, IDE files)

2. **Setup TypeScript**
   - `tsconfig.json` at root with base config
   - Workspace-specific `tsconfig.json` files extending base
   - `pnpm` scripts: `build`, `dev`, `lint`, `test`

3. **Setup Linting & Formatting**
   - ESLint with TypeScript rules
   - Prettier for formatting
   - Pre-commit hooks with Husky (optional)

4. **Create Shared Types Package**
   - `packages/shared-types/`
   - Define interfaces: `JobRequest`, `JobStatus`, `JobResponse`, `ServerConfig`, `ApiResponse`

5. **Initialize Server App**
   - `apps/server/` with TypeScript
   - Express setup with basic route
   - Health check endpoint
   - Basic error handling

6. **Initialize Client App**
   - `apps/client/` with TypeScript
   - CLI framework: `commander.js`
   - Basic help command

7. **README and Documentation**
   - Root `README.md` with project overview
   - Setup instructions
   - Development workflow

### Testable Deliverables

```bash
# Install dependencies
pnpm install

# Start server
pnpm dev:server
# > Server running on http://localhost:3000

# Test health endpoint
curl http://localhost:3000/health
# 200 OK { "status": "healthy" }

# Start client
pnpm dev:client
# > Usage: codver [options] [command]

# Run linter
pnpm lint
# > All files pass
```

## Phase 2: Server API Core

**Goal:** HTTP server with API key authentication and SQLite database. HTTPS is handled by a reverse proxy (e.g., nginx) in production.

### Tasks

1. **HTTP Server Setup**
   - Express app listening on HTTP
   - Trust proxy when behind nginx (`trust proxy: 1`)
   - Document nginx reverse proxy setup

2. **Environment Configuration**
   - `dotenv` for environment variables
   - Validation with `zod` or `joi`
   - Config file: `src/config/index.ts`

3. **SQLite Database**
   - Install `better-sqlite3`
   - Create schema:
     ```sql
     CREATE TABLE jobs (
       id TEXT PRIMARY KEY,
       repo_url TEXT NOT NULL,
       branch TEXT,
       prompt TEXT NOT NULL,
       model TEXT,
       status TEXT NOT NULL,
       pr_url TEXT,
       error_message TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );

     CREATE TABLE job_logs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       job_id TEXT NOT NULL,
       timestamp INTEGER NOT NULL,
       level TEXT NOT NULL,
       message TEXT NOT NULL,
       FOREIGN KEY (job_id) REFERENCES jobs(id)
     );

     CREATE TABLE api_keys (
       id TEXT PRIMARY KEY,
       key_hash TEXT NOT NULL UNIQUE,
       name TEXT,
       created_at INTEGER NOT NULL,
       last_used_at INTEGER
     );

     CREATE TABLE server_config (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );
     ```
   - Connection management
   - Migration system

4. **API Key Authentication**
   - Middleware: `src/middleware/auth.ts`
   - Hash and store API keys
   - Generate API keys (admin endpoint)
   - Validate `X-API-Key` header

5. **Core Routes**
   - `GET /health` - Server status
   - `POST /api-keys` - Generate new API key (admin)
   - `POST /jobs` - Create job (authenticated)
   - `GET /jobs/:id` - Get job status (authenticated)
   - `GET /jobs/:id/logs` - Get job logs (authenticated)
   - `GET /jobs` - List jobs (authenticated)

6. **Middleware**
   - Error handling middleware
   - Request logging with `pino`
   - Rate limiting with `express-rate-limit`
   - CORS configuration
   - Body parsing with size limits

7. **Error Handling**
   - Custom error classes
   - Consistent error response format
   - Database error handling

### Testable Deliverables

```bash
# Generate API key (admin endpoint)
curl -X POST http://localhost:3000/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: admin-secret" \
  -d '{"name":"dev-key"}'
# 201 Created { "key": "codv_abc123..." }

# Test health without auth
curl http://localhost:3000/health
# 401 Unauthorized

# Test health with auth
curl -H "X-API-Key: codv_abc123..." http://localhost:3000/health
# 200 OK { "status": "healthy", "version": "0.1.0" }

# Create a job
curl -H "X-API-Key: codv_abc123..." -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/test/repo",
    "branch": "main",
    "prompt": "Add unit tests"
  }'
# 201 Created { "jobId": "abc123", "status": "pending" }

# Get job status
curl -H "X-API-Key: codv_abc123..." http://localhost:3000/jobs/abc123
# 200 OK { "id": "abc123", "status": "pending", ... }
```

## Phase 3: Client CLI

**Goal:** Interactive CLI tool for configuration and job submission.

### Tasks

1. **CLI Framework Setup**
   - Install `commander.js` and `inquirer`
   - Setup command structure
   - Bin script: `bin/codver.js`

2. **Configuration Management**
   - Store config in `~/.codver/config.json`
   - `src/config/store.ts` - Read/write config
   - Validate config

3. **Commands Implementation**
   - `codver config init` - Interactive wizard
   - `codver config set-server <url>` - Set server URL
   - `codver config set-key <key>` - Set API key
   - `codver config view` - Show current config
   - `codver status` - Ping server health
   - `codver run` - Submit job
   - `codver status --job-id <id>` - Get job status
   - `codver logs --job-id <id>` - View logs
   - `codver jobs list` - List recent jobs

4. **API Client**
   - `src/api/client.ts` - HTTP client using `axios` or `node-fetch`
   - Authentication header injection
   - Error handling
   - Retry logic

5. **Interactive Prompts**
   - Use `inquirer` for:
     - Initial setup wizard
     - Confirmations
     - Multi-select options

6. **Output Formatting**
   - Colored output with `chalk`
   - Tables for job lists
   - Progress indicators

### Testable Deliverables

```bash
# Initial setup
codver config init
# ? Server URL: https://my-server.com
# ? API Key: ****
# ✅ Configuration saved to ~/.codver/config.json

# View config
codver config view
# Server: https://my-server.com
# API Key: ****

# Test connection
codver status
# ✅ Connected to https://my-server.com (v0.1.0)
# Server healthy, 0 jobs running

# Submit job
codver run \
  --repo https://github.com/user/repo \
  --branch main \
  --prompt "Add README"
# Job submitted: abc123
# Track with: codver status --job-id abc123

# Check job status
codver status --job-id abc123
# Status: pending
# Created: 2025-01-15 10:30:00

# List jobs
codver jobs list
# ID        REPO                STATUS    CREATED
# abc123    user/repo           pending   2025-01-15 10:30:00
```

## Phase 4: Job Queue & GitHub Integration

**Goal:** Server processes jobs, clones repositories, and tracks status.

### Tasks

1. **Job Queue Service**
   - In-memory queue for MVP
   - Worker function
   - Concurrent job limit (configurable, default: 3)
   - Queue management: `src/services/queue/index.ts`

2. **GitHub CLI Setup**
   - Document `gh auth login` setup on server
   - Test GitHub authentication
   - Configure git user: `gh config set user.name "Codver Bot"`

3. **Repository Cloning**
   - `src/services/github/auth.ts` - GitHub authentication
   - Clone repository to `~/.codver-dev/{jobId}/`
   - Checkout to specified branch
   - Handle clone errors

4. **Job State Management**
   - Update job status in database
   - Status transitions: `pending` → `cloning` → `ready`
   - Error handling and status updates

5. **Job Processing Logic**
   - `src/services/queue/processor.ts`
   - Process jobs sequentially or concurrently
   - Update job status at each step
   - Log progress to database

6. **File Storage**
   - Clone to `~/.codver-dev/{jobId}/`
   - Cleanup old jobs (configurable retention)

### Testable Deliverables

```bash
# Submit a job via client
codver run --repo https://github.com/user/repo --branch main --prompt "test"

# Server logs show:
# [Job-abc123] Created in database
# [Job-abc123] Starting clone...
# [Job-abc123] Cloned to /home/user/.codver-dev/abc123/
# [Job-abc123] Checked out branch: main
# [Job-abc123] Status: ready

# Check filesystem
ls ~/.codver-dev/abc123/
# README.md  src/  package.json  ...

# Check job status
codver status --job-id abc123
# Status: ready
# Repo: https://github.com/user/repo
# Branch: main
# Cloned: 2025-01-15 10:30:05
```

## Phase 5: Language Detection & Docker Image Builder

**Goal:** Detect project language, generate Docker setup, and build images.

### Tasks

1. **Language Detection Service**
   - `src/services/language/detector.ts`
   - Heuristic detection:
     - `package.json` → Node.js
     - `requirements.txt` or `pyproject.toml` → Python
     - `Cargo.toml` → Rust
     - `go.mod` → Go
     - `pom.xml` or `build.gradle` → Java
     - `Gemfile` → Ruby
     - `composer.json` → PHP
     - Fallback → Generic
   - AI fallback: Use Pi or OpenAI API to analyze file tree

2. **Docker Templates**
   - `src/templates/docker/{language}/`
   - Each template includes:
     - `Dockerfile` - Language-specific base image
     - `docker-compose.yml` - Compose configuration
     - `executor.js` - Pi SDK executor script

3. **Template Engine**
   - `src/services/docker/templates.ts`
   - Copy template files to job directory
   - Inject environment variables
   - Generate `.env` file with API keys

4. **Docker Image Builder**
   - `src/services/docker/builder.ts`
   - Build image: `docker build -t codver-pi-{language}:{jobId}`
   - Check for cached image: `codver-pi-{language}:latest`
   - Tag cached image for job if exists
   - Build progress logging

5. **Admin Endpoint for Pre-building**
   - `POST /admin/build-images` - Pre-build all language templates
   - Useful for warming cache before jobs

6. **Language-Specific Templates**
   - **Node.js**: `node:24-bookworm-slim` + Pi SDK
   - **Python**: `python:3.13-slim` + Pi SDK
   - **Rust**: `rust:1.83-slim` + Pi SDK
   - **Go**: `golang:1.23-alpine` + Pi SDK
   - **Generic**: `node:24-bookworm-slim` + Pi SDK

### Testable Deliverables

```bash
# Submit job
codver run --repo https://github.com/user/node-app --prompt "Add tests"

# Server logs:
# [Job-abc123] Detecting language...
# [Job-abc123] Detected: node (package.json found)
# [Job-abc123] Generating Docker files...
# [Job-abc123] Building image...
# [Job-abc123] Image built: codver-pi-node:abc123

# Check Docker images
docker images | grep codver-pi-node
# codver-pi-node   abc123   ...

# Pre-build all images (admin)
curl -k -H "X-API-Key: admin-key" -X POST https://localhost:3000/admin/build-images
# Building image: codver-pi-node:latest
# Building image: codver-pi-python:latest
# Building image: codver-pi-rust:latest
# Building image: codver-pi-go:latest
# Building image: codver-pi-generic:latest
# ✅ All images built

# Check cached images
docker images | grep codver-pi
# codver-pi-node    latest
# codver-pi-python  latest
# ...
```

## Phase 6: Pi SDK Execution in Docker

**Goal:** Run Pi agent inside container with full event capture.

### Tasks

1. **Pi SDK Executor Script**
   - `src/templates/docker/{language}/executor.js`
   - Uses `@earendil-works/pi-coding-agent` SDK
   - Reads prompt and model from environment variables
   - Creates agent session with `createAgentSession()`
   - Runs in print mode with `runPrintMode()`
   - Subscribes to events and logs to file
   - Handles errors and exits with appropriate code

2. **Docker Compose Configuration**
   - Mount project directory as `/workspace`
   - Set environment variables: `PI_PROMPT`, `PI_MODEL`, API keys
   - Resource limits: CPU, memory
   - Network configuration
   - Restart policy: `no` (single execution)

3. **Container Runner Service**
   - `src/services/docker/runner.ts`
   - Start container with `docker-compose up`
   - Monitor container status
   - Capture logs
   - Handle timeout (configurable, default 30 minutes)
   - Force stop on timeout

4. **Log Streaming**
   - Capture container stdout/stderr
   - Stream to database in real-time
   - Send to client via polling or SSE
   - Parse Pi events from JSONL log file

5. **Event Handling**
   - Parse Pi agent events
   - Track progress
   - Detect completion
   - Extract modified files
   - Handle errors

6. **Pi SDK Integration**
   - Use `createAgentSession()` for programmatic execution
   - Configure with appropriate tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`
   - Support model selection via `getModel()` or `ModelRegistry`
   - Handle `ImageContent` for image prompts
   - Manage session lifecycle

### Testable Deliverables

```bash
# Submit job
codver run --repo https://github.com/user/repo --prompt "Add error handling"

# Server logs:
# [Job-abc123] Starting container...
# [Job-abc123] Container started: codver-job-abc123
# [Job-abc123] [pi] Agent starting...
# [Job-abc123] [pi] Analyzing project structure...
# [Job-abc123] [pi] Reading files...
# [Job-abc123] [pi] Making changes...
# [Job-abc123] [pi] edit: src/app.ts
# [Job-abc123] [pi] write: src/utils/error.ts
# [Job-abc123] [pi] Completed successfully

# Check job status
codver status --job-id abc123
# Status: running
# Runtime: 2m 15s

# View logs
codver logs --job-id abc123
# [pi] Agent starting...
# [pi] Analyzing project structure...
# ...

# Check running container
docker ps
# CONTAINER ID   IMAGE                    COMMAND           STATUS
# xyz123         codver-pi-node:abc123   "node executor"   Up 2m
```

## Phase 7: PR Creation & Cleanup

**Goal:** Create clean PR with AI-generated metadata and cleanup resources.

### Tasks

1. **Git Diff Extraction**
   - Run `git diff` in project directory
   - Identify modified files
   - Filter out: `Dockerfile`, `docker-compose.yml`, `executor.js`, `.env`

2. **AI-Generated PR Metadata**
   - Use Pi SDK or separate AI call to generate:
     - Branch name: `feat/{description}-{jobId}`
     - PR title: Concise description
     - PR description: Summary of changes
   - Context: original prompt + diff summary

3. **Git Operations**
   - Create new branch: `git checkout -b {branch-name}`
   - Stage changes (excluding Docker files)
   - Commit with AI-generated message
   - Push to origin: `git push origin {branch-name}`
   - Handle authentication

4. **PR Creation**
   - Use `gh pr create` with title and body
   - Configure PR author (bot account)
   - Set labels if applicable
   - GitHub automatically sends email notification

5. **Container Cleanup**
   - Stop container: `docker-compose down`
   - Remove container and volumes
   - Remove temporary project directory (optional, configurable)
   - Clean up Docker images (optional)

6. **Database Updates**
   - Update job status: `completed`
   - Store PR URL
   - Log completion time

7. **PR Author Configuration**
   - Default: Bot account (server's `gh auth` token)
   - Configurable: User can set `pr_author: user` (requires user's token)
   - Store author preference in job or server config

### Testable Deliverables

```bash
# Agent completes successfully
# Server logs:
# [Job-abc123] Agent completed
# [Job-abc123] Extracting changes...
# [Job-abc123] Modified files: src/app.ts, src/utils/error.ts
# [Job-abc123] Generating PR metadata...
# [Job-abc123] Branch: feat/add-error-handling-abc123
# [Job-abc123] Title: "Add comprehensive error handling"
# [Job-abc123] Creating PR...
# [Job-abc123] PR created: https://github.com/user/repo/pull/42
# [Job-abc123] Cleaning up resources...
# [Job-abc123] Status: completed

# GitHub shows:
# PR #42: "Add comprehensive error handling"
# Branch: feat/add-error-handling-abc123
# Author: codver-bot
# Files: src/app.ts, src/utils/error.ts (no Docker files)
# GitHub sends email notification to repo watchers

# Check job status
codver status --job-id abc123
# Status: completed
# PR: https://github.com/user/repo/pull/42
# Duration: 3m 45s

# Verify cleanup
docker ps
# (no codver containers running)
```

## Phase 8: Error Handling & Failure PRs

**Goal:** Comprehensive error handling with failure PRs.

### Tasks

1. **Error Detection**
   - Clone failure (network, permissions, invalid repo)
   - Docker build failure (template errors, missing files)
   - Container startup failure (image issues, config errors)
   - Pi agent failure (crash, timeout, API errors)
   - Git operations failure (auth, conflicts, network)
   - PR creation failure (permissions, rate limits)

2. **Error Classification**
   - Categorize errors by type
   - Store error details in database
   - Track error frequency for monitoring

3. **Error Log Collection**
   - Capture all relevant logs
   - Container stdout/stderr
   - Server error messages
   - Stack traces
   - Pi agent error events

4. **AI-Generated Error PR**
   - Use Pi or AI to analyze error logs
   - Generate:
     - Branch: `codver-error-{jobId}`
     - Title: "Failed: {reason}"
     - Body: Error logs + AI analysis + suggestions
   - Create PR even on failure
   - No code changes (or partial if some changes succeeded)

5. **Resource Cleanup on Failure**
   - Always stop containers
   - Always remove temporary files
   - Always update job status: `failed`
   - Store error details for debugging

6. **Client Error Reporting**
   - Return error details in job status
   - Provide PR URL for failure report
   - Log errors to client console

7. **Retry Logic** (Optional)
   - Configurable retry attempts
   - Exponential backoff
   - Different retry strategies per error type

### Testable Deliverables

```bash
# Simulate failure (invalid repo)
codver run --repo https://github.com/invalid/repo --prompt "test"

# Server logs:
# [Job-def456] Starting clone...
# [Job-def456] Clone failed: repository not found
# [Job-def456] Generating error report...
# [Job-def456] Error PR created: https://github.com/invalid/repo/pull/1
# [Job-def456] Status: failed

# GitHub shows:
# PR #1: "Failed to process job: Repository not found"
# Branch: codver-error-def456
# Body: "The repository https://github.com/invalid/repo could not be cloned.
#        Error: fatal: repository not found...
#        Suggestions: Verify the repository URL and permissions."

# Check job status
codver status --job-id def456
# Status: failed
# Error: Clone failed: repository not found
# Error PR: https://github.com/invalid/repo/pull/1

# Verify cleanup
docker ps
# (no containers running)
```

## Phase 9: Advanced Features

**Goal:** Rich prompt support, monitoring, and caching.

### Tasks

1. **Prompt File Support**
   - `--prompt-file <path>` - Read prompt from file
   - Support `.md`, `.txt`, and other text files
   - Combine with inline prompt

2. **Image Support**
   - `--images <file...>` - Attach images to prompt
   - Support multiple images
   - Use Pi `ImageContent` in SDK
   - Encode as base64

3. **Custom Model Selection**
   - `--model <model>` - Specify model (e.g., `claude-sonnet-4`)
   - `--provider <provider>` - Specify provider (anthropic, openai, google)
   - `--thinking <level>` - Set thinking level (off, minimal, low, medium, high)

4. **Additional Resource Files**
   - `--files <file...>` - Attach additional files
   - Files available in container
   - Context for agent

5. **Job Log Streaming**
   - `codver logs --follow` - Real-time log streaming
   - Server-Sent Events (SSE) for streaming
   - Or polling with `--follow` flag

6. **Job History & Analytics**
   - `codver jobs list` - Recent jobs
   - Job statistics (success rate, duration, etc.)
   - Filter by status, date, repo

7. **Webhooks**
   - `--webhook <url>` - Callback on completion
   - POST job status to webhook URL
   - Retry on webhook failure

8. **Image Caching**
   - Pre-build images command
   - `codver server build-images` (server-side)
   - Scheduled cache warming
   - Cache invalidation

9. **Database Migrations**
   - Migration system for schema changes
   - Version tracking
   - Rollback support

10. **Advanced Job Configuration**
    - Custom timeout
    - Memory limits
    - CPU limits
    - Network access configuration
    - Environment variables

### Testable Deliverables

```bash
# Submit job with all features
codver run \
  --repo https://github.com/user/repo \
  --branch main \
  --prompt-file ./feature.md \
  --images ./mockup.png ./screenshot.png \
  --files ./config.json \
  --model claude-sonnet-4 \
  --thinking high \
  --timeout 60m \
  --webhook https://my-app.com/webhook

# Stream logs in real-time
codver logs --job-id abc123 --follow
# [pi] Starting...
# [pi] Analyzing...
# [pi] Making changes...
# (updates in real-time)

# View job history
codver jobs list
# ID        REPO                STATUS      PR
# abc123    user/repo           completed   https://github.com/user/repo/pull/42
# def456    user/other          failed      https://github.com/user/other/pull/5
# ghi789    user/third          running     -

# View job details
codver status --job-id abc123 --verbose
# ID: abc123
# Status: completed
# Repo: https://github.com/user/repo
# Branch: main
# Model: claude-sonnet-4
# Files: prompt.md, mockup.png, config.json
# Created: 2025-01-15 10:30:00
# Started: 2025-01-15 10:30:05
# Completed: 2025-01-15 10:33:50
# Duration: 3m 45s
# PR: https://github.com/user/repo/pull/42
```

## Phase 10: Security & Production

**Goal:** Hardened sandboxing and production deployment.

### Tasks

1. **Docker Security**
   - Non-root user in containers
   - Read-only root filesystem (except `/workspace`)
   - Resource limits (CPU, memory)
   - Network isolation
   - Drop capabilities (`--cap-drop ALL`)
   - Security options (`seccomp`, `AppArmor`)

2. **Enhanced Sandboxing (Optional)**
   - gVisor runtime (`--runtime=runsc`)
   - Podman support
   - Document setup and tradeoffs

3. **Input Validation**
   - Sanitize repo URLs (prevent path traversal)
   - Validate prompt length and content
   - Prevent command injection
   - Validate file uploads

4. **Secrets Management**
   - Docker secrets or env files
   - Never log API keys
   - Rotate API keys periodically
   - Separate secrets per job

5. **Audit Logging**
   - Log all job requests
   - Log authentication attempts
   - Log Docker operations
   - Retain logs for 30 days

6. **Rate Limiting**
   - Per-API-key limits
   - Global server limits
   - Configurable limits

7. **Monitoring & Observability**
   - Health check endpoint
   - Metrics endpoint (Prometheus)
   - Error tracking (Sentry)
   - Log aggregation

8. **Production Deployment**
   - Docker Compose for server
   - Reverse proxy (Nginx, Caddy)
   - systemd service
   - Auto-restart
   - Backup strategy

9. **SSL/TLS**
   - Production certificates (Let's Encrypt)
   - Certificate renewal
   - Strong cipher suites
   - HSTS headers

10. **Documentation**
    - Server setup guide
    - Client setup guide
    - Admin guide
    - Troubleshooting guide
    - Security best practices

### Testable Deliverables

```bash
# Security audit
docker run --rm \
  --read-only \
  --cap-drop ALL \
  --security-opt seccomp=default.json \
  --security-opt apparmor=docker-default \
  --memory=4g \
  --cpus=2 \
  --network none \
  codver-pi-node

# Verify no root access
docker exec codver-job-abc123 whoami
# codver (non-root user)

# Verify resource limits
docker stats codver-job-abc123
# CPU: 0.5% (limited to 2 cores)
# MEM: 1.2GB / 4GB (limited)

# Production deployment
# - Server runs behind Nginx reverse proxy
# - HTTPS with Let's Encrypt certificates
# - Auto-renewal configured
# - systemd service for auto-restart
# - Daily backups of SQLite database
# - Monitoring with Prometheus + Grafana

# Security checklist
# ✅ Non-root containers
# ✅ Resource limits enforced
# ✅ Read-only filesystem
# ✅ Network isolation
# ✅ Secrets not logged
# ✅ Input validation
# ✅ Rate limiting active
# ✅ Audit logging enabled
# ✅ HTTPS enforced
# ✅ Security headers configured
```

## Summary

This plan provides a comprehensive, phase-wise approach to building a remote AI execution server using the Pi agent. Each phase is:

- **Independent**: Can be developed and tested separately
- **Testable**: Has clear deliverables and validation steps
- **Runnable**: Produces working software at each phase
- **Shippable**: Can be deployed and used after each phase

### Key Technical Decisions

1. **Pi Agent**: Use SDK mode (`createAgentSession` + `runPrintMode`) for programmatic control
2. **Server**: Node.js + Express with HTTPS
3. **Client**: Node.js CLI with `commander.js`
4. **Sandboxing**: Docker with resource limits (gVisor optional)
5. **Storage**: SQLite via `better-sqlite3`
6. **PR Author**: Bot account (server's GitHub token) as default
7. **Docker Images**: Built dynamically per job, with server-side caching
8. **Authentication**: API key via `X-API-Key` header
9. **Job Queue**: In-memory for MVP, BullMQ in advanced phases
10. **Language Detection**: Heuristic first, AI fallback

### Next Steps

1. Review the [Architecture document](../architecture.md) for technical details
2. Follow phase documents in order
3. Test each phase thoroughly before moving to the next
4. Iterate based on real-world usage
