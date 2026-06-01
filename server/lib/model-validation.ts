import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { info } from "./progress";
import { ValidationError } from "./cli";

export async function validateModel(modelInput: string): Promise<{ model: Model<Api>; provider: string }> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const found = findModel(modelInput, modelRegistry);
  await verifyModelAvailability(modelInput, found, modelRegistry);

  info(`Model: ${found.provider}/${found.id} (${found.name}) ✓`);
  return { model: found, provider: found.provider };
}

function findModel(modelInput: string, modelRegistry: ModelRegistry): Model<Api> {
  if (modelInput.includes("/")) {
    const [provider, ...rest] = modelInput.split("/");
    const modelId = rest.join("/");
    const found = modelRegistry.find(provider!, modelId);
    if (found) return found;
  }

  const all = modelRegistry.getAll();

  const exactIdMatch = all.find((m) => m.id === modelInput);
  if (exactIdMatch) return exactIdMatch;

  const exactNameMatch = all.find((m) => m.name?.toLowerCase() === modelInput.toLowerCase());
  if (exactNameMatch) return exactNameMatch;

  const fuzzyMatches = all.filter(
    (m) => m.name?.toLowerCase().includes(modelInput.toLowerCase()) || m.id.includes(modelInput),
  );
  if (fuzzyMatches.length === 1) return fuzzyMatches[0]!;
  if (fuzzyMatches.length > 1) {
    const matchList = fuzzyMatches.map((m) => `${m.provider}/${m.id}`).join(", ");
    throw new ValidationError(
      `Ambiguous model "${modelInput}" matches multiple models: ${matchList}.\n` +
        "Please specify the full model ID using the format provider/model-id (e.g., anthropic/claude-sonnet-4-20250514).",
    );
  }

  const available = modelRegistry.getAvailable();
  if (available.length === 0) {
    throw new ValidationError(
      `Model "${modelInput}" is not available.\n` +
        "No models with configured API keys were found.\n" +
        "Please set an API key environment variable (e.g., ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.).",
    );
  }

  const byProvider: Record<string, Model<Api>[]> = {};
  for (const m of available) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider]!.push(m);
  }

  let modelList = "";
  for (const [prov, models] of Object.entries(byProvider)) {
    modelList += `\n  ${prov}:`;
    for (const m of models) {
      modelList += `\n    - ${m.id} (${m.name})`;
    }
  }

  throw new ValidationError(
    `Model "${modelInput}" is not available or not recognized.\n\n` +
      `Available models with configured API keys:${modelList}\n\n` +
      "Tip: Use the format provider/model-id (e.g., anthropic/claude-sonnet-4-20250514) or a shorthand.",
  );
}

async function verifyModelAvailability(
  modelInput: string,
  found: Model<Api>,
  modelRegistry: ModelRegistry,
): Promise<void> {
  const available = await modelRegistry.getAvailable();
  const provider = found.provider;
  const modelId = found.id;
  const isAvailable = available.some((m) => m.provider === provider && m.id === modelId);

  if (!isAvailable) {
    const apiKeyVar = `${provider.toUpperCase()}_API_KEY`;
    const modelList = available.map((m) => `  - ${m.provider}/${m.id} (${m.name})`).join("\n");

    throw new ValidationError(
      `Model "${modelInput}" exists but no API key is configured for provider "${provider}".\n` +
        `Set the ${apiKeyVar} environment variable to use this model.\n\n` +
        `Available models with configured API keys:\n${modelList}\n`,
    );
  }
}
