import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { discoverAgents } from "./agents.js";
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
} from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3096");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Serve static frontend
app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json());

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
  const { agentId, topic, cols, rows } = req.body;
  if (!agentId) {
    res.status(400).json({ error: "agentId required" });
    return;
  }

  const session = createSession(agentId, topic, cols, rows);
  if (!session) {
    res.status(503).json({ error: "Max sessions reached" });
    return;
  }

  res.json({ id: session.id, agentId: session.agentId, topic: session.topic });
});

app.delete("/api/sessions/:id", (req, res) => {
  killSession(req.params.id);
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

// ── WebSocket upgrade ───────────────────────────────────────────

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
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
        resizeSession(sessionId, ctrl.cols, ctrl.rows);
        return;
      }
    } catch {
      // Not JSON — treat as terminal input
    }

    writeToSession(sessionId, msg);
  });

  ws.on("close", () => {
    detachClient(sessionId, ws);
  });
}

// ── Start ───────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
  const agents = discoverAgents();
  console.log(`\n  Agent Command Center`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  ${agents.length} agents discovered\n`);
});
