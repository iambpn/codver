import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Centralized path constants for all directories and files created by Codver.
 *
 * Use these constants everywhere instead of hardcoding paths so that
 * adding/removing/relocating output artifacts only requires editing this file.
 */

// ─── Home-level directories ────────────────────────────────────────

/** Root working directory for Codver (under $HOME). */
export const CODVER_HOME_DIR = path.join(os.homedir(), ".codver-dev");

/**
 * Get the global config file path.
 * Resolves dynamically to respect HOME environment variable overrides
 * (important for testability).
 */
export function getGlobalConfigPath(): string {
  const home = process.env.HOME || os.homedir();
  return path.join(home, ".config", "codver", "codver.config.json");
}

/** Path to the global config file (computed at module load). */
export const CODVER_CONFIG_PATH = getGlobalConfigPath();

// ─── Per-repo working directory pattern ────────────────────────────

/**
 * Build a per-repo working directory path.
 * Format: ~/.codver-dev/<repoName>-<timestamp>
 */
export function getRepoDir(repoName: string, timestamp: number): string {
  return path.join(CODVER_HOME_DIR, `${repoName}-${timestamp}`);
}

// ─── Codver docker templates (inside the server package) ──────────

/** Directory containing base Dockerfile and compose templates. */
export const DOCKER_TEMPLATES_DIR = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "docker",
  "js"
);

/** Base Dockerfile for the codver dev environment. */
export const BASE_DOCKERFILE_PATH = path.join(DOCKER_TEMPLATES_DIR, "Dockerfile.base");

/** Base .prototools for the codver dev environment. */
export const BASE_PROTOTOOLS_PATH = path.join(DOCKER_TEMPLATES_DIR, ".prototools.base");

/** Base docker-compose.dev.yml template. */
export const BASE_COMPOSE_PATH = path.join(DOCKER_TEMPLATES_DIR, "docker-compose.dev.base.yml");

// ─── Dev-environment files (created inside each repo clone) ───────

/** Docker Compose override created by the AI generator. */
export const DEV_COMPOSE_FILE = "docker-compose.dev.yml";

/** Project-specific Dockerfile created by the AI generator. */
export const DEV_DOCKERFILE = "Dockerfile";

/** Base .prototools copied to project dir for Docker build context. */
export const PROTOTOOLS_BASE = ".prototools.base";

/** Bun configuration for the container. */
export const BUNFIG_FILE = "bunfig.toml";

/** Environment file for docker-compose (contains API keys). */
export const ENV_FILE = ".env";

/** Temporary agent-plan file written to the project dir before execution. */
export const PLAN_FILE = ".codver-plan";

/** Temporary PR body file written to the project dir during PR creation. */
export const PR_BODY_FILE = ".codver-pr-body.md";

/** No-update report written when the agent finds no code changes. */
export const NO_UPDATE_FILE = "codver-no-update.md";

/** Error report written when the pipeline encounters an error. */
export const ERROR_REPORT_FILE = "codver-error-report.md";

/**
 * All transient / generated filenames that Codver writes inside a repo clone.
 * Used for:
 *   - filtering dev files out of git change detection
 *   - cleanup operations
 */
export const DEV_FILES: readonly string[] = [
  DEV_COMPOSE_FILE,
  DEV_DOCKERFILE,
  BUNFIG_FILE,
  ENV_FILE,
  PLAN_FILE,
  PROTOTOOLS_BASE,
] as const;

// ─── Gitignore entries (kept in sync with DEV_FILES) ───────────────

export const GITIGNORE_ENTRIES: readonly string[] = [
  "# Codver dev environment",
  ...DEV_FILES,
] as const;

// ─── Cleanup helpers ──────────────────────────────────────────────

/**
 * All top-level directories that Codver creates outside the repo clone
 * (currently just CODVER_HOME_DIR, but listed here for extensibility).
 */
export const CODVER_MANAGED_DIRS: readonly string[] = [
  CODVER_HOME_DIR,
] as const;

/**
 * Resolve the global config directory and ensure it exists.
 * Creates ~/.config if it doesn't exist.
 */
export async function ensureConfigDir(): Promise<string> {
  const home = process.env.HOME || os.homedir();
  const configDir = path.join(home, ".config");
  if (!(await Bun.file(configDir).exists())) {
    await mkdir(configDir, { recursive: true });
  }
  return configDir;
}

/**
 * Ensure the full global config directory exists (creates both ~/.config
 * and ~/.config/codver). Returns the absolute path to ~/.config/codver.
 */
export async function ensureGlobalConfigDir(): Promise<string> {
  const home = process.env.HOME || os.homedir();
  const configDir = path.join(home, ".config");
  if (!(await Bun.file(configDir).exists())) {
    await mkdir(configDir, { recursive: true });
  }
  const globalConfigDir = path.join(home, ".config", "codver");
  if (!(await Bun.file(globalConfigDir).exists())) {
    await mkdir(globalConfigDir, { recursive: true });
  }
  return globalConfigDir;
}

/**
 * All top-level file patterns that Codver creates inside a repo clone,
 * expressed as relative paths safe for glob/rimraf patterns.
 */
export const CODVER_REPO_PATTERNS: readonly string[] = [
  ...DEV_FILES,
  PR_BODY_FILE,
  NO_UPDATE_FILE,
  ERROR_REPORT_FILE,
] as const;

/**
 * Files and patterns to exclude from `git add` pathspecs.
 *
 * Includes:
 *   - All Codver-generated repo files (DEV_FILES, PR body, reports)
 *   - Standard .gitignore entries so they are never accidentally staged
 *     even if the target repo's .gitignore is missing or incomplete.
 */
export const GIT_STAGING_EXCLUSIONS: readonly string[] = [
  // Codver-generated files
  ...CODVER_REPO_PATTERNS,
  // Standard .gitignore entries (mirrors the project's own .gitignore)
  "node_modules",
  "out",
  "dist",
  "*.tgz",
  "coverage",
  "*.lcov",
  "logs",
  "*.log",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
  ".env.local",
  ".eslintcache",
  ".cache",
  "*.tsbuildinfo",
  ".idea",
  ".DS_Store",
] as const;