---
name: codver-delegate
description: Delegate a coding task to a remote codver server (fire-and-forget). Use when the user wants to offload a GitHub repo task to a remote server running codver — the remote server clones the repo, runs the AI agent, and creates a PR.
license: MIT
compatibility: Requires ssh, tmux (or nohup fallback), and codver CLI on the remote server. Optionally reads ~/.codever-ssh for the default SSH target.
metadata:
  author: codever
  version: "7.0"
allowed-tools: Bash(ssh:*) Bash(bash:*) AskUserQuestion
---

# Delegate a Coding Task to a Remote Codver Server

When the user invokes `/codver-delegate`, follow these steps. **Discover the remote CLI dynamically** — run `--help` instead of assuming the command surface.

## Step 1 — Parse the user's request

Extract these components from the user's message:

| Component | How to detect |
|-----------|---------------|
| **SSH target** | `user@host` or `user@192.168.x.x` |
| **Subcommand** | Words like `check`, `init`, `clean` — user may want a subcommand instead of the full pipeline |
| **Model** | `--model <value>`, "use model X" |
| **Repo** | GitHub URL or `owner/repo` shorthand. If absent, auto-detect from the local git repo (Step 1a). |
| **Task** | Everything else (the coding task description) |
| **Other flags** | Any `--flag <value>` patterns (validate against `--help` later) |

### 1a — Auto-detect repo URL (if not provided)

If the user did **not** provide a Repo in their message, try to detect it from the local git repository:

```bash
git remote get-url origin 2>/dev/null
```

Parse the output to extract `owner/repo`:

| Remote URL format | Extraction |
|-------------------|------------|
| `https://github.com/owner/repo.git` | Strip `https://github.com/`, strip trailing `.git` → `owner/repo` |
| `https://github.com/owner/repo` | Strip `https://github.com/` → `owner/repo` |
| `git@github.com:owner/repo.git` | Strip `git@github.com:`, strip trailing `.git` → `owner/repo` |
| `ssh://git@github.com/owner/repo.git` | Strip `ssh://git@github.com/`, strip trailing `.git` → `owner/repo` |
| Other (GitLab, Bitbucket, etc.) | Use the full remote URL as-is — the codver server's `gh repo clone` can handle any `git` clone URL |

If the command fails or returns empty:
- The local directory is not a git repo, OR
- The `origin` remote is not configured

In that case, leave Repo empty. It will be caught as a missing required input in Step 3e, and you'll ask the user.

## Step 2 — Resolve the SSH target

1. If the user's message contains `user@host`, extract it.
2. Otherwise, try `cat ~/.codever-ssh 2>/dev/null`.
3. If still missing, ask with **AskUserQuestion** (header: "SSH Target"). If no answer, stop.

Handle non-standard ports: if the target contains `:2222`, extract the port into `-p <port>` for all SSH commands.

## Step 3 — Connect and discover the CLI

### 3a. Test SSH

```bash
ssh -o ConnectTimeout=10 -o BatchMode=yes $PORT_FLAG "$SSH_HOST" "true"
```
On failure: report the error and stop.

> **Important: Non-interactive SSH PATH.** When you run `ssh host "command"`, the remote shell is non-interactive and non-login — it does **not** source `~/.bashrc`, `~/.bash_profile`, or `~/.profile`. Many `~/.bashrc` files also have an interactivity guard (`case $- in ... *i*) ... esac`) that prevents `source ~/.bashrc` from working in non-interactive shells. Codver and its dependencies (gh, git, docker, bun) may not be on `PATH`.
>
> **Solution: `codver load_path`.** The codver CLI has a `load_path` subcommand that reads `~/.bashrc`, strips the interactivity guard, sources the result, and emits `export` statements. The caller wraps it with `eval` to load the env into the current SSH session. The PATH is consumed by eval — never displayed to the user.
>
> **Rule: prefix EVERY SSH remote command with `eval "$(~/.codver/bin/codver load_path)" &&`.** Examples:
> ```bash
> ssh host 'eval "$(~/.codver/bin/codver load_path)" && codver --help'
> ssh host 'eval "$(~/.codver/bin/codver load_path)" && codver init --force'
> ssh host 'eval "$(~/.codver/bin/codver load_path)" && codver check'
> ```
> 
> The codver binary is always installed at `~/.codver/bin/codver` — this path is hardcoded.

### 3b. Check codver exists

```bash
ssh $PORT_FLAG "$SSH_HOST" 'eval "$(~/.codver/bin/codver load_path)" && command -v codver >/dev/null && echo found || echo not_found'
```
If "not found": tell the user to install codver on the remote (to `~/.codver/bin/codver`) and stop.

### 3c. Discover commands

```bash
ssh $PORT_FLAG "$SSH_HOST" 'eval "$(~/.codver/bin/codver load_path)" && codver --help'
```

Parse the output to learn available subcommands and global options. Use this to decide:
- Which command matches the user's intent (subcommand or default pipeline)
- What flags are available

### 3d. Discover command-specific options

```bash
ssh $PORT_FLAG "$SSH_HOST" 'eval "$(~/.codver/bin/codver load_path)" && codver <subcommand> --help'
```

From the help output, identify required vs optional flags. Validate any flags the user mentioned against this list — warn if a flag doesn't exist.

### 3e. Gather missing required inputs

For required flags still missing, ask the user with **AskUserQuestion**. Omit optional flags the user didn't specify — the remote will use its defaults.

## Step 4 — Run `codver check`

Verify the remote environment before delegating:

```bash
ssh $PORT_FLAG "$SSH_HOST" 'eval "$(~/.codver/bin/codver load_path)" && codver check <any-user-provided-flags>'
```

Interpret failures for the user: missing deps → install them; no config → run `codver init`; missing API keys → set the env vars; invalid model → show the available-models list from the error; repo unreachable → check URL or `gh auth login`.

**If this is a check-only request**, stop here. **For delegation**, only proceed if check passes.

## Step 5 — Determine the model

1. Use the user-specified model if provided.
2. Otherwise, detect from the current session and map to `provider/model-id` format:
   - `deepseek-v4-pro` → `opencode-go/deepseek-v4-pro`
   - `claude-sonnet-4-6` → `anthropic/claude-sonnet-4-20250514`
   - `claude-opus-4-8` → `anthropic/claude-opus-4-8`
3. Fall back: leave `MODEL` empty; the remote uses its `defaultModel` from config.

## Step 6 — Delegate (fire-and-forget)

### 6a. Build the command

Use only flags validated against `--help` output:

```bash
SESSION_NAME="codver-$(date +%s)"
ESCAPED_TASK=$(printf '%s' "$TASK" | sed "s/'/'\\\\''/g")

CMD="codver --repo '$REPO'"
[ -n "$MODEL" ] && CMD="$CMD --model '$MODEL'"
# Append any other user-specified, help-validated flags
CMD="$CMD --prompt '$ESCAPED_TASK'"
```

### 6b. Long tasks → use --prompt-file

If the task exceeds ~2000 characters, write it to a temp file on the remote and use `--prompt-file` instead:

```bash
if [ "$(printf '%s' "$TASK" | wc -c)" -gt 2000 ]; then
  ssh $PORT_FLAG "$SSH_HOST" "mkdir -p ~/.codver-dev/tasks && cat > ~/.codver-dev/tasks/$SESSION_NAME.md" <<'TASK_EOF'
$TASK
TASK_EOF
  CMD="codver --repo '$REPO' --prompt-file ~/.codver-dev/tasks/$SESSION_NAME.md"
fi
```

### 6c. Launch via tmux (preferred) or nohup (fallback)

```bash
if [ "$(ssh $PORT_FLAG "$SSH_HOST" 'eval "$(~/.codver/bin/codver load_path)" && command -v tmux >/dev/null && echo yes || echo no')" = "yes" ]; then
  ssh $PORT_FLAG "$SSH_HOST" "tmux new-session -d -s '$SESSION_NAME' 'eval \"\$(~/.codver/bin/codver load_path)\" && cd ~ && $CMD'"
  echo "TMUX_SESSION=$SESSION_NAME"
else
  LOG_FILE="~/codver-$SESSION_NAME.log"
  ssh $PORT_FLAG "$SSH_HOST" "eval \"\$(~/.codver/bin/codver load_path)\" && cd ~ && nohup $CMD > '$LOG_FILE' 2>&1 &"
  echo "NOHUP_LOG=$LOG_FILE"
fi
```

### 6d. Verify launch

Check that the tmux session exists or the nohup log file was created. Warn if not found but don't block.

## Step 7 — Report

```
Task delegated to $SSH_HOST.

  Repository:  $REPO
  Model:       ${MODEL:-<remote default>}
  Task:        ${TASK:0:200}...

  ${TMUX_OK:+tmux session: $SESSION_NAME}
  ${TMUX_OK:+Attach:  ssh $PORT_FLAG $SSH_HOST -t tmux attach -t $SESSION_NAME}
  ${TMUX_OK:+Kill:    ssh $PORT_FLAG $SSH_HOST "tmux kill-session -t $SESSION_NAME"}
  ${TMUX_OK:-Log:     ssh $PORT_FLAG $SSH_HOST "tail -f $LOG_FILE"}
```

## Subcommand reference

| User intent | Command | Notes |
|------------|---------|-------|
| "check the server" | `codver check` | Optionally forward `--model`, `--repo` |
| "create/setup config" | `codver init` | Use `--force` to overwrite |
| "clean up" | `codver clean` | Run `--dry-run` first |

For subcommands, run directly via SSH (no tmux/nohup) and report the output. **Always prefix with `eval "$(~/.codver/bin/codver load_path)" &&`** — the remote PATH rule applies here too.

## Errors

| Situation | Action |
|-----------|--------|
| No SSH target | Stop: "No SSH target provided." |
| SSH fails | Stop: show error, suggest checking connectivity |
| codver not found | Stop: "Install codver on the remote." |
| `--help` fails | Stop: "codver CLI appears broken." |
| Unknown flag from user | Warn, don't block |
| Required flag missing | Ask user; stop if unanswered |
| `codver check` fails | Interpret failures, suggest fixes, stop |
| tmux session not found | Warn only (nohup fallback may still work) |
