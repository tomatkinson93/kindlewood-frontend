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
  const S = { open: false, setup: null, opts: null, state: null, view: {}, floats: [], fx: [], cast: null, shake: 0, mode: 'idle', ability: null, pick: null, hover: null, cursor: null,
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
    const resized = S.canvas.width !== pw || S.canvas.height !== ph;
    if (resized) { S.canvas.width = pw; S.canvas.height = ph; S.canvas.style.width = cw + 'px'; S.canvas.style.height = ch + 'px'; }
    // Dragging: the board may slide until its middle is a quarter of the box from an edge, and no further.
    const lx = Math.max(0, (bw * G.scale - cw) / 2 + cw * 0.25), ly = Math.max(0, (bh * G.scale - ch) / 2 + ch * 0.25);
    if (G.zoom <= 1.001) { G.px = 0; G.py = 0; }
    G.px = Math.max(-lx, Math.min(lx, G.px)); G.py = Math.max(-ly, Math.min(ly, G.py));
    G.ox = (cw - bw * G.scale) / 2 + ((S.rot & 1) ? m.w : m.h) * G.tw / 2 * G.scale + G.px;
    G.oy = (ch - bh * G.scale) / 2 + (head + peak * G.lift) * G.scale + G.py;
    // Resizing a canvas wipes it: draw at once, so there is never an empty frame (it showed as a flash).
    if (resized && S.ctx) draw(now());
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
    const units = Object.values(S.view).filter(v => !v.gone && !v.lying).sort((a, b) => depth(b.x, b.y) - depth(a.x, a.y));
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
  const ASSETS = { loaded: false, creatures: {}, sounds: {}, music: [], icons: {}, status: {}, tracks: [] };
  function loadAssets() {
    if (ASSETS.loaded || typeof global.fetch !== 'function') return Promise.resolve(ASSETS);
    ASSETS.loaded = true;
    return global.fetch('/assets/tactics/manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => {
      if (j) { ASSETS.creatures = j.creatures || {}; ASSETS.sounds = j.sounds || {}; ASSETS.music = j.music || []; ASSETS.icons = j.icons || {}; ASSETS.status = j.status || {}; ASSETS.tracks = j.tracks || []; }
      return ASSETS;
    });
  }
  // name → a sound that exists today, used until assets/audio/tactics/<name>.mp3 is there.
  const STAND_IN = { select: 'card_click.wav', confirm: 'next.wav', melee: 'stab.wav', arrow: 'stab.wav', magic: 'stab.wav', bite: 'stab.wav',
    down_foe: 'splat.wav', down_friend: 'fail.wav', victory: 'success.mp3', defeat: 'fail.wav' };
  // Some sounds are a finer kind of another: when the finer one has no file, the plainer one plays.
  const PLAINER = { sword: 'melee', down_friend: 'down_foe' };
  function sfx(name) {
    if (typeof global.playSfx !== 'function' || (S.demo && !S.demoSound)) return;
    const own = ASSETS.sounds[name] || ASSETS.sounds[PLAINER[name]], file = own ? 'tactics/' + own : (STAND_IN[name] || STAND_IN[PLAINER[name]]);
    if (file) global.playSfx(file);
  }
  // Which tracks suit a battle. Lands with none of their own borrow a neighbour's: hills the mountain's, ruins the marsh's.
  const BORROWS = { hills: ['mountain'], mountain: ['hills'], ruins: ['marsh'], marsh: ['ruins'], plains: ['forest'], forest: ['plains'], river: ['marsh', 'plains'] };
  function tracksFor(setup, all) {
    const of = place => all.filter(t => t.place === place);
    if (setup.fight === 'boss') {
      const foes = setup.enemies || [], withered = setup.band === 'withered' || (foes.length && foes.filter(u => u.band === 'withered').length * 2 > foes.length);
      const mine = withered ? of('boss-withered') : of('boss');
      if (mine.length) return mine;
      const any = all.filter(t => /^boss/.test(t.place || ''));
      if (any.length) return any;
    }
    const own = of(setup.land);
    if (own.length) return own;
    for (const near of BORROWS[setup.land] || []) { const got = of(near); if (got.length) return got; }
    const rest = all.filter(t => !/^boss/.test(t.place || ''));
    return rest.length ? rest : all;
  }
  function music(on) {
    if (S.demo) return;      // a battle shown for its own sake (the jukebox page) brings its own music
    try {
      if (!on) { if (typeof global.stopMusic === 'function') global.stopMusic(); return; }
      // Its own tracks when there are any, else the card battles'. A track belongs to a place (its file is named
      // <place>-<title>): a land's tracks play on that land, the boss's for a boss, the Withered boss's for theirs.
      const pick = tracksFor(S.setup || {}, ASSETS.tracks.length ? ASSETS.tracks : ASSETS.music.map(f => ({ file: f, place: /^boss/i.test(f) ? 'boss' : null })));
      const list = pick.map(t => t.file);
      if (list.length && typeof global.registerMusic === 'function') global.registerMusic('TACTICS', list.map(f => '/assets/audio/tactics/music/' + f));
      if (typeof global.playMusic === 'function') global.playMusic(list.length && typeof global.registerMusic === 'function' ? 'TACTICS' : 'BATTLE');
    } catch (e) { /* no sound is fine */ }
  }
  // The sound of an ability, from what it is and what it looks like.
  const SOUND_OF = { arrow: 'arrow', stone: 'arrow', dart: 'arrow',
    spark: 'magic', fire: 'magic', fireburst: 'magic', frost: 'magic', ember: 'magic', hex: 'magic', venom: 'magic', gale: 'magic', thunder: 'magic', spores: 'magic', curse: 'magic', vial: 'magic', sand: 'magic',
    // A blade rings (sword); a club, a fist or a boulder thuds (melee).
    slash: 'sword', thrust: 'sword', smash: 'melee', quake: 'melee', boulder: 'melee', claw: 'bite', bite: 'bite', wail: 'bite' };
  function soundOf(u, ev, look) {
    if (ev.kind === 'block') return 'block';
    if (ev.kind === 'heal') return 'heal';
    if (ev.kind === 'buff') return 'buff';
    if (ev.kind === 'debuff') return 'debuff';
    return SOUND_OF[look] || (u.side === 'enemy' ? 'bite' : 'melee');
  }
  // An ability's picture: its own icon when there is one (assets/tactics/icons/<key>.png), else its emoji.
  // A foe's ability with no picture of its own takes the one for how it looks (look_<look>.png).
  function ico(a) {
    const file = ASSETS.icons && (ASSETS.icons[a.key] || (a.look && ASSETS.icons['look_' + a.look]));
    return file ? `<img class="kwtc-ic" src="/assets/tactics/icons/${esc(file)}" alt="" draggable="false">` : esc(a.icon || '•');
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
    if (!a || !a.file) return null;
    const img = sheet('/assets/sprites/creatures/' + a.file);
    if (!img) return null;
    // The sheet is one row, a frame for each of the four ways a unit can look on the board (scripts/pack_foes.py).
    const f = E().DIRS[v.face] || [0, 1], tv = turn(f[0], f[1]), dir = tv[0] > 0 ? 'se' : tv[0] < 0 ? 'nw' : tv[1] > 0 ? 'sw' : 'ne';
    const i = Math.max(0, (a.dirs || []).indexOf(dir));
    return { img, sx: i * a.w, w: a.w, h: a.h, foot: a.foot || { x: a.w / 2, y: a.h }, scale: a.scale || 1 };
  }
  // A foe's face for the row of who acts next, if it has one.
  const faceOf = u => { const a = u && ASSETS.creatures[u.key]; return a && a.face ? '/assets/sprites/creatures/' + a.face : null; };

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
  // A fallen citizen: lying on their side where they fell, greyed, in a broken ring.
  function drawFallen(c, v, t) {
    const k = G.scale, u = E().unit(S.state, v.id), p = standXY(v.x, v.y);
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(p.x, p.y, 17 * k, 8 * k, 0, 0, 6.3); c.fill();
    c.strokeStyle = TEAM[u.side]; c.lineWidth = 1.6 * Math.max(1, k * 0.8); c.setLineDash([4 * k, 4 * k]);
    c.beginPath(); c.ellipse(p.x, p.y, 17 * k, 8 * k, 0, 0, 6.3); c.stroke(); c.setLineDash([]);
    const sp = spriteOf(v, 0);
    if ('filter' in c) c.filter = 'grayscale(0.7) brightness(0.85)';
    if (sp) {
      const s = sp.s, z = 0.62 * k;
      c.imageSmoothingEnabled = false;
      c.translate(p.x - 15 * k, p.y - 3 * k); c.rotate(Math.PI / 2);      // feet to the left, head to the right
      c.drawImage(sp.img, 0, s.row * s.h, s.w, s.h, -s.foot.x * z, -s.foot.y * z, s.w * z, s.h * z);
    } else {
      c.fillStyle = CLASS_COLOUR[u.cls] || CLASS_COLOUR.villager; c.beginPath(); c.ellipse(p.x, p.y - 5 * k, 14 * k, 7 * k, 0, 0, 6.3); c.fill();
    }
    c.restore();
    c.save();
    c.font = `bold ${Math.round(Math.max(9, 9.5 * k))}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = 'rgba(20,12,6,0.85)'; c.strokeText('Down', p.x, p.y - 22 * k);
    c.fillStyle = '#ffd9d0'; c.fillText('Down', p.x, p.y - 22 * k);
    c.restore();
  }
  function drawUnit(c, v, t) {
    if (v.lying) return drawFallen(c, v, t);
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
        // Its height on the board is set against a citizen's (the packer's `scale`); walking, it hops along.
        const z = 0.62 * k * art.scale, hop = v.walking && !still() ? Math.abs(Math.sin(t / 85)) * 3.5 * k : 0;
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(art.img, art.sx, 0, art.w, art.h, p.x - art.foot.x * z, p.y + 3 * k - hop - art.foot.y * z, art.w * z, art.h * z);
        v.tall = art.h * z;
      } else {
        c.font = `${Math.round(28 * k)}px serif`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
        c.fillText(u.icon || '👹', p.x, p.y + 2 * k + bob);
      }
    }
    if ('filter' in c) c.filter = 'none';
    // Health, block, class and what ails it.
    // The health bar sits just over the head: a tall foe's higher, a small one's lower.
    const top = p.y - (u.side === 'player' ? 44 * k : Math.max(30 * k, (v.tall || 34 * k) + 2 * k)), bw = 34 * k, bh = Math.max(4, 4.5 * k);
    c.fillStyle = 'rgba(20,12,6,0.85)'; c.fillRect(p.x - bw / 2 - 1, top - 1, bw + 2, bh + 2);
    c.fillStyle = u.side === 'player' ? '#8fd070' : '#e0705f';
    c.fillRect(p.x - bw / 2, top, bw * Math.max(0, Math.min(1, v.hp / u.maxHp)), bh);
    c.textBaseline = 'middle'; c.font = `bold ${Math.round(Math.max(9, 9.5 * k))}px sans-serif`;
    if (u.side === 'player') { c.fillStyle = CLASS_COLOUR[u.cls] || CLASS_COLOUR.villager; c.beginPath(); c.arc(p.x - bw / 2 - 6 * k, top + bh / 2, 3.6 * k, 0, 6.3); c.fill(); }
    if (v.block > 0) { c.textAlign = 'left'; c.fillStyle = '#9fd0ff'; c.fillText('🛡' + v.block, p.x + bw / 2 + 3, top + bh / 2); }
    const ails = Object.keys(STATUS).filter(s => (v.st[s] || 0) > 0);
    if (ails.length) {
      // Each as its pip (assets/tactics/status/<name>.png) with how much of it; its glyph until the picture is there.
      const sz = Math.max(11, 13 * k), gap = 3 * k, y = top - 9 * k;
      c.fillStyle = '#fff3d6'; c.textAlign = 'left';
      const parts = ails.map(s => { const img = ASSETS.status[s] ? sheet('/assets/tactics/status/' + ASSETS.status[s]) : null, n = String(v.st[s]); return { img, text: img ? n : STATUS[s][1] + n }; });
      for (const q of parts) q.w = (q.img ? sz + 1 : 0) + c.measureText(q.text).width;
      let x = p.x - (parts.reduce((n, q) => n + q.w, 0) + gap * (parts.length - 1)) / 2;
      for (const q of parts) {
        if (q.img) { c.imageSmoothingEnabled = true; c.drawImage(q.img, x, y - sz / 2, sz, sz); c.fillText(q.text, x + sz + 1, y); }
        else c.fillText(q.text, x, y);
        x += q.w + gap;
      }
    }
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
    const jolt = S.shake && t < S.shake && !still() ? (S.shake - t) / 180 : 0;
    // Behind the board: dusk above, dark earth below.
    const sky = c.createLinearGradient(0, 0, 0, G.h);
    sky.addColorStop(0, '#31465c'); sky.addColorStop(0.55, '#3a3a36'); sky.addColorStop(1, '#1d150d');
    c.fillStyle = sky; c.fillRect(0, 0, G.w, G.h);
    if (jolt) c.translate(Math.sin(t / 14) * 3 * jolt * G.scale, Math.cos(t / 11) * 2 * jolt * G.scale);      // a heavy blow jolts the board
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
    drawFx(c, t);
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

  // ── Effects: what flies and what bursts ───────────────────────────────────
  // Arrows, bolts, slashes, shields, sparkles: drawn by code on the board,
  // from what the ability is. S.fx holds whatever is in flight or fading:
  // { kind, from, to | at (board places, fractions allowed), t0, ms, seed }.
  // With reduced motion none of it is drawn; the numbers still appear.
  //
  // LOOK: ability → how it looks. Anything not listed is read from what it
  // does: a blow beside the user is a slash (a bite, from a creature), a hit
  // from afar a spark, block a shield, healing a glow, a boon a cheer, a
  // curse a mark.
  const LOOK = {
    a_shoot: 'arrow', a_part: 'arrow', a_pierce: 'arrow', a_aimed: 'arrow', a_mark: 'reticle', t_spot: 'reticle',
    w_spark: 'spark', w_bolt: 'fire', w_burst: 'fireburst', w_chill: 'frost', h_cinder: 'ember',
    w_ward: 'shield', h_ward: 'shield', h_steady: 'ward_ring', h_kindle: 'heal', t_ration: 'heal', t_drink: 'heal', h_bold: 'cheer',
    hex: 'hex', venom: 'venom', mend: 'heal', shriek: 'wail', howl: 'wail',
    v_swing: 'smash', t_tool: 'smash', g_shove: 'smash',      // a stick, a tool, a shoulder: a thud, where a Guard's blade rings
  };
  const FLIES = { arrow: 1, spark: 1, fire: 1, fireburst: 1, frost: 1, ember: 1, hex: 1, venom: 1,
    stone: 1, dart: 1, vial: 1, gale: 1, sand: 1, spores: 1, curse: 1, boulder: 1, thunder: 1 };
  const LANDS_AS = { arrow: 'puff', spark: 'flare', fire: 'flare', fireburst: 'flare', ember: 'flare', frost: 'ice', hex: 'hexpop', venom: 'splat', slash: 'slash', bite: 'claw', wail: 'claw', claw: 'claw',
    stone: 'puff', dart: 'puff', vial: 'splat', gale: 'gust', sand: 'puff', spores: 'splat', curse: 'hexpop', boulder: 'thud', thunder: 'flare', thrust: 'poke', smash: 'thud', quake: 'thud' };
  // What an area ability leaves over the place it lands, and the ring one spreads when it is used around oneself.
  const BLOOMS = { fireburst: ['boom', 460], frost: ['ice', 380], spores: ['cloud', 620], curse: ['murk', 560], boulder: ['crack', 460], thunder: ['crack', 420] };
  const RINGS = { ward_ring: '#9fd0ff', wail: '#ff8a70', spores: '#9fdc5a', smash: '#f4efe2', quake: '#d8c39a', cheer: '#ffd27a', curse: '#b77cf0' };
  function lookOf(u, ev) {
    // A foe's ability says how it looks (lib/tactics_foes.js on the server); a class ability is in the table above.
    const own = (u.abilities || []).find(x => x.key === ev.key);
    if (own && own.look) return own.look;
    if (LOOK[ev.key]) return LOOK[ev.key];
    if (ev.kind === 'block') return 'shield';
    if (ev.kind === 'heal') return 'heal';
    if (ev.kind === 'buff') return 'cheer';
    if (ev.kind === 'debuff') return 'reticle';
    const far = Math.abs(ev.x - u.x) + Math.abs(ev.y - u.y) > 1;
    return far ? (u.side === 'enemy' ? 'hex' : 'spark') : (u.side === 'enemy' ? 'bite' : 'slash');
  }
  function fx(kind, at, ms, more) {
    if (still()) return;
    S.fx.push(Object.assign({ kind, at: { x: at.x, y: at.y }, t0: now(), ms, seed: Math.random() }, more || {}));
  }
  // A point above a board place: `up` pixels (at scale 1) above the ground there.
  const above = (m, up) => { const p = standXY(m.x, m.y); return { x: p.x, y: p.y - up * G.scale }; };
  const mix = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });
  // Where something in flight is: from chest to chest, lifted in an arc.
  function flight(f, p) {
    const A = above(f.at, 24), B = above(f.to, 20), q = mix(A, B, p);
    q.y -= Math.sin(Math.PI * p) * Math.min(46, f.far * (f.arc || 6)) * G.scale;
    return q;
  }
  function glow(c, x, y, r, inner, outer) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, inner); g.addColorStop(0.45, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill();
  }
  const PAINT = {
    arrow(c, f, p, k) {
      const a = flight(f, p), b = flight(f, Math.min(1, p + 0.04)), ang = Math.atan2(b.y - a.y, b.x - a.x);
      c.save(); c.translate(a.x, a.y); c.rotate(ang);
      c.strokeStyle = '#6b4a2e'; c.lineWidth = 2 * k; c.beginPath(); c.moveTo(-9 * k, 0); c.lineTo(6 * k, 0); c.stroke();
      c.fillStyle = '#e6e0d2'; c.beginPath(); c.moveTo(10 * k, 0); c.lineTo(4 * k, -3 * k); c.lineTo(4 * k, 3 * k); c.closePath(); c.fill();
      c.strokeStyle = '#f4efe2'; c.lineWidth = 1.5 * k; c.beginPath(); c.moveTo(-9 * k, 0); c.lineTo(-12 * k, -3 * k); c.moveTo(-9 * k, 0); c.lineTo(-12 * k, 3 * k); c.stroke();
      c.restore();
    },
    orb(c, f, p, k, r, inner, outer, tail) {
      for (let i = 5; i >= 1; i--) { const q = flight(f, Math.max(0, p - i * 0.045)); c.globalAlpha = 0.5 * (1 - i / 6); c.fillStyle = tail; c.beginPath(); c.arc(q.x, q.y, r * k * (1 - i / 9), 0, 6.3); c.fill(); }
      c.globalAlpha = 1;
      const a = flight(f, p); glow(c, a.x, a.y, r * 2.4 * k, inner, outer);
    },
    fire(c, f, p, k) { PAINT.orb(c, f, p, k, 5, '#fff6c0', '#ff8a2a', '#ff7a2a'); },
    fireburst(c, f, p, k) { PAINT.orb(c, f, p, k, 7, '#fff6c0', '#ff6a1a', '#ff5a1a'); },
    ember(c, f, p, k) { PAINT.orb(c, f, p, k, 4, '#ffe9a8', '#ff9a4a', '#ffa860'); },
    hex(c, f, p, k) { f.arc = 3; PAINT.orb(c, f, p, k, 5, '#f3dcff', '#a368e8', '#8d54d4'); },
    venom(c, f, p, k) { f.arc = 11; PAINT.orb(c, f, p, k, 4.5, '#eaffc0', '#7fc93a', '#6cb42c'); },
    sand(c, f, p, k) { f.arc = 2; PAINT.orb(c, f, p, k, 3.5, '#fff1c9', '#d9b877', '#cfa860'); },
    spores(c, f, p, k) { f.arc = 8; PAINT.orb(c, f, p, k, 5, '#f0ffd0', '#8fbf4a', '#7aa83c'); },
    curse(c, f, p, k) { f.arc = 4; PAINT.orb(c, f, p, k, 6, '#e9d0ff', '#6a3fa8', '#55308c'); },
    // Something solid thrown: a stone, a boulder, a little bottle.
    lump(c, f, p, k, r, fill, shine) {
      const a = flight(f, p);
      c.fillStyle = fill; c.strokeStyle = '#2a180c'; c.lineWidth = 1.2 * k; c.beginPath(); c.arc(a.x, a.y, r * k, 0, 6.3); c.fill(); c.stroke();
      c.fillStyle = shine; c.beginPath(); c.arc(a.x - r * 0.3 * k, a.y - r * 0.35 * k, r * 0.35 * k, 0, 6.3); c.fill();
    },
    stone(c, f, p, k) { f.arc = 9; PAINT.lump(c, f, p, k, 3.2, '#8d8678', '#c9c3b4'); },
    boulder(c, f, p, k) { f.arc = 13; PAINT.lump(c, f, p, k, 7.5, '#7d766a', '#b3ac9c'); },
    vial(c, f, p, k) { f.arc = 12; PAINT.lump(c, f, p, k, 3.8, '#6fcdb8', '#e6fff8'); },
    dart(c, f, p, k) {
      f.arc = 2;
      const a = flight(f, p), b = flight(f, Math.min(1, p + 0.04)), ang = Math.atan2(b.y - a.y, b.x - a.x);
      c.save(); c.translate(a.x, a.y); c.rotate(ang);
      c.strokeStyle = '#3d4a2a'; c.lineWidth = 1.6 * k; c.beginPath(); c.moveTo(-6 * k, 0); c.lineTo(5 * k, 0); c.stroke();
      c.fillStyle = '#d6f09a'; c.beginPath(); c.moveTo(8 * k, 0); c.lineTo(4 * k, -2 * k); c.lineTo(4 * k, 2 * k); c.closePath(); c.fill();
      c.fillStyle = '#c0524a'; c.fillRect(-8 * k, -1.6 * k, 3 * k, 3.2 * k);
      c.restore();
    },
    gale(c, f, p, k) {      // three pale curls of wind, one behind another
      f.arc = 1;
      c.strokeStyle = '#eaf6ff'; c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const q = flight(f, Math.max(0, p - i * 0.09)), t = p * 14 + i * 2;
        c.globalAlpha = 0.9 - i * 0.25; c.lineWidth = (2.4 - i * 0.5) * k;
        c.beginPath(); c.arc(q.x, q.y, (5 + i * 2) * k, t, t + 3.6); c.stroke();
      }
      c.lineCap = 'butt'; c.globalAlpha = 1;
    },
    thunder(c, f, p, k) {      // a bolt out of the sky onto the place
      const B = above(f.to, 16), A = { x: B.x + 14 * k, y: B.y - 150 * k }, reach = Math.min(1, p * 2.4), n = 7;
      c.globalAlpha = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.5);
      for (const [w, col] of [[7, 'rgba(190,220,255,0.4)'], [2.6, '#ffffff']]) {
        c.strokeStyle = col; c.lineWidth = w * k; c.lineJoin = 'round'; c.beginPath(); c.moveTo(A.x, A.y);
        for (let i = 1; i <= n; i++) { const q = mix(A, B, reach * i / n), j = i === n ? 0 : (Math.sin(f.seed * 40 + i * 5.1) * 10 * k); c.lineTo(q.x + j, q.y); }
        c.stroke();
      }
      c.globalAlpha = 1;
    },
    frost(c, f, p, k) {
      for (let i = 4; i >= 0; i--) {
        const q = flight(f, Math.max(0, p - i * 0.05)), r = (6 - i) * k;
        c.globalAlpha = 1 - i / 5; c.fillStyle = i ? '#bfe6ff' : '#f2fbff';
        c.beginPath(); c.moveTo(q.x, q.y - r); c.lineTo(q.x + r * 0.6, q.y); c.lineTo(q.x, q.y + r); c.lineTo(q.x - r * 0.6, q.y); c.closePath(); c.fill();
      }
      c.globalAlpha = 1;
    },
    spark(c, f, p, k) {      // a jagged line that leaps the gap and fades
      const A = above(f.at, 24), B = above(f.to, 20), reach = Math.min(1, p * 1.8), n = 6;
      c.globalAlpha = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
      for (const [w, col] of [[5, 'rgba(255,240,150,0.35)'], [2, '#fffbe0']]) {
        c.strokeStyle = col; c.lineWidth = w * k; c.lineJoin = 'round'; c.beginPath(); c.moveTo(A.x, A.y);
        for (let i = 1; i <= n; i++) { const q = mix(A, B, reach * i / n), j = i === n ? 0 : (Math.sin(f.seed * 40 + i * 7.3) * 7 * k); c.lineTo(q.x + j, q.y - j * 0.6); }
        c.stroke();
      }
      c.globalAlpha = 1;
    },
    // What lands: at a place, growing and fading.
    slash(c, f, p, k) {
      const a = above(f.at, 20), start = -2.4 + f.seed * 0.8, sweep = 2.2 * Math.min(1, p * 1.6);
      c.globalAlpha = 1 - p; c.strokeStyle = '#ffffff'; c.lineCap = 'round';
      for (const [r, w] of [[17, 3.5], [12, 2]]) { c.lineWidth = w * k; c.beginPath(); c.arc(a.x, a.y, r * k, start, start + sweep); c.stroke(); }
      c.lineCap = 'butt'; c.globalAlpha = 1;
    },
    claw(c, f, p, k) {
      const a = above(f.at, 20), len = 22 * k * Math.min(1, p * 2);
      c.globalAlpha = 1 - p * p; c.strokeStyle = '#ff6a55'; c.lineWidth = 2.6 * k; c.lineCap = 'round';
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(a.x - 8 * k + i * 6 * k, a.y - 10 * k); c.lineTo(a.x - 8 * k + i * 6 * k + len * 0.7, a.y - 10 * k + len); c.stroke(); }
      c.lineCap = 'butt'; c.globalAlpha = 1;
    },
    burst(c, f, p, k, ring, core, rays) {
      const a = above(f.at, f.low ? 4 : 18), r = (6 + 30 * p * (f.big || 1)) * k;
      c.globalAlpha = (1 - p) * 0.55; c.fillStyle = core; c.beginPath(); c.arc(a.x, a.y, r * 0.8, 0, 6.3); c.fill();
      c.globalAlpha = 1 - p; c.strokeStyle = ring; c.lineWidth = 3 * k * (1 - p * 0.6); c.beginPath(); c.arc(a.x, a.y, r, 0, 6.3); c.stroke();
      c.lineWidth = 2 * k;
      for (let i = 0; i < rays; i++) { const t = f.seed * 6 + i * 6.283 / rays; c.beginPath(); c.moveTo(a.x + Math.cos(t) * r * 0.7, a.y + Math.sin(t) * r * 0.7); c.lineTo(a.x + Math.cos(t) * r * 1.25, a.y + Math.sin(t) * r * 1.25); c.stroke(); }
      c.globalAlpha = 1;
    },
    puff(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 0.45 }), p, k, '#f4efe2', 'rgba(255,255,255,0.5)', 0); },
    flare(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 0.7 }), p, k, '#ffb347', '#ffd98a', 7); },
    boom(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 1.5, low: true }), p, k, '#ff9a3c', '#ffc76a', 10); },
    ice(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 0.8 }), p, k, '#cfeeff', '#eaf8ff', 6); },
    hexpop(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 0.7 }), p, k, '#b77cf0', '#dcc0ff', 5); },
    splat(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 0.6 }), p, k, '#8fd24a', '#c8f09a', 5); },
    gust(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 0.75 }), p, k, '#eaf6ff', 'rgba(255,255,255,0.45)', 0); },
    thud(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 0.9, low: true }), p, k, '#e8dcc0', '#fff4dc', 6); },
    crack(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 1.4, low: true }), p, k, '#b89a6a', '#e2cfa8', 9); },
    cloud(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 1.5, low: true }), p, k, '#9fdc5a', 'rgba(170,220,110,0.55)', 0); PAINT.bubbles(c, f, p, k); },
    murk(c, f, p, k) { PAINT.burst(c, Object.assign(f, { big: 1.5, low: true }), p, k, '#b77cf0', 'rgba(140,90,200,0.5)', 0); },
    poke(c, f, p, k) {      // a spear point: one straight flash through the place
      const a = above(f.at, 20), t = -0.5 + f.seed * 0.4, len = 22 * k * Math.min(1, p * 2.2);
      c.globalAlpha = 1 - p; c.strokeStyle = '#ffffff'; c.lineWidth = 3 * k; c.lineCap = 'round';
      c.beginPath(); c.moveTo(a.x - Math.cos(t) * len, a.y - Math.sin(t) * len); c.lineTo(a.x + Math.cos(t) * len * 0.5, a.y + Math.sin(t) * len * 0.5); c.stroke();
      c.lineCap = 'butt'; c.globalAlpha = 1;
    },
    shield(c, f, p, k) {
      const a = above(f.at, 22), s = (0.55 + 0.55 * Math.min(1, p * 1.7)) * k;
      c.save(); c.translate(a.x, a.y); c.scale(s, s); c.globalAlpha = (1 - p) * 0.9;
      c.beginPath(); c.moveTo(-13, -14); c.lineTo(13, -14); c.lineTo(13, 2); c.quadraticCurveTo(13, 14, 0, 20); c.quadraticCurveTo(-13, 14, -13, 2); c.closePath();
      c.fillStyle = 'rgba(120,180,255,0.45)'; c.fill(); c.strokeStyle = '#e6f3ff'; c.lineWidth = 2.2; c.stroke();
      c.beginPath(); c.moveTo(0, -14); c.lineTo(0, 20); c.moveTo(-13, -2); c.lineTo(13, -2); c.strokeStyle = 'rgba(230,243,255,0.6)'; c.lineWidth = 1.4; c.stroke();
      c.restore();
    },
    rising(c, f, p, k, col, draw) {      // small things rising round a unit
      const a = above(f.at, 8);
      for (let i = 0; i < 6; i++) {
        const ph = (p + i * 0.13) % 1, x = a.x + Math.sin(f.seed * 9 + i * 2.1) * 13 * k, y = a.y - ph * 38 * k;
        c.globalAlpha = Math.sin(Math.PI * ph) * (1 - p * 0.5); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2 * k; c.lineCap = 'round';
        draw(x, y, 4 * k);
      }
      c.lineCap = 'butt'; c.globalAlpha = 1;
    },
    heal(c, f, p, k) {
      const g = above(f.at, 0);
      c.globalAlpha = (1 - p) * 0.8; c.strokeStyle = '#a8e890'; c.lineWidth = 2.5 * k; c.beginPath(); c.ellipse(g.x, g.y, (10 + 16 * p) * k, (5 + 8 * p) * k, 0, 0, 6.3); c.stroke();
      PAINT.rising(c, f, p, k, '#b8f0a0', (x, y, r) => { c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); c.stroke(); });
    },
    cheer(c, f, p, k) { PAINT.rising(c, f, p, k, '#ffd27a', (x, y, r) => { c.beginPath(); c.moveTo(x - r, y + r * 0.6); c.lineTo(x, y - r * 0.6); c.lineTo(x + r, y + r * 0.6); c.stroke(); }); },
    bubbles(c, f, p, k) { PAINT.rising(c, f, p, k, '#9fdc5a', (x, y, r) => { c.beginPath(); c.arc(x, y, r * 0.6, 0, 6.3); c.stroke(); }); },
    droop(c, f, p, k) {
      const a = above(f.at, 44);
      for (let i = 0; i < 3; i++) {
        const ph = (p + i * 0.2) % 1, x = a.x + (i - 1) * 9 * k, y = a.y + ph * 26 * k;
        c.globalAlpha = Math.sin(Math.PI * ph); c.strokeStyle = '#c79af0'; c.lineWidth = 2 * k; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x - 4 * k, y - 3 * k); c.lineTo(x, y + 3 * k); c.lineTo(x + 4 * k, y - 3 * k); c.stroke();
      }
      c.lineCap = 'butt'; c.globalAlpha = 1;
    },
    reticle(c, f, p, k) {
      const a = above(f.at, 20), r = (30 - 18 * Math.min(1, p * 1.5)) * k;
      c.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3; c.strokeStyle = '#ff6a55'; c.lineWidth = 2 * k;
      c.beginPath(); c.arc(a.x, a.y, r, 0, 6.3); c.stroke();
      c.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(a.x + dx * r * 0.6, a.y + dy * r * 0.6); c.lineTo(a.x + dx * r * 1.35, a.y + dy * r * 1.35); } c.stroke();
      c.globalAlpha = 1;
    },
    stars(c, f, p, k) {
      const a = above(f.at, 46);
      c.fillStyle = '#ffe27a'; c.globalAlpha = 1 - p * p;
      for (let i = 0; i < 3; i++) { const t = p * 5 + i * 2.094, x = a.x + Math.cos(t) * 12 * k, y = a.y + Math.sin(t) * 4 * k; c.beginPath(); for (let j = 0; j < 5; j++) { const q = j * 1.2566 - 1.5708, r = j % 2 ? 2 * k : 4.5 * k; c.lineTo(x + Math.cos(q) * r, y + Math.sin(q) * r); const q2 = q + 0.628; c.lineTo(x + Math.cos(q2) * 2 * k, y + Math.sin(q2) * 2 * k); } c.closePath(); c.fill(); }
      c.globalAlpha = 1;
    },
    dust(c, f, p, k) {
      const a = above(f.at, 2);
      c.fillStyle = '#d8cdb8';
      for (let i = 0; i < 6; i++) { const t = i * 1.047 + f.seed * 3, d = (6 + 22 * p) * k; c.globalAlpha = (1 - p) * 0.7; c.beginPath(); c.arc(a.x + Math.cos(t) * d, a.y + Math.sin(t) * d * 0.5 - p * 6 * k, (5 - 3 * p) * k, 0, 6.3); c.fill(); }
      c.globalAlpha = 1;
    },
    // A ring that spreads over the ground from someone: a ward on all friends, a howl at all foes.
    ring(c, f, p, k, col) {
      const g = above(f.at, 0), r = (f.tiles || 2) * G.tw * 0.5 * p * k;
      c.globalAlpha = (1 - p) * 0.9; c.strokeStyle = col; c.lineWidth = 3 * k;
      c.beginPath(); c.ellipse(g.x, g.y, r, r * 0.5, 0, 0, 6.3); c.stroke();
      c.globalAlpha = (1 - p) * 0.4; c.beginPath(); c.ellipse(g.x, g.y, r * 0.7, r * 0.35, 0, 0, 6.3); c.stroke();
      c.globalAlpha = 1;
    },
    ward_ring(c, f, p, k) { PAINT.ring(c, f, p, k, f.col || '#9fd0ff'); },
    wail(c, f, p, k) { PAINT.ring(c, f, p, k, f.col || '#ff8a70'); },
  };
  function drawFx(c, t) {
    S.fx = S.fx.filter(f => t - f.t0 < f.ms);
    for (const f of S.fx) {
      const paint = PAINT[f.kind];
      if (paint) paint(c, f, Math.max(0, Math.min(1, (t - f.t0) / f.ms)), G.scale);
    }
  }
  // Something leaves the user for a place and is waited for; then what it does on arriving.
  async function launch(look, from, to) {
    const far = Math.hypot(to.x - from.x, to.y - from.y), quick = look === 'spark' || look === 'thunder', ms = quick ? 280 : Math.max(200, Math.min(520, 95 * far));
    fx(look, from, ms, { to: { x: to.x, y: to.y }, far });
    await wait(quick ? 150 : ms);
    if (BLOOMS[look]) fx(BLOOMS[look][0], to, BLOOMS[look][1]);
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
      Object.assign(v, { x: u.x, y: u.y, face: u.face, hp: u.hp, block: u.block, st: { ...u.st }, gone: u.down && u.side !== 'player', lying: u.down && u.side === 'player', alpha: u.down && u.side !== 'player' ? 0 : 1, walking: false, lx: 0, ly: 0 });
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
        const user = e.unit(S.state, ev.id);
        const look = lookOf({ x: Math.round(v.x), y: Math.round(v.y), side: user.side, abilities: user.abilities }, ev), aimed = ev.x !== Math.round(v.x) || ev.y !== Math.round(v.y);
        sfx(soundOf(user, ev, look));
        S.cast = look;
        if (aimed) {
          const dx = Math.sign(ev.x - v.x) * 0.22, dy = Math.sign(ev.y - v.y) * 0.22;
          await tween(v, { lx: dx, ly: dy }, 90);
          // What flies is waited for, so the hit lands when it arrives.
          if (FLIES[look] && !still()) await launch(look, { x: v.x, y: v.y }, { x: ev.x, y: ev.y });
          await tween(v, { lx: 0, ly: 0 }, 110);
        } else {
          if (RINGS[look]) fx('wail', v, 520, { tiles: 2.4, col: RINGS[look] });
          await wait(160);
        }
      } else if (ev.type === 'hit') {
        v.flash = now() + 240; v.hp = ev.hp;
        fx(LANDS_AS[S.cast] || 'slash', v, 300);
        if (ev.dmg >= 20 || ev.side === 'back') S.shake = now() + 180;
        float(v, '−' + ev.dmg, '#ffd9d0', true);
        if (ev.side !== 'front') float(v, ev.side === 'back' ? 'From behind!' : 'Flanked', '#ffd27a');
        if (ev.blocked) float(v, 'blocked ' + ev.blocked, '#9fd0ff');
        v.block = Math.max(0, (v.block || 0) - ev.blocked);
        say(`${name(ev.id)} takes ${ev.dmg}${ev.side === 'back' ? ', struck from behind' : ev.side === 'side' ? ', flanked' : ''}.`);
        await wait(360);
      } else if (ev.type === 'block') { v.block = ev.block; fx('shield', v, 520); float(v, '🛡 +' + ev.amount, '#9fd0ff'); await wait(220); }
      else if (ev.type === 'heal') { v.hp = ev.hp; fx('heal', v, 800); float(v, '+' + ev.amount, '#a8e890', true); await wait(300); }
      else if (ev.type === 'status') {
        v.st[ev.name] = ev.now;
        fx({ bold: 'cheer', vulnerable: 'reticle', weak: 'droop', slow: 'ice', poison: 'bubbles', stun: 'stars' }[ev.name] || 'droop', v, 700);
        float(v, (STATUS[ev.name] || [ev.name])[0] + ' ' + ev.amount, '#fff3d6'); await wait(180);
      }
      else if (ev.type === 'push') { if (!ev.step) sfx('push'); await tween(v, { x: ev.to.x, y: ev.to.y }, 140); }
      else if (ev.type === 'poison') { v.hp = ev.hp; fx('bubbles', v, 700); float(v, '☠ −' + ev.amount, '#c8e070', true); await wait(300); }
      else if (ev.type === 'skip') { fx('stars', v, 900); float(v, 'Stunned', '#fff3d6'); say(`${name(ev.id)} is stunned and loses the turn.`); await wait(420); }
      else if (ev.type === 'down') {
        const foe = e.unit(S.state, ev.id).side === 'enemy';
        say(`${name(ev.id)} is down.`); sfx(foe ? 'down_foe' : 'down_friend'); fx('dust', v, 520);
        // A creature is gone; a citizen lies where they fell, and can be healed back up.
        if (foe) { await tween(v, { alpha: 0 }, 380); v.gone = true; }
        else { v.hp = 0; v.block = 0; v.st = {}; v.lying = true; float(v, 'Down', '#ffd9d0', true); await wait(380); }
      }
      else if (ev.type === 'raise') { v.lying = false; v.st = {}; fx('cheer', v, 800); float(v, 'Back up!', '#ffd27a', true); say(`${name(ev.id)} is back on their feet.`); await wait(260); }
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
      + `<div class="kwtc-banner" aria-hidden="true"></div><div class="kwtc-ask"></div>`
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
      const face = u.side === 'enemy' ? faceOf(u) : null;
      return `<span class="kwtc-chip is-${u.side}${i === 0 ? ' is-now' : ''}${face ? ' has-face' : ''}" title="${esc(u.name)}">${face ? `<img src="${esc(face)}" alt="" draggable="false">` : esc(u.icon || '•')}</span>`;
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
    const ails = Object.keys(STATUS).filter(s => (u.st[s] || 0) > 0).map(s => `<span class="kwtc-ail">${ASSETS.status[s] ? `<img class="kwtc-ic" src="/assets/tactics/status/${esc(ASSETS.status[s])}" alt="" draggable="false"> ` : ''}${esc(STATUS[s][0])} ${u.st[s]}</span>`).join('');
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
      if (l.heal != null) bits.push(l.raise ? `<b>stands back up with ${l.heal}</b>` : `<b>heals ${l.heal}</b>`);
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
      acts.innerHTML = `<div class="kwtc-kit">${(look.abilities || []).map(a => `<span class="kwtc-kit-a">${ico(a)} <b>${esc(a.name)}</b> ${esc(effectText(a))} <i>${esc(reachText(a))}</i></span>`).join('')}`
        + (look.locked || []).map(x => `<span class="kwtc-kit-a is-locked">🔒 <b>${esc(x.name)}</b> <i>at level ${x.at}</i></span>`).join('') + `</div>`
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
        + `<span class="kwtc-act-i" aria-hidden="true">${ico(x)}</span><span class="kwtc-act-n">${esc(x.name)}</span>`
        + `<span class="kwtc-act-t">${esc(why || effectText(x))}</span><span class="kwtc-act-r">${esc(reachText(x))}${x.quick ? ' · quick' : ''}${x.uses != null ? ` · ${x.uses - (u.used[x.key] || 0)} left` : ''}</span><kbd aria-hidden="true">${i + 1}</kbd></button>`;
    }).join('')
      // What this citizen has yet to learn, in its place in the row: greyed, with the class level that brings it.
      + (u.locked || []).map(x => `<div class="kwtc-act is-locked" aria-label="${esc(x.name)}: learned at ${esc(u.label || 'class')} level ${x.at}">`
        + `<span class="kwtc-act-i" aria-hidden="true">🔒</span><span class="kwtc-act-n">${esc(x.name)}</span><span class="kwtc-act-t">learned at level ${x.at}</span><span class="kwtc-act-r">${esc(u.label || '')} level ${u.class_level || 1} now</span></div>`).join('')
      + `<div class="kwtc-turn">${st.turn.moved && !st.turn.acted && !st.turn.quick ? `<button type="button" class="kw-btn quiet" data-kwt="undo">↶ Undo move</button>` : ''}`
      + (a || S.pick ? `<button type="button" class="kw-btn quiet" data-kwt="cancel">Cancel</button>`
        : `<button type="button" class="kw-btn quiet" data-kwt="auto" title="The party fights the rest of the battle by itself">Let them fight</button>`)
      + `<button type="button" class="kw-btn" data-kwt="end">End turn</button></div>`;
    // One steady line of guidance. What an action would do, and the buttons that confirm it, float over
    // the board (paintAsk), so this panel keeps its height and the board never jumps.
    hint.innerHTML = a ? `<div><b>${esc(a.name)}</b>: ${esc(a.desc || effectText(a))} ${a.target === 'self' || a.shape === 'around' ? 'Confirm to use it.' : 'Choose a marked target.'}</div>`
      : `<div>${esc(u.name)}'s turn. ${st.turn.moved ? '' : 'Blue tiles: where to walk. '}${st.turn.acted ? 'The action is used.' : 'Choose an action below.'}</div>`;
  }
  // What the chosen action would do to whoever is under the pointer (or was tapped), with Confirm on a
  // touch screen; or "Walk here?". Drawn over the top of the board; redrawn only when it changes.
  function paintAsk() {
    const box = S.el && S.el.querySelector('.kwtc-ask');
    if (!box || !S.state) return;
    const e = E(), st = S.state, u = e.current(st);
    let html = '';
    if (u && u.side === 'player' && !S.busy && st.status === 'active') {
      const ok = label => `<div class="kwtc-confirm"><button type="button" class="kw-btn primary" data-kwt="confirm">${label}</button><button type="button" class="kw-btn quiet" data-kwt="cancel">Cancel</button></div>`;
      if (S.mode === 'target' && S.ability) {
        const a = e.ability(u, S.ability), tile = S.pick || (S.pointer === 'mouse' ? S.hover : null), fore = tile ? forecastHtml(u, a, tile) : '';
        if (fore) html = fore + (S.pick ? ok('Confirm') : '');
      } else if (S.mode === 'idle' && S.pick) html = `<div class="kwtc-fore"><div>Walk here?</div></div>` + ok('Move here');
    }
    if (box._html === html) return;
    box._html = html;
    box.innerHTML = html ? `<div class="kwtc-ask-box">${html}</div>` : '';
  }
  function paint() { paintTop(); paintPanel(); paintAsk(); }

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
      // On the jukebox page nobody plays: the mind takes the party's turns too.
      if (u.side === 'player' && !S.demo) { S.cursor = { x: u.x, y: u.y }; S.mode = 'idle'; paint(); say(`${u.name}'s turn.`); sfx('turn'); return; }
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
        if (d.dungeon) b.dungeon = d.dungeon;      // a dungeon's battle that has ended: the run after it, what was found
        // What the battle taught, and any injury rolls; a repeated answer carries them in the battle's record.
        const kept = d.battle.result || {};
        if (d.rewards || kept.rewards) b.rewards = d.rewards || kept.rewards;
        if ((d.rolls && d.rolls.length) || (kept.rolls && kept.rolls.length)) b.rolls = d.rolls && d.rolls.length ? d.rolls : kept.rolls;
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
    // In a dungeon: what the fight gave, and whether the run goes on.
    const found = S.el.querySelector('.kwtc-found'), dn = b.dungeon;
    if (found && dn) {
      const f = dn.found, bits = f ? [f.wealth ? `${f.wealth} wealth` : ''].concat((f.items || []).map(i => `${i.qty} × ${i.name || i.item}`)).filter(Boolean) : [];
      found.textContent = (bits.length ? `Found: ${bits.join(', ')}. ` : '') + (dn.ended ? (dn.run && dn.run.status === 'cleared' ? 'The dungeon is cleared!' : '') : 'The way on is open.');
    }
    aftermath();
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
    if (S.demo || S.busy || !u || st.status !== 'active') return;
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

  // ── After the battle ──────────────────────────────────────────────────────
  // A big word over the board (Victory, Defeat), then the party: who they are
  // and, when it was won, what the battle taught each of them, the bar growing
  // as the number beside it counts down; when a run has ended, each injury roll
  // shown one at a time. The numbers come from the server's answer to the last
  // choice (lib/tactics_xp.js, lib/dungeons.js), so the screen waits for it.
  const SPLASH_MS = 1900;
  const SEVERITY = { none: ['Unhurt', 'good'], scratch: ['A scratch', 'warn'], wound: ['A wound', 'warn'], scar: ['A scar', 'bad'], crippling: ['Crippled', 'bad'], fatal: ['Died of their wounds', 'bad'] };
  const lvlOf = xp => { const KM = global.KWCareerMath; return KM && KM.levelProgress ? KM.levelProgress(xp) : null; };
  // A head and shoulders from the villager sheet, looking at the viewer; the class's emoji until it has loaded.
  function drawFaces() {
    const KV = global.KWVillagers, root = S.el;
    if (!root || !KV || !KV.meta || !KV.spriteFor) return;
    const s = KV.spriteFor(KV.meta, (S.setup && S.setup.species) || 'Mice', 'idle', 'sw');
    const img = s && sheet(s.url);
    if (!img) { if (s && S.open && !S.facesTried) { S.facesTried = true; global.setTimeout(drawFaces, 400); } return; }
    for (const cv of root.querySelectorAll('.kwtc-hero-face canvas')) {
      const c = cv.getContext('2d'), side = 44;
      c.imageSmoothingEnabled = false; c.clearRect(0, 0, cv.width, cv.height);
      c.drawImage(img, s.foot.x - side / 2, s.row * s.h + s.foot.y - 62, side, side, 0, 0, cv.width, cv.height);
      cv.parentNode.classList.add('has-art');
    }
  }
  function heroRows(st, won) {
    return st.units.filter(u => u.side === 'player').map(u => `<li class="kwtc-hero${u.down ? ' is-down' : ''}" data-cid="${esc(u.citizen_id || '')}">`
      + `<span class="kwtc-hero-face" style="--kwtc-class:${CLASS_COLOUR[u.cls] || CLASS_COLOUR.villager}"><i aria-hidden="true">${esc(u.icon || '•')}</i><canvas width="88" height="88" aria-hidden="true"></canvas></span>`
      + `<span class="kwtc-hero-who"><b>${esc(u.name)}</b><span class="kwtc-hero-cls">${esc(u.icon || '')} ${esc(u.label || u.cls || '')}${u.down ? ' · down' : ` · ${u.hp}/${u.maxHp}`}</span></span>`
      + `<span class="kwtc-hero-what">`
      + (won ? `<span class="kwtc-xp-line" hidden><span class="kwtc-xp-lvl"></span><span class="kwtc-xp" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="kwtc-xp-fill"></span></span><span class="kwtc-xp-gain" aria-live="off"></span></span>`
        + `<span class="kwtc-xp-note">…</span>` : '')
      + `<span class="kwtc-roll" hidden><b class="kwtc-roll-word"></b><span class="kwtc-roll-tale"></span></span>`
      + `</span></li>`).join('');
  }
  // One citizen's bar: from where they were to where they are, level by level.
  function growXp(li, r, delay) {
    const line = li.querySelector('.kwtc-xp-line'), note = li.querySelector('.kwtc-xp-note');
    if (!line) return Promise.resolve();
    const fill = line.querySelector('.kwtc-xp-fill'), bar = line.querySelector('.kwtc-xp'), gain = line.querySelector('.kwtc-xp-gain'), lvl = line.querySelector('.kwtc-xp-lvl');
    const from = Number(r.before.xp) || 0, to = Number(r.after.xp) || from, total = Math.round(r.gain) || 0;
    let level = r.before.level;
    const show = xp => {
      const p = lvlOf(xp) || (xp >= to ? { level: r.after.level, into: r.after.into, need: r.after.need, pct: r.after.need ? r.after.into / r.after.need : 1 } : { level: r.before.level, into: r.before.into, need: r.before.need, pct: r.before.need ? r.before.into / r.before.need : 1 });
      const pct = Math.max(0, Math.min(100, (p.need ? p.pct : 1) * 100));
      fill.style.width = pct.toFixed(1) + '%'; bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (p.level > level) {      // a level gained: say so, once for each
        level = p.level; li.classList.remove('is-up'); void li.offsetWidth; li.classList.add('is-up'); sfx('buff');
        if (!li.querySelector('.kwtc-up')) line.insertAdjacentHTML('afterend', '<span class="kwtc-up">Level up!</span>');
        // What that level taught (the class ladder), once the bar has reached it.
        for (const x of (r.learned || []).filter(x => x.at <= level && !li.querySelector(`.kwtc-learned[data-key="${x.key}"]`))) {
          (li.querySelector('.kwtc-hero-what') || li).insertAdjacentHTML('beforeend', `<span class="kwtc-learned" data-key="${esc(x.key)}">Learned: ${esc(x.icon || '')} <b>${esc(x.name)}</b></span>`);
        }
      }
      lvl.textContent = `${r.class_label}${r.own ? '' : ' training'} · level ${level}`;
      return p;
    };
    note.hidden = true; line.hidden = false;
    show(from); gain.textContent = '+' + total;
    return new Promise(resolve => {
      const settle = () => { const p = show(to); gain.textContent = p.need ? `${Math.round(p.into)} / ${p.need}` : 'Master'; gain.classList.add('is-done'); line.title = `+${total} experience`; resolve(); };
      if (still() || total <= 0) return settle();
      const ms = Math.max(900, Math.min(2400, 700 + total * 4));
      global.setTimeout(() => {
        const t0 = now();
        const step = () => {
          if (!S.open || !li.isConnected) return resolve();
          const q = Math.min(1, (now() - t0) / ms), e = 1 - Math.pow(1 - q, 2);
          show(from + (to - from) * e); gain.textContent = '+' + Math.max(0, Math.round(total * (1 - e)));
          if (q < 1) global.requestAnimationFrame(step); else settle();
        };
        step();
      }, delay || 0);
    });
  }
  // One citizen's injury roll: the words spin, then stop on what came of it.
  async function rollInjury(li, r) {
    const box = li.querySelector('.kwtc-roll');
    if (!box) return;
    const word = box.querySelector('.kwtc-roll-word'), tale = box.querySelector('.kwtc-roll-tale'), keys = Object.keys(SEVERITY).filter(k => !(r.no_fatal && k === 'fatal'));
    box.hidden = false; box.className = 'kwtc-roll is-rolling';
    if (!still()) {
      for (let i = 0, spins = 12 + Math.floor(Math.random() * 4); i < spins && S.open; i++) {
        word.textContent = SEVERITY[keys[i % keys.length]][0];
        if (i % 3 === 0) sfx('select');
        await wait(60 + i * 9);      // slowing as it comes to rest
      }
    }
    const [label, tone] = SEVERITY[r.severity] || SEVERITY.none;
    word.textContent = label + (r.body_part && r.severity !== 'none' && r.severity !== 'fatal' ? ` (${String(r.body_part).replace(/_/g, ' ')})` : '');
    tale.textContent = r.severity === 'none' ? 'Walked away from it.' : (r.narrative || '');
    box.className = 'kwtc-roll is-' + tone;
    sfx(r.severity === 'none' ? 'heal' : 'debuff');
    await wait(650);
  }
  // Run what there is to show, once the splash has gone and the server has answered. Each part runs once.
  async function aftermath() {
    const b = S.battle, A = S.after, root = S.el;
    if (!A || !A.ready || !root || !b) return;
    const rowOf = id => root.querySelector(`.kwtc-hero[data-cid="${id}"]`);
    const won = S.state.status === 'victory';
    if (won && !A.xp && b.rewards) {
      A.xp = true;
      const note = root.querySelector('.kwtc-end-note');
      if (note) note.textContent = b.rewards.kept ? '' : 'A practice field: this is what the battle would have taught. Nothing is kept.';
      A.busy = Promise.all((b.rewards.party || []).map((r, i) => { const li = rowOf(r.citizen_id); return li ? growXp(li, r, i * 160) : null; }));
      await A.busy;
    }
    if (!A.rolls && b.rolls && b.rolls.length && (!won || A.xp)) {
      A.rolls = true;
      if (A.busy) await A.busy;
      const head = root.querySelector('.kwtc-end-note');
      if (head && !won) head.textContent = 'Each of them rolls for what the defeat cost them.';
      else if (head) head.textContent = (head.textContent ? head.textContent + ' ' : '') + 'Whoever went down in the dungeon rolls for it now.';
      for (const r of b.rolls) { const li = rowOf(r.citizen_id); if (li && S.open) await rollInjury(li, r); }
    }
  }
  function finish() {
    const st = S.state, box = S.el && S.el.querySelector('.kwtc-end');
    if (!box || S.ended) return;
    if (S.demo) {      // no end screen: say how it went, and hand back to whoever is showing it
      S.ended = now(); S.busy = false;
      const cb = S.demoEnd, epoch = S.epoch;
      banner(st.status === 'victory' ? 'Victory' : 'Defeat');
      global.setTimeout(() => { if (S.open && S.epoch === epoch && cb) cb(st.status); }, 2200);
      return;
    }
    S.ended = now(); S.busy = false; S.mode = 'idle';
    music(false); sfx(st.status === 'victory' ? 'victory' : 'defeat');
    const secs = Math.round((S.ended - S.started) / 1000), won = st.status === 'victory', inDungeon = !!S.setup.dungeon;
    const left = st.units.filter(u => u.side === 'player' && !u.down), all = st.units.filter(u => u.side === 'player').length;
    S.after = { ready: false, xp: false, rolls: false, busy: null }; S.facesTried = false;
    box.innerHTML = `<div class="kwtc-splash is-${won ? 'won' : 'lost'}" aria-hidden="true"><span>${won ? 'Victory' : 'Defeat'}</span></div>`
      + `<div class="kw-box kwtc-end-box" role="group" aria-label="${won ? 'Victory' : 'Defeat'}"><div class="kw-box-title">${won ? '🏆 Victory' : '💀 Defeat'}</div>`
      + `<p class="kwtc-end-sum">${st.round} round${st.round === 1 ? '' : 's'} · ${st.stats.turns} of your turns · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</p>`
      + `<ul class="kwtc-roster">${heroRows(st, won)}</ul>`
      + `<p class="kwtc-end-note kw-note" role="status">${won ? '' : inDungeon ? 'The dungeon run is over.' : 'A practice field: nobody is hurt and nothing is lost.'}</p>`
      // Who is down comes along: a rest stands them up, and so does a heal in the next fight.
      + (inDungeon && won && left.length < all ? `<p class="kwtc-fallen">${esc(st.units.filter(u => u.side === 'player' && u.down).map(u => u.name).join(' and '))} ${all - left.length === 1 ? 'is' : 'are'} down, and will be carried on. A rest stands them up; so does healing them in the next fight.</p>` : '')
      + (inDungeon ? `<p class="kwtc-found" role="status"></p>` : '')
      + `<p class="kwtc-saved kw-note" role="status"></p>`
      // A dungeon's battle is not fought again from here: the only way on is back to the dungeon.
      + `<div class="kwtc-confirm">` + (inDungeon
        ? `<button type="button" class="kw-btn primary" data-kwt="close">${won ? 'Back to the dungeon' : 'See how it ended'}</button>`
        : `<button type="button" class="kw-btn primary" data-kwt="again">Same battle again</button><button type="button" class="kw-btn" data-kwt="new">A new field</button><button type="button" class="kw-btn quiet" data-kwt="close">Leave</button>`)
      + `</div></div>`;
    box.hidden = false;
    // The word first, over the battle as it ended; then the party.
    const quiet = still(), epoch = S.epoch;
    box.classList.toggle('is-splash', !quiet);
    paint();
    drawFaces();
    noteSaved();
    global.setTimeout(() => {
      if (!S.open || S.epoch !== epoch || !box.isConnected) return;
      box.classList.remove('is-splash');
      // The battle is over: the panel of abilities goes, and the party's box has the whole height.
      S.el.classList.add('is-over');
      S.after.ready = true;
      const b = box.querySelector('button'); if (b) b.focus();
      aftermath();
    }, quiet ? 0 : SPLASH_MS);
  }

  // ── Opening and closing ───────────────────────────────────────────────────
  function begin(setup) {
    const e = E();
    S.setup = setup; S.view = {}; S.floats = []; S.fx = []; S.cast = null; S.shake = 0; S.rot = 0; G.zoom = 1; G.px = 0; G.py = 0; S.faceAim = null; S.mode = 'idle'; S.ability = null; S.pick = null; S.info = null; S.hover = null; S.busy = false; S.ended = 0; S.round = 1;
    // A battle picked up again is played back to where it was; a new one starts with the creatures yet to move.
    const done = Array.isArray(setup.actions) ? setup.actions : [];
    S.state = done.length ? e.replay(setup, done).state : e.createBattle({ seed: setup.seed, land: setup.land, party: setup.party, enemies: setup.enemies });
    S.battle = { id: setup.battle_id || null, n: done.length, saved: done.length, status: 'active', queue: Promise.resolve() };
    S.epoch = (S.epoch || 0) + 1;
    syncView();
    S.started = now(); S.ended = 0; S.after = null;
  }
  // `hold`: a promise the first turn waits on (the curtain lifting), so nothing happens unseen.
  // opts (the jukebox page): { mount: an element to sit in, in place of the whole screen; demo: true, both sides
  // are played by the mind; onEnd(status): called a moment after it ends; sound: play the battle's sounds }.
  function open(setup, hold, opts) {
    if (!E()) return toast('⚠️ The battle engine did not load.');
    close(true);
    begin(setup);
    const el = doc.createElement('div');
    el.id = 'kw-tactics'; el.className = 'kwtc'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Tactics battle');
    el.innerHTML = shell();
    const o = opts || {};
    S.demo = !!o.demo; S.demoEnd = o.onEnd || null; S.demoSound = !!o.sound;
    if (S.demo) { el.classList.add('is-demo'); el.removeAttribute('aria-modal'); el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'A battle on the board, playing by itself'); }
    (o.mount || doc.body).appendChild(el);
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
      if ((t && t.x) !== (was && was.x) || (t && t.y) !== (was && was.y)) paintAsk();
    });
    S.canvas.addEventListener('pointerleave', () => { S.hover = null; paintAsk(); });
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
    if (!S.demo) S.canvas.focus();
    Promise.all([hold || Promise.resolve(), loadAssets()]).then(() => { if (S.open && S.el === el && !S.ended) { music(true); nextTurn(); } });
  }
  function rotate(by) { S.rot = (S.rot + by + 4) & 3; S.hover = null; layout(); say('The view is turned.'); }
  function onKey(ev) {
    const e = E(), st = S.state;
    if (!st || S.demo) return;
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
      S.hover = S.cursor; S.pointer = 'mouse'; paintAsk();
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
    // Whatever waited for the battle to be over (a memorial, say) happens now, unless another battle is taking its place.
    if (!quiet) for (const fn of LATER.splice(0)) { try { fn(); } catch (e) { /* its own trouble */ } }
  }
  // Run something once no battle is on the screen: at once if none is. The news of a death must not cover,
  // or give away, an injury roll that is still being shown.
  const LATER = [];
  function whenClosed(fn) { if (S.open || S.el) LATER.push(fn); else fn(); }
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
    try { const d = await jsonOf(await global.apiFetch('/api/tactics/battles/current')); return d && d.ok && d.battle && d.battle.source !== 'dungeon' ? d.battle : null; } catch (e) { return null; }
  }
  // ── Into a battle, and out of one ─────────────────────────────────────────
  // Something closes over whatever was on screen, the battle's name is shown
  // on it, and it opens onto the board. There are several ways of doing it
  // (ENTRANCES), chosen in Dev Tools while the owner decides which suits the
  // game; 'fade' is the quiet default. With reduced motion the screen simply
  // goes dark and then shows the board.
  const DARK = '#1d150d', PAPER = '#eadcbd';
  function curtain() {
    const el = doc.createElement('div');
    el.className = 'kwtc-curtain';
    el.innerHTML = '<canvas aria-hidden="true"></canvas><div class="kwtc-curtain-title" role="status"></div>';
    doc.body.appendChild(el);
    const cv = el.firstChild, dpr = Math.min(2, global.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(global.innerWidth * dpr)); cv.height = Math.max(1, Math.round(global.innerHeight * dpr));
    return { el, c: cv.getContext('2d'), w: cv.width, h: cv.height, dpr, title: el.lastChild };
  }
  // Run draw(p) for p from 0 to 1 over ms.
  function animate(ms, draw) {
    return new Promise(resolve => {
      const t0 = now();
      const step = () => { const p = Math.min(1, (now() - t0) / ms); draw(p); if (p < 1) global.requestAnimationFrame(step); else resolve(); };
      step();
    });
  }
  const ease = p => 1 - Math.pow(1 - p, 3), clamp01 = v => Math.max(0, Math.min(1, v));
  const rnd = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  // Each way in: cover(C, p) draws it closing (p = 1: nothing shows through);
  // reveal(C, p) draws it opening (p = 1: nothing is left). `paper`: the title sits on parchment.
  const ENTRANCES = {
    fade: { label: 'A fade through dark', inMs: 260, outMs: 340,
      cover(C, p) { const c = C.c; c.clearRect(0, 0, C.w, C.h); c.globalAlpha = p; c.fillStyle = DARK; c.fillRect(0, 0, C.w, C.h); c.globalAlpha = 1; },
      reveal(C, p) { this.cover(C, 1 - p); } },
    page: { label: 'A page turning', paper: true, inMs: 520, outMs: 520,
      // A sheet of parchment sweeps in from the right behind a slanted edge, and leaves to the left.
      sheet(C, left, right, slant) {
        const c = C.c;
        c.clearRect(0, 0, C.w, C.h);
        c.fillStyle = PAPER; c.beginPath(); c.moveTo(left + slant, 0); c.lineTo(right + slant, 0); c.lineTo(right - slant, C.h); c.lineTo(left - slant, C.h); c.closePath(); c.fill();
        for (const x of [left, right]) {      // the shadow each edge throws on what is under it
          if (x <= -C.w * 0.4 || x >= C.w * 1.4) continue;
          const dir = x === left ? -1 : 1, g = c.createLinearGradient(x, 0, x + dir * 46 * C.dpr, 0);
          g.addColorStop(0, 'rgba(20,12,6,0.45)'); g.addColorStop(1, 'rgba(20,12,6,0)');
          c.fillStyle = g; c.beginPath(); c.moveTo(x + slant, 0); c.lineTo(x + slant + dir * 46 * C.dpr, 0); c.lineTo(x - slant + dir * 46 * C.dpr, C.h); c.lineTo(x - slant, C.h); c.closePath(); c.fill();
        }
      },
      cover(C, p) { const sl = C.w * 0.12; this.sheet(C, (C.w + sl * 2) * (1 - ease(p)) - sl, C.w + sl * 2, p >= 1 ? 0 : sl); },
      reveal(C, p) { const sl = C.w * 0.12; this.sheet(C, -sl * 2, (C.w + sl * 2) * (1 - ease(p)) - sl, p <= 0 ? 0 : sl); } },
    tiles: { label: 'Tiles turning over', inMs: 620, outMs: 620,
      // The screen turns dark tile by tile, as the board's own diamonds, in a wave from the middle.
      wave(C, grow) {
        const c = C.c, tw = 112 * C.dpr, th = tw / 2, far = Math.hypot(C.w, C.h) / 2;
        c.clearRect(0, 0, C.w, C.h); c.fillStyle = DARK;
        for (let j = -1; j * th / 2 < C.h + th; j++) for (let i = -1; i * tw < C.w + tw; i++) {
          const x = i * tw + (j % 2 ? tw / 2 : 0), y = j * th / 2, q = grow(Math.hypot(x - C.w / 2, y - C.h / 2) / far);
          if (q <= 0) continue;
          const w = tw / 2 * q * 1.02, h = th / 2 * q * 1.02;
          c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + w, y); c.lineTo(x, y + h); c.lineTo(x - w, y); c.closePath(); c.fill();
        }
      },
      cover(C, p) { this.wave(C, d => clamp01(p * 2 - d)); },
      reveal(C, p) { this.wave(C, d => 1 - clamp01(p * 2 - d)); } },
    leaves: { label: 'Leaves blowing across', inMs: 760, outMs: 640,
      // A gust of autumn leaves crosses the screen as it darkens behind them; another carries the dark away.
      gust(C, t, dark, fade) {
        const c = C.c, cols = ['#c8642a', '#d9982e', '#8a9a3c', '#a8442a', '#e0b050'];
        c.clearRect(0, 0, C.w, C.h);
        c.globalAlpha = dark; c.fillStyle = DARK; c.fillRect(0, 0, C.w, C.h);
        for (let i = 0; i < 110; i++) {
          const along = (t * (0.9 + rnd(i, 1) * 0.8) + rnd(i, 2)) % 1.3, x = C.w * (-0.15 + along), y = C.h * rnd(i, 3) + Math.sin(t * 9 + i) * 26 * C.dpr;
          const r = (9 + rnd(i, 4) * 15) * C.dpr;
          c.save(); c.translate(x, y); c.rotate(t * 7 * (rnd(i, 5) - 0.5) * 2 + i);
          c.globalAlpha = fade; c.fillStyle = cols[i % cols.length];
          c.beginPath(); c.moveTo(-r, 0); c.quadraticCurveTo(0, -r * 0.7, r, 0); c.quadraticCurveTo(0, r * 0.7, -r, 0); c.fill();
          c.strokeStyle = 'rgba(60,30,10,0.45)'; c.lineWidth = Math.max(1, C.dpr); c.beginPath(); c.moveTo(-r * 0.8, 0); c.lineTo(r * 0.8, 0); c.stroke();
          c.restore();
        }
        c.globalAlpha = 1;
      },
      cover(C, p) { this.gust(C, p, clamp01((p - 0.2) / 0.7), clamp01(p * 5)); },
      reveal(C, p) { this.gust(C, 1 + p, 1 - clamp01(p / 0.6), 1 - clamp01((p - 0.5) / 0.5)); } },
    iris: { label: 'A closing circle', inMs: 440, outMs: 500,
      hole(C, r) {
        const c = C.c;
        c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, C.w, C.h); c.fillStyle = DARK; c.fillRect(0, 0, C.w, C.h);
        if (r > 0) { c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(C.w / 2, C.h / 2, r, 0, 6.3); c.fill(); c.globalCompositeOperation = 'source-over'; }
      },
      cover(C, p) { this.hole(C, (Math.hypot(C.w, C.h) / 2 + 4) * (1 - ease(p))); },
      reveal(C, p) { this.hole(C, (Math.hypot(C.w, C.h) / 2 + 4) * ease(p)); } },
    none: { label: 'Nothing: straight in' },
  };
  // The way in: a different one each battle, picked from all of them, unless
  // one is asked for (Dev Tools → Going in). Which one is the screen's own
  // business, so it is not drawn from the battle's seed.
  const WAYS = Object.keys(ENTRANCES).filter(k => k !== 'none');
  let lastWay = null;
  function entrance() {
    let key = null;
    try { key = global.localStorage.getItem('kwt_way'); } catch (e) { /* private window */ }
    key = key || loadPick().way;
    if (!ENTRANCES[key]) {
      const pool = WAYS.filter(k => k !== lastWay);
      key = pool[Math.floor(Math.random() * pool.length)] || 'fade';
    }
    lastWay = key;
    return { key, ...ENTRANCES[key] };
  }
  const FIGHT = { fight: 'A fight', elite: 'An elite fight', boss: 'The boss' };
  let entering = false;
  // Bring up a battle from a promise of its two sides.
  async function enter(setupPromise) {
    if (entering) return null;
    entering = true;
    const T = entrance();
    if (T.key === 'none') {      // straight in: no curtain, no title card
      try { const setup = await setupPromise; if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu(); open(setup); return setup; }
      finally { entering = false; }
    }
    const C = curtain(), quiet = still();
    try {
      loadAssets().then(() => sfx('start'));
      const closing = quiet ? (C.el.classList.add('is-solid'), wait(60)) : animate(T.inMs, p => T.cover(C, p));
      const [setup] = await Promise.all([setupPromise, closing]);
      if (!quiet) T.cover(C, 1);
      // The screen is covered: Dev Tools, where the battle was started, is put away behind it.
      if (typeof global.closeCheatMenu === 'function') global.closeCheatMenu();
      C.title.innerHTML = `<b>⚔ ${esc(setup.name || 'A battle')}</b><span>${esc(setup.skull || '')} ${esc(land(setup.land))} · ${esc(FIGHT[setup.fight] || 'A fight')}</span>`;
      C.title.classList.toggle('is-paper', !!T.paper && !quiet);
      C.title.classList.add('is-on');
      let lifted;
      open(setup, new Promise(r => { lifted = r; }));
      await new Promise(r => global.setTimeout(r, 700));      // long enough to read the name, with or without motion
      C.title.classList.remove('is-on');
      if (quiet) C.el.classList.remove('is-solid'); else await animate(T.outMs, p => T.reveal(C, p));
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
  // Open one of the town's battles by its id (the dungeon's "Fight" does this), part-played or not.
  async function openById(id) {
    const d = await jsonOf(await global.apiFetch(`/api/tactics/battles/${id}`));
    if (!d || !d.ok || !d.battle) throw new Error((d && d.error) || 'That battle could not be reached.');
    return enter(Promise.resolve(asSetup(d.battle)));
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
    // (A dungeon's battle is only stepped away from: it stays open, and fleeing is done from the dungeon's own screen.)
    const b = S.battle, inDungeon = !!(S.setup && S.setup.dungeon);
    if (!inDungeon && b && b.id && S.state && S.state.status === 'active') b.queue.then(() => global.apiFetch(`/api/tactics/battles/${b.id}/leave`, { method: 'POST' })).catch(() => {});
    S.el.classList.add('is-leaving');
    const after = inDungeon && b ? b.queue : Promise.resolve();
    global.setTimeout(() => { S.leaving = false; close(); if (inDungeon) after.then(() => { if (global.KWDungeon && global.KWDungeon.open) global.KWDungeon.open(); }); }, still() ? 0 : 300);
  }

  // ── Dev Tools → 💀 Dungeons → the tactics battle ──────────────────────────
  const DEV = { options: null, pick: null, open: null };
  const SLOTS = ['Front, left', 'Front, right', 'Back, left', 'Back, right'];
  function loadPick() {
    if (DEV.pick) return DEV.pick;
    let saved = null;
    try { saved = JSON.parse(global.localStorage.getItem('kwt_dev_pick') || 'null'); } catch (e) { /* private window */ }
    DEV.pick = Object.assign({ classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'skull', tier: 'green', terrain: 'forest', fight: 'first', seed: '', way: 'any' }, saved || {});
    return DEV.pick;
  }
  function devHtml(o, p) {
    if (!o) return `<div class="cheat-section-label" style="margin-top:10px">Tactics battle</div><div class="cheat-desc">Loading…</div>`;
    const sel = (id, list, val, label) => `<label>${esc(label)} <select class="ce-input" data-kwt-dev="${id}">${list.map(x => `<option value="${esc(x.key)}"${x.key === val ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>`;
    return `<div class="cheat-section-label" style="margin-top:10px">Tactics battle</div>`
      + `<div class="cheat-desc">A battle on a small board: walk, face, strike from behind or from above. It uses four of your grown-up citizens with the classes chosen here, costs nothing and changes nothing.</div>`
      + `<div class="kwdg-dev-row">${SLOTS.map((s, i) => sel('class' + i, o.classes.map(c => ({ key: c.key, label: `${c.icon} ${c.label}` })), p.classes[i], s)).join('')}</div>`
      + `<div class="kwdg-dev-row">${sel('level', o.levels, p.level, 'Their level')}${sel('tier', o.tiers.map(t => ({ key: t.key, label: `${t.skull} ${t.name}` })), p.tier, 'Skull')}`
      + `${sel('terrain', o.lands.map(l => ({ key: l, label: land(l) })), p.terrain, 'Land')}${sel('fight', o.fights, p.fight, 'Against')}${sel('band', o.bands || [{ key: '', label: 'Whoever lives in that land' }], p.band || '', 'Whose')}`
      + `<label>Seed <input class="ce-input" type="number" min="1" inputmode="numeric" placeholder="any" data-kwt-dev="seed" value="${esc(p.seed || '')}"></label>`
      + `${sel('way', [{ key: 'any', label: 'A different one each time' }].concat(Object.keys(ENTRANCES).map(k => ({ key: k, label: ENTRANCES[k].label }))), p.way || 'any', 'Going in')}</div>`
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
          await start({ classes: p.classes, level: p.level, tier: p.tier, terrain: p.terrain, fight: p.fight, band: p.band || undefined, seed: seed > 0 ? seed : undefined });
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
    start, resume, openById, open, close, leave, devMount, whenClosed,
    // A battle that plays itself inside an element (jukebox.html): demo(setup, element, { onEnd, sound }).
    demo: (setup, mount, o) => open(setup, null, { mount, demo: true, onEnd: o && o.onEnd, sound: !!(o && o.sound) }),
    // For the proofs and the browser checks.
    _state: S, _geom: G, _tapTile: tapTile, _choose: choose, _confirm: commit, _endTurn: endTurn, _tileXY: tileXY, _standXY: standXY, _tileAtPoint: tileAtPoint, _rotate: rotate, _view: view, _zoomAt: zoomAt, _askFacing: askFacing, _aimFace: aimFace, _faceSpots: faceSpots, _assets: ASSETS, _sfx: sfx, _auto: autoFinish, _send: send, _resync: resync, _lookOf: lookOf, _LOOK: LOOK, _PAINT: PAINT, _fx: fx, _ENTRANCES: ENTRANCES, _way: entrance, _tracksFor: tracksFor, _curtain: curtain,
    _devHtml: devHtml, _effectText: effectText, _reachText: reachText, _layout: layout, _begin: begin, _forecastHtml: forecastHtml, CLASS_COLOUR,
  };
})(typeof window !== 'undefined' ? window : globalThis);
