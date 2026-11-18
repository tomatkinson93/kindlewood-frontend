'use strict';
// Decorating and charm, and the lamplighter (docs/HOME_SCENE.md Part F, F.9
// and F.6, step 23; js/decor.js). The server decides costs, limits, what is
// placed and the charm (lib/decor.js there); the scene draws and asks.
//   node verify/decor_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/decor.js'), CSS = read('css/home-scene.css'), E = read('js/villager-engine.js'), G = read('js/home-ground.js'), SV = read('js/settlement-view.js'),
  CX = read('js/context.js'), H = read('index.html'), RT = read('js/realtime.js'), SE = read('js/session.js');

const w = { console, Date, Math, JSON, Number, String, Array, Object, Set, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWDecor;

console.log('1. The server decides');
{
  check('1a. what is placed, the kinds, the costs and the charm are read from the server', /apiFetch\('\/api\/decor'\)/.test(J) && /if \(d\.decor\) take\(d\.decor\);/.test(J));
  check('1b. placing, moving and removing are each sent, and the answer is what is drawn', /send\('POST', '', \{ kind: S\.placing, area: activeArea\(\), x: p\.x, y: p\.y \}\)/.test(J) && /send\('POST', '\/' \+ g\.id \+ '\/move'/.test(J) && /send\('DELETE', '\/' \+ id\)/.test(J));
  check('1c. no cost or charm is worked out here: the bar shows the server\'s numbers', /k\.next_charm/.test(J) && /costLine\(k\.cost\)/.test(J) && !/charm \* Math\.pow|REPEAT/.test(J));
  check('1d. a refusal is shown and the town is read again', /toast\('⚠️ ' \+ \(d\.error \|\| 'That did not work\. Try again\.'\)\); load\(\); return null;/.test(J));
  check('1e. one change at a time', /if \(S\.busy\) return null;\n    S\.busy = true;/.test(J));
  check('1f. another device\'s change arrives live, and coming back to the tab asks again', /decor\(ev\) \{ if \(global\.KWDecor\) global\.KWDecor\.onEvent\(ev\); \}/.test(RT) && /global\.KWDecor\.load\(\)/.test(SE));
}

console.log('2. Drawing');
{
  check('2a. six things, each drawn by code until its picture arrives', ['bench', 'lantern', 'flower_bed', 'fence', 'well', 'pond'].every(k => K.ART[k] && K.ART[k].w > 0 && K.ART[k].h > 0 && /<svg /.test(K.ART[k].html)));
  check('2b. a picture named decor_<kind> in the props manifest replaces the drawing', /manifest\.props\['decor_' \+ kind\]/.test(J) && /key\.indexOf\('decor_'\) !== 0/.test(G));
  check('2c. a thing sorts by depth at its foot; the flat pond by its far edge', K._depthOf(70, K.ART.bench, 600) === 700 && K._depthOf(70, K.ART.pond, 600) < 700 && K._depthOf(70, K.ART.pond, 600) > 600 && K._depthOf(0, K.ART.bench, 600) === 1);
  check('2d. outside Build mode they take no clicks', /\.kwd-item \{[^}]*pointer-events: none/.test(CSS) && /: `<span class="\$\{cls\}"/.test(J));
  check('2e. redrawn only when something changed, and never under the player\'s finger', /if \(!force && mark && mark\.getAttribute\('data-sig'\) === key\) return;/.test(J) && /if \(S\.drag\) return;/.test(J));
  check('2f. the automatic scenery of a kind steps aside once the player has placed their own', K._placedScatter([{ kind: 'bench' }, { kind: 'bench' }, { kind: 'well' }, { kind: 'flower_bed' }]).join() === 'bench,well' && /!skip\.includes\(d\.kind\)/.test(G) && /global\.KWDecor\.placedKinds\(\)/.test(G) && /skip\.join\('\+'\)/.test(G));
  check('2g. meadow flowers are not scenery a flower bed replaces', !K._placedScatter([{ kind: 'flower_bed' }]).length);
  check('2h. one way to ask the props manifest for a picture; an entry with no kind is never scattered as scenery', /function picture\(key, cls\)/.test(G) && /if \(!m \|\| !m\.file \|\| !\(m\.w > 0\) \|\| !\(m\.h > 0\)\) return null;/.test(G) && /d && KINDS\[d\.kind\]/.test(G));
}

console.log('3. Build mode');
{
  check('3a. a Decorate chip beside Build opens the bar; it is shut by default, so nothing covers the plots, and goes with Build mode', /if \(window\.KWDecor\) KWDecor\.buildModeChanged\(\);/.test(SV) && /if \(!building\(\) \|\| !S\.data \|\| !S\.open\) \{ if \(bar\) bar\.remove\(\);/.test(J)
    && /buildModeChanged\(\) \{ S\.placing = null; S\.picked = null; S\.open = false;/.test(J) && /key: 'decorate', label: 'Decorate', glyph: '🌷', unlock: \(\) => !!global\.KWDecor && fn\('_svIsBuildMode'\) && global\._svIsBuildMode\(\)/.test(read('js/places.js')));
  check('3b. costs in words, and what cannot be afforded says why', K._costLine({ stone: 30, timber: 10 }) === '30 stone + 10 timber' && K._costLine({ metal: 2 }) === '2 iron' && K._canAfford({ timber: 12 }, { timber: 12 }) && !K._canAfford({ timber: 12, stone: 1 }, { timber: 50 }) && /aria-disabled="true" title=/.test(J));
  check('3c. pick a thing, then tap open ground: never a building, a plot or another decoration', /t\.closest\('\.sv-slot, \.kwd-item, \.kwd-pop, \.sv-build-panel'\)\) return;/.test(J));
  check('3d. a drag that panned the view is not a tap', /Math\.hypot\(e\.clientX - S\.down\.x, e\.clientY - S\.down\.y\) > 8\) return;/.test(J));
  check('3e. the place is kept on the ground', /C\._onGround\(activeArea\(\), p\.x, p\.y\)/.test(J));
  check('3f. placing stops by itself when there can be no more of that kind', /if \(k && \(k\.have >= k\.max \|\| S\.data\.decorations\.length >= S\.data\.max \|\| !canAfford\(k\.cost, stock\(\)\)\)\) S\.placing = null;/.test(J));
  check('3g. a decoration is dragged to move it; the scene does not pan from it', /e\.stopPropagation\(\);   \/\/ the scene does not pan from here/.test(J) && /\.sv-build-mode button\.kwd-item \{[^}]*touch-action: none/.test(CSS));
  check('3h. a press without a drag picks it, and Remove says what comes back', /S\.picked = S\.picked === g\.id \? null : g\.id;/.test(J) && /Remove\$\{back \? ` \(\$\{esc\(back\)\} back\)` : ''\}/.test(J));
  check('3i. Esc stops placing and drops the pick', /e\.key === 'Escape' && \(S\.placing \|\| S\.picked != null\) && building\(\)/.test(J));
  check('3j. the bar stays inside the window where the view is bigger than it', /--kwd-under/.test(J) && /bottom: calc\(12px \+ var\(--kwd-under, 0px\)\)/.test(CSS));
  check('3k. buttons are big enough for a finger', /\.kwd-pal-btn \{[^}]*min-width: 78px; min-height: 64px/.test(CSS) && /\.kwd-pop button \{ min-height: 32px/.test(CSS));
  check('3l. the bar steps aside while a build panel is open (they share the bottom of the screen)', /bar\.hidden = !!panel;/.test(J) && /\.kwd-palette\[hidden\] \{ display: none; \}/.test(CSS));
}

console.log('4. Charm');
{
  const html = K._charmHtml({ charm: { score: 23.4, bonus: 2, line: 'Charm 23: +2 happiness for everyone (7 more for +3).' } });
  check('4a. one line for the town card', /🌷 charm 23 \(\+2\)/.test(html) && /title="Charm 23: \+2 happiness for everyone/.test(html));
  check('4b. nothing placed: nothing shown', K._charmHtml({ charm: { score: 0, bonus: 0, line: '' } }) === '' && K._charmHtml(null) === '');
  check('4c. the town card carries it', /global\.KWDecor \? global\.KWDecor\.charmHtml\(\) : ''/.test(CX));
  check('4d. the bar shows the server\'s line: what it gives and what more is needed', /esc\(c \? c\.line : ''\)/.test(J));
}

console.log('5. The lamplighter');
{
  check('5a. lanterns are lit through the evening and the night', K._litAt('dusk') && K._litAt('night') && !K._litAt('day') && !K._litAt('dawn'));
  const order = K._round({ x: 0, y: 0 }, [{ x: 90, y: 0, n: 'c' }, { x: 10, y: 0, n: 'a' }, { x: 40, y: 0, n: 'b' }]).map(p => p.n).join('');
  check('5b. the round goes to the nearest post, then the next nearest', order === 'abc');
  check('5c. when evening falls one free villager walks the round, an elder if there is one', /want && was && !litAt\(was\) && posts\.length && !building\(\)/.test(J) && /C\.playScript\('lamplighter', steps, c => c\.stage === 'elder' \|\| !!c\.elder\)/.test(J));
  check('5d. each post lights as they reach it', /steps\.push\(\{ wait: 650, say: '🔥', run: \(\) => setLit\(p\.el, true\) \}\)/.test(J) && /if \(st\.run\) \{ try \{ st\.run\(\); \}/.test(E));
  check('5e. nobody about: they come on by themselves; and however the round goes, every post ends up lit', /if \(who == null\) \{ posts\.forEach/.test(J) && /now\.querySelectorAll\(':scope > \.kwd-lantern'\)\.forEach\(el => setLit\(el, true\)\)/.test(J));
  check('5f. opening Home in the evening or at night finds them already lit', /S\.lit = want;\n    posts\.forEach\(el => setLit\(el, want\)\);/.test(J));
  check('5g. the engine has one hook for it: a script for a villager who is out and free', /function playScript\(id, steps, prefer, opts = \{\}\)/.test(E) && /!v\.child && !v\.act && !v\.selected && !v\.held && !v\.moment && !v\.talk && v\.partner == null && v\.state !== 'indoors'/.test(E));
  check('5h. the light sits over the night\'s tint; the post keeps its depth', /\.kwd-glow \{[^}]*z-index: 1061/.test(CSS) && !/\.kwd-item\.kwd-lit \{[^}]*z-index/.test(CSS));
  check('5i. the engine still never calls the server', !/apiFetch|fetch\(/.test(E.replace(/\/\/[^\n]*/g, '')));
}

console.log('5b. Villagers use what is placed');
{
  const we = { console, Date, Math, JSON, Number, String, Array, Object, Map, Set }; we.window = we; vm.createContext(we);
  let step = null;
  try { vm.runInContext(E, we); step = we.KWCast && we.KWCast._stepRound; } catch (_) { step = null; }
  const list = [{ id: 1, kind: 'bench', area: 'town', x: 50, y: 80 }, { id: 2, kind: 'well', area: 'town', x: 20, y: 70 }, { id: 3, kind: 'pond', area: 'town', x: 70, y: 90 }, { id: 4, kind: 'flower_bed', area: 'town', x: 10, y: 60 },
    { id: 5, kind: 'lantern', area: 'town', x: 30, y: 60 }, { id: 6, kind: 'fence', area: 'town', x: 40, y: 60 }, { id: 7, kind: 'bench', area: 'outskirts', x: 50, y: 80 }];
  const p = K._sceneParts(list, 'town', 2000, 600);
  check('5j. a bench is somewhere to sit; flowers, the well and the pond are somewhere to stop; a lantern and a fence are neither', p.spots.map(s => s.id).join() === 'bench-1,well-2,pond-3,flowers-4' && p.spots[0].rest === true && !p.spots[1].rest);
  check('5k. only this part of Home\'s decorations count', K._sceneParts(list, 'outskirts', 2000, 600).spots.length === 1 && K._sceneParts(list, 'neighbourhood', 2000, 600).spots.length === 0 && K._sceneParts(null, 'town', 1, 1).blocks.length === 0);
  const well = p.blocks[0], pond = p.blocks[1];
  check('5l. the well and the pond take up ground: the well its base, the pond all of itself', p.blocks.length === 2 && well.l < 400 && well.r > 400 && well.b > 420 && well.t < 420 && well.t > 420 - 60 && pond.t < 540 - 40 && pond.b >= 540);
  check('5m. the places to stop are outside what takes up ground', p.spots.every(s => !p.blocks.some(b => s.x > b.l && s.x < b.r && s.y > b.t && s.y < b.b)));
  const wall = { l: 100, r: 200, t: 100, b: 160 };
  const walk = (x, y, tx, ty) => { let n = 0, through = false; while (Math.hypot(tx - x, ty - y) > 3 && n++ < 2000) { const q = step(x, y, tx, ty, 3, [wall]); x = q.x; y = q.y; if (x > wall.l && x < wall.r && y > wall.t && y < wall.b) through = true; } return { n, through, x, y }; };
  const across = step ? walk(40, 130, 260, 130) : null, down = step ? walk(150, 40, 150, 220) : null, clear = step ? walk(40, 40, 260, 60) : null;
  check('5n. nobody walks through the well or the pond: they go round and still arrive', !!step && !across.through && across.n < 400 && Math.hypot(across.x - 260, across.y - 130) <= 3 && !down.through && down.n < 400 && Math.hypot(down.x - 150, down.y - 220) <= 3);
  check('5o. with nothing in the way the walk is the straight one', !!step && clear.n <= Math.ceil(Math.hypot(220, 20) / 3) + 1);
  check('5p. someone a thing was put down on top of walks out; a place inside one is still reached', !!step && (() => { const q = step(150, 130, 300, 130, 3, [wall]); return q.x === 153 && q.y === 130; })() && (() => { const q = step(98, 130, 150, 130, 3, [wall]); return q.x === 101; })());
  check('5q. the engine reads them when it surveys, and looks again when a decoration is placed, moved or removed', /global\.KWDecor\.sceneParts\(S\.area, W\(\), H\(\)\)/.test(E) && /S\.partsSig !== sigNow/.test(J) && /stepRound\(v\.x, v\.y, v\.tx, v\.ty, stepPx, S\.walls \|\| \[\]\)/.test(E));
  check('5r. someone who reaches a bench stays a while', /if \(v\.rest && v\.state === 'walk'\) \{ v\.rest = false; idle\(v, now, SIT_MS\[0\]/.test(E) && /rest: true/.test(J));
}

console.log('6. Kept small');
{
  const frames = CSS.match(/@keyframes kwd-[a-z-]+ \{[^\n]*/g) || [];
  check('6a. only transform moves; reduced motion stills the flame', frames.length === 1 && !/(left|top|width|height|margin):/.test(frames[0]) && /prefers-reduced-motion: reduce\) \{ #settlement-view \.kwd-glow\.kwd-on \{ animation: none; \} \}/.test(CSS));
  check('6b. nothing is redrawn while Home is closed or the tab is hidden', /if \(homeOpen\(\) && !doc\.hidden\) \{ paint\(false\); palette\(\); lamps\(\); \}/.test(J));
  check('6c. the script is on the page', /\/js\/decor\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
