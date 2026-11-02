// ══════════════════════════════════════════════════════════════════════════
//  KWDialog — in-game dialogs instead of the browser's alert/confirm/prompt.
//
//    await KWDialog.alert('Demolition failed.')                 → undefined
//    await KWDialog.alert({ title, message, ok })
//    await KWDialog.confirm({ title, message, ok, cancel, danger }) → true/false
//    await KWDialog.confirm('Discard this item?')
//    await KWDialog.prompt({ title, message, value, placeholder, ok, maxLength }) → string|null
//
//  A modal (role="dialog", aria-modal) on top of everything: focus goes to the
//  main button, Tab stays inside, Esc cancels, Enter confirms. Dialogs queue —
//  one shows at a time. On phones it is a bottom sheet.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const queue = [];
  let open = null, seq = 0;

  function norm(o, defTitle) {
    if (o == null || typeof o !== 'object') o = { message: o };
    return Object.assign({ title: defTitle }, o);
  }

  // The dialog's HTML (pure, for proofs).
  function html(kind, o, id) {
    const msg = String(o.message == null ? '' : o.message).split('\n').map(esc).join('<br>');
    const field = kind === 'prompt'
      ? `<input class="kwd-input" type="text" id="kwd-input-${id}" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}"${o.maxLength ? ` maxlength="${Number(o.maxLength)}"` : ''} aria-label="${esc(o.title || 'Your answer')}">`
      : '';
    const okCls = 'kwd-btn kwd-ok' + (o.danger ? ' kwd-danger' : '');
    const buttons = kind === 'alert'
      ? `<button type="button" class="${okCls}" data-kwd="ok">${esc(o.ok || 'OK')}</button>`
      : `<button type="button" class="kwd-btn kwd-cancel" data-kwd="cancel">${esc(o.cancel || 'Cancel')}</button><button type="button" class="${okCls}" data-kwd="ok">${esc(o.ok || (kind === 'prompt' ? 'OK' : 'Confirm'))}</button>`;
    return `<div class="kwd-card" role="${kind === 'alert' ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="kwd-title-${id}" aria-describedby="kwd-msg-${id}">
      <div class="kwd-title" id="kwd-title-${id}">${esc(o.title || '')}</div>
      ${msg ? `<div class="kwd-msg" id="kwd-msg-${id}">${msg}</div>` : ''}
      ${field}
      <div class="kwd-actions">${buttons}</div>
    </div>`;
  }

  function show(kind, o) {
    return new Promise(resolve => { queue.push({ kind, o, resolve }); if (!open) next(); });
  }

  function next() {
    const item = queue.shift();
    if (!item) { open = null; return; }
    const doc = global.document;
    if (!doc || !doc.body) {   // no page (tests): answer as the browser would by default
      item.resolve(item.kind === 'confirm' ? false : item.kind === 'prompt' ? null : undefined);
      return next();
    }
    const id = ++seq;
    const back = doc.createElement('div');
    back.className = 'kwd-backdrop';
    back.innerHTML = html(item.kind, item.o, id);
    const prev = doc.activeElement;
    doc.body.appendChild(back);
    open = { back, item };
    const input = back.querySelector('.kwd-input');
    const okBtn = back.querySelector('[data-kwd="ok"]');
    const done = ok => {
      back.removeEventListener('keydown', onKey, true);
      back.remove();
      try { if (prev && prev.focus) prev.focus(); } catch (_) { /* gone */ }
      const v = item.kind === 'confirm' ? !!ok : item.kind === 'prompt' ? (ok ? (input ? input.value : '') : null) : undefined;
      item.resolve(v);
      next();
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(item.kind === 'alert'); }
      else if (e.key === 'Enter' && (e.target === input || e.target === okBtn || item.kind !== 'prompt') && e.target.dataset.kwd !== 'cancel') { e.preventDefault(); e.stopPropagation(); done(true); }
      else if (e.key === 'Tab') {
        const f = [...back.querySelectorAll('button, input')];
        const i = f.indexOf(doc.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    back.addEventListener('keydown', onKey, true);
    back.addEventListener('click', e => {
      const b = e.target.closest('[data-kwd]');
      if (b) done(b.dataset.kwd === 'ok');
      else if (e.target === back && item.kind !== 'alert') done(false);
    });
    setTimeout(() => { (input || okBtn).focus(); if (input) input.select(); }, 0);
  }

  global.KWDialog = {
    alert: o => show('alert', norm(o, 'Kindlewood')),
    confirm: o => show('confirm', norm(o, 'Are you sure?')),
    prompt: o => show('prompt', norm(o, '')),
    isOpen: () => !!open,
    _html: html,
  };
})(typeof window !== 'undefined' ? window : globalThis);
