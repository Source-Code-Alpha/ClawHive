import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { discoverAgents, invalidateAgentCache } from "./agents.js";
import {
  createSession,
  attachClient,
  detachClient,
  writeToSession,
  resizeSession,
  killSession,
  listSessions,
  getActiveSessionIds,
  getSessionHistory,
  readHistoryFile,
  shutdownAll,
  getServerStats,
  quickChat,
  killAllSessions,
  pinSession,
  unpinSession,
  isPinned,
} from "./sessions.js";
import {
  listAgentFiles,
  readAgentFile,
  writeAgentFile,
  listMemory,
  readMemoryFile,
  listAllTopics,
  readTopicFile,
  createTopic,
  listSkills,
  readSkill,
  getActivity,
  logActivity,
  subscribeEvents,
  globalSearch,
  searchSessionHistory,
  getAgentMetrics,
  getTodayDigest,
  startMemoryWatcher,
  saveUploadedFile,
  getWebhookSecret,
  validateWebhookSecret,
  getOutgoingWebhooks,
  setOutgoingWebhooks,
  fireOutgoingWebhooks,
  createShareLink,
  getShareLink,
} from "./workspace.js";
import { executeSkill } from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3096");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Serve static frontend
app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json({ limit: "1mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "10mb" }));

// ── Input Validation Helpers (#12) ──────────────────────────────

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(val: unknown): string | null {
  if (typeof val !== "string" || val.length === 0 || val.length > 100) return null;
  if (!VALID_ID.test(val)) return null;
  return val;
}

function clamp(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === "number" ? val : parseInt(String(val));
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ── Health Check (#16) ───────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  const stats = getServerStats();
  const agents = discoverAgents();
  res.json({
    status: "ok",
    ...stats,
    agentCount: agents.length,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ──────────────────────────────────────────────────

app.get("/api/agents", (_req, res) => {
  const agents = discoverAgents();
  const activeIds = getActiveSessionIds();
  for (const agent of agents) {
    agent.hasActiveSession = activeIds.has(agent.id);
  }
  res.json(agents);
});

app.get("/api/sessions", (_req, res) => {
  res.json(listSessions());
});

app.post("/api/sessions", (req, res) => {
  const agentId = validateId(req.body.agentId);
  if (!agentId) {
    res.status(400).json({ error: "Invalid agentId (alphanumeric, underscore, hyphen only)" });
    return;
  }

  const topic = req.body.topic ? validateId(req.body.topic) : undefined;
  if (req.body.topic && !topic) {
    res.status(400).json({ error: "Invalid topic (alphanumeric, underscore, hyphen only)" });
    return;
  }

  const cols = clamp(req.body.cols, 10, 500, 120);
  const rows = clamp(req.body.rows, 5, 200, 30);
  const initialPrompt = typeof req.body.initialPrompt === "string" ? req.body.initialPrompt.slice(0, 5000) : undefined;

  const session = createSession(agentId, topic, cols, rows, initialPrompt);
  if (!session) {
    const active = [...listSessions()].filter(s => s.alive).length;
    res.status(503).json({ error: `Max sessions reached (${active}/8)` });
    return;
  }

  // Invalidate agent cache so hasActiveSession updates
  invalidateAgentCache();
  logActivity("session_started", `Started ${agentId}${topic ? ` (${topic})` : ""}`, agentId, topic);
  fireOutgoingWebhooks({ type: "session_started", data: { agentId, topic } });

  res.json({ id: session.id, agentId: session.agentId, topic: session.topic });
});

app.delete("/api/sessions/:id", (req, res) => {
  killSession(req.params.id);
  invalidateAgentCache();
  logActivity("session_ended", `Ended ${req.params.id}`);
  fireOutgoingWebhooks({ type: "session_ended", data: { id: req.params.id } });
  res.json({ ok: true });
});

// ── History Routes ──────────────────────────────────────────────

app.get("/api/history", (_req, res) => {
  const agentId = typeof _req.query.agent === "string" ? _req.query.agent : undefined;
  res.json(getSessionHistory(agentId));
});

app.get("/api/history/:filename", (req, res) => {
  const content = readHistoryFile(req.params.filename);
  if (content === null) {
    res.status(404).json({ error: "History file not found" });
    return;
  }
  res.type("text/plain").send(content);
});

// ── Workspace File API (#1, #2) ──────────────────────────────────

app.get("/api/agents/:id/files", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  res.json(listAgentFiles(id));
});

app.get("/api/agents/:id/files/:filename", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const content = readAgentFile(id, req.params.filename);
  if (content === null) { res.status(404).json({ error: "File not found or not allowed" }); return; }
  res.type("text/plain").send(content);
});

app.put("/api/agents/:id/files/:filename", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const content = req.body?.content;
  if (typeof content !== "string") { res.status(400).json({ error: "content required" }); return; }
  const ok = writeAgentFile(id, req.params.filename, content);
  if (!ok) { res.status(400).json({ error: "Write failed" }); return; }
  logActivity("file_edit", `Updated ${req.params.filename}`, id);
  res.json({ ok: true });
});

// ── Memory Inspector API (#3) ────────────────────────────────────

app.get("/api/agents/:id/memory", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  res.json(listMemory(id));
});

app.get("/api/agents/:id/memory/:filename", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const content = readMemoryFile(id, req.params.filename);
  if (content === null) { res.status(404).json({ error: "Memory file not found" }); return; }
  res.type("text/plain").send(content);
});

// ── Topic Browser API (#4) ───────────────────────────────────────

app.get("/api/topics", (_req, res) => {
  res.json(listAllTopics());
});

app.get("/api/agents/:id/topics/:topic/:filename", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const fname = req.params.filename;
  if (fname !== "TOPIC.md" && fname !== "MEMORY.md") {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const content = readTopicFile(id, req.params.topic, fname);
  if (content === null) { res.status(404).json({ error: "Topic file not found" }); return; }
  res.type("text/plain").send(content);
});

app.post("/api/agents/:id/topics", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const topicName = validateId(req.body?.name);
  if (!topicName) { res.status(400).json({ error: "Invalid topic name" }); return; }
  const ok = createTopic(id, topicName);
  if (!ok) { res.status(400).json({ error: "Topic already exists or invalid" }); return; }
  invalidateAgentCache();
  logActivity("topic_created", `Created topic ${topicName}`, id, topicName);
  res.json({ ok: true });
});

// ── Skill Catalog API (#5) ───────────────────────────────────────

app.get("/api/skills", (_req, res) => {
  res.json(listSkills());
});

app.get("/api/skills/:id", (req, res) => {
  const content = readSkill(req.params.id);
  if (content === null) { res.status(404).json({ error: "Skill not found" }); return; }
  res.type("text/plain").send(content);
});

// ── Activity Feed API (#6) ───────────────────────────────────────

app.get("/api/activity", (_req, res) => {
  const limit = Math.min(parseInt(String(_req.query.limit)) || 50, 200);
  res.json(getActivity(limit));
});

// ── Global Search (B4 #1) ───────────────────────────────────────

app.get("/api/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json(globalSearch(q, 30));
});

// ── Session History Search (B4 #2) ──────────────────────────────

app.get("/api/history/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json(searchSessionHistory(q, 30));
});

// ── Agent Metrics (B4 #3) ───────────────────────────────────────

app.get("/api/agents/:id/metrics", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  res.json(getAgentMetrics(id));
});

// ── Today's Digest (B4 #5) ──────────────────────────────────────

app.get("/api/digest/today", (_req, res) => {
  res.json(getTodayDigest());
});

// ── File Upload (B4 #6) ─────────────────────────────────────────

app.post("/api/agents/:id/upload", (req, res) => {
  const id = validateId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const filename = typeof req.query.filename === "string" ? req.query.filename : null;
  if (!filename) { res.status(400).json({ error: "filename query param required" }); return; }
  if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: "Send raw bytes as application/octet-stream" }); return; }

  const fpath = saveUploadedFile(id, filename, req.body);
  if (!fpath) { res.status(400).json({ error: "Upload failed" }); return; }
  logActivity("file_upload", `Uploaded ${filename}`, id);
  res.json({ ok: true, path: fpath });
});

// ── Webhook Receiver (B4 #7) ────────────────────────────────────

app.get("/api/webhooks/secret", (_req, res) => {
  res.json({ secret: getWebhookSecret() });
});

app.post("/api/webhooks/:secret/:agentId", async (req, res) => {
  if (!validateWebhookSecret(req.params.secret)) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }
  const agentId = validateId(req.params.agentId);
  if (!agentId) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const prompt = req.body?.prompt || req.body?.message || "";
  if (!prompt) { res.status(400).json({ error: "prompt or message required" }); return; }

  // Fire and forget
  logActivity("webhook_triggered", `Webhook → ${agentId}`, agentId);
  fireOutgoingWebhooks({ type: "webhook_received", data: { agentId, prompt } });

  res.json({ ok: true, accepted: true });
});

// ── Outgoing Webhooks Config (B4 #8) ────────────────────────────

app.get("/api/webhooks/outgoing", (_req, res) => {
  res.json(getOutgoingWebhooks());
});

app.put("/api/webhooks/outgoing", (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  setOutgoingWebhooks(urls);
  res.json({ ok: true, urls: getOutgoingWebhooks() });
});

// ── Skill Execution (B4 #11) ────────────────────────────────────

app.post("/api/skills/:id/execute", async (req, res) => {
  const skillId = validateId(req.params.id);
  if (!skillId) { res.status(400).json({ error: "Invalid skill id" }); return; }
  const args = typeof req.body?.args === "string" ? req.body.args : "";
  try {
    const output = await executeSkill(skillId, args, 60_000);
    logActivity("skill_executed", `Ran skill ${skillId}`);
    res.json({ output });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Skill execution failed" });
  }
});

// ── Session Share (B4 #12) ──────────────────────────────────────

app.post("/api/share", (req, res) => {
  const agentId = validateId(req.body?.agentId);
  if (!agentId) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const topic = req.body?.topic ? validateId(req.body.topic) : undefined;
  const content = typeof req.body?.content === "string" ? req.body.content.slice(0, 200_000) : "";
  const id = createShareLink(agentId, topic, content);
  res.json({ id, url: `/share/${id}` });
});

app.get("/api/share/:id", (req, res) => {
  const link = getShareLink(req.params.id);
  if (!link) { res.status(404).json({ error: "Share link not found or expired" }); return; }
  res.json(link);
});

// Public share view (read-only)
app.get("/share/:id", (req, res) => {
  const link = getShareLink(req.params.id);
  if (!link) { res.status(404).send("Share link not found or expired"); return; }
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Shared Session: ${link.agentId}</title>
    <style>body{background:#06060f;color:#e0e0f0;font-family:'JetBrains Mono',monospace;padding:30px;line-height:1.5}
    h1{color:#7c4dff}pre{background:#0c0c1c;padding:20px;border-radius:8px;overflow:auto;border-left:3px solid #7c4dff}
    .meta{color:#8080b0;font-size:12px;margin-bottom:20px}</style></head><body>
    <h1>Shared Session: ${link.agentId}${link.topic ? " / " + link.topic : ""}</h1>
    <div class="meta">Shared ${new Date(link.createdAt).toLocaleString()} · Read-only snapshot</div>
    <pre>${link.content.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"} as any)[c])}</pre>
    </body></html>`;
  res.type("html").send(html);
});

// ── Quick Chat API (B3 #7) ───────────────────────────────────────

app.post("/api/quickchat", async (req, res) => {
  const agentId = validateId(req.body?.agentId);
  if (!agentId) { res.status(400).json({ error: "Invalid agentId" }); return; }
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > 5000) {
    res.status(400).json({ error: "Prompt required (1-5000 chars)" });
    return;
  }
  try {
    const response = await quickChat(agentId, prompt, 90_000);
    logActivity("quick_chat", `Quick chat with ${agentId}`, agentId);
    res.json({ response });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Quick chat failed" });
  }
});

// ── Bulk Operations API (B3 #9) ──────────────────────────────────

app.post("/api/sessions/kill-all", (req, res) => {
  const idleOnly = req.body?.idleOnly === true;
  const count = killAllSessions(idleOnly);
  invalidateAgentCache();
  logActivity("bulk_kill", `Killed ${count} ${idleOnly ? "idle " : ""}sessions`);
  res.json({ killed: count });
});

// ── Session Pin API (B3 #10) ─────────────────────────────────────

app.post("/api/sessions/:id/pin", (req, res) => {
  pinSession(req.params.id);
  res.json({ pinned: true });
});

app.delete("/api/sessions/:id/pin", (req, res) => {
  unpinSession(req.params.id);
  res.json({ pinned: false });
});

// ── WebSocket upgrade ───────────────────────────────────────────

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);

  // Broadcast/events channel (#14)
  if (url.pathname === "/ws/events") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleEventsWs(ws);
    });
    return;
  }

  const match = url.pathname.match(/^\/ws\/terminal\/(.+)$/);
  if (!match) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const sessionId = decodeURIComponent(match[1]);
    handleTerminalWs(ws, sessionId);
  });
});

function handleEventsWs(ws: WebSocket) {
  const send = (event: { type: string; data: any }) => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(event)); } catch {}
    }
  };
  // Send initial activity snapshot
  send({ type: "activity_snapshot", data: getActivity(20) });
  const unsubscribe = subscribeEvents(send);
  ws.on("close", () => unsubscribe());
}

function handleTerminalWs(ws: WebSocket, sessionId: string) {
  const attached = attachClient(sessionId, ws);

  if (!attached) {
    ws.send("\x1b[31mSession not found. Create one first via the dashboard.\x1b[0m\r\n");
    ws.close();
    return;
  }

  // Client sends: JSON for control messages, raw text for stdin
  ws.on("message", (data) => {
    const msg = data.toString();

    // Try parsing as JSON control message
    try {
      const ctrl = JSON.parse(msg);
      if (ctrl.type === "resize" && ctrl.cols && ctrl.rows) {
        resizeSession(sessionId, clamp(ctrl.cols, 10, 500, 120), clamp(ctrl.rows, 5, 200, 30));
        return;
      }
    } catch {
      // Not JSON -- treat as terminal input
    }

    writeToSession(sessionId, msg);
  });

  ws.on("close", () => {
    detachClient(sessionId, ws);
  });
}

// ── Graceful Shutdown (#15) ─────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n[server] ${signal} received. Shutting down gracefully...`);
  shutdownAll();
  wss.close();
  server.close(() => {
    console.log("[server] Closed.");
    process.exit(0);
  });
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Start ───────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
  const agents = discoverAgents();
  console.log(`\n  Agent Command Center`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://localhost`);
  console.log(`  ${agents.length} agents discovered`);
  console.log(`  Webhook secret: ${getWebhookSecret().slice(0, 8)}...`);
  startMemoryWatcher();
  console.log(`  Memory watcher started\n`);
});
