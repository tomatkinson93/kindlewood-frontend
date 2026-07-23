/* topbar-mobile.js — Kindlewood Mobile Spec, Phase 3 (small JS)
 *
 * Vanilla IIFE, no modules (constraint 1). Mobile-only sidebar bottom-sheet
 * behaviour; inert on desktop, where the injected handle is display:none and
 * the state classes have no media-scoped max-height to act on.
 *
 * A drag handle injected at the top of #sidebar cycles the sheet between three
 * heights (peek / half / full). A chevron on the handle shows what the next
 * tap will do, and the tabs stay visible in every state so the panel can never
 * feel "lost". Last state persists in localStorage.
 */
(function () {
  'use strict';

  var SHEET_KEY = 'kw-sheet-state';
  var STATES = ['sheet-peek', 'sheet-half', 'sheet-full'];
  var mq = window.matchMedia('(max-width: 768px)');

  function sidebar() { return document.getElementById('sidebar'); }

  function currentState(sb) {
    for (var i = 0; i < STATES.length; i++) {
      if (sb.classList.contains(STATES[i])) return STATES[i];
    }
    return null;
  }

  function applyState(sb, state) {
    STATES.forEach(function (s) { sb.classList.remove(s); });
    sb.classList.add(state);
    try { localStorage.setItem(SHEET_KEY, state); } catch (_) {}
    // Chevron points the way the next tap grows the sheet: up while there's
    // more room to open, down once fully open (next tap collapses to peek).
    var handle = sb.querySelector('.sheet-handle');
    if (handle) {
      handle.classList.toggle('at-full', state === 'sheet-full');
      handle.setAttribute('aria-label',
        state === 'sheet-full' ? 'Collapse panel' : 'Expand panel');
    }
  }

  function ensureAtLeastHalf() {
    var sb = sidebar();
    if (!sb) return;
    var cur = currentState(sb);
    if (cur === 'sheet-peek' || !cur) applyState(sb, 'sheet-half');
  }

  function injectHandle() {
    var sb = sidebar();
    if (!sb || sb.querySelector('.sheet-handle')) return;

    var handle = document.createElement('div');
    handle.className = 'sheet-handle';
    handle.setAttribute('role', 'button');
    handle.setAttribute('tabindex', '0');
    handle.innerHTML = '<span class="sheet-grip"></span><span class="sheet-chevron" aria-hidden="true"></span>';
    sb.insertBefore(handle, sb.firstChild);

    var cycle = function () {
      var cur = currentState(sb) || 'sheet-half';
      var next = STATES[(STATES.indexOf(cur) + 1) % STATES.length];
      applyState(sb, next);
    };
    handle.addEventListener('click', cycle);
    handle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); }
    });

    // Restore last state (default: half).
    var saved = null;
    try { saved = localStorage.getItem(SHEET_KEY); } catch (_) {}
    applyState(sb, STATES.indexOf(saved) >= 0 ? saved : 'sheet-half');
  }

  function init() {
    injectHandle();

    // Auto-open the sheet to at least half when a tab is opened from an
    // action-bar button (Build / Citizens), so the panel isn't stuck peeking.
    if (typeof window.switchTab === 'function' && !window.switchTab._mobileWrapped) {
      var orig = window.switchTab;
      window.switchTab = function () {
        var r = orig.apply(this, arguments);
        if (mq.matches) ensureAtLeastHalf();
        return r;
      };
      window.switchTab._mobileWrapped = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.KWMobileUI = { ensureAtLeastHalf: ensureAtLeastHalf };
})();
