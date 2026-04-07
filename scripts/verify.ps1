# ClawHive Preflight Check (PowerShell)
# Run this BEFORE setup.ps1 to catch problems early.

$pass = 0
$fail = 0
$warn = 0

function Ok($msg) { Write-Host "  OK    $msg" -ForegroundColor Green; $script:pass++ }
function Failed($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red; $script:fail++ }
function Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow; $script:warn++ }
function Info($msg) { Write-Host "  INFO  $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  ClawHive Preflight Check"
Write-Host "  ========================"
Write-Host ""
Info "Detected OS: Windows"
Write-Host ""

# 1. Node.js
Write-Host "  Checking Node.js..."
try {
    $nodeVersion = (node --version 2>$null) -replace 'v', ''
    $nodeMajor = [int]($nodeVersion -split '\.')[0]
    if ($nodeMajor -ge 20) {
        Ok "Node.js $nodeVersion"
    } else {
        Failed "Node.js $nodeVersion is too old (need 20+)"
        Info "    Install with: nvm install 20; nvm use 20"
    }
} catch {
    Failed "Node.js not found"
    Info "    Install from https://nodejs.org/ (need v20+)"
}

# 2. npm
try {
    $npmVer = npm --version 2>$null
    Ok "npm $npmVer"
} catch {
    Failed "npm not found (should ship with Node)"
}

# 3. Git
try {
    $gitVer = (git --version 2>$null) -replace 'git version ', ''
    Ok "Git $gitVer"
} catch {
    Failed "Git not found"
}

# 4. Claude CLI
try {
    $null = claude --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Ok "Claude Code CLI installed"
    } else { throw }
} catch {
    Failed "Claude Code CLI not found"
    Info "    Install with: npm i -g @anthropic-ai/claude-code"
}

# 5. Build tools
Write-Host ""
Write-Host "  Checking build tools (needed for node-pty)..."

try {
    $py = python --version 2>$null
    if ($py) { Ok "Python found ($py)" } else { throw }
} catch {
    try {
        $py3 = python3 --version 2>$null
        if ($py3) { Ok "Python found ($py3)" } else { throw }
    } catch {
        Warn "Python not found — node-pty may fail to build"
        Info "    Install: winget install Python.Python.3.12"
    }
}

# Check for VS Build Tools
$vsPath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools"
$vsPath2 = "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools"
if ((Test-Path $vsPath) -or (Test-Path $vsPath2)) {
    Ok "Visual Studio Build Tools found"
} else {
    Warn "Visual Studio Build Tools not detected"
    Info "    Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    Info "    During install, select 'Desktop development with C++'"
}

# 6. Port 3096
Write-Host ""
Write-Host "  Checking ports..."
$portInUse = Get-NetTCPConnection -LocalPort 3096 -ErrorAction SilentlyContinue
if ($portInUse) {
    Warn "Port 3096 is already in use"
    Info "    Kill the process or set `$env:PORT='3097' before starting"
} else {
    Ok "Port 3096 available"
}

# 7. Disk space
Write-Host ""
Write-Host "  Checking disk space..."
try {
    $drive = Get-PSDrive -Name C
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    Ok "Available on C: ${freeGb}GB"
} catch {}

# 8. Existing installs
Write-Host ""
Write-Host "  Checking existing state..."
if (Test-Path "$env:USERPROFILE\clawd-coding") {
    Warn "$env:USERPROFILE\clawd-coding already exists — setup will skip it"
}
if (Test-Path "$env:USERPROFILE\CLAUDE.md") {
    Warn "$env:USERPROFILE\CLAUDE.md already exists — setup will skip it"
}

# Summary
Write-Host ""
Write-Host "  ========================"
if ($fail -gt 0) {
    Write-Host "  $fail fail  $warn warn  $pass pass" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Cannot proceed. Fix the failures above and re-run." -ForegroundColor Red
    Write-Host "  See TROUBLESHOOTING.md for help."
    exit 1
} elseif ($warn -gt 0) {
    Write-Host "  $warn warn  $pass pass" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  You can proceed but address warnings above when convenient." -ForegroundColor Yellow
    Write-Host "  Run: .\scripts\setup.ps1"
    exit 0
} else {
    Write-Host "  All $pass checks passed" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Ready to install. Run: .\scripts\setup.ps1" -ForegroundColor Green
    exit 0
}
