#!/usr/bin/env bun
import { Command } from "commander";
import { addCleanOptions, runClean } from "./lib/clean";
import { addMainOptions, validateCliOpts, ValidationError } from "./lib/cli";
import { main } from "./lib/pipeline";
import { error } from "./lib/progress";

const program = new Command();
program
  .name("codver")
  .description(
    "Codver — Code Agent Runner. Clones a GitHub repo, sets up a sandboxed Docker dev environment, runs a pi agent task, and creates a PR with the changes.",
  )
  .addHelpText(
    "after",
    `
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
`,
  );

addMainOptions(program);

program.action(async (opts) => {
  try {
    const args = validateCliOpts(opts);
    await main(args);
  } catch (err) {
    if (err instanceof ValidationError) {
      error(err.message);
    } else {
      error(`Fatal error: ${err}`);
    }
    process.exit(1);
  }
});

const cleanCmd = program
  .command("clean")
  .description("Remove Codver output directories and files")
  .addHelpText(
    "after",
    `
Examples:
  $ codver clean              # Same as --all
  $ codver clean --home       # Remove only cloned repo directories
  $ codver clean --dry-run    # Preview what would be removed
`,
  );

addCleanOptions(cleanCmd);

cleanCmd.action(async (opts) => {
  if (opts.home && opts.all) {
    error("Cannot specify both --home and --all. Pick one.");
    process.exit(1);
  }
  const mode = opts.home ? "home" : "all";
  await runClean({ mode, dryRun: !!opts.dryRun });
});

program.parseAsync().catch((err) => {
  error(`Fatal error: ${err}`);
  process.exit(1);
});
