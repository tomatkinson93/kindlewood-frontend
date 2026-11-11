// ══════════════════════════════════════════════════════════════════════════
//  Dev Tools → 📈 New players: where new players stop (admins only).
//  Server: GET /api/funnel?days=N (lib/milestones.js). Each row is the share
//  of players who registered in the window and reached that step, and the
//  median time it took them from registering.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function took(min) {
    if (min == null) return '—';
    if (min < 1) return 'under a minute';
    if (min < 90) return `${min} min`;
    if (min < 48 * 60) return `${Math.round(min / 60)} h`;
    return `${Math.round(min / 1440)} days`;
  }
  // The table (pure, for proofs).
  function html(d) {
    if (!d || !d.steps) return '<div class="dev-raid-status">No data.</div>';
    if (!d.players) return `<div class="dev-raid-status">Nobody registered in the last ${Number(d.days)} days.</div>`;
    const rows = d.steps.map((s, i) => {
      const prev = i ? d.steps[i - 1] : null;
      const drop = prev && prev.players ? Math.round((1 - s.players / prev.players) * 100) : 0;
      return `<tr><td>${esc(s.label)}</td><td class="fn-n">${Number(s.players)}</td>
        <td class="fn-bar"><span style="width:${Math.max(0, Math.min(100, s.pct))}%"></span><b>${s.pct}%</b></td>
        <td class="fn-n">${esc(took(s.median_minutes))}</td><td class="fn-n${drop >= 40 ? ' fn-bad' : ''}">${i && drop > 0 ? '−' + drop + '%' : ''}</td></tr>`;
    }).join('');
    return `<table class="fn-table"><thead><tr><th>Step</th><th>Players</th><th>Share of ${Number(d.players)}</th><th>Typical time</th><th>Lost since the step above</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="dev-raid-status">Players who registered in the last ${Number(d.days)} days. Steps are recorded from the day this shipped, so older players show only what they have done since.</div>`;
  }
  async function load() {
    const box = document.getElementById('dev-funnel');
    if (!box) return;
    const days = Number((document.getElementById('dev-funnel-days') || {}).value) || 30;
    box.innerHTML = '<div class="dev-raid-status">Counting…</div>';
    try {
      const res = await global.apiFetch('/api/funnel?days=' + days);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load.');
      box.innerHTML = html(d);
    } catch (e) { box.innerHTML = `<div class="dev-raid-status">${esc(e.message)}</div>`; }
  }
  global.KWFunnel = { load, html, took };
})(typeof window !== 'undefined' ? window : this);
