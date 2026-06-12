#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const prompt = process.env.PI_PROMPT || '';
const model = process.env.PI_MODEL || '';
const provider = process.env.PI_PROVIDER || '';
const thinkingLevel = process.env.PI_THINKING_LEVEL || '';
const imagesRaw = process.env.PI_IMAGES || '';
const customEnvVars = process.env.CUSTOM_ENV_VARS || '';
const logFile = path.join('/workspace', '.codver-pi-logs.jsonl');

function logEvent(level, message, data = {}) {
  const entry = {
    timestamp: Date.now(),
    level,
    message,
    ...data,
  };
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logFile, line);
  console.log(`[${level}] ${message}`);
}

function getModifiedFiles() {
  try {
    const output = execSync('git status --short', { cwd: '/workspace', encoding: 'utf-8' });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(/\s+/).pop())
      .filter((file) => {
        const excluded = ['Dockerfile', 'docker-compose.yml', 'executor.js', '.env'];
        return !excluded.includes(file);
      });
  } catch {
    return [];
  }
}

function parseImages() {
  if (!imagesRaw) return [];
  try {
    const images = JSON.parse(imagesRaw);
    if (Array.isArray(images)) {
      return images.map((img) => ({
        filename: img.filename || 'unknown',
        data: img.data || '',
        mediaType: img.mediaType || 'image/png',
      }));
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

function parseCustomEnvVars() {
  if (!customEnvVars) return {};
  try {
    return JSON.parse(customEnvVars);
  } catch {
    return {};
  }
}

function buildEnhancedPrompt(images) {
  let enhancedPrompt = prompt;

  if (images.length > 0) {
    enhancedPrompt += '\n\nAttached images:\n';
    for (const img of images) {
      enhancedPrompt += `- ${img.filename} (${img.mediaType})\n`;
    }
  }

  if (thinkingLevel) {
    enhancedPrompt += `\n\nThinking level: ${thinkingLevel}`;
  }

  return enhancedPrompt;
}

async function runMockAgent() {
  logEvent('info', 'Pi SDK not available; running mock agent');
  logEvent('info', 'Analyzing project structure...');
  await new Promise((r) => setTimeout(r, 500));
  logEvent('info', 'Reading files...');
  await new Promise((r) => setTimeout(r, 500));
  logEvent('info', 'Making changes...');
  await new Promise((r) => setTimeout(r, 500));
  logEvent('info', 'Agent completed (mock mode)');
}

async function runPiSdkAgent() {
  const { createAgentSession, ImageContent } = require('@earendil-works/pi-coding-agent');

  const images = parseImages();
  const enhancedPrompt = buildEnhancedPrompt(images);

  logEvent('info', `Creating session with model: ${model || 'default'}, provider: ${provider || 'default'}`);

  const sessionConfig = {
    prompt: enhancedPrompt,
    model: model || undefined,
    workspace: '/workspace',
  };

  if (provider) {
    sessionConfig.provider = provider;
  }

  const session = createAgentSession(sessionConfig);

  session.on('event', (event) => {
    if (event.type === 'tool_call') {
      const tool = event.tool || event.name || 'unknown';
      const args = event.args || event.arguments || {};
      const file = args.file || args.path || '';
      logEvent('info', `[pi] ${tool}: ${file}`, { eventType: event.type, tool, args });
    } else if (event.type === 'message') {
      logEvent('info', `[pi] ${event.content || event.message || ''}`, { eventType: event.type });
    } else if (event.type === 'error') {
      logEvent('error', `[pi] ${event.message || event.error || ''}`, { eventType: event.type });
    } else {
      logEvent('debug', `[pi] ${JSON.stringify(event)}`, { eventType: event.type });
    }
  });

  logEvent('info', 'Running Pi agent in print mode...');
  await session.runPrintMode();
  logEvent('info', 'Pi agent session completed');
}

async function main() {
  logEvent('info', 'Pi Agent executor starting');
  logEvent('info', `Prompt length: ${prompt.length} chars`);
  logEvent('info', `Model: ${model || 'default'}`);
  logEvent('info', `Provider: ${provider || 'default'}`);
  logEvent('info', `Thinking level: ${thinkingLevel || 'default'}`);

  const images = parseImages();
  logEvent('info', `Images attached: ${images.length}`);

  const customEnv = parseCustomEnvVars();
  if (Object.keys(customEnv).length > 0) {
    logEvent('info', `Custom env vars: ${Object.keys(customEnv).join(', ')}`);
  }

  try {
    let usingSdk = false;
    try {
      await runPiSdkAgent();
      usingSdk = true;
    } catch (sdkErr) {
      if (sdkErr.message && sdkErr.message.includes('Cannot find module')) {
        logEvent('warn', 'Pi SDK not installed, falling back to mock agent');
        await runMockAgent();
      } else {
        throw sdkErr;
      }
    }

    const modifiedFiles = getModifiedFiles();
    logEvent('info', 'Modified files detected', { modifiedFiles, count: modifiedFiles.length });
    logEvent('info', 'Agent completed successfully', { sdk: usingSdk });
    process.exit(0);
  } catch (err) {
    logEvent('error', 'Agent execution failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

main();
