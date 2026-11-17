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
  // ── Leaving for a full screen, and coming back ─────────────────────────
  // The Tavern, the Market and Fishing are full screens that sit over the
  // Land, so Home closes for them. A return ticket remembers where the player
  // stood (which part of town, and how far along); when the screen is closed
  // Home opens again right there. Going somewhere else with the place bar
  // (js/places.js) tears the ticket up: the player chose where to go.
  const SCREENS = {
    tavern:  () => shownEl('tavern-overlay'),
    fishing: () => shownEl('fishing-overlay'),
    market:  () => { const m = doc.getElementById('market-panel'); return !!(m && m.classList.contains('open')); },
  };
  const shownEl = id => { const e = doc.getElementById(id); return !!(e && global.getComputedStyle(e).display !== 'none'); };
  let ticket = null, watching = null;
  // What to do with a ticket now. `open`: its screen is showing. Pure.
  // → 'wait' (not opened yet, or still open), 'back' (it was open and is
  // closed: go back), 'drop' (it never opened).
  function ticketStep(t, open, now) {
    if (open) return 'wait';
    if (t.seen) return 'back';
    return now - t.at > 5000 ? 'drop' : 'wait';
  }
  function leaveFor(screen) {
    const sc = doc.getElementById('sv-scene');
    if (fn('_svIsOpen') && global._svIsOpen() && SCREENS[screen]) ticket = { screen, area: call('_svActiveAreaName') || 'town', x: sc ? sc.scrollLeft : 0, seen: false, at: Date.now() };
    call('closeSettlementView');
    if (ticket && !watching) watching = setInterval(watch, 250);
  }
  function watch() {
    if (!ticket) { clearInterval(watching); watching = null; return; }
    const open = SCREENS[ticket.screen]();
    if (open) ticket.seen = true;
    const what = ticketStep(ticket, open, Date.now());
    if (what === 'drop') ticket = null;
    else if (what === 'back') comeBack();
  }
  async function comeBack() {
    const t = ticket;
    ticket = null;
    if (!t) return;
    if (global.KWPlaces && global.KWPlaces.go) global.KWPlaces.go('home'); else await call('openSettlementView');
    // Where they stood: the same part of town, the same place along it.
    const put = () => { call('_svSwitchArea', t.area, true); const sc = doc.getElementById('sv-scene'); if (sc) sc.scrollLeft = t.x; };
    put(); setTimeout(put, 60); setTimeout(put, 400);   // (the scene sizes itself as it opens)
  }
  const forgetReturn = () => { ticket = null; };
  const leaveScene = leaveFor;

  // ── What a building opens (§2.2) ───────────────────────────────────────
  // `opens` is the nameplate's second line and the end of the aria-label.
  // `leave`: the screen opens over the map, so the scene closes first.
  // A building not listed opens its own panel (workers, output, upgrade).
  const craft = station => ({ opens: 'Craft here', run: () => call('openCrafting', station) });
  const ROUTES = {
    granary:       { opens: 'Open the Stores',      run: () => call('openInventoryModal') },
    tavern:        { opens: 'Visit the tavern',     run: () => call('visitTavern'), leave: 'tavern' },
    market:        { opens: 'Open the market',      run: () => call('openMarket'), leave: 'market' },
    library:       { opens: 'Open Research',        run: () => call('openLibrary') },
    workshop:      craft('workshop'),
    smithy:        craft('smithy'),
    jeweller:      craft('jeweller'),
    smelter:       craft('smelter'),
    guild_hall:    { opens: 'Upgrade the town',     run: () => call('openTierUpgradeModal') },
    neighbourhood: { opens: 'Walk to the homes',    run: () => (global.KWHood ? global.KWHood.open() : null) },
    fishing_post:  { opens: 'Go fishing',           run: () => call('visitFishingPost'), leave: 'fishing' },
  };
  const PANEL = { opens: 'Workers and upgrades', panel: true };
  const route = id => ROUTES[id] || PANEL;

  // Runs what a building opens. `panel` is the scene's own panel opener,
  // used for buildings with no screen of their own. Clears its bubble.
  function open(id, panel) {
    const r = route(id);
    clearBubble(id);
    if (r.panel) { if (panel) panel(); return 'panel'; }
    if (r.leave) leaveFor(r.leave);   // a full screen: Home closes, and opens again here when it does
    try { r.run(); } catch (e) { console.error('[home]', e); }
    return id;
  }

  // ── Props (§2.2): not buildings, but places in the scene ───────────────
  // x, y are percent of the world (y is the foot), as for slots. `show(state)`
  // decides. The signposts stand at the two ends of the walk between areas:
  // Town's right end leads to the Outskirts' left end, and back.
  const PROPS = [
    { id: 'signpost-out',  kind: 'signpost', area: 'town',      x: 97, y: 93, label: 'To the Outskirts →', opens: 'Walk to the Outskirts',
      run: () => call('_svSwitchArea', 'outskirts', false, 'start') },
    { id: 'signpost-town', kind: 'signpost', area: 'outskirts', x: 3,  y: 93, label: '← To town', opens: 'Walk back to town', flip: true,
      run: () => call('_svSwitchArea', 'town', false, 'end') },
    // The Neighbourhood's way back; it lands by the Neighbourhood's door (68 % along Town).
    { id: 'signpost-hood', kind: 'signpost', area: 'neighbourhood', x: 4, y: 93, label: '← To town', opens: 'Walk back to town', flip: true,
      run: () => call('_svSwitchArea', 'town', false, 0.68 * 2600) },
    { id: 'green',         kind: 'green',    area: 'town',      x: 7,  y: 95, label: 'Village green', opens: 'Hold a festival',
      run: () => global.KWTown && global.KWTown.open('festival'), show: s => !!s.festivals },
    { id: 'wonder-site',   kind: 'wonder',   area: 'outskirts', x: 95, y: 94, label: 'Wonder site', opens: 'Build a Wonder',
      run: () => global.KWTown && global.KWTown.open('wonders'), show: s => s.tier === 'city' && !!s.festivals },
  ];
  const cits = () => (typeof citizensData !== 'undefined' ? citizensData : global.citizensData);   // eslint-disable-line no-undef
  // What the props read: the tier, and whether the town screens exist.
  function sceneState() {
    const gd = global.gameData || null, s = gd && gd.settlement;
    return { tier: (s && s.tier) || 'camp', festivals: !!global.KWTown, town: (s && s.town) || null,
      famine: (s && s.famine) || null, raid: (s && s.raid) || null, beds: s && typeof s.beds === 'number' ? s.beds : null,
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

  // ── The manifest (docs/ART_GUIDE.md §3) ───────────────────────────────
  // assets/images/scene_v2/buildings/manifest.v2.json:
  // { "<key>": { "file": "tavern.webp", "lit": "tavern_lit.webp", "w": 331, "h": 320,
  //              "door": [162, 316], "native": true, "smooth": true, "scale": 2 } }
  // w, h and door are on-screen pixels; the files are `scale` times that. A key
  // with no entry is drawn as the placeholder hut, door at its doorstep. (The
  // painted scene's assets/images/buildings/manifest.json is no longer read:
  // that art doesn't belong in the new look.)
  const ART_BASE = '/assets/images/scene_v2/buildings/';
  const MANIFEST_URL = ART_BASE + 'manifest.v2.json';
  let manifest = {}, _mLoading = null;
  function loadManifest() {
    if (_mLoading) return _mLoading;
    _mLoading = (typeof fetch === 'function' ? fetch(MANIFEST_URL, { cache: 'no-cache' }) : Promise.reject())
      .then(r => (r.ok ? r.json() : {})).catch(() => ({}))
      .then(j => { manifest = j && typeof j === 'object' ? j : {}; return manifest; });
    return _mLoading;
  }
  // The Neighbourhood's door in Town is a cluster of the house drawings until
  // its own art exists: three homes, a little smaller, overlapping.
  const CLUSTER = [{ key: 'house_timber', x: 0, y: 6 }, { key: 'house_stone', x: 118, y: 0 }, { key: 'house_thatch', x: 62, y: 40 }];
  const CLUSTER_SCALE = 0.62;
  function cluster(m) {
    const parts = CLUSTER.map(c => ({ ...c, e: m[c.key] })).filter(c => c.e && c.e.file);
    if (parts.length < CLUSTER.length) return null;
    const w = Math.round(Math.max(...parts.map(c => c.x + c.e.w * CLUSTER_SCALE)));
    const h = Math.round(Math.max(...parts.map(c => c.y + c.e.h * CLUSTER_SCALE)));
    const front = parts[parts.length - 1];
    return { w, h, native: true, smooth: true, cluster: parts.map(c => ({ x: c.x, y: c.y, w: Math.round(c.e.w * CLUSTER_SCALE), h: Math.round(c.e.h * CLUSTER_SCALE),
      url: ART_BASE + c.e.file, lit: c.e.lit ? ART_BASE + c.e.lit : null })),
      door: { x: front.x + front.e.door[0] * CLUSTER_SCALE, y: front.y + front.e.door[1] * CLUSTER_SCALE } };
  }
  function art(key, m = manifest) {
    if (key === 'neighbourhood' && !(m && m.neighbourhood)) return cluster(m || {});
    const e = m && m[key];
    if (!e || !e.file) return null;
    const w = Number(e.w) || 0, h = Number(e.h) || 0;
    const door = Array.isArray(e.door) && e.door.length === 2 ? { x: Number(e.door[0]), y: Number(e.door[1]) } : { x: w / 2, y: h };
    // Where its smoke, forge fire and sawdust come from (js/home-ambient.js), in the picture's own pixels.
    const pt = v => (Array.isArray(v) && v.length === 2 ? [Number(v[0]), Number(v[1])] : null);
    return { url: ART_BASE + e.file, lit: e.lit ? ART_BASE + e.lit : null, w, h, door, native: e.native !== false, smooth: e.smooth !== false,
      smoke: (Array.isArray(e.smoke) ? e.smoke : []).map(pt).filter(Boolean), fire: pt(e.fire), dust: pt(e.dust) };
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
  // A prop's drawing: its image from the manifest when there is one (the
  // village green), else the placeholder drawn by code.
  const PROP_ART = { green: 'village_green', wonder: 'wonder_site', signpost: 'signpost' };
  function propArt(kind, size, flip, m = manifest) {
    const key = PROP_ART[kind];
    if (key && art(key, m)) return artHtml(key, {}, size, m).html.replace('class="kwh-art', 'class="kwh-art kwh-flat kwh-prop-img');
    return propSvg(kind, size, flip);
  }
  function propSvg(kind, size, flip) {
    if (kind === 'signpost') {
      const W = Math.round(size * 0.9), H = Math.round(size * 1.0);   // signpost
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

  // The art for a building: its images from the manifest (the daytime one,
  // and the lit one on top, shown in the evening and at night), else the
  // placeholder hut. Either sits in a .kwh-art box with its shadow drawn by
  // code under it. → { html, native }.
  const PH_SIZE = 170;   // the hut beside the new buildings (about a house's size)
  function imgs(url, lit, style) {
    return `<img src="${esc(url)}" class="kwh-img kwh-day" alt="" draggable="false"${style || ''}>`
      + (lit ? `<img src="${esc(lit)}" class="kwh-img kwh-lit" alt="" draggable="false" loading="lazy"${style || ''}>` : '');
  }
  function artHtml(key, vis, size, m = manifest) {
    const a = art(key, m);
    if (a && a.cluster) {
      return { native: true, html: `<span class="kwh-art kwh-cluster" style="width:${a.w}px;height:${a.h}px">`
        + a.cluster.map(c => `<span class="kwh-part" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">${imgs(c.url, c.lit)}</span>`).join('')
        + '</span>' };
    }
    if (a) return { native: true, html: `<span class="kwh-art${a.lit ? ' kwh-has-lit' : ''}" style="width:${a.w}px;height:${a.h}px">${imgs(a.url, a.lit)}</span>` };
    const ph = Math.max(size || 0, PH_SIZE);
    return { native: false, html: `<span class="kwh-art kwh-ph">${hutSvg(vis || {}, ph)}<span class="kwh-sign" aria-hidden="true">${esc((vis && vis.emoji) || '🏠')}</span></span>` };
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
  function setNames(on) {
    store(NAMES_KEY, on ? 'on' : 'off'); applyNames(); fillProfile();
    if (global.KWPlaces && global.KWPlaces.refreshTools) global.KWPlaces.refreshTools();   // the Names chip
  }
  // N toggles them while Home shows (not while typing or with a window up).
  if (doc && doc.addEventListener) doc.addEventListener('keydown', e => {
    if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (typeof global._svIsOpen !== 'function' || !global._svIsOpen()) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if ((global.KWWindow && global.KWWindow.isOpen()) || (global.KWDialog && global.KWDialog.isOpen()) || (global.KWA11y && global.KWA11y.topmost())) return;
    e.preventDefault();
    setNames(!namesOn());
  });
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
      { key: 'tavern',   label: '🍺 Tavern',           run: () => { leaveFor('tavern'); call('visitTavern'); } },
      { key: 'fishing',  label: '🎣 Fishing',          run: () => { leaveFor('fishing'); call('visitFishingPost'); } },
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

  // ── Night (docs/ART_GUIDE.md §4.6) ─────────────────────────────────────
  // One multiply overlay tints the whole world (.sv-night, css/home-scene.css):
  // ×0.72, ×0.80, ×1.00 on red, green and blue at night, ×0.92, ×0.80, ×0.86 in
  // the evening. Labels take the inverse, so they read as they do by day.
  const TINTS = { night: [0.72, 0.80, 1.0], dusk: [0.92, 0.80, 0.86] };
  function nightFilters() {
    if (!doc || !doc.body || doc.getElementById('kwn-filters')) return;
    const m = ([r, g, b]) => `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;
    const undo = t => t.map(x => +(1 / x).toFixed(4));
    const svg = '<svg id="kwn-filters" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>'
      + Object.entries(TINTS).map(([id, t]) => `<filter id="kwn-undo-${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${m(undo(t))}"/></filter>`).join('')
      + '</defs></svg>';
    doc.body.insertAdjacentHTML('beforeend', svg);
  }
  if (doc && doc.readyState !== 'loading') nightFilters(); else if (doc) doc.addEventListener('DOMContentLoaded', nightFilters);

  // The lit windows' glow: what the lit image adds to the day image (pixels
  // that changed by more than GLOW_MIN in all), drawn above the overlay in
  // screen mode with a soft halo. Pure on pixel arrays; cached per image pair.
  const GLOW_MIN = 48;
  function glowPixels(lit, day, out) {
    for (let i = 0; i < lit.length; i += 4) {
      const r = lit[i] - day[i], g = lit[i + 1] - day[i + 1], b = lit[i + 2] - day[i + 2];
      const on = lit[i + 3] > 0 && r + g + b > GLOW_MIN;
      out[i] = on ? Math.max(0, r) : 0; out[i + 1] = on ? Math.max(0, g) : 0; out[i + 2] = on ? Math.max(0, b) : 0;
      out[i + 3] = on ? 255 : 0;
    }
    return out;
  }
  const glows = {};   // "lit|day" → Promise<url or null>
  function loadImg(url) {
    return new Promise(res => { const im = new global.Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  }
  function glowFor(litUrl, dayUrl) {
    const key = litUrl + '|' + dayUrl;
    if (glows[key]) return glows[key];
    glows[key] = Promise.all([loadImg(litUrl), loadImg(dayUrl)]).then(([lit, day]) => {
      if (!lit || !day || !doc) return null;
      const w = lit.naturalWidth, h = lit.naturalHeight;
      const cv = doc.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(day, 0, 0, w, h); const d = cx.getImageData(0, 0, w, h);
      cx.clearRect(0, 0, w, h); cx.drawImage(lit, 0, 0, w, h); const l = cx.getImageData(0, 0, w, h);
      cx.putImageData(new global.ImageData(glowPixels(l.data, d.data, new Uint8ClampedArray(l.data.length)), w, h), 0, 0);
      // A soft halo under the sharp glow (canvas filters are missing on some
      // browsers; then the glow is just sharp).
      const out = doc.createElement('canvas'); out.width = w; out.height = h;
      const ox = out.getContext('2d');
      if ('filter' in ox) { ox.filter = `blur(${Math.round(w / 60)}px)`; ox.globalAlpha = 0.9; ox.drawImage(cv, 0, 0); ox.filter = 'none'; ox.globalAlpha = 1; }
      ox.globalCompositeOperation = 'lighter'; ox.drawImage(cv, 0, 0);
      return new Promise(res => out.toBlob(b => res(b ? global.URL.createObjectURL(b) : null), 'image/png'));
    }).catch(() => null);
    return glows[key];
  }
  // Puts a glow over every lit image in the shown area, in world pixels.
  // Called after the scene draws, on resize and when the phase changes.
  let glowRun = 0;
  function syncGlow() {
    const box = doc && doc.getElementById('sv-glow'), world = doc && doc.getElementById('sv-world');
    if (!box || !world) return;
    const run = ++glowRun;
    const layer = world.querySelector('.sv-fg-layer:not(.sv-area-hidden)');
    const wr = world.getBoundingClientRect(), k = world.offsetWidth ? wr.width / world.offsetWidth : 1;
    const want = [];
    if (layer) layer.querySelectorAll('.kwh-lit').forEach(lit => {
      const btn = lit.closest('.kwh-btn');
      if (btn) btn.classList.add('kwh-glows');
      if (lit.closest('.kwh-dark') || lit.closest('.kwb-min')) return;   // dark, or see-through (js/building-menu.js)
      const day = lit.parentNode && lit.parentNode.querySelector('.kwh-day');
      if (!day || day.src === lit.src) return;
      const r = (lit.parentNode.getBoundingClientRect());
      want.push({ lit: lit.src, day: day.src, x: (r.left - wr.left) / k, y: (r.top - wr.top) / k, w: r.width / k, h: r.height / k });
    });
    Promise.all(want.map(g => glowFor(g.lit, g.day))).then(urls => {
      if (run !== glowRun) return;
      box.innerHTML = want.map((g, i) => urls[i] ? `<img src="${urls[i]}" alt="" draggable="false" style="left:${g.x.toFixed(1)}px;top:${g.y.toFixed(1)}px;width:${g.w.toFixed(1)}px;height:${g.h.toFixed(1)}px">` : '').join('');
    });
  }

  global.KWHome = {
    ROUTES, PROPS, route, open, props, openProp, sceneState,
    leaveFor, forgetReturn, _ticketStep: ticketStep, _ticket: () => ticket, SCREENS: Object.keys(SCREENS),
    loadManifest, art, door, get manifest() { return manifest; },
    artHtml, propSvg, propArt, hutSvg, plateHtml, label, ART_BASE, PH_SIZE,
    note, bubble, bubbleHtml, clearBubble, redraw,
    namesOn, setNames, applyNames, homeShown, townList, fillProfile, nightFilters, NIGHT_TINTS: TINTS,
    syncGlow, glowFor, _glowPixels: glowPixels, GLOW_MIN,
    _setManifest: m => { manifest = m || {}; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
