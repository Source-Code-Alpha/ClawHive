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
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000; // kill the child after 5 minutes

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

    try {
      const args = [
        CLAUDE_CLI_JS,
        "-p", text,
        "--model", "opus",
        "--dangerously-skip-permissions",
        "--append-system-prompt", TONE_PROMPT,
        "--output-format", "text",
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

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch {}
      }, RESPONSE_TIMEOUT_MS);

      child.stdout.on("data", chunk => { stdout += chunk.toString(); });
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

      if (timedOut) {
        await this.outputCallback(channelId, "_Timed out after 5 minutes — killed the agent process. Try again or use a shorter prompt._");
        return false;
      }

      if (exitCode !== 0) {
        console.error("[claude] exit", exitCode, "stderr:", stderr.slice(0, 500));
        // If the resume failed (e.g., session UUID lost), drop it and tell the user
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

      const cleaned = stdout.trim();
      if (!cleaned) {
        await this.outputCallback(channelId, "_(empty response)_");
        return true;
      }

      console.log(`[claude] [${state.agentId}] <- ${cleaned.length} chars`);

      const agent = await this.getAgentInfo(channelId);
      const header = agent ? agentHeader(agent.emoji, agent.name) : "";
      const chunks = chunkMessage(cleaned);
      for (let i = 0; i < chunks.length; i++) {
        const message = (i === 0 ? header : "") + chunks[i];
        try {
          await this.outputCallback(channelId, message);
        } catch (err: any) {
          console.error("[output]", err.message);
        }
      }
      return true;
    } catch (err: any) {
      typingActive = false;
      console.error("[sendMessage]", err);
      await this.outputCallback(channelId, `_Error: ${err.message}_`);
      return false;
    } finally {
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
