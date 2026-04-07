// ══════════════════════════════════════════════════════════════
//  Command Palette (Ctrl+K / Cmd+K) — #1
//  Fuzzy search for agents, topics, sessions, and commands.
// ══════════════════════════════════════════════════════════════

(function () {
  let paletteOpen = false;
  let selectedIndex = 0;
  let items = [];

  const overlay = document.getElementById('palette-overlay');
  const input = document.getElementById('palette-input');
  const list = document.getElementById('palette-list');

  if (!overlay || !input || !list) return;

  // ── Open / Close ──────────────────────────────────────────
  function open() {
    paletteOpen = true;
    overlay.classList.add('open');
    input.value = '';
    selectedIndex = 0;
    buildItems();
    render();
    input.focus();
  }

  function close() {
    paletteOpen = false;
    overlay.classList.remove('open');
    input.blur();
  }

  // ── Build searchable items ────────────────────────────────
  function buildItems() {
    items = [];

    // Agents
    if (typeof agents !== 'undefined') {
      for (const a of agents) {
        items.push({
          type: 'agent',
          icon: a.emoji || '🤖',
          label: a.name,
          hint: a.role,
          action: () => { close(); onAgentClick(a.id); },
        });
        // Topics under each agent
        for (const t of a.topics || []) {
          items.push({
            type: 'topic',
            icon: '📂',
            label: `${a.name} → ${t}`,
            hint: 'topic',
            action: () => { close(); launchAgent(a.id, t); },
          });
        }
      }
    }

    // Active sessions
    if (typeof terminals !== 'undefined') {
      for (const [sid, entry] of terminals) {
        items.push({
          type: 'session',
          icon: entry.agent?.emoji || '💬',
          label: `Switch to ${entry.agent?.name || sid}${entry.topic ? ': ' + entry.topic : ''}`,
          hint: 'active session',
          action: () => { close(); switchToSession(sid); },
        });
      }
    }

    // Commands
    items.push(
      { type: 'command', icon: '🏠', label: 'Go to Dashboard', hint: 'Esc', action: () => { close(); showDashboard(); } },
      { type: 'command', icon: '🔍', label: 'Focus Search', hint: '/', action: () => { close(); document.getElementById('agent-search')?.focus(); } },
      { type: 'command', icon: '❓', label: 'Keyboard Shortcuts', hint: '?', action: () => { close(); toggleShortcutsOverlay(); } },
      { type: 'command', icon: '📂', label: 'Browse Topics', hint: '', action: () => { close(); openTopics(); } },
      { type: 'command', icon: '✨', label: 'Browse Skills', hint: '', action: () => { close(); openSkills(); } },
      { type: 'command', icon: '⚙', label: 'Settings', hint: '', action: () => { close(); openSettings(); } },
      { type: 'command', icon: '📡', label: 'Broadcast to all agents', hint: '', action: () => { close(); openBroadcast(); } },
      { type: 'command', icon: '📊', label: "Today's Activity Digest", hint: '', action: () => { close(); openDigest(); } },
      { type: 'command', icon: '🔍', label: 'Search session history', hint: '', action: () => { close(); openHistorySearch(); } },
      { type: 'command', icon: '💾', label: 'Save current view as project', hint: '', action: () => { close(); promptSaveProject(); } },
      { type: 'command', icon: '📦', label: 'Load saved project', hint: '', action: () => { close(); promptLoadProject(); } },
    );

    // If there's an active session, add kill command
    if (typeof currentSessionId !== 'undefined' && currentSessionId) {
      items.push({
        type: 'command',
        icon: '⏹',
        label: 'End Current Session',
        hint: '',
        action: () => { close(); killCurrentSession(); },
      });
    }
  }

  // ── Fuzzy filter ──────────────────────────────────────────
  function fuzzyMatch(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.includes(q)) return true;
    // Simple character-by-character fuzzy
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function getFiltered() {
    const q = input.value.trim();
    if (!q) return items;
    return items.filter(item => fuzzyMatch(q, item.label) || fuzzyMatch(q, item.hint));
  }

  // ── Global Search via API (B4 #1) ─────────────────────────
  let serverResults = [];
  let serverSearchTimer = null;

  async function fetchGlobalResults(q) {
    if (!q || q.length < 2) { serverResults = []; render(); return; }
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      serverResults = data.map(r => ({
        type: 'global-' + r.type,
        icon: r.type === 'topic' ? '📂' : r.type === 'skill' ? '✨' : r.type === 'file' ? '📄' : '🔍',
        label: r.title,
        hint: r.preview ? r.preview.slice(0, 60) : r.type,
        action: () => {
          close();
          if (r.type === 'topic' && r.agentId) launchAgent(r.agentId, r.title.split('→').pop().trim());
          else if (r.type === 'skill') openSkills();
          else if (r.type === 'file' && r.agentId) openInspector(r.agentId);
        },
      }));
      render();
    } catch {}
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    const localFiltered = getFiltered();
    const filtered = [...localFiltered, ...serverResults];
    selectedIndex = Math.max(0, Math.min(selectedIndex, filtered.length - 1));

    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = '<div class="palette-empty">No matches</div>';
      return;
    }

    filtered.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = `palette-item${i === selectedIndex ? ' selected' : ''}`;
      el.innerHTML = `
        <span class="palette-icon">${item.icon}</span>
        <span class="palette-label">${escPalette(item.label)}</span>
        <span class="palette-hint">${escPalette(item.hint)}</span>
      `;
      el.addEventListener('click', () => item.action());
      el.addEventListener('mouseenter', () => {
        selectedIndex = i;
        render();
      });
      list.appendChild(el);
    });

    // Scroll selected into view
    const selected = list.querySelector('.palette-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function escPalette(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Keyboard ──────────────────────────────────────────────
  input.addEventListener('input', () => {
    selectedIndex = 0;
    render();
    // Debounced server search
    if (serverSearchTimer) clearTimeout(serverSearchTimer);
    serverSearchTimer = setTimeout(() => fetchGlobalResults(input.value.trim()), 250);
  });

  input.addEventListener('keydown', (e) => {
    const filtered = getFiltered();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % Math.max(1, filtered.length);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filtered.length) % Math.max(1, filtered.length);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) filtered[selectedIndex].action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // ── Global shortcut: Ctrl+K / Cmd+K ──────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (paletteOpen) close(); else open();
    }
  });

  // Expose for external use
  window.openCommandPalette = open;
  window.closeCommandPalette = close;
})();
