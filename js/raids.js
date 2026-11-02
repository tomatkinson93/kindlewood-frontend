// ══════════════════════════════════════════════════════════════════════════
//  KWRaids — Withered raids, client side (server: lib/raids.js,
//  routes/raids.js, lib/defences.js).
//
//    onSettlement(s)  the red 🔥 countdown chip in the top bar while a raid
//                     is on its way (s.raid), ticking every second; the map
//                     trail (js/kwmap-raid.js) reads the same state
//    openSheet()      the raid sheet: target, where from, scouted strength
//                     against your defence (with its breakdown), what a full
//                     raid would take, and what you can do — tribute, show
//                     on the map (sally out and call to arms join later)
//    onEvent(ev)      realtime raid_warning / raid_resolved → toast, chip
//    devSend(min) / devResolve() / devPeaceClear()   Dev Tools
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'raid'); };
  const n = v => Number(v || 0).toLocaleString();
  const RES = { food: '🍎', timber: '🪵', stone: '🪨', metal: '⚙️', wealth: '🪙' };
  const st = { raid: null, info: null, timer: null };

  // "3:42:10" (or "42:10" under an hour).
  function clock(iso) {
    const ms = Math.max(0, Date.parse(iso) - Date.now());
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = v => String(v).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
  }
  function left(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return 'any moment';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
  }

  function renderChip() {
    const el = document.getElementById('raid-chip');
    if (!el) return;
    const r = st.raid;
    if (r && !r.resolved_at) {
      el.hidden = false;
      el.className = 'raid-chip' + (Date.parse(r.arrives_at) - Date.now() < 3600e3 ? ' soon' : '');
      el.innerHTML = `🔥 <span class="raid-chip-label">Raid</span> <b class="raid-chip-clock">${clock(r.arrives_at)}</b>`;
      el.title = `Raiders from ${r.from} strike ${r.target} in ${left(r.arrives_at)} — tap for your defences.`;
    } else {
      el.hidden = true;
      el.innerHTML = '';
    }
  }

  function setRaid(r) {
    st.raid = r || null;
    if (global.gameData && global.gameData.settlement) global.gameData.settlement.raid = st.raid;
    renderChip();
    clearInterval(st.timer);
    if (st.raid) st.timer = setInterval(() => { renderChip(); const sh = document.getElementById('raid-sheet-clock'); if (sh && st.raid) sh.textContent = clock(st.raid.arrives_at); }, 1000);
    if (global.KWMap && global.KWMap.controller && global.KWMap.controller.requestRender) global.KWMap.controller.requestRender();
  }

  function onSettlement(s) {
    const was = st.raid && st.raid.id;
    setRaid((s && s.raid) || null);
    if (st.raid && st.raid.id !== was) load();
  }

  async function load() {
    try {
      const r = await global.apiFetch('/api/raids');
      if (!r.ok) return null;
      st.info = await r.json();
      setRaid(st.info.active || null);
      if (document.getElementById('raid-sheet')) renderSheet();
      return st.info;
    } catch (e) { return null; }
  }

  // ── The raid sheet ──────────────────────────────────────────────────────
  function defenceRows(d) {
    if (!d) return '';
    const rows = [
      [d.kind === 'outpost' ? '🏯 Fort' : '🧱 Walls', d.kind === 'outpost' ? d.fort : d.walls],
      [d.kind === 'outpost' ? '🛡️ Garrison' : '🗼 Watchtower', d.kind === 'outpost' ? d.garrison : d.watch],
      ['🤝 Clan land', (d.clan || 0) + (d.land || 0)],
      ['⭐ Allied militia', d.militia],
      ['🛡 Clan boons', d.town],
      ['📯 Reinforcements', d.reinforcements],
    ].filter(([, v]) => v > 0);
    return rows.map(([k, v]) => `<li><span>${k}</span><b>${n(v)}</b></li>`).join('') || '<li class="raid-none"><span>Nothing stands in their way.</span></li>';
  }

  function sheetHtml() {
    const i = st.info || {};
    const r = i.active || st.raid;
    const d = i.defence;
    const t = i.tribute || {};
    const full = i.full_raid ? Object.entries(i.full_raid).filter(([, v]) => v > 0).map(([k, v]) => `${RES[k] || k} ${n(v)}`).join(' · ') : '';
    if (!r) {
      return `<div class="raid-sheet-head"><b>🛡 Your defences</b><button class="raid-x" onclick="KWRaids.closeSheet()" aria-label="Close">✕</button></div>
        <p class="raid-muted">No raid is coming.${t.peace_until ? ` The Withered are paid — peace until ${esc(new Date(t.peace_until).toLocaleString())}.` : ''}</p>
        <ul class="raid-def">${defenceRows(d)}</ul>`;
    }
    const total = d ? d.total + (d.reinforcements || 0) : 0;
    const verdict = !d ? '' : d.undefended && !(d.reinforcements > 0)
      ? '<div class="raid-verdict bad">Undefended — they will take everything they can carry.</div>'
      : total >= r.strength_max ? '<div class="raid-verdict good">Your defences should hold.</div>'
      : total >= r.strength_min ? '<div class="raid-verdict mid">It could go either way.</div>'
      : '<div class="raid-verdict bad">They are likely to break through.</div>';
    return `<div class="raid-sheet-head"><b>🔥 Raiders coming</b><button class="raid-x" onclick="KWRaids.closeSheet()" aria-label="Close">✕</button></div>
      <div class="raid-count"><span>They strike ${esc(r.target)} in</span><b id="raid-sheet-clock">${clock(r.arrives_at)}</b></div>
      <p class="raid-muted">From ${esc(r.from)}. Scouts put their strength at <b>${n(r.strength_min)}–${n(r.strength_max)}</b>.</p>
      <div class="raid-vs"><div><small>Your defence</small><b>${n(total)}</b></div><div class="raid-vs-x">vs</div><div><small>Raiders</small><b>${n(r.strength_min)}–${n(r.strength_max)}</b></div></div>
      ${verdict}
      <ul class="raid-def">${d ? defenceRows(d) : ''}</ul>
      ${full ? `<p class="raid-muted">A full raid would carry off ${full}${r.outpost_id ? ', and leave the outpost idle for 12 hours' : ''}. Anyone at the spot is hurt and sent home. The closer your defence comes to their strength, the less they take.</p>` : ''}
      <div class="raid-actions">
        <button class="raid-btn" onclick="KWRaids.showOnMap()">🗺 Show on map</button>
        ${t.cost ? `<button class="raid-btn gold" onclick="KWRaids.payTribute(this)">🪙 Pay ${n(t.cost)} to turn them back</button>` : ''}
      </div>
      <p class="raid-muted raid-tip">Raise walls or an outpost fort and post Guards and Archers to defend. Allied villages nearby and clanmates on clan land help too.</p>`;
  }

  function renderSheet() {
    const el = document.getElementById('raid-sheet');
    if (el) el.querySelector('.raid-sheet-card').innerHTML = sheetHtml();
  }

  function openSheet() {
    let el = document.getElementById('raid-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'raid-sheet';
      el.className = 'raid-sheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Raid');
      el.innerHTML = '<div class="raid-sheet-card"></div>';
      el.addEventListener('click', e => { if (e.target === el) closeSheet(); });
      document.body.appendChild(el);
    }
    renderSheet();
    load();
  }
  function closeSheet() { const el = document.getElementById('raid-sheet'); if (el) el.remove(); }

  function showOnMap() {
    const r = st.raid, at = r && r.target_at;
    closeSheet();
    if (!at) return;
    if (typeof global.navGoMap === 'function') global.navGoMap();
    if (typeof global.camera !== 'undefined' && global.camera) { global.camera.q = at.q; global.camera.r = at.r; }
    const tile = global.worldMapData && global.worldMapData.tiles && global.worldMapData.tiles.find(t => t.q === at.q && t.r === at.r);
    if (tile && typeof global.selectWorldTile === 'function') { try { global._selectedTile = { wq: at.q, wr: at.r }; } catch (_) {} global.selectWorldTile(tile); }
    if (global.KWMap && global.KWMap.controller && global.KWMap.controller.requestRender) global.KWMap.controller.requestRender();
  }

  async function payTribute(btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await global.apiFetch('/api/raids/tribute', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { if (btn) btn.disabled = false; toast('⚠️ ' + (d.error || 'The Withered refused.'), 'error'); return; }
      toast(d.turned_back ? `🪙 Paid ${n(d.cost)} — the raiders turn back. ${d.peace_hours} hours of peace.` : `🪙 Paid ${n(d.cost)} for ${d.peace_hours} hours of peace.`);
      setRaid(null);
      if (typeof global.loadGame === 'function') { try { global.loadGame(); } catch (_) {} }
      load();
    } catch (e) { if (btn) btn.disabled = false; }
  }

  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'raid_warning' && ev.raid) {
      setRaid(ev.raid);
      toast(`🔥 Raiders from ${ev.raid.from} are gathering — they will strike ${ev.raid.target} in about ${left(ev.raid.arrives_at)}. Tap the red timer to prepare.`);
      load();
    }
    if (ev.type === 'raid_resolved') {
      setRaid(null);
      closeSheet();
      if (ev.message) toast(ev.message, ev.raid && ['repelled', 'turned_back', 'broken'].includes(ev.raid.outcome) ? 'raid' : 'error');
      if (typeof global.loadGame === 'function') { try { global.loadGame(); } catch (_) {} }
    }
  }

  async function dev(path, body) {
    const r = await global.apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) toast('⚠️ ' + (d.error || 'Failed.'), 'error');
    return { ok: r.ok, d };
  }
  async function devSend(minutes) { const x = await dev('/api/raids/admin/send', minutes != null ? { minutes } : {}); if (x.ok) load(); return x.d; }
  async function devResolve() {
    const x = await dev('/api/raids/admin/resolve');
    if (!x.ok) return x.d;
    setRaid(null);
    const o = x.d.raid || {};
    toast(o.outcome === 'repelled' ? `🛡️ Repelled (defence ${o.defence} vs ${o.strength}).` : `🔥 ${o.outcome === 'partial' ? 'Partly' : 'Fully'} raided — ${Math.round((o.loss_share || 0) * 100)}% (defence ${o.defence} vs ${o.strength}).`, o.outcome === 'repelled' ? 'raid' : 'error');
    if (typeof global.loadGame === 'function') { try { global.loadGame(); } catch (_) {} }
    return x.d;
  }
  async function devPeaceClear() { const x = await dev('/api/raids/admin/peace-clear'); if (x.ok) toast('🕊 Tribute peace cleared.'); return x.d; }

  global.KWRaids = {
    onSettlement, onEvent, openSheet, closeSheet, showOnMap, payTribute, load,
    devSend, devResolve, devPeaceClear,
    explain: openSheet,   // older callers
    state: () => st, _clock: clock, _left: left, _sheetHtml: sheetHtml, _setInfo(i) { st.info = i; st.raid = i && i.active; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
