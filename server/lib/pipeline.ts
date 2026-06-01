import path from "node:path";
import {
  buildModelName,
  generateBranchName,
  generateCommitMessage,
  generateDevCompose,
  generateNoUpdateDoc,
  generatePRDescription,
} from "./ai";
import {
  readPromptContentAsync,
  sanitizeBranchName,
  validateModel,
  ValidationError,
} from "./cli";
import { checkDependencies } from "./dependencies";
import { loadConfig, resolveModels } from "./config";
import { composeDown, composeRunAgent, composeUp, installDependency } from "./docker";
import {
  cloneRepo,
  configureGitUser,
  createPR,
  getAuthenticatedUser,
  getChangedFiles,
  getFullDiff,
  hasCodeChanges,
  pushBranch,
  setupBranch,
  stageCodeChanges,
  stageSingleFileAndCommit,
} from "./github";
import {
  BUNFIG_FILE,
  CODVER_CONFIG_PATH,
  CODVER_HOME_DIR,
  DEV_COMPOSE_FILE,
  DEV_DOCKERFILE,
  ENV_FILE,
  ERROR_REPORT_FILE,
  NO_UPDATE_FILE,
} from "./paths";
import { blankLine, error, heading, info, step, success, warn } from "./progress";
import { generateBunfigToml, generateEnvFile, validateEnvVars } from "./security";
import type { CliArgs, CodverConfig, ModelInfo } from "./types";

async function validateModels(
  generativeModel: string,
  agentModel: string,
): Promise<{ generativeModelInfo: ModelInfo; agentModelInfo: ModelInfo }> {
  heading("Validating Model");

  let generativeModelInfo: ModelInfo;
  try {
    const validated = await validateModel(generativeModel);
    generativeModelInfo = { model: validated.model, provider: validated.provider };
  } catch (err) {
    error(`Generative model validation failed: ${err}`);
    process.exit(1);
  }

  if (agentModel === generativeModel) {
    return { generativeModelInfo, agentModelInfo: generativeModelInfo };
  }

  let agentModelInfo: ModelInfo;
  try {
    const validated = await validateModel(agentModel);
    agentModelInfo = { model: validated.model, provider: validated.provider };
  } catch (err) {
    error(`Agent model validation failed: ${err}`);
    process.exit(1);
  }

  return { generativeModelInfo, agentModelInfo };
}

function validateProviderKeys(generativeModelInfo: ModelInfo, agentModelInfo: ModelInfo): void {
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
}

export async function main(args: CliArgs) {
  const config: CodverConfig = await loadConfig(args.configPath);

  if (args.configPath) {
    info(`Config loaded from: ${args.configPath}`);
  } else {
    const globalConfigPath = CODVER_CONFIG_PATH;
    if (await Bun.file(globalConfigPath).exists()) {
      info(`Config loaded from: ${globalConfigPath}`);
    }
  }

  await checkDependencies();

  const { generativeModel, agentModel } = resolveModels(args.model, config.defaultModel);

  heading("Phase 1: Setup & Validation");

  const promptContent = await readPromptContentAsync(args);
  info(`Prompt loaded (${promptContent.length} chars)`);

  const modelValidation = await validateModels(generativeModel, agentModel);
  const { generativeModelInfo, agentModelInfo } = modelValidation;
  validateProviderKeys(generativeModelInfo, agentModelInfo);

  let newBranch = args.newBranch;
  if (!newBranch) {
    info("No branch name provided, generating from prompt...");
    const branchName = await generateBranchName(promptContent, generativeModelInfo.model);
    newBranch = sanitizeBranchName(branchName);
    info(`Generated branch name: ${newBranch}`);
  } else {
    newBranch = `codver/${sanitizeBranchName(newBranch.replace(/^codver\/?/, ""))}`;
  }

  heading("Summary of Inputs");
  info(`Repository: ${args.repo}`);
  info(`Generative model: ${generativeModelInfo.model.provider}/${generativeModelInfo.model.id}`);
  info(`Agent model: ${agentModelInfo.model.provider}/${agentModelInfo.model.id}`);
  info(`New branch: ${newBranch}`);
  info(`From branch: ${args.fromBranch || "(default)"}`);

  heading("Phase 2: Clone & Branch");

  const repoInfo = await cloneRepo(args.repo);
  const cwd = repoInfo.repoDir;
  const baseBranch = args.fromBranch || repoInfo.defaultBranch;

  const notifyUser = await getAuthenticatedUser();
  if (notifyUser) {
    info(`GitHub user for notifications: @${notifyUser}`);
  } else {
    warn("Could not determine authenticated GitHub user — error PRs will not @mention anyone.");
  }

  await setupBranch(cwd, args.fromBranch, newBranch);

  if (config.gitUserName || config.gitUserEmail) {
    await step("Configuring local git user", async () => {
      await configureGitUser(cwd, config);
      if (config.gitUserName) info(`  git user.name: ${config.gitUserName}`);
      if (config.gitUserEmail) info(`  git user.email: ${config.gitUserEmail}`);
      success("Local git user configured");
    });
  }

  try {
    await runPipeline(cwd, newBranch, baseBranch, generativeModelInfo, agentModelInfo, promptContent);
  } catch (pipelineErr: unknown) {
    let errMessage: string;
    let errStack: string | undefined;
    if (pipelineErr instanceof Error) {
      errMessage = pipelineErr.message;
      errStack = pipelineErr.stack;
    } else {
      errMessage = String(pipelineErr);
      errStack = undefined;
    }
    error(`Pipeline failed: ${errMessage}`);
    if (errStack) {
      info(errStack);
    }

    await composeDown(cwd).catch(() => {});
    await handleErrorPR(cwd, newBranch, baseBranch, notifyUser, errMessage, errStack);
    process.exit(1);
  }

  blankLine();
  success("Codver pipeline completed successfully!");
  info(`Working directory: ${cwd}`);
  info(`Tip: Working directories are stored in ${CODVER_HOME_DIR} and are NOT automatically cleaned up.`);
  info(`      To free disk space, run: codver clean`);
}

async function runPipeline(
  cwd: string,
  newBranch: string,
  baseBranch: string,
  generativeModelInfo: ModelInfo,
  agentModelInfo: ModelInfo,
  promptContent: string,
): Promise<void> {
  heading("Phase 3: Generate Dev Environment");

  await step("Writing bunfig.toml", async () => {
    const bunfigContent = generateBunfigToml();
    await Bun.write(path.join(cwd, BUNFIG_FILE), bunfigContent);
    success(`${BUNFIG_FILE} created`);
  });

  await step(`Generating ${DEV_COMPOSE_FILE} and ${DEV_DOCKERFILE} with AI`, async () => {
    await generateDevCompose(cwd, generativeModelInfo.provider);
    success(`${DEV_COMPOSE_FILE} and ${DEV_DOCKERFILE} created`);
  });

  await step("Writing .env file", async () => {
    const envContent = generateEnvFile(generativeModelInfo.provider);
    await Bun.write(path.join(cwd, ENV_FILE), envContent);
    success(`${ENV_FILE} file created`);
  });

  heading("Phase 4: Start Containers");

  try {
    await composeUp(cwd);
  } catch (err) {
    throw new Error(`Failed to start containers: ${err}`);
  }

  heading("Phase 4.1: Installing dependencies in dev container");
  const depInstallResult = await installDependency(cwd, generativeModelInfo.model);
  if (depInstallResult) {
    throw new Error(`Dependency installation failed: ${depInstallResult.error}`);
  }

  heading("Phase 5: Execute Task");
  let agentResult: { exitCode: number; output: string };
  try {
    const modelName = buildModelName(agentModelInfo.model);
    agentResult = await composeRunAgent(cwd, promptContent, modelName);
  } catch (err) {
    error(`Agent execution failed: ${err}`);
    agentResult = { exitCode: 1, output: String(err) };
  } finally {
    heading("Phase 6: Cleanup");
    await composeDown(cwd);
  }

  heading("Phase 8: Evaluate Changes");

  const codeChanges = await hasCodeChanges(cwd);
  if (codeChanges) {
    heading("Phase 9a: Commit & Create PR");

    const diffOutput = await getFullDiff(cwd);
    const commitInfo = await generateCommitMessage(cwd, generativeModelInfo.model, diffOutput);

    info(`Commit title: ${commitInfo.title}`);
    blankLine();

    await stageCodeChanges(cwd, commitInfo.title, commitInfo.body);

    const diffSummary = await getChangedFiles(cwd);
    const prInfo = await generatePRDescription(cwd, generativeModelInfo.model, commitInfo.title, diffSummary);

    info(`PR title: ${prInfo.title}`);
    blankLine();

    await pushBranch(cwd, newBranch);
    const prUrl = await createPR(cwd, prInfo.title, prInfo.body, newBranch, baseBranch);

    success(`PR created: ${prUrl}`);
  } else {
    heading("Phase 9b: No Code Changes — Creating Report");

    info("No code changes were detected. Generating codver-no-update.md...");

    const noUpdateContent = await generateNoUpdateDoc(
      cwd,
      generativeModelInfo.model,
      agentResult.output,
      promptContent,
    );

    await Bun.write(path.join(cwd, NO_UPDATE_FILE), noUpdateContent);

    await stageSingleFileAndCommit(
      cwd,
      NO_UPDATE_FILE,
      `docs: add ${NO_UPDATE_FILE} report — no code changes required`,
    );

    const prInfo = await generatePRDescription(
      cwd,
      generativeModelInfo.model,
      "docs: add codver-no-update report — no code changes required",
      `No code changes were made. A ${NO_UPDATE_FILE} report was generated explaining why.`,
    );

    await pushBranch(cwd, newBranch);
    const prUrl = await createPR(cwd, prInfo.title, prInfo.body, newBranch, baseBranch);

    success(`PR created (no-update): ${prUrl}`);
  }
}

async function handleErrorPR(
  cwd: string,
  branch: string,
  baseBranch: string,
  notifyUser: string | undefined,
  errMessage: string,
  errStack: string | undefined,
): Promise<void> {
  heading("Error Handler — Creating Error PR");

  const mention = notifyUser ? `@${notifyUser} ping` : "";
  const timestamp = new Date().toISOString();

  const errorReport = [
    "# Codver Error Report",
    "",
    `**Date:** ${timestamp}`,
    `**Branch:** ${branch}`,
    "",
    mention,
    "",
    "---",
    "",
    "## Error",
    "",
    "```",
    errMessage,
    "```",
    "",
    "## Stack Trace",
    "",
    "```",
    errStack || "(no stack trace available)",
    "```",
    "",
  ].join("\n");

  const prTitle = `codver: pipeline error — ${branch}`;
  const prBody = [
    mention,
    "",
    "## ⚠️ Codver Pipeline Error",
    "",
    `The codver pipeline failed on branch \`${branch}\`.`,
    "",
    "### Error Details",
    "",
    "```",
    errMessage,
    "```",
    "",
    "### Stack Trace",
    "",
    "<details><summary>Click to expand</details>",
    "",
    "```",
    errStack || "(no stack trace available)",
    "```",
    "",
    "</details>",
    "",
    "---",
    "Please review the error and re-run codver if needed.",
  ].join("\n");

  try {
    await Bun.write(path.join(cwd, ERROR_REPORT_FILE), errorReport);
    info(`Error report written to ${ERROR_REPORT_FILE}`);

    await stageSingleFileAndCommit(cwd, ERROR_REPORT_FILE, prTitle);

    await pushBranch(cwd, branch);
    const prUrl = await createPR(cwd, prTitle, prBody, branch, baseBranch);
    success(`Error PR created: ${prUrl}`);
  } catch (prErr) {
    error(`Failed to create error PR: ${prErr}`);
    error(`You can manually review the branch: ${branch}`);
  }
}
