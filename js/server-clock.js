// ══════════════════════════════════════════════════════════════════════════
//  KWClock — the client's server-synced clock (spec 021 §2.3).
//
//  wallNow()   server UTC time (Date.now() + sync offset). Seasons and any
//              economy display use this — a wrong PC clock no longer shows
//              the wrong season.
//  now()       wallNow() + the dev visual override, if any.
//  phase() / sun() / moon()   KWDayCycle at now().
//  lighting()  KWDayCycle.lightingAt(now()), tweened over 2.5s (0.6s under
//              prefers-reduced-motion) whenever the override changes.
//  onChange(fn)  fn({ reason: 'phase'|'moon'|'override'|'sync', ... }).
//
//  Dev override (localStorage 'kw_dev_clock'), decided behaviour: JUMP, RUN,
//  EXPIRE. Dawn/Day/Dusk/Night, an hour or a moon jump the clock there, then
//  time keeps moving; after 2h it snaps back to live. 'fast' runs 1 real
//  minute = 24h, also for at most 2h. For admins, phase/hour/moon are also
//  sent to POST /api/game/time/debug and the server's offset is adopted, so
//  visuals and gameplay agree and expire together. Non-admins get a 403,
//  which is ignored: the override stays visual and local to this browser.
//
//  Harnesses: KWClock.pin(ms) freezes wallNow()/now() (golden renders pin to
//  noon UTC so they never depend on the real time of day); unpin() releases.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  var D = root.KWDayCycle;
  var LS_KEY = 'kw_dev_clock';
  var TTL_MS = 2 * 60 * 60 * 1000;
  var RESYNC_MS = 30 * 60 * 1000;
  var FAST_RATE = 1440;               // 1 real minute = 24h
  var CHECK_MS = 1000;

  var _offset = 0;                    // server - local
  var _warned = false;
  var _pinned = null;
  var _me = null;                     // last /time/me payload
  var _ov = _loadOverride();          // { mode, value, offsetMs, setAt, expiresAt }
  var _listeners = [];
  var _last = { phase: null, moon: null };
  var _tween = null;                  // { from, start, dur }
  var _timer = null;

  function _perf() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function _api() { return root.KINDLEWOOD_API || ''; }
  function _token() { try { return root.localStorage.getItem('kw_token') || ''; } catch (e) { return ''; } }

  // ── clocks ────────────────────────────────────────────────────────────────
  function wallNow() { return _pinned != null ? _pinned : Date.now() + _offset; }

  function _activeOverride() {
    if (!_ov || _ov.mode === 'live') return null;
    if (wallNow() >= _ov.expiresAt) { _setOverride(null, 'expired'); return null; }
    return _ov;
  }

  // Time under a given override, without the expiry check (no recursion).
  function _timeUnder(o, w) {
    if (!o) return w;
    if (o.mode === 'fast') return o.setAt + o.offsetMs + (w - o.setAt) * FAST_RATE;
    return w + o.offsetMs;
  }

  function now() {
    var w = wallNow();
    return _timeUnder(_activeOverride(), w);
  }

  function phase() { return D.phaseAt(now()); }
  function sun() { return D.sunAt(now()); }
  function moon() { return D.moonAt(now()); }

  function _reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function _lerpL(a, b, t) {
    function l(x, y) { return x + (y - x) * t; }
    return {
      darkness: l(a.darkness, b.darkness), tintStrength: l(a.tintStrength, b.tintStrength),
      lightLevel: l(a.lightLevel, b.lightLevel), warmth: l(a.warmth, b.warmth),
      tint: [Math.round(l(a.tint[0], b.tint[0])), Math.round(l(a.tint[1], b.tint[1])), Math.round(l(a.tint[2], b.tint[2]))],
    };
  }

  // lighting(ovOverride?) — the optional argument evaluates the target under
  // a specific override (used internally to start a new tween mid-tween).
  function lighting(ovArg) {
    var target = D.lightingAt(arguments.length ? _timeUnder(ovArg, wallNow()) : now());
    if (!_tween) return target;
    var t = (_perf() - _tween.start) / _tween.dur;
    if (t >= 1) { _tween = null; return target; }
    t = t * t * (3 - 2 * t);
    return _lerpL(_tween.from, target, t);
  }

  // ── override ─────────────────────────────────────────────────────────────
  function _loadOverride() {
    try {
      var o = JSON.parse(root.localStorage.getItem(LS_KEY) || 'null');
      if (o && o.mode && o.mode !== 'live' && typeof o.expiresAt === 'number') return o;
    } catch (e) {}
    return null;
  }
  function _saveOverride() {
    try {
      if (_ov) root.localStorage.setItem(LS_KEY, JSON.stringify(_ov));
      else root.localStorage.removeItem(LS_KEY);
    } catch (e) {}
  }

  function _setOverride(o, why) {
    // Tween start: the CURRENT (possibly just-expired) override's lighting,
    // computed directly so expiry inside now() can't recurse.
    var from = _tween ? lighting.call(null, _ov) : D.lightingAt(_timeUnder(_ov && _ov.mode !== 'live' ? _ov : null, wallNow()));
    _ov = o;
    _saveOverride();
    _tween = { from: from, start: _perf(), dur: _reducedMotion() ? 600 : 2500 };
    _emit({ reason: 'override', override: overrideState(), why: why || null });
    _check();
  }

  // Parse 'live' | 'phase:night' | 'hour:21.5' | 'moon:4' | 'fast'.
  function _parseMode(spec) {
    var s = String(spec || 'live'), i = s.indexOf(':');
    var mode = i < 0 ? s : s.slice(0, i), val = i < 0 ? null : s.slice(i + 1);
    if (mode === 'live' || mode === 'fast') return { mode: mode };
    if (mode === 'phase' && D.PHASE_IDS.indexOf(val) >= 0) return { mode: mode, value: val, req: { phase: val } };
    if (mode === 'hour') {
      var h = parseFloat(val);
      if (isFinite(h) && h >= 0 && h < 24) return { mode: mode, value: h, req: { hour: h } };
    }
    if (mode === 'moon') {
      var m = parseInt(val, 10);
      if (m >= 0 && m <= 7) return { mode: mode, value: m, req: { moon: m } };
    }
    return null;
  }

  function setOverride(spec) {
    var p = _parseMode(spec);
    if (!p) { console.warn('[KWClock] unknown override', spec); return false; }
    var w = wallNow();
    if (p.mode === 'live') {
      _setOverride(null, 'live');
      _postDebug({ clear: true });
      return true;
    }
    if (p.mode === 'fast') {
      var cur = _activeOverride();
      var curOff = cur ? (now() - w) : 0;
      _setOverride({ mode: 'fast', value: null, offsetMs: curOff, setAt: w, expiresAt: w + TTL_MS }, 'set');
      return true;
    }
    // Jump from the current visual time so picks compose (Night → Full moon).
    var base = _activeOverride() ? now() - w : 0;
    var off = D.overrideOffset(p.req, w, base);
    _setOverride({ mode: p.mode, value: p.value, offsetMs: off, setAt: w, expiresAt: w + TTL_MS }, 'set');
    // Admins: the server applies the same offset (sent as offsetMs so both
    // sides agree exactly), and we adopt its expiry.
    _postDebug({ offsetMs: off });
    return true;
  }

  function overrideState() {
    var o = _activeOverride();
    if (!o) return { mode: 'live', label: 'live', offsetMs: 0, expiresAt: null };
    var label = o.mode === 'fast' ? 'fast'
      : o.mode === 'offset' ? 'server offset ' + (o.offsetMs >= 0 ? '+' : '') + (o.offsetMs / 3600000).toFixed(1) + 'h'
      : o.mode + ':' + o.value;
    return { mode: o.mode, value: o.value, label: label, offsetMs: o.offsetMs, expiresAt: o.expiresAt };
  }

  // ── server ───────────────────────────────────────────────────────────────
  function _fetchJson(path, opts) {
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('no fetch'));
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    var tok = _token();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    return root.fetch(_api() + path, Object.assign({ credentials: 'include', cache: 'no-store' }, opts, { headers: headers }))
      .then(function (r) { return r.ok ? r.json().then(function (j) { return { status: r.status, body: j }; }) : { status: r.status, body: null }; });
  }

  function _postDebug(body) {
    if (!_token()) return Promise.resolve(null);
    return _fetchJson('/api/game/time/debug', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) {
      if (r.status !== 200 || !r.body) return null;      // 403 for non-admins: ignored
      _me = r.body;
      // wallNow() is already in server time, so the server's expiry applies as-is.
      if (_ov && _ov.mode !== 'fast' && r.body.debugExpiresAt) {
        _ov.offsetMs = r.body.debugOffsetMs;
        _ov.expiresAt = r.body.debugExpiresAt;
        _saveOverride();
      }
      _emit({ reason: 'sync' });
      return r.body;
    }).catch(function () { return null; });
  }

  // Admins only: keep visuals and gameplay agreeing after a server restart
  // (server lost the offset → re-send it) or a cleared browser (server still
  // has one → adopt it as the visual override).
  function _reconcile() {
    if (!_me || !_me.isAdmin) return;
    var o = _activeOverride();
    if (o && o.mode !== 'fast' && !_me.debugOffsetMs) {
      _postDebug({ offsetMs: o.offsetMs });
    } else if (!o && _me.debugOffsetMs && _me.debugExpiresAt) {
      _setOverride({ mode: 'offset', value: _me.debugOffsetMs, offsetMs: _me.debugOffsetMs,
                     setAt: wallNow(), expiresAt: _me.debugExpiresAt }, 'adopted');
    }
  }

  function sync() {
    var t0 = Date.now();
    return _fetchJson('/api/game/time').then(function (r) {
      var t1 = Date.now();
      if (r.status !== 200 || !r.body || typeof r.body.now !== 'number') throw new Error('bad /time');
      _offset = Math.round(r.body.now - (t0 + t1) / 2);   // whole ms: keeps now() off fractional boundaries
      if (!_token()) { _me = null; return null; }        // signed out: forget the admin flag
      return _fetchJson('/api/game/time/me').then(function (m) {
        if (m.status === 200) { _me = m.body; _reconcile(); }
      });
    }).then(function () {
      _emit({ reason: 'sync' });
      _check();
    }).catch(function (e) {
      if (!_warned) { _warned = true; console.warn('[KWClock] time sync failed; keeping last offset', e && e.message); }
    });
  }

  // ── change detection ─────────────────────────────────────────────────────
  function onChange(fn) {
    if (typeof fn === 'function') _listeners.push(fn);
    return function () { _listeners = _listeners.filter(function (f) { return f !== fn; }); };
  }
  function _emit(ev) {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](ev); } catch (e) { console.warn('[KWClock] listener error', e); }
    }
  }
  function _check() {
    var t = now();
    var p = D.phaseAt(t).phase, m = D.moonIndexAt(t);
    if (_last.phase !== null && p !== _last.phase) _emit({ reason: 'phase', phase: p, prev: _last.phase });
    if (_last.moon !== null && m !== _last.moon) _emit({ reason: 'moon', moon: m, prev: _last.moon });
    _last.phase = p; _last.moon = m;
    _activeOverride();   // lets an expired override revert (and emit) promptly
  }

  // ── test seam ────────────────────────────────────────────────────────────
  function pin(ms) { _pinned = Number(ms); _tween = null; _check(); }
  function unpin() { _pinned = null; _check(); }

  function start() {
    if (_timer) return;
    _check();
    _timer = setInterval(_check, CHECK_MS);
    setInterval(sync, RESYNC_MS);
    try {
      root.document.addEventListener('visibilitychange', function () {
        if (!root.document.hidden) sync();
      });
    } catch (e) {}
    sync();
  }

  root.KWClock = {
    wallNow: wallNow, now: now, phase: phase, sun: sun, moon: moon,
    lighting: function () { return lighting(); },
    onChange: onChange, setOverride: setOverride, override: overrideState,
    me: function () { return _me; }, serverOffset: function () { return _offset; },
    sync: sync, pin: pin, unpin: unpin, start: start,
    _check: _check,
  };

  if (!root.__KW_NO_AUTOSTART) start();
})(typeof window !== 'undefined' ? window : this);
