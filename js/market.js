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
  // Resource icons are the game's own images: 🪵 🪨 🪙 are newer emoji that
  // Windows 10 can't draw (they show as boxes). RES_TXT is for places that
  // can't hold an <img> (select options, toasts) — older, safe emoji only.
  const RES_SRC = { food: '/assets/foodicon.png', timber: '/assets/woodicon.png', stone: '/assets/stoneicon.png',
                    metal: '/assets/metalicon.png', wealth: '/assets/goldicon.png' };
  const resImg = (r, cls) => RES_SRC[r] ? `<img class="mk-ico${cls ? ' ' + cls : ''}" src="${RES_SRC[r]}" alt="" aria-hidden="true">` : '';
  const RES_ICON = { food: resImg('food'), timber: resImg('timber'), stone: resImg('stone'), metal: resImg('metal'), wealth: resImg('wealth') };
  const RES_TXT = { food: '🍎', timber: '🌲', stone: '🧱', metal: '⚙️', wealth: '💰' };
  const COIN = resImg('wealth');
  const RES_LABEL = { food: 'Food', timber: 'Timber', stone: 'Stone', metal: 'Iron', wealth: 'Gold' };
  // Ores, rare materials and alloys (js/resource-defs.js): emoji icons.
  for (const k of (window.KWResources ? KWResources.EXTRA : [])) {
    RES_ICON[k] = RES_TXT[k] = KWResources.icon(k);
    RES_LABEL[k] = KWResources.label(k);
  }
  // Resources this town can sell or ask for: the basics plus its discoveries.
  const knownTradeable = st => {
    const kn = window.KWResources ? KWResources.knownSet(st.discovered || []) : null;
    return kn ? st.tradeable.filter(r => kn[r]) : st.tradeable;
  };
  const TIER_LABEL = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  // Buy tab category buttons. Item categories match the server's
  // categoryOf(): equipment slot first, then the item category.
  const CATS = [
    ['', '✳️', 'All'], ['resources', resImg('timber', 'mk-ico-lg'), 'Resources'], ['weapon', '⚔️', 'Weapons'], ['armour', '🛡️', 'Armour'],
    ['tool', '🔨', 'Tools'], ['trinket', '💍', 'Trinkets'], ['fish', '🐟', 'Fish'], ['food', '🍖', 'Food'],
    ['material', resImg('stone', 'mk-ico-lg'), 'Materials'], ['misc', '📦', 'Misc'],   // Misc includes trophies
  ];
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
    wantResource: '',      // Wanted filter (set by "Fill in the Market"; cleared by its chip)
    sort: 'distance',
    dir: 'asc',
    seller: null,          // { id, name } — buy tab filtered to one town
    cat: '',               // buy: '' all | 'resources' | an item category
    itemKey: null,         // buy: one item picked from the search box
    itemName: '',
    ih: null,              // GET /ironhaven
    shops: null,           // GET /shops
    wants: null,           // GET /wants (other towns' buy orders)
    wantDraft: { kind: 'item', item: null, resource: 'timber', qty: '', price: '' },
    hideNpc: (() => { try { return global.localStorage.getItem('kw_mk_hide_npc') === '1'; } catch (_) { return false; } })(),
    ihPorter: null,        // porter picked on the Ironhaven tab
    focusItem: null,       // inventory id to highlight (opened from inventory)
    newRun: null,          // porter run just sent (highlighted in Caravans)
    draft: { mode: 'resource', resource: 'timber', inventory_id: null, qty_total: '', lot_size: '', lot_price: '', citizen_ids: [] },
    ledgerView: 'receipts', // ledger tab: receipts | prices
    ledgerSide: '',        // '' | sold | bought
    ledger: null,          // GET /ledger
    movers: null,          // GET /prices/movers
    priceSel: null,        // { key, name, p } — the good charted on the Prices view
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
  // "back in ~12m" for a porter run that just left.
  function backIn(run) {
    const t = run && Date.parse(run.returns_at);
    return Number.isFinite(t) ? `back in ~${dur(Math.max(0, (t - Date.now()) / 1000))}` : 'back soon';
  }
  // After a porter leaves: show them on the road in Caravans.
  async function showNewRun(run) {
    state.newRun = run && run.id;
    state.mine = null;
    await switchTab('caravans');
    const row = document.querySelector(`#market-panel [data-run="${state.newRun}"]`);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
  }

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
  const gold = n => `<span class="mk-gold">${COIN} ${fmt(n)}</span>`;
  // An order / trip's goods: resources as "🪵 100 timber", items as
  // "🐟 10× Trout" in their rarity colour.
  function goodsChip(o, n) {
    if (o.kind === 'item' && o.item) {
      return `<span class="mk-res mk-item-chip" style="color:${rarityColor(o.item.rarity)}">${esc(o.item.icon || '📦')} ${fmt(n)}× ${esc(o.item.name)}</span>`;
    }
    return resChip(o.resource, n);
  }
  function goodsName(o, n) {
    if (o.kind === 'item' && o.item) return `${fmt(n)}× ${o.item.name}`;
    return `${fmt(n)} ${(RES_LABEL[o.resource] || o.resource || 'goods').toLowerCase()}`;
  }
  function statsLine(it) {
    if (!it) return '';
    const bits = Object.entries(it.stat_bonuses || {}).filter(([, v]) => v).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`);
    if (it.metadata && it.metadata.armor_class) bits.push(`AC ${it.metadata.armor_class}`);
    if (it.metadata && it.metadata.damage_dice) bits.push(`${it.metadata.damage_dice} dmg`);
    const tag = it.equip_slot ? it.equip_slot : (it.category || '').replace('_', ' ');
    const mark = global.KWCrafting ? global.KWCrafting.markHtml(it.metadata) : '';   // crafted: quality + maker
    return `<div class="mk-order-meta mk-item-meta">${esc(tag)}${it.rarity ? ' · ' + esc(it.rarity) : ''}${bits.length ? ' · ' + esc(bits.join(', ')) : ''}</div>${mark}`;
  }

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
        <div class="mk-pop" id="mk-pop" role="tooltip"></div>
        <div class="mk-sheet-wrap" id="mk-sheet-wrap"></div>
      </div>`;
    // No backdrop-click close: a stray click mid-order would lose the form.
    // Only ✕ (and Escape, outside form fields) closes the panel.
    el.querySelector('.mk-close').addEventListener('click', closeMarket);
    el.addEventListener('click', onAction);
    el.addEventListener('mousemove', onChartHover);
    el.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('mk-help')) state.ledgerHelp = e.target.open; }, true);
    el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') onChartHover(e); });   // tap = hover on touch
    el.addEventListener('mouseleave', () => { const tt = byId('mk-tip'); if (tt) tt.style.display = 'none'; });
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', e => {
      if (e.target.dataset && (e.target.dataset.act === 'search' || e.target.dataset.act === 'want-search')) onSearchKey(e);
    });
    // Clicking anywhere outside the search box closes its suggestions.
    el.addEventListener('mousedown', e => {
      if (suggest.length && !(e.target.closest && e.target.closest('.mk-search, .mk-want-search'))) { suggest = []; suggestAt = -1; renderSuggest(); }
    });
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
    if (opts.tab === 'shops') state.shops = null;
    state.focusItem = opts.item || null;
    if (opts.tab === 'sell' && opts.item) Object.assign(state.draft, { mode: 'item', inventory_id: opts.item, qty_total: '', lot_size: '' });
    // "Find on Market" (recipe book): the Buy tab filtered to one resource or item.
    if (opts.find && opts.find.resource) Object.assign(state, { tab: 'buy', cat: 'resources', resource: opts.find.resource, itemKey: null, itemName: '' });
    if (opts.find && opts.find.itemKey) Object.assign(state, { tab: 'buy', cat: '', itemKey: opts.find.itemKey, itemName: opts.find.itemName || opts.find.itemKey });
    // "Fill in the Market" (a village request): the Wanted tab filtered to what it wants.
    if (opts.wanted && opts.wanted.resource) Object.assign(state, { tab: 'wanted', cat: 'resources', wantResource: opts.wanted.resource, itemKey: null, itemName: '' });
    if (opts.wanted && opts.wanted.itemKey) Object.assign(state, { tab: 'wanted', cat: '', itemKey: opts.wanted.itemKey, itemName: opts.wanted.itemName || opts.wanted.itemKey });
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
      if (state.status.unlocked || state.tab === 'ironhaven' || state.tab === 'shops') await loadTab();
    } catch (e) {
      renderError(e.message);
      return;
    }
    render();
  }

  async function loadTab() {
    if (state.tab === 'buy') {
      const qs = new URLSearchParams({ sort: state.sort, dir: state.dir });
      if (state.itemKey) qs.set('item_key', state.itemKey);
      else if (state.cat === 'resources') qs.set('resource', state.resource || 'resources');
      else if (state.cat) qs.set('category', state.cat);
      if (state.seller) qs.set('seller', state.seller.id);
      if (state.hideNpc) qs.set('npc', '0');
      state.orders = (await call('GET', '/api/market/orders?' + qs.toString())).orders || [];
    } else if (state.tab === 'wanted') {
      const qs = new URLSearchParams();
      if (state.itemKey) qs.set('item_key', state.itemKey);
      else if (state.cat === 'resources') qs.set('resource', state.wantResource || 'resources');
      else if (state.cat) qs.set('category', state.cat);
      if (state.hideNpc) qs.set('npc', '0');
      const [wants, mine] = await Promise.all([call('GET', '/api/market/wants?' + qs.toString()), call('GET', '/api/market/mine')]);
      state.wants = wants.wants || []; state.mine = mine;
    } else if (state.tab === 'shops') {
      const [shops, mine] = await Promise.all([call('GET', '/api/market/shops'), call('GET', '/api/market/mine')]);
      state.shops = shops; state.mine = mine;
    } else if (state.tab === 'ledger') {
      await loadLedger();
    } else if (state.tab === 'ironhaven') {
      const ih = await call('GET', '/api/market/ironhaven');
      if (ih.now) state.clockSkew = new Date(ih.now).getTime() - Date.now();
      state.ih = ih;
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
    // Never re-render under a field the player is typing in.
    const a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && byId('mk-body')?.contains(a)) return;
    try {
      state.status = await call('GET', '/api/market/status');
      if (state.status.unlocked || state.tab === 'ironhaven' || state.tab === 'shops') await loadTab();
      render();
    } catch (_) { /* next event or tick retries */ }
  }
  function scheduleRefresh(ms) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(softRefresh, ms);
  }

  // ── Prices & the Ledger (GET /api/market/prices, /prices/movers, /ledger) ─
  //
  // Price history comes from player-to-player deals only (lib/market_ledger).
  // Anything that shows a price leaves a placeholder [data-pk="<good key>"];
  // fillPrices() fetches the goods it needs (cached a minute) and fills them:
  //   data-pv="badge"  sparkline + 7-day average, range and count
  //   data-pv="delta"  this listing's price vs the 7-day average (data-unit)
  // Charts are inline SVG drawn at the container's width; hovering any
  // [data-tip] shows #mk-tip. Colours are validated against the panel
  // surface (#17120c): price #bf8a2c, money in #2f9e86, money out #d0703c.

  const CH = { price: '#bf8a2c', inn: '#2f9e86', out: '#d0703c', grid: 'rgba(242,230,201,.12)', axis: 'rgba(242,230,201,.55)', ref: 'rgba(242,230,201,.45)', surface: '#17120c' };
  const QUALITIES = ['basic', 'sturdy', 'fine', 'superior', 'legendary'];
  const QLABEL = { basic: 'Basic', sturdy: 'Sturdy', fine: 'Fine', superior: 'Superior', legendary: 'Legendary' };
  const PRICE_TTL = 60000;
  const priceCache = {};   // key → { at, p }

  // Crafted quality of an item (as the server prices it), else 'basic'.
  function qualityOfItem(it) {
    const m = (it && it.metadata) || {};
    return m.crafted_by && QUALITIES.includes(m.quality) ? m.quality : 'basic';
  }
  function goodKeyOf(kind, resource, item) {
    if (kind === 'item' && item && item.item_key) return `item:${item.item_key}:${qualityOfItem(item)}`;
    return resource ? `resource:${resource}` : null;
  }
  function goodLabel(key, name) {
    const [type, id, q] = String(key).split(':');
    if (type === 'resource') return RES_LABEL[id] || id;
    return (q && q !== 'basic' ? QLABEL[q] + ' ' : '') + (name || id.replace(/_/g, ' '));
  }

  async function loadPrices(keys, days) {
    const want = [...new Set(keys.filter(Boolean))].filter(k => !priceCache[k] || Date.now() - priceCache[k].at > PRICE_TTL || (days && priceCache[k].days < days));
    for (let i = 0; i < want.length; i += 12) {
      const chunk = want.slice(i, i + 12);
      const r = await call('GET', `/api/market/prices?goods=${encodeURIComponent(chunk.join(','))}&days=${days || 14}`);
      for (const [k, p] of Object.entries(r.prices || {})) priceCache[k] = { at: Date.now(), p, days: days || 14 };
    }
    return Object.fromEntries(keys.filter(k => priceCache[k]).map(k => [k, priceCache[k].p]));
  }

  // Daily averages over the last `n` UTC days, null where nothing traded.
  function dailySeries(p, n) {
    const by = Object.fromEntries((p.days || []).map(d => [d.day, d]));
    const out = [];
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const day = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      out.push({ day, ...(by[day] || { avg: null, qty: 0, n: 0 }) });
    }
    return out;
  }

  // A tiny trend line (no axes): the 14 daily averages, a dot at the end.
  function sparkSvg(series, w = 64, h = 18) {
    const pts = series.map((d, i) => (d.avg == null ? null : [i, d.avg])).filter(Boolean);
    if (!pts.length) return '';
    const vals = pts.map(p => p[1]), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const x = i => 2 + (i / Math.max(1, series.length - 1)) * (w - 6), y = v => h - 3 - ((v - lo) / span) * (h - 6);
    const path = pts.length > 1 ? `<polyline points="${pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${CH.price}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
    const [li, lv] = pts[pts.length - 1];
    return `<svg class="mk-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${path}<circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="3" fill="${CH.price}" stroke="${CH.surface}" stroke-width="1.5"/></svg>`;
  }

  // per: show prices per this many units (100 for resources on the Wanted form).
  function badgeHtml(p, per) {
    per = per || 1;
    const each = per === 1 ? 'each' : `per ${per}`;
    const fx = v => (per === 1 && v < 10 ? price2(v) : fmt(Math.round(v * per)));
    if (p.week && p.week.n) {
      const range = p.week.n > 1 && p.week.low !== p.week.high ? ` · range ${fx(p.week.low)}–${fx(p.week.high)}` : '';
      return `${sparkSvg(dailySeries(p, 14))}<span>7-day avg <b>${fx(p.week.avg)}</b> ${each} · ${p.week.n} trade${p.week.n === 1 ? '' : 's'}${range}</span>`;
    }
    if (p.last) return `<span>Last traded at <b>${fx(p.last.price)}</b> ${each} (${new Date(p.last.at).toLocaleDateString()})</span>`;
    if (p.reference) return `<span>No recent trades · ${esc(p.reference.label.toLowerCase())} ${fx(p.reference.price)} ${each}</span>`;
    return '<span>No trades yet</span>';
  }
  function deltaHtml(p, unit) {
    if (!p.week || p.week.n < 2 || !p.week.avg || !unit) return '';
    const d = unit / p.week.avg - 1;
    if (Math.abs(d) < 0.03) return '<span class="mk-pd">≈ 7-day average</span>';
    return `<span class="mk-pd ${d < 0 ? 'below' : 'above'}" title="7-day average ${price2(p.week.avg)}">${d < 0 ? '▼' : '▲'} ${Math.round(Math.abs(d) * 100)}% ${d < 0 ? 'below' : 'above'} avg</span>`;
  }

  async function fillPrices(root) {
    root = root || byId('mk-body');
    if (!root) return;
    const els = [...root.querySelectorAll('[data-pk]')];
    if (!els.length) return;
    let prices;
    try { prices = await loadPrices(els.map(e => e.dataset.pk)); } catch (_) { return; }
    for (const el of els) {
      const p = prices[el.dataset.pk];
      if (!p || !el.isConnected) continue;
      el.innerHTML = el.dataset.pv === 'delta' ? deltaHtml(p, Number(el.dataset.unit)) : badgeHtml(p, Number(el.dataset.per) || 1);
    }
  }

  // Shared hover tooltip for chart marks ([data-tip], plain text with \n).
  function tipEl() {
    let t = byId('mk-tip');
    if (!t) { t = document.createElement('div'); t.id = 'mk-tip'; t.className = 'mk-tip'; t.setAttribute('role', 'tooltip'); document.body.appendChild(t); }
    return t;
  }
  function onChartHover(e) {
    const m = e.target.closest && e.target.closest('[data-tip]');
    const t = tipEl();
    document.querySelectorAll('#market-panel .mk-hl').forEach(x => x.classList.remove('mk-hl'));
    if (!m) { t.style.display = 'none'; return; }
    t.textContent = m.dataset.tip;
    t.style.display = 'block';
    const r = t.getBoundingClientRect();
    t.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 12) + 'px';
    t.style.top = Math.max(8, e.clientY - r.height - 10) + 'px';
    const g = m.dataset.hl && document.querySelectorAll(`#market-panel [data-hl-id="${m.dataset.hl}"]`);
    if (g) g.forEach(x => x.classList.add('mk-hl'));
  }

  const niceMax = v => {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
    return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(x => x >= f - 1e-9) * p;
  };
  const tickFmt = v => (v >= 1000 ? (Math.round(v / 100) / 10) + 'K' : v < 10 && Math.abs(v % 1) > 1e-9 ? price2(v) : fmt(v));
  const shortDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // Price over time (line) above volume (columns): two charts, one x axis.
  function priceChartSvg(p, w, days) {
    const series = dailySeries(p, days);
    const pad = { l: 40, r: 12, t: 12, b: 4 }, ph = 150, vh = 56, gap = 30, xh = 18;
    const H = pad.t + ph + gap + vh + xh;
    const iw = w - pad.l - pad.r, step = iw / series.length;
    const xc = i => pad.l + step * (i + 0.5);
    const vals = series.filter(d => d.avg != null).map(d => d.avg).concat(p.reference ? [p.reference.price] : []);
    const ymax = niceMax(Math.max(...vals, 0.01) * 1.08);
    const y = v => pad.t + ph - (v / ymax) * ph;
    const vmax = niceMax(Math.max(1, ...series.map(d => d.qty)));
    const vy0 = pad.t + ph + gap + vh, vy = q => vy0 - (q / vmax) * vh;
    let s = '';
    // grid + y ticks (price)
    for (const f of [0, 0.5, 1]) {
      const v = ymax * f, yy = y(v);
      s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${yy}" y2="${yy}" stroke="${CH.grid}" stroke-width="1"/><text x="${pad.l - 6}" y="${yy + 4}" text-anchor="end" class="mk-ax">${tickFmt(v)}</text>`;
    }
    // reference line
    if (p.reference) {
      const yy = y(p.reference.price);
      s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${yy}" y2="${yy}" stroke="${CH.ref}" stroke-width="1.5" stroke-dasharray="5 4"/>
        <text x="${pad.l + 4}" y="${yy - 5}" class="mk-ax">${esc(p.reference.label)} ${tickFmt(p.reference.price)}</text>`;
    }
    // price line, broken over days with no trades
    let run = [];
    const flush = () => { if (run.length > 1) s += `<polyline points="${run.join(' ')}" fill="none" stroke="${CH.price}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`; run = []; };
    series.forEach((d, i) => { if (d.avg == null) flush(); else run.push(`${xc(i).toFixed(1)},${y(d.avg).toFixed(1)}`); });
    flush();
    series.forEach((d, i) => { if (d.avg != null) s += `<circle data-hl-id="d${i}" class="mk-dot" cx="${xc(i).toFixed(1)}" cy="${y(d.avg).toFixed(1)}" r="4" fill="${CH.price}" stroke="${CH.surface}" stroke-width="2"/>`; });
    // last value, labelled at the end
    const lastI = series.map(d => d.avg != null).lastIndexOf(true);
    if (lastI >= 0) s += `<text x="${Math.min(w - pad.r, xc(lastI) + 6)}" y="${y(series[lastI].avg) - 8}" text-anchor="${lastI > series.length - 4 ? 'end' : 'start'}" class="mk-lbl">${tickFmt(series[lastI].avg)}</text>`;
    // volume columns
    s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${vy0}" y2="${vy0}" stroke="${CH.grid}" stroke-width="1"/><text x="${pad.l - 6}" y="${vy(vmax) + 4}" text-anchor="end" class="mk-ax">${tickFmt(vmax)}</text>
      <text x="${pad.l + 4}" y="${pad.t + ph + gap - 2}" class="mk-ax">Units traded per day</text>`;
    const bw = Math.max(2, Math.min(24, step - 2));
    series.forEach((d, i) => {
      if (!d.qty) return;
      const top = vy(d.qty), x0 = xc(i) - bw / 2, hgt = vy0 - top, r = Math.min(4, bw / 2, hgt);
      s += `<path data-hl-id="d${i}" class="mk-bar" d="M${x0},${vy0} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${vy0} Z" fill="${CH.price}" opacity=".7"/>`;
    });
    // x labels: first, middle, last
    for (const i of [0, Math.floor(series.length / 2), series.length - 1]) {
      s += `<text x="${xc(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}" class="mk-ax">${shortDay(series[i].day)}</text>`;
    }
    // hover columns (full height, wider than the marks)
    series.forEach((d, i) => {
      const tip = `${shortDay(d.day)}\n${d.avg != null ? `Average ${price2(d.avg)} each\n${fmt(d.qty)} units · ${d.n} trade${d.n === 1 ? '' : 's'}` : 'No trades'}`;
      s += `<rect data-tip="${esc(tip)}" data-hl="d${i}" x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${vy0 - pad.t}" fill="transparent"/>`;
    });
    return `<svg class="mk-chart" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="Price per day for the last ${days} days">${s}</svg>`;
  }

  // Net gold per week: columns up (earned) or down (spent) from zero.
  function netChartSvg(weeks, w) {
    const pad = { l: 44, r: 8, t: 10, b: 20 }, h = 130;
    const H = pad.t + h + pad.b, iw = w - pad.l - pad.r, step = iw / weeks.length;
    const m = niceMax(Math.max(1, ...weeks.map(x => Math.abs(x.net))));
    const anyNeg = weeks.some(x => x.net < 0);
    const lo = anyNeg ? -m : 0, span = m - lo;
    const y = v => pad.t + ((m - v) / span) * h, y0 = y(0);
    let s = '';
    for (const v of anyNeg ? [m, 0, -m] : [m, m / 2, 0]) {
      s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${CH.grid}" stroke-width="1"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="mk-ax">${v < 0 ? '−' : ''}${tickFmt(Math.abs(v))}</text>`;
    }
    const bw = Math.max(4, Math.min(24, step - 6));
    weeks.forEach((wk, i) => {
      const xc = pad.l + step * (i + 0.5), x0 = xc - bw / 2;
      if (wk.net) {
        const up = wk.net > 0, top = y(wk.net), r = Math.min(4, bw / 2, Math.abs(top - y0));
        const d = up
          ? `M${x0},${y0} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${y0} Z`
          : `M${x0},${y0} V${top - r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top - r} V${y0} Z`;
        s += `<path data-hl-id="w${i}" class="mk-bar" d="${d}" fill="${up ? CH.inn : CH.out}"/>`;
      }
      const label = i === weeks.length - 1 ? 'This week' : shortDay(wk.week_start);
      if (i === weeks.length - 1 || i === 0 || weeks.length <= 6) s += `<text x="${xc}" y="${H - 5}" text-anchor="middle" class="mk-ax">${label}</text>`;
      const tip = `${i === weeks.length - 1 ? 'This week' : 'Week of ' + shortDay(wk.week_start)}\nEarned ${fmt(wk.in)} · spent ${fmt(wk.out)}\nFees ${fmt(wk.fees)} · net ${wk.net < 0 ? '−' : '+'}${fmt(Math.abs(wk.net))}\n${wk.n} deal${wk.n === 1 ? '' : 's'}`;
      s += `<rect data-tip="${esc(tip)}" data-hl="w${i}" x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${h}" fill="transparent"/>`;
    });
    return `<svg class="mk-chart" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="Net gold per week, last ${weeks.length} weeks">${s}</svg>`;
  }

  // Charts are drawn after the HTML is in place, at their container's width.
  function drawCharts() {
    const net = byId('mk-net-chart');
    if (net && state.ledger) net.innerHTML = netChartSvg(state.ledger.weeks, Math.max(260, net.clientWidth || 560));
    const pc = byId('mk-price-chart');
    if (pc && state.priceSel && state.priceSel.p) pc.innerHTML = priceChartSvg(state.priceSel.p, Math.max(260, pc.clientWidth || 560), 30);
  }

  async function loadLedger() {
    if (state.ledgerView === 'prices') {
      const mv = await call('GET', '/api/market/prices/movers');
      state.movers = mv.goods || [];
      if (!state.priceSel && state.movers.length) state.priceSel = { key: state.movers[0].key, name: state.movers[0].name };
      if (state.priceSel) {
        const r = await call('GET', `/api/market/prices?goods=${encodeURIComponent(state.priceSel.key)}&days=30`);
        state.priceSel.p = r.prices[state.priceSel.key];
      }
    } else {
      const qs = new URLSearchParams();
      if (state.ledgerSide) qs.set('side', state.ledgerSide);
      state.ledger = await call('GET', '/api/market/ledger?' + qs.toString());
    }
  }

  const KIND_LABEL = { lot: 'Caravan lot', pickup: 'Stall pickup', fill: 'Wanted order', ironhaven: 'Ironhaven', npc: 'Village trade' };
  function entryHtml(e) {
    const what = e.item
      ? `<b style="color:${rarityColor(e.item.rarity)}">${fmt(e.qty)}× ${esc(e.item.name)}</b>`
      : `<b>${fmt(e.qty)} ${esc((RES_LABEL[e.resource] || e.resource || '').toLowerCase())}</b>`;
    const icon = e.item ? esc(e.item.icon || '📦') : (RES_ICON[e.resource] || '•');
    const verb = e.side === 'sold' ? (e.kind === 'ironhaven' ? 'Sold to' : 'Sold to') : 'Bought from';
    const status = e.status === 'settled' ? '<span class="mk-st ok">✓ settled</span>'
      : e.status === 'returned' ? '<span class="mk-st ret">↩ stall sold out — gold returned</span>'
      : `<span class="mk-st road">⏳ ${e.side === 'sold' ? 'gold on the road' : 'goods on the road'}</span>`;
    const money = e.status === 'returned' ? '<span class="mk-muted">0</span>'
      : `<span class="mk-net ${e.net >= 0 ? 'in' : 'out'}">${e.net >= 0 ? '+' : '−'}${fmt(Math.abs(e.net))}</span>`;
    const mark = e.item && global.KWCrafting ? global.KWCrafting.markHtml(e.item.metadata) : '';
    return `<li class="mk-led-row">
      <div class="mk-led-icon">${icon}</div>
      <div class="mk-led-main">
        <div>${what} <span class="mk-muted">at ${price2(e.unit_price)} each</span></div>
        ${mark}
        <div class="mk-order-meta">${verb} <b>${esc(e.counterparty || '—')}</b> · ${esc(KIND_LABEL[e.kind] || e.kind)}${e.citizen_name ? ` · ${esc(e.citizen_name)}` : ''} · ${new Date(e.agreed_at).toLocaleDateString()}</div>
        <div class="mk-order-meta">${status}${e.fee ? ` · fee ${fmt(e.fee)} of ${fmt(e.gross)}` : ''}</div>
      </div>
      <div class="mk-led-gold">${money}</div>
    </li>`;
  }

  function ledgerHtml() {
    const views = `<div class="mk-seg" role="tablist" aria-label="Ledger view">
      <button type="button" role="tab" aria-selected="${state.ledgerView !== 'prices'}" class="${state.ledgerView !== 'prices' ? 'on' : ''}" data-act="ledger-view" data-view="receipts">🧾 Receipts</button>
      <button type="button" role="tab" aria-selected="${state.ledgerView === 'prices'}" class="${state.ledgerView === 'prices' ? 'on' : ''}" data-act="ledger-view" data-view="prices">📈 Prices</button></div>`;
    return views + ledgerHelpHtml() + (state.ledgerView === 'prices' ? pricesViewHtml() : receiptsHtml());
  }

  // "How this works": open by itself the first time a player visits.
  // Decided on the first Ledger render this session, then follows the player's
  // own folding (state.ledgerHelp), so refreshes don't fold or unfold it.
  function ledgerHelpHtml() {
    if (state.ledgerHelp == null) {
      try { state.ledgerHelp = !global.localStorage.getItem('kw_mk_ledger_help'); if (state.ledgerHelp) global.localStorage.setItem('kw_mk_ledger_help', '1'); }
      catch (_) { state.ledgerHelp = false; }
    }
    return `<details class="mk-help"${state.ledgerHelp ? ' open' : ''}><summary>ⓘ How the Ledger works</summary><ul>
      <li><b>Receipts</b> list every deal your town makes: caravan lots, stall pickups, Wanted orders, Ironhaven and the villages. A deal shows when its price is agreed; it is <i>settled</i> once your gold or goods are home.</li>
      <li><b>Prices</b> come only from trades between players. Ironhaven and village prices are set by the game, so they appear as a dashed reference line instead.</li>
      <li>Each price is averaged by quantity, so a big lot counts more than a small one. Crafted items are priced separately for each quality.</li>
      <li>The Sell form's <b>guide price</b> follows the 7-day average once a good has 3 or more trades, and the reference price before that.</li>
    </ul></details>`;
  }

  function receiptsHtml() {
    const L = state.ledger;
    if (!L) return '<div class="mk-empty">Unrolling the ledgers…</div>';
    const wk = L.weeks[L.weeks.length - 1] || { in: 0, out: 0, fees: 0, net: 0, n: 0, pending: 0 };
    const tile = (label, val, cls) => `<div class="mk-tile"><div class="mk-tile-l">${label}</div><div class="mk-tile-v ${cls || ''}">${val}</div></div>`;
    const sides = [['', 'All'], ['sold', 'Sales'], ['bought', 'Purchases']].map(([k, l]) =>
      `<button type="button" class="mk-chipbtn ${(state.ledgerSide || '') === k ? 'on' : ''}" data-act="ledger-side" data-side="${k}">${l}</button>`).join('');
    const anyWeeks = L.weeks.some(x => x.n);
    return `
      <div class="mk-h">This week</div>
      <div class="mk-tiles">
        ${tile('Earned', fmt(wk.in))}${tile('Spent', fmt(wk.out))}${tile('Fees paid', fmt(wk.fees))}
        ${tile('Net', `${wk.net < 0 ? '−' : '+'}${fmt(Math.abs(wk.net))}`)}${tile('Deals', fmt(wk.n))}
      </div>
      ${wk.pending ? `<div class="mk-muted mk-small">⏳ ${fmt(wk.pending)} gold of this is still on the road home.</div>` : ''}
      ${anyWeeks ? `<div class="mk-h">Net gold, last ${L.weeks.length} weeks <span class="mk-key"><i style="background:${CH.inn}"></i>earned <i style="background:${CH.out}"></i>spent</span></div>
        <div class="mk-chart-box" id="mk-net-chart"></div>
        <details class="mk-table-view"><summary>Show as a table</summary><table><thead><tr><th>Week of</th><th>Earned</th><th>Spent</th><th>Fees</th><th>Net</th><th>Deals</th></tr></thead><tbody>
          ${L.weeks.slice().reverse().map(x => `<tr><td>${shortDay(x.week_start)}</td><td>${fmt(x.in)}</td><td>${fmt(x.out)}</td><td>${fmt(x.fees)}</td><td>${x.net < 0 ? '−' : ''}${fmt(Math.abs(x.net))}</td><td>${x.n}</td></tr>`).join('')}
        </tbody></table></details>` : ''}
      <div class="mk-h">Receipts <span class="mk-chips">${sides}</span></div>
      <ul class="mk-list">${L.entries.length ? L.entries.map(entryHtml).join('') : '<li class="mk-empty">No deals yet. Buy, sell or fill a Wanted order and it shows up here.</li>'}</ul>
      ${L.next_before ? `<button type="button" class="mk-btn mk-more" data-act="ledger-more">Load older</button>` : ''}`;
  }

  function pricesViewHtml() {
    const mv = state.movers;
    if (!mv) return '<div class="mk-empty">Reading the price boards…</div>';
    if (!mv.length) return '<div class="mk-empty">No trades between towns this week yet. Prices appear here as players buy and sell.</div>';
    const sel = state.priceSel;
    const [type, id, q] = sel ? sel.key.split(':') : [];
    const qsw = type === 'item' ? `<div class="mk-chips" role="group" aria-label="Quality">${QUALITIES.map(x =>
      `<button type="button" class="mk-chipbtn ${x === q ? 'on' : ''}" data-act="price-q" data-q="${x}">${QLABEL[x]}</button>`).join('')}</div>` : '';
    const p = sel && sel.p;
    const days = p ? dailySeries(p, 30).filter(d => d.n) : [];
    const head = sel ? `<div class="mk-price-head"><div class="mk-price-title">${type === 'resource' ? RES_ICON[id] || '' : esc((mv.find(m => m.key === sel.key) || {}).icon || '')} ${esc(goodLabel(sel.key, sel.name))}</div>
        ${p ? `<div class="mk-muted mk-small">${p.week.n ? `7-day avg <b>${price2(p.week.avg)}</b> each · ${p.week.n} trades · ${fmt(p.week.qty)} units` : 'No trades in the last 7 days'}${p.guide_source === 'reference' && p.reference ? ` · ${esc(p.reference.label.toLowerCase())} ${price2(p.reference.price)}` : ''}</div>` : ''}</div>${qsw}` : '';
    const chart = p ? (days.length
      ? `<div class="mk-chart-box" id="mk-price-chart"></div>
         <details class="mk-table-view"><summary>Show as a table</summary><table><thead><tr><th>Day</th><th>Average</th><th>Units</th><th>Trades</th></tr></thead><tbody>
           ${days.slice().reverse().map(d => `<tr><td>${shortDay(d.day)}</td><td>${price2(d.avg)}</td><td>${fmt(d.qty)}</td><td>${d.n}</td></tr>`).join('')}</tbody></table></details>`
      : '<div class="mk-empty">No trades at this quality in the last 30 days.</div>') : '';
    const rows = mv.map(m => {
      const ch = m.change == null ? '<span class="mk-muted">new</span>'
        : Math.abs(m.change) < 0.03 ? '<span class="mk-muted">steady</span>'
        : `<span class="mk-pd ${m.change < 0 ? 'below' : 'above'}">${m.change < 0 ? '▼' : '▲'} ${Math.round(Math.abs(m.change) * 100)}%</span>`;
      const icon = m.type === 'resource' ? RES_ICON[m.id] || '' : esc(m.icon || '📦');
      return `<li><button type="button" class="mk-mover ${sel && sel.key === m.key ? 'on' : ''}" data-act="price-pick" data-key="${esc(m.key)}" data-name="${esc(m.name || '')}">
        <span class="mk-mover-n">${icon} ${esc(goodLabel(m.key, m.name))}</span>
        <span class="mk-mover-p">${price2(m.avg)}</span><span class="mk-mover-c">${ch}</span>
        <span class="mk-mover-v mk-muted">${fmt(m.qty)} units · ${m.n}</span></button></li>`;
    }).join('');
    return `${head}${chart}
      <div class="mk-h">Traded this week <span class="mk-muted mk-small">average price each · change vs the week before · volume</span></div>
      <ul class="mk-movers">${rows}</ul>`;
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
    const tabsHtml = tabs => tabs.map(([k, label]) =>
      `<button type="button" class="mk-tab ${state.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${label}</button>`).join('');
    if (!st.unlocked) {
      // Ironhaven needs no Market: anyone can send a porter.
      byId('mk-title').textContent = 'Market';
      sub.textContent = 'Trade goods with settlements you know';
      byId('mk-tabs').innerHTML = tabsHtml([['buy', '⚖️ Market'], ['shops', '🏪 Shops'], ['ironhaven', '🏰 Ironhaven']]);
      byId('mk-body').innerHTML = state.tab === 'ironhaven' ? ironhavenHtml() : state.tab === 'shops' ? shopsHtml() : lockedHtml(st);
      tickCountdowns();
      return;
    }
    byId('mk-title').textContent = `Market · Level ${st.mods.marketLevel}`;
    sub.innerHTML = `${st.mods.merchants} merchant${st.mods.merchants === 1 ? '' : 's'} · carries ${fmt(st.mods.carryWeight)} per trip · ${Math.round(st.mods.feeRate * 100)}% fee
      <button type="button" class="mk-info" data-act="info" aria-label="How your Market grows" aria-describedby="mk-pop">ⓘ</button>`;
    byId('mk-pop').innerHTML = `<div class="mk-pop-title">Your Market · Level ${st.mods.marketLevel}</div>${levelTableHtml(st, st.mods.marketLevel)}`;
    byId('mk-tabs').innerHTML = tabsHtml([['buy', '🛒 Buy'], ['sell', '📦 Sell'], ['wanted', '📮 Wanted'], ['caravans', '🐾 Caravans'], ['shops', '🏪 Shops'], ['ironhaven', '🏰 Ironhaven'], ['ledger', '📒 Ledger']]);
    const body = byId('mk-body');
    body.innerHTML = state.tab === 'buy' ? buyHtml() : state.tab === 'sell' ? sellHtml()
      : state.tab === 'ironhaven' ? ironhavenHtml() : state.tab === 'shops' ? shopsHtml()
      : state.tab === 'wanted' ? wantedHtml() : state.tab === 'ledger' ? ledgerHtml() : caravansHtml();
    if (state.tab === 'wanted') updateWantSummary();
    if (state.tab === 'sell') updateSellSummary();
    focusRow();
    tickCountdowns();
    drawCharts();
    fillPrices();
    const onTab = document.querySelector('#mk-tabs .mk-tab.on');
    if (onTab && onTab.scrollIntoView) onTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
      <div class="mk-muted mk-small">Carry weight: food ½ · timber 1 · stone 1 · iron 2 per unit.</div>`;
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
    const resOpts = ['<option value="">All resources</option>']
      .concat(st.tradeable.map(r => `<option value="${r}" ${state.resource === r ? 'selected' : ''}>${RES_TXT[r]} ${RES_LABEL[r]}</option>`)).join('');
    const cats = CATS.map(([k, icon, label]) =>
      `<button type="button" class="mk-cat ${!state.itemKey && state.cat === k ? 'on' : ''}" data-act="cat" data-cat="${k}" title="${label}">
        <span class="mk-cat-icon">${icon}</span><span class="mk-cat-label">${label}</span></button>`).join('');
    const itemChip = state.itemKey
      ? `<div class="mk-filter-chip">Showing ${esc(state.itemName)} <button type="button" data-act="clear-item" aria-label="Show all items">✕</button></div>` : '';
    const sortOpts = SORTS.map(([k, l]) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${l}</option>`).join('');
    const sellerChip = state.seller
      ? `<div class="mk-filter-chip">Only ${esc(state.seller.name)} <button type="button" data-act="clear-seller" aria-label="Show all towns">✕</button></div>`
      : '';
    const wealth = liveResources().wealth ?? st.resources.wealth;
    const list = (state.orders || []);
    const rows = list.length ? list.map(o => {
      if (o.npc) return npcRowHtml(o, 'sell');
      if (o.kind === 'item') return stallRowHtml(o, wealth);
      const afford = wealth >= o.next_lot_price;
      const btn = o.paused
        ? `<button type="button" class="mk-btn" disabled>On the road</button>`
        : `<button type="button" class="mk-btn mk-btn-primary" data-act="buy" data-id="${o.id}" ${afford ? '' : 'disabled title="Not enough gold"'}>Buy lot</button>`;
      const eta = o.paused
        ? `<span class="mk-paused">⏸ Paused — merchant back in <span data-until="${esc(o.next_free_at)}">…</span></span>`
        : `<span>Arrives in ~${dur(o.eta_seconds)}</span>`;
      return `<li class="mk-order ${o.paused ? 'paused' : ''}">
        <div class="mk-order-main">
          <div class="mk-order-line">${goodsChip(o, o.next_lot_qty)} <span class="mk-for">for</span> ${gold(o.next_lot_price)}</div>
          ${o.kind === 'item' ? statsLine(o.item) : ''}
          <div class="mk-order-meta">
            <span>${price2(o.unit_price)} gold / unit</span> <span data-pk="${esc(goodKeyOf(o.kind, o.resource, o.item) || '')}" data-pv="delta" data-unit="${o.unit_price}"></span> ·
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
      <div class="mk-search">
        <input type="search" id="mk-search" class="mk-search-input" placeholder="🔍 Search items — type 3 letters, e.g. “iro”"
          value="${esc(state.itemName)}" autocomplete="off" spellcheck="false" data-act="search"
          role="combobox" aria-expanded="false" aria-controls="mk-suggest" aria-autocomplete="list">
        <ul class="mk-suggest" id="mk-suggest" role="listbox"></ul>
      </div>
      <div class="mk-cats" role="toolbar" aria-label="Categories">${cats}</div>
      <label class="mk-npc-toggle"><input type="checkbox" data-act="hide-npc" ${state.hideNpc ? 'checked' : ''}> Hide NPC traders</label>
      ${itemChip}
      <div class="mk-toolbar">
        ${state.cat === 'resources' && !state.itemKey ? `<select data-act="filter-resource" aria-label="Which resource">${resOpts}</select>` : ''}
        <select data-act="sort" aria-label="Sort by">${sortOpts}</select>
        <button type="button" class="mk-btn mk-btn-sm" data-act="dir" title="Reverse order">${state.dir === 'asc' ? '↑ Low first' : '↓ High first'}</button>
      </div>
      ${sellerChip}
      <div class="mk-muted mk-small">You have ${gold(wealth)}. Resources arrive with the seller’s merchant; items are collected by a porter you send.</div>
      <ul class="mk-list">${rows}</ul>`;
  }

  // An item stall: priced per item; the buyer's own porter collects.
  function stallRowHtml(o, wealth) {
    const it = o.item || {};
    return `<li class="mk-order mk-stall">
      <div class="mk-stall-icon">${esc(it.icon || '📦')}</div>
      <div class="mk-order-main">
        <div class="mk-order-line"><b style="color:${rarityColor(it.rarity)}">${esc(it.name)}</b>
          <span class="mk-for">·</span> ${gold(o.unit_price)} <span class="mk-for">each</span>
          <span data-pk="${esc(goodKeyOf('item', null, it) || '')}" data-pv="delta" data-unit="${o.unit_price}"></span></div>
        ${statsLine(it)}
        <div class="mk-order-meta"><span>${fmt(o.qty_available)} available</span> · <span>a porter carries ${fmt(o.porter_max)}</span></div>
        <div class="mk-order-meta">
          <button type="button" class="mk-link" data-act="filter-seller" data-id="${o.seller.id}" data-name="${esc(o.seller.name)}">${esc(o.seller.name)}</button>'s ${esc(o.venue_label || 'Market')}
          <span class="mk-muted">(${esc(o.seller.username)})</span> ·
          <span>${o.distance} hex${o.distance === 1 ? '' : 'es'} away</span> · <span>round trip ~${dur(o.eta_seconds)}</span>
        </div>
      </div>
      <div class="mk-order-act"><button type="button" class="mk-btn mk-btn-primary" data-act="collect" data-id="${o.id}"
        ${wealth >= o.unit_price ? '' : 'disabled title="Not enough gold"'}>🧺 Collect…</button></div>
    </li>`;
  }

  // Sheet: how many, and which porter walks over to fetch them.
  async function openCollectSheet(o) {
    if (!state.mine) { try { state.mine = await call('GET', '/api/market/mine'); } catch (_) {} }
    const free = ((state.mine && state.mine.candidates) || []).filter(c => !c.busy);
    const it = o.item || {};
    const wealth = liveResources().wealth ?? state.status.resources.wealth;
    const max = Math.max(1, Math.min(o.porter_max, Math.floor(wealth / o.unit_price) || 1));
    sheet(`
      <h3>Collect ${esc(it.icon || '📦')} ${esc(it.name)} from ${esc(o.seller.name)}</h3>
      <div class="mk-collect">
        <label class="mk-field"><span>How many <em class="mk-muted">(up to ${fmt(max)})</em></span>
          <input type="number" id="mk-collect-qty" min="1" max="${max}" value="1" data-act="collect-qty"></label>
        <label class="mk-field"><span>Porter</span>
          ${free.length ? `<select id="mk-collect-porter">${free.map(c => `<option value="${c.id}">${esc(c.name)} · scouting ${c.scouting}</option>`).join('')}</select>`
            : '<div class="mk-warn">Nobody is free to send.</div>'}</label>
      </div>
      <div class="mk-sum">
        <div><span>Price</span><b>${gold(o.unit_price)} each</b></div>
        <div><span>You pay now</span><b id="mk-collect-total">${gold(o.unit_price)}</b></div>
        <div><span>Round trip</span><b>~${dur(o.eta_seconds)}</b></div>
      </div>
      <p class="mk-muted mk-small">Your gold is held while the porter walks there; the seller is paid when they arrive, and the items are yours when they're home. The items are set aside for you meanwhile.</p>
      <div class="mk-sheet-actions">
        <button type="button" class="mk-btn" data-act="sheet-close">Cancel</button>
        <button type="button" class="mk-btn mk-btn-primary" data-act="collect-confirm" data-id="${o.id}" ${free.length ? '' : 'disabled'}>🧺 Send porter</button>
      </div>`);
  }

  async function collect(id) {
    if (state.busy) return;
    const o = (state.orders || []).find(x => x.id === id);
    const qty = parseInt((byId('mk-collect-qty') || {}).value, 10);
    const porter = parseInt((byId('mk-collect-porter') || {}).value, 10);
    if (!o || !qty || !porter) return;
    state.busy = true;
    try {
      const r = await call('POST', `/api/market/orders/${id}/pickup`, { qty, citizen_id: porter });
      closeSheet();
      toast(`🧺 ${r.porter} is walking to ${r.seller} to collect ${fmt(r.run.qty)}× ${r.run.item.name} — ${backIn(r.run)}.`);
      if (typeof global.refreshResources === 'function') global.refreshResources();
      await showNewRun(r.run);
    } catch (e) { toast(e.message, 'error'); }
    finally { state.busy = false; }
  }

  function openBuySheet(order) {
    sheet(`
      <h3>Buy ${order.kind === 'item' && order.item ? esc(order.item.icon || '📦') : RES_ICON[order.resource]} ${esc(goodsName(order, order.next_lot_qty))}?</h3>
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
        <button type="button" class="mk-btn mk-btn-primary" data-act="buy-confirm" data-id="${order.id}">Buy for ${COIN} ${fmt(order.next_lot_price)}</button>
      </div>`);
  }

  async function buy(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      const r = await call('POST', `/api/market/orders/${id}/buy`);
      closeSheet();
      toast(`🐾 ${r.merchant} of ${r.seller} is on the way with ${goodsName(r.trip, r.trip.qty)}.`);
      if (typeof global.refreshResources === 'function') global.refreshResources();
      await softRefresh();
    } catch (e) {
      toast(e.message, 'error');
      closeSheet();
      await softRefresh();
    } finally { state.busy = false; }
  }

  // ── Sell ────────────────────────────────────────────────────────────────

  // What's being sold in the Sell form: resource or one inventory stack.
  function sellItem() {
    const d = state.draft, mine = state.mine || {};
    return d.mode === 'item' ? (mine.items || []).find(i => i.id === d.inventory_id) || null : null;
  }
  // Caps and labels for the current selection (shared by form + summary).
  function goodsSpec() {
    const st = state.status, d = state.draft;
    if (d.mode === 'item') {
      const it = sellItem();
      if (!it) return { maxLot: 0, have: 0, label: 'items', equip: false, it: null };
      return { maxLot: it.max_lot, have: it.quantity, label: it.name, equip: !!it.equip_slot, it };
    }
    return {
      maxLot: Math.floor(st.mods.carryWeight / st.unitWeight[d.resource]),
      have: liveResources()[d.resource] ?? st.resources[d.resource],
      label: RES_LABEL[d.resource].toLowerCase(), equip: false, it: null,
    };
  }

  function rarityColor(r) {
    return { common: '#a0c880', uncommon: '#70b8e0', rare: '#e8a020', epic: '#c060e0', legendary: '#ff8020' }[r] || '#b0a890';
  }

  function itemPickerHtml() {
    const d = state.draft, items = (state.mine && state.mine.items) || [];
    if (!items.length) return '<div class="mk-muted">Your inventory is empty.</div>';
    return `<div class="mk-items">${items.map(i => {
      const on = d.inventory_id === i.id;
      const why = !i.tradeable ? i.reason : '';
      return `<button type="button" class="mk-item ${on ? 'on' : ''} ${why ? 'off' : ''}" data-act="pick-item" data-id="${i.id}"
          ${why ? 'disabled' : ''} title="${esc(why || i.description || i.name)}">
        <span class="mk-item-icon">${esc(i.icon)}</span>
        <span class="mk-item-name" style="color:${rarityColor(i.rarity)}">${esc(i.name)}</span>
        <span class="mk-item-qty">×${fmt(i.quantity)}</span>
        ${why ? `<span class="mk-item-why">${esc(why)}</span>` : ''}
      </button>`;
    }).join('')}</div>`;
  }

  function sellHtml() {
    const st = state.status, d = state.draft, mods = st.mods;
    const mine = state.mine || { candidates: [] };
    const have = liveResources();
    const isItem = d.mode === 'item';
    const spec = goodsSpec();
    const resOpts = knownTradeable(st).map(r =>
      `<option value="${r}" ${d.resource === r ? 'selected' : ''}>${RES_TXT[r]} ${RES_LABEL[r]} (have ${fmt(have[r] ?? st.resources[r])})</option>`).join('');
    const maxLot = spec.maxLot;
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
    if (isItem) return sellItemHtml(st, spec);
    const lockOne = spec.equip;   // equipment: one piece per order
    const goods = isItem
      ? `<div class="mk-field"><span>Item <em class="mk-muted">(greyed items can't be traded)</em></span>${itemPickerHtml()}</div>`
      : `<label class="mk-field"><span>Goods</span><select name="resource" data-act="draft">${resOpts}</select></label>`;
    return `
      <form class="mk-form" data-form="sell">
        <div class="mk-caps">
          <span>Orders <b>${st.activeOrders} / ${mods.maxOrders}</b></span>
          <span>Merchants <b>${st.merchantsAssigned} / ${mods.merchants}</b></span>
          <span>Carry <b>${fmt(mods.carryWeight)}</b> per trip</span>
        </div>
        ${blocked}
        <div class="mk-mode" role="tablist">
          <button type="button" class="${isItem ? '' : 'on'}" data-act="sell-mode" data-mode="resource">${resImg('timber')} Resources</button>
          <button type="button" class="${isItem ? 'on' : ''}" data-act="sell-mode" data-mode="item">🎒 Items</button>
        </div>
        ${goods}
        <label class="mk-field"><span>Total to sell${isItem && spec.it ? ` <em class="mk-muted">(have ${fmt(spec.have)})</em>` : ''}</span>
          <input name="qty_total" type="number" min="1" step="1" inputmode="numeric" value="${esc(lockOne ? 1 : d.qty_total)}" placeholder="e.g. ${isItem ? 10 : 500}" data-act="draft" ${lockOne ? 'readonly' : ''}></label>
        <label class="mk-field"><span>Per delivery <em class="mk-muted">(${lockOne ? 'equipment travels one piece at a time' : 'max ' + fmt(maxLot)})</em></span>
          <input name="lot_size" type="number" min="1" max="${maxLot}" step="1" inputmode="numeric" value="${esc(lockOne ? 1 : d.lot_size)}" placeholder="${maxLot}" data-act="draft" ${lockOne ? 'readonly' : ''}></label>
        <label class="mk-field"><span>Price per delivery <em class="mk-muted">(gold)</em></span>
          <input name="lot_price" type="number" min="1" step="1" inputmode="numeric" value="${esc(d.lot_price)}" placeholder="gold" data-act="draft"></label>
        <div class="mk-summary" id="mk-sell-summary"></div>
        <div class="mk-field"><span>Merchants <em class="mk-muted">(${Math.max(0, free)} slot${free === 1 ? '' : 's'} free — more merchants means fewer pauses)</em></span>
          <div class="mk-cands">${cands}</div></div>
        <p class="mk-muted mk-small">Goods leave your ${isItem ? 'inventory' : 'stores'} when you list them and come back if you cancel or the order expires (after ${Math.round(mods.expiryHours / 24)} days). Merchants stop their usual work while they trade.</p>
        <button type="submit" class="mk-btn mk-btn-primary mk-wide" ${blocked || (isItem && !spec.it) ? 'disabled' : ''}>📦 List for sale</button>
      </form>`;
  }

  // Items go on a stall: just how many and the price each. No merchants —
  // buyers send porters to collect.
  function sellItemHtml(st, spec) {
    const d = state.draft;
    const stalls = (state.mine && state.mine.stalls) || st.stalls || {};
    const stallLine = Object.values(stalls).filter(v => v.slots).map(v =>
      `<span>${esc(v.label)} stalls <b>${v.used} / ${v.slots}</b></span>`).join('') || '<span>No stalls yet</span>';
    const full = !Object.values(stalls).some(v => v.free > 0);
    return `
      <form class="mk-form" data-form="sell">
        <div class="mk-caps">${stallLine}</div>
        ${full ? '<div class="mk-warn">All your stalls are full. Wait for a sale, cancel a listing, or upgrade the Market.</div>' : ''}
        <div class="mk-mode" role="tablist">
          <button type="button" data-act="sell-mode" data-mode="resource">${resImg('timber')} Resources</button>
          <button type="button" class="on" data-act="sell-mode" data-mode="item">🎒 Items</button>
        </div>
        <div class="mk-field"><span>Item <em class="mk-muted">(greyed items can't be traded)</em></span>${itemPickerHtml()}</div>
        <label class="mk-field"><span>How many${spec.it ? ` <em class="mk-muted">(have ${fmt(spec.have)})</em>` : ''}</span>
          <input name="qty_total" type="number" min="1" max="${spec.have || 1}" step="1" inputmode="numeric" value="${esc(d.qty_total || (spec.it ? spec.have : ''))}" data-act="draft"></label>
        <label class="mk-field"><span>Price each <em class="mk-muted">(gold)</em></span>
          <input name="lot_price" type="number" min="1" step="1" inputmode="numeric" value="${esc(d.lot_price)}" placeholder="gold" data-act="draft"></label>
        <label class="mk-field"><span>Stall</span>
          <select name="venue" data-act="draft">
            <option value="">Best fit (a matching shop, else the Market)</option>
            ${Object.entries(stalls).filter(([, v]) => v.slots).map(([k, v]) => {
              const fits = !spec.it || !v.sells || v.sells.includes(catOfItem(spec.it));
              const why = !v.open ? ' — closed, needs a shopkeeper' : !v.free ? ' — full' : !fits ? ' — doesn’t sell this' : '';
              return `<option value="${k}" ${d.venue === k ? 'selected' : ''} ${why ? 'disabled' : ''}>${esc(v.label)} (${v.used}/${v.slots})${why}</option>`;
            }).join('')}
          </select></label>
        <input type="hidden" name="lot_size" value="1">
        <div class="mk-summary" id="mk-sell-summary"></div>
        <p class="mk-muted mk-small">Listed items leave your inventory and sit on a stall. Buyers send a porter to collect; you're paid when they arrive. Unsold items come back if you cancel or after ${Math.round(st.mods.expiryHours / 24)} days.</p>
        <button type="submit" class="mk-btn mk-btn-primary mk-wide" ${full || !spec.it ? 'disabled' : ''}>🏷️ Put on a stall</button>
      </form>`;
  }

  // Browse category of an inventory item (mirrors the server's categoryOf).
  function catOfItem(it) {
    if (it.equip_slot === 'shield') return 'armour';   // shields sell with armour
    if (['weapon', 'armour', 'tool', 'trinket'].includes(it.equip_slot)) return it.equip_slot;
    return ['fish', 'food', 'material', 'trophy'].includes(it.category) ? it.category : 'misc';
  }

  function readDraft() {
    const f = document.querySelector('#market-panel form[data-form="sell"]');
    if (!f) return;
    const d = state.draft;
    if (f.venue) d.venue = f.venue.value;
    if (f.resource) d.resource = f.resource.value;
    d.qty_total = f.qty_total.value;
    d.lot_size = f.lot_size.value;
    d.lot_price = f.lot_price.value;
  }

  // Live numbers under the form; only this block re-renders while typing.
  function updateSellSummary() {
    const el = byId('mk-sell-summary');
    if (!el) return;
    const st = state.status, d = state.draft, spec = goodsSpec();
    if (d.mode === 'item' && !spec.it) { el.innerHTML = '<div>Pick an item to sell.</div>'; return; }
    const maxLot = spec.maxLot;
    const total = spec.equip ? 1 : parseInt(d.qty_total, 10) || 0;
    const lot = spec.equip ? 1 : parseInt(d.lot_size, 10) || Math.min(maxLot, total || maxLot);
    const lotPrice = parseInt(d.lot_price, 10) || 0;
    const lines = [];
    if (spec.it && d.mode === 'item') {
      const n = parseInt(d.qty_total, 10) || spec.have;
      const each = parseInt(d.lot_price, 10) || 0;
      const v = spec.it.sell_value || 0;
      const out = [];
      out.push(v ? `Town value <b>${fmt(v)}</b> each — Ironhaven would pay about ${fmt(Math.max(1, Math.floor(v * 0.3)))}.` : 'No town value — set what you think it’s worth.');
      out.push(`<span class="mk-pb" data-pk="${esc(goodKeyOf('item', null, spec.it))}" data-pv="badge"></span>`);
      if (each) out.push(`${fmt(n)} × ${fmt(each)} = ${fmt(n * each)} gold · you keep ${fmt(n * each - Math.floor(n * each * st.mods.feeRate))} after the ${Math.round(st.mods.feeRate * 100)}% fee.`);
      if (n > spec.have) out.push(`<span class="mk-warn-text">You only have ${fmt(spec.have)}.</span>`);
      el.innerHTML = out.map(l => `<div>${l}</div>`).join('');
      fillPrices(el);
      return;
    }
    if (spec.it) {
      lines.push(spec.it.sell_value
        ? `Town merchants pay <b>${fmt(spec.it.sell_value)}</b> gold each (≈ ${fmt(spec.it.sell_value * lot)} for ${fmt(lot)}).`
        : 'Town merchants won’t buy this — set what you think it’s worth.');
    } else {
      // Recent player trades once there are enough, else the reference price.
      const g = (st.guide && st.guide[d.resource]) || { price: st.referencePrice[d.resource], source: 'reference' };
      lines.push(`${g.source === 'trades' ? 'Recent trades' : 'Market guide price'}: about <b>${price2(g.price)}</b> gold per ${spec.label} (≈ ${fmt(Math.max(1, Math.round(g.price * lot)))} for ${fmt(lot)}).`);
      lines.push(`<span class="mk-pb" data-pk="resource:${esc(d.resource)}" data-pv="badge"></span>`);
    }
    if (total && lot) {
      const lots = Math.ceil(total / lot);
      lines.push(`${lots} deliver${lots === 1 ? 'y' : 'ies'} of up to ${fmt(lot)}.`);
    }
    if (lotPrice && lot) {
      const fee = Math.floor(lotPrice * st.mods.feeRate);
      lines.push(`${price2(lotPrice / lot)} gold per unit · you keep ${fmt(lotPrice - fee)} per delivery after the ${Math.round(st.mods.feeRate * 100)}% fee.`);
    }
    const warn = [];
    if (lot > maxLot) warn.push(`A merchant carries at most ${fmt(maxLot)} ${esc(spec.label)}.`);
    if (total > spec.have) warn.push(`You only have ${fmt(spec.have)}.`);
    if (total && lot > total) warn.push('Per delivery can’t be more than the total.');
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join('') + warn.map(w => `<div class="mk-warn-text">${w}</div>`).join('');
    fillPrices(el);
  }

  async function submitSell() {
    if (state.busy) return;
    readDraft();
    const d = state.draft;
    const spec = goodsSpec();
    const isItem = d.mode === 'item';
    if (isItem && !spec.it) return toast('Pick an item to sell.', 'error');
    if (isItem) {
      const qty_total = parseInt(d.qty_total, 10) || spec.have, unit_price = parseInt(d.lot_price, 10);
      if (!unit_price) return toast('Set a price for each item.', 'error');
      state.busy = true;
      try {
        await call('POST', '/api/market/orders', { kind: 'item', inventory_id: spec.it.id, qty_total, unit_price, venue: d.venue || undefined });
        toast(`🏷️ ${fmt(qty_total)}× ${spec.it.name} on a stall at ${fmt(unit_price)} each.`);
        state.draft = { ...d, inventory_id: null, qty_total: '', lot_size: '', lot_price: '' };
        if (typeof global.loadInventory === 'function') { try { global.loadInventory(); } catch (_) {} }
        state.tab = 'caravans';
        await refresh();
      } catch (e) { toast(e.message, 'error'); }
      finally { state.busy = false; }
      return;
    }
    const qty_total = spec.equip ? 1 : parseInt(d.qty_total, 10);
    const lot_size = spec.equip ? 1 : parseInt(d.lot_size, 10) || Math.min(spec.maxLot, qty_total || 0);
    const lot_price = parseInt(d.lot_price, 10);
    if (!qty_total || !lot_price) return toast('Set how much to sell and the price per delivery.', 'error');
    if (!d.citizen_ids.length) return toast('Choose at least one merchant.', 'error');
    state.busy = true;
    try {
      const body = isItem
        ? { kind: 'item', inventory_id: spec.it.id, qty_total, lot_size, lot_price, citizen_ids: d.citizen_ids }
        : { resource: d.resource, qty_total, lot_size, lot_price, citizen_ids: d.citizen_ids };
      await call('POST', '/api/market/orders', body);
      toast(`📦 Listed ${fmt(qty_total)} ${isItem ? '× ' + spec.it.name : spec.label} for sale.`);
      state.draft = { mode: d.mode, resource: d.resource, inventory_id: null, qty_total: '', lot_size: '', lot_price: '', citizen_ids: [] };
      if (typeof global.refreshResources === 'function') global.refreshResources();
      if (isItem && typeof global.loadInventory === 'function') { try { global.loadInventory(); } catch (_) {} }
      state.tab = 'caravans';
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally { state.busy = false; }
  }

  // ── Search autocomplete ────────────────────────────────────────────────

  let searchTimer = null, suggest = [], suggestAt = -1, searchSeq = 0;
  let suggestFor = 'search';   // which box: 'search' (Buy) or 'want-search' (Wanted)
  // Trophies have no button (Misc covers them) but still get an icon.
  const CAT_ICON = { ...Object.fromEntries(CATS.map(([k, icon]) => [k, icon])), trophy: '🏆' };

  function renderSuggest() {
    const ul = byId(suggestFor === 'want-search' ? 'mk-want-suggest' : 'mk-suggest');
    const input = byId(suggestFor === 'want-search' ? 'mk-want-search' : 'mk-search');
    if (!ul) return;
    ul.innerHTML = suggest.map((it, i) => `<li role="option" class="${i === suggestAt ? 'on' : ''}" data-act="suggest" data-i="${i}"
        aria-selected="${i === suggestAt}"><span>${esc(it.icon || '📦')}</span>
        <b style="color:${rarityColor(it.rarity)}">${esc(it.name)}</b>
        <small>${CAT_ICON[it.cat] || ''} ${esc(it.cat)}</small></li>`).join('');
    ul.classList.toggle('open', suggest.length > 0);
    if (input) input.setAttribute('aria-expanded', suggest.length ? 'true' : 'false');
  }

  function onSearchInput(input) {
    clearTimeout(searchTimer);
    suggestFor = input.dataset.act;
    const q = input.value.trim();
    if (q.length < 3) {
      suggest = []; suggestAt = -1; renderSuggest();
      if (suggestFor === 'want-search') { state.wantDraft.item = null; return; }
      if (!q && state.itemKey) { state.itemKey = null; state.itemName = ''; switchTab('buy'); }
      return;
    }
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try {
        const r = await call('GET', '/api/market/catalog?q=' + encodeURIComponent(q));
        if (seq !== searchSeq) return;   // a newer keystroke won
        suggest = r.items || []; suggestAt = suggest.length ? 0 : -1;
        renderSuggest();
      } catch (_) {}
    }, 180);
  }

  function pickSuggest(i) {
    const it = suggest[i];
    if (!it) return;
    if (suggestFor === 'want-search') {
      readWantDraft();
      state.wantDraft.item = it;
      suggest = []; suggestAt = -1;
      return render();
    }
    state.itemKey = it.item_key; state.itemName = it.name; state.cat = '';
    suggest = []; suggestAt = -1;
    switchTab('buy');
  }

  function onSearchKey(e) {
    if (!suggest.length) return;
    if (e.key === 'ArrowDown') { suggestAt = (suggestAt + 1) % suggest.length; renderSuggest(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { suggestAt = (suggestAt - 1 + suggest.length) % suggest.length; renderSuggest(); e.preventDefault(); }
    else if (e.key === 'Enter') { pickSuggest(Math.max(0, suggestAt)); e.preventDefault(); }
    else if (e.key === 'Escape') { suggest = []; renderSuggest(); e.stopPropagation(); }
  }

  // ── NPC village traders ────────────────────────────────────────────────

  // A village's order. side 'sell' = the village sells (Buy tab),
  // 'buy' = the village buys (Wanted tab). Looks like a player row, badged.
  function npcRowHtml(o, side) {
    const it = o.item;
    const icon = it ? esc(it.icon || '📦') : (RES_ICON[o.resource] || '📦');
    const name = it ? `<b style="color:${rarityColor(it.rarity)}">${esc(it.name)}</b>` : `<b>${esc(RES_LABEL[o.resource] || o.resource)}</b>`;
    const price = o.per === 1 ? `${gold(o.price)} <span class="mk-for">each</span>` : `${gold(o.price)} <span class="mk-for">per ${o.per}</span>`;
    const canDo = side === 'sell' ? true : o.you_have > 0;
    // A village's special request: its own badge, deadline and the thanks.
    const req = o.request;
    const when = req
      ? `<div class="mk-order-meta mk-req-meta">📣 Needed by ${esc(req.by)} — <span data-until="${esc(o.expires_at)}">…</span> left · fill it all for <b>+${req.trust} trust</b>
          ${side === 'buy' ? ` · <span class="${o.you_have ? 'mk-better' : ''}">you have ${fmt(o.you_have)}</span>` : ''}</div>`
      : `<div class="mk-order-meta mk-muted">Your allowance today · new orders in <span data-until="${esc(o.expires_at)}">…</span>
          ${side === 'buy' ? ` · <span class="${o.you_have ? 'mk-better' : ''}">you have ${fmt(o.you_have)}</span>` : ''}</div>`;
    return `<li class="mk-order mk-npc-row${req ? ' mk-req-row' : ''}">
      <div class="mk-stall-icon">${icon}</div>
      <div class="mk-order-main">
        <div class="mk-order-line">${name} <span class="mk-for">· ${side === 'sell' ? 'sells' : 'wants'}</span> ${fmt(o.qty_available)} <span class="mk-for">at</span> ${price}</div>
        <div class="mk-order-meta">${req ? '<span class="mk-npc-badge mk-req-badge">Request</span>' : '<span class="mk-npc-badge">NPC</span>'} <span>${esc(o.npc.name)}</span>
          <span class="mk-muted">· ${esc(o.npc.tier)}</span> · <span>${o.distance} hexes away</span> · <span>round trip ~${dur(o.eta_seconds)}</span></div>
        ${when}
      </div>
      <div class="mk-order-act"><button type="button" class="mk-btn mk-btn-primary" data-act="npc-trade" data-side="${side}" data-id="${esc(o.id)}" ${canDo ? '' : 'disabled'}>
        ${side === 'sell' ? '🧺 Buy…' : '📮 Sell…'}</button></div>
    </li>`;
  }

  async function openNpcSheet(o, side) {
    if (!state.mine || !state.mine.candidates) { try { state.mine = await call('GET', '/api/market/mine'); } catch (_) {} }
    const free = ((state.mine && state.mine.candidates) || []).filter(c => !c.busy);
    const wealth = liveResources().wealth ?? state.status.resources.wealth;
    let max = Math.min(o.qty_available, o.carry_max);
    if (side === 'sell') max = Math.min(max, Math.floor(wealth * o.per / o.price) || 0);   // what you can afford
    else max = Math.min(max, o.you_have || 0);
    max = Math.max(1, max);
    const what = o.item ? `${esc(o.item.icon || '📦')} ${esc(o.item.name)}` : `${RES_ICON[o.resource] || ''} ${esc((RES_LABEL[o.resource] || '').toLowerCase())}`;
    sheet(`
      <h3>${side === 'sell' ? 'Buy' : 'Sell'} ${what} ${side === 'sell' ? 'from' : 'to'} ${esc(o.npc.name)}</h3>
      <div class="mk-collect">
        <label class="mk-field"><span>How many <em class="mk-muted">(up to ${fmt(max)})</em></span>
          <input type="number" id="mk-npc-qty" min="1" max="${max}" value="${max}" data-act="npc-qty" data-id="${esc(o.id)}" data-side="${side}"></label>
        <label class="mk-field"><span>Porter</span>
          ${free.length ? `<select id="mk-npc-porter">${free.map(c => `<option value="${c.id}">${esc(c.name)} · scouting ${c.scouting}</option>`).join('')}</select>`
            : '<div class="mk-warn">Nobody is free to send.</div>'}</label>
      </div>
      <div class="mk-sum" id="mk-npc-sum"></div>
      <p class="mk-muted mk-small">${side === 'sell'
        ? 'Your gold is paid now; the porter walks there and back with the goods. The deal completes when they are home.'
        : 'The goods leave your stores now; the porter brings the gold home. The deal completes when they are home.'}
        Trading with ${esc(o.npc.name)} warms your relationship a little (up to +2 trust a day).</p>
      <div class="mk-sheet-actions">
        <button type="button" class="mk-btn" data-act="sheet-close">Cancel</button>
        <button type="button" class="mk-btn mk-btn-primary" data-act="npc-confirm" data-id="${esc(o.id)}" data-side="${side}" ${free.length ? '' : 'disabled'}>
          ${side === 'sell' ? '🧺' : '📮'} Send porter</button>
      </div>`);
    updateNpcSummary();
  }

  function npcOrderById(id, side) {
    return ((side === 'sell' ? state.orders : state.wants) || []).find(x => String(x.id) === String(id));
  }

  function updateNpcSummary() {
    const input = byId('mk-npc-qty'), el = byId('mk-npc-sum');
    if (!input || !el) return;
    const o = npcOrderById(input.dataset.id, input.dataset.side);
    if (!o) return;
    const n = Math.max(0, parseInt(input.value, 10) || 0);
    const total = Math.ceil(o.price * n / o.per);
    el.innerHTML = `<div><span>${input.dataset.side === 'sell' ? 'You pay now' : 'You get when home'}</span><b>${gold(total)}</b></div>
      <div><span>Round trip</span><b>~${dur(o.eta_seconds)}</b></div>`;
  }

  async function npcTrade(id, side) {
    if (state.busy) return;
    const o = npcOrderById(id, side);
    const qty = parseInt((byId('mk-npc-qty') || {}).value, 10);
    const porter = parseInt((byId('mk-npc-porter') || {}).value, 10);
    if (!o || !qty || !porter) return;
    state.busy = true;
    try {
      const r = await call('POST', `/api/market/npc/${o.npc.id}/${o.order_key}`, { qty, citizen_id: porter });
      closeSheet();
      const goods = o.item ? `${fmt(qty)}× ${o.item.name}` : `${fmt(qty)} ${(RES_LABEL[o.resource] || o.resource || '').toLowerCase()}`;
      toast(side === 'sell'
        ? `🧺 ${r.porter} is walking to ${r.village} to buy ${goods} — ${backIn(r.run)} with the goods.`
        : `🧺 ${r.porter} is taking ${goods} to ${r.village} — ${backIn(r.run)} with ${fmt(r.gold)} gold.`);
      if (typeof global.refreshResources === 'function') global.refreshResources();
      if (o.item && typeof global.loadInventory === 'function') { try { global.loadInventory(); } catch (_) {} }
      await showNewRun(r.run);
    } catch (e) { toast(e.message, 'error'); }
    finally { state.busy = false; }
  }

  // ── Wanted (buy orders) ────────────────────────────────────────────────

  function wantWhat(w, n) {
    return w.kind === 'item' && w.item ? `${esc(w.item.icon || '📦')} ${fmt(n)}× ${esc(w.item.name)}`
      : `${RES_ICON[w.resource] || ''} ${fmt(n)} ${esc((RES_LABEL[w.resource] || w.resource || '').toLowerCase())}`;
  }
  function wantPrice(w) {
    return w.kind === 'item' ? `${gold(w.price)} each` : `${gold(w.price)} per ${w.per}`;
  }

  function wantedHtml() {
    const st = state.status, d = state.wantDraft;
    const mine = state.mine || {};
    const myWants = (mine.wants || []).filter(w => w.status === 'active');
    const cap = st.mods.marketLevel ? 2 + st.mods.marketLevel : 0;
    const cats = CATS.map(([k, icon, label]) =>
      `<button type="button" class="mk-cat ${!state.itemKey && state.cat === k ? 'on' : ''}" data-act="cat" data-cat="${k}" title="${label}">
        <span class="mk-cat-icon">${icon}</span><span class="mk-cat-label">${label}</span></button>`).join('');
    const list = (state.wants || []).map(w => w.npc ? npcRowHtml(w, 'buy') : `<li class="mk-order mk-want-row">
        <div class="mk-stall-icon">${w.kind === 'item' ? esc((w.item && w.item.icon) || '📦') : RES_ICON[w.resource] || '📦'}</div>
        <div class="mk-order-main">
          <div class="mk-order-line"><b>${w.kind === 'item' ? esc(w.item.name) : esc(RES_LABEL[w.resource] || w.resource)}</b>
            <span class="mk-for">· wants</span> ${fmt(w.qty_open)} <span class="mk-for">· pays</span> ${wantPrice(w)}</div>
          <div class="mk-order-meta"><span>${esc(w.buyer.name)}</span> <span class="mk-muted">(${esc(w.buyer.username)})</span> ·
            <span>${w.distance} hexes away</span> · <span>${fmt(w.total_open)} gold waiting</span></div>
          <div class="mk-order-meta ${w.you_have ? 'mk-better' : 'mk-muted'}">You have ${fmt(w.you_have)}</div>
        </div>
        <div class="mk-order-act"><button type="button" class="mk-btn mk-btn-primary" data-act="fill" data-id="${w.id}" ${w.you_have ? '' : 'disabled'}>📮 Fill…</button></div>
      </li>`).join('') || '<li class="mk-empty">No wanted orders from towns you know' + (state.cat || state.itemKey ? ' in this category' : '') + '.</li>';
    const myRows = myWants.map(w => `<li class="mk-mine">
        <div class="mk-order-line">${wantWhat(w, w.qty_total)} <span class="mk-for">at</span> ${wantPrice(w)}
          <span class="mk-status mk-status-active">Open</span></div>
        <div class="mk-order-meta">${fmt(w.qty_total - w.qty_open)} of ${fmt(w.qty_total)} promised · ${fmt(w.total_open)} gold still held · expires in ${untilLong(w.expires_at)}</div>
        <div class="mk-mine-act"><button type="button" class="mk-btn mk-btn-sm mk-btn-danger" data-act="cancel-want" data-id="${w.id}">Cancel</button></div>
      </li>`).join('');
    const isItem = d.kind === 'item';
    const resOpts = knownTradeable(st).map(r => `<option value="${r}" ${d.resource === r ? 'selected' : ''}>${RES_TXT[r]} ${RES_LABEL[r]}</option>`).join('');
    return `
      <div class="mk-sec">
        <h3>Post a wanted order <span class="mk-muted mk-small">${myWants.length} / ${cap}</span></h3>
        <form class="mk-form" data-form="want">
          <div class="mk-mode" role="tablist">
            <button type="button" class="${isItem ? 'on' : ''}" data-act="want-kind" data-kind="item">🎒 An item</button>
            <button type="button" class="${isItem ? '' : 'on'}" data-act="want-kind" data-kind="resource">${resImg('timber')} A resource</button>
          </div>
          ${isItem ? `<div class="mk-search mk-want-search">
              <input type="search" id="mk-want-search" class="mk-search-input" placeholder="Which item? Type 3 letters…" autocomplete="off"
                value="${esc(d.item ? d.item.name : '')}" data-act="want-search" role="combobox" aria-controls="mk-want-suggest" aria-expanded="false">
              <ul class="mk-suggest" id="mk-want-suggest" role="listbox"></ul>
            </div>`
            : `<label class="mk-field"><span>Resource</span><select name="resource" data-act="want-draft">${resOpts}</select></label>`}
          <div class="mk-collect">
            <label class="mk-field"><span>How many</span><input name="qty" type="number" min="1" step="1" value="${esc(d.qty)}" data-act="want-draft" placeholder="e.g. ${isItem ? 20 : 500}"></label>
            <label class="mk-field"><span>Pay ${isItem ? 'each' : 'per 100'} <em class="mk-muted">(gold)</em></span><input name="price" type="number" min="1" step="1" value="${esc(d.price)}" data-act="want-draft"></label>
          </div>
          <div class="mk-summary" id="mk-want-summary"></div>
          <button type="submit" class="mk-btn mk-btn-primary mk-wide" ${myWants.length >= cap ? 'disabled' : ''}>📮 Post — hold the gold</button>
        </form>
        ${myRows ? `<ul class="mk-list">${myRows}</ul>` : ''}
      </div>
      <div class="mk-sec">
        <h3>Towns want</h3>
        <div class="mk-cats" role="toolbar" aria-label="Categories">${cats}</div>
        ${state.itemKey || (state.cat === 'resources' && state.wantResource)
          ? `<div class="mk-filter-chip">Showing ${esc(state.itemKey ? state.itemName : (RES_LABEL[state.wantResource] || state.wantResource))} <button type="button" data-act="clear-want" aria-label="Show all wanted orders">✕</button></div>` : ''}
      <label class="mk-npc-toggle"><input type="checkbox" data-act="hide-npc" ${state.hideNpc ? 'checked' : ''}> Hide NPC traders</label>
        <ul class="mk-list">${list}</ul>
      </div>`;
  }

  function readWantDraft() {
    const f = document.querySelector('#market-panel form[data-form="want"]');
    if (!f) return;
    const d = state.wantDraft;
    if (f.resource) d.resource = f.resource.value;
    d.qty = f.qty.value; d.price = f.price.value;
  }

  function updateWantSummary() {
    const el = byId('mk-want-summary');
    if (!el) return;
    readWantDraft();
    const d = state.wantDraft;
    const qty = parseInt(d.qty, 10) || 0, price = parseInt(d.price, 10) || 0;
    const per = d.kind === 'item' ? 1 : 100;
    const held = Math.ceil(qty * price / per);
    const what = d.kind === 'item' ? (d.item ? esc(d.item.name) : 'pick an item') : esc(RES_LABEL[d.resource].toLowerCase());
    const pk = d.kind === 'item' ? (d.item ? `item:${d.item.item_key}:basic` : '') : `resource:${d.resource}`;
    el.innerHTML = (qty && price
      ? `<div>Wanting ${fmt(qty)} ${what} — <b>${fmt(held)}</b> gold is held now and paid out as sellers deliver. Cancel any time for the rest back.</div>`
      : `<div>Sellers in towns you know can fill it. Their porter brings the goods to you.</div>`)
      + (pk ? `<div><span class="mk-pb" data-pk="${esc(pk)}" data-pv="badge" data-per="${per}"></span></div>` : '');
    fillPrices(el);
  }

  async function postWant() {
    if (state.busy) return;
    readWantDraft();
    const d = state.wantDraft;
    const qty = parseInt(d.qty, 10), price = parseInt(d.price, 10);
    if (d.kind === 'item' && !d.item) return toast('Pick the item you want from the list.', 'error');
    if (!qty || !price) return toast('Set how many and the price.', 'error');
    state.busy = true;
    try {
      const body = d.kind === 'item' ? { kind: 'item', item_key: d.item.item_key, qty, price } : { kind: 'resource', resource: d.resource, qty, price };
      const r = await call('POST', '/api/market/wants', body);
      toast(`📮 Wanted order posted — ${fmt(r.gold_held)} gold held.`);
      state.wantDraft = { kind: d.kind, item: null, resource: d.resource, qty: '', price: '' };
      if (typeof global.refreshResources === 'function') global.refreshResources();
      await switchTab('wanted');
    } catch (e) { toast(e.message, 'error'); }
    finally { state.busy = false; }
  }

  // Fill sheet: which stack (items), how many, and the porter.
  function openFillSheet(w) {
    const mine = state.mine || {};
    const free = (mine.candidates || []).filter(c => !c.busy);
    const max = Math.max(1, Math.min(w.qty_open, w.you_have, w.carry_max));
    sheet(`
      <h3>Fill: ${wantWhat(w, w.qty_open)} for ${esc(w.buyer.name)}</h3>
      <div class="mk-collect">
        <label class="mk-field"><span>How many <em class="mk-muted">(you have ${fmt(w.you_have)}; up to ${fmt(max)} per trip)</em></span>
          <input type="number" id="mk-fill-qty" min="1" max="${max}" value="${max}" data-act="fill-qty" data-id="${w.id}"></label>
        <label class="mk-field"><span>Porter</span>
          ${free.length ? `<select id="mk-fill-porter">${free.map(c => `<option value="${c.id}">${esc(c.name)} · scouting ${c.scouting}</option>`).join('')}</select>`
            : '<div class="mk-warn">Nobody is free to send.</div>'}</label>
      </div>
      <div class="mk-sum" id="mk-fill-sum"></div>
      <p class="mk-muted mk-small">The goods leave your stores now. Your porter carries them to ${esc(w.buyer.name)} (${w.distance} hexes) and brings the gold home.</p>
      <div class="mk-sheet-actions">
        <button type="button" class="mk-btn" data-act="sheet-close">Cancel</button>
        <button type="button" class="mk-btn mk-btn-primary" data-act="fill-confirm" data-id="${w.id}" ${free.length ? '' : 'disabled'}>📮 Send porter</button>
      </div>`);
    updateFillSummary();
  }

  function updateFillSummary() {
    const input = byId('mk-fill-qty'), el = byId('mk-fill-sum');
    if (!input || !el) return;
    const w = (state.wants || []).find(x => x.id === Number(input.dataset.id));
    if (!w) return;
    const n = Math.max(0, parseInt(input.value, 10) || 0);
    const pay = Math.ceil(w.price * n / w.per);
    const fee = Math.floor(pay * state.status.mods.feeRate);
    el.innerHTML = `<div><span>They pay</span><b>${gold(pay)}</b></div><div><span>Market fee</span><b>${gold(fee)}</b></div>
      <div><span>You get when home</span><b>${gold(pay - fee)}</b></div>`;
  }

  async function fillWant(id) {
    if (state.busy) return;
    const w = (state.wants || []).find(x => x.id === id);
    const qty = parseInt((byId('mk-fill-qty') || {}).value, 10);
    const porter = parseInt((byId('mk-fill-porter') || {}).value, 10);
    if (!w || !qty || !porter) return;
    state.busy = true;
    try {
      const r = await call('POST', `/api/market/wants/${id}/fill`, { qty, citizen_id: porter });
      closeSheet();
      toast(`📮 ${r.porter} is taking ${fmt(r.run.qty)} to ${r.buyer} — ${backIn(r.run)} with ${fmt(r.gold - r.fee)} gold.`);
      if (typeof global.refreshResources === 'function') global.refreshResources();
      if (w.kind === 'item' && typeof global.loadInventory === 'function') { try { global.loadInventory(); } catch (_) {} }
      await showNewRun(r.run);
    } catch (e) { toast(e.message, 'error'); }
    finally { state.busy = false; }
  }

  // ── Shops ──────────────────────────────────────────────────────────────

  const SHOP_INFO = {
    smithy: { icon: '⚒️', building: 'smithy' }, jeweller: { icon: '💍', building: 'jeweller' },
    fishing_post: { icon: '🎣', building: 'fishing_post' }, market: { icon: '⚖️', building: 'market' },
  };

  function shopsHtml() {
    const sh = state.shops;
    if (!sh) return '<div class="mk-empty">Unrolling the ledgers…</div>';
    const free = (sh.candidates || []).filter(c => !c.busy);
    const orders = ((state.mine && state.mine.orders) || []).filter(o => o.kind === 'item' && o.status === 'active');
    const cards = Object.entries(sh.stalls).map(([v, st]) => {
      const info = SHOP_INFO[v] || { icon: '🏪' };
      const sells = st.sells ? st.sells.map(c => `<span title="${esc(c)}">${CAT_ICON[c] || ''}</span>`).join(' ') : '<span class="mk-muted">anything</span>';
      const listings = orders.filter(o => (o.venue || 'market') === v);
      if (!st.slots) {
        return `<div class="mk-shop off"><div class="mk-shop-head"><span class="mk-shop-icon">${info.icon}</span>
          <div><b>${esc(st.label)}</b><div class="mk-muted mk-small">Not built · sells ${sells}</div></div>
          <button type="button" class="mk-btn mk-btn-sm" data-act="build-shop" data-building="${info.building}">Build</button></div></div>`;
      }
      const keeperSel = st.needs_keeper ? `<label class="mk-field mk-keeper"><span>Shopkeeper</span>
          <select data-act="keeper" data-venue="${v}">
            <option value="">— nobody (closed) —</option>
            ${st.keeper ? `<option value="${st.keeper.id}" selected>${esc(st.keeper.name)}</option>` : ''}
            ${free.map(c => `<option value="${c.id}">${esc(c.name)} · ${esc(c.role)}</option>`).join('')}
          </select></label>` : '';
      return `<div class="mk-shop ${st.open ? '' : 'closed'}">
        <div class="mk-shop-head"><span class="mk-shop-icon">${info.icon}</span>
          <div><b>${esc(st.label)}</b> <span class="mk-muted mk-small">Lv ${st.level}</span>
            <div class="mk-muted mk-small">Sells ${sells} · stalls <b>${st.used} / ${st.slots}</b></div></div>
          <span class="mk-status ${st.open ? 'mk-status-active' : ''}">${st.open ? 'Open' : 'Closed'}</span></div>
        ${st.needs_keeper && !st.keeper ? '<div class="mk-warn">Nobody is minding this shop — its stalls are hidden from buyers until you pick a shopkeeper.</div>' : ''}
        ${keeperSel}
        ${listings.length ? `<ul class="mk-list">${listings.map(o => myOrderHtml(o, [], {}, 0)).join('')}</ul>` : '<div class="mk-muted mk-small">No listings here yet.</div>'}
      </div>`;
    }).join('');
    return `<p class="mk-muted mk-small">Shops add item stalls for their kinds of goods. A shopkeeper must mind each shop for it to sell — later, skilled shopkeepers will run them better.</p>
      <div class="mk-shops">${cards}</div>`;
  }

  async function setKeeper(venue, citizenId) {
    try {
      await call('PATCH', `/api/market/shops/${venue}/keeper`, { citizen_id: citizenId || null });
      toast(citizenId ? 'Shopkeeper assigned — the shop is open.' : 'The shop is closed.');
    } catch (e) { toast(e.message, 'error'); }
    await switchTab('shops');
  }

  // ── Ironhaven ──────────────────────────────────────────────────────────

  function ironhavenHtml() {
    const ih = state.ih;
    if (!ih) return '<div class="mk-empty">Unrolling the ledgers…</div>';
    if (!ih.ironhaven) return '<div class="mk-empty">The road to Ironhaven is closed right now.</div>';
    const free = (ih.candidates || []).filter(c => !c.busy);
    if (!free.some(c => c.id === state.ihPorter)) state.ihPorter = free.length ? free[0].id : null;
    const porterOpts = free.map(c => `<option value="${c.id}" ${c.id === state.ihPorter ? 'selected' : ''}>${esc(c.name)} · scouting ${c.scouting}</option>`).join('');
    const days = Math.max(0, Math.ceil((new Date(ih.week_ends).getTime() - now()) / 86400e3));
    const wants = ih.wants.length ? ih.wants.map(w => `<div class="mk-want"><span class="mk-want-icon">${esc(w.icon || '📦')}</span>
        <div><b>${esc(w.name)}</b><div class="mk-muted mk-small">${CAT_ICON[w.cat] || ''} ${esc(w.cat)} · pays ${gold(w.unit_price)} each</div></div></div>`).join('')
      : '<div class="mk-muted">Nothing this week.</div>';
    const rows = ih.items.length ? ih.items.map(i => {
      const why = !i.tradeable ? i.reason : '';
      const better = i.player_price && i.player_price > i.unit_price
        ? `<span class="mk-better">Players list from ${price2(i.player_price)}</span>` : '';
      return `<li class="mk-ih-row ${why ? 'off' : ''} ${i.wanted ? 'wanted' : ''} ${state.focusItem === i.id ? 'focus' : ''}" data-row="${i.id}">
        <span class="mk-item-icon">${esc(i.icon || '📦')}</span>
        <div class="mk-ih-main">
          <div><b style="color:${rarityColor(i.rarity)}">${esc(i.name)}</b> <span class="mk-muted">×${fmt(i.quantity)}</span>
            ${i.wanted ? '<span class="mk-want-tag">Wanted ×2</span>' : ''}</div>
          <div class="mk-muted mk-small">${why ? esc(why) : `Ironhaven pays ${gold(i.unit_price)} each · a porter carries ${fmt(i.max_qty)}`} ${better}</div>
        </div>
        ${why ? '' : `<input type="number" class="mk-ih-qty" data-ih-qty="${i.id}" min="1" max="${i.max_qty}" value="${Math.min(i.quantity, i.max_qty)}" aria-label="How many">
        <button type="button" class="mk-btn mk-btn-sm mk-btn-primary" data-act="ih-sell" data-id="${i.id}" ${state.ihPorter ? '' : 'disabled'}>Send</button>`}
      </li>`;
    }).join('') : '<li class="mk-empty">Your inventory is empty.</li>';
    const runs = (ih.runs || []).filter(r => r.status !== 'done');
    const runRows = runs.map(r => {
      const back = r.status === 'returning';
      const from = back ? r.arrives_at : r.departs_at, to = back ? r.returns_at : r.arrives_at;
      return `<li class="mk-trip live"><div class="mk-trip-icon">${back ? COIN : '🏰'}</div><div class="mk-trip-main">
        <div>${esc(r.citizen_name || 'A porter')} ${back ? `is heading home with ${gold(r.gold)}` : `is carrying ${fmt(r.qty)}× ${esc((r.item && r.item.name) || 'goods')} to Ironhaven`}</div>
        <div class="mk-bar"><div class="mk-bar-fill" data-from="${esc(from)}" data-to="${esc(to)}"></div></div>
        <div class="mk-muted mk-small">${back ? 'Home' : 'Arrives'} in <span data-until="${esc(to)}">…</span></div></div></li>`;
    }).join('');
    return `
      <div class="mk-ih-head">
        <div class="mk-ih-crest">🏰</div>
        <div><b>${esc(ih.ironhaven.name)}</b> buys almost anything — cheaply. It pays ${Math.round(ih.rate * 100)}% of an item's value
          (${Math.round(ih.want_rate * 100)}% for this week's wants). Other players usually pay far more.
          <div class="mk-muted mk-small">${ih.ironhaven.distance} hexes away · a porter's round trip takes about ${dur(2 * ih.ironhaven.leg_seconds)} · gold arrives when they're home.</div></div>
      </div>
      <div class="mk-sec"><h3>Ironhaven wants this week <span class="mk-muted mk-small">new list in ${days} day${days === 1 ? '' : 's'}</span></h3>
        <div class="mk-wants">${wants}</div></div>
      <div class="mk-sec"><h3>Send a porter</h3>
        <label class="mk-field"><span>Porter <em class="mk-muted">(carries ${ih.porter_carry} weight)</em></span>
          ${free.length ? `<select data-act="ih-porter">${porterOpts}</select>` : '<div class="mk-warn">Nobody is free to carry goods right now.</div>'}</label>
        <ul class="mk-list">${rows}</ul></div>
      ${runRows ? `<div class="mk-sec"><h3>On the road to Ironhaven</h3><ul class="mk-list">${runRows}</ul></div>` : ''}`;
  }

  async function ironhavenSell(invId) {
    if (state.busy) return;
    const input = document.querySelector(`#market-panel [data-ih-qty="${invId}"]`);
    const qty = parseInt(input && input.value, 10);
    if (!qty || qty < 1) return toast('How many should the porter carry?', 'error');
    state.busy = true;
    try {
      const r = await call('POST', '/api/market/ironhaven/sell', { inventory_id: invId, qty, citizen_id: state.ihPorter });
      toast(`🏰 ${r.porter} is walking to Ironhaven with ${fmt(r.run.qty)}× ${r.run.item.name} — ${backIn(r.run)} with ${fmt(r.gold)} gold.`);
      if (typeof global.loadInventory === 'function') { try { global.loadInventory(); } catch (_) {} }
      state.focusItem = null;
      await switchTab('ironhaven');
    } catch (e) { toast(e.message, 'error'); }
    finally { state.busy = false; }
  }

  // Scrolls to the row opened from the inventory screen.
  function focusRow() {
    if (!state.focusItem) return;
    const row = document.querySelector(`#market-panel [data-row="${state.focusItem}"]`);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
  }

  // ── Caravans & my orders ────────────────────────────────────────────────

  function tripHtml(t) {
    const what = esc(goodsName(t, t.qty));
    const who = esc(t.citizen_name || 'A merchant');
    let text, from, to;
    if (t.direction === 'selling') {
      if (t.status === 'outbound') { text = `${who} is carrying ${what} to ${esc(t.buyer_name)}`; from = t.departs_at; to = t.arrives_at; }
      else if (t.status === 'returning') { text = `${who} is heading home with ${COIN} ${fmt(t.gold_paid - t.fee)}`; from = t.arrives_at; to = t.returns_at; }
      else text = `${who} sold ${what} to ${esc(t.buyer_name)} for ${COIN} ${fmt(t.gold_paid - t.fee)}`;
    } else {
      if (t.status === 'outbound') { text = `${what} on the way from ${esc(t.seller_name)}`; from = t.departs_at; to = t.arrives_at; }
      else text = `Received ${what} from ${esc(t.seller_name)} for ${COIN} ${fmt(t.gold_paid)}`;
    }
    const live = !!to;
    return `<li class="mk-trip ${live ? 'live' : 'done'}">
      <div class="mk-trip-icon">${t.direction === 'selling' ? (t.status === 'returning' ? COIN : '🐾') : (t.kind === 'item' && t.item ? esc(t.item.icon || '📦') : RES_ICON[t.resource])}</div>
      <div class="mk-trip-main">
        <div>${text}</div>
        ${live ? `<div class="mk-bar"><div class="mk-bar-fill" data-from="${esc(from)}" data-to="${esc(to)}"></div></div>
        <div class="mk-muted mk-small">${t.status === 'returning' ? 'Back' : 'Arrives'} in <span data-until="${esc(to)}">…</span> · ${t.distance} hexes</div>` : ''}
      </div>
    </li>`;
  }

  // A porter: yours collecting from a stall, or another town's coming to yours.
  function runHtml(r) {
    const it = r.item || {};
    const what = r.resource && !r.item ? `${fmt(r.qty)} ${esc(r.resource)}` : `${fmt(r.qty)}× ${esc(it.name || 'goods')}`;
    const back = r.status === 'returning';
    let text;
    if (r.direction === 'npc') text = r.side === 'buy'
      ? (back ? `${esc(r.citizen_name || 'Your porter')} is bringing home ${what} from ${esc(r.target_name)}` : `${esc(r.citizen_name || 'Your porter')} is walking to ${esc(r.target_name)} to buy ${what}`)
      : (back ? `${esc(r.citizen_name || 'Your porter')} is heading home from ${esc(r.target_name)} with ${COIN} ${fmt(r.gold)}` : `${esc(r.citizen_name || 'Your porter')} is taking ${what} to sell at ${esc(r.target_name)}`);
    else if (r.direction === 'arriving') text = `A porter from ${esc(r.from_name)} is bringing ${what} for your wanted order`;
    else if (r.direction === 'delivering') text = back ? `${esc(r.citizen_name || 'Your porter')} is heading home with ${COIN} ${fmt(r.gold - r.fee)}`
      : `${esc(r.citizen_name || 'Your porter')} is taking ${what} to ${esc(r.target_name)}`;
    else if (r.direction === 'incoming') text = `A porter from ${esc(r.from_name)} is coming to buy ${what} (${COIN} ${fmt(r.gold - r.fee)} to you)`;
    else if (back) text = r.failed ? `${esc(r.citizen_name || 'Your porter')} found the stall empty — bringing your ${COIN} ${fmt(r.gold)} back`
      : `${esc(r.citizen_name || 'Your porter')} is bringing home ${what}`;
    else text = `${esc(r.citizen_name || 'Your porter')} is walking to ${esc(r.target_name)} to collect ${what}`;
    const from = back ? r.arrives_at : r.departs_at, to = back ? r.returns_at : r.arrives_at;
    return `<li class="mk-trip live${r.id === state.newRun ? ' mk-trip-new' : ''}" data-run="${r.id}"><div class="mk-trip-icon">${r.direction === 'incoming' ? '🛒' : esc(it.icon || '🧺')}</div>
      <div class="mk-trip-main"><div>${text}</div>
        <div class="mk-bar"><div class="mk-bar-fill" data-from="${esc(from)}" data-to="${esc(to)}"></div></div>
        <div class="mk-muted mk-small">${back ? 'Home' : 'Arrives'} in <span data-until="${esc(to)}">…</span> · ${r.distance} hexes</div></div></li>`;
  }

  function myOrderHtml(o, candidates, mods, slotsFree) {
    const active = o.status === 'active';
    const statusLabel = { active: 'Open', sold_out: 'Sold out', cancelled: 'Cancelled', expired: 'Expired' }[o.status] || o.status;
    if (o.kind === 'item') {
      // A stall: no merchants; porters come to collect.
      const it = o.item_snapshot || {};
      const reserved = Number(o.qty_reserved) || 0;
      const sold = o.qty_total - o.qty_escrowed;
      return `<li class="mk-mine ${active ? '' : 'closed'}">
        <div class="mk-order-line">${esc(it.icon || '📦')} <b style="color:${rarityColor(it.rarity)}">${esc(it.name)}</b>
          <span class="mk-for">·</span> ${gold(o.lot_price)} <span class="mk-for">each</span>
          <span class="mk-status mk-status-${o.status}">${statusLabel}</span></div>
        <div class="mk-order-meta">${fmt(o.qty_escrowed - reserved)} of ${fmt(o.qty_total)} on the stall${reserved ? ` · ${fmt(reserved)} being collected` : ''}${sold ? ` · ${fmt(sold)} sold` : ''}${active ? ` · expires in ${untilLong(o.expires_at)}` : ''}</div>
        ${active ? `<div class="mk-mine-act"><button type="button" class="mk-btn mk-btn-sm mk-btn-danger" data-act="cancel" data-id="${o.id}">Take down</button></div>` : ''}
      </li>`;
    }
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
      <div class="mk-order-line">${goodsChip(o.kind === 'item' ? { ...o, item: o.item_snapshot } : o, o.lot_size)} <span class="mk-for">for</span> ${gold(o.lot_price)}
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
    const liveRuns = (mine.runs || []).filter(r => r.status !== 'done');
    return `
      <div class="mk-sec">
        <h3>On the road</h3>
        <ul class="mk-list">${liveTrips.length || liveRuns.length ? liveTrips.map(tripHtml).join('') + liveRuns.map(runHtml).join('')
          : '<li class="mk-empty">No caravans or porters travelling.</li>'}</ul>
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
      </div>` : ''}`;
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
    if (act === 'info') return;  // popover — see setPop
    if (act === 'cat') { state.cat = t.dataset.cat; state.itemKey = null; state.wantResource = ''; state.itemName = ''; return switchTab(state.tab === 'wanted' ? 'wanted' : 'buy'); }
    if (act === 'clear-want') { state.itemKey = null; state.itemName = ''; state.wantResource = ''; return switchTab('wanted'); }
    if (act === 'clear-item') { state.itemKey = null; state.itemName = ''; return switchTab('buy'); }
    if (act === 'suggest') return pickSuggest(Number(t.dataset.i));
    if (act === 'ih-sell') return ironhavenSell(Number(t.dataset.id));
    if (act === 'build-shop') {
      closeMarket();
      if (typeof global.openSettlementBuild === 'function') return global.openSettlementBuild(t.dataset.building);
      return;
    }
    if (act === 'tab') return switchTab(t.dataset.tab);
    if (act === 'ledger-view') { state.ledgerView = t.dataset.view; return switchTab('ledger'); }
    if (act === 'ledger-side') { state.ledgerSide = t.dataset.side; return switchTab('ledger'); }
    if (act === 'price-pick') { state.priceSel = { key: t.dataset.key, name: t.dataset.name }; return switchTab('ledger'); }
    if (act === 'price-q' && state.priceSel) {
      const [type, id] = state.priceSel.key.split(':');
      state.priceSel = { key: `${type}:${id}:${t.dataset.q}`, name: state.priceSel.name };
      return switchTab('ledger');
    }
    if (act === 'ledger-more' && state.ledger && state.ledger.next_before) {
      const qs = new URLSearchParams({ before: state.ledger.next_before });
      if (state.ledgerSide) qs.set('side', state.ledgerSide);
      try {
        const more = await call('GET', '/api/market/ledger?' + qs.toString());
        state.ledger.entries = state.ledger.entries.concat(more.entries);
        state.ledger.next_before = more.next_before;
        render();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (act === 'sell-mode') {
      readDraft();
      state.draft.mode = t.dataset.mode;
      state.draft.qty_total = state.draft.lot_size = '';
      return render();
    }
    if (act === 'pick-item') {
      readDraft();
      state.draft.inventory_id = Number(t.dataset.id);
      state.draft.qty_total = state.draft.lot_size = '';
      return render();
    }
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
    if (act === 'collect') {
      const o = (state.orders || []).find(x => x.id === Number(t.dataset.id));
      if (o) openCollectSheet(o);
      return;
    }
    if (act === 'collect-confirm') return collect(Number(t.dataset.id));
    if (act === 'want-kind') { readWantDraft(); state.wantDraft.kind = t.dataset.kind; return render(); }
    if (act === 'fill') {
      const w = (state.wants || []).find(x => x.id === Number(t.dataset.id));
      if (w) openFillSheet(w);
      return;
    }
    if (act === 'fill-confirm') return fillWant(Number(t.dataset.id));
    if (act === 'npc-trade') {
      const o = npcOrderById(t.dataset.id, t.dataset.side);
      if (o) return openNpcSheet(o, t.dataset.side);
      return;
    }
    if (act === 'npc-confirm') return npcTrade(t.dataset.id, t.dataset.side);
    if (act === 'cancel-want') {
      if (!global.confirm('Cancel this wanted order? Gold not yet promised comes back to you.')) return;
      try {
        const r = await call('POST', `/api/market/wants/${t.dataset.id}/cancel`);
        toast(`Wanted order cancelled — ${fmt(r.refunded)} gold returned.`);
        if (typeof global.refreshResources === 'function') global.refreshResources();
      } catch (err) { toast(err.message, 'error'); }
      return switchTab('wanted');
    }
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
    else if (act === 'ih-porter') { state.ihPorter = Number(e.target.value); }
    else if (act === 'keeper') { setKeeper(e.target.dataset.venue, Number(e.target.value) || null); }
    else if (act === 'want-draft') updateWantSummary();
    else if (act === 'hide-npc') {
      state.hideNpc = !!e.target.checked;
      try { global.localStorage.setItem('kw_mk_hide_npc', state.hideNpc ? '1' : '0'); } catch (_) {}
      switchTab(state.tab);
    }
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
    if (e.target.dataset.act === 'search' || e.target.dataset.act === 'want-search') return onSearchInput(e.target);
    if (e.target.dataset.act === 'want-draft') return updateWantSummary();
    if (e.target.dataset.act === 'fill-qty') return updateFillSummary();
    if (e.target.dataset.act === 'npc-qty') return updateNpcSummary();
    if (e.target.dataset.act === 'collect-qty') {
      const id = Number((document.querySelector('#market-panel [data-act="collect-confirm"]') || { dataset: {} }).dataset.id);
      const o = (state.orders || []).find(x => x.id === id);
      const n = Math.max(0, parseInt(e.target.value, 10) || 0);
      const el = byId('mk-collect-total');
      if (o && el) el.innerHTML = gold(o.unit_price * n);
      return;
    }
    if (e.target.dataset.act !== 'draft') return;
    readDraft();
    updateSellSummary();
  }

  function onSubmit(e) {
    if (e.target.dataset.form === 'want') { e.preventDefault(); return postWant(); }
    if (e.target.dataset.form !== 'sell') return;
    e.preventDefault();
    submitSell();
  }

  // Escape peels one layer: the level popover, then a confirm sheet, then the
  // panel — but never while typing in a field.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !isOpen()) return;
    if (setPop(false)) return;
    const w = byId('mk-sheet-wrap');
    if (w && w.classList.contains('open')) return closeSheet();
    const a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && byId('market-panel').contains(a)) return;
    closeMarket();
  });

  // ⓘ level popover: hover/focus on desktop, tap to pin on phones.
  let popPinned = false;
  function setPop(on) {
    const p = byId('mk-pop');
    if (!p) return false;
    const was = p.classList.contains('open');
    p.classList.toggle('open', !!on);
    if (!on) popPinned = false;
    p.classList.toggle('pinned', !!on && popPinned);
    return was && !on;
  }
  document.addEventListener('mouseover', e => {
    if (!isOpen() || popPinned) return;
    setPop(!!(e.target.closest && e.target.closest('.mk-info')));
  });
  document.addEventListener('focusin', e => { if (isOpen() && e.target.classList && e.target.classList.contains('mk-info')) setPop(true); });
  // Charts are drawn to their container's width: redraw when it changes.
  let resizeT = null;
  global.addEventListener && global.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (isOpen() && state.tab === 'ledger') drawCharts(); }, 150);
  });

  document.addEventListener('click', e => {
    if (!isOpen() || !e.target.closest) return;
    if (e.target.closest('.mk-info')) { popPinned = !popPinned; setPop(popPinned); return; }
    if (!e.target.closest('.mk-pop')) setPop(false);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isOpen()) softRefresh(); });

  // ── Realtime (js/realtime.js HANDLERS) ──────────────────────────────────

  function onMarketEvent(ev) {
    const res = ev.item ? `× ${ev.item.name}` : RES_LABEL[ev.resource] ? RES_LABEL[ev.resource].toLowerCase() : '';
    if (ev.type === 'market_purchase') toast(`⚖️ ${ev.buyer || 'Someone'} bought ${fmt(ev.qty)} ${res} — your merchant has set off.`);
    else if (ev.type === 'market_delivery') toast(`📦 ${fmt(ev.qty)} ${res} arrived from the market.`);
    else if (ev.type === 'market_return') toast(`💰 Your merchant is home with ${fmt(ev.gold)} gold.`);
    else if (ev.type === 'market_want_filling') toast(`📮 ${ev.seller || 'A town'} is sending ${fmt(ev.qty)} ${res} for your wanted order.`);
    else if (ev.type === 'market_want_expired') toast(`⌛ A wanted order expired — ${fmt(ev.gold)} gold returned.`);
    else if (ev.type === 'market_pickup_coming') toast(`🛒 ${ev.buyer || 'A town'} sent a porter to buy ${fmt(ev.qty)} ${res}.`);
    else if (ev.type === 'market_sale') toast(`💰 Sold ${fmt(ev.qty)} ${res} from your stall — ${fmt(ev.gold)} gold.`);
    else if (ev.type === 'market_porter_home' && ev.kind === 'npc') toast(`🏘️ Your porter is back from ${ev.target || 'the village'}${ev.side === 'buy' ? ` with ${fmt(ev.qty)} ${res}` : ` with ${fmt(ev.gold)} gold`}.`
      + (ev.trust_gained ? ` +${ev.trust_gained} trust with ${ev.target}.` : '') + (ev.request_done ? ` 🤝 Request filled — ${ev.target} is grateful!` : ''));
    else if (ev.type === 'market_porter_home') toast(ev.kind === 'ironhaven' ? `🏰 Your porter is back from Ironhaven with ${fmt(ev.gold)} gold.`
      : ev.failed ? `🧺 Your porter came back empty-handed — ${fmt(ev.gold)} gold returned.` : `🧺 Your porter is home with ${fmt(ev.qty)} ${res}.`);
    else if (ev.type === 'market_order_expired') toast(`⌛ A sell order expired — ${fmt(ev.qty)} ${res} returned to you.`);
    if (['market_delivery', 'market_return', 'market_order_expired', 'market_sale', 'market_porter_home'].includes(ev.type) && typeof global.refreshResources === 'function') {
      global.refreshResources();
    }
    // Items landed in (or came back to) the inventory.
    if (ev.item && ['market_delivery', 'market_order_expired', 'market_porter_home'].includes(ev.type) && typeof global.loadInventory === 'function') {
      try { global.loadInventory(); } catch (_) {}
    }
    if (isOpen()) scheduleRefresh(400);
    else if (ev.type !== 'market_trip_update' && ev.type !== 'market_run_update') setDot(true);
  }

  global.openMarket = openMarket;
  global.closeMarket = closeMarket;
  global.MarketUI = { open: openMarket, close: closeMarket, isOpen, onEvent: onMarketEvent, refresh: softRefresh,
    // pure helpers, for verify/market_proofs.js
    _prices: { goodKeyOf, qualityOfItem, dailySeries, sparkSvg, badgeHtml, deltaHtml, priceChartSvg, netChartSvg } };
})(window);
