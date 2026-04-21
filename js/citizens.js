// ── Citizens system ──

let citizensData = [];
let selectedCitizenId = null;

const ROLE_ICONS = {
  farmer: '🌾', woodcutter: '🪓', fisher: '🎣', miner: '⛏',
  crafter: '🔨', scout: '🗺', soldier: '⚔️', idle: '💤',
  tavernkeep: '🍺',
};
const TRAIT_ICONS = {
  strong:'💪', quick:'⚡', hardy:'🛡', genius:'🧠', charming:'✨',
  frail:'🩹', clumsy:'🌀', slow_learner:'🐢', night_worker:'🌙',
  greedy:'🍖', loyal:'❤️', wanderer:'🗺',
};
const TRAIT_LABELS = {
  strong:'Strong', quick:'Quick', hardy:'Hardy', genius:'Genius', charming:'Charming',
  frail:'Frail', clumsy:'Clumsy', slow_learner:'Slow Learner', night_worker:'Night Worker',
  greedy:'Greedy', loyal:'Loyal', wanderer:'Wanderer',
};
const STAT_LABELS = {
  strength:'Strength', agility:'Agility', endurance:'Endurance',
  intelligence:'Intelligence', charisma:'Charisma',
};
const SKILL_LABELS = {
  farming:'Farming', woodcutting:'Woodcutting', fishing:'Fishing',
  mining:'Mining', crafting:'Crafting', scouting:'Scouting', combat:'Combat',
};

function getAvailableRoles() {
  const base = ['farmer','woodcutter','fisher','miner','crafter','scout','soldier','idle'];
  const hasTavern = gameData?.buildings?.some(b => b.type === 'tavern' && (b.currentLevel > 0 || b.level > 0));
  if (hasTavern) base.push('tavernkeep');
  return base;
}
const VALID_ROLES = ['farmer','woodcutter','fisher','miner','crafter','scout','soldier','idle','tavernkeep'];

// ── Species icon helper (shared with housing) ──
function _citizenSpeciesIcon(size) {
  const species = (gameData?.species || 'Mice').toLowerCase();
  return `<img src="/assets/images/species/${species}.png" alt="${species}" class="citizen-species-icon" style="width:${size}px;height:${size}px" onerror="this.style.display='none'">`;
}
function _genderIcon(gender) {
  return gender === 'female'
    ? '<span class="citizen-gender-icon female" title="Female">♀</span>'
    : '<span class="citizen-gender-icon male" title="Male">♂</span>';
}

// ── Load & render ──────────────────────────────

async function loadCitizens() {
  try {
    const res = await apiFetch('/api/citizens');
    if (!res.ok) return;
    const data = await res.json();
    citizensData = data.citizens || [];
    renderCitizensList();
  } catch(e) { console.error(e); }
}

function renderCitizensList() {
  const panel = document.getElementById('citizens-list');
  if (!panel) return;
  if (!citizensData.length) {
    panel.innerHTML = '<div class="citizens-empty">No citizens yet.</div>';
    return;
  }
  const countEl = document.getElementById('citizens-count');
  if (countEl) countEl.textContent = `${citizensData.length} citizen${citizensData.length !== 1 ? 's' : ''}`;

  panel.innerHTML = citizensData.map(c => {
    const isScouting = !!c.expedition;
    const roleDisplay = isScouting ? 'Scouting' : (c.role.charAt(0).toUpperCase() + c.role.slice(1));
    const roleIcon = isScouting ? '🗺' : (ROLE_ICONS[c.role] || '💤');
    const isChild = c.life_stage === 'child';
    const health = c.life?.health ?? 100;
    const energy = c.life?.energy ?? 80;
    const happiness = c.life?.happiness ?? 70;
    const healthColor = health > 60 ? '#7ecf6e' : health > 30 ? '#e8c76a' : '#e87a6a';
    const energyColor = energy > 60 ? '#80c8e0' : energy > 30 ? '#e8c76a' : '#e87a6a';
    const partnerSym = c.partner_id ? ' 💕' : '';
    const species = (gameData?.species || 'Mice').toLowerCase();
    const genderSym = c.gender === 'female' ? '♀' : '♂';
    const genderColor = c.gender === 'female' ? '#e090c0' : '#70a8e0';
    const housed = c.house_id ? '🏡' : '🚶';

    return `
      <div class="citizen-row-full ${isScouting ? 'is-scouting' : ''}"
           id="citizen-row-${c.id}"
           onclick="openCitizenProfile(${c.id})">
        <div class="crf-avatar">
          <img src="/assets/images/species/${species}.png" class="crf-species-icon" alt="${species}" onerror="this.style.display='none'">
          <span class="crf-gender" style="color:${genderColor}">${genderSym}</span>
        </div>
        <div class="crf-info">
          <div class="crf-name">${c.name}</div>
          <div class="crf-meta">${isChild ? '🍼 Child' : roleIcon + ' ' + roleDisplay} · ${c.life?.age ?? '?'}y${partnerSym}</div>
        </div>
        <div class="crf-bars">
          <div class="crf-bar-row" title="Health ${health}%">
            <span class="crf-bar-label">❤️</span>
            <div class="crf-bar-track"><div class="crf-bar-fill" style="width:${health}%;background:${healthColor}"></div></div>
          </div>
          <div class="crf-bar-row" title="Energy ${energy}%">
            <span class="crf-bar-label">⚡</span>
            <div class="crf-bar-track"><div class="crf-bar-fill" style="width:${energy}%;background:${energyColor}"></div></div>
          </div>
          <div class="crf-bar-row" title="Happiness ${happiness}%">
            <span class="crf-bar-label">😊</span>
            <div class="crf-bar-track"><div class="crf-bar-fill" style="width:${happiness}%;background:#a0c8e0"></div></div>
          </div>
        </div>
        <div class="crf-housed" title="${c.house_id ? 'Housed' : 'Unhoused'}">${housed}</div>
      </div>
    `;
  }).join('');
}

// ── Citizen Profile Modal ─────────────────────

function openCitizenProfile(id) {
  selectedCitizenId = id;
  const c = citizensData.find(c => c.id === id);
  if (!c) return;

  const modal = document.getElementById('citizen-profile-modal');
  if (!modal) return;
  modal.classList.add('open');
  renderCitizenProfile(c);
  // Load relationships after render
  setTimeout(() => loadCitizenRelationships(id), 100);
}

function closeCitizenProfile() {
  const modal = document.getElementById('citizen-profile-modal');
  if (modal) modal.classList.remove('open');
  selectedCitizenId = null;
}

function renderCitizenProfile(c) {
  const body = document.getElementById('citizen-profile-body');
  if (!body) return;

  const species = (gameData?.species || 'Mice').toLowerCase();
  const genderSym = c.gender === 'female' ? '♀' : '♂';
  const genderColor = c.gender === 'female' ? '#e090c0' : '#70a8e0';
  const isScouting = !!c.expedition;

  // Partner display
  let partnerHtml = '';
  if (c.partner_id) {
    const partner = citizensData.find(p => p.id === c.partner_id);
    partnerHtml = partner
      ? `<div class="cp-partner">💕 Partnered with <strong>${partner.name}</strong></div>`
      : `<div class="cp-partner">💕 Has a partner</div>`;
  }

  // Parents display
  let parentsHtml = '';
  const parentIds = c.parent_ids || [];
  if (parentIds.length >= 2) {
    const pa = citizensData.find(p => p.id === parentIds[0]);
    const pb = citizensData.find(p => p.id === parentIds[1]);
    if (pa || pb) {
      parentsHtml = `<div class="cp-parents">👨‍👩‍👧 Born to: ${[pa?.name, pb?.name].filter(Boolean).join(' & ')}</div>`;
    }
  }

  // Housing status
  let housingHtml = '';
  const houses = (typeof _housingData !== 'undefined') ? _housingData.houses : [];
  if (c.house_id) {
    const house = houses.find(h => h.id === c.house_id);
    housingHtml = `<div class="cp-housing housed">🏡 Lives in <strong>${house?.name || 'a Willow Hut'}</strong></div>`;
  } else {
    const hasHousing = gameData?.buildings?.some(b => b.type === 'starter_house' && b.level > 0);
    housingHtml = hasHousing
      ? `<div class="cp-housing unhoused">🚶 Unhoused — <button class="cp-housing-btn" onclick="closeCitizenProfile(); openHousingModal()">Manage Housing</button></div>`
      : `<div class="cp-housing unhoused">🚶 Unhoused — <button class="cp-housing-btn" onclick="closeCitizenProfile(); switchTab('buildings')">Build a Willow Hut</button></div>`;
  }

  // Traits
  const visibleTraits = (c.visible_traits || []);
  const traitsHtml = visibleTraits.length
    ? visibleTraits.map(t => `
        <div class="cp-trait">
          <span class="cp-trait-icon">${TRAIT_ICONS[t] || '✦'}</span>
          <div>
            <div class="cp-trait-name">${TRAIT_LABELS[t] || t}</div>
          </div>
        </div>`).join('')
    : '<div class="cp-no-traits">No notable traits yet.</div>';

  // Stats bars
  const statBar = (k, v, max=20) => `
    <div class="cp-stat-row">
      <span class="cp-stat-label">${STAT_LABELS[k] || k}</span>
      <div class="cp-stat-track"><div class="cp-stat-fill" style="width:${(v/max)*100}%"></div></div>
      <span class="cp-stat-val">${v}</span>
    </div>`;

  // Skill bars — colour intensity by value
  const skillBar = (k, v) => {
    const pct = (v / 10) * 100;
    const color = v >= 8 ? '#e8c76a' : v >= 5 ? '#7ecf9e' : '#5090b0';
    return `
      <div class="cp-stat-row">
        <span class="cp-stat-label">${SKILL_LABELS[k] || k}</span>
        <div class="cp-stat-track"><div class="cp-stat-fill skill" style="width:${pct}%;background:${color}"></div></div>
        <span class="cp-stat-val">${v}</span>
      </div>`;
  };

  // Role selector
  const roleOptions = getAvailableRoles().map(r =>
    `<option value="${r}" ${c.role===r?'selected':''}>${ROLE_ICONS[r]||'?'} ${r.charAt(0).toUpperCase()+r.slice(1)}</option>`
  ).join('');

  const health = c.life?.health ?? 100;
  const happiness = c.life?.happiness ?? 70;
  const healthColor = health > 60 ? '#7ecf6e' : health > 30 ? '#e8c76a' : '#e87a6a';

  body.innerHTML = `
    <div class="cp-header">
      <div class="cp-avatar-wrap">
        <img src="/assets/images/species/${species}.png" class="cp-species-icon" alt="${species}" onerror="this.style.display='none'">
        <span class="cp-gender-badge" style="color:${genderColor}">${genderSym}</span>
      </div>
      <div class="cp-header-info">
        <div class="cp-name">${c.name}</div>
        <div class="cp-meta">Gen ${c.generation} · Age ${c.life?.age ?? '?'} · ${c.gender.charAt(0).toUpperCase()+c.gender.slice(1)}${c.life_stage === 'child' ? ' · <span style="color:#f0c080">Child</span>' : ''}</div>
        ${partnerHtml}
        ${parentsHtml}
        ${housingHtml}
      </div>
    </div>

    <div class="cp-condition-row">
      <div class="cp-cond-pill" style="--col:${healthColor}">
        <span>❤️</span><span>${health}%</span><span class="cp-cond-lbl">Health</span>
      </div>
      <div class="cp-cond-pill" style="--col:#a0c8e0">
        <span>😊</span><span>${happiness}%</span><span class="cp-cond-lbl">Happy</span>
      </div>
      <div class="cp-cond-pill" style="--col:#c8a060">
        <span>🍖</span><span>${c.life?.hunger??'?'}%</span><span class="cp-cond-lbl">Hunger</span>
      </div>
      <div class="cp-cond-pill" style="--col:#80c0a0">
        <span>⚡</span><span>${c.life?.energy??'?'}%</span><span class="cp-cond-lbl">Energy</span>
      </div>
    </div>

    <div class="cp-role-section">
      <div class="cp-section-label">Role</div>
      ${isScouting ? `
        <div class="cp-scouting-note">🗺 On expedition — returns in <strong>${formatDuration(Math.max(0, Math.ceil((new Date(c.expedition.completes_at) - Date.now()) / 1000)))}</strong></div>
      ` : `
        <select class="cp-role-select" onchange="updateCitizenRoleFromProfile(${c.id}, this.value)">
          ${roleOptions}
        </select>
      `}
    </div>

    <div class="cp-tabs">
      <button class="cp-tab active" onclick="cpSwitchTab(this,'cp-tab-overview')">📊 Stats</button>
      <button class="cp-tab" onclick="cpSwitchTab(this,'cp-tab-traits')">✦ Traits</button>
      <button class="cp-tab" onclick="cpSwitchTab(this,'cp-tab-rels')">💛 Relationships</button>
    </div>

    <div class="cp-tab-panel" id="cp-tab-overview">
      <div class="cp-two-col">
        <div class="cp-col">
          <div class="cp-section-label">Core Stats</div>
          ${Object.entries(c.stats||{}).map(([k,v])=>statBar(k,v)).join('')}
        </div>
        <div class="cp-col">
          <div class="cp-section-label">Skills</div>
          ${Object.entries(c.skills||{}).map(([k,v])=>skillBar(k,v)).join('')}
        </div>
      </div>
    </div>

    <div class="cp-tab-panel" id="cp-tab-traits" style="display:none">
      <div class="cp-section-label">Known Traits</div>
      <div class="cp-traits-grid">${traitsHtml || '<div class="cp-no-traits">No notable traits yet.</div>'}</div>
      <div class="cp-section-label" style="margin-top:14px">Hidden Traits</div>
      <div class="cp-hidden-note">Some traits only reveal themselves through lived experience…</div>
    </div>

    <div class="cp-tab-panel" id="cp-tab-rels" style="display:none">
      <div id="cp-rel-list" class="cp-rel-list-full"><div class="cp-rel-loading">Loading…</div></div>
    </div>
  `;
}

// ── Role update (from profile modal) ──────────

function cpSwitchTab(btn, panelId) {
  // Deactivate all tabs/panels within the modal
  const modal = document.getElementById('citizen-profile-body');
  modal?.querySelectorAll('.cp-tab').forEach(t => t.classList.remove('active'));
  modal?.querySelectorAll('.cp-tab-panel').forEach(p => p.style.display = 'none');
  btn.classList.add('active');
  const panel = document.getElementById(panelId);
  if (panel) panel.style.display = '';
}

async function updateCitizenRoleFromProfile(id, role) {
  await updateCitizenRole(id, role);
  // Re-render the modal with updated data
  const c = citizensData.find(c => c.id === id);
  if (c) renderCitizenProfile(c);
}

async function updateCitizenRole(id, role) {
  const c = citizensData.find(c => c.id === id);
  if (c) c.role = role;

  const row = document.getElementById(`citizen-row-${id}`);
  if (row) {
    row.classList.add('role-changed');
    setTimeout(() => row.classList.remove('role-changed'), 600);
  }

  if (typeof pageTurnAudio !== 'undefined') {
    pageTurnAudio.currentTime = 0;
    pageTurnAudio.play().catch(()=>{});
  }

  renderCitizensList();

  try {
    await apiFetch(`/api/citizens/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (typeof refreshResources === 'function') await refreshResources();
  } catch(e) { console.error(e); }
}

// ── Tab switching ──

function showCitizensPanel() {
  document.getElementById('panel-map-view').style.display = 'none';
  document.getElementById('panel-citizens-view').style.display = 'flex';
  loadCitizens();
}

function showMapPanel() {
  document.getElementById('panel-citizens-view').style.display = 'none';
  document.getElementById('panel-map-view').style.display = 'flex';
}

// ── View All Citizens modal ──

function openAllCitizens() {
  const modal = document.getElementById('all-citizens-modal');
  modal.classList.add('open');
  renderAllCitizens('name', 'asc', '');
}

function closeAllCitizens() {
  document.getElementById('all-citizens-modal').classList.remove('open');
}

let allCitizensSortKey = 'name';
let allCitizensSortDir = 'asc';
let allCitizensFilter = '';

function renderAllCitizens(sortKey, sortDir, filter) {
  allCitizensSortKey = sortKey || allCitizensSortKey;
  allCitizensSortDir = sortDir || allCitizensSortDir;
  allCitizensFilter  = filter !== undefined ? filter : allCitizensFilter;

  let list = [...citizensData];

  if (allCitizensFilter) {
    const f = allCitizensFilter.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(f) || c.role.toLowerCase().includes(f));
  }

  list.sort((a, b) => {
    let av, bv;
    if (allCitizensSortKey === 'name')   { av = a.name; bv = b.name; }
    else if (allCitizensSortKey === 'age')    { av = a.life?.age??0; bv = b.life?.age??0; }
    else if (allCitizensSortKey === 'role')   { av = a.role; bv = b.role; }
    else if (allCitizensSortKey === 'health') { av = a.life?.health??0; bv = b.life?.health??0; }
    else if (STAT_LABELS[allCitizensSortKey]) { av = a.stats?.[allCitizensSortKey]??0; bv = b.stats?.[allCitizensSortKey]??0; }
    else if (SKILL_LABELS[allCitizensSortKey]){ av = a.skills?.[allCitizensSortKey]??0; bv = b.skills?.[allCitizensSortKey]??0; }
    else { av = 0; bv = 0; }
    if (av < bv) return allCitizensSortDir === 'asc' ? -1 : 1;
    if (av > bv) return allCitizensSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('all-citizens-tbody');
  if (!tbody) return;

  tbody.innerHTML = list.map(c => {
    const traits = (c.visible_traits||[]).map(t=>`<span title="${TRAIT_LABELS[t]||t}">${TRAIT_ICONS[t]||'✦'}</span>`).join('');
    const health = c.life?.health??100;
    const hc = health>60?'#4CAF50':health>30?'#FF9800':'#F44336';
    const roleOptions = getAvailableRoles().map(r=>
      `<option value="${r}" ${c.role===r?'selected':''}>${ROLE_ICONS[r]||'?'} ${r}</option>`
    ).join('');
    return `
      <tr class="ac-row" id="ac-row-${c.id}" onclick="openCitizenProfile(${c.id})" style="cursor:pointer">
        <td class="ac-name">${c.name}</td>
        <td class="ac-meta">${c.gender[0].toUpperCase()} · ${c.life?.age??'?'}y</td>
        <td>
          <select class="ac-role-select" onchange="updateCitizenRole(${c.id}, this.value); rerenderAcRow(${c.id})" onclick="event.stopPropagation()">
            ${roleOptions}
          </select>
        </td>
        <td class="ac-stat">${c.stats?.strength??'-'}</td>
        <td class="ac-stat">${c.stats?.agility??'-'}</td>
        <td class="ac-stat">${c.stats?.endurance??'-'}</td>
        <td class="ac-stat">${c.stats?.intelligence??'-'}</td>
        <td class="ac-stat">${c.stats?.charisma??'-'}</td>
        <td class="ac-stat" style="color:${hc}">${health}%</td>
        <td class="ac-traits">${traits}</td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('.ac-sort-btn').forEach(btn => {
    btn.classList.remove('active-asc','active-desc');
    if (btn.dataset.sort === allCitizensSortKey) {
      btn.classList.add(allCitizensSortDir === 'asc' ? 'active-asc' : 'active-desc');
    }
  });
}

function acSort(key) {
  if (allCitizensSortKey === key) {
    allCitizensSortDir = allCitizensSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    allCitizensSortKey = key;
    allCitizensSortDir = key === 'name' || key === 'role' ? 'asc' : 'desc';
  }
  renderAllCitizens();
}

function rerenderAcRow(id) {
  if (typeof refreshResources === 'function') {
    setTimeout(() => refreshResources(), 200);
  }
}

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAllCitizens();
    closeCitizenProfile();
  }
});
