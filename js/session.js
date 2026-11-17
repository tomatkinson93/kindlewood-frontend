// ══════════════════════════════════════════════════════════════════════════
//  KWSession — "Keep me signed in", and pausing when nobody is there.
//
//  Keep me signed in (ticked by default on the sign-in and register forms):
//    · Ticked: as before, signed in on this device for a week.
//    · Unticked (a shared computer): the sign-in ends when the browser closes
//      (a session cookie marks the browser session), when the page has been
//      closed for 15 minutes, or after 15 minutes without touching the game.
//      The server also gives a 12-hour token instead of a week's. The check
//      when the page opens is a few lines in index.html, before anything
//      reads the token.
//
//  Away: after 15 minutes without input (a pointer, a key, a wheel, a touch),
//  background requests to the server stop: every fetch to /api/ answers at
//  once with status 499 and { paused: true }. A hidden tab closes its live
//  stream too; a tab that is showing keeps it, and keeps animating, so the
//  town can still be watched. A small pill says so. Any input, or coming
//  back to the tab, carries on: the stream reopens and the stores, moments
//  and citizens are read again.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const IDLE_MS = 15 * 60 * 1000;
  const KEY_ONLY = 'kw_session_only', KEY_SEEN = 'kw_session_seen', COOKIE = 'kw_alive';
  const ls = (k, v) => { try { if (v === undefined) return global.localStorage.getItem(k); if (v === null) global.localStorage.removeItem(k); else global.localStorage.setItem(k, v); } catch (_) { /* private mode */ } return null; };
  const S = { last: Date.now(), away: false, streamClosed: false, now: () => Date.now() };

  // ── Rules (pure) ────────────────────────────────────────────────────────
  // Whether a sign-in made without "Keep me signed in" has ended, when the
  // page opens. `alive`: the browser session's cookie is still there.
  function ended({ only, alive, seen, now }, idle = IDLE_MS) {
    if (!only) return false;
    return !alive || !(seen > 0) || now - seen > idle;
  }
  // Nobody there: no input for `idle`.
  const isAway = (now, last, idle = IDLE_MS) => now - last >= idle;
  // A request the pause holds back: anything to the game's API.
  const isApi = input => { const u = typeof input === 'string' ? input : input && input.url; return typeof u === 'string' && u.indexOf('/api/') >= 0; };

  const sessionOnly = () => ls(KEY_ONLY) === '1';
  const signedIn = () => !!ls('kw_token');
  const inGame = () => { const g = doc && doc.getElementById('screen-game'); return !!(g && g.classList.contains('active')); };

  // Called when signing in or registering: `keep` is the tick box.
  function remember(keep) {
    if (keep) { ls(KEY_ONLY, null); ls(KEY_SEEN, null); return; }
    ls(KEY_ONLY, '1');
    ls(KEY_SEEN, String(S.now()));
    try { doc.cookie = COOKIE + '=1; path=/; SameSite=Lax'; } catch (_) { /* no cookies */ }   // no expiry: gone when the browser closes
  }
  function forget() { ls(KEY_ONLY, null); ls(KEY_SEEN, null); }

  // ── Away and back ───────────────────────────────────────────────────────
  function pill(on) {
    if (!doc || !doc.body) return;
    let p = doc.getElementById('kw-away-pill');
    if (!on) { if (p) p.remove(); return; }
    if (p) return;
    p = doc.createElement('div');
    p.id = 'kw-away-pill';
    p.className = 'kw-away-pill';
    p.setAttribute('role', 'status');
    p.textContent = '⏸ Paused while you were away. Move or tap to carry on.';
    doc.body.appendChild(p);
  }
  function goAway() {
    if (S.away || !signedIn() || !inGame()) return;
    if (sessionOnly()) {   // a shared computer: signed out, and told why
      const done = typeof global.logout === 'function' ? Promise.resolve(global.logout()).catch(() => {}) : Promise.resolve();
      done.then(() => {
        if (typeof global.showScreen === 'function') global.showScreen('login');
        if (typeof global.showMsg === 'function') global.showMsg('login-success', 'You were signed out after 15 minutes away. Sign in to carry on.');
      });
      return;
    }
    S.away = true;
    if (doc.body) doc.body.classList.add('kw-away');
    pill(true);
    if (doc.hidden) closeStream();
    try { global.dispatchEvent(new global.CustomEvent('kw:away', { detail: { away: true } })); } catch (_) { /* old browser */ }
  }
  function closeStream() {
    if (S.streamClosed || typeof global.stopRealtime !== 'function') return;
    S.streamClosed = true;
    try { global.stopRealtime(); } catch (_) { /* not started */ }
  }
  function comeBack() {
    if (!S.away) return;
    S.away = false;
    if (doc.body) doc.body.classList.remove('kw-away');
    pill(false);
    if (S.streamClosed) { S.streamClosed = false; if (typeof global.restartRealtime === 'function') { try { global.restartRealtime(); } catch (_) { /* later */ } } }
    // What moved on meanwhile.
    const again = f => { try { const r = f(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* not loaded */ } };
    if (typeof global.refreshResources === 'function') again(() => global.refreshResources());
    if (global.KWMoments && global.KWMoments.load) again(() => global.KWMoments.load());
    if (global.KWSocial && global.KWSocial.load) again(() => global.KWSocial.load(true));
    if (global.KWBuild && global.KWBuild.load) again(() => global.KWBuild.load());
    if (global.KWUpkeep && global.KWUpkeep.load) again(() => global.KWUpkeep.load());
    if (global.KWLost && global.KWLost.load) again(() => global.KWLost.load());
    if (typeof global.loadCitizens === 'function') again(() => global.loadCitizens());
    if (typeof global.refreshSettlementView === 'function') again(() => global.refreshSettlementView());
    try { global.dispatchEvent(new global.CustomEvent('kw:away', { detail: { away: false } })); } catch (_) { /* old browser */ }
  }
  function input() { S.last = S.now(); if (S.away) comeBack(); }
  function check() {
    const now = S.now();
    if (sessionOnly() && signedIn() && !S.away && !isAway(now, S.last)) ls(KEY_SEEN, String(now));   // still here
    if (!S.away && isAway(now, S.last)) goAway();
  }

  if (doc) {
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => doc.addEventListener(t, input, { capture: true, passive: true }));
    let moved = 0;
    doc.addEventListener('pointermove', () => { const n = S.now(); if (n - moved > 2000) { moved = n; input(); } }, { capture: true, passive: true });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) { if (S.away) closeStream(); }
      else if (S.away) input();   // back at the tab
    });
    setInterval(check, 30000);
    // While away, the game's own requests wait: polls answer at once, unsent.
    if (typeof global.fetch === 'function') {
      const real = global.fetch.bind(global);
      global.fetch = function (input, init) {
        if (S.away && isApi(input)) return Promise.resolve(new global.Response('{"paused":true}', { status: 499, headers: { 'Content-Type': 'application/json' } }));
        return real(input, init);
      };
    }
  }

  global.KWSession = {
    IDLE_MS, remember, forget, sessionOnly, away: () => S.away,
    _ended: ended, _isAway: isAway, _isApi: isApi, _check: check, _input: input, _state: S,
  };
})(typeof window !== 'undefined' ? window : globalThis);
