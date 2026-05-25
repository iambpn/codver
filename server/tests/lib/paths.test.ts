import { test, expect, describe } from "bun:test";
import path from "node:path";
import os from "node:os";
import {
  CODVER_HOME_DIR,
  DEV_COMPOSE_FILE,
  BUNFIG_FILE,
  ENV_FILE,
  PLAN_FILE,
  PR_BODY_FILE,
  NO_UPDATE_FILE,
  DEV_FILES,
  GITIGNORE_ENTRIES,
  CODVER_MANAGED_DIRS,
  CODVER_REPO_PATTERNS,
  getRepoDir,
} from "../../lib/paths";

describe("path constants", () => {
  test("CODVER_HOME_DIR points to ~/.codver", () => {
    expect(CODVER_HOME_DIR).toBe(path.join(os.homedir(), ".codver"));
  });

  test("getRepoDir constructs correct path", () => {
    const dir = getRepoDir("my-repo", 1700000000000);
    expect(dir).toBe(path.join(os.homedir(), ".codver", "my-repo-1700000000000"));
  });

  test("DEV_COMPOSE_FILE is docker-compose.dev.yml", () => {
    expect(DEV_COMPOSE_FILE).toBe("docker-compose.dev.yml");
  });

  test("BUNFIG_FILE is bunfig.toml", () => {
    expect(BUNFIG_FILE).toBe("bunfig.toml");
  });

  test("ENV_FILE is .env", () => {
    expect(ENV_FILE).toBe(".env");
  });

  test("PLAN_FILE is .codver-plan", () => {
    expect(PLAN_FILE).toBe(".codver-plan");
  });

  test("PR_BODY_FILE is .codver-pr-body.md", () => {
    expect(PR_BODY_FILE).toBe(".codver-pr-body.md");
  });

  test("NO_UPDATE_FILE is codver-no-update.md", () => {
    expect(NO_UPDATE_FILE).toBe("codver-no-update.md");
  });
});

describe("DEV_FILES", () => {
  test("contains exactly the 4 core dev files", () => {
    expect(DEV_FILES).toHaveLength(4);
  });

  test("includes all expected dev files", () => {
    expect(DEV_FILES).toContain("docker-compose.dev.yml");
    expect(DEV_FILES).toContain("bunfig.toml");
    expect(DEV_FILES).toContain(".env");
    expect(DEV_FILES).toContain(".codver-plan");
  });

  test("all entries are plain filenames (no path separators)", () => {
    for (const f of DEV_FILES) {
      expect(f).not.toContain("/");
      expect(f).not.toContain("\\");
    }
  });
});

describe("GITIGNORE_ENTRIES", () => {
  test("starts with comment header followed by all DEV_FILES", () => {
    expect(GITIGNORE_ENTRIES).toHaveLength(5);
    expect(GITIGNORE_ENTRIES[0]).toBe("# Codver dev environment");
    for (const df of DEV_FILES) {
      expect(GITIGNORE_ENTRIES).toContain(df);
    }
  });
});

describe("CODVER_MANAGED_DIRS", () => {
  test("includes CODEVER_HOME_DIR", () => {
    expect(CODVER_MANAGED_DIRS).toContain(CODVER_HOME_DIR);
  });

  test("has at least one directory", () => {
    expect(CODVER_MANAGED_DIRS.length).toBeGreaterThanOrEqual(1);
  });
});

describe("CODVER_REPO_PATTERNS", () => {
  test("includes all DEV_FILES", () => {
    for (const df of DEV_FILES) {
      expect(CODVER_REPO_PATTERNS).toContain(df);
    }
  });

  test("includes PR_BODY_FILE and NO_UPDATE_FILE", () => {
    expect(CODVER_REPO_PATTERNS).toContain(PR_BODY_FILE);
    expect(CODVER_REPO_PATTERNS).toContain(NO_UPDATE_FILE);
  });

  test("is a superset of DEV_FILES", () => {
    expect(CODVER_REPO_PATTERNS.length).toBeGreaterThan(DEV_FILES.length);
  });
});