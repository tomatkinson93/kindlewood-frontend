
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
      // Reset floater baseline so the just-arrived numbers don't trigger
      // a deluge of "+X" floaters from offline-accumulation differences.
      // resetResourceFloaterBaseline lives in resources.js; guarded with
      // typeof so this works even if that module isn't loaded.
      if (typeof resetResourceFloaterBaseline === 'function') {
        resetResourceFloaterBaseline(tickResources);
      }
      // Bust the resource-breakdown cache so the next modal/hover sees
      // fresh per-source numbers (otherwise it could show up to 30s stale,
      // which is jarring if the player just assigned a farmer and wants
      // to confirm the food rate row reflects it).
      if (typeof invalidateResourceBreakdown === 'function') {
        invalidateResourceBreakdown();
      }
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
      // Pre-existing oversight: demolishing changes rates but the topbar
      // wasn't refreshing here (unlike buildBuilding, which does). Without
      // this call the topbar shows stale rates until the next 5-minute
      // sync. refreshResources also busts the breakdown cache so the
      // modal reflects the new lower rate immediately.
      await refreshResources();
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

// Dev Tools: manually inflict an injury on the currently-loaded citizen.
// Empty severity / body_part means "roll randomly" — the server picks both
// using the same injury table the real combat path uses, so admin-inflicted
// injuries look identical to organic ones in the profile.
async function cheatInflictInjury() {
  if (!_ceCurrentId) {
    showBuildToast('Select a citizen first.', 'error');
    return;
  }
  const body = {
    citizen_id: _ceCurrentId,
    severity: document.getElementById('ce-injury-sev').value || undefined,
    body_part: document.getElementById('ce-injury-part').value || undefined,
  };
  try {
    const res = await apiFetch('/api/combat/admin/inflict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      const ev = (data.events || [])[0];
      const msg = ev ? (ev.narrative || 'Injury inflicted.') : 'Injury rolled — citizen escaped clean.';
      showBuildToast(msg, 'success');
      if (typeof loadCitizens === 'function') loadCitizens();
    } else {
      showBuildToast(data.error || 'Failed to inflict injury.', 'error');
    }
  } catch (e) {
    showBuildToast('Network error.', 'error');
  }
}

// Dev Tools: clear all active conditions on a citizen. The permanent
// citizen_events log is left intact — we only remove the live debuffs.
async function cheatHealAllInjuries() {
  if (!_ceCurrentId) {
    showBuildToast('Select a citizen first.', 'error');
    return;
  }
  if (!confirm('Heal all active conditions on this citizen? Permanent scars/cripplings will still show in their history.')) return;
  try {
    const res = await apiFetch('/api/combat/admin/heal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_id: _ceCurrentId }),
    });
    const data = await res.json();
    if (res.ok) {
      showBuildToast(`Cleared ${data.conditions_removed} condition(s).`, 'success');
      if (typeof loadCitizens === 'function') loadCitizens();
    } else {
      showBuildToast(data.error || 'Failed to heal.', 'error');
    }
  } catch (e) {
    showBuildToast('Network error.', 'error');
  }
}

function openCheatMenu() {
  document.getElementById('cheat-modal').classList.add('open');
  _populateCheatCitizenDropdowns();
}
function closeCheatMenu() {
  document.getElementById('cheat-modal').classList.remove('open');
}

function _populateCheatCitizenDropdowns() {
  const all = (typeof citizensData !== 'undefined' ? citizensData : []);
  const adults = all.filter(c => c.life_stage !== 'child');
  const selIds = ['cheat-rel-a','cheat-rel-b','cheat-partner-a','cheat-partner-b','cheat-birth-a','cheat-birth-b','ce-citizen-select'];
  selIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const pool = id === 'ce-citizen-select' ? all : adults;
    sel.innerHTML = '<option value="">— Select citizen —</option>' +
      pool.map(c => `<option value="${c.id}" ${c.id == current ? 'selected' : ''}>${c.name} (${c.gender[0].toUpperCase()}${c.life_stage==='child'?' · child':''})</option>`).join('');
  });
}

function cheatSwitchTab(panelId, btn) {
  document.querySelectorAll('.cheat-tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.cheat-tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById(panelId);
  if (panel) panel.style.display = '';
  btn.classList.add('active');
}

// ── Citizen editor ──────────────────────────────
let _ceCurrentId = null;
function cheatLoadCitizen(id) {
  _ceCurrentId = id || null;
  const editor = document.getElementById('ce-editor');
  if (!id || !editor) { if (editor) editor.style.display = 'none'; return; }
  const c = (citizensData || []).find(c => c.id == id);
  if (!c) { editor.style.display = 'none'; return; }
  editor.style.display = '';
  document.getElementById('ce-name').value         = c.name || '';
  document.getElementById('ce-gender').value       = c.gender || 'male';
  document.getElementById('ce-lifestage').value    = c.life_stage || 'adult';
  document.getElementById('ce-generation').value   = c.generation || 1;
  document.getElementById('ce-age').value          = c.life?.age ?? 0;
  document.getElementById('ce-health').value       = c.life?.health ?? 80;
  document.getElementById('ce-happiness').value    = c.life?.happiness ?? 70;
  document.getElementById('ce-hunger').value       = c.life?.hunger ?? 20;
  document.getElementById('ce-energy').value       = c.life?.energy ?? 80;
  document.getElementById('ce-strength').value     = c.stats?.strength ?? 8;
  document.getElementById('ce-agility').value      = c.stats?.agility ?? 8;
  document.getElementById('ce-endurance').value    = c.stats?.endurance ?? 8;
  document.getElementById('ce-intelligence').value = c.stats?.intelligence ?? 8;
  document.getElementById('ce-charisma').value     = c.stats?.charisma ?? 8;
  document.getElementById('ce-farming').value      = c.skills?.farming ?? 1;
  document.getElementById('ce-woodcutting').value  = c.skills?.woodcutting ?? 1;
  document.getElementById('ce-fishing').value      = c.skills?.fishing ?? 1;
  document.getElementById('ce-mining').value       = c.skills?.mining ?? 1;
  document.getElementById('ce-crafting').value     = c.skills?.crafting ?? 1;
  document.getElementById('ce-scouting').value     = c.skills?.scouting ?? 1;
  document.getElementById('ce-combat').value       = c.skills?.combat ?? 1;
}

async function cheatSaveCitizen() {
  if (!_ceCurrentId) return;
  const fb = document.getElementById('ce-feedback');
  const body = {
    name:       document.getElementById('ce-name').value,
    gender:     document.getElementById('ce-gender').value,
    life_stage: document.getElementById('ce-lifestage').value,
    generation: parseInt(document.getElementById('ce-generation').value),
    life: {
      age:       parseInt(document.getElementById('ce-age').value),
      health:    parseInt(document.getElementById('ce-health').value),
      happiness: parseInt(document.getElementById('ce-happiness').value),
      hunger:    parseInt(document.getElementById('ce-hunger').value),
      energy:    parseInt(document.getElementById('ce-energy').value),
    },
    stats: {
      strength:     parseInt(document.getElementById('ce-strength').value),
      agility:      parseInt(document.getElementById('ce-agility').value),
      endurance:    parseInt(document.getElementById('ce-endurance').value),
      intelligence: parseInt(document.getElementById('ce-intelligence').value),
      charisma:     parseInt(document.getElementById('ce-charisma').value),
    },
    skills: {
      farming:     parseInt(document.getElementById('ce-farming').value),
      woodcutting: parseInt(document.getElementById('ce-woodcutting').value),
      fishing:     parseInt(document.getElementById('ce-fishing').value),
      mining:      parseInt(document.getElementById('ce-mining').value),
      crafting:    parseInt(document.getElementById('ce-crafting').value),
      scouting:    parseInt(document.getElementById('ce-scouting').value),
      combat:      parseInt(document.getElementById('ce-combat').value),
    },
  };
  try {
    const res = await apiFetch('/api/game/cheat/citizen/' + _ceCurrentId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      if (fb) { fb.textContent = '✓ Saved'; fb.style.color = '#8ecf7e'; }
      setTimeout(() => { if (fb) fb.textContent = ''; }, 2500);
      if (typeof loadCitizens === 'function') loadCitizens();
    } else {
      if (fb) { fb.textContent = '⚠ ' + (data.error || 'Failed'); fb.style.color = '#e07a6a'; }
    }
  } catch(e) {
    if (fb) { fb.textContent = '⚠ Error'; fb.style.color = '#e07a6a'; }
  }
}

// ── Partnership ─────────────────────────────────
async function cheatSetPartnership(action) {
  const aId = parseInt(document.getElementById('cheat-partner-a')?.value);
  const bId = parseInt(document.getElementById('cheat-partner-b')?.value);
  const fb  = document.getElementById('cheat-partner-feedback');
  if (!aId || !bId) { if (fb) fb.textContent = '⚠ Select both citizens.'; return; }
  if (aId === bId)  { if (fb) fb.textContent = '⚠ Pick two different citizens.'; return; }
  try {
    const res = await apiFetch('/api/game/cheat/partnership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_a_id: aId, citizen_b_id: bId, action }),
    });
    const data = await res.json();
    if (res.ok) {
      if (fb) { fb.textContent = '✓ ' + data.message; fb.style.color = '#8ecf7e'; }
      setTimeout(() => { if (fb) fb.textContent = ''; }, 3000);
      if (typeof loadCitizens === 'function') loadCitizens();
    } else {
      if (fb) { fb.textContent = '⚠ ' + (data.error || 'Failed'); fb.style.color = '#e07a6a'; }
    }
  } catch(e) {
    if (fb) { fb.textContent = '⚠ Error'; fb.style.color = '#e07a6a'; }
  }
}

// ── Trigger birth ───────────────────────────────
async function cheatTriggerBirth() {
  const aId = parseInt(document.getElementById('cheat-birth-a')?.value);
  const bId = parseInt(document.getElementById('cheat-birth-b')?.value);
  const fb  = document.getElementById('cheat-birth-feedback');
  if (!aId || !bId) { if (fb) fb.textContent = '⚠ Select both parents.'; return; }
  if (aId === bId)  { if (fb) fb.textContent = '⚠ Pick two different citizens.'; return; }
  try {
    const res = await apiFetch('/api/game/cheat/trigger-birth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen_a_id: aId, citizen_b_id: bId }),
    });
    const data = await res.json();
    if (res.ok) {
      if (fb) { fb.textContent = '🍼 ' + data.message; fb.style.color = '#8ecf7e'; }
      setTimeout(() => { if (fb) fb.textContent = ''; }, 4000);
      if (typeof loadCitizens === 'function') loadCitizens();
      if (typeof loadEvents   === 'function') loadEvents();
    } else {
      if (fb) { fb.textContent = '⚠ ' + (data.error || 'Failed'); fb.style.color = '#e07a6a'; }
    }
  } catch(e) {
    if (fb) { fb.textContent = '⚠ Error: ' + e.message; fb.style.color = '#e07a6a'; }
  }
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

// ══════════════════════════════════════════════
//  QUEST ADMIN — cheat menu Quests tab
// ══════════════════════════════════════════════

let _qaQuests = [];

async function loadQuestAdmin(seed) {
  await _qaLoadNpcList();
  const fb = document.getElementById('qa-feedback');
  if (seed) {
    const r = await apiFetch('/api/quest-admin/seed', { method: 'POST' });
    const d = await r.json();
    if (fb) { fb.textContent = d.ok ? '✓ Seeded ' + d.seeded + ' quests.' : '⚠ ' + d.error; fb.style.color = d.ok ? '#8ecf7e' : '#e07a6a'; }
    setTimeout(() => { if(fb) fb.textContent = ''; }, 3000);
  }
  const r = await apiFetch('/api/quest-admin');
  const d = await r.json();
  _qaQuests = d.quests || [];
  _renderQaList();
}

function _renderQaList() {
  const el = document.getElementById('qa-list');
  if (!el) return;
  if (!_qaQuests.length) {
    el.innerHTML = '<div style="color:rgba(192,221,151,.3);font-size:11px;padding:8px">No quests. Click Seed Built-ins or New Quest.</div>';
    return;
  }
  const active   = _qaQuests.filter(q => !q.archived);
  const archived = _qaQuests.filter(q => q.archived);

  const row = q => '<div class="qa-row' + (q.archived ? ' qa-archived' : '') + '">'
    + '<span class="qa-row-icon">' + (q.icon||'📜') + '</span>'
    + '<span class="qa-row-type qa-type-' + q.quest_type + '">' + (q.quest_type === 'party' ? '👥' : '🗡') + '</span>'
    + '<span class="qa-row-title">' + q.title + '</span>'
    + '<span class="qa-row-diff">' + Math.round(q.base_success*100) + '%</span>'
    + '<div class="qa-row-btns">'
    + '<button class="qa-btn" data-id="' + q.id + '" onclick="qa_showForm(this.dataset.id)">✏</button>'
    + (q.archived
        ? '<button class="qa-btn qa-btn-archive" data-id="' + q.id + '" onclick="qa_setArchived(this.dataset.id,false)">↩</button>'
        : '<button class="qa-btn qa-btn-archive" data-id="' + q.id + '" onclick="qa_setArchived(this.dataset.id,true)">🗄</button>'
      )
    + '</div></div>';

  el.innerHTML = (active.length ? '<div class="qa-section-label">In Rotation (' + active.length + ')</div>' + active.map(row).join('') : '')
    + (archived.length ? '<div class="qa-section-label qa-archived-label">Archived (' + archived.length + ')</div>' + archived.map(row).join('') : '');
}

async function qa_setArchived(id, archived) {
  await apiFetch('/api/quest-admin/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  });
  await loadQuestAdmin();
}

function qa_showForm(id) {
  const q = id ? _qaQuests.find(x => x.id === id) : null;
  const wrap = document.getElementById('qa-form-wrap');
  if (!wrap) return;

  const isNew = !q;
  const SKILLS = ['farming','woodcutting','fishing','mining','crafting','scouting','combat'];
  window._qaReqRows = q?.requires?.length ? [...q.requires] : [
    { role_label:'', skill_key:'', desc:'' },
    { role_label:'', skill_key:'', desc:'' },
  ];
  window._qaDropRows = Array.isArray(q?.drops) ? [...q.drops] : [];

  // Build NPC options for settlement source
  const npcOpts = '<option value="">— None —</option>'
    + (_qaNpcList || []).map(n => '<option value="' + n.id + '"' + (q?.given_by_npc_id === n.id ? ' selected' : '') + '>' + n.name + '</option>').join('');

  const tip = (text) => '<span class="qa-tip" title="' + text + '">?</span>';

  wrap.style.display = 'block';
  wrap.innerHTML = '<div class="qa-form">'
    + '<div class="qa-form-header">' + (isNew ? '＋ New Quest' : 'Edit: ' + q.title)
    + '<button onclick="document.getElementById(\'qa-form-wrap\').style.display=\'none\'" style="margin-left:auto;background:none;border:none;color:rgba(192,221,151,.5);cursor:pointer;font-size:14px">✕</button></div>'

    // ── Identity ──
    + '<div class="qa-section-label">Identity</div>'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>ID ' + tip('Unique key, no spaces. e.g. ruins_expedition_01') + '</label><input class="ce-input" id="qa-id" value="' + (q?.id||'') + '"' + (!isNew?' readonly':'') + ' placeholder="my_quest_id"></div>'
    + '<div class="ce-field"><label>Icon ' + tip('Single emoji shown on the quest card') + '</label><input class="ce-input" id="qa-icon" value="' + (q?.icon||'📜') + '"></div>'
    + '</div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Title ' + tip('Short, punchy name. e.g. "Hunt the Wolf Pack"') + '</label><input class="ce-input" id="qa-title" value="' + (q?.title||'') + '" placeholder="Hunt the Wolf Pack"></div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Description ' + tip('2-3 sentences shown on the quest card. Sets the scene.') + '</label><textarea class="ce-input" id="qa-desc" rows="2" placeholder="A wolf pack has been raiding nearby farmsteads…">' + (q?.description||'') + '</textarea></div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Flavour text ' + tip('Short italic tagline below the description. Optional mood-setter.') + '</label><input class="ce-input" id="qa-flavour" value="' + (q?.flavour||'') + '" placeholder="Track them down before more are lost."></div>'

    // ── Source & Type ──
    + '<div class="qa-section-label" style="margin-top:10px">Source & Type</div>'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>Source ' + tip('Where does this quest appear? Tavern = Notice Board. Settlement = given by an NPC village at a required trust level.') + '</label>'
    + '<select class="ce-input" id="qa-source" onchange="_qaToggleSourceFields()">'
    + '<option value="tavern"' + (q?.quest_source!=='settlement'?' selected':'') + '>🍺 Tavern (Notice Board)</option>'
    + '<option value="settlement"' + (q?.quest_source==='settlement'?' selected':'') + '>🏡 Settlement Quest</option>'
    + '</select></div>'
    + '<div class="ce-field"><label>Quest Type</label>'
    + '<select class="ce-input" id="qa-type">'
    + '<option value="solo"' + (q?.quest_type!=='party'?' selected':'') + '>🗡 Solo</option>'
    + '<option value="party"' + (q?.quest_type==='party'?' selected':'') + '>👥 Party</option>'
    + '</select></div>'
    + '</div>'
    + '<div id="qa-settlement-fields" style="margin-top:6px">'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>Given by NPC ' + tip('Which settlement gives this quest? Only shown when Source = Settlement.') + '</label><select class="ce-input" id="qa-npc">' + npcOpts + '</select></div>'
    + '<div class="ce-field"><label>Min Trust ' + tip('Trust level required (0-100). 0=anyone, 21=Familiar, 41=Friendly, 71=Allied') + '</label><input class="ce-input" type="number" id="qa-min-trust" min="0" max="100" value="' + (q?.min_trust||0) + '"></div>'
    + '</div></div>'

    // ── Skill ──
    + '<div id="qa-solo-fields">'
    + '<div class="ce-field" style="margin-top:6px"><label>Skill ' + tip('Which skill is tested? Determines citizen dropdown sorting and success roll bonus.') + '</label>'
    + '<select class="ce-input" id="qa-skill"><option value="">— none —</option>'
    + SKILLS.map(s => '<option value="' + s + '"' + (q?.skill_key===s?' selected':'') + '>' + s + '</option>').join('')
    + '</select></div></div>'
    + '<div id="qa-party-fields" style="margin-top:6px">'
    + '<div class="qa-form-header" style="font-size:11px;margin-bottom:4px">Party Roles ' + tip('Each row = one citizen slot. Role label is shown in the UI. Skill determines which skill boosts that slot\'s roll.') + ' <button onclick="_qaAddReqRow()" style="margin-left:8px;padding:1px 8px;font-size:10px;background:rgba(192,221,151,.1);border:1px solid rgba(192,221,151,.2);border-radius:4px;color:rgba(192,221,151,.7);cursor:pointer">+ Add Role</button></div>'
    + '<div id="qa-req-rows"></div>'
    + '</div>'

    // ── Stats ──
    + '<div class="qa-section-label" style="margin-top:10px">Difficulty & Rewards</div>'
    + '<div class="ce-grid ce-grid--4">'
    + '<div class="ce-field"><label>Base Success % ' + tip('Chance of success with an average citizen (skill 5). Range 5–95.') + '</label><input class="ce-input" type="number" id="qa-success" min="5" max="95" value="' + Math.round((q?.base_success||0.5)*100) + '"></div>'
    + '<div class="ce-field"><label>Duration (s) ' + tip('How long the quest takes in seconds. 60=1min, 3600=1hr') + '</label><input class="ce-input" type="number" id="qa-dur" value="' + (q?.duration_s||120) + '"></div>'
    + '<div class="ce-field"><label>Gold reward ' + tip('Gold awarded on success. Added directly to settlement wealth.') + '</label><input class="ce-input" type="number" id="qa-gold" value="' + (q?.reward_gold||0) + '"></div>'
    + '<div class="ce-field"><label>Sort order ' + tip('Lower numbers appear first in the quest board. Use 0 for default.') + '</label><input class="ce-input" type="number" id="qa-sort" value="' + (q?.sort_order||0) + '"></div>'
    + '</div>'
    + '<div class="ce-field" style="margin-top:6px"><label>Reward label ' + tip('Human-readable reward summary shown on the card. e.g. "+40 timber, +15 gold"') + '</label><input class="ce-input" id="qa-reward-label" value="' + (q?.reward_label||'') + '" placeholder="+15 gold, +2 food"></div>'
    + '<div class="ce-grid" style="margin-top:6px">'
    + '<div class="ce-field"><label>Success flavour ' + tip('Short message shown when the quest succeeds. e.g. "The pack fled into the deep wood."') + '</label><input class="ce-input" id="qa-fsuccess" value="' + (q?.flavour_success||'') + '"></div>'
    + '<div class="ce-field"><label>Failure flavour ' + tip('Short message shown when the quest fails. e.g. "They returned empty-handed."') + '</label><input class="ce-input" id="qa-ffail" value="' + (q?.flavour_fail||'') + '"></div>'
    + '</div>'

    // ── Combat ──
    + '<div class="qa-section-label" style="margin-top:10px">⚔ Combat ' + tip('Optional. If chance > 0, a battle may trigger at a random point during the quest. Players choose at accept-time whether to play it or auto-resolve.') + '</div>'
    + '<div class="ce-grid">'
    +   '<div class="ce-field"><label>Combat chance (0–100%) ' + tip('0 = peaceful, 50 = guard duty, 100 = always fights. Examples: Herb Picking 0%, Caravan Guard 50%, Slay the Dragon 100%.') + '</label>'
    +     '<input class="ce-input" type="number" min="0" max="100" id="qa-combat-chance" value="' + (q?.combat_chance ?? 0) + '"></div>'
    +   '<div class="ce-field"><label>Encounter <span style="font-size:9px;opacity:.5">(comma-separated enemy ids)</span> ' + tip('e.g. marsh_rat,wild_fox. Leave blank for a random pick. Manage available enemies in the Creatures tab.') + '</label>'
    +     '<input class="ce-input" id="qa-combat-encounter" value="' + (Array.isArray(q?.combat_encounter) ? q.combat_encounter.join(',') : '') + '" placeholder="marsh_rat, wild_fox"></div>'
    + '</div>'

    // ── Drops ──
    + '<div class="qa-section-label" style="margin-top:10px">Item Drops ' + tip('Items that can drop on quest success. Each drop has a % chance. e.g. 25% = roughly 1 in 4 runs.') + ' <button onclick="_qaAddDropRow()" style="margin-left:8px;padding:1px 8px;font-size:10px;background:rgba(192,221,151,.1);border:1px solid rgba(192,221,151,.2);border-radius:4px;color:rgba(192,221,151,.7);cursor:pointer">+ Add Drop</button></div>'
    + '<div id="qa-drop-rows" style="display:flex;flex-direction:column;gap:5px"></div>'

    + '<button class="cheat-all-btn" style="margin-top:12px" onclick="qa_save(' + (!isNew ? JSON.stringify(id) : 'null') + ')">💾 ' + (isNew ? 'Create Quest' : 'Save Changes') + '</button>'
    + '</div>';

  // Toggle fields based on type/source
  const typeEl = wrap.querySelector('#qa-type');
  const updateTypeFields = () => {
    const isParty = typeEl.value === 'party';
    wrap.querySelector('#qa-solo-fields').style.display = isParty ? 'none' : '';
    wrap.querySelector('#qa-party-fields').style.display = isParty ? '' : 'none';
  };
  typeEl.addEventListener('change', updateTypeFields);
  updateTypeFields();
  _qaToggleSourceFields();
  _qaRenderReqRows();
  _qaRenderDropRows();
}

function _qaToggleSourceFields() {
  const src = document.getElementById('qa-source')?.value;
  const sf = document.getElementById('qa-settlement-fields');
  if (sf) sf.style.display = src === 'settlement' ? '' : 'none';
}

// ── Drop row system ────────────────────────────
function _qaRenderDropRows() {
  const container = document.getElementById('qa-drop-rows');
  if (!container) return;
  const rows = window._qaDropRows || [];
  if (!rows.length) {
    container.innerHTML = '<div style="font-size:10px;color:rgba(192,221,151,.25);padding:4px 2px">No drops configured.</div>';
    return;
  }
  // Build item options from item_templates if loaded
  const tmplOpts = (typeof _iaItems !== 'undefined' && _iaItems.length)
    ? '<option value="">— Custom —</option>' + _iaItems.map(t => '<option value="' + t.item_key + '|' + t.name + '|' + t.icon + '|' + t.rarity + '">' + t.icon + ' ' + t.name + ' (' + t.rarity + ')</option>').join('')
    : '<option value="">— Enter manually —</option>';
  container.innerHTML = rows.map((d, i) =>
    '<div style="background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:8px;margin-bottom:5px">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
    + '<span style="font-size:10px;color:rgba(192,221,151,.5)">Drop ' + (i+1) + '</span>'
    + '<button onclick="_qaRemoveDropRow(' + i + ')" style="background:rgba(220,80,60,.15);border:1px solid rgba(220,80,60,.25);border-radius:4px;color:#e07a6a;cursor:pointer;padding:2px 8px;font-size:11px">✕ Remove</button>'
    + '</div>'
    + '<div class="ce-grid" style="margin-bottom:6px">'
    + '<div class="ce-field"><label>Item from library</label><select class="ce-input" id="qa-drop-tmpl-' + i + '" onchange="_qaDropFromTemplate(' + i + ',this)">' + tmplOpts + '</select></div>'
    + '<div class="ce-field"><label>Chance % <span class="qa-tip" title="Probability of dropping on quest success. 100=always, 25=1 in 4, 5=rare bonus">?</span></label>'
    + '<input class="ce-input" type="number" id="qa-drop-chance-' + i + '" min="1" max="100" value="' + (d.chance||25) + '"></div>'
    + '</div>'
    + '<div class="ce-grid">'
    + '<div class="ce-field"><label>Name</label><input class="ce-input" id="qa-drop-name-' + i + '" value="' + (d.name||'') + '" placeholder="Ancient Heartwood"></div>'
    + '<div class="ce-field" style="flex:0 0 60px"><label>Icon</label><input class="ce-input" id="qa-drop-icon-' + i + '" value="' + (d.icon||'📦') + '"></div>'
    + '<div class="ce-field"><label>Rarity</label><select class="ce-input" id="qa-drop-rarity-' + i + '">'
    + ['common','uncommon','rare','epic','legendary'].map(r => '<option value="' + r + '"' + (d.rarity===r?' selected':'') + '>' + r + '</option>').join('')
    + '</select></div>'
    + '</div>'
    + '</div>'
  ).join('');
}

function _qaDropFromTemplate(idx, sel) {
  const val = sel.value;
  if (!val) return;
  const [key, name, icon, rarity] = val.split('|');
  const nameEl = document.getElementById('qa-drop-name-' + idx);
  const iconEl = document.getElementById('qa-drop-icon-' + idx);
  const rarEl  = document.getElementById('qa-drop-rarity-' + idx);
  if (nameEl) nameEl.value = name;
  if (iconEl) iconEl.value = icon;
  if (rarEl)  rarEl.value  = rarity;
  if (window._qaDropRows && window._qaDropRows[idx]) {
    window._qaDropRows[idx] = { ...window._qaDropRows[idx], item_key: key, name, icon, rarity };
  }
}

function _qaAddDropRow() {
  _qaSyncDropRows();
  window._qaDropRows.push({ name:'', icon:'📦', rarity:'common', chance:25 });
  _qaRenderDropRows();
}

function _qaRemoveDropRow(idx) {
  _qaSyncDropRows();
  window._qaDropRows.splice(idx, 1);
  _qaRenderDropRows();
}

function _qaSyncDropRows() {
  const rows = window._qaDropRows || [];
  rows.forEach((_, i) => {
    rows[i] = {
      name:    document.getElementById('qa-drop-name-'   + i)?.value || '',
      icon:    document.getElementById('qa-drop-icon-'   + i)?.value || '📦',
      rarity:  document.getElementById('qa-drop-rarity-' + i)?.value || 'common',
      chance:  parseInt(document.getElementById('qa-drop-chance-' + i)?.value || '25'),
      item_key: window._qaDropRows[i]?.item_key || (document.getElementById('qa-drop-name-' + i)?.value || 'drop').toLowerCase().replace(/\s+/g,'_'),
    };
  });
}

// Preload NPC list for settlement source dropdown
let _qaNpcList = [];
async function _qaLoadNpcList() {
  try {
    const r = await apiFetch('/api/game/npc-list');
    const d = await r.json();
    _qaNpcList = d.npcs || [];
  } catch(e) {}
}

function _qaRenderReqRows() {
  const container = document.getElementById('qa-req-rows');
  if (!container) return;
  const rows = window._qaReqRows || [];
  container.innerHTML = rows.map((r, i) =>
    '<div class="qa-req-row" id="qa-req-row-' + i + '">'
    + '<input class="ce-input" placeholder="Role (e.g. Scout)" id="qa-req-role-' + i + '" value="' + (r.role_label||'') + '">'
    + '<select class="ce-input" id="qa-req-skill-' + i + '">'
    + '<option value="">— Skill —</option>'
    + ['farming','woodcutting','fishing','mining','crafting','scouting','combat'].map(s =>
        '<option value="' + s + '"' + (r.skill_key===s?' selected':'') + '>' + s + '</option>'
      ).join('')
    + '</select>'
    + '<input class="ce-input" placeholder="What they do" id="qa-req-desc-' + i + '" value="' + (r.desc||'') + '">'
    + (rows.length > 1
        ? '<button onclick="_qaRemoveReqRow(' + i + ')" style="background:rgba(220,80,60,.15);border:1px solid rgba(220,80,60,.25);border-radius:4px;color:#e07a6a;cursor:pointer;padding:0 6px;font-size:12px;flex-shrink:0">✕</button>'
        : '<span style="width:26px"></span>')
    + '</div>'
  ).join('');
}

function _qaAddReqRow() {
  // Save current values first
  _qaSyncReqRows();
  window._qaReqRows.push({ role_label:'', skill_key:'', desc:'' });
  _qaRenderReqRows();
}

function _qaRemoveReqRow(idx) {
  _qaSyncReqRows();
  window._qaReqRows.splice(idx, 1);
  _qaRenderReqRows();
}

function _qaSyncReqRows() {
  const rows = window._qaReqRows || [];
  rows.forEach((_, i) => {
    rows[i] = {
      role_label: document.getElementById('qa-req-role-' + i)?.value || '',
      skill_key:  document.getElementById('qa-req-skill-' + i)?.value || '',
      desc:       document.getElementById('qa-req-desc-' + i)?.value || '',
    };
  });
}

async function qa_save(existingId) {
  const isNew = !existingId;
  const type  = document.getElementById('qa-type').value;
  const isParty = type === 'party';

  let requires = [];
  if (isParty) {
    _qaSyncReqRows();
    requires = (window._qaReqRows || []).filter(r => r.role_label || r.skill_key);
  }

  _qaSyncDropRows();
  const body = {
    id:           document.getElementById('qa-id')?.value?.trim(),
    title:        document.getElementById('qa-title')?.value?.trim(),
    description:  document.getElementById('qa-desc')?.value?.trim(),
    flavour:      document.getElementById('qa-flavour')?.value?.trim(),
    icon:         document.getElementById('qa-icon')?.value?.trim() || '📜',
    category:     'general',
    quest_type:   type,
    quest_source: document.getElementById('qa-source')?.value || 'tavern',
    given_by_npc_id: document.getElementById('qa-npc')?.value ? parseInt(document.getElementById('qa-npc').value) : null,
    min_trust:    parseInt(document.getElementById('qa-min-trust')?.value) || 0,
    skill_key:    isParty ? null : (document.getElementById('qa-skill')?.value || null),
    base_success: (parseInt(document.getElementById('qa-success')?.value) || 50) / 100,
    duration_s:   parseInt(document.getElementById('qa-dur')?.value) || 120,
    reward_gold:  parseInt(document.getElementById('qa-gold')?.value) || 0,
    reward_label: document.getElementById('qa-reward-label')?.value?.trim() || '',
    flavour_success: document.getElementById('qa-fsuccess')?.value?.trim() || '',
    flavour_fail:    document.getElementById('qa-ffail')?.value?.trim() || '',
    sort_order:   parseInt(document.getElementById('qa-sort')?.value) || 0,
    combat_chance: Math.max(0, Math.min(100, parseInt(document.getElementById('qa-combat-chance')?.value) || 0)),
    combat_encounter: (document.getElementById('qa-combat-encounter')?.value || '')
                       .split(',').map(s => s.trim()).filter(Boolean),
    requires,
    drops: (window._qaDropRows || []).filter(d => d.name),
  };

  if (!body.id || !body.title) { _qaFeedback('⚠️ ID and title required.'); return; }

  const url    = isNew ? '/api/quest-admin' : '/api/quest-admin/' + existingId;
  const method = isNew ? 'POST' : 'PATCH';
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { _qaFeedback('⚠️ ' + (d.error || 'Failed')); return; }
  _qaFeedback('✓ Saved: ' + body.title);
  document.getElementById('qa-form-wrap').style.display = 'none';
  await loadQuestAdmin();
}

function _qaFeedback(msg) {
  const el = document.getElementById('qa-feedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = msg.startsWith('✓') ? '#8ecf7e' : '#e07a6a';
  setTimeout(() => { if(el) el.textContent = ''; }, 3000);
}

// ══════════════════════════════════════════════
//  DEBUG INVENTORY TOOLS
// ══════════════════════════════════════════════

const DEBUG_ALL_ITEMS = [
  // Fish
  { item_key:'fish_minnow',      name:'Minnow',           icon:'🐟', category:'food',       rarity:'common',    sell_value:2,   food_value:3  },
  { item_key:'fish_dace',        name:'Dace',             icon:'🐠', category:'food',       rarity:'common',    sell_value:4,   food_value:5  },
  { item_key:'fish_perch',       name:'Perch',            icon:'🐠', category:'food',       rarity:'common',    sell_value:5,   food_value:6  },
  { item_key:'fish_roach',       name:'Roach',            icon:'🐟', category:'food',       rarity:'common',    sell_value:4,   food_value:5  },
  { item_key:'fish_gudgeon',     name:'Gudgeon',          icon:'🐟', category:'food',       rarity:'common',    sell_value:2,   food_value:3  },
  { item_key:'fish_trout',       name:'Trout',            icon:'🐡', category:'food',       rarity:'uncommon',  sell_value:10,  food_value:8  },
  { item_key:'fish_chub',        name:'Chub',             icon:'🐡', category:'food',       rarity:'uncommon',  sell_value:8,   food_value:7  },
  { item_key:'fish_catfish',     name:'Catfish',          icon:'🐊', category:'food',       rarity:'uncommon',  sell_value:14,  food_value:9  },
  { item_key:'fish_bream',       name:'Bream',            icon:'🐡', category:'food',       rarity:'uncommon',  sell_value:11,  food_value:8  },
  { item_key:'fish_pike',        name:'Pike',             icon:'🦷', category:'food',       rarity:'uncommon',  sell_value:18,  food_value:10 },
  { item_key:'fish_salmon',      name:'Salmon',           icon:'🍣', category:'food',       rarity:'rare',      sell_value:28,  food_value:18 },
  { item_key:'fish_eel',         name:'River Eel',        icon:'〰️',category:'food',       rarity:'rare',      sell_value:25,  food_value:15 },
  { item_key:'fish_golden_carp', name:'Golden Carp',      icon:'✨', category:'food',       rarity:'rare',      sell_value:35,  food_value:20 },
  { item_key:'fish_shadowfin',   name:'Shadowfin',        icon:'🌑', category:'food',       rarity:'legendary', sell_value:60,  food_value:40 },
  { item_key:'fish_moontrout',   name:'Moontrout',        icon:'🌕', category:'food',       rarity:'legendary', sell_value:100, food_value:55 },
  // Quest items / materials
  { item_key:'ancient_heartwood',  name:'Ancient Heartwood',  icon:'🪵', category:'material',   rarity:'rare',     sell_value:45  },
  { item_key:'luminous_scale',     name:'Luminous Scale',     icon:'✨', category:'quest_item', rarity:'rare',     sell_value:40  },
  { item_key:'ancient_blueprint',  name:'Ancient Blueprint',  icon:'📜', category:'quest_item', rarity:'epic',     sell_value:80  },
  { item_key:'blightbane_herb',    name:'Blightbane Herb',    icon:'🌿', category:'material',   rarity:'rare',     sell_value:35  },
  { item_key:'hunters_cloak',      name:"Hunter's Cloak",     icon:'🧥', category:'equipment',  rarity:'rare',     sell_value:60, equip_slot:'armour', stat_bonuses:{scouting:2,combat:1} },
  // Equipment
  { item_key:'iron_sword',         name:'Iron Sword',         icon:'⚔️', category:'equipment', rarity:'common',   sell_value:20, equip_slot:'weapon',  stat_bonuses:{combat:2}             },
  { item_key:'leather_armour',     name:'Leather Armour',     icon:'🛡️', category:'equipment', rarity:'common',   sell_value:18, equip_slot:'armour',  stat_bonuses:{combat:1}             },
  { item_key:'scouts_cloak',       name:"Scout's Cloak",      icon:'🧥', category:'equipment', rarity:'uncommon', sell_value:35, equip_slot:'armour',  stat_bonuses:{scouting:3}           },
  { item_key:'fishers_rod',        name:"Fisher's Rod",       icon:'🎣', category:'equipment', rarity:'uncommon', sell_value:25, equip_slot:'tool',    stat_bonuses:{fishing:3}            },
  { item_key:'steel_sword',        name:'Steel Sword',        icon:'🗡️', category:'equipment', rarity:'rare',     sell_value:55, equip_slot:'weapon',  stat_bonuses:{combat:4}             },
  { item_key:'dragonscale_armour', name:'Dragonscale Armour', icon:'🐉', category:'equipment', rarity:'epic',     sell_value:120,equip_slot:'armour',  stat_bonuses:{combat:5,scouting:2}  },
  // Materials
  { item_key:'timber_bundle',      name:'Timber Bundle',      icon:'🪵', category:'material',  rarity:'common',   sell_value:5   },
  { item_key:'iron_ore',           name:'Iron Ore',           icon:'⚫', category:'material',  rarity:'common',   sell_value:8   },
  { item_key:'rare_sap',           name:'Rare Sap',           icon:'🫙', category:'material',  rarity:'uncommon', sell_value:20  },
  { item_key:'gemstone',           name:'Gemstone',           icon:'💎', category:'material',  rarity:'rare',     sell_value:50  },
  // Trophies
  { item_key:'beast_horn',         name:'Beast Horn',         icon:'📯', category:'trophy',    rarity:'uncommon', sell_value:30  },
  { item_key:'ancient_coin',       name:'Ancient Coin',       icon:'🪙', category:'trophy',    rarity:'rare',     sell_value:40  },
  { item_key:'dragon_tooth',       name:'Dragon Tooth',       icon:'🦷', category:'trophy',    rarity:'epic',     sell_value:100 },
];

async function debugAddInventoryItem() {
  const sel = document.getElementById('debug-inv-item');
  const qty = parseInt(document.getElementById('debug-inv-qty')?.value || '1');
  const fb  = document.getElementById('debug-inv-feedback');
  if (!sel?.value) { if(fb) fb.textContent = '⚠️ Pick an item.'; return; }

  const parts = sel.value.split('|');
  const [item_key, name, icon, category, rarity] = parts;
  const sell_value = parseInt(parts[5]) || 0;
  const food_value = parseInt(parts[6]) || 0;

  const def = DEBUG_ALL_ITEMS.find(i => i.item_key === item_key) || {};

  await apiFetch('/api/inventory/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      item_key, name, icon, category, rarity,
      quantity: qty,
      equip_slot: def.equip_slot || null,
      stat_bonuses: def.stat_bonuses || {},
      source: 'debug',
      metadata: { sell_value, food_value },
    }),
  });

  if (fb) {
    fb.textContent = '✓ Added ' + qty + '× ' + name;
    fb.style.color = '#8ecf7e';
    setTimeout(() => { fb.textContent = ''; }, 2000);
  }
}

async function debugAddAllItems() {
  const fb = document.getElementById('debug-inv-feedback');
  if (fb) { fb.textContent = 'Adding all items…'; fb.style.color = '#e8c76a'; }
  for (const item of DEBUG_ALL_ITEMS) {
    await apiFetch('/api/inventory/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_key: item.item_key,
        name: item.name,
        icon: item.icon,
        category: item.category,
        rarity: item.rarity,
        quantity: 1,
        equip_slot: item.equip_slot || null,
        stat_bonuses: item.stat_bonuses || {},
        source: 'debug',
        metadata: { sell_value: item.sell_value || 0, food_value: item.food_value || 0 },
      }),
    });
  }
  if (fb) { fb.textContent = '✓ Added ' + DEBUG_ALL_ITEMS.length + ' items.'; fb.style.color = '#8ecf7e'; setTimeout(() => { fb.textContent = ''; }, 3000); }
}

async function debugSeedNpcs() {
  try {
    const r = await apiFetch('/api/game/seed-npcs', { method: 'POST' });
    const d = await r.json();
    alert(d.message || (d.ok ? 'Done!' : d.error));
    if (d.ok) renderMap();
  } catch(e) { alert('Error: ' + e.message); }
}

async function debugRunMigrations() {
  try {
    const r = await apiFetch('/api/game/migrate', { method: 'POST' });
    if (!r.ok) { alert('Server returned ' + r.status + ' — redeploy server first.'); return; }
    const d = await r.json();
    alert('Migrations:\n' + (d.results || []).join('\n'));
  } catch(e) { alert('Error: ' + e.message); }
}

// ── Map Generation Preview / World Tools ─────────────────────────────────
// Fetches a freshly-generated map (server doesn't write to DB) and renders
// it in a self-contained canvas so we can see how mapgen.js changes affect
// the world before committing. Also exposes Wipe & Regenerate (applies the
// preview to the live world) and Restore (rolls back to the archived world).
let _mapPreviewLastSeed = null;

function openMapPreview() {
  const modal = document.getElementById('map-preview-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  loadWorldInfo();
  // Auto-load preview on first open if nothing has been generated yet.
  if (_mapPreviewLastSeed === null) loadMapPreview(true);
}

function closeMapPreview() {
  const modal = document.getElementById('map-preview-modal');
  if (modal) modal.style.display = 'none';
}

// Fetch current world dimensions + archive availability and populate the
// info bar. Also pre-fills the W/H inputs with current dims and toggles the
// Restore button based on whether an archive exists.
async function loadWorldInfo() {
  const info = document.getElementById('map-preview-worldinfo');
  const restoreBtn = document.getElementById('map-preview-restore-btn');
  const wIn = document.getElementById('map-preview-w');
  const hIn = document.getElementById('map-preview-h');
  if (info) info.textContent = 'Loading world info…';
  try {
    const r = await apiFetch('/api/game/world/info');
    if (!r.ok) {
      if (info) info.textContent = 'Could not load world info (server returned ' + r.status + ')';
      return;
    }
    const d = await r.json();
    const cur = d.current || {};
    const arc = d.archive || null;
    if (info) {
      info.innerHTML =
        '<span><b>Current world</b>: ' + (cur.map_w || '?') + '×' + (cur.map_h || '?') +
        (cur.current_seed ? ' · seed <code>' + cur.current_seed + '</code>' : '') + '</span>' +
        '<span class="wi-archive">' + (arc
          ? '📦 Archive: ' + arc.map_w + '×' + arc.map_h + (arc.seed ? ' · seed ' + arc.seed : '') +
            ' · ' + new Date(arc.archived_at).toLocaleString()
          : '📦 No archive') + '</span>';
    }
    // Pre-fill dims to current so "Wipe & Regenerate" defaults to same size.
    if (wIn && cur.map_w) wIn.value = cur.map_w;
    if (hIn && cur.map_h) hIn.value = cur.map_h;
    if (restoreBtn) restoreBtn.disabled = !arc;
  } catch (e) {
    if (info) info.textContent = 'Error loading world info: ' + e.message;
  }
}

// Read dimensions from the W/H inputs, clamped to [4, 200].
function _mapPreviewReadDims() {
  const w = parseInt((document.getElementById('map-preview-w')||{}).value, 10);
  const h = parseInt((document.getElementById('map-preview-h')||{}).value, 10);
  const cw = Number.isFinite(w) ? Math.max(4, Math.min(200, w)) : 40;
  const ch = Number.isFinite(h) ? Math.max(4, Math.min(200, h)) : 40;
  return { w: cw, h: ch };
}

async function loadMapPreview(forceRandom) {
  const seedInput = document.getElementById('map-preview-seed');
  const status    = document.getElementById('map-preview-status');
  const legend    = document.getElementById('map-preview-legend');

  // Seed: explicit value wins; "Random" forces a new one.
  let seed = null;
  const raw = seedInput && seedInput.value.trim();
  if (raw && !forceRandom) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) seed = n;
  }
  const { w, h } = _mapPreviewReadDims();
  const params = new URLSearchParams();
  if (seed !== null) params.set('seed', seed);
  params.set('w', w);
  params.set('h', h);
  const url = '/api/game/preview-map?' + params.toString();

  if (status) status.textContent = 'generating…';
  try {
    const r = await apiFetch(url);
    if (!r.ok) {
      if (status) status.textContent = 'error: ' + r.status;
      return;
    }
    const data = await r.json();
    _mapPreviewLastSeed = data.seed;
    if (seedInput) seedInput.value = data.seed;
    if (status) status.textContent = data.mapW + '×' + data.mapH + ' · seed ' + data.seed + ' · ' + data.tiles.length + ' tiles';

    _renderMapPreviewCanvas(data);

    if (legend) {
      const colors = {
        plains: '#5a7a28', forest: '#2a5818', hills: '#454030',
        river: '#245278', ruins: '#484038', mountain: '#363432',
        marsh: '#3a6028',
      };
      const sorted = Object.entries(data.counts).sort((a,b) => b[1]-a[1]);
      legend.innerHTML = sorted.map(([t, c]) =>
        '<span class="lg-item"><span class="lg-swatch" style="background:' + (colors[t]||'#888') + '"></span>'
        + t + ' <b>' + c + '</b></span>'
      ).join('');
    }
  } catch (e) {
    if (status) status.textContent = 'error: ' + e.message;
  }
}

// Apply the previewed dimensions + seed to the live world.
// Destructive: archives current world first, then wipes settlement
// placements / fog / expeditions / NPCs, then generates the new map.
async function applyMapRegenerate() {
  const { w, h } = _mapPreviewReadDims();
  const seedInput = document.getElementById('map-preview-seed');
  const seedRaw = seedInput && seedInput.value.trim();
  const seedN = seedRaw ? parseInt(seedRaw, 10) : null;
  const seedDisplay = (seedN !== null && Number.isFinite(seedN)) ? seedN : 'random';

  const ok = confirm(
    'WIPE & REGENERATE the live world?\n\n' +
    'New dimensions: ' + w + '×' + h + '\n' +
    'Seed: ' + seedDisplay + '\n\n' +
    'This will:\n' +
    '  • Archive the current world (overwriting any previous archive)\n' +
    '  • Clear all player settlement placements\n' +
    '  • Clear all fog of war\n' +
    '  • Cancel all in-flight expeditions\n' +
    '  • Clear NPC settlements (re-seed manually after)\n\n' +
    'Settlement contents (citizens, buildings, inventory, quests) are preserved.\n\n' +
    'Continue?'
  );
  if (!ok) return;

  const status = document.getElementById('map-preview-status');
  if (status) status.textContent = 'regenerating…';
  try {
    const body = { w, h };
    if (seedN !== null && Number.isFinite(seedN)) body.seed = seedN;
    const r = await apiFetch('/api/game/world/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) {
      if (status) status.textContent = 'error: ' + (d.error || r.status);
      alert('Regenerate failed: ' + (d.error || r.status));
      return;
    }
    if (status) status.textContent = 'regenerated · ' + d.mapW + '×' + d.mapH;
    alert(
      'World regenerated.\n\n' +
      'New: ' + d.mapW + '×' + d.mapH + ' · seed ' + d.seed + '\n' +
      d.tiles_inserted + ' tiles created.\n\n' +
      'Now run "🌍 Seed NPC Settlements" to repopulate kingdoms and villages.\n' +
      'Players will be prompted to re-place their settlements on next refresh.'
    );
    loadWorldInfo();
    if (confirm('Reload the page now to see the new map?')) {
      location.reload();
    }
  } catch (e) {
    if (status) status.textContent = 'error: ' + e.message;
    alert('Regenerate error: ' + e.message);
  }
}

// Restore the archived world.
async function restoreArchivedMap() {
  const ok = confirm(
    'RESTORE the archived world?\n\n' +
    'This will:\n' +
    '  • Replace the current map with the archived one\n' +
    '  • Restore archived settlement placements\n' +
    '  • Restore archived NPC settlements\n' +
    '  • Restore archived fog of war\n' +
    '  • Cancel any in-flight expeditions\n\n' +
    'Continue?'
  );
  if (!ok) return;

  const status = document.getElementById('map-preview-status');
  if (status) status.textContent = 'restoring…';
  try {
    const r = await apiFetch('/api/game/world/restore', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) {
      if (status) status.textContent = 'error: ' + (d.error || r.status);
      alert('Restore failed: ' + (d.error || r.status));
      return;
    }
    if (status) status.textContent = 'restored · ' + d.mapW + '×' + d.mapH;
    alert(
      'World restored.\n\n' +
      d.mapW + '×' + d.mapH + ' · ' +
      d.tiles_restored + ' tiles · ' +
      d.settlements_restored + ' settlement placements · ' +
      d.fog_rows_restored + ' fog rows.'
    );
    loadWorldInfo();
    if (confirm('Reload the page now to see the restored map?')) {
      location.reload();
    }
  } catch (e) {
    if (status) status.textContent = 'error: ' + e.message;
    alert('Restore error: ' + e.message);
  }
}

// Self-contained preview renderer. Uses the same TILE_IMAGES / TILE_VARIANTS /
// _hexPathLT as the main map so what you see here matches what the live map
// will look like. Differs from _doRenderCanvas in that it: shows the whole map
// (not a viewport), has no fog/settlements/hover/scroll, and sizes itself to
// fit the modal canvas-wrap.
function _renderMapPreviewCanvas(data) {
  const canvas = document.getElementById('map-preview-canvas');
  const wrap   = canvas && canvas.parentElement;
  if (!canvas || !wrap) return;

  const tiles = data.tiles;
  const mapW  = data.mapW || 40;
  const mapH  = data.mapH || 40;

  // Use axial-coord layout (same as the main game renderer in main.js) so
  // the preview matches what the player will see and the river overlay can
  // use shared screen-space hex direction offsets.
  // Total bounding box for axial layout: width = (mapW + mapH/2) * hexW,
  // height = mapH * hexVert + hexH/4.
  const wrapW = wrap.clientWidth  - 28;
  const wrapH = wrap.clientHeight - 28;
  const fitW = wrapW / (mapW + mapH / 2 + 0.5);
  const fitH = wrapH / ((mapH * 0.75 + 0.25) * 1.1547);
  let hexW = Math.floor(Math.min(fitW, fitH));
  if (hexW < 6) hexW = 6;
  if (hexW > 32) hexW = 32;
  const hexH    = Math.round(hexW * 1.1547);
  const hexVert = Math.round(hexH * 0.75);

  const totalW = Math.ceil((mapW + mapH / 2 + 0.5) * hexW + 4);
  const totalH = Math.ceil(mapH * hexVert + hexH * 0.25 + 4);

  const dpr = window.devicePixelRatio || 1;
  canvas.width  = totalW * dpr;
  canvas.height = totalH * dpr;
  canvas.style.width  = totalW + 'px';
  canvas.style.height = totalH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background — match the unified earth tone so seams blend (same as main
  // renderer's clear color).
  ctx.fillStyle = '#3a2e22';
  ctx.fillRect(0, 0, totalW, totalH);

  // Tile origin offset — pad left/top a bit, account for axial skew.
  const padX = 2;
  const padY = 2;
  // Compute screen position from axial coords. Same formula main.js uses.
  const tileXY = (q, r) => ({
    x: padX + hexW * (q + r / 2),
    y: padY + hexVert * r,
  });

  // Build a tileMap so the river overlay can do neighbour lookups.
  const tileMap = {};
  for (const t of tiles) tileMap[`${t.q},${t.r}`] = t;

  // ── Pass 1: terrain tiles ─────────────────────────────────────────────
  for (const t of tiles) {
    const { x, y } = tileXY(t.q, t.r);
    let img = (typeof TILE_IMAGES !== 'undefined') ? TILE_IMAGES[t.terrain] : null;
    if ((!img || img._isVariantSet) && typeof getTileVariant === 'function') {
      img = getTileVariant(t.terrain, t.q, t.r);
    }
    const isUsableImage = img && !img._isVariantSet
      && (img.naturalWidth || img.width);

    if (isUsableImage) {
      ctx.save();
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.clip();
      // Draw with 1px overdraw to eliminate sub-pixel seams (same as main).
      ctx.drawImage(img, x - 1, y - 1, hexW + 2, hexH + 2);
      ctx.restore();
    } else {
      _hexPathLT(ctx, x, y, hexW, hexH);
      ctx.fillStyle = (typeof TERRAIN_COLORS !== 'undefined' && TERRAIN_COLORS[t.terrain])
        || '#2a2010';
      ctx.fill();
    }
  }

  // ── Pass 1.5: river water (painterly natural treatment) ────────────────
  // Mirror of the layered overlay in main.js — wet-earth aura, soft outer
  // water, body, shore details (terrain-aware reeds/grass/rocks), endpoint
  // pools. Lakes drawn as overlapping-circle blobs for organic shorelines,
  // with subtle ripple lines (no per-tile radial highlights — those create
  // a "bauble" look when each tile's gradient is brightest at its centre).
  const HEX_NEIGHBORS = [
    [+1, 0], [-1, 0], [0, +1], [0, -1], [+1, -1], [-1, +1],
  ];
  const HEX_DIR_PX = HEX_NEIGHBORS.map(([dq, dr]) => ({
    dx: hexW * (dq + dr / 2),
    dy: hexVert * dr,
  }));
  const tileAt = (q, r) => tileMap[`${q},${r}`];
  const isRiverTile = (q, r) => tileAt(q, r)?.terrain === 'river';
  const wrapQ = (q) => ((q % mapW) + mapW) % mapW;
  const wrapR = (r) => ((r % mapH) + mapH) % mapH;
  const hashF = (...args) => {
    let h = 0;
    for (const a of args) h = ((h * 31) ^ (a | 0)) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
  };
  const countRiverNeighbours = (q, r) => {
    let n = 0;
    for (const [dq, dr] of HEX_NEIGHBORS) {
      if (isRiverTile(wrapQ(q + dq), wrapR(r + dr))) n++;
    }
    return n;
  };
  const isLakeTile = (q, r) => {
    const c = countRiverNeighbours(q, r);
    if (c >= 4) return true;
    if (c >= 3) {
      for (const [dq, dr] of HEX_NEIGHBORS) {
        const nq = wrapQ(q + dq), nr = wrapR(r + dr);
        if (isRiverTile(nq, nr) && countRiverNeighbours(nq, nr) >= 4) return true;
      }
    }
    return false;
  };
  const flowRank = {};
  {
    const queue = [];
    for (const t of tiles) {
      if (t.terrain !== 'river') continue;
      if (countRiverNeighbours(t.q, t.r) === 1 && !isLakeTile(t.q, t.r)) {
        flowRank[`${t.q},${t.r}`] = 0;
        queue.push({ q: t.q, r: t.r, d: 0 });
      }
    }
    while (queue.length) {
      const cur = queue.shift();
      for (const [dq, dr] of HEX_NEIGHBORS) {
        const nq = wrapQ(cur.q + dq), nr = wrapR(cur.r + dr);
        if (!isRiverTile(nq, nr)) continue;
        const k = `${nq},${nr}`;
        if (flowRank[k] !== undefined) continue;
        flowRank[k] = cur.d + 1;
        queue.push({ q: nq, r: nr, d: cur.d + 1 });
      }
    }
  }
  let flowMax = 1;
  for (const k in flowRank) if (flowRank[k] > flowMax) flowMax = flowRank[k];
  const terrainWidthFactor = (terrain) => {
    if (terrain === 'mountain') return 0.55;
    if (terrain === 'hills') return 0.75;
    if (terrain === 'marsh') return 1.20;
    if (terrain === 'plains') return 1.05;
    return 1.0;
  };

  const COL_WET_EARTH    = 'rgba(35, 26, 18, 0.18)';
  const COL_WET_EARTH_RIM= 'rgba(50, 38, 26, 0.40)';
  const COL_WATER_OUTER  = 'rgba(70, 88, 102, 0.45)';
  const COL_WATER_BODY   = 'rgba(58, 78, 96, 0.92)';
  // Lake body uses a fully opaque variant — overlapping circles in the lake
  // blob would otherwise expose their structure through alpha compounding.
  const COL_WATER_BODY_OPAQUE = 'rgb(58, 78, 96)';
  const COL_WATER_LIGHT  = 'rgba(140, 162, 178, 0.40)';
  const COL_WATER_GLINT  = 'rgba(210, 222, 228, 0.55)';
  const COL_REED         = 'rgba(78, 96, 50, 0.85)';
  const COL_REED_DARK    = 'rgba(50, 64, 30, 0.85)';
  const COL_GRASS        = 'rgba(110, 130, 60, 0.75)';
  const COL_ROCK_DARK    = 'rgba(56, 50, 44, 0.85)';
  const COL_ROCK_LIGHT   = 'rgba(120, 110, 100, 0.70)';

  const baseW = Math.max(5, hexW * 0.40);

  const riverRenders = [];
  for (const t of tiles) {
    if (t.terrain !== 'river') continue;
    const { x, y } = tileXY(t.q, t.r);
    const meX = x + hexW / 2, meY = y + hexH / 2;
    const rk = flowRank[`${t.q},${t.r}`] ?? 0;
    const downstreamFactor = 0.55 + (rk / flowMax) * 0.65;
    const width = baseW * downstreamFactor * terrainWidthFactor(t.terrain);
    const lake = isLakeTile(t.q, t.r);
    const conns = [];
    for (let i = 0; i < HEX_NEIGHBORS.length; i++) {
      const [dq, dr] = HEX_NEIGHBORS[i];
      const nq = wrapQ(t.q + dq), nr = wrapR(t.r + dr);
      if (!isRiverTile(nq, nr)) continue;
      const nX = meX + HEX_DIR_PX[i].dx;
      const nY = meY + HEX_DIR_PX[i].dy;
      let mx = (meX + nX) / 2;
      let my = (meY + nY) / 2;
      let ka = t.q, kb = t.r, kc = nq, kd = nr;
      if (ka > kc || (ka === kc && kb > kd)) {
        [ka, kc] = [kc, ka]; [kb, kd] = [kd, kb];
      }
      const wobble = (hashF(ka, kb, kc, kd) - 0.5) * hexW * 0.10;
      const ex = nX - meX, ey = nY - meY;
      const elen = Math.sqrt(ex * ex + ey * ey) || 1;
      mx += (-ey / elen) * wobble;
      my += (ex / elen) * wobble;
      conns.push({
        nq, nr, dirIdx: i,
        edge: { x: mx, y: my },
        tangent: { x: ex / elen, y: ey / elen },
        nTerrain: tileAt(nq, nr)?.terrain || 'plains',
      });
    }
    riverRenders.push({
      wq: t.q, wr: t.r,
      x: meX, y: meY,
      hexX: x, hexY: y,
      width, conns, lake,
      terrain: t.terrain,
    });
  }

  const lakeRenders = riverRenders.filter(r => r.lake);
  const isLakeNeighbour = (rt, dirIdx) => {
    const [dq, dr] = HEX_NEIGHBORS[dirIdx];
    return isLakeTile(wrapQ(rt.wq + dq), wrapR(rt.wr + dr));
  };
  const lakeBlobCircles = (rt) => {
    const circles = [];
    const coreR = hexW * (0.58 + hashF(rt.wq, rt.wr, 21) * 0.08);
    circles.push({ x: rt.x, y: rt.y, r: coreR });
    for (let i = 0; i < HEX_NEIGHBORS.length; i++) {
      if (!isLakeNeighbour(rt, i)) continue;
      const dx = HEX_DIR_PX[i].dx, dy = HEX_DIR_PX[i].dy;
      const bx = rt.x + dx * 0.5;
      const by = rt.y + dy * 0.5;
      const br = hexW * (0.42 + hashF(rt.wq, rt.wr, 22 + i) * 0.06);
      circles.push({ x: bx, y: by, r: br });
    }
    return circles;
  };

  const cpDist = hexW * 0.35;
  const strokeRiverPath = (rt) => {
    if (rt.lake) return;
    const { x, y, conns } = rt;
    if (conns.length === 2) {
      const a = conns[0], b = conns[1];
      const cax = a.edge.x - a.tangent.x * cpDist;
      const cay = a.edge.y - a.tangent.y * cpDist;
      const cbx = b.edge.x - b.tangent.x * cpDist;
      const cby = b.edge.y - b.tangent.y * cpDist;
      ctx.beginPath();
      ctx.moveTo(a.edge.x, a.edge.y);
      ctx.bezierCurveTo(cax, cay, cbx, cby, b.edge.x, b.edge.y);
      ctx.stroke();
    } else if (conns.length === 1) {
      const c = conns[0];
      const cax = c.edge.x - c.tangent.x * cpDist;
      const cay = c.edge.y - c.tangent.y * cpDist;
      ctx.beginPath();
      ctx.moveTo(c.edge.x, c.edge.y);
      ctx.bezierCurveTo(cax, cay, x, y, x, y);
      ctx.stroke();
    } else if (conns.length >= 3) {
      for (const c of conns) {
        const cax = (x + c.edge.x) / 2;
        const cay = (y + c.edge.y) / 2;
        const cbx = c.edge.x - c.tangent.x * cpDist;
        const cby = c.edge.y - c.tangent.y * cpDist;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(cax, cay, cbx, cby, c.edge.x, c.edge.y);
        ctx.stroke();
      }
    }
  };
  const fillLakeBlob = (rt, expand) => {
    const circles = lakeBlobCircles(rt);
    for (const c of circles) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r + expand, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // L1 wet earth aura
  ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.strokeStyle = COL_WET_EARTH;
  for (const rt of riverRenders) { ctx.lineWidth = rt.width + 14; strokeRiverPath(rt); }
  ctx.fillStyle = COL_WET_EARTH;
  for (const rt of lakeRenders) fillLakeBlob(rt, 8);
  ctx.strokeStyle = COL_WET_EARTH_RIM;
  for (const rt of riverRenders) { ctx.lineWidth = rt.width + 6; strokeRiverPath(rt); }
  ctx.fillStyle = COL_WET_EARTH_RIM;
  for (const rt of lakeRenders) fillLakeBlob(rt, 3);
  ctx.restore();

  // L2 soft outer water
  ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.strokeStyle = COL_WATER_OUTER;
  for (const rt of riverRenders) { ctx.lineWidth = rt.width + 3; strokeRiverPath(rt); }
  ctx.fillStyle = COL_WATER_OUTER;
  for (const rt of lakeRenders) fillLakeBlob(rt, 1.5);
  ctx.restore();

  // L3 body
  ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.strokeStyle = COL_WATER_BODY;
  for (const rt of riverRenders) { ctx.lineWidth = rt.width; strokeRiverPath(rt); }
  ctx.fillStyle = COL_WATER_BODY_OPAQUE;
  for (const rt of lakeRenders) fillLakeBlob(rt, 0);
  ctx.restore();

  // L4 highlight (river curves only)
  ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.strokeStyle = COL_WATER_LIGHT;
  for (const rt of riverRenders) { if (rt.lake) continue; ctx.lineWidth = rt.width * 0.42; strokeRiverPath(rt); }
  ctx.restore();
  // Lake surface — calm flat with subtle ripple lines (no center-bauble
  // radial highlights). 1-2 short faint horizontal-ish curves per tile.
  ctx.save();
  ctx.strokeStyle = 'rgba(225, 232, 238, 0.18)';
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  for (const rt of lakeRenders) {
    const numRipples = (hashF(rt.wq, rt.wr, 41) < 0.55) ? 2 : 1;
    for (let i = 0; i < numRipples; i++) {
      const ox = (hashF(rt.wq, rt.wr, 42 + i) - 0.5) * hexW * 0.55;
      const oy = (hashF(rt.wq, rt.wr, 44 + i) - 0.5) * hexH * 0.45;
      const cx_ = rt.x + ox;
      const cy_ = rt.y + oy;
      const len = hexW * (0.20 + hashF(rt.wq, rt.wr, 46 + i) * 0.12);
      const tilt = (hashF(rt.wq, rt.wr, 48 + i) - 0.5) * 0.4;
      const dx = Math.cos(tilt) * len / 2;
      const dy = Math.sin(tilt) * len / 2;
      ctx.beginPath();
      ctx.moveTo(cx_ - dx, cy_ - dy);
      ctx.quadraticCurveTo(cx_, cy_ - 0.6, cx_ + dx, cy_ + dy);
      ctx.stroke();
    }
  }
  ctx.restore();

  // L5 details
  const drawReedAt = (px, py, seed) => {
    const n = 2 + (seed * 3 | 0) % 2;
    for (let i = 0; i < n; i++) {
      const h = 3 + ((seed * (i + 1.7)) % 1) * 4;
      const ox = (i - (n - 1) / 2) * 1.5;
      ctx.fillStyle = i === 0 ? COL_REED_DARK : COL_REED;
      ctx.fillRect(px + ox, py - h, 1, h);
    }
  };
  const drawGrassAt = (px, py, seed) => {
    ctx.fillStyle = COL_GRASS;
    const n = 3 + (seed * 4 | 0) % 3;
    for (let i = 0; i < n; i++) {
      const ox = (i - n / 2) * 1.3;
      const lean = (((seed * (i + 1)) % 1) - 0.5) * 1.5;
      ctx.fillRect(px + ox, py - 2.5, 0.9, 2.5);
      ctx.fillRect(px + ox + lean, py - 2.0, 0.9, 2.0);
    }
  };
  const drawRockAt = (px, py, seed) => {
    ctx.beginPath(); ctx.fillStyle = COL_ROCK_DARK; ctx.arc(px, py, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.fillStyle = COL_ROCK_LIGHT; ctx.arc(px - 0.5, py - 0.5, 1.0, 0, Math.PI * 2); ctx.fill();
  };
  const drawRippleAt = (px, py, len) => {
    ctx.strokeStyle = 'rgba(170, 190, 205, 0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(px - len / 2, py);
    ctx.quadraticCurveTo(px, py - 0.7, px + len / 2, py);
    ctx.stroke();
  };
  for (const rt of riverRenders) {
    if (!rt.lake) {
      const numRipples = (hashF(rt.wq, rt.wr, 31) < 0.55) ? 2 : 1;
      for (let i = 0; i < numRipples; i++) {
        let px, py;
        const t1 = 0.30 + i * 0.40 + (hashF(rt.wq, rt.wr, 32 + i) - 0.5) * 0.15;
        if (rt.conns.length === 2) {
          const a = rt.conns[0].edge, b = rt.conns[1].edge;
          if (t1 < 0.5) { const u = t1 * 2; px = a.x + (rt.x - a.x) * u; py = a.y + (rt.y - a.y) * u; }
          else { const u = (t1 - 0.5) * 2; px = rt.x + (b.x - rt.x) * u; py = rt.y + (b.y - rt.y) * u; }
        } else {
          px = rt.x + (hashF(rt.wq, rt.wr, 33 + i) - 0.5) * rt.width;
          py = rt.y + (hashF(rt.wq, rt.wr, 34 + i) - 0.5) * rt.width * 0.6;
        }
        drawRippleAt(px, py, rt.width * 0.45);
      }
    }
    for (const c of rt.conns) {
      if (c.nTerrain === 'river') continue;
      const seed = hashF(rt.wq, rt.wr, c.dirIdx + 7);
      const numMarks = 1 + ((seed * 2) | 0);
      for (let i = 0; i < numMarks; i++) {
        const along = (hashF(rt.wq, rt.wr, c.dirIdx * 13 + i + 3) - 0.5) * rt.width * 1.4;
        const tx = c.tangent.x, ty = c.tangent.y;
        const px_ = -ty, py_ = tx;
        const offDist = rt.width * 0.50 + 1.5;
        const mx = c.edge.x + px_ * offDist + tx * along;
        const my = c.edge.y + py_ * offDist + ty * along;
        const mseed = hashF(rt.wq, rt.wr, c.dirIdx * 17 + i + 11);
        if (c.nTerrain === 'marsh') drawReedAt(mx, my, mseed);
        else if (c.nTerrain === 'plains') { if (mseed < 0.5) drawReedAt(mx, my, mseed); else drawGrassAt(mx, my, mseed); }
        else if (c.nTerrain === 'hills' || c.nTerrain === 'mountain') drawRockAt(mx, my, mseed);
        else if (c.nTerrain === 'forest') { if (mseed < 0.65) drawGrassAt(mx, my, mseed); else drawRockAt(mx, my, mseed); }
      }
    }
  }

  // L6 endpoint pools
  for (const rt of riverRenders) {
    if (rt.lake) continue;
    const isEndpoint = rt.conns.length <= 1;
    const isJunction = rt.conns.length >= 3;
    if (!isEndpoint && !isJunction) continue;
    const r = isEndpoint
      ? (rt.conns.length === 0 ? rt.width * 0.65 : rt.width * 0.55)
      : rt.width * 0.32;
    ctx.beginPath(); ctx.fillStyle = COL_WET_EARTH_RIM; ctx.arc(rt.x, rt.y, r + 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.fillStyle = COL_WATER_OUTER;   ctx.arc(rt.x, rt.y, r + 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.fillStyle = COL_WATER_BODY;    ctx.arc(rt.x, rt.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.fillStyle = COL_WATER_LIGHT;   ctx.arc(rt.x - r * 0.25, rt.y - r * 0.25, r * 0.55, 0, Math.PI * 2); ctx.fill();
    if (isEndpoint) {
      ctx.beginPath(); ctx.fillStyle = COL_WATER_GLINT;
      ctx.arc(rt.x - r * 0.35, rt.y - r * 0.35, r * 0.20, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ── Diplomacy debug tools ────────────────────
async function loadDiplomacyDebugNpcs() {
  const sel = document.getElementById('debug-diplo-npc');
  if (!sel) return;
  try {
    const r = await apiFetch('/api/diplomacy');
    const d = await r.json();
    // Also fetch all NPC settlements to show ones not yet contacted
    const nr = await apiFetch('/api/game/npc-list');
    const npcs = (await nr.json().catch(() => ({}))).npcs || [];
    const relations = d.relations || [];
    const relMap = {};
    relations.forEach(rel => { relMap[rel.npc_id] = rel; });

    sel.innerHTML = npcs.map(n =>
      '<option value="' + n.id + '">' + n.name + ' (' + (relMap[n.id] ? 'Trust: ' + relMap[n.id].trust : 'Unknown') + ')</option>'
    ).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">— load failed —</option>';
  }
}

async function debugSetDiplomacyTrust() {
  const npcId = document.getElementById('debug-diplo-npc')?.value;
  const trust = parseInt(document.getElementById('debug-diplo-trust')?.value || '0');
  const fb = document.getElementById('debug-diplo-feedback');
  if (!npcId) { if(fb) { fb.textContent = '⚠️ Pick an NPC.'; fb.style.color='#e07a6a'; } return; }

  try {
    const r = await apiFetch('/api/game/debug-diplomacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ npc_id: parseInt(npcId), trust }),
    });
    const d = await r.json();
    if (fb) {
      fb.textContent = d.ok ? '✓ Trust set to ' + trust : '⚠️ ' + d.error;
      fb.style.color = d.ok ? '#8ecf7e' : '#e07a6a';
      setTimeout(() => { fb.textContent = ''; }, 2500);
    }
    await loadDiplomacyDebugNpcs();
    if (window._lastSelectedTile?.settlement?.npc_id) {
      renderDiplomacyPanel(window._lastSelectedTile.settlement, window._lastSelectedTile);
    }
  } catch(e) { if(fb) fb.textContent = '⚠️ ' + e.message; }
}

async function debugResetDiplomacy() {
  if (!confirm('Reset ALL diplomacy relations to Unknown?')) return;
  const fb = document.getElementById('debug-diplo-feedback');
  try {
    const r = await apiFetch('/api/game/debug-diplomacy-reset', { method: 'POST' });
    const d = await r.json();
    if (fb) { fb.textContent = d.ok ? '✓ All relations reset.' : '⚠️ ' + d.error; fb.style.color = d.ok ? '#8ecf7e' : '#e07a6a'; setTimeout(()=>{fb.textContent='';},2500); }
    await loadDiplomacyDebugNpcs();
  } catch(e) { if(fb) fb.textContent = '⚠️ ' + e.message; }
}
