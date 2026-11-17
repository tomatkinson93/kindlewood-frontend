'use strict';
// Photo mode (docs/HOME_SCENE.md Part F, F.10, step 24; js/photo.js).
// Nothing in the game changes.
//   node verify/photo_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/photo.js'), CSS = read('css/home-scene.css'), P = read('js/places.js'), H = read('index.html');

const w = { console, Date, Math, JSON, Number, String, Array, Object, Map, Promise, RegExp, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWPhoto;
const el = (tag, ...cls) => ({ tagName: tag, classList: { contains: c => cls.includes(c) } });

console.log('1. The picture');
{
  const order = K._paintOrder([{ z: 700, order: 3, n: 'front building' }, { z: -5, order: 9, n: 'sky' }, { z: 1050, order: 1, n: 'night' }, { z: 0, order: 2, n: 'puddle' }, { z: 700, order: 5, n: 'villager at the same depth' }, { z: 1060, order: 0, n: 'glow' }]).map(i => i.n);
  check('1a. painted in the page\'s own order: the sky, the ground, what stands (by depth), the night\'s tint, then the lights', order.join('|') === 'sky|puddle|front building|villager at the same depth|night|glow');
  check('1b. every part of the scene the painter knows is named', K.KIND.length === 15 && K._kindOf(el('IMG')) === 'img' && K._kindOf(el('CANVAS')) === 'canvas' && K._kindOf(el('svg')) === 'svg'
    && K._kindOf(el('DIV', 'kwv-sprite')) === 'sprite' && K._kindOf(el('DIV', 'sv-bd', 'sv-bd-sky')) === 'sky' && K._kindOf(el('DIV', 'sv-bd', 'sv-bd-trees')) === 'strip'
    && K._kindOf(el('DIV', 'sv-night')) === 'fill' && K._kindOf(el('DIV', 'kww-tint')) === 'fill' && K._kindOf(el('SPAN', 'kww-cloud')) === 'cloud' && K._kindOf(el('SPAN', 'kwa-smoke')) === 'puff'
    && K._kindOf(el('I', 'kwd-glow')) === 'glow' && K._kindOf(el('SPAN', 'kww-puddle')) === 'puddle' && K._kindOf(el('DIV', 'kwh-plate')) === null);
  check('1c. the evening\'s tint multiplies and the lights screen, as on the page', /if \(it\.blend === 'multiply' \|\| it\.blend === 'screen'\) ctx\.globalCompositeOperation = it\.blend;/.test(J));
  check('1d. what is hidden or faded right out is left out; fades in between are kept', /s\.display === 'none' \|\| s\.visibility === 'hidden' \|\| ch\.hidden/.test(J) && /if \(a < 0\.02\) continue;/.test(J) && /ctx\.globalAlpha = Math\.max\(0, Math\.min\(1, it\.alpha\)\);/.test(J));
  check('1e. a villager is the frame showing, facing the way they face', /ctx\.drawImage\(it\.img, -bx \* fx, -by \* fy, w \* fx, h \* fy, r\.left, r\.top, r\.width, r\.height\);/.test(J) && /el\.classList\.contains\('kwv-flip'\)/.test(J));
  check('1f. a drawing keeps the colours its classes give it', /for \(const p of \['fill', 'stroke', 'stroke-width'/.test(J));
  check('1g. everything is loaded first and painted in one pass, so nobody moves between two strokes', /await prepare\(items\);/.test(J) && /for \(const it of items\) draw\(ctx, it, box\);/.test(J));
  check('1h. one thing that will not paint does not lose the picture', /catch \(_\) \{ \/\* one thing that would not paint must not lose the picture \*\/ \}/.test(J));
  check('1i. rain and snow are in the picture, and the town\'s name is in a corner', /fall\(ctx, box, global\.KWWeather \? global\.KWWeather\.now\(\) : 'clear'\);/.test(J) && /caption\(ctx, box, g && g\.settlement && g\.settlement\.name\);/.test(J));
  check('1j. only what is on screen is photographed', /Math\.min\(global\.innerWidth, r\.right\)/.test(J) && /Math\.min\(global\.innerHeight, r\.bottom\)/.test(J));
}

console.log('2. Size and name');
{
  check('2a. as sharp as the screen, to at most twice', K._scaleFor(800, 600, 1) === 1 && K._scaleFor(800, 600, 2) === 2 && K._scaleFor(800, 600, 3) === 2 && K._scaleFor(800, 600, 0) === 1);
  const k = K._scaleFor(3840, 2000, 2);
  check('2b. a very large view is kept to about eight million pixels', k < 2 && k >= 1 && 3840 * 2000 * k * k <= 8000000 * 1.02, String(k));
  check('2c. the sky\'s colours are read from the page', JSON.stringify(K._gradientStops('linear-gradient(rgb(24, 34, 72) 0%, rgb(61, 79, 138) 18%, rgba(92, 109, 165, 0.5) 100%)')) === JSON.stringify([[0, 'rgb(24, 34, 72)'], [0.18, 'rgb(61, 79, 138)'], [1, 'rgba(92, 109, 165, 0.5)']]) && K._gradientStops('none').length === 0);
  check('2d. the file is named for the town and the day', K._fileName("Oak's Hollow!", new Date(2026, 10, 7)) === 'kindlewood-oak-s-hollow-2026-11-07.png' && K._fileName('', new Date(2026, 0, 1)) === 'kindlewood-town-2026-01-01.png' && K._fileName('../../etc', new Date(2026, 0, 1)) === 'kindlewood-etc-2026-01-01.png');
  check('2e. a phone shares the picture; a computer downloads it', /nav\.canShare\(\{ files: \[file\] \}\)/.test(J) && /a\.download = name;/.test(J) && /\(pointer: coarse\)/.test(J));
}

console.log('3. Photo mode');
{
  check('3a. a camera chip on Home, pressed while on', /key: 'photo',\s+label: 'Photo',\s+glyph: '📷'/.test(P) && /on: \(\) => !!\(global\.KWPhoto && global\.KWPhoto\.on\)/.test(P));
  check('3b. the interface over the scene steps aside', /body\.kw-photo #kw-moments, body\.kw-photo #kw-town-card, body\.kw-photo #settlement-view \.sv-header/.test(CSS) && /body\.kw-photo #settlement-view \.kwh-plate/.test(CSS) && /body\.kw-photo #kw-place-tools > :not\(\[data-tool="photo"\]\) \{ display: none !important; \}/.test(CSS));
  check('3c. four times of day and four skies to choose from', K.PHASES.map(p => p[0]).join() === 'dawn,day,dusk,night' && K.SKIES.map(p => p[0]).join() === 'clear,cloudy,rain,snow');
  check('3d. the choice is a look held on this device', /C\.preview\(S\.phase\)/.test(J) && /A\.preview\(S\.phase\)/.test(J) && /W\.preview\(S\.sky\)/.test(J));
  check('3e. Done, Esc, the chip or leaving Home puts the real hour and sky back', /S\.on = false; S\.phase = null; S\.sky = null;\n    look\(\);/.test(J) && /e\.key === 'Escape'/.test(J) && /if \(!\(e\.detail && e\.detail\.open\)\) close\(\);/.test(J));
  check('3f. nothing opens while framing a picture; the view still pans', /body\.kw-photo #settlement-view \.sv-slot, body\.kw-photo #settlement-view \.kwv-villager \{ pointer-events: none; \}/.test(CSS));
  check('3g. it leaves Build mode and closes any open menu first', /global\._svToggleBuildMode\(false\)/.test(J) && /global\.KWBuildingMenu\.close\(false, true\)/.test(J));
  check('3h. it never talks to the server', !/apiFetch|fetch\(/.test(J));
  check('3i. buttons are big enough for a finger, and the bar stays inside the window', /\.kwph-bar button \{ min-height: 36px; min-width: 44px/.test(CSS) && /bottom: calc\(12px \+ var\(--kwph-under, 0px\)\)/.test(CSS));
  check('3j. the script is on the page', /\/js\/photo\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
