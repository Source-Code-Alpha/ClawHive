#!/bin/bash
# mempalace-onboard-agent.sh — mine an agent's memory into a MemPalace and register MCP server
# Usage: bash scripts/mempalace-onboard-agent.sh <agent_id>
# Example: bash scripts/mempalace-onboard-agent.sh atlas

set -e
AGENT_ID="$1"

if [ -z "$AGENT_ID" ]; then
  echo "Usage: $0 <agent_id>"
  echo "Example: $0 atlas"
  exit 1
fi

WORKSPACE="$HOME/clawd-${AGENT_ID}"
PALACE="$HOME/.mempalace/${AGENT_ID}"
TMPDIR_MP="$HOME/AppData/Local/Temp/mempalace-onboard-${AGENT_ID}"
CLAUDE_BIN="C:/nvm4w/nodejs/claude.cmd"

export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

if [ ! -d "$WORKSPACE" ]; then
  echo "ERROR: workspace $WORKSPACE not found"
  exit 1
fi

echo "=== Onboarding ${AGENT_ID} ==="
echo "  Workspace: $WORKSPACE"
echo "  Palace:    $PALACE"

# Create palace dir
mkdir -p "$PALACE"

# Step 1: Mine memory/ daily files (the richest source)
DRAWERS=0
if [ -d "$WORKSPACE/memory" ] && [ "$(ls -A "$WORKSPACE/memory" 2>/dev/null)" ]; then
  echo "  Mining memory/ ..."
  OUTPUT=$(python -m mempalace --palace "$PALACE" mine "$WORKSPACE/memory" --mode convos --extract general --wing "$AGENT_ID" 2>&1)
  COUNT=$(echo "$OUTPUT" | grep "Drawers filed:" | grep -oP '\d+' || echo "0")
  DRAWERS=$((DRAWERS + COUNT))
  echo "    -> $COUNT drawers"
else
  echo "  No memory/ directory or empty — skipping"
fi

# Step 2: Mine main MEMORY.md (needs a temp dir since mine takes dirs not files)
if [ -f "$WORKSPACE/MEMORY.md" ] && [ -s "$WORKSPACE/MEMORY.md" ]; then
  echo "  Mining MEMORY.md ..."
  mkdir -p "$TMPDIR_MP"
  cp "$WORKSPACE/MEMORY.md" "$TMPDIR_MP/MAIN_MEMORY.md"
  OUTPUT=$(python -m mempalace --palace "$PALACE" mine "$TMPDIR_MP" --mode convos --extract general --wing "$AGENT_ID" 2>&1)
  COUNT=$(echo "$OUTPUT" | grep "Drawers filed:" | grep -oP '\d+' || echo "0")
  DRAWERS=$((DRAWERS + COUNT))
  echo "    -> $COUNT drawers"
  rm -rf "$TMPDIR_MP"
else
  echo "  No MEMORY.md or empty — skipping"
fi

# Step 3: Register MCP server (must cd to workspace so claude registers per-project)
echo "  Registering MCP server ..."
cd "$WORKSPACE"
"$CLAUDE_BIN" mcp add mempalace -- python -m mempalace.mcp_server --palace "$PALACE" 2>&1 | head -2

echo "  ✓ ${AGENT_ID} done — ${DRAWERS} total drawers"
echo ""
