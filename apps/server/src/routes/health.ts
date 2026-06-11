import { Router, Request, Response } from 'express';
import packageJson from '../../package.json';

const router: Router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy', version: packageJson.version || '0.1.0' });
});

export { router as healthRouter };
