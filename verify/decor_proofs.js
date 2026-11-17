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
}

console.log('3. Build mode');
{
  check('3a. the bar appears with Build mode and goes with it', /if \(window\.KWDecor\) KWDecor\.buildModeChanged\(\);/.test(SV) && /if \(!building\(\) \|\| !S\.data\) \{ if \(bar\) bar\.remove\(\);/.test(J));
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

console.log('6. Kept small');
{
  const frames = CSS.match(/@keyframes kwd-[a-z-]+ \{[^\n]*/g) || [];
  check('6a. only transform moves; reduced motion stills the flame', frames.length === 1 && !/(left|top|width|height|margin):/.test(frames[0]) && /prefers-reduced-motion: reduce\) \{ #settlement-view \.kwd-glow\.kwd-on \{ animation: none; \} \}/.test(CSS));
  check('6b. nothing is redrawn while Home is closed or the tab is hidden', /if \(homeOpen\(\) && !doc\.hidden\) \{ paint\(false\); palette\(\); lamps\(\); \}/.test(J));
  check('6c. the script is on the page', /\/js\/decor\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
