// Workspace inspector — file operations, memory, topics, skills
// Read-write access to agent workspace files

import fs from "fs";
import path from "path";
import os from "os";

const HOME = os.homedir();
const WORKSPACE_PREFIX = process.env.WORKSPACE_PREFIX || "clawd-";
const SHARED_DIR = path.join(HOME, `${WORKSPACE_PREFIX}shared`);
const SKILLS_DIR = path.join(SHARED_DIR, "skills");

// Allowed files for read/write per agent (security: no arbitrary file access)
const ALLOWED_FILES = new Set([
  "IDENTITY.md", "SOUL.md", "AGENTS.md", "USER.md", "TOOLS.md",
  "MEMORY.md", "CLAUDE.md", "HEARTBEAT.md", "CURRENT_TASK.md", "README.md",
]);

const VALID_AGENT_ID = /^[a-zA-Z0-9_-]+$/;
const VALID_FILENAME = /^[a-zA-Z0-9_.\-]+$/;
const VALID_TOPIC = /^[a-zA-Z0-9_-]+$/;

function workspacePath(agentId: string): string | null {
  if (!VALID_AGENT_ID.test(agentId)) return null;
  const dir = path.join(HOME, `${WORKSPACE_PREFIX}${agentId}`);
  if (!fs.existsSync(dir)) return null;
  return dir;
}

// ── File Operations ────────────────────────────────────────────

export function listAgentFiles(agentId: string): string[] {
  const ws = workspacePath(agentId);
  if (!ws) return [];
  try {
    return fs.readdirSync(ws)
      .filter(f => ALLOWED_FILES.has(f))
      .sort();
  } catch {
    return [];
  }
}

export function readAgentFile(agentId: string, filename: string): string | null {
  const ws = workspacePath(agentId);
  if (!ws) return null;
  if (!ALLOWED_FILES.has(filename)) return null;
  try {
    return fs.readFileSync(path.join(ws, filename), "utf-8");
  } catch {
    return null;
  }
}

export function writeAgentFile(agentId: string, filename: string, content: string): boolean {
  const ws = workspacePath(agentId);
  if (!ws) return false;
  if (!ALLOWED_FILES.has(filename)) return false;
  if (typeof content !== "string" || content.length > 500_000) return false;
  try {
    fs.writeFileSync(path.join(ws, filename), content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ── Memory Inspector ───────────────────────────────────────────

export interface MemoryEntry {
  date: string;
  filename: string;
  size: number;
  preview: string;
}

export function listMemory(agentId: string, limit = 30): MemoryEntry[] {
  const ws = workspacePath(agentId);
  if (!ws) return [];
  const memDir = path.join(ws, "memory");
  if (!fs.existsSync(memDir)) return [];

  try {
    const files = fs.readdirSync(memDir)
      .filter(f => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => {
      const fpath = path.join(memDir, f);
      const stat = fs.statSync(fpath);
      let preview = "";
      try {
        const content = fs.readFileSync(fpath, "utf-8");
        preview = content.split("\n").slice(0, 5).join("\n").slice(0, 300);
      } catch {}
      return {
        date: f.replace(".md", ""),
        filename: f,
        size: stat.size,
        preview,
      };
    });
  } catch {
    return [];
  }
}

export function readMemoryFile(agentId: string, filename: string): string | null {
  const ws = workspacePath(agentId);
  if (!ws) return null;
  if (!VALID_FILENAME.test(filename)) return null;
  try {
    return fs.readFileSync(path.join(ws, "memory", filename), "utf-8");
  } catch {
    return null;
  }
}

// ── Topic Browser ──────────────────────────────────────────────

export interface Topic {
  name: string;
  agentId: string;
  agentName?: string;
  hasMemory: boolean;
  lastUpdated: string;
}

export function listAllTopics(): Topic[] {
  const topics: Topic[] = [];
  try {
    const entries = fs.readdirSync(HOME, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(WORKSPACE_PREFIX)) continue;
      const agentId = entry.name.slice(WORKSPACE_PREFIX.length);
      const topicsDir = path.join(HOME, entry.name, "topics");
      if (!fs.existsSync(topicsDir)) continue;

      try {
        const topicDirs = fs.readdirSync(topicsDir, { withFileTypes: true });
        for (const t of topicDirs) {
          if (!t.isDirectory()) continue;
          const memFile = path.join(topicsDir, t.name, "MEMORY.md");
          let hasMemory = false;
          let lastUpdated = "";
          try {
            const stat = fs.statSync(memFile);
            hasMemory = true;
            lastUpdated = stat.mtime.toISOString();
          } catch {}
          topics.push({
            name: t.name,
            agentId,
            hasMemory,
            lastUpdated,
          });
        }
      } catch {}
    }
  } catch {}
  return topics.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

export function readTopicFile(agentId: string, topic: string, filename: "TOPIC.md" | "MEMORY.md"): string | null {
  const ws = workspacePath(agentId);
  if (!ws) return null;
  if (!VALID_TOPIC.test(topic)) return null;
  if (filename !== "TOPIC.md" && filename !== "MEMORY.md") return null;
  try {
    return fs.readFileSync(path.join(ws, "topics", topic, filename), "utf-8");
  } catch {
    return null;
  }
}

export function createTopic(agentId: string, topicName: string): boolean {
  const ws = workspacePath(agentId);
  if (!ws) return false;
  if (!VALID_TOPIC.test(topicName)) return false;
  const topicDir = path.join(ws, "topics", topicName);
  if (fs.existsSync(topicDir)) return false;
  try {
    fs.mkdirSync(topicDir, { recursive: true });
    fs.writeFileSync(
      path.join(topicDir, "TOPIC.md"),
      `# Topic: ${topicName}\n\n## Context\n\n*Describe what this topic is about*\n`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(topicDir, "MEMORY.md"),
      `# Memory: ${topicName}\n\n*Sessions will be appended here, newest first*\n`,
      "utf-8"
    );
    return true;
  } catch {
    return false;
  }
}

// ── Skill Catalog ──────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  category?: string;
  hasScripts: boolean;
}

function parseSkillMd(content: string): { name: string; description: string; category?: string } {
  const lines = content.split("\n");
  let name = "";
  let description = "";
  let category = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("# ") && !name) {
      name = line.slice(2).trim();
    } else if (line.startsWith("description:") || line.startsWith("Description:")) {
      description = line.split(":").slice(1).join(":").trim();
    } else if (line.startsWith("category:") || line.startsWith("Category:")) {
      category = line.split(":").slice(1).join(":").trim();
    } else if (!description && line && !line.startsWith("#") && !line.startsWith("---")) {
      // First non-header paragraph as fallback description
      description = line.slice(0, 200);
    }
    if (name && description && category) break;
  }
  return { name, description, category };
}

export function listSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const skills: Skill[] = [];
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SKILLS_DIR, entry.name);
      const skillMd = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;

      try {
        const content = fs.readFileSync(skillMd, "utf-8");
        const parsed = parseSkillMd(content);
        skills.push({
          id: entry.name,
          name: parsed.name || entry.name,
          description: parsed.description || "",
          category: parsed.category,
          hasScripts: fs.existsSync(path.join(skillDir, "scripts")),
        });
      } catch {}
    }
  } catch {}
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkill(skillId: string): string | null {
  if (!VALID_AGENT_ID.test(skillId)) return null;
  try {
    return fs.readFileSync(path.join(SKILLS_DIR, skillId, "SKILL.md"), "utf-8");
  } catch {
    return null;
  }
}

// ── Activity Feed ──────────────────────────────────────────────

interface ActivityEvent {
  type: string;
  agentId?: string;
  topic?: string;
  message: string;
  timestamp: string;
}

const activityLog: ActivityEvent[] = [];
const MAX_ACTIVITY = 200;

export function logActivity(type: string, message: string, agentId?: string, topic?: string) {
  activityLog.unshift({
    type,
    agentId,
    topic,
    message,
    timestamp: new Date().toISOString(),
  });
  if (activityLog.length > MAX_ACTIVITY) {
    activityLog.length = MAX_ACTIVITY;
  }
  // Broadcast to all connected dashboards
  broadcastEvent({ type: "activity", data: activityLog[0] });
}

export function getActivity(limit = 50): ActivityEvent[] {
  return activityLog.slice(0, limit);
}

// ── WebSocket Broadcast (#14) ──────────────────────────────────

type EventListener = (event: { type: string; data: any }) => void;
const eventListeners = new Set<EventListener>();

export function subscribeEvents(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function broadcastEvent(event: { type: string; data: any }) {
  for (const listener of eventListeners) {
    try { listener(event); } catch {}
  }
}

// ══════════════════════════════════════════════════════════════
//  BATCH 4 ADDITIONS
// ══════════════════════════════════════════════════════════════

// ── Global Search (B4 #1) ──────────────────────────────────────

export interface SearchResult {
  type: "agent" | "topic" | "memory" | "skill" | "file" | "session";
  agentId?: string;
  title: string;
  preview: string;
  href?: string;
}

export function globalSearch(query: string, limit = 30): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results: SearchResult[] = [];

  // Search topics
  const topics = listAllTopics();
  for (const t of topics) {
    if (t.name.toLowerCase().includes(q) || t.agentId.toLowerCase().includes(q)) {
      results.push({
        type: "topic",
        agentId: t.agentId,
        title: `${t.agentId} → ${t.name}`,
        preview: `Topic in ${t.agentId}`,
      });
    }
  }

  // Search skills
  const skills = listSkills();
  for (const s of skills) {
    if (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
      results.push({
        type: "skill",
        title: s.name,
        preview: s.description.slice(0, 120),
      });
    }
  }

  // Search agent files (IDENTITY/SOUL/AGENTS content)
  try {
    const entries = fs.readdirSync(HOME, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit * 2) break;
      if (!entry.isDirectory() || !entry.name.startsWith(WORKSPACE_PREFIX)) continue;
      const agentId = entry.name.slice(WORKSPACE_PREFIX.length);

      for (const fname of ["IDENTITY.md", "SOUL.md", "AGENTS.md", "MEMORY.md"]) {
        try {
          const fpath = path.join(HOME, entry.name, fname);
          if (!fs.existsSync(fpath)) continue;
          const content = fs.readFileSync(fpath, "utf-8");
          const lower = content.toLowerCase();
          const idx = lower.indexOf(q);
          if (idx >= 0) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + 100);
            results.push({
              type: "file",
              agentId,
              title: `${agentId}/${fname}`,
              preview: "..." + content.slice(start, end).replace(/\n/g, " ") + "...",
            });
            break; // one match per agent
          }
        } catch {}
      }
    }
  } catch {}

  return results.slice(0, limit);
}

// ── Session History Full-Text Search (B4 #2) ───────────────────

const HISTORY_DIR_FOR_SEARCH = path.join(HOME, ".clawhive", "history");

export interface HistorySearchResult {
  filename: string;
  agentId: string;
  topic?: string;
  date: string;
  size: number;
  matchCount: number;
  snippet: string;
}

export function searchSessionHistory(query: string, limit = 20): HistorySearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q || !fs.existsSync(HISTORY_DIR_FOR_SEARCH)) return [];

  const results: HistorySearchResult[] = [];
  try {
    const files = fs.readdirSync(HISTORY_DIR_FOR_SEARCH).filter(f => f.endsWith(".log"));
    for (const f of files) {
      try {
        const fpath = path.join(HISTORY_DIR_FOR_SEARCH, f);
        const content = fs.readFileSync(fpath, "utf-8");
        // Strip ANSI for searching
        const stripped = content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").toLowerCase();
        const matchCount = (stripped.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
        if (matchCount === 0) continue;

        const stat = fs.statSync(fpath);
        const idx = stripped.indexOf(q);
        const start = Math.max(0, idx - 60);
        const end = Math.min(stripped.length, idx + 200);
        const snippet = stripped.slice(start, end).replace(/\n/g, " ");

        // Parse filename: agentId_topic_DATE.log
        const parts = f.replace(".log", "").split("_");
        const dateStr = parts.pop() || "";
        const agentId = parts.shift() || "";
        const topic = parts.length > 0 ? parts.join("_") : undefined;

        results.push({
          filename: f,
          agentId,
          topic,
          date: dateStr,
          size: stat.size,
          matchCount,
          snippet: "..." + snippet + "...",
        });
      } catch {}
    }
  } catch {}

  return results.sort((a, b) => b.matchCount - a.matchCount).slice(0, limit);
}

// ── Agent Metrics (B4 #3) ──────────────────────────────────────

export interface AgentMetrics {
  agentId: string;
  totalSessions: number;
  totalSeconds: number;
  lastUsed: string | null;
  topicCounts: Record<string, number>;
  recentDates: string[]; // last 7 days, ISO date strings of activity
}

export function getAgentMetrics(agentId: string): AgentMetrics {
  const metrics: AgentMetrics = {
    agentId,
    totalSessions: 0,
    totalSeconds: 0,
    lastUsed: null,
    topicCounts: {},
    recentDates: [],
  };

  if (!fs.existsSync(HISTORY_DIR_FOR_SEARCH)) return metrics;

  try {
    const prefix = `${agentId}_`;
    const files = fs.readdirSync(HISTORY_DIR_FOR_SEARCH).filter(f => f.startsWith(prefix) || f === `${agentId}.log`);

    const activeDates = new Set<string>();
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(HISTORY_DIR_FOR_SEARCH, f));
        metrics.totalSessions++;

        // Parse topic from filename
        const parts = f.replace(".log", "").split("_");
        parts.shift(); // agentId
        const dateStr = parts.pop() || "";
        const topic = parts.length > 0 ? parts.join("_") : "general";
        metrics.topicCounts[topic] = (metrics.topicCounts[topic] || 0) + 1;

        // Activity date
        const isoDate = stat.mtime.toISOString().slice(0, 10);
        activeDates.add(isoDate);

        if (!metrics.lastUsed || stat.mtime.toISOString() > metrics.lastUsed) {
          metrics.lastUsed = stat.mtime.toISOString();
        }
      } catch {}
    }

    // Last 7 days as array
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      metrics.recentDates.push(activeDates.has(iso) ? iso : "");
    }
  } catch {}

  return metrics;
}

// ── Today's Activity Digest (B4 #5) ────────────────────────────

export function getTodayDigest(): {
  date: string;
  sessions: number;
  agentsUsed: string[];
  memoryUpdates: number;
  topicsCreated: number;
  events: ActivityEvent[];
} {
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = activityLog.filter(e => e.timestamp.slice(0, 10) === today);

  return {
    date: today,
    sessions: todayEvents.filter(e => e.type === "session_started").length,
    agentsUsed: [...new Set(todayEvents.map(e => e.agentId).filter(Boolean) as string[])],
    memoryUpdates: todayEvents.filter(e => e.type === "memory_updated").length,
    topicsCreated: todayEvents.filter(e => e.type === "topic_created").length,
    events: todayEvents,
  };
}

// ── MEMORY File Watcher (B4 #4) ────────────────────────────────

const watchedFiles = new Map<string, number>();

export function startMemoryWatcher() {
  scanMemoryFiles();
  setInterval(scanMemoryFiles, 15_000); // Check every 15s
}

function scanMemoryFiles() {
  try {
    const entries = fs.readdirSync(HOME, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(WORKSPACE_PREFIX)) continue;
      const agentId = entry.name.slice(WORKSPACE_PREFIX.length);
      const memFile = path.join(HOME, entry.name, "MEMORY.md");
      checkFile(memFile, agentId);

      // Also check topic memories
      const topicsDir = path.join(HOME, entry.name, "topics");
      if (fs.existsSync(topicsDir)) {
        try {
          const topics = fs.readdirSync(topicsDir, { withFileTypes: true });
          for (const t of topics) {
            if (!t.isDirectory()) continue;
            const tMem = path.join(topicsDir, t.name, "MEMORY.md");
            checkFile(tMem, agentId, t.name);
          }
        } catch {}
      }
    }
  } catch {}
}

function checkFile(filepath: string, agentId: string, topic?: string) {
  try {
    if (!fs.existsSync(filepath)) return;
    const stat = fs.statSync(filepath);
    const mtime = stat.mtimeMs;
    const prev = watchedFiles.get(filepath);
    if (prev === undefined) {
      watchedFiles.set(filepath, mtime);
      return; // First scan, don't notify
    }
    if (mtime > prev) {
      watchedFiles.set(filepath, mtime);
      const target = topic ? `${agentId} → ${topic}` : agentId;
      logActivity("memory_updated", `Memory updated: ${target}`, agentId, topic);
    }
  } catch {}
}

// ── File Upload (B4 #6) ────────────────────────────────────────

export function saveUploadedFile(agentId: string, filename: string, content: Buffer): string | null {
  if (!VALID_AGENT_ID.test(agentId)) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
  if (content.length > 10 * 1024 * 1024) return null; // 10MB limit

  const ws = workspacePath(agentId);
  if (!ws) return null;

  const uploadsDir = path.join(ws, "uploads");
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    const fpath = path.join(uploadsDir, filename);
    fs.writeFileSync(fpath, content);
    return fpath;
  } catch {
    return null;
  }
}

// ── Webhook Receiver (B4 #7) ───────────────────────────────────

const webhookSecret = process.env.WEBHOOK_SECRET || generateSecret();

function generateSecret(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function getWebhookSecret(): string {
  return webhookSecret;
}

export function validateWebhookSecret(secret: string): boolean {
  return secret === webhookSecret;
}

// ── Outgoing Webhooks (B4 #8) ──────────────────────────────────

const OUTGOING_WEBHOOKS_FILE = path.join(HOME, ".clawhive", "webhooks.json");

export function getOutgoingWebhooks(): string[] {
  try {
    return JSON.parse(fs.readFileSync(OUTGOING_WEBHOOKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function setOutgoingWebhooks(urls: string[]) {
  try {
    fs.mkdirSync(path.dirname(OUTGOING_WEBHOOKS_FILE), { recursive: true });
    fs.writeFileSync(OUTGOING_WEBHOOKS_FILE, JSON.stringify(urls.filter(u => /^https?:\/\//.test(u))), "utf-8");
  } catch {}
}

export async function fireOutgoingWebhooks(event: { type: string; data: any }) {
  const urls = getOutgoingWebhooks();
  for (const url of urls) {
    try {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "clawhive", ...event, timestamp: new Date().toISOString() }),
      }).catch(() => {});
    } catch {}
  }
}

// Hook outgoing webhooks into activity log
const originalLog = logActivity;
// (already defined above; webhooks are fired manually from session events)

// ── Session Share (B4 #12) ─────────────────────────────────────

const shareLinks = new Map<string, { agentId: string; topic?: string; createdAt: number; content: string }>();

export function createShareLink(agentId: string, topic: string | undefined, content: string): string {
  const id = generateSecret().slice(0, 16);
  shareLinks.set(id, { agentId, topic, createdAt: Date.now(), content });
  // Cleanup old links (>7 days)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [k, v] of shareLinks) {
    if (v.createdAt < cutoff) shareLinks.delete(k);
  }
  return id;
}

export function getShareLink(id: string): { agentId: string; topic?: string; createdAt: number; content: string } | null {
  return shareLinks.get(id) || null;
}
