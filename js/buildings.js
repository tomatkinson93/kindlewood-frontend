// ── Buildings system ──

let buildingsData = [];

const RESOURCE_ICONS = { food:'🌿', timber:'🌲', stone:'⬜', metal:'🟡', wealth:'🟠' };

async function loadBuildings() {
  try {
    const res = await apiFetch('/api/buildings');
    if (!res.ok) return;
    const data = await res.json();
    buildingsData = data.buildings || [];
    renderBuildingsPanel();
  } catch(e) { console.error(e); }
}

function renderBuildingsPanel() {
  const body = document.getElementById('panel-body');
  if (!body) return;
  // Only render if buildings tab is active
  const buildTab = document.getElementById('tab-buildings');
  if (!buildTab?.classList.contains('active')) return;

  const built = buildingsData.filter(b => b.currentLevel > 0);
  const available = buildingsData.filter(b => b.currentLevel < b.maxLevel && b.requiresMet);

  let html = '';

  if (built.length) {
    html += `<div class="slabel">BUILT</div>`;
    html += built.map(b => `
      <div class="building-row">
        <span class="building-icon">${b.icon}</span>
        <div class="building-info">
          <span class="building-name">${b.label}</span>
          <span class="building-level">Lv ${b.currentLevel}/${b.maxLevel}</span>
        </div>
        ${b.currentLevel < b.maxLevel
          ? `<button class="building-upgrade-btn" onclick="buildBuilding('${b.id}')">↑</button>`
          : `<span class="building-maxed">MAX</span>`}
      </div>
    `).join('');
    html += `<hr class="sdivider">`;
  }

  html += `<div class="slabel">CONSTRUCT</div>`;
  html += available.filter(b => b.currentLevel === 0).map(b => {
    const costStr = Object.entries(b.cost)
      .map(([r,v]) => `${RESOURCE_ICONS[r]||r} ${v}`)
      .join(' ');
    return `
      <div class="building-card" onclick="showBuildingDetail('${b.id}')">
        <div class="building-card-top">
          <span class="building-icon">${b.icon}</span>
          <div class="building-card-info">
            <div class="building-name">${b.label}</div>
            <div class="building-cost">${costStr}</div>
          </div>
          <button class="btn-build" onclick="event.stopPropagation(); buildBuilding('${b.id}')">Build</button>
        </div>
        <div class="building-desc">${b.desc}</div>
      </div>
    `;
  }).join('');

  // Show locked buildings
  const locked = buildingsData.filter(b => b.currentLevel === 0 && !b.requiresMet);
  if (locked.length) {
    html += `<div class="slabel" style="margin-top:8px;">LOCKED</div>`;
    html += locked.map(b => `
      <div class="building-card locked">
        <div class="building-card-top">
          <span class="building-icon" style="opacity:.4">${b.icon}</span>
          <div class="building-card-info">
            <div class="building-name" style="opacity:.5">${b.label}</div>
            <div class="building-cost" style="color:rgba(192,221,151,.3)">Requires more buildings</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  body.innerHTML = html;
}

async function buildBuilding(id) {
  try {
    const res = await apiFetch('/api/buildings/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: id }),
    });
    const data = await res.json();
    if (!res.ok) {
      showBuildToast(data.error || 'Construction failed.', 'error');
      return;
    }
    const def = buildingsData.find(b => b.id === id);
    showBuildToast(`${def?.icon || '🏗'} ${def?.label || id} built! (Lv ${data.newLevel})`, 'success');

    // Play sound
    if (typeof pageTurnAudio !== 'undefined') { pageTurnAudio.currentTime = 0; pageTurnAudio.play().catch(()=>{}); }

    // Refresh data
    await loadBuildings();
    await refreshResources();
  } catch(e) { console.error(e); }
}

async function refreshResources() {
  try {
    const res = await apiFetch('/api/game/settlement');
    if (!res.ok) return;
    const data = await res.json();
    if (data.settlement) {
      // Update resources AND rates so topbar reflects changes
      if (typeof tickResources !== 'undefined') tickResources = { ...data.settlement.resources };
      if (typeof tickRates !== 'undefined') tickRates = { ...data.settlement.rates };
      if (typeof updateTopbarDisplay === 'function') updateTopbarDisplay();
      // Also store on gameData for consistency
      if (typeof gameData !== 'undefined' && gameData) {
        gameData.settlement.resources = { ...data.settlement.resources };
        gameData.settlement.rates = { ...data.settlement.rates };
        if (data.settlement.season) {
          if (typeof initSeasons === 'function') initSeasons(data.settlement);
        }
      }
    }
  } catch(e) { console.error('refreshResources error:', e); }
}

function showBuildToast(msg, type='success') {
  let toast = document.getElementById('build-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'build-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `build-toast ${type}`;
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ── Cheat menu ──
function openCheatMenu() {
  document.getElementById('cheat-modal').classList.add('open');
}
function closeCheatMenu() {
  document.getElementById('cheat-modal').classList.remove('open');
}

async function applyCheat(resource, amount) {
  try {
    const body = {};
    body[resource] = amount;
    const res = await apiFetch('/api/game/cheat/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      tickResources = { ...data.resources };
      updateTopbarDisplay();
      showBuildToast(`+${amount} ${resource} added ✓`, 'success');
    }
  } catch(e) { console.error(e); }
}

async function applyCheatAll(amount) {
  try {
    const res = await apiFetch('/api/game/cheat/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food: amount, timber: amount, stone: amount, metal: amount, wealth: amount }),
    });
    const data = await res.json();
    if (res.ok) {
      tickResources = { ...data.resources };
      updateTopbarDisplay();
      showBuildToast(`All resources +${amount} ✓`, 'success');
    }
  } catch(e) { console.error(e); }
}
