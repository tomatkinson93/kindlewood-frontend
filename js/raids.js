// ══════════════════════════════════════════════════════════════════════════
//  KWRaids — Withered raids, client side (server: lib/raids.js,
//  routes/raids.js).
//
//    onSettlement(s)  the 🔥 banner over the map while a raid is on its way
//                     (s.raid), with a countdown and your defence
//    onEvent(ev)      realtime raid_warning / raid_resolved → toast, banner
//    devSend(min)     Dev Tools: raiders gather (arrive in `min` minutes,
//                     default 6 hours) · devResolve(): strike now
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'raid'); };
  const st = { raid: null, defence: null, timer: null };

  function left(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return 'any moment';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
  }

  function bannerHtml(raid, defence) {
    const def = defence ? ` · your defence ${defence.total}` : '';
    return `<button type="button" class="raid-banner-inner" onclick="KWRaids.explain()">🔥 <b>Raiders coming</b>`
      + ` <span>From ${esc(raid.from)} — they strike ${esc(raid.target)} in ${esc(left(raid.arrives_at))}${def}. Man the Watchtower.</span></button>`;
  }

  function render() {
    const el = document.getElementById('raid-banner');
    if (!el) return;
    if (st.raid && !st.raid.resolved_at) {
      el.className = 'raid-banner open';
      el.innerHTML = bannerHtml(st.raid, st.defence);
    } else {
      el.className = 'raid-banner';
      el.innerHTML = '';
    }
    // On phones the banner stack tucks under the floating topbar (js/famine.js).
    if (typeof global._placeFamineBanner === 'function') global._placeFamineBanner();
  }

  async function loadDefence() {
    try {
      const r = await global.apiFetch('/api/raids');
      if (!r.ok) return;
      const d = await r.json();
      st.defence = d.defence || null;
      st.raid = d.active || null;
      if (global.gameData && global.gameData.settlement) global.gameData.settlement.raid = st.raid;
      render();
    } catch (e) { /* offline */ }
  }

  function onSettlement(s) {
    const was = st.raid && st.raid.id;
    st.raid = (s && s.raid) || null;
    if (global.gameData && global.gameData.settlement) global.gameData.settlement.raid = st.raid;
    render();
    if (st.raid && st.raid.id !== was) loadDefence();
    clearInterval(st.timer);
    if (st.raid) st.timer = setInterval(render, 30000);
  }

  function explain() {
    const r = st.raid, d = st.defence;
    if (!r) return;
    const parts = d ? `Watchtower ${d.watch}${d.militia ? `, Allied militia ${d.militia} (${d.allies.join(', ')})` : ''}${d.town ? `, clan and land ${d.town}` : ''}` : '';
    toast(`🔥 ${r.from} strike ${r.target} in ${left(r.arrives_at)}. Your defence: ${d ? d.total : '?'}${parts ? ' — ' + parts : ''}. Guards and Archers at the Watchtower, Allied villages nearby and clan boons all help.`);
  }

  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'raid_warning' && ev.raid) {
      st.raid = ev.raid;
      toast(`🔥 Raiders from ${ev.raid.from} are gathering — they will strike ${ev.raid.target} in about ${left(ev.raid.arrives_at)}.`);
      loadDefence();
    }
    if (ev.type === 'raid_resolved') {
      st.raid = null;
      if (global.gameData && global.gameData.settlement) global.gameData.settlement.raid = null;
      render();
      if (ev.message) toast(ev.message, ev.raid && ev.raid.outcome === 'repelled' ? 'raid' : 'error');
      if (typeof global.loadGame === 'function') { try { global.loadGame(); } catch (_) {} }
    }
  }

  async function devSend(minutes) {
    const r = await global.apiFetch('/api/raids/admin/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(minutes != null ? { minutes } : {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast('⚠️ ' + (d.error || 'Failed.'), 'error'); return d; }
    st.raid = d.raid; loadDefence();
    return d;
  }
  async function devResolve() {
    const r = await global.apiFetch('/api/raids/admin/resolve', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast('⚠️ ' + (d.error || 'Failed.'), 'error'); return d; }
    st.raid = null; render();
    const o = d.raid || {};
    toast(o.outcome === 'repelled' ? `🛡️ Repelled (defence ${o.defence} vs ${o.strength}).` : `🔥 Lost (defence ${o.defence} vs ${o.strength}).`, o.outcome === 'repelled' ? 'raid' : 'error');
    if (typeof global.loadGame === 'function') { try { global.loadGame(); } catch (_) {} }
    return d;
  }

  global.KWRaids = { onSettlement, onEvent, explain, devSend, devResolve, _bannerHtml: bannerHtml, _left: left, _state: () => st };
})(typeof window !== 'undefined' ? window : globalThis);
