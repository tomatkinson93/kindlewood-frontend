// ══════════════════════════════════════════════════════════════════════════
//  KWPlaces — the five places (docs/LAYOUT_SPEC.md §2). Replaces the
//  community bar on desktop and the tab bar on phones.
//
//    🏡 Home       the painted settlement scene (a view), with its tools
//    👪 Families   the Families window
//    🌲 The Land   the world map (a view), with its tools
//    🧺 The Road   a window: Quests · Battles · Decks · Market
//    🛡 The Clan   a window: the clan hall · Chat
//
//  Social and meta things (Messages, Rankings, Online, World events,
//  Feedback) are in the profile menu. The game opens on Home.
//
//  The old community-bar buttons stay in the page, hidden: features still
//  light their unread dots there (.has-dot, .battle-badge) and call
//  KWShell.syncBadges(); the places read them and carry the dots up.
//
//    KWPlaces.go(key)        switch place ('home', 'families', 'land', 'road', 'clan')
//    KWPlaces.current()      the place shown ('home' or 'land' for views)
//    KWPlaces.start()        first sight after loading: Home, or the address's #place
//    KWPlaces.syncDots()     re-read the unread dots
//  Address: #home, #families, #land, #road, #clan (back and forward work).
//  Keys 1–5 switch place when nothing is being typed.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const fn = name => typeof global[name] === 'function';
  const call = (name, ...a) => { if (fn(name)) return global[name](...a); };

  const PLACES = [
    { key: 'home',     label: 'Home',     icon: 'home',     view: true },
    { key: 'families', label: 'Families', icon: 'families' },
    { key: 'land',     label: 'The Land', icon: 'land',     view: true },
    { key: 'road',     label: 'The Road', icon: 'road' },
    { key: 'clan',     label: 'The Clan', icon: 'clan' },
  ];
  const KEYS = PLACES.map(p => p.key);

  // What each place holds. `needs` hides an entry until it exists (a function
  // the page defines) or is unlocked (a building: _hasBuilding).
  const has = t => !fn('_hasBuilding') || global._hasBuilding(t);
  const TOOLS = {
    home: [
      // Phones have no room for the town card beside the scene: a chip opens it.
      { key: 'town',     label: 'Town',     glyph: '🏡', run: () => global.KWContext && global.KWContext.openTownWindow(), phone: true },
      { key: 'build',    label: 'Build',    glyph: '🏗', run: () => { call('switchTab', 'buildings'); if (isPhone() && global.KWShell) global.KWShell.openPanel(); else if (global.KWContext) global.KWContext.open(); } },
      { key: 'stores',   label: 'Stores',   glyph: '🎒', run: () => call('openInventoryModal') },
      { key: 'upgrade',  label: 'Upgrade',  glyph: '⬆️', run: () => call('openTierUpgradeModal') },
      // The tavern and the fishing post open over the map, so they leave the scene.
      { key: 'tavern',   label: 'Tavern',   glyph: '🍺', run: () => call('visitTavern'), leave: true },
      { key: 'fishing',  label: 'Fishing',  glyph: '🎣', run: () => call('visitFishingPost'), leave: true },
      { key: 'research', label: 'Research', glyph: '📚', run: () => call('openLibrary'), unlock: () => has('library') },
      { key: 'crafting', label: 'Crafting', glyph: '🔨', run: () => call('openCraftingAny'), unlock: () => has('craft:any') },
      { key: 'festival', label: 'Festival', glyph: '🎉', run: () => global.KWTown && global.KWTown.open('festival'), unlock: () => !!global.KWTown },
      { key: 'wonders',  label: 'Wonders',  glyph: '🏛', run: () => global.KWTown && global.KWTown.open('wonders'), unlock: () => !!global.KWTown && has('tier:city') },
    ],
    land: [
      { key: 'scout',    label: 'Scout',    glyph: '🧭', run: () => call('actionScout') },
      { key: 'outposts', label: 'Outposts', glyph: '⛺', run: () => { call('switchTab', 'outposts'); if (global.KWShell && isPhone()) global.KWShell.openPanel(); } },
      { key: 'journeys', label: 'Journeys', glyph: '🗺', run: () => global.KWJourneys && global.KWJourneys.open(), unlock: () => !!global.KWJourneys },
      { key: 'centre',   label: 'Centre',   glyph: '🏘', run: () => call('centreCamera') },
    ],
  };
  // The Road and The Clan: each entry opens the screen it always has. `dot`
  // is the hidden old button whose badge it carries.
  const HUBS = {
    road: {
      title: 'The Road', icon: 'road', sub: 'Quests, battles and trade beyond your walls.',
      items: [
        { key: 'quests',  label: 'Quests',  glyph: '📜', desc: 'The notice board: work for your citizens', run: () => call('openQuestsModal'), dot: 'nav-quests' },
        { key: 'battles', label: 'Battles', glyph: '⚔️', desc: 'Fights waiting for you', run: () => call('openBattlesModal'), dot: 'nav-battles' },
        { key: 'decks',   label: 'Decks',   glyph: '🃏', desc: 'Your combat cards', run: () => call('openDeckBuilder'), dot: 'nav-decks' },
        { key: 'market',  label: 'Market',  glyph: '⚖️', desc: 'Buy and sell with other towns', run: () => call('showCommunityTab', 'market'), dot: 'nav-market' },
      ],
    },
    clan: {
      title: 'The Clan', icon: 'clan', sub: 'Your clan, its hall and its talk.',
      items: [
        { key: 'hall', label: 'Clan hall', glyph: '🛡️', desc: 'Members, goals, treasury and land', run: () => call('openClanPanel'), dot: 'nav-clan' },
        { key: 'chat', label: 'Chat',      glyph: '💬', desc: 'The town square and your clan', run: () => call('openChatHub'), dot: 'nav-chat' },
      ],
    },
  };

  let _current = 'land';   // the view on screen until start()
  let _started = false;
  const isPhone = () => doc.body && doc.body.classList.contains('kw-shell');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = k => `<svg class="kw-icon" aria-hidden="true"><use href="#kw-i-${k}"/></svg>`;

  // ── Dots ────────────────────────────────────────────────────────────────
  const lit = id => {
    const b = doc.getElementById(id);
    return !!(b && (b.classList.contains('has-dot') || b.querySelector('.battle-badge, .has-dot')));
  };
  function dotsFor(key) {
    const h = HUBS[key];
    return h ? h.items.some(i => i.dot && lit(i.dot)) : false;
  }
  function syncDots() {
    doc.querySelectorAll('[data-place]').forEach(b => b.classList.toggle('has-dot', dotsFor(b.getAttribute('data-place'))));
    doc.querySelectorAll('[data-hub-item]').forEach(b => { const id = b.getAttribute('data-dot'); b.classList.toggle('has-dot', !!id && lit(id)); });
    const prof = doc.getElementById('profile-trigger');
    if (prof) prof.classList.toggle('has-dot', lit('nav-messages'));
    const pm = doc.getElementById('pm-messages');
    if (pm) pm.classList.toggle('has-dot', lit('nav-messages'));
    const oc = doc.getElementById('online-count'), pmo = doc.getElementById('pm-online-count');
    if (oc && pmo) pmo.textContent = oc.textContent;
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function barHtml() {
    return PLACES.map((p, i) => `<button type="button" class="kwp-place" data-place="${p.key}" aria-keyshortcuts="${i + 1}" title="${esc(p.label)} (${i + 1})">`
      + `${icon(p.icon)}<span class="kwp-label">${esc(p.label)}</span><span class="kwp-dot" aria-hidden="true"></span></button>`).join('');
  }
  function toolsHtml(key) {
    return (TOOLS[key] || []).filter(t => (!t.unlock || t.unlock()) && (!t.phone || isPhone()))
      .map(t => `<button type="button" class="kwp-tool" data-tool="${t.key}"><span aria-hidden="true">${t.glyph}</span> ${esc(t.label)}</button>`).join('');
  }
  function mark() {
    doc.querySelectorAll('[data-place]').forEach(b => {
      const on = b.getAttribute('data-place') === shownPlace();
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    placeTools();
    if (doc.body) { doc.body.classList.toggle('kwp-home', _current === 'home'); doc.body.classList.toggle('kwp-land', _current === 'land'); }
    if (global.KWContext) global.KWContext.refreshTown();
    const tools = doc.getElementById('kw-place-tools');
    if (tools) {
      tools.innerHTML = toolsHtml(_current);
      tools.setAttribute('aria-label', _current === 'home' ? 'Home' : 'The Land');
    }
  }
  // A window place counts as shown while its window is open.
  function shownPlace() {
    const W = global.KWWindow;
    if (W && W.isOpen) {
      if (W.isOpen('place-road')) return 'road';
      if (W.isOpen('place-clan')) return 'clan';
      if (W.isOpen('families')) return 'families';
    }
    return _current;
  }

  function build() {
    const screen = doc.getElementById('screen-game');
    if (!screen || doc.getElementById('kw-places')) return;
    const nav = doc.createElement('nav');
    nav.id = 'kw-places';
    nav.className = 'kwp-bar';
    nav.setAttribute('aria-label', 'Places');
    nav.innerHTML = barHtml();
    const tools = doc.createElement('div');
    tools.id = 'kw-place-tools';
    tools.className = 'kwp-tools';
    tools.setAttribute('role', 'toolbar');
    const old = screen.querySelector('.community-bar');
    const row = doc.createElement('div');
    row.className = 'kwp-row';
    row.appendChild(nav);
    if (old) { old.hidden = true; old.parentNode.insertBefore(row, old); }
    else screen.insertBefore(row, screen.firstChild);
    // The chips float at the top left of the view. They live on the game
    // screen itself, not in the row: the row is its own layer, which would
    // keep them under the Home scene.
    screen.appendChild(tools);
    doc.body.classList.add('kwp-on');
    placeTools();
    global.addEventListener('resize', placeTools);
    // The top bar grows as it fills in (a second row on phones): follow it.
    if (global.ResizeObserver) {
      const ro = new global.ResizeObserver(placeTools);
      [doc.querySelector('#screen-game .topbar'), row].forEach(n => { if (n) ro.observe(n); });
    }
    nav.addEventListener('click', e => { const b = e.target.closest('[data-place]'); if (b) go(b.getAttribute('data-place')); });
    tools.addEventListener('click', e => {
      const b = e.target.closest('[data-tool]');
      const t = b && (TOOLS[_current] || []).find(x => x.key === b.getAttribute('data-tool'));
      if (t && t.leave && svOpen()) call('closeSettlementView');
      if (t) { try { t.run(); } catch (err) { console.error('[places]', err); } }
    });
    mark();
    syncDots();
    // Dots: the old buttons change class or gain a badge.
    const bar = screen.querySelector('.community-bar');
    if (bar && global.MutationObserver) new MutationObserver(syncDots).observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }

  // The chips' line: just under the place row (desktop) or the top bar
  // (phones, where the places are at the bottom).
  function placeTools() {
    const tools = doc.getElementById('kw-place-tools');
    if (!tools || !doc.documentElement) return;
    const row = doc.querySelector('.kwp-row'), top = doc.querySelector('#screen-game .topbar');
    let y = 0;
    if (isPhone()) y = top ? top.getBoundingClientRect().bottom + 2 : 96;   // its bottom 20px is a fade
    else y = (row ? row.getBoundingClientRect().bottom : 100) + 16;
    doc.documentElement.style.setProperty('--kwp-tools-top', Math.round(y) + 'px');
  }

  // ── Switching ───────────────────────────────────────────────────────────
  const svOpen = () => { const v = doc.getElementById('settlement-view'); return !!(v && v.style.display !== 'none' && v.classList.contains('sv-visible')); };
  function toView(key) {
    // navGoMap re-selects the home tile; that is the game's doing, not a
    // choice of the player's, so it mustn't open the panel (js/context.js).
    const quiet = fn => (global.KWContext ? global.KWContext.mute(fn) : fn());
    if (global.KWContext) global.KWContext.close();
    if (key === 'home') {
      quiet(() => call('navGoMap'));    // closes the tavern, fishing and the community modal
      if (!svOpen()) call('openSettlementView');
    } else {
      if (svOpen()) call('closeSettlementView');
      quiet(() => call('navGoMap'));
    }
    _current = key;
  }
  function openHub(key) {
    const h = HUBS[key];
    global.KWWindow.open({
      id: 'place-' + key, title: h.title, icon: h.icon, size: 'M',
      render(body) {
        body.innerHTML = `<p class="kwp-hub-sub">${esc(h.sub)}</p><div class="kwp-hub">`
          + h.items.map(i => `<button type="button" class="kwp-hub-item" data-hub-item="${i.key}" data-dot="${i.dot || ''}">`
            + `<span class="kwp-hub-glyph" aria-hidden="true">${i.glyph}</span><span class="kwp-hub-text"><b>${esc(i.label)}</b><span>${esc(i.desc)}</span></span>`
            + `<span class="kwp-dot" aria-hidden="true"></span></button>`).join('') + '</div>';
        body.querySelectorAll('[data-hub-item]').forEach(b => b.addEventListener('click', () => {
          const it = h.items.find(x => x.key === b.getAttribute('data-hub-item'));
          global.KWWindow.close('place-' + key);
          if (it) { try { it.run(); } catch (err) { console.error('[places]', err); } }
        }));
        syncDots();
      },
      onClose: () => { mark(); setHash(_current, true); },
    });
  }
  function go(key, opts = {}) {
    if (!KEYS.includes(key)) return;
    const W = global.KWWindow;
    // Leaving a window place: close it first.
    ['place-road', 'place-clan'].forEach(id => { if (W && W.isOpen(id) && id !== 'place-' + key) W.close(id); });
    if (global.KWContext) global.KWContext._wrap();
    if (key === 'home' || key === 'land') toView(key);
    else if (key === 'families') { if (global.KWFamilies) global.KWFamilies.open(); }
    else if (W) openHub(key);
    if (global.KWShell && global.KWShell.close) global.KWShell.close();
    mark();
    if (!opts.fromHash) setHash(key);
  }
  function setHash(key, replace) {
    if (!global.history || !global.location) return;
    const h = '#' + key;
    if (global.location.hash === h) return;
    try { (replace ? global.history.replaceState : global.history.pushState).call(global.history, null, '', h); } catch (e) { /* file:// */ }
  }
  function fromAddress() {
    const k = String(global.location && global.location.hash || '').replace(/^#/, '').split('/')[0];
    return KEYS.includes(k) ? k : null;
  }

  // First sight after loading: the town (or wherever the address points).
  function start() {
    build();
    if (_started) return;
    _started = true;
    // Other scripts wrap switchTab and selectWorldTile at boot too: the
    // context panel wraps them last, once the game is in (js/context.js).
    if (global.KWContext) global.KWContext._wrap();
    go(fromAddress() || 'home', { fromHash: false });
    note();
  }

  // A one-time note: where things moved (§8).
  const NOTE_KEY = 'kw-places-note';
  function note() {
    let seen = false;
    try { seen = global.localStorage.getItem(NOTE_KEY) === '1'; } catch (e) { seen = true; }
    if (seen || !global.KWWindow) return;
    try { global.localStorage.setItem(NOTE_KEY, '1'); } catch (e) { /* private mode */ }
    global.KWWindow.open({
      id: 'places-note', title: 'Where things moved', icon: 'help', size: 'S',
      render(body) {
        body.innerHTML = '<p>The buttons along the top are now five places:</p><ul class="kwp-note">'
          + '<li><b>Home</b>: your town, its stores, tavern, research and crafting.</li>'
          + '<li><b>Families</b>: your citizens, their families and the chronicle.</li>'
          + '<li><b>The Land</b>: the map, outposts and journeys.</li>'
          + '<li><b>The Road</b>: quests, battles, decks and the market.</li>'
          + '<li><b>The Clan</b>: your clan and chat.</li></ul>'
          + '<p>Messages, rankings, who is online and feedback are in the menu under your name. Keys 1–5 switch place.</p>'
          + '<button type="button" class="kw-btn primary" data-action="ok">Got it</button>';
      },
      actions: { ok() { global.KWWindow.close('places-note'); } },
    });
  }

  // ── Keys and the address ────────────────────────────────────────────────
  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (!(n >= 1 && n <= 5)) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ''))) return;
    if (global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen()) return;
    const screen = doc.getElementById('screen-game');
    if (!screen || !screen.classList.contains('active')) return;
    e.preventDefault();
    go(KEYS[n - 1]);
  }

  function boot() {
    build();
    doc.addEventListener('keydown', onKey);
    global.addEventListener('hashchange', () => { const k = fromAddress(); if (k && _started) go(k, { fromHash: true }); });
    global.addEventListener('popstate', () => { const k = fromAddress(); if (k && _started) go(k, { fromHash: true }); });
    // A window closing (Families) puts the marker back on the view.
    doc.addEventListener('kww:close', () => mark());
    doc.addEventListener('kww:open', () => mark());
    // Features call KWShell.syncBadges() after changing a dot.
    const S = global.KWShell;
    if (S && S.syncBadges && !S._placesWrapped) {
      const orig = S.syncBadges;
      S.syncBadges = function () { try { orig.apply(this, arguments); } finally { syncDots(); } };
      S._placesWrapped = true;
    }
  }
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot(); }

  // The scene opened or closed some other way (its Back button, first steps,
  // the market's "Build a Market"): mark the view now on screen.
  function seen(key) {
    if (!KEYS.includes(key) || _current === key) return;
    _current = key;
    mark();
    if (_started) setHash(key, true);
  }

  global.KWPlaces = { go, start, seen, _started: () => _started, current: () => _current, shown: shownPlace, syncDots, PLACES, TOOLS, HUBS, _toolsHtml: toolsHtml, _barHtml: barHtml };
})(typeof window !== 'undefined' ? window : globalThis);
