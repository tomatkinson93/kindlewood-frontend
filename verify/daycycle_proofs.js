'use strict';
// Spec 021 Phase 2 — frontend day cycle + KWClock proofs. Node, no deps.
//   node verify/daycycle_proofs.js [serverDir]
// serverDir defaults to $KW_SERVER_DIR, then ../kindlewood-server (for the
// byte-identity check; SKIPPED and reported if absent).
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MIN = 60e3, H = 60 * MIN, DAY = 24 * H;
const NOON = Date.parse('2026-11-05T12:00:00Z');
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
};

// A sandbox with controllable performance.now, localStorage and fetch.
function makeEnv(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {});
  const posts = [];
  let perfNow = 0;
  const win = {
    __KW_NO_AUTOSTART: true,
    KINDLEWOOD_API: '',
    performance: { now: () => perfNow },
    matchMedia: () => ({ matches: !!opts.reducedMotion }),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    fetch: (url, o) => {
      if (o && o.method === 'POST') posts.push({ url, body: JSON.parse(o.body) });
      const r = opts.fetch ? opts.fetch(url, o) : { status: 403, body: null };
      return Promise.resolve({ ok: r.status === 200, status: r.status, json: () => Promise.resolve(r.body) });
    },
    document: { addEventListener() {}, hidden: false, getElementById: () => null, querySelectorAll: () => [] },
    console: { warn() {}, log: console.log },
    setInterval() { return 0; }, clearInterval() {},
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { Date, Math, JSON, Promise, Object, Number, String, isFinite, parseFloat, parseInt }));
  for (const f of opts.files || ['day-cycle.js', 'server-clock.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  return { ctx, win, store, posts, advancePerf: ms => { perfNow += ms; } };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // 1. Byte identity + hygiene
  {
    const sdir = process.argv[2] || process.env.KW_SERVER_DIR || path.join(ROOT, '..', 'kindlewood-server');
    const sf = path.join(sdir, 'lib', 'day_cycle.js');
    const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (!fs.existsSync(sf)) console.log('  ⚠ 1. SKIPPED byte identity — server not found at ' + sf);
    else check('1. js/day-cycle.js byte-identical to server lib/day_cycle.js', sha(sf) === sha(path.join(ROOT, 'js', 'day-cycle.js')));
    const src = ['day-cycle.js', 'server-clock.js'].map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n');
    check('1b. no Math.random in day-cycle.js / server-clock.js', !/Math\.random/.test(src));
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const iD = html.indexOf('/js/day-cycle.js?v='), iC = html.indexOf('/js/server-clock.js?v='), iS = html.indexOf('/js/seasons.js?v=');
    check('1c. index.html loads day-cycle → server-clock → seasons (deferred, versioned)', iD > 0 && iD < iC && iC < iS);
  }

  // 2. Pin to noon: live clock, day, zero lighting
  {
    const { win } = makeEnv(); const C = win.KWClock;
    C.pin(NOON);
    const L = C.lighting();
    check('2. pinned noon: now = wall, phase day, darkness & lightLevel 0',
          C.now() === NOON && C.wallNow() === NOON && C.phase().phase === 'day' && L.darkness === 0 && L.lightLevel === 0);
  }

  // 3. Override: jump, run, expire (+ persistence, onChange)
  {
    const { win, store } = makeEnv(); const C = win.KWClock;
    C.pin(NOON);
    const events = []; C.onChange(e => events.push(e.reason + (e.why ? ':' + e.why : '')));
    C.setOverride('phase:night');
    check('3a. phase:night → now() is night, wall unchanged', C.phase().phase === 'night' && C.wallNow() === NOON);
    check('3b. persisted to localStorage kw_dev_clock', JSON.parse(store.kw_dev_clock).mode === 'phase');
    const t1 = C.now();
    C.pin(NOON + 10 * MIN);
    check('3c. time keeps running under the override', C.now() === t1 + 10 * MIN);
    C.pin(NOON + 2 * H);
    check('3d. override expires after 2h → live, emits override:expired',
          C.override().mode === 'live' && C.now() === NOON + 2 * H && events.includes('override:expired') && !store.kw_dev_clock);
  }

  // 4. Composition + hour + moon
  {
    const { win } = makeEnv(); const C = win.KWClock;
    C.pin(NOON);
    C.setOverride('phase:night'); C.setOverride('moon:4');
    check('4a. Night then moon:4 → full-moon night', C.phase().phase === 'night' && C.moon().id === 'full');
    C.setOverride('live'); C.setOverride('hour:21.5');
    const c = win.KWDayCycle.clockAt(C.now());
    check('4b. hour:21.5 → 21:30', c.hour === 21 && c.minute === 30);
    check('4c. bad mode rejected', C.setOverride('phase:noon') === false);
  }

  // 5. Fast mode: 1 real minute = 24h
  {
    const { win } = makeEnv(); const C = win.KWClock;
    C.pin(NOON); C.setOverride('fast');
    const a = C.now(); C.pin(NOON + MIN);
    check('5. fast: one real minute advances 24h', C.now() - a === DAY);
  }

  // 6. Lighting tween 2.5s (0.6s reduced motion)
  for (const [rm, dur] of [[false, 2500], [true, 600]]) {
    const env = makeEnv({ reducedMotion: rm }); const C = env.win.KWClock;
    C.pin(NOON);
    C.setOverride('phase:night');
    const target = env.win.KWDayCycle.lightingAt(C.now());
    const l0 = C.lighting();
    env.advancePerf(dur / 2); const lm = C.lighting();
    env.advancePerf(dur / 2); const l1 = C.lighting();
    check(`6${rm ? 'b' : 'a'}. tween ${dur}ms: starts at day, mid-way between, ends at night target`,
          l0.darkness === 0 && lm.darkness > 0 && lm.darkness < target.darkness && l1.darkness === target.darkness);
  }

  // 7. Admin coupling
  {
    // Non-admin with a token: POST goes out, 403 ignored, override stays local.
    const env = makeEnv({ store: { kw_token: 'x' } }); const C = env.win.KWClock;
    C.pin(NOON); C.setOverride('phase:dusk'); await tick(); await tick();
    check('7a. non-admin: POST sent as offsetMs, 403 ignored, visual override kept',
          env.posts.length === 1 && typeof env.posts[0].body.offsetMs === 'number' && C.phase().phase === 'dusk');
    C.setOverride('live'); await tick();
    check('7b. live sends {clear:true}', env.posts[1] && env.posts[1].body.clear === true);
    // No token: nothing is posted.
    const anon = makeEnv(); anon.win.KWClock.pin(NOON); anon.win.KWClock.setOverride('phase:night'); await tick();
    check('7c. logged-out: no POST', anon.posts.length === 0);
    // Admin: server's expiry is adopted.
    const adm = makeEnv({ store: { kw_token: 'x' }, fetch: (u, o) => {
      const b = o && o.body ? JSON.parse(o.body) : {};
      return { status: 200, body: { isAdmin: true, debugOffsetMs: b.offsetMs || 0, debugExpiresAt: NOON + 2 * H - 1000, now: NOON } };
    } });
    adm.win.KWClock.pin(NOON); adm.win.KWClock.setOverride('phase:night'); await tick(); await tick();
    check('7d. admin: adopts server offset + expiry', adm.win.KWClock.override().expiresAt === NOON + 2 * H - 1000 &&
          adm.win.KWClock.phase().phase === 'night');
  }

  // 8. Sync offset from /time
  {
    const env = makeEnv({ fetch: () => ({ status: 200, body: { now: Date.now() + 5 * H } }) });
    await env.win.KWClock.sync();
    const d = env.win.KWClock.wallNow() - Date.now();
    check('8a. sync: wallNow follows server time (+5h here)', Math.abs(d - 5 * H) < 2000, Math.round(d / 1000) + 's');
    const bad = makeEnv({ fetch: () => ({ status: 500, body: null }) });
    await bad.win.KWClock.sync();
    check('8b. failed sync keeps offset 0 without throwing', bad.win.KWClock.serverOffset() === 0);
  }

  // 9. Phase / moon change events
  {
    const { win } = makeEnv(); const C = win.KWClock;
    const ev = []; C.onChange(e => ev.push(e.reason));
    C.pin(Date.parse('2026-11-05T22:59:00Z')); C.pin(Date.parse('2026-11-05T23:00:00Z'));
    C.pin(Date.parse('2026-11-06T10:59:00Z')); C.pin(Date.parse('2026-11-06T11:00:00Z'));
    check('9. onChange fires on phase change and on moon change', ev.includes('phase') && ev.includes('moon'));
  }

  // 10. Seasons read the synced wall clock, never the visual override
  {
    const env = makeEnv({ files: ['day-cycle.js', 'server-clock.js', 'seasons.js'] });
    const C = env.win.KWClock;
    const T = Date.parse('2026-11-10T03:00:00Z');
    C.pin(T); C.setOverride('moon:2'); C.setOverride('phase:day');
    const cur = vm.runInContext('calcCurrentSeason()', env.ctx), want = vm.runInContext('calcSeasonAt(' + T + ')', env.ctx);
    check('10. calcCurrentSeason() uses KWClock.wallNow(), ignoring the override', cur.index === want.index && cur.progress === want.progress);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
