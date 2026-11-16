// ══════════════════════════════════════════════════════════════════════════
//  KWBuildingMenu — a built building's radial menu on Home (HOME_SCENE.md
//  §2.2a), in the villager menu's style (js/villager-engine.js).
//
//  A click (or Enter) on a building opens it: Enter in the middle, largest,
//  and round it Minimise, Upgrade, Demolish and Who's here. A double click,
//  or Enter pressed twice, goes straight in. Buttons that don't apply are
//  left out. Build mode still places and moves buildings (js/settlement-
//  view.js); props keep their single click.
//
//  Minimise makes a building see-through and click-through (its nameplate
//  stays and restores it), so villagers behind it can be picked; it lasts
//  until the player leaves Home. "See through" beside Names does every
//  building at once.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const SOUND = { on: 'ui/pop_on.mp3', off: 'ui/pop_off.mp3', min: 'ui/minimize.wav' };
  const sound = k => { if (typeof global.playSfx === 'function') global.playSfx(SOUND[k]); };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const DOUBLE_MS = 450;

  const M = { key: null, el: null, slot: null, opts: null, at: 0, who: null };
  const minimised = new Set();   // building keys, until Home closes

  // The buttons for a building, in order (Enter first). `o`: { enter,
  // upgrade?, demolish?, who? }. Pure.
  function items(o, inside = 0) {
    const out = [{ key: 'enter', icon: '🚪', label: 'Enter', big: true }, { key: 'min', icon: '👁', label: 'Minimise' }];
    if (o.upgrade) out.push({ key: 'upgrade', icon: '⬆', label: 'Upgrade' });
    if (o.demolish) out.push({ key: 'demolish', icon: '🔨', label: 'Demolish' });
    out.push({ key: 'who', icon: '👥', label: "Who's here" + (inside ? ' (' + inside + ')' : '') });
    return out;
  }
  // Where the buttons round Enter go: evenly round a circle from the top.
  // Pure. → [{ x, y }] for the n buttons after Enter.
  function ring(n, radius = 98) {
    return Array.from({ length: n }, (_, i) => { const a = (-90 + 360 / n * i) * Math.PI / 180; return { x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) }; });
  }

  const cast = () => global.KWCast;
  const insideOf = key => { const C = cast(); return C && C.inside ? C.inside(key) : []; };
  const isPhone = () => !!(doc.body && doc.body.classList.contains('kw-shell'));

  // A click on a building's slot. `slot`: the .sv-slot; `o`: { key, label,
  // enter, upgrade?, demolish? }; `e`: the click (a keyboard click has detail 0).
  function click(slot, o, e) {
    if (!slot || !o) return;
    if (minimised.has(o.key)) { restore(o.key); return; }   // only its nameplate takes clicks
    const now = Date.now();
    if (M.key === o.key && M.el) {
      if (now - M.at < DOUBLE_MS) { go('enter'); return; }   // a double click goes straight in
      close(true); return;
    }
    open(slot, o, !!(e && e.detail === 0));
  }

  function open(slot, o, byKeyboard) {
    close(false, true);
    const C = cast(); if (C && C.deselect) C.deselect();
    const layer = slot.parentNode, art = slot.querySelector('.kwh-art') || slot;
    if (!layer) return;
    const lr = layer.getBoundingClientRect(), k = layer.clientWidth ? lr.width / layer.clientWidth : 1;
    const ar = art.getBoundingClientRect();
    const cx = (ar.left + ar.width / 2 - lr.left) / k, cy = (ar.top + ar.height * 0.55 - lr.top) / k;
    const list = items(o, insideOf(o.key).length);
    const pts = ring(list.length - 1, isPhone() ? 104 : 98);
    const m = doc.createElement('div');
    m.className = 'kwv-radial kwb-radial';
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', o.label || 'Building');
    m.style.left = Math.round(cx) + 'px'; m.style.top = Math.round(cy) + 'px';
    m.innerHTML = list.map((it, i) => {
      const p = i ? pts[i - 1] : { x: 0, y: 0 };
      return `<button type="button" class="kwv-rb${it.big ? ' kwb-enter' : ''}" role="menuitem" data-kwb="${it.key}" style="--rx:${p.x}px;--ry:${p.y}px">`
        + `<span class="kwv-rb-i" aria-hidden="true">${it.icon}</span><span class="kwv-rb-l">${esc(it.label)}</span></button>`;
    }).join('');
    m.addEventListener('click', ev => { ev.stopPropagation(); const b = ev.target.closest('[data-kwb]'); if (b) go(b.getAttribute('data-kwb')); });
    m.addEventListener('dblclick', ev => ev.stopPropagation());
    m.addEventListener('keydown', ev => {
      const bs = [...m.querySelectorAll('.kwv-rb')], i = bs.indexOf(doc.activeElement);
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(ev.key)) {
        ev.preventDefault(); ev.stopPropagation();
        bs[(i + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
      }
    });
    layer.appendChild(m);
    Object.assign(M, { key: o.key, el: m, slot, opts: o, at: Date.now() });
    slot.classList.add('kwb-open');
    (global.requestAnimationFrame || setTimeout)(() => m.classList.add('kwv-open'));
    if (byKeyboard) { const first = m.querySelector('.kwb-enter'); if (first) first.focus(); }
    sound('on');
  }

  // `quiet`: no sound (another menu took over).
  function close(soundOff, quiet) {
    if (M.who) { M.who.remove(); M.who = null; }
    if (!M.el) return;
    M.el.remove();
    if (M.slot) M.slot.classList.remove('kwb-open');
    M.el = null; M.key = null; M.slot = null; M.opts = null;
    if (soundOff && !quiet) sound('off');
  }

  function go(what) {
    const o = M.opts, slot = M.slot;
    if (!o) return;
    if (what === 'who') { showWho(); return; }
    close(false, true);
    if (what === 'enter') o.enter && o.enter();
    else if (what === 'upgrade') o.upgrade && o.upgrade();
    else if (what === 'demolish') o.demolish && o.demolish();
    else if (what === 'min') minimise(o.key, slot);
  }

  // ── Who's here ──────────────────────────────────────────────────────────
  // The villagers the scene has inside this building right now (workers and
  // visitors); a name opens that villager's menu as they step out.
  function showWho() {
    if (!M.el) return;
    if (M.who) { M.who.remove(); M.who = null; return; }
    const list = insideOf(M.key);
    const box = doc.createElement('div');
    box.className = 'kwb-who';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', "Who's here");
    box.style.left = M.el.style.left; box.style.top = (parseFloat(M.el.style.top) + (isPhone() ? 150 : 142)) + 'px';
    box.innerHTML = `<div class="kwb-who-h">Inside the ${esc(M.opts.label || 'building')}</div>`
      + (list.length ? list.map(v => `<button type="button" class="kwb-who-b" data-kwb-cid="${v.id}">${esc(v.name)}<span>${esc(v.why || '')}</span></button>`).join('')
        : '<div class="kwb-who-none">Nobody inside right now.</div>');
    box.addEventListener('click', ev => {
      ev.stopPropagation();
      const b = ev.target.closest('[data-kwb-cid]');
      if (!b) return;
      const id = Number(b.getAttribute('data-kwb-cid'));
      close(false, true);
      const C = cast(); if (C && C.callOut) C.callOut(id);
    });
    M.el.parentNode.appendChild(box);
    M.who = box;
    const first = box.querySelector('button'); if (first && doc.activeElement && M.el.contains(doc.activeElement)) first.focus();
  }

  // ── Minimise ────────────────────────────────────────────────────────────
  function slotOf(key) { const b = doc.querySelector('#settlement-view .sv-fg-layer [data-kwh="' + key + '"]'); return b && b.closest('.sv-slot'); }
  function minimise(key, slot, quiet) {
    minimised.add(key);
    const s = slot || slotOf(key);
    if (s) s.classList.add('kwb-min');
    if (!quiet) sound('min');
    afterChange();
  }
  function restore(key, quiet) {
    minimised.delete(key);
    const s = slotOf(key);
    if (s) s.classList.remove('kwb-min');
    if (!quiet) sound('min');
    afterChange();
  }
  function afterChange() {
    if (global.KWHome && global.KWHome.syncGlow) global.KWHome.syncGlow();   // a see-through building's windows don't glow over it
    if (global.KWPlaces && global.KWPlaces.refreshTools) global.KWPlaces.refreshTools();
  }
  // Every built building on Home (not the props).
  const builtKeys = () => [...doc.querySelectorAll('#settlement-view .sv-fg-layer .sv-slot:not([hidden]) .kwh-btn[data-kwh]:not(.kwh-prop)')].map(b => b.getAttribute('data-kwh'));
  const allMin = () => { const ks = builtKeys(); return ks.length > 0 && ks.every(k => minimised.has(k)); };
  function toggleAll() {
    const on = !allMin();
    builtKeys().forEach(k => (on ? minimise(k, null, true) : restore(k, true)));
    sound('min');
  }
  // After the scene redraws its buttons: put the see-through ones back.
  function apply() { minimised.forEach(k => { const s = slotOf(k); if (s) s.classList.add('kwb-min'); }); }

  if (doc) {
    // A press anywhere else closes the menu; Esc too (before js/a11y.js).
    doc.addEventListener('pointerdown', e => {
      if (!M.el) return;
      if (e.target.closest && (e.target.closest('.kwb-radial') || e.target.closest('.kwb-who') || (M.slot && M.slot.contains(e.target)))) return;
      close(true);
    }, true);
    global.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !M.el || e.defaultPrevented) return;
      if ((global.KWDialog && global.KWDialog.isOpen && global.KWDialog.isOpen()) || (global.KWWindow && global.KWWindow.isOpen && global.KWWindow.isOpen())) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const b = M.slot && M.slot.querySelector('.kwh-btn');
      close(true);
      if (b) try { b.focus({ preventScroll: true }); } catch (_) {}
    }, true);
    // Leaving Home: the menu closes and every building comes back.
    global.addEventListener('kw:home', e => { if (!(e.detail && e.detail.open)) { close(false, true); minimised.clear(); doc.querySelectorAll('.kwb-min').forEach(s => s.classList.remove('kwb-min')); } });
  }

  global.KWBuildingMenu = {
    click, open, close, items, ring, minimise, restore, toggleAll, allMin, apply,
    isMin: k => minimised.has(k), get openKey() { return M.key; }, DOUBLE_MS, SOUND,
  };
})(typeof window !== 'undefined' ? window : globalThis);
