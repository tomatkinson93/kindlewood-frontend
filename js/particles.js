window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('hero-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', () => { resize(); });

  function rand(min, max) { return min + Math.random() * (max - min); }

  const particles = [];

  // ── Embers / dust near the left lantern (left ~20% of image, bottom ~60%) ──
  function makeEmber() {
    const cx = canvas.width * rand(0.04, 0.22);
    const cy = canvas.height * rand(0.45, 0.85);
    return {
      kind: 'ember',
      x: cx, y: cy,
      r: rand(0.8, 2.2),
      speedY: rand(-0.35, -0.1),   // rises
      speedX: rand(-0.08, 0.12),
      alpha: rand(0.15, 0.55),
      alphaTarget: rand(0.1, 0.5),
      alphaSpeed: rand(0.003, 0.009),
      color: Math.random() < 0.6 ? '255,180,60' : '255,240,180', // orange or pale gold
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.015, 0.04),
      life: rand(60, 180),
      age: 0,
      originX: cx, originY: cy,
    };
  }

  // ── Autumn leaves from right tree (right ~30% of image, upper half) ──
  function makeLeaf() {
    return {
      kind: 'leaf',
      x: rand(canvas.width * 0.7, canvas.width * 0.98),
      y: rand(-30, canvas.height * 0.55),
      r: rand(3, 5.5),
      speedY: rand(0.25, 0.75),
      speedX: rand(-0.7, -0.15),
      alpha: rand(0.3, 0.7),
      alphaTarget: rand(0.25, 0.65),
      alphaSpeed: rand(0.002, 0.006),
      rotation: rand(0, Math.PI * 2),
      rotSpeed: rand(-0.022, 0.022),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.018, 0.045),
      color: ['190,100,25','210,130,20','165,85,18','145,165,55','195,150,35'][Math.floor(Math.random()*5)],
    };
  }

  // Seed
  for (let i = 0; i < 38; i++) particles.push(makeEmber());
  for (let i = 0; i < 20; i++) particles.push(makeLeaf());

  function drawLeaf(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = `rgb(${p.color})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r, p.r * 1.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${p.color},0.35)`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -p.r * 1.6); ctx.lineTo(0, p.r * 1.6);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      if (p.kind === 'ember') {
        p.age++;
        p.y += p.speedY;
        p.x += p.speedX + Math.sin(p.wobble) * 0.12;
        p.wobble += p.wobbleSpeed;

        // Fade out near end of life
        const lifeFrac = p.age / p.life;
        const fadeAlpha = lifeFrac > 0.7 ? p.alpha * (1 - (lifeFrac - 0.7) / 0.3) : p.alpha;

        if (p.age >= p.life || p.y < 0) {
          // Replace with fresh ember near same origin area
          particles[i] = makeEmber();
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${Math.max(0, fadeAlpha).toFixed(3)})`;
        ctx.fill();

      } else {
        // Leaf
        p.y += p.speedY;
        p.x += p.speedX + Math.sin(p.wobble) * 0.35;
        p.wobble += p.wobbleSpeed;
        p.rotation += p.rotSpeed;
        if (p.alpha < p.alphaTarget) p.alpha = Math.min(p.alphaTarget, p.alpha + p.alphaSpeed);
        else p.alpha = Math.max(0.1, p.alpha - p.alphaSpeed * 0.4);
        if (Math.abs(p.alpha - p.alphaTarget) < 0.01) p.alphaTarget = rand(0.2, 0.65);

        if (p.y > canvas.height + 25 || p.x < -25) {
          particles[i] = makeLeaf();
          continue;
        }
        drawLeaf(p);
      }
    }

    requestAnimationFrame(tick);
  }

  tick();
});
