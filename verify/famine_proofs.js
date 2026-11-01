'use strict';
// The food warning banner (js/famine.js) and its Dev Tools previews.
//   node verify/famine_proofs.js
//   1. Each server state draws the right banner; "ok" hides it.
//   2. Dev Tools: preview any state, it survives a sync, Back to live restores.
//   3. Wiring: loaded, placed over the map, called on load and every sync.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const banner = { className: '', innerHTML: '' }, status = { textContent: '' };
const w = { console, document: { getElementById: id => (id === 'famine-banner' ? banner : id === 'cheat-famine-status' ? status : null) } };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/famine.js'), w);

console.log('1. Server states');
w.renderFamineBanner({ state: 'ok' });
check('1a. all fed: no banner', banner.className === 'famine-banner' && banner.innerHTML === '');
w.renderFamineBanner({ state: 'low', hours_to_empty: 30 });
check('1b. dwindling: amber, hours left', /famine-low open/.test(banner.className) && /Stores dwindling/.test(banner.innerHTML) && /~30h/.test(banner.innerHTML));
w.renderFamineBanner({ state: 'critical', hours_to_empty: 0.5 });
check('1c. critical: "less than an hour"', /famine-critical/.test(banner.className) && /less than an hour/.test(banner.innerHTML));
w.renderFamineBanner({ state: 'famine', unfed_count: 2, starving_count: 1 });
check('1d. famine: who is hungry and starving, what to do', /famine-famine/.test(banner.className) && /2 going hungry, 1 starving/.test(banner.innerHTML) && /Assign farmers/.test(banner.innerHTML));
check('1e. clicking it opens the food breakdown', /openResourceModal\(\\?'food\\?'\)/.test(banner.innerHTML));
check('1f. live banners say nothing about previews', !/Preview/.test(banner.innerHTML));

console.log('2. Dev Tools previews');
w.renderFamineBanner({ state: 'ok' });
w.KWFamineDev.preview('critical');
check('2a. preview critical on a fed town: drawn, marked Preview', /famine-critical/.test(banner.className) && /famine-banner-preview/.test(banner.innerHTML));
check('2b. the status line says it is a preview, and the real state', /Previewing "critical"/.test(status.textContent) && /real state: ok/.test(status.textContent));
w.renderFamineBanner({ state: 'low', hours_to_empty: 20 });
check('2c. a server sync doesn\'t wipe the preview…', /famine-critical/.test(banner.className));
w.KWFamineDev.preview('famine');
check('2d. famine preview', /famine-famine/.test(banner.className) && /3 going hungry, 1 starving/.test(banner.innerHTML));
w.KWFamineDev.preview('ok');
check('2e. "All fed" preview hides it', banner.innerHTML === '' && w.KWFamineDev.current() === 'ok');
w.KWFamineDev.live();
check('2f. Back to live: the latest server state (dwindling, from the sync)', /famine-low/.test(banner.className) && !/Preview/.test(banner.innerHTML)
  && w.KWFamineDev.current() === null && /live state: low/.test(status.textContent));
w.KWFamineDev.preview('nonsense');
check('2g. unknown states are ignored', w.KWFamineDev.current() === null);

console.log('3. Wiring');
const html = read('index.html');
check('3a. famine.js and famine.css load', /<script defer src="\/js\/famine\.js\?v=\w+"><\/script>/.test(html) && /href="\/css\/famine\.css\?v=\w+"/.test(html));
check('3b. the banner sits over the map (in the banner stack), announced to screen readers', /<div class="map-area">\s*<!--[\s\S]*?-->\s*<div class="map-banners" id="map-banners">\s*<div id="famine-banner" class="famine-banner" role="status" aria-live="polite"><\/div>/.test(html));
check('3c. drawn when the game loads and on every 5-minute sync', /renderFamineBanner\(gameData\.settlement\.famine\)/.test(read('js/main.js')) && /renderFamineBanner\(data\.settlement\.famine\)/.test(read('js/game.js')));
const dev = html.slice(html.indexOf('🍽 Famine banner'), html.indexOf('cheat-famine-status'));
check('3d. Dev Tools: four previews, Back to live, Empty the food stores',
  ['low', 'critical', 'famine', 'ok'].every(s => dev.includes(`KWFamineDev.preview('${s}')`)) && /KWFamineDev\.live\(\)/.test(dev) && /cheatEmptyFood\(\)/.test(dev));
check('3e. emptying the stores uses the admin cheat and shows the real state', /async function cheatEmptyFood\(\)[\s\S]*?\/api\/game\/cheat\/resources[\s\S]*?food: -999999999[\s\S]*?KWFamineDev\.live\(\)/.test(read('js/buildings.js')));

const css = read('css/famine.css');
const detail = css.slice(css.indexOf('.famine-banner-detail {'), css.indexOf('}', css.indexOf('.famine-banner-detail {')));
check('3f. the message wraps instead of being cut off', /white-space: normal/.test(detail) && !/nowrap|ellipsis/.test(detail) && /width: max-content/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
