/**
 * Codver Clean — Remove all output directories and files created by Codver.
 *
 * Extracted from standalone clean.ts into a library module so codver.ts
 * can expose it as a subcommand alongside the main pipeline.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CODVER_HOME_DIR, CODVER_CONFIG_PATH, getGlobalConfigPath, CODVER_REPO_PATTERNS } from "./paths";
import { blankLine, error, heading, info, success, warn } from "./progress";

export interface CleanOptions {
  mode: "all" | "home";
  dryRun: boolean;
}

function printCleanHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║              Codver Clean — Remove Output Artifacts       ║
╚══════════════════════════════════════════════════════════╝

Usage: bun run codver.ts clean [options]

Options:
  --all       Remove everything (default: home dir + any repo artifact files)
              The global config file (~/.config/.codver) is always preserved.
  --home      Remove only the ~/.codver directory (cloned repos)
              The global config file (~/.config/.codver) is always preserved.
  --dry-run   Show what would be deleted without actually deleting anything
  --help      Show this help message

Examples:
  bun run codver.ts clean              # Same as --all
  bun run codver.ts clean --home       # Remove only cloned repo directories
  bun run codver.ts clean --dry-run    # Preview what would be removed
`);
}

/**
 * Parse clean-specific CLI args.
 * Accepts the raw argv slice *after* the "clean" positional.
 */
export function parseCleanArgs(args: string[]): CleanOptions {
  const { values } = parseArgs({
    args,
    options: {
      all: { type: "boolean", default: false },
      home: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values["help"]) {
    printCleanHelp();
    process.exit(0);
  }

  const dryRun = values["dry-run"] as boolean;

  if (values["home"] && values["all"]) {
    error("Cannot specify both --home and --all. Pick one.");
    process.exit(1);
  }

  // Default to --all if nothing specified
  const mode: "all" | "home" = values["home"] ? "home" : "all";

  return { mode, dryRun };
}

/**
 * Calculate the total size of a directory recursively.
 */
function getDirSize(dirPath: string): number {
  let totalSize = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getDirSize(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          totalSize += stat.size;
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Directory may not exist or be inaccessible
  }
  return totalSize;
}

/**
 * Format bytes into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Remove a directory recursively.
 */
function removeDir(dirPath: string, dryRun: boolean): boolean {
  if (!fs.existsSync(dirPath)) {
    info(`  Directory does not exist, skipping: ${dirPath}`);
    return false;
  }

  const size = getDirSize(dirPath);
  info(`  Removing: ${dirPath} (${formatBytes(size)})`);

  if (dryRun) {
    warn(`  [DRY RUN] Would remove: ${dirPath} (${formatBytes(size)})`);
    return true;
  }

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    success(`  Removed: ${dirPath}`);
    return true;
  } catch (err) {
    error(`  Failed to remove ${dirPath}: ${err}`);
    return false;
  }
}

/**
 * Remove dev-environment files inside the CODVER_HOME_DIR subdirectories.
 * Scans each repo clone inside ~/.codver/ for leftover dev files.
 */
function cleanRepoDevFiles(dryRun: boolean): number {
  let removed = 0;

  if (!fs.existsSync(CODVER_HOME_DIR)) {
    return removed;
  }

  const entries = fs.readdirSync(CODVER_HOME_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(CODVER_HOME_DIR, entry.name);

    for (const pattern of CODVER_REPO_PATTERNS) {
      const filePath = path.join(repoPath, pattern);
      if (fs.existsSync(filePath)) {
        if (dryRun) {
          warn(`  [DRY RUN] Would remove: ${filePath}`);
        } else {
          try {
            fs.unlinkSync(filePath);
            success(`  Removed: ${filePath}`);
          } catch (err) {
            error(`  Failed to remove ${filePath}: ${err}`);
            continue;
          }
        }
        removed++;
      }
    }
  }

  return removed;
}

/**
 * Run the clean operation. Call from codver.ts when the "clean" subcommand is used.
 */
export function runClean(options: CleanOptions): void {
  const { mode, dryRun } = options;

  if (dryRun) {
    heading("Dry Run — Previewing What Would Be Removed");
  }

  // ─── Phase 1: Clean home directory ──────────────────────────────
  heading("Phase 1: Clean Codver Home Directory");

  info(`Codver home: ${CODVER_HOME_DIR}`);
  blankLine();

  if (mode === "home" || mode === "all") {
    // Remove the entire ~/.codver/ directory
    // Note: the global config file (~/.config/.codver) is intentionally NOT removed
    // during clean operations. It is always preserved.
    removeDir(CODVER_HOME_DIR, dryRun);
  }

  blankLine();
  info(`Config file: ${CODVER_CONFIG_PATH} (preserved)`);

  // ─── Phase 2: Clean dev files inside repos (only in --all mode) ─
  // This is only relevant if --home was used and we kept the dir structure
  // but want to clean up individual dev files within repos.
  // In --all mode, the whole ~/.codver/ is removed so this is redundant.

  // ─── Summary ────────────────────────────────────────────────────
  heading("Summary");

  if (dryRun) {
    info("This was a dry run. No files were actually removed.");
    info("Run without --dry-run to perform the cleanup.");
  } else {
    info(`Codver home directory: ${fs.existsSync(CODVER_HOME_DIR) ? "still exists" : "removed"}`);
  }

  blankLine();

  if (mode === "all") {
    success("Full cleanup complete!");
  } else {
    success("Home directory cleanup complete!");
    info(`Run \`bun run codver.ts clean --all\` to remove everything, or \`bun run codver.ts clean --dry-run\` to preview.`);
  }
}