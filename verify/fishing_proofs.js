'use strict';
// Server-authoritative fishing, client side (node, no deps). Drives the real
// js/fishing.js in a vm with a stub DOM, stub apiFetch and manual timers:
//   1. no fish table, no local roll, no client item building, no /inventory/add
//   2. cast → POST /api/fishing/cast; the bite uses the SERVER's catch
//   3. landing → POST /api/fishing/land {catchId, outcome:'caught'}; the result
//      shows the server's values; a server refusal shows its error
//   4. a lost fish (got away / snapped / failed) reports outcome 'lost'
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const src = fs.readFileSync(path.join(ROOT, 'js', 'fishing.js'), 'utf8');
const inv = fs.readFileSync(path.join(ROOT, 'js', 'inventory.js'), 'utf8');
check('1. no fish/junk tables, no local roll, no client-built inventory item',
      !/FISH_TABLE|JUNK_TABLE|_rollFish|FISH_SELL_VALUE|FISH_FOOD_VALUE|awardInventoryItem/.test(src));
check('1b. nothing on the client calls /api/inventory/add', !/\/api\/inventory\/add/.test(src + inv) && !/awardInventoryItem/.test(inv));

function env(landReply) {
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', style: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100 }), offsetWidth: 1 });
  const calls = [], timers = [];
  const CATCH = { kind: 'fish', id: 'pike', name: 'Pike', icon: '🦷', rarity: 'uncommon', difficulty: 6, flavour: 'Teeth.', foodValue: 8, sellValue: 18, sizeLabel: 'Medium' };
  const win = {
    document: { getElementById: el, addEventListener() {}, createElement: () => el('tmp' + Math.random()) },
    apiFetch: async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, body });
      let reply = { ok: true };
      if (/\/pool$/.test(url)) reply = { ok: true, season: { id: 'autumn', name: 'Autumn', emoji: '🍂' }, fish: [CATCH], catalogue: [CATCH] };
      if (/\/cast$/.test(url)) reply = { ok: true, catchId: 'c-1', biteDelayMs: 3456, catch: CATCH };
      if (/\/land$/.test(url)) reply = body.outcome === 'lost' ? { ok: true, granted: null } : landReply;
      return { ok: reply.ok !== false, status: reply.ok === false ? 409 : 200, json: async () => reply };
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, performance: { now: () => 0 },
    localStorage: { getItem: () => null, setItem() {} },
    Audio: function () { return { play: () => Promise.resolve(), pause() {}, loop: false, volume: 1 }; },
    citizensData: [], console,
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { Math, JSON, Promise, Object, Array, Number, String, Date, parseInt, parseFloat }));
  vm.runInContext(src, ctx, { filename: 'fishing.js' });
  const run = (code) => vm.runInContext(code, ctx);
  const flush = () => new Promise(r => setImmediate(r));
  return { ctx, run, calls, timers, els, flush, CATCH };
}

(async () => {
  // 2–3. cast → bite → land (granted)
  {
    const E = env({ ok: true, granted: { item_key: 'fish_pike', name: 'Pike', quantity: 1 } });
    E.run("_fishState = 'waiting'; _castInRippleZone = true; _startWaiting();");
    await E.flush();
    const cast = E.calls.find(c => /\/cast$/.test(c.url));
    const biteTimer = E.timers.find(t => t.ms === 3456);
    check('2. cast → POST /api/fishing/cast {ripple}; bite timer uses the server\'s delay', cast && cast.body.ripple === true && !!biteTimer);
    biteTimer.fn();
    check('2b. the bite is the server\'s catch', E.run('_currentFish.id') === 'pike' && E.run('_fishState') === 'biting');
    E.run("_fishState = 'active'; _catchSuccess();");
    await E.flush(); await E.flush();
    const land = E.calls.find(c => /\/land$/.test(c.url));
    const html = E.els['fishing-main-area'].innerHTML;
    check('3. landing → POST /api/fishing/land {catchId, outcome:"caught"} and nothing else',
          land && land.body.catchId === 'c-1' && land.body.outcome === 'caught' && Object.keys(land.body).length === 2);
    check('3b. the result shows the server\'s values', /Caught!/.test(html) && /\+8 food/.test(html) && /18 gold/.test(html) && /Medium/.test(html));
  }
  // 3c. server refuses (e.g. too quick) → its error, no "Caught!"
  {
    const E = env({ ok: false, error: 'Too quick — the fish is still fighting.' });
    E.run("_fishState = 'waiting'; _startWaiting();"); await E.flush();
    E.timers.find(t => t.ms === 3456).fn();
    E.run("_fishState = 'active'; _catchSuccess();"); await E.flush(); await E.flush();
    const html = E.els['fishing-main-area'].innerHTML;
    check('3c. a refused landing shows the server\'s reason, not a catch', /Too quick/.test(html) && !/Caught!/.test(html));
  }
  // 4. lost outcomes
  {
    const lostCount = async (trigger) => {
      const E = env({ ok: true, granted: null });
      E.run("_fishState = 'waiting'; _startWaiting();"); await E.flush();
      E.timers.find(t => t.ms === 3456).fn();
      trigger(E); await E.flush();
      return E.calls.filter(c => /\/land$/.test(c.url) && c.body.outcome === 'lost').length;
    };
    const gotAway = await lostCount(E => E.timers.find(t => t.ms === 1000).fn());           // missed the strike
    const snapped = await lostCount(E => E.run("_fishState = 'active'; _lineSnap();"));
    const failed = await lostCount(E => E.run("_fishState = 'active'; _catchFail();"));
    check('4. got away / line snapped / reel failed each report outcome "lost" once', gotAway === 1 && snapped === 1 && failed === 1,
          [gotAway, snapped, failed].join('/'));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
