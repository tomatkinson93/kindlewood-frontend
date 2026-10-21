'use strict';
// Market panel (community bar → js/market.js).
//   node verify/market_proofs.js
//   1. No Market: requirements (tier, buildings, cost chips that go red when
//      short), the level ladder, and a Build link that opens the Market plot.
//   2. Buy: orders with lot / price / per-unit / distance / ETA, paused
//      orders can't be bought, sort + filter go to the server, confirm sheet.
//   3. Sell: per-delivery cap from carry weight, guide price, fee preview,
//      over-cap / over-stock warnings.
//   4. Caravans: trips with countdowns, own orders with merchants + cancel.
//   5. Wiring: Market button → openMarket, map Trade button, realtime
//      handlers, mobile overlay list, versioned script/css tags.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

// ── Tiny DOM: elements by id are created on demand; the panel's listeners
// are kept so tests can fire actions at it. ──
function makeEl(id) {
  const classes = new Set();
  const listeners = {};
  return {
    id, innerHTML: '', textContent: '', style: {}, dataset: {}, className: '',
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : on ? classes.add(c) : classes.delete(c)),
    },
    _classes: classes, _listeners: listeners,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    querySelector: () => makeEl(), querySelectorAll: () => [],
    contains: () => false, appendChild() {}, setAttribute() {}, scrollIntoView() {},
  };
}
function makeEnv(routes) {
  const els = {}, toasts = [], calls = [], built = [];
  const getEl = id => (els[id] = els[id] || makeEl(id));
  let panel = null;
  const doc = {
    getElementById: id => (id === 'market-panel' ? panel : getEl(id)),
    createElement: () => (panel = makeEl('market-panel')),
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {}, body: { appendChild() {} }, activeElement: null, hidden: false,
  };
  const win = {
    document: doc, console, URLSearchParams, Date, Math, JSON, Number, String, Object, Array, Set,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    escHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    showBuildToast: (m, t) => toasts.push([m, t || 'success']),
    _liveResources: () => ({ food: 500, timber: 40, stone: 0, metal: 10, wealth: 120 }),
    _costChips: (cost, have) => Object.entries(cost).map(([r, v]) => `<span class="op-chip ${(have[r] ?? 0) < v ? 'op-chip-short' : ''}">${r} ${v}</span>`).join(''),
    openSettlementBuild: id => built.push(id),
    confirm: () => true,
    apiFetch: async (p, opts) => {
      calls.push([opts && opts.method || 'GET', p, opts && opts.body ? JSON.parse(opts.body) : null]);
      const key = Object.keys(routes).find(k => p.startsWith(k));
      const v = key ? routes[key] : { error: 'nope' };
      const body = typeof v === 'function' ? v(p, opts) : v;
      return { ok: !body.error, json: async () => body };
    },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('js/market.js'), win, { filename: 'js/market.js' });
  const body = () => getEl('mk-body').innerHTML;
  const fire = async (type, target) => { for (const fn of panel._listeners[type] || []) await fn({ target, preventDefault() {} }); };
  const fireEv = async (type, ev) => { for (const fn of panel._listeners[type] || []) await fn(ev); };
  const btn = (act, data) => {
    const t = { tagName: 'BUTTON', dataset: { act, ...(data || {}) } };
    t.closest = () => t;
    return t;
  };
  return { win, getEl, body, fire, fireEv, btn, toasts, calls, built, panel: () => panel };
}
const tick = () => new Promise(r => setImmediate(r));

const CAPS = { 1: { carryWeight: 100, maxOrders: 2 }, 2: { carryWeight: 200, maxOrders: 3 }, 3: { carryWeight: 350, maxOrders: 4 }, 4: { carryWeight: 550, maxOrders: 5 }, 5: { carryWeight: 800, maxOrders: 6 } };
const BASE = {
  ok: true, placed: true, tier: 'camp', activeOrders: 0, merchantsAssigned: 0,
  tradeable: ['food', 'timber', 'stone', 'metal'],
  unitWeight: { food: 0.5, timber: 1, stone: 1, metal: 2 },
  referencePrice: { food: 0.3, timber: 0.7, stone: 1, metal: 2 },
  levelCaps: CAPS,
  building: { id: 'market', label: 'Market', icon: '⚖️', desc: 'Traders bring wealth.', imgFile: 'market.png', maxLevel: 5,
    minTier: 'camp', levelTierReq: { 2: 'village', 3: 'town', 4: 'city', 5: 'city' }, cost: { timber: 60, food: 30 }, requires: [] },
  resources: { food: 500, timber: 40, stone: 0, metal: 10, wealth: 120 },
};
const LOCKED = { ...BASE, unlocked: false, mods: { marketLevel: 0, carryWeight: 0, merchants: 0, maxOrders: 0, feeRate: 0.05, expiryHours: 168 } };
const OPEN = { ...BASE, unlocked: true, mods: { marketLevel: 1, carryWeight: 100, merchants: 1, maxOrders: 2, feeRate: 0.05, expiryHours: 168, speedMult: 1 } };
const ORDERS = { ok: true, orders: [
  { id: 7, resource: 'timber', lot_size: 100, lot_price: 70, next_lot_qty: 100, next_lot_price: 70, unit_price: 0.7, qty_available: 250, qty_total: 250,
    seller: { id: 3, name: 'Oakhollow', username: 'bramble', species: 'Mice', tier: 'camp' }, distance: 6, merchants: 1, paused: false, eta_seconds: 270 },
  { id: 8, resource: 'metal', lot_size: 50, lot_price: 200, next_lot_qty: 50, next_lot_price: 200, unit_price: 4, qty_available: 50, qty_total: 100,
    seller: { id: 4, name: 'Stonebrook', username: 'flint', species: 'Moles', tier: 'town' }, distance: 11, merchants: 1, paused: true,
    next_free_at: new Date(Date.now() + 200e3).toISOString(), eta_seconds: 700 },
] };
const MINE = { ok: true, now: new Date().toISOString(),
  orders: [{ id: 5, resource: 'food', lot_size: 200, lot_price: 60, unit_price: 0.3, qty_total: 600, qty_escrowed: 400, status: 'active',
    expires_at: new Date(Date.now() + 5 * 86400e3 + 3600e3).toISOString(), merchants: [{ id: 21, name: 'Ash', scouting: 2, on_road: true }] }],
  trips: [
    { id: 1, order_id: 5, resource: 'food', qty: 200, gold_paid: 60, fee: 3, distance: 4, status: 'outbound', direction: 'selling',
      departs_at: new Date(Date.now() - 60e3).toISOString(), arrives_at: new Date(Date.now() + 120e3).toISOString(), returns_at: new Date(Date.now() + 300e3).toISOString(),
      seller_name: 'Home', buyer_name: 'Oakhollow', citizen_name: 'Ash' },
    { id: 2, order_id: 9, resource: 'stone', qty: 80, gold_paid: 90, fee: 4, distance: 9, status: 'outbound', direction: 'buying',
      departs_at: new Date(Date.now() - 60e3).toISOString(), arrives_at: new Date(Date.now() + 400e3).toISOString(), returns_at: new Date(Date.now() + 860e3).toISOString(),
      seller_name: 'Stonebrook', buyer_name: 'Home', citizen_name: 'Flint' },
  ],
  candidates: [{ id: 21, name: 'Ash', role: 'merchant', scouting: 2, busy: 'Ash is already a merchant.' }, { id: 22, name: 'Birch', role: 'farmer', scouting: 1, busy: null }],
  items: [
    { id: 71, item_key: 'fish_trout', name: 'Trout', icon: '🐡', category: 'fish', rarity: 'uncommon', quantity: 40, tradeable: true, reason: null, weight: 0.5, max_lot: 200, sell_value: 10 },
    { id: 72, item_key: 'iron_sword', name: 'Iron Sword', icon: '🗡', category: 'equipment', equip_slot: 'weapon', rarity: 'rare', quantity: 1, tradeable: true, reason: null, weight: 3, max_lot: 1, sell_value: 40 },
    { id: 73, item_key: 'relic', name: 'Old Relic', icon: '🏺', category: 'trophy', rarity: 'epic', quantity: 1, tradeable: false, reason: 'This item cannot be traded.', weight: 1, max_lot: 100, sell_value: 0 },
    { id: 74, item_key: 'worn', name: 'Worn Axe', icon: '🪓', category: 'equipment', equip_slot: 'tool', rarity: 'common', quantity: 1, tradeable: false, reason: 'Unequip it first.', weight: 2, max_lot: 1, sell_value: 3 },
  ],
};

(async () => {
  // 1 — locked
  {
    const env = makeEnv({ '/api/market/status': LOCKED });
    await env.win.openMarket();
    const b = env.body();
    check('1. no Market: "Build a Market" prompt', /Build a Market to start trading/.test(b) && /data-act="build-market"/.test(b));
    check('1b. lists the settlement level requirement', /Settlement level: any \(Camp or higher\)/.test(b));
    check('1c. cost chips from the server, red when short (40 timber < 60)', /op-chip op-chip-short">timber 60/.test(b) && /op-chip ">food 30/.test(b));
    check('1d. level ladder: tier gates, carry and merchants', /<td>Lv 2<\/td><td>Village<\/td>[\s\S]*?<td>200<\/td>/.test(b) && /<td>Lv 5<\/td><td>City<\/td>/.test(b));
    const lt = env.getEl('mk-tabs').innerHTML;
    check('1e. locked: only the Market (locked) and Ironhaven tabs', /data-tab="buy"/.test(lt) && /data-tab="ironhaven"/.test(lt) && !/data-tab="sell"/.test(lt));
    await env.fire('click', env.btn('build-market'));
    check('1f. Build link opens the Market plot', env.built[0] === 'market');
  }
  // 2 — buy
  {
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/orders?': ORDERS, '/api/market/orders/7/buy': { ok: true, wealth: 50, merchant: 'Ash', seller: 'Oakhollow', trip: { qty: 100, resource: 'timber' } } });
    await env.win.openMarket();
    const b = env.body();
    check('2. buy list: lot, price, per-unit, amount left', /🪵 100 timber[\s\S]*?🪙 70/.test(b) && /0\.70 gold \/ unit/.test(b) && /250 left/.test(b));
    check('2b. seller, distance and arrival time', /Oakhollow/.test(b) && /6 hexes away/.test(b) && /Arrives in ~4m 30s/.test(b));
    check('2c. paused order shows why and cannot be bought', /⏸ Paused — merchant back in/.test(b) && !/data-act="buy" data-id="8"/.test(b));
    check('2d. sort options: distance / price per unit / amount / arrival', /value="distance"[\s\S]*value="unit_price"[\s\S]*value="amount"[\s\S]*value="eta"/.test(b));
    await env.fire('change', { dataset: { act: 'sort' }, value: 'unit_price' });
    await env.fire('click', env.btn('cat', { cat: 'resources' }));
    check('2e0. Resources category shows the resource picker', /data-act="filter-resource"/.test(env.body()));
    await env.fire('change', { dataset: { act: 'filter-resource' }, value: 'timber' });
    const last = env.calls.filter(c => c[1].startsWith('/api/market/orders?')).pop()[1];
    check('2e. sort + filter go to the server', /sort=unit_price/.test(last) && /resource=timber/.test(last) && /dir=asc/.test(last));
    await env.fire('click', env.btn('filter-seller', { id: '3', name: 'Oakhollow' }));
    const sellerCall = env.calls.filter(c => c[1].startsWith('/api/market/orders?')).pop()[1];
    check('2f. clicking a seller filters to their town', /seller=3/.test(sellerCall) && /Only Oakhollow/.test(env.body()));
    await env.fire('click', env.btn('buy', { id: '7' }));
    const sh = env.getEl('mk-sheet-wrap').innerHTML;
    check('2g. confirm sheet: pay now, per unit, distance, arrival', /You pay now<\/span><b><span class="mk-gold">🪙 70/.test(sh) && /0\.70 gold/.test(sh) && /6 hexes/.test(sh) && /~4m 30s/.test(sh));
    await env.fire('click', env.btn('buy-confirm', { id: '7' }));
    await tick();
    check('2h. buying posts to the order and toasts the merchant', env.calls.some(c => c[0] === 'POST' && c[1] === '/api/market/orders/7/buy') && /Ash of Oakhollow is on the way/.test(env.toasts.map(t => t[0]).join()));
  }
  // 3 — sell
  {
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/mine': MINE });
    await env.win.openMarket({ tab: 'sell' });
    const b = env.body();
    check('3. sell form: per-delivery cap from carry weight (100 timber)', /Per delivery <em class="mk-muted">\(max 100\)/.test(b));
    check('3b. caps shown: orders, merchants, carry', /Orders <b>0 \/ 2/.test(b) && /Merchants <b>0 \/ 1/.test(b));
    const birch = (b.match(/<input[^>]*value="22"[^>]*>/) || [''])[0];
    check('3c. busy citizens are listed but cannot be picked', /mk-cand busy[\s\S]*?value="21"[^>]*disabled/.test(b) && birch && !/disabled/.test(birch));
    const sum = env.getEl('mk-sell-summary').innerHTML;
    check('3d. guide price for timber', /about <b>0\.70<\/b> gold per timber/.test(sum));
    // Price a draft and check the fee preview.
    env.win.document.querySelector = () => ({ resource: { value: 'timber' }, qty_total: { value: '500' }, lot_size: { value: '100' }, lot_price: { value: '80' } });
    await env.fire('input', { dataset: { act: 'draft' } });
    const s2 = env.getEl('mk-sell-summary').innerHTML;
    check('3e. 5 deliveries, 0.80 per unit, keep 76 after the 5% fee', /5 deliveries of up to 100/.test(s2) && /0\.80 gold per unit · you keep 76/.test(s2));
    check('3f. warns when listing more than you have (40 timber)', /You only have 40/.test(s2));
    env.win.document.querySelector = () => ({ resource: { value: 'metal' }, qty_total: { value: '10' }, lot_size: { value: '60' }, lot_price: { value: '80' } });
    await env.fire('input', { dataset: { act: 'draft' } });
    check('3g. warns when a delivery is over the carry limit (metal weighs 2)', /carries at most 50 metal/.test(env.getEl('mk-sell-summary').innerHTML));
  }
  // 3i — selling items
  {
    let posted = null;
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/mine': MINE,
      '/api/market/orders': (p, o) => { if (o && o.method === 'POST') posted = JSON.parse(o.body); return { ok: true, order: { id: 9 } }; } });
    await env.win.openMarket({ tab: 'sell' });
    await env.fire('click', env.btn('sell-mode', { mode: 'item' }));
    const b = env.body();
    check('3i. Items mode: inventory picker', /data-act="pick-item" data-id="71"/.test(b) && /Trout/.test(b) && /×40/.test(b));
    check('3j. untradeable and equipped items are greyed with the reason',
      /mk-item  off"[^>]*data-id="73"[\s\S]*?disabled[\s\S]*?cannot be traded/.test(b) && /data-id="74"[\s\S]*?Unequip it first/.test(b));
    await env.fire('click', env.btn('pick-item', { id: '72' }));
    const b2 = env.body();
    check('3k. items: just how many and price each — no merchants or lots', /How many/.test(b2) && /Price each/.test(b2) && !/data-act="pick-merchant"/.test(b2) && /Put on a stall/.test(b2));
    check('3l. town value and the Ironhaven price shown as a guide', /Town value <b>40<\/b> each — Ironhaven would pay about 12/.test(env.getEl('mk-sell-summary').innerHTML));
    env.win.document.querySelector = () => ({ qty_total: { value: '1' }, lot_size: { value: '1' }, lot_price: { value: '55' } });
    await env.fire('change', { dataset: { act: 'pick-merchant' }, value: '22', checked: true });
    await env.fire('submit', { dataset: { form: 'sell' } });
    await tick();
    check('3m. posts a stall listing', posted && posted.kind === 'item' && posted.inventory_id === 72 && posted.qty_total === 1 && posted.unit_price === 55 && !posted.citizen_ids);
  }
  // 2i — buying items
  {
    let picked = null;
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/orders?': { ok: true, orders: [
      { id: 31, kind: 'item', resource: null, item: { name: 'Iron Sword', icon: '🗡', rarity: 'rare', equip_slot: 'weapon', stat_bonuses: { combat: 2 } },
        lot_size: 1, lot_price: 60, next_lot_qty: 1, next_lot_price: 60, unit_price: 60, qty_available: 3, qty_total: 3, porter_max: 3,
        venue: 'market', venue_label: 'Market',
        seller: { id: 3, name: 'Oakhollow', username: 'bramble', species: 'Mice' }, distance: 4, merchants: 0, paused: false, eta_seconds: 360 }] },
      '/api/market/mine': MINE,
      '/api/market/orders/31/pickup': (p, o) => { picked = JSON.parse(o.body); return { ok: true, porter: 'Birch', seller: 'Oakhollow', run: { qty: 2, item: { name: 'Iron Sword' } } }; } });
    await env.win.openMarket();
    const b = env.body();
    check('2i. stall row: name in rarity colour, price each, stats, seller\'s venue', /color:#e8a020">Iron Sword<\/b>/.test(b) && /🪙 60<\/span> <span class="mk-for">each/.test(b) &&
      /weapon · rare · \+2 combat/.test(b) && /Oakhollow<\/button>'s Market/.test(b) && /round trip ~6m/.test(b));
    await env.fire('click', env.btn('collect', { id: '31' }));
    await tick();
    const cs = env.getEl('mk-sheet-wrap').innerHTML;
    check('2i2. Collect sheet: quantity (capped), free porters only, round trip', /id="mk-collect-qty" min="1" max="2"/.test(cs) && /<option value="22">Birch/.test(cs) && !/<option value="21"/.test(cs) && /~6m/.test(cs));
    env.getEl('mk-collect-qty').value = '2'; env.getEl('mk-collect-porter').value = '22';
    await env.fire('click', env.btn('collect-confirm', { id: '31' }));
    await tick();
    check('2i3. sends the porter for 2', picked && picked.qty === 2 && picked.citizen_id === 22 && /Birch set off for Oakhollow to collect 2× Iron Sword/.test(env.toasts.map(t => t[0]).join()));
    check('2j. category buttons with icons', ['⚔️', '🛡️', '🔨', '💍', '🐟', '🍖', '🪨', '🏆', '📦'].every(i => b.includes(i)) && /data-act="cat" data-cat="weapon"/.test(b));
    await env.fire('click', env.btn('cat', { cat: 'weapon' }));
    const cq = env.calls.filter(c => c[1].startsWith('/api/market/orders?')).pop()[1];
    check('2j2. picking a category filters on the server', /category=weapon/.test(cq));
    await env.fire('click', env.btn('buy', { id: '31' }));
    check('2k. confirm sheet names the item', /Buy 🗡 1× Iron Sword\?/.test(env.getEl('mk-sheet-wrap').innerHTML));
  }
  // 2l — search autocomplete
  {
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/orders?': ORDERS,
      '/api/market/catalog': { ok: true, items: [
        { item_key: 'iron_sword', name: 'Iron Sword', icon: '🗡', cat: 'weapon', rarity: 'common' },
        { item_key: 'iron_shield', name: 'Iron Shield', icon: '🛡', cat: 'armour', rarity: 'uncommon' }] } });
    // Timers run straight away in this harness.
    env.win.setTimeout = (fn) => { fn(); return 1; };
    await env.win.openMarket();
    check('2l. search box (combobox) on the Buy tab', /id="mk-search"[^>]*role="combobox"/.test(env.body()));
    const input = { dataset: { act: 'search' }, value: 'ir' };
    await env.fire('input', { target: input, ...input });
    await tick();
    check('2m. under 3 letters: no lookup', !env.calls.some(c => c[1].startsWith('/api/market/catalog')));
    input.value = 'iro';
    await env.fire('input', input);
    await tick(); await tick();
    const sug = env.getEl('mk-suggest').innerHTML;
    check('2n. "iro" suggests Iron Sword and Iron Shield with icons', env.calls.some(c => /catalog\?q=iro/.test(c[1])) && /Iron Sword/.test(sug) && /Iron Shield/.test(sug) && /🗡/.test(sug));
    let prevented = false;
    const sbox = { dataset: { act: 'search' } };
    await env.fireEv('keydown', { target: sbox, key: 'ArrowDown', preventDefault() { prevented = true; }, stopPropagation() {} });
    check('2o. arrow keys move the highlight', /class="on"[^>]*data-i="1"/.test(env.getEl('mk-suggest').innerHTML) && prevented);
    await env.fireEv('keydown', { target: sbox, key: 'Enter', preventDefault() {}, stopPropagation() {} });
    await tick();
    const iq = env.calls.filter(c => c[1].startsWith('/api/market/orders?')).pop()[1];
    check('2p. Enter picks it and filters to that item', /item_key=iron_shield/.test(iq) && /Showing Iron Shield/.test(env.body()));
  }
  // 2q — Ironhaven
  {
    let posted = null;
    const IH = { ok: true, now: new Date().toISOString(),
      ironhaven: { name: 'Ironhaven', q: 0, r: 0, distance: 12, leg_seconds: 540 },
      week_ends: new Date(Date.now() + 3 * 86400e3 - 1000).toISOString(), rate: 0.3, want_rate: 0.6, porter_carry: 20,
      wants: [{ item_key: 'fish_trout', name: 'Trout', icon: '🐡', cat: 'fish', unit_price: 6 }],
      items: [
        { id: 71, name: 'Trout', icon: '🐡', rarity: 'uncommon', quantity: 50, cat: 'fish', tradeable: true, wanted: true, unit_price: 6, player_price: 9.5, max_qty: 40 },
        { id: 73, name: 'Old Relic', icon: '🏺', rarity: 'epic', quantity: 1, cat: 'trophy', tradeable: false, reason: 'This item cannot be traded.', unit_price: 1, max_qty: 1 }],
      candidates: [{ id: 22, name: 'Birch', scouting: 1, busy: null }, { id: 21, name: 'Ash', scouting: 2, busy: 'Ash is busy at the Market.' }],
      runs: [] };
    const env = makeEnv({ '/api/market/status': LOCKED, '/api/market/ironhaven/sell': (p, o) => { posted = JSON.parse(o.body); return { ok: true, gold: 60, porter: 'Birch', run: { qty: 10, item: { name: 'Trout' } } }; },
      '/api/market/ironhaven': IH });
    await env.win.openMarket({ tab: 'ironhaven', item: 71 });
    const b = env.body();
    check('2q. Ironhaven works without a Market', /buys almost anything/.test(b) && /30% of an item/.test(b));
    check('2r. weekly wants listed at the better price', /Ironhaven wants this week/.test(b) && /new list in 3 days/.test(b) && /Trout[\s\S]*?🪙 6/.test(b));
    check('2s. offers next to the player price; porter cap as the max', /Players list from 9\.50/.test(b) && /data-ih-qty="71" min="1" max="40" value="40"/.test(b));
    check('2t. untradeable items greyed with the reason', /mk-ih-row off[\s\S]*?cannot be traded/.test(b) && !/data-act="ih-sell" data-id="73"/.test(b));
    check('2u. only free citizens offered as porters', /<option value="22"/.test(b) && !/<option value="21"/.test(b));
    check('2v. opened from the inventory: the row is highlighted', /mk-ih-row\s+wanted focus" data-row="71"/.test(b));
    env.win.document.querySelector = () => ({ value: '10' });
    await env.fire('click', env.btn('ih-sell', { id: '71' }));
    await tick();
    check('2w. Send posts item, quantity and porter', posted && posted.inventory_id === 71 && posted.qty === 10 && posted.citizen_id === 22 &&
      /Birch set off for Ironhaven/.test(env.toasts.map(t => t[0]).join()));
  }
  // 3n — shops
  {
    let patched = null;
    const STALLS = {
      smithy: { label: 'Smithy', level: 1, slots: 4, used: 1, free: 0, sells: ['weapon', 'armour', 'tool'], needs_keeper: true, keeper: null, open: false },
      jeweller: { label: 'Jeweller', level: 0, slots: 0, used: 0, free: 0, sells: ['trinket', 'trophy'], needs_keeper: true, keeper: null, open: false },
      fishing_post: { label: 'Fishing Post', level: 2, slots: 4, used: 0, free: 4, sells: ['fish', 'food'], needs_keeper: true, keeper: { id: 9, name: 'Marsh' }, open: true },
      market: { label: 'Market', level: 1, slots: 2, used: 0, free: 2, sells: null, needs_keeper: false, keeper: null, open: true },
    };
    const mine = { ...MINE, stalls: STALLS, orders: [{ id: 50, kind: 'item', venue: 'smithy', item_snapshot: { name: 'Iron Sword', icon: '🗡', rarity: 'rare' },
      lot_size: 1, lot_price: 45, qty_total: 1, qty_escrowed: 1, qty_reserved: 0, status: 'active', unit_price: 45, merchants: [],
      expires_at: new Date(Date.now() + 86400e3 * 6).toISOString() }] };
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/mine': mine,
      '/api/market/shops/': (p, o) => { patched = [p, JSON.parse(o.body)]; return { ok: true }; },
      '/api/market/shops': { ok: true, stalls: STALLS, candidates: MINE.candidates } });
    await env.win.openMarket({ tab: 'shops' });
    const b = env.body();
    check('3n. Shops tab: each shop with stalls used and what it sells', /Smithy[\s\S]*?stalls <b>1 \/ 4/.test(b) && /Fishing Post[\s\S]*?🐟/.test(b));
    check('3o. a shop with no keeper is closed and says why', /mk-shop closed[\s\S]*?Smithy[\s\S]*?Nobody is minding this shop/.test(b));
    check('3p. unbuilt shops offer a Build button', /Jeweller[\s\S]*?data-act="build-shop" data-building="jeweller"/.test(b));
    check('3q. listings show under their shop', /Smithy[\s\S]*?Iron Sword[\s\S]*?Jeweller/.test(b));
    check('3r. keeper picker lists free citizens only', /data-act="keeper" data-venue="smithy"[\s\S]*?<option value="22">Birch/.test(b) && !/data-venue="smithy"[\s\S]*?<option value="21">/.test(b.split('Jeweller')[0]));
    await env.fire('change', { dataset: { act: 'keeper', venue: 'smithy' }, value: '22' });
    await tick();
    check('3s. picking a keeper saves it', patched && /\/api\/market\/shops\/smithy\/keeper/.test(patched[0]) && patched[1].citizen_id === 22);
    await env.fire('click', env.btn('sell-mode', { mode: 'item' }));
  }
  // 4 — caravans
  {
    const env = makeEnv({ '/api/market/status': { ...OPEN, activeOrders: 1, merchantsAssigned: 1 }, '/api/market/mine': MINE, '/api/market/orders/5/cancel': { ok: true, refunded: 400 } });
    await env.win.openMarket({ tab: 'caravans' });
    const b = env.body();
    check('4. merchant carrying goods out, with a progress bar', /Ash is carrying 200 food to Oakhollow/.test(b) && /mk-bar-fill/.test(b));
    check('4b. incoming goods from another town', /80 stone on the way from Stonebrook/.test(b));
    check('4c. own order: waiting amount, expiry, merchant on the road', /400 of 600 waiting/.test(b) && /expires in 5d/.test(b) && /mk-merchant road/.test(b));
    check('4d. no "add merchant" when every slot is used', !/data-act="add-merchant"/.test(b));
    check('4g. Caravans no longer carries the "Your Market" section', !/<h3>Your Market<\/h3>/.test(b));
    const pop = env.getEl('mk-pop').innerHTML;
    check('4h. ⓘ popover holds the level table', /Your Market · Level 1/.test(pop) && /<td>Lv 3<\/td><td>Town<\/td>/.test(pop) && /data-act="info"/.test(env.getEl('mk-sub').innerHTML));
    check('4i. clicking the backdrop does not close the panel', !(env.panel()._listeners.click || []).some(fn => /e\.target === el/.test(String(fn))));
    await env.fire('click', env.btn('cancel', { id: '5' }));
    check('4e. cancel posts and reports the refund', env.calls.some(c => c[1] === '/api/market/orders/5/cancel') && /400 returned/.test(env.toasts.map(t => t[0]).join()));
  }
  // 4f — realtime event while closed lights the dot
  {
    const env = makeEnv({ '/api/market/status': OPEN });
    env.win.MarketUI.onEvent({ type: 'market_return', gold: 67, resource: 'timber', qty: 100 });
    check('4f. realtime: merchant home → toast, dot on the Market button', /home with 67 gold/.test(env.toasts[0][0]) && env.getEl('nav-market')._classes.has('has-dot'));
  }

  // 5 — wiring
  const html = read('index.html'), main = read('js/main.js'), rt = read('js/realtime.js'), shell = read('js/mobile-shell.js');
  check('5. Market button has an id and still routes through showCommunityTab', /id="nav-market" onclick="showCommunityTab\('market'\)"/.test(html));
  check('5b. showCommunityTab opens the Market panel', /tab === 'market' && typeof openMarket === 'function'/.test(main));
  check('5c. map town panel offers Trade when the server says so', /s\.can_trade && s\.settlement_id/.test(main) && /openMarket\(\{seller:/.test(main));
  check('5d. realtime handlers for every market event', ['market_purchase', 'market_delivery', 'market_return', 'market_trip_update', 'market_order_expired'].every(t => rt.includes(t + '(ev)')));
  check('5e. mobile shell hides the tab bar over the panel', /'market-panel'/.test(shell));
  check('5f. versioned market.js + market.css tags', /\/js\/market\.js\?v=\w+/.test(html) && /\/css\/market\.css\?v=\w+/.test(html));
  const ia = read('js/item_admin.js');
  check('5i. Dev Tools: Tradeable checkbox, ticked unless the item says otherwise', /id="ia-tradeable"' \+ \(item\?\.tradeable === false \? '' : ' checked'\)/.test(ia));
  check('5j. Dev Tools: save sends tradeable through /api/game/items (POST new, PATCH edit)',
    /tradeable:\s+document\.getElementById\('ia-tradeable'\)/.test(ia) && /_iaFetch\(path, \{ method/.test(ia) && !/'\/api\/item-admin'/.test(ia));
  const inv = read('js/inventory.js');
  check('5k. inventory: no instant sell — List at Market / Sell to Ironhaven instead',
    !/\/sell'/.test(inv) && /invSellVia\(\\'market\\'/.test(inv) && /invSellVia\(\\'ironhaven\\'/.test(inv) && !/invSellAll/.test(inv));
  check('5h. fixed-size window (tabs never resize it)', /\.mk-card \{[\s\S]*?height: min\(760px, 88vh\)/.test(read('css/market.css')));
  check('5g. settlement view exposes openSettlementBuild', /window\.openSettlementBuild = openSettlementBuild/.test(read('js/settlement-view.js')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
