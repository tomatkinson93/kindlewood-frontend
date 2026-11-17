'use strict';
// The town crier (docs/HOME_SCENE.md Part F, F.11, step 24; js/crier.js).
// It reads only.
//   node verify/crier_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/crier.js'), CSS = read('css/home-scene.css'), E = read('js/villager-engine.js'), BM = read('js/building-menu.js'), SV = read('js/settlement-view.js'), H = read('index.html');

const w = { console, Date, Math, JSON, Number, String, Array, Object, setInterval() { return 1; }, setTimeout() {} }; w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWCrier;
const NOW = Date.UTC(2026, 10, 17, 20), HOUR = 3600e3, at = h => new Date(NOW - h * HOUR).toISOString();

console.log('1. The news');
{
  const entries = [
    { kind: 'town', text: 'The Farm is finished.', at: at(1) }, { kind: 'birth', text: 'A child was born.', at: at(2) },
    { kind: 'death', text: 'Old Ash died.', at: at(5) }, { kind: 'quest', text: 'A quest came home.', at: at(20) },
    { kind: 'town', text: 'Too old.', at: at(30) }, { kind: 'town', text: '', at: at(1) },
  ];
  const n = K._newsOf({ entries, now: NOW, seenAt: NOW - 3 * HOUR, weather: 'Rain all day.', merchant: 'A travelling merchant is in town until dawn.', lost: 'Ash has lost a ribbon somewhere in Town.', building: ['Tavern: 40% built'], upkeep: 'One builder short.', charm: 'Charm 21.' });
  check('1a. today: the weather, the merchant, anything lost, what is being built, upkeep and charm', n.today.map(t => t.text).join('|') === 'Rain all day.|A travelling merchant is in town until dawn.|Ash has lost a ribbon somewhere in Town.|Tavern: 40% built|One builder short.|Charm 21.');
  check('1b. who was born and who died have their own heading', n.lives.map(e => e.kind).join() === 'birth,death');
  check('1c. the rest of the last day\'s chronicle, newest first; older than a day is left out', n.rest.map(e => e.text).join('|') === 'The Farm is finished.|A quest came home.');
  check('1d. what is new since the player last looked is marked and counted', n.fresh === 2 && n.rest[0].fresh && n.lives[0].fresh && !n.lives[1].fresh && !n.rest[1].fresh);
  check('1e. each line says how long ago', n.rest[0].when === '1 h ago' && n.rest[1].when === '20 h ago');
  check('1f. nothing known: nothing shown, and a quiet day says so', K._newsOf({ entries: [], now: NOW }).today.length === 0 && /A quiet day/.test(K._html(K._newsOf({ entries: [], now: NOW }))));
  const html = K._html(n);
  check('1g. three headings, the new lines with a mark, and no markup from the text', (html.match(/class="kwcr-h"/g) || []).length === 3 && (html.match(/kwcr-dot/g) || []).length === 2 && !/<script/.test(K._html(K._newsOf({ entries: [{ kind: 'town', text: '<script>x</script>', at: at(1) }], now: NOW }))));
  check('1h. at most 14 lines of the rest', K._newsOf({ entries: Array.from({ length: 30 }, (_, i) => ({ kind: 'town', text: 'Line ' + i, at: at(1) })), now: NOW }).rest.length === 14);
}

console.log('2. The weather in a line');
{
  const L = k => ({ clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow' }[k]);
  check('2a. the same all day', K._weatherLine({ spells: ['clear', 'clear', 'clear', 'clear'] }, L) === 'Clear all day.');
  check('2b. spells are joined: "Morning to afternoon: rain · Evening to night: cloudy."', K._weatherLine({ spells: ['rain', 'rain', 'cloudy', 'cloudy'] }, L) === 'Morning to afternoon: rain · Evening to night: cloudy.');
  check('2c. four different spells read in order', K._weatherLine({ spells: ['clear', 'cloudy', 'rain', 'cloudy'] }, L) === 'Morning: clear · Afternoon: cloudy · Evening: rain · Night: cloudy.');
  check('2d. no weather: no line', K._weatherLine(null, L) === '' && K._weatherLine({ spells: [] }, L) === '');
}

console.log('3. In the scene');
{
  check('3a. the crier is out at dawn and at dusk', K._outAt('dawn') && K._outAt('dusk') && !K._outAt('day') && !K._outAt('night'));
  check('3b. one free villager (an elder if there is one out) walks to the Guild Hall and stands with a bell', /C\.playScript\('crier', \[\{ door: 'guild_hall', dx: -96, dy: 34 \}, \{ wait: STAND_MS, say: mark \}\], c => c\.stage === 'elder' \|\| !!c\.elder, \{ onClick: open/.test(J));
  check('3c. the bell carries a mark when there is something new', /const fresh = gather\(\)\.fresh > 0, mark = fresh \? '🔔❗' : '🔔';/.test(J) && /C\.scriptSay\('crier', mark\)/.test(J));
  check('3d. only in Town, not in Build mode, and they go when the hour passes', /outAt\(C\.phase\) && inTown && !\(global\._svIsBuildMode && global\._svIsBuildMode\(\)\)/.test(J) && /if \(S\.on && C\.stopScript\) C\.stopScript\('crier'\);/.test(J));
  check('3e. a click on them opens the news instead of their menu', /if \(v\.act && v\.act\.onClick\) \{ if \(M\.v\) deselect\(true, true\); sound\('on'\); try \{ v\.act\.onClick\(v\.id\); \}/.test(E));
  check('3f. a screen reader hears who they are, and their own name comes back after', /v\.el\.setAttribute\('aria-label', opts\.label\)/.test(E) && /if \(v\.act && v\.act\.was\) v\.el\.setAttribute\('aria-label', v\.act\.was\);/.test(E));
  check('3g. no Guild Hall: no crier (the script needs its door)', /const d = doorOf\(st\.door\);\n      if \(!d\) return null;/.test(E));
  check('3h. the same news is on the Guild Hall\'s menu at any hour', /extra: o\.id === 'guild_hall' && window\.KWCrier \? \[\{ key: 'news', icon: '📜', label: "Today's news"/.test(SV) && /for \(const x of o\.extra \|\| \[\]\)/.test(BM) && /what\.indexOf\('x-'\) === 0/.test(BM));
}

console.log('4. It reads only');
{
  check('4a. it never writes to the server', !/method: 'POST'|method: 'PUT'|method: 'DELETE'/.test(J) && !/apiFetch\(/.test(J));
  check('4b. "seen" is kept on this device and set when the news is opened', /global\.localStorage\.setItem\(SEEN_KEY, String\(t\)\)/.test(J) && /markSeen\(clock\(\)\);/.test(J));
  check('4c. it asks for the freshest chronicle before it reads it out', /await global\.KWLifeScenes\.read\(\)/.test(J));
  check('4d. the bell\'s swing is transform only, and still under reduced motion', /@keyframes kwcr-ring \{[^\n]*transform/.test(CSS) && !/@keyframes kwcr-ring \{[^\n]*(left|top|margin):/.test(CSS) && /prefers-reduced-motion: reduce\) \{ #settlement-view \.kwv-asks \.kwv-say \{ animation: none; \} \}/.test(CSS));
  check('4e. the script is on the page', /\/js\/crier\.js\?v=h[0-9a-f]+/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
