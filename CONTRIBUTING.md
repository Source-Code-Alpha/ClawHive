# Contributing to ClawHive

Thanks for your interest in contributing! ClawHive thrives on community contributions -- whether it's a new agent, a skill, a bug fix, or better docs.

## Ways to Contribute

### 1. Create a New Agent

The easiest and most impactful contribution. Design an agent with a unique personality and expertise.

**Steps:**
1. Fork the repo
2. Copy `templates/agent/` to `agents/{your-agent-name}/`
3. Write `IDENTITY.md` -- name, emoji, role, vibe
4. Write `SOUL.md` -- personality, communication style, values
5. Write `AGENTS.md` -- operating manual, SOPs, responsibilities
6. Include `USER.md.template` and `TOOLS.md.template`
7. Add your agent to the roster table in `dispatcher/CLAUDE.md`
8. Submit a PR

**What makes a great agent:**
- A distinct personality (not just "helpful assistant")
- Specific domain expertise
- Clear opinions and preferences
- Defined anti-patterns (what the agent avoids)
- Useful in real workflows

See [docs/creating-agents.md](docs/creating-agents.md) for the full guide.

### 2. Build a Skill

Skills are reusable capability modules. A great skill encodes expert methodology into a SKILL.md file.

**Steps:**
1. Create `skills/{skill-name}/SKILL.md`
2. Optionally add `scripts/` with automation
3. Test with an agent
4. Submit a PR

See [docs/skills-guide.md](docs/skills-guide.md) for details.

### 3. Improve the Command Center

The web dashboard at `command-center/` is vanilla HTML/CSS/JS + Express backend. No framework, no build step.

**Ideas:**
- New features (agent metrics, session history viewer)
- UI improvements (themes, animations, accessibility)
- Mobile experience
- Performance optimizations

### 4. Fix Bugs or Improve Docs

Found a bug? Docs unclear? PRs welcome for anything.

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/ClawHive.git
cd ClawHive

# Run setup
./scripts/setup.sh

# Start command center in dev mode
cd command-center
npm install
npx tsx server/index.ts
```

## PR Guidelines

- **Keep PRs focused.** One feature or fix per PR.
- **No personal data.** No real names, IPs, emails, or credentials in any file.
- **Test your changes.** If you're adding an agent, verify it loads correctly with `claude`.
- **Follow existing patterns.** Look at how existing agents and skills are structured.
- **Write clear commit messages.** Describe *what* and *why*.

## Proposing New Agents

Have an idea but not sure about the design? Open an issue using the "New Agent Proposal" template. The community can help refine the concept before you build it.

## Code Style

- **Markdown:** Use `--` for em-dashes (not unicode). Keep line lengths reasonable.
- **TypeScript:** Follow the existing Express patterns in `command-center/server/`.
- **CSS:** Follow the existing design system (CSS custom properties, dark theme).
- **Shell scripts:** Use `set -e`, quote variables, support both bash and zsh.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Questions? Open an issue or start a discussion. We're friendly.
