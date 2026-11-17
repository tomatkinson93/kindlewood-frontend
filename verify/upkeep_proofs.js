'use strict';
// Upkeep and building health, as the player sees it (docs/HOME_SCENE.md
// Part E, step 17; js/upkeep.js). The server decides everything
// (kindlewood-server scripts/upkeep_test.js); these are the screen's rules.
//   node verify/upkeep_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/upkeep.js'), S = read('js/settlement-view.js'), N = read('js/neighbourhood.js'), CSS = read('css/home-scene.css'), H = read('index.html'), E = read('js/villager-engine.js');

const w = { console, Date, Promise, JSON, Math, Number, String, Array, Object }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWUpkeep;

console.log('1. Health and its three states');
{
  check('1a. sound from 60, worn under it, broken at nothing (as on the server)', K.stateOf(100) === 'sound' && K.stateOf(60) === 'sound' && K.stateOf(59) === 'worn' && K.stateOf(1) === 'worn' && K.stateOf(0) === 'broken' && K.stateOf(null) === null);
  check('1b. worn says it still works; broken says it gives nothing until mended', /still works/.test(K.STATE.worn) && /gives nothing until it is mended/.test(K.STATE.broken));
  check('1c. a sound building looks as it always did', K.lookOf('sound') === '' && K.lookOf(null) === '' && K.lookOf('worn') === 'kwu-worn' && K.lookOf('broken') === 'kwu-broken');
  check('1d. worn and broken looks are drawn over the building\'s own picture by code (no new art per building)', /\.kwu-worn \.kwh-art::after \{\s*background-image: url\("data:image\/svg\+xml/.test(CSS) && /\.kwu-broken \.kwh-art::after \{\s*background-image: url\("data:image\/svg\+xml/.test(CSS) && /\.kwu-broken \.kwh-art \{ filter: grayscale/.test(CSS));
  check('1e. broken is said in words too, not only shown ("Needs repair")', /class="kwu-needs">' \+ \(building\.repair \? '🛠️ Being mended' : '🏚️ Needs repair'\)/.test(S) && /kwu-needs">🏚️ Needs repair/.test(N));
}

console.log('2. The condition line, and Repair now');
{
  const worn = K.healthHtml({ on: true, health: 41.6, state: 'worn' }, 'data-kwu-repair="tavern"');
  check('2a. a panel shows the condition, a bar and the number', /Condition/.test(worn) && /Worn \(still works\) · 42%/.test(worn) && /aria-valuenow="42"/.test(worn) && /width:41\.6%/.test(worn));
  check('2b. anything short of whole can be repaired now; builders also mend by themselves', /data-kwu-repair="tavern">🛠️ Repair now/.test(worn) && /mend things by themselves when they have nothing to build/.test(worn));
  check('2c. once the repair is in the builders\' list the button is gone and it says so', /have the repair in hand/.test(K.healthHtml({ on: true, health: 10, state: 'worn', repair: true }, 'x')) && !/Repair now/.test(K.healthHtml({ on: true, health: 10, state: 'worn', repair: true }, 'x')));
  check('2d. a whole building has no button; with upkeep off there is no line at all', !/Repair now/.test(K.healthHtml({ on: true, health: 100, state: 'sound' }, 'x')) && K.healthHtml({ on: false, health: 30, state: 'worn' }, 'x') === '' && K.healthHtml({ on: true, health: 30, state: null }, 'x') === '');
  check('2e. it is in a building\'s panel and a home\'s window', /KWUpkeep\.healthHtml\(\{ on: KWUpkeep\.on \|\| !!occupant\.state, health: occupant\.health, state: occupant\.state, repair: !!occupant\.repair \}, 'data-kwu-repair="' \+ occupant\.id \+ '"'\)/.test(S)
    && /data-kwu-repair-house="\$\{h\.id\}"/.test(N) && /A broken home keeps its beds/.test(N));
  check('2f. Repair now goes to the server (the front of the builders\' queue); nothing is decided here', /apiFetch\('\/api\/upkeep\/repair', \{ method: 'POST'/.test(J) && /house \? \{ house_id: Number\(house\) \} : \{ type: b\.getAttribute\('data-kwu-repair'\) \}/.test(J) && !/health\s*=\s*100/.test(J));
  check('2g. with no builder it says so, and offers the way to choose one', /nobody is a builder/.test(J) && /global\.KWBuild\.noBuilder\(\)/.test(J));
  check('2h. a broken building has no screen behind it: Enter says why and opens its panel', /if \(o\.state === 'broken'\) \{[\s\S]{0,260}return _openBuildPanel\(s, o\); \}/.test(S));
}

console.log('3. The town card, and following the town');
{
  const ok = K._chipHtml({ on: true, line: 'Upkeep: 2 builders look after 16 of 16 buildings', short: false, damaged: [] });
  const short = K._chipHtml({ on: true, line: 'Upkeep: 2 builders look after 16 of 19 buildings', short: true, damaged: [{ state: 'worn' }, { state: 'broken' }] });
  check('3a. one line: "Upkeep: 2 builders look after 16 of 19 buildings"', /Upkeep: 2 builders look after 16 of 16 buildings/.test(ok) && !/kwu-chip-short/.test(ok));
  check('3b. amber, with a warning sign and the number broken, when builders are short (not colour alone)', /kwu-chip-short/.test(short) && /⚠️/.test(short) && /· 1 broken/.test(short));
  check('3c. nothing when upkeep is off (a Camp, or the switch)', K._chipHtml({ on: false }) === '' && K._chipHtml(null) === '');
  check('3d. it is by the town card and in the phone\'s town sheet', /id="kwu-slot"/.test(read('js/context.js')) && /class="kwc-upkeep"/.test(read('js/context.js')));
  check('3e. what wears, breaks or is mended arrives on the live stream; the scenes and lists follow', /upkeep\(ev\) \{ if \(global\.KWUpkeep\) global\.KWUpkeep\.onEvent\(ev\); \}/.test(read('js/realtime.js')) && /window\.addEventListener\('kw:upkeep'/.test(S) && /global\.addEventListener\('kw:upkeep'/.test(N));
  check('3f. the script is on the page after the builders\' queue', H.indexOf('/js/upkeep.js?v=') > H.indexOf('/js/construction.js?v='));
}

console.log('4. Builders on their rounds, and Dev Tools');
{
  const L = read('js/life-admin.js');
  check('4a. a builder with nothing to build walks a round of the buildings and taps at each (by day)', /isBuilder\(v\.c\) && global\.KWUpkeep && global\.KWUpkeep\.on && S\.doors\.length && S\.phase !== 'night'/.test(E) && /v\.state = 'totend'/.test(E) && /if \(v\.state === 'tend'\)/.test(E));
  check('4b. a broken home\'s window says it keeps its beds', /Broken: it keeps its beds, and needs mending/.test(J) && /home: true, health: h\.health/.test(N));
  check('4c. Dev Tools: on for this town, on for every town (asked twice), set every building\'s health', /data-kwld="uk-town"/.test(L) && /data-kwld="uk-all"/.test(L) && /data-kwld="uk-health"/.test(L) && /Turn upkeep on for EVERY town\?/.test(L)
    && /\/admin\/town/.test(L) && /\/admin\/switch/.test(L) && /\/admin\/health/.test(L) && /a Camp is exempt/.test(L));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
