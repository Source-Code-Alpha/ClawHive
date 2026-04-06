# Skills Library

Skills are reusable capability modules that any agent can invoke. Each skill encodes expert methodology into a `SKILL.md` file with optional automation scripts.

## Included Skills

| Skill | Description |
|-------|-------------|
| [code-review](code-review/) | Structured code review methodology with checklist |
| [architecture](architecture/) | Software architecture decision framework |
| [brainstorming](brainstorming/) | Structured ideation with diverge/converge phases |
| [writing](writing/) | Clear, concise technical and business writing |

## Skill Structure

```
skill-name/
├── SKILL.md          # Core methodology (required)
├── README.md         # Human-readable description (optional)
└── scripts/          # Automation scripts (optional)
    └── run.py
```

## Creating Skills

See [docs/skills-guide.md](../docs/skills-guide.md) for the full guide.
