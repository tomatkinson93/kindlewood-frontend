// ══════════════════════════════════════════════════════════════════════════
//  KWLife — memorials and inheritances (docs/PHASE_1_LIFE_CYCLE.md §4.4, §4.8).
//
//    KWLife.openMemorial(citizenId)   a small window: who they were, their
//        heirlooms, and who takes up their things (choose, or let the default
//        heir inherit when the day is up). Built on KWWindow (js/window.js).
//    KWLife.onEvent(ev)   memorial events open the window by themselves.
//
//  The dead live in citizensRemembered (js/citizens.js), not citizensData.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REL = { child: 'their child', partner: 'their partner', family: 'family' };

  function remembered() {
    return (typeof citizensRemembered !== 'undefined' && Array.isArray(citizensRemembered)) ? citizensRemembered
      : (Array.isArray(global.citizensRemembered) ? global.citizensRemembered : []);
  }
  function find(id) { return remembered().find(c => c.id === Number(id)) || null; }

  function hoursLeft(at) {
    const ms = new Date(at).getTime() - Date.now();
    if (!(ms > 0)) return 'soon';
    const h = Math.round(ms / 3600000);
    return h >= 1 ? `in about ${h} hour${h === 1 ? '' : 's'}` : 'within the hour';
  }

  // The window's body (pure apart from the citizen: proofs render it).
  function bodyHtml(c) {
    if (!c) return '<div class="kw-empty">They are remembered, but their record could not be found.</div>';
    const inh = c.inheritance;
    const parts = [];
    parts.push(`<p class="kwl-memorial">${esc(c.memorial || `${c.name} is remembered.`)}</p>`);
    if (inh && inh.items && inh.items.length) {
      parts.push(`<div class="kw-box"><div class="kw-box-title">Heirlooms</div>${inh.items.map(n => `<div class="kw-list-row"><span class="kw-list-row-icon">🗝</span><span class="kw-list-row-main">${esc(n)}</span></div>`).join('')}
        <div class="kw-note">Carried by their family, an heirloom works a little better: +5%, more with each generation it is handed down.</div></div>`);
    }
    if (inh && inh.status === 'open') {
      const opts = (inh.candidates || []).map(k => `<option value="${k.id}"${k.id === inh.heir_id ? ' selected' : ''}>${esc(k.name)} (${esc(REL[k.relation] || k.relation)}${k.adult ? '' : ', a child'})</option>`).join('');
      const dflt = (inh.candidates || []).find(k => k.id === inh.default_heir_id);
      parts.push(`<div class="kw-box"><div class="kw-box-title">Who takes up their things?</div>
        ${inh.trade && inh.xp ? `<div class="kw-list-row-sub">An heir who works as a ${esc(inh.trade)} also learns a quarter of what they knew.</div>` : ''}
        <label class="kwl-field">Heir <select data-kwl="heir" aria-label="Heir">${opts}</select></label>
        <div class="kwl-actions"><button type="button" class="kw-btn primary" data-action="pass">Pass them on now</button></div>
        <div class="kw-note">If you do nothing, ${esc(dflt ? dflt.name : 'their heir')} inherits ${hoursLeft(inh.settle_at)}.</div></div>`);
    } else if (inh && inh.status === 'settled') {
      parts.push(`<div class="kw-note good">${inh.heir_name ? `${esc(inh.heir_name)} took up their things.` : 'Their things went to the town\'s stores.'}</div>`);
    }
    return parts.join('');
  }

  async function refreshCitizens() {
    if (typeof global.loadCitizens === 'function') { try { await global.loadCitizens(); } catch (_) { /* offline */ } }
  }

  async function openMemorial(id) {
    if (!global.KWWindow) return;
    if (!find(id)) await refreshCitizens();
    const c = find(id);
    global.KWWindow.open({
      id: 'memorial-' + id, title: c ? `In memory of ${c.name}` : 'In memory', icon: '🕯', size: 'S',
      subtitle: c && c.died_at ? new Date(c.died_at).toLocaleDateString() : '',
      render(body) { body.innerHTML = bodyHtml(find(id)); },
      actions: {
        async pass(btn, ev, w) {
          const sel = w.body.querySelector('[data-kwl="heir"]');
          if (!sel || !sel.value) return;
          btn.disabled = true;
          try {
            const res = await global.apiFetch(`/api/citizens/${id}/heir`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heir_id: Number(sel.value) }) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) { btn.disabled = false; if (global.KWDialog) global.KWDialog.alert({ title: 'Could not pass them on', message: d.error || 'Try again in a moment.' }); return; }
            await refreshCitizens();
            w.refresh();
          } catch (e) { btn.disabled = false; }
        },
      },
    });
  }

  function onEvent(ev) {
    if (!ev || ev.type !== 'memorial') return;
    let ids = ev.citizen_ids;
    if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch (_) { ids = []; } }
    if (Array.isArray(ids) && ids[0]) openMemorial(ids[0]);
  }

  global.KWLife = { openMemorial, onEvent, _bodyHtml: bodyHtml };
})(typeof window !== 'undefined' ? window : globalThis);
