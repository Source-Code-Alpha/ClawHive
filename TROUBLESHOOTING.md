# Troubleshooting

If something is broken, this is the place to start. Most issues fall into one of three buckets: install (node-pty fails to compile), runtime (Claude CLI not found or wrong port), or behavior (something works but not how you expected).

## Install Issues

### `npm install` fails with `node-pty` errors

This is by far the most common problem. `node-pty` is a native module that compiles C++ on install, and it needs build tools.

**Windows**

You need Visual Studio Build Tools. Install one of these:

```powershell
# Option A: Microsoft's official installer (preferred)
# Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
# During install, select "Desktop development with C++"

# Option B: Via npm (older, sometimes flaky)
npm install --global windows-build-tools
```

You also need Python 3 in your PATH:

```powershell
python --version    # should print 3.x
# If not: winget install Python.Python.3.12
```

Then re-run:

```powershell
cd command-center
npm install
```

If it still fails, try forcing a rebuild:

```powershell
npm rebuild node-pty --build-from-source
```

**macOS**

You need Xcode Command Line Tools:

```bash
xcode-select --install
```

If you are on Apple Silicon and see `arch` errors, force x86_64 or rebuild:

```bash
arch -arm64 npm install
# or
npm rebuild node-pty --build-from-source
```

**Linux**

Install `build-essential` and `python3-dev`:

```bash
# Debian / Ubuntu
sudo apt-get install -y build-essential python3-dev

# Fedora / RHEL
sudo dnf install -y gcc-c++ make python3-devel

# Arch
sudo pacman -S base-devel python
```

Then `npm install` again.

### `Cannot find module '@anthropic-ai/claude-code'` or `claude: command not found`

You need the Claude Code CLI installed globally:

```bash
npm i -g @anthropic-ai/claude-code

# Verify
claude --version
```

If it installs but is not on PATH, add npm's global bin to your PATH:

```bash
npm config get prefix
# Add the result + /bin (Unix) or just the result (Windows) to PATH
```

### Node version too old

ClawHive requires Node 20 or newer. Check with:

```bash
node --version
```

If you need to upgrade, use [nvm](https://github.com/nvm-sh/nvm) (Linux/macOS) or [nvm-windows](https://github.com/coreybutler/nvm-windows):

```bash
nvm install 20
nvm use 20
```

## Runtime Issues

### `Error: listen EADDRINUSE: address already in use 0.0.0.0:3096`

Something is already using port 3096. Either kill it or change the port.

**Find and kill the process:**

```bash
# Linux / macOS
lsof -i :3096
kill -9 <PID>

# Windows
netstat -ano | findstr :3096
taskkill /F /PID <PID>
```

**Or change the port:**

```bash
PORT=3097 npx tsx server/index.ts
```

### Dashboard loads but no agents appear

The command center scans `~/clawd-*/` directories for agent workspaces. If none are present, the grid will be empty.

```bash
# Check what is in your home directory
ls ~/clawd-*

# If empty, run setup again
./scripts/setup.sh
```

You can also override the prefix with an env var:

```bash
WORKSPACE_PREFIX=myagent- npx tsx server/index.ts
# Now it scans ~/myagent-*/
```

### Sessions create but the terminal stays blank

The Claude CLI binary is probably not on the PATH the command center uses. Set it explicitly:

```bash
CLAUDE_BIN=/full/path/to/claude npx tsx server/index.ts

# Find your full path with:
which claude       # Linux/macOS
where claude       # Windows
```

### `WebSocket connection failed` in browser console

Your reverse proxy is not forwarding WebSocket upgrade headers. If you are running ClawHive behind Nginx, Caddy, or similar, make sure WebSocket support is enabled:

```nginx
# Nginx example
location / {
  proxy_pass http://localhost:3096;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 86400;
}
```

### Sessions die after 30 minutes of inactivity

That is the idle timeout, on by default. Change it:

```bash
# Disable entirely
IDLE_TIMEOUT=0 npx tsx server/index.ts

# Or set to 2 hours
IDLE_TIMEOUT=7200 npx tsx server/index.ts
```

You can also pin specific sessions through the dashboard so they ignore the timeout.

## Behavior Issues

### "Quick Chat" returns truncated or empty responses

Quick Chat spawns a fresh PTY, sends a prompt, waits 3 seconds for output to stabilize, then kills the PTY. On slow machines or first-time agent boots (where Claude reads many .md files), this can race.

Workarounds:
- Use a full session instead (click the agent card)
- Re-run the Quick Chat after the agent has booted once
- Increase the timeout in `server/sessions.ts` (`stableTimer` setting)

### Voice input does not work

Voice input requires the Web Speech API, which is only available in Chromium-based browsers (Chrome, Edge, Brave, Arc). Firefox and Safari are not supported.

You also need to grant microphone permission to the dashboard origin.

### Auto-saved memory looks like raw terminal output

It is. The current auto-save just appends the last 80 lines of scrollback to `memory/YYYY-MM-DD.md`. It is honest, complete, and ugly. A future version will use Claude itself to summarize.

If you do not want auto-save, comment out the `appendDailyMemory` call in `server/sessions.ts` `pty.onExit` handler.

### Force boot sequence is racing with Claude's startup

The server sends the "read all your files" prompt 4 seconds after Claude is spawned. On very slow machines this can collide with Claude's own boot output. Fix:

```bash
# Increase the delay (in milliseconds) by editing server/sessions.ts
# Find the line: }, 4000);
# Change to: }, 8000);
```

A future version will detect Claude's prompt readiness instead of using a fixed delay.

### Memory freshness dot stays gray for an agent that has memory

The freshness dot reads `memory/YYYY-MM-DD.md` mtimes plus root `MEMORY.md`. If your memory is in non-standard locations, it will not see them. Move them or update `getAgentHealth` in `server/workspace.ts`.

## Authentication

By default, ClawHive has no authentication on its API or WebSocket. Anyone on the network can launch sessions, edit files, run skills.

This is fine for:
- A homelab behind Tailscale or a VPN
- localhost-only use
- A trusted LAN

This is NOT fine for:
- Public internet exposure
- Shared multi-user environments
- Anywhere untrusted clients can reach the dashboard

To enable a basic bearer token, set `CLAWHIVE_TOKEN`:

```bash
CLAWHIVE_TOKEN=your-secret-here npx tsx server/index.ts
```

Then every API request needs the header:

```
Authorization: Bearer your-secret-here
```

The dashboard will prompt for the token on first load and store it in localStorage.

## Getting Help

- Open an issue: https://github.com/Source-Code-Alpha/ClawHive/issues
- Search existing issues first — many problems are already documented
- Include: OS, Node version, Claude CLI version, full error output, what you tried

## Reset / Nuclear Options

### Reset the command center to factory state

```bash
cd ~/clawhive-command-center
rm -rf node_modules package-lock.json
npm install
```

### Re-run setup from scratch

```bash
cd ClawHive
./scripts/setup.sh
```

### Wipe a single agent

```bash
rm -rf ~/clawd-coding
./scripts/add-agent.sh    # then re-create it
```

### Wipe all session history

```bash
rm -rf ~/.clawhive/history/*
```

This is safe — agents will keep their workspaces and memory; only the raw session logs are removed.
