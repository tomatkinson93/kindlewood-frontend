'use strict';
// The tavern board's daily rotation, time-limited quests and abandoning a
// solo quest (js/quests.js); the Watchtower (js/settlement-view.js); the
// quest editor's time window (js/buildings.js); Help.
//   node verify/quest_board_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const Q = read('js/quests.js');
const take = (src, start) => { const i = src.indexOf(start); if (i < 0) throw new Error('missing ' + start); return src.slice(i, src.indexOf('\n}', i) + 2); };

const w = { console, Date, Math, Array, setTimeout };
w.window = w; vm.createContext(w);
vm.runInContext([take(Q, 'function _questRotateHtml('), take(Q, 'function _questGateBadge('), take(Q, 'function _canAbandon('),
  'this.rot = _questRotateHtml; this.badge = _questGateBadge; this.can = _canAbandon;'].join('\n'), w);

console.log('1. Rotation');
{
  const at = new Date(Date.now() + (5 * 60 + 12) * 60000 + 30000).toISOString();
  check('1a. "New quests in 5h 12m"', /New quests in 5h 12m/.test(w.rot(at)));
  check('1b. nothing when the time is unknown or past', w.rot(null) === '' && w.rot(new Date(Date.now() - 1000).toISOString()) === '');
  check('1c. the Available header carries it', /📋 Available' \+ _questRotateHtml\(_questData\.rotates_at\)/.test(Q));
}

console.log('2. Time-limited quests');
check('2a. a night quest: "Tonight only"', /Tonight only/.test(w.badge({ time_limited: true, active_phases: ['dusk', 'night'] })));
check('2b. a full-moon quest: "Full moon only"', /Full moon only/.test(w.badge({ time_limited: true, moon_phases: ['full'] })));
check('2c. ordinary quests get no badge', w.badge({ id: 'x' }) === '');
check('2d. shown on both carousels', (Q.match(/\+ _questGateBadge\(q\)/g) || []).length === 2);

console.log('3. Abandon');
check('3a. a solo quest under way can be abandoned', w.can({ status: 'active', quest_type: 'solo', combat_status: 'rolled' }));
check('3b. not a party, not once a battle has begun, not when over',
  !w.can({ status: 'active', quest_type: 'party' }) && !w.can({ status: 'active', quest_type: 'solo', combat_status: 'pending' }) && !w.can({ status: 'completed', quest_type: 'solo' }));
check('3c. the button sits on the active card and needs a second tap', /_canAbandon\(q\) \? `<div class="qb-abandon-row">/.test(Q) && /Really turn back\?/.test(Q) && /dataset\.armed/.test(Q));
check('3d. it posts to /abandon and refreshes the board', /apiFetch\(`\/api\/quests\/\$\{id\}\/abandon`, \{ method: 'POST' \}\)/.test(Q) && /abandonQuest[\s\S]*?renderQuestBoard\(\)/.test(Q));

console.log('4. Elsewhere');
const SV = read('js/settlement-view.js'), B = read('js/buildings.js'), H = read('js/help.js'), C = read('js/citizens.js'), IDX = read('index.html');
check('4a. the Watchtower has a plot and a look', /accepts:\['watchtower'\]/.test(SV) && /watchtower: *\{ emoji:'🗼'/.test(SV));
check('4b. its panel shows the watch (posts, happiness, defence)', /occupant\.id === 'watchtower' \? _svWatchHtml\(\)/.test(SV) && /posts manned · \+/.test(SV));
check('4c. the quest editor has a time window, saved as active_phases / moon_phases', /_qaTimeWindowFields\(q\)/.test(B) && /active_phases: Array\.prototype\.map\.call\(document\.querySelectorAll\('\.qa-phase:checked'\)/.test(B) && /moon_phases: +Array\.prototype\.map/.test(B));
check('4d. Help explains the board, abandoning and the Watchtower', /id: 'quests'/.test(H) && /abandoned/.test(H) && /Watchtower/.test(H));
check('4e. citizens at an outpost show as such', /atOutpost \? 'At ' \+ c\.outpost\.name/.test(C) && /Working at the \$\{c\.outpost\.name\}/.test(C));
check('4f. r4.css is loaded', /css\/r4\.css\?v=/.test(IDX));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
