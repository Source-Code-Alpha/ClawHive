// Formats raw PTY output into Discord-safe Markdown chunks.
// Discord max message length: 2000 chars. We use 1900 for safety.

const SAFE_LENGTH = 1900;

// Strip ANSI escape codes and control characters
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")     // CSI sequences
    .replace(/\x1b\][^\x07]*\x07/g, "")        // OSC sequences
    .replace(/\x1b[()][\x20-\x7e]/g, "")       // charset switches
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")  // control chars except \n \t
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

// Strip box-drawing and other terminal decorations Claude often outputs
export function cleanForDiscord(text: string): string {
  return stripAnsi(text)
    .replace(/[│├└─━╭╮╯╰┃╔╗╚╝═║┌┐┘┤┬┴┼]/g, "")
    .replace(/[\u2500-\u257f]/g, "") // box drawing block
    .replace(/[ \t]+\n/g, "\n")       // trailing whitespace before newline
    .replace(/\n{3,}/g, "\n\n");      // collapse multiple blank lines
}

// Split a long message into Discord-sized chunks, preferring line/word boundaries
export function chunkMessage(text: string, max = SAFE_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > max) {
    let breakAt = remaining.lastIndexOf("\n\n", max);
    if (breakAt < max / 2) breakAt = remaining.lastIndexOf("\n", max);
    if (breakAt < max / 2) breakAt = remaining.lastIndexOf(" ", max);
    if (breakAt < 0) breakAt = max;

    chunks.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// Discord renders Markdown natively — no escaping needed for normal text.
// We just clean control codes and chunk.
export function formatForDiscord(rawText: string): string[] {
  const cleaned = cleanForDiscord(rawText);
  if (!cleaned.trim()) return [];
  return chunkMessage(cleaned);
}

// Build a header line for an agent message: "**🧑‍💻 Soha Coding**"
export function agentHeader(emoji: string, name: string): string {
  return `**${emoji} ${name}**\n`;
}

// Convert agent_id to channel name: soha_coding -> soha-coding
export function agentIdToChannelName(agentId: string): string {
  return agentId.toLowerCase().replace(/_/g, "-");
}

// Convert channel name back to agent ID: soha-coding -> soha_coding
export function channelNameToAgentId(channelName: string): string {
  return channelName.toLowerCase().replace(/-/g, "_");
}
