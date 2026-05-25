Generate a detailed Pull Request description based on the following information.

The PR description should include:
## Summary
Brief summary of what this PR does.

## Changes
List of key changes made.

## Motivation
Why these changes were made.

## Testing
How the changes were verified (note: changes were developed in a sandboxed Docker environment).

## Security
Note that dev environment files (docker-compose.dev.yml, bunfig.toml, .env, .codver-plan) are excluded from this PR via .gitignore.

Commit messages:
{{commitMessages}}

Changed files summary:
{{diffSummary}}

Output format:
First line: PR title
Then a blank line
Then the full PR description in markdown format.