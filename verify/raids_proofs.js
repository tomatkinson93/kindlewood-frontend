'use strict';
// Withered raids and village trust on the client: the raid banner
// (js/raids.js), the Watchtower line (js/settlement-view.js), the village
// panel's decay warning and Allied tribute (js/diplomacy.js), Dev Tools, Help.
//   node verify/raids_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const els = {};
const doc = { getElementById: id => els[id] || null };
const w = { console, Date, Math, document: doc, setInterval: () => 1, clearInterval: () => {}, showToastNotification: (m) => { w._toast = m; }, gameData: { settlement: {} }, apiFetch: async () => ({ ok: false }) };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/raids.js'), w);
const R = w.KWRaids;

console.log('1. The raid banner');
{
  els['raid-banner'] = { className: 'raid-banner', innerHTML: '' };
  const raid = { id: 4, from: 'Rot Warren', target: 'the Quarry', outpost_id: 11, arrives_at: new Date(Date.now() + (4 * 60 + 12) * 60000 + 20000).toISOString() };
  R.onSettlement({ raid });
  const b = els['raid-banner'];
  check('1a. while a raid is on its way: open, from whom, where, how long', /open/.test(b.className) && /Raiders coming/.test(b.innerHTML) && /From Rot Warren — they strike the Quarry in 4h 12m/.test(b.innerHTML));
  check('1b. it shares the map-banners stack', /<div id="raid-banner" class="raid-banner"/.test(read('index.html')) && read('index.html').indexOf('id="raid-banner"') > read('index.html').indexOf('id="map-banners"'));
  check('1c. with the defence once known', /your defence 31/.test(R._bannerHtml(raid, { total: 31 })));
  check('1d. the settlement remembers it (outpost panel reads it)', w.gameData.settlement.raid && w.gameData.settlement.raid.id === 4);
  R.onSettlement({ raid: null });
  check('1e. gone when there is none', b.className === 'raid-banner' && b.innerHTML === '');
  R.onEvent({ type: 'raid_resolved', raid: { outcome: 'repelled' }, message: '🛡️ The raiders broke against your defences.' });
  check('1f. the outcome arrives as a toast', /broke against your defences/.test(w._toast));
  check('1g. both load paths call it', /KWRaids\.onSettlement\(data\.settlement\)/.test(read('js/game.js')) && /KWRaids\.onSettlement\(gameData\.settlement\)/.test(read('js/main.js')));
  check('1h. realtime raid_warning / raid_resolved', /raid_warning\(ev\) \{ if \(global\.KWRaids\)/.test(read('js/realtime.js')) && /raid_resolved\(ev\) \{ if \(global\.KWRaids\)/.test(read('js/realtime.js')));
}

console.log('2. Villages');
{
  const D = read('js/diplomacy.js');
  check('2a. a decay warning under the trust bar', /data\.decay_warning \? `<div class="diplo-decay/.test(D));
  check('2b. Allied: today\'s tribute with Collect, or collected', /_tributeHtml\(npcId, data\.tribute\)/.test(D) && /onclick="diplomacyCollectTribute\(\$\{npcId\}, this\)">Collect/.test(D) && /Collected — more tomorrow/.test(D));
  check('2c. it posts to /tribute and refreshes the stores', /apiFetch\(`\/api\/diplomacy\/\$\{npcId\}\/tribute`, \{ method: 'POST' \}\)/.test(D) && /startResourceTick/.test(D));
  check('2d. the Allied milestone names what it really gives', /a daily tribute · their militia guards your outposts nearby · fighting cards/.test(D) && !/Shared Scouts/.test(D));
}

console.log('3. Elsewhere');
check('3a. the Watchtower panel mentions a raid on its way', /Raiders from ' \+ raid\.from \+ ' are on their way to/.test(read('js/settlement-view.js')));
check('3b. Dev Tools: send (6h or 2 min) and resolve', /KWRaids\.devSend\(\)/.test(read('index.html')) && /KWRaids\.devSend\(2\)/.test(read('index.html')) && /KWRaids\.devResolve\(\)/.test(read('index.html')));
check('3c. Help explains trust, tribute and raids', /id: 'raids'/.test(read('js/help.js')) && /6 hours' warning/.test(read('js/help.js')) && /never below the band/.test(read('js/help.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
