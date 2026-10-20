// ══════════════════════════════════════════════════════════════════════════
//  MARKET — player-to-player trading panel
//
//  Opened from the Market comm-btn, a player town on the world map ("Trade")
//  and the Market building. Server: /api/market (kindlewood-server
//  routes/market.js, flow in lib/market.js).
//    · no Market built → what it takes to build one + a link to the plot
//    · Buy      → other towns' sell orders (sort by distance, price, amount,
//                 arrival), buy one lot at a time
//    · Sell     → list a sell order and choose its merchants
//    · Caravans → merchants on the road both ways, and your own orders
//
//  #market-panel is registered in mobile-shell.js watchOverlays(); it must
//  use display:none when closed for that check to work.
//
//  Depends on: apiFetch (main.js), escHtml (profile.js), showBuildToast
//  (buildings.js), refreshResources (buildings.js), _costChips +
//  _liveResources (main.js), openSettlementBuild (settlement-view.js).
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const esc = s => (typeof global.escHtml === 'function' ? global.escHtml(s) : String(s ?? ''));
  const RES_ICON = { food: '🍎', timber: '🪵', stone: '🪨', metal: '⚙️', wealth: '🪙' };
  const RES_LABEL = { food: 'Food', timber: 'Timber', stone: 'Stone', metal: 'Metal', wealth: 'Gold' };
  const TIER_LABEL = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  const SORTS = [
    ['distance', 'Nearest'], ['unit_price', 'Price per unit'],
    ['amount', 'Amount available'], ['eta', 'Arrival time'],
  ];

  const state = {
    tab: 'buy',            // buy | sell | caravans
    status: null,          // GET /status
    orders: null,          // GET /orders → orders[]
    mine: null,            // GET /mine
    clockSkew: 0,          // server now − client now (ms)
    resource: '',          // buy filter
    sort: 'distance',
    dir: 'asc',
    seller: null,          // { id, name } — buy tab filtered to one town
    draft: { resource: 'timber', qty_total: '', lot_size: '', lot_price: '', citizen_ids: [] },
    busy: false,
    unseen: false,         // red dot on the comm-btn
  };
  let ticker = null;
  let refreshTimer = null;

  function toast(msg, type) {
    if (typeof global.showBuildToast === 'function') global.showBuildToast(msg, type || 'success');
  }

  async function call(method, path, body) {
    const res = await global.apiFetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ── Formatting ──────────────────────────────────────────────────────────

  const fmt = n => Math.floor(Number(n) || 0).toLocaleString();
  const price2 = n => (Math.round(Number(n) * 100) / 100).toFixed(2);
  function dur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + 's';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + 'h ' + (m ? m + 'm' : '');
    return m + 'm' + (s ? ' ' + s + 's' : '');
  }
  function untilLong(iso) {
    const sec = (new Date(iso).getTime() - now()) / 1000;
    if (sec <= 0) return 'now';
    const d = Math.floor(sec / 86400);
    return d ? d + 'd ' + Math.floor((sec % 86400) / 3600) + 'h' : dur(sec);
  }
  const now = () => Date.now() + state.clockSkew;
  const resChip = (res, n) => `<span class="mk-res">${RES_ICON[res] || ''} ${fmt(n)} ${esc((RES_LABEL[res] || res).toLowerCase())}</span>`;
  const gold = n => `<span class="mk-gold">🪙 ${fmt(n)}</span>`;

  function liveResources() {
    if (typeof global._liveResources === 'function') return global._liveResources() || {};
    return (state.status && state.status.resources) || {};
  }

  // ── DOM scaffold ────────────────────────────────────────────────────────

  function panel() {
    let el = document.getElementById('market-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'market-panel';
    el.className = 'mk-backdrop';
    el.innerHTML = `
      <div class="mk-card kw-ornate-frame" role="dialog" aria-modal="true" aria-labelledby="mk-title">
        <div class="mk-head">
          <span class="mk-head-icon" aria-hidden="true">⚖️</span>
          <div class="mk-head-text">
            <div class="mk-title" id="mk-title">Market</div>
            <div class="mk-sub" id="mk-sub"></div>
          </div>
          <button class="mk-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="mk-tabs" id="mk-tabs"></div>
        <div class="mk-body" id="mk-body"></div>
        <div class="mk-sheet-wrap" id="mk-sheet-wrap"></div>
      </div>`;
    el.addEventListener('click', e => { if (e.target === el) closeMarket(); });
    el.querySelector('.mk-close').addEventListener('click', closeMarket);
    el.addEventListener('click', onAction);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('submit', onSubmit);
    document.body.appendChild(el);
    return el;
  }
  const byId = id => document.getElementById(id);

  function isOpen() {
    const el = byId('market-panel');
    return !!el && el.classList.contains('open');
  }

  // opts: { seller: settlementId, sellerName, tab }
  async function openMarket(opts) {
    opts = opts || {};
    const el = panel();
    el.classList.add('open');
    closeSheet();
    if (opts.seller) { state.seller = { id: Number(opts.seller), name: opts.sellerName || 'this town' }; state.tab = 'buy'; }
    if (opts.tab) state.tab = opts.tab;
    setDot(false);
    markCommBtn(true);
    renderLoading();
    await refresh();
    startTicker();
  }

  function closeMarket() {
    const el = byId('market-panel');
    if (el) el.classList.remove('open');
    closeSheet();
    stopTicker();
    markCommBtn(false);
  }

  function commBtn() { return byId('nav-market'); }
  function markCommBtn(on) {
    const b = commBtn();
    if (!b) return;
    if (on) document.querySelectorAll('.comm-btn').forEach(x => x.classList.remove('active'));
    b.classList.toggle('active', !!on);
  }
  function setDot(on) {
    state.unseen = !!on;
    const b = commBtn();
    if (b) b.classList.toggle('has-dot', !!on);
  }

  // ── Data ────────────────────────────────────────────────────────────────

  async function refresh() {
    try {
      state.status = await call('GET', '/api/market/status');
      if (state.status.unlocked) await loadTab();
    } catch (e) {
      renderError(e.message);
      return;
    }
    render();
  }

  async function loadTab() {
    if (state.tab === 'buy') {
      const qs = new URLSearchParams({ sort: state.sort, dir: state.dir });
      if (state.resource) qs.set('resource', state.resource);
      if (state.seller) qs.set('seller', state.seller.id);
      state.orders = (await call('GET', '/api/market/orders?' + qs.toString())).orders || [];
    } else {
      const mine = await call('GET', '/api/market/mine');
      if (mine.now) state.clockSkew = new Date(mine.now).getTime() - Date.now();
      state.mine = mine;
    }
  }

  async function switchTab(tab) {
    state.tab = tab;
    closeSheet();
    renderLoading(true);
    try { await loadTab(); } catch (e) { renderError(e.message); return; }
    render();
  }

  // Re-fetch the current view, without stomping on a half-typed form.
  async function softRefresh() {
    if (!isOpen()) return;
    if (state.tab === 'sell' && document.activeElement && byId('mk-body')?.contains(document.activeElement)) return;
    try {
      state.status = await call('GET', '/api/market/status');
      if (state.status.unlocked) await loadTab();
      render();
    } catch (_) { /* next event or tick retries */ }
  }
  function scheduleRefresh(ms) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(softRefresh, ms);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  function renderLoading(keepTabs) {
    if (!keepTabs) byId('mk-tabs').innerHTML = '';
    byId('mk-body').innerHTML = '<div class="mk-empty">Unrolling the ledgers…</div>';
  }
  function renderError(msg) {
    byId('mk-body').innerHTML = `<div class="mk-empty">${esc(msg || 'The market is closed right now.')}</div>`;
  }

  function render() {
    const st = state.status;
    if (!st) return;
    const sub = byId('mk-sub');
    if (!st.unlocked) {
      byId('mk-title').textContent = 'Market';
      sub.textContent = 'Trade goods with settlements you know';
      byId('mk-tabs').innerHTML = '';
      byId('mk-body').innerHTML = lockedHtml(st);
      return;
    }
    byId('mk-title').textContent = `Market · Level ${st.mods.marketLevel}`;
    sub.innerHTML = `${st.mods.merchants} merchant${st.mods.merchants === 1 ? '' : 's'} · carries ${fmt(st.mods.carryWeight)} per trip · ${Math.round(st.mods.feeRate * 100)}% fee`;
    const tabs = [['buy', '🛒 Buy'], ['sell', '📦 Sell'], ['caravans', '🐾 Caravans']];
    byId('mk-tabs').innerHTML = tabs.map(([k, label]) =>
      `<button type="button" class="mk-tab ${state.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${label}</button>`).join('');
    const body = byId('mk-body');
    body.innerHTML = state.tab === 'buy' ? buyHtml() : state.tab === 'sell' ? sellHtml() : caravansHtml();
    if (state.tab === 'sell') updateSellSummary();
    tickCountdowns();
  }

  // ── Locked: no Market yet ───────────────────────────────────────────────

  function levelTableHtml(st, highlight) {
    const caps = st.levelCaps || {};
    const req = st.building.levelTierReq || {};
    const rows = Object.keys(caps).map(Number).sort((a, b) => a - b).map(lvl => {
      const tier = req[lvl] || st.building.minTier || 'camp';
      return `<tr class="${lvl === highlight ? 'on' : ''}">
        <td>Lv ${lvl}</td><td>${esc(TIER_LABEL(tier))}</td>
        <td>${fmt(caps[lvl].carryWeight)}</td><td>${lvl}</td><td>${caps[lvl].maxOrders}</td></tr>`;
    }).join('');
    return `<table class="mk-levels">
      <thead><tr><th>Market</th><th>Needs</th><th>Carry / trip</th><th>Merchants</th><th>Orders</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="mk-muted mk-small">Carry weight: food ½ · timber 1 · stone 1 · metal 2 per unit.</div>`;
  }

  function lockedHtml(st) {
    const b = st.building;
    const have = liveResources();
    const costChips = typeof global._costChips === 'function'
      ? global._costChips(b.cost, have)
      : Object.entries(b.cost).map(([r, v]) => `<span class="op-chip ${(have[r] ?? 0) < v ? 'op-chip-short' : ''}">${RES_ICON[r] || ''} ${v}</span>`).join('');
    const short = Object.entries(b.cost).some(([r, v]) => (have[r] ?? 0) < v);
    const TIERS = ['camp', 'village', 'town', 'city'];
    const tierOk = TIERS.indexOf(st.tier || 'camp') >= TIERS.indexOf(b.minTier || 'camp');
    const reqRows = [
      `<div class="mk-req ${tierOk ? 'ok' : 'no'}"><span>${tierOk ? '✓' : '✗'}</span> Settlement level: ${b.minTier && b.minTier !== 'camp' ? esc(TIER_LABEL(b.minTier)) + ' or higher' : 'any (Camp or higher)'}</div>`,
      ...b.requires.map(r => `<div class="mk-req ${r.built ? 'ok' : 'no'}"><span>${r.built ? '✓' : '✗'}</span> Requires a ${esc(r.label)}</div>`),
      `<div class="mk-req ${short ? 'no' : 'ok'}"><span>${short ? '✗' : '✓'}</span> Resources <span class="mk-chips">${costChips}</span></div>`,
    ].join('');
    const img = b.imgFile ? `<img class="mk-lock-img" src="/assets/images/buildings/${esc(b.imgFile)}" alt="" onerror="this.remove()">` : '';
    return `
      <div class="mk-lock">
        ${img || `<div class="mk-lock-icon">${esc(b.icon || '⚖️')}</div>`}
        <h3>Build a Market to start trading</h3>
        <p class="mk-muted">${esc(b.desc)}</p>
        <p class="mk-muted">Merchants from your town carry goods to buyers and bring the gold home — the farther the town, the longer the road. You can trade with towns you have both discovered, and with your clanmates.</p>
      </div>
      <div class="mk-sec">
        <h3>What it takes</h3>
        ${reqRows}
        <button type="button" class="mk-btn mk-btn-primary mk-wide" data-act="build-market">⚖️ Build a Market${short ? ' — gather resources first' : ''}</button>
      </div>
      <div class="mk-sec">
        <h3>How it grows</h3>
        ${levelTableHtml(st, 1)}
      </div>`;
  }

  // ── Buy ─────────────────────────────────────────────────────────────────

  function buyHtml() {
    const st = state.status;
    const resOpts = ['<option value="">All goods</option>']
      .concat(st.tradeable.map(r => `<option value="${r}" ${state.resource === r ? 'selected' : ''}>${RES_ICON[r]} ${RES_LABEL[r]}</option>`)).join('');
    const sortOpts = SORTS.map(([k, l]) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${l}</option>`).join('');
    const sellerChip = state.seller
      ? `<div class="mk-filter-chip">Only ${esc(state.seller.name)} <button type="button" data-act="clear-seller" aria-label="Show all towns">✕</button></div>`
      : '';
    const wealth = liveResources().wealth ?? st.resources.wealth;
    const list = (state.orders || []);
    const rows = list.length ? list.map(o => {
      const afford = wealth >= o.next_lot_price;
      const btn = o.paused
        ? `<button type="button" class="mk-btn" disabled>On the road</button>`
        : `<button type="button" class="mk-btn mk-btn-primary" data-act="buy" data-id="${o.id}" ${afford ? '' : 'disabled title="Not enough gold"'}>Buy lot</button>`;
      const eta = o.paused
        ? `<span class="mk-paused">⏸ Paused — merchant back in <span data-until="${esc(o.next_free_at)}">…</span></span>`
        : `<span>Arrives in ~${dur(o.eta_seconds)}</span>`;
      return `<li class="mk-order ${o.paused ? 'paused' : ''}">
        <div class="mk-order-main">
          <div class="mk-order-line">${resChip(o.resource, o.next_lot_qty)} <span class="mk-for">for</span> ${gold(o.next_lot_price)}</div>
          <div class="mk-order-meta">
            <span>${price2(o.unit_price)} gold / unit</span> ·
            <span>${fmt(o.qty_available)} left</span> ·
            <span>${o.merchants} merchant${o.merchants === 1 ? '' : 's'}</span>
          </div>
          <div class="mk-order-meta">
            <button type="button" class="mk-link" data-act="filter-seller" data-id="${o.seller.id}" data-name="${esc(o.seller.name)}">${esc(o.seller.name)}</button>
            <span class="mk-muted">(${esc(o.seller.username)} · ${esc(o.seller.species || '')})</span> ·
            <span>${o.distance} hex${o.distance === 1 ? '' : 'es'} away</span> · ${eta}
          </div>
        </div>
        <div class="mk-order-act">${btn}</div>
      </li>`;
    }).join('') : `<li class="mk-empty">${state.seller
      ? `${esc(state.seller.name)} has nothing for sale right now.`
      : 'No sell orders from towns you know. Scout further, or join a clan — clanmates can always trade.'}</li>`;
    return `
      <div class="mk-toolbar">
        <select data-act="filter-resource" aria-label="Filter goods">${resOpts}</select>
        <select data-act="sort" aria-label="Sort by">${sortOpts}</select>
        <button type="button" class="mk-btn mk-btn-sm" data-act="dir" title="Reverse order">${state.dir === 'asc' ? '↑ Low first' : '↓ High first'}</button>
      </div>
      ${sellerChip}
      <div class="mk-muted mk-small">You have ${gold(wealth)}. Gold is paid when you buy; the goods arrive with the seller’s merchant.</div>
      <ul class="mk-list">${rows}</ul>`;
  }

  function openBuySheet(order) {
    sheet(`
      <h3>Buy ${RES_ICON[order.resource]} ${fmt(order.next_lot_qty)} ${esc(RES_LABEL[order.resource].toLowerCase())}?</h3>
      <div class="mk-sum">
        <div><span>From</span><b>${esc(order.seller.name)}</b></div>
        <div><span>You pay now</span><b>${gold(order.next_lot_price)}</b></div>
        <div><span>Per unit</span><b>${price2(order.next_lot_price / order.next_lot_qty)} gold</b></div>
        <div><span>Distance</span><b>${order.distance} hexes</b></div>
        <div><span>Arrives in</span><b>~${dur(order.eta_seconds)}</b></div>
      </div>
      <p class="mk-muted mk-small">Their merchant walks the goods to your town, then heads home with your gold. If they have no other merchant free, the order pauses while this one travels.</p>
      <div class="mk-sheet-actions">
        <button type="button" class="mk-btn" data-act="sheet-close">Cancel</button>
        <button type="button" class="mk-btn mk-btn-primary" data-act="buy-confirm" data-id="${order.id}">Buy for 🪙 ${fmt(order.next_lot_price)}</button>
      </div>`);
  }

  async function buy(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      const r = await call('POST', `/api/market/orders/${id}/buy`);
      closeSheet();
      toast(`🐾 ${r.merchant} of ${r.seller} is on the way with ${fmt(r.trip.qty)} ${RES_LABEL[r.trip.resource].toLowerCase()}.`);
      if (typeof global.refreshResources === 'function') global.refreshResources();
      await softRefresh();
    } catch (e) {
      toast(e.message, 'error');
      closeSheet();
      await softRefresh();
    } finally { state.busy = false; }
  }

  // ── Sell ────────────────────────────────────────────────────────────────

  function sellHtml() {
    const st = state.status, d = state.draft, mods = st.mods;
    const mine = state.mine || { candidates: [] };
    const have = liveResources();
    const resOpts = st.tradeable.map(r =>
      `<option value="${r}" ${d.resource === r ? 'selected' : ''}>${RES_ICON[r]} ${RES_LABEL[r]} (have ${fmt(have[r] ?? st.resources[r])})</option>`).join('');
    const maxLot = Math.floor(mods.carryWeight / st.unitWeight[d.resource]);
    const free = mods.merchants - st.merchantsAssigned;
    const atOrderCap = st.activeOrders >= mods.maxOrders;
    const cands = mine.candidates.map(c => {
      const checked = d.citizen_ids.includes(c.id);
      const disabled = !!c.busy && !checked;
      return `<label class="mk-cand ${disabled ? 'busy' : ''}">
        <input type="checkbox" data-act="pick-merchant" value="${c.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="mk-cand-name">${esc(c.name)}</span>
        <span class="mk-muted mk-small">${esc(c.role)} · scouting ${c.scouting}${c.busy ? ' · ' + esc(c.busy.replace(c.name + ' ', '')) : ''}</span>
      </label>`;
    }).join('') || '<div class="mk-muted">No adults free to trade.</div>';
    const blocked = atOrderCap
      ? `<div class="mk-warn">Your Market runs ${mods.maxOrders} order${mods.maxOrders === 1 ? '' : 's'} at once. Cancel one or upgrade the Market.</div>`
      : free <= 0
        ? `<div class="mk-warn">All ${mods.merchants} merchant slot${mods.merchants === 1 ? ' is' : 's are'} in use. Upgrade the Market for more.</div>`
        : '';
    return `
      <form class="mk-form" data-form="sell">
        <div class="mk-caps">
          <span>Orders <b>${st.activeOrders} / ${mods.maxOrders}</b></span>
          <span>Merchants <b>${st.merchantsAssigned} / ${mods.merchants}</b></span>
          <span>Carry <b>${fmt(mods.carryWeight)}</b> per trip</span>
        </div>
        ${blocked}
        <label class="mk-field"><span>Goods</span>
          <select name="resource" data-act="draft">${resOpts}</select></label>
        <label class="mk-field"><span>Total to sell</span>
          <input name="qty_total" type="number" min="1" step="1" inputmode="numeric" value="${esc(d.qty_total)}" placeholder="e.g. 500" data-act="draft"></label>
        <label class="mk-field"><span>Per delivery <em class="mk-muted">(max ${fmt(maxLot)})</em></span>
          <input name="lot_size" type="number" min="1" max="${maxLot}" step="1" inputmode="numeric" value="${esc(d.lot_size)}" placeholder="${maxLot}" data-act="draft"></label>
        <label class="mk-field"><span>Price per delivery <em class="mk-muted">(gold)</em></span>
          <input name="lot_price" type="number" min="1" step="1" inputmode="numeric" value="${esc(d.lot_price)}" placeholder="gold" data-act="draft"></label>
        <div class="mk-summary" id="mk-sell-summary"></div>
        <div class="mk-field"><span>Merchants <em class="mk-muted">(${Math.max(0, free)} slot${free === 1 ? '' : 's'} free — more merchants means fewer pauses)</em></span>
          <div class="mk-cands">${cands}</div></div>
        <p class="mk-muted mk-small">Goods leave your stores when you list them and come back if you cancel or the order expires (after ${Math.round(mods.expiryHours / 24)} days). Merchants stop their usual work while they trade.</p>
        <button type="submit" class="mk-btn mk-btn-primary mk-wide" ${blocked ? 'disabled' : ''}>📦 List for sale</button>
      </form>`;
  }

  function readDraft() {
    const f = document.querySelector('#market-panel form[data-form="sell"]');
    if (!f) return;
    const d = state.draft;
    d.resource = f.resource.value;
    d.qty_total = f.qty_total.value;
    d.lot_size = f.lot_size.value;
    d.lot_price = f.lot_price.value;
  }

  // Live numbers under the form; only this block re-renders while typing.
  function updateSellSummary() {
    const el = byId('mk-sell-summary');
    if (!el) return;
    const st = state.status, d = state.draft;
    const maxLot = Math.floor(st.mods.carryWeight / st.unitWeight[d.resource]);
    const total = parseInt(d.qty_total, 10) || 0;
    const lot = parseInt(d.lot_size, 10) || Math.min(maxLot, total || maxLot);
    const lotPrice = parseInt(d.lot_price, 10) || 0;
    const ref = st.referencePrice[d.resource];
    const have = liveResources()[d.resource] ?? st.resources[d.resource];
    const lines = [];
    lines.push(`Market guide price: about <b>${price2(ref)}</b> gold per ${RES_LABEL[d.resource].toLowerCase()} (≈ ${fmt(Math.max(1, Math.round(ref * lot)))} for ${fmt(lot)}).`);
    if (total && lot) {
      const lots = Math.ceil(total / lot);
      lines.push(`${lots} deliver${lots === 1 ? 'y' : 'ies'} of up to ${fmt(lot)}.`);
    }
    if (lotPrice && lot) {
      const fee = Math.floor(lotPrice * st.mods.feeRate);
      lines.push(`${price2(lotPrice / lot)} gold per unit · you keep ${fmt(lotPrice - fee)} per delivery after the ${Math.round(st.mods.feeRate * 100)}% fee.`);
    }
    const warn = [];
    if (lot > maxLot) warn.push(`A merchant carries at most ${fmt(maxLot)} ${RES_LABEL[d.resource].toLowerCase()}.`);
    if (total > have) warn.push(`You only have ${fmt(have)}.`);
    if (total && lot > total) warn.push('Per delivery can’t be more than the total.');
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join('') + warn.map(w => `<div class="mk-warn-text">${w}</div>`).join('');
  }

  async function submitSell() {
    if (state.busy) return;
    readDraft();
    const d = state.draft;
    const st = state.status;
    const maxLot = Math.floor(st.mods.carryWeight / st.unitWeight[d.resource]);
    const qty_total = parseInt(d.qty_total, 10);
    const lot_size = parseInt(d.lot_size, 10) || Math.min(maxLot, qty_total || 0);
    const lot_price = parseInt(d.lot_price, 10);
    if (!qty_total || !lot_price) return toast('Set how much to sell and the price per delivery.', 'error');
    if (!d.citizen_ids.length) return toast('Choose at least one merchant.', 'error');
    state.busy = true;
    try {
      await call('POST', '/api/market/orders', {
        resource: d.resource, qty_total, lot_size, lot_price, citizen_ids: d.citizen_ids,
      });
      toast(`📦 Listed ${fmt(qty_total)} ${RES_LABEL[d.resource].toLowerCase()} for sale.`);
      state.draft = { resource: d.resource, qty_total: '', lot_size: '', lot_price: '', citizen_ids: [] };
      if (typeof global.refreshResources === 'function') global.refreshResources();
      state.tab = 'caravans';
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally { state.busy = false; }
  }

  // ── Caravans & my orders ────────────────────────────────────────────────

  function tripHtml(t) {
    const res = RES_LABEL[t.resource].toLowerCase();
    const who = esc(t.citizen_name || 'A merchant');
    let text, from, to;
    if (t.direction === 'selling') {
      if (t.status === 'outbound') { text = `${who} is carrying ${fmt(t.qty)} ${res} to ${esc(t.buyer_name)}`; from = t.departs_at; to = t.arrives_at; }
      else if (t.status === 'returning') { text = `${who} is heading home with 🪙 ${fmt(t.gold_paid - t.fee)}`; from = t.arrives_at; to = t.returns_at; }
      else text = `${who} sold ${fmt(t.qty)} ${res} to ${esc(t.buyer_name)} for 🪙 ${fmt(t.gold_paid - t.fee)}`;
    } else {
      if (t.status === 'outbound') { text = `${fmt(t.qty)} ${res} on the way from ${esc(t.seller_name)}`; from = t.departs_at; to = t.arrives_at; }
      else text = `Received ${fmt(t.qty)} ${res} from ${esc(t.seller_name)} for 🪙 ${fmt(t.gold_paid)}`;
    }
    const live = !!to;
    return `<li class="mk-trip ${live ? 'live' : 'done'}">
      <div class="mk-trip-icon">${t.direction === 'selling' ? (t.status === 'returning' ? '🪙' : '🐾') : RES_ICON[t.resource]}</div>
      <div class="mk-trip-main">
        <div>${text}</div>
        ${live ? `<div class="mk-bar"><div class="mk-bar-fill" data-from="${esc(from)}" data-to="${esc(to)}"></div></div>
        <div class="mk-muted mk-small">${t.status === 'returning' ? 'Back' : 'Arrives'} in <span data-until="${esc(to)}">…</span> · ${t.distance} hexes</div>` : ''}
      </div>
    </li>`;
  }

  function myOrderHtml(o, candidates, mods, slotsFree) {
    const active = o.status === 'active';
    const statusLabel = { active: 'Open', sold_out: 'Sold out', cancelled: 'Cancelled', expired: 'Expired' }[o.status] || o.status;
    const merchants = o.merchants.map(m => `<span class="mk-merchant ${m.on_road ? 'road' : ''}">
        ${m.on_road ? '🐾' : '🏠'} ${esc(m.name)}${m.deceased ? ' (passed away)' : ''}
        ${active && !m.on_road && o.merchants.length > 1 ? `<button type="button" data-act="remove-merchant" data-order="${o.id}" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">✕</button>` : ''}
      </span>`).join('') || '<span class="mk-warn-text">No merchants — nobody can buy. Add one below.</span>';
    const freeCands = candidates.filter(c => !c.busy);
    const add = active && slotsFree > 0 && freeCands.length
      ? `<select data-act="add-merchant" data-order="${o.id}" aria-label="Add a merchant">
          <option value="">+ Add merchant…</option>
          ${freeCands.map(c => `<option value="${c.id}">${esc(c.name)} (scouting ${c.scouting})</option>`).join('')}
        </select>` : '';
    const sold = o.qty_total - o.qty_escrowed;
    return `<li class="mk-mine ${active ? '' : 'closed'}">
      <div class="mk-order-line">${resChip(o.resource, o.lot_size)} <span class="mk-for">for</span> ${gold(o.lot_price)}
        <span class="mk-status mk-status-${o.status}">${statusLabel}</span></div>
      <div class="mk-order-meta">${price2(o.unit_price)} gold / unit · ${fmt(o.qty_escrowed)} of ${fmt(o.qty_total)} waiting${sold && active ? ` · ${fmt(sold)} dispatched` : ''}${active ? ` · expires in ${untilLong(o.expires_at)}` : ''}</div>
      ${active ? `<div class="mk-merchants">${merchants}</div>
      <div class="mk-mine-act">${add}<button type="button" class="mk-btn mk-btn-sm mk-btn-danger" data-act="cancel" data-id="${o.id}">Cancel order</button></div>` : ''}
    </li>`;
  }

  function caravansHtml() {
    const st = state.status, mine = state.mine || { trips: [], orders: [], candidates: [] };
    const liveTrips = mine.trips.filter(t => (t.direction === 'selling' ? t.status !== 'done' : t.status === 'outbound'));
    const pastTrips = mine.trips.filter(t => !liveTrips.includes(t)).slice(0, 8);
    const slotsFree = st.mods.merchants - st.merchantsAssigned;
    const activeOrders = mine.orders.filter(o => o.status === 'active');
    const closedOrders = mine.orders.filter(o => o.status !== 'active').slice(0, 5);
    return `
      <div class="mk-sec">
        <h3>On the road</h3>
        <ul class="mk-list">${liveTrips.length ? liveTrips.map(tripHtml).join('') : '<li class="mk-empty">No caravans travelling.</li>'}</ul>
      </div>
      <div class="mk-sec">
        <h3>Your orders <span class="mk-muted mk-small">${activeOrders.length} / ${st.mods.maxOrders}</span></h3>
        <ul class="mk-list">${activeOrders.length
          ? activeOrders.map(o => myOrderHtml(o, mine.candidates, st.mods, slotsFree)).join('')
          : '<li class="mk-empty">Nothing for sale. <button type="button" class="mk-link" data-act="tab" data-tab="sell">List something</button></li>'}</ul>
      </div>
      ${pastTrips.length || closedOrders.length ? `<div class="mk-sec">
        <h3>Last 24 hours</h3>
        <ul class="mk-list">${pastTrips.map(tripHtml).join('')}${closedOrders.map(o => myOrderHtml(o, [], st.mods, 0)).join('')}</ul>
      </div>` : ''}
      <div class="mk-sec">
        <h3>Your Market</h3>
        ${levelTableHtml(st, st.mods.marketLevel)}
      </div>`;
  }

  // ── Countdown ticker ────────────────────────────────────────────────────

  function tickCountdowns() {
    const body = byId('mk-body');
    if (!body) return;
    let due = false;
    body.querySelectorAll('[data-until]').forEach(el => {
      const sec = (new Date(el.dataset.until).getTime() - now()) / 1000;
      if (sec <= 0) { el.textContent = 'moments'; due = true; }
      else el.textContent = dur(sec);
    });
    body.querySelectorAll('.mk-bar-fill').forEach(el => {
      const a = new Date(el.dataset.from).getTime(), b = new Date(el.dataset.to).getTime();
      const pct = b > a ? Math.min(100, Math.max(0, ((now() - a) / (b - a)) * 100)) : 100;
      el.style.width = pct.toFixed(1) + '%';
    });
    // A trip landed or a merchant came home — the server resolves on read.
    if (due && !refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; softRefresh(); }, 2500);
  }
  function startTicker() { stopTicker(); ticker = setInterval(tickCountdowns, 1000); }
  function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; clearTimeout(refreshTimer); refreshTimer = null; }

  // ── Sheet ───────────────────────────────────────────────────────────────

  function sheet(html) {
    const w = byId('mk-sheet-wrap');
    w.innerHTML = `<div class="mk-sheet">${html}</div>`;
    w.classList.add('open');
  }
  function closeSheet() {
    const w = byId('mk-sheet-wrap');
    if (w) { w.classList.remove('open'); w.innerHTML = ''; }
  }

  // ── Events ──────────────────────────────────────────────────────────────

  async function onAction(e) {
    const t = e.target.closest('[data-act]');
    if (!t || t.tagName === 'SELECT' || t.tagName === 'INPUT') return;
    const act = t.dataset.act;
    if (act === 'tab') return switchTab(t.dataset.tab);
    if (act === 'sheet-close') return closeSheet();
    if (act === 'build-market') {
      closeMarket();
      if (typeof global.openSettlementBuild === 'function') return global.openSettlementBuild('market');
      if (typeof global.openSettlementView === 'function') return global.openSettlementView();
      return;
    }
    if (act === 'dir') { state.dir = state.dir === 'asc' ? 'desc' : 'asc'; return switchTab('buy'); }
    if (act === 'clear-seller') { state.seller = null; return switchTab('buy'); }
    if (act === 'filter-seller') { state.seller = { id: Number(t.dataset.id), name: t.dataset.name }; return switchTab('buy'); }
    if (act === 'buy') {
      const o = (state.orders || []).find(x => x.id === Number(t.dataset.id));
      if (o) openBuySheet(o);
      return;
    }
    if (act === 'buy-confirm') return buy(Number(t.dataset.id));
    if (act === 'cancel') {
      if (!global.confirm('Cancel this order? Goods not yet on the road return to your stores.')) return;
      try {
        const r = await call('POST', `/api/market/orders/${t.dataset.id}/cancel`);
        toast(r.refunded ? `Order cancelled — ${fmt(r.refunded)} returned to your stores.` : 'Order cancelled.');
        if (typeof global.refreshResources === 'function') global.refreshResources();
        await softRefresh();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (act === 'remove-merchant') return editMerchants(t.dataset.order, { remove: [Number(t.dataset.id)] });
  }

  async function editMerchants(orderId, change) {
    try {
      await call('PATCH', `/api/market/orders/${orderId}/merchants`, change);
      await softRefresh();
    } catch (err) { toast(err.message, 'error'); await softRefresh(); }
  }

  function onChange(e) {
    const act = e.target.dataset.act;
    if (act === 'filter-resource') { state.resource = e.target.value; switchTab('buy'); }
    else if (act === 'sort') { state.sort = e.target.value; state.dir = e.target.value === 'amount' ? 'desc' : 'asc'; switchTab('buy'); }
    else if (act === 'add-merchant' && e.target.value) editMerchants(e.target.dataset.order, { add: [Number(e.target.value)] });
    else if (act === 'pick-merchant') {
      const id = Number(e.target.value);
      const ids = state.draft.citizen_ids.filter(x => x !== id);
      if (e.target.checked) {
        const st = state.status;
        if (ids.length >= st.mods.merchants - st.merchantsAssigned) {
          e.target.checked = false;
          return toast('No merchant slots left — upgrade the Market for more.', 'error');
        }
        ids.push(id);
      }
      state.draft.citizen_ids = ids;
    } else if (act === 'draft' && e.target.name === 'resource') {
      readDraft();
      render();  // per-delivery cap depends on the goods
    }
  }

  function onInput(e) {
    if (e.target.dataset.act !== 'draft') return;
    readDraft();
    updateSellSummary();
  }

  function onSubmit(e) {
    if (e.target.dataset.form !== 'sell') return;
    e.preventDefault();
    submitSell();
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) closeMarket(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isOpen()) softRefresh(); });

  // ── Realtime (js/realtime.js HANDLERS) ──────────────────────────────────

  function onMarketEvent(ev) {
    const res = RES_LABEL[ev.resource] ? RES_LABEL[ev.resource].toLowerCase() : '';
    if (ev.type === 'market_purchase') toast(`⚖️ ${ev.buyer || 'Someone'} bought ${fmt(ev.qty)} ${res} — your merchant has set off.`);
    else if (ev.type === 'market_delivery') toast(`📦 ${fmt(ev.qty)} ${res} arrived from the market.`);
    else if (ev.type === 'market_return') toast(`🪙 Your merchant is home with ${fmt(ev.gold)} gold.`);
    else if (ev.type === 'market_order_expired') toast(`⌛ A sell order expired — ${fmt(ev.qty)} ${res} returned to your stores.`);
    if (['market_delivery', 'market_return', 'market_order_expired'].includes(ev.type) && typeof global.refreshResources === 'function') {
      global.refreshResources();
    }
    if (isOpen()) scheduleRefresh(400);
    else if (ev.type !== 'market_trip_update') setDot(true);
  }

  global.openMarket = openMarket;
  global.closeMarket = closeMarket;
  global.MarketUI = { open: openMarket, close: closeMarket, isOpen, onEvent: onMarketEvent, refresh: softRefresh };
})(window);
