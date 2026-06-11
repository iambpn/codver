import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../database';
import { hashKey } from '../middleware/auth';
import crypto from 'crypto';

const router: Router = Router();

router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body || {};

    const rawKey = 'codv_' + crypto.randomBytes(24).toString('hex');
    const keyHash = hashKey(rawKey);
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare('INSERT INTO api_keys (id, key_hash, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      keyHash,
      name || null,
      now,
      null,
    );

    res.status(201).json({
      success: true,
      data: { key: rawKey, id, name: name || null },
    });
  } catch (err) {
    next(err);
  }
});

export { router as apiKeysRouter };
