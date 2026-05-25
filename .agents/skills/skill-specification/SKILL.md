---
name: skill-specification
description: Guides creation and modification of Agent Skills. Use when creating, editing, or validating skills, SKILL.md files, skill directories, or any skill-related resources including scripts, references, and assets.
metadata:
  author: open-codver
  version: "1.0"
---

# Agent Skills Specification

Use this skill when creating or modifying Agent Skills directories and their contents.

## Directory Structure

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
├── assets/           # Optional: templates, resources
```

## SKILL.md Format

A `SKILL.md` file must contain **YAML frontmatter** followed by **Markdown body content**.

### Frontmatter Fields

| Field | Required | Constraints |
| --- | --- | --- |
| `name` | Yes | 1-64 chars. Lowercase letters, numbers, hyphens only. No leading/trailing/consecutive hyphens. Must match parent directory name. |
| `description` | Yes | 1-1024 chars. Describe what the skill does AND when to use it. Include specific keywords. |
| `license` | No | License name or reference to bundled license file. |
| `compatibility` | No | 1-500 chars. Environment requirements (product, packages, network). Omit if none. |
| `metadata` | No | String-to-string mapping for custom properties. Use unique keys. |
| `allowed-tools` | No | Space-separated string of pre-approved tools. Experimental. |

### Minimal Example

```markdown
---
name: my-skill
description: Does X when Y happens. Use when working with Z.
---
```

### Full Example

```markdown
---
name: pdf-processing
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.
license: Apache-2.0
compatibility: Requires Python 3.14+ and uv
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Bash(jq:*) Read
---
```

### Name Field Rules

- Lowercase alphanumeric + hyphens only
- Must NOT start or end with hyphen
- Must NOT contain consecutive hyphens (`--`)
- Must match the parent directory name

Valid: `pdf-processing`, `data-analysis`, `code-review` Invalid: `PDF-Processing`, `-pdf`, `pdf--processing`

### Description Best Practices

- Describe both **what** the skill does and **when** to use it
- Include specific keywords for agent discoverability
- Good: `Extracts text and tables from PDF files, fills PDF forms. Use when working with PDF documents or when the user mentions PDFs.`
- Poor: `Helps with PDFs.`

## Body Content

The Markdown body contains skill instructions with no format restrictions. Recommended sections:

1. Step-by-step instructions
2. Examples of inputs and outputs
3. Common edge cases

Keep `SKILL.md` under 500 lines. Move detailed content to referenced files.

## Optional Directories

- **scripts/**: Executable code (Python, Bash, JS). Be self-contained, include error messages, handle edge cases.
- **references/**: Documentation loaded on demand (`REFERENCE.md`, `FORMS.md`, domain files). Keep files focused and small.
- **assets/**: Static resources (templates, images, data files).

When creating additional resources (scripts, references, or assets), add an index of those resources in the SKILL.md body so the skill can locate its own files. For example:

```md
## Available scripts

- **`scripts/validate.sh`** — Validates configuration files
- **`scripts/process.py`** — Processes input data
```

This index must use relative paths from the skill root and list every file created in the optional directories. Group files by directory under a dedicated heading (e.g., `## Available scripts`, `## Available references`, `## Available assets`).

## Progressive Disclosure

Skills are loaded progressively:

1. **Metadata** (~100 tokens): `name` and `description` loaded at startup
2. **Instructions** (<5000 tokens recommended): Full `SKILL.md` body loaded on activation
3. **Resources** (as needed): External files loaded only when required

## File References

Use relative paths from the skill root:

```markdown
See [the reference guide](references/REFERENCE.md) for details.
```

Keep references one level deep. Avoid deeply nested reference chains.

## Validation

Validate skills using:

```bash
skills-ref validate ./my-skill
```

This checks `SKILL.md` frontmatter validity and naming conventions.
