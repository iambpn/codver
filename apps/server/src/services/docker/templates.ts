import fs from 'fs/promises';
import path from 'path';
import { DetectedLanguage } from '../language/detector';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../templates/docker');

export interface TemplateContext {
  imageName: string;
  containerName: string;
  projectDir: string;
  piPrompt: string;
  piModel?: string | null;
  cpuLimit?: string;
  memoryLimit?: string;
  apiKeys?: Record<string, string>;
}

export async function copyTemplateFiles(
  language: DetectedLanguage,
  targetDir: string,
): Promise<void> {
  const templateDir = path.join(TEMPLATES_ROOT, language);

  const files = ['Dockerfile', 'docker-compose.yml', 'executor.js'];

  for (const file of files) {
    const src = path.join(templateDir, file);
    const dest = path.join(targetDir, file);
    await fs.copyFile(src, dest);
  }
}

export async function generateDotEnv(
  targetDir: string,
  context: TemplateContext,
): Promise<void> {
  const envPath = path.join(targetDir, '.env');

  const lines = [
    `IMAGE_NAME=${context.imageName}`,
    `CONTAINER_NAME=${context.containerName}`,
    `PROJECT_DIR=${context.projectDir}`,
    `PI_PROMPT=${context.piPrompt.replace(/\n/g, '\\n').replace(/"/g, '\\"')}`,
    `PI_MODEL=${context.piModel || ''}`,
    `CPU_LIMIT=${context.cpuLimit || '2'}`,
    `MEMORY_LIMIT=${context.memoryLimit || '4g'}`,
  ];

  // Dynamically add all API keys from context
  for (const [key, value] of Object.entries(context.apiKeys || {})) {
    lines.push(`${key}=${value}`);
  }

  await fs.writeFile(envPath, lines.join('\n') + '\n');
}

export async function generateDockerCompose(
  targetDir: string,
  context: TemplateContext,
): Promise<void> {
  const templatePath = path.join(TEMPLATES_ROOT, 'generic', 'docker-compose.yml');
  let content = await fs.readFile(templatePath, 'utf-8');

  content = content.replace(/\${IMAGE_NAME}/g, context.imageName);
  content = content.replace(/\${CONTAINER_NAME}/g, context.containerName);
  content = content.replace(/\${PROJECT_DIR}/g, context.projectDir);
  content = content.replace(/\${PI_PROMPT}/g, context.piPrompt.replace(/\n/g, '\\n').replace(/"/g, '\\"'));
  content = content.replace(/\${PI_MODEL}/g, context.piModel || '');
  content = content.replace(/\${CPU_LIMIT}/g, context.cpuLimit || '2');
  content = content.replace(/\${MEMORY_LIMIT}/g, context.memoryLimit || '4g');
  const composePath = path.join(targetDir, 'docker-compose.yml');
  await fs.writeFile(composePath, content);
}

export function getImageName(language: DetectedLanguage, jobId: string): string {
  return `codver-pi-${language}:${jobId}`;
}

export function getLatestImageName(language: DetectedLanguage): string {
  return `codver-pi-${language}:latest`;
}

export function getContainerName(jobId: string): string {
  return `codver-job-${jobId}`;
}
