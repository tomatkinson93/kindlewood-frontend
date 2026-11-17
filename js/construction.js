// ══════════════════════════════════════════════════════════════════════════
//  KWBuild — building time with builders, as the player sees it
//  (docs/HOME_SCENE.md Part D; the server's lib/construction.js decides).
//
//  With building time on for a town, paying for a building starts a
//  construction site and builders finish it. This file:
//    · reads the queue (GET /api/construction) and follows the live stream;
//    · says what happened when something is ordered ("about 3 minutes with 1
//      builder", or that nobody is a builder, with a way to choose one);
//    · shows the queue ("Going up"): a chip by the town card, and a window to
//      reorder and cancel;
//    · gives the scenes what they draw: each site, how far along, and an
//      honest estimate (KWBuild.siteFor, .houseSites, .pct, .etaLine).
//
//  Progress between reads is worked out here from the builders' pace, so a
//  bar moves smoothly; the server's numbers replace it at each read.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const S = { data: null, at: 0, loading: null, asked: 0, quiet: 0 };
  const now = () => Date.now();
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };
  const RES = { food: '🍖', timber: '🪵', stone: '🪨', metal: '⛏️', wealth: '🪙' };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // "less than a minute", "about 1 minute", "about 12 minutes", "about 1 h 20 min".
  function minutesLine(m) {
    if (!(m > 0)) return 'less than a minute';
    const n = Math.max(1, Math.round(m));
    if (n === 1) return 'about 1 minute';
    if (n < 60) return `about ${n} minutes`;
    const h = Math.floor(n / 60), r = n % 60;
    return r ? `about ${h} h ${r} min` : `about ${h} h`;
  }
  const buildersLine = n => `${n} builder${n === 1 ? '' : 's'}`;
  // How far along each open site is `elapsed` ms after the queue was read:
  // everyone works on the first; what is left over carries into the next.
  // → [{ id, done, pct }] in queue order.
  function progress(sites, rate, elapsed) {
    let spare = rate > 0 && elapsed > 0 ? rate * elapsed / 60000 : 0;
    return (sites || []).map(s => {
      const left = Math.max(0, s.work_needed - s.work_done), add = Math.min(left, spare);
      spare -= add;
      const done = s.work_done + add;
      return { id: s.id, done, pct: s.work_needed > 0 ? Math.min(1, done / s.work_needed) : 1 };
    });
  }
  // Minutes until a site is finished (with everything before it), or null
  // while nobody is building.
  function etaMinutes(sites, rate, id, elapsed = 0) {
    if (!(rate > 0)) return null;
    const p = progress(sites, rate, elapsed);
    let sum = 0;
    for (let i = 0; i < sites.length; i++) {
      sum += Math.max(0, sites[i].work_needed - p[i].done);
      if (sites[i].id === id) return sum / rate;
    }
    return null;
  }
  // "about 12 minutes with 2 builders", or "Waiting for a builder".
  function etaLine(data, id, elapsed = 0) {
    if (!data) return '';
    const n = (data.builders || []).length;
    if (!(data.rate > 0) || !n) return 'Waiting for a builder';
    const m = etaMinutes(data.sites, data.rate, id, elapsed);
    return m == null ? '' : `${minutesLine(m)} with ${buildersLine(n)}`;
  }
  // What to say when something has been ordered. `r`: the server's answer.
  function orderLine(r, label, work) {
    const what = r.site && r.site.kind === 'upgrade' ? `the ${label} upgrade` : r.site && r.site.plot != null ? 'a new home' : `the ${label}`;
    if (r.no_builder) return `Paid for ${what}. Nobody is a builder, so it will wait until someone is.`;
    const n = r.builders || 0, w = work != null ? work : r.site && r.site.work_needed;
    return `The builders will start on ${what}${w ? ` (${minutesLine(w / Math.max(1, n))} of work with ${buildersLine(n)}, after anything before it)` : ''}.`;
  }
  const costLine = cost => Object.entries(cost || {}).filter(([, v]) => v > 0).map(([r, v]) => `${RES[r] || r} ${v}`).join('  ');
  // The chip by the town card: "🔨 2 going up · Lumber Camp 40%".
  function chipText(data, elapsed = 0) {
    if (!data || !data.sites || !data.sites.length) return '';
    const p = progress(data.sites, data.rate, elapsed)[0], first = data.sites[0];
    return `${data.sites.length} going up · ${first.label} ${Math.floor(p.pct * 100)}%${data.waiting ? ' · waiting for a builder' : ''}`;
  }
  // A new order of ids with the one at `i` moved by `d` (−1 up, +1 down).
  function moved(ids, i, d) {
    const j = i + d, out = ids.slice();
    if (i < 0 || j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }

  // ── Data ────────────────────────────────────────────────────────────────
  const signedIn = () => { try { return !!global.localStorage.getItem('kw_token'); } catch (_) { return false; } };
  const elapsed = () => (S.data ? Math.max(0, now() - S.at) : 0);
  function take(q) {
    const had = S.data ? S.data.sites.map(s => s.id).join() + '|' + S.data.on : '';
    S.data = q; S.at = now();
    const has = q.sites.map(s => s.id).join() + '|' + q.on;
    paint();
    if (had !== has) changed();
  }
  async function load() {
    if (!signedIn() || typeof global.apiFetch !== 'function') return null;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      try {
        const r = await global.apiFetch('/api/construction');
        if (r.ok) { const d = await r.json(); if (d && d.ok && d.queue) take(d.queue); }
      } catch (_) { /* later */ }
      S.loading = null;
      return S.data;
    })();
    return S.loading;
  }
  // The set of sites changed: the scenes and lists that show them follow.
  function changed() {
    try { global.dispatchEvent(new global.CustomEvent('kw:build', { detail: { sites: S.data ? S.data.sites.length : 0, on: !!(S.data && S.data.on) } })); } catch (_) { /* old browser */ }
    const W = global.KWWindow && global.KWWindow.get && global.KWWindow.get('going-up');
    if (W) { if (S.data && S.data.sites.length) W.refresh(); else global.KWWindow.close('going-up'); }
    if (global.KWContext && global.KWContext.refreshTown) global.KWContext.refreshTown();
  }
  // Something was finished: the buildings, the homes and the stores are read again.
  function finished(ev) {
    const again = f => { try { const r = f(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* not loaded */ } };
    if (typeof global.loadBuildings === 'function') again(() => global.loadBuildings());
    const gd = typeof gameData !== 'undefined' ? gameData : global.gameData;   // eslint-disable-line no-undef
    if (gd && ev && ev.site && ev.site.kind !== 'house') {
      const list = gd.buildings || (gd.buildings = []);
      const b = list.find(x => x.type === ev.site.type);
      if (b) { b.level = ev.site.level; b.currentLevel = ev.site.level; } else list.push({ type: ev.site.type, level: ev.site.level, currentLevel: ev.site.level });
    }
    if (typeof global.refreshSettlementView === 'function') again(() => global.refreshSettlementView());
    if (global.KWHood && global.KWHood.reload) again(() => global.KWHood.reload());
    if (typeof global.refreshResources === 'function') again(() => global.refreshResources());
    if (typeof global.loadCitizens === 'function' && ev && ev.site && ev.site.kind === 'house') again(() => global.loadCitizens());
    if (ev && ev.text) toast(`${ev.site && ev.site.kind === 'house' ? '🏡' : '🔨'} ${ev.text}`);
    if (typeof global.playSfx === 'function') again(() => global.playSfx('construct.wav'));
    try { global.dispatchEvent(new global.CustomEvent('kw:built', { detail: ev || {} })); } catch (_) { /* old browser */ }
  }
  function onEvent(ev) {
    if (!ev) return;
    if (ev.what === 'finished') finished(ev);
    else if (ev.what === 'waiting' && ev.text && now() > S.quiet) toast('⏳ ' + ev.text);   // not on top of "nobody is a builder", just said
    load();
  }

  // ── After an order ──────────────────────────────────────────────────────
  // `r`: the answer to POST /api/buildings/build or the Neighbourhood's place.
  function ordered(r, label, work) {
    toast('🔨 ' + orderLine(r, label, work));
    load();
    if (r.no_builder) { S.quiet = now() + 20000; noBuilder(); }
  }
  // Nobody is a builder: said plainly, with the way to fix it (D.5).
  async function noBuilder() {
    if (!global.KWDialog) return;
    const go = await global.KWDialog.confirm({ title: 'Nobody is a builder', message: 'Nothing is built without one. Give one of your grown-ups the Builder job and work starts at once.', ok: 'Choose a builder', cancel: 'Later' });
    if (go) chooseBuilder();
  }
  function chooseBuilder() {
    if (global.KWWindow && global.KWWindow.isOpen('going-up')) global.KWWindow.close('going-up');
    if (typeof global.openAllCitizens === 'function') global.openAllCitizens();
  }
  // A line for a build panel, before paying: how long, or that it will wait.
  function noteHtml(work) {
    if (!S.data || !S.data.on) return '';
    const n = (S.data.builders || []).length;
    if (!n) return '<div class="kwbt-note kwbt-warn">⏳ Nobody is a builder: this will wait until someone is. <button type="button" class="kwbt-link" data-kwbt="builder">Choose a builder</button></div>';
    const full = S.data.sites.length >= S.data.max;
    if (full) return `<div class="kwbt-note kwbt-warn">The builders already have ${S.data.max} things to build. Wait for one to finish, or cancel one.</div>`;
    return work ? `<div class="kwbt-note">🔨 ${esc(minutesLine(work / Math.max(0.2, S.data.rate)))} of work with ${esc(buildersLine(n))}${S.data.sites.length ? `, after the ${S.data.sites.length} before it` : ''}.</div>` : '';
  }

  // ── What the scenes draw ────────────────────────────────────────────────
  const sites = () => (S.data ? S.data.sites : []);
  const siteFor = type => sites().find(s => s.type === type && s.kind !== 'house') || null;
  const houseSites = () => sites().filter(s => s.kind === 'house');
  const pct = id => { const p = progress(sites(), S.data ? S.data.rate : 0, elapsed()).find(x => x.id === id); return p ? p.pct : 0; };
  // The stage of a site by the work done: 0 staked ground, 1 a frame, 2 nearly done.
  const stage = p => (p >= 0.66 ? 2 : p >= 0.25 ? 1 : 0);

  // ── The chip and the window ─────────────────────────────────────────────
  function chipHtml() {
    const t = chipText(S.data, elapsed());
    if (!t) return '';
    return `<button type="button" class="kwbt-chip${S.data.waiting ? ' kwbt-chip-wait' : ''}" data-kwbt="open" aria-haspopup="dialog"><span aria-hidden="true">${S.data.waiting ? '⏳' : '🔨'}</span> <span data-kwbt-chip>${esc(t)}</span></button>`;
  }
  function rowHtml(s, i, all) {
    const p = pct(s.id), refund = costLine(s.refund);
    return `<li class="kwbt-row" data-kwbt-site="${s.id}">`
      + `<div class="kwbt-top"><span class="kwbt-icon" aria-hidden="true">${esc(s.icon)}</span><b>${esc(s.label)}</b>`
      + `<span class="kwbt-eta" data-kwbt-eta="${s.id}">${esc(etaLine(S.data, s.id, elapsed()))}</span></div>`
      + `<div class="kwbt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(p * 100)}" aria-label="${esc(s.label)}"><i data-kwbt-bar="${s.id}" style="width:${(p * 100).toFixed(1)}%"></i></div>`
      + '<div class="kwbt-acts">'
      + `<button type="button" class="kwbt-small" data-action="up" data-id="${s.id}"${i === 0 ? ' disabled' : ''} aria-label="Build ${esc(s.label)} sooner">▲ Sooner</button>`
      + `<button type="button" class="kwbt-small" data-action="down" data-id="${s.id}"${i === all.length - 1 ? ' disabled' : ''} aria-label="Build ${esc(s.label)} later">▼ Later</button>`
      + `<button type="button" class="kwbt-small kwbt-cancel" data-action="cancel" data-id="${s.id}">Cancel${refund ? ` (back: ${esc(refund)})` : ''}</button>`
      + '</div></li>';
  }
  function open() {
    const W = global.KWWindow;
    if (!W || !S.data) return;
    W.open({
      id: 'going-up', icon: '🔨', size: 'S', title: 'Going up',
      render(body, st, w) {
        const d = S.data, n = (d.builders || []).length;
        w.setTitle('Going up', n ? `${buildersLine(n)}: ${d.builders.map(b => String(b.name).split(' ')[0]).join(', ')}` : 'Nobody is a builder');
        body.innerHTML = (d.waiting ? '<div class="kwbt-note kwbt-warn">⏳ Nobody is a builder, so nothing is being built. <button type="button" class="kwbt-link" data-action="builder">Choose a builder</button></div>' : '')
          + (d.sites.length ? `<ol class="kwbt-list">${d.sites.map(rowHtml).join('')}</ol>` : '<p class="kwbt-none">Nothing is being built.</p>')
          + `<p class="kwbt-hint">Every builder works on the first in the list. Up to ${d.max} at a time. Cancelling gives everything back before work starts, half after.</p>`;
      },
      actions: {
        builder() { chooseBuilder(); },
        async up(el) { await reorder(Number(el.dataset.id), -1); },
        async down(el) { await reorder(Number(el.dataset.id), 1); },
        async cancel(el) {
          const s = sites().find(x => x.id === Number(el.dataset.id));
          if (!s || !global.KWDialog) return;
          const back = costLine(s.refund);
          if (!await global.KWDialog.confirm({ title: `Stop building ${s.label}?`, message: back ? `You get back ${back}${s.started ? ' (half: work has begun)' : ''}.` : 'Nothing comes back.', ok: 'Stop building', cancel: 'Keep it', danger: true })) return;
          await send(`/sites/${s.id}/cancel`, {});
          if (typeof global.refreshResources === 'function') global.refreshResources();
          if (typeof global.loadBuildings === 'function') global.loadBuildings();
        },
      },
    });
  }
  async function reorder(id, d) {
    const ids = sites().map(s => s.id), next = moved(ids, ids.indexOf(id), d);
    if (next.join() === ids.join()) return;
    await send('/reorder', { ids: next });
  }
  async function send(path, body) {
    try {
      const r = await global.apiFetch('/api/construction' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { if (!d.paused) toast('⚠️ ' + (d.error || 'That did not work. Try again.')); await load(); return null; }
      if (d.queue) take(d.queue);
      const W = global.KWWindow && global.KWWindow.get && global.KWWindow.get('going-up');
      if (W) { if (S.data.sites.length) W.refresh(); else global.KWWindow.close('going-up'); }
      return d;
    } catch (_) { toast('⚠️ Network error. Try again.'); return null; }
  }

  // ── Moving bars ─────────────────────────────────────────────────────────
  // Once a second while there is something to show: bars, estimates and the
  // chip follow the builders' pace; when the first site should be done, the
  // server is asked (it is the one that finishes it).
  function paint() {
    if (!doc || !S.data) return;
    const e = elapsed(), p = progress(S.data.sites, S.data.rate, e);
    for (const x of p) {
      doc.querySelectorAll(`[data-kwbt-bar="${x.id}"]`).forEach(n => { n.style.width = (x.pct * 100).toFixed(1) + '%'; if (n.parentNode) n.parentNode.setAttribute('aria-valuenow', String(Math.floor(x.pct * 100))); });
      doc.querySelectorAll(`[data-kwbt-eta="${x.id}"]`).forEach(n => { const t = etaLine(S.data, x.id, e); if (n.textContent !== t) n.textContent = t; });
      doc.querySelectorAll(`[data-kwbt-pct="${x.id}"]`).forEach(n => { const t = Math.floor(x.pct * 100) + '%'; if (n.textContent !== t) n.textContent = t; });
      doc.querySelectorAll(`[data-kwbt-stage-of="${x.id}"]`).forEach(n => { const st = String(stage(x.pct)); if (n.getAttribute('data-kwbt-stage') !== st) n.setAttribute('data-kwbt-stage', st); });
    }
    const t = chipText(S.data, e);
    doc.querySelectorAll('#kwbt-slot, .kwc-going').forEach(slot => { const cur = slot.querySelector('[data-kwbt-chip]'); if (!t) { if (slot.firstChild) slot.innerHTML = ''; } else if (!cur) slot.innerHTML = chipHtml(); else if (cur.textContent !== t) cur.textContent = t; });
    if (p.length && p[0].pct >= 1 && now() - S.asked > 4000) { S.asked = now(); load(); }
  }
  if (doc) {
    setInterval(() => { if (S.data && S.data.sites.length && !doc.hidden && !(global.KWSession && global.KWSession.away && global.KWSession.away())) paint(); }, 1000);
    setInterval(() => { if (S.data && S.data.sites.length && !doc.hidden) load(); }, 30000);
    doc.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-kwbt]');
      if (!b) return;
      const k = b.getAttribute('data-kwbt');
      if (k === 'open') open(); else if (k === 'builder') chooseBuilder();
    });
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) load(); });
  }

  global.KWBuild = {
    load, onEvent, ordered, noBuilder, noteHtml, open, chipHtml,
    get data() { return S.data; },
    get on() { return !!(S.data && S.data.on); },
    sites, siteFor, houseSites, pct, stage,
    etaLine: id => etaLine(S.data, id, elapsed()),
    _minutesLine: minutesLine, _progress: progress, _etaMinutes: etaMinutes, _etaLine: etaLine, _orderLine: orderLine, _chipText: chipText, _moved: moved, _costLine: costLine,
    _set: (d, at) => { S.data = d; S.at = at == null ? now() : at; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
