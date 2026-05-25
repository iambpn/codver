import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  parseCliArgs,
  sanitizeBranchName,
  readPromptContentAsync,
  checkDependencies,
  ValidationError,
} from "../../lib/cli";
import type { CliArgs } from "../../lib/types";

// ─── ValidationError ──────────────────────────────────────────────────

describe("ValidationError", () => {
  test("is an instance of Error", () => {
    const err = new ValidationError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
  });

  test("has correct name property", () => {
    const err = new ValidationError("test");
    expect(err.name).toBe("ValidationError");
  });

  test("has correct message", () => {
    const err = new ValidationError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });
});

// ─── parseCliArgs ─────────────────────────────────────────────────────

describe("parseCliArgs", () => {
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalExit = process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  test("parses all required arguments correctly", () => {
    const result = parseCliArgsWithArgs([
      "--repo", "https://github.com/owner/repo",
      "--model", "anthropic/claude-sonnet-4-20250514",
      "--prompt", "Add unit tests",
    ]);
    expect(result.repo).toBe("https://github.com/owner/repo");
    expect(result.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.prompt).toBe("Add unit tests");
  });

  test("parses all optional arguments", () => {
    const result = parseCliArgsWithArgs([
      "--repo", "owner/repo",
      "--model", "sonnet",
      "--prompt", "fix bug",
      "--new-branch", "fix-bug",
      "--from-branch", "main",
    ]);
    expect(result.repo).toBe("owner/repo");
    expect(result.model).toBe("sonnet");
    expect(result.prompt).toBe("fix bug");
    expect(result.newBranch).toBe("fix-bug");
    expect(result.fromBranch).toBe("main");
  });

  test("parses --prompt-file argument", () => {
    const result = parseCliArgsWithArgs([
      "--repo", "owner/repo",
      "--model", "sonnet",
      "--prompt-file", "/tmp/task.md",
    ]);
    expect(result.promptFile).toBe("/tmp/task.md");
    expect(result.prompt).toBeUndefined();
  });

  test("throws ValidationError when --repo is missing", () => {
    expect(() =>
      parseCliArgsWithArgs(["--model", "sonnet", "--prompt", "test"])
    ).toThrow(ValidationError);
    expect(() =>
      parseCliArgsWithArgs(["--model", "sonnet", "--prompt", "test"])
    ).toThrow(/Missing required argument: --repo/);
  });

  test("throws ValidationError when --model is missing", () => {
    expect(() =>
      parseCliArgsWithArgs(["--repo", "owner/repo", "--prompt", "test"])
    ).toThrow(ValidationError);
    expect(() =>
      parseCliArgsWithArgs(["--repo", "owner/repo", "--prompt", "test"])
    ).toThrow(/Missing required argument: --model/);
  });

  test("throws ValidationError when neither --prompt nor --prompt-file is provided", () => {
    expect(() =>
      parseCliArgsWithArgs(["--repo", "owner/repo", "--model", "sonnet"])
    ).toThrow(ValidationError);
    expect(() =>
      parseCliArgsWithArgs(["--repo", "owner/repo", "--model", "sonnet"])
    ).toThrow(/Either --prompt or --prompt-file must be provided/);
  });

  test("throws ValidationError when both --prompt and --prompt-file are provided", () => {
    expect(() =>
      parseCliArgsWithArgs([
        "--repo", "owner/repo",
        "--model", "sonnet",
        "--prompt", "test",
        "--prompt-file", "/tmp/task.md",
      ])
    ).toThrow(ValidationError);
    expect(() =>
      parseCliArgsWithArgs([
        "--repo", "owner/repo",
        "--model", "sonnet",
        "--prompt", "test",
        "--prompt-file", "/tmp/task.md",
      ])
    ).toThrow(/Cannot use both --prompt and --prompt-file/);
  });

  test("optional args default to undefined when not provided", () => {
    const result = parseCliArgsWithArgs([
      "--repo", "owner/repo",
      "--model", "sonnet",
      "--prompt", "test",
    ]);
    expect(result.newBranch).toBeUndefined();
    expect(result.fromBranch).toBeUndefined();
  });

  test("--help triggers process.exit(0)", () => {
    let exitCode = -1;
    // @ts-expect-error - mocking process.exit
    process.exit = (code: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code}`);
    };

    expect(() =>
      parseCliArgsWithArgs(["--help"])
    ).toThrow(/EXIT:0/);
    expect(exitCode).toBe(0);
  });
});

/**
 * Helper: calls parseCliArgs with process.argv spoofed.
 * parseCliArgs uses node:util parseArgs which reads from process.argv.
 */
function parseCliArgsWithArgs(userArgs: string[]): CliArgs {
  const savedArgv = process.argv;
  process.argv = ["bun", "codver.ts", ...userArgs];
  try {
    return parseCliArgs();
  } finally {
    process.argv = savedArgv;
  }
}

// ─── sanitizeBranchName ──────────────────────────────────────────────

describe("sanitizeBranchName", () => {
  test("converts to lowercase", () => {
    expect(sanitizeBranchName("Add-Feature")).toBe("add-feature");
  });

  test("replaces non-alphanumeric/non-hyphen chars with hyphens", () => {
    expect(sanitizeBranchName("add feature & fix bug")).toBe("add-feature-fix-bug");
  });

  test("replaces forward slashes with hyphens", () => {
    expect(sanitizeBranchName("feat/add-auth")).toBe("feat-add-auth");
  });

  test("collapses multiple consecutive hyphens", () => {
    expect(sanitizeBranchName("hello---world")).toBe("hello-world");
  });

  test("strips leading hyphens", () => {
    expect(sanitizeBranchName("---hello")).toBe("hello");
  });

  test("strips trailing hyphens", () => {
    expect(sanitizeBranchName("hello---")).toBe("hello");
  });

  test("truncates to 50 characters", () => {
    const long = "a".repeat(100);
    expect(sanitizeBranchName(long).length).toBe(50);
  });

  test("handles empty string", () => {
    expect(sanitizeBranchName("")).toBe("");
  });

  test("handles string of only special characters", () => {
    expect(sanitizeBranchName("@#$%")).toBe("");
  });

  test("preserves hyphens and alphanumerics", () => {
    expect(sanitizeBranchName("fix-login-bug-123")).toBe("fix-login-bug-123");
  });

  test("handles underscores as non-alphanumeric", () => {
    expect(sanitizeBranchName("add_feature")).toBe("add-feature");
  });

  test("handles dots as non-alphanumeric", () => {
    expect(sanitizeBranchName("v2.0.release")).toBe("v2-0-release");
  });

  test("handles mixed case and special chars", () => {
    expect(sanitizeBranchName("Feat: Add OAuth2.0 Support!")).toBe(
      "feat-add-oauth2-0-support"
    );
  });
});

// ─── readPromptContentAsync ──────────────────────────────────────────

describe("readPromptContentAsync", () => {
  test("returns prompt string directly when args.prompt is set", async () => {
    const args: CliArgs = {
      repo: "owner/repo",
      model: "sonnet",
      prompt: "Add unit tests",
    };
    const result = await readPromptContentAsync(args);
    expect(result).toBe("Add unit tests");
  });

  test("reads file content when args.promptFile is set", async () => {
    // Create a temp file
    const tmpPath = `/tmp/codver-test-prompt-${Date.now()}.md`;
    await Bun.write(tmpPath, "This is the task description");

    const args: CliArgs = {
      repo: "owner/repo",
      model: "sonnet",
      promptFile: tmpPath,
    };
    const result = await readPromptContentAsync(args);
    expect(result).toBe("This is the task description");

    // Cleanup
    await Bun.file(tmpPath).unlink();
  });

  test("throws ValidationError for missing prompt file", async () => {
    const args: CliArgs = {
      repo: "owner/repo",
      model: "sonnet",
      promptFile: "/tmp/nonexistent-file-xyz.md",
    };
    expect(readPromptContentAsync(args)).rejects.toThrow(ValidationError);
    expect(readPromptContentAsync(args)).rejects.toThrow(/not found/);
  });

  test("throws ValidationError for empty prompt file", async () => {
    const tmpPath = `/tmp/codver-test-empty-${Date.now()}.md`;
    await Bun.write(tmpPath, "   \n\n  \t  ");

    const args: CliArgs = {
      repo: "owner/repo",
      model: "sonnet",
      promptFile: tmpPath,
    };
    expect(readPromptContentAsync(args)).rejects.toThrow(ValidationError);
    expect(readPromptContentAsync(args)).rejects.toThrow(/empty/);

    // Cleanup
    await Bun.file(tmpPath).unlink();
  });

  test("throws ValidationError when neither prompt nor promptFile provided", async () => {
    const args: CliArgs = {
      repo: "owner/repo",
      model: "sonnet",
    };
    expect(readPromptContentAsync(args)).rejects.toThrow(ValidationError);
    expect(readPromptContentAsync(args)).rejects.toThrow(/No prompt provided/);
  });

  test("prefers prompt over promptFile", async () => {
    const args: CliArgs = {
      repo: "owner/repo",
      model: "sonnet",
      prompt: "direct prompt",
      promptFile: "/tmp/should-not-be-read.md",
    };
    // If both are set, prompt is used
    const result = await readPromptContentAsync(args);
    expect(result).toBe("direct prompt");
  });
});

// ─── checkDependencies ────────────────────────────────────────────────

describe("checkDependencies", () => {
  let originalSpawnSync: typeof Bun.spawnSync;

  beforeEach(() => {
    originalSpawnSync = Bun.spawnSync;
  });

  afterEach(() => {
    Bun.spawnSync = originalSpawnSync;
  });

  // All default success responses for the host dependency checks
  const defaultSuccessResponses: Record<string, { exitCode: number; stdout: string; stderr: string }> = {
    "git --version": { exitCode: 0, stdout: "git version 2.43.0", stderr: "" },
    "gh --version": { exitCode: 0, stdout: "gh version 2.40.0", stderr: "" },
    "gh auth status": { exitCode: 0, stdout: "Logged in to github.com account user", stderr: "" },
    "docker --version": { exitCode: 0, stdout: "Docker version 24.0.0", stderr: "" },
    "docker info": { exitCode: 0, stdout: "Server: Docker Engine", stderr: "" },
    "docker compose version": { exitCode: 0, stdout: "Docker Compose version v2.24.0", stderr: "" },
  };

  function mockSpawnSync(responses: Record<string, { exitCode: number; stdout: string; stderr: string }>) {
    const merged = { ...defaultSuccessResponses, ...responses };
    Bun.spawnSync = mock((cmd: string[]) => {
      const key = cmd.join(" ");
      const resp = merged[key];
      if (resp) {
        return {
          exitCode: resp.exitCode,
          stdout: Buffer.from(resp.stdout),
          stderr: Buffer.from(resp.stderr),
          success: resp.exitCode === 0,
        };
      }
      return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("unknown command"), success: false };
    });
  }

  test("passes when all dependencies are available and authenticated", async () => {
    mockSpawnSync({});
    // Should not throw
    await checkDependencies();
  });

  test("throws ValidationError when Git is not available", async () => {
    mockSpawnSync({
      "git --version": { exitCode: 1, stdout: "", stderr: "not found" },
    });
    await expect(checkDependencies()).rejects.toThrow(ValidationError);
    await expect(checkDependencies()).rejects.toThrow(/Git/);
  });

  test("throws ValidationError when gh CLI is not available", async () => {
    mockSpawnSync({
      "gh --version": { exitCode: 1, stdout: "", stderr: "not found" },
    });
    await expect(checkDependencies()).rejects.toThrow(ValidationError);
    await expect(checkDependencies()).rejects.toThrow(/GitHub CLI/);
  });

  test("throws ValidationError when gh CLI is not authenticated", async () => {
    mockSpawnSync({
      "gh auth status": { exitCode: 1, stdout: "", stderr: "not logged in to any hosts" },
    });
    await expect(checkDependencies()).rejects.toThrow(ValidationError);
    await expect(checkDependencies()).rejects.toThrow(/not authenticated/);
  });

  test("throws ValidationError when Docker is not available", async () => {
    mockSpawnSync({
      "docker --version": { exitCode: 1, stdout: "", stderr: "not found" },
    });
    await expect(checkDependencies()).rejects.toThrow(ValidationError);
    await expect(checkDependencies()).rejects.toThrow(/Docker/);
  });

  test("throws ValidationError when Docker daemon is not running", async () => {
    mockSpawnSync({
      "docker info": { exitCode: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" },
    });
    await expect(checkDependencies()).rejects.toThrow(ValidationError);
    await expect(checkDependencies()).rejects.toThrow(/not running/);
  });

  test("throws ValidationError when Docker Compose is not available", async () => {
    mockSpawnSync({
      "docker compose version": { exitCode: 1, stdout: "", stderr: "not found" },
    });
    await expect(checkDependencies()).rejects.toThrow(ValidationError);
    await expect(checkDependencies()).rejects.toThrow(/Docker Compose/);
  });
});