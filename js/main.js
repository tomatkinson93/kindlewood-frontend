const API = window.KINDLEWOOD_API || '';

let chosenSpecies = null;
let gameData = null;
let worldMapData = null;
let _selectedFogTile = null; // {wx, wy} — persists across re-renders

function getStoredToken() {
  return localStorage.getItem('kw_token') || '';
}

function setStoredToken(token) {
  if (token) localStorage.setItem('kw_token', token);
}

function clearStoredToken() {
  localStorage.removeItem('kw_token');
}

function apiFetch(path, options = {}) {
  const token = getStoredToken();

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return fetch(API + path, {
    credentials: 'include',
    ...options,
    headers,
  });
}


// ══════════════════════════════════════════════
//  LOADING SCREEN
// ══════════════════════════════════════════════
function showLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  el.style.display = 'flex';
  el.style.opacity = '1';
  setLoadingProgress(0, 'Entering the realm…');
}

function setLoadingProgress(pct, status) {
  const bar = document.getElementById('ls-bar');
  const txt = document.getElementById('ls-status');
  if (bar) bar.style.width = pct + '%';
  if (txt && status) txt.textContent = status;
}

function hideLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  el.style.transition = 'opacity 0.6s ease';
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; el.style.transition = ''; }, 650);
}

function showScreen(id) {
  console.log('showScreen called with:', id);

  // Page-turn UI sound on screen transitions (spec 20 §B5). Silent no-op until
  // the asset ships (audio.js swallows missing-file errors).
  if (typeof playSfx === 'function') playSfx('page_turn.mp3');

  // Cinematic transition for welcome → login
  if (id === 'login') {
    const welcome = document.getElementById('screen-welcome');
    if (welcome && welcome.classList.contains('active')) {
      transitionToLogin();
      return;
    }
  }

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  const target = document.getElementById('screen-' + id);
  if (!target) {
    console.error('showScreen: target screen not found:', 'screen-' + id);
    return;
  }

  target.classList.add('active');

  if (id === 'register') populateRegisterChip();

  if (id === 'login') { stopLoginArtCycle(); startLoginArtCycle(); }

  console.log(
    'now active:',
    [...document.querySelectorAll('.screen.active')].map(s => s.id)
  );

  if (id !== 'register') {
    chosenSpecies = null;
    document.querySelectorAll('.sp-option').forEach(o => o.classList.remove('picked'));
  }

  ['reg-error', 'reg-success', 'login-error', 'login-success'].forEach(msgId => {
    const el = document.getElementById(msgId);
    if (el) {
      el.style.display = 'none';
      el.textContent = '';
    }
  });
}

function showMsg(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
}

// Register species carry-through chip (spec 20 §B2 / §D7). Populated from the
// welcome-screen choice; hidden when none was made.
function populateRegisterChip() {
  const chip = document.getElementById('reg-species-chip');
  if (!chip) return;
  let sp = window.KW_PENDING_SPECIES || null;
  if (!sp) { try { sp = sessionStorage.getItem('kw_pending_species'); } catch (e) {} }
  const data = (sp && typeof SPECIES_DATA !== 'undefined') ? SPECIES_DATA[sp] : null;
  if (!sp || !data) { chip.style.display = 'none'; return; }
  const img = document.getElementById('reg-species-chip-img');
  const label = document.getElementById('reg-species-chip-label');
  if (img) { img.src = `/assets/${sp}.png`; img.alt = data.name; }
  if (label) label.innerHTML = `Leading the <strong>${data.name}</strong>`;
  chip.style.display = 'inline-flex';
}

// Show/hide password toggle (spec 20 §B1).
function togglePassword(btn) {
  const wrap = btn.closest('.pw-wrap');
  const input = wrap && wrap.querySelector('input');
  if (!input) return;
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  const eye = btn.querySelector('.pw-eye');
  const eyeOff = btn.querySelector('.pw-eye-off');
  if (eye) eye.style.display = reveal ? 'none' : '';
  if (eyeOff) eyeOff.style.display = reveal ? '' : 'none';
  btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
}

// Wood-tap UI sound on primary gold buttons (spec 20 §B5). Delegated so it
// covers the hero CTA and any future .kw-cta-gold buttons. Silent until asset.
document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (t && t.closest && t.closest('.kw-cta-gold') && typeof playSfx === 'function') {
    playSfx('wood_tap.mp3');
  }
});

function pickSpecies(el) {
  document.querySelectorAll('.sp-option').forEach(o => o.classList.remove('picked'));
  el.classList.add('picked');
  chosenSpecies = el.dataset.sp;
}

async function submitRegister() {
  const username = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-pass').value;

  document.getElementById('reg-error').style.display = 'none';
  document.getElementById('reg-success').style.display = 'none';

  if (!username || !email || !password) {
    showMsg('reg-error', 'Please fill in all fields.');
    return;
  }

  try {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg('reg-error', data.error || 'Registration failed.');
      return;
    }

    if (data.token) setStoredToken(data.token);

    showMsg('reg-success', `Welcome, ${username}! Your realm awaits...`);
    setTimeout(() => loadGame(true), 700);
  } catch (err) {
    console.error('submitRegister error:', err);
    showMsg('reg-error', 'Could not reach the server. Please try again.');
  }
}

async function submitLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;

  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-success').style.display = 'none';

  if (!email || !password) {
    showMsg('login-error', 'Please enter your email and password.');
    return;
  }

  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg('login-error', data.error || 'Login failed.');
      return;
    }

    if (data.token) setStoredToken(data.token);

    showMsg('login-success', `Welcome back, ${data.username}. Loading your realm...`);
    setTimeout(() => loadGame(true), 500);
  } catch (err) {
    console.error('submitLogin error:', err);
    showMsg('login-error', 'Could not reach the server. Please try again.');
  }
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.error('logout error:', e);
  }

  clearStoredToken();
  stopResourceTick();
  gameData = null;
  worldMapData = null;
  _loadGameLock = false;
  showScreen('welcome');
}

let _loadGameLock = false;

async function loadGame(force = false) {
  if (_loadGameLock && !force) {
    console.log('loadGame blocked by lock');
    return;
  }

  _loadGameLock = true;
  console.log('loadGame called at', Date.now());

  try {
    const res = await apiFetch('/api/game/settlement');
    console.log('settlement response:', res.status);

    if (!res.ok) {
      _loadGameLock = false;
      showScreen('login');
      return;
    }

    gameData = await res.json();
    console.log('gameData loaded, tile_q:', gameData?.settlement?.tile_q);

    const needsPlacement =
      (gameData?.settlement?.tile_q == null && gameData?.settlement?.tile_x == null) ||
      gameData?.settlement?.needsResettlement === true;

    if (needsPlacement) {
      console.log('loadGame -> showing ARRIVAL screen');
      showArrivalScreen(gameData.settlement.name);
      _loadGameLock = false;
      return;
    }

    console.log('loadGame -> showing GAME screen');
    showLoadingScreen();
    setLoadingProgress(15, 'Loading settlement data…');

    showScreen('game');
    renderTopbar();
    preloadTileImages();
    if (typeof generatePixelArtTiles === 'function') generatePixelArtTiles();

    setLoadingProgress(35, 'Building the world map…');
    renderMap();

    setLoadingProgress(55, 'Preparing your citizens…');
    if (typeof loadCitizens === 'function') loadCitizens();
    initGuardArt();
    if (typeof initProfileDisplay === 'function') initProfileDisplay(gameData.username, gameData.species);

    setLoadingProgress(70, 'Loading buildings…');
    loadBuildings();

    setLoadingProgress(82, 'Checking expeditions…');
    loadExpeditions();
    startExpeditionPoll();

    setLoadingProgress(92, 'Finishing up…');
    startResourceTick(gameData.settlement.resources, gameData.settlement.rates);
    initSeasons(gameData.settlement);
    if (typeof startEventsPoll === 'function') startEventsPoll();
    if (typeof startGlobalQuestTimer === 'function') startGlobalQuestTimer();
    if (typeof _refreshDiploEnvoys === 'function') { _refreshDiploEnvoys(); setInterval(_refreshDiploEnvoys, 30000); }
    if (typeof preloadAllAudio === 'function') {
      try { preloadAllAudio(); } catch(e) {}
    }
    // The battles badge has its own auto-start that fires 1.5s after
    // DOMContentLoaded — which is usually on the login screen, before the
    // user has authenticated. That first call gets a 401 and the badge
    // stays at 0. Trigger a fresh fetch now that we have a valid session.
    if (typeof refreshBattleBadge === 'function') {
      try { refreshBattleBadge(); } catch(e) {}
    }
    // Open the SSE stream so the server can push events (quest done,
    // combat triggered, etc) instead of us polling. Polling stays as a
    // safety net at a longer interval — see startGlobalQuestTimer and the
    // battles badge poller.
    if (typeof startRealtime === 'function') {
      try { startRealtime(); } catch(e) {}
    }
    _populateProfileTrigger();
    setTimeout(selectHomeTile2, 800);

    // Hide loading screen once the map has had time to render
    setTimeout(() => {
      setLoadingProgress(100, 'Welcome back!');
      setTimeout(hideLoadingScreen, 400);
    }, 600);

    _loadGameLock = false;
  } catch (err) {
    console.error('loadGame error:', err);
    _loadGameLock = false;
    // Only bounce to login if we never actually got the player's data.
    // A throw in a late, non-critical step (audio preload, a badge fetch,
    // profile widget) must NOT eject a player with a valid session.
    if (!gameData || !gameData.settlement) {
      showScreen('login');
    } else {
      console.warn('loadGame: late non-critical step failed; staying in game.');
      try { hideLoadingScreen(); } catch (e) {}
    }
  }
}

function switchTab(tab) {
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById('tab-' + tab);
  if (activeTab) activeTab.classList.add('active');

  if (tab === 'citizens') {
    showCitizensPanel();
  } else if (tab === 'buildings') {
    showMapPanel();
    const title = document.getElementById('panel-title');
    const sub = document.getElementById('panel-sub');
    if (title) title.textContent = 'Construct';
    if (sub) sub.textContent = 'Build and upgrade structures';
    loadBuildings();
  } else if (tab === 'tier') {
    showMapPanel();
    const title = document.getElementById('panel-title');
    const sub = document.getElementById('panel-sub');
    const tier = gameData?.settlement?.tier || 'camp';
    const nextMap = { camp:'village', village:'town', town:'city', city:null };
    const next = nextMap[tier];
    if (title) title.textContent = 'Settlement Tier';
    if (sub) sub.textContent = next ? `${tier} → ${next}` : 'Maximum tier reached';
    renderTierPanel();
  } else {
    showMapPanel();
    if (gameData?.settlement) {
      const title = document.getElementById('panel-title');
      const sub = document.getElementById('panel-sub');
      if (title) title.textContent = gameData.settlement.name;
      if (sub) sub.textContent = `${gameData.species} · ${gameData.settlement.tier}`;
      // Update panel body to show home settlement info without moving camera
      const home = worldMapData?.tiles?.find(t => t.settlement && t.settlement.isOwn);
      if (home) selectWorldTile(home);
    }
  }
}

/* ── Login background art cycler ── */
/* Prefer WebP, fall back to PNG via a one-time Image() probe (spec 20 §A5).
   Defaults to PNG so first paint is always safe; if the probe confirms WebP
   support + asset presence, the array is swapped before the cycler needs it. */
const LOGIN_ART_BASES = ['login_art1', 'login_art2', 'login_art3', 'login_art4'];
let LOGIN_ARTS = LOGIN_ART_BASES.map(b => `/assets/images/${b}.png`);
(function probeLoginArtWebp() {
  const probe = new Image();
  probe.onload = () => {
    if (probe.naturalWidth > 0) {
      LOGIN_ARTS = LOGIN_ART_BASES.map(b => `/assets/images/${b}.webp`);
    }
  };
  probe.onerror = () => { /* keep PNG paths */ };
  probe.src = `/assets/images/${LOGIN_ART_BASES[0]}.webp`;
})();
let _loginArtIndex = 0;
let _loginArtTimer = null;
let _loginArtActive = 'a'; // which layer is currently visible

function startLoginArtCycle() {
  const layerA = document.getElementById('login-bg-a');
  const layerB = document.getElementById('login-bg-b');
  if (!layerA || !layerB) return;

  // Show first image immediately
  layerA.style.backgroundImage = `url('${LOGIN_ARTS[0]}')`;
  layerA.classList.add('visible');
  _loginArtIndex = 0;
  _loginArtActive = 'a';

  // Cycle every 6 seconds
  _loginArtTimer = setInterval(() => {
    _loginArtIndex = (_loginArtIndex + 1) % LOGIN_ARTS.length;
    const nextArt = LOGIN_ARTS[_loginArtIndex];

    if (_loginArtActive === 'a') {
      layerB.style.backgroundImage = `url('${nextArt}')`;
      layerB.classList.add('visible');
      setTimeout(() => { layerA.classList.remove('visible'); }, 1600);
      _loginArtActive = 'b';
    } else {
      layerA.style.backgroundImage = `url('${nextArt}')`;
      layerA.classList.add('visible');
      setTimeout(() => { layerB.classList.remove('visible'); }, 1600);
      _loginArtActive = 'a';
    }
  }, 6000);
}

function stopLoginArtCycle() {
  if (_loginArtTimer) { clearInterval(_loginArtTimer); _loginArtTimer = null; }
}


/* ── Ambient music player ── */
(function initMusicPlayer() {
  const MENU_SCREENS = ['screen-welcome', 'screen-login'];

  function getAudio()  { return document.getElementById('bg-music'); }
  function getPlayer() { return document.getElementById('music-player'); }

  function updatePlayerVisibility(activeScreenId) {
    const player = getPlayer();
    if (!player) return;
    const show = MENU_SCREENS.includes('screen-' + activeScreenId);
    player.style.display = show ? 'flex' : 'none';
  }

  function tryAutoplay() {
    const audio = getAudio();
    if (!audio || audio._attempted) return;
    audio._attempted = true;
    audio.volume = parseFloat(document.getElementById('music-volume')?.value || 0.4);
    audio.play().then(() => {
      setMusicPlaying(true);
    }).catch(() => {
      // Autoplay blocked — wait for first user interaction
      const resume = () => {
        audio.play().then(() => setMusicPlaying(true)).catch(()=>{});
        document.removeEventListener('click', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('click', resume);
      document.addEventListener('keydown', resume);
    });
  }

  // Patch showScreen to update player visibility
  const _origShowScreen = window.showScreen;
  window.showScreen = function(id) {
    _origShowScreen(id);
    updatePlayerVisibility(id);
    if (MENU_SCREENS.includes('screen-' + id)) {
      tryAutoplay();
    } else {
      // Pause when entering game
      const audio = getAudio();
      if (audio && !audio.paused) audio.pause();
      setMusicPlaying(false);
    }
  };

  // First-gesture music start ramps 0 → volume over 2s (spec 20 §B5). The menu
  // track is #bg-music (owned by welcome-music-guard.js), so the fade lives here
  // rather than in audio.js. Fires once, on the first time the track plays;
  // re-reads the slider each frame so a live volume drag is respected.
  let _bgFadedIn = false;
  function _bgFadeIn(audio) {
    if (_bgFadedIn) return;
    _bgFadedIn = true;
    const dur = 2000, start = performance.now();
    audio.volume = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      const target = parseFloat(document.getElementById('music-volume')?.value || 0.4);
      audio.volume = target * t;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Init on page load
  document.addEventListener('DOMContentLoaded', () => {
    const audio = getAudio();
    if (audio) audio.addEventListener('play', () => _bgFadeIn(audio));
    const welcomeActive = document.getElementById('screen-welcome')?.classList.contains('active');
    if (welcomeActive) {
      updatePlayerVisibility('welcome');
      tryAutoplay();
    }
  });
})();

function setMusicPlaying(playing) {
  const player = document.getElementById('music-player');
  const iconPlay  = document.getElementById('music-icon-play');
  const iconPause = document.getElementById('music-icon-pause');
  const waves     = document.getElementById('mp-waves');
  if (!player) return;
  if (playing) {
    player.classList.add('playing');
    if (iconPlay)  iconPlay.style.display  = 'none';
    if (iconPause) iconPause.style.display = '';
    if (waves)     waves.classList.add('active');
  } else {
    player.classList.remove('playing');
    if (iconPlay)  iconPlay.style.display  = '';
    if (iconPause) iconPause.style.display = 'none';
    if (waves)     waves.classList.remove('active');
  }
}

function toggleMusic() {
  const audio = document.getElementById('bg-music');
  if (!audio) return;
  if (audio.paused) {
    audio.play().then(() => setMusicPlaying(true)).catch(()=>{});
  } else {
    audio.pause();
    setMusicPlaying(false);
  }
}

function setMusicVolume(val) {
  const audio = document.getElementById('bg-music');
  if (audio) audio.volume = parseFloat(val);
}


/* ── Welcome → Login cinematic transition ── */
function transitionToLogin() {
  const welcome = document.getElementById('screen-welcome');
  const login = document.getElementById('screen-login');
  if (!welcome || !login) return;

  document.body.classList.add('login-mode');

  welcome.classList.add('to-login');
  login.classList.add('active');

  requestAnimationFrame(() => {
    login.classList.add('login-visible');
  });

  startLoginArtCycle();
}

function loginTransitionBack() {
  const welcome = document.getElementById('screen-welcome');
  const login = document.getElementById('screen-login');
  if (!welcome || !login) return;

  stopLoginArtCycle();

  login.classList.remove('login-visible');
  welcome.classList.remove('to-login');
  document.body.classList.remove('login-mode');

  setTimeout(() => {
    login.classList.remove('active');
  }, 450);
}



function renderTopbar() {
  if (!gameData) return;
  updateTopbarDisplay();
}

// ── World map ──
const WORLD_BG = {
  plains: '#3D3820', forest: '#2a3d1a', hills: '#4a4035',
  river: '#1a3d35', ruins: '#3d3530', mountain: '#2a2a2a',
  marsh: '#2d3d20', fog: '#111',
};
const WORLD_EMOJI = {
  plains: '🌿', forest: '🌲', hills: '⛰', river: '🌊',
  ruins: '🏚', mountain: '🗻', marsh: '🌾',
};
const TERRAIN_LABELS = {
  plains: 'Open Plains', forest: 'Dense Forest', hills: 'Rocky Hills',
  river: 'Riverside', ruins: 'Ancient Ruins', mountain: 'Mountain Base', marsh: 'Misty Marshland',
};
const TERRAIN_BONUSES_DISPLAY = {
  plains: '+3 food/hr', forest: '+4 timber/hr', hills: '+3 stone, +2 metal/hr',
  river: '+4 wealth/hr', ruins: '+2 stone, +3 wealth/hr',
  mountain: '+4 stone, +4 metal/hr', marsh: '+2 food, +2 timber/hr',
};

// ── Camera system ──
// Tile sizes per zoom level — tile count is calculated to fill available space
const TILE_PX_VAL = 48;  // fixed tile size — no zoom
const GAP = 0;
// camera — MOVED to kwmap-core.js (shared global, same name & object).

function TILE_PX() { return TILE_PX_VAL; }

const MAP_FRAME_W = 1400;  // fallback — actual size read from DOM
const MAP_FRAME_H = 800;

function getMapDimensions() {
  const tpx = TILE_PX() + GAP;
  return {
    cols: Math.ceil(MAP_FRAME_W / tpx),
    rows: Math.ceil(MAP_FRAME_H / tpx)
  };
}

function VIEW_W() { return getMapDimensions().cols; }
function VIEW_H() { return getMapDimensions().rows; }
function applyGridTransform() {
  // Hex renderer handles its own sizing inside renderWorldMap — nothing to do here.
}
function setZoom(delta) { /* zoom removed */ }

function centreCamera() {
  KWMap.controller.centreOnPlayer();
}

function panCamera(dx, dy) {
  KWMap.controller.pan(dx, dy);
}

// Keyboard panning — MOVED to kwmap-core.js (controller.initInput).


// ── Drag to pan ──
// _drag — MOVED into controller.initInput's closure (kwmap-core.js).

// _canvasPixelToHex — MOVED to kwmap-topdown.js (TopDownRenderer.screenToHex);
// this delegate keeps every existing caller working and never branches on view.
function _canvasPixelToHex(mouseX, mouseY) {
  return KWMap.controller.screenToHex(mouseX, mouseY);
}

// _initMapDrag — MOVED to kwmap-core.js (controller.initInput): click,
// hover, drag-pan, keyboard-pan, gating, and persisted view restore.
function _initMapDrag() {
  KWMap.controller.initInput();
}

async function loadWorldMap() {
  try {
    const res = await apiFetch('/api/map/world');
    if (!res.ok) return;
    const data = await res.json();
    worldMapData = data;
    // Adopt server's authoritative map dimensions. The server resizes via
    // Dev Tools → World Map Tools, so these can change between loads.
    if (Number.isFinite(data.mapW)) HEX_MAP_W = data.mapW;
    if (Number.isFinite(data.mapH)) HEX_MAP_H = data.mapH;
    console.log(`[map] loaded ${data.tiles?.length || 0} tiles · world ${HEX_MAP_W}×${HEX_MAP_H} (server reported mapW=${data.mapW}, mapH=${data.mapH})`);
    if (data.playerSettlement) {
      camera.q = data.playerSettlement.q;
      camera.r = data.playerSettlement.r;
    }
    renderWorldMap(data);
    _initMapDrag();
    _startFogAnimation();
  } catch (e) { console.error(e); }
}


// ── Seeded per-tile RNG (deterministic, no re-randomize on redraw) ──────────
function _tileRng(q, r, index) {
  let h = (q * 374761393 + r * 1073741789 + index * 31337) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
  return ((h >>> 0) / 0xFFFFFFFF);
}

// ── Draw rich terrain detail into a clipped hex ──────────────────────────────
function _drawTerrainDetail(ctx, x, y, hexW, hexH, terrain, q, r) {
  const cx = x + hexW / 2, cy = y + hexH / 2;

  ctx.save();
  _hexPathLT(ctx, x, y, hexW, hexH);
  ctx.clip();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (terrain === 'forest') {
    // Base dark green ground
    ctx.fillStyle = 'rgba(18,32,12,0.55)';
    ctx.fill();
    // Draw 3-5 trees scattered within hex
    const count = 3 + Math.floor(_tileRng(q, r, 0) * 3);
    const variants = ['🌲','🌲','🌳','🌲','🌿'];
    for (let i = 0; i < count; i++) {
      const rx = _tileRng(q, r, i * 3 + 1);
      const ry = _tileRng(q, r, i * 3 + 2);
      const rs = _tileRng(q, r, i * 3 + 3);
      const vi = Math.floor(_tileRng(q, r, i + 20) * variants.length);
      const tx = x + hexW * 0.15 + rx * hexW * 0.7;
      const ty = y + hexH * 0.1 + ry * hexH * 0.75;
      const fs = Math.round(hexH * (0.28 + rs * 0.22));
      ctx.font = fs + 'px serif';
      ctx.globalAlpha = 0.82 + rs * 0.18;
      ctx.fillText(variants[vi], tx, ty);
    }
    ctx.globalAlpha = 1;

  } else if (terrain === 'plains') {
    // Warm earth tones
    ctx.fillStyle = 'rgba(45,38,14,0.4)';
    ctx.fill();
    const variants = ['🌾','🌿','🌱','🌾','🌻'];
    const count = 2 + Math.floor(_tileRng(q, r, 0) * 3);
    for (let i = 0; i < count; i++) {
      const rx = _tileRng(q, r, i * 3 + 1);
      const ry = _tileRng(q, r, i * 3 + 2);
      const rs = _tileRng(q, r, i * 3 + 3);
      const vi = Math.floor(_tileRng(q, r, i + 20) * variants.length);
      const tx = x + hexW * 0.1 + rx * hexW * 0.8;
      const ty = y + hexH * 0.15 + ry * hexH * 0.7;
      const fs = Math.round(hexH * (0.22 + rs * 0.15));
      ctx.font = fs + 'px serif';
      ctx.globalAlpha = 0.7 + rs * 0.3;
      ctx.fillText(variants[vi], tx, ty);
    }
    ctx.globalAlpha = 1;

  } else if (terrain === 'hills') {
    ctx.fillStyle = 'rgba(50,40,25,0.45)';
    ctx.fill();
    const variants = ['⛰','🪨','🪨','⛰'];
    const count = 1 + Math.floor(_tileRng(q, r, 0) * 2);
    for (let i = 0; i < count; i++) {
      const rx = _tileRng(q, r, i * 3 + 1);
      const ry = _tileRng(q, r, i * 3 + 2);
      const rs = _tileRng(q, r, i * 3 + 3);
      const vi = Math.floor(_tileRng(q, r, i + 20) * variants.length);
      const tx = x + hexW * 0.2 + rx * hexW * 0.6;
      const ty = y + hexH * 0.2 + ry * hexH * 0.55;
      const fs = Math.round(hexH * (0.32 + rs * 0.2));
      ctx.font = fs + 'px serif';
      ctx.globalAlpha = 0.75 + rs * 0.25;
      ctx.fillText(variants[vi], tx, ty);
    }
    ctx.globalAlpha = 1;

  } else if (terrain === 'mountain') {
    ctx.fillStyle = 'rgba(35,30,25,0.5)';
    ctx.fill();
    const variants = ['🏔','⛰','🏔'];
    const count = 1 + Math.floor(_tileRng(q, r, 0) * 2);
    for (let i = 0; i < count; i++) {
      const rx = _tileRng(q, r, i * 3 + 1);
      const ry = _tileRng(q, r, i * 3 + 2);
      const rs = _tileRng(q, r, i * 3 + 3);
      const vi = Math.floor(_tileRng(q, r, i + 20) * variants.length);
      const tx = x + hexW * 0.15 + rx * hexW * 0.7;
      const ty = y + hexH * 0.1 + ry * hexH * 0.65;
      const fs = Math.round(hexH * (0.36 + rs * 0.2));
      ctx.font = fs + 'px serif';
      ctx.globalAlpha = 0.8 + rs * 0.2;
      ctx.fillText(variants[vi], tx, ty);
    }
    ctx.globalAlpha = 1;

  } else if (terrain === 'river') {
    ctx.fillStyle = 'rgba(10,25,50,0.35)';
    ctx.fill();
    // Draw wavy water lines
    ctx.strokeStyle = 'rgba(80,160,220,0.4)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const oy = y + hexH * (0.25 + i * 0.22);
      const amp = hexH * 0.04;
      ctx.beginPath();
      ctx.moveTo(x + hexW * 0.1, oy);
      for (let xi = 0; xi <= 8; xi++) {
        const px = x + hexW * 0.1 + (hexW * 0.8 / 8) * xi;
        const py = oy + Math.sin(xi * 0.9 + _tileRng(q, r, i) * 6) * amp;
        xi === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // Water emoji
    const fs = Math.round(hexH * 0.28);
    ctx.font = fs + 'px serif';
    ctx.globalAlpha = 0.6;
    ctx.fillText('🌊', cx + (_tileRng(q,r,5)-0.5)*hexW*0.3, cy + (_tileRng(q,r,6)-0.5)*hexH*0.3);
    ctx.globalAlpha = 1;

  } else if (terrain === 'marsh') {
    ctx.fillStyle = 'rgba(20,30,15,0.45)';
    ctx.fill();
    const variants = ['🌿','🍃','🌱','🪷'];
    const count = 2 + Math.floor(_tileRng(q, r, 0) * 3);
    for (let i = 0; i < count; i++) {
      const rx = _tileRng(q, r, i * 3 + 1);
      const ry = _tileRng(q, r, i * 3 + 2);
      const rs = _tileRng(q, r, i * 3 + 3);
      const vi = Math.floor(_tileRng(q, r, i + 20) * variants.length);
      const tx = x + hexW * 0.1 + rx * hexW * 0.8;
      const ty = y + hexH * 0.1 + ry * hexH * 0.8;
      const fs = Math.round(hexH * (0.2 + rs * 0.18));
      ctx.font = fs + 'px serif';
      ctx.globalAlpha = 0.7 + rs * 0.3;
      ctx.fillText(variants[vi], tx, ty);
    }
    ctx.globalAlpha = 1;

  } else if (terrain === 'ruins') {
    ctx.fillStyle = 'rgba(30,25,20,0.5)';
    ctx.fill();
    const variants = ['🏚','🪨','🏛'];
    const vi = Math.floor(_tileRng(q, r, 1) * variants.length);
    const fs = Math.round(hexH * (0.35 + _tileRng(q,r,2) * 0.15));
    ctx.font = fs + 'px serif';
    ctx.globalAlpha = 0.75;
    ctx.fillText(variants[vi], cx + (_tileRng(q,r,3)-0.5)*hexW*0.2, cy + (_tileRng(q,r,4)-0.5)*hexH*0.2);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function renderMap() { loadWorldMap(); }

// Redraw map on window resize so tiles always fill the container
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (worldMapData) renderWorldMap(worldMapData);
  }, 120);
});

// ── Hex geometry helpers (pointy-top hexes) ──────────────────────────────────
function hexToPixel(q, r, size) {
  // Pointy-top hex: pixel position from axial coords
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const y = size * (3 / 2 * r);
  return { x, y };
}

function pixelToHex(px, py, size) {
  // Inverse of hexToPixel — returns fractional axial coords
  const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / size;
  const r = (2 / 3 * py) / size;
  return hexRoundAxial(q, r);
}

function hexRoundAxial(fq, fr) {
  const fs = -fq - fr;
  let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
  const dq = Math.abs(rq - fq), dr = Math.abs(rr - fr), ds = Math.abs(rs - fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// Map size — these defaults are overwritten by /api/map/world response in
// loadWorldMap(). Kept mutable so a world resize takes effect without reload
// (though current UX is to prompt for reload after regenerate).
let HEX_MAP_W = 40;
let HEX_MAP_H = 40;

// ══════════════════════════════════════════════
//  CANVAS MAP RENDERER
// ══════════════════════════════════════════════

// ── Terrain colours and emoji ──────────────────
const TERRAIN_COLORS = {
  plains: '#3D3820', forest: '#2a3d1a', hills: '#4a4035',
  river: '#1a3d35', ruins: '#3d3530', mountain: '#2a2a2a', marsh: '#2d3d20',
};
const TERRAIN_EMOJI_FONT = {
  plains: '🌿', forest: '🌲', hills: '⛰', river: '🌊',
  ruins: '🏚', mountain: '🗻', marsh: '🌾',
};

// ── Tileset images (preloaded at startup) ──────
const TILE_IMAGES = {};
const TILE_IMAGE_SRCS = {
  plains:   '/assets/images/tiles/plains.png',
  forest:   '/assets/images/tiles/forest.png',
  hills:    '/assets/images/tiles/hills.png',
  river:    '/assets/images/tiles/river.png',
  ruins:    '/assets/images/tiles/ruins.png',
  mountain: '/assets/images/tiles/mountain.png',
  marsh:    '/assets/images/tiles/marsh.png',
};
let _tileImagesLoaded = false;

function preloadTileImages() {
  const promises = Object.entries(TILE_IMAGE_SRCS).map(([terrain, src]) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { TILE_IMAGES[terrain] = img; resolve(); };
      img.onerror = () => resolve(); // fail gracefully — colour fallback used
      img.src = src;
    })
  );
  Promise.all(promises).then(() => { _tileImagesLoaded = true; });
}

// ── Fog texture ────────────────────────────────
const _fogImg = new Image();
_fogImg.onload = () => {
  console.log('Fog image loaded:', _fogImg.naturalWidth, 'x', _fogImg.naturalHeight);
  if (worldMapData) _doRenderCanvas();
};
_fogImg.onerror = () => console.error('Fog image FAILED to load:', _fogImg.src);
// Painted cloud fog (visual direction §10.5) — pixelart.js loads before
// main.js, so the generator is available here. Falls back to the PNG when
// the flag is off or the function is missing.
if (typeof generatePaintedCloudFog === 'function'
    && (typeof USE_PAINTED_FOG === 'undefined' || USE_PAINTED_FOG)) {
  _fogImg._painted = true;
  _fogImg.src = generatePaintedCloudFog().toDataURL();
} else {
  _fogImg.src = '/assets/fog/fog_base.png';
}
// _fogOffset/_fogAnimId + _startFogAnimation — MOVED to kwmap-core.js: the
// controller's render loop advances fog drift and is visibility-gated
// (hidden map no longer burns CPU — sanctioned Phase-1 change).
function _startFogAnimation() {
  KWMap.controller.startLoop();
}

// ── Canvas state ───────────────────────────────
// _canvas/_ctx — MOVED to kwmap-core.js.
let _hoveredTile  = null;  // {wq, wr} of hovered hex
let _selectedTile = null;  // {wq, wr} of clicked hex

// _getCanvas — MOVED to kwmap-core.js (controller owns the canvas).

// ── Hex path helper ────────────────────────────
// _hexPath / _hexPathLT — MOVED to kwmap-core.js (shared by the renderer
// and the uifx stroke pass). Same global names, defined there.
// ── Main render ────────────────────────────────
// renderWorldMap — Phase 1: the rAF coalescing (_renderPending) now lives in
// the controller's loop; this delegate just updates the data reference and
// asks for a frame.
function renderWorldMap(data) {
  worldMapData = data || worldMapData;
  KWMap.controller.requestRender();
}

// _doRenderCanvas — MOVED to kwmap-topdown.js (TopDownRenderer.render) +
// kwmap-core.js (HiDPI preamble in controller._prepFrame). Phase 1.
// Kept as a delegate: outposts handlers and others call it for an
// immediate redraw after state changes.
function _doRenderCanvas() {
  KWMap.controller.requestRender();
}



// ── Settlement tier card helpers ────────────────────────────────────────
function _tierImgLoad(img) { img.style.display = 'block'; if (img.nextElementSibling) img.nextElementSibling.style.display = 'none'; }
function _tierImgErr(img)  { img.style.display = 'none';  if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex'; }

// ── Settlement tier card with banner overlay ─────────────────────────────
function _settlementTierCard(tier, settlementName, isOwn) {
  const tierMeta = {
    camp:    { label: 'Camp',    num: 'Tier 0', bannerColor: '#2a3a1a', bannerBorder: '#4a6a2a', textColor: '#c8e090' },
    village: { label: 'Village', num: 'Tier 1', bannerColor: '#1a3a1a', bannerBorder: '#3a6a2a', textColor: '#8ecf7e' },
    town:    { label: 'Town',    num: 'Tier 2', bannerColor: '#1a2a3a', bannerBorder: '#2a4a7a', textColor: '#70a8e0' },
    city:    { label: 'City',    num: 'Tier 3', bannerColor: '#3a1a1a', bannerBorder: '#7a2a2a', textColor: '#e07070' },
  };
  const meta = tierMeta[tier] || tierMeta.village;
  const imgSrc = '/assets/images/tiers/tier_' + (tier || 'village') + '.png';

  return '<div class="tier-card-wrap">'
    + '<div class="tier-card-img-wrap">'
    + '<img class="tier-card-img" src="' + imgSrc + '" alt="' + meta.label + '" onload="_tierImgLoad(this)" onerror="_tierImgErr(this)">'
    + '<div class="tier-card-placeholder" style="display:none"><span style="font-size:32px">' + (TIER_EMOJI[tier] || '🏕') + '</span></div>'
    + '<div class="tier-card-banner">'
    + '<div class="tier-card-tier-num" style="color:' + meta.textColor + '">' + meta.num + '</div>'
    + '<div class="tier-card-tier-name" style="color:' + meta.textColor + '">' + meta.label + '</div>'
    + (settlementName ? '<div class="tier-card-sett-name">' + settlementName + '</div>' : '')
    + '</div>'
    + '</div>'
    + '</div>';
}

// ── Dev tile editor ─────────────────────────────────────────────────────
// Returns HTML for a small terrain-change dropdown that's appended to any
// tile info panel. Currently visible to any logged-in user for testing;
// the server-side endpoint should be admin-gated before launch.
// TODO: hide this UI when admin gating is added so non-admins don't see it.
const _DEV_TERRAIN_OPTIONS = [
  ['plains', '🌾 Plains'],
  ['forest', '🌳 Forest'],
  ['hills', '⛰ Hills'],
  ['mountain', '🏔 Mountain'],
  ['river', '💧 River'],
  ['marsh', '🪴 Marsh'],
  ['ruins', '🏛 Ruins'],
];
function _devTileEditorHtml(tile) {
  const opts = _DEV_TERRAIN_OPTIONS.map(([val, label]) => {
    const sel = val === tile.terrain ? ' selected' : '';
    return `<option value="${val}"${sel}>${label}</option>`;
  }).join('');
  return `
    <div class="dev-tile-editor">
      <div class="dev-tile-editor-label">⚗ Dev: change terrain</div>
      <div class="dev-tile-editor-row">
        <select id="dev-tile-terrain-select" data-q="${tile.q}" data-r="${tile.r}">${opts}</select>
        <button class="dev-tile-editor-btn" onclick="_applyDevTileTerrain()">Apply</button>
      </div>
    </div>
  `;
}
async function _applyDevTileTerrain() {
  const sel = document.getElementById('dev-tile-terrain-select');
  if (!sel) return;
  const q = parseInt(sel.dataset.q, 10);
  const r = parseInt(sel.dataset.r, 10);
  const terrain = sel.value;
  try {
    const res = await apiFetch('/api/map/tile-terrain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, r, terrain }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Failed: ' + (data.error || res.status));
      return;
    }
    // Patch the cached tile so we don't need a full refetch
    if (worldMapData && Array.isArray(worldMapData.tiles)) {
      const t = worldMapData.tiles.find(x => x.q === q && x.r === r);
      if (t) t.terrain = terrain;
      // Invalidate cached river flow ranks — terrain change may have added
      // or removed a river tile, which alters the network topology.
      delete worldMapData._riverFlow;
    }
    // Re-render so the new terrain (and any river-connection changes) shows
    if (typeof renderWorldMap === 'function' && worldMapData) {
      renderWorldMap(worldMapData);
    }
    // If this tile is still selected, refresh its panel too
    if (_selectedTile && _selectedTile.wq === q && _selectedTile.wr === r) {
      const tileMap = {};
      worldMapData.tiles.forEach(t => { tileMap[`${t.q},${t.r}`] = t; });
      const fresh = tileMap[`${q},${r}`];
      if (fresh) selectWorldTile(fresh);
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}


// ══════════════════════════════════════════════════════════════════════════
//  OUTPOSTS (010) — tile side-panel + handlers
//  Server truth lives at GET /api/game/outposts (yields, costs, cap, range —
//  cached in _outpostStatus so the panel never hardcodes numbers). Buttons
//  use data-* + addEventListener; no inline onclick.
// ══════════════════════════════════════════════════════════════════════════

// Display glyphs only (map stamps + panel flair). Numbers come from the server.
const OUTPOST_ICONS = {
  plains: '🌾', forest: '🪓', hills: '⛏️', mountain: '⚒️',
  river: '🎣', marsh: '🌿', ruins: '🏺',
};
const RES_GLYPHS = { food: '🍎', timber: '🪵', stone: '🪨', metal: '⚙️', wealth: '🪙' };

let _outpostStatus = null;      // last GET /api/game/outposts payload
let _outpostStatusLoading = false;

async function _refreshOutpostStatus(rerenderTile) {
  if (_outpostStatusLoading) return;
  _outpostStatusLoading = true;
  try {
    const res = await apiFetch('/api/game/outposts');
    if (res.ok) {
      _outpostStatus = await res.json();
      // Re-render the panel for the tile that triggered the load, if still selected
      if (rerenderTile && _selectedTile
          && _selectedTile.wq === rerenderTile.q && _selectedTile.wr === rerenderTile.r) {
        selectWorldTile(rerenderTile);
      }
    }
  } catch (e) { /* panel shows loading state; next select retries */ }
  finally { _outpostStatusLoading = false; }
}

// Wrap-aware axial distance on the client (mirrors mapgen.hexDistanceWrapped)
function _hexDistWrappedClient(q1, r1, q2, r2) {
  const dist = (a, b, c, d) => {
    const dq = a - c, dr = b - d;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  };
  let min = Infinity;
  for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
    const d = dist(q1, r1, q2 + dq * HEX_MAP_W, r2 + dr * HEX_MAP_H);
    if (d < min) min = d;
  }
  return min;
}

function _liveResources() {
  // Prefer the ticking copy (game.js), fall back to the last /settlement load.
  if (typeof tickResources !== 'undefined' && tickResources) return tickResources;
  return gameData?.settlement?.resources || {};
}

function _yieldChips(yields) {
  return Object.entries(yields || {})
    .map(([res, v]) => `<span class="op-chip op-chip-plus">${RES_GLYPHS[res] || ''} +${v}/hr</span>`)
    .join('');
}

function _costChips(cost, have) {
  return Object.entries(cost || {})
    .filter(([, v]) => v > 0)
    .map(([res, v]) => {
      const short = (have[res] ?? 0) < v;
      return `<span class="op-chip ${short ? 'op-chip-short' : ''}">${RES_GLYPHS[res] || ''} ${v}</span>`;
    }).join('');
}

function _outpostSectionHtml(tile) {
  // My outpost here — production block + dismantle
  if (tile.outpost?.mine) {
    const st = _outpostStatus;
    const cfg = st?.config?.[tile.outpost.terrain];
    const yields = cfg?.yields || {};
    return `
      <div class="op-section">
        <div class="op-title">${OUTPOST_ICONS[tile.outpost.terrain] || '⛺'} ${cfg?.name || 'Outpost'}</div>
        <div class="op-chips">${_yieldChips(yields)}<span class="op-chip op-chip-minus">🍎 −${st?.upkeep_food_per_hr ?? 1}/hr upkeep</span></div>
        <button class="action-btn op-dismantle" data-op-dismantle="${tile.outpost.id}" data-q="${tile.q}" data-r="${tile.r}">Dismantle outpost</button>
        <div class="op-reason" data-op-reason style="display:none"></div>
      </div>`;
  }

  // Someone else's outpost / claim — informational only
  if (tile.outpost) {
    return `<div class="op-section"><div class="op-note">⛺ ${tile.outpost.owner}'s outpost stands here.</div></div>`;
  }
  if (tile.claim_owner) {
    return `<div class="op-section"><div class="op-note">This tile is claimed by ${tile.claim_owner}.</div></div>`;
  }

  // Buildable? Needs status + a placed settlement.
  const home = gameData?.settlement;
  if (!home || home.tile_q == null) return '';

  const st = _outpostStatus;
  if (!st) {
    // Kick the fetch and show a quiet placeholder; the fetch re-renders.
    _refreshOutpostStatus(tile);
    return `<div class="op-section"><div class="op-note">Surveying the land…</div></div>`;
  }

  const cfg = st.config?.[tile.terrain];
  if (!cfg) return ''; // unknown terrain (shouldn't happen)

  const d = _hexDistWrappedClient(home.tile_q, home.tile_r, tile.q, tile.r);
  const have = _liveResources();
  const affordable = Object.entries(st.cost || {}).every(([res, v]) => (have[res] ?? 0) >= v);

  let disabled = '';
  let reason = '';
  if (d > st.range) {
    disabled = 'disabled';
    reason = `Too far from your settlement (needs ≤ ${st.range}, this is ${d}).`;
  } else if (st.used >= st.cap) {
    disabled = 'disabled';
    reason = `Your ${st.tier} can support ${st.cap} outpost${st.cap === 1 ? '' : 's'}. Grow your settlement tier to found more.`;
  } else if (!affordable) {
    disabled = 'disabled';
    reason = 'Not enough resources.';
  }

  return `
    <div class="op-section">
      <div class="op-title">${OUTPOST_ICONS[tile.terrain] || '⛺'} ${cfg.name}</div>
      <div class="op-chips">${_yieldChips(cfg.yields)}<span class="op-chip op-chip-minus">🍎 −${st.upkeep_food_per_hr}/hr upkeep</span></div>
      <div class="op-cost-label">Cost</div>
      <div class="op-chips">${_costChips(st.cost, have)}</div>
      <button class="action-btn op-build" data-op-build="1" data-q="${tile.q}" data-r="${tile.r}" ${disabled}>Found ${cfg.name}</button>
      <div class="op-cap-note">${st.used}/${st.cap} outposts · range ${st.range}</div>
      <div class="op-reason" data-op-reason ${reason ? '' : 'style="display:none"'}>${reason}</div>
    </div>`;
}

function _wireOutpostSection(body, tile) {
  const buildBtn = body.querySelector('[data-op-build]');
  if (buildBtn) {
    buildBtn.addEventListener('click', () => _foundOutpostHere(buildBtn, tile));
  }
  const disBtn = body.querySelector('[data-op-dismantle]');
  if (disBtn) {
    disBtn.addEventListener('click', () => _dismantleOutpost(disBtn, tile));
  }
}

// Apply a build/dismantle response to local state. Crucial spend-sync note:
// updateTopbarDisplay only syncs tickResources UPWARD from gameData (the
// one-time-award path), so a spend would never propagate — restart the tick
// from the server's fresh resources + rates instead, which also resets the
// floater baseline so no spurious "−120" flashes.
function _applyOutpostResponse(data) {
  if (data.resources && gameData?.settlement) {
    gameData.settlement.resources = { ...data.resources };
  }
  if (data.rates && gameData?.settlement) {
    gameData.settlement.rates = { ...data.rates };
  }
  if (data.resources && data.rates && typeof startResourceTick === 'function') {
    startResourceTick(data.resources, data.rates);
  }
  if (typeof invalidateResourceBreakdown === 'function') invalidateResourceBreakdown();
  if (typeof updateTopbarDisplay === 'function') updateTopbarDisplay();
}

function _opShowReason(btn, msg) {
  const box = btn.closest('.op-section')?.querySelector('[data-op-reason]');
  if (box) { box.textContent = msg; box.style.display = 'block'; }
}

async function _foundOutpostHere(btn, tile) {
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/game/outposts/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: tile.q, r: tile.r }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      btn.disabled = false;
      _opShowReason(btn, data.error || 'Failed to found outpost.');
      return;
    }

    _applyOutpostResponse(data);
    if (_outpostStatus) { _outpostStatus.used = data.used; }

    // Patch the cached world tile so the map + panel update without a refetch
    if (worldMapData?.tiles) {
      const t = worldMapData.tiles.find(x => x.q === tile.q && x.r === tile.r);
      if (t) {
        t.outpost = { id: data.outpost.id, terrain: data.outpost.terrain, level: data.outpost.level, mine: true, owner: gameData?.settlement?.name || '' };
        t.claimed_by_me = true;
        t.claim_owner = null;
        tile.outpost = t.outpost;
        tile.claimed_by_me = true;
      }
    }
    if (typeof _doRenderCanvas === 'function') _doRenderCanvas();
    selectWorldTile(tile); // re-render panel into the "your outpost" state
  } catch (e) {
    btn.disabled = false;
    _opShowReason(btn, 'Connection hiccup — try again.');
  }
}

async function _dismantleOutpost(btn, tile) {
  if (!confirm('Dismantle this outpost? Its materials are not recovered.')) return;
  btn.disabled = true;
  try {
    const id = btn.dataset.opDismantle;
    const res = await apiFetch(`/api/game/outposts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      btn.disabled = false;
      _opShowReason(btn, data.error || 'Failed to dismantle.');
      return;
    }
    _applyOutpostResponse(data);
    if (_outpostStatus) { _outpostStatus.used = data.used; }
    if (worldMapData?.tiles) {
      const t = worldMapData.tiles.find(x => x.q === tile.q && x.r === tile.r);
      if (t) { t.outpost = null; t.claimed_by_me = false; tile.outpost = null; tile.claimed_by_me = false; }
    }
    if (typeof _doRenderCanvas === 'function') _doRenderCanvas();
    selectWorldTile(tile);
  } catch (e) {
    btn.disabled = false;
    _opShowReason(btn, 'Connection hiccup — try again.');
  }
}

function selectWorldTile(tile) {
  _selectWorldTileImpl(tile);
  // Append dev terrain editor to whatever the impl just rendered. Lives
  // outside the branched logic so it's visible on every tile (player,
  // NPC, unoccupied) without having to inject it in three places.
  const body = document.getElementById('panel-body');
  if (body && tile && Number.isFinite(tile.q) && Number.isFinite(tile.r)) {
    body.insertAdjacentHTML('beforeend', _devTileEditorHtml(tile));
  }
}

function _selectWorldTileImpl(tile) {
  window._lastSelectedTile = tile;
  const title = document.getElementById('panel-title');
  const sub   = document.getElementById('panel-sub');
  const body  = document.getElementById('panel-body');
  if (!title || !sub || !body || !tile) return;

  if (!tile.settlement) {
    // ── No settlement — terrain info ──────────────────────────────────────
    // For river tiles, use neighbor count to distinguish River / Lake / Great Lake.
    let label = TERRAIN_LABELS[tile.terrain] || tile.terrain;
    if (tile.terrain === 'river' && worldMapData?.tiles) {
      const HEX_NB = [[+1,0],[-1,0],[0,+1],[0,-1],[+1,-1],[-1,+1]];
      const W = HEX_MAP_W, H = HEX_MAP_H;
      const tm = {};
      worldMapData.tiles.forEach(t => { tm[`${t.q},${t.r}`] = t; });
      const countN = (q,r) => {
        let n = 0;
        for (const [dq,dr] of HEX_NB) {
          const nq = ((q+dq)%W+W)%W, nr = ((r+dr)%H+H)%H;
          if (tm[`${nq},${nr}`]?.terrain === 'river') n++;
        }
        return n;
      };
      const myN = countN(tile.q, tile.r);
      // Same lake-detection logic as the renderer
      let isLake = myN >= 4;
      if (!isLake && myN >= 3) {
        for (const [dq,dr] of HEX_NB) {
          const nq = ((tile.q+dq)%W+W)%W, nr = ((tile.r+dr)%H+H)%H;
          if (tm[`${nq},${nr}`]?.terrain === 'river' && countN(nq, nr) >= 4) { isLake = true; break; }
        }
      }
      // Count the lake size by flood-filling lake-tagged neighbours
      if (isLake) {
        const seen = new Set();
        const stack = [[tile.q, tile.r]];
        let size = 0;
        while (stack.length && size < 32) {
          const [q, r] = stack.pop();
          const k = `${q},${r}`;
          if (seen.has(k)) continue;
          if (tm[k]?.terrain !== 'river') continue;
          // Lake-ish if ≥3 river neighbours (loose check, fast enough)
          if (countN(q, r) < 3) continue;
          seen.add(k);
          size++;
          for (const [dq,dr] of HEX_NB) {
            stack.push([((q+dq)%W+W)%W, ((r+dr)%H+H)%H]);
          }
        }
        label = size >= 6 ? 'Great Lake' : 'Lake';
      } else if (myN === 0) {
        label = 'Pond';
      }
    }
    title.textContent = label;
    sub.textContent = `(${tile.q}, ${tile.r}) · ${
      tile.outpost?.mine ? 'Your outpost'
      : tile.outpost ? `${tile.outpost.owner}'s outpost`
      : tile.claimed_by_me ? 'Your claim'
      : tile.claim_owner ? `Claimed by ${tile.claim_owner}`
      : 'Unoccupied'}`;
    body.innerHTML = `
      <div class="info-row"><span class="info-label">Terrain bonus</span><span class="info-val" style="font-size:11px;">${TERRAIN_BONUSES_DISPLAY[tile.terrain] || 'None'}</span></div>
      <hr class="sdivider">
      ${_outpostSectionHtml(tile)}
    `;
    _wireOutpostSection(body, tile);
    return;
  }

  const s = tile.settlement;

  // ── NPC / Kingdom / Hostile settlements ──────────────────────────────────
  const sType2 = s.settlement_type || (s.is_kingdom ? 'kingdom' : s.disposition === 'hostile' ? 'hostile' : (s.npc_id ? 'npc' : 'player'));
  if (sType2 === 'kingdom' || sType2 === 'npc' || sType2 === 'hostile') {
    title.textContent = '';
    sub.innerHTML = '';
    if (document.getElementById('panel-title')) document.getElementById('panel-title').textContent = s.is_kingdom_annex ? 'Ironhaven' : s.name;
    // Inject npc ID for diplomacy lookups — stored on tile data
    s._npcId = s.npc_id || s._npcId;
    if (typeof renderDiplomacyPanel === 'function') {
      renderDiplomacyPanel(s, tile);
    } else {
      const typeLabel = s.settlement_type === 'kingdom' ? '👑 Great Kingdom'
        : s.settlement_type === 'hostile' ? '💀 Hostile'
        : '🤝 NPC Village';
      sub.innerHTML = '<span style="font-size:11px">' + typeLabel + '</span>';
      body.innerHTML = '<div style="font-size:11px;color:rgba(192,221,151,.4)">' + (s.description || '') + '</div>';
    }
    return;
  }

  // ── Player settlement ─────────────────────────────────────────────────────
  title.textContent = s.name;
  sub.textContent   = s.username ? `@${s.username} · ${s.tier || 'village'}` : s.tier || 'village';

  if (s.isOwn) {
    const citizens = typeof citizensData !== 'undefined' ? citizensData : [];
    const adults   = citizens.filter(c => c.life_stage !== 'child' && c.life_stage !== 'elder');
    const children = citizens.filter(c => c.life_stage === 'child');
    const elders   = citizens.filter(c => c.life_stage === 'elder');
    // Count diplomatic envoys from _diploRelations cache (populated by diplomacy.js)
    const diploEnvoys = (typeof _diploEnvoyIds !== 'undefined' ? _diploEnvoyIds : new Set());
    const onMission = adults.filter(c => c.expedition || c.active_quest || diploEnvoys.has(c.id)).length;
    const idle      = adults.filter(c => !c.expedition && !c.active_quest && !diploEnvoys.has(c.id) && (!c.role || c.role === 'idle')).length;

    // Attention pills — citizen states that may need the player's eye.
    // Render only when count > 0: absence is good news, zeros are noise.
    // unhoused/sick light up automatically once the server includes
    // housed / conditions on citizens.
    const unhoused = citizens.filter(c => c.housed === false).length;
    const sick     = citizens.filter(c => (c.conditions && c.conditions.length) || c.injured).length;
    const _pill = (label, n, cls) => n > 0
      ? '<button class="sett-pill ' + (cls||'') + '" onclick="switchTab(\'citizens\')" title="View citizens">' + label + ' <b>' + n + '</b></button>'
      : '';
    const pillsHtml = _pill('Idle', idle, idle > 3 ? 'sett-pill--warn' : '')
      + _pill('Adventuring', onMission, '')
      + _pill('Unhoused', unhoused, 'sett-pill--alert')
      + _pill('Sick', sick, 'sett-pill--alert');
    const pillsRow = pillsHtml ? '<div class="sett-pills">' + pillsHtml + '</div>' : '';

    // Happiness
    const avgHappiness = adults.length
      ? Math.round(adults.reduce((sum, c) => sum + (c.life?.happiness ?? c.happiness ?? 70), 0) / adults.length)
      : 50;
    const happyColor = avgHappiness >= 70 ? '#8ecf7e' : avgHappiness >= 40 ? '#e8c76a' : '#e07a6a';
    const happyLabel = avgHappiness >= 70 ? 'Content' : avgHappiness >= 40 ? 'Unsettled' : 'Struggling';

    // Food supply trend from gameData rates
    const gd = typeof gameData !== 'undefined' ? gameData : {};
    const foodRate = gd.food_rate ?? 0;
    const foodColor = foodRate >= 0 ? '#8ecf7e' : '#e07a6a';
    const foodLabel = foodRate > 5 ? 'Plentiful' : foodRate >= 0 ? 'Stable' : foodRate > -5 ? 'Dwindling' : 'Critical';

    // Tags: settlement modifiers
    const tagHtml = '<div class="sett-tags">'
      + '<span class="sett-tag">' + (s.tier||'village').charAt(0).toUpperCase()+(s.tier||'village').slice(1) + '</span>'
      + '<span class="sett-tag">' + (s.species||'Mice').charAt(0).toUpperCase()+(s.species||'Mice').slice(1) + '</span>'
      + '</div>';

    body.innerHTML = _settlementTierCard(s.tier, s.name, true)
      + '<div class="sett-panel">'

      // Name + tags
      + tagHtml

      // Status section
      + '<div class="sett-divider"></div>'
      + '<div class="sett-section-label">Settlement Status</div>'
      + '<div class="sett-status-list">'
      + '<div class="sett-status-row sett-status-clickable" onclick="switchTab(\'citizens\');setTimeout(()=>sortCitizensByHappiness(),200)" title="Click to view citizens by happiness">' + '<span class="sett-status-icon">😊</span><span class="sett-status-label">Happiness <span style=\"font-size:9px;opacity:.4\">▶</span></span>' + '<span class="sett-status-val" style="color:' + happyColor + '">' + avgHappiness + '% · ' + happyLabel + '</span></div>'
      + '<div class="sett-status-row"><span class="sett-status-icon">🍖</span><span class="sett-status-label">Food Supply</span><span class="sett-status-val" style="color:' + foodColor + '">' + foodLabel + '</span></div>'
      + '</div>'

      // Population section
      + '<div class="sett-divider"></div>'
      + '<div class="sett-section-label">Population</div>'
      + '<div class="sett-stat-row">'
      + '<div class="sett-stat"><div class="sett-stat-val">' + children.length + '</div><div class="sett-stat-key">Children</div></div>'
      + '<div class="sett-stat"><div class="sett-stat-val">' + adults.length + '</div><div class="sett-stat-key">Adults</div></div>'
      + '<div class="sett-stat"><div class="sett-stat-val">' + elders.length + '</div><div class="sett-stat-key">Elderly</div></div>'
      + '</div>'
      + pillsRow

      // Actions — with hierarchy
      + '<div class="sett-divider"></div>'
      + '<div class="sett-actions-grid">'
      + '<button class="sett-action" onclick="openSettlementView()">🏗 Manage Settlement</button>'
      + '<button class="sett-action" onclick="openAllCitizens()">👥 Manage Citizens</button>'
      + '<button class="sett-action" onclick="openTierUpgradeModal()">' + (TIER_EMOJI[s.tier]||'🏕') + ' Upgrade</button>'
      + '<button class="sett-action" onclick="visitTavern()">🍺 Tavern</button>'
      + '<button class="sett-action" onclick="visitFishingPost()">🎣 Fishing</button>'
      + '</div>'
      + '</div>';

    title.textContent = '';
    sub.innerHTML = '';

  } else {
    // ── Other player's settlement ──
    body.innerHTML = _settlementTierCard(s.tier, s.name, false)
      + '<div class="sett-panel">'
      + '<div class="sett-stat-row" style="margin-top:4px">'
      + '<div class="sett-stat"><div class="sett-stat-val" style="font-size:13px">' + (s.username||'—') + '</div><div class="sett-stat-key">Ruler</div></div>'
      + '<div class="sett-stat"><div class="sett-stat-val" style="font-size:13px">' + (s.tier||'village') + '</div><div class="sett-stat-key">Tier</div></div>'
      + '</div>'
      + '<div class="sett-actions" style="margin-top:10px">'
      + '<button class="sett-action-btn vp-trigger" data-username="' + (s.username||'') + '" data-species="' + (s.species||'') + '" data-name="' + (s.name||'') + '" data-tier="' + (s.tier||'village') + '" data-q="' + tile.q + '" data-r="' + tile.r + '" onclick="openProfileForUser(this.dataset.username,this.dataset.species,this.dataset.name,this.dataset.tier,this.dataset.q,this.dataset.r)">👤 View Profile</button>'
      + '</div>'
      + '</div>';
    title.textContent = '';
    sub.innerHTML = '';
  }
}

function selectHomeTile2() {
  centreCamera();
  if (!worldMapData) return;
  const home = worldMapData.tiles.find(t => t.settlement && t.settlement.isOwn);
  if (home) selectWorldTile(home);
}

// ── Species modal data ──
const SPECIES_DATA = {
  mouse: {
    name: 'Mice', role: 'Economy & Growth',
    flavor: '"Prosper through trade and unity"',
    art: '/assets/mouse.png',
    stats: [['Food production','★★★★☆'],['Trade income','★★★★★'],['Combat strength','★★☆☆☆'],['Build speed','★★★☆☆'],['Population growth','★★★★★'],['Stealth','★★☆☆☆']],
    lore: 'Mice are the most numerous folk of the woodland realm. Gifted traders and tireless farmers, their settlements grow swiftly and their markets bustle with life. What they lack in brawn they make up for in numbers, cunning, and an unshakeable sense of community.'
  },
  badger: {
    name: 'Badgers', role: 'Defense & Infantry',
    flavor: '"Unyielding guardians of the realm"',
    art: '/assets/badger.png',
    stats: [['Food production','★★★☆☆'],['Trade income','★★☆☆☆'],['Combat strength','★★★★★'],['Build speed','★★★★☆'],['Population growth','★★★☆☆'],['Stealth','★☆☆☆☆']],
    lore: 'Badgers are the ancient wardens of the deep forest. Slow to rouse but fearsome in battle, their warriors are among the hardest to fell in all the land. No creature invades a Badger stronghold twice.'
  },
  fox: {
    name: 'Foxes', role: 'Stealth & Raids',
    flavor: '"Cunning and swift in the shadows"',
    art: '/assets/fox.png',
    stats: [['Food production','★★★☆☆'],['Trade income','★★★★☆'],['Combat strength','★★★☆☆'],['Build speed','★★☆☆☆'],['Population growth','★★★☆☆'],['Stealth','★★★★★']],
    lore: 'Foxes are the shadow-walkers of Kindlewood. Their scouts move unseen through enemy territory, their raiders strike without warning, and their spies turn the tide of wars before a single blade is drawn.'
  },
  otter: {
    name: 'Otters', role: 'Trade & Rivers',
    flavor: '"Masters of water and commerce"',
    art: '/assets/otter.png',
    stats: [['Food production','★★★★☆'],['Trade income','★★★★★'],['Combat strength','★★★☆☆'],['Build speed','★★★☆☆'],['Population growth','★★★☆☆'],['Stealth','★★★☆☆']],
    lore: 'Otters hold dominion over the rivers and waterways of the realm. Their trade fleets carry goods faster than any land route, and their river forts are nearly impossible to siege.'
  },
  hare: {
    name: 'Hares', role: 'Speed & Response',
    flavor: '"Fast to act, faster to strike"',
    art: '/assets/hare.png',
    stats: [['Food production','★★★★☆'],['Trade income','★★★☆☆'],['Combat strength','★★★★☆'],['Build speed','★★★★☆'],['Population growth','★★★★☆'],['Stealth','★★★☆☆']],
    lore: 'Hares are the swiftest of the woodland peoples — in thought, in deed, and in battle. Their armies can mobilise faster than any other species, making them fearsome defenders and devastating raiders.'
  },
  mole: {
    name: 'Moles', role: 'Infrastructure',
    flavor: '"Builders beneath the earth"',
    art: '/assets/mole.png',
    stats: [['Food production','★★★☆☆'],['Trade income','★★★☆☆'],['Combat strength','★★★☆☆'],['Build speed','★★★★★'],['Population growth','★★★☆☆'],['Stealth','★★★★☆']],
    lore: 'Moles are the master engineers of Kindlewood. Their tunnels run beneath entire kingdoms, their mines yield the richest ore, and their buildings rise in half the time of any other species.'
  },
};

function openModal(species) {
  const d = SPECIES_DATA[species];
  if (!d) return;
  window._kwModalSpecies = species;   // remembered for the modal CTA (spec 20 §A7)
  document.getElementById('modal-art').src = d.art;
  document.getElementById('modal-name').textContent = d.name;
  document.getElementById('modal-role').textContent = d.role;
  document.getElementById('modal-flavor').textContent = d.flavor;
  document.getElementById('modal-stats').innerHTML = d.stats
    .map(([k, v]) => `<div class="modal-stat"><strong>${k}</strong><br>${v}</div>`).join('');
  document.getElementById('modal-lore').textContent = d.lore;
  document.getElementById('modal-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.body.style.overflow = '';
}

// "Begin As This Species" in the species modal — carry the choice through
// to registration / Arrival (spec 20 §A7 / §D7).
function beginAsThisSpecies() {
  const sp = window._kwModalSpecies;
  if (sp) {
    window.KW_PENDING_SPECIES = sp;
    try { sessionStorage.setItem('kw_pending_species', sp); } catch (e) {}
  }
  closeModal();
  showScreen('register');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });


// ── Map flanking guard art ──
// Add more filenames to each array as you upload more assets
const GUARD_LEFT  = ['foxleft.png'];   // face right → placed on LEFT side
const GUARD_RIGHT = ['mouseright.png']; // face left → placed on RIGHT side

let _guardRotateTimer = null;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function initGuardArt() {
  setGuardArt();
  // Rotate to a new random pair every 3 minutes for variety
  if (_guardRotateTimer) clearInterval(_guardRotateTimer);
  _guardRotateTimer = setInterval(cycleGuardArt, 3 * 60 * 1000);
}

function showGuard(el, src) {
  el.style.transition = 'none';
  el.style.opacity = '0';
  el.onerror = () => console.warn('Guard art not found:', src);
  el.onload = () => {
    el.style.transition = 'opacity 1.4s ease';
    el.style.opacity = '0.7';
  };
  el.src = src;
  // Fallback for cached images where onload may not fire
  if (el.complete && el.naturalWidth) {
    el.style.transition = 'opacity 1.4s ease';
    el.style.opacity = '0.7';
  }
}

function setGuardArt(leftFile, rightFile) {
  const leftEl  = document.getElementById('map-decor-left');
  const rightEl = document.getElementById('map-decor-right');
  if (!leftEl || !rightEl) return;

  const lf = leftFile  || pickRandom(GUARD_LEFT);
  const rf = rightFile || pickRandom(GUARD_RIGHT);
  const base = '/assets/';  // assets are on the frontend domain, not the API

  showGuard(leftEl,  base + lf);
  showGuard(rightEl, base + rf);
}

function cycleGuardArt() {
  const leftEl  = document.getElementById('map-decor-left');
  const rightEl = document.getElementById('map-decor-right');
  const base = '/assets/';  // assets are on the frontend domain, not the API

  let newLeft  = pickRandom(GUARD_LEFT);
  let newRight = pickRandom(GUARD_RIGHT);

  if (GUARD_LEFT.length > 1) {
    const cur = leftEl?.src.split('/assets/').pop();
    while (newLeft === cur) newLeft = pickRandom(GUARD_LEFT);
  }
  if (GUARD_RIGHT.length > 1) {
    const cur = rightEl?.src.split('/assets/').pop();
    while (newRight === cur) newRight = pickRandom(GUARD_RIGHT);
  }

  // Fade out then swap
  if (leftEl)  { leftEl.style.opacity  = '0'; }
  if (rightEl) { rightEl.style.opacity = '0'; }
  setTimeout(() => setGuardArt(newLeft, newRight), 1000);
}

setInterval(() => {
  fetch(API + '/health', { credentials: 'include' }).catch(() => {});
}, 14 * 60 * 1000);

window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('kw_token');
  if (!token) return;
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok) {
      try {
        const me = await res.json();
        window._authUser = { userId: me.userId, username: me.username, species: me.species };
      } catch (e) {}
      await loadGame();
    } else if (res.status === 401) {
      localStorage.removeItem('kw_token');
    }
  } catch (e) {
    // Network error — keep the token, don't log the user out on a blip.
    console.error('DOMContentLoaded auth check failed:', e);
  }
});

// ── Action bar ──
function actionScout() {
  // Highlight fog tiles as targets
  const btn = document.getElementById('action-scout');
  const isActive = btn?.classList.contains('active');
  document.querySelectorAll('.action-bar-btn').forEach(b => b.classList.remove('active'));
  if (!isActive) {
    btn?.classList.add('active');
    showBuildToast('Click any fog tile 🌫 to send a scout', 'success');
  }
}

// ── Community panel ──
const COMM_TITLES = {
  news: '📜 Realm News',
  board: '📌 Notice Board',
  chat: '💬 Chatroom',
  realms: '🌍 All Realms',
};


// ══════════════════════════════════════════════
//  NAV — MAP LINK
// ══════════════════════════════════════════════
function navGoMap() {
  // Close any open overlays
  closeCommunity();
  closeQuestsModal();
  const tavern = document.getElementById('tavern-overlay');
  const fishing = document.getElementById('fishing-overlay');
  if (tavern) tavern.style.display = 'none';
  if (fishing) fishing.style.display = 'none';
  // Return to map tab
  switchTab('map');
}

// ══════════════════════════════════════════════
//  QUESTS MODAL — active quest tracker
// ══════════════════════════════════════════════
function openQuestsModal() {
  const modal = document.getElementById('quests-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  _renderQuestsModal();
}

function closeQuestsModal() {
  const modal = document.getElementById('quests-modal');
  if (modal) modal.style.display = 'none';
}


async function _qmCollect(btn) {
  const runId = btn?.dataset?.id;
  if (!runId) return;
  btn.textContent = '…';
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/quests/collect/' + runId, { method: 'POST' });
    if (!res.ok) {
      // Surface the actual error. Previously a 400 here would just trigger
      // a silent re-render against stale _questData, leaving the Collect
      // button visible — so the player would click again and get the same
      // 400, repeatedly, with no feedback.
      let detail = res.status + '';
      try { const j = await res.json(); if (j?.error) detail = j.error; } catch(e) {}
      console.error('[_qmCollect] collect failed for run', runId, '→', detail);
      if (typeof showToastNotification === 'function') {
        showToastNotification('⚠️ ' + detail, 'quest_error');
      }
      // Force a server resync. A 400 here almost always means our cached
      // _questData disagrees with the server (we think it's collectible,
      // server thinks it's still in progress or already collected). Pulling
      // fresh state re-renders with whatever the server actually has, so
      // the player isn't stuck looping on a phantom button.
      if (typeof refreshActiveQuests === 'function') {
        try { await refreshActiveQuests(); } catch(e) {}
      }
      return; // skip the cached re-render below — refresh already re-rendered
    }
    // Success path: parse the response so we can update the wealth display.
    try {
      const data = await res.json();
      if (data?.gold_awarded > 0) {
        if (gameData?.settlement?.resources) {
          gameData.settlement.resources.wealth += data.gold_awarded;
        }
        if (data.wealth_after != null && typeof tickResources !== 'undefined' && tickResources != null) {
          tickResources.wealth = data.wealth_after;
        } else if (typeof tickResources !== 'undefined' && tickResources != null) {
          tickResources.wealth = (tickResources.wealth || 0) + data.gold_awarded;
        }
        if (typeof updateTopbarDisplay === 'function') updateTopbarDisplay();
      }
    } catch(e) {}
    // Refresh from server rather than just re-rendering from cache — the
    // server flipped status to 'collected' and the row should disappear
    // from /api/quests results entirely.
    if (typeof refreshActiveQuests === 'function') {
      try { await refreshActiveQuests(); } catch(e) {}
    } else {
      await _renderQuestsModal();
    }
  } catch(e) {
    console.error('[_qmCollect] network error', e);
    if (typeof showToastNotification === 'function') {
      showToastNotification('⚠️ Network error', 'quest_error');
    }
  }
}

async function _renderQuestsModal() {
  const body = document.getElementById('qm-body');
  if (!body) return;

  // We share _questData with quests.js (top-level let in that file → global
  // scope via script tags). When the modal is re-rendered because SSE pushed
  // a state change, refreshActiveQuests() has already fetched fresh data and
  // updated _questData. Re-fetching here would: (a) waste a request, and
  // (b) replace the rendered DOM with "Loading…" until the second fetch
  // completes — which is the flash the user reported. So: render straight
  // from _questData if it's populated; fetch only when we have nothing.
  let data;
  if (typeof _questData !== 'undefined' && _questData && Array.isArray(_questData.active)) {
    data = _questData;
  } else {
    body.innerHTML = '<div class="qm-loading">Loading…</div>';
    try {
      const res = await apiFetch('/api/quests');
      if (!res.ok) throw new Error('Failed');
      data = await res.json();
      // Cache for subsequent renders. Without this, opening the modal once
      // never populates _questData and we'd re-fetch every time.
      if (typeof window !== 'undefined') window._questData = data;
    } catch (e) {
      body.innerHTML = '<div class="qm-empty">Could not load quests.</div>';
      return;
    }
  }

  try {
    const active = (data.active || []).filter(q => q.status === 'active');
    const collectible = (data.active || []).filter(q => q.status === 'completed' || q.status === 'failed');

    if (!active.length && !collectible.length) {
      body.innerHTML = '<div class="qm-empty">No active quests right now.<br><span>Head to the Tavern to find work.</span></div>';
      return;
    }

    const formatTime = secs => {
      if (secs <= 0) return 'Done';
      if (secs < 60) return secs + 's';
      const m = Math.floor(secs / 60), s = secs % 60;
      return m + 'm ' + (s > 0 ? s + 's' : '');
    };

    const questCard = (q, ready) => {
      const def = q.quest_def || {};
      const isParty = q.quest_type === 'party' || (q.party_members && q.party_members.length > 1);
      const members = isParty
        ? (q.party_members || []).map(m => m.name).join(', ')
        : (q.citizen_name || 'Unknown');
      const remaining = Math.max(0, Math.ceil((new Date(q.completes_at) - Date.now()) / 1000));
      const total     = def.duration_s || 120;

      // Combat-pause state: when the server has paused the quest clock
      // waiting on a battle, neither the timer nor the progress bar should
      // advance. Freeze the bar at the % at trigger time.
      const isPaused = ['pending', 'in_progress'].includes(q.combat_status);
      let pct;
      if (isPaused && q.combat_clock_paused_at) {
        const start = new Date(q.started_at).getTime();
        const end = new Date(q.completes_at).getTime();
        const pausedAt = new Date(q.combat_clock_paused_at).getTime();
        const totalMs = end - start;
        pct = totalMs > 0
          ? Math.min(100, Math.max(0, Math.round(((pausedAt - start) / totalMs) * 100)))
          : 0;
      } else {
        const elapsed = total - remaining;
        pct = Math.min(100, Math.round((elapsed / total) * 100));
      }
      const barColor  = ready ? (q.status === 'completed' ? '#5ec45e' : '#e87a6a') : '#e8c76a';

      // Did this quest have a combat encounter that resolved? If so, the
      // player can review the after-action report.
      const hadCombat = q.combat_outcome === 'victory' || q.combat_outcome === 'defeat';

      let rightEl;
      if (ready) {
        // If this quest had combat, give the player a way to review the
        // after-action report. Otherwise the report data is buried and
        // they may collect without ever seeing what happened.
        const battleBtn = hadCombat
          ? '<button class="qm-report-btn" onclick="openBattleReport(' + q.id + ')">📜 View Battle</button>'
          : '';
        if (q.status === 'completed') {
          rightEl = battleBtn + '<button class="qm-collect-btn" data-id="' + q.id + '" onclick="_qmCollect(this)">⚡ Collect</button>';
        } else {
          rightEl = battleBtn + '<button class="qm-collect-btn qm-dismiss-btn" data-id="' + q.id + '" onclick="_qmCollect(this)">✗ Dismiss</button>';
        }
      } else if (isPaused) {
        // Paused for combat. Show a clickable "Awaiting combat" tag that
        // links to the Battles modal so the player can engage directly.
        const label = q.combat_status === 'in_progress' ? '⚔ In battle' : '⚔ Awaiting combat';
        rightEl = '<button class="qm-battle-link" onclick="openBattlesModal()">' + label + '</button>';
      } else {
        rightEl = '<span class="qm-quest-timer" id="qm-timer-' + q.id + '">' + formatTime(remaining) + '</span>';
      }

      return '<div class="qm-quest' + (ready ? ' qm-quest-ready' : '') + '">'
        + '<div class="qm-quest-top">'
        + '<span class="qm-quest-icon">' + (def.icon || '📜') + '</span>'
        + '<div class="qm-quest-info">'
        + '<div class="qm-quest-title">' + (def.title || q.quest_id) + '</div>'
        + '<div class="qm-quest-members">' + (isParty ? '👥 ' : '👤 ') + members + '</div>'
        + '</div>'
        + rightEl
        + '</div>'
        + '<div class="qm-quest-bar-wrap">'
        + '<div class="qm-quest-bar" id="qm-bar-' + q.id + '" style="width:' + (ready ? 100 : pct) + '%;background:' + barColor + '"></div>'
        + '</div>'
        + '</div>';
    };

    let html = '';
    if (collectible.length) {
      html += '<div class="qm-section">⚡ Ready to Collect — <a onclick="closeQuestsModal();openNoticeboard()" class="qm-link">Go to Tavern →</a></div>';
      html += collectible.map(q => questCard(q, true)).join('');
    }
    if (active.length) {
      html += '<div class="qm-section">⏳ In Progress</div>';
      html += active.map(q => questCard(q, false)).join('');
    }
    body.innerHTML = html;

    // Live-update timers + progress bars are driven by the unified loop in
    // quests.js (startGlobalQuestTimer). It scans the document for the
    // qm-timer-* / qm-bar-* elements this render produced and updates them
    // on its 1Hz tick. No per-modal interval needed.
    //
    // Defensive cleanup: if an older build left a _qmTimerInterval handle
    // on window, clear it so we don't have two loops fighting on the same
    // elements during an old-tab-stays-open hot deploy.
    if (window._qmTimerInterval) {
      clearInterval(window._qmTimerInterval);
      window._qmTimerInterval = null;
    }
  } catch(e) {
    body.innerHTML = '<div class="qm-empty">Could not load quests.</div>';
  }
}

function showCommunityTab(tab) {
  document.querySelectorAll('.comm-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('community-title').textContent = COMM_TITLES[tab] || tab;
  document.getElementById('community-modal').classList.add('open');
}

function closeCommunity() {
  document.getElementById('community-modal').classList.remove('open');
  document.querySelectorAll('.comm-btn').forEach(b => b.classList.remove('active'));
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCommunity();
});

// ══════════════════════════════════════════════
//  TOAST NOTIFICATION SYSTEM
//  Tavern's Rest style — bottom-left stack
// ══════════════════════════════════════════════

const EVENT_TOAST_ICONS = {
  quest_success: '⚔️', quest_fail: '💀', quest_return: '🔔', child_born: '🍼',
  partnership: '💕', bond_formed: '🤝', close_bond: '💛',
  expedition_complete: '🗺', harvest: '🌿', default: '📜',
};

function showToastNotification(message, type) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;

  // Play pop sound
  _playToastSound();

  const icon = EVENT_TOAST_ICONS[type] || EVENT_TOAST_ICONS.default;
  const toast = document.createElement('div');
  toast.className = 'toast-item toast-item--in';
  toast.innerHTML = '<span class="toast-icon">' + icon + '</span>'
    + '<span class="toast-msg">' + message + '</span>';
  stack.appendChild(toast);

  // Force reflow for animation
  toast.getBoundingClientRect();

  // Auto-dismiss after 4s
  setTimeout(() => {
    toast.classList.remove('toast-item--in');
    toast.classList.add('toast-item--out');
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

function _playToastSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch(e) { /* no audio context */ }
}

// ── Profile dropdown menu ──────────────────────
function toggleProfileMenu() {
  const wrap = document.getElementById('profile-dropdown-wrap');
  if (!wrap) return;
  const isOpen = wrap.classList.contains('open');
  if (isOpen) {
    closeProfileMenu();
  } else {
    wrap.classList.add('open');
    setTimeout(() => document.addEventListener('click', _profileMenuClickOutside), 50);
  }
}
function closeProfileMenu() {
  document.getElementById('profile-dropdown-wrap')?.classList.remove('open');
  document.removeEventListener('click', _profileMenuClickOutside);
}
function _profileMenuClickOutside(e) {
  if (!document.getElementById('profile-dropdown-wrap')?.contains(e.target)) {
    closeProfileMenu();
  }
}

function _populateProfileTrigger() {
  if (!gameData) return;
  const mini = document.getElementById('profile-avatar-mini');
  const label = document.getElementById('profile-username-label');
  if (mini)  mini.textContent  = (gameData.username || '?')[0].toUpperCase();
  if (label) label.textContent = gameData.username || '—';
}

// ── Tavernkeep sprite ──
// Show the assigned keeper's species art behind the tavern dock.
// Call setTavernKeeperSprite(keeper.species) when rendering the
// tavern (and setTavernKeeperSprite(null) when nobody is assigned).
// Art lives at /assets/images/tavernkeep_<species>.png; if a species
// has no art yet, the onerror handler hides the slot gracefully.
// Species fields in game data are display names and often PLURAL
// ('Hares', 'Mice') — normalize to the singular lowercase keys that
// asset filenames and emoji maps use.
function normalizeSpecies(name) {
  let s = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  const irregular = { mice: 'mouse', foxes: 'fox' };
  if (irregular[s]) return irregular[s];
  if (s.endsWith('s')) s = s.slice(0, -1);
  return s;
}

function setTavernKeeperSprite(species) {
  const el = document.getElementById('tavern-keeper-sprite');
  if (!el) return;
  if (!species) {
    el.style.display = 'none';
    el.removeAttribute('src');
    return;
  }
  const safe = normalizeSpecies(species);
  el.onerror = () => { el.style.display = 'none'; };
  el.src = '/assets/images/tavernkeep_' + safe + '.png';
  el.style.display = 'block';
}
