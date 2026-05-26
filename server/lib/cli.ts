import { parseArgs } from "node:util";
import type { CliArgs } from "./types";
import { heading, error, info, success } from "./progress";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

/**
 * Custom error class for validation failures that should cause process exit.
 * Thrown by validation functions; caught by main() which calls process.exit(1).
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                    Codver — Code Agent Runner            ║
╚══════════════════════════════════════════════════════════╝

Usage:
  bun run codver.ts [options]              Run the main pipeline
  bun run codver.ts clean [options]        Remove output artifacts

Subcommands:
  clean                   Remove Codver output directories and files
                          (run 'bun run codver.ts clean --help' for details)

Required (for main pipeline):
  --repo <url>             GitHub repository URL to clone
  --prompt <text>         Direct prompt text (mutually exclusive with --prompt-file)
  --prompt-file <path>    Path to a prompt file (mutually exclusive with --prompt)

  At least one of --model or config defaultModel must be provided:
  --model <provider/id>    Model for the pi agent task inside the container
                           (e.g., anthropic/claude-sonnet-4-20250514)

Optional (for main pipeline):
  --config <path>          Path to a config JSON file
                           (default: ~/.config/.codver)
  --new-branch <name>     Name for the new branch (auto-generated if omitted)
  --from-branch <name>    Base branch to work from (defaults to repo's default branch)

Configuration file (~/.config/.codver):
  The config file is optional. When present, it may contain:

    gitUserName     Git user.name to set in the cloned repo (local config)
    gitUserEmail    Git user.email to set in the cloned repo (local config)
    defaultModel    Model for host-side generative tasks (branch naming,
                    commit messages, PR descriptions, dev-compose, gitignore).
                    Falls back to --model if not set.

Host Dependencies (must be installed and configured on the host):
  gh CLI                     GitHub CLI — https://cli.github.com/
                             Must be authenticated (gh auth login)
  git                        Version control — https://git-scm.com/
  docker                     Container runtime — https://docs.docker.com/get-docker/
  docker compose              Container orchestration (included with Docker Desktop)

Provider API Keys (set as environment variables):
  ANTHROPIC_API_KEY            Required if using Anthropic models
  OPENAI_API_KEY               Required if using OpenAI models
  <PROVIDER>_API_KEY           Required for other providers

Examples:
  bun run codver.ts --repo https://github.com/owner/repo --model anthropic/claude-sonnet-4-20250514 --prompt "Add unit tests"
  bun run codver.ts --repo owner/repo --model sonnet --prompt-file task.md --new-branch add-tests --from-branch main
  bun run codver.ts --repo owner/repo --prompt "Add unit tests"  # uses defaultModel from config
  bun run codver.ts --config ./my-config.json --repo owner/repo --model sonnet --prompt "fix bug"
  bun run codver.ts clean --dry-run
`);
}

export function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      model: { type: "string" },
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      "new-branch": { type: "string" },
      "from-branch": { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values["help"]) {
    printHelp();
    process.exit(0);
  }

  const repo = values["repo"] as string | undefined;
  const model = values["model"] as string | undefined;
  const prompt = values["prompt"] as string | undefined;
  const promptFile = values["prompt-file"] as string | undefined;
  const newBranch = values["new-branch"] as string | undefined;
  const fromBranch = values["from-branch"] as string | undefined;
  const configPath = values["config"] as string | undefined;

  // Validate required args
  // --model is no longer strictly required here — it can come from config.defaultModel.
  // The final check happens in resolveModels() after config is loaded.
  if (!repo) {
    throw new ValidationError("Missing required argument: --repo\nUsage: bun run codver.ts --repo <github-url> --prompt <text> [--model <provider/model>] [--config <path>]");
  }

  // Exactly one of --prompt or --prompt-file must be provided
  if (!prompt && !promptFile) {
    throw new ValidationError("Either --prompt or --prompt-file must be provided (exactly one).");
  }

  if (prompt && promptFile) {
    throw new ValidationError("Cannot use both --prompt and --prompt-file. Please provide exactly one.");
  }

  return {
    repo,
    model: model || undefined,
    prompt: prompt || undefined,
    promptFile: promptFile || undefined,
    newBranch: newBranch || undefined,
    fromBranch: fromBranch || undefined,
    configPath: configPath || undefined,
  };
}

export async function validateModel(modelInput: string): Promise<{ model: any; provider: string }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  heading("Validating Model");

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  // Try to find the model. Look up by provider/id pattern or shorthand.
  // modelInput could be: "anthropic/claude-sonnet-4-20250514", "sonnet", etc.
  let found: any = undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (modelInput.includes("/")) {
    const [provider, ...rest] = modelInput.split("/");
    const modelId = rest.join("/");
    found = modelRegistry.find(provider!, modelId);
  }

  // If not found by provider/id, try matching against available models
  if (!found) {
    const all = modelRegistry.getAll();
    found = all.find((m: any) => m.id === modelInput || m.id.includes(modelInput) || m.name?.toLowerCase().includes(modelInput.toLowerCase())); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  if (!found) {
    // Model still not found - show available models
    const available = modelRegistry.getAvailable();

    if (available.length === 0) {
      throw new ValidationError(
        `Model "${modelInput}" is not available.\n` +
        "No models with configured API keys were found.\n" +
        "Please set an API key environment variable (e.g., ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)"
      );
    }

    // Group by provider for cleaner display
    const byProvider: Record<string, any[]> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const m of available) {
      if (!byProvider[m.provider]) byProvider[m.provider] = [];
      byProvider[m.provider]!.push(m);
    }

    let modelList = "";
    for (const [prov, models] of Object.entries(byProvider)) {
      modelList += `\n  ${prov}:`;
      for (const m of models) {
        modelList += `\n    - ${m.id} (${m.name})`;
      }
    }

    throw new ValidationError(
      `Model "${modelInput}" is not available or not recognized.\n\n` +
      `Available models with configured API keys:${modelList}\n\n` +
      'Tip: Use the format provider/model-id (e.g., anthropic/claude-sonnet-4-20250514) or a shorthand.'
    );
  }

  // Verify the provider API key exists for this model
  const available = await modelRegistry.getAvailable();
  const provider = found.provider;
  const modelId = found.id;
  const isAvailable = available.some(
    (m: any) => m.provider === provider && m.id === modelId // eslint-disable-line @typescript-eslint/no-explicit-any
  );

  if (!isAvailable) {
    const apiKeyVar = `${provider.toUpperCase()}_API_KEY`;
    const modelList = available
      .map((m: any) => `  - ${m.provider}/${m.id} (${m.name})`) // eslint-disable-line @typescript-eslint/no-explicit-any
      .join("\n");

    throw new ValidationError(
      `Model "${modelInput}" exists but no API key is configured for provider "${provider}".\n` +
      `Set the ${apiKeyVar} environment variable to use this model.\n\n` +
      `Available models with configured API keys:\n${modelList}\n`
    );
  }

  info(`Model: ${found.provider}/${found.id} (${found.name}) ✓`);
  return { model: found, provider: found.provider };
}

export async function readPromptContentAsync(args: CliArgs): Promise<string> {
  if (args.prompt) {
    return args.prompt;
  }

  if (args.promptFile) {
    try {
      const file = Bun.file(args.promptFile);
      const exists = await file.exists();
      if (!exists) {
        throw new ValidationError(`Prompt file not found: ${args.promptFile}`);
      }
      const content = await file.text();
      if (!content.trim()) {
        throw new ValidationError(`Prompt file is empty: ${args.promptFile}`);
      }
      return content;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`Cannot read prompt file: ${args.promptFile}`);
    }
  }

  throw new ValidationError("No prompt provided.");
}

/**
 * Describes a host dependency that must be present on the system.
 */
interface HostDependency {
  /** Binary name to check */
  command: string[];
  /** Human-readable name */
  name: string;
  /** Install hint shown on failure */
  installHint: string;
  /** Optional additional check (e.g. auth status). Returning a string = error message. */
  extraCheck?: () => Promise<string | null>;
}

const HOST_DEPENDENCIES: HostDependency[] = [
  {
    command: ["git", "--version"],
    name: "Git",
    installHint: "Install Git: https://git-scm.com/book/en/v2/Getting-Started-Installing-Git",
  },
  {
    command: ["gh", "--version"],
    name: "GitHub CLI (gh)",
    installHint: "Install GitHub CLI: https://cli.github.com/",
    extraCheck: async () => {
      // Verify gh is authenticated — GITHUB_TOKEN/GH_TOKEN is a host requirement,
      // not something codver passes explicitly. The host must have gh auth'd.
      const result = Bun.spawnSync(["gh", "auth", "status"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes("not logged") || stderr.includes("no token") || stderr.includes("not authenticated")) {
          return (
            "GitHub CLI is not authenticated. Run `gh auth login` or set GITHUB_TOKEN/GH_TOKEN in your shell environment.\n" +
            "  See: https://docs.github.com/en/github-cli/github-cli/gh-auth-login"
          );
        }
        // gh auth status may return non-zero even when logged in (e.g. token
        // scope warnings). Only fail if clearly not authenticated.
        const stdout = result.stdout.toString();
        if (!stdout.includes("Logged in") && !stdout.includes("account")) {
          return (
            "GitHub CLI authentication could not be verified. Run `gh auth status` to check.\n" +
            "  If not logged in, run `gh auth login` or set GITHUB_TOKEN/GH_TOKEN."
          );
        }
      }
      return null;
    },
  },
  {
    command: ["docker", "--version"],
    name: "Docker",
    installHint: "Install Docker: https://docs.docker.com/get-docker/",
    extraCheck: async () => {
      // Verify Docker daemon is running
      const result = Bun.spawnSync(["docker", "info"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        return "Docker daemon is not running. Start Docker Desktop or the Docker service.";
      }
      return null;
    },
  },
  {
    command: ["docker", "compose", "version"],
    name: "Docker Compose",
    installHint: "Install Docker Compose: https://docs.docker.com/compose/install/",
  },
];

export async function checkDependencies(): Promise<void> {
  heading("Checking Host Dependencies");

  const failures: string[] = [];

  for (const dep of HOST_DEPENDENCIES) {
    try {
      const result = Bun.spawnSync(dep.command, {
        stdout: "pipe",
        stderr: "pipe",
      });

      if (result.exitCode !== 0) {
        failures.push(`  ✗ ${dep.name} — not found. ${dep.installHint}`);
        continue;
      }

      // Binary found — run extra check if any
      if (dep.extraCheck) {
        const extraErr = await dep.extraCheck();
        if (extraErr) {
          failures.push(`  ✗ ${dep.name} — ${extraErr}`);
          continue;
        }
      }

      const version = result.stdout.toString().split("\n")[0]?.trim() || "";
      info(`${dep.name}: ✓ ${version}`);
    } catch {
      failures.push(`  ✗ ${dep.name} — not found. ${dep.installHint}`);
    }
  }

  if (failures.length > 0) {
    throw new ValidationError(
      "Missing host dependencies:\n" +
      failures.join("\n") +
      "\n\nPlease install the missing dependencies and try again."
    );
  }

  success("All host dependencies satisfied");
}

export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, "-") // no forward slashes allowed in the name part
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}