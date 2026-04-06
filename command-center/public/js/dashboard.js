// ══════════════════════════════════════════════════════════════
//  AGENT COMMAND CENTER — Frontend Logic
// ══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────
let agents = [];
let terminals = new Map();
let currentSessionId = null;
let selectedAgentId = null;
let currentFilter = 'all';

// ── Agent categories and accent colors ────────────────────────
const agentCategories = {
  soha_coding:     'engineering',
  dba_scholar:     'engineering',
  soha_rd:         'engineering',
  chimi_ops:       'operations',
  plant_ops:       'operations',
  soha_ops:        'operations',
  community:       'operations',
  soha_finance:    'operations',
  ankh_social:     'social',
  guidewave_social:'social',
  soha_social:     'social',
  soha_collab:     'social',
  soha_researcher: 'research',
  atlas:           'research',
  idea_forge:      'research',
  reco:            'research',
  crypto_trader:   'research',
  alfa_signal:     'research',
  personal:        'personal',
  soha_life:       'personal',
  soha_inbox:      'personal',
  soha_prompter:   'personal',
  the_doctor:      'personal',
  aurelia:         'personal',
  aurelia_mentor:  'personal',
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
  soha_coding: '#7c4dff', atlas: '#0891b2', plant_ops: '#16a34a',
  chimi_ops: '#ff6d00', crypto_trader: '#ca8a04', ankh_social: '#d4af37',
  soha_rd: '#00bcd4', soha_researcher: '#059669', guidewave_social: '#ec4899',
  soha_social: '#f472b6', soha_prompter: '#f59e0b', dba_scholar: '#818cf8',
  the_doctor: '#22c55e', reco: '#3b82f6', aurelia: '#a855f7',
  aurelia_mentor: '#c084fc', alfa_signal: '#14b8a6', idea_forge: '#fb923c',
  soha_finance: '#eab308', personal: '#8b5cf6', community: '#ef4444',
  soha_life: '#34d399', soha_inbox: '#60a5fa', soha_ops: '#f97316',
  soha_collab: '#f472b6',
};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAgents();
  recoverSessions();
  setupKeyboard();
  setupFilterChips();
  setupCursorGlow();
  document.getElementById('agent-search').addEventListener('input', filterAgents);
});

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

  // Apply category filter
  let filtered = agentList;
  if (currentFilter === 'active') {
    filtered = agentList.filter(a => a.hasActiveSession);
  } else if (currentFilter !== 'all') {
    filtered = agentList.filter(a => (agentCategories[a.id] || 'personal') === currentFilter);
  }

  // Group by category
  const groups = {};
  for (const cat of categoryOrder) groups[cat] = [];
  for (const agent of filtered) {
    const cat = agentCategories[agent.id] || 'personal';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(agent);
  }

  let html = '';
  for (const cat of categoryOrder) {
    const group = groups[cat];
    if (!group || group.length === 0) continue;

    const catColor = categoryColors[cat];

    // Category header
    html += `
      <div class="category-header">
        <span class="category-label" style="color:${catColor}">${categoryLabels[cat]}</span>
        <div class="category-line" style="background:linear-gradient(to right, ${catColor}30, transparent)"></div>
      </div>
    `;

    // Agent cards
    for (const agent of group) {
      const accent = agentAccentColors[agent.id] || catColor;
      const topicChips = agent.topics.slice(0, 3).map(t =>
        `<span class="topic-chip">${t}</span>`
      ).join('');
      const moreTopics = agent.topics.length > 3
        ? `<span class="topic-chip">+${agent.topics.length - 3}</span>` : '';

      html += `
        <div class="agent-card ${agent.hasActiveSession ? 'has-session' : ''}"
             style="--card-accent:${accent}; --card-glow:${accent}30"
             onclick="onAgentClick('${agent.id}')" data-agent="${agent.id}">
          <div class="card-top">
            <span class="agent-emoji">${agent.emoji}</span>
            <div class="status-indicator ${agent.hasActiveSession ? 'active' : ''}"></div>
          </div>
          <div class="card-body">
            <div class="agent-name">${agent.name}</div>
            <div class="agent-role">${agent.role}</div>
            ${agent.vibe ? `<div class="agent-vibe">${agent.vibe}</div>` : ''}
            ${agent.topics.length > 0 ? `<div class="agent-topics">${topicChips}${moreTopics}</div>` : ''}
          </div>
        </div>
      `;
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
  list.innerHTML = agent.topics.map(t =>
    `<button class="topic-btn" onclick="launchAgent('${agent.id}', '${t}')">${t}</button>`
  ).join('');
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
      alert(err.error || 'Failed to create session');
      return;
    }

    const data = await res.json();
    createTerminal(data.id, agentId, topic);
    switchToSession(data.id);
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
      } catch {}
      terminal.write(e.data);
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

  document.getElementById('terminal-emoji').textContent = entry.agent.emoji;
  document.getElementById('terminal-name').textContent = entry.agent.name;
  const topicEl = document.getElementById('terminal-topic');
  topicEl.textContent = entry.topic || '';
  topicEl.style.display = entry.topic ? 'inline' : 'none';

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
  if (accent) tab.style.borderLeftColor = accent;
  tab.innerHTML = `
    <span class="tab-emoji">${agent.emoji}</span>
    <span>${agent.name}${topic ? `: ${topic}` : ''}</span>
    <button class="tab-close" onclick="event.stopPropagation(); closeSession('${sessionId}')">&#215;</button>
  `;
  tab.addEventListener('click', () => switchToSession(sessionId));
  tabs.appendChild(tab);
}

function removeSessionTab(sessionId) {
  const tab = document.querySelector(`.session-tab[data-session="${sessionId}"]`);
  if (tab) tab.remove();
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

  document.querySelectorAll('.session-tab').forEach(tab => tab.classList.remove('active'));
  loadAgents();
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
}
