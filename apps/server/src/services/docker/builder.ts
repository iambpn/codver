import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { DetectedLanguage } from '../language/detector';
import { logJobMessage } from '../queue/helpers';
import { getImageName, getLatestImageName } from './templates';

export async function checkImageExists(imageName: string): Promise<boolean> {
  try {
    const proc = spawn('docker', ['images', '-q', imageName], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      proc.on('close', resolve);
    });

    return exitCode === 0 && stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function tagImage(sourceImage: string, targetImage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['tag', sourceImage, targetImage], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker tag failed with code ${code}`));
      }
    });
  });
}

export async function buildDockerImage(
  jobId: string,
  language: DetectedLanguage,
  projectDir: string,
): Promise<string> {
  const imageName = getImageName(language, jobId);
  const latestImage = getLatestImageName(language);

  // Check if latest cached image exists
  const hasLatest = await checkImageExists(latestImage);

  if (hasLatest) {
    logJobMessage(jobId, 'info', `Cached image found: ${latestImage}, tagging for job`);
    await tagImage(latestImage, imageName);
    return imageName;
  }

  logJobMessage(jobId, 'info', `Building Docker image: ${imageName}`);

  const dockerfilePath = path.join(projectDir, 'Dockerfile');

  try {
    await fs.access(dockerfilePath);
  } catch {
    throw new Error(`Dockerfile not found in ${projectDir}`);
  }

  await runDockerBuild({
    jobId,
    imageName,
    contextDir: projectDir,
    logFn: (level, message) => logJobMessage(jobId, level, message),
  });

  logJobMessage(jobId, 'info', `Docker image built: ${imageName}`);
  return imageName;
}

interface BuildOptions {
  jobId: string;
  imageName: string;
  contextDir: string;
  logFn?: (level: 'info' | 'error' | 'warn' | 'debug', message: string) => void;
}

function runDockerBuild(options: BuildOptions): Promise<void> {
  const { jobId, imageName, contextDir, logFn } = options;
  const log = logFn || ((level, message) => console.log(`[${jobId}] [${level}] ${message}`));

  return new Promise((resolve, reject) => {
    const args = ['build', '-t', imageName, '-f', path.join(contextDir, 'Dockerfile'), contextDir];
    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Log build progress
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        if (line.includes('Step') || line.includes('ERROR')) {
          log('debug', `[docker build] ${line.trim()}`);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        log('debug', `[docker build] ${line.trim()}`);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`docker build failed with code ${code}: ${stderr || stdout}`);
        reject(error);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start docker build: ${err.message}`));
    });
  });
}

export async function buildLatestImage(language: DetectedLanguage): Promise<string> {
  const latestImage = getLatestImageName(language);
  const templateDir = path.resolve(__dirname, '../../templates/docker', language);

  const hasLatest = await checkImageExists(latestImage);
  if (hasLatest) {
    return latestImage;
  }

  await runDockerBuild({
    jobId: `admin-${language}`,
    imageName: latestImage,
    contextDir: templateDir,
    logFn: (_level, message) => console.log(`[admin-${language}] ${message}`),
  });

  return latestImage;
}

export const SUPPORTED_LANGUAGES: DetectedLanguage[] = ['node', 'python', 'rust', 'go', 'generic'];
