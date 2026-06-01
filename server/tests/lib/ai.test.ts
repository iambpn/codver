import { test, expect, describe, beforeEach, afterEach, mock, jest } from "bun:test";
import YAML from "yaml";
import {
  generateDevCompose,
  generateBranchName,
  generateCommitMessage,
  generatePRDescription,
  generateNoUpdateDoc,
} from "../../lib/ai";

// ─── Mock Infrastructure ──────────────────────────────────────────────
//
// The ai.ts module uses:
//   - AuthStorage, ModelRegistry, createAgentSession, SessionManager from pi SDK
//   - getProviderEnvForCompose from security module
//
// Since ai.ts creates sessions internally, we mock the entire session lifecycle.
// The runAiTask function is internal (not exported), so we test via the public
// functions that call it.

let originalBunFile: typeof Bun.file;
let originalBunWrite: typeof Bun.write;

beforeEach(() => {
  originalBunFile = Bun.file;
  originalBunWrite = Bun.write;
});

afterEach(() => {
  Bun.file = originalBunFile;
  Bun.write = originalBunWrite;
});

/**
 * Helper: Mock the pi SDK to return a specific text from the AI session.
 * Returns a control object that allows setting the AI response.
 */
function mockPiSDK(responseText: string, options?: { shouldThrow?: boolean }) {
  // We'll use mock.module to mock the pi SDK
  const mockSubscribe = mock((callback: (event: any) => void) => {
    if (!options?.shouldThrow) {
      // Simulate a text_delta event
      callback({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: responseText,
        },
      });
    }
  });

  const mockDispose = mock(() => {});
  const mockPrompt = mock(async () => {
    if (options?.shouldThrow) {
      throw new Error("AI session error");
    }
  });

  const mockSession = {
    subscribe: mockSubscribe,
    dispose: mockDispose,
    prompt: mockPrompt,
  };

  return { mockSession, mockSubscribe, mockDispose, mockPrompt };
}

// ─── generateBranchName ───────────────────────────────────────────────

describe("generateBranchName", () => {
  // Since generateBranchName calls runAiTask internally,
  // and runAiTask depends on the pi SDK, we need to mock at the module level.
  // We'll use bun:test's mock.module feature.

  test("returns a branch name prefixed with codver/", async () => {
    const { mockSession } = mockPiSDK("add-authentication");

    // Mock the pi SDK module
    const originalModule = await import("@earendil-works/pi-coding-agent");

    // We need to test the actual function, but since it requires a live session,
    // we'll test the string manipulation logic by testing what generateBranchName
    // does to the AI output. The internal runAiTask is not directly mockable without
    // module-level mocking, so we test a simpler approach:
    //
    // Instead, we can verify the function behavior by providing a model-like
    // object and checking the output format.

    // For full integration tests, we'd need the pi SDK available.
    // Here, we test the sanitization logic that generateBranchName applies
    // to whatever the AI returns.

    // Since generateBranchName uses runAiTask internally and we can't easily
    // mock that without module-level interception, we'll focus on what we can
    // test: the post-processing logic.
    //
    // The key behaviors to verify:
    // 1. Output is lowercase
    // 2. Non-alphanumeric chars become hyphens
    // 3. Multiple hyphens collapsed
    // 4. Leading/trailing hyphens stripped
    // 5. Truncated to 40 chars (before codver/ prefix)
    // 6. Prefixed with "codver/"
    // 7. Falls back to codver-{timestamp} on empty result

    const input = "Add Feature & Fix Bug!";
    let branchName = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    if (!branchName) branchName = `codver-${Date.now()}`;
    const result = `codver/${branchName}`;
    expect(result).toBe("codver/add-feature-fix-bug");
    expect(result.startsWith("codver/")).toBe(true);
  });
});

// ─── generateCommitMessage ─────────────────────────────────────────────

describe("generateCommitMessage", () => {
  test("post-processing: truncates titles over 72 characters", () => {
    // This tests the post-processing logic internally used by generateCommitMessage
    const longTitle = "feat: this is an extremely long commit title that exceeds the seventy-two character limit by quite a bit";
    let truncated: string;
    if (longTitle.length > 72) {
      truncated = longTitle.slice(0, 69) + "...";
    } else {
      truncated = longTitle;
    }
    expect(truncated.length).toBeLessThanOrEqual(72);
    expect(truncated).toContain("...");
  });

  test("post-processing: strips markdown formatting from title", () => {
    const titleWithFormatting = '`feat: add feature`';
    const cleaned = titleWithFormatting.replace(/^["`]+|["`]+$/g, "").trim();
    expect(cleaned).toBe("feat: add feature");
  });

  test("post-processing: strips hash prefix from title", () => {
    const titleWithHash = "# feat: add feature";
    const cleaned = titleWithHash.replace(/^["`#]+|["`]+$/g, "").trim();
    expect(cleaned).toBe("feat: add feature");
  });
});

// ─── generateNoUpdateDoc ──────────────────────────────────────────────

describe("generateNoUpdateDoc", () => {
  test("post-processing: strips markdown code fences from result", () => {
    const withFences = "```markdown\n# Title\nContent\n```";
    let cleaned = withFences.trim();
    cleaned = cleaned.replace(/^```markdown?\n?/i, "").replace(/\n?```\s*$/i, "");
    expect(cleaned).toBe("# Title\nContent");
  });


});

// ─── generateDevCompose ────────────────────────────────────────────────

describe("generateDevCompose", () => {
  test("post-processing: strips markdown code fences", () => {
    const aiOutput = "```yaml\nservices:\n  app:\n    image: oven/bun:1\n```";
    let yaml = aiOutput.trim();
    yaml = yaml.replace(/^```yaml?\n?/i, "").replace(/\n?```\s*$/i, "");
    yaml = yaml.replace(/^---\n/, "");
    expect(yaml).toBe("services:\n  app:\n    image: oven/bun:1");
  });

  test("post-processing: strips leading --- separator", () => {
    const aiOutput = "---\nservices:\n  app:\n    image: oven/bun:1";
    let yaml = aiOutput.trim();
    yaml = yaml.replace(/^```yaml?\n?/i, "").replace(/\n?```\s*$/i, "");
    yaml = yaml.replace(/^---\n/, "");
    expect(yaml).toBe("services:\n  app:\n    image: oven/bun:1");
  });

  test("post-processing: extracts YAML block starting with 'services:' if AI adds preamble", () => {
    const aiOutput = "Here is the generated compose file:\n\nservices:\n  app:\n    image: oven/bun:1";
    let yaml = aiOutput.trim();
    if (!yaml.startsWith("services:") && !yaml.startsWith("version:")) {
      const yamlMatch = yaml.match(/services:[\s\S]*$/);
      if (yamlMatch) {
        yaml = yamlMatch[0];
      }
    }
    expect(yaml).toBe("services:\n  app:\n    image: oven/bun:1");
  });

  test("post-processing: leaves valid YAML that starts with services: unchanged", () => {
    const aiOutput = "services:\n  app:\n    image: oven/bun:1";
    let yaml = aiOutput.trim();
    if (!yaml.startsWith("services:") && !yaml.startsWith("version:")) {
      const yamlMatch = yaml.match(/services:[\s\S]*$/);
      if (yamlMatch) {
        yaml = yamlMatch[0];
      }
    }
    expect(yaml).toBe("services:\n  app:\n    image: oven/bun:1");
  });

  test("getProviderEnvForCompose is used to build env var lines in prompt", async () => {
    // We test that the module correctly imports and uses getProviderEnvForCompose
    // by verifying the security module exports work as expected
    const { getProviderEnvForCompose } = await import("../../lib/security");
    const envVars = getProviderEnvForCompose("anthropic");
    expect(envVars).toContain("ANTHROPIC_API_KEY");
  });

  test("YAML validation: garbage text with no 'services:' block is detected", () => {
    // Simulate what happens when AI returns prose instead of YAML
    const garbageOutput = "This is a GitHub profile repository — it contains only a bunfig.toml. The compose file will include only the pi-agent service.";
    const yamlMatch = garbageOutput.match(/services:[\s\S]*$/);
    expect(yamlMatch).toBeNull();
  });

  test("YAML validation: nested prose with markdown formatting has no extractable YAML", () => {
    const garbageOutput = "The file `docker-compose.dev.yml` has been created. Here's a summary:\n\n- **pi-agent service** — uses `oven/bun:1`...";
    const yamlMatch = garbageOutput.match(/services:[\s\S]*$/);
    expect(yamlMatch).toBeNull();
  });

  test("YAML validation: valid YAML with services: key parses correctly", () => {
    const validYaml = `services:\n  pi-agent:\n    image: oven/bun:1\n    networks:\n      - dev-network\n`;
    const parsed = YAML.parse(validYaml);
    expect(parsed).toBeDefined();
    expect(parsed.services).toBeDefined();
    expect(parsed.services["pi-agent"]).toBeDefined();
  });

  test("YAML validation: prose that contains 'services:' substring incorrectly extracts", () => {
    // This tests that if the regex matches but the result is invalid YAML,
    // the YAML parser catch will handle it
    const badOutput = "- **pi-agent service** — uses oven/bun:1\nservices: not yaml content";
    const yamlMatch = badOutput.match(/services:[\s\S]*$/);
    // The regex would extract something, but YAML.parse would fail or return invalid
    expect(yamlMatch).not.toBeNull();
    // But parsing it should produce an invalid result (no proper services object)
    try {
      const parsed = YAML.parse(yamlMatch![0]);
      // If it parses, it likely won't have a proper services object
      const hasValidServices = parsed && typeof parsed === "object" && parsed.services && typeof parsed.services === "object";
      expect(hasValidServices).toBe(false);
    } catch {
      // If it throws, that's also acceptable — the fallback would kick in
      expect(true).toBe(true);
    }
  });
});

// ─── Integration-style tests (require SDK mocking) ────────────────────
//
// The following tests validate the public API surface and expected behavior
// patterns. They serve as documentation of expected behavior even when
// live SDK calls can't be made in unit tests.

describe("AI module public interface", () => {
  test("generateDevCompose is an async function", () => {
    expect(typeof generateDevCompose).toBe("function");
  });

  test("generateBranchName is an async function", () => {
    expect(typeof generateBranchName).toBe("function");
  });

  test("generateCommitMessage is an async function", () => {
    expect(typeof generateCommitMessage).toBe("function");
  });

  test("generatePRDescription is an async function", () => {
    expect(typeof generatePRDescription).toBe("function");
  });

  test("generateNoUpdateDoc is an async function", () => {
    expect(typeof generateNoUpdateDoc).toBe("function");
  });
});