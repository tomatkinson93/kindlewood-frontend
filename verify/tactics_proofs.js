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
  check('7l. nothing is saved: the two sides come from the admin route and the battle lives in memory', /apiFetch\('\/api\/tactics\/admin\/setup'/.test(J) && (J.match(/apiFetch\(/g) || []).length === 2);
  check('7m. on a phone the panel stacks and buttons are big enough to tap', /@media \(max-width: 640px\)[\s\S]*?\.kwtc-panel \{ grid-template-columns: minmax\(0, 1fr\);[\s\S]*?min-height: var\(--kw-touch\)/.test(CSS));
}

console.log('8. Facing, zoom, a phone on its side, art and sound');
{
  const J = read('js/tactics.js'), CSS = read('css/tactics.css'), HTML = read('index.html');
  check('8a. ending a turn asks which way to face: from the End turn button, and by itself once the move and the action are both used',
    /else if \(k === 'end'\) askFacing\(\);/.test(J) && /st\.turn\.moved && st\.turn\.acted\) return askFacing\(\);/.test(J) && /await play\(E\(\)\.endTurn\(S\.state, face\)\);/.test(J));
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
  check('8i. a creature with art is drawn from it (front or back view, mirrored), one without keeps its icon', /function creatureArt\(u, v\)/.test(J) && /away && a\.back \? a\.back : a\.front/.test(J) && /c\.fillText\(u\.icon \|\| '👹'/.test(J));
  check('8j. sounds: its own file when there is one, an older sound until then, silence otherwise', /const own = ASSETS\.sounds\[name\], file = own \? 'tactics\/' \+ own : STAND_IN\[name\];/.test(J) && /if \(file\) global\.playSfx\(file\);/.test(J));
  check('8k. music: its own tracks when there are any (a "boss" file for boss fights), else the card battles\'; it stops when the battle ends or is left', /const list = boss && forBoss\.length \? forBoss : \(rest\.length \? rest : all\);/.test(J) && /\? 'TACTICS' : 'BATTLE'\)/.test(J) && /music\(false\); sfx\(st\.status === 'victory'/.test(J) && /if \(S\.open\) music\(false\);/.test(J) && /global\.registerMusic\s+=/.test(read('js/audio.js')));
  // A phone that loaded the game before a sheet was re-packed kept the old picture (every row the front pose), so
  // every citizen was drawn facing the camera whatever way they looked. Sheets now carry a stamp of their contents.
  const VJ = JSON.parse(read('assets/sprites/villagers/villagers.json')), sha = f => require('crypto').createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 8);
  const stale = [];
  for (const [sp, v] of Object.entries(VJ.species)) for (const [an, a] of Object.entries(v.anims)) if (!a.v || a.v !== sha('assets/sprites/villagers/' + a.file)) stale.push(sp + ' ' + an);
  check('8m. every villager sheet carries a stamp of its contents, and the stamps are up to date', stale.length === 0, stale.join(', '));
  check('8n. the game asks for sheet?v=stamp, and the packers write the stamps', /BASE \+ a\.file \+ \(a\.v \? '\?v=' \+ a\.v : ''\)/.test(read('js/villagers.js')) && /meta\.anims\[anim\]\.v = /.test(read('scripts/pack_sprites.js')) && /const stamped = \(dir, f\) => f \+ '\?v=' \+/.test(read('scripts/pack_tactics.js')));
  check('8o. into a battle: a spiral closes over the screen, the battle is named on it, a circle opens; nothing acts until it has lifted',
    /function drawSwirl\(C, p\)/.test(J) && /function drawIris\(C, p\)/.test(J) && /open\(setup, new Promise\(r => \{ lifted = r; \}\)\);/.test(J)
    && /Promise\.all\(\[hold \|\| Promise\.resolve\(\), loadAssets\(\)\]\)\.then\(\(\) => \{ if \(S\.open && S\.el === el && !S\.ended\) \{ music\(true\); nextTurn\(\); \} \}\);/.test(J));
  check('8p. with reduced motion the screen goes dark and shows the board: no spiral', /const closing = still\(\) \? \(C\.el\.classList\.add\('is-solid'\), wait\(60\)\) : animate\(620, p => drawSwirl\(C, p\)\);/.test(J) && /if \(!still\(\)\) await animate\(560, p => drawIris\(C, p\)\);/.test(J));
  check('8q. leaving fades the scene out; a second start while one is coming up is ignored', /S\.el\.classList\.add\('is-leaving'\);/.test(J) && /\.kwtc\.is-leaving \{ opacity: 0; \}/.test(CSS) && /if \(entering\) return null;/.test(J));
  check('8l. on a narrow phone Dev Tools is in the profile menu, for admins only', /id="pm-devtools" style="display:none" onclick="openCheatMenu\(\); closeProfileMenu\(\)"/.test(HTML) && /querySelectorAll\('\.btn-cheat, \.kw-admin-only'\)/.test(read('js/buildings.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
