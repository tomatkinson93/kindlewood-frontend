'use strict';
// Weather in the Home scene (docs/HOME_SCENE.md Part F, F.5, step 21;
// js/home-weather.js). The server rolls it (lib/weather.js there); the scene
// only draws it.
//   node verify/weather_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/home-weather.js'), CSS = read('css/home-scene.css'), E = read('js/villager-engine.js'), H = read('index.html'), A = read('js/home-ambient.js');

const w = { console, Date, Math, JSON, Number, String, Array, Object, Uint8ClampedArray, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWWeather;
const dawn = Date.UTC(2026, 10, 17, 9, 0, 0), HOUR = 3600e3;
const day = { day: 20774, today: 'rain', spells: ['rain', 'cloudy', 'rain', 'clear'], starts: new Date(dawn).toISOString(), spell_ms: 6 * HOUR, before: 'snow' };

console.log('1. The spell from the clock');
{
  const at = (h) => K._at(day, dawn + h * HOUR);
  check('1a. four six-hour spells from dawn', at(0.1).now === 'rain' && at(6.1).now === 'cloudy' && at(12.1).now === 'rain' && at(18.1).now === 'clear');
  check('1b. it knows the spell before, back into yesterday', at(0.1).was === 'snow' && at(6.1).was === 'rain' && at(18.1).was === 'rain');
  check('1c. past the day\'s end with no newer roll, the last spell holds; before its start, yesterday\'s last', at(30).now === 'clear' && at(-1).now === 'snow');
  check('1d. a town with no weather yet is clear', K._at(null, dawn).now === 'clear' && K._at({ spells: [] }, dawn).now === 'clear' && K._at({ spells: ['fog'], starts: day.starts }, dawn + 1).now === 'clear');
  check('1e. the weather comes with the town, and the scene never asks the server for it', /g\.settlement \? g\.settlement\.weather : null/.test(J) && !/apiFetch|fetch\(/.test(J));
}

console.log('2. What is drawn');
{
  const L = K._look;
  check('2a. a few clouds on a clear day, many on a grey or wet one, fewer on a phone', L('clear', 'clear').clouds === 3 && L('cloudy', 'clear').clouds === 9 && L('rain', 'clear').clouds === 10 && L('rain', 'clear', 390).clouds === 6);
  check('2b. rain and snow fall; a clear or cloudy sky drops nothing', L('rain', 'clear').fall === 'rain' && L('snow', 'clear').fall === 'snow' && L('cloudy', 'rain').fall === null && L('clear', 'clear').fall === null);
  check('2c. puddles while it rains and for the spell after', L('rain', 'clear').puddles && L('cloudy', 'rain').puddles && !L('cloudy', 'cloudy').puddles && !L('snow', 'clear').puddles);
  check('2d. snow lies while it falls and for the spell after', L('snow', 'clear').lying && L('clear', 'snow').lying && !L('rain', 'rain').lying);
  check('2e. a wash over the world on a grey or wet day, under the night\'s tint, and not a second blend', L('clear', 'rain').tint === null && L('rain', 'x').tint === 'rain' && /\.kww-tint \{[^}]*z-index: 1049/.test(CSS) && !/\.kww-tint \{[^}]*mix-blend-mode/.test(CSS));
  check('2f. clouds sit over the sky and behind the mountains', /\.kww-clouds \{[^}]*z-index: -5/.test(CSS) && /\.sv-bd-mountains \{[^}]*z-index: -4/.test(CSS));
  check('2g. rain and snow are over the view, not the world, and take no clicks', /view\.insertBefore\(fall, sc \? sc\.nextSibling : null\)/.test(J) && /\.kww-fall \{[^}]*pointer-events: none/.test(CSS));
  check('2h. puddles are placed from the day\'s seed, so they stay put and every device agrees', /seeded\(\(\(w && w\.day\) \|\| 1\) \* 31 \+ area\.length \* 7\)/.test(J) && /\.kww-puddle \{[^}]*z-index: 0/.test(CSS));
  check('2i. a puddle is its picture once the art is in the props manifest (puddle_1 to puddle_3), and is redrawn when the picture arrives', /\['puddle_1', 'puddle_2', 'puddle_3'\]\.map\(k => G\.picture\(k\)\)\.filter\(Boolean\)/.test(J) && /have\[0\]\.classList\.contains\('kww-puddle-pic'\) !== pics/.test(J));
}

console.log('3. Snow caps');
{
  // A 12 × 16 picture: a roof peak in the middle, a flat part to the right, nothing on the left.
  const W = 12, Hh = 16, solid = (x, y) => (x >= 3 && x <= 6 ? y >= Math.abs(x - 4) + 1 : x >= 7 && x <= 10 ? y >= 5 : false);
  const a = K._capAlpha(W, Hh, (x, y) => (solid(x, y) ? 255 : 0), 4), at = (x, y) => a[y * W + x];
  check('3a. snow sits on the first solid pixel of each column', at(4, 1) === 255 && at(4, 0) === 0 && at(8, 5) === 255 && at(8, 4) === 0);
  check('3b. nothing where the picture is empty', [0, 1, 2, 11].every(x => Array.from({ length: Hh }, (_, y) => at(x, y)).every(v => v === 0)));
  check('3c. it is a few pixels deep and fades at its lower edge', at(8, 12) === 0 && Array.from({ length: Hh }, (_, y) => at(8, y)).some(v => v > 0 && v < 255));
  check('3d. worked out once per picture, and only when snow first lies', /a\.classList\.add\('kww-capped'\)/.test(J) && /if \(k\.lying\) caps\(view\)/.test(J) && /\.kww-lying \.kww-cap \{ opacity: 1; \}/.test(CSS));
}

console.log('4. Villagers and small life');
{
  check('4a. villagers hurry and stand about less in the wet', /const WET = \{ SPEED: 1\.25, IDLE: 0\.5 \}/.test(E) && /\(inTheWet\(\) \? WET\.SPEED : 1\) \* dt \/ 1000/.test(E) && /\(inTheWet\(\) \? WET\.IDLE : 1\)\)/.test(E));
  check('4b. the engine reads the weather; it still never calls the server', /global\.KWWeather && global\.KWWeather\.wet\(\)/.test(E));
  check('4c. small life follows the weather: no fireflies, butterflies or drifting things in the wet', /global\.KWWeather && global\.KWWeather\.now \? global\.KWWeather\.now\(\) : 'clear'/.test(A));
}

console.log('5. Kept small');
{
  const frames = CSS.match(/@keyframes kww-[a-z-]+ \{[^\n]*/g) || [];
  check('5a. only transform moves', frames.length >= 5 && !frames.some(k => /(left|top|width|height|margin|background-position):/.test(k)));
  check('5b. reduced motion: nothing falls and the clouds stand still; the wash, caps and puddles stay', /if \(k\.fall && !still\)/.test(J) && /prefers-reduced-motion: reduce\) \{ #settlement-view \.kww-cloud \{ animation-play-state: paused; \} #settlement-view \.kww-fall \{ display: none; \} \}/.test(CSS));
  check('5c. nothing while Home is closed or the tab is hidden', /!homeOpen\(\) \|\| doc\.hidden\) return;/.test(J));
  check('5d. one sheet of rain on a phone', /max-width: 700px\) \{ #settlement-view \.kww-far \{ display: none; \} \}/.test(CSS));
  check('5e. photo mode and tests can ask for another sky', typeof K.preview === 'function' && K.KINDS.join() === 'clear,cloudy,rain,snow' && K.label('rain') === 'Rain');
  check('5f. the script is on the page', /\/js\/home-weather\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
