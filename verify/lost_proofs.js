'use strict';
// A lost thing each day (docs/HOME_SCENE.md Part F, F.8, step 22; js/lost.js).
// The server decides what, whose, and whether it has been found (lib/lost.js
// there); the scene draws it and sends the find.
//   node verify/lost_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/lost.js'), CSS = read('css/home-scene.css'), E = read('js/villager-engine.js'), H = read('index.html'), RT = read('js/realtime.js'), SE = read('js/session.js');

const w = { console, Date, Math, JSON, Number, String, Array, Object, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWLost;
const ground = (area, r) => ({ x: 10 + r() * 80, y: 60 + r() * 35 });

console.log('1. Where it lies');
{
  const a = K._placeOf(12345, ground), b = K._placeOf(12345, ground);
  check('1a. the same seed gives the same place on every device', JSON.stringify(a) === JSON.stringify(b) && K.AREAS.includes(a.area), JSON.stringify(a));
  const areas = new Set(Array.from({ length: 300 }, (_, i) => K._areaOf(1000 + i * 7919)));
  check('1b. it can be in Town, the Neighbourhood or the Outskirts', areas.size === 3);
  check('1c. the area alone can be known without drawing the scene, and matches', K._areaOf(12345) === a.area);
  let asked = 0;
  const p = K._placeOf(777, ground, () => ++asked <= 3);
  const free = K._placeOf(777, ground);
  check('1d. a point under a building is passed over for the next seeded one', asked === 4 && (p.x !== free.x || p.y !== free.y) && p.area === free.area);
  let n = 0; K._placeOf(778, ground, () => { n++; return true; });
  check('1e. it gives up looking after a few tries (never a loop)', n === 14);
  check('1f. it sorts by depth like everything that stands', /b\.style\.zIndex = String\(Math\.max\(1, Math\.round\(p\.y \* 10\)\)\)/.test(J));
}

console.log('2. What the player is told');
{
  const t = { id: 1, kind: 'ribbon', label: 'a ribbon', icon: '🎀', owner_id: 5, owner_name: 'Ash Oak', seed: 12345, found: false };
  const where = { town: 'in Town', neighbourhood: 'in the Neighbourhood', outskirts: 'in the Outskirts' }[K._areaOf(12345)];
  check('2a. the owner\'s thought says what and roughly where', K._hintFor(t, 5) === `Has lost a ribbon somewhere ${where}.`, K._hintFor(t, 5));
  check('2b. nobody else thinks about it, and nor does the owner once it is back', K._hintFor(t, 6) === null && K._hintFor({ ...t, found: true }, 5) === null && K._hintFor(null, 5) === null);
  check('2c. the thought line reads it (after hunger and a waiting moment)', /if \(ctx\.moment\) return 'Has something to ask you\.';\n    if \(ctx\.lost\) return ctx\.lost;/.test(E) && /global\.KWLost\.hintFor\(c\.id\)/.test(E));
  check('2d. a line for the news, lost and found', K._line(t) === `Ash has lost a ribbon somewhere ${where}.` && K._line({ ...t, found: true }) === 'Ash has a ribbon back.' && K._line(null) === '');
  check('2e. what finding it gave, in words', K._rewardLine({ ...t, reward: { wealth: 5, happiness: 3 } }) === 'Ash +3 happiness · +5 wealth' && K._rewardLine({ ...t, reward: { food: 15, happiness: 0 } }) === '+15 food');
}

console.log('3. The server decides');
{
  check('3a. the thing comes from the server and the find is sent to it', /apiFetch\('\/api\/lost'\)/.test(J) && /apiFetch\('\/api\/lost\/return', \{ method: 'POST' \}\)/.test(J));
  check('3b. nothing is given here: the reward shown is the one the server returned', /take\(t\);/.test(J) && !/happiness \+=|wealth \+=|food \+=/.test(J));
  check('3c. a refusal (found on another device, or the day turned) just asks again', /toast\(d\.error \|\| 'That did not work\. Try again\.', 'error'\);\n        load\(\);/.test(J));
  check('3d. another device\'s find arrives live, and coming back to the tab asks again', /lost\(ev\) \{ if \(global\.KWLost\) global\.KWLost\.onEvent\(ev\); \}/.test(RT) && /global\.KWLost\.load\(\)/.test(SE));
  check('3e. one click cannot send two finds', /if \(S\.busy \|\| !S\.thing \|\| S\.thing\.found\) return;/.test(J));
  check('3f. the engine still never calls the server', !/apiFetch|fetch\(/.test(E.replace(/\/\/[^\n]*/g, '')));
}

console.log('4. In the scene');
{
  check('4a. drawn only in its own area, and only until it is found', /if \(!t \|\| t\.found \|\| !L/.test(J) && /if \(areaOf\(t\.seed\) !== area\) \{ if \(old\) old\.remove\(\); return; \}/.test(J));
  check('4b. a real button with a name, big enough for a finger', /b\.type = 'button'/.test(J) && /aria-label/.test(J) && /\.kwl-thing \{[^}]*pointer-events: auto; width: 44px; height: 44px/.test(CSS));
  check('4c. hidden in Build mode', /\.sv-build-mode \.kwl-thing \{ display: none; \}/.test(CSS));
  check('4d. the owner cheers when it comes back, if they are in the scene', /C\.playPraise\(t\.owner_id, t\.reward\.happiness\)/.test(J) && /floatAt: \(x, y, text, tone\) => floater\(x, y, text, tone\)/.test(E));
  const frames = CSS.match(/@keyframes kwl-[a-z-]+ \{[^\n]*/g) || [];
  check('4e. only transform and opacity move; reduced motion stills it', frames.length === 2 && !frames.some(k => /(left|top|width|height|margin):/.test(k)) && /prefers-reduced-motion: reduce\) \{ #settlement-view \.kwl-icon, #settlement-view \.kwl-glint \{ animation: none; \}/.test(CSS));
  check('4g. it is its picture once the art is in the props manifest (lost_<kind>), and is redrawn when the picture arrives', /global\.KWGround\.picture\('lost_' \+ t\.kind\)/.test(J) && /!!old\.querySelector\('\.kwl-pic'\) === hasPic/.test(J));
  check('4f. the script is on the page', /\/js\/lost\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
