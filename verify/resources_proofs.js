'use strict';
// Resources beyond the basic five (js/resource-defs.js, js/stores.js).
//   node verify/resources_proofs.js
//   1. The registry: Iron, the extras, "??" for undiscovered.
//   2. The ⛏ Stores pill and popover: discovered extras only, "?? — N more".
//   3. Crafting inputs the town hasn't discovered read "?? ×N".
//   4. Wiring: script tags, Iron labels, Market lists, Dev Tools grid.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

function makeEnv(settlement) {
  const els = {};
  const mk = id => ({
    id, hidden: false, innerHTML: '', textContent: '', style: {}, className: '', _attrs: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this._attrs[k] = v; }, addEventListener() {},
    querySelector(sel) { if (sel === '.res-val') return this._val || (this._val = { textContent: '' }); return (this._q = this._q || {})[sel] || (this._q[sel] = { focus() {}, onclick: null }); },
    insertAdjacentElement(_, el) { if (el.id) els[el.id] = el; },
    getBoundingClientRect: () => ({ left: 10, bottom: 40 }),
    get childElementCount() { return this.innerHTML ? 1 : 0; },
  });
  els['res-wealth'] = mk('res-wealth');
  els['cheat-extras-grid'] = mk('cheat-extras-grid');
  const doc = {
    readyState: 'complete',
    getElementById: id => els[id] || null,
    createElement: () => new Proxy(mk(null), { set(t, k, v) { t[k] = v; if (k === 'id' && v) els[v] = t; return true; } }),
    body: { appendChild(c) { if (c.id) els[c.id] = c; return c; } },
    addEventListener() {},
  };
  const win = { document: doc, console, Math, JSON, Number, String, Object, Array, Set, Promise, innerWidth: 390,
    gameData: { settlement }, tickResources: settlement.resources, tickRates: settlement.rates, apiFetch: async () => ({ ok: true, json: async () => ({}) }) };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('js/resource-defs.js'), win);
  vm.runInContext(read('js/stores.js'), win);
  return { win, els };
}

console.log('1. Registry');
{
  const w = {}; vm.createContext(w); w.window = w;
  vm.runInContext(read('js/resource-defs.js'), w);
  const R = w.KWResources;
  check('1a. metal is shown as Iron', R.label('metal') === 'Iron');
  check('1b. eleven extras, none known at the start', R.EXTRA.length === 11 && R.EXTRA.every(k => !R.startsKnown(k)));
  check('1c. undiscovered reads "?? × 1"', R.costLabel('gems', 1, R.knownSet([])) === '?? × 1');
  check('1d. twin of the server file', !fs.existsSync(path.join(ROOT, '..', 'kindlewood-server', 'lib', 'resource_defs.js'))
    || read('js/resource-defs.js') === fs.readFileSync(path.join(ROOT, '..', 'kindlewood-server', 'lib', 'resource_defs.js'), 'utf8'));
}

console.log('2. Stores');
{
  const none = makeEnv({ resources: { food: 1, metal: 2 }, rates: {}, discovered: [] });
  none.win.KWStores.render();
  check('2a. no discoveries → no Stores pill', none.els['res-stores'] && none.els['res-stores'].hidden === true);

  const env = makeEnv({ resources: { copper: 42, tin: 7, gems: 3 }, rates: { copper: 1.25 }, discovered: ['copper', 'tin', 'gems'] });
  env.win.KWStores.render();
  const pill = env.els['res-stores'];
  check('2b. the pill shows after Wealth with a count', pill && pill.hidden === false && pill._val.textContent === 'Stores · 3');
  const html = env.win.KWStores.popHtml();
  check('2c. popover lists what the town holds, grouped', /Ores/.test(html) && /Copper/.test(html) && /42/.test(html) && /Rare materials/.test(html) && /Gems/.test(html));
  check('2d. rates with one decimal', /\+1\.3\/hr/.test(html));
  check('2e. undiscovered ones are never named', !/Silver|Mithril|Steel|Moonsilver/.test(html));
  check('2f. "?? — 8 more not yet discovered"', /\?\? — 8 more not yet discovered/.test(html));
  env.win.KWStores.toggle();
  check('2g. the popover opens fixed, clamped to the phone width', env.els['stores-pop'] && env.els['stores-pop'].classList.contains('open')
    && env.els['stores-pop'].style.width === '300px');

  let posted = null;
  env.win.apiFetch = async (p, o) => { posted = { p, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({}) }; };
  const appended = [];
  env.win.document.body.appendChild = c => { appended.push(c); return c; };
  env.win.KWStores.showDiscoveries([{ key: 'gems' }, { key: 'bogus' }]);
  const card = appended[0];
  check('2h. a "New discovery!" card for real keys only', card && /New discovery!/.test(card.innerHTML) && /Gems/.test(card.innerHTML) && !/bogus/.test(card.innerHTML));
  check('2i. the Dev Tools grid has one +50 button per extra', (env.els['cheat-extras-grid'].innerHTML.match(/cheat-res-btn/g) || []).length === 11);
  void posted;
}

console.log('3. Crafting ??');
{
  const w = { document: { getElementById: () => null, addEventListener() {} }, console, Math, JSON, Number, String, Object, Array, Set, Map, Promise };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/career-math.js'), w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(read('js/crafting.js'), w);
  const recipe = { inputs: { resources: { metal: 4, steel: 2, copper: 1 } } };
  const n = w.KWCrafting.needs(recipe, { resources: { metal: 10, copper: 5 }, discovered: ['copper'] }, 1);
  const steel = n.find(x => x.key === 'steel'), iron = n.find(x => x.key === 'metal'), cu = n.find(x => x.key === 'copper');
  check('3a. undiscovered steel is unknown and short', steel.unknown && steel.short && steel.label === 'Not yet discovered');
  check('3b. iron and discovered copper show their names', iron.label === 'Iron' && !iron.short && cu.label === 'Copper' && !cu.unknown);
  check('3c. the card renders "?? ×N"', /\?\? ×\$\{x\.need\}/.test(read('js/crafting.js')));
}

console.log('4. Wiring');
{
  const html = read('index.html');
  check('4a. resource-defs and stores load before the panels', html.indexOf('/js/resource-defs.js') > 0 && html.indexOf('/js/stores.js') > 0
    && html.indexOf('/js/resource-defs.js') < html.indexOf('/js/crafting.js') && html.indexOf('/js/resource-defs.js') < html.indexOf('/js/market.js'));
  check('4b. stores.css linked', /css\/stores\.css/.test(html));
  check('4c. no "Metal" left in the UI', !/\bMetal\b/.test(['js/resources.js', 'js/market.js', 'js/seasons.js', 'js/tier.js', 'js/away-report.js', 'js/arrival.js', 'index.html'].map(read).join('\n')));
  const mk = read('js/market.js');
  check('4d. Market sells/asks only what the town knows', (mk.match(/knownTradeable\(st\)/g) || []).length === 2);
  check('4e. the tick follows every rate', /for \(const k of Object\.keys\(tickRates\)\)/.test(read('js/game.js')));
  check('4f. Dev Tools: ores, rares & alloys grid', /id="cheat-extras-grid"/.test(html) && /applyCheatExtras\(100\)/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
