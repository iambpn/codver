#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.codver"
SERVER_DIR="$INSTALL_DIR/server"
BIN_DIR="$SERVER_DIR/bin"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${GREEN}[codver]${NC} $1"; }
warn()    { echo -e "${CYAN}[codver]${NC} $1"; }
error()   { echo -e "${RED}[codver]${NC} $1"; }
success() { echo -e "${GREEN}[codver]${NC} $1"; }

# ─── Step 1: Run codver clean ────────────────────────────────────────
info "Step 1: Cleaning codver working directories ..."
if command -v codver >/dev/null 2>&1; then
  codver clean --all || warn "codver clean exited with non-zero status (continuing anyway)"
else
  warn "codver command not found — removing ~/.codver-dev/ directly"
  if [ -d "$HOME/.codver-dev" ]; then
    rm -rf "$HOME/.codver-dev"
    success "Removed ~/.codver-dev/"
  fi
fi

# ─── Step 2: Remove server installation ──────────────────────────────
info ""
info "Step 2: Removing server installation ..."

if [ -d "$SERVER_DIR" ]; then
  info "Removing $SERVER_DIR ..."
  rm -rf "$SERVER_DIR"
  success "Server installation removed."
else
  info "Server directory $SERVER_DIR does not exist — nothing to remove."
fi

# Also remove the top-level ~/.codver if it's now empty or only has
# leftover files we don't care about.
if [ -d "$INSTALL_DIR" ]; then
  # Check if the directory is empty after removing server/
  if [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    info "Removing empty $INSTALL_DIR ..."
    rmdir "$INSTALL_DIR"
  fi
fi

# ─── Step 3: Remove PATH entries from shell configs ──────────────────
info ""
info "Step 3: Cleaning shell config files ..."

remove_path_entry() {
  local target="$1"
  local pattern="$2"

  if [ -f "$target" ]; then
    if grep -q "$pattern" "$target" 2>/dev/null; then
      info "Removing codver PATH entry from $target ..."
      # Remove the comment line and the export/fish_add_path line
      # Use sed to remove both lines: the comment and the PATH line
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' '/# Added by codver server installer/d' "$target"
        sed -i '' '/codver\/server\/bin/d' "$target"
      else
        sed -i '/# Added by codver server installer/d' "$target"
        sed -i '/codver\/server\/bin/d' "$target"
      fi
      success "Cleaned $target"
    else
      info "No codver PATH entry found in $target — skipping"
    fi
  fi
}

remove_path_entry "$HOME/.bashrc" "codver/server/bin"
remove_path_entry "$HOME/.config/fish/config.fish" "codver/server/bin"

# ─── Step 4: Config directory (ask before removing) ──────────────────
CONFIG_DIR="$HOME/.config/codver"

info ""
info "Step 4: Config directory"
if [ -d "$CONFIG_DIR" ]; then
  warn "Config directory still exists: $CONFIG_DIR"
  warn "This contains your codver.config.json (API keys, settings)."
  warn ""
  read -r -p $'\033[0;36m[codver]\033[0m Remove config directory as well? [y/N] ' answer
  case "$answer" in
    [yY]|[yY][eE][sS])
      rm -rf "$CONFIG_DIR"
      success "Config directory removed."
      ;;
    *)
      info "Config directory preserved at $CONFIG_DIR"
      ;;
  esac
else
  info "Config directory $CONFIG_DIR does not exist — nothing to remove."
fi

# ─── Done ────────────────────────────────────────────────────────────
info ""
success "Uninstall complete!"
info ""
warn "Note: If you installed the codver-delegate skill in any project,"
warn "you can remove it manually with:"
warn "  rm -rf <project>/.agents/skills/codver-delegate"
info ""
info "You may want to start a new terminal session to clear the PATH."
info "Or run: hash -r"
