// ══════════════════════════════════════════════════════════════════════════
//  KWAmbient — the small life of the Home scene (docs/HOME_SCENE.md Part F,
//  F.6 and F.7; weather, F.5, is js/home-weather.js).
//
//  Looks only: nothing here changes the game or calls the server.
//
//  Small life: chimney smoke from homes and workplaces with someone in,
//  fireflies at night, butterflies by day in the warm seasons, and on the
//  wind leaves in autumn, blossom in spring and seeds in summer. No birds, cats or pets (the
//  settlers are animals themselves).
//
//  Working buildings: with someone at work inside, the forge mouth glows and
//  throws sparks, the Workshop puffs sawdust, and the Tavern's windows
//  flicker in the evening. Each can have a quiet looping sound that grows as
//  the view pans near it and follows the sound-effects volume; the sound
//  files are the owner's to add (docs/ART_GUIDE.md §8), and until they are
//  there the scene is simply quiet.
//
//  Where the smoke, the fire and the sawdust come from is in the buildings'
//  manifest (smoke: [[x, y]…], fire: [x, y], dust: [x, y], in the picture's
//  own on-screen pixels).
//
//  Everything is a small element with a CSS animation (transform and
//  opacity only), at most MAX at once, none while Home is closed, the tab is
//  hidden, or the player asks for reduced motion.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const MAX = 28, BEAT_MS = 900;
  const KEEP = { firefly: 7, butterfly: 3, drift: 2 };
  const LIFE_MS = { smoke: 3800, spark: 900, dust: 1300, firefly: 6500, butterfly: 8000, leaf: 9000, blossom: 10000, seed: 11000 };
  const SOUNDS = { smithy: 'ambient/forge.mp3', tavern: 'ambient/tavern.mp3', market: 'ambient/market.mp3', workshop: 'ambient/workshop.mp3' };
  const S = { timer: null, sounds: {}, rand: Math.random, hold: null };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // What may be in the air. → { smoke, fireflies, butterflies, drift: 'leaf' | 'blossom' | 'seed' | null }
  function kindsFor(phase, season, weather = 'clear') {
    const wet = weather === 'rain' || weather === 'snow', dark = phase === 'night' || phase === 'dusk', warm = season === 'spring' || season === 'summer';
    return {
      smoke: true,
      fireflies: dark && !wet && season !== 'winter',
      butterflies: !dark && warm && !wet,
      drift: wet || dark ? null : season === 'autumn' ? 'leaf' : season === 'spring' ? 'blossom' : warm ? 'seed' : null,
    };
  }
  // Is a building showing signs of life? `inside`: villagers the scene has in
  // it; `home`: a home (lit in the evening when someone lives there);
  // `dark`: nobody lives there. Pure.
  function livedIn({ inside = 0, home = false, dark = false, phase = 'day' } = {}) {
    if (inside > 0) return true;
    return home && !dark && (phase === 'dusk' || phase === 'night' || phase === 'dawn');
  }
  // How loud a building's sound is: full when it is in the middle of the
  // view, silent a view-width away. `x`: its middle; `view`: { left, width }. Pure.
  function nearness(x, view) {
    const mid = view.left + view.width / 2, d = Math.abs(x - mid) / Math.max(1, view.width);
    return Math.max(0, Math.min(1, 1 - d));
  }

  // ── The scene ───────────────────────────────────────────────────────────
  const layer = () => doc.querySelector('#settlement-view .sv-fg-layer:not(.sv-area-hidden)');
  const homeOpen = () => typeof global._svIsOpen === 'function' && global._svIsOpen();
  const reduced = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const phase = () => S.hold || (global.KWCast && global.KWCast.phase) || 'day';
  const season = () => { try { return typeof global.calcCurrentSeason === 'function' ? (global.calcCurrentSeason().id || 'summer') : 'summer'; } catch (_) { return 'summer'; } };
  const weather = () => (global.KWWeather && global.KWWeather.now ? global.KWWeather.now() : 'clear');
  const count = (L, cls) => L.querySelectorAll(':scope > .' + cls).length;
  function put(L, cls, x, y, ms, z) {
    const e = doc.createElement('span');
    e.className = 'kwa ' + cls;
    e.style.left = Math.round(x) + 'px'; e.style.top = Math.round(y) + 'px';
    if (z != null) e.style.zIndex = String(z);
    e.style.setProperty('--kwa-r', (S.rand() * 2 - 1).toFixed(2));   // a little difference between one and the next
    L.appendChild(e);
    setTimeout(() => e.remove(), ms);
    return e;
  }
  // The buildings showing, each with its picture's place in the layer.
  function buildings(L) {
    const lr = L.getBoundingClientRect(), k = L.clientWidth ? lr.width / L.clientWidth : 1, H = global.KWHome, out = [];
    L.querySelectorAll(':scope > .sv-slot:not([hidden]) > .sv-building[data-kwh]:not(.kwbt-site):not(.kwh-prop)').forEach(btn => {
      const artEl = btn.querySelector('.kwh-art');
      if (!artEl || btn.classList.contains('kwb-min')) return;
      const key = btn.getAttribute('data-kwh'), artKey = btn.getAttribute('data-kwh-art') || key;
      const a = H && H.art ? H.art(artKey) : null;
      if (!a) return;
      const r = artEl.getBoundingClientRect();
      out.push({ key, btn, a, x: (r.left - lr.left) / k, y: (r.top - lr.top) / k, w: r.width / k, h: r.height / k,
        home: key === 'neighbourhood' || key.indexOf('house-') === 0, dark: btn.classList.contains('kwh-dark'), broken: btn.classList.contains('kwu-broken') });
    });
    return out;
  }
  function beat() {
    const L = homeOpen() && !doc.hidden && !reduced() ? layer() : null;
    if (!L || !L.clientHeight) { quiet(); return; }
    const ph = phase(), kinds = kindsFor(ph, season(), weather());
    const total = L.querySelectorAll(':scope > .kwa').length;
    const C = global.KWCast, list = buildings(L);
    const inside = key => { try { return C && C.inside ? C.inside(key).length : 0; } catch (_) { return 0; } };
    for (const b of list) {
      const n = b.broken ? 0 : inside(b.key), alive = !b.broken && livedIn({ inside: n, home: b.home, dark: b.dark, phase: ph });
      // Chimney smoke.
      if (alive && total < MAX) for (const [sx, sy] of b.a.smoke || []) if (S.rand() < 0.4) put(L, 'kwa-smoke', b.x + sx, b.y + sy, LIFE_MS.smoke, 1040);
      // The forge: a glow while someone works it, and sparks.
      if (b.a.fire) {
        let g = b.btn.querySelector('.kwa-forge');
        if (n > 0 && !g) { g = doc.createElement('span'); g.className = 'kwa-forge'; g.style.left = b.a.fire[0] + 'px'; g.style.top = b.a.fire[1] + 'px'; (b.btn.querySelector('.kwh-art') || b.btn).appendChild(g); }
        else if (!n && g) g.remove();
        if (n > 0 && total < MAX && S.rand() < 0.5) put(L, 'kwa-spark', b.x + b.a.fire[0] + (S.rand() - 0.5) * 16, b.y + b.a.fire[1] - 4, LIFE_MS.spark, 1045);
      }
      // Sawdust from the Workshop.
      if (b.a.dust && n > 0 && total < MAX && S.rand() < 0.35) put(L, 'kwa-dust', b.x + b.a.dust[0] + (S.rand() - 0.5) * 30, b.y + b.a.dust[1], LIFE_MS.dust, 1040);
      // The Tavern's windows flicker in the evening with someone in.
      if (b.key === 'tavern') b.btn.classList.toggle('kwa-flicker', n > 0 && (ph === 'dusk' || ph === 'night'));
      sound(b, n > 0 && !b.broken, L);
    }
    for (const key of Object.keys(S.sounds)) if (!list.some(b => b.key === key)) hush(key);
    // Fireflies, butterflies, and something on the wind.
    const W = L.clientWidth, Hh = L.clientHeight;
    const ground = () => { const g = C && C._groundPoint ? C._groundPoint(global._svActiveAreaName ? global._svActiveAreaName() : 'town', S.rand) : { x: S.rand() * 100, y: 60 + S.rand() * 35 }; return { x: g.x / 100 * W, y: g.y / 100 * Hh }; };
    if (kinds.fireflies && count(L, 'kwa-firefly') < KEEP.firefly && S.rand() < 0.7) { const p = ground(); put(L, 'kwa-firefly', p.x, p.y - 20 - S.rand() * 40, LIFE_MS.firefly, 1065); }
    if (kinds.butterflies && count(L, 'kwa-butterfly') < KEEP.butterfly && S.rand() < 0.4) {
      // Near a building's flowers, when there is one in view; else over the meadow.
      const b = list.length && S.rand() < 0.7 ? list[Math.floor(S.rand() * list.length)] : null, p = b ? { x: b.x + S.rand() * b.w, y: b.y + b.h - 10 } : ground();
      put(L, 'kwa-butterfly', p.x, p.y - 18, LIFE_MS.butterfly, 1042);
    }
    if (kinds.drift && count(L, 'kwa-' + kinds.drift) < KEEP.drift && S.rand() < 0.25) {
      const sc = doc.getElementById('sv-scene'), k = L.clientWidth ? L.getBoundingClientRect().width / L.clientWidth : 1;
      const left = sc ? sc.scrollLeft / k : 0;
      put(L, 'kwa-' + kinds.drift, left - 20, Hh * (0.3 + S.rand() * 0.5), LIFE_MS[kinds.drift], 1043);
    }
  }
  function quiet() { for (const key of Object.keys(S.sounds)) hush(key); }

  // ── Sounds of work (the files are the owner's to add) ───────────────────
  function sound(b, on, L) {
    const file = SOUNDS[b.key];
    if (!file) return;
    let s = S.sounds[b.key];
    if (!on) { if (s) hush(b.key); return; }
    if (s && s.missing) return;
    if (!s) {
      s = S.sounds[b.key] = { el: null, missing: false };
      try {
        const a = new global.Audio('/assets/audio/' + file);
        a.loop = true; a.volume = 0; a.preload = 'auto';
        a.addEventListener('error', () => { s.missing = true; });   // not there yet: stay quiet
        s.el = a;
      } catch (_) { s.missing = true; return; }
    }
    const sc = doc.getElementById('sv-scene'), k = L.clientWidth ? L.getBoundingClientRect().width / L.clientWidth : 1;
    const view = sc ? { left: sc.scrollLeft / k, width: sc.clientWidth / k } : { left: 0, width: L.clientWidth };
    const vol = (typeof global.getSfxVolume === "function" ? global.getSfxVolume() : 0.5) * 0.4 * nearness(b.x + b.w / 2, view);
    try { s.el.volume = Math.max(0, Math.min(1, vol)); if (vol > 0.01 && s.el.paused) { const p = s.el.play(); if (p && p.catch) p.catch(() => {}); } else if (vol <= 0.01 && !s.el.paused) s.el.pause(); } catch (_) { /* no sound */ }
  }
  function hush(key) { const s = S.sounds[key]; if (s && s.el) { try { s.el.pause(); } catch (_) { /* gone */ } } }

  if (doc) {
    S.timer = setInterval(beat, BEAT_MS);
    global.addEventListener('kw:home', e => { if (!(e.detail && e.detail.open)) quiet(); });
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) quiet(); });
  }

  global.KWAmbient = {
    MAX, KEEP, SOUNDS, LIFE_MS,
    _kindsFor: kindsFor, _livedIn: livedIn, _nearness: nearness, _beat: beat,
    // A look at another time of day (photo mode, tests).
    preview: p => { S.hold = p || null; },
    _seed: f => { S.rand = f || Math.random; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
