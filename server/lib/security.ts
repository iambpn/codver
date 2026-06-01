import { PROVIDER_ENV_MAP, FALLBACK_ENV_VARS } from "./types";

export function generateBunfigToml(): string {
  return `[install]
minimumReleaseAge = 604800
frozenLockfile = true
`;
}

export function generateEnvFile(provider: string): string {
  // Docker Compose .env files do NOT expand shell variables like ${VAR}.
  // We must write actual values from the host environment.
  // Sensitive values are safe here because .env is excluded from the repo via .gitignore.
  const providerVars = PROVIDER_ENV_MAP[provider] || FALLBACK_ENV_VARS;
  const allVars = [...providerVars];
  const lines: string[] = [];
  for (const key of allVars) {
    const value = process.env[key] || "";
    // Quote values to handle special characters safely
    lines.push(`${key}=${JSON.stringify(value)}`);
  }
  return lines.join("\n") + "\n";
}

export function getProviderEnvForCompose(provider: string): string[] {
  return PROVIDER_ENV_MAP[provider] || FALLBACK_ENV_VARS;
}

export function validateEnvVars(provider: string): { valid: boolean; missing: string[] } {
  const providerVars = PROVIDER_ENV_MAP[provider] || FALLBACK_ENV_VARS;
  const missing: string[] = [];

  for (const key of providerVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  return { valid: missing.length === 0, missing };
}

