// ══════════════════════════════════════════════════════════════════════════
//  ClanTreasury — the clan panel's Treasury and Goals tabs (server:
//  lib/clan_treasury.js, lib/clan_goals.js, routes/clan_extras.js).
//
//  Treasury  balance, give wealth (up to 2,000 a day; prestige for every
//            10), the five boons (bought by ranks that may spend), land
//            income, and the log of every coin in and out.
//  Goals     this week's three goals with progress bars, the reward, when
//            the week turns over, weeks completed, and the clan's honors.
//
//  Same shape as js/clan-quests.js: html(tab), load(tab), onClick(el),
//  driven by js/clans.js (data-ct="…" buttons).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = v => Number(v || 0).toLocaleString();
  const st = { treasury: null, goals: null, loading: {} };
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };

  async function call(method, path, body) {
    const res = await global.apiFetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    let d = {};
    try { d = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(d.error || 'Something went wrong.');
    return d;
  }

  async function load(tab) {
    if (st.loading[tab]) return;
    st.loading[tab] = true;
    try { st[tab] = await call('GET', tab === 'goals' ? '/api/clans/goals' : '/api/clans/treasury'); }
    catch (e) { st[tab] = { error: e.message }; }
    finally { st.loading[tab] = false; }
    if (global.ClanUI && global.ClanUI.renderTab) global.ClanUI.renderTab(tab);
  }

  function left(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return 'soon';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
    return d ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
  }

  const LOG = {
    donate: l => `💰 <b>${esc(l.who || 'Someone')}</b> gave ${n(l.amount)}`,
    boon: l => `🛡 <b>${esc(l.who || 'Someone')}</b> bought ${esc(((l.detail || {}).boon || '').replace(/_/g, ' '))} for ${n(-l.amount)}`,
    territory: l => `🗺 The land paid ${n(l.amount)} (${(l.detail || {}).tiles || 0} tiles)`,
    goal: l => `🎯 A weekly goal paid ${n(l.amount)}`,
    admin: l => `🛠 ${n(l.amount)} added <span class="clan-muted">(Dev Tools)</span>`,
  };

  function treasuryHtml() {
    const d = st.treasury;
    if (!d) { load('treasury'); return '<div class="clan-empty">Counting the coffers…</div>'; }
    if (d.error) return `<div class="clan-empty">${esc(d.error)}</div>`;
    const dn = d.donate;
    const boons = d.boons.map(b => `<div class="ct-boon${b.active ? ' on' : ''}">
        <div class="ct-boon-head">${b.icon} <b>${esc(b.label)}</b>${b.active ? ` <span class="ct-boon-live">active · ${esc(left(b.until))} left</span>` : ''}</div>
        <div class="clan-muted">${esc(b.desc)}</div>
        ${b.active ? '' : d.can_spend
          ? `<button type="button" class="clan-btn small" data-ct="boon" data-key="${esc(b.key)}" ${d.treasury < b.cost ? 'disabled' : ''}>Buy · ${n(b.cost)} for ${b.days} days</button>`
          : `<span class="clan-muted">${n(b.cost)} · officers and above buy boons</span>`}
      </div>`).join('');
    const log = d.log.length ? d.log.map(l => `<li><span>${(LOG[l.kind] || (() => esc(l.kind)))(l)}</span><span class="clan-muted">${esc(new Date(l.at).toLocaleDateString())}</span></li>`).join('')
      : '<li class="clan-muted">Nothing yet.</li>';
    return `
      <section class="clan-sec">
        <div class="clan-overview-top">
          <div class="clan-terr-count">💰 ${n(d.treasury)}</div>
          <div><div class="clan-level">Clan treasury</div>
            <div class="clan-muted">Every member can give; boons are bought from here. Land pays ${n(d.land.income_per_day)} a day (${d.land.tiles} tiles × ${d.land.income_per_day && d.land.tiles ? Math.round(d.land.income_per_day / d.land.tiles) : 2}).</div></div>
        </div>
        <div class="ct-give">
          <input class="clan-input ct-amount" id="ct-amount" type="number" min="1" max="${dn.left_today}" step="10" value="${Math.min(100, dn.left_today)}" aria-label="Wealth to give" ${dn.left_today ? '' : 'disabled'}>
          <button type="button" class="clan-btn" data-ct="donate" ${dn.left_today ? '' : 'disabled'}>Give wealth</button>
          <span class="clan-muted">${n(dn.left_today)} of ${n(dn.cap)} left today · 1 prestige per ${dn.prestige_per}</span>
        </div>
      </section>
      <section class="clan-sec"><h3>Boons <span class="clan-muted">· a week each, for every member</span></h3><div class="ct-boons">${boons}</div></section>
      <section class="clan-sec"><h3>Land</h3>
        <p class="clan-muted">Each tile of clan land pays the treasury ${2} wealth a day. A member's outpost on clan land works +${Math.round(d.land.outpost_bonus * 100)}% and is +${d.land.defence} harder to raid.</p></section>
      <section class="clan-sec"><h3>Ledger</h3><ul class="clan-list ct-log">${log}</ul></section>`;
  }

  function goalsHtml() {
    const d = st.goals;
    if (!d) { load('goals'); return '<div class="clan-empty">Reading this week\'s goals…</div>'; }
    if (d.error) return `<div class="clan-empty">${esc(d.error)}</div>`;
    const goals = d.goals.map(g => {
      const pct = Math.min(100, Math.round(100 * g.progress / Math.max(1, g.target)));
      return `<div class="ct-goal${g.done ? ' done' : ''}">
          <div class="ct-goal-head">${g.icon} <b>${esc(g.label)}</b> <span class="ct-goal-n">${g.done ? '✓ Done' : `${n(Math.min(g.progress, g.target))} / ${n(g.target)}`}</span></div>
          <div class="ct-bar"><div class="ct-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
    const honors = (d.honors || []).length
      ? `<div class="ct-honors">${d.honors.map(h => `<div class="ct-honor" title="${esc(h.desc)}">${h.icon}<span>${esc(h.label)}</span></div>`).join('')}</div>`
      : '<p class="clan-muted">No honors yet — a week of goals met, broad lands, clan levels and members\' Wonders all earn them.</p>';
    return `
      <section class="clan-sec">
        <p class="clan-muted">Three goals a week for the whole clan. Each one met pays <b>${d.reward.prestige}</b> prestige and <b>${d.reward.treasury}</b> into the treasury. New goals in <b>${esc(left(d.ends_at))}</b>.</p>
        <div class="ct-goals">${goals}</div>
        ${d.all_done ? '<p class="ct-all-done">🎯 All three met this week!</p>' : ''}
        <p class="clan-muted">Weeks with every goal met: <b>${d.weeks_done}</b></p>
      </section>
      <section class="clan-sec"><h3>Honors</h3>${honors}</section>`;
  }

  function html(tab) { return tab === 'goals' ? goalsHtml() : treasuryHtml(); }

  async function onClick(el) {
    const act = el.dataset.ct;
    try {
      if (act === 'donate') {
        const amount = parseInt((document.getElementById('ct-amount') || {}).value, 10);
        if (!(amount > 0)) return toast('Give at least 1 wealth.', 'error');
        el.disabled = true;
        const d = await call('POST', '/api/clans/treasury/donate', { amount });
        toast(`💰 Gave ${n(amount)} to the treasury${d.prestige ? ` (+${d.prestige} prestige)` : ''}.`);
        if (global.gameData && global.gameData.settlement && global.gameData.settlement.resources) {
          global.gameData.settlement.resources.wealth = d.wealth;
          if (typeof global.tickResources !== 'undefined' && global.tickResources) global.tickResources.wealth = d.wealth;
          if (typeof global.updateTopbarDisplay === 'function') global.updateTopbarDisplay();
        }
      } else if (act === 'boon') {
        el.disabled = true;
        const d = await call('POST', `/api/clans/boons/${encodeURIComponent(el.dataset.key)}`);
        toast(`🛡 Boon bought for ${n(d.cost)} — every member feels it for a week.`);
      }
      st.treasury = null; st.goals = null;
      load('treasury');
      if (global.ClanUI && global.ClanUI.refresh) global.ClanUI.refresh();
    } catch (e) { el.disabled = false; toast(e.message, 'error'); }
  }

  async function devAddTreasury(amount) {
    try { const d = await call('POST', '/api/clans/admin/treasury', { amount: amount || 1000 }); toast(`💰 Treasury now ${n(d.treasury)}.`); st.treasury = null; load('treasury'); }
    catch (e) { toast(e.message, 'error'); }
  }

  global.ClanTreasury = { html, load, onClick, devAddTreasury, reset: () => { st.treasury = null; st.goals = null; }, _st: st, _treasuryHtml: treasuryHtml, _goalsHtml: goalsHtml };
})(typeof window !== 'undefined' ? window : globalThis);
