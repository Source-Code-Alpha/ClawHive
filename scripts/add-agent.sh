#!/bin/bash
# ClawHive — Add a New Agent
# Creates a new agent workspace from the template

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_DIR="$REPO_DIR/templates/agent"
HOME_DIR="$HOME"
PREFIX="${WORKSPACE_PREFIX:-clawd-}"

echo ""
echo "  === ClawHive — Add New Agent ==="
echo ""

# Prompt for agent details
read -p "  Agent slug (lowercase, no spaces): " SLUG
read -p "  Display name: " NAME
read -p "  Emoji: " EMOJI
read -p "  Role (one line): " ROLE
read -p "  Vibe (personality keywords): " VIBE

if [ -z "$SLUG" ] || [ -z "$NAME" ]; then
  echo "  ERROR: Slug and name are required."
  exit 1
fi

AGENT_DIR="$HOME_DIR/${PREFIX}${SLUG}"
REPO_AGENT_DIR="$REPO_DIR/agents/$SLUG"

# Check if agent already exists
if [ -d "$AGENT_DIR" ]; then
  echo "  WARNING: $AGENT_DIR already exists. Skipping workspace creation."
else
  echo "  Creating workspace: $AGENT_DIR"
  mkdir -p "$AGENT_DIR"/{memory,topics}

  # Copy and fill templates
  cp "$TEMPLATE_DIR/CLAUDE.md" "$AGENT_DIR/CLAUDE.md"

  cat > "$AGENT_DIR/IDENTITY.md" << IDENTITY
# Identity -- $NAME

Name: $NAME
Emoji: $EMOJI
Vibe: $VIBE
Role: $ROLE
IDENTITY

  cp "$TEMPLATE_DIR/SOUL.md.template" "$AGENT_DIR/SOUL.md"
  sed -i "s/{{AGENT_NAME}}/$NAME/g" "$AGENT_DIR/SOUL.md"

  cp "$TEMPLATE_DIR/AGENTS.md.template" "$AGENT_DIR/AGENTS.md"
  sed -i "s/{{AGENT_NAME}}/$NAME/g; s/{{agent_slug}}/$SLUG/g" "$AGENT_DIR/AGENTS.md"

  cp "$TEMPLATE_DIR/USER.md.template" "$AGENT_DIR/USER.md"
  cp "$TEMPLATE_DIR/TOOLS.md.template" "$AGENT_DIR/TOOLS.md"
  cp "$TEMPLATE_DIR/MEMORY.md" "$AGENT_DIR/MEMORY.md"

  echo "  Workspace created with all template files."
fi

# Also add to repo agents/ directory (if running from repo)
if [ -d "$REPO_DIR/agents" ] && [ ! -d "$REPO_AGENT_DIR" ]; then
  echo "  Adding to repo agents/ directory..."
  mkdir -p "$REPO_AGENT_DIR"
  cp "$AGENT_DIR"/*.md "$REPO_AGENT_DIR/" 2>/dev/null || true
  cp "$TEMPLATE_DIR/USER.md.template" "$REPO_AGENT_DIR/"
  cp "$TEMPLATE_DIR/TOOLS.md.template" "$REPO_AGENT_DIR/"
fi

# Update dispatcher CLAUDE.md roster
DISPATCHER="$HOME_DIR/CLAUDE.md"
if [ -f "$DISPATCHER" ]; then
  if ! grep -q "$SLUG" "$DISPATCHER"; then
    echo "  NOTE: Add this agent to your dispatcher CLAUDE.md roster:"
    echo "  | \`$SLUG\` | $NAME | $EMOJI | $ROLE | \`${PREFIX}${SLUG}/\` |"
  fi
fi

echo ""
echo "  Done! Agent '$NAME' ($EMOJI) is ready."
echo "  Workspace: $AGENT_DIR"
echo "  Launch: cd $AGENT_DIR && claude"
echo ""
