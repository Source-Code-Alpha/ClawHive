#!/bin/bash
# ClawHive Preflight Check
# Run this BEFORE setup.sh to catch problems early.

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

ok() { echo -e "  ${GREEN}OK${NC}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; WARN=$((WARN+1)); }
info() { echo -e "  ${BLUE}INFO${NC}  $1"; }

echo ""
echo "  ClawHive Preflight Check"
echo "  ========================"
echo ""

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then OS="macos"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then OS="windows"
fi
info "Detected OS: $OS"
echo ""

# 1. Node.js
echo "  Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "Node.js $NODE_VERSION"
  else
    fail "Node.js $NODE_VERSION is too old (need 20+)"
    info "    Install with: nvm install 20 && nvm use 20"
  fi
else
  fail "Node.js not found"
  info "    Install from https://nodejs.org/ (need v20+)"
fi

# 2. npm
if command -v npm &> /dev/null; then
  ok "npm $(npm --version)"
else
  fail "npm not found (should ship with Node)"
fi

# 3. Git
if command -v git &> /dev/null; then
  ok "Git $(git --version | awk '{print $3}')"
else
  fail "Git not found"
fi

# 4. Claude CLI
if command -v claude &> /dev/null; then
  ok "Claude Code CLI installed"
else
  fail "Claude Code CLI not found"
  info "    Install with: npm i -g @anthropic-ai/claude-code"
fi

# 5. Build tools (for node-pty)
echo ""
echo "  Checking build tools (needed for node-pty)..."
case "$OS" in
  linux)
    if command -v gcc &> /dev/null && command -v make &> /dev/null; then
      ok "gcc + make found"
    else
      fail "Missing build tools"
      info "    sudo apt-get install -y build-essential python3-dev"
    fi
    if command -v python3 &> /dev/null; then
      ok "python3 found"
    else
      warn "python3 not found — node-pty may fail to build"
    fi
    ;;
  macos)
    if xcode-select -p &> /dev/null; then
      ok "Xcode Command Line Tools installed"
    else
      fail "Xcode Command Line Tools not installed"
      info "    Run: xcode-select --install"
    fi
    ;;
  windows)
    if command -v python &> /dev/null || command -v python3 &> /dev/null; then
      ok "Python found"
    else
      warn "Python not found — node-pty may fail. Install: winget install Python.Python.3.12"
    fi
    warn "Windows: node-pty needs Visual Studio Build Tools"
    info "    Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    info "    During install, select 'Desktop development with C++'"
    ;;
esac

# 6. Port 3096
echo ""
echo "  Checking ports..."
if command -v lsof &> /dev/null; then
  if lsof -i :3096 &> /dev/null; then
    warn "Port 3096 is already in use"
    info "    Kill it or set PORT=3097 when starting"
  else
    ok "Port 3096 available"
  fi
elif command -v netstat &> /dev/null; then
  if netstat -an 2>/dev/null | grep -q ":3096.*LISTEN"; then
    warn "Port 3096 is already in use"
  else
    ok "Port 3096 available"
  fi
fi

# 7. Disk space
echo ""
echo "  Checking disk space..."
if command -v df &> /dev/null; then
  AVAIL=$(df -h "$HOME" 2>/dev/null | tail -1 | awk '{print $4}')
  ok "Available in home: $AVAIL"
fi

# 8. Existing installs / collisions
echo ""
echo "  Checking existing state..."
if [ -d "$HOME/clawd-coding" ]; then
  warn "$HOME/clawd-coding already exists — setup will skip it"
fi
if [ -f "$HOME/CLAUDE.md" ]; then
  warn "$HOME/CLAUDE.md already exists — setup will skip it"
fi

# Summary
echo ""
echo "  ========================"
if [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}$FAIL fail${NC}  ${YELLOW}$WARN warn${NC}  ${GREEN}$PASS pass${NC}"
  echo ""
  echo -e "  ${RED}Cannot proceed.${NC} Fix the failures above and re-run."
  echo "  See TROUBLESHOOTING.md for help."
  exit 1
elif [ $WARN -gt 0 ]; then
  echo -e "  ${YELLOW}$WARN warn${NC}  ${GREEN}$PASS pass${NC}"
  echo ""
  echo -e "  ${YELLOW}You can proceed${NC} but address warnings above when convenient."
  echo "  Run: ./scripts/setup.sh"
  exit 0
else
  echo -e "  ${GREEN}All $PASS checks passed${NC}"
  echo ""
  echo -e "  ${GREEN}Ready to install.${NC} Run: ./scripts/setup.sh"
  exit 0
fi
