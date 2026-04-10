// Subtle floating particle dots -- refined ambient effect
// Respects prefers-reduced-motion (#18)
(function() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;

  // Skip entirely if user prefers reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    canvas.style.display = 'none';
    return;
  }

  const ctx = canvas.getContext('2d');
  let w, h;
  const particles = [];
  const COUNT = 30;
  let running = true;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function init() {
    resize();
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.2 + 0.3,
        dx: (Math.random() - 0.5) * 0.15,
        dy: (Math.random() - 0.5) * 0.1,
        alpha: Math.random() * 0.3 + 0.05,
        pulse: Math.random() * Math.PI * 2,
      });
    }
  }

  function draw() {
    if (!running) return;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.dx;
      p.y += p.dy;
      p.pulse += 0.008;

      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;

      const a = p.alpha * (0.5 + 0.5 * Math.sin(p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(129, 140, 248, ${a})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  // Pause when tab is hidden (save battery)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
    } else {
      running = true;
      requestAnimationFrame(draw);
    }
  });

  window.addEventListener('resize', resize);
  init();
  draw();
})();
