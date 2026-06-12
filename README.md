# Codver

A remote AI execution server that allows clients to submit coding tasks to a remote server, which uses the **Pi agent** to work on tasks inside **Docker sandboxes**, then automatically creates **GitHub pull requests** with the results.

## Goals

1. **Client Experience**: Easy-to-use CLI to submit coding tasks
2. **Server Reliability**: Robust job processing with error handling
3. **Security**: Sandboxed execution to contain untrusted code
4. **Automation**: Automatic PR creation with AI-generated metadata
5. **Scalability**: Support multiple concurrent jobs
6. **Observability**: Detailed logging and job tracking

## Architecture

```
Client (CLI) -> HTTP -> Server (API) -> Job Queue
                                        |
                                  Clone Repo
                                        |
                                Language Detection
                                        |
                              Generate Docker Setup
                                        |
                              Build Docker Image
                                        |
                              Run Container
                                        |
                            Pi Agent Executes Task
                                        |
                            Collect Results & Changes
                                        |
                            Create GitHub PR
                                        |
                            Cleanup Resources
```

## Monorepo Structure

```
codver/
├── apps/
│   ├── server/          # Node.js + Express API server
│   └── client/          # Node.js CLI tool (codver)
├── packages/
│   └── shared-types/    # Shared TypeScript interfaces
├── .docs/               # Implementation plan documentation
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- [pnpm](https://pnpm.io/) >= 9.0.0
- [Docker](https://docs.docker.com/get-docker/) (for sandboxed execution)
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and optionally authenticated

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure the server

```bash
cd apps/server
cp .env.example .env
```

Edit `apps/server/.env` and set the required variables:

```env
# Required: Admin secret for managing API keys
API_KEY_ADMIN_SECRET=your-admin-secret

# Required: GitHub token for private repo access and PR creation
GITHUB_TOKEN=ghp_your_token

# AI provider keys (at least one required)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
```

See `apps/server/.env.example` for the full list of available options.

### 3. Start the server

```bash
# Development mode (with hot reload)
pnpm dev:server

# Production mode
pnpm build
cd apps/server && pnpm start
```

The server starts on `http://localhost:3000` by default.

### 4. Create an API key

```bash
curl -X POST http://localhost:3000/api-keys \
  -H "X-Admin-Secret: your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-api-key"}'
```

The response contains the `key` value — save it for the CLI.

### 5. Configure the client

```bash
# Set the server URL
codver config set-server http://localhost:3000

# Set your API key
codver config set-key <your-api-key>

# Verify configuration
codver config view
```

## Usage

### Submit a job

```bash
codver run \
  --repo https://github.com/user/repo \
  --branch main \
  --prompt "Add a comprehensive README with usage examples"
```

Additional options:

```bash
codver run \
  --repo https://github.com/user/repo \
  --branch develop \
  --prompt "Fix the failing test in auth module" \
  --timeout 3600000 \
  --model claude-sonnet-4-20250514
```

### Check job status

```bash
codver status --job-id <job-id>
```

### Stream job logs

```bash
codver logs --job-id <job-id> --follow
```

### List all jobs

```bash
codver jobs list
```

## API Reference

All endpoints (except `/health` and `/metrics`) require an `X-API-Key` header.

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/health` | GET | None | Health check |
| `/metrics` | GET | None | Prometheus metrics |
| `/api-keys` | POST | Admin | Create an API key |
| `/jobs` | POST | API Key | Submit a job |
| `/jobs` | GET | API Key | List all jobs |
| `/jobs/:id` | GET | API Key | Get job details |
| `/jobs/:id/logs` | GET | API Key | Get job logs |
| `/jobs/:id/logs/stream` | GET | API Key | SSE log streaming |
| `/jobs/stats` | GET | API Key | Job statistics |
| `/stats` | GET | API Key | Aggregate stats |
| `/admin/queue` | GET | Admin | Queue status |
| `/admin/build-images` | POST | Admin | Pre-build Docker images |

### Submit a job via API

```bash
curl -X POST http://localhost:3000/jobs \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "https://github.com/user/repo",
    "branch": "main",
    "prompt": "Add error handling to the API endpoints"
  }'
```

### Stream logs via API

```bash
curl -N http://localhost:3000/jobs/<job-id>/logs/stream \
  -H "X-API-Key: your-api-key"
```

## Docker Deployment

```bash
# Build the image
docker build -f apps/server/Dockerfile -t codver-server .

# Run
docker run -d \
  -p 3000:3000 \
  -e API_KEY_ADMIN_SECRET=your-secret \
  -e GITHUB_TOKEN=ghp_xxx \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v codver-data:/app/data \
  codver-server
```

> The Docker socket mount is required because the server spawns Docker containers for sandboxed execution.

## Supported Languages

The server auto-detects the repository language and generates an appropriate Docker sandbox:

| Language | Package Manager | Auto-detected from |
|---|---|---|
| Node.js | npm / pnpm / yarn | `package.json` |
| Python | pip / poetry | `requirements.txt`, `pyproject.toml` |
| Rust | cargo | `Cargo.toml` |
| Go | go mod | `go.mod` |
| Java | maven / gradle | `pom.xml`, `build.gradle` |
| Ruby | bundler | `Gemfile` |
| PHP | composer | `composer.json` |
| Generic | — | Fallback |

## NPM Scripts

| Command | Description |
|---|---|
| `pnpm build` | Build all packages and apps |
| `pnpm dev:server` | Start server in dev mode (tsx watch) |
| `pnpm dev:client` | Run client CLI in dev mode |
| `pnpm lint` | Lint all packages |
| `pnpm test` | Run tests across all packages |
| `pnpm typecheck` | TypeScript type checking |

## License

MIT
