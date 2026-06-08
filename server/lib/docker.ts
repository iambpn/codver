import type { Api, Model } from "@earendil-works/pi-ai";
import path from "node:path";
import { generateDependencyInstallCommand } from "./ai";
import { DEV_COMPOSE_FILE, PLAN_FILE } from "./paths";
import { info, spinningStep, step, success, warn } from "./progress";
import { loadPromptAsync } from "../prompts";
import type { AgentResult } from "./types";

/**
 * Parse docker compose ps --format json output and check if all services are healthy.
 * Returns true if all services are running/healthy, false otherwise.
 */
function isServiceRunning(service: Record<string, unknown>): boolean {
  const state = service.State as string | undefined;
  const health = service.Health as string | undefined;
  const status = service.Status as string | undefined;
  return state === "running" || health === "healthy" || (status != null && status.includes("Up"));
}

function parseJsonLines(output: string): Record<string, unknown>[] {
  const lines = output.split("\n").filter((l: string) => l.trim().length > 0);
  const services: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      services.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
    }
  }
  return services;
}

function areServicesHealthy(output: string): boolean {
  const services = parseJsonLines(output);
  if (services.length > 0) {
    return services.every(isServiceRunning);
  }
  return output.includes("Up") || output.includes("running");
}

async function waitForHealthyServices(cwd: string): Promise<boolean> {
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;

  for (let attempt = 0; attempt < 60; attempt++) {
    const psResult = Bun.spawnSync(["docker", "compose", "-f", DEV_COMPOSE_FILE, "ps", "--format", "json"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (psResult.exitCode !== 0) {
      consecutiveFailures++;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        const errMsg = psResult.stderr.toString() || psResult.stdout.toString();
        warn(`Container health check failing consistently: ${errMsg}`);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    consecutiveFailures = 0;

    const output = psResult.stdout.toString().trim();
    if (output && areServicesHealthy(output)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

export async function composeUp(cwd: string): Promise<void> {
  return spinningStep("Starting Docker containers", async () => {
    // Build (or rebuild) images first to ensure the Dockerfile is current
    info("Building Docker images...");
    const buildResult = Bun.spawnSync(["docker", "compose", "-f", DEV_COMPOSE_FILE, "build"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (buildResult.exitCode !== 0) {
      const errMsg = buildResult.stderr.toString() || buildResult.stdout.toString();
      throw new Error(`Docker compose build failed: ${errMsg}`);
    }

    const result = Bun.spawnSync(["docker", "compose", "-f", DEV_COMPOSE_FILE, "up", "-d"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString() || result.stdout.toString();
      throw new Error(`Docker compose up failed: ${errMsg}`);
    }

    info("Containers started, waiting for services to be ready...");
    const healthy = await waitForHealthyServices(cwd);
    if (!healthy) {
      warn("Services may not be fully healthy yet, proceeding anyway...");
    } else {
      success("All services are up and running");
    }
  });
}

async function writePlanFile(cwd: string, promptContent: string): Promise<string> {
  const planFilePath = path.join(cwd, PLAN_FILE);
  const wrappedPrompt = await loadPromptAsync("agent-task", { task: promptContent });
  await Bun.write(planFilePath, wrappedPrompt);
  return planFilePath;
}

async function cleanupPlanFile(planFilePath: string): Promise<void> {
  try {
    await Bun.file(planFilePath).unlink();
  } catch {
    // File may already be removed or inaccessible, ignore
  }
}

async function executeDockerAgent(
  cwd: string,
  model: string,
  timeoutMs: number,
): Promise<{
  result: { exitCode: number | null; stdout: { toString(): string }; stderr: { toString(): string } };
  elapsed: number;
}> {
  const command = `cat ${PLAN_FILE} | pi -p --model "$MODEL" --no-context-files`;
  const startTime = Date.now();

  const result = Bun.spawnSync(
    ["docker", "compose", "-f", DEV_COMPOSE_FILE, "exec", "-e", `MODEL=${model}`, "pi-agent", "sh", "-c", command],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const elapsed = Date.now() - startTime;
  if (elapsed > timeoutMs) {
    warn(`Agent execution exceeded timeout of ${timeoutMs / 1000}s`);
  }
  return { result, elapsed };
}

export async function installDependency(
  cwd: string,
  workerModel: Model<Api>,
): Promise<{ error: string; code: number } | void> {
  // install dependency
  info("Generating dependency install command using AI...");
  const depInstallCommand = await generateDependencyInstallCommand(cwd, workerModel);

  if (!depInstallCommand || depInstallCommand.trim().length === 0) {
    info("No dependency install command generated, skipping installation.");
    return;
  }

  info(`Installing dependencies in dev container with command: ${depInstallCommand}`);
  const installResult = Bun.spawnSync([
    "docker",
    "compose",
    "-f",
    DEV_COMPOSE_FILE,
    "exec",
    "pi-agent",
    "sh",
    "-c",
    depInstallCommand,
  ], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (installResult.exitCode !== 0) {
    const errMsg = installResult.stderr.toString() || installResult.stdout.toString();
    warn(`Dependency installation had issues: ${errMsg}`);
    return { error: errMsg, code: installResult.exitCode ?? 1 };
  }
  success("Dependencies installed successfully");
}

export async function composeRunAgent(
  cwd: string,
  promptContent: string,
  model: string,
  timeoutMs: number = 30 * 60 * 1000,
): Promise<AgentResult> {
  return spinningStep("Running pi agent task", async () => {
    const planFilePath = await writePlanFile(cwd, promptContent);
    info(`Prompt written to ${planFilePath}`);
    info(`Executing pi agent with model: ${model}`);

    const { result, elapsed } = await executeDockerAgent(cwd, model, timeoutMs);
    info(`Agent execution took ${(elapsed / 1000).toFixed(1)}s`);

    const output = result.stdout.toString() + result.stderr.toString();
    if (result.exitCode !== 0) {
      warn(`Agent exited with code ${result.exitCode}`);
      if (output.length > 0) {
        info(`Agent output (last 2000 chars): ${output.slice(-2000)}`);
      }
    } else {
      success("Agent task completed");
    }

    return { exitCode: result.exitCode ?? 1, output };
  });
}

export async function composeDown(cwd: string): Promise<void> {
  return step("Stopping Docker containers", async () => {
    const result = Bun.spawnSync(
      ["docker", "compose", "-f", DEV_COMPOSE_FILE, "down", "-v", "--remove-orphans", "--rmi", "local"],
      { cwd, stdout: "pipe", stderr: "pipe" },
    );

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString() || result.stdout.toString();
      warn(`Docker compose down had issues: ${errMsg}`);
    } else {
      success("Containers stopped and cleaned up");
    }
  });
}

export async function composePull(cwd: string): Promise<void> {
  return spinningStep("Pulling Docker images", async () => {
    const result = Bun.spawnSync(["docker", "compose", "-f", DEV_COMPOSE_FILE, "pull"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString() || result.stdout.toString();
      throw new Error(`Docker compose pull failed: ${errMsg}`);
    }
  });
}
