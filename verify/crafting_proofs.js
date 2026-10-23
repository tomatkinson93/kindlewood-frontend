'use strict';
// Crafting UI (js/crafting.js).
//   node verify/crafting_proofs.js
//   1. Odds and times shown match the shared maths the server rolls with.
//   2. Inputs: have/need per unit × quantity; short materials flagged.
//   3. The crafter's mark: quality, maker, named/Guardian tags; escaped.
//   4. The panel: crafters, queue, recipes (locked reasons, Named Blade input).
//   5. Wiring: tags, realtime handlers, settlement view, Career tab, Dev Tools,
//      inventory and Market show the mark.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

function makeEnv(routes) {
  const els = {}, toasts = [], calls = [];
  const mk = id => {
    const listeners = {};
    return {
      id, innerHTML: '', textContent: '', style: {}, dataset: {}, className: '', value: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); }, _listeners: listeners,
      querySelector: () => null, querySelectorAll: () => [],
    };
  };
  const doc = {
    getElementById: id => els[id] || (id === 'cf-overlay' ? null : (els[id] = mk(id))),
    createElement: () => new Proxy(mk(null), { set(t, k, v) { t[k] = v; if (k === 'id' && v) els[v] = t; return true; } }),
    body: { appendChild(c) { if (c.id) els[c.id] = c; return c; } },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  };
  const win = {
    document: doc, console, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, CSS: { escape: s => s },
    showBuildToast: (m, t) => toasts.push({ m, t }),
    apiFetch: async (p, o) => {
      const method = (o && o.method) || 'GET';
      calls.push({ method, p, body: o && o.body ? JSON.parse(o.body) : null });
      const h = routes[`${method} ${p}`] || routes[p];
      const data = typeof h === 'function' ? h(o) : h;
      return { ok: !(data && data.error), json: async () => data || {} };
    },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('js/career-math.js'), win);
  vm.runInContext(read('js/crafting.js'), win);
  return { win, els, toasts, calls };
}

const M = (() => { const c = {}; vm.createContext(c); vm.runInContext(read('js/career-math.js'), c); return c.KWCareerMath; })();

// ── 1. Odds & times ──
const bench = { level: 12, primary: 13, quality: 8, tool: 3, station: 2, speed: 0.1, statMult: 1.2, refund: 0, xp: 0 };
const recipe = { recipe_key: 'steel_sword', name: 'Steel Sword', min_level: 11, quality_cap: 'legendary', base_seconds: 7200, output_qty: 1,
  inputs: { resources: { metal: 30 }, items: [{ item_key: 'iron_ore', qty: 3 }] }, output_key: 'steel_sword' };
const { win } = makeEnv({});
const C = win.KWCrafting;
const odds = C.oddsFor(bench, recipe);
const expect = M.qualityOdds(M.qualityScore({ ...bench, minLevel: 11 }), 'legendary', 12);
check('odds shown are the server\'s odds', JSON.stringify(odds) === JSON.stringify(expect));
check('below Lv15 there is no legendary in the bar', odds.legendary === 0);
check('craft time from the shared formula', C.secondsFor(bench, recipe) === M.craftSeconds(7200, 0.1, 1.2));
check('times read naturally', C.fmtTime(45) === '45s' && C.fmtTime(1200) === '20m' && C.fmtTime(5460) === '1h 31m' && C.fmtTime(7200) === '2h');

// ── 2. Inputs ──
const st = { resources: { metal: 70, timber: 5 }, have: { iron_ore: 4 }, templates: { iron_ore: { name: 'Iron Ore', icon: '⚫' } } };
let n = C.needs(recipe, st, 2);
check('×2: 60 metal, 6 ore', n[0].need === 60 && !n[0].short && n[1].need === 6 && n[1].short && n[1].label === 'Iron Ore');
n = C.needs(recipe, st, 1);
check('×1: enough of everything', !n.some(x => x.short));

// ── 3. Mark ──
const mark = C.markHtml({ quality: 'fine', crafted_by: { name: 'Fenn <b>', settlement_name: 'Oakhollow' }, named: true, guardian: true });
check('mark: quality, maker and home', /Fine/.test(mark) && /made by Fenn &lt;b&gt; of Oakhollow/.test(mark));
check('mark: named and Guardian tags', /named/.test(mark) && /Guardian/.test(mark));
check('no mark on ordinary loot', C.markHtml({ sell_value: 4 }) === '' && C.markHtml(null) === '');
check('quality colours', C.qualityColour('legendary') && !C.qualityColour('nope'));

// ── 4. Panel ──
(async () => {
  const station = {
    ok: true, station: 'smithy', label: 'Smithy', class_key: 'blacksmith', class_label: 'Blacksmith', class_icon: '⚒️',
    level: 2, slots: 2, max_queue: 5, resources: { metal: 100, timber: 50 }, have: { iron_ore: 2 },
    templates: { iron_ore: { name: 'Iron Ore', icon: '⚫' } },
    recipes: [
      { ...recipe, recipe_key: 'iron_dagger', name: 'Iron Dagger', min_level: 1, base_seconds: 1200, inputs: { resources: { metal: 8, timber: 2 } },
        output: { item_key: 'iron_dagger', name: 'Iron Dagger', icon: '🗡️', equip_slot: 'weapon', stat_bonuses: { combat: 1 } } },
      { ...recipe, output: { item_key: 'steel_sword', name: 'Steel Sword', icon: '🗡️', equip_slot: 'weapon', stat_bonuses: { combat: 4 } }, spec: 'weaponsmith' },
    ],
    crafters: [
      { id: 7, name: 'Ysolde', level: 20, spec: 'weaponsmith', bench: { ...bench, level: 20 }, named_ready: true, queued: 1, can: { iron_dagger: null, steel_sword: null } },
      { id: 8, name: 'Bram', level: 2, spec: null, bench: { ...bench, level: 2 }, named_ready: false, queued: 0, can: { iron_dagger: null, steel_sword: 'Weaponsmiths only.' } },
    ],
    jobs: [
      { id: 1, citizen_id: 7, recipe_key: 'iron_dagger', name: 'Iron Dagger', status: 'active', started_at: new Date(Date.now() - 6e5).toISOString(), completes_at: new Date(Date.now() + 6e5).toISOString(), options: {} },
      { id: 2, citizen_id: 7, recipe_key: 'iron_dagger', name: 'Iron Dagger', status: 'done', quality: 'superior', result: { name: 'Superior Iron Dagger', icon: '🗡️' }, xp: 24, options: {} },
    ],
  };
  const env = makeEnv({ 'GET /api/crafting/station/smithy': station, 'POST /api/crafting/jobs': { ok: true, ids: [3], name: 'Ysolde', recipe: 'Iron Dagger' } });
  await env.win.KWCrafting.open('smithy');
  const head = env.els['cf-sub'].innerHTML, crafters = env.els['cf-crafters'].innerHTML, queue = env.els['cf-queue'].innerHTML, recipes = env.els['cf-recipes'].innerHTML;
  check('header: level and places', /Level 2/.test(head) && /<b>2<\/b> \/ 2/.test(head));
  check('crafters strip: both, first selected, queue pips, ✨ for the weaponsmith', /Ysolde/.test(crafters) && /Bram/.test(crafters) && /aria-selected="true"/.test(crafters) && /●○○○○/.test(crafters) && /✨/.test(crafters));
  check('queue: the active job with a timer and cancel', /data-left=/.test(queue) && /data-cf="cancel" data-id="1"/.test(queue) && /10m left/.test(queue));
  check('queue: recently made, in its quality colour', /Superior Iron Dagger/.test(queue) && /\+24 XP/.test(queue));
  check('recipes: odds bar and time', /cf-odds/.test(recipes) && /⏱ /.test(recipes));
  check('recipes: Named Blade input for a master weaponsmith', /data-name-for="iron_dagger"/.test(recipes));
  check('recipes: short materials disable Craft', /data-key="steel_sword" disabled/.test(recipes) && /cf-need short/.test(recipes));
  // Select Bram → the locked one explains itself.
  const ov = env.els['cf-overlay'];
  const click = target => ov._listeners.click[0]({ target: { closest: s => (s === '[data-cf]' ? target : null), id: '' } });
  await click({ dataset: { cf: 'sel', id: '8' } });
  const r2 = env.els['cf-recipes'].innerHTML;
  check('another crafter: locked recipes say why', /Weaponsmiths only/.test(r2) && /Not yet \(1\)/.test(r2) && !/data-name-for/.test(r2));
  await click({ dataset: { cf: 'craft', key: 'iron_dagger' } });
  const post = env.calls.find(c => c.method === 'POST');
  check('Craft posts the crafter, recipe and quantity', post && post.body.citizen_id === 8 && post.body.recipe_key === 'iron_dagger' && post.body.qty === 1 && !post.body.name);
  check('…and says so', env.toasts.some(t => /making/.test(t.m)));
  // Realtime
  env.win.KWCrafting.onEvent({ type: 'craft_done', name: 'Ysolde', station: 'smithy', item: { name: 'Fine Iron Dagger', icon: '🗡️', quality: 'fine' }, first: true });
  check('craft_done: a toast with the piece', env.toasts.some(t => /Ysolde made a Fine Iron Dagger — their first!/.test(t.m)));
  env.win.KWCrafting.onEvent({ type: 'craft_done', name: 'Clod', ruined: true, recipe: 'Iron Dagger' });
  check('ruined pieces say so', env.toasts.some(t => /ruined/.test(t.m) && t.t === 'error'));

  // ── 5. Wiring ──
  const html = read('index.html');
  check('index.html loads crafting.js and crafting.css', /js\/crafting\.js\?v=/.test(html) && /css\/crafting\.css\?v=/.test(html));
  check('crafting.js loads after career-math.js', html.indexOf('js/career-math.js') < html.indexOf('js/crafting.js'));
  check('Dev Tools: a Recipes tab and panel', /cheatSwitchTab\('ct-recipes'/.test(html) && /id="ct-recipes"/.test(html) && /id="ra-list"/.test(html));
  const rt = read('js/realtime.js');
  check('realtime: craft_done and craft_queue_updated', /craft_done\(ev\)/.test(rt) && /craft_queue_updated\(ev\)/.test(rt));
  const sv = read('js/settlement-view.js');
  check('settlement view: a Workshop slot, visual and Open button', /accepts:\['workshop'\]/.test(sv) && /workshop:\s+\{ emoji/.test(sv) && /openCrafting\(/.test(sv));
  check('Career tab: a Workshop button for crafting jobs', /data-cr="craft"/.test(read('js/careers.js')));
  check('inventory and Market show the mark', /KWCrafting\.markHtml/.test(read('js/inventory.js')) && /KWCrafting\.markHtml/.test(read('js/market.js')));
  const css = read('css/crafting.css');
  check('mobile layout stacks', /@media \(max-width: 760px\)/.test(css) && /grid-template-columns: 1fr/.test(css));
  check('reduced motion respected', /prefers-reduced-motion/.test(css));

  // ── 6. Finish-up: stall auto-listing, recipes to learn, schematics, shields ──
  {
    const st2 = JSON.parse(JSON.stringify(station));
    st2.recipes.push({ ...recipe, recipe_key: 'falchion', name: 'Falchion', min_level: 14, hidden: true, known: false, spec: 'weaponsmith',
      output: { item_key: 'falchion', name: 'Falchion', icon: '🗡️', equip_slot: 'weapon', stat_bonuses: { combat: 5 } } });
    st2.recipes.push({ ...recipe, recipe_key: 'tower_shield', name: 'Tower Shield', min_level: 15, hidden: true, known: true, spec: 'weaponsmith',
      output: { item_key: 'tower_shield', name: 'Tower Shield', icon: '🧱', equip_slot: 'shield', stat_bonuses: { combat: 3 }, item_effects: [{ type: 'injury', value: -7 }] } });
    st2.recipes.forEach(r => { r.hidden = !!r.hidden; r.known = r.known !== false; });
    st2.crafters.forEach(c => { c.can.falchion = 'Not known yet — study its schematic or discover it while crafting.'; c.can.tower_shield = null; });
    st2.jobs[0].options = { list: { markup: 0.25 } };
    st2.jobs[1] = { ...st2.jobs[1], listed: { price: 48, venue: 'smithy' }, discovered: 'Falchion' };
    st2.jobs.push({ id: 3, citizen_id: 7, recipe_key: 'iron_dagger', name: 'Iron Dagger', status: 'done', quality: 'basic', result: { name: 'Iron Dagger', icon: '🗡️' }, options: {},
      list_failed: 'All your stalls are full — wait for a sale or cancel a listing.' });
    const store = { kw_cf_list_smithy: '0.1' };
    const env = makeEnv({ 'GET /api/crafting/station/smithy': st2, 'POST /api/crafting/jobs': { ok: true, ids: [4], name: 'Ysolde', recipe: 'Iron Dagger' },
      'POST /api/crafting/schematics/55/study': { ok: true, recipe: 'Falchion', class_label: 'Blacksmith' } });
    env.win.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    await env.win.KWCrafting.open('smithy');
    const rec = env.els['cf-recipes'].innerHTML, q = env.els['cf-queue'].innerHTML;
    check('6a. stall control remembers this station\'s choice', /<option value="0\.1" selected>List at \+10%<\/option>/.test(rec));
    check('6b. a recipe the town hasn\'t learned sits under "Still to learn"', /📜 Still to learn \(1\)/.test(rec) && /Not known yet/.test(rec));
    check('6c. a learned hidden recipe is tagged', /📜 learned/.test(rec));
    check('6d. shields list their protection', /Injury risk/i.test(rec) || /−7|-7/.test(rec));
    check('6e. queue: 🏪 tag on jobs going to a stall', /🏪 \+25%/.test(q));
    check('6f. recently made: listed price, kept-home reason, a discovery', /On a stall at 48 gold/.test(q) && /Kept in the stores — All your stalls are full/.test(q) && /Worked out how to make Falchion/.test(q));
    const ov = env.els['cf-overlay'];
    await ov._listeners.click[0]({ target: { closest: s2 => (s2 === '[data-cf]' ? { dataset: { cf: 'craft', key: 'iron_dagger' }, disabled: false } : null), id: '' } });
    const post = env.calls.filter(c => c.method === 'POST').pop();
    check('6g. Craft sends the stall markup for equipment', post && post.body.list && post.body.list.markup === 0.1);
    await env.win.KWCrafting.study(55);
    check('6h. studying a schematic: posts and says who can make it now', env.calls.some(c => c.p === '/api/crafting/schematics/55/study') && env.toasts.some(t => /blacksmiths can now make Falchion/.test(t.m)));
    env.win.KWCrafting.onEvent({ type: 'recipe_discovered', name: 'Garnet', recipe: 'Falchion', station: 'smithy' });
    env.win.KWCrafting.onEvent({ type: 'schematic_found', source: 'expedition', item: { name: 'Schematic: Sledge', icon: '📜' } });
    env.win.KWCrafting.onEvent({ type: 'craft_done', name: 'Ysolde', station: 'smithy', item: { name: 'Fine Iron Dagger', icon: '🗡️', quality: 'fine' }, listed: { price: 30 } });
    check('6i. toasts: discovery, a schematic brought home, listed on a stall', env.toasts.some(t => /Garnet worked out how to make a Falchion/.test(t.m))
      && env.toasts.some(t => /scout brought back Schematic: Sledge/.test(t.m)) && env.toasts.some(t => /On a stall at 30 gold/.test(t.m)));
    const rt = read('js/realtime.js'), inv = read('js/inventory.js'), ia = read('js/item_admin.js'), mk = read('js/market.js');
    check('6j. realtime: recipe_discovered, recipe_learned, schematic_found', /recipe_discovered\(ev\)/.test(rt) && /recipe_learned\(ev\)/.test(rt) && /schematic_found\(ev\)/.test(rt));
    check('6k. inventory: Study button on schematics', /invStudy\(this\.dataset\.id\)/.test(inv) && /KWCrafting\.study/.test(inv));
    check('6l. shields: Dev Tools slot, sold with armour', /'shield'/.test(ia) && /equip_slot === 'shield'\) return 'armour'/.test(mk));
    check('6m. Dev Tools: discovery field and Teach my town', /'discovery'\]/.test(read('js/crafting.js')) && /Teach my town/.test(read('js/crafting.js')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
