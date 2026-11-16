// ══════════════════════════════════════════════════════════════════════════
//  KWMusic — the loading screen's music and Home's (docs/HOME_SCENE.md §3.11).
//
//    assets/audio/music/loading.mp3      loops on the loading screen
//    assets/audio/music/home_day.mp3     Home, dawn and day
//    assets/audio/music/home_night.mp3   Home, dusk and night (optional: home_day
//                                        stands in when it's missing)
//
//  · Start playing fades the loading music out over 1.5 s while Home's fades
//    in over 2 s.
//  · Home's music loops while Home shows, cross-fades between day and night
//    with the scene's time of day (#settlement-view[data-phase]), fades out
//    when Home closes or other music takes over (a battle, a tavern game, the
//    menu track), and pauses while the tab is hidden.
//  · It follows the music volume and mute (js/audio.js, the kw-music-volume
//    event). The ambient beds duck under it (js/audio.js _ambDuckFor).
//  · Browsers block sound until the player has pressed something. Until then
//    nothing is played and nothing is said; the first press or key starts
//    whatever should be playing. A missing file is silent.
//  · It never overlaps welcome.mp3 (#bg-music, js/welcome-music-guard.js):
//    starting the loading music pauses it, and while it plays ours stay down.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const doc = global.document;
  const BASE = '/assets/audio/music/';
  const FILES = { loading: BASE + 'loading.mp3', day: BASE + 'home_day.mp3', night: BASE + 'home_night.mp3' };
  const FADE = { in: 2000, out: 1500, xfade: 4000, other: 1000 };
  const TICK_MS = 50;

  // Each track: an <audio> made on first need, its gain (0–1) easing toward a
  // target at a rate, and whether its file failed.
  const T = {};
  // A press has happened already (a fresh login) if the browser says so.
  const S = { scene: null, gestured: !!(global.navigator && global.navigator.userActivation && global.navigator.userActivation.hasBeenActive), timer: 0, warned: {} };

  function track(key) {
    if (T[key]) return T[key];
    const t = T[key] = { key, audio: null, gain: 0, target: 0, rate: 1 / FADE.in, dead: false, blocked: false };
    if (!global.Audio) { t.dead = true; return t; }
    const a = new global.Audio();
    a.loop = true; a.preload = 'none'; a.volume = 0;
    a.addEventListener('error', () => {
      t.dead = true;
      if (!S.warned[key]) { S.warned[key] = true; try { console.info('[music] no ' + FILES[key] + ' yet; staying quiet'); } catch (_) {} }
      kick();
    });
    a.src = FILES[key];
    t.audio = a;
    return t;
  }
  const musicVol = () => (typeof global.getMusicVolume === 'function' ? global.getMusicVolume() : 0.5);
  const hidden = () => !!(doc && doc.hidden);
  // Someone else's music is sounding: a battle or tavern game (js/audio.js),
  // or the menu's welcome.mp3.
  function othersPlaying() {
    try { if (global.KWAmbient && global.KWAmbient.otherMusic && global.KWAmbient.otherMusic()) return true; } catch (_) {}
    const bg = doc && doc.getElementById('bg-music');
    return !!(bg && !bg.paused);
  }
  // Home's track for the time of day showing: night's at dusk and night,
  // unless its file is missing.
  function homeKey() {
    const v = doc && doc.getElementById('settlement-view');
    const ph = v && v.getAttribute('data-phase');
    const night = ph === 'dusk' || ph === 'night';
    return night && !(T.night && T.night.dead) ? 'night' : 'day';
  }

  // What should be sounding, and how loud (before the music volume).
  // Pure on its inputs: { scene, home, others, hidden } → { loading, day, night }.
  function targets({ scene, homeTrack, others }) {
    const out = { loading: 0, day: 0, night: 0 };
    if (others) return out;
    if (scene === 'loading') out.loading = 1;
    else if (scene === 'home') out[homeTrack] = 1;
    return out;
  }

  function tick() {
    S.timer = 0;
    if (S.scene === 'loading') pauseWelcome();   // the loading music takes over from welcome.mp3, never on top of it
    const want = targets({ scene: S.scene, homeTrack: homeKey(), others: othersPlaying() });
    const vol = musicVol();
    let busy = false;
    for (const key of Object.keys(want)) {
      const w = want[key];
      if (!w && !T[key]) continue;
      const t = track(key);
      if (t.target !== w) {
        // In over 2 s, the loading music out over 1.5 s, anything else out
        // over 1 s; day and night swap places over 4 s.
        const other = key === 'day' ? T.night : key === 'night' ? T.day : null;
        const swap = !!(other && (w ? other.gain > 0 : want[other.key] > 0));
        t.rate = 1 / (swap ? FADE.xfade : w ? FADE.in : key === 'loading' ? FADE.out : FADE.other);
        t.target = w;
      }
      // Blocked until the player presses something: wait at silence.
      if (t.blocked && !S.gestured) { t.gain = 0; continue; }
      const step = t.rate * TICK_MS;
      t.gain = t.gain < t.target ? Math.min(t.target, t.gain + step) : Math.max(t.target, t.gain - step);
      if (t.gain !== t.target) busy = true;
      if (t.dead || !t.audio) continue;
      const a = t.audio;
      try {
        a.volume = Math.max(0, Math.min(1, vol * t.gain));
        const audible = t.gain > 0 && !hidden();
        if (audible && a.paused) {
          if (key === 'loading') pauseWelcome();
          const p = a.play();
          // Not allowed yet: silent, and the first press or key starts it.
          if (p && p.catch) p.catch(() => { if (!S.gestured) { t.blocked = true; t.gain = 0; try { a.pause(); } catch (_) {} } });
        } else if (!audible && !a.paused) {
          a.pause();
          if (t.gain === 0 && t.target === 0) { try { a.currentTime = 0; } catch (_) {} }
        }
      } catch (_) {}
    }
    if (busy) S.timer = setTimeout(tick, TICK_MS);
  }
  function kick() { if (!S.timer) S.timer = setTimeout(tick, 0); }

  function pauseWelcome() {
    const bg = doc && doc.getElementById('bg-music');
    if (bg && !bg.paused) { try { bg.pause(); } catch (_) {} }
  }

  // ── What the game tells us ──────────────────────────────────────────────
  function scene(s) { S.scene = s || null; kick(); }
  const api = {
    FILES, FADE, targets, scene,
    loading() { if (S.scene !== 'home') scene('loading'); },
    // Start playing: the loading music fades out (1.5 s); Home's fades in (2 s)
    // as Home opens.
    startPlaying() { scene(homeShowing() ? 'home' : null); },
    loadingDone() { if (S.scene === 'loading') scene(homeShowing() ? 'home' : null); },
    playing: () => Object.values(T).some(t => t.audio && !t.audio.paused && t.gain > 0.05),
    state: () => ({ scene: S.scene, gestured: S.gestured, tracks: Object.fromEntries(Object.values(T).map(t => [t.key, { gain: +t.gain.toFixed(2), target: t.target, dead: t.dead, blocked: t.blocked, paused: t.audio ? t.audio.paused : true }])) }),
  };
  function homeShowing() { return typeof global._svIsOpen === 'function' && global._svIsOpen(); }

  if (doc) {
    // Home opens and closes (js/settlement-view.js).
    global.addEventListener('kw:home', e => { if (e.detail && e.detail.open) scene('home'); else if (S.scene === 'home') scene(null); });
    // The first press or key: whatever was blocked can start now.
    const gesture = () => { if (S.gestured) return; S.gestured = true; for (const t of Object.values(T)) t.blocked = false; kick(); };
    doc.addEventListener('pointerdown', gesture, true);
    doc.addEventListener('keydown', gesture, true);
    doc.addEventListener('visibilitychange', kick);
    global.addEventListener('kw-music-volume', kick);
    // The time of day changes on Home: cross-fade.
    const watch = () => {
      const v = doc.getElementById('settlement-view');
      if (!v || v._kwMusicWatched || typeof global.MutationObserver === 'undefined') return;
      v._kwMusicWatched = true;
      new global.MutationObserver(kick).observe(v, { attributes: true, attributeFilter: ['data-phase'] });
    };
    global.addEventListener('kw:home', watch);
    // Other music starting or stopping (a battle, a tavern game): look twice a
    // second while something of ours should be playing.
    setInterval(() => { if (S.scene) kick(); }, 500);
    // The loading screen may already be up (index.html shows it early on a
    // reload with a saved login).
    const ls = doc.getElementById('loading-screen');
    if (ls && ls.style.display === 'flex') api.loading();
  }

  global.KWMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
