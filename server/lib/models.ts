import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { info, success, heading } from "./progress";

export interface ModelsOptions {
  all?: boolean;
  provider?: string;
}

export async function listModels(options: ModelsOptions): Promise<void> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const models = options.all ? modelRegistry.getAll() : modelRegistry.getAvailable();
  const label = options.all ? "All registered" : "Available (with API keys)";

  const filtered = options.provider
    ? models.filter((m) => m.provider === options.provider)
    : models;

  if (filtered.length === 0) {
    const scope = options.provider ? ` for provider "${options.provider}"` : "";
    const hint = options.all ? "" : "\n  Use --all to list all registered models, or set API keys via environment variables.";
    info(`No ${label.toLowerCase()} models found${scope}.${hint}`);
    return;
  }

  heading(`${label} models (${filtered.length})`);

  const byProvider: Record<string, Model<Api>[]> = {};
  for (const m of filtered) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider]!.push(m);
  }

  for (const [provider, providerModels] of Object.entries(byProvider)) {
    success(`${provider}:`);
    for (const m of providerModels) {
      info(`  ${m.provider}/${m.id}${m.name ? ` (${m.name})` : ""}`);
    }
  }
}
