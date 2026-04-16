/* ═══════════════════════════════════════════════════════════════════
 * THE HIVE — 🔟 Incantation Bar
 * Natural-language intent parser for the Hive. Replaces a flat command
 * palette with a sentence-aware caster: "tell atlas to research homelab
 * costs" loads the right agent + topic and opens with your opening
 * message. Falls back to fuzzy list navigation.
 * ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  const INTENT_VERBS = [
    { re: /^(?:tell|ask|summon|call|invoke|wake(?:\s+up)?)\s+@?([\w\-]+)(?:\s+(?:to|about|for|on)\s+(.+))?$/i, kind: 'summon' },
    { re: /^@([\w\-]+)(?:\s+(.+))?$/i, kind: 'summon' },
    { re: /^(?:swarm|@all|@swarm)\s+(.+)$/i, kind: 'swarm' },
    { re: /^(?:topics?|list topics?)\s+@?([\w\-]+)?$/i, kind: 'topics' },
    { re: /^(?:inspect|files?|memory)\s+@?([\w\-]+)$/i, kind: 'inspect' },
    { re: /^(?:kill|end)\s+(?:all|sessions?)$/i, kind: 'kill-all' },
    { re: /^(?:focus|zen)\s*$/i, kind: 'focus' },
    { re: /^(?:time|river|timeline)\s*$/i, kind: 'time-river' },
    { re: /^(?:settings|theme|aura)\s*$/i, kind: 'settings' },
    { re: /^(?:skills?)\s*$/i, kind: 'skills' },
    { re: /^(?:health|status)\s*$/i, kind: 'health' },
    { re: /^(?:memory garden|garden)\s*(?:@?([\w\-]+))?$/i, kind: 'garden' },
    { re: /^(?:help|\?)\s*$/i, kind: 'help' },
  ];

  let selected = 0;
  let entries = [];
  let parseBox, listBox, input;

  function init() {
    input = document.getElementById('incantation-input');
    parseBox = document.getElementById('incantation-parse');
    listBox = document.getElementById('incantation-list');
    if (!input) return;
    input.value = '';
    parseBox.innerHTML = '';
    render('');
    input.oninput = (e) => { selected = 0; render(e.target.value); };
    input.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, entries.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); cast(input.value); }
      else if (e.key === 'Tab' && entries[selected]?.agentId) {
        e.preventDefault();
        input.value = `@${entries[selected].agentId} `;
        render(input.value);
      }
    };
  }
  window.incantationInit = init;

  function parseIntent(text) {
    const t = text.trim();
    if (!t) return null;
    for (const p of INTENT_VERBS) {
      const m = t.match(p.re);
      if (m) return { kind: p.kind, a: m[1], b: m[2], raw: t };
    }
    // Short-circuit: single-word agent id?
    const agents = (window.hiveApi?.getAgents() || []);
    const bare = agents.find(a => a.id === t.toLowerCase());
    if (bare) return { kind: 'summon', a: bare.id, b: null, raw: t };
    return null;
  }

  function describeIntent(intent) {
    if (!intent) return '';
    const agents = (window.hiveApi?.getAgents() || []);
    const findAgent = (q) => agents.find(a => a.id.toLowerCase() === q?.toLowerCase())
      || agents.find(a => a.name?.toLowerCase() === q?.toLowerCase())
      || agents.find(a => a.id.toLowerCase().includes(q?.toLowerCase() || ''));
    switch (intent.kind) {
      case 'summon': {
        const a = findAgent(intent.a);
        if (!a) return `<span class="parse-unknown">no agent matches “${escapeHtml(intent.a)}”</span>`;
        const promptBit = intent.b ? ` · opening message: <em>${escapeHtml(intent.b)}</em>` : '';
        return `<span class="parse-good">summon ${escapeHtml(a.emoji||'')} <b>${escapeHtml(a.name)}</b></span>${promptBit}`;
      }
      case 'swarm': return `<span class="parse-good">cast to <b>all agents</b></span> · <em>${escapeHtml(intent.a)}</em>`;
      case 'topics': return `<span class="parse-good">list topics${intent.a?` for <b>${escapeHtml(intent.a)}</b>`:''}</span>`;
      case 'inspect': return `<span class="parse-good">inspect workspace of <b>${escapeHtml(intent.a)}</b></span>`;
      case 'kill-all': return `<span class="parse-warn">end <b>all</b> sessions</span>`;
      case 'focus': return `<span class="parse-good">enter <b>focus chamber</b></span>`;
      case 'time-river': return `<span class="parse-good">toggle <b>time river</b></span>`;
      case 'settings': return `<span class="parse-good">open <b>settings</b></span>`;
      case 'skills': return `<span class="parse-good">open <b>skills</b></span>`;
      case 'health': return `<span class="parse-good">open <b>agent health</b></span>`;
      case 'garden': return `<span class="parse-good">open <b>memory garden</b>${intent.a?` for ${escapeHtml(intent.a)}`:''}</span>`;
      case 'help': return `<span class="parse-good">keyboard help</span>`;
      default: return '';
    }
  }

  function render(text) {
    const intent = parseIntent(text);
    parseBox.innerHTML = intent ? describeIntent(intent) : '';

    const q = text.toLowerCase().trim();
    const agents = (window.hiveApi?.getAgents() || []);
    entries = [];

    // If intent is a clear summon, show that first
    if (intent) {
      entries.push({
        kind: 'intent', label: describeIntent(intent), action: () => execIntent(intent),
      });
    }

    // Agents matching
    const matches = agents
      .map(a => ({ a, score: scoreAgent(a, q) }))
      .filter(x => x.score > 0)
      .sort((x,y) => y.score - x.score)
      .slice(0, 8);
    matches.forEach(({ a }) => {
      entries.push({
        kind: 'agent',
        agentId: a.id,
        label: `<span class="ent-em">${escapeHtml(a.emoji || '✦')}</span><b>${escapeHtml(a.name)}</b><em>${escapeHtml(a.role || '')}</em>`,
        action: () => window.hiveApi.launchAgent(a.id),
      });
    });

    // Commands (only when no clearly-resolved intent or free text)
    const cmds = [
      { words: ['hive','view','constellation'], label: '🕸 View: Hive Constellation', action: () => window.showHive?.() },
      { words: ['grid','cards'],                label: '▦ View: Grid',                 action: () => window.showGrid?.() },
      { words: ['list','table'],                label: '☰ View: List',                 action: () => window.showList?.() },
      { words: ['swarm','dispatch','broadcast'],label: '🌊 Swarm Dispatch',            action: () => window.openSwarm?.() },
      { words: ['memory','garden','orbs'],      label: '🌱 Memory Garden',              action: () => window.openMemoryGarden?.() },
      { words: ['time','river','timeline'],     label: '⏳ Time River',                 action: () => window.toggleTimeRiver?.() },
      { words: ['focus','zen','chamber'],       label: '🧘 Focus Chamber',              action: () => window.toggleFocusMode?.() },
      { words: ['skills','catalog'],            label: '✨ Skills Catalog',             action: () => window.openSkills?.() },
      { words: ['topics','browser'],            label: '🗂 Topics',                     action: () => window.openTopics?.() },
      { words: ['health','status'],             label: '🩺 Agent Health',               action: () => window.openAgentHealth?.() },
      { words: ['activity','feed','events'],    label: '📡 Activity feed',              action: () => window.toggleActivityFeed?.() },
      { words: ['settings','theme','aura'],     label: '⚙ Settings',                   action: () => window.openSettings?.() },
      { words: ['help','shortcuts','keyboard'], label: '⌨ Keyboard shortcuts',          action: () => window.toggleShortcuts?.() },
    ];
    cmds.forEach(c => {
      const s = q ? Math.max(0, ...c.words.map(w => w.startsWith(q) ? 2 : (w.includes(q) ? 1 : 0))) : 0.2;
      if (s > 0) entries.push({ kind: 'cmd', label: c.label, action: c.action });
    });

    if (entries.length === 0) {
      entries.push({ kind: 'hint', label: '<em>Try: <code>tell atlas to research homelab</code>, <code>@pixel</code>, <code>swarm summarize today</code></em>', action: ()=>{} });
    }
    selected = 0;
    paint();
  }

  function paint() {
    listBox.innerHTML = entries.map((e, i) => `
      <button class="inc-ent ${i === selected ? 'sel' : ''} kind-${e.kind}" data-i="${i}">
        ${e.label}
      </button>
    `).join('');
    listBox.querySelectorAll('.inc-ent').forEach(b => {
      b.onclick = () => { selected = parseInt(b.dataset.i, 10); cast(input.value); };
      b.onmouseenter = () => { selected = parseInt(b.dataset.i, 10); paint(); };
    });
    const sel = listBox.querySelector('.inc-ent.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function scoreAgent(a, q) {
    if (!q) return 0;
    const id = (a.id || '').toLowerCase();
    const name = (a.name || '').toLowerCase();
    const role = (a.role || '').toLowerCase();
    const cat = (a.category || '').toLowerCase();
    let s = 0;
    if (id === q || name === q) s += 100;
    if (id.startsWith(q)) s += 40;
    if (name.startsWith(q)) s += 30;
    if (id.includes(q)) s += 14;
    if (name.includes(q)) s += 12;
    if (role.includes(q)) s += 6;
    if (cat.includes(q)) s += 4;
    // Fuzzy letters
    let j = 0; for (const ch of q) { j = id.indexOf(ch, j); if (j === -1) { s -= 5; break; } j++; }
    return s;
  }

  function cast(text) {
    const ent = entries[selected];
    if (ent) { window.closeIncantation?.(); setTimeout(() => ent.action(), 20); return; }
    const intent = parseIntent(text);
    if (intent) { window.closeIncantation?.(); setTimeout(() => execIntent(intent), 20); }
  }

  function execIntent(intent) {
    const agents = (window.hiveApi?.getAgents() || []);
    const findAgent = (q) => agents.find(a => a.id.toLowerCase() === q?.toLowerCase())
      || agents.find(a => a.name?.toLowerCase() === q?.toLowerCase())
      || agents.find(a => a.id.toLowerCase().includes(q?.toLowerCase() || ''));
    switch (intent.kind) {
      case 'summon': {
        const a = findAgent(intent.a);
        if (!a) { window.toast?.(`No agent matches “${intent.a}”`, 'err'); return; }
        if (intent.b) {
          // Summon, then paste the opening message after a short delay
          window.hiveApi.launchAgent(a.id);
          setTimeout(() => {
            const sid = window.state?.activeSession;
            const rec = window.state?.terminals?.[sid];
            if (rec?.ws && rec.ws.readyState === 1) {
              try { rec.ws.send(JSON.stringify({ type: 'input', data: intent.b + '\r' })); } catch {}
            }
          }, 700);
        } else {
          window.hiveApi.launchAgent(a.id);
        }
        return;
      }
      case 'swarm': {
        window.openSwarm?.();
        setTimeout(() => {
          const prompt = document.getElementById('swarm-prompt');
          if (prompt) prompt.value = intent.a || '';
          document.querySelectorAll('#swarm-targets input').forEach(b => b.checked = true);
          document.dispatchEvent(new Event('keyup'));
        }, 50);
        return;
      }
      case 'topics': window.openTopics?.(); return;
      case 'inspect': {
        const a = findAgent(intent.a); if (a) window.openInspector?.(a.id); return;
      }
      case 'kill-all': {
        if (!confirm('End ALL active sessions?')) return;
        window.hiveApi.api('/api/sessions/kill-all', { method: 'POST', body: {} })
          .then(r => window.toast?.(`Killed ${r.killed || 0} sessions`, 'ok'))
          .catch(e => window.toast?.(`Error: ${e.message}`, 'err'));
        return;
      }
      case 'focus': window.toggleFocusMode?.(); return;
      case 'time-river': window.toggleTimeRiver?.(); return;
      case 'settings': window.openSettings?.(); return;
      case 'skills': window.openSkills?.(); return;
      case 'health': window.openAgentHealth?.(); return;
      case 'garden': {
        const a = intent.a ? findAgent(intent.a) : null;
        window.openMemoryGarden?.(a?.id); return;
      }
      case 'help': window.toggleShortcuts?.(); return;
    }
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // Initialize parse box placeholder if overlay is opened before init happens
  document.addEventListener('DOMContentLoaded', () => {
    // Lazy init when opened (dashboard calls window.incantationInit)
  });
})();
