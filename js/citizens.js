// ── Citizens system ──

let citizensData = [];
let selectedCitizenId = null;

const ROLE_ICONS = {
  farmer: '🌾', woodcutter: '🪓', fisher: '🎣', miner: '⛏',
  crafter: '🔨', scout: '🗺', soldier: '⚔️', idle: '💤',
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
const VALID_ROLES = ['farmer','woodcutter','fisher','miner','crafter','scout','soldier','idle'];

// ── Load & render compact list ──

async function loadCitizens() {
  try {
    const res = await apiFetch('/api/citizens');
    if (!res.ok) return;
    const data = await res.json();
    citizensData = data.citizens || [];
    renderCitizensList();
    if (selectedCitizenId) {
      const c = citizensData.find(c => c.id === selectedCitizenId);
      if (c) renderCitizenDetail(c);
    }
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
    const roleDisplay = isScouting ? 'scouting...' : c.role;
    const icon = isScouting ? '🗺' : (ROLE_ICONS[c.role] || '💤');
    return `
      <div class="citizen-row ${selectedCitizenId === c.id ? 'selected' : ''} ${isScouting ? 'is-scouting' : ''}"
           id="citizen-row-${c.id}"
           onclick="selectCitizen(${c.id})">
        <span class="citizen-row-roleicon" title="${roleDisplay}">${icon}</span>
        <div class="citizen-row-info">
          <div class="citizen-row-name">${c.name}</div>
          <div class="citizen-row-meta">${roleDisplay} · ${c.life?.age ?? '?'}y</div>
        </div>
      </div>
    `;
  }).join('');
}

async function selectCitizen(id) {
  selectedCitizenId = id;
  renderCitizensList();
  const c = citizensData.find(c => c.id === id);
  if (c) renderCitizenDetail(c);
}

function renderCitizenDetail(c) {
  const panel = document.getElementById('citizen-detail');
  if (!panel) return;

  const traits = (c.visible_traits || []).map(t =>
    `<span class="citizen-trait-pill" title="${TRAIT_LABELS[t]||t}">${TRAIT_ICONS[t]||'✦'} ${TRAIT_LABELS[t]||t}</span>`
  ).join('');

  const statBar = (k, v, max=20) => `
    <div class="cstat-row">
      <span class="cstat-label">${STAT_LABELS[k]||k}</span>
      <div class="cstat-bar-wrap"><div class="cstat-bar" style="width:${(v/max)*100}%"></div></div>
      <span class="cstat-val">${v}</span>
    </div>`;

  const skillBar = (k, v) => `
    <div class="cstat-row">
      <span class="cstat-label">${SKILL_LABELS[k]||k}</span>
      <div class="cstat-bar-wrap"><div class="cstat-bar skill-bar" style="width:${(v/10)*100}%"></div></div>
      <span class="cstat-val">${v}</span>
    </div>`;

  const isScouting = !!c.expedition;
  const roleOptions = VALID_ROLES.map(r =>
    `<option value="${r}" ${c.role===r?'selected':''}>${ROLE_ICONS[r]} ${r}</option>`
  ).join('');

  const health = c.life?.health ?? 100;
  const healthColor = health > 60 ? '#4CAF50' : health > 30 ? '#FF9800' : '#F44336';

  panel.innerHTML = `
    <div class="cd-header">
      <div class="cd-name">${c.name}</div>
      <div class="cd-meta">${c.gender} · gen ${c.generation} · age ${c.life?.age ?? '?'}</div>
      ${traits ? `<div class="cd-traits">${traits}</div>` : ''}
    </div>

    <div class="cd-section">
      <div class="cd-section-label">Role</div>
      ${isScouting ? `
        <div class="scouting-status">
          <div class="scouting-status-icon">🗺</div>
          <div class="scouting-status-info">
            <div class="scouting-status-title">On expedition</div>
            <div class="scouting-status-dest">Heading to (${c.expedition.target_x}, ${c.expedition.target_y})</div>
            <div class="scouting-status-eta">Returns: <span id="cd-exp-eta">${formatDuration(Math.max(0, Math.ceil((new Date(c.expedition.completes_at) - Date.now()) / 1000)))}</span></div>
          </div>
        </div>
        <div class="scouting-locked-note">Cannot reassign while scouting</div>
      ` : `
        <select class="citizen-role-select" onchange="updateCitizenRole(${c.id}, this.value)">
          ${roleOptions}
        </select>
      `}
    </div>

    <div class="cd-section">
      <div class="cd-section-label">Core Stats</div>
      ${Object.entries(c.stats||{}).map(([k,v])=>statBar(k,v)).join('')}
    </div>

    <div class="cd-section">
      <div class="cd-section-label">Skills</div>
      ${Object.entries(c.skills||{}).map(([k,v])=>skillBar(k,v)).join('')}
    </div>

    <div class="cd-section">
      <div class="cd-section-label">Condition</div>
      <div class="cd-condition-grid">
        <div class="cd-cond"><span class="cd-cond-key">Age</span><span class="cd-cond-val">${c.life?.age??'?'}y</span></div>
        <div class="cd-cond"><span class="cd-cond-key">Health</span><span class="cd-cond-val" style="color:${healthColor}">${health}%</span></div>
        <div class="cd-cond"><span class="cd-cond-key">Happiness</span><span class="cd-cond-val">${c.life?.happiness??'?'}%</span></div>
        <div class="cd-cond"><span class="cd-cond-key">Hunger</span><span class="cd-cond-val">${c.life?.hunger??'?'}%</span></div>
        <div class="cd-cond"><span class="cd-cond-key">Energy</span><span class="cd-cond-val">${c.life?.energy??'?'}%</span></div>
      </div>
    </div>

    <div class="cd-section">
      <div class="cd-section-label">Hidden Traits</div>
      <div class="cd-hidden-note">Some traits reveal themselves only through lived experience...</div>
    </div>
  `;
}

// ── Role update with feedback ──

async function updateCitizenRole(id, role) {
  // Update local data immediately before any async calls
  const c = citizensData.find(c => c.id === id);
  const previousRole = c?.role;
  if (c) c.role = role;

  // Flash feedback on sidebar row
  const row = document.getElementById(`citizen-row-${id}`);
  if (row) {
    row.classList.add('role-changed');
    setTimeout(() => row.classList.remove('role-changed'), 600);
  }

  // Sound
  if (typeof pageTurnAudio !== 'undefined') {
    pageTurnAudio.currentTime = 0;
    pageTurnAudio.play().catch(()=>{});
  }

  // Re-render sidebar list (not the full-screen table)
  renderCitizensList();

  // Send to server
  try {
    await apiFetch(`/api/citizens/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    // Refresh rates after role change
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
  allCitizensFilter  = filter  !== undefined ? filter : allCitizensFilter;

  let list = [...citizensData];

  // Filter
  if (allCitizensFilter) {
    const f = allCitizensFilter.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(f) || c.role.toLowerCase().includes(f)
    );
  }

  // Sort
  list.sort((a, b) => {
    let av, bv;
    if (allCitizensSortKey === 'name') { av = a.name; bv = b.name; }
    else if (allCitizensSortKey === 'age') { av = a.life?.age??0; bv = b.life?.age??0; }
    else if (allCitizensSortKey === 'role') { av = a.role; bv = b.role; }
    else if (allCitizensSortKey === 'health') { av = a.life?.health??0; bv = b.life?.health??0; }
    else if (STAT_LABELS[allCitizensSortKey]) { av = a.stats?.[allCitizensSortKey]??0; bv = b.stats?.[allCitizensSortKey]??0; }
    else if (SKILL_LABELS[allCitizensSortKey]) { av = a.skills?.[allCitizensSortKey]??0; bv = b.skills?.[allCitizensSortKey]??0; }
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
    const roleOptions = VALID_ROLES.map(r=>
      `<option value="${r}" ${c.role===r?'selected':''}>${r}</option>`
    ).join('');
    return `
      <tr class="ac-row" id="ac-row-${c.id}">
        <td class="ac-name">${c.name}</td>
        <td class="ac-meta">${c.gender[0].toUpperCase()} · ${c.life?.age??'?'}y</td>
        <td>
          <select class="ac-role-select" onchange="updateCitizenRole(${c.id}, this.value); rerenderAcRow(${c.id})">
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

  // Update sort indicators
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
  // Don't re-render - local data already updated by updateCitizenRole
  // Just refresh rates
  if (typeof refreshResources === 'function') {
    setTimeout(() => refreshResources(), 200);
  }
}

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllCitizens();
});
