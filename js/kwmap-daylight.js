// ══════════════════════════════════════════════════════════════════════════
//  KWDaylight — the map's night-lighting pass (spec 021 §3.1).
//
//  Both renderers call KWDaylight.draw(ctx, W, H, dpr, renderer, now) at the
//  END of render(), after clouds. Per frame:
//    1. ground, sprites, clouds — already drawn by the renderer
//    2. shade:  one reused offscreen canvas at 0.5× device px, filled with the
//               tint at `darkness` (tintStrength mixes in the hue)
//    3. pools:  destination-out radial sprites punch light holes in the shade
//    4. the shade is composited over the map with 'multiply'
//    5. glows:  additive ('lighter') warm halos, scaled by lightLevel
//    6. lit windows (KWSettlements.drawGlow), after the shade so they read as
//       emissive
//
//  Rules:
//    • Day no-op — when darkness === 0 && lightLevel === 0 the pass returns
//      before touching any canvas (and before asking the renderer for
//      positions), so every golden stays byte-identical.
//    • Never baked into the iso GROUND buffer (season-keyed; must not rebuild
//      during a fade).
//    • Positions come from renderer.visibleSettlements() — the screen
//      positions the renderer already drew. Never re-projected from (q,r).
//    • Fog of war: a missing tile or terrain 'fog' never emits light.
//    • Flicker is a pure function of (time, hash32(q,r)); none under
//      prefers-reduced-motion. Nothing random.
//
//  Player setting (localStorage 'kw_night_lighting', season panel):
//    on   full lighting (default)
//    soft darkness and tint strength halved
//    off  no shade, pools or halos — only lit windows, at 50% alpha
//
//  Load order: after kwmap-settlements.js and server-clock.js; renderers look
//  it up at runtime (window.KWDaylight), so absence is a silent no-op.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // ── Light sources. r is the pool radius in hexW; alpha scales pool + glow.
  const LIGHTS = {
    camp:    { r: 0.9,  color: '#ffb35c', alpha: 1,   flicker: 'fire'  },
    village: { r: 1.1,  color: '#ffc070', alpha: 1,   flicker: 'lamp'  },
    town:    { r: 1.35, color: '#ffc878', alpha: 1,   flicker: 'lamp'  },
    city:    { r: 1.6,  color: '#ffd080', alpha: 1,   flicker: 'lamp'  },
    kingdom: { r: 1.9,  color: '#ffd966', alpha: 1,   flicker: 'lamp'  },
    annex:   { r: 1.2,  color: '#ffd966', alpha: 1,   flicker: 'lamp'  },
    hostile: { r: 1.0,  color: '#9a5cff', alpha: 1,   flicker: 'pulse', windows: false },
    outpost: { r: 0.5,  color: '#ffb35c', alpha: 0.5, flicker: 'fire',  windows: false },
  };
  const OWN_SCALE = 1.15;          // the player's own settlement
  const POOL_STRENGTH = 0.9;       // how far a pool lifts the shade at lightLevel 1
  const GLOW_STRENGTH = 0.42;      // additive halo alpha at lightLevel 1
  const GLOW_RADIUS = 0.75;        // halo radius as a share of the pool radius
  const LIGHT_LIFT = 0.18;         // light centre sits this many hexW above the footing
  const SHADE_SCALE = 0.5;         // shade canvas resolution vs device px
  const WARM = [255, 150, 70];     // low-sun warmth pulls glows toward this

  const LS_KEY = 'kw_night_lighting';
  const MODES = ['on', 'soft', 'off'];
  const ZERO = { darkness: 0, tint: [0, 0, 0], tintStrength: 0, lightLevel: 0, warmth: 0 };

  // ── hash32 — FNV-1a over the 4 bytes of each integer argument. ───────────
  function hash32() {
    let h = 0x811c9dc5;
    for (let a = 0; a < arguments.length; a++) {
      let v = arguments[a] | 0;
      for (let b = 0; b < 4; b++) {
        h ^= v & 0xff;
        h = Math.imul(h, 0x01000193);
        v >>>= 8;
      }
    }
    return h >>> 0;
  }

  // ── setting ──────────────────────────────────────────────────────────────
  let _mode = (function () {
    try { const v = root.localStorage.getItem(LS_KEY); return MODES.indexOf(v) >= 0 ? v : 'on'; }
    catch (e) { return 'on'; }
  })();
  function setting() { return _mode; }
  function setSetting(m) {
    if (MODES.indexOf(m) < 0) return false;
    _mode = m;
    try { root.localStorage.setItem(LS_KEY, m); } catch (e) {}
    const KW = root.KWMap;
    if (KW && KW.controller && KW.controller.requestRender) KW.controller.requestRender();
    return true;
  }

  // Lighting with the player setting applied. raw defaults to KWClock's
  // (tweened) lighting; with no clock loaded it is day.
  function applySetting(raw, mode) {
    if (!raw) return ZERO;
    mode = mode || _mode;
    if (mode === 'on') return raw;
    const k = mode === 'soft' ? 0.5 : 0;
    return {
      darkness: raw.darkness * k, tint: raw.tint, tintStrength: raw.tintStrength * k,
      lightLevel: raw.lightLevel, warmth: raw.warmth,
    };
  }
  function state() {
    const C = root.KWClock;
    return applySetting(C && C.lighting ? C.lighting() : null);
  }

  // ── reduced motion ───────────────────────────────────────────────────────
  let _rmq;
  function reducedMotion() {
    try {
      if (_rmq === undefined) _rmq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      return !!(_rmq && _rmq.matches);
    } catch (e) { return false; }
  }

  // ── flicker: Σ sin(t·fᵢ + seedᵢ), seed = hash32(q, r). ±6% radius,
  //    ±10% alpha; campfires ×1.5 and faster; hostile a slow pulse. ────────
  const TAU = Math.PI * 2;
  function flicker(tSec, q, r, kind, reduced) {
    if (reduced) return { radius: 1, alpha: 1 };
    const seed = hash32(q, r);
    const s1 = (seed & 0x3ff) / 1024 * TAU;
    const s2 = ((seed >>> 10) & 0x3ff) / 1024 * TAU;
    const s3 = ((seed >>> 20) & 0x3ff) / 1024 * TAU;
    if (kind === 'pulse') {
      const p = Math.sin(tSec * 0.9 + s1);
      return { radius: 1 + 0.06 * p, alpha: 1 + 0.10 * p };
    }
    const fire = kind === 'fire';
    const k = fire ? 1.5 : 1, f = fire ? 2.2 : 1;
    const a = (Math.sin(tSec * 1.7 * f + s1) + Math.sin(tSec * 2.9 * f + s2) + Math.sin(tSec * 4.3 * f + s3)) / 3;
    const b = (Math.sin(tSec * 2.3 * f + s3) + Math.sin(tSec * 3.7 * f + s1) + Math.sin(tSec * 5.9 * f + s2)) / 3;
    return { radius: 1 + 0.06 * k * a, alpha: 1 + 0.10 * k * b };
  }

  // ── which light a tile emits (null = none) ───────────────────────────────
  function kindFor(t) {
    const s = t.settlement;
    const S = root.KWSettlements;
    if (S && S.lookFor) {
      const key = S.lookFor(t).key;
      return key.indexOf('npc-') === 0 ? key.slice(4) : key;   // NPC: per tier
    }
    if (s.is_kingdom || s.settlement_type === 'kingdom') return s.is_kingdom_annex ? 'annex' : 'kingdom';
    if (s.settlement_type === 'hostile' || s.disposition === 'hostile') return 'hostile';
    return LIGHTS[s.tier] ? s.tier : 'village';
  }
  function lightFor(t) {
    if (!t || t.terrain === 'fog') return null;      // fog of war: hidden tiles emit nothing
    if (t.settlement) {
      const id = kindFor(t), L = LIGHTS[id] || LIGHTS.village;
      return { id, r: L.r * (t.settlement.isOwn ? OWN_SCALE : 1), color: L.color, alpha: L.alpha,
               flicker: L.flicker, windows: L.windows !== false, settlement: true };
    }
    if (t.outpost) {
      const L = LIGHTS.outpost;
      return { id: 'outpost', r: L.r, color: L.color, alpha: L.alpha, flicker: L.flicker, windows: false, settlement: false };
    }
    return null;
  }

  // On-screen light sources from the renderer's own visible list.
  function sourcesFor(renderer, W, H) {
    const raw = renderer && typeof renderer.visibleSettlements === 'function' ? renderer.visibleSettlements() : [];
    const out = [];
    for (const v of raw) {
      const L = lightFor(v.t);
      if (!L) continue;
      const radius = L.r * v.hexW;
      const x = v.cx, y = v.baseY - v.hexW * LIGHT_LIFT;
      const m = radius + v.hexW;                      // cull with room for the sprite
      if (x < -m || x > W + m || y < -m || y > H + m) continue;
      out.push({ t: v.t, q: v.t.q | 0, r: v.t.r | 0, x, y, baseY: v.baseY, hexW: v.hexW, ys: v.ys || 1, radius, light: L });
    }
    return out;
  }

  // ── cached gradient sprites, keyed (kind, radiusBucket[, warmBucket]) ────
  const _sprites = new Map();
  function _canvas(w, h) {
    const c = root.document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function _hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function poolSprite(kind, rb) {
    const key = 'pool:' + kind + ':' + rb;
    let c = _sprites.get(key);
    if (c) return c;
    c = _canvas(rb * 2, rb * 2);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(rb, rb, 0, rb, rb, rb);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, rb * 2, rb * 2);
    if (_sprites.size > 256) _sprites.clear();
    _sprites.set(key, c);
    return c;
  }
  function glowSprite(kind, rb, wb, colorHex) {
    const key = 'glow:' + kind + ':' + rb + ':' + wb;
    let c = _sprites.get(key);
    if (c) return c;
    const base = _hexRgb(colorHex), w = kind === 'hostile' ? 0 : wb / 4 * 0.35;
    const col = [0, 1, 2].map(i => Math.round(base[i] + (WARM[i] - base[i]) * w)).join(',');
    c = _canvas(rb * 2, rb * 2);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(rb, rb, 0, rb, rb, rb);
    grd.addColorStop(0, 'rgba(' + col + ',0.9)');
    grd.addColorStop(0.35, 'rgba(' + col + ',0.35)');
    grd.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, rb * 2, rb * 2);
    if (_sprites.size > 256) _sprites.clear();
    _sprites.set(key, c);
    return c;
  }
  const bucket = (px) => Math.max(4, Math.ceil(px / 4) * 4);

  // ── shade canvas (one, reused) ───────────────────────────────────────────
  let _shade = null;
  function shadeCanvas(W, H, dpr) {
    const pw = Math.max(1, Math.ceil(W * dpr * SHADE_SCALE)), ph = Math.max(1, Math.ceil(H * dpr * SHADE_SCALE));
    if (!_shade) _shade = _canvas(pw, ph);
    else if (_shade.width !== pw || _shade.height !== ph) { _shade.width = pw; _shade.height = ph; }
    const c = _shade.getContext('2d');
    c.setTransform(pw / W, 0, 0, ph / H, 0, 0);       // draw in CSS px
    return { canvas: _shade, ctx: c };
  }

  // Multiply colour: (1 - darkness), hue-shifted toward the tint (normalised
  // to its brightest channel so the tint changes hue, not depth).
  function shadeColor(L) {
    const tmax = Math.max(1, L.tint[0], L.tint[1], L.tint[2]);
    const base = 1 - L.darkness, ts = L.tintStrength;
    return 'rgb(' + [0, 1, 2].map(i => Math.round(255 * base * (1 - ts + ts * L.tint[i] / tmax))).join(',') + ')';
  }

  // Draws a cached sprite centred on (x, y), radius rad, squashed by ys.
  function blitSprite(ctx, spr, x, y, rad, ys) {
    ctx.drawImage(spr, x - rad, y - rad * ys, rad * 2, rad * 2 * ys);
  }

  // ── the pass ─────────────────────────────────────────────────────────────
  // Returns false on the day no-op (no canvas touched), true otherwise.
  // opts.lighting / opts.mode / opts.reduced override for tests.
  function draw(ctx, W, H, dpr, renderer, now, opts) {
    opts = opts || {};
    const mode = opts.mode || _mode;
    const L = opts.lighting ? applySetting(opts.lighting, mode) : state();
    if (L.darkness === 0 && L.lightLevel === 0) return false;        // day no-op

    const src = sourcesFor(renderer, W, H);
    const tSec = (typeof now === 'number' ? now : 0) / 1000;
    const reduced = opts.reduced != null ? !!opts.reduced : reducedMotion();
    const fl = src.map(s => flicker(tSec, s.q, s.r, s.light.flicker, reduced));
    const lvl = L.lightLevel;

    if (mode !== 'off') {
      // 2–4. shade with light pools, multiplied over the map
      if (L.darkness > 0 || L.tintStrength > 0) {
        const sh = shadeCanvas(W, H, dpr || 1), sc = sh.ctx;
        sc.globalCompositeOperation = 'source-over';
        sc.globalAlpha = 1;
        sc.fillStyle = shadeColor(L);
        sc.fillRect(0, 0, W, H);
        if (lvl > 0 && src.length) {
          sc.globalCompositeOperation = 'destination-out';
          for (let i = 0; i < src.length; i++) {
            const s = src[i], rad = s.radius * fl[i].radius;
            sc.globalAlpha = Math.min(1, POOL_STRENGTH * lvl * s.light.alpha * fl[i].alpha);
            blitSprite(sc, poolSprite(s.light.id, bucket(rad)), s.x, s.y, rad, s.ys);
          }
          sc.globalCompositeOperation = 'source-over';
          sc.globalAlpha = 1;
        }
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(sh.canvas, 0, 0, W, H);
        ctx.restore();
      }
      // 5. additive halos
      if (lvl > 0 && src.length) {
        const wb = Math.round(Math.max(0, Math.min(1, L.warmth)) * 4);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < src.length; i++) {
          const s = src[i], rad = s.radius * GLOW_RADIUS * fl[i].radius;
          ctx.globalAlpha = Math.min(1, GLOW_STRENGTH * lvl * s.light.alpha * fl[i].alpha);
          blitSprite(ctx, glowSprite(s.light.id, bucket(rad), wb, s.light.color), s.x, s.y, rad, s.ys);
        }
        ctx.restore();
      }
    }

    // 6. lit windows — emissive, on top of the shade
    const S = root.KWSettlements;
    if (lvl > 0 && S && typeof S.drawGlow === 'function') {
      const a = mode === 'off' ? lvl * 0.5 : lvl;
      for (const s of src) {
        if (s.light.windows) S.drawGlow(ctx, s.t, s.x, s.baseY, s.hexW, a, lvl);
      }
    }
    return true;
  }

  root.KWDaylight = {
    LIGHTS, OWN_SCALE, MODES,
    state, setting, setSetting, applySetting,
    draw, sourcesFor, lightFor, flicker, hash32,
    _shadeColor: shadeColor,
  };
})(typeof window !== 'undefined' ? window : this);
