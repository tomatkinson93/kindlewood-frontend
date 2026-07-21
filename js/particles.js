// ══════════════════════════════════════════════════════════════════════════
//  particles.js — hero ambience (spec 20 §B4)
//    • embers rising from the left lantern
//    • autumn leaves from the right tree
//    • lantern flicker (radial-gradient DOM glow)
//    • fireflies drifting near the cottage window
//    • one-time entrance stagger for the title block
//
//  House rules honored:
//    §3.2 — no Math.random() in tick/respawn; a single seeded mulberry32 PRNG.
//    §3.7 — prefers-reduced-motion disables EVERY animation here (including the
//           pre-existing ember/leaf loop and the entrance stagger).
// ══════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Entrance stagger is DOM-only and runs even without the particle canvas —
  // but is skipped entirely under reduced motion.
  if (!reduceMotion) runEntranceStagger();

  const canvas = document.getElementById('hero-particles');
  if (!canvas) return;

  // Under reduced motion: no canvas loop, no flicker, no fireflies. The hero
  // simply renders as a still image.
  if (reduceMotion) return;

  const ctx = canvas.getContext('2d');

  // ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────
  // DUPLICATE of mulberry32 in season-atmosphere.js — inlined because of the
  // pre-login load-order constraint (that module isn't guaranteed on window
  // before this runs). Seeded once per session (§3.2: determinism-per-session).
  let _seed = (Date.now() & 0xffffffff) | 0;
  function rand() {
    _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rr(min, max) { return min + rand() * (max - min); }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

  // ── Image-space anchoring ─────────────────────────────────────────────────
  // The hero art is drawn with object-fit:cover / object-position center 25%.
  // We project image-space fractions through that cover-crop rect so spawn
  // regions track the actual lantern / window at any canvas aspect ratio.
  const IMG_W = 1904, IMG_H = 640;
  let crop = { sx: 0, sy: 0, scale: 1 };
  function computeCrop() {
    const cw = canvas.width, ch = canvas.height;
    const scale = Math.max(cw / IMG_W, ch / IMG_H); // cover
    const dispW = IMG_W * scale, dispH = IMG_H * scale;
    crop = { sx: (cw - dispW) / 2, sy: (ch - dispH) * 0.25, scale };
  }
  const ix = (u) => crop.sx + u * IMG_W * crop.scale;      // image-U → canvas x
  const iy = (v) => crop.sy + v * IMG_H * crop.scale;      // image-V → canvas y
  const isc = (px) => px * crop.scale;                     // image px → canvas px

  // Anchor regions in image space (fractions of the hero art)
  const LANTERN = { u: 0.12, v: 0.52 };   // left hanging lantern
  const WINDOW  = { u: 0.30, v: 0.44 };   // lit cottage window

  // ── Lantern flicker glow (DOM radial-gradient, not canvas) ────────────────
  const hero = canvas.parentElement;
  let flick = null;
  if (hero) {
    flick = document.createElement('div');
    flick.className = 'hero-lantern-flicker';
    hero.appendChild(flick);
  }
  let flO = 0.65, flTargetO = 0.65, flS = 1.03, flTargetS = 1.03, flTime = 0, flDur = 3.5;
  function positionFlicker() {
    if (!flick) return;
    const size = isc(230);
    flick.style.width = size + 'px';
    flick.style.height = size + 'px';
    flick.style.left = (ix(LANTERN.u) - size / 2) + 'px';
    flick.style.top  = (iy(LANTERN.v) - size / 2) + 'px';
  }
  function stepFlicker(dt) {
    if (!flick) return;
    flTime += dt;
    if (flTime >= flDur) {
      flTime = 0; flDur = rr(3, 4);
      flTargetO = rr(0.5, 0.8);   // eased opacity wobble
      flTargetS = rr(1.0, 1.06);  // eased scale wobble
    }
    const k = Math.min(1, dt * 1.6); // exponential ease toward target
    flO += (flTargetO - flO) * k;
    flS += (flTargetS - flS) * k;
    flick.style.opacity = flO.toFixed(3);
    flick.style.transform = `scale(${flS.toFixed(3)})`;
  }

  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    computeCrop();
    positionFlicker();
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = [];

  // ── Embers rising from the lantern ────────────────────────────────────────
  function makeEmber() {
    const u = LANTERN.u + rr(-0.08, 0.10);
    const v = LANTERN.v + rr(-0.05, 0.30);
    return {
      kind: 'ember',
      x: ix(u), y: iy(v),
      r: isc(rr(0.8, 2.2)),
      speedY: isc(rr(-0.35, -0.1)),
      speedX: isc(rr(-0.08, 0.12)),
      alpha: rr(0.15, 0.55),
      color: rand() < 0.6 ? '255,180,60' : '255,240,180',
      wobble: rr(0, Math.PI * 2),
      wobbleSpeed: rr(0.015, 0.04),
      life: rr(60, 180),
      age: 0,
    };
  }

  // ── Autumn leaves from the right tree ─────────────────────────────────────
  function makeLeaf() {
    return {
      kind: 'leaf',
      x: ix(rr(0.70, 0.98)),
      y: iy(rr(-0.05, 0.55)),
      r: isc(rr(3, 5.5)),
      speedY: isc(rr(0.25, 0.75)),
      speedX: isc(rr(-0.7, -0.15)),
      alpha: rr(0.3, 0.7),
      alphaTarget: rr(0.25, 0.65),
      alphaSpeed: rr(0.002, 0.006),
      rotation: rr(0, Math.PI * 2),
      rotSpeed: rr(-0.022, 0.022),
      wobble: rr(0, Math.PI * 2),
      wobbleSpeed: rr(0.018, 0.045),
      color: pick(['190,100,25', '210,130,20', '165,85,18', '145,165,55', '195,150,35']),
    };
  }

  // ── Fireflies near the cottage window (slow Lissajous drift) ──────────────
  function makeFirefly() {
    return {
      kind: 'firefly',
      cu: WINDOW.u + rr(-0.04, 0.06),
      cv: WINDOW.v + rr(-0.03, 0.03),
      ax: rr(0.02, 0.045), ay: rr(0.015, 0.03),
      fx: rr(0.05, 0.09),  fy: rr(0.07, 0.11),
      phx: rand() * Math.PI * 2, phy: rand() * Math.PI * 2,
      r: isc(rr(1.4, 2.2)),
      alphaPhase: rand() * Math.PI * 2,
      alphaFreq: rr(1.4, 2.4),
    };
  }

  // Seed
  for (let i = 0; i < 38; i++) particles.push(makeEmber());
  for (let i = 0; i < 20; i++) particles.push(makeLeaf());
  for (let i = 0; i < 2;  i++) particles.push(makeFirefly());

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

  function drawFirefly(p, tSec) {
    const x = ix(p.cu + p.ax * Math.sin(tSec * p.fx * Math.PI * 2 + p.phx));
    const y = iy(p.cv + p.ay * Math.sin(tSec * p.fy * Math.PI * 2 + p.phy));
    const pulse = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(tSec * p.alphaFreq + p.alphaPhase));
    const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * 4);
    g.addColorStop(0, `rgba(255,244,190,${pulse.toFixed(3)})`);
    g.addColorStop(0.4, `rgba(255,214,120,${(pulse * 0.5).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, p.r * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,250,225,${Math.min(1, pulse + 0.2).toFixed(3)})`;
    ctx.fill();
  }

  let _last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - _last) / 1000); // clamp long frames
    _last = now;
    const tSec = now / 1000;

    stepFlicker(dt);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      if (p.kind === 'ember') {
        p.age++;
        p.y += p.speedY;
        p.x += p.speedX + Math.sin(p.wobble) * isc(0.12);
        p.wobble += p.wobbleSpeed;
        const lifeFrac = p.age / p.life;
        const fadeAlpha = lifeFrac > 0.7 ? p.alpha * (1 - (lifeFrac - 0.7) / 0.3) : p.alpha;
        if (p.age >= p.life || p.y < 0) { particles[i] = makeEmber(); continue; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${Math.max(0, fadeAlpha).toFixed(3)})`;
        ctx.fill();

      } else if (p.kind === 'leaf') {
        p.y += p.speedY;
        p.x += p.speedX + Math.sin(p.wobble) * isc(0.35);
        p.wobble += p.wobbleSpeed;
        p.rotation += p.rotSpeed;
        if (p.alpha < p.alphaTarget) p.alpha = Math.min(p.alphaTarget, p.alpha + p.alphaSpeed);
        else p.alpha = Math.max(0.1, p.alpha - p.alphaSpeed * 0.4);
        if (Math.abs(p.alpha - p.alphaTarget) < 0.01) p.alphaTarget = rr(0.2, 0.65);
        if (p.y > canvas.height + 25 || p.x < -25) { particles[i] = makeLeaf(); continue; }
        drawLeaf(p);

      } else { // firefly
        drawFirefly(p, tSec);
      }
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
});

// One-time entrance stagger for the hero title block (spec 20 §B4). The class
// drives the CSS keyframes; it is removed once done so the elements return to
// their resting state. No-op if the welcome title block isn't present.
function runEntranceStagger() {
  const block = document.querySelector('#screen-welcome .hero-text-welcome');
  if (!block) return;
  block.classList.add('kw-entrance');
  setTimeout(() => block.classList.remove('kw-entrance'), 1300);
}
