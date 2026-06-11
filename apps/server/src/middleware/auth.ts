import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../database';
import { UnauthorizedError } from '../utils/errors';

export function authenticateApiKey(req: Request, _res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    return next(new UnauthorizedError('Missing X-API-Key header'));
  }

  const keyHash = hashKey(apiKey);
  const row = db
    .prepare('SELECT id FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { id: string } | undefined;

  if (!row) {
    return next(new UnauthorizedError('Invalid API key'));
  }

  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);

  next();
}

export function authenticateAdmin(req: Request, _res: Response, next: NextFunction): void {
  const adminSecret = req.headers['x-admin-secret'] as string | undefined;

  if (!adminSecret) {
    return next(new UnauthorizedError('Missing X-Admin-Secret header'));
  }

  const configSecret = process.env.API_KEY_ADMIN_SECRET;
  if (adminSecret !== configSecret) {
    return next(new UnauthorizedError('Invalid admin secret'));
  }

  next();
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
