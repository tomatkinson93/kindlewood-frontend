// ══════════════════════════════════════════════════════════════════════════
//  tactics — the tactics battle prototype's screen (docs/TACTICS_PROTOTYPE.md).
//
//  A full-screen scene: an isometric board drawn on a canvas, the party's
//  citizens as their villager sprites, creatures as their icons. The rules
//  are js/tactics-engine.js; this file draws, listens and animates.
//
//  A turn on screen: the unit whose turn it is has a gold marker. Blue tiles
//  are where it can walk. The buttons below are its abilities; choosing one
//  marks who it can reach. With a mouse a click acts at once (hovering shows
//  what it would do); on a touch screen the first tap shows what it would do
//  and a second tap (or Confirm) does it.
//
//  Started from Dev Tools → 💀 Dungeons (devMount). Nothing is saved: the two
//  sides come from /api/tactics/admin/setup and the battle lives in memory.
//
//  Exports: KWTactics { start, close, devMount, _state, _geom, _tapTile, … }.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const E = () => global.KWTacticsEngine;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const now = () => (global.performance ? global.performance.now() : Date.now());
  const still = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // mode: 'idle' (choose where to walk or what to do) or 'target' (an ability is chosen).
  // pick: the tile tapped once and waiting for a second tap. info: a unit being looked at.
  const S = { open: false, setup: null, opts: null, state: null, view: {}, floats: [], mode: 'idle', ability: null, pick: null, hover: null, cursor: null,
    info: null, busy: false, pointer: 'mouse', rot: 0, started: 0, ended: 0, raf: 0, banner: null, el: null, canvas: null, ctx: null, round: 1 };
  const G = { tw: 64, th: 32, lift: 16, scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  // ── The board's colours (drawn on a canvas, so they live here) ────────────
  const GROUND = {
    grass: { top: ['#7fae52', '#86b558', '#78a84d'], left: '#5a7f3a', right: '#4a6c30' },
    mud:   { top: ['#8a7a52', '#84744c', '#907f58'], left: '#63573a', right: '#52482f' },
    stone: { top: ['#a39c8e', '#aaa396', '#9c9587'], left: '#7a7468', right: '#666056' },
    water: { top: ['#4f8fc4', '#5797ca', '#4a89bd'], left: '#3a6d98', right: '#305c82' },
  };
  const INK = 'rgba(30, 20, 10, 0.28)';
  const TINT = { move: 'rgba(90, 160, 255, 0.42)', path: 'rgba(255, 255, 255, 0.5)', range: 'rgba(255, 214, 120, 0.2)', foe: 'rgba(240, 90, 70, 0.55)', friend: 'rgba(120, 220, 140, 0.55)', danger: 'rgba(240, 90, 70, 0.26)' };
  const TEAM = { player: '#f0cf7a', enemy: '#e0705f' };
  const CLASS_COLOUR = { guard: '#7fa3c9', archer: '#8fc070', wizard: '#b18ae0', hearthkeeper: '#f0a058', villager: '#cdb48a', creature: '#e0705f' };
  const STATUS = { weak: ['Weak', '↓'], vulnerable: ['Vulnerable', '◎'], slow: ['Slowed', '🐌'], poison: ['Poisoned', '☠'], stun: ['Stunned', '💫'], bold: ['Emboldened', '⬆'] };

  // ── Geometry ──────────────────────────────────────────────────────────────
  // The board can be turned a quarter at a time (S.rot), because a hill in
  // front hides what stands behind it. view(x, y): where a tile sits on the
  // turned board; turn(dx, dy): a direction, turned the same way.
  function view(x, y) {
    const m = S.state.map, W = m.w - 1, H = m.h - 1;
    switch (S.rot & 3) { case 1: return [H - y, x]; case 2: return [W - x, H - y]; case 3: return [y, W - x]; default: return [x, y]; }
  }
  function turn(dx, dy, back) {
    switch ((back ? 4 - S.rot : S.rot) & 3) { case 1: return [-dy, dx]; case 2: return [-dx, -dy]; case 3: return [dy, -dx]; default: return [dx, dy]; }
  }
  const depth = (x, y) => { const v = view(x, y); return v[0] + v[1]; };
  // The top corner of a tile's face on the canvas, in CSS pixels.
  function tileXY(x, y, h) {
    const v = view(x, y);
    return { x: G.ox + (v[0] - v[1]) * G.tw / 2 * G.scale, y: G.oy + (v[0] + v[1]) * G.th / 2 * G.scale - (h || 0) * G.lift * G.scale };
  }
  // The middle of the face of the tile a unit stands on (fractions allowed, while walking).
  function standXY(vx, vy) {
    const m = S.state.map, e = E();
    const hAt = (x, y) => { const t = e.tileAt(m, Math.max(0, Math.min(m.w - 1, x)), Math.max(0, Math.min(m.h - 1, y))); return t ? t.h : 0; };
    const x0 = Math.floor(vx), y0 = Math.floor(vy), fx = vx - x0, fy = vy - y0;
    const h = hAt(x0, y0) * (1 - fx) * (1 - fy) + hAt(x0 + 1, y0) * fx * (1 - fy) + hAt(x0, y0 + 1) * (1 - fx) * fy + hAt(x0 + 1, y0 + 1) * fx * fy;
    const p = tileXY(vx, vy, h);
    return { x: p.x, y: p.y + G.th / 2 * G.scale };
  }
  function layout() {
    if (!S.canvas || !S.state) return;
    const wrap = S.canvas.parentNode, cw = wrap.clientWidth, ch = wrap.clientHeight, m = S.state.map;
    const peak = Math.max(...m.tiles.map(t => t.h));
    const bw = (m.w + m.h) * G.tw / 2, head = 58, foot = 22;
    const bh = (m.w + m.h) * G.th / 2 + peak * G.lift + head + foot;
    G.scale = Math.max(0.45, Math.min(2.4, Math.min((cw - 8) / bw, (ch - 8) / bh)));
    G.dpr = Math.min(2, global.devicePixelRatio || 1);
    G.w = cw; G.h = ch;
    S.canvas.width = Math.round(cw * G.dpr); S.canvas.height = Math.round(ch * G.dpr);
    S.canvas.style.width = cw + 'px'; S.canvas.style.height = ch + 'px';
    G.ox = (cw - bw * G.scale) / 2 + ((S.rot & 1) ? m.w : m.h) * G.tw / 2 * G.scale;
    G.oy = (ch - bh * G.scale) / 2 + (head + peak * G.lift) * G.scale;
  }
  // Every tile, the farthest from the viewer first (as the board is turned now).
  function tilesByDepth() {
    const m = S.state.map, out = [];
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) out.push({ x, y, d: depth(x, y) });
    return out.sort((a, b) => a.d - b.d);
  }
  // What is under a point: the tile whose face it is on (nearest the viewer
  // first), and the unit whose body it is on. A body stands above its tile and
  // so covers the tile behind it; tileAtPoint decides which the player means.
  function underPoint(px, py) {
    const m = S.state.map, k = G.scale;
    let face = null, body = null;
    for (const q of tilesByDepth().reverse()) {
      const t = m.tiles[q.y * m.w + q.x], p = tileXY(q.x, q.y, t.h);
      if (Math.abs(px - p.x) / (G.tw / 2 * k) + Math.abs(py - (p.y + G.th / 2 * k)) / (G.th / 2 * k) <= 1) { face = { x: q.x, y: q.y }; break; }
    }
    const units = Object.values(S.view).filter(v => !v.gone).sort((a, b) => depth(b.x, b.y) - depth(a.x, a.y));
    for (const v of units) {
      const p = standXY(v.x, v.y);
      if (Math.abs(px - p.x) <= 13 * k && py <= p.y + 6 * k && py >= p.y - 44 * k) { body = { x: Math.round(v.x), y: Math.round(v.y), upper: py < p.y - 11 * k }; break; }
    }
    return { face, body };
  }
  // A tile the player could mean by tapping it now: with an ability chosen,
  // one it can be aimed at; otherwise one with someone on it or one to walk to.
  function wanted(t) {
    const e = E(), st = S.state, u = e.current(st);
    if (!t) return false;
    if (u && u.side === 'player' && S.mode === 'target' && S.ability) return e.targetTiles(st, u, e.ability(u, S.ability)).some(p => p.x === t.x && p.y === t.y);
    if (e.unitAt(st, t.x, t.y)) return true;
    if (!u || u.side !== 'player') return false;
    const n = st.turn.moved ? null : e.reach(st, u).get(t.x + ',' + t.y);
    return !!(n && n.stop && n.cost);
  }
  function tileAtPoint(px, py) {
    const { face, body } = underPoint(px, py);
    if (!body || !face || (body.x === face.x && body.y === face.y)) return face || body;
    const wf = wanted(face), wb = wanted(body);
    if (wf !== wb) return wf ? face : body;
    // Both make sense (or neither): the head and shoulders mean the unit, the feet mean the ground.
    return body.upper ? body : face;
  }

  // ── Sprites ───────────────────────────────────────────────────────────────
  const IMG = {};
  function sheet(url) {
    if (!IMG[url]) { const i = new global.Image(); i.src = url; IMG[url] = i; }
    return IMG[url].complete && IMG[url].naturalWidth ? IMG[url] : null;
  }
  function spriteOf(v, t) {
    const KV = global.KWVillagers;
    if (!KV || !KV.meta || !KV.spriteFor) return null;
    const f = E().DIRS[v.face] || [0, 1], tv = turn(f[0], f[1]);
    const s = KV.spriteFor(KV.meta, (S.setup && S.setup.species) || 'Mice', v.walking ? 'walk' : 'idle', tv[0] > 0 ? 'se' : tv[0] < 0 ? 'nw' : tv[1] > 0 ? 'sw' : 'ne');
    if (!s) return null;
    const img = sheet(s.url);
    return img ? { img, s, frame: still() ? 0 : Math.floor(t / s.ms) % s.frames } : null;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
  function diamond(c, p, k) {
    c.beginPath();
    c.moveTo(p.x, p.y); c.lineTo(p.x + G.tw / 2 * k, p.y + G.th / 2 * k); c.lineTo(p.x, p.y + G.th * k); c.lineTo(p.x - G.tw / 2 * k, p.y + G.th / 2 * k);
    c.closePath();
  }
  function drawTile(c, x, y, t, tint, tNow) {
    const k = G.scale, wet = t.t === 'water', g = GROUND[wet ? 'water' : (GROUND[t.t] ? t.t : (t.t === 'tree' || t.t === 'rock') ? ((E().LANDS[S.state.map.land] || {}).ground || 'grass') : 'grass')];
    const p = tileXY(x, y, t.h - (wet ? 0.25 : 0)), drop = (t.h + 0.9) * G.lift * k;
    // The two faces towards the viewer, down to the slab the board sits on.
    c.fillStyle = g.left;
    c.beginPath(); c.moveTo(p.x - G.tw / 2 * k, p.y + G.th / 2 * k); c.lineTo(p.x, p.y + G.th * k); c.lineTo(p.x, p.y + G.th * k + drop); c.lineTo(p.x - G.tw / 2 * k, p.y + G.th / 2 * k + drop); c.closePath(); c.fill();
    c.fillStyle = g.right;
    c.beginPath(); c.moveTo(p.x + G.tw / 2 * k, p.y + G.th / 2 * k); c.lineTo(p.x, p.y + G.th * k); c.lineTo(p.x, p.y + G.th * k + drop); c.lineTo(p.x + G.tw / 2 * k, p.y + G.th / 2 * k + drop); c.closePath(); c.fill();
    c.fillStyle = g.top[hash(x, y) % g.top.length];
    diamond(c, p, k); c.fill();
    c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
    if (wet && !still()) {   // a glint that drifts
      const ph = (tNow / 900 + hash(x, y) % 7) % 3;
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.beginPath();
      c.moveTo(p.x - 10 * k + ph * 4 * k, p.y + G.th / 2 * k); c.lineTo(p.x - 2 * k + ph * 4 * k, p.y + G.th / 2 * k); c.stroke();
    }
    for (const col of tint) { c.fillStyle = col; diamond(c, p, k); c.fill(); }
    return p;
  }
  function drawProp(c, x, y, t) {
    const k = G.scale, p = tileXY(x, y, t.h), cx = p.x, cy = p.y + G.th / 2 * k;
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(cx, cy + 2 * k, 15 * k, 6 * k, 0, 0, 6.3); c.fill();
    if (t.t === 'tree') {
      c.fillStyle = '#6b4a2e'; c.fillRect(cx - 3 * k, cy - 16 * k, 6 * k, 18 * k);
      const blobs = [[0, -24, 15, '#3f7a3a'], [-8, -30, 11, '#4b8a43'], [8, -31, 11, '#4b8a43'], [0, -39, 11, '#5c9c50']];
      for (const [dx, dy, r, col] of blobs) { c.fillStyle = col; c.beginPath(); c.arc(cx + dx * k, cy + dy * k, r * k, 0, 6.3); c.fill(); }
      c.strokeStyle = 'rgba(20,40,20,0.35)'; c.beginPath(); c.arc(cx, cy - 24 * k, 15 * k, 0.3, 2.8); c.stroke();
    } else {
      c.fillStyle = '#8d877b'; c.beginPath();
      c.moveTo(cx - 14 * k, cy + 2 * k); c.lineTo(cx - 9 * k, cy - 14 * k); c.lineTo(cx + 2 * k, cy - 19 * k); c.lineTo(cx + 13 * k, cy - 9 * k); c.lineTo(cx + 14 * k, cy + 3 * k); c.closePath(); c.fill();
      c.fillStyle = '#a9a396'; c.beginPath(); c.moveTo(cx - 9 * k, cy - 14 * k); c.lineTo(cx + 2 * k, cy - 19 * k); c.lineTo(cx + 3 * k, cy - 6 * k); c.lineTo(cx - 6 * k, cy - 3 * k); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(30,25,20,0.4)'; c.stroke();
    }
  }
  function drawUnit(c, v, t) {
    const k = G.scale, u = E().unit(S.state, v.id), p = standXY(v.x + (v.lx || 0), v.y + (v.ly || 0));
    const active = E().current(S.state) === u && !S.busy;
    c.save();
    c.globalAlpha = v.alpha == null ? 1 : v.alpha;
    // The ring it stands in (its side's colour) and the notch that shows where it faces.
    const pulse = active && !still() ? 0.5 + 0.5 * Math.sin(t / 220) : 0;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(p.x, p.y, 17 * k, 8 * k, 0, 0, 6.3); c.fill();
    c.strokeStyle = TEAM[u.side]; c.lineWidth = (active ? 2.5 + pulse : 1.8) * Math.max(1, k * 0.8);
    c.beginPath(); c.ellipse(p.x, p.y, 17 * k, 8 * k, 0, 0, 6.3); c.stroke();
    const f0 = E().DIRS[v.face] || [0, 1], f = turn(f0[0], f0[1]), fx = (f[0] - f[1]) * 17 * k, fy = (f[0] + f[1]) * 8 * k;
    // An arrowhead on the ground, pointing where it looks (its back is the other way).
    const fl = Math.hypot(fx, fy) || 1, ux = fx / fl, uy = fy / fl;
    c.fillStyle = TEAM[u.side]; c.beginPath();
    c.moveTo(p.x + fx + ux * 9 * k, p.y + fy + uy * 9 * k);
    c.lineTo(p.x + fx - uy * 5 * k, p.y + fy + ux * 5 * k);
    c.lineTo(p.x + fx + uy * 5 * k, p.y + fy - ux * 5 * k);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(20,12,6,0.7)'; c.lineWidth = 1; c.stroke();
    // The body.
    const flash = v.flash && t < v.flash;
    const sp = u.side === 'player' ? spriteOf(v, t) : null;
    if (flash && 'filter' in c) c.filter = 'brightness(2.2)';
    if (sp) {
      const s = sp.s, z = 0.62 * k, dw = s.w * z, dh = s.h * z;
      c.imageSmoothingEnabled = false;
      c.save();
      c.translate(p.x, p.y);
      if (s.flip) c.scale(-1, 1);
      c.drawImage(sp.img, sp.frame * s.w, s.row * s.h, s.w, s.h, -s.foot.x * z, -s.foot.y * z, dw, dh);
      c.restore();
    } else if (u.side === 'player') {
      c.fillStyle = CLASS_COLOUR[u.cls] || CLASS_COLOUR.villager; c.beginPath(); c.arc(p.x, p.y - 16 * k, 12 * k, 0, 6.3); c.fill();
      c.font = `${Math.round(15 * k)}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(u.icon || '•', p.x, p.y - 15 * k);
    } else {
      const bob = still() ? 0 : Math.sin(t / 380 + v.seed) * 1.5 * k;
      c.font = `${Math.round(28 * k)}px serif`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.fillText(u.icon || '👹', p.x, p.y + 2 * k + bob);
    }
    if ('filter' in c) c.filter = 'none';
    // Health, block, class and what ails it.
    const top = p.y - (u.side === 'player' ? 44 : 38) * k, bw = 34 * k, bh = Math.max(4, 4.5 * k);
    c.fillStyle = 'rgba(20,12,6,0.85)'; c.fillRect(p.x - bw / 2 - 1, top - 1, bw + 2, bh + 2);
    c.fillStyle = u.side === 'player' ? '#8fd070' : '#e0705f';
    c.fillRect(p.x - bw / 2, top, bw * Math.max(0, Math.min(1, v.hp / u.maxHp)), bh);
    c.textBaseline = 'middle'; c.font = `bold ${Math.round(Math.max(9, 9.5 * k))}px sans-serif`;
    if (u.side === 'player') { c.fillStyle = CLASS_COLOUR[u.cls] || CLASS_COLOUR.villager; c.beginPath(); c.arc(p.x - bw / 2 - 6 * k, top + bh / 2, 3.6 * k, 0, 6.3); c.fill(); }
    if (v.block > 0) { c.textAlign = 'left'; c.fillStyle = '#9fd0ff'; c.fillText('🛡' + v.block, p.x + bw / 2 + 3, top + bh / 2); }
    const ails = Object.keys(STATUS).filter(s => (v.st[s] || 0) > 0);
    if (ails.length) { c.textAlign = 'center'; c.fillStyle = '#fff3d6'; c.fillText(ails.map(s => STATUS[s][1] + v.st[s]).join(' '), p.x, top - 8 * k); }
    if (active) {
      const dy = still() ? 0 : Math.sin(t / 180) * 3 * k;
      c.fillStyle = '#ffd27a'; c.beginPath(); c.moveTo(p.x - 6 * k, top - 20 * k + dy); c.lineTo(p.x + 6 * k, top - 20 * k + dy); c.lineTo(p.x, top - 12 * k + dy); c.closePath(); c.fill();
    }
    c.restore();
  }
  // What each tile is tinted with just now.
  function tints() {
    const out = {}, add = (x, y, col) => { (out[x + ',' + y] = out[x + ',' + y] || []).push(col); };
    const e = E(), st = S.state, u = e.current(st);
    if (S.info && S.info.side === 'enemy' && !S.info.down) for (const n of e.reach(st, S.info).values()) add(n.x, n.y, TINT.danger);
    if (!u || u.side !== 'player' || S.busy) return out;
    if (S.mode === 'idle' && !st.turn.moved && !S.info) {
      const R = e.reach(st, u);
      for (const n of R.values()) if (n.stop && n.cost) add(n.x, n.y, TINT.move);
      const aim = S.pick || (S.pointer === 'mouse' ? S.hover : null);
      if (aim && R.get(aim.x + ',' + aim.y) && R.get(aim.x + ',' + aim.y).stop) for (const p of e.pathTo(R, aim.x, aim.y).slice(1)) add(p.x, p.y, TINT.path);
    }
    if (S.mode === 'target' && S.ability) {
      const a = e.ability(u, S.ability);
      for (const p of e.rangeTiles(st, u, a)) add(p.x, p.y, TINT.range);
      const col = a.target === 'enemy' ? TINT.foe : TINT.friend;
      for (const p of e.targetTiles(st, u, a)) add(p.x, p.y, col);
      const aim = S.pick || (S.pointer === 'mouse' ? S.hover : null);
      if (aim) for (const h of e.touched(st, u, a, aim.x, aim.y)) add(h.u.x, h.u.y, TINT.path);
    }
    return out;
  }
  function draw(t) {
    const c = S.ctx, st = S.state;
    if (!c || !st) return;
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    c.clearRect(0, 0, G.w, G.h);
    // Behind the board: dusk above, dark earth below.
    const sky = c.createLinearGradient(0, 0, 0, G.h);
    sky.addColorStop(0, '#31465c'); sky.addColorStop(0.55, '#3a3a36'); sky.addColorStop(1, '#1d150d');
    c.fillStyle = sky; c.fillRect(0, 0, G.w, G.h);
    const m = st.map, tint = tints(), k = G.scale;
    const units = Object.values(S.view).filter(v => !v.gone), order = tilesByDepth();
    for (let d = 0, i = 0; d <= m.w + m.h - 2; d++) {
      const row = [];
      while (i < order.length && order[i].d === d) row.push(order[i++]);
      for (const q of row) {
        const tile = m.tiles[q.y * m.w + q.x];
        const p = drawTile(c, q.x, q.y, tile, tint[q.x + ',' + q.y] || [], t);
        const cur = S.cursor && S.cursor.x === q.x && S.cursor.y === q.y, pick = S.pick && S.pick.x === q.x && S.pick.y === q.y;
        if (cur || pick) { c.strokeStyle = pick ? '#ffffff' : 'rgba(255,255,255,0.75)'; c.lineWidth = pick ? 2.5 : 1.5; diamond(c, { x: p.x, y: p.y + 1 }, k * 0.94); c.stroke(); }
      }
      for (const q of row) { const tile = m.tiles[q.y * m.w + q.x]; if (tile.t === 'tree' || tile.t === 'rock') drawProp(c, q.x, q.y, tile); }
      for (const v of units) if (Math.ceil(depth(v.x, v.y) - 0.01) === d) drawUnit(c, v, t);
    }
    // Numbers that rise from a unit and fade.
    S.floats = S.floats.filter(f => t - f.t0 < 1000);
    for (const f of S.floats) {
      const age = (t - f.t0) / 1000, p = standXY(f.x, f.y);
      c.globalAlpha = Math.max(0, 1 - age * age);
      c.font = `bold ${Math.round((f.big ? 17 : 13) * Math.max(0.85, k))}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = 'rgba(20,12,6,0.9)';
      const y = p.y - (50 + (still() ? 12 : age * 26) + (f.row || 0) * 15) * k;
      c.strokeText(f.text, p.x, y); c.fillStyle = f.col; c.fillText(f.text, p.x, y);
      c.globalAlpha = 1;
    }
  }
  function loop() {
    if (!S.open) return;
    draw(now());
    S.raf = global.requestAnimationFrame(loop);
  }

  // ── Showing what the engine did ───────────────────────────────────────────
  const wait = ms => new Promise(r => global.setTimeout(r, still() ? Math.min(ms, 60) : ms));
  function tween(v, to, ms) {
    return new Promise(resolve => {
      if (still() || ms <= 0) { Object.assign(v, to); return resolve(); }
      const from = {}, t0 = now();
      for (const key of Object.keys(to)) from[key] = v[key] || 0;
      const step = () => {
        const q = Math.min(1, (now() - t0) / ms);
        for (const key of Object.keys(to)) v[key] = from[key] + (to[key] - from[key]) * q;
        if (q < 1 && S.open) global.requestAnimationFrame(step); else resolve();
      };
      step();
    });
  }
  function float(v, text, col, big) {
    const row = S.floats.filter(f => f.id === v.id && now() - f.t0 < 350).length;
    S.floats.push({ id: v.id, x: v.x, y: v.y, text, col, big: !!big, t0: now(), row });
  }
  function syncView() {
    for (const u of S.state.units) {
      const v = S.view[u.id] || (S.view[u.id] = { id: u.id, seed: Math.random() * 6 });
      Object.assign(v, { x: u.x, y: u.y, face: u.face, hp: u.hp, block: u.block, st: { ...u.st }, gone: u.down, alpha: u.down ? 0 : 1, walking: false, lx: 0, ly: 0 });
    }
  }
  function banner(text) {
    const b = S.el && S.el.querySelector('.kwtc-banner');
    if (!b) return;
    b.textContent = text; b.classList.add('is-on');
    global.clearTimeout(S.banner);
    S.banner = global.setTimeout(() => b.classList.remove('is-on'), 1100);
  }
  const say = text => { const h = S.el && S.el.querySelector('.kwtc-log'); if (h) h.textContent = text; };
  async function play(events) {
    const e = E(), name = id => (e.unit(S.state, id) || {}).name || '';
    for (const ev of events || []) {
      if (!S.open) return;
      const v = S.view[ev.id];
      if (ev.type === 'move') {
        v.walking = true;
        for (let i = 1; i < ev.path.length; i++) {
          v.face = e.DIR_KEYS.find(d => e.DIRS[d][0] === ev.path[i].x - ev.path[i - 1].x && e.DIRS[d][1] === ev.path[i].y - ev.path[i - 1].y) || v.face;
          await tween(v, { x: ev.path[i].x, y: ev.path[i].y }, 150);
        }
        v.walking = false; v.face = ev.face;
      } else if (ev.type === 'face') v.face = ev.face;
      else if (ev.type === 'use') {
        banner(`${name(ev.id)}: ${ev.icon || ''} ${ev.name}`); say(`${name(ev.id)} uses ${ev.name}.`);
        if (ev.x !== Math.round(v.x) || ev.y !== Math.round(v.y)) {
          const dx = Math.sign(ev.x - v.x) * 0.22, dy = Math.sign(ev.y - v.y) * 0.22;
          await tween(v, { lx: dx, ly: dy }, 90); await tween(v, { lx: 0, ly: 0 }, 110);
        } else await wait(160);
      } else if (ev.type === 'hit') {
        v.flash = now() + 240; v.hp = ev.hp;
        float(v, '−' + ev.dmg, '#ffd9d0', true);
        if (ev.side !== 'front') float(v, ev.side === 'back' ? 'From behind!' : 'Flanked', '#ffd27a');
        if (ev.blocked) float(v, 'blocked ' + ev.blocked, '#9fd0ff');
        v.block = Math.max(0, (v.block || 0) - ev.blocked);
        say(`${name(ev.id)} takes ${ev.dmg}${ev.side === 'back' ? ', struck from behind' : ev.side === 'side' ? ', flanked' : ''}.`);
        await wait(360);
      } else if (ev.type === 'block') { v.block = ev.block; float(v, '🛡 +' + ev.amount, '#9fd0ff'); await wait(220); }
      else if (ev.type === 'heal') { v.hp = ev.hp; float(v, '+' + ev.amount, '#a8e890', true); await wait(260); }
      else if (ev.type === 'status') { v.st[ev.name] = ev.now; float(v, (STATUS[ev.name] || [ev.name])[0] + ' ' + ev.amount, '#fff3d6'); await wait(180); }
      else if (ev.type === 'push') { await tween(v, { x: ev.to.x, y: ev.to.y }, 140); }
      else if (ev.type === 'poison') { v.hp = ev.hp; float(v, '☠ −' + ev.amount, '#c8e070', true); await wait(300); }
      else if (ev.type === 'skip') { float(v, 'Stunned', '#fff3d6'); say(`${name(ev.id)} is stunned and loses the turn.`); await wait(420); }
      else if (ev.type === 'down') { say(`${name(ev.id)} is down.`); await tween(v, { alpha: 0 }, 380); v.gone = true; }
      else if (ev.type === 'round') { S.round = ev.n; paintTop(); }
      else if (ev.type === 'turn') { paintTop(); await wait(90); }
    }
    syncView();
  }

  // ── The screen around the board ───────────────────────────────────────────
  const land = l => (l ? l[0].toUpperCase() + l.slice(1) : '');
  function shell() {
    const s = S.setup;
    return `<header class="kwtc-top">`
      + `<div class="kwtc-title"><b>⚔ ${esc(s.name || 'A battle')}</b><span>${esc(s.skull || '')} ${esc(land(s.land))} · seed ${esc(s.seed)} · prototype</span></div>`
      + `<div class="kwtc-order" aria-label="Who acts next"></div>`
      + `<button type="button" class="kw-btn quiet kwtc-x" data-kwt="close" aria-label="Leave the battle">✕</button></header>`
      + `<div class="kwtc-board"><canvas class="kwtc-canvas" tabindex="0" aria-label="The battlefield. Arrow keys move the cursor, Enter chooses, Escape cancels."></canvas>`
      + `<div class="kwtc-banner" aria-hidden="true"></div>`
      + `<div class="kwtc-turnview"><button type="button" class="kw-btn" data-kwt="rot-l" aria-label="Turn the view left" title="Turn the view (Q)">⟲</button><button type="button" class="kw-btn" data-kwt="rot-r" aria-label="Turn the view right" title="Turn the view (R)">⟳</button></div>`
      + `<div class="kwtc-end" hidden></div></div>`
      + `<footer class="kwtc-panel"><div class="kwtc-who"></div><div class="kwtc-acts"></div><div class="kwtc-hint"></div><div class="kwtc-log kw-sr" role="status" aria-live="polite"></div></footer>`;
  }
  function paintTop() {
    const e = E(), st = S.state, box = S.el && S.el.querySelector('.kwtc-order');
    if (!box || !st) return;
    const ids = st.order.slice(st.index).concat(e.computeOrder(st)).filter((id, i, all) => { const u = e.unit(st, id); return u && !u.down; }).slice(0, 9);
    box.innerHTML = `<span class="kwtc-round">Round ${st.round}</span>` + ids.map((id, i) => {
      const u = e.unit(st, id);
      return `<span class="kwtc-chip is-${u.side}${i === 0 ? ' is-now' : ''}" title="${esc(u.name)}">${esc(u.icon || '•')}</span>`;
    }).join('');
  }
  const reachText = a => (a.shape === 'around' ? `all within ${a.radius}` : a.target === 'self' || !a.max ? 'self' : a.min === a.max ? `reach ${a.max}` : `reach ${Math.max(1, a.min)}–${a.max}`);
  function effectText(a) {
    const bits = [];
    if (a.dmg) bits.push(a.dmg + ' damage');
    if (a.block) bits.push(a.block + ' block');
    if (a.heal) bits.push('heal ' + a.heal);
    for (const k of Object.keys(a.fx || {})) {
      if (k === 'push') bits.push('pushes back'); else if (k === 'step') bits.push('steps back'); else if (k === 'bold') bits.push('next attack +' + a.fx[k]);
      else bits.push((STATUS[k] || [k])[0].toLowerCase() + ' ' + a.fx[k]);
    }
    if (a.shape === 'line') bits.push('down the line'); if (a.shape === 'burst') bits.push('and those beside');
    return bits.join(', ');
  }
  function unitCard(u, v) {
    const ails = Object.keys(STATUS).filter(s => (u.st[s] || 0) > 0).map(s => `<span class="kwtc-ail">${esc(STATUS[s][0])} ${u.st[s]}</span>`).join('');
    return `<div class="kwtc-card is-${u.side}"><div class="kwtc-card-name"><span class="kwtc-dot" style="--kwtc-class:${CLASS_COLOUR[u.cls] || CLASS_COLOUR.creature}"></span><b>${esc(u.name)}</b> <span>${esc(u.label || (u.side === 'enemy' ? 'Creature' : ''))}</span></div>`
      + `<div class="kwtc-bar" role="img" aria-label="Health ${u.hp} of ${u.maxHp}"><i style="width:${Math.round(100 * u.hp / u.maxHp)}%"></i><em>${u.hp} / ${u.maxHp}</em></div>`
      + `<div class="kwtc-card-facts">Move ${E().moveOf(u)} · Jump ${u.jump || 1}${u.armour ? ' · Armour ' + u.armour : ''}${u.block ? ` · <b>🛡 ${u.block}</b>` : ''} ${ails}</div></div>`;
  }
  function forecastHtml(u, a, tile) {
    const lines = E().forecast(S.state, u, a, tile.x, tile.y);
    if (!lines.length) return '';
    return `<div class="kwtc-fore">` + lines.map(l => {
      const bits = [];
      if (a.dmg) bits.push(`<b>${l.dmg} damage</b>${l.side === 'back' ? ' from behind (+50%)' : l.side === 'side' ? ' on the flank (+25%)' : ''}${l.high ? ', from above (+15%)' : ''}${l.blocked ? `, ${l.blocked} blocked` : ''}${l.kill ? ' — <b>down</b>' : ''}`);
      if (l.block) bits.push(`<b>${l.block} block</b>`);
      if (l.heal != null) bits.push(`<b>heals ${l.heal}</b>`);
      for (const k of Object.keys(l.fx)) bits.push(k === 'push' ? 'pushed back' : k === 'bold' ? `next attack +${l.fx[k]}` : `${(STATUS[k] || [k])[0].toLowerCase()} ${l.fx[k]}`);
      return `<div>${esc(l.name)}: ${bits.join(', ')}</div>`;
    }).join('') + `</div>`;
  }
  function paintPanel() {
    if (!S.el || !S.state) return;
    const e = E(), st = S.state, u = e.current(st), who = S.el.querySelector('.kwtc-who'), acts = S.el.querySelector('.kwtc-acts'), hint = S.el.querySelector('.kwtc-hint');
    if (!u) { who.innerHTML = ''; acts.innerHTML = ''; hint.textContent = ''; return; }
    const look = S.info && !S.info.down ? S.info : u;
    who.innerHTML = unitCard(look, S.view[look.id]);
    if (S.info && S.info !== u) {
      acts.innerHTML = `<div class="kwtc-kit">${(look.abilities || []).map(a => `<span class="kwtc-kit-a">${esc(a.icon)} <b>${esc(a.name)}</b> ${esc(effectText(a))} <i>${esc(reachText(a))}</i></span>`).join('')}</div>`
        + `<button type="button" class="kw-btn quiet" data-kwt="back">Back</button>`;
      hint.textContent = look.side === 'enemy' ? 'The red tiles are where it can walk this turn.' : '';
      return;
    }
    if (u.side !== 'player' || S.busy) { acts.innerHTML = ''; hint.textContent = u.side === 'player' ? '' : `${u.name} is taking a turn…`; return; }
    const a = S.mode === 'target' ? e.ability(u, S.ability) : null;
    acts.innerHTML = (u.abilities || []).map((x, i) => {
      const can = e.canUse(st, u, x), none = can.ok && !e.targetTiles(st, u, x).length;
      const why = !can.ok ? (can.why === 'cooldown' ? `ready in ${can.turns}` : can.why === 'spent' ? 'used up' : 'done') : none ? 'no one in reach' : '';
      return `<button type="button" class="kwtc-act${a === x ? ' is-on' : ''}${x.quick ? ' is-quick' : ''}" data-kwt="ability" data-key="${esc(x.key)}"${can.ok ? '' : ' disabled'} aria-pressed="${a === x}" title="${esc(x.desc || '')}">`
        + `<span class="kwtc-act-i" aria-hidden="true">${esc(x.icon)}</span><span class="kwtc-act-n">${esc(x.name)}</span>`
        + `<span class="kwtc-act-t">${esc(why || effectText(x))}</span><span class="kwtc-act-r">${esc(reachText(x))}${x.quick ? ' · quick' : ''}${x.uses != null ? ` · ${x.uses - (u.used[x.key] || 0)} left` : ''}</span><kbd aria-hidden="true">${i + 1}</kbd></button>`;
    }).join('')
      + `<div class="kwtc-turn">${st.turn.moved && !st.turn.acted && !st.turn.quick ? `<button type="button" class="kw-btn quiet" data-kwt="undo">↶ Undo move</button>` : ''}`
      + `<button type="button" class="kw-btn" data-kwt="end">End turn</button></div>`;
    let text = '';
    if (a) {
      const tile = S.pick || (S.pointer === 'mouse' ? S.hover : null), fore = tile ? forecastHtml(u, a, tile) : '';
      if (fore && S.pick) text = fore + `<div class="kwtc-confirm"><button type="button" class="kw-btn primary" data-kwt="confirm">Confirm</button><button type="button" class="kw-btn quiet" data-kwt="cancel">Cancel</button></div>`;
      else text = (fore || `<div><b>${esc(a.name)}</b>: ${esc(a.desc || effectText(a))} Choose a marked target.</div>`) + `<div class="kwtc-confirm"><button type="button" class="kw-btn quiet" data-kwt="cancel">Cancel</button></div>`;
    } else if (S.pick) text = `<div>Walk here?</div><div class="kwtc-confirm"><button type="button" class="kw-btn primary" data-kwt="confirm">Move here</button><button type="button" class="kw-btn quiet" data-kwt="cancel">Cancel</button></div>`;
    else text = `<div>${esc(u.name)}'s turn. ${st.turn.moved ? '' : 'Blue tiles: where to walk. '}${st.turn.acted ? 'The action is used.' : 'Choose an action below.'}</div>`;
    hint.innerHTML = text;
  }
  function paint() { paintTop(); paintPanel(); }

  // ── Taking a turn ─────────────────────────────────────────────────────────
  async function afterAction() {
    const e = E(), st = S.state;
    if (st.status !== 'active') return finish();
    const u = e.current(st);
    if (u && u.side === 'player' && st.turn.moved && st.turn.acted) return endTurn();
    paint();
  }
  async function endTurn() {
    if (S.busy || !E().current(S.state)) return;
    S.busy = true; S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null;
    paintPanel();
    await play(E().endTurn(S.state));
    S.busy = false;
    await nextTurn();
  }
  // Creatures take their turns by themselves until it is a citizen's.
  async function nextTurn() {
    const e = E(), st = S.state;
    for (let guard = 0; guard < 60 && S.open; guard++) {
      if (st.status !== 'active') return finish();
      const u = e.current(st);
      if (u.side === 'player') { S.cursor = { x: u.x, y: u.y }; S.mode = 'idle'; paint(); say(`${u.name}'s turn.`); return; }
      S.busy = true; paint();
      await wait(260);
      await play(e.aiTurn(st));
      S.busy = false;
    }
  }
  async function doMove(x, y) {
    const ev = E().move(S.state, x, y);
    if (!ev) return;
    S.busy = true; S.pick = null; paintPanel();
    await play(ev);
    S.busy = false; S.cursor = { x, y };
    await afterAction();
  }
  async function doUse(x, y) {
    const key = S.ability, ev = E().use(S.state, key, x, y);
    if (!ev) return;
    S.busy = true; S.pick = null; S.mode = 'idle'; S.ability = null; paintPanel();
    await play(ev);
    S.busy = false;
    await afterAction();
  }
  function choose(key) {
    const e = E(), st = S.state, u = e.current(st);
    if (S.busy || !u || u.side !== 'player') return;
    const a = e.ability(u, key);
    if (!a || !e.canUse(st, u, a).ok) return;
    if (S.mode === 'target' && S.ability === key && S.pick) return void doUse(S.pick.x, S.pick.y);
    S.mode = 'target'; S.ability = key; S.info = null;
    // An ability with only one place to go is aimed already: Confirm does it.
    S.pick = (a.target === 'self' || a.shape === 'around') ? { x: u.x, y: u.y } : null;
    paint();
  }
  function cancel() { S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; paint(); }
  function commit() {
    if (S.busy || !S.pick) return;
    if (S.mode === 'target') return void doUse(S.pick.x, S.pick.y);
    return void doMove(S.pick.x, S.pick.y);
  }
  function tapTile(x, y, viaMouse) {
    const e = E(), st = S.state, u = e.current(st);
    if (S.busy || !u || st.status !== 'active') return;
    S.cursor = { x, y };
    const same = S.pick && S.pick.x === x && S.pick.y === y;
    if (u.side !== 'player') return;
    if (S.mode === 'target') {
      const a = e.ability(u, S.ability);
      if (e.touched(st, u, a, x, y).length && e.targetTiles(st, u, a).some(p => p.x === x && p.y === y)) {
        if (same || viaMouse) return void doUse(x, y);
        S.pick = { x, y };
      } else S.pick = null;
      return paint();
    }
    const there = e.unitAt(st, x, y);
    if (there && there !== u) { S.info = S.info === there ? null : there; S.pick = null; return paint(); }
    S.info = null;
    const node = st.turn.moved ? null : e.reach(st, u).get(x + ',' + y);
    if (node && node.stop && node.cost) {
      if (same || viaMouse) return void doMove(x, y);
      S.pick = { x, y };
    } else S.pick = null;
    paint();
  }

  function finish() {
    const st = S.state, box = S.el && S.el.querySelector('.kwtc-end');
    if (!box || S.ended) return;
    S.ended = now(); S.busy = false;
    const secs = Math.round((S.ended - S.started) / 1000), won = st.status === 'victory';
    const left = st.units.filter(u => u.side === 'player' && !u.down);
    box.innerHTML = `<div class="kw-box kwtc-end-box"><div class="kw-box-title">${won ? '🏆 The field is yours' : '💀 The party is down'}</div>`
      + `<p>${st.round} round${st.round === 1 ? '' : 's'} · ${st.stats.turns} of your turns · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</p>`
      + `<p>${won ? `${left.length} of 4 still standing${left.length ? ': ' + left.map(u => `${esc(u.name)} ${u.hp}/${u.maxHp}`).join(', ') : ''}.` : 'Nothing is lost: this is a practice field.'}</p>`
      + `<div class="kwtc-confirm"><button type="button" class="kw-btn primary" data-kwt="again">Same battle again</button><button type="button" class="kw-btn" data-kwt="new">A new field</button><button type="button" class="kw-btn quiet" data-kwt="close">Leave</button></div></div>`;
    box.hidden = false;
    paint();
    const b = box.querySelector('button'); if (b) b.focus();
  }

  // ── Opening and closing ───────────────────────────────────────────────────
  function begin(setup) {
    const e = E();
    S.setup = setup; S.view = {}; S.floats = []; S.rot = 0; S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; S.hover = null; S.busy = false; S.ended = 0; S.round = 1;
    S.state = e.createBattle({ seed: setup.seed, land: setup.land, party: setup.party, enemies: setup.enemies });
    syncView();
    S.started = now();
  }
  function open(setup) {
    if (!E()) return toast('⚠️ The battle engine did not load.');
    close(true);
    begin(setup);
    const el = doc.createElement('div');
    el.id = 'kw-tactics'; el.className = 'kwtc'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Tactics battle');
    el.innerHTML = shell();
    doc.body.appendChild(el);
    S.el = el; S.canvas = el.querySelector('canvas'); S.ctx = S.canvas.getContext('2d'); S.open = true;
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-kwt]');
      if (!b || b.disabled) return;
      const k = b.getAttribute('data-kwt');
      if (k === 'close') close();
      else if (k === 'ability') choose(b.getAttribute('data-key'));
      else if (k === 'end') endTurn();
      else if (k === 'undo') { if (E().undoMove(S.state)) { syncView(); S.pick = null; paint(); } }
      else if (k === 'confirm') commit();
      else if (k === 'cancel' || k === 'back') cancel();
      else if (k === 'rot-l') rotate(-1);
      else if (k === 'rot-r') rotate(1);
      else if (k === 'again') restart(false);
      else if (k === 'new') restart(true);
    });
    const at = ev => { const r = S.canvas.getBoundingClientRect(); return tileAtPoint(ev.clientX - r.left, ev.clientY - r.top); };
    S.canvas.addEventListener('pointermove', ev => {
      S.pointer = ev.pointerType === 'mouse' ? 'mouse' : 'touch';
      if (S.pointer !== 'mouse') return;
      const t = at(ev), was = S.hover;
      S.hover = t;
      if ((t && t.x) !== (was && was.x) || (t && t.y) !== (was && was.y)) paintPanel();
    });
    S.canvas.addEventListener('pointerleave', () => { S.hover = null; });
    S.canvas.addEventListener('pointerup', ev => {
      S.pointer = ev.pointerType === 'mouse' ? 'mouse' : 'touch';
      const t = at(ev);
      if (t) tapTile(t.x, t.y, S.pointer === 'mouse');
    });
    el.addEventListener('keydown', onKey);
    // The board is laid out again whenever its box changes size (the window, or the panel below growing).
    S.onResize = () => { layout(); };
    global.addEventListener('resize', S.onResize);
    if (global.ResizeObserver) { S.watch = new global.ResizeObserver(() => layout()); S.watch.observe(S.canvas.parentNode); }
    layout(); paint();
    if (global.KWVillagers && global.KWVillagers.load) global.KWVillagers.load();
    loop();
    S.canvas.focus();
    nextTurn();
  }
  function rotate(by) { S.rot = (S.rot + by + 4) & 3; S.hover = null; layout(); say('The view is turned.'); }
  function onKey(ev) {
    const e = E(), st = S.state;
    if (!st) return;
    if (ev.key === 'Escape') { ev.preventDefault(); if (S.mode === 'target' || S.pick || S.info) cancel(); else close(); return; }
    if (ev.target && ev.target.closest && ev.target.closest('button') && (ev.key === 'Enter' || ev.key === ' ')) return;
    if (ev.key === 'q' || ev.key === 'Q') { ev.preventDefault(); return rotate(-1); }
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); return rotate(1); }
    // The arrows follow the board as it is turned: up is away from the viewer, to the right.
    const arrow = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[ev.key];
    const move = arrow ? turn(arrow[0], arrow[1], true) : null;
    if (move) {
      ev.preventDefault();
      const c = S.cursor || { x: 0, y: 0 };
      S.cursor = { x: Math.max(0, Math.min(st.map.w - 1, c.x + move[0])), y: Math.max(0, Math.min(st.map.h - 1, c.y + move[1])) };
      S.hover = S.cursor; S.pointer = 'mouse'; paintPanel();
      return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && S.cursor) { ev.preventDefault(); return tapTile(S.cursor.x, S.cursor.y, true); }
    const u = e.current(st);
    if (/^[1-9]$/.test(ev.key) && u && u.side === 'player') { const a = (u.abilities || [])[Number(ev.key) - 1]; if (a) { ev.preventDefault(); choose(a.key); } }
    if ((ev.key === 'e' || ev.key === 'E') && u && u.side === 'player') { ev.preventDefault(); endTurn(); }
  }
  function close(quiet) {
    if (!S.open && !S.el) return;
    S.open = false;
    global.cancelAnimationFrame(S.raf);
    if (S.onResize) global.removeEventListener('resize', S.onResize);
    if (S.watch) { S.watch.disconnect(); S.watch = null; }
    if (S.el && S.el.parentNode) S.el.parentNode.removeChild(S.el);
    S.el = null; S.canvas = null; S.ctx = null; S.state = quiet ? S.state : null;
  }
  async function fetchSetup(opts) {
    const res = await global.apiFetch('/api/tactics/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts || {}) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.error || 'The battle could not be set up.');
    return d;
  }
  // Start a battle: { classes, level, tier, terrain, seed, fight }.
  async function start(opts) {
    const setup = await fetchSetup(opts);
    S.opts = opts || {};
    open(setup);
    return setup;
  }
  async function restart(fresh) {
    try {
      if (fresh) return void await start({ ...(S.opts || {}), seed: undefined });
      open(S.setup);
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  // ── Dev Tools → 💀 Dungeons → the tactics prototype ───────────────────────
  const DEV = { options: null, pick: null };
  const SLOTS = ['Front, left', 'Front, right', 'Back, left', 'Back, right'];
  function loadPick() {
    if (DEV.pick) return DEV.pick;
    let saved = null;
    try { saved = JSON.parse(global.localStorage.getItem('kwt_dev_pick') || 'null'); } catch (e) { /* private window */ }
    DEV.pick = Object.assign({ classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'skull', tier: 'green', terrain: 'forest', fight: 'first', seed: '' }, saved || {});
    return DEV.pick;
  }
  function devHtml(o, p) {
    if (!o) return `<div class="cheat-section-label" style="margin-top:10px">Tactics battle (prototype)</div><div class="cheat-desc">Loading…</div>`;
    const sel = (id, list, val, label) => `<label>${esc(label)} <select class="ce-input" data-kwt-dev="${id}">${list.map(x => `<option value="${esc(x.key)}"${x.key === val ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>`;
    return `<div class="cheat-section-label" style="margin-top:10px">Tactics battle (prototype)</div>`
      + `<div class="cheat-desc">A battle on a small board: walk, face, strike from behind or from above. It uses four of your grown-up citizens with the classes chosen here, costs nothing and changes nothing.</div>`
      + `<div class="kwdg-dev-row">${SLOTS.map((s, i) => sel('class' + i, o.classes.map(c => ({ key: c.key, label: `${c.icon} ${c.label}` })), p.classes[i], s)).join('')}</div>`
      + `<div class="kwdg-dev-row">${sel('level', o.levels, p.level, 'Their level')}${sel('tier', o.tiers.map(t => ({ key: t.key, label: `${t.skull} ${t.name}` })), p.tier, 'Skull')}`
      + `${sel('terrain', o.lands.map(l => ({ key: l, label: land(l) })), p.terrain, 'Land')}${sel('fight', o.fights, p.fight, 'Against')}`
      + `<label>Seed <input class="ce-input" type="number" min="1" inputmode="numeric" placeholder="any" data-kwt-dev="seed" value="${esc(p.seed || '')}"></label></div>`
      + `<button type="button" class="cheat-all-btn" data-kwt-dev="start">⚔ Start a tactics battle</button>`
      + `<div class="cheat-rel-feedback" data-kwt-dev="msg" role="status"></div>`;
  }
  // Fill the box Dev Tools gives us, and keep what was chosen.
  async function devMount(box) {
    if (!box) return;
    const p = loadPick();
    box.innerHTML = devHtml(DEV.options, p);
    if (!box._kwt) {
      box._kwt = true;
      const keep = ev => {
        const k = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-kwt-dev');
        if (!k || k === 'start') return;
        if (/^class\d$/.test(k)) p.classes[Number(k.slice(5))] = ev.target.value; else p[k] = ev.target.value;
        try { global.localStorage.setItem('kwt_dev_pick', JSON.stringify(p)); } catch (e) { /* private window */ }
      };
      box.addEventListener('change', keep); box.addEventListener('input', keep);
      box.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-kwt-dev="start"]');
        if (!b) return;
        const msg = box.querySelector('[data-kwt-dev="msg"]');
        try {
          const seed = parseInt(p.seed, 10);
          await start({ classes: p.classes, level: p.level, tier: p.tier, terrain: p.terrain, fight: p.fight, seed: seed > 0 ? seed : undefined });
          if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
        } catch (e) { if (msg) msg.textContent = '⚠️ ' + e.message; }
      });
    }
    if (!DEV.options) {
      try {
        const res = await global.apiFetch('/api/tactics/admin/options');
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.ok) { DEV.options = d; box.innerHTML = devHtml(d, p); }
        else box.innerHTML = `<div class="cheat-desc">⚠️ ${esc(d.error || 'The tactics prototype could not be loaded.')}</div>`;
      } catch (e) { box.innerHTML = `<div class="cheat-desc">⚠️ ${esc(e.message)}</div>`; }
    }
  }

  global.KWTactics = {
    start, open, close, devMount,
    // For the proofs and the browser checks.
    _state: S, _geom: G, _tapTile: tapTile, _choose: choose, _confirm: commit, _endTurn: endTurn, _tileXY: tileXY, _standXY: standXY, _tileAtPoint: tileAtPoint, _rotate: rotate, _view: view,
    _devHtml: devHtml, _effectText: effectText, _reachText: reachText, _layout: layout, _begin: begin, _forecastHtml: forecastHtml, CLASS_COLOUR,
  };
})(typeof window !== 'undefined' ? window : globalThis);
