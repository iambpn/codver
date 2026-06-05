#!/usr/bin/env bun
import { Command } from "commander";
import { addCheckOptions, runCheck } from "./lib/check";
import { addCleanOptions, runClean } from "./lib/clean";
import { addInitOptions, runInit } from "./lib/init";
import { runLoadPath } from "./lib/load_path";
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
  $ codver init                    # generate ~/.config/codver/codver.config.json
  $ codver init --force            # overwrite existing config
  $ codver check                   # verify host deps, config, and provider API keys
  $ codver check --config ./my.json
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

const initCmd = program
  .command("init")
  .description("Generate a Codver config file at ~/.config/codver/codver.config.json")
  .addHelpText(
    "after",
    `
Examples:
  $ codver init                # write default config to ~/.config/codver/
  $ codver init --force        # overwrite an existing config
  $ codver init --path ./cfg   # write to a custom path
`,
  );
addInitOptions(initCmd);

initCmd.action(async (opts) => {
  try {
    await runInit({ force: !!opts.force, path: opts.path });
  } catch (err) {
    error(`Init failed: ${err}`);
    process.exit(1);
  }
});

const checkCmd = program
  .command("check")
  .description("Verify host dependencies, config file, provider API keys, model, and repository access")
  .addHelpText(
    "after",
    `
Examples:
  $ codver check                  # check the global config
  $ codver check --config ./my.json
  $ codver check --model anthropic/claude-sonnet-4-20250514
  $ codver check --repo https://github.com/owner/repo
  $ codver check --repo owner/repo --model anthropic/claude-sonnet-4-20250514
`,
  );
addCheckOptions(checkCmd);

checkCmd.action(async (opts) => {
  await runCheck({ configPath: opts.config, model: opts.model, repo: opts.repo });
});

const loadPathCmd = program
  .command("load_path")
  .description(
    "Source ~/.bashrc (stripping the interactive guard) and emit export statements.\n" +
      "Designed for non-interactive SSH sessions — use with eval:\n" +
      "  eval \"$(~/.codver/bin/codver load_path)\"",
  )
  .addHelpText(
    "after",
    `
Examples:
  $ eval "$(codver load_path)"
  $ eval "$(codver load_path)" && codver --repo owner/repo --prompt "fix bug"
`,
  );

loadPathCmd.action(async () => {
  try {
    await runLoadPath();
  } catch (err) {
    error(`load_path failed: ${err}`);
    process.exit(1);
  }
});

program.parseAsync().catch((err) => {
  error(`Fatal error: ${err}`);
  process.exit(1);
});
