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

console.log('10. Class decks');
{
  const C = (key, name, x = {}) => ({ key, name, cost: 1, type: 'attack', n: 1, text: 'Deal 16 damage', desc: 'A hard blow.', reach: 'the front creature', heal: false, once: false, honed: false, basic: false, ...x });
  const deck = { cls: 'guard', label: 'Guard', icon: '🛡️', size: 11, cards: [C('g_strike', 'Strike', { n: 3, basic: true }), C('g_cover', 'Cover', { type: 'defense', text: 'Gain 14 block', reach: 'a friend', n: 2 }), C('g_strike_honed', 'Strike ✦', { honed: true, text: 'Deal 21 damage' })], spent: [] };
  const party = run().party.map((m, i) => i === 0 ? { ...m, deck } : i === 1 ? { ...m, deck: { cls: 'villager', label: 'Villager', icon: '🧺', size: 9, cards: [C('v_swing', 'Swing', { n: 5, basic: true })], spent: [C('t_ration', 'Share Rations', { heal: true })] } } : m);
  const card = K._cardHtml(C('g_strike', 'Strike', { n: 3 }));
  check('10a. a card shows its cost, its name and copies, what it does and whom it reaches', />1<\/span>/.test(card) && /Strike <i>×3<\/i>/.test(card) && /Deal 16 damage/.test(card) && /the front creature/.test(card) && /aria-label="Strike, costs 1\. Deal 16 damage Reaches the front creature\."/.test(card));
  check('10b. a heal says it is spent until the party rests; a once-a-fight card says so', /Spent until the party rests/.test(K._cardHtml(C('h_kindle', 'Kindle', { heal: true, type: 'support' }))) && /Once a fight/.test(K._cardHtml(C('g_hold_line', 'Hold the Line', { once: true }))) && /kwdg-card-support/.test(K._cardHtml(C('h_kindle', 'Kindle', { heal: true, type: 'support' }))));
  check('10c. a card on offer is a button; a card being read is not', /^<button type="button" class="kwdg-card [^"]*" data-action="hone"/.test(K._cardHtml(C('a', 'A'), 'data-action="hone"')) && /^<div class="kwdg-card /.test(card));
  const strip = K._partyHtml(party);
  check('10d. each citizen in the party strip says their class and how many cards, and opens their deck', /data-action="deck" data-citizen="1" aria-expanded="false" aria-label="Hazel, Guard: see their 11 cards">🛡️ Guard · 11 cards</.test(strip) && /🧺 Villager · 9 cards/.test(strip) && (strip.match(/data-action="deck"/g) || []).length === 2);
  const open1 = K._deckHtml(party[0]), open2 = K._deckHtml(party[1]);
  check('10e. an open deck lists every card, the honed one marked', /Hazel, Guard: 11 cards/.test(open1) && (open1.match(/class="kwdg-card /g) || []).length === 3 && /kwdg-card kwdg-card-attack is-honed/.test(open1) && /is-basic/.test(open1));
  check('10f. and says which heals are spent until the party rests', /Spent until the party rests: Share Rations\./.test(open2) && !/Spent until the party rests:/.test(open1));
  const door = K._doorHtml({ kind: 'door', citizens: [{ id: 1, name: 'Hazel', done: false, cards: [C('g_cover', 'Cover'), C('g_heavy', 'Heavy Blow'), C('g_shove', 'Shove')] }, { id: 2, name: 'Bram', done: true, cards: [C('a_mark', 'Mark')] }] });
  check('10g. at the door: three cards for each citizen who has not chosen, and a way to pass', (door.match(/data-action="pick-door" data-citizen="1" data-card="g_/g) || []).length === 3 && /data-action="pick-door" data-citizen="1" data-card="">Pass</.test(door) && /1 still to choose/.test(door));
  check('10h. a citizen who has chosen shows as done, with nothing to press', /kwdg-pick-row is-done[\s\S]*?✓ Chosen/.test(door) && !/data-citizen="2"/.test(door));
  const rew = K._rewardHtml({ kind: 'reward', offers: [{ index: 0, citizen: 1, name: 'Hazel', card: C('g_heavy', 'Heavy Blow') }, { index: 1, citizen: 2, name: 'Bram', card: C('a_mark', 'Mark') }, { index: 2, citizen: 3, name: 'Ivy', card: C('c_cleave', 'Cleave') }] });
  check('10i. after a fight: three cards, each naming whose it would be, and a way to pass', (rew.match(/data-action="pick-reward" data-index="\d"/g) || []).length === 3 && /for Hazel/.test(rew) && /for Bram/.test(rew) && /for Ivy/.test(rew) && /data-action="pick-reward" data-index="">Pass</.test(rew));
  const resting = run({ party, room_open: true, moves: [], pending: { kind: 'rest', options: [{ key: 'hone', label: 'Rest, and hone a card', needs: 'card', text: 'The same rest, and one card.' }, { key: 'rest', label: 'Rest only', text: 'Heal.' }] } });
  const restBox = K._pendingHtml(resting);
  check('10j. a rest room: rest alone is sent at once; rest with a hone opens a chooser first', /data-action="choose" data-option="rest">Rest only</.test(restBox) && /data-action="hone-open" data-option="hone">Rest, and hone a card</.test(restBox));
  const hone = K._honeHtml(resting);
  check('10k. the chooser shows each citizen\'s cards that are not honed yet, and a way back', /data-action="hone" data-citizen="1" data-card="g_strike"/.test(hone) && /data-action="hone" data-citizen="1" data-card="g_cover"/.test(hone) && !/data-card="g_strike_honed"/.test(hone) && /data-action="hone-cancel">Back</.test(hone) && /The party rests as well\./.test(hone));
  const won = run({ party, moves: [], pending: { kind: 'reward', can_hone: true, offers: [{ index: 0, citizen: 1, name: 'Hazel', card: C('g_cover', 'Cover') }] } });
  const wonBox = K._pendingHtml(won);
  check('10k2. after a fight: keep a card, pass, or hone a card in its place', /data-action="pick-reward" data-index="0"/.test(wonBox) && /data-action="hone-open">✦ Hone a card instead</.test(wonBox) && /data-action="pick-reward" data-index="">Pass</.test(wonBox)
    && !/Hone a card instead/.test(K._pendingHtml(run({ party, moves: [], pending: { kind: 'reward', offers: won.pending.offers } }))));
  check('10k3. that chooser says no new card is taken, and sends the hone as the pick', /The party takes no new card from this fight\./.test(K._honeHtml(won)) && J.includes("post('run/pick', { hone: what })"));
  check('10l. each choice is sent to the server and the screen redrawn from the answer', ["post('run/pick', { citizen_id: Number(el.getAttribute('data-citizen')), card: el.getAttribute('data-card') || null })", "post('run/pick', { index: i === '' ? null : Number(i) })", "post('run/choose', { option: 'hone', ...what })"].every(x => J.includes(x)));
  check('10m. a choice of cards comes before the path: the door and the reward are drawn where the room\'s choice would be', /if \(p\.kind === 'door'\) return doorHtml\(p\);\s*if \(p\.kind === 'reward'\) return rewardHtml\(p\);/.test(J));
  const coll = { classes: [{ cls: 'guard', label: 'Guard', icon: '🛡️', pack: [{ ...C('g_strike', 'Strike', { n: 3, basic: true }), owned: true, prepared: true, unlock: false }, { ...C('g_cover', 'Cover', { n: 2 }), owned: true, prepared: false, unlock: false }], trades: [],
    more: [{ ...C('g_stand_fast', 'Stand Fast'), owned: true, prepared: true, unlock: true }, { ...C('g_hammer', 'Hammer Blow'), owned: false, prepared: true, unlock: true, how: 'Watchtower level 3' }] }] };
  const cw = K._collectionHtml(coll, 'guard');
  check('10n. class cards: the pack, then what the town can unlock', /The Guard pack/.test(cw) && /Cards the town can unlock/.test(cw) && (cw.match(/kwdg-coll-row/g) || []).length === 4);
  check('10o. a card that can be offered has a Prepared tick, on or off; a plain card has none', /data-action="prepare" data-card="g_cover"> Prepared/.test(cw) && /data-action="prepare" data-card="g_stand_fast" checked> Prepared/.test(cw) && !/data-card="g_strike"/.test(cw));
  check('10p. a card not unlocked yet says how to get it, and has no tick', /is-locked[\s\S]*?🔒 Watchtower level 3/.test(cw) && !/data-card="g_hammer"/.test(cw));
  check('10q. the tick is sent to the server and the list redrawn from the answer', /apiFetch\('\/api\/dungeons\/cards\/prepare', \{ method: 'POST'[^}]*\}[^)]*body: JSON\.stringify\(\{ card: el\.getAttribute\('data-card'\), prepared: !!el\.checked \}\)/.test(J) && /if \(res\.ok && d\.ok\) S\.cards = d;/.test(J));
  const atDoor = K._runHtml(run({ moves: [], pending: { kind: 'door', citizens: [{ id: 1, name: 'Hazel', done: false, cards: [C('g_cover', 'Cover')] }] } }));
  check('10s. a choice of cards is drawn above the floor; a room\'s own choice below it', atDoor.indexOf('kwdg-pick') < atDoor.indexOf('kwdg-map-wrap') && K._runHtml(resting).indexOf('kwdg-pending') > K._runHtml(resting).indexOf('kwdg-map-wrap'));
  check('10r. the path screen and Dev Tools both open the class cards', /data-action="cards">🃏 Class cards</.test(K._runHtml(run())) && /data-kwdg="cards">Open the class cards</.test(K._devHtml({ on: false, party: 4, free_adults: 4, stories: [], tiers: [], lands: [], run: null, last: null })));
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
  const d = { on: false, party: 4, free_adults: 6, tiers: [{ key: 'green', name: 'Easy', skull: '🟢' }, { key: 'purple', name: 'Nightmare', skull: '🟣' }], lands: ['forest', 'marsh'], stories: [{ key: 'test_green', name: 'The Hollow under the Oak', skull: '🟢', floors: 1 }, { key: 'test_orange', name: 'The Stair below the Crag', skull: '🟠', floors: 2 }], run: null, last: null };
  const html = K._devHtml(d);
  check('9b. it says dungeons are off for players and offers the switch', /Dungeons are <b>off<\/b> for players/.test(html) && /data-kwdg="switch" data-on="1">Turn dungeons on for players</.test(html));
  check('9c. a button for each test dungeon', /data-kwdg="start" data-story="test_green">🟢 Start: The Hollow under the Oak \(1 floor\)</.test(html) && /data-story="test_orange">🟠 Start: The Stair below the Crag \(2 floors\)</.test(html));
  check('9d. too few free adults: the start buttons are off', (K._devHtml({ ...d, free_adults: 3 }).match(/data-kwdg="start"[^>]* disabled/g) || []).length === 2);
  const live = K._devHtml({ ...d, on: true, run: run({ can_flee: true, pending: { kind: 'battle', quest_run_id: 1, room: 'fight' } }) });
  check('9e. with a run under way: open it, win the fight, heal, or leave it idle', ['open', 'win', 'heal', 'idle'].every(a => live.includes(`data-kwdg="${a}"`)) && /a fight is open/.test(live) && (live.match(/data-kwdg="start"[^>]* disabled/g) || []).length === 2);
  check('9h. a generated dungeon: choose the skull and the land, give a seed or leave it, and start', /<select id="kwdg-dev-tier"[^>]*><option value="green">🟢 Easy<\/option><option value="purple">🟣 Nightmare<\/option>/.test(html) && /<select id="kwdg-dev-land"[^>]*><option value="forest">Forest<\/option><option value="marsh">Marsh<\/option>/.test(html) && /id="kwdg-dev-seed"[^>]*placeholder="any"/.test(html) && /data-kwdg="generate">Generate and start</.test(html));
  check('9i. the choice is sent to the admin route (with board or cards); an empty seed is left to the server', /devCall\('POST', 'generate', \{ tier: val\('kwdg-dev-tier'\), terrain: val\('kwdg-dev-land'\), seed: seed > 0 \? seed : undefined, combat: DEV\.pick\.combat === 'cards' \? 'cards' : 'board' \}\)/.test(J));
  const made = run({ can_flee: false }); made.dungeon = { ...made.dungeon, generated: true, terrain: 'marsh', seed: 1234 };
  check('9j. a generated run says its skull, land and seed, so it can be made again', /\(🟢 marsh, seed 1234\)/.test(K._devHtml({ ...d, on: true, run: made })) && (K._devHtml({ ...d, on: true, run: made }).match(/data-kwdg="generate"[^>]* disabled/) || []).length === 1);
  const picked = K._devHtml(d, { tier: 'purple', land: 'marsh', seed: '77' });
  check('9k. what was chosen stays chosen when the panel is redrawn', /<option value="purple" selected>/.test(picked) && /<option value="marsh" selected>/.test(picked) && /id="kwdg-dev-seed"[^>]*value="77"/.test(picked) && /el\.addEventListener\('change', keep\);\s*el\.addEventListener\('input', keep\);/.test(J) && /devHtml\(DEV\.data, DEV\.pick\)/.test(J));
  check('9f. one click listener, no inline handlers', /el\.addEventListener\('click', ev => \{ const t = ev\.target\.closest\('\[data-kwdg\]'\);/.test(J));
  check('9g. the admin routes are the ones used', /apiFetch\('\/api\/dungeons\/admin\/' \+ path/.test(J) && ["devCall('GET', 'status')", "devCall('POST', 'test'", "devCall('POST', 'win')", "devCall('POST', 'heal')", "devCall('POST', 'sweep', { idle_run: true })", "devCall('POST', 'switch'"].every(s => J.includes(s)));
}

console.log('10. The class buildings in the Home scene');
{
  const SV = read('js/settlement-view.js'), VE = read('js/villager-engine.js'), CZ = read('js/citizens.js');
  check('10a. the Hearth Shrine has a plot in Town and a look', /id:'town-shrine',\s+area:'town',[^}]*accepts:\['hearth_shrine'\]/.test(SV) && /hearth_shrine: *\{ emoji:/.test(SV));
  check('10b. the Wizard\'s Tower has a plot in the Outskirts and a look', /id:'out-tower',\s+area:'outskirts',[^}]*accepts:\['wizard_tower'\]/.test(SV) && /wizard_tower: *\{ emoji:/.test(SV));
  check('10c. Wizards and Hearthkeepers walk to their own buildings', /wizard: 'wizard_tower', hearthkeeper: 'hearth_shrine'/.test(VE));
  check('10d. both jobs have an icon on a citizen\'s card', /wizard: '🔮', hearthkeeper: '🔥'/.test(CZ));
  const slots = [...SV.matchAll(/\{ id:'([a-z-]+)',\s+area:'(town|outskirts)',\s+x:([\d.]+),\s+y:([\d.]+)/g)].map(m => ({ id: m[1], area: m[2], x: +m[3], y: +m[4] }));
  const near = slots.filter(a => slots.some(b => b !== a && b.area === a.area && b.y === a.y && Math.abs(b.x - a.x) < 10));
  check('10e. no two plots in a row stand closer than a tenth of the field', slots.length === 20 && near.length === 0, near.map(q => q.id).join());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
