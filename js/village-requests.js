// ══════════════════════════════════════════════════════════════════════════
//  Village requests — "📣 Burrowmere needs 120 copper by Friday — +3 trust".
//
//  GET /api/market/requests lists today's requests from villages that trade
//  with you (Familiar+). The server writes the bell entry the first time a
//  town sees each one and marks it fresh; here we toast the fresh ones,
//  checking on load and every 10 minutes. The diplomacy side panel shows a
//  village's current request with "Fill in the Market" (the Wanted tab,
//  filtered to it).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const POLL_MS = 10 * 60 * 1000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let _list = [], _hasMarket = false, _timer = null;

  function toast(msg) {
    if (typeof global.showToastNotification === 'function') global.showToastNotification(msg, 'village_request_new');
    else if (typeof global.showBuildToast === 'function') global.showBuildToast(msg, 'info');
  }

  async function check() {
    try {
      const res = await global.apiFetch('/api/market/requests');
      if (!res.ok) return [];
      const data = await res.json();
      _list = data.requests || [];
      _hasMarket = !!data.has_market;
      const fresh = _list.filter(r => r.fresh && r.remaining > 0);
      fresh.slice(0, 3).forEach((r, i) => setTimeout(() => toast(r.message), i * 300));
      if (fresh.length && typeof global.loadEvents === 'function') global.loadEvents();
      return fresh;
    } catch (e) { return []; }
  }

  function start() {
    check();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(check, POLL_MS);
  }

  function forNpc(npcId) { return _list.find(r => r.npc && r.npc.id === Number(npcId) && r.remaining > 0) || null; }

  function what(r) {
    if (r.kind === 'item') return `${r.qty} ${r.item ? r.item.name : 'items'}`;
    const R = global.KWResources;
    return `${r.qty} ${R ? R.label(r.resource).toLowerCase() : r.resource}`;
  }

  // The diplomacy side panel's line for a village (empty when it wants nothing).
  function panelHtml(npcId) {
    const r = forNpc(npcId);
    if (!r) return '';
    const left = r.remaining < r.qty ? ` · ${r.remaining} left` : '';
    const btn = _hasMarket
      ? `<button type="button" class="vr-fill" onclick="KWRequests.fill(${Number(r.npc.id)})">Fill in the Market</button>`
      : `<span class="vr-nomarket">Build a Market to fill it.</span>`;
    return `<div class="vr-line"><div class="vr-text">📣 Needs <b>${esc(what(r))}</b> by ${esc(r.by)} — +${Number(r.trust_bonus) || 0} trust${esc(left)}</div>${btn}</div>`;
  }

  function fill(npcId) {
    const r = forNpc(npcId);
    if (!r || typeof global.openMarket !== 'function') return;
    global.openMarket({ wanted: r.kind === 'item' ? { itemKey: r.item.item_key, itemName: r.item.name } : { resource: r.resource } });
  }

  global.KWRequests = { start, check, forNpc, panelHtml, fill, what, _set(list, hasMarket) { _list = list; _hasMarket = hasMarket; } };
})(typeof window !== 'undefined' ? window : this);
