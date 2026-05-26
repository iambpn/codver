import fs from "node:fs";
import path from "node:path";
import { CODVER_HOME_DIR, DEV_FILES, PR_BODY_FILE, getRepoDir } from "./paths";
import { info, RED, RESET, spinningStep, step, success, YELLOW } from "./progress";
import type { RepoInfo } from "./types";

export async function configureGitUser(repoDir: string, config: { gitUserName?: string; gitUserEmail?: string }): Promise<void> {
  if (config.gitUserName) {
    const result = Bun.spawnSync(["git", "-C", repoDir, "config", "user.name", config.gitUserName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString();
      throw new Error(`Failed to set git user.name: ${errMsg}`);
    }
  }

  if (config.gitUserEmail) {
    const result = Bun.spawnSync(["git", "-C", repoDir, "config", "user.email", config.gitUserEmail], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString();
      throw new Error(`Failed to set git user.email: ${errMsg}`);
    }
  }
}

export async function cloneRepo(repoUrl: string): Promise<RepoInfo> {
  return spinningStep("Cloning repository", async () => {
    // Ensure ~/.codver exists
    fs.mkdirSync(CODVER_HOME_DIR, { recursive: true });

    // Extract repo name from URL
    const repoName = extractRepoName(repoUrl);
    const timestamp = Date.now();
    const repoDir = getRepoDir(repoName, timestamp);

    // Clone using gh CLI
    const cloneResult = Bun.spawnSync(["gh", "repo", "clone", repoUrl, repoDir], { stdout: "pipe", stderr: "pipe" });

    if (cloneResult.exitCode !== 0) {
      const errMsg = (cloneResult.stderr || cloneResult.stdout).toString();
      throw new Error(`Failed to clone repository: ${errMsg}`);
    }

    info(`Cloned to: ${repoDir}`);

    // Get default branch
    const defaultBranch = await getDefaultBranch(repoDir);

    return { repoDir, repoName, defaultBranch };
  });
}

function extractRepoName(url: string): string {
  let name = url.trim();

  // Remove trailing .git
  if (name.endsWith(".git")) {
    name = name.slice(0, -4);
  }

  // Handle various GitHub URL formats:
  // https://github.com/owner/repo -> owner-repo
  // git@github.com:owner/repo -> owner-repo
  // owner/repo -> owner-repo
  if (name.includes("://")) {
    // https://github.com/owner/repo
    const parts = name.split("/");
    const owner = parts[parts.length - 2] || "unknown";
    const repo = parts[parts.length - 1] || "unknown";
    name = `${owner}-${repo}`;
  } else if (name.includes("@")) {
    // git@github.com:owner/repo
    const colonParts = name.split(":");
    if (colonParts.length > 1) {
      const pathPart = colonParts[colonParts.length - 1]!;
      const slashParts = pathPart.split("/");
      const owner = slashParts[0] || "unknown";
      const repo = slashParts[1] || "unknown";
      name = `${owner}-${repo}`;
    }
  } else if (name.includes("/")) {
    // owner/repo format (gh repo clone accepts this)
    const parts = name.split("/");
    const owner = parts[0] || "unknown";
    const repo = parts[1] || "unknown";
    name = `${owner}-${repo}`;
  }

  // Clean up any remaining special characters for directory naming
  name = name.replace(/[^a-zA-Z0-9\-_.]/g, "-");

  return name || "unknown-repo";
}

export async function getDefaultBranch(repoDir: string): Promise<string> {
  const result = Bun.spawnSync(["git", "-C", repoDir, "remote", "show", "origin"], { stdout: "pipe", stderr: "pipe" });

  if (result.exitCode !== 0) {
    return "main"; // fallback
  }

  const output = result.stdout.toString();
  const match = output.match(/HEAD branch:\s*(\S+)/);
  return match?.[1] ?? "main";
}

export async function setupBranch(repoDir: string, fromBranch: string | undefined, newBranch: string): Promise<void> {
  return step(`Setting up branch: ${newBranch}`, async () => {
    // If fromBranch specified, checkout that branch first
    if (fromBranch) {
      const checkoutResult = Bun.spawnSync(["git", "-C", repoDir, "checkout", fromBranch], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (checkoutResult.exitCode !== 0) {
        const errMsg = checkoutResult.stderr.toString();
        throw new Error(`Failed to checkout from-branch "${fromBranch}": ${errMsg}`);
      }
      info(`Based on branch: ${fromBranch}`);
    } else {
      info(`Based on default branch`);
    }

    // Create and checkout new branch
    const branchResult = Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", newBranch], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (branchResult.exitCode !== 0) {
      const errMsg = branchResult.stderr.toString();
      throw new Error(`Failed to create branch "${newBranch}": ${errMsg}`);
    }

    success(`Branch ${newBranch} created and checked out`);
  });
}

export async function stageAndCommit(repoDir: string, message: string): Promise<void> {
  return step("Committing changes", async () => {
    // Stage all changes (dev compose files are in .gitignore so they won't be staged)
    const addResult = Bun.spawnSync(["git", "-C", repoDir, "add", "-A"], { stdout: "pipe", stderr: "pipe" });
    if (addResult.exitCode !== 0) {
      throw new Error(`Failed to stage changes: ${addResult.stderr.toString()}`);
    }

    // Commit
    const commitResult = Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", message], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (commitResult.exitCode !== 0) {
      const errMsg = commitResult.stderr.toString();
      if (!errMsg.includes("nothing to commit") && !errMsg.includes("no changes")) {
        throw new Error(`Failed to commit: ${errMsg}`);
      }
      info("No changes to commit");
    } else {
      info(`Committed: ${message}`);
    }
  });
}

export async function hasCodeChanges(repoDir: string): Promise<boolean> {
  // Check all tracked file changes, then filter out dev files
  const diffResult = Bun.spawnSync(["git", "-C", repoDir, "diff", "--stat", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Check for untracked files (excluding dev files)
  const untrackedResult = Bun.spawnSync(["git", "-C", repoDir, "ls-files", "--others", "--exclude-standard"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const diffOutput = diffResult.stdout.toString().trim();
  const meaningfulDiffLines = diffOutput
    .split("\n")
    .filter((line: string) => line.length > 0 && !isDevFileFromDiffLine(line));

  const untrackedFiles = untrackedResult.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f: string) => f.length > 0 && !isDevFile(f));

  return meaningfulDiffLines.length > 0 || untrackedFiles.length > 0;
}

/**
 * Check if a git diff --stat line refers to a dev-only file.
 * Diff stat lines look like: " path/to/file |  3 +-"
 */
function isDevFileFromDiffLine(line: string): boolean {
  // Extract the filename from the diff stat line
  const match = line.match(/^\s*(\S+)/);
  if (!match) return false;
  const filepath = match[1]!;
  return isDevFile(filepath);
}

export async function getChangedFiles(repoDir: string): Promise<string> {
  // Get diff stat for all changes, then filter out dev files
  const diffResult = Bun.spawnSync(["git", "-C", repoDir, "diff", "--stat", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Get untracked files
  const untrackedResult = Bun.spawnSync(["git", "-C", repoDir, "ls-files", "--others", "--exclude-standard"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const diffStat = diffResult.stdout.toString().trim();
  const untracked = untrackedResult.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f: string) => f.length > 0 && !isDevFile(f));

  const parts: string[] = [];
  if (diffStat) parts.push(diffStat);
  if (untracked.length > 0) {
    parts.push(`\nUntracked files:\n${untracked.join("\n")}`);
  }
  return parts.join("\n");
}

export async function getFullDiff(repoDir: string): Promise<string> {
  const diffResult = Bun.spawnSync(["git", "-C", repoDir, "diff", "HEAD"], { stdout: "pipe", stderr: "pipe" });

  const untrackedResult = Bun.spawnSync(["git", "-C", repoDir, "ls-files", "--others", "--exclude-standard"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const diff = diffResult.stdout.toString();
  const untrackedFiles = untrackedResult.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f: string) => f.length > 0 && !isDevFile(f));

  let fullDiff = diff;
  for (const file of untrackedFiles) {
    try {
      const content = await Bun.file(path.join(repoDir, file)).text();
      fullDiff += `\n--- /dev/null\n+++ b/${file}\n${content}`;
    } catch {
      // skip files we can't read
    }
  }

  return fullDiff;
}

function isDevFile(filepath: string): boolean {
  return DEV_FILES.some((df) => filepath === df || filepath.endsWith(`/${df}`));
}

export async function pushBranch(repoDir: string, branch: string): Promise<void> {
  return spinningStep(`Pushing branch: ${branch}`, async () => {
    const result = Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", branch], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString();
      throw new Error(`Failed to push branch: ${errMsg}`);
    }

    success(`Branch ${branch} pushed to remote`);
  });
}

export async function createPR(
  repoDir: string,
  title: string,
  body: string,
  newBranch: string,
  baseBranch: string,
): Promise<string> {
  return spinningStep("Creating Pull Request", async () => {
    // Write PR body to a temp file to avoid shell escaping issues
    const bodyFile = path.join(repoDir, PR_BODY_FILE);
    await Bun.write(bodyFile, body);

    const result = Bun.spawnSync(
      ["gh", "pr", "create", "--title", title, "--body-file", bodyFile, "--base", baseBranch, "--head", newBranch],
      {
        cwd: repoDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // Clean up the temp file
    try {
      fs.unlinkSync(bodyFile);
    } catch {
      // ignore
    }

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString();
      // Print manual instructions so the user can create the PR themselves
      console.error(`
${RED}Failed to create PR automatically: ${errMsg}${RESET}`);
      console.error(`${YELLOW}You can create the PR manually:${RESET}`);
      console.error(`  cd ${repoDir}`);
      console.error(`  git push -u origin ${newBranch}`);
      console.error(`  gh pr create --title "${title}" --base ${baseBranch} --head ${newBranch}`);
      throw new Error(`Failed to create PR: ${errMsg}`);
    }

    const prUrl = result.stdout.toString().trim();
    success(`PR created: ${prUrl}`);
    return prUrl;
  });
}
