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

// ── Right panel citizens state ────────────────
let cpanelFilter_val  = 'all';
let cpanelSearch_val  = '';
let cpanelSort_val    = 'name';
let cpanelSortDir_val = 'asc';
let cpanelView_val    = 'full'; // 'full' | 'compact'

function cpanelFilter(val, btn) {
  cpanelFilter_val = val;
  document.querySelectorAll('.cpanel-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCitizensList();
}
function cpanelSearch(val) {
  cpanelSearch_val = val;
  renderCitizensList();
}
function cpanelSort(val) {
  cpanelSort_val = val;
  renderCitizensList();
}
function cpanelToggleSortDir() {
  cpanelSortDir_val = cpanelSortDir_val === 'asc' ? 'desc' : 'asc';
  const btn = document.getElementById('cpanel-sort-dir');
  if (btn) btn.textContent = cpanelSortDir_val === 'asc' ? '↑' : '↓';
  renderCitizensList();
}
function cpanelSetView(val, btn) {
  cpanelView_val = val;
  document.querySelectorAll('.cpanel-view-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCitizensList();
}

function renderCitizensList() {
  const panel = document.getElementById('citizens-list');
  if (!panel) return;
  if (!citizensData.length) {
    panel.innerHTML = '<div class="citizens-empty">No citizens yet.</div>';
    return;
  }

  // Apply filters
  let list = [...citizensData];
  if (cpanelSearch_val) {
    const s = cpanelSearch_val.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(s));
  }
  switch (cpanelFilter_val) {
    case 'adult':     list = list.filter(c => c.life_stage !== 'child'); break;
    case 'child':     list = list.filter(c => c.life_stage === 'child'); break;
    case 'unhoused':  list = list.filter(c => !c.house_id); break;
    case 'partnered': list = list.filter(c => !!c.partner_id); break;
    case 'single':    list = list.filter(c => !c.partner_id && c.life_stage !== 'child'); break;
  }

  // Sort
  list.sort((a, b) => {
    let av, bv;
    if      (cpanelSort_val === 'name')       { av = a.name; bv = b.name; }
    else if (cpanelSort_val === 'age')         { av = a.life?.age??0; bv = b.life?.age??0; }
    else if (cpanelSort_val === 'role')        { av = a.role||''; bv = b.role||''; }
    else if (cpanelSort_val === 'happiness')   { av = a.happiness_computed??a.life?.happiness??0; bv = b.happiness_computed??b.life?.happiness??0; }
    else if (cpanelSort_val === 'health')      { av = a.life?.health??0; bv = b.life?.health??0; }
    else if (cpanelSort_val === 'generation')  { av = a.generation??0; bv = b.generation??0; }
    else { av = 0; bv = 0; }
    if (av < bv) return cpanelSortDir_val === 'asc' ? -1 : 1;
    if (av > bv) return cpanelSortDir_val === 'asc' ? 1 : -1;
    return 0;
  });

  // Update count
  const countEl = document.getElementById('citizens-count');
  if (countEl) countEl.textContent = list.length + ' / ' + citizensData.length;

  const species = (gameData?.species || 'Mice').toLowerCase();
  const compact = cpanelView_val === 'compact';

  panel.innerHTML = list.map(c => {
    const isScouting = !!c.expedition;
    const isChild    = c.life_stage === 'child';
    const health     = c.life?.health ?? 100;
    const energy     = c.life?.energy ?? 80;
    const happiness  = c.happiness_computed ?? c.life?.happiness ?? 70;
    const healthColor   = health > 60 ? '#7ecf6e' : health > 30 ? '#e8c76a' : '#e87a6a';
    const energyColor   = energy > 60 ? '#80c8e0' : energy > 30 ? '#e8c76a' : '#e87a6a';
    const happyColor    = happiness > 70 ? '#8ecf7e' : happiness > 45 ? '#e8c76a' : '#e07a6a';
    const genderSym  = c.gender === 'female' ? '♀' : '♂';
    const genderColor = c.gender === 'female' ? '#e090c0' : '#70a8e0';
    const isOnQuest  = !!c.active_quest;
    const isOnDiplo  = !!(window._diploEnvoyIds && window._diploEnvoyIds.has(c.id));
    const roleIcon   = isOnQuest ? '⚔️' : isOnDiplo ? '📨' : isScouting ? '🗺' : (isChild ? '🍼' : (ROLE_ICONS[c.role] || '💤'));
    const roleLabel  = isOnQuest ? 'On Quest' : isOnDiplo ? 'Diplomat' : isScouting ? 'Scouting' : (isChild ? 'Child' : (c.role.charAt(0).toUpperCase() + c.role.slice(1)));
    const houseIcon  = c.house_id ? '🏡' : '<span style="opacity:.35">🚶</span>';
    const partnerIcon = c.partner_id ? ' <span style="font-size:9px;color:#e090a0">💕</span>' : '';

    const isAway = isScouting || isOnQuest || isOnDiplo;
    const awayLabel = isOnQuest ? '⚔️ On Quest' : isOnDiplo ? '📨 Diplomat' : '🗺 Scouting';

    if (compact) {
      if (isAway) {
        return '<div class="crf-compact crf-away" id="citizen-row-' + c.id + '" onclick="openCitizenProfile(' + c.id + ')">'
          + '<span class="crf-compact-gender" style="color:' + genderColor + ';opacity:.5">' + genderSym + '</span>'
          + '<span class="crf-compact-name crf-away-name">' + c.name + '</span>'
          + '<span class="crf-away-badge">' + awayLabel + '</span>'
          + '</div>';
      }
      // Compact row — single line, minimal bars
      return '<div class="crf-compact" id="citizen-row-' + c.id + '" onclick="openCitizenProfile(' + c.id + ')">'
        + '<span class="crf-compact-gender" style="color:' + genderColor + '">' + genderSym + '</span>'
        + '<span class="crf-compact-name">' + c.name + partnerIcon + '</span>'
        + '<span class="crf-compact-role">' + roleIcon + '</span>'
        + '<div class="crf-compact-bars">'
        + '<div class="crf-mini-bar" style="width:' + health + '%;background:' + healthColor + '" title="Health ' + health + '%"></div>'
        + '<div class="crf-mini-bar" style="width:' + happiness + '%;background:' + happyColor + '" title="Happy ' + happiness + '%"></div>'
        + '</div>'
        + '<span class="crf-compact-house">' + houseIcon + '</span>'
        + '</div>';
    }

    // Full view — with glassy overlay for away citizens
    const fullBase = '<div class="citizen-row-full' + (isAway ? ' crf-full-away' : '') + '" id="citizen-row-' + c.id + '" onclick="openCitizenProfile(' + c.id + ')">'
      + '<div class="crf-avatar">'
      + '<img src="/assets/images/species/' + species + '.png" class="crf-species-icon" alt="' + species + '" onerror="this.remove()">'
      + '<span class="crf-gender" style="color:' + genderColor + '">' + genderSym + '</span>'
      + '</div>'
      + '<div class="crf-info">'
      + '<div class="crf-name">' + c.name + partnerIcon + '</div>'
      + '<div class="crf-meta">' + roleIcon + ' ' + roleLabel + ' · ' + (c.life?.age ?? '?') + 'y</div>'
      + '</div>'
      + '<div class="crf-bars">'
      + '<div class="crf-bar-row" title="Health ' + health + '%">'
      + '<span class="crf-bar-label">❤️</span>'
      + '<div class="crf-bar-track"><div class="crf-bar-fill" style="width:' + health + '%;background:' + healthColor + '"></div></div>'
      + '</div>'
      + '<div class="crf-bar-row" title="Happiness ' + happiness + '%">'
      + '<span class="crf-bar-label">😊</span>'
      + '<div class="crf-bar-track"><div class="crf-bar-fill" style="width:' + happiness + '%;background:' + happyColor + '"></div></div>'
      + '</div>'
      + '<div class="crf-bar-row" title="Energy ' + energy + '%">'
      + '<span class="crf-bar-label">⚡</span>'
      + '<div class="crf-bar-track"><div class="crf-bar-fill" style="width:' + energy + '%;background:' + energyColor + '"></div></div>'
      + '</div>'
      + '</div>'
      + '<div class="crf-housed">' + houseIcon + '</div>'
      + (isAway ? '<div class="crf-away-glass"><span class="crf-away-glass-label">' + awayLabel + '</span></div>' : '')
      + '</div>';
    return fullBase;
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


// ── Breeding status panel ─────────────────────
function renderFamilyStatus(bs) {
  if (!bs) return '';
  const ready    = bs.sameHouse && bs.happyOk && bs.chance > 0;
  const statusColor = ready ? '#8ecf7e' : '#e8a06a';
  const statusIcon  = ready ? '🍼' : '⏳';
  const statusLabel = ready ? 'Can have children' : 'Not ready';

  const blockerHtml = bs.blockers.length
    ? bs.blockers.map(b => `<div class="bs-blocker">⚠ ${b}</div>`).join('')
    : '';

  const chanceBar = ready
    ? `<div class="bs-chance-row">
        <span class="bs-chance-label">Chance per hour</span>
        <div class="bs-chance-track"><div class="bs-chance-fill" style="width:${Math.min(100, bs.chance * (100/35))}%"></div></div>
        <span class="bs-chance-val">${bs.chance}%</span>
       </div>
       ${bs.seasonBonus > 0 ? '<div class="bs-season-bonus">🌸 Spring bonus active (+' + bs.seasonBonus + '%)</div>' : ''}
       ${bs.seasonBonus < 0 ? '<div class="bs-season-bonus neg">❄️ Winter penalty (' + bs.seasonBonus + '%)</div>' : ''}`
    : '';

  return `
    <div class="cp-section-label" style="margin-bottom:8px">🍼 Family</div>
    <div class="bs-panel">
      <div class="bs-status-row">
        <span class="bs-status-icon">${statusIcon}</span>
        <span class="bs-status-label" style="color:${statusColor}">${statusLabel}</span>
        <span class="bs-partner-name">with ${bs.partnerName}</span>
      </div>
      ${blockerHtml}
      ${chanceBar}
    </div>`;
}

function renderChildStatus(c) {
  const age = c.life?.age ?? 0;
  const yearsLeft = Math.max(0, 16 - age);
  const pct = Math.min(100, (age / 16) * 100);
  return `
    <div class="cp-section-label" style="margin-bottom:8px">🌱 Growing Up</div>
    <div class="bs-panel">
      <div class="bs-chance-row">
        <span class="bs-chance-label">Age ${age} — adult in ${yearsLeft} year${yearsLeft !== 1 ? 's' : ''}</span>
        <div class="bs-chance-track"><div class="bs-chance-fill" style="width:${pct}%;background:#c8a060"></div></div>
        <span class="bs-chance-val">${age}/16</span>
      </div>
    </div>`;
}


// Helper: child skill bars (blurred placeholder) — avoids nested template literals
function _childSkillBarsHtml() {
  const CHILD_SKILL_WIDTHS = [45, 70, 30, 55, 65, 40, 50];
  return Object.keys(SKILL_LABELS).map((k, i) => {
    const w = CHILD_SKILL_WIDTHS[i % 7];
    return '<div class="cp-stat-row">'
      + '<span class="cp-stat-label">' + SKILL_LABELS[k] + '</span>'
      + '<div class="cp-stat-track"><div class="cp-stat-fill skill" style="width:' + w + '%;background:#5090b0"></div></div>'
      + '<span class="cp-stat-val">' + (w / 10 | 0) + '</span>'
      + '</div>';
  }).join('');
}


function _childStatsHtml(statBarBlurred) {
  return '<div class="cp-two-col">'
    + '<div class="cp-col">'
    + '<div class="cp-section-label">Potential</div>'
    + Object.keys(STAT_LABELS).map((k, i) => statBarBlurred(k, i)).join('')
    + '</div>'
    + '<div class="cp-col cp-child-skills-col">'
    + '<div class="cp-section-label">Skills</div>'
    + '<div class="cp-child-skills-veil">'
    + '<div class="cp-child-skills-blur">' + _childSkillBarsHtml() + '</div>'
    + '<div class="cp-child-skills-overlay">'
    + '<div class="cp-child-skills-icon">🌱</div>'
    + '<div class="cp-child-skills-text">Still finding their path…</div>'
    + '<div class="cp-child-skills-sub">Skills reveal at adulthood</div>'
    + '</div></div></div></div>';
}

function _adultStatsHtml(c, statBar, skillBar) {
  return '<div class="cp-two-col">'
    + '<div class="cp-col">'
    + '<div class="cp-section-label">Core Stats</div>'
    + Object.entries(c.stats || {}).map(([k, v]) => statBar(k, v)).join('')
    + '</div>'
    + '<div class="cp-col">'
    + '<div class="cp-section-label">Skills</div>'
    + Object.entries(c.skills || {}).map(([k, v]) => skillBar(k, v)).join('')
    + '</div></div>';
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

  // Blurred stat bar for children — hardcoded keys since server returns {} for children
  const CHILD_STAT_WIDTHS = [55, 40, 65, 35, 50]; // fixed widths so they don't flicker on re-render
  const STAT_KEYS = Object.keys(STAT_LABELS);
  const statBarBlurred = (k, i) => `
    <div class="cp-stat-row cp-stat-row--blurred">
      <span class="cp-stat-label">${STAT_LABELS[k] || k}</span>
      <div class="cp-stat-track"><div class="cp-stat-fill" style="width:${CHILD_STAT_WIDTHS[i%5]}%;filter:blur(3px);opacity:0.35"></div></div>
      <span class="cp-stat-val" style="filter:blur(4px);user-select:none">?</span>
    </div>`;

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
      <div class="cp-cond-pill cp-cond-pill--hoverable" id="cp-happiness-pill" style="--col:#a0c8e0;cursor:help">
        <span>😊</span><span>${c.happiness_computed ?? happiness}%</span><span class="cp-cond-lbl">Happy ▾</span>
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
      ${c.life_stage === 'child' ? `
        <div class="cp-child-labour-note">
          <span class="cp-child-labour-icon">🚫</span>
          <span>Child labour is frowned upon in <strong>${gameData?.settlement?.name || 'your settlement'}</strong>. Let them play for now.</span>
        </div>
      ` : isScouting ? `
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
      <button class="cp-tab" onclick="cpSwitchTab(this,'cp-tab-family'); loadFamilyTree(${c.id})">🌳 Family</button>
      <button class="cp-tab" onclick="cpSwitchTab(this,'cp-tab-scars'); loadCitizenScars(${c.id})">🩹 Scars</button>
    </div>

    <div class="cp-tab-panel" id="cp-tab-overview">
      ${c.breeding_status ? renderFamilyStatus(c.breeding_status) : ''}
      ${c.life_stage === 'child' ? renderChildStatus(c) : ''}
      ${c.life_stage === 'child' ? _childStatsHtml(statBarBlurred) : _adultStatsHtml(c, statBar, skillBar)}
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

    <div class="cp-tab-panel" id="cp-tab-family" style="display:none">
      <div id="cp-family-tree"><div class="cp-rel-loading">Loading family tree…</div></div>
    </div>

    <div class="cp-tab-panel" id="cp-tab-scars" style="display:none">
      <div id="cp-scars-content"><div class="cp-rel-loading">Looking back…</div></div>
    </div>
  `;

  // Build happiness tooltip content and wire hover events
  const _happPill = body.querySelector('#cp-happiness-pill');
  if (_happPill) {
    const _hFactors = c.happiness_factors || [];
    const _hComputed = c.happiness_computed ?? happiness;
    const _base = 70;
    const _rows = (_hFactors || []).map(f => {
      const sign = f.value >= 0 ? '+' : '';
      const cls  = f.value >= 0 ? 'pos' : 'neg';
      return '<div class="cp-hb-row">'
        + '<span class="cp-hb-icon">' + f.icon + '</span>'
        + '<span class="cp-hb-label">' + f.label + '</span>'
        + '<span class="cp-hb-val ' + cls + '">' + sign + f.value + '</span>'
        + '</div>';
    }).join('');
    const _tipHtml =
      '<div class="cp-hb-row cp-hb-base">'
      + '<span class="cp-hb-icon">⚖️</span>'
      + '<span class="cp-hb-label">Base happiness</span>'
      + '<span class="cp-hb-val">' + _base + '</span>'
      + '</div>'
      + _rows
      + '<div class="cp-hb-divider"></div>'
      + '<div class="cp-hb-row cp-hb-total">'
      + '<span class="cp-hb-icon">😊</span>'
      + '<span class="cp-hb-label">Total</span>'
      + '<span class="cp-hb-val">' + _hComputed + '</span>'
      + '</div>';

    // Use a single shared fixed tooltip so it never affects layout
    let _sharedTip = document.getElementById('happiness-tooltip-global');
    if (!_sharedTip) {
      _sharedTip = document.createElement('div');
      _sharedTip.id = 'happiness-tooltip-global';
      _sharedTip.className = 'cp-happiness-tooltip-fixed';
      document.body.appendChild(_sharedTip);
    }
    _sharedTip.innerHTML = _tipHtml;

    _happPill.addEventListener('mouseenter', (e) => {
      const r = _happPill.getBoundingClientRect();
      _sharedTip.style.display = 'block';
      // Position above the pill, centred
      _sharedTip.style.left = Math.round(r.left + r.width/2 - _sharedTip.offsetWidth/2) + 'px';
      _sharedTip.style.top  = Math.round(r.top - _sharedTip.offsetHeight - 10) + 'px';
    });
    _happPill.addEventListener('mouseleave', () => {
      _sharedTip.style.display = 'none';
    });
  }
}


// happiness tooltip now rendered inline via hover CSS

// ── Family Tree loader ─────────────────────────
async function loadFamilyTree(citizenId) {
  const container = document.getElementById('cp-family-tree');
  if (!container) return;
  try {
    const res = await apiFetch(`/api/citizens/${citizenId}/family`);
    if (!res.ok) { container.innerHTML = '<div class="cp-no-traits">Could not load family tree.</div>'; return; }
    const data = await res.json();
    container.innerHTML = renderFamilyTree(data);
  } catch(e) {
    container.innerHTML = '<div class="cp-no-traits">Error loading family tree.</div>';
  }
}

// Loads a citizen's permanent events (Scars & Memories) plus their current
// active conditions. The two are rendered in distinct visual sections —
// memories are immutable history; conditions are the "currently afflicting"
// view with healing timers.
async function loadCitizenScars(citizenId) {
  const container = document.getElementById('cp-scars-content');
  if (!container) return;
  try {
    const res = await apiFetch('/api/combat/citizen/' + citizenId + '/events');
    if (!res.ok) {
      container.innerHTML = '<div class="cp-no-traits">Could not load citizen history.</div>';
      return;
    }
    const data = await res.json();
    container.innerHTML = renderCitizenScars(data);
  } catch(e) {
    container.innerHTML = '<div class="cp-no-traits">Error loading citizen history.</div>';
  }
}

function renderCitizenScars(data) {
  const events = data.events || [];
  const conditions = data.conditions || [];

  if (!events.length && !conditions.length) {
    return '<div class="cp-no-traits">This citizen has no scars or notable memories yet. May it stay that way.</div>';
  }

  // ── Active conditions (top — these are the "right now" effects) ───────
  let condHtml = '';
  if (conditions.length) {
    condHtml += '<div class="cp-section-label">Currently Afflicted</div>';
    condHtml += '<div class="cp-scars-conds">';
    condHtml += conditions.map(c => {
      const mods = c.stat_modifiers || {};
      const modText = Object.entries(mods)
        .map(([k, v]) => (v > 0 ? '+' : '') + v + ' ' + k)
        .join(', ');
      const heals = c.expires_at
        ? 'Heals in ' + _formatHealTime(c.expires_at)
        : 'Permanent';
      const icon = _severityIcon(c.severity);
      return `<div class="cp-scar-cond cp-sev-${c.severity}">
        <div class="cp-scar-cond-icon">${icon}</div>
        <div class="cp-scar-cond-text">
          <div class="cp-scar-cond-title">${_titleCase(c.severity)} to the ${c.body_part}</div>
          <div class="cp-scar-cond-meta">${modText ? modText + ' · ' : ''}${heals}</div>
        </div>
      </div>`;
    }).join('');
    condHtml += '</div>';
  }

  // ── Permanent history (below) ─────────────────────────────────────────
  let histHtml = '';
  if (events.length) {
    histHtml += '<div class="cp-section-label" style="margin-top:16px">Scars & Memories</div>';
    histHtml += '<div class="cp-scars-history">';
    histHtml += events.map(e => {
      const icon = _severityIcon(e.severity);
      const when = new Date(e.occurred_at).toLocaleDateString();
      return `<div class="cp-scar-event cp-sev-${e.severity}">
        <span class="cp-scar-event-icon">${icon}</span>
        <span class="cp-scar-event-text">${e.narrative}</span>
        <span class="cp-scar-event-when">${when}</span>
      </div>`;
    }).join('');
    histHtml += '</div>';
  }

  return condHtml + histHtml;
}

function _severityIcon(severity) {
  switch (severity) {
    case 'scratch':   return '🩹';
    case 'wound':     return '🩸';
    case 'scar':      return '⚔';
    case 'crippling': return '💢';
    case 'fatal':     return '🕯';
    default:          return '·';
  }
}

function _titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function _formatHealTime(expiresAtIso) {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return 'soon';
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  return days + 'd';
}


function renderFamilyTree(data) {
  const hasFamily = data.partner || data.parents?.length || data.siblings?.length ||
                    data.children?.length || data.grandchildren?.length || data.grandparents?.length;
  if (!hasFamily) return '<div class="cp-no-traits">No known family yet — as relationships form and children are born, the family tree will grow here.</div>';

  // Build a hierarchical SVG tree
  // Rows: grandparents → parents+partner → SUBJECT → children → grandchildren
  const rows = [];

  // Row 0: grandparents
  if (data.grandparents?.length) rows.push({ label: null, nodes: data.grandparents, type: 'gp' });
  // Row 1: parents (+ siblings share this row)
  const parentsRow = [...(data.parents || [])];
  if (parentsRow.length) rows.push({ label: null, nodes: parentsRow, type: 'parent' });
  // Row 2: subject (centre) + partner
  const subjectRow = [data.subject];
  if (data.partner) subjectRow.push(data.partner);
  rows.push({ label: null, nodes: subjectRow, type: 'subject' });
  // Row 3: children
  if (data.children?.length) rows.push({ label: null, nodes: data.children, type: 'child' });
  // Row 4: grandchildren
  if (data.grandchildren?.length) rows.push({ label: null, nodes: data.grandchildren, type: 'gc' });

  // Render as HTML rows with connecting lines via CSS
  const nodeCard = (c, type) => {
    if (!c) return '';
    const isSubject = type === 'subject' && c.id === data.subject?.id;
    const icon = c.gender === 'female' ? '♀' : '♂';
    const iconColor = c.gender === 'female' ? '#e090c0' : '#70a8e0';
    const badge = c.life_stage === 'child' ? '<span class="ft-child-badge">🍼</span>' : '';
    const gen = c.generation ? `<span class="ft-gen">Gen ${c.generation}</span>` : '';
    return `<div class="ft-card${isSubject ? ' ft-card--subject' : ''}" onclick="openCitizenProfile(${c.id})" title="${c.name}">
      <span class="ft-card-gender" style="color:${iconColor}">${icon}</span>
      <span class="ft-card-name">${c.name}</span>
      ${gen}${badge}
    </div>`;
  };

  const rowHtml = rows.map((row, ri) => {
    const cards = row.nodes.map(c => nodeCard(c, row.type)).join('');
    const connector = ri > 0 ? '<div class="ft-connector-row"><div class="ft-connector-line"></div></div>' : '';
    return `${connector}<div class="ft-row ft-row--${row.type}">${cards}</div>`;
  }).join('');

  // Siblings section below if any
  const siblingsHtml = data.siblings?.length
    ? `<div class="ft-siblings-section">
        <div class="ft-siblings-label">👫 Siblings (${data.siblings.length})</div>
        <div class="ft-siblings-row">${data.siblings.map(c => nodeCard(c, 'sibling')).join('')}</div>
      </div>`
    : '';

  return `<div class="ft-hierarchy">${rowHtml}</div>${siblingsHtml}`;
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
let allCitizensFilter  = '';
let allCitizensGroupFilter = 'all';  // all | adult | child | housed | unhoused | partnered | single
let allCitizensRoleFilter  = '';     // '' = any role

function acSetGroupFilter(val, btn) {
  allCitizensGroupFilter = val;
  // Update chip active states within same group
  if (btn) {
    const group = btn.dataset.filterGroup;
    document.querySelectorAll('.ac-chip[data-filter-group="' + group + '"]')
      .forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  }
  renderAllCitizens();
}

function acSetRoleFilter(val) {
  allCitizensRoleFilter = val;
  renderAllCitizens();
}

function _populateAcRoleFilter() {
  const sel = document.getElementById('ac-role-filter');
  if (!sel) return;
  const roles = [...new Set((citizensData||[]).map(c => c.role).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All roles</option>' +
    roles.map(r => '<option value="' + r + '"' + (allCitizensRoleFilter === r ? ' selected' : '') + '>' +
      (ROLE_ICONS[r] || '') + ' ' + r + '</option>').join('');
}

function renderAllCitizens(sortKey, sortDir, filter) {
  allCitizensSortKey = sortKey || allCitizensSortKey;
  allCitizensSortDir = sortDir || allCitizensSortDir;
  allCitizensFilter  = filter !== undefined ? filter : allCitizensFilter;

  _populateAcRoleFilter();

  let list = [...citizensData];

  // Text search
  if (allCitizensFilter) {
    const f = allCitizensFilter.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(f) || c.role?.toLowerCase().includes(f));
  }

  // Group filter
  switch (allCitizensGroupFilter) {
    case 'adult':     list = list.filter(c => c.life_stage !== 'child'); break;
    case 'child':     list = list.filter(c => c.life_stage === 'child'); break;
    case 'housed':    list = list.filter(c => !!c.house_id); break;
    case 'unhoused':  list = list.filter(c => !c.house_id); break;
    case 'partnered': list = list.filter(c => !!c.partner_id); break;
    case 'single':    list = list.filter(c => !c.partner_id && c.life_stage !== 'child'); break;
  }

  // Role filter
  if (allCitizensRoleFilter) {
    list = list.filter(c => c.role === allCitizensRoleFilter);
  }

  // Sort
  list.sort((a, b) => {
    let av, bv;
    if      (allCitizensSortKey === 'name')       { av = a.name; bv = b.name; }
    else if (allCitizensSortKey === 'age')         { av = a.life?.age??0; bv = b.life?.age??0; }
    else if (allCitizensSortKey === 'generation')  { av = a.generation??0; bv = b.generation??0; }
    else if (allCitizensSortKey === 'role')        { av = a.role||''; bv = b.role||''; }
    else if (allCitizensSortKey === 'health')      { av = a.life?.health??0; bv = b.life?.health??0; }
    else if (allCitizensSortKey === 'happiness')   { av = a.happiness_computed??a.life?.happiness??0; bv = b.happiness_computed??b.life?.happiness??0; }
    else if (STAT_LABELS[allCitizensSortKey])      { av = a.stats?.[allCitizensSortKey]??0; bv = b.stats?.[allCitizensSortKey]??0; }
    else if (SKILL_LABELS[allCitizensSortKey])     { av = a.skills?.[allCitizensSortKey]??0; bv = b.skills?.[allCitizensSortKey]??0; }
    else { av = 0; bv = 0; }
    if (av < bv) return allCitizensSortDir === 'asc' ? -1 : 1;
    if (av > bv) return allCitizensSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('all-citizens-tbody');
  if (!tbody) return;

  // Update count
  const countEl = document.getElementById('ac-count');
  if (countEl) countEl.textContent = list.length + ' of ' + citizensData.length;

  const isChild = c => c.life_stage === 'child';

  tbody.innerHTML = list.map(c => {
    const traits = (c.visible_traits||[]).map(t => '<span title="' + (TRAIT_LABELS[t]||t) + '">' + (TRAIT_ICONS[t]||'✦') + '</span>').join('');
    const health = c.life?.health??100;
    const hc = health>60?'#4CAF50':health>30?'#FF9800':'#F44336';
    const happiness = c.happiness_computed ?? c.life?.happiness ?? 70;
    const happy_c = happiness>70?'#8ecf7e':happiness>45?'#e8c76a':'#e07a6a';
    const houseIcon = c.house_id ? '🏡' : '<span style="opacity:.35">—</span>';
    const partnerName = c.partner_id
      ? (citizensData.find(p => p.id === c.partner_id)?.name?.split(' ')[0] || '💕')
      : '<span style="opacity:.3">—</span>';

    // Role cell — no dropdown for children or citizens on quests
    const roleCell = isChild(c)
      ? '<td class="ac-role-child">🍼 Child</td>'
      : c.active_quest
        ? '<td class="ac-role-child">⚔️ On Quest</td>'
        : '<td><select class="ac-role-select" onchange="updateCitizenRole(' + c.id + ', this.value)" onclick="event.stopPropagation()">' +
          getAvailableRoles().map(r => '<option value="' + r + '"' + (c.role===r?' selected':'') + '>' + (ROLE_ICONS[r]||'?') + ' ' + r + '</option>').join('') +
          '</select></td>';

    return '<tr class="ac-row' + (isChild(c) ? ' ac-row--child' : '') + '" id="ac-row-' + c.id + '" onclick="openCitizenProfile(' + c.id + ')" style="cursor:pointer">'
      + '<td class="ac-name">' + c.name + (isChild(c) ? ' <span class="ac-child-tag">child</span>' : '') + '</td>'
      + '<td class="ac-meta">' + (c.gender==='female'?'♀':'♂') + ' · ' + (c.life?.age??'?') + 'y</td>'
      + '<td class="ac-meta">Gen ' + (c.generation??1) + '</td>'
      + roleCell
      + '<td class="ac-stat" style="color:' + happy_c + '">' + happiness + '%</td>'
      + '<td class="ac-stat" style="color:' + hc + '">' + health + '%</td>'
      + '<td class="ac-stat">' + (c.stats?.strength??'<span style="opacity:.3">—</span>') + '</td>'
      + '<td class="ac-stat">' + (c.stats?.agility??'<span style="opacity:.3">—</span>') + '</td>'
      + '<td class="ac-stat">' + (c.stats?.endurance??'<span style="opacity:.3">—</span>') + '</td>'
      + '<td class="ac-stat">' + (c.stats?.intelligence??'<span style="opacity:.3">—</span>') + '</td>'
      + '<td class="ac-stat">' + (c.stats?.charisma??'<span style="opacity:.3">—</span>') + '</td>'
      + '<td class="ac-meta">' + houseIcon + '</td>'
      + '<td class="ac-meta" style="font-size:10px">' + partnerName + '</td>'
      + '<td class="ac-traits">' + traits + '</td>'
      + '</tr>';
  }).join('');

  // Update sort button states
  document.querySelectorAll('.ac-sort-btn').forEach(btn => {
    btn.classList.remove('active-asc','active-desc');
    if (btn.dataset.sort === allCitizensSortKey)
      btn.classList.add(allCitizensSortDir === 'asc' ? 'active-asc' : 'active-desc');
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

function sortCitizensByHappiness() {
  // Sort citizensData by happiness descending and re-render
  if (!citizensData) return;
  citizensData.sort((a, b) => (b.life?.happiness ?? 70) - (a.life?.happiness ?? 70));
  renderCitizensPanel();
}
