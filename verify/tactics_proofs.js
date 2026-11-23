// Proofs for the tactics battle prototype (docs/TACTICS.md):
// the rules in js/tactics-engine.js, and the screen's wiring in js/tactics.js.
//   node verify/tactics_proofs.js
'use strict';
const fs = require('fs');
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
  check('8i. a foe with art is drawn from its sheet, the frame for the way it faces; one without keeps its icon', /function creatureArt\(u, v\)/.test(J) && /dir = tv\[0\] > 0 \? 'se' : tv\[0\] < 0 \? 'nw' : tv\[1\] > 0 \? 'sw' : 'ne';/.test(J)
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
  check('10a. the panel is one fixed height, so the board above it never moves', /\.kwtc-panel \{ height: 196px; align-content: start; overflow-y: auto; \}/.test(CSS) && /\.kwtc-panel \{ height: 316px; \}/.test(CSS));
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
  check('11d. ✕ only steps away from a dungeon\'s battle (it stays open) and the dungeon\'s screen comes back', /if \(!inDungeon && b && b\.id && S\.state && S\.state\.status === 'active'\)/.test(J) && /if \(inDungeon\) after\.then\(\(\) => \{ if \(global\.KWDungeon && global\.KWDungeon\.open\) global\.KWDungeon\.open\(\); \}\);/.test(J));
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
  check('15a. an ability not learned yet sits in its place in the row, greyed, saying the class level that brings it', /\(u\.locked \|\| \[\]\)\.map\(x => `<div class="kwtc-act is-locked"/.test(J) && /learned at level \$\{x\.at\}/.test(J)
    && /\.kwtc-act\.is-locked \{ opacity: \.45; cursor: default; border-style: dashed; \}/.test(CSS));
  check('15b. it is no button: it cannot be chosen, and the number keys count only what is known', !/class="kwtc-act is-locked"[^>]*data-kwt/.test(J) && /const a = \(u\.abilities \|\| \[\]\)\[Number\(ev\.key\) - 1\];/.test(J));
  check('15c. tapping anyone shows what they know and, greyed, what they have yet to learn', /\(look\.locked \|\| \[\]\)\.map\(x => `<span class="kwtc-kit-a is-locked">/.test(J));
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
  check('17a. the five Brigands the owner drew are packed: a sheet and a face each', ['rat_cutpurse', 'weasel_slinger', 'fox_footpad', 'polecat_sawbones', 'boar_bruiser'].every(k => foes[k] && man.creatures[k] && man.creatures[k].file && man.creatures[k].face), keys.join(' '));
  check('17b. a sheet is one row of four frames, one for each way a unit can face on the board, so nothing is mirrored', keys.every(k => { const p = png('assets/sprites/creatures/' + foes[k].file); return p && foes[k].dirs.join() === 'se,sw,ne,nw' && p.w === foes[k].w * 4 && p.h === foes[k].h; }));
  check('17c. each foe stands at the height set for it against a citizen: a rat smaller than a mouse, a boar a third taller', keys.every(k => Math.abs(foes[k].scale * foes[k].tall / 59 - (sizes[k] || 1)) < 0.02)
    && foes.rat_cutpurse.scale * foes.rat_cutpurse.tall < 59 && foes.boar_bruiser.scale * foes.boar_bruiser.tall > 59 * 1.25, keys.map(k => `${k} ${(foes[k].scale * foes[k].tall / 59).toFixed(2)}`).join(', '));
  check('17d. its feet are on its tile: the foot point is inside the frame, near its bottom', keys.every(k => foes[k].foot.x > foes[k].w * 0.25 && foes[k].foot.x < foes[k].w * 0.75 && foes[k].foot.y > foes[k].h * 0.85 && foes[k].foot.y <= foes[k].h));
  check('17e. the screen draws it at that size from that foot, hopping as it walks, with its health bar over its head', /const z = 0\.62 \* k \* art\.scale, hop = v\.walking && !still\(\) \? Math\.abs\(Math\.sin\(t \/ 85\)\) \* 3\.5 \* k : 0;/.test(J)
    && /p\.x - art\.foot\.x \* z, p\.y \+ 3 \* k - hop - art\.foot\.y \* z, art\.w \* z, art\.h \* z\);/.test(J) && /Math\.max\(30 \* k, \(v\.tall \|\| 34 \* k\) \+ 2 \* k\)/.test(J));
  check('17f. a foe with a face shows it in the row of who acts next', /const face = u\.side === 'enemy' \? faceOf\(u\) : null;/.test(J) && /\.kwtc-chip\.has-face img \{[^}]*object-fit: cover;/.test(CSS) && keys.every(k => { const p = png('assets/sprites/creatures/' + foes[k].face); return p && p.w === 64 && p.h === 64; }));
  check('17g. the source exports are kept, each with its eight rotations', keys.every(k => ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'].every(d => fs.existsSync(path.join(ROOT, 'art/tactics/foes', k, 'rotations', d + '.png')))));
  const C3 = require(path.join(ROOT, 'scripts', 'check_live.js')).wanted();
  check('17h. the check on the live site covers every foe\'s sheet and face', keys.every(k => C3.includes('assets/sprites/creatures/' + foes[k].file) && C3.includes('assets/sprites/creatures/' + foes[k].face)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
