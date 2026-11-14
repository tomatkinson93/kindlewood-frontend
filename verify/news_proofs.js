'use strict';
// One place for news (docs/LAYOUT_SPEC.md §2.5, Phase 4 step 3): the bell
// opens the News window (js/news.js); the old drop-down panel and the Events
// button are gone; world events live in the clock's pop-up.
//   node verify/news_proofs.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };
const N = read('js/news.js'), E = read('js/events.js'), H = read('index.html'), M = read('js/moments.js'), C = read('css/main.css'), MS = read('css/mobile-shell.css'), HC = read('js/hud-clock.js');

const store = {};
const badge = { textContent: '', style: {} }, bell = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
const w = { console, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  document: { getElementById: id => (id === 'events-badge' ? badge : null), querySelector: s => (s === '.btn-events-bell' ? bell : null) },
  KWMoments: { list: () => [{ id: 1, icon: '🍼', title: 'A name for the baby', expires_at: new Date(Date.now() + 3600e3).toISOString() }], _bellHtml: () => '<div class="kwm-bell">🔔 Waiting for you</div>' },
  _timeAgo: () => '2h ago' };
w.window = w; vm.createContext(w);
vm.runInContext('var _eventsData = [' +
  '{ id: 9, type: "raid_warning", message: "🔥 Raiders <b>gather</b>", created_at: "2026-11-14T10:00:00Z" },' +
  '{ id: 8, type: "child_born", message: "A baby was born to Ada", created_at: "2026-11-14T09:00:00Z" },' +
  '{ id: 7, type: "village_request_new", message: "📣 Oakmere asks for timber", created_at: "2026-11-14T08:00:00Z" },' +
  '{ id: 6, type: "discovery", message: "💎 New discovery: Gems!", created_at: "2026-11-14T07:00:00Z" }];', w);
vm.runInContext(N, w);
const K = w.KWNews;

console.log('1. Sorting the news');
{
  const c = t => K.category(t);
  check('1a. raids: warnings, repelled, tribute, a camp burned', ['raid_warning', 'raid_repelled', 'raid_tribute', 'camp_cleared'].every(t => c(t) === 'raids'));
  check('1b. family: births, partnerships, memorials, deaths, coming of age, settlers, inheritance', ['child_born', 'partnership', 'memorial', 'death_old_age', 'came_of_age', 'settler', 'inheritance'].every(t => c(t) === 'family'));
  check('1c. trade: villages, trust, the market, hauls', ['village_request_new', 'trust_faded', 'market_sale', 'clan_haul'].every(t => c(t) === 'trade'));
  check('1d. anything else shows under All only', c('discovery') === 'other' && c('wonder') === 'other');
  check('1e. tabs: All · Raids · Family · Trade', K.TABS.map(t => t.label).join() === 'All,Raids,Family,Trade');
}

console.log('2. The list');
{
  const all = K._rowsHtml('all');
  check('2a. newest first, every row', (all.match(/class="kwn-row/g) || []).length === 4 && all.indexOf('Raiders') < all.indexOf('baby'));
  check('2b. text escaped', /Raiders &lt;b&gt;gather&lt;\/b&gt;/.test(all) && !/<b>gather/.test(all));
  check('2c. a message\'s own emoji is its icon (not doubled); others get their kind\'s icon', /kwn-ic" aria-hidden="true">🔥<\/span><span class="kwn-text"><span>Raiders/.test(all) && /kwn-ic" aria-hidden="true">👪<\/span><span class="kwn-text"><span>A baby/.test(all));
  const raids = K._rowsHtml('raids');
  check('2d. a tab shows only its kind', (raids.match(/class="kwn-row/g) || []).length === 1 && /Raiders/.test(raids) && (K._rowsHtml('family').match(/kwn-row/g) || []).length === 1);
  check('2e. an empty tab says so', /No trade news|No raids news|kwn-empty/.test(vm.runInContext('_eventsData = _eventsData.filter(e => e.type !== "village_request_new"); KWNews._rowsHtml("trade")', w)));
  vm.runInContext('_eventsData.splice(2, 0, { id: 7, type: "village_request_new", message: "📣 Oakmere asks for timber", created_at: "2026-11-14T08:00:00Z" })', w);
  const body = K._bodyHtml('all');
  check('2f. what is waiting for you comes first, then the news, then the links (away, chronicle, clear all)', body.indexOf('kwn-waiting') < body.indexOf('kwn-feed') && /data-action="away"/.test(body) && /data-action="chronicle"/.test(body) && /data-action="clear"/.test(body));
  check('2g. each row can be dismissed; clearing all asks first', /data-action="dismiss"/.test(all) && /KWDialog\.confirm\(\{ title: 'Clear all news\?'/.test(N));
  check('2h. a moment opens its dialogue: the window closes first (the dialogue sits below windows)', /\[data-kwm\]'\)\.forEach\(b => b\.addEventListener\('click', \(\) => close\(\)/.test(N));
  check('2i. "The whole chronicle" opens Families on its Chronicle tab', /setTab\('chronicle'\)/.test(N));
}

console.log('3. The bell\'s count');
{
  const n0 = K.badge();
  check('3a. nothing seen yet: moments waiting + every news item (1 + 4)', n0 === 5 && badge.style.display === 'inline-flex' && bell.attrs['aria-label'] === 'News, 5 new', String(n0));
  store['kw-news-seen'] = '8';
  check('3b. after looking: only what came since (1 moment + 1 newer item)', K.badge() === 2);
  store['kw-news-seen'] = '9';
  vm.runInContext('KWMoments.list = () => []', w);
  check('3c. nothing new: no count shown', K.badge() === 0 && badge.style.display === 'none' && bell.attrs['aria-label'] === 'News');
  check('3d. opening and closing it marks everything seen', /markSeen\(\);\s*badge\(\);/.test(N) && /onClose\(\) \{ markSeen\(\); badge\(\); \}/.test(N));
  check('3e. moments changing recount the bell', /global\.KWNews\.refresh\(\)/.test(M));
}

console.log('4. What changed elsewhere');
{
  check('4a. toasts and the count no longer depend on the old panel (they ran only while its markup existed)', /\/\/ Toast new events \(always/.test(E) && E.indexOf('_lastSeenEventId = newest.id') < E.indexOf("if (window.KWNews) { KWNews.refresh(); return; }"));
  check('4b. the bell opens the window; closing goes through it', /if \(window\.KWNews\) \{ KWNews\.toggle\(\); return; \}/.test(E) && /if \(window\.KWNews\) KWNews\.close\(\);/.test(E));
  check('4c. enough news for the tabs (40)', /\/api\/events\?limit=40/.test(E));
  check('4d. the old drop-down panel is gone, markup and styles', !/id="events-panel"/.test(H) && !/\.events-panel \{/.test(C) && !/\.events-panel/.test(MS) && !/\.ef-item/.test(C));
  check('4e. the Events button and "World events" are gone; world events are in the clock\'s pop-up with the calendar a click away', !/id="nav-events"/.test(H) && !/id="pm-events"/.test(H) && /hc-happenings/.test(HC) && /KWEventsPanel\.open\(\)/.test(HC));
  check('4f. a bell line icon; news.js and news.css loaded', /<symbol id="kw-i-bell"/.test(H) && /js\/news\.js/.test(H) && /css\/news\.css/.test(H));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
