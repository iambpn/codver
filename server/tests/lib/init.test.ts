import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runInit } from "../../lib/init";

describe("runInit", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let exitSpy: ReturnType<typeof spyOn> | null = null;

  function spyOn(target: any, prop: string) {
    const original = target[prop];
    const calls: any[][] = [];
    const spy = (...args: any[]) => {
      calls.push(args);
    };
    (spy as any).mockRestore = () => {
      target[prop] = original;
    };
    (spy as any).calls = calls;
    target[prop] = spy;
    return spy;
  }

  beforeEach(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), "codver-init-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    exitSpy = spyOn(process, "exit");
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    exitSpy?.mockRestore();
    await rm(tmpHome, { recursive: true, force: true });
  });

  test("writes default config to ~/.config/codver/codver.config.json", async () => {
    await runInit({ force: false });

    const expected = path.join(tmpHome, ".config", "codver", "codver.config.json");
    const exists = await Bun.file(expected).exists();
    expect(exists).toBe(true);

    const content = await Bun.file(expected).text();
    const parsed = JSON.parse(content);
    expect(parsed.gitUserName).toBe("Your Name");
    expect(parsed.gitUserEmail).toBe("your.email@example.com");
    expect(parsed.defaultModel).toBe("anthropic/claude-sonnet-4-20250514");
  });

  test("creates ~/.config/codver if it does not exist", async () => {
    const configDir = path.join(tmpHome, ".config", "codver");
    // Bun.file().exists() returns false for directories, so use stat on the dir
    expect((await Bun.file(configDir).stat().catch(() => null))?.isDirectory()).toBeFalsy();

    await runInit({ force: false });

    const stat = await Bun.file(configDir).stat();
    expect(stat.isDirectory()).toBe(true);
  });

  test("refuses to overwrite existing config without --force", async () => {
    const expected = path.join(tmpHome, ".config", "codver", "codver.config.json");
    await Bun.write(expected, JSON.stringify({ existing: true }));

    await runInit({ force: false });

    expect(exitSpy).toBeDefined();
    expect(exitSpy!.calls.length).toBeGreaterThan(0);
    expect(exitSpy!.calls[0][0]).toBe(1);

    const content = await Bun.file(expected).text();
    expect(JSON.parse(content)).toEqual({ existing: true });
  });

  test("overwrites existing config with --force", async () => {
    const expected = path.join(tmpHome, ".config", "codver", "codver.config.json");
    await Bun.write(expected, JSON.stringify({ existing: true }));

    await runInit({ force: true });

    expect(exitSpy!.calls.length).toBe(0);

    const content = await Bun.file(expected).text();
    const parsed = JSON.parse(content);
    expect(parsed.gitUserName).toBe("Your Name");
    expect(parsed.defaultModel).toBe("anthropic/claude-sonnet-4-20250514");
  });

  test("--path writes to an explicit location", async () => {
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "codver-init-custom-"));
    const target = path.join(targetDir, "my-config.json");

    try {
      await runInit({ force: false, path: target });

      const exists = await Bun.file(target).exists();
      expect(exists).toBe(true);

      const parsed = JSON.parse(await Bun.file(target).text());
      expect(parsed.defaultModel).toBe("anthropic/claude-sonnet-4-20250514");

      const globalPath = path.join(tmpHome, ".config", "codver", "codver.config.json");
      expect(await Bun.file(globalPath).exists()).toBe(false);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});
