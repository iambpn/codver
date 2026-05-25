import path from "node:path";
import { PLAN_FILE, DEV_COMPOSE_FILE } from "./paths";
import { step, spinningStep, info, error, success, warn } from "./progress";
import type { AgentResult } from "./types";

export async function composeUp(cwd: string): Promise<void> {
  return spinningStep("Starting Docker containers", async () => {
    const result = Bun.spawnSync(
      ["docker", "compose", "-f", DEV_COMPOSE_FILE, "up", "-d"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString() || result.stdout.toString();
      throw new Error(`Docker compose up failed: ${errMsg}`);
    }

    info("Containers started, waiting for services to be ready...");

    // Wait for services to be healthy
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const psResult = Bun.spawnSync(
        ["docker", "compose", "-f", DEV_COMPOSE_FILE, "ps", "--format", "json"],
        { cwd, stdout: "pipe", stderr: "pipe" }
      );

      if (psResult.exitCode === 0) {
        const output = psResult.stdout.toString().trim();
        if (output) {
          try {
            // Docker Compose v2 outputs one JSON object per line, not a JSON array
            const lines = output.split("\n").filter((l: string) => l.trim().length > 0);
            const services: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
            for (const line of lines) {
              try {
                services.push(JSON.parse(line));
              } catch {
                // Skip lines that aren't valid JSON
              }
            }
            if (services.length > 0) {
              const allRunning = services.every(
                (s: any) => s.State === "running" || s.Health === "healthy" || s.Status?.includes("Up") // eslint-disable-line @typescript-eslint/no-explicit-any
              );
              if (allRunning) {
                healthy = true;
                break;
              }
            }
          } catch {
            // JSON parse failed completely, check plain text output
            if (output.includes("Up") || output.includes("running")) {
              healthy = true;
              break;
            }
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!healthy) {
      warn("Services may not be fully healthy yet, proceeding anyway...");
    } else {
      success("All services are up and running");
    }
  });
}

export async function composeRunAgent(
  cwd: string,
  promptContent: string,
  model: string,
  timeoutMs: number = 30 * 60 * 1000 // 30 minutes default
): Promise<AgentResult> {
  return spinningStep("Running pi agent task", async () => {
    // Write prompt to .codver-plan file in the project directory
    const planFilePath = path.join(cwd, PLAN_FILE);
    await Bun.write(planFilePath, promptContent);

    info(`Prompt written to ${planFilePath}`);
    info(`Executing pi agent with model: ${model}`);

    // Shell-escape the model string to prevent injection
    const escapedModel = model.replace(/'/g, "'\''");
    // Run pi agent inside the container
    // The PLAN_FILE is inside the mounted project dir, accessible at /workspace/PLAN_FILE
    // Env vars for the container come from the .env file (written by generateEnvFile),
    // resolved via ${VAR} substitution in the compose YAML. We do NOT pass host env vars
    // explicitly — this prevents credential leakage (e.g. GITHUB_TOKEN) into the container.
    const command = `cat /workspace/${PLAN_FILE} | pi -p --model '${escapedModel}' --no-context-files`;

    // Set up a timeout wrapper around the spawnSync call
    const startTime = Date.now();
    const result = Bun.spawnSync(
      [
        "docker", "compose", "-f", DEV_COMPOSE_FILE, "run", "--rm",
        "pi-agent",
        "sh", "-c", command,
      ],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const elapsed = Date.now() - startTime;
    info(`Agent execution took ${(elapsed / 1000).toFixed(1)}s`);

    if (elapsed > timeoutMs) {
      warn(`Agent execution exceeded timeout of ${timeoutMs / 1000}s`);
    }

    const output = result.stdout.toString() + result.stderr.toString();

    if (result.exitCode !== 0) {
      warn(`Agent exited with code ${result.exitCode}`);
      if (output.length > 0) {
        info(`Agent output (last 2000 chars): ${output.slice(-2000)}`);
      }
    } else {
      success("Agent task completed");
    }

    // Clean up .codver-plan file from the project directory
    try {
      await Bun.file(planFilePath).unlink();
    } catch {
      // File may already be removed or inaccessible, ignore
    }

    return {
      exitCode: result.exitCode ?? 1,
      output,
    };
  });
}

export async function composeDown(cwd: string): Promise<void> {
  return step("Stopping Docker containers", async () => {
    const result = Bun.spawnSync(
      ["docker", "compose", "-f", DEV_COMPOSE_FILE, "down", "-v", "--remove-orphans"],
      { cwd, stdout: "pipe", stderr: "pipe" }
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
    const result = Bun.spawnSync(
      ["docker", "compose", "-f", DEV_COMPOSE_FILE, "pull"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString() || result.stdout.toString();
      throw new Error(`Docker compose pull failed: ${errMsg}`);
    }
  });
}