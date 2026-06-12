import { Router } from 'express';
import { db } from '../database';

const router: Router = Router();

router.get('/metrics', (_req, res) => {
  const total = (db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number }).c;
  const pending = (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'`).get() as { c: number }).c;
  const running = (
    db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status IN ('cloning', 'detecting_language', 'generating_docker', 'building_image', 'ready', 'running', 'creating_pr')`).get() as { c: number }
  ).c;
  const completed = (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'completed'`).get() as { c: number }).c;
  const failed = (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'`).get() as { c: number }).c;

  const uptime = process.uptime();
  const mem = process.memoryUsage();

  const lines = [
    `# HELP codver_jobs_total Total number of jobs`,
    `# TYPE codver_jobs_total gauge`,
    `codver_jobs_total ${total}`,
    `# HELP codver_jobs_pending Pending jobs`,
    `# TYPE codver_jobs_pending gauge`,
    `codver_jobs_pending ${pending}`,
    `# HELP codver_jobs_running Running jobs`,
    `# TYPE codver_jobs_running gauge`,
    `codver_jobs_running ${running}`,
    `# HELP codver_jobs_completed Completed jobs`,
    `# TYPE codver_jobs_completed gauge`,
    `codver_jobs_completed ${completed}`,
    `# HELP codver_jobs_failed Failed jobs`,
    `# TYPE codver_jobs_failed gauge`,
    `codver_jobs_failed ${failed}`,
    `# HELP codver_uptime_seconds Server uptime in seconds`,
    `# TYPE codver_uptime_seconds gauge`,
    `codver_uptime_seconds ${uptime.toFixed(0)}`,
    `# HELP codver_memory_rss_bytes Resident set size in bytes`,
    `# TYPE codver_memory_rss_bytes gauge`,
    `codver_memory_rss_bytes ${mem.rss}`,
    `# HELP codver_memory_heap_used_bytes Heap used in bytes`,
    `# TYPE codver_memory_heap_used_bytes gauge`,
    `codver_memory_heap_used_bytes ${mem.heapUsed}`,
    `# HELP codver_memory_heap_total_bytes Heap total in bytes`,
    `# TYPE codver_memory_heap_total_bytes gauge`,
    `codver_memory_heap_total_bytes ${mem.heapTotal}`,
  ];

  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n') + '\n');
});

export { router as metricsRouter };
