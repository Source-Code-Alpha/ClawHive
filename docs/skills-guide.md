# Skills Guide

Skills are reusable capability modules that any agent can access. A skill encapsulates methodology, expertise, and optional automation scripts into a self-contained directory. When an agent loads a skill, it gains structured knowledge about how to perform a specific task -- code reviews, brainstorming sessions, architecture design, security audits, and more.

Skills are the building blocks that make agents genuinely useful. Instead of relying on the agent to figure out how to do something from scratch, a skill provides a proven methodology that the agent follows step by step.

---

## Skill Structure

Every skill is a directory containing at minimum a `SKILL.md` file. Additional files are optional.

```
skills/
└── code-review/
    ├── SKILL.md          # Core instructions and methodology (required)
    ├── _meta.json         # Metadata: name, category, version (optional)
    ├── README.md          # Human-readable description (optional)
    └── scripts/           # Automation scripts (optional)
        └── review.py
```

### File Roles

| File | Required | Purpose |
|------|----------|---------|
| `SKILL.md` | Yes | The methodology, steps, checklists, and expertise the agent follows |
| `_meta.json` | No | Machine-readable metadata for indexing and discovery |
| `README.md` | No | Human-readable explanation for browsing the skills directory |
| `scripts/` | No | Python, Node.js, or Bash scripts the agent can execute |

---

## Writing a SKILL.md

The `SKILL.md` file is the core of every skill. It contains everything the agent needs to perform the task: context, methodology, checklists, examples, and constraints.

### Anatomy of a Good SKILL.md

1. **Frontmatter** -- YAML metadata block with name, description, category, version
2. **Purpose** -- What this skill does and when to use it
3. **Methodology** -- Step-by-step process the agent follows
4. **Checklists** -- Concrete items to verify or complete
5. **Examples** -- Good and bad examples that illustrate the standard
6. **Constraints** -- What the agent must never do while using this skill

### Complete Example: Code Review Skill

```markdown
---
name: code-review
model: reasoning
category: testing
description: >
  Systematic code review covering security, performance,
  maintainability, correctness, and testing.
version: 1.0
---

# Code Review Checklist

Thorough, structured approach to reviewing code. Work through
each dimension systematically rather than scanning randomly.

## Review Dimensions

| Dimension       | Focus                                  | Priority |
|-----------------|----------------------------------------|----------|
| Security        | Vulnerabilities, auth, data exposure   | Critical |
| Performance     | Speed, memory, scalability bottlenecks | High     |
| Correctness     | Logic errors, edge cases               | High     |
| Maintainability | Readability, structure, future-proofing| Medium   |
| Testing         | Coverage, quality, reliability         | Medium   |

## Security Checklist

- [ ] SQL Injection -- All queries use parameterized statements
- [ ] XSS -- User content is escaped before rendering
- [ ] Authentication -- Every protected endpoint verifies the user
- [ ] Secrets Management -- No credentials in source code
- [ ] Input Validation -- All external input validated server-side

## Performance Checklist

- [ ] N+1 Queries -- Database access is batched or joined
- [ ] Memory Leaks -- Listeners and timers are cleaned up
- [ ] Pagination -- No unbounded queries

## Review Process

Work through the code in three passes:

| Pass   | Focus              | Time    |
|--------|--------------------|---------|
| First  | High-level structure | 2-5 min |
| Second | Line-by-line detail  | Bulk    |
| Third  | Edge cases          | 5 min   |

## Severity Levels

| Level    | Label        | Blocks Merge? |
|----------|--------------|---------------|
| Critical | `[CRITICAL]` | Yes           |
| Major    | `[MAJOR]`    | Yes           |
| Minor    | `[MINOR]`    | No            |
| Nitpick  | `[NIT]`      | No            |

## NEVER Do

1. Never approve without reading every changed line
2. Never block a PR solely for style preferences
3. Never leave feedback without a severity level
```

### Frontmatter Reference

The YAML frontmatter at the top of `SKILL.md` is optional but recommended for discoverability:

```yaml
---
name: my-skill              # Unique identifier (matches directory name)
description: >              # What it does and when to use it
  One to three sentences.
category: development       # Group: development, testing, design, ops, research, etc.
model: reasoning            # Preferred model tier: reasoning, fast, default
version: 1.0                # Semver for tracking changes
---
```

---

## Script-Based Skills

Some skills include executable scripts that agents can run to automate parts of their workflow. Scripts live in a `scripts/` subdirectory and can be written in Python, Node.js, or Bash.

### Directory Layout

```
skills/
└── security-audit/
    ├── SKILL.md
    └── scripts/
        ├── scan_dependencies.py
        ├── check_headers.sh
        └── report.py
```

### Invocation Pattern

Agents execute skill scripts using `uv run` (for Python) or direct execution (for Bash/Node):

```bash
# Python scripts (recommended: use uv for dependency management)
uv run ~/clawd-shared/skills/security-audit/scripts/scan_dependencies.py --target ./src

# Bash scripts
bash ~/clawd-shared/skills/security-audit/scripts/check_headers.sh https://example.com

# Node.js scripts
node ~/clawd-shared/skills/data-transform/scripts/normalize.js input.json
```

### Writing a Script-Based Skill

Reference the scripts in your `SKILL.md` so the agent knows when and how to use them:

```markdown
## Automation

This skill includes scripts for automated checks.

### Dependency Scan

Run the dependency scanner to check for known vulnerabilities:

\```bash
uv run ~/clawd-shared/skills/security-audit/scripts/scan_dependencies.py --target .
\```

The script outputs a JSON report with severity levels for each finding.

### Header Check

Verify HTTP security headers on a live URL:

\```bash
bash ~/clawd-shared/skills/security-audit/scripts/check_headers.sh https://your-site.com
\```
```

### Script Best Practices

- Include a shebang line (`#!/usr/bin/env python3` or `#!/bin/bash`)
- Accept arguments via CLI flags -- do not hardcode paths
- Output structured data (JSON) when possible for the agent to parse
- Print a usage message when called without arguments
- Keep dependencies minimal; use `uv` inline dependencies for Python

---

## Sharing Skills Across Agents

Skills live in a shared directory that all agents can access. The default location is `~/clawd-shared/skills/`.

### How It Works

The shared skills directory is a flat structure. Each subdirectory is one skill:

```
~/clawd-shared/
└── skills/
    ├── code-review/
    ├── brainstorming/
    ├── docker-essentials/
    ├── senior-architect/
    └── ...
```

Any agent can reference a skill by reading its `SKILL.md`:

```
Read ~/clawd-shared/skills/code-review/SKILL.md and follow its methodology.
```

### Making Skills Available to Agents

There are two approaches:

**Approach 1: Central shared directory (recommended)**

All skills live in `~/clawd-shared/skills/`. Agents reference them by path. This is the simplest approach and avoids duplication.

Reference skills from an agent's `AGENTS.md` or `TOOLS.md`:

```markdown
## Available Skills

- Code Review: `~/clawd-shared/skills/code-review/SKILL.md`
- Brainstorming: `~/clawd-shared/skills/brainstorming/SKILL.md`
- Architecture: `~/clawd-shared/skills/senior-architect/SKILL.md`
```

**Approach 2: Symlinks for agent-specific skill sets**

If you want certain agents to have a curated subset of skills, create symlinks in the agent workspace:

```bash
# Create a skills directory in the agent workspace
mkdir -p ~/clawd-coding/skills

# Symlink specific skills
ln -s ~/clawd-shared/skills/code-review ~/clawd-coding/skills/code-review
ln -s ~/clawd-shared/skills/test-driven-development ~/clawd-coding/skills/tdd
```

The agent can then discover its skills by listing its local `skills/` directory.

---

## Creating Your Own Skill

### Step 1: Create the Directory

```bash
mkdir -p ~/clawd-shared/skills/my-new-skill
```

### Step 2: Write the SKILL.md

Create `~/clawd-shared/skills/my-new-skill/SKILL.md` with:

1. Frontmatter (name, description, category)
2. A clear purpose statement
3. Step-by-step methodology
4. Checklists if applicable
5. Examples of good and bad outcomes
6. Constraints and anti-patterns

```bash
cat > ~/clawd-shared/skills/my-new-skill/SKILL.md << 'EOF'
---
name: my-new-skill
description: Short description of what this skill does.
category: development
version: 1.0
---

# My New Skill

## Purpose

What this skill accomplishes and when to use it.

## Methodology

### Step 1: Understand the Context
- Review the current state
- Identify constraints

### Step 2: Execute the Process
- Do the thing
- Verify the result

### Step 3: Validate
- Check against criteria
- Document the outcome

## Checklist

- [ ] First item to verify
- [ ] Second item to verify
- [ ] Third item to verify

## NEVER Do

1. Never skip the validation step
2. Never assume without confirming
EOF
```

### Step 3: Add Scripts (Optional)

If your skill benefits from automation:

```bash
mkdir -p ~/clawd-shared/skills/my-new-skill/scripts

cat > ~/clawd-shared/skills/my-new-skill/scripts/check.py << 'PYEOF'
#!/usr/bin/env python3
"""Quick validation script for my-new-skill."""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print("Usage: check.py <target-path>")
        sys.exit(1)

    target = sys.argv[1]
    results = {"target": target, "status": "ok", "findings": []}

    # ... your logic here ...

    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
PYEOF

chmod +x ~/clawd-shared/skills/my-new-skill/scripts/check.py
```

### Step 4: Test with an Agent

Open any agent session and ask it to use your skill:

```
Read ~/clawd-shared/skills/my-new-skill/SKILL.md and use it to review this project.
```

Or reference it in the agent's configuration files so it loads automatically.

### Step 5: Add Metadata (Optional)

Create `_meta.json` for tooling and discovery:

```json
{
  "name": "my-new-skill",
  "description": "Short description of what this skill does.",
  "category": "development",
  "version": "1.0",
  "author": "your-name",
  "tags": ["review", "quality"]
}
```

---

## Included Skills

ClawHive ships with a starter set of skills. The full library grows over time as the community contributes new capabilities.

### Development

| Skill | Description |
|-------|-------------|
| `code-review` | Systematic code review with security, performance, and correctness checklists |
| `senior-architect` | Software architecture patterns and system design methodology |
| `test-driven-development` | TDD workflow with red-green-refactor discipline |
| `python-patterns` | Python best practices, idioms, and design patterns |
| `typescript-expert` | TypeScript patterns, type safety, and project structure |
| `react-patterns` | React component design, state management, and performance |
| `prisma` | Prisma ORM patterns, schema design, and query optimization |

### Infrastructure & DevOps

| Skill | Description |
|-------|-------------|
| `docker-essentials` | Container best practices, Dockerfile optimization, compose patterns |
| `kubernetes-architect` | Kubernetes deployment patterns, scaling, and cluster management |
| `terraform-specialist` | Infrastructure-as-code with Terraform |
| `deployment-engineer` | CI/CD pipelines, deployment strategies, and rollback planning |
| `database-architect` | Database design, indexing strategies, and query optimization |
| `observability-engineer` | Monitoring, logging, alerting, and tracing setup |

### Security

| Skill | Description |
|-------|-------------|
| `api-security-best-practices` | API security hardening and vulnerability prevention |
| `vulnerability-scanner` | Automated security scanning methodology |
| `sql-injection-testing` | SQL injection detection and prevention testing |

### Creative & Strategy

| Skill | Description |
|-------|-------------|
| `brainstorming` | Structured ideation process that turns ideas into validated designs |
| `copywriting` | Marketing copy, messaging frameworks, and tone guidelines |
| `pricing-strategy` | Pricing model analysis and optimization |
| `market-research` | Competitive analysis and market sizing methodology |

### Productivity

| Skill | Description |
|-------|-------------|
| `doc-coauthoring` | Collaborative document writing with structured review |
| `prompt-engineer` | Prompt design, testing, and optimization techniques |
| `workflow-automation` | Process automation design and implementation |
| `diagram` | Technical diagrams and visual documentation |

---

## Tips for Writing Great Skills

1. **Be prescriptive, not descriptive.** Tell the agent what to do, not what the concept is. "Check every query for parameterized statements" beats "SQL injection is a common vulnerability."

2. **Use checklists.** Agents follow checklists reliably. Break complex processes into checkable items.

3. **Include examples.** Show what good and bad look like. Agents calibrate their output against concrete examples.

4. **Set hard constraints.** Use "NEVER" and "MUST" for non-negotiable rules. Agents respect explicit boundaries.

5. **Keep it focused.** One skill, one job. A skill that tries to cover code review AND architecture AND deployment will be mediocre at all three.

6. **Test iteratively.** Use a skill in a real session, see where the agent struggles, and refine the instructions.
