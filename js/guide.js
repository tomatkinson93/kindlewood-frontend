// ══════════════════════════════════════════════════════════════════════════
//  KWGuide — the guide's tour (docs/PHASE_3_ONBOARDING.md).
//
//  An elder of the player's species walks a new player through their first
//  session: a line or two, then one thing to do, which is ringed on the
//  screen. The server holds which beat the player is on and decides when it
//  is done (lib/guide.js there); this file shows the lines (KWSay.tell, the
//  story layout: the character large at the lower left, a dark box with
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
    return null;
  }
  // Where to ring, most exact first: the list of things to look for, by what is on the page now.
  // `page`: { building (Build mode), menu (a villager's menu is open), panel (the build panel is open), houseWindow, area }.
  function targets(point, page, who, area) {
    const p = String(point || ''), w = who || {};
    // Building time: something for this beat is being built and the elder's help is left. Finish now, on the chip.
    if (page.finish && !page.panel && (p === 'tool:build' || p === 'plot:any')) return ['chip:finish'];
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
    if (p === 'tool:build' || p === 'plot:any') return page.panel ? ['panel:lumber', 'panel:build', 'plot'] : page.building ? ['plot'] : ['tool:build'];
    if (p === 'house:any') return page.houseWindow ? ['house:in'] : page.bmenu ? ['bmenu:enter'] : page.building ? ['tool:build'] : ['house:free', 'house'];
    if (p === 'guide:errand') return ['chip:errand'];
    if (p === 'place:families') return ['place:families'];
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
    // The button that builds: a home's (the plot panel in the Neighbourhood), the Lumber Camp's row in Town's list, else the first.
    'panel:lumber': '#sv-build-panel.open .sv-bp-build-btn[onclick*="lumber_camp"]',
    'panel:build': '#sv-build-panel.open .kwn-build, #sv-build-panel.open .sv-bp-build-btn',
    'modal:role': '#citizen-profile-modal.open .cp-role-select', 'modal:close': '#citizen-profile-modal.open .citizen-profile-close',
    'bmenu:enter': '.kwb-enter',
    'house:free': '#settlement-view .sv-fg-layer:not(.sv-area-hidden) .kwn-slot[data-house]:not([data-free="0"]) .kwh-art',   // a home with a bed to spare
    house: '#settlement-view .sv-fg-layer:not(.sv-area-hidden) .kwn-slot[data-house] .kwh-art',
    'house:in': '.kww [data-action="in"]',
    'chip:finish': '#kwgd-chip [data-kwgd="finish"]',
    'chip:errand': '#kwgd-chip [data-kwgd="errand"], #kwgd-chip [data-kwgd="collect"]',
    'place:families': '.kwp-place[data-place="families"]',
    moment: '#kw-moments [data-kwm]',
  };
  // The chip's words while it waits.
  function chipHtml(g, now) {
    if (!g || g.state !== 'active' || !g.beat) return '';
    const b = g.beat, e = g.errand;
    let act = '';
    if (b.key === 'errand' && !e) act = '<button type="button" class="kwgd-act" data-kwgd="errand">Send someone</button>';
    else if (e && !e.collected && (b.key === 'collect' || b.key === 'families')) {
      const left = Math.max(0, Math.ceil((new Date(e.back_at).getTime() - now) / 1000));
      act = left > 0 ? `<span class="kwgd-wait">${esc(String(e.name).split(' ')[0])} is back in ${left >= 60 ? Math.ceil(left / 60) + ' min' : left + ' s'}</span>`
        : (b.key === 'collect' ? '<button type="button" class="kwgd-act" data-kwgd="collect">Hear the news</button>' : '');
    }
    const fin = g.finish && g.finish.left > 0 && (g.finish.sites || []).length
      ? `<button type="button" class="kwgd-act kwgd-finish" data-kwgd="finish" data-site="${g.finish.sites[0].id}" title="${g.finish.left} left during the tour">⏩ Finish now</button>` : '';
    return `<span class="kwgd-face" aria-hidden="true">${EMOJI[g.elder.species] || '🍂'}</span>`
      + `<span class="kwgd-words"><b>${esc(g.elder.name)}</b><span class="kwgd-hint">${esc(b.hint || 'Listen')}</span></span>`
      + act + fin
      + `<button type="button" class="kwgd-small" data-kwgd="again" aria-label="Hear that again" title="Hear that again">↺</button>`
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
    for (const j of g.just || []) if (j.given && giftLine(j.given)) { toast(`🎁 ${g.elder.name} gave you ${giftLine(j.given)}.`, 'success'); if (typeof global.refreshResources === 'function') { try { global.refreshResources(); } catch (_) { /* later */ } } }
    if (g.finished) toast(`🌿 That is the tour. ${g.elder.name} is in Help if you want it again.`, 'success');
    if (g.state !== 'active') { S.told = null; paint(); return; }
    if (g.beat.key !== was) speak();
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
  const gameShowing = () => { const s = doc.getElementById('screen-game'); return !!(s && s.classList.contains('active')); };
  async function speak(again) {
    const g = S.g;
    if (!g || g.state !== 'active' || !g.beat || S.telling || !global.KWSay || !gameShowing()) { paint(); return; }
    if (!again && S.told === g.beat.key) { paint(); return; }
    const b = g.beat;
    S.telling = true; paint();
    const how = await global.KWSay.tell({ character: characterUrl(g.elder.species), emoji: EMOJI[g.elder.species], speaker: g.elder.name, lines: b.say, skip: 'Skip the tour', count: `${b.n} of ${b.of}`, done: b.until ? '' : 'On we go' });
    S.telling = false; S.told = b.key;
    if (how === 'skip') { await skip(); return; }
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
    profile: !!doc.querySelector('#citizen-profile-modal.open'),
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
  // Of everything a name matches, the first that is on the screen. If none is (the town is wider than the
  // window), the view is led to the first, once, so there is always something to press.
  function find(name, strict) {
    const m = /^villager:(\d+)$/.exec(name);
    let all = [];
    try { all = m ? doc.querySelectorAll(`#settlement-view .kwv-cit[data-cid="${m[1]}"]:not(.kwv-gone)`) : SELECTOR[name] ? doc.querySelectorAll(SELECTOR[name]) : []; } catch (_) { all = []; }   // an old browser without :has()
    if (!all.length) return null;
    // Behind an open window: the window's close button is the thing to press first.
    const W = global.KWWindow, covered = W && W.isOpen && W.isOpen() && !all[0].closest('.kww, #kwgd-chip, .kwp-bar, #kw-places');
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
  function ring() {
    let el = doc.getElementById('kwgd-ring');
    const g = S.g, on = g && g.state === 'active' && g.beat && g.beat.point && !S.telling && gameShowing() && !(global.KWSay && global.KWSay.isOpen && global.KWSay.isOpen());
    let r = null;
    // Two passes: first only what can be pressed where it stands, then anything on the screen.
    if (on) { const names = targets(g.beat.point, page(), g.beat.who, g.beat.area); let wait = false;
      for (const strict of [true, false]) { for (const name of names) { r = find(name, strict); if (r === WAIT) { r = null; wait = true; break; } if (r) break; } if (r || wait) break; } }
    if (!r) { if (el) el.hidden = true; return; }
    if (!el) { el = doc.createElement('div'); el.id = 'kwgd-ring'; el.setAttribute('aria-hidden', 'true'); doc.body.appendChild(el); }
    const pad = 6, w = Math.max(44, r.width + pad * 2), h = Math.max(44, r.height + pad * 2);
    el.hidden = false;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transform = `translate(${Math.round(r.left + r.width / 2 - w / 2)}px, ${Math.round(r.top + r.height / 2 - h / 2)}px)`;
  }
  function paint() {
    if (!doc || !doc.body) return;
    let chip = doc.getElementById('kwgd-chip');
    const g = S.g, show = g && g.state === 'active' && g.beat && !S.telling && gameShowing();
    doc.body.classList.toggle('kwgd-on', !!show);   // phones: the moment cards sit above the chip, not under it (css/guide.css)
    if (!show) { if (chip) chip.remove(); ring(); return; }
    if (!chip) { chip = doc.createElement('div'); chip.id = 'kwgd-chip'; chip.setAttribute('role', 'status'); chip.setAttribute('aria-live', 'polite'); doc.body.appendChild(chip); }
    const html = chipHtml(g, Date.now());
    if (chip.innerHTML !== html) chip.innerHTML = html;
    const h = chip.offsetHeight; if (h && h !== S.chipH) { S.chipH = h; doc.body.style.setProperty('--kwgd-h', h + 'px'); }
    ring();
  }
  async function tick() {
    const g = S.g;
    if (!g || g.state !== 'active' || !g.beat || S.telling || S.busy || doc.hidden || !gameShowing()) return;
    if (S.told !== g.beat.key) { speak(); return; }
    paint();
    const b = g.beat;
    if (!b.until) return;
    if (b.client) { const did = clientDid(b.until, page()); if (did) await send('/advance', { key: b.key, did }); return; }
    if (b.until === 'errand:sent' || (b.until === 'errand:collected')) return;   // those have their own buttons
    try { const d = await call('/check', {}); if (d.guide && d.guide.state === 'active' && d.guide.beat && (d.guide.beat.key !== b.key || JSON.stringify(d.guide.finish) !== JSON.stringify(g.finish))) take(d.guide); else if (d.guide && d.guide.state !== 'active') take(d.guide); } catch (_) { /* later */ }
  }

  // ── The errand's picker ─────────────────────────────────────────────────
  function pickErrand() {
    const W = global.KWWindow, g = S.g;
    if (!W || !g) return;
    let list = [];
    try { list = (typeof citizensData !== 'undefined' && Array.isArray(citizensData) ? citizensData : []).filter(c => (c.stage || c.life_stage || 'adult') !== 'child' && (c.life_stage || 'adult') !== 'deceased' && !c.active_quest); } catch (_) { list = []; }   // eslint-disable-line no-undef
    W.close('guide-errand');
    W.open({
      id: 'guide-errand', icon: '🥾', size: 'S', title: 'Who goes?', subtitle: 'A short walk to the next valley: back in two minutes.',
      render(body) { body.innerHTML = list.length ? '<ul class="kwgd-pick">' + list.slice(0, 12).map(c => `<li><button type="button" data-action="go" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.role || 'forager')}</span></button></li>`).join('') + '</ul>' : '<p>Nobody is free to go just now.</p>'; },
      actions: { async go(el) { W.close('guide-errand'); await send('/errand', { citizen_id: Number(el.dataset.id) }); if (typeof global.loadCitizens === 'function') { try { global.loadCitizens(); } catch (_) { /* later */ } } } },
    });
  }

  if (doc) {
    doc.addEventListener('click', async e => {
      const b = e.target.closest && e.target.closest('#kwgd-chip [data-kwgd]');
      if (!b) return;
      e.preventDefault();
      const k = b.getAttribute('data-kwgd');
      if (k === 'again') speak(true);
      else if (k === 'skip') skip();
      else if (k === 'errand') pickErrand();
      else if (k === 'collect') { await send('/errand/collect'); if (typeof global.loadCitizens === 'function') { try { global.loadCitizens(); } catch (_) { /* later */ } } }
      else if (k === 'finish') { const d = await send('/finish', { site_id: Number(b.getAttribute('data-site')) }); if (d) { for (const m of ['KWBuild', 'KWHood']) { try { const M = global[m]; if (M && (M.load || M.reload)) (M.load || M.reload)(); } catch (_) { /* later */ } } if (typeof global.refreshSettlementView === 'function') { try { global.refreshSettlementView(); } catch (_) { /* later */ } } } }
    });
    S.timer = setInterval(tick, TICK_MS);
    S.ringTimer = setInterval(() => { if (S.g && S.g.state === 'active') ring(); }, RING_MS);
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) setTimeout(() => (S.g ? tick() : load()), 600); });
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
