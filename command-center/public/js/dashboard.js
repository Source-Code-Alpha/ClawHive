// ══════════════════════════════════════════════════════════════
//  AGENT COMMAND CENTER — Frontend Logic
// ══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────
let agents = [];
let terminals = new Map();
let currentSessionId = null;
let selectedAgentId = null;
let currentFilter = 'all';

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
  coding:      '#7c4dff',
  researcher:  '#00bcd4',
  social:      '#ec4899',
  life:        '#00e676',
  prompter:    '#f59e0b',
  designer:    '#a855f7',
  auditor:     '#22c55e',
  finance:     '#ff6d00',
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
    renderAgentGrid(agents);
    updateSessionCount();
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

  // Apply category filter — use server-provided category (#16), fallback to hardcoded
  let filtered = agentList;
  if (currentFilter === 'active') {
    filtered = agentList.filter(a => a.hasActiveSession);
  } else if (currentFilter !== 'all') {
    filtered = agentList.filter(a => getCategory(a) === currentFilter);
  }

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

      html += `
        <div class="agent-card ${agent.hasActiveSession ? 'has-session' : ''}"
             style="--card-accent:${escAttr(accent)}; --card-glow:${escAttr(accent)}30"
             data-agent="${escAttr(agent.id)}">
          <div class="card-top">
            <span class="agent-emoji">${esc(agent.emoji)}</span>
            <div class="status-indicator ${agent.hasActiveSession ? 'active' : ''}"></div>
          </div>
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
async function launchAgent(agentId, topic) {
  document.getElementById('topic-modal').classList.remove('open');
  const sessionId = topic ? `${agentId}:${topic}` : agentId;

  if (terminals.has(sessionId)) {
    switchToSession(sessionId);
    return;
  }

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, topic, cols: 120, rows: 30 }),
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
  }
}

// ── Terminal Management ────────────────────────────────────────
function createTerminal(sessionId, agentId, topic) {
  const agent = agents.find(a => a.id === agentId) || { name: agentId, emoji: '🤖' };
  const accent = agentAccentColors[agentId] || '#7c4dff';

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
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new window.WebLinksAddon.WebLinksAddon());

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
        if (ctrl.type === 'session_ended') return;
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
    terminal, fitAddon, ws, agent, topic, resizeObserver, accent,
    lastDataTime: Date.now(),
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
  container.innerHTML = '';
  entry.terminal.open(container);
  entry.fitAddon.fit();
  entry.resizeObserver.observe(container);
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

  document.getElementById('agent-detail').classList.add('open');
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
    if (entry.intentionallyClosed) entry.intentionallyClosed();
    if (entry.clearReconnect) entry.clearReconnect();
    entry.ws.close();
    entry.terminal.dispose();
    entry.resizeObserver.disconnect();
    terminals.delete(sessionId);
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

  const items = [
    { icon: '▶', label: 'Launch Session', action: () => launchAgent(agentId) },
  ];

  if (agent.topics.length > 0) {
    items.push({ icon: '📂', label: 'Launch with Topic...', action: () => showTopicModal(agent) });
  }

  items.push(
    { icon: 'ℹ', label: 'View Details', action: () => showDetailPanel(agentId) },
    { sep: true },
    { icon: '📋', label: 'Copy workspace path', action: () => { navigator.clipboard?.writeText(`cd ~/clawd-${agentId}`); showToast('Path copied', 'info'); } },
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
