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
const J = read('js/dungeons.js'), CSS = read('css/dungeons.css'), CZ = read('js/citizens.js'), H = read('index.html');
const DEV = require('./_devmarkup').devMarkup();

const w = { console, Date, Math, JSON, Number, String, Array, Object, document: { getElementById() { return null; } } }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWDungeon;

// A run as the server sends it: a green dungeon, the party past the first fight.
const room = (id, step, lane, type, next, x = {}) => ({ id, step, lane, type, icon: '?', label: type[0].toUpperCase() + type.slice(1), next, visited: false, current: false, can_enter: false, enemies: [], ...x });
const run = (x = {}) => ({
  id: 1, status: 'active', combat: 'board', floor: 0, room: 'a', room_open: false, moves: ['b1', 'b2'],
  dungeon: { name: 'The Hollow under the Oak', tier: 'green', tier_name: 'Easy', skull: '🟢', floors: 1, intro: 'Roots and damp earth.', boss: 'an ogre', test: true, suggested_party: 'villagers' },
  rooms: [
    room('a', 1, 2, 'fight', ['b1', 'b2'], { visited: true, current: true, enemies: [{ key: 'wolf_raider', name: 'Wolf Raider' }, { key: 'boar_bruiser', name: 'Boar Bruiser' }] }),
    room('b1', 2, 1, 'treasure', ['boss'], { can_enter: true }),
    room('b2', 2, 3, 'fight', ['boss'], { can_enter: true, enemies: [{ key: 'newt_darter', name: 'Newt Darter' }] }),
    room('boss', 3, 2, 'boss', [], { enemies: [{ key: 'hill_ogre', name: 'Hill Ogre' }] }),
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
  check('1f. when a run ends, stores and citizens are read again', /function afterEnd\(\) \{[\s\S]*?refreshResources\(\)[\s\S]*?loadCitizens\(\)/.test(J) && /if \(was \|\| \(wasWalking && [^\n]*\) afterEnd\(\);/.test(J));
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
  check('2e. a room in words: what it is, what lives there, and whether the party can go', K._roomWords(r[0]) === 'Fight: Wolf Raider and Boar Bruiser. The party is here.' && K._roomWords(r[1]) === 'Treasure. You can go here.' && K._roomWords(r[3]) === 'Boss: Hill Ogre.');
}

console.log('3. The floor');
{
  const html = K._mapHtml(run());
  check('3a. every room of the floor is drawn', (html.match(/class="kwdg-room /g) || []).length === 4);
  check('3b. only rooms the server says can be entered can be pressed', (html.match(/<button[^>]*data-room="b1"[^>]*>/)[0].indexOf(' disabled') === -1) && / disabled/.test(html.match(/<button[^>]*data-room="boss"[^>]*>/)[0]) && / disabled/.test(html.match(/<button[^>]*data-room="a"[^>]*>/)[0]));
  check('3c. the room the party stands in is marked for screen readers', /data-room="a"[^>]*aria-current="step"/.test(html));
  check('3d. rooms are placed by step (left to right) and lane', /class="kwdg-room kwdg-fight is-here" style="left:16\.67%;top:50\.00%"/.test(html) && /style="left:50\.00%;top:16\.67%" data-action="enter" data-room="b1"/.test(html) && /style="left:83\.33%;top:50\.00%" data-action="enter" data-room="boss"/.test(html));
  check('3e. a line for every link, the open ways marked', (html.match(/<line /g) || []).length === 4 && (html.match(/class="is-open"/g) || []).length === 2);
  check('3f. every room has its words as a label', (html.match(/aria-label="/g) || []).length === 5 && /aria-label="Fight: Newt Darter\. You can go here\."/.test(html));
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
  const fight = K._runHtml(run({ room_open: true, moves: [], can_leave: false, can_flee: true, pending: { kind: 'battle', board: true, battle_id: 77, room: 'fight' } }));
  check('5a. an open fight: Fight, or Flee the dungeon, and what fleeing costs', /data-action="fight">⚔ Fight</.test(fight) && /data-action="flee">🏃 Flee the dungeon</.test(fight) && /drops half of what it carries/.test(fight));
  check('5b. no turning back in a fight', !/data-action="leave"/.test(fight));
  check('5c. it names what blocks the way', /Wolf Raider and Boar Bruiser block the way\./.test(fight));
  const boss = K._pendingHtml(run({ pending: { kind: 'battle', board: true, battle_id: 78, room: 'boss' } }));
  check('5d. the boss is announced as the boss', /👑 The boss/.test(boss));
  const rest = K._pendingHtml(run({ pending: { kind: 'rest', options: [{ key: 'rest', label: 'Rest by the fire', text: 'Everyone gets back 50%.' }] } }));
  check('5e. a rest room offers its choices in the server\'s words', /data-action="choose" data-option="rest">Rest by the fire</.test(rest) && /Everyone gets back 50%\./.test(rest));
  const land = K._pendingHtml(run({ pending: { kind: 'landing', options: [{ key: 'rest', label: 'Rest by the fire', text: 'a' }, { key: 'deeper', label: 'Go deeper', text: 'b' }] } }));
  check('5f. a landing: rest, or go deeper', /A landing between floors/.test(land) && /data-option="rest"/.test(land) && /data-option="deeper">Go deeper</.test(land));
  const path = K._runHtml(run());
  check('5g. between rooms: choose the next room, or turn back and keep it', /Choose the next room: there are 2 ways on\./.test(path) && /data-action="leave">↩ Turn back and keep it</.test(path));
  check('5h. what the party carries is always on the screen', /<b>Carried:<\/b> 🪙 12 wealth · 🦌 Hide ×2/.test(path) && /Carried:/.test(fight));
  check('5i. who the dungeon is written for is said plainly', /Written for a party of villagers\./.test(path) && !/Creatures here have/.test(path));
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

console.log('10. No cards: every fight is on the board');
{
  // The card battles left the dungeons on 2026-11-23 (docs/TACTICS.md §8): the decks, the draft at the door,
  // the card after a fight, honing and the "Class cards" window went with them.
  check('10a. the path screen draws no card and asks for none', !/kwdg-card|kwdg-pick|kwdg-deck|kwdg-coll/.test(J) && !/data-action="(deck|hone|hone-open|pick-door|pick-reward|cards|prepare)"/.test(J)
    && ['_cardHtml', '_deckHtml', '_doorHtml', '_rewardHtml', '_honeHtml', '_collectionHtml', 'openCards', 'battleResult', 'fleeFromBattle'].every(k => !(k in K)));
  check('10b. it calls no card route: nothing to pick, no class cards to read or prepare', !/run\/pick/.test(J) && !/dungeons\/cards/.test(J) && !/quest_run_id/.test(J) && !/startBattleFromQuest/.test(J));
  const old = run({ party: run().party.map(m => ({ ...m, deck: { label: 'Guard', size: 11, cards: [] } })), pending: { kind: 'door', citizens: [] } });
  check('10c. a run that still came with decks or a door to choose at would show neither', !/cards/.test(K._partyHtml(old.party)) && !/🚪/.test(K._runHtml(old)));
  check('10d. a rest room is a rest and nothing else', /data-action="choose" data-option="\$\{esc\(o\.key\)\}"/.test(J) && !/hone/i.test(J.replace(/^\s*\/\/.*$/gm, '')));
  check('10e. Fight closes the path window and opens the room\'s battle on the board', /if \(S\.win\) \{ const w = S\.win; S\.win = null; try \{ w\.close\(\); \} catch \(e\) \{ \/\* gone \*\/ \} \}\n      global\.KWTactics\.openById\(p\.battle_id\)/.test(J));
  check('10f. the stylesheet carries no card rules', !/kwdg-card|kwdg-pick|kwdg-coll|kwdg-prep|cm-dungeon-flee/.test(CSS));
  check('10g. the card battle screen is gone altogether (2026-11-26): its script is not in the folder or on the page', !fs.existsSync(path.join(ROOT, 'js/combat-ui.js')) && !/combat-ui\.js|card-hand-ui|deck-builder/.test(H));
  check('10h. Dev Tools offers no class cards, and says where the skull numbers are', !/data-kwdg="cards"/.test(J) && /How tough each skull's foes are \(health and power\)/.test(J));
}

console.log('8. On the page');
{
  check('8a. the script and the stylesheet are on the page', /<script defer src="\/js\/dungeons\.js\?v=h[0-9a-f]{8}"><\/script>/.test(H) && /<link rel="stylesheet" href="\/css\/dungeons\.css\?v=h[0-9a-f]{8}">/.test(H));
  check('8b. the stylesheet uses the shared colours only', !/#[0-9a-fA-F]{3,8}\b/.test(CSS) && !/rgba?\(/.test(CSS) && /var\(--kw-/.test(CSS));
  check('8c. the pulse on the ways on stops for reduced motion', /@media \(prefers-reduced-motion: reduce\) \{ \.kwdg-room\.can-enter:not\(:disabled\) \{ animation: none; \} \}/.test(CSS));
  check('8d. on a phone: two citizens a row, bigger buttons', /@media \(max-width: 640px\)[\s\S]*?\.kwdg-party \{ grid-template-columns: repeat\(2,[\s\S]*?min-height: var\(--kw-touch\)/.test(CSS));
  check('8e. it is one KWWindow; no inline handlers in its markup', /KWWindow\.open\(\{\s*id: 'dungeon'/.test(J) && !/onclick=/.test(J));
  check('8f. a citizen in a dungeon is shown as away: walking there, inside, or walking home', /if \(c\.dungeon\) return \{ icon: '💀', label: \(c\.dungeon\.walking === 'out' \? '💀 Walking to ' : c\.dungeon\.walking === 'home' \? '💀 Walking home from ' : '💀 In '\) \+ \(c\.dungeon\.name \|\| 'a dungeon'\) \};/.test(CZ));
}

console.log('9. Dev Tools');
{
  check('9a. a Dungeons tab in Dev Tools (from kindlewood-server)', /cheatSwitchTab\('ct-dungeons',this\);KWDungeon\.devOpen\(\)/.test(DEV) && /id="ct-dungeons-body"/.test(DEV));
  const d = { on: false, party: 4, free_adults: 6, tiers: [{ key: 'green', name: 'Easy', skull: '🟢' }, { key: 'purple', name: 'Nightmare', skull: '🟣' }], lands: ['forest', 'marsh'], stories: [{ key: 'test_green', name: 'The Hollow under the Oak', skull: '🟢', floors: 1 }, { key: 'test_orange', name: 'The Stair below the Crag', skull: '🟠', floors: 2 }], run: null, last: null };
  const html = K._devHtml(d);
  check('9b. it says dungeons are off for players and offers the switch', /Dungeons are <b>off<\/b> for players/.test(html) && /data-kwdg="switch" data-on="1">Turn dungeons on for players</.test(html));
  check('9c. a button for each test dungeon', /data-kwdg="start" data-story="test_green">🟢 Start: The Hollow under the Oak \(1 floor\)</.test(html) && /data-story="test_orange">🟠 Start: The Stair below the Crag \(2 floors\)</.test(html));
  check('9d. nobody free: the start buttons are off; three free: they are on (a party is one to four)', (K._devHtml({ ...d, free_adults: 0 }).match(/data-kwdg="start"[^>]* disabled/g) || []).length === 2 && !/data-kwdg="start"[^>]* disabled/.test(K._devHtml({ ...d, free_adults: 3 })));
  const live = K._devHtml({ ...d, on: true, run: run({ can_flee: true, pending: { kind: 'battle', board: true, battle_id: 1, room: 'fight' } }) });
  check('9e. with a run under way: open it, win the fight, heal, or leave it idle', ['open', 'win', 'heal', 'idle'].every(a => live.includes(`data-kwdg="${a}"`)) && /a fight is open/.test(live) && (live.match(/data-kwdg="start"[^>]* disabled/g) || []).length === 2);
  check('9h. a generated dungeon: choose the skull and the land, give a seed or leave it, and start', /<select id="kwdg-dev-tier"[^>]*><option value="green">🟢 Easy<\/option><option value="purple">🟣 Nightmare<\/option>/.test(html) && /<select id="kwdg-dev-land"[^>]*><option value="forest">Forest<\/option><option value="marsh">Marsh<\/option>/.test(html) && /id="kwdg-dev-seed"[^>]*placeholder="any"/.test(html) && /data-kwdg="generate">Generate and start</.test(html));
  check('9i. the choice is sent to the admin route; an empty seed is left to the server', /devCall\('POST', 'generate', \{ tier: val\('kwdg-dev-tier'\), terrain: val\('kwdg-dev-land'\), seed: seed > 0 \? seed : undefined \}\)/.test(J));
  const made = run({ can_flee: false }); made.dungeon = { ...made.dungeon, generated: true, terrain: 'marsh', seed: 1234 };
  check('9j. a generated run says its skull, land and seed, so it can be made again', /\(🟢 marsh, seed 1234\)/.test(K._devHtml({ ...d, on: true, run: made })) && (K._devHtml({ ...d, on: true, run: made }).match(/data-kwdg="generate"[^>]* disabled/) || []).length === 1);
  const picked = K._devHtml(d, { tier: 'purple', land: 'marsh', seed: '77' });
  check('9k. what was chosen stays chosen when the panel is redrawn', /<option value="purple" selected>/.test(picked) && /<option value="marsh" selected>/.test(picked) && /id="kwdg-dev-seed"[^>]*value="77"/.test(picked) && /el\.addEventListener\('change', keep\);\s*el\.addEventListener\('input', keep\);/.test(J) && /devHtml\(DEV\.data, DEV\.pick\)/.test(J));
  check('9f. one click listener, no inline handlers', /el\.addEventListener\('click', ev => \{ const t = ev\.target\.closest\('\[data-kwdg\]'\);/.test(J));
  check('9g. the admin routes are the ones used', /apiFetch\('\/api\/dungeons\/admin\/' \+ path/.test(J) && ["devCall('GET', 'status')", "devCall('POST', 'test'", "devCall('POST', 'win')", "devCall('POST', 'heal')", "devCall('POST', 'sweep', { idle_run: true })", "devCall('POST', 'switch'"].every(s => J.includes(s)));
}

console.log('11. The class buildings in the Home scene');
{
  const SV = read('js/settlement-view.js'), VE = read('js/villager-engine.js'), CZ = read('js/citizens.js');
  check('11a. the Hearth Shrine has a plot in Town and a look', /id:'town-shrine',\s+area:'town',[^}]*accepts:\['hearth_shrine'\]/.test(SV) && /hearth_shrine: *\{ emoji:/.test(SV));
  check('11b. the Wizard\'s Tower has a plot in the Outskirts and a look', /id:'out-tower',\s+area:'outskirts',[^}]*accepts:\['wizard_tower'\]/.test(SV) && /wizard_tower: *\{ emoji:/.test(SV));
  check('11c. Wizards and Hearthkeepers walk to their own buildings', /wizard: 'wizard_tower', hearthkeeper: 'hearth_shrine'/.test(VE));
  check('11d. both jobs have an icon on a citizen\'s card', /wizard: '🔮', hearthkeeper: '🔥'/.test(CZ));
  const slots = [...SV.matchAll(/\{ id:'([a-z-]+)',\s+area:'(town|outskirts)',\s+x:([\d.]+),\s+y:([\d.]+)/g)].map(m => ({ id: m[1], area: m[2], x: +m[3], y: +m[4] }));
  const near = slots.filter(a => slots.some(b => b !== a && b.area === a.area && b.y === a.y && Math.abs(b.x - a.x) < 10));
  check('11e. no two plots in a row stand closer than a tenth of the field', slots.length === 20 && near.length === 0, near.map(q => q.id).join());
}

console.log('12. Dungeons on the world map');
{
  const L = read('js/kwmap-dungeons.js'), CORE = read('js/kwmap-core.js'), MAIN = read('js/main.js'), PL = read('js/places.js'), RT = read('js/realtime.js'), TOK = read('css/tokens.css');
  const d = (x = {}) => ({ id: 7, q: 5, r: 6, name: 'Windscar <Hollow>', tier: 'green', tier_name: 'Easy', skull: '🟢', terrain: 'hills', floors: 2, intro: 'A cold draught.', suggested_party: 'villagers', band: 'The Night Pack',
    hours_left: 70.4, distance: 3, in_reach: true, mine: null, cleared_by: 0, first_clear: null, busy: false, ...x });
  const people = [{ id: 1, name: 'Ivy', role: 'idle' }, { id: 2, name: 'Hazel', role: 'soldier' }, { id: 3, name: 'Bram <i>', role: 'archer' }, { id: 4, name: 'Oak', role: 'idle' }, { id: 5, name: 'Fern', role: 'idle' }];
  check('12a. the map draws a skull on each tile with a dungeon, after the raid layer', /if \(window\.KWDungeonLayer && this\._uifxCtx\) window\.KWDungeonLayer\.draw\(/.test(CORE) && CORE.indexOf('KWDungeonLayer.draw') > CORE.indexOf('KWRaidLayer.draw')
    && /tiles\.filter\(t => t\.dungeon\)/.test(L) && /<script defer src="\/js\/kwmap-dungeons\.js\?v=h[0-9a-f]+"><\/script>/.test(H));
  check('12b. the map layer asks the server nothing and rolls nothing', !/fetch\(|apiFetch|XMLHttpRequest|Math\.random/.test(L) && /if \(!list\.length\) return;/.test(L));
  check('12c. the ring is the skull\'s colour; gold while the party is inside, faint once the town has been', /inside \? '#f4c95d' : \(RING\[d\.tier\]/.test(L) && /ctx\.globalAlpha = done \? 0\.45 : 1/.test(L)
    && ['green', 'yellow', 'orange', 'red', 'purple'].every(k => new RegExp(k + ": '(#[0-9a-f]{6})'").test(L) && TOK.includes(`--kw-skull-${k}:`) && TOK.match(new RegExp(`--kw-skull-${k}:\\s*(#[0-9a-f]{6})`))[1] === L.match(new RegExp(k + ": '(#[0-9a-f]{6})'"))[1]));
  check('12d. how long is left, in words', K._leftWords(70.4) === 'gone in 3 days' && K._leftWords(30) === 'gone in 30 hours' && K._leftWords(1.2) === 'gone within the hour' && K._leftWords(0) === 'gone');
  check('12e. the facts under the name', K._factsLine(d()) === '2 floors · The Night Pack · written for villagers · gone in 3 days' && K._factsLine(d({ floors: 1, band: null })) === '1 floor · written for villagers · gone in 3 days');
  const open = K.tileHtml({ dungeon: d() }, people);
  check('12f. the tile\'s card: name, skull, facts, four pickers and Send them in', /💀 Windscar &lt;Hollow&gt; <span class="op-level">🟢 Easy<\/span>/.test(open) && (open.match(/data-dungeon-pick="\d"/g) || []).length === 4
    && /data-dungeon-enter="7">💀 Send them in</.test(open) && /No town has cleared it yet\./.test(open) && /class="op-section op-dungeon kwdg-skull-green"/.test(open) && !/<Hollow>|<i>/.test(open));
  check('12g. fighters are offered first', open.indexOf('Hazel (Guard)') < open.indexOf('>Ivy<') && open.indexOf('Bram &lt;i&gt; (Archer)') < open.indexOf('>Ivy<'));
  const three = K.tileHtml({ dungeon: d() }, people.slice(0, 3));
  check('12h. fewer than four free: three pickers and a warning that fewer is harder; nobody free: no way in', (three.match(/data-dungeon-pick="\d"/g) || []).length === 3 && /Only 3 adults are free: a dungeon is written for 4, so fewer is harder\./.test(three) && /data-dungeon-enter/.test(three)
    && /No adult is free to go\./.test(K.tileHtml({ dungeon: d() }, [])) && !/data-dungeon-enter/.test(K.tileHtml({ dungeon: d() }, [])));
  const st = (x, busy) => K._standing(d(x), busy);
  check('12i. what the town may do there', st({}).state === 'open' && st({ mine: 'active' }).state === 'inside' && st({ mine: 'cleared' }).words === 'Your town has been here: dungeon cleared. Each town goes in once.'
    && st({ mine: 'fled' }).state === 'done' && st({ in_reach: false, distance: 11 }).words === 'Too far to walk: 11 tiles away. A party goes up to 8 tiles from the town.' && st({}, true).state === 'busy');
  const inside = K.tileHtml({ dungeon: d({ mine: 'active' }) }, people), been = K.tileHtml({ dungeon: d({ mine: 'left' }) }, people), busy = K.tileHtml({ dungeon: d({ busy: true }) }, people);
  check('12j. party inside: open the dungeon; been already, too far or busy: no way in', /data-dungeon-open>💀 Open the dungeon</.test(inside) && !/data-dungeon-enter/.test(inside) && /turned back\. Each town goes in once\./.test(been) && !/data-dungeon-enter/.test(been)
    && /already has a party in another dungeon/.test(busy) && !/data-dungeon-enter/.test(busy));
  check('12k. who cleared it', /Cleared by 2 towns\. Mossford was first\./.test(K.tileHtml({ dungeon: d({ cleared_by: 2, first_clear: 'Mossford' }) }, people)) && /Cleared by 1 town\. /.test(K.tileHtml({ dungeon: d({ cleared_by: 1, first_clear: 'A' }) }, people)));
  check('12l. the tile\'s panel shows the card and wires its buttons', /if \(tile\.dungeon && window\.KWDungeon && KWDungeon\.tileHtml\) return KWDungeon\.tileHtml\(tile, _opFreeCitizens\(\)\);/.test(MAIN)
    && /if \(tile\.dungeon && window\.KWDungeon && KWDungeon\.wireTile\) KWDungeon\.wireTile\(body, tile\);/.test(MAIN));
  check('12m. the party is sent to the server, which decides; then the path screen opens', /apiFetch\('\/api\/dungeons\/' \+ encodeURIComponent\(id\) \+ '\/enter', \{ method: 'POST'[^}]*\}, body: JSON\.stringify\(\{ citizen_ids: ids \}\)/.test(J)
    && /if \(!ids\.length\) return say\('Choose who goes\.'\);/.test(J) && /Press again to send them\./.test(J) && /if \(!res\.ok \|\| !d\.ok\) return \{ error: d\.error \|\| 'They could not go\.' \};/.test(J));
  check('12n. someone picked in one box is not offered in the others', /o\.disabled = !!o\.value && o\.value !== s\.value && taken\.includes\(o\.value\)/.test(J));
  const list = K._listHtml([d(), d({ id: 8, name: 'Thornhall', tier: 'red', tier_name: 'Deadly', skull: '🔴', mine: 'active' }), d({ id: 9, mine: 'defeat' })], 8);
  check('12o. The Land → Dungeons lists them: skull, facts, distance, state', (list.match(/class="kwdg-entry /g) || []).length === 3 && /kwdg-entry kwdg-skull-red/.test(list) && /· 3 tiles away/.test(list)
    && /data-action="inside">Open the dungeon</.test(list) && /kwdg-entry kwdg-skull-green is-done/.test(list) && /Your town already has a party in another dungeon\./.test(list) && /data-action="show" data-q="5" data-r="6"/.test(list));
  check('12p. a free dungeon offers "Choose a party on the map"; the rest "Show on the map"', />Choose a party on the map</.test(K._listHtml([d()], null)) && />Show on the map</.test(list) && !/Choose a party on the map/.test(list));
  check('12q. none found: it says how they are found', /Your town has found no dungeon yet\./.test(K._listHtml([], null)) && /a skull marks each one on the map/.test(K._listHtml([], null)) && /Looking over the land/.test(K._listHtml(null, null)));
  check('12r. the list is read from the server and is one KWWindow', /apiFetch\('\/api\/dungeons'\)/.test(J) && /KWWindow\.open\(\{\s*id: 'dungeon-list'/.test(J));
  check('12s. showing one on the map centres there and opens the tile\'s panel, on a desk and on a phone', /camera\.q = q; camera\.r = r;/.test(J) && /selectWorldTile\(tile\);/.test(J) && /KWShell\.openPanel\(\)/.test(J) && /KWContext\.open\(\)/.test(J));
  check('12t. Dungeons is in The Land\'s menu', /\{ key: 'dungeons', label: 'Dungeons', glyph: '💀', run: \(\) => global\.KWDungeon && global\.KWDungeon\.listOpen\(\)/.test(PL));
  check('12u. word of a new dungeon: a toast and the map is read again; a run ended by itself is read again', /dungeon_found\(ev\) \{ if \(global\.KWDungeon && global\.KWDungeon\.onEvent\) global\.KWDungeon\.onEvent\(ev\); \}/.test(RT)
    && /dungeon_ended\(ev\)/.test(RT) && /if \(ev\.type === 'dungeon_found'\) \{\s*if \(ev\.message\) toast\(ev\.message\);/.test(J));
  check('12v. when a run ends the map is read again, so the skull goes faint', /MAP\.in_dungeon = null;\s*mapAgain\(\);/.test(J) && /Promise\.resolve\(global\.loadWorldMap\(\)\)\.then/.test(J) && /if \(t && typeof selectWorldTile === 'function'\) selectWorldTile\(t\);/.test(J));
  const dev = K._devHtml({ on: true, party: 4, free_adults: 6, tiers: [], lands: [], stories: [], run: null, last: null, map: { live: 12 } });
  check('12w. Dev Tools: how many are on the map, top it up, or clear them and make new ones', /<b>12<\/b> on the map now\./.test(dev) && /data-kwdg="map-fill">Top the map up now</.test(dev) && /data-kwdg="map-new">Clear them all and make new ones</.test(dev)
    && /devCall\('POST', 'map', \{ expire: a === 'map-new' \}\)/.test(J));
  check('12y. Help explains dungeons, and the card and the list both lead there', /id: 'dungeons', icon: '💀', title: 'Dungeons'/.test(read('js/help.js')) && /Flee<\/b> a fight and they drop half/.test(read('js/help.js'))
    && /data-dungeon-help>\?<\/button>/.test(open) && /KWHelp\.open\('dungeons'\)/.test(J) && /data-action="help">\?<\/button>/.test(list));
  const prize = { title: 'Greyfeather\'s Pinion, on silver', icon: '🪶', wealth: 160, from: 'Old Greyfeather' };
  check('12z. a dungeon nobody has cleared says what the first town wins; once cleared it names the town', /No town has cleared it yet\. The first wins 🪶 Greyfeather&#39;s Pinion, on silver \(\+160 wealth\)\./.test(K.tileHtml({ dungeon: d({ prize }) }, people))
    && /The first wins 🪶 Greyfeather&#39;s Pinion, on silver/.test(K._listHtml([d({ prize })], null)) && !/The first wins/.test(K.tileHtml({ dungeon: d({ cleared_by: 1, first_clear: 'A', prize: null }) }, people)));
  const hall = { have: 2, kinds: 35, total: 3, trophies: [{ tier: 'red', icon: '🪶', title: 'Greyfeather\'s Pinion, on silver', count: 2, words: 'One grey <feather>.', last: { dungeon: 'Thornhall' } }, { tier: 'green', icon: '👑', title: 'Redtooth\'s Crown, on oak', count: 1, words: 'A crown.', last: { dungeon: 'Windmill Deeps' } }] };
  const hh = K._hallHtml(hall);
  check('12A. the trophy hall: how many of the full hall, a chip for each kind in its skull\'s colour, a count for more than one', /🏆 Trophy hall <span class="kwdg-hall-count">2 of 35<\/span>/.test(hh) && (hh.match(/class="kwdg-trophy-chip /g) || []).length === 2
    && /kwdg-trophy-chip kwdg-skull-red" title="One grey &lt;feather&gt;\. Won in Thornhall\.">🪶 Greyfeather&#39;s Pinion, on silver <b>×2<\/b>/.test(hh) && !/×1/.test(hh));
  check('12B. an empty hall says how to fill it; the hall is at the foot of the list, and there with no dungeon found', /Empty so far\. Be the first town to clear a dungeon/.test(K._hallHtml({ have: 0, kinds: 35, trophies: [] }))
    && /kwdg-hall/.test(K._listHtml([d()], null, hall)) && /kwdg-hall/.test(K._listHtml([], null, hall)) && K._hallHtml(null) === '' && /MAP\.hall = d\.hall \|\| null/.test(J));
  const won = K._endHtml(run({ status: 'cleared', result: { kept: { wealth: 30, items: [] }, first_clear: true, trophy: { icon: '🪶', title: 'Greyfeather\'s Pinion, on silver', words: 'One grey flight feather.', wealth: 160 } } }));
  check('12C. the last screen of a first clear shows the trophy and the wealth that came with it', /🏆 First of any town to clear it/.test(won) && /<b>🪶 Greyfeather&#39;s Pinion, on silver<\/b> now hangs in your trophy hall, and the town is 160 wealth richer\./.test(won)
    && /One grey flight feather\./.test(won) && !/kwdg-trophy/.test(K._endHtml(run({ status: 'cleared', result: { kept: { wealth: 30, items: [] } } }))));
  {
    const MAIN2 = read('js/main.js'), LB = read('js/leaderboard.js');
    const tag = new Function(MAIN2.match(/function _trophyTag\(s\) \{[\s\S]*?\n\}/)[0] + '; return _trophyTag;')();
    check('12D. a town\'s panel shows how many dungeon trophies it has, yours and other towns\'', /🏆 3 dungeon trophies/.test(tag({ trophies: 3 })) && /🏆 1 dungeon trophy</.test(tag({ trophies: 1 })) && tag({ trophies: 0 }) === '' && tag({}) === ''
      && (MAIN2.match(/_trophyTag\(s\)/g) || []).length >= 3);
    check('12E. Rankings has a Dungeon Trophies board', /B\('trophies', 'Dungeon Trophies', \{ icon: '🏆'/.test(LB) && /Rankings → Dungeon Trophies/.test(read('js/help.js')));
  }
  check('12x. the list and the card take the skull\'s colour from the shared tokens', ['green', 'yellow', 'orange', 'red', 'purple'].every(k => CSS.includes(`.kwdg-skull-${k}`) && CSS.includes(`var(--kw-skull-${k})`)) && /\.kwdg-entry \{[^}]*border-left: 4px solid var\(--kwdg-skull/.test(CSS));
}

console.log('13. The walk to a dungeon and home');
{
  const KT = read('js/kwmap-travel.js'), RT = read('js/realtime.js'), L = read('js/kwmap-dungeons.js');
  const now = Date.parse('2026-11-26T12:00:00Z'), at = s => new Date(now + s * 1000).toISOString();
  check('13a. the countdown: minutes and seconds, then "now"', K._clock(at(92), now) === '1:32' && K._clock(at(5), now) === '0:05' && K._clock(at(0), now) === 'now' && K._clock(at(-30), now) === 'now');
  check('13b. how long a walk is, in words', K._walkWords(30) === '30 seconds' && K._walkWords(120) === '2 minutes' && K._walkWords(210) === 'about 4 minutes' && K._walkWords(0) === '');
  const road = run({ status: 'travelling', arrives_at: at(92), can_recall: true, moves: [], can_leave: false });
  const th = K._travelHtml(road, now);
  check('13c. on the road: who is walking, how long to the door, and Call them back', /🚶 On the road/.test(th) && /They reach the door in <b class="kwdg-clock" data-kwdg-clock="[^"]+">1:32<\/b>/.test(th) && /data-action="recall">↩ Call them back</.test(th)
    && (th.match(/class="kwdg-member/g) || []).length >= 4 && !/data-action="enter"/.test(th) && /the dungeon is not used up/.test(th));
  check('13d. a party on the road is the live run: its screen is the road, its subtitle says so', K._subtitle(road) === '🟢 Easy · On the road' && /run\.status === 'travelling' \? travelHtml\(run\) : run\.status === 'active' \? runHtml\(run\) : endHtml\(run\)/.test(J)
    && /run\.status === 'active' \|\| run\.status === 'travelling'\)\) \{ S\.run = run;/.test(J));
  const homing = K._endHtml(run({ status: 'cleared', walking_home: true, home_at: at(150), result: { kept: { wealth: 30, items: [] } } }), now);
  check('13e. after the run: walking home with a countdown, and what they carry', /🚶 Walking home/.test(homing) && /Back in <b class="kwdg-clock" data-kwdg-clock="[^"]+">2:30<\/b>\. What they carry reaches your stores when they arrive\./.test(homing)
    && /Carrying home/.test(homing) && !/Came home/.test(homing) && /Came home/.test(K._endHtml(run({ status: 'cleared', result: { kept: { wealth: 30, items: [] } } }), now)));
  const back = K._endHtml(run({ status: 'recalled', walking_home: true, home_at: at(20), result: { ending: 'recalled' } }), now);
  check('13f. called back: only the walk home, and the dungeon can still be tried', /↩ Called back/.test(back) && /can still try this dungeon/.test(back) && /Back in <b[^>]*>0:20<\/b>\.<\/p>/.test(back) && !/Injuries|Carrying home|Came home/.test(back));
  check('13g. Call them back asks first, then tells the server', /post\('run\/recall'\)/.test(J) && /title: 'Call them back\?'/.test(J));
  check('13h. the clock ticks once a second while the window is open and asks the server when the time is up', /setInterval\(tickClock, 1000\)/.test(J) && /if \(due && Date\.now\(\) - _asked > 3000 && !S\.busy\) \{ _asked = Date\.now\(\); load\(\); \}/.test(J)
    && /if \(!S\.win\) \{ if \(_clock\) \{ clearInterval\(_clock\); _clock = null; \} return; \}/.test(J));
  const d = (x = {}) => ({ id: 7, q: 5, r: 6, name: 'Windscar Hollow', tier: 'green', tier_name: 'Easy', skull: '🟢', floors: 2, intro: 'A cold draught.', suggested_party: 'villagers', band: 'The Night Pack', hours_left: 70, distance: 3, in_reach: true, mine: null, cleared_by: 0, walk_secs: 90, ...x });
  const people = [1, 2, 3, 4].map(i => ({ id: i, name: 'C' + i, role: 'idle' }));
  check('13i. the card says how long the walk is', /It is about 2 minutes on foot each way\. /.test(K.tileHtml({ dungeon: d() }, people)) && /It is 30 seconds on foot each way\./.test(K.tileHtml({ dungeon: d({ walk_secs: 30 }) }, people)) && !/on foot/.test(K.tileHtml({ dungeon: d({ walk_secs: 0 }) }, people)));
  check('13j. on its way: open the dungeon; called back: wait for them', K._standing(d({ mine: 'travelling' })).state === 'inside' && /on its way there/.test(K._standing(d({ mine: 'travelling' })).words)
    && K._standing(d({ mine: 'recalled' })).state === 'wait' && /data-dungeon-open/.test(K.tileHtml({ dungeon: d({ mine: 'travelling' }) }, people)) && !/data-dungeon-enter/.test(K.tileHtml({ dungeon: d({ mine: 'recalled' }) }, people)));
  check('13k. the map\'s ring is gold for a party on its way as well as inside; a called-back party does not fade the skull', /inside = d\.mine === 'active' \|\| d\.mine === 'travelling', done = !!d\.mine && !inside && d\.mine !== 'recalled'/.test(L));
  check('13l. the travel layer names the party and opens the dungeon from its card', /dungeon: 'Dungeon party'/.test(KT) && /dungeon: '💀 Open the dungeon'/.test(KT) && /j\.open === 'dungeon' && global\.KWDungeon\) global\.KWDungeon\.open\(\)/.test(KT));
  check('13m. the travel layer is read again when a party sets out, is called back or ends its run', (J.match(/roads\(\);/g) || []).length >= 4 && /KWTravel\.refresh\(\)/.test(J));
  check('13n. arriving at the door and getting home are live events', /dungeon_arrived\(ev\)/.test(RT) && /dungeon_home\(ev\)/.test(RT) && /ev\.type === 'dungeon_arrived'/.test(J) && /ev\.type === 'dungeon_home'/.test(J) && /load\(\); afterEnd\(\);/.test(J));
  const dev = K._devHtml({ on: true, party: 4, free_adults: 6, tiers: [], lands: [], stories: [], run: road, last: null });
  const devHome = K._devHtml({ on: true, party: 4, free_adults: 6, tiers: [], lands: [], stories: [], run: null, last: run({ status: 'left', walking_home: true, home_at: at(50) }) });
  check('13q. when the party that was walking home is in, the stores and citizens are read again', /wasWalking = !!\(S\.last && S\.last\.walking_home\)/.test(J) && /if \(was \|\| \(wasWalking && !\(S\.last && S\.last\.walking_home\)\)\) afterEnd\(\);/.test(J));
  check('13o. Dev Tools can finish the walk, there or home', /data-kwdg="arrive">Finish the walk now</.test(dev) && /walking home with what it found/.test(devHome) && /data-kwdg="arrive"/.test(devHome) && /devCall\('POST', 'arrive'\)/.test(J)
    && !/data-kwdg="arrive"/.test(K._devHtml({ on: true, party: 4, free_adults: 6, tiers: [], lands: [], stories: [], run: run(), last: null })));
  check('13p. Help says the party walks there and home', /walk there<\/b>, half a minute a tile/.test(read('js/help.js')) && /walks home<\/b>, and what it carries reaches your stores when it arrives/.test(read('js/help.js')));
}

console.log('14. Event rooms, blessings and curses, keepsakes');
{
  const ev = { kind: 'event', key: 'mossy_shrine', title: 'The Mossy <Shrine>', icon: '⛩️', text: 'A shrine to the old wood.', options: [
    { key: 'offer', label: 'Leave an offering', kind: 'certain', cost: 15, disabled: true, why: 'The party is carrying 10 wealth; this takes 15.' },
    { key: 'tend', label: 'Tend it', kind: 'try', chance: 81, who: { id: 2, name: 'Hazel', role: 'Hearthkeeper', suited: true }, suits: 'a Hearthkeeper', stat: 'charisma', win: 'blessing: The Wood\'s Favour (Endurance +2), everyone heals 10%', lose: 'curse: Slighted (Agility −1)' },
    { key: 'dig', label: 'Dig under it', kind: 'try', chance: 31, who: { id: 1, name: 'Ash', role: 'Farmer', suited: false }, suits: 'a Miner', stat: 'strength', win: 'a keepsake', lose: 'they lose 15% health' },
    { key: 'wager', label: 'Wager', kind: 'gamble', chance: 50, cost: 20, win: '40 wealth', lose: 'nothing' },
    { key: 'pass', label: 'Walk on', kind: 'certain', text: 'nothing' },
  ] };
  const html = K._pendingHtml(run({ room_open: true, moves: [], pending: ev }));
  check('14a. an event room shows its situation and a button for each option', /⛩️ The Mossy &lt;Shrine&gt;/.test(html) && /A shrine to the old wood\./.test(html) && (html.match(/data-action="choose"/g) || []).length === 5 && /data-option="tend"/.test(html) && !/<Shrine>/.test(html));
  check('14b. a try shows its chance and who would try, and what each end brings', />81%<\/span> <b>Hazel<\/b> \(Hearthkeeper\) tries/.test(html) && /<b>If it comes off:<\/b> blessing: The Wood&#39;s Favour \(Endurance \+2\), everyone heals 10%\./.test(html) && /<b>If not:<\/b> curse: Slighted/.test(html));
  check('14c. good odds and poor odds look different; a try by the wrong citizen says who would do it better', /kwdg-odds is-good"[^>]*>81%/.test(html) && /kwdg-odds is-poor"[^>]*>31%/.test(html) && /<i>\(better with a Miner\)<\/i>/.test(html) && !/better with a Hearthkeeper/.test(html) && /\.kwdg-odds\.is-good/.test(CSS) && /\.kwdg-odds\.is-poor/.test(CSS));
  check('14d. a gamble shows plain odds; a cost is on the button; an option the party cannot pay for is greyed and says why', />50%<\/span> A gamble/.test(html) && /Wager <span class="kwdg-cost">🪙 20<\/span>/.test(html) && /data-option="offer" disabled/.test(html) && /The party is carrying 10 wealth; this takes 15\./.test(html));
  check('14e. a certain option says what it does, or that nothing happens', /Nothing happens\./.test(html) && /Nothing here can take the last of anyone&#39;s health|Nothing here can take the last of anyone's health/.test(html));
  const hap = { key: 'mossy_shrine', title: 'The Mossy Shrine', icon: '⛩️', option: 'tend', label: 'Tend it', kind: 'try', won: true, chance: 81, roll: 40, who: { id: 2, name: 'Hazel', role: 'Hearthkeeper' }, text: 'Cleared of dead leaves.', lines: ['A blessing: 🌿 The Wood\'s Favour. Endurance +2 for the rest of the run.', 'Everyone gets back 10% of their health.'] };
  const after = K._runHtml(run({ happened: hap, carried: [{ key: 'woods_favour', kind: 'blessing', name: 'The Wood\'s Favour', icon: '🌿', says: 'Endurance +2 for the rest of the run.' }, { key: 'spores', kind: 'curse', name: 'Blight Spores', icon: '🍄', says: 'Everyone starts the next fight poisoned.', fights: 1 }, { key: 'old_banner', kind: 'keepsake', name: 'Old Banner', icon: '🚩', says: 'First attack +4.' }] }));
  check('14f. once answered, the screen says what came of it: who tried, the chance, how it went, and each thing it changed', /kwdg-happened/.test(after) && /The Mossy Shrine: Tend it/.test(after) && /Hazel tried it: a 81% chance\. <b>It came off\.<\/b>/.test(after) && /Cleared of dead leaves\./.test(after) && (after.match(/<li>/g) || []).length === 2);
  check('14g. a miss is said as plainly', /It did not come off\./.test(K._happenedHtml({ ...hap, won: false })) && /is-lost/.test(K._happenedHtml({ ...hap, won: false })) && !/tried it/.test(K._happenedHtml({ ...hap, kind: 'certain', won: null })) && /The party took the gamble/.test(K._happenedHtml({ ...hap, kind: 'gamble', who: null })));
  check('14h. what the run carries is listed under the path: blessings, curses and keepsakes, each saying what it does', /kwdg-carried/.test(after) && /kwdg-chip is-blessing"[^>]*title="Endurance \+2 for the rest of the run\."/.test(after) && /kwdg-chip is-curse/.test(after) && /Blight Spores <i>\(next fight\)<\/i>/.test(after) && /kwdg-chip is-keepsake/.test(after)
    && K._carriedHtml([]) === '' && /\.kwdg-chip\.is-curse/.test(CSS) && /\.kwdg-chip\.is-keepsake/.test(CSS));
  check('14i. while an event waits for an answer, the last room\'s result is not shown over it', !/kwdg-happened/.test(K._runHtml(run({ room_open: true, moves: [], pending: ev, happened: hap }))));
  const fightHtml = K._pendingHtml(run({ room_open: true, moves: [], pending: { kind: 'battle', board: true, battle_id: 9, room: 'event', foes: [{ key: 'rat_cutpurse', name: 'Rat Cutpurse' }] } }));
  check('14j. a fight an event wakes names whoever was woken, not the room\'s own list', /Rat Cutpurse block the way/.test(fightHtml) && !/Wolf Raider/.test(fightHtml) && /data-action="fight"/.test(fightHtml));
  check('14k. a keepsake found in a treasure room is in the toast', /and a keepsake: \$\{d\.found\.keepsake\.icon\} \$\{d\.found\.keepsake\.name\}/.test(J));
  const T = read('js/tactics.js');
  check('14l. the battle says what the run carried into it, and what keepsake a fight brought', /Carried into this fight/.test(T) && /\(\(f && f\.gained\) \|\| \[\]\)\.map\(g => `Gained: \$\{g\} `\)/.test(T));
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  check('14m. the stylesheet still uses tokens only', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|!important/.test(bare) && !/var\(--kw-ok\)/.test(bare));
  check('14n. Help says what an event is, a try, a blessing, a curse and a keepsake', /Some rooms are <b>events<\/b>/.test(read('js/help.js')) && /the chance is shown before you choose/.test(read('js/help.js')) && /<b>keepsake<\/b>/.test(read('js/help.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
