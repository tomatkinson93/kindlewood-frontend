// ══════════════════════════════════════════════════════════════════════════
//  KWSay — the dialogue box (docs/LAYOUT_SPEC.md §3.4) for moments, and later
//  the guide and envoys: a portrait at the lower left, the speaker's name, a
//  line or two, and up to three options with their hints. It sits above the
//  map and below windows (--z-say); on phones it is a bottom sheet.
//
//    const pick = await KWSay.ask({ icon, speaker, title, text, options: [{ key, label, hint }],
//                                   fallback, note, choose: async key => ({ outcome }) | { error } });
//    → the chosen key (after the outcome has shown for a moment), or null if closed
//
//  `choose` runs when an option is pressed; its outcome replaces the options
//  for a few seconds, then the box folds away. An error keeps it open.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OUTCOME_MS = 3200;
  let current = null;

  // The box's markup (pure, for proofs).
  function html(o) {
    const opts = (o.options || []).slice(0, 3).map(x => `<button type="button" class="kws-opt" data-kws="${esc(x.key)}">
        <span class="kws-opt-l">${esc(x.label)}${x.key === o.fallback ? ' <span class="kws-default">default</span>' : ''}</span>
        ${x.hint ? `<span class="kws-opt-h">${esc(x.hint)}</span>` : ''}</button>`).join('');
    return `<div class="kws" role="dialog" aria-modal="false" aria-labelledby="kws-title" aria-describedby="kws-text">
      <div class="kws-portrait" aria-hidden="true">${esc(o.icon || '🍂')}</div>
      <div class="kws-main">
        <div class="kws-head"><span class="kws-speaker">${esc(o.speaker || '')}</span><span class="kws-title" id="kws-title">${esc(o.title || '')}</span>
          <button type="button" class="kws-x" data-kws-close aria-label="Close">✕</button></div>
        <p class="kws-text" id="kws-text">${esc(o.text || '')}</p>
        <div class="kws-opts">${opts}</div>
        ${o.note ? `<div class="kws-note">${esc(o.note)}</div>` : ''}
        <div class="kws-outcome" role="status" aria-live="polite" hidden></div>
      </div>
    </div>`;
  }

  function close(value) {
    if (!current) return;
    const c = current;
    current = null;
    c.el.remove();
    global.document.body.classList.remove('kws-open');
    global.document.removeEventListener('keydown', c.onKey, true);
    try { if (c.prev && c.prev.focus) c.prev.focus({ preventScroll: true }); } catch (_) { /* gone */ }
    c.resolve(value);
  }

  function ask(o) {
    const doc = global.document;
    if (current) close(null);   // one at a time: a new one replaces the old
    if (!doc || !doc.body) return Promise.resolve(o.fallback || null);
    return new Promise(resolve => {
      const el = doc.createElement('div');
      el.className = 'kws-layer';
      el.innerHTML = html(o);
      doc.body.appendChild(el);
      doc.body.classList.add('kws-open');   // the moment cards step aside (css/window.css)
      const box = el.querySelector('.kws');
      const outcome = el.querySelector('.kws-outcome');
      const prev = doc.activeElement;
      let busy = false;
      const onKey = e => {
        if (e.key === 'Escape' && !busy && !(global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen())
            && !(global.KWWindow && global.KWWindow.isOpen && global.KWWindow.isOpen())) { e.preventDefault(); close(null); }
      };
      current = { el, resolve, onKey, prev };
      doc.addEventListener('keydown', onKey, true);
      el.addEventListener('click', async e => {
        if (e.target.closest('[data-kws-close]')) { if (!busy) close(null); return; }
        const b = e.target.closest('[data-kws]');
        if (!b || busy) return;
        const key = b.getAttribute('data-kws');
        busy = true;
        box.querySelectorAll('.kws-opt').forEach(x => { x.disabled = true; });
        let res = null;
        try { res = typeof o.choose === 'function' ? await o.choose(key) : { outcome: '' }; }
        catch (err) { res = { error: (err && err.message) || 'That could not be done.' }; }
        if (res && res.error) {
          outcome.hidden = false; outcome.className = 'kws-outcome bad'; outcome.textContent = res.error;
          box.querySelectorAll('.kws-opt').forEach(x => { x.disabled = false; });
          busy = false;
          return;
        }
        // The outcome replaces the options for a few seconds, then folds away.
        box.querySelector('.kws-opts').hidden = true;
        const note = box.querySelector('.kws-note'); if (note) note.hidden = true;
        outcome.hidden = false; outcome.className = 'kws-outcome'; outcome.textContent = (res && res.outcome) || '';
        box.classList.add('kws-done');
        setTimeout(() => { if (current && current.el === el) close(key); }, OUTCOME_MS);
      });
      setTimeout(() => { const f = box.querySelector('.kws-opt'); if (f) f.focus({ preventScroll: true }); }, 0);
    });
  }

  // ── Telling: a character speaks, a line at a time ───────────────────────
  // The layout of a story scene: the character stands large at the lower
  // left, and a parchment box across the bottom carries their name, one line, and
  // an arrow for "next". The game behind stays visible and usable.
  //
  //   const how = await KWSay.tell({ character: '/assets/…/elder.webp', emoji: '🐭', speaker: 'Old Bramble',
  //                                  lines: ['…', '…'], skip: 'Skip the tour', count: '3 of 14',
  //                                  note: 'You received 240 timber.', noteFrom: 1 });   // not speech: under the line, from that line on
  //   → 'done' (the last line was passed), 'skip', or null (closed)
  function tellHtml(o, i = 0) {
    const lines = o.lines || [], last = i >= lines.length - 1;
    return `<div class="kwst" data-kwst>
      <div class="kwst-char" aria-hidden="true">${o.character ? `<img class="kwst-img" src="${esc(o.character)}" alt="" draggable="false">` : ''}<span class="kwst-emoji"${o.character ? ' hidden' : ''}>${esc(o.emoji || '🍂')}</span></div>
      <div class="kwst-box" role="dialog" aria-modal="false" aria-labelledby="kwst-name" aria-describedby="kwst-text" tabindex="0">
        <div class="kwst-name" id="kwst-name">${esc(o.speaker || '')}${o.count ? `<span class="kwst-count">${esc(o.count)}</span>` : ''}</div>
        <p class="kwst-text" id="kwst-text" aria-live="polite">${esc(lines[i] || '')}</p>
        ${o.note && i >= (o.noteFrom || 0) ? `<p class="kwst-note" role="note">${esc(o.note)}</p>` : ''}
        <div class="kwst-foot">${o.skip ? `<button type="button" class="kwst-skip" data-kwst-skip>${esc(o.skip)}</button>` : '<span></span>'}
          <button type="button" class="kwst-next" data-kwst-next aria-label="${last ? 'Done' : 'Next'}">${last ? (o.done ? esc(o.done) + ' ' : '') : ''}<span class="kwst-arrow" aria-hidden="true">▼</span></button></div>
      </div>
    </div>`;
  }
  function tell(o) {
    const doc = global.document;
    if (current) close(null);
    if (!doc || !doc.body || !(o.lines || []).length) return Promise.resolve('done');
    return new Promise(resolve => {
      const el = doc.createElement('div');
      el.className = 'kws-layer kws-story';
      let i = 0;
      const draw = () => {
        el.innerHTML = tellHtml(o, i);
        const img = el.querySelector('.kwst-img');   // no picture yet: the species' emoji stands in
        if (img) img.addEventListener('error', () => { img.remove(); const e = el.querySelector('.kwst-emoji'); if (e) e.hidden = false; });
        const box = el.querySelector('.kwst-box'); if (box) setTimeout(() => { try { box.focus({ preventScroll: true }); } catch (_) { /* gone */ } }, 0);
      };
      const next = () => { if (i < o.lines.length - 1) { i++; draw(); } else close('done'); };
      const prev = doc.activeElement;
      const onKey = e => {
        if (!el.contains(doc.activeElement) && doc.activeElement !== doc.body) return;   // typing elsewhere is left alone
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
      };
      current = { el, resolve, onKey, prev, story: true };
      doc.addEventListener('keydown', onKey, true);
      el.addEventListener('click', e => {
        if (e.target.closest('[data-kwst-skip]')) { close('skip'); return; }
        if (e.target.closest('.kwst-box, .kwst-char')) next();
      });
      doc.body.appendChild(el);
      // Not 'kws-open': that hides the moment cards, and a character may be saying "press the card".
      draw();
    });
  }

  global.KWSay = { ask, tell, close: () => close(null), isOpen: () => !!current, isTelling: () => !!(current && current.story), _html: html, _tellHtml: tellHtml, OUTCOME_MS };
})(typeof window !== 'undefined' ? window : globalThis);
