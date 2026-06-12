import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Determine the server package root directory
const serverRoot = path.resolve(__dirname, '../..');

// Try to load .env from the server app directory
const envPaths = [path.resolve(serverRoot, '.env')];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

function expandTilde(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_KEY_ADMIN_SECRET: z.string().min(1, 'Admin secret is required'),
  DATABASE_PATH: z.string().default('./data/codver.db'),
  CODVER_DEV_DIR: z.string().default(path.join(os.homedir(), '.codver-dev')),
  MAX_CONCURRENT_JOBS: z.string().default('3').transform(Number),
  JOB_RETENTION_DAYS: z.string().default('7').transform(Number),
  GITHUB_TOKEN: z.string().optional(),
  GIT_USER_NAME: z.string().optional(),
  GIT_USER_EMAIL: z.string().optional(),
  DEFAULT_CPU_LIMIT: z.string().default('2'),
  DEFAULT_MEMORY_LIMIT: z.string().default('4g'),
  DEFAULT_JOB_TIMEOUT_MS: z.string().default('1800000').transform(Number),
  DEFAULT_PR_AUTHOR: z.string().default('bot'),
  CLEANUP_ON_COMPLETE: z.string().default('true').transform((v) => v === 'true'),
  CLEANUP_IMAGES_ON_COMPLETE: z.string().default('false').transform((v) => v === 'true'),
  MAX_RETRY_COUNT: z.string().default('2').transform(Number),
  RETRY_BASE_DELAY_MS: z.string().default('5000').transform(Number),
  WEBHOOK_SECRET: z.string().optional(),
  DEFAULT_MODEL: z.string().optional(),
  DEFAULT_PROVIDER: z.string().optional(),
  DEFAULT_THINKING_LEVEL: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

// Collect all API keys dynamically from environment variables
const apiKeys: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.endsWith('_API_KEY') && value !== undefined) {
    apiKeys[key] = value;
  }
}

// Resolve relative paths against the server package root so they work regardless of cwd
const raw = parsed.data;
const expandedDevDir = expandTilde(raw.CODVER_DEV_DIR);

export const config = {
  ...raw,
  DATABASE_PATH: path.isAbsolute(raw.DATABASE_PATH)
    ? raw.DATABASE_PATH
    : path.resolve(serverRoot, raw.DATABASE_PATH),
  CODVER_DEV_DIR: path.isAbsolute(expandedDevDir)
    ? expandedDevDir
    : path.resolve(serverRoot, expandedDevDir),
  apiKeys,
};
