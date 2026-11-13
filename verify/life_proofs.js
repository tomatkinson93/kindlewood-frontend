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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
