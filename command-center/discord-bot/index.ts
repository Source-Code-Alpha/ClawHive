// ClawHive Discord bot — entry point.
// Bridges Discord channels to ClawHive PTY sessions.
// Each text channel named after an agent (e.g. #soha-coding) is bound to that agent's session.

import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  EmbedBuilder,
  Message,
  Interaction,
  TextChannel,
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config, validateConfig, isAuthorized } from "./config.js";
import { api, type Agent } from "./clawhive-api.js";
import { SessionManager } from "./session-manager.js";
import { agentIdToChannelName, channelNameToAgentId } from "./formatter.js";
import { registerCommands } from "./commands.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- bootstrap ---
const errors = validateConfig();
if (errors.length > 0) {
  console.error("Config errors:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const sessions = new SessionManager(
  async (channelId, content) => {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && channel.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send(content);
    }
  },
  async (channelId) => {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && channel.isTextBased() && "sendTyping" in channel) {
      await (channel as TextChannel).sendTyping();
    }
  }
);

// channelId -> agentId map (rebuilt on /setup and on startup)
const channelMap = new Map<string, string>();

async function rebuildChannelMap() {
  channelMap.clear();
  try {
    const agents = await api.listAgents();
    const guild = await client.guilds.fetch(config.guildId);
    const channels = await guild.channels.fetch();
    for (const [, ch] of channels) {
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      const agentId = channelNameToAgentId(ch.name);
      const match = agents.find(a => a.id === agentId);
      if (match) {
        channelMap.set(ch.id, match.id);
        sessions.bindChannel(ch.id, match.id);
      }
    }
    console.log(`[map] bound ${channelMap.size} agent channels`);
  } catch (err: any) {
    console.error("[map]", err.message);
  }
}

// --- ready handler ---
client.once(Events.ClientReady, async c => {
  console.log(`[ready] logged in as ${c.user.tag}`);
  try {
    await registerCommands();
    console.log(`[commands] registered slash commands for guild ${config.guildId}`);
  } catch (err: any) {
    console.error("[commands] register failed:", err.message);
  }
  await rebuildChannelMap();
  startDigestCron();
});

// --- plain message handler ---
client.on(Events.MessageCreate, async (msg: Message) => {
  if (msg.author.bot) return;
  if (msg.guild?.id !== config.guildId) return;
  if (!isAuthorized(msg.author.id)) {
    await msg.reply("This is a private bot.").catch(() => {});
    return;
  }

  const agentId = channelMap.get(msg.channelId);
  if (!agentId) return; // not an agent channel — ignore plain messages

  // Handle file attachments
  if (msg.attachments.size > 0) {
    for (const [, att] of msg.attachments) {
      try {
        const res = await fetch(att.url);
        const buf = Buffer.from(await res.arrayBuffer());
        const result = await api.uploadFile(agentId, att.name, buf);
        await msg.reply(`Uploaded \`${att.name}\` -> \`${result.path}\``);
        await sessions.sendMessage(msg.channelId, `I just uploaded ${att.name} to my uploads/ folder. Please read it.`);
      } catch (err: any) {
        await msg.reply(`Upload failed: ${err.message}`).catch(() => {});
      }
    }
    return;
  }

  // Plain text → spawn `claude -p` for that agent
  const content = msg.content.trim();
  if (!content) return;
  await msg.react("⏳").catch(() => {});
  const sent = await sessions.sendMessage(msg.channelId, content);
  // Replace the hourglass with a check or X based on outcome
  await msg.reactions.cache.get("⏳")?.users.remove(client.user!.id).catch(() => {});
  await msg.react(sent ? "✅" : "❌").catch(() => {});
});

// --- slash command handler ---
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== config.guildId) return;
  if (!isAuthorized(interaction.user.id)) {
    await interaction.reply({ content: "This is a private bot.", ephemeral: true });
    return;
  }

  const cmd = interaction.commandName;

  try {
    if (cmd === "setup") {
      await interaction.deferReply();
      const agents = await api.listAgents();
      const guild = interaction.guild!;
      const existing = await guild.channels.fetch();
      let created = 0;
      let skipped = 0;
      for (const a of agents) {
        const channelName = agentIdToChannelName(a.id);
        const exists = existing.find(c => c?.name === channelName);
        if (exists) { skipped++; continue; }
        await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          topic: `${a.emoji} ${a.name} — ${a.role}`,
        });
        created++;
      }
      // Ensure #daily exists for digest
      if (!existing.find(c => c?.name === config.digestChannel)) {
        await guild.channels.create({
          name: config.digestChannel,
          type: ChannelType.GuildText,
          topic: "Daily activity digest",
        });
      }
      await rebuildChannelMap();
      await interaction.editReply(`Setup complete. Created ${created} channels, skipped ${skipped} existing. Total agent channels bound: ${channelMap.size}`);
    }

    else if (cmd === "agents") {
      await interaction.deferReply();
      const agents = await api.listAgents();
      const grouped = new Map<string, Agent[]>();
      for (const a of agents) {
        const cat = a.category || "uncategorized";
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(a);
      }
      const embed = new EmbedBuilder().setTitle("ClawHive Agents").setColor(0x7c4dff);
      for (const [cat, list] of grouped) {
        embed.addFields({
          name: cat,
          value: list.map(a => `${a.emoji} **${a.name}** \`${a.id}\``).join("\n").slice(0, 1024),
        });
      }
      await interaction.editReply({ embeds: [embed] });
    }

    else if (cmd === "quick") {
      const agentId = interaction.options.getString("agent", true);
      const prompt = interaction.options.getString("prompt", true);
      await interaction.deferReply();
      try {
        const res = await api.quickChat(agentId, prompt);
        const reply = res.response.length > 1900 ? res.response.slice(0, 1900) + "..." : res.response;
        await interaction.editReply(reply || "_[no response]_");
      } catch (err: any) {
        await interaction.editReply(`Error: ${err.message}`);
      }
    }

    else if (cmd === "status") {
      const state = sessions.getState(interaction.channelId);
      const agentId = channelMap.get(interaction.channelId);
      if (!agentId) {
        await interaction.reply({ content: "This channel is not bound to an agent.", ephemeral: true });
        return;
      }
      const wsState = state?.ws?.readyState;
      const wsLabel = wsState === undefined ? "n/a" : wsState === 1 ? "open" : wsState === 0 ? "connecting" : wsState === 2 ? "closing" : "closed";
      const lines = [
        `**Agent:** ${agentId}`,
        `**Session:** ${state?.sessionId ?? "_none_"}`,
        `**Connection:** ${wsLabel}`,
      ];
      await interaction.reply({ content: lines.join("\n"), ephemeral: true });
    }

    else if (cmd === "end") {
      await sessions.endSession(interaction.channelId);
      await interaction.reply({ content: "Session ended.", ephemeral: true });
    }

    else if (cmd === "digest") {
      await interaction.deferReply();
      try {
        const d = await api.todayDigest();
        const embed = new EmbedBuilder()
          .setTitle(`Daily Digest — ${d.date}`)
          .setColor(0x7c4dff)
          .addFields(
            { name: "Sessions", value: String(d.sessions), inline: true },
            { name: "Memory updates", value: String(d.memoryUpdates), inline: true },
            { name: "Topics created", value: String(d.topicsCreated), inline: true },
            { name: "Agents used", value: d.agentsUsed.length > 0 ? d.agentsUsed.join(", ") : "_none_" },
          );
        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.editReply(`Error: ${err.message}`);
      }
    }

    else if (cmd === "health") {
      try {
        const h = await api.health();
        await interaction.reply({
          content: `**ClawHive Health**\nStatus: ${h.status}\nUptime: ${Math.floor(h.uptime / 60)}min\nActive sessions: ${h.activeSessions}\nAgents: ${h.agentCount}`,
          ephemeral: true,
        });
      } catch (err: any) {
        await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
      }
    }
  } catch (err: any) {
    console.error("[command]", cmd, err);
    if (interaction.deferred) {
      await interaction.editReply(`Error: ${err.message}`).catch(() => {});
    } else {
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }
});

// --- daily digest cron ---
const DIGEST_STATE_FILE = path.join(__dirname, "last-digest.txt");
let lastDigestDate = "";
try {
  if (fs.existsSync(DIGEST_STATE_FILE)) {
    lastDigestDate = fs.readFileSync(DIGEST_STATE_FILE, "utf-8").trim();
  }
} catch {}

function startDigestCron() {
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() !== config.digestHour) return;
    if (now.getMinutes() !== config.digestMinute) return;
    const today = now.toISOString().slice(0, 10);
    if (lastDigestDate === today) return;
    try {
      const guild = await client.guilds.fetch(config.guildId);
      const channels = await guild.channels.fetch();
      const digestChannel = channels.find(c => c?.name === config.digestChannel) as TextChannel | undefined;
      if (!digestChannel) {
        console.error("[digest] channel not found:", config.digestChannel);
        return;
      }
      const d = await api.todayDigest();
      const embed = new EmbedBuilder()
        .setTitle(`Daily Digest — ${d.date}`)
        .setColor(0x7c4dff)
        .addFields(
          { name: "Sessions", value: String(d.sessions), inline: true },
          { name: "Memory updates", value: String(d.memoryUpdates), inline: true },
          { name: "Topics created", value: String(d.topicsCreated), inline: true },
          { name: "Agents used", value: d.agentsUsed.length > 0 ? d.agentsUsed.join(", ") : "_none_" },
        );
      await digestChannel.send({ embeds: [embed] });
      lastDigestDate = today;
      fs.writeFileSync(DIGEST_STATE_FILE, today);
      console.log("[digest] posted for", today);
    } catch (err: any) {
      console.error("[digest]", err.message);
    }
  }, 60000); // check every minute
}

// --- shutdown handlers ---
async function shutdown() {
  console.log("[shutdown] cleaning up...");
  await sessions.shutdown();
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// --- start ---
client.login(config.botToken).catch(err => {
  console.error("[login] failed:", err.message);
  process.exit(1);
});
