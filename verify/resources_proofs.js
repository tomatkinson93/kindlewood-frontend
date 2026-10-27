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
    gameData: { settlement }, tickResources: { ...settlement.resources }, tickRates: settlement.rates, apiFetch: async () => ({ ok: true, json: async () => ({}) }) };
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

console.log('5. Where ores come from');
{
  // Outpost chips: known ores named, the rest one "??" chip.
  const main = read('js/main.js');
  const src = main.slice(main.indexOf('function _oreChips'), main.indexOf('function _costChips'));
  const w = { console, gameData: { settlement: { discovered: ['copper'] } } }; w.window = w; vm.createContext(w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(src, w);
  const chips = w._oreChips({ copper: 0.6, tin: 0.5, coal: 0.8 });
  check('5a. a hills outpost names copper, hides tin and coal as "?? ×2"', /Copper/.test(chips) && /\+0\.6\/hr/.test(chips) && /\?\? ×2/.test(chips) && !/Tin|Coal/.test(chips));
  check('5b. both outpost panels show ore chips', (main.match(/_oreChips\(cfg/g) || []).length === 2);

  // Expedition ore sample: stores updated, toast, a card when new.
  const toasts = [];
  const env = makeEnv({ resources: { tin: 1 }, rates: {}, discovered: [] });
  env.win.showBuildToast = m => toasts.push(m);
  const shown = []; env.win.document.body.appendChild = c => { shown.push(c); return c; };
  env.win.KWStores.onOreSample({ resource: 'tin', qty: 7, discovered: true });
  check('5c. an ore sample adds to the stores and is known', env.win.gameData.settlement.resources.tin === 8 && env.win.gameData.settlement.discovered.includes('tin'));
  check('5d. …with a toast and a discovery card', /brought back 7 tin/.test(toasts[0] || '') && shown.length === 1);
  check('5e. realtime routes ore_sample to the Stores', /ore_sample\(ev\) \{ if \(global\.KWStores\) global\.KWStores\.onOreSample\(ev\)/.test(read('js/realtime.js')));

  // Away report: ore tiles only when something was produced.
  const ar = read('js/away-report.js');
  check('5f. away report: ore tiles only when produced', /isBase\(k\) \|\| \(r\.resources\[k\] && r\.resources\[k\]\.produced\)/.test(ar) && /root\.KWResources\.EXTRA/.test(ar));
}

console.log('6. Smelter');
{
  const cf = read('js/crafting.js');
  check('6a. the Smelter is a workshop (icon, Dev Tools choices)', /smelter: '🔥'/.test(cf) && /'carpenter', 'smelter'\]/.test(cf) && /'workshop', 'smelter'\]/.test(cf));
  check('6b. resource recipes say "Into your stores", no stall listing at the Smelter', /t\.resource \? 'Into your stores'/.test(cf) && /_station === 'smelter' \? ''/.test(cf));
  check('6c. Smelter help explains alloys', /How the Smelter works/.test(cf) && /copper and tin make bronze/.test(cf));
  // craft_done for a resource: toast, stores, discovery card.
  const toasts = [], cards = [];
  const w = { document: { getElementById: () => null, addEventListener() {} }, console, Math, JSON, Number, String, Object, Array, Set, Map, Promise,
    gameData: { settlement: { resources: { bronze: 1 }, discovered: [] } },
    showBuildToast: m => toasts.push(m), KWStores: { showDiscoveries: l => cards.push(l), render() {} } };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/career-math.js'), w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(read('js/crafting.js'), w);
  w.KWCrafting.onEvent({ type: 'craft_done', name: 'Ember', resource: 'bronze', qty: 2, new_resource: true, first: true, item: { name: '2 bronze', icon: '🔶' } });
  check('6d. a smelted batch toasts and lands in the stores', /Ember smelted 2 bronze — their first!/.test(toasts[0] || '') && w.gameData.settlement.resources.bronze === 3);
  check('6e. the first bronze shows a discovery card', cards.length === 1 && cards[0][0].key === 'bronze' && w.gameData.settlement.discovered.includes('bronze'));
  const sv = read('js/settlement-view.js');
  check('6f. the settlement view has a Smelter slot and research locks', /accepts:\['smelter'\]/.test(sv) && /b\.researchMet !== false/.test(sv) && /at a Library first/.test(sv) && /'workshop', 'smelter'\]\.includes\(occupant\.id\)/.test(sv));
  check('6g. the build list explains research locks', /Study \$\{b\.researchLabel/.test(read('js/buildings.js')));
  check('6h. the browser gets no copy of the research tree', !fs.existsSync(path.join(ROOT, 'js', 'research-defs.js')));
}

console.log('7. Recipe book');
{
  const w = { document: { getElementById: () => null, addEventListener() {} }, console, Math, JSON, Number, String, Object, Array, Set, Map, Promise };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/career-math.js'), w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext(read('js/crafting.js'), w);
  const st = { class_label: 'Blacksmith', resources: { metal: 5, steel: 0 }, discovered: ['steel'], have: { iron_ore: 0 }, research_done: [],
    templates: { iron_ore: { name: 'Iron Ore', icon: '⚫' } },
    crafters: [{ id: 1, name: 'Bram', can: { a: null, b: 'Needs level 11.', c: null } }],
    recipes: [
      { recipe_key: 'a', name: 'Iron Dagger', min_level: 1, output: { icon: '🗡️' }, output_qty: 1, inputs: { resources: { metal: 4 } } },
      { recipe_key: 'b', name: 'Steel Sword', min_level: 11, output: { icon: '⚔️' }, output_qty: 1, inputs: { resources: { metal: 10, steel: 8 }, items: [{ item_key: 'iron_ore', qty: 1 }] } },
      { recipe_key: 'c', name: 'Gold Ring', min_level: 1, output: { icon: '💍' }, output_qty: 1, inputs: { resources: { goldore: 3 } } },
    ] };
  const html = w.KWCrafting._bookHtml(st, true);
  check('7a. every recipe, with who can make it or why not', /📖 Recipe book · 3 recipes/.test(html) && /✅ Bram/.test(html) && /🔒 Needs level 11\./.test(html));
  check('7b. missing known materials get a Find on Market button', /data-cf="find" data-res="steel"/.test(html) && /data-cf="find" data-res="metal"/.test(html) && /data-item="iron_ore" data-name="Iron Ore"/.test(html));
  check('7c. undiscovered inputs stay "??" and get no Find button', /\?\? ×3/.test(html) && !/data-res="goldore"/.test(html));
  const empty = w.KWCrafting._bookHtml(Object.assign({}, st, { crafters: [], recipes: [Object.assign({}, st.recipes[0], { research: 'smelting', research_label: 'Smelting' })] }), false);
  check('7d. no crafters: the reason comes from the recipe (research)', /Needs research: Smelting\./.test(empty) && !/Back to making/.test(empty));
  const mk = read('js/market.js');
  check('7e. the Market opens filtered to a resource or an item', /opts\.find && opts\.find\.resource/.test(mk) && /opts\.find && opts\.find\.itemKey/.test(mk));
}

console.log('8. Village requests');
{
  const mk = read('js/market.js');
  check('8a. a request row: its own badge, deadline and the thanks', /mk-req-badge">Request</.test(mk) && /📣 Needed by \$\{esc\(req\.by\)\}/.test(mk) && /fill it all for <b>\+\$\{req\.trust\} trust<\/b>/.test(mk));
  check('8b. the porter home toast says the request was filled', /ev\.request_done \? ` 🤝 Request filled/.test(mk));
  check('8c. request rows are styled', /\.mk-req-row/.test(read('css/market.css')));
}

console.log('9. Balance overview & discounts');
{
  const w = { document: { getElementById: () => null, addEventListener() {} }, console, Math, JSON, Number, String, Object, Array, Set, Promise };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/career-balance.js'), w);
  const html = w.KWCareerBalance.html({
    tuning: [{ key: 'research', value: 1.5, label: 'Research speed', desc: 'Points.' }],
    classes: [{ key: 'miner', label: 'Miner', icon: '⛏️', citizens: 3, levels: [1, 0, 2].concat(Array(17).fill(0)), median_level: 3, median_xp_per_hour: 9.8, avg_hours: 40, forks: { stonemason: 1 } }],
    crafting: { days: [{ day: '2026-10-24', basic: 2, sturdy: 1, fine: 0, superior: 0, legendary: 0, smelted: 4 }] },
    discoveries: { recipes: 1, resources: 3, by_source: { 'resource:mine': 3 } },
    research: { towns_studying: 2, finished_7d: 1, by_project: { Smelting: 1 } } });
  check('9a. tuning inputs with Save', /data-cb-key="research"/.test(html) && /value="1\.5"/.test(html) && /data-cb-save="research"/.test(html));
  check('9b. class rows: histogram of 20 levels, medians, forks', (html.match(/<span style="height:/g) || []).length === 20 && /9\.8/.test(html) && /stonemason 1/.test(html));
  check('9c. crafts by quality and smelts per day; discoveries; research', /2026-10-24/.test(html) && />4</.test(html) && /3<\/b> resources discovered/.test(html) && /Smelting 1/.test(html));
  const idx = read('index.html');
  check('9d. a Dev Tools tab loads it', /cheatSwitchTab\('ct-balance',this\);loadCareerBalance\(\)/.test(idx) && /id="cb-body"/.test(idx) && /\/js\/career-balance\.js/.test(idx));
  const b = read('js/buildings.js');
  const src = b.slice(b.indexOf('function discountText'), b.indexOf('// Show locked buildings'));
  const x = {}; vm.createContext(x); vm.runInContext(src, x);
  check('9e. build costs say what was taken off', /−16% Stonemason Gritt, −5% Engineering/.test(x.discountText({ discount: [{ label: 'Stonemason Gritt', pct: -0.16 }, { label: 'Engineering', pct: -0.05 }] })) && x.discountText({}) === '');
  check('9f. the settlement view shows them too', (read('js/settlement-view.js').match(/discountText\(/g) || []).length === 2);
}

console.log('10. Settlement panel: Research and Market');
{
  const main = read('js/main.js');
  const src = main.slice(main.indexOf('function _hasBuilding'), main.indexOf('window.refreshSettlementActions'));
  const els = [];
  const w = { console, gameData: { buildings: [{ type: 'library', level: 1 }] }, buildingsData: [],
    document: { querySelectorAll: () => els } };
  w.window = w; vm.createContext(w); vm.runInContext(src, w);
  const lib = w._gatedAction('library', '📚 Research', 'openLibrary()'), mk = w._gatedAction('market', '⚖️ Market', 'openMarket()');
  check('10a. built: the button opens it', /onclick="openLibrary\(\)">📚 Research</.test(lib) && !/locked/.test(lib));
  check('10b. not built: greyed, padlocked, disabled, just "Locked"', /class="sett-action locked"/.test(mk) && /disabled/.test(mk) && />🔒 Locked</.test(mk) && /title="Locked"/.test(mk));
  check('10c. …and it doesn\'t say what it is', !/Market|openMarket\(\)">/.test(mk.replace(/data-label="[^"]*"|data-onclick="[^"]*"/g, '')));
  // Building it unlocks the button in place.
  const el = { dataset: { settGate: 'market', label: '⚖️ Market', onclick: 'openMarket()' }, classList: { _s: new Set(['locked']), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); } },
    disabled: true, title: 'Locked', textContent: '🔒 Locked', _attr: {}, setAttribute(k, v) { this._attr[k] = v; } };
  els.push(el);
  w.buildingsData = [{ id: 'market', currentLevel: 1 }];
  w.refreshSettlementActions();
  check('10d. building it unlocks the button straight away', !el.disabled && el.textContent === '⚖️ Market' && el._attr.onclick === 'openMarket()' && !el.classList._s.has('locked'));
  check('10e. both buttons are in the panel; the build list refreshes them', /_gatedAction\('library', '📚 Research', 'openLibrary\(\)'\)/.test(main) && /_gatedAction\('market', '⚖️ Market', 'openMarket\(\)'\)/.test(main)
    && /refreshSettlementActions\(\)/.test(read('js/buildings.js')) && /\.sett-action\.locked/.test(read('css/hud-storybook.css')));
}

console.log('11. Mobile pan stick');
{
  const ms = read('js/mobile-shell.js');
  const src = ms.slice(ms.indexOf('  function stickCovered()'), ms.indexOf('  // Re-check whenever the page changes'));
  // A fake page: whatever elementsFromPoint returns is "what's on screen there".
  let top = [];
  const frame = { closest: sel => (sel === '#map-frame' ? frame : null) };
  const panel = { closest: () => null };
  const stick = { offsetWidth: 104, contains: n => n === stick };
  const body = { classList: { _s: new Set(), contains(c) { return this._s.has(c); } } };
  const screen = { classList: { contains: c => c === 'active' } };
  const w = { window: null, innerHeight: 844, stickEl: stick,
    document: { body, querySelector: () => ({ getBoundingClientRect: () => ({ top: 780 }) }), elementsFromPoint: () => top },
    byId: id => (id === 'screen-game' ? screen : null) };
  w.window = w; vm.createContext(w);
  vm.runInContext(src + '; this.stickCovered = stickCovered;', w);
  top = [stick, frame];
  check('11a. over the map (looking through the stick itself): shown', w.stickCovered() === false);
  top = [stick, panel, frame];
  check('11b. any panel, sheet or screen above that spot: hidden', w.stickCovered() === true);
  body.classList._s.add('kw-overlay'); top = [frame];
  check('11c. a full-screen overlay: hidden', w.stickCovered() === true);
  check('11d. watched live, and only changed when it needs to', /watchStickCover\(\);/.test(ms) && /if \(show === !stickEl\.hasAttribute\('hidden'\)\) return;/.test(ms));
}

console.log('12. Metals in levels, tiers, quests and the breakdown');
{
  // Pull one top-level function (and anything before the next marker) out of a file.
  const slice = (f, from, to) => { const t = read(f); return t.slice(t.indexOf(from), t.indexOf(to, t.indexOf(from))); };
  const withDefs = discovered => {
    const w = { gameData: { settlement: { discovered } } }; w.window = w; vm.createContext(w);
    vm.runInContext(read('js/resource-defs.js'), w);
    return w;
  };
  const t = withDefs(['bronze']);
  vm.runInContext(slice('js/tier.js', 'const RES_ICONS', '\n}\n') + '\n}; this._tierExtra = _tierExtra;', t);
  check('12a. the tier modal names a discovered alloy…', t._tierExtra('bronze').label === 'Bronze' && t._tierExtra('bronze').icon === t.KWResources.icon('bronze'));
  check('12b. …and shows ?? for one the town hasn\'t found', t._tierExtra('steel').icon === '??' && t._tierExtra('steel').label === 'Not yet discovered' && t._tierExtra('food') === null);
  const tier = read('js/tier.js');
  check('12c. both tier views use it', (tier.match(/_tierExtra\((r|key)\)/g) || []).length >= 4);

  const r = withDefs(['copper', 'bronze']);
  r.RM_RESOURCE_IDS = ['food', 'timber', 'stone', 'metal', 'wealth'];
  r.RM_RESOURCE_LABELS = { food: 'Food', timber: 'Timber', stone: 'Stone', metal: 'Iron', wealth: 'Wealth' };
  vm.runInContext(slice('js/resources.js', 'function _rmTabIds', '// ── Floater') + '; this._rmTabIds = _rmTabIds; this._rmLabel = _rmLabel;', r);
  const tabs = r._rmTabIds();
  check('12d. the breakdown modal adds a tab per discovered extra', tabs.join() === 'food,timber,stone,metal,wealth,copper,bronze', tabs.join());
  check('12e. …labelled from the registry', r._rmLabel('copper') === 'Copper' && r._rmLabel('metal') === 'Iron');
  const res = read('js/resources.js');
  check('12f. a tab with no hourly source says where it comes from', /Nothing produces this every hour right now/.test(res) && /sourceHint\(res\)/.test(res));

  const env = makeEnv({ resources: { copper: 4 }, rates: { copper: 1 }, discovered: ['copper'] });
  const pop = env.win.KWStores.popHtml();
  check('12g. each Stores row opens its tab', /data-sp-res="copper"/.test(pop) && /openResourceModal\('copper'\)/.test(pop) && /<button type="button" class="sp-row sp-row-btn"/.test(pop));

  const b = read('js/buildings.js');
  check('12h. the quest editor has fields for every ore, rare and alloy, folded away', /<details class="qa-extra-rewards"/.test(b) && /extra\.map\(k => '<div class="ce-field">/.test(b)
    && /\['food','timber','stone','metal','wealth', \.\.\.\(\(window\.KWResources && KWResources\.EXTRA\) \|\| \[\]\)\]\.forEach/.test(b));
  const sv = read('js/settlement-view.js');
  check('12j. only js/resources.js defines _resIcon (settlement-view used to replace it with raw keys)', !/function _resIcon\b/.test(sv) && /function _svResIcon/.test(sv)
    && /typeof gameData !== 'undefined' && gameData && gameData\.settlement/.test(res));
  check('12i. the demolish refund preview skips a level\'s metals', /indexOf\(e\[0\]\) >= 0; \}\)/.test(read('js/settlement-view.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
