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
