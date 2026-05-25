import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  heading,
  step,
  spinningStep,
  info,
  success,
  warn,
  error,
  substep,
  blankLine,
  RESET,
  BOLD,
  RED,
  GREEN,
  YELLOW,
  CYAN,
  DIM,
} from "../../lib/progress";

// Helper to capture stdout.write calls
function captureStdout(fn: () => void): string[] {
  const original = process.stdout.write;
  const captured: string[] = [];
  // @ts-expect-error - mocking
  process.stdout.write = (data: string) => {
    captured.push(data);
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

async function captureStdoutAsync(fn: () => Promise<void>): Promise<string[]> {
  const original = process.stdout.write;
  const captured: string[] = [];
  // @ts-expect-error - mocking
  process.stdout.write = (data: string) => {
    captured.push(data);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

// ─── ANSI Constants ──────────────────────────────────────────────────

describe("ANSI constants", () => {
  test("RESET is correct escape sequence", () => {
    expect(RESET).toBe("\x1b[0m");
  });

  test("BOLD is correct escape sequence", () => {
    expect(BOLD).toBe("\x1b[1m");
  });

  test("RED is correct escape sequence", () => {
    expect(RED).toBe("\x1b[31m");
  });

  test("GREEN is correct escape sequence", () => {
    expect(GREEN).toBe("\x1b[32m");
  });

  test("YELLOW is correct escape sequence", () => {
    expect(YELLOW).toBe("\x1b[33m");
  });

  test("CYAN is correct escape sequence", () => {
    expect(CYAN).toBe("\x1b[36m");
  });

  test("DIM is correct escape sequence", () => {
    expect(DIM).toBe("\x1b[2m");
  });
});

// ─── Simple output functions ──────────────────────────────────────────

describe("info()", () => {
  test("outputs dim arrow + message", () => {
    const output = captureStdout(() => info("test message"));
    const combined = output.join("");
    expect(combined).toContain("test message");
    expect(combined).toContain(DIM);
    expect(combined).toContain("→");
  });
});

describe("success()", () => {
  test("outputs green checkmark + message", () => {
    const output = captureStdout(() => success("done"));
    const combined = output.join("");
    expect(combined).toContain("done");
    expect(combined).toContain(GREEN);
    expect(combined).toContain("✓");
  });
});

describe("warn()", () => {
  test("outputs yellow warning + message", () => {
    const output = captureStdout(() => warn("caution"));
    const combined = output.join("");
    expect(combined).toContain("caution");
    expect(combined).toContain(YELLOW);
    expect(combined).toContain("⚠");
  });
});

describe("error()", () => {
  test("outputs red X + message", () => {
    const output = captureStdout(() => error("failure"));
    const combined = output.join("");
    expect(combined).toContain("failure");
    expect(combined).toContain(RED);
    expect(combined).toContain("✗");
  });
});

describe("heading()", () => {
  test("outputs bold cyan heading with borders", () => {
    const output = captureStdout(() => heading("Phase 1"));
    const combined = output.join("");
    expect(combined).toContain("Phase 1");
    expect(combined).toContain(BOLD);
    expect(combined).toContain(CYAN);
    expect(combined).toContain("═══");
  });
});

describe("substep()", () => {
  test("outputs dim bullet + message", () => {
    const output = captureStdout(() => substep("sub-item"));
    const combined = output.join("");
    expect(combined).toContain("sub-item");
    expect(combined).toContain(DIM);
    expect(combined).toContain("‣");
  });
});

describe("blankLine()", () => {
  test("outputs a newline", () => {
    const output = captureStdout(() => blankLine());
    const combined = output.join("");
    expect(combined).toContain("\n");
  });
});

// ─── step() ────────────────────────────────────────────────────────

describe("step()", () => {
  test("returns the result of the async function on success", async () => {
    const result = await step("test step", async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  test("prints start marker and success marker", async () => {
    const output = await captureStdoutAsync(async () => {
      await step("doing work", async () => {});
    });
    const combined = output.join("");
    expect(combined).toContain("doing work");
    expect(combined).toContain("✓");
  });

  test("prints error marker and re-throws on failure", async () => {
    const output = await captureStdoutAsync(async () => {
      try {
        await step("failing step", async () => {
          throw new Error("boom");
        });
      } catch {
        // expected
      }
    });
    const combined = output.join("");
    expect(combined).toContain("✗");
    expect(combined).toContain("boom");
  });

  test("re-throws the error", async () => {
    expect(
      step("failing step", async () => {
        throw new Error("test error");
      })
    ).rejects.toThrow("test error");
  });
});

// ─── spinningStep() ────────────────────────────────────────────────

describe("spinningStep()", () => {
  test("returns the result of the async function on success", async () => {
    const result = await spinningStep("test spin", async () => {
      return "hello";
    });
    expect(result).toBe("hello");
  });

  test("prints success marker on success", async () => {
    const output = await captureStdoutAsync(async () => {
      await spinningStep("spinning", async () => {});
    });
    const combined = output.join("");
    expect(combined).toContain("spinning");
    expect(combined).toContain("✓");
  });

  test("prints error marker and re-throws on failure", async () => {
    const output = await captureStdoutAsync(async () => {
      try {
        await spinningStep("spin fail", async () => {
          throw new Error("spin error");
        });
      } catch {
        // expected
      }
    });
    const combined = output.join("");
    expect(combined).toContain("✗");
  });

  test("re-throws the error", async () => {
    expect(
      spinningStep("spin fail", async () => {
        throw new Error("spin error");
      })
    ).rejects.toThrow("spin error");
  });
});