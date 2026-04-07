# Topic: example-project

*This is a demo topic showing how topic isolation works. Delete this and create your own real topics.*

## What this topic is

A topic is a project-scoped working memory inside an agent's workspace. Use one topic per project, feature, or long-running task. The agent loads `TOPIC.md` for context and `MEMORY.md` for session history.

## How to use it

1. From the command center, click an agent → topic chip → launches with this context
2. From the terminal: `cd ~/clawd-coding && claude` then mention "load topic example-project"
3. The agent reads this file and the topic's `MEMORY.md` automatically (if force boot is on)

## Example structure

When you create your own topic, fill `TOPIC.md` with things like:

- **Project name and one-line description**
- **Repo URL or location**
- **Tech stack and key decisions**
- **Active goals / current sprint**
- **Constraints / non-goals**
- **Stakeholders / contacts**
- **Useful links** (docs, dashboards, design files)

The richer the TOPIC.md, the less you have to re-brief the agent each session.
