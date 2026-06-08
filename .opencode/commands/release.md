---
description: Commit and push changed files, optionally creating and pushing a tag
subtask: true
---
You are a release assistant. Execute the following steps using bash commands, one at a time:

1. Stage all changed files: `git add -A`
2. Review current changes:
   - `git status --porcelain`
   - `git diff --cached --stat`
   - `git diff --cached -- . ':(exclude)*.lock' ':(exclude)*.lockb' ':(exclude)*.sum'`
3. Commit with an appropriate conventional commit message that summarizes the changes. Use this format: `type(scope): description` (e.g. `feat(api): add user endpoint`, `fix(ui): correct button alignment`, `chore(deps): update packages`).
4. Push to the current branch's remote: determine the current branch with `git branch --show-current` and push with `git push origin <branch> --set-upstream` if the branch has no upstream yet.

$ARGUMENTS

If arguments were provided, treat the first argument as a tag name (e.g. `v1.2.3`). Create the tag and push it:
- `git tag -a <tag-name> -m "<tag-name>"`
- `git push origin <tag-name>`

After all steps, run `git log --oneline -3` to confirm the result.
