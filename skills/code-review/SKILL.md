# Skill: Code Review

Perform a thorough, structured code review.

## Methodology

1. **Understand the context** -- Read the PR description, linked issues, and related files before looking at the diff
2. **Check correctness** -- Does the code do what it claims? Are edge cases handled?
3. **Check security** -- SQL injection, XSS, auth bypasses, secrets in code, OWASP top 10
4. **Check performance** -- N+1 queries, unnecessary re-renders, missing indexes, unbounded loops
5. **Check readability** -- Clear naming, appropriate abstractions, no premature optimization
6. **Check testing** -- Are critical paths tested? Are tests meaningful or just coverage padding?
7. **Check conventions** -- Does it follow existing patterns in the codebase?

## Output Format

```markdown
## Code Review Summary

**Verdict:** APPROVE / REQUEST CHANGES / COMMENT

### Critical Issues (must fix)
- ...

### Suggestions (nice to have)
- ...

### Praise (what's done well)
- ...
```

## Rules

- Be specific -- point to exact lines, not vague "could be better"
- Explain WHY, not just WHAT -- "this allows SQL injection because..." not just "fix this"
- Praise good patterns -- positive reinforcement matters
- Don't nitpick style if a linter handles it
- Focus on logic, security, and maintainability
