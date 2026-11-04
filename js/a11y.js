// ══════════════════════════════════════════════════════════════════════════
//  KWA11y — keyboard help that works across every screen.
//
//  Escape closes the topmost open window (by z-index, then page order) by
//  pressing its own close button, and stops there so the windows underneath
//  stay open. In-game dialogs (KWDialog) handle their own keys; card games,
//  fishing and battles are left alone (Escape means something there).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const ROOTS = [
    'jn-overlay', 'rs-overlay', 'cr-overlay', 'cf-overlay', 'raid-sheet', 'call-sheet', 'market-panel', 'tw-overlay',
    'kwop-modal', 'clan-panel', 'chat-hub', 'clan-profile', 'mail-modal', 'away-report-modal',
    'diplomacy-modal', 'noticeboard-modal', 'quests-modal', 'inventory-modal', 'housing-modal', 'citizen-profile-modal',
    'all-citizens-modal', 'cheat-modal', 'online-modal', 'community-modal', 'tier-upgrade-modal', 'tier-celebration-modal',
    'profile-modal', 'view-profile-modal', 'map-preview-modal', 'settings-backdrop', 'stores-pop', 'events-panel',
  ];
  const CLOSE = '[aria-label="Close"], [data-close], .qm-close, .nb-modal-close, .raid-x, .jn-close, .sp-x, .events-panel-close, [class$="-close"], [class*="-close "]';

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const cs = global.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function z(el) { const v = parseInt(global.getComputedStyle(el).zIndex, 10); return Number.isFinite(v) ? v : 0; }

  // The open window on top, or null.
  function topmost() {
    const doc = global.document;
    const open = ROOTS.map(id => doc.getElementById(id)).filter(visible);
    if (!open.length) return null;
    open.sort((a, b) => (z(a) - z(b)) || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return open[open.length - 1];
  }
  function closeButton(root) {
    return [...root.querySelectorAll(CLOSE)].find(b => visible(b) && !b.disabled) || null;
  }

  function onKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (global.KWDialog && global.KWDialog.isOpen()) return;   // it handles its own
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.value) return;   // let a field clear first
    const top = topmost();
    if (!top) return;
    const btn = closeButton(top);
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    btn.click();
  }

  if (global.document) global.document.addEventListener('keydown', onKey, true);
  global.KWA11y = { topmost, closeButton, ROOTS };
})(typeof window !== 'undefined' ? window : globalThis);
