export interface CodverConfig {
  /** Git user name to set in the cloned repo (local config only). */
  gitUserName?: string;
  /** Git user email to set in the cloned repo (local config only). */
  gitUserEmail?: string;
  /** Default model for generative AI tasks on the host (branch naming, commit messages, PR descriptions, dev-compose, gitignore).
   *  Falls back to --model if not set; used as the generative model when both --model and defaultModel are specified. */
  defaultModel?: string;
}

export interface CliArgs {
  repo: string;
  model?: string;
  prompt?: string;
  promptFile?: string;
  newBranch?: string;
  fromBranch?: string;
  configPath?: string;
}

export interface RepoInfo {
  repoDir: string;
  repoName: string;
  defaultBranch: string;
}

export interface AgentResult {
  exitCode: number;
  output: string;
}

export interface CommitInfo {
  title: string;
  body: string;
}

export interface PRInfo {
  title: string;
  body: string;
  url: string;
}

export interface ModelInfo {
  model: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- pi Model type varies by provider
  provider: string;
}

export const PROVIDER_ENV_MAP: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"],
  deepseek: ["DEEPSEEK_API_KEY"],
  azure: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
  mistral: ["MISTRAL_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  huggingface: ["HUGGINGFACE_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  kimi: ["KIMI_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
};

export const FALLBACK_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENCODE_API_KEY",
];

export { GITIGNORE_ENTRIES } from "./paths";
