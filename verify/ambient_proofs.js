'use strict';
// Small life and working buildings (docs/HOME_SCENE.md Part F, F.6 and F.7,
// step 20; js/home-ambient.js). Looks only.
//   node verify/ambient_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/home-ambient.js'), CSS = read('css/home-scene.css'), HS = read('js/home-scene.js'), E = read('js/villager-engine.js'), H = read('index.html');
const M = JSON.parse(read('assets/images/scene_v2/buildings/manifest.v2.json'));

const w = { console, Date, Math, JSON, Number, String, Array, Object, setInterval() { return 1; } }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWAmbient;

console.log('1. Small life');
{
  const k = (p, s, wth) => K._kindsFor(p, s, wth);
  check('1a. smoke at any hour; fireflies in the dark, not in winter or the wet', k('day', 'summer').smoke && k('night', 'summer').fireflies && k('dusk', 'spring').fireflies && !k('day', 'summer').fireflies && !k('night', 'winter').fireflies && !k('night', 'summer', 'rain').fireflies);
  check('1b. butterflies by day in spring and summer, in the dry', k('day', 'spring').butterflies && k('dawn', 'summer').butterflies && !k('day', 'autumn').butterflies && !k('night', 'summer').butterflies && !k('day', 'summer', 'rain').butterflies);
  check('1c. on the wind: leaves in autumn, blossom in spring, seeds in summer, nothing in winter, rain or the dark', k('day', 'autumn').drift === 'leaf' && k('day', 'spring').drift === 'blossom' && k('day', 'summer').drift === 'seed' && /\.kwa-blossom \{/.test(CSS) && k('day', 'winter').drift === null && k('day', 'autumn', 'rain').drift === null && k('night', 'autumn').drift === null);
  check('1d. no birds, cats or pets (the settlers are animals themselves)', !/kwa-(bird|cat|dog|pet)/.test(J + CSS) && /No birds, cats or pets/.test(J));
  check('1e. a home shows life when someone is in, and in the evening and at night when someone lives there; an empty home never', K._livedIn({ inside: 1 }) && K._livedIn({ home: true, phase: 'night' }) && !K._livedIn({ home: true, phase: 'day' }) && !K._livedIn({ home: true, dark: true, phase: 'night' }) && !K._livedIn({ phase: 'night' }));
  const pts = Object.entries(M).filter(([, v]) => v && Array.isArray(v.smoke));
  check('1f. where the smoke comes from is in each building\'s manifest entry, inside its picture', pts.length >= 9 && pts.every(([, v]) => v.smoke.every(p => p[0] >= 0 && p[0] <= v.w && p[1] >= 0 && p[1] <= v.h)) && /smoke: \(Array\.isArray\(e\.smoke\) \? e\.smoke : \[\]\)\.map\(pt\)\.filter\(Boolean\), fire: pt\(e\.fire\), dust: pt\(e\.dust\)/.test(HS), pts.map(p => p[0]).join());
  check('1g. the four house styles and the Neighbourhood\'s door have theirs', ['house_thatch', 'house_timber', 'house_stone', 'house_burrow', 'neighbourhood'].every(k => M[k] && M[k].smoke && M[k].smoke.length));
}

console.log('2. Working buildings');
{
  check('2a. the forge mouth glows and throws sparks while someone works it', M.smithy.fire && M.smithy.fire.length === 2 && /if \(n > 0 && !g\)/.test(J) && /kwa-forge/.test(J) && /kwa-spark/.test(J) && /\.kwa-forge \{[^}]*mix-blend-mode: screen/.test(CSS));
  check('2b. the Workshop puffs sawdust', M.workshop.dust && /b\.a\.dust && n > 0/.test(J) && /\.kwa-dust \{/.test(CSS));
  check('2c. the Tavern\'s windows flicker in the evening with someone in', /b\.btn\.classList\.toggle\('kwa-flicker', n > 0 && \(ph === 'dusk' \|\| ph === 'night'\)\)/.test(J) && /\.kwa-flicker \.kwh-lit \{ animation: kwa-flicker/.test(CSS));
  check('2d. the Market draws a few more people around midday', /hr >= 12\.5 && hr < 15 && S\.rand\(\) < 0\.28/.test(E) && /doorOf\('market'\)/.test(E));
  check('2e. a broken building shows no life', /const n = b\.broken \? 0 : inside\(b\.key\), alive = !b\.broken &&/.test(J));
  check('2f. each has a quiet sound that grows as the view nears it and follows the sound-effects volume', K._nearness(500, { left: 0, width: 1000 }) === 1 && K._nearness(1000, { left: 0, width: 1000 }) === 0.5 && K._nearness(1700, { left: 0, width: 1000 }) === 0
    && Object.keys(K.SOUNDS).join() === 'smithy,tavern,market,workshop' && /global\.getSfxVolume\(\)/.test(J) && /a\.loop = true/.test(J));
  check('2g. a sound file that is not there yet leaves the scene quiet (no error, no retry storm)', /a\.addEventListener\('error', \(\) => \{ s\.missing = true; \}\)/.test(J) && /if \(s && s\.missing\) return;/.test(J));
}

console.log('3. Kept small');
{
  check('3a. at most 28 things in the air at once', K.MAX === 28 && /total < MAX/.test(J));
  check('3b. nothing while Home is closed, the tab is hidden, or under reduced motion', /homeOpen\(\) && !doc\.hidden && !reduced\(\) \? layer\(\) : null/.test(J) && /prefers-reduced-motion: reduce\) \{ #settlement-view \.kwa, #settlement-view \.kwa-forge \{ display: none; \}/.test(CSS));
  check('3c. only transform and opacity move', (CSS.match(/@keyframes kwa-[a-z-]+ \{[^\n]*/g) || []).length >= 9 && !(CSS.match(/@keyframes kwa-[a-z-]+ \{[^\n]*/g) || []).some(k => /(left|top|width|height|margin):/.test(k)));
  check('3d. looks only: it never calls the server', !/apiFetch|fetch\(/.test(J));
  check('3e. the script is on the page after the engine', H.indexOf('/js/home-ambient.js?v=') > H.indexOf('/js/villager-engine.js?v='));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
