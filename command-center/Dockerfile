FROM node:22-bookworm

# node-pty requires build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy application files
COPY server/ ./server/
COPY public/ ./public/

# Default environment
ENV PORT=3096
ENV CLAUDE_BIN=claude
ENV WORKSPACE_PREFIX=clawd-
ENV MAX_SESSIONS=8
ENV HISTORY_DIR=/data/history

# Persist session history
VOLUME /data/history

EXPOSE 3096

CMD ["node", "--loader", "tsx", "server/index.ts"]
