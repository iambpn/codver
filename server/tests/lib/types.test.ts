import { test, expect, describe } from "bun:test";
import {
  PROVIDER_ENV_MAP,
  FALLBACK_ENV_VARS,
} from "../../lib/types";
import { GITIGNORE_ENTRIES } from "../../lib/paths";

describe("PROVIDER_ENV_MAP", () => {
  test("has entries for all expected providers", () => {
    const expectedProviders = [
      "anthropic",
      "openai",
      "google",
      "deepseek",
      "azure",
      "mistral",
      "groq",
      "cerebras",
      "xai",
      "openrouter",
      "huggingface",
      "fireworks",
      "together",
      "kimi",
      "minimax",
    ];

    for (const provider of expectedProviders) {
      expect(PROVIDER_ENV_MAP).toHaveProperty(provider);
      expect(Array.isArray(PROVIDER_ENV_MAP[provider])).toBe(true);
      expect(PROVIDER_ENV_MAP[provider]!.length).toBeGreaterThan(0);
    }
  });

  test("anthropic maps to ANTHROPIC_API_KEY", () => {
    expect(PROVIDER_ENV_MAP.anthropic).toEqual(["ANTHROPIC_API_KEY"]);
  });

  test("openai maps to OPENAI_API_KEY", () => {
    expect(PROVIDER_ENV_MAP.openai).toEqual(["OPENAI_API_KEY"]);
  });

  test("google maps to GOOGLE_API_KEY and GOOGLE_APPLICATION_CREDENTIALS", () => {
    expect(PROVIDER_ENV_MAP.google).toContain("GOOGLE_API_KEY");
    expect(PROVIDER_ENV_MAP.google).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });

  test("azure has both API key and endpoint", () => {
    expect(PROVIDER_ENV_MAP.azure).toContain("AZURE_OPENAI_API_KEY");
    expect(PROVIDER_ENV_MAP.azure).toContain("AZURE_OPENAI_ENDPOINT");
  });

  test("no provider maps to an empty array", () => {
    for (const [provider, vars] of Object.entries(PROVIDER_ENV_MAP)) {
      expect(vars!.length).toBeGreaterThan(0);
    }
  });

  test("all env var names are uppercase strings with underscores", () => {
    for (const [provider, vars] of Object.entries(PROVIDER_ENV_MAP)) {
      for (const v of vars!) {
        expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });
});

describe("FALLBACK_ENV_VARS", () => {
  test("contains common API key variable names", () => {
    expect(FALLBACK_ENV_VARS).toContain("ANTHROPIC_API_KEY");
    expect(FALLBACK_ENV_VARS).toContain("OPENAI_API_KEY");
    expect(FALLBACK_ENV_VARS).toContain("GOOGLE_API_KEY");
    expect(FALLBACK_ENV_VARS).toContain("DEEPSEEK_API_KEY");
    expect(FALLBACK_ENV_VARS).toContain("MISTRAL_API_KEY");
    expect(FALLBACK_ENV_VARS).toContain("GROQ_API_KEY");
    expect(FALLBACK_ENV_VARS).toContain("XAI_API_KEY");
    expect(FALLBACK_ENV_VARS).toContain("OPENROUTER_API_KEY");
  });

  test("is a non-empty array of strings", () => {
    expect(Array.isArray(FALLBACK_ENV_VARS)).toBe(true);
    expect(FALLBACK_ENV_VARS.length).toBeGreaterThan(0);
    for (const v of FALLBACK_ENV_VARS) {
      expect(typeof v).toBe("string");
    }
  });
});

describe("GITIGNORE_ENTRIES", () => {
  test("contains exactly 7 entries (1 comment + 6 file patterns)", () => {
    expect(GITIGNORE_ENTRIES).toHaveLength(7);
  });

  test("starts with a comment header", () => {
    expect(GITIGNORE_ENTRIES[0]).toBe("# Codver dev environment");
  });

  test("contains expected file patterns", () => {
    expect(GITIGNORE_ENTRIES).toContain("docker-compose.dev.yml");
    expect(GITIGNORE_ENTRIES).toContain("Dockerfile");
    expect(GITIGNORE_ENTRIES).toContain("bunfig.toml");
    expect(GITIGNORE_ENTRIES).toContain(".env");
    expect(GITIGNORE_ENTRIES).toContain(".codver-plan");
    expect(GITIGNORE_ENTRIES).toContain(".prototools.base");
  });

  test("comment header is first entry", () => {
    expect(GITIGNORE_ENTRIES[0]).toMatch(/^#/);
  });

  test("non-comment entries do not start with #", () => {
    for (const entry of GITIGNORE_ENTRIES.slice(1)) {
      expect(entry).not.toMatch(/^#/);
    }
  });
});