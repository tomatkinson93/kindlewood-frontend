'use strict';
// Festivals without the banner: fireworks over just the festival towns
// (js/kwmap-happening-fx.js drawFestivals, called by both renderers), the
// buff line in your settlement panel and a note on others' (js/main.js);
// the wide clan panel and chat (css).
//   node verify/festival_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const w = { console, Math, Map, Date, document: { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) }) }, matchMedia: () => ({ matches: false }) };
w.window = w; vm.createContext(w);
vm.runInContext(read('js/kwmap-happening-fx.js'), w);
const FX = w.KWHappeningFX;
const calls = [];
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => { t[k] = v; calls.push('set:' + k); return true; } });
const town = (festival, q) => ({ cx: 100 + q * 50, baseY: 200, hexW: 48, t: { terrain: 'plains', q, r: 0, settlement: { festival } } });

console.log('1. Fireworks over the town');
check('1a. only towns holding a festival are anchors', FX.festivalAnchors({ visibleSettlements: () => [town(true, 1), town(false, 2)] }).length === 1);
calls.length = 0;
check('1b. no festival in view: nothing drawn, canvas untouched', FX.drawFestivals(ctx, 800, 600, { visibleSettlements: () => [town(false, 1)] }, 1000, { kinds: [] }) === false && calls.length === 0);
check('1c. a festival town: fireworks drawn', FX.drawFestivals(ctx, 800, 600, { visibleSettlements: () => [town(true, 1)] }, 1000, { kinds: [], night: 1 }) === true && calls.length > 0);
calls.length = 0;
check('1d. reduced motion, or a fireworks Happening already on: nothing extra', FX.drawFestivals(ctx, 800, 600, { visibleSettlements: () => [town(true, 1)] }, 1000, { reduced: true }) === false
  && FX.drawFestivals(ctx, 800, 600, { visibleSettlements: () => [town(true, 1)] }, 1000, { kinds: ['fireworks'] }) === false && calls.length === 0);
check('1e. both renderers call it each frame', /KWHappeningFX\.drawFestivals\(ctx, W, H, this, frame\.now\)/.test(read('js/kwmap-topdown.js')) && /KWHappeningFX\.drawFestivals\(ctx, W, H, this, frame\.now\)/.test(read('js/kwmap-iso.js')));

console.log('2. No banner; the panel shows it');
const WN = read('js/wonders.js'), M = read('js/main.js');
check('2a. the festival banner is gone (unpaid upkeep keeps its banner)', !/🎉 <b>Festival<\/b>/.test(WN) && /Unpaid upkeep/.test(WN));
check('2b. your settlement: a Festival row with the buff and time left', /_festivalStatusRow\(\)/.test(M) && /'<span class="sett-status-icon">🎉<\/span><span class="sett-status-label">Festival<\/span>'/.test(M) && /% production' \+ \(left \? ' · ' \+ left \+ ' left'/.test(M));
check('2c. another town: "Holding a festival"', /s\.festival \? '<div class="sett-festival-note">🎉 Holding a festival/.test(M));

console.log('3. Wide clan panel and chat');
check('3a. clan panel up to 900px', /width: min\(900px, 95vw\)/.test(read('css/clans.css')));
check('3b. chat up to 1100px and taller', /width: min\(1100px, 96vw\)/.test(read('css/chat-hub.css')) && /height: 84vh/.test(read('css/chat-hub.css')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
