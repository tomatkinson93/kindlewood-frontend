// ══════════════════════════════════════════════════════════════════════════
//  KWHappeningFX — Happening map visuals (map_flourish effects).
//
//  Both renderers call KWHappeningFX.draw(ctx, W, H, dpr, renderer, now)
//  last, after the daylight pass. With no visual Happening running it
//  returns before touching any canvas (goldens stay byte-identical).
//
//  Kinds (registry: KWHappeningEffects.VISUALS):
//    tints      purple_moon · blood_moon · golden_glow — a colour cast over
//               the whole map, day and night
//    particles  floating_lanterns · fireworks · fireflies · will_o_wisps ·
//               shooting_stars · petals · mist · aurora
//    lanterns   drawn by the daylight pass (kwmap-daylight.js)
//
//  Everything is a pure function of (time, hash seeds): nothing random, no
//  per-frame state, so a frame never depends on the previous one. Under
//  prefers-reduced-motion the particles freeze (fireworks / shooting stars
//  are skipped). Anchors come from KWDaylight.sourcesFor (the renderer's own
//  visible list, fog-of-war filtered), so nothing is drawn over hidden land.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const MAX_ANCHORS = 14;

  // Tints: multiply colour + an optional soft additive glow (night only).
  const TINTS = {
    purple_moon: { mul: [208, 176, 255], glow: 'rgba(120,60,200,0.10)' },
    blood_moon:  { mul: [255, 168, 158], glow: 'rgba(170,30,30,0.10)' },
    golden_glow: { mul: [255, 232, 178], glow: 'rgba(255,190,90,0.06)' },
  };
  const FIREWORK_COLORS = ['#ff5a5a', '#ffd34d', '#5ad1ff', '#9dff6a', '#ff7af0', '#ffffff', '#ff9f43'];

  function hash32() {
    let h = 0x811c9dc5;
    for (let a = 0; a < arguments.length; a++) {
      let v = arguments[a] | 0;
      for (let b = 0; b < 4; b++) { h ^= v & 0xff; h = Math.imul(h, 0x01000193); v >>>= 8; }
    }
    return h >>> 0;
  }
  const u = (...a) => hash32(...a) / 4294967296;   // 0..1 from seeds

  let _rmq;
  function reducedMotion() {
    try { if (_rmq === undefined) _rmq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null; return !!(_rmq && _rmq.matches); }
    catch (e) { return false; }
  }

  // Active visual kinds right now (visual clock), lanterns excluded.
  function activeKinds() {
    const H = root.KWHappenings;
    if (!H || !H.activeVisuals) return [];
    return H.activeVisuals().filter(k => k !== 'lanterns');
  }

  // Night factor 0 (day) … 1 (full night) from the raw clock lighting.
  function nightFactor() {
    const C = root.KWClock;
    const L = C && C.lighting ? C.lighting() : null;
    return L ? Math.max(0, Math.min(1, Math.max(L.darkness / 0.55, L.lightLevel))) : 0;
  }

  function anchors(renderer, W, H) {
    const D = root.KWDaylight;
    let list = [];
    if (D && D.sourcesFor) list = D.sourcesFor(renderer, W, H).filter(s => s.light.settlement);
    else if (renderer && renderer.visibleSettlements) {
      list = renderer.visibleSettlements().filter(v => v.t && v.t.terrain !== 'fog' && v.t.settlement)
        .map(v => ({ x: v.cx, y: v.baseY - v.hexW * 0.18, hexW: v.hexW, q: v.t.q | 0, r: v.t.r | 0, ys: v.ys || 1 }));
    }
    return list.slice(0, MAX_ANCHORS);
  }

  // ── cached glow sprite (radial, colour) ──────────────────────────────────
  const _spr = new Map();
  function glow(color, px) {
    const r = Math.max(4, Math.ceil(px / 4) * 4), key = color + ':' + r;
    let c = _spr.get(key);
    if (c) return c;
    c = root.document.createElement('canvas'); c.width = c.height = r * 2;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, color); grd.addColorStop(0.35, color.replace(/,\s*[\d.]+\)$/, ',0.35)')); grd.addColorStop(1, color.replace(/,\s*[\d.]+\)$/, ',0)'));
    g.fillStyle = grd; g.fillRect(0, 0, r * 2, r * 2);
    if (_spr.size > 128) _spr.clear();
    _spr.set(key, c);
    return c;
  }
  function blit(ctx, spr, x, y, rad) { ctx.drawImage(spr, x - rad, y - rad, rad * 2, rad * 2); }
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

  // ── kinds ────────────────────────────────────────────────────────────────
  function drawTint(ctx, W, H, kind, night) {
    const T = TINTS[kind];
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(' + T.mul.join(',') + ')';
    ctx.fillRect(0, 0, W, H);
    if (night > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = night;
      ctx.fillStyle = T.glow;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // Paper sky lanterns rising from each settlement, swaying, fading out.
  function drawFloatingLanterns(ctx, W, H, A, t, night) {
    const N = 5, PERIOD = 16;
    const alphaK = 0.45 + 0.55 * night;
    ctx.save();
    for (const s of A) {
      for (let k = 0; k < N; k++) {
        const seed = hash32(s.q, s.r, 301 + k);
        const age = (((t / PERIOD) + (seed & 0xffff) / 65536) % 1 + 1) % 1;
        const rise = age * Math.min(H * 0.55, s.hexW * 7);
        const sway = Math.sin(t * 0.6 + (seed >>> 16)) * s.hexW * 0.25 + (u(seed, 1) - 0.5) * s.hexW * 1.2;
        const x = s.x + sway, y = s.y - s.hexW * 0.3 - rise;
        const a = Math.sin(Math.PI * age) * alphaK;
        if (a <= 0.02) continue;
        const sz = s.hexW * (0.09 + u(seed, 2) * 0.04) * (1 - age * 0.35);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * 0.7;
        blit(ctx, glow('rgba(255,170,70,0.9)', sz * 4), x, y, sz * 4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a;
        ctx.fillStyle = k % 2 ? '#ff6b3d' : '#ffb347';
        ctx.beginPath(); ctx.ellipse(x, y, sz * 0.8, sz, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffe9a8';
        ctx.fillRect(x - sz * 0.35, y + sz * 0.7, sz * 0.7, sz * 0.25);
      }
    }
    ctx.restore();
  }

  // Shells launch above the settlements and burst into falling sparks.
  function drawFireworks(ctx, W, H, A, t, night) {
    if (!A.length) A = [{ x: W / 2, y: H * 0.7, hexW: 64, q: 0, r: 0 }];
    const SLOTS = Math.min(7, 3 + A.length), PERIOD = 3.2, SPARKS = 34;
    const alphaK = 0.5 + 0.5 * night;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let sl = 0; sl < SLOTS; sl++) {
      const off = u(sl, 7) * PERIOD;
      const cycle = Math.floor((t + off) / PERIOD), ph = ((t + off) / PERIOD) - cycle;
      const s = A[hash32(sl, cycle) % A.length];
      const bx = s.x + (u(sl, cycle, 1) - 0.5) * s.hexW * 2.5;
      const by = s.y - s.hexW * (2.2 + u(sl, cycle, 2) * 1.8);
      const col = FIREWORK_COLORS[hash32(sl, cycle, 3) % FIREWORK_COLORS.length];
      if (ph < 0.22) {                                  // rising trail
        const k = ph / 0.22;
        const y = s.y + (by - s.y) * (1 - (1 - k) * (1 - k));
        ctx.globalAlpha = 0.8 * alphaK;
        blit(ctx, glow('rgba(255,230,180,0.9)', 5), bx, y, 5);
        continue;
      }
      const k = (ph - 0.22) / 0.78;                     // burst
      const fade = (1 - k) * (1 - k) * alphaK;
      if (fade <= 0.02) continue;
      const radius = s.hexW * (1.1 + u(sl, cycle, 4) * 0.7) * (1 - Math.pow(1 - k, 3));
      const spr = glow(rgba(col, 1), 7), core = glow('rgba(255,255,255,1)', 3);
      for (let i = 0; i < SPARKS; i++) {
        const ang = (i / SPARKS) * TAU + u(sl, cycle, 5) * TAU;
        const sx = bx + Math.cos(ang) * radius, sy = by + Math.sin(ang) * radius + k * k * s.hexW * 0.9;   // gravity
        ctx.globalAlpha = fade;
        blit(ctx, spr, sx, sy, 6);
        if (k < 0.5) blit(ctx, core, sx, sy, 2.2);
      }
      ctx.globalAlpha = fade * 0.6 * (1 - k);
      blit(ctx, glow(rgba(col, 0.7), s.hexW * 1.4), bx, by, s.hexW * 1.4);   // burst flash
    }
    ctx.restore();
  }

  function drawFireflies(ctx, W, H, A, t, night) {
    if (night <= 0.05) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spr = glow('rgba(214,255,120,0.95)', 4);
    for (const s of A) for (let k = 0; k < 9; k++) {
      const sd = hash32(s.q, s.r, 401 + k);
      const r = s.hexW * (0.4 + u(sd, 1) * 0.9);
      const x = s.x + Math.sin(t * (0.3 + u(sd, 2) * 0.4) + u(sd, 3) * TAU) * r;
      const y = s.y + s.hexW * 0.15 + Math.cos(t * (0.25 + u(sd, 4) * 0.4) + u(sd, 5) * TAU) * r * 0.5 * (s.ys || 1);
      const blink = Math.pow(Math.max(0, Math.sin(t * (1.3 + u(sd, 6)) + u(sd, 7) * TAU)), 3);
      if (blink < 0.05) continue;
      ctx.globalAlpha = blink * night;
      blit(ctx, spr, x, y, 4);
    }
    ctx.restore();
  }

  function drawWisps(ctx, W, H, A, t, night) {
    if (night <= 0.05) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of A) for (let k = 0; k < 3; k++) {
      const sd = hash32(s.q, s.r, 501 + k);
      const r = s.hexW * (1.3 + u(sd, 1) * 1.4);
      const x = s.x + Math.sin(t * 0.12 + u(sd, 2) * TAU) * r + Math.sin(t * 0.7 + k) * s.hexW * 0.15;
      const y = s.y + Math.cos(t * 0.09 + u(sd, 3) * TAU) * r * 0.55 * (s.ys || 1);
      const pulse = 0.55 + 0.45 * Math.sin(t * 1.6 + u(sd, 4) * TAU);
      ctx.globalAlpha = night * pulse * 0.8;
      blit(ctx, glow('rgba(130,200,255,0.9)', s.hexW * 0.35), x, y, s.hexW * 0.35);
      ctx.globalAlpha = night * pulse;
      blit(ctx, glow('rgba(225,245,255,0.95)', 4), x, y, 4);
    }
    ctx.restore();
  }

  function drawShootingStars(ctx, W, H, t, night) {
    if (night <= 0.05) return;
    const SLOTS = 3, PERIOD = 7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let sl = 0; sl < SLOTS; sl++) {
      const off = u(sl, 11) * PERIOD;
      const cycle = Math.floor((t + off) / PERIOD), ph = ((t + off) / PERIOD) - cycle;
      if (ph > 0.14) continue;
      const k = ph / 0.14;
      const x0 = u(sl, cycle, 1) * W, y0 = u(sl, cycle, 2) * H * 0.45;
      const dx = W * 0.22 * (u(sl, cycle, 3) < 0.5 ? -1 : 1), dy = H * 0.12;
      const hx = x0 + dx * k, hy = y0 + dy * k;
      const g = ctx.createLinearGradient(hx - dx * 0.35, hy - dy * 0.35, hx, hy);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,240,0.95)');
      ctx.strokeStyle = g; ctx.lineWidth = 3;
      ctx.globalAlpha = night * Math.sin(Math.PI * k);
      ctx.beginPath(); ctx.moveTo(hx - dx * 0.35, hy - dy * 0.35); ctx.lineTo(hx, hy); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPetals(ctx, W, H, t) {
    const N = Math.min(110, Math.round(W * H / 9000));
    ctx.save();
    for (let i = 0; i < N; i++) {
      const sp = 0.6 + u(i, 1) * 0.8;
      const x = ((u(i, 2) * (W + 60) + t * 22 * sp) % (W + 60)) - 30 + Math.sin(t * 0.8 + i) * 12;
      const y = ((u(i, 3) * (H + 60) + t * 30 * sp) % (H + 60)) - 30;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = i % 3 ? '#ffc4dd' : '#ff8fbf';
      ctx.beginPath(); ctx.ellipse(x, y, 5, 2.8, t * 1.5 * sp + i, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawMist(ctx, W, H, t) {
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const rw = W * (0.35 + u(i, 21) * 0.25), rh = H * (0.08 + u(i, 22) * 0.06);
      const x = ((u(i, 23) * (W + rw * 2) + t * (6 + u(i, 24) * 8)) % (W + rw * 2)) - rw;
      const y = H * (0.25 + u(i, 25) * 0.7);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rw);
      g.addColorStop(0, 'rgba(236,240,244,0.42)'); g.addColorStop(0.6, 'rgba(236,240,244,0.18)'); g.addColorStop(1, 'rgba(236,240,244,0)');
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(x, y); ctx.scale(1, rh / rw); ctx.translate(-x, -y);
      ctx.beginPath(); ctx.arc(x, y, rw, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // Smooth ribbons: each band is one filled polygon between a wavy top edge
  // and a wavy bottom edge, with a vertical gradient (no per-strip banding);
  // two offset layers per band give the shimmer.
  function drawAurora(ctx, W, H, t, night) {
    if (night <= 0.05) return;
    const STEP = 24;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bands = [['90,255,170', 0.0, 0.08], ['110,190,255', 1.7, 0.15], ['190,120,255', 3.1, 0.05]];
    for (const [rgb, ph, top] of bands) {
      for (let layer = 0; layer < 2; layer++) {
        const p = ph + layer * 0.9, sp = layer ? 0.18 : 0.25;
        const yTop = (x) => H * top + Math.sin(x * 0.0045 + t * sp + p) * H * 0.05 + Math.sin(x * 0.011 - t * 0.35 + p) * H * 0.02;
        const hgt = (x) => H * (0.13 + 0.05 * Math.sin(x * 0.006 + t * 0.3 + p));
        ctx.beginPath();
        ctx.moveTo(-STEP, yTop(-STEP));
        for (let x = 0; x <= W + STEP; x += STEP) ctx.lineTo(x, yTop(x));
        for (let x = W + STEP; x >= -STEP; x -= STEP) ctx.lineTo(x, yTop(x) + hgt(x));
        ctx.closePath();
        const y0 = H * (top - 0.07), y1 = H * (top + 0.25);
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        const a = (night * (layer ? 0.16 : 0.24)).toFixed(3);
        g.addColorStop(0, 'rgba(' + rgb + ',0)'); g.addColorStop(0.35, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── the pass ─────────────────────────────────────────────────────────────
  // Returns false (nothing drawn, no canvas touched) when no visual runs.
  function draw(ctx, W, H, dpr, renderer, now, opts) {
    opts = opts || {};
    const kinds = opts.kinds || activeKinds();
    if (!kinds.length) return false;
    const reduced = opts.reduced != null ? !!opts.reduced : reducedMotion();
    const t = reduced ? 0 : (typeof now === 'number' ? now : 0) / 1000;
    const Hd = root.KWHappenings && root.KWHappenings.demoNight ? root.KWHappenings.demoNight() : null;
    const night = opts.night != null ? opts.night : Hd != null ? Hd : nightFactor();
    const A = anchors(renderer, W, H);
    for (const k of kinds) if (TINTS[k]) drawTint(ctx, W, H, k, night);           // tints first, under the particles
    if (kinds.includes('mist')) drawMist(ctx, W, H, t);
    if (kinds.includes('aurora')) drawAurora(ctx, W, H, t, night);
    if (kinds.includes('will_o_wisps')) drawWisps(ctx, W, H, A, t, night);
    if (kinds.includes('fireflies')) drawFireflies(ctx, W, H, A, t, night);
    if (kinds.includes('floating_lanterns')) drawFloatingLanterns(ctx, W, H, A, t, night);
    if (kinds.includes('fireworks') && !reduced) drawFireworks(ctx, W, H, A, t, night);
    if (kinds.includes('shooting_stars') && !reduced) drawShootingStars(ctx, W, H, t, night);
    if (kinds.includes('petals')) drawPetals(ctx, W, H, t);
    return true;
  }

  root.KWHappeningFX = { draw, TINTS, _hash32: hash32 };
})(typeof window !== 'undefined' ? window : this);
