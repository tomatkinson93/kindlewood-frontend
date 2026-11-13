'use strict';
// The context panel and the town card (docs/LAYOUT_SPEC.md §2.4, step 2):
// js/context.js, css/context.css and what changed in main.js and places.js.
//   node verify/context_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const J = read('js/context.js'), CSS = read('css/context.css'), MJ = read('js/main.js'), P = read('js/places.js'), H = read('index.html');

const body = { classList: (() => { const s = new Set(); return { contains: c => s.has(c), add: c => s.add(c), remove: c => s.delete(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)) }; })() };
const doc = { readyState: 'loading', body, addEventListener() {}, getElementById: () => null, querySelector: () => null };
const soon = new Date(Date.now() + 42 * 60000).toISOString();
const w = { console, document: doc, setInterval() {}, localStorage: { getItem: () => '' }, fetch: async () => ({ ok: false }),
  gameData: { species: 'mice', food_rate: -2.5, settlement: { name: 'Visual <Camp>', tier: 'village', beds: 20, raid: { target_name: 'the Farmstead', arrives_at: soon } } },
  citizensData: [{ stage: 'child' }, { stage: 'child' }, { stage: 'youth' }, { stage: 'adult', life: { happiness: 80 }, active_quest: { id: 1 } }, { stage: 'adult', life: { happiness: 60 } }, { stage: 'elder', life: { happiness: 70 } }, { stage: 'deceased' }],
  _outpostStatus: { outposts: [{ name: 'Logging Camp', buildings: { built: [{ name: 'Sawpit', ready: true }, { name: 'Bunkhouse', ready: false, ready_at: soon }] } }] },
  KWPlaces: { current: () => 'home', _started: () => true } };
w.window = w; vm.createContext(w);
vm.runInContext(J, w);
const K = w.KWContext;

console.log('1. The town card');
{
  const h = K.townHtml();
  check('1a. the name (escaped), tier, species and beds', /Visual &lt;Camp&gt;/.test(h) && /Village · Mice · Beds 6 of 20/.test(h));
  check('1b. children, youths, adults, elders (the dead left out)', /<b>2<\/b><span>Children/.test(h) && /<b>1<\/b><span>Youths/.test(h) && /<b>2<\/b><span>Adults/.test(h) && /<b>1<\/b><span>Elders/.test(h));
  check('1c. happiness and food; food falling is marked', /70% happy/.test(h) && /kwc-bad">🍖 food -2\.5\/hr/.test(h));
  check('1d. under way: a raid first, an outpost building going up, citizens on quests (no construction timers exist for town buildings)', /Under way/.test(h) && h.indexOf('Raiders strike the Farmstead') < h.indexOf('Bunkhouse at Logging Camp') && !/Sawpit/.test(h) && /1 on a quest/.test(h));
  check('1e. first steps sit on the card (one #fs-slot in the page: the panel leaves it out)', /id="fs-slot"/.test(h) && /window\.KWPlaces \? '' : '<div id="fs-slot">'/.test(MJ));
  check('1f. today\'s chronicle from /api/families/all/chronicle, at most three lines, cached a minute', /\/api\/families\/all\/chronicle/.test(J) && /slice\(0, 3\)/.test(J) && /< 60000/.test(J));
  check('1g. a link to the families and the whole chronicle', /data-kwc="families"/.test(h));
  check('1h. desktop: top right of Home, above the scene, hidden when a panel is open; phones: a Town chip opens it as a window',
    /body\.kwp-home:not\(\.kwc-open\):not\(\.kw-shell\) #kw-town-card:not\(:empty\) \{ display: block; \}/.test(CSS) && /\.kwc-town \{[^}]*z-index: var\(--z-float\)/.test(CSS) && /key: 'town',[^\n]*phone: true/.test(P) && /openTownWindow/.test(J));
}

console.log('2. The panel opens only on the player\'s own action');
{
  check('2a. nothing pressed lately: the game\'s own calls (boot, refreshes) don\'t open it', K._allowOpen() === false);
  check('2b. selectWorldTile, selectFogTile and switchTab (citizens, outposts, buildings, tier) are wrapped; the input must be under 1.5s old',
    /global\.selectWorldTile = function/.test(J) && /global\.selectFogTile = function/.test(J) && /OPENERS = \['citizens', 'outposts', 'buildings', 'tier'\]/.test(J) && /Date\.now\(\) - lastInput < 1500/.test(J));
  check('2c. other scripts wrap them too, so the panel wraps last: when the game starts and on each place switch', /KWContext\._wrap\(\)/.test(P) && (P.match(/KWContext\._wrap\(\)/g) || []).length >= 2);
  check('2d. going to The Land re-selects the home tile quietly (muted)', /KWContext\.mute\(fn\)/.test(P) && /quiet\(\(\) => call\('navGoMap'\)\)/.test(P));
  check('2e. ✕ and Escape close it (Escape only when no window or confirm is on top); switching place closes it', /className = 'kwc-close'/.test(J) && /e\.key !== 'Escape'/.test(J) && /KWWindow\.isOpen\(\)\) return/.test(J) && /KWContext\.close\(\)/.test(P));
}

console.log('3. Layout');
{
  check('3a. desktop: the sidebar floats at the right, shown only while open; the map keeps the width', /body\.kwp-on:not\(\.kw-shell\) #sidebar \{[^}]*display: none;[^}]*position: fixed;/.test(CSS) && /body\.kwp-on\.kwc-open:not\(\.kw-shell\) #sidebar \{ display: flex; \}/.test(CSS));
  check('3b. it leaves the game body (whose own layer kept it under the Home scene)', /sb\.parentNode !== screen\) screen\.appendChild\(sb\)/.test(J));
  check('3c. no sidebar tabs; the old map action bar goes (its buttons are chips)', /#sidebar \.sidebar-tabs \{ display: none; \}/.test(CSS) && /body\.kwp-on \.action-bar \{ display: none; \}/.test(CSS));
  check('3d. the tier card becomes a header strip; the 11-button grid goes', /if \(window\.KWPlaces\) \{\s*return '<div class="kwc-strip">/.test(MJ) && /window\.KWPlaces \? '<\/div>' : '<div class="sett-divider"><\/div>'/.test(MJ));
  check('3e. Home has a Build chip: the build list opens in the panel (the sheet on phones)', /key: 'build',[^\n]*switchTab', 'buildings'/.test(P));
  check('3f. phones keep the bottom sheet, above the Home scene when open', /body\.kw-shell #screen-game \.sidebar\.kw-open \{ z-index: var\(--z-float\); \}/.test(CSS) && /!isPhone\(\) && !muted/.test(J));
  check('3g. context.js and context.css are loaded', /js\/context\.js/.test(H) && /css\/context\.css/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
