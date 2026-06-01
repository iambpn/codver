import path from "node:path";
import { getGlobalConfigPath } from "./paths";
import { ValidationError } from "./cli";
import { warn } from "./progress";
import type { CodverConfig } from "./types";

/** Known top-level keys allowed in the config JSON. */
const KNOWN_CONFIG_KEYS = new Set(["gitUserName", "gitUserEmail", "defaultModel"]);

/**
 * Resolve the config file path.
 *
 * Order of precedence:
 *   1. Explicit path passed via --config flag
 *   2. Global config at ~/.config/.codver
 *
 * Returns `null` if neither file exists (which is fine — config is optional).
 */
async function resolveConfigPath(explicitPath?: string): Promise<string | null> {
  if (explicitPath) {
    // --config was provided — always resolve relative to cwd
    const resolved = path.resolve(explicitPath);
    const exists = await Bun.file(resolved).exists();
    if (!exists) {
      throw new ValidationError(
        `Config file not found: ${explicitPath}\n` +
        `  Resolved to: ${resolved}\n` +
        `  Please create the file or remove the --config flag.`
      );
    }
    return resolved;
  }

  // No --config flag — check global location
  // Resolve dynamically to support HOME override in tests
  const configPath = getGlobalConfigPath();
  const exists = await Bun.file(configPath).exists();
  if (exists) {
    return configPath;
  }

  // No config file anywhere — that's okay
  return null;
}

/**
 * Load and parse the Codver configuration.
 *
 * @param explicitPath  Optional path passed via --config flag
 * @returns Parsed CodverConfig (empty object if no config file exists)
 * @throws ValidationError if the config file exists but contains invalid JSON or unexpected structure
 */
export async function loadConfig(explicitPath?: string): Promise<CodverConfig> {
  const configPath = await resolveConfigPath(explicitPath);

  if (configPath === null) {
    return {};
  }

  let raw: string;
  try {
    raw = await Bun.file(configPath).text();
  } catch (err) {
    throw new ValidationError(`Cannot read config file: ${configPath}\n  ${err}`);
  }

  if (!raw.trim()) {
    // Empty file is fine — treat as empty config
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ValidationError(
      `Invalid JSON in config file: ${configPath}\n` +
      `  ${err}\n` +
      `  Please fix the JSON syntax or remove the file.`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(
      `Config file must contain a JSON object, not ${Array.isArray(parsed) ? "an array" : typeof parsed}.\n` +
      `  File: ${configPath}`
    );
  }

  // Extract known keys, ignore unknown ones gracefully
  const config: CodverConfig = {};
  const obj = parsed as Record<string, unknown>;
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (KNOWN_CONFIG_KEYS.has(key)) {
      if (value !== undefined && value !== null && typeof value !== "string") {
        throw new ValidationError(
          `Config key "${key}" must be a string, got ${typeof value}.\n` +
          `  File: ${configPath}`
        );
      }
      if (typeof value === "string") {
        (config as Record<string, unknown>)[key] = value;
      }
      // null/undefined → don't set it (stays undefined in CodverConfig)
    } else {
      unknownKeys.push(key);
    }
  }

  if (unknownKeys.length > 0) {
    // Warn but don't error — forward-compatible
    warn(
      `Unknown config keys in ${configPath}: ${unknownKeys.join(", ")}\n` +
      `  Known keys: ${[...KNOWN_CONFIG_KEYS].join(", ")}`
    );
  }

  return config;
}

/**
 * Determine the effective models for the pipeline.
 *
 * @param cliModel       The --model flag value (or undefined if not provided)
 * @param configDefaultModel  The defaultModel from config (or undefined)
 * @returns An object with:
 *   - generativeModel: the model string to use for host-side AI tasks
 *   - agentModel:      the model string to use for the in-container agent task
 * @throws ValidationError if neither --model nor config.defaultModel is provided
 */
export function resolveModels(
  cliModel: string | undefined,
  configDefaultModel: string | undefined
): { generativeModel: string; agentModel: string } {
  if (!cliModel && !configDefaultModel) {
    throw new ValidationError(
      "No model specified. Provide --model on the command line or set defaultModel in the config file.\n" +
      "  CLI:      --model anthropic/claude-sonnet-4-20250514\n" +
      `  Config:   { "defaultModel": "anthropic/claude-sonnet-4-20250514" } in ~/.config/.codver`
    );
  }

  const generativeModel = configDefaultModel || cliModel || "";
  const agentModel = cliModel || configDefaultModel || "";

  return { generativeModel, agentModel };
}