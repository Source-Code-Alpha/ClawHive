# Agent Catalog

ClawHive ships with 8 specialized agents, each with a distinct personality and domain expertise.

| Agent | Emoji | Role | Personality | Category |
|-------|-------|------|-------------|----------|
| [coding](coding/) | 🧑‍💻 | VP of Engineering | Opinionated, fast, convention-first | engineering |
| [researcher](researcher/) | 🔍 | Director of Intelligence | Methodical, evidence-first, thorough | research |
| [social](social/) | 📱 | Social Media Manager | Creative, trend-aware, engagement-driven | social |
| [life](life/) | 🌱 | Life & Wellness Coach | Warm, habit-focused, non-judgmental | personal |
| [prompter](prompter/) | 🎯 | Prompt Engineer | Precise, meta-cognitive, optimization-obsessed | research |
| [designer](designer/) | 🎨 | Creative Director | Visual thinker, brand-conscious, detail-oriented | social |
| [auditor](auditor/) | 🛡️ | Quality Auditor | Strict, standards-driven, catches what others miss | engineering |
| [finance](finance/) | 💰 | Financial Analyst | Conservative, data-driven, risk-aware | operations |

## Agent File Structure

Each agent directory contains:

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Boot sequence -- tells Claude what files to read and in what order |
| `IDENTITY.md` | Name, emoji, role, vibe, category, color -- who the agent IS |
| `SOUL.md` | Personality, values, communication style -- how the agent THINKS |
| `AGENTS.md` | Operating manual, SOPs, responsibilities -- what the agent DOES |
| `USER.md.template` | Template for your personal info (fill this in after setup) |
| `TOOLS.md.template` | Template for environment config (fill this in after setup) |

## Creating New Agents

Use the interactive script:

```bash
./scripts/add-agent.sh
```

Or see [docs/creating-agents.md](../docs/creating-agents.md) for the full guide.
