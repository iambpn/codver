#!/usr/bin/env bun
/**
 * Codver — Automated Code Agent Runner
 *
 * Clones a GitHub repo, sets up a sandboxed Docker dev environment,
 * runs a pi agent task, and creates a PR with the changes.
 *
 * Subcommands:
 *   clean     Remove Codver output directories and files
 */

import {
  parseCliArgs,
  validateModel,
  readPromptContentAsync,
  checkDependencies,
  sanitizeBranchName,
  ValidationError,
} from "./lib/cli";
import {
  cloneRepo,
  setupBranch,
  configureGitUser,
  stageAndCommit,
  hasCodeChanges,
  getChangedFiles,
  getFullDiff,
  pushBranch,
  createPR,
} from "./lib/github";
import { composeUp, composeRunAgent, composeDown } from "./lib/docker";
import { generateBunfigToml, generateEnvFile, hardenCompose, validateEnvVars } from "./lib/security";
import {
  generateDevCompose,
  modifyGitignore,
  generateBranchName,
  generateCommitMessage,
  generatePRDescription,
  generateNoUpdateDoc,
} from "./lib/ai";
import { heading, step, spinningStep, info, success, error, warn, blankLine } from "./lib/progress";
import {
  DEV_COMPOSE_FILE,
  BUNFIG_FILE,
  ENV_FILE,
  PLAN_FILE,
  CODVER_HOME_DIR,
  NO_UPDATE_FILE,
  CODVER_CONFIG_PATH,
} from "./lib/paths";
import { parseCleanArgs, runClean } from "./lib/clean";
import { loadConfig, resolveModels } from "./lib/config";
import type { ModelInfo, CodverConfig } from "./lib/types";
import path from "node:path";

// ─── Subcommand dispatch ───────────────────────────────────────────
// If the first positional argument is a known subcommand, redirect there.
// Otherwise fall through to the main pipeline.

const SUBCOMMANDS = ["clean"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function getSubcommand(): { subcommand: Subcommand; restArgs: string[] } | null {
  // Look for a subcommand after the script path (skip Bun/node and script args)
  // process.argv: [bun, /path/to/codver.ts, ...positionals]
  const positionals = process.argv.slice(2);
  const first = positionals[0];
  if (first && (SUBCOMMANDS as readonly string[]).includes(first)) {
    return { subcommand: first as Subcommand, restArgs: positionals.slice(1) };
  }
  return null;
}

const sub = getSubcommand();
if (sub) {
  switch (sub.subcommand) {
    case "clean": {
      const options = parseCleanArgs(sub.restArgs);
      runClean(options);
      process.exit(0);
    }
  }
}

async function main() {
  // Parse CLI args (handles --help)
  const args = parseCliArgs();

  // ════════════════════════════════════════════════════════════════
  // Load configuration
  // ════════════════════════════════════════════════════════════════
  const config: CodverConfig = loadConfig(args.configPath);

  if (args.configPath) {
    info(`Config loaded from: ${args.configPath}`);
  } else {
    const globalConfigPath = CODVER_CONFIG_PATH;
    const { existsSync } = await import("node:fs");
    if (existsSync(globalConfigPath)) {
      info(`Config loaded from: ${globalConfigPath}`);
    }
  }

  // Check dependencies
  await checkDependencies();

  // Resolve models:
  //   - generativeModel: used for host-side AI tasks (branch naming, commit msgs, PR desc, dev-compose, gitignore)
  //   - agentModel:      used for the pi agent task inside the container
  // The --model flag always takes priority for the agent task.
  // The config defaultModel always takes priority for generative tasks.
  const { generativeModel, agentModel } = resolveModels(args.model, config.defaultModel);

  // ════════════════════════════════════════════════════════════════
  // Phase 1: Setup & Validation
  // ════════════════════════════════════════════════════════════════
  heading("Phase 1: Setup & Validation");

  // Read prompt content
  const promptContent = await readPromptContentAsync(args);
  info(`Prompt loaded (${promptContent.length} chars)`);

  // Validate generative model (used for branch naming, commit messages, PR descriptions, etc.)
  let generativeModelInfo: ModelInfo;
  try {
    const validated = await validateModel(generativeModel);
    generativeModelInfo = {
      model: validated.model,
      provider: validated.provider,
    };
  } catch (err) {
    error(`Generative model validation failed: ${err}`);
    process.exit(1);
  }

  // Validate agent model (used for the pi agent task inside the container)
  let agentModelInfo: ModelInfo;
  if (agentModel !== generativeModel) {
    try {
      const validated = await validateModel(agentModel);
      agentModelInfo = {
        model: validated.model,
        provider: validated.provider,
      };
    } catch (err) {
      error(`Agent model validation failed: ${err}`);
      process.exit(1);
    }
  } else {
    // Same model — reuse the validated result
    agentModelInfo = generativeModelInfo;
  }

  // Validate provider API keys (check both providers if different)
  const providers = new Set([generativeModelInfo.provider]);
  if (agentModelInfo.provider !== generativeModelInfo.provider) {
    providers.add(agentModelInfo.provider);
  }
  for (const provider of providers) {
    const envValidation = validateEnvVars(provider);
    if (!envValidation.valid) {
      error(`Missing required provider API keys for ${provider}: ${envValidation.missing.join(", ")}`);
      error("Please set the required API keys and try again.");
      process.exit(1);
    }
  }
  success("Provider API keys validated");

  // Generate or sanitize branch name
  let newBranch = args.newBranch;
  if (!newBranch) {
    info("No branch name provided, generating from prompt...");
    const branchName = await generateBranchName(promptContent, generativeModelInfo.model);
    newBranch = sanitizeBranchName(branchName);
    info(`Generated branch name: ${newBranch}`);
  } else {
    newBranch = `codver/${sanitizeBranchName(newBranch.replace(/^codver\/?/, ""))}`;
  }

  info(`Repository: ${args.repo}`);
  info(`Generative model: ${generativeModelInfo.model.provider}/${generativeModelInfo.model.id}`);
  info(`Agent model: ${agentModelInfo.model.provider}/${agentModelInfo.model.id}`);
  info(`New branch: ${newBranch}`);
  info(`From branch: ${args.fromBranch || "(default)"}`);

  // ════════════════════════════════════════════════════════════════
  // Phase 2: Clone & Branch
  // ════════════════════════════════════════════════════════════════
  heading("Phase 2: Clone & Branch");

  const repoInfo = await cloneRepo(args.repo);
  const cwd = repoInfo.repoDir;

  await setupBranch(cwd, args.fromBranch, newBranch);

  // Configure local git user from config (if set)
  if (config.gitUserName || config.gitUserEmail) {
    await step("Configuring local git user", async () => {
      await configureGitUser(cwd, config);
      if (config.gitUserName) info(`  git user.name: ${config.gitUserName}`);
      if (config.gitUserEmail) info(`  git user.email: ${config.gitUserEmail}`);
      success("Local git user configured");
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Phase 3: Generate Dev Compose
  // ════════════════════════════════════════════════════════════════
  heading("Phase 3: Generate Dev Compose");

  // Write bunfig.toml (for container — minimumReleaseAge = 604800)
  await step("Writing bunfig.toml", async () => {
    const bunfigContent = generateBunfigToml();
    await Bun.write(path.join(cwd, BUNFIG_FILE), bunfigContent);
    success(`${BUNFIG_FILE} created`);
  });

  // Generate docker-compose.dev.yml using AI (agent writes the file directly)
  await step(`Generating ${DEV_COMPOSE_FILE} with AI`, async () => {
    await generateDevCompose(cwd, generativeModelInfo.model, generativeModelInfo.provider);

    // Apply security hardening to the agent-written file
    info("Applying security hardening...");
    const composePath = path.join(cwd, DEV_COMPOSE_FILE);
    let yaml = await Bun.file(composePath).text();
    yaml = hardenCompose(yaml);
    await Bun.write(composePath, yaml);
    success(`${DEV_COMPOSE_FILE} created with security hardening`);
  });

  // Write .env file for docker compose (from environment variables)
  await step("Writing .env file", async () => {
    const envContent = generateEnvFile(generativeModelInfo.provider);
    await Bun.write(path.join(cwd, ENV_FILE), envContent);
    success(`${ENV_FILE} file created`);
  });

  // ════════════════════════════════════════════════════════════════
  // Phase 4: Modify .gitignore
  // ════════════════════════════════════════════════════════════════
  heading("Phase 4: Modify .gitignore");

  await step("Updating .gitignore with AI", async () => {
    await modifyGitignore(cwd, generativeModelInfo.model);
    success(".gitignore updated");
  });

  // Commit .gitignore changes
  await stageAndCommit(cwd, "chore: add dev compose files to .gitignore");

  // ════════════════════════════════════════════════════════════════
  // Phase 5–7: Start Containers, Execute Task, Cleanup
  // Wrapped in try/finally to guarantee containers are shut down
  // ════════════════════════════════════════════════════════════════
  heading("Phase 5: Start Containers");

  try {
    await composeUp(cwd);
  } catch (err) {
    error(`Failed to start containers: ${err}`);
    // Try to clean up and exit
    await composeDown(cwd).catch(() => {});
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════════
  // Phase 6: Execute Task via Pi Agent
  // ════════════════════════════════════════════════════════════════
  heading("Phase 6: Execute Task");

  let agentResult: { exitCode: number; output: string };
  try {
    agentResult = await composeRunAgent(
      cwd,
      promptContent,
      agentModel, // the model string for the in-container agent task
    );
  } catch (err) {
    error(`Agent execution failed: ${err}`);
    agentResult = { exitCode: 1, output: String(err) };
  } finally {
    // ══════════════════════════════════════════════════════════════
    // Phase 7: Stop Containers (always runs, even on error)
    // ════════════════════════════════════════════════════════════════
    heading("Phase 7: Cleanup");
    await composeDown(cwd);
  }

  // ════════════════════════════════════════════════════════════════
  // Phase 8: Evaluate Changes
  // ════════════════════════════════════════════════════════════════
  heading("Phase 8: Evaluate Changes");

  const codeChanges = await hasCodeChanges(cwd);
  const baseBranch = args.fromBranch || repoInfo.defaultBranch;

  if (codeChanges) {
    // ════════════════════════════════════════════════════════════════
    // Phase 9a: Changes Exist — Commit & PR
    // ════════════════════════════════════════════════════════════════
    heading("Phase 9a: Commit & Create PR");

    // Get full diff for commit message generation
    const diffOutput = await getFullDiff(cwd);
    const commitInfo = await generateCommitMessage(cwd, generativeModelInfo.model, diffOutput);

    info(`Commit title: ${commitInfo.title}`);
    blankLine();

    // Stage and commit code changes
    // We need to be careful: only stage files that are NOT dev compose files
    await step("Staging and committing code changes", async () => {
      // First, explicitly add files excluding dev compose files
      const addResult = Bun.spawnSync(
        [
          "git",
          "-C",
          cwd,
          "add",
          "-A",
          "--",
          ".",
          `:!${DEV_COMPOSE_FILE}`,
          `:!${BUNFIG_FILE}`,
          `:!${ENV_FILE}`,
          `:!${PLAN_FILE}`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );

      if (addResult.exitCode !== 0) {
        // Fallback: add all since dev compose files should be in .gitignore by now
        const fallbackResult = Bun.spawnSync(["git", "-C", cwd, "add", "-A"], { stdout: "pipe", stderr: "pipe" });
      }

      const commitResult = Bun.spawnSync(["git", "-C", cwd, "commit", "-m", commitInfo.title, "-m", commitInfo.body], {
        stdout: "pipe",
        stderr: "pipe",
      });

      if (commitResult.exitCode !== 0) {
        const errMsg = commitResult.stderr.toString();
        if (!errMsg.includes("nothing to commit") && !errMsg.includes("no changes")) {
          throw new Error(`Commit failed: ${errMsg}`);
        }
      }

      success(`Changes committed: ${commitInfo.title}`);
    });

    // Get diff summary for PR description
    const diffSummary = await getChangedFiles(cwd);
    const prInfo = await generatePRDescription(cwd, generativeModelInfo.model, commitInfo.title, diffSummary);

    info(`PR title: ${prInfo.title}`);
    blankLine();

    // Push and create PR
    await pushBranch(cwd, newBranch);
    const prUrl = await createPR(cwd, prInfo.title, prInfo.body, newBranch, baseBranch);

    success(`PR created: ${prUrl}`);
  } else {
    // ════════════════════════════════════════════════════════════════
    // Phase 9b: No Changes — Create codver-no-update.md & PR
    // ════════════════════════════════════════════════════════════════
    heading("Phase 9b: No Code Changes — Creating Report");

    info("No code changes were detected. Generating codver-no-update.md...");

    const noUpdateContent = await generateNoUpdateDoc(
      cwd,
      generativeModelInfo.model,
      agentResult.output,
      promptContent,
    );

    // Write codver-no-update.md
    await Bun.write(path.join(cwd, NO_UPDATE_FILE), noUpdateContent);

    // Stage and commit
    const addResult = Bun.spawnSync(["git", "-C", cwd, "add", NO_UPDATE_FILE], { stdout: "pipe", stderr: "pipe" });

    const commitResult = Bun.spawnSync(
      ["git", "-C", cwd, "commit", "-m", `docs: add ${NO_UPDATE_FILE} report — no code changes required`],
      { stdout: "pipe", stderr: "pipe" },
    );

    if (commitResult.exitCode !== 0) {
      warn(`Commit had issues: ${commitResult.stderr.toString()}`);
    }

    // Generate PR description for no-update case
    const prInfo = await generatePRDescription(
      cwd,
      generativeModelInfo.model,
      "docs: add codver-no-update report — no code changes required",
      `No code changes were made. A ${NO_UPDATE_FILE} report was generated explaining why.`,
    );

    // Push and create PR
    await pushBranch(cwd, newBranch);
    const prUrl = await createPR(cwd, prInfo.title, prInfo.body, newBranch, baseBranch);

    success(`PR created (no-update): ${prUrl}`);
  }

  blankLine();
  success("Codver pipeline completed successfully!");
  info(`Working directory: ${cwd}`);
  info(`Tip: Working directories are stored in ${CODVER_HOME_DIR} and are NOT automatically cleaned up.`);
  info(`      To free disk space, run: bun run codver.ts clean`);
}

main().catch((err) => {
  if (err instanceof ValidationError) {
    error(err.message);
  } else {
    error(`Fatal error: ${err}`);
    console.error(err);
  }
  process.exit(1);
});
