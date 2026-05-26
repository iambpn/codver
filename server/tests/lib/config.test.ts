import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, resolveModels } from "../../lib/config";
import { configureGitUser } from "../../lib/github";
import { ValidationError } from "../../lib/cli";

// ─── Helpers ──────────────────────────────────────────────────────────

function createTempFile(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codver-config-test-"));
  const filePath = path.join(tmpDir, "codver.config.json");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codver-config-test-"));
}

function cleanup(filePath: string) {
  try {
    const dir = path.dirname(filePath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ─── loadConfig ───────────────────────────────────────────────────────

describe("loadConfig", () => {
  test("returns empty config when no config file exists and no explicit path", () => {
    // Temporarily ensure no global config exists
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "codver-test-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;

    try {
      // loadConfig with no explicit path should fall back to ~/.config/.codver
      // which won't exist in our temp home
      const config = loadConfig();
      expect(config).toEqual({});
    } finally {
      process.env.HOME = originalHome;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("loads config from explicit path", () => {
    const filePath = createTempFile(JSON.stringify({
      gitUserName: "Test User",
      gitUserEmail: "test@example.com",
      defaultModel: "anthropic/claude-sonnet-4-20250514",
    }));

    try {
      const config = loadConfig(filePath);
      expect(config.gitUserName).toBe("Test User");
      expect(config.gitUserEmail).toBe("test@example.com");
      expect(config.defaultModel).toBe("anthropic/claude-sonnet-4-20250514");
    } finally {
      cleanup(filePath);
    }
  });

  test("throws ValidationError for nonexistent explicit path", () => {
    expect(() => loadConfig("/nonexistent/path/config.json")).toThrow(ValidationError);
    expect(() => loadConfig("/nonexistent/path/config.json")).toThrow(/Config file not found/);
  });

  test("handles partial config with only gitUserName", () => {
    const filePath = createTempFile(JSON.stringify({ gitUserName: "Codver Bot" }));

    try {
      const config = loadConfig(filePath);
      expect(config.gitUserName).toBe("Codver Bot");
      expect(config.gitUserEmail).toBeUndefined();
      expect(config.defaultModel).toBeUndefined();
    } finally {
      cleanup(filePath);
    }
  });

  test("handles partial config with only defaultModel", () => {
    const filePath = createTempFile(JSON.stringify({ defaultModel: "openai/gpt-4o" }));

    try {
      const config = loadConfig(filePath);
      expect(config.gitUserName).toBeUndefined();
      expect(config.gitUserEmail).toBeUndefined();
      expect(config.defaultModel).toBe("openai/gpt-4o");
    } finally {
      cleanup(filePath);
    }
  });

  test("ignores unknown keys gracefully", () => {
    const filePath = createTempFile(JSON.stringify({
      gitUserName: "Test",
      unknownKey: "should be ignored",
      anotherUnknown: 42,
    }));

    try {
      const config = loadConfig(filePath);
      expect(config.gitUserName).toBe("Test");
      expect((config as any).unknownKey).toBeUndefined();
      expect((config as any).anotherUnknown).toBeUndefined();
    } finally {
      cleanup(filePath);
    }
  });

  test("throws ValidationError for invalid JSON", () => {
    const filePath = createTempFile("{ invalid json }");

    try {
      expect(() => loadConfig(filePath)).toThrow(ValidationError);
      expect(() => loadConfig(filePath)).toThrow(/Invalid JSON/);
    } finally {
      cleanup(filePath);
    }
  });

  test("throws ValidationError for JSON array instead of object", () => {
    const filePath = createTempFile("[1, 2, 3]");

    try {
      expect(() => loadConfig(filePath)).toThrow(ValidationError);
      expect(() => loadConfig(filePath)).toThrow(/must contain a JSON object/);
    } finally {
      cleanup(filePath);
    }
  });

  test("throws ValidationError for non-string config value", () => {
    const filePath = createTempFile(JSON.stringify({ gitUserName: 123 }));

    try {
      expect(() => loadConfig(filePath)).toThrow(ValidationError);
      expect(() => loadConfig(filePath)).toThrow(/must be a string/);
    } finally {
      cleanup(filePath);
    }
  });

  test("returns empty config for empty file", () => {
    const filePath = createTempFile("");

    try {
      const config = loadConfig(filePath);
      expect(config).toEqual({});
    } finally {
      cleanup(filePath);
    }
  });

  test("returns empty config for whitespace-only file", () => {
    const filePath = createTempFile("   \n\n  ");

    try {
      const config = loadConfig(filePath);
      expect(config).toEqual({});
    } finally {
      cleanup(filePath);
    }
  });

  test("allows null values (treated as undefined)", () => {
    const filePath = createTempFile(JSON.stringify({
      gitUserName: null,
      gitUserEmail: null,
      defaultModel: null,
    }));

    try {
      const config = loadConfig(filePath);
      expect(config.gitUserName).toBeUndefined();
      expect(config.gitUserEmail).toBeUndefined();
      expect(config.defaultModel).toBeUndefined();
    } finally {
      cleanup(filePath);
    }
  });
});

// ─── resolveModels ────────────────────────────────────────────────────

describe("resolveModels", () => {
  test("throws ValidationError when neither cliModel nor configDefaultModel is provided", () => {
    expect(() => resolveModels(undefined, undefined)).toThrow(ValidationError);
    expect(() => resolveModels(undefined, undefined)).toThrow(/No model specified/);
  });

  test("uses configDefaultModel for both when --model is absent", () => {
    const result = resolveModels(undefined, "anthropic/claude-sonnet-4-20250514");
    expect(result.generativeModel).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.agentModel).toBe("anthropic/claude-sonnet-4-20250514");
  });

  test("uses cliModel for both when configDefaultModel is absent", () => {
    const result = resolveModels("openai/gpt-4o", undefined);
    expect(result.generativeModel).toBe("openai/gpt-4o");
    expect(result.agentModel).toBe("openai/gpt-4o");
  });

  test("uses configDefaultModel for generative and cliModel for agent when both are set", () => {
    const result = resolveModels("openai/gpt-4o", "anthropic/claude-sonnet-4-20250514");
    expect(result.generativeModel).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.agentModel).toBe("openai/gpt-4o");
  });

  test("uses cliModel for agent and configDefaultModel for generative (key distinction)", () => {
    const result = resolveModels("deepseek/deepseek-chat", "anthropic/claude-sonnet-4-20250514");
    expect(result.generativeModel).toBe("anthropic/claude-sonnet-4-20250514"); // generative: config wins
    expect(result.agentModel).toBe("deepseek/deepseek-chat"); // agent: cli wins
  });
});

// ─── configureGitUser ────────────────────────────────────────────────

describe("configureGitUser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codver-git-test-"));
    // Initialize a git repo in the temp dir
    Bun.spawnSync(["git", "init", tmpDir], { stdout: "pipe", stderr: "pipe" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("sets both git user.name and user.email", async () => {
    await configureGitUser(tmpDir, {
      gitUserName: "Codver Bot",
      gitUserEmail: "bot@codver.dev",
    });

    const nameResult = Bun.spawnSync(["git", "-C", tmpDir, "config", "user.name"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const emailResult = Bun.spawnSync(["git", "-C", tmpDir, "config", "user.email"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(nameResult.stdout.toString().trim()).toBe("Codver Bot");
    expect(emailResult.stdout.toString().trim()).toBe("bot@codver.dev");
  });

  test("sets only git user.name", async () => {
    await configureGitUser(tmpDir, {
      gitUserName: "Codver Bot",
    });

    const nameResult = Bun.spawnSync(["git", "-C", tmpDir, "config", "user.name"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const emailResult = Bun.spawnSync(["git", "-C", tmpDir, "config", "user.email"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(nameResult.stdout.toString().trim()).toBe("Codver Bot");
    // email config should not be set (or empty)
    expect(emailResult.stdout.toString().trim()).toBe("");
  });

  test("sets only git user.email", async () => {
    await configureGitUser(tmpDir, {
      gitUserEmail: "bot@codver.dev",
    });

    const emailResult = Bun.spawnSync(["git", "-C", tmpDir, "config", "user.email"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(emailResult.stdout.toString().trim()).toBe("bot@codver.dev");
  });

  test("is a no-op when neither name nor email is provided", async () => {
    await configureGitUser(tmpDir, {});

    // Should not throw and should not set any local config
    const nameResult = Bun.spawnSync(["git", "-C", tmpDir, "config", "--local", "user.name"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(nameResult.exitCode).not.toBe(0); // no local config set
  });
});