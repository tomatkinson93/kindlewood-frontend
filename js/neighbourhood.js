// ══════════════════════════════════════════════════════════════════════════
//  KWHood — the Neighbourhood scene (docs/HOME_SCENE.md Part C, step 11).
//
//  A third area of Home, beside Town and the Outskirts, that holds only
//  houses: 36 plots in two rows (the back row, then the front row half a plot
//  along), opened by the town's tier from the middle outwards. The server
//  owns the plots and houses (GET /api/neighbourhoods); this draws them into
//  #sv-layer-fg-neighbourhood as ordinary scene buttons, so the villagers'
//  engine, the dirt paths, the night glow and the building menu all treat a
//  house like any other building.
//
//  · A house: its radial menu (Enter opens its window: who lives there, move
//    people in and out, rename, change its look; Demolish; Who's here).
//  · Build mode: free plots show as staked ground (build a home there, in a
//    chosen style); a house can be picked up and put on another plot (onto a
//    home, the two swap) or pulled down.
//  · The world is only as wide as the plots in use, so a camp is a short
//    street; it grows with the town.
//  · The old housing windows (js/housing.js, the scene's own list) are gone;
//    openHousingModal() opens this scene.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const AREA = 'neighbourhood';
  const PITCH = 240;            // one plot's width, px
  const MARGIN = 230;           // meadow at each end (the signpost stands in the left one)
  const MIN_W = 2000;           // never narrower than this (the view must be filled)
  const ROW_Y = [58, 92];       // where each row's feet stand, % of the height
  const STAGGER = 0.5;          // the front row sits half a plot along
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const call = (name, ...a) => (typeof global[name] === 'function' ? global[name](...a) : undefined);

  const S = { data: null, hoodId: null, picked: null, loading: null, at: 0 };

  // ── Layout (pure) ───────────────────────────────────────────────────────
  // The world for a set of plots in use: only their columns, with a margin at
  // each end, centred when that is narrower than MIN_W.
  // → { w, at(plot) → { x, y (px across; % down), xPct } }.
  function layout(plots, cols = 18) {
    const cs = plots.map(p => p % cols);
    const lo = cs.length ? Math.min(...cs) : Math.floor(cols / 2) - 1, hi = cs.length ? Math.max(...cs) : Math.floor(cols / 2);
    const span = (hi - lo + 1 + STAGGER) * PITCH;
    const w = Math.max(MIN_W, Math.round(span + MARGIN * 2));
    const left = (w - span) / 2;
    return {
      w, lo, hi,
      at(plot) {
        const row = Math.floor(plot / cols), col = plot % cols;
        const x = left + (col - lo + 0.5 + (row ? STAGGER : 0)) * PITCH;
        return { x, y: ROW_Y[row] != null ? ROW_Y[row] : ROW_Y[ROW_Y.length - 1], xPct: x / w * 100 };
      },
    };
  }
  // The plots drawn: every house's, and the ones the tier has opened.
  const plotsInUse = hood => [...new Set([...(hood.open || []), ...hood.houses.map(h => h.plot), ...(hood.sites || []).map(x => x.plot)])];
  // Who lives there, by first name, for the nameplate's second line.
  const whoLine = h => (h.residents.length ? h.residents.map(c => String(c.name || '').split(' ')[0]).join(', ') : 'Nobody lives here yet');
  const bedsLine = h => `${h.residents.length} of ${h.capacity} beds`;
  const styleLabel = key => { const s = S.data && S.data.styles.find(x => x.key === key); return s ? s.label : 'Home'; };
  const costLine = cost => Object.entries(cost || {}).filter(e => e[1] > 0).map(e => (typeof global._svResIcon === 'function' ? global._svResIcon(e[0]) : e[0]) + ' ' + e[1]).join('  ');

  // ── Data ────────────────────────────────────────────────────────────────
  const hood = () => (S.data ? S.data.neighbourhoods.find(n => n.id === S.hoodId) || S.data.neighbourhoods[0] : null);
  const houseById = id => { for (const n of (S.data ? S.data.neighbourhoods : [])) { const h = n.houses.find(x => x.id === Number(id)); if (h) return h; } return null; };
  function take(data) {
    if (!data || !data.neighbourhoods) return;
    S.data = data; S.at = Date.now();
    if (!data.neighbourhoods.some(n => n.id === S.hoodId)) S.hoodId = data.neighbourhoods.length ? data.neighbourhoods[0].id : null;
  }
  async function load(force) {
    if (!force && S.data && Date.now() - S.at < 15000) return S.data;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      try { const r = await global.apiFetch('/api/neighbourhoods'); if (r.ok) take(await r.json()); } catch (_) { /* keep what we have */ }
      S.loading = null;
      return S.data;
    })();
    return S.loading;
  }
  // POST a change; the answer carries the town's neighbourhoods as they now are.
  async function post(path, body) {
    try {
      const r = await global.apiFetch('/api/neighbourhoods' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (global.KWDialog) global.KWDialog.alert(j.error || 'That did not work.'); return null; }
      take(j.town);
      return j;
    } catch (_) { if (global.KWDialog) global.KWDialog.alert('That did not work. Try again.'); return null; }
  }
  // After a change: the scene, and everything else that shows homes or beds.
  async function changed({ people = false, town = false } = {}) {
    render();
    const jobs = [];
    if (people && typeof global.loadCitizens === 'function') jobs.push(Promise.resolve(global.loadCitizens()).catch(() => {}));
    if (town) {
      if (typeof global.refreshResources === 'function') jobs.push(Promise.resolve(global.refreshResources()).catch(() => {}));
      if (typeof global.refreshSettlementView === 'function') jobs.push(Promise.resolve(global.refreshSettlementView()).catch(() => {}));
    }
    await Promise.all(jobs);
    if (global.KWContext && global.KWContext.refreshTown) global.KWContext.refreshTown();
    const w = global.KWWindow && global.KWWindow.get && global.KWWindow.get('house');
    if (w) w.refresh();
  }
  // Who lives in the neighbourhood showing (the villagers' cast): its
  // residents, and anyone in town with no bed.
  function livesHere(c) {
    const n = hood();
    if (!n || !c) return false;
    return c.house_id == null ? true : n.houses.some(h => h.id === Number(c.house_id));
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  const layer = () => doc.getElementById('sv-layer-fg-' + AREA);
  const building = () => typeof global._svIsBuildMode === 'function' && global._svIsBuildMode();
  const showing = () => typeof global._svActiveAreaName === 'function' && global._svActiveAreaName() === AREA && typeof global._svIsOpen === 'function' && global._svIsOpen();

  function houseHtml(h) {
    const H = global.KWHome;
    const a = H ? H.artHtml('house_' + h.style, { emoji: '🏡' }, 170) : { html: '🏡' };
    const empty = !h.residents.length;
    return `<button type="button" class="sv-building kwh-btn kwn-house${a.native ? ' kwh-native-art' : ''}${empty ? ' kwh-dark' : ''}${S.picked === h.id ? ' kwn-picked' : ''}" `
      + `data-kwh="house-${h.id}" data-kwh-art="house_${esc(h.style)}" aria-label="${esc(h.display)}, ${bedsLine(h)}. ${building() ? 'Move or pull down' : 'Show choices'}">`
      + '<span class="kwh-bubble-host"></span>' + a.html
      + (H ? H.plateHtml(h.display, building() ? 'Move or pull down' : whoLine(h), bedsLine(h)) : '') + '</button>';
  }
  // A home being built: the site on its plot, with a bar and an estimate.
  function siteHtml(x) {
    const B = global.KWBuild, known = B && B.sites().some(q => q.id === x.id), p = known ? B.pct(x.id) : x.pct || 0;
    return `<button type="button" class="sv-building kwh-btn kwbt-site kwn-site" data-kwbt-site="${x.id}" aria-label="A new home: being built. Open the builders' list">`
      + `<span class="kwbt-site-art" data-kwbt-stage-of="${x.id}" data-kwbt-stage="${B ? B.stage(p) : 0}" style="width:170px;height:102px">${call('_svSiteSvg') || ''}</span>`
      + `<span class="kwbt-plate"><b>A new home</b><span class="kwbt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(p * 100)}"><i data-kwbt-bar="${x.id}" style="width:${(p * 100).toFixed(1)}%"></i></span>`
      + `<span class="kwbt-eta" data-kwbt-eta="${x.id}">${esc(known ? B.etaLine(x.id) : '')}</span></span></button>`;
  }
  const stakeHtml = plot => `<button type="button" class="kwn-stake" data-plot="${plot}" aria-label="${S.picked ? 'Put the home here' : 'A free plot. Build a home here'}">`
    + '<svg viewBox="0 0 120 60" width="150" height="75" aria-hidden="true"><ellipse cx="60" cy="42" rx="54" ry="14" fill="rgba(120,90,50,.28)"/>'
    + [[12, 34], [108, 34], [28, 52], [92, 52]].map(([x, y]) => `<rect x="${x - 2}" y="${y - 18}" width="4" height="18" fill="#7a5a36"/><rect x="${x - 4}" y="${y - 20}" width="8" height="4" fill="#d6463c"/>`).join('')
    + '<path d="M12 18 L108 18 L92 36 L28 36 Z" fill="none" stroke="#e8d7a8" stroke-width="1.5" stroke-dasharray="5 4"/></svg>'
    + `<span class="kwn-stake-l">${S.picked ? 'Put it here' : 'Build here'}</span></button>`;

  function render() {
    const L = layer(), n = hood();
    if (!L || !n) return;
    const lay = layout(plotsInUse(n), S.data.cols);
    if (global._svSetAreaWidth) global._svSetAreaWidth(AREA, lay.w);
    L.querySelectorAll(':scope > .kwn-slot, :scope > .kwn-quarters').forEach(el => el.remove());
    const byPlot = new Map(n.houses.map(h => [h.plot, h]));
    const siteAt = new Map((n.sites || []).map(x => [x.plot, x]));   // homes being built (js/construction.js)
    const bm = building();
    let html = '';
    for (const plot of plotsInUse(n).sort((a, b) => a - b)) {
      const h = byPlot.get(plot), x = h ? null : siteAt.get(plot), p = lay.at(plot);
      if (x) { html += `<div class="sv-slot kwn-slot kwn-building" data-plot="${plot}" style="left:${p.xPct.toFixed(3)}%;top:${p.y}%">${siteHtml(x)}</div>`; continue; }
      if (!h && (!bm || !n.open.includes(plot))) continue;   // free plots are plain grass outside Build mode
      html += `<div class="sv-slot kwn-slot${h ? '' : ' kwn-free'}" data-plot="${plot}"${h ? ` data-house="${h.id}"` : ''} style="left:${p.xPct.toFixed(3)}%;top:${p.y}%">${h ? houseHtml(h) : stakeHtml(plot)}</div>`;
    }
    // More than one neighbourhood: a row of signs to pick between them.
    if (S.data.neighbourhoods.length > 1) {
      html += `<div class="kwn-quarters" role="group" aria-label="Neighbourhoods" style="left:${(MARGIN * 0.5 / lay.w * 100).toFixed(2)}%">`
        + S.data.neighbourhoods.map(q => `<button type="button" class="kwn-quarter" data-quarter="${q.id}" aria-pressed="${q.id === n.id}">${esc(q.name)}</button>`).join('') + '</div>';
    }
    L.insertAdjacentHTML('beforeend', html);
    // The signpost back to town stands in the left margin.
    const sign = doc.getElementById('sv-prop-signpost-hood');
    if (sign) sign.style.left = (MARGIN * 0.42 / lay.w * 100).toFixed(2) + '%';
    if (global.KWBuildingMenu) { global.KWBuildingMenu.close(false, true); global.KWBuildingMenu.apply(); }
    if (global.KWCast && global.KWCast.resurvey) global.KWCast.resurvey();
    panel();
  }

  // ── Clicks in the scene ─────────────────────────────────────────────────
  function onClick(e) {
    const L = layer();
    if (!L || !L.contains(e.target)) return;
    const q = e.target.closest('.kwn-quarter');
    if (q) { S.hoodId = Number(q.getAttribute('data-quarter')); S.picked = null; render(); return; }
    const slot = e.target.closest('.kwn-slot');
    if (!slot) return;
    // A home being built: the builders' list (nothing else can go on its plot).
    if (slot.classList.contains('kwn-building')) { if (!S.picked && global.KWBuild) global.KWBuild.open(); return; }
    const plot = Number(slot.getAttribute('data-plot')), h = slot.hasAttribute('data-house') ? houseById(slot.getAttribute('data-house')) : null;
    if (building()) {
      if (S.picked && (!h || h.id !== S.picked)) return void moveTo(plot);
      if (h) { S.picked = S.picked === h.id ? null : h.id; S.placing = null; render(); return; }
      S.placing = plot; S.picked = null; panel(); return;
    }
    if (h && global.KWBuildingMenu) {
      global.KWBuildingMenu.click(slot, { key: 'house-' + h.id, label: h.display, enter: () => openHouse(h.id), demolish: () => demolish(h.id) }, e);
    } else if (h) openHouse(h.id);
  }

  // ── Build mode's panel: build here, or the house picked up ──────────────
  function panel() {
    const p = doc.getElementById('sv-build-panel');
    if (!p) return;
    if (!showing() || !building() || (!S.picked && S.placing == null)) { if (p.dataset.kwn) { p.classList.remove('open'); delete p.dataset.kwn; } return; }
    const n = hood();
    let html;
    if (S.picked) {
      const h = houseById(S.picked);
      if (!h) { S.picked = null; return panel(); }
      html = `<div class="sv-bp-header"><span class="sv-bp-loc">${esc(h.display)}</span><span class="sv-bp-tag town">${esc(n.name)}</span>`
        + '<button class="sv-bp-close" data-kwn="cancel" aria-label="Close">\xD7</button></div>'
        + `<div class="sv-occ-desc">Choose a free plot to move it there, or another home to swap places. Moving is free.</div>`
        + `<button type="button" class="sv-bp-demolish-btn" data-kwn="demolish" data-id="${h.id}">🔨 Pull this home down</button>`;
    } else {
      const d = S.data, can = n.open.includes(S.placing);
      html = `<div class="sv-bp-header"><span class="sv-bp-loc">A free plot</span><span class="sv-bp-tag town">${esc(n.name)}</span>`
        + '<button class="sv-bp-close" data-kwn="cancel" aria-label="Close">\xD7</button></div>'
        + '<div class="sv-occ-desc">A home for four. Choose how it looks (you can change it later, free).</div>'
        + '<div class="kwn-styles" role="radiogroup" aria-label="How it looks">' + stylesHtml(S.style || 'thatch', 'pick') + '</div>'
        + (global.KWBuild ? global.KWBuild.noteHtml(5) : '')
        + (can ? `<button type="button" class="sv-bp-build-btn kwn-build" data-kwn="build">Build a home — ${costLine(d.cost)}</button>` : '');
    }
    p.innerHTML = html;
    p.dataset.kwn = '1';
    p.classList.add('open');
  }
  function stylesHtml(current, action) {
    const H = global.KWHome;
    return S.data.styles.filter(s => s.owned).map(s => {
      const a = H && H.art('house_' + s.key);
      return `<button type="button" class="kwn-style" role="radio" aria-checked="${s.key === current}" data-kwn="${action}" data-action="${action}" data-style="${esc(s.key)}">`
        + (a ? `<img src="${esc(a.url)}" alt="" draggable="false">` : '') + `<span>${esc(s.label)}</span></button>`;
    }).join('');
  }
  async function onPanel(e) {
    const b = e.target.closest('[data-kwn]');
    if (!b || !b.closest('#sv-build-panel')) return;
    const what = b.getAttribute('data-kwn');
    if (what === 'cancel') { S.picked = null; S.placing = null; render(); }
    else if (what === 'pick') { S.style = b.getAttribute('data-style'); panel(); }
    else if (what === 'demolish') demolish(Number(b.getAttribute('data-id')));
    else if (what === 'build') {
      b.disabled = true;
      const plot = S.placing, n = hood();
      const out = await post(`/${n.id}/houses`, { plot, style: S.style || 'thatch' });
      if (out && out.queued) { S.placing = null; if (global.KWBuild) global.KWBuild.ordered(out, 'home', 5); await changed({ people: false, town: true }); }   // building time: the builders raise it
      else if (out) { S.placing = null; if (typeof global._svPlaySound === 'function') global._svPlaySound('/assets/audio/construct.wav'); await changed({ people: true, town: true }); }
      else panel();
    }
  }
  async function moveTo(plot) {
    const id = S.picked;
    const out = await post(`/houses/${id}/move`, { plot, neighbourhood_id: S.hoodId });
    if (out) { S.picked = null; render(); }
  }
  async function demolish(id) {
    const h = houseById(id);
    if (!h) return;
    const n = h.residents.length;
    const ok = global.KWDialog ? await global.KWDialog.confirm({ title: `Pull down ${h.display}?`, danger: true, ok: 'Pull it down',
      message: (n ? `The ${n} ${n === 1 ? 'person' : 'people'} living here lose${n === 1 ? 's' : ''} their bed first; they move to free beds elsewhere if there are any. ` : '') + 'Half its base cost comes back.' }) : true;
    if (!ok) return;
    const out = await post(`/houses/${id}/demolish`);
    if (!out) return;
    S.picked = null;
    if (global.KWWindow && global.KWWindow.close) global.KWWindow.close('house');
    await changed({ people: true, town: true });
  }

  // ── A house's window ────────────────────────────────────────────────────
  function openHouse(id) {
    const W = global.KWWindow;
    if (!W || !houseById(id)) return;
    W.open({
      id: 'house', icon: '🏡', size: 'S', title: houseById(id).display, state: { id: Number(id) },
      render(body, st, w) {
        const h = houseById(st.id);
        if (!h) { body.innerHTML = '<p class="kwn-none">This home is gone.</p>'; return; }
        w.setTitle(h.display, `${bedsLine(h)} · ${styleLabel(h.style)}`);
        const free = h.capacity - h.residents.length;
        const others = [];
        for (const n of S.data.neighbourhoods) for (const o of n.houses) if (o.id !== h.id) for (const c of o.residents) others.push({ c, from: o.display });
        const role = c => (c.life_stage === 'child' ? 'child' : String(c.role || 'villager').replace(/_/g, ' '));
        body.innerHTML = '<h3 class="kwn-h">Who lives here</h3>'
          + (h.residents.length ? '<ul class="kwn-list">' + h.residents.map(c => `<li><button type="button" class="kwn-who" data-action="who" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(role(c))}</span></button>`
              + `<button type="button" class="kwn-small" data-action="out" data-id="${c.id}" aria-label="Move ${esc(c.name)} out">Move out</button></li>`).join('') + '</ul>'
            : '<p class="kwn-none">Nobody yet.</p>')
          + (free > 0 ? `<div class="kwn-in"><label for="kwn-in">${free} free bed${free === 1 ? '' : 's'}. Move someone in:</label><div class="kwn-row"><select id="kwn-in">`
              + (S.data.unhoused.length ? '<optgroup label="Without a bed">' + S.data.unhoused.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '</optgroup>' : '')
              + (others.length ? '<optgroup label="From another home">' + others.map(o => `<option value="${o.c.id}">${esc(o.c.name)} (${esc(o.from)})</option>`).join('') + '</optgroup>' : '')
              + `</select><button type="button" class="kwn-small" data-action="in"${S.data.unhoused.length || others.length ? '' : ' disabled'}>Move in</button></div></div>`
            : '<p class="kwn-none">Every bed is taken.</p>')
          + '<h3 class="kwn-h">Its name</h3>'
          + `<div class="kwn-row"><input id="kwn-name" type="text" maxlength="40" value="${esc(h.custom_name ? h.name : '')}" placeholder="${esc(h.display)}" aria-label="A name for this home">`
          + '<button type="button" class="kwn-small" data-action="rename">Save</button></div>'
          + '<p class="kwn-hint">Left empty, it is named for the family living in it.</p>'
          + '<h3 class="kwn-h">How it looks</h3><div class="kwn-styles" role="radiogroup" aria-label="How it looks">' + stylesHtml(h.style, 'style') + '</div>'
          + '<p class="kwn-hint">Looks only: every home holds four.</p>';
      },
      actions: {
        who(el) { call('openCitizenProfile', Number(el.dataset.id)); },
        async out(el) { if (await housing('/unassign', { citizen_id: Number(el.dataset.id) })) await reload(true); },
        async in(el, ev, w) { const sel = w.body.querySelector('#kwn-in'); if (sel && sel.value && await housing('/assign', { citizen_id: Number(sel.value), house_id: w.state.id })) await reload(true); },
        async rename(el, ev, w) {
          const inp = w.body.querySelector('#kwn-name');
          const name = inp ? inp.value.trim() : '';
          if (!name) return;
          try { const r = await global.apiFetch('/api/housing/' + w.state.id + '/name', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); if (r.ok) await reload(false); } catch (_) {}
        },
        async style(el, ev, w) { if (await post(`/houses/${w.state.id}/style`, { style: el.dataset.style })) await changed(); },
      },
    });
  }
  // The old housing routes still move people (POST /api/housing/assign, /unassign).
  async function housing(path, body) {
    try {
      const r = await global.apiFetch('/api/housing' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); if (global.KWDialog) global.KWDialog.alert(j.error || 'That did not work.'); return false; }
      return true;
    } catch (_) { return false; }
  }
  async function reload(people) { await load(true); await changed({ people }); }

  // ── Opening the scene ───────────────────────────────────────────────────
  // opts: { house } pans to that house and opens its window; { build } turns
  // Build mode on.
  async function open(opts = {}) {
    if (typeof global._svIsOpen === 'function' && !global._svIsOpen()) await call('openSettlementView');
    await load(!S.data);
    if (!S.data) { if (global.KWDialog) global.KWDialog.alert('The neighbourhood could not be loaded.'); return; }
    const target = opts.house != null ? houseById(opts.house) : null;
    if (target) { const n = S.data.neighbourhoods.find(q => q.houses.includes(target)); if (n) S.hoodId = n.id; }
    S.picked = null; S.placing = null;
    render();
    // Centred on the house asked for, else the newest (the highest id).
    const n = hood(), lay = layout(plotsInUse(n), S.data.cols);
    const focus = target || n.houses.slice().sort((a, b) => b.id - a.id)[0];
    call('_svSwitchArea', AREA, true, focus ? lay.at(focus.plot).x : lay.w / 2);
    if (opts.build && !building()) call('_svToggleBuildMode', true);
    if (target) openHouse(target.id);
    load(true).then(() => { if (showing()) render(); });   // fresh, if what we drew was a little old
  }

  if (doc) {
    doc.addEventListener('click', e => { if (showing()) { onClick(e); onPanel(e); } });
    // The builders' queue changed (a home ordered elsewhere, or finished): look again.
    global.addEventListener('kw:build', () => { if (showing() && S.data) reload(false); });
    // Esc in Build mode puts a picked-up house down first.
    global.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !showing() || (!S.picked && S.placing == null)) return;
      if ((global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen()) || (global.KWWindow && global.KWWindow.isOpen && global.KWWindow.isOpen())) return;
      e.preventDefault(); e.stopImmediatePropagation();
      S.picked = null; S.placing = null; render();
    }, true);
  }

  global.KWHood = {
    open, load, render, reload, livesHere, layout, plotsInUse, openHouse,
    buildModeChanged() { S.picked = null; S.placing = null; if (S.data && layer()) render(); },
    get data() { return S.data; }, _take: take, _state: S, PITCH, MARGIN, MIN_W, ROW_Y,
  };
  // The old entry points lead here now.
  global.openHousingModal = () => open();
  global._openHousingModal = () => open();
})(typeof window !== 'undefined' ? window : globalThis);
