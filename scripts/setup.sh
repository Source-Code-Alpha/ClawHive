#!/bin/bash
# ClawHive — One-Click Setup
# Sets up the multi-agent system on a new machine

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
HOME_DIR="$HOME"
PREFIX="${WORKSPACE_PREFIX:-clawd-}"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║        ClawHive — Setup Wizard        ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# --- Prerequisites ---
echo "[1/6] Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo "  ERROR: Node.js not found. Install Node.js 20+ first."
  echo "  https://nodejs.org/"
  exit 1
fi
echo "  Node.js: $(node --version)"

if ! command -v git &> /dev/null; then
  echo "  ERROR: Git not found."
  exit 1
fi
echo "  Git: OK"

if command -v claude &> /dev/null; then
  echo "  Claude Code: $(claude --version 2>/dev/null || echo 'installed')"
else
  echo "  WARNING: Claude Code CLI not found."
  echo "  Install with: npm i -g @anthropic-ai/claude-code"
  read -p "  Continue anyway? (y/n) " CONTINUE
  [ "$CONTINUE" != "y" ] && exit 1
fi

# --- Create dispatcher ---
echo ""
echo "[2/6] Setting up dispatcher..."
if [ ! -f "$HOME_DIR/CLAUDE.md" ]; then
  cp "$REPO_DIR/dispatcher/CLAUDE.md" "$HOME_DIR/CLAUDE.md"
  echo "  Created ~/CLAUDE.md"
else
  echo "  ~/CLAUDE.md already exists (skipped)"
fi

# --- Create agent workspaces ---
echo ""
echo "[3/6] Creating agent workspaces..."
AGENT_COUNT=0

for agent_dir in "$REPO_DIR/agents"/*/; do
  SLUG=$(basename "$agent_dir")
  TARGET="$HOME_DIR/${PREFIX}${SLUG}"

  if [ -d "$TARGET" ]; then
    echo "  $SLUG: already exists (skipped)"
  else
    mkdir -p "$TARGET"/{memory,topics}
    cp "$agent_dir"/*.md "$TARGET/" 2>/dev/null || true

    # Rename templates to actual files
    for tmpl in "$TARGET"/*.template; do
      [ -f "$tmpl" ] && mv "$tmpl" "${tmpl%.template}"
    done

    echo "  $SLUG: created"
  fi
  AGENT_COUNT=$((AGENT_COUNT + 1))
done
echo "  $AGENT_COUNT agents set up"

# --- Create shared directory ---
echo ""
echo "[4/6] Setting up shared resources..."
SHARED_DIR="$HOME_DIR/${PREFIX}shared"
mkdir -p "$SHARED_DIR"/{skills,credentials,knowledge,templates,workflows}

if [ -d "$REPO_DIR/skills" ]; then
  cp -r "$REPO_DIR/skills"/* "$SHARED_DIR/skills/" 2>/dev/null || true
  SKILL_COUNT=$(ls -d "$SHARED_DIR/skills"/*/ 2>/dev/null | wc -l)
  echo "  $SKILL_COUNT skills installed"
else
  echo "  No skills to install"
fi

# --- Install command center ---
echo ""
echo "[5/6] Setting up Command Center..."
CC_DIR="$HOME_DIR/clawhive-command-center"
if [ -d "$REPO_DIR/command-center" ]; then
  # Use coding agent workspace if it exists, otherwise standalone
  if [ -d "$HOME_DIR/${PREFIX}coding" ]; then
    CC_DIR="$HOME_DIR/${PREFIX}coding/command-center"
  fi
  mkdir -p "$CC_DIR"
  cp -r "$REPO_DIR/command-center"/* "$CC_DIR/"
  cd "$CC_DIR" && npm install --silent 2>/dev/null
  echo "  Installed at: $CC_DIR"
  echo "  Run: cd $CC_DIR && npx tsx server/index.ts"
else
  echo "  Command center not found in repo (skipped)"
fi

# --- Summary ---
echo ""
echo "[6/6] Setup complete!"
echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║           Setup Complete!             ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
echo "  Agents: $AGENT_COUNT"
echo "  Skills: ${SKILL_COUNT:-0}"
echo "  Dispatcher: ~/CLAUDE.md"
echo ""
echo "  Next steps:"
echo "  1. Edit USER.md in each agent with your info"
echo "  2. Edit TOOLS.md with your environment details"
echo "  3. Start the command center:"
echo "     cd $CC_DIR && npx tsx server/index.ts"
echo "  4. Open http://localhost:3096 in your browser"
echo "  5. Or just: cd ~/clawd-coding && claude"
echo ""
echo "  Add new agents anytime:"
echo "     ./scripts/add-agent.sh"
echo ""
