// ══════════════════════════════════════════════════════════════════════════
//  Dev Tools → 📊 Careers: the server-wide balance overview and the live
//  tuning multipliers (GET /api/careers/admin/balance, POST …/tuning).
//
//  Per class: how many citizens, a level histogram (Lv1–20), the median
//  level and XP per hour worked, average hours, forks chosen. Then crafts
//  per day by quality, discoveries and research over the last 7 days.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = id => document.getElementById(id);
  const toast = (m, t) => { if (typeof global.showBuildToast === 'function') global.showBuildToast(m, t || 'success'); };
  const QCOL = { basic: '#b8b0a0', sturdy: '#8fbf7a', fine: '#6aa8e0', superior: '#b77ff0', legendary: '#f4a83a', smelted: '#e86f28' };
  const num = v => (v == null ? '—' : String(v));

  async function call(method, path, body) {
    const res = await global.apiFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // 20 bars, one per level; the tallest fills the box.
  function histogram(levels) {
    const max = Math.max(1, ...levels);
    return `<div class="cb-hist" role="img" aria-label="${esc(levels.map((n, i) => `Lv${i + 1}: ${n}`).filter((x, i) => levels[i]).join(', ') || 'nobody')}">${
      levels.map((n, i) => `<span style="height:${Math.round(n / max * 100)}%" title="Lv${i + 1}: ${n}"></span>`).join('')}</div>`;
  }

  function html(d) {
    const tuning = d.tuning.map(t => `<div class="cb-tune">
        <div class="cb-tune-l"><b>${esc(t.label)}</b><div class="ra-muted cb-tight">${esc(t.desc)}</div></div>
        <input class="ce-input cb-tune-in" type="number" min="0" max="5" step="0.05" value="${t.value}" data-cb-key="${esc(t.key)}" aria-label="${esc(t.label)} multiplier">
        <button type="button" class="qa-btn ra-btn" data-cb-save="${esc(t.key)}">Save</button></div>`).join('');
    const classes = d.classes.map(c => `<tr>
        <td>${esc(c.icon)} ${esc(c.label)}</td><td>${c.citizens}</td><td>${histogram(c.levels)}</td>
        <td>${num(c.median_level)}</td><td>${num(c.median_xp_per_hour)}</td><td>${num(c.avg_hours)}</td>
        <td>${Object.entries(c.forks).map(([k, n]) => `${esc(k)} ${n}`).join(', ') || '—'}</td></tr>`).join('');
    const days = d.crafting.days.length ? d.crafting.days.map(x => `<tr><td>${esc(x.day)}</td>${['basic', 'sturdy', 'fine', 'superior', 'legendary', 'smelted']
      .map(q => `<td style="color:${QCOL[q]}">${x[q] || 0}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="7" class="ra-muted">No crafts in the last 7 days.</td></tr>';
    const src = Object.entries(d.discoveries.by_source).map(([k, n]) => `${esc(k)} ${n}`).join(' · ') || 'none';
    const proj = Object.entries(d.research.by_project).map(([k, n]) => `${esc(global.KWResearch ? global.KWResearch.label(k) : k)} ${n}`).join(' · ') || 'none';
    return `
      <div class="qa-section-label">Tuning — live multipliers (1 = as designed)</div>
      <div class="cb-tunes">${tuning}</div>
      <div class="qa-section-label">Classes (living citizens)</div>
      <div class="cb-scroll"><table class="cb-table"><thead><tr><th>Class</th><th>Citizens</th><th>Levels 1–20</th><th>Median Lv</th><th>XP / hr</th><th>Avg hours</th><th>Forks</th></tr></thead>
        <tbody>${classes}</tbody></table></div>
      <div class="qa-section-label">Crafting — last 7 days</div>
      <div class="cb-scroll"><table class="cb-table"><thead><tr><th>Day</th><th>Basic</th><th>Sturdy</th><th>Fine</th><th>Superior</th><th>Legendary</th><th>Smelted</th></tr></thead>
        <tbody>${days}</tbody></table></div>
      <div class="qa-section-label">Discoveries & research — last 7 days</div>
      <div class="cb-facts">
        <div><b>${d.discoveries.recipes}</b> recipes worked out at the bench · <b>${d.discoveries.resources}</b> resources discovered</div>
        <div class="ra-muted">${src}</div>
        <div><b>${d.research.towns_studying}</b> towns studying now · <b>${d.research.finished_7d}</b> projects finished</div>
        <div class="ra-muted">${proj}</div>
      </div>`;
  }

  async function load() {
    const el = byId('cb-body');
    if (!el) return;
    el.innerHTML = '<div class="ra-muted">Counting…</div>';
    try { el.innerHTML = html(await call('GET', '/api/careers/admin/balance')); }
    catch (e) { el.innerHTML = `<div class="ra-err">${esc(e.message)}</div>`; }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-cb-save]');
    if (!b) return;
    const key = b.dataset.cbSave;
    const input = document.querySelector(`[data-cb-key="${key}"]`);
    try {
      await call('POST', '/api/careers/admin/tuning', { key, value: Number(input.value) });
      toast(`Saved: ${key} ×${Number(input.value)}`);
    } catch (err) { toast(err.message, 'error'); }
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#cb-body')) onClick(e); });

  global.KWCareerBalance = { load, html, histogram };
  global.loadCareerBalance = load;
})(typeof window !== 'undefined' ? window : this);
