import { Request, Response, NextFunction } from 'express';
import { db } from '../database';

export function auditLog(eventType: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiKeyId = (req as any).apiKeyId as string | undefined;

      try {
        db.prepare(
          `INSERT INTO audit_logs (timestamp, event_type, api_key_id, method, path, status, duration, ip, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          Date.now(),
          eventType,
          apiKeyId || null,
          req.method,
          req.originalUrl,
          res.statusCode,
          duration,
          req.ip,
          req.get('user-agent') || null,
        );
      } catch {
        // Silently fail audit logging to not break requests
      }
    });

    next();
  };
}
