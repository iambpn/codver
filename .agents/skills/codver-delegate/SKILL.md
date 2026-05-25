---
name: codver-delegate
description: Delegate a coding task to the remote server agent (fire-and-forget). It will raise the pr in the github repository. Use when the user wants to offload a task to a remote opencode instance.
license: MIT
compatibility: Requires ssh and tmux. Requires either a ~/.codever-ssh config file or an explicit user@host in the prompt
metadata:
  author: codever
  version: "2.0"
allowed-tools: Bash(ssh:*) Bash(bash:*)
---

# Delegate Task to Server Agent

When the user invokes `/codver-delegate` or asks to delegate a coding task to the remote server, follow these steps in order.

## Step 1 — Determine the SSH target

1. **If the user's prompt contains an SSH hostname/server** (e.g. `deploy@192.168.1.10`, `root@my-server`), extract the `user@host` string directly.
2. **Otherwise**, read the target from `~/.codever-ssh` by running:

```bash
bash scripts/parse-ssh-target.sh
```

The script prints the `user@host` string to stdout. Use that as `USERHOST`.

## Step 2 — Check prerequisites

Run these checks against the remote host to fail early with clear errors:

### 2a. SSH connectivity

```bash
ssh -o ConnectTimeout=10 -o BatchMode=yes "$USERHOST" "true"
```

If this fails, report the error and stop.

### 2b. tmux availability

```bash
ssh -o ConnectTimeout=10 "$USERHOST" "command -v tmux >/dev/null"
```

If this fails, tell the user `tmux` is not installed on the remote host and stop.

### 2c. opencode availability

```bash
ssh -o ConnectTimeout=10 "$USERHOST" "command -v opencode >/dev/null"
```

If this fails, tell the user `opencode` is not found on the remote host and stop.

## Step 3 — Create the tmux session

Check whether a session named `opencode` already exists, then create one. **Always create the session with a persistent shell first**, then send `opencode` via `send-keys`. Running `opencode` directly as the tmux command causes the session to be destroyed if `opencode` exits (e.g. crashes on startup due to missing TTY).

```bash
ssh -o ConnectTimeout=10 "$USERHOST" "tmux has-session -t opencode 2>/dev/null && (tmux new-session -d -s opencode-\$(date +%s) 2>&1 && tmux send-keys -t opencode-\$(date +%s) opencode Enter) || (tmux new-session -d -s opencode 2>&1 && tmux send-keys -t opencode opencode Enter)"
```

Report success or failure to the user.

## Error reference

| Exit code | Meaning                                           |
| --------- | ------------------------------------------------- |
| 2         | `~/.codever-ssh` file is missing                  |
| 3         | Could not parse a valid `user@host` from config  |