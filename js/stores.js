// ══════════════════════════════════════════════════════════════════════════
//  Stores — the ores, rare materials and alloys beyond the topbar's five.
//
//  • A "⛏ Stores" pill after Wealth (hidden until the town discovers one)
//    opens a popover: what the town holds, its rate, and how many are still
//    undiscovered ("?? — not yet discovered").
//  • "New discovery!" cards for discoveries the player hasn't seen
//    (settlement.new_discoveries), then POST /api/game/discoveries/seen.
//
//  Reads tickResources / tickRates (js/game.js) and gameData.settlement
//  (resources, discovered). The resource list is js/resource-defs.js.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const R = () => window.KWResources;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString();

  function known() { return R().knownSet((gameData && gameData.settlement && gameData.settlement.discovered) || []); }
  function amounts() {
    const base = (gameData && gameData.settlement && gameData.settlement.resources) || {};
    return { ...base, ...(typeof tickResources !== 'undefined' && tickResources ? tickResources : {}) };
  }
  function rateOf(k) {
    const r = (typeof tickRates !== 'undefined' && tickRates) || (gameData && gameData.settlement && gameData.settlement.rates) || {};
    return Number(r[k]) || 0;
  }
  const discoveredExtras = () => { const kn = known(); return R().EXTRA.filter(k => kn[k]); };

  // ── Topbar pill ────────────────────────────────────────────────────────────
  function ensurePill() {
    let el = document.getElementById('res-stores');
    if (el) return el;
    const anchor = document.getElementById('res-wealth');
    if (!anchor) return null;
    el = document.createElement('div');
    el.className = 'res res-stores';
    el.id = 'res-stores';
    el.hidden = true;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-haspopup', 'dialog');
    el.title = 'Ores, rare materials and alloys';
    el.innerHTML = '<span class="rs-pick" aria-hidden="true">⛏</span><span class="res-val">Stores</span><span class="rs-caret" aria-hidden="true">▾</span>';
    el.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    anchor.insertAdjacentElement('afterend', el);
    return el;
  }

  function render() {
    if (!R()) return;
    const el = ensurePill();
    if (!el) return;
    const extras = discoveredExtras();
    el.hidden = !extras.length;
    if (extras.length) el.querySelector('.res-val').textContent = 'Stores · ' + extras.length;
    const pop = document.getElementById('stores-pop');
    if (pop && pop.classList.contains('open')) pop.innerHTML = popHtml();
  }

  function popHtml() {
    const kn = known(), have = amounts();
    const groups = ['ore', 'rare', 'alloy'];
    let hidden = 0;
    const body = groups.map(g => {
      const keys = R().EXTRA.filter(k => R().def(k).group === g);
      const rows = keys.filter(k => kn[k]).map(k => {
        const rate = rateOf(k);
        return `<div class="sp-row"><span class="sp-ic">${R().icon(k)}</span><span class="sp-name">${esc(R().label(k))}</span>
          <span class="sp-val">${fmt(have[k])}</span><span class="sp-rate">${rate > 0 ? '+' + (Math.round(rate * 10) / 10) + '/hr' : ''}</span></div>`;
      });
      hidden += keys.length - rows.length;
      if (!rows.length) return '';
      return `<div class="sp-group">${esc(R().GROUP_LABEL[g])}</div>` + rows.join('');
    }).join('');
    return `<div class="sp-head">⛏ Stores <button class="sp-x" aria-label="Close" onclick="KWStores.close()">✕</button></div>
      ${body}
      ${hidden ? `<div class="sp-row sp-unknown"><span class="sp-ic">❔</span><span class="sp-name">?? — ${hidden} more not yet discovered</span></div>
        <div class="sp-hint">Mines, hills and mountain outposts turn up ores. Rarer finds need research${typeof openLibrary === 'function' ? ' — <button type="button" class="sp-link" onclick="KWStores.close();openLibrary()">📚 Library</button>' : ''}.</div>` : ''}`;
  }

  function toggle() {
    let pop = document.getElementById('stores-pop');
    if (pop && pop.classList.contains('open')) return close();
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'stores-pop';
      pop.className = 'stores-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Stores');
      pop.addEventListener('click', e => e.stopPropagation());
      document.body.appendChild(pop);
    }
    pop.innerHTML = popHtml();
    const a = document.getElementById('res-stores').getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = (a.bottom + 6) + 'px';
    pop.classList.add('open');
  }
  function close() { const p = document.getElementById('stores-pop'); if (p) p.classList.remove('open'); }
  document.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  // ── New discovery cards ────────────────────────────────────────────────────
  let _showing = false;
  function showDiscoveries(list) {
    list = (list || []).filter(d => R() && R().isResource(d.key));
    if (!list.length || _showing) return;
    _showing = true;
    const ov = document.createElement('div');
    ov.className = 'disc-overlay';
    ov.innerHTML = `<div class="disc-card" role="dialog" aria-modal="true" aria-labelledby="disc-h">
      <div class="disc-burst" aria-hidden="true">${list.map(d => `<span>${esc(R().icon(d.key))}</span>`).join('')}</div>
      <h3 id="disc-h">${list.length === 1 ? 'New discovery!' : list.length + ' new discoveries!'}</h3>
      ${list.map(d => `<div class="disc-item"><b>${esc(R().icon(d.key))} ${esc(R().label(d.key))}</b>
        <span>${esc(R().sourceHint(d.key) || '')}</span></div>`).join('')}
      <p class="disc-note">Recipes that called for it no longer show “??”. It's in your ⛏ Stores.</p>
      <button class="disc-ok">Wonderful</button></div>`;
    const done = () => {
      ov.remove(); _showing = false;
      apiFetch('/api/game/discoveries/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: list.map(d => d.key) }) }).catch(() => {});
      if (gameData && gameData.settlement) gameData.settlement.new_discoveries = [];
    };
    ov.querySelector('.disc-ok').onclick = done;
    ov.addEventListener('click', e => { if (e.target === ov) done(); });
    document.body.appendChild(ov);
    ov.querySelector('.disc-ok').focus();
  }

  // A settlement payload arrived (page load, sync): refresh both.
  function onSettlement(s) {
    if (!s) return;
    render();
    if (s.new_discoveries && s.new_discoveries.length) showDiscoveries(s.new_discoveries);
  }

  // Dev Tools → Resources: one +50 button per ore, rare material and alloy.
  function fillCheatGrid() {
    const g = document.getElementById('cheat-extras-grid');
    if (!g || !R() || g.childElementCount) return;
    g.innerHTML = R().EXTRA.map(k => `<button class="cheat-res-btn" onclick="applyCheat('${k}',50)">${R().icon(k)} +50 ${esc(R().label(k))}</button>`).join('');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillCheatGrid); else fillCheatGrid();

  // Realtime: an expedition came home with a handful of ore.
  function onOreSample(ev) {
    if (!ev || !R() || !R().isResource(ev.resource)) return;
    const k = ev.resource;
    if (gameData && gameData.settlement) {
      const res = gameData.settlement.resources = gameData.settlement.resources || {};
      res[k] = (Number(res[k]) || 0) + (Number(ev.qty) || 0);
      if (typeof tickResources !== 'undefined' && tickResources) tickResources[k] = (Number(tickResources[k]) || 0) + (Number(ev.qty) || 0);
      const d = gameData.settlement.discovered = gameData.settlement.discovered || [];
      if (ev.discovered && d.indexOf(k) < 0) d.push(k);
    }
    if (typeof showBuildToast === 'function') showBuildToast(`${R().icon(k)} Your expedition brought back ${ev.qty} ${R().label(k).toLowerCase()}`, 'success');
    if (ev.discovered) showDiscoveries([{ key: k }]);
    render();
  }

  window.KWStores = { render, toggle, close, showDiscoveries, onSettlement, onOreSample, popHtml };
})();
