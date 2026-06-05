#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/iambpn/codver.git"
INSTALL_DIR="$HOME/.codver"
SERVER_DIR="$INSTALL_DIR/server"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[codver]${NC} $1"; }
warn()  { echo -e "${CYAN}[codver]${NC} $1"; }
error() { echo -e "${RED}[codver]${NC} $1"; }

command -v git >/dev/null 2>&1 || {
  error "git is required but not installed."
  exit 1
}

command -v bun >/dev/null 2>&1 || {
  error "bun is required but not installed. Install it from https://bun.sh"
  exit 1
}

if [ ! -d "$SERVER_DIR" ]; then
  error "codver server is not installed at $SERVER_DIR"
  info "Run install-codver-server.sh first."
  exit 1
fi

info "Preserving config at $SERVER_DIR/codver.config.json ..."
CONFIG_BAK=""
if [ -f "$SERVER_DIR/codver.config.json" ]; then
  CONFIG_BAK="$(mktemp)"
  cp "$SERVER_DIR/codver.config.json" "$CONFIG_BAK"
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR" "${CONFIG_BAK:-}"' EXIT

info "Cloning $REPO ..."
git clone --depth 1 --quiet "$REPO" "$TMPDIR/repo"

info "Removing old server files ..."
rm -rf "$SERVER_DIR"

info "Copying updated server to $SERVER_DIR ..."
cp -r "$TMPDIR/repo/server" "$SERVER_DIR"

rm -rf "$SERVER_DIR/.gitignore" "$SERVER_DIR/tests" "$SERVER_DIR/CLAUDE.md" "$SERVER_DIR/README.md"

if [ -n "$CONFIG_BAK" ] && [ -f "$CONFIG_BAK" ]; then
  info "Restoring config ..."
  cp "$CONFIG_BAK" "$SERVER_DIR/codver.config.json"
fi

info "Reinstalling dependencies with bun ..."
(
  cd "$SERVER_DIR"
  bun install --production --silent
)

info ""
info "Update complete!"
info ""
info "Verify with: codver --help"
