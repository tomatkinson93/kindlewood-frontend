/* topbar-mobile.js — Kindlewood Mobile Spec, Phase 3 (small JS)
 *
 * Vanilla IIFE, no modules (constraint 1). Two additive mobile behaviours;
 * both are inert on desktop and never touch desktop-only code paths:
 *
 *   1. Sidebar bottom-sheet — a drag handle injected at the top of #sidebar
 *      cycles the sheet between three heights (peek / half / full). The CSS
 *      that gives those classes their max-height is media-scoped to ≤768px
 *      (mobile.css), so on desktop the injected handle is display:none and the
 *      state classes do nothing. Last state persists in localStorage.
 *
 *   2. Resource-rate tap — hiding .res-rate on mobile (mobile.css) loses the
 *      per-tick rate; tapping a .res reveals its rate for 3s.
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
  }

  function ensureAtLeastHalf() {
    var sb = sidebar();
    if (!sb) return;
    if (currentState(sb) === 'sheet-peek' || !currentState(sb)) {
      applyState(sb, 'sheet-half');
    }
  }

  function injectHandle() {
    var sb = sidebar();
    if (!sb || sb.querySelector('.sheet-handle')) return;

    var handle = document.createElement('div');
    handle.className = 'sheet-handle';
    handle.setAttribute('role', 'button');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-label', 'Resize panel');
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

  function wireResRates() {
    var timers = {};
    document.querySelectorAll('.topbar .res').forEach(function (res) {
      if (res._rateWired) return;
      res._rateWired = true;
      res.addEventListener('click', function () {
        if (!mq.matches) return;              // desktop shows rates already
        res.classList.add('show-rate');
        clearTimeout(timers[res.id]);
        timers[res.id] = setTimeout(function () {
          res.classList.remove('show-rate');
        }, 3000);
      });
    });
  }

  function init() {
    injectHandle();
    wireResRates();

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
