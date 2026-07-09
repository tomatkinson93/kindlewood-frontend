// ══════════════════════════════════════════════════════════════════════════
//  AUDIO — music tracks, sound effects, and menu music
//
//  Volumes:
//    - Music volume  (key 'kindlewood_music_vol')  — battle/tavern/menu loops
//    - SFX volume    (key 'kindlewood_sfx_vol')    — one-shot effects
//  Both are exposed to settings sliders and persisted to localStorage.
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

  // ── Menu music: start on the first user gesture while on a menu screen ──
  // (Browsers block autoplay until a gesture; a single click suffices.)
  function _maybeStartMenuMusic() {
    try {
      // Never start menu music if we're actually in the game (e.g. auto-logged
      // in via cookie). Only on the genuine pre-login screens.
      const inGame = document.getElementById('screen-game')?.classList.contains('active');
      if (inGame) return;
      const onMenu = document.getElementById('screen-welcome')?.classList.contains('active')
                  || document.getElementById('screen-login')?.classList.contains('active');
      if (onMenu && !_activeAudio) playMenuMusic();
    } catch (e) {}
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function _menuKick() {
      _maybeStartMenuMusic();
      // keep listening — menu music will no-op if something else is playing
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
