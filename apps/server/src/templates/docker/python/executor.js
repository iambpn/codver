#!/usr/bin/env node

/**
 * Pi SDK Executor Script
 *
 * Runs the Pi agent using the Pi SDK inside a Docker container.
 * Reads prompt and model from environment variables.
 * Logs structured events to /workspace/.codver-pi-logs.jsonl
 * Exits with code 0 on success, 1 on failure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const prompt = process.env.PI_PROMPT || '';
const model = process.env.PI_MODEL || '';
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
        // Exclude Docker files added by Codver
        const excluded = ['Dockerfile', 'docker-compose.yml', 'executor.js', '.env'];
        return !excluded.includes(file);
      });
  } catch {
    return [];
  }
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
  const { createAgentSession } = require('@earendil-works/pi-coding-agent');

  const session = createAgentSession({
    prompt,
    model: model || undefined,
    workspace: '/workspace',
  });

  // Subscribe to events
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
