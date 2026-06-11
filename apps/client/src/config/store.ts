import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ClientConfig {
  serverUrl?: string;
  apiKey?: string;
}

const configDir = path.join(os.homedir(), '.codver');
const configPath = path.join(configDir, 'config.json');

export function readConfig(): ClientConfig {
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data) as ClientConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: ClientConfig): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function validateConfig(config: ClientConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.serverUrl) {
    errors.push('Server URL is not set. Run: codver config set-server <url>');
  }
  if (!config.apiKey) {
    errors.push('API key is not set. Run: codver config set-key <key>');
  }
  return { valid: errors.length === 0, errors };
}
