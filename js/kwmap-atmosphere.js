// ══════════════════════════════════════════════════════════════════════════
//  KWMap atmosphere — "uncharted map" fog of war + drifting cloud layer
//
//  Replaces the old drifting parchment-swirl fog backdrop with two things:
//
//   1. drawBackdrop — an old cartographer's chart: aged parchment, faded
//      portolan rhumb-line network, a compass rose, half-remembered ink
//      sketches of mountains / forests / lakes, dotted trails and the odd
//      "Terra Incognita". The texture tiles seamlessly and is ANCHORED to the
//      world (it pans with the map), so unexplored land reads as the blank,
//      rumoured part of the map rather than a screen-space overlay.
//
//   2. drawClouds — painted cumulus that hover ABOVE the map: they drift
//      with a slow wind, parallax against the ground when panning (they sit
//      higher than the land), cast soft shadows, tint with the season and
//      thin out over the centre of the view so the focal area stays readable.
//
//  Both renderers call into this (guarded: when this file isn't loaded — e.g.
//  the verify harness — they fall back to the legacy _fogImg backdrop).
//
//  House rules: cosmetic only, no game-state reads/writes beyond the season
//  class on #screen-game, no apiFetch, no Math.random (seeded mulberry32).
//  Everything is generated once (per season for clouds) and cached; the
//  per-frame cost is a handful of drawImage calls.
//
//  Public API (KWMap.atmosphere):
//    drawBackdrop(ctx, W, H, camX, camY, { yScale })   → bool (drew?)
//    drawClouds(ctx, W, H, camX, camY, now, { yScale })
//    clouds (getter) / setClouds(bool)                 persisted kw_map_clouds
// ══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const KW = window.KWMap;
  if (!KW) return;

  // ── Seeded PRNG ───────────────────────────────────────────────────────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const mod = (a, n) => ((a % n) + n) % n;
  const TAU = Math.PI * 2;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function seasonId() {
    const sg = document.getElementById('screen-game');
    if (!sg) return 'summer';
    const m = sg.className.match(/season-(spring|summer|autumn|winter)/);
    return m ? m[1] : 'summer';
  }

  function requestRender() {
    if (KW.controller && KW.controller.requestRender) KW.controller.requestRender();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  1. THE UNCHARTED CHART (tileable parchment texture)
  // ════════════════════════════════════════════════════════════════════════

  const TEX = 1024;                    // texture period, CSS px
  const INK = '74,52,30';              // sepia ink (rgb triple)
  const SCRIPT_FONT = '"IM Fell English", "Playfair Display", Georgia, serif';
  let _chart = null;
  let _fontWatch = false;

  // Draw `fn` at every tiled copy of a feature whose bounding circle (x, y, r)
  // crosses the texture edge — that's what makes the texture seamless.
  function wrapped(ctx, x, y, r, fn) {
    for (let oy = -TEX; oy <= TEX; oy += TEX) {
      if (y + oy + r < 0 || y + oy - r > TEX) continue;
      for (let ox = -TEX; ox <= TEX; ox += TEX) {
        if (x + ox + r < 0 || x + ox - r > TEX) continue;
        ctx.save();
        ctx.translate(ox, oy);
        fn(ctx);
        ctx.restore();
      }
    }
  }

  function softDab(ctx, x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.55, `rgba(${rgb},${a * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // A wobbly closed outline (lakes, stains) — radius noise from a few harmonics.
  function blobPath(ctx, x, y, r, rng, squash) {
    const k1 = rng() * TAU, k2 = rng() * TAU, a1 = 0.12 + rng() * 0.12, a2 = 0.05 + rng() * 0.08;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * TAU;
      const rr = r * (1 + a1 * Math.sin(t * 2 + k1) + a2 * Math.sin(t * 5 + k2));
      const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr * (squash || 1);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawMountain(ctx, x, y, w, h, rng, a) {
    const px = x + (rng() - 0.5) * w * 0.25;
    // paper-coloured body so nearer peaks occlude the ones behind
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y); ctx.lineTo(px, y - h); ctx.lineTo(x + w / 2, y); ctx.closePath();
    ctx.fillStyle = 'rgba(222,205,168,0.92)';
    ctx.fill();
    ctx.strokeStyle = `rgba(${INK},${a})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 2, y + 0.5); ctx.lineTo(px, y - h); ctx.lineTo(x + w / 2 + 2, y + 0.5);
    ctx.stroke();
    // engraved hatching on the shadowed (right) flank
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(${INK},${a * 0.7})`;
    const n = 3 + Math.floor(w / 7);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const sx = px + (x + w / 2 - px) * t, sy = (y - h) + h * t;
      ctx.beginPath(); ctx.moveTo(sx, sy + 1); ctx.lineTo(sx - w * 0.12, y - 1); ctx.stroke();
    }
    // snow line tick
    ctx.beginPath();
    ctx.moveTo(px - w * 0.12, y - h * 0.72); ctx.lineTo(px - w * 0.03, y - h * 0.62); ctx.lineTo(px + w * 0.06, y - h * 0.74);
    ctx.stroke();
  }

  function drawTree(ctx, x, y, s, rng, a) {
    ctx.strokeStyle = `rgba(${INK},${a})`;
    ctx.lineWidth = 1;
    if (rng() < 0.5) {
      // conifer — stacked chevrons
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 1.5); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const yy = y - s * (0.45 + i * 0.35), ww = s * (0.55 - i * 0.14);
        ctx.beginPath(); ctx.moveTo(x - ww, yy + s * 0.2); ctx.lineTo(x, yy - s * 0.2); ctx.lineTo(x + ww, yy + s * 0.2); ctx.stroke();
      }
    } else {
      // broadleaf — lollipop crown with a stippled shadow side
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - s * 1.05, s * 0.45, 0, TAU);
      ctx.fillStyle = 'rgba(222,205,168,0.85)'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgba(${INK},${a * 0.8})`;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + s * (0.05 + rng() * 0.25), y - s * (0.8 + rng() * 0.45), 1, 1);
    }
  }

  function drawHill(ctx, x, y, w, a) {
    ctx.strokeStyle = `rgba(${INK},${a})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.quadraticCurveTo(x, y - w * 0.55, x + w / 2, y); ctx.stroke();
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 3; i++) {
      const hx = x + w * (0.08 + i * 0.1);
      ctx.beginPath(); ctx.moveTo(hx, y - w * (0.2 - i * 0.05)); ctx.lineTo(hx - 3, y - 1); ctx.stroke();
    }
  }

  function drawCompassRose(ctx, x, y, R) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.42;
    // rings
    ctx.strokeStyle = `rgba(${INK},0.8)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.08, 0, TAU); ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.0, 0, TAU); ctx.stroke();
    // degree ticks
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * TAU, l = i % 8 === 0 ? 0.1 : 0.05;
      ctx.beginPath();
      ctx.moveTo(Math.cos(t) * R, Math.sin(t) * R);
      ctx.lineTo(Math.cos(t) * R * (1 - l), Math.sin(t) * R * (1 - l));
      ctx.stroke();
    }
    // 16-point star: long cardinal, mid intercardinal, short half-winds.
    // Each point is two halves — one inked, one left paper — the classic look.
    const pts = [];
    for (let i = 0; i < 16; i++) pts.push({ ang: (i / 16) * TAU - Math.PI / 2, len: i % 4 === 0 ? 0.95 : i % 2 === 0 ? 0.66 : 0.44 });
    pts.sort((p, q) => p.len - q.len);          // short points under long ones
    for (const p of pts) {
      const w = p.len * R * 0.16;
      const tipX = Math.cos(p.ang) * R * p.len, tipY = Math.sin(p.ang) * R * p.len;
      const nx = Math.cos(p.ang + Math.PI / 2) * w, ny = Math.sin(p.ang + Math.PI / 2) * w;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tipX, tipY); ctx.lineTo(nx, ny); ctx.closePath();
      ctx.fillStyle = 'rgba(232,218,184,1)'; ctx.fill();
      ctx.strokeStyle = `rgba(${INK},0.9)`; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tipX, tipY); ctx.lineTo(-nx, -ny); ctx.closePath();
      ctx.fillStyle = p.len > 0.9 ? 'rgba(128,52,38,0.85)' : `rgba(${INK},0.75)`; ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.06, 0, TAU);
    ctx.fillStyle = 'rgba(232,218,184,1)'; ctx.fill(); ctx.stroke();
    // north marker
    ctx.fillStyle = `rgba(${INK},0.9)`;
    ctx.font = `italic ${Math.round(R * 0.26)}px ${SCRIPT_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('N', 0, -R * 1.14);
    ctx.restore();
  }

  function buildChart() {
    const c = makeCanvas(TEX, TEX);
    const ctx = c.getContext('2d');
    const rng = mulberry32(hashStr('kindlewood-uncharted-chart'));

    // ── Parchment base + broad mottling ─────────────────────────────────────
    ctx.fillStyle = '#d8c59d';
    ctx.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 140; i++) {
      const x = rng() * TEX, y = rng() * TEX, r = 50 + rng() * 170;
      const light = rng() > 0.45;
      const col = light ? '236,222,188' : '176,146,100';
      const a = light ? 0.22 + rng() * 0.2 : 0.10 + rng() * 0.14;
      wrapped(ctx, x, y, r, (k) => softDab(k, x, y, r, col, a));
    }

    // ── Age: tea-stain rings + foxing ───────────────────────────────────────
    for (let i = 0; i < 7; i++) {
      const x = rng() * TEX, y = rng() * TEX, r = 26 + rng() * 60;
      const sub = mulberry32(hashStr('stain' + i));
      wrapped(ctx, x, y, r * 1.4, (k) => {
        blobPath(k, x, y, r, sub, 1);
        k.fillStyle = 'rgba(150,108,58,0.05)'; k.fill();
        k.strokeStyle = 'rgba(128,88,44,0.13)'; k.lineWidth = 2.2 + sub() * 2; k.stroke();
      });
    }
    for (let i = 0; i < 420; i++) {
      const x = rng() * TEX, y = rng() * TEX, r = 0.6 + rng() * rng() * 4;
      const a = 0.05 + rng() * 0.14;
      wrapped(ctx, x, y, r, (k) => softDab(k, x, y, r, '120,80,40', a));
    }

    // ── Faint graticule (dotted meridians / parallels) ──────────────────────
    ctx.save();
    ctx.strokeStyle = `rgba(${INK},0.07)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 6]);
    for (let i = 0; i < 4; i++) {
      const p = i * TEX / 4 + TEX / 8;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, TEX); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(TEX, p); ctx.stroke();
    }
    ctx.restore();

    // ── Portolan rhumb-line network: 32 winds from each hub, faded
    //    black (8 winds), green (half winds), red (quarter winds) ─────────────
    const hubs = [
      { x: TEX * (0.28 + rng() * 0.08), y: TEX * (0.30 + rng() * 0.08) },
      { x: TEX * (0.74 + rng() * 0.06), y: TEX * (0.76 + rng() * 0.06) },
    ];
    const RHUMB = TEX * 0.72;
    for (const h of hubs) {
      for (let i = 0; i < 32; i++) {
        const ang = (i / 32) * TAU;
        const col = i % 4 === 0 ? `${INK}` : i % 2 === 0 ? '62,96,62' : '140,58,44';
        const a = i % 4 === 0 ? 0.17 : i % 2 === 0 ? 0.13 : 0.11;
        const ex = h.x + Math.cos(ang) * RHUMB, ey = h.y + Math.sin(ang) * RHUMB;
        wrapped(ctx, h.x, h.y, RHUMB, (k) => {
          const g = k.createLinearGradient(h.x, h.y, ex, ey);
          g.addColorStop(0, `rgba(${col},${a})`);
          g.addColorStop(0.75, `rgba(${col},${a * 0.6})`);
          g.addColorStop(1, `rgba(${col},0)`);
          k.strokeStyle = g;
          k.lineWidth = i % 4 === 0 ? 1.1 : 0.8;
          k.beginPath(); k.moveTo(h.x, h.y); k.lineTo(ex, ey); k.stroke();
        });
      }
      const hr = 22;
      wrapped(ctx, h.x, h.y, hr, (k) => {
        k.strokeStyle = `rgba(${INK},0.22)`; k.lineWidth = 1;
        k.beginPath(); k.arc(h.x, h.y, hr, 0, TAU); k.stroke();
      });
    }

    // ── Rumoured geography: sketched lakes, ranges, forests, hills ─────────
    // Lakes first (so ranges/forests can sit on their shores).
    for (let i = 0; i < 4; i++) {
      const x = rng() * TEX, y = rng() * TEX, r = 26 + rng() * 34;
      const sq = 0.55 + rng() * 0.3;
      const seed = hashStr('lake' + i);
      wrapped(ctx, x, y, r * 1.6, (k) => {
        const sub = mulberry32(seed);
        blobPath(k, x, y, r, sub, sq);
        k.fillStyle = 'rgba(108,128,122,0.12)'; k.fill();
        k.strokeStyle = `rgba(${INK},0.36)`; k.lineWidth = 1.2; k.stroke();
        // engraved water-lining: echoes of the shore, fading outward
        for (let j = 1; j <= 3; j++) {
          const sub2 = mulberry32(seed);
          blobPath(k, x, y, r + j * 5, sub2, sq);
          k.strokeStyle = `rgba(${INK},${0.2 - j * 0.05})`; k.lineWidth = 0.7; k.stroke();
        }
      });
    }

    // Collect glyphs, then draw back-to-front (by y) so near ones occlude.
    const glyphs = [];
    const walk = (count, stepMin, stepMax, fn) => {
      let x = rng() * TEX, y = rng() * TEX, dir = rng() * TAU;
      for (let j = 0; j < count; j++) {
        fn(x, y);
        dir += (rng() - 0.5) * 0.9;
        const st = stepMin + rng() * (stepMax - stepMin);
        x += Math.cos(dir) * st; y += Math.sin(dir) * st * 0.6;
      }
    };
    for (let i = 0; i < 6; i++) {             // mountain ranges
      walk(5 + Math.floor(rng() * 6), 12, 20, (x, y) => {
        const w = 18 + rng() * 16, h = w * (0.7 + rng() * 0.4);
        const seed = rng() * 1e9;
        glyphs.push({ x, y, r: w, draw: (k) => drawMountain(k, x, y, w, h, mulberry32(seed), 0.42) });
      });
    }
    for (let i = 0; i < 8; i++) {             // forests
      const cx = rng() * TEX, cy = rng() * TEX, n = 7 + Math.floor(rng() * 12);
      for (let j = 0; j < n; j++) {
        const x = cx + (rng() - 0.5) * 70, y = cy + (rng() - 0.5) * 40;
        const s = 6 + rng() * 3, seed = rng() * 1e9;
        glyphs.push({ x, y, r: s * 2, draw: (k) => drawTree(k, x, y, s, mulberry32(seed), 0.4) });
      }
    }
    for (let i = 0; i < 6; i++) {             // rolling hills
      walk(3 + Math.floor(rng() * 4), 14, 22, (x, y) => {
        const w = 16 + rng() * 10;
        glyphs.push({ x, y, r: w, draw: (k) => drawHill(k, x, y, w, 0.34) });
      });
    }
    glyphs.sort((a, b) => a.y - b.y);
    for (const gl of glyphs) wrapped(ctx, gl.x, gl.y, gl.r * 1.5, gl.draw);

    // Dotted trails — half-remembered routes between nowhere and nowhere.
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x0 = rng() * TEX, y0 = rng() * TEX;
      const x1 = x0 + (rng() - 0.5) * 360, y1 = y0 + (rng() - 0.5) * 260;
      const mx = (x0 + x1) / 2 + (rng() - 0.5) * 160, my = (y0 + y1) / 2 + (rng() - 0.5) * 160;
      const r = Math.hypot(x1 - x0, y1 - y0);
      wrapped(ctx, (x0 + x1) / 2, (y0 + y1) / 2, r, (k) => {
        k.strokeStyle = `rgba(${INK},0.28)`; k.lineWidth = 1.3;
        k.beginPath(); k.moveTo(x0, y0); k.quadraticCurveTo(mx, my, x1, y1); k.stroke();
      });
      // an X at one end, the cartographer's "something here?"
      wrapped(ctx, x1, y1, 8, (k) => {
        k.setLineDash([]);
        k.strokeStyle = 'rgba(128,52,38,0.35)'; k.lineWidth = 1.4;
        k.beginPath(); k.moveTo(x1 - 4, y1 - 4); k.lineTo(x1 + 4, y1 + 4);
        k.moveTo(x1 + 4, y1 - 4); k.lineTo(x1 - 4, y1 + 4); k.stroke();
      });
    }
    ctx.restore();

    // Little wave marks scattered in the open (ink "~" pairs).
    for (let i = 0; i < 26; i++) {
      const x = rng() * TEX, y = rng() * TEX, w = 7 + rng() * 5;
      wrapped(ctx, x, y, w * 2, (k) => {
        k.strokeStyle = `rgba(${INK},0.2)`; k.lineWidth = 0.9;
        for (let j = 0; j < 2; j++) {
          const xx = x + j * w * 1.1, yy = y + j * 3;
          k.beginPath(); k.moveTo(xx - w / 2, yy); k.quadraticCurveTo(xx - w / 4, yy - 3, xx, yy);
          k.quadraticCurveTo(xx + w / 4, yy + 3, xx + w / 2, yy); k.stroke();
        }
      });
    }

    // ── Compass rose on the first hub ───────────────────────────────────────
    const R = 58;
    wrapped(ctx, hubs[0].x, hubs[0].y, R * 1.4, (k) => drawCompassRose(k, hubs[0].x, hubs[0].y, R));

    // ── Script labels ──────────────────────────────────────────────────────
    const labels = [
      { text: 'Terra Incognita', size: 30, a: 0.30 },
      { text: 'Parts Unknown', size: 22, a: 0.24 },
      { text: 'hic sunt dracones', size: 17, a: 0.24 },
    ];
    const spots = [
      { x: TEX * 0.64, y: TEX * 0.26 },
      { x: TEX * 0.22, y: TEX * 0.78 },
      { x: TEX * 0.82, y: TEX * 0.52 },
    ];
    labels.forEach((lb, i) => {
      const { x, y } = spots[i];
      const rot = (rng() - 0.5) * 0.25;
      wrapped(ctx, x, y, lb.size * 6, (k) => {
        k.save();
        k.translate(x, y); k.rotate(rot);
        k.font = `italic ${lb.size}px ${SCRIPT_FONT}`;
        k.textAlign = 'center'; k.textBaseline = 'middle';
        k.fillStyle = `rgba(${INK},${lb.a})`;
        k.fillText(lb.text, 0, 0);
        k.restore();
      });
    });

    // ── Paper grain (per-pixel, seeded) ────────────────────────────────────
    try {
      const img = ctx.getImageData(0, 0, TEX, TEX);
      const d = img.data;
      const grng = mulberry32(hashStr('grain'));
      for (let p = 0; p < d.length; p += 4) {
        const n = (grng() - 0.5) * 14;
        d[p] += n; d[p + 1] += n; d[p + 2] += n * 0.8;
      }
      ctx.putImageData(img, 0, 0);
    } catch (e) { /* tainted/unsupported — grain is optional */ }

    // Fibres — a few long faint strokes
    for (let i = 0; i < 90; i++) {
      const x = rng() * TEX, y = rng() * TEX, l = 8 + rng() * 26, a = rng() * TAU;
      const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l;
      const fa = 0.04 + rng() * 0.05;
      wrapped(ctx, x, y, l, (k) => {
        k.strokeStyle = `rgba(110,80,50,${fa})`; k.lineWidth = 0.6;
        k.beginPath(); k.moveTo(x, y); k.lineTo(ex, ey); k.stroke();
      });
    }

    return c;
  }

  // The chart uses a script font for its labels. Build once now (fallback
  // serif), then rebuild once when the font has actually loaded.
  function chart() {
    if (!_chart) _chart = buildChart();
    if (!_fontWatch && document.fonts && document.fonts.load) {
      _fontWatch = true;
      document.fonts.load(`italic 30px "IM Fell English"`).then((faces) => {
        if (faces && faces.length) { _chart = null; requestRender(); }
      }).catch(() => {});
    }
    return _chart;
  }

  // Paint the chart so texture point p lands at screen (p - cam + centre).
  // yScale squashes it onto the iso ground plane (camY is already squashed).
  function drawBackdrop(ctx, W, H, camX, camY, opts) {
    let tex;
    try { tex = chart(); } catch (e) { return false; }
    if (!tex) return false;
    const ys = (opts && opts.yScale) || 1;
    const tw = TEX, th = TEX * ys;
    const x0 = mod(W / 2 - camX, tw) - tw;
    const y0 = mod(H / 2 - camY, th) - th;
    for (let y = y0; y < H; y += th) {
      for (let x = x0; x < W; x += tw) ctx.drawImage(tex, x, y, tw, th);
    }
    // Aged-edge burn: darken toward the frame edges like a well-handled map.
    const mx = Math.max(W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / mx, H / mx);
    const g = ctx.createRadialGradient(0, 0, mx * 0.3, 0, 0, mx * 0.62);
    g.addColorStop(0, 'rgba(90,60,30,0)');
    g.addColorStop(1, 'rgba(80,52,26,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(-mx, -mx, mx * 2, mx * 2);
    ctx.restore();
    return true;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  2. CLOUDS
  // ════════════════════════════════════════════════════════════════════════

  const LS_CLOUDS = 'kw_map_clouds';
  let _cloudsOn = (() => { try { return localStorage.getItem(LS_CLOUDS) !== '0'; } catch (e) { return true; } })();

  const SEASON_TINT = {
    spring: { light: '255,253,250', mid: '236,230,236', shade: '184,172,190', rim: '255,240,244' },
    summer: { light: '255,254,248', mid: '238,234,224', shade: '178,172,160', rim: '255,246,222' },
    autumn: { light: '255,249,238', mid: '240,226,206', shade: '176,150,126', rim: '255,228,186' },
    winter: { light: '252,253,255', mid: '226,232,240', shade: '152,164,182', rim: '244,248,255' },
  };

  const SPRITE_W = 520, SPRITE_H = 300;        // sprite canvas (internal px)
  const SPRITE_KINDS = 6;
  const _spriteCache = {};                     // seasonId → [{ body, shadow }]

  // Puff layout for one cloud: a flat-ish base row with a taller middle
  // (cumulus), plus a couple of crown puffs. Coordinates in sprite px.
  function cloudPuffs(rng, wispy) {
    const puffs = [];
    const base = SPRITE_H * (wispy ? 0.62 : 0.72);
    const n = wispy ? 5 + Math.floor(rng() * 2) : 5 + Math.floor(rng() * 3);
    const span = SPRITE_W * (wispy ? 0.56 : 0.62);
    const left = (SPRITE_W - span) / 2;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const bell = Math.pow(Math.sin(Math.PI * (0.08 + t * 0.84)), 0.9);
      const r = SPRITE_H * (wispy ? 0.07 + 0.08 * bell : 0.10 + 0.17 * bell) * (0.85 + rng() * 0.3);
      puffs.push({ x: left + t * span + (rng() - 0.5) * 18, y: base - r * (wispy ? 0.3 : 0.55) + (rng() - 0.5) * 8, r });
    }
    if (!wispy) {
      const crowns = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < crowns; i++) {
        const r = SPRITE_H * (0.12 + rng() * 0.07);
        puffs.push({ x: SPRITE_W * (0.4 + rng() * 0.2), y: base - SPRITE_H * (0.3 + rng() * 0.1), r });
      }
    }
    return { puffs, base, left, span };
  }

  function silhouette(layout, wispy) {
    const c = makeCanvas(SPRITE_W, SPRITE_H);
    const k = c.getContext('2d');
    k.fillStyle = '#fff';
    const sx = wispy ? 1.9 : 1;                // wisps: long, stretched puffs
    for (const p of layout.puffs) { k.beginPath(); k.ellipse(p.x, p.y, p.r * sx, p.r, 0, 0, TAU); k.fill(); }
    // flatten the underside
    k.beginPath();
    k.ellipse(SPRITE_W / 2, layout.base - SPRITE_H * 0.02, layout.span * 0.5, SPRITE_H * (wispy ? 0.05 : 0.07), 0, 0, TAU);
    k.fill();
    return c;
  }

  // Blur a canvas by ~px. Native ctx.filter where the browser has it;
  // otherwise a smooth halving/doubling chain (a single big down/up-scale
  // leaves visible blocks).
  const _nativeBlur = (() => {
    try {
      return typeof CanvasRenderingContext2D !== 'undefined'
        && 'filter' in CanvasRenderingContext2D.prototype;
    } catch (e) { return false; }
  })();
  function blurred(src, px) {
    const W0 = src.width, H0 = src.height;
    const out = makeCanvas(W0, H0);
    const ok = out.getContext('2d');
    if (_nativeBlur) {
      // Wide blurs run at reduced resolution — the result is soft anyway,
      // and it cuts the cost by ~4–9×.
      const f = px >= 8 ? 3 : px >= 4 ? 2 : 1;
      if (f === 1) {
        ok.filter = `blur(${px}px)`;
        ok.drawImage(src, 0, 0);
        ok.filter = 'none';
        return out;
      }
      const sw = Math.ceil(W0 / f), sh = Math.ceil(H0 / f);
      const a = makeCanvas(sw, sh), ak = a.getContext('2d');
      ak.drawImage(src, 0, 0, sw, sh);
      const b = makeCanvas(sw, sh), bk = b.getContext('2d');
      bk.filter = `blur(${px / f}px)`;
      bk.drawImage(a, 0, 0);
      ok.imageSmoothingEnabled = true;
      ok.drawImage(b, 0, 0, W0, H0);
      return out;
    }
    const steps = Math.max(1, Math.round(Math.log2(Math.max(2, px))));
    let cur = src, w = W0, h = H0;
    const chain = [];
    for (let i = 0; i < steps; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      const c = makeCanvas(w, h); const k = c.getContext('2d');
      k.imageSmoothingEnabled = true; k.drawImage(cur, 0, 0, w, h);
      chain.push(c); cur = c;
    }
    for (let i = chain.length - 2; i >= 0; i--) {
      const c = makeCanvas(chain[i].width, chain[i].height); const k = c.getContext('2d');
      k.imageSmoothingEnabled = true; k.drawImage(cur, 0, 0, c.width, c.height);
      cur = c;
    }
    ok.imageSmoothingEnabled = true;
    ok.drawImage(cur, 0, 0, W0, H0);
    return out;
  }

  function tinted(src, rgba) {
    const c = makeCanvas(src.width, src.height);
    const k = c.getContext('2d');
    k.drawImage(src, 0, 0);
    k.globalCompositeOperation = 'source-in';
    k.fillStyle = rgba;
    k.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function buildSprite(kind, tint) {
    const rng = mulberry32(hashStr('kw-cloud-' + kind));
    const wispy = kind >= SPRITE_KINDS - 2;          // last two kinds = high wisps
    const layout = cloudPuffs(rng, wispy);
    const sil = silhouette(layout, wispy);
    const soft = blurred(sil, wispy ? 9 : 2.5);       // soft-edged alpha mask

    // ── Body: shaded base, then lit lobes painted "atop" it ───────────────
    const body = tinted(soft, `rgb(${tint.shade})`);
    const bk = body.getContext('2d');
    bk.globalCompositeOperation = 'source-atop';

    // Mid-tone: the whole silhouette nudged toward the sun, so the lower-right
    // edge keeps a band of shade (reads as volume, not a flat sticker).
    const midL = makeCanvas(SPRITE_W, SPRITE_H);
    const mk = midL.getContext('2d');
    mk.drawImage(sil, -6, -10);
    bk.drawImage(blurred(tinted(midL, `rgb(${tint.mid})`), 10), 0, 0);

    // Lit lobes: each puff shifted toward the light and shrunk, blurred —
    // gives every billow a bright crown with a soft shaded crescent below.
    const lit = makeCanvas(SPRITE_W, SPRITE_H);
    const lk = lit.getContext('2d');
    lk.fillStyle = `rgb(${tint.light})`;
    const lsx = wispy ? 1.9 : 1;
    for (const p of layout.puffs) {
      lk.beginPath();
      lk.ellipse(p.x - p.r * 0.2, p.y - p.r * 0.3, p.r * 0.7 * lsx, p.r * 0.7, 0, 0, TAU);
      lk.fill();
    }
    bk.globalAlpha = wispy ? 0.8 : 1;
    bk.drawImage(blurred(lit, wispy ? 10 : 6), 0, 0);
    bk.globalAlpha = 1;

    // Flat, cooler underside (cumulus are grey underneath).
    const ug = bk.createLinearGradient(0, layout.base - SPRITE_H * 0.2, 0, layout.base + SPRITE_H * 0.06);
    ug.addColorStop(0, `rgba(${tint.shade},0)`);
    ug.addColorStop(1, `rgba(${tint.shade},${wispy ? 0.3 : 0.55})`);
    bk.fillStyle = ug;
    bk.fillRect(0, 0, SPRITE_W, SPRITE_H);

    // Warm sun-rim on the upper-left edge: silhouette minus itself nudged
    // down-right leaves a thin crescent to brighten.
    const rim = makeCanvas(SPRITE_W, SPRITE_H);
    const rk = rim.getContext('2d');
    rk.drawImage(sil, 0, 0);
    rk.globalCompositeOperation = 'destination-out';
    rk.drawImage(sil, 3, 6);
    bk.globalAlpha = 0.7;
    bk.drawImage(blurred(tinted(rim, `rgb(${tint.rim})`), 1.5), 0, 0);
    bk.globalAlpha = 1;
    bk.globalCompositeOperation = 'source-over';

    // ── Final sprite = faint halo + body ──────────────────────────────────
    const out = makeCanvas(SPRITE_W, SPRITE_H);
    const ok = out.getContext('2d');
    ok.drawImage(blurred(tinted(sil, `rgba(${tint.light},0.45)`), 12), 0, 0);
    ok.drawImage(body, 0, 0);

    // ── Ground shadow: heavily blurred silhouette ─────────────────────────
    const shadow = blurred(tinted(sil, 'rgb(34,26,16)'), 18);

    return { body: out, shadow, wispy };
  }

  // Sprites build lazily, one per call (i.e. per frame) unless `all`, so a
  // season's first frames never hitch; clouds whose sprite isn't ready yet
  // simply aren't drawn until it is.
  function sprites(season, all) {
    const list = _spriteCache[season] || (_spriteCache[season] = []);
    const tint = SEASON_TINT[season] || SEASON_TINT.summer;
    do {
      if (list.length >= SPRITE_KINDS) break;
      list.push(buildSprite(list.length, tint));
    } while (all);
    return list;
  }

  // The cloud field: a periodic domain FIELD×FIELD (CSS px) seeded with
  // weather "systems" (clusters) so there are banks of cloud and open sky.
  const FIELD = 3400;
  const WIND = { x: 11, y: 3.2 };              // px / second at speed 1
  let _field = null;
  function field() {
    if (_field) return _field;
    const rng = mulberry32(hashStr('kw-cloud-field'));
    const low = [], high = [];
    const systems = 22;
    for (let s = 0; s < systems; s++) {
      const sx = rng() * FIELD, sy = rng() * FIELD;
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        low.push({
          x: sx + (rng() - 0.5) * 520, y: sy + (rng() - 0.5) * 260,
          kind: Math.floor(rng() * (SPRITE_KINDS - 2)),
          scale: 0.6 + rng() * 0.55,
          speed: 0.85 + rng() * 0.3,
          alpha: 0.78 + rng() * 0.17,
          flip: rng() < 0.5,
          phase: rng() * TAU,
        });
      }
    }
    for (let i = 0; i < 9; i++) {
      high.push({
        x: rng() * FIELD, y: rng() * FIELD,
        kind: SPRITE_KINDS - 2 + Math.floor(rng() * 2),
        scale: 0.9 + rng() * 0.6,
        speed: 1.5 + rng() * 0.4,
        alpha: 0.30 + rng() * 0.15,
        flip: rng() < 0.5,
        phase: rng() * TAU,
      });
    }
    // Draw order within a layer: back (smaller y) first.
    low.sort((a, b) => a.y - b.y);
    _field = { low, high };
    return _field;
  }

  function perfLevel() {
    try { return (KW.perf && KW.perf.level) || 0; } catch (e) { return 0; }
  }

  // Draw one layer of clouds (or their shadows).
  //   parallax: >1 = higher than the ground (moves faster when panning)
  //   shadowMode: draw ground shadows instead of bodies
  function drawLayer(ctx, W, H, camX, camY, tSec, list, spr, parallax, ys, shadowMode) {
    const cxS = W / 2, cyS = H / 2;
    const clearR = Math.min(W, H) * 0.42;
    for (const c of list) {
      const s = spr[c.kind];
      if (!s) continue;
      const w = SPRITE_W * c.scale * 0.72, h = SPRITE_H * c.scale * 0.72;
      // world drift + a slow lazy wobble so clouds don't march in lockstep
      const wx = c.x + WIND.x * tSec * c.speed + Math.sin(tSec * 0.05 + c.phase) * 14;
      const wy = c.y + WIND.y * tSec * c.speed + Math.cos(tSec * 0.04 + c.phase) * 8;
      let sx, sy, img, alpha, dw = w, dh = h;
      if (shadowMode) {
        // Shadow sits on the ground plane below/right of the cloud (sun upper-left).
        sx = mod(wx - camX + cxS + 40 * c.scale, FIELD) - w / 2;
        sy = mod(wy * ys - camY + cyS + 120 * c.scale * ys, FIELD) - h / 2;
        dh = h * ys * 0.9;
        img = s.shadow;
        alpha = c.alpha * 0.16;
      } else {
        sx = mod(wx - camX * parallax + cxS, FIELD) - w / 2;
        sy = mod(wy * ys - camY * parallax + cyS, FIELD) - h / 2;
        img = s.body;
        alpha = c.alpha;
      }
      // Wrap: the field repeats every FIELD px; draw each copy that's on screen.
      for (let oy = sy - FIELD; oy < H; oy += FIELD) {
        if (oy + dh < 0) continue;
        for (let ox = sx - FIELD; ox < W; ox += FIELD) {
          if (ox + dw < 0) continue;
          let a = alpha;
          if (!shadowMode) {
            // Thin clouds over the centre of view so the focus stays readable.
            const d = Math.hypot(ox + dw / 2 - cxS, (oy + dh / 2 - cyS) * 1.4);
            const k = Math.min(1, Math.max(0, (d - clearR * 0.35) / clearR));
            a *= 0.3 + 0.7 * (k * k * (3 - 2 * k));
          }
          ctx.globalAlpha = a;
          if (c.flip) {
            ctx.save();
            ctx.translate(ox + dw, oy);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0, dw, dh);
            ctx.restore();
          } else {
            ctx.drawImage(img, ox, oy, dw, dh);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawClouds(ctx, W, H, camX, camY, now, opts) {
    if (!_cloudsOn) return;
    const lvl = perfLevel();
    if (lvl >= 5) return;
    const ys = (opts && opts.yScale) || 1;
    const tSec = (typeof now === 'number' ? now : (typeof performance !== 'undefined' ? performance.now() : 0)) / 1000
      + KW.atmosphere._timeOffset;
    let spr;
    try { spr = sprites(seasonId()); } catch (e) { return; }
    const f = field();
    ctx.save();
    if (lvl < 3) drawLayer(ctx, W, H, camX, camY, tSec, f.low, spr, 1, ys, true);
    drawLayer(ctx, W, H, camX, camY, tSec, f.low, spr, 1.14, ys, false);
    if (lvl < 2) drawLayer(ctx, W, H, camX, camY, tSec, f.high, spr, 1.32, ys, false);
    ctx.restore();
  }

  KW.atmosphere = {
    drawBackdrop,
    drawClouds,
    get clouds() { return _cloudsOn; },
    setClouds(on) {
      _cloudsOn = !!on;
      try { localStorage.setItem(LS_CLOUDS, on ? '1' : '0'); } catch (e) {}
      requestRender();
    },
    // test / debug hooks
    _timeOffset: 0,                    // seconds added to the cloud clock
    _buildChart: buildChart,
    _sprites: (season) => sprites(season, true),
  };
})();
