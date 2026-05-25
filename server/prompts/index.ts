import path from "node:path";

const PROMPTS_DIR = path.dirname(import.meta.url.replace("file://", ""));

/**
 * Load a prompt template asynchronously and interpolate {{variable}} placeholders
 * with the provided values.
 */
export async function loadPromptAsync(templateName: string, vars?: Record<string, string>): Promise<string> {
  const filePath = path.join(PROMPTS_DIR, `${templateName}.md`);
  let content = await Bun.file(filePath).text();

  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
  }

  return content;
}