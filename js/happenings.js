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
//  • map_flourish: 'lanterns' is drawn by the daylight pass via
//    flourishActive(); 'fireflies' / 'aurora' are stubs for now.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const D = root.KWDayCycle;
  const HOUR = 3600 * 1000;
  const LIST_HOURS = 48;
  const TOAST_TICK_MS = 30 * 1000;
  const POLL_MS = 15 * 60 * 1000;

  let _defs = [];
  let _lastToastCheck = null;
  const _stubNoted = {};

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

  // Is a map_flourish of this kind on right now (visual clock)?
  function flourishActive(kind) {
    return activeAt(_now()).some(h => (h.effects || []).some(e => e.type === 'map_flourish' && e.kind === kind));
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

  // HTML for the HUD dial panel's "Upcoming Happenings" section ('' = empty).
  function hudHtml(ms) {
    const list = upcoming(ms, LIST_HOURS).slice(0, 8);
    if (!list.length) return '';
    return list.map(u =>
      '<div class="hc-hap' + (u.active ? ' hc-hap-active' : '') + '">' +
        '<span class="hc-hap-icon">' + _esc(u.h.icon || '🏮') + '</span>' +
        '<span class="hc-hap-main"><span class="hc-hap-title">' + _esc(u.h.title) + '</span>' +
          '<span class="hc-hap-when">' + (u.active ? 'On now · ends ' + _esc(_local(u.endMs)) : _esc(_local(u.startMs))) + '</span></span>' +
        '<span class="hc-hap-in">' + (u.active ? 'ends in ' + _dur(u.endMs - ms) : 'in ' + _dur(u.startMs - ms)) + '</span>' +
      '</div>').join('');
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
          root.showToastNotification((h.icon || '🏮') + ' ' + h.title + ' has begun!' + (h.flavour ? ' ' + h.flavour : ''), 'event');
        }
      }
    }
  }

  function _noteStubs() {
    for (const h of activeAt(_now())) for (const e of h.effects || []) {
      if (e.type === 'map_flourish' && e.kind !== 'lanterns' && !_stubNoted[e.kind]) {
        _stubNoted[e.kind] = true;
        console.info('[Happenings] map_flourish "' + e.kind + '" is not drawn yet (v1 draws lanterns only).');
      }
    }
  }

  function _refresh() {
    _noteStubs();
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
    load, upcoming, activeAt, flourishActive, hudHtml,
    defs: () => _defs.slice(),
    _setDefsForTest(d) { _defs = d || []; }, _checkToasts, _resetToastsForTest(at) { _lastToastCheck = at == null ? null : at; },
  };

  if (!root.__KW_NO_AUTOSTART) {
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : this);
