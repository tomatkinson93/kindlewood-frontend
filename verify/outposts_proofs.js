'use strict';
// Upgrading an outpost from its tile panel (js/main.js _outpostSectionHtml).
//   node verify/outposts_proofs.js
//   1. My outpost shows its level, what it makes now and the next level.
//   2. The upgrade button: cost chips (bronze by icon or ??), and why not.
//   3. At the top level; before the status has loaded.
//   4. Wiring: the click posts to /upgrade and refreshes the panel.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const MAIN = read('js/main.js');
// One top-level function (or const) from main.js, up to its closing brace.
const take = start => { const i = MAIN.indexOf(start); if (i < 0) throw new Error('missing ' + start); return MAIN.slice(i, MAIN.indexOf('\n}', i) + 2); };
const takeObj = start => { const i = MAIN.indexOf(start); return MAIN.slice(i, MAIN.indexOf('\n};', i) + 3); };

function makeEnv(status, have, discovered) {
  const refreshed = [];
  const w = {
    console, Set, Object, Math, Number, JSON,
    gameData: { settlement: { discovered: discovered || [] } },
    _outpostStatus: status,
    _liveResources: () => have,
    _refreshOutpostStatus: t => refreshed.push(t),
  };
  w.window = w; vm.createContext(w);
  vm.runInContext(read('js/resource-defs.js'), w);
  vm.runInContext([
    "const RES_GLYPHS = { food: '🍎', timber: '🪵', stone: '🪨', metal: '⚙️', wealth: '🪙' };",
    takeObj('const OUTPOST_ICONS = {'),
    // _resIcon stand-in (js/resources.js): the registry icon, or ?? until discovered.
    "function _resIcon(k) { const R = KWResources, kn = R.knownSet(gameData.settlement.discovered); return R.isKnown(k, kn) ? R.icon(k) : '??'; }",
    take('function _yieldChips('), take('function _oreChips('), take('function _costChips('),
    take('function _outpostSectionHtml('), take('function _outpostUpgradeHtml('),
    'const _opRefreshedFor = new Set();',
    'this.section = _outpostSectionHtml;',
  ].join('\n'), w);
  return { w, refreshed };
}

const HILLS = { name: 'Quarry', yields: { stone: 5 }, ores: { copper: 0.6, tin: 0.5, coal: 0.8 } };
const mine = (over) => Object.assign({
  id: 11, terrain: 'hills', level: 1, max_level: 3, name: 'Quarry',
  yields: { stone: 5 }, ores: { copper: 0.6, tin: 0.5, coal: 0.8 }, upkeep_food_per_hr: 1,
  next: { level: 2, cost: { timber: 360, stone: 180, wealth: 90 }, yields: { stone: 10 }, ores: { copper: 1.2, tin: 1, coal: 1.6 }, upkeep_food_per_hr: 2, tier: null, tierMet: true },
}, over || {});
const tile = { q: 3, r: 4, terrain: 'hills', outpost: { id: 11, terrain: 'hills', level: 1, mine: true } };
const RICH = { timber: 999, stone: 999, wealth: 999, bronze: 0 };

console.log('1. My outpost');
{
  const { w } = makeEnv({ config: { hills: HILLS }, outposts: [mine()], upkeep_food_per_hr: 1 }, RICH, ['copper']);
  const h = w.section(tile);
  check('1a. its level, out of three', /Quarry <span class="op-level">Lv 1\/3<\/span>/.test(h));
  check('1b. what it makes now (and ores, named once found)', /🪨 \+5\/hr/.test(h) && /\+0\.6\/hr/.test(h) && /\?\? ×2/.test(h) && /−1\/hr upkeep/.test(h));
  check('1c. the next level: more of each, more upkeep', /Level 2<\/div>/.test(h) && /🪨 \+10\/hr/.test(h) && /\+1\.2\/hr/.test(h) && /−2\/hr upkeep/.test(h));
  check('1d. its cost and an enabled Upgrade button', /🪵 360/.test(h) && /data-op-upgrade="11" >Upgrade to Lv 2/.test(h));
  check('1e. dismantling is still there', /data-op-dismantle="11"/.test(h));
}

console.log('2. Why not');
{
  const lv3 = mine({ level: 2, next: { level: 3, cost: { timber: 540, stone: 270, wealth: 135, bronze: 15 }, yields: { stone: 15 }, ores: {}, upkeep_food_per_hr: 3, tier: 'town', tierMet: false } });
  let e = makeEnv({ config: { hills: HILLS }, outposts: [lv3] }, RICH, []);
  let h = e.w.section(tile);
  check('2a. Lv3 in a Village: needs a Town, button disabled', /data-op-upgrade="11" disabled>Upgrade to Lv 3/.test(h) && /Level 3 needs a Town\./.test(h));
  check('2b. bronze shows as ?? before it is discovered', /op-chip-short">\?\? 15/.test(h));
  e = makeEnv({ config: { hills: HILLS }, outposts: [{ ...lv3, next: { ...lv3.next, tierMet: true } }] }, RICH, ['bronze']);
  h = e.w.section(tile);
  check('2c. a Town short of bronze: "Not enough resources", the bronze chip red', /Not enough resources\./.test(h) && /op-chip-short">🟤|op-chip-short">\S+ 15/.test(h) && /disabled>Upgrade to Lv 3/.test(h));
}

console.log('3. Edges');
{
  const top = makeEnv({ config: { hills: HILLS }, outposts: [mine({ level: 3, next: null, upkeep_food_per_hr: 3 })] }, RICH, []);
  const h = top.w.section(tile);
  check('3a. at Lv3: "At its highest level", no button', /At its highest level\./.test(h) && !/data-op-upgrade/.test(h) && /Lv 3\/3/.test(h));
  const fresh = makeEnv({ config: { hills: HILLS }, outposts: [] }, RICH, []);
  const h2 = fresh.w.section(tile);
  fresh.w.section(tile);
  check('3b. just founded: shows Lv1 from the config and fetches the status once', /Lv 1\/3/.test(h2) && /🪨 \+5\/hr/.test(h2) && fresh.refreshed.length === 1);
}

console.log('4. Wiring');
{
  check('4a. the button posts to /upgrade', /apiFetch\(`\/api\/game\/outposts\/\$\{id\}\/upgrade`, \{ method: 'POST' \}\)/.test(MAIN));
  check('4b. …then syncs the top bar, the status and the map tile, and re-renders', /_upgradeOutpost[\s\S]*?_applyOutpostResponse\(data\);[\s\S]*?_outpostStatus\.outposts = [\s\S]*?t\.outpost\.level = data\.outpost\.level[\s\S]*?selectWorldTile\(tile\)/.test(MAIN));
  check('4c. wired with the other outpost buttons', /querySelector\('\[data-op-upgrade\]'\)/.test(MAIN) && /_upgradeOutpost\(upBtn, tile\)/.test(MAIN));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
