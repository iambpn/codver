import os from "node:os";
import path from "node:path";

/**
 * Centralized path constants for all directories and files created by Codver.
 *
 * Use these constants everywhere instead of hardcoding paths so that
 * adding/removing/relocating output artifacts only requires editing this file.
 */

// ─── Home-level directories ────────────────────────────────────────

/** Root working directory for Codver (under $HOME). */
export const CODVER_HOME_DIR = path.join(os.homedir(), ".codver");

// ─── Per-repo working directory pattern ────────────────────────────

/**
 * Build a per-repo working directory path.
 * Format: ~/.codver/<repoName>-<timestamp>
 */
export function getRepoDir(repoName: string, timestamp: number): string {
  return path.join(CODVER_HOME_DIR, `${repoName}-${timestamp}`);
}

// ─── Dev-environment files (created inside each repo clone) ───────

/** Docker Compose override created by the AI generator. */
export const DEV_COMPOSE_FILE = "docker-compose.dev.yml";

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

/**
 * All transient / generated filenames that Codver writes inside a repo clone.
 * Used for:
 *   - .gitignore generation (GITIGNORE_ENTRIES)
 *   - filtering dev files out of git change detection
 *   - cleanup operations
 */
export const DEV_FILES: readonly string[] = [
  DEV_COMPOSE_FILE,
  BUNFIG_FILE,
  ENV_FILE,
  PLAN_FILE,
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
 * All top-level file patterns that Codver creates inside a repo clone,
 * expressed as relative paths safe for glob/rimraf patterns.
 */
export const CODVER_REPO_PATTERNS: readonly string[] = [
  ...DEV_FILES,
  PR_BODY_FILE,
  NO_UPDATE_FILE,
] as const;