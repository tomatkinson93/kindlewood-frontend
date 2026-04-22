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
    showScreen('game');
    renderTopbar();
    preloadTileImages();
    renderMap();
    initGuardArt();
    if (typeof initProfileDisplay === 'function') initProfileDisplay(gameData.username, gameData.species);
    setTimeout(selectHomeTile2, 800);
    startResourceTick(gameData.settlement.resources, gameData.settlement.rates);
    loadBuildings();
    loadExpeditions();
    startExpeditionPoll();
    initSeasons(gameData.settlement);
    if (typeof startEventsPoll === 'function') startEventsPoll();
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
      selectFogTile(hex.wq, hex.wr);
    } else {
      selectWorldTile(t);
    }
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
    if (data.playerSettlement) {
      camera.q = data.playerSettlement.q;
      camera.r = data.playerSettlement.r;
    }
    renderWorldMap(data);
    _initMapDrag();
    _startFogAnimation();
  } catch (e) { console.error(e); }
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

// Map size (40×40 in axial space, wrapping)
const HEX_MAP_W = 40;
const HEX_MAP_H = 40;

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
    _fogOffset += dt * 0.009;  // no modulo — smooth infinite drift, no reset
    if (worldMapData) _doRenderCanvas();
    _fogAnimId = requestAnimationFrame(tick);
  }
  _fogAnimId = requestAnimationFrame(tick);
}

// ── Canvas state ───────────────────────────────
let _canvas = null, _ctx = null;
let _hoveredTile = null;   // {wq, wr} of hovered hex

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
  ctx.fillStyle = '#0a0806';
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
    const drawSize = Math.max(W, H) * 2.5;
    const driftX = Math.sin(_fogOffset * 0.0012) * (drawSize - W) * 0.3;
    const driftY = Math.cos(_fogOffset * 0.0008) * (drawSize - H) * 0.3;
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
      // No fill — fog texture drawn before pass 1 shows through
    } else if (t.settlement) {
      ctx.fillStyle = t.settlement.isOwn ? '#1a3060' : '#1a2e4a';
      ctx.fill();
    } else {
      // Terrain — use image if loaded, fallback to colour
      const img = TILE_IMAGES[t.terrain];
      if (img && _tileImagesLoaded) {
        ctx.save();
        _hexPathLT(ctx, x, y, hexW, hexH);
        ctx.clip();
        ctx.drawImage(img, x, y, hexW, hexH);
        ctx.restore();
      } else {
        ctx.fillStyle = TERRAIN_COLORS[t.terrain] || '#2a2010';
        ctx.fill();
      }
    }
  }




  // ── Pass 2: borders + highlights ─────────────
  for (const { wq, wr, x, y, t } of visibleTiles) {
    const isFog = !t || t.terrain === 'fog';
    const isHome = t?.settlement?.isOwn;
    const isHovered = _hoveredTile && _hoveredTile.wq === wq && _hoveredTile.wr === wr;
    const isSelFog = _selectedFogTile && _selectedFogTile.wx === wq && _selectedFogTile.wy === wr;

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

  // ── Pass 3: emoji labels ──────────────────────
  if (showEmoji) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(hexH * 0.45)}px serif`;
    for (const { x, y, t } of visibleTiles) {
      if (!t || t.terrain === 'fog' || t.settlement) continue;
      const em = TERRAIN_EMOJI_FONT[t.terrain];
      if (em) ctx.fillText(em, x + hexW / 2, y + hexH / 2);
    }
    // Settlement icon
    ctx.font = `${Math.round(hexH * 0.45)}px serif`;
    for (const { x, y, t } of visibleTiles) {
      if (!t?.settlement) continue;
      ctx.fillText('🏘', x + hexW / 2, y + hexH / 2);
    }
  }
}


function selectWorldTile(tile) {
  window._lastSelectedTile = tile;
  const title = document.getElementById('panel-title');
  const sub   = document.getElementById('panel-sub');
  const body  = document.getElementById('panel-body');
  if (!title || !sub || !body || !tile) return;

  if (tile.settlement) {
    const s = tile.settlement;
    title.textContent = s.name;
    sub.textContent = `${s.species} · ${s.tier} tier`;
    body.innerHTML = `
      <div class="info-row"><span class="info-label">Ruler</span><span class="info-val">${s.username}</span></div>
      <div class="info-row"><span class="info-label">Species</span><span class="badge badge-blue">${s.species}</span></div>
      <div class="info-row"><span class="info-label">Tier</span><span class="badge badge-amber">${s.tier}</span></div>
      ${s.isOwn ? `
        <hr class="sdivider">
        <button class="action-btn" onclick="switchTab('buildings')">🏗 Construct building</button>
        <button class="action-btn" onclick="switchTab('tier')" style="margin-top:4px">${TIER_EMOJI[s.tier]||'🏕'} Upgrade settlement tier</button>
        ${(() => {
          const hasTavern = gameData?.buildings?.some(b => b.type === 'tavern' && b.level > 0);
          const hasFishingPost = gameData?.buildings?.some(b => b.type === 'fishing_post' && b.level > 0);
          const hasHousing = gameData?.buildings?.some(b => b.type === 'starter_house' && b.level > 0);
          return (hasTavern ? '<button class="action-btn tavern-btn" onclick="visitTavern()" style="margin-top:4px">🍺 Visit the Tavern</button>' : '')
               + (hasFishingPost ? '<button class="action-btn fishing-btn" onclick="visitFishingPost()" style="margin-top:4px">🎣 Visit Fishing Post</button>' : '')
               + (hasHousing ? '<button class="action-btn housing-btn" onclick="openHousingModal()" style="margin-top:4px">🏡 Manage Housing</button>' : '');
        })()}
      ` : `
        <hr class="sdivider">
        <button class="btn-view-profile" onclick="viewPlayerProfile('${s.username}','${s.species}','${s.name}','${s.tier}',${tile.x},${tile.y})">👤 View Profile</button>
      `}
    `;
  } else {
    title.textContent = TERRAIN_LABELS[tile.terrain] || tile.terrain;
    sub.textContent = `(${tile.q}, ${tile.r}) · Unoccupied`;
    body.innerHTML = `
      <div class="info-row"><span class="info-label">Terrain bonus</span><span class="info-val" style="font-size:11px;">${TERRAIN_BONUSES_DISPLAY[tile.terrain] || 'None'}</span></div>
      <hr class="sdivider">
      <button class="action-btn" onclick="alert('Colonisation coming soon!')">Found outpost here</button>
    `;
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
