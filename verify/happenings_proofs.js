'use strict';
// Spec 021 Phase 6 — Happenings, client side (node, no deps).
//   node verify/happenings_proofs.js [serverDir]
//   1. client windows = server windows for every rule fixture (shared day cycle)
//   2. HUD list: next 48h, active highlighted, empty → ''
//   3. start toasts follow the REAL clock: a dev warp never fires one; no repeats
//   4. lanterns flourish: drawn at night while active, never by day (no-op kept)
//   5. Dev Tools tab wiring + no Math.random
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = require('./_harness');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HOUR = 3600e3, DAY = 24 * HOUR;
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

function makeEnv() {
  const toasts = [];
  const win = {
    __KW_NO_AUTOSTART: true, KINDLEWOOD_API: '', performance: { now: () => 0 }, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
    document: { addEventListener() {}, hidden: false, getElementById: () => null, readyState: 'complete' },
    console: { warn() {}, info() {}, log: console.log }, setInterval: () => 0, clearInterval() {},
    showToastNotification: (m) => toasts.push(m),
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { Date, Math, JSON, Promise, Object, Number, String, Array, isFinite, parseFloat, parseInt }));
  for (const f of ['day-cycle.js', 'happening-effects.js', 'server-clock.js', 'happenings.js']) vm.runInContext(read('js/' + f), ctx, { filename: f });
  return { win, toasts };
}

const FROM = Date.parse('2026-11-02T00:00:00Z'), TO = FROM + 14 * DAY;
const RULES = [
  { type: 'once', start: '2026-11-08T22:00:00Z', end: '2026-11-09T04:00:00Z' },
  { type: 'daily', start: '22:00', durationMin: 180 },
  { type: 'weekly', days: [1, 4], start: '14:00', durationMin: 180 },
  { type: 'rotating', start: '14:00', durationMin: 120, shiftHours: 8 },
  { type: 'phase', phases: ['night'] },
  { type: 'moon', moons: ['full'], phases: ['dusk', 'night'] },
];

(async () => {
  // 1. agreement
  {
    const sdir = process.argv[2] || process.env.KW_SERVER_DIR || path.join(ROOT, '..', 'kindlewood-server');
    const sf = path.join(sdir, 'lib', 'day_cycle.js');
    if (!fs.existsSync(sf)) console.log('  ⚠ 1. SKIPPED agreement — server not found at ' + sf);
    else {
      const S = require(sf);
      const { win } = makeEnv();
      const C = win.KWDayCycle;
      const same = RULES.every(r => JSON.stringify(C.windowsBetween(r, FROM, TO)) === JSON.stringify(S.windowsBetween(r, FROM, TO)) &&
                                    JSON.stringify(C.fairnessOf(r, FROM)) === JSON.stringify(S.fairnessOf(r, FROM)) &&
                                    JSON.stringify(C.validateRule(r)) === JSON.stringify(S.validateRule(r)));
      check('1. client and server compute identical windows, fairness and validation for every fixture', same);
    }
  }

  // 2. HUD list (48h from 14:30: three markets — day 3's 14:00 still overlaps — and two hunts)
  {
    const { win } = makeEnv();
    const K = win.KWHappenings;
    const t = Date.parse('2026-11-05T14:30:00Z');
    K._setDefsForTest([
      { id: 'market', title: 'Night Market', icon: '🏮', rule: { type: 'daily', start: '14:00', durationMin: 120 }, effects: [{ type: 'banner' }] },
      { id: 'hunt', title: 'Owl Hunt', icon: '🦉', rule: { type: 'daily', start: '20:00', durationMin: 60 }, effects: [] },
    ]);
    const up = K.upcoming(t, 48);
    const html = K.hudHtml(t);
    check('2. next 48h sorted by start, the running one marked active',
          up[0].h.id === 'market' && up[0].active && up[1].h.id === 'hunt' && !up[1].active && up.length === 5, up.length + ' windows');
    check('2b. HUD html highlights the active Happening with an ends-in countdown',
          /hc-hap hc-hap-active[\s\S]*Night Market[\s\S]*ends in 1h 30m/.test(html) && /Owl Hunt[\s\S]*in 5h 30m/.test(html));
    K._setDefsForTest([]);
    check('2c. nothing scheduled → empty (the clock panel shows its empty-state line)', K.hudHtml(t) === '');
  }

  // 3. toasts on the real clock
  {
    const { win, toasts } = makeEnv();
    const C = win.KWClock, K = win.KWHappenings;
    K._setDefsForTest([
      { id: 'market', title: 'Night Market', icon: '🏮', flavour: 'Stalls glow.', rule: { type: 'daily', start: '14:00', durationMin: 120 }, effects: [{ type: 'banner' }] },
      { id: 'quiet', title: 'Quiet Hour', icon: '🤫', rule: { type: 'daily', start: '14:00', durationMin: 60 }, effects: [] },   // no banner → no toast
    ]);
    C.pin(Date.parse('2026-11-05T13:59:30Z'));
    K._resetToastsForTest(); K._checkToasts();                    // baseline only
    C.setOverride('hour:14.5');                                    // dev warp past 14:00 — must NOT toast
    K._checkToasts();
    const afterWarp = toasts.length;
    C.pin(Date.parse('2026-11-05T14:00:20Z'));                     // the real clock crosses 14:00
    K._checkToasts();
    const afterStart = toasts.length;
    C.pin(Date.parse('2026-11-05T14:00:50Z')); K._checkToasts();   // later check — no repeat
    check('3. a dev time warp never fires a start toast', afterWarp === 0);
    check('3b. the real clock crossing the start fires exactly one toast, banner Happenings only',
          afterStart === 1 && toasts.length === 1 && /Night Market has begun/.test(toasts[0]), toasts.join(' | '));
    const { win: w2, toasts: t2 } = makeEnv();
    w2.KWHappenings._setDefsForTest([{ id: 'market', title: 'Night Market', rule: { type: 'daily', start: '14:00', durationMin: 120 }, effects: [{ type: 'banner' }] }]);
    w2.KWClock.pin(Date.parse('2026-11-05T14:30:00Z'));
    w2.KWHappenings._resetToastsForTest(); w2.KWHappenings._checkToasts(); w2.KWClock.pin(Date.parse('2026-11-05T14:31:00Z')); w2.KWHappenings._checkToasts();
    check('3c. loading the page mid-Happening doesn\'t toast it', t2.length === 0);
  }

  // 4. lanterns in the daylight pass
  {
    const LIT = ['day-cycle.js', 'happening-effects.js', 'server-clock.js', 'kwmap-core.js', 'kwmap-settlements.js', 'kwmap-daylight.js', 'happenings.js',
                 'kwmap-topdown.js', 'kwmap-assets.js', 'kwmap-iso.js', 'main.js'];
    const lanterns = [{ id: 'lantern_walk', title: 'Lantern Walk', rule: { type: 'phase', phases: ['night', 'dusk', 'dawn', 'day'] }, effects: [{ type: 'map_flourish', kind: 'lanterns' }] }];
    const frameAt = (ms, defs) => {
      const e = H.makeEnv();
      e.sandbox.__KW_NO_AUTOSTART = true; e.sandbox.matchMedia = () => ({ matches: false });
      H.loadTree(e, LIT);
      H.setUi(e, null, null, null, { q: 20, r: 15 });
      e.sandbox.KWClock.pin(ms);
      e.sandbox.KWHappenings._setDefsForTest(defs);
      e.logs.map.length = 0;
      vm.runInContext('KWMap.controller.renderFrame(1000);', e.context);
      return { log: e.logs.map.slice(), e };
    };
    const NIGHT = Date.parse('2026-11-05T03:00:00Z'), NOON = Date.parse('2026-11-05T12:00:00Z');
    const blits = (log) => log.filter(x => x[0] === 'drawImage').length;
    const nightOff = frameAt(NIGHT, []), nightOn = frameAt(NIGHT, lanterns);
    const settlements = nightOn.e.sandbox.KWDaylight.sourcesFor(nightOn.e.sandbox.KWMap.controller.active, 1400, 800).filter(s => s.light.settlement && s.light.id !== 'hostile').length;
    check('4. at night an active lanterns Happening adds 5 lantern lights per lit settlement',
          blits(nightOn.log) - blits(nightOff.log) === 5 * settlements, (blits(nightOn.log) - blits(nightOff.log)) + ' extra for ' + settlements + ' settlements');
    const noonOn = frameAt(NOON, lanterns), noonOff = frameAt(NOON, []);
    check('4b. by day the pass stays a no-op even with lanterns active', JSON.stringify(noonOn.log) === JSON.stringify(noonOff.log));
  }

  // 5. wiring + hygiene
  {
    const html = read('index.html');
    check('5. Dev Tools has the 🏮 Happenings tab + panel; scripts versioned',
          /cheatSwitchTab\('ct-happenings',this\);loadHappeningsAdmin\(\)/.test(html) && /id="ct-happenings"/.test(html) &&
          /\/js\/happenings\.js\?v=/.test(html) && /\/js\/happenings-admin\.js\?v=/.test(html));
    const src = read('js/happenings.js') + read('js/happenings-admin.js');
    check('5b. no Math.random in the Happenings files', !/Math\.random/.test(src));
    check('5c. start toasts read KWClock.wallNow (never the warped clock)', /function _checkToasts\(\) \{\s*const now = _wall\(\);/.test(read('js/happenings.js')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
