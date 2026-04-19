/* ═══════════════════════════════════════════════════════════════════
 * THE HIVE — Dashboard Controller
 * Bioluminescent Swarm OS · 2026-04-16
 * ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─── Global state ─────────────────────────────────────────────── */
const state = {
  agents: [],
  agentsById: {},
  sessions: [],
  activity: [],
  bridges: [],                    // {from, to, id, color}
  filter: 'all',
  search: '',
  view: 'hive',                   // hive | grid | list | terminal
  activeAgent: null,
  activeSession: null,            // current terminal session id
  terminals: {},                  // sessionId -> {term, fit, search, ws, buffer}
  pinned: new Set(),
  selectedAgentId: null,
  auraIntensity: parseInt(localStorage.getItem('auraIntensity') || '60', 10),
  calmMotion: localStorage.getItem('calmMotion') === '1',
  ambientHum: localStorage.getItem('ambientHum') === '1',
  notifOk: false,
  authRequired: false,
  authToken: localStorage.getItem('hive_token') || '',
  evtWs: null,
  timeRiverOpen: false,
  timeRiverEvents: [],
  focusMode: false,
  draggingFrom: null,             // bridge-drag source agent id
  hiveLayout: {},                 // agentId -> {x, y}
  pulseCount: 0,
  gardenOrbs: [],
  ttsEnabled: false,
  voiceListening: false,
};
window.state = state;
let selectedAgentId = null;

/* ─── Utilities ────────────────────────────────────────────────── */
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const now = () => Date.now();
const relTime = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
};
const hexToRgb = (h) => {
  h = (h || '#ffb347').replace('#','');
  if (h.length === 3) h = h.split('').map(c=>c+c).join('');
  return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)];
};
const rgba = (h, a) => { const [r,g,b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };

function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, 3200);
}
window.toast = toast;

/* ─── Fetch wrapper (auth aware) ───────────────────────────────── */
async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (state.authToken) opts.headers['Authorization'] = `Bearer ${state.authToken}`;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof ArrayBuffer)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, opts);
  if (r.status === 401) {
    promptForToken();
    throw new Error('Auth required');
  }
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
}

function promptForToken() {
  const t = prompt('This hive needs a bearer token (CLAWHIVE_TOKEN):');
  if (t) {
    state.authToken = t;
    localStorage.setItem('hive_token', t);
    toast('Token saved — retry your action', 'ok');
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * INITIALIZATION
 * ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  applyInitialTheme();
  applyCalmMotion(state.calmMotion);
  setAuraIntensity(state.auraIntensity, true);
  restorePinned();

  try {
    const info = await api('/api/auth');
    state.authRequired = !!info.authRequired;
  } catch { /* ignore */ }

  attachGlobalHandlers();
  connectEventsWS();

  await Promise.all([ loadAgents(), loadSessions(), loadActivity() ]);

  renderHive();
  renderGrid();
  renderList();
  renderSessionTabs();
  renderActivity();
  updatePulseCore();

  setInterval(updatePulseCore, 4500);
  setInterval(async () => { await loadSessions(); renderSessionTabs(); }, 9000);

  window.hiveApi = { api, toast, launchAgent, openDetail, getAgents: () => state.agents, openInspector, openTopics, openSkills, openSwarm, openMemoryGarden };

  hideLoading();
}

function hideLoading() {
  const el = $('#hive-loading');
  if (el) el.style.display = 'none';
}

/* ─── Themes & motion ─────────────────────────────────────────── */
function applyInitialTheme() { applyTheme(localStorage.getItem('hiveTheme') || 'honey'); }
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('hiveTheme', theme);
  $$('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}
window.applyTheme = applyTheme;

function setAuraIntensity(v, silent) {
  state.auraIntensity = parseInt(v, 10) || 0;
  document.documentElement.style.setProperty('--aura-intensity', (state.auraIntensity/100).toFixed(2));
  localStorage.setItem('auraIntensity', String(state.auraIntensity));
  const slider = $('#set-aura-intensity');
  if (slider && !silent) slider.value = state.auraIntensity;
}
window.setAuraIntensity = setAuraIntensity;

function setCalmMotion(on) { applyCalmMotion(on); localStorage.setItem('calmMotion', on ? '1':'0'); }
function applyCalmMotion(on) {
  state.calmMotion = on;
  document.documentElement.classList.toggle('calm', !!on);
  const cb = $('#set-motion-calm'); if (cb) cb.checked = !!on;
}
window.setCalmMotion = setCalmMotion;
function setAmbientHum(on) { state.ambientHum = on; localStorage.setItem('ambientHum', on ? '1':'0'); }
window.setAmbientHum = setAmbientHum;

/* ═══════════════════════════════════════════════════════════════════
 * DATA LOADING
 * ═══════════════════════════════════════════════════════════════════ */
async function loadAgents() {
  try {
    const list = await api('/api/agents');
    state.agents = list;
    state.agentsById = {};
    list.forEach(a => state.agentsById[a.id] = a);
    const fc = $('#fleet-count'); if (fc) fc.textContent = list.length;
    const pa = $('#pcs-agents'); if (pa) pa.textContent = list.length;
  } catch (e) { console.error('loadAgents', e); toast('Failed to load agents', 'err'); }
}

async function loadSessions() {
  try {
    const list = await api('/api/sessions');
    state.sessions = list;
    const active = list.filter(s => s.alive).length;
    state.pulseCount = active;
    const pc = $('#pulse-count'); if (pc) pc.textContent = active;
    const pca = $('#pcs-active'); if (pca) pca.textContent = active;
  } catch { /* ignore */ }
}

async function loadActivity() {
  try {
    const list = await api('/api/activity?limit=80');
    state.activity = (Array.isArray(list) ? list.slice() : []).reverse();
    const pe = $('#pcs-events'); if (pe) pe.textContent = state.activity.length;
  } catch { /* ignore */ }
}

/* ═══════════════════════════════════════════════════════════════════
 * EVENTS WEBSOCKET
 * ═══════════════════════════════════════════════════════════════════ */
function connectEventsWS() {
  try {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/events`);
    state.evtWs = ws;
    ws.addEventListener('message', (e) => { try { handleEvent(JSON.parse(e.data)); } catch {} });
    ws.addEventListener('close', () => setTimeout(connectEventsWS, 3500));
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  } catch { setTimeout(connectEventsWS, 3500); }
}

function handleEvent(msg) {
  const t = msg.type;
  state.activity.push({ ...msg, timestamp: msg.timestamp || now() });
  if (state.activity.length > 200) state.activity.splice(0, state.activity.length - 200);
  renderActivityRow(msg, true);

  if (t === 'session_started' || t === 'session_ended') {
    loadSessions().then(() => { renderSessionTabs(); renderHive(); renderList(); renderGrid(); });
    if (msg.agentId) flashCell(msg.agentId, t === 'session_started' ? 'busy' : 'idle');
  } else if (t === 'activity' && msg.agentId) {
    flashCell(msg.agentId, 'active');
  } else if (t === 'terminal_output' && msg.sessionId) {
    const rec = state.terminals[msg.sessionId];
    if (rec && rec.term) { rec.term.write(msg.data); if (state.ttsEnabled && state.activeSession === msg.sessionId) queueTTS(msg.data); }
  } else if (t === 'terminal_exit' && msg.sessionId) {
    const rec = state.terminals[msg.sessionId];
    if (rec && rec.term) rec.term.writeln('\r\n\x1b[90m[session ended]\x1b[0m');
  }
  if (state.timeRiverOpen) drawTimeRiver();
}

/* ═══════════════════════════════════════════════════════════════════
 * 🕸 #1 — HIVE CONSTELLATION
 * ═══════════════════════════════════════════════════════════════════ */
function computeHiveLayout() {
  const svg = $('#hive-map'); if (!svg) return;
  // Use a logical canvas so the hive scales cleanly on mobile.
  // Size tracks the container so aspect stays roughly square on phones and
  // widescreen on desktop — preserveAspectRatio="xMidYMid meet" handles the scale.
  const rect = svg.getBoundingClientRect();
  const aspect = Math.max(0.75, Math.min(2.2, (rect.width || 1200) / (rect.height || 700)));
  const H = 1400; // logical height
  const W = Math.round(H * aspect);
  const agents = filteredAgents();
  const ringGap = 180;
  const centers = [];
  const ringCounts = [6, 12, 18, 24];
  let ringIdx = 0, placed = 0;
  while (placed < agents.length && ringIdx < ringCounts.length) {
    const count = ringCounts[ringIdx];
    const radius = ringGap * (ringIdx + 1);
    const offset = (ringIdx % 2) * (Math.PI / count);
    for (let i = 0; i < count && placed < agents.length; i++) {
      const a = (Math.PI * 2 * i / count) + offset - Math.PI/2;
      centers.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
      placed++;
    }
    ringIdx++;
  }
  while (placed < agents.length) {
    const i = placed;
    const angle = (Math.PI * 2 * i / 30) - Math.PI/2;
    const radius = ringGap * 4.4;
    centers.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    placed++;
  }
  state.hiveLayout = {};
  agents.forEach((a, i) => {
    const c = centers[i] || { x: 0, y: 0 };
    state.hiveLayout[a.id] = { x: c.x + W/2, y: c.y + H/2 };
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.removeAttribute('width'); svg.removeAttribute('height');
}

function renderHive() {
  computeHiveLayout();
  const cellsG = $('#hive-cells'); const labelsG = $('#hive-labels');
  if (!cellsG) return;
  cellsG.innerHTML = ''; labelsG.innerHTML = '';
  const agents = filteredAgents();
  agents.forEach(a => {
    const pos = state.hiveLayout[a.id]; if (!pos) return;
    const color = a.color || '#ffb347';
    const mood = moodOf(a);
    const r = 40;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `cell mood-${mood}`);
    g.setAttribute('data-agent', a.id);
    g.style.setProperty('--cell-color', color);

    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glow.setAttribute('class', 'cell-glow');
    glow.setAttribute('d', hexPath(pos.x, pos.y, r + 6));
    glow.setAttribute('fill', rgba(color, 0.10));
    glow.setAttribute('stroke', rgba(color, 0.25));
    g.appendChild(glow);

    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute('class', 'cell-body');
    body.setAttribute('d', hexPath(pos.x, pos.y, r));
    body.setAttribute('fill', a.hasActiveSession ? rgba(color, 0.28) : 'url(#cellIdle)');
    body.setAttribute('stroke', color);
    body.setAttribute('stroke-width', a.hasActiveSession ? '1.8' : '1.2');
    g.appendChild(body);

    if (a.hasActiveSession) {
      const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pulse.setAttribute('cx', pos.x); pulse.setAttribute('cy', pos.y);
      pulse.setAttribute('r', r - 2);
      pulse.setAttribute('fill', 'none');
      pulse.setAttribute('stroke', color);
      pulse.setAttribute('stroke-width', '1');
      pulse.setAttribute('class', 'cell-pulse');
      g.appendChild(pulse);
    }

    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', pos.x - r/2); fo.setAttribute('y', pos.y - r/2);
    fo.setAttribute('width', r); fo.setAttribute('height', r);
    fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="cell-emoji">${esc(a.emoji || '✦')}</div>`;
    g.appendChild(fo);

    g.addEventListener('click', (e) => { e.stopPropagation(); openDetail(a.id); });
    g.addEventListener('dblclick', (e) => { e.stopPropagation(); requestLaunch(a.id); });
    g.addEventListener('mouseenter', () => { setAura(color); highlightCell(a.id, true); });
    g.addEventListener('mouseleave', () => { setAura(null); highlightCell(a.id, false); });
    g.addEventListener('mousedown', (e) => {
      if (!e.shiftKey) return;
      e.preventDefault(); state.draggingFrom = a.id; startBridgeDrag(pos, color);
    });
    // Mobile: long-press on a cell initiates a bridge drag (no shift key on touch)
    let lpTimer = null, lpStart = null;
    g.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; lpStart = { x: t.clientX, y: t.clientY };
      lpTimer = setTimeout(() => {
        if (navigator.vibrate) { try { navigator.vibrate(18); } catch {} }
        state.draggingFrom = a.id;
        startBridgeDrag(pos, color);
      }, 520);
    }, { passive: true });
    g.addEventListener('touchmove', (e) => {
      if (!lpStart) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - lpStart.x, t.clientY - lpStart.y) > 10) {
        clearTimeout(lpTimer); lpTimer = null;
      }
    }, { passive: true });
    g.addEventListener('touchend', () => { clearTimeout(lpTimer); lpTimer = null; lpStart = null; });
    g.addEventListener('touchcancel', () => { clearTimeout(lpTimer); lpTimer = null; lpStart = null; });
    cellsG.appendChild(g);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', pos.x); label.setAttribute('y', pos.y + r + 14);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'cell-label');
    label.setAttribute('fill', rgba(color, 0.82));
    label.textContent = a.name || a.id;
    labelsG.appendChild(label);
  });
  renderBridges();
}

function hexPath(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI/3) * i - Math.PI/2;
    pts.push(`${(cx + r*Math.cos(a)).toFixed(2)},${(cy + r*Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function filteredAgents() {
  const q = (state.search || '').toLowerCase();
  return state.agents.filter(a => {
    if (state.filter === 'active' && !a.hasActiveSession) return false;
    if (state.filter !== 'all' && state.filter !== 'active') {
      const cat = String(a.category || '').toLowerCase();
      if (!cat.includes(state.filter)) return false;
    }
    if (q) {
      const hay = `${a.name} ${a.id} ${a.role} ${a.vibe} ${a.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function highlightCell(id, on) {
  const g = document.querySelector(`[data-agent="${CSS.escape(id)}"]`);
  if (g) g.classList.toggle('hover', !!on);
}
function flashCell(id, mood) {
  const g = document.querySelector(`[data-agent="${CSS.escape(id)}"]`);
  if (!g) return;
  g.classList.remove('mood-idle','mood-active','mood-busy','mood-stuck','mood-offline','flash');
  g.classList.add(`mood-${mood}`); g.classList.add('flash');
  setTimeout(() => g.classList.remove('flash'), 900);
}

/* ═══════════════════════════════════════════════════════════════════
 * 🎨 #2 — AGENT AURA
 * ═══════════════════════════════════════════════════════════════════ */
function setAura(color) {
  const sky = $('#sky-aura'); if (!sky) return;
  if (!color) { sky.style.background = ''; document.documentElement.style.setProperty('--aura-color', 'var(--honey)'); return; }
  document.documentElement.style.setProperty('--aura-color', color);
  sky.style.background = `radial-gradient(60% 60% at 50% 45%, ${rgba(color, 0.35)} 0%, ${rgba(color, 0.08)} 40%, transparent 70%)`;
}

/* ═══════════════════════════════════════════════════════════════════
 * 💓 #6 — MOOD RING
 * ═══════════════════════════════════════════════════════════════════ */
function moodOf(a) {
  if (a.hasActiveSession) {
    const s = state.sessions.find(x => x.agentId === a.id && x.alive);
    if (s) {
      const idle = now() - (s.lastActivity || s.startedAt || now());
      if (idle > 5 * 60 * 1000) return 'stuck';
      return 'busy';
    }
  }
  const recent = state.activity.find(ev => ev.agentId === a.id && (now() - (ev.timestamp || 0)) < 30_000);
  if (recent) return 'active';
  return 'idle';
}

/* ═══════════════════════════════════════════════════════════════════
 * 🔗 #7 — CONSTELLATION BRIDGES
 * ═══════════════════════════════════════════════════════════════════ */
function startBridgeDrag(from, color) {
  const svg = $('#hive-map');
  const bridgesG = $('#hive-bridges');
  const tmp = document.createElementNS('http://www.w3.org/2000/svg','line');
  tmp.setAttribute('x1', from.x); tmp.setAttribute('y1', from.y);
  tmp.setAttribute('x2', from.x); tmp.setAttribute('y2', from.y);
  tmp.setAttribute('stroke', color); tmp.setAttribute('stroke-width','2');
  tmp.setAttribute('stroke-dasharray','6,4'); tmp.setAttribute('opacity','.85');
  bridgesG.appendChild(tmp);
  function ptFromEvent(e) {
    const src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    return { x: src.clientX, y: src.clientY };
  }
  function move(e) {
    const p = ptFromEvent(e);
    const pt = svg.createSVGPoint(); pt.x = p.x; pt.y = p.y;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    tmp.setAttribute('x2', loc.x); tmp.setAttribute('y2', loc.y);
    if (e.cancelable && e.touches) e.preventDefault();
  }
  function up(e) {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
    document.removeEventListener('touchcancel', up);
    tmp.remove();
    const p = ptFromEvent(e);
    const target = document.elementFromPoint(p.x, p.y);
    const cell = target && target.closest('[data-agent]');
    if (cell && state.draggingFrom) {
      const to = cell.getAttribute('data-agent');
      if (to && to !== state.draggingFrom) forgeBridge(state.draggingFrom, to);
    }
    state.draggingFrom = null;
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('touchend', up);
  document.addEventListener('touchcancel', up);
}

function forgeBridge(fromId, toId) {
  const exists = state.bridges.find(b => (b.from===fromId && b.to===toId) || (b.from===toId && b.to===fromId));
  if (exists) { dissolveBridge(exists.id); toast(`Bridge dissolved: ${fromId} ↔ ${toId}`); return; }
  const id = `b_${Date.now()}`;
  const color = state.agentsById[fromId]?.color || '#ffb347';
  state.bridges.push({ id, from: fromId, to: toId, color });
  renderBridges();
  toast(`Bridge forged: ${fromId} ↔ ${toId}`, 'ok');
}

function dissolveBridge(id) { state.bridges = state.bridges.filter(b => b.id !== id); renderBridges(); }

function renderBridges() {
  const g = $('#hive-bridges'); if (!g) return;
  g.innerHTML = '';
  state.bridges.forEach(b => {
    const a = state.hiveLayout[b.from]; const c = state.hiveLayout[b.to];
    if (!a || !c) return;
    const mid = { x: (a.x+c.x)/2, y: (a.y+c.y)/2 - 40 };
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', `M${a.x},${a.y} Q${mid.x},${mid.y} ${c.x},${c.y}`);
    path.setAttribute('fill','none'); path.setAttribute('stroke', b.color);
    path.setAttribute('stroke-width','1.6'); path.setAttribute('stroke-dasharray','4,5');
    path.setAttribute('class','hive-bridge'); path.setAttribute('opacity','.75');
    path.addEventListener('click', (e) => { e.stopPropagation(); dissolveBridge(b.id); });
    g.appendChild(path);
  });
}

/* ═══════════════════════════════════════════════════════════════════
 * GRID & LIST VIEWS
 * ═══════════════════════════════════════════════════════════════════ */
let gridSort = 'name';
function changeSort(v) { gridSort = v; renderGrid(); }
window.changeSort = changeSort;

function renderGrid() {
  const wrap = $('#grid-container'); if (!wrap) return;
  let list = filteredAgents().slice();
  if (gridSort === 'name') list.sort((a,b) => a.name.localeCompare(b.name));
  else if (gridSort === 'category') list.sort((a,b) => (a.category||'').localeCompare(b.category||''));
  else if (gridSort === 'activity') list.sort((a,b) => (b.hasActiveSession?1:0) - (a.hasActiveSession?1:0));
  wrap.innerHTML = list.map(a => `
    <article class="agent-card mood-${moodOf(a)}" style="--cell-color:${esc(a.color || '#ffb347')}" data-agent="${esc(a.id)}" onclick="openDetail('${esc(a.id)}')" ondblclick="requestLaunch('${esc(a.id)}')">
      <div class="card-aura"></div>
      <header class="card-head">
        <div class="card-hex"><svg viewBox="0 0 40 46" width="36" height="42"><polygon points="20,2 38,11 38,35 20,44 2,35 2,11" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span class="card-emoji">${esc(a.emoji || '✦')}</span></div>
        <div>
          <div class="card-name">${esc(a.name || a.id)}</div>
          <div class="card-cat">${esc(a.category || '')}</div>
        </div>
        ${a.hasActiveSession ? '<span class="card-live"></span>' : ''}
      </header>
      <p class="card-role">${esc(a.role || '')}</p>
      <footer class="card-foot">
        <span class="card-topics">${a.topics?.length || 0} topics</span>
        <button class="btn btn-primary btn-xs" onclick="event.stopPropagation();requestLaunch('${esc(a.id)}')">Summon</button>
      </footer>
    </article>
  `).join('');
}

function renderList() {
  const body = $('#list-body'); if (!body) return;
  body.innerHTML = filteredAgents().map(a => `
    <tr data-agent="${esc(a.id)}" style="--cell-color:${esc(a.color || '#ffb347')}">
      <td class="lt-emoji">${esc(a.emoji || '✦')}</td>
      <td class="lt-name" onclick="openDetail('${esc(a.id)}')">${esc(a.name || a.id)}</td>
      <td class="lt-role">${esc(a.role || '')}</td>
      <td class="lt-cat">${esc(a.category || '')}</td>
      <td>${a.topics?.length || 0}</td>
      <td>${a.hasActiveSession ? '<span class="live-dot"></span> live' : '<span class="dim-dot"></span> idle'}</td>
      <td class="lt-actions">
        <button class="btn btn-ghost btn-xs" onclick="openDetail('${esc(a.id)}')">Info</button>
        <button class="btn btn-primary btn-xs" onclick="requestLaunch('${esc(a.id)}')">Summon</button>
      </td>
    </tr>
  `).join('');
}

function switchView(v) {
  state.view = v;
  document.body.setAttribute('data-view', v);
  ['hive','grid','list','terminal'].forEach(k => {
    const el = $(`#view-${k}`); if (!el) return;
    el.hidden = v !== k;
    el.classList.toggle('active', v === k);
  });
  const vml = $('#view-mode-label'); if (vml) vml.textContent = v.charAt(0).toUpperCase() + v.slice(1);
  const pc = $('#pulse-core'); if (pc) pc.style.display = v === 'hive' ? '' : 'none';
  if (v === 'terminal' && state.activeSession) {
    const rec = state.terminals[state.activeSession];
    if (rec && rec.fit) setTimeout(() => { try { rec.fit.fit(); } catch {} }, 100);
  }
}
function showHive() { switchView('hive'); renderHive(); }
function showGrid() { switchView('grid'); renderGrid(); }
function showList() { switchView('list'); renderList(); }
function showTerminal() { switchView('terminal'); }
function cycleView() {
  const order = ['hive','grid','list'];
  const i = order.indexOf(state.view);
  const next = order[(i+1) % order.length];
  ({ hive: showHive, grid: showGrid, list: showList })[next]();
}
window.showHive = showHive; window.showGrid = showGrid; window.showList = showList; window.showTerminal = showTerminal; window.cycleView = cycleView;

/* ═══════════════════════════════════════════════════════════════════
 * AGENT DETAIL CARD
 * ═══════════════════════════════════════════════════════════════════ */
async function openDetail(id) {
  const a = state.agentsById[id]; if (!a) return;
  state.activeAgent = a; selectedAgentId = id; window.selectedAgentId = id;
  const card = $('#detail-card');
  card.hidden = false;
  // Next frame so the transition from translateX(440px) → 0 actually animates in
  requestAnimationFrame(() => card.classList.add('open'));
  card.style.setProperty('--cell-color', a.color || '#ffb347');
  $('#detail-emoji').textContent = a.emoji || '✦';
  $('#detail-name').textContent = a.name || a.id;
  $('#detail-role').textContent = a.role || '';
  $('#detail-vibe').textContent = a.vibe || '';
  $('#detail-category').textContent = a.category || '—';
  $('#detail-topics-count').textContent = a.topics?.length || 0;
  const mood = moodOf(a);
  $('#detail-mood').className = `detail-mood mood-${mood}`;
  $('#detail-mood').textContent = mood.toUpperCase();

  const tWrap = $('#detail-topics');
  tWrap.innerHTML = (a.topics || []).map(t => `<button class="chip" onclick="requestLaunch('${esc(a.id)}','${esc(t)}')">${esc(t)}</button>`).join('') || '<span class="dim">no topics</span>';

  try {
    const m = await api(`/api/agents/${encodeURIComponent(a.id)}/metrics`);
    $('#detail-sessions7').textContent = m?.sessions7d ?? m?.sessions ?? '—';
  } catch { $('#detail-sessions7').textContent = '—'; }

  setAura(a.color);
}
window.openDetail = openDetail;

function closeDetail() {
  const card = $('#detail-card');
  card.classList.remove('open');
  // Hide after slide-out completes (matches CSS .45s transition)
  setTimeout(() => { card.hidden = true; }, 450);
  state.activeAgent = null; setAura(null);
}
window.closeDetail = closeDetail;

function detailInspect() { if (state.activeAgent) openInspector(state.activeAgent.id); }
function detailMemoryGarden() { if (state.activeAgent) openMemoryGarden(state.activeAgent.id); }
function detailQuickChat() { if (state.activeAgent) openQuickChat(state.activeAgent.id); }
function detailLaunch() { if (state.activeAgent) requestLaunch(state.activeAgent.id); }
window.detailInspect = detailInspect; window.detailMemoryGarden = detailMemoryGarden; window.detailQuickChat = detailQuickChat; window.detailLaunch = detailLaunch;

/* ═══════════════════════════════════════════════════════════════════
 * SESSION LAUNCH
 * ═══════════════════════════════════════════════════════════════════ */
function requestLaunch(agentId, topic) {
  const a = state.agentsById[agentId]; if (!a) return;
  selectedAgentId = agentId; window.selectedAgentId = agentId;
  if (topic) return launchAgent(agentId, topic);
  if (!a.topics || a.topics.length === 0) return launchAgent(agentId);
  $('#topic-modal-title').textContent = `${a.emoji || ''} ${a.name || a.id}`;
  $('#topic-list').innerHTML = a.topics.map(t => `<button class="topic-item" onclick="launchAgent('${esc(agentId)}','${esc(t)}')">${esc(t)}</button>`).join('');
  $('#topic-modal').classList.add('open');
}
window.requestLaunch = requestLaunch;

function closeTopicModal() { $('#topic-modal').classList.remove('open'); }
window.closeTopicModal = closeTopicModal;

async function launchAgent(agentId, topic) {
  closeTopicModal();
  try {
    const s = await api('/api/sessions', { method: 'POST', body: { agentId, topic } });
    toast(`Summoned ${state.agentsById[agentId]?.name || agentId}${topic ? ' · '+topic : ''}`, 'ok');
    openTerminal(s.id, agentId, topic);
    await loadSessions(); renderSessionTabs(); renderHive();
  } catch (e) { toast(`Launch failed: ${e.message}`, 'err'); }
}
window.launchAgent = launchAgent;

async function killCurrentSession() {
  if (!state.activeSession) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(state.activeSession)}`, { method: 'DELETE' });
    const rec = state.terminals[state.activeSession];
    if (rec) { try { rec.ws.close(); } catch {} try { rec.term.dispose(); } catch {} }
    delete state.terminals[state.activeSession];
    state.activeSession = null;
    await loadSessions(); renderSessionTabs(); showHive();
  } catch (e) { toast(`End failed: ${e.message}`, 'err'); }
}
window.killCurrentSession = killCurrentSession;

/* ═══════════════════════════════════════════════════════════════════
 * TERMINAL
 * ═══════════════════════════════════════════════════════════════════ */
function openTerminal(sessionId, agentId, topic) {
  let rec = state.terminals[sessionId];
  if (!rec) {
    const term = new window.Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: 'rgba(0,0,0,0)', foreground: '#f4e6cc', cursor: '#ffb347', selectionBackground: '#ffb34744' },
      allowTransparency: true,
    });
    const fit = new window.FitAddon.FitAddon();
    const links = new window.WebLinksAddon.WebLinksAddon();
    const search = new window.SearchAddon.SearchAddon();
    term.loadAddon(fit); term.loadAddon(links); term.loadAddon(search);

    const container = $('#terminal-container');
    container.innerHTML = '';
    const div = document.createElement('div'); div.className = 'term-inner';
    container.appendChild(div);
    term.open(div);
    try { fit.fit(); } catch {}

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal/${encodeURIComponent(sessionId)}`);
    ws.addEventListener('open', () => {
      if (state.authToken) ws.send(JSON.stringify({ type:'auth', token: state.authToken }));
      try { ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); } catch {}
    });
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'data') term.write(msg.data);
        else if (msg.type === 'exit') term.writeln(`\r\n\x1b[90m[exit ${msg.code ?? ''}]\x1b[0m`);
      } catch { term.write(e.data); }
    });
    ws.addEventListener('close', () => term.writeln('\r\n\x1b[90m[disconnected]\x1b[0m'));
    term.onData(d => { try { ws.send(JSON.stringify({ type: 'input', data: d })); } catch {} });
    window.addEventListener('resize', () => { try { fit.fit(); ws.send(JSON.stringify({ type:'resize', cols: term.cols, rows: term.rows })); } catch {} });

    rec = { term, fit, search, ws, agentId, topic };
    state.terminals[sessionId] = rec;
  }

  state.activeSession = sessionId;
  $('#crumb-agent').textContent = state.agentsById[agentId]?.name || agentId;
  if (topic) { $('#crumb-topic').textContent = topic; $('#crumb-topic-sep').hidden = false; }
  else { $('#crumb-topic').textContent = ''; $('#crumb-topic-sep').hidden = true; }
  showTerminal();
  try { rec.fit.fit(); rec.term.focus(); } catch {}
}

function toggleTerminalSearch() {
  const bar = $('#term-search-bar');
  bar.hidden = !bar.hidden;
  if (!bar.hidden) $('#term-search-input').focus();
}
window.toggleTerminalSearch = toggleTerminalSearch;
function closeTerminalSearch() { $('#term-search-bar').hidden = true; }
window.closeTerminalSearch = closeTerminalSearch;

function termSearchNext() {
  const rec = state.terminals[state.activeSession]; if (!rec) return;
  const q = $('#term-search-input').value; if (q) rec.search.findNext(q);
}
function termSearchPrev() {
  const rec = state.terminals[state.activeSession]; if (!rec) return;
  const q = $('#term-search-input').value; if (q) rec.search.findPrevious(q);
}
window.termSearchNext = termSearchNext; window.termSearchPrev = termSearchPrev;

function exportSession() {
  if (!state.activeSession) return;
  const rec = state.terminals[state.activeSession]; if (!rec) return;
  let out = ''; const buf = rec.term.buffer.active;
  for (let i = 0; i < buf.length; i++) out += buf.getLine(i).translateToString(true) + '\n';
  const blob = new Blob([out], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `session_${rec.agentId}_${Date.now()}.txt`; a.click();
}
window.exportSession = exportSession;

async function shareCurrentSession() {
  if (!state.activeSession) return;
  const rec = state.terminals[state.activeSession];
  let out = ''; const buf = rec.term.buffer.active;
  for (let i = 0; i < buf.length; i++) out += buf.getLine(i).translateToString(true) + '\n';
  try {
    const r = await api('/api/share', { method:'POST', body: { agentId: rec.agentId, topic: rec.topic, content: out } });
    const full = `${location.origin}${r.url}`;
    try { await navigator.clipboard.writeText(full); } catch {}
    toast(`Share link copied: ${full}`, 'ok');
  } catch (e) { toast(`Share failed: ${e.message}`, 'err'); }
}
window.shareCurrentSession = shareCurrentSession;

function renderSessionTabs() {
  const wrap = $('#session-tabs'); if (!wrap) return;
  const alive = state.sessions.filter(s => s.alive);
  if (alive.length === 0) { wrap.innerHTML=''; wrap.classList.remove('has-tabs'); return; }
  wrap.classList.add('has-tabs');
  wrap.innerHTML = alive.map(s => {
    const a = state.agentsById[s.agentId];
    const color = a?.color || '#ffb347';
    const active = s.id === state.activeSession ? 'active' : '';
    return `<button class="stab ${active}" style="--cell-color:${color}" onclick="switchToSession('${esc(s.id)}')" title="${esc(a?.name || s.agentId)}${s.topic ? ' · '+esc(s.topic):''}">
      <span class="stab-emoji">${esc(a?.emoji || '✦')}</span>
      <span class="stab-name">${esc(a?.name || s.agentId)}${s.topic ? `<em>/${esc(s.topic)}</em>` : ''}</span>
      <span class="stab-x" onclick="event.stopPropagation();closeSessionTab('${esc(s.id)}')">×</span>
    </button>`;
  }).join('');
}

function switchToSession(id) {
  const s = state.sessions.find(x => x.id === id); if (!s) return;
  openTerminal(id, s.agentId, s.topic); renderSessionTabs();
}
window.switchToSession = switchToSession;

async function closeSessionTab(id) {
  try { await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch {}
  const rec = state.terminals[id];
  if (rec) { try { rec.ws.close(); } catch {} try { rec.term.dispose(); } catch {} }
  delete state.terminals[id];
  if (state.activeSession === id) state.activeSession = null;
  await loadSessions(); renderSessionTabs();
  if (!state.activeSession) showHive();
}
window.closeSessionTab = closeSessionTab;

/* ═══════════════════════════════════════════════════════════════════
 * 🌊 #3 — SWARM DISPATCH
 * ═══════════════════════════════════════════════════════════════════ */
function openSwarm() {
  const wrap = $('#swarm-targets');
  wrap.innerHTML = state.agents.map(a => `
    <label class="swarm-pill" style="--cell-color:${esc(a.color || '#ffb347')}">
      <input type="checkbox" value="${esc(a.id)}">
      <span>${esc(a.emoji || '✦')} ${esc(a.name || a.id)}</span>
    </label>
  `).join('');
  $('#swarm-overlay').classList.add('open');
  $('#swarm-prompt').value = '';
  $('#swarm-track').innerHTML = '';
  updateSwarmCount();
  wrap.onchange = updateSwarmCount;
  $('#swarm-prompt').oninput = updateSwarmCount;
}
window.openSwarm = openSwarm;
function closeSwarm() { $('#swarm-overlay').classList.remove('open'); }
window.closeSwarm = closeSwarm;

function swarmToggleAll() {
  const boxes = $$('#swarm-targets input[type=checkbox]');
  const allOn = boxes.every(b => b.checked);
  boxes.forEach(b => b.checked = !allOn);
  updateSwarmCount();
}
window.swarmToggleAll = swarmToggleAll;

function updateSwarmCount() {
  const n = $$('#swarm-targets input:checked').length;
  const chars = ($('#swarm-prompt').value || '').length;
  $('#swarm-count').textContent = `${n} targets · ${chars} chars`;
}

async function swarmCast() {
  const targets = $$('#swarm-targets input:checked').map(b => b.value);
  const prompt = $('#swarm-prompt').value.trim();
  if (!targets.length || !prompt) { toast('Pick targets and type a prompt', 'err'); return; }
  const track = $('#swarm-track');
  track.innerHTML = targets.map(id => {
    const a = state.agentsById[id] || { name: id, emoji: '✦', color: '#ffb347' };
    return `<div class="lane" data-agent="${esc(id)}" style="--cell-color:${esc(a.color)}">
      <header><span>${esc(a.emoji)}</span><b>${esc(a.name)}</b><span class="lane-status">casting…</span></header>
      <pre class="lane-body"></pre>
    </div>`;
  }).join('');

  await Promise.all(targets.map(async id => {
    const lane = document.querySelector(`.lane[data-agent="${CSS.escape(id)}"]`);
    const body = lane.querySelector('.lane-body');
    const status = lane.querySelector('.lane-status');
    try {
      const r = await api('/api/quickchat', { method:'POST', body: { agentId: id, prompt } });
      body.textContent = r.response || '(no response)';
      status.textContent = 'done'; lane.classList.add('done');
    } catch (e) {
      body.textContent = `Error: ${e.message}`;
      status.textContent = 'err'; lane.classList.add('err');
    }
  }));
  toast(`Swarm complete (${targets.length})`, 'ok');
}
window.swarmCast = swarmCast;

/* ═══════════════════════════════════════════════════════════════════
 * ⏳ #4 — TIME RIVER
 * ═══════════════════════════════════════════════════════════════════ */
function toggleTimeRiver() {
  const r = $('#time-river'); const open = r.hasAttribute('hidden');
  if (open) { r.removeAttribute('hidden'); state.timeRiverOpen = true; drawTimeRiver(); }
  else { r.setAttribute('hidden',''); state.timeRiverOpen = false; }
}
window.toggleTimeRiver = toggleTimeRiver;

function drawTimeRiver() {
  const canvas = $('#time-river-canvas'); if (!canvas) return;
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const span = 24 * 3600 * 1000;
  const start = now() - span;
  const events = state.activity.filter(e => (e.timestamp || 0) > start);

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,179,71,0.06)');
  grad.addColorStop(0.5, 'rgba(255,179,71,0.16)');
  grad.addColorStop(1, 'rgba(255,179,71,0.04)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h*0.35, w, h*0.3);

  events.forEach(ev => {
    const x = ((ev.timestamp - start) / span) * w;
    const y = h * (0.5 + Math.sin(ev.timestamp/1e6)*0.15);
    const a = state.agentsById[ev.agentId];
    const color = a?.color || '#ffb347';
    const r = (ev.type === 'session_started' || ev.type === 'session_ended') ? 5 : 3;
    ctx.beginPath();
    ctx.arc(x, y, r * devicePixelRatio, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  });

  ctx.strokeStyle = 'rgba(255,179,71,0.6)';
  ctx.lineWidth = 1.2 * devicePixelRatio;
  ctx.beginPath(); ctx.moveTo(w-2, 0); ctx.lineTo(w-2, h); ctx.stroke();
}
window.addEventListener('resize', () => { if (state.timeRiverOpen) drawTimeRiver(); });

/* ═══════════════════════════════════════════════════════════════════
 * 🧘 #5 — FOCUS CHAMBER
 * ═══════════════════════════════════════════════════════════════════ */
function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  document.body.classList.toggle('focus-mode', state.focusMode);
  const hud = $('#focus-hud');
  if (state.focusMode && state.activeSession) {
    const rec = state.terminals[state.activeSession];
    const a = state.agentsById[rec?.agentId];
    if (a) {
      $('#focus-emoji').textContent = a.emoji || '✦';
      $('#focus-name').textContent = a.name || a.id;
      document.documentElement.style.setProperty('--aura-color', a.color || '#ffb347');
    }
    hud.hidden = false;
    setTimeout(() => { try { rec?.fit?.fit(); } catch {} }, 320);
  } else {
    hud.hidden = true;
    setTimeout(() => { const rec = state.terminals[state.activeSession]; try { rec?.fit?.fit(); } catch {} }, 320);
  }
}
window.toggleFocusMode = toggleFocusMode;

/* ═══════════════════════════════════════════════════════════════════
 * 🌱 #8 — MEMORY GARDEN
 * ═══════════════════════════════════════════════════════════════════ */
function openMemoryGarden(agentId) {
  const ov = $('#garden-overlay'); ov.classList.add('open');
  const sel = $('#garden-agent-select');
  sel.innerHTML = state.agents.map(a => `<option value="${esc(a.id)}">${esc(a.emoji||'✦')} ${esc(a.name||a.id)}</option>`).join('');
  const pick = agentId || state.activeAgent?.id || state.agents[0]?.id;
  if (pick) { sel.value = pick; loadGarden(pick); }
}
window.openMemoryGarden = openMemoryGarden;
function closeMemoryGarden() { $('#garden-overlay').classList.remove('open'); cancelAnimationFrame(gardenRAF); }
window.closeMemoryGarden = closeMemoryGarden;

async function loadGarden(agentId) {
  $('#garden-agent-name').textContent = state.agentsById[agentId]?.name || agentId;
  let files = [];
  try { files = await api(`/api/agents/${encodeURIComponent(agentId)}/memory`); } catch {}
  if (!Array.isArray(files)) files = [];
  const orbs = files.map((f, i) => ({
    id: f.name || f.filename || `orb_${i}`,
    name: f.name || f.filename || `mem ${i}`,
    size: Math.min(60, 14 + (f.size ? Math.log(f.size) * 3 : 14)),
    age: f.mtime ? (now() - new Date(f.mtime).getTime()) : i * 86400000,
    x: Math.random(), y: Math.random(),
    vx: (Math.random()-0.5)*0.15, vy: (Math.random()-0.5)*0.15,
    color: state.agentsById[agentId]?.color || '#ffb347',
  }));
  state.gardenOrbs = orbs;
  runGarden(agentId);
}
window.loadGarden = loadGarden;

let gardenRAF = null;
function runGarden(agentId) {
  const canvas = $('#garden-canvas'); const wrap = $('#garden-canvas-wrap');
  if (!canvas || !wrap) return;
  const ctx = canvas.getContext('2d');
  cancelAnimationFrame(gardenRAF);

  let dragOrb = null;
  function orbPt(e) {
    const src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    return { x: src.clientX, y: src.clientY };
  }
  function orbDown(e) {
    const p = orbPt(e);
    const rect = canvas.getBoundingClientRect();
    const mx = (p.x - rect.left) / rect.width;
    const my = (p.y - rect.top) / rect.height;
    dragOrb = state.gardenOrbs.find(o => {
      const dx = (o.x - mx) * rect.width; const dy = (o.y - my) * rect.height;
      return Math.hypot(dx, dy) < o.size;
    });
    if (dragOrb) showOrbDetails(agentId, dragOrb);
  }
  function orbMove(e) {
    if (!dragOrb) return;
    const p = orbPt(e);
    const rect = canvas.getBoundingClientRect();
    dragOrb.x = clamp((p.x - rect.left) / rect.width, 0, 1);
    dragOrb.y = clamp((p.y - rect.top) / rect.height, 0, 1);
    dragOrb.vx = dragOrb.vy = 0;
    if (e.cancelable && e.touches) e.preventDefault();
  }
  function orbUp() { dragOrb = null; }
  canvas.onmousedown = orbDown;
  canvas.onmousemove = orbMove;
  canvas.onmouseup = orbUp;
  canvas.ontouchstart = orbDown;
  canvas.ontouchmove = orbMove;
  canvas.ontouchend = orbUp;
  canvas.ontouchcancel = orbUp;

  function tick() {
    canvas.width = wrap.clientWidth * devicePixelRatio;
    canvas.height = wrap.clientHeight * devicePixelRatio;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    state.gardenOrbs.forEach(o => {
      o.x += o.vx * 0.005; o.y += o.vy * 0.005;
      if (o.x < 0 || o.x > 1) o.vx *= -1;
      if (o.y < 0 || o.y > 1) o.vy *= -1;
      o.x = clamp(o.x,0,1); o.y = clamp(o.y,0,1);
      const dimAge = Math.min(1, o.age / (30 * 86400000));
      const alpha = 0.9 - dimAge * 0.65;
      const px = o.x * W; const py = o.y * H; const r = o.size * devicePixelRatio;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r*2);
      g.addColorStop(0, rgba(o.color, alpha));
      g.addColorStop(0.5, rgba(o.color, alpha * 0.35));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, r*2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = rgba(o.color, alpha);
      ctx.beginPath(); ctx.arc(px, py, r*0.45, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = `rgba(244,230,204,${alpha*0.9})`;
      ctx.font = `${11 * devicePixelRatio}px Manrope, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(o.name.replace(/\.md$/,''), px, py + r + 14*devicePixelRatio);
    });
    gardenRAF = requestAnimationFrame(tick);
  }
  tick();
}

async function showOrbDetails(agentId, orb) {
  const box = $('#garden-orb-details');
  box.hidden = false;
  box.innerHTML = `<div class="orb-head"><b>${esc(orb.name)}</b><button class="icon-x" onclick="document.getElementById('garden-orb-details').hidden=true">×</button></div><div class="orb-body">loading…</div>`;
  try {
    const t = await api(`/api/agents/${encodeURIComponent(agentId)}/memory/${encodeURIComponent(orb.name)}`);
    box.querySelector('.orb-body').textContent = (t || '').slice(0, 2000);
  } catch (e) { box.querySelector('.orb-body').textContent = 'Failed: '+e.message; }
}

/* ═══════════════════════════════════════════════════════════════════
 * ⚡ #9 — PULSE CORE
 * ═══════════════════════════════════════════════════════════════════ */
function updatePulseCore() {
  const spokesG = $('#pulse-spokes'); if (!spokesG) return;
  const active = state.pulseCount;
  const heart = $('#pulse-heart'); const r1 = $('#pulse-ring-1');
  const tempo = clamp(1.8 - Math.min(active, 8) * 0.15, 0.6, 1.8);
  heart.style.animation = `heart ${tempo.toFixed(2)}s ease-in-out infinite`;
  r1.style.animation = `spinCw ${(28 - Math.min(active,6)*2).toFixed(1)}s linear infinite`;
  spokesG.innerHTML = '';
  const activeAgents = state.agents.filter(a => a.hasActiveSession);
  activeAgents.forEach((a, i) => {
    const ang = (Math.PI*2 * i / Math.max(activeAgents.length, 1)) - Math.PI/2;
    const x = Math.cos(ang) * 72; const y = Math.sin(ang) * 72;
    const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1','0'); ln.setAttribute('y1','0');
    ln.setAttribute('x2', x); ln.setAttribute('y2', y);
    ln.setAttribute('stroke', a.color || '#ffb347');
    ln.setAttribute('stroke-width', '1.2'); ln.setAttribute('opacity','.6');
    spokesG.appendChild(ln);
  });
}

/* ═══════════════════════════════════════════════════════════════════
 * INSPECTOR
 * ═══════════════════════════════════════════════════════════════════ */
let inspState = { agentId: null, section: 'files', list: [], current: null, editing: false };

async function openInspector(agentId) {
  inspState.agentId = agentId; inspState.section = 'files'; inspState.current = null;
  const a = state.agentsById[agentId];
  $('#inspector-emoji').textContent = a?.emoji || '✦';
  $('#inspector-name').textContent = a?.name || agentId;
  $$('.insp-tab').forEach(t => t.classList.toggle('active', t.dataset.section === 'files'));
  await inspectorShowSection('files');
  $('#inspector-overlay').classList.add('open');
}
window.openInspector = openInspector;
function closeInspector() { $('#inspector-overlay').classList.remove('open'); }
window.closeInspector = closeInspector;

async function inspectorShowSection(section) {
  inspState.section = section; inspState.current = null; inspState.editing = false;
  $$('.insp-tab').forEach(t => t.classList.toggle('active', t.dataset.section === section));
  $('#inspector-view').textContent = '';
  $('#inspector-editor').hidden = true; $('#inspector-editor').value = '';
  $('#inspector-current').textContent = '';
  $('#inspector-edit-btn').hidden = true; $('#inspector-save-btn').hidden = true;
  const list = $('#inspector-list');
  list.innerHTML = '<div class="insp-dim">loading…</div>';
  const id = inspState.agentId;
  try {
    if (section === 'files') {
      const files = await api(`/api/agents/${encodeURIComponent(id)}/files`);
      inspState.list = files;
      list.innerHTML = (files || []).map(f => `<button class="insp-li" onclick="inspectorOpen('${esc(f.name || f.filename || f)}')">${esc(f.name || f.filename || f)}</button>`).join('') || '<div class="insp-dim">no files</div>';
    } else if (section === 'memory') {
      const files = await api(`/api/agents/${encodeURIComponent(id)}/memory`);
      inspState.list = files;
      list.innerHTML = (files || []).map(f => `<button class="insp-li" onclick="inspectorOpen('${esc(f.name || f.filename || f)}')">${esc(f.name || f.filename || f)}</button>`).join('') || '<div class="insp-dim">no memory</div>';
    } else if (section === 'topics') {
      const a = state.agentsById[id];
      const topics = a?.topics || [];
      list.innerHTML = topics.map(t => `<button class="insp-li" onclick="inspectorOpenTopic('${esc(t)}','TOPIC.md')">${esc(t)}</button>`).join('') || '<div class="insp-dim">no topics</div>';
    }
  } catch (e) { list.innerHTML = `<div class="insp-dim">Error: ${esc(e.message)}</div>`; }
}
window.inspectorShowSection = inspectorShowSection;

async function inspectorOpen(filename) {
  inspState.current = filename; inspState.editing = false;
  $('#inspector-current').textContent = filename;
  const id = inspState.agentId; const section = inspState.section;
  try {
    const text = section === 'memory'
      ? await api(`/api/agents/${encodeURIComponent(id)}/memory/${encodeURIComponent(filename)}`)
      : await api(`/api/agents/${encodeURIComponent(id)}/files/${encodeURIComponent(filename)}`);
    $('#inspector-view').textContent = text;
    $('#inspector-view').hidden = false;
    $('#inspector-editor').value = text; $('#inspector-editor').hidden = true;
    $('#inspector-edit-btn').hidden = section === 'memory';
    $('#inspector-save-btn').hidden = true;
  } catch (e) { $('#inspector-view').textContent = 'Error: '+e.message; }
}
window.inspectorOpen = inspectorOpen;

async function inspectorOpenTopic(topic, filename) {
  inspState.current = `${topic}/${filename}`;
  $('#inspector-current').textContent = `${topic} / ${filename}`;
  const id = inspState.agentId;
  try {
    const text = await api(`/api/agents/${encodeURIComponent(id)}/topics/${encodeURIComponent(topic)}/${encodeURIComponent(filename)}`);
    $('#inspector-view').textContent = text;
  } catch (e) { $('#inspector-view').textContent = 'Error: '+e.message; }
}
window.inspectorOpenTopic = inspectorOpenTopic;

function inspectorToggleEdit() {
  inspState.editing = !inspState.editing;
  $('#inspector-view').hidden = inspState.editing;
  $('#inspector-editor').hidden = !inspState.editing;
  $('#inspector-save-btn').hidden = !inspState.editing;
  if (inspState.editing) $('#inspector-editor').focus();
}
window.inspectorToggleEdit = inspectorToggleEdit;

async function inspectorSave() {
  const content = $('#inspector-editor').value;
  const id = inspState.agentId; const fn = inspState.current;
  try {
    await api(`/api/agents/${encodeURIComponent(id)}/files/${encodeURIComponent(fn)}`, { method:'PUT', body: { content } });
    $('#inspector-view').textContent = content;
    toast('Saved', 'ok');
    inspectorToggleEdit();
  } catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
}
window.inspectorSave = inspectorSave;

/* ═══════════════════════════════════════════════════════════════════
 * SKILLS / TOPICS / HEALTH
 * ═══════════════════════════════════════════════════════════════════ */
async function openSkills() {
  $('#skills-overlay').classList.add('open');
  const list = $('#skills-list');
  list.innerHTML = '<div class="insp-dim">loading…</div>';
  try {
    const skills = await api('/api/skills');
    $('#skills-count').textContent = `${skills.length} skills`;
    list.innerHTML = skills.map(s => `<button class="insp-li" data-id="${esc(s.id || s.name)}" onclick="openSkillView('${esc(s.id || s.name)}','${esc(s.name || s.id)}')">${esc(s.name || s.id)}<span class="insp-sub">${esc(s.description || '')}</span></button>`).join('');
    $('#skills-search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $$('#skills-list .insp-li').forEach(b => { b.style.display = b.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    };
  } catch (e) { list.innerHTML = `<div class="insp-dim">Error: ${esc(e.message)}</div>`; }
}
window.openSkills = openSkills;
function closeSkills() { $('#skills-overlay').classList.remove('open'); }
window.closeSkills = closeSkills;

async function openSkillView(id, name) {
  $('#skills-current').textContent = name;
  try {
    const text = await api(`/api/skills/${encodeURIComponent(id)}`);
    $('#skills-view').textContent = text;
  } catch (e) { $('#skills-view').textContent = 'Error: '+e.message; }
}
window.openSkillView = openSkillView;

async function openTopics() {
  $('#topics-overlay').classList.add('open');
  const list = $('#topics-list');
  list.innerHTML = '<div class="insp-dim">loading…</div>';
  try {
    const topics = await api('/api/topics');
    $('#topics-count').textContent = `${topics.length} topics`;
    list.innerHTML = topics.map(t => `
      <div class="topic-row" onclick="launchAgent('${esc(t.agentId)}','${esc(t.name || t.topic)}')">
        <span class="topic-emoji">${esc(state.agentsById[t.agentId]?.emoji || '✦')}</span>
        <div><b>${esc(t.name || t.topic)}</b><em>${esc(t.agentId)}</em></div>
        <button class="btn btn-primary btn-xs" onclick="event.stopPropagation();launchAgent('${esc(t.agentId)}','${esc(t.name || t.topic)}')">Summon</button>
      </div>`).join('') || '<div class="insp-dim">no topics</div>';
    $('#topics-search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $$('#topics-list .topic-row').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    };
  } catch (e) { list.innerHTML = `<div class="insp-dim">Error: ${esc(e.message)}</div>`; }
}
window.openTopics = openTopics;
function closeTopics() { $('#topics-overlay').classList.remove('open'); }
window.closeTopics = closeTopics;

async function openAgentHealth() {
  $('#health-overlay').classList.add('open');
  $('#health-summary').textContent = 'Scanning…';
  const list = $('#health-list');
  list.innerHTML = '<div class="insp-dim">loading…</div>';
  try {
    const res = await api('/api/health/agents');
    const items = Array.isArray(res) ? res : (res.agents || []);
    const healthy = items.filter(x => !x.issues || x.issues.length === 0).length;
    $('#health-summary').textContent = `${healthy}/${items.length} healthy`;
    list.innerHTML = items.map(h => {
      const a = state.agentsById[h.agentId || h.id] || {};
      const ok = !h.issues || h.issues.length === 0;
      return `<div class="health-row ${ok?'ok':'warn'}" style="--cell-color:${esc(a.color || '#ffb347')}">
        <span class="h-emoji">${esc(a.emoji || '✦')}</span>
        <div class="h-main"><b>${esc(a.name || h.agentId)}</b>
          <em>${ok ? 'healthy' : (h.issues || []).map(esc).join(' · ')}</em>
        </div>
        <span class="h-dot ${ok?'ok':'warn'}"></span>
      </div>`;
    }).join('') || '<div class="insp-dim">no data</div>';
  } catch (e) { list.innerHTML = `<div class="insp-dim">Error: ${esc(e.message)}</div>`; }
}
window.openAgentHealth = openAgentHealth;
function closeAgentHealth() { $('#health-overlay').classList.remove('open'); }
window.closeAgentHealth = closeAgentHealth;

/* ═══════════════════════════════════════════════════════════════════
 * ACTIVITY FEED
 * ═══════════════════════════════════════════════════════════════════ */
function toggleActivityFeed() {
  const el = $('#activity-feed');
  const hidden = el.hasAttribute('hidden');
  if (hidden) { el.removeAttribute('hidden'); renderActivity(); }
  else el.setAttribute('hidden','');
}
window.toggleActivityFeed = toggleActivityFeed;

function renderActivity() {
  const list = $('#activity-list'); if (!list) return;
  list.innerHTML = '';
  state.activity.slice(-40).reverse().forEach(ev => renderActivityRow(ev));
}

function renderActivityRow(ev, prepend) {
  const list = $('#activity-list'); if (!list) return;
  const a = state.agentsById[ev.agentId] || {};
  const color = a.color || '#ffb347';
  const row = document.createElement('div');
  row.className = 'act-row';
  row.style.setProperty('--cell-color', color);
  row.innerHTML = `<span class="act-dot"></span><span class="act-emoji">${esc(a.emoji || '•')}</span><div class="act-text"><b>${esc(ev.type || 'event')}</b><em>${esc(ev.text || ev.message || '')}</em></div><span class="act-time">${relTime(ev.timestamp || now())}</span>`;
  if (prepend) list.prepend(row); else list.appendChild(row);
  while (list.childElementCount > 80) list.lastElementChild.remove();
}

/* ═══════════════════════════════════════════════════════════════════
 * SETTINGS / WEBHOOKS
 * ═══════════════════════════════════════════════════════════════════ */
async function openSettings() {
  $('#settings-overlay').classList.add('open');
  try {
    const { secret } = await api('/api/webhooks/secret');
    $('#set-webhook-secret').textContent = `${location.origin}/api/webhooks/${secret}/<agentId>`;
  } catch { $('#set-webhook-secret').textContent = '(unavailable)'; }
  try {
    const out = await api('/api/webhooks/outgoing');
    const urls = Array.isArray(out) ? out : (out.urls || []);
    $('#set-webhooks').value = urls.join('\n');
  } catch {}
  $('#set-aura-intensity').value = state.auraIntensity;
  $('#set-motion-calm').checked = state.calmMotion;
  $('#set-ambient').checked = state.ambientHum;
}
window.openSettings = openSettings;
function closeSettings() { $('#settings-overlay').classList.remove('open'); }
window.closeSettings = closeSettings;

async function saveWebhooks() {
  const urls = $('#set-webhooks').value.split('\n').map(s => s.trim()).filter(Boolean);
  try { await api('/api/webhooks/outgoing', { method:'PUT', body: { urls } }); toast('Webhooks saved', 'ok'); }
  catch (e) { toast('Save failed: '+e.message, 'err'); }
}
window.saveWebhooks = saveWebhooks;

async function toggleNotifications(on) {
  if (on && 'Notification' in window) {
    const p = await Notification.requestPermission();
    state.notifOk = p === 'granted';
  } else state.notifOk = false;
}
window.toggleNotifications = toggleNotifications;

/* ═══════════════════════════════════════════════════════════════════
 * QUICK CHAT
 * ═══════════════════════════════════════════════════════════════════ */
let quickChatTarget = null;
function openQuickChat(agentId) {
  quickChatTarget = agentId;
  const a = state.agentsById[agentId];
  $('#quickchat-title').textContent = `Quick ask · ${a?.emoji || ''} ${a?.name || agentId}`;
  $('#quickchat-input').value = '';
  $('#quickchat-response').hidden = true;
  $('#quickchat-overlay').classList.add('open');
  $('#quickchat-input').focus();
}
window.openQuickChat = openQuickChat;
function closeQuickChat() { $('#quickchat-overlay').classList.remove('open'); }
window.closeQuickChat = closeQuickChat;

async function sendQuickChat() {
  const prompt = $('#quickchat-input').value.trim();
  if (!prompt || !quickChatTarget) return;
  const pre = $('#quickchat-response');
  pre.hidden = false; pre.textContent = '...thinking...';
  try {
    const r = await api('/api/quickchat', { method:'POST', body: { agentId: quickChatTarget, prompt } });
    pre.textContent = r.response || '(no response)';
  } catch (e) { pre.textContent = 'Error: '+e.message; }
}
window.sendQuickChat = sendQuickChat;

/* ═══════════════════════════════════════════════════════════════════
 * PINS / TTS / VOICE
 * ═══════════════════════════════════════════════════════════════════ */
function restorePinned() {
  try { state.pinned = new Set(JSON.parse(localStorage.getItem('pinned') || '[]')); } catch {}
}

let ttsQ = [];
function queueTTS(text) {
  if (!('speechSynthesis' in window)) return;
  ttsQ.push(text); if (!window.speechSynthesis.speaking) speakNext();
}
function speakNext() {
  if (!ttsQ.length) return;
  const u = new SpeechSynthesisUtterance(ttsQ.shift().replace(/\x1b\[[0-9;]*m/g,''));
  u.onend = speakNext; u.rate = 1; u.pitch = 1;
  window.speechSynthesis.speak(u);
}
function toggleTTS() {
  state.ttsEnabled = !state.ttsEnabled;
  $('#tts-btn').classList.toggle('on', state.ttsEnabled);
  toast(`TTS ${state.ttsEnabled?'on':'off'}`, 'info');
  if (!state.ttsEnabled) window.speechSynthesis?.cancel();
}
window.toggleTTS = toggleTTS;

let recog = null;
function toggleVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice not supported', 'err'); return; }
  if (recog) { recog.stop(); recog = null; $('#voice-btn').classList.remove('on'); return; }
  recog = new SR(); recog.continuous = false; recog.interimResults = false;
  recog.onresult = (e) => {
    const txt = e.results[0][0].transcript;
    const rec = state.terminals[state.activeSession];
    if (rec) try { rec.ws.send(JSON.stringify({type:'input', data: txt + '\r'})); } catch {}
  };
  recog.onend = () => { $('#voice-btn').classList.remove('on'); recog = null; };
  recog.start();
  $('#voice-btn').classList.add('on');
}
window.toggleVoiceInput = toggleVoiceInput;

/* ═══════════════════════════════════════════════════════════════════
 * GLOBAL HANDLERS
 * ═══════════════════════════════════════════════════════════════════ */
function attachGlobalHandlers() {
  $$('#filter-ring .ring-chip').forEach(b => {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      $$('#filter-ring .ring-chip').forEach(x => x.classList.toggle('active', x === b));
      renderHive(); renderGrid(); renderList();
    });
  });
  $('#hive-search-input')?.addEventListener('input', (e) => { state.search = e.target.value; renderHive(); });
  $('#grid-search-input')?.addEventListener('input', (e) => { state.search = e.target.value; renderGrid(); });

  document.addEventListener('click', (e) => {
    const card = $('#detail-card');
    if (!card.hidden && !card.contains(e.target) && !e.target.closest('[data-agent]') && !e.target.closest('.agent-card')) closeDetail();
  });

  window.addEventListener('resize', () => { if (state.view === 'hive') renderHive(); });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    if (e.key === 'Escape') {
      ['incantation-overlay','swarm-overlay','garden-overlay','inspector-overlay','skills-overlay','topics-overlay','health-overlay','settings-overlay','quickchat-overlay','topic-modal','shortcuts-overlay'].forEach(id => { const el = $('#'+id); if (el) el.classList.remove('open'); });
      closeDetail();
      if (state.focusMode) toggleFocusMode();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openIncantation(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && inspState.editing) { e.preventDefault(); inspectorSave(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && state.view === 'terminal') { e.preventDefault(); toggleTerminalSearch(); return; }
    if ((e.ctrlKey || e.metaKey) && /^[1-8]$/.test(e.key)) {
      const alive = state.sessions.filter(s => s.alive);
      const pick = alive[parseInt(e.key,10)-1];
      if (pick) { e.preventDefault(); switchToSession(pick.id); }
      return;
    }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); $('#hive-search-input')?.focus(); return; }
    if (e.key === '?') { toggleShortcuts(); return; }
    const k = e.key.toLowerCase();
    if (k === 'h') showHive();
    else if (k === 'g') showGrid();
    else if (k === 'l') showList();
    else if (k === 'f') toggleFocusMode();
    else if (k === 't') toggleTimeRiver();
    else if (k === 's') openSwarm();
    else if (k === 'm') openMemoryGarden();
    else if (k === 'a') toggleActivityFeed();
  });
}

function toggleShortcuts() { $('#shortcuts-overlay').classList.toggle('open'); }
window.toggleShortcuts = toggleShortcuts;

function openIncantation() {
  $('#incantation-overlay').classList.add('open');
  setTimeout(() => $('#incantation-input').focus(), 50);
  if (window.incantationInit) window.incantationInit();
}
window.openIncantation = openIncantation;
function closeIncantation() { $('#incantation-overlay').classList.remove('open'); }
window.closeIncantation = closeIncantation;
