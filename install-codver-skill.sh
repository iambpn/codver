#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/iambpn/codver.git"
SRC_SKILL=".agents/skills/codver-delegate"

# Target is the project root directory. The skill is always installed at
# <project-root>/.agents/skills/codver-delegate regardless of the target.
PROJECT_ROOT="${1:-.}"
PROJECT_ROOT="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd || echo "")"

if [ -z "$PROJECT_ROOT" ]; then
  echo "Error: target directory '$1' does not exist"
  exit 1
fi

INSTALL_DIR="$PROJECT_ROOT/.agents/skills"
SKILL_PATH="$INSTALL_DIR/codver-delegate"

if [ -d "$SKILL_PATH" ]; then
  echo "Error: $SKILL_PATH already exists"
  exit 1
fi

REPO_CACHE="/tmp/codver-repo"

if [ -d "$REPO_CACHE/.git" ]; then
  echo "Repo already cloned at $REPO_CACHE — pulling latest ..."
  git -C "$REPO_CACHE" fetch --depth 1 origin --quiet
  git -C "$REPO_CACHE" reset --hard origin/main --quiet
else
  echo "Cloning $REPO ..."
  git clone --depth 1 --quiet "$REPO" "$REPO_CACHE"
fi

mkdir -p "$INSTALL_DIR"

echo "Copying codver-delegate skill to $INSTALL_DIR ..."
cp -r "$REPO_CACHE/$SRC_SKILL" "$SKILL_PATH"

echo "Done. Skill installed at $SKILL_PATH"
