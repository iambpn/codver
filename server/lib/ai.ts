import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { loadPromptAsync } from "../prompts";
import { BASE_COMPOSE_PATH, BASE_DOCKERFILE_PATH, BASE_PROTOTOOLS_PATH, DEV_DOCKERFILE } from "./paths";
import { info, warn } from "./progress";
import { getProviderEnvForCompose } from "./security";
import type { CommitInfo } from "./types";

const AI_TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function handleSessionEvent(event: AgentSessionEvent, accumulator: { text: string }): void {
  if (event.type === "message_update" && "assistantMessageEvent" in event) {
    const msgEvent = event.assistantMessageEvent;
    if (msgEvent.type === "text_delta") {
      accumulator.text += msgEvent.delta;
    }
  }
}

async function runAiTask(
  prompt: string,
  cwd: string,
  model: Model<Api>,
  tools: string[] = ["read", "bash", "grep", "find", "ls"],
): Promise<string> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const sessionManager = SessionManager.inMemory(cwd);

  const { session } = await createAgentSession({
    cwd,
    model,
    authStorage,
    modelRegistry,
    sessionManager,
    tools,
  });

  const accumulator = { text: "" };
  let disposed = false;

  session.subscribe((event: AgentSessionEvent) => {
    handleSessionEvent(event, accumulator);
  });

  const safeDispose = () => {
    if (!disposed) {
      disposed = true;
      session.dispose();
    }
  };

  let timerId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      safeDispose();
      reject(new Error(`AI task timed out after ${AI_TASK_TIMEOUT_MS / 1000}s`));
    }, AI_TASK_TIMEOUT_MS);
  });

  const taskPromise = session.prompt(prompt);

  try {
    await Promise.race([taskPromise, timeoutPromise]);
  } finally {
    clearTimeout(timerId!);
    safeDispose();
  }

  return accumulator.text;
}

async function copyDockerfile(cwd: string): Promise<void> {
  const baseDockerfile = await Bun.file(BASE_DOCKERFILE_PATH).text();
  const dockerfilePath = path.join(cwd, DEV_DOCKERFILE);
  await Bun.write(dockerfilePath, baseDockerfile);
  info("Dockerfile written from base template (no AI modifications).");
}

async function generateComposeFile(cwd: string, provider: string): Promise<void> {
  const envVars = getProviderEnvForCompose(provider);
  const envVarLines = envVars.map((v: string) => `      - ${v}=\${${v}}`).join("\n");

  const baseCompose = await Bun.file(BASE_COMPOSE_PATH).text();
  const baseComposeRendered = baseCompose.replace("{{envVarLines}}", envVarLines);
  await Bun.write(path.join(cwd, "docker-compose.dev.yml"), baseComposeRendered);
}

async function copyPrototools(cwd: string): Promise<void> {
  const basePrototools = await Bun.file(BASE_PROTOTOOLS_PATH).text();
  await Bun.write(path.join(cwd, ".prototools.base"), basePrototools);
}

export async function generateDevCompose(cwd: string, provider: string): Promise<void> {
  info("Generating docker-compose.dev.yml using AI (agent modifies base template)...");
  await copyDockerfile(cwd);
  await generateComposeFile(cwd, provider);
  await copyPrototools(cwd);
}

export async function generateBranchName(prompt: string, model: Model<Api>): Promise<string> {
  info("Generating branch name from prompt using AI...");

  const branchPrompt = await loadPromptAsync("branch-name", { prompt: prompt.slice(0, 300) });

  const result = await runAiTask(branchPrompt, process.cwd(), model, []);

  // Clean up the branch name
  let branchName = result
    .trim()
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

export async function generateCommitMessage(cwd: string, model: Model<Api>, diffOutput: string): Promise<CommitInfo> {
  info("Generating commit message using AI...");

  const taskPrompt = await loadPromptAsync("commit-message", { diffOutput: diffOutput.slice(0, 8000) });
  const result = await runAiTask(taskPrompt, cwd, model, ["read", "bash"]);

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
  model: Model<Api>,
  commitMessages: string,
  diffSummary: string,
): Promise<CommitInfo> {
  info("Generating PR description using AI...");

  const taskPrompt = await loadPromptAsync("pr-description", {
    commitMessages,
    diffSummary: diffSummary.slice(0, 4000),
  });
  const result = await runAiTask(taskPrompt, cwd, model);

  const lines = result.trim().split("\n");
  let title = lines[0] || "Automated changes by codver";
  let body = lines.slice(1).join("\n").trim();

  title = title.replace(/^["`#]+|["`]+$/g, "").trim();
  body = body.replace(/^["`]+|["`]+$/g, "").trim();

  return { title, body };
}

export async function generateNoUpdateDoc(
  cwd: string,
  model: Model<Api>,
  agentOutput: string,
  taskPrompt: string,
): Promise<string> {
  info("Generating codver-no-update.md using AI...");

  const promptText = await loadPromptAsync("no-update-doc", {
    taskPrompt: taskPrompt.slice(0, 2000),
    agentOutput: agentOutput.slice(0, 6000),
  });
  const result = await runAiTask(promptText, cwd, model);

  let content = result.trim();
  content = content.replace(/^```markdown?\n?/i, "").replace(/\n?```\s*$/i, "");

  return content;
}

export async function generateDependencyInstallCommand(cwd: string, model: Model<Api>): Promise<string> {
  const prompt = await loadPromptAsync("dependency-install");
  const result = await runAiTask(prompt, cwd, model, ["read"]);

  try {
    // Handle both formats: `command: npm install` and `"command": "npm install"`
    const trimmed = result.trim();
    const match = trimmed.match(/^(?:"command"|command)\s*:\s*(.+)$/im);
    const extracted = match ? match[1].replace(/^["']|["']$/g, "").trim() : "";

    if (!extracted) {
      warn(`No command found in AI response, full response was:\n${result}`);
      return "";
    }
    return extracted;
  } catch {
    // If parsing fails, return empty string to indicate no command could be determined
    return "";
  }
}

export function buildModelName(model: Model<Api>): string {
  return `${model.provider}/${model.name}`;
}
