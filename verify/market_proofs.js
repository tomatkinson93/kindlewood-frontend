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
//   6. NPC village traders: badged rows in Buy / Wanted, buy and sell sheets,
//      the "Hide NPC traders" toggle (remembered, sent as npc=0), return toast.
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
function makeEnv(routes, store) {
  const els = {}, toasts = [], calls = [], built = [];
  store = store || {};
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
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
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
  return { win, getEl, body, fire, fireEv, btn, toasts, calls, built, store, panel: () => panel };
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
    check('2. buy list: lot, price, per-unit, amount left', /<img[^>]*woodicon\.png[^>]*> 100 timber[\s\S]*?<img[^>]*goldicon\.png[^>]*> 70/.test(b) && /0\.70 gold \/ unit/.test(b) && /250 left/.test(b));
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
    check('2g. confirm sheet: pay now, per unit, distance, arrival', /You pay now<\/span><b><span class="mk-gold"><img[^>]*goldicon\.png[^>]*> 70/.test(sh) && /0\.70 gold/.test(sh) && /6 hexes/.test(sh) && /~4m 30s/.test(sh));
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
      '/api/market/orders/31/pickup': (p, o) => { picked = JSON.parse(o.body); return { ok: true, porter: 'Birch', seller: 'Oakhollow', run: { id: 77, qty: 2, item: { name: 'Iron Sword' }, returns_at: new Date(Date.now() + 1530e3).toISOString() } }; } });
    await env.win.openMarket();
    const b = env.body();
    check('2i. stall row: name in rarity colour, price each, stats, seller\'s venue', /color:#e8a020">Iron Sword<\/b>/.test(b) && /<img[^>]*goldicon\.png[^>]*> 60<\/span> <span class="mk-for">each/.test(b) &&
      /weapon · rare · \+2 combat/.test(b) && /Oakhollow<\/button>'s Market/.test(b) && /round trip ~6m/.test(b));
    await env.fire('click', env.btn('collect', { id: '31' }));
    await tick();
    const cs = env.getEl('mk-sheet-wrap').innerHTML;
    check('2i2. Collect sheet: quantity (capped), free porters only, round trip', /id="mk-collect-qty" min="1" max="2"/.test(cs) && /<option value="22">Birch/.test(cs) && !/<option value="21"/.test(cs) && /~6m/.test(cs));
    env.getEl('mk-collect-qty').value = '2'; env.getEl('mk-collect-porter').value = '22';
    await env.fire('click', env.btn('collect-confirm', { id: '31' }));
    await tick();
    check('2i3. sends the porter for 2', picked && picked.qty === 2 && picked.citizen_id === 22 && /Birch is walking to Oakhollow to collect 2× Iron Sword — back in ~25m/.test(env.toasts.map(t => t[0]).join()) &&
      env.calls.some(c => c[1] === '/api/market/mine'));
    check('2j. category buttons with icons, no Trophies, ten in all', ['⚔️', '🛡️', '🔨', '💍', '🐟', '🍖', '📦'].every(i => b.includes(i)) && /stoneicon\.png/.test(b) && /woodicon\.png/.test(b) && !/data-cat="trophy"/.test(b) && (b.match(/data-act="cat"/g) || []).length === 10 && /data-act="cat" data-cat="weapon"/.test(b) && !/🪵|🪨|🪙/.test(b));
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
    const env = makeEnv({ '/api/market/status': LOCKED, '/api/market/ironhaven/sell': (p, o) => { posted = JSON.parse(o.body); return { ok: true, gold: 60, porter: 'Birch', run: { id: 78, qty: 10, item: { name: 'Trout' }, returns_at: new Date(Date.now() + 600e3).toISOString() } }; },
      '/api/market/ironhaven': IH });
    await env.win.openMarket({ tab: 'ironhaven', item: 71 });
    const b = env.body();
    check('2q. Ironhaven works without a Market', /buys almost anything/.test(b) && /30% of an item/.test(b));
    check('2r. weekly wants listed at the better price', /Ironhaven wants this week/.test(b) && /new list in 3 days/.test(b) && /Trout[\s\S]*?<img[^>]*goldicon\.png[^>]*> 6/.test(b));
    check('2s. offers next to the player price; porter cap as the max', /Players list from 9\.50/.test(b) && /data-ih-qty="71" min="1" max="40" value="40"/.test(b));
    check('2t. untradeable items greyed with the reason', /mk-ih-row off[\s\S]*?cannot be traded/.test(b) && !/data-act="ih-sell" data-id="73"/.test(b));
    check('2u. only free citizens offered as porters', /<option value="22"/.test(b) && !/<option value="21"/.test(b));
    check('2v. opened from the inventory: the row is highlighted', /mk-ih-row\s+wanted focus" data-row="71"/.test(b));
    env.win.document.querySelector = () => ({ value: '10' });
    await env.fire('click', env.btn('ih-sell', { id: '71' }));
    await tick();
    check('2w. Send posts item, quantity and porter', posted && posted.inventory_id === 71 && posted.qty === 10 && posted.citizen_id === 22 &&
      /Birch is walking to Ironhaven with 10× Trout — back in ~10m with 60 gold/.test(env.toasts.map(t => t[0]).join()));
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
  // 3n — NPC village traders
  {
    const ends = new Date(Date.now() + 5 * 3600e3).toISOString();
    const npcSell = { id: 'npc:12:s0', npc_order: true, order_key: 's0', npc: { id: 12, name: 'Bramblehollow', species: 'mice', trust: 45, tier: 'Friendly' },
      kind: 'resource', resource: 'food', item: null, price: 31, per: 100, unit_price: 0.31, qty_available: 300, qty_total: 300, carry_max: 200,
      distance: 5, eta_seconds: 450, expires_at: ends, seller: { id: null, name: 'Bramblehollow', username: 'village', species: 'mice' } };
    const npcBuy = { id: 'npc:12:b0', npc_order: true, order_key: 'b0', npc: { id: 12, name: 'Bramblehollow', species: 'mice', trust: 45, tier: 'Friendly' },
      kind: 'item', resource: null, item: { item_key: 'iron_pick', name: 'Iron Pick', icon: '⛏', rarity: 'common', cat: 'tool' }, item_key: 'iron_pick',
      price: 9, per: 1, unit_price: 9, qty_available: 6, qty_total: 6, carry_max: 6, you_have: 3, distance: 5, eta_seconds: 450, expires_at: ends,
      buyer: { id: null, name: 'Bramblehollow', username: 'village', species: 'mice' } };
    let posted = [];
    const runAt = s => new Date(Date.now() + s * 1e3).toISOString();
    const npcRun = { id: 501, kind: 'npc', direction: 'npc', side: 'buy', status: 'outbound', qty: 200, resource: 'food', gold: 62,
      citizen_name: 'Birch', target_name: 'Bramblehollow', distance: 5, departs_at: runAt(-10), arrives_at: runAt(350), returns_at: runAt(710) };
    const routes = { '/api/market/status': OPEN, '/api/market/mine': { ...MINE, runs: [npcRun] },
      '/api/market/orders?': { ok: true, orders: [...ORDERS.orders, npcSell] },
      '/api/market/wants?': { ok: true, wants: [npcBuy] },
      '/api/market/npc/12/': (p, o) => { posted.push([p, JSON.parse(o.body)]); return { ok: true, porter: 'Birch', village: 'Bramblehollow', gold: 27, run: { id: 501, qty: 200, returns_at: runAt(720) } }; } };
    const env = makeEnv(routes);
    env.win.setTimeout = (fn) => { fn(); return 1; };
    await env.win.openMarket();
    let b = env.body();
    check('6. NPC: sell order in Buy: badge, village, trust tier, ends at midnight', /mk-npc-row/.test(b) && /mk-npc-badge">NPC<\/span> <span>Bramblehollow<\/span>/.test(b) &&
      /· Friendly/.test(b) && /sells<\/span> 300/.test(b) && /goldicon\.png[^>]*> 31<\/span> <span class="mk-for">per 100/.test(b) && new RegExp('data-until="' + ends).test(b) &&
      /data-act="npc-trade" data-side="sell" data-id="npc:12:s0"/.test(b));
    check('6b. NPC: "Hide NPC traders" toggle, off by default', /data-act="hide-npc" >/.test(b) && /Hide NPC traders/.test(b) &&
      !/npc=0/.test(env.calls.filter(c => c[1].startsWith('/api/market/orders?')).pop()[1]));
    await env.fire('click', env.btn('npc-trade', { id: 'npc:12:s0', side: 'sell' }));
    const sh = env.getEl('mk-sheet-wrap').innerHTML;
    const q = env.getEl('mk-npc-qty'); q.value = '200'; q.dataset.id = 'npc:12:s0'; q.dataset.side = 'sell';
    await env.fire('input', { dataset: { act: 'npc-qty' } });
    check('6c. NPC: buy sheet: capped by carry (200), free porters only, price for the amount', /Buy .* from Bramblehollow/.test(sh) &&
      /id="mk-npc-qty" min="1" max="200" value="200"/.test(sh) && /<option value="22">Birch/.test(sh) && !/<option value="21">/.test(sh) &&
      /You pay now<\/span><b><span class="mk-gold"><img[^>]*goldicon\.png[^>]*> 62/.test(env.getEl('mk-npc-sum').innerHTML) && /up to \+2 trust a day/.test(sh));
    env.getEl('mk-npc-porter').value = '22';
    await env.fire('click', env.btn('npc-confirm', { id: 'npc:12:s0', side: 'sell' }));
    await tick();
    check('6d. NPC: buying posts the order key, amount and porter', posted.length === 1 && posted[0][0] === '/api/market/npc/12/s0' &&
      posted[0][1].qty === 200 && posted[0][1].citizen_id === 22 &&
      env.toasts.some(t => /^🧺 Birch is walking to Bramblehollow to buy 200 food — back in ~12m with the goods\./.test(t[0])));
    check('6d2. NPC: after sending, Caravans shows the porter on the road, highlighted', /mk-tab on" data-act="tab" data-tab="caravans"/.test(env.getEl('mk-tabs').innerHTML) &&
      /mk-trip live mk-trip-new" data-run="501"/.test(env.body()) && /Birch is walking to Bramblehollow to buy 200 food/.test(env.body()));
    // Wanted: the village's buy order, sell to it
    await env.fire('click', { tagName: 'BUTTON', dataset: { tab: 'wanted' }, closest: function () { return this; } });
    await env.win.openMarket({ tab: 'wanted' });
    b = env.body();
    check('6e. NPC: buy order in Wanted: what it wants, what you have, Sell button', /Iron Pick<\/b> <span class="mk-for">· wants<\/span> 6/.test(b) &&
      /you have 3/.test(b) && /data-act="npc-trade" data-side="buy" data-id="npc:12:b0" >/.test(b));
    await env.fire('click', env.btn('npc-trade', { id: 'npc:12:b0', side: 'buy' }));
    const sh2 = env.getEl('mk-sheet-wrap').innerHTML;
    const q2 = env.getEl('mk-npc-qty'); q2.value = '3'; q2.dataset.id = 'npc:12:b0'; q2.dataset.side = 'buy';
    await env.fire('input', { dataset: { act: 'npc-qty' } });
    check('6f. NPC: sell sheet: capped by what you hold (3), gold on return', /Sell .*Iron Pick to Bramblehollow/.test(sh2) && /max="3" value="3"/.test(sh2) &&
      /You get when home<\/span><b><span class="mk-gold"><img[^>]*goldicon\.png[^>]*> 27/.test(env.getEl('mk-npc-sum').innerHTML));
    env.getEl('mk-npc-porter').value = '22';
    await env.fire('click', env.btn('npc-confirm', { id: 'npc:12:b0', side: 'buy' }));
    await tick();
    check('6g. NPC: selling posts to the village buy order', posted.length === 2 && posted[1][0] === '/api/market/npc/12/b0' && posted[1][1].qty === 3);
    check('6g2. NPC: selling toast says what goes and the gold coming back', env.toasts.some(t => /^🧺 Birch is taking 3× Iron Pick to Bramblehollow — back in ~12m with 27 gold\./.test(t[0])));
    // Toggle: hide, persisted, sent as npc=0 (and remembered by a fresh panel)
    await env.win.openMarket({ tab: 'wanted' });
    await env.fire('change', { dataset: { act: 'hide-npc' }, checked: true });
    await tick();
    check('6h. NPC: hiding NPC traders is remembered and sent as npc=0', env.store.kw_mk_hide_npc === '1' &&
      /npc=0/.test(env.calls.filter(c => c[1].startsWith('/api/market/wants?')).pop()[1]));
    const env2 = makeEnv(routes, { kw_mk_hide_npc: '1' });
    await env2.win.openMarket();
    check('6i. NPC: a fresh panel starts with NPC traders hidden', /npc=0/.test(env2.calls.find(c => c[1].startsWith('/api/market/orders?'))[1]) &&
      /data-act="hide-npc" checked/.test(env2.body()));
    // Caravans + return toast
    await env.win.MarketUI.onEvent({ type: 'market_porter_home', kind: 'npc', side: 'buy', qty: 200, resource: 'food', target: 'Bramblehollow', trust_gained: 1 });
    check('6j. NPC: porter home from a village: toast with the goods and the trust gained', env.toasts.some(t => /back from Bramblehollow with 200/.test(t[0]) && /\+1 trust/.test(t[0])));
  }
  // 3t — wanted
  {
    let posted = null, filled = null;
    const WANTS = { ok: true, wants: [
      { id: 61, kind: 'item', item_key: 'iron_sword', item: { name: 'Iron Sword', icon: '🗡', cat: 'weapon' }, qty_total: 20, qty_open: 20, price: 30, per: 1,
        unit_price: 30, total_open: 600, buyer: { id: 5, name: 'Thornwick', username: 'rook', species: 'Badgers' }, distance: 9, you_have: 2, carry_max: 6,
        expires_at: new Date(Date.now() + 5 * 86400e3).toISOString() },
      { id: 62, kind: 'resource', resource: 'stone', qty_total: 500, qty_open: 500, price: 90, per: 100, unit_price: 0.9, total_open: 450,
        buyer: { id: 6, name: 'Cragmoor', username: 'flint', species: 'Moles' }, distance: 3, you_have: 0, carry_max: 100,
        expires_at: new Date(Date.now() + 5 * 86400e3).toISOString() }] };
    const mine = { ...MINE, items: [...MINE.items.filter(i => i.item_key !== 'iron_sword'), { id: 81, item_key: 'iron_sword', name: 'Iron Sword', icon: '🗡', quantity: 2, tradeable: true }],
      wants: [{ id: 70, kind: 'resource', resource: 'timber', qty_total: 300, qty_open: 100, price: 60, per: 100, total_open: 60, status: 'active',
        expires_at: new Date(Date.now() + 3 * 86400e3).toISOString() }] };
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/mine': mine,
      '/api/market/wants/61/fill': (p, o) => { filled = JSON.parse(o.body); return { ok: true, porter: 'Birch', buyer: 'Thornwick', gold: 60, fee: 3, run: { qty: 2 } }; },
      '/api/market/wants?': WANTS,
      '/api/market/wants': (p, o) => { posted = JSON.parse(o.body); return { ok: true, gold_held: 90, want: { id: 99 } }; },
      '/api/market/catalog': { ok: true, items: [{ item_key: 'iron_sword', name: 'Iron Sword', icon: '🗡', cat: 'weapon', rarity: 'common' }] } });
    env.win.setTimeout = (fn) => { fn(); return 1; };
    await env.win.openMarket({ tab: 'wanted' });
    const b = env.body();
    check('3t. Wanted: towns\' buy orders with price, buyer, and what you hold', /Iron Sword<\/b>[\s\S]*?wants<\/span> 20[\s\S]*?<img[^>]*goldicon\.png[^>]*> 30<\/span> each/.test(b) && /Thornwick/.test(b) && /You have 2/.test(b));
    check('3u. resources priced per 100; Fill disabled when you have none', /<img[^>]*goldicon\.png[^>]*> 90<\/span> per 100/.test(b) && /data-act="fill" data-id="62" disabled/.test(b));
    check('3v. your own wanted orders with promised / held gold and Cancel', /200 of 300 promised · 60 gold still held/.test(b) && /data-act="cancel-want" data-id="70"/.test(b));
    await env.fire('click', env.btn('fill', { id: '61' }));
    const fs = env.getEl('mk-sheet-wrap').innerHTML;
    const fq = env.getEl('mk-fill-qty'); fq.value = '2'; fq.dataset.id = '61';
    await env.fire('input', { dataset: { act: 'fill-qty' } });
    check('3w. Fill sheet: what you hold, quantity capped (2), payout after fee', /you have 2; up to 2 per trip/.test(fs) && /id="mk-fill-qty" min="1" max="2" value="2"/.test(fs) &&
      /You get when home<\/span><b><span class="mk-gold"><img[^>]*goldicon\.png[^>]*> 57/.test(env.getEl('mk-fill-sum').innerHTML));
    env.getEl('mk-fill-porter').value = '22';
    await env.fire('click', env.btn('fill-confirm', { id: '61' }));
    await tick();
    check('3x. fill posts quantity and porter', filled && filled.qty === 2 && filled.citizen_id === 22);
    // Post a wanted order for an item via the autocomplete.
    const box = { dataset: { act: 'want-search' }, value: 'iro' };
    await env.fire('input', box);
    await tick(); await tick();
    check('3y. the wanted form has its own autocomplete', /Iron Sword/.test(env.getEl('mk-want-suggest').innerHTML));
    env.win.document.querySelector = (sel) => (/data-form="want"/.test(sel) ? { qty: { value: '3' }, price: { value: '30' } } : null);
    await env.fireEv('keydown', { target: box, key: 'Enter', preventDefault() {}, stopPropagation() {} });
    await env.fire('submit', { dataset: { form: 'want' } });
    await tick();
    check('3z. posting sends item, quantity and price', posted && posted.kind === 'item' && posted.item_key === 'iron_sword' && posted.qty === 3 && posted.price === 30);
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

  // 7 — prices & the Ledger
  {
    const day = n => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - n * 86400e3).toISOString().slice(0, 10); };
    const P = { type: 'resource', id: 'timber', quality: 'basic', days: [{ day: day(3), avg: 0.6, qty: 300, n: 2 }, { day: day(1), avg: 0.9, qty: 100, n: 1 }, { day: day(0), avg: 0.8, qty: 200, n: 2 }],
      week: { avg: 0.75, low: 0.5, high: 1.1, n: 5, qty: 600 }, last: { price: 0.8, at: new Date().toISOString() },
      reference: { price: 0.7, label: 'Market reference' }, guide: 0.75, guide_source: 'trades' };
    const env0 = makeEnv({ '/api/market/status': OPEN });
    const H = env0.win.MarketUI._prices;
    check('7a. crafted items are priced by quality; others are basic',
      H.goodKeyOf('item', null, { item_key: 'iron_sword', metadata: { quality: 'fine', crafted_by: { name: 'F' } } }) === 'item:iron_sword:fine'
      && H.goodKeyOf('item', null, { item_key: 'iron_sword', metadata: { quality: 'fine' } }) === 'item:iron_sword:basic'
      && H.goodKeyOf('resource', 'timber') === 'resource:timber');
    const ser = H.dailySeries(P, 14);
    check('7b. 14 daily points ending today, gaps where nothing traded', ser.length === 14 && ser[13].day === day(0) && ser[13].avg === 0.8 && ser[12].avg === 0.9 && ser[11].avg === null && ser[10].avg === 0.6);
    const sp = H.sparkSvg(ser);
    check('7c. sparkline: one 2px line through the traded days, a dot at the end', (sp.match(/<polyline/g) || []).length === 1 && /stroke-width="2"/.test(sp) && /<circle/.test(sp));
    check('7c2. no trades → no sparkline', H.sparkSvg(H.dailySeries({ days: [] }, 14)) === '');
    const b = H.badgeHtml(P);
    check('7d. badge: 7-day average, count and range', /7-day avg <b>0\.75<\/b> each · 5 trades · range 0\.50–1\.10/.test(b));
    check('7d2. Wanted form: resources per 100', /<b>75<\/b> per 100/.test(H.badgeHtml(P, 100)));
    check('7e. no recent trades → last price, else the reference', /Last traded at <b>0\.80/.test(H.badgeHtml({ ...P, week: { n: 0 } }))
      && /market reference 0\.70 each/.test(H.badgeHtml({ ...P, week: { n: 0 }, last: null })));
    check('7f. listing vs average: below / above / about', /▼ 20% below avg/.test(H.deltaHtml(P, 0.6)) && /▲ 20% above avg/.test(H.deltaHtml(P, 0.9))
      && /≈ 7-day average/.test(H.deltaHtml(P, 0.76)) && H.deltaHtml({ ...P, week: { n: 1, avg: 1 } }, 2) === '');
    const pc = H.priceChartSvg(P, 600, 30);
    check('7g. price chart: line, dashed reference, volume columns, one hover zone per day',
      /<polyline/.test(pc) && /stroke-dasharray="5 4"/.test(pc) && /Market reference/.test(pc) && (pc.match(/class="mk-bar"/g) || []).length === 3
      && (pc.match(/data-tip=/g) || []).length === 30 && /Units traded/.test(pc));
    check('7g2. chart text uses text colours, never the series colour', !/<text[^>]*fill="#bf8a2c"/.test(pc));
    const weeks = Array.from({ length: 8 }, (_, i) => ({ week_start: day(7 * (7 - i)), in: i * 10, out: i === 3 ? 90 : 0, fees: 1, net: i === 3 ? -60 : i * 10, n: i ? 1 : 0, pending: 0 }));
    const nc = H.netChartSvg(weeks, 600);
    check('7h. net chart: earned up in one colour, spent down in another, a hover per week',
      /fill="#2f9e86"/.test(nc) && /fill="#d0703c"/.test(nc) && (nc.match(/data-tip=/g) || []).length === 8 && /This week/.test(nc) && /−/.test(nc));

    const LEDGER = { ok: true, next_before: 40, weeks,
      entries: [
        { id: 50, kind: 'lot', side: 'sold', resource: 'timber', qty: 100, gross: 70, fee: 3, net: 67, unit_price: 0.7, counterparty: 'Oakhollow', citizen_name: 'Ash', status: 'settled', agreed_at: new Date().toISOString() },
        { id: 49, kind: 'pickup', side: 'bought', item: { name: 'Fine Iron Sword', icon: '⚔️', rarity: 'common', metadata: { quality: 'fine', crafted_by: { name: 'Fenn' } } }, qty: 1, gross: 40, fee: 0, net: -40, unit_price: 40, counterparty: 'Stonebrook', citizen_name: 'Wren', status: 'on_road', agreed_at: new Date().toISOString() },
        { id: 48, kind: 'pickup', side: 'bought', item: { name: 'Trout', icon: '🐟', rarity: 'common' }, qty: 5, gross: 20, fee: 0, net: 0, unit_price: 4, counterparty: 'Stonebrook', status: 'returned', agreed_at: new Date().toISOString() },
      ] };
    const env = makeEnv({ '/api/market/status': OPEN, '/api/market/ledger': LEDGER,
      '/api/market/prices/movers': { ok: true, goods: [{ key: 'resource:timber', type: 'resource', id: 'timber', quality: 'basic', avg: 0.75, prev: 0.6, change: 0.25, qty: 600, n: 5 },
        { key: 'item:iron_sword:fine', type: 'item', id: 'iron_sword', quality: 'fine', name: 'Iron Sword', icon: '⚔️', avg: 42, prev: null, change: null, qty: 3, n: 3 }] },
      '/api/market/prices': p => ({ ok: true, prices: { [decodeURIComponent(p.split('goods=')[1].split('&')[0])]: P } }) });
    await env.win.openMarket({ tab: 'ledger' });
    let h = env.body();
    check('7i2. Ledger help opens on the first visit and explains where prices come from', /<details class="mk-help" open>/.test(h) && /only from trades between players/.test(h) && env.store.kw_mk_ledger_help === '1');
    check('7i. Ledger tab: this week\'s tiles', /📒 Ledger/.test(env.getEl('mk-tabs').innerHTML) && /Earned/.test(h) && /Fees paid/.test(h) && /Deals/.test(h));
    check('7j. receipts: net after fee, who, the merchant, status', /\+67/.test(h) && /Sold to <b>Oakhollow<\/b>/.test(h) && /Ash/.test(h) && /✓ settled/.test(h));
    check('7k. purchases: −gold, on the road; a failed pickup shows its gold came back', /−40/.test(h) && /goods on the road/.test(h) && /stall sold out — gold returned/.test(h));
    check('7l. 8-week chart drawn, with a table view and a key', /<svg/.test(env.getEl('mk-net-chart').innerHTML) && /Show as a table/.test(h) && /earned/.test(h) && /spent/.test(h));
    check('7m. Load older is offered while there are more', /data-act="ledger-more"/.test(h));
    await env.fire('click', env.btn('ledger-side', { side: 'sold' }));
    check('7n. Sales filter asks the server for side=sold', env.calls.some(c => /\/api\/market\/ledger\?side=sold/.test(c[1])));
    await env.fire('click', env.btn('ledger-more'));
    check('7o. Load older pages with before=', env.calls.some(c => /before=40/.test(c[1])));
    await env.fire('click', env.btn('ledger-view', { view: 'prices' }));
    h = env.body();
    check('7p. Prices view: this week\'s goods with change and volume', /Traded this week/.test(h) && /▲ 25%/.test(h) && /600 units/.test(h) && /Fine Iron Sword/.test(h));
    check('7q. first good charted (30 days), with a table view', env.calls.some(c => /\/api\/market\/prices\?goods=resource%3Atimber&days=30/.test(c[1])) && /<svg/.test(env.getEl('mk-price-chart').innerHTML) && /Show as a table/.test(h));
    await env.fire('click', env.btn('price-pick', { key: 'item:iron_sword:fine', name: 'Iron Sword' }));
    h = env.body();
    check('7r. an item shows a quality switch', /data-act="price-q" data-q="legendary"/.test(h));
    await env.fire('click', env.btn('price-q', { q: 'superior' }));
    check('7s. switching quality reloads that quality', env.calls.some(c => /goods=item%3Airon_sword%3Asuperior/.test(c[1])));
  }
  {
    const env = makeEnv({ '/api/market/status': { ...OPEN, guide: { timber: { price: 0.82, source: 'trades', n: 9 }, food: { price: 0.3, source: 'reference', n: 0 } } }, '/api/market/mine': MINE });
    await env.win.openMarket({ tab: 'sell' });
    const sum = env.getEl('mk-sell-summary').innerHTML;
    check('7t. Sell form: recent trades set the guide, with a sparkline slot', /Recent trades: about <b>0\.82<\/b>/.test(sum) && /data-pk="resource:timber" data-pv="badge"/.test(sum));
  }
  {
    const css = read('css/market.css'), js = read('js/market.js');
    check('7u. chart colours are the validated ones', /#bf8a2c/.test(js) && /#2f9e86/.test(js) && /#d0703c/.test(js));
    check('7v. phone layout for tiles and the price list', /@media \(max-width: 600px\) \{\s*\.mk-tiles/.test(css));
    check('7w. charts redraw on resize; touch taps show the tooltip', /addEventListener\('resize'/.test(js) && /pointerType !== 'mouse'/.test(js));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
