#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/iambpn/codver.git"
INSTALL_DIR="$HOME/.codver"
SERVER_DIR="$INSTALL_DIR/server"
BIN_DIR="$SERVER_DIR/bin"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[codver]${NC} $1"; }
warn()  { echo -e "${CYAN}[codver]${NC} $1"; }
error() { echo -e "${RED}[codver]${NC} $1"; }

command -v bun >/dev/null 2>&1 || {
  error "bun is required but not installed. Install it from https://bun.sh"
  exit 1
}

if [ -d "$SERVER_DIR" ]; then
  info "Removing existing installation at $SERVER_DIR ..."
  rm -rf "$SERVER_DIR"
fi

mkdir -p "$INSTALL_DIR"

REPO_CACHE="/tmp/codver-repo"

if [ -d "$REPO_CACHE/.git" ]; then
  info "Repo already cloned at $REPO_CACHE — pulling latest ..."
  git -C "$REPO_CACHE" fetch --depth 1 origin --quiet
  git -C "$REPO_CACHE" reset --hard origin/main --quiet
else
  info "Cloning $REPO ..."
  git clone --depth 1 --quiet "$REPO" "$REPO_CACHE"
fi

info "Copying server to $SERVER_DIR ..."
cp -r "$REPO_CACHE/server" "$SERVER_DIR"

# Remove things not needed at runtime
rm -rf "$SERVER_DIR/.gitignore" "$SERVER_DIR/tests" "$SERVER_DIR/CLAUDE.md" "$SERVER_DIR/README.md"

info "Installing dependencies with bun ..."
(
  cd "$SERVER_DIR"
  bun install --production --silent
)

add_to_path() {
  local target="$1"
  local export_line="export PATH=\"$BIN_DIR:\$PATH\""
  local comment="# Added by codver server installer"

  if [ -f "$target" ]; then
    if grep -q "$BIN_DIR" "$target" 2>/dev/null; then
      return
    fi
    echo "" >> "$target"
    echo "$comment" >> "$target"
    echo "$export_line" >> "$target"
    info "Added $BIN_DIR to $target"
  fi
}

info "Configuring PATH ..."
add_to_path "$HOME/.bashrc"
# add_to_path "$HOME/.zshrc"
# add_to_path "$HOME/.profile"

if [ -f "$HOME/.config/fish/config.fish" ]; then
  fish_line="fish_add_path $BIN_DIR"
  if ! grep -q "$BIN_DIR" "$HOME/.config/fish/config.fish" 2>/dev/null; then
    echo "" >> "$HOME/.config/fish/config.fish"
    echo "# Added by codver server installer" >> "$HOME/.config/fish/config.fish"
    echo "$fish_line" >> "$HOME/.config/fish/config.fish"
    info "Added $BIN_DIR to fish config"
  fi
fi

warn ""
if [ -f "$HOME/.bashrc" ]; then
  warn "PATH was added to ~/.bashrc. Start a new terminal or source it:"
  warn "  source ~/.bashrc"
else
  warn ".bashrc not found — your shell may not be bash."
  warn "Add the following to your shell's rc file (e.g. ~/.zshrc):"
  warn "  export PATH=\"$BIN_DIR:\$PATH\""
fi

info ""
info "Installation complete!"
info ""
info "Run the following to start using codver now:"
info "  export PATH=\"$BIN_DIR:\$PATH\""
info ""
info "Or open a new terminal session."
info ""
info "Verify with: codver --help"
