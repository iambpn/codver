import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import YAML from "yaml";
import path from "node:path";
import type { CommitInfo } from "./types";
import { info, warn } from "./progress";
import { getProviderEnvForCompose } from "./security";
import { DEV_COMPOSE_FILE } from "./paths";
import { loadPromptAsync } from "../prompts";

let sessionCounter = 0;

const AI_TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function runAiTask(
  prompt: string,
  cwd: string,
  model: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- pi Model type varies by provider
  tools: string[] = ["read", "bash", "grep", "find", "ls"]
): Promise<string> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  sessionCounter++;
  const sessionManager = SessionManager.inMemory(cwd);

  const { session } = await createAgentSession({
    cwd,
    model,
    authStorage,
    modelRegistry,
    sessionManager,
    tools,
  });

  let result = "";
  let settled = false;
  session.subscribe((event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      result += event.assistantMessageEvent.delta;
    }
  });

  // Set up a timeout so we don't wait forever
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      if (!settled) {
        settled = true;
        session.dispose();
        reject(new Error(`AI task timed out after ${AI_TASK_TIMEOUT_MS / 1000}s`));
      }
    }, AI_TASK_TIMEOUT_MS);
  });

  const taskPromise = session.prompt(prompt)
    .catch((err: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!settled) {
        settled = true;
        throw err;
      }
    })
    .finally(() => {
      settled = true;
      session.dispose();
    });

  try {
    await Promise.race([taskPromise, timeoutPromise]);
  } catch (err) {
    if (!settled) {
      session.dispose();
    }
    warn(`AI task execution had issues: ${err}`);
  }

  return result;
}

function generateMinimalDevCompose(provider: string): string {
  const envVars = getProviderEnvForCompose(provider);
  const envVarLines = envVars.map((v: string) => `      - ${v}=\${${v}}`).join("\n");

  return `services:
  pi-agent:
    image: oven/bun:1
    working_dir: /workspace
    volumes:
      - ./:/workspace:rw
      - ./bunfig.toml:/root/.bunfig.toml:ro
    command: sh -c "bun install --frozen-lockfile 2>/dev/null || true; bun add -g @earendil-works/pi-coding-agent && pi --version"
    environment:
${envVarLines}
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - dev-network

networks:
  dev-network:
    driver: bridge
    internal: true
`;
}

export async function generateDevCompose(
  cwd: string,
  model: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  provider: string
): Promise<void> {
  info("Generating docker-compose.dev.yml using AI (agent writes file directly)...");

  const envVars = getProviderEnvForCompose(provider);
  const envVarLines = envVars.map((v: string) => `      - ${v}=\${${v}}`).join("\n");

  const prompt = await loadPromptAsync("dev-compose", { envVarLines });

  // The agent uses 'write' tool to create the file directly
  await runAiTask(prompt, cwd, model, ["read", "bash", "write"]);

  // Verify the file was created and is valid YAML
  const composePath = path.join(cwd, DEV_COMPOSE_FILE);

  try {
    const content = await Bun.file(composePath).text();
    if (!content || content.trim().length === 0) {
      warn("docker-compose.dev.yml was not created by the agent. Falling back to minimal compose file.");
      await Bun.write(composePath, generateMinimalDevCompose(provider));
      return;
    }

    // Try to parse it as YAML to validate
    try {
      const parsed = YAML.parse(content);
      if (!parsed || typeof parsed !== "object" || !parsed.services) {
        warn("AI-generated YAML has no 'services' key. Overwriting with minimal compose file.");
        await Bun.write(composePath, generateMinimalDevCompose(provider));
        return;
      }
      // Validate the pi-agent service exists
      if (!parsed.services["pi-agent"]) {
        warn("AI-generated compose is missing 'pi-agent' service. Overwriting with minimal compose file.");
        await Bun.write(composePath, generateMinimalDevCompose(provider));
        return;
      }
    } catch {
      warn("AI-generated YAML is invalid. Overwriting with minimal compose file.");
      await Bun.write(composePath, generateMinimalDevCompose(provider));
      return;
    }

    info("docker-compose.dev.yml verified successfully.");
  } catch {
    warn("docker-compose.dev.yml was not found. Falling back to minimal compose file.");
    await Bun.write(composePath, generateMinimalDevCompose(provider));
  }
}

export async function modifyGitignore(cwd: string, model: any): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
  info("Modifying .gitignore using AI...");

  const prompt = await loadPromptAsync("gitignore");

  await runAiTask(prompt, cwd, model, ["read", "write", "bash"]);

  // Read the result using Bun.file()
  try {
    const gitignorePath = `${cwd}/.gitignore`;
    const content = await Bun.file(gitignorePath).text();
    return content;
  } catch {
    return "";
  }
}

export async function generateBranchName(prompt: string, model: any): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
  info("Generating branch name from prompt using AI...");

  const branchPrompt = await loadPromptAsync("branch-name", { prompt: prompt.slice(0, 300) });

  const result = await runAiTask(branchPrompt, process.cwd(), model, []);

  // Clean up the branch name
  let branchName = result.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  if (!branchName) {
    branchName = `codver-${Date.now()}`;
  }

  return `codver/${branchName}`;
}

export async function generateCommitMessage(
  cwd: string,
  model: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  diffOutput: string
): Promise<CommitInfo> {
  info("Generating commit message using AI...");

  const taskPrompt = await loadPromptAsync("commit-message", { diffOutput: diffOutput.slice(0, 8000) });
  const result = await runAiTask(
    taskPrompt,
    cwd,
    model,
    ["read", "bash"]
  );

  // Parse title and body
  const lines = result.trim().split("\n");
  let title = lines[0] || "chore: automated codver changes";
  let body = lines.slice(1).join("\n").trim();

  // Clean up any markdown formatting
  title = title.replace(/^["`]+|["`]+$/g, "").trim();
  body = body.replace(/^["`]+|["`]+$/g, "").trim();

  // Ensure title is not too long
  if (title.length > 72) {
    title = title.slice(0, 69) + "...";
  }

  return { title, body };
}

export async function generatePRDescription(
  cwd: string,
  model: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  commitMessages: string,
  diffSummary: string
): Promise<CommitInfo> {
  info("Generating PR description using AI...");

  const taskPrompt = await loadPromptAsync("pr-description", {
    commitMessages,
    diffSummary: diffSummary.slice(0, 4000),
  });
  const result = await runAiTask(
    taskPrompt,
    cwd,
    model
  );

  const lines = result.trim().split("\n");
  let title = lines[0] || "Automated changes by codver";
  let body = lines.slice(1).join("\n").trim();

  title = title.replace(/^["`#]+|["`]+$/g, "").trim();
  body = body.replace(/^["`]+|["`]+$/g, "").trim();

  return { title, body };
}

export async function generateNoUpdateDoc(
  cwd: string,
  model: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  agentOutput: string,
  taskPrompt: string
): Promise<string> {
  info("Generating codver-no-update.md using AI...");

  const promptText = await loadPromptAsync("no-update-doc", {
    taskPrompt: taskPrompt.slice(0, 2000),
    agentOutput: agentOutput.slice(0, 6000),
  });
  const result = await runAiTask(
    promptText,
    cwd,
    model
  );

  let content = result.trim();
  content = content.replace(/^```markdown?\n?/i, "").replace(/\n?```\s*$/i, "");

  return content;
}