'use strict';
// Withered raids and village trust on the client: the raid banner
// (js/raids.js), the Watchtower line (js/settlement-view.js), the village
// panel's decay warning and Allied tribute (js/diplomacy.js), Dev Tools, Help.
//   node verify/raids_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
// Dev Tools' markup lives in dev.html since Phase 4 step 5 (loaded for admins
// only, js/dev-tools.js): reading the page includes it.
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8') + (f === 'index.html' ? '\n' + fs.readFileSync(path.join(ROOT, 'dev.html'), 'utf8') : '');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const els = {};
const doc = { getElementById: id => els[id] || null };
const w = { console, Date, Math, Number, document: doc, setInterval: () => 1, clearInterval: () => {}, showToastNotification: (m) => { w._toast = m; }, gameData: { settlement: {} }, apiFetch: async () => ({ ok: false }) };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/raids.js'), w);
const R = w.KWRaids;

console.log('1. The raid countdown');
{
  els['raid-chip'] = { hidden: true, className: 'raid-chip', innerHTML: '', title: '' };
  const raid = { id: 4, from: 'Rot Warren', target: 'the Quarry', outpost_id: 11, strength_min: 40, strength_max: 70,
    warned_at: new Date(Date.now() - 3600e3).toISOString(), arrives_at: new Date(Date.now() + (4 * 3600 + 12 * 60 + 9) * 1000 + 300).toISOString(),
    from_at: { q: 10, r: 4 }, target_at: { q: 12, r: 5 } };
  R.onSettlement({ raid });
  const c = els['raid-chip'];
  check('1a. a red chip in the top bar: 🔥 Raid 4:12:09', c.hidden === false && /🔥/.test(c.innerHTML) && /raid-chip-clock">4:12:0[89]</.test(c.innerHTML));
  check('1b. it sits in the top bar and opens the raid sheet', /<button type="button" id="raid-chip" class="raid-chip" hidden onclick="KWRaids\.openSheet\(\)"/.test(read('index.html')) && read('index.html').indexOf('id="raid-chip"') < read('index.html').indexOf('id="season-badge"'));
  check('1c. no raid banner over the map any more', !/raid-banner/.test(read('index.html')));
  check('1d. the settlement remembers it (outpost panel and map trail read it)', w.gameData.settlement.raid && w.gameData.settlement.raid.id === 4 && R.state().raid.id === 4);
  R._setInfo({ active: raid, defence: { kind: 'outpost', fort: 25, garrison: 9, own: 34, militia: 15, town: 0, land: 0, clan: 0, total: 49, undefended: false }, tribute: { cost: 400 }, full_raid: { food: 2000, timber: 300 } });
  const sh = R._sheetHtml();
  check('1e. the sheet: clock, scouted range vs your defence, the breakdown', /id="raid-sheet-clock"/.test(sh) && /<b>40–70<\/b>/.test(sh) && /<small>Your defence<\/small><b>49<\/b>/.test(sh) && /🏯 Fort<\/span><b>25/.test(sh) && /Allied militia<\/span><b>15/.test(sh));
  check('1f. …a verdict, what a full raid takes, and tribute', /It could go either way/.test(sh) && /🍎 2,000/.test(sh) && /Pay 400 to turn them back/.test(sh));
  R._setInfo({ active: raid, defence: { kind: 'town', walls: 0, watch: 0, own: 0, total: 0, undefended: true }, tribute: { cost: 400 } });
  check('1g. undefended says so', /Undefended — they will take everything/.test(R._sheetHtml()));
  R.onSettlement({ raid: null });
  check('1h. gone when there is none', c.hidden === true);
  R.onEvent({ type: 'raid_resolved', raid: { outcome: 'partial' }, message: '🔥 They broke through.' });
  check('1i. the outcome arrives as a toast', /broke through/.test(w._toast));
  check('1j. both load paths call it; realtime too', /KWRaids\.onSettlement\(data\.settlement\)/.test(read('js/game.js')) && /KWRaids\.onSettlement\(gameData\.settlement\)/.test(read('js/main.js'))
    && /raid_warning\(ev\) \{ if \(global\.KWRaids\)/.test(read('js/realtime.js')));
}

console.log('1a. Call to arms');
{
  els['call-chip'] = { hidden: true, innerHTML: '', title: '' };
  const call = { raid_id: 9, town: 'Oakhollow', target: 'the Farmstead', from: 'Rot Warren', arrives_at: new Date(Date.now() + 2 * 3600e3).toISOString(), mine: false,
    reinforcements: [{ id: 3, name: 'Pike', from_town: 'Fernby' }], max_total: 6, max_per_member: 2 };
  R._setCalls([call, { ...call, raid_id: 10, mine: true }]);
  check('1o. an amber Call to arms chip when a clanmate needs help (not for your own raid)', els['call-chip'].hidden === false && /📯/.test(els['call-chip'].innerHTML) && !/<b>2<\/b>/.test(els['call-chip'].innerHTML));
  const h = R._callsHtml();
  check('1p. the calls sheet: town, target, time, who is holding it', /<b>Oakhollow<\/b>/.test(h) && /the Farmstead/.test(h) && /Holding it: Pike \(Fernby\)/.test(h) && /1\/6/.test(h));
  check('1q. sending posts to /reinforce', /\/api\/raids\/\$\{raidId\}\/reinforce/.test(read('js/raids.js')) && /id="call-chip"/.test(read('index.html')));
  check('1r. realtime: clan_call_to_arms and raid_reinforced reach KWRaids', /clan_call_to_arms\(ev\) \{ if \(global\.KWRaids\)/.test(read('js/realtime.js')) && /raid_reinforced\(ev\) \{ if \(global\.KWRaids\)/.test(read('js/realtime.js')));
  check('1s. clan activity: call to arms and reinforcements', /case 'call_to_arms':/.test(read('js/clans.js')) && /case 'reinforced':/.test(read('js/clans.js')));
  R._setCalls([]);
}

console.log('1c. Sally out and camps');
{
  const base = { id: 4, from: 'Rot Warren', target: 'the Quarry', strength_min: 40, strength_max: 70, arrives_at: new Date(Date.now() + 3600e3).toISOString() };
  w.citizensData = [];
  check('1t. sally: lost → "come on stronger"; waiting → Fight now', /driven back/.test(R._sallyHtml({ ...base, sally: 'lost' })) && /KWRaids\.fightSally\(77\)/.test(R._sallyHtml({ ...base, sally: 'fighting', sally_run_id: 77 })));
  check('1u. sally posts to /sally and opens the battle', /\/api\/raids\/\$\{raidId\}\/sally/.test(read('js/raids.js')) && /startBattleFromQuest\(runId\)/.test(read('js/raids.js')));
  const M = read('js/main.js');
  check('1v. a camp tile: strength, a party of four, Burn the camp', /function _campSectionHtml\(tile\)/.test(M) && /if \(tile\.camp\) return _campSectionHtml\(tile\);/.test(M) && /\[0, 1, 2, 3\]\.map/.test(M) && /data-camp-assault=/.test(M) && /\/api\/raids\/camps\/\$\{btn\.dataset\.campAssault\}\/assault/.test(M));
  check('1w. camps are marked on the map', /function drawCamps\(/.test(read('js/kwmap-raid.js')) && /'⛺'/.test(read('js/kwmap-raid.js')));
  check('1x. Dev Tools: spawn camps; Help explains camps, sallies and calls to arms', /KWRaids\.devSpawnCamps\(\)/.test(read('index.html')) && /Withered camps<\/b>/.test(read('js/help.js')) && /sally out<\/b>/.test(read('js/help.js')) && /call to arms<\/b>/.test(read('js/help.js')));
}

console.log('1b. The red trail');
{
  const L = read('js/kwmap-raid.js'), CORE = read('js/kwmap-core.js');
  check('1k. drawn each frame after the travel layer', /window\.KWRaidLayer\.draw\(this\._uifxCtx, prep\.W, prep\.H, r, camera, now\)/.test(CORE) && /kwmap-raid\.js\?v=/.test(read('index.html')));
  check('1l. no network, no randomness in the map layer', !/apiFetch|fetch\(|Math\.random/.test(L));
  const ctxCalls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => ctxCalls.push(k)), set: (t, k, v) => { t[k] = v; ctxCalls.push('set:' + k); return true; } });
  const m = { console, Date, Math, Proxy, matchMedia: () => ({ matches: false }) };
  m.window = m; vm.createContext(m);
  vm.runInContext(L, m);
  m.KWRaids = { state: () => ({ raid: null }) };
  m.KWRaidLayer.draw(ctx, 800, 600, { projectAxial: (q, r) => ({ x: q * 10, y: r * 10, hexW: 48 }) }, {}, 0);
  check('1m. nothing on its way: the canvas is untouched', ctxCalls.length === 0);
  m.KWRaids = { state: () => ({ raid: { from_at: { q: 10, r: 4 }, target_at: { q: 12, r: 5 }, warned_at: new Date(Date.now() - 1000).toISOString(), arrives_at: new Date(Date.now() + 1000).toISOString() } }) };
  m.KWRaidLayer.draw(ctx, 800, 600, { projectAxial: (q, r) => ({ x: q * 10, y: r * 10, hexW: 48 }) }, {}, 0);
  check('1n. a raid on its way: a dashed trail, the raiders and a ring', ctxCalls.includes('setLineDash') && ctxCalls.includes('lineTo') && ctxCalls.includes('arc') && ctxCalls.includes('fillText'));
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
check('3a. the Watchtower and Walls panel: town defence and a raid on its way', /Raiders from ' \+ raid\.from \+ ' are on their way to/.test(read('js/settlement-view.js')) && /Town defence/.test(read('js/settlement-view.js')));
check('3b. Dev Tools: start (target, minutes, strength), cancel, strike, clear cooldown, roll the check, camps, status', ['devStart()', 'devSend(2)', 'devCancel()', 'devResolve()', 'devClearCooldown()', 'devPeaceClear()', 'devCheck(100)', 'devSpawnCamps()', 'devClearCamps()', 'devStatus()'].every(f => read('index.html').includes('KWRaids.' + f))
  && /id="dev-raid-target"/.test(read('index.html')) && /id="dev-raid-min"/.test(read('index.html')) && /id="dev-raid-str"/.test(read('index.html')) && /id="dev-raid-status"/.test(read('index.html')));
{
  const J = read('js/raids.js');
  check('3d. each control hits its admin route', ['/api/raids/admin/send', '/api/raids/admin/cancel', '/api/raids/admin/resolve', '/api/raids/admin/check', '/api/raids/admin/clear-cooldown', '/api/raids/admin/camps/clear', '/api/raids/admin/status'].every(p => J.includes(`'${p}'`)));
  const h = R._devStatusHtml({ active: { from: 'Rot Warren', target: 'the Quarry', strength: 77, arrives_at: new Date(Date.now() + 1800e3).toISOString() }, peace_until: null, cooldown_until: null, camps: 2, why_not: ['A raid is already on its way.'], chance: 0.0014 });
  check('3e. the status line: exact strength, peace, cooldown, camps, why the check would skip you', /strength <b>77<\/b>/.test(h) && /No peace/.test(h) && /No cooldown/.test(h) && /2 camps/.test(h) && /would skip you: A raid is already/.test(h));
  check('3f. eligible: the odds of the normal check', /Eligible — each 10-minute check has a 0\.14% chance/.test(R._devStatusHtml({ active: null, camps: 0, why_not: [], chance: 0.0014 })));
  els['raid-chip'].hidden = false; R.onSettlement({ raid: { id: 5, arrives_at: new Date(Date.now() + 1e6).toISOString() } });
  R.onEvent({ type: 'raid_cancelled', raid: { id: 5 } });
  check('3g. a cancelled raid clears the chip (realtime too)', els['raid-chip'].hidden === true && /raid_cancelled\(ev\) \{ if \(global\.KWRaids\)/.test(read('js/realtime.js')));
}
check('3c. Help explains trust, defences, graded raids and tribute', /id: 'raids'/.test(read('js/help.js')) && /Stone Tower/.test(read('js/help.js')) && /15% of each resource/.test(read('js/help.js')) && /tribute<\/b> for 24 hours/.test(read('js/help.js')) && /never below the band/.test(read('js/help.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
