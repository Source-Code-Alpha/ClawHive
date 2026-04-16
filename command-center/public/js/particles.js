/* ═══════════════════════════════════════════════════════════════════
 * THE HIVE — Honey bokeh background
 * Slow-drifting amber motes, drifting upward like pollen in warm light.
 * Respects prefers-reduced-motion + .calm mode.
 * ═══════════════════════════════════════════════════════════════════ */
(function() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = Math.max(1, window.devicePixelRatio || 1);
  let motes = [];

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    W = canvas.width = innerWidth * dpr;
    H = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    const target = Math.round(Math.max(34, Math.min(90, (innerWidth * innerHeight) / 26000)));
    motes = [];
    for (let i = 0; i < target; i++) motes.push(spawn(true));
  }

  function spawn(initial) {
    const hues = [
      'rgba(255, 179, 71, ',     // honey
      'rgba(255, 138, 76, ',     // ember
      'rgba(255, 220, 140, ',    // pale honey
      'rgba(120, 230, 200, ',    // aurora teal
      'rgba(180, 130, 255, ',    // soft violet pop (rare)
    ];
    const weights = [40, 22, 26, 10, 2];
    const roll = weighted(weights);
    const base = hues[roll];
    const size = (Math.random() * 2.6 + 0.5) * dpr;
    return {
      x: Math.random() * W,
      y: initial ? Math.random() * H : H + 10 * dpr,
      r: size,
      vx: (Math.random() - 0.5) * 0.18 * dpr,
      vy: -(0.12 + Math.random() * 0.35) * dpr,
      color: base,
      alpha: 0.05 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      blur: Math.random() < 0.24,
    };
  }

  function weighted(ws) {
    const sum = ws.reduce((a,b)=>a+b,0);
    let r = Math.random() * sum;
    for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return i; }
    return 0;
  }

  function step() {
    ctx.clearRect(0, 0, W, H);
    const calm = document.documentElement.classList.contains('calm');
    const speed = reduce || calm ? 0.25 : 1;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.phase += 0.004 * speed;
      m.x += (m.vx + Math.sin(m.phase) * 0.08) * speed;
      m.y += m.vy * speed;
      if (m.y < -20 * dpr || m.x < -20 * dpr || m.x > W + 20 * dpr) {
        motes[i] = spawn(false);
        continue;
      }
      const a = m.alpha * (0.6 + 0.4 * Math.sin(m.phase));
      ctx.beginPath();
      if (m.blur) {
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 5);
        g.addColorStop(0, m.color + (a * 0.9) + ')');
        g.addColorStop(1, m.color + '0)');
        ctx.fillStyle = g;
        ctx.arc(m.x, m.y, m.r * 5, 0, Math.PI * 2);
      } else {
        ctx.fillStyle = m.color + a + ')';
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    requestAnimationFrame(step);
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();
  if (!reduce) step();
  else { // static single frame so we have *something*
    ctx.clearRect(0,0,W,H);
  }
})();
