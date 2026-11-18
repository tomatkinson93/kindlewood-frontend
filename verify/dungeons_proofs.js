'use strict';
// The dungeon path screen (docs/DUNGEONS.md §3, §9.4; js/dungeons.js). The
// server decides what is in a room, where the party may go and how a run
// ends (lib/dungeons.js there); this file shows it and sends each step.
//   node verify/dungeons_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = require('./_devmarkup').devAware((name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; });
const J = read('js/dungeons.js'), CSS = read('css/dungeons.css'), CU = read('js/combat-ui.js'), CZ = read('js/citizens.js'), H = read('index.html');
const DEV = require('./_devmarkup').devMarkup();

const w = { console, Date, Math, JSON, Number, String, Array, Object, document: { getElementById() { return null; } } }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWDungeon;

// A run as the server sends it: a green dungeon, the party past the first fight.
const room = (id, step, lane, type, next, x = {}) => ({ id, step, lane, type, icon: '?', label: type[0].toUpperCase() + type.slice(1), next, visited: false, current: false, can_enter: false, enemies: [], ...x });
const run = (x = {}) => ({
  id: 1, status: 'active', floor: 0, room: 'a', room_open: false, moves: ['b1', 'b2'],
  dungeon: { name: 'The Hollow under the Oak', tier: 'green', tier_name: 'Easy', skull: '🟢', floors: 1, intro: 'Roots and damp earth.', boss: 'an ogre', test: true, creatures: { health: 0.5, strength: 0.4 } },
  rooms: [
    room('a', 1, 2, 'fight', ['b1', 'b2'], { visited: true, current: true, enemies: [{ key: 'night_wolf', name: 'Night Wolf' }, { key: 'boar', name: 'Thornback Boar' }] }),
    room('b1', 2, 1, 'treasure', ['boss'], { can_enter: true }),
    room('b2', 2, 3, 'fight', ['boss'], { can_enter: true, enemies: [{ key: 'bog', name: 'Bog Lurker' }] }),
    room('boss', 3, 2, 'boss', [], { enemies: [{ key: 'ogre', name: 'Hill Ogre' }] }),
  ],
  party: [{ id: 1, name: 'Hazel', hp: 30, max: 60, down: false, was_down: false }, { id: 2, name: 'Bram', hp: 0, max: 50, down: true, was_down: true },
    { id: 3, name: 'Ivy', hp: 44, max: 44, down: false, was_down: true }, { id: 4, name: 'Oak <b>', hp: 10, max: 70, down: false, was_down: false }],
  loot: { wealth: 12, items: [{ item: 'hide', name: 'Hide', icon: '🦌', qty: 2 }] },
  pending: null, can_leave: true, can_flee: false, flee_keeps: 0.5, result: null, ...x,
});

console.log('1. The server decides');
{
  check('1a. the run is read from the server', /apiFetch\('\/api\/dungeons\/run'\)/.test(J));
  check('1b. each step is sent: enter a room, answer it, turn back, flee', ["post('run/move', { room:", "post('run/choose', { option:", "post('run/leave')", "post('run/flee')"].every(s => J.includes(s)));
  check('1c. the screen is redrawn from the answer, never from its own sums', /take\(d\);\n      return d;/.test(J) && !/\.hp\s*[-+]?=[^=]/.test(J) && !/\.wealth\s*[-+]=/.test(J) && !/Math\.random/.test(J));
  check('1d. a refusal is shown and the run is read again', /toast\('⚠️ ' \+ \(d\.error \|\| 'That did not work\. Try again\.'\)\); await load\(\); return null;/.test(J));
  check('1e. one step at a time', /if \(S\.busy\) return null;\n    S\.busy = true;/.test(J));
  check('1f. when a run ends, stores and citizens are read again', /function afterEnd\(\) \{[\s\S]*?refreshResources\(\)[\s\S]*?loadCitizens\(\)/.test(J) && /if \(was\) afterEnd\(\);/.test(J));
  const S = K._state;
  K._take({ on: true, run: run() });
  const live = S.run && S.run.id === 1 && S.last === null;
  K._take({ run: run({ status: 'cleared', result: {} }) });
  check('1g. an unfinished run is kept as the run; a finished one becomes the last run', live && S.run === null && S.last && S.last.status === 'cleared');
  K._take({ run: null, last: null });
  check('1h. no run at all is remembered as none', S.run === null && S.last === null);
}

console.log('2. Words');
{
  check('2a. what the party carries, in plain words', K._lootLine({ wealth: 12, items: [{ name: 'Hide', icon: '🦌', qty: 2 }] }) === '🪙 12 wealth · 🦌 Hide ×2');
  check('2b. nothing carried says so', K._lootLine({ wealth: 0, items: [] }) === 'Nothing yet' && K._lootLine(null, 'Nothing') === 'Nothing');
  check('2c. the heading: skull, name of the difficulty, and that it is a test', K._subtitle(run()) === '🟢 Easy · Test dungeon');
  const deep = run({ floor: 1 }); deep.dungeon = { ...deep.dungeon, floors: 3, test: false, skull: '🟣', tier_name: 'Nightmare' };
  check('2d. with more than one floor it says which', K._subtitle(deep) === '🟣 Nightmare · Floor 2 of 3');
  const r = run().rooms;
  check('2e. a room in words: what it is, what lives there, and whether the party can go', K._roomWords(r[0]) === 'Fight: Night Wolf and Thornback Boar. The party is here.' && K._roomWords(r[1]) === 'Treasure. You can go here.' && K._roomWords(r[3]) === 'Boss: Hill Ogre.');
}

console.log('3. The floor');
{
  const html = K._mapHtml(run());
  check('3a. every room of the floor is drawn', (html.match(/class="kwdg-room /g) || []).length === 4);
  check('3b. only rooms the server says can be entered can be pressed', (html.match(/<button[^>]*data-room="b1"[^>]*>/)[0].indexOf(' disabled') === -1) && / disabled/.test(html.match(/<button[^>]*data-room="boss"[^>]*>/)[0]) && / disabled/.test(html.match(/<button[^>]*data-room="a"[^>]*>/)[0]));
  check('3c. the room the party stands in is marked for screen readers', /data-room="a"[^>]*aria-current="step"/.test(html));
  check('3d. rooms are placed by step (left to right) and lane', /class="kwdg-room kwdg-fight is-here" style="left:16\.67%;top:50\.00%"/.test(html) && /style="left:50\.00%;top:16\.67%" data-action="enter" data-room="b1"/.test(html) && /style="left:83\.33%;top:50\.00%" data-action="enter" data-room="boss"/.test(html));
  check('3e. a line for every link, the open ways marked', (html.match(/<line /g) || []).length === 4 && (html.match(/class="is-open"/g) || []).length === 2);
  check('3f. every room has its words as a label', (html.match(/aria-label="/g) || []).length === 5 && /aria-label="Fight: Bog Lurker\. You can go here\."/.test(html));
  const ended = K._mapHtml(run({ status: 'left' }));
  check('3g. on a finished run nothing can be pressed', !/<button(?![^>]* disabled)[^>]*data-room/.test(ended));
  check('3i. a long floor scrolls sideways inside its own frame, not the window', /^<div class="kwdg-map-wrap"><div class="kwdg-map"/.test(html) && /\.kwdg-map-wrap \{ flex: none; overflow-x: auto;/.test(CSS));
  check('3h. a walked link is drawn as walked', /class="is-walked"/.test(K._mapHtml(run({ rooms: [room('a', 1, 2, 'fight', ['b'], { visited: true }), room('b', 2, 2, 'rest', [], { visited: true, current: true })] }))));
}

console.log('4. The party');
{
  const html = K._partyHtml(run().party);
  check('4a. four citizens with their health in numbers and as a bar', (html.match(/class="kwdg-member/g) || []).length >= 4 && />30 \/ 60</.test(html) && /<span style="width:50%"><\/span>/.test(html));
  check('4b. a downed citizen says Down, with an empty bar', /kwdg-member is-down"[^>]*aria-label="Bram: Down"/.test(html) && />Down</.test(html) && /<span style="width:0%"><\/span>/.test(html));
  check('4c. one who went down and was stood back up is marked (they roll for injury at the end)', /aria-label="Ivy: 44 of 44 health, went down earlier"/.test(html) && (html.match(/kwdg-mark/g) || []).length === 2);
  check('4d. names are escaped', html.includes('Oak &lt;b&gt;') && !html.includes('Oak <b>'));
}

console.log('5. What the room wants');
{
  const fight = K._runHtml(run({ room_open: true, moves: [], can_leave: false, can_flee: true, pending: { kind: 'battle', quest_run_id: 77, room: 'fight' } }));
  check('5a. an open fight: Fight, or Flee the dungeon, and what fleeing costs', /data-action="fight">⚔ Fight</.test(fight) && /data-action="flee">🏃 Flee the dungeon</.test(fight) && /drops half of what it carries/.test(fight));
  check('5b. no turning back in a fight', !/data-action="leave"/.test(fight));
  check('5c. it names what blocks the way', /Night Wolf and Thornback Boar block the way\./.test(fight));
  const boss = K._pendingHtml(run({ pending: { kind: 'battle', quest_run_id: 78, room: 'boss' } }));
  check('5d. the boss is announced as the boss', /👑 The boss/.test(boss));
  const rest = K._pendingHtml(run({ pending: { kind: 'rest', options: [{ key: 'rest', label: 'Rest by the fire', text: 'Everyone gets back 30%.' }] } }));
  check('5e. a rest room offers its choices in the server\'s words', /data-action="choose" data-option="rest">Rest by the fire</.test(rest) && /Everyone gets back 30%\./.test(rest));
  const land = K._pendingHtml(run({ pending: { kind: 'landing', options: [{ key: 'rest', label: 'Rest by the fire', text: 'a' }, { key: 'deeper', label: 'Go deeper', text: 'b' }] } }));
  check('5f. a landing: rest, or go deeper', /A landing between floors/.test(land) && /data-option="rest"/.test(land) && /data-option="deeper">Go deeper</.test(land));
  const path = K._runHtml(run());
  check('5g. between rooms: choose the next room, or turn back and keep it', /Choose the next room: there are 2 ways on\./.test(path) && /data-action="leave">↩ Turn back and keep it</.test(path));
  check('5h. what the party carries is always on the screen', /<b>Carried:<\/b> 🪙 12 wealth · 🦌 Hide ×2/.test(path) && /Carried:/.test(fight));
  check('5i. how much harder the creatures are is said plainly', /Creatures here have \+50% health and \+40% strength\./.test(path));
  check('5j. turning back and fleeing ask first', /title: 'Turn back\?'/.test(J) && /title: 'Flee the dungeon\?', danger: true/.test(J) && /if \(ok\) await post\('run\/leave'\);/.test(J) && /if \(!ok\) return false;\n    return !!\(await post\('run\/flee'\)\);/.test(J));
}

console.log('6. How it ended');
{
  const kept = { wealth: 40, items: [{ name: 'Rare Sap', icon: '🍯', qty: 1 }] };
  const end = (status, result) => K._endHtml(run({ status, result: { kept, lost: { wealth: 0, items: [] }, rolled: [], injuries: [], upgraded: [], ...result } }));
  check('6a. each ending has its own heading', ['cleared', 'left', 'fled', 'defeat', 'timed_out'].every(s => end(s, {}).includes(K.ENDINGS[s].title.replace(/&/g, '&amp;'))));
  check('6b. what came home is listed', /Came home<\/div><p>🪙 40 wealth · 🍯 Rare Sap ×1</.test(end('cleared', {})));
  const fled = end('fled', { half: true, lost: { wealth: 21, items: [{ name: 'Hide', icon: '🦌', qty: 1 }] } });
  check('6c. what was lost is listed when something was', /Lost<\/div><p>🪙 21 wealth · 🦌 Hide ×1</.test(fled) && !/Lost<\/div>/.test(end('left', {})));
  check('6d. nobody down: nobody hurt', /Nobody went down, so nobody was hurt\./.test(end('left', {})));
  const hurt = end('cleared', { rolled: [{ id: 2, no_fatal: true }], injuries: [{ citizen_id: 2, severity: 'wound', narrative: 'Bram took a deep cut to the arm.' }] });
  check('6e. who was at risk, and what happened to them', /Bram was at risk of injury\./.test(hurt) && /kwdg-inj-wound">Bram took a deep cut to the arm\./.test(hurt));
  check('6f. at risk but unhurt says so', /Hazel and Bram were at risk of injury\./.test(end('fled', { rolled: [{ id: 1 }, { id: 2 }] })) && /got away without a wound/.test(end('fled', { rolled: [{ id: 1 }] })));
  check('6g. left idle in a fight: the words say half was kept', /in the middle of a fight, so the party came home with half/.test(end('timed_out', { half: true })) && !/half/.test(end('timed_out', { half: false })));
  check('6h. a citizen who came back a better fighter is named', /Hazel came back a better fighter\./.test(end('cleared', { upgraded: [{ id: 1, name: 'Hazel', combat: 3 }] })));
}

console.log('7. The battle screen');
{
  check('7a. the server says at engage that a fight belongs to a dungeon run', /_battleDungeon = data\.dungeon_run_id \|\| null;/.test(CU));
  check('7b. Flee is on the battle screen for a dungeon fight only', /id="cm-dungeon-flee" style="display:none" onclick="combatDungeonFlee\(\)"/.test(CU) && /flee\.style\.display = _battleDungeon \? '' : 'none';/.test(CU));
  check('7c. fleeing asks first (the path screen) and closes the battle only if the party fled', /if \(await global\.KWDungeon\.fleeFromBattle\(\)\) closeCombat\(\);/.test(CU));
  check('7d. a dungeon fight promises no gold of its own: the run holds the loot', /if \(_battleDungeon\) \{[\s\S]*?The way on is clear\.[\s\S]*?Wounds carry into the next room\.[\s\S]*?\} else if \(won\) \{/.test(CU));
  check('7e. a lost dungeon fight says the run is over and the loot is lost', /The party is driven out of the dungeon\.[\s\S]*?Everything found on this run is lost\./.test(CU));
  check('7f. what the fight gave comes from the server\'s answer', /if \(data\.dungeon && global\.KWDungeon\) global\.KWDungeon\.battleResult\(body, data\);/.test(CU) && /Found here: \$\{esc\(lootLine\(d\.found\)\)\}/.test(J));
  check('7g. closing a dungeon fight goes back to the path', /const wasDungeon = _battleDungeon;\n    _battleDungeon = null;/.test(CU) && /if \(wasDungeon && global\.KWDungeon\) \{ try \{ global\.KWDungeon\.open\(\); \}/.test(CU));
  check('7h. the result button says where it leads', /btn\.textContent = d\.ended \? 'See how it ended' : 'Back to the path';/.test(J) && /if \(btn\) btn\.textContent = 'Return';/.test(CU));
  check('7i. starting a fight closes the path window first (the battle screen is under windows)', /function startBattle\(id\) \{[\s\S]*?w\.close\(\);[\s\S]*?global\.startBattleFromQuest\(id\);/.test(J));
}

console.log('8. On the page');
{
  check('8a. the script and the stylesheet are on the page', /<script defer src="\/js\/dungeons\.js\?v=h[0-9a-f]{8}"><\/script>/.test(H) && /<link rel="stylesheet" href="\/css\/dungeons\.css\?v=h[0-9a-f]{8}">/.test(H));
  check('8b. the stylesheet uses the shared colours only', !/#[0-9a-fA-F]{3,8}\b/.test(CSS) && !/rgba?\(/.test(CSS) && /var\(--kw-/.test(CSS));
  check('8c. the pulse on the ways on stops for reduced motion', /@media \(prefers-reduced-motion: reduce\) \{ \.kwdg-room\.can-enter:not\(:disabled\) \{ animation: none; \} \}/.test(CSS));
  check('8d. on a phone: two citizens a row, bigger buttons', /@media \(max-width: 640px\)[\s\S]*?\.kwdg-party \{ grid-template-columns: repeat\(2,[\s\S]*?min-height: var\(--kw-touch\)/.test(CSS));
  check('8e. it is one KWWindow; no inline handlers in its markup', /KWWindow\.open\(\{\s*id: 'dungeon'/.test(J) && !/onclick=/.test(J));
  check('8f. a citizen in a dungeon is shown as away', /if \(c\.dungeon\) return \{ icon: '💀', label: '💀 In ' \+ \(c\.dungeon\.name \|\| 'a dungeon'\) \};/.test(CZ));
}

console.log('9. Dev Tools');
{
  check('9a. a Dungeons tab in Dev Tools (from kindlewood-server)', /cheatSwitchTab\('ct-dungeons',this\);KWDungeon\.devOpen\(\)/.test(DEV) && /id="ct-dungeons-body"/.test(DEV));
  const d = { on: false, party: 4, free_adults: 6, stories: [{ key: 'test_green', name: 'The Hollow under the Oak', skull: '🟢', floors: 1 }, { key: 'test_orange', name: 'The Stair below the Crag', skull: '🟠', floors: 2 }], run: null, last: null };
  const html = K._devHtml(d);
  check('9b. it says dungeons are off for players and offers the switch', /Dungeons are <b>off<\/b> for players/.test(html) && /data-kwdg="switch" data-on="1">Turn dungeons on for players</.test(html));
  check('9c. a button for each test dungeon', /data-kwdg="start" data-story="test_green">🟢 Start: The Hollow under the Oak \(1 floor\)</.test(html) && /data-story="test_orange">🟠 Start: The Stair below the Crag \(2 floors\)</.test(html));
  check('9d. too few free adults: the start buttons are off', (K._devHtml({ ...d, free_adults: 3 }).match(/data-kwdg="start"[^>]* disabled/g) || []).length === 2);
  const live = K._devHtml({ ...d, on: true, run: run({ can_flee: true, pending: { kind: 'battle', quest_run_id: 1, room: 'fight' } }) });
  check('9e. with a run under way: open it, win the fight, heal, or leave it idle', ['open', 'win', 'heal', 'idle'].every(a => live.includes(`data-kwdg="${a}"`)) && /a fight is open/.test(live) && (live.match(/data-kwdg="start"[^>]* disabled/g) || []).length === 2);
  check('9f. one click listener, no inline handlers', /el\.addEventListener\('click', ev => \{ const t = ev\.target\.closest\('\[data-kwdg\]'\);/.test(J));
  check('9g. the admin routes are the ones used', /apiFetch\('\/api\/dungeons\/admin\/' \+ path/.test(J) && ["devCall('GET', 'status')", "devCall('POST', 'test'", "devCall('POST', 'win')", "devCall('POST', 'heal')", "devCall('POST', 'sweep', { idle_run: true })", "devCall('POST', 'switch'"].every(s => J.includes(s)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
