import { Command } from "commander";
import type { CliArgs } from "./types";

export { validateModel } from "./model-validation";
export { checkDependencies } from "./dependencies";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function addMainOptions(cmd: Command): Command {
  return cmd
    .option("--repo <url>", "GitHub repository URL to clone")
    .option("--model <provider/id>", "Model for the pi agent task inside the container (e.g., anthropic/claude-sonnet-4-20250514)")
    .option("--prompt <text>", "Direct prompt text (mutually exclusive with --prompt-file)")
    .option("--prompt-file <path>", "Path to a prompt file (mutually exclusive with --prompt)")
    .option("--new-branch <name>", "Name for the new branch (auto-generated if omitted)")
    .option("--from-branch <name>", "Base branch to work from (defaults to repo's default branch)")
    .option("--config <path>", "Path to a config JSON file (default: ~/.config/.codver)");
}

export function validateCliOpts(opts: Record<string, unknown>): CliArgs {
  const repo = opts.repo as string | undefined;
  const model = opts.model as string | undefined;
  const prompt = opts.prompt as string | undefined;
  const promptFile = opts.promptFile as string | undefined;
  const newBranch = opts.newBranch as string | undefined;
  const fromBranch = opts.fromBranch as string | undefined;
  const configPath = opts.config as string | undefined;

  if (!repo) {
    throw new ValidationError(
      "Missing required argument: --repo\nUsage: codver --repo <github-url> --prompt <text> [--model <provider/model>] [--config <path>]",
    );
  }

  if (!prompt && !promptFile) {
    throw new ValidationError("Either --prompt or --prompt-file must be provided (exactly one).");
  }

  if (prompt && promptFile) {
    throw new ValidationError("Cannot use both --prompt and --prompt-file. Please provide exactly one.");
  }

  return { repo, model, prompt, promptFile, newBranch, fromBranch, configPath };
}

export function parseCliArgs(argv?: string[]): CliArgs {
  const program = new Command();
  program
    .name("codver")
    .description("Codver — Code Agent Runner. Clones a GitHub repo, sets up a sandboxed Docker dev environment, runs a pi agent task, and creates a PR with the changes.")
    .addHelpText("after", `
Configuration file (~/.config/.codver):
  The config file is optional. When present, it may contain:

    gitUserName     Git user.name to set in the cloned repo (local config)
    gitUserEmail    Git user.email to set in the cloned repo (local config)
    defaultModel    Model for host-side generative tasks (branch naming,
                    commit messages, PR descriptions, dev-compose).
                    Falls back to --model if not set.

Host Dependencies (must be installed and configured on the host):
  gh CLI                     GitHub CLI — https://cli.github.com/
                             Must be authenticated (gh auth login)
  git                        Version control — https://git-scm.com/
  docker                     Container runtime — https://docs.docker.com/get-docker/
  docker compose             Container orchestration (included with Docker Desktop)

Provider API Keys (set as environment variables):
  ANTHROPIC_API_KEY            Required if using Anthropic models
  OPENAI_API_KEY               Required if using OpenAI models
  <PROVIDER>_API_KEY           Required for other providers

Examples:
  $ codver --repo https://github.com/owner/repo --model anthropic/claude-sonnet-4-20250514 --prompt "Add unit tests"
  $ codver --repo owner/repo --model sonnet --prompt-file task.md --new-branch add-tests --from-branch main
  $ codver --repo owner/repo --prompt "Add unit tests"  # uses defaultModel from config
  $ codver --config ./my-config.json --repo owner/repo --model sonnet --prompt "fix bug"
  $ codver clean --dry-run
`)
    .exitOverride();

  addMainOptions(program);

  program.parse(argv ?? process.argv, { from: argv ? "user" : "node" });

  return validateCliOpts(program.opts());
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

export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
