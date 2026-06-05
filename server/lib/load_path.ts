/**
 * Codver Load-Path — Source ~/.bashrc (stripping the interactive guard)
 * and emit export/alias statements so the caller can eval them into the
 * current shell.
 *
 * Many ~/.bashrc files contain a guard like:
 *
 *   case $- in
 *       *i*) ;;
 *         *) return;;
 *   esac
 *
 * which causes non-interactive shells (like SSH remote commands) to exit
 * before setting PATH, aliases, and other environment variables. This
 * command strips that guard, sources the rest, diffs the environment
 * (exports + aliases), and emits only what .bashrc added or changed.
 *
 * Usage:
 *   eval "$(codver load_path)"
 *
 * Nothing is displayed to the user — eval consumes it inside the SSH session.
 */

import { $ } from "bun";

export async function runLoadPath(): Promise<void> {
  const home = process.env.HOME || "~";
  const bashrcPath = `${home}/.bashrc`;

  // Build a bash script that:
  // 1. Snapshots the current set of exported vars and aliases
  // 2. Reads ~/.bashrc (if it exists)
  // 3. Strips the "case $- in ... esac" interactivity guard
  // 4. Sources the filtered result in the current subshell
  // 5. Emits *only* the exports and aliases that .bashrc added or changed
  const script = `
    if [ -f "${bashrcPath}" ]; then
      _codver_before_exports=$(export -p 2>/dev/null)
      _codver_before_aliases=$(alias -p 2>/dev/null)

      filtered=$(awk '
        /^[[:space:]]*case[[:space:]]+\\$-/ { in_guard=1; next }
        /^[[:space:]]*esac/ && in_guard   { in_guard=0; next }
        !in_guard
      ' "${bashrcPath}")
      eval "$filtered" 2>/dev/null

      # Emit new/changed environment variables
      comm -13 <(printf '%s\\n' "$_codver_before_exports" | sort) <(export -p | sort) 2>/dev/null

      # Emit new/changed aliases
      comm -13 <(printf '%s\\n' "$_codver_before_aliases" | sort) <(alias -p 2>/dev/null | sort) 2>/dev/null
    fi
  `;

  const result = await $`bash -c ${script}`.quiet();
  process.stdout.write(result.stdout.toString());
}
