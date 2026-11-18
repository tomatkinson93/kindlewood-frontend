// ══════════════════════════════════════════════════════════════════════════
//  KWGuide — the guide's tour (docs/PHASE_3_ONBOARDING.md).
//
//  An elder of the player's species walks a new player through their first
//  session: a line or two, then one thing to do, which is ringed on the
//  screen. The server holds which beat the player is on and decides when it
//  is done (lib/guide.js there); this file shows the lines (KWSay.tell, the
//  story layout: the character large at the lower left, a parchment box with
//  their name and one line), keeps a small chip while it waits, rings the
//  thing to press, and asks the server whether the beat is done.
//
//  It never blocks: everything in the game works whatever the beat. "Skip
//  the tour" is always there, and skipping gives every gift the tour would
//  have given.
//
//  The character art: /assets/images/guide/<species>.webp (docs/ART_GUIDE.md
//  §8, batch T). Until a picture is there the species' emoji stands in.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const TICK_MS = 2500, RING_MS = 250;
  const EMOJI = { Mice: '🐭', Badgers: '🦡', Otters: '🦦', Moles: '🐹', Foxes: '🦊', Hares: '🐇' };
  const NAME = { food: 'food', timber: 'timber', stone: 'stone', metal: 'iron', wealth: 'wealth' };
  const S = { g: null, told: null, telling: false, busy: false, timer: null, ringTimer: null, loading: null };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  const characterUrl = species => `/assets/images/guide/${String(species || 'Mice').toLowerCase()}.webp`;
  const giftLine = given => Object.entries(given || {}).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${NAME[k] || k}`).join(' and ');
  // What a beat the screen reports is waiting for, read from the page. `page`: what is true now.
  function clientDid(until, page) {
    const u = String(until || '').replace(/^client:/, '');
    if (u === 'selected:villager') return page.selected ? u : null;
    if (u === 'opened:families') return page.familiesWindow ? u : null;
    if (u === 'area:neighbourhood') return page.area === 'neighbourhood' ? u : null;
    if (u === 'place:families') return page.place === 'families' || page.familiesWindow ? u : null;
    if (u === 'place:land') return page.place === 'land' ? u : null;
    return null;
  }
  // Where to ring, most exact first: the list of things to look for, by what is on the page now.
  // `page`: { building (Build mode), menu (a villager's menu is open), panel (the build panel is open), houseWindow, area }.
  // `want`: the building the beat asks for (from "built:<type>"), so the right row of the build list is ringed.
  function targets(point, page, who, area, want) {
    const p = String(point || ''), w = who || {};
    // Building time: something for this beat is being built and the elder's help is left. Finish now, on the chip.
    if (page.finish && !page.panel && (p === 'tool:build' || p === 'plot:any')) return ['chip:finish'];
    // The beat is on Home and the player is on The Land: Home first. (Families and the rest are windows over
    // Home: for those the window's close button is ringed, in find.)
    if (p && !/^(place:|land:|moment:)/.test(p) && page.place === 'land') return ['place:home'];
    // Already in the Neighbourhood: there is nothing left to point at (it used to flash the way back to town).
    if (p === 'building:neighbourhood' && page.area === 'neighbourhood') return [];
    // The beat happens in another part of Home: lead there first.
    if (area && page.area && page.area !== area && p !== 'building:neighbourhood') {
      if (page.bmenu) return ['bmenu:enter'];
      return area === 'neighbourhood' && page.area === 'town' ? ['building:neighbourhood'] : ['tool:totown', 'signpost:town'];
    }
    // A villager's page is open: the job is chosen there; for anything else it is in the way.
    if (page.profile) return p === 'villager-menu:work' ? ['modal:role', 'modal:close'] : ['modal:close'];
    // Villagers (and, on a phone, the moment cards) are hidden while building: Done comes first.
    if (page.building && (/^villager/.test(p) || p === 'moment:first')) return ['tool:build'];
    if (p === 'villager:any') return [w.a ? `villager:${w.a}` : null, 'villager'].filter(Boolean);
    if (p === 'villager-menu:family') return page.menu ? ['menu:family'] : [w.a ? `villager:${w.a}` : null, 'villager'].filter(Boolean);
    if (p === 'villager-menu:work') return page.menu ? ['menu:work'] : [w.b ? `villager:${w.b}` : null, w.a ? `villager:${w.a}` : null, 'villager'].filter(Boolean);
    if (p === 'building:neighbourhood') return page.bmenu ? ['bmenu:enter'] : page.area === 'town' ? ['building:neighbourhood'] : ['signpost:town'];
    // The build list: the row of the building the beat wants, and never another one in its place.
    if (p === 'tool:build' || p === 'plot:any') return page.panel ? (want ? [`panel:type:${want}`] : ['panel:build', 'plot']) : page.building ? ['plot'] : ['tool:build'];
    if (p === 'house:any') return page.houseWindow ? ['house:in'] : page.bmenu ? ['bmenu:enter'] : page.building ? ['tool:build'] : ['house:free', 'house'];
    if (p === 'place:families' || p === 'place:land') return [p];
    // The Land: the place, then a tile in the mist beside the town, then Dispatch once that tile's panel is up.
    if (p === 'land:fog') return page.place !== 'land' ? ['place:land'] : page.scoutPanel ? ['land:dispatch', 'land:tile'] : ['land:tile'];
    if (p === 'moment:first') return ['moment', 'villager:marked'];
    return [];
  }
  const SELECTOR = {
    villager: '#settlement-view .kwv-cit:not(.kwv-gone)',
    'villager:marked': '#settlement-view .kwv-cit:not(.kwv-gone):has(.kwv-mark)',   // the villager, not the "!" above them: the mark takes no presses
    'menu:family': '.kwv-radial [data-kwv-act="family"]', 'menu:work': '.kwv-radial [data-kwv-act="work"], .kwv-radial [data-kwv-act="apprentice"]',
    'building:neighbourhood': '#settlement-view .sv-fg-layer:not(.sv-area-hidden) .sv-building[data-kwh="neighbourhood"] .kwh-art',
    'signpost:town': '#sv-prop-signpost-hood .kwh-btn, #sv-prop-signpost-town .kwh-btn',
    'tool:build': '#kw-place-tools [data-tool="build"]',
    'tool:totown': '#kw-place-tools [data-tool="totown"]',
    plot: '#settlement-view .sv-fg-layer:not(.sv-area-hidden) .kwn-stake, #settlement-view .sv-fg-layer:not(.sv-area-hidden) .sv-slot:not([hidden]) .sv-slot-empty:not(.locked)',
    // The button that builds: a home's (the plot panel in the Neighbourhood). A named building's row is `panel:type:<id>` (see find).
    'panel:build': '#sv-build-panel.open .kwn-build, #sv-build-panel.open .sv-bp-build-btn',
    'modal:role': '#citizen-profile-modal.open .cp-role-select', 'modal:close': '#citizen-profile-modal.open .citizen-profile-close',
    'bmenu:enter': '.kwb-enter',
    'house:free': '#settlement-view .sv-fg-layer:not(.sv-area-hidden) .kwn-slot[data-house]:not([data-free="0"]) .kwh-art',   // a home with a bed to spare
    house: '#settlement-view .sv-fg-layer:not(.sv-area-hidden) .kwn-slot[data-house] .kwh-art',
    'house:in': '.kww [data-action="in"]',
    'chip:finish': '#kwgd-chip [data-kwgd="finish"]',
    'place:families': '.kwp-place[data-place="families"]', 'place:land': '.kwp-place[data-place="land"]', 'place:home': '.kwp-place[data-place="home"]',
    'land:dispatch': '.btn-send-scout:not([disabled])',
    moment: '#kw-moments [data-kwm]',
  };
  // The chip's words while it waits.
  function chipHtml(g, now) {
    if (!g || g.state !== 'active' || !g.beat) return '';
    const b = g.beat;
    // A quiet wait (someone is out scouting): how long is left.
    let act = '';
    if (b.wait_until) {
      const left = Math.max(0, Math.ceil((new Date(b.wait_until).getTime() - now) / 1000));
      act = `<span class="kwgd-wait">${left > 0 ? 'back in ' + (left >= 90 ? Math.ceil(left / 60) + ' min' : left + ' s') : 'any moment now'}</span>`;
    }
    const fin = g.finish && g.finish.left > 0 && (g.finish.sites || []).length
      ? `<button type="button" class="kwgd-act kwgd-finish" data-kwgd="finish" data-site="${g.finish.sites[0].id}" title="${g.finish.left} left during the tour">⏩ Finish now</button>` : '';
    return `<span class="kwgd-face" aria-hidden="true">${EMOJI[g.elder.species] || '🍂'}</span>`
      + `<span class="kwgd-words"><b>${esc(g.elder.name)}</b><span class="kwgd-hint">${esc(b.hint || 'Listen')}</span></span>`
      + act + fin
      + ((b.say || []).length ? `<button type="button" class="kwgd-small" data-kwgd="again" aria-label="Hear that again" title="Hear that again">↺</button>` : '')
      + `<button type="button" class="kwgd-small" data-kwgd="skip">Skip the tour</button>`
      + `<span class="kwgd-n" aria-label="Step ${b.n} of ${b.of}">${b.n}/${b.of}</span>`;
  }

  // ── The server ──────────────────────────────────────────────────────────
  const signedIn = () => { try { return !!global.localStorage.getItem('kw_token'); } catch (_) { return false; } };
  async function call(path, body, method) {
    const r = await global.apiFetch('/api/guide' + path, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) return { error: d.error || 'That did not work. Try again.' };
    return d;
  }
  function take(g) {
    if (!g) return;
    const was = S.g && S.g.beat ? S.g.beat.key : null, before = S.g && S.g.unlock, wasState = S.g ? S.g.state : null;
    S.g = g;
    // The tour began or ended: the first-steps list hides during it and is the elder's "what next?" after (js/first-steps.js).
    if (wasState !== g.state && global.KWFirstSteps && global.KWFirstSteps.load) { try { const r = global.KWFirstSteps.load(true); if (r && r.catch) r.catch(() => {}); } catch (_) { /* later */ } }
    // A place has just opened (a Tavern brings The Road, a Guild Hall The Clan): the elder says so, once.
    if (before && g.state !== 'active') { if (!before.road && g.unlock.road) setTimeout(() => S.later && S.later('road'), 800); else if (!before.clan && g.unlock.clan) setTimeout(() => S.later && S.later('clan'), 800); }
    if (global.KWPlaces && global.KWPlaces.setLocked) global.KWPlaces.setLocked({ road: !g.unlock.road, clan: !g.unlock.clan });
    // A gift: the box says it under the elder's line (speak). A toast only where there is no box to say it (a skip).
    for (const j of g.just || []) if (j.given && giftLine(j.given)) { if (g.state !== 'active') toast(`🎁 ${g.elder.name} gave you ${giftLine(j.given)}.`, 'success'); if (typeof global.refreshResources === 'function') { try { global.refreshResources(); } catch (_) { /* later */ } } }
    if (g.finished) toast(`🌿 That is the tour. ${g.elder.name} is in Help if you want it again.`, 'success');
    const closeTell = () => { if (S.telling && global.KWSay && global.KWSay.isTelling && global.KWSay.isTelling()) global.KWSay.close(); };
    if (g.state !== 'active') { S.told = null; closeTell(); paint(); return; }
    // Someone was moved in by hand, and the rest have just found their own beds (the server did that as the
    // beat ended): the homes, their open window and the villagers are read again, so nothing shows the old count.
    if (was === 'move_in' && g.beat.key !== 'move_in') {
      try { if (global.KWHood && global.KWHood.reload) { const r = global.KWHood.reload(true); if (r && r.catch) r.catch(() => {}); } } catch (_) { /* later */ }
      if (typeof global.loadCitizens === 'function') { try { const r = global.loadCitizens(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* later */ } }
    }
    // A moment is wanted: make sure the screen has it (it may have started on the server a moment ago).
    if (g.beat.key === 'moment' && was !== 'moment' && global.KWMoments && global.KWMoments.load) { try { global.KWMoments.load(); } catch (_) { /* later */ } }
    // The beat moved on. If he is still speaking (the player did the thing while he spoke), those lines give way to the next.
    if (g.beat.key !== was) { if (S.telling) closeTell(); else speak(); }
    else paint();
  }
  async function load() {
    if (!signedIn() || typeof global.apiFetch !== 'function') return null;
    if (S.loading) return S.loading;
    S.loading = (async () => { try { const d = await call(''); if (d.guide) take(d.guide); } catch (_) { /* later */ } S.loading = null; return S.g; })();
    return S.loading;
  }
  async function send(path, body) {
    if (S.busy) return null;
    S.busy = true;
    try { const d = await call(path, body || {}); if (d.error) { toast('⚠️ ' + d.error); return null; } if (d.guide) take(d.guide); return d; }
    catch (_) { return null; } finally { S.busy = false; }
  }

  // ── Speaking ────────────────────────────────────────────────────────────
  // The game is showing: its screen is up and the loading screen (with its "Start playing") is gone. The elder
  // used to begin over the loading screen.
  const gameShowing = () => {
    const s = doc.getElementById('screen-game'), ls = doc.getElementById('loading-screen');
    if (!(s && s.classList.contains('active'))) return false;
    return !(ls && ls.style && ls.style.display && ls.style.display !== 'none');
  };
  async function speak(again) {
    const g = S.g;
    if (!g || g.state !== 'active' || !g.beat || S.telling || !global.KWSay || !gameShowing()) { paint(); return; }
    if (!again && S.told === g.beat.key) { paint(); return; }
    const b = g.beat;
    // A quiet wait (someone is out scouting): nothing to say; the chip says what is being waited for.
    if (!(b.say || []).length) { S.told = b.key; paint(); return; }
    S.telling = true; paint();
    // What the beat gave is said under his line, from the line at which he hands it over: not speech, a receipt.
    const got = b.gift ? giftLine(b.gift) : '';
    const how = await global.KWSay.tell({ character: characterUrl(g.elder.species), emoji: EMOJI[g.elder.species], speaker: g.elder.name, lines: b.say, skip: 'Skip the tour', count: `${b.n} of ${b.of}`, done: b.until ? '' : 'On we go',
      note: got ? `You received ${got}.` : '', noteFrom: b.gift_at || 0 });
    S.telling = false;
    if (how === 'skip') { S.told = b.key; await skip(); return; }
    // The tour moved on while he was speaking: the next beat's lines, now.
    if (S.g && S.g.state === 'active' && S.g.beat && S.g.beat.key !== b.key) { S.told = null; speak(); return; }
    S.told = b.key;
    if (how === 'done' && !b.until && S.g && S.g.beat && S.g.beat.key === b.key) await send('/advance', { key: b.key });
    else paint();
  }
  async function skip() {
    const ok = !global.KWDialog || await global.KWDialog.confirm({ title: 'Skip the tour?', message: 'You keep everything the tour would have given you, and you can ask for it again in Help.', ok: 'Skip the tour', cancel: 'Carry on' });
    if (ok) await send('/skip'); else paint();
  }

  // ── Waiting: the chip, the ring, and asking whether it is done ──────────
  const page = () => ({
    selected: !!(global.KWCast && global.KWCast.selected != null), menu: !!doc.querySelector('.kwv-radial [data-kwv-act]'),
    familiesWindow: !!(global.KWWindow && global.KWWindow.isOpen && global.KWWindow.isOpen('families')),
    houseWindow: !!(global.KWWindow && global.KWWindow.isOpen && global.KWWindow.isOpen('house')),
    area: global._svActiveAreaName ? global._svActiveAreaName() : 'town', place: global.KWPlaces && global.KWPlaces.shown ? global.KWPlaces.shown() : null,
    profile: !!doc.querySelector('#citizen-profile-modal.open'), scoutPanel: !!doc.querySelector('.btn-send-scout'),
    finish: !!(S.g && S.g.finish && S.g.finish.left > 0 && (S.g.finish.sites || []).length),
    building: !!(global._svIsBuildMode && global._svIsBuildMode()), panel: !!doc.querySelector('#sv-build-panel.open'), bmenu: !!doc.querySelector('.kwb-enter'),
  });
  // On the screen means its middle is, with room for a finger: a sliver at the edge cannot be pressed.
  const WAIT = 'wait', LED_MS = 3000;
  const onScreen = r => { const x = r.left + r.width / 2, y = r.top + r.height / 2; return r.width > 2 && r.height > 2 && x > 24 && x < global.innerWidth - 24 && y > 24 && y < global.innerHeight - 24; };
  // Brings something into view by scrolling only what a player could scroll themselves (the scene sideways, a
  // list up and down). Not scrollIntoView: that also moves boxes that hide their overflow, and nothing moves them back.
  function lead(el) {
    try {
      const r = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
        const cs = global.getComputedStyle(a), b = a.getBoundingClientRect(), to = {};
        if (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 4) to.left = a.scrollLeft + (r.left + r.width / 2) - (b.left + b.width / 2);
        if (/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 4) to.top = a.scrollTop + (r.top + r.height / 2) - (b.top + b.height / 2);
        if (to.left != null || to.top != null) a.scrollTo({ ...to, behavior: 'smooth' });
      }
    } catch (_) { /* stays put */ }
  }
  // A tile in the mist beside the player's town on The Land, as a place on the screen. The map is drawn on a
  // canvas, so there is no element to find: the nearest unseen tile that is in view, ring by ring outwards.
  function landTile() {
    try {
      const K = global.KWMap && global.KWMap.controller, canvas = typeof _getCanvas === 'function' ? _getCanvas() : null;   // eslint-disable-line no-undef
      const data = typeof worldMapData !== 'undefined' ? worldMapData : null;   // eslint-disable-line no-undef
      if (!K || !K.hexToScreen || !canvas || !data || !Array.isArray(data.tiles)) return null;
      const home = data.tiles.find(x => x.settlement && x.settlement.isOwn);
      if (!home) return null;
      const known = new Map(data.tiles.map(x => [x.q + ',' + x.r, x])), box = canvas.getBoundingClientRect();
      const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      for (let d = 1; d <= 8; d++) {
        let q = home.q + DIRS[4][0] * d, r = home.r + DIRS[4][1] * d;
        for (let side = 0; side < 6; side++) for (let i = 0; i < d; i++) {
          const tile = known.get(q + ',' + r);
          if (!tile || tile.terrain === 'fog') {
            const pt = K.hexToScreen(q, r);
            if (pt) {
              const x = box.left + pt.x, y = box.top + pt.y, rect = { left: x - 26, top: y - 22, right: x + 26, bottom: y + 22, width: 52, height: 44 };
              const hit = onScreen(rect) && x > box.left + 30 && x < box.right - 30 && y > box.top + 30 && y < box.bottom - 30 && doc.elementFromPoint ? doc.elementFromPoint(x, y) : null;
              if (hit === canvas) return rect;
            }
          }
          q += DIRS[side][0]; r += DIRS[side][1];
        }
      }
    } catch (_) { /* no map yet */ }
    return null;
  }
  // Of everything a name matches, the first that is on the screen. If none is (the town is wider than the
  // window), the view is led to the first, once, so there is always something to press.
  function find(name, strict) {
    if (name === 'land:tile') return landTile();
    const m = /^villager:(\d+)$/.exec(name), t = /^panel:type:([a-z_]+)$/.exec(name);
    const sel = m ? `#settlement-view .kwv-cit[data-cid="${m[1]}"]:not(.kwv-gone)` : t ? `#sv-build-panel.open .sv-bp-build-btn[onclick*="'${t[1]}'"]` : SELECTOR[name];
    let all = [];
    try { all = sel ? doc.querySelectorAll(sel) : []; } catch (_) { all = []; }   // an old browser without :has()
    if (!all.length) return null;
    // Behind an open window: the window's close button is the thing to press first.
    // (The place bar may or may not be under the window's backdrop: what is really at that spot decides.)
    const W = global.KWWindow, under = el => { if (!doc.elementFromPoint) return true; const b = el.getBoundingClientRect(), hit = doc.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !(hit && (el.contains(hit) || hit.contains(el))) || !!(hit && hit.closest && hit.closest('.kww-backdrop') && !el.closest('.kww')); };
    const covered = W && W.isOpen && W.isOpen() && !all[0].closest('.kww, #kwgd-chip') && under(all[0]);
    if (covered) { const x = doc.querySelector('.kww:last-of-type .kww-close, .kww .kww-close'), r = x && x.getBoundingClientRect(); return r && onScreen(r) ? r : null; }
    let use = null, r = null, any = false;
    for (const el of all) {
      const b = el.getBoundingClientRect();
      if (!onScreen(b)) continue;
      // Strict: not behind something else (a villager standing behind a building cannot be pressed).
      if (strict && doc.elementFromPoint) { const hit = doc.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (hit && !(el.contains(hit) || hit.contains(el))) { any = true; continue; } }
      use = el; r = b; break;
    }
    if (!use && any) return null;   // on the screen but behind something: the next name, or the second pass, takes it
    if (!use) {
      // Led there once; while the view travels nothing less exact is ringed in its place (the first Build
      // button instead of the Lumber Camp's, further down the list).
      const key = (S.g && S.g.beat ? S.g.beat.key : '') + '|' + name, now = Date.now();
      if (S.led !== key && all[0].getBoundingClientRect().width > 2) { S.led = key; S.ledAt = now; lead(all[0]); }
      return S.led === key && now - (S.ledAt || 0) < LED_MS ? WAIT : null;
    }
    // A villager being pointed at stands still, so they are easy to press.
    const cid = use.getAttribute && use.getAttribute('data-cid');
    if (cid && global.KWCast && global.KWCast.pause && Date.now() - (S.paused || 0) > 1500) { S.paused = Date.now(); global.KWCast.pause(Number(cid), 5000); }
    return r;
  }
  // Is something already laid over the game (a window, a villager's page, a pop-up with its own dark backdrop)?
  // Then the ring glows but adds no dimming of its own: two layers of it left the screen nearly black.
  function overlayUp() {
    const now = Date.now();
    if (S.overAt && now - S.overAt < 500) return S.over;
    S.overAt = now; S.over = false;
    try {
      if ((global.KWWindow && global.KWWindow.isOpen && global.KWWindow.isOpen()) || (global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen())) return (S.over = true);
      const vw = global.innerWidth, vh = global.innerHeight;
      for (const e of doc.querySelectorAll('[class*="backdrop"], [class*="overlay"], [class*="modal"]')) {
        if (e.id === 'kwgd-ring' || e.closest('#kwgd-chip, .kws-layer')) continue;
        const b = e.getBoundingClientRect();
        if (b.width >= vw * 0.8 && b.height >= vh * 0.8) { const cs = global.getComputedStyle(e); if (cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && cs.pointerEvents !== 'none') return (S.over = true); }
      }
    } catch (_) { /* no dimming decision: leave it off */ }
    return S.over;
  }
  // The building a beat asks for ("built:scout_post" → scout_post), so the right row of the build list is ringed.
  const wantOf = b => { const m = /^built:([a-z_]+)$/.exec(String(b && b.until || '')); return m ? m[1] : null; };
  function ring() {
    let el = doc.getElementById('kwgd-ring');
    // Shown while the elder is speaking too: what he says to press glows as he says it. Not under a moment's own dialogue.
    const Say = global.KWSay, asking = Say && Say.isOpen && Say.isOpen() && !(Say.isTelling && Say.isTelling());
    const g = S.g, on = g && g.state === 'active' && g.beat && g.beat.point && gameShowing() && !asking;
    let r = null, names = [];
    // Two passes: first only what can be pressed where it stands, then anything on the screen.
    if (on) { names = targets(g.beat.point, page(), g.beat.who, g.beat.area, wantOf(g.beat)); let wait = false;
      for (const strict of [true, false]) { for (const name of names) { r = find(name, strict); if (r === WAIT) { r = null; wait = true; break; } if (r) break; } if (r || wait) break; } }
    if (!r) { if (el) el.hidden = true; return; }
    if (!el) { el = doc.createElement('div'); el.id = 'kwgd-ring'; el.setAttribute('aria-hidden', 'true'); doc.body.appendChild(el); }
    const pad = 6, w = Math.max(44, r.width + pad * 2), h = Math.max(44, r.height + pad * 2);
    el.hidden = false;
    // The rest of the screen is dimmed a little, but not on top of a window or a villager's page that is already dimming it.
    el.classList.toggle('kwgd-dim', !overlayUp());
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transform = `translate(${Math.round(r.left + r.width / 2 - w / 2)}px, ${Math.round(r.top + r.height / 2 - h / 2)}px)`;
    // The chip must not sit on the thing to press (a villager standing behind it): it steps to the other side.
    const chip = doc.getElementById('kwgd-chip');
    if (chip && !/^chip:/.test(names[0] || '') && Date.now() - (S.movedAt || 0) > 700) {
      const c = chip.getBoundingClientRect(), m = 10;
      if (!(r.right < c.left - m || r.left > c.right + m || r.bottom < c.top - m || r.top > c.bottom + m)) { chip.classList.toggle('kwgd-away'); S.movedAt = Date.now(); S.away = chip.classList.contains('kwgd-away'); }
    }
  }
  function paint() {
    if (!doc || !doc.body) return;
    let chip = doc.getElementById('kwgd-chip');
    const g = S.g, show = g && g.state === 'active' && g.beat && !S.telling && gameShowing();
    doc.body.classList.toggle('kwgd-on', !!show);   // phones: the moment cards sit above the chip, not under it (css/guide.css)
    if (!show) { if (chip) chip.remove(); ring(); return; }
    if (!chip) { chip = doc.createElement('div'); chip.id = 'kwgd-chip'; chip.setAttribute('role', 'status'); chip.setAttribute('aria-live', 'polite'); if (S.away) chip.classList.add('kwgd-away'); doc.body.appendChild(chip); }
    const html = chipHtml(g, Date.now());
    if (chip.innerHTML !== html) chip.innerHTML = html;
    const h = chip.offsetHeight; if (h && h !== S.chipH) { S.chipH = h; doc.body.style.setProperty('--kwgd-h', h + 'px'); }
    ring();
  }
  // `pressed`: the player has just pressed something. While the elder is speaking only that moves the tour on
  // (so a beat already satisfied does not cut him off mid-sentence).
  async function tick(pressed) {
    const g = S.g;
    if (!g || g.state !== 'active' || !g.beat || S.busy || doc.hidden || !gameShowing()) return;
    if (S.telling && pressed !== true) return;
    if (!S.telling && S.told !== g.beat.key) { speak(); return; }
    paint();
    const b = g.beat;
    if (!b.until) return;
    if (b.client) { const did = clientDid(b.until, page()); if (did) await send('/advance', { key: b.key, did }); return; }
    // The moment the beat is waiting on: if no card is on the screen, ask again (it may have just been started).
    if (b.key === 'moment' && !doc.querySelector('#kw-moments [data-kwm]') && global.KWMoments && global.KWMoments.load && Date.now() - (S.momentsAt || 0) > 4000) { S.momentsAt = Date.now(); try { global.KWMoments.load(); } catch (_) { /* later */ } }
    if (pressed === true && Date.now() - (S.checkedAt || 0) < 1200) return;
    S.checkedAt = Date.now();
    try { const d = await call('/check', {}); if (d.guide && d.guide.state === 'active' && d.guide.beat && (d.guide.beat.key !== b.key || JSON.stringify(d.guide.finish) !== JSON.stringify(g.finish) || d.guide.beat.wait_until !== b.wait_until)) take(d.guide); else if (d.guide && d.guide.state !== 'active') take(d.guide); } catch (_) { /* later */ }
  }

  if (doc) {
    doc.addEventListener('click', async e => {
      const b = e.target.closest && e.target.closest('#kwgd-chip [data-kwgd]');
      if (!b) return;
      e.preventDefault();
      const k = b.getAttribute('data-kwgd');
      if (k === 'again') speak(true);
      else if (k === 'skip') skip();
      else if (k === 'finish') { const d = await send('/finish', { site_id: Number(b.getAttribute('data-site')) }); if (d) { for (const m of ['KWBuild', 'KWHood']) { try { const M = global[m]; if (M && (M.load || M.reload)) (M.load || M.reload)(); } catch (_) { /* later */ } } if (typeof global.refreshSettlementView === 'function') { try { global.refreshSettlementView(); } catch (_) { /* later */ } } } }
    });
    // The player pressed something in the game: ask at once whether that was the beat (not at the next poll).
    doc.addEventListener('click', e => { if (!S.g || S.g.state !== 'active' || (e.target.closest && e.target.closest('.kws-layer, #kwgd-chip'))) return; clearTimeout(S.clickT); S.clickT = setTimeout(() => tick(true), 450); }, true);
    S.timer = setInterval(() => tick(), TICK_MS);
    S.ringTimer = setInterval(() => { if (S.g && S.g.state === 'active') ring(); }, RING_MS);
    // Home opened. Someone new on this page (signed in after it loaded) gets their own tour, not the last player's.
    const token = () => { try { return global.localStorage.getItem('kw_token') || ''; } catch (_) { return ''; } };
    global.addEventListener('kw:home', e => { if (!(e.detail && e.detail.open)) return; const t = token(), other = S.token !== undefined && S.token !== t; S.token = t; if (other) { S.g = null; S.told = null; } setTimeout(() => (S.g ? tick() : load()), 600); });
    // A one-off line the first time something happens, once the tour is over.
    const later = async key => { if (!S.g || S.g.state === 'active' || S.g.state === 'none' || !global.KWSay || (global.KWSay.isOpen && global.KWSay.isOpen())) return; try { const d = await call('/later', { key }); if (d.say) global.KWSay.tell({ character: characterUrl(d.elder.species), emoji: EMOJI[d.elder.species], speaker: d.elder.name, lines: d.say }); } catch (_) { /* later */ } };
    S.later = later;
    global.addEventListener('kw:merchant', e => { if (e.detail && e.detail.here) later('merchant'); });
    // Something was built: a Tavern or a Guild Hall may have opened a place.
    // A job was chosen in a villager's page: ask at once whether that was the beat, not at the next poll.
    doc.addEventListener('change', e => { if (S.g && S.g.state === 'active' && e.target && e.target.closest && e.target.closest('.cp-role-select')) setTimeout(tick, 700); });
    global.addEventListener('kw:build', () => { if (S.g && S.g.state === 'active' && Date.now() - (S.buildAsked || 0) > 1500) { S.buildAsked = Date.now(); setTimeout(tick, 300); } });
    global.addEventListener('kw:built', () => { if (S.g && S.g.state === 'active') { setTimeout(tick, 400); return; } if (S.g && S.g.state !== 'active' && S.g.state !== 'none' && (!S.g.unlock.road || !S.g.unlock.clan)) setTimeout(load, 1500); });
    global.addEventListener('kw:lost', e => { if (e.detail && e.detail.thing && !e.detail.thing.found) later('lost'); });
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(load, 2200)); else setTimeout(load, 2200);
  }

  global.KWGuide = {
    load, replay: async () => { S.told = null; return send('/replay'); }, skip,
    get state() { return S.g ? S.g.state : null; }, get beat() { return S.g && S.g.beat ? S.g.beat.key : null; }, get view() { return S.g; },
    EMOJI, _characterUrl: characterUrl, _giftLine: giftLine, _clientDid: clientDid, _targets: targets, _chipHtml: chipHtml, SELECTOR, _tick: tick,
  };
})(typeof window !== 'undefined' ? window : globalThis);
