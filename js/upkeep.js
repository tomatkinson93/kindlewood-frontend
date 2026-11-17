// ══════════════════════════════════════════════════════════════════════════
//  KWUpkeep — building health, as the player sees it
//  (docs/HOME_SCENE.md Part E; the server's lib/upkeep.js decides).
//
//  Builders look after the town. Buildings nobody covers wear: worn (under
//  60) still works, broken (0) gives nothing until a builder mends it. This
//  file reads the town's upkeep (GET /api/upkeep), shows its one line by the
//  town card (amber when builders are short), gives the scenes each
//  building's look, and sends "Repair now". Nothing is decided here.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const S = { data: null, loading: null, busy: false };
  const toast = (m, t) => { if (typeof global.showToastNotification === 'function') global.showToastNotification(m, t || 'default'); };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // The same three states as the server: sound from 60, worn under it, broken at 0.
  const stateOf = h => (h == null ? null : Number(h) <= 0 ? 'broken' : Number(h) < 60 ? 'worn' : 'sound');
  const STATE = { sound: 'Sound', worn: 'Worn (still works)', broken: 'Broken: gives nothing until it is mended' };
  const HOME_BROKEN = 'Broken: it keeps its beds, and needs mending';
  // The class a building's button gets ('' when sound, or upkeep is off).
  const lookOf = state => (state === 'broken' ? 'kwu-broken' : state === 'worn' ? 'kwu-worn' : '');
  // The health line in a building's panel or a home's window. `o`: { health,
  // state, repair (in the builders' queue), on }.
  function healthHtml(o, attrs = '') {
    if (!o || !o.on || o.health == null || !o.state) return '';
    const btn = o.health >= 100 ? '' : o.repair ? '<span class="kwu-inhand">🛠️ The builders have the repair in hand</span>'
      : `<button type="button" class="kwu-repair" ${attrs}>🛠️ Repair now</button>`;
    const words = o.home && o.state === 'broken' ? HOME_BROKEN : STATE[o.state];   // a broken home keeps its beds
    return `<div class="kwu-health kwu-is-${o.state}"><div class="kwu-health-top"><b>Condition</b><span>${esc(words)} · ${Math.round(o.health)}%</span></div>`
      + `<span class="kwu-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(o.health)}" aria-label="Condition"><i style="width:${Math.max(0, Math.min(100, o.health))}%"></i></span>`
      + (btn ? `<div class="kwu-health-act">${btn}${o.health < 100 && !o.repair ? '<span class="kwu-hint">Builders also mend things by themselves when they have nothing to build.</span>' : ''}</div>` : '') + '</div>';
  }
  // The chip by the town card: the server's line, amber when builders are short.
  function chipHtml(d) {
    if (!d || !d.on) return '';
    const broken = (d.damaged || []).filter(u => u.state === 'broken').length;
    return `<div class="kwu-chip${d.short || broken ? ' kwu-chip-short' : ''}" role="status"><span aria-hidden="true">${d.short || broken ? '⚠️' : '🧰'}</span> <span>${esc(d.line)}${broken ? ` · ${broken} broken` : ''}</span></div>`;
  }

  // ── Data ────────────────────────────────────────────────────────────────
  const signedIn = () => { try { return !!global.localStorage.getItem('kw_token'); } catch (_) { return false; } };
  function take(d) {
    const was = JSON.stringify(S.data && [S.data.on, S.data.line, (S.data.damaged || []).map(u => u.kind + u.id + u.state)]);
    S.data = d;
    const now = JSON.stringify([d.on, d.line, (d.damaged || []).map(u => u.kind + u.id + u.state)]);
    paint();
    if (was !== now) { try { global.dispatchEvent(new global.CustomEvent('kw:upkeep', { detail: { on: !!d.on } })); } catch (_) { /* old browser */ } }
  }
  async function load() {
    if (!signedIn() || typeof global.apiFetch !== 'function') return null;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      try { const r = await global.apiFetch('/api/upkeep'); if (r.ok) { const d = await r.json(); if (d && d.ok && d.upkeep) take(d.upkeep); } } catch (_) { /* later */ }
      S.loading = null;
      return S.data;
    })();
    return S.loading;
  }
  function paint() {
    if (!doc) return;
    const html = chipHtml(S.data);
    doc.querySelectorAll('#kwu-slot, .kwc-upkeep').forEach(el => { if (el.innerHTML !== html) el.innerHTML = html; });
  }
  // "Repair now": to the front of the builders' queue. target: { type } or { house_id }.
  async function repair(target) {
    if (S.busy) return null;
    S.busy = true;
    try {
      const r = await global.apiFetch('/api/upkeep/repair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { if (!d.paused) toast('⚠️ ' + (d.error || 'That did not work. Try again.')); return null; }
      if (d.upkeep) take(d.upkeep);
      const what = (target.type ? 'the ' : '') + d.repair.label;
      toast(d.repair.no_builder ? `🛠️ The repair of ${what} is first in the builders' list, but nobody is a builder.` : `🛠️ The builders will mend ${what} next.`);
      if (global.KWBuild) { global.KWBuild.load(); if (d.repair.no_builder) global.KWBuild.noBuilder(); }
      return d;
    } catch (_) { toast('⚠️ Network error. Try again.'); return null; } finally { S.busy = false; }
  }
  function onEvent(ev) {
    if (ev && (ev.what === 'broke' || ev.what === 'mended' || ev.what === 'unattended') && ev.text) toast((ev.what === 'mended' ? '🛠️ ' : ev.what === 'broke' ? '🏚️ ' : '⏳ ') + ev.text);
    load();
    // The buildings and homes carry their own health: they are read again.
    const again = f => { try { const r = f(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* not loaded */ } };
    if (typeof global.refreshSettlementView === 'function') again(() => global.refreshSettlementView());
    if (global.KWHood && global.KWHood.reload && global.KWHood.data) again(() => global.KWHood.reload());
  }

  if (doc) {
    doc.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-kwu-repair], [data-kwu-repair-house]');
      if (!b) return;
      const house = b.getAttribute('data-kwu-repair-house');
      b.disabled = true;
      repair(house ? { house_id: Number(house) } : { type: b.getAttribute('data-kwu-repair') }).then(d => {
        if (!d) { b.disabled = false; return; }
        if (typeof global._closeBuildPanel === 'function') global._closeBuildPanel();
        if (typeof global.refreshSettlementView === 'function') global.refreshSettlementView();
        if (house && global.KWHood && global.KWHood.reload) global.KWHood.reload();
      });
    });
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) load(); });
    global.addEventListener('kw:built', () => load());   // a repair finished
    setInterval(() => { if (S.data && S.data.on && !doc.hidden && typeof global._svIsOpen === 'function' && global._svIsOpen()) load(); }, 120000);
  }

  global.KWUpkeep = {
    load, onEvent, repair, chipHtml: () => chipHtml(S.data), healthHtml, stateOf, lookOf,
    get data() { return S.data; },
    get on() { return !!(S.data && S.data.on); },
    _chipHtml: chipHtml, _set: d => { S.data = d; }, STATE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
