/**
 * Codver Clean — Remove all output directories and files created by Codver.
 *
 * Extracted from standalone clean.ts into a library module so codver.ts
 * can expose it as a subcommand alongside the main pipeline.
 */

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { CODVER_HOME_DIR, CODVER_CONFIG_PATH } from "./paths";
import { blankLine, error, heading, info, success, warn } from "./progress";

export interface CleanOptions {
  mode: "all" | "home";
  dryRun: boolean;
}

export function addCleanOptions(cmd: Command): Command {
  return cmd
    .option(
      "--all",
      "Remove everything (default: home dir + any repo artifact files). Config file is always preserved.",
    )
    .option("--home", "Remove only the ~/.codver directory (cloned repos). Config file is always preserved.")
    .option("--dry-run", "Show what would be deleted without actually deleting anything");
}

/**
 * Calculate the total size of a directory recursively.
 * Uses Bun.file() for stat operations where possible.
 */
async function getDirSize(dirPath: string): Promise<number> {
  let totalSize = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirSize(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await Bun.file(fullPath).stat();
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
  let decimalPlaces: number;
  if (i === 0) {
    decimalPlaces = 0;
  } else {
    decimalPlaces = 1;
  }
  return `${val.toFixed(decimalPlaces)} ${units[i]}`;
}

/**
 * Remove a directory recursively.
 */
async function removeDir(dirPath: string, dryRun: boolean): Promise<boolean> {
  const exists = await Bun.file(dirPath).exists();
  if (!exists) {
    info(`  Directory does not exist, skipping: ${dirPath}`);
    return false;
  }

  let stats;
  try {
    stats = await Bun.file(dirPath).stat();
  } catch {
    info(`  Cannot stat path, skipping: ${dirPath}`);
    return false;
  }

  if (!stats.isDirectory()) {
    info(`  Not a directory, skipping: ${dirPath}`);
    return false;
  }

  const size = await getDirSize(dirPath);
  info(`  Removing: ${dirPath} (${formatBytes(size)})`);

  if (dryRun) {
    warn(`  [DRY RUN] Would remove: ${dirPath} (${formatBytes(size)})`);
    return true;
  }

  try {
    await rm(dirPath, { recursive: true, force: true });
    success(`  Removed: ${dirPath}`);
    return true;
  } catch (err) {
    error(`  Failed to remove ${dirPath}: ${err}`);
    return false;
  }
}

/**
 * Run the clean operation. Call from codver.ts when the "clean" subcommand is used.
 */
export async function runClean(options: CleanOptions) {
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
    await removeDir(CODVER_HOME_DIR, dryRun);
  }

  blankLine();
  info(`Config file: ${CODVER_CONFIG_PATH} (preserved)`);

  // ─── Summary ────────────────────────────────────────────────────
  heading("Summary");

  if (dryRun) {
    info("This was a dry run. No files were actually removed.");
    info("Run without --dry-run to perform the cleanup.");
  } else {
    info(`Codver home directory: ${(await Bun.file(CODVER_HOME_DIR).exists()) ? "still exists" : "removed"}`);
  }

  blankLine();

  if (mode === "all") {
    success("Full cleanup complete!");
  } else {
    success("Home directory cleanup complete!");
    info(
      `Run \`bun run codver.ts clean --all\` to remove everything, or \`bun run codver.ts clean --dry-run\` to preview.`,
    );
  }
}
