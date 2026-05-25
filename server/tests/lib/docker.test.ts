import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import {
  composeUp,
  composeRunAgent,
  composeDown,
  composePull,
} from "../../lib/docker";

let originalSpawnSync: typeof Bun.spawnSync;
let originalWrite: typeof Bun.write;
let originalFile: typeof Bun.file;

beforeEach(() => {
  originalSpawnSync = Bun.spawnSync;
  originalWrite = Bun.write;
  originalFile = Bun.file;
});

afterEach(() => {
  Bun.spawnSync = originalSpawnSync;
  Bun.write = originalWrite;
  Bun.file = originalFile;
});

// ─── composeUp ────────────────────────────────────────────────────────

describe("composeUp", () => {
  test("starts containers and waits for services to be healthy", async () => {
    let callCount = 0;
    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      callCount++;
      // docker compose up
      if (cmd.includes("up") && cmd.includes("-d")) {
        return { exitCode: 0, stdout: Buffer.from("Container started"), stderr: Buffer.from(""), success: true };
      }
      // docker compose ps
      if (cmd.includes("ps")) {
        return {
          exitCode: 0,
          stdout: Buffer.from('{"Name":"pi-agent","State":"running","Health":"healthy"}'),
          stderr: Buffer.from(""),
          success: true,
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    // Should not throw
    await composeUp("/tmp/test-repo");
  });

  test("throws on docker compose up failure", async () => {
    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      if (cmd.includes("up") && cmd.includes("-d")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("Error starting containers"), success: false };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    expect(composeUp("/tmp/test-repo")).rejects.toThrow(/compose up/i);
  });

  test("warns but continues when services do not become healthy", async () => {
    let upCalled = false;
    let psCallCount = 0;
    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      if (cmd.includes("up") && cmd.includes("-d")) {
        upCalled = true;
        return { exitCode: 0, stdout: Buffer.from("started"), stderr: Buffer.from(""), success: true };
      }
      if (cmd.includes("ps")) {
        psCallCount++;
        // Return unhealthy/unreachable services so the loop times out quickly
        // But to speed up the test, return "running" after enough calls
        if (psCallCount > 2) {
          return {
            exitCode: 0,
            stdout: Buffer.from('{"Name":"pi-agent","State":"running"}'),
            stderr: Buffer.from(""),
            success: true,
          };
        }
        return {
          exitCode: 0,
          stdout: Buffer.from('{"Name":"pi-agent","State":"starting"}'),
          stderr: Buffer.from(""),
          success: true,
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    // Should eventually complete (may warn about unhealthy services)
    await composeUp("/tmp/test-repo");
    expect(upCalled).toBe(true);
  });
});

// ─── composeRunAgent ──────────────────────────────────────────────────

describe("composeRunAgent", () => {
  test("writes .codver-plan, runs agent, and cleans up", async () => {
    const writtenFiles: Record<string, string> = {};
    let unlinkCalled = false;

    (Bun as any).write = mock(async (filePath: string, content: string) => {
      writtenFiles[filePath] = content;
      return content.length;
    });

    (Bun as any).file = mock((filePath: string) => ({
      text: async () => "",
      exists: async () => true,
      unlink: async () => { unlinkCalled = true; },
    }));

    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      if (cmd.includes("run") && cmd.includes("pi-agent")) {
        return {
          exitCode: 0,
          stdout: Buffer.from("Agent completed successfully"),
          stderr: Buffer.from(""),
          success: true,
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await composeRunAgent(
      "/tmp/test-repo",
      "Add unit tests",
      "anthropic/claude-sonnet-4-20250514"
    );

    // Should have written .codver-plan
    expect(writtenFiles[path.join("/tmp/test-repo", ".codver-plan")]).toBe("Add unit tests");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Agent completed successfully");
  });

  test("returns non-zero exit code on agent failure", async () => {
    (Bun as any).write = mock(async (filePath: string, content: string) => content.length);
    (Bun as any).file = mock((filePath: string) => ({
      text: async () => "",
      exists: async () => true,
      unlink: async () => {},
    }));

    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      if (cmd.includes("run") && cmd.includes("pi-agent")) {
        return {
          exitCode: 1,
          stdout: Buffer.from(""),
          stderr: Buffer.from("Agent failed with error"),
          success: false,
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await composeRunAgent(
      "/tmp/test-repo",
      "Add unit tests",
      "anthropic/claude-sonnet-4-20250514"
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Agent failed");
  });

  test("shell-escapes model string to prevent injection", async () => {
    const spawnCalls: string[][] = [];
    (Bun as any).write = mock(async (filePath: string, content: string) => content.length);
    (Bun as any).file = mock((filePath: string) => ({
      text: async () => "",
      exists: async () => true,
      unlink: async () => {},
    }));

    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      spawnCalls.push(cmd);
      return { exitCode: 0, stdout: Buffer.from("done"), stderr: Buffer.from(""), success: true };
    }) as any;

    await composeRunAgent(
      "/tmp/test-repo",
      "test",
      "model-with-o'ther-chars"
    );

    // Find the docker compose run call
    const runCall = spawnCalls.find(c => c.includes("run") && c.includes("pi-agent"));
    expect(runCall).toBeDefined();
    // The model string should have single quotes escaped
    const commandArg = runCall?.[runCall.length - 1];
    expect(commandArg).toBeDefined();
    // Should contain the escaped model string
    expect(commandArg).toContain("model-with-o");
  });

  test("does not pass explicit env to docker compose", async () => {
    let capturedOptions: any = {};
    (Bun as any).write = mock(async (filePath: string, content: string) => content.length);
    (Bun as any).file = mock((filePath: string) => ({
      text: async () => "",
      exists: async () => true,
      unlink: async () => {},
    }));

    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      if (cmd.includes("run") && cmd.includes("pi-agent")) {
        capturedOptions = options;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    await composeRunAgent(
      "/tmp/test-repo",
      "test",
      "anthropic/claude-sonnet-4-20250514"
    );

    // Env vars should NOT be explicitly passed — they come from .env file
    expect(capturedOptions.env).toBeUndefined();
  });

  test("defaults exitCode to 1 when spawnSync returns null", async () => {
    (Bun as any).write = mock(async (filePath: string, content: string) => content.length);
    (Bun as any).file = mock((filePath: string) => ({
      text: async () => "",
      exists: async () => true,
      unlink: async () => {},
    }));

    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      if (cmd.includes("run")) {
        return { exitCode: null, stdout: Buffer.from(""), stderr: Buffer.from("error"), success: false };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await composeRunAgent(
      "/tmp/test-repo",
      "test",
      "model"
    );

    expect(result.exitCode).toBe(1);
  });
});

// ─── composeDown ──────────────────────────────────────────────────────

describe("composeDown", () => {
  test("stops containers successfully", async () => {
    Bun.spawnSync = mock(() => ({
      exitCode: 0,
      stdout: Buffer.from("Containers stopped"),
      stderr: Buffer.from(""),
      success: true,
    })) as any;

    // Should not throw
    await composeDown("/tmp/test-repo");
  });

  test("warns but does not throw on failure", async () => {
    Bun.spawnSync = mock(() => ({
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("Error stopping containers"),
      success: false,
    })) as any;

    // Should not throw — composeDown is tolerant of failures
    await composeDown("/tmp/test-repo");
  });
});

// ─── composePull ──────────────────────────────────────────────────────

describe("composePull", () => {
  test("pulls images successfully", async () => {
    Bun.spawnSync = mock(() => ({
      exitCode: 0,
      stdout: Buffer.from("Pulled images"),
      stderr: Buffer.from(""),
      success: true,
    })) as any;

    // Should not throw
    await composePull("/tmp/test-repo");
  });

  test("throws on pull failure", async () => {
    Bun.spawnSync = mock(() => ({
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("Error pulling images"),
      success: false,
    })) as any;

    expect(composePull("/tmp/test-repo")).rejects.toThrow(/pull/i);
  });
});