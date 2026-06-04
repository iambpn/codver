import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runChecks } from "../../lib/check";

// ─── Helpers ──────────────────────────────────────────────────────────

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = vars[k];
    }
  }
  return fn().finally(() => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });
}

async function writeConfig(home: string, content: object): Promise<string> {
  const dir = path.join(home, ".config", "codver");
  await Bun.write(path.join(dir, ".keep"), "");
  const filePath = path.join(dir, "codver.config.json");
  await Bun.write(filePath, JSON.stringify(content));
  return filePath;
}

// ─── runChecks — config-only behaviour ───────────────────────────────

describe("runChecks (config + provider keys only)", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalEnv: Record<string, string | undefined> = {};

  const envKeys = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "GOOGLE_API_KEY",
  ];

  beforeEach(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), "codver-check-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    for (const k of envKeys) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    for (const k of envKeys) {
      if (originalEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = originalEnv[k];
      }
    }
    await rm(tmpHome, { recursive: true, force: true });
  });

  test("returns ok=true when no global config and no --config (warning only)", async () => {
    // Missing global config is a warning, not a failure. With no defaultModel,
    // there are no provider-key requirements either. Host deps may or may not
    // pass on this machine, so we only assert that no config-related failures
    // were reported.
    const result = await runChecks({});
    expect(
      result.failures.some((f) => f.toLowerCase().includes("config")),
    ).toBe(false);
    expect(
      result.failures.some((f) => f.toLowerCase().includes("provider key")),
    ).toBe(false);
  });

  test("returns ok=true when env vars satisfy the configured provider", async () => {
    await writeConfig(tmpHome, { defaultModel: "anthropic/claude-sonnet-4-20250514" });
    await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
      const result = await runChecks({});
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
    });
  });

  test("returns ok=false when the configured provider key is missing", async () => {
    await writeConfig(tmpHome, { defaultModel: "anthropic/claude-sonnet-4-20250514" });
    const result = await runChecks({});
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.includes("Provider keys") && f.includes("ANTHROPIC_API_KEY")),
    ).toBe(true);
  });

  test("skips provider-key check when defaultModel is not set", async () => {
    await writeConfig(tmpHome, { gitUserName: "Test" });
    const result = await runChecks({});
    // ok is false because host deps likely fail in CI, but the failures
    // should not include anything about provider keys
    expect(result.failures.some((f) => f.toLowerCase().includes("provider key"))).toBe(false);
  });

  test("flags unknown provider prefix in defaultModel", async () => {
    await writeConfig(tmpHome, { defaultModel: "madeup-provider/some-model" });
    // No env vars set; the unknown provider should NOT cause a key failure
    // (it's a warning, not a hard fail). Host deps may still fail.
    const result = await runChecks({});
    expect(
      result.failures.some((f) => f.toLowerCase().includes("provider key") && f.includes("madeup-provider")),
    ).toBe(false);
  });

  test("flags defaultModel with no provider prefix as a warning, not failure", async () => {
    await writeConfig(tmpHome, { defaultModel: "no-provider-prefix" });
    const result = await runChecks({});
    expect(
      result.failures.some((f) => f.toLowerCase().includes("provider key")),
    ).toBe(false);
  });

  test("with --config and a known good provider, ok=true when key is present", async () => {
    const cfgPath = path.join(tmpHome, "my.json");
    await Bun.write(cfgPath, JSON.stringify({ defaultModel: "openai/gpt-4o" }));
    await withEnv({ OPENAI_API_KEY: "openai-key" }, async () => {
      const result = await runChecks({ configPath: cfgPath });
      expect(result.ok).toBe(true);
    });
  });

  test("with --config and a known provider, ok=false when key is missing", async () => {
    const cfgPath = path.join(tmpHome, "my.json");
    await Bun.write(cfgPath, JSON.stringify({ defaultModel: "openai/gpt-4o" }));
    const result = await runChecks({ configPath: cfgPath });
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.includes("Provider keys") && f.includes("OPENAI_API_KEY")),
    ).toBe(true);
  });

  test("broken --config (invalid JSON) is reported as a config failure", async () => {
    const cfgPath = path.join(tmpHome, "bad.json");
    await Bun.write(cfgPath, "{ not json }");
    const result = await runChecks({ configPath: cfgPath });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.toLowerCase().includes("config file"))).toBe(true);
  });

  // ─── Phase 4: Model Validation ─────────────────────────────────────

  test("Phase 4 skipped when no --model and no defaultModel in config", async () => {
    // Config with no defaultModel, no --model flag → model validation skipped
    await writeConfig(tmpHome, { gitUserName: "Test" });
    const result = await runChecks({});
    expect(
      result.failures.some((f) => f.toLowerCase().includes("model validation")),
    ).toBe(false);
  });

  test("Phase 4 with --model and valid env var passes validation", async () => {
    await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
      const result = await runChecks({ model: "anthropic/claude-sonnet-4-20250514" });
      expect(
        result.failures.some((f) => f.toLowerCase().includes("model validation")),
      ).toBe(false);
    });
  });

  test("Phase 4 with --model and missing env var reports failure", async () => {
    const result = await runChecks({ model: "anthropic/claude-sonnet-4-20250514" });
    expect(
      result.failures.some(
        (f) =>
          f.toLowerCase().includes("model validation") &&
          f.includes("exists but no API key is configured"),
      ),
    ).toBe(true);
  });

  test("Phase 4 with bogus --model reports not available", async () => {
    const result = await runChecks({ model: "completely-bogus-model-xyz" });
    expect(
      result.failures.some(
        (f) =>
          f.toLowerCase().includes("model validation") &&
          f.includes("is not available"),
      ),
    ).toBe(true);
  });

  test("Phase 4 falls back to config.defaultModel when no --model flag", async () => {
    await writeConfig(tmpHome, { defaultModel: "anthropic/claude-sonnet-4-20250514" });
    await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
      const result = await runChecks({});
      expect(
        result.failures.some((f) => f.toLowerCase().includes("model validation")),
      ).toBe(false);
    });
  });

  // ─── Phase 5: Repository Verification ───────────────────────────────

  test("Phase 5 skipped when no --repo is provided", async () => {
    const result = await runChecks({});
    expect(
      result.failures.some((f) => f.toLowerCase().includes("repository")),
    ).toBe(false);
  });

  test("Phase 5 passes for a known-public repository", async () => {
    // octocat/hello-world is GitHub's official test repo, guaranteed to exist
    const result = await runChecks({ repo: "https://github.com/octocat/hello-world" });
    expect(
      result.failures.some((f) => f.toLowerCase().includes("repository")),
    ).toBe(false);
  });

  test("Phase 5 passes with owner/repo shorthand", async () => {
    // owner/repo shorthand should be normalized to https://github.com/owner/repo
    const result = await runChecks({ repo: "octocat/hello-world" });
    expect(
      result.failures.some((f) => f.toLowerCase().includes("repository")),
    ).toBe(false);
  });

  test("Phase 5 fails for a non-existent repository", async () => {
    const result = await runChecks({ repo: "https://github.com/not-a-real-repo-xyz-12345-abcde" });
    expect(
      result.failures.some(
        (f) =>
          f.toLowerCase().includes("repository") &&
          (f.includes("not found") || f.includes("Not Found")),
      ),
    ).toBe(true);
  });

  test("Phase 5 fails for an unreachable host", async () => {
    const result = await runChecks({ repo: "https://invalid-host-xyz-12345.example/repo" });
    expect(
      result.failures.some(
        (f) =>
          f.toLowerCase().includes("repository") &&
          (f.includes("Cannot reach") || f.includes("Could not resolve")),
      ),
    ).toBe(true);
  });
});
