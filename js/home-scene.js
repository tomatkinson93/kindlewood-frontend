'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  KWHome — buildings are the buttons (docs/HOME_SCENE.md §2, build step 3).
//
//  The scene (js/settlement-view.js) draws the slots; this module decides
//  what a building is and does:
//    ROUTES / route(id)        what a click opens (§2.2), else the sv-bp panel
//    PROPS / props(state)      the things that are not buildings: the village
//                              green (festivals), the wonder site (City), the
//                              signposts between Town and the Outskirts
//    artHtml(key, vis, size)   the building's art, or the placeholder (§2.6):
//                              a hut in the building's colours with its glyph
//                              on a hanging sign
//    manifest / door(key)      assets/images/buildings/manifest.json: size,
//                              door point, and whether the art is drawn on the
//                              villagers' pixel grid ("native": drawn at 1×)
//    bubble(id, state)         one short "something is waiting" line (§2.4)
//    note(type, ev)            realtime events that raise a bubble
//    showNames()               the profile menu's "Show names" toggle
//    townList()                the plain list of the same screens (§2.5),
//                              for the profile menu
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  const doc = global.document;
  const fn = name => typeof global[name] === 'function';
  const call = (name, ...a) => { if (fn(name)) return global[name](...a); };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const leaveScene = () => call('closeSettlementView');

  // ── What a building opens (§2.2) ───────────────────────────────────────
  // `opens` is the nameplate's second line and the end of the aria-label.
  // `leave`: the screen opens over the map, so the scene closes first.
  // A building not listed opens its own panel (workers, output, upgrade).
  const craft = station => ({ opens: 'Craft here', run: () => call('openCrafting', station) });
  const ROUTES = {
    granary:       { opens: 'Open the Stores',      run: () => call('openInventoryModal') },
    tavern:        { opens: 'Visit the tavern',     run: () => call('visitTavern'), leave: true },
    market:        { opens: 'Open the market',      run: () => call('openMarket'), leave: true },
    library:       { opens: 'Open Research',        run: () => call('openLibrary') },
    workshop:      craft('workshop'),
    smithy:        craft('smithy'),
    jeweller:      craft('jeweller'),
    smelter:       craft('smelter'),
    guild_hall:    { opens: 'Upgrade the town',     run: () => call('openTierUpgradeModal') },
    neighbourhood: { opens: 'See the homes',        run: () => call('_openHousingModal') },
    fishing_post:  { opens: 'Go fishing',           run: () => call('visitFishingPost'), leave: true },
  };
  const PANEL = { opens: 'Workers and upgrades', panel: true };
  const route = id => ROUTES[id] || PANEL;

  // Runs what a building opens. `panel` is the scene's own panel opener,
  // used for buildings with no screen of their own. Clears its bubble.
  function open(id, panel) {
    const r = route(id);
    clearBubble(id);
    if (r.panel) { if (panel) panel(); return 'panel'; }
    if (r.leave) leaveScene();
    try { r.run(); } catch (e) { console.error('[home]', e); }
    return id;
  }

  // ── Props (§2.2): not buildings, but places in the scene ───────────────
  // x, y are the slots' percent coordinates. `show(state)` decides. The
  // town's signpost stands at 70 %, not the far edge: on desktop the town
  // card covers the scene's right quarter.
  const PROPS = [
    { id: 'signpost-out',  kind: 'signpost', area: 'town',      x: 70, y: 86, label: 'To the Outskirts →', opens: 'Walk to the Outskirts',
      run: () => call('_svSwitchArea', 'outskirts') },
    { id: 'signpost-town', kind: 'signpost', area: 'outskirts', x: 6,  y: 88, label: '← To town', opens: 'Walk back to town', flip: true,
      run: () => call('_svSwitchArea', 'town') },
    { id: 'green',         kind: 'green',    area: 'town',      x: 36, y: 72, label: 'Village green', opens: 'Hold a festival',
      run: () => global.KWTown && global.KWTown.open('festival'), show: s => !!s.festivals },
    { id: 'wonder-site',   kind: 'wonder',   area: 'outskirts', x: 40, y: 66, label: 'Wonder site', opens: 'Build a Wonder',
      run: () => global.KWTown && global.KWTown.open('wonders'), show: s => s.tier === 'city' && !!s.festivals },
  ];
  const cits = () => (typeof citizensData !== 'undefined' ? citizensData : global.citizensData);   // eslint-disable-line no-undef
  // What the props read: the tier, and whether the town screens exist.
  function sceneState() {
    const gd = global.gameData || null, s = gd && gd.settlement;
    return { tier: (s && s.tier) || 'camp', festivals: !!global.KWTown, town: (s && s.town) || null,
      famine: (s && s.famine) || null, beds: s && typeof s.beds === 'number' ? s.beds : null,
      // citizensData is a top-level let in main.js, not on window.
      living: Array.isArray(cits()) ? cits().filter(c => c && c.life_stage !== 'deceased').length
        : (s && typeof s.population === 'number' ? s.population : null) };
  }
  const props = (state = sceneState()) => PROPS.filter(p => !p.show || p.show(state));
  function openProp(id) {
    const p = PROPS.find(x => x.id === id);
    if (!p) return null;
    clearBubble(id);
    try { p.run(); } catch (e) { console.error('[home]', e); }
    return id;
  }

  // ── The manifest (§2.6) ────────────────────────────────────────────────
  // { "<key>": { "file": "tavern.png", "w": 332, "h": 258, "door": [166, 250], "native": false } }
  // No entry: the placeholder, door at the bottom centre. "native": true is
  // art drawn on the villagers' grid, shown at 1×; older art keeps the
  // scene's slot sizing until it is redrawn.
  const MANIFEST_URL = '/assets/images/buildings/manifest.json';
  let manifest = {}, _mLoading = null;
  function loadManifest() {
    if (_mLoading) return _mLoading;
    _mLoading = (typeof fetch === 'function' ? fetch(MANIFEST_URL, { cache: 'no-cache' }) : Promise.reject())
      .then(r => (r.ok ? r.json() : {})).catch(() => ({}))
      .then(j => { manifest = j && typeof j === 'object' ? j : {}; return manifest; });
    return _mLoading;
  }
  function art(key, m = manifest) {
    const e = m && m[key];
    if (!e || !e.file) return null;
    const w = Number(e.w) || 0, h = Number(e.h) || 0;
    const door = Array.isArray(e.door) && e.door.length === 2 ? { x: Number(e.door[0]), y: Number(e.door[1]) } : { x: w / 2, y: h };
    return { url: '/assets/images/buildings/' + e.file, w, h, door, native: !!e.native };
  }
  // The door in the image's own pixels; the bottom centre when unknown.
  const door = (key, m = manifest) => { const a = art(key, m); return a ? a.door : null; };

  // ── Placeholder art (§2.6) ─────────────────────────────────────────────
  // A hut silhouette in the building's colours, its door, and the glyph on
  // a sign hanging from a bracket. Props draw their own shapes.
  function hutSvg(vis, size) {
    const W = Math.round(size * 1.2), H = Math.round(size * 1.05);
    const body = esc(vis.bodyColor || '#7a5c40'), roof = esc(vis.roofColor || '#4a3420');
    return `<svg class="kwh-hut" width="${W}" height="${H}" viewBox="0 0 120 105" aria-hidden="true" shape-rendering="crispEdges">`
      + `<rect x="18" y="48" width="74" height="50" fill="${body}"/>`
      + `<rect x="18" y="48" width="74" height="6" fill="#000" opacity=".18"/>`
      + `<polygon points="10,52 55,14 100,52" fill="${roof}"/>`
      + `<polygon points="10,52 55,14 58,17 16,52" fill="#fff" opacity=".12"/>`
      + `<rect x="46" y="70" width="18" height="28" rx="1" fill="#2b1d12"/>`
      + `<rect x="26" y="62" width="12" height="10" fill="#f3d58a" opacity=".75"/>`
      + `<rect x="92" y="58" width="16" height="3" fill="#3a2a1a"/>`
      + `<line x1="98" y1="61" x2="98" y2="66" stroke="#3a2a1a" stroke-width="1.5"/><line x1="106" y1="61" x2="106" y2="66" stroke="#3a2a1a" stroke-width="1.5"/>`
      + `<rect x="94" y="66" width="18" height="16" rx="2" fill="#d9b77a" stroke="#5a3d22" stroke-width="1.5"/>`
      + `<ellipse cx="55" cy="100" rx="48" ry="4" fill="#000" opacity=".22"/></svg>`;
  }
  function propSvg(kind, size, flip) {
    if (kind === 'signpost') {
      const W = Math.round(size * 0.9), H = Math.round(size * 1.0);
      return `<svg class="kwh-prop-art" width="${W}" height="${H}" viewBox="0 0 90 100" aria-hidden="true" shape-rendering="crispEdges"${flip ? ' style="transform:scaleX(-1)"' : ''}>`
        + `<rect x="40" y="20" width="8" height="78" fill="#6b4a2e"/>`
        + `<polygon points="10,26 72,26 84,36 72,46 10,46" fill="#c79a5c" stroke="#5a3d22" stroke-width="2"/>`
        + `<polygon points="14,52 66,52 76,60 66,68 14,68" fill="#b8894e" stroke="#5a3d22" stroke-width="2"/>`
        + `<ellipse cx="44" cy="98" rx="20" ry="3" fill="#000" opacity=".25"/></svg>`;
    }
    if (kind === 'green') {
      const W = Math.round(size * 1.5), H = Math.round(size * 1.15);
      return `<svg class="kwh-prop-art" width="${W}" height="${H}" viewBox="0 0 150 115" aria-hidden="true" shape-rendering="crispEdges">`
        + `<ellipse cx="75" cy="98" rx="70" ry="14" fill="#6f9a45"/><ellipse cx="75" cy="96" rx="62" ry="10" fill="#86b154"/>`
        + `<rect x="72" y="14" width="6" height="84" fill="#e8dcc0"/><circle cx="75" cy="12" r="5" fill="#d6463c"/>`
        + `<path d="M75 18 Q50 50 30 92" stroke="#d6463c" stroke-width="2.5" fill="none"/><path d="M75 18 Q100 50 120 92" stroke="#3c7fd6" stroke-width="2.5" fill="none"/>`
        + `<path d="M75 18 Q62 55 55 96" stroke="#e8c23c" stroke-width="2.5" fill="none"/><path d="M75 18 Q88 55 95 96" stroke="#a24fc4" stroke-width="2.5" fill="none"/></svg>`;
    }
    // The wonder site: stakes, a frame and scaffolding.
    const W = Math.round(size * 1.5), H = Math.round(size * 1.2);
    return `<svg class="kwh-prop-art" width="${W}" height="${H}" viewBox="0 0 150 120" aria-hidden="true" shape-rendering="crispEdges">`
      + `<ellipse cx="75" cy="110" rx="68" ry="8" fill="#000" opacity=".2"/><rect x="20" y="96" width="110" height="12" fill="#a08a6a"/>`
      + [30, 60, 90, 120].map(x => `<rect x="${x - 2}" y="20" width="5" height="78" fill="#7a5a36"/>`).join('')
      + [36, 62, 88].map(y => `<rect x="24" y="${y}" width="102" height="4" fill="#8b6a40"/>`).join('')
      + `<line x1="30" y1="96" x2="90" y2="20" stroke="#6b4a2e" stroke-width="3"/><line x1="60" y1="96" x2="120" y2="20" stroke="#6b4a2e" stroke-width="3"/>`
      + `<polygon points="70,0 82,10 70,20" fill="#d6463c"/><rect x="68" y="0" width="3" height="22" fill="#5a3d22"/></svg>`;
  }

  // The art for a building: its image from the manifest, else the hut.
  // → { html, native } (the glyph sits on the sign; .kwh-sign).
  function artHtml(key, vis, size, m = manifest) {
    const a = art(key, m);
    if (a) {
      const w = a.native ? a.w : Math.round(size * 1.53);
      return { native: a.native, html: `<img src="${esc(a.url)}" class="sv-building-img kwh-img${a.native ? ' kwh-native' : ''}" style="width:${w}px" alt="" draggable="false">` };
    }
    return { native: false, html: `<span class="kwh-ph">${hutSvg(vis || {}, size)}<span class="kwh-sign" aria-hidden="true">${esc((vis && vis.emoji) || '🏠')}</span></span>` };
  }

  // ── Bubbles (§2.4): one short line when something is waiting ──────────
  // Raised by realtime events (note) or read from the town's state. One per
  // building; the most urgent (lowest rank) wins.
  const raised = {};   // id → { text, rank, at }
  function raise(id, text, rank) {
    const cur = raised[id];
    if (!cur || rank <= cur.rank) raised[id] = { text, rank, at: Date.now() };
    redraw();
  }
  function clearBubble(id) { if (raised[id]) { delete raised[id]; redraw(); } }
  const short = (s, n = 18) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function note(type, ev) {
    ev = ev || {};
    if (type === 'research_done') raise('library', 'Research done', 2);
    else if (type === 'craft_done' && !ev.ruined) {
      const station = ev.station || (ev.resource ? 'smelter' : null);
      const what = ev.item && ev.item.name ? ev.item.name : ev.resource ? 'Smelting' : 'Craft';
      if (station) raise(station, short(what) + ' ready', 2);
    } else if (type === 'quest_resolved') raise('tavern', 'Back from a quest', 3);
  }

  // → { text, rank } or null. `state` from sceneState(); `dots` reads the
  // place bar's unread dots (id → bool).
  function bubble(id, state = sceneState(), dots = litDot) {
    const out = [];
    if (raised[id]) out.push(raised[id]);
    if (id === 'granary' && state.famine && state.famine.state && state.famine.state !== 'ok')
      out.push({ text: state.famine.state === 'famine' ? 'Famine!' : 'Food running low', rank: state.famine.state === 'low' ? 2 : 0 });
    if (id === 'neighbourhood' && state.beds != null && state.living != null && state.living > state.beds)
      out.push({ text: `No bed for ${state.living - state.beds}`, rank: 1 });
    if (id === 'market' && dots('nav-market')) out.push({ text: 'Market news', rank: 4 });
    if (id === 'green' && state.town && state.town.festival) {
      const f = state.town.festival;
      if (f.active) out.push({ text: 'Festival on!', rank: 3 });
      else if (f.can_start) out.push({ text: 'Festival ready', rank: 4 });
    }
    out.sort((a, b) => a.rank - b.rank);
    return out[0] || null;
  }
  function litDot(id) {
    const b = doc && doc.getElementById(id);
    return !!(b && (b.classList.contains('has-dot') || b.querySelector('.battle-badge, .has-dot')));
  }
  function bubbleHtml(id, state) {
    const b = bubble(id, state);
    return b ? `<span class="kwh-bubble${b.rank <= 1 ? ' kwh-bubble-urgent' : ''}">${esc(b.text)}</span>` : '';
  }
  // Refreshes every bubble in the open scene without a full re-render.
  function redraw() {
    if (!doc || !doc.querySelectorAll) return;
    const state = sceneState();
    doc.querySelectorAll('#settlement-view [data-kwh]').forEach(el => {
      const host = el.querySelector('.kwh-bubble-host');
      if (host) host.innerHTML = bubbleHtml(el.getAttribute('data-kwh'), state);
    });
  }

  // ── Nameplates (§2.4) ──────────────────────────────────────────────────
  // Shown on hover and focus; always with "Show names" on; and all of them
  // for 4 seconds when Home opens on a touch screen.
  const NAMES_KEY = 'kw_show_names', FIRST_KEY = 'kw_home_first_seen';
  const DAY = 86400000;
  function store(k, v) { try { if (v === undefined) return global.localStorage.getItem(k); if (v === null) global.localStorage.removeItem(k); else global.localStorage.setItem(k, v); } catch (_) { return null; } return null; }
  // On by default for the player's first 3 days (counted from their first
  // look at Home on this device), then off unless they chose it.
  function namesOn(now = Date.now(), get = store) {
    const v = get(NAMES_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
    const first = Number(get(FIRST_KEY)) || 0;
    return !first || now - first < 3 * DAY;
  }
  function setNames(on) { store(NAMES_KEY, on ? 'on' : 'off'); applyNames(); fillProfile(); }
  function applyNames() {
    const v = doc && doc.getElementById('settlement-view');
    if (v) v.classList.toggle('kwh-names', namesOn());
  }
  let _peek = 0;
  function homeShown() {
    if (!store(FIRST_KEY)) store(FIRST_KEY, String(Date.now()));
    applyNames();
    const v = doc.getElementById('settlement-view');
    const touch = global.matchMedia && global.matchMedia('(hover: none)').matches;
    if (v && touch) {
      v.classList.add('kwh-peek');
      clearTimeout(_peek);
      _peek = setTimeout(() => v.classList.remove('kwh-peek'), 4000);
    }
  }

  // The nameplate and aria-label for a building or prop.
  const label = (name, opens) => `${name}, ${opens.charAt(0).toLowerCase()}${opens.slice(1)}`;
  function plateHtml(name, opens, extra) {
    return `<span class="kwh-plate" aria-hidden="true"><b>${esc(name)}</b>${extra ? ` <span class="kwh-plate-lv">${esc(extra)}</span>` : ''}<span class="kwh-plate-opens">${esc(opens)}</span></span>`;
  }

  // ── The profile menu's list (§2.5) ─────────────────────────────────────
  // The same screens as the buildings, plainly, for screen readers and as a
  // fallback; and the Show names toggle.
  const has = t => !fn('_hasBuilding') || global._hasBuilding(t);
  function townList() {
    return [
      { key: 'stores',   label: '🎒 Stores',          run: () => call('openInventoryModal') },
      { key: 'upgrade',  label: '⬆️ Upgrade the town', run: () => call('openTierUpgradeModal') },
      { key: 'tavern',   label: '🍺 Tavern',           run: () => { leaveScene(); call('visitTavern'); } },
      { key: 'fishing',  label: '🎣 Fishing',          run: () => { leaveScene(); call('visitFishingPost'); } },
      { key: 'research', label: '📚 Research',         run: () => call('openLibrary'), unlock: () => has('library') },
      { key: 'crafting', label: '🔨 Crafting',         run: () => call('openCraftingAny'), unlock: () => has('craft:any') },
      { key: 'festival', label: '🎉 Festival',         run: () => global.KWTown && global.KWTown.open('festival'), unlock: () => !!global.KWTown },
      { key: 'wonders',  label: '🏛 Wonders',          run: () => global.KWTown && global.KWTown.open('wonders'), unlock: () => !!global.KWTown && has('tier:city') },
    ].filter(t => !t.unlock || t.unlock());
  }
  function fillProfile() {
    const box = doc && doc.getElementById('pm-town');
    if (!box) return;
    const on = namesOn();
    box.innerHTML = '<div class="profile-menu-label">In town</div>'
      + townList().map(t => `<button type="button" class="profile-menu-item" role="menuitem" data-kwh-pm="${t.key}">${esc(t.label)}</button>`).join('')
      + `<button type="button" class="profile-menu-item" role="menuitemcheckbox" aria-checked="${on}" data-kwh-pm="names">🏷 Show names: ${on ? 'on' : 'off'}</button>`;
    if (!box._wired) {
      box._wired = true;
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-kwh-pm]');
        if (!b) return;
        const k = b.getAttribute('data-kwh-pm');
        if (k === 'names') { setNames(!namesOn()); return; }
        call('closeProfileMenu');
        const t = townList().find(x => x.key === k);
        if (t) { try { t.run(); } catch (err) { console.error('[home]', err); } }
      });
    }
  }

  global.KWHome = {
    ROUTES, PROPS, route, open, props, openProp, sceneState,
    loadManifest, art, door, get manifest() { return manifest; },
    artHtml, propSvg, hutSvg, plateHtml, label,
    note, bubble, bubbleHtml, clearBubble, redraw,
    namesOn, setNames, applyNames, homeShown, townList, fillProfile,
    _setManifest: m => { manifest = m || {}; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
