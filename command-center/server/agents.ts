import fs from "fs";
import path from "path";
import os from "os";
import type { Agent } from "./types.js";

const HOME = os.homedir();
const WORKSPACE_PREFIX = process.env.WORKSPACE_PREFIX || "clawd-";
const SKIP_DIRS = new Set(
  process.env.SKIP_DIRS?.split(",").filter(Boolean) || []
);

// ── Agent Discovery Cache (#13) ────────────────────────────────
let cachedAgents: Agent[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

export function invalidateAgentCache(): void {
  cachedAgents = null;
  cacheTime = 0;
}

function parseIdentityMd(filePath: string): Partial<Agent> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const result: Partial<Agent> = {};

    for (const line of content.split("\n")) {
      const stripped = line.replace(/\*\*/g, "").replace(/^[-*]\s+/, "").trim();
      if (stripped.startsWith("Name:")) {
        result.name = stripped.slice(5).trim();
      } else if (stripped.startsWith("Emoji:")) {
        result.emoji = stripped.slice(6).trim();
      } else if (stripped.startsWith("Vibe:") || stripped.startsWith("vibe:")) {
        result.vibe = stripped.slice(5).trim();
      } else if (stripped.startsWith("Role:")) {
        result.role = stripped.slice(5).trim().split("\n")[0];
      } else if (stripped.startsWith("Category:") || stripped.startsWith("category:")) {
        result.category = stripped.slice(9).trim().toLowerCase();
      } else if (stripped.startsWith("Color:") || stripped.startsWith("color:")) {
        result.color = stripped.slice(6).trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

function getTopics(workspace: string): string[] {
  const topicsDir = path.join(workspace, "topics");
  try {
    return fs
      .readdirSync(topicsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function discoverAgents(): Agent[] {
  // Return cache if fresh
  if (cachedAgents && Date.now() - cacheTime < CACHE_TTL) {
    return cachedAgents;
  }

  const agents: Agent[] = [];

  for (const entry of fs.readdirSync(HOME, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(WORKSPACE_PREFIX)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const agentId = entry.name.slice(WORKSPACE_PREFIX.length);
    const workspace = path.join(HOME, entry.name);
    const identityPath = path.join(workspace, "IDENTITY.md");

    if (!fs.existsSync(identityPath)) continue;

    const identity = parseIdentityMd(identityPath);

    agents.push({
      id: agentId,
      name: identity.name || agentId,
      emoji: identity.emoji || "🤖",
      vibe: identity.vibe || "",
      role: identity.role || "",
      category: identity.category || "",
      color: identity.color || "",
      workspace,
      topics: getTopics(workspace),
      hasActiveSession: false,
    });
  }

  cachedAgents = agents.sort((a, b) => a.name.localeCompare(b.name));
  cacheTime = Date.now();
  return cachedAgents;
}
