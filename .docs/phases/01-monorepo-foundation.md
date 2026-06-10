# Phase 1: Monorepo Foundation

**Goal:** A working pnpm monorepo with TypeScript tooling and basic project structure.

**Duration:** 1-2 days | **Complexity:** Low

## Objectives

1. Set up pnpm workspaces for monorepo management
2. Configure TypeScript for both server and client
3. Establish shared types package
4. Create basic project structure
5. Setup linting and formatting

## Tasks

### 1. Initialize Monorepo

**Root `package.json`**:
```json
{
  "name": "codver",
  "version": "0.1.0",
  "private": true,
  "description": "Remote AI execution server with Pi agent",
  "scripts": {
    "dev:server": "pnpm --filter @codver/server dev",
    "dev:client": "pnpm --filter @codver/client dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "clean": "pnpm -r clean"
  },
  "engines": {
    "node": ">=24.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

**`pnpm-workspace.yaml`**:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**`.gitignore`**:
```
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
build/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Runtime
*.pid
*.seed
*.pid.lock

# Coverage
coverage/
.nyc_output/

# Misc
.cache/
tmp/
```

### 2. Setup TypeScript

**Root `tsconfig.base.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

**Workspace `tsconfig.json` files** extend the base config.

### 3. Setup Linting & Formatting

**`.eslintrc.json`** (root):
```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "warn"
  }
}
```

**`.prettierrc`**:
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

### 4. Create Shared Types Package

**`packages/shared-types/package.json`**:
```json
{
  "name": "@codver/shared-types",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src --ext .ts",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**`packages/shared-types/src/index.ts`**:
```typescript
export interface JobRequest {
  repoUrl: string;
  branch?: string;
  prompt: string;
  promptFile?: string;
  images?: ImageAttachment[];
  model?: string;
  provider?: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  additionalFiles?: string[];
  webhookUrl?: string;
  timeout?: number;
  config?: JobConfig;
}

export interface ImageAttachment {
  filename: string;
  data: string; // base64
  mediaType: string;
}

export interface JobConfig {
  cpuLimit?: string;
  memoryLimit?: string;
  networkEnabled?: boolean;
  prAuthor?: 'bot' | 'user';
}

export interface JobResponse {
  jobId: string;
  status: JobStatus;
  createdAt: number;
}

export type JobStatus =
  | 'pending'
  | 'cloning'
  | 'ready'
  | 'building'
  | 'running'
  | 'extracting'
  | 'completed'
  | 'failed';

export interface JobDetails extends JobResponse {
  repoUrl: string;
  branch?: string;
  prompt: string;
  model?: string;
  prUrl?: string;
  errorMessage?: string;
  updatedAt: number;
  completedAt?: number;
  duration?: number;
}

export interface JobLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface ServerConfig {
  serverUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  defaultTimeout?: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
```

### 5. Initialize Server App

**`apps/server/package.json`**:
```json
{
  "name": "@codver/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts",
    "test": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@codver/shared-types": "workspace:*",
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "dotenv": "^16.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

**`apps/server/src/index.ts`**:
```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', version: '0.1.0' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### 6. Initialize Client App

**`apps/client/package.json`**:
```json
{
  "name": "@codver/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "codver": "./bin/codver.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "lint": "eslint src --ext .ts",
    "test": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@codver/shared-types": "workspace:*",
    "commander": "^11.1.0",
    "inquirer": "^9.2.0",
    "chalk": "^5.3.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/inquirer": "^9.0.0",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0"
  }
}
```

**`apps/client/bin/codver.js`**:
```javascript
#!/usr/bin/env node
import('../src/index.js').then((m) => m.run());
```

**`apps/client/src/index.ts`**:
```typescript
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('codver')
  .description('Remote AI execution server client')
  .version('0.1.0');

program
  .command('hello')
  .description('Test command')
  .action(() => {
    console.log(chalk.green('Hello from codver!'));
  });

program.parse(process.argv);

export function run() {
  program.parse(process.argv);
}
```

### 7. Documentation

**Root `README.md`**:
```markdown
# Codver

Remote AI execution server with Pi agent.

## Overview

Codver is a system that enables clients to submit coding tasks to a remote server, which uses the Pi agent to work on tasks inside Docker sandboxes, then automatically creates GitHub pull requests with the results.

## Project Structure

- `apps/server` - Server API and job processor
- `apps/client` - CLI client tool
- `packages/shared-types` - Shared TypeScript types

## Setup

```bash
# Install dependencies
pnpm install

# Start server
pnpm dev:server

# Start client (in another terminal)
pnpm dev:client
```

## Documentation

See `.docs/` directory for complete documentation.

## License

MIT
```

## Testing

### Manual Testing

```bash
# 1. Install dependencies
pnpm install

# 2. Start server
pnpm dev:server
# Expected output: Server running on http://localhost:3000

# 3. Test health endpoint
curl http://localhost:3000/health
# Expected: {"status":"healthy","version":"0.1.0"}

# 4. Start client
pnpm dev:client
# Expected: Usage: codver [options] [command]

# 5. Test client command
pnpm dev:client hello
# Expected: Hello from codver!
```

### Automated Tests

Create basic tests for shared types:

**`packages/shared-types/src/__tests__/types.test.ts`**:
```typescript
import { describe, it, expect } from 'vitest';
import type { JobRequest, JobStatus } from '../index.js';

describe('Shared Types', () => {
  it('should accept valid job request', () => {
    const request: JobRequest = {
      repoUrl: 'https://github.com/user/repo',
      branch: 'main',
      prompt: 'Add tests',
    };
    expect(request.repoUrl).toBe('https://github.com/user/repo');
  });
  
  it('should have valid job status', () => {
    const status: JobStatus = 'pending';
    expect(status).toBe('pending');
  });
});
```

## Validation Checklist

- [ ] `pnpm install` completes without errors
- [ ] `pnpm dev:server` starts server successfully
- [ ] `pnpm dev:client` shows CLI help
- [ ] `pnpm lint` passes for all packages
- [ ] `pnpm build` builds all packages
- [ ] Health endpoint returns 200 OK
- [ ] Client command executes successfully
- [ ] Shared types are importable in both apps
- [ ] TypeScript compilation succeeds
- [ ] ESLint passes with no errors

## Common Issues

**Issue**: `pnpm` not found  
**Solution**: Install pnpm globally: `npm install -g pnpm`

**Issue**: Workspace dependencies not resolving  
**Solution**: Run `pnpm install` from root directory

**Issue**: TypeScript errors in IDE  
**Solution**: Restart TypeScript server and run `pnpm install`

**Issue**: Port 3000 already in use  
**Solution**: Change `PORT` in `.env` file or kill the process using port 3000

## Next Phase

Proceed to [Phase 2: Server API Core](./02-server-api-core.md)
