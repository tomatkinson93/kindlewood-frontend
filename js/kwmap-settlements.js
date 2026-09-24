// ══════════════════════════════════════════════════════════════════════════
//  KWMap SETTLEMENTS — map sprites for settlements, one look per tier
//
//  Procedural miniatures painted to offscreen canvases in the same flat,
//  softly shaded style as the iso trees, cached per (look, pixel size), and
//  drawn by both renderers:
//    camp     — tents around a campfire
//    village  — thatched cottages and a fence
//    town     — tiled houses, a church spire, a stretch of wall
//    city     — ring wall with towers, keep and rooftops
//    kingdom  — a gilded city (Ironhaven); annex tiles get a wall segment
//    hostile  — the Withered: black palisade and a sick violet glow
//  NPC settlements use their tier's layout with moss-green roofs.
//
//  KWSettlements.draw(ctx, t, cx, baseY, hexW, frac) draws the settlement on
//  tile `t` with its footing centred on (cx, baseY). Swap in real sprite art
//  later by returning an image from spriteFor(); the call sites don't change.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const TIER_SCALE = { camp: 0.95, village: 1.05, town: 1.2, city: 1.38, kingdom: 1.5, annex: 1.0, hostile: 1.05 };

  // Palettes: roofs per look, walls shared.
  const WALL = '#eadcbc', WALL_SHADE = '#c4b08a', STONE = '#b9b1a3', STONE_SHADE = '#8d8577', OUTLINE = 'rgba(40,26,12,0.55)';
  const ROOFS = {
    camp: ['#b8764a', '#8e4f2c'], village: ['#d2a24c', '#a87a2e'], town: ['#a4452c', '#7a2f1c'],
    city: ['#3f5f86', '#2c4462'], kingdom: ['#d8ae42', '#a8801f'], npc: ['#6f8a4a', '#50663a'],
    hostile: ['#3a2a3e', '#241a28'],
  };

  function lookFor(t) {
    const s = t.settlement || {};
    const type = s.settlement_type || (s.is_kingdom ? 'kingdom' : s.disposition === 'hostile' ? 'hostile' : (s.npc_id ? 'npc' : 'player'));
    const tier = ['camp', 'village', 'town', 'city'].includes(s.tier) ? s.tier : 'village';
    if (type === 'kingdom') return { layout: s.is_kingdom_annex ? 'annex' : 'city', roof: 'kingdom', key: s.is_kingdom_annex ? 'annex' : 'kingdom' };
    if (type === 'hostile') return { layout: 'hostile', roof: 'hostile', key: 'hostile' };
    if (type === 'npc') return { layout: tier, roof: 'npc', key: 'npc-' + tier };
    return { layout: tier, roof: tier, key: tier };
  }

  // ── Primitives (unit box: 100 × 100, footing along y ≈ 86) ────────────────
  function poly(c, pts, fill, stroke) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.2; c.stroke(); }
  }

  // Cottage: front wall + shaded side + gabled roof (two faces).
  function house(c, x, y, w, h, roof, opts) {
    const d = w * 0.35, rh = h * 0.75, o = opts || {};
    poly(c, [[x + w, y - h], [x + w + d, y - h - d * 0.45], [x + w + d, y - d * 0.45], [x + w, y]], o.side || WALL_SHADE, OUTLINE);
    poly(c, [[x, y], [x, y - h], [x + w, y - h], [x + w, y]], o.wall || WALL, OUTLINE);
    poly(c, [[x - 2, y - h], [x + w / 2, y - h - rh], [x + w + 2, y - h]], roof[0], OUTLINE);
    poly(c, [[x + w / 2, y - h - rh], [x + w / 2 + d, y - h - rh - d * 0.45], [x + w + d + 2, y - h - d * 0.45], [x + w + 2, y - h]], roof[1], OUTLINE);
    if (!o.noDoor) poly(c, [[x + w * 0.4, y], [x + w * 0.4, y - h * 0.5], [x + w * 0.62, y - h * 0.5], [x + w * 0.62, y]], '#6b4a2b');
  }

  function tower(c, x, y, w, h, roof, body) {
    poly(c, [[x + w, y - h], [x + w + w * 0.3, y - h - 3], [x + w + w * 0.3, y - 3], [x + w, y]], (body || STONE_SHADE), OUTLINE);
    poly(c, [[x, y], [x, y - h], [x + w, y - h], [x + w, y]], body ? body : STONE, OUTLINE);
    poly(c, [[x - 2, y - h], [x + w / 2 + 1, y - h - w * 1.3], [x + w + w * 0.3 + 2, y - h - 1]], roof[0], OUTLINE);
    poly(c, [[x + w / 2 + 1, y - h - w * 1.3], [x + w + w * 0.3 + 2, y - h - 1], [x + w * 0.9, y - h]], roof[1]);
    poly(c, [[x + w * 0.35, y - h * 0.55], [x + w * 0.35, y - h * 0.7], [x + w * 0.62, y - h * 0.7], [x + w * 0.62, y - h * 0.55]], '#3a2c1c');
  }

  function tent(c, x, y, w, h, col) {
    poly(c, [[x, y], [x + w / 2, y - h], [x + w * 0.55, y]], col[0], OUTLINE);
    poly(c, [[x + w * 0.55, y], [x + w / 2, y - h], [x + w, y]], col[1], OUTLINE);
    poly(c, [[x + w * 0.42, y], [x + w / 2, y - h * 0.45], [x + w * 0.58, y]], '#3b2716');
  }

  function flag(c, x, y, h, col) {
    c.strokeStyle = '#4a3420'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.stroke();
    poly(c, [[x, y - h], [x + h * 0.45, y - h + h * 0.12], [x, y - h + h * 0.24]], col);
  }

  function wallSeg(c, x1, x2, y, h) {
    poly(c, [[x1, y], [x1, y - h], [x2, y - h], [x2, y]], STONE, OUTLINE);
    c.fillStyle = STONE;
    for (let x = x1; x < x2 - 2; x += 6) { c.fillRect(x, y - h - 3, 3.5, 3); c.strokeStyle = OUTLINE; c.lineWidth = 0.8; c.strokeRect(x, y - h - 3, 3.5, 3); }
  }

  function shadow(c, rx, ry) {
    c.fillStyle = 'rgba(20,14,8,0.28)';
    c.beginPath(); c.ellipse(50, 86, rx, ry, 0, 0, Math.PI * 2); c.fill();
  }

  // ── Layouts ──────────────────────────────────────────────────────────────
  const LAYOUTS = {
    camp(c, roof) {
      shadow(c, 34, 9);
      tent(c, 22, 82, 26, 26, [roof[0], roof[1]]);
      tent(c, 52, 86, 30, 30, ['#c9b78f', '#a2906a']);
      // campfire
      c.fillStyle = '#5a3a20'; c.fillRect(44, 86, 12, 3);
      c.fillStyle = '#f19a36'; c.beginPath(); c.ellipse(50, 83, 5, 6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffd36e'; c.beginPath(); c.ellipse(50, 84, 2.5, 3.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(210,210,210,0.55)';
      [[52, 72, 3], [49, 64, 3.8], [53, 55, 4.5]].forEach(([x, y, r]) => { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); });
    },
    village(c, roof) {
      shadow(c, 40, 10);
      house(c, 18, 78, 20, 14, roof);
      house(c, 56, 76, 18, 13, roof);
      house(c, 36, 90, 22, 15, roof);
      c.strokeStyle = '#7a5530'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(12, 92); c.lineTo(30, 95); c.moveTo(66, 95); c.lineTo(88, 90); c.stroke();
      for (const x of [14, 22, 30, 68, 76, 84]) { c.beginPath(); c.moveTo(x, 96); c.lineTo(x, 89); c.stroke(); }
    },
    town(c, roof) {
      shadow(c, 44, 11);
      wallSeg(c, 8, 34, 92, 8);
      tower(c, 44, 70, 12, 34, ['#5b6d8a', '#3f4f68']);          // church spire
      house(c, 14, 74, 20, 15, roof);
      house(c, 62, 74, 20, 15, roof);
      house(c, 26, 90, 20, 14, roof);
      house(c, 56, 92, 22, 15, roof);
      flag(c, 50, 36 - 14, 12, '#c9a14a');
    },
    city(c, roof, look) {
      shadow(c, 48, 12);
      const gold = look && look.key === 'kingdom';
      // back ring: towers + wall
      tower(c, 10, 66, 11, 22, roof); tower(c, 79, 66, 11, 22, roof);
      wallSeg(c, 20, 80, 66, 10);
      // keep
      tower(c, 40, 62, 18, 34, roof);
      house(c, 20, 76, 18, 13, roof); house(c, 62, 76, 18, 13, roof);
      house(c, 30, 82, 16, 12, roof, { noDoor: true }); house(c, 52, 82, 16, 12, roof, { noDoor: true });
      // front wall with gate + corner towers
      wallSeg(c, 16, 84, 96, 12);
      poly(c, [[45, 96], [45, 88], [55, 88], [55, 96]], '#3a2c1c');
      tower(c, 6, 97, 12, 20, roof); tower(c, 82, 97, 12, 20, roof);
      flag(c, 49, 62 - 34, 14, gold ? '#6a3d8a' : '#a4452c');
      if (gold) { flag(c, 12, 44, 10, '#6a3d8a'); flag(c, 85, 44, 10, '#6a3d8a'); }
    },
    annex(c, roof) {
      shadow(c, 38, 9);
      wallSeg(c, 16, 84, 90, 12);
      tower(c, 10, 92, 12, 22, roof); tower(c, 78, 92, 12, 22, roof);
      flag(c, 16, 70, 10, '#6a3d8a');
    },
    hostile(c, roof) {
      // sick glow
      const g = c.createRadialGradient(50, 80, 2, 50, 80, 40);
      g.addColorStop(0, 'rgba(150,60,190,0.45)'); g.addColorStop(1, 'rgba(150,60,190,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(50, 80, 44, 20, 0, 0, 7); c.fill();
      shadow(c, 40, 10);
      house(c, 34, 80, 24, 16, roof, { wall: '#5a4a52', side: '#3e3238' });
      // palisade
      for (let i = 0; i < 12; i++) {
        const x = 8 + i * 7.5, h = 16 + ((i * 37) % 7);
        poly(c, [[x, 96], [x, 96 - h], [x + 2.5, 96 - h - 4], [x + 5, 96 - h], [x + 5, 96]], i % 2 ? '#2a1e22' : '#3a2a2e', 'rgba(0,0,0,0.6)');
      }
      c.fillStyle = '#d58cff';
      [[46, 70], [55, 70]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); });
    },
  };

  // ── Cache + draw ─────────────────────────────────────────────────────────
  const _cache = new Map();
  function spriteFor(t, px) {
    const look = lookFor(t);
    const size = Math.max(16, Math.round(px));
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const key = look.key + '@' + size + 'x' + dpr;
    let cv = _cache.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(size * dpr);
    const c = cv.getContext('2d');
    c.scale(size * dpr / 100, size * dpr / 100);
    c.lineJoin = 'round';
    (LAYOUTS[look.layout] || LAYOUTS.village)(c, ROOFS[look.roof] || ROOFS.village, look);
    cv._size = size;
    if (_cache.size > 200) _cache.clear();
    _cache.set(key, cv);
    return cv;
  }

  // Draws the settlement on tile t with its footing centred on (cx, baseY).
  // hexW = tile width in px; the sprite scales with tier.
  function draw(ctx, t, cx, baseY, hexW) {
    const look = lookFor(t);
    const px = hexW * (TIER_SCALE[look.key] || TIER_SCALE[look.layout] || 1);
    const cv = spriteFor(t, px);
    const s = cv._size;
    // unit footing is (50, 86) of the 100-box
    ctx.drawImage(cv, cx - s * 0.5, baseY - s * 0.86, s, s);
  }

  // Height of the drawn sprite above its footing, for placing nameplates.
  function heightAbove(t, hexW) {
    const look = lookFor(t);
    return hexW * (TIER_SCALE[look.key] || TIER_SCALE[look.layout] || 1) * 0.72;
  }

  global.KWSettlements = { draw, heightAbove, lookFor, spriteFor };
})(typeof window !== 'undefined' ? window : globalThis);
