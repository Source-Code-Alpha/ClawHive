# Deployment Guide

This guide covers every way to run ClawHive -- from a simple local setup to a full homelab deployment with reverse proxy and remote access.

---

## Local Development

The simplest way to use ClawHive. No command center needed. Just clone, run setup, and launch agents directly from the terminal.

### Prerequisites

- **Node.js 20+** -- [nodejs.org](https://nodejs.org/)
- **Git** -- for cloning the repo
- **Claude Code CLI** -- `npm i -g @anthropic-ai/claude-code`

### Setup

```bash
git clone https://github.com/Source-Code-Alpha/ClawHive.git
cd ClawHive

# Linux / Mac
./scripts/setup.sh

# Windows (PowerShell)
.\scripts\setup.ps1
```

The setup script:
1. Checks prerequisites (Node.js, Git, Claude Code CLI)
2. Creates the dispatcher (`~/CLAUDE.md`)
3. Creates agent workspaces (`~/clawd-coding/`, `~/clawd-researcher/`, etc.)
4. Sets up the shared resources directory (`~/clawd-shared/`)
5. Installs the command center and its dependencies

### Launch an Agent

```bash
cd ~/clawd-coding
claude
```

That is it. The agent reads its `CLAUDE.md` boot sequence, loads its identity and personality, and you are working together.

### Launch the Dispatcher

To use the multi-agent dispatcher (switch between agents with `@coding`, `@researcher`, etc.):

```bash
cd ~
claude
```

The dispatcher reads `~/CLAUDE.md` and lets you load any agent by name.

---

## Command Center (Local)

The command center is a web dashboard that lets you launch, manage, and switch between agent sessions from any browser.

### Start the Server

```bash
cd ~/clawhive-command-center
npx tsx server/index.ts
```

Or using npm:

```bash
cd ~/clawhive-command-center
npm run dev
```

The server starts on **http://localhost:3096** by default.

### What You Get

- Agent cards for every discovered workspace
- Click any card to launch a live terminal session
- Multiple concurrent sessions with tab switching
- Sessions persist when you close the browser -- reconnect later
- Session history with log files
- Mobile-friendly layout

### Changing the Port

```bash
PORT=8080 npx tsx server/index.ts
```

---

## Homelab Deployment

Run ClawHive on a dedicated machine (NUC, mini PC, Raspberry Pi, old laptop) and access it from any device on your network.

### 1. Install Prerequisites

```bash
# Install Node.js 20+ (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Verify
node --version   # Should be v20+
npm --version

# Install Claude Code CLI
npm i -g @anthropic-ai/claude-code

# Verify
claude --version
```

### 2. Clone and Setup

```bash
git clone https://github.com/Source-Code-Alpha/ClawHive.git
cd ClawHive
./scripts/setup.sh
```

### 3. Start the Command Center

Test that it works:

```bash
cd ~/clawhive-command-center
npx tsx server/index.ts
```

Open `http://<machine-ip>:3096` from another device on your LAN to verify.

### 4. Run as a Service (Linux -- systemd)

Create a systemd service so the command center starts automatically and survives reboots.

```bash
sudo tee /etc/systemd/system/clawhive.service << 'EOF'
[Unit]
Description=ClawHive Agent Command Center
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/clawhive-command-center
ExecStart=/usr/bin/node --import tsx server/index.ts
Restart=on-failure
RestartSec=5
Environment=PORT=3096
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable clawhive
sudo systemctl start clawhive

# Check status
sudo systemctl status clawhive

# View logs
journalctl -u clawhive -f
```

### 5. Run as a Service (Windows -- Task Scheduler)

ClawHive ships with Windows startup scripts in the `command-center/` directory:

- **`start.cmd`** -- Launches the server in a console window
- **`start-hidden.vbs`** -- Launches the server with no visible window

To run at startup:

1. Open Task Scheduler (`taskschd.msc`)
2. Create a new task (not basic task)
3. **General tab:** Run whether user is logged on or not
4. **Triggers:** At startup (or at log on)
5. **Actions:** Start a program
   - Program: `wscript.exe`
   - Arguments: `"C:\Users\your-username\clawhive-command-center\start-hidden.vbs"`
   - Start in: `C:\Users\your-username\clawhive-command-center`
6. **Conditions:** Uncheck "Start only if on AC power" for always-on machines

### 6. Local DNS Setup

Give your ClawHive instance a friendly domain name like `ai.local` instead of remembering an IP address.

**Option A: Pi-hole (recommended if you already run one)**

1. Open Pi-hole admin at `http://<pihole-ip>/admin`
2. Go to Local DNS > DNS Records
3. Add: `ai.local` pointing to your ClawHive machine's IP (e.g., `192.168.1.100`)

**Option B: Hosts file**

Add an entry on each device that needs access:

```bash
# Linux / Mac: /etc/hosts
# Windows: C:\Windows\System32\drivers\etc\hosts

192.168.1.100    ai.local
```

### 7. Reverse Proxy Setup

A reverse proxy gives you clean URLs and proper WebSocket support. This is recommended if you want to access the command center at `http://ai.local` (port 80) instead of `http://ai.local:3096`.

**Option A: Nginx**

```nginx
# /etc/nginx/sites-available/clawhive
server {
    listen 80;
    server_name ai.local;

    location / {
        proxy_pass http://127.0.0.1:3096;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeout -- keep connections alive
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/clawhive /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Option B: Nginx Proxy Manager (GUI-based)**

If you run Nginx Proxy Manager in Docker:

1. Add a new Proxy Host
2. **Domain:** `ai.local`
3. **Scheme:** `http`
4. **Forward Hostname/IP:** `192.168.1.100` (or the Docker host IP)
5. **Forward Port:** `3096`
6. **Websockets Support:** Enable this (critical for terminal sessions)

### 8. Remote Access via Tailscale

Access your ClawHive instance from anywhere using [Tailscale](https://tailscale.com/) VPN.

1. Install Tailscale on your ClawHive machine and your client devices
2. Your machine gets a Tailscale IP (e.g., `100.x.y.z`)
3. Access the command center at `http://100.x.y.z:3096` from anywhere

For a clean domain name on Tailscale:

- Use Tailscale MagicDNS: your machine becomes accessible as `machine-name.tailnet-name.ts.net`
- Or add a hosts file entry on your client devices mapping a friendly name to the Tailscale IP

---

## Docker Deployment

The command center includes a Dockerfile for containerized deployment.

### Build and Run

```bash
cd command-center
docker build -t clawhive .
docker run -d \
  --name clawhive \
  -p 3096:3096 \
  -v $HOME:/home/user \
  clawhive
```

### With Docker Compose

```yaml
# docker-compose.yml
version: "3.8"
services:
  clawhive:
    build: ./command-center
    container_name: clawhive
    ports:
      - "3096:3096"
    volumes:
      - ${HOME}:/home/user
      - clawhive-history:/data/history
    environment:
      - PORT=3096
      - WORKSPACE_PREFIX=clawd-
      - MAX_SESSIONS=8
    restart: unless-stopped

volumes:
  clawhive-history:
```

```bash
docker compose up -d
```

### Caveats

- **Claude CLI must be accessible inside the container.** The Dockerfile does not install the Claude Code CLI. You need to either:
  - Mount the Claude binary into the container
  - Install it in a custom Dockerfile layer (`RUN npm i -g @anthropic-ai/claude-code`)
  - Use a host-network approach where the container calls the host's Claude binary
- **Agent workspaces must be mounted.** The `-v $HOME:/home/user` volume mount gives the container access to your agent workspaces. Adjust the path if your workspaces are elsewhere.
- **Session history** is persisted to the `/data/history` volume inside the container. Map it to a host directory if you want easy access to log files.
- **node-pty requires native compilation.** The Dockerfile installs build tools (`build-essential`, `python3`) for this. If you use a custom base image, make sure these are available.

---

## Environment Variables

All configuration is done through environment variables. Set them in your shell, in a `.env` file, or in your service definition.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3096` | Port the command center listens on |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI binary. Change this if `claude` is not on your PATH or you want to use a wrapper script. |
| `WORKSPACE_PREFIX` | `clawd-` | Prefix for agent workspace directories. The server discovers agents by scanning `$HOME` for directories matching `{prefix}{agent-id}/`. |
| `SKIP_DIRS` | *(empty)* | Comma-separated list of directory names to skip during agent discovery. Useful for excluding backup or archived workspaces (e.g., `clawd-old-agent,clawd-test`). |
| `MAX_SESSIONS` | `8` | Maximum number of concurrent agent sessions. Each session spawns a Claude CLI process with a PTY, so this limits resource usage. |
| `HISTORY_DIR` | `~/.clawhive/history` | Directory where session log files are stored. Each session creates a timestamped `.log` file with the full terminal output. |

### Example .env File

Create a `.env` file in the command center directory:

```bash
# command-center/.env
PORT=3096
CLAUDE_BIN=claude
WORKSPACE_PREFIX=clawd-
SKIP_DIRS=clawd-archive,clawd-test
MAX_SESSIONS=12
HISTORY_DIR=~/.clawhive/history
```

### Loading Environment Variables

The server reads from `process.env`. How you set these depends on your deployment:

```bash
# Direct (inline)
PORT=8080 MAX_SESSIONS=4 npx tsx server/index.ts

# From .env file (using dotenv or shell)
source .env && npx tsx server/index.ts

# In systemd service
Environment=PORT=3096
Environment=MAX_SESSIONS=12

# In Docker
docker run -e PORT=3096 -e MAX_SESSIONS=12 clawhive

# In docker-compose.yml
environment:
  - PORT=3096
  - MAX_SESSIONS=12
```

---

## Startup Scripts

### Windows

The command center ships with two Windows startup files:

**`start.cmd`** -- Opens a console window and runs the server:

```cmd
@echo off
cd /d "%~dp0"
node --import tsx server/index.ts
```

**`start-hidden.vbs`** -- Runs the server with no visible window (for background operation):

```vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c """ & Replace(WScript.ScriptFullName, "start-hidden.vbs", "start.cmd") & """", 0, False
```

Use `start-hidden.vbs` with Task Scheduler for a fully headless setup.

### Linux (systemd)

Full service file for production use:

```ini
[Unit]
Description=ClawHive Agent Command Center
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/clawhive-command-center
ExecStart=/usr/bin/node --import tsx server/index.ts
Restart=on-failure
RestartSec=5

# Environment
Environment=PORT=3096
Environment=CLAUDE_BIN=claude
Environment=WORKSPACE_PREFIX=clawd-
Environment=MAX_SESSIONS=8
Environment=HISTORY_DIR=/home/your-username/.clawhive/history

# Security hardening (optional)
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/your-username

[Install]
WantedBy=multi-user.target
```

Install and manage:

```bash
# Install
sudo cp clawhive.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable clawhive

# Start / stop / restart
sudo systemctl start clawhive
sudo systemctl stop clawhive
sudo systemctl restart clawhive

# View logs (follow mode)
journalctl -u clawhive -f

# View last 50 lines
journalctl -u clawhive -n 50
```

### macOS (launchd)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.clawhive.command-center</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>--import</string>
        <string>tsx</string>
        <string>server/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/your-username/clawhive-command-center</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>3096</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/clawhive.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/clawhive-error.log</string>
</dict>
</plist>
```

```bash
# Install
cp com.clawhive.command-center.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.clawhive.command-center.plist

# Unload
launchctl unload ~/Library/LaunchAgents/com.clawhive.command-center.plist
```

---

## Security Considerations

ClawHive is designed for personal and homelab use. It does not include built-in authentication or authorization. You are responsible for securing access at the network level.

### No Built-In Auth

The command center serves an open HTTP/WebSocket interface. Anyone who can reach port 3096 can:

- View all discovered agents
- Launch agent sessions
- Send input to running sessions
- View session history

This is intentional for simplicity. Secure it at the network layer.

### Network-Level Security

**LAN trust model:** If your ClawHive machine is on a trusted home network, the default setup is fine. Only devices on your LAN can access it.

**VPN access (Tailscale):** Tailscale creates an encrypted, authenticated tunnel. Only devices on your Tailnet can reach your ClawHive instance. This is the recommended approach for remote access.

**Reverse proxy auth:** If you need user authentication, add it at the reverse proxy layer:

```nginx
# Nginx basic auth example
server {
    listen 80;
    server_name ai.local;

    auth_basic "ClawHive";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:3096;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }
}
```

Create the password file:

```bash
sudo apt-get install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd your-username
```

**Firewall rules:** On the ClawHive machine, restrict access to port 3096:

```bash
# UFW (Ubuntu)
sudo ufw allow from 192.168.1.0/24 to any port 3096  # LAN only
sudo ufw allow from 100.64.0.0/10 to any port 3096    # Tailscale only
```

### The `--dangerously-skip-permissions` Flag

The command center spawns Claude CLI sessions with the `--dangerously-skip-permissions` flag. This is necessary for unattended operation -- without it, Claude would prompt for permission on every file read, write, or command execution, which cannot be answered through the web terminal reliably.

**What this means:**

- Claude can read and write any file accessible to the user running the server
- Claude can execute any command without confirmation prompts
- This is safe when you trust the agents and the network

**When to use it:**

- Personal machines where you are the only user
- Homelab setups behind a firewall or VPN
- Development environments

**When NOT to use it:**

- Shared servers with multiple users
- Machines exposed directly to the internet
- Production environments with sensitive data

If you need fine-grained permissions, run Claude CLI directly in agent workspaces (without the command center) and use Claude's built-in permission system to approve actions interactively.

### General Recommendations

1. **Do not expose port 3096 to the internet.** Use a VPN (Tailscale) for remote access.
2. **Run the server as a non-root user.** The systemd service file above demonstrates this.
3. **Keep agent workspaces on an encrypted filesystem** if they contain sensitive project data.
4. **Review session history periodically.** Log files in `~/.clawhive/history/` record all terminal output.
5. **Use separate machines** for ClawHive and production services if security is a concern.
