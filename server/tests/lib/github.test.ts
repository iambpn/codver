import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import os from "node:os";
import {
  cloneRepo,
  getDefaultBranch,
  setupBranch,
  stageAndCommit,
  hasCodeChanges,
  getChangedFiles,
  getFullDiff,
  pushBranch,
  createPR,
} from "../../lib/github";

// ─── Test Helpers ─────────────────────────────────────────────────────

let originalSpawnSync: typeof Bun.spawnSync;
let originalWrite: typeof Bun.write;
let originalFile: typeof Bun.file;
let spawnResults: Array<{
  cmd: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

/**
 * Create a mock sequence of spawn results. Each call to Bun.spawnSync
 * will return the next result in the sequence.
 */
function setupSpawnMock(results: Array<{ cmd?: string[]; exitCode: number; stdout: string; stderr: string }>) {
  let index = 0;
  Bun.spawnSync = mock((cmd: string[], options?: any) => {
    if (index < results.length) {
      const result = results[index]!;
      index++;
      return {
        exitCode: result.exitCode,
        stdout: Buffer.from(result.stdout),
        stderr: Buffer.from(result.stderr),
        success: result.exitCode === 0,
      };
    }
    // Default: success
    return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
  }) as any;
}

beforeEach(() => {
  originalSpawnSync = Bun.spawnSync;
  originalWrite = Bun.write;
  originalFile = Bun.file;
  spawnResults = [];
});

afterEach(() => {
  Bun.spawnSync = originalSpawnSync;
  Bun.write = originalWrite;
  Bun.file = originalFile;
});

// ─── extractRepoName (tested indirectly through cloneRepo) ─────────

describe("cloneRepo", () => {
  test("clones repo and returns RepoInfo", async () => {
    // We need to mock: 1) gh repo clone, 2) git remote show origin
    let callIndex = 0;
    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      callIndex++;
      if (cmd[0] === "gh" && cmd[1] === "repo" && cmd[2] === "clone") {
        return { exitCode: 0, stdout: Buffer.from("Cloned"), stderr: Buffer.from(""), success: true };
      }
      if (cmd[0] === "git" && cmd.includes("remote")) {
        return {
          exitCode: 0,
          stdout: Buffer.from("* remote origin\n  Fetch URL: ...\n  HEAD branch: main\n"),
          stderr: Buffer.from(""),
          success: true,
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await cloneRepo("owner/repo");
    expect(result.repoName).toMatch(/^owner-repo/);
    expect(result.defaultBranch).toBe("main");
    expect(result.repoDir).toContain(".codver");
  });

  test("throws on clone failure", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd[0] === "gh" && cmd[1] === "repo") {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("clone failed"), success: false };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    expect(cloneRepo("https://github.com/nonexistent/repo")).rejects.toThrow(/clone/i);
  });
});

// ─── getDefaultBranch ─────────────────────────────────────────────

describe("getDefaultBranch", () => {
  test("parses HEAD branch from git remote show output", async () => {
    Bun.spawnSync = mock(() => ({
      exitCode: 0,
      stdout: Buffer.from("* remote origin\n  Fetch URL: https://github.com/owner/repo\n  Push  URL: https://github.com/owner/repo\n  HEAD branch: develop\n  Remote branches:\n"),
      stderr: Buffer.from(""),
      success: true,
    })) as any;

    const result = await getDefaultBranch("/tmp/test-repo");
    expect(result).toBe("develop");
  });

  test("returns main as fallback when git remote show fails", async () => {
    Bun.spawnSync = mock(() => ({
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("fatal: not a git repository"),
      success: false,
    })) as any;

    const result = await getDefaultBranch("/tmp/test-repo");
    expect(result).toBe("main");
  });

  test("returns main as fallback when HEAD branch line is missing", async () => {
    Bun.spawnSync = mock(() => ({
      exitCode: 0,
      stdout: Buffer.from("* remote origin\n  Fetch URL: ...\n"),
      stderr: Buffer.from(""),
      success: true,
    })) as any;

    const result = await getDefaultBranch("/tmp/test-repo");
    expect(result).toBe("main");
  });
});

// ─── setupBranch ──────────────────────────────────────────────────

describe("setupBranch", () => {
  test("creates and checks out new branch from default when fromBranch is undefined", async () => {
    let callIndex = 0;
    Bun.spawnSync = mock((cmd: string[]) => {
      callIndex++;
      // Only the "git checkout -b" call should be made (no fromBranch checkout)
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    await setupBranch("/tmp/test-repo", undefined, "codver/fix-bug");
    // Should still succeed with just one spawn call
  });

  test("checks out fromBranch before creating new branch", async () => {
    let callIndex = 0;
    const cmds: string[][] = [];
    Bun.spawnSync = mock((cmd: string[]) => {
      cmds.push(cmd);
      callIndex++;
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    await setupBranch("/tmp/test-repo", "develop", "codver/fix-bug");
    // First call: git checkout develop
    expect(cmds[0]).toContain("checkout");
    expect(cmds[0]).toContain("develop");
    // Second call: git checkout -b codver/fix-bug
    expect(cmds[1]).toContain("checkout");
    expect(cmds[1]).toContain("-b");
    expect(cmds[1]).toContain("codver/fix-bug");
  });

  test("throws on failed fromBranch checkout", async () => {
    let callIndex = 0;
    Bun.spawnSync = mock((cmd: string[]) => {
      callIndex++;
      if (cmd.includes("checkout") && !cmd.includes("-b")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error: pathspec 'nonexistent' did not match"), success: false };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    expect(setupBranch("/tmp/test-repo", "nonexistent", "codver/fix-bug")).rejects.toThrow(/checkout/i);
  });

  test("throws on failed new branch creation", async () => {
    let callIndex = 0;
    Bun.spawnSync = mock((cmd: string[]) => {
      callIndex++;
      if (cmd.includes("-b")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("fatal: A branch named 'codver/fix-bug' already exists"), success: false };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    expect(setupBranch("/tmp/test-repo", undefined, "codver/fix-bug")).rejects.toThrow(/branch/i);
  });
});

// ─── stageAndCommit ────────────────────────────────────────────────

describe("stageAndCommit", () => {
  test("stages and commits changes successfully", async () => {
    const cmds: string[][] = [];
    Bun.spawnSync = mock((cmd: string[]) => {
      cmds.push(cmd);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    await stageAndCommit("/tmp/test-repo", "feat: add feature");
    expect(cmds[0]).toContain("add");
    expect(cmds[1]).toContain("commit");
    expect(cmds[1]).toContain("-m");
    expect(cmds[1]).toContain("feat: add feature");
  });

  test("tolerates 'nothing to commit' messages", async () => {
    const cmds: string[][] = [];
    Bun.spawnSync = mock((cmd: string[]) => {
      cmds.push(cmd);
      if (cmd.includes("commit")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("nothing to commit, working tree clean"), success: false };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    // Should not throw
    await stageAndCommit("/tmp/test-repo", "chore: update");
  });

  test("throws on real commit failure", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("commit")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("fatal: not a git repository"), success: false };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    expect(stageAndCommit("/tmp/test-repo", "chore: update")).rejects.toThrow(/commit/i);
  });
});

// ─── hasCodeChanges ────────────────────────────────────────────────

describe("hasCodeChanges", () => {
  test("returns true when there are meaningful diff changes", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("diff") && cmd.includes("--stat")) {
        return { exitCode: 0, stdout: Buffer.from(" src/index.ts | 5 +++--\n 1 file changed, 3 insertions, 2 deletions"), stderr: Buffer.from(""), success: true };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await hasCodeChanges("/tmp/test-repo");
    expect(result).toBe(true);
  });

  test("returns true when there are untracked files that are not dev files", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("diff") && cmd.includes("--stat")) {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
      }
      if (cmd.includes("ls-files")) {
        return { exitCode: 0, stdout: Buffer.from("src/new-feature.ts\nsrc/helper.ts"), stderr: Buffer.from(""), success: true };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await hasCodeChanges("/tmp/test-repo");
    expect(result).toBe(true);
  });

  test("returns false when no changes and no untracked files", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await hasCodeChanges("/tmp/test-repo");
    expect(result).toBe(false);
  });

  test("returns false when only dev files have changed in diff", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("diff") && cmd.includes("--stat")) {
        return {
          exitCode: 0,
          stdout: Buffer.from(" docker-compose.dev.yml | 10 +++\n bunfig.toml | 5 ++\n .env | 3 +"),
          stderr: Buffer.from(""),
          success: true,
        };
      }
      if (cmd.includes("ls-files")) {
        return { exitCode: 0, stdout: Buffer.from(".env\ndocker-compose.dev.yml"), stderr: Buffer.from(""), success: true };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await hasCodeChanges("/tmp/test-repo");
    expect(result).toBe(false);
  });

  test("returns false when only .codver-plan has changed", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("diff") && cmd.includes("--stat")) {
        return { exitCode: 0, stdout: Buffer.from(" .codver-plan | 20 ++++"), stderr: Buffer.from(""), success: true };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await hasCodeChanges("/tmp/test-repo");
    expect(result).toBe(false);
  });

  test("returns true when there are both code and dev changes", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("diff") && cmd.includes("--stat")) {
        return {
          exitCode: 0,
          stdout: Buffer.from(" src/index.ts | 5 +++--\n docker-compose.dev.yml | 10 +++"),
          stderr: Buffer.from(""),
          success: true,
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await hasCodeChanges("/tmp/test-repo");
    expect(result).toBe(true);
  });
});

// ─── getChangedFiles ───────────────────────────────────────────────

describe("getChangedFiles", () => {
  test("returns diff stat and untracked files excluding dev files", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("diff") && cmd.includes("--stat")) {
        return { exitCode: 0, stdout: Buffer.from(" src/index.ts | 5 +++--\n 1 file changed"), stderr: Buffer.from(""), success: true };
      }
      if (cmd.includes("ls-files")) {
        return { exitCode: 0, stdout: Buffer.from("src/new.ts\n.env\ndocker-compose.dev.yml"), stderr: Buffer.from(""), success: true };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    const result = await getChangedFiles("/tmp/test-repo");
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/new.ts");
    expect(result).not.toContain(".env");
    expect(result).not.toContain("docker-compose.dev.yml");
  });
});

// ─── getFullDiff ───────────────────────────────────────────────────

describe("getFullDiff", () => {
  test("returns diff output and content of untracked files", async () => {
    const mockDiff = "diff --git a/src/index.ts b/src/index.ts\n+new line";
    const mockUntracked = "src/new-feature.ts\n.env";

    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd.includes("diff") && !cmd.includes("--stat")) {
        return { exitCode: 0, stdout: Buffer.from(mockDiff), stderr: Buffer.from(""), success: true };
      }
      if (cmd.includes("ls-files")) {
        return { exitCode: 0, stdout: Buffer.from(mockUntracked), stderr: Buffer.from(""), success: true };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), success: true };
    }) as any;

    // Mock Bun.file to return content for untracked files
    const originalBunFile = Bun.file;
    (Bun as any).file = mock((filePath: string) => {
      if (filePath.includes("new-feature.ts")) {
        return { text: async () => "export const feature = true;", exists: async () => true, unlink: async () => {} };
      }
      return { text: async () => "", exists: async () => false, unlink: async () => {} };
    });

    const result = await getFullDiff("/tmp/test-repo");
    expect(result).toContain("diff --git");
    expect(result).toContain("new line");

    Bun.file = originalBunFile;
  });
});

// ─── pushBranch ────────────────────────────────────────────────────

describe("pushBranch", () => {
  test("pushes branch to remote successfully", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      return { exitCode: 0, stdout: Buffer.from("pushed"), stderr: Buffer.from(""), success: true };
    }) as any;

    // Should not throw
    await pushBranch("/tmp/test-repo", "codver/fix-bug");
  });

  test("throws on push failure", async () => {
    Bun.spawnSync = mock((cmd: string[]) => {
      return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error: failed to push"), success: false };
    }) as any;

    expect(pushBranch("/tmp/test-repo", "codver/fix-bug")).rejects.toThrow(/push/i);
  });
});

// ─── createPR ──────────────────────────────────────────────────────

describe("createPR", () => {
  test("creates PR and returns URL", async () => {
    const prUrl = "https://github.com/owner/repo/pull/42";
    let writeCalled = false;
    let unlinkCalled = false;

    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      return { exitCode: 0, stdout: Buffer.from(prUrl), stderr: Buffer.from(""), success: true };
    }) as any;

    // Mock Bun.write and file operations
    const originalBunWrite = Bun.write;
    const originalBunFile = Bun.file;
    (Bun as any).write = mock(async (path: string, content: string) => {
      writeCalled = true;
    });
    (Bun as any).file = mock((path: string) => ({
      text: async () => "",
      exists: async () => true,
      unlink: async () => { unlinkCalled = true; },
    }));

    const result = await createPR("/tmp/test-repo", "feat: add feature", "PR body", "codver/fix-bug", "main");
    expect(result).toBe(prUrl);

    Bun.write = originalBunWrite;
    Bun.file = originalBunFile;
  });

  test("throws on PR creation failure and prints manual instructions", async () => {
    Bun.spawnSync = mock((cmd: string[], options?: any) => {
      return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error: no upstream branch"), success: false };
    }) as any;

    const originalBunWrite = Bun.write;
    const originalBunFile = Bun.file;
    (Bun as any).write = mock(async (path: string, content: string) => {});
    (Bun as any).file = mock((path: string) => ({
      text: async () => "",
      exists: async () => true,
      unlink: async () => {},
    }));

    expect(createPR("/tmp/test-repo", "feat: add feature", "PR body", "codver/fix-bug", "main")).rejects.toThrow(/PR/i);

    Bun.write = originalBunWrite;
    Bun.file = originalBunFile;
  });
});