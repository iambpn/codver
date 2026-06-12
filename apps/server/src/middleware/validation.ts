import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BadRequestError } from '../utils/errors';

const FORBIDDEN_PATTERNS = [
  /\.\.\//,
  /\$\(/,
  /`/,
  /;/,
  /\|/,
  /&/,
  /\brm\b/,
  /\beval\b/,
  /\bexec\b/,
  /\0/,
];

export function validateRequest(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      return next(new BadRequestError(`Invalid request: ${issues}`));
    }
    next();
  };
}

export function sanitizeString(input: string): string {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(input)) {
      throw new BadRequestError(`Input contains forbidden pattern: ${pattern}`);
    }
  }
  return input.replace(/\0/g, '');
}

export function validateRepoUrl(url: string): boolean {
  const pattern = /^https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\.git)?$/;
  return pattern.test(url);
}
