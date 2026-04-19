#!/bin/bash
# agent-self-review.sh — trigger a reflective self-review for an agent
# The agent reads its own SOUL.md, AGENTS.md, and the last 7 days of memory,
# then proposes changes to its own identity files based on patterns it observes.
#
# Usage: bash scripts/agent-self-review.sh <agent_id>
# Example: bash scripts/agent-self-review.sh coding
#
# Schedule weekly via cron, Discord slash command, or run manually:
#   for agent in coding designer researcher; do
#     bash scripts/agent-self-review.sh "$agent"
#   done

set -e
AGENT_ID="$1"

if [ -z "$AGENT_ID" ]; then
  echo "Usage: $0 <agent_id>"
  exit 1
fi

WORKSPACE="$HOME/clawd-${AGENT_ID}"
NODE_BIN="C:/nvm4w/nodejs/node.exe"
CLAUDE_CLI="C:/nvm4w/nodejs/node_modules/@anthropic-ai/claude-code/cli.js"

if [ ! -d "$WORKSPACE" ]; then
  echo "ERROR: workspace $WORKSPACE not found"
  exit 1
fi

echo "=== Self-review for ${AGENT_ID} ==="

REVIEW_PROMPT="You are performing a self-review of your own identity files.

Read these files carefully:
1. SOUL.md — your personality and values
2. AGENTS.md — your operating manual and SOPs
3. IDENTITY.md — your role and domains
4. The last 7 daily memory files in memory/ (if they exist)
5. CURRENT_TASK.md (if it exists)

Based on what you find, answer these questions:
1. SOUL.md: Does my personality match how I actually work? Any traits that should change?
2. AGENTS.md: Are my SOPs complete? Any workflows I do repeatedly that aren't documented?
3. IDENTITY.md: Is my role description accurate? Any domains I should add or remove?
4. Patterns: What do I do well repeatedly? What mistakes keep appearing in my memory?
5. Gaps: What knowledge or procedures am I missing that would make me more effective?

For each finding, write a SPECIFIC proposed edit (not vague suggestions). Example:
  'In SOUL.md, add to coding philosophy: Always run the linter before committing.'
  'In AGENTS.md, add SOP for handling merge conflicts in dual-repo pushes.'

If everything looks good and no changes are needed, say so honestly. Don't invent changes for the sake of the exercise.

Write your proposed edits to a file: memory/self-review-$(date +%Y-%m-%d).md"

cd "$WORKSPACE"
"$NODE_BIN" "$CLAUDE_CLI" \
  -p "$REVIEW_PROMPT" \
  --model haiku \
  --dangerously-skip-permissions \
  --output-format text \
  2>&1

echo ""
echo "=== Review complete. Check ${WORKSPACE}/memory/self-review-*.md ==="
