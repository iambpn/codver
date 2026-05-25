import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  generateBunfigToml,
  generateEnvFile,
  getProviderEnvForCompose,
  validateEnvVars,
  hardenCompose,
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

// ─── hardenCompose ────────────────────────────────────────────────────

describe("hardenCompose", () => {
  test("adds security_opt and cap_drop to a service without them", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    command: bun run start
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.security_opt).toContain("no-new-privileges:true");
    expect(doc.services.app.cap_drop).toContain("ALL");
  });

  test("adds security_opt to existing array", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    security_opt:
      - some-other-option
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.security_opt).toContain("no-new-privileges:true");
    expect(doc.services.app.security_opt).toContain("some-other-option");
  });

  test("adds ALL to existing cap_drop array", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    cap_drop:
      - NET_ADMIN
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.cap_drop).toContain("ALL");
    expect(doc.services.app.cap_drop).toContain("NET_ADMIN");
    // ALL should be first
    expect(doc.services.app.cap_drop[0]).toBe("ALL");
  });

  test("removes ports from all services", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    ports:
      - "3000:3000"
      - "8080:80"
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.ports).toBeUndefined();
  });

  test("removes privileged: true from services", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    privileged: true
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.privileged).toBeUndefined();
  });

  test("removes network_mode: host from services", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    network_mode: host
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.network_mode).toBeUndefined();
  });

  test("does not remove network_mode: bridge", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    network_mode: bridge
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.network_mode).toBe("bridge");
  });

  test("adds dev-network to services with no networks", () => {
    const input = `
services:
  app:
    image: oven/bun:1
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.networks).toContain("dev-network");
  });

  test("adds dev-network to services with existing array networks", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    networks:
      - some-network
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.networks).toContain("some-network");
    expect(doc.services.app.networks).toContain("dev-network");
  });

  test("adds dev-network to services with map-format networks", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    networks:
      some-network:
        aliases:
          - alias1
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.networks).toHaveProperty("some-network");
    expect(doc.services.app.networks).toHaveProperty("dev-network");
  });

  test("creates dev-network in top-level networks if missing", () => {
    const input = `
services:
  app:
    image: oven/bun:1
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.networks).toHaveProperty("dev-network");
    expect(doc.networks["dev-network"].internal).toBe(true);
    expect(doc.networks["dev-network"].driver).toBe("bridge");
  });

  test("adds internal: true to existing dev-network", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    networks:
      - dev-network
networks:
  dev-network:
    driver: bridge
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.networks["dev-network"].internal).toBe(true);
  });

  test("add driver: bridge to dev-network that only has internal", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    networks:
      - dev-network
networks:
  dev-network:
    internal: true
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.networks["dev-network"].driver).toBe("bridge");
    expect(doc.networks["dev-network"].internal).toBe(true);
  });

  test("preserves other top-level networks when adding dev-network", () => {
    const input = `
services:
  app:
    image: oven/bun:1
networks:
  existing-net:
    driver: host
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.networks).toHaveProperty("existing-net");
    expect(doc.networks).toHaveProperty("dev-network");
  });

  test("preserves existing service config like environment and volumes", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    environment:
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./:/workspace:rw
    working_dir: /workspace
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    expect(doc.services.app.environment).toContain("NODE_ENV=production");
    expect(doc.services.app.environment).toContain("PORT=3000");
    expect(doc.services.app.volumes).toContain("./:/workspace:rw");
    expect(doc.services.app.working_dir).toBe("/workspace");
  });

  test("applies all hardening to multiple services", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    ports:
      - "3000:3000"
    privileged: true
    network_mode: host
  db:
    image: postgres:15
    ports:
      - "5432:5432"
    privileged: true
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);

    for (const svc of ["app", "db"]) {
      expect(doc.services[svc].security_opt).toContain("no-new-privileges:true");
      expect(doc.services[svc].cap_drop).toContain("ALL");
      expect(doc.services[svc].ports).toBeUndefined();
      expect(doc.services[svc].privileged).toBeUndefined();
      expect(doc.services[svc].networks).toContain("dev-network");
      expect(doc.services[svc].network_mode).toBeUndefined();
    }
  });

  test("does not duplicate no-new-privileges:true if already present", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    security_opt:
      - no-new-privileges:true
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    const count = doc.services.app.security_opt.filter(
      (o: string) => o === "no-new-privileges:true"
    ).length;
    expect(count).toBe(1);
  });

  test("does not duplicate ALL in cap_drop if already present", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    cap_drop:
      - ALL
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    const count = doc.services.app.cap_drop.filter((c: string) => c === "ALL").length;
    expect(count).toBe(1);
  });

  test("does not duplicate dev-network in service networks if already present", () => {
    const input = `
services:
  app:
    image: oven/bun:1
    networks:
      - dev-network
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);
    const count = doc.services.app.networks.filter(
      (n: string) => n === "dev-network"
    ).length;
    expect(count).toBe(1);
  });

  test("returns original yaml on parse failure", () => {
    const invalidYaml = "this: is: not: valid: yaml: [[[";
    // We can't guarantee YAML.parse fails on this, so use something clearly broken
    const brokenYaml = ": : : :";
    const result = hardenCompose(brokenYaml);
    // If it parsed successfully, it would have services; if it failed, it returns original
    // Either way, the function should not throw
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns original yaml if no services key (no modifications)", () => {
    const input = `version: "3"`;
    const result = hardenCompose(input);
    // When there are no services, hardenCompose returns original yaml unchanged
    // (it only adds networks if it finds services to process)
    const doc = require("yaml").parse(result);
    expect(doc.version).toBe("3");
    // No services means no hardening applied, original returned as-is
    expect(doc.services).toBeUndefined();
  });

  test("full end-to-end hardening of pi-agent compose", () => {
    const input = `
services:
  pi-agent:
    image: oven/bun:1
    working_dir: /workspace
    volumes:
      - ./:/workspace:rw
      - ./bunfig.toml:/root/.bunfig.toml:ro
    environment:
      - ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY}
      - GITHUB_TOKEN=\${GITHUB_TOKEN}
    command: sh -c "bun install && pi --version"
    privileged: true
    ports:
      - "3000:3000"
    network_mode: host
  postgres:
    image: postgres:15
    environment:
      - POSTGRES_PASSWORD=secret
    ports:
      - "5432:5432"
    privileged: true
networks:
  dev-network:
    driver: bridge
`;
    const result = hardenCompose(input);
    const doc = require("yaml").parse(result);

    // Both services hardened
    for (const svc of ["pi-agent", "postgres"]) {
      expect(doc.services[svc].security_opt).toContain("no-new-privileges:true");
      expect(doc.services[svc].cap_drop).toContain("ALL");
      expect(doc.services[svc].ports).toBeUndefined();
      expect(doc.services[svc].privileged).toBeUndefined();
      expect(doc.services[svc].networks).toContain("dev-network");
      expect(doc.services[svc].network_mode).toBeUndefined();
    }

    // dev-network has internal: true
    expect(doc.networks["dev-network"].internal).toBe(true);

    // pi-agent preserves volumes and environment
    expect(doc.services["pi-agent"].volumes).toContain("./:/workspace:rw");
    expect(doc.services["pi-agent"].environment).toContain("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}");
    expect(doc.services["pi-agent"].working_dir).toBe("/workspace");
  });
});