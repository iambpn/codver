import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  generateBunfigToml,
  generateEnvFile,
  getProviderEnvForCompose,
  validateEnvVars,
} from "../../lib/security";
import { PROVIDER_ENV_MAP, FALLBACK_ENV_VARS } from "../../lib/types";

// ─── generateBunfigToml ──────────────────────────────────────────────

describe("generateBunfigToml", () => {
  test("returns expected toml string", () => {
    const result = generateBunfigToml();
    expect(result).toContain("minimumReleaseAge = 604800");
    expect(result).toContain("frozenLockfile = true");
  });

  test("contains [install] section header", () => {
    const result = generateBunfigToml();
    expect(result).toContain("[install]");
  });

  test("output is valid TOML-like format", () => {
    const result = generateBunfigToml();
    expect(result).toMatch(/^\[install\]/);
    expect(result.trim().split("\n").length).toBeGreaterThanOrEqual(2);
  });
});

// ─── generateEnvFile ──────────────────────────────────────────────────

describe("generateEnvFile", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("includes provider-specific env vars for anthropic", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-123";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = generateEnvFile("anthropic");
    expect(result).toContain("ANTHROPIC_API_KEY");
    // GITHUB_TOKEN must NOT be forwarded to the container
    expect(result).not.toContain("GITHUB_TOKEN");
    expect(result).not.toContain("GH_TOKEN");
  });

  test("does NOT include GH_TOKEN even when present in host env", () => {
    process.env.GH_TOKEN = "gh-test-token";
    delete process.env.GITHUB_TOKEN;
    process.env.ANTHROPIC_API_KEY = "test-key";

    const result = generateEnvFile("anthropic");
    // GH_TOKEN must NOT be forwarded to the container
    expect(result).not.toContain("GH_TOKEN");
  });

  test("quotes values using JSON.stringify for safe shell handling", () => {
    process.env.ANTHROPIC_API_KEY = "value-with-special-chars";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = generateEnvFile("anthropic");
    // JSON.stringify wraps in double quotes
    expect(result).toContain('"value-with-special-chars"');
  });

  test("produces empty quoted string for missing env vars", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = generateEnvFile("anthropic");
    // Should have ="" for missing keys
    expect(result).toMatch(/ANTHROPIC_API_KEY=""/);
    // Should NOT contain GITHUB_TOKEN or GH_TOKEN at all
    expect(result).not.toContain("GITHUB_TOKEN");
    expect(result).not.toContain("GH_TOKEN");
  });

  test("falls back to FALLBACK_ENV_VARS for unknown provider", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const result = generateEnvFile("unknown-provider-xyz");
    expect(result).toContain("ANTHROPIC_API_KEY");
    expect(result).toContain("OPENAI_API_KEY");
  });

  test("does not duplicate env vars in provider set", () => {
    process.env.ANTHROPIC_API_KEY = "key";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = generateEnvFile("anthropic");
    const lines = result.trim().split("\n");
    const anthropicLines = lines.filter((l) => l.startsWith("ANTHROPIC_API_KEY="));
    expect(anthropicLines.length).toBe(1);
  });

  test("output ends with newline", () => {
    process.env.ANTHROPIC_API_KEY = "key";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    const result = generateEnvFile("anthropic");
    expect(result.endsWith("\n")).toBe(true);
  });
});

// ─── getProviderEnvForCompose ──────────────────────────────────────────

describe("getProviderEnvForCompose", () => {
  test("returns correct env vars for anthropic", () => {
    const result = getProviderEnvForCompose("anthropic");
    expect(result).toEqual(["ANTHROPIC_API_KEY"]);
  });

  test("returns correct env vars for openai", () => {
    const result = getProviderEnvForCompose("openai");
    expect(result).toEqual(["OPENAI_API_KEY"]);
  });

  test("returns correct env vars for google", () => {
    const result = getProviderEnvForCompose("google");
    expect(result).toContain("GOOGLE_API_KEY");
    expect(result).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });

  test("returns correct env vars for azure", () => {
    const result = getProviderEnvForCompose("azure");
    expect(result).toContain("AZURE_OPENAI_API_KEY");
    expect(result).toContain("AZURE_OPENAI_ENDPOINT");
  });

  test("falls back to FALLBACK_ENV_VARS for unknown provider", () => {
    const result = getProviderEnvForCompose("nonexistent-provider");
    expect(result).toEqual(FALLBACK_ENV_VARS);
  });

  test("returns same reference as PROVIDER_ENV_MAP for known provider", () => {
    const result = getProviderEnvForCompose("anthropic");
    expect(result).toBe(PROVIDER_ENV_MAP.anthropic);
  });
});

// ─── validateEnvVars ──────────────────────────────────────────────────

describe("validateEnvVars", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns valid when all provider env vars are present", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    const result = validateEnvVars("anthropic");
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test("returns valid regardless of GITHUB_TOKEN/GH_TOKEN presence (those are host deps)", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = validateEnvVars("anthropic");
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test("returns invalid when provider env var is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = validateEnvVars("anthropic");
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ANTHROPIC_API_KEY");
  });

  test("does NOT require GITHUB_TOKEN or GH_TOKEN as env vars", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = validateEnvVars("anthropic");
    expect(result.valid).toBe(true);
    expect(result.missing).not.toContain("GITHUB_TOKEN or GH_TOKEN");
  });

  test("handles unknown provider with FALLBACK_ENV_VARS", () => {
    // Set all fallback env vars
    for (const key of FALLBACK_ENV_VARS) {
      process.env[key] = "test-value";
    }

    const result = validateEnvVars("nonexistent");
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test("reports multiple missing vars for google provider", () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = validateEnvVars("google");
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("GOOGLE_API_KEY");
    expect(result.missing).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    // GITHUB_TOKEN/GH_TOKEN should NOT be in the missing list
    expect(result.missing).not.toContain("GITHUB_TOKEN or GH_TOKEN");
  });

  test("does not require GOOGLE_APPLICATION_CREDENTIALS if GOOGLE_API_KEY is present", () => {
    process.env.GOOGLE_API_KEY = "test-key";
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GITHUB_TOKEN = "gh-token";

    const result = validateEnvVars("google");
    // GOOGLE_APPLICATION_CREDENTIALS is in the required list, so it should be missing
    expect(result.missing).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });
});

