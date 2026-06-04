#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/iambpn/codver.git"
SKILL_DIR=".agents/skills/codver-delegate"

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "")"

if [ -z "$TARGET" ]; then
  echo "Error: target directory '$1' does not exist"
  exit 1
fi

if [ -d "$TARGET/codver-delegate" ]; then
  echo "Error: target directory already contains codver-delegate/"
  exit 1
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "Cloning $REPO ..."
git clone --depth 1 --quiet "$REPO" "$TMPDIR/repo"

echo "Copying codver-delegate skill to $TARGET ..."
cp -r "$TMPDIR/repo/$SKILL_DIR" "$TARGET/codver-delegate"

echo "Done. Skill installed at $TARGET/codver-delegate"
