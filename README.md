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

## Monorepo Structure

```
codver/
├── .github/
│   └── workflows/
├── apps/
│   ├── server/          # Node.js + Express API server
│   └── client/          # Node.js CLI tool (codver)
├── packages/
│   └── shared-types/    # Shared TypeScript interfaces
├── docs/                # User-facing documentation
├── .docs/               # Implementation plan documentation
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- [pnpm](https://pnpm.io/) >= 9.0.0

## Setup

```bash
# Install dependencies
pnpm install

# Start the server in development mode
pnpm dev:server

# Start the client in development mode
pnpm dev:client
```

## Development Workflow

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages and apps |
| `pnpm dev:server` | Start the server in development mode |
| `pnpm dev:client` | Run the client CLI in development mode |
| `pnpm lint` | Lint all packages and apps |
| `pnpm test` | Run tests across all packages and apps |
| `pnpm typecheck` | Run TypeScript type checking |

### Workspace Dependencies

- **apps/server**: Express API server
- **apps/client**: Commander.js CLI
- **packages/shared-types**: Shared TypeScript types used by both server and client

## Testing

```bash
# Test the server health endpoint (requires API key)
curl http://localhost:3000/health
# 401 Unauthorized

# In production, HTTPS is handled by nginx reverse proxy

# Run the client CLI
pnpm dev:client
# Usage: codver [options] [command]

# Configure the client
codver config set-server http://localhost:3000
codver config set-key <your-api-key>
codver config view

# Test connection
codver status
# Connected to http://localhost:3000 (v0.1.0)

# Submit a job
codver run --repo https://github.com/user/repo --branch main --prompt "Add README"
# Job submitted: abc123

# Check job status
codver status --job-id abc123

# List jobs
codver jobs list

# View logs
codver logs --job-id abc123
```

## License

MIT
