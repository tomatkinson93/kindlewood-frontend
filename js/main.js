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
    showScreen('login');
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
const LOGIN_ARTS = [
  '/assets/images/login_art1.png',
  '/assets/images/login_art2.png',
  '/assets/images/login_art3.png',
  '/assets/images/login_art4.png',
];
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

  // Init on page load
  document.addEventListener('DOMContentLoaded', () => {
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
let camera = { q: 20, r: 15 };

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
  if (worldMapData?.playerSettlement) {
    camera.q = worldMapData.playerSettlement.q;
    camera.r = worldMapData.playerSettlement.r;
    renderWorldMap(worldMapData);
  }
}

function panCamera(dx, dy) {
  camera.q += dx;
  camera.r += dy;
  if (worldMapData) renderWorldMap(worldMapData);
}

// Keyboard panning
const _keysHeld = {};
let _panInterval = null;

document.addEventListener('keydown', e => {
  const mapKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','A','d','D','w','W','s','S'];
  if (!document.getElementById('screen-game')?.classList.contains('active')) return;
  if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (!mapKeys.includes(e.key)) return;
  e.preventDefault();
  _keysHeld[e.key] = true;
  if (!_panInterval) {
    _panInterval = setInterval(() => {
      let dx = 0, dy = 0;
      if (_keysHeld['ArrowLeft']  || _keysHeld['a'] || _keysHeld['A']) dx -= 1;
      if (_keysHeld['ArrowRight'] || _keysHeld['d'] || _keysHeld['D']) dx += 1;
      if (_keysHeld['ArrowUp']    || _keysHeld['w'] || _keysHeld['W']) dy -= 1;
      if (_keysHeld['ArrowDown']  || _keysHeld['s'] || _keysHeld['S']) dy += 1;
      if (dx || dy) panCamera(dx, dy);
    }, 100);
  }
});

document.addEventListener('keyup', e => {
  delete _keysHeld[e.key];
  if (Object.keys(_keysHeld).length === 0 && _panInterval) {
    clearInterval(_panInterval);
    _panInterval = null;
  }
});


// ── Drag to pan ──
let _drag = null;

function _canvasPixelToHex(mouseX, mouseY) {
  // Convert canvas pixel position to hex axial coords
  // mouseX/Y are in CSS logical pixels; use clientWidth not canvas.width (physical pixels)
  const canvas = _getCanvas();
  if (!canvas) return null;
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const tpx = TILE_PX();
  const hexW = tpx;
  const hexH = Math.round(tpx * 1.1547);
  const hexVert = Math.round(hexH * 0.75);
  const camPxX = hexW * (camera.q + camera.r / 2);
  const camPxY = hexVert * camera.r;
  // Pixel → world pixel → fractional hex
  const worldX = mouseX - W/2 + camPxX;
  const worldY = mouseY - H/2 + camPxY;
  // Pointy-top axial inverse:
  // r = worldY / hexVert
  // q = worldX / hexW - r/2
  const fr = worldY / hexVert;
  const fq = worldX / hexW - fr / 2;
  // Round to nearest hex using cube rounding
  const fs = -fq - fr;
  let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
  const dq = Math.abs(rq-fq), dr = Math.abs(rr-fr), ds = Math.abs(rs-fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  const wq = ((rq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
  const wr = ((rr % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
  return { wq, wr };
}

function _initMapDrag() {
  const canvas = _getCanvas();
  if (!canvas || canvas._dragInit) return;
  canvas._dragInit = true;

  // Zoom removed — scroll wheel disabled

  // Click — hit test hex
  canvas.addEventListener('click', e => {
    if (_wasDrag) return; // don't fire click after drag
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hex = _canvasPixelToHex(mx, my);
    if (!hex) return;
    const tileMap = {};
    worldMapData?.tiles?.forEach(t => { tileMap[`${t.q},${t.r}`] = t; });
    const t = tileMap[`${hex.wq},${hex.wr}`];
    if (!t || t.terrain === 'fog') {
      _selectedTile = { wq: hex.wq, wr: hex.wr };
      selectFogTile(hex.wq, hex.wr);
    } else {
      _selectedTile = { wq: hex.wq, wr: hex.wr };
      selectWorldTile(t);
    }
    if (!_fogAnimId) renderWorldMap(worldMapData);
  });

  // Hover tracking
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hex = _canvasPixelToHex(mx, my);
    if (hex) {
      const prev = _hoveredTile;
      if (!prev || prev.wq !== hex.wq || prev.wr !== hex.wr) {
        _hoveredTile = hex;
        // Only re-render for hover if fog animation isn't already doing it
        if (!_fogAnimId) renderWorldMap(worldMapData);
      }
    }
  });
  canvas.addEventListener('mouseleave', () => {
    _hoveredTile = null;
  });

  // Drag pan
  let _wasDrag = false;
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _wasDrag = false;
    _drag = {
      startX: e.clientX,
      startY: e.clientY,
      camX: camera.q,
      camY: camera.r
    };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!_drag) return;
    const tpx = TILE_PX();
    const hexVert = Math.round(tpx * 1.1547 * 0.75);
    const dx = Math.round((_drag.startX - e.clientX) / tpx);
    const dy = Math.round((_drag.startY - e.clientY) / hexVert);
    if (dx !== 0 || dy !== 0) _wasDrag = true;
    camera.q = _drag.camX + dx;
    camera.r = _drag.camY + dy;
    if (worldMapData) renderWorldMap(worldMapData);
  });

  window.addEventListener('mouseup', () => {
    if (!_drag) return;
    _drag = null;
    canvas.style.cursor = 'grab';
  });

  canvas.style.cursor = 'grab';
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
_fogImg.src = '/assets/fog/fog_base.png';
let _fogOffset = 0;
let _fogAnimId = null;

function _startFogAnimation() {
  if (_fogAnimId) return;
  let last = 0;
  function tick(ts) {
    const dt = last ? (ts - last) : 16;
    last = ts;
    _fogOffset += dt * 0.018;  // no modulo — smooth infinite drift, no reset
    if (worldMapData) _doRenderCanvas();
    _fogAnimId = requestAnimationFrame(tick);
  }
  _fogAnimId = requestAnimationFrame(tick);
}

// ── Canvas state ───────────────────────────────
let _canvas = null, _ctx = null;
let _hoveredTile  = null;  // {wq, wr} of hovered hex
let _selectedTile = null;  // {wq, wr} of clicked hex

function _getCanvas() {
  if (_canvas) return _canvas;
  _canvas = document.getElementById('map-canvas');
  if (_canvas) _ctx = _canvas.getContext('2d', { alpha: false });
  return _canvas;
}

// ── Hex path helper ────────────────────────────
function _hexPath(ctx, cx, cy, hw, hh) {
  const q1 = hw * 0.5, q2 = hw;
  const r1 = hh * 0.25, r2 = hh * 0.75, r3 = hh;
  ctx.beginPath();
  ctx.moveTo(cx - q1, cy);
  ctx.lineTo(cx + q1, cy);
  ctx.lineTo(cx + q2 - q1, cy + r1);    // actually use correct pointy-top coords
  ctx.lineTo(cx + q2 - q1, cy + r2);
  ctx.lineTo(cx + q1, cy + r3);
  ctx.lineTo(cx - q1, cy + r3);
  ctx.lineTo(cx - q2 + q1, cy + r2);
  ctx.lineTo(cx - q2 + q1, cy + r1);
  ctx.closePath();
}

// Simpler version — pointy-top hex with left=x, top=y, w=hexW, h=hexH
function _hexPathLT(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x + w/2,  y);
  ctx.lineTo(x + w,    y + h*0.25);
  ctx.lineTo(x + w,    y + h*0.75);
  ctx.lineTo(x + w/2,  y + h);
  ctx.lineTo(x,        y + h*0.75);
  ctx.lineTo(x,        y + h*0.25);
  ctx.closePath();
}

// ── Main render ────────────────────────────────
let _renderPending = false;

function renderWorldMap(data) {
  worldMapData = data || worldMapData;
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(() => {
    _renderPending = false;
    _doRenderCanvas();
  });
}

function _doRenderCanvas() {
  const data = worldMapData;
  if (!data || !data.tiles) return;

  const canvas = _getCanvas();
  if (!canvas) return;

  const frame = document.getElementById('map-frame');
  const W = frame ? (frame.offsetWidth  || frame.clientWidth  || MAP_FRAME_W) : (canvas.clientWidth  || MAP_FRAME_W);
  const H = frame ? (frame.offsetHeight || frame.clientHeight || MAP_FRAME_H) : (canvas.clientHeight || MAP_FRAME_H);
  const dpr = window.devicePixelRatio || 1;

  // Resize canvas backing store to physical pixels (HiDPI fix)
  // Resizing the canvas resets its transform, so we always reapply scale below
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
  }
  // Always reset transform and reapply dpr scale at start of each frame
  // (canvas resize clears the transform; calling scale() repeatedly would compound it)
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ctx = _ctx;

  // ── Hex geometry ──────────────────────────────
  const tpx     = TILE_PX();
  const hexW    = tpx;
  const hexH    = Math.round(tpx * 1.1547);
  const hexVert = Math.round(hexH * 0.75);
  const showEmoji = tpx >= 36;

  // ── Tile lookup ───────────────────────────────
  const tileMap = {};
  data.tiles.forEach(t => { tileMap[`${t.q},${t.r}`] = t; });

  // ── Clear ─────────────────────────────────────
  // Match the unified tile border color so any sub-pixel gap between hex
  // shapes blends invisibly. Using a near-black clear here would produce
  // visible dark seams as the tile edges fade to transparent.
  ctx.fillStyle = '#3a2e22';
  ctx.fillRect(0, 0, W, H);

  // ── Visible range ─────────────────────────────
  const rowsVisible = Math.ceil(H / hexVert) + 8;
  const colsVisible = Math.ceil(W / hexW) + rowsVisible + 4;
  const cx = W / 2, cy = H / 2;
  const camPxX = hexW * (camera.q + camera.r / 2);
  const camPxY = hexVert * camera.r;
  const qStart = camera.q - Math.ceil(colsVisible / 2);
  const rStart = camera.r - Math.ceil(rowsVisible / 2);

  // ── Fog texture — scaled up, drifts via sin/cos, no tiling so no seams ──
  if (_fogImg.complete && _fogImg.naturalWidth > 0) {
    const driftRange = Math.max(W, H) * 0.08;  // drift by up to 8% of canvas
    // drawSize must be canvas + 2× driftRange so edges never go out of frame
    const drawSize = Math.max(W, H) + driftRange * 2;
    const driftX = Math.sin(_fogOffset * 0.0012) * driftRange;
    const driftY = Math.cos(_fogOffset * 0.0008) * driftRange;
    ctx.globalAlpha = 0.58;
    ctx.drawImage(_fogImg, (W - drawSize) / 2 + driftX, (H - drawSize) / 2 + driftY, drawSize, drawSize);
    ctx.globalAlpha = 1;
  }

  // ── Collect visible tiles (deduplicated — no tile drawn twice) ──────────
  const visibleTiles = [];
  const _seenTiles = new Set();
  for (let dr = 0; dr < rowsVisible; dr++) {
    for (let dq = 0; dq < colsVisible; dq++) {
      const aq = qStart + dq, ar = rStart + dr;
      const wq = ((aq % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
      const wr = ((ar % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
      const key = `${wq},${wr}`;
      if (_seenTiles.has(key)) continue;  // skip duplicate — tile already queued
      const x = cx + hexW * (aq + ar / 2) - camPxX - hexW / 2;
      const y = cy + hexVert * ar - camPxY - hexH / 2;
      if (x < -hexW * 2 || x > W + hexW || y < -hexH * 2 || y > H + hexH) continue;
      _seenTiles.add(key);
      visibleTiles.push({ wq, wr, x: Math.round(x), y: Math.round(y), t: tileMap[`${wq},${wr}`] });
    }
  }

  // ── Pass 1: terrain fills ─────────────────────
  for (const { wq, wr, x, y, t } of visibleTiles) {
    _hexPathLT(ctx, x, y, hexW, hexH);

    if (!t || t.terrain === 'fog') {
      // No fill — fog texture draws through
    } else if (t.settlement) {
      ctx.fillStyle = t.settlement.isOwn ? '#1a3060' : '#1a2e4a';
      ctx.fill();
    } else {
      // Pick the tile image. Real PNGs (TILE_IMAGES[terrain]) win when loaded;
      // otherwise fall back to a procedural variant chosen on coarse coords so
      // that small clusters of adjacent tiles share the same look — gives
      // patchy variation rather than per-tile noise.
      let img = TILE_IMAGES[t.terrain];
      if ((!img || img._isVariantSet) && typeof getTileVariant === 'function') {
        img = getTileVariant(t.terrain, wq, wr);
      }
      const isUsableImage = img && !img._isVariantSet
        && (img.naturalWidth || img.width);
      if (isUsableImage && _tileImagesLoaded) {
        ctx.save();
        _hexPathLT(ctx, x, y, hexW, hexH);
        ctx.clip();
        // Draw tile at full hex size with a 1px overdraw on every side. The
        // hex clip keeps content in the shape; the overdraw eliminates any
        // sub-pixel gap where adjacent tiles meet, so seams disappear.
        // (No more scale/offset jitter — that was producing the choppy look.)
        ctx.drawImage(img, x - 1, y - 1, hexW + 2, hexH + 2);
        ctx.restore();
      } else {
        ctx.fillStyle = TERRAIN_COLORS[t.terrain] || '#2a2010';
        ctx.fill();
        _drawTerrainDetail(ctx, x, y, hexW, hexH, t.terrain, wq, wr);
      }
    }
  }


  // ── Pass 1.5: river water (painterly natural treatment) ────────────────
  // Goal: rivers read as terrain features carved into the landscape, not as
  // overlay strokes. Approach is layered "soft to hard":
  //
  //   L1 wet-earth aura   — wide, very low-alpha dark ring; ground "soaked"
  //   L2 soft outer water — wider faded water layer that bleeds into the aura
  //   L3 water body       — main water colour at full width
  //   L4 inner highlight  — soft sheen
  //   L5 shore details    — terrain-aware: reeds (marsh/plains), rocks
  //                         (hills/mountain), grass tufts (plains), surface
  //                         ripples scattered along the river
  //   L6 endpoint pools   — only for 0/1-conn river tiles
  //
  // Lakes use the same layer structure but drawn as overlapping-circle blobs
  // per tile rather than hex-shaped fills, so shorelines are organic curves
  // instead of straight hex edges.
  //
  // Curves are tangent-continuous cubic Beziers with extra wobble injected
  // mid-tile (pre-tile-center) for irregular bank silhouettes, and width
  // grows downstream via a BFS-from-headwaters rank cached on worldMapData.
  //
  // Position math uses each tile's visibleTiles entry + screen-space hex
  // direction offsets so wrapping at map edges renders correctly.
  const HEX_NEIGHBORS = [
    [+1, 0], [-1, 0], [0, +1], [0, -1], [+1, -1], [-1, +1],
  ];
  const HEX_DIR_PX = HEX_NEIGHBORS.map(([dq, dr]) => ({
    dx: hexW * (dq + dr / 2),
    dy: hexVert * dr,
  }));
  const tileAt = (q, r) => tileMap[`${q},${r}`];
  const isRiverTile = (q, r) => {
    const t = tileAt(q, r);
    return t && t.terrain === 'river';
  };
  const hashF = (...args) => {
    let h = 0;
    for (const a of args) h = ((h * 31) ^ (a | 0)) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
  };
  const wrapQ = (q) => ((q % HEX_MAP_W) + HEX_MAP_W) % HEX_MAP_W;
  const wrapR = (r) => ((r % HEX_MAP_H) + HEX_MAP_H) % HEX_MAP_H;
  const countRiverNeighbours = (q, r) => {
    let n = 0;
    for (const [dq, dr] of HEX_NEIGHBORS) {
      if (isRiverTile(wrapQ(q + dq), wrapR(r + dr))) n++;
    }
    return n;
  };
  const isLakeTile = (q, r) => {
    const c = countRiverNeighbours(q, r);
    if (c >= 4) return true;
    if (c >= 3) {
      for (const [dq, dr] of HEX_NEIGHBORS) {
        const nq = wrapQ(q + dq), nr = wrapR(r + dr);
        if (isRiverTile(nq, nr) && countRiverNeighbours(nq, nr) >= 4) return true;
      }
    }
    return false;
  };

  // BFS rank from headwaters — cached on worldMapData (invalidated when the
  // dev tile-editor changes a tile, see _applyDevTileTerrain).
  if (!data._riverFlow) {
    const rank = {};
    const queue = [];
    for (const t of data.tiles) {
      if (t.terrain !== 'river') continue;
      if (countRiverNeighbours(t.q, t.r) === 1 && !isLakeTile(t.q, t.r)) {
        rank[`${t.q},${t.r}`] = 0;
        queue.push({ q: t.q, r: t.r, d: 0 });
      }
    }
    while (queue.length) {
      const cur = queue.shift();
      for (const [dq, dr] of HEX_NEIGHBORS) {
        const nq = wrapQ(cur.q + dq), nr = wrapR(cur.r + dr);
        if (!isRiverTile(nq, nr)) continue;
        const k = `${nq},${nr}`;
        if (rank[k] !== undefined) continue;
        rank[k] = cur.d + 1;
        queue.push({ q: nq, r: nr, d: cur.d + 1 });
      }
    }
    let maxRank = 1;
    for (const k in rank) if (rank[k] > maxRank) maxRank = rank[k];
    data._riverFlow = { rank, maxRank };
  }
  const flowRank = data._riverFlow.rank;
  const flowMax = data._riverFlow.maxRank;

  const terrainWidthFactor = (terrain) => {
    if (terrain === 'mountain') return 0.55;
    if (terrain === 'hills') return 0.75;
    if (terrain === 'marsh') return 1.20;
    if (terrain === 'plains') return 1.05;
    return 1.0;
  };

  // ── Painterly palette ────────────────────────────────────────────────
  // Soft, layered. Lower alphas on outer layers so they bleed into the
  // ground rather than sitting on top.
  const COL_WET_EARTH    = 'rgba(35, 26, 18, 0.18)';   // ground soaked aura
  const COL_WET_EARTH_RIM= 'rgba(50, 38, 26, 0.40)';   // closer-to-water rim
  const COL_WATER_OUTER  = 'rgba(70, 88, 102, 0.45)';  // soft fade water layer
  const COL_WATER_BODY   = 'rgba(58, 78, 96, 0.92)';   // main water colour (rivers)
  // Lake body uses a fully opaque variant — overlapping circles in the lake
  // blob would otherwise expose their structure through alpha compounding,
  // creating a visible "bauble" pattern across the lake surface.
  const COL_WATER_BODY_OPAQUE = 'rgb(58, 78, 96)';
  const COL_WATER_DEEP   = 'rgba(40, 56, 70, 0.55)';   // shadow inside body
  const COL_WATER_LIGHT  = 'rgba(140, 162, 178, 0.40)';// soft highlight
  const COL_WATER_GLINT  = 'rgba(210, 222, 228, 0.55)';// rare bright glint
  const COL_REED         = 'rgba(78, 96, 50, 0.85)';
  const COL_REED_DARK    = 'rgba(50, 64, 30, 0.85)';
  const COL_GRASS        = 'rgba(110, 130, 60, 0.75)';
  const COL_ROCK_DARK    = 'rgba(56, 50, 44, 0.85)';
  const COL_ROCK_LIGHT   = 'rgba(120, 110, 100, 0.70)';

  // Width base — slightly larger than before so downstream rivers feel
  // properly broad. Scaled per terrain + downstream.
  const baseW = Math.max(7, hexW * 0.40);

  // ── Build river render data ──────────────────────────────────────────
  const riverRenders = [];
  for (const { wq, wr, x, y, t } of visibleTiles) {
    if (!t || t.terrain !== 'river') continue;
    const meX = x + hexW / 2;
    const meY = y + hexH / 2;
    const rk = flowRank[`${wq},${wr}`] ?? 0;
    const downstreamFactor = 0.55 + (rk / flowMax) * 0.65; // slightly wider range than before
    const width = baseW * downstreamFactor * terrainWidthFactor(t.terrain);
    const lake = isLakeTile(wq, wr);
    const conns = [];
    for (let i = 0; i < HEX_NEIGHBORS.length; i++) {
      const [dq, dr] = HEX_NEIGHBORS[i];
      const nq = wrapQ(wq + dq), nr = wrapR(wr + dr);
      if (!isRiverTile(nq, nr)) continue;
      const nX = meX + HEX_DIR_PX[i].dx;
      const nY = meY + HEX_DIR_PX[i].dy;
      let mx = (meX + nX) / 2;
      let my = (meY + nY) / 2;
      // Symmetric edge-midpoint wobble
      let ka = wq, kb = wr, kc = nq, kd = nr;
      if (ka > kc || (ka === kc && kb > kd)) {
        [ka, kc] = [kc, ka]; [kb, kd] = [kd, kb];
      }
      const wobble = (hashF(ka, kb, kc, kd) - 0.5) * hexW * 0.10;
      const ex = nX - meX, ey = nY - meY;
      const elen = Math.sqrt(ex * ex + ey * ey) || 1;
      mx += (-ey / elen) * wobble;
      my += (ex / elen) * wobble;
      conns.push({
        nq, nr, dirIdx: i,
        edge: { x: mx, y: my },
        tangent: { x: ex / elen, y: ey / elen },
        // Neighbour terrain — used for shore detail decisions.
        nTerrain: tileAt(nq, nr)?.terrain || 'plains',
      });
    }
    riverRenders.push({
      wq, wr,
      x: meX, y: meY,
      hexX: x, hexY: y,
      width, conns, lake,
      terrain: t.terrain,
    });
  }

  // ── Lake blob construction ───────────────────────────────────────────
  // For each lake tile, compute a list of circles whose union is the lake's
  // contribution to the water body. A big core circle at tile centre, plus
  // smaller bridge circles toward each lake neighbour (so adjacent lake
  // tiles' circles overlap and form one continuous organic blob).
  // Also collect lake tiles for shore/aura layers.
  const lakeRenders = riverRenders.filter(r => r.lake);
  const isLakeNeighbour = (rt, dirIdx) => {
    const [dq, dr] = HEX_NEIGHBORS[dirIdx];
    const nq = wrapQ(rt.wq + dq), nr = wrapR(rt.wr + dr);
    return isLakeTile(nq, nr);
  };
  const lakeBlobCircles = (rt) => {
    const circles = [];
    // Core: irregular per-tile size — slightly oversized so adjacent
    // bridge circles always overlap with cores nicely.
    const coreR = hexW * (0.58 + hashF(rt.wq, rt.wr, 21) * 0.08);
    circles.push({ x: rt.x, y: rt.y, r: coreR });
    // Bridges toward lake neighbours — wider radius for smooth interior.
    for (let i = 0; i < HEX_NEIGHBORS.length; i++) {
      if (!isLakeNeighbour(rt, i)) continue;
      const dx = HEX_DIR_PX[i].dx, dy = HEX_DIR_PX[i].dy;
      // Bridge centre is partway from tile centre toward neighbour centre
      const bx = rt.x + dx * 0.5;
      const by = rt.y + dy * 0.5;
      const br = hexW * (0.42 + hashF(rt.wq, rt.wr, 22 + i) * 0.06);
      circles.push({ x: bx, y: by, r: br });
    }
    return circles;
  };

  // ── Helper: stroke the curve through this tile (rivers only) ─────────
  // Cubic Bezier with tangents matched at edge midpoints. For 2-connection
  // tiles the curve passes through the tile centre as control. For
  // endpoints, ends in the tile centre. For junctions, half-curves out from
  // the centre to each edge.
  const cpDist = hexW * 0.35;
  const strokeRiverPath = (rt) => {
    if (rt.lake) return;
    const { x, y, conns } = rt;
    if (conns.length === 2) {
      const a = conns[0], b = conns[1];
      const cax = a.edge.x - a.tangent.x * cpDist;
      const cay = a.edge.y - a.tangent.y * cpDist;
      const cbx = b.edge.x - b.tangent.x * cpDist;
      const cby = b.edge.y - b.tangent.y * cpDist;
      ctx.beginPath();
      ctx.moveTo(a.edge.x, a.edge.y);
      ctx.bezierCurveTo(cax, cay, cbx, cby, b.edge.x, b.edge.y);
      ctx.stroke();
    } else if (conns.length === 1) {
      const c = conns[0];
      const cax = c.edge.x - c.tangent.x * cpDist;
      const cay = c.edge.y - c.tangent.y * cpDist;
      ctx.beginPath();
      ctx.moveTo(c.edge.x, c.edge.y);
      ctx.bezierCurveTo(cax, cay, x, y, x, y);
      ctx.stroke();
    } else if (conns.length >= 3) {
      for (const c of conns) {
        const cax = (x + c.edge.x) / 2;
        const cay = (y + c.edge.y) / 2;
        const cbx = c.edge.x - c.tangent.x * cpDist;
        const cby = c.edge.y - c.tangent.y * cpDist;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(cax, cay, cbx, cby, c.edge.x, c.edge.y);
        ctx.stroke();
      }
    }
  };
  // Helper: fill all circles of a lake blob with current fillStyle. We
  // expand the radius by an offset so layer 1 (aura) draws bigger than
  // layer 3 (body) etc.
  const fillLakeBlob = (rt, expand) => {
    const circles = lakeBlobCircles(rt);
    for (const c of circles) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r + expand, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  //  L1: WET EARTH AURA — outermost soft darkening of ground around water
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  // Outer aura — very low alpha, wide
  ctx.strokeStyle = COL_WET_EARTH;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width + 14;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WET_EARTH;
  for (const rt of lakeRenders) fillLakeBlob(rt, 8);
  // Inner aura rim — slightly stronger, narrower
  ctx.strokeStyle = COL_WET_EARTH_RIM;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width + 6;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WET_EARTH_RIM;
  for (const rt of lakeRenders) fillLakeBlob(rt, 3);
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L2: SOFT OUTER WATER — feathered fade between aura and body
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COL_WATER_OUTER;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width + 3;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WATER_OUTER;
  for (const rt of lakeRenders) fillLakeBlob(rt, 1.5);
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L3: WATER BODY — main water colour
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COL_WATER_BODY;
  for (const rt of riverRenders) {
    ctx.lineWidth = rt.width;
    strokeRiverPath(rt);
  }
  ctx.fillStyle = COL_WATER_BODY_OPAQUE;
  for (const rt of lakeRenders) fillLakeBlob(rt, 0);
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L4: HIGHLIGHT — soft sheen on the upper-left of each segment / lake
  // ──────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COL_WATER_LIGHT;
  for (const rt of riverRenders) {
    if (rt.lake) continue;
    ctx.lineWidth = rt.width * 0.42;
    strokeRiverPath(rt);
  }
  ctx.restore();
  // Lake surface — calm flat water with very subtle ripple lines.
  //
  // Earlier versions drew a per-tile radial highlight which created a "ball"
  // / "bauble" look at every tile centre because the gradient is brightest
  // near the centre of each circle. For a still lake we want one continuous
  // flat surface, so we omit the centre-bright highlight entirely and instead
  // suggest stillness with a few faint, short ripple curves scattered across
  // the lake body. Hashes are seeded by tile position so ripples are
  // deterministic (no flicker on pan) but they vary per tile so adjacent
  // tiles don't show identical ripple patterns.
  ctx.save();
  ctx.strokeStyle = 'rgba(225, 232, 238, 0.18)';
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  for (const rt of lakeRenders) {
    // 1-2 ripples per tile, placed in the inner area (well away from the
    // shoreline so they don't conflict with bank details). Each ripple is a
    // short shallow arc — subtle horizontal-ish wave, very low contrast.
    const numRipples = (hashF(rt.wq, rt.wr, 41) < 0.55) ? 2 : 1;
    for (let i = 0; i < numRipples; i++) {
      const ox = (hashF(rt.wq, rt.wr, 42 + i) - 0.5) * hexW * 0.55;
      const oy = (hashF(rt.wq, rt.wr, 44 + i) - 0.5) * hexH * 0.45;
      const cx_ = rt.x + ox;
      const cy_ = rt.y + oy;
      const len = hexW * (0.20 + hashF(rt.wq, rt.wr, 46 + i) * 0.12);
      // Angle is mostly horizontal with slight tilt — water reads "still"
      // when ripples are level rather than diagonal.
      const tilt = (hashF(rt.wq, rt.wr, 48 + i) - 0.5) * 0.4;
      const dx = Math.cos(tilt) * len / 2;
      const dy = Math.sin(tilt) * len / 2;
      ctx.beginPath();
      ctx.moveTo(cx_ - dx, cy_ - dy);
      ctx.quadraticCurveTo(cx_, cy_ - 0.6, cx_ + dx, cy_ + dy);
      ctx.stroke();
    }
  }
  ctx.restore();

  // ──────────────────────────────────────────────────────────────────────
  //  L5: SHORE DETAILS — terrain-aware reeds / rocks / grass / ripples
  // ──────────────────────────────────────────────────────────────────────
  // For each river tile, walk its connections and place 1-2 small detail
  // marks per connection on the river side of the shared edge. The mark
  // type depends on the neighbour's terrain: marsh → reeds; plains → grass
  // tufts and reeds; hills/mountain → rocks; otherwise → none. Inside the
  // body of each river tile we also scatter 1-2 surface ripples.
  const drawReedAt = (px, py, seed) => {
    // Reeds: 2-3 vertical strokes, slightly varying height.
    const n = 2 + (seed * 3 | 0) % 2;
    for (let i = 0; i < n; i++) {
      const h = 3 + ((seed * (i + 1.7)) % 1) * 4;
      const ox = (i - (n - 1) / 2) * 1.5;
      ctx.fillStyle = i === 0 ? COL_REED_DARK : COL_REED;
      ctx.fillRect(px + ox, py - h, 1, h);
    }
  };
  const drawGrassAt = (px, py, seed) => {
    // Grass: 4-5 short angled strokes
    ctx.fillStyle = COL_GRASS;
    const n = 3 + (seed * 4 | 0) % 3;
    for (let i = 0; i < n; i++) {
      const ox = (i - n / 2) * 1.3;
      const lean = (((seed * (i + 1)) % 1) - 0.5) * 1.5;
      ctx.fillRect(px + ox, py - 2.5, 0.9, 2.5);
      ctx.fillRect(px + ox + lean, py - 2.0, 0.9, 2.0);
    }
  };
  const drawRockAt = (px, py, seed) => {
    // Rock: small dark dab + smaller light dab
    ctx.beginPath();
    ctx.fillStyle = COL_ROCK_DARK;
    ctx.arc(px, py, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = COL_ROCK_LIGHT;
    ctx.arc(px - 0.5, py - 0.5, 1.0, 0, Math.PI * 2);
    ctx.fill();
  };
  const drawRippleAt = (px, py, len) => {
    ctx.strokeStyle = 'rgba(170, 190, 205, 0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(px - len / 2, py);
    ctx.quadraticCurveTo(px, py - 0.7, px + len / 2, py);
    ctx.stroke();
  };

  for (const rt of riverRenders) {
    // Ripples on body — 1-2 per tile, scattered along curve. Skip lakes
    // (lakes get fewer/different details to read as still water).
    if (!rt.lake) {
      const numRipples = (hashF(rt.wq, rt.wr, 31) < 0.55) ? 2 : 1;
      for (let i = 0; i < numRipples; i++) {
        // Sample a position along the river path. For 2-conn tiles,
        // interpolate along the bezier; otherwise sit near the centre.
        let px, py;
        const t1 = 0.30 + i * 0.40 + (hashF(rt.wq, rt.wr, 32 + i) - 0.5) * 0.15;
        if (rt.conns.length === 2) {
          // Approximate Bezier(t) using simple lerp through centre
          const a = rt.conns[0].edge, b = rt.conns[1].edge;
          if (t1 < 0.5) {
            const u = t1 * 2;
            px = a.x + (rt.x - a.x) * u;
            py = a.y + (rt.y - a.y) * u;
          } else {
            const u = (t1 - 0.5) * 2;
            px = rt.x + (b.x - rt.x) * u;
            py = rt.y + (b.y - rt.y) * u;
          }
        } else {
          px = rt.x + (hashF(rt.wq, rt.wr, 33 + i) - 0.5) * rt.width;
          py = rt.y + (hashF(rt.wq, rt.wr, 34 + i) - 0.5) * rt.width * 0.6;
        }
        drawRippleAt(px, py, rt.width * 0.45);
      }
    }

    // Shore details from each neighbour
    for (const c of rt.conns) {
      // Skip details where the neighbour is also a river/lake — that's
      // water-to-water, not shoreline.
      if (c.nTerrain === 'river') continue;
      // Detail position: slight inward offset from edge midpoint, on the
      // far side of the river (i.e. on the non-river side, just beside
      // the water). Use the perpendicular of the tangent to land on the
      // bank.
      const seed = hashF(rt.wq, rt.wr, c.dirIdx + 7);
      const numMarks = 1 + ((seed * 2) | 0);
      for (let i = 0; i < numMarks; i++) {
        // Position along the edge perpendicular axis, with random offset
        // along the river (so marks don't all stack on the midpoint).
        const along = (hashF(rt.wq, rt.wr, c.dirIdx * 13 + i + 3) - 0.5) * rt.width * 1.4;
        // Tangent runs along flow; perpendicular runs across the river
        const tx = c.tangent.x, ty = c.tangent.y;
        const px_ = -ty, py_ = tx; // perpendicular
        // Place mark just outside the water edge, on the bank facing the
        // neighbour terrain. Distance = water half-width + small margin.
        const offDist = rt.width * 0.50 + 1.5;
        const mx = c.edge.x + px_ * offDist + tx * along;
        const my = c.edge.y + py_ * offDist + ty * along;
        // Pick detail by neighbour terrain
        const mseed = hashF(rt.wq, rt.wr, c.dirIdx * 17 + i + 11);
        if (c.nTerrain === 'marsh') {
          drawReedAt(mx, my, mseed);
        } else if (c.nTerrain === 'plains') {
          if (mseed < 0.5) drawReedAt(mx, my, mseed);
          else drawGrassAt(mx, my, mseed);
        } else if (c.nTerrain === 'hills' || c.nTerrain === 'mountain') {
          drawRockAt(mx, my, mseed);
        } else if (c.nTerrain === 'forest') {
          // Forest banks: occasional grass + occasional rock
          if (mseed < 0.65) drawGrassAt(mx, my, mseed);
          else drawRockAt(mx, my, mseed);
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  L6: ENDPOINT POOLS — rivers ending in springs / 1-tile ponds
  // ──────────────────────────────────────────────────────────────────────
  for (const rt of riverRenders) {
    if (rt.lake) continue;
    const isEndpoint = rt.conns.length <= 1;
    const isJunction = rt.conns.length >= 3;
    if (!isEndpoint && !isJunction) continue;
    const r = isEndpoint
      ? (rt.conns.length === 0 ? rt.width * 0.65 : rt.width * 0.55)
      : rt.width * 0.32;
    // Wet earth around the pool
    ctx.beginPath();
    ctx.fillStyle = COL_WET_EARTH_RIM;
    ctx.arc(rt.x, rt.y, r + 4, 0, Math.PI * 2);
    ctx.fill();
    // Outer water fade
    ctx.beginPath();
    ctx.fillStyle = COL_WATER_OUTER;
    ctx.arc(rt.x, rt.y, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Body
    ctx.beginPath();
    ctx.fillStyle = COL_WATER_BODY;
    ctx.arc(rt.x, rt.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.beginPath();
    ctx.fillStyle = COL_WATER_LIGHT;
    ctx.arc(rt.x - r * 0.25, rt.y - r * 0.25, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (isEndpoint) {
      ctx.beginPath();
      ctx.fillStyle = COL_WATER_GLINT;
      ctx.arc(rt.x - r * 0.35, rt.y - r * 0.35, r * 0.20, 0, Math.PI * 2);
      ctx.fill();
    }
  }


  // ── Pass 2: borders + highlights ─────────────
  for (const { wq, wr, x, y, t } of visibleTiles) {
    const isFog = !t || t.terrain === 'fog';
    const isHome = t?.settlement?.isOwn;
    const isHovered  = _hoveredTile && _hoveredTile.wq === wq && _hoveredTile.wr === wr;
    const isSelected = _selectedTile && _selectedTile.wq === wq && _selectedTile.wr === wr;
    const isSelFog = _selectedFogTile && _selectedFogTile.wx === wq && _selectedFogTile.wy === wr;

    if (isSelected && !isHome) {
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.strokeStyle = 'rgba(255,220,80,0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Inner glow fill
      ctx.fillStyle = 'rgba(255,220,80,0.08)';
      ctx.fill();
    }
    if (isHome) {
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.strokeStyle = 'rgba(255,210,120,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (isSelFog) {
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.strokeStyle = 'rgba(220,175,60,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (isHovered && !isFog) {
      // Terrain hover — clip so stroke doesn't bleed onto adjacent tiles
      ctx.save();
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.clip();
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.strokeStyle = 'rgba(255,210,80,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    } else if (isHovered && isFog) {
      // Fog hover — clip, then fill + outline
      ctx.save();
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.clip();
      ctx.fillStyle = 'rgba(210,160,50,0.18)';
      ctx.fill();
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.strokeStyle = 'rgba(220,175,60,0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Pass 3: settlement rendering ──────────────────────────────────────
  for (const { wq, wr, x, y, t } of visibleTiles) {
    if (!t?.settlement) continue;
    const s = t.settlement;
    const cx = x + hexW / 2, cy = y + hexH / 2;
    const r2 = Math.min(hexW, hexH) * 0.46;

    ctx.save();
    _hexPathLT(ctx, x, y, hexW, hexH);
    ctx.clip();

    // Normalise type — handle undefined/null gracefully
    const sType = s.settlement_type || (s.is_kingdom ? 'kingdom' : s.disposition === 'hostile' ? 'hostile' : 'npc');

    if (sType === 'kingdom' || s.is_kingdom) {
      // ── Great Kingdom — rich gold fill ──
      ctx.fillStyle = s.is_kingdom_annex ? 'rgba(120,90,10,0.68)' : 'rgba(140,100,5,0.78)';
      ctx.fill();
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2 * 0.8);
      grd.addColorStop(0, 'rgba(255,220,80,0.45)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      // Border
      ctx.strokeStyle = s.is_kingdom_annex ? 'rgba(220,185,60,0.70)' : 'rgba(255,215,50,0.98)';
      ctx.lineWidth = s.is_kingdom_annex ? 1.8 : 2.8;
      ctx.stroke();
      // Crown icon on main tile only
      if (!s.is_kingdom_annex && showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.42)}px serif`;
        ctx.fillText('👑', cx, cy);
      }

    } else if (sType === 'hostile') {
      // ── Hostile (Withered) — solid dark crimson fill ──
      ctx.fillStyle = 'rgba(100,8,8,0.78)';
      ctx.fill();
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2 * 0.7);
      grd.addColorStop(0, 'rgba(220,40,20,0.35)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,50,30,0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.42)}px serif`;
        ctx.fillText('💀', cx, cy);
      }

    } else if (sType === 'npc') {
      // ── Friendly/Neutral NPC — solid teal fill over terrain ──
      const isNeutral = s.disposition === 'neutral';
      // Solid base fill
      ctx.fillStyle = isNeutral ? 'rgba(40,100,90,0.72)' : 'rgba(20,110,80,0.72)';
      ctx.fill();
      // Lighter centre glow
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2 * 0.7);
      grd.addColorStop(0, isNeutral ? 'rgba(130,210,180,0.35)' : 'rgba(80,220,160,0.40)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      // Border
      ctx.strokeStyle = isNeutral ? 'rgba(120,200,160,0.9)' : 'rgba(60,220,150,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.38)}px serif`;
        ctx.fillText('🏡', cx, cy);
      }

    } else {
      // ── Player settlement — amber/gold ──
      const grd = ctx.createRadialGradient(cx, cy, r2 * 0.1, cx, cy, r2);
      grd.addColorStop(0, s.isOwn ? 'rgba(255,200,80,0.32)' : 'rgba(200,160,60,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = s.isOwn ? 'rgba(255,210,120,0.95)' : 'rgba(200,160,60,0.65)';
      ctx.lineWidth = s.isOwn ? 2.5 : 1.8;
      ctx.stroke();
      if (showEmoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(hexH * 0.42)}px serif`;
        ctx.fillText(s.isOwn ? '🏘' : '🏘', cx, cy);
      }
    }

    ctx.restore();
  }
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
    sub.textContent = `(${tile.q}, ${tile.r}) · Unoccupied`;
    body.innerHTML = `
      <div class="info-row"><span class="info-label">Terrain bonus</span><span class="info-val" style="font-size:11px;">${TERRAIN_BONUSES_DISPLAY[tile.terrain] || 'None'}</span></div>
      <hr class="sdivider">
      <button class="action-btn" onclick="alert('Colonisation coming soon!')">Found outpost here</button>
    `;
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
    const adults   = citizens.filter(c => c.life_stage !== 'child');
    const children = citizens.filter(c => c.life_stage === 'child');
    // Count diplomatic envoys from _diploRelations cache (populated by diplomacy.js)
    const diploEnvoys = (typeof _diploEnvoyIds !== 'undefined' ? _diploEnvoyIds : new Set());
    const onMission = adults.filter(c => c.expedition || c.active_quest || diploEnvoys.has(c.id)).length;
    const idle      = adults.filter(c => !c.expedition && !c.active_quest && !diploEnvoys.has(c.id) && (!c.role || c.role === 'idle')).length;

    // Species breakdown pills
    const speciesCounts = {};
    citizens.forEach(c => { const sp = c.species || s.species || 'unknown'; speciesCounts[sp] = (speciesCounts[sp]||0)+1; });
    const speciesHtml = Object.entries(speciesCounts)
      .map(([sp,n]) => '<span class="sett-species-pip">' + sp.charAt(0).toUpperCase()+sp.slice(1) + ' <b>' + n + '</b></span>')
      .join('') || '<span class="sett-species-pip">' + (s.species||'Unknown') + '</span>';

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
      + (onMission > 0 ? '<span class="sett-tag sett-tag-active">' + onMission + ' Away</span>' : '')
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
      + '<div class="sett-status-row"><span class="sett-status-icon">⚒</span><span class="sett-status-label">Idle Citizens</span><span class="sett-status-val" style="color:' + (idle > 3 ? '#e8c76a' : 'rgba(192,221,151,.6)') + '">' + idle + '</span></div>'
      + '</div>'

      // Population section
      + '<div class="sett-divider"></div>'
      + '<div class="sett-section-label">Population</div>'
      + '<div class="sett-stat-row">'
      + '<div class="sett-stat"><div class="sett-stat-val">' + adults.length + '</div><div class="sett-stat-key">Adults</div></div>'
      + '<div class="sett-stat"><div class="sett-stat-val">' + children.length + '</div><div class="sett-stat-key">Children</div></div>'
      + '<div class="sett-stat" title="Citizens on quests, expeditions or diplomatic missions">'  + '<div class="sett-stat-val">' + onMission + '</div><div class="sett-stat-key">Adventuring</div></div>'
      + '</div>'
      + '<div class="sett-species-row">' + speciesHtml + '</div>'

      // Actions — with hierarchy
      + '<div class="sett-divider"></div>'
      + '<button class="sett-action-primary" onclick="openSettlementView()">🏗 Construct Building</button>'
      + '<div class="sett-actions-secondary">'
      + '<button class="sett-action-secondary" onclick="openTierUpgradeModal()">' + (TIER_EMOJI[s.tier]||'🏕') + ' Upgrade</button>'
      + '<button class="sett-action-secondary" onclick="visitTavern()">🍺 Tavern</button>'
      + '<button class="sett-action-secondary" onclick="visitFishingPost()">🎣 Fishing</button>'
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
      await loadGame();
    } else if (res.status === 401) {
      localStorage.removeItem('kw_token');
    }
  } catch (e) {
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
