'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  KWVillagers — pixel villagers in the Home scene (docs/HOME_SCENE.md §3).
//
//  Sheets, drawing and the style test (build step 2). One mouse walks a loop
//  through all eight directions in the real scene, and stands idle after
//  each lap, so the owner can judge pixel villagers against the backdrop.
//  The town's real villagers are js/villager-engine.js (step 5 on).
//
//  Turn it on with ?villagers=test in the address (remembered on this device;
//  ?villagers=off turns it off), or KWVillagers.styleTest(true) in the console.
//
//  Sheets: assets/sprites/villagers/<species>_<anim>.png and villagers.json,
//  made by scripts/pack_sprites.js. Until a sheet exists a placeholder mouse
//  is drawn. Pixel art is drawn at whole-number scale only (§3.1).
//
//  Hooks from js/settlement-view.js: sceneShown(layerEl), sceneHidden(),
//  setPaused(bool) (Build mode hides villagers).
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const DIRS = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
  const MIRROR = { w: 'e', e: 'w', nw: 'ne', ne: 'nw', sw: 'se', se: 'sw' };
  const BASE = '/assets/sprites/villagers/';
  const FLAG = 'kw_villagers';
  // Citizens carry the account's species name; sheets are named singular.
  const SPECIES_KEY = { mice: 'mouse', mouse: 'mouse', badgers: 'badger', badger: 'badger', otters: 'otter', otter: 'otter',
    moles: 'mole', mole: 'mole', foxes: 'fox', fox: 'fox', hares: 'hare', hare: 'hare' };
  const SPEED = { adult: 40, elder: 30, child: 55 };   // px a second (§3.4)

  // ── Pure helpers (verify/scene_proofs.js) ───────────────────────────────

  // Movement (screen y grows downward) → one of the 8 rows.
  function dirFromVector(dx, dy) {
    if (!dx && !dy) return 's';
    const a = Math.atan2(dy, dx) * 180 / Math.PI;      // E 0, S 90, W ±180, N −90
    const i = ((Math.round(a / 45) % 8) + 8) % 8;       // 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE
    return ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'][i];
  }

  function speciesKey(name) {
    return SPECIES_KEY[String(name || '').toLowerCase()] || String(name || 'mouse').toLowerCase();
  }

  // Which sheet, row and flip draw `species` doing `anim` towards `dir`.
  // Missing species → the mouse; missing animation → idle, then walk;
  // a direction the sheet lacks (meta.dirs) → its opposite, mirrored.
  function spriteFor(meta, species, anim, dir) {
    const all = (meta && meta.species) || {};
    const key = all[speciesKey(species)] ? speciesKey(species) : (all.mouse ? 'mouse' : Object.keys(all)[0]);
    const sp = all[key];
    if (!sp) return null;
    const animKey = sp.anims[anim] ? anim : (sp.anims.idle ? 'idle' : Object.keys(sp.anims)[0]);
    const a = sp.anims[animKey];
    const order = meta.order || DIRS;
    const has = d => !a.dirs || a.dirs.includes(d);
    let d = dir, flip = false;
    if (!has(d) && MIRROR[d] && has(MIRROR[d])) { d = MIRROR[d]; flip = true; }
    if (!has(d)) d = (a.dirs && a.dirs[0]) || 's';
    return { species: key, anim: animKey, url: a.url || (BASE + a.file), row: order.indexOf(d), flip,
      frames: a.frames, ms: a.ms || 200, w: sp.frame.w, h: sp.frame.h, foot: sp.foot || { x: sp.frame.w / 2, y: sp.frame.h } };
  }

  // The style test's loop: eight straight legs, one per direction, opposite
  // legs equal so it closes. Centred on (cx, cy) in layer pixels, and sized
  // to fit the layer (the loop is about 0.58 × as tall as it is long).
  // → [{ x, y, dir, len }]: each leg's start point, its direction and length.
  function loopPath(cx, cy, layerW, layerH) {
    const H = Math.max(60, Math.min(260, layerW * 0.2, (layerH || Infinity) * 0.24)), D = Math.round(H * 0.3), V = Math.round(H * 0.16);
    const r = Math.SQRT1_2;
    const legs = [['e', H, 1, 0], ['se', D, r, r], ['s', V, 0, 1], ['sw', D, -r, r], ['w', H, -1, 0], ['nw', D, -r, -r], ['n', V, 0, -1], ['ne', D, r, -r]];
    let x = 0, y = 0, minX = 0, maxX = 0, minY = 0, maxY = 0;
    const pts = legs.map(([dir, len, ux, uy]) => {
      const p = { x, y, dir, len, ux, uy };
      x += ux * len; y += uy * len;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      return p;
    });
    const ox = cx - (minX + maxX) / 2, oy = cy - (minY + maxY) / 2;
    return pts.map(p => ({ x: p.x + ox, y: p.y + oy, dir: p.dir, len: p.len, ux: p.ux, uy: p.uy }));
  }

  // Where the walker is `dist` px along the loop. → { x, y, dir }
  function along(path, dist) {
    const total = path.reduce((s, l) => s + l.len, 0);
    let d = ((dist % total) + total) % total;
    for (const l of path) {
      if (d <= l.len) return { x: l.x + l.ux * d, y: l.y + l.uy * d, dir: l.dir };
      d -= l.len;
    }
    const l = path[path.length - 1];
    return { x: l.x + l.ux * l.len, y: l.y + l.uy * l.len, dir: l.dir };
  }

  // ?villagers=test / ?villagers=off, remembered on this device.
  function flagFrom(search, stored) {
    const m = /[?&]villagers=([a-z]+)/i.exec(search || '');
    if (m) return m[1].toLowerCase() === 'off' ? null : 'test';
    return stored === 'test' ? 'test' : null;
  }

  // ── Placeholder sheets (until the owner's art is packed) ────────────────
  // A small pixel mouse in a green hood, 96 × 96 frames, 6 frames, 8 rows.
  function placeholderMeta() {
    const FW = 96, FH = 96, N = 6;
    const make = walking => {
      const c = document.createElement('canvas');
      c.width = FW * N; c.height = FH * 8;
      const g = c.getContext('2d');
      const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };
      DIRS.forEach((dir, row) => {
        for (let f = 0; f < N; f++) {
          const ox = f * FW, oy = row * FH;
          const bob = walking ? (f % 3 === 1 ? -2 : 0) : (f < 3 ? 0 : -1);
          const side = /e|w/.test(dir) ? (dir.includes('w') ? -1 : 1) : 0;
          const back = dir[0] === 'n';
          const cx = ox + 48, base = oy + 79 + bob;
          // tail
          px(cx - side * 14 - (side ? 0 : 10), base - 10, 3, 3, '#c98d8d');
          px(cx - side * 18 - (side ? 0 : 13), base - 7, 3, 3, '#c98d8d');
          // legs
          const step = walking ? [0, 2, 4, 0, -2, -4][f] : 0;
          px(cx - 7 + step, base - 2, 5, 5, '#6b4a2e');
          px(cx + 2 - step, base - 2, 5, 5, '#6b4a2e');
          // body and cloak
          px(cx - 11, base - 26, 22, 25, '#c69060');
          px(cx - 12, base - 26, 24, 18, back ? '#4f6a34' : '#5f7d3c');
          if (!back) px(cx - 6, base - 18, 12, 10, '#e9c9a4');
          // head
          const hx = cx - 12 + side * 4;
          px(hx, base - 48, 24, 22, '#c69060');
          px(hx - 2, base - 52, 28, 12, '#5f7d3c');                      // hood
          if (!back) {
            px(hx + 5 + side * 4, base - 40, 3, 3, '#20140c');            // eyes
            if (side === 0) px(hx + 16, base - 40, 3, 3, '#20140c');
            px(hx + 10 + side * 9, base - 34, 4, 3, '#a85a5a');            // nose
          }
          px(hx - 6, base - 50, 8, 8, '#d9a3a3');                          // ears
          px(hx + 22, base - 50, 8, 8, '#d9a3a3');
        }
      });
      return c.toDataURL('image/png');
    };
    return { order: DIRS, placeholder: true, species: { mouse: {
      frame: { w: FW, h: FH }, foot: { x: 48, y: 82 },
      anims: { walk: { frames: N, ms: 160, url: make(true) }, idle: { frames: N, ms: 260, url: make(false) } } } } };
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  let _meta = null, _loading = null;
  function load() {
    if (_meta) return Promise.resolve(_meta);
    if (_loading) return _loading;
    _loading = fetch(BASE + 'villagers.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(j => (_meta = j && j.species && Object.keys(j.species).length ? j : placeholderMeta()));
    return _loading;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('kwv-styles')) return;
    const s = document.createElement('style');
    s.id = 'kwv-styles';
    s.textContent = `
.kwv-villager { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; will-change: transform; transition: opacity 0.3s ease; }
.kwv-villager.kwv-gone { opacity: 0; }
.kwv-sprite { image-rendering: pixelated; image-rendering: crisp-edges; background-repeat: no-repeat; }
.kwv-sprite.kwv-flip { transform: scaleX(-1); }
.kwv-test-panel { position: absolute; left: 12px; bottom: 12px; z-index: 80; display: flex; gap: 6px; align-items: center;
  padding: 6px 10px; border-radius: 8px; background: rgba(20,14,8,0.78); color: #f3e2c0; font: 12px/1.3 system-ui, sans-serif; pointer-events: auto; }
.kwv-test-panel button { font: inherit; color: inherit; background: rgba(255,230,180,0.12); border: 1px solid rgba(255,230,180,0.3);
  border-radius: 5px; padding: 3px 8px; cursor: pointer; min-height: 28px; }
.kwv-test-panel button[aria-pressed="true"] { background: rgba(255,210,120,0.35); }
.kwv-test-panel .kwv-test-dir { min-width: 9.5em; }`;
    document.head.appendChild(s);
  }

  // One villager element: a box with a sprite inside. `button`: a real
  // button (the town's villagers, step 7); otherwise a picture (the test).
  function makeFigure(button) {
    const el = document.createElement(button ? 'button' : 'div');
    el.className = 'kwv-villager';
    if (button) el.type = 'button'; else el.setAttribute('aria-hidden', 'true');
    const sp = document.createElement('div');
    sp.className = 'kwv-sprite';
    el.appendChild(sp);
    const sh = document.createElement('span');   // the shadow at their feet (docs/ART_GUIDE.md §4.5)
    sh.className = 'kwv-shadow';
    el.appendChild(sh);
    return el;
  }

  function paint(el, s, frame, scale, x, y) {
    const sp = el.firstChild;
    const w = s.w * scale, h = s.h * scale;
    if (sp._url !== s.url) { sp.style.backgroundImage = `url("${s.url}")`; sp._url = s.url; }
    sp.style.width = w + 'px'; sp.style.height = h + 'px';
    sp.style.backgroundSize = (s.frames * w) + 'px ' + (8 * h) + 'px';
    sp.style.backgroundPosition = (-frame * w) + 'px ' + (-s.row * h) + 'px';
    sp.classList.toggle('kwv-flip', !!s.flip);
    const sh = el.querySelector('.kwv-shadow');
    if (sh) { sh.style.left = Math.round(s.foot.x * scale) + 'px'; sh.style.top = Math.round(s.foot.y * scale) + 'px'; sh.style.transform = scale !== 1 ? 'scale(' + scale + ')' : ''; }
    el.style.transform = `translate3d(${Math.round(x - s.foot.x * scale)}px, ${Math.round(y - s.foot.y * scale)}px, 0)`;
  }

  // ── The style test ──────────────────────────────────────────────────────
  const T = { on: false, layer: null, el: null, panel: null, raf: 0, paused: false, frozen: false, last: 0, dist: 0, idleLeft: 0, laps: 0, scale: 1, t: 0, shown: false };
  const LAP_IDLE_MS = 3000;
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function readFlag() {
    let stored = null;
    try { stored = localStorage.getItem(FLAG); } catch (_) {}
    const f = flagFrom(location.search, stored);
    try { if (/[?&]villagers=/i.test(location.search)) { if (f) localStorage.setItem(FLAG, f); else localStorage.removeItem(FLAG); } } catch (_) {}
    return f === 'test';
  }

  function panelHtml() {
    return '<b>Style test</b><span class="kwv-test-dir" aria-live="off"></span>'
      + '<button type="button" data-kwv="1" aria-pressed="true">1×</button>'
      + '<button type="button" data-kwv="2" aria-pressed="false">2×</button>'
      + '<button type="button" data-kwv="pause" aria-pressed="false">Pause</button>'
      + '<button type="button" data-kwv="off" aria-label="Turn the style test off">✕</button>';
  }

  function ensureTestDom() {
    injectStyles();
    if (!T.el) T.el = makeFigure();
    if (!T.panel) {
      T.panel = document.createElement('div');
      T.panel.className = 'kwv-test-panel';
      T.panel.innerHTML = panelHtml();
      T.panel.addEventListener('click', e => {
        const b = e.target.closest('button[data-kwv]');
        if (!b) return;
        const k = b.dataset.kwv;
        if (k === '1' || k === '2') {
          T.scale = Number(k);
          T.panel.querySelectorAll('[data-kwv="1"],[data-kwv="2"]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.kwv === k)));
          draw();
        } else if (k === 'pause') {
          T.frozen = !T.frozen;
          b.setAttribute('aria-pressed', String(T.frozen));
          b.textContent = T.frozen ? 'Play' : 'Pause';
        } else if (k === 'off') styleTest(false);
      });
    }
  }

  function geometry() {
    const w = T.layer.clientWidth, h = T.layer.clientHeight;
    return { w, h, path: loopPath(w * 0.5, h * 0.87, w, h) };
  }

  function draw() {
    if (!T.el || !T.layer || !_meta) return;
    const g = geometry();
    const idle = T.idleLeft > 0 || reducedMotion();
    const pos = idle ? along(g.path, 0) : along(g.path, T.dist);
    const dir = idle ? 's' : pos.dir;
    const s = spriteFor(_meta, 'Mice', idle ? 'idle' : 'walk', dir);
    if (!s) return;
    const frame = reducedMotion() ? 0 : Math.floor(T.t / s.ms) % s.frames;
    paint(T.el, s, frame, T.scale, pos.x, pos.y);
    T.el.style.zIndex = '1001';   // the test figure stays in front (depth is 1–1000)
    const label = T.panel && T.panel.querySelector('.kwv-test-dir');
    if (label) label.textContent = (idle ? 'idle, facing ' : 'walking ') + dir.toUpperCase() + (_meta.placeholder ? ' · placeholder art' : '');
  }

  function tick(now) {
    T.raf = 0;
    if (!running()) return;
    const dt = Math.min(100, T.last ? now - T.last : 0);
    T.last = now;
    if (!T.frozen) {
      T.t += dt;
      if (T.idleLeft > 0) T.idleLeft -= dt;
      else {
        const total = geometry().path.reduce((a, l) => a + l.len, 0);
        T.dist += SPEED.adult * dt / 1000;
        if (T.dist >= total) { T.dist -= total; T.laps++; T.idleLeft = LAP_IDLE_MS; }
      }
    }
    draw();
    if (!reducedMotion()) T.raf = requestAnimationFrame(tick);
  }

  function running() { return T.on && T.shown && !T.paused && !document.hidden && T.layer; }

  function sync() {
    const show = T.on && T.shown && !T.paused && T.layer;
    if (show) {
      ensureTestDom();
      if (T.el.parentNode !== T.layer) T.layer.appendChild(T.el);
      const scene = T.layer.closest('.sv-scene') || T.layer.parentNode;
      if (T.panel.parentNode !== scene) scene.appendChild(T.panel);
    } else {
      if (T.el && T.el.parentNode) T.el.remove();
      if (T.panel && T.panel.parentNode) T.panel.remove();
    }
    if (running()) {
      load().then(() => { if (running()) { draw(); if (!T.raf && !reducedMotion()) { T.last = 0; T.raf = requestAnimationFrame(tick); } } });
    } else if (T.raf) { cancelAnimationFrame(T.raf); T.raf = 0; }
  }

  function styleTest(on) {
    T.on = !!on;
    try { if (T.on) localStorage.setItem(FLAG, 'test'); else localStorage.removeItem(FLAG); } catch (_) {}
    sync();
    return T.on;
  }

  // The scene's hooks also drive the town's real villagers (js/villager-engine.js).
  const cast = () => window.KWCast;
  function sceneShown(layerEl) { T.layer = layerEl || T.layer; T.shown = true; sync(); if (cast()) cast().sceneShown(T.layer); }
  function sceneHidden() { T.shown = false; sync(); if (cast()) cast().sceneHidden(); }
  function setPaused(p) { T.paused = !!p; sync(); if (cast()) cast().setPaused(T.paused); }

  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', () => { if (running()) draw(); });
  T.on = readFlag();

  window.KWVillagers = {
    load, styleTest, sceneShown, sceneHidden, setPaused,
    get meta() { return _meta; },
    // For the engine: drawing and sheets.
    spriteFor, paint, makeFigure, injectStyles, dirFromVector, SPEED, reducedMotion,
    _dirFromVector: dirFromVector, _spriteFor: spriteFor, _loopPath: loopPath, _along: along, _flagFrom: flagFrom,
    _speciesKey: speciesKey, DIRS,
  };
})();
