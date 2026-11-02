// ══════════════════════════════════════════════════════════════════════════
//  KWFirstSteps — a checklist for a new town, at the top of your settlement
//  panel. GET /api/game/first-steps works the steps out from what the town
//  has done; "Hide" (POST /api/game/first-steps/dismiss) puts it away for
//  good, and it bows out by itself (with a toast) once every step is done.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const OPEN_KEY = 'kw_first_steps_open', DONE_KEY = 'kw_first_steps_done';
  let _data = null;
  const ls = (k, v) => { try { if (v === undefined) return global.localStorage.getItem(k); global.localStorage.setItem(k, v); } catch (e) { return null; } return null; };

  // Where "Show me" takes you.
  const SHOW = {
    build: () => global.openSettlementView && global.openSettlementView(),
    citizens: () => global.openAllCitizens && global.openAllCitizens(),
    tavern: () => global.visitTavern && global.visitTavern(),
    map: () => { if (global.navGoMap) global.navGoMap(); if (global.closePanel) global.closePanel(); },
    research: () => (global._hasBuilding && global._hasBuilding('library') && global.openLibrary) ? global.openLibrary() : global.openSettlementView && global.openSettlementView(),
    market: () => (global._hasBuilding && global._hasBuilding('market') && global.openMarket) ? global.openMarket() : global.openSettlementView && global.openSettlementView(),
  };

  function cardHtml(d) {
    if (!d || d.dismissed || d.done >= d.total) return '';
    const open = ls(OPEN_KEY) !== '0';
    const next = d.steps.find(s => !s.done);
    const rows = d.steps.map(s => `<li class="fs-step${s.done ? ' done' : ''}">
        <span class="fs-tick" aria-hidden="true">${s.done ? '✔' : s.icon}</span>
        <span class="fs-text"><b>${esc(s.title)}</b>${s.done ? '' : `<small>${esc(s.hint)}</small>`}</span>
        ${s.done ? '<span class="fs-sr">Done</span>' : `<button type="button" class="fs-show" data-fs-show="${esc(s.show)}">Show me</button>`}
      </li>`).join('');
    return `<details class="fs-card"${open ? ' open' : ''} ontoggle="KWFirstSteps.toggled(this)">
      <summary><span class="fs-title">🌱 First steps</span><span class="fs-count">${d.done}/${d.total}</span>
        <span class="fs-bar" role="progressbar" aria-label="First steps done" aria-valuemin="0" aria-valuemax="${d.total}" aria-valuenow="${d.done}"><span style="width:${Math.round(d.done / d.total * 100)}%"></span></span></summary>
      ${next ? `<div class="fs-next">Next: ${esc(next.icon)} ${esc(next.title)}</div>` : ''}
      <ol class="fs-list">${rows}</ol>
      <div class="fs-foot"><button type="button" class="fs-hide" data-fs-hide="1">Hide this checklist</button></div>
    </details>`;
  }

  function paint() {
    const slot = global.document && global.document.getElementById('fs-slot');
    if (slot) slot.innerHTML = cardHtml(_data);
  }

  let _at = 0;
  async function load(force) {
    if (!force && _data && Date.now() - _at < 30000) { paint(); return _data; }   // panel re-renders often
    _at = Date.now();
    try {
      const r = await global.apiFetch('/api/game/first-steps');
      if (!r.ok) return null;
      _data = await r.json();
      if (!_data.dismissed && _data.done >= _data.total && ls(DONE_KEY) !== '1') {
        ls(DONE_KEY, '1');
        if (typeof global.showToastNotification === 'function') global.showToastNotification('🌱 First steps complete — your town is finding its feet!', 'default');
      }
      paint();
      return _data;
    } catch (e) { return null; }
  }

  async function dismiss() {
    const ok = global.KWDialog ? await global.KWDialog.confirm({ title: 'Hide the first steps?', message: 'You can still find everything in ❓ Help.', ok: 'Hide' }) : true;
    if (!ok) return;
    await global.apiFetch('/api/game/first-steps/dismiss', { method: 'POST' }).catch(() => {});
    if (_data) _data.dismissed = true;
    paint();
  }

  function toggled(el) { ls(OPEN_KEY, el.open ? '1' : '0'); }

  if (global.document) {
    global.document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-fs-show], [data-fs-hide]');
      if (!b || !b.closest('.fs-card')) return;
      if (b.dataset.fsHide) return dismiss();
      const fn = SHOW[b.dataset.fsShow];
      if (fn) fn();
    });
  }

  global.KWFirstSteps = { load, dismiss, toggled, cardHtml: d => cardHtml(d === undefined ? _data : d), state: () => _data, _show: SHOW };
})(typeof window !== 'undefined' ? window : globalThis);
