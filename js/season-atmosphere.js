// ══════════════════════════════════════════════════════════════════════════
//  SEASON ATMOSPHERE — ambient particle overlay + grading kill-switch
//  (visual direction §10.4.2 — spring petals/pollen/rain showers, summer
//  motes/glow-pollen, autumn rotating leaves/gusts, winter varied snow/
//  sideways gusts/mist)
//
//  Self-contained. Load AFTER seasons.js (any position after it works):
//      <script src="/js/season-atmosphere.js?v=1"></script>
//
//  Design contract:
//    • Purely visual — never touches game state, never intercepts input
//      (pointer-events: none), never obscures readability (hard alpha caps).
//    • No texture swaps, no terrain regeneration. Colour grading stays in
//      CSS (hud-storybook.css season classes); this file only adds motion
//      and the on/off switches.
//    • Seeded PRNG (mulberry32) — no Math.random(), per house rule.
//    • rAF loop runs ONLY while the overlay is actually visible
//      (IntersectionObserver + document.visibilitychange). Idle cost: zero.
//    • Particle count scales with frame area and device tier, and adapts
//      downward if frame times sag (recovers slowly when headroom returns).
//    • ~1s crossfade on season change: old particles fade out, new ones
//      ramp in. CSS grade crossfades in parallel (transition in CSS).
//
//  Public API (for settings UI / future effects):
//    SeasonAtmosphere.setAtmosphere(bool)   — colour grading on/off
//    SeasonAtmosphere.setParticles(bool)    — particles on/off
//    SeasonAtmosphere.settings              — { atmosphere, particles }
//    SeasonAtmosphere.registerSpawner(seasonId, { weight, make })
//        — future-proofing: add new effects (e.g. fireflies once a
//          day/night cycle exists) without touching this file's core.
// ══════════════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ── Settings (persisted; guarded — private mode etc.) ───────────────────
  const LS_ATMO = 'kw_season_atmosphere';
  const LS_PART = 'kw_season_particles';
  const lsGet = (k, dflt) => {
    try { const v = localStorage.getItem(k); return v === null ? dflt : v === '1'; }
    catch (e) { return dflt; }
  };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} };

  const settings = {
    atmosphere: lsGet(LS_ATMO, true),
    particles:  lsGet(LS_PART, true),
  };

  // ── Seeded PRNG (mulberry32) — deterministic, no Math.random() ─────────
  let _seed = 0x6b696e64; // 'kind'
  function rand() {
    _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // ── Tunables ────────────────────────────────────────────────────────────
  const MAX_PARTICLES = 140;          // hard ceiling, any device
  const DENSITY_PER_100K_PX = 9;      // particles per 100,000 px² of frame
  const DPR_CAP = 1.5;                // overlay resolution cap (perf)
  const FADE_MS = 1000;               // season crossfade
  const ALPHA_CAP = 0.75;             // readability guard — nothing opaque

  // Device tier: modest hardware or small screens start lower.
  const deviceScale = (() => {
    const cores = navigator.hardwareConcurrency || 4;
    const small = Math.min(screen.width, screen.height) < 760;
    if (small || cores <= 4) return 0.6;
    return 1.0;
  })();

  // Adaptive quality: shrinks under sustained slow frames, recovers slowly.
  let quality = 1.0;
  let _slowFrames = 0, _fastFrames = 0;
  function adaptQuality(dt) {
    if (dt > 24) { _slowFrames++; _fastFrames = 0; }
    else if (dt < 14) { _fastFrames++; _slowFrames = 0; }
    else { _slowFrames = 0; _fastFrames = 0; }
    if (_slowFrames >= 60)  { quality = Math.max(0.3, quality * 0.75); _slowFrames = 0; }
    if (_fastFrames >= 300) { quality = Math.min(1.0, quality * 1.1);  _fastFrames = 0; }
  }

  // ── Wind: slow oscillation + scheduled gusts (seeded) ──────────────────
  const wind = { value: 0, base: 0, gustUntil: 0, gustStrength: 0, nextGustAt: 0 };
  function updateWind(now, seasonId) {
    wind.base = seasonId === 'winter' ? 0.35 : seasonId === 'autumn' ? 0.25 : 0.08;
    if (now >= wind.nextGustAt) {
      wind.gustUntil = now + rr(2000, 4000);
      wind.gustStrength = rr(0.8, 1.8) * (rand() < 0.5 ? 1 : -1);
      wind.nextGustAt = now + rr(20000, 50000);
    }
    const gustActive = now < wind.gustUntil;
    const gustPhase = gustActive
      ? Math.sin(Math.PI * (1 - (wind.gustUntil - now) / 4000)) // ease in/out
      : 0;
    wind.value = wind.base * Math.sin(now / 5200)
               + (gustActive ? wind.gustStrength * Math.max(0, gustPhase) : 0);
  }

  // ── Particle makers ─────────────────────────────────────────────────────
  // Each returns a particle: { x, y, vx, vy, r, alpha, seasonId, draw(ctx),
  // step(dt, W, H) → false when done }. Sway/rotation phases are seeded.
  // Spawn above/left of the frame so wind-blown types drift in naturally.

  function baseStep(p, dt, W, H) {
    p.wob += p.wobSpeed * dt;
    p.x += (p.vx + Math.sin(p.wob) * p.sway + wind.value * p.windGrip) * dt * 0.06;
    p.y += p.vy * dt * 0.06;
    if (p.rot !== undefined) p.rot += p.rotSpeed * dt * 0.06;
    return !(p.y > H + 30 || p.x < -40 || p.x > W + 40);
  }

  const makePetal = (W, H) => ({
    seasonId: 'spring', x: rr(-20, W), y: rr(-30, -5),
    vx: rr(-0.15, 0.15), vy: rr(0.25, 0.55), sway: rr(0.2, 0.5), windGrip: rr(0.5, 1),
    wob: rr(0, 6.28), wobSpeed: rr(0.001, 0.003),
    rot: rr(0, 6.28), rotSpeed: rr(-0.015, 0.015),
    r: rr(2.2, 4), alpha: rr(0.3, 0.6),
    color: pick(['232,168,200', '240,192,216', '224,150,190']),
    step(dt, w, h) { return baseStep(this, dt, w, h); },
    draw(ctx) {
      ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
      ctx.globalAlpha = Math.min(this.alpha, ALPHA_CAP);
      ctx.fillStyle = `rgb(${this.color})`;
      ctx.beginPath(); ctx.ellipse(0, 0, this.r, this.r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  });

  const makePollen = (W, H, glow) => ({
    seasonId: glow ? 'summer' : 'spring', x: rr(0, W), y: rr(0, H),
    vx: rr(-0.08, 0.08), vy: rr(-0.06, 0.1), sway: rr(0.1, 0.3), windGrip: rr(0.2, 0.5),
    wob: rr(0, 6.28), wobSpeed: rr(0.0008, 0.002),
    r: glow ? rr(1, 2) : rr(0.7, 1.4),
    alpha: 0, alphaMax: glow ? rr(0.35, 0.6) : rr(0.2, 0.4),
    pulse: rr(0, 6.28), life: rr(6000, 14000), age: 0,
    color: glow ? '255,224,140' : '244,232,190',
    step(dt, w, h) {
      this.age += dt; this.pulse += dt * 0.0012;
      const frac = this.age / this.life;
      this.alpha = this.alphaMax
        * Math.min(1, frac * 5, (1 - frac) * 5)      // fade in/out
        * (0.7 + 0.3 * Math.sin(this.pulse));        // gentle shimmer
      if (this.age >= this.life) return false;
      return baseStep(this, dt, w, h);
    },
    draw(ctx) {
      ctx.globalAlpha = Math.min(Math.max(this.alpha, 0), ALPHA_CAP);
      ctx.fillStyle = `rgb(${this.color})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
      if (this.seasonId === 'summer') { // soft halo, no shadowBlur (perf)
        ctx.globalAlpha *= 0.35;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  });

  const makeRainDrop = (W) => ({
    seasonId: 'spring', isRain: true, x: rr(-20, W + 20), y: rr(-40, -5),
    vx: rr(-0.2, -0.05), vy: rr(4.5, 6.5), sway: 0, windGrip: 2,
    wob: 0, wobSpeed: 0, r: 1, alpha: rr(0.18, 0.32), len: rr(7, 12),
    step(dt, w, h) { return baseStep(this, dt, w, h); },
    draw(ctx) {
      ctx.globalAlpha = Math.min(this.alpha, ALPHA_CAP);
      ctx.strokeStyle = 'rgb(190,210,225)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + this.vx * 2, this.y + this.len); ctx.stroke();
      ctx.globalAlpha = 1;
    },
  });

  const makeLeaf = (W, H) => ({
    seasonId: 'autumn', x: rr(-20, W), y: rr(-30, -5),
    vx: rr(-0.3, 0.05), vy: rr(0.35, 0.8), sway: rr(0.35, 0.7), windGrip: rr(0.8, 1.6),
    wob: rr(0, 6.28), wobSpeed: rr(0.0015, 0.0035),
    rot: rr(0, 6.28), rotSpeed: rr(-0.02, 0.02),
    r: rr(2.6, 4.6), alpha: rr(0.35, 0.65),
    color: pick(['190,100,25', '210,130,20', '165,85,18', '145,165,55', '195,150,35']),
    step(dt, w, h) { return baseStep(this, dt, w, h); },
    draw(ctx) { // ellipse + vein, same silhouette as the hero-screen leaves
      ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
      ctx.globalAlpha = Math.min(this.alpha, ALPHA_CAP);
      ctx.fillStyle = `rgb(${this.color})`;
      ctx.beginPath(); ctx.ellipse(0, 0, this.r, this.r * 1.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${this.color},0.35)`; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, -this.r * 1.5); ctx.lineTo(0, this.r * 1.5); ctx.stroke();
      ctx.restore();
    },
  });

  const makeSnow = (W, H) => ({
    seasonId: 'winter', x: rr(-30, W + 10), y: rr(-30, -5),
    vx: rr(-0.05, 0.05), vy: rr(0.3, 1.1), sway: rr(0.15, 0.45), windGrip: rr(0.9, 2.2),
    wob: rr(0, 6.28), wobSpeed: rr(0.001, 0.0028),
    r: rr(0.9, 3.4),                               // varied size…
    alpha: rr(0.3, 0.7),
    step(dt, w, h) { this.vy = Math.min(this.vy, 0.35 + this.r * 0.28); return baseStep(this, dt, w, h); }, // …and size-linked speed
    draw(ctx) {
      ctx.globalAlpha = Math.min(this.alpha, ALPHA_CAP);
      ctx.fillStyle = 'rgb(238,244,250)';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    },
  });

  const makeMist = (W, H) => ({
    seasonId: 'winter', isMist: true, x: rr(-W * 0.3, W), y: rr(H * 0.15, H * 0.9),
    vx: rr(0.04, 0.12), vy: 0, sway: 0, windGrip: 0.4,
    wob: rr(0, 6.28), wobSpeed: 0.0004,
    rx: rr(W * 0.18, W * 0.36), ry: rr(24, 60),
    alpha: 0, alphaMax: rr(0.05, 0.10), life: rr(20000, 40000), age: 0,
    step(dt, w, h) {
      this.age += dt;
      const frac = this.age / this.life;
      this.alpha = this.alphaMax * Math.min(1, frac * 6, (1 - frac) * 6);
      if (this.age >= this.life) return false;
      this.x += (this.vx + wind.value * this.windGrip) * dt * 0.06;
      return this.x < w + this.rx;
    },
    draw(ctx) {
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.rx);
      g.addColorStop(0, `rgba(226,234,242,${this.alpha})`);
      g.addColorStop(1, 'rgba(226,234,242,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.rx, this.ry, 0, 0, Math.PI * 2); ctx.fill();
    },
  });

  // Debris — tiny drifting speck, shared by autumn (brown) as "very subtle".
  const makeDebris = (W, H) => ({
    seasonId: 'autumn', x: rr(-20, W), y: rr(0, H * 0.7),
    vx: rr(-0.25, -0.05), vy: rr(0.05, 0.2), sway: rr(0.1, 0.25), windGrip: rr(1, 2),
    wob: rr(0, 6.28), wobSpeed: rr(0.002, 0.004),
    r: rr(0.6, 1.2), alpha: rr(0.15, 0.3),
    step(dt, w, h) { return baseStep(this, dt, w, h); },
    draw(ctx) {
      ctx.globalAlpha = Math.min(this.alpha, ALPHA_CAP);
      ctx.fillStyle = 'rgb(130,100,60)';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    },
  });

  // ── Spawner registry (weights per season) — the future-proofing hook ───
  // Fireflies belong here once a day/night cycle exists:
  //   SeasonAtmosphere.registerSpawner('summer', { weight: 2, make: makeFirefly });
  const SPAWNERS = {
    spring: [
      { weight: 5, make: (W, H) => makePetal(W, H) },
      { weight: 4, make: (W, H) => makePollen(W, H, false) },
    ],
    summer: [
      { weight: 6, make: (W, H) => makePollen(W, H, false) },
      { weight: 3, make: (W, H) => makePollen(W, H, true) },
    ],
    autumn: [
      { weight: 7, make: (W, H) => makeLeaf(W, H) },
      { weight: 2, make: (W, H) => makeDebris(W, H) },
    ],
    winter: [
      { weight: 9, make: (W, H) => makeSnow(W, H) },
      // mist handled separately (fixed small population, drawn beneath)
    ],
  };

  // Per-season target multiplier — winter wants more particles than summer.
  const SEASON_DENSITY = { spring: 0.8, summer: 0.55, autumn: 0.9, winter: 1.0 };

  // Rain showers (spring, "occasional/rare") — seeded schedule.
  const rain = { activeUntil: 0, nextAt: 0 };
  function updateRain(now, seasonId) {
    if (seasonId !== 'spring') { rain.activeUntil = 0; return; }
    if (rain.nextAt === 0) rain.nextAt = now + rr(60000, 180000);
    if (now >= rain.nextAt) {
      rain.activeUntil = now + rr(8000, 14000);
      rain.nextAt = now + rr(90000, 240000);
    }
  }

  // ── Overlay canvas + lifecycle ──────────────────────────────────────────
  let canvas = null, ctx = null, frameEl = null;
  let particles = [];
  let rafId = null;
  let lastT = 0;
  let visible = false;          // IntersectionObserver verdict
  let fadingOutSince = 0;       // particles-off / season-gone drain

  function currentSeasonId() {
    // Decoupled from seasons.js internals: read the class it applies.
    const sg = document.getElementById('screen-game');
    if (!sg) return null;
    const m = sg.className.match(/season-(spring|summer|autumn|winter)/);
    return m ? m[1] : null;
  }

  function targetCount(W, H, seasonId) {
    const area = W * H;
    const t = (area / 100000) * DENSITY_PER_100K_PX
            * (SEASON_DENSITY[seasonId] || 0.8) * deviceScale * quality;
    return Math.min(MAX_PARTICLES, Math.round(t));
  }

  function spawnOne(seasonId, W, H) {
    const list = SPAWNERS[seasonId];
    if (!list || !list.length) return null;
    let total = 0; for (const s of list) total += s.weight;
    let roll = rand() * total;
    for (const s of list) { roll -= s.weight; if (roll <= 0) return s.make(W, H); }
    return list[list.length - 1].make(W, H);
  }

  function resizeCanvas() {
    if (!canvas || !frameEl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const w = frameEl.clientWidth, h = frameEl.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(t) {
    rafId = null;
    if (!shouldRun()) { stopLoop(); return; }

    const dt = Math.min(50, lastT ? t - lastT : 16);
    lastT = t;
    adaptQuality(dt);

    const W = frameEl.clientWidth, H = frameEl.clientHeight;
    const seasonId = currentSeasonId();
    const now = performance.now();
    updateWind(now, seasonId);
    updateRain(now, seasonId);

    // Step + cull. Season change: strand old-season particles into a fade.
    ctx.clearRect(0, 0, W, H);
    const kept = [];
    // Mist first (beneath everything)
    for (const p of particles) if (p.isMist) { if (p.step(dt, W, H)) { p.draw(ctx); kept.push(p); } }
    for (const p of particles) {
      if (p.isMist) continue;
      if (p.seasonId !== seasonId && p.fadeStart === undefined) p.fadeStart = now;
      if (p.fadeStart !== undefined) {
        const f = 1 - (now - p.fadeStart) / FADE_MS;
        if (f <= 0) continue;
        p.alpha = Math.min(p.alpha, f * ALPHA_CAP);
        if (p.alphaMax !== undefined) p.alphaMax = Math.min(p.alphaMax, f * ALPHA_CAP);
      }
      if (p.step(dt, W, H)) { p.draw(ctx); kept.push(p); }
    }
    particles = kept;

    // Refill toward target (ramped — a few per frame, ~1s to full density)
    if (settings.particles && seasonId && !fadingOutSince) {
      const target = targetCount(W, H, seasonId);
      const current = particles.filter(p => p.seasonId === seasonId && !p.isRain && !p.isMist).length;
      let toSpawn = Math.min(3, target - current);
      while (toSpawn-- > 0) {
        const p = spawnOne(seasonId, W, H);
        if (p) particles.push(p);
      }
      // Rain shower burst (spring only, capped separately)
      if (rain.activeUntil > now) {
        const rainCount = particles.filter(p => p.isRain).length;
        const rainTarget = Math.min(40, Math.round(targetCount(W, H, seasonId) * 0.6));
        if (rainCount < rainTarget) for (let i = 0; i < 3; i++) particles.push(makeRainDrop(W));
      }
      // Winter mist — tiny fixed population
      if (seasonId === 'winter') {
        const mistCount = particles.filter(p => p.isMist).length;
        if (mistCount < 3 && rand() < 0.01) particles.push(makeMist(W, H));
      }
    }

    // Drain-and-stop when particles were switched off
    if (fadingOutSince && (particles.length === 0 || now - fadingOutSince > FADE_MS + 200)) {
      particles = [];
      ctx.clearRect(0, 0, W, H);
      stopLoop();
      return;
    }

    rafId = requestAnimationFrame(frame);
  }

  function shouldRun() {
    return visible && !document.hidden
      && (settings.particles || fadingOutSince > 0)
      && !!currentSeasonId();
  }

  function startLoop() {
    if (rafId !== null || !canvas) return;
    if (!shouldRun()) return;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    fadingOutSince = 0;
  }

  // ── Grading kill-switch ─────────────────────────────────────────────────
  function applyAtmosphereClass() {
    const sg = document.getElementById('screen-game');
    if (!sg) return;
    sg.classList.toggle('atmo-off', !settings.atmosphere);
  }

  // ── Public API ──────────────────────────────────────────────────────────
  window.SeasonAtmosphere = {
    get settings() { return { ...settings }; },
    setAtmosphere(on) {
      settings.atmosphere = !!on;
      lsSet(LS_ATMO, settings.atmosphere);
      applyAtmosphereClass();
    },
    setParticles(on) {
      settings.particles = !!on;
      lsSet(LS_PART, settings.particles);
      if (settings.particles) { fadingOutSince = 0; startLoop(); }
      else {
        // Graceful drain: mark everything fading, loop stops itself.
        fadingOutSince = performance.now();
        for (const p of particles) if (p.fadeStart === undefined) p.fadeStart = fadingOutSince;
        startLoop();
      }
    },
    registerSpawner(seasonId, spawner) {
      if (!SPAWNERS[seasonId]) SPAWNERS[seasonId] = [];
      SPAWNERS[seasonId].push(spawner);
    },
  };

  // ── Init ────────────────────────────────────────────────────────────────
  function init() {
    frameEl = document.getElementById('map-frame');
    const mapCanvas = document.getElementById('map-canvas');
    if (!frameEl || !mapCanvas) return; // page without the game map

    canvas = document.createElement('canvas');
    canvas.id = 'season-atmosphere-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    // Inserted right after #map-canvas: DOM order keeps it above the map
    // but below the (positioned) pan buttons and action bar. No z-index.
    canvas.style.cssText =
      'display:block;position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    mapCanvas.insertAdjacentElement('afterend', canvas);
    ctx = canvas.getContext('2d');

    resizeCanvas();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resizeCanvas).observe(frameEl);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }

    // Run only while actually on screen (handles screen switches, tab
    // switches, and any ancestor display:none — all through one gate).
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) startLoop(); else stopLoop();
      }).observe(canvas);
    } else {
      visible = true; startLoop();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLoop(); else startLoop();
    });

    // Season flips mid-session: seasons.js re-renders the badge every 10s
    // and swaps the class; watch it so a paused loop wakes up when a season
    // appears (e.g. first load before initSeasons ran).
    const sg = document.getElementById('screen-game');
    if (sg && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => { applyAtmosphereClass(); startLoop(); })
        .observe(sg, { attributes: true, attributeFilter: ['class'] });
    }

    applyAtmosphereClass();
    startLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
