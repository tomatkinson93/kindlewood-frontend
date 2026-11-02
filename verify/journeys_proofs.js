'use strict';
// Journeys (js/journeys.js), scout recall, reopening the away report, and
// Crafting in the settlement panel.
//   node verify/journeys_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const w = { console, Date, Math, Number, String, Promise, setInterval: () => 1, clearInterval: () => {}, localStorage: { getItem: () => null, setItem() {} } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/travel.js'), w);
vm.runInContext(read('js/village-requests.js'), w);
vm.runInContext(read('js/journeys.js'), w);
const J = w.KWJourneys;
const now = Date.parse('2026-11-02T12:00:00Z');

console.log('1. On the road');
{
  const scout = { id: 'scout:7', kind: 'scout', icon: '🗺', expedition_id: 7, citizen: { name: 'Wren' }, from: { q: 0, r: 0 }, to: { q: 10, r: 0 },
    departs_at: new Date(now - 60e3).toISOString(), arrives_at: new Date(now + 60e3).toISOString(), returns_at: null, title: 'Scouting (10, 0)', detail: 'Reveals the land' };
  const h = J._rowHtml(scout, now);
  check('1a. who, what, how far along, time left', /<b>Wren<\/b> · Scouting \(10, 0\)/.test(h) && /width:50%/.test(h) && /data-jn-end="[^"]+">1m 00s</.test(h));
  check('1b. Show on map and Recall for a scout', /data-jn-map="scout:7">Show on map/.test(h) && /data-jn-recall="7">↩ Recall/.test(h));
  check('1c. no Recall once recalled, nor for other travellers', !/data-jn-recall/.test(J._rowHtml({ ...scout, recalled: true }, now)) && !/data-jn-recall/.test(J._rowHtml({ ...scout, kind: 'envoy' }, now)));
  const trip = { ...scout, id: 'market:3', kind: 'market', departs_at: new Date(now - 120e3).toISOString(), arrives_at: new Date(now - 60e3).toISOString(), returns_at: new Date(now + 60e3).toISOString() };
  check('1d. a round trip on its way back says so', /Coming home/.test(J._rowHtml(trip, now)));
  const p = J._whereNow(scout, now);
  check('1e. Show on map goes to where they are now (halfway)', p.q === 5 && p.r === 0, JSON.stringify(p));
}

console.log('2. Outposts and requests');
{
  w.KWResources = { label: k => k === 'copper' ? 'Copper' : k };
  const body = J._bodyHtml([], [{ name: 'Quarry', tile_q: 4, tile_r: 2, workers: [{ name: 'Pike' }], garrison: [{ name: 'Bram' }] }],
    [{ npc: { id: 9, name: 'Burrowmere' }, kind: 'resource', resource: 'copper', qty: 120, remaining: 80, by: 'Friday', trust_bonus: 3 }], true, now);
  check('2a. nobody travelling: "Everyone is at home."', /Everyone is at home\./.test(body));
  check('2b. workers and guards at outposts, each with Show on map', /<b>Pike<\/b> · Working at the Quarry/.test(body) && /<b>Bram<\/b> · Guarding the Quarry/.test(body) && /data-jn-tile="4,2"/.test(body));
  check('2c. village requests: who, what, by when, reward, Fill', /<b>Burrowmere<\/b> needs 120 copper/.test(body) && /By Friday · \+3 trust · 80 left/.test(body) && /data-jn-fill="9">Fill in the Market/.test(body));
  check('2d. no Market: says to build one', /Build a Market to fill it\./.test(J._bodyHtml([], [], [{ npc: { id: 9, name: 'B' }, kind: 'resource', resource: 'copper', qty: 1, remaining: 1, by: 'x' }], false, now)));
  check('2e. KWRequests lists open requests', /all: \(\) => _list\.filter\(r => r\.remaining > 0\)/.test(read('js/village-requests.js')));
}

console.log('3. Wiring');
{
  const JS = read('js/journeys.js'), M = read('js/main.js'), H = read('index.html');
  check('3a. Recall confirms in-game, then posts to /recall', /KWDialog\.confirm\(\{ title: 'Call this scout home\?'/.test(JS) && /\/api\/expeditions\/\$\{id\}\/recall/.test(JS));
  check('3b. a modal dialog with a labelled close button', /role="dialog" aria-modal="true" aria-labelledby="jn-title"/.test(JS) && /class="jn-close" aria-label="Close"/.test(JS));
  check('3c. opened from the settlement panel, the More sheet and the scouts badge', /KWJourneys\.open\(\)">🧭 Journeys/.test(M) && /label: 'Journeys'/.test(read('js/mobile-shell.js')) && /badge\.onclick = \(\) => \{ if \(window\.KWJourneys\) window\.KWJourneys\.open\(\); \}/.test(read('js/expeditions.js')));
  check('3d. loaded on the page', /\/js\/journeys\.js\?v=/.test(H) && /\/css\/journeys\.css\?v=/.test(H));
  check('3e. phones: full screen', /body\.kw-shell \.jn-card \{ width: 100%; height: 100%/.test(read('css/journeys.css')));
}

console.log('4. Away report and Crafting');
{
  const A = read('js/away-report.js'), H = read('index.html'), M = read('js/main.js');
  check('4a. the last report is kept and can be reopened', /localStorage\.setItem\(LAST_KEY, JSON\.stringify\(report\)\)/.test(A) && /function reopen\(\)/.test(A) && /KWAwayReport = \{ start, show, last, reopen,/.test(A));
  check('4b. "While you were away" in the events panel', /KWAwayReport\.reopen\(\)"[^>]*>📜 While you were away/.test(H));
  check('4c. 🔨 Crafting in the settlement panel, locked until a crafting station', /_gatedAction\('craft:any', '🔨 Crafting', 'openCraftingAny\(\)'\)/.test(M) && /if \(type === 'craft:any'\) return CRAFT_STATIONS\.some/.test(M) && /const CRAFT_STATIONS = \['smithy', 'workshop', 'jeweller', 'smelter'\]/.test(M));
  check('4d. a recalled scout comes home quietly ("home again", not "new lands")', /back\.every\(e => e\.recalled_at\)/.test(read('js/expeditions.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
