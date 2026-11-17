// ══════════════════════════════════════════════════════════════════════════
//  KWWeather — the weather in the Home scene (docs/HOME_SCENE.md Part F,
//  F.5; step 21).
//
//  Looks only. The server rolls each town's day (lib/weather.js on the
//  server: a word for the day and four six-hour spells, seeded by the town
//  and the day) and sends it with the town; this module works out the spell
//  from the clock and draws it, so every device shows the same sky and
//  nothing here calls the server.
//
//  What is drawn (all by code until the art in docs/ART_GUIDE.md §8 arrives):
//    clouds    drifting across the sky, more and greyer in the wet
//    a tint    over the world on a grey or wet day
//    rain      streaks over the view; puddles on the ground, which stay for
//              the spell after
//    snow      falling over the view; a white cap along the top of every
//              picture (worked out from its outline, once) and a dusting
//              on the ground, which stay for the spell after
//  Leaves, blossom and seeds on the wind are js/home-ambient.js.
//
//  Movement is transform and opacity only. Under reduced motion the tint,
//  the clouds (still), the caps and the puddles stay; nothing falls.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const KINDS = ['clear', 'cloudy', 'rain', 'snow'];
  const LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow' };
  const ICON = { clear: '☀️', cloudy: '☁️', rain: '🌧️', snow: '🌨️' };
  const BEAT_MS = 2000, PUDDLES = 6;
  const S = { hold: null, timer: null, last: '' };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // The spell at a moment. `w`: the town's weather from the server
  // ({ spells, starts, spell_ms, before }). → { now, was } (clear without one).
  function at(w, ms) {
    if (!w || !Array.isArray(w.spells) || !w.spells.length) return { now: 'clear', was: 'clear' };
    const n = w.spells.length, len = Number(w.spell_ms) || 21600000, t0 = new Date(w.starts).getTime();
    const i = Math.floor((ms - t0) / len);
    if (!Number.isFinite(i) || i < 0) return { now: w.before || 'clear', was: w.before || 'clear' };
    // Past the day's end and no newer roll yet: the last spell holds.
    const j = Math.min(n - 1, i), ok = k => (KINDS.includes(k) ? k : 'clear');
    return { now: ok(w.spells[j]), was: ok(j > 0 ? w.spells[j - 1] : w.before) };
  }
  // What to draw. `wide`: the view's width in px. Pure.
  function look(now, was, wide = 1200) {
    const wet = now === 'rain' || now === 'snow', small = wide < 700;
    return {
      clouds: Math.round({ clear: 3, cloudy: 9, rain: 10, snow: 9 }[now] * (small ? 0.6 : 1)),
      grey: now === 'rain' ? 2 : now === 'cloudy' || now === 'snow' ? 1 : 0,
      tint: now === 'clear' ? null : now,
      fall: wet ? now : null,
      puddles: now === 'rain' || was === 'rain',
      lying: now === 'snow' || was === 'snow',
    };
  }

  // ── Now ─────────────────────────────────────────────────────────────────
  const town = () => { const g = global.gameData; return g && g.settlement ? g.settlement.weather : null; };
  const clock = () => { try { return global.KWClock && global.KWClock.now ? global.KWClock.now() : Date.now(); } catch (_) { return Date.now(); } };
  const spell = () => (S.hold ? { now: S.hold, was: S.hold } : at(town(), clock()));
  const now = () => spell().now;
  const reduced = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const homeOpen = () => typeof global._svIsOpen === 'function' && global._svIsOpen();

  // ── Drawing ─────────────────────────────────────────────────────────────
  const el = (cls, tag) => { const e = doc.createElement(tag || 'div'); e.className = cls; e.setAttribute('aria-hidden', 'true'); return e; };
  // A seeded 0..1 for things that should stay put through the day.
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function clouds(world, n) {
    let box = world.querySelector(':scope > .kww-clouds');
    if (!box) { box = el('kww-clouds'); world.appendChild(box); }
    const W = world.clientWidth || 2400;
    box.style.setProperty('--kww-w', (W + 700) + 'px');
    while (box.children.length > n) box.lastChild.remove();
    while (box.children.length < n) {
      const c = el('kww-cloud kww-cloud-' + (1 + Math.floor(Math.random() * 4)), 'span'), dur = 260 + Math.random() * 260;
      c.style.top = (2 + Math.random() * 15).toFixed(1) + '%';
      c.style.setProperty('--kww-s', (0.7 + Math.random() * 0.8).toFixed(2));
      c.style.animationDuration = dur.toFixed(0) + 's';
      c.style.animationDelay = (-Math.random() * dur).toFixed(0) + 's';
      box.appendChild(c);
    }
  }
  // Where snow lies on a picture: for each column, from the first solid pixel
  // down `depth` px (a little uneven), fading out at its lower edge.
  // `alpha(x, y)` → 0..255. → Uint8ClampedArray of w × h cap alphas. Pure.
  function capAlpha(w, h, alpha, depth) {
    const out = new Uint8ClampedArray(w * h);
    for (let x = 0; x < w; x++) {
      let top = -1;
      for (let y = 0; y < h; y++) if (alpha(x, y) > 128) { top = y; break; }
      if (top < 0) continue;
      const d = Math.max(3, Math.round(depth * (0.8 + 0.35 * Math.sin(x / 9) + 0.15 * Math.sin(x / 3.1))));
      for (let i = 0; i < d && top + i < h; i++) {
        if (alpha(x, top + i) <= 128) break;   // a gap under an overhang: stop there
        out[(top + i) * w + x] = i < d - 3 ? 255 : Math.round(255 * (d - i) / 4);
      }
    }
    return out;
  }
  // A white cap along the top of each building's picture.
  function capOn(img) {
    const w = img.clientWidth || img.width, h = img.clientHeight || img.height;
    if (!w || !h || !img.naturalWidth) return;
    try {
      const src = doc.createElement('canvas'); src.width = w; src.height = h;
      const g = src.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data;
      const a = capAlpha(w, h, (x, y) => px[(y * w + x) * 4 + 3], Math.max(7, Math.min(16, h * 0.05)));
      const c = el('kww-cap', 'canvas'); c.width = w; c.height = h;
      const cg = c.getContext('2d'), im = cg.createImageData(w, h);
      for (let i = 0; i < a.length; i++) if (a[i]) { const y = (i / w) | 0, shade = y > 0 && a[i - w] === 255 && a[i] < 255 ? 226 : 250; im.data[i * 4] = shade; im.data[i * 4 + 1] = shade + 3; im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = a[i]; }
      cg.putImageData(im, 0, 0);
      img.parentNode.appendChild(c);
    } catch (_) { /* a picture the canvas may not read: no cap */ }
  }
  function caps(view) {
    view.querySelectorAll('.sv-fg-layer:not(.sv-area-hidden) .kwh-art:not(.kww-capped):not(.kwh-ph)').forEach(a => {
      a.classList.add('kww-capped');
      a.querySelectorAll(':scope > img.kwh-day, :scope > .kwh-part > img.kwh-day').forEach(img => {
        if (img.complete && img.naturalWidth) capOn(img); else img.addEventListener('load', () => capOn(img), { once: true });
      });
    });
  }
  function puddles(view, on) {
    const L = view.querySelector('.sv-fg-layer:not(.sv-area-hidden)');
    if (!L) return;
    const have = L.querySelectorAll(':scope > .kww-puddle');
    if (!on) { have.forEach(p => p.remove()); return; }
    if (have.length || !L.clientWidth) return;
    const C = global.KWCast, area = global._svActiveAreaName ? global._svActiveAreaName() : 'town', w = town();
    const rand = seeded(((w && w.day) || 1) * 31 + area.length * 7);
    for (let i = 0; i < PUDDLES; i++) {
      const g = C && C._groundPoint ? C._groundPoint(area, rand) : { x: rand() * 100, y: 62 + rand() * 34 };
      const p = el('kww-puddle', 'span');
      p.style.left = g.x.toFixed(2) + '%'; p.style.top = g.y.toFixed(2) + '%';
      p.style.setProperty('--kww-s', (0.7 + rand() * 0.9).toFixed(2));
      L.appendChild(p);
    }
  }
  function beat() {
    const view = doc.getElementById('settlement-view'), world = doc.getElementById('sv-world');
    if (!view || !world || !homeOpen() || doc.hidden) return;
    const sp = spell(), k = look(sp.now, sp.was, view.clientWidth), still = reduced();
    view.setAttribute('data-weather', sp.now);
    view.classList.toggle('kww-lying', k.lying);
    view.classList.toggle('kww-still', still);
    clouds(world, k.clouds);
    if (!world.querySelector(':scope > .kww-tint')) { world.appendChild(el('kww-tint')); world.appendChild(el('kww-ground')); }
    let fall = view.querySelector(':scope > .kww-fall');
    if (k.fall && !still) {
      if (!fall) { fall = el('kww-fall'); fall.appendChild(el('kww-sheet kww-far', 'i')); fall.appendChild(el('kww-sheet kww-near', 'i')); const sc = view.querySelector(':scope > .sv-scene'); view.insertBefore(fall, sc ? sc.nextSibling : null); }
    } else if (fall) fall.remove();
    if (k.lying) caps(view);
    puddles(view, k.puddles);
    if (S.last !== sp.now) { S.last = sp.now; try { global.dispatchEvent(new global.CustomEvent('kw:weather', { detail: { now: sp.now, was: sp.was } })); } catch (_) { /* old engine */ } }
  }

  if (doc) {
    S.timer = setInterval(beat, BEAT_MS);
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) setTimeout(beat, 60); });
  }

  global.KWWeather = {
    KINDS, LABEL, ICON,
    now, was: () => spell().was,
    today: () => { const w = town(); return (w && w.today) || 'clear'; },
    wet: () => { const k = now(); return k === 'rain' || k === 'snow'; },
    label: k => LABEL[k || now()] || 'Clear',
    icon: k => ICON[k || now()] || ICON.clear,
    // A look at another sky (photo mode, tests); null for the real one.
    preview: k => { S.hold = KINDS.includes(k) ? k : null; beat(); },
    _at: at, _look: look, _capAlpha: capAlpha, _beat: beat,
  };
})(typeof window !== 'undefined' ? window : globalThis);
