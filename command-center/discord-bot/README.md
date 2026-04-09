# ClawHive Discord Bot

A standalone Discord bridge for ClawHive. **One Discord channel per agent** — chat with any agent from your phone, upload files, get a daily digest, all through Discord.

Unlike polling-based bots, this uses Claude Code's `--print` mode directly. No PTY scraping, no terminal noise — just clean conversational replies.

## What it does

- **One channel per agent** — channel name matches agent ID (with `_` → `-`). Drop a message in `#engineering`, the bot routes it to the `engineering` agent.
- **Persistent sessions** — every channel gets its own Claude session UUID, persisted to `sessions.json`. Conversations resume across bot restarts.
- **Conversational tone** — every message is sent with a system prompt that tells the agent to reply like it's texting a colleague, not printing terminal output.
- **Always Opus** — bot spawns Claude with `--model opus` regardless of dashboard defaults.
- **File uploads** — drop a file in an agent channel, the bot uploads it to that agent's workspace `uploads/` folder and tells the agent to read it.
- **Daily digest** — auto-posts a summary to `#daily` every morning at the configured hour.
- **Slash commands** — `/setup`, `/agents`, `/quick`, `/status`, `/end`, `/digest`, `/health`.
- **Whitelist auth** — only your Discord user ID can talk to the bot. Anyone else in your server gets a "private bot" reply.

## Architecture

```
You ──▶ Discord gateway (WS) ──▶ Bot ──spawn──▶ claude -p (subprocess)
                                  │                    │
                                  │                    ▼
                                  │            Clean stdout (markdown)
                                  ◀────────── send to channel
```

The bot does **not** use ClawHive's PTY WebSocket for chat. For each Discord message, it spawns a fresh `claude -p` subprocess in the agent's workspace, captures stdout, and posts the result to Discord. Session continuity is via `--session-id <uuid>` (first message) and `--resume <uuid>` (subsequent messages).

It's a separate Node process from the command center:

- The bot can crash without taking down the dashboard
- The bot can run on a different machine
- You can disable Discord entirely without affecting anything else
- It uses ClawHive's `/api/agents` endpoint for agent metadata + `/api/digest/today` for the digest, but plain chat bypasses ClawHive entirely

Discord uses a persistent gateway WebSocket. There is no "polling slot" to fight over — two clients with the same token won't conflict like Telegram bots do.

## Setup (one time)

### 1. Create a Discord bot

1. Go to https://discord.com/developers/applications
2. New Application → name it
3. **Bot** tab → Reset Token → copy the token
4. Privileged Gateway Intents → enable **MESSAGE CONTENT INTENT**
5. **OAuth2** → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `View Channels`, `Send Messages`, `Read Message History`, `Use Slash Commands`, `Attach Files`, `Embed Links`, `Manage Channels`
6. Open the generated URL → invite the bot to your server

### 2. Get your IDs

- Discord settings → Advanced → enable **Developer Mode**
- Right-click your name → Copy User ID
- Right-click your server name → Copy Server ID
- Discord developer portal → your application → copy Application ID (this is the Client ID)

### 3. Configure

```bash
cd command-center/discord-bot
cp .env.example .env
# Edit .env and fill in:
#   DISCORD_BOT_TOKEN=...
#   DISCORD_CLIENT_ID=...      (the application/client ID)
#   DISCORD_GUILD_ID=...       (your server ID)
#   DISCORD_USER_ID=...        (your user ID)
#   CLAWHIVE_URL=http://localhost:3096
```

### 4. Install + run

```bash
npm install
npm start
```

The bot will log in, register slash commands for your guild, and bind any existing channels whose names match agent IDs.

### 5. Auto-create agent channels

In any channel in your Discord server, run `/setup`. The bot creates one text channel per ClawHive agent, plus a `#daily` channel for the digest.

## Commands

| Command | What it does |
|---|---|
| `/setup` | Auto-create a text channel for each agent (one-time) |
| `/agents` | List all agents grouped by category |
| `/quick agent:<id> prompt:<text>` | One-shot question via the ClawHive Quick Chat API |
| `/status` | Show session info for the current channel |
| `/end` | End the session in the current channel (resets the UUID) |
| `/digest` | Show today's activity digest |
| `/health` | ClawHive command center health check |

Plain messages in an agent channel are sent through `claude -p` for that agent. The bot adds an ⏳ reaction immediately, switches to ✅ when done or ❌ on error, and shows a "typing…" indicator while Claude thinks.

## How sessions persist

Every channel maps to one Claude session UUID. The first message in a channel generates a fresh UUID and runs `claude -p --session-id <uuid> ...`. Every subsequent message uses `--resume <uuid>`. The UUID is saved to `discord-bot/sessions.json` so conversations survive bot restarts. Run `/end` in a channel to forget the UUID and start fresh on the next message.

## Tone control

Every message is sent with this `--append-system-prompt`:

> *"You are talking to your operator over Discord chat, not in a terminal. Reply in plain conversational prose like you're texting a colleague. Keep it natural and concise — one to four short paragraphs unless they ask for more. Do not echo their question. Do not start with phrases like 'I'll' or 'Let me'. Do not show terminal output, banners, file paths, or status lines unless they ask. Stay in character as defined in your CLAUDE.md / IDENTITY.md / SOUL.md."*

The agent's `CLAUDE.md` / `SOUL.md` still drives personality — this just biases the *form* toward chat instead of terminal report.

## MemPalace Integration

If you've set up [MemPalace](https://github.com/milla-jovovich/mempalace) for an agent (via `scripts/mempalace-onboard-agent.sh`), the Discord bot automatically benefits — because `claude -p` loads MCP tools from the agent's workspace, including MemPalace's 19 memory tools. No changes to the bot are needed.

What this means in practice:
- **Ask about past context:** "What did we decide about pricing last month?" — the agent calls `mempalace_search` and finds the answer across old sessions
- **Cross-session continuity:** even if the Discord session UUID is reset, MemPalace remembers everything from past conversations
- **Wake-up grounding:** agents can call `mempalace wake-up` to load ~800 tokens of critical facts at the start of a conversation

The memory search happens transparently — the agent decides when to call MemPalace tools based on whether your question needs historical context. You don't need to do anything special.

---

## Troubleshooting

**Bot does not log in**
- Check your token in `.env`
- Make sure you enabled MESSAGE CONTENT INTENT in the Bot tab
- Watch the console — discord.js logs login errors clearly

**`spawn EINVAL` errors on Windows**
- This happens when spawning `.cmd` files with Node 18+. The bot bypasses this by calling `node.exe cli.js` directly instead of `claude.cmd`. If you see EINVAL anyway, your Claude Code install path may differ — adjust `NODE_BIN` and `CLAUDE_CLI_JS` in `session-manager.ts`.

**`/setup` fails with "Missing Permissions"**
- Re-invite the bot with the **Manage Channels** permission

**Slash commands don't appear**
- Wait a few seconds after the bot logs in (guild commands are usually instant but can take up to a minute)
- Make sure `DISCORD_GUILD_ID` matches the server you invited the bot to

**First response is slow (15-30 seconds)**
- Expected. Each message spawns a fresh `claude -p` subprocess which has to boot Opus. The bot shows a typing indicator the whole time.
- Subsequent messages in the same channel are no faster — every turn is a fresh subprocess. The trade-off is clean output and zero TUI parsing.

**Plain messages don't reach the agent**
- Check the agent's workspace exists at `~/clawd-{agent_id}/`
- Run `/status` in the channel — if "Channel is not bound to an agent", the channel name doesn't match any ClawHive agent ID

**Bot says "I'm still working on your previous message"**
- Each channel processes one message at a time. Wait for the previous turn to finish.

**Five-minute timeout**
- If `claude -p` runs for 5 minutes without exiting, the bot kills the subprocess and posts an error. Try a shorter prompt or break the request into pieces.

## Security notes

- Treat the bot token like a password. Rotate via Discord developer portal anytime.
- The `DISCORD_USER_ID` whitelist prevents anyone else in your server from talking to the bot.
- File uploads land in the agent's `workspace/uploads/` directory. Don't upload anything you wouldn't paste into a Claude session.
- The bot does not encrypt messages end-to-end. Discord sees everything.
- `discord-bot/sessions.json` contains channel-to-session-UUID mappings. It's gitignored. If you delete it, all channels start fresh on next message.
