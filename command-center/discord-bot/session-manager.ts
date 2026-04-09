// Spawn `claude -p` directly per Discord message — no PTY, no TUI scraping.
// Each channel keeps a session UUID so subsequent messages resume the conversation.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { api, type Agent } from "./clawhive-api.js";
import { agentHeader, chunkMessage } from "./formatter.js";

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
].join(" ");

interface ChannelState {
  channelId: string;
  agentId: string;
  workspace: string;
  sessionUuid: string | null;  // claude session ID for --resume
  isRunning: boolean;          // prevent concurrent claude invocations per channel
  agentCache: Agent | null;
}

type OutputCallback = (channelId: string, content: string) => Promise<void>;
type TypingCallback = (channelId: string) => Promise<void>;

export class SessionManager {
  private channels = new Map<string, ChannelState>();
  private outputCallback: OutputCallback;
  private typingCallback: TypingCallback;
  private savedSessions: Record<string, string> = {};

  constructor(out: OutputCallback, typing: TypingCallback) {
    this.outputCallback = out;
    this.typingCallback = typing;
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

    // Streaming state for this turn
    let textBuf = "";                                     // accumulated text since last flush
    let headerSent = false;                               // header goes on first chunk only
    let totalCharsEmitted = 0;                            // for the trailing log line
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_DEBOUNCE_MS = 1800;                       // wait this long after last delta before sending
    const MAX_BUF_BYTES = 1700;                           // force-flush if buffer exceeds this

    const flush = async () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!textBuf.trim()) return;

      const out = textBuf;
      textBuf = "";
      totalCharsEmitted += out.length;

      const agent = await this.getAgentInfo(channelId);
      const header = agent && !headerSent ? agentHeader(agent.emoji, agent.name) : "";
      headerSent = true;

      const pieces = chunkMessage(out);
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
        "--model", "opus",
        "--dangerously-skip-permissions",
        "--append-system-prompt", TONE_PROMPT,
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

      let lineBuf = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch {}
      }, RESPONSE_TIMEOUT_MS);

      // Track recent tool name so we can collapse runs of identical tools (e.g. Read, Read, Read)
      let lastToolName: string | null = null;

      const handleEvent = async (event: any) => {
        if (!event || typeof event !== "object") return;

        // Token-level deltas (from --include-partial-messages)
        if (event.type === "stream_event" && event.event) {
          const inner = event.event;
          if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
            const t = inner.delta.text;
            if (typeof t === "string" && t.length > 0) {
              textBuf += t;
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

        // Non-streaming assistant messages (full content blocks at once)
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block?.type === "text" && typeof block.text === "string") {
              textBuf += block.text;
              scheduleFlush();
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

      // Final flush in case the stream ended without an explicit result event
      await flush();

      if (timedOut) {
        const minutes = Math.round(RESPONSE_TIMEOUT_MS / 60000);
        await this.outputCallback(channelId, `_Timed out after ${minutes} minutes — killed the agent process. Try again, ask a shorter follow-up, or set \`DISCORD_TIMEOUT_MIN\` higher in .env._`);
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
    }
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
