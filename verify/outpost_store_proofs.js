'use strict';
// Outpost stores and porters (js/outposts.js), the away placards
// (citizens.js citizenAway) and the loading screen's Start button.
//   node verify/outpost_store_proofs.js
//   1. The store: bars, cap, full, rates, ?? until discovered.
//   2. Porters: runs on the road, Send a porter, the hauler.
//   3. The Outposts tab.
//   4. Away placards: every way of being out of the settlement.
//   5. Wiring: the tab, the tile panel, Journeys, the live stream, Help, the
//      loading screen's Start playing button.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const w = { console, Date, Math, JSON, Number, String, Object, Array, Set, Map, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/resource-defs.js'), w);
vm.runInContext('var gameData = { settlement: { discovered: ["copper"] } }; var citizensData = [];', w);
vm.runInContext(read('js/outposts.js'), w);
const O = w.KWOutposts;
const soon = m => new Date(Date.now() + m * 60e3).toISOString();
const op = o => Object.assign({ id: 7, name: 'Quarry', icon: '⛏️', terrain: 'hills', level: 1, tile_q: 3, tile_r: 4,
  store: { items: { stone: 120, copper: 3 }, cap: 300, full: [], weight: 126 }, rates: { stone: 5, metal: 1, copper: 0.6, tin: 0.5 },
  hauls: [], haulers: [], hauler_slots: 1, workers: [], garrison: [], worker_slots: 1, fort: { level: 0, slots: 0 }, notes: [],
  trip: { leg_seconds: 600, carry: 20, tiles: 1 } }, o || {});

console.log('1. The store');
let h = O.storeHtml(op());
check('1a. a bar per resource, with what is held of the cap and its rate', /🪨<\/span>/.test(h) && /120<small>\/300<\/small>/.test(h) && /\+5\/hr/.test(h));
check('1b. discovered ores by name; undiscovered ones as ??', /title="Copper"/.test(h) && /title="Not yet discovered"/.test(h));
h = O.storeHtml(op({ store: { items: { stone: 300 }, cap: 300, full: ['stone'], weight: 300 } }));
check('1c. full: the bar turns, the rate says stopped, and a nudge to send a porter', /kwop-bar-row full/.test(h) && />stopped</.test(h) && /production of stone has stopped\. Send a porter\./.test(h));
check('1d. nothing to show without a store', O.storeHtml({ id: 1 }) === '');

console.log('2. Porters');
vm.runInContext('citizensData = [{ id: 1, name: "Bo", life_stage: "adult", role: "porter" }, { id: 2, name: "Al", life_stage: "adult", role: "farmer" }, { id: 3, name: "Cy", life_stage: "adult", outpost: { name: "Mine" } }, { id: 4, name: "Di", life_stage: "child" }, { id: 5, name: "Ed", life_stage: "adult", haul: { status: "outbound" } }];', w);
h = O.haulHtml(op());
check('2a. free adults only, a Porter first', /<option value="1">Bo \(Porter\)<\/option><option value="2">Al<\/option><\/select>/.test(h) && !/Cy|Di|Ed/.test(h));
check('2b. Send a porter, the trip time and load', /data-kwop="haul" data-id="7">🧺 Send a porter/.test(h) && /About 10m each way · carries 20 weight a trip/.test(h));
check('2c. a hauler can be chosen', /data-kwop="hauler" data-id="7">Make hauler/.test(h) && /goes back and forth on their own/.test(h));
h = O.haulHtml(op({ store: { items: {}, cap: 300, full: [] } }));
check('2d. an empty store: Send is disabled and says why', /data-kwop="haul" data-id="7" disabled title="Nothing stored yet"/.test(h));
h = O.haulHtml(op({ haulers: [{ id: 2, name: 'Al' }], hauls: [
  { id: 1, citizen_id: 1, name: 'Bo', status: 'outbound', arrives_at: soon(5), returns_at: soon(10), standing: false },
  { id: 2, citizen_id: 2, name: 'Al', status: 'returning', load: { stone: 15 }, arrives_at: soon(-5), returns_at: soon(3), standing: true }] }));
check('2e. on the road: who, which way, the countdown, what they carry', /<b>Bo<\/b> <span class="kwop-muted">On the way /.test(h) && /data-kwop-end=/.test(h) && /Coming home with <span class="kwop-chip" title="Stone">🪨 15/.test(h));
check('2f. the hauler, with Home; no second hauler', /<b>Al<\/b> hauls for this outpost/.test(h) && /data-kwop="home" data-id="7" data-cid="2"/.test(h) && !/Make hauler/.test(h));
check('2g. countdowns read m/s', /^4m 5\ds$|^5m 00s$/.test(O.fmtLeft(soon(5))));

console.log('3. The tab');
h = O.tabHtml({ used: 1, cap: 2, range: 3, outposts: [op({ notes: [{ key: 'raided', label: 'Raiders left it in ruins.' }] })] }, Date.now());
check('3a. a head line: used of cap, range, and Help', /⛺ 1\/2 outposts · range 3/.test(h) && /KWHelp\.open\('outposts'\)/.test(h));
check('3b. a card per outpost: name, level, place, Show on map', /<b>Quarry<\/b> <span class="kwop-lv">Lv 1<\/span>/.test(h) && /3·4/.test(h) && /data-kwop="map" data-q="3" data-r="4"/.test(h));
check('3c. its store, porters and warnings on the card', /kwop-store/.test(h) && /kwop-porters/.test(h) && /🔥 Raiders left it in ruins\./.test(h));
check('3d. none yet: how to found one', /No outposts yet/.test(O.tabHtml({ used: 0, cap: 1, range: 2, outposts: [] })));

console.log('4. Away placards');
const cz = read('js/citizens.js');
const c = vm.createContext({ window: {}, console });
vm.runInContext(cz.slice(cz.indexOf('function citizenAway'), cz.indexOf('// ── Citizen Profile Modal')), c);
const away = x => (c.citizenAway(x) || {}).label || null;
check('4a. quests, scouting, diplomats', away({ active_quest: {} }) === '⚔️ On Quest' && away({ expedition: {} }) === '🗺 Scouting' && away({ active_quest: { clan: true } }) === '⚔️ On a clan quest');
check('4b. at an outpost: worker, guard, hauler', away({ outpost: { name: 'Mine', post: 'worker' } }) === '👷 At the Mine' && /Guarding the Mine/.test(away({ outpost: { name: 'Mine', post: 'garrison' } })) && /Hauling for the Mine/.test(away({ outpost: { name: 'Mine', post: 'hauler' } })));
check('4c. on the road: trading, porters, hauling home', away({ trade: { on_road: true } }) === '🐾 Trading' && away({ trade: { on_road: true, porter: 'buy' } }) === '🧺 Porter run' && /Hauling home from the Quarry|Hauling home from Quarry/.test(away({ haul: { status: 'returning', outpost_name: 'Quarry' } })));
check('4d. at home (a shopkeeper, a merchant): not away', away({ trade: { shop: 'smithy', on_road: false } }) === null && away({ role: 'farmer' }) === null);
check('4e. both lists grey them out', /const away = citizenAway\(c\);\s*\n\s*const isAway = !!away;/.test(cz) && /ac-row--away/.test(cz) && /\.ac-row--away \{ opacity/.test(read('css/main.css')));

console.log('5. Wiring');
const html = read('index.html'), main = read('js/main.js');
check('5a. an Outposts tab between Citizens and Build, with its panel', /id="tab-citizens"[^\n]*\n\s*<button class="sidebar-tab" id="tab-outposts" onclick="switchTab\('outposts'\)">Outposts<\/button>\s*\n\s*<button class="sidebar-tab" id="tab-buildings"/.test(html) && /id="panel-outposts-view"/.test(html) && /id="outposts-body"/.test(html));
check('5b. outposts.js and its css load, versioned', /src="\/js\/outposts\.js\?v=\w+"/.test(html) && /href="\/css\/outposts\.css\?v=\w+"/.test(html));
check('5c. switchTab opens it; other panels hide it', /tab === 'outposts'\) \{\s*\n\s*if \(window\.KWOutposts\) KWOutposts\.show\(\)/.test(main) && (read('js/citizens.js').match(/KWOutposts\.hide\(\)/g) || []).length === 2);
check('5d. the tile panel shows the store and porters', /KWOutposts\.storeHtml\(mine\) \+ KWOutposts\.haulHtml\(mine\)/.test(main));
check('5e. Journeys lists porters and haulers; the live stream tells the tab', /post: 'hauler'/.test(read('js/journeys.js')) && /outpost_haul_home\(ev\) \{ if \(global\.KWOutposts\)/.test(read('js/realtime.js')));
check('5f. phones: Outposts in the More sheet', /label: 'Outposts', glyph: '⛺', fn: function \(\) \{ window\.switchTab\('outposts'\); \}/.test(read('js/mobile-shell.js')));
check('5g. Help explains stores and porters', /own store/.test(read('js/help.js')) && /Send a porter/.test(read('js/help.js')));
check('5h. loading screen: a big Start playing button, waited for on first load', /<button type="button" class="ls-play" id="ls-play" hidden>▶ Start playing<\/button>/.test(html) && /await lsReadyToPlay\(\);\s*\n\s*hideLoadingScreen\(\);/.test(main) && /\.ls-play \{/.test(read('css/main.css')));

console.log('6. Outpost window, buildings, walks (R6b)');
const ob = op({ max_level: 3, upkeep_food_per_hr: 1, buildings: { slots: 2, used: 2,
  built: [{ key: 'sawpit', name: 'Sawpit', icon: '🪚', desc: '+25% timber.', ready: false, ready_at: soon(30) }, { key: 'storehouse', name: 'Storehouse', icon: '📦', desc: 'Room.', ready: true, ready_at: soon(-5) }],
  options: [{ key: 'mule_pen', name: 'Mule Pen', icon: '🫏', desc: 'More carried.', cost: { timber: 80 }, hours: 1, land: false }, { key: 'ore_sorter', name: 'Ore Sorter', icon: '🪨', desc: '+40% ores.', cost: { metal: 40 }, hours: 2, land: true }] },
  hauls: [{ id: 9, citizen_id: 4, name: 'Wren', kind: 'post', status: 'outbound', arrives_at: soon(8), returns_at: soon(8) }, { id: 10, citizen_id: 5, name: 'Moss', kind: 'return', status: 'returning', arrives_at: soon(0), returns_at: soon(6) }] });
h = O.buildingsHtml(ob, Date.now());
check('6a. plots: built ones, going up with a countdown, working, Pull down', /2 of 2 in use/.test(h) && /kwop-plot built building/.test(h) && /Going up · <span class="kwop-time" data-kwop-end=/.test(h) && /✓ Working/.test(h) && /data-kwop="pulldown" data-id="7" data-key="sawpit"/.test(h));
check('6b. what can go up: cost, time, this-land tag; plots full disables Build and says so', /Ore Sorter<\/b><span class="kwop-tag">this land/.test(h) && /data-kwop="build" data-id="7" data-key="mule_pen" disabled title="Every plot is in use"/.test(h) && /Every plot is in use\. Upgrade the outpost/.test(h));
w.KWOutposts._modal.tab = 'people';
h = O.modalHtml(ob, Date.now());
check('6c. People: crew walking out or home are on the road', /🚶 On the road/.test(h) && /<b>Wren<\/b> <span class="kwop-muted">walking out to start work/.test(h) && /<b>Moss<\/b> <span class="kwop-muted">walking home/.test(h));
check('6d. walks are not porters', !/Wren<\/b> <span class="kwop-muted">On the way/.test(O.haulHtml(ob, Date.now())));
check('6e. away placards for walks', away({ haul: { kind: 'post', outpost_name: 'Mine' } }) === '🚶 Walking to the Mine' && away({ haul: { kind: 'return', outpost_name: 'Mine' } }) === '🏠 Walking home from the Mine');
const tv = read('js/kwmap-travel.js');
check('6f. the map: outpost journeys are labelled and open the outpost window', /outpost: 'Outpost'/.test(tv) && /j\.open === 'outpost' && global\.KWOutposts\) global\.KWOutposts\.manage\(j\.outpost_id\)/.test(tv));
check('6g. Manage from the tile panel and the tab; Escape and the phone shell know the window', /data-kwop="manage" data-id="\$\{tile\.outpost\.id\}"/.test(main) && /data-kwop="manage" data-id="\$\{o\.id\}"/.test(read('js/outposts.js')) && /'kwop-modal'/.test(read('js/a11y.js')) && /'kwop-modal'/.test(read('js/mobile-shell.js')));
check('6h. a fixed-size window: the body scrolls', /\.kwop-mcard \{ width: min\(980px, 100%\); height: min\(720px/.test(read('css/outposts.css')) && /\.kwop-mbody \{ flex: 1; min-height: 0; overflow-y: auto/.test(read('css/outposts.css')));

console.log('7. Held toasts and fixed windows');
check('7a. toasts wait while the loading screen is up and play after Start', /function _holdToast\(fn, args\)/.test(main) && /if \(_holdToast\(showToastNotification, arguments\)\) return;/.test(main) && /_holdToast\(showBuildToast, arguments\)/.test(read('js/buildings.js')) && /function hideLoadingScreen\(\) \{\s*\n\s*const el = document\.getElementById\('loading-screen'\);\s*\n\s*releaseHeldToasts\(\);/.test(main) && /window\.__kwHoldToasts = true;/.test(html));
const ms = read('css/modal-sizes.css');
check('7b. tabbed windows keep one size; the away report is wider', /\.ar-card \{ width: min\(880px/.test(ms) && /\.citizen-profile-modal \{ height: min\(820px/.test(ms) && /\.mail-card \{ height:/.test(ms) && /\.inv-modal-card \{ height:/.test(ms) && /\.clan-card \{ height:/.test(ms) && /href="\/css\/modal-sizes\.css\?v=\w+"/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
