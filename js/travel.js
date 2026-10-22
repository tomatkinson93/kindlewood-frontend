// ══════════════════════════════════════════════════════════════════════════
//  KWTravel — citizen journeys for the world map's travel path layer
//
//  Data side only (map renderer files may not fetch — see MAP_RENDERER.md);
//  js/kwmap-travel.js draws what this holds. Server: GET /api/travel
//  (kindlewood-server lib/travel.js) — the viewer's own travellers plus
//  merchants bringing them goods, each with both end tiles and times.
//
//  Refreshes on load, every 60s while the page is visible, on realtime
//  events (realtime.js) and right after the player starts a journey.
//  The on/off switch persists as localStorage kw_map_paths (on by default);
//  the 🐾 Paths map button and Settings → Graphics both drive it.
//
//  Depends on: apiFetch (main.js), KWClock (server-clock.js, optional).
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const LS_KEY = 'kw_map_paths';
  const POLL_MS = 60 * 1000;
  let _journeys = [];
  let _skew = 0;            // server now − client now (ms)
  let _loading = false;
  let _again = false;
  let _timer = null;
  let _enabled = (() => {
    try { return global.localStorage.getItem(LS_KEY) !== '0'; } catch (e) { return true; }
  })();

  const now = () => Date.now() + _skew;

  function mapW() { return typeof HEX_MAP_W !== 'undefined' ? HEX_MAP_W : 40; }
  function mapH() { return typeof HEX_MAP_H !== 'undefined' ? HEX_MAP_H : 40; }

  // Hex line from `a` to `b` taking the shortest way round the wrapping map
  // (mirrors the server's hexLinePath). Returns UNWRAPPED offsets from `a`
  // ({dq, dr}), so a path crossing the map edge stays one continuous line.
  function hexLine(a, b, W, H) {
    W = W || mapW(); H = H || mapH();
    let dq = b.q - a.q, dr = b.r - a.r;
    if (Math.abs(dq) > W / 2) dq = dq > 0 ? dq - W : dq + W;
    if (Math.abs(dr) > H / 2) dr = dr > 0 ? dr - H : dr + H;
    const N = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
    const out = [];
    for (let i = 0; i <= N; i++) {
      const t = N === 0 ? 0 : i / N;
      const fq = dq * t, fr = dr * t, fs = -fq - fr;
      let rq = Math.round(fq), rr = Math.round(fr);
      const rs = Math.round(fs);
      const qD = Math.abs(rq - fq), rD = Math.abs(rr - fr), sD = Math.abs(rs - fs);
      if (qD > rD && qD > sD) rq = -rr - rs;
      else if (rD > sD) rr = -rq - rs;
      const last = out[out.length - 1];
      if (!last || last.dq !== rq || last.dr !== rr) out.push({ dq: rq, dr: rr });
    }
    return out;
  }

  // Where a journey is at time `t`:
  //   { leg: 'out'|'back'|'done', p: 0..1 along the current leg }
  // On the way back p runs from the destination (0) to home (1).
  function phase(j, t) {
    const dep = Date.parse(j.departs_at), arr = Date.parse(j.arrives_at);
    const clamp = v => Math.max(0, Math.min(1, v));
    if (t < arr || !j.returns_at) return { leg: t >= arr && !j.returns_at ? 'done' : 'out', p: clamp((t - dep) / Math.max(1, arr - dep)) };
    const ret = Date.parse(j.returns_at);
    if (t >= ret) return { leg: 'done', p: 1 };
    return { leg: 'back', p: clamp((t - arr) / Math.max(1, ret - arr)) };
  }

  // Seconds until the current leg ends.
  function secondsLeft(j, t) {
    const ph = phase(j, t);
    const end = ph.leg === 'back' ? Date.parse(j.returns_at) : Date.parse(j.arrives_at);
    return Math.max(0, Math.round((end - t) / 1000));
  }

  function live() {
    const t = now();
    return _journeys.filter(j => phase(j, t).leg !== 'done');
  }

  async function refresh() {
    if (typeof global.apiFetch !== 'function') return;
    if (_loading) { _again = true; return; }
    _loading = true;
    try {
      const res = await global.apiFetch('/api/travel');
      if (res.ok) {
        const data = await res.json();
        if (data.now) _skew = Date.parse(data.now) - Date.now();
        _journeys = Array.isArray(data.journeys) ? data.journeys : [];
        syncButton();
        redraw();
      }
    } catch (e) { /* next poll retries */ }
    finally {
      _loading = false;
      if (_again) { _again = false; refresh(); }
    }
  }

  // Soon after something starts a journey (the server has just written it).
  function soon(ms) { setTimeout(refresh, ms == null ? 600 : ms); }

  function redraw() {
    const KW = global.KWMap;
    if (KW && KW.controller) KW.controller.requestRender();
  }

  function setEnabled(on) {
    _enabled = !!on;
    try { global.localStorage.setItem(LS_KEY, _enabled ? '1' : '0'); } catch (e) {}
    syncButton();
    if (global.KWTravelLayer && global.KWTravelLayer.hideCard) global.KWTravelLayer.hideCard();
    redraw();
    const box = document.querySelector('[data-travel-setting]');
    if (box) box.checked = _enabled;
  }

  function syncButton() {
    const b = document.getElementById('map-paths-btn');
    if (!b) return;
    const n = live().length;
    b.classList.toggle('on', _enabled);
    b.setAttribute('aria-pressed', _enabled ? 'true' : 'false');
    b.title = _enabled ? 'Hide citizen travel paths' : 'Show citizen travel paths';
    const c = b.querySelector('.map-paths-n');
    if (c) c.textContent = n ? String(n) : '';
  }

  // Journeys start from many places (scout, envoy, quest, clan quest, market).
  // Rather than touch each, watch apiFetch for the POSTs that start one and
  // refresh shortly after. Passive: the call and its result are untouched.
  const STARTS = /^\/api\/(expeditions\/send|quests\/accept|diplomacy\/\d+\/(contact|goodwill|gift)|clan-quests\/runs|market\/(orders|npc|ironhaven|wants\/\d+\/fill))/;
  function watchApiFetch() {
    const orig = global.apiFetch;
    if (typeof orig !== 'function' || orig._kwTravel) return;
    const wrapped = function (path, opts) {
      const p = orig.apply(this, arguments);
      if (opts && opts.method === 'POST' && STARTS.test(String(path))) {
        Promise.resolve(p).then(r => { if (r && r.ok) soon(); }, () => {});
      }
      return p;
    };
    wrapped._kwTravel = true;
    global.apiFetch = wrapped;
  }

  function start() {
    if (_timer) return;
    watchApiFetch();
    refresh();
    _timer = setInterval(() => { if (!document.hidden) refresh(); else syncButton(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
  if (typeof document !== 'undefined' && !global.__KW_NO_AUTOSTART) {
    const go = () => {
      let token = null;
      try { token = global.localStorage.getItem('kw_token'); } catch (e) {}
      if (token) start(); else setTimeout(go, 3000);   // not logged in yet
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  }

  global.KWTravel = {
    journeys: live, all: () => _journeys.slice(), now, phase, secondsLeft, hexLine,
    enabled: () => _enabled, setEnabled, toggle: () => setEnabled(!_enabled),
    refresh, soon, syncButton,
    _setForTest(list, skew) { _journeys = list || []; _skew = skew || 0; },
  };
})(window);
