// ══════════════════════════════════════════════════════════════
//  AGENT COMMAND CENTER — Frontend Logic
// ══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────
let agents = [];
let terminals = new Map();
let currentSessionId = null;
let selectedAgentId = null;
let currentFilter = 'all';
let pinnedAgents = JSON.parse(localStorage.getItem('pinnedAgents') || '[]');
let currentSort = localStorage.getItem('agentSort') || 'name';
let viewMode = localStorage.getItem('viewMode') || 'grid';

// ── XSS Protection (#11) ────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escAttr(str) {
  return str.replace(/[&"'<>]/g, c => ({ '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── Agent categories and accent colors ────────────────────────
const agentCategories = {
  coding:      'engineering',
  auditor:     'engineering',
  researcher:  'research',
  prompter:    'research',
  social:      'social',
  designer:    'social',
  life:        'personal',
  finance:     'operations',
};

const categoryColors = {
  engineering: '#7c4dff',
  operations:  '#ff6d00',
  social:      '#ec4899',
  research:    '#00bcd4',
  personal:    '#00e676',
};

const categoryOrder = ['engineering', 'operations', 'social', 'research', 'personal'];

const categoryLabels = {
  engineering: 'Engineering & Development',
  operations:  'Operations & Business',
  social:      'Social & Marketing',
  research:    'Research & Intelligence',
  personal:    'Personal & System',
};

const agentAccentColors = {
  coding: '#7c4dff', researcher: '#00bcd4', social: '#ec4899',
  life: '#00e676', prompter: '#f59e0b', designer: '#a855f7',
  auditor: '#22c55e', finance: '#ff6d00',
};

// ── Category helper — prefer server-provided, fallback to hardcoded (#16) ──
function getCategory(agent) {
  if (agent.category) return agent.category;
  return agentCategories[agent.id] || 'personal';
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAgents();
  recoverSessions();
  setupKeyboard();
  setupFilterChips();
  setupCursorGlow();
  setupGridClicks();
  loadRecentSessions();
  document.getElementById('agent-search').addEventListener('input', filterAgents);
});

// ── Delegated click handler for agent grid (#11 XSS fix) ────────
function setupGridClicks() {
  const grid = document.getElementById('agent-grid');

  grid.addEventListener('click', (e) => {
    // Pin button (#2)
    const pinBtn = e.target.closest('.pin-btn[data-pin]');
    if (pinBtn) {
      e.stopPropagation();
      togglePin(pinBtn.dataset.pin);
      return;
    }
    // Quick-launch topic chip (#4)
    const chip = e.target.closest('.topic-chip[data-topic]');
    if (chip) {
      e.stopPropagation();
      launchAgent(chip.dataset.agent, chip.dataset.topic);
      return;
    }
    // Agent card click
    const card = e.target.closest('.agent-card[data-agent]');
    if (card) onAgentClick(card.dataset.agent);
  });

  // Long-press / double-click opens detail panel (#3)
  grid.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.agent-card[data-agent]');
    if (card) {
      e.preventDefault();
      showDetailPanel(card.dataset.agent);
    }
  });
}

// ── Cursor glow on agent cards ──────────────────────────────────
function setupCursorGlow() {
  document.getElementById('agent-grid').addEventListener('mousemove', (e) => {
    const card = e.target.closest('.agent-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    card.style.setProperty('--my', `${e.clientY - rect.top}px`);
  });
}

// ── Keyboard shortcuts ─────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // '/' focuses search
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      document.getElementById('agent-search').focus();
    }
    // Escape: back to dashboard or blur search
    if (e.key === 'Escape') {
      if (document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
      } else if (currentSessionId) {
        showDashboard();
      }
    }
    // Ctrl+1-8: switch session tabs
    if (e.ctrlKey && e.key >= '1' && e.key <= '8') {
      const idx = parseInt(e.key) - 1;
      const sessionIds = [...terminals.keys()];
      if (idx < sessionIds.length) {
        e.preventDefault();
        switchToSession(sessionIds[idx]);
      }
    }
    // '?' opens keyboard shortcuts overlay (#9)
    if (e.key === '?' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      toggleShortcutsOverlay();
    }
  });
}

// ── Filter chips ───────────────────────────────────────────────
function setupFilterChips() {
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderAgentGrid(agents);
    });
  });
}

// ── Recover sessions on page load ──────────────────────────────
async function recoverSessions() {
  try {
    const res = await fetch('/api/sessions');
    const serverSessions = await res.json();
    for (const s of serverSessions) {
      if (s.alive && !terminals.has(s.id)) {
        await new Promise(r => setTimeout(r, 300));
        createTerminal(s.id, s.agentId, s.topic);
      }
    }
  } catch {}
}

// ── Load Agents ────────────────────────────────────────────────
async function loadAgents() {
  try {
    const res = await fetch('/api/agents');
    agents = await res.json();
    // Hide skeleton, show grid
    document.getElementById('skeleton-grid').style.display = 'none';
    const grid = document.getElementById('agent-grid');
    grid.style.display = '';
    buildDynamicChips();
    renderAgentGrid(agents);
    updateSessionCount();
    updateStatsBar();
  } catch (err) {
    console.error('Failed to load agents:', err);
  }
}

function filterAgents(e) {
  const q = e.target.value.toLowerCase();
  const filtered = agents.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.id.toLowerCase().includes(q) ||
    a.role.toLowerCase().includes(q) ||
    a.vibe.toLowerCase().includes(q)
  );
  renderAgentGrid(filtered);
}

// ── Render Agent Grid with Categories ──────────────────────────
function renderAgentGrid(agentList) {
  const grid = document.getElementById('agent-grid');

  // Apply category filter
  let filtered = agentList;
  if (currentFilter === 'active') {
    filtered = agentList.filter(a => a.hasActiveSession);
  } else if (currentFilter === 'pinned') {
    filtered = agentList.filter(a => isPinned(a.id));
  } else if (currentFilter !== 'all') {
    filtered = agentList.filter(a => getCategory(a) === currentFilter);
  }

  // Sort pinned agents first, then by chosen sort (#19)
  filtered = [...filtered].sort((a, b) => {
    const ap = isPinned(a.id) ? 0 : 1;
    const bp = isPinned(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if (currentSort === 'topics') return b.topics.length - a.topics.length;
    if (currentSort === 'category') return getCategory(a).localeCompare(getCategory(b));
    return a.name.localeCompare(b.name);
  });

  // Group by category
  const groups = {};
  for (const cat of categoryOrder) groups[cat] = [];
  for (const agent of filtered) {
    const cat = getCategory(agent);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(agent);
  }

  let html = '';
  let totalRendered = 0;
  for (const cat of categoryOrder) {
    const group = groups[cat];
    if (!group || group.length === 0) continue;

    const catColor = categoryColors[cat] || '#7c4dff';

    // Category header
    html += `
      <div class="category-header">
        <span class="category-label" style="color:${escAttr(catColor)}">${esc(categoryLabels[cat] || cat)}</span>
        <div class="category-line" style="background:linear-gradient(to right, ${escAttr(catColor)}30, transparent)"></div>
      </div>
    `;

    // Agent cards
    for (const agent of group) {
      const accent = agent.color || agentAccentColors[agent.id] || catColor;
      const topicChips = agent.topics.slice(0, 3).map(t =>
        `<span class="topic-chip" data-topic="${escAttr(t)}" data-agent="${escAttr(agent.id)}">${esc(t)}</span>`
      ).join('');
      const moreTopics = agent.topics.length > 3
        ? `<span class="topic-chip">+${agent.topics.length - 3}</span>` : '';

      const pinned = isPinned(agent.id);
      html += `
        <div class="agent-card ${agent.hasActiveSession ? 'has-session' : ''} ${pinned ? 'is-pinned' : ''}"
             style="--card-accent:${escAttr(accent)}; --card-glow:${escAttr(accent)}30"
             data-agent="${escAttr(agent.id)}">
          <div class="card-top">
            <span class="agent-emoji">${esc(agent.emoji)}</span>
            <div class="status-indicator ${agent.hasActiveSession ? 'active' : ''}"></div>
          </div>
          <button class="pin-btn ${pinned ? 'pinned' : ''}" data-pin="${escAttr(agent.id)}" title="${pinned ? 'Unpin' : 'Pin to top'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>
          <div class="card-body">
            <div class="agent-name">${esc(agent.name)}</div>
            <div class="agent-role">${esc(agent.role)}</div>
            ${agent.vibe ? `<div class="agent-vibe">${esc(agent.vibe)}</div>` : ''}
            ${agent.topics.length > 0 ? `<div class="agent-topics">${topicChips}${moreTopics}</div>` : ''}
          </div>
        </div>
      `;
      totalRendered++;
    }
  }

  // Empty state (#5)
  if (totalRendered === 0) {
    if (agentList.length === 0) {
      html = `<div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No agents found</div>
        <div class="empty-text">Check that agent workspaces exist at ~/clawd-*/IDENTITY.md</div>
      </div>`;
    } else {
      html = `<div class="empty-state">
        <div class="empty-icon">🫥</div>
        <div class="empty-title">No matching agents</div>
        <div class="empty-text">Try a different filter or search term</div>
      </div>`;
    }
  }

  grid.innerHTML = html;
}

// ── Agent Click Handler ────────────────────────────────────────
function onAgentClick(agentId) {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;
  if (agent.topics.length > 0) {
    showTopicModal(agent);
  } else {
    launchAgent(agentId);
  }
}

// ── Topic Modal ────────────────────────────────────────────────
function showTopicModal(agent) {
  selectedAgentId = agent.id;
  document.getElementById('topic-modal-title').textContent = `${agent.emoji} ${agent.name}`;
  const list = document.getElementById('topic-list');
  list.innerHTML = '';
  for (const t of agent.topics) {
    const btn = document.createElement('button');
    btn.className = 'topic-btn';
    btn.textContent = t;
    btn.addEventListener('click', () => launchAgent(agent.id, t));
    list.appendChild(btn);
  }
  document.getElementById('topic-modal').classList.add('open');
}

function closeTopicModal(e) {
  document.getElementById('topic-modal').classList.remove('open');
}

// ── Launch Agent Session ───────────────────────────────────────
let launching = false;
async function launchAgent(agentId, topic, initialPrompt) {
  if (launching) return; // Prevent double-click
  document.getElementById('topic-modal').classList.remove('open');
  const sessionId = topic ? `${agentId}:${topic}` : agentId;

  if (terminals.has(sessionId)) {
    switchToSession(sessionId);
    return;
  }

  launching = true;
  showToast('Launching session...', 'info');
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, topic, cols: 120, rows: 30, initialPrompt }),
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Failed to create session', 'error');
      return;
    }

    const data = await res.json();
    createTerminal(data.id, agentId, topic);
    switchToSession(data.id);
    const agent = agents.find(a => a.id === agentId);
    showToast(`${agent?.emoji || '🤖'} ${agent?.name || agentId} started${topic ? ` (${topic})` : ''}`, 'success');
  } catch (err) {
    console.error('Failed to launch agent:', err);
    showToast('Failed to launch session', 'error');
  } finally {
    launching = false;
  }
}

// ── Terminal Management ────────────────────────────────────────
function createTerminal(sessionId, agentId, topic) {
  const agent = agents.find(a => a.id === agentId) || { name: agentId, emoji: '🤖' };
  const accent = agent.color || agentAccentColors[agentId] || '#7c4dff';

  const terminal = new window.Terminal({
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: 14,
    lineHeight: 1.3,
    theme: {
      background: '#06060e',
      foreground: '#e0e0f0',
      cursor: accent,
      cursorAccent: '#06060e',
      selectionBackground: `${accent}40`,
      black: '#1a1a2e', brightBlack: '#4a4a6e',
      red: '#ff5555', brightRed: '#ff6e6e',
      green: '#50fa7b', brightGreen: '#69ff94',
      yellow: '#f1fa8c', brightYellow: '#ffffa5',
      blue: '#7c4dff', brightBlue: '#a78bff',
      magenta: '#ff79c6', brightMagenta: '#ff92df',
      cyan: '#8be9fd', brightCyan: '#a4ffff',
      white: '#f8f8f2', brightWhite: '#ffffff',
    },
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fitAddon = new window.FitAddon.FitAddon();
  const searchAddon = window.SearchAddon ? new window.SearchAddon.SearchAddon() : null;
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new window.WebLinksAddon.WebLinksAddon());
  if (searchAddon) terminal.loadAddon(searchAddon);

  // WebSocket with auto-reconnect
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionId)}`;
  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let intentionallyClosed = false;

  function connectWs() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempts = 0;
      setTimeout(() => {
        fitAddon.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }, 100);
    };

    ws.onmessage = (e) => {
      try {
        const ctrl = JSON.parse(e.data);
        if (ctrl.type === 'session_ended') {
          const e2 = terminals.get(sessionId);
          sendNotification('Session Ended', `${e2?.agent?.name || sessionId} session finished`);
          return;
        }
        if (ctrl.type === 'idle_timeout') {
          showToast('Session timed out due to inactivity', 'warning');
          sendNotification('Session Timeout', `${sessionId} was idle too long`);
          return;
        }
        if (ctrl.type === 'idle_warning') {
          showToast('Session will timeout in 5 minutes', 'warning');
          return;
        }
        if (ctrl.type === 'server_shutdown') {
          showToast('Server shutting down...', 'warning');
          return;
        }
      } catch {}
      terminal.write(e.data);
      // Track last data time for status indicator (#6)
      const entry = terminals.get(sessionId);
      if (entry) entry.lastDataTime = Date.now();
    };

    ws.onclose = () => {
      if (intentionallyClosed) return;
      if (reconnectAttempts < 15) {
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
        reconnectAttempts++;
        terminal.write(`\r\n\x1b[90m[Reconnecting... ${reconnectAttempts}/15]\x1b[0m\r\n`);
        reconnectTimer = setTimeout(() => {
          connectWs();
          const entry = terminals.get(sessionId);
          if (entry) entry.ws = ws;
        }, delay);
      } else {
        terminal.write('\r\n\x1b[31m[Connection lost. Click agent to reconnect.]\x1b[0m\r\n');
      }
    };
  }

  connectWs();

  terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  });

  terminals.set(sessionId, {
    terminal, fitAddon, searchAddon, ws, agent, topic, resizeObserver, accent,
    lastDataTime: Date.now(),
    autoScroll: true,
    intentionallyClosed: () => { intentionallyClosed = true; },
    clearReconnect: () => { if (reconnectTimer) clearTimeout(reconnectTimer); },
  });

  addSessionTab(sessionId, agent, topic, accent);
  updateSessionCount();
  loadAgents(); // Refresh active status
}

function switchToSession(sessionId) {
  const entry = terminals.get(sessionId);
  if (!entry) return;

  currentSessionId = sessionId;

  // Breadcrumbs (#10)
  document.getElementById('breadcrumb-agent').textContent = `${entry.agent.emoji} ${entry.agent.name}`;
  const topicSep = document.getElementById('breadcrumb-topic-sep');
  const topicBc = document.getElementById('breadcrumb-topic');
  if (entry.topic) {
    topicSep.style.display = '';
    topicBc.style.display = '';
    topicBc.textContent = entry.topic;
  } else {
    topicSep.style.display = 'none';
    topicBc.style.display = 'none';
  }

  // Set accent color on terminal header
  const accent = entry.accent || '#7c4dff';
  document.getElementById('terminal-header-bar').style.borderBottomColor = accent + '40';

  document.getElementById('dashboard-view').classList.remove('active');
  document.getElementById('terminal-view').classList.add('active');

  const container = document.getElementById('terminal-container');

  // Hide all terminal wrappers, show only the active one
  for (const child of container.children) {
    child.style.display = 'none';
  }

  // Create a persistent wrapper for this terminal if it doesn't exist
  let wrapper = container.querySelector(`[data-terminal="${CSS.escape(sessionId)}"]`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.dataset.terminal = sessionId;
    wrapper.style.cssText = 'width:100%;height:100%';
    container.appendChild(wrapper);
    entry.terminal.open(wrapper);
  }
  wrapper.style.display = '';

  entry.fitAddon.fit();
  entry.resizeObserver.observe(wrapper);
  entry.terminal.focus();

  document.querySelectorAll('.session-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.session === sessionId);
  });
}

// ── Session Tabs ───────────────────────────────────────────────
function addSessionTab(sessionId, agent, topic, accent) {
  const tabs = document.getElementById('session-tabs');
  const tab = document.createElement('button');
  tab.className = 'session-tab';
  tab.dataset.session = sessionId;
  tab.dataset.startTime = Date.now();
  if (accent) tab.style.borderLeftColor = accent;

  // Status dot (#6) + emoji + name + timer (#7) + close button
  const statusDot = document.createElement('span');
  statusDot.className = 'tab-status active';
  tab.appendChild(statusDot);

  const emojiSpan = document.createElement('span');
  emojiSpan.className = 'tab-emoji';
  emojiSpan.textContent = agent.emoji;
  tab.appendChild(emojiSpan);

  const nameSpan = document.createElement('span');
  nameSpan.textContent = agent.name + (topic ? `: ${topic}` : '');
  tab.appendChild(nameSpan);

  const timerSpan = document.createElement('span');
  timerSpan.className = 'tab-timer';
  timerSpan.textContent = '0m';
  tab.appendChild(timerSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.innerHTML = '&#215;';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeSession(sessionId); });
  tab.appendChild(closeBtn);

  tab.addEventListener('click', () => switchToSession(sessionId));
  tabs.appendChild(tab);
}

function removeSessionTab(sessionId) {
  const tab = document.querySelector(`.session-tab[data-session="${CSS.escape(sessionId)}"]`);
  if (tab) tab.remove();
}

// ── Session Timer Update (#7) — runs every 30s ──────────────────
setInterval(() => {
  document.querySelectorAll('.session-tab').forEach(tab => {
    const start = parseInt(tab.dataset.startTime);
    if (!start) return;
    const mins = Math.floor((Date.now() - start) / 60000);
    const timer = tab.querySelector('.tab-timer');
    if (timer) timer.textContent = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60}m`;
  });
}, 30000);

// ── Session Status Update (#6) — check I/O activity ─────────────
setInterval(() => {
  for (const [sid, entry] of terminals) {
    const tab = document.querySelector(`.session-tab[data-session="${CSS.escape(sid)}"]`);
    if (!tab) continue;
    const dot = tab.querySelector('.tab-status');
    if (!dot) continue;
    if (!entry.ws || entry.ws.readyState !== WebSocket.OPEN) {
      dot.className = 'tab-status disconnected';
    } else if (entry.lastDataTime && Date.now() - entry.lastDataTime < 30000) {
      dot.className = 'tab-status active';
    } else {
      dot.className = 'tab-status idle';
    }
  }
}, 5000);

// ── Shortcuts Overlay (#9) ──────────────────────────────────────
function toggleShortcutsOverlay() {
  const overlay = document.getElementById('shortcuts-overlay');
  overlay.classList.toggle('open');
}

// ── File Upload to Terminal (B4 #6) ─────────────────────────────
async function uploadFileToSession(file) {
  if (!currentSessionId) { showToast('No active session', 'warning'); return; }
  const entry = terminals.get(currentSessionId);
  if (!entry) return;
  if (file.size > 10 * 1024 * 1024) { showToast('File too large (>10MB)', 'error'); return; }

  showToast(`Uploading ${file.name}...`, 'info');
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch(`/api/agents/${encodeURIComponent(entry.agent.id)}/upload?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    const data = await res.json();
    if (res.ok) {
      // Send the file path to the terminal so the agent can read it
      if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(`Please read this file: ${data.path}\n`);
      }
      showToast(`Uploaded: ${file.name}`, 'success');
    } else {
      showToast(`Upload failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Upload error: ${err.message}`, 'error');
  }
}

// Drag and drop on terminal container
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('terminal-container');
  if (!container) return;
  container.addEventListener('dragover', (e) => { e.preventDefault(); container.style.outline = '2px dashed var(--accent)'; });
  container.addEventListener('dragleave', () => { container.style.outline = ''; });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.style.outline = '';
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) uploadFileToSession(f);
  });
});

// ── Voice Input (B4 #9) ─────────────────────────────────────────
let voiceRecognition = null;
let voiceRecording = false;

function setupVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  voiceRecognition = new SR();
  voiceRecognition.lang = 'en-US';
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = false;
  voiceRecognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    if (currentSessionId) {
      const entry = terminals.get(currentSessionId);
      if (entry?.ws?.readyState === WebSocket.OPEN) {
        entry.ws.send(text + '\n');
        showToast(`Voice: "${text}"`, 'success');
      }
    }
  };
  voiceRecognition.onerror = (e) => {
    showToast(`Voice error: ${e.error}`, 'error');
    voiceRecording = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
  };
  voiceRecognition.onend = () => {
    voiceRecording = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
  };
  return true;
}

function toggleVoiceInput() {
  if (!voiceRecognition && !setupVoiceInput()) {
    showToast('Speech recognition not supported in this browser', 'error');
    return;
  }
  if (voiceRecording) {
    voiceRecognition.stop();
    voiceRecording = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
  } else {
    try {
      voiceRecognition.start();
      voiceRecording = true;
      document.getElementById('voice-btn')?.classList.add('recording');
      showToast('Listening... speak now', 'info');
    } catch {}
  }
}

// ── Skill Execution (B4 #11) ────────────────────────────────────
let executingSkill = null;

function openSkillExec(skillId, skillName) {
  executingSkill = { id: skillId, name: skillName };
  document.getElementById('skillexec-title').textContent = `Run: ${skillName}`;
  document.getElementById('skillexec-args').value = '';
  document.getElementById('skillexec-output').textContent = '';
  document.getElementById('skillexec-output').style.display = 'none';
  document.getElementById('skillexec-overlay').classList.add('open');
  setTimeout(() => document.getElementById('skillexec-args').focus(), 100);
}

function closeSkillExec() {
  document.getElementById('skillexec-overlay').classList.remove('open');
  executingSkill = null;
}

async function runSkill() {
  if (!executingSkill) return;
  const args = document.getElementById('skillexec-args').value;
  const out = document.getElementById('skillexec-output');
  const btn = document.getElementById('skillexec-run');
  btn.disabled = true;
  btn.textContent = 'Running...';
  out.style.display = '';
  out.textContent = 'Executing skill...';
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(executingSkill.id)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    const data = await res.json();
    out.textContent = data.output || data.error || '(no output)';
  } catch (err) {
    out.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Skill';
  }
}

// ── Session Share (B4 #12) ──────────────────────────────────────
async function shareCurrentSession() {
  if (!currentSessionId) { showToast('No active session', 'warning'); return; }
  const entry = terminals.get(currentSessionId);
  if (!entry) return;

  // Capture terminal scrollback
  let content = '';
  const buf = entry.terminal.buffer.active;
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) content += line.translateToString(true) + '\n';
  }

  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: entry.agent.id, topic: entry.topic, content }),
    });
    const data = await res.json();
    const url = window.location.origin + data.url;
    await navigator.clipboard?.writeText(url);
    showToast(`Share link copied: ${url}`, 'success');
  } catch (err) {
    showToast(`Share failed: ${err.message}`, 'error');
  }
}

// ── Today's Digest (B4 #5) ──────────────────────────────────────
async function openDigest() {
  document.getElementById('digest-overlay').classList.add('open');
  document.getElementById('digest-content').innerHTML = '<div style="color:var(--text-dim);font-size:12px">Loading...</div>';
  try {
    const res = await fetch('/api/digest/today');
    const d = await res.json();
    document.getElementById('digest-date').textContent = new Date(d.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const stats = `
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
        <div style="padding:14px;background:var(--bg-surface);border-radius:var(--radius-sm);border-left:3px solid var(--accent)">
          <div style="font-size:24px;font-weight:700;color:var(--text)">${d.sessions}</div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Sessions</div>
        </div>
        <div style="padding:14px;background:var(--bg-surface);border-radius:var(--radius-sm);border-left:3px solid var(--success)">
          <div style="font-size:24px;font-weight:700;color:var(--text)">${d.agentsUsed.length}</div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Agents Used</div>
        </div>
        <div style="padding:14px;background:var(--bg-surface);border-radius:var(--radius-sm);border-left:3px solid var(--warning)">
          <div style="font-size:24px;font-weight:700;color:var(--text)">${d.memoryUpdates}</div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Memory Updates</div>
        </div>
        <div style="padding:14px;background:var(--bg-surface);border-radius:var(--radius-sm);border-left:3px solid #ec4899">
          <div style="font-size:24px;font-weight:700;color:var(--text)">${d.topicsCreated}</div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Topics Created</div>
        </div>
      </div>
    `;
    const events = d.events.length > 0
      ? `<div><div class="detail-label" style="margin-bottom:6px">Recent events</div>
          ${d.events.slice(0, 8).map(e => `<div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--border);color:var(--text-secondary)">${esc(e.message)}</div>`).join('')}
        </div>`
      : '<div style="text-align:center;color:var(--text-dim);font-size:12px;padding:20px">No activity yet today</div>';

    document.getElementById('digest-content').innerHTML = stats + events;
  } catch {
    document.getElementById('digest-content').innerHTML = '<div style="color:var(--danger)">Failed to load digest</div>';
  }
}

function closeDigest() {
  document.getElementById('digest-overlay').classList.remove('open');
}

// ── Session History Search (B4 #2) ──────────────────────────────
function openHistorySearch() {
  document.getElementById('history-search-overlay').classList.add('open');
  document.getElementById('history-search-input').value = '';
  document.getElementById('history-search-results').innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim)">Type to search across all session logs</div>';
  setTimeout(() => document.getElementById('history-search-input').focus(), 100);
}

function closeHistorySearch() {
  document.getElementById('history-search-overlay').classList.remove('open');
}

let historySearchTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('history-search-input')?.addEventListener('input', (e) => {
    if (historySearchTimer) clearTimeout(historySearchTimer);
    const q = e.target.value.trim();
    if (!q) {
      document.getElementById('history-search-results').innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim)">Type to search</div>';
      return;
    }
    historySearchTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/history/search?q=' + encodeURIComponent(q));
        const data = await res.json();
        const container = document.getElementById('history-search-results');
        if (data.length === 0) {
          container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim)">No matches</div>';
          return;
        }
        container.innerHTML = '';
        for (const r of data) {
          const agent = agents.find(a => a.id === r.agentId);
          const card = document.createElement('div');
          card.className = 'topic-card';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'flex-start';
          card.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;width:100%">
              <span style="font-size:16px">${esc(agent?.emoji || '🤖')}</span>
              <span class="topic-card-name">${esc(agent?.name || r.agentId)}${r.topic ? ': ' + esc(r.topic) : ''}</span>
              <span class="topic-card-time">${r.matchCount} matches</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-top:6px;line-height:1.5">${esc(r.snippet)}</div>
          `;
          container.appendChild(card);
        }
      } catch {}
    }, 250);
  });
});

// ── Settings Panel (B3 #20) ─────────────────────────────────────
async function openSettings() {
  document.getElementById('settings-notifications').checked = notificationsEnabled;
  document.getElementById('settings-accent').value = localStorage.getItem('customAccent') || '#7c4dff';
  document.getElementById('settings-overlay').classList.add('open');

  // Load webhooks
  try {
    const res = await fetch('/api/webhooks/outgoing');
    const urls = await res.json();
    document.getElementById('settings-webhooks').value = urls.join('\n');
  } catch {}

  // Load webhook secret
  try {
    const res = await fetch('/api/webhooks/secret');
    const data = await res.json();
    document.getElementById('settings-webhook-secret').textContent = data.secret;
  } catch {}
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}
function toggleNotifications(enabled) {
  notificationsEnabled = enabled;
  localStorage.setItem('notifications', String(enabled));
  if (enabled) requestNotifications();
}

// Theme Customizer (B4 #16)
function setCustomAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-soft', color + '26');
  document.documentElement.style.setProperty('--accent-glow', color + '66');
  localStorage.setItem('customAccent', color);
}
function resetCustomAccent() {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-soft');
  document.documentElement.style.removeProperty('--accent-glow');
  localStorage.removeItem('customAccent');
  document.getElementById('settings-accent').value = '#7c4dff';
}
// Apply on load
const savedAccent = localStorage.getItem('customAccent');
if (savedAccent) setCustomAccent(savedAccent);

async function saveWebhooks() {
  const text = document.getElementById('settings-webhooks').value;
  const urls = text.split('\n').map(u => u.trim()).filter(u => u);
  try {
    await fetch('/api/webhooks/outgoing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    showToast('Webhooks saved', 'success');
  } catch {
    showToast('Save failed', 'error');
  }
}

// ── Onboarding Tour (B3 #13) ────────────────────────────────────
const tourSteps = [
  { title: 'Welcome to Command Center', text: 'Manage all your AI agents from one place. Let me show you around in 5 quick steps.' },
  { title: 'Launch any agent', text: 'Click any agent card to start a session. Right-click for more options like Quick Chat or workspace inspection.' },
  { title: 'Command Palette', text: 'Press Ctrl+K (or Cmd+K) anywhere to fuzzy-search agents, topics, and commands. The fastest way to navigate.' },
  { title: 'Inspect & manage', text: 'Use the header buttons to browse Topics, Skills, Activity Feed, and Settings. Right-click an agent → Inspect Workspace to peek inside.' },
  { title: 'Themes & shortcuts', text: 'Cycle themes with the moon button. Press ? anytime to see all keyboard shortcuts. Have fun!' },
];
let currentTourStep = 0;

function startTour() {
  currentTourStep = 0;
  showTourStep();
  document.getElementById('tour-overlay').classList.add('open');
}

function showTourStep() {
  const step = tourSteps[currentTourStep];
  document.getElementById('tour-step-num').textContent = `Step ${currentTourStep + 1} of ${tourSteps.length}`;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-text').textContent = step.text;
  document.getElementById('tour-next').textContent = currentTourStep === tourSteps.length - 1 ? 'Finish' : 'Next';
}

function nextTourStep() {
  if (currentTourStep < tourSteps.length - 1) {
    currentTourStep++;
    showTourStep();
  } else {
    skipTour();
  }
}

function skipTour() {
  document.getElementById('tour-overlay').classList.remove('open');
  localStorage.setItem('tourCompleted', 'true');
}

// Show tour on first visit
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem('tourCompleted')) {
    setTimeout(startTour, 1500);
  }
});

// ── Quick Chat (B3 #7) ──────────────────────────────────────────
let quickChatAgent = null;

function openQuickChat(agentId) {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;
  quickChatAgent = agent;
  document.getElementById('quickchat-title').textContent = `${agent.emoji} Quick Chat: ${agent.name}`;
  document.getElementById('quickchat-input').value = '';
  document.getElementById('quickchat-response').style.display = 'none';
  document.getElementById('quickchat-response').textContent = '';
  document.getElementById('quickchat-send').disabled = false;
  document.getElementById('quickchat-overlay').classList.add('open');
  setTimeout(() => document.getElementById('quickchat-input').focus(), 100);
}

// Multi-Agent Broadcast (B3 #17)
function openBroadcast() {
  // Use pinned agents if any, otherwise prompt
  const targets = pinnedAgents.length > 0
    ? agents.filter(a => pinnedAgents.includes(a.id))
    : agents.slice(0, 3); // first 3 if nothing pinned
  if (targets.length === 0) {
    showToast('No agents to broadcast to', 'warning');
    return;
  }
  quickChatAgent = { id: '*broadcast*', name: `Broadcast to ${targets.length} agents`, emoji: '📡', targets };
  document.getElementById('quickchat-title').textContent = `📡 Broadcast: ${targets.map(t => t.name).join(', ')}`;
  document.getElementById('quickchat-input').value = '';
  document.getElementById('quickchat-response').style.display = 'none';
  document.getElementById('quickchat-response').textContent = '';
  document.getElementById('quickchat-send').disabled = false;
  document.getElementById('quickchat-overlay').classList.add('open');
  setTimeout(() => document.getElementById('quickchat-input').focus(), 100);
}

function closeQuickChat() {
  document.getElementById('quickchat-overlay').classList.remove('open');
  quickChatAgent = null;
}

async function sendQuickChat() {
  if (!quickChatAgent) return;
  const prompt = document.getElementById('quickchat-input').value.trim();
  if (!prompt) return;
  const sendBtn = document.getElementById('quickchat-send');
  const responseEl = document.getElementById('quickchat-response');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Thinking...';
  responseEl.style.display = '';
  responseEl.textContent = 'Booting agent and waiting for response...\n(this can take 30-60 seconds for the first run)';

  // Multi-agent broadcast (B3 #17): if quickChatAgent is "*broadcast*"
  if (quickChatAgent.id === '*broadcast*') {
    const targets = quickChatAgent.targets || [];
    let combined = '';
    for (const target of targets) {
      combined += `\n=== ${target.emoji} ${target.name} ===\n`;
      try {
        const res = await fetch('/api/quickchat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: target.id, prompt }),
        });
        const data = await res.json();
        combined += (res.ok ? data.response : `Error: ${data.error}`) + '\n';
      } catch (err) {
        combined += `Network error: ${err.message}\n`;
      }
      responseEl.textContent = combined;
    }
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    return;
  }

  try {
    const res = await fetch('/api/quickchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: quickChatAgent.id, prompt }),
    });
    const data = await res.json();
    if (res.ok) {
      responseEl.textContent = data.response || '(empty response)';
    } else {
      responseEl.textContent = `Error: ${data.error || 'unknown'}`;
    }
  } catch (err) {
    responseEl.textContent = `Network error: ${err.message}`;
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  }
}

// ── Session Pin (B3 #10) ────────────────────────────────────────
async function toggleSessionPin(sessionId) {
  try {
    const entry = terminals.get(sessionId);
    if (!entry) return;
    const isPinnedNow = entry.pinned;
    const method = isPinnedNow ? 'DELETE' : 'POST';
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/pin`, { method });
    entry.pinned = !isPinnedNow;
    showToast(isPinnedNow ? 'Session unpinned' : 'Session pinned (no idle timeout)', 'info');
  } catch {}
}

// ── Bulk Operations (B3 #9) ─────────────────────────────────────
async function killAllSessions(idleOnly = false) {
  if (!confirm(idleOnly ? 'Kill all idle sessions?' : 'Kill ALL sessions?')) return;
  try {
    const res = await fetch('/api/sessions/kill-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idleOnly }),
    });
    const data = await res.json();
    showToast(`Killed ${data.killed} sessions`, 'success');
    // Close all local terminals
    for (const [sid, entry] of terminals) {
      if (entry.intentionallyClosed) entry.intentionallyClosed();
      if (entry.ws) entry.ws.close();
      if (entry.terminal) entry.terminal.dispose();
      removeSessionTab(sid);
    }
    terminals.clear();
    updateSessionCount();
    showDashboard();
  } catch {
    showToast('Bulk kill failed', 'error');
  }
}

// ── Quick Resume Last Session (B3 #11) ──────────────────────────
let lastClosedSession = null;
let lastClosedAt = 0;

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
    e.preventDefault();
    if (lastClosedSession) {
      launchAgent(lastClosedSession.agentId, lastClosedSession.topic);
      showToast('Resuming last session', 'info');
    } else {
      showToast('No recent session to resume', 'info');
    }
  }
  // Global Undo (B4 #14) — Ctrl+Z restores last killed within 30s
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    if (lastClosedSession && Date.now() - lastClosedAt < 30_000) {
      e.preventDefault();
      launchAgent(lastClosedSession.agentId, lastClosedSession.topic);
      showToast('Undo: session restored', 'success');
      lastClosedSession = null;
    }
  }
});

// ── Topic Browser (B3 #4) ───────────────────────────────────────
let allTopics = [];

async function openTopics() {
  document.getElementById('topics-overlay').classList.add('open');
  try {
    const res = await fetch('/api/topics');
    allTopics = await res.json();
    document.getElementById('topics-count').textContent = `${allTopics.length} TOPICS`;
    renderTopics(allTopics);
  } catch {
    showToast('Failed to load topics', 'error');
  }
}

function closeTopics() {
  document.getElementById('topics-overlay').classList.remove('open');
}

function renderTopics(list) {
  const container = document.getElementById('topics-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">No topics found</div>';
    return;
  }
  for (const t of list) {
    const agent = agents.find(a => a.id === t.agentId);
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.innerHTML = `
      <span style="font-size:18px">${esc(agent?.emoji || '📂')}</span>
      <div>
        <div class="topic-card-name">${esc(t.name)}</div>
        <div class="topic-card-agent">${esc(agent?.name || t.agentId)}</div>
      </div>
      <div class="topic-card-time">${t.lastUpdated ? new Date(t.lastUpdated).toLocaleDateString() : ''}</div>
    `;
    card.addEventListener('click', () => {
      closeTopics();
      launchAgent(t.agentId, t.name);
    });
    container.appendChild(card);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('topics-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderTopics(allTopics.filter(t => t.name.toLowerCase().includes(q) || t.agentId.toLowerCase().includes(q)));
  });
});

// ── Skills Catalog (B3 #5) ──────────────────────────────────────
let allSkills = [];

async function openSkills() {
  document.getElementById('skills-overlay').classList.add('open');
  try {
    const res = await fetch('/api/skills');
    allSkills = await res.json();
    document.getElementById('skills-count').textContent = `${allSkills.length} SKILLS`;
    renderSkills(allSkills);
  } catch {
    showToast('Failed to load skills', 'error');
  }
}

function closeSkills() {
  document.getElementById('skills-overlay').classList.remove('open');
}

function renderSkills(list) {
  const container = document.getElementById('skills-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-dim)">No skills found</div>';
    return;
  }
  for (const s of list) {
    const el = document.createElement('div');
    el.className = 'inspector-list-item';
    el.style.justifyContent = 'space-between';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = s.name;
    nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis';
    el.appendChild(nameSpan);
    el.title = s.description || '';
    if (s.hasScripts) {
      const runBtn = document.createElement('button');
      runBtn.textContent = 'Run';
      runBtn.style.cssText = 'background:var(--accent-soft);border:1px solid var(--border-active);color:var(--accent);padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px;font-family:var(--font-mono)';
      runBtn.addEventListener('click', (e) => { e.stopPropagation(); openSkillExec(s.id, s.name); });
      el.appendChild(runBtn);
    }
    el.addEventListener('click', async () => {
      document.querySelectorAll('#skills-list .inspector-list-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      document.getElementById('skills-current').textContent = s.name;
      try {
        const r = await fetch(`/api/skills/${encodeURIComponent(s.id)}`);
        const text = await r.text();
        document.getElementById('skills-view').textContent = text;
      } catch {
        document.getElementById('skills-view').textContent = '(Failed to load)';
      }
    });
    container.appendChild(el);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('skills-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderSkills(allSkills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
    ));
  });
});

// ── Activity Feed (B3 #6) ───────────────────────────────────────
let activityWs = null;
let activityCache = [];

function toggleActivityFeed() {
  const feed = document.getElementById('activity-feed');
  if (feed.classList.contains('open')) {
    feed.classList.remove('open');
  } else {
    feed.classList.add('open');
    if (!activityWs) connectActivityWs();
  }
}

function connectActivityWs() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    activityWs = new WebSocket(`${proto}//${window.location.host}/ws/events`);
    activityWs.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'activity_snapshot') {
          activityCache = event.data;
          renderActivity();
        } else if (event.type === 'activity') {
          activityCache.unshift(event.data);
          if (activityCache.length > 100) activityCache.length = 100;
          renderActivity();
        }
      } catch {}
    };
    activityWs.onclose = () => { activityWs = null; };
  } catch {
    showToast('Failed to connect to activity feed', 'error');
  }
}

function renderActivity() {
  const list = document.getElementById('activity-list');
  if (!list) return;
  if (activityCache.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px">No activity yet</div>';
    return;
  }
  list.innerHTML = '';
  for (const e of activityCache) {
    const div = document.createElement('div');
    div.className = `activity-item ${esc(e.type)}`;
    div.innerHTML = `
      <div class="activity-msg">${esc(e.message)}</div>
      <div class="activity-time">${new Date(e.timestamp).toLocaleTimeString()}</div>
    `;
    list.appendChild(div);
  }
}

// ── Workspace Inspector (B3 #1, #2, #3) ─────────────────────────
let inspectorAgent = null;
let inspectorSection = 'files';
let inspectorCurrentFile = null;
let inspectorEditing = false;

async function openInspector(agentId) {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;
  inspectorAgent = agent;
  inspectorSection = 'files';
  inspectorCurrentFile = null;
  inspectorEditing = false;

  document.getElementById('inspector-emoji').textContent = agent.emoji;
  document.getElementById('inspector-name').textContent = agent.name;
  document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.section === 'files'));
  document.getElementById('inspector-overlay').classList.add('open');
  await inspectorLoadList();
}

function closeInspector() {
  document.getElementById('inspector-overlay').classList.remove('open');
  inspectorAgent = null;
}

async function inspectorShowSection(section) {
  inspectorSection = section;
  inspectorCurrentFile = null;
  inspectorEditing = false;
  document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.section === section));
  document.getElementById('inspector-edit-btn').style.display = 'none';
  document.getElementById('inspector-save-btn').style.display = 'none';
  document.getElementById('inspector-current').textContent = '';
  document.getElementById('inspector-view').textContent = '';
  document.getElementById('inspector-editor').style.display = 'none';
  document.getElementById('inspector-view').style.display = '';
  await inspectorLoadList();
}

async function inspectorLoadList() {
  if (!inspectorAgent) return;
  const list = document.getElementById('inspector-list');
  list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-dim)">Loading...</div>';

  try {
    let items = [];
    if (inspectorSection === 'files') {
      const res = await fetch(`/api/agents/${encodeURIComponent(inspectorAgent.id)}/files`);
      const files = await res.json();
      items = files.map(f => ({ label: f, value: f, type: 'file' }));
    } else if (inspectorSection === 'memory') {
      const res = await fetch(`/api/agents/${encodeURIComponent(inspectorAgent.id)}/memory`);
      const mem = await res.json();
      items = mem.map(m => ({ label: m.date, value: m.filename, type: 'memory' }));
    } else if (inspectorSection === 'topics') {
      items = inspectorAgent.topics.map(t => ({ label: t, value: t, type: 'topic' }));
    }

    if (items.length === 0) {
      list.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--text-dim)">No ${inspectorSection}</div>`;
      return;
    }

    list.innerHTML = '';
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'inspector-list-item';
      el.textContent = item.label;
      el.addEventListener('click', () => inspectorOpenItem(item));
      list.appendChild(el);
    }
    // Auto-open first
    if (items[0]) inspectorOpenItem(items[0]);
  } catch (err) {
    list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--danger)">Error loading</div>';
  }
}

async function inspectorOpenItem(item) {
  if (!inspectorAgent) return;
  inspectorCurrentFile = item;
  inspectorEditing = false;
  document.querySelectorAll('.inspector-list-item').forEach(el => el.classList.toggle('active', el.textContent === item.label));
  document.getElementById('inspector-current').textContent = item.label;
  document.getElementById('inspector-view').style.display = '';
  document.getElementById('inspector-editor').style.display = 'none';
  document.getElementById('inspector-save-btn').style.display = 'none';

  try {
    let url;
    if (item.type === 'file') {
      url = `/api/agents/${encodeURIComponent(inspectorAgent.id)}/files/${encodeURIComponent(item.value)}`;
      document.getElementById('inspector-edit-btn').style.display = '';
    } else if (item.type === 'memory') {
      url = `/api/agents/${encodeURIComponent(inspectorAgent.id)}/memory/${encodeURIComponent(item.value)}`;
      document.getElementById('inspector-edit-btn').style.display = 'none';
    } else if (item.type === 'topic') {
      url = `/api/agents/${encodeURIComponent(inspectorAgent.id)}/topics/${encodeURIComponent(item.value)}/MEMORY.md`;
      document.getElementById('inspector-edit-btn').style.display = 'none';
    }
    const res = await fetch(url);
    const text = await res.text();
    document.getElementById('inspector-view').textContent = text;
  } catch {
    document.getElementById('inspector-view').textContent = '(Failed to load)';
  }
}

function inspectorToggleEdit() {
  if (!inspectorCurrentFile || inspectorCurrentFile.type !== 'file') return;
  inspectorEditing = !inspectorEditing;
  const view = document.getElementById('inspector-view');
  const editor = document.getElementById('inspector-editor');
  const saveBtn = document.getElementById('inspector-save-btn');
  if (inspectorEditing) {
    editor.value = view.textContent;
    view.style.display = 'none';
    editor.style.display = '';
    saveBtn.style.display = '';
    editor.focus();
  } else {
    view.style.display = '';
    editor.style.display = 'none';
    saveBtn.style.display = 'none';
  }
}

async function inspectorSave() {
  if (!inspectorCurrentFile || !inspectorAgent || inspectorCurrentFile.type !== 'file') return;
  const editor = document.getElementById('inspector-editor');
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(inspectorAgent.id)}/files/${encodeURIComponent(inspectorCurrentFile.value)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editor.value }),
    });
    if (res.ok) {
      showToast('Saved', 'success');
      document.getElementById('inspector-view').textContent = editor.value;
      inspectorToggleEdit();
    } else {
      showToast('Save failed', 'error');
    }
  } catch {
    showToast('Save failed', 'error');
  }
}

// Wire keyboard shortcuts for inspector
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('inspector-overlay')?.classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeInspector(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && inspectorEditing) { e.preventDefault(); inspectorSave(); }
});

// ── Agent Detail Panel (#3) ─────────────────────────────────────
function showDetailPanel(agentId) {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;

  document.getElementById('detail-emoji').textContent = agent.emoji;
  document.getElementById('detail-name').textContent = agent.name;
  document.getElementById('detail-role').textContent = agent.role;
  document.getElementById('detail-vibe').textContent = agent.vibe || '';

  const cat = getCategory(agent);
  document.getElementById('detail-category').textContent = categoryLabels[cat] || cat || 'Uncategorized';

  // Topics
  const topicsEl = document.getElementById('detail-topics');
  topicsEl.innerHTML = '';
  if (agent.topics.length === 0) {
    topicsEl.innerHTML = '<span style="color:var(--text-dim);font-size:12px">No topics</span>';
  } else {
    for (const t of agent.topics) {
      const chip = document.createElement('span');
      chip.className = 'detail-topic-chip';
      chip.textContent = t;
      chip.addEventListener('click', () => { closeDetailPanel(); launchAgent(agent.id, t); });
      topicsEl.appendChild(chip);
    }
  }

  // Launch button
  const launchBtn = document.getElementById('detail-launch');
  launchBtn.onclick = () => { closeDetailPanel(); launchAgent(agent.id); };

  // Inspect button
  const inspectBtn = document.getElementById('detail-inspect');
  if (inspectBtn) inspectBtn.onclick = () => { closeDetailPanel(); openInspector(agent.id); };

  // Load metrics (B4 #3)
  loadAgentMetrics(agent.id);

  document.getElementById('agent-detail').classList.add('open');
}

async function loadAgentMetrics(agentId) {
  const container = document.getElementById('detail-metrics');
  if (!container) return;
  container.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">Loading...</div>';
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/metrics`);
    const m = await res.json();
    const lastUsedStr = m.lastUsed ? new Date(m.lastUsed).toLocaleDateString() : 'never';
    container.innerHTML = `
      <div class="metrics-row"><strong>${m.totalSessions}</strong> total sessions</div>
      <div class="metrics-row">Last used: <strong>${lastUsedStr}</strong></div>
      <div class="metrics-spark">
        ${m.recentDates.map(d => `<div class="metrics-spark-bar ${d ? 'active' : ''}" title="${d || 'no activity'}"></div>`).join('')}
      </div>
    `;
  } catch {
    container.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">Unable to load</div>';
  }
}

function closeDetailPanel() {
  document.getElementById('agent-detail').classList.remove('open');
}

// ── Recent Sessions (#8) ────────────────────────────────────────
async function loadRecentSessions() {
  try {
    const res = await fetch('/api/history');
    const history = await res.json();
    const recent = history.slice(0, 5);
    const container = document.getElementById('recent-sessions');
    const list = document.getElementById('recent-sessions-list');

    if (recent.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = '';
    list.innerHTML = '';
    for (const h of recent) {
      const agent = agents.find(a => a.id === h.agentId);
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.innerHTML = `
        <span class="recent-emoji">${esc(agent?.emoji || '🤖')}</span>
        <span>${esc(agent?.name || h.agentId)}${h.topic ? ': ' + esc(h.topic) : ''}</span>
        <span class="recent-time">${esc(h.date.slice(0, 10))}</span>
      `;
      item.addEventListener('click', () => launchAgent(h.agentId, h.topic));
      list.appendChild(item);
    }
  } catch {
    // Silently fail
  }
}

// ── Navigation ─────────────────────────────────────────────────
function showDashboard() {
  if (currentSessionId) {
    const entry = terminals.get(currentSessionId);
    if (entry) entry.resizeObserver.disconnect();
  }

  document.getElementById('terminal-view').classList.remove('active');
  document.getElementById('dashboard-view').classList.add('active');
  currentSessionId = null;
  closeDetailPanel();

  document.querySelectorAll('.session-tab').forEach(tab => tab.classList.remove('active'));
  loadAgents();
  loadRecentSessions();
}

// ── Close Session ──────────────────────────────────────────────
async function closeSession(sessionId) {
  const entry = terminals.get(sessionId);
  if (entry) {
    // Track for quick resume (B3 #11) and undo (B4 #14)
    lastClosedSession = { agentId: entry.agent.id, topic: entry.topic };
    lastClosedAt = Date.now();

    if (entry.intentionallyClosed) entry.intentionallyClosed();
    if (entry.clearReconnect) entry.clearReconnect();
    entry.ws.close();
    entry.terminal.dispose();
    entry.resizeObserver.disconnect();
    terminals.delete(sessionId);
    // Remove the persistent terminal wrapper
    const container = document.getElementById('terminal-container');
    const wrapper = container?.querySelector(`[data-terminal="${CSS.escape(sessionId)}"]`);
    if (wrapper) wrapper.remove();
  }

  await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  removeSessionTab(sessionId);
  updateSessionCount();
  showToast(`Session ended`, 'info');

  if (currentSessionId === sessionId) {
    const remaining = [...terminals.keys()];
    if (remaining.length > 0) {
      switchToSession(remaining[0]);
    } else {
      showDashboard();
    }
  }
  loadAgents();
}

function killCurrentSession() {
  if (currentSessionId) closeSession(currentSessionId);
}

// ── Session Counter ────────────────────────────────────────────
function updateSessionCount() {
  document.getElementById('session-count').textContent = terminals.size;
  updateFaviconBadge(terminals.size);
}

// ── Toast Notifications (#2) ────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Context Menu (#20) ──────────────────────────────────────────
let activeContextMenu = null;

function showContextMenu(x, y, agentId) {
  closeContextMenu();
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';

  // SVG icon helper for context menu
  const svgIcon = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;

  const items = [
    { icon: svgIcon('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'), label: 'Quick Chat...', action: () => openQuickChat(agentId) },
    { icon: svgIcon('<polygon points="5 3 19 12 5 21 5 3"/>'), label: 'Launch Session', action: () => launchAgent(agentId) },
    { icon: svgIcon('<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'), label: 'Launch with Prompt...', action: () => showPromptLaunchModal(agentId) },
  ];

  if (agent.topics.length > 0) {
    items.push({ icon: svgIcon('<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>'), label: 'Launch with Topic...', action: () => showTopicModal(agent) });
  }

  items.push(
    { icon: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'), label: 'View Details', action: () => showDetailPanel(agentId) },
    { icon: svgIcon('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>'), label: 'Inspect Workspace', action: () => openInspector(agentId) },
    { icon: svgIcon(isPinned(agentId) ? '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' : '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'), label: isPinned(agentId) ? 'Unpin' : 'Pin to Top', action: () => togglePin(agentId) },
    { sep: true },
    { icon: svgIcon('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'), label: 'Copy workspace path', action: () => { navigator.clipboard?.writeText(`cd ~/clawd-${agentId}`); showToast('Path copied', 'info'); } },
  );

  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'context-sep';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'context-item';
    btn.innerHTML = `<span class="context-icon">${item.icon}</span>${esc(item.label)}`;
    btn.addEventListener('click', () => { closeContextMenu(); item.action(); });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  activeContextMenu = menu;
}

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

// Wire context menu to agent grid
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('agent-grid')?.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.agent-card[data-agent]');
    if (card) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, card.dataset.agent);
    }
  });

  document.addEventListener('click', closeContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });
});

// ── Favicon Badge (#19) ─────────────────────────────────────────
function updateFaviconBadge(count) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (count === 0) {
    link.href = '/favicon.svg';
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  // Draw base icon
  ctx.fillStyle = '#06060f';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  const grad = ctx.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, '#7c4dff');
  grad.addColorStop(1, '#00d4ff');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Draw badge
  ctx.fillStyle = '#00e676';
  ctx.beginPath();
  ctx.arc(52, 12, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), 52, 13);
  link.href = canvas.toDataURL();
}

// ── Export Session (#11) ────────────────────────────────────────
function exportSession() {
  const entry = terminals.get(currentSessionId);
  if (!entry) return;
  const text = `# Session Export\n\n` +
    `**Agent:** ${entry.agent.emoji} ${entry.agent.name}\n` +
    `**Topic:** ${entry.topic || 'general'}\n` +
    `**Date:** ${new Date().toISOString()}\n\n---\n\n` +
    entry.terminal.buffer.active.getLine(0) ? (() => {
      let out = '';
      const buf = entry.terminal.buffer.active;
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line) out += line.translateToString(true) + '\n';
      }
      return '```\n' + out + '```\n';
    })() : '(empty)\n';

  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${entry.agent.id}${entry.topic ? '-' + entry.topic : ''}-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Session exported', 'success');
}

// ── Terminal Search (#13) ───────────────────────────────────────
function toggleTerminalSearch() {
  const bar = document.getElementById('terminal-search-bar');
  if (bar.style.display === 'none') {
    bar.style.display = '';
    document.getElementById('terminal-search-input').focus();
  } else {
    closeTerminalSearch();
  }
}

function closeTerminalSearch() {
  document.getElementById('terminal-search-bar').style.display = 'none';
  document.getElementById('terminal-search-input').value = '';
  const entry = terminals.get(currentSessionId);
  if (entry?.searchAddon) entry.searchAddon.clearDecorations();
}

function termSearchNext() {
  const entry = terminals.get(currentSessionId);
  const q = document.getElementById('terminal-search-input').value;
  if (entry?.searchAddon && q) entry.searchAddon.findNext(q);
}

function termSearchPrev() {
  const entry = terminals.get(currentSessionId);
  const q = document.getElementById('terminal-search-input').value;
  if (entry?.searchAddon && q) entry.searchAddon.findPrevious(q);
}

// Wire Ctrl+F to terminal search
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentSessionId) {
    e.preventDefault();
    toggleTerminalSearch();
  }
});

// Wire Enter/Shift+Enter in search input
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('terminal-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? termSearchPrev() : termSearchNext(); }
    if (e.key === 'Escape') closeTerminalSearch();
  });
  document.getElementById('terminal-search-input')?.addEventListener('input', (e) => {
    termSearchNext(); // Live search as you type
  });
});

// ── Auto-Scroll Toggle (#17) ───────────────────────────────────
function toggleAutoScroll() {
  const entry = terminals.get(currentSessionId);
  if (!entry) return;
  entry.autoScroll = !entry.autoScroll;
  const btn = document.getElementById('autoscroll-btn');
  if (btn) btn.classList.toggle('active', entry.autoScroll);
  showToast(entry.autoScroll ? 'Auto-scroll on' : 'Auto-scroll paused', 'info');
}

// ── Browser Notifications (#14) ────────────────────────────────
let notificationsEnabled = localStorage.getItem('notifications') === 'true';

function requestNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendNotification(title, body) {
  if (!notificationsEnabled) return;
  if (document.hasFocus()) return; // Don't notify if tab is focused
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.svg' });
  }
}

// Request permission on first interaction
document.addEventListener('click', () => requestNotifications(), { once: true });

// ── Project Workspaces (B4 #15) ─────────────────────────────────
function getProjects() {
  try { return JSON.parse(localStorage.getItem('projects') || '{}'); }
  catch { return {}; }
}

function saveProject(name) {
  if (!name) return;
  const projects = getProjects();
  projects[name] = {
    pinnedAgents: [...pinnedAgents],
    filter: currentFilter,
    sort: currentSort,
    viewMode,
    theme: currentTheme,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem('projects', JSON.stringify(projects));
  showToast(`Project "${name}" saved`, 'success');
}

function loadProject(name) {
  const projects = getProjects();
  const p = projects[name];
  if (!p) return;
  pinnedAgents = p.pinnedAgents || [];
  localStorage.setItem('pinnedAgents', JSON.stringify(pinnedAgents));
  currentFilter = p.filter || 'all';
  currentSort = p.sort || 'name';
  if (p.viewMode && p.viewMode !== viewMode) toggleViewMode();
  if (p.theme) applyTheme(p.theme);
  loadAgents();
  showToast(`Loaded project: ${name}`, 'info');
}

function promptSaveProject() {
  const name = prompt('Project name:');
  if (name) saveProject(name);
}

function promptLoadProject() {
  const projects = getProjects();
  const names = Object.keys(projects);
  if (names.length === 0) { showToast('No saved projects', 'info'); return; }
  const name = prompt(`Load project (${names.join(', ')}):`);
  if (name) loadProject(name);
}

// ── Theme System (#9) ───────────────────────────────────────────
const themes = ['midnight', 'ocean', 'obsidian'];
let currentTheme = localStorage.getItem('theme') || 'midnight';

function applyTheme(theme) {
  if (theme === 'midnight') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  currentTheme = theme;
  localStorage.setItem('theme', theme);
}

function cycleTheme() {
  const idx = themes.indexOf(currentTheme);
  const next = themes[(idx + 1) % themes.length];
  applyTheme(next);
  showToast(`Theme: ${next}`, 'info');
}

// Apply saved theme on load
applyTheme(currentTheme);

// ── Agent Sorting (#19) ─────────────────────────────────────────
function changeSort(sortBy) {
  currentSort = sortBy;
  localStorage.setItem('agentSort', sortBy);
  renderAgentGrid(agents);
}

// ── PWA Install (#20) ───────────────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show install button in header
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.title = 'Install App';
  btn.textContent = '📲';
  btn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      if (result.outcome === 'accepted') showToast('App installed!', 'success');
      deferredInstallPrompt = null;
      btn.remove();
    }
  });
  document.querySelector('.header-controls')?.prepend(btn);
});

// ── View Mode Toggle (#10) ──────────────────────────────────────
function toggleViewMode() {
  viewMode = viewMode === 'grid' ? 'compact' : 'grid';
  localStorage.setItem('viewMode', viewMode);
  const grid = document.getElementById('agent-grid');
  grid.classList.toggle('compact', viewMode === 'compact');
  const btn = document.getElementById('view-toggle');
  if (btn) btn.classList.toggle('active', viewMode === 'compact');
}

// Apply saved view mode on load
document.addEventListener('DOMContentLoaded', () => {
  if (viewMode === 'compact') {
    document.getElementById('agent-grid')?.classList.add('compact');
    document.getElementById('view-toggle')?.classList.add('active');
  }
});

// ── Pin/Favorite Agents (#2) ────────────────────────────────────
function togglePin(agentId) {
  const idx = pinnedAgents.indexOf(agentId);
  if (idx >= 0) {
    pinnedAgents.splice(idx, 1);
    showToast('Unpinned', 'info');
  } else {
    pinnedAgents.push(agentId);
    showToast('Pinned to top', 'success');
  }
  localStorage.setItem('pinnedAgents', JSON.stringify(pinnedAgents));
  renderAgentGrid(agents);
}

function isPinned(agentId) {
  return pinnedAgents.includes(agentId);
}

// ── Dynamic Filter Chips (#6) ───────────────────────────────────
function buildDynamicChips() {
  const chipBar = document.getElementById('filter-chips');
  if (!chipBar) return;

  // Collect unique categories from agents
  const cats = new Set();
  for (const a of agents) {
    cats.add(getCategory(a));
  }

  chipBar.innerHTML = '';

  // Static chips first
  const staticChips = [
    { filter: 'all', label: 'All' },
    { filter: 'pinned', label: '⭐ Pinned' },
    { filter: 'active', label: 'Active' },
  ];

  for (const c of staticChips) {
    const btn = document.createElement('button');
    btn.className = `chip${currentFilter === c.filter ? ' active' : ''}`;
    btn.dataset.filter = c.filter;
    btn.textContent = c.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(ch => ch.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = c.filter;
      renderAgentGrid(agents);
    });
    chipBar.appendChild(btn);
  }

  // Dynamic category chips
  for (const cat of categoryOrder) {
    if (!cats.has(cat)) continue;
    const btn = document.createElement('button');
    btn.className = `chip${currentFilter === cat ? ' active' : ''}`;
    btn.dataset.filter = cat;
    btn.textContent = categoryLabels[cat] || cat;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(ch => ch.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = cat;
      renderAgentGrid(agents);
    });
    chipBar.appendChild(btn);
  }
}

// ── Stats Bar (#3) ──────────────────────────────────────────────
async function updateStatsBar() {
  try {
    const res = await fetch('/api/health');
    const stats = await res.json();
    const bar = document.getElementById('stats-bar');
    if (!bar) return;
    bar.style.display = '';
    const upH = Math.floor(stats.uptime / 3600);
    const upM = Math.floor((stats.uptime % 3600) / 60);
    bar.innerHTML = `
      <span class="stat-item">${stats.agentCount} agents</span>
      <span class="stat-sep">·</span>
      <span class="stat-item">${stats.activeSessions}/${stats.maxSessions} sessions</span>
      <span class="stat-sep">·</span>
      <span class="stat-item">${stats.memoryMB}MB</span>
      <span class="stat-sep">·</span>
      <span class="stat-item">up ${upH}h${upM}m</span>
      ${stats.activeSessions > 0 ? `<span class="stat-sep">·</span><span class="stat-item" style="cursor:pointer;color:var(--warning)" onclick="killAllSessions(true)" title="Kill idle sessions">kill idle</span><span class="stat-sep">·</span><span class="stat-item" style="cursor:pointer;color:var(--danger)" onclick="killAllSessions(false)" title="Kill all sessions">kill all</span>` : ''}
    `;
  } catch {}
}

// ── Launch with Prompt (#5) ─────────────────────────────────────
function showPromptLaunchModal(agentId, topic) {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;

  const modal = document.getElementById('topic-modal');
  const title = document.getElementById('topic-modal-title');
  const list = document.getElementById('topic-list');

  title.textContent = `${agent.emoji} ${agent.name}${topic ? ': ' + topic : ''}`;
  list.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  const label = document.createElement('p');
  label.className = 'modal-subtitle';
  label.textContent = 'Optional: send a starting prompt';
  wrapper.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.className = 'prompt-textarea';
  textarea.placeholder = 'e.g. "Review the latest PR" or leave empty for general session';
  textarea.rows = 3;
  wrapper.appendChild(textarea);

  const launchBtn = document.createElement('button');
  launchBtn.className = 'detail-launch-btn';
  launchBtn.textContent = 'Launch';
  launchBtn.addEventListener('click', () => {
    modal.classList.remove('open');
    launchAgent(agentId, topic, textarea.value.trim() || undefined);
  });
  wrapper.appendChild(launchBtn);

  list.appendChild(wrapper);
  modal.classList.add('open');
  setTimeout(() => textarea.focus(), 100);
}
