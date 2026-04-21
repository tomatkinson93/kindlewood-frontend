// ══════════════════════════════════════════════
//  HOUSING SYSTEM — Kindlewood
// ══════════════════════════════════════════════

let _housingData = { houses: [], unhoused: [], species: 'Mice' };

// Species icon path helper — 24×24px pixel art icons
// Files expected at: /assets/images/species/{species_lower}.png
function _speciesIcon(species) {
  const s = (species || 'Mice').toLowerCase();
  return `<img src="/assets/images/species/${s}.png" alt="${species}" class="housing-species-icon" title="${species}" onerror="this.style.display='none'">`;
}

// Gender symbol
function _genderSymbol(gender) {
  return gender === 'female' ? '<span class="housing-gender female" title="Female">♀</span>'
                             : '<span class="housing-gender male"   title="Male">♂</span>';
}

// ── Open modal ────────────────────────────────

async function openHousingModal() {
  const modal = document.getElementById('housing-modal');
  if (!modal) return;
  modal.classList.add('open');
  _renderHousingLoading();
  await _loadHousing();
}

function closeHousingModal() {
  const modal = document.getElementById('housing-modal');
  if (modal) modal.classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeHousingModal();
});

// ── Load data ─────────────────────────────────

async function _loadHousing() {
  try {
    const res = await apiFetch('/api/housing');
    if (!res.ok) throw new Error('Failed');
    _housingData = await res.json();
    _renderHousingModal();
  } catch (e) {
    const body = document.getElementById('housing-modal-body');
    if (body) body.innerHTML = '<div class="housing-error">⚠️ Could not load housing data.</div>';
  }
}

// ── Build a new hut from within the modal ────────────────────────────────────

async function _buildHutFromModal() {
  const btn = document.getElementById('housing-build-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
  try {
    const res = await apiFetch('/api/buildings/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: 'starter_house' }),
    });
    const data = await res.json();
    if (!res.ok) {
      _housingToast(data.error || 'Could not build.', 'error');
    } else {
      // Update local gameData so the settlement panel button stays visible
      if (typeof gameData !== 'undefined' && gameData?.buildings) {
        const existing = gameData.buildings.find(b => b.type === 'starter_house');
        if (existing) { existing.level = data.newLevel; existing.currentLevel = data.newLevel; }
        else gameData.buildings.push({ type: 'starter_house', level: 1, currentLevel: 1 });
      }
      _housingToast('🏡 Willow Hut built!', 'success');
      await _loadHousing();
      return;
    }
  } catch (e) {
    _housingToast('Build failed.', 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '+ Build Willow Hut'; }
}

// ── Render ────────────────────────────────────

function _renderHousingLoading() {
  const body = document.getElementById('housing-modal-body');
  if (body) body.innerHTML = '<div class="housing-loading">Loading…</div>';
}

function _renderHousingModal() {
  const body = document.getElementById('housing-modal-body');
  if (!body) return;

  const { houses, unhoused, species } = _housingData;

  // Cost display for build button
  const costHtml = '🌲 40 · ⬜ 20';
  const buildBtnHtml = `
    <div class="housing-build-bar">
      <div class="housing-build-cost">${costHtml}</div>
      <button class="housing-add-btn" id="housing-build-btn" onclick="_buildHutFromModal()">+ Build Willow Hut</button>
    </div>`;

  if (!houses.length) {
    body.innerHTML = `
      <div class="housing-empty">
        <div class="housing-empty-icon">🏡</div>
        <div class="housing-empty-text">No homes built yet.</div>
        <div class="housing-empty-sub">Build a <strong>Willow Hut</strong> to house your citizens.</div>
        ${buildBtnHtml}
      </div>`;
    return;
  }

  const total = houses.length;
  const housed = houses.reduce((n, h) => n + h.residents.length, 0);

  const housesHtml = houses.map(h => _renderHouseCard(h, species)).join('');
  const unhousedHtml = unhoused.length
    ? `<div class="housing-section-label">🚶 Unhoused <span class="housing-count-badge">${unhoused.length}</span></div>
       <div class="housing-unhoused-list">
         ${unhoused.map(c => `
           <div class="housing-unhoused-row">
             ${_speciesIcon(species)}
             ${_genderSymbol(c.gender)}
             <span class="housing-citizen-name">${c.name}</span>
             <span class="housing-citizen-role">${c.role}</span>
             <select class="housing-assign-select" onchange="assignCitizen(${c.id}, this.value); this.value=''">
               <option value="">Assign to…</option>
               ${houses.filter(h => h.residents.length < h.capacity).map(h =>
                 `<option value="${h.id}">${h.name} (${h.residents.length}/${h.capacity})</option>`
               ).join('')}
             </select>
           </div>`).join('')}
       </div>`
    : `<div class="housing-all-housed">✓ All citizens are housed</div>`;

  body.innerHTML = `
    <div class="housing-summary">
      <span>🏡 ${total} home${total !== 1 ? 's' : ''}</span>
      <span>👥 ${housed} housed</span>
      <span class="${unhoused.length ? 'housing-unhoused-count' : ''}">🚶 ${unhoused.length} unhoused</span>
    </div>
    ${buildBtnHtml}
    <div class="housing-section-label" style="margin-top:12px">🏡 Houses <span class="housing-count-badge">${total}</span></div>
    <div class="housing-houses-list">${housesHtml}</div>
    <hr class="housing-divider">
    ${unhousedHtml}
  `;
}

function _renderHouseCard(h, species) {
  const occupancy = h.residents.length;
  const isFull = occupancy >= h.capacity;
  const statusColor = isFull ? '#c08040' : '#70b860';

  const residentsHtml = h.residents.length
    ? h.residents.map(r => `
        <div class="housing-resident-row">
          ${_speciesIcon(species)}
          ${_genderSymbol(r.gender)}
          <span class="housing-citizen-name">${r.name}</span>
          <span class="housing-citizen-role">${r.role}</span>
          <button class="housing-evict-btn" onclick="unassignCitizen(${r.id})" title="Remove from house">✕</button>
        </div>`).join('')
    : `<div class="housing-resident-empty">Empty</div>`;

  return `
    <div class="housing-house-card">
      <div class="housing-house-header">
        <div class="housing-house-name-wrap">
          <span class="housing-house-icon">🏡</span>
          <span class="housing-house-name" id="hname-${h.id}" onclick="editHouseName(${h.id})">${h.name}</span>
          <button class="housing-rename-btn" onclick="editHouseName(${h.id})" title="Rename">✏️</button>
        </div>
        <span class="housing-house-capacity" style="color:${statusColor}">${occupancy}/${h.capacity}</span>
      </div>
      <div class="housing-residents">${residentsHtml}</div>
    </div>`;
}

// ── Actions ───────────────────────────────────

async function assignCitizen(citizenId, houseId) {
  if (!houseId) return;
  try {
    const res = await apiFetch('/api/housing/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: citizenId, house_id: parseInt(houseId) }),
    });
    const data = await res.json();
    if (!res.ok) { _housingToast(data.error || 'Failed to assign.', 'error'); return; }
    await _loadHousing();
    _housingToast('Citizen housed! 🏡', 'success');
  } catch (e) { _housingToast('Error assigning citizen.', 'error'); }
}

async function unassignCitizen(citizenId) {
  try {
    const res = await apiFetch('/api/housing/unassign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: citizenId }),
    });
    const data = await res.json();
    if (!res.ok) { _housingToast(data.error || 'Failed to remove.', 'error'); return; }
    await _loadHousing();
    _housingToast('Citizen unhoused.', 'success');
  } catch (e) { _housingToast('Error removing citizen.', 'error'); }
}

function editHouseName(houseId) {
  const nameEl = document.getElementById(`hname-${houseId}`);
  if (!nameEl) return;
  const current = nameEl.textContent.trim();
  nameEl.outerHTML = `<input class="housing-rename-input" id="hname-input-${houseId}"
    value="${current}" maxlength="40"
    onblur="saveHouseName(${houseId})"
    onkeydown="if(event.key==='Enter') saveHouseName(${houseId}); if(event.key==='Escape') _loadHousing();"
    autofocus>`;
  const input = document.getElementById(`hname-input-${houseId}`);
  if (input) { input.focus(); input.select(); }
}

async function saveHouseName(houseId) {
  const input = document.getElementById(`hname-input-${houseId}`);
  if (!input) return;
  const name = input.value.trim();
  if (!name) { await _loadHousing(); return; }
  try {
    const res = await apiFetch(`/api/housing/${houseId}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { await _loadHousing(); return; }
    const h = _housingData.houses.find(h => h.id === houseId);
    if (h) h.name = name;
    _renderHousingModal();
  } catch (e) { await _loadHousing(); }
}

// ── Toast ─────────────────────────────────────

function _housingToast(msg, type = 'success') {
  let t = document.getElementById('housing-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'housing-toast';
    document.getElementById('housing-modal')?.appendChild(t);
  }
  t.textContent = msg;
  t.className = `housing-toast ${type}`;
  t.style.opacity = '1';
  clearTimeout(t._to);
  t._to = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}
