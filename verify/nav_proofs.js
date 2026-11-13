'use strict';
// The five places (docs/LAYOUT_SPEC.md §2, §7): js/places.js, its place in
// the page, the phone shell and the settlement scene as Home.
//   node verify/nav_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const P = read('js/places.js'), H = read('index.html'), CSS = read('css/places.css'), MS = read('js/mobile-shell.js'), SV = read('js/settlement-view.js'), MJ = read('js/main.js'), WJ = read('js/window.js');

// A small fake page: enough for the bar, the dots and the tools.
function fakeEl(id, cls = []) {
  const set = new Set(cls);
  return { id, children: [], attrs: {}, _badge: false,
    classList: { contains: c => set.has(c), toggle: (c, on) => { if (on === undefined) on = !set.has(c); on ? set.add(c) : set.delete(c); return on; }, add: c => set.add(c), remove: c => set.delete(c) },
    querySelector(sel) { return this._badge && /battle-badge/.test(sel) ? {} : null; },
    getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    textContent: '' };
}
const els = {};
['nav-quests', 'nav-battles', 'nav-decks', 'nav-market', 'nav-clan', 'nav-chat', 'nav-messages', 'profile-trigger', 'pm-messages', 'online-count', 'pm-online-count'].forEach(id => { els[id] = fakeEl(id); });
const placeBtns = ['home', 'families', 'land', 'road', 'clan'].map(k => { const b = fakeEl('p-' + k); b.attrs['data-place'] = k; return b; });
const doc = { readyState: 'complete', body: fakeEl('body'), addEventListener() {}, getElementById: id => els[id] || null,
  querySelectorAll: sel => (sel === '[data-place]' ? placeBtns : []), createElement: () => fakeEl('x') };
const w = { console, document: doc, addEventListener() {}, location: { hash: '' }, history: {}, localStorage: { getItem: () => null, setItem() {} } };
w.window = w; vm.createContext(w);
vm.runInContext(P, w);
const K = w.KWPlaces;

console.log('1. Five places');
{
  check('1a. Home, Families, The Land, The Road, The Clan, in that order', K.PLACES.map(p => p.label).join() === 'Home,Families,The Land,The Road,The Clan');
  check('1b. Home and The Land are views; the other three are windows', K.PLACES.filter(p => p.view).map(p => p.key).join() === 'home,land');
  const bar = K._barHtml();
  check('1c. each has its line icon, a label, a dot and keys 1–5', (bar.match(/class="kwp-place"/g) || []).length === 5 && /aria-keyshortcuts="1"[\s\S]*aria-keyshortcuts="5"/.test(bar) && (bar.match(/kwp-dot/g) || []).length === 5);
  check('1d. the five icons are in the sprite', ['home', 'families', 'land', 'road', 'clan'].every(k => H.includes(`<symbol id="kw-i-${k}"`)));
  check('1e. the bar is a labelled nav; the current place is marked (aria-current)', /setAttribute\('aria-label', 'Places'\)/.test(P) && /aria-current', 'page'/.test(P));
}

console.log('2. What each place holds');
{
  check('2a. The Road: Quests, Battles, Decks, Market', K.HUBS.road.items.map(i => i.label).join() === 'Quests,Battles,Decks,Market');
  check('2b. The Clan: the clan hall and Chat', K.HUBS.clan.items.map(i => i.key).join() === 'hall,chat');
  check('2c. Home: Stores, Upgrade, Tavern, Fishing, then what the town has unlocked', K.TOOLS.home.slice(0, 4).map(t => t.key).join() === 'stores,upgrade,tavern,fishing');
  check('2d. The Land: Scout, Outposts, Journeys, Centre', K.TOOLS.land.map(t => t.key).join() === 'scout,outposts,journeys,centre');
  w._hasBuilding = t => t === 'library';
  const home = K._toolsHtml('home');
  check('2e. locked things are absent, not greyed (Research with a Library; no Crafting or Wonders yet)', /data-tool="research"/.test(home) && !/data-tool="crafting"/.test(home) && !/data-tool="wonders"/.test(home));
  check('2g. the tavern and the fishing post (over the map) leave the scene first', K.TOOLS.home.filter(t => t.leave).map(t => t.key).join() === 'tavern,fishing' && /t\.leave && svOpen\(\)\) call\('closeSettlementView'\)/.test(P));
  check('2f. each hub entry opens the screen it always had', /openQuestsModal/.test(P) && /openBattlesModal/.test(P) && /openDeckBuilder/.test(P) && /showCommunityTab', 'market'/.test(P) && /openClanPanel/.test(P) && /openChatHub/.test(P));
}

console.log('3. The profile menu takes the social and meta things');
{
  const menu = H.slice(H.indexOf('id="profile-menu"'), H.indexOf('logout-item'));
  check('3a. Messages, Rankings, Online, World events and Feedback', ['pm-messages', 'pm-rankings', 'pm-online', 'pm-events', 'pm-feedback'].every(id => menu.includes(`id="${id}"`)));
  check('3b. "Your Kingdom" is gone (Home is a place)', !/Your Kingdom/.test(menu));
}

console.log('4. Dots are carried up');
{
  K.syncDots();
  check('4a. nothing lit, no dots', placeBtns.every(b => !b.classList.contains('has-dot')) && !els['profile-trigger'].classList.contains('has-dot'));
  els['nav-battles']._badge = true;          // battles.js adds a .battle-badge
  els['nav-clan'].classList.add('has-dot');  // clans.js: a join request
  els['nav-messages'].classList.add('has-dot');
  els['online-count'].textContent = '(3)';
  K.syncDots();
  const on = k => placeBtns.find(b => b.attrs['data-place'] === k).classList.contains('has-dot');
  check('4b. a battle waiting lights The Road', on('road') && !on('home'));
  check('4c. a clan request lights The Clan', on('clan'));
  check('4d. unread messages light the profile button and its menu entry', els['profile-trigger'].classList.contains('has-dot') && els['pm-messages'].classList.contains('has-dot'));
  check('4e. the online count follows into the menu', els['pm-online-count'].textContent === '(3)');
  check('4f. features\' KWShell.syncBadges() calls reach the places; the old buttons are watched too', /S\.syncBadges = function/.test(P) && /new MutationObserver\(syncDots\)/.test(P));
}

console.log('5. Address, keys and first sight');
{
  check('5a. #home, #families, #land, #road, #clan; back and forward work', /pushState/.test(P) && /addEventListener\('hashchange'/.test(P) && /addEventListener\('popstate'/.test(P));
  check('5b. keys 1–5, not while typing, not with a modifier, not under a confirm', /n >= 1 && n <= 5/.test(P) && /input\|textarea\|select/.test(P) && /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/.test(P) && /KWDialog\.isOpen/.test(P));
  check('5c. the game opens on Home (or the address\'s place) once the player starts', /hideLoadingScreen\(\);\s*if \(window\.KWPlaces\) KWPlaces\.start\(\);/.test(MJ) && /go\(fromAddress\(\) \|\| 'home'/.test(P));
  check('5d. a one-time "where things moved" note', /NOTE_KEY = 'kw-places-note'/.test(P) && /Where things moved/.test(P));
  check('5e. windows announce opening and closing, so the marker follows', /announce\('kww:open', w\)/.test(WJ) && /announce\('kww:close', w\)/.test(WJ) && /addEventListener\('kww:open'/.test(P));
}

console.log('6. The old bar, the phone and Home');
{
  check('6a. the old community bar stays in the page, hidden (features still light their dots there)', /class="community-bar"/.test(H) && /old\.hidden = true/.test(P));
  check('6b. places.js and places.css are loaded (the CSS after mobile-shell.css)', /js\/places\.js/.test(H) && H.indexOf('css/places.css') > H.indexOf('css/mobile-shell.css'));
  check('6c. phones: the places are the bottom bar', /body\.kw-shell \.kwp-bar \{[^}]*position: fixed;[^}]*bottom: 0;/.test(CSS));
  check('6c2. the view\'s tools are chips at its top left (desktop and phones), on the game screen itself, not in the place row (its layer would keep them under the scene)',
    /\.kwp-tools \{[^}]*position: fixed;[^}]*top: var\(--kwp-tools-top/.test(CSS) && /screen\.appendChild\(tools\)/.test(P) && !/row\.appendChild\(tools\)/.test(P) && /--kwp-tools-top/.test(P));
  check('6c3. desktop: the places are a centred row; the one on screen is underlined', /\.kwp-row \{[^}]*justify-content: center/.test(CSS) && /\.kwp-place\.on \{[^}]*border-bottom-color/.test(CSS));
  check('6d. the phone shell no longer builds its own tab bar', /if \(window\.KWPlaces\) \{ wireIntegrations\(\);/.test(MS));
  check('6e. Home is a view: the scene isn\'t an overlay, and stops above the places on phones', !/'settlement-view', 'sq-backdrop'/.test(MS) && /body\.kw-shell #settlement-view \{ bottom:/.test(CSS));
  check('6f. the scene tells the places when it opens or closes; its back button says where it goes', /KWPlaces\.seen\('home'\)/.test(SV) && /KWPlaces\.seen\('land'\)/.test(SV) && /&#8592; The Land/.test(SV));
  check('6g. the scene\'s back button and title go (the places do that); its Town / Outskirts sit under the chips; the moment cards too', /body\.kwp-on \.sv-back-btn, body\.kwp-on \.sv-header-title \{ display: none; \}/.test(CSS) && /body\.kwp-on #kw-moments \{ top: calc\(var\(--kwp-tools-top/.test(CSS));
  check('6h. the bell on phones: its list and the profile menu open above the Home scene', /\.topbar:has\(\.events-panel\.open\)/.test(CSS) && /\.topbar:has\(#profile-dropdown-wrap\.open\) \{ z-index: var\(--z-float\)/.test(CSS));
  check('6i. a panel fading out is checked again when the fade ends, so the places come back after the bell closes', /addEventListener\('transitionend'/.test(MS) && /syncSoon/.test(MS));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
