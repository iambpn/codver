import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CODVER_HOME_DIR, DEV_FILES, GIT_STAGING_EXCLUSIONS, PR_BODY_FILE, getRepoDir } from "./paths";
import { error, info, spinningStep, step, success, warn } from "./progress";
import type { RepoInfo } from "./types";

/**
 * Get the currently authenticated GitHub user's login name using `gh api user`.
 * Returns undefined if gh is not authenticated or the call fails.
 */
export async function getAuthenticatedUser(): Promise<string | undefined> {
  try {
    const result = Bun.spawnSync(["gh", "api", "user", "--jq", ".login"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      const login = result.stdout.toString().trim();
      if (login) {
        return login;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

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
    await mkdir(CODVER_HOME_DIR, { recursive: true });

    // Extract repo name from URL
    const repoName = extractRepoName(repoUrl);
    const timestamp = Date.now();
    const repoDir = getRepoDir(repoName, timestamp);

    // Clone using gh CLI
    const cloneResult = Bun.spawnSync(["gh", "repo", "clone", repoUrl, repoDir], { stdout: "pipe", stderr: "pipe" });

    if (cloneResult.exitCode !== 0) {
      const errMsg = cloneResult.stderr.toString() || cloneResult.stdout.toString();
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
  if (match && match[1]) {
    return match[1];
  } else {
    return "main";
  }
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

export async function stageCodeChanges(cwd: string, commitTitle: string, commitBody: string): Promise<void> {
  await step("Staging and committing code changes", async () => {
    const exclusionArgs = GIT_STAGING_EXCLUSIONS.map((pattern) => `:!${pattern}`);
    const addResult = Bun.spawnSync(["git", "-C", cwd, "add", "-A", "--", ".", ...exclusionArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (addResult.exitCode !== 0) {
      const fallbackResult = Bun.spawnSync(["git", "-C", cwd, "add", "-A"], { stdout: "pipe", stderr: "pipe" });
      if (fallbackResult.exitCode !== 0) {
        warn(`Git add fallback also failed: ${fallbackResult.stderr.toString() || fallbackResult.stdout.toString()}`);
      }
    }

    const commitResult = Bun.spawnSync(["git", "-C", cwd, "commit", "-m", commitTitle, "-m", commitBody], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (commitResult.exitCode !== 0) {
      const errMsg = commitResult.stderr.toString();
      if (!errMsg.includes("nothing to commit") && !errMsg.includes("no changes")) {
        throw new Error(`Commit failed: ${errMsg}`);
      }
    }

    success(`Changes committed: ${commitTitle}`);
  });
}

export async function stageSingleFileAndCommit(cwd: string, filePath: string, commitMessage: string): Promise<void> {
  const addResult = Bun.spawnSync(["git", "-C", cwd, "add", filePath], { stdout: "pipe", stderr: "pipe" });
  if (addResult.exitCode !== 0) {
    warn(`Failed to stage ${filePath}: ${addResult.stderr.toString()}`);
  }

  const commitResult = Bun.spawnSync(["git", "-C", cwd, "commit", "-m", commitMessage], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (commitResult.exitCode !== 0) {
    warn(`Commit had issues: ${commitResult.stderr.toString()}`);
  }
}

function getGitChanges(repoDir: string): { diffStat: string; diffLines: string[]; untrackedFiles: string[] } {
  const diffResult = Bun.spawnSync(["git", "-C", repoDir, "diff", "--stat", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const untrackedResult = Bun.spawnSync(["git", "-C", repoDir, "ls-files", "--others", "--exclude-standard"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const diffStat = diffResult.stdout.toString().trim();
  const diffLines = diffStat
    .split("\n")
    .filter((line: string) => line.length > 0 && !isDevFileFromDiffLine(line));
  const untrackedFiles = untrackedResult.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f: string) => f.length > 0 && !isDevFile(f));

  return { diffStat, diffLines, untrackedFiles };
}

export async function hasCodeChanges(repoDir: string): Promise<boolean> {
  const { diffLines, untrackedFiles } = getGitChanges(repoDir);
  return diffLines.length > 0 || untrackedFiles.length > 0;
}

/**
 * Check if a git diff --stat line refers to a dev-only file.
 * Diff stat lines look like: " path/to/file |  3 +-"
 * Renamed files show: " old_name -> new_name |  3 +-"
 */
function isDevFileFromDiffLine(line: string): boolean {
  // Git diff stat lines look like: " path/to/file | 3 +-"
  // Renamed files show: " old_name => new_name | 3 +-" or " {old => new}/path | 3 +-"
  const pipeIndex = line.indexOf("|");
  const filePart = pipeIndex >= 0 ? line.slice(0, pipeIndex).trim() : line.trim();
  if (!filePart) return false;
  if (filePart.includes("->")) {
    const parts = filePart.split("->");
    for (const part of parts) {
      if (isDevFile(part.trim())) return true;
    }
    return false;
  }
  return isDevFile(filePart);
}

export async function getChangedFiles(repoDir: string): Promise<string> {
  const { diffStat, untrackedFiles } = getGitChanges(repoDir);
  const parts: string[] = [];
  if (diffStat) parts.push(diffStat);
  if (untrackedFiles.length > 0) {
    parts.push(`\nUntracked files:\n${untrackedFiles.join("\n")}`);
  }
  return parts.join("\n");
}

export async function getFullDiff(repoDir: string): Promise<string> {
  const diffResult = Bun.spawnSync(["git", "-C", repoDir, "diff", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const { untrackedFiles } = getGitChanges(repoDir);

  let fullDiff = diffResult.stdout.toString();
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
      await Bun.file(bodyFile).unlink();
    } catch {
      // ignore
    }

    if (result.exitCode !== 0) {
      const errMsg = result.stderr.toString();
      // Print manual instructions so the user can create the PR themselves
      error(`Failed to create PR automatically: ${errMsg}`);
      error(`You can create the PR manually:`);
      error(`  cd ${repoDir}`);
      error(`  git push -u origin ${newBranch}`);
      error(`  gh pr create --title "${title}" --base ${baseBranch} --head ${newBranch}`);
      throw new Error(`Failed to create PR: ${errMsg}`);
    }

    const prUrl = result.stdout.toString().trim();
    success(`PR created: ${prUrl}`);
    return prUrl;
  });
}


