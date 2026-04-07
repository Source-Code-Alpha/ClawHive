# A Day in the Life of ClawHive

A walk-through of using ClawHive to actually get work done. Not API docs. Not marketing. Just a real day showing how the pieces fit together.

This assumes you've already run `./scripts/setup.sh` and started the command center. If not, see [the README](../README.md) first.

---

## 9:00 AM — Open the dashboard

You sit down with coffee. You open `http://localhost:3096` in your browser. The dashboard shows your 8 agents arranged by category, each with a colored dot in the corner indicating memory freshness.

Two cards have **green dots** (memory updated today). Six have **gray dots** (cold — never been used). The numbers in the header show "0/8 sessions" and your server uptime.

You hit **Ctrl+K**. The command palette opens. You type "today" and select "Today's Activity Digest." A modal pops up showing a 4-stat grid: 0 sessions, 0 agents used, 0 memory updates, 0 topics created. It's a fresh day.

You close the modal.

---

## 9:05 AM — Quick question to your researcher

You have a decision to make about a database. Should you use Postgres or SQLite for a new side project? You don't want a full session — just a quick second opinion.

You **right-click the Oracle (researcher) agent card** → "Quick Chat..." A modal appears asking for your prompt. You type:

> "Side project, ~10k users max, need full-text search and JSON columns, deploying to Railway. Postgres or SQLite — and why?"

You click Send. A loading message appears: "Booting agent and waiting for response... (this can take 30-60 seconds for the first run)."

After about 40 seconds, Oracle responds inline. You read the answer, mentally agree with the conclusion (Postgres for the JSON support), close the modal. **Total time: under a minute.** No full session needed.

The activity feed icon in the header now shows a small badge — Oracle's quick chat was logged.

---

## 9:30 AM — Start a real coding session

Now for the actual work. You click the **Codesmith** card. The dashboard transitions into terminal view, showing breadcrumbs: `Dashboard > Codesmith`.

In the terminal, Claude boots. After a moment, the command center automatically sends:

> "Before we begin: please read CLAUDE.md, IDENTITY.md, SOUL.md, AGENTS.md, USER.md, TOOLS.md, MEMORY.md and the most recent file in memory/ in this directory. Then confirm in one sentence who you are."

Codesmith reads the files and replies: "I'm Codesmith — your VP of Engineering. I ship clean code, prefer convention over configuration, and bias toward action on safe work. I see we've been working on a side project this week. What are we doing today?"

Notice what just happened: **the agent loaded its own identity and remembered your context — without you asking.** This is the difference. You didn't have to say "you're a coding assistant who likes TypeScript and remembers I'm building a dashboard." It already knew.

You reply normally. You spend 45 minutes pair-programming on the new project.

---

## 10:15 AM — Drag a file in

You have a screenshot of a UI bug from a different project. You drag it from your desktop directly onto the terminal. ClawHive uploads it to the agent's `uploads/` folder and tells Codesmith: "Please read this file: /home/you/clawd-coding/uploads/screenshot.png".

Codesmith looks at it (Claude can read images), explains the issue, and proposes a fix. You don't have to fiddle with file paths or paste base64.

---

## 10:45 AM — Switch to design without losing context

The fix involves a layout decision. You want Atelier (the designer agent) to weigh in. You press **Esc** to go back to the dashboard. Codesmith's session stays alive in the background — the **session tab at the bottom shows a green dot** (active recently) and the elapsed timer says "1h".

You click **Atelier**. New session opens, Atelier loads its identity, you ask the design question. Atelier gives you 3 layout variants in text form.

You press **Esc** again, click the **Codesmith tab at the bottom**, and you're back in your coding session — terminal scrollback intact, no re-briefing needed. You tell Codesmith which layout to implement.

Both sessions are now alive simultaneously. Sessions don't compete; they coexist.

---

## 11:30 AM — Run a skill

You realize you should review the code you wrote this morning before merging. You hit **Ctrl+K**, type "skills," select "Browse Skills." The skill catalog opens.

You search for "code-review." Click it — the SKILL.md content appears in the right pane, showing the methodology. There's a **Run** button. You click it.

A modal asks for arguments. You type the path to your changed file. The skill executes in a temporary process, runs the review, and returns structured output: critical issues, suggestions, praise. You read it, fix the one critical issue, move on.

The skill never touched your main session. It's a one-shot tool.

---

## 12:30 PM — Lunch

You don't formally close anything. You walk away.

In the background:
- Codesmith and Atelier sessions are still alive
- No idle timeout will fire — by default it's 30 minutes, but you pinned the Codesmith session earlier with the context menu
- Atelier's session, since you didn't pin it, will be auto-killed at 1:00 PM after 30 minutes idle
- When Atelier dies, the command center will automatically capture the last 80 lines of the conversation and append them to `~/clawd-designer/memory/2026-04-07.md` as a session summary

You don't have to "remember to update memory." It happens.

---

## 1:30 PM — Return

You come back. Atelier's tab is gone (auto-killed). Codesmith is still there with the green dot. You also see a **toast notification** that fired while you were away: "Atelier session ended."

You click Codesmith's tab. You're back where you left off. You finish the work.

---

## 2:00 PM — Inspect what your finance agent knows

You're about to make a vendor decision and want Ledger (finance) involved. But it's been a while since you used Ledger and you want to remind yourself what context it has.

You **double-click the Ledger card**. The detail panel slides in showing: identity, vibe, topics, last activity ("never"), and a 7-day activity sparkline (empty bars).

You click **"Inspect Files"**. The full workspace inspector opens with three tabs: Files, Memory, Topics. You browse the Files tab, click MEMORY.md. It's the empty scaffold from setup. So Ledger has no real history yet.

You click the **Edit** icon, add a paragraph at the top of MEMORY.md explaining your current financial context, save with Ctrl+S. Now when you launch Ledger for the first time, it'll boot with that context already in memory.

You close the inspector and launch Ledger. It boots, reads MEMORY.md (which now has your context), and is immediately useful.

---

## 4:00 PM — Pin your favorites

You realize you've been hunting for the same 3 agents all day. You hover Codesmith's card and click the **star icon** that appears in the corner. It turns gold. Same for Oracle and Ledger.

Now whenever you visit the dashboard, those three pin to the top automatically. You can also filter to "Pinned" via the chip bar.

---

## 5:30 PM — End of day, no goodbyes

You don't formally end your sessions or update memory.

When you close the browser tab, the sessions keep running. When you eventually kill the command center (or it shuts down for the night), every alive session triggers `pty.onExit`, which auto-appends the day's work to that agent's `memory/2026-04-07.md`.

Tomorrow morning when you launch Codesmith again, it boots, reads `memory/2026-04-07.md` as part of "today and yesterday's daily notes," and remembers exactly where you left off.

**You never wrote a memory update. The system did it for you.**

---

## What just happened (the meta view)

You just had a productive day where:

1. Agents loaded their identity automatically — no re-briefing
2. You used Quick Chat for fast questions without spinning up full sessions
3. You ran multiple agents in parallel without losing context
4. You uploaded a file without copying paths
5. You ran a skill as a one-shot tool, separate from your main session
6. You inspected and edited an agent's memory before using it
7. Sessions auto-saved on exit — your day's work became persistent memory automatically
8. Tomorrow's sessions will start with full context already loaded

This is what "agents that actually remember" feels like in practice. The dashboard isn't the product — the **persistent identity loop** is. The dashboard is just the interface that makes it ergonomic.

---

## Things you didn't have to do

- Type "you are a coding assistant" — it knew
- Re-explain your project — it had memory
- Remember to save context at the end of the session — auto-save handled it
- Manually copy file paths into the terminal — drag-and-drop handled it
- Open separate terminals for each agent — tabs handled it
- Track which agent has stale memory — freshness dots showed it

---

## What to try first

If this is your first day with ClawHive, do these in order:

1. **Open the dashboard.** See the 8 agents. Notice the freshness dots are all gray.
2. **Click any agent.** Watch the boot sequence happen automatically. The agent will introduce itself.
3. **Have a real conversation.** Ask it to help with something.
4. **Press Esc, click another agent.** Note that the first session stays alive in the bottom tab bar.
5. **Right-click an agent → Quick Chat.** Try a one-shot question.
6. **Press Ctrl+K.** Type anything. See how everything is searchable.
7. **Press ?** to see the keyboard shortcuts.
8. **End your day** — close the browser. Don't worry about saving.
9. **Tomorrow, launch the same agent.** Watch it load yesterday's auto-saved memory and pick up where you left off.

That's the loop. Once you feel it, you'll understand why "agents that remember" is the entire point.
