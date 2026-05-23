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
  options.headers = options.headers || {};
  if (token) options.headers['Authorization'] = 'Bearer ' + token;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  return fetch(path, options);
}

// ─── Game state ─────────────────────────────────────────────────────────────
let gameData       = null;
let mapTiles       = [];
let selectedTile   = null;
let armyPanelOpen  = false;
let currentScreen  = 'landing';
let musicStarted   = false;
let mapScrollX     = 0;
let mapScrollY     = 0;
let mapZoom        = 1;

// ─── SCREENS ─────────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  currentScreen = name;

  if (name === 'landing')  renderLanding();
  if (name === 'lore')     renderLore();
  if (name === 'register') renderRegister();
  if (name === 'login')    renderLogin();
  if (name === 'game')     renderGame();
  if (name === 'profile')  renderProfile();
  if (name === 'settings') openSettings();

  // Update nav
  const navProfile = document.getElementById('nav-profile');
  const navLinks   = document.getElementById('nav-links');
  if (gameData) {
    if (navProfile) navProfile.style.display = 'flex';
    if (navLinks)   navLinks.style.display   = 'none';
  } else {
    if (navProfile) navProfile.style.display = 'none';
    if (navLinks)   navLinks.style.display   = 'flex';
  }
}

// ─── NAV DROPDOWN ─────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const dd = document.getElementById('nav-dropdown');
  const av = document.getElementById('profile-avatar-mini');
  if (!dd) return;
  if (av && av.contains(e.target)) {
    dd.classList.toggle('open');
  } else if (!dd.contains(e.target)) {
    dd.classList.remove('open');
  }
});

// ─── LANDING ─────────────────────────────────────────────────────────────────
function renderLanding() {
  const el = document.getElementById('screen-landing');
  if (!el) return;

  el.innerHTML = `
    <div class="hero">
      <div class="hero-content">
        <h1 class="hero-title">
          <img src="/assets/logo.png" alt="Kindlewood" class="hero-logo">
          Kindlewood
        </h1>
        <p class="hero-tagline">Rise of the Woodland Realms</p>
        <p class="hero-sub">
          Build your settlement. Command your forces.<br>
          Forge alliances. Shape the wilderness.
        </p>
        <div class="hero-cta">
          <button class="btn-primary" onclick="showScreen('register')">🌿 Begin Your Journey</button>
          <button class="btn-secondary" onclick="showScreen('login')">Sign In</button>
        </div>
      </div>
    </div>

    <section class="features">
      <div class="feature-card">
        <div class="feature-icon">🏡</div>
        <div class="feature-title">Settle the Wild</div>
        <div class="feature-desc">Claim a corner of the ancient forest and build your first home among the roots and branches.</div>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚔️</div>
        <div class="feature-title">Command Forces</div>
        <div class="feature-desc">Train woodland warriors and lead them across a living hex map to defend or expand your realm.</div>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🌲</div>
        <div class="feature-title">A Living World</div>
        <div class="feature-desc">Every grove, ruin, and river crossing tells a story. Explore, discover, and carve your legend.</div>
      </div>
    </section>

    <section class="species-carousel" id="species-carousel">
      <h2 class="carousel-title">Choose Your Kind</h2>
      <div class="carousel-track" id="carousel-track"></div>
      <button class="carousel-prev" onclick="carouselPrev()">&#8592;</button>
      <button class="carousel-next" onclick="carouselNext()">&#8594;</button>
    </section>
  `;

  loadCarousel();
}

// ─── CAROUSEL ────────────────────────────────────────────────────────────────
const SPECIES_LIST = [
  {
    id:'fox', name:'Fox', role:'Scout & Trickster',
    art:'/assets/species/fox.png',
    flavor:'Quick and cunning, foxes slip through shadows where others stumble.',
    stats:{ Agility:5, Cunning:5, Strength:2, Endurance:2, Lore:2 },
    lore:'Foxes have wandered the Kindlewood since before the first settlement was named. Their paws know every hidden path, their ears catch whispers the wind carries from distant camps.'
  },
  {
    id:'badger', name:'Badger', role:'Builder & Defender',
    art:'/assets/species/badger.png',
    flavor:'Stubborn as stone. Badgers build to last.',
    stats:{ Agility:1, Cunning:2, Strength:5, Endurance:6, Lore:2 },
    lore:'No wall stands straighter than one raised by badger hands. They dig deep, build wide, and never yield ground they have claimed as home.'
  },
  {
    id:'owl', name:'Owl', role:'Sage & Arcanist',
    art:'/assets/species/owl.png',
    flavor:'They see in darkness what others miss in daylight.',
    stats:{ Agility:2, Cunning:4, Strength:1, Endurance:2, Lore:7 },
    lore:'Owls keep the old records. They remember the names of rivers before they were named, and the shapes of stars before maps were drawn.'
  },
  {
    id:'rabbit', name:'Rabbit', role:'Farmer & Diplomat',
    art:'/assets/species/rabbit.png',
    flavor:'Soft-spoken, swift-footed, and surprisingly resourceful.',
    stats:{ Agility:4, Cunning:3, Strength:2, Endurance:4, Lore:3 },
    lore:'Rabbit settlements are always the warmest. Their granaries never run short, and their councils rarely raise their voices — but when they do, the whole wood listens.'
  },
  {
    id:'bear', name:'Bear', role:'Warchief & Protector',
    art:'/assets/species/bear.png',
    flavor:'Where a bear stands, the line holds.',
    stats:{ Agility:1, Cunning:2, Strength:7, Endurance:5, Lore:1 },
    lore:'Bears do not start wars. But they end them. Their settlements are fortresses, their guards unmovable, and their loyalty absolute — to those who earn it.'
  },
  {
    id:'otter', name:'Otter', role:'Trader & Navigator',
    art:'/assets/species/otter.png',
    flavor:'If it floats or trades, the otter knows its value.',
    stats:{ Agility:4, Cunning:5, Strength:2, Endurance:3, Lore:2 },
    lore:'Otter merchants chart the river roads others fear to travel. Their rafts carry goods from every corner of the Kindlewood, and their taverns host deals that shape the realm.'
  },
];

let carouselIndex = 0;

function loadCarousel() {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  track.innerHTML = '';
  SPECIES_LIST.forEach((sp, i) => {
    const card = document.createElement('div');
    card.className = 'carousel-card';
    card.dataset.index = i;
    card.innerHTML = `
      <img class="carousel-img" src="${sp.art}" alt="${sp.name}" onerror="this.src='/assets/logo.png'">
      <div class="carousel-name">${sp.name}</div>
      <div class="carousel-role">${sp.role}</div>
    `;
    card.onclick = () => openSpeciesModal(sp);
    track.appendChild(card);
  });
  updateCarousel();
}

function updateCarousel() {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  const cards = track.querySelectorAll('.carousel-card');
  const cardW = 180 + 16;
  const offset = -(carouselIndex * cardW) + (track.parentElement.offsetWidth / 2) - 90;
  track.style.transform = `translateX(${offset}px)`;
  cards.forEach((c, i) => {
    c.classList.toggle('active', i === carouselIndex);
  });
}

function carouselNext() {
  carouselIndex = (carouselIndex + 1) % SPECIES_LIST.length;
  updateCarousel();
}
function carouselPrev() {
  carouselIndex = (carouselIndex - 1 + SPECIES_LIST.length) % SPECIES_LIST.length;
  updateCarousel();
}

// ─── SPECIES MODAL ─────────────────────────────────────────────────────────────
function openSpeciesModal(sp) {
  document.getElementById('modal-art').src     = sp.art;
  document.getElementById('modal-name').textContent   = sp.name;
  document.getElementById('modal-role').textContent   = sp.role;
  document.getElementById('modal-flavor').textContent = sp.flavor;
  document.getElementById('modal-lore').textContent   = sp.lore;
  document.getElementById('modal-stats').innerHTML = Object.entries(sp.stats)
    .map(([k,v]) => `<span class="stat-chip">${k} <b>${v}</b></span>`).join('');
  document.getElementById('modal-backdrop').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modal-backdrop').style.display = 'none';
}

// ─── LORE ────────────────────────────────────────────────────────────────────
function renderLore() {
  const el = document.getElementById('screen-lore');
  if (!el) return;
  el.innerHTML = `
    <div class="lore-page">
      <h1 class="lore-title">The World of Kindlewood</h1>
      <div class="lore-section">
        <h2>The Ancient Forest</h2>
        <p>Long before settlements bore names, the Kindlewood stretched from horizon to horizon — a vast, breathing world of old-growth timber, winding rivers, and forgotten ruins half-swallowed by moss.</p>
        <p>No single ruler has ever held it all. The wood resists dominion. It rewards patience, cunning, and care.</p>
      </div>
      <div class="lore-section">
        <h2>The Six Peoples</h2>
        <p>Six species share the woodland realm, each with their own traditions, strengths, and ways of reading the land. Foxes ghost through shadows. Badgers dig foundations that last centuries. Owls guard knowledge others forget. Rabbits feed the world. Bears hold the line. Otters move the trade that ties it all together.</p>
      </div>
      <div class="lore-section">
        <h2>Your Realm Awaits</h2>
        <p>You arrive at the edge of the wood with a name, a species, and a claim. What you build here — and what you defend — is yours to decide.</p>
        <button class="btn-primary" onclick="showScreen('register')">🌿 Begin Your Story</button>
      </div>
    </div>
  `;
}

// ─── REGISTER ──────────────────────────────────────────────────────────────────
function renderRegister() {
  const el = document.getElementById('screen-register');
  if (!el) return;
  el.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-title">🌿 Begin Your Journey</div>
        <div class="auth-sub">Create your account to enter the Kindlewood</div>
        <div id="reg-error" class="auth-error"></div>
        <div class="auth-field">
          <label>Username</label>
          <input id="reg-username" type="text" placeholder="e.g. Thornpaw" maxlength="20"
                 onkeydown="if(event.key==='Enter')doRegister()">
        </div>
        <div class="auth-field">
          <label>Email</label>
          <input id="reg-email" type="email" placeholder="your@email.com"
                 onkeydown="if(event.key==='Enter')doRegister()">
        </div>
        <div class="auth-field">
          <label>Password</label>
          <input id="reg-password" type="password" placeholder="Choose a strong password"
                 onkeydown="if(event.key==='Enter')doRegister()">
        </div>
        <div class="auth-field">
          <label>Species</label>
          <select id="reg-species">
            ${SPECIES_LIST.map(s => `<option value="${s.id}">${s.name} — ${s.role}</option>`).join('')}
          </select>
        </div>
        <button class="btn-primary" onclick="doRegister()">Create Account</button>
        <div class="auth-switch">Already have an account? <a onclick="showScreen('login')">Sign In</a></div>
      </div>
    </div>
  `;
}

async function doRegister() {
  const username = document.getElementById('reg-username')?.value.trim();
  const email    = document.getElementById('reg-email')?.value.trim();
  const password = document.getElementById('reg-password')?.value;
  const species  = document.getElementById('reg-species')?.value;
  const errEl    = document.getElementById('reg-error');

  if (!username || !email || !password || !species) {
    if (errEl) errEl.textContent = 'All fields are required.';
    return;
  }

  try {
    const res = await apiFetch('/api/register', {
      method: 'POST',
      body: { username, email, password, species }
    });
    const data = await res.json();
    if (!res.ok) { if (errEl) errEl.textContent = data.error || 'Registration failed.'; return; }
    setStoredToken(data.token);
    gameData = data.player;
    updateNavProfile();
    showNamingModal();
  } catch(e) {
    if (errEl) errEl.textContent = 'Network error. Please try again.';
  }
}

// ─── NAMING MODAL ─────────────────────────────────────────────────────────────
function showNamingModal() {
  const bd = document.getElementById('naming-backdrop');
  if (bd) bd.style.display = 'flex';
  const inp = document.getElementById('naming-input');
  if (inp) inp.focus();
}

function onNamingInput() {
  const val = (document.getElementById('naming-input')?.value || '').trim();
  const btn = document.getElementById('naming-confirm');
  const hint = document.getElementById('naming-hint');
  if (btn) btn.disabled = val.length < 2;
  if (hint) {
    if (val.length === 0) hint.textContent = '';
    else if (val.length < 2) hint.textContent = 'A settlement name must have at least 2 characters.';
    else hint.textContent = `Your settlement will be known as "${val}".`;
  }
}

async function confirmNaming() {
  const name = (document.getElementById('naming-input')?.value || '').trim();
  if (name.length < 2) return;
  try {
    const res = await apiFetch('/api/settlement/name', {
      method: 'POST',
      body: { name }
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Could not save name.', 'error'); return; }
    if (gameData) gameData.settlement = data.settlement;
    const bd = document.getElementById('naming-backdrop');
    if (bd) bd.style.display = 'none';
    showScreen('game');
  } catch(e) {
    showToast('Network error.', 'error');
  }
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────────
function renderLogin() {
  const el = document.getElementById('screen-login');
  if (!el) return;
  el.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-title">Welcome Back</div>
        <div class="auth-sub">Sign in to continue your journey</div>
        <div id="login-error" class="auth-error"></div>
        <div class="auth-field">
          <label>Email</label>
          <input id="login-email" type="email" placeholder="your@email.com"
                 onkeydown="if(event.key==='Enter')doLogin()">
        </div>
        <div class="auth-field">
          <label>Password</label>
          <input id="login-password" type="password" placeholder="Your password"
                 onkeydown="if(event.key==='Enter')doLogin()">
        </div>
        <button class="btn-primary" onclick="doLogin()">Sign In</button>
        <div class="auth-switch">New to the Kindlewood? <a onclick="showScreen('register')">Create Account</a></div>
      </div>
    </div>
  `;
}

async function doLogin() {
  const email    = document.getElementById('login-email')?.value.trim();
  const password = document.getElementById('login-password')?.value;
  const errEl    = document.getElementById('login-error');

  if (!email || !password) {
    if (errEl) errEl.textContent = 'Email and password required.';
    return;
  }

  try {
    const res = await apiFetch('/api/login', { method:'POST', body:{ email, password } });
    const data = await res.json();
    if (!res.ok) { if (errEl) errEl.textContent = data.error || 'Login failed.'; return; }
    setStoredToken(data.token);
    gameData = data.player;
    updateNavProfile();
    showScreen('game');
  } catch(e) {
    if (errEl) errEl.textContent = 'Network error.';
  }
}

async function logoutUser() {
  clearStoredToken();
  gameData = null;
  mapTiles = [];
  showScreen('landing');
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────
function renderProfile() {
  const el = document.getElementById('screen-profile');
  if (!el || !gameData) return;
  const sp = SPECIES_LIST.find(s => s.id === gameData.species) || {};
  el.innerHTML = `
    <div class="profile-page">
      <div class="profile-hero">
        <img class="profile-species-art" src="${sp.art || ''}" alt="" onerror="this.style.display='none'">
        <div class="profile-hero-info">
          <div class="profile-name">${gameData.username}</div>
          <div class="profile-species-role">${sp.name || gameData.species} — ${sp.role || ''}</div>
          <div class="profile-settlement">🏙️ ${gameData.settlement?.name || 'Unnamed Settlement'}</div>
        </div>
      </div>
      <div class="profile-stats">
        ${Object.entries(sp.stats || {}).map(([k,v]) => `
          <div class="profile-stat">
            <div class="profile-stat-label">${k}</div>
            <div class="profile-stat-bar"><div class="profile-stat-fill" style="width:${Math.min(v/7*100,100)}%"></div></div>
            <div class="profile-stat-val">${v}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── GAME / MAP ────────────────────────────────────────────────────────────────
async function renderGame() {
  const el = document.getElementById('screen-game');
  if (!el) return;

  if (!gameData) {
    // Try auto-login with stored token
    const token = getStoredToken();
    if (token) {
      try {
        const res = await apiFetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          gameData = data.player;
          updateNavProfile();
        } else {
          showScreen('login');
          return;
        }
      } catch { showScreen('login'); return; }
    } else {
      showScreen('login');
      return;
    }
  }

  el.innerHTML = `
    <div class="game-layout">
      <div class="map-wrap" id="map-wrap">
        <canvas id="map-canvas"></canvas>
      </div>
      <div class="sidebar" id="sidebar"></div>
    </div>
  `;

  await loadMap();
  renderSidebar();
  startMusicIfNeeded();
}

async function loadMap() {
  try {
    const res = await apiFetch('/api/map');
    if (!res.ok) return;
    const data = await res.json();
    mapTiles = data.tiles || [];
    renderMap();
  } catch(e) {
    console.error('Map load failed', e);
  }
}

// ─── MAP RENDERING ─────────────────────────────────────────────────────────────
const HEX_SIZE = 48;
const HEX_W    = Math.sqrt(3) * HEX_SIZE;
const HEX_H    = 2 * HEX_SIZE;

function hexToPixel(q, r) {
  const x = HEX_W * (q + r / 2);
  const y = HEX_H * (3/4) * r;
  return { x, y };
}

function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI / 180 * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(ang), y: cy + size * Math.sin(ang) });
  }
  return pts;
}

const TERRAIN_COLORS = {
  forest:    '#3a6b35',
  plains:    '#8db360',
  mountain:  '#7a6a5a',
  river:     '#4a7fa5',
  settlement:'#c8a96e',
  ruins:     '#7a6870',
  default:   '#5a7a50',
};

const TERRAIN_ICONS = {
  forest:    '🌲',
  plains:    '🌾',
  mountain:  '⛰️',
  river:     '💧',
  settlement:'🏡',
  ruins:     '🏚️',
};

function renderMap() {
  const canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  const wrap = document.getElementById('map-wrap');
  canvas.width  = wrap.offsetWidth  || 800;
  canvas.height = wrap.offsetHeight || 600;
  const ctx = canvas.getContext('2d');

  // Compute bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  mapTiles.forEach(t => {
    const { x, y } = hexToPixel(t.q, t.r);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  });
  const contentW = maxX - minX + HEX_W;
  const contentH = maxY - minY + HEX_H;
  const offX = (canvas.width  - contentW) / 2 - minX + mapScrollX;
  const offY = (canvas.height - contentH) / 2 - minY + mapScrollY;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(mapZoom, mapZoom);

  mapTiles.forEach(tile => {
    const { x, y } = hexToPixel(tile.q, tile.r);
    const corners  = hexCorners(x, y, HEX_SIZE - 2);
    const color    = TERRAIN_COLORS[tile.terrain] || TERRAIN_COLORS.default;
    const isSelected = selectedTile && selectedTile.q === tile.q && selectedTile.r === tile.r;
    const isOwned = tile.owner === gameData?.id;

    // Fill
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Stroke
    ctx.strokeStyle = isSelected ? '#f0d070' : (isOwned ? '#d4a840' : 'rgba(0,0,0,0.18)');
    ctx.lineWidth   = isSelected ? 3 : (isOwned ? 2 : 1);
    ctx.stroke();

    // Icon
    const icon = TERRAIN_ICONS[tile.terrain];
    if (icon) {
      ctx.font = `${HEX_SIZE * 0.52}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, x, y);
    }

    // Owner dot
    if (isOwned) {
      ctx.beginPath();
      ctx.arc(x, y + HEX_SIZE * 0.45, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#f0d070';
      ctx.fill();
    }
  });
  ctx.restore();

  // Click handler
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left - offX) / mapZoom;
    const my   = (e.clientY - rect.top  - offY) / mapZoom;
    let closest = null, closestDist = Infinity;
    mapTiles.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r);
      const dist = Math.hypot(mx - x, my - y);
      if (dist < closestDist) { closestDist = dist; closest = tile; }
    });
    if (closest && closestDist < HEX_SIZE * 1.1) {
      selectedTile = closest;
      renderMap();
      openTilePanel(closest);
    }
  };

  // Drag to pan
  let dragging = false, dragX = 0, dragY = 0;
  canvas.onmousedown = e => { dragging = true; dragX = e.clientX; dragY = e.clientY; };
  canvas.onmousemove = e => {
    if (!dragging) return;
    mapScrollX += e.clientX - dragX;
    mapScrollY += e.clientY - dragY;
    dragX = e.clientX; dragY = e.clientY;
    renderMap();
  };
  canvas.onmouseup = () => { dragging = false; };
  canvas.onmouseleave = () => { dragging = false; };

  // Zoom
  canvas.onwheel = e => {
    e.preventDefault();
    mapZoom = Math.max(0.4, Math.min(2.5, mapZoom - e.deltaY * 0.001));
    renderMap();
  };
}

// ─── TILE PANEL ────────────────────────────────────────────────────────────────
function openTilePanel(tile) {
  const panel = document.getElementById('tile-panel');
  const inner = document.getElementById('tile-panel-inner');
  if (!panel || !inner) return;

  const isOwnSettlement = tile.terrain === 'settlement' && tile.owner === gameData?.id;
  const isFree  = !tile.owner;
  const isEnemy = tile.owner && tile.owner !== gameData?.id;

  let html = `
    <div class="tile-terrain-badge terrain-${tile.terrain}">${TERRAIN_ICONS[tile.terrain] || ''} ${tile.terrain}</div>
    <div class="tile-coords">q ${tile.q}, r ${tile.r}</div>
  `;

  if (tile.name) html += `<div class="tile-name">${tile.name}</div>`;

  if (isOwnSettlement) {
    html += `
      <div class="sett-panel">
        <div class="sett-name">${gameData?.settlement?.name || 'Your Settlement'}</div>
        <div class="sett-resources" id="sett-resources">Loading resources…</div>
        <div class="sett-divider"></div>
        <button class="sett-action-primary" onclick="openSettlementView()">🏗 Construct Building</button>
        <button class="sett-action" onclick="openArmyPanel()">⚔️ Manage Forces</button>
        <button class="sett-action" onclick="exploreTile(${tile.q},${tile.r})">🗺️ Send Scouts</button>
      </div>
    `;
    loadSettlementResources();
  } else if (isFree) {
    html += `
      <div class="tile-actions">
        <button class="sett-action-primary" onclick="claimTile(${tile.q},${tile.r})">🌿 Claim This Land</button>
        <button class="sett-action" onclick="exploreTile(${tile.q},${tile.r})">🗺️ Explore</button>
      </div>
    `;
  } else if (isEnemy) {
    html += `
      <div class="tile-actions">
        <div style="font-size:12px;color:rgba(220,190,140,0.6);margin-bottom:10px">Held by another realm</div>
        <button class="sett-action-danger" onclick="attackTile(${tile.q},${tile.r})">⚔️ Attack</button>
      </div>
    `;
  }

  inner.innerHTML = html;
  panel.classList.add('open');
}

function closeTilePanel() {
  document.getElementById('tile-panel')?.classList.remove('open');
}

// ─── SETTLEMENT RESOURCES ─────────────────────────────────────────────────────
async function loadSettlementResources() {
  try {
    const res = await apiFetch('/api/resources');
    if (!res.ok) return;
    const data = await res.json();
    const el = document.getElementById('sett-resources');
    if (!el) return;
    const r = data.resources || {};
    el.innerHTML = Object.entries(r).map(([k,v]) =>
      `<span class="res-chip"><span class="res-icon">${resourceIcon(k)}</span><span>${v}</span></span>`
    ).join('');
  } catch(e) { console.error(e); }
}

function resourceIcon(key) {
  return { food:'🌿', timber:'🌲', stone:'🪨', metal:'⚙️', wealth:'🪙' }[key] || '📦';
}

// ─── BUILDINGS ────────────────────────────────────────────────────────────────
async function buildBuilding(buildingId) {
  try {
    const res = await apiFetch('/api/buildings/build', {
      method: 'POST',
      body: { buildingId }
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Build failed.', 'error'); return; }
    showToast(data.message || 'Construction underway!', 'success');
    loadSettlementResources();
  } catch(e) {
    showToast('Network error.', 'error');
  }
}

// ─── EXPLORE ────────────────────────────────────────────────────────────────
async function exploreTile(q, r) {
  try {
    const res = await apiFetch('/api/explore', { method:'POST', body:{ q, r } });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Explore failed.', 'error'); return; }
    if (data.encounter) {
      showEncounter(data.encounter);
    } else {
      showToast(data.message || 'Scouts return with little news.', 'info');
    }
  } catch(e) {
    showToast('Network error.', 'error');
  }
}

// ─── ENCOUNTER MODAL ─────────────────────────────────────────────────────────
function showEncounter(enc) {
  document.getElementById('encounter-title').textContent = enc.title || 'An Encounter!';
  document.getElementById('encounter-body').innerHTML  = enc.description || '';
  const acts = document.getElementById('encounter-actions');
  acts.innerHTML = (enc.choices || []).map((ch, i) =>
    `<button class="encounter-btn" onclick="resolveEncounter('${enc.id}',${i})">${ch.label}</button>`
  ).join('');
  document.getElementById('encounter-backdrop').style.display = 'flex';
}

async function resolveEncounter(encId, choiceIdx) {
  document.getElementById('encounter-backdrop').style.display = 'none';
  try {
    const res = await apiFetch('/api/encounter/resolve', { method:'POST', body:{ encId, choiceIdx } });
    const data = await res.json();
    showToast(data.message || 'Encounter resolved.', 'info');
    if (data.combat) showBattle(data.combat);
  } catch(e) {
    showToast('Network error.', 'error');
  }
}

// ─── BATTLE ──────────────────────────────────────────────────────────────────
function showBattle(combat) {
  const logEl  = document.getElementById('battle-log');
  const titleEl = document.getElementById('battle-title');
  const bodyEl  = document.getElementById('battle-body');
  const closeBtn = document.getElementById('battle-close-btn');

  titleEl.textContent = '⚔️ Battle!';
  bodyEl.innerHTML = '';
  logEl.innerHTML = (combat.log || []).map(l => `<div class="battle-log-line">${l}</div>`).join('');
  if (combat.outcome) {
    bodyEl.innerHTML = `<div class="battle-outcome battle-outcome-${combat.outcome}">${combat.outcome === 'victory' ? '🏆 Victory!' : '💀 Defeated'}</div>`;
  }
  if (closeBtn) closeBtn.style.display = 'block';
  document.getElementById('battle-backdrop').style.display = 'flex';
  playBattleSfx();
}

function closeBattleModal() {
  document.getElementById('battle-backdrop').style.display = 'none';
}

async function attackTile(q, r) {
  try {
    const res = await apiFetch('/api/attack', { method:'POST', body:{ q, r } });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Attack failed.', 'error'); return; }
    if (data.combat) showBattle(data.combat);
    else showToast(data.message || 'Attack launched.', 'info');
  } catch(e) {
    showToast('Network error.', 'error');
  }
}

async function claimTile(q, r) {
  try {
    const res = await apiFetch('/api/claim', { method:'POST', body:{ q, r } });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Claim failed.', 'error'); return; }
    showToast(data.message || 'Land claimed!', 'success');
    await loadMap();
    closeTilePanel();
  } catch(e) {
    showToast('Network error.', 'error');
  }
}

// ─── ARMY PANEL ───────────────────────────────────────────────────────────────
function openArmyPanel() {
  const panel = document.getElementById('army-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  armyPanelOpen = true;
  loadArmyPanel();
}

function closeArmyPanel() {
  const panel = document.getElementById('army-panel');
  if (panel) panel.style.display = 'none';
  armyPanelOpen = false;
}

async function loadArmyPanel() {
  const body = document.getElementById('army-panel-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:16px;color:rgba(200,180,140,0.6)">Loading forces…</div>';
  try {
    const res  = await apiFetch('/api/army');
    const data = await res.json();
    const units = data.units || [];
    if (!units.length) {
      body.innerHTML = '<div style="padding:16px;color:rgba(200,180,140,0.5);font-size:13px">No forces yet. Construct a barracks to train soldiers.</div>';
      return;
    }
    body.innerHTML = units.map(u => `
      <div class="army-unit">
        <div class="army-unit-name">${u.name}</div>
        <div class="army-unit-stats">
          <span>ATK ${u.attack}</span>
          <span>DEF ${u.defense}</span>
          <span>HP ${u.hp}</span>
        </div>
        <div class="army-unit-count">x${u.count}</div>
      </div>
    `).join('');
  } catch(e) {
    body.innerHTML = '<div style="padding:16px;color:#c04040">Failed to load forces.</div>';
  }
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb || !gameData) return;
  const sp = SPECIES_LIST.find(s => s.id === gameData.species);
  sb.innerHTML = `
    <div class="sb-profile">
      <div class="sb-avatar">${(gameData.username||'?')[0].toUpperCase()}</div>
      <div class="sb-info">
        <div class="sb-username">${gameData.username}</div>
        <div class="sb-species">${sp?.name || gameData.species}</div>
      </div>
    </div>
    <div class="sb-settlement">
      <div class="sb-sett-name">${gameData.settlement?.name || 'Your Settlement'}</div>
      <div class="sb-hint">Click your settlement tile to manage</div>
    </div>
    <div class="sb-links">
      <button class="sb-link" onclick="showScreen('profile')">👤 Profile</button>
      <button class="sb-link" onclick="showScreen('settings')">⚙️ Settings</button>
      <button class="sb-link" onclick="logoutUser()">🚪 Sign Out</button>
    </div>
  `;
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.style.display = 'flex';
    // Restore saved prefs
    const volStr = localStorage.getItem('kw_music_vol');
    const vol    = volStr !== null ? parseInt(volStr) : 50;
    const muted  = localStorage.getItem('kw_music_muted') === 'true';
    const slider = document.getElementById('settings-music-volume');
    const pct    = document.getElementById('settings-music-volume-pct');
    const toggle = document.getElementById('settings-music-toggle');
    if (slider) slider.value = vol;
    if (pct)    pct.textContent = vol + '%';
    if (toggle) toggle.checked = !muted;
    const music = document.getElementById('bg-music');
    if (music) music.volume = vol / 100;
  }
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.style.display = 'none';
  if (currentScreen !== 'settings') return;
  showScreen('game');
}

function onMusicToggle(enabled) {
  localStorage.setItem('kw_music_muted', !enabled);
  const music = document.getElementById('bg-music');
  if (!music) return;
  if (enabled) {
    music.play().catch(() => {});
  } else {
    music.pause();
  }
}

function onMusicVolume(val) {
  localStorage.setItem('kw_music_vol', val);
  const pct = document.getElementById('settings-music-volume-pct');
  if (pct) pct.textContent = val + '%';
  const music = document.getElementById('bg-music');
  if (music) music.volume = val / 100;
}

// ─── MUSIC ────────────────────────────────────────────────────────────────────
function startMusicIfNeeded() {
  if (musicStarted) return;
  const muted = localStorage.getItem('kw_music_muted') === 'true';
  if (muted) return;
  const music = document.getElementById('bg-music');
  if (!music) return;
  const vol = parseInt(localStorage.getItem('kw_music_vol') || '50');
  music.volume = vol / 100;
  music.play().then(() => { musicStarted = true; }).catch(() => {});
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}

// ─── SFX ─────────────────────────────────────────────────────────────────────
function playBattleSfx() {
  const sfx = document.getElementById('sfx-battle');
  if (sfx) { sfx.currentTime = 0; sfx.play().catch(() => {}); }
}

// ─── BOOT ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const token = getStoredToken();
  if (token) {
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        gameData = data.player;
        updateNavProfile();
        showScreen('game');
        return;
      }
    } catch {}
  }
  showScreen('landing');
});

function updateNavProfile() {
  if (!gameData) return;
  const mini = document.getElementById('profile-avatar-mini');
  const label = document.getElementById('profile-username-label');
  if (mini)  mini.textContent  = (gameData.username || '?')[0].toUpperCase();
  if (label) label.textContent = gameData.username || '—';
}
