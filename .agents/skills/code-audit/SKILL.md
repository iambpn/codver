---
name: code-audit
description: Audits source code for bugs, complexity, and readability. Finds bugs, reorganizes messy code, simplifies complex flows, and replaces ternary operators with explicit if/else. Use when the user asks to audit, review, clean up, simplify, or refactor code.
metadata:
  author: open-codver
  version: "1.0"
---

# Code Audit Skill

When the user invokes `/code-audit` or asks to audit/review/clean up/simplify code, follow the steps below.

## Step 1 — Identify target files

1. If the user specifies file paths, audit only those files.
2. If the user specifies a directory, recursively find all source code files in it (`.py`, `.js`, `.ts`, `.jsx`, `.tsx`, `.go`, `.rs`, `.java`, `.rb`, `.sh`, `.c`, `.cpp`, `.h`, `.hpp`).
3. If the user gives no target, ask which files or directory to audit before proceeding.

## Step 2 — Read and categorize issues

Read each target file and look for these four categories of issues:

### Category 1 — Bugs

- Off-by-one errors, wrong comparison operators (`=` vs `==`, `<` vs `<=`)
- Unhandled null/undefined/None cases that can crash
- Swapped variables, unreachable code, dead code after `return`
- Race conditions, missing error handling
- Logic errors (wrong boolean operator, inverted conditions)

### Category 2 — Disorganized code

- Functions that do too many things (lack of single responsibility)
- Inconsistent naming conventions
- Code that should be grouped but is scattered
- Duplicated logic that should be extracted into a shared function
- Missing or misleading function/variable names

### Category 3 — Overly complex flow

- Deeply nested conditionals (more than 2 levels)
- Long functions that are hard to follow
- Unnecessary state machines or pattern matching where a simple `if` suffices
- Early-return opportunities that would eliminate nesting
- Boolean flag parameters that branching on inside the function

### Category 4 — Ternary operators

- Any ternary expression (`condition ? a : b` in JS/TS)
- Nested ternaries (highest priority to flag)
- Ternaries used for side effects rather than assignments

## Step 3 — Produce the audit report

For each file, produce a structured report using this format:

```markdown
## 🔍 Audit: <file-path>

### 🐛 Bugs
| # | Line | Severity | Description |
|---|------|----------|-------------|
| 1 | 42 | High | Off-by-one: loop uses `<=` instead of `<` |

### 🧹 Disorganized Code
| # | Line | Description | Suggestion |
|---|------|-------------|------------|
| 1 | 15-30 | `processData()` handles parsing, validation, and formatting | Split into `parse()`, `validate()`, `format()` |

### 🔀 Complex Flow
| # | Line | Description | Suggestion |
|---|------|-------------|------------|
| 1 | 50-65 | 3-level nested if/else | Use early returns to flatten |

### ❓ Ternary Operators
| # | Line | Ternary | Replacement |
|---|------|---------|-------------|
| 1 | 22 | `x ? y : z` | `if x { y } else { z }` |
```

Severity levels for bugs: **Critical** (will crash/lose data), **High** (wrong behavior), **Medium** (edge case issue), **Low** (minor/cosmetic).

If a file has no issues in a category, omit that section entirely.

## Step 4 — Summary

End the audit with a concise summary:

```markdown
### Summary
- **Files audited**: 5
- **Bugs found**: 3 (1 Critical, 1 High, 1 Low)
- **Disorganization issues**: 4
- **Complex flow issues**: 2
- **Ternary operators**: 6
```

## Step 5 — Apply fixes (if requested)

If the user asks to apply fixes, edit the files using the `edit` tool. Prioritize in this order:

1. Bugs (Critical → High → Medium → Low)
2. Ternary operators → replace with explicit if/else
3. Complex flow → simplify
4. Disorganized code → reorganize

When replacing a ternary, always convert:

**From (JS/TS):**
```js
const result = condition ? valueA : valueB;
```

**To:**
```js
let result;
if (condition) {
    result = valueA;
} else {
    result = valueB;
}
```

Apply one category at a time, showing each change clearly. Do not proceed to the next category until the previous one is fully applied.

## Available references

- **`references/common-patterns.md`** — Common bug patterns and complexity anti-patterns checklist