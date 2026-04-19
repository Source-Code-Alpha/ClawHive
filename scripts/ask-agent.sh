#!/bin/bash
# ask-agent.sh — delegate a question to another agent and get a clean answer
#
# Usage: bash ~/clawd-shared/scripts/ask-agent.sh <agent_id> "<question>"
# Example: bash ~/clawd-shared/scripts/ask-agent.sh researcher "what are the latest homelab trends?"
#
# The target agent runs in its OWN workspace with its OWN identity files,
# so it answers as itself (a research agent answers with research context,
# a finance agent with financial context, etc.).
# Uses Haiku for speed. No session persistence (delegation calls are ephemeral).
#
# Available agents depend on your ClawHive configuration. See the agents/
# directory at the repo root for the starter roster (coding, designer,
# researcher, finance, life, social, auditor) or any agents you've added.

AGENT_ID="$1"
QUESTION="$2"

if [ -z "$AGENT_ID" ] || [ -z "$QUESTION" ]; then
  echo "Usage: bash ~/clawd-shared/scripts/ask-agent.sh <agent_id> \"<question>\""
  echo "See the agents/ directory at the repo root for the current roster."
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
