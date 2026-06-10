# Remote AI Execution Server - Documentation

This directory contains the complete implementation plan for the **Remote Pi Agent Execution Server** project.

## Overview

A system that enables clients to submit coding tasks to a remote server, which uses the **Pi agent** (https://pi.dev) to work on tasks inside **Docker sandboxes**, then automatically creates **GitHub pull requests** with the results.

## Project Highlights

- **Client**: Node.js CLI tool (`codver`)
- **Server**: Node.js + Express API with HTTPS
- **Sandbox**: Docker containers running Pi agent SDK
- **Storage**: SQLite for job state and logs
- **Integration**: GitHub CLI for PR creation
- **Security**: Resource limits, non-root containers, optional gVisor

## Documentation Index

### Core Documents
- [**Plan**](./plan.md) - Complete phase-wise implementation plan
- [**Architecture**](./architecture.md) - System architecture and design decisions

### Phase Documents
1. [**Phase 1: Monorepo Foundation**](./phases/01-monorepo-foundation.md) - Project setup and tooling
2. [**Phase 2: Server API Core**](./phases/02-server-api-core.md) - HTTPS, auth, SQLite
3. [**Phase 3: Client CLI**](./phases/03-client-cli.md) - CLI tool and configuration
4. [**Phase 4: Job Queue & GitHub**](./phases/04-job-queue-github.md) - Job processing and repo cloning
5. [**Phase 5: Language Detection & Docker**](./phases/05-language-detection-docker.md) - Template engine and image building
6. [**Phase 6: Pi SDK Execution**](./phases/06-pi-sdk-execution.md) - Agent execution in containers
7. [**Phase 7: PR Creation & Cleanup**](./phases/07-pr-creation-cleanup.md) - Success flow and cleanup
8. [**Phase 8: Error Handling**](./phases/08-error-handling.md) - Failure PRs and error reporting
9. [**Phase 9: Advanced Features**](./phases/09-advanced-features.md) - Images, files, monitoring
10. [**Phase 10: Security & Production**](./phases/10-security-production.md) - Hardening and deployment

## Quick Start

To understand the project:
1. Read the [Plan](./plan.md) for the complete vision
2. Review the [Architecture](./architecture.md) for technical details
3. Follow phase documents in order for implementation

## Key Decisions

- **AI Agent**: Pi (https://pi.dev) - [SDK Documentation](https://pi.dev/docs/latest/sdk)
- **Server**: Node.js + Express
- **Client**: Node.js CLI
- **Sandboxing**: Docker (with optional gVisor for enhanced security)
- **Storage**: SQLite via `better-sqlite3`
- **PR Author**: Bot account (server's GitHub token) as default
- **Docker Images**: Built dynamically per job, with server-side caching option
- **Authentication**: API key via `X-API-Key` header

## Timeline

| Phase | Duration | Complexity |
|-------|----------|------------|
| 1 | 1-2 days | Low |
| 2 | 2-3 days | Medium |
| 3 | 2-3 days | Medium |
| 4 | 3-4 days | Medium |
| 5 | 4-5 days | High |
| 6 | 4-5 days | High |
| 7 | 3-4 days | Medium |
| 8 | 2-3 days | Medium |
| 9 | 3-4 days | Medium |
| 10 | 3-4 days | Medium |
