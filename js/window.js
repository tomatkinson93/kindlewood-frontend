// ══════════════════════════════════════════════════════════════════════════
//  KWWindow — the one window component (docs/LAYOUT_SPEC.md §3).
//
//    const w = KWWindow.open({
//      id: 'families',              // one per id; opening again brings it to the front
//      title: 'Families', subtitle: '…',
//      icon: 'families',            // a sprite id (#kw-i-…) or an emoji
//      size: 'L',                   // S 420 · M 680 · L 980×720 · full
//      tabs: [{ key: 'lines', label: 'Family lines' }, { key: 'tree', label: 'Tree' }],
//      tab: 'lines',
//      help: 'families',            // a Help topic: shows the "?" button
//      state: { … },                // handed to render; yours to keep
//      render(body, state, w) { … },   // on open, on tab change, on w.refresh()
//      actions: { name(el, event, w) { … } },   // for data-action="name" inside the window
//      onClose() { … },
//    });
//    w.refresh(); w.setTab('tree'); w.setTitle('…', '…'); w.close();
//
//  Guarantees: a fixed size per window (the body scrolls; tabs never resize
//  it); one header with one close button; role="dialog" + aria-modal; focus
//  moves in and returns to the opener; Tab stays inside; Escape closes the
//  top window only; a full-screen sheet on phones; windows stack in the order
//  opened; the tab and scroll position are remembered per id for the session.
//  No inline onclick: data-action and one click listener per window.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const SIZES = ['S', 'M', 'L', 'full'];
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const stack = [];          // open windows, bottom → top
  let seq = 0;

  // ── Per-id memory for the session (tab and scroll per tab) ────────────────
  const MEM_KEY = 'kw_window_mem';
  let mem = {};
  try { mem = JSON.parse(global.sessionStorage.getItem(MEM_KEY) || '{}') || {}; } catch (_) { mem = {}; }
  function remember(id, patch) {
    mem[id] = Object.assign({}, mem[id], patch);
    try { global.sessionStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch (_) { /* private mode */ }
  }

  // ── Markup (pure, for proofs) ─────────────────────────────────────────────
  function iconHtml(icon) {
    if (!icon) return '';
    if (/^[a-z][a-z0-9-]*$/.test(icon)) return `<svg class="kww-icon" aria-hidden="true"><use href="#kw-i-${icon}"></use></svg>`;
    return `<span class="kww-icon kww-emoji" aria-hidden="true">${esc(icon)}</span>`;
  }
  function tabsHtml(o, uid, tab) {
    if (!o.tabs || !o.tabs.length) return '';
    return `<div class="kw-tabs kww-tabs" role="tablist" aria-label="${esc(o.title)}">${o.tabs.map(t =>
      `<button type="button" class="kw-tabs-item${t.key === tab ? ' is-on' : ''}" role="tab" id="kww-${uid}-tab-${esc(t.key)}"
        aria-selected="${t.key === tab}" aria-controls="kww-${uid}-body" tabindex="${t.key === tab ? 0 : -1}"
        data-kww-tab="${esc(t.key)}">${esc(t.label)}${t.badge ? ` <span class="kw-chip kww-badge">${esc(t.badge)}</span>` : ''}</button>`).join('')}</div>`;
  }
  function html(o, uid, tab) {
    const size = SIZES.includes(o.size) ? o.size : 'M';
    const hasTabs = !!(o.tabs && o.tabs.length);
    return `<section class="kww kww-${size}" role="dialog" aria-modal="true" aria-labelledby="kww-${uid}-title" tabindex="-1" data-kww="${esc(o.id)}">
      <header class="kww-head">
        ${iconHtml(o.icon)}
        <div class="kww-titles">
          <h2 class="kww-title" id="kww-${uid}-title">${esc(o.title)}</h2>
          <div class="kww-sub"${o.subtitle ? '' : ' hidden'}>${esc(o.subtitle || '')}</div>
        </div>
        ${o.help ? `<button type="button" class="kww-hbtn" data-kww-act="help" aria-label="How this works"><svg aria-hidden="true"><use href="#kw-i-help"></use></svg></button>` : ''}
        <button type="button" class="kww-hbtn kww-close" data-kww-act="close" aria-label="Close"><svg aria-hidden="true"><use href="#kw-i-close"></use></svg></button>
      </header>
      ${tabsHtml(o, uid, tab)}
      <div class="kww-body" id="kww-${uid}-body"${hasTabs ? ` role="tabpanel" aria-labelledby="kww-${uid}-tab-${esc(tab)}"` : ''} tabindex="-1"></div>
    </section>`;
  }

  // ── The window object ─────────────────────────────────────────────────────
  function find(id) { return stack.find(w => w.id === id) || null; }
  function top() { return stack[stack.length - 1] || null; }

  function restack() {
    stack.forEach((w, i) => {
      if (!w.el) return;
      w.el.style.zIndex = `calc(var(--z-window) + ${i})`;
      w.el.classList.toggle('kww-top', i === stack.length - 1);
    });
  }

  function makeWindow(o) {
    const uid = ++seq;
    const id = o.id || `kww-${uid}`;
    const remembered = mem[id] || {};
    const tabKeys = (o.tabs || []).map(t => t.key);
    const firstTab = tabKeys.includes(remembered.tab) ? remembered.tab
      : tabKeys.includes(o.tab) ? o.tab : (tabKeys[0] || null);
    const w = {
      id, uid, opts: o, el: null, card: null, body: null,
      state: Object.assign({}, o.state || {}, { tab: firstTab }),
      opener: null,
      get tab() { return this.state.tab; },
      refresh() { draw(w, { keepScroll: true }); return w; },
      setTab(key) { return switchTab(w, key); },
      setTitle(title, subtitle) {
        if (title != null) { w.opts.title = title; const t = w.card && w.card.querySelector('.kww-title'); if (t) t.textContent = title; }
        if (subtitle !== undefined) {
          w.opts.subtitle = subtitle;
          const s = w.card && w.card.querySelector('.kww-sub');
          if (s) { s.textContent = subtitle || ''; s.hidden = !subtitle; }
        }
        return w;
      },
      close() { return closeWindow(w); },
      focus() { bringToFront(w); return w; },
      isOpen() { return stack.includes(w); },
    };
    return w;
  }

  function scrollKey(w) { return 'scroll:' + (w.state.tab || '_'); }

  function draw(w, { keepScroll = false } = {}) {
    if (!w.body) return;
    const prevScroll = keepScroll ? w.body.scrollTop : (mem[w.id] || {})[scrollKey(w)] || 0;
    try {
      if (typeof w.opts.render === 'function') w.opts.render(w.body, w.state, w);
    } catch (e) {
      console.error('[KWWindow] render failed for ' + w.id, e);
      w.body.innerHTML = '<div class="kw-note bad">Something went wrong showing this. Close it and try again.</div>';
    }
    w.body.scrollTop = prevScroll;
  }

  function switchTab(w, key) {
    const keys = (w.opts.tabs || []).map(t => t.key);
    if (!keys.includes(key) || key === w.state.tab) return w;
    if (w.body) remember(w.id, { [scrollKey(w)]: w.body.scrollTop });
    w.state.tab = key;
    remember(w.id, { tab: key });
    if (w.card) {
      w.card.querySelectorAll('[data-kww-tab]').forEach(b => {
        const on = b.getAttribute('data-kww-tab') === key;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (w.body) w.body.setAttribute('aria-labelledby', `kww-${w.uid}-tab-${key}`);
    }
    if (typeof w.opts.onTab === 'function') { try { w.opts.onTab(key, w); } catch (e) { console.error(e); } }
    draw(w);
    return w;
  }

  function bringToFront(w) {
    const i = stack.indexOf(w);
    if (i < 0) return;
    if (i !== stack.length - 1) { stack.splice(i, 1); stack.push(w); restack(); }
    focusInto(w);
  }

  function focusInto(w) {
    if (!w.card) return;
    const doc = global.document;
    if (w.card.contains(doc.activeElement)) return;
    const first = w.body && w.body.querySelector('[autofocus]') || w.body && w.body.querySelector(FOCUSABLE);
    try { (first || w.card).focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
  }

  function closeWindow(w) {
    const i = stack.indexOf(w);
    if (i < 0) return false;
    if (w.body) remember(w.id, { [scrollKey(w)]: w.body.scrollTop });
    stack.splice(i, 1);
    if (w.el) w.el.remove();
    restack();
    syncBody();
    if (typeof w.opts.onClose === 'function') { try { w.opts.onClose(w); } catch (e) { console.error(e); } }
    // Focus goes back to whatever opened it, or to the window now on top.
    const back = w.opener && w.opener.isConnected ? w.opener : null;
    const nextTop = top();
    try {
      if (nextTop && (!back || !nextTop.card.contains(back))) focusInto(nextTop);
      else if (back) back.focus({ preventScroll: true });
    } catch (_) { /* gone */ }
    return true;
  }

  function syncBody() {
    const doc = global.document;
    if (doc && doc.body) doc.body.classList.toggle('kww-open', stack.length > 0);
  }

  function onClick(w, e) {
    const t = e.target;
    const tabBtn = t.closest && t.closest('[data-kww-tab]');
    if (tabBtn && w.card.contains(tabBtn)) { switchTab(w, tabBtn.getAttribute('data-kww-tab')); return; }
    const own = t.closest && t.closest('[data-kww-act]');
    if (own && w.card.contains(own)) {
      const act = own.getAttribute('data-kww-act');
      if (act === 'close') closeWindow(w);
      else if (act === 'help' && global.KWHelp && typeof global.KWHelp.open === 'function') global.KWHelp.open(w.opts.help);
      return;
    }
    const a = t.closest && t.closest('[data-action]');
    if (a && w.card.contains(a)) {
      const fn = w.opts.actions && w.opts.actions[a.getAttribute('data-action')];
      if (typeof fn === 'function') { e.preventDefault(); try { fn(a, e, w); } catch (err) { console.error(err); } }
      return;
    }
    if (t === w.el && w.opts.closeOnBackdrop) closeWindow(w);
  }

  function open(o) {
    o = Object.assign({ title: '', size: 'M' }, o || {});
    const doc = global.document;
    const existing = o.id ? find(o.id) : null;
    if (existing) {
      if (o.tab) switchTab(existing, o.tab);
      if (o.state) Object.assign(existing.state, o.state);
      bringToFront(existing);
      return existing;
    }
    const w = makeWindow(o);
    if (!doc || !doc.body) { stack.push(w); return w; }   // no page (tests)
    w.opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    const back = doc.createElement('div');
    back.className = 'kww-backdrop';
    back.setAttribute('data-kww-layer', w.id);
    back.innerHTML = html(o, w.uid, w.state.tab);
    w.el = back;
    w.card = back.querySelector('.kww');
    w.body = back.querySelector('.kww-body');
    back.addEventListener('click', e => onClick(w, e));
    stack.push(w);
    doc.body.appendChild(back);
    restack();
    syncBody();
    draw(w);
    focusInto(w);
    return w;
  }

  // ── Keys: Escape closes the top window; Tab stays inside; ←/→ move tabs ──
  function onKey(e) {
    const w = top();
    if (!w || !w.card) return;
    if (global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen()) return;   // a confirm owns the keys
    const doc = global.document;
    if (e.key === 'Escape') {
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.value && w.card.contains(t)) return;   // a field clears first
      e.preventDefault(); e.stopImmediatePropagation();
      closeWindow(w);
    } else if (e.key === 'Tab') {
      const f = [...w.card.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null || n === doc.activeElement);
      if (!f.length) { e.preventDefault(); w.card.focus(); return; }
      const i = f.indexOf(doc.activeElement);
      if (!w.card.contains(doc.activeElement)) { e.preventDefault(); f[0].focus(); }
      else if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target && e.target.getAttribute && e.target.getAttribute('role') === 'tab' && w.card.contains(e.target)) {
      const keys = (w.opts.tabs || []).map(t => t.key);
      const i = keys.indexOf(w.state.tab);
      const next = keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
      e.preventDefault();
      switchTab(w, next);
      const b = w.card.querySelector(`[data-kww-tab="${next}"]`);
      if (b) b.focus();
    }
  }
  if (global.document) global.document.addEventListener('keydown', onKey, true);

  global.KWWindow = {
    open,
    get: id => find(id),
    top,
    isOpen: id => (id ? !!find(id) : stack.length > 0),
    close: id => { const w = find(id); return w ? closeWindow(w) : false; },
    closeAll: () => { while (stack.length) closeWindow(top()); },
    SIZES,
    _html: html,
    _stack: stack,
    _mem: () => mem,
  };
})(typeof window !== 'undefined' ? window : globalThis);
