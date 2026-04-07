# ClawHive Command Center — Docker image
# Includes node-pty build deps and the Claude Code CLI

FROM node:22-bookworm

# node-pty requires C++ build tools and Python
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install dependencies (cache layer)
COPY package.json package-lock.json* ./
RUN npm install

# Copy application
COPY server/ ./server/
COPY public/ ./public/
COPY tsconfig.json* ./

# Default environment — override at runtime
ENV PORT=3096
ENV CLAUDE_BIN=claude
ENV WORKSPACE_PREFIX=clawd-
ENV MAX_SESSIONS=8
ENV IDLE_TIMEOUT=1800
ENV HISTORY_DIR=/data/history

# Persist session history and agent workspaces
VOLUME /data/history
VOLUME /workspaces

EXPOSE 3096

# Healthcheck — fails if /api/health does not respond
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

# Use tsx via npx (no deprecated loader flag)
CMD ["npx", "tsx", "server/index.ts"]
