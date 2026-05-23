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


// ════════════════════════════════════════════
//  LOADING SCREEN
// ════════════════════════════════════════════
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