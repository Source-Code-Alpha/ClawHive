// Thin client for the ClawHive command center API.

import { config } from "./config.js";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.clawhiveToken) headers.Authorization = `Bearer ${config.clawhiveToken}`;
  return headers;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(config.clawhiveUrl + path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetch(config.clawhiveUrl + path, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(config.clawhiveUrl + path, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  vibe: string;
  role: string;
  category: string;
  color: string;
  workspace: string;
  topics: string[];
  hasActiveSession: boolean;
}

export interface Session {
  id: string;
  agentId: string;
  topic?: string;
  alive: boolean;
  clientCount: number;
  createdAt: string;
  lastActivity: string;
  pinned: boolean;
}

export interface Digest {
  date: string;
  sessions: number;
  agentsUsed: string[];
  memoryUpdates: number;
  topicsCreated: number;
  events: Array<{ type: string; agentId?: string; message: string; timestamp: string }>;
}

export const api = {
  listAgents: () => get<Agent[]>("/api/agents"),
  listSessions: () => get<Session[]>("/api/sessions"),
  createSession: (agentId: string, topic?: string, initialPrompt?: string) =>
    post<{ id: string; agentId: string; topic?: string }>("/api/sessions", {
      agentId, topic, initialPrompt, cols: 100, rows: 30, forceBootSequence: true,
    }),
  killSession: (id: string) => del(`/api/sessions/${encodeURIComponent(id)}`),
  quickChat: (agentId: string, prompt: string) =>
    post<{ response: string }>("/api/quickchat", { agentId, prompt }),
  todayDigest: () => get<Digest>("/api/digest/today"),
  uploadFile: async (agentId: string, filename: string, buf: Buffer) => {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (config.clawhiveToken) headers.Authorization = `Bearer ${config.clawhiveToken}`;
    const res = await fetch(
      `${config.clawhiveUrl}/api/agents/${encodeURIComponent(agentId)}/upload?filename=${encodeURIComponent(filename)}`,
      { method: "POST", headers, body: buf as any }
    );
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return res.json() as Promise<{ ok: boolean; path: string }>;
  },
  health: () => get<{ status: string; uptime: number; activeSessions: number; agentCount: number }>("/api/health"),
};
