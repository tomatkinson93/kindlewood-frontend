// ══════════════════════════════════════════════════════════════════════════
//  Outposts tab + outpost stores (server: routes/outposts.js, lib/outpost_store.js)
//
//  Each outpost keeps what it produces in its own store (300 of each
//  resource per level; production stops when one is full). Porters carry it
//  home: a one-off run ("Send a porter") or a standing hauler who goes back
//  and forth while there's anything to fetch.
//
//  KWOutposts.show()           the sidebar's ⛺ Outposts tab: every outpost,
//                              its store, crew, porters on the road
//  KWOutposts.storeHtml(o)     the store bars (also in the outpost's tile panel)
//  KWOutposts.haulHtml(o)      porters on the road, Send a porter, the hauler
//  KWOutposts.onEvent(ev)      'outpost_haul_home' from the live stream
//  Buttons carry data-kwop="haul|hauler|home|map" and are handled here,
//  wherever they're drawn.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = id => document.getElementById(id);
  const BASIC = { food: '🍎', timber: '🪵', stone: '🪨', metal: '⚙️', wealth: '🪙' };
  const ICONS = { plains: '🌾', forest: '🪓', hills: '⛏️', mountain: '⚒️', river: '🎣', marsh: '🌿', ruins: '🏺' };
  const st = { data: null, loading: false, busy: false, timer: null, poll: null };

  // ── Small helpers ──────────────────────────────────────────────────────
  function known() {
    const R = global.KWResources;
    const gd = typeof gameData !== 'undefined' ? gameData : null;
    return R ? R.knownSet((gd && gd.settlement && gd.settlement.discovered) || []) : {};
  }
  // [icon, label] for a resource: ?? until discovered.
  function resLook(res) {
    const R = global.KWResources;
    if (BASIC[res]) return [BASIC[res], R && R.isResource(res) ? R.label(res) : res];
    if (R && R.isResource(res)) return known()[res] ? [R.icon(res), R.label(res)] : ['??', 'Not yet discovered'];
    return ['•', res];
  }
  function fmtLeft(iso, now) {
    const sec = Math.max(0, Math.ceil((new Date(iso).getTime() - (now || Date.now())) / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }
  const fmtDur = sec => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : `${Math.max(1, Math.round(sec / 60))}m`);
  function loadChips(load) {
    return Object.entries(load || {}).filter(([, v]) => v > 0)
      .map(([r, v]) => { const [i, l] = resLook(r); return `<span class="kwop-chip" title="${esc(l)}">${esc(i)} ${Number(v)}</span>`; }).join('');
  }
  // Adults at home and free (the server has the final say).
  function freeCitizens() {
    const list = (typeof citizensData !== 'undefined' && Array.isArray(citizensData)) ? citizensData : [];
    const envoys = global._diploEnvoyIds;
    return list.filter(c => (c.life_stage || 'adult') === 'adult' && !c.expedition && !c.active_quest && !c.trade && !c.outpost && !c.haul
      && !(envoys && envoys.has && envoys.has(c.id)));
  }
  const isPorter = c => c.role === 'porter';

  // ── The store ──────────────────────────────────────────────────────────
  function storeHtml(o) {
    if (!o || !o.store) return '';
    const s = o.store, rates = o.rates || {};
    const keys = [...new Set([...Object.keys(rates), ...Object.keys(s.items || {})])];
    if (!keys.length) return '';
    const full = new Set(s.full || []);
    const rows = keys.map(r => {
      const have = Number((s.items || {})[r]) || 0;
      const pct = Math.min(100, Math.round(have / Math.max(1, s.cap) * 100));
      const [icon, label] = resLook(r);
      const rate = rates[r] ? `<span class="kwop-rate">${full.has(r) ? 'stopped' : '+' + (Math.round(rates[r] * 100) / 100) + '/hr'}</span>` : '';
      return `<div class="kwop-bar-row${full.has(r) ? ' full' : ''}" title="${esc(label)}">
          <span class="kwop-bar-ic" aria-hidden="true">${esc(icon)}</span>
          <span class="kwop-bar"><span style="width:${pct}%"></span></span>
          <span class="kwop-bar-n">${have.toLocaleString('en-GB')}<small>/${Number(s.cap).toLocaleString('en-GB')}</small></span>${rate}
        </div>`;
    }).join('');
    const warn = full.size ? `<div class="kwop-warn">Full: production of ${[...full].map(r => esc(resLook(r)[1].toLowerCase())).join(', ')} has stopped. Send a porter.</div>` : '';
    return `<div class="kwop-store"><div class="kwop-head">📦 Store <span class="kwop-muted">${Number(s.cap)} of each</span></div>${rows}${warn}</div>`;
  }

  // ── Porters ────────────────────────────────────────────────────────────
  function haulRowHtml(h, now) {
    const out = h.status === 'outbound';
    const what = out ? `On the way ${h.standing ? '(hauler)' : ''}` : `Coming home with ${loadChips(h.load) || 'nothing'}`;
    const end = out ? h.arrives_at : h.returns_at;
    return `<div class="kwop-haul"><span aria-hidden="true">🧺</span> <b>${esc(h.name)}</b> <span class="kwop-muted">${what}</span>
      <span class="kwop-time" data-kwop-end="${esc(end)}">${fmtLeft(end, now)}</span></div>`;
  }
  function haulHtml(o, now) {
    if (!o) return '';
    const hauls = o.hauls || [];
    const haulers = o.haulers || [];
    const anything = Object.values((o.store && o.store.items) || {}).some(v => v > 0);
    const free = freeCitizens().sort((a, b) => isPorter(b) - isPorter(a) || String(a.name).localeCompare(String(b.name)));
    const opts = free.map(c => `<option value="${c.id}">${esc(c.name)}${isPorter(c) ? ' (Porter)' : ''}</option>`).join('');
    const trip = o.trip ? `<div class="kwop-muted kwop-trip">About ${fmtDur(o.trip.leg_seconds)} each way · carries ${o.trip.carry} weight a trip</div>` : '';
    const send = free.length
      ? `<div class="kwop-pick"><select class="kwop-select" data-kwop-pick="${o.id}" aria-label="Who carries the goods"><option value="">— Choose a porter —</option>${opts}</select>
          <button type="button" class="kwop-btn" data-kwop="haul" data-id="${o.id}"${anything ? '' : ' disabled title="Nothing stored yet"'}>🧺 Send a porter</button></div>`
      : `<div class="kwop-muted">${(typeof citizensData !== 'undefined' && citizensData.length) ? 'Everyone is busy right now.' : 'Calling the townsfolk…'}</div>`;
    const slots = o.hauler_slots || 1;
    const hauler = haulers.length
      ? haulers.map(h => `<div class="kwop-crew-row"><span>🧺 <b>${esc(h.name)}</b> hauls for this outpost</span><button type="button" class="kwop-btn kwop-btn-sm" data-kwop="home" data-id="${o.id}" data-cid="${h.id}">Home</button></div>`).join('')
      : '';
    const pickHauler = haulers.length < slots && free.length
      ? `<div class="kwop-pick"><select class="kwop-select" data-kwop-hauler-pick="${o.id}" aria-label="Who hauls for this outpost"><option value="">— Choose a hauler —</option>${opts}</select>
          <button type="button" class="kwop-btn" data-kwop="hauler" data-id="${o.id}">Make hauler</button></div>
         <div class="kwop-muted">A hauler goes back and forth on their own while anything is stored.</div>` : '';
    return `<div class="kwop-porters"><div class="kwop-head">🧺 Porters</div>
        ${hauls.map(h => haulRowHtml(h, now)).join('')}${hauler}${send}${trip}${pickHauler}
        <div class="kwop-reason" data-kwop-reason hidden></div></div>`;
  }

  // ── The tab ────────────────────────────────────────────────────────────
  function cardHtml(o, now) {
    const crew = [];
    if ((o.workers || []).length) crew.push(`👷 ${o.workers.length}/${o.worker_slots || 1}`);
    if ((o.garrison || []).length || (o.fort && o.fort.slots)) crew.push(`🛡️ ${(o.garrison || []).length}/${(o.fort && o.fort.slots) || 0}`);
    const notes = (o.notes || []).filter(n => n.key !== 'worker' && n.key !== 'clan_land').map(n => `<div class="kwop-warn">${n.key === 'raided' ? '🔥' : '🍂'} ${esc(n.label)}</div>`).join('');
    return `<article class="kwop-card" data-kwop-card="${o.id}">
        <header class="kwop-card-h">
          <span class="kwop-card-ic" aria-hidden="true">${esc(o.icon || ICONS[o.terrain] || '⛺')}</span>
          <div class="kwop-card-t"><b>${esc(o.name)}</b> <span class="kwop-lv">Lv ${o.level}</span>
            <div class="kwop-muted">${o.tile_q}·${o.tile_r}${crew.length ? ' · ' + crew.join(' · ') : ''}</div></div>
          <button type="button" class="kwop-btn kwop-btn-sm" data-kwop="map" data-q="${o.tile_q}" data-r="${o.tile_r}" aria-label="Show ${esc(o.name)} on the map">📍 Map</button>
        </header>
        ${notes}${storeHtml(o)}${haulHtml(o, now)}
      </article>`;
  }
  function tabHtml(d, now) {
    if (!d) return '<div class="kwop-empty">Counting your outposts…</div>';
    const list = d.outposts || [];
    const head = `<div class="kwop-top"><span>⛺ ${d.used}/${d.cap} outposts · range ${d.range}</span>
        <button type="button" class="kw-help-q" aria-label="How outposts work" title="How outposts work" onclick="KWHelp.open('outposts')">?</button></div>`;
    if (!list.length) return head + '<div class="kwop-empty">No outposts yet. Choose a tile near your town on the map to found one: farms, logging camps, quarries and mines fill their own stores for porters to carry home.</div>';
    return head + list.map(o => cardHtml(o, now)).join('');
  }

  function panel() { return byId('panel-outposts-view'); }
  function visible() { const p = panel(); return !!(p && p.style.display !== 'none'); }
  function render() {
    const b = byId('outposts-body');
    if (b) b.innerHTML = tabHtml(st.data, Date.now());
  }
  async function load() {
    if (st.loading) return;
    st.loading = true;
    try {
      const res = await global.apiFetch('/api/game/outposts');
      if (res.ok) {
        st.data = await res.json();
        if (typeof global._setOutpostStatus === 'function') global._setOutpostStatus(st.data);
        if (st.data.resources && typeof global._applyOutpostResponse === 'function') global._applyOutpostResponse({ resources: st.data.resources });
      }
    } catch (e) { /* next refresh tries again */ }
    finally { st.loading = false; }
    if (visible()) render();
  }
  function show() {
    const p = panel();
    if (!p) return;
    ['panel-map-view', 'panel-citizens-view'].forEach(id => { const el = byId(id); if (el) el.style.display = 'none'; });
    p.style.display = 'flex';
    render();
    load();
    if (typeof global.loadCitizens === 'function' && !(typeof citizensData !== 'undefined' && citizensData.length)) global.loadCitizens();
    clearInterval(st.timer); clearInterval(st.poll);
    st.timer = setInterval(tick, 1000);
    st.poll = setInterval(() => { if (visible()) load(); else { clearInterval(st.poll); } }, 60000);
  }
  function hide() { const p = panel(); if (p) p.style.display = 'none'; clearInterval(st.timer); clearInterval(st.poll); }
  // Countdowns, in place; a run that just ended triggers a refresh.
  function tick() {
    const els = document.querySelectorAll('[data-kwop-end]');
    if (!els.length && !visible()) { clearInterval(st.timer); return; }
    let ended = false;
    els.forEach(el => {
      const end = new Date(el.dataset.kwopEnd).getTime();
      if (end <= Date.now()) { if (!el.dataset.kwopDone) { el.dataset.kwopDone = '1'; ended = true; } el.textContent = 'now'; }
      else el.textContent = fmtLeft(el.dataset.kwopEnd);
    });
    if (ended) setTimeout(refreshAll, 1500);
  }

  // ── Actions ────────────────────────────────────────────────────────────
  function reason(btn, msg) {
    const box = btn.closest('.kwop-porters, .op-section, .kwop-card');
    const r = box && box.querySelector('[data-kwop-reason]');
    if (r) { r.textContent = msg; r.hidden = false; }
    else if (typeof global.showBuildToast === 'function') global.showBuildToast(msg, 'error');
  }
  async function call(path, body) {
    const res = await global.apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'That didn’t work.');
    return data;
  }
  // After any change: the tab, the outpost's tile panel, the citizen list.
  async function refreshAll() {
    if (typeof global.loadCitizens === 'function') { try { await global.loadCitizens(); } catch (e) { /* list catches up later */ } }
    await load();
    const sel = typeof _selectedTile !== 'undefined' ? _selectedTile : null;
    if (sel && typeof worldMapData !== 'undefined' && worldMapData && typeof global.selectWorldTile === 'function' && !visible()) {
      const t = worldMapData.tiles.find(x => x.q === sel.wq && x.r === sel.wr);
      if (t && t.outpost && t.outpost.mine) global.selectWorldTile(t);
    }
  }
  async function onClick(e) {
    const btn = e.target.closest('[data-kwop]');
    if (!btn) return;
    const act = btn.dataset.kwop, id = Number(btn.dataset.id);
    if (act === 'map') {
      // Centre the map on it and open its panel (as Journeys' Show on map does).
      const q = Number(btn.dataset.q), r = Number(btn.dataset.r);
      if (typeof camera !== 'undefined') { camera.q = q; camera.r = r; }   // eslint-disable-line no-undef
      if (global.KWMap && global.KWMap.controller) global.KWMap.controller.requestRender();
      hide();
      document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.id === 'tab-settlement'));
      const mv = byId('panel-map-view'); if (mv) mv.style.display = 'flex';
      const t = typeof worldMapData !== 'undefined' && worldMapData ? worldMapData.tiles.find(x => x.q === q && x.r === r) : null;
      if (t && typeof global.selectWorldTile === 'function') global.selectWorldTile(t);
      return;
    }
    if (st.busy) return;
    const pickSel = act === 'haul' ? `[data-kwop-pick="${id}"]` : act === 'hauler' ? `[data-kwop-hauler-pick="${id}"]` : null;
    const cid = pickSel ? Number((btn.closest('.kwop-porters') || document).querySelector(pickSel)?.value) : Number(btn.dataset.cid);
    if (!cid) return reason(btn, act === 'hauler' ? 'Choose who hauls for it.' : 'Choose who carries the goods.');
    st.busy = true; btn.disabled = true;
    try {
      if (act === 'haul') {
        const d = await call(`/api/game/outposts/${id}/haul`, { citizen_id: cid });
        if (typeof global.showToastNotification === 'function') global.showToastNotification(`🧺 ${d.haul.name} sets off for the ${d.outpost.name} — back in about ${fmtDur((new Date(d.haul.returns_at) - Date.now()) / 1000)}.`, 'outpost');
      } else if (act === 'hauler') {
        const d = await call(`/api/game/outposts/${id}/assign`, { citizen_id: cid, post: 'hauler' });
        if (typeof global.showToastNotification === 'function') global.showToastNotification(`🧺 A hauler now works the ${d.outpost.name}.`, 'outpost');
      } else if (act === 'home') {
        await call(`/api/game/outposts/${id}/unassign`, { citizen_id: cid });
        if (typeof global.showToastNotification === 'function') global.showToastNotification('🏠 They head home after this trip.', 'outpost');
      }
      await refreshAll();
    } catch (err) { btn.disabled = false; reason(btn, err.message); }
    finally { st.busy = false; }
  }
  document.addEventListener('click', onClick);

  // Live stream: a porter got home. One-off runs say so; haulers just refresh.
  function onEvent(ev) {
    if (!ev || ev.type !== 'outpost_haul_home') return;
    const chips = Object.entries(ev.load || {}).filter(([, v]) => v > 0).map(([r, v]) => `${resLook(r)[0]} ${v}`).join(' · ');
    if (!ev.standing && typeof global.showToastNotification === 'function') {
      const c = (typeof citizensData !== 'undefined' && citizensData || []).find(x => x.id === ev.citizen_id);
      global.showToastNotification(`🧺 ${c ? c.name : 'Your porter'} is home${chips ? ' with ' + chips : ', empty-handed'}.`, 'outpost');
    }
    if (typeof global.refreshResources === 'function') { try { global.refreshResources(); } catch (e) { /* next sync */ } }
    clearTimeout(st._ev); st._ev = setTimeout(refreshAll, 800);
  }

  global.KWOutposts = { show, hide, load, render, storeHtml, haulHtml, tabHtml, cardHtml, onEvent, freeCitizens, _set(d) { st.data = d; }, fmtLeft };
})(typeof window !== 'undefined' ? window : this);
