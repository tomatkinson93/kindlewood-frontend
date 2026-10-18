'use strict';
// Dev Tools admin-only UI (node, no deps). The server enforces requireAdmin
// on every Dev Tools route (kindlewood-server scripts/admin_gates_test.js);
// this checks the client side:
//   1. the ⚗ button ships hidden and only shows for KWClock.me().isAdmin
//   2. openCheatMenu refuses non-admins
//   3. KWClock forgets the admin flag when signed out, and loadGame re-syncs
//   4. Dev Tools item adds use the admin-only /api/inventory/cheat/add
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const html = read('index.html'), b = read('js/buildings.js'), main = read('js/main.js'), sc = read('js/server-clock.js');
check('1. ⚗ button ships hidden (style="display:none")', /class="btn-cheat"[^>]*style="display:none"/.test(html));
check('1b. button visibility follows KWClock.me().isAdmin on every sync', /function _syncCheatButton\(\)/.test(b) && /reason === 'sync'\) _syncCheatButton\(\)/.test(b) && /me && me\.isAdmin/.test(b));
check('2. openCheatMenu returns early for non-admins', /function openCheatMenu\(\) \{\s*if \(!_kwIsAdmin\(\)\) return;/.test(b));
check('3. loadGame re-syncs KWClock after login', /showScreen\('game'\);\s*renderTopbar\(\);\s*if \(window\.KWClock\) KWClock\.sync\(\);/.test(main));
check('4. Dev Tools item adds use /api/inventory/cheat/add', (b.match(/\/api\/inventory\/cheat\/add/g) || []).length === 2 && !/'\/api\/inventory\/add'/.test(b));

// 3b. behaviour: an admin /time/me is adopted, then dropped once signed out.
(async () => {
  const store = { kw_token: 'tok' };
  const me = { isAdmin: true, debugOffsetMs: 0 };
  const win = {
    __KW_NO_AUTOSTART: true, KINDLEWOOD_API: '', performance: { now: () => 0 }, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } },
    fetch: (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/\/time\/me$/.test(url) ? me : { now: Date.now() }) }),
    document: { addEventListener() {}, hidden: false }, console: { warn() {} }, setInterval() { return 0; },
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { Date, Math, JSON, Promise, Object, Number, String, isFinite, parseFloat, parseInt }));
  for (const f of ['day-cycle.js', 'server-clock.js']) vm.runInContext(read('js/' + f), ctx, { filename: f });
  await win.KWClock.sync();
  const signedIn = !!(win.KWClock.me() && win.KWClock.me().isAdmin);
  delete store.kw_token;
  await win.KWClock.sync();
  check('3b. KWClock.me() carries isAdmin when signed in and is cleared after sign-out', signedIn && win.KWClock.me() === null);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
