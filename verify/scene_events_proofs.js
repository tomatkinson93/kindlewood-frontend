'use strict';
// Events in the scene (docs/HOME_SCENE.md Part F, F.12, step 26;
// js/scene-events.js). They are ordinary moments: the server starts them,
// times them and decides every outcome (lib/moments_scene.js there).
//   node verify/scene_events_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/scene-events.js'), MJ = read('js/moments.js'), CSS = read('css/home-scene.css'), E = read('js/villager-engine.js'), H = read('index.html');

const w = { console, Date, Math, JSON, Number, String, Array, Object, Map, Set, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWSceneEvents;

console.log('1. Ordinary moments, shown in the scene');
{
  const list = [{ id: 1, subject: { scene: 'fire', building: 'tavern' } }, { id: 2, subject: { citizen_ids: [3] } }, { id: 3, subject: { scene: 'cart' } }, { id: 4, subject: { scene: 'lost_child', child_id: 9 } }, { id: 5, subject: { scene: 'dragon' } }, null];
  check('1a. the scene shows the moments that say so: a fire, a lost child, a runaway cart', K._sceneMoments(list).map(m => m.id).join() === '1,3,4' && K._sceneMoments(null).length === 0);
  check('1b. they are read from the moments the game already has; nothing else is asked of the server', /global\.KWMoments\.list\(\)/.test(J) && !/apiFetch|fetch\(/.test(J));
  check('1c. an answer from the scene goes the same way as one from the dialogue', /global\.KWMoments\.answer\(m\.id, key\)/.test(J) && /async function answer\(id, key\)/.test(MJ) && /choose: key => answer\(m\.id, key\)/.test(MJ));
  check('1d. a click on the child finds them, a click on the cart stops it, a click on the fire opens the choices', K._clickChoice('lost_child') === 'found' && K._clickChoice('cart') === 'stop' && K._clickChoice('fire') === null && /global\.KWMoments\.open\(m\.id\)/.test(J));
  check('1e. the option that is only in the scene is not offered in the dialogue, which says to look instead', /options: \(m\.options \|\| \[\]\)\.filter\(o => !o\.scene\)/.test(MJ) && /global\.KWSceneEvents\.hint\(m\)/.test(MJ));
  check('1f. one answer at a time, and the outcome shown is the server\'s', /if \(S\.busy \|\| !global\.KWMoments/.test(J) && /toast\(`\$\{m\.icon\} \$\{r\.outcome\}`, 'success'\)/.test(J));
  check('1g. when a moment is over (answered anywhere, or timed out) its picture goes', /if \(keep\.has\(id\)\) return;/.test(J) && /el\.remove\(\); S\.out\.delete\(id\);/.test(J));
}

console.log('2. A fire');
{
  check('2a. flames and smoke sit on the building that is burning, in whichever part of Home it stands', /\.sv-building\[data-kwh="\$\{m\.subject\.building\}"\] \.kwh-art/.test(J) && /\.kwe-fire \{[^}]*z-index: 3/.test(CSS));
  check('2b. an alarm to press, with a name for screen readers', /class="kwe-alarm"/.test(J) && /Fire at the \$\{m\.subject\.building\.replace\(\/_\/g, ' '\)\}! Choose what to do/.test(J));
  const pts = K._chain({ x: 0, y: 0 }, { x: 100, y: 40 }, 4);
  check('2c. a bucket chain is four places in a line from the water to the fire', pts.length === 4 && pts[0].x === 12.5 && pts[3].x === 87.5 && pts[1].y === 15);
  check('2d. the chain starts at the well or the pond if the player has placed one', /:scope > \.kwd-well, :scope > \.kwd-pond/.test(J) && /C\.playScript\('buckets-' \+ m\.id \+ '-' \+ i/.test(J));
  check('2e. after the answer the fire dies down (slower with a chain) instead of vanishing', /S\.out\.set\(String\(m\.id\), Date\.now\(\) \+ \(d\.choice === 'buckets' \? 6500 : 1200\)\)/.test(J) && /\.kwe-fire\.kwe-dying \{ opacity: 0;/.test(CSS));
}

console.log('3. A lost child');
{
  const areaOf = seed => ['town', 'neighbourhood', 'outskirts'][seed % 3];
  check('3a. the dialogue says roughly where to look', K._hint({ subject: { scene: 'lost_child', seed: 2 } }, areaOf) === 'Or look for them yourself: they were last seen in the Outskirts.' && K._hint({ subject: { scene: 'fire' } }, areaOf) === '' && K._hint({ subject: { scene: 'lost_child', seed: 1 } }, null) === 'Or look for them yourself.');
  let got = null;
  const p = K._hidingPlace(77, (seed, g, c) => { got = [seed, typeof g, typeof c]; return { area: 'town', x: 1, y: 2 }; }, () => ({}), () => false);
  check('3b. the hiding place comes from the moment\'s seed, by the same rule as a lost thing: the same on every device', p.area === 'town' && got[0] === 77 && got[1] === 'function' && /LO\._areaOf\(m\.subject\.seed\) !== area/.test(J));
  check('3c. not under a building, a nameplate, a decoration or the merchant\'s cart', /\.kwh-art, :scope > \.sv-slot:not\(\[hidden\]\) \.kwh-plate, :scope > \.kwd-item, :scope > \.kwm-cart/.test(J));
  check('3d. the child who is hiding is not also walking about', /\.kwv-cit\[data-cid="\$\{Number\(id\)\}"\]\{visibility:hidden!important/.test(J) && /hideChildren\(\[\]\)/.test(J));
  check('3e. the parent\'s thought says they are looking', /Looking everywhere for a lost child\./.test(J) && /global\.KWSceneEvents\.thoughtFor\(c\.id\)/.test(E));
  check('3f. a real button, big enough for a finger', /\.kwe-child \{ width: 54px; height: 40px;/.test(CSS) && /Something is hiding in this bush\. Look/.test(J));
}

console.log('4. A runaway cart');
{
  check('4a. it rolls a short way up and down a lane in Town, slowly enough to catch', /sc === 'cart' && area === 'town'/.test(J) && /Math\.max\(220, Math\.min\(460,/.test(J) && /animation: kwe-run 9s ease-in-out infinite alternate/.test(CSS));
  check('4b. the cart itself takes the click, wherever it has rolled to', /\.kwe-cart \{[^}]*pointer-events: none; \}/.test(CSS) && /\.kwe-roll \{[^}]*pointer-events: auto/.test(CSS));
  check('4c. where it runs comes from the moment\'s seed', /Number\(m\.subject\.seed\) % 9/.test(J) && /Number\(m\.subject\.seed\) % 37/.test(J));
}

console.log('5. Kept small');
{
  const frames = CSS.match(/@keyframes kwe-[a-z-]+ \{[^\n]*/g) || [];
  check('5a. only transform and opacity move', frames.length >= 7 && !frames.some(k => /(left|top|width|height|margin):/.test(k)));
  check('5b. reduced motion stills them; the smoke stays as a mark', /prefers-reduced-motion: reduce\) \{ #settlement-view \.kwe-flames/.test(CSS) && /\.kwe-smoke \{ animation: none; opacity: 0\.7;/.test(CSS));
  check('5c. hidden in Build mode; photo mode keeps the fire and drops the alarm', /\.sv-build-mode \.kwe \{ display: none; \}/.test(CSS) && /body\.kw-photo #settlement-view \.kwe-alarm \{ display: none !important; \}/.test(CSS));
  check('5d. nothing is drawn while Home is closed or the tab is hidden', /if \(homeOpen\(\) && !doc\.hidden\) paint\(\);/.test(J));
  check('5e. the engine still never calls the server', !/apiFetch|fetch\(/.test(E.replace(/\/\/[^\n]*/g, '')));
  check('5f. the script is on the page', /\/js\/scene-events\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
