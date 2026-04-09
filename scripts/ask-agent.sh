#!/bin/bash
# ask-agent.sh — delegate a question to another agent and get a clean answer
#
# Usage: bash ~/clawd-shared/scripts/ask-agent.sh <agent_id> "<question>"
# Example: bash ~/clawd-shared/scripts/ask-agent.sh plant_ops "what's the current production schedule for Line 1?"
#
# The target agent runs in its OWN workspace with its OWN identity files,
# so it answers as itself (ARTIS answers as a plant manager, not as you).
# Uses Haiku for speed. No session persistence (delegation calls are ephemeral).
#
# Available agents:
#   soha_coding   — VP Engineering, full-stack dev
#   plant_ops     — Plant manager (ARTIS), manufacturing ops
#   chimi_ops     — CMO, sales/marketing/export
#   atlas         — Research generalist, homelab, personal
#   soha_rd       — R&D (chemical + software)
#   soha_finance  — Financial planning, budgeting, pricing
#   the_doctor    — System health, infrastructure ops
#   crypto_trader — Crypto analysis and trading
#   idea_forge    — Product strategy, idea stress-testing
#   aurelia       — Creative direction, design
#   reco          — Department reconstruction
#   personal      — Director, fleet leader, fallback

AGENT_ID="$1"
QUESTION="$2"

if [ -z "$AGENT_ID" ] || [ -z "$QUESTION" ]; then
  echo "Usage: bash ~/clawd-shared/scripts/ask-agent.sh <agent_id> \"<question>\""
  echo "Available: soha_coding plant_ops chimi_ops atlas soha_rd soha_finance the_doctor crypto_trader idea_forge aurelia reco personal"
  exit 1
fi

WORKSPACE="$HOME/clawd-${AGENT_ID}"
NODE_BIN="C:/nvm4w/nodejs/node.exe"
CLAUDE_CLI="C:/nvm4w/nodejs/node_modules/@anthropic-ai/claude-code/cli.js"

if [ ! -d "$WORKSPACE" ]; then
  echo "ERROR: agent workspace not found at $WORKSPACE"
  exit 1
fi

# Run claude -p in the target agent's workspace
# Uses Haiku for speed, no session persistence, concise answers
"$NODE_BIN" "$CLAUDE_CLI" \
  -p "$QUESTION" \
  --model haiku \
  --dangerously-skip-permissions \
  --output-format text \
  --no-session-persistence \
  --append-system-prompt "This is a delegation request from another agent. Answer concisely and specifically in 1-3 short paragraphs. Focus on facts and data. Do not ask follow-up questions — just answer with what you know." \
  2>/dev/null
