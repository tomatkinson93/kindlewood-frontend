// ══════════════════════════════════════════════════════════════════════════
//  KWLifeDev — Dev Tools → 👪 Life (docs/PHASE_1_LIFE_CYCLE.md §8). Admins only.
//
//  Status (beds, stages, working adults, the next settler, inheritances, the
//  oldest and their odds, couples and what blocks them), actions (age the
//  town, set a stage, a death of old age, a settler now, settle inheritances)
//  and the tunable numbers. Server: /api/life/admin/*.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { status: null, numbers: null, msg: '', bad: false };

  async function call(method, path, body) {
    const res = await global.apiFetch('/api/life/admin' + path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Request failed.');
    return d;
  }
  function root() { return global.document && global.document.getElementById('ct-life-body'); }
  function living() { return (typeof citizensData !== 'undefined' && Array.isArray(citizensData)) ? citizensData : []; }
  function pct(x) { return Math.round((Number(x) || 0) * 100) + '%'; }
  function when(at) { if (!at) return '—'; const ms = new Date(at) - Date.now(); if (ms <= 0) return 'due now'; const h = ms / 3600000; return h < 48 ? `in ${Math.round(h)} h` : `in ${Math.round(h / 24)} days`; }

  // ── Pure renderers (proofs) ──────────────────────────────────────────────
  function statusHtml(d) {
    if (!d) return '<div class="ra-muted">Loading…</div>';
    const couples = d.couples.length ? d.couples.map(c => `<tr><td>${esc(c.a.name)} (${c.a.age}) &amp; ${esc(c.b.name)} (${c.b.age})</td><td>${c.children}</td>
        <td>${c.fertile ? '<span class="kwld-ok">can have a child</span>' : esc(c.blockers.join('; '))}</td></tr>`).join('')
      : '<tr><td colspan="3" class="ra-muted">No couples.</td></tr>';
    return `<div class="kwld-grid">
        <div><b>Beds</b> ${d.beds.living}/${d.beds.beds} (${d.beds.free} free)</div>
        <div><b>Stages</b> ${d.stages.child} children · ${d.stages.youth} youths · ${d.stages.adult} adults · ${d.stages.elder} elders</div>
        <div><b>Working adults</b> ${d.working}</div>
        <div><b>Next settler</b> ${esc(when(d.settler && d.settler.at))} — ${esc(d.settler ? d.settler.reason : '')}</div>
        <div><b>One year</b> ${d.year_hours} real hours</div>
        <div><b>Open inheritances</b> ${d.inheritances.length ? d.inheritances.map(i => `${esc(i.name)} → ${esc(i.heir || '?')} (${esc(when(i.settle_at))})`).join(', ') : 'none'}</div>
      </div>
      <div class="cheat-section-label">Oldest (chance of dying at their next birthday)</div>
      <div class="kwld-oldest">${d.oldest.map(o => `<span class="kw-chip">${esc(o.name)} ${o.age} · ${pct(o.chance)}</span>`).join(' ') || '<span class="ra-muted">Nobody yet.</span>'}</div>
      <div class="cheat-section-label">Couples</div>
      <table class="cb-table kwld-table"><thead><tr><th>Couple</th><th>Children</th><th>Now</th></tr></thead><tbody>${couples}</tbody></table>`;
  }

  function actionsHtml(cits) {
    const opts = cits.map(c => `<option value="${c.id}">${esc(c.name)} (${c.age != null ? c.age : '?'}${c.stage ? ', ' + esc(c.stage) : ''})</option>`).join('');
    return `<div class="cheat-section-label">Actions</div>
      <div class="kwld-row"><label>Age everyone by <input class="ce-input kwld-num" type="number" min="1" max="100" step="1" value="5" id="kwld-years" aria-label="Years"> years</label>
        <button type="button" class="cheat-all-btn" data-kwld="age">⏳ Age the town</button></div>
      <div class="kwld-row"><select class="cheat-citizen-sel" id="kwld-who" aria-label="Citizen"><option value="">— Citizen —</option>${opts}</select>
        <select class="cheat-citizen-sel" id="kwld-stage" aria-label="Stage"><option value="child">🍼 Child</option><option value="youth">🌱 Youth</option><option value="adult">Adult</option><option value="elder">🦉 Elder</option></select>
        <button type="button" class="cheat-all-btn" data-kwld="stage">Make them this</button>
        <button type="button" class="cheat-all-btn kwld-danger" data-kwld="death">🕯 Death of old age</button></div>
      <div class="kwld-row"><button type="button" class="cheat-all-btn" data-kwld="settler">🧳 Send a settler now</button>
        <button type="button" class="cheat-all-btn" data-kwld="settle">📜 Settle open inheritances</button>
        <button type="button" class="cheat-all-btn" data-kwld="refresh">↻ Refresh</button></div>`;
  }

  function numbersHtml(nums) {
    if (!nums) return '';
    const groups = {};
    nums.forEach(n => (groups[n.group] = groups[n.group] || []).push(n));
    return `<div class="cheat-section-label">The numbers (live; re-run scripts/population_model.js after changing them)</div>
      ${Object.entries(groups).map(([g, list]) => `<div class="kwld-group"><div class="kwld-gname">${esc(g)}</div>${list.map(n => `
        <div class="cb-tune"><div class="cb-tune-l"><b>${esc(n.label)}</b>${n.changed ? ' <span class="kwld-changed">changed</span>' : ''}<div class="ra-muted cb-tight">${esc(n.desc)} Default ${n.default}; ${n.min}–${n.max}.</div></div>
          <input class="ce-input cb-tune-in" type="number" min="${n.min}" max="${n.max}" step="${n.step}" value="${n.value}" data-kwld-key="${esc(n.key)}" aria-label="${esc(n.label)}">
          <button type="button" class="qa-btn ra-btn" data-kwld-save="${esc(n.key)}">Save</button></div>`).join('')}</div>`).join('')}
      <button type="button" class="cheat-all-btn" data-kwld="reset">Reset all to the defaults</button>`;
  }

  // ── Render and wire ──────────────────────────────────────────────────────
  function render() {
    const el = root();
    if (!el) return;
    el.innerHTML = `${st.msg ? `<div class="kw-note ${st.bad ? 'bad' : 'good'}">${esc(st.msg)}</div>` : ''}
      ${statusHtml(st.status)}${actionsHtml(living())}${numbersHtml(st.numbers)}`;
  }
  async function load() {
    try {
      const [s, n] = await Promise.all([call('GET', '/status'), call('GET', '/numbers')]);
      st.status = s; st.numbers = n.numbers;
    } catch (e) { st.msg = e.message; st.bad = true; }
    render();
  }
  async function act(fn, ok) {
    try { const d = await fn(); st.msg = typeof ok === 'function' ? ok(d) : ok; st.bad = false; }
    catch (e) { st.msg = e.message; st.bad = true; }
    if (typeof global.loadCitizens === 'function') await global.loadCitizens().catch(() => {});
    await load();
  }
  function onClick(e) {
    const el = root();
    if (!el) return;
    const t = e.target.closest('[data-kwld], [data-kwld-save]');
    if (!t || !el.contains(t)) return;
    const who = () => Number((el.querySelector('#kwld-who') || {}).value) || null;
    const a = t.getAttribute('data-kwld');
    const save = t.getAttribute('data-kwld-save');
    if (save) {
      const v = el.querySelector(`[data-kwld-key="${save}"]`).value;
      return act(() => call('POST', '/numbers', { key: save, value: Number(v) }), 'Saved. It applies from the next hourly run.');
    }
    if (a === 'age') return act(() => call('POST', '/age', { years: Number(el.querySelector('#kwld-years').value) }),
      d => `Everyone aged. ${d.came_of_age.length ? 'Came of age: ' + d.came_of_age.join(', ') + '.' : ''} Death rolls happen at the next hourly run.`);
    if (a === 'stage') { if (!who()) return; return act(() => call('POST', '/stage', { citizen_id: who(), stage: el.querySelector('#kwld-stage').value }), d => `${d.name} is now ${d.stage}, aged ${d.age}.`); }
    if (a === 'death') { if (!who()) return; return act(() => call('POST', '/death', { citizen_id: who() }), d => `${d.name} has died of old age.`); }
    if (a === 'settler') return act(() => call('POST', '/settler'), d => d.settler ? `${d.settler.name}, ${d.settler.age}, has arrived.` : 'Nobody came.');
    if (a === 'settle') return act(() => call('POST', '/inheritances/settle'), d => `${d.settled} inheritance${d.settled === 1 ? '' : 's'} settled.`);
    if (a === 'reset') return act(() => call('POST', '/numbers/reset', {}), 'All numbers are back to the defaults.');
    if (a === 'refresh') { st.msg = ''; return load(); }
  }

  let wired = false;
  function open() {
    const el = root();
    if (!el) return;
    if (!wired) { el.addEventListener('click', onClick); wired = true; }
    st.msg = '';
    render();
    load();
  }

  global.KWLifeDev = { open, _statusHtml: statusHtml, _actionsHtml: actionsHtml, _numbersHtml: numbersHtml };
})(typeof window !== 'undefined' ? window : globalThis);
