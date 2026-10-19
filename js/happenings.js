// ══════════════════════════════════════════════════════════════════════════
//  KWHappenings — scheduled timed events, player side (spec 021 Phase 6).
//
//  The schedule (GET /api/happenings/schedule, no auth, cached 60s) holds
//  definitions only; windows are computed here with the shared
//  KWDayCycle.windowsBetween, so the client and server always agree.
//  Polled on load, on every KWClock sync, and every 15 minutes.
//
//  • HUD dial panel "Upcoming Happenings": the next 48h in the player's local
//    time, active ones highlighted. Uses KWClock.now(), so a dev warp shows
//    the warped view.
//  • Start toasts (banner effect): follow the REAL clock (KWClock.wallNow())
//    — a dev time warp never fires toasts (decision 20).
//  • map_flourish visuals: 'lanterns' is drawn by the daylight pass, every
//    other kind by kwmap-happening-fx.js (activeVisuals()).
//  • Effects (incl. a random_modifier's roll for this window) are resolved
//    by the shared KWHappeningEffects — exactly what the server applies.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const D = root.KWDayCycle;
  const FX = root.KWHappeningEffects;
  const HOUR = 3600 * 1000;
  const LIST_HOURS = 48;
  const TOAST_TICK_MS = 30 * 1000;
  const POLL_MS = 15 * 60 * 1000;

  let _defs = [];
  let _lastToastCheck = null;

  function _wall() { return root.KWClock ? root.KWClock.wallNow() : Date.now(); }
  function _now() { return root.KWClock ? root.KWClock.now() : Date.now(); }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function load() {
    try {
      const url = (root.KINDLEWOOD_API || '') + '/api/happenings/schedule';
      const r = await (typeof root.apiFetch === 'function' ? root.apiFetch('/api/happenings/schedule') : fetch(url));
      if (!r.ok) return;
      const d = await r.json();
      if (d && Array.isArray(d.happenings)) { _defs = d.happenings; _refresh(); }
    } catch (e) {}
  }

  function _hasEffect(h, type) { return (h.effects || []).some(e => e.type === type); }

  // Windows overlapping [ms, ms + hours) across all definitions, by start.
  function upcoming(ms, hours) {
    const to = ms + (hours || LIST_HOURS) * HOUR, out = [];
    for (const h of _defs) {
      for (const w of D.windowsBetween(h.rule, ms, to)) {
        out.push({ h, startMs: w.startMs, endMs: w.endMs, active: w.startMs <= ms && ms < w.endMs });
      }
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  function activeAt(ms) { return _defs.filter(h => D.windowsBetween(h.rule, ms, ms + 1).length > 0); }

  // Visual kinds (map_flourish) running right now (visual clock).
  function activeVisuals(ms) {
    const at = ms == null ? _now() : ms, kinds = [];
    for (const a of FX.activeAt(_defs, at)) for (const e of a.effects) if (e.type === 'map_flourish' && kinds.indexOf(e.kind) < 0) kinds.push(e.kind);
    if (ms == null && _demoOn()) for (const e of _demo.h.effects || []) if (e.type === 'map_flourish' && kinds.indexOf(e.kind) < 0) kinds.push(e.kind);
    return kinds;
  }
  function flourishActive(kind) { return activeVisuals().indexOf(kind) >= 0; }

  // Effects of h for the window starting at startMs, in words — modifiers
  // (incl. a rolled random one) tagged good / bad for colouring.
  function effectLines(h, startMs) {
    return FX.resolveEffects(h, startMs)
      .filter(e => e.type !== 'banner')
      .map(e => ({ text: FX.describeEffect(e), tone: e.type === 'modifier' ? (FX.isGood(e.stat, e.value) ? 'good' : 'bad') : 'neutral' }));
  }
  // Summed modifiers in force now (visual clock), e.g. for other panels.
  function modifiersNow() { return FX.modifiersAt(_defs, _now()); }


  // ── Admin demo: preview a Happening's visuals on this screen only ──────
  // Nothing goes to the server, so modifiers are listed, not applied.
  let _demo = null, _demoTimer = null;
  function _demoOn() {
    if (_demo && Date.now() >= _demo.until) stopDemo();
    return !!_demo;
  }
  // Night override for the FX pass while a demo forces the night look.
  function demoNight() { return _demoOn() && _demo.night ? 1 : null; }

  function demo(h, seconds, opts) {
    stopDemo();
    const secs = Math.max(1, Math.min(600, Number(seconds) || 15));
    _demo = { h: { id: h.id || 'demo', title: h.title || 'Demo', icon: h.icon || '🏮', effects: h.effects || [] },
              until: Date.now() + secs * 1000, night: !!(opts && opts.night) };
    const doc = root.document;
    if (!doc) return;
    const el = doc.createElement('div');
    el.id = 'kw-hap-demo';
    el.className = 'kw-hap-demo';
    const lines = effectLines(_demo.h, _wall()).filter(l => l.tone !== 'neutral');
    el.innerHTML = '<span class="kw-hap-demo-icon">' + _esc(_demo.h.icon) + '</span>'
      + '<span class="kw-hap-demo-main"><span class="kw-hap-demo-title">Demo: ' + _esc(_demo.h.title) + ' <span class="kw-hap-demo-left"></span></span>'
      + _fxHtml(lines) + (lines.length ? '<span class="kw-hap-demo-note">Preview only: modifiers are not applied</span>' : '') + '</span>'
      + '<button type="button" class="kw-hap-demo-stop" title="Stop the demo">✕</button>';
    el.querySelector('.kw-hap-demo-stop').onclick = stopDemo;
    doc.body.appendChild(el);
    const tick = () => {
      if (!_demoOn()) return;
      const left = el.querySelector('.kw-hap-demo-left');
      if (left) left.textContent = Math.ceil((_demo.until - Date.now()) / 1000) + 's';
    };
    tick();
    _demoTimer = setInterval(tick, 250);
  }

  function stopDemo() {
    _demo = null;
    if (_demoTimer) { clearInterval(_demoTimer); _demoTimer = null; }
    const el = root.document && root.document.getElementById('kw-hap-demo');
    if (el) el.remove();
  }

  function _dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m >= 24 * 60) return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
    return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm';
  }
  function _local(ms) {
    try { return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  }

  function _fxHtml(lines) {
    if (!lines.length) return '';
    return '<span class="hc-hap-fx">' + lines.map(l => '<span class="hc-fx hc-fx-' + l.tone + '">' + _esc(l.text) + '</span>').join('') + '</span>';
  }

  // HTML for the HUD dial panel's events section ('' = empty): the glance —
  // what's running now plus the next one — and a link to the full view
  // (js/timed-events.js, the community bar's Events button).
  function hudHtml(ms) {
    const all = upcoming(ms, LIST_HOURS);
    const list = all.filter(u => u.active);
    const next = all.find(u => !u.active);
    if (next) list.push(next);
    if (!list.length) return '';
    return list.map(u =>
      '<div class="hc-hap' + (u.active ? ' hc-hap-active' : '') + '">' +
        '<span class="hc-hap-icon">' + _esc(u.h.icon || '🏮') + '</span>' +
        '<span class="hc-hap-main"><span class="hc-hap-title">' + _esc(u.h.title) + '</span>' +
          '<span class="hc-hap-when">' + (u.active ? 'On now · ends ' + _esc(_local(u.endMs)) : 'Next · ' + _esc(_local(u.startMs))) + '</span>' +
          _fxHtml(effectLines(u.h, u.startMs)) + '</span>' +
        '<span class="hc-hap-in">' + (u.active ? 'ends in ' + _dur(u.endMs - ms) : 'in ' + _dur(u.startMs - ms)) + '</span>' +
      '</div>').join('') +
      (root.KWEventsPanel ? '<button type="button" class="hc-hap-all" onclick="KWEventsPanel.open()">See all events →</button>' : '');
  }

  // Toast every banner Happening whose window started since the last check
  // (real clock; the first check only sets the baseline, so nothing already
  // running toasts on page load).
  function _checkToasts() {
    const now = _wall();
    if (_lastToastCheck == null) { _lastToastCheck = now; return; }
    const from = _lastToastCheck;
    _lastToastCheck = now;
    for (const h of _defs) {
      if (!_hasEffect(h, 'banner')) continue;
      for (const w of D.windowsBetween(h.rule, from, now + 1)) {
        if (w.startMs > from && w.startMs <= now && typeof root.showToastNotification === 'function') {
          const fx = effectLines(h, w.startMs).filter(l => l.tone !== 'neutral').map(l => l.text);
          root.showToastNotification((h.icon || '🏮') + ' ' + h.title + ' has begun!' + (h.flavour ? ' ' + h.flavour : '') +
            (fx.length ? ' (' + fx.join(', ') + ')' : ''), 'event');
        }
      }
    }
  }

  function _refresh() {
    if (root.KWHudClock && root.KWHudClock.render) root.KWHudClock.render();
  }

  function start() {
    if (root.KWHudClock) root.KWHudClock.setHappeningsProvider(hudHtml);
    if (root.KWClock) root.KWClock.onChange(ev => { if (ev && ev.reason === 'sync') load(); else _refresh(); });
    setInterval(_checkToasts, TOAST_TICK_MS);
    setInterval(load, POLL_MS);
    _checkToasts();
    load();
  }

  root.KWHappenings = {
    load, upcoming, activeAt, activeVisuals, flourishActive, effectLines, modifiersNow, hudHtml,
    demo, stopDemo, demoNight,
    defs: () => _defs.slice(),
    _setDefsForTest(d) { _defs = d || []; }, _checkToasts, _resetToastsForTest(at) { _lastToastCheck = at == null ? null : at; },
  };

  if (!root.__KW_NO_AUTOSTART) {
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : this);
