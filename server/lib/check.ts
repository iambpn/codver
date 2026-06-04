/**
 * Codver Check — Verify host dependencies, config, and provider API keys.
 *
 * Reports each section with pass/fail status, then exits non-zero if
 * anything failed. Does not run the full pipeline.
 */

import { Command } from "commander";
import { ValidationError } from "./cli";
import { checkDependencies } from "./dependencies";
import { loadConfig } from "./config";
import { getGlobalConfigPath } from "./paths";
import { validateEnvVars } from "./security";
import { PROVIDER_ENV_MAP } from "./types";
import { blankLine, error, heading, info, success, warn } from "./progress";
import { validateModel } from "./model-validation";

export interface CheckOptions {
  configPath?: string;
  model?: string;
  repo?: string;
}

export interface CheckResult {
  ok: boolean;
  failures: string[];
}

export function addCheckOptions(cmd: Command): Command {
  return cmd
    .option(
      "--config <path>",
      "Path to a config JSON file (default: ~/.config/codver/codver.config.json)",
    )
    .option(
      "--model <model>",
      "Model to validate (e.g., anthropic/claude-sonnet-4-20250514). Falls back to defaultModel from config.",
    )
    .option(
      "--repo <url>",
      "Repository URL to verify (e.g., https://github.com/owner/repo or owner/repo). Checks that the repo is accessible via git ls-remote.",
    );
}

/**
 * Pure aggregator: runs the checks and returns a structured result.
 * Used by runCheck and by tests.
 */
export async function runChecks(options: CheckOptions): Promise<CheckResult> {
  const failures: string[] = [];

  // ─── Phase 1: Host dependencies ───────────────────────────────────
  heading("Phase 1: Host Dependencies");
  try {
    await checkDependencies();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`Host dependencies: ${message}`);
  }

  // ─── Phase 2: Config file ─────────────────────────────────────────
  heading("Phase 2: Config File");

  let configSourceLabel: string;
  if (options.configPath) {
    configSourceLabel = options.configPath;
  } else {
    const globalPath = getGlobalConfigPath();
    const exists = await Bun.file(globalPath).exists();
    configSourceLabel = exists ? globalPath : `${globalPath} (not found)`;
  }
  info(`Source: ${configSourceLabel}`);

  let config: Awaited<ReturnType<typeof loadConfig>> = {};
  try {
    config = await loadConfig(options.configPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`Config file: ${message}`);
    blankLine();
    // Skip the rest if config is broken
    return { ok: failures.length === 0, failures };
  }

  if (!options.configPath) {
    const globalPath = getGlobalConfigPath();
    const exists = await Bun.file(globalPath).exists();
    if (!exists) {
      warn(`No global config found at ${globalPath}`);
      info(`  Run \`codver init\` to create a default config.`);
    } else {
      info("Loaded keys:");
      if (config.gitUserName) info(`  gitUserName: ${config.gitUserName}`);
      if (config.gitUserEmail) info(`  gitUserEmail: ${config.gitUserEmail}`);
      if (config.defaultModel) info(`  defaultModel: ${config.defaultModel}`);
      if (!config.gitUserName && !config.gitUserEmail && !config.defaultModel) {
        info("  (no keys set — file is empty)");
      }
    }
  } else {
    info("Loaded keys:");
    if (config.gitUserName) info(`  gitUserName: ${config.gitUserName}`);
    if (config.gitUserEmail) info(`  gitUserEmail: ${config.gitUserEmail}`);
    if (config.defaultModel) info(`  defaultModel: ${config.defaultModel}`);
  }

  // ─── Phase 3: Provider API keys ───────────────────────────────────
  heading("Phase 3: Provider API Keys");

  // Collect providers to check from both defaultModel and --model.
  // The pipeline can use two different models/providers (generative + agent),
  // so we must verify keys for every provider explicitly named via config or flag.
  const providersToCheck = new Map<string, string>(); // provider → source label
  const unknownWarnings: string[] = [];

  function collectProvider(raw: string, source: string): void {
    const slashIndex = raw.indexOf("/");
    if (slashIndex === -1) {
      // Shorthand without provider prefix — can't determine which provider
      // keys are needed. Model validation in Phase 4 will handle this case.
      return;
    }
    const provider = raw.slice(0, slashIndex);
    if (!PROVIDER_ENV_MAP[provider]) {
      unknownWarnings.push(`Unknown provider "${provider}" in ${source} ("${raw}").`);
      return;
    }
    if (!providersToCheck.has(provider)) {
      providersToCheck.set(provider, source);
    }
  }

  if (config.defaultModel) {
    collectProvider(config.defaultModel, "defaultModel");
  }
  if (options.model) {
    collectProvider(options.model, "--model");
  }

  if (providersToCheck.size === 0) {
    if (unknownWarnings.length > 0) {
      for (const w of unknownWarnings) {
        warn(w);
      }
      info(`  Known providers: ${Object.keys(PROVIDER_ENV_MAP).join(", ")}`);
    }
    if (!config.defaultModel && !options.model) {
      info("No model specified (no defaultModel in config and no --model flag).");
      info("  Skipping provider env-var check.");
      info("  (Provider keys are required when a model is selected at runtime.)");
    } else {
      info("Could not determine providers from model inputs — skipping provider env-var check.");
      info("  Model validation in Phase 4 will catch missing keys.");
    }
  } else {
    for (const [provider, source] of providersToCheck) {
      const requiredVars = PROVIDER_ENV_MAP[provider]!;
      info(`Provider: ${provider} (from ${source})`);
      const validation = validateEnvVars(provider);
      for (const key of requiredVars) {
        if (process.env[key]) {
          success(`${key}: present`);
        } else {
          error(`${key}: missing`);
        }
      }
      if (!validation.valid) {
        failures.push(
          `Provider keys: missing ${validation.missing.join(", ")} for provider "${provider}"`,
        );
      }
    }
    // Report unknown providers as warnings (non-fatal — Phase 4 will catch them)
    for (const w of unknownWarnings) {
      warn(w);
    }
    if (unknownWarnings.length > 0) {
      info(`  Known providers: ${Object.keys(PROVIDER_ENV_MAP).join(", ")}`);
    }
  }

  blankLine();

  // ─── Phase 4: Model Validation ────────────────────────────────────
  heading("Phase 4: Model Validation");

  const effectiveModel = options.model || config.defaultModel;

  if (!effectiveModel) {
    info("No model specified (no --model flag and no defaultModel in config).");
    info("  Skipping model validation.");
  } else {
    info(`Checking model: ${effectiveModel}`);
    try {
      await validateModel(effectiveModel);
      success(`Model "${effectiveModel}" is valid.`);
    } catch (err) {
      const message = err instanceof ValidationError ? err.message : String(err);
      failures.push(`Model validation: ${message}`);
    }
  }

  // ─── Phase 5: Repository Verification ──────────────────────────────
  if (options.repo) {
    heading("Phase 5: Repository Verification");
    const repoUrl = options.repo.trim();
    info(`Repository: ${repoUrl}`);

    try {
      await verifyRepoAccessible(repoUrl);
      success(`Repository "${repoUrl}" is accessible.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`Repository: ${message}`);
    }
  }

  blankLine();
  return { ok: failures.length === 0, failures };
}

/**
 * Normalize a repository URL into a form that `git ls-remote` can use.
 *
 * Handles:
 *   - Full URLs: https://github.com/owner/repo, git@github.com:owner/repo.git
 *   - Shorthand:   owner/repo → https://github.com/owner/repo
 */
function normalizeRepoUrl(raw: string): string {
  const trimmed = raw.trim();

  // Already a full URL or SCP-style git URL
  if (trimmed.includes("://") || trimmed.includes("@")) {
    return trimmed;
  }

  // owner/repo shorthand — assume GitHub
  if (trimmed.includes("/") && !trimmed.includes(" ") && !trimmed.includes("\\")) {
    return `https://github.com/${trimmed}`;
  }

  return trimmed;
}

/**
 * Verify that a repository URL is accessible without cloning it.
 *
 * Uses `git ls-remote` which is a lightweight check that validates:
 *   - The URL is well-formed
 *   - The repository exists
 *   - The user has at least read access (via gh auth, SSH keys, or HTTPS creds)
 */
async function verifyRepoAccessible(rawUrl: string): Promise<void> {
  const url = normalizeRepoUrl(rawUrl);

  const result = Bun.spawnSync(["git", "ls-remote", "--heads", url], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    const stdout = result.stdout.toString().trim();
    const detail = stderr || stdout || "unknown error";

    // Provide actionable hints based on common failure patterns
    if (detail.toLowerCase().includes("could not read from remote") ||
        detail.toLowerCase().includes("could not resolve host")) {
      throw new Error(
        `Cannot reach repository: ${url}\n` +
        `  ${detail}\n` +
        `  Check that the URL is correct and you are online.`,
      );
    }

    if (detail.toLowerCase().includes("repository not found") ||
        detail.toLowerCase().includes("not found")) {
      throw new Error(
        `Repository not found: ${url}\n` +
        `  ${detail}\n` +
        `  Verify the repository exists and the URL is correct.`,
      );
    }

    if (detail.toLowerCase().includes("permission") ||
        detail.toLowerCase().includes("access denied") ||
        detail.toLowerCase().includes("authentication") ||
        detail.toLowerCase().includes("could not read")) {
      throw new Error(
        `Access denied for repository: ${url}\n` +
        `  ${detail}\n` +
        `  Ensure you have access to this repository.\n` +
        `  For private repos, run \`gh auth login\` or configure SSH keys.`,
      );
    }

    // Generic failure — include all available detail
    throw new Error(
      `Failed to verify repository: ${url}\n` +
      `  ${detail}`,
    );
  }

  // Log available branches for visibility
  const branches = result.stdout.toString().trim().split("\n").filter(Boolean);
  const headBranches = branches
    .map((line) => line.split("\t")[1]?.replace("refs/heads/", ""))
    .filter((b): b is string => !!b);

  if (headBranches.length > 0) {
    const preview = headBranches.slice(0, 5).join(", ");
    const suffix = headBranches.length > 5 ? ` (+${headBranches.length - 5} more)` : "";
    info(`Remote branches: ${preview}${suffix}`);
  }
}

export async function runCheck(options: CheckOptions): Promise<void> {
  let result: CheckResult;
  try {
    result = await runChecks(options);
  } catch (err) {
    if (err instanceof ValidationError) {
      error(err.message);
    } else {
      error(`Check failed: ${err}`);
    }
    process.exit(1);
    return;
  }

  blankLine();
  if (!result.ok) {
    heading("Check Summary");
    for (const f of result.failures) {
      error(f);
    }
    blankLine();
    error(`Codver environment check FAILED (${result.failures.length} issue${result.failures.length === 1 ? "" : "s"}).`);
    process.exit(1);
  }

  heading("Check Summary");
  success("Codver environment check passed — ready to run.");
}
