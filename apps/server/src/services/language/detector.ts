import fs from 'fs/promises';

export type DetectedLanguage =
  | 'node'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'ruby'
  | 'php'
  | 'generic';

interface LanguageRule {
  language: DetectedLanguage;
  files: string[];
}

const LANGUAGE_RULES: LanguageRule[] = [
  { language: 'node', files: ['package.json'] },
  { language: 'python', files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'] },
  { language: 'rust', files: ['Cargo.toml'] },
  { language: 'go', files: ['go.mod'] },
  { language: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { language: 'ruby', files: ['Gemfile'] },
  { language: 'php', files: ['composer.json'] },
];

export async function detectLanguage(projectDir: string): Promise<DetectedLanguage> {
  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));

    for (const rule of LANGUAGE_RULES) {
      if (rule.files.some((f) => fileNames.has(f))) {
        return rule.language;
      }
    }
  } catch {
    // If directory can't be read, fall through to generic
  }

  return 'generic';
}

export function getLanguageDisplayName(language: DetectedLanguage): string {
  const names: Record<DetectedLanguage, string> = {
    node: 'Node.js',
    python: 'Python',
    rust: 'Rust',
    go: 'Go',
    java: 'Java',
    ruby: 'Ruby',
    php: 'PHP',
    generic: 'Generic',
  };
  return names[language];
}
