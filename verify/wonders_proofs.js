'use strict';
// Your Town (js/wonders.js): festivals, upkeep, Wonders, and the town banner.
//   node verify/wonders_proofs.js
//   1. Festival: cost, the button and why not, countdown, cooldown.
//   2. Upkeep and arrears.
//   3. Wonder cards: lock, stage pips, cost (?? until discovered, red when
//      short), the blueprint, building, complete, dormant.
//   4. The banner over the map.
//   5. Wiring: panel buttons, breakdown rows, the board, Help, Dev Tools.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const els = {};
const mk = id => ({ id, innerHTML: '', className: '', classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } }, setAttribute() {}, addEventListener() {} });
els['tw-body'] = mk('tw-body'); els['town-banner'] = mk('town-banner');
const w = { console, Date, Math, JSON, Number, String, Object, Array, setInterval: () => 1, clearInterval() {},
  gameData: { settlement: { resources: { wealth: 1000, food: 50, steel: 100, gems: 5 }, discovered: ['steel', 'gems'] } }, tickResources: null,
  document: { getElementById: id => els[id] || null, createElement: () => mk(null), body: { appendChild: c => c }, addEventListener() {} } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/resource-defs.js'), w);
vm.runInContext(read('js/wonders.js'), w);
const soon = h => new Date(Date.now() + h * 3600e3).toISOString();
const fest = o => Object.assign({ active: false, until: null, cooldown_until: null, cost: { wealth: 300, food: 200 }, can_start: false, why: 'Not enough food.', hours: 24, cooldown_hours: 72, happiness: 10, production: 0.1 }, o || {});
const W = (key, o) => Object.assign({ key, label: key, icon: '⚒️', desc: 'd', bonus: '+10% all production', stage: 0, stages: 3, complete: false, building_until: null,
  next: { stage: 1, cost: { steel: 40, mithril: 10 }, items: [], hours: 12 }, can_build: true, why: null, active: false, dormant: false }, o || {});
const draw = (town, wonders) => { w.KWTown._set(town, wonders); w.KWTown.render(); return els['tw-body'].innerHTML; };
const town = o => Object.assign({ festival: fest(), upkeep: { wonders: 0, city: 0, total: 0 }, arrears: false, sources: [] }, o || {});
const wonders = (list, o) => Object.assign({ wonders: list, locked: null, arrears: false, upkeep_each: 12 }, o || {});

console.log('1. Festival');
let h = draw(town(), wonders([]));
check('1a. what it does and costs; short food is red; the button says why not', /\+10 happiness/.test(h) && /\+10% production/.test(h) && /tw-chip short" title="Food">🌿 200/.test(h) && /data-tw="festival" disabled title="Not enough food\."/.test(h));
h = draw(town({ festival: fest({ can_start: true, why: null }) }), wonders([]));
check('1b. affordable: an enabled "Hold a festival"', /data-tw="festival">Hold a festival/.test(h));
h = draw(town({ festival: fest({ active: true, until: soon(5), why: 'A festival is already under way.' }) }), wonders([]));
check('1c. running: the countdown', /A festival is under way — [45]h \d+m left/.test(h));
h = draw(town({ festival: fest({ cooldown_until: soon(30), why: 'The town is still recovering from the last one.' }) }), wonders([]));
check('1d. afterwards: the cooldown', /the next festival in 1d [56]h/.test(h));

console.log('2. Upkeep');
h = draw(town({ upkeep: { wonders: 12, city: 4, total: 16 } }), wonders([]));
check('2a. what the treasury pays, and for what', /<b>16 wealth an hour<\/b> \(wonders 12, City buildings 4\)/.test(h));
h = draw(town({ arrears: true, upkeep: { wonders: 12, city: 0, total: 12 } }), wonders([]));
check('2b. arrears: wonders dormant, happiness down, how to recover', /tw-status bad/.test(h) && /dormant/.test(h) && /Raise some wealth/.test(h));

console.log('3. Wonder cards');
h = draw(town(), wonders([W('a', { can_build: false, why: 'Wonders need a City.' })], { locked: 'Wonders need a City.' }));
check('3a. locked: a 🔒 line and disabled buttons', /🔒 Wonders need a City\./.test(h) && /disabled title="Wonders need a City\."/.test(h));
h = draw(town(), wonders([W('spire')]));
check('3b. the next stage: cost chips, mithril ?? until discovered and red, time, Build', /title="Steel">.* 40/.test(h) && /tw-chip short" title="Not yet discovered">\?\? 10/.test(h) && /⏳ 12h/.test(h) && /data-tw="build" data-key="spire">Build stage 1/.test(h));
h = draw(town(), wonders([W('spire', { stage: 2, next: { stage: 3, cost: {}, items: [{ item_key: 'ancient_blueprint', qty: 1, name: 'Ancient Blueprint', icon: '📜', have: 0 }], hours: 48 }, can_build: false, why: 'Needs an Ancient Blueprint.' })]));
check('3c. the last stage asks for an Ancient Blueprint', /tw-chip short" title="Ancient Blueprint">📜 1 Ancient Blueprint/.test(h) && (h.match(/tw-pip on/g) || []).length === 2);
h = draw(town(), wonders([W('spire', { stage: 1, building_until: soon(10), can_build: false })]));
check('3d. building: the stage pip striped, time left', /tw-pip building/.test(h) && /Stage 2 is going up — (9|10)h \d+m left/.test(h));
h = draw(town(), wonders([W('spire', { stage: 3, complete: true, active: true, next: null })]));
check('3e. complete: its bonus, a lit card', /tw-wonder done/.test(h) && /✓ Complete: \+10% all production/.test(h) && (h.match(/tw-pip on/g) || []).length === 3);
h = draw(town(), wonders([W('spire', { stage: 3, complete: true, dormant: true, next: null })]));
check('3f. dormant: greyed, says why', /tw-wonder done dormant/.test(h) && /Dormant — unpaid upkeep/.test(h));

console.log('4. Banner');
const b = els['town-banner'];
w.KWTown.onSettlement({ town: town({ festival: fest({ active: true, until: soon(3) }) }) });
check('4a. a festival shows over the map, and opens the town', /town-banner open good/.test(b.className) && /Festival/.test(b.innerHTML) && /KWTown\.open/.test(b.innerHTML));
w.KWTown.onSettlement({ town: town({ arrears: true, festival: fest({ active: true, until: soon(3) }) }) });
check('4b. unpaid upkeep comes first', /bad/.test(b.className) && /Unpaid upkeep/.test(b.innerHTML));
w.KWTown.onSettlement({ town: town() });
check('4c. nothing to say: no banner', b.innerHTML === '' && b.className === 'town-banner');

console.log('5. Wiring');
const html = read('index.html'), main = read('js/main.js');
check('5a. wonders.js and its css load; the banner sits in the stack over the map', /src="\/js\/wonders\.js\?v=\w+"/.test(html) && /href="\/css\/wonders\.css\?v=\w+"/.test(html) && /<div id="town-banner" class="town-banner" role="status"/.test(html));
check('5b. settlement panel: Festival, and Wonders locked until a City', /KWTown\.open\(\\'festival\\'\)">🎉 Festival/.test(main) && /_gatedAction\('tier:city', '🏛 Wonders'/.test(main) && /startsWith\('tier:'\)/.test(main));
check('5c. the banner follows load and every sync', /KWTown\.onSettlement\(gameData\.settlement\)/.test(main) && /KWTown\.onSettlement\(data\.settlement\)/.test(read('js/game.js')));
const res = read('js/resources.js');
check('5d. breakdown rows: town bonuses and both upkeeps', /kind === 'town_bonus'/.test(res) && /kind === 'wonder_upkeep'/.test(res) && /kind === 'city_upkeep'/.test(res) && /sum\.wonder_upkeep/.test(res));
check('5e. the Great Works board and a Help topic', /B\('greatworks', 'Great Works'/.test(read('js/leaderboard.js')) && /id: 'wonders'/.test(read('js/help.js')));
check('5f. Dev Tools: finish a wonder stage, a free festival', /KWTown\.devFinish\(/.test(html) && /KWTown\.devFestival\(\)/.test(html));
check('5g. the research labels for the new Building projects', /wonder_speed:/.test(read('js/research.js')) && /wonder_upkeep:/.test(read('js/research.js')));
check('5h. a full-screen sheet on phones; the map controls hide under it', /\.tw-card \{ max-height: none; height: 100%/.test(read('css/wonders.css')) && /'tw-overlay'/.test(read('js/mobile-shell.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
