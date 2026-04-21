
const BUILDING_IMG_BASE = '/assets/images/buildings/';

function _buildingIcon(b, size) {
  if (b.imgFile) {
    return `<img src="${BUILDING_IMG_BASE}${b.imgFile}" alt="${b.label}" class="building-img-icon" style="width:${size}px;height:${size}px" onerror="this.style.display='none';this.nextSibling&&(this.nextSibling.style.display='')"><span style="display:none" class="building-icon-emoji">${b.icon}</span>`;
  }
  return `<span class="building-icon">${b.icon}</span>`;
}

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

  const built = buildingsData.filter(b => b.currentLevel > 0 && b.id !== 'housing');
  const available = buildingsData.filter(b => b.currentLevel < b.maxLevel && b.requiresMet && b.id !== 'housing');

  let html = '';

  if (built.length) {
    html += `<div class="slabel">BUILT</div>`;
    html += built.map(b => `
      <div class="building-row">
        ${_buildingIcon(b, 72)}
        <div class="building-info">
          <span class="building-name">${b.label}</span>
          <span class="building-level">Lv ${b.currentLevel}/${b.maxLevel}</span>
        </div>
        <div class="building-row-actions">
          <span class="building-tooltip-wrap">
            <button class="building-help-btn" tabindex="-1">?</button>
            <span class="building-tooltip">${b.desc}</span>
          </span>
          ${b.currentLevel < b.maxLevel
            ? `<button class="building-upgrade-btn" onclick="buildBuilding('${b.id}')">↑</button>`
            : `<span class="building-maxed">MAX</span>`}
          <button class="building-remove-btn" onclick="confirmRemoveBuilding('${b.id}','${b.label}')" title="Demolish">🗑</button>
        </div>
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
          ${_buildingIcon(b, 72)}
          <div class="building-card-info">
            <div class="building-name">${b.label}</div>
            <div class="building-cost">${costStr}</div>
          </div>
          <span class="building-tooltip-wrap">
            <button class="building-help-btn" tabindex="-1" onclick="event.stopPropagation()">?</button>
            <span class="building-tooltip tooltip-left">${b.desc}</span>
          </span>
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
          <div style="opacity:0.4">${_buildingIcon(b, 72)}</div>
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

    // Update gameData.buildings so Visit Tavern button appears without re-login
    if (typeof gameData !== 'undefined' && gameData) {
      const existing = gameData.buildings?.find(b => b.type === id);
      if (existing) {
        existing.currentLevel = data.newLevel;
        existing.level = data.newLevel;
      } else {
        if (!gameData.buildings) gameData.buildings = [];
        gameData.buildings.push({ type: id, level: data.newLevel, currentLevel: data.newLevel });
      }
    }

    // Refresh sidebar panel so Visit Tavern button appears immediately
    if (typeof selectWorldTile === 'function' && window._lastSelectedTile) {
      selectWorldTile(window._lastSelectedTile);
    }

    // Special celebration for first Tavern build
    if (id === 'tavern' && data.newLevel === 1) {
      showTavernCelebration();
    }
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
async function confirmRemoveBuilding(id, label) {
  if (!confirm(`Demolish ${label}? This cannot be undone and you will not get resources back.`)) return;
  await removeBuilding(id);
}

async function removeBuilding(id) {
  try {
    const res = await apiFetch('/api/buildings/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: id }),
    });
    const data = await res.json();
    if (res.ok) {
      showBuildToast(`Building demolished.`, 'success');
      await loadBuildings();
      // Refresh gameData buildings
      if (gameData?.buildings) {
        const idx = gameData.buildings.findIndex(b => b.type === id);
        if (idx !== -1) gameData.buildings[idx].currentLevel = 0;
      }
    } else {
      showBuildToast(data.error || 'Failed to demolish.', 'error');
    }
  } catch(e) { console.error(e); showBuildToast('Error demolishing building.', 'error'); }
}

async function cheatAddCitizen() {
  try {
    const res = await apiFetch('/api/game/cheat/citizen', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showBuildToast(`Citizen ${data.name} joined! ✓`, 'success');
      if (typeof loadCitizens === 'function') loadCitizens();
    } else {
      showBuildToast(data.error || 'Failed to add citizen.', 'error');
    }
  } catch(e) { console.error(e); }
}

function openCheatMenu() {
  document.getElementById('cheat-modal').classList.add('open');
  _populateCheatCitizenDropdowns();
}
function closeCheatMenu() {
  document.getElementById('cheat-modal').classList.remove('open');
}

function _populateCheatCitizenDropdowns() {
  const citizens = (typeof citizensData !== 'undefined' ? citizensData : [])
    .filter(c => c.life_stage !== 'child');
  ['cheat-rel-a', 'cheat-rel-b'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">— ${id === 'cheat-rel-a' ? 'Citizen A' : 'Citizen B'} —</option>` +
      citizens.map(c => `<option value="${c.id}" ${c.id == current ? 'selected' : ''}>${c.name} (${c.gender[0].toUpperCase()})</option>`).join('');
  });
}

async function cheatSimulateEvent(eventType) {
  try {
    const res = await apiFetch('/api/game/cheat/simulate-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType }),
    });
    const data = await res.json();
    if (res.ok) {
      showBuildToast('Event: ' + data.message, 'success');
      if (typeof loadEvents === 'function') loadEvents();
      if (typeof loadCitizens === 'function') loadCitizens();
    } else {
      showBuildToast(data.error || 'Failed.', 'error');
    }
  } catch(e) {
    showBuildToast('Error simulating event.', 'error');
  }
}

async function cheatSetRelationship() {
  const aId = parseInt(document.getElementById('cheat-rel-a')?.value);
  const bId = parseInt(document.getElementById('cheat-rel-b')?.value);
  const score = parseInt(document.getElementById('cheat-rel-score')?.value ?? 50);
  const feedback = document.getElementById('cheat-rel-feedback');

  if (!aId || !bId) {
    if (feedback) feedback.textContent = '⚠ Select both citizens.';
    return;
  }
  if (aId === bId) {
    if (feedback) feedback.textContent = '⚠ Pick two different citizens.';
    return;
  }
  try {
    const res = await apiFetch('/api/game/cheat/relationship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_a_id: aId, citizen_b_id: bId, score }),
    });
    const data = await res.json();
    if (res.ok) {
      if (feedback) feedback.textContent = `✓ Set to ${score} (${data.state})`;
      setTimeout(() => { if (feedback) feedback.textContent = ''; }, 3000);
    } else {
      if (feedback) feedback.textContent = '⚠ ' + (data.error || 'Failed.');
    }
  } catch(e) {
    if (feedback) feedback.textContent = '⚠ Error.';
  }
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
