// ══════════════════════════════════════════════════════════════════════════
//  Your Town — festivals, upkeep and Wonders (server: routes/town.js,
//  routes/wonders.js; rules in lib/town_mods.js and lib/wonders.js).
//
//  KWTown.open('festival' | 'wonders') opens one screen with three parts:
//    🎉 Festival — cost, Hold a festival, the countdown or cooldown
//    Upkeep      — what the treasury pays each hour, and arrears
//    🏛 Wonders   — five cards: stage pips, next cost (?? until discovered,
//                  red when short), Build, time left, bonus, dormant
//  KWTown.onSettlement(s) draws the banner over the map from
//  settlement.town: arrears first, else a running festival.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = id => document.getElementById(id);
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };
  const BASIC_ICON = { food: '🌿', timber: '🌲', stone: '🪨', metal: '⚙️', wealth: '🪙' };
  const st = { town: null, wonders: null, focus: 'festival', busy: false };
  let _ticker = null;

  async function call(method, path, body) {
    const res = await global.apiFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function left(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return 'any moment';
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h ? `${h}h ${m % 60}m` : `${m}m`;
  }
  function have() {
    const r = (typeof gameData !== 'undefined' && gameData && gameData.settlement && gameData.settlement.resources) || {};
    const t = typeof tickResources !== 'undefined' && tickResources ? tickResources : {};
    return Object.assign({}, r, t);
  }
  // A cost chip: the registry icon (?? until discovered), red when short.
  function chip(res, n, stock) {
    const R = global.KWResources;
    let icon = BASIC_ICON[res];
    let title = res;
    if (!icon && R && R.isResource(res)) {
      const known = R.knownSet((typeof gameData !== 'undefined' && gameData && gameData.settlement && gameData.settlement.discovered) || []);
      icon = R.isKnown(res, known) ? R.icon(res) : '??';
      title = R.isKnown(res, known) ? R.label(res) : 'Not yet discovered';
    } else if (R && R.isResource(res)) title = R.label(res);
    const short = (Number(stock[res]) || 0) < n;
    return `<span class="tw-chip${short ? ' short' : ''}" title="${esc(title)}">${esc(icon || res)} ${Number(n).toLocaleString('en-GB')}</span>`;
  }

  // ── Screen ─────────────────────────────────────────────────────────────
  function ensure() {
    let o = byId('tw-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'tw-overlay';
    o.className = 'tw-screen';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'tw-title');
    o.innerHTML = `<div class="tw-card">
        <div class="tw-head"><div class="tw-title" id="tw-title">🏛 Your Town</div>
          <button type="button" class="tw-close" data-tw="close" aria-label="Close">✕</button></div>
        <div class="tw-body" id="tw-body"><div class="tw-muted">Gathering the council…</div></div></div>`;
    o.addEventListener('click', onClick);
    document.body.appendChild(o);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && o.classList.contains('open')) close(); });
    return o;
  }

  async function open(focus) {
    st.focus = focus || 'festival';
    ensure().classList.add('open');
    await load();
    // Scroll only the body (scrollIntoView would also shift the card itself).
    const target = byId(st.focus === 'wonders' ? 'tw-wonders' : 'tw-festival'), body = byId('tw-body');
    if (target && body) body.scrollTop = Math.max(0, target.offsetTop - body.offsetTop);
    if (_ticker) clearInterval(_ticker);
    _ticker = setInterval(() => { if (byId('tw-overlay') && byId('tw-overlay').classList.contains('open')) render(); else clearInterval(_ticker); }, 30000);
  }
  function close() { const o = byId('tw-overlay'); if (o) o.classList.remove('open'); if (_ticker) clearInterval(_ticker); }

  async function load() {
    try {
      const [town, wonders] = await Promise.all([call('GET', '/api/town'), call('GET', '/api/wonders')]);
      st.town = town; st.wonders = wonders;
      render();
    } catch (e) { const b = byId('tw-body'); if (b) b.innerHTML = `<div class="tw-err">${esc(e.message)}</div>`; }
  }

  function festivalHtml(f) {
    const stock = have();
    let status;
    if (f.active) status = `<div class="tw-status good">🎉 A festival is under way — ${esc(left(f.until))} left.</div>`;
    else if (f.cooldown_until) status = `<div class="tw-status">The town is still recovering — the next festival in ${esc(left(f.cooldown_until))}.</div>`;
    else status = '';
    const cost = Object.entries(f.cost).map(([r, n]) => chip(r, n, stock)).join('');
    return `<section class="tw-section" id="tw-festival">
        <h3>🎉 Festival</h3>
        <p class="tw-desc">Music, feasting and dancing in the streets: <b>+${f.happiness} happiness</b> and <b>+${Math.round(f.production * 100)}% production</b> for ${f.hours} hours. Afterwards the town needs ${f.cooldown_hours} hours (from the start) before the next.</p>
        ${status}
        <div class="tw-row"><span class="tw-label">Cost</span>${cost}</div>
        <button type="button" class="tw-btn tw-btn-primary" data-tw="festival"${f.can_start ? '' : ` disabled title="${esc(f.why || '')}"`}>Hold a festival</button>
        ${!f.can_start && f.why && !f.active ? `<span class="tw-why">${esc(f.why)}</span>` : ''}
      </section>`;
  }

  function upkeepHtml(t) {
    const u = t.upkeep;
    const parts = [];
    if (u.wonders) parts.push(`wonders ${u.wonders}`);
    if (u.city) parts.push(`City buildings ${u.city}`);
    return `<section class="tw-section">
        <h3>🪙 Upkeep</h3>
        ${u.total ? `<p class="tw-desc">The treasury pays <b>${u.total} wealth an hour</b> (${parts.join(', ')}). In a City, every building level above 3 costs 2 an hour; each finished wonder costs its own upkeep.</p>`
          : '<p class="tw-desc">Nothing to pay yet. Finished wonders, and a City\'s building levels above 3, cost wealth each hour.</p>'}
        ${t.arrears ? '<div class="tw-status bad">⚠️ The treasury ran dry: upkeep is unpaid, wonders lie dormant and happiness is down 10. Raise some wealth and it recovers by itself.</div>' : ''}
      </section>`;
  }

  function wonderCard(w) {
    const stock = have();
    const pips = Array.from({ length: w.stages }, (_, i) => `<span class="tw-pip${i < w.stage ? ' on' : ''}${w.building_until && i === w.stage ? ' building' : ''}"></span>`).join('');
    let foot;
    if (w.complete) foot = w.dormant ? '<div class="tw-status bad">Dormant — unpaid upkeep.</div>' : `<div class="tw-status good">✓ Complete: ${esc(w.bonus)}.</div>`;
    else if (w.building_until) foot = `<div class="tw-status">Stage ${w.stage + 1} is going up — ${esc(left(w.building_until))} left.</div>`;
    else {
      const n = w.next;
      const cost = Object.entries(n.cost).map(([r, v]) => chip(r, v, stock)).join('')
        + n.items.map(i => `<span class="tw-chip${i.have < i.qty ? ' short' : ''}" title="${esc(i.name)}">${esc(i.icon)} ${i.qty} ${esc(i.name)}</span>`).join('');
      foot = `<div class="tw-row"><span class="tw-label">Stage ${n.stage}</span>${cost}<span class="tw-time">⏳ ${n.hours}h</span></div>
        <button type="button" class="tw-btn tw-btn-primary" data-tw="build" data-key="${esc(w.key)}"${w.can_build ? '' : ` disabled title="${esc(w.why || '')}"`}>Build stage ${n.stage}</button>
        ${w.can_build ? '' : `<span class="tw-why">${esc(w.why || '')}</span>`}`;
    }
    return `<article class="tw-wonder${w.complete ? ' done' : ''}${w.dormant ? ' dormant' : ''}">
        <header><span class="tw-w-icon" aria-hidden="true">${esc(w.icon)}</span><div><div class="tw-w-name">${esc(w.label)}</div>
          <div class="tw-pips" aria-label="${w.stage} of ${w.stages} stages">${pips}</div></div></header>
        <p class="tw-desc">${esc(w.desc)}</p>
        <p class="tw-bonus">When complete: <b>${esc(w.bonus)}</b></p>
        ${foot}</article>`;
  }

  function wondersHtml(v) {
    return `<section class="tw-section" id="tw-wonders">
        <h3>🏛 Wonders</h3>
        <p class="tw-desc">Great works that make a City famous. Each is built in three stages; the last needs an Ancient Blueprint. One at a time; each finished wonder costs ${v.upkeep_each} wealth an hour to keep working.</p>
        ${v.locked ? `<div class="tw-status">🔒 ${esc(v.locked)}</div>` : ''}
        <div class="tw-wonders">${v.wonders.map(wonderCard).join('')}</div>
      </section>`;
  }

  function render() {
    const b = byId('tw-body');
    if (!b || !st.town || !st.wonders) return;
    b.innerHTML = festivalHtml(st.town.festival) + upkeepHtml(st.town) + wondersHtml(st.wonders);
  }

  // Bring the top bar up to date after spending.
  async function syncSettlement() {
    try {
      const d = await (await global.apiFetch('/api/game/settlement')).json();
      if (!d || !d.settlement) return;
      if (typeof global._applyOutpostResponse === 'function') global._applyOutpostResponse({ resources: d.settlement.resources, rates: d.settlement.rates });
      if (typeof gameData !== 'undefined' && gameData && gameData.settlement) gameData.settlement.town = d.settlement.town;
      onSettlement(d.settlement);
    } catch (e) { /* the 5-minute sync will catch up */ }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-tw]');
    if (!b) return;
    const act = b.dataset.tw;
    if (act === 'close') return close();
    if (st.busy) return;
    st.busy = true;
    try {
      if (act === 'festival') {
        await call('POST', '/api/town/festival');
        toast('🎉 The festival begins!');
      }
      if (act === 'build') {
        const d = await call('POST', `/api/wonders/${encodeURIComponent(b.dataset.key)}/build`);
        const w = d.wonders.find(x => x.key === b.dataset.key);
        toast(`${w ? w.icon + ' ' + w.label : 'The wonder'}: stage ${w ? w.stage + 1 : ''} is under way.`);
      }
      await syncSettlement();
      await load();
    } catch (err) { toast(err.message, 'error'); }
    finally { st.busy = false; }
  }

  // ── Banner over the map ────────────────────────────────────────────────
  function onSettlement(s) {
    const el = byId('town-banner');
    if (!el) return;
    const t = s && s.town;
    if (t && t.arrears) {
      el.className = 'town-banner open bad';
      el.innerHTML = '<button type="button" class="town-banner-inner" onclick="KWTown.open(\'festival\')">⚠️ <b>Unpaid upkeep</b> <span>Wonders lie dormant and happiness is down. Raise wealth to recover.</span></button>';
    } else if (t && t.festival && t.festival.active) {
      el.className = 'town-banner open good';
      el.innerHTML = `<button type="button" class="town-banner-inner" onclick="KWTown.open('festival')">🎉 <b>Festival</b> <span>+${t.festival.happiness} happiness, +${Math.round(t.festival.production * 100)}% production · ${esc(left(t.festival.until))} left</span></button>`;
    } else {
      el.className = 'town-banner';
      el.innerHTML = '';
    }
  }

  // Dev Tools
  async function devFinish(key) {
    try { await call('POST', '/api/wonders/admin/finish', { key }); toast('Wonder stage finished ✓'); await syncSettlement(); if (byId('tw-overlay') && byId('tw-overlay').classList.contains('open')) await load(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function devFestival() {
    try { await call('POST', '/api/town/admin/festival'); toast('🎉 Free festival started ✓'); await syncSettlement(); }
    catch (e) { toast(e.message, 'error'); }
  }

  global.KWTown = { open, close, load, render, onSettlement, devFinish, devFestival, _state: () => st, _set(town, wonders) { st.town = town; st.wonders = wonders; }, left };
})(typeof window !== 'undefined' ? window : this);
