// ══════════════════════════════════════════════════════════════════════════
//  REALTIME — Server-Sent Events client
//
//  Opens a long-lived stream to /api/stream and dispatches each pushed
//  event to a handler. The handlers refresh whatever client state the
//  event implies: pending battles, quest list, bell feed.
//
//  Why EventSource:
//    - Native browser API. Handles reconnection on transient drops with
//      exponential backoff. We don't have to manage timers or backoff.
//    - Carries the auth cookie automatically when withCredentials is set.
//
//  Limitations we have to work around:
//    - The EventSource constructor cannot set custom headers, so we cannot
//      attach the Authorization: Bearer header that apiFetch uses. We rely
//      on the auth cookie set at login. If the user has no cookie (rare
//      but possible if storage was wiped), we fall back to a ?token=...
//      query param.
//    - There is one stream per tab. Multiple open tabs → multiple streams,
//      one per page. That's fine — the bus fan-outs handle it.
//    - EventSource only retries on network errors. If the server returns
//      a 4xx (e.g. expired token), the browser STOPS retrying. So we
//      detect the error event and trigger an explicit reconnect.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  let _es = null;
  let _reconnectTimer = null;
  let _reconnectAttempts = 0;
  let _disabled = false;

  // Map of event.type → handler(event). Handlers are intentionally tiny —
  // each one knows what to refresh on the relevant change. The server
  // doesn't send full state; it sends "something changed, go fetch it."
  const HANDLERS = {
    // The first event the server sends — useful for confirming the stream
    // is wired up. We log once and reset the reconnect backoff.
    connected(ev) {
      _reconnectAttempts = 0;
      console.log('[realtime] connected to settlement', ev.settlement_id);
    },

    // A quest finished — completed or failed. Reload quest list so the
    // collectible cards appear; the quests poller's toast/dedupe set will
    // fire its "they returned!" toast on the refreshed data.
    quest_resolved(ev) {
      if (typeof refreshActiveQuests === 'function') {
        // refreshActiveQuests is async. The wrapping try/catch only catches
        // sync throws, so we attach .then to surface async rejections —
        // those would otherwise be silent and very hard to debug.
        try {
          const p = refreshActiveQuests();
          if (p && typeof p.then === 'function') {
            p.catch(err => console.error('[realtime] refreshActiveQuests rejected', err));
          }
        } catch(e) { console.error('[realtime] refreshActiveQuests threw sync', e); }
      } else {
        console.warn('[realtime] refreshActiveQuests not defined');
      }
      // The bell feed also needs to refresh so the chronicle entry shows up
      // and the badge updates. (Function is `loadEvents`, not `loadEventsFeed`.)
      if (typeof loadEvents === 'function') {
        try { loadEvents(); } catch(e) {}
      }
    },

    // A new battle is awaiting the player. Refresh the battles badge so
    // the red dot appears, and reload quests so the quest's timer freezes
    // and shows "⚔ Awaiting combat".
    combat_pending(ev) {
      if (typeof refreshBattleBadge === 'function') {
        try { refreshBattleBadge(); } catch(e) {}
      }
      if (typeof refreshActiveQuests === 'function') {
        try { refreshActiveQuests(); } catch(e) {}
      }
    },

    // A battle finished (auto-resolved or manually). Refresh badges and
    // quest list. We don't fire a toast directly from this handler — the
    // quest_resolved event (when the quest also ended in defeat) handles
    // that path, and victories just resume the quest with no toast.
    combat_resolved(ev) {
      if (typeof refreshBattleBadge === 'function') {
        try { refreshBattleBadge(); } catch(e) {}
      }
      if (typeof refreshActiveQuests === 'function') {
        try { refreshActiveQuests(); } catch(e) {}
      }
    },
  };

  function _buildStreamUrl() {
    // Same API base apiFetch uses. We append the token as a query param
    // because EventSource can't set Authorization headers — the cookie
    // covers it in normal browser flow, but the query param is a belt-and-
    // braces fallback for users without a current cookie.
    const base = typeof API !== 'undefined' ? API : '';
    let url = base + '/api/stream';
    try {
      const token = typeof getStoredToken === 'function' ? getStoredToken() : null;
      if (token) {
        url += (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
      }
    } catch (e) {}
    return url;
  }

  function connect() {
    if (_disabled) return;
    if (_es) {
      try { _es.close(); } catch (e) {}
      _es = null;
    }
    const url = _buildStreamUrl();
    try {
      _es = new EventSource(url, { withCredentials: true });
    } catch (e) {
      console.warn('[realtime] EventSource not supported, falling back to polling.', e);
      _disabled = true;
      return;
    }

    _es.onmessage = (msg) => {
      let payload;
      try { payload = JSON.parse(msg.data); }
      catch (e) { console.warn('[realtime] bad JSON', msg.data); return; }
      // Diagnostic: log every event we receive. The recent quest_resolved
      // regression turned out to be observable only via SSE delivery —
      // having the log on by default catches "events aren't firing"
      // failure modes that don't otherwise surface anywhere. Cheap (a
      // handful of lines per quest cycle); fine to leave in.
      console.log('[realtime] received', payload.type, payload);
      const handler = HANDLERS[payload.type];
      if (handler) {
        try { handler(payload); }
        catch (e) { console.error('[realtime] handler threw for', payload.type, e); }
      } else {
        console.warn('[realtime] no handler for', payload.type);
      }
    };

    _es.onerror = (err) => {
      // EventSource native retries handle transient drops fine. We still
      // step in for 4xx (which stops native retries) by reconnecting with
      // backoff after a delay. The browser's readyState tells us the state:
      //   0 = CONNECTING (transient, native will retry)
      //   1 = OPEN
      //   2 = CLOSED (we need to act)
      if (_es && _es.readyState === 2) {
        const delay = Math.min(30000, 1000 * Math.pow(2, _reconnectAttempts));
        _reconnectAttempts++;
        if (_reconnectTimer) clearTimeout(_reconnectTimer);
        _reconnectTimer = setTimeout(connect, delay);
      }
    };
  }

  function disconnect() {
    _disabled = true;
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_es) { try { _es.close(); } catch (e) {} _es = null; }
  }

  // Expose globally. start() is called from main.js once gameData is loaded;
  // we don't open the stream during the loading screen because the cookie
  // might not be settled yet on very first session.
  global.startRealtime = connect;
  global.stopRealtime = disconnect;
})(typeof window !== 'undefined' ? window : globalThis);
