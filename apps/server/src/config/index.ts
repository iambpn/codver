import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_KEY_ADMIN_SECRET: z.string().min(1, 'Admin secret is required'),
  DATABASE_PATH: z.string().default('./data/codver.db'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

// Resolve relative paths against the server package root so they work regardless of cwd
const raw = parsed.data;
export const config = {
  ...raw,
  DATABASE_PATH: path.isAbsolute(raw.DATABASE_PATH)
    ? raw.DATABASE_PATH
    : path.resolve(serverRoot, raw.DATABASE_PATH),
};
