'use strict';
// Spec 021 Phase 4 — HUD dial + ambient audio proofs (node, no deps).
//   node verify/hudclock_proofs.js
//   1. Dial geometry: the sun sits at dialPoint(sunAt().arc) at 5 sample times.
//   2. The moon glyph equals moonAt().glyph for all 8 moon indices.
//   3. Labels / tooltip / upcoming phase changes.
//   4. Ambient (stubbed Audio): a phase change → exactly one crossfade, 8s.
//   5. Battle music ducks the bed to 20%, and it restores afterwards.
//   6. Beds stay silent before a gesture and off the game screen; a missing
//      file warns once.
//   7. Hygiene: no Math.random in hud-clock.js; script + stylesheet tags.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const H = 3600e3, DAY = 24 * H;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
};

// Minimal Audio stub: records play/pause, fires 'error' on demand.
function makeAudioClass(log) {
  return class FakeAudio {
    constructor(src) { this.src = src || ''; this.paused = true; this.volume = 1; this.loop = false; this._l = {}; log.push(this); }
    addEventListener(k, f) { (this._l[k] = this._l[k] || []).push(f); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    _fire(k) { (this._l[k] || []).forEach(f => f()); }
  };
}

function makeEnv(opts) {
  opts = opts || {};
  let perf = 0;
  const audios = [], warns = [];
  const screen = { classList: { contains: (c) => c === 'active' && !!opts.screenActive } };
  const docListeners = {};
  const win = {
    __KW_NO_AUTOSTART: true, KINDLEWOOD_API: '',
    performance: { now: () => perf },
    matchMedia: () => ({ matches: false }),
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem(k, v) { s[k] = String(v); }, removeItem(k) { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
    document: {
      hidden: false, readyState: 'complete',
      getElementById: (id) => id === 'screen-game' ? screen : null,
      addEventListener: (k, f) => { docListeners[k] = f; }, querySelectorAll: () => [],
    },
    console: { warn: (...a) => warns.push(a.join(' ')), log: console.log },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    location: { origin: '' },
  };
  win.window = win;
  win.Audio = makeAudioClass(audios);
  win.CustomEvent = function () {};
  win.dispatchEvent = () => {};
  const ctx = vm.createContext(Object.assign(win, { Date, Math, JSON, Promise, Object, Number, String, Array, isFinite, parseFloat, parseInt, isNaN }));
  for (const f of ['day-cycle.js', 'server-clock.js', 'hud-clock.js', 'audio.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  return { win, audios, warns, screen, docListeners, advance: (ms) => { perf += ms; }, setScreen: (on) => { opts.screenActive = on; } };
}

// ── 1–3. Dial ──────────────────────────────────────────────────────────────
{
  const { win } = makeEnv();
  const D = win.KWDayCycle, K = win.KWHudClock;
  const attr = (svg, body, a) => { const m = new RegExp('data-body="' + body + '"[^>]*\\s' + a + '="([-\\d.]+)"').exec(svg); return m ? parseFloat(m[1]) : null; };
  const samples = ['09:10', '11:00', '17:00', '22:30', '00:40'].map(h => Date.parse('2026-11-05T' + h + ':00Z'));
  let ok = true; const notes = [];
  for (const ms of samples) {
    const svg = K.dialSvg(ms), sun = D.sunAt(ms), p = K.dialPoint(sun.arc);
    const cx = attr(svg, 'sun', 'cx'), cy = attr(svg, 'sun', 'cy'), arc = attr(svg, 'sun', 'data-arc');
    const good = sun.up && Math.abs(arc - sun.arc) < 1e-9 && Math.abs(cx - p.x) <= 0.01 && Math.abs(cy - p.y) <= 0.01;
    if (!good) ok = false;
    notes.push(sun.arc.toFixed(3));
  }
  const ends = [K.dialPoint(0), K.dialPoint(0.5), K.dialPoint(1)];
  check('1. sun drawn at dialPoint(sunAt().arc) at 5 sample times', ok, 'arcs ' + notes.join(', '));
  check('1b. arc 0 / 0.5 / 1 = left horizon / zenith / right horizon',
        Math.abs(ends[0].x - 6) < 1e-9 && Math.abs(ends[0].y - 29) < 1e-9 && Math.abs(ends[1].y - 7) < 1e-9 && Math.abs(ends[2].x - 50) < 1e-9);
  const noonSvg = K.dialSvg(Date.parse('2026-11-05T17:00:00Z'));
  check('1c. no moon on the dial at midday; no sun at 03:00',
        !/data-body="moon"/.test(noonSvg) && !/data-body="sun"/.test(K.dialSvg(Date.parse('2026-11-05T03:00:00Z'))));

  let glyphs = true; const seen = [];
  for (let i = 0; i < 8; i++) {
    const ms = D.MOON_EPOCH_MS + i * DAY + 16 * H;          // 03:00 UTC of moon day i
    const m = D.moonAt(ms), svg = K.dialSvg(ms);
    const mm = /data-body="moon"[^>]*>([^<]+)<\/text>/.exec(svg);
    if (!mm || mm[1] !== m.glyph || m.index !== i) glyphs = false;
    seen.push(mm ? mm[1] : '∅');
  }
  check('2. moon glyph on the dial = moonAt().glyph for all 8 indices', glyphs, seen.join(''));

  const lab = (h) => K.labelFor(D.phaseAt(Date.parse('2026-11-05T' + h + ':00Z')));
  check('3. labels: Morning / Midday / Evening / Night / Small hours',
        lab('10:00') === 'Morning' && lab('13:00') === 'Morning' && lab('17:00') === 'Midday' &&
        lab('21:00') === 'Evening' && lab('00:00') === 'Evening' && lab('03:00') === 'Night' && lab('07:00') === 'Small hours');
  const tip = K.tooltip(Date.parse('2026-11-05T01:42:00Z'));
  check('3b. tooltip at 01:42 UTC: "Night ends in 7h 18m"', /^Hearth time · 01:42 UTC · your time .+\n.+ · Night ends in 7h 18m$/.test(tip), JSON.stringify(tip));
  const up = K.upcoming(Date.parse('2026-11-05T01:42:00Z'), 6);
  const want = [['dawn', '09:00'], ['day', '11:00'], ['dusk', '23:00'], ['night', '01:00'], ['dawn', '09:00'], ['day', '11:00']];
  check('3c. next 6 phase changes', up.length === 6 && up.every((u, i) => u.phase === want[i][0] && new Date(u.at).toISOString().slice(11, 16) === want[i][1]),
        up.map(u => u.phase + '@' + new Date(u.at).toISOString().slice(11, 16)).join(' '));
}

// ── 4–6. Ambient ───────────────────────────────────────────────────────────
{
  const E = makeEnv({ screenActive: true });
  const { win } = E, C = win.KWClock, A = win.KWAmbient;
  C.pin(Date.parse('2026-11-05T15:00:00Z'));            // day
  A.start();
  A._gesture();
  let st = A.state();
  check('4. on start the day bed is the only layer', st.layers.length === 1 && st.layers[0].phase === 'day' && st.crossfades === 0);
  E.advance(9000); A.tick();
  st = A.state();
  check('4b. after its fade-in it plays at the ambient volume', !st.layers[0].paused && Math.abs(st.layers[0].volume - A.getVolume()) < 1e-9,
        'vol ' + st.layers[0].volume.toFixed(3));

  C.pin(Date.parse('2026-11-05T23:05:00Z'));            // → dusk (KWClock emits a phase change)
  C._check();
  C._check();                                           // a repeat check must not re-trigger
  st = A.state();
  check('4c. a phase change triggers exactly one crossfade', st.crossfades === 1 && st.layers.length === 2 && st.layers[1].phase === 'dusk',
        'crossfades ' + st.crossfades);
  E.advance(4000); A.tick();
  st = A.state();
  const mid = st.layers.map(l => l.gain.toFixed(2)).join('/');
  E.advance(4200); A.tick();
  st = A.state();
  check('4d. 8s crossfade: halfway both beds at 0.5, then the old bed is dropped',
        mid === '0.50/0.50' && st.layers.length === 1 && st.layers[0].phase === 'dusk', 'mid ' + mid);

  win.playMusic('BATTLE');
  for (let i = 0; i < 8; i++) { E.advance(200); A.tick(); }
  st = A.state();
  check('5. battle music ducks the bed to 20%', Math.abs(st.duck - 0.2) < 1e-9 && Math.abs(st.layers[0].volume - A.getVolume() * 0.2) < 1e-9,
        'duck ' + st.duck.toFixed(2));
  win.stopMusic();
  E.audios.forEach(a => { if (a.src.indexOf('battle') >= 0) a.paused = true; });   // fade-out timer stubbed
  for (let i = 0; i < 8; i++) { E.advance(200); A.tick(); }
  st = A.state();
  check('5b. bed restores to full after the battle music stops', Math.abs(st.duck - 1) < 1e-9);
}
{
  const E = makeEnv({ screenActive: true });
  const { win } = E, C = win.KWClock, A = win.KWAmbient;
  C.pin(Date.parse('2026-11-05T15:00:00Z'));
  A.start();
  E.advance(1000); A.tick();
  check('6. nothing plays before a user gesture', A.state().layers.every(l => l.paused));
  E.docListeners.pointerdown();                          // first gesture
  check('6b. the first gesture starts the bed', A.state().layers.some(l => !l.paused));
  E.setScreen(false); A.tick();
  check('6c. leaving the game screen pauses the bed', A.state().layers.every(l => l.paused));
  const bed = E.audios.find(a => /ambient\/day\.mp3/.test(a.src));
  bed._fire('error'); bed._fire('error');
  check('6d. a missing bed is marked dead and warns once', A.state().layers[0].dead && E.warns.filter(w => /ambient/.test(w)).length === 1);
}

// ── 7. Hygiene ─────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'js', 'hud-clock.js'), 'utf8');
  check('7. no Math.random in hud-clock.js', !/Math\.random/.test(src));
  check('7b. no requestAnimationFrame loop in hud-clock.js', !/requestAnimationFrame/.test(src));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('7c. index.html loads hud-clock.js + hud-clock.css (versioned) and has the Ambient slider',
        /\/js\/hud-clock\.js\?v=/.test(html) && /\/css\/hud-clock\.css\?v=/.test(html) && /id="settings-ambient-volume"/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
