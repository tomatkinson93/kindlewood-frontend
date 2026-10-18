// ══════════════════════════════════════════════════════════════════════════
//  AUDIO — music tracks, sound effects, and menu music
//
//  Volumes:
//    - Music volume  (key 'kindlewood_music_vol')  — battle/tavern/menu loops
//    - SFX volume    (key 'kindlewood_sfx_vol')    — one-shot effects
//    - Ambient volume (key 'kindlewood_ambient_vol') — day/night beds (spec 021 §4.2)
//  All three are exposed to settings sliders and persisted to localStorage.
//
//  Ambient beds (/assets/audio/ambient/{dawn,day,dusk,night}.mp3) follow
//  KWClock's phase and crossfade over 8s on a change. They play only on the
//  game screen (world map / settlement view), only after a user gesture, and
//  duck to 20% while battle, tavern or menu music is playing. A missing file
//  is silent (one console warning per file).
//
//  Menu music (welcome.mp3) plays on the main menu / pre-game screen and is
//  ducked/stopped when other music (battle, tavern) takes over.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  const MUSIC_KEY = 'kindlewood_music_vol';
  const SFX_KEY   = 'kindlewood_sfx_vol';
  const DEFAULT_MUSIC = 0.5;
  const DEFAULT_SFX   = 0.6;
  const FADE_MS = 800;

  const TRACKS = {
    BATTLE: ['/assets/audio/battle-1.mp3'],
    MENU:   ['/assets/audio/welcome.mp3'],
  };

  const _cache = new Map();        // url → HTMLAudioElement (music)
  let _activeAudio = null;
  let _activeFadeTimer = null;
  let _userVolume = _loadVol(MUSIC_KEY, DEFAULT_MUSIC);
  let _sfxVolume  = _loadVol(SFX_KEY, DEFAULT_SFX);

  // ── Preload ──────────────────────────────────────────────────────────────
  function preloadAll() {
    for (const list of Object.values(TRACKS)) for (const url of list) _preload(url);
  }
  function _preload(url) {
    if (_cache.has(url)) return _cache.get(url);
    const a = new Audio();
    a.src = url; a.preload = 'auto'; a.loop = true; a.volume = 0;
    _cache.set(url, a);
    return a;
  }

  // ── Music playback ─────────────────────────────────────────────────────
  function playMusic(category) {
    const list = TRACKS[category];
    if (!list || !list.length) return null;
    const url = list[Math.floor(Math.random() * list.length)];
    const audio = _preload(url);
    if (_activeAudio && _activeAudio !== audio) {
      _fadeOut(_activeAudio, FADE_MS, (a => () => { try { a.pause(); } catch (e) {} })(_activeAudio));
    }
    _activeAudio = audio;
    audio.volume = 0;
    const pp = audio.play();
    if (pp && pp.catch) pp.catch(() => {});
    _fadeIn(audio, _userVolume, FADE_MS);
    return url;
  }
  function stopMusic() {
    if (!_activeAudio) return;
    const a = _activeAudio; _activeAudio = null;
    _fadeOut(a, FADE_MS, () => { try { a.pause(); a.currentTime = 0; } catch (e) {} });
  }

  // ── Menu music convenience ─────────────────────────────────────────────
  function playMenuMusic() { return playMusic('MENU'); }
  function stopMenuMusic() {
    // Only stop if the menu track is the active one
    const menuUrls = TRACKS.MENU;
    if (_activeAudio && menuUrls.includes(_activeAudio.src.replace(location.origin, ''))) stopMusic();
    else if (_activeAudio && menuUrls.some(u => _activeAudio.src.endsWith(u))) stopMusic();
  }

  // ── Sound effects ──────────────────────────────────────────────────────
  // One-shot SFX honoring the SFX volume. Each call is a fresh Audio so
  // overlapping effects don't cut each other off.
  function playSfx(file) {
    try {
      const url = file.startsWith('/') ? file : '/assets/audio/' + file;
      const a = new Audio(url);
      a.volume = _sfxVolume;
      a.play().catch(() => {});
    } catch (e) {}
  }

  // ── Volume getters/setters ─────────────────────────────────────────────
  function getVolume() { return _userVolume; }
  function setVolume(v) {
    _userVolume = _clamp(v);
    _saveVol(MUSIC_KEY, _userVolume);
    if (_activeAudio) _activeAudio.volume = _userVolume;
    // Notify any other music (tavern loops, etc.) to re-read the volume.
    try { window.dispatchEvent(new CustomEvent('kw-music-volume', { detail: _userVolume })); } catch (e) {}
  }
  function getSfxVolume() { return _sfxVolume; }
  function setSfxVolume(v) {
    _sfxVolume = _clamp(v);
    _saveVol(SFX_KEY, _sfxVolume);
  }

  function _clamp(v) { return Math.max(0, Math.min(1, parseFloat(v) || 0)); }
  function _loadVol(key, def) {
    try { const raw = localStorage.getItem(key); if (raw == null) return def; const n = parseFloat(raw); return isNaN(n) ? def : _clamp(n); }
    catch (e) { return def; }
  }
  function _saveVol(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) {} }

  // ── Fades ──────────────────────────────────────────────────────────────
  function _fadeIn(audio, target, durationMs) {
    if (_activeFadeTimer) { clearInterval(_activeFadeTimer); _activeFadeTimer = null; }
    const startVol = audio.volume, startTime = performance.now();
    _activeFadeTimer = setInterval(() => {
      const t = Math.min(1, (performance.now() - startTime) / durationMs);
      audio.volume = startVol + (target - startVol) * t;
      if (t >= 1) { clearInterval(_activeFadeTimer); _activeFadeTimer = null; }
    }, 16);
  }
  function _fadeOut(audio, durationMs, onDone) {
    const startVol = audio.volume, startTime = performance.now();
    const t = setInterval(() => {
      const p = Math.min(1, (performance.now() - startTime) / durationMs);
      audio.volume = startVol * (1 - p);
      if (p >= 1) { clearInterval(t); if (onDone) onDone(); }
    }, 16);
  }

  // ── Ambient beds (spec 021 §4.2) ─────────────────────────────────────────
  const AMBIENT_KEY = 'kindlewood_ambient_vol';
  const DEFAULT_AMBIENT = 0.35;
  const AMBIENT_BEDS = {
    dawn: '/assets/audio/ambient/dawn.mp3', day: '/assets/audio/ambient/day.mp3',
    dusk: '/assets/audio/ambient/dusk.mp3', night: '/assets/audio/ambient/night.mp3',
  };
  const AMB_XFADE_MS = 8000;
  const AMB_DUCK = 0.2;               // share of ambient volume under other music
  const AMB_DUCK_MS = 1000;           // duck / restore ease
  const AMB_TICK_MS = 200;
  let _ambientVolume = _loadVol(AMBIENT_KEY, DEFAULT_AMBIENT);
  const _amb = {
    layers: [],                       // { phase, audio, from, to, start, dead }, newest last
    duck: 1, lastTick: 0, gestured: false, crossfades: 0, timer: null, warned: {},
  };

  function _ambNow() { return performance.now(); }

  // A layer's fade gain (0..1) at time t: linear from → to over AMB_XFADE_MS.
  function _ambGain(L, t) {
    const k = Math.min(1, Math.max(0, (t - L.start) / AMB_XFADE_MS));
    return L.from + (L.to - L.from) * k;
  }

  function _ambOpen(phase) {
    const url = AMBIENT_BEDS[phase];
    const a = new Audio();
    const L = { phase, audio: a, from: 0, to: 1, start: _ambNow(), dead: false };
    a.addEventListener('error', () => {
      L.dead = true;
      if (!_amb.warned[url]) { _amb.warned[url] = true; console.warn('[ambient] missing or unplayable bed:', url); }
    });
    a.loop = true; a.preload = 'none'; a.volume = 0; a.src = url;   // fetched on first play()
    return L;
  }

  // Crossfade to `phase`'s bed. No-op if it's already the newest layer.
  function setAmbientPhase(phase) {
    if (!AMBIENT_BEDS[phase]) return false;
    const top = _amb.layers[_amb.layers.length - 1];
    if (top && top.phase === phase) return false;
    const t = _ambNow();
    for (const L of _amb.layers) { L.from = _ambGain(L, t); L.to = 0; L.start = t; }
    _amb.layers.push(_ambOpen(phase));
    if (top) _amb.crossfades++;
    _ambTick();
    return true;
  }

  // Battle (playMusic), tavern games (Briarwood / Squirrel's Stash) or the
  // menu track (#bg-music) audible right now?
  function _otherMusicPlaying() {
    const on = (a) => !!(a && !a.paused);
    if (on(_activeAudio)) return true;
    if (typeof document !== 'undefined' && on(document.getElementById('bg-music'))) return true;
    if (typeof _briarMusic !== 'undefined' && on(_briarMusic)) return true;   // tavern.js
    if (typeof _sqMusic !== 'undefined' && on(_sqMusic)) return true;         // tavern.js
    return false;
  }

  // Beds sound only on the game screen (world map / settlement view), in a
  // visible tab, after a user gesture (autoplay rules).
  function _ambAllowed() {
    if (!_amb.gestured || typeof document === 'undefined' || document.hidden) return false;
    const g = document.getElementById('screen-game');
    return !!(g && g.classList.contains('active'));
  }

  function _ambTick() {
    const t = _ambNow();
    const dt = _amb.lastTick ? t - _amb.lastTick : AMB_TICK_MS;
    _amb.lastTick = t;
    const target = _otherMusicPlaying() ? AMB_DUCK : 1;
    const step = dt / AMB_DUCK_MS * (1 - AMB_DUCK);
    _amb.duck = _amb.duck < target ? Math.min(target, _amb.duck + step) : Math.max(target, _amb.duck - step);
    const allowed = _ambAllowed();
    const keep = [];
    for (const L of _amb.layers) {
      const g = _ambGain(L, t);
      if (L.to === 0 && g <= 0) { try { L.audio.pause(); L.audio.src = ''; } catch (e) {} continue; }
      keep.push(L);
      if (L.dead) continue;
      try {
        L.audio.volume = Math.max(0, Math.min(1, _ambientVolume * _amb.duck * g));
        if (allowed && L.audio.paused) { const p = L.audio.play(); if (p && p.catch) p.catch(() => {}); }
        else if (!allowed && !L.audio.paused) L.audio.pause();
      } catch (e) {}
    }
    _amb.layers = keep;
  }

  function startAmbient() {
    if (_amb.timer) return;
    const C = global.KWClock;
    if (C) {
      setAmbientPhase(C.phase().phase);
      C.onChange(() => setAmbientPhase(C.phase().phase));
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      const g = () => { _amb.gestured = true; _ambTick(); };
      document.addEventListener('pointerdown', g, { once: true, capture: true });
      document.addEventListener('keydown', g, { once: true, capture: true });
    }
    _amb.timer = setInterval(_ambTick, AMB_TICK_MS);
  }

  function getAmbientVolume() { return _ambientVolume; }
  function setAmbientVolume(v) {
    _ambientVolume = _clamp(v);
    _saveVol(AMBIENT_KEY, _ambientVolume);
    _ambTick();
  }

  global.KWAmbient = {
    BEDS: AMBIENT_BEDS, XFADE_MS: AMB_XFADE_MS, DUCK: AMB_DUCK,
    start: startAmbient, setPhase: setAmbientPhase, tick: _ambTick,
    getVolume: getAmbientVolume, setVolume: setAmbientVolume,
    state: () => ({
      duck: _amb.duck, crossfades: _amb.crossfades, gestured: _amb.gestured,
      layers: _amb.layers.map(L => ({ phase: L.phase, gain: _ambGain(L, _ambNow()), volume: L.audio.volume, paused: L.audio.paused, dead: L.dead })),
    }),
    _gesture() { _amb.gestured = true; _ambTick(); },   // test hook
  };

  // ── Expose ─────────────────────────────────────────────────────────────
  global.preloadAllAudio = preloadAll;
  global.playMusic       = playMusic;
  global.stopMusic       = stopMusic;
  global.playMenuMusic   = playMenuMusic;
  global.stopMenuMusic   = stopMenuMusic;
  global.playSfx         = playSfx;
  global.getMusicVolume  = getVolume;
  global.setMusicVolume  = setVolume;
  global.getSfxVolume    = getSfxVolume;
  global.setSfxVolume    = setSfxVolume;

  // ── Settings popover ────────────────────────────────────────────────────
  function openSettingsPopover() {
    const back = document.getElementById('settings-backdrop');
    if (!back) return;
    back.classList.add('visible');
    const ms = document.getElementById('settings-music-volume');
    const mp = document.getElementById('settings-music-volume-pct');
    if (ms) ms.value = Math.round(_userVolume * 100);
    if (mp) mp.textContent = Math.round(_userVolume * 100) + '%';
    const ss = document.getElementById('settings-sfx-volume');
    const sp = document.getElementById('settings-sfx-volume-pct');
    if (ss) ss.value = Math.round(_sfxVolume * 100);
    if (sp) sp.textContent = Math.round(_sfxVolume * 100) + '%';
    const as = document.getElementById('settings-ambient-volume');
    const ap = document.getElementById('settings-ambient-volume-pct');
    if (as) as.value = Math.round(_ambientVolume * 100);
    if (ap) ap.textContent = Math.round(_ambientVolume * 100) + '%';
    if (global.KWSettingsPanel) global.KWSettingsPanel.onOpen();   // tabs + Graphics tab
  }
  function closeSettingsPopover() {
    const back = document.getElementById('settings-backdrop');
    if (back) back.classList.remove('visible');
  }
  function onMusicVolumeSlide(val) {
    const v = (parseFloat(val) || 0) / 100;
    setVolume(v);
    const pct = document.getElementById('settings-music-volume-pct');
    if (pct) pct.textContent = Math.round(v * 100) + '%';
    // keep the music-player bar slider in sync if present
    const bar = document.getElementById('music-volume');
    if (bar) bar.value = v;
  }
  function onSfxVolumeSlide(val) {
    const v = (parseFloat(val) || 0) / 100;
    setSfxVolume(v);
    const pct = document.getElementById('settings-sfx-volume-pct');
    if (pct) pct.textContent = Math.round(v * 100) + '%';
    // tiny preview tick so the user hears the level
    playSfx('card-flip.wav');
  }
  function onAmbientVolumeSlide(val) {
    const v = (parseFloat(val) || 0) / 100;
    setAmbientVolume(v);
    const pct = document.getElementById('settings-ambient-volume-pct');
    if (pct) pct.textContent = Math.round(v * 100) + '%';
  }
  // ── Compact in-game audio control (mute toggle + music slider) ──
  // Returns an HTML string; call wireGameAudioControl() after inserting it.
  let _muted = false;
  let _preMuteVol = _userVolume;
  function gameAudioControlHtml() {
    const pct = Math.round((_muted ? 0 : _userVolume) * 100);
    return `<span class="kw-audio-ctrl">
      <button class="kw-audio-mute" onclick="toggleMute()" title="Mute / unmute">${_muted || _userVolume === 0 ? '🔇' : '🔊'}</button>
      <input type="range" class="kw-audio-slider" min="0" max="100" step="1" value="${pct}"
             oninput="onGameVolumeSlide(this.value)" title="Music volume">
    </span>`;
  }
  function toggleMute() {
    if (_muted || _userVolume === 0) {
      _muted = false;
      setVolume(_preMuteVol > 0 ? _preMuteVol : 0.4);
    } else {
      _preMuteVol = _userVolume;
      _muted = true;
      setVolume(0);
    }
    _refreshAudioControls();
  }
  function onGameVolumeSlide(val) {
    const v = (parseFloat(val) || 0) / 100;
    _muted = (v === 0);
    if (v > 0) _preMuteVol = v;
    setVolume(v);
    _refreshAudioControls();
  }
  function _refreshAudioControls() {
    document.querySelectorAll('.kw-audio-ctrl').forEach(el => {
      const btn = el.querySelector('.kw-audio-mute');
      const sl = el.querySelector('.kw-audio-slider');
      const on = !(_muted || _userVolume === 0);
      if (btn) btn.textContent = on ? '🔊' : '🔇';
      if (sl) sl.value = Math.round((_muted ? 0 : _userVolume) * 100);
    });
  }
  global.gameAudioControlHtml = gameAudioControlHtml;
  global.toggleMute = toggleMute;
  global.onGameVolumeSlide = onGameVolumeSlide;

  global.openSettingsPopover  = openSettingsPopover;
  global.closeSettingsPopover = closeSettingsPopover;
  global.onMusicVolumeSlide   = onMusicVolumeSlide;
  global.onSfxVolumeSlide     = onSfxVolumeSlide;
  global.onAmbientVolumeSlide = onAmbientVolumeSlide;
  global.getAmbientVolume     = getAmbientVolume;
  global.setAmbientVolume     = setAmbientVolume;

  if (!global.__KW_NO_AUTOSTART) startAmbient();

  // ── Menu music ──────────────────────────────────────────────────────────
  // NOTE (spec 20 §B5 / audio bug fix): audio.js used to auto-start a SEPARATE
  // welcome.mp3 Audio on every document click. That duplicated the #bg-music
  // element that welcome-music-guard.js already owns — the two overlapped with
  // independent volumes, and the on-screen pill only controlled one of them.
  // Menu music is now driven solely by #bg-music + welcome-music-guard.js, so
  // that click auto-start has been removed. playMenuMusic / stopMenuMusic remain
  // exported for API compatibility (tavern.js calls stopMenuMusic); with nothing
  // starting the MENU track here, stopMenuMusic is simply a no-op.

})(typeof window !== 'undefined' ? window : globalThis);
