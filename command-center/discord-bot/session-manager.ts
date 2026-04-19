// Spawn `claude -p` directly per Discord message — no PTY, no TUI scraping.
// Each channel keeps a session UUID so subsequent messages resume the conversation.

import { spawn, spawnSync, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { api, type Agent } from "./clawhive-api.js";
import { agentHeader, chunkMessage } from "./formatter.js";

// Shared outbox for agent-initiated uploads — files dropped into
// ~/clawd-shared/discord-outbox/<channelId>/ are sent after a turn completes.
const OUTBOX_ROOT = path.join(os.homedir(), "clawd-shared", "discord-outbox");
// Upload marker agents can print in conversational replies, e.g.
//   Here is the file: [[UPLOAD:C:/path/to/file.png]]
// The bot strips the marker from the visible reply and attaches the file.
const UPLOAD_MARKER_RX = /\[\[UPLOAD:\s*([^\]\n]+?)\s*\]\]/g;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, "sessions.json");
// Bypass claude.cmd (Node 18+ EINVAL on Windows .cmd spawn) — call cli.js directly with node.
const NODE_BIN = "C:\\nvm4w\\nodejs\\node.exe";
const CLAUDE_CLI_JS = "C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\cli.js";
// Timeout after which we kill the claude subprocess. Crypto/research agents can run long
// (deep analysis, multiple tool calls) — 15 minutes is a comfortable ceiling. Override with
// DISCORD_TIMEOUT_MIN env var if you need more headroom.
const RESPONSE_TIMEOUT_MS = (parseInt(process.env.DISCORD_TIMEOUT_MIN || "15") || 15) * 60 * 1000;

// Tone instruction appended to every message — keeps agents conversational
// instead of falling into Claude Code "terminal report" mode.
const TONE_PROMPT = [
  "You are talking to your operator over Discord chat, not in a terminal.",
  "Reply in plain conversational prose like you're texting a colleague.",
  "Keep it natural and concise — one to four short paragraphs unless they ask for more.",
  "Do not echo their question. Do not start with phrases like 'I'll' or 'Let me'.",
  "Do not show terminal output, banners, file paths, or status lines unless they ask.",
  "Stay in character as defined in your CLAUDE.md / IDENTITY.md / SOUL.md.",
  "",
  "DELEGATION: You can ask other agents questions by running:",
  "  bash ~/clawd-shared/scripts/ask-agent.sh <agent_id> \"<question>\"",
  "Available agents: soha_coding (engineering), plant_ops (manufacturing), chimi_ops (sales/marketing),",
  "atlas (research), soha_rd (R&D), soha_finance (finance), the_doctor (system health),",
  "crypto_trader (crypto), idea_forge (product strategy), aurelia (design), reco (restructuring), personal (Director).",
  "Use delegation when you need facts from another agent's domain. The target agent answers from its own memory and identity.",
  "",
  "FILE UPLOADS: to send a file from this machine to Discord, print a marker on its own line:",
  "  [[UPLOAD:/absolute/path/to/file.ext]]",
  "The bridge strips the marker from the reply and attaches the file (max 25MB). Use absolute paths.",
  "Never upload .env, credentials, or private keys unless explicitly asked. See skill: discord-upload.",
].join(" ");

// === MEMORY LAYERS (1000X stack) ===

const MEMPALACE_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", FORCE_COLOR: "0" };
const MEMPALACE_TIMEOUT = 12000; // 12s max for any mempalace call

function getPalacePath(agentId: string): string {
  return path.join(os.homedir(), ".mempalace", agentId);
}

function hasPalace(agentId: string): boolean {
  return fs.existsSync(path.join(getPalacePath(agentId), "chroma.sqlite3"));
}

// Layer 1: Proactive memory injection — search mempalace for the user's message BEFORE spawning claude
function searchMemory(agentId: string, query: string): string {
  if (!hasPalace(agentId)) return "";
  try {
    const result = spawnSync("python", [
      "-m", "mempalace", "--palace", getPalacePath(agentId),
      "search", query.slice(0, 200), "--wing", agentId,
    ], { env: MEMPALACE_ENV, timeout: MEMPALACE_TIMEOUT, encoding: "utf-8", windowsHide: true });
    const text = (result.stdout || "").trim();
    // Strip the header/footer, keep only result blocks
    const lines = text.split("\n").filter(l =>
      !l.startsWith("===") && !l.startsWith("---") && l.trim().length > 0
    );
    const cleaned = lines.join("\n").trim();
    if (cleaned.length < 30) return "";
    return cleaned.slice(0, 2500);
  } catch {
    return "";
  }
}

// Layer 6: Real-time system awareness — lightweight snapshot of system health
async function getSystemSnapshot(agentId: string): Promise<string> {
  const parts: string[] = [];

  // ClawHive command center health
  try {
    const health = await api.health();
    parts.push(`ClawHive: up ${Math.floor(health.uptime / 60)}min, ${health.activeSessions} sessions, ${health.agentCount} agents`);
  } catch {}

  // Docker container count (quick check)
  try {
    const r = spawnSync("docker", ["ps", "--format", "{{.Names}}: {{.Status}}"], {
      timeout: 5000, encoding: "utf-8", windowsHide: true,
    });
    const lines = (r.stdout || "").trim().split("\n").filter(l => l.trim());
    if (lines.length > 0) {
      const healthy = lines.filter(l => l.includes("Up")).length;
      const unhealthy = lines.length - healthy;
      let summary = `Docker: ${lines.length} containers (${healthy} up`;
      if (unhealthy > 0) summary += `, ${unhealthy} DOWN`;
      summary += ")";
      if (unhealthy > 0) {
        const down = lines.filter(l => !l.includes("Up")).map(l => l.split(":")[0]).join(", ");
        summary += ` -- DOWN: ${down}`;
      }
      parts.push(summary);
    }
  } catch {}

  // Disk usage (Windows)
  try {
    const r = spawnSync("powershell", ["-Command",
      "[math]::Round((Get-PSDrive C).Free/1GB,1).ToString() + 'GB free of ' + [math]::Round(((Get-PSDrive C).Used + (Get-PSDrive C).Free)/1GB,0).ToString() + 'GB'",
    ], { timeout: 5000, encoding: "utf-8", windowsHide: true });
    const disk = (r.stdout || "").trim();
    if (disk) parts.push(`Disk C: ${disk}`);
  } catch {}

  if (parts.length === 0) return "";
  return "## System status (live):\n" + parts.join("\n");
}

// Layer 2: Warm-start briefing — wake-up + CURRENT_TASK.md + recent git log (first message only)
function generateBriefing(agentId: string, workspace: string): string {
  const parts: string[] = [];

  // MemPalace wake-up (critical facts digest)
  if (hasPalace(agentId)) {
    try {
      const result = spawnSync("python", [
        "-m", "mempalace", "--palace", getPalacePath(agentId),
        "wake-up", "--wing", agentId,
      ], { env: MEMPALACE_ENV, timeout: MEMPALACE_TIMEOUT, encoding: "utf-8", windowsHide: true });
      const wakeup = (result.stdout || "").trim();
      if (wakeup.length > 50) parts.push("## What you know (from memory):\n" + wakeup.slice(0, 1500));
    } catch {}
  }

  // CURRENT_TASK.md — where you left off
  try {
    const taskFile = path.join(workspace, "CURRENT_TASK.md");
    if (fs.existsSync(taskFile)) {
      const task = fs.readFileSync(taskFile, "utf-8").trim().slice(0, 800);
      if (task.length > 20) parts.push("## Where you left off (CURRENT_TASK.md):\n" + task);
    }
  } catch {}

  // Recent git commits
  try {
    const result = spawnSync("git", ["log", "--oneline", "-5"], {
      cwd: workspace, timeout: 5000, encoding: "utf-8", windowsHide: true,
    });
    const log = (result.stdout || "").trim();
    if (log.length > 10) parts.push("## Recent git activity:\n" + log);
  } catch {}

  return parts.join("\n\n");
}

// Layer 3 + 7: Post-turn auto-index — mine the Q&A pair into MemPalace
function autoIndexTurn(agentId: string, userMessage: string, agentResponse: string): void {
  if (!hasPalace(agentId)) return;
  if (agentResponse.length < 50) return; // skip trivial responses

  try {
    const turnDir = path.join(os.tmpdir(), `mempalace-turn-${agentId}-${Date.now()}`);
    fs.mkdirSync(turnDir, { recursive: true });
    const turnFile = path.join(turnDir, `turn-${new Date().toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(turnFile, `## ${new Date().toISOString()}\n\n**User:** ${userMessage}\n\n**Agent:** ${agentResponse.slice(0, 3000)}\n`);

    spawnSync("python", [
      "-m", "mempalace", "--palace", getPalacePath(agentId),
      "mine", turnDir, "--mode", "convos", "--extract", "general", "--wing", agentId,
    ], { env: MEMPALACE_ENV, timeout: 30000, encoding: "utf-8", windowsHide: true });

    // Cleanup temp
    try { fs.unlinkSync(turnFile); fs.rmdirSync(turnDir); } catch {}
  } catch (err: any) {
    console.error("[auto-index]", err.message);
  }
}

interface ChannelState {
  channelId: string;
  agentId: string;
  workspace: string;
  sessionUuid: string | null;  // claude session ID for --resume
  isRunning: boolean;          // prevent concurrent claude invocations per channel
  agentCache: Agent | null;
  currentChild: ChildProcess | null;  // live claude subprocess (for /stop)
  pendingUploads: string[];           // file paths to send after this turn
  stoppedByUser: boolean;             // true if /stop (or 🛑 reaction) killed the current turn
}

type OutputCallback = (channelId: string, content: string) => Promise<void>;
type TypingCallback = (channelId: string) => Promise<void>;
type UploadCallback = (channelId: string, filePaths: string[]) => Promise<void>;

export class SessionManager {
  private channels = new Map<string, ChannelState>();
  private outputCallback: OutputCallback;
  private typingCallback: TypingCallback;
  private uploadCallback: UploadCallback;
  private savedSessions: Record<string, string> = {};

  constructor(out: OutputCallback, typing: TypingCallback, upload?: UploadCallback) {
    this.outputCallback = out;
    this.typingCallback = typing;
    this.uploadCallback = upload || (async () => {});
    this.loadSessionsFile();
  }

  private loadSessionsFile() {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        this.savedSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      }
    } catch (err: any) {
      console.error("[sessions] load failed:", err.message);
      this.savedSessions = {};
    }
  }

  private persistSessions() {
    try {
      const data: Record<string, string> = {};
      for (const [channelId, state] of this.channels) {
        if (state.sessionUuid) data[channelId] = state.sessionUuid;
      }
      // Merge with previously loaded ones for channels we haven't bound yet
      const merged = { ...this.savedSessions, ...data };
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(merged, null, 2));
      this.savedSessions = merged;
    } catch (err: any) {
      console.error("[sessions] save failed:", err.message);
    }
  }

  bindChannel(channelId: string, agentId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) {
      state = {
        channelId,
        agentId,
        workspace: path.join(os.homedir(), `clawd-${agentId}`),
        sessionUuid: this.savedSessions[channelId] || null,
        isRunning: false,
        agentCache: null,
        currentChild: null,
        pendingUploads: [],
        stoppedByUser: false,
      };
      this.channels.set(channelId, state);
    } else {
      state.agentId = agentId;
      state.workspace = path.join(os.homedir(), `clawd-${agentId}`);
    }
    return state;
  }

  getState(channelId: string): ChannelState | undefined {
    return this.channels.get(channelId);
  }

  async getAgentInfo(channelId: string): Promise<Agent | null> {
    const state = this.channels.get(channelId);
    if (!state) return null;
    if (state.agentCache && state.agentCache.id === state.agentId) return state.agentCache;
    try {
      const agents = await api.listAgents();
      const found = agents.find(a => a.id === state.agentId) || null;
      if (found) state.agentCache = found;
      return found;
    } catch {
      return null;
    }
  }

  async sendMessage(channelId: string, text: string): Promise<boolean> {
    const state = this.channels.get(channelId);
    if (!state) return false;
    if (state.isRunning) {
      await this.outputCallback(channelId, "_(I'm still working on your previous message — please wait.)_");
      return false;
    }
    if (!fs.existsSync(state.workspace)) {
      await this.outputCallback(channelId, `_Error: agent workspace not found at \`${state.workspace}\`_`);
      return false;
    }

    state.isRunning = true;

    // Discord typing indicator (lasts ~10s, so refresh every 8s)
    let typingActive = true;
    const refreshTyping = async () => {
      while (typingActive) {
        await this.typingCallback(channelId).catch(() => {});
        await new Promise(r => setTimeout(r, 8000));
      }
    };
    refreshTyping();

    // === LAYER 1: Proactive memory injection ===
    const memoryContext = searchMemory(state.agentId, text);
    if (memoryContext) {
      console.log(`[memory] [${state.agentId}] found ${memoryContext.length} chars of relevant context`);
    }

    // === LAYER 2 + 6: Warm-start briefing + system awareness (first message only) ===
    let briefing = "";
    if (!state.sessionUuid) {
      briefing = generateBriefing(state.agentId, state.workspace);
      // Layer 6: append live system snapshot
      try {
        const snapshot = await getSystemSnapshot(state.agentId);
        if (snapshot) briefing += (briefing ? "\n\n" : "") + snapshot;
      } catch {}
      if (briefing) {
        console.log(`[briefing] [${state.agentId}] generated ${briefing.length} chars (incl. system snapshot)`);
      }
    }

    // Build the full system prompt: tone + memory + briefing
    const systemParts = [TONE_PROMPT];
    if (memoryContext) systemParts.push("\n\n## Relevant memories from past sessions:\n" + memoryContext);
    if (briefing) systemParts.push("\n\n" + briefing);
    const fullSystemPrompt = systemParts.join("");

    // Streaming state for this turn
    let textBuf = "";                                     // accumulated text since last flush
    let headerSent = false;                               // header goes on first chunk only
    let totalCharsEmitted = 0;                            // for the trailing log line
    let responseAccumulator = "";                         // full response text for Layer 3+7 indexing
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_DEBOUNCE_MS = 1800;                       // wait this long after last delta before sending
    const MAX_BUF_BYTES = 1700;                           // force-flush if buffer exceeds this

    const flush = async (finalDrain = false) => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!textBuf.trim()) return;

      // Hold back a trailing partial `[[UPLOAD…` so we don't split a marker across
      // flushes. On the final drain (after claude exits) we flush everything.
      let out = textBuf;
      const openIdx = out.lastIndexOf("[[");
      const closeIdx = out.lastIndexOf("]]");
      if (!finalDrain && openIdx !== -1 && openIdx > closeIdx) {
        textBuf = out.slice(openIdx);
        out = out.slice(0, openIdx);
      } else {
        textBuf = "";
      }

      // Extract and strip upload markers
      let m: RegExpExecArray | null;
      const rx = new RegExp(UPLOAD_MARKER_RX.source, "g");
      while ((m = rx.exec(out)) !== null) {
        const p = m[1].trim();
        if (p) state.pendingUploads.push(p);
      }
      const cleaned = out.replace(UPLOAD_MARKER_RX, "").replace(/\n{3,}/g, "\n\n");
      if (!cleaned.trim()) return;

      totalCharsEmitted += cleaned.length;

      const agent = await this.getAgentInfo(channelId);
      const header = agent && !headerSent ? agentHeader(agent.emoji, agent.name) : "";
      headerSent = true;

      const pieces = chunkMessage(cleaned);
      for (let i = 0; i < pieces.length; i++) {
        const message = (i === 0 ? header : "") + pieces[i];
        try {
          await this.outputCallback(channelId, message);
        } catch (err: any) {
          console.error("[output]", err.message);
        }
      }
    };

    const scheduleFlush = () => {
      if (textBuf.length >= MAX_BUF_BYTES) {
        // Force-flush on overflow — don't wait for the debounce
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        flush();
        return;
      }
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { flush(); }, FLUSH_DEBOUNCE_MS);
    };

    try {
      const args = [
        CLAUDE_CLI_JS,
        "-p", text,
        "--model", "claude-opus-4-7",
        "--dangerously-skip-permissions",
        "--append-system-prompt", fullSystemPrompt,
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
      ];
      if (state.sessionUuid) {
        args.push("--resume", state.sessionUuid);
      } else {
        const newUuid = randomUUID();
        args.push("--session-id", newUuid);
        state.sessionUuid = newUuid;
        this.persistSessions();
      }

      console.log(`[claude] [${state.agentId}] -> ${text.slice(0, 80)}`);

      const child = spawn(NODE_BIN, args, {
        cwd: state.workspace,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
        windowsHide: true,
      });
      state.currentChild = child;

      let lineBuf = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        this.killChild(child);
      }, RESPONSE_TIMEOUT_MS);

      // Track recent tool name so we can collapse runs of identical tools (e.g. Read, Read, Read)
      let lastToolName: string | null = null;
      // With --include-partial-messages, Claude CLI emits BOTH token-level stream deltas
      // AND the final full assistant message. If we process both, every response is doubled.
      // Track whether we saw any streaming text; if so, skip the final assistant text blocks.
      let sawStreamDelta = false;

      const handleEvent = async (event: any) => {
        if (!event || typeof event !== "object") return;

        // Token-level deltas (from --include-partial-messages)
        if (event.type === "stream_event" && event.event) {
          const inner = event.event;
          if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
            const t = inner.delta.text;
            if (typeof t === "string" && t.length > 0) {
              sawStreamDelta = true;
              textBuf += t;
              responseAccumulator += t;    // Layer 3+7: accumulate full response
              scheduleFlush();
            }
            return;
          }
          if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
            // Flush any accumulated text BEFORE the tool status, so order is preserved
            await flush();
            const toolName = inner.content_block.name || "tool";
            if (toolName !== lastToolName) {
              lastToolName = toolName;
              try {
                await this.outputCallback(channelId, `_🔧 ${toolName}_`);
              } catch (err: any) {
                console.error("[tool-status]", err.message);
              }
            }
            return;
          }
          // Reset lastToolName when a non-tool block starts (e.g. text)
          if (inner.type === "content_block_start" && inner.content_block?.type === "text") {
            lastToolName = null;
            return;
          }
          return;
        }

        // Non-streaming assistant messages (full content blocks at once).
        // Only process text blocks here as a FALLBACK when no streaming deltas arrived.
        // Otherwise every response would be duplicated (streamed once, then final once).
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block?.type === "text" && typeof block.text === "string") {
              if (!sawStreamDelta) {
                textBuf += block.text;
                responseAccumulator += block.text;  // Layer 3+7
                scheduleFlush();
              }
            } else if (block?.type === "tool_use") {
              await flush();
              const toolName = block.name || "tool";
              if (toolName !== lastToolName) {
                lastToolName = toolName;
                try {
                  await this.outputCallback(channelId, `_🔧 ${toolName}_`);
                } catch (err: any) {
                  console.error("[tool-status]", err.message);
                }
              }
            }
          }
          return;
        }

        // Final result event — flush remaining
        if (event.type === "result") {
          await flush();
          return;
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        lineBuf += chunk.toString();
        let nl: number;
        while ((nl = lineBuf.indexOf("\n")) >= 0) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            handleEvent(event).catch(err => console.error("[event]", err.message));
          } catch {
            // Not JSON — ignore (could be a stray log line)
          }
        }
      });

      child.stderr.on("data", chunk => { stderr += chunk.toString(); });

      const exitCode: number | null = await new Promise(resolve => {
        child.on("close", code => resolve(code));
        child.on("error", err => {
          console.error("[claude] spawn error:", err.message);
          resolve(-1);
        });
      });

      clearTimeout(timer);
      typingActive = false;
      state.currentChild = null;

      // Final flush (finalDrain=true so any held-back partial-marker tail flushes too)
      await flush(true);

      // Drain the shared outbox dir for this channel — files an agent dropped
      // via tool calls instead of a marker (for >25MB or binary pipeline use).
      const outboxDir = path.join(OUTBOX_ROOT, channelId);
      try {
        if (fs.existsSync(outboxDir)) {
          for (const name of fs.readdirSync(outboxDir)) {
            const full = path.join(outboxDir, name);
            try { if (fs.statSync(full).isFile()) state.pendingUploads.push(full); } catch {}
          }
        }
      } catch {}

      // Flush any queued uploads to Discord via the upload callback
      if (state.pendingUploads.length > 0) {
        const toSend = state.pendingUploads.slice();
        state.pendingUploads = [];
        try {
          await this.uploadCallback(channelId, toSend);
        } catch (err: any) {
          console.error("[uploads]", err.message);
        }
        // Delete drained outbox files so they don't re-send next turn
        for (const p of toSend) {
          if (p.startsWith(outboxDir)) {
            try { fs.unlinkSync(p); } catch {}
          }
        }
      }

      if (timedOut) {
        const minutes = Math.round(RESPONSE_TIMEOUT_MS / 60000);
        await this.outputCallback(channelId, `_Timed out after ${minutes} minutes — killed the agent process. Try again, ask a shorter follow-up, or set \`DISCORD_TIMEOUT_MIN\` higher in .env._`);
        return false;
      }

      if (state.stoppedByUser) {
        state.stoppedByUser = false;
        await this.outputCallback(channelId, "_🛑 Stopped — agent killed mid-task. Next message starts a fresh turn (same session)._");
        return false;
      }

      if (exitCode !== 0) {
        console.error("[claude] exit", exitCode, "stderr:", stderr.slice(0, 500));
        if (stderr.toLowerCase().includes("session") && state.sessionUuid) {
          state.sessionUuid = null;
          this.persistSessions();
          await this.outputCallback(channelId, "_Session lost — starting fresh on your next message._");
        } else {
          const detail = stderr.trim().slice(0, 800);
          await this.outputCallback(channelId, `_Claude exited with code ${exitCode}._${detail ? "\n```\n" + detail + "\n```" : ""}`);
        }
        return false;
      }

      if (totalCharsEmitted === 0) {
        await this.outputCallback(channelId, "_(empty response)_");
      }

      console.log(`[claude] [${state.agentId}] <- ${totalCharsEmitted} chars (streamed)`);

      // === LAYER 3 + 7: Auto-index this turn into MemPalace (fire-and-forget) ===
      if (responseAccumulator.length > 50) {
        setTimeout(() => {
          autoIndexTurn(state.agentId, text, responseAccumulator);
          console.log(`[auto-index] [${state.agentId}] indexed ${responseAccumulator.length} chars`);
        }, 100); // non-blocking — don't slow down the Discord response
      }
      return true;
    } catch (err: any) {
      typingActive = false;
      console.error("[sendMessage]", err);
      await this.outputCallback(channelId, `_Error: ${err.message}_`);
      return false;
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      typingActive = false;
      state.isRunning = false;
      state.currentChild = null;
    }
  }

  // Hard-kill a subprocess and its children. On Windows, child.kill() doesn't
  // terminate the grandchild tree (claude cli spawns node for tools), so use taskkill.
  private killChild(child: ChildProcess): void {
    if (!child || child.killed) return;
    try {
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      } else {
        child.kill("SIGTERM");
        setTimeout(() => { try { if (!child.killed) child.kill("SIGKILL"); } catch {} }, 2000);
      }
    } catch (err: any) {
      console.error("[kill]", err.message);
    }
  }

  // Stop the currently-running turn in a single channel. Returns true if something was killed.
  stopMessage(channelId: string): boolean {
    const state = this.channels.get(channelId);
    if (!state || !state.currentChild) return false;
    state.stoppedByUser = true;
    this.killChild(state.currentChild);
    console.log(`[stop] [${state.agentId}] killed by user in ${channelId}`);
    return true;
  }

  // Stop every in-flight turn across the whole fleet. Returns how many were killed.
  stopAll(): { channelId: string; agentId: string }[] {
    const killed: { channelId: string; agentId: string }[] = [];
    for (const [cid, state] of this.channels) {
      if (state.currentChild) {
        state.stoppedByUser = true;
        this.killChild(state.currentChild);
        killed.push({ channelId: cid, agentId: state.agentId });
      }
    }
    if (killed.length) console.log(`[stop-all] killed ${killed.length} in-flight turns`);
    return killed;
  }

  // Is a turn currently running in this channel?
  isRunning(channelId: string): boolean {
    return !!this.channels.get(channelId)?.currentChild;
  }

  async endSession(channelId: string): Promise<void> {
    const state = this.channels.get(channelId);
    if (!state) return;
    state.sessionUuid = null;
    this.persistSessions();
  }

  async shutdown(): Promise<void> {
    this.persistSessions();
  }
}
