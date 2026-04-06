import fs from "fs";
import os from "os";
import path from "path";
import { WebSocket } from "ws";

import nodePty from "node-pty";
const { spawn } = nodePty;

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "8");
const SCROLLBACK_SIZE = 200 * 1024; // 200KB -- enough for reconnect replay
const HISTORY_DIR = path.join(os.homedir(), ".clawhive", "history");
const KEEPALIVE_INTERVAL = 30_000; // 30s WebSocket ping
const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || "1800") * 1000; // default 30 min

// Ensure history dir exists
fs.mkdirSync(HISTORY_DIR, { recursive: true });

interface PtySession {
  id: string;
  agentId: string;
  topic?: string;
  pty: ReturnType<typeof spawn>;
  buffer: string;
  clients: Set<WebSocket>;
  createdAt: Date;
  lastActivity: Date;
  alive: boolean;
  historyFile: string;
  historyStream: fs.WriteStream | null;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
}

const sessions = new Map<string, PtySession>();

function sessionId(agentId: string, topic?: string): string {
  return topic ? `${agentId}:${topic}` : agentId;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

function updateCurrentTask(agentId: string, status: "running" | "ended", summary?: string) {
  const workspace = path.join(os.homedir(), `clawd-${agentId}`);
  const taskFile = path.join(workspace, "CURRENT_TASK.md");
  const now = new Date().toISOString();

  if (status === "running") {
    const content = `# Current Task\n\n` +
      `**Status:** Active session\n` +
      `**Started:** ${now}\n` +
      `**Agent:** ${agentId}\n\n` +
      `Session is running in the Agent Command Center.\n` +
      `If this session was interrupted, check the history at:\n` +
      `~/.clawhive/history/\n\n` +
      `## Live Output (last 2000 chars)\n\n` +
      `\`\`\`\n${summary || "(session just started)"}\n\`\`\`\n`;
    try { fs.writeFileSync(taskFile, content, "utf-8"); } catch {}
  } else {
    // Clear the current task on session end
    try { fs.unlinkSync(taskFile); } catch {}
  }
}

function periodicTaskUpdate(session: PtySession) {
  // Update CURRENT_TASK.md with last 2000 chars of buffer every 30 seconds
  const stripped = stripAnsi(session.buffer);
  const last2k = stripped.slice(-2000);
  updateCurrentTask(session.agentId, "running", last2k);
}

export function createSession(
  agentId: string,
  topic?: string,
  cols = 120,
  rows = 30,
  initialPrompt?: string
): PtySession | null {
  const id = sessionId(agentId, topic);

  // Return existing session if one is running
  const existing = sessions.get(id);
  if (existing?.alive) return existing;

  // Check session limit
  const activeCount = [...sessions.values()].filter((s) => s.alive).length;
  if (activeCount >= MAX_SESSIONS) return null;

  const workspace = path.join(os.homedir(), `clawd-${agentId}`);
  const claudeBin = process.env.CLAUDE_BIN || "claude";

  const pty = spawn(claudeBin, ["--dangerously-skip-permissions"], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: workspace,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    } as Record<string, string>,
  });

  // Create history file
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const historyFilename = `${agentId}${topic ? `_${topic}` : ""}_${timestamp}.log`;
  const historyFile = path.join(HISTORY_DIR, historyFilename);
  const historyStream = fs.createWriteStream(historyFile, { encoding: "utf-8" });
  historyStream.write(`# Session: ${agentId}${topic ? ` (${topic})` : ""}\n`);
  historyStream.write(`# Started: ${new Date().toISOString()}\n`);
  historyStream.write(`# Workspace: ${workspace}\n\n`);

  const session: PtySession = {
    id,
    agentId,
    topic,
    pty,
    buffer: "",
    clients: new Set(),
    createdAt: new Date(),
    lastActivity: new Date(),
    alive: true,
    historyFile,
    historyStream,
    keepaliveTimer: null,
  };

  // Capture PTY output → buffer + broadcast + history
  pty.onData((data: string) => {
    session.lastActivity = new Date();

    // Circular buffer for reconnection
    session.buffer += data;
    if (session.buffer.length > SCROLLBACK_SIZE) {
      session.buffer = session.buffer.slice(-SCROLLBACK_SIZE);
    }

    // Write to history file (raw, with ANSI codes for full replay)
    if (session.historyStream) {
      session.historyStream.write(data);
    }

    // Fan out to ALL connected WebSocket clients
    const deadClients: WebSocket[] = [];
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch {
          deadClients.push(ws);
        }
      } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        deadClients.push(ws);
      }
    }
    // Clean up dead clients (don't kill session!)
    for (const ws of deadClients) {
      session.clients.delete(ws);
    }
  });

  pty.onExit(({ exitCode }) => {
    session.alive = false;
    const msg = `\r\n\x1b[90m[Session ended with code ${exitCode}]\x1b[0m\r\n`;
    session.buffer += msg;

    // Close history file
    if (session.historyStream) {
      session.historyStream.write(`\n\n# Ended: ${new Date().toISOString()}\n`);
      session.historyStream.write(`# Exit code: ${exitCode}\n`);
      session.historyStream.end();
      session.historyStream = null;
    }

    // Clear CURRENT_TASK.md
    updateCurrentTask(agentId, "ended");

    // Clear keepalive
    if (session.keepaliveTimer) {
      clearInterval(session.keepaliveTimer);
      session.keepaliveTimer = null;
    }

    // Notify all clients
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
        ws.send(JSON.stringify({ type: "session_ended", exitCode }));
      }
    }
  });

  // Periodic CURRENT_TASK.md update (every 30s)
  session.keepaliveTimer = setInterval(() => {
    if (session.alive) {
      periodicTaskUpdate(session);
    }
  }, 30_000);

  // Initial CURRENT_TASK.md
  updateCurrentTask(agentId, "running");

  // Send initial prompt after Claude boots (#5)
  if (initialPrompt) {
    // Delay to let Claude finish loading (reads CLAUDE.md etc)
    setTimeout(() => {
      if (session.alive) {
        session.pty.write(initialPrompt + "\n");
      }
    }, 3000);
  }

  sessions.set(id, session);
  console.log(`[session] Created: ${id} (pid=${pty.pid})`);
  return session;
}

export function getSession(agentId: string, topic?: string): PtySession | undefined {
  return sessions.get(sessionId(agentId, topic));
}

export function attachClient(id: string, ws: WebSocket): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  session.clients.add(ws);
  console.log(`[session] Client attached to ${id} (${session.clients.size} clients)`);

  // Replay scrollback buffer for the new client
  if (session.buffer) {
    try {
      ws.send(session.buffer);
    } catch {}
  }

  // Start WebSocket keepalive pings to prevent proxy/firewall timeouts
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.ping(); } catch {}
    } else {
      clearInterval(pingTimer);
    }
  }, KEEPALIVE_INTERVAL);

  // Clean up ping timer on close
  ws.on("close", () => {
    clearInterval(pingTimer);
  });

  return true;
}

export function detachClient(id: string, ws: WebSocket): void {
  const session = sessions.get(id);
  if (session) {
    session.clients.delete(ws);
    console.log(`[session] Client detached from ${id} (${session.clients.size} clients remaining)`);
    // IMPORTANT: Do NOT kill the session when last client disconnects.
    // The PTY keeps running. User can reconnect later.
  }
}

export function writeToSession(id: string, data: string): void {
  const session = sessions.get(id);
  if (session?.alive) {
    session.pty.write(data);
  }
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session?.alive) {
    session.pty.resize(cols, rows);
  }
}

export function killSession(id: string): void {
  const session = sessions.get(id);
  if (session) {
    if (session.alive) {
      session.pty.kill();
    }
    if (session.keepaliveTimer) {
      clearInterval(session.keepaliveTimer);
    }
    if (session.historyStream) {
      session.historyStream.end();
    }
    sessions.delete(id);
    console.log(`[session] Killed: ${id}`);
  }
}

export function listSessions(): Array<{
  id: string;
  agentId: string;
  topic?: string;
  alive: boolean;
  clientCount: number;
  createdAt: string;
  lastActivity: string;
  historyFile: string;
}> {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    agentId: s.agentId,
    topic: s.topic,
    alive: s.alive,
    clientCount: s.clients.size,
    createdAt: s.createdAt.toISOString(),
    lastActivity: s.lastActivity.toISOString(),
    historyFile: s.historyFile,
  }));
}

export function getActiveSessionIds(): Set<string> {
  const ids = new Set<string>();
  for (const [, s] of sessions) {
    if (s.alive) ids.add(s.agentId);
  }
  return ids;
}

// ── Server Stats (#16) ──────────────────────────────────────────

const serverStartTime = Date.now();

export function getServerStats() {
  const active = [...sessions.values()].filter(s => s.alive);
  return {
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    activeSessions: active.length,
    maxSessions: MAX_SESSIONS,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    nodeVersion: process.version,
    pid: process.pid,
  };
}

// ── Idle Timeout (#15) ──────────────────────────────────────────

if (IDLE_TIMEOUT > 0) {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (!session.alive) continue;
      const idleMs = now - session.lastActivity.getTime();
      if (idleMs > IDLE_TIMEOUT) {
        console.log(`[session] Idle timeout: ${id} (idle ${Math.round(idleMs / 60000)}m)`);
        // Warn clients before killing
        const warnMsg = `\r\n\x1b[33m[Session timed out after ${Math.round(IDLE_TIMEOUT / 60000)} minutes of inactivity]\x1b[0m\r\n`;
        for (const ws of session.clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(warnMsg);
            ws.send(JSON.stringify({ type: "idle_timeout" }));
          }
        }
        killSession(id);
      } else if (idleMs > IDLE_TIMEOUT - 300_000 && idleMs < IDLE_TIMEOUT - 295_000) {
        // Warn 5 minutes before timeout
        const warnMsg = `\r\n\x1b[33m[Warning: Session will timeout in 5 minutes due to inactivity]\x1b[0m\r\n`;
        for (const ws of session.clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(warnMsg);
            ws.send(JSON.stringify({ type: "idle_warning", remainingMs: IDLE_TIMEOUT - idleMs }));
          }
        }
      }
    }
  }, 60_000); // Check every minute
}

// ── History API ─────────────────────────────────────────────────

export function getSessionHistory(agentId?: string): Array<{
  filename: string;
  agentId: string;
  topic?: string;
  date: string;
  size: number;
}> {
  try {
    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".log"));
    return files
      .filter((f) => !agentId || f.startsWith(agentId))
      .map((f) => {
        const stat = fs.statSync(path.join(HISTORY_DIR, f));
        // Parse filename: agentId_topic_2026-04-06T08-34-00.log
        const parts = f.replace(".log", "").split("_");
        const dateStr = parts.pop() || "";
        const aid = parts.shift() || "";
        const topic = parts.length > 0 ? parts.join("_") : undefined;
        return {
          filename: f,
          agentId: aid,
          topic,
          date: dateStr.replace(/-/g, (m, i) => (i > 9 ? ":" : "-")).slice(0, 19),
          size: stat.size,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first
  } catch {
    return [];
  }
}

export function readHistoryFile(filename: string): string | null {
  const filePath = path.join(HISTORY_DIR, path.basename(filename));
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── Graceful Shutdown (#15) ─────────────────────────────────────

export function shutdownAll(): void {
  console.log(`[session] Shutting down ${sessions.size} sessions...`);
  for (const [id, session] of sessions) {
    // Flush history
    if (session.historyStream) {
      session.historyStream.write(`\n\n# Server shutdown: ${new Date().toISOString()}\n`);
      session.historyStream.end();
      session.historyStream = null;
    }
    // Clear timers
    if (session.keepaliveTimer) {
      clearInterval(session.keepaliveTimer);
      session.keepaliveTimer = null;
    }
    // Close WebSocket clients
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "server_shutdown" }));
        ws.close();
      }
    }
    // Kill PTY
    if (session.alive) {
      try { session.pty.kill(); } catch {}
    }
    // Clear task file
    updateCurrentTask(session.agentId, "ended");
    console.log(`[session] Cleaned up: ${id}`);
  }
  sessions.clear();
}
