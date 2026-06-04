/**
 * Codver Init — Generate a default Codver configuration file.
 *
 * Writes a JSON config containing the three known top-level keys
 * (gitUserName, gitUserEmail, defaultModel) to either an explicit path
 * (--path) or the default global location (~/.config/codver/codver.config.json).
 */

import path from "node:path";
import { Command } from "commander";
import { ensureGlobalConfigDir, getGlobalConfigPath } from "./paths";
import { blankLine, error, heading, info, success } from "./progress";

export interface InitOptions {
  force: boolean;
  path?: string;
}

const DEFAULT_CONFIG_CONTENT = JSON.stringify(
  {
    gitUserName: "Your Name",
    gitUserEmail: "your.email@example.com",
    defaultModel: "anthropic/claude-sonnet-4-20250514",
  },
  null,
  2,
) + "\n";

export function addInitOptions(cmd: Command): Command {
  return cmd
    .option("--force", "Overwrite the config file if it already exists")
    .option("--path <path>", "Write the config to a custom path (default: ~/.config/codver/codver.config.json)");
}

export async function runInit(options: InitOptions): Promise<void> {
  heading("Initialize Codver Config");

  let targetPath: string;
  if (options.path) {
    targetPath = path.resolve(options.path);
  } else {
    await ensureGlobalConfigDir();
    targetPath = getGlobalConfigPath();
  }

  info(`Target: ${targetPath}`);

  const exists = await Bun.file(targetPath).exists();
  if (exists && !options.force) {
    error(
      `Config file already exists at ${targetPath}\n` +
        `  Re-run with --force to overwrite it.`,
    );
    process.exit(1);
    return;
  }

  const targetDir = path.dirname(targetPath);
  if (!(await Bun.file(targetDir).exists())) {
    await Bun.write(path.join(targetDir, ".keep"), "");
  }
  await Bun.write(targetPath, DEFAULT_CONFIG_CONTENT);

  blankLine();
  success(`Config file written: ${targetPath}`);
  blankLine();
  info("Next steps:");
  info(`  1. Edit ${targetPath} with your values`);
  info(`  2. Run \`codver check\` to verify your setup`);
  info(`  3. Run \`codver --repo <url> --prompt "<task>"\` to start a task`);
}
