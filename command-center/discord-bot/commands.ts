// Slash command definitions and registration.

import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "./config.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Auto-create a text channel for each ClawHive agent"),
  new SlashCommandBuilder()
    .setName("agents")
    .setDescription("List all available ClawHive agents"),
  new SlashCommandBuilder()
    .setName("quick")
    .setDescription("One-shot question to a specific agent (no persistent session)")
    .addStringOption(opt => opt.setName("agent").setDescription("Agent ID").setRequired(true))
    .addStringOption(opt => opt.setName("prompt").setDescription("Your question").setRequired(true)),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show current session info for this channel"),
  new SlashCommandBuilder()
    .setName("end")
    .setDescription("End the current session in this channel"),
  new SlashCommandBuilder()
    .setName("digest")
    .setDescription("Show today's activity digest"),
  new SlashCommandBuilder()
    .setName("health")
    .setDescription("Check ClawHive command center health"),
].map(c => c.toJSON());

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.botToken);
  // Guild-scoped registration: instant propagation (vs global which takes ~1hr)
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );
}
