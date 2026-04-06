# Skill: Architecture Decision

Help make and document software architecture decisions using a structured framework.

## When to Use

- Choosing between technologies or approaches
- Designing a new system or feature
- Evaluating trade-offs with lasting consequences

## Framework

### 1. Context
What is the problem? What constraints exist (time, team, budget, scale)?

### 2. Options
List 2-4 viable approaches. For each:
- **Description** -- one paragraph
- **Pros** -- bullet list
- **Cons** -- bullet list
- **Effort** -- Low / Medium / High

### 3. Decision
Which option and why. Reference the specific pros that made it win.

### 4. Consequences
What changes? What do we gain? What do we give up? What do we need to watch?

## Output Format

```markdown
# ADR: [Decision Title]

**Status:** Proposed / Accepted / Deprecated
**Date:** YYYY-MM-DD
**Context:** [1-2 sentences]

## Options Considered

### Option A: [Name]
...

### Option B: [Name]
...

## Decision
We chose **Option [X]** because...

## Consequences
- ...
```
