// ══════════════════════════════════════════════════════════════════════════
//  KWContext — the context panel and the town card (docs/LAYOUT_SPEC.md §2.4,
//  the layout mockup).
//
//  Desktop: the old sidebar becomes a panel floating at the right of the
//  view. It shows only what was chosen (a tile on the map, your outposts,
//  the build list, the tier) and closes with ✕ or Escape; with nothing
//  chosen the map has the whole width. Its tabs and the old 11-button grid
//  are gone: each of those lives in a place now (js/places.js).
//  Phones keep the bottom sheet they already had (js/mobile-shell.js).
//
//  Home: with no panel open, the town card sits at the top right of the
//  scene: name, tier, species and beds; children, youths, adults, elders;
//  happiness and food; first steps; what is under way; today's chronicle.
//  On phones the card opens from a Town chip.
//
//    KWContext.open() / close() / isOpen()
//    KWContext.townHtml()      the card's contents (also the phone window)
//    KWContext.refreshTown()   redraw the card
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const isPhone = () => !!(doc.body && doc.body.classList.contains('kw-shell'));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = name => { try { return global[name] !== undefined ? global[name] : (0, eval)(`typeof ${name} !== 'undefined' ? ${name} : undefined`); } catch (e) { return undefined; } };

  // ── Opening only on the player's own action ─────────────────────────────
  // selectWorldTile and switchTab are also called by the game itself (boot,
  // refreshes, going to The Land). The panel opens only when the player has
  // just clicked, tapped or pressed a key.
  let lastInput = 0, muted = 0;
  const OPENERS = ['citizens', 'outposts', 'buildings', 'tier'];
  function allowOpen() {
    return !isPhone() && !muted && Date.now() - lastInput < 1500 && !!(global.KWPlaces && global.KWPlaces._started && global.KWPlaces._started());
  }
  function mute(fn) { muted++; try { return fn(); } finally { muted--; } }

  function open() {
    if (!doc.body) return;
    doc.body.classList.add('kwc-open');
    ensureClose();
  }
  function close() {
    if (!doc.body || !doc.body.classList.contains('kwc-open')) return;
    doc.body.classList.remove('kwc-open');
    refreshTown();
  }
  const isOpen = () => !!(doc.body && doc.body.classList.contains('kwc-open'));

  function ensureClose() {
    const sb = doc.getElementById('sidebar');
    if (!sb || sb.querySelector('.kwc-close')) return;
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'kwc-close';
    b.setAttribute('aria-label', 'Close');
    b.innerHTML = '<svg class="kw-icon" aria-hidden="true"><use href="#kw-i-close"/></svg>';
    b.addEventListener('click', close);
    sb.insertBefore(b, sb.firstChild);
  }

  function wrap() {
    const sel = global.selectWorldTile, sw = global.switchTab;   // and selectFogTile below
    if (typeof sel === 'function' && !sel._kwc) {
      global.selectWorldTile = function () { const r = sel.apply(this, arguments); if (allowOpen()) open(); return r; };
      global.selectWorldTile._kwc = true;
    }
    // A fog tile (scouting) shows in the panel too.
    const fog = global.selectFogTile;
    if (typeof fog === 'function' && !fog._kwc) {
      global.selectFogTile = function () { const r = fog.apply(this, arguments); if (allowOpen()) open(); return r; };
      global.selectFogTile._kwc = true;
    }
    if (typeof sw === 'function' && !sw._kwc) {
      global.switchTab = function (tab) { const r = sw.apply(this, arguments); if (OPENERS.includes(tab) && allowOpen()) open(); return r; };
      global.switchTab._kwc = true;
    }
  }

  // ── The town card ───────────────────────────────────────────────────────
  let chronicle = null, chronicleAt = 0;
  async function loadChronicle() {
    if (Date.now() - chronicleAt < 60000) return;
    chronicleAt = Date.now();
    try {
      const api = g('API') || global.KINDLEWOOD_API || '';
      const tok = (global.localStorage && global.localStorage.getItem('kw_token')) || '';
      const r = await global.fetch(api + '/api/families/all/chronicle', { headers: { Authorization: 'Bearer ' + tok } });
      if (r.ok) { chronicle = ((await r.json()).entries || []).slice(0, 3); refreshTown(); }
    } catch (e) { /* offline: the card goes without it */ }
  }
  const left = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim(); };
  const ago = at => { const m = Math.round((Date.now() - new Date(at).getTime()) / 60000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

  function townHtml() {
    const gd = g('gameData') || {}, s = gd.settlement || {};
    const cits = (g('citizensData') || []).filter(c => (c.stage || c.life_stage) !== 'deceased');
    const stage = c => c.stage || (c.life_stage === 'child' ? 'child' : 'adult');
    const n = k => cits.filter(c => stage(c) === k).length;
    const beds = typeof s.beds === 'number' ? s.beds : null;
    const working = cits.filter(c => ['adult', 'elder'].includes(stage(c)));
    const happy = working.length ? Math.round(working.reduce((t, c) => t + (c.life?.happiness ?? c.happiness ?? 70), 0) / working.length) : null;
    const food = gd.food_rate ?? null;
    // Under way: outpost buildings going up, citizens out on quests, a raid coming.
    const under = [];
    const op = g('_outpostStatus');
    for (const o of ((op && op.outposts) || [])) for (const b of ((o.buildings && o.buildings.built) || [])) {
      if (!b.ready && b.ready_at) under.push([`${b.name || b.key} at ${o.name || 'an outpost'}`, left(new Date(b.ready_at) - Date.now())]);
    }
    const questers = cits.filter(c => c.active_quest).length;
    if (questers) under.push([`${questers} on ${questers === 1 ? 'a quest' : 'quests'}`, '']);
    const raid = s.raid;   // js/raids.js keeps the raid on its way here
    if (raid && raid.arrives_at && !raid.resolved_at) under.unshift([`Raiders strike ${raid.target_name || 'the town'}`, left(new Date(raid.arrives_at) - Date.now())]);
    const fs = global.KWFirstSteps ? global.KWFirstSteps.cardHtml() : '';
    return `<div class="kwc-town-name">${esc(s.name || 'Your town')}</div>`
      + `<div class="kwc-town-sub">${esc(cap(s.tier || 'camp'))} · ${esc(cap(gd.species || s.species || ''))}${beds != null ? ` · Beds ${cits.length} of ${beds}` : ''}</div>`
      + `<div class="kwc-ages">${[['Children', n('child')], ['Youths', n('youth')], ['Adults', n('adult')], ['Elders', n('elder')]]
          .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>`
      + `<div class="kwc-mood">${happy != null ? `<span>😊 ${happy}% happy</span>` : ''}${food != null ? `<span class="${food < 0 ? 'kwc-bad' : ''}">🍖 food ${food >= 0 ? '+' : ''}${Math.round(food * 10) / 10}/hr</span>` : ''}</div>`
      + (fs ? `<div id="fs-slot" class="kwc-fs">${fs}</div>` : '<div id="fs-slot"></div>')
      + (under.length ? `<div class="kwc-h">Under way</div>` + under.slice(0, 4).map(([t, v]) => `<div class="kwc-row"><span>${esc(t)}</span><span>${esc(v)}</span></div>`).join('') : '')
      + (chronicle && chronicle.length ? `<div class="kwc-h">Today</div>` + chronicle.map(e => `<p class="kwc-line">${esc(e.text)} <span class="kwc-when">${ago(e.at)}</span></p>`).join('') : '')
      + `<button type="button" class="kwc-more" data-kwc="families">The families and the whole chronicle</button>`;
  }
  function refreshTown() {
    const card = doc.getElementById('kw-town-card');
    if (!card) return;
    const home = global.KWPlaces && global.KWPlaces.current && global.KWPlaces.current() === 'home';
    if (!home || isPhone() || isOpen()) return;
    card.innerHTML = townHtml();
    loadChronicle();
  }
  function openTownWindow() {
    if (!global.KWWindow) return;
    global.KWWindow.open({ id: 'town', title: (g('gameData') || {}).settlement?.name || 'Your town', icon: 'home', size: 'S',
      render(body) { body.innerHTML = townHtml(); body.classList.add('kwc-town'); }, actions: {} });
    loadChronicle();
  }

  function build() {
    const screen = doc.getElementById('screen-game');
    if (!screen || doc.getElementById('kw-town-card')) return;
    // The panel leaves the game body: that is its own layer (5, over the
    // decorative guards), which kept the panel under the Home scene (800).
    // Phone and desktop rules both key off #screen-game, so nothing else moves.
    const sb = doc.getElementById('sidebar');
    if (sb && sb.parentNode !== screen) screen.appendChild(sb);
    const card = doc.createElement('aside');
    card.id = 'kw-town-card';
    card.className = 'kwc-town';
    card.setAttribute('aria-label', 'Your town');
    screen.appendChild(card);
    doc.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-kwc="families"]');
      if (!b) return;
      if (global.KWWindow && global.KWWindow.isOpen('town')) global.KWWindow.close('town');
      if (global.KWFamilies) global.KWFamilies.open();
    });
  }

  function boot() {
    build();
    wrap();
    const mark = () => { lastInput = Date.now(); };
    doc.addEventListener('pointerdown', mark, true);
    doc.addEventListener('keydown', mark, true);
    doc.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !isOpen() || isPhone()) return;
      if (global.KWWindow && global.KWWindow.isOpen()) return;   // a window takes Escape first
      if (global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen()) return;
      close();
    });
    setInterval(refreshTown, 20000);
  }
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot(); }

  global.KWContext = { open, close, isOpen, mute, townHtml, refreshTown, openTownWindow, _allowOpen: allowOpen, _wrap: wrap };
})(typeof window !== 'undefined' ? window : globalThis);
