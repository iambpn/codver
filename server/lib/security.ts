import { PROVIDER_ENV_MAP, FALLBACK_ENV_VARS } from "./types";
import YAML from "yaml";

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
  const allVars = [...new Set([...providerVars])];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- YAML parse returns untyped objects
type ComposeDoc = any;

/**
 * Apply security hardening to a docker-compose YAML string.
 * Uses the yaml library for reliable parsing and serialization.
 *
 * For every service:
 *   - security_opt: [no-new-privileges:true]
 *   - cap_drop: [ALL]
 *   - Remove any "ports" mappings (no port forwarding)
 *   - Remove "privileged: true"
 *   - Remove "network_mode: host"
 *   - Add networks: [dev-network]
 *
 * Ensures "dev-network" exists with internal: true
 */
export function hardenCompose(yamlStr: string): string {
  let doc: ComposeDoc;
  try {
    doc = YAML.parse(yamlStr);
  } catch (e) {
    // If YAML parsing fails, return the original — don't crash the pipeline
    console.warn(`Warning: Could not parse docker-compose YAML for hardening: ${e}`);
    return yamlStr;
  }

  if (!doc || typeof doc !== "object" || !doc.services) {
    return yamlStr;
  }

  for (const serviceName of Object.keys(doc.services)) {
    const service: ComposeDoc = doc.services[serviceName];
    if (!service || typeof service !== "object") continue;

    // Ensure security_opt: [no-new-privileges:true]
    if (!Array.isArray(service.security_opt)) {
      service.security_opt = [];
    }
    if (!service.security_opt.includes("no-new-privileges:true")) {
      service.security_opt.push("no-new-privileges:true");
    }

    // Ensure cap_drop: [ALL]
    if (!Array.isArray(service.cap_drop)) {
      service.cap_drop = [];
    }
    if (!service.cap_drop.includes("ALL")) {
      service.cap_drop.unshift("ALL");
    }

    // Remove any port mappings (no port forwarding in sandbox)
    delete service.ports;

    // Remove privileged mode
    delete service.privileged;

    // Remove network_mode: host
    if (service.network_mode === "host") {
      delete service.network_mode;
    }

    // Ensure networks: [dev-network]
    if (Array.isArray(service.networks)) {
      if (!service.networks.includes("dev-network")) {
        service.networks.push("dev-network");
      }
    } else if (typeof service.networks === "object" && service.networks !== null) {
      // Map format: networks: { dev-network: {} }
      if (!("dev-network" in service.networks)) {
        service.networks["dev-network"] = null;
      }
    } else {
      // No networks defined — set to [dev-network]
      service.networks = ["dev-network"];
    }
  }

  // Ensure dev-network exists with internal: true
  if (!doc.networks) {
    doc.networks = {};
  }
  if (!doc.networks["dev-network"]) {
    doc.networks["dev-network"] = { driver: "bridge", internal: true };
  } else if (typeof doc.networks["dev-network"] === "object" && doc.networks["dev-network"] !== null) {
    doc.networks["dev-network"].internal = true;
    if (!doc.networks["dev-network"].driver) {
      doc.networks["dev-network"].driver = "bridge";
    }
  }

  return YAML.stringify(doc);
}