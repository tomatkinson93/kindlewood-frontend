const TERRAIN_EMOJI = {
  plains:'🌿', forest:'🌲', hills:'⛰', river:'🌊',
  ruins:'🏚', mountain:'🗻', marsh:'🌾', fog:'',
};
const TERRAIN_COLOR = {
  plains:'#3D3820', forest:'#2a3d1a', hills:'#4a4035',
  river:'#1a3d35', ruins:'#3d3530', mountain:'#2a2a2a',
  marsh:'#2d3d20', fog:'#1a1a1a',
};
const TERRAIN_NARRATIVE = {
  plains:   { icon:'🌿', label:'Open Plains',    flavor:'Wide fields stretch before you. Food and growth come easily here.' },
  forest:   { icon:'🌲', label:'Dense Forest',   flavor:'Ancient trees surround you. Timber will never be scarce.' },
  hills:    { icon:'⛰',  label:'Rocky Hills',    flavor:'The high ground offers stone, ore, and a clear view of all approaches.' },
  river:    { icon:'🌊', label:'Riverside',       flavor:'Fresh water draws traders from afar. Wealth will flow like the current.' },
  ruins:    { icon:'🏚', label:'Ancient Ruins',  flavor:'Old stones hide old secrets — and sometimes, old treasure.' },
  mountain: { icon:'🗻', label:'Mountain Base',  flavor:'Rich in ore and stone. A fortress could stand here for centuries.' },
  marsh:    { icon:'🌾', label:'Misty Marshland', flavor:'Muddy ground, but game and herbs are plentiful in the mist.' },
};

let spawnData = null;
let selectedTile = null;
let rerollsRemaining = 1;

async function startPlacementFlow() {
  showPlacementScreen();
  await loadSpawn();
}

function showPlacementScreen() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-placement').classList.add('active');
}

async function loadSpawn() {
  document.getElementById('placement-loading').style.display = 'flex';
  document.getElementById('placement-map-wrap').style.display = 'none';
  document.getElementById('placement-suggestions').style.display = 'none';
  selectedTile = null;
  updatePlacementPanel(null);

  try {
    const res = await apiFetch('/api/map/spawn');
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not generate spawn area.');
      return;
    }
    spawnData = data;
    rerollsRemaining = data.rerollsRemaining;
    renderPlacementMap(data);
    renderSuggestions(data.suggested);
    document.getElementById('placement-loading').style.display = 'none';
    document.getElementById('placement-map-wrap').style.display = 'block';
    document.getElementById('placement-suggestions').style.display = 'block';
    document.getElementById('reroll-btn').style.display = rerollsRemaining > 0 ? 'inline-flex' : 'none';
    document.getElementById('reroll-btn').textContent = `Scout another area (${rerollsRemaining} left)`;
  } catch (e) {
    console.error(e);
  }
}

function renderPlacementMap(data) {
  const grid = document.getElementById('placement-grid');
  grid.innerHTML = '';

  const xs = data.localTiles.map(t => t.x);
  const ys = data.localTiles.map(t => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;

  grid.style.gridTemplateColumns = `repeat(${cols}, 36px)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 36px)`;

  const tileMap = {};
  data.localTiles.forEach(t => { tileMap[`${t.x},${t.y}`] = t; });
  const suggestedSet = new Set(data.suggested.map(t => `${t.x},${t.y}`));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = tileMap[`${x},${y}`];
      const div = document.createElement('div');
      div.className = 'ptile';
      if (t) {
        div.style.background = TERRAIN_COLOR[t.terrain] || '#222';
        div.textContent = TERRAIN_EMOJI[t.terrain] || '';
        if (suggestedSet.has(`${x},${y}`)) div.classList.add('suggested');
        if (t.occupied) div.classList.add('occupied');
        else {
          div.onclick = () => selectPlacementTile(t);
        }
        div.title = t.terrain;
      } else {
        div.style.background = '#111';
      }
      grid.appendChild(div);
    }
  }
}

function selectPlacementTile(tile) {
  selectedTile = tile;
  document.querySelectorAll('.ptile').forEach(el => el.classList.remove('selected-tile'));
  const allTiles = document.querySelectorAll('.ptile');
  // Find and highlight
  renderPlacementMap(spawnData);
  // Re-find after re-render
  const grid = document.getElementById('placement-grid');
  const xs = spawnData.localTiles.map(t => t.x);
  const ys = spawnData.localTiles.map(t => t.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const cols = maxX - minX + 1;
  const idx = (tile.y - minY) * cols + (tile.x - minX);
  if (grid.children[idx]) grid.children[idx].classList.add('selected-tile');
  updatePlacementPanel(tile);
}

function updatePlacementPanel(tile) {
  const panel = document.getElementById('placement-panel');
  const confirmBtn = document.getElementById('placement-confirm');
  if (!tile) {
    panel.innerHTML = '<div class="placement-hint">Click a tile to preview it</div>';
    confirmBtn.disabled = true;
    return;
  }
  const info = TERRAIN_NARRATIVE[tile.terrain] || { icon:'?', label: tile.terrain, flavor: '' };
  const b = tile.bonus || {};
  const bonusLines = Object.entries(b)
    .filter(([k,v]) => ['food','timber','stone','metal','wealth'].includes(k) && v > 0)
    .map(([k,v]) => `<div class="bonus-row"><span class="bonus-key">${k}</span><span class="bonus-val">+${v}/hr</span></div>`)
    .join('');
  panel.innerHTML = `
    <div class="ptile-name">${info.icon} ${info.label}</div>
    <div class="ptile-flavor">${info.flavor}</div>
    <div class="ptile-bonuses">${bonusLines}</div>
    <div class="ptile-coords">(${tile.x}, ${tile.y})</div>
  `;
  confirmBtn.disabled = false;
}

function renderSuggestions(suggested) {
  const wrap = document.getElementById('suggestion-tiles');
  wrap.innerHTML = '';
  suggested.forEach(t => {
    const info = TERRAIN_NARRATIVE[t.terrain] || { icon:'?', label: t.terrain, flavor: '' };
    const div = document.createElement('div');
    div.className = 'suggestion-card';
    div.innerHTML = `
      <div class="sug-icon">${info.icon}</div>
      <div class="sug-label">${info.label}</div>
      <div class="sug-flavor">${info.flavor}</div>
    `;
    div.onclick = () => selectPlacementTile(t);
    wrap.appendChild(div);
  });
}

async function confirmPlacement() {
  if (!selectedTile) return;
  const btn = document.getElementById('placement-confirm');
  btn.disabled = true;
  btn.textContent = 'Establishing...';

  try {
    const res = await apiFetch('/api/map/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: selectedTile.x, y: selectedTile.y }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Placement failed.');
      btn.disabled = false;
      btn.textContent = 'Establish settlement here';
      return;
    }
    await loadGame();
  } catch (e) {
    console.error(e);
  }
}

async function rerollSpawn() {
  if (rerollsRemaining <= 0) return;
  await loadSpawn();
}
