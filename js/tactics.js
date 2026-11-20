// ══════════════════════════════════════════════════════════════════════════
//  tactics — the tactics battle's screen (docs/TACTICS.md).
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
//  Started from Dev Tools → 💀 Dungeons (devMount). The server keeps the
//  battle (/api/tactics/battles): every choice is played here at once and
//  sent there in order, where the same rules check it. A battle left
//  part-played is picked up where it was.
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

  // mode: 'idle' (choose where to walk or what to do), 'target' (an ability is chosen) or
  // 'face' (the turn is ending: which way to look; faceAim is the way shown).
  // pick: the tile tapped once and waiting for a second tap. info: a unit being looked at.
  const S = { open: false, setup: null, opts: null, state: null, view: {}, floats: [], mode: 'idle', ability: null, pick: null, hover: null, cursor: null,
    info: null, busy: false, pointer: 'mouse', rot: 0, faceAim: null, started: 0, ended: 0, raf: 0, banner: null, el: null, canvas: null, ctx: null, round: 1 };
  // scale = base (the whole board fits) × zoom (1 to ZOOM_MAX); px, py: how far the board has been dragged.
  const G = { tw: 64, th: 32, lift: 16, scale: 1, base: 1, zoom: 1, px: 0, py: 0, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
  const ZOOM_MAX = 3.2;

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
    G.base = Math.max(0.3, Math.min(2.4, Math.min((cw - 8) / bw, (ch - 8) / bh)));
    G.scale = G.base * G.zoom;
    G.dpr = Math.min(2, global.devicePixelRatio || 1);
    G.w = cw; G.h = ch;
    const pw = Math.round(cw * G.dpr), ph = Math.round(ch * G.dpr);
    if (S.canvas.width !== pw || S.canvas.height !== ph) { S.canvas.width = pw; S.canvas.height = ph; S.canvas.style.width = cw + 'px'; S.canvas.style.height = ch + 'px'; }
    // Dragging: the board may slide until its middle is a quarter of the box from an edge, and no further.
    const lx = Math.max(0, (bw * G.scale - cw) / 2 + cw * 0.25), ly = Math.max(0, (bh * G.scale - ch) / 2 + ch * 0.25);
    if (G.zoom <= 1.001) { G.px = 0; G.py = 0; }
    G.px = Math.max(-lx, Math.min(lx, G.px)); G.py = Math.max(-ly, Math.min(ly, G.py));
    G.ox = (cw - bw * G.scale) / 2 + ((S.rot & 1) ? m.w : m.h) * G.tw / 2 * G.scale + G.px;
    G.oy = (ch - bh * G.scale) / 2 + (head + peak * G.lift) * G.scale + G.py;
  }
  // Zoom to z, keeping the point of the board under (sx, sy) where it is.
  function zoomAt(z, sx, sy) {
    const z0 = G.zoom, z1 = Math.max(1, Math.min(ZOOM_MAX, z));
    if (Math.abs(z1 - z0) < 1e-4) return;
    const cx = G.w / 2 + G.px, cy = G.h / 2 + G.py;
    G.px = sx - (sx - cx) * z1 / z0 - G.w / 2; G.py = sy - (sy - cy) * z1 / z0 - G.h / 2;
    G.zoom = z1;
    layout();
  }
  const zoomBy = f => zoomAt(G.zoom * f, G.w / 2, G.h / 2);
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

  // ── What art and sound there is (assets/tactics/manifest.json) ───────────
  // Written by scripts/pack_tactics.js from the files in assets/sprites/
  // creatures and assets/audio/tactics. Whatever is missing has a stand-in:
  // a creature's icon, an older sound, the card battles' music.
  const ASSETS = { loaded: false, creatures: {}, sounds: {}, music: [] };
  function loadAssets() {
    if (ASSETS.loaded || typeof global.fetch !== 'function') return Promise.resolve(ASSETS);
    ASSETS.loaded = true;
    return global.fetch('/assets/tactics/manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => {
      if (j) { ASSETS.creatures = j.creatures || {}; ASSETS.sounds = j.sounds || {}; ASSETS.music = j.music || []; }
      return ASSETS;
    });
  }
  // name → a sound that exists today, used until assets/audio/tactics/<name>.mp3 is there.
  const STAND_IN = { start: 'tension.wav', select: 'card_click.wav', confirm: 'next.wav', melee: 'stab.wav', arrow: 'stab.wav', magic: 'stab.wav', bite: 'stab.wav',
    down_foe: 'splat.wav', down_friend: 'fail.wav', victory: 'success.mp3', defeat: 'fail.wav' };
  function sfx(name) {
    if (typeof global.playSfx !== 'function') return;
    const own = ASSETS.sounds[name], file = own ? 'tactics/' + own : STAND_IN[name];
    if (file) global.playSfx(file);
  }
  function music(on) {
    try {
      if (!on) { if (typeof global.stopMusic === 'function') global.stopMusic(); return; }
      // Its own tracks when there are any, else the card battles'. A file whose name starts "boss" is kept for boss fights.
      const boss = !!(S.setup && S.setup.fight === 'boss'), all = ASSETS.music, forBoss = all.filter(f => /^boss/i.test(f)), rest = all.filter(f => !/^boss/i.test(f));
      const list = boss && forBoss.length ? forBoss : (rest.length ? rest : all);
      if (list.length && typeof global.registerMusic === 'function') global.registerMusic('TACTICS', list.map(f => '/assets/audio/tactics/music/' + f));
      if (typeof global.playMusic === 'function') global.playMusic(list.length && typeof global.registerMusic === 'function' ? 'TACTICS' : 'BATTLE');
    } catch (e) { /* no sound is fine */ }
  }
  // The sound of an ability landing, from who uses it and what it is.
  function soundOf(u, ev) {
    if (ev.kind === 'block') return 'block';
    if (ev.kind === 'heal') return 'heal';
    if (ev.kind === 'buff') return 'buff';
    if (ev.kind === 'debuff') return 'debuff';
    if (u.side === 'enemy') return 'bite';
    return u.cls === 'archer' ? 'arrow' : (u.cls === 'wizard' || u.cls === 'hearthkeeper') ? 'magic' : 'melee';
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

  // A creature's picture, if it has one: the front view when it looks towards
  // the viewer, the back view when it looks away; mirrored for the other two ways.
  function creatureArt(u, v) {
    const a = ASSETS.creatures[u.key];
    if (!a || !a.front) return null;
    const f = E().DIRS[v.face] || [0, 1], tv = turn(f[0], f[1]), away = tv[0] < 0 || tv[1] < 0;
    const img = sheet('/assets/sprites/creatures/' + (away && a.back ? a.back : a.front));
    // The front view is drawn looking down and to the left; the back view up and to the right.
    return img ? { img, flip: away ? tv[0] < 0 : tv[0] > 0, w: a.w || img.naturalWidth, h: a.h || img.naturalHeight, foot: a.foot || 0.9 } : null;
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
    c.moveTo(p.x + fx + ux * 12 * k, p.y + fy + uy * 12 * k);
    c.lineTo(p.x + fx - ux * 1 * k - uy * 4 * k, p.y + fy - uy * 1 * k + ux * 4 * k);
    c.lineTo(p.x + fx - ux * 1 * k + uy * 4 * k, p.y + fy - uy * 1 * k - ux * 4 * k);
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
      const bob = still() ? 0 : Math.sin(t / 380 + v.seed) * 1.5 * k, art = creatureArt(u, v);
      if (art) {
        const z = 0.62 * k, dw = art.w * z, dh = art.h * z;      // the same pixel size as the villagers, so a big creature is big
        c.imageSmoothingEnabled = false;
        c.save(); c.translate(p.x, p.y + bob * 0.5); if (art.flip) c.scale(-1, 1);
        c.drawImage(art.img, -dw / 2, -dh * art.foot, dw, dh);
        c.restore();
      } else {
        c.font = `${Math.round(28 * k)}px serif`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
        c.fillText(u.icon || '👹', p.x, p.y + 2 * k + bob);
      }
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
  // Choosing a facing: four arrows round the unit, the chosen one gold.
  function faceSpots() {
    const e = E(), u = e.current(S.state);
    if (!u) return [];
    const h = e.heightOf(S.state, u.x, u.y), k = G.scale;
    return e.DIR_KEYS.map(d => {
      const p = tileXY(u.x + e.DIRS[d][0] * 0.95, u.y + e.DIRS[d][1] * 0.95, h);
      return { dir: d, x: p.x, y: p.y + G.th / 2 * k };
    });
  }
  function faceAt(px, py) {
    let best = null;
    for (const f of faceSpots()) { const d = Math.hypot(px - f.x, py - f.y); if (d <= 24 * G.scale && (!best || d < best.d)) best = { d, dir: f.dir }; }
    return best ? best.dir : null;
  }
  function drawFaceArrows(c) {
    const e = E(), u = e.current(S.state), k = G.scale;
    if (!u) return;
    const me = standXY(u.x, u.y);
    for (const f of faceSpots()) {
      const on = f.dir === S.faceAim, dx = f.x - me.x, dy = f.y - me.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      c.fillStyle = on ? '#ffd27a' : 'rgba(30,20,10,0.72)'; c.strokeStyle = on ? '#2a1d0c' : '#ffd27a'; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(f.x, f.y, 15 * k, 9 * k, 0, 0, 6.3); c.fill(); c.stroke();
      // A chevron pointing away from the unit: long and narrow, so its direction cannot be mistaken.
      c.strokeStyle = on ? '#2a1d0c' : '#ffd27a'; c.lineWidth = Math.max(2, 2.6 * k); c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
      c.moveTo(f.x - ux * 3 * k - uy * 5 * k, f.y - uy * 3 * k + ux * 5 * k); c.lineTo(f.x + ux * 7 * k, f.y + uy * 7 * k); c.lineTo(f.x - ux * 3 * k + uy * 5 * k, f.y - uy * 3 * k - ux * 5 * k);
      c.moveTo(f.x - ux * 8 * k, f.y - uy * 8 * k); c.lineTo(f.x + ux * 7 * k, f.y + uy * 7 * k);
      c.stroke(); c.lineCap = 'butt'; c.lineJoin = 'miter';
    }
  }
  // What each tile is tinted with just now.
  function tints() {
    const out = {}, add = (x, y, col) => { (out[x + ',' + y] = out[x + ',' + y] || []).push(col); };
    const e = E(), st = S.state, u = e.current(st);
    if (S.info && S.info.side === 'enemy' && !S.info.down) for (const n of e.reach(st, S.info).values()) add(n.x, n.y, TINT.danger);
    if (!u || u.side !== 'player' || S.busy || S.mode === 'face') return out;
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
    if (S.mode === 'face' && !S.busy) drawFaceArrows(c);
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
    const e = E(), name = id => (e.unit(S.state, id) || {}).name || '', epoch = S.epoch;
    for (const ev of events || []) {
      if (!S.open || S.epoch !== epoch) return;
      const v = S.view[ev.id];
      if (ev.type === 'move') {
        v.walking = true; sfx('step');
        for (let i = 1; i < ev.path.length; i++) {
          v.face = e.DIR_KEYS.find(d => e.DIRS[d][0] === ev.path[i].x - ev.path[i - 1].x && e.DIRS[d][1] === ev.path[i].y - ev.path[i - 1].y) || v.face;
          await tween(v, { x: ev.path[i].x, y: ev.path[i].y }, 150);
        }
        v.walking = false; v.face = ev.face;
      } else if (ev.type === 'face') v.face = ev.face;
      else if (ev.type === 'use') {
        banner(`${name(ev.id)}: ${ev.icon || ''} ${ev.name}`); say(`${name(ev.id)} uses ${ev.name}.`);
        sfx(soundOf(e.unit(S.state, ev.id), ev));
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
      else if (ev.type === 'push') { if (!ev.step) sfx('push'); await tween(v, { x: ev.to.x, y: ev.to.y }, 140); }
      else if (ev.type === 'poison') { v.hp = ev.hp; float(v, '☠ −' + ev.amount, '#c8e070', true); await wait(300); }
      else if (ev.type === 'skip') { float(v, 'Stunned', '#fff3d6'); say(`${name(ev.id)} is stunned and loses the turn.`); await wait(420); }
      else if (ev.type === 'down') { say(`${name(ev.id)} is down.`); sfx(e.unit(S.state, ev.id).side === 'enemy' ? 'down_foe' : 'down_friend'); await tween(v, { alpha: 0 }, 380); v.gone = true; }
      else if (ev.type === 'round') { S.round = ev.n; paintTop(); }
      else if (ev.type === 'turn') { paintTop(); await wait(90); }
    }
    if (S.epoch !== epoch) return;
    syncView();
  }

  // ── The screen around the board ───────────────────────────────────────────
  const land = l => (l ? l[0].toUpperCase() + l.slice(1) : '');
  function shell() {
    const s = S.setup;
    return `<header class="kwtc-top">`
      + `<div class="kwtc-title"><b>⚔ ${esc(s.name || 'A battle')}</b><span>${esc(s.skull || '')} ${esc(land(s.land))} · seed ${esc(s.seed)} · practice field</span></div>`
      + `<div class="kwtc-order" aria-label="Who acts next"></div>`
      + `<button type="button" class="kw-btn quiet kwtc-x" data-kwt="close" aria-label="Leave the battle">✕</button></header>`
      + `<div class="kwtc-board"><canvas class="kwtc-canvas" tabindex="0" aria-label="The battlefield. Arrow keys move the cursor, Enter chooses, Escape cancels."></canvas>`
      + `<div class="kwtc-banner" aria-hidden="true"></div>`
      + `<div class="kwtc-turnview"><button type="button" class="kw-btn" data-kwt="zoom-out" aria-label="Zoom out" title="Zoom out (−)">−</button><button type="button" class="kw-btn" data-kwt="zoom-in" aria-label="Zoom in" title="Zoom in (+)">＋</button>`
      + `<button type="button" class="kw-btn" data-kwt="rot-l" aria-label="Turn the view left" title="Turn the view (Q)">⟲</button><button type="button" class="kw-btn" data-kwt="rot-r" aria-label="Turn the view right" title="Turn the view (R)">⟳</button></div>`
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
    if (S.mode === 'face') {
      // Four arrows, laid out as the board is turned: each button is the way the arrow on the board points.
      const where = d => { const f = turn(e.DIRS[d][0], e.DIRS[d][1]); return f[0] > 0 ? ['↘', 'br', 'down and right'] : f[0] < 0 ? ['↖', 'tl', 'up and left'] : f[1] > 0 ? ['↙', 'bl', 'down and left'] : ['↗', 'tr', 'up and right']; };
      acts.innerHTML = `<div class="kwtc-faces" role="group" aria-label="Which way to face">` + e.DIR_KEYS.map(d => { const w = where(d); return `<button type="button" class="kw-btn kwtc-face is-${w[1]}${d === S.faceAim ? ' is-on' : ''}" data-kwt="face" data-dir="${d}" aria-label="Face ${w[2]}" aria-pressed="${d === S.faceAim}">${w[0]}</button>`; }).join('') + `</div>`
        + `<div class="kwtc-turn"><button type="button" class="kw-btn quiet" data-kwt="cancel">Back</button><button type="button" class="kw-btn primary" data-kwt="face-ok">End turn facing this way</button></div>`;
      hint.innerHTML = `<div><b>Which way should ${esc(u.name)} face?</b> Tap an arrow. A hit from the side does a quarter more, from behind half as much again.</div>`;
      return;
    }
    const a = S.mode === 'target' ? e.ability(u, S.ability) : null;
    acts.innerHTML = (u.abilities || []).map((x, i) => {
      const can = e.canUse(st, u, x), none = can.ok && !e.targetTiles(st, u, x).length;
      const why = !can.ok ? (can.why === 'cooldown' ? `ready in ${can.turns}` : can.why === 'spent' ? 'used up' : 'done') : none ? 'no one in reach' : '';
      return `<button type="button" class="kwtc-act${a === x ? ' is-on' : ''}${x.quick ? ' is-quick' : ''}" data-kwt="ability" data-key="${esc(x.key)}"${can.ok ? '' : ' disabled'} aria-pressed="${a === x}" title="${esc(x.desc || '')}">`
        + `<span class="kwtc-act-i" aria-hidden="true">${esc(x.icon)}</span><span class="kwtc-act-n">${esc(x.name)}</span>`
        + `<span class="kwtc-act-t">${esc(why || effectText(x))}</span><span class="kwtc-act-r">${esc(reachText(x))}${x.quick ? ' · quick' : ''}${x.uses != null ? ` · ${x.uses - (u.used[x.key] || 0)} left` : ''}</span><kbd aria-hidden="true">${i + 1}</kbd></button>`;
    }).join('')
      + `<div class="kwtc-turn">${st.turn.moved && !st.turn.acted && !st.turn.quick ? `<button type="button" class="kw-btn quiet" data-kwt="undo">↶ Undo move</button>` : ''}`
      + `<button type="button" class="kw-btn quiet" data-kwt="auto" title="The party fights the rest of the battle by itself">Let them fight</button>`
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
    if (u && u.side === 'player' && st.turn.moved && st.turn.acted) return askFacing();
    paint();
  }
  // The turn is ending: ask which way to look. The way shown first is towards the nearest foe.
  function askFacing() {
    const e = E(), u = e.current(S.state);
    if (S.busy || !u || u.side !== 'player') return;
    S.mode = 'face'; S.ability = null; S.pick = null; S.info = null;
    aimFace(e.facingFor(S.state, u));
  }
  function aimFace(dir) {
    const u = E().current(S.state);
    if (!u || !E().DIRS[dir]) return;
    S.faceAim = dir;
    if (S.view[u.id]) S.view[u.id].face = dir;      // the citizen turns to show it
    paint();
  }
  async function endTurn(face) {
    if (S.busy || !E().current(S.state)) return;
    S.busy = true; S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; S.faceAim = null;
    paintPanel();
    const ev = E().endTurn(S.state, face);
    send(E().DIRS[face] ? { t: 'end', face } : { t: 'end' });
    await play(ev);
    S.busy = false;
    await nextTurn();
  }
  // Creatures take their turns by themselves until it is a citizen's.
  async function nextTurn() {
    const e = E(), st = S.state, epoch = S.epoch;
    for (let guard = 0; guard < 60 && S.open && S.epoch === epoch; guard++) {
      if (st.status !== 'active') return finish();
      const u = e.current(st);
      if (u.side === 'player') { S.cursor = { x: u.x, y: u.y }; S.mode = 'idle'; paint(); say(`${u.name}'s turn.`); sfx('turn'); return; }
      S.busy = true; paint();
      await wait(260);
      if (S.epoch !== epoch) return;
      await play(e.aiTurn(st));
      if (S.epoch !== epoch) return;
      S.busy = false;
    }
  }

  // ── The server keeps the battle (lib/tactics_battles.js) ──────────────────
  // Every choice is played here at once, so the screen never waits, and sent
  // to the server in order. The server plays it with the same rules. If it
  // refuses one, or the two sides ever disagree, the screen is put back to
  // the battle as the server has it.
  const jsonOf = async res => res.json().catch(() => ({}));
  function send(action) {
    const b = S.battle;
    if (!b || !b.id) return;
    const n = b.n++, mark = action.t === 'end' ? null : E().checksum(S.state);
    b.queue = b.queue.then(async () => {
      if (S.battle !== b || b.stale) return;
      try {
        const res = await global.apiFetch(`/api/tactics/battles/${b.id}/act`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n, action }) });
        const d = await jsonOf(res);
        if (!res.ok || !d.ok) return resync(b, d.battle);
        b.saved = d.battle.count; b.status = d.battle.status;
        if (mark && d.battle.count === n + 1 && d.battle.check !== mark) return resync(b, d.battle);
        noteSaved();
      } catch (e) { return resync(b, null); }
    });
  }
  // Put the screen back to the battle as the server has it.
  async function resync(b, battle) {
    if (S.battle !== b) return;
    b.stale = true;
    try {
      if (!battle) { const d = await jsonOf(await global.apiFetch(`/api/tactics/battles/${b.id}`)); battle = d.battle; }
    } catch (e) { battle = null; }
    if (S.battle !== b || !S.open) return;
    if (!battle) { toast('⚠️ The battle could not be reached. What happens now is not being saved.'); b.id = null; return; }
    S.epoch++;
    const r = E().replay(S.setup, battle.actions);
    S.state = r.state;
    S.battle = { id: b.id, n: battle.actions.length, saved: battle.actions.length, status: battle.status, queue: Promise.resolve() };
    S.busy = false; S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; S.faceAim = null; S.floats = [];
    for (const k of Object.keys(S.view)) delete S.view[k];
    syncView();
    toast('The battle was put back to where the server has it.');
    if (S.state.status !== 'active') return finish();
    nextTurn();
  }
  // The end screen says whether the result reached the server.
  function noteSaved() {
    const b = S.battle, line = S.el && S.el.querySelector('.kwtc-saved');
    if (!line || !b) return;
    const done = b.id && b.saved === b.n && b.status && b.status !== 'active';
    line.textContent = !b.id ? 'This battle was not saved.' : done ? '✓ The result is recorded.' : 'Recording the result…';
  }
  // The party fights the rest by itself: the mind chooses for every citizen, at once, with no animation.
  function autoFinish() {
    const e = E(), st = S.state;
    if (!st || S.busy || st.status !== 'active') return;
    S.epoch++; S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; S.faceAim = null;
    for (let guard = 0; guard < 600 && st.status === 'active'; guard++) {
      const u = e.current(st);
      if (u.side !== 'player') { e.aiTurn(st); continue; }      // only at the very start; afterwards 'end' settles them
      const keep = st.r, p = e.plan(st);
      st.r = keep;                                               // looking ahead must not use up the battle's dice
      const list = [];
      if (p && p.to && !st.turn.moved && (p.to.x !== u.x || p.to.y !== u.y)) list.push({ t: 'move', x: p.to.x, y: p.to.y });
      if (p && p.ability && !st.turn.acted) list.push({ t: 'use', key: p.ability, x: p.x, y: p.y });
      list.push({ t: 'end' });
      for (const a of list) { if (st.status !== 'active') break; if (e.apply(st, a)) send(a); }
    }
    for (const k of Object.keys(S.view)) delete S.view[k];
    syncView();
    if (st.status !== 'active') finish(); else nextTurn();
  }
  async function doMove(x, y) {
    const ev = E().move(S.state, x, y);
    if (!ev) return;
    send({ t: 'move', x, y });
    S.busy = true; S.pick = null; paintPanel();
    await play(ev);
    S.busy = false; S.cursor = { x, y };
    await afterAction();
  }
  async function doUse(x, y) {
    const key = S.ability, ev = E().use(S.state, key, x, y);
    if (!ev) return;
    send({ t: 'use', key, x, y });
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
    S.mode = 'target'; S.ability = key; S.info = null; sfx('select');
    // An ability with only one place to go is aimed already: Confirm does it.
    S.pick = (a.target === 'self' || a.shape === 'around') ? { x: u.x, y: u.y } : null;
    paint();
  }
  function cancel() {
    if (S.mode === 'face') { const u = E().current(S.state); if (u && S.view[u.id]) S.view[u.id].face = u.face; }
    if (S.mode !== 'idle' || S.pick) sfx('cancel');
    S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; S.faceAim = null; paint();
  }
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
    S.ended = now(); S.busy = false; S.mode = 'idle';
    music(false); sfx(st.status === 'victory' ? 'victory' : 'defeat');
    const secs = Math.round((S.ended - S.started) / 1000), won = st.status === 'victory';
    const left = st.units.filter(u => u.side === 'player' && !u.down);
    box.innerHTML = `<div class="kw-box kwtc-end-box"><div class="kw-box-title">${won ? '🏆 The field is yours' : '💀 The party is down'}</div>`
      + `<p>${st.round} round${st.round === 1 ? '' : 's'} · ${st.stats.turns} of your turns · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</p>`
      + `<p>${won ? `${left.length} of 4 still standing${left.length ? ': ' + left.map(u => `${esc(u.name)} ${u.hp}/${u.maxHp}`).join(', ') : ''}.` : 'Nothing is lost: this is a practice field.'}</p>`
      + `<p class="kwtc-saved kw-note" role="status"></p>`
      + `<div class="kwtc-confirm"><button type="button" class="kw-btn primary" data-kwt="again">Same battle again</button><button type="button" class="kw-btn" data-kwt="new">A new field</button><button type="button" class="kw-btn quiet" data-kwt="close">Leave</button></div></div>`;
    box.hidden = false;
    paint();
    noteSaved();
    const b = box.querySelector('button'); if (b) b.focus();
  }

  // ── Opening and closing ───────────────────────────────────────────────────
  function begin(setup) {
    const e = E();
    S.setup = setup; S.view = {}; S.floats = []; S.rot = 0; G.zoom = 1; G.px = 0; G.py = 0; S.faceAim = null; S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; S.hover = null; S.busy = false; S.ended = 0; S.round = 1;
    // A battle picked up again is played back to where it was; a new one starts with the creatures yet to move.
    const done = Array.isArray(setup.actions) ? setup.actions : [];
    S.state = done.length ? e.replay(setup, done).state : e.createBattle({ seed: setup.seed, land: setup.land, party: setup.party, enemies: setup.enemies });
    S.battle = { id: setup.battle_id || null, n: done.length, saved: done.length, status: 'active', queue: Promise.resolve() };
    S.epoch = (S.epoch || 0) + 1;
    syncView();
    S.started = now();
  }
  // `hold`: a promise the first turn waits on (the curtain lifting), so nothing happens unseen.
  function open(setup, hold) {
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
      if (k === 'close') leave();
      else if (k === 'face') { sfx('confirm'); endTurn(b.getAttribute('data-dir')); }
      else if (k === 'face-ok') { sfx('confirm'); endTurn(S.faceAim); }
      else if (k === 'zoom-in') zoomBy(1.35);
      else if (k === 'zoom-out') zoomBy(1 / 1.35);
      else if (k === 'ability') choose(b.getAttribute('data-key'));
      else if (k === 'end') askFacing();
      else if (k === 'undo') { if (E().undoMove(S.state)) { send({ t: 'undo' }); syncView(); S.pick = null; paint(); } }
      else if (k === 'auto') autoFinish();
      else if (k === 'confirm') { sfx('confirm'); commit(); }
      else if (k === 'cancel' || k === 'back') cancel();
      else if (k === 'rot-l') rotate(-1);
      else if (k === 'rot-r') rotate(1);
      else if (k === 'again') restart(false);
      else if (k === 'new') restart(true);
    });
    // One finger or the mouse: a tap chooses, a drag slides the board. Two fingers: pinch to zoom. The wheel zooms too.
    const xy = ev => { const r = S.canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const P = { down: new Map(), drag: false, pinch: null, start: null };
    S.canvas.addEventListener('pointerdown', ev => {
      S.pointer = ev.pointerType === 'mouse' ? 'mouse' : 'touch';
      try { S.canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
      const q = xy(ev);
      P.down.set(ev.pointerId, q);
      if (P.down.size === 1) { P.drag = false; P.start = { x: q.x, y: q.y, px: G.px, py: G.py }; }
      else if (P.down.size === 2) { const [a, b] = [...P.down.values()]; P.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: G.zoom }; P.drag = true; }
    });
    S.canvas.addEventListener('pointermove', ev => {
      S.pointer = ev.pointerType === 'mouse' ? 'mouse' : 'touch';
      const q = xy(ev);
      if (P.down.has(ev.pointerId)) {
        P.down.set(ev.pointerId, q);
        if (P.pinch && P.down.size >= 2) {
          const [a, b] = [...P.down.values()];
          return zoomAt(P.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / P.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        if (P.start && P.down.size === 1) {
          const dx = q.x - P.start.x, dy = q.y - P.start.y;
          if (!P.drag && Math.hypot(dx, dy) > (S.pointer === 'mouse' ? 6 : 10)) P.drag = true;
          if (P.drag) { G.px = P.start.px + dx; G.py = P.start.py + dy; layout(); }
        }
        return;
      }
      if (S.pointer !== 'mouse') return;
      if (S.mode === 'face') { const d = faceAt(q.x, q.y); if (d && d !== S.faceAim) aimFace(d); return; }
      const t = tileAtPoint(q.x, q.y), was = S.hover;
      S.hover = t;
      if ((t && t.x) !== (was && was.x) || (t && t.y) !== (was && was.y)) paintPanel();
    });
    S.canvas.addEventListener('pointerleave', () => { S.hover = null; });
    const lift = ev => {
      if (!P.down.has(ev.pointerId)) return;
      const q = xy(ev);
      P.down.delete(ev.pointerId);
      if (P.down.size < 2) P.pinch = null;
      if (P.down.size === 1) { const r = [...P.down.values()][0]; P.start = { x: r.x, y: r.y, px: G.px, py: G.py }; return; }   // one finger stays down after a pinch: it drags, it does not tap
      const tapped = !P.drag && ev.type === 'pointerup';
      P.drag = false; P.start = null;
      if (!tapped) return;
      if (S.mode === 'face') { const d = faceAt(q.x, q.y); if (d) { sfx('confirm'); endTurn(d); } return; }
      const t = tileAtPoint(q.x, q.y);
      if (t) tapTile(t.x, t.y, S.pointer === 'mouse');
    };
    S.canvas.addEventListener('pointerup', lift);
    S.canvas.addEventListener('pointercancel', lift);
    S.canvas.addEventListener('wheel', ev => { ev.preventDefault(); const q = xy(ev); zoomAt(G.zoom * Math.exp(-ev.deltaY * 0.0016), q.x, q.y); }, { passive: false });
    el.addEventListener('keydown', onKey);
    // The board is laid out again whenever its box changes size (the window, or the panel below growing).
    S.onResize = () => { layout(); };
    global.addEventListener('resize', S.onResize);
    if (global.ResizeObserver) { S.watch = new global.ResizeObserver(() => layout()); S.watch.observe(S.canvas.parentNode); }
    layout(); paint();
    if (global.KWVillagers && global.KWVillagers.load) global.KWVillagers.load();
    loop();
    S.canvas.focus();
    Promise.all([hold || Promise.resolve(), loadAssets()]).then(() => { if (S.open && S.el === el && !S.ended) { music(true); nextTurn(); } });
  }
  function rotate(by) { S.rot = (S.rot + by + 4) & 3; S.hover = null; layout(); say('The view is turned.'); }
  function onKey(ev) {
    const e = E(), st = S.state;
    if (!st) return;
    if (ev.key === 'Escape') { ev.preventDefault(); if (S.mode !== 'idle' || S.pick || S.info) cancel(); else leave(); return; }
    if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); return zoomBy(1.35); }
    if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); return zoomBy(1 / 1.35); }
    if (ev.target && ev.target.closest && ev.target.closest('button') && (ev.key === 'Enter' || ev.key === ' ')) return;
    if (ev.key === 'q' || ev.key === 'Q') { ev.preventDefault(); return rotate(-1); }
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); return rotate(1); }
    // The arrows follow the board as it is turned: up is away from the viewer, to the right.
    const arrow = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[ev.key];
    const move = arrow ? turn(arrow[0], arrow[1], true) : null;
    if (move && S.mode === 'face') { ev.preventDefault(); return aimFace(e.DIR_KEYS.find(d => e.DIRS[d][0] === move[0] && e.DIRS[d][1] === move[1])); }
    if (S.mode === 'face' && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); sfx('confirm'); return endTurn(S.faceAim); }
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
    if ((ev.key === 'e' || ev.key === 'E') && u && u.side === 'player') { ev.preventDefault(); askFacing(); }
  }
  function close(quiet) {
    if (!S.open && !S.el) return;
    if (S.open) music(false);
    S.open = false;
    global.cancelAnimationFrame(S.raf);
    if (S.onResize) global.removeEventListener('resize', S.onResize);
    if (S.watch) { S.watch.disconnect(); S.watch = null; }
    if (S.el && S.el.parentNode) S.el.parentNode.removeChild(S.el);
    S.el = null; S.canvas = null; S.ctx = null; S.state = quiet ? S.state : null;
  }
  // A battle as the screen takes it: the two sides, with the server's id and the choices so far.
  const asSetup = battle => ({ ...battle.setup, battle_id: battle.id, actions: battle.actions || [] });
  // Ask the server for a new battle: { classes, level, tier, terrain, seed, fight }.
  async function fetchBattle(opts) {
    const res = await global.apiFetch('/api/tactics/battles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts || {}) });
    const d = await jsonOf(res);
    if (!res.ok || !d.ok) throw new Error(d.error || 'The battle could not be set up.');
    return asSetup(d.battle);
  }
  // The town's open battle, if it has one (to pick up after a reload).
  async function openBattle() {
    try { const d = await jsonOf(await global.apiFetch('/api/tactics/battles/current')); return d && d.ok && d.battle ? d.battle : null; } catch (e) { return null; }
  }
  // ── Into a battle, and out of one ─────────────────────────────────────────
  // A dark spiral closes over whatever was on screen, the battle's name is
  // shown on it, and then a circle opens onto the board. With reduced motion
  // the screen simply goes dark and then shows the board.
  const DARK = '#1d150d';
  function curtain() {
    const el = doc.createElement('div');
    el.className = 'kwtc-curtain';
    el.innerHTML = '<canvas aria-hidden="true"></canvas><div class="kwtc-curtain-title" role="status"></div>';
    doc.body.appendChild(el);
    const cv = el.firstChild, dpr = Math.min(2, global.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(global.innerWidth * dpr)); cv.height = Math.max(1, Math.round(global.innerHeight * dpr));
    return { el, c: cv.getContext('2d'), w: cv.width, h: cv.height, title: el.lastChild };
  }
  // Run draw(p) for p from 0 to 1 over ms.
  function animate(ms, draw) {
    return new Promise(resolve => {
      const t0 = now();
      const step = () => { const p = Math.min(1, (now() - t0) / ms); draw(p); if (p < 1) global.requestAnimationFrame(step); else resolve(); };
      step();
    });
  }
  // Nine curved blades turn and widen from the middle until they meet.
  function drawSwirl(C, p) {
    const c = C.c, cx = C.w / 2, cy = C.h / 2, R = Math.hypot(C.w, C.h) / 2 + 4, N = 9, STEPS = 22;
    c.clearRect(0, 0, C.w, C.h);
    c.fillStyle = DARK;
    if (p >= 1) return void c.fillRect(0, 0, C.w, C.h);
    const wide = p * p * (2 * Math.PI / N), spin = p * Math.PI * 1.25, twist = 2.6;
    for (let i = 0; i < N; i++) {
      const a0 = i * 2 * Math.PI / N + spin;
      c.beginPath(); c.moveTo(cx, cy);
      for (let k = 1; k <= STEPS; k++) { const r = R * k / STEPS, a = a0 + twist * k / STEPS; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      for (let k = STEPS; k >= 1; k--) { const r = R * k / STEPS, a = a0 + wide + twist * k / STEPS; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      c.closePath(); c.fill();
    }
  }
  // A circle opens from the middle.
  function drawIris(C, p) {
    const c = C.c, R = Math.hypot(C.w, C.h) / 2 + 4, q = 1 - Math.pow(1 - p, 3);
    c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, C.w, C.h);
    c.fillStyle = DARK; c.fillRect(0, 0, C.w, C.h);
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(C.w / 2, C.h / 2, R * q, 0, 6.3); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  const FIGHT = { fight: 'A fight', elite: 'An elite fight', boss: 'The boss' };
  let entering = false;
  // Bring up a battle from a promise of its two sides.
  async function enter(setupPromise) {
    if (entering) return null;
    entering = true;
    const C = curtain();
    try {
      loadAssets().then(() => sfx('start'));
      const closing = still() ? (C.el.classList.add('is-solid'), wait(60)) : animate(620, p => drawSwirl(C, p));
      const [setup] = await Promise.all([setupPromise, closing]);
      C.el.classList.add('is-solid');
      // The screen is dark: Dev Tools, where the battle was started, is put away behind it.
      if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
      C.title.innerHTML = `<b>⚔ ${esc(setup.name || 'A battle')}</b><span>${esc(setup.skull || '')} ${esc(land(setup.land))} · ${esc(FIGHT[setup.fight] || 'A fight')}</span>`;
      C.title.classList.add('is-on');
      let lifted;
      open(setup, new Promise(r => { lifted = r; }));
      await new Promise(r => global.setTimeout(r, 900));      // long enough to read the name, with or without motion
      C.title.classList.remove('is-on');
      C.el.classList.remove('is-solid');
      if (!still()) await animate(560, p => drawIris(C, p));
      C.el.remove();
      lifted();
      return setup;
    } catch (e) { C.el.remove(); throw e; }
    finally { entering = false; }
  }
  // Start a battle: { classes, level, tier, terrain, seed, fight }.
  async function start(opts) {
    const setup = await enter(fetchBattle(opts));
    if (setup) S.opts = opts || {};
    return setup;
  }
  // Pick up the town's open battle where it was left.
  async function resume(battle) {
    const b = battle || await openBattle();
    return b ? enter(Promise.resolve(asSetup(b))) : null;
  }
  async function restart(fresh) {
    try {
      // The same battle again is a new battle on the same seed: the same field and the same creatures.
      await start({ ...(S.opts || {}), seed: fresh ? undefined : S.setup.seed, tier: (S.opts || {}).tier || S.setup.tier, terrain: (S.opts || {}).terrain || S.setup.land });
    } catch (e) { toast('⚠️ ' + e.message); }
  }
  // Leaving: the scene fades, then goes.
  function leave() {
    if (!S.open || !S.el || S.leaving) return;
    S.leaving = true;
    music(false);
    // Walking out of a battle that is not over ends it on the server too.
    const b = S.battle;
    if (b && b.id && S.state && S.state.status === 'active') b.queue.then(() => global.apiFetch(`/api/tactics/battles/${b.id}/leave`, { method: 'POST' })).catch(() => {});
    S.el.classList.add('is-leaving');
    global.setTimeout(() => { S.leaving = false; close(); }, still() ? 0 : 300);
  }

  // ── Dev Tools → 💀 Dungeons → the tactics battle ──────────────────────────
  const DEV = { options: null, pick: null, open: null };
  const SLOTS = ['Front, left', 'Front, right', 'Back, left', 'Back, right'];
  function loadPick() {
    if (DEV.pick) return DEV.pick;
    let saved = null;
    try { saved = JSON.parse(global.localStorage.getItem('kwt_dev_pick') || 'null'); } catch (e) { /* private window */ }
    DEV.pick = Object.assign({ classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'skull', tier: 'green', terrain: 'forest', fight: 'first', seed: '' }, saved || {});
    return DEV.pick;
  }
  function devHtml(o, p) {
    if (!o) return `<div class="cheat-section-label" style="margin-top:10px">Tactics battle</div><div class="cheat-desc">Loading…</div>`;
    const sel = (id, list, val, label) => `<label>${esc(label)} <select class="ce-input" data-kwt-dev="${id}">${list.map(x => `<option value="${esc(x.key)}"${x.key === val ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>`;
    return `<div class="cheat-section-label" style="margin-top:10px">Tactics battle</div>`
      + `<div class="cheat-desc">A battle on a small board: walk, face, strike from behind or from above. It uses four of your grown-up citizens with the classes chosen here, costs nothing and changes nothing.</div>`
      + `<div class="kwdg-dev-row">${SLOTS.map((s, i) => sel('class' + i, o.classes.map(c => ({ key: c.key, label: `${c.icon} ${c.label}` })), p.classes[i], s)).join('')}</div>`
      + `<div class="kwdg-dev-row">${sel('level', o.levels, p.level, 'Their level')}${sel('tier', o.tiers.map(t => ({ key: t.key, label: `${t.skull} ${t.name}` })), p.tier, 'Skull')}`
      + `${sel('terrain', o.lands.map(l => ({ key: l, label: land(l) })), p.terrain, 'Land')}${sel('fight', o.fights, p.fight, 'Against')}`
      + `<label>Seed <input class="ce-input" type="number" min="1" inputmode="numeric" placeholder="any" data-kwt-dev="seed" value="${esc(p.seed || '')}"></label></div>`
      + `<button type="button" class="cheat-all-btn" data-kwt-dev="start">⚔ Start a tactics battle</button>`
      + (DEV.open ? `<button type="button" class="cheat-all-btn" data-kwt-dev="resume">↩ Pick up the battle that is open: ${esc(DEV.open.setup.name || 'a battle')} (${DEV.open.count} choice${DEV.open.count === 1 ? '' : 's'} in)</button>` : '')
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
        const b = ev.target.closest('[data-kwt-dev="start"], [data-kwt-dev="resume"]');
        if (!b) return;
        const msg = box.querySelector('[data-kwt-dev="msg"]');
        try {
          if (b.getAttribute('data-kwt-dev') === 'resume') return void await resume(DEV.open);
          const seed = parseInt(p.seed, 10);
          await start({ classes: p.classes, level: p.level, tier: p.tier, terrain: p.terrain, fight: p.fight, seed: seed > 0 ? seed : undefined });
          if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
        } catch (e) { if (msg) msg.textContent = '⚠️ ' + e.message; }
      });
    }
    // Each time the tab is shown: is a battle open?
    if (DEV.options) openBattle().then(o => { DEV.open = o; box.innerHTML = devHtml(DEV.options, p); });
    if (!DEV.options) {
      try {
        const res = await global.apiFetch('/api/tactics/admin/options');
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.ok) { DEV.options = d; DEV.open = await openBattle(); box.innerHTML = devHtml(d, p); }
        else box.innerHTML = `<div class="cheat-desc">⚠️ ${esc(d.error || 'The tactics battle could not be loaded.')}</div>`;
      } catch (e) { box.innerHTML = `<div class="cheat-desc">⚠️ ${esc(e.message)}</div>`; }
    }
  }

  global.KWTactics = {
    start, resume, open, close, leave, devMount,
    // For the proofs and the browser checks.
    _state: S, _geom: G, _tapTile: tapTile, _choose: choose, _confirm: commit, _endTurn: endTurn, _tileXY: tileXY, _standXY: standXY, _tileAtPoint: tileAtPoint, _rotate: rotate, _view: view, _zoomAt: zoomAt, _askFacing: askFacing, _aimFace: aimFace, _faceSpots: faceSpots, _assets: ASSETS, _sfx: sfx, _auto: autoFinish, _send: send, _resync: resync,
    _devHtml: devHtml, _effectText: effectText, _reachText: reachText, _layout: layout, _begin: begin, _forecastHtml: forecastHtml, CLASS_COLOUR,
  };
})(typeof window !== 'undefined' ? window : globalThis);
