'use strict';
// The life cycle in the client (docs/PHASE_1_LIFE_CYCLE.md §6). Step 2:
// ages and stages from the server, the settlement panel's counts and beds.
//   node verify/life_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
// Dev Tools' markup lives in dev.html since Phase 4 step 5 (loaded for admins
// only, js/dev-tools.js): reading the page includes it.
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8') + (f === 'index.html' ? '\n' + fs.readFileSync(path.join(ROOT, 'dev.html'), 'utf8') : '');
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

console.log('5. The Families screen (step 6)');
{
  const F = read('js/families.js'), A = read('js/away-report.js'), HL = read('js/help.js'), H = read('index.html');
  const w = { console }; w.window = w; vm.createContext(w);
  vm.runInContext(F, w);
  const K = w.KWFamilies;
  const lines = K._linesHtml([
    { id: 7, name: 'Ash<by>', head: { id: 2, name: 'Tobias', age: 74 }, living: [{ id: 2, name: 'Tobias Ashby', stage: 'elder' }, { id: 3, name: 'Wren Ashby', stage: 'youth' }],
      stages: { adult: 0, elder: 1, youth: 1, child: 0 }, remembered: 2, generations: 3, heirlooms: [{ name: "Hazel's Iron Pick" }] },
    { id: 8, name: 'Bramble', head: null, living: [], stages: {}, remembered: 1, generations: 1, heirlooms: [] } ]);
  check('5a. a card per family: name (escaped), head, stages, remembered, heirlooms, generations', /The Ash&lt;by&gt; family/.test(lines) && /Head: <b>Tobias<\/b>, 74/.test(lines)
    && /1 elder · 1 youth/.test(lines) && /🕯 2 remembered/.test(lines) && /Hazel&#39;s Iron Pick/.test(lines) && /3 generations/.test(lines));
  check('5b. a line that has ended says so and is greyed', /kwf-gone/.test(lines) && /The line has ended/.test(lines));
  check('5c. cards open the family (data-action, no inline onclick)', /data-action="family" data-id="7"/.test(lines) && !/onclick=/.test(F));
  const tree = K._treeHtml({ family: { id: 7, name: 'Ashby', head_id: 2 }, partners: [{ id: 9, name: 'Moss Fern', stage: 'adult', age: 40, generation: 2, parent_ids: [], partner_id: 3, outsider: true, born_at: '2026-01-01' }],
    members: [{ id: 1, name: 'Hazel Ashby', stage: 'deceased', age: 76, generation: 1, parent_ids: [], partner_id: 2, born_at: '2025-01-01' },
              { id: 2, name: 'Tobias Ashby', stage: 'elder', age: 74, generation: 1, parent_ids: [], partner_id: 1, born_at: '2025-01-02' },
              { id: 3, name: 'Rowan Ashby', stage: 'adult', age: 40, generation: 2, parent_ids: [1, 2], partner_id: 9, born_at: '2025-06-01' }] });
  check('5d. the tree: a row per generation; partners side by side; the head marked', /Generation 1/.test(tree) && /Generation 2/.test(tree)
    && tree.indexOf('Hazel Ashby') < tree.indexOf('Tobias Ashby') && /Tobias Ashby <span class="kw-chip good">Head/.test(tree));
  check('5e. the dead are greyed and open their memorial; married-in partners shown', /kwf-deceased"? data-action="memorial" data-id="1"|kwf-deceased" data-action="memorial" data-id="1"/.test(tree) && /died at 76/.test(tree) && /married in/.test(tree));
  check('5f. parents named on each child', /child of Hazel &amp; Tobias/.test(tree));
  const ch = K._chronicleHtml([{ id: 5, kind: 'birth', text: 'Wren <was> born.', at: '2026-11-13T10:00:00Z' }], 4);
  check('5g. the chronicle: an icon per kind, escaped text, "Older entries" when there are more', /🍼/.test(ch) && /Wren &lt;was&gt; born\./.test(ch) && /data-action="more"/.test(ch));
  check('5h. empty states say what will be kept', /Births, comings of age, partnerships and passings will be kept here/.test(K._chronicleHtml([], null)) && /No families yet/.test(K._linesHtml([])));
  check('5i. a large KWWindow with three tabs and a help topic', /size: 'L'/.test(F) && /key: 'lines'/.test(F) && /key: 'chronicle'/.test(F) && /key: 'remembered'/.test(F) && /help: 'families'/.test(F) && /id: 'families'/.test(HL));
  check('5j. it reads the families API', /\/api\/families'/.test(F) && /\/api\/families\/\$\{id\}`/.test(F) && /\/chronicle/.test(F));
  check('5k. opened from the citizens panel; the script is on the page', /onclick="KWFamilies\.open\(\)" aria-label="Families"/.test(H) && /\/js\/families\.js\?v=/.test(H));
  check('5l. the away report has a Families tab and summary line', /\['families', '👪', 'Families'\]/.test(A) && /line\('families', '👪', 'Families'/.test(A) && /families: \[\]/.test(A));
}

console.log('6. Dev Tools → Life (step 7)');
{
  const LA = read('js/life-admin.js'), H = read('index.html');
  const w = { console }; w.window = w; vm.createContext(w);
  vm.runInContext(LA, w);
  const D = w.KWLifeDev;
  const st = D._statusHtml({ beds: { beds: 20, living: 18, free: 2 }, stages: { child: 3, youth: 2, adult: 11, elder: 2 }, working: 11, year_hours: 28,
    settler: { at: new Date(Date.now() + 50 * 3600e3).toISOString(), reason: 'the weekly settler' }, inheritances: [{ name: 'Hazel <A>', heir: 'Rowan', settle_at: new Date(Date.now() + 5 * 3600e3).toISOString() }],
    oldest: [{ id: 1, name: 'Old Fern', age: 74, chance: 0.18 }],
    couples: [{ a: { id: 2, name: 'Ada', age: 30 }, b: { id: 3, name: 'Bo', age: 31 }, children: 1, fertile: false, blockers: ['Their last child is still very young'] },
              { a: { id: 4, name: 'Cy', age: 20 }, b: { id: 5, name: 'Di', age: 21 }, children: 0, fertile: true, blockers: [] }] });
  check('6a. status: beds, stages, working adults, the next settler and why', /18\/20 \(2 free\)/.test(st) && /3 children · 2 youths · 11 adults · 2 elders/.test(st) && /in 2 days — the weekly settler/.test(st));
  check('6b. open inheritances (escaped) and the oldest with their odds', /Hazel &lt;A&gt; → Rowan/.test(st) && /Old Fern 74 · 18%/.test(st));
  check('6c. couples: who can have a child and what blocks the rest', /can have a child/.test(st) && /Their last child is still very young/.test(st));
  const ac = D._actionsHtml([{ id: 9, name: 'Wren', age: 9, stage: 'youth' }]);
  check('6d. actions: age the town, set a stage, a death of old age, a settler, settle inheritances', ['data-kwld="age"', 'data-kwld="stage"', 'data-kwld="death"', 'data-kwld="settler"', 'data-kwld="settle"'].every(x => ac.includes(x))
    && /<option value="9">Wren \(9, youth\)/.test(ac) && /value="elder"/.test(ac));
  const nu = D._numbersHtml([{ key: 'ADULT_FROM', label: 'Grown up at', desc: 'Age…', group: 'Ages', default: 12, min: 6, max: 25, step: 1, value: 10, changed: true }]);
  check('6e. the numbers: grouped, with bounds, the default, "changed", Save and Reset', /kwld-gname">Ages/.test(nu) && /min="6" max="25"/.test(nu) && /Default 12; 6–25/.test(nu) && /kwld-changed/.test(nu) && /data-kwld-save="ADULT_FROM"/.test(nu) && /data-kwld="reset"/.test(nu));
  check('6f. a Life tab in Dev Tools; the script is on the page; one click listener, no inline handlers inside', /cheatSwitchTab\('ct-life',this\);KWLifeDev\.open\(\)/.test(H) && /id="ct-life-body"/.test(H) && /\/js\/life-admin\.js\?v=/.test(read('js/dev-tools.js')) && /addEventListener\('click', onClick\)/.test(LA) && !/onclick=/.test(LA));
  check('6g. it talks to /api/life/admin', /'\/api\/life\/admin' \+ path/.test(LA) && ['/status', '/numbers', '/age', '/stage', '/death', '/settler', '/inheritances/settle', '/numbers/reset'].every(x => LA.includes(`'${x}'`)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
