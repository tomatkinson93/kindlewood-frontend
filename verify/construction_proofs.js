'use strict';
// Building time with builders, as the player sees it (docs/HOME_SCENE.md
// Part D, step 13; js/construction.js). The server decides everything
// (kindlewood-server scripts/construction_test.js); these are the screen's rules.
//   node verify/construction_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/construction.js'), S = read('js/settlement-view.js'), N = read('js/neighbourhood.js'), B = read('js/buildings.js'), CSS = read('css/home-scene.css'), H = read('index.html');

const w = { console, Date, Promise, JSON, Math, Number, String, Array, Object }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWBuild;
const sites = [{ id: 1, label: 'Lumber Camp', work_needed: 3, work_done: 0 }, { id: 2, label: 'Granary', work_needed: 5, work_done: 1 }];
const data = { on: true, max: 5, rate: 2, waiting: false, builders: [{ id: 7, name: 'Ada Oak' }, { id: 8, name: 'Bea Elm' }], sites };

console.log('1. Honest estimates');
{
  check('1a. minutes in words', K._minutesLine(0) === 'less than a minute' && K._minutesLine(0.4) === 'about 1 minute' && K._minutesLine(12.2) === 'about 12 minutes' && K._minutesLine(80) === 'about 1 h 20 min' && K._minutesLine(120) === 'about 2 h');
  const p = K._progress(sites, 2, 60000);
  check('1b. between reads the bar follows the builders: all on the first site, the rest carried on', p[0].done === 2 && Math.abs(p[0].pct - 2 / 3) < 1e-9 && p[1].done === 1);
  const q = K._progress(sites, 2, 120000);
  check('1c. what is left over when the first finishes goes into the next', q[0].pct === 1 && q[1].done === 2 && Math.abs(q[1].pct - 0.4) < 1e-9);
  check('1d. nobody building: nothing moves', K._progress(sites, 0, 600000)[0].done === 0 && K._progress(sites, 2, 0)[0].done === 0);
  check('1e. a site\'s estimate counts everything before it', K._etaMinutes(sites, 2, 1) === 1.5 && K._etaMinutes(sites, 2, 2) === 3.5 && K._etaMinutes(sites, 0, 1) === null);
  check('1f. "about 2 minutes with 2 builders"', K._etaLine(data, 1) === 'about 2 minutes with 2 builders' && K._etaLine(data, 2) === 'about 4 minutes with 2 builders');
  check('1g. or "Waiting for a builder"', K._etaLine({ ...data, rate: 0, builders: [] }, 1) === 'Waiting for a builder');
  check('1h. the estimate shrinks as time passes', K._etaLine(data, 1, 60000) === 'about 1 minute with 2 builders');
}

console.log('2. Ordering');
{
  check('2a. paid, and how long: said at once', K._orderLine({ site: { kind: 'building', work_needed: 3 }, builders: 1, no_builder: false }, 'Lumber Camp') === 'The builders will start on the Lumber Camp (about 3 minutes of work with 1 builder, after anything before it).');
  check('2b. an upgrade and a home are named as such', /the Library upgrade/.test(K._orderLine({ site: { kind: 'upgrade', work_needed: 8 }, builders: 2 }, 'Library')) && /a new home/.test(K._orderLine({ site: { plot: 4 }, builders: 1 }, 'home', 5)));
  check('2c. nobody is a builder: it says so plainly', K._orderLine({ site: { kind: 'building' }, builders: 0, no_builder: true }, 'Lumber Camp') === 'Paid for the Lumber Camp. Nobody is a builder, so it will wait until someone is.');
  check('2d. and a dialog offers the way to fix it ("Choose a builder" opens the citizens)', /title: 'Nobody is a builder'/.test(J) && /ok: 'Choose a builder'/.test(J) && /global\.openAllCitizens\(\)/.test(J));
  check('2e. before paying, the panel says how long, that it will wait, or that the list is full', /Nobody is a builder: this will wait until someone is\./.test(J) && /already have \$\{S\.data\.max\} things to build/.test(J)
    && /KWBuild\.noteHtml\(occupant\.work\)/.test(S) && /KWBuild\.noteHtml\(null\)/.test(S) && /global\.KWBuild\.noteHtml\(5\)/.test(N));
  check('2f. the build call hands a queued order to KWBuild and returns what happened', /if \(data\.queued\) \{[\s\S]{0,120}KWBuild\.ordered\(data, def\?\.label \|\| id, def\?\.work\)/.test(B) && /return null;\s*\}\s*const def/.test(B));
  check('2g. a refused order changes nothing in the scene (no sound, no plot taken, no cost shown)', /var done = await buildBuilding\(buildingId\);\s*if \(!done\) return;/.test(S) && /if \(!done\.queued\) _svPlaySound/.test(S));
}

console.log('3. Going up: the chip and the list');
{
  check('3a. the chip: how many, the first and how far', K._chipText(data, 0) === '2 going up · Lumber Camp 0%' && K._chipText(data, 60000) === '2 going up · Lumber Camp 66%');
  check('3b. it says when the town is waiting for a builder; nothing when nothing is being built', / · waiting for a builder$/.test(K._chipText({ ...data, waiting: true }, 0)) && K._chipText({ ...data, sites: [] }, 0) === '' && K._chipText(null) === '');
  check('3c. sooner and later swap neighbours; the ends stay put', K._moved([1, 2, 3], 1, -1).join() === '2,1,3' && K._moved([1, 2, 3], 1, 1).join() === '1,3,2' && K._moved([1, 2, 3], 0, -1).join() === '1,2,3' && K._moved([1, 2, 3], 2, 1).join() === '1,2,3');
  check('3d. the list reorders with buttons (keyboard and touch), and Cancel says what comes back first',
    /data-action="up"/.test(J) && /data-action="down"/.test(J) && /Cancel\$\{refund \? ` \(back: /.test(J) && /title: `Stop building \$\{s\.label\}\?`/.test(J) && /half: work has begun/.test(J));
  check('3e. what comes back, in pictures', K._costLine({ timber: 40, stone: 20, food: 0 }) === '🪵 40  🪨 20');
  check('3f. the chip is by the town card and in the phone\'s town sheet', /id="kwbt-slot"/.test(read('js/context.js')) && /class="kwc-going"/.test(read('js/context.js')));
  check('3g. reordering and cancelling go to the server; its queue replaces ours', /send\('\/reorder', \{ ids: next \}\)/.test(J) && /send\(`\/sites\/\$\{s\.id\}\/cancel`/.test(J) && /if \(d\.queue\) take\(d\.queue\);/.test(J));
}

console.log('4. In the scenes');
{
  check('4a. a site holds its plot: a building being built is not cleared as stale', /var there = function\(b\) \{ return b\.currentLevel > 0 \|\| !!b\.site; \};/.test(S));
  check('4b. it is drawn as a site, with its name, a bar and the estimate; a click opens the list', /function _buildSiteEl\(slot, building\)/.test(S) && /data-kwbt-bar=/.test(S) && /data-kwbt-eta=/.test(S) && /if \(window\.KWBuild\) KWBuild\.open\(\);/.test(S));
  check('4c. three stages by the work done', K.stage(0) === 0 && K.stage(0.24) === 0 && K.stage(0.25) === 1 && K.stage(0.65) === 1 && K.stage(0.66) === 2 && K.stage(1) === 2
    && /\[data-kwbt-stage="1"\] \.kwbt-s1/.test(CSS) && /\[data-kwbt-stage="2"\] \.kwbt-s2/.test(CSS));
  check('4d. a building being upgraded keeps its picture and its menu, with a sign; no second upgrade meanwhile', /btn\.classList\.add\('kwbt-upgrading'\)/.test(S) && /class="kwbt-sign"/.test(S) && /o\.currentLevel < o\.maxLevel && !o\.site/.test(S));
  check('4e. a home being built stands on its plot in the Neighbourhood; nothing else can go there', /function siteHtml\(x\)/.test(N) && /kwn-slot kwn-building/.test(N) && /if \(slot\.classList\.contains\('kwn-building'\)\)/.test(N) && /\.\.\.\(hood\.sites \|\| \[\]\)\.map\(x => x\.plot\)/.test(N));
  check('4f. both scenes follow the queue (ordered on another device, finished, cancelled)', /window\.addEventListener\('kw:build'/.test(S) && /global\.addEventListener\('kw:build'/.test(N) && /construction\(ev\) \{ if \(global\.KWBuild\) global\.KWBuild\.onEvent\(ev\); \}/.test(read('js/realtime.js')));
  check('4g. finished: the buildings, homes and stores are read again and a line says who built it', /function finished\(ev\)/.test(J) && /global\.loadBuildings\(\)/.test(J) && /global\.KWHood\.reload\(\)/.test(J) && /ev\.text/.test(J));
  check('4h. bars move once a second and stop under reduced motion; the server is asked when the first should be done',
    /setInterval\(\(\) => \{ if \(S\.data && S\.data\.sites\.length && !doc\.hidden/.test(J) && /p\[0\]\.pct >= 1 && now\(\) - S\.asked > 4000/.test(J) && /prefers-reduced-motion: reduce\) \{ \.kwbt-bar > i \{ transition: none; \} \}/.test(CSS));
  check('4i. the script is on the page before the scenes use it', H.indexOf('/js/construction.js?v=') > 0 && H.indexOf('/js/construction.js?v=') < H.indexOf('/js/villager-engine.js?v='));
}

console.log('5. Dev Tools');
{
  const L = read('js/life-admin.js');
  check('5a. on for this town, on for every town (asked twice), finish a site now, set the builders', /data-kwld="bt-town"/.test(L) && /data-kwld="bt-all"/.test(L) && /data-kwld="bt-finish"/.test(L) && /data-kwld="bt-builders"/.test(L)
    && /Turn building time on for EVERY town\?/.test(L) && /\/admin\/switch/.test(L) && /\/admin\/finish/.test(L) && /\/admin\/builders/.test(L) && /\/admin\/town/.test(L));
  check('5b. the game follows at once (the Builder job, the queue, the scenes)', /gd\.settlement\.building_time = !!d\.queue\.on/.test(L) && /global\.KWBuild\.load\(\)/.test(L));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
