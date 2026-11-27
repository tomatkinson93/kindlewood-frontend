// Proofs for the tactics battle prototype (docs/TACTICS.md):
// the rules in js/tactics-engine.js, and the screen's wiring in js/tactics.js.
//   node verify/tactics_proofs.js
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const E = require(path.join(ROOT, 'js', 'tactics-engine.js'));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; };

// A flat 8 × 8 field and plain units, so each rule can be shown by itself.
const flat = (w = 8, h = 8) => ({ w, h, land: 'plains', tiles: Array.from({ length: w * h }, () => ({ h: 0, t: 'grass' })) });
const strike = (x = {}) => ({ key: 'strike', name: 'Strike', kind: 'attack', target: 'enemy', min: 1, max: 1, shape: 'single', dmg: 10, fx: {}, cooldown: 0, ...x });
const man = (id, x = {}) => ({ id, name: id, cls: 'guard', icon: '🛡️', maxHp: 50, armour: 0, agility: 10, move: 3, jump: 1, abilities: [strike()], ...x });
const battle = (party, enemies, map) => E.createBattle({ seed: 5, map: map || flat(), party, enemies });
const put = (st, id, x, y, face) => { const u = E.unit(st, id); u.x = x; u.y = y; if (face) u.face = face; return u; };

console.log('1. The map');
{
  const lands = Object.keys(E.LANDS);
  let bad = 0, steep = 0, startsBlocked = 0;
  for (const land of lands) for (let seed = 1; seed <= 150; seed++) {
    const m = E.makeMap(seed, land);
    if (!E.connected(m)) bad++;
    for (const [x, y] of E.starts(m.w, m.h).player.concat(E.starts(m.w, m.h).enemy)) if (x >= 0 && x < m.w && !E.passable(E.tileAt(m, x, y))) startsBlocked++;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w - 1; x++) { const a = E.tileAt(m, x, y), b = E.tileAt(m, x + 1, y); if (E.passable(a) && E.passable(b) && Math.abs(a.h - b.h) > 1) steep++; }
  }
  check('1a. seven lands; on 1,050 maps the two sides can always walk to each other', lands.length === 7 && bad === 0, `${bad} cut off`);
  check('1b. nobody starts on water, a tree or a rock', startsBlocked === 0);
  check('1c. every slope can be walked: neighbouring ground never differs by more than one level', steep === 0, `${steep} cliffs`);
  check('1d. the same seed and land give the same map', JSON.stringify(E.makeMap(77, 'hills')) === JSON.stringify(E.makeMap(77, 'hills')) && JSON.stringify(E.makeMap(77, 'hills')) !== JSON.stringify(E.makeMap(78, 'hills')));
  const hilly = E.makeMap(3, 'mountain'), wet = E.makeMap(3, 'river');
  check('1e. mountains have height; a river has water with a way across', Math.max(...hilly.tiles.map(t => t.h)) >= 2 && wet.tiles.some(t => t.t === 'water') && E.connected(wet));
}

console.log('2. Turns and moving');
{
  let st = battle([man('a', { agility: 12 }), man('b', { agility: 6 })], [man('x', { agility: 9 })]);
  check('2a. the quickest goes first; the party first on a tie', st.order.join() === 'a,x,b' && E.current(st).id === 'a' && battle([man('a')], [man('x')]).order.join() === 'a,x');
  const a = E.current(st), R = E.reach(st, a);
  const far = [...R.values()].map(n => n.cost);
  check('2b. a unit walks up to its Move in steps, no diagonals', Math.max(...far) === 3 && R.has(`${a.x},${a.y - 3}`) && !R.has(`${a.x},${a.y - 4}`) && R.get(`${a.x + 1},${a.y - 1}`).cost === 2);
  const ev = E.move(st, a.x, a.y - 2);
  check('2c. moving walks a path and turns the unit the way it went', ev && ev[0].type === 'move' && ev[0].path.length === 3 && a.face === 'n' && st.turn.moved);
  check('2d. one move a turn', E.move(st, a.x, a.y - 1) === null);
  check('2e. a move can be taken back until the unit does something else', E.undoMove(st) === true && !st.turn.moved && a.y === 6 && E.undoMove(st) === false);
  // Height, obstacles, friends and foes.
  const m = flat(); m.tiles[5 * 8 + 3] = { h: 2, t: 'grass' }; m.tiles[5 * 8 + 4] = { h: 0, t: 'water' }; m.tiles[6 * 8 + 2] = { h: 1, t: 'grass' };
  st = battle([man('a'), man('b')], [man('x')], m);
  put(st, 'a', 3, 6); put(st, 'b', 4, 6); put(st, 'x', 3, 7);
  const R2 = E.reach(st, E.unit(st, 'a'));
  check('2f. a step climbs one level, not two; water, trees and rocks cannot be entered', R2.has('2,6') && !R2.has('3,5') && !R2.has('4,5'));
  check('2g. a unit may pass a friend but not stop there, and cannot pass a foe', R2.get('4,6').stop === false && R2.has('5,6') && !R2.has('3,7'));
  E.unit(st, 'a').st.slow = 2;
  check('2h. a slowed unit walks one step less', E.moveOf(E.unit(st, 'a')) === 2);
  // Facing at the end of a turn.
  st = battle([man('a', { agility: 12 })], [man('x', { agility: 5 })]);
  put(st, 'a', 3, 6, 'n'); put(st, 'x', 6, 6, 's');
  check('2i. left to itself a unit ends its turn watching the nearest foe', E.facingFor(st, E.unit(st, 'a')) === 'e' && (E.endTurn(st), E.unit(st, 'a').face === 'e'));
  E.endTurn(st);
  const turned = E.endTurn(st, 'w');
  check('2j. …or the way its player chooses', E.unit(st, 'a').face === 'w' && turned.some(e => e.type === 'face' && e.face === 'w') && (E.endTurn(st), E.endTurn(st, 'sideways'), E.unit(st, 'a').face === 'e'));
}

console.log('3. Reach, facing and height');
{
  const bow = strike({ key: 'bow', min: 2, max: 4 });
  let st = battle([man('a', { abilities: [strike(), bow] })], [man('x', { agility: 1 })]);
  const a = put(st, 'a', 3, 6), x = put(st, 'x', 3, 5, 's');
  const tiles = ab => E.targetTiles(st, a, E.ability(a, ab)).map(t => t.x + ',' + t.y).join(' ');
  check('3a. a melee blow reaches the next tile; a bow cannot shoot the tile beside it', tiles('strike') === '3,5' && tiles('bow') === '');
  put(st, 'x', 3, 2, 's');
  check('3b. a bow reaches four tiles on the flat', tiles('bow') === '3,2' && (put(st, 'x', 3, 1), tiles('bow') === ''));
  st.map.tiles[6 * 8 + 3].h = 1;
  check('3c. …and one further for each level it stands above its target', tiles('bow') === '3,1');
  const hi = E.forecast(st, a, E.ability(a, 'bow'), 3, 1)[0];
  check('3d. a hit from higher ground does 15% more', hi.high === true && hi.dmg === 12, `${hi.dmg}`);
  st.map.tiles[6 * 8 + 3].h = 0;
  // Facing: x at 3,5 looks south (towards y+).
  put(st, 'x', 3, 5, 's');
  const from = (ax, ay) => E.hitOf(st, a, strike(), x, 1, { x: ax, y: ay });
  check('3e. a hit from the front does its number, from the side a quarter more, from behind half as much again',
    from(3, 6).side === 'front' && from(3, 6).dmg === 10 && from(2, 5).side === 'side' && from(2, 5).dmg === 13 && from(3, 4).side === 'back' && from(3, 4).dmg === 15);
  put(st, 'a', 3, 6); put(st, 'x', 3, 5, 'n');
  const ev = E.use(st, 'strike', 3, 5);
  check('3f. the hit lands: health drops, the screen is told from which side', ev.some(e => e.type === 'hit' && e.side === 'back' && e.dmg === 15) && x.hp === 35 && st.turn.acted);
  check('3g. one action a turn', E.use(st, 'strike', 3, 5) === null);
  st.map.tiles[5 * 8 + 3].h = 2;
  check('3h. a melee blow cannot reach two levels up', E.targetTiles(st, a, strike()).length === 0);
}

console.log('4. Block, lasting effects, cooldowns');
{
  const guard = { key: 'guard', name: 'Guard', kind: 'block', target: 'self', min: 0, max: 0, shape: 'single', block: 8, fx: {}, cooldown: 1 };
  const curse = strike({ key: 'curse', dmg: 0, kind: 'debuff', fx: { weak: 3, vulnerable: 2 }, cooldown: 2 });
  let st = battle([man('a', { agility: 12, abilities: [strike(), guard, curse], armour: 4 })], [man('x', { agility: 5 })]);
  const a = put(st, 'a', 3, 6, 'n'), x = put(st, 'x', 3, 5, 's');
  E.use(st, 'guard');
  check('4a. block is gained on oneself', a.block === 8);
  E.endTurn(st);                                    // x's turn
  const h = E.forecast(st, x, E.ability(x, 'strike'), 3, 6)[0];
  check('4b. armour turns half its class, then block soaks the rest', h.armoured === 2 && h.blocked === 8 && h.dmg === 0, JSON.stringify(h));
  E.use(st, 'strike', 3, 6);
  check('4c. a soaked hit uses the block up', a.block === 0 && a.hp === 50);
  E.endTurn(st);                                    // a again
  check('4d. block is gone at the start of the bearer\'s next turn, and a cooldown of 1 skips one turn', a.block === 0 && E.canUse(st, a, E.ability(a, 'guard')).why === 'cooldown');
  E.use(st, 'curse', 3, 5);
  check('4e. weak and vulnerable are laid on', x.st.weak === 3 && x.st.vulnerable === 2);
  check('4f. a vulnerable target takes that much more; a weak attacker deals that much less', E.hitOf(st, a, strike(), x, 1).dmg === 12 && E.hitOf(st, x, strike(), a, 1).dmg + E.hitOf(st, x, strike(), a, 1).armoured === 7);
  E.endTurn(st);                                    // x: both drop by one as its turn starts
  check('4g. both wear off by one at the start of the bearer\'s turn', x.st.weak === 2 && x.st.vulnerable === 1);
  E.endTurn(st); E.endTurn(st); E.endTurn(st);      // a, x, a
  check('4h. a cooldown of 2 is ready again two turns later', E.canUse(st, a, E.ability(a, 'curse')).ok === false && (E.endTurn(st), E.endTurn(st), E.canUse(st, a, E.ability(a, 'curse')).ok === true));
  // Stun and poison.
  st = battle([man('a', { agility: 12 })], [man('x', { agility: 5 })]);
  E.unit(st, 'x').st.stun = 1; E.unit(st, 'x').st.poison = 3;
  const ev = E.endTurn(st);
  check('4i. poison bites at the start of the turn and wanes; a stunned unit loses the turn', ev.some(e => e.type === 'poison' && e.amount === 3) && ev.some(e => e.type === 'skip') && E.unit(st, 'x').hp === 47 && E.unit(st, 'x').st.poison === 2 && E.current(st).id === 'a');
}

console.log('5. Shapes, pushing, uses');
{
  const burst = strike({ key: 'burst', min: 1, max: 4, shape: 'burst', radius: 1 });
  const line = strike({ key: 'line', min: 1, max: 5, shape: 'line', falloff: 0.6 });
  const shove = strike({ key: 'shove', fx: { push: 1 } });
  const part = strike({ key: 'part', min: 1, max: 3, fx: { step: 1 } });
  const cheer = { key: 'cheer', name: 'Cheer', kind: 'block', target: 'ally_or_self', min: 0, max: 0, shape: 'around', radius: 2, block: 4, fx: {} };
  const heal = { key: 'heal', name: 'Heal', kind: 'heal', target: 'ally_or_self', min: 0, max: 3, shape: 'single', heal: 9, fx: {}, uses: 1 };
  let st = battle([man('a', { agility: 12, abilities: [burst, line, shove, part, cheer, heal] }), man('b', { agility: 11 })], [man('x'), man('y'), man('z')]);
  const a = put(st, 'a', 3, 6, 'n'); put(st, 'b', 4, 6); put(st, 'x', 3, 4, 's'); put(st, 'y', 3, 3, 's'); put(st, 'z', 4, 4, 's');
  const names = (k, x, y) => E.touched(st, a, E.ability(a, k), x, y).map(h => h.u.id + (h.mult < 1 ? '×' + h.mult.toFixed(2) : '')).join(' ');
  check('5a. a burst hits the tile and those beside it, foes only', names('burst', 3, 4) === 'x y z' && names('burst', 4, 5) === 'z');
  check('5b. a line runs down a row from the unit, each hit weaker; never off the row', names('line', 3, 5) === 'x y×0.60' && names('line', 4, 4) === '');
  check('5c. "around" touches every friend near the user, the user too', names('cheer', 3, 6) === 'a b');
  put(st, 'x', 3, 5, 's');
  let ev = E.use(st, 'shove', 3, 5);
  check('5d. a shove pushes the target one tile straight back', ev.some(e => e.type === 'push') && E.unit(st, 'x').y === 4);
  E.endTurn(st); E.endTurn(st); while (E.current(st).id !== 'a') E.endTurn(st);
  put(st, 'x', 3, 5, 's'); put(st, 'y', 3, 4, 's');
  ev = E.use(st, 'shove', 3, 5);
  check('5e. …but not into someone standing behind', !ev.some(e => e.type === 'push') && E.unit(st, 'x').y === 5);
  while (E.current(st).id !== 'a' || st.turn.acted) E.endTurn(st);
  ev = E.use(st, 'part', 3, 5);
  check('5f. a parting shot steps the shooter one tile back', ev.some(e => e.type === 'push' && e.step) && a.y === 7);
  while (E.current(st).id !== 'a' || st.turn.acted) E.endTurn(st);
  a.hp = 30;
  E.use(st, 'heal', a.x, a.y);
  check('5g. healing mends up to full health and no further; an ability with one use is then spent', a.hp === 39 && E.canUse(st, a, E.ability(a, 'heal')).why === 'spent');
}

console.log('6. A whole battle');
{
  const party = [man('a', { agility: 12 }), man('b', { agility: 11, abilities: [strike({ key: 'bow', min: 2, max: 4 })] }), man('c'), man('d')];
  const foes = [man('x', { maxHp: 30 }), man('y', { maxHp: 30 }), man('z', { maxHp: 30 })];
  const one = E.autoplay({ seed: 9, land: 'hills', party, enemies: foes }), two = E.autoplay({ seed: 9, land: 'hills', party, enemies: foes });
  check('6a. the mind plays a battle to its end', one.status === 'victory' || one.status === 'defeat', `${one.status} in ${one.round} rounds`);
  check('6b. the same seed and the same choices give the same battle', JSON.stringify(one.units.map(u => [u.id, u.hp, u.x, u.y])) === JSON.stringify(two.units.map(u => [u.id, u.hp, u.x, u.y])) && one.round === two.round);
  let stuck = 0, wins = 0;
  for (let s = 1; s <= 60; s++) { const r = E.autoplay({ seed: s, land: Object.keys(E.LANDS)[s % 7], party, enemies: foes }, 600); if (r.status === 'active') stuck++; if (r.status === 'victory') wins++; }
  check('6c. sixty battles on every kind of land all finish', stuck === 0, `${wins} won`);
  const st = E.createBattle({ seed: 3, land: 'plains', party: [man('a')], enemies: [man('x', { maxHp: 5 })] });
  put(st, 'a', 3, 6); put(st, 'x', 3, 5);
  const ev = E.use(st, 'strike', 3, 5);
  check('6d. the last foe down ends the battle at once', st.status === 'victory' && ev.some(e => e.type === 'down') && ev[ev.length - 1].type === 'end' && E.current(st) === null);
  check('6e. the engine uses no clock and no Math.random', !/Math\.random|Date\.now|performance/.test(read('js/tactics-engine.js').replace(/\/\/.*$/gm, '')));
}

console.log('7. The screen');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), HTML = read('index.html'), D = read('js/dungeons.js');
  check('7a. on the page: the rules before the screen, both after the dungeon screen', /css\/tactics\.css\?v=/.test(HTML) && HTML.indexOf('/js/tactics-engine.js') < HTML.indexOf('/js/tactics.js') && HTML.indexOf('/js/dungeons.js') < HTML.indexOf('/js/tactics-engine.js'));
  check('7b. a full-screen scene, on the window layer', /\.kwtc \{\s*position: fixed; inset: 0; z-index: var\(--z-window\);/.test(CSS));
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  check('7c. the stylesheet uses tokens only', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|z-index:\s*-?\d|!important/.test(bare));
  check('7d. its class names are its own (travel.css uses kwt-)', !/[.\s"'`]kwt-/.test(J.replace(/data-kwt/g, '')) && !/\.kwt-/.test(CSS));
  check('7e. with a mouse a click acts and hovering shows the outcome; on touch the first tap asks and a second confirms', /if \(same \|\| viaMouse\) return void doUse\(x, y\);/.test(J) && /if \(same \|\| viaMouse\) return void doMove\(x, y\);/.test(J) && /S\.pointer = ev\.pointerType === 'mouse' \? 'mouse' : 'touch';/.test(J));
  check('7f. the view turns a quarter at a time, and drawing, tapping and the arrow keys all follow it', /function view\(x, y\)/.test(J) && /function rotate\(by\) \{ S\.rot = \(S\.rot \+ by \+ 4\) & 3;/.test(J) && /turn\(arrow\[0\], arrow\[1\], true\)/.test(J) && /data-kwt="rot-l"/.test(J) && /data-kwt="rot-r"/.test(J));
  check('7g. a body that covers the ground behind it does not steal the tap', /if \(wf !== wb\) return wf \? face : body;/.test(J) && /return body\.upper \? body : face;/.test(J));
  check('7h. keys: arrows, Enter, Escape, 1–9 for abilities, E to end the turn, Q and R to turn the view', ["ev.key === 'Escape'", "ev.key === 'Enter'", '/^[1-9]$/.test(ev.key)', "ev.key === 'e'", "ev.key === 'q'", "ev.key === 'r'"].every(x => J.includes(x)));
  check('7i. what happens is also said in words for a screen reader', /class="kwtc-log kw-sr" role="status" aria-live="polite"/.test(J) && /\.kwtc-log \{ position: absolute; width: 1px; height: 1px;/.test(CSS));
  check('7j. reduced motion: no walking tweens, no bobbing, short waits', /const still = \(\) =>/.test(J) && /if \(still\(\) \|\| ms <= 0\) \{ Object\.assign\(v, to\); return resolve\(\); \}/.test(J));
  check('7k. started from Dev Tools: a box in the Dungeons tab, a class for each of the four, their level, the skull, the land and the fight', /<div id="kwt-dev-box"><\/div>/.test(D) && /KWTactics\.devMount\(doc\.getElementById\('kwt-dev-box'\)\)/.test(D)
    && /SLOTS = \['Front, left', 'Front, right', 'Back, left', 'Back, right'\]/.test(J) && ["sel('level'", "sel('tier'", "sel('terrain'", "sel('fight'"].every(x => J.includes(x)));
  check('7l. the two sides and the battle come from the server; a bare setup is no longer asked for', /apiFetch\('\/api\/tactics\/battles', \{ method: 'POST'/.test(J) && !/admin\/setup/.test(J));
  check('7m. on a phone the panel stacks and buttons are big enough to tap', /@media \(max-width: 640px\)[\s\S]*?\.kwtc-panel \{ grid-template-columns: minmax\(0, 1fr\);[\s\S]*?min-height: var\(--kw-touch\)/.test(CSS));
}

console.log('8. Facing, zoom, a phone on its side, art and sound');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), HTML = read('index.html');
  check('8a. ending a turn asks which way to face: from the End turn button, and by itself once the move and the action are both used',
    /else if \(k === 'end'\) askFacing\(\);/.test(J) && /st\.turn\.moved && st\.turn\.acted\) return askFacing\(\);/.test(J) && /const ev = E\(\)\.endTurn\(S\.state, face\);/.test(J));
  check('8b. the way shown first is towards the nearest foe; the citizen turns to show the way chosen', /aimFace\(e\.facingFor\(S\.state, u\)\);/.test(J) && /S\.view\[u\.id\]\.face = dir;/.test(J));
  check('8c. four arrows on the board and four buttons below, set out as they point; one tap ends the turn that way', /function drawFaceArrows/.test(J) && /data-kwt="face" data-dir="\$\{d\}"/.test(J) && /if \(S\.mode === 'face'\) \{ const d = faceAt\(q\.x, q\.y\); if \(d\) \{ sfx\('confirm'\); endTurn\(d\); \} return; \}/.test(J)
    && /\.kwtc-faces \{ display: grid; grid-template-areas: "tl tr" "bl br";/.test(CSS));
  check('8d. zoom: two fingers pinch, the wheel, + and − buttons and keys; the point under the fingers stays put', /function zoomAt\(z, sx, sy\)/.test(J) && /P\.pinch = \{ d: Math\.hypot/.test(J) && /addEventListener\('wheel'/.test(J) && /data-kwt="zoom-in"/.test(J) && /data-kwt="zoom-out"/.test(J) && /ev\.key === '\+'/.test(J));
  check('8e. one finger (or the mouse) drags the zoomed board, and a drag is never a tap', /if \(!P\.drag && Math\.hypot\(dx, dy\) > \(S\.pointer === 'mouse' \? 6 : 10\)\) P\.drag = true;/.test(J) && /const tapped = !P\.drag && ev\.type === 'pointerup';/.test(J));
  check('8f. zoomed all the way out the board is centred again', /if \(G\.zoom <= 1\.001\) \{ G\.px = 0; G\.py = 0; \}/.test(J));
  check('8g. a phone on its side: the board at full height, the panel a column beside it', /@media \(orientation: landscape\) and \(max-height: 520px\) \{\s*\.kwtc \{ grid-template-columns: minmax\(0, 1fr\) minmax\(240px, 38%\);[^}]*grid-template-areas: "top top" "board panel";/.test(CSS));
  const P = require(path.join(ROOT, 'scripts', 'pack_tactics.js'));
  const built = P.build(), onDisk = JSON.parse(read('assets/tactics/manifest.json'));
  check('8h. the list of art and sound is the packer\'s, and it is up to date', JSON.stringify(built) === JSON.stringify(onDisk) && Array.isArray(built.music) && typeof built.creatures === 'object' && typeof built.sounds === 'object');
  check('8i. a foe with art is drawn from its sheet, the frame for the way it faces; one without keeps its icon', /function creatureArt\(u, v, t\)/.test(J) && /dir = tv\[0\] > 0 \? 'se' : tv\[0\] < 0 \? 'nw' : tv\[1\] > 0 \? 'sw' : 'ne';/.test(J)
    && /const i = Math\.max\(0, \(a\.dirs \|\| \[\]\)\.indexOf\(dir\)\);/.test(J) && /c\.fillText\(u\.icon \|\| '👹'/.test(J));
  check('8j. sounds: its own file when there is one, an older sound until then, silence otherwise', /const own = ASSETS\.sounds\[name\] \|\| ASSETS\.sounds\[PLAINER\[name\]\], file = own \? 'tactics\/' \+ own : \(STAND_IN\[name\] \|\| STAND_IN\[PLAINER\[name\]\]\);/.test(J) && /if \(file\) global\.playSfx\(file\);/.test(J));
  check('8j2. a blade rings and a club thuds: the sword sound for blades, falling back to the plain blow when there is no such file', /const PLAINER = \{ sword: 'melee', down_friend: 'down_foe' \};/.test(J) && /slash: 'sword', thrust: 'sword', smash: 'melee'/.test(J) && /v_swing: 'smash', t_tool: 'smash'/.test(J));
  check('8k. music: its own tracks when there are any (a "boss" file for boss fights), else the card battles\'; it stops when the battle ends or is left', /const pick = tracksFor\(S\.setup \|\| \{\}, ASSETS\.tracks\.length \? ASSETS\.tracks :/.test(J) && /\? 'TACTICS' : 'BATTLE'\)/.test(J) && /music\(false\); sfx\(st\.status === 'victory'/.test(J) && /if \(S\.open\) music\(false\);/.test(J) && /global\.registerMusic\s+=/.test(read('js/audio.js')));
  // A phone that loaded the game before a sheet was re-packed kept the old picture (every row the front pose), so
  // every citizen was drawn facing the camera whatever way they looked. Sheets now carry a stamp of their contents.
  const VJ = JSON.parse(read('assets/sprites/villagers/villagers.json')), sha = f => require('crypto').createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 8);
  const stale = [];
  for (const [sp, v] of Object.entries(VJ.species)) for (const [an, a] of Object.entries(v.anims)) if (!a.v || a.v !== sha('assets/sprites/villagers/' + a.file)) stale.push(sp + ' ' + an);
  check('8m. every villager sheet carries a stamp of its contents, and the stamps are up to date', stale.length === 0, stale.join(', '));
  check('8n. the game asks for sheet?v=stamp, and the packers write the stamps', /BASE \+ a\.file \+ \(a\.v \? '\?v=' \+ a\.v : ''\)/.test(read('js/villagers.js')) && /meta\.anims\[anim\]\.v = /.test(read('scripts/pack_sprites.js')) && /const stamped = \(dir, f\) => f \+ '\?v=' \+/.test(read('scripts/pack_tactics.js')));
  check('8o. into a battle: something closes over the screen, the battle is named on it, it opens; nothing acts until it has lifted',
    /open\(setup, new Promise\(r => \{ lifted = r; \}\)\);/.test(J) && /animate\(T\.inMs, p => T\.cover\(C, p\)\)/.test(J) && /await animate\(T\.outMs, p => T\.reveal\(C, p\)\);/.test(J)
    && /Promise\.all\(\[hold \|\| Promise\.resolve\(\), loadAssets\(\)\]\)\.then\(\(\) => \{ if \(S\.open && S\.el === el && !S\.ended\) \{ music\(true\); nextTurn\(\); \} \}\);/.test(J));
  check('8p. five ways in, a different one each battle (never the one before, never "none") unless Dev Tools asks for one; with reduced motion the screen only goes dark',
    ['fade: {', 'page: {', 'tiles: {', 'leaves: {', 'iris: {', 'none: {'].every(x => J.includes(x)) && /const WAYS = Object\.keys\(ENTRANCES\)\.filter\(k => k !== 'none'\);/.test(J)
    && /const pool = WAYS\.filter\(k => k !== lastWay\);/.test(J) && /sel\('way', \[\{ key: 'any', label: 'A different one each time' \}\]/.test(J) && /way: 'any' \}/.test(J)
    && /const closing = quiet \? \(C\.el\.classList\.add\('is-solid'\), wait\(60\)\) : animate/.test(J) && !/drawSwirl/.test(J));
  check('8q. leaving fades the scene out; a second start while one is coming up is ignored', /S\.el\.classList\.add\('is-leaving'\);/.test(J) && /\.kwtc\.is-leaving \{ opacity: 0; \}/.test(CSS) && /if \(entering\) return null;/.test(J));
  check('8l. on a narrow phone Dev Tools is in the profile menu, for admins only', /id="pm-devtools" style="display:none" onclick="openCheatMenu\(\); closeProfileMenu\(\)"/.test(HTML) && /querySelectorAll\('\.btn-cheat, \.kw-admin-only'\)/.test(read('js/buildings.js')));
}

console.log('9. The server keeps the battle');
{
  const J = read('js/tactics.js');
  const party = [man('a', { agility: 12 }), man('b', { agility: 11, abilities: [strike({ key: 'bow', min: 2, max: 4 })] }), man('c'), man('d')];
  const foes = [man('x', { maxHp: 30 }), man('y', { maxHp: 30 }), man('z', { maxHp: 30 })];
  const setup = { seed: 21, land: 'hills', party, enemies: foes };
  // Play a battle, writing down only what the party chose; then play the list again.
  const st = E.replay(setup, []).state, log = [];
  for (let g = 0; g < 400 && st.status === 'active'; g++) {
    const u = E.current(st), keep = st.r, p = E.plan(st); st.r = keep;
    const acts = [];
    if (p && p.to && (p.to.x !== u.x || p.to.y !== u.y)) acts.push({ t: 'move', x: p.to.x, y: p.to.y });
    if (p && p.ability) acts.push({ t: 'use', key: p.ability, x: p.x, y: p.y });
    acts.push({ t: 'end', face: 'ensw'[g % 4] });
    for (const a of acts) if (st.status === 'active' && E.apply(st, a)) log.push(a);
  }
  const again = E.replay(setup, log);
  check('9a. a battle is its two sides and the player\'s choices: played again, it comes out the same', st.status !== 'active' && again.bad === -1 && E.checksum(again.state) === E.checksum(st) && log.length > 10, `${log.length} choices, ${st.status}`);
  check('9b. creatures need no entries: after "end" they act until a citizen\'s turn', log.every(a => ['move', 'use', 'undo', 'end'].includes(a.t)) && E.current(E.replay(setup, log.slice(0, 3)).state).side === 'player');
  check('9c. a choice the rules refuse stops the replay there', E.replay(setup, [{ t: 'move', x: 0, y: 0 }]).bad === 0 && E.replay(setup, log.slice(0, 2).concat([{ t: 'use', key: 'nothing', x: 1, y: 1 }])).bad === 2 && E.apply(E.replay(setup, []).state, { t: 'fly' }) === null);
  const one = E.replay(setup, log.slice(0, 5)).state, two = E.replay(setup, log.slice(0, 5)).state, moved = E.replay(setup, log.slice(0, 6)).state;
  check('9d. the fingerprint is the same for the same board and differs once anything has changed', E.checksum(one) === E.checksum(two) && E.checksum(one) !== E.checksum(moved));
  const res = E.resultOf(st);
  check('9e. the result says who won, the rounds and each citizen\'s health', res.status === st.status && res.rounds === st.round && res.party.length === 4 && res.party.every(x => x.hp >= 0 && x.maxHp > 0 && typeof x.down === 'boolean'));
  check('9f. the screen plays each choice at once and sends it in order; the server\'s answer is checked against its own board',
    /const n = b\.n\+\+, mark = action\.t === 'end' \? null : E\(\)\.checksum\(S\.state\);/.test(J) && /b\.queue = b\.queue\.then\(async \(\) =>/.test(J) && /if \(mark && d\.battle\.count === n \+ 1 && d\.battle\.check !== mark\) return resync\(b, d\.battle\);/.test(J));
  check('9g. every kind of choice is sent: a move, an ability, a move taken back, the end of a turn with its facing',
    ["send({ t: 'move', x, y });", "send({ t: 'use', key, x, y });", "send({ t: 'undo' });", "send(E().DIRS[face] ? { t: 'end', face } : { t: 'end' });"].every(x => J.includes(x)));
  check('9h. refused, or out of step, the screen is put back to the battle as the server has it', /if \(!res\.ok \|\| !d\.ok\) return resync\(b, d\.battle\);/.test(J) && /const r = E\(\)\.replay\(S\.setup, battle\.actions\);/.test(J) && /S\.epoch\+\+;/.test(J));
  check('9i. a battle left part-played is picked up where it was', /S\.state = done\.length \? e\.replay\(setup, done\)\.state :/.test(J) && /data-kwt-dev="resume"/.test(J) && /apiFetch\('\/api\/tactics\/battles\/current'\)/.test(J));
  check('9j. the end screen says whether the result reached the server; walking out of an unfinished battle ends it there', /'✓ The result is recorded\.'/.test(J) && /\/leave`, \{ method: 'POST' \}/.test(J));
  check('9k. "Let them fight": the mind plays the party to the end through the same choices, looking ahead without using up the battle\'s dice', /function autoFinish\(\)/.test(J) && /const keep = st\.r, p = e\.plan\(st\);\s*st\.r = keep;/.test(J) && /if \(e\.apply\(st, a\)\) send\(a\);/.test(J));
  const server = path.join(ROOT, '..', 'kindlewood-server', 'lib', 'tactics_engine.js');
  if (fs.existsSync(server)) check('9l. the server runs the same rules, byte for byte', fs.readFileSync(server, 'utf8') === read('js/tactics-engine.js'));
}

console.log('10. A steady screen, and things that fly');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css');
  check('10a. the panel is one fixed height, so the board above it never moves', /\.kwtc-panel \{ height: 196px; align-content: start; overflow-y: auto; \}/.test(CSS) && /\.kwtc-panel \{ height: 376px; \}/.test(CSS));
  check('10b. what an action would do, and its Confirm, float over the board; the hint below is one steady line with no buttons', /function paintAsk\(\)/.test(J) && /\.kwtc-ask \{ position: absolute;/.test(CSS)
    && !/hint\.innerHTML = [^;]*data-kwt="confirm"/.test(J));
  check('10c. moving the pointer redraws only that floating box, and only when it changes', /if \(\(t && t\.x\) !== \(was && was\.x\) \|\| \(t && t\.y\) !== \(was && was\.y\)\) paintAsk\(\);/.test(J) && /if \(box\._html === html\) return;/.test(J));
  check('10d. a canvas that is resized is drawn at once: never an empty frame', /if \(resized && S\.ctx\) draw\(now\(\)\);/.test(J));
  // Effects: every look has a painter, and every ability in a kit has a look that suits it.
  const look = src => [...src.matchAll(/(\w+): '(\w+)'/g)].map(m => m[2]);
  const LOOKS = look(J.slice(J.indexOf('const LOOK = {'), J.indexOf('const FLIES')));
  const LAND = look(J.slice(J.indexOf('const LANDS_AS'), J.indexOf('function lookOf')));
  const painters = [...J.slice(J.indexOf('const PAINT = {'), J.indexOf('function drawFx')).matchAll(/^    (\w+)\(c, f, p, k/gm)].map(m => m[1]);
  // A look that only lands (a blade, a club, teeth) has no painter of its own: it is drawn as what it lands as.
  const landsOnly = [...J.slice(J.indexOf('const LANDS_AS'), J.indexOf('const BLOOMS')).matchAll(/(\w+): '/g)].map(m => m[1]);
  const missing = [...new Set(LOOKS.concat(LAND, ['shield', 'heal', 'cheer', 'reticle', 'droop', 'bubbles', 'stars', 'dust', 'boom', 'ice', 'slash']))].filter(k => !painters.includes(k) && !landsOnly.includes(k));
  check('10e. every effect named has a painter', missing.length === 0 && painters.length >= 28, missing.join(', ') || `${painters.length} painters`);
  check('10f. an arrow for the Archer, fire and frost for the Wizard, a shield for a ward, a glow for healing', /a_shoot: 'arrow'/.test(J) && /w_bolt: 'fire'/.test(J) && /w_burst: 'fireburst'/.test(J) && /w_chill: 'frost'/.test(J) && /h_ward: 'shield'/.test(J) && /h_kindle: 'heal'/.test(J));
  check('10g. what flies is waited for, so the hit lands when it arrives; a burst blooms where it lands', /if \(FLIES\[look\] && !still\(\)\) await launch\(look,/.test(J) && /if \(BLOOMS\[look\]\) fx\(BLOOMS\[look\]\[0\], to, BLOOMS\[look\]\[1\]\);/.test(J) && /fireburst: \['boom', 460\]/.test(J));
  check('10h. an ability with no look of its own takes one from what it does', /return far \? \(u\.side === 'enemy' \? 'hex' : 'spark'\) : \(u\.side === 'enemy' \? 'bite' : 'slash'\);/.test(J));
  check('10i. with reduced motion no effect is drawn and nothing is waited for', /function fx\(kind, at, ms, more\) \{\s*if \(still\(\)\) return;/.test(J));
  check('10j. no stand-in sound for going in (the old one was the fishing reel)', !/tension\.wav/.test(J));
}

console.log('11. A dungeon on the board');
{
  const J = read('js/tactics.js'), D = read('js/dungeons.js');
  check('11a. a dungeon from Dev Tools is fought on the board: fights with cards are no longer on offer', !/kwdg-dev-combat/.test(D) && !/With cards/.test(D) && /Every fight is on the board\./.test(D) && !/combat: DEV\.pick/.test(D));
  check('11b. the dungeon\'s Fight opens the room\'s battle on the board, and nothing else', /global\.KWTactics\.openById\(p\.battle_id\)/.test(D) && !/startBattle\(/.test(D) && !/quest_run_id/.test(D));
  check('11c. the path screen has no class-cards button: there are no cards in a dungeon', !/data-action="cards"/.test(D) && !/Class cards<\/button>/.test(D));
  check('11d. ✕ only steps away from a dungeon\'s battle (it stays open) and the dungeon\'s screen comes back', /if \(!inDungeon && !inQuest && b && b\.id && S\.state && S\.state\.status === 'active'\)/.test(J) && /if \(inDungeon\) after\.then\(\(\) => \{ if \(global\.KWDungeon && global\.KWDungeon\.open\) global\.KWDungeon\.open\(\); \}\);/.test(J));
  check('11e. its end screen says what was found and whether the way on is open, and its one button goes back to the dungeon', /class="kwtc-found"/.test(J) && /'The way on is open\.'/.test(J) && /won \? 'Back to the dungeon' : 'See how it ended'/.test(J));
  check('11f. the server\'s answer to the last choice carries what became of the run', /if \(d\.dungeon\) b\.dungeon = d\.dungeon;/.test(J));
  check('11g. the practice box does not offer to pick up a dungeon\'s battle', /d\.battle\.source !== 'dungeon' \? d\.battle : null/.test(J));
}

console.log('12. The foes of the board, and art that can be dropped in');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), P = read('scripts/pack_tactics.js');
  check('12a. a foe\'s ability says how it looks, and the screen draws that', /const own = \(u\.abilities \|\| \[\]\)\.find\(x => x\.key === ev\.key\);\s*if \(own && own\.look\) return own\.look;/.test(J));
  const paints = (J.match(/const PAINT = \{([\s\S]*?)\n  \};/) || [])[1] || '';
  const looks = ['slash', 'claw', 'stone', 'dart', 'vial', 'sand', 'heal', 'shield', 'smash', 'cheer', 'wail', 'arrow', 'spark', 'gale', 'quake', 'thunder', 'hex', 'boulder', 'spores', 'thrust', 'curse'];
  const flies = (J.match(/const FLIES = \{([\s\S]*?)\};/) || [])[1] || '', lands = (J.match(/const LANDS_AS = \{([\s\S]*?)\};/) || [])[1] || '', rings = (J.match(/const RINGS = \{([\s\S]*?)\};/) || [])[1] || '';
  const drawn = k => new RegExp(`\\b${k}\\(c, f, p, k`).test(paints) || new RegExp(`\\b${k}:`).test(lands) || new RegExp(`\\b${k}:`).test(rings);
  check('12b. every look a foe can have (lib/tactics_foes.js on the server) is drawn: in flight, on landing, or as a ring', looks.every(drawn), looks.filter(k => !drawn(k)).join(' ') || `${looks.length} looks`);
  check('12c. what flies has a painter, and so has what it lands as', (flies.match(/[a-z_]+(?=:)/g) || []).every(k => new RegExp(`\\b${k}\\(c, f, p, k`).test(paints))
    && [...new Set((lands.match(/'[a-z_]+'/g) || []).map(x => x.slice(1, -1)))].every(k => new RegExp(`\\b${k}\\(c, f, p, k`).test(paints)));
  check('12d. the sound follows the look: a stone or a dart sounds as an arrow, a spell as magic, a blade as a blade', /const SOUND_OF = \{ arrow: 'arrow', stone: 'arrow', dart: 'arrow',/.test(J) && /return SOUND_OF\[look\] \|\| \(u\.side === 'enemy' \? 'bite' : 'melee'\);/.test(J));
  check('12e. an ability shows its own picture when assets/tactics/icons has one (a foe\'s: the one for its look), else its emoji', /const file = ASSETS\.icons && \(ASSETS\.icons\[a\.key\] \|\| \(a\.look && ASSETS\.icons\['look_' \+ a\.look\]\)\);/.test(J) && /<span class="kwtc-act-i" aria-hidden="true">\$\{ico\(x\)\}<\/span>/.test(J)
    && /\.kwtc-ic \{ width: 1\.35em; height: 1\.35em;/.test(CSS) && /list\('assets\/tactics\/icons', \/\^\[a-z0-9_\]\+\\\.png\$\/\)/.test(P));
  check('12f. Dev Tools can ask for one band\'s showcase fight', /sel\('band', o\.bands \|\|/.test(J) && /band: p\.band \|\| undefined/.test(J));
  let manifest = null; try { manifest = JSON.parse(read('assets/tactics/manifest.json')); } catch (e) { /* none */ }
  check('12g. the manifest lists ability icons beside creatures, sounds and music', !!manifest && typeof manifest.icons === 'object' && typeof manifest.creatures === 'object');
}

console.log('13. The fallen');
{
  const mend = (x = {}) => ({ key: 'mend', name: 'Mend', kind: 'heal', target: 'ally', min: 1, max: 3, shape: 'single', heal: 12, fx: {}, cooldown: 0, ...x });
  const healer = (id, x = {}) => man(id, { abilities: [strike(), mend()], ...x });
  // A citizen struck down lies where they fell.
  let st = battle([healer('a', { agility: 12 }), man('b', { agility: 11, maxHp: 8 })], [man('x', { agility: 9, abilities: [strike({ dmg: 20 })] }), man('y', { agility: 3 })]);
  put(st, 'a', 1, 4); put(st, 'b', 3, 4, 'e'); put(st, 'x', 4, 4, 'w'); put(st, 'y', 7, 0);
  E.endTurn(st, 'e'); E.endTurn(st, 'e');                       // a and b wait; x strikes b down
  E.aiTurn(st);
  const b = E.unit(st, 'b');
  check('13a. a citizen struck down lies where they fell: no turn, out of the order from the next round', b.down && b.fell && b.hp === 0 && !!E.bodyAt(st, 3, 4) && !E.unitAt(st, 3, 4) && st.status === 'active');
  const x = E.unit(st, 'x');
  check('13b. no foe can strike the fallen', !E.targetTiles(st, x, x.abilities[0], x).some(t => t.x === 3 && t.y === 4));
  while (E.current(st) && E.current(st).id !== 'a') E.aiTurn(st);
  const a = E.unit(st, 'a'), R = E.reach(st, a), over = R.get('3,4');
  check('13c. anyone may step over them, and nobody may stop there', !E.computeOrder(st).includes('b') && (!over || over.stop === false) && E.move(st, 3, 4) === null);
  put(st, 'a', 2, 4, 'e'); put(st, 'x', 6, 6); put(st, 'y', 7, 7);
  const fc = E.forecast(st, a, a.abilities[1], 3, 4);
  check('13d. a heal can be aimed at them, and says it will stand them up', E.targetTiles(st, a, a.abilities[1], a).some(t => t.x === 3 && t.y === 4) && fc.length === 1 && fc[0].raise === true && fc[0].heal === 8);
  b.st.poison = 3;
  const ev = E.use(st, 'mend', 3, 4);
  check('13e. healing stands them back up with what was healed; what ailed them is gone', ev.some(e => e.type === 'raise' && e.id === 'b') && !b.down && b.hp === 8 && !b.st.poison && !E.bodyAt(st, 3, 4) && E.unitAt(st, 3, 4) === b);
  E.endTurn(st, 'e');
  let acted = false;
  for (let g = 0; g < 12 && st.status === 'active' && !acted; g++) { if (E.current(st).id === 'b') acted = true; else E.aiTurn(st); }
  check('13f. and they take their turn again when it comes', acted && E.resultOf(st).party.find(p => p.id === 'b').fell === true, 'the record still says they went down');
  // A creature that goes down is gone: nothing to step round, nothing to raise.
  st = battle([man('a', { agility: 12, abilities: [strike({ dmg: 99 })] })], [healer('x', { agility: 9 }), man('y', { agility: 8, maxHp: 5 })]);
  put(st, 'a', 3, 4, 'e'); put(st, 'y', 4, 4, 'w'); put(st, 'x', 5, 4, 'w');
  E.use(st, 'strike', 4, 4);
  const xx = E.unit(st, 'x');
  check('13g. a creature that goes down is gone: no body, and its friends cannot raise it', E.unit(st, 'y').down && !E.bodyAt(st, 4, 4) && !E.targetTiles(st, xx, xx.abilities[1], xx).some(t => t.x === 4 && t.y === 4));
  // Carried in already down.
  st = battle([man('a'), man('b', { down: true }), healer('c')], [man('x')]);
  const lying = E.unit(st, 'b');
  check('13h. a citizen carried in down lies at their place, and the battle is lost only when nobody is standing', lying.down && lying.hp === 0 && !st.order.includes('b') && st.status === 'active' && E.living(st, 'player').length === 2);
  // The mind uses a heal to raise a friend.
  let raised = 0, tried = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s2 = E.createBattle({ seed, land: 'plains', party: [healer('a', { maxHp: 60 }), man('b', { down: true }), man('c', { maxHp: 60 })], enemies: [man('x', { maxHp: 40 }), man('y', { maxHp: 40 })] });
    for (let g = 0; g < 400 && s2.status === 'active'; g++) E.aiTurn(s2);
    tried++; if (!E.unit(s2, 'b').down) raised++;
  }
  check('13i. left to itself, a party with a healer usually stands its fallen friend back up', raised >= 20, `${raised} of ${tried}`);
  const J = read('js/tactics.js');
  check('13j. on the screen a fallen citizen lies greyed in a broken ring, marked Down, and does not block a tap', /function drawFallen\(c, v, t\)/.test(J) && /if \(v\.lying\) return drawFallen\(c, v, t\);/.test(J) && /c\.rotate\(Math\.PI \/ 2\);/.test(J)
    && /filter\(v => !v\.gone && !v\.lying\)\.sort/.test(J) && /lying: u\.down && u\.side === 'player'/.test(J));
  check('13k. going down, a citizen stays on the board; a creature fades away', /if \(foe\) \{ await tween\(v, \{ alpha: 0 \}, 380\); v\.gone = true; \}\s*else \{ v\.hp = 0; v\.block = 0; v\.st = \{\}; v\.lying = true;/.test(J));
  check('13l. being raised is shown and said, and the forecast says "stands back up"', /ev\.type === 'raise'\) \{ v\.lying = false;/.test(J) && /'Back up!'/.test(J) && /l\.raise \? `<b>stands back up with \$\{l\.heal\}<\/b>`/.test(J));
  check('13m. after a dungeon fight that is won, the end screen says who is down and how they get up', /class="kwtc-fallen"/.test(J) && /A rest stands them up; so does healing them in the next fight\./.test(J));
  check('13n. both copies of the rules are the same file', !fs.existsSync(path.join(ROOT, '..', 'kindlewood-server', 'lib', 'tactics_engine.js')) || read('js/tactics-engine.js') === fs.readFileSync(path.join(ROOT, '..', 'kindlewood-server', 'lib', 'tactics_engine.js'), 'utf8'));
}

console.log('14. After the battle: the word, the party, experience and injuries');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), L = read('js/life.js');
  check('14a. a big word comes first, over the board as it ended: Victory or Defeat, with the party\'s box held back', /class="kwtc-splash is-\$\{won \? 'won' : 'lost'\}" aria-hidden="true"><span>\$\{won \? 'Victory' : 'Defeat'\}<\/span>/.test(J)
    && /box\.classList\.toggle\('is-splash', !quiet\);/.test(J) && /\.kwtc-end\.is-splash \.kwtc-end-box \{ opacity: 0;[^}]*pointer-events: none; \}/.test(CSS) && /@keyframes kwtc-splash \{/.test(CSS) && /const SPLASH_MS = 1900;/.test(J));
  check('14b. then the party, one to a row: a face from the villager sheet, the name, the class', /function heroRows\(st, won\)/.test(J) && /<ul class="kwtc-roster">\$\{heroRows\(st, won\)\}<\/ul>/.test(J) && /class="kwtc-hero-face"/.test(J)
    && /KV\.spriteFor\(KV\.meta, \(S\.setup && S\.setup\.species\) \|\| 'Mice', 'idle', 'sw'\)/.test(J) && /\.kwtc-hero-face\.has-art canvas \{ display: block; \}/.test(CSS));
  check('14c. won: each bar grows from where the citizen was to where they are while the number beside it counts down', /function growXp\(li, r, delay\)/.test(J) && /show\(from \+ \(to - from\) \* e\); gain\.textContent = '\+' \+ Math\.max\(0, Math\.round\(total \* \(1 - e\)\)\);/.test(J)
    && /fill\.style\.width = pct\.toFixed\(1\) \+ '%';/.test(J) && /const ms = Math\.max\(900, Math\.min\(2400, 700 \+ total \* 4\)\);/.test(J));
  check('14d. the bar follows the careers\' own levels, and a level gained is said once for each', /const lvlOf = xp => \{ const KM = global\.KWCareerMath; return KM && KM\.levelProgress \? KM\.levelProgress\(xp\) : null; \};/.test(J)
    && /if \(p\.level > level\) \{/.test(J) && /<span class="kwtc-up">Level up!<\/span>/.test(J) && /@keyframes kwtc-up \{/.test(CSS));
  check('14e. the numbers are the server\'s: nothing grows until its answer has come, and each part plays once', /if \(won && !A\.xp && b\.rewards\) \{\s*A\.xp = true;/.test(J) && /if \(d\.rewards \|\| kept\.rewards\) b\.rewards = d\.rewards \|\| kept\.rewards;/.test(J)
    && /if \(!A \|\| !A\.ready \|\| !root \|\| !b\) return;/.test(J) && /    aftermath\(\);\n  \}/.test(J));
  check('14f. a practice field says the experience is not kept', /b\.rewards\.kept \? '' : 'A practice field: this is what the battle would have taught\. Nothing is kept\.'/.test(J));
  check('14g. lost, or a run ended with someone fallen: each injury roll in turn, the words spinning and slowing before they stop', /async function rollInjury\(li, r\)/.test(J) && /await wait\(60 \+ i \* 9\);/.test(J)
    && /for \(const r of b\.rolls\) \{ const li = rowOf\(r\.citizen_id\); if \(li && S\.open\) await rollInjury\(li, r\); \}/.test(J) && /keys = Object\.keys\(SEVERITY\)\.filter\(k => !\(r\.no_fatal && k === 'fatal'\)\)/.test(J));
  check('14h. what it stops on is named and coloured by how bad it is, with its line', /const SEVERITY = \{ none: \['Unhurt', 'good'\], scratch: \['A scratch', 'warn'\], wound: \['A wound', 'warn'\], scar: \['A scar', 'bad'\], crippling: \['Crippled', 'bad'\], fatal: \['Died of their wounds', 'bad'\] \};/.test(J)
    && /\.kwtc-roll\.is-good \.kwtc-roll-word \{ color: var\(--kw-good\); \}/.test(CSS) && /\.kwtc-roll\.is-bad \.kwtc-roll-word \{ color: var\(--kw-bad\); \}/.test(CSS));
  check('14i. with reduced motion there is no splash, the bars are simply full, and the rolls are simply shown', /const quiet = still\(\), epoch = S\.epoch;/.test(J) && /if \(still\(\) \|\| total <= 0\) return settle\(\);/.test(J) && /if \(!still\(\)\) \{\s*for \(let i = 0, spins/.test(J)
    && /\.kwtc-splash span, \.kwtc-up, \.kwtc-learned, \.kwtc-hero\.is-up \{ animation: none; \}/.test(CSS));
  check('14j. once the battle is over the panel of abilities goes, so the box has the whole height (a phone)', /S\.el\.classList\.add\('is-over'\);/.test(J) && /\.kwtc\.is-over \.kwtc-panel, \.kwtc\.is-over \.kwtc-turnview, \.kwtc\.is-over \.kwtc-ask \{ display: none; \}/.test(CSS));
  check('14k. a memorial waits for the battle to close: it must not cover the end, or tell of a death before its roll is shown', /function whenClosed\(fn\) \{ if \(S\.open \|\| S\.el\) LATER\.push\(fn\); else fn\(\); \}/.test(J)
    && /if \(!quiet\) for \(const fn of LATER\.splice\(0\)\)/.test(J) && /T\.whenClosed\(\(\) => openMemorial\(ids\[0\]\)\)/.test(L));
  const man = JSON.parse(read('assets/tactics/manifest.json'));
  const need = ['start', 'select', 'confirm', 'cancel', 'step', 'melee', 'sword', 'arrow', 'magic', 'bite', 'block', 'heal', 'buff', 'push', 'down_foe', 'victory', 'defeat'];
  check('14l. the sounds the owner added are listed for the game, under the names it plays', need.every(k => man.sounds[k]) && !man.sounds.shove, need.filter(k => !man.sounds[k]).join(' ') || `${Object.keys(man.sounds).length} sounds`);
}

console.log('15. The class ladder on the screen, and a check on what is live');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), D = read('js/dungeons.js');
  check('15a. the next ability the class will teach sits at the end of the citizen\'s own row, greyed, saying the level that brings it', /\(u\.next && !tab\.off \? \[u\.next\] : \[\]\)\.map\(x => `<div class="kwtc-act is-locked"/.test(J) && /learned at level \$\{x\.at\}/.test(J)
    && /\.kwtc-act\.is-locked \{ opacity: \.45; cursor: default; border-style: dashed; \}/.test(CSS));
  check('15b. it is no button: it cannot be chosen, and the number keys count the abilities of the open school', !/class="kwtc-act is-locked"[^>]*data-kwt/.test(J) && /const a = tabOf\(u\)\.list\[Number\(ev\.key\) - 1\];/.test(J));
  check('15c. tapping anyone shows what they brought, school by school, and greyed the next they will learn', /tabsOf\(look\)\.map\(t =>/.test(J) && /\(look\.next \? `<span class="kwtc-kit-a is-locked">🔒 <b>\$\{esc\(look\.next\.name\)\}<\/b> <i>at level \$\{look\.next\.at\}<\/i><\/span>` : ''\)/.test(J));
  check('15d. on the victory screen a level gained says what it taught, once the bar has reached that level', /for \(const x of \(r\.learned \|\| \[\]\)\.filter\(x => x\.at <= level && !li\.querySelector\(`\.kwtc-learned\[data-key="\$\{x\.key\}"\]`\)\)\)/.test(J)
    && /<span class="kwtc-learned" data-key="\$\{esc\(x\.key\)\}">Learned: /.test(J));
  check('15e. fights with cards are not on offer for a dungeon any more', !/With cards/.test(D) && !/kwdg-dev-combat/.test(D));
  const C = require(path.join(ROOT, 'scripts', 'check_live.js')), want = C.wanted();
  check('15f. the check on the live site covers the page, every script and stylesheet it names, and the battle\'s lists and sounds', want.includes('index.html') && want.includes('css/tactics.css') && want.includes('js/tactics-engine.js') && want.includes('js/tactics.js')
    && want.includes('assets/tactics/manifest.json') && want.some(f => /^assets\/audio\/tactics\/[a-z_]+\.(mp3|wav|ogg)$/.test(f)) && want.length > 150, `${want.length} files`);
  check('15g. it tells a stale file from one whose line endings an upload changed', C.fingerprint('a.css', Buffer.from('a{}\r\nb{}\r\n')) === C.fingerprint('a.css', Buffer.from('a{}\nb{}\n')) && C.fingerprint('a.css', Buffer.from('a{}\n')) !== C.fingerprint('a.css', Buffer.from('b{}\n'))
    && C.fingerprint('a.mp3', Buffer.from('a\r\n')) !== C.fingerprint('a.mp3', Buffer.from('a\n')));
  const CL = read('scripts/check_live.js');
  check('15h. asked to, it packs every file the site lacks into one zip to extract at the site\'s root, so none is left behind', /const ZIP = ARGS\.includes\('--zip'\)/.test(CL) && /const todo = stale\.concat\(missing\)\.map\(x => x\.f\)\.sort\(\);/.test(CL) && /z\.write\(sys\.argv\[2\] \+ "\/" \+ f, f\)/.test(CL));
}

console.log('16. Icons, pips, music by place, and the jukebox page');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), man = JSON.parse(read('assets/tactics/manifest.json'));
  const KITS = ['g_strike', 'g_shield', 'g_cover', 'g_shove', 'g_heavy', 'a_shoot', 'a_side', 'a_part', 'a_pierce', 'a_mark', 'w_spark', 'w_ward', 'w_bolt', 'w_burst', 'w_chill', 'h_cinder', 'h_ward', 'h_kindle', 'h_steady', 'h_bold'];
  const png = f => { const b = fs.readFileSync(path.join(ROOT, f)); return b.toString('ascii', 1, 4) === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 } : null; };
  check('16a. each of the four classes\' twenty abilities has its picture, listed for the game', KITS.every(k => man.icons[k] && fs.existsSync(path.join(ROOT, 'assets/tactics/icons', k + '.png'))), KITS.filter(k => !man.icons[k]).join(' ') || '20 icons');
  check('16b. each is a square PNG with a see-through background', KITS.every(k => { const p = png('assets/tactics/icons/' + k + '.png'); return p && p.w === p.h && p.w >= 48 && p.alpha; }));
  const ST = ['weak', 'vulnerable', 'slow', 'poison', 'stun', 'bold'];
  check('16c. the six statuses have their pips, and the board draws a pip with how much of it (its glyph until the picture is there)', ST.every(k => man.status[k] && png('assets/tactics/status/' + k + '.png'))
    && /const img = ASSETS\.status\[s\] \? sheet\('\/assets\/tactics\/status\/' \+ ASSETS\.status\[s\]\) : null/.test(J) && /text: img \? n : STATUS\[s\]\[1\] \+ n/.test(J));
  const P = require(path.join(ROOT, 'scripts', 'pack_tactics.js')), tracks = man.tracks || [];
  check('16d. every piece of music is named for its place and has a title read from its file\'s name', tracks.length === man.music.length && tracks.length >= 13 && tracks.every(t => P.PLACES.includes(t.place) && t.title && /^[A-Z]/.test(t.title) && t.key && man.music.includes(t.file)),
    tracks.filter(t => !P.PLACES.includes(t.place)).map(t => t.key).join(' ') || `${tracks.length} pieces`);
  check('16e. no piece is larger than about three megabytes', tracks.every(t => fs.statSync(path.join(ROOT, 'assets/audio/tactics/music', t.file.replace(/\?.*$/, ''))).size < 3.2e6));
  // The rule itself, lifted out of the screen's code and run.
  const src = J.slice(J.indexOf('  const BORROWS = {'), J.indexOf('  function music(on) {'));
  const tracksFor = new Function(src + '; return tracksFor;')();
  const places = l => [...new Set(tracksFor(l, tracks).map(t => t.place))].join();
  check('16f. a battle plays its own land\'s music; a land with none borrows a neighbour\'s (hills the mountains\', ruins the marsh\'s)', places({ land: 'forest' }) === 'forest' && places({ land: 'mountain' }) === 'mountain' && places({ land: 'hills' }) === 'mountain' && places({ land: 'ruins' }) === 'marsh' && places({ land: 'plains' }) === 'plains');
  check('16g. a boss has the boss\'s music, and a boss of the Withered theirs', places({ land: 'plains', fight: 'boss' }) === 'boss' && places({ land: 'ruins', fight: 'boss', band: 'withered' }) === 'boss-withered'
    && places({ land: 'marsh', fight: 'boss', enemies: [{ band: 'withered' }, { band: 'withered' }, { band: 'mire' }] }) === 'boss-withered' && places({ land: 'forest', fight: 'fight' }) === 'forest');
  check('16h. the battle screen can play itself inside another page: both sides by the mind, no panel, no end screen, silent', /if \(u\.side === 'player' && !S\.demo\)/.test(J) && /demo: \(setup, mount, o\) => open\(setup, null, \{ mount, demo: true/.test(J)
    && /if \(S\.demo\) \{      \/\/ no end screen/.test(J) && /if \(S\.demo \|\| S\.busy \|\| !u \|\| st\.status !== 'active'\) return;/.test(J) && /\.kwtc\.is-demo \.kwtc-top, \.kwtc\.is-demo \.kwtc-panel/.test(CSS) && /if \(S\.demo\) return;      \/\/ a battle shown for its own sake/.test(J));
  const H = read('jukebox.html'), JB = read('js/jukebox.js'), JC = read('css/jukebox.css'), demo = JSON.parse(read('assets/tactics/demo.json'));
  check('16i. the jukebox is a page of its own with nothing to sign in to, and asks search engines to leave it be', /<title>Kindlewood: the battle jukebox<\/title>/.test(H) && !/type="password"/.test(H) && /<meta name="robots" content="noindex">/.test(H)
    && ['/js/tactics-engine.js', '/js/tactics.js', '/js/villagers.js', '/js/jukebox.js', '/css/tactics.css', '/css/jukebox.css', '/css/tokens.css'].every(f => H.includes(f + '?v=h')));
  check('16j. its stylesheet uses tokens only', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|z-index:\s*-?\d|!important/.test(JC.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('16k. every place a piece can belong to has a battle to show: a land, a band, and that band\'s foes', P.PLACES.every(p => demo.places[p] && demo.bands[demo.places[p].band] && demo.bands[demo.places[p].band][demo.places[p].fight || 'hard'].length >= 3)
    && demo.party.length === 4 && demo.party.every(u => u.abilities.length === 5) && Object.keys(E.LANDS).includes(demo.places.mountain.land));
  {
    // Each of them plays through to an end by the rules, on its own land.
    let done = 0, n = 0;
    for (const p of P.PLACES) { n++; const pl = demo.places[p]; const st = E.autoplay({ seed: 40 + n, land: pl.land, party: JSON.parse(JSON.stringify(demo.party)), enemies: JSON.parse(JSON.stringify(demo.bands[pl.band][pl.fight || 'hard'])) }, 900); if (st.status !== 'active') done++; }
    check('16l. and each of those battles plays through to an end', done === n, `${done} of ${n}`);
  }
  check('16m. what a listener types is shown back as text, never as markup', /const esc = s => String\(s == null \? '' : s\)\.replace\(\/\[&<>"'\]\/g/.test(JB) && /<td>\$\{esc\(x\.comment \|\| ''\)\}<\/td>/.test(JB) && /<td>\$\{esc\(x\.name \|\| '—'\)\}<\/td>/.test(JB) && !/innerHTML = [^`'"]*(comment|name)\b/.test(JB)
    && /\$\('jb-comment'\)\.value = mine \? mine\.comment \|\| '' : '';/.test(JB));
  check('16n. a listener is a random id this browser keeps; nothing else is asked of them', /getRandomValues\(bytes\)/.test(JB) && /localStorage\.setItem\('kw_jukebox_id', id\)/.test(JB) && /visitor: J\.visitor, track: t\.key, stars: J\.stars/.test(JB));
  check('16o. the comments table is asked for only with the game\'s own sign-in, and shown only if the server allows it', /Authorization: 'Bearer ' \+ token/.test(JB) && /if \(!r\.ok\) return;/.test(JB) && /<section class="jb-admin" id="jb-admin" hidden/.test(H));
  const SV = require(path.join(ROOT, 'scripts', 'stamp_versions.js')), C2 = require(path.join(ROOT, 'scripts', 'check_live.js')).wanted();
  check('16p. the jukebox\'s scripts and stylesheets are stamped like the game\'s, and none is stale', SV.PAGES.includes('jukebox.html') && SV.stamps(H).length >= 9 && SV.stamps(H).every(x => x.want && x.current === x.want));
  check('16q. the check on the live site covers the jukebox, the icons, the pips and the music', ['jukebox.html', 'js/jukebox.js', 'css/jukebox.css', 'assets/tactics/demo.json', 'assets/tactics/icons/g_strike.png', 'assets/tactics/status/weak.png'].every(f => C2.includes(f))
    && tracks.every(t => C2.includes('assets/audio/tactics/music/' + t.file.replace(/\?.*$/, ''))));
}

console.log('17. Foes with art');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), man = JSON.parse(read('assets/tactics/manifest.json'));
  const foes = JSON.parse(read('assets/sprites/creatures/foes.json')), sizes = JSON.parse(read('art/tactics/foes/sizes.json'));
  const png = f => { const b = fs.readFileSync(path.join(ROOT, f)); return b.toString('ascii', 1, 4) === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null; };
  const keys = Object.keys(foes);
  check('17a. the seven Brigands the owner drew are packed, the Stoat Captain and Redtooth among them: a sheet and a face each', ['rat_cutpurse', 'weasel_slinger', 'fox_footpad', 'polecat_sawbones', 'boar_bruiser', 'stoat_captain', 'redtooth'].every(k => foes[k] && man.creatures[k] && man.creatures[k].file && man.creatures[k].face), keys.join(' '));
  check('17b. a sheet is one row of four frames, one for each way a unit can face on the board, so nothing is mirrored', keys.every(k => { const p = png('assets/sprites/creatures/' + foes[k].file); return p && foes[k].dirs.join() === 'se,sw,ne,nw' && p.w === foes[k].w * 4 && p.h === foes[k].h; }));
  check('17c. each foe stands at the height set for it against a citizen: a rat smaller than a mouse, a boar a third taller', keys.every(k => Math.abs(foes[k].scale * foes[k].tall / 59 - (sizes[k] || 1)) < 0.02)
    && foes.rat_cutpurse.scale * foes.rat_cutpurse.tall < 59 && foes.boar_bruiser.scale * foes.boar_bruiser.tall > 59 * 1.25, keys.map(k => `${k} ${(foes[k].scale * foes[k].tall / 59).toFixed(2)}`).join(', '));
  check('17d. its feet are on its tile: the foot point is inside the frame, near its bottom', keys.every(k => foes[k].foot.x > foes[k].w * 0.25 && foes[k].foot.x < foes[k].w * 0.75 && foes[k].foot.y > foes[k].h * 0.85 && foes[k].foot.y <= foes[k].h));
  check('17e. the screen draws it at that size from that foot, with its health bar over its head', /const z = 0\.62 \* k \* art\.scale, hop = !art\.moving && v\.walking && !still\(\) \? Math\.abs\(Math\.sin\(t \/ 85\)\) \* 3\.5 \* k : 0;/.test(J)
    && /p\.x - art\.foot\.x \* z, p\.y \+ 3 \* k - hop - art\.foot\.y \* z \* breath, art\.w \* z, art\.h \* z \* breath\);/.test(J) && /Math\.max\(30 \* k, \(v\.tall \|\| 34 \* k\) \+ 2 \* k\)/.test(J) && /v\.tall = art\.tall \* z;/.test(J));
  check('17f. a foe with a face shows it in the row of who acts next', /const face = u\.side === 'enemy' \? faceOf\(u\) : null;/.test(J) && /\.kwtc-chip\.has-face img \{[^}]*object-fit: cover;/.test(CSS) && keys.every(k => { const p = png('assets/sprites/creatures/' + foes[k].face); return p && p.w === 64 && p.h === 64; }));
  check('17g. the source exports are kept, each with its eight rotations', keys.every(k => ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'].every(d => fs.existsSync(path.join(ROOT, 'art/tactics/foes', k, 'rotations', d + '.png')))));
  const C3 = require(path.join(ROOT, 'scripts', 'check_live.js')).wanted();
  check('17h. the check on the live site covers every foe\'s sheet and face', keys.every(k => C3.includes('assets/sprites/creatures/' + foes[k].file) && C3.includes('assets/sprites/creatures/' + foes[k].face)));
  check('17i. a boss stands as a boss: Redtooth is nearly twice a citizen\'s height, the Captain a quarter taller', foes.redtooth.scale * foes.redtooth.tall > 59 * 1.8 && Math.abs(foes.stoat_captain.scale * foes.stoat_captain.tall / 59 - 1.25) < 0.02);
  const PF = read('scripts/pack_foes.py');
  const walkers = keys.filter(k => foes[k].walk);
  check('17k. each foe that came with a walk has it packed: a sheet with a row of eight frames for each way it goes, feet on the same line', walkers.length === 7 && walkers.every(k => { const wk = foes[k].walk, p = png('assets/sprites/creatures/' + wk.file);
    return p && wk.frames === 8 && p.w === wk.w * wk.frames && p.h === wk.h * wk.foot.length && ['se', 'sw', 'ne', 'nw'].every(d => wk.rows[d] < wk.foot.length) && wk.foot.every(f => f.y === wk.h - 2 && f.x > wk.w * 0.25 && f.x < wk.w * 0.75) && man.creatures[k].walk && man.creatures[k].walk.frames === 8; }));
  check('17l. the first exports walk only to the sides, so the walk east serves both ways right and the walk west both ways left; diagonal walks are used as soon as they are exported', walkers.every(k => foes[k].walk.diagonal === false && foes[k].walk.rows.se === foes[k].walk.rows.ne && foes[k].walk.rows.sw === foes[k].walk.rows.nw && foes[k].walk.rows.se !== foes[k].walk.rows.sw)
    && /src = next\(\(c for c in \(long, side\) if frames_of\(folder, anim, c\)\), None\)/.test(PF) && /for anim, name in \(\('walking', 'walk'\), \('idle', 'idle'\)\):/.test(PF));
  check('17m. moving, a foe is drawn in its walk\'s frames; standing, in its idle\'s if it has one', /const m = still\(\) \? null : v\.walking \? a\.walk : a\.idle;/.test(J) && /n = Math\.floor\(\(t \|\| 0\) \/ \(v\.walking \? WALK_MS : IDLE_MS\) \+ \(v\.seed \|\| 0\) \* m\.frames\) % m\.frames;/.test(J)
    && /sx: n \* m\.w, sy: row \* m\.h/.test(J));
  check('17n. with no idle frames it breathes by itself, from the feet up; nothing moves for someone who asked for less motion', /const breath = art\.moving \|\| v\.walking \|\| still\(\) \? 1 : 1 \+ Math\.sin\(t \/ 560 \+ v\.seed \* 6\.3\) \* 0\.014;/.test(J));
  check('17o. the check on the live site covers the walk sheets', walkers.every(k => C3.includes('assets/sprites/creatures/' + foes[k].walk.file)));
  check('17j. a face is one piece: the tip of a blade or a tail that pokes into its square is taken out', /def lone\(im\):/.test(PF) && /face = lone\(s\.crop\(/.test(PF));
}

console.log('18. Knowing and readying: the higher rungs, and the Abilities tab on a citizen');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), A = read('js/abilities.js'), ACSS = read('css/abilities.css'), H = read('index.html'), CZ = read('js/citizens.js');
  const w = { console, Math, JSON, Number, String, Array, Object, document: { getElementById() { return null; }, querySelector() { return null; } } }; w.window = w; w.globalThis = w;
  w._kwIsAdmin = () => true;
  // The battle screen's words, as the page borrows them.
  w.KWTactics = { icon: a => '[' + a.key + ']', effectText: a => (a.dmg ? a.dmg + ' damage' : a.block ? a.block + ' block' : ''), reachText: a => 'reach ' + a.max };
  vm.createContext(w); vm.runInContext(A, w);
  const K = w.KWAbilities;
  const ab = (key, name, at, x = {}) => ({ key, name, at, icon: '•', kind: 'attack', desc: name + ' does a thing.', dmg: 10, block: 0, heal: 0, fx: {}, min: 1, max: 1, cooldown: 0, quick: false, uses: null, known: true, school: 'arms', ...x });
  const hearth = ready => ({ cls: 'hearthkeeper', label: 'Hearthkeeper', icon: '🔥', level: 10, school: { key: 'hearth', name: 'Hearth magic', icon: '🔥' },
    abilities: ['h_cinder', 'h_kindle', 'h_ward', 'h_bold', 'h_steady', 'h_ember_ward', 'h_banish'].map((k, i) => ab(k, 'H' + i, i, { school: 'hearth', off: true, dmg: 7, ready: ready.includes(k) })) });
  const archer = ready => ({ cls: 'archer', label: 'Archer', icon: '🏹', level: 4, school: { key: 'archery', name: 'Archery', icon: '🏹' }, abilities: ['a_shoot', 'a_side', 'a_part', 'a_mark'].map((k, i) => ab(k, 'A' + i, i, { school: 'archery', off: true, ready: ready.includes(k) })) });
  const FIVE = ['h_cinder', 'h_kindle', 'h_ward', 'h_bold', 'h_steady'];
  const guard = (x = {}) => ({ citizen: { id: 7, name: 'Hazel <b>' }, cls: 'guard', label: 'Guard', icon: '🛡️', career: 'soldier', level: 10, xp: { into: 30, need: 120 }, school: { key: 'arms', name: 'Arms', icon: '⚔️' },
    abilities: [ab('g_strike', 'Strike', 1), ab('g_shield', 'Shield Up', 1, { cooldown: 1 }), ab('g_cover', 'Cover', 2), ab('g_shove', 'Shove', 4), ab('g_heavy', 'Heavy Blow', 6), ab('g_stand_fast', 'Stand Fast', 8), ab('g_shield_bash', 'Shield Bash', 10)],
    ahead: [ab('g_oath', "Guard's Oath", 13, { known: false }), ab('g_hold_line', 'Hold the Line', 16, { known: false, uses: 1 }), ab('g_hammer', 'Hammer Blow', 20, { known: false })],
    second: { max: 5, strength: 0.75, busy: false, cls: 'hearthkeeper', chosen: null, options: [hearth(FIVE), archer([])] }, ...x });
  const html = K._pageHtml(guard());
  check('18a. the page has three parts: everything of their own school, what is still to learn with its level, and the second school', /⚔️ Arms <span class="kwab-h-sub">7 known: all of them go into battle/.test(html) && /Still to learn/.test(html) && /Second school/.test(html)
    && (html.match(/kwab-row is-locked/g) || []).length === 3 && /🔒 Level 13/.test(html) && /🔒 Level 20/.test(html));
  check('18b. it says the class, the level, how far to the next, and what the next level teaches', /Guard · level 10/.test(html) && /style="width:25%"/.test(html) && /Next: <b>Guard&#39;s Oath<\/b> at level 13\./.test(html));
  check('18c. everything of their own is brought: no tick boxes there, each marked brought', (html.match(/<span class="kwab-when is-on">✓ Brought<\/span>/g) || []).length === 7 && !/data-key="g_strike"/.test(html));
  const wiz = K._pageHtml(guard({ cls: 'wizard', label: 'Wizard', school: { key: 'wild', name: 'Wild magic', icon: '🔮' }, abilities: [ab('v_swing', 'Swing', 1, { school: 'basics', school_name: 'Basics' }), ab('w_spark', 'Spark', 1, { school: 'wild' })] }));
  check('18d. an ability of another school among their own says which: the plain blow is Basics', /🔮 Wild magic/.test(wiz) && /<span class="kwab-when is-on">Basics<\/span>/.test(wiz) && (wiz.match(/✓ Brought/g) || []).length === 1);
  check('18e. the second school: each old career to choose from, the furthest along first, and None', /up to 5 abilities from an old career, at 75% strength/.test(html) && (html.match(/data-kwab="school"/g) || []).length === 3
    && /value="hearthkeeper" checked/.test(html) && /🔥 Hearth magic<\/b> <i>Hearthkeeper level 10<\/i>/.test(html) && /🏹 Archery<\/b> <i>Archer level 4<\/i>/.test(html) && /value="none"/.test(html) && html.indexOf('value="hearthkeeper"') < html.indexOf('value="archer"'));
  check('18f. its abilities have tick boxes: five ticked, a sixth cannot be, and Save waits for a change', (html.match(/data-kwab="toggle"/g) || []).length === 7 && (html.match(/data-kwab="toggle"[^>]* checked/g) || []).length === 5
    && (html.match(/data-kwab="toggle"[^>]* disabled/g) || []).length === 2 && /5 of 5 chosen/.test(html) && /data-kwab="save" disabled/.test(html) && (html.match(/kwab-row is-ready is-off/g) || []).length === 5);
  const three = K._pageHtml(guard(), { cls: 'hearthkeeper', keys: ['h_kindle', 'h_ward', 'h_banish'] });
  check('18g. with a different choice Save is on; fewer than five is allowed', /3 of 5 chosen/.test(three) && /data-kwab="save">Save</.test(three) && !/data-kwab="toggle"[^>]* disabled/.test(three) && /data-key="h_banish" checked/.test(three));
  const other = K._pageHtml(guard(), { cls: 'archer', keys: ['a_shoot', 'a_side', 'a_part', 'a_mark'] });
  check('18h. another old career shows its own abilities; none shows no list', /value="archer" checked/.test(other) && /data-key="a_mark" checked/.test(other) && !/data-key="h_kindle"/.test(other) && /4 of 5 chosen/.test(other)
    && !/data-kwab="toggle"/.test(K._pageHtml(guard(), { cls: 'none', keys: [] })) && /Nothing from another class/.test(K._pageHtml(guard(), { cls: 'none', keys: [] })) && /data-kwab="save">Save</.test(K._pageHtml(guard(), { cls: 'none', keys: [] }))
    && /data-kwab="save" disabled/.test(K._pageHtml(guard(), { cls: 'hearthkeeper', keys: [] })));
  check('18i. each row says what the ability does in the battle screen\'s own words, how often, and shows the battle\'s picture', /\[g_strike\]/.test(html) && /10 damage · reach 1/.test(html) && /every other turn/.test(html) && /7 damage · reach 1/.test(html)
    && K._pace({ uses: 1 }) === 'once a battle' && K._pace({ uses: 2 }) === 'twice a battle' && K._pace({ cooldown: 2 }) === 'every 3rd turn' && /quick/.test(K._pace({ quick: true, cooldown: 2 })));
  const lone = K._pageHtml(guard({ second: { max: 5, strength: 0.75, busy: false, cls: null, chosen: null, options: [] } }));
  check('18j. someone who has never been anything else is told how a second school comes about', !/data-kwab="school"/.test(lone) && !/kwab-bar/.test(lone) && /has never been anything else/.test(lone) && /changes career keeps what the old class taught them/.test(lone));
  const away = K._pageHtml(guard({ second: { ...guard().second, busy: true } }));
  check('18h2. away at a dungeon the choice cannot be changed', (away.match(/data-kwab="toggle"[^>]* disabled/g) || []).length === 7 && !/data-kwab="save"/.test(away) && /is away at a dungeon\. Abilities are chosen at home\./.test(away) && (away.match(/data-kwab="school"[^>]* disabled/g) || []).length === 3);
  const farmer = K._pageHtml({ citizen: { id: 8, name: 'Oakley' }, cls: 'villager', label: 'Villager', icon: '🧺', career: null, level: 1, xp: { into: 0, need: 0 }, school: { key: 'basics', name: 'Basics', icon: '🪵' },
    abilities: [ab('v_swing', 'Swing', 1, { school: 'basics' }), ab('v_duck', 'Duck', 1, { school: 'basics' }), ab('t_ration', 'Ration', 1, { school: 'field', school_name: 'Fieldcraft' })], ahead: [], second: { max: 5, strength: 0.75, busy: false, cls: null, chosen: null, options: [] } });
  check('18i2. someone with no class is told so, and what a class would teach; their trade\'s trick is Fieldcraft', /Villager/.test(farmer) && /a swing, a duck, and what their trade taught them/.test(farmer) && /would learn ten more/.test(farmer) && />Fieldcraft<\/span>/.test(farmer) && !/Still to learn/.test(farmer));
  check('18j2. names are escaped', lone.includes('Hazel &lt;b&gt;') && !lone.includes('Hazel <b>') && away.includes('Hazel &lt;b&gt;'));
  check('18k. the tab is on every grown citizen\'s page (every battle is on the board), and not on a child\'s', /data-cp="abilities"/.test(K.tabHtml({ id: 7, life_stage: 'adult' })) && K.tabHtml({ id: 7, life_stage: 'child' }) === ''
    && /id="cp-tab-abilities"/.test(K.panelHtml({ id: 7 })) && K.available() === true
    && /\$\{window\.KWAbilities \? KWAbilities\.tabHtml\(c\) : ''\}/.test(CZ) && /\$\{window\.KWAbilities \? KWAbilities\.panelHtml\(c\) : ''\}/.test(CZ));
  w._kwIsAdmin = () => false;
  check('18l. a player who is no admin sees it too', K.available() === true && /data-cp="abilities"/.test(K.tabHtml({ id: 7, life_stage: 'adult' })));
  check('18m. the server is asked what is known and told the second school; nothing is worked out here', /call\(String\(id\)\)/.test(A) && /call\(S\.id \+ '\/second', \{ cls: S\.pick\.cls, keys: S\.pick\.keys \}\)/.test(A) && /'\/api\/tactics\/abilities\/' \+ path/.test(A) && !/\.at\s*<=/.test(A));
  check('18n. the script and its stylesheet are on the page, after the battle screen it borrows from; the stylesheet uses the shared colours only', /<script defer src="\/js\/tactics\.js\?v=h[0-9a-f]{8}"><\/script>[^\n]*\n\s*<script defer src="\/js\/abilities\.js\?v=h[0-9a-f]{8}"><\/script>/.test(H)
    && /<link rel="stylesheet" href="\/css\/abilities\.css\?v=h[0-9a-f]{8}">/.test(H) && !/#[0-9a-fA-F]{3,8}\b/.test(ACSS) && !/rgba?\(/.test(ACSS) && /\.kwab-tick \{[^}]*min-height: var\(--kw-touch\)/.test(ACSS));
  check('18o. the battle screen lends its pictures and words', /loadAssets, icon: ico, effectText, reachText,/.test(J));
  // In a battle.
  check('18p. the ten from the higher rungs have their looks: a bash thuds, rain and hail are arrows, a fireball bursts, a battle cry cheers', /g_shield_bash: 'smash', g_hammer: 'smash', g_hold_line: 'ward_ring',/.test(J) && /a_arrow_rain: 'arrow', a_pin: 'arrow', a_hail: 'arrow',/.test(J)
    && /w_chain: 'spark', w_fireball: 'fireburst',/.test(J) && /h_battle_cry: 'cheer', h_hearthlight: 'ward_ring',/.test(J));
  // Schools in a battle: a tab for the citizen's own and one for their second school.
  {
    const src = J.slice(J.indexOf('  const SCHOOLS = {'), J.indexOf('  function paintPanel() {'));
    const S2 = { tab: {} };
    const fn = new Function('S', src + '; return { tabsOf, tabOf, SCHOOLS };')(S2);
    const own = [{ key: 'v_swing', school: 'basics' }, { key: 'a_shoot', school: 'archery' }], off = [{ key: 'h_kindle', school: 'hearth', off: true }, { key: 'h_ward', school: 'hearth', off: true }];
    const one = fn.tabsOf({ id: 'c1', school: 'archery', abilities: own }), two = fn.tabsOf({ id: 'c2', school: 'archery', second: { school: 'hearth' }, abilities: own.concat(off) });
    check('18q. a citizen with no second school has one tab; with one, two: their own (Basics with it), then the second, marked', one.length === 1 && one[0].name === 'Archery' && one[0].list.length === 2
      && two.length === 2 && two[0].key === 'own' && two[0].list.map(a => a.key).join() === 'v_swing,a_shoot' && two[1].key === 'second' && two[1].name === 'Hearth magic' && two[1].off === true && two[1].list.length === 2);
    const u2 = { id: 'c2', school: 'archery', second: { school: 'hearth' }, abilities: own.concat(off) };
    S2.tab.c2 = 'second';
    check('18q2. their own tab is open until the player opens the other; a foe\'s abilities are one unnamed list', fn.tabOf({ id: 'c9', school: 'arms', abilities: own }).key === 'own' && fn.tabOf(u2).key === 'second'
      && fn.tabsOf({ id: 'e1', abilities: [{ key: 'bite' }] }).length === 1 && Object.keys(fn.SCHOOLS).join() === 'basics,arms,archery,wild,hearth,field');
    check('18q3. the action bar shows the tabs only when there are two, and the open school\'s abilities; 0 swaps school', /tabs\.length > 1 \? `<div class="kwtc-schools" role="tablist"/.test(J) && /\+ tab\.list\.map\(\(x, i\) => \{/.test(J)
      && /data-kwt="school" data-school="\$\{t\.key\}"/.test(J) && /k === 'school'/.test(J) && /if \(ev\.key === '0' && u && u\.side === 'player' && tabsOf\(u\)\.length > 1\)/.test(J) && /\$\{t\.off \? ' <em>¾<\/em>' : ''\}/.test(J));
    check('18q5. the open tab is the one marked (by its key: the tabs are made afresh each time)', /class="kwtc-school\$\{t\.key === tab\.key \? ' is-on' : ''\}"/.test(J) && /aria-selected="\$\{t\.key === tab\.key\}"/.test(J));
    check('18q4. an ability from the second school is marked on its button and in the list shown for a tapped citizen', /\$\{x\.off \? ' is-off' : ''\}" data-kwt="ability"/.test(J) && /second school, three-quarters strength/.test(J)
      && /\.kwtc-act\.is-off \{/.test(CSS) && /\.kwtc-school\.is-on \{/.test(CSS));
  }
  // Mastery (stage B): an ability used enough in battle is ✦ for that citizen.
  {
    const mPage = guard({ mastery: { uses: 25, edge: 1.2 }, abilities: [ab('g_strike', 'Strike', 1, { used: 25, star: true }), ab('g_shield', 'Shield Up', 1, { used: 10, star: false, uses: 2 })] });
    const mh = K._pageHtml(mPage);
    check('18u. the Abilities tab shows how near each ability is to mastery, and a ✦ on one that is mastered', /Strike <span class="kwab-star"[^>]*>✦<\/span>/.test(mh) && /✦ Mastered: 20% stronger/.test(mh) && /10 of 25 uses to ✦/.test(mh) && /style="width:40%"/.test(mh) && /twice a battle/.test(mh) && !/0 times a battle|25 times a battle|10 times a battle/.test(mh)
      && !/kwab-mastery/.test(K._pageHtml(guard())) && !/uses to ✦/.test(K._pageHtml(guard({ mastery: { uses: 25, edge: 1.2 } })).split('Still to learn')[1].split('Second school')[0]));
    check('18v. in battle a mastered ability wears a ✦ on its button and in a tapped citizen\'s list', /\$\{x\.star \? ' <b class="kwtc-star" title="Mastered: a fifth stronger">✦<\/b>' : ''\}/.test(J) && /\$\{a\.star \? ' ✦' : ''\}/.test(J) && /\.kwtc-star \{/.test(CSS));
    check('18w. the end screen says what was mastered with this battle, under the citizen, won or lost', /if \(!A\.mastered && b\.mastered && b\.mastered\.length && \(!won \|\| A\.xp\)\)/.test(J) && /Mastered: \$\{esc\(m\.icon \|\| ''\)\} <b>\$\{esc\(m\.name\)\} ✦<\/b> <i>a fifth stronger from now on<\/i>/.test(J)
      && /b\.mastered = d\.mastered && d\.mastered\.length \? d\.mastered : kept\.mastered;/.test(J));
    check('18x. Help says what mastery is', /used about 25 times in battle is <b>mastered<\/b> \(✦\): a fifth stronger/.test(read('js/help.js')));
  }
  // Gear (stage C): the kind of weapon and the shield change what abilities do.
  {
    const kinds = [{ key: 'sword', name: 'Sword', says: 'Arms abilities are ready a turn sooner.' }, { key: 'staff', name: 'Staff', says: 'Wild and Hearth magic is a fifth stronger.' }];
    const gp = K._pageHtml(guard({ kinds, gear: { weapon: { key: 'iron_sword', name: 'Iron <Sword>', icon: '⚔️', kind: 'sword', kind_name: 'Sword', says: kinds[0].says }, shield: { key: 'tower_shield', name: 'Tower Shield', icon: '🧱', block: 8, says: 'Arms blocks are 8 stronger.' }, armour: { key: 'chainmail', name: 'Chainmail', icon: '🔗' } } }));
    check('18y. the Abilities tab says what they hold and wear, and what each does', /Gear <span class="kwab-h-sub">what they hold changes what their abilities do/.test(gp) && /<b>Iron &lt;Sword&gt;<\/b> <i>Sword<\/i> Arms abilities are ready a turn sooner\./.test(gp)
      && /<b>Tower Shield<\/b> Arms blocks are 8 stronger\./.test(gp) && /<b>Chainmail<\/b> Takes the edge off every hit\./.test(gp) && gp.indexOf('kwab-gear') < gp.indexOf('all of them go into battle'));
    const none = K._pageHtml(guard({ kinds, gear: null }));
    check('18z. with nothing carried it says so; the guide to every kind is there either way; an older page with no kinds shows no gear part', /carries nothing that changes a fight/.test(none) && /<summary>What each kind of weapon does<\/summary>/.test(none) && (none.match(/<li><b>(Sword|Staff|Shield)<\/b>/g) || []).length === 3
      && /read the school of an ability, not the class/.test(none) && !/kwab-kinds/.test(K._pageHtml(guard())));
    const src = J.slice(J.indexOf('  function gearLine(u) {'), J.indexOf('  function unitCard(u, v) {'));
    const gearLine = new Function('esc', src + '; return gearLine;')(x => String(x).replace(/</g, '&lt;'));
    check('18A. in battle a citizen\'s card names what they hold; the words for what it does are in its title and in the tapped list', /🪄 Oak Staff/.test(gearLine({ gear: { weapon: { name: 'Oak Staff', icon: '🪄', says: 'Wild and Hearth magic is a fifth stronger.' }, shield: { name: 'Buckler', icon: '🛡️', says: 'Arms blocks are 3 stronger.' } } }))
      && /title="Wild and Hearth magic is a fifth stronger\."/.test(gearLine({ gear: { weapon: { name: 'Oak Staff', icon: '🪄', says: 'Wild and Hearth magic is a fifth stronger.' } } })) && gearLine({}) === '' && gearLine({ gear: { armour: { name: 'Mail' } } }) === ''
      && /\$\{gearLine\(u\)\}<\/div>`;/.test(J) && /class="kwtc-kit-a is-gear"/.test(J));
    check('18B. a dagger\'s blow from behind is forecast at its own worth', /from behind \(\+\$\{Math\.round\(\(\(a\.back \|\| 1\.5\) - 1\) \* 100\)\}%\)/.test(J));
    const EN = read('js/tactics-engine.js');
    check('18C. the rules: an ability may carry its own worth for a blow from behind, else half as much again', /d \*= side === 'back' \? \(a\.back \|\| RULES\.BACK\) : side === 'side' \? RULES\.FLANK : 1;/.test(EN));
    check('18D. Help says that what is carried matters', /a longbow reaches further, a hammer hits harder and slows its wielder, a polearm strikes two tiles away, a dagger doubles a blow from behind, a staff strengthens Wild magic, an ember lantern strengthens Hearth magic, a shield strengthens a block/.test(read('js/help.js')));
  }
  // The Attack (2026-11-27): its own button, apart from the abilities; two hands; the ember lantern.
  {
    const src = J.slice(J.indexOf('  const SCHOOLS = {'), J.indexOf('  function paintPanel() {'));
    const fn = new Function('S', src + '; return { tabsOf, tabOf, attackOf };')({ tab: {} });
    const unit = { id: 'c1', school: 'arms', second: { school: 'hearth' }, abilities: [{ key: 'g_strike', school: 'arms', attack: true }, { key: 'g_shield', school: 'arms' }, { key: 'h_kindle', school: 'hearth', off: true }] };
    check('18E. a citizen\'s Attack is found apart from their abilities, and is in no tab', fn.attackOf(unit).key === 'g_strike' && fn.tabsOf(unit)[0].list.map(a => a.key).join() === 'g_shield' && fn.tabsOf(unit)[1].list.map(a => a.key).join() === 'h_kindle'
      && fn.attackOf({ abilities: [{ key: 'bite' }] }) === null && fn.attackOf(null) === null);
    check('18F. the action bar has an Attack button on a row of its own, above the schools and whichever is open, with what it is and does', /class="kwtc-act kwtc-attack\$\{a === atk \? ' is-on' : ''\}" data-kwt="ability" data-key="\$\{esc\(atk\.key\)\}"/.test(J)
      && /<span class="kwtc-act-n">Attack\$\{atk\.star/.test(J) && /\$\{atk\.name\}: \$\{why \|\| effectText\(atk\)\}/.test(J) && /acts\.innerHTML = attackBtn \+ \(tabs\.length > 1 \?/.test(J) && /<div class="kwtc-attack-row">/.test(J) && /\.kwtc-attack-row \{ flex: 1 1 100%;/.test(CSS) && /\.kwtc-act\.kwtc-attack \{/.test(CSS));
    check('18G. A is the Attack\'s key; a tapped citizen\'s list names their Attack first', /if \(\(ev\.key === 'a' \|\| ev\.key === 'A'\) && u && u\.side === 'player' && attackOf\(u\)\) \{ ev\.preventDefault\(\); choose\(attackOf\(u\)\.key\); \}/.test(J)
      && /<span class="kwtc-kit-a is-attack">\$\{ico\(lookAtk\)\} <b>Attack/.test(J));
    const atk = ab('g_strike', 'Strike', 1, { attack: true, dmg: 17 });
    const page = K._pageHtml(guard({ attack: atk }));
    check('18H. the Abilities tab shows the Attack on its own, before the abilities, and says whose it is', /Attack <span class="kwab-h-sub">a fighter&#39;s: it hits well|Attack <span class="kwab-h-sub">a fighter's: it hits well/.test(page) && /kwab-row is-ready is-attack/.test(page) && />Always<\/span>/.test(page)
      && page.indexOf('is-attack') < page.indexOf('all of them go into battle') && /their craft is magic: a blow from them is a feeble thing/.test(K._pageHtml(guard({ cls: 'wizard', attack: atk })))
      && /a swing with whatever is to hand/.test(K._pageHtml(guard({ cls: 'villager', attack: atk }))) && !/is-attack/.test(K._pageHtml(guard())));
    const kinds = [{ key: 'hammer', name: 'Hammer', says: 'Blows land a quarter harder.', hands: 2 }, { key: 'lantern', name: 'Lantern', says: 'Hearth magic is a fifth stronger.', hands: 1 }];
    const gp = K._pageHtml(guard({ kinds, gear: null }));
    check('18I. the guide marks the kinds that take two hands, and says a shield does not go with them', /<li><b>Hammer<\/b> <i>two hands<\/i> Blows land a quarter harder\.<\/li>/.test(gp) && /<li><b>Lantern<\/b> Hearth magic is a fifth stronger\.<\/li>/.test(gp) && /Not with a weapon that takes two hands\./.test(gp)
      && /a lantern helps a Guard&#39;s borrowed healing|a lantern helps a Guard's borrowed healing/.test(gp));
    check('18I2. a shield left on the back by a two-handed weapon is named as doing nothing', /On their back/.test(K._pageHtml(guard({ kinds, gear: { weapon: { name: 'Halberd', kind_name: 'Polearm', says: 'x' }, idle: { name: 'Tower Shield', icon: '🧱', says: 'On their back: no shield goes with a weapon that takes two hands.' } } }))));
    check('18J. equipping says when a shield or a two-handed weapon went back to the stores', /if \(d\.note && typeof showBuildToast === 'function'\) showBuildToast\(d\.note, 'success'\);/.test(read('js/inventory.js')));
    check('18K. Help: everyone has an Attack; a caster\'s is feeble; two hands, no shield', /Everyone also has an <b>Attack<\/b>, on its own button/.test(read('js/help.js')) && /can only manage a feeble knock/.test(read('js/help.js')) && /take two hands, so no shield goes with them/.test(read('js/help.js')));
  }
  check('18r. a level that teaches an ability says so on the victory screen', /Learned: \$\{esc\(x\.icon \|\| ''\)\} <b>\$\{esc\(x\.name\)\}<\/b>/.test(J));
  check('18s. a burst that reaches two tiles says so', /a\.radius > 1 \? `and all within \$\{a\.radius\} of them` : 'and those beside'/.test(J));
  const C4 = require(path.join(ROOT, 'scripts', 'check_live.js')).wanted();
  check('18t. the check on the live site covers the new script and stylesheet', C4.includes('js/abilities.js') && C4.includes('css/abilities.css'));
}

console.log('19. A quest\'s battle is fought on the board; the cards are gone');
{
  const J = read('js/tactics.js'), B = read('js/battles.js'), H = read('index.html'), RT = read('js/realtime.js');
  // The Battles list.
  const el = { innerHTML: '' };
  const toasts = [];
  const w = { console, Math, JSON, Number, String, Array, Object, Date, Promise, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, showToastNotification: m => toasts.push(m),
    document: { readyState: 'complete', getElementById: id => (id === 'battles-list' ? el : null), addEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, querySelector: () => null }), body: { appendChild() {} } } };
  w.window = w; w.globalThis = w;
  vm.createContext(w); vm.runInContext(B, w);
  const K = w.KWBattles;
  const battle = (x = {}) => ({ id: 7, quest_title: 'Gather herbs', quest_icon: '🌿', citizen_name: 'Ivy', combat_encounter: ['night_wolf'], combat_trigger_at: new Date().toISOString(), board_battle: null, board_foes: ['Wolf Raider'], ...x });
  const list = b => { K._renderList([b || battle()]); return el.innerHTML; };
  check('19a. a waiting battle has one button, Engage, and a way to give it up', (list().match(/class="bm-engage/g) || []).length === 1 && /onclick="engageBattle\(7\)">⚔ Engage</.test(list()) && /onclick="forfeitBattle\(7\)"/.test(list()) && !/With cards|bm-board/.test(list()));
  check('19b. one already begun offers the way back to it', /onclick="engageBattle\(7\)">♟ Back to the battle</.test(list(battle({ board_battle: 31 }))));
  check('19c. the list names the foes of the board, not the old creatures', /has encountered Wolf Raider/.test(list()) && /has encountered Night Wolf/.test(list(battle({ board_foes: [] }))));
  check('19d. the battle is asked of the server for that quest, then opened on the board by its number', /apiFetch\('\/api\/tactics\/quest\/' \+ questRunId, \{ method: 'POST' \}\)/.test(B) && /await global\.KWTactics\.openById\(d\.battle\.id\);/.test(B));
  check('19e. startBattleFromQuest is the one way in, for the list, a camp assault and a sally', typeof w.startBattleFromQuest === 'function' && /global\.startBattleFromQuest = startBattleFromQuest;/.test(B)
    && /startBattleFromQuest\(data\.quest_run_id\)/.test(read('js/main.js')) && /global\.startBattleFromQuest\(runId\)/.test(read('js/raids.js')));
  K.onSpoils({ items: [{ name: 'Iron Ore', icon: '⛏️', qty: 2 }] });
  check('19f. a fight decided for the player says what it left in the stores', toasts.length === 1 && /From the fight: ⛏️ Iron Ore ×2/.test(toasts[0]) && /battle_spoils\(ev\) \{ if \(global\.KWBattles && global\.KWBattles\.onSpoils\) global\.KWBattles\.onSpoils\(ev\); \}/.test(RT));
  check('19g. the battle report names who was fought on the board', /data\.foes && data\.foes\.length \? data\.foes : \(data\.encounter \|\| \[\]\)\.map\(_titleCase\)/.test(B));
  // The battle screen.
  check('19h. what became of the quest comes with the answer to the last choice', /if \(d\.quest\) b\.quest = d\.quest;/.test(J));
  check('19i. won: what it paid, who came back better, and that the quest goes on', /found\.textContent = \(bits\.length \? `Won: \$\{bits\.join\(', '\)\}\. ` : ''\) \+ \(better\.length \? `\$\{better\.join\(' and '\)\} came back a better fighter\. ` : ''\) \+ 'The quest goes on\.';/.test(J));
  check('19j. lost: the quest has failed', /inQuest \? 'The party is driven off, and the quest has failed\.'/.test(J));
  check('19k. a quest\'s battle is fought once: the only button leads back to the town', /\(inQuest\n\s+\/\/ A quest's battle is fought once: the way on is back to the town\.\n\s+\? `<button type="button" class="kw-btn primary" data-kwt="close">Back to the town<\/button>`/.test(J));
  check('19l. ✕ only steps away from it: the quest still waits on its battle', /if \(!inDungeon && !inQuest && b && b\.id && S\.state && S\.state\.status === 'active'\)/.test(J));
  check('19m. back in the town the quest, the Battles list, the stores and the citizens are read again', /for \(const fn of \['refreshBattleBadge', 'refreshActiveQuests', 'refreshResources', 'loadCitizens'\]\)/.test(J));
  // The cards are gone.
  const gone = ['js/cards.js', 'js/card-admin.js', 'js/card-combat.js', 'js/card-definitions.js', 'js/card-engine.js', 'js/card-formula.js', 'js/card-hand-ui.js', 'js/card-registry.js', 'js/combat-engine.js', 'js/combat-ui.js', 'js/deck-builder.js',
    'css/card-admin.css', 'css/card-hand-ui.css', 'css/deck-feedback.css'];
  check('19n. the card battler is deleted: its engine, hand, battle screen, deck builder, collection and editor', gone.every(f => !fs.existsSync(path.join(ROOT, f))), gone.filter(f => fs.existsSync(path.join(ROOT, f))).join());
  const srcs = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n');
  check('19o. nothing on the page or in a script asks for them', !/card-hand-ui|deck-builder|combat-ui\.js|combat-engine\.js|card-engine|card-registry|deck-feedback/.test(H) && !/id="nav-decks"/.test(H)
    && !/openDeckBuilder|KWCards\b|CardHandUI|CombatEngine\b|\/api\/decks|\/api\/cards\b|\/api\/card-admin|\/api\/combat\/(engage|action|resolve)/.test(srcs));
  check('19p. Dev Tools has no switch for it any more: there is nothing to switch', !/quests-switch|data-kwt-dev="quests"/.test(J));
  const C5 = require(path.join(ROOT, 'scripts', 'check_live.js')).wanted();
  check('19q. the check on the live site no longer expects the card scripts', !C5.some(f => gone.includes(f)) && C5.includes('js/battles.js'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
