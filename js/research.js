// ══════════════════════════════════════════════════════════════════════════
//  RESEARCH — the Library panel.
//
//  Server: /api/research (kindlewood-server lib/research). Scholars at the
//  Library earn research points for one project at a time; with nothing
//  chosen, points bank (up to a cap) for the next one. The project tree is
//  js/research-defs.js (the server's twin).
//
//  Open: window.openLibrary()   Realtime: research_done (js/realtime.js).
//  Dev Tools (admins): "Finish now" on any project, "Reset research".
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };
  const byId = id => document.getElementById(id);
  const FIELDS = [['nature', '🔭 Nature', 'Ores, metals and smelting'], ['lore', '📜 Lore', 'Recipes, building and trade']];
  let _st = null, _busy = false;

  async function call(method, path, body) {
    const res = await global.apiFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // "3h 20m", "2d 4h"
  function fmtHours(h) {
    if (h == null || !isFinite(h)) return '—';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
    if (h < 48) { const H = Math.floor(h), m = Math.round((h - H) * 60); return H + 'h' + (m ? ' ' + m + 'm' : ''); }
    const d = Math.floor(h / 24); return d + 'd ' + Math.round(h - d * 24) + 'h';
  }
  const isAdmin = () => typeof global._kwIsAdmin === 'function' && global._kwIsAdmin();

  // What a project unlocks, in words (from js/research-defs.js).
  function unlocksText(key) {
    const R = global.KWResearch, D = global.KWResources;
    const p = R && R.project(key);
    if (!p) return '';
    const out = [];
    (p.resources || []).forEach(k => out.push(D ? D.icon(k) + ' ' + D.label(k) : k));
    (p.buildings || []).forEach(b => out.push('🏗 ' + b.charAt(0).toUpperCase() + b.slice(1)));
    (p.recipes || []).forEach(r => out.push('📜 ' + r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())));
    return out.join(' · ');
  }

  function card(p, st) {
    const pct = Math.min(100, Math.round(p.progress / p.cost * 100));
    const status = p.status === 'done' ? '<span class="rs-chip rs-done">✓ Studied</span>'
      : p.status === 'active' ? `<span class="rs-chip rs-on">Studying${st.eta_hours != null ? ' · ' + fmtHours(st.eta_hours) + ' left' : ''}</span>`
      : p.status === 'locked' ? `<span class="rs-chip rs-lock" title="${esc(p.blocked)}">🔒 ${esc(p.blocked)}</span>` : '';
    const btn = p.status === 'open' && st.library_level
      ? `<button type="button" class="cr-btn cr-btn-primary" data-rs="start" data-key="${esc(p.key)}">${p.progress > 0 ? 'Resume' : 'Study this next'}</button>` : '';
    const admin = isAdmin() && p.status !== 'done' ? `<button type="button" class="cr-btn rs-admin" data-rs="finish" data-key="${esc(p.key)}" title="Dev Tools">⚡ Finish now</button>` : '';
    const unl = unlocksText(p.key);
    return `<div class="rs-card rs-${p.status}" data-project="${esc(p.key)}">
      <div class="rs-c-head"><span class="rs-c-icon">${esc(p.icon)}</span>
        <div class="rs-c-title"><div class="rs-c-name">${esc(p.label)}</div><div class="rs-c-cost">${p.cost} points</div></div>${status}</div>
      <div class="rs-c-desc">${esc(p.desc)}</div>
      ${unl ? `<div class="rs-c-unl">${esc(unl)}</div>` : ''}
      ${p.status !== 'done' && p.progress > 0 ? `<div class="cf-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="cf-bar-fill" style="width:${pct}%"></div></div>
        <div class="rs-c-prog">${Math.floor(p.progress)} / ${p.cost}</div>` : ''}
      ${btn || admin ? `<div class="rs-c-act">${admin}${btn}</div>` : ''}
    </div>`;
  }

  function render() {
    const st = _st, body = byId('rs-body');
    if (!st || !body) return;
    byId('rs-sub').textContent = st.library_level
      ? `Level ${st.library_level} · ${st.scholars.length} / ${st.seats} Scholar${st.seats === 1 ? '' : 's'} studying · ${st.per_hour} points/hr`
      : 'No Library yet';
    const active = st.projects.find(p => p.status === 'active');
    const head = !st.library_level
      ? `<div class="rs-empty"><div class="rs-empty-icon">📚</div><p>Build a <b>Library</b> (Settlement → Scholars' Walk) and make a citizen a <b>Scholar</b>. Their study unlocks new ores, the Smelter, recipes and more.</p></div>`
      : `<div class="rs-top">
          <div class="rs-now">${active
            ? `<div class="rs-now-l">Studying</div><div class="rs-now-n">${esc(active.icon)} ${esc(active.label)}</div>
               <div class="cf-bar"><div class="cf-bar-fill" style="width:${Math.round(active.progress / active.cost * 100)}%"></div></div>
               <div class="rs-now-s">${Math.floor(active.progress)} / ${active.cost} · ${st.per_hour > 0 ? fmtHours(st.eta_hours) + ' to go' : 'no Scholars studying'}</div>`
            : `<div class="rs-now-l">Nothing chosen</div><div class="rs-now-s">${st.bank > 0 ? `${Math.floor(st.bank)} points banked (up to ${st.bank_cap}) — they go into the next project.` : 'Pick a project below.'}</div>`}</div>
          <div class="rs-scholars">${st.scholars.length ? st.scholars.map(s => `<span class="rs-sch">📖 ${esc(s.name)} <b>${s.per_hour != null ? s.per_hour : s.perHour}/hr</b></span>`).join('')
            : '<span class="cr-muted">No Scholars yet — give a citizen the Scholar job.</span>'}</div>
        </div>`;
    const groups = FIELDS.map(([f, label, sub]) => {
      const ps = st.projects.filter(p => p.field === f);
      return `<section class="rs-field"><div class="cf-h">${label} <span class="rs-field-sub">${sub}</span></div>
        <div class="rs-list">${ps.map(p => card(p, st)).join('')}</div></section>`;
    }).join('');
    const admin = isAdmin() ? '<div class="rs-adminbar"><button type="button" class="cr-btn rs-admin" data-rs="reset">🧹 Reset research (Dev Tools)</button></div>' : '';
    body.innerHTML = head + `<div class="rs-fields">${groups}</div>` + admin;
  }

  function modal() {
    let o = byId('rs-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'rs-overlay';
    o.className = 'cf-overlay rs-overlay';
    o.innerHTML = `<div class="cf-panel rs-panel" role="dialog" aria-modal="true" aria-labelledby="rs-title">
        <header class="cf-head"><div><h2 id="rs-title">📚 Library</h2><div class="cf-sub" id="rs-sub"></div></div>
          <button type="button" class="cr-x" data-rs="close" aria-label="Close">✕</button></header>
        <div class="cf-body rs-body" id="rs-body"></div>
      </div>`;
    document.body.appendChild(o);
    o.addEventListener('click', onClick);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && o.classList.contains('open')) close(); });
    return o;
  }
  function close() { const o = byId('rs-overlay'); if (o) o.classList.remove('open'); }

  async function load() {
    try { _st = await call('GET', '/api/research'); render(); }
    catch (e) { const b = byId('rs-body'); if (b) b.innerHTML = `<div class="cr-muted cf-pad">${esc(e.message)}</div>`; }
  }
  async function open() {
    const o = modal();
    o.classList.add('open');
    byId('rs-sub').textContent = 'Loading…';
    byId('rs-body').innerHTML = '<div class="cr-muted cf-pad">Lighting the candles…</div>';
    await load();
  }

  async function onClick(e) {
    if (e.target.id === 'rs-overlay') return close();
    const b = e.target.closest('[data-rs]');
    if (!b || _busy) return;
    const act = b.dataset.rs, key = b.dataset.key;
    if (act === 'close') return close();
    _busy = true;
    try {
      if (act === 'start') {
        _st = await call('POST', '/api/research/start', { project: key });
        const p = _st.projects.find(x => x.key === key);
        toast(p && p.status === 'done' ? `📚 Your banked points finished ${p.label}!` : `📚 Your Scholars are studying ${p ? p.label : key}.`);
      }
      if (act === 'finish') _st = await call('POST', '/api/research/admin/complete', { project: key });
      if (act === 'reset' && global.confirm('Forget all of your town\'s research?')) _st = await call('POST', '/api/research/admin/reset', {});
      render();
    } catch (err) { toast(err.message, 'error'); }
    finally { _busy = false; }
  }

  // Realtime: a project finished (the scholars' clock or Dev Tools).
  function onEvent(ev) {
    if (!ev || ev.type !== 'research_done') return;
    const list = ev.many || [ev];
    for (const x of list) toast(`${x.icon || '📚'} Research finished: ${x.label}! ${x.desc || ''}`);
    const o = byId('rs-overlay');
    if (o && o.classList.contains('open')) load();
  }

  global.KWLibrary = { open, close, load, onEvent, fmtHours, unlocksText, _state: () => _st, _render: render, _setState(s) { _st = s; } };
  global.openLibrary = open;
})(typeof window !== 'undefined' ? window : this);
