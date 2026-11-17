// ══════════════════════════════════════════════════════════════════════════
//  KWMerchant — a visiting merchant (docs/HOME_SCENE.md Part F, F.13; step 25).
//
//  About once every four days a merchant's cart stands in Town for one game
//  day. Clicking it opens three or four trades (goods for wealth, wealth
//  for goods, goods for goods), each a little better than the going rate
//  and each to be taken once.
//
//  The server decides when the merchant comes, what they offer and what has
//  been taken (lib/merchant.js there). This file reads it (GET
//  /api/merchant), draws the cart, shows the trades and sends each one.
//
//  The cart is drawn by code until its picture arrives (docs/ART_GUIDE.md
//  §8, batch Q): an entry `merchant_cart` in the props manifest replaces it.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const S = { data: null, loading: null, busy: false, timer: null };
  const PAINT_MS = 1500, INK = '#3b2a1a';
  const ICON = { food: '🌾', timber: '🪵', stone: '🪨', metal: '⛓️', wealth: '🪙' };
  const NAME = { food: 'food', timber: 'timber', stone: 'stone', metal: 'iron', wealth: 'wealth' };
  // Where the cart may stand in Town, best first (percent of the scene): the lanes between the buildings, then the front.
  const SPOTS = [{ x: 48.5, y: 74 }, { x: 29.5, y: 72 }, { x: 67.5, y: 72 }, { x: 58, y: 90 }, { x: 40, y: 90 }, { x: 80, y: 88 }, { x: 20, y: 88 }];
  const o = `stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;
  const CART = { w: 104, h: 86, html: `<svg width="104" height="86" viewBox="0 0 104 86" aria-hidden="true" focusable="false">`
    + `<ellipse cx="52" cy="81" rx="46" ry="4" fill="rgba(40,30,20,.24)"/>`
    + `<path d="M14 30V12M90 30V12" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
    + `<path d="M6 14h92l-6 12H12z" fill="#c9463a" ${o}/><path d="M26 14l-3 12M44 14l-1 12M62 14l1 12M80 14l3 12" fill="none" stroke="#f6e7c1" stroke-width="7"/>`
    + `<path d="M6 14h92l-6 12H12z" fill="none" ${o}/>`
    + `<rect x="10" y="38" width="84" height="26" rx="4" fill="#b5743a" ${o}/><path d="M10 47h84M10 56h84" fill="none" stroke="${INK}" stroke-width="1.6"/>`
    + `<circle cx="24" cy="36" r="6" fill="#e2574c" ${o}/><circle cx="38" cy="35" r="6.5" fill="#f2c14e" ${o}/><rect x="48" y="28" width="12" height="11" rx="2" fill="#8cc9ee" ${o}/><path d="M66 38l6-11 6 11z" fill="#7dbb5a" ${o}/><circle cx="84" cy="36" r="5" fill="#c58bff" ${o}/>`
    + `<circle cx="28" cy="68" r="11" fill="#7a5a3a" ${o}/><circle cx="28" cy="68" r="3" fill="${INK}"/><circle cx="76" cy="68" r="11" fill="#7a5a3a" ${o}/><circle cx="76" cy="68" r="3" fill="${INK}"/>`
    + `<path d="M28 57v22M17 68h22M76 57v22M65 68h22" fill="none" stroke="${INK}" stroke-width="1.6"/></svg>` };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  const amount = obj => Object.entries(obj || {}).map(([k, v]) => `${ICON[k] || ''} ${v} ${NAME[k] || k}`.trim()).join(' + ');
  // When the merchant next comes, in words. `ms`: until then.
  function nextLine(ms) {
    const h = Math.max(0, ms) / 3600000;
    return h < 1 ? 'The merchant comes within the hour.' : h < 24 ? `The merchant comes in about ${Math.round(h)} hours.` : `The merchant comes in about ${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'}.`;
  }
  // The first spot nothing stands on. `covered(p)` → true when something does. Pure.
  const spotFor = covered => SPOTS.find(p => !covered(p)) || SPOTS[0];
  function tradesHtml(d, stock) {
    if (!d || !d.here) return '<p class="kwm-none">The merchant is not in town.</p>';
    const left = d.trades.filter(t => !t.taken).length;
    return `<p class="kwm-intro">${left ? 'Each trade can be made once. The merchant leaves at dawn.' : 'You have made every trade. The merchant leaves at dawn.'}</p>`
      + d.trades.map(t => {
        const short = Object.entries(t.give).find(([k, v]) => (Number((stock || {})[k]) || 0) < v);
        const why = t.taken ? 'Done' : short ? `Not enough ${NAME[short[0]] || short[0]}` : '';
        return `<div class="kwm-trade${t.taken ? ' kwm-taken' : ''}"><div class="kwm-sides"><span class="kwm-give"><small>You give</small>${esc(amount(t.give))}</span><span class="kwm-arrow" aria-hidden="true">→</span>`
          + `<span class="kwm-get"><small>You get</small>${esc(amount(t.get))}</span></div>`
          + `<button type="button" class="kwm-btn" data-action="take" data-idx="${t.idx}"${t.taken || short ? ' disabled' : ''} aria-label="${esc(t.line)}${why ? ' ' + esc(why) + '.' : ''}">${t.taken ? '✓ Done' : short ? esc(why) : 'Trade'}</button></div>`;
      }).join('');
  }

  // ── Data ────────────────────────────────────────────────────────────────
  const signedIn = () => { try { return !!global.localStorage.getItem('kw_token'); } catch (_) { return false; } };
  const stock = () => { const g = global.gameData; return (g && g.settlement && g.settlement.resources) || {}; };
  function take(d) {
    S.data = d || null;
    paint();
    const W = global.KWWindow && global.KWWindow.get && global.KWWindow.get('merchant');
    if (W) { if (S.data && S.data.here) W.refresh(); else global.KWWindow.close('merchant'); }
    try { global.dispatchEvent(new global.CustomEvent('kw:merchant', { detail: { here: !!(S.data && S.data.here) } })); } catch (_) { /* old browser */ }
  }
  async function load() {
    if (!signedIn() || typeof global.apiFetch !== 'function') return null;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      try { const r = await global.apiFetch('/api/merchant'); if (r.ok) { const d = await r.json(); if (d && d.ok && d.merchant) take(d.merchant); } } catch (_) { /* later */ }
      S.loading = null;
      return S.data;
    })();
    return S.loading;
  }
  async function trade(idx) {
    if (S.busy) return;
    S.busy = true;
    try {
      const r = await global.apiFetch('/api/merchant/take', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idx }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        if (typeof global.refreshResources === 'function') { try { await global.refreshResources(); } catch (_) { /* later */ } }
        take(d.merchant);
        toast(`🛒 Traded: ${amount(d.trade.give)} for ${amount(d.trade.get)}.`, 'success');
      } else { toast('⚠️ ' + (d.error || 'That did not work. Try again.')); load(); }
    } catch (_) { toast('⚠️ That did not work. Try again.'); } finally { S.busy = false; }
  }

  // ── The window ──────────────────────────────────────────────────────────
  function open() {
    const W = global.KWWindow;
    if (!W || !S.data || !S.data.here) return;
    W.open({
      id: 'merchant', icon: '🛒', size: 'M', title: 'The travelling merchant', subtitle: 'Here until dawn',
      render(body) { body.innerHTML = `<div class="kwm">${tradesHtml(S.data, stock())}</div>`; },
      actions: { take(el) { trade(Number(el.dataset.idx)); } },
    });
  }

  // ── The scene ───────────────────────────────────────────────────────────
  const homeOpen = () => typeof global._svIsOpen === 'function' && global._svIsOpen();
  const artOf = () => {
    const G = global.KWGround, m = G && G.manifest && G.manifest.props && G.manifest.props.merchant_cart;
    return m && m.file && m.w > 0 && m.h > 0 ? { w: m.w, h: m.h, html: `<img src="${esc(G.BASE + m.file)}" class="kwh-img kwh-day" alt="" draggable="false" style="width:${m.w}px;height:${m.h}px">` } : CART;
  };
  function covered(L, p) {
    const lr = L.getBoundingClientRect();
    if (!lr.width || !lr.height) return false;
    const x = lr.left + p.x / 100 * lr.width, y = lr.top + p.y / 100 * lr.height, k = lr.width / (L.clientWidth || lr.width);
    for (const a of L.querySelectorAll(':scope > .sv-slot:not([hidden]) .kwh-art, :scope > .kwd-item, :scope > .sv-slot:not([hidden]) .kwh-plate')) {
      const r = a.getBoundingClientRect();
      if (x > r.left - 60 * k && x < r.right + 60 * k && y > r.top - 10 * k && y < r.bottom + 50 * k) return true;
    }
    return false;
  }
  function paint() {
    if (!doc) return;
    const view = doc.getElementById('settlement-view');
    if (!view) return;
    const old = view.querySelector('.kwm-cart'), d = S.data;
    const area = global._svActiveAreaName ? global._svActiveAreaName() : 'town';
    const L = homeOpen() && area === 'town' ? view.querySelector('#sv-layer-fg-town') : null;
    if (!d || !d.here || !L || !L.clientHeight) { if (old) old.remove(); return; }
    const left = d.trades.filter(t => !t.taken).length;
    if (old && old.parentNode === L) { old.classList.toggle('kwm-done', !left); const b = old.querySelector('.kwm-badge'); if (b) b.textContent = left ? String(left) : '✓'; return; }
    if (old) old.remove();
    const a = artOf(), p = spotFor(q => covered(L, q));
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'kwm-cart' + (left ? '' : ' kwm-done');
    b.setAttribute('aria-label', `The travelling merchant's cart: ${left} trade${left === 1 ? '' : 's'} to make. Open`);
    b.style.cssText = `left:${p.x}%;top:${p.y}%;width:${a.w}px;height:${a.h}px;z-index:${Math.max(1, Math.round(p.y * 10))}`;
    b.innerHTML = `${a.html}<span class="kwm-plate" aria-hidden="true">Merchant</span><span class="kwm-badge" aria-hidden="true">${left ? left : '✓'}</span>`;
    b.addEventListener('click', e => { e.stopPropagation(); open(); });
    L.appendChild(b);
  }

  if (doc) {
    S.timer = setInterval(() => { if (homeOpen() && !doc.hidden) paint(); }, PAINT_MS);
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) { load(); setTimeout(paint, 80); } });
    // The day turns: ask again when the cart is due to leave, or to arrive.
    setInterval(() => { const d = S.data; if (!d || !homeOpen() || doc.hidden) return; const t = d.here ? d.leaves_at : d.next_at; if (t && Date.now() > t) load(); }, 60000);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(load, 1900)); else setTimeout(load, 1900);
  }

  global.KWMerchant = {
    load, open, CART, SPOTS,
    get data() { return S.data; },
    // For the news (js/crier.js): here today, or when they next come.
    line: () => { const d = S.data; return !d ? '' : d.here ? d.line : (d.next_at ? nextLine(d.next_at - Date.now()) : ''); },
    onEvent: () => load(),   // a trade made on another device (js/realtime.js)
    _amount: amount, _nextLine: nextLine, _spotFor: spotFor, _tradesHtml: tradesHtml, _paint: paint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
