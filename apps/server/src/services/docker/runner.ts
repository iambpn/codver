import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logJobMessage } from '../queue/helpers';

interface RunContainerOptions {
  jobId: string;
  projectDir: string;
  imageName: string;
  containerName: string;
  timeoutMs?: number;
}

interface ContainerResult {
  success: boolean;
  exitCode: number;
  logs: string[];
  piEvents: PiEvent[];
  modifiedFiles: string[];
  error?: string;
}

export interface PiEvent {
  timestamp: number;
  level: string;
  message: string;
  [key: string]: unknown;
}

export async function runContainer(options: RunContainerOptions): Promise<ContainerResult> {
  const { jobId, projectDir, containerName, timeoutMs = 30 * 60 * 1000 } = options;
  const log = (level: 'info' | 'error' | 'warn' | 'debug', message: string) => {
    logJobMessage(jobId, level, message);
  };

  log('info', `Starting container: ${containerName}`);
  log('info', `Timeout: ${Math.round(timeoutMs / 1000 / 60)} minutes`);

  const logs: string[] = [];
  const piEvents: PiEvent[] = [];

  // Ensure log file doesn't exist from a previous run
  const piLogFile = path.join(projectDir, '.codver-pi-logs.jsonl');
  try {
    await fs.unlink(piLogFile);
  } catch {
    // File may not exist, ignore
  }

  return new Promise((resolve, reject) => {
    const composeArgs = ['-f', path.join(projectDir, 'docker-compose.yml'), 'up', '--abort-on-container-exit'];
    const proc = spawn('docker-compose', composeArgs, {
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let timedOut = false;

    const timeoutId = setTimeout(async () => {
      timedOut = true;
      log('error', 'Container timed out, forcing stop');
      try {
        await stopContainer(projectDir);
      } catch (stopErr) {
        log('warn', `Failed to stop container on timeout: ${String(stopErr)}`);
      }
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        const cleaned = line.replace(/^\s*\S+\s*\|\s*/, ''); // remove docker-compose prefix
        logs.push(cleaned);
        if (cleaned.includes('[pi]') || cleaned.includes('[error]') || cleaned.includes('[info]')) {
          log('info', `[container] ${cleaned}`);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        logs.push(line);
        log('error', `[container stderr] ${line}`);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to start docker-compose: ${err.message}`));
    });

    proc.on('close', async (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        log('error', 'Container was killed due to timeout');
      } else {
        log('info', `Container exited with code ${code}`);
      }

      // Read Pi SDK JSONL logs
      const readPiEvents = await readPiLogs(projectDir).catch((err) => {
        log('warn', `Failed to read Pi logs: ${String(err)}`);
        return [] as PiEvent[];
      });
      piEvents.push(...readPiEvents);

      // Extract modified files from the last pi event that contains them
      let modifiedFiles: string[] = [];
      for (let i = piEvents.length - 1; i >= 0; i--) {
        const ev = piEvents[i];
        if (Array.isArray(ev.modifiedFiles)) {
          modifiedFiles = ev.modifiedFiles;
          break;
        }
      }

      const success = !timedOut && code === 0;
      resolve({
        success,
        exitCode: timedOut ? -1 : (code ?? -1),
        logs,
        piEvents,
        modifiedFiles,
        error: timedOut ? 'Container timed out' : stderr || undefined,
      });
    });
  });
}

export async function stopContainer(projectDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-f', path.join(projectDir, 'docker-compose.yml'), 'down', '--volumes', '--remove-orphans'];
    const proc = spawn('docker-compose', args, {
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker-compose down failed: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run docker-compose down: ${err.message}`));
    });
  });
}

export async function getContainerStatus(containerName: string): Promise<string | null> {
  try {
    const proc = spawn('docker', ['ps', '-a', '--filter', `name=${containerName}`, '--format', '{{.Status}}'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      proc.on('close', resolve);
    });

    if (exitCode === 0 && stdout.trim()) {
      return stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export async function readPiLogs(projectDir: string): Promise<PiEvent[]> {
  const piLogFile = path.join(projectDir, '.codver-pi-logs.jsonl');
  let content: string;
  try {
    content = await fs.readFile(piLogFile, 'utf-8');
  } catch {
    return [];
  }

  const events: PiEvent[] = [];
  const lines = content.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as PiEvent;
      events.push(parsed);
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

export async function removeContainer(projectDir: string): Promise<void> {
  return new Promise((resolve) => {
    const args = ['-f', path.join(projectDir, 'docker-compose.yml'), 'rm', '-f', '-v'];
    const proc = spawn('docker-compose', args, {
      cwd: projectDir,
      stdio: 'ignore',
    });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}
