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
  createdAt: Date;
  lastActivity: Date;
  clientCount: number;
}
