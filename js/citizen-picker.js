// ══════════════════════════════════════════════════════════════════════════
//  CITIZEN PICKER — tappable citizen list over a native <select>
//
//  The tavern quest modals (solo + party assembly) keep their <select>s as
//  the source of truth — accept, odds and duplicate-locking code read and
//  write them — and KWPicker draws the clan-quest style list on top:
//  citizens sorted by the skill that matters, their success odds, busy ones
//  greyed out with the reason, the chosen one highlighted. A tap sets the
//  select's value and fires its change event, then every picker in the
//  modal refreshes (another slot may have locked or freed a citizen).
//
//  Options carry: value = citizen id, data-name, data-skill, data-busy="1"
//  + data-busy-label for busy citizens. A disabled, not-busy option means
//  "picked for another role".
//
//  KWPicker.enhance(select, { skillLabel, base, show })  base = quest base
//  success (0–1) for per-citizen odds, or null to show the skill value
//  instead (party roles — the odds depend on the whole party); show = rows
//  before "Show all".
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const odds = (base, skill) => Math.min(95, Math.round((base + ((Number(skill) || 1) - 1) * 0.04) * 100));
  const oddsColor = p => (p >= 80 ? '#7fd08a' : p >= 60 ? '#C0DD97' : p >= 40 ? '#f4c95d' : '#f0a488');

  function enhance(sel, opts) {
    if (!sel) return;
    sel._kwp = { skillLabel: '', base: 0.5, show: 5, expanded: false, ...(opts || {}) };
    sel.classList.add('kwp-hidden');
    let host = sel.nextElementSibling;
    if (!host || !host.classList.contains('kwp')) {
      host = document.createElement('div');
      host.className = 'kwp';
      sel.insertAdjacentElement('afterend', host);
      host.addEventListener('click', e => {
        const more = e.target.closest('[data-kwp-more]');
        if (more) { sel._kwp.expanded = true; render(sel); return; }
        const b = e.target.closest('[data-kwp-id]');
        if (!b || b.disabled) return;
        sel.value = sel.value === b.dataset.kwpId ? '' : b.dataset.kwpId;   // tap again to clear
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        refreshAll(sel.closest('.pa-slots, #party-assembly-inner') || document);
      });
    }
    render(sel);
  }

  function render(sel) {
    const host = sel.nextElementSibling;
    if (!host || !sel._kwp) return;
    const o = sel._kwp;
    const items = Array.from(sel.options).filter(op => op.value).map(op => {
      const busy = op.dataset.busy === '1';
      return {
        id: op.value, name: op.dataset.name || op.textContent, skill: Number(op.dataset.skill) || 0,
        chosen: op.selected, busy, taken: op.disabled && !busy,
        why: busy ? (op.dataset.busyLabel || 'Busy') : op.disabled ? 'Picked for another role' : '',
      };
    });
    if (!items.length) { host.innerHTML = '<div class="kwp-empty">No grown citizens to send.</div>'; return; }
    // Free citizens first (by skill — the options are already sorted), then
    // the unavailable ones; the chosen one always shows.
    const free = items.filter(x => !x.busy && !x.taken), off = items.filter(x => x.busy || x.taken);
    let list = free.concat(off);
    const hidden = o.expanded ? 0 : Math.max(0, list.length - o.show);
    if (hidden) {
      const top = list.slice(0, o.show);
      const chosen = list.find(x => x.chosen);
      if (chosen && !top.includes(chosen)) top[top.length - 1] = chosen;
      list = top;
    }
    host.innerHTML = `<ul class="kwp-list">${list.map(x => {
      const p = odds(o.base, x.skill);
      return `<li><button type="button" class="kwp-btn${x.chosen ? ' on' : ''}" data-kwp-id="${esc(x.id)}"${(x.busy || x.taken) && !x.chosen ? ' disabled' : ''}>
        <span class="kwp-check">${x.chosen ? '✓' : ''}</span>
        <span class="kwp-name">${esc(x.name)}</span>
        <span class="kwp-meta">${x.why ? esc(x.why) : `${esc(o.skillLabel)} ${x.skill}`}</span>
        ${x.why ? '' : o.base == null
          ? `<span class="kwp-skill" title="${esc(o.skillLabel)} skill">${x.skill}</span>`
          : `<span class="kwp-odds" style="color:${oddsColor(p)}">${p}%</span>`}
      </button></li>`;
    }).join('')}</ul>${hidden ? `<button type="button" class="kwp-more" data-kwp-more>Show all ${items.length} citizens</button>` : ''}`;
  }

  function refreshAll(root) {
    (root || document).querySelectorAll('select.kwp-hidden').forEach(s => render(s));
  }

  global.KWPicker = { enhance, refresh: refreshAll };
})(typeof window !== 'undefined' ? window : globalThis);
