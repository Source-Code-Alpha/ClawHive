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

  // SVG icon helper for context menu
  const svgIcon = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;

  const items = [
    { icon: svgIcon('<polygon points="5 3 19 12 5 21 5 3"/>'), label: 'Launch Session', action: () => launchAgent(agentId) },
    { icon: svgIcon('<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'), label: 'Launch with Prompt...', action: () => showPromptLaunchModal(agentId) },
  ];

  if (agent.topics.length > 0) {
    items.push({ icon: svgIcon('<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>'), label: 'Launch with Topic...', action: () => showTopicModal(agent) });
  }

  items.push(
    { icon: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'), label: 'View Details', action: () => showDetailPanel(agentId) },
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
