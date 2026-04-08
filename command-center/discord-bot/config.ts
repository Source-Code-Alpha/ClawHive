// Config + env loading

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotenv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadDotenv();

export const config = {
  botToken: process.env.DISCORD_BOT_TOKEN || "",
  clientId: process.env.DISCORD_CLIENT_ID || "",
  guildId: process.env.DISCORD_GUILD_ID || "",
  userId: process.env.DISCORD_USER_ID || "",
  clawhiveUrl: (process.env.CLAWHIVE_URL || "http://localhost:3096").replace(/\/$/, ""),
  clawhiveToken: process.env.CLAWHIVE_TOKEN || "",
  defaultAgent: process.env.DEFAULT_AGENT || "personal",
  digestChannel: process.env.DIGEST_CHANNEL || "daily",
  digestHour: parseInt(process.env.DIGEST_HOUR || "8"),
  digestMinute: parseInt(process.env.DIGEST_MINUTE || "0"),
  timezone: process.env.TZ || "Africa/Cairo",
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (!config.botToken) errors.push("DISCORD_BOT_TOKEN is required");
  if (!config.clientId) errors.push("DISCORD_CLIENT_ID is required");
  if (!config.guildId) errors.push("DISCORD_GUILD_ID is required");
  if (!config.userId) errors.push("DISCORD_USER_ID is required");
  if (!config.clawhiveUrl) errors.push("CLAWHIVE_URL is required");
  return errors;
}

export function isAuthorized(userId: string): boolean {
  return userId === config.userId;
}
