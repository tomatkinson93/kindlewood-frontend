// ══════════════════════════════════════════════════════════════════════════
//  AUDIO — battle music + future ambient layers
//
//  Design:
//    - A small registry of named tracks. Currently just BATTLE.
//    - Each track is preloaded at game-screen show, so by the time the
//      player triggers combat, playback starts instantly.
//    - Fade in/out on play/stop so transitions don't feel abrupt.
//    - User volume slider stored in localStorage (key 'kindlewood_music_vol').
//    - Browsers block autoplay until a user gesture. Battle music plays as
//      a direct consequence of clicking Engage / Send Party, so this is
//      satisfied. We catch Promise rejections silently anyway.
//
//  Adding more tracks later:
//    Just add another entry to TRACKS. To randomize within a category,
//    pass an array of URLs to playMusic and we'll pick one.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const STORAGE_KEY = 'kindlewood_music_vol';
  const DEFAULT_VOLUME = 0.5;
  const FADE_MS = 800;

  // Track registry. Each entry is an array — playMusic picks one at random,
  // so you can drop in more files without changing call sites.
  const TRACKS = {
    BATTLE: [
      '/assets/audio/battle-1.mp3',
      // Add more here later, e.g.:
      // '/assets/audio/battle-2.mp3',
      // '/assets/audio/battle-3.mp3',
    ],
  };

  // ── State ───────────────────────────────────────────────────────────────
  // We keep one Audio per *unique URL* so seeking back to the same track
  // doesn't restart it from scratch when the user re-enters combat.
  // Active playback is tracked separately.
  const _cache = new Map();        // url → HTMLAudioElement
  let _activeAudio = null;          // currently playing element
  let _activeFadeTimer = null;      // active fade interval handle
  let _userVolume = _loadVolume();

  // ── Public: preload everything ─────────────────────────────────────────
  // Idempotent — safe to call multiple times. Uses preload="auto" hint;
  // browsers may still defer until first play if the network is slow.
  function preloadAll() {
    for (const list of Object.values(TRACKS)) {
      for (const url of list) _preload(url);
    }
  }

  function _preload(url) {
    if (_cache.has(url)) return _cache.get(url);
    const a = new Audio();
    a.src = url;
    a.preload = 'auto';
    a.loop = true;
    a.volume = 0;        // start at 0; playMusic fades in
    // We don't kick off load() — assigning .src + setting preload triggers it.
    _cache.set(url, a);
    return a;
  }

  // ── Public: play a track category ──────────────────────────────────────
  // category is a key of TRACKS. If multiple URLs are registered, we pick
  // one at random. Returns the chosen URL (or null if category empty).
  function playMusic(category) {
    const list = TRACKS[category];
    if (!list || !list.length) return null;
    const url = list[Math.floor(Math.random() * list.length)];
    const audio = _preload(url);

    // If something else is playing, fade it out then start this one.
    if (_activeAudio && _activeAudio !== audio) {
      _fadeOut(_activeAudio, FADE_MS, () => { try { _activeAudio.pause(); } catch(e) {} });
    }

    _activeAudio = audio;
    audio.volume = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      // Autoplay blocked, network issue, etc. Fail silently — better than
      // throwing a console error in the middle of combat.
      playPromise.catch(() => {});
    }
    _fadeIn(audio, _userVolume, FADE_MS);
    return url;
  }

  // ── Public: stop whatever's playing ────────────────────────────────────
  function stopMusic() {
    if (!_activeAudio) return;
    const a = _activeAudio;
    _activeAudio = null;
    _fadeOut(a, FADE_MS, () => {
      try { a.pause(); a.currentTime = 0; } catch(e) {}
    });
  }

  // ── Public: volume control ─────────────────────────────────────────────
  function getVolume() { return _userVolume; }
  function setVolume(v) {
    _userVolume = Math.max(0, Math.min(1, +v || 0));
    _saveVolume(_userVolume);
    if (_activeAudio) {
      // No fade for direct slider drag — match the slider in real time.
      _activeAudio.volume = _userVolume;
    }
  }

  function _loadVolume() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return DEFAULT_VOLUME;
      const n = parseFloat(raw);
      return isNaN(n) ? DEFAULT_VOLUME : Math.max(0, Math.min(1, n));
    } catch(e) { return DEFAULT_VOLUME; }
  }
  function _saveVolume(v) {
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch(e) {}
  }

  // ── Fade helpers ───────────────────────────────────────────────────────
  // We use setInterval rather than the Web Audio API gain ramps because
  // HTMLAudioElement is the right primitive for streamed music tracks and
  // it doesn't need the full Web Audio graph. The cost of a 16ms interval
  // for 800ms is negligible.
  function _fadeIn(audio, target, durationMs) {
    if (_activeFadeTimer) { clearInterval(_activeFadeTimer); _activeFadeTimer = null; }
    const startVol = audio.volume;
    const startTime = performance.now();
    _activeFadeTimer = setInterval(() => {
      const t = Math.min(1, (performance.now() - startTime) / durationMs);
      audio.volume = startVol + (target - startVol) * t;
      if (t >= 1) { clearInterval(_activeFadeTimer); _activeFadeTimer = null; }
    }, 16);
  }
  function _fadeOut(audio, durationMs, onDone) {
    const startVol = audio.volume;
    const startTime = performance.now();
    const t = setInterval(() => {
      const p = Math.min(1, (performance.now() - startTime) / durationMs);
      audio.volume = startVol * (1 - p);
      if (p >= 1) {
        clearInterval(t);
        if (onDone) onDone();
      }
    }, 16);
  }

  // Expose globally
  global.preloadAllAudio = preloadAll;
  global.playMusic       = playMusic;
  global.stopMusic       = stopMusic;
  global.getMusicVolume  = getVolume;
  global.setMusicVolume  = setVolume;

  // ── Settings popover ────────────────────────────────────────────────────
  // Opens via the gear/settings menu. Reads the saved volume into the slider
  // and wires real-time updates. Saved to localStorage on every change.
  function openSettingsPopover() {
    const back = document.getElementById('settings-backdrop');
    if (!back) return;
    back.classList.add('visible');
    const slider = document.getElementById('settings-music-volume');
    const pct = document.getElementById('settings-music-volume-pct');
    if (slider) slider.value = Math.round(_userVolume * 100);
    if (pct)    pct.textContent = Math.round(_userVolume * 100) + '%';
  }
  function closeSettingsPopover(e) {
    // If invoked via the backdrop's onclick we get an event whose target IS
    // the backdrop. The inner card has its own stopPropagation so clicks
    // there don't reach this handler. So: any incoming event means "close."
    const back = document.getElementById('settings-backdrop');
    if (back) back.classList.remove('visible');
  }
  function onMusicVolumeSlide(val) {
    const v = (parseFloat(val) || 0) / 100;
    setVolume(v);
    const pct = document.getElementById('settings-music-volume-pct');
    if (pct) pct.textContent = Math.round(v * 100) + '%';
  }
  global.openSettingsPopover  = openSettingsPopover;
  global.closeSettingsPopover = closeSettingsPopover;
  global.onMusicVolumeSlide   = onMusicVolumeSlide;

})(typeof window !== 'undefined' ? window : globalThis);
