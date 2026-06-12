import { Router, Request, Response } from 'express';
import packageJson from '../../package.json';
import { getQueueStatus } from '../services/queue';

const router: Router = Router();

router.get('/', (_req: Request, res: Response) => {
  const queueStatus = getQueueStatus();
  res.status(200).json({
    status: 'healthy',
    version: packageJson.version || '0.1.0',
    queue: queueStatus,
  });
});

export { router as healthRouter };
