// ══════════════════════════════════════════════════════════════════════════
//  KWLifeScenes — hands new chronicle lines to the Home scene
//  (docs/HOME_SCENE.md §3.9). The scene's engine only draws; this is the
//  part that reads. While Home is showing it reads the town's chronicle
//  (when Home opens, then every 45 seconds) and gives the lines to
//  KWCast.offerLife, which plays the fresh ones as small scenes. It reads
//  only: the chronicle line is the event, the scene shows it.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const POLL_MS = 45000;
  const S = { home: false, timer: null, busy: false };
  async function read() {
    if (!S.home || S.busy || typeof global.apiFetch !== 'function' || !global.KWCast || !global.KWCast.offerLife) return 0;
    if (global.document && global.document.hidden) return 0;
    S.busy = true;
    try {
      const r = await global.apiFetch('/api/families/all/chronicle');
      if (!r.ok) return 0;
      const d = await r.json();
      S.recent = (d.entries || []).slice(0, 40);   // what has happened lately (a villager's thought reads it)
      return global.KWCast.offerLife(d.entries || []);
    } catch (_) { return 0; } finally { S.busy = false; }
  }
  function home(on) {
    S.home = !!on;
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    if (S.home) { setTimeout(read, 1500); S.timer = setInterval(read, POLL_MS); }
  }
  if (global.addEventListener) global.addEventListener('kw:home', e => home(!!(e.detail && e.detail.open)));
  global.KWLifeScenes = { read, POLL_MS, recent: () => S.recent || [], _home: home, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
