// ══════════════════════════════════════════════
//  QUEST SYSTEM — Kindlewood
// ══════════════════════════════════════════════

const QUEST_CATEGORY_ICONS = {
  gathering: '🌿',
  scouting:  '🗺',
  combat:    '⚔️',
  crafting:  '🔨',
};

const QUEST_SKILL_LABELS = {
  farming:    'Farming',
  fishing:    'Fishing',
  scouting:   'Scouting',
  combat:     'Combat',
  crafting:   'Crafting',
  woodcutting:'Woodcutting',
  mining:     'Mining',
};

let _questData = { available: [], active: [] };
let _questTimerInterval = null;

// ── Open notice board ─────────────────────────

async function openNoticeboard() {
  document.getElementById('tavern-menu').style.display = 'none';
  document.getElementById('tavern-card-menu').style.display = 'none';
  document.getElementById('tavern-game-area').style.display = 'none';

  const board = document.getElementById('tavern-quest-board');
  board.style.display = 'flex';

  renderQuestBoard('<div class="quest-loading">📜 Checking the notice board…</div>');

  try {
    const res = await apiFetch('/api/quests');
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    _questData = data;
    renderQuestBoard();
    startQuestTimers();
  } catch (e) {
    renderQuestBoard('<div class="quest-loading">⚠️ Couldn\'t reach the notice board right now.</div>');
  }
}

function closeNoticeboard() {
  document.getElementById('tavern-quest-board').style.display = 'none';
  document.getElementById('tavern-menu').style.display = 'flex';
  stopQuestTimers();
}

// ── Render ─────────────────────────────────────

function renderQuestBoard(loadingHtml) {
  const board = document.getElementById('tavern-quest-board');

  if (loadingHtml) {
    board.innerHTML = `
      <div class="qb-header">
        <div class="qb-title">📜 Notice Board</div>
        <button class="qb-back-btn" onclick="closeNoticeboard()">← Back</button>
      </div>
      ${loadingHtml}`;
    return;
  }

  const { available, active } = _questData;

  // Separate active vs collectible vs history
  const inProgress  = active.filter(q => q.status === 'active');
  const collectible = active.filter(q => q.status === 'completed' || q.status === 'failed');
  const history     = active.filter(q => q.status === 'collected').slice(0, 3);

  board.innerHTML = `
    <div class="qb-header">
      <div class="qb-title">📜 Notice Board</div>
      <button class="qb-back-btn" onclick="closeNoticeboard()">← Back</button>
    </div>

    ${collectible.length ? `
      <div class="qb-section-label">⚡ Ready to Collect</div>
      <div class="qb-list" id="qb-collectible">
        ${collectible.map(q => renderCollectibleQuest(q)).join('')}
      </div>
    ` : ''}

    ${inProgress.length ? `
      <div class="qb-section-label">⏳ In Progress</div>
      <div class="qb-list" id="qb-in-progress">
        ${inProgress.map(q => renderActiveQuest(q)).join('')}
      </div>
    ` : ''}

    <div class="qb-section-label">📋 Available Quests</div>
    <div class="qb-list" id="qb-available">
      ${available.map(q => renderAvailableQuest(q, inProgress)).join('')}
    </div>

    ${history.length ? `
      <div class="qb-section-label">📖 Recent History</div>
      <div class="qb-list qb-history">
        ${history.map(q => renderHistoryQuest(q)).join('')}
      </div>
    ` : ''}
  `;
}

function renderAvailableQuest(q, inProgress) {
  const busy = inProgress.some(a => a.quest_id === q.id);
  const catIcon = QUEST_CATEGORY_ICONS[q.category] || '📜';
  const skillLabel = QUEST_SKILL_LABELS[q.skill_key] || q.skill_key;

  return `
    <div class="qb-card ${busy ? 'qb-card-busy' : ''}">
      <div class="qb-card-top">
        <div class="qb-card-icon">${q.icon || catIcon}</div>
        <div class="qb-card-info">
          <div class="qb-card-title">${q.title}</div>
          <div class="qb-card-desc">${q.description}</div>
          <div class="qb-card-meta">
            <span class="qb-tag qb-tag-skill">🎯 ${skillLabel}</span>
            <span class="qb-tag qb-tag-time">⏱ ${formatDuration(q.duration_s)}</span>
            <span class="qb-tag qb-tag-gold">🪙 ${q.reward_gold} gold</span>
          </div>
        </div>
      </div>
      ${busy ? `
        <div class="qb-busy-note">Already underway</div>
      ` : `
        <div class="qb-citizen-row">
          <select class="qb-citizen-select" id="qb-select-${q.id}" onchange="updateQuestSuccessPreview('${q.id}', '${q.skill_key}', ${q.base_success})">
            <option value="">— Assign a citizen —</option>
            ${_buildCitizenOptions(q.skill_key, inProgress)}
          </select>
          <span class="qb-success-preview" id="qb-preview-${q.id}"></span>
          <button class="qb-accept-btn" onclick="acceptQuest('${q.id}')">Accept</button>
        </div>
      `}
    </div>`;
}

function renderActiveQuest(q) {
  const quest = _getQuestDef(q.quest_id);
  const remaining = Math.max(0, new Date(q.completes_at) - Date.now());
  const remainSec = Math.ceil(remaining / 1000);

  return `
    <div class="qb-card qb-card-active">
      <div class="qb-card-top">
        <div class="qb-card-icon">${quest?.icon || '📜'}</div>
        <div class="qb-card-info">
          <div class="qb-card-title">${quest?.title || q.quest_id}</div>
          <div class="qb-card-citizen">👤 ${q.citizen_name || 'Unknown'}</div>
          <div class="qb-card-meta">
            <span class="qb-tag qb-tag-time">⏱ <span class="quest-timer" data-id="${q.id}" data-eta="${q.completes_at}">${formatDuration(remainSec)}</span></span>
          </div>
        </div>
      </div>
      <div class="qb-progress-bar-wrap">
        <div class="qb-progress-bar" id="qb-progress-${q.id}" style="width:${_progressPct(q)}%"></div>
      </div>
    </div>`;
}

function renderCollectibleQuest(q) {
  const quest = _getQuestDef(q.quest_id);
  const success = q.status === 'completed';
  const flavour = success ? quest?.flavour_success : quest?.flavour_fail;
  const goldStr = success ? `<span class="qb-gold-reward">+${quest?.reward_gold ?? 0} 🪙</span>` : '';

  return `
    <div class="qb-card qb-card-collectible ${success ? 'qb-card-success' : 'qb-card-fail'}">
      <div class="qb-card-top">
        <div class="qb-card-icon">${success ? '✅' : '❌'}</div>
        <div class="qb-card-info">
          <div class="qb-card-title">${quest?.title || q.quest_id}</div>
          <div class="qb-card-citizen">${q.citizen_name || 'Unknown'} ${flavour ? `<em>${flavour}</em>` : ''}</div>
          ${goldStr}
        </div>
      </div>
      <button class="qb-collect-btn ${success ? '' : 'qb-collect-btn-fail'}" onclick="collectQuest(${q.id})">
        ${success ? '🪙 Collect Reward' : '🤝 Dismiss'}
      </button>
    </div>`;
}

function renderHistoryQuest(q) {
  const quest = _getQuestDef(q.quest_id);
  return `
    <div class="qb-history-row">
      <span class="qb-hist-icon">${q.outcome_icon || (q.status === 'collected' ? '✓' : '✗')}</span>
      <span class="qb-hist-title">${quest?.title || q.quest_id}</span>
      <span class="qb-hist-citizen">${q.citizen_name || ''}</span>
    </div>`;
}

// ── Citizen dropdown helpers ──────────────────

function _buildCitizenOptions(skillKey, inProgress) {
  const busyCitizenIds = new Set(inProgress.map(q => q.citizen_id));
  const citizens = (typeof citizensData !== 'undefined' ? citizensData : []);
  if (!citizens.length) return '<option disabled>No citizens available</option>';

  return citizens
    .filter(c => !busyCitizenIds.has(c.id) && !c.expedition)
    .sort((a, b) => (b.skills?.[skillKey] ?? 0) - (a.skills?.[skillKey] ?? 0))
    .map(c => {
      const skillVal = c.skills?.[skillKey] ?? 0;
      const chance = Math.min(95, Math.round((0.5 + (skillVal - 1) * 0.04) * 100));
      return `<option value="${c.id}" data-skill="${skillVal}">${c.name} (${QUEST_SKILL_LABELS[skillKey] || skillKey} ${skillVal})</option>`;
    }).join('');
}

function updateQuestSuccessPreview(questId, skillKey, baseSuccess) {
  const sel = document.getElementById(`qb-select-${questId}`);
  const preview = document.getElementById(`qb-preview-${questId}`);
  if (!sel || !preview) return;

  const citizenId = parseInt(sel.value);
  if (!citizenId) { preview.textContent = ''; return; }

  const citizen = (citizensData || []).find(c => c.id === citizenId);
  if (!citizen) { preview.textContent = ''; return; }

  const skillVal = citizen.skills?.[skillKey] ?? 1;
  const chance = Math.min(95, Math.round((baseSuccess + (skillVal - 1) * 0.04) * 100));
  const color = chance >= 70 ? '#7ecf6e' : chance >= 45 ? '#e8c76a' : '#e87a6a';
  preview.innerHTML = `<span style="color:${color}">${chance}% success</span>`;
}

// ── Accept / Collect ──────────────────────────

async function acceptQuest(questId) {
  const sel = document.getElementById(`qb-select-${questId}`);
  const citizenId = sel ? parseInt(sel.value) : null;
  if (!citizenId) {
    _questFlash('⚠️ Pick a citizen first.');
    return;
  }

  const btn = document.querySelector(`#qb-available .qb-card .qb-accept-btn`);

  try {
    const res = await apiFetch('/api/quests/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quest_id: questId, citizen_id: citizenId }),
    });
    const data = await res.json();
    if (!res.ok) { _questFlash(`⚠️ ${data.error}`); return; }

    _questFlash(`🗡 ${data.citizen_name} has set out!`);
    // Reload board
    const res2 = await apiFetch('/api/quests');
    _questData = await res2.json();
    renderQuestBoard();
    startQuestTimers();
  } catch (e) {
    _questFlash('⚠️ Something went wrong.');
  }
}

async function collectQuest(runId) {
  try {
    const res = await apiFetch(`/api/quests/collect/${runId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { _questFlash(`⚠️ ${data.error}`); return; }

    if (data.gold_awarded > 0) {
      _questFlash(`🪙 Collected ${data.gold_awarded} gold!`);
      if (gameData?.settlement?.resources) {
        gameData.settlement.resources.wealth += data.gold_awarded;
        updateTopbarDisplay?.();
      }
    } else {
      _questFlash('Quest dismissed.');
    }

    const res2 = await apiFetch('/api/quests');
    _questData = await res2.json();
    renderQuestBoard();
    startQuestTimers();
  } catch (e) {
    _questFlash('⚠️ Failed to collect.');
  }
}

// ── Timers ────────────────────────────────────

function startQuestTimers() {
  stopQuestTimers();
  _questTimerInterval = setInterval(_tickQuestTimers, 1000);
}

function stopQuestTimers() {
  if (_questTimerInterval) { clearInterval(_questTimerInterval); _questTimerInterval = null; }
}

function _tickQuestTimers() {
  document.querySelectorAll('.quest-timer').forEach(el => {
    const eta = new Date(el.dataset.eta);
    const remaining = Math.max(0, Math.ceil((eta - Date.now()) / 1000));
    el.textContent = remaining > 0 ? formatDuration(remaining) : 'Returning…';

    // Update progress bar
    const runId = el.dataset.id;
    const bar = document.getElementById(`qb-progress-${runId}`);
    if (bar) {
      const run = _questData.active.find(q => String(q.id) === String(runId));
      if (run) bar.style.width = `${_progressPct(run)}%`;
    }
  });

  // Auto-refresh when any timer hits 0
  const anyDone = _questData.active.some(q =>
    q.status === 'active' && new Date(q.completes_at) <= Date.now()
  );
  if (anyDone) {
    apiFetch('/api/quests').then(r => r.json()).then(data => {
      _questData = data;
      renderQuestBoard();
      startQuestTimers();
    });
  }
}

function _progressPct(run) {
  const start = new Date(run.started_at).getTime();
  const end = new Date(run.completes_at).getTime();
  const now = Date.now();
  const total = end - start;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - start) / total) * 100)));
}

// ── Helpers ───────────────────────────────────

function _getQuestDef(questId) {
  // First check active quests for an embedded definition (server-provided)
  const fromActive = _questData.active?.find(q => q.quest_id === questId);
  if (fromActive?.quest_def) return fromActive.quest_def;
  // Fall back to available list
  return _questData.available?.find(q => q.id === questId) || null;
}

function _questFlash(msg) {
  let flash = document.getElementById('qb-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'qb-flash';
    flash.className = 'qb-flash';
    document.getElementById('tavern-quest-board')?.prepend(flash);
  }
  flash.textContent = msg;
  flash.classList.add('visible');
  setTimeout(() => flash.classList.remove('visible'), 3000);
}
