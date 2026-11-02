// ══════════════════════════════════════════════════════════════════════════
//  KWCards — the card collection, client side (server: lib/cards.js,
//  routes/cards.js).
//
//    loadVillage(npcId)  the "Fighting ways" section in a village's panel:
//                        the two cards an Allied village teaches this week
//    learn(npcId, key)   buy one (Allied only)
//    onEvent(ev)         realtime: battle_spoils / card_unlocked → toasts
//    devUnlockAll()      Dev Tools: every card for this town
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const RARITY = { common: '#b8b0a0', uncommon: '#8ecf7e', rare: '#7ab8e8', epic: '#c08ae8', legendary: '#e8c76a' };
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'card'); };

  function villageHtml(d) {
    const head = '<div class="diplo-action-label">⚔ Fighting ways</div>';
    if (!d || !d.cards || !d.cards.length) return head + '<div class="diplo-action-empty">They have nothing to teach.</div>';
    const rows = d.cards.map(c => {
      const btn = c.owned ? '<span class="kc-owned">✓ Known</span>'
        : d.allied ? `<button class="diplo-btn kc-learn" data-kc-learn="${esc(c.key)}" onclick="KWCards.learn(${d.village.id}, '${esc(c.key)}', this)">Learn · 🪙 ${c.price}</button>`
        : '<span class="kc-locked">🔒 Allied</span>';
      return `<div class="kc-card"><div class="kc-card-head"><b>${esc(c.name)}</b> <span class="kc-rarity" style="color:${RARITY[c.rarity] || '#ccc'}">${esc(c.rarity)}</span>`
        + ` <span class="kc-cost">${c.cost}⚡</span></div><div class="kc-desc">${esc(c.desc || '')}</div><div class="kc-act">${btn}</div></div>`;
    }).join('');
    const note = d.allied ? 'They teach your fighters a new card or two each week.'
      : `Become Allied (trust ${d.needs_trust || 71}+) and they will teach your fighters these.`;
    return head + `<div class="kc-note">${note}</div>` + `<div class="kc-list">${rows}</div>`;
  }

  async function loadVillage(npcId) {
    const box = document.getElementById('dm-cards-' + npcId);
    if (!box) return;
    try {
      const r = await global.apiFetch('/api/cards/village/' + npcId);
      const d = await r.json();
      if (!r.ok) { box.innerHTML = ''; return; }
      box.innerHTML = villageHtml(d);
    } catch (e) { box.innerHTML = ''; }
  }

  async function learn(npcId, key, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await global.apiFetch(`/api/cards/village/${npcId}/${encodeURIComponent(key)}`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { if (btn) btn.disabled = false; toast('⚠️ ' + (d.error || 'They couldn\'t teach you that.'), 'error'); return; }
      toast(`🃏 ${d.village} taught your fighters ${d.card.name}. Add it to a deck from the Deck Builder.`);
      if (global.gameData && global.gameData.settlement && global.gameData.settlement.resources && d.wealth != null) {
        global.gameData.settlement.resources.wealth = d.wealth;
        if (typeof global.tickResources !== 'undefined' && global.tickResources) global.tickResources.wealth = d.wealth;
        if (typeof global.updateTopbarDisplay === 'function') global.updateTopbarDisplay();
      }
      loadVillage(npcId);
    } catch (e) { if (btn) btn.disabled = false; toast('⚠️ Connection hiccup — try again.', 'error'); }
  }

  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'card_unlocked' && ev.card) toast(`🃏 New card: ${ev.card.name}! Add it to a deck from the Deck Builder.`);
    if (ev.type === 'battle_spoils') {
      const items = (ev.items || []).map(i => `${i.icon || '📦'} ${i.name} ×${i.qty}`).join(', ');
      if (items) toast('⚔️ Battle spoils added to your stores: ' + items + '.', 'quest');
      if (ev.card) toast(`🃏 New card: ${ev.card.name}! Add it to a deck from the Deck Builder.`);
      if (typeof global.loadInventory === 'function') { try { global.loadInventory(); } catch (_) {} }
    }
  }

  async function devUnlockAll() {
    const r = await global.apiFetch('/api/cards/admin/unlock-all', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    toast(r.ok ? `🃏 Unlocked ${d.unlocked} card${d.unlocked === 1 ? '' : 's'}.` : '⚠️ ' + (d.error || 'Failed.'), r.ok ? 'card' : 'error');
    return d;
  }

  global.KWCards = { loadVillage, learn, onEvent, devUnlockAll, _villageHtml: villageHtml };
})(typeof window !== 'undefined' ? window : globalThis);
