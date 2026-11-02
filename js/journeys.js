// ══════════════════════════════════════════════════════════════════════════
//  KWJourneys — everyone who is away, in one list.
//
//    On the road   scouts, envoys, merchants and porters, quest parties and
//                  clan quests (KWTravel / GET /api/travel), with time left,
//                  "Show on map", and Recall for scouts
//                  (POST /api/expeditions/:id/recall)
//    At outposts   workers and garrisons posted out (GET /api/outposts)
//    Requests      what villages that trade with you want (KWRequests)
//
//  Opened from the settlement panel (🧭 Journeys) and the phone More sheet.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let _timer = null, _outposts = [];

  function fmtLeft(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }

  // One traveller's row (pure, for proofs). `t` is now (ms).
  function rowHtml(j, t) {
    const T = global.KWTravel;
    const ph = T ? T.phase(j, t) : { leg: 'out', p: 0 };
    const left = T ? T.secondsLeft(j, t) : 0;
    const leg = ph.leg === 'back' ? 'Coming home' : j.returns_at ? 'Outbound' : j.incoming ? 'On the way to you' : 'Travelling';
    const end = ph.leg === 'back' ? j.returns_at : j.arrives_at;
    const recall = j.kind === 'scout' && j.expedition_id && !j.recalled
      ? `<button type="button" class="jn-btn" data-jn-recall="${Number(j.expedition_id)}">↩ Recall</button>` : '';
    return `<div class="jn-row" data-jn-id="${esc(j.id)}">
      <div class="jn-icon" aria-hidden="true">${esc(j.icon || '🧭')}</div>
      <div class="jn-main">
        <div class="jn-who"><b>${esc((j.citizen && j.citizen.name) || 'Someone')}</b> · ${esc(j.title || '')}</div>
        <div class="jn-sub">${esc(leg)}${j.detail ? ' · ' + esc(j.detail) : ''}</div>
        <div class="jn-bar" aria-hidden="true"><span style="width:${Math.round((ph.p || 0) * 100)}%"></span></div>
      </div>
      <div class="jn-side">
        <div class="jn-time" data-jn-end="${esc(end)}">${fmtLeft(left)}</div>
        <button type="button" class="jn-btn" data-jn-map="${esc(j.id)}">Show on map</button>
        ${recall}
      </div>
    </div>`;
  }

  function outpostHtml(list) {
    const rows = [];
    for (const o of list || []) {
      const crew = [...(o.workers || []).map(c => ({ ...c, post: 'worker' })), ...(o.garrison || []).map(c => ({ ...c, post: 'garrison' }))];
      for (const c of crew) {
        rows.push(`<div class="jn-row"><div class="jn-icon" aria-hidden="true">${c.post === 'garrison' ? '🛡️' : '⛏️'}</div>
          <div class="jn-main"><div class="jn-who"><b>${esc(c.name)}</b> · ${c.post === 'garrison' ? 'Guarding' : 'Working at'} the ${esc(o.name || 'outpost')}</div></div>
          <div class="jn-side"><button type="button" class="jn-btn" data-jn-tile="${Number(o.tile_q)},${Number(o.tile_r)}">Show on map</button></div></div>`);
      }
    }
    return rows.join('');
  }

  function requestsHtml(list, hasMarket) {
    const R = global.KWRequests;
    return (list || []).map(r => `<div class="jn-row"><div class="jn-icon" aria-hidden="true">📣</div>
      <div class="jn-main"><div class="jn-who"><b>${esc(r.npc && r.npc.name)}</b> needs ${esc(R ? R.what(r) : r.qty)}</div>
        <div class="jn-sub">By ${esc(r.by)} · +${Number(r.trust_bonus) || 0} trust${r.remaining < r.qty ? ` · ${Number(r.remaining)} left` : ''}</div></div>
      <div class="jn-side">${hasMarket ? `<button type="button" class="jn-btn" data-jn-fill="${Number(r.npc && r.npc.id)}">Fill in the Market</button>` : '<span class="jn-muted">Build a Market to fill it.</span>'}</div></div>`).join('');
  }

  function bodyHtml(journeys, outposts, requests, hasMarket, t) {
    const road = journeys.length ? journeys.map(j => rowHtml(j, t)).join('') : '<div class="jn-empty">Everyone is at home.</div>';
    const posts = outpostHtml(outposts);
    const reqs = requestsHtml(requests, hasMarket);
    return `<h3 class="jn-h">🛤️ On the road <span class="jn-count">${journeys.length}</span></h3>${road}
      <h3 class="jn-h">🏕️ At outposts</h3>${posts || '<div class="jn-empty">No one is posted at an outpost.</div>'}
      <h3 class="jn-h">📣 Village requests <span class="jn-count">${(requests || []).length}</span></h3>${reqs || '<div class="jn-empty">No village wants anything right now.</div>'}`;
  }

  function el() {
    let o = global.document.getElementById('jn-overlay');
    if (o) return o;
    o = global.document.createElement('div');
    o.id = 'jn-overlay';
    o.className = 'jn-overlay';
    o.innerHTML = `<div class="jn-card" role="dialog" aria-modal="true" aria-labelledby="jn-title">
      <div class="jn-head"><div class="jn-title" id="jn-title">🧭 Journeys <button type="button" class="kw-help-q" aria-label="How this works" title="How this works" onclick="KWHelp.open('travel')">?</button></div>
        <button type="button" class="jn-close" aria-label="Close" onclick="KWJourneys.close()">✕</button></div>
      <div class="jn-body" id="jn-body"><div class="jn-empty">Loading…</div></div></div>`;
    o.addEventListener('click', onClick);
    global.document.body.appendChild(o);
    return o;
  }

  function render() {
    const body = global.document.getElementById('jn-body');
    if (!body) return;
    const T = global.KWTravel, R = global.KWRequests;
    const t = T ? T.now() : Date.now();
    body.innerHTML = bodyHtml(T ? T.journeys() : [], _outposts, R && R.all ? R.all() : [], R && R.hasMarket ? R.hasMarket() : false, t);
  }

  function tick() {
    const T = global.KWTravel;
    const t = T ? T.now() : Date.now();
    let ended = false;
    global.document.querySelectorAll('#jn-body [data-jn-end]').forEach(c => {
      const sec = (Date.parse(c.dataset.jnEnd) - t) / 1000;
      if (sec <= 0) ended = true;
      c.textContent = fmtLeft(sec);
    });
    if (ended) render();
  }

  async function open() {
    const o = el();
    o.classList.add('open');
    render();
    const T = global.KWTravel, R = global.KWRequests;
    await Promise.all([
      T && T.refresh ? T.refresh() : null,
      R && R.check ? R.check() : null,
      global.apiFetch('/api/outposts').then(r => r.ok ? r.json() : null).then(d => { _outposts = (d && d.outposts) || []; }).catch(() => {}),
    ]);
    render();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(tick, 1000);
    const c = o.querySelector('.jn-close'); if (c) c.focus();
  }
  function close() {
    const o = global.document.getElementById('jn-overlay');
    if (o) o.classList.remove('open');
    if (_timer) { clearInterval(_timer); _timer = null; }
  }
  function isOpen() { const o = global.document.getElementById('jn-overlay'); return !!(o && o.classList.contains('open')); }

  // Where someone is right now on their route.
  function whereNow(j, t) {
    const T = global.KWTravel;
    const ph = T.phase(j, t);
    const a = ph.leg === 'back' ? j.to : j.from, b = ph.leg === 'back' ? j.from : j.to;
    const line = T.hexLine(a, b);
    const step = line[Math.min(line.length - 1, Math.round((ph.p || 0) * (line.length - 1)))] || { dq: 0, dr: 0 };
    return { q: a.q + step.dq, r: a.r + step.dr };
  }
  function showTile(q, r) {
    close();
    if (typeof global.navGoMap === 'function') global.navGoMap();
    if (typeof camera !== 'undefined') { camera.q = q; camera.r = r; }   // eslint-disable-line no-undef
    if (global.KWMap && global.KWMap.controller) global.KWMap.controller.requestRender();
  }

  async function recall(id, btn) {
    const ok = global.KWDialog ? await global.KWDialog.confirm({ title: 'Call this scout home?', message: 'They turn back where they are and walk home. Nothing new will be revealed.', ok: 'Recall' }) : true;
    if (!ok) return;
    if (btn) btn.disabled = true;
    const r = await global.apiFetch(`/api/expeditions/${id}/recall`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (btn) btn.disabled = false;
      if (global.KWDialog) global.KWDialog.alert({ title: 'Could not recall', message: d.error || 'Failed.' });
      return;
    }
    if (typeof global.showToastNotification === 'function') global.showToastNotification(`↩ The scout turns for home — back in ${fmtLeft(d.seconds || 0)}.`, 'default');
    if (global.KWTravel) await global.KWTravel.refresh();
    if (typeof global.loadExpeditions === 'function') { try { global.loadExpeditions(); } catch (_) { /* optional */ } }
    render();
  }

  function onClick(e) {
    const o = global.document.getElementById('jn-overlay');
    if (e.target === o) return close();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.jnRecall) return recall(Number(b.dataset.jnRecall), b);
    if (b.dataset.jnMap) {
      const T = global.KWTravel;
      const j = T && T.all().find(x => x.id === b.dataset.jnMap);
      if (j) { const p = whereNow(j, T.now()); showTile(p.q, p.r); }
      return;
    }
    if (b.dataset.jnTile) { const [q, r] = b.dataset.jnTile.split(',').map(Number); return showTile(q, r); }
    if (b.dataset.jnFill) { close(); if (global.KWRequests) global.KWRequests.fill(Number(b.dataset.jnFill)); }
  }

  global.openJourneys = open;
  global.KWJourneys = { open, close, isOpen, recall, _rowHtml: rowHtml, _bodyHtml: bodyHtml, _whereNow: whereNow, _fmtLeft: fmtLeft };
})(typeof window !== 'undefined' ? window : globalThis);
