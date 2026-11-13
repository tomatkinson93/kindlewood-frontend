'use strict';
// The life cycle in the client (docs/PHASE_1_LIFE_CYCLE.md §6). Step 2:
// ages and stages from the server, the settlement panel's counts and beds.
//   node verify/life_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const C = read('js/citizens.js'), M = read('js/main.js'), G = read('js/game.js');

console.log('1. Stage tags (js/citizens.js)');
{
  const src = /\/\/ Life stage from the server[\s\S]*?\nfunction _stageTag[\s\S]*?\n\}/.exec(C);
  check('1a. _stageTag exists', !!src);
  const w = {}; vm.createContext(w); vm.runInContext(src ? src[0] : '', w);
  const t = c => w._stageTag(c), s = c => w._stageTag(c, true);
  check('1b. youths, elders and children get a tag; adults none', /Youth</.test(t({ stage: 'youth' })) && /Elder</.test(t({ stage: 'elder' })) && /Child</.test(t({ stage: 'child' })) && t({ stage: 'adult' }) === '');
  check('1c. the short form for list rows is lower case', />youth</.test(s({ stage: 'youth' })));
  check('1d. the profile, the citizen list and the All Citizens table show it', (C.match(/_stageTag\(c/g) || []).length >= 3);
  check('1e. ages come from the server (life.age is the computed age; no client-side age maths)', /c\.life\?\.age/.test(C) && !/born_at\)\s*\/\s*\(?\s*28/.test(C));
}

console.log('2. The settlement panel (js/main.js)');
{
  check('2a. counts use the server\'s stage', /const stageOf\s+= c => c\.stage \|\|/.test(M));
  check('2b. the dead are left out', /const living\s+= citizens\.filter\(c => stageOf\(c\) !== 'deceased'\)/.test(M));
  check('2c. Children, Youths, Adults and Elders', /sett-stat-key">Children</.test(M) && /sett-stat-key">Youths</.test(M) && /sett-stat-key">Adults</.test(M) && /sett-stat-key">Elders</.test(M));
  check('2d. "Beds living/beds" from the settlement', /🛏 Beds <b>' \+ living\.length \+ '\/' \+ beds/.test(M) && /gameData\.settlement\.beds/.test(M));
  check('2e. the 5-minute sync keeps population and beds fresh', /gameData\.settlement\.beds = data\.settlement\.beds/.test(G));
}

console.log('3. Apprenticeship and elders (step 3)');
{
  const src = /\/\/ ── Apprenticeship \(youths[\s\S]*?\nfunction _apprenticeHtml[\s\S]*?\n\}\n/.exec(C);
  check('3a. _apprenticeHtml exists', !!src);
  const w = {
    KWCareers: { defs: () => ({ classes: { miner: { key: 'miner', label: 'Miner', icon: '⛏', assignable: true }, farmer: { key: 'farmer', label: 'Farmer', icon: '🌾', assignable: true }, merchant: { key: 'merchant', label: 'Merchant', icon: '⚖', assignable: false } } }),
      roleIcon: () => '⛏', roleLabel: () => 'Miner' },
    citizensData: [{ id: 2, name: 'Moss <b>', role: 'miner', stage: 'adult', class_levels: { miner: 6 } }, { id: 3, name: 'Old Fern', role: 'miner', stage: 'elder' }, { id: 4, name: 'Kid', role: 'miner', stage: 'youth' }],
  };
  w.window = w; vm.createContext(w);
  vm.runInContext(src ? src[0] + '\nthis._apprenticeHtml = _apprenticeHtml;' : '', w);
  const h = w._apprenticeHtml({ id: 9, apprentice: { class_key: 'miner', chosen: false, mentor_id: 2, mentor_name: 'Moss <b>', rate: 1, level: 2, pct: 40, hint: 'Seems restless at the miner\'s work.' } });
  check('3b. shows the trade, level and progress', /Apprentice ⛏ Miner · Lv 2/.test(h) && /kw-bar"><span style="width:40%/.test(h));
  check('3c. says it follows a parent\'s trade, and who teaches them (escaped)', /Following a parent's trade/.test(h) && /Taught by <strong>Moss &lt;b&gt;<\/strong>/.test(h));
  check('3d. a trade picker with assignable trades only; the mentor picker lists adults and elders of that trade', /value="miner" selected/.test(h) && /value="farmer"/.test(h) && !/value="merchant"/.test(h)
    && /<option value="2">Moss &lt;b&gt; · Lv 6/.test(h) && /<option value="3">Old Fern/.test(h) && !/<option value="4">/.test(h));
  check('3e. the hint shows', /🔎 Seems restless/.test(h));
  check('3f. both pickers post to the apprentice route', /setApprenticeship\(9, this\.value, null\)/.test(h) && /\/api\/citizens\/\$\{id\}\/apprentice/.test(C));
  const none = w._apprenticeHtml({ id: 9, apprentice: { class_key: null, rate: 0 } });
  check('3g. no trade yet: asks for one, no mentor picker', /Choose a trade…/.test(none) && !/aria-label="Mentor"/.test(none));
  const half = w._apprenticeHtml({ id: 9, apprentice: { class_key: 'miner', chosen: true, mentor_id: null, rate: 0.5 } });
  check('3h. without a mentor it says they learn at half the rate', /learning at half the rate/.test(half) && /Chosen by you/.test(half));
  check('3i. youths see it in place of the child-labour note; elders get a note', /c\.stage === 'youth' \? _apprenticeHtml\(c\)/.test(C) && /cp-elder-note">🦉 An elder/.test(C));
}

console.log('4. Memorials and inheritances (step 4)');
{
  const L = read('js/life.js'), E = read('js/events.js'), H = read('index.html');
  const w = { console }; w.window = w; vm.createContext(w);
  vm.runInContext(L, w);
  const open = w.KWLife._bodyHtml({ id: 1, name: 'Hazel <Ashby>', memorial: 'Hazel <Ashby> passed away peacefully at 78. They were head of the Ashby family.',
    inheritance: { status: 'open', heir_id: 3, default_heir_id: 3, settle_at: new Date(Date.now() + 5 * 3600e3).toISOString(), trade: 'miner', xp: 4000,
      items: ["Hazel's Iron Pick"], candidates: [{ id: 3, name: 'Rowan', relation: 'child', adult: true }, { id: 4, name: 'Tobias', relation: 'partner', adult: true }, { id: 5, name: 'Pip', relation: 'family', adult: false }] } });
  check('4a. the memorial line, escaped', /kwl-memorial">Hazel &lt;Ashby&gt; passed away peacefully at 78/.test(open));
  check('4b. the heirlooms are listed with what they do', /Hazel&#39;s Iron Pick/.test(open) && /\+5%, more with each generation/.test(open));
  check('4c. an heir picker: the default chosen, relations named, children marked', /<option value="3" selected>Rowan \(their child\)/.test(open) && /<option value="4">Tobias \(their partner\)/.test(open) && /Pip \(family, a child\)/.test(open));
  check('4d. "Pass them on now", and what happens if you do nothing (never punish being away)', /data-action="pass">Pass them on now/.test(open) && /If you do nothing, Rowan inherits in about 5 hours/.test(open));
  check('4e. the knowledge rule is explained when there is XP in a trade', /also learns a quarter of what they knew/.test(open));
  const done = w.KWLife._bodyHtml({ id: 1, name: 'Hazel', memorial: 'm', inheritance: { status: 'settled', heir_name: 'Rowan', items: [] } });
  check('4f. once settled it says who took them up', /Rowan took up their things/.test(done) && !/data-kwl="heir"/.test(done));
  check('4g. it is a KWWindow (size S) posting to the heir route', /KWWindow\.open\(\{/.test(L) && /size: 'S'/.test(L) && /\/api\/citizens\/\$\{id\}\/heir/.test(L));
  check('4h. memorial events open their notice', /type === 'memorial'/.test(E) && /KWLife\.onEvent\(memorial\)/.test(E) && /\/js\/life\.js\?v=/.test(H));
  check('4i. the dead are kept out of citizensData (no picker offers them)', /citizensData = all\.filter\(c => c\.life_stage !== 'deceased'\)/.test(C) && /citizensRemembered = all\.filter\(c => c\.life_stage === 'deceased'\)/.test(C));
  check('4j. a Remembered filter lists them, each opening the memorial', /cpanelFilter\('remembered',this\)" aria-label="Remembered"/.test(H) && /KWLife\.openMemorial\(\$\{c\.id\}\)/.test(C) && /their things wait for an heir/.test(C));
  check('4k. the profile shows heirlooms and their bonus', /function _heirloomsHtml/.test(C) && /\$\{_heirloomsHtml\(c\)\}/.test(C));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
