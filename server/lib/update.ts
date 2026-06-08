import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { blankLine, error, heading, info, spinningStep, success } from "./progress";

const REPO = "https://github.com/iambpn/codver.git";
const INSTALL_DIR = path.join(os.homedir(), ".codver");
const SERVER_DIR = path.join(INSTALL_DIR, "server");
const REPO_CACHE = "/tmp/codver-repo";
const CONFIG_FILE = "codver.config.json";

export async function runUpdate(): Promise<void> {
  heading("Update Codver Server");

  try {
    await Bun.file(SERVER_DIR).stat();
  } catch {
    error(`Codver server is not installed at ${SERVER_DIR}`);
    info("Run install-codver-server.sh first.");
    process.exit(1);
  }

  const configPath = path.join(SERVER_DIR, CONFIG_FILE);
  let configBak: string | null = null;

  try {
    await Bun.file(configPath).stat();
    info(`Preserving config at ${configPath}`);
    configBak = await Bun.file(configPath).text();
  } catch {
    // config file does not exist — nothing to preserve
  }

  await spinningStep("Updating repository", async () => {
    const cacheGitDir = path.join(REPO_CACHE, ".git");
    let cacheExists = false;
    try {
      await Bun.file(cacheGitDir).stat();
      cacheExists = true;
    } catch {
      // cache does not exist
    }
    if (cacheExists) {
      const proc = await Bun.$`git -C ${REPO_CACHE} fetch --depth 1 origin --quiet`.nothrow();
      if (proc.exitCode !== 0) {
        throw new Error(`git fetch failed: ${proc.stderr.toString()}`);
      }
      const reset = await Bun.$`git -C ${REPO_CACHE} reset --hard origin/main --quiet`.nothrow();
      if (reset.exitCode !== 0) {
        throw new Error(`git reset failed: ${reset.stderr.toString()}`);
      }
    } else {
      const clone = await Bun.$`git clone --depth 1 --quiet ${REPO} ${REPO_CACHE}`.nothrow();
      if (clone.exitCode !== 0) {
        throw new Error(`git clone failed: ${clone.stderr.toString()}`);
      }
    }
  });

  info("Removing old server files...");
  await rm(SERVER_DIR, { recursive: true, force: true });

  info("Copying updated server...");
  const serverSrc = path.join(REPO_CACHE, "server");
  await Bun.$`cp -r ${serverSrc} ${SERVER_DIR}`.quiet();

  const cleanupFiles = [".gitignore", "tests", "CLAUDE.md", "README.md"];
  for (const file of cleanupFiles) {
    const filePath = path.join(SERVER_DIR, file);
    try {
      await Bun.file(filePath).stat();
      await rm(filePath, { recursive: true, force: true });
    } catch {
      // file does not exist, skip
    }
  }

  if (configBak !== null) {
    info("Restoring config...");
    await Bun.write(configPath, configBak);
  }

  await spinningStep("Reinstalling dependencies", async () => {
    const proc = await Bun.$`bun install --production --silent`.cwd(SERVER_DIR).nothrow();
    if (proc.exitCode !== 0) {
      throw new Error(`bun install failed: ${proc.stderr.toString()}`);
    }
  });

  blankLine();
  success("Update complete!");
  blankLine();
  info("Verify with: codver --help");
}
