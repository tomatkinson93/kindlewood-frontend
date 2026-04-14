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

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  const target = document.getElementById('screen-' + id);
  if (!target) {
    console.error('showScreen: target screen not found:', 'screen-' + id);
    return;
  }

  target.classList.add('active');

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
    console.log('gameData loaded, tile_x:', gameData?.settlement?.tile_x);

    const needsPlacement =
      gameData?.settlement?.tile_x === null ||
      gameData?.settlement?.tile_x === undefined;

    if (needsPlacement) {
      console.log('loadGame -> showing ARRIVAL screen');
      showArrivalScreen(gameData.settlement.name);
      _loadGameLock = false;
      return;
    }

    console.log('loadGame -> showing GAME screen');
    showScreen('game');
    renderTopbar();
    renderMap();
    initGuardArt();
    if (typeof initProfileDisplay === 'function') initProfileDisplay(gameData.username, gameData.species);
    setTimeout(selectHomeTile2, 800);
    startResourceTick(gameData.settlement.resources, gameData.settlement.rates);
    loadBuildings();
    loadExpeditions();
    startExpeditionPoll();
    initSeasons(gameData.settlement);
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
const TILE_SIZES = [48, 36, 26];
const GAP = 0;
let zoomLevel = 1;
let camera = { x: 20, y: 20 };

function TILE_PX() { return TILE_SIZES[zoomLevel]; }

const MAP_FRAME_W = 1110;
const MAP_FRAME_H = 610;

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
  const zoom = document.getElementById('map-zoom');
  const grid = document.getElementById('map-grid');
  const fog = document.querySelector('.fog-texture');
  if (!zoom || !grid) return;

  const vw = VIEW_W();
  const vh = VIEW_H();
  const tpx = TILE_PX();

  const totalWidth = vw * tpx;
  const totalHeight = vh * tpx;

  zoom.style.left = '50%';
  zoom.style.top = '50%';
  zoom.style.width = totalWidth + 'px';
  zoom.style.height = totalHeight + 'px';
  zoom.style.transform = 'translate(-50%, -50%)';

  grid.style.width = totalWidth + 'px';
  grid.style.height = totalHeight + 'px';
  grid.style.left = '0';
  grid.style.top = '0';
  grid.style.transform = 'none';

  if (fog) {
    fog.style.width = totalWidth + 'px';
    fog.style.height = totalHeight + 'px';
  }
}
function setZoom(delta) {
  zoomLevel = Math.max(0, Math.min(TILE_SIZES.length - 1, zoomLevel + delta));
  if (worldMapData) renderWorldMap(worldMapData);

  document.getElementById('zoom-in')?.toggleAttribute('disabled', zoomLevel === 0);
  document.getElementById('zoom-out')?.toggleAttribute('disabled', zoomLevel === TILE_SIZES.length - 1);
}

function centreCamera() {
  if (worldMapData?.playerSettlement) {
    camera.x = worldMapData.playerSettlement.x;
    camera.y = worldMapData.playerSettlement.y;
    renderWorldMap(worldMapData);
  }
}

function panCamera(dx, dy) {
  camera.x += dx;
  camera.y += dy;
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

function _initMapDrag() {
  const zoom = document.getElementById('map-zoom');
  if (!zoom || zoom._dragInit) return;
  zoom._dragInit = true;

  // Scroll wheel zoom
  zoom.addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  zoom.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _drag = {
      startX: e.clientX,
      startY: e.clientY,
      camX: camera.x,
      camY: camera.y
    };
    zoom.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!_drag) return;

    const TILE_SIZE = TILE_PX() + GAP;
    const dx = Math.round((_drag.startX - e.clientX) / TILE_SIZE);
    const dy = Math.round((_drag.startY - e.clientY) / TILE_SIZE);

    camera.x = _drag.camX + dx;
    camera.y = _drag.camY + dy;

    if (worldMapData) renderWorldMap(worldMapData);
  });

  window.addEventListener('mouseup', () => {
    if (!_drag) return;
    _drag = null;
    const zoom = document.getElementById('map-zoom');
    if (zoom) zoom.style.cursor = 'grab';
  });

  zoom.style.cursor = 'grab';
}

async function loadWorldMap() {
  try {
    const res = await apiFetch('/api/map/world');
    if (!res.ok) return;
    const data = await res.json();
    worldMapData = data;
    if (data.playerSettlement) {
      camera.x = data.playerSettlement.x;
      camera.y = data.playerSettlement.y;
    }
    renderWorldMap(data);
    _initMapDrag();
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

function renderWorldMap(data) {
  const grid = document.getElementById('map-grid');
  if (!grid || !data || !data.tiles) return;

  const size = data.mapSize || 40;
  const vw = VIEW_W(), vh = VIEW_H(), tpx = TILE_PX();
  const halfW = Math.floor(vw / 2);
  const halfH = Math.floor(vh / 2);
  const startX = camera.x - halfW;
  const startY = camera.y - halfH;

  const tileMap = {};
  data.tiles.forEach(t => { tileMap[`${t.x},${t.y}`] = t; });

  grid.style.gridTemplateColumns = `repeat(${vw}, ${tpx}px)`;
  grid.style.gridTemplateRows = `repeat(${vh}, ${tpx}px)`;
  grid.style.gap = `${GAP}px`;

  const frame = document.getElementById('map-frame');
  if (frame) {
    frame.style.width = MAP_FRAME_W + 'px';
    frame.style.height = MAP_FRAME_H + 'px';
  }

  applyGridTransform();
  grid.innerHTML = '';

  for (let row = 0; row < vh; row++) {
    for (let col = 0; col < vw; col++) {
      const x = startX + col;
      const y = startY + row;
      const wx = ((x % size) + size) % size;
      const wy = ((y % size) + size) % size;
      const t = tileMap[`${wx},${wy}`];

      const div = document.createElement('div');
      div.className = 'tile';
      div.style.width = tpx + 'px';
      div.style.height = tpx + 'px';
      div.style.fontSize = Math.round(tpx * 0.44) + 'px';

      if (!t || t.terrain === 'fog') {
        div.classList.add('tile-fog');
        div.dataset.wx = wx;
        div.dataset.wy = wy;
        div.onclick = () => selectFogTile(wx, wy);
        div.title = 'Unexplored — click to send a scout';

        if (_selectedFogTile && _selectedFogTile.wx === wx && _selectedFogTile.wy === wy) {
          div.classList.add('selected-fog');
        }

        grid.appendChild(div);
        continue;
      }

      if (t.settlement?.isOwn) div.classList.add('home');

      div.style.background = t.settlement ? '#1a2e4a' : (WORLD_BG[t.terrain] || '#222');
      div.style.position = 'relative';
      div.style.zIndex = '4';
      div.textContent = t.settlement ? '🏘' : (tpx >= 24 ? (WORLD_EMOJI[t.terrain] || '') : '');
      div.onclick = () => selectWorldTile(t);

      if (t.settlement) {
        div.title = `${t.settlement.name} (${t.settlement.username})`;
      }

      grid.appendChild(div);
    }
  }
}


function selectWorldTile(tile) {
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
      ` : `
        <hr class="sdivider">
        <button class="btn-view-profile" onclick="viewPlayerProfile('${s.username}','${s.species}','${s.name}','${s.tier}',${tile.x},${tile.y})">👤 View Profile</button>
      `}
    `;
  } else {
    title.textContent = TERRAIN_LABELS[tile.terrain] || tile.terrain;
    sub.textContent = `(${tile.x}, ${tile.y}) · Unoccupied`;
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
